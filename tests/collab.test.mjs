// Live collaboration (CONTRACT § 13): ops, room rules, client rebase, per-person undo, roles, resync, restore points,
// randomized convergence of 3 replicas, and — with the real store in worker threads — op-capture completeness.
//   node tests/collab.test.mjs
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { createRoom } from '../src/collab/room.js';
import { createClient } from '../src/collab/client.js';
import { keyType, keyId, applyOpTo, recordToDoc, docToRecord, diffEntity } from '../src/collab/ops.js';
import { assignZ } from '../src/collab/bridge.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + msg); } };
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const canon = (o) => (Array.isArray(o) ? o.map(canon) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, canon(o[k])])) : o);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const memStorage = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? clone(m.get(k)) : undefined; }, async put(k, v) { m.set(k, clone(v)); }, async delete(k) { m.delete(k); } }; };

// ------------------------------------------------------------------ a plain-doc replica with a toy "engine"
// plan entity: { phase, base: null, edits: { walls: [id], openings: [{ id, wall }] } } — an opening needs its wall.
// runs: run:R { id, unitIds } + unit items { carp: { runId } } — a unit needs its run, a run lists exactly its units.
function docReplica(name) {
  const e = {};
  let client = null, intents = [], batch = false;
  const toast = [];
  const adapter = {
    get: (k) => clone(e[k]),
    keys: () => Object.keys(e),
    allTypeKeys: (t) => Object.keys(e).filter((k) => keyType(k) === t),
    apply(changes) { for (const [k, v] of changes) { if (v === undefined) delete e[k]; else e[k] = clone(v); } return new Set(); },
    inBatch: () => batch,
    takeIntent() { if (!intents.length) return null; const o = intents; intents = []; return o; },
    runIntent(list) { intents = []; for (const c of list) { const r = engine[c.name](...c.args); if (!r.ok) return r; } return { ok: true }; },
  };
  const change = (keys) => client.localChange(keys);
  const planOf = () => clone(e.plan) || { phase: 'fixed', base: null, edits: { walls: [], openings: [] } };
  const engine = {
    addWall(id) { const p = planOf(); if (p.edits.walls.includes(id)) return { ok: false, reason: 'exists' }; p.edits.walls.push(id); e.plan = p; intents.push({ name: 'addWall', args: [id] }); change(['plan']); return { ok: true }; },
    removeWall(id) { const p = planOf(); if (!p.edits.walls.includes(id)) return { ok: false, reason: 'No such wall.' }; p.edits.walls = p.edits.walls.filter((w) => w !== id); p.edits.openings = p.edits.openings.filter((o) => o.wall !== id); e.plan = p; intents.push({ name: 'removeWall', args: [id] }); change(['plan']); return { ok: true }; },
    addOpening(id, wall) { const p = planOf(); if (!p.edits.walls.includes(wall)) return { ok: false, reason: 'No wall there.' }; if (p.edits.openings.some((o) => o.id === id)) return { ok: false, reason: 'exists' }; p.edits.openings.push({ id, wall }); e.plan = p; intents.push({ name: 'addOpening', args: [id, wall] }); change(['plan']); return { ok: true }; },
  };
  const R = {
    name, e, adapter, engine, toast,
    bind(c) { client = c; c.on('toast', (t) => toast.push(t.message)); },
    get client() { return client; },
    setBatch(v) { batch = v; if (!v) client.batchEnded(); },
    maxZ: () => Math.max(0, ...Object.keys(e).filter((k) => keyType(k) === 'item').map((k) => e[k]['@z'])),
    addItem(id, x) { e['item:' + id] = { id, type: 'chair', name: 'Chair ' + id, x, y: 0, '@z': R.maxZ() + 1 }; change(['item:' + id]); },
    setItem(id, f, v) { if (!e['item:' + id] || e['item:' + id].carp) return false; e['item:' + id][f] = v; change(['item:' + id]); return true; },
    removeItem(id) { if (!e['item:' + id] || e['item:' + id].carp) return false; delete e['item:' + id]; change(['item:' + id]); return true; },
    front(id) { if (!e['item:' + id]) return false; e['item:' + id]['@z'] = R.maxZ() + 1; change(['item:' + id]); return true; },
    finish(id, v) { e['finish:' + id] = { floor: v }; change(['finish:' + id]); },
    project(f, v) { e.project = { ...(e.project || {}), [f]: v }; change(['project']); },
    createRun(rid, n) { const ids = []; for (let i = 0; i < n; i++) { const id = `${rid}u${i}`; ids.push(id); e['item:' + id] = { id, type: 'cabinet', name: 'Unit', x: i * 60, y: 0, '@z': R.maxZ() + 1, carp: { runId: rid, width: 60 } }; } e['run:' + rid] = { id: rid, unitIds: ids, length: n * 60 }; change(['run:' + rid, ...ids.map((i) => 'item:' + i)]); },
    addUnit(rid, uid) { const r = e['run:' + rid]; if (!r) return false; e['item:' + uid] = { id: uid, type: 'cabinet', name: 'Unit', x: r.unitIds.length * 60, y: 0, '@z': R.maxZ() + 1, carp: { runId: rid, width: 60 } }; r.unitIds = [...r.unitIds, uid]; r.length += 60; change(['run:' + rid, 'item:' + uid]); return true; },
    removeRun(rid) { const r = e['run:' + rid]; if (!r) return false; for (const u of r.unitIds) delete e['item:' + u]; delete e['run:' + rid]; change(['run:' + rid, ...r.unitIds.map((u) => 'item:' + u)]); return true; },
    widenUnit(uid) { const it = e['item:' + uid]; if (!it || !it.carp) return false; const r = e['run:' + it.carp.runId]; it.carp = { ...it.carp, width: it.carp.width + 5 }; r.length += 5; change(['item:' + uid, 'run:' + r.id]); return true; },
  };
  return R;
}

/** Invariants of the toy model: no opening without its wall, runs ⇄ units consistent. */
function invariants(e) {
  const errs = [];
  const p = e.plan && e.plan.edits;
  if (p) for (const o of p.openings) if (!p.walls.includes(o.wall)) errs.push(`opening ${o.id} without wall ${o.wall}`);
  for (const k of Object.keys(e)) {
    if (keyType(k) === 'item' && e[k].carp) { const r = e['run:' + e[k].carp.runId]; if (!r || !r.unitIds.includes(e[k].id)) errs.push(`unit ${k} not in its run`); }
    if (keyType(k) === 'run') for (const u of e[k].unitIds) if (!e['item:' + u]) errs.push(`run ${k} lists missing unit ${u}`);
  }
  return errs;
}

// ------------------------------------------------------------------ a simulated network around a room
function network(room, rand) {
  const socks = [];
  let n = 0;
  const net = {
    socks,
    connect(rep, email, role) {
      const sock = { id: `${rep.name}#${++n}`, readyState: 1, up: [], down: [], opened: false, onopen: null, onmessage: null, onclose: null,
        send(text) { if (sock.readyState !== 1) throw new Error('closed'); sock.up.push(text); },
        close() { net.drop(sock); } };
      room.join({ id: sock.id, email, role, send: (text) => { if (sock.readyState === 1) sock.down.push(text); } });
      socks.push(sock);
      return sock;
    },
    drop(sock) {
      if (sock.readyState !== 1) return;
      sock.readyState = 3; sock.up = []; sock.down = [];
      room.leave(sock.id);
      socks.splice(socks.indexOf(sock), 1);
      if (sock.onclose) sock.onclose();
    },
    /** Deliver one random message (per-connection order kept). Returns false when nothing is in flight. */
    async step() {
      const choices = [];
      for (const s of socks) { if (!s.opened) choices.push([s, 'open']); else { if (s.up.length) choices.push([s, 'up']); if (s.down.length) choices.push([s, 'down']); } }
      if (!choices.length) return false;
      const [s, what] = choices[Math.floor(rand() * choices.length)];
      if (what === 'open') { s.opened = true; s.onopen && s.onopen(); }
      else if (what === 'up') await room.receive(s.id, s.up.shift());
      else { const t = s.down.shift(); s.onmessage && s.onmessage({ data: t }); }
      return true;
    },
    async settle(max = 100000) { let i = 0; while (await net.step()) if (++i > max) throw new Error('network does not settle'); },
  };
  return net;
}

function makeReplica(net, name, email, role = 'editor') {
  const rep = docReplica(name);
  const timers = [];
  const client = createClient({ adapter: rep.adapter, cid: 'cid' + name, connect: () => net.connect(rep, email, role), schedule: (fn) => { timers.push(fn); return timers.length; }, unschedule: () => {} });
  rep.bind(client);
  rep.timers = timers;
  rep.reconnect = () => { const t = timers.splice(0); for (const fn of t) fn(); if (!client.debug.sock()) client.open(); };
  client.on('welcome', (w) => { if (w.first && w.doc) { for (const k of Object.keys(rep.e)) delete rep.e[k]; Object.assign(rep.e, clone(w.doc.e)); } });
  client.open();
  return rep;
}
const roomDocE = (room) => room.doc().e;

// ================================================================== 1. ops basics
{
  const a = { id: 'a', x: 1, y: 2, params: { k: 1 } }, b = { id: 'a', x: 1, y: 3, params: { k: 2 }, note: 'n' };
  const op = diffEntity('item:a', a, b);
  ok(same(op, { k: 'item:a', s: { y: 3, params: { k: 2 }, note: 'n' } }), 'diffEntity sets changed fields only');
  ok(same(applyOpTo(a, op), b), 'applyOpTo(diff) reproduces the target');
  ok(applyOpTo(undefined, { k: 'item:a', s: { x: 1 } }) === undefined, 'a set on a missing entity stays missing (deletes win)');
  const zm = new Map([['a', 0], ['b', 1], ['c', 2]]);
  const ch = assignZ(['c', 'a', 'b', 'n'], zm);
  ok(zm.get('c') < zm.get('a') && zm.get('a') < zm.get('b') && zm.get('b') < zm.get('n') && ch.length === 2, 'assignZ keeps the longest ordered run and fits the rest');
  const rec = { name: 'P', phase: 'draft', basePlan: { walls: [] }, design: { items: [{ id: 'x', type: 't' }, { id: 'y', type: 't' }], project: { name: 'P' }, finishes: { r1: { floor: 'f' } }, carpentry: { runs: {}, settings: {} } } };
  const back = docToRecord(recordToDoc(rec));
  ok(same(back.design.items, rec.design.items) && back.phase === 'draft' && same(back.design.finishes, rec.design.finishes), 'record → doc → record keeps the design');
}

// ================================================================== 2. scripted scenarios
async function scenario(fn, opts = {}) {
  const room = createRoom({ id: 'p1', storage: memStorage(), now: opts.now || (() => 1e12), limits: opts.limits || {} });
  await room.load();
  const net = network(room, rng(opts.seed || 1));
  await fn({ room, net, rep: (name, role) => makeReplica(net, name, `${name.toLowerCase()}@example.com`, role) });
}

await scenario(async ({ room, net, rep }) => {
  const A = rep('A'), B = rep('B');
  await net.settle();
  ok(A.client.status().state === 'live' && A.client.status().people === 2, 'two people live');
  // different fields of one item survive
  A.addItem('s', 100); await Promise.resolve(); await net.settle();
  A.setItem('s', 'x', 300); B.setItem('s', 'note', 'velvet'); await Promise.resolve(); await net.settle();
  ok(A.e['item:s'].x === 300 && B.e['item:s'].x === 300 && A.e['item:s'].note === 'velvet' && B.e['item:s'].note === 'velvet', 'edits of different fields of one item both survive');
  // same field: server order wins everywhere
  A.setItem('s', 'x', 1); B.setItem('s', 'x', 2); await Promise.resolve(); await net.settle();
  ok(A.e['item:s'].x === B.e['item:s'].x && A.e['item:s'].x === roomDocE(room)['item:s'].x, 'same field: last writer by server order, identical everywhere');
  // delete wins over a concurrent edit
  A.removeItem('s'); B.setItem('s', 'y', 50); await Promise.resolve(); await net.settle();
  ok(!A.e['item:s'] && !B.e['item:s'] && !roomDocE(room)['item:s'], 'delete wins over a concurrent field edit');
  // door in a wall someone else removed → dropped, author told
  A.engine.addWall('w1'); await Promise.resolve(); await net.settle();
  B.toast.length = 0;
  A.engine.removeWall('w1'); B.engine.addOpening('d1', 'w1'); await Promise.resolve();
  // A's removal reaches the room first
  const sa = net.socks.find((s) => s.id.startsWith('A')); while (sa.up.length) await room.receive(sa.id, sa.up.shift());
  await net.settle();
  ok(!A.e.plan.edits.openings.length && !B.e.plan.edits.openings.length && same(A.e.plan, B.e.plan), 'a door in a wall removed concurrently is dropped on every replica');
  ok(B.toast.some((t) => /could not be applied/.test(t) && /No wall there/.test(t)), 'the door\'s author is told why');
  // independent concurrent plan edits are both kept (the later one is re-run on the newer plan)
  A.engine.addWall('w2'); B.engine.addWall('w3'); await Promise.resolve(); await net.settle();
  ok(A.e.plan.edits.walls.includes('w2') && A.e.plan.edits.walls.includes('w3') && same(A.e.plan, B.e.plan), 'independent concurrent plan edits are both kept (rebase by re-running)');
  // a unit added to a run someone else deleted → dropped
  A.createRun('r1', 2); await Promise.resolve(); await net.settle();
  B.toast.length = 0;
  A.removeRun('r1'); B.addUnit('r1', 'r1u9'); await Promise.resolve();
  while (sa.up.length) await room.receive(sa.id, sa.up.shift());
  await net.settle();
  ok(!B.e['run:r1'] && !B.e['item:r1u9'] && !A.e['item:r1u9'] && invariants(B.e).length === 0, 'a unit added to a run deleted concurrently is dropped');
  ok(B.toast.some((t) => /at the same time/.test(t)), 'the unit\'s author is told');
});

await scenario(async ({ room, net, rep }) => {
  const A = rep('A'), B = rep('B');
  await net.settle();
  // per-person undo
  A.addItem('a', 10); B.addItem('b', 20); await Promise.resolve(); await net.settle();
  A.setItem('a', 'x', 11); B.setItem('b', 'x', 21); await Promise.resolve(); await net.settle();
  B.client.undo(); await Promise.resolve(); await net.settle();
  ok(A.e['item:a'].x === 11 && A.e['item:b'].x === 20 && B.e['item:a'].x === 11, 'B\'s undo rewinds only B\'s work');
  B.client.redo(); await Promise.resolve(); await net.settle();
  ok(A.e['item:b'].x === 21, 'redo re-applies it for everyone');
  B.setItem('a', 'x', 99); await Promise.resolve(); await net.settle();
  A.toast.length = 0;
  A.client.undo(); await Promise.resolve(); await net.settle();
  ok(A.e['item:a'].x === 99 && B.e['item:a'].x === 99 && A.toast.some((t) => /skipped/.test(t)), 'undo skips an entity someone else changed since, and says so');
  // run family undo: A's run creation is not half-undone after B added a unit
  A.createRun('r2', 2); await Promise.resolve(); await net.settle();
  B.addUnit('r2', 'r2x'); await Promise.resolve(); await net.settle();
  A.client.undo(); await Promise.resolve(); await net.settle();
  const okRun = A.e['run:r2'] && invariants(A.e).length === 0 && same(A.e, B.e);
  ok(okRun, 'undo never half-undoes a run another person changed');
  if (!okRun) console.log('   ', JSON.stringify(A.e['run:r2']), invariants(A.e), A.toast);
});

await scenario(async ({ room, net, rep }) => {
  const A = rep('A'), V = rep('V', 'viewer');
  await net.settle();
  A.addItem('a', 1); await Promise.resolve(); await net.settle();
  V.setItem('a', 'x', 500); await Promise.resolve(); await net.settle();
  ok(V.e['item:a'].x === 1 && roomDocE(room)['item:a'].x === 1 && V.toast.some((t) => /view this project/.test(t)), 'a viewer\'s edit is rolled back locally and never reaches the room');
  // a forged op from a viewer connection is refused by the room
  const vs = net.socks.find((s) => s.id.startsWith('V'));
  await room.receive(vs.id, JSON.stringify({ t: 'ops', gid: 'forged', base: 0, ops: [{ k: 'item:a', s: { x: 7 } }] }));
  ok(vs.down.some((t) => /"reject"/.test(t) && /"role"/.test(t)) && roomDocE(room)['item:a'].x === 1, 'the room refuses ops from a viewer');
  // invalid ops are refused
  const as = net.socks.find((s) => s.id.startsWith('A'));
  await room.receive(as.id, JSON.stringify({ t: 'ops', gid: 'bad1', base: 0, ops: [{ k: 'item:a', s: { x: 'far' } }] }));
  await room.receive(as.id, JSON.stringify({ t: 'ops', gid: 'bad2', base: 0, ops: [{ k: '__proto__', p: {} }] }));
  await room.receive(as.id, JSON.stringify({ t: 'ops', gid: 'bad3', base: 0, ops: [{ k: 'underlay', p: { image: 'data:image/png;base64,AAAA' } }] }));
  ok(as.down.filter((t) => /"reject"/.test(t) && /"invalid"/.test(t)).length === 3, 'the room validates the op schema (types, keys, no picture in the op stream)');
  // a name sent by a client is ignored: identity is the server's
  await room.receive(as.id, JSON.stringify({ t: 'presence', p: { name: 'Mallory', pointer: { x: 1, y: 2 } } }));
  ok(!JSON.stringify(vs.down).includes('Mallory'), 'presence carries no client-chosen name');
  // rate limit
  let rejected = 0;
  for (let i = 0; i < 100; i++) await room.receive(as.id, JSON.stringify({ t: 'ops', gid: 'r' + i, base: room.seq, ops: [{ k: 'item:a', s: { y: i } }] }));
  rejected = as.down.filter((t) => /"rate"/.test(t)).length;
  ok(rejected > 0, `the room rate-limits a flood of groups (${rejected} of 100 refused)`);
  // size limit
  await room.receive(as.id, JSON.stringify({ t: 'ops', gid: 'big', base: room.seq, ops: [{ k: 'item:a', s: { note: 'x'.repeat(1100000) } }] }));
  ok(as.down.some((t) => /"size"/.test(t)), 'the room refuses an over-size group');
  await net.settle();
});

// restore points + resync after a log trim + offline queue
await scenario(async ({ room, net, rep }) => {
  const A = rep('A'), B = rep('B');
  await net.settle();
  A.addItem('a', 1); A.finish('kitchen', 'oak'); await Promise.resolve(); await net.settle();
  const as = net.socks.find((s) => s.id.startsWith('A'));
  await room.receive(as.id, JSON.stringify({ t: 'version-create', name: 'Before the big change' }));
  A.setItem('a', 'x', 777); A.finish('kitchen', 'tiles'); A.addItem('b', 2); await Promise.resolve(); await net.settle();
  const list = room.listVersions();
  ok(list.some((v) => v.name === 'Before the big change' && !v.auto) && list.some((v) => v.auto), 'named and automatic restore points are listed');
  const v = list.find((x) => x.name === 'Before the big change');
  B.client.restoreVersion(v.id); await net.settle();
  ok(A.e['item:a'].x === 1 && !A.e['item:b'] && A.e['finish:kitchen'].floor === 'oak' && same(A.e, B.e), 'restoring a point is one group everyone receives');
  // B goes offline, A makes > logSize groups, B edits offline, comes back: resync from the doc, offline edits merged
  const bs = net.socks.find((s) => s.id.startsWith('B'));
  net.drop(bs);
  ok(B.client.status().state !== 'live', 'B is not live after the drop');
  B.setItem('a', 'note', 'offline note'); B.addItem('bo', 5); await Promise.resolve();
  for (let i = 0; i < 30; i++) { A.setItem('a', 'y', i); await Promise.resolve(); await net.settle(); }
  B.reconnect(); await net.settle();
  ok(B.e['item:a'].y === 29 && A.e['item:a'].note === 'offline note' && A.e['item:bo'] && same(A.e, B.e) && same(A.e, roomDocE(room)), 'offline edits sync on reconnect after a resync from the doc (log trimmed)');
}, { limits: { logSize: 10, snapEvery: 5 } });

// room persistence: a fresh room object reloads the same state from storage (Durable Object restart)
{
  const storage = memStorage();
  const room = createRoom({ id: 'p2', storage, now: () => 1e12, limits: { logSize: 8, snapEvery: 3 } });
  await room.load();
  const net = network(room, rng(5));
  const A = makeReplica(net, 'A', 'a@example.com');
  await net.settle();
  for (let i = 0; i < 20; i++) { A.addItem('i' + i, i); await Promise.resolve(); await net.settle(); }
  await room.flush();
  const again = createRoom({ id: 'p2', storage, now: () => 1e12, limits: { logSize: 8, snapEvery: 3 } });
  await again.load();
  ok(same(again.doc().e, room.doc().e) && again.seq === room.seq, 'a restarted room reloads the same doc and sequence from storage');
}

// ================================================================== 3. randomized convergence: 3 replicas, shuffled delivery, disconnects
{
  const rand = rng(Number(process.env.COLLAB_SEED) || 20261114);
  const room = createRoom({ id: 'rnd', storage: memStorage(), now: () => 1e12, limits: { logSize: 12, snapEvery: 4, rate: { ops: [1e6, 1e6] } } });
  await room.load();
  const net = network(room, rand);
  const reps = ['A', 'B', 'C'].map((n) => makeReplica(net, n, n.toLowerCase() + '@example.com'));
  await net.settle();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  let rounds = 0, actions = 0, resyncs = 0, drops = 0, rejects = 0, reruns = 0;
  for (const r of reps) { r.client.on('rejected', () => rejects++); r.client.on('welcome', (w) => { if (w.resync) resyncs++; }); }
  const ids = () => [...new Set(reps.flatMap((r) => Object.keys(r.e).filter((k) => keyType(k) === 'item').map(keyId)))];
  for (rounds = 0; rounds < 300; rounds++) {
    for (const r of reps) {
      const nAct = Math.floor(rand() * 3);
      for (let a = 0; a < nAct; a++) {
        actions++;
        const x = rand();
        const anyId = pick(ids().length ? ids() : ['none']);
        const wallIds = ['w1', 'w2', 'w3', 'w4'], runIds = ['r1', 'r2'];
        if (x < 0.15) r.addItem(`${r.name}${rounds}_${a}`, Math.round(rand() * 1000));
        else if (x < 0.35) r.setItem(anyId, pick(['x', 'y', 'note']), Math.round(rand() * 100));
        else if (x < 0.42) r.removeItem(anyId);
        else if (x < 0.47) r.front(anyId);
        else if (x < 0.52) r.finish(pick(['k', 'l', 'b']), pick(['oak', 'tile', 'stone']));
        else if (x < 0.56) r.project(pick(['name', 'wallColor']), pick(['a', 'b', 'c']));
        else if (x < 0.64) r.engine.addWall(pick(wallIds));
        else if (x < 0.69) r.engine.removeWall(pick(wallIds));
        else if (x < 0.76) r.engine.addOpening(`o${rounds}${r.name}${a}`, pick(wallIds));
        else if (x < 0.80) { const rid = pick(runIds); if (!r.e['run:' + rid]) r.createRun(rid, 2); }
        else if (x < 0.84) r.addUnit(pick(runIds), `u${rounds}${r.name}${a}`);
        else if (x < 0.87) r.removeRun(pick(runIds));
        else if (x < 0.90) r.widenUnit(anyId);
        else if (x < 0.95) r.client.undo();
        else r.client.redo();
        // a drag: remote groups are held until it ends
        if (rand() < 0.05) { r.setBatch(true); r.setItem(anyId, 'x', 5); await net.step(); r.setBatch(false); }
        await Promise.resolve();
      }
    }
    // shuffled partial delivery
    const steps = Math.floor(rand() * 25);
    for (let s = 0; s < steps; s++) if (!(await net.step())) break;
    // disconnects / reconnects
    for (const r of reps) {
      const sock = r.client.debug.sock();
      if (sock && rand() < 0.04) { net.drop(sock); drops++; }
      else if (!sock && rand() < 0.3) { r.reconnect(); }
    }
  }
  for (const r of reps) if (!r.client.debug.sock()) r.reconnect();
  await net.settle();
  // a final round-trip so every replica has seen every ack
  const resynced = reps.map((r) => r.client.debug.pending().length);
  const E = roomDocE(room);
  const converged = reps.every((r) => same(sortKeys(r.e), sortKeys(E)));
  ok(resynced.every((n) => n === 0), 'no group left pending after healing');
  ok(converged, `3 replicas converge to the room's doc after ${rounds} randomized rounds (${actions} actions, ${drops} disconnects, seq ${room.seq})`);
  if (!converged) for (const r of reps) for (const k of new Set([...Object.keys(r.e), ...Object.keys(E)])) if (!same(r.e[k], E[k])) { console.log('   diff', r.name, k, JSON.stringify(r.e[k]), JSON.stringify(E[k])); break; }
  const inv = invariants(E);
  ok(inv.length === 0, 'the converged state is valid (no opening without its wall, runs ⇄ units consistent)' + (inv.length ? ': ' + inv.slice(0, 3).join('; ') : ''));
  reruns = reps.reduce((n, r) => n + r.toast.filter((t) => /could not be applied|at the same time/.test(t)).length, 0);
  console.log(`  randomized: ${rounds} rounds, ${actions} actions, ${drops} disconnects, ${resyncs} resyncs from the doc, ${rejects} guard conflicts (${reruns} dropped and told), final seq ${room.seq}`);
}
function sortKeys(e) { const o = {}; for (const k of Object.keys(e).sort()) o[k] = e[k]; return o; }

// ================================================================== 4. real store replicas (worker threads)
const WORKER = fileURLToPath(new URL('./collab-replica.worker.mjs', import.meta.url));
function spawnReplica(name, email, role = 'editor') {
  const w = new Worker(WORKER, { workerData: { name } });
  let n = 0;
  const waits = new Map();
  const rep = { name, w, email, role, down: [], up: [], toasts: [] };
  w.on('message', (m) => {
    if (m.type === 'reply') { const f = waits.get(m.id); waits.delete(m.id); f && f(m); }
    else if (m.type === 'up') rep.up.push(m.text);
    else if (m.type === 'toast') rep.toasts.push(m.message);
    else if (m.type === 'rest') rep.onRest(m);
  });
  w.on('error', (e) => { console.log('worker error', name, e); });
  rep.call = (code, arg) => new Promise((res, rej) => { const id = ++n; waits.set(id, (m) => (m.error ? rej(new Error(m.error)) : res(m.value))); w.postMessage({ type: 'call', id, code, arg }); });
  return rep;
}
async function realWorld(record, names) {
  const room = createRoom({ id: 'real', storage: memStorage(), now: () => 1e12, record, limits: { rate: { ops: [1e6, 1e6] } } });
  await room.load();
  const reps = names.map(([n, role]) => spawnReplica(n, n.toLowerCase() + '@example.com', role));
  for (const r of reps) {
    r.connId = r.name + '#1';
    room.join({ id: r.connId, email: r.email, role: r.role || 'editor', send: (text) => r.w.postMessage({ type: 'down', text }) });
    r.onRest = async (m) => {
      let value = null;
      if (m.op === 'putUnderlay') value = await room.putUnderlay({ type: 'image/webp', data: m.arg.image, meta: m.arg.meta }, { email: r.email, cid: 'cid-' + r.name });
      else if (m.op === 'getUnderlay') { const a = await room.getUnderlay(); value = a && a.id === m.arg ? a.data : null; }
      r.w.postMessage({ type: 'rest', id: m.id, value });
    };
    await r.call('start');
  }
  const pumpAll = async (only) => {
    for (let guard = 0; guard < 200; guard++) {
      let moved = false;
      for (const r of reps) { if (only && !only.includes(r)) continue; while (r.up.length) { moved = true; await room.receive(r.connId, r.up.shift()); } }
      await Promise.all(reps.map((r) => r.call('tick')));
      for (const r of reps) if (r.up.length) moved = true;
      if (!moved) return;
    }
  };
  return { room, reps, pumpAll, close: () => Promise.all(reps.map((r) => r.w.terminate())) };
}

{
  // capture completeness: replica A drives every mutating API once; B only receives ops → byte-identical serialize()
  const recordMod = await import('../src/core/projects.js');
  const { BUILTIN_PLAN } = await import('../src/core/plan-edit.js');
  const record = { id: 'real', name: 'House', phase: 'fixed', basePlan: JSON.parse(JSON.stringify(BUILTIN_PLAN)), design: recordMod.builtinDesign() };
  const W = await realWorld(record, [['A'], ['B']]);
  const [A, B] = W.reps;
  await W.pumpAll();
  const steps = await A.call('allApis');
  await W.pumpAll();
  const cmp = async (label) => {
    const [sa, sb] = await Promise.all([A.call('serialize'), B.call('serialize')]);
    const okk = sa === sb;
    ok(okk, `B (ops only) is byte-identical to A ${label}`);
    if (!okk) { const a = JSON.parse(sa), b = JSON.parse(sb); for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { console.log('   differs in', k, JSON.stringify(a[k]).slice(0, 300), '\n   vs', JSON.stringify(b[k]).slice(0, 300)); } }
    return okk;
  };
  ok(steps.failed.length === 0, `every API call succeeded on A (${steps.done.length} calls)` + (steps.failed.length ? ': ' + steps.failed.join(', ') : ''));
  await cmp(`after ${steps.done.length} API calls`);
  const ua = await A.call('underlayMeta'), ub = await B.call('underlayMeta');
  ok(ua === ub && ua !== 'null', 'underlay transform / visibility reach B');
  for (let i = 0; i < 6; i++) { await A.call('undo'); await W.pumpAll(); }
  await cmp('after 6 undos');
  for (let i = 0; i < 3; i++) { await A.call('redo'); await W.pumpAll(); }
  await cmp('after 3 redos');
  const trail = [];
  for (let i = 0; i < 400; i++) { if (!(await A.call('canUndo'))) break; await A.call('undo'); trail.push(await A.call('itemCount')); }
  if (process.env.DEBUG_COLLAB) console.log('items after each undo', trail.join(' '));
  await W.pumpAll();
  await cmp('after undoing everything');
  const sa = JSON.parse(await A.call('serialize'));
  ok(sa.items.length === record.design.items.length, `undoing everything returns to the opening state (items ${sa.items.length} / ${record.design.items.length}; toasts: ${A.toasts.slice(-3).join(' | ')})`);
  await W.close();
}

{
  // real plan engine: B adds a door in a wall that A removes concurrently → dropped with the engine's reason;
  // A's wall + B's independent wall elsewhere both survive; rooms and finishes identical
  const { BUILTIN_PLAN } = await import('../src/core/plan-edit.js');
  const record = { id: 'real2', name: 'House', phase: 'fixed', basePlan: JSON.parse(JSON.stringify(BUILTIN_PLAN)), design: { items: [] } };
  const W = await realWorld(record, [['A'], ['B'], ['V', 'viewer']]);
  const [A, B, V] = W.reps;
  await W.pumpAll();
  const seg = await A.call('addPartition');
  await W.pumpAll();
  ok(seg && seg.ok, 'A draws a partition');
  await A.call('removeSeg', seg.ids[0]);
  const door = await B.call('doorIn', seg.ids[0]);
  ok(door.ok, 'B places a door in it (concurrently, before seeing the removal)');
  await W.pumpAll([A]); await W.pumpAll();
  const [pa, pb] = await Promise.all([A.call('planKey'), B.call('planKey')]);
  ok(pa === pb && !(await B.call('hasOpening', door.ids[0])), 'the door in the removed wall is dropped on both replicas, plans identical');
  ok(B.toasts.some((t) => /could not be applied/.test(t)), 'B is told: ' + (B.toasts.find((t) => /could not be applied/.test(t)) || B.toasts.join(' | ')));
  await A.call('wallAt', 1); await B.call('wallAt', 2);
  await W.pumpAll();
  const [qa, qb] = await Promise.all([A.call('serialize'), B.call('serialize')]);
  ok(qa === qb && (await A.call('wallCount')) === (await B.call('wallCount')), 'two concurrent independent walls: both kept, identical plans, rooms and finishes');
  const vs = await V.call('serialize');
  ok(vs === qa, 'the viewer sees the same design');
  await V.call('tryEdit'); await W.pumpAll();
  ok((await V.call('serialize')) === qa && V.toasts.some((t) => /view this project/.test(t)), 'a viewer cannot change the design');
  await W.close();
}

console.log(`\ncollab: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
