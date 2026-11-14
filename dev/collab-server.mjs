// Zero-dependency dev server for LIVE COLLABORATION (docs/CONTRACT.md § 13):
//   node dev/collab-server.mjs [port] [--data <dir>]
// Serves the app like dev/serve.mjs, hosts rooms (src/collab/room.js) at  ws://…/api/rooms/:projectId  and the REST calls
// the online storage adapter needs. Identity mimics Cloudflare Access: the `Cf-Access-Authenticated-User-Email` header, or
// in dev `X-Dev-User`, or `?as=name@example.com` on any request (remembered in a `dev_user` cookie for the page's later
// fetches and its WebSocket). Without any of these the user is dev@example.com. Storage: JSON files under a temp dir.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRoom } from '../src/collab/room.js';
import { LIMITS, sizeOf } from '../src/collab/ops.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || 5180);
const dataDir = args.includes('--data') ? path.resolve(args[args.indexOf('--data') + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'e7-collab-'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.ico': 'image/x-icon' };
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}$/;
const ROLES = ['viewer', 'editor', 'owner'];

// ---------------------------------------------------------------- file storage
const safe = (s) => encodeURIComponent(s).replace(/%/g, '_');
/** Async key-value storage for one room: one JSON file per key. */
function fileKV(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (k) => path.join(dir, safe(k) + '.json');
  return {
    async get(k) { try { return JSON.parse(await fsp.readFile(file(k), 'utf8')); } catch (e) { return undefined; } },
    async put(k, v) { const f = file(k), tmp = f + '.' + process.pid + '.tmp'; await fsp.writeFile(tmp, JSON.stringify(v)); await fsp.rename(tmp, f); },
    async delete(k) { try { await fsp.unlink(file(k)); } catch (e) { /* gone */ } },
  };
}
const registryFile = path.join(dataDir, 'projects.json');
let registry = {};
try { registry = JSON.parse(fs.readFileSync(registryFile, 'utf8')); } catch (e) { registry = {}; }
const saveRegistry = () => fsp.writeFile(registryFile, JSON.stringify(registry, null, 1));

const rooms = new Map();   // id → Promise<{ room, chain, sockets: Set }>
function roomFor(id, seed = null) {
  if (!rooms.has(id)) rooms.set(id, (async () => {
    const room = createRoom({ id, storage: fileKV(path.join(dataDir, 'rooms', safe(id))), record: seed });
    await room.load();
    return { room, chain: Promise.resolve(), sockets: new Set() };
  })());
  return rooms.get(id);
}
/** Run room work one message at a time (a Durable Object does this for free). */
const serial = (r, fn) => (r.chain = r.chain.then(fn, fn));

// ---------------------------------------------------------------- identity
function identity(req, url) {
  const cookie = Object.fromEntries(String(req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
  const cand = req.headers['cf-access-authenticated-user-email'] || req.headers['x-dev-user'] || url.searchParams.get('as') || cookie.dev_user || 'dev@example.com';
  const email = String(cand).trim().toLowerCase();
  return EMAIL.test(email) ? email : null;
}
const roleOf = (p, email) => (p && p.members && ROLES.includes(p.members[email]) ? p.members[email] : null);

// ---------------------------------------------------------------- http helpers
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
    req.on('error', reject);
  });
}
const newId = () => 'p_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const summary = (p, email) => ({ id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, phase: p.phase || 'fixed', owner: p.owner, role: roleOf(p, email), online: true });

async function api(req, res, url, email) {
  const parts = url.pathname.split('/').filter(Boolean);   // ['api', …]
  if (parts[1] === 'health') return json(res, 200, { ok: true, user: email, protocol: 1 });
  if (!email) return json(res, 401, { ok: false, reason: 'Sign in first.' });
  if (parts[1] !== 'projects') return json(res, 404, { ok: false, reason: 'Not found.' });
  const id = parts[2], sub = parts[3], p = id ? registry[id] : null;
  if (!id) {
    if (req.method === 'GET') return json(res, 200, Object.values(registry).filter((x) => roleOf(x, email)).map((x) => summary(x, email)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
    if (req.method === 'POST') {
      const body = await readBody(req, 40 * 1024 * 1024);
      const rec = body.record;
      if (!rec || !rec.basePlan || !rec.design || !Array.isArray(rec.design.items)) return json(res, 400, { ok: false, reason: 'A project record is needed.' });
      const pid = newId(), at = new Date().toISOString();
      const { underlay, ...seed } = rec;
      registry[pid] = { id: pid, name: String(rec.name || 'Project').slice(0, 120), owner: email, members: { [email]: 'owner' }, createdAt: at, updatedAt: at, phase: rec.phase === 'draft' ? 'draft' : 'fixed' };
      await saveRegistry();
      const r = await roomFor(pid, { ...seed, id: pid });
      if (underlay && typeof underlay.image === 'string' && underlay.image.length <= LIMITS.underlayBytes) {
        const { image, ...meta } = underlay;
        await serial(r, () => r.room.putUnderlay({ type: image.slice(5, image.indexOf(';')), data: image, meta }, { email, cid: 'server' }));
      }
      return json(res, 201, { ok: true, id: pid, project: summary(registry[pid], email) });
    }
    return json(res, 405, { ok: false });
  }
  const role = roleOf(p, email);
  if (!p || !role) return json(res, 404, { ok: false, reason: 'No such project (or it was not shared with you).' });
  const r = await roomFor(id);
  if (!sub) {
    if (req.method === 'GET') { const rec = r.room.record(); const u = await r.room.getUnderlay(); return json(res, 200, { ...rec, name: rec.name || p.name, role, members: p.members, underlay: rec.underlay && u ? { ...rec.underlay, image: u.data } : null }); }
    if (req.method === 'DELETE') {
      if (role !== 'owner') return json(res, 403, { ok: false, reason: 'Only the owner can delete the project.' });
      for (const s of r.sockets) s.close(4404, 'deleted');
      rooms.delete(id); delete registry[id]; await saveRegistry();
      await fsp.rm(path.join(dataDir, 'rooms', safe(id)), { recursive: true, force: true });
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { ok: false });
  }
  if (sub === 'members') {
    if (req.method === 'GET') return json(res, 200, { members: p.members, owner: p.owner });
    if (req.method === 'PUT') {
      if (role !== 'owner') return json(res, 403, { ok: false, reason: 'Only the owner can share the project.' });
      const body = await readBody(req, 64 * 1024);
      const next = { [p.owner]: 'owner' };
      for (const [m, rl] of Object.entries(body.members || {})) { const e = String(m).trim().toLowerCase(); if (EMAIL.test(e) && e !== p.owner && ROLES.includes(rl) && rl !== 'owner') next[e] = rl; }
      const before = p.members; p.members = next; await saveRegistry();
      for (const e of new Set([...Object.keys(before), ...Object.keys(next)])) if (before[e] !== next[e]) r.room.setRole(e, next[e] || null);
      return json(res, 200, { ok: true, members: next });
    }
    return json(res, 405, { ok: false });
  }
  if (sub === 'underlay') {
    if (req.method === 'GET') { const u = await r.room.getUnderlay(); return u ? json(res, 200, u) : json(res, 404, { ok: false }); }
    if (req.method === 'PUT') {
      if (role === 'viewer') return json(res, 403, { ok: false, reason: 'Viewers cannot change the sketch.' });
      const body = await readBody(req, LIMITS.underlayBytes + 64 * 1024);
      if (typeof body.image !== 'string' || !/^data:image\/(jpeg|webp|png);base64,/.test(body.image) || body.image.length > LIMITS.underlayBytes) return json(res, 400, { ok: false, reason: 'The sketch must be a JPEG / WebP / PNG under 4 MB.' });
      const meta = body.meta && typeof body.meta === 'object' && sizeOf(body.meta) < 4096 ? body.meta : {};
      const assetId = await serial(r, () => r.room.putUnderlay({ type: body.image.slice(5, body.image.indexOf(';')), data: body.image, meta }, { email, cid: typeof body.cid === 'string' ? body.cid.slice(0, 40) : 'server' }));
      return json(res, 200, { ok: true, id: assetId });
    }
  }
  return json(res, 404, { ok: false });
}

// ---------------------------------------------------------------- WebSocket (RFC 6455, text frames only)
function upgrade(req, socket, head, onOpen) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0), frag = [], fragOp = 0, closed = false;
  const MAX = LIMITS.groupBytes + 64 * 1024;
  const ws = {
    onmessage: null, onclose: null,
    send(text) {
      if (closed) return;
      const data = Buffer.from(text, 'utf8'), n = data.length;
      const hdr = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127, 0, 0, 0, 0]), Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])]);
      socket.write(Buffer.concat([hdr, data]));
    },
    close(code = 1000, reason = '') {
      if (closed) return;
      const r = Buffer.from(reason); socket.write(Buffer.concat([Buffer.from([0x88, 2 + r.length, code >> 8, code & 255]), r]));
      finish();
    },
  };
  const finish = () => { if (closed) return; closed = true; socket.end(); if (ws.onclose) ws.onclose(); };
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (!masked || len > MAX) { ws.close(1009, 'too big'); return; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4), data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      if (op === 0x8) { finish(); return; }
      if (op === 0x9) { socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data.subarray(0, 125)])); continue; }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x2) { frag = [data]; fragOp = op; } else if (op === 0x0) frag.push(data); else continue;
      if (frag.reduce((s, b) => s + b.length, 0) > MAX) { ws.close(1009, 'too big'); return; }
      if (fin) { const text = Buffer.concat(frag).toString('utf8'); frag = []; if (fragOp === 0x1 && ws.onmessage) ws.onmessage(text); }
    }
  });
  socket.on('close', finish);
  socket.on('error', finish);
  onOpen(ws);
}

let connN = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const email = identity(req, url);
  const setCookie = url.searchParams.get('as') && email ? { 'set-cookie': `dev_user=${encodeURIComponent(email)}; Path=/; SameSite=Lax` } : {};
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url, email); } catch (e) { json(res, e.status || 500, { ok: false, reason: e.status === 413 ? 'Too large.' : 'Server error.' }); }
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found: ' + p); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', ...setCookie });
    res.end(data);
  });
});

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]{1,80})$/);
  const email = identity(req, url);
  const p = m && registry[m[1]], role = roleOf(p, email);
  if (!m || !email || !role) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const r = await roomFor(m[1]);
  upgrade(req, socket, head, (ws) => {
    const id = 'k' + (++connN);
    r.sockets.add(ws);
    r.room.join({ id, email, role: roleOf(registry[m[1]], email) || 'viewer', send: (text) => ws.send(text), close: () => ws.close(4000, 'replaced') });
    ws.onmessage = (text) => serial(r, async () => { await r.room.receive(id, text); if (registry[m[1]]) registry[m[1]].updatedAt = new Date().toISOString(); });
    ws.onclose = () => { r.sockets.delete(ws); serial(r, () => r.room.leave(id)); };
  });
});

setInterval(() => { saveRegistry().catch(() => {}); }, 30000).unref();
server.listen(port, () => console.log(`Collaboration dev server: http://localhost:${port}  (data: ${dataDir})`));
