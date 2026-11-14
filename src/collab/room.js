/**
 * LIVE COLLABORATION — one project's room: the authoritative doc, the sequence, a bounded op log, snapshots, presence
 * fan-out, roles, limits and restore points. Pure JS (no Node / Cloudflare APIs, no timers): the dev server
 * (dev/collab-server.mjs) and a Durable Object host it unchanged. See docs/CONTRACT.md § 13.
 *
 *   const room = createRoom({ id, storage, now: () => Date.now() });
 *   await room.load();
 *   room.join({ id: connId, email, name, role, send: (text) => ws.send(text) });
 *   await room.receive(connId, text);       // every frame from that connection (JSON text)
 *   room.leave(connId);
 *
 * storage: async key-value { get(key) → value | undefined, put(key, value), delete(key) } with JSON-able values.
 * Keys: 'head' { seq, snapSeq, createdAt, autoAt, autoSeq }, 'snap' { seq, doc }, 'log:<seq>' { seq, gid, cid, by, ops,
 * label, at }, 'versions' [{ id, name, auto, at, by, seq }], 'version:<id>' doc, 'asset:underlay' { id, type, data }.
 */
import { PROTOCOL, LIMITS, emptyDoc, applyGroup, validateOps, diffDocs, applyOps, docToRecord, recordToDoc, sizeOf, keysOf } from './ops.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const ROLES = ['viewer', 'editor', 'owner'];
const COLORS = ['#e4572e', '#2e86ab', '#8e44ad', '#16a085', '#d35400', '#c0392b', '#2c3e50', '#27ae60', '#b8860b', '#e84393'];

export const ROOM_DEFAULTS = Object.freeze({
  logSize: 500,              // groups kept for catching up; further behind → the whole doc
  snapEvery: 50,             // write the snapshot every N groups (the log covers the rest)
  autoVersionQuietMs: 10 * 60 * 1000,
  autoVersionEvery: 200,
  autoVersionsKept: 20,
  rate: { ops: [20, 60], tx: [40, 80], presence: [15, 30], other: [5, 20] },   // [per second, burst]
  presenceStaleMs: 5000,
});

/** Initials for an avatar from an email / name. */
export const initialsOf = (s) => {
  const base = String(s || '?').split('@')[0].replace(/[^A-Za-z0-9]+/g, ' ').trim();
  const parts = base.split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : (parts[0] || '')[1] || '')).toUpperCase();
};
const nameOf = (email) => { const local = String(email).split('@')[0].replace(/[._-]+/g, ' ').trim(); return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()) : String(email); };
const colorOf = (email) => { let h = 0; for (const c of String(email)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };

/**
 * @param {{ id: string, storage: object, now?: () => number, limits?: object, record?: object }} o
 *   `record` (§ 10 project record) seeds a new room when storage holds nothing.
 */
export function createRoom({ id, storage, now = () => Date.now(), limits = {}, record = null } = {}) {
  const L = { ...ROOM_DEFAULTS, ...limits, rate: { ...ROOM_DEFAULTS.rate, ...(limits.rate || {}) } };
  let doc = emptyDoc(), seq = 0, head = null, log = [], versions = [];
  let writes = Promise.resolve();
  const conns = new Map();   // connId → { conn, cid, email, name, role, color, buckets, presence, seenAt, joined }

  const persist = (fn) => { writes = writes.then(fn).catch(() => { /* reported by the host's storage */ }); return writes; };
  const send = (c, msg) => { try { c.conn.send(JSON.stringify(msg)); } catch (e) { /* closed */ } };
  const broadcast = (msg, except) => { const text = JSON.stringify(msg); for (const c of conns.values()) if (c !== except && c.joined) { try { c.conn.send(text); } catch (e) { /* closed */ } } };
  const peerOf = (c) => ({ cid: c.cid, email: c.email, name: c.name, color: c.color, role: c.role });

  /** Token bucket without timers: refilled from the clock on every message. */
  function allow(c, kind) {
    const [rate, burst] = L.rate[kind] || L.rate.other, t = now();
    const b = c.buckets[kind] || (c.buckets[kind] = { tokens: burst, at: t });
    b.tokens = Math.min(burst, b.tokens + ((t - b.at) / 1000) * rate); b.at = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1; return true;
  }

  async function writeHead() { await storage.put('head', head); }

  const api = {
    id,
    /** Read the room from storage (or seed it from `record`). Call once before anything else. */
    async load() {
      head = await storage.get('head');
      if (!head) {
        doc = record ? recordToDoc(record) : emptyDoc();
        seq = 0;
        head = { seq: 0, snapSeq: 0, createdAt: now(), autoAt: 0, autoSeq: 0 };
        await storage.put('snap', { seq: 0, doc });
        await writeHead();
      } else {
        const snap = await storage.get('snap');
        doc = snap ? snap.doc : emptyDoc(); seq = snap ? snap.seq : 0;
        for (let s = seq + 1; s <= head.seq; s++) {               // replay the log written after the snapshot
          const g = await storage.get('log:' + s);
          if (!g) break;
          applyOps(doc, g.ops, [g.seq, g.cid], g.g); seq = g.seq; log.push(g);
        }
        for (let s = Math.max(1, head.seq - L.logSize + 1); s <= head.snapSeq; s++) { const g = await storage.get('log:' + s); if (g) log.push(g); }
        log.sort((a, b) => a.seq - b.seq);
      }
      versions = (await storage.get('versions')) || [];
      return api;
    },
    get seq() { return seq; },
    /** Current doc (read-only use). */
    doc: () => doc,
    /** The project record (§ 10 shape) of the current state — for the REST GET and exports. */
    record: () => ({ id, ...docToRecord(doc), updatedAt: new Date(now()).toISOString(), seq }),
    /** Connections (for the host: count, who). */
    peers: () => [...conns.values()].filter((c) => c.joined).map(peerOf),

    /** A connection opened. `conn = { id, email, name?, role, send(text) }` — identity comes from the server only. */
    join(conn) {
      const role = ROLES.includes(conn.role) ? conn.role : 'viewer';
      conns.set(conn.id, { conn, cid: null, email: conn.email, name: conn.name || nameOf(conn.email), role, color: colorOf(conn.email), buckets: {}, presence: null, seenAt: now(), joined: false });
    },
    /** A connection closed. */
    leave(connId) {
      const c = conns.get(connId);
      if (!c) return;
      conns.delete(connId);
      if (c.joined) broadcast({ t: 'peer', ...peerOf(c), left: true });
    },
    /** Membership changed (owner edited the members list): live connections get the new role at once. */
    setRole(email, role) {
      for (const c of conns.values()) if (c.email === email) {
        if (!ROLES.includes(role)) { send(c, { t: 'error', code: 'removed', reason: 'You no longer have access to this project.' }); continue; }
        c.role = role; send(c, { t: 'role', role });
        if (c.joined) broadcast({ t: 'peer', ...peerOf(c) }, c);
      }
    },
    /** Store a new underlay picture (REST) and announce it as an op group by `email`. */
    async putUnderlay({ type, data, meta }, by = { email: 'server', cid: 'server' }) {
      const assetId = 'u' + now().toString(36) + Math.random().toString(36).slice(2, 6);
      await storage.put('asset:underlay', { id: assetId, type, data });
      const next = { opacity: 0.5, visible: true, ...(doc.e.underlay || {}), ...(meta || {}), img: assetId };
      delete next.image;
      await commitServerGroup([{ k: 'underlay', p: next }], by, 'Sketch underlay');
      return assetId;
    },
    async getUnderlay() { return (await storage.get('asset:underlay')) || null; },

    /** One frame from a connection. Never throws. */
    async receive(connId, text) {
      const c = conns.get(connId);
      if (!c) return;
      let m;
      if (typeof text !== 'string' || text.length > LIMITS.groupBytes + 4096) { send(c, { t: 'error', code: 'size', reason: 'Message too large.' }); return; }
      try { m = JSON.parse(text); } catch (e) { send(c, { t: 'error', code: 'invalid', reason: 'Not JSON.' }); return; }
      if (!m || typeof m.t !== 'string') return;
      c.seenAt = now();
      try { await handle(c, m, text.length); } catch (e) { send(c, { t: 'error', code: 'internal', reason: 'The server could not handle that message.' }); }
    },

    /** Restore points. */
    listVersions: () => versions.map((v) => ({ ...v })),
    /** Wait until every storage write so far has finished (tests, shutdown). */
    flush: () => writes,
  };

  async function handle(c, m, size) {
    if (m.t === 'hello') return hello(c, m);
    if (!c.joined) { send(c, { t: 'error', code: 'hello', reason: 'Say hello first.' }); return; }
    switch (m.t) {
      case 'ping': send(c, { t: 'pong' }); return;
      case 'presence': {
        if (size > LIMITS.txBytes || !allow(c, 'presence')) return;       // dropped silently: presence is lossy
        c.presence = sanitizePresence(m.p);
        broadcast({ t: 'presence', cid: c.cid, p: c.presence }, c);
        return;
      }
      case 'tx': {
        if (c.role === 'viewer' || size > LIMITS.txBytes || !Array.isArray(m.ops) || !allow(c, 'tx')) return;
        if (validateOps(m.ops)) return;
        broadcast({ t: 'tx', cid: c.cid, ops: m.ops }, c);
        return;
      }
      case 'tx-end': broadcast({ t: 'tx-end', cid: c.cid }, c); return;
      case 'ops': return ops(c, m, size);
      case 'versions': send(c, { t: 'versions', list: api.listVersions() }); return;
      case 'version-create': {
        if (c.role === 'viewer') { send(c, { t: 'error', code: 'role', reason: 'Viewers cannot create restore points.' }); return; }
        if (!allow(c, 'other')) return;
        await createVersion(String(m.name || '').slice(0, 80) || 'Restore point', false, c.email);
        broadcast({ t: 'versions', list: api.listVersions() });
        return;
      }
      case 'version-restore': {
        if (c.role === 'viewer') { send(c, { t: 'error', code: 'role', reason: 'Viewers cannot restore.' }); return; }
        if (!allow(c, 'other')) return;
        const v = versions.find((x) => x.id === m.id);
        const saved = v && await storage.get('version:' + v.id);
        if (!saved) { send(c, { t: 'error', code: 'invalid', reason: 'No such restore point.' }); return; }
        const ops = diffDocs(doc, saved);
        if (ops.length) await commitServerGroup(ops, { email: c.email, cid: c.cid }, `Restored “${v.name}”`, m.gid);
        send(c, { t: 'restored', id: v.id, gid: m.gid || null, changes: ops.length });
        return;
      }
      default: return;
    }
  }

  function hello(c, m) {
    if (c.joined) return;
    if (m.v !== undefined && m.v !== PROTOCOL) { send(c, { t: 'error', code: 'version', reason: 'Please reload the page: the app was updated.' }); return; }
    c.cid = typeof m.cid === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(m.cid) ? m.cid : 'c' + Math.random().toString(36).slice(2, 10);
    for (const other of conns.values()) if (other !== c && other.cid === c.cid && other.joined) { other.joined = false; try { other.conn.close?.(); } catch (e) { /* gone */ } conns.delete(other.conn.id); }
    c.joined = true;
    const you = { cid: c.cid, ...peerOf(c) };
    const peers = [...conns.values()].filter((x) => x.joined && x !== c).map((x) => ({ ...peerOf(x), p: x.presence }));
    const since = Number.isInteger(m.since) ? m.since : -1;
    const first = log.length ? log[0].seq : seq + 1;
    if (since >= 0 && since <= seq && since >= first - 1) send(c, { t: 'welcome', you, seq, ops: log.filter((g) => g.seq > since).map(wire), peers });
    else send(c, { t: 'welcome', you, seq, doc, peers });
    broadcast({ t: 'peer', ...peerOf(c) }, c);
  }

  const wire = (g) => ({ t: 'ops', seq: g.seq, gid: g.gid, cid: g.cid, by: g.by, ops: g.ops, g: g.g, label: g.label });

  async function ops(c, m, size) {
    const gid = typeof m.gid === 'string' ? m.gid.slice(0, 64) : null;
    const reject = (code, reason, keys) => send(c, { t: 'reject', gid, code, reason, ...(keys ? { keys } : {}) });
    if (!gid) return reject('invalid', 'A group needs an id.');
    const dup = log.find((g) => g.gid === gid && g.cid === c.cid);   // re-sent after a lost ack (reconnect)
    if (dup) { send(c, { t: 'ack', gid, seq: dup.seq, ops: dup.ops, g: dup.g, dup: true }); return; }
    if (c.role === 'viewer') return reject('role', 'You can view this project but not change it.');
    if (size > LIMITS.groupBytes) return reject('size', 'This change is too large to share (over 1 MB).');
    if (!allow(c, 'ops')) return reject('rate', 'Too many changes at once — slow down a little.');
    const bad = validateOps(m.ops);
    if (bad) return reject('invalid', `The change was not understood (${bad}).`);
    const base = Number.isInteger(m.base) ? Math.min(m.base, seq) : 0;
    const trial = { e: doc.e, v: doc.v };
    // dry-run on a shallow copy so a refused group never touches the doc
    const probe = { e: { ...trial.e }, v: { ...trial.v } };
    const res = applyGroup(probe, m.ops, { seq: seq + 1, cid: c.cid, base });
    if (!res.ok) return reject('conflict', 'Someone else changed this at the same time.', res.keys);
    if (sizeOf(probe.e) > LIMITS.docBytes) return reject('size', 'The project would become too large.');
    doc = probe;
    await accept(c.cid, { email: c.email, name: c.name }, gid, res.effective, typeof m.label === 'string' ? m.label.slice(0, 80) : '', c, res.guards);
  }

  /** Log, persist, broadcast an accepted group (`origin` = the sending connection, which gets an ack). */
  async function accept(cid, by, gid, effective, label, origin, guards = []) {
    seq += 1;
    const g = { seq, gid, cid, by: { email: by.email, name: by.name || nameOf(by.email) }, ops: effective, g: guards, label, at: now() };
    log.push(g);
    if (log.length > L.logSize) log.splice(0, log.length - L.logSize);
    if (origin) send(origin, { t: 'ack', gid, seq, ops: effective, g: guards });
    broadcast(wire(g), origin);
    head.seq = seq;
    const snapNow = seq - head.snapSeq >= L.snapEvery;
    const snapDoc = snapNow ? clone(doc) : null;
    const dropFrom = seq - L.logSize;
    persist(async () => {
      await storage.put('log:' + g.seq, g);
      if (snapDoc) { await storage.put('snap', { seq: g.seq, doc: snapDoc }); head.snapSeq = g.seq; }
      if (dropFrom > 0 && dropFrom <= head.snapSeq) await storage.delete('log:' + dropFrom);
      await writeHead();
    });
    // automatic restore point: the first change after a quiet spell, or every N groups
    if (now() - (head.lastAt || 0) > L.autoVersionQuietMs || seq - (head.autoSeq || 0) >= L.autoVersionEvery) {
      head.autoSeq = seq;
      await createVersion(`Automatic — ${new Date(now()).toISOString().slice(0, 16).replace('T', ' ')} UTC`, true, by.email);
    }
    head.lastAt = now();
    await writes;
  }

  async function commitServerGroup(opsList, by, label, gid) {
    const res = applyGroup(doc, opsList, { seq: seq + 1, cid: by.cid || 'server', base: seq });
    if (!res.ok || !res.effective.length) return;
    await accept(by.cid || 'server', by, gid || 'srv-' + (seq + 1), res.effective, label, null, res.guards);
  }

  async function createVersion(name, auto, email) {
    const v = { id: 'v' + now().toString(36) + Math.random().toString(36).slice(2, 6), name, auto, at: new Date(now()).toISOString(), by: email, seq };
    const snap = clone(doc);
    versions.push(v);
    const autos = versions.filter((x) => x.auto);
    const drop = auto && autos.length > L.autoVersionsKept ? autos.slice(0, autos.length - L.autoVersionsKept) : [];
    versions = versions.filter((x) => !drop.includes(x));
    persist(async () => {
      await storage.put('version:' + v.id, snap);
      for (const d of drop) await storage.delete('version:' + d.id);
      await storage.put('versions', versions);
    });
    await writes;
    return v;
  }

  return api;
}

/** Keep only the presence fields the protocol knows, with sane types and sizes. */
function sanitizePresence(p) {
  if (!p || typeof p !== 'object') return null;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  const s = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : null);
  return {
    pointer: p.pointer && n(p.pointer.x) != null && n(p.pointer.y) != null ? { x: n(p.pointer.x), y: n(p.pointer.y) } : null,
    sel: Array.isArray(p.sel) ? p.sel.filter((x) => typeof x === 'string').slice(0, 50).map((x) => x.slice(0, 120)) : [],
    mode: s(p.mode, 20), room: s(p.room), lock: s(p.lock, 130), view: s(p.view, 10),
  };
}

export { keysOf };
