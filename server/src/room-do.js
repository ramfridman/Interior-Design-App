/**
 * ProjectRoom — one Durable Object per online project. Wraps src/collab/room.js UNCHANGED (one source of truth with the
 * Node dev server). The DO's SQLite-backed storage is given to the room through its injected { get, put, delete }
 * (./kv.js, chunked). WebSockets use the Hibernation API: an idle room is evicted from memory and costs nothing; the
 * sockets stay open. When the next message arrives the constructor runs again, the room reloads from storage, and every
 * open socket is re-joined from its attachment ({ connId, email, role, cid }) — silently (no welcome is re-sent).
 * room.receive() calls are serialised on one promise chain.
 *
 * Only the Worker (src/worker.js) talks to this object; identity and role arrive in internal headers it set after
 * verifying Cloudflare Access (a Durable Object is not reachable from the Internet).
 *   x-e7-project  project id         x-e7-email  the person      x-e7-role  owner | editor | viewer
 * Internal routes: POST /create · GET /record · POST /destroy · POST /roles · GET|PUT /underlay · GET /version?vid= · GET /ws (upgrade)
 */
import { createRoom } from '../../src/collab/room.js';
import { LIMITS, PROTOCOL, sizeOf } from '../../src/collab/ops.js';
import { summarizeVersion } from '../../src/collab/version-summary.js';
import { chunkedKV } from './kv.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const ROLES = ['viewer', 'editor', 'owner'];
const TOUCH_MS = 30 * 1000;

export class ProjectRoom {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.room = null; this.projectId = null;
    this.chain = Promise.resolve();
    this.muted = false;
    this.lastTouch = 0;
    ctx.blockConcurrencyWhile(async () => {
      this.projectId = (await ctx.storage.get('meta:id')) || null;
      if (this.projectId && (await ctx.storage.get('r:head')) !== undefined) await this.open();
    });
  }

  /** Load the room (from storage, or seeded with `record`) and re-join every socket that survived hibernation. */
  async open(record = null) {
    const room = createRoom({ id: this.projectId, storage: chunkedKV(this.ctx.storage), record });
    await room.load();
    this.room = room;
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;
    this.muted = true;          // the clients already have everything: re-joining must not send them anything
    try {
      for (const ws of sockets) {
        const a = attachment(ws);
        if (!a) continue;
        room.join(this.conn(ws, a));
        if (a.cid) await room.receive(a.connId, JSON.stringify({ t: 'hello', v: PROTOCOL, cid: a.cid, since: room.seq }));
      }
    } finally { this.muted = false; }
  }
  conn(ws, a) {
    return { id: a.connId, email: a.email, role: a.role, send: (text) => { if (!this.muted) ws.send(text); }, close: () => { try { ws.close(4000, 'replaced'); } catch (e) { /* gone */ } } };
  }
  serial(fn) { const p = this.chain.then(fn, fn); this.chain = p.catch(() => {}); return p; }
  /** The room, loaded from storage if needed; null when this project was never created (or was deleted). */
  async ensure() {
    if (!this.room && this.projectId) await this.serial(async () => { if (!this.room && (await this.ctx.storage.get('r:head')) !== undefined) await this.open(); });
    return this.room;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const pid = request.headers.get('x-e7-project');
    if (pid && !this.projectId) { this.projectId = pid; await this.ctx.storage.put('meta:id', pid); }
    const email = request.headers.get('x-e7-email') || '';
    const role = request.headers.get('x-e7-role') || '';
    switch (url.pathname) {
      case '/create': return this.create(request, email);
      case '/ws': return this.accept(request, email, role);
    }
    if (!(await this.ensure())) return json(404, { ok: false, reason: 'No such project.' });
    const room = this.room;
    switch (url.pathname) {
      case '/record': {
        let meta = {};
        try { meta = JSON.parse(request.headers.get('x-e7-meta') || '{}'); } catch (e) { meta = {}; }
        const rec = room.record(), u = await room.getUnderlay();
        return json(200, { ...rec, name: rec.name || meta.name, role, members: meta.members || {}, underlay: rec.underlay && u ? { ...rec.underlay, image: u.data } : null });
      }
      case '/version': {
        const vid = url.searchParams.get('vid');
        const saved = room.listVersions().some((v) => v.id === vid) ? await chunkedKV(this.ctx.storage).get('version:' + vid) : null;
        return saved ? json(200, { ok: true, id: vid, ...summarizeVersion(room.doc(), saved) }) : json(404, { ok: false, reason: 'No such restore point.' });
      }
      case '/destroy': {
        for (const ws of this.ctx.getWebSockets()) { try { ws.close(4404, 'deleted'); } catch (e) { /* gone */ } }
        await this.chain;
        this.room = null;
        await this.ctx.storage.deleteAll();
        this.projectId = null;
        return json(200, { ok: true });
      }
      case '/roles': {
        const { changes } = await request.json();
        for (const [e, r] of Object.entries(changes || {})) {
          const next = ROLES.includes(r) ? r : null;
          room.setRole(e, next);
          for (const ws of this.ctx.getWebSockets()) {
            const a = attachment(ws);
            if (!a || a.email !== e) continue;
            if (next) ws.serializeAttachment({ ...a, role: next });
            else { try { ws.close(4403, 'removed'); } catch (err) { /* gone */ } }
          }
        }
        return json(200, { ok: true });
      }
      case '/underlay': {
        if (request.method === 'GET') { const u = await room.getUnderlay(); return u ? json(200, u) : json(404, { ok: false }); }
        if (request.method === 'PUT') {
          if (role === 'viewer' || !ROLES.includes(role)) return json(403, { ok: false, reason: 'Viewers cannot change the sketch.' });
          const text = await request.text();
          if (text.length > LIMITS.underlayBytes + 64 * 1024) return json(413, { ok: false, reason: 'Too large.' });
          let body; try { body = JSON.parse(text); } catch (e) { return json(400, { ok: false, reason: 'Bad JSON.' }); }
          if (typeof body.image !== 'string' || !/^data:image\/(jpeg|webp|png);base64,/.test(body.image) || body.image.length > LIMITS.underlayBytes) return json(400, { ok: false, reason: 'The sketch must be a JPEG / WebP / PNG under 4 MB.' });
          const meta = body.meta && typeof body.meta === 'object' && sizeOf(body.meta) < 4096 ? body.meta : {};
          const id = await this.serial(() => room.putUnderlay({ type: body.image.slice(5, body.image.indexOf(';')), data: body.image, meta }, { email, cid: typeof body.cid === 'string' ? body.cid.slice(0, 40) : 'server' }));
          this.touch(true);
          return json(200, { ok: true, id });
        }
        return json(405, { ok: false });
      }
    }
    return json(404, { ok: false });
  }

  /** Seed a new room from a project record (POST /api/projects). */
  async create(request, email) {
    const text = await request.text();
    let body; try { body = JSON.parse(text); } catch (e) { return json(400, { ok: false, reason: 'Bad JSON.' }); }
    const rec = body && body.record;
    if (!rec || !rec.basePlan || !rec.design || !Array.isArray(rec.design.items)) return json(400, { ok: false, reason: 'A project record is needed.' });
    if (this.room || (await this.ctx.storage.get('r:head')) !== undefined) return json(409, { ok: false, reason: 'Project exists.' });
    const { underlay, ...seed } = rec;
    await this.serial(() => this.open({ ...seed, id: this.projectId }));
    if (underlay && typeof underlay.image === 'string' && underlay.image.length <= LIMITS.underlayBytes && /^data:image\/(jpeg|webp|png);base64,/.test(underlay.image)) {
      const { image, ...meta } = underlay;
      await this.serial(() => this.room.putUnderlay({ type: image.slice(5, image.indexOf(';')), data: image, meta }, { email, cid: 'server' }));
    }
    return json(201, { ok: true, name: String(rec.name || 'Project').slice(0, 120), phase: rec.phase === 'draft' ? 'draft' : 'fixed' });
  }

  /** WebSocket upgrade: hibernatable socket, identity + role in its attachment. */
  async accept(request, email, role) {
    if (String(request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return json(426, { ok: false, reason: 'WebSocket expected.' });
    if (!email || !ROLES.includes(role)) return json(403, { ok: false });
    if (!(await this.ensure())) return json(404, { ok: false, reason: 'No such project.' });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const a = { connId: 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), email, role, cid: null };
    server.serializeAttachment(a);
    this.room.join(this.conn(server, a));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string') { try { ws.send(JSON.stringify({ t: 'error', code: 'invalid', reason: 'Text frames only.' })); } catch (e) { /* gone */ } return; }
    const room = await this.ensure();
    const a = attachment(ws);
    if (!room || !a) { try { ws.close(4404, 'gone'); } catch (e) { /* gone */ } return; }
    let hello = false;
    if (!a.cid && message.length < 4096 && message.includes('"hello"')) {
      try { const m = JSON.parse(message); if (m && m.t === 'hello' && typeof m.cid === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(m.cid)) { ws.serializeAttachment({ ...a, cid: m.cid }); hello = true; } } catch (e) { /* the room answers */ }
    }
    await this.serial(() => room.receive(a.connId, message));
    if (hello) this.touch(true);
    else if (message.startsWith('{"t":"ops"')) this.touch(false);
  }
  async webSocketClose(ws, code, reason) {
    const a = attachment(ws);
    if (a && this.room) await this.serial(() => this.room.leave(a.connId));
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch (e) { /* already closed */ }
    this.touch(true, ws);
  }
  async webSocketError(ws) { return this.webSocketClose(ws, 1006, 'error'); }

  /** Tell the project index who is in the room now / that the project changed (throttled). Never awaited. */
  touch(people, closing = null) {
    if (!this.env.INDEX || !this.projectId || !this.room) return;
    const t = Date.now();
    if (!people && t - this.lastTouch < TOUCH_MS) return;
    this.lastTouch = t;
    const doc = this.room.doc();
    const proj = doc.e.project || {}, plan = doc.e.plan || {};
    const body = { id: this.projectId, updatedAt: new Date(t).toISOString(), name: typeof proj.name === 'string' ? proj.name : undefined, phase: plan.phase === 'draft' ? 'draft' : plan.phase === 'fixed' ? 'fixed' : undefined };
    if (people) {
      const seen = new Map();
      for (const ws of this.ctx.getWebSockets()) { if (ws === closing) continue; const x = attachment(ws); if (x && x.cid && !seen.has(x.email)) seen.set(x.email, x.email); }
      const peers = this.room.peers().filter((p) => seen.has(p.email));
      body.people = [...new Map(peers.map((p) => [p.email, { email: p.email, name: p.name, color: p.color, role: p.role }])).values()];
    }
    const stub = this.env.INDEX.get(this.env.INDEX.idFromName('index'));
    const p = stub.fetch('https://index/touch', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.body && r.body.cancel && r.body.cancel(), () => {});
    if (this.ctx.waitUntil) this.ctx.waitUntil(p);
  }
}

function attachment(ws) { try { return ws.deserializeAttachment() || null; } catch (e) { return null; } }
