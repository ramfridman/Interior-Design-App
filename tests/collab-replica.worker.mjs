// One real-store replica for tests/collab.test.mjs (its own store, plan engine and carpentry engine in a worker thread).
// Frames to / from the room go through the parent: { type: 'up' | 'down', text }.
import { parentPort } from 'node:worker_threads';
import { store } from '../src/core/store.js';
import { PLAN } from '../src/core/plan.js';
import * as PE from '../src/core/plan-edit.js';
import * as C from '../src/carpentry/index.js';
import { createStoreBridge } from '../src/collab/bridge.js';
import { createClient } from '../src/collab/client.js';

store.persist = false;
// the REST calls for the underlay picture go to the parent (which holds the room)
let restN = 0; const rest = new Map();
const restCall = (op, arg) => new Promise((res) => { const id = ++restN; rest.set(id, res); parentPort.postMessage({ type: 'rest', id, op, arg }); });
const bridge = createStoreBridge(store, { fetchUnderlay: (id) => restCall('getUnderlay', id), uploadUnderlay: (image, meta) => restCall('putUnderlay', { image, meta }) });
let sock = null;
const client = createClient({
  adapter: bridge,
  connect: () => {
    sock = { readyState: 1, send(text) { parentPort.postMessage({ type: 'up', text }); }, close() {} };
    queueMicrotask(() => sock.onopen && sock.onopen());
    return sock;
  },
  schedule: (fn, ms) => setTimeout(fn, ms), unschedule: (t) => clearTimeout(t), txInterval: 0, presenceInterval: 0,
});
client.on('welcome', (w) => { if (w.first && w.doc) bridge.openDoc(w.doc); });
client.on('toast', (t) => parentPort.postMessage({ type: 'toast', message: t.message }));
bridge.attach(client);

const tick = () => new Promise((r) => setTimeout(r, 0));
const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(60000);

const calls = {
  async start() { client.open(); for (let i = 0; i < 200 && client.status().state !== 'live'; i++) await tick(); return client.status().state; },
  async tick() { await tick(); await tick(); return true; },
  serialize() { const s = store.serialize(); delete s.savedAt; delete s.ui; return JSON.stringify(s); },
  underlayMeta() { if (!store.underlay) return 'null'; const { image, ...m } = store.underlay; return JSON.stringify(m); },
  async undo() { store.undo(); await tick(); return true; },
  async redo() { store.redo(); await tick(); return true; },
  itemCount() { return store.items.length; },
  canUndo() { return store.historyState().canUndo; },
  planKey() { return PE.planStateKey(); },
  hasOpening(id) { return PLAN.openings.some((o) => o.id === id); },
  wallCount() { return PLAN.walls.length; },
  async addPartition() { const r = PE.addWall({ x1: 1000, y1: 135, x2: 1002, y2: 500 }); await tick(); return r; },
  async removeSeg(id) { const r = PE.removeWallSegment(id); await tick(); return r; },
  async doorIn(id) { const s = PE.wallSegments().find((x) => x.id === id); const r = PE.addOpening({ kind: 'door', x: s.core.x + s.core.w / 2, y: s.core.y + s.core.h / 2 }); await tick(); return r; },
  async wallAt(n) { const r = n === 1 ? PE.addWall({ x1: 300, y1: 1100, x2: 300, y2: 1320 }) : PE.addWall({ x1: 1200, y1: 700, x2: 1200, y2: 1000 }); await tick(); return r; },
  // levels (stage F1)
  async addLevel(opts) { const r = PE.addLevel(opts); await tick(); return r; },
  async wallOn([level, input]) { PE.setActiveLevel(level); const r = PE.addWall(input); await tick(); return r; },
  // any plan-edit call by name (angled walls, stage A2): [name, args]
  async pe([name, args]) { const r = PE[name](...(args || [])); await tick(); return r && typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : r; },
  planJSON() { return JSON.stringify(PE.currentPlanData()); },
  levelsKey() { return JSON.stringify(PLAN.levels === undefined ? null : PLAN.levels); },
  activeLevel() { return PE.activeLevel(); },
  async tryEdit() { const it = store.items[0]; if (it) store.updateItem(it.id, { x: it.x + 50 }); else store.addItem({ type: 'chair', w: 50, d: 50, h: 80, x: 500, y: 500 }); await tick(); return true; },

  /** Every mutating store / plan-edit / carpentry API once (each its own user action). */
  async allApis() {
    const done = [], failed = [];
    const step = async (name, fn) => { try { const r = fn(); if (r && r.ok === false) failed.push(`${name}: ${r.reason && r.reason.en ? r.reason.en : r.reason}`); else done.push(name); } catch (e) { failed.push(`${name}: ${e.message}`); } await tick(); };
    let a, b, seg, pass, door, unitId, runId, featureId;
    // items
    await step('addItem', () => { a = store.addItem({ type: 'sofa', name: 'Sofa', w: 200, d: 90, h: 80, x: 400, y: 400 }); });
    await step('addItems', () => { b = store.addItems([{ type: 'chair', w: 50, d: 50, h: 80, x: 600, y: 400 }, { type: 'lamp', w: 40, d: 40, h: 150, x: 650, y: 450 }]); });
    await step('updateItem', () => { store.updateItem(a.id, { x: 420, note: 'velvet' }); });
    await step('updateItems', () => { store.updateItems(b.map((i) => i.id), (it) => ({ rot: (it.rot + 90) % 360 })); });
    await step('drag (begin / transient / commit)', () => { store.begin(); for (let i = 1; i <= 5; i++) store.updateItem(a.id, { x: 420 + i * 10 }, { transient: true }); store.commit(); });
    await step('drag cancelled', () => { store.begin(); store.updateItem(a.id, { x: 0 }, { transient: true }); store.cancel(); });
    await step('swapItem', () => { store.swapItem(b[0].id, { type: 'armchair', name: 'Armchair', w: 80, d: 80, h: 90 }); });
    await step('duplicateItems', () => { store.duplicateItems([a.id]); });
    await step('bringToFront', () => { store.bringToFront([store.items[0].id]); });
    await step('sendToBack', () => { store.sendToBack([a.id]); });
    await step('removeItems', () => { store.removeItems([b[1].id]); });
    await step('setProject', () => { store.setProject({ wallColor: '#eeeeee', roof: 'flat' }); });
    await step('setFinish', () => { store.setFinish(PLAN.rooms[0].id, { floor: 'some-floor', wallColor: '#ddd' }); });
    await step('setUnderlay (new picture)', () => { store.setUnderlay({ image: 'data:image/webp;base64,AAAA', width: 100, height: 80, transform: [1, 0, 0, 1, 0, 0] }, { replace: true }); });
    await step('setUnderlay (patch)', () => { store.setUnderlay({ opacity: 0.3, visible: false, transform: [2, 0, 0, 2, 10, 20] }); });
    // plan
    await step('addWall', () => { const r = PE.addWall({ x1: 1000, y1: 135, x2: 1002, y2: 500 }); seg = r.ids && r.ids[0]; return r; });
    await step('addOpening', () => { const r = PE.addOpening({ kind: 'opening', x: 1000, y: 300, width: 120 }); pass = r.ids && r.ids[0]; return r; });
    await step('updateOpening', () => PE.updateOpening(pass, { width: 100 }));
    await step('moveWallSegment', () => { const s = PE.wallSegments().find((x) => x.id === seg) || PE.segmentAt(1000, 200); const r = PE.moveWallSegment(s.id, 20); seg = r.ids && r.ids[0]; return r; });
    await step('resizeWallSegment', () => { const s = PE.segmentAt(1020, 200); return PE.resizeWallSegment(s.id, { end: 450 }); });
    await step('addOpening (door)', () => { const r = PE.addOpening({ kind: 'door', x: 1020, y: 160, width: 70 }); door = r.ids && r.ids[0]; return r; });
    await step('flipDoor', () => PE.flipDoor(door, 'hinge'));
    await step('removeOpening', () => PE.removeOpening(door));
    await step('updateRoom', () => PE.updateRoom(PLAN.rooms[1].id, { name: 'Studio', type: 'office' }));
    await step('removeWallSegment', () => PE.removeWallSegment(PE.segmentAt(1020, 200).id));
    await step('addWall (again)', () => PE.addWall({ x1: 1000, y1: 135, x2: 1002, y2: 500 }));
    await step('resetPlan', () => PE.resetPlan());
    // carpentry
    await step('adoptArchitectLayout', () => C.adoptArchitectLayout());
    await step('createRun', () => { const r = C.createRun({ kind: 'wardrobe', x: 1250, y: 1061, from: 0, to: 160, ends: { left: 'wall', right: 'wall' } }); runId = r.runId; return r; });
    await step('addUnit', () => { const r = C.addUnit(runId, 'wardrobe-hinged', { width: 60 }); unitId = r.unitId || (r.ids && r.ids[0]); return r; });
    await step('updateRun', () => C.updateRun(runId, { notes: 'Oak veneer please' }));
    await step('layoutRun', () => C.layoutRun(runId));
    await step('addUnit (second)', () => C.addUnit(runId, 'wardrobe-hinged'));
    await step('fitRun', () => C.fitRun(runId, { mode: 'fillers' }));
    const units = () => (store.carpentry.runs[runId] || { unitIds: [] }).unitIds;
    await step('updateUnit', () => C.updateUnit(units()[0], { note: 'mirror inside' }));
    await step('setUnitWidth', () => C.setUnitWidth(units()[0], 6));
    await step('moveUnit', () => C.moveUnit(units()[0], 1));
    await step('addFeature (big image)', () => { const r = C.addFeature({ runId }, { title: 'Hidden safe', text: 'Behind the shirts', category: 'security', priority: 'must', images: [{ dataUrl: IMG, name: 'safe.jpg' }] }); featureId = r.featureId; return r; });
    await step('updateFeature', () => C.updateFeature(featureId, { title: 'Hidden safe (bolted)' }));
    await step('removeFeature', () => C.removeFeature(featureId));
    await step('removeUnit', () => C.removeUnit(units()[units().length - 1]));
    await step('moveRun (island)', () => { const isl = Object.values(store.carpentry.runs).find((r) => r.kind === 'island'); return isl ? C.moveRun(isl.id, { dx: 20, dy: -10 }) : { ok: false, reason: 'no island' }; });
    await step('duplicateRun', () => C.duplicateRun(runId, {}));
    await step('removeRun', () => C.removeRun(runId));
    // plan phase and whole-design load
    await step('setPlanPhase draft', () => { if (!store.setPlanPhase('draft')) return { ok: false, reason: 'unchanged' }; });
    await step('addWall (draft)', () => PE.addWall({ x1: -400, y1: -100, x2: -400, y2: 200 }));
    await step('setPlanPhase fixed', () => { if (!store.setPlanPhase('fixed')) return { ok: false, reason: 'unchanged' }; });
    await step('load (recordUndo)', () => { const d = store.serialize(); d.items = d.items.slice(0, d.items.length - 2); store.load(d, { recordUndo: true }); });
    void unitId;
    return { done, failed };
  },
};

parentPort.on('message', async (m) => {
  if (m.type === 'rest') { const f = rest.get(m.id); rest.delete(m.id); if (f) f(m.value); return; }
  if (m.type === 'down') { if (sock && sock.onmessage) sock.onmessage({ data: m.text }); return; }
  if (m.type === 'call') {
    try { const value = await calls[m.code](m.arg); parentPort.postMessage({ type: 'reply', id: m.id, value }); }
    catch (e) { parentPort.postMessage({ type: 'reply', id: m.id, error: e.stack || e.message }); }
  }
});
