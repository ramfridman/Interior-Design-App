// The Cloudflare backend (server/): unit tests under Node, then the real Worker under `wrangler dev` (local mode,
// Miniflare / workerd — no Cloudflare account, no network once wrangler is installed):
//   npm ci --prefix server          (once: installs the pinned wrangler; dev-only, nothing ships to the browser)
//   node tests/collab.worker.test.mjs
//
// 1. Node: Access JWT verification with a locally generated RSA key pair (valid, expired, wrong audience, wrong
//    signature, wrong issuer, unknown key → refetch), auth modes (DEV_AUTH refused next to Access / in production / off
//    localhost), the chunked storage adapter, and ProjectRoom surviving HIBERNATION (constructor re-run with the same
//    storage and open sockets: room reloaded, sockets re-joined silently, ops keep flowing).
// 2. wrangler dev with DEV_AUTH=1: the two-browser scenario of tests/collab-scenario.mjs (same as the dev server's),
//    role enforcement on every REST route and on room join, cross-site refusal, live role changes, two rooms isolated,
//    and the room surviving a restart of the runtime (state reloaded from the persisted Durable Object storage).
// 3. wrangler dev with Access configured (team domain = a local key server): the real runtime verifies the JWT and
//    ignores every dev shortcut.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyAccessJwt, authMode, identify, clearKeyCache } from '../server/src/auth.js';
import { chunkedKV } from '../server/src/kv.js';
import { ProjectRoom } from '../server/src/room-do.js';
import { runCollabScenario } from './collab-scenario.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'server');
const shots = path.join(root, 'dev', 'screens');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log(`\n— ${t}`);
const RECORD = (name = 'Test house') => ({ name, phase: 'fixed', basePlan: { meta: { name } }, design: { items: [{ id: 'sofa1', type: 'sofa', name: 'Sofa', x: 100, y: 100, w: 200, d: 90, h: 80, rot: 0 }] } });

// ------------------------------------------------------------------ JWT helpers (local key pair)
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function makeKeys(kid) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}
function sign(key, claims, { kid = key.kid, alg = 'RS256' } = {}) {
  const head = b64u(JSON.stringify({ alg, kid, typ: 'JWT' })), body = b64u(JSON.stringify(claims));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), key.privateKey);
  return `${head}.${body}.${b64u(sig)}`;
}

async function unitTests() {
  section('Node: Access JWT verification');
  const K1 = makeKeys('k1'), K2 = makeKeys('k2'), EVIL = makeKeys('k1');
  const team = 'https://myteam.cloudflareaccess.com', aud = 'aud-tag-123';
  let served = [K1.jwk], fetches = 0;
  const fakeFetch = async (url) => { fetches++; if (url !== team + '/cdn-cgi/access/certs') throw new Error('wrong url ' + url); return { ok: true, json: async () => ({ keys: served }) }; };
  const now = Date.now(), t = Math.floor(now / 1000);
  const claims = (o = {}) => ({ aud: [aud], email: 'Alice@Example.com', exp: t + 3600, iat: t, nbf: t - 5, iss: team, sub: 'u1', ...o });
  const v = (tok, o = {}) => verifyAccessJwt(tok, { teamDomain: 'myteam.cloudflareaccess.com', aud, now, fetch: fakeFetch, ...o });
  clearKeyCache();
  let r = await v(sign(K1, claims()));
  check('valid token → email (lower-cased)', r.ok && r.email === 'alice@example.com', JSON.stringify(r.ok ? r.email : r));
  r = await v(sign(K1, claims({ exp: t - 3600 })));
  check('expired token refused', !r.ok && r.reason === 'expired', r.reason);
  r = await v(sign(K1, claims({ aud: ['someone-else'] })));
  check('wrong audience refused', !r.ok && r.reason === 'audience', r.reason);
  r = await v(sign(EVIL, claims()));
  check('wrong signature (same kid, other key) refused', !r.ok && r.reason === 'signature', r.reason);
  const good = sign(K1, claims()), parts = good.split('.');
  r = await v(`${parts[0]}.${b64u(JSON.stringify(claims({ email: 'mallory@example.com' })))}.${parts[2]}`);
  check('tampered payload refused', !r.ok && r.reason === 'signature', r.reason);
  r = await v(sign(K1, claims({ iss: 'https://other.cloudflareaccess.com' })));
  check('wrong issuer refused', !r.ok && r.reason === 'issuer', r.reason);
  r = await v(sign(K1, claims(), { alg: 'HS256' }));
  check('alg other than RS256 refused', !r.ok && r.reason === 'algorithm', r.reason);
  r = await v(sign(K1, claims({ email: undefined, common_name: 'svc' })));
  check('token without an email (service token) refused', !r.ok && r.reason === 'no-email', r.reason);
  r = await v('not.a.jwt');
  check('garbage refused', !r.ok);
  r = await v(sign(K1, claims()), { aud: '' });
  check('no AUD configured → refused', !r.ok && r.reason === 'access-not-configured');
  const before = fetches;
  served = [K1.jwk, K2.jwk];
  r = await verifyAccessJwt(sign(K2, claims()), { teamDomain: team, aud, now: now + 2 * 60 * 1000, fetch: fakeFetch });
  check('rotated key: unknown kid → key set refetched → valid', r.ok && fetches === before + 1, `fetches ${fetches - before}`);
  await v(sign(K1, claims()));
  check('key set cached between requests', fetches === before + 1);

  section('Node: auth modes');
  const local = new URL('http://localhost:8787/api/health'), remote = new URL('https://e7.example.workers.dev/api/health');
  check('DEV_AUTH on localhost → dev', authMode({ DEV_AUTH: '1' }, local).mode === 'dev');
  check('DEV_AUTH refused next to Access variables', authMode({ DEV_AUTH: '1', ACCESS_AUD: 'x', ACCESS_TEAM_DOMAIN: team }, local).mode === 'misconfigured');
  check('DEV_AUTH refused with PRODUCTION=1', authMode({ DEV_AUTH: '1', PRODUCTION: '1' }, local).mode === 'misconfigured');
  check('DEV_AUTH refused off localhost', authMode({ DEV_AUTH: '1' }, remote).mode === 'misconfigured');
  check('nothing configured → misconfigured (API answers 503, the app runs as without a backend)', authMode({}, remote).mode === 'misconfigured');
  check('http team domain refused unless localhost', authMode({ ACCESS_AUD: 'x', ACCESS_TEAM_DOMAIN: 'http://evil.example' }, remote).mode === 'misconfigured');
  const req = (h) => new Request('https://e7.example.workers.dev/api/health?as=bob@example.com', { headers: h });
  const env = { ACCESS_AUD: aud, ACCESS_TEAM_DOMAIN: team };
  let who = await identify(req({ 'x-dev-user': 'bob@example.com', 'cf-access-authenticated-user-email': 'bob@example.com', cookie: 'dev_user=bob@example.com' }), env, { now, fetch: fakeFetch });
  check('with Access configured, X-Dev-User / ?as= / dev cookie / the plain email header are ignored → 401', who.status === 401, JSON.stringify(who));
  who = await identify(req({ 'cf-access-jwt-assertion': sign(K1, claims()) }), env, { now, fetch: fakeFetch });
  check('with Access configured, a valid Cf-Access-Jwt-Assertion → the email', who.email === 'alice@example.com');

  section('Node: chunked storage');
  const fake = fakeStorage();
  const kv = chunkedKV(fake);
  const big = { s: 'x'.repeat(1_300_000), n: 1 };
  await kv.put('snap', big);
  check('a 1.3 MB value is split into pieces ≤ 512 K characters', [...fake.map.keys()].filter((k) => k.startsWith('r:snap#')).length === 3);
  check('…and read back whole', JSON.stringify(await kv.get('snap')) === JSON.stringify(big));
  await kv.put('snap', { small: true });
  check('overwriting with a small value removes the pieces', [...fake.map.keys()].filter((k) => k.startsWith('r:snap')).length === 1 && (await kv.get('snap')).small === true);
  await kv.delete('snap');
  check('delete', (await kv.get('snap')) === undefined && fake.map.size === 0);

  section('Node: ProjectRoom survives hibernation (constructor re-run, same storage and sockets)');
  await hibernationTest();
}

function fakeStorage() {
  const map = new Map();
  const cl = (v) => (v === undefined ? undefined : structuredClone(v));
  return {
    map,
    async get(k) { if (Array.isArray(k)) return new Map(k.filter((x) => map.has(x)).map((x) => [x, cl(map.get(x))])); return cl(map.get(k)); },
    async put(k, v) { if (typeof k === 'object') { for (const [a, b] of Object.entries(k)) map.set(a, cl(b)); } else map.set(k, cl(v)); },
    async delete(k) { for (const x of Array.isArray(k) ? k : [k]) map.delete(x); },
    async list({ prefix = '' } = {}) { return new Map([...map].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, cl(v)])); },
    async deleteAll() { map.clear(); },
  };
}
function fakeSocket() {
  let att = null;
  const ws = { sent: [], closed: null, send(t) { ws.sent.push(JSON.parse(t)); }, close(code) { ws.closed = code; }, serializeAttachment(a) { att = structuredClone(a); }, deserializeAttachment() { return att && structuredClone(att); } };
  return ws;
}
function fakeCtx(storage, sockets) {
  const ctx = { storage, ready: null, blockConcurrencyWhile(fn) { ctx.ready = fn(); return ctx.ready; }, getWebSockets: () => sockets, acceptWebSocket(ws) { sockets.push(ws); }, waitUntil() {} };
  return ctx;
}
async function hibernationTest() {
  // Node cannot make a 101 Response or a WebSocketPair: minimal stand-ins (the real ones are exercised under wrangler dev)
  const RealResponse = globalThis.Response;
  globalThis.Response = class extends RealResponse { constructor(b, init) { if (init && init.status === 101) { super(null, { status: 200 }); Object.defineProperty(this, 'status', { value: 101 }); this.webSocket = init.webSocket; } else super(b, init); } };
  globalThis.WebSocketPair = function () { const a = fakeSocket(), b = fakeSocket(); return { 0: a, 1: b }; };
  try {
    const storage = fakeStorage(), sockets = [];
    const H = (email, role) => ({ 'x-e7-project': 'p_test', 'x-e7-email': email, 'x-e7-role': role });
    let room = new ProjectRoom(fakeCtx(storage, sockets), {});
    await room.ctx.ready;
    let r = await room.fetch(new Request('https://room/create', { method: 'POST', headers: H('alice@example.com', 'owner'), body: JSON.stringify({ record: RECORD() }) }));
    check('room created from a project record', r.status === 201);
    await room.fetch(new Request('https://room/ws', { headers: { ...H('alice@example.com', 'owner'), upgrade: 'websocket' } }));
    await room.fetch(new Request('https://room/ws', { headers: { ...H('bob@example.com', 'editor'), upgrade: 'websocket' } }));
    const [wa, wb] = sockets;
    await room.webSocketMessage(wa, JSON.stringify({ t: 'hello', v: 1, cid: 'calice01' }));
    await room.webSocketMessage(wb, JSON.stringify({ t: 'hello', v: 1, cid: 'cbob0001' }));
    await room.webSocketMessage(wa, JSON.stringify({ t: 'ops', gid: 'calice01-1', base: 0, ops: [{ k: 'item:sofa1', s: { x: 333 } }] }));
    check('before hibernation: both welcomed, A acked, B got A\'s group', wa.sent.some((m) => m.t === 'welcome') && wa.sent.some((m) => m.t === 'ack' && m.seq === 1) && wb.sent.some((m) => m.t === 'ops' && m.seq === 1));
    // --- hibernate: in-memory state gone, constructor runs again with the same storage and the still-open sockets
    wa.sent.length = 0; wb.sent.length = 0;
    room = new ProjectRoom(fakeCtx(storage, sockets), {});
    await room.ctx.ready;
    check('after waking: the room was reloaded from storage (seq 1, the change is there)', room.room && room.room.seq === 1 && room.room.doc().e['item:sofa1'].x === 333);
    check('after waking: nothing was sent to the open sockets (no second welcome)', wa.sent.length === 0 && wb.sent.length === 0);
    check('after waking: both people are in the room again', room.room.peers().map((p) => p.email).sort().join() === 'alice@example.com,bob@example.com');
    await room.webSocketMessage(wb, JSON.stringify({ t: 'ops', gid: 'cbob0001-1', base: 1, ops: [{ k: 'item:sofa1', s: { y: 444 } }] }));
    check('after waking: B\'s change is acked with the next seq and reaches A', wb.sent.some((m) => m.t === 'ack' && m.seq === 2) && wa.sent.some((m) => m.t === 'ops' && m.seq === 2 && m.cid === 'cbob0001'));
    await room.webSocketMessage(wa, JSON.stringify({ t: 'ops', gid: 'calice01-1', base: 0, ops: [{ k: 'item:sofa1', s: { x: 333 } }] }));
    check('after waking: a re-sent group (lost ack) is recognised as a duplicate', wa.sent.some((m) => m.t === 'ack' && m.dup && m.seq === 1));
    await room.fetch(new Request('https://room/roles', { method: 'POST', headers: H('alice@example.com', 'owner'), body: JSON.stringify({ changes: { 'bob@example.com': 'viewer' } }) }));
    check('a role change reaches the open socket and its attachment', wb.sent.some((m) => m.t === 'role' && m.role === 'viewer') && wb.deserializeAttachment().role === 'viewer');
    wb.sent.length = 0;
    room = new ProjectRoom(fakeCtx(storage, sockets), {});
    await room.ctx.ready;
    await room.webSocketMessage(wb, JSON.stringify({ t: 'ops', gid: 'cbob0001-2', base: 2, ops: [{ k: 'item:sofa1', s: { y: 1 } }] }));
    check('the demoted role survives hibernation too (viewer\'s change refused)', wb.sent.some((m) => m.t === 'reject' && m.code === 'role'));
    r = await room.fetch(new Request('https://room/destroy', { method: 'POST', headers: H('alice@example.com', 'owner') }));
    check('destroy closes the sockets and empties the storage', r.status === 200 && wa.closed === 4404 && storage.map.size === 0);
  } finally { globalThis.Response = RealResponse; delete globalThis.WebSocketPair; }
}

// ------------------------------------------------------------------ wrangler dev
const wranglerBin = path.join(serverDir, 'node_modules', '.bin', 'wrangler');
function startWrangler(port, vars, persist) {
  const args = ['dev', '--local', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist, '--log-level', 'warn', '--show-interactive-dev-session=false'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1', CI: '1' };
  const child = spawn(wranglerBin, args, { cwd: serverDir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  return { child, log: () => log, async stop() { try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { /* gone */ } await new Promise((r) => { if (child.exitCode !== null) r(); else { child.once('exit', r); setTimeout(r, 5000); } }); try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* gone */ } } };
}
async function waitUp(base, w) {
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.status) return true; } catch (e) { /* not yet */ }
    if (w.child.exitCode !== null) break;
    await sleep(300);
  }
  console.log(w.log().slice(-2000));
  return false;
}

const H = (email, extra = {}) => ({ 'x-dev-user': email, 'content-type': 'application/json', ...extra });
async function call(base, email, method, p, body, extra) {
  const r = await fetch(`${base}/api/${p}`, { method, headers: email ? H(email, extra) : { 'content-type': 'application/json', ...(extra || {}) }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { j = null; }
  return { status: r.status, body: j };
}
/** A raw room socket from Node (undici WebSocket accepts headers). → { ws, msgs, wait(pred), send(obj), closed } */
function socket(base, id, email, { origin = base } = {}) {
  const url = base.replace(/^http/, 'ws') + '/api/rooms/' + id;
  const headers = { ...(email ? { 'x-dev-user': email } : {}), ...(origin ? { origin } : {}) };
  const ws = new WebSocket(url, { headers });
  const s = { ws, msgs: [], opened: false, failed: false, closed: null };
  ws.onopen = () => { s.opened = true; };
  ws.onerror = () => { s.failed = true; };
  ws.onclose = (e) => { s.closed = e.code; };
  ws.onmessage = (e) => { try { s.msgs.push(JSON.parse(e.data)); } catch (err) { /* not JSON */ } };
  s.send = (o) => ws.send(JSON.stringify(o));
  s.wait = async (pred, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = s.msgs.find(pred); if (m) return m; if (s.failed || s.closed) return null; await sleep(25); } return null; };
  s.until = async (cond, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(25); } return false; };
  return s;
}
async function joined(base, id, email, cid) {
  const s = socket(base, id, email);
  await s.until(() => s.opened || s.failed || s.closed !== null);
  if (!s.opened) return s;
  s.send({ t: 'hello', v: 1, cid });
  s.welcome = await s.wait((m) => m.t === 'welcome');
  return s;
}

async function restTests(base) {
  section('wrangler dev: identity and role enforcement on every REST route');
  const O = 'owner@example.com', E = 'editor@example.com', V = 'viewer@example.com', X = 'stranger@example.com';
  check('no identity → 401 on /api/health', (await call(base, null, 'GET', 'health')).status === 401);
  for (const [m, p] of [['GET', 'projects'], ['POST', 'projects'], ['GET', 'projects/p_x'], ['DELETE', 'projects/p_x'], ['GET', 'projects/p_x/members'], ['PUT', 'projects/p_x/members'], ['GET', 'projects/p_x/underlay'], ['PUT', 'projects/p_x/underlay'], ['GET', 'projects/p_x/versions/v1']]) {
    const r = await call(base, null, m, p, m === 'GET' || m === 'DELETE' ? undefined : {});
    if (r.status !== 401) check(`no identity → 401 on ${m} /api/${p}`, false, String(r.status));
  }
  check('no identity → 401 on every other /api route', true);
  const st = await fetch(base + '/src/main.js');
  check('static files are still served without identity (Access guards them in production)', st.status === 200 && /content-security-policy/i.test([...st.headers.keys()].join()));
  const home = await fetch(base + '/');
  const csp = home.headers.get('content-security-policy') || '';
  check('entry page: CSP from _headers, connect-src names this host\'s ws:// origin', /connect-src 'self' ws:\/\/127\.0\.0\.1:\d+/.test(csp) && /frame-ancestors 'none'/.test(csp), csp.match(/connect-src[^;]*/) && csp.match(/connect-src[^;]*/)[0]);
  check('health with identity', (await call(base, O, 'GET', 'health')).body.user === O);
  check('POST without a record → 400', (await call(base, O, 'POST', 'projects', { record: { name: 'x' } })).status === 400);
  check('cross-site POST refused', (await call(base, O, 'POST', 'projects', { record: RECORD() }, { origin: 'https://evil.example' })).status === 403);
  const made = await call(base, O, 'POST', 'projects', { record: RECORD('Roles house') });
  check('POST /api/projects → 201, creator is owner', made.status === 201 && made.body.project.role === 'owner' && made.body.project.owner === O, JSON.stringify(made.body));
  const id = made.body.id;
  const P = `projects/${id}`;
  let r = await call(base, O, 'PUT', P + '/members', { members: { [E]: 'editor', [V]: 'viewer', [O]: 'viewer', 'bad email': 'editor', 'x@example.com': 'owner' } });
  check('owner shares: editor + viewer; cannot demote themselves, no second owner, bad emails dropped', r.status === 200 && JSON.stringify(r.body.members) === JSON.stringify({ [O]: 'owner', [E]: 'editor', [V]: 'viewer' }), JSON.stringify(r.body));
  const expect = async (who, m, p, body, want, label) => { const x = await call(base, who, m, p, body); check(`${label || `${m} /api/${p.replace(id, ':id')}`} as ${who.split('@')[0]} → ${want}`, x.status === want, `${x.status} ${x.body && x.body.reason || ''}`); return x; };
  const lists = await Promise.all([O, E, V, X].map((w) => call(base, w, 'GET', 'projects')));
  check('GET /api/projects: members see it with their role, a stranger does not', lists.slice(0, 3).every((l, i) => l.body.some((p) => p.id === id && p.role === ['owner', 'editor', 'viewer'][i])) && !lists[3].body.some((p) => p.id === id));
  for (const w of [O, E, V]) await expect(w, 'GET', P, undefined, 200);
  await expect(X, 'GET', P, undefined, 404);
  for (const w of [O, E, V]) await expect(w, 'GET', P + '/members', undefined, 200);
  await expect(X, 'GET', P + '/members', undefined, 404);
  await expect(E, 'PUT', P + '/members', { members: { [X]: 'editor' } }, 403);
  await expect(V, 'PUT', P + '/members', { members: { [X]: 'editor' } }, 403);
  await expect(X, 'PUT', P + '/members', { members: { [X]: 'editor' } }, 404);
  for (const w of [O, E, V]) await expect(w, 'GET', P + '/underlay', undefined, 404, 'GET underlay (none yet)');
  await expect(X, 'GET', P + '/underlay', undefined, 404);
  const png = 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64');
  await expect(V, 'PUT', P + '/underlay', { image: png }, 403);
  await expect(X, 'PUT', P + '/underlay', { image: png }, 404);
  await expect(E, 'PUT', P + '/underlay', { image: 'data:text/html;base64,AAAA' }, 400, 'PUT underlay that is not a picture');
  await expect(E, 'PUT', P + '/underlay', { image: 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024 + 100) }, 400, 'PUT underlay just over 4 MB');
  await expect(E, 'PUT', P + '/underlay', { image: 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024 + 80 * 1024) }, 413, 'PUT underlay body over the upload limit');
  await expect(E, 'PUT', P + '/underlay', { image: png, meta: { opacity: 0.4 } }, 200);
  r = await call(base, V, 'GET', P + '/underlay');
  check('viewer reads the underlay the editor uploaded', r.status === 200 && r.body.data === png);
  r = await call(base, V, 'GET', P);
  check('the record carries the underlay picture, role and members', r.body.underlay && r.body.underlay.image === png && r.body.role === 'viewer' && r.body.members[O] === 'owner');
  for (const w of [O, V]) await expect(w, 'GET', P + '/versions/vnope', undefined, 404, 'GET versions/:unknown');
  await expect(X, 'GET', P + '/versions/vnope', undefined, 404);

  section('wrangler dev: room join, roles live, cross-site sockets');
  const xs = socket(base, id, X);
  await xs.until(() => xs.opened || xs.failed || xs.closed !== null);
  check('a stranger cannot open the room socket', !xs.opened);
  const evil = socket(base, id, O, { origin: 'https://evil.example' });
  await evil.until(() => evil.opened || evil.failed || evil.closed !== null);
  check('a cross-site WebSocket is refused', !evil.opened);
  const noorigin = socket(base, id, O, { origin: null });
  await noorigin.until(() => noorigin.opened || noorigin.failed || noorigin.closed !== null);
  check('a WebSocket without Origin is refused', !noorigin.opened);
  const so = await joined(base, id, O, 'cowner01'), se = await joined(base, id, E, 'ceditor1'), sv = await joined(base, id, V, 'cviewer1');
  check('owner / editor / viewer join with the server-side role', so.welcome && se.welcome && sv.welcome && so.welcome.you.role === 'owner' && se.welcome.you.role === 'editor' && sv.welcome.you.role === 'viewer');
  sv.send({ t: 'ops', gid: 'cviewer1-1', base: 0, ops: [{ k: 'item:sofa1', s: { x: 1 } }] });
  check('the viewer\'s change is refused by the room (role)', !!(await sv.wait((m) => m.t === 'reject' && m.code === 'role')));
  se.send({ t: 'ops', gid: 'ceditor1-1', base: se.welcome.seq, ops: [{ k: 'item:sofa1', s: { x: 777 } }] });
  check('the editor\'s change is acked and reaches the others', !!(await se.wait((m) => m.t === 'ack')) && !!(await so.wait((m) => m.t === 'ops' && m.cid === 'ceditor1')) && !!(await sv.wait((m) => m.t === 'ops' && m.cid === 'ceditor1')));
  r = await call(base, O, 'PUT', P + '/members', { members: { [E]: 'viewer', [V]: 'viewer' } });
  check('owner demotes the editor → the open socket is told at once', !!(await se.wait((m) => m.t === 'role' && m.role === 'viewer')));
  se.send({ t: 'ops', gid: 'ceditor1-2', base: 0, ops: [{ k: 'item:sofa1', s: { x: 2 } }] });
  check('…and their next change is refused', !!(await se.wait((m) => m.t === 'reject' && m.code === 'role')));
  r = await call(base, O, 'PUT', P + '/members', { members: { [E]: 'viewer' } });
  check('owner removes the viewer → told and disconnected', !!(await sv.wait((m) => m.t === 'error' && m.code === 'removed', 3000)) && await sv.until(() => sv.closed !== null, 5000));
  await expect(V, 'GET', P, undefined, 404, 'GET after removal');
  so.send({ t: 'version-create', name: 'Named point' });
  const vers = await so.wait((m) => m.t === 'versions' && m.list.some((x) => x.name === 'Named point'));
  check('a named restore point is created', !!vers);
  if (vers) {
    const vid = vers.list.find((x) => x.name === 'Named point').id;
    r = await call(base, E, 'GET', `${P}/versions/${vid}`);
    check('version summary: counts and what a restore would change', r.status === 200 && r.body.items === 1 && r.body.changes.total === 0, JSON.stringify(r.body));
  }
  for (const s of [so, se]) s.ws.close();

  section('wrangler dev: two rooms are isolated');
  const p1 = (await call(base, O, 'POST', 'projects', { record: RECORD('Room one') })).body.id;
  const p2 = (await call(base, O, 'POST', 'projects', { record: RECORD('Room two') })).body.id;
  const a1 = await joined(base, p1, O, 'ciso0001'), b1 = await joined(base, p1, O, 'ciso0002'), a2 = await joined(base, p2, O, 'ciso0003');
  a1.send({ t: 'ops', gid: 'ciso0001-1', base: 0, ops: [{ k: 'item:sofa1', s: { name: 'Only in room one' } }] });
  await b1.wait((m) => m.t === 'ops');
  await sleep(500);
  check('a change in room one reaches room one\'s other socket only', b1.msgs.some((m) => m.t === 'ops') && !a2.msgs.some((m) => m.t === 'ops' || (m.t === 'peer' && m.cid !== 'ciso0003')));
  const g1 = (await call(base, O, 'GET', 'projects/' + p1)).body, g2 = (await call(base, O, 'GET', 'projects/' + p2)).body;
  check('…and only room one\'s record has it', g1.design.items[0].name === 'Only in room one' && g2.design.items[0].name === 'Sofa', `${g1.design.items[0].name} / ${g2.design.items[0].name}`);
  for (const s of [a1, b1, a2]) s.ws.close();

  // a viewer can never delete; the owner can
  await expect(E, 'DELETE', P, undefined, 403);
  await expect(X, 'DELETE', P, undefined, 404);
  return { O, p1, seq1: g1.seq, roomsId: id };
}

async function restartTest(base, startAgain, state) {
  section('wrangler dev: the room survives a restart of the runtime (state reloaded from Durable Object storage)');
  const { O, p1 } = state;
  const s = await joined(base, p1, O, 'crestart1');
  for (let i = 0; i < 60; i++) s.send({ t: 'ops', gid: `crestart1-${i}`, base: s.welcome.seq + i, ops: [{ k: 'item:sofa1', s: { x: 1000 + i } }] });   // > 50 groups: a snapshot + log tail
  const ok = await s.until(() => s.msgs.filter((m) => m.t === 'ack' || m.t === 'reject').length >= 60, 15000);
  const acks = s.msgs.filter((m) => m.t === 'ack').length, rejects = s.msgs.filter((m) => m.t === 'reject');
  check(`60 groups sent: ${acks} acked, ${rejects.length} refused (rate limit 20/s, burst 60)`, ok && acks + rejects.length === 60 && rejects.every((m) => m.code === 'rate'));
  const lastX = 1000 + Math.max(...s.msgs.filter((m) => m.t === 'ack').map((m) => Number(m.gid.split('-')[1])));
  const seqBefore = (await call(base, O, 'GET', 'projects/' + p1)).body.seq;
  s.ws.close();
  const base2 = await startAgain();
  if (!base2) { check('wrangler dev restarted', false); return; }
  const rec = await call(base2, O, 'GET', 'projects/' + p1);
  check('after the restart: the project, its owner and its data are back', rec.status === 200 && rec.body.role === 'owner' && rec.body.design.items[0].x === lastX && rec.body.seq === seqBefore, `x=${rec.body && rec.body.design && rec.body.design.items[0].x} want ${lastX}, seq ${rec.body && rec.body.seq} want ${seqBefore}`);
  const s2 = await joined(base2, p1, O, 'crestart2');
  check('after the restart: a new socket is welcomed at the same seq', s2.welcome && s2.welcome.seq === seqBefore);
  s2.send({ t: 'ops', gid: 'crestart2-1', base: seqBefore, ops: [{ k: 'item:sofa1', s: { y: 5 } }] });
  check('after the restart: the sequence continues', !!(await s2.wait((m) => m.t === 'ack' && m.seq === seqBefore + 1)));
  s2.ws.close();
  const list = (await call(base2, O, 'GET', 'projects')).body;
  check('after the restart: the project index is intact', Array.isArray(list) && list.some((p) => p.id === p1 && p.role === 'owner'));
  return base2;
}

async function accessTests() {
  section('wrangler dev with Access configured: the real runtime verifies the JWT');
  const K = makeKeys('kreal'), aud = 'test-aud-tag';
  const certs = http.createServer((req, res) => { if (req.url === '/cdn-cgi/access/certs') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [K.jwk], public_cert: { kid: K.kid } })); } else { res.writeHead(404); res.end(); } });
  await new Promise((r) => certs.listen(0, '127.0.0.1', r));
  const team = `http://localhost:${certs.address().port}`;
  const port = 8900 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'e7-wrangler-access-'));
  const w = startWrangler(port, { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud }, persist);
  try {
    if (!(await waitUp(base, w))) { check('wrangler dev (Access) started', false); return; }
    const t = Math.floor(Date.now() / 1000);
    const c = (o = {}) => ({ aud: [aud], email: 'carol@example.com', exp: t + 600, iat: t, iss: team, ...o });
    const h = async (headers) => { const r = await fetch(base + '/api/health', { headers }); return { status: r.status, body: await r.json().catch(() => null) }; };
    let r = await h({ 'cf-access-jwt-assertion': sign(K, c()) });
    check('valid Access JWT → 200 with its email', r.status === 200 && r.body.user === 'carol@example.com', JSON.stringify(r));
    r = await h({ 'cf-access-jwt-assertion': sign(K, c({ exp: t - 600 })) });
    check('expired JWT → 401', r.status === 401);
    r = await h({ 'cf-access-jwt-assertion': sign(K, c({ aud: ['other'] })) });
    check('wrong audience → 401', r.status === 401);
    r = await h({ 'cf-access-jwt-assertion': sign(makeKeys('kreal'), c()) });
    check('wrong signature → 401', r.status === 401);
    r = await h({ 'x-dev-user': 'carol@example.com', 'cf-access-authenticated-user-email': 'carol@example.com', cookie: 'dev_user=carol@example.com' });
    check('dev shortcuts (X-Dev-User, plain email header, dev cookie) ignored → 401', r.status === 401);
    r = await fetch(base + '/api/health?as=carol@example.com');
    check('?as= ignored → 401', r.status === 401);
    const made = await fetch(base + '/api/projects', { method: 'POST', headers: { 'cf-access-jwt-assertion': sign(K, c()), 'content-type': 'application/json' }, body: JSON.stringify({ record: RECORD('Access house') }) });
    check('a signed-in person can put a project online', made.status === 201);
  } finally { await w.stop(); certs.close(); fs.rmSync(persist, { recursive: true, force: true }); }
}

async function main() {
  await unitTests();
  if (!fs.existsSync(wranglerBin)) { check('wrangler is installed (run: npm ci --prefix server)', false); return; }
  section('build the site');
  await new Promise((resolve, reject) => { const b = spawn(process.execPath, [path.join(root, 'dev', 'build-site.mjs')], { stdio: 'inherit' }); b.on('exit', (c) => (c ? reject(new Error('build failed')) : resolve())); });
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'e7-wrangler-'));
  const port = 8800 + Math.floor(Math.random() * 90);
  const base = `http://localhost:${port}`;     // DEV_AUTH works only on localhost
  let w = startWrangler(port, { DEV_AUTH: '1' }, persist);
  try {
    const t0 = Date.now();
    if (!(await waitUp(base, w))) { check('wrangler dev started', false); return; }
    console.log(`      wrangler dev (local) up in ${Date.now() - t0} ms on ${base}`);
    const state = await restTests(base.replace('localhost', '127.0.0.1'));
    section('wrangler dev: two browsers (the same scenario as the dev server test)');
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    try {
      await runCollabScenario({ BASE: base, browser, check, shots,
        pageUrl: (email, query) => `${base}/${query ? '?' + query.replace(/^&/, '') : ''}`,
        signIn: (context, email) => context.addCookies([{ name: 'dev_user', value: email, url: base }]),
        restHeaders: (email) => ({ 'x-dev-user': email }) });
    } finally { await browser.close(); }
    await restartTest(base.replace('localhost', '127.0.0.1'), async () => {
      await w.stop();
      w = startWrangler(port, { DEV_AUTH: '1' }, persist);
      return (await waitUp(base, w)) ? base.replace('localhost', '127.0.0.1') : null;
    }, state);
  } finally { await w.stop(); fs.rmSync(persist, { recursive: true, force: true }); }
  await accessTests();
}

main().catch((e) => { console.error(e); failed++; }).finally(() => { console.log(failed ? `\n${failed} check(s) failed` : '\nALL OK'); process.exit(failed ? 1 : 0); });
