/**
 * LIVE COLLABORATION — the client: optimistic local apply, one group in flight, offline queue, rebase on the room's
 * answer, per-person undo / redo, reconnect with backoff, transient ops and presence transport. See CONTRACT § 13.
 *
 * Works on any local state through an ADAPTER (the store bridge in ./bridge.js, or a plain doc in tests):
 *   adapter.get(key) → entity | undefined        current local value (what the user sees)
 *   adapter.keys() → string[]                    every key held locally
 *   adapter.apply(changes: Map<key, entity|undefined>, { transient }) → Set<key>   apply (with the usual events);
 *                                                returns keys it touched on the side (e.g. finishes pruned by a plan change)
 *   adapter.inBatch() → bool                     a local begin…commit is open (remote groups wait)
 *   adapter.takeIntent() → intent | null         plan-engine calls recorded since the last capture
 *   adapter.runIntent(intent) → { ok, reason? }  re-run them (rebase after a plan conflict)
 *   adapter.allTypeKeys(type) → string[]          keys of one type (items, runs…)
 * and reports local changes by calling client.localChange(keys, { transient, txFields }).
 *
 *   const client = createClient({ adapter, connect: () => new WebSocket(url), cid });
 *   client.on('status' | 'peers' | 'presence' | 'toast' | 'history' | 'versions' | 'tx' | 'welcome' | 'role', fn)
 */
import { PROTOCOL, diffEntity, applyOpTo, applyOps, keysOf, keyType, emptyDoc, sizeOf, LIMITS } from './ops.js';

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const TX_FIELDS = ['x', 'y', 'rot', 'elev', 'w', 'd', 'h'];
const GUARDED = (k) => k === 'plan' || keyType(k) === 'run';

/** A random client id (one per tab; survives reconnects, not reloads). */
export const newCid = () => 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/**
 * @param {{ adapter: object, connect?: () => object, cid?: string, now?: () => number,
 *           schedule?: (fn, ms) => any, unschedule?: (t) => void, txInterval?: number, presenceInterval?: number }} o
 */
export function createClient({ adapter, connect = null, cid = newCid(), now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms), unschedule = (t) => clearTimeout(t), txInterval = 66, presenceInterval = 66 } = {}) {
  const listeners = new Map();
  const emit = (ev, payload) => (listeners.get(ev) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error('[collab] listener failed', e); } });

  let confirmed = emptyDoc(), seq = -1;          // the room's state as far as acknowledged / received
  const mirror = new Map();                      // key → entity as last captured / applied (before-values for capture)
  let pending = [];                              // local groups not yet acknowledged, oldest first
  let undoStack = [], redoStack = [];
  let dirty = new Set(), flushQueued = false, applying = 0;
  let held = [];                                 // remote messages held while a local batch is open
  let ws = null, status = 'offline', attempts = 0, retryTimer = null, closedByUser = false, joined = false;
  let you = null, role = 'editor', gidN = 0, disposed = false;
  const peers = new Map();                       // cid → { cid, email, name, color, role, p, seenAt }
  const txTouched = new Map();                   // cid → Set(keys) moved by that peer's transient ops
  let txPending = new Map(), txTimer = null, txLast = 0, txActive = false;
  let presenceWant = null, presenceTimer = null, presenceLast = 0;

  const setStatus = (s) => { if (s !== status) { status = s; emit('status', api.status()); } };
  const nextGid = () => `${cid}-${(++gidN).toString(36)}`;
  const peerName = (c) => (peers.get(c) && peers.get(c).name) || (c === cid ? 'you' : 'someone else');

  // ------------------------------------------------------------ local state helpers
  /** The value a key should have locally: confirmed + every pending group laid over it. */
  function target(k) {
    let v = confirmed.e[k];
    for (const g of pending) for (const op of g.ops) if (op.k === k) v = applyOpTo(v, op);
    return v;
  }
  /** Bring the given keys of the local state to target(); the mirror follows. */
  function reconcile(keys) {
    const changes = new Map();
    for (const k of keys) { const t = target(k); if (!same(t, adapter.get(k))) changes.set(k, clone(t)); }
    if (!changes.size) { for (const k of keys) mirror.set(k, adapter.get(k)); return; }
    applying++;
    let touched = new Set();
    try { touched = adapter.apply(changes, {}) || new Set(); } finally { applying--; }
    for (const k of new Set([...keys, ...touched])) { const v = adapter.get(k); if (v === undefined) mirror.delete(k); else mirror.set(k, v); }
  }
  const allKeys = () => new Set([...Object.keys(confirmed.e), ...adapter.keys(), ...mirror.keys(), ...pending.flatMap((g) => keysOf(g.ops))]);

  // ------------------------------------------------------------ capture
  /** Called by the adapter for local edits. `keys` may hold '*<type>' (all keys of a type) or '*' (everything). */
  function localChange(keys, info = {}) {
    if (applying || disposed) return;
    for (const k of keys) dirty.add(k);
    if (info.transient) { if (info.tx) queueTx(info.tx); return; }
    if (!flushQueued) { flushQueued = true; Promise.resolve().then(() => { flushQueued = false; flush(); }); }
  }
  function expandDirty() {
    const out = new Set();
    for (const k of dirty) {
      if (k === '*') { for (const x of allKeys()) out.add(x); continue; }
      if (k[0] === '*') { const t = k.slice(1); for (const x of new Set([...adapter.allTypeKeys(t), ...[...mirror.keys()].filter((m) => keyType(m) === t)])) out.add(x); continue; }
      out.add(k);
    }
    dirty = new Set();
    return out;
  }
  /** Turn dirty keys into one group (`kind`: 'do' | 'undo' | 'redo'). Returns the group or null. */
  function flush(kind = 'do', label = '') {
    if (disposed || adapter.inBatch()) return null;
    const keys = expandDirty();
    const ops = [], inverse = [];
    for (const k of keys) {
      const before = mirror.get(k), after = adapter.get(k);
      const op = diffEntity(k, before, after);
      if (!op) continue;
      ops.push(op);
      const inv = keyType(k) === 'underlay' ? null : diffEntity(k, after, before);   // the underlay is not undoable (§ 12)
      if (inv) inverse.push(inv);
      if (after === undefined) mirror.delete(k); else mirror.set(k, after);
    }
    const intent = adapter.takeIntent ? adapter.takeIntent() : null;
    if (txActive) endTx();
    if (!ops.length) { releaseHeld(); return null; }
    if (role === 'viewer') {                       // never sent: roll the local change back
      reconcile(keysOf(ops));
      emit('toast', { kind: 'warn', message: 'You can view this project but not change it.' });
      releaseHeld();
      return null;
    }
    const g = { gid: nextGid(), base: seq, ops, inverse, intent, kind, label, sent: false };
    if (sizeOf(ops) > LIMITS.groupBytes) {
      reconcile(keysOf(ops));
      emit('toast', { kind: 'warn', message: 'That change is too large to share live (over 1 MB) — it was undone.' });
      releaseHeld();
      return null;
    }
    pending.push(g);
    const entry = { gid: g.gid, inverse, base: seq, ackSeq: null, label };
    if (kind === 'undo') redoStack.push(entry);
    else { undoStack.push(entry); if (kind === 'do') redoStack = []; }
    if (undoStack.length > 200) undoStack.shift();
    emit('history', api.historyState());
    pump();
    releaseHeld();
    return g;
  }

  // ------------------------------------------------------------ transient ops (drags)
  function queueTx(tx) { for (const [k, fields] of Object.entries(tx)) txPending.set(k, { ...(txPending.get(k) || {}), ...fields }); txActive = true; sendTxSoon(); }
  function sendTxSoon() {
    if (txTimer) return;
    const wait = Math.max(0, txInterval - (now() - txLast));
    txTimer = schedule(() => { txTimer = null; if (!txPending.size) return; txLast = now(); const ops = [...txPending].map(([k, s]) => ({ k, s })); txPending = new Map(); send({ t: 'tx', ops }); }, wait);
  }
  function endTx() { txActive = false; if (txTimer) { unschedule(txTimer); txTimer = null; } txPending = new Map(); send({ t: 'tx-end' }); }

  // ------------------------------------------------------------ the wire
  function send(msg) { if (ws && joined && ws.readyState === 1) { try { ws.send(JSON.stringify(msg)); return true; } catch (e) { return false; } } return false; }
  /** Send the oldest pending group if nothing is in flight. */
  function pump() {
    const g = pending[0];
    if (!g || g.sent || !joined) return;
    if (send({ t: 'ops', gid: g.gid, base: g.base, ops: g.ops, label: g.label })) g.sent = true;
  }

  function onMessage(text) {
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    if ((m.t === 'ops' || m.t === 'ack' || m.t === 'reject') && adapter.inBatch()) { held.push(m); return; }
    handle(m);
  }
  function releaseHeld() { if (adapter.inBatch()) return; const list = held; held = []; for (const m of list) handle(m); }

  function handle(m) {
    switch (m.t) {
      case 'welcome': return welcome(m);
      case 'ops': return remoteGroup(m);
      case 'ack': return ack(m);
      case 'reject': return reject(m);
      case 'tx': return remoteTx(m);
      case 'tx-end': return clearTx(m.cid);
      case 'peer': {
        if (m.left) { peers.delete(m.cid); clearTx(m.cid); }
        else peers.set(m.cid, { ...(peers.get(m.cid) || {}), ...m, seenAt: now() });
        emit('peers', api.peers());
        return;
      }
      case 'presence': {
        const p = peers.get(m.cid); if (!p) return;
        p.p = m.p; p.seenAt = now();
        emit('presence', { cid: m.cid, p: m.p });
        return;
      }
      case 'versions': emit('versions', m.list); return;
      case 'restored': emit('restored', m); return;
      case 'role': role = m.role; if (you) you.role = role; emit('role', role); emit('status', api.status()); return;
      case 'error': emit('error', m); if (m.code === 'removed' || m.code === 'version') { emit('toast', { kind: 'error', message: m.reason }); api.close(); } return;
      default: return;
    }
  }

  function welcome(m) {
    joined = true; attempts = 0;
    you = m.you; role = m.you.role;
    peers.clear();
    for (const p of m.peers || []) peers.set(p.cid, { ...p, seenAt: now() });
    const first = seq < 0;
    if (m.doc) {
      confirmed = m.doc; seq = m.seq;
      // a pending group may already be in the doc (ack lost) — it is simply re-sent; the room's rules make that harmless
      emit('welcome', { first, resync: !first, doc: confirmed });
      if (!first) reconcile(allKeys());
      else for (const k of adapter.keys()) mirror.set(k, adapter.get(k));
    } else {
      emit('welcome', { first, resync: false });
      for (const g of m.ops || []) remoteGroup(g);
    }
    for (const g of pending) g.sent = false;
    setStatus('live');
    emit('peers', api.peers());
    pump();
    if (presenceWant) sendPresenceNow();
  }

  function remoteGroup(m) {
    if (m.seq <= seq) return;                     // already have it
    const mine = m.cid === cid && pending.length && pending[0].gid === m.gid;
    if (mine) return ack({ gid: m.gid, seq: m.seq, ops: m.ops, g: m.g });
    if (m.cid === cid) { const i = pending.findIndex((g) => g.gid === m.gid); if (i > 0) pending.splice(i, 1); }
    applyOps(confirmed, m.ops, [m.seq, m.cid], m.g); seq = m.seq;
    clearTx(m.cid, false);
    reconcile(new Set([...keysOf(m.ops), ...(txTouched.get(m.cid) || [])]));
    txTouched.delete(m.cid);
    emit('remote', { seq: m.seq, cid: m.cid, by: m.by, label: m.label, keys: keysOf(m.ops) });
  }

  function ack(m) {
    const g = pending[0];
    if (!g || g.gid !== m.gid) return;
    pending.shift();
    if (m.seq > seq) { applyOps(confirmed, m.ops, [m.seq, cid], m.g); seq = m.seq; }
    const entry = [...undoStack, ...redoStack].find((e) => e.gid === g.gid);
    if (entry) entry.ackSeq = m.seq;
    if (!same(m.ops, g.ops)) {                    // parts were dropped by the rules (e.g. the item was deleted meanwhile)
      reconcile(keysOf(g.ops));
      const dropped = g.ops.filter((op) => !m.ops.some((x) => same(x, op)));
      if (dropped.length) emit('toast', { kind: 'info', message: 'Part of your change was not kept: someone else deleted it meanwhile.' });
    }
    pump();
  }

  function reject(m) {
    const g = pending[0];
    if (!g || g.gid !== m.gid) return;
    // the rejected group and every later pending group that touched the same guarded entities (built on top of it)
    const guardKeys = new Set(m.keys && m.keys.length ? m.keys : keysOf(g.ops).filter(GUARDED));
    const out = [g, ...pending.slice(1).filter((x) => m.code === 'conflict' && touchesGuard(x, guardKeys))];
    pending = pending.filter((x) => !out.includes(x));
    undoStack = undoStack.filter((e) => !out.some((x) => x.gid === e.gid));
    redoStack = redoStack.filter((e) => !out.some((x) => x.gid === e.gid));
    reconcile(new Set(out.flatMap((x) => keysOf(x.ops))));
    const who = [...guardKeys].map((k) => confirmed.v[k] && confirmed.v[k][1]).filter((c) => c && c !== cid).map(peerName)[0] || 'someone else';
    if (m.code !== 'conflict') {
      emit('toast', { kind: 'warn', message: m.reason || 'Your change was refused.' });
    } else {
      for (const x of out) {
        if (x.intent && x.intent.length) {
          const r = adapter.runIntent(x.intent);
          if (r.ok) { const ng = flush(x.kind === 'undo' ? 'undo' : x.kind === 'redo' ? 'redo' : 'rebase', x.label); if (ng && x.kind === 'do') { /* stays undoable */ } continue; }
          if (adapter.takeIntent) adapter.takeIntent();
          reconcile(new Set([...keysOf(x.ops), ...expandDirty()]));
          emit('toast', { kind: 'warn', message: `Your change could not be applied after ${who}'s edit: ${r.reason || 'it no longer fits.'}`, dropped: x.gid });
        } else {
          emit('toast', { kind: 'warn', message: `${cap(who)} changed this at the same time — your change was not applied.`, dropped: x.gid });
        }
      }
    }
    emit('history', api.historyState());
    emit('rejected', { gid: g.gid, code: m.code, keys: [...guardKeys] });
    pump();
  }
  /** Does a group touch one of these guarded entities (directly, or through a unit item of a guarded run)? */
  function touchesGuard(x, guardKeys) {
    return x.ops.some((op) => {
      if (guardKeys.has(op.k)) return true;
      if (keyType(op.k) !== 'item') return false;
      const runs = [op.p, op.s, adapter.get(op.k), confirmed.e[op.k]].map((v) => v && v.carp && v.carp.runId).filter(Boolean);
      return runs.some((r) => guardKeys.has('run:' + r));
    });
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function remoteTx(m) {
    if (!Array.isArray(m.ops)) return;
    const changes = new Map();
    const set = txTouched.get(m.cid) || new Set();
    for (const op of m.ops) {
      if (!op.s || keyType(op.k) !== 'item') continue;
      if (pending.some((g) => g.ops.some((o) => o.k === op.k)) || dirty.has(op.k)) continue;   // my own edit wins locally
      const cur = adapter.get(op.k); if (!cur) continue;
      const s = {}; for (const f of TX_FIELDS) if (f in op.s && typeof op.s[f] === 'number') s[f] = op.s[f];
      changes.set(op.k, { ...cur, ...s }); set.add(op.k);
    }
    txTouched.set(m.cid, set);
    if (!changes.size) return;
    applying++;
    try { adapter.apply(changes, { transient: true }); } finally { applying--; }
    emit('tx', { cid: m.cid, keys: [...changes.keys()] });
  }
  function clearTx(peer, apply = true) {
    const set = txTouched.get(peer);
    if (!set) return;
    if (apply) { txTouched.delete(peer); reconcile(set); }
  }

  // ------------------------------------------------------------ connection
  function open() {
    if (!connect || ws) return;
    closedByUser = false; joined = false;
    setStatus(seq < 0 ? 'connecting' : 'reconnecting');
    let sock;
    try { sock = connect(); } catch (e) { return retry(); }
    ws = sock;
    sock.onopen = () => { if (ws !== sock) return; try { sock.send(JSON.stringify({ t: 'hello', v: PROTOCOL, cid, ...(seq >= 0 ? { since: seq } : {}) })); } catch (e) { /* closed */ } };
    sock.onmessage = (ev) => { if (ws === sock) onMessage(typeof ev.data === 'string' ? ev.data : String(ev.data)); };
    sock.onclose = () => { if (ws !== sock) return; ws = null; joined = false; for (const g of pending) g.sent = false; peers.clear(); emit('peers', api.peers()); for (const c of [...txTouched.keys()]) clearTx(c); if (!closedByUser) retry(); else setStatus('offline'); };
    sock.onerror = () => { /* onclose follows */ };
  }
  let waitingOnline = false;
  function retry() {
    // the browser knows it is offline: wait for it to come back instead of failing connection attempts
    if (typeof navigator !== 'undefined' && navigator.onLine === false && typeof addEventListener === 'function') {
      setStatus('offline');
      if (!waitingOnline) { waitingOnline = true; addEventListener('online', () => { waitingOnline = false; attempts = 0; if (!closedByUser && !ws) open(); }, { once: true }); }
      return;
    }
    setStatus(seq < 0 ? 'connecting' : 'reconnecting');
    if (attempts >= 3) setStatus('offline');
    const delay = Math.min(15000, 500 * 2 ** attempts) * (0.75 + Math.random() * 0.5);
    attempts++;
    if (retryTimer) unschedule(retryTimer);
    retryTimer = schedule(() => { retryTimer = null; open(); }, delay);
  }

  // ------------------------------------------------------------ presence
  function sendPresenceNow() { presenceLast = now(); send({ t: 'presence', p: presenceWant }); }

  // ------------------------------------------------------------ undo / redo
  function undoRedo(fromUndo) {
    const stack = fromUndo ? undoStack : redoStack;
    const entry = stack.pop();
    if (!entry) return false;
    const since = entry.ackSeq != null ? entry.ackSeq : entry.base;
    const changedBy = (k) => { const v = confirmed.v[k]; return v && v[0] > since && v[1] !== cid ? v[1] : null; };
    // a plan / a run with its units is undone whole or not at all (never a half-undone run)
    const bad = new Map();
    for (const op of entry.inverse) { const g = guardOf(op); const by = changedBy(op.k) || (g && changedBy(g)); if (by && g) bad.set(g, by); }
    const keep = [], skipped = [];
    for (const op of entry.inverse) {
      const g = guardOf(op), by = changedBy(op.k) || (g && bad.get(g));
      if (by) skipped.push({ k: g && keyType(g) === 'run' ? g : op.k, by }); else keep.push(op);
    }
    if (skipped.length) {
      const who = [...new Set(skipped.map((s) => peerName(s.by)))].join(', ');
      const kinds = [...new Set(skipped.map((x) => x.k))];
      const what = kinds.length === 1 ? describeKey(kinds[0]) : `${kinds.length} things`;
      emit('toast', { kind: 'info', message: `${fromUndo ? 'Undo' : 'Redo'} skipped ${what} — ${who} changed it since.` });
    }
    if (!keep.length) { emit('history', api.historyState()); return true; }
    const changes = new Map();
    for (const op of keep) changes.set(op.k, applyOpTo(adapter.get(op.k), op));
    applying++;
    let touched = new Set();
    try { touched = adapter.apply(changes, {}) || new Set(); } finally { applying--; }
    for (const k of [...changes.keys(), ...touched]) dirty.add(k);
    const g = flush(fromUndo ? 'undo' : 'redo', entry.label);
    if (!g) emit('history', api.historyState());
    return true;
  }
  function guardOf(op) {
    const t = keyType(op.k);
    if (t === 'plan') return 'plan';
    if (t === 'run') return op.k;
    if (t !== 'item') return null;
    const r = [op.p, op.s, adapter.get(op.k), confirmed.e[op.k]].map((v) => v && v.carp && v.carp.runId).find(Boolean);
    return r ? 'run:' + r : null;
  }
  function describeKey(k) {
    const t = keyType(k);
    if (t === 'item') { const it = adapter.get(k); return it ? `“${it.name}”` : 'an item'; }
    return { plan: 'the plan', run: 'a carpentry run', finish: 'a finish', project: 'the project settings', underlay: 'the sketch' }[t] || 'a change';
  }

  const api = {
    cid,
    /** Start with a known doc (opened from REST / welcome) — optional; `connect` + welcome does it too. */
    open,
    close() { closedByUser = true; if (retryTimer) { unschedule(retryTimer); retryTimer = null; } if (ws) { const s = ws; ws = null; joined = false; try { s.close(); } catch (e) { /* gone */ } } setStatus('offline'); },
    /** End the session for good (another project was opened): nothing more is captured or sent. */
    dispose() { api.close(); disposed = true; dirty = new Set(); pending = []; held = []; listeners.clear(); },
    get disposed() { return disposed; },
    /** Feed a frame (tests / custom transports). */
    receive: onMessage,
    localChange,
    /** The local batch (drag) ended: capture it, then apply what arrived meanwhile. */
    batchEnded() { if (adapter.inBatch()) return; flush(); releaseHeld(); },
    flush,
    undo: () => undoRedo(true),
    redo: () => undoRedo(false),
    historyState: () => ({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 }),
    /** { state: 'connecting' | 'live' | 'reconnecting' | 'offline', people, pending, role } */
    status: () => ({ state: status, people: peers.size + (joined ? 1 : 0), pending: pending.length, role }),
    you: () => you,
    role: () => role,
    peers: () => [...peers.values()].map((p) => ({ ...p })),
    /** Presence (throttled to one message per `presenceInterval` ms, last value wins). */
    setPresence(p) {
      presenceWant = p;
      if (presenceTimer) return;
      const wait = Math.max(0, presenceInterval - (now() - presenceLast));
      presenceTimer = schedule(() => { presenceTimer = null; sendPresenceNow(); }, wait);
    },
    requestVersions: () => send({ t: 'versions' }),
    createVersion: (name) => send({ t: 'version-create', name }),
    restoreVersion: (id) => send({ t: 'version-restore', id, gid: nextGid() }),
    on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev).delete(fn); },
    /** Diagnostics / tests. */
    debug: { confirmed: () => confirmed, seq: () => seq, pending: () => pending.map((g) => ({ gid: g.gid, keys: keysOf(g.ops), sent: g.sent })), mirror: () => mirror, sock: () => ws },
  };
  return api;
}
