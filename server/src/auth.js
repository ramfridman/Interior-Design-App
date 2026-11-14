/**
 * Identity for the Worker: Cloudflare Access only.
 *
 * Production: every request that reaches the Worker through Access carries `Cf-Access-Jwt-Assertion`, an RS256 JWT
 * signed by the team's keys (https://<team>.cloudflareaccess.com/cdn-cgi/access/certs). We verify the signature against
 * that key set, the audience (the Access application's AUD tag), the issuer (the team domain), expiry / not-before, and
 * take the `email` claim. Configuration (Worker variables, never secrets):
 *   ACCESS_TEAM_DOMAIN   e.g. https://myteam.cloudflareaccess.com   (or just "myteam.cloudflareaccess.com")
 *   ACCESS_AUD           the application's "Application Audience (AUD) Tag"
 *
 * Local testing only: DEV_AUTH = "1" lets an `X-Dev-User: name@example.com` header (or a `dev_user` cookie, which a
 * browser can send with its WebSocket) stand in for Access. It is refused — the Worker answers 503 — when Access is
 * configured, when PRODUCTION = "1", or when the request does not come to localhost / 127.0.0.1.
 * The Node dev server's other shortcuts (`?as=`, `Cf-Access-Authenticated-User-Email`) are never accepted here.
 */

const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}$/;
const LEEWAY_S = 60;

const b64urlBytes = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

/** "myteam.cloudflareaccess.com" | "https://myteam.cloudflareaccess.com/" → "https://myteam.cloudflareaccess.com".
 *  http:// is accepted only for localhost (tests serve their own key set). */
export function teamOrigin(domain) {
  let d = String(domain || '').trim();
  if (!d) return null;
  if (!/^https?:\/\//.test(d)) d = 'https://' + d;
  try {
    const u = new URL(d);
    if (u.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(u.hostname)) return null;
    return u.origin;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- key set cache (per isolate)
const jwksCache = new Map();   // certsUrl → { at, keys: Map<kid, CryptoKey>, fetching }
const JWKS_TTL = 60 * 60 * 1000, JWKS_RETRY = 60 * 1000;

async function loadKeys(certsUrl, fetchImpl) {
  const r = await fetchImpl(certsUrl, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('certs ' + r.status);
  const j = await r.json();
  const keys = new Map();
  for (const jwk of j.keys || []) {
    if (jwk.kty !== 'RSA' || !jwk.kid) continue;
    try {
      const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      keys.set(jwk.kid, key);
    } catch (e) { /* skip a malformed key */ }
  }
  return keys;
}
async function keyFor(certsUrl, kid, fetchImpl, now) {
  let c = jwksCache.get(certsUrl);
  const stale = !c || now - c.at > JWKS_TTL;
  const unknown = c && !c.keys.has(kid) && now - c.at > JWKS_RETRY;    // keys rotated: refetch, at most once a minute
  if (stale || unknown) {
    try { c = { at: now, keys: await loadKeys(certsUrl, fetchImpl) }; jwksCache.set(certsUrl, c); }
    catch (e) { if (!c) throw e; }
  }
  return c.keys.get(kid) || null;
}
/** Tests: forget cached key sets. */
export const clearKeyCache = () => jwksCache.clear();

/**
 * Verify an Access JWT. → { ok: true, email, claims } | { ok: false, reason }
 * @param {string} token
 * @param {{ teamDomain: string, aud: string, now?: number, fetch?: Function }} cfg
 */
export async function verifyAccessJwt(token, { teamDomain, aud, now = Date.now(), fetch: fetchImpl = fetch } = {}) {
  const origin = teamOrigin(teamDomain);
  if (!origin || !aud) return { ok: false, reason: 'access-not-configured' };
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  let header, claims;
  try { header = b64urlJson(parts[0]); claims = b64urlJson(parts[1]); } catch (e) { return { ok: false, reason: 'malformed' }; }
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') return { ok: false, reason: 'algorithm' };
  let key;
  try { key = await keyFor(origin + '/cdn-cgi/access/certs', header.kid, fetchImpl, now); } catch (e) { return { ok: false, reason: 'certs-unavailable' }; }
  if (!key) return { ok: false, reason: 'unknown-key' };
  let good = false;
  try { good = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1])); } catch (e) { good = false; }
  if (!good) return { ok: false, reason: 'signature' };
  const t = Math.floor(now / 1000);
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud)) return { ok: false, reason: 'audience' };
  if (typeof claims.exp !== 'number' || claims.exp + LEEWAY_S < t) return { ok: false, reason: 'expired' };
  if (typeof claims.nbf === 'number' && claims.nbf - LEEWAY_S > t) return { ok: false, reason: 'not-yet-valid' };
  if (claims.iss !== origin) return { ok: false, reason: 'issuer' };
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!EMAIL.test(email)) return { ok: false, reason: 'no-email' };   // e.g. a service token: no person behind it
  return { ok: true, email, claims };
}

/** How this deployment authenticates: 'access' | 'dev' | 'misconfigured' (+ why). */
export function authMode(env, url) {
  const accessSet = !!(env.ACCESS_TEAM_DOMAIN || env.ACCESS_AUD);
  if (env.DEV_AUTH === '1') {
    if (accessSet) return { mode: 'misconfigured', why: 'DEV_AUTH must not be set together with the Access variables.' };
    if (env.PRODUCTION === '1') return { mode: 'misconfigured', why: 'DEV_AUTH is refused in production.' };
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return { mode: 'misconfigured', why: 'DEV_AUTH works only on localhost.' };
    return { mode: 'dev' };
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return { mode: 'misconfigured', why: 'Set ACCESS_TEAM_DOMAIN and ACCESS_AUD (see docs/HOSTING-PLAN.md).' };
  if (!teamOrigin(env.ACCESS_TEAM_DOMAIN)) return { mode: 'misconfigured', why: 'ACCESS_TEAM_DOMAIN is not a valid https address.' };
  return { mode: 'access' };
}

/**
 * The signed-in person for a request. → { email } | { status, reason }
 */
export async function identify(request, env, { now = Date.now(), fetch: fetchImpl } = {}) {
  const url = new URL(request.url);
  const m = authMode(env, url);
  if (m.mode === 'misconfigured') return { status: 503, reason: 'The server is not configured: ' + m.why };
  if (m.mode === 'dev') {
    const cookie = Object.fromEntries(String(request.headers.get('cookie') || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
    const email = String(request.headers.get('x-dev-user') || cookie.dev_user || '').trim().toLowerCase();
    return EMAIL.test(email) ? { email } : { status: 401, reason: 'Sign in first (dev: send X-Dev-User).' };
  }
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { status: 401, reason: 'Sign in first.' };
  const v = await verifyAccessJwt(token, { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, now, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  return v.ok ? { email: v.email } : { status: 401, reason: 'Sign in first.', why: v.reason };
}
