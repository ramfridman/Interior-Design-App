/**
 * E7 House Designer — the Cloudflare Worker (the only Cloudflare-specific code lives in server/).
 *
 *  * Static site: dist/site (built by `node dev/build-site.mjs`) is served by Workers static assets, which applies its
 *    `_headers` file (CSP, noindex, cache rules). Only /api/* and the entry page run this script (`run_worker_first`).
 *  * REST + WebSocket API, the same as dev/collab-server.mjs (docs/CONTRACT.md § 13):
 *      GET /api/health · GET|POST /api/projects · GET|DELETE /api/projects/:id · GET|PUT /api/projects/:id/members
 *      GET|PUT /api/projects/:id/underlay · GET /api/projects/:id/versions/:vid · WebSocket GET /api/rooms/:id
 *  * Identity: Cloudflare Access only (./auth.js). No valid Access JWT → 401 on /api/*.
 *  * Roles per project (owner / editor / viewer) live in the ProjectIndex Durable Object and are enforced here on every
 *    REST route and on room join; the room (ProjectRoom DO wrapping src/collab/room.js) refuses viewers' changes.
 *
 * This script stays light (Workers Free: 10 ms CPU per request): large bodies (project records, pictures) are passed to
 * the Durable Object unparsed; the Worker parses only small JSON (index entries, members lists).
 */
import { identify } from './auth.js';
import { roleOf } from './index-do.js';
import { LIMITS } from '../../src/collab/ops.js';

export { ProjectRoom } from './room-do.js';
export { ProjectIndex } from './index-do.js';

const API_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'strict-origin-when-cross-origin' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: API_HEADERS });
const MAX_RECORD = 40 * 1024 * 1024;
const MAX_MEMBERS = 64 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/** Re-wrap a Durable Object's answer with the API headers (its body is streamed, never parsed here). */
const pass = (r) => new Response(r.body, { status: r.status, headers: API_HEADERS });
const newId = () => { const b = new Uint8Array(4); crypto.getRandomValues(b); return 'p_' + Date.now().toString(36) + [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); };

function indexStub(env) { return env.INDEX.get(env.INDEX.idFromName('index')); }
function roomStub(env, id) { return env.ROOMS.get(env.ROOMS.idFromName(id)); }
async function indexCall(env, path, body) {
  const r = await indexStub(env).fetch('https://index' + path, body ? { method: 'POST', body: JSON.stringify(body) } : {});
  return { status: r.status, body: r.status === 404 ? null : await r.json() };
}
function roomCall(env, id, path, { method = 'GET', email = '', role = '', meta = null, body = null, headers = {} } = {}) {
  const h = new Headers(headers);
  h.set('x-e7-project', id); h.set('x-e7-email', email); h.set('x-e7-role', role);
  if (meta) h.set('x-e7-meta', JSON.stringify(meta));
  return roomStub(env, id).fetch('https://room' + path, { method, headers: h, body });
}

/** Same-origin check for browser requests that change something, and for every WebSocket. */
function sameOrigin(request, url, required) {
  const o = request.headers.get('origin');
  if (!o) return !required;
  return o === url.origin;
}
const tooBig = (request, limit) => Number(request.headers.get('content-length') || 0) > limit;

async function readSmallJson(request, limit) {
  if (tooBig(request, limit)) return { error: json(413, { ok: false, reason: 'Too large.' }) };
  const text = await request.text();
  if (text.length > limit) return { error: json(413, { ok: false, reason: 'Too large.' }) };
  try { return { body: text ? JSON.parse(text) : {} }; } catch (e) { return { error: json(400, { ok: false, reason: 'Bad JSON.' }) }; }
}

export async function handleApi(request, env, url) {
  const who = await identify(request, env);
  const parts = url.pathname.split('/').filter(Boolean);   // ['api', …]
  if (who.status) return json(who.status, { ok: false, reason: who.reason });
  const email = who.email;
  if (parts[1] === 'health') return json(200, { ok: true, user: email, protocol: 1 });
  if (request.method !== 'GET' && request.method !== 'HEAD' && !sameOrigin(request, url, false)) return json(403, { ok: false, reason: 'Cross-site request refused.' });

  // ---- WebSocket: /api/rooms/:id
  if (parts[1] === 'rooms') {
    const id = parts[2];
    if (String(request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return json(426, { ok: false, reason: 'WebSocket expected.' });
    if (!sameOrigin(request, url, true)) return json(403, { ok: false, reason: 'Cross-site WebSocket refused.' });
    if (!id || !ID_RE.test(id) || parts.length !== 3) return json(404, { ok: false });
    const entry = (await indexCall(env, '/entry?id=' + encodeURIComponent(id))).body;
    const role = roleOf(entry, email);
    if (!role) return json(403, { ok: false, reason: 'No such project (or it was not shared with you).' });
    return roomCall(env, id, '/ws', { email, role, headers: { upgrade: 'websocket' } });
  }
  if (parts[1] !== 'projects') return json(404, { ok: false, reason: 'Not found.' });
  const id = parts[2], sub = parts[3];

  // ---- /api/projects
  if (!id) {
    if (request.method === 'GET') return pass(await indexStub(env).fetch('https://index/list?email=' + encodeURIComponent(email)));
    if (request.method === 'POST') {
      if (tooBig(request, MAX_RECORD)) return json(413, { ok: false, reason: 'Too large.' });
      const pid = newId();
      const made = await roomCall(env, pid, '/create', { method: 'POST', email, body: request.body, headers: { 'content-type': 'application/json' } });
      if (made.status !== 201) return pass(made);
      const { name, phase } = await made.json();
      const project = (await indexCall(env, '/create', { id: pid, owner: email, name, phase })).body;
      return json(201, { ok: true, id: pid, project });
    }
    return json(405, { ok: false });
  }
  if (!ID_RE.test(id) || parts.length > (sub === 'versions' ? 5 : 4)) return json(404, { ok: false, reason: 'Not found.' });
  const entry = (await indexCall(env, '/entry?id=' + encodeURIComponent(id))).body;
  const role = roleOf(entry, email);
  if (!entry || !role) return json(404, { ok: false, reason: 'No such project (or it was not shared with you).' });

  if (!sub) {
    if (request.method === 'GET') return pass(await roomCall(env, id, '/record', { email, role, meta: { name: entry.name, members: entry.members } }));
    if (request.method === 'DELETE') {
      if (role !== 'owner') return json(403, { ok: false, reason: 'Only the owner can delete the project.' });
      await indexCall(env, '/delete', { id });
      await roomCall(env, id, '/destroy', { method: 'POST', email, role });
      return json(200, { ok: true });
    }
    return json(405, { ok: false });
  }
  if (sub === 'members') {
    if (request.method === 'GET') return json(200, { members: entry.members, owner: entry.owner });
    if (request.method === 'PUT') {
      if (role !== 'owner') return json(403, { ok: false, reason: 'Only the owner can share the project.' });
      const { body, error } = await readSmallJson(request, MAX_MEMBERS);
      if (error) return error;
      const r = (await indexCall(env, '/members', { id, members: body.members || {} })).body;
      if (r && Object.keys(r.changes).length) await roomCall(env, id, '/roles', { method: 'POST', email, role, body: JSON.stringify({ changes: r.changes }) });
      return json(200, { ok: true, members: r ? r.members : entry.members });
    }
    return json(405, { ok: false });
  }
  if (sub === 'versions' && parts[4]) {          // what restoring this point would change (any member may look)
    if (request.method !== 'GET') return json(405, { ok: false });
    if (!ID_RE.test(parts[4])) return json(404, { ok: false, reason: 'No such restore point.' });
    return pass(await roomCall(env, id, '/version?vid=' + encodeURIComponent(parts[4]), { email, role }));
  }
  if (sub === 'underlay') {
    if (request.method === 'GET') return pass(await roomCall(env, id, '/underlay', { email, role }));
    if (request.method === 'PUT') {
      if (role === 'viewer') return json(403, { ok: false, reason: 'Viewers cannot change the sketch.' });
      if (tooBig(request, LIMITS.underlayBytes + 64 * 1024)) return json(413, { ok: false, reason: 'Too large.' });
      return pass(await roomCall(env, id, '/underlay', { method: 'PUT', email, role, body: request.body, headers: { 'content-type': 'application/json' } }));
    }
    return json(405, { ok: false });
  }
  return json(404, { ok: false, reason: 'Not found.' });
}

/**
 * The entry page: served from the assets with their `_headers`, and the CSP's connect-src gets this host's own
 * ws(s):// origin spelled out. CSP Level 3 browsers already allow a same-origin WebSocket under 'self'; older WebKit did
 * not, so the explicit origin costs nothing and removes the doubt.
 */
export async function entryPage(request, env, url) {
  const r = await env.ASSETS.fetch(request);
  const h = new Headers(r.headers);
  const csp = h.get('content-security-policy');
  if (csp) h.set('content-security-policy', csp.replace(/connect-src 'self'/, `connect-src 'self' ${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`));
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try { return await handleApi(request, env, url); } catch (e) { console.error('api', e && e.stack || e); return json(500, { ok: false, reason: 'Server error.' }); }
    }
    if (url.pathname === '/' || url.pathname === '/index.html') return entryPage(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
