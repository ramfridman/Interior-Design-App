// Several floors in the 3D view — stage F3 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md. Headless (plain node): bare
// 'three' imports are mapped to vendor/three, procedural textures get a no-op canvas.
//   node tests/levels-3d.test.mjs                  the checks
//   node tests/levels-3d.test.mjs --write-golden   re-capture the House 98 mesh hashes (only from the pre-F3 house.js!)
// The browser part (two-level project, ui.level 0 → 1 → 0, "Show whole house", screenshots) is tests/levels-3d.e2e.mjs.
import { register } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
register('data:text/javascript,' + encodeURIComponent(`
  const base = ${JSON.stringify(new URL('../vendor/three/', import.meta.url).href)};
  export async function resolve(spec, ctx, next) {
    if (spec === 'three') return { url: base + 'three.module.min.js', shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: base + 'addons/' + spec.slice(13), shortCircuit: true };
    return next(spec, ctx);
  }`));

// textures.js paints on a 2D canvas: give it one that draws nothing (geometry is what is tested here)
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ctx2d), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ width: 0, height: 0, style: {}, className: '', getContext: () => ctx2d, append() {}, appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {} });
globalThis.document ??= { createElement: el, documentElement: {}, addEventListener() {}, removeEventListener() {} };
globalThis.performance ??= { now: () => Date.now() };

const THREE = await import('three');
const { PLAN } = await import('../src/core/plan.js');
const { store } = await import('../src/core/store.js');
const { buildHouse } = await import('../src/view3d/house.js');
const B = await import('../src/core/plan-build.js');
const E = await import('../src/core/plan-edit.js');
const { DUPLEX } = await import('./fixtures/houses.mjs');

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const GOLDEN = new URL('./fixtures/house98-mesh-hashes.json', import.meta.url);
const catalog = { getProduct: () => null };

/** sha256 per mesh name of every mesh under `root` (vertex data + world matrix), visible ones and hidden ones. */
function meshHashes(root) {
  root.updateMatrixWorld(true);
  const out = {};
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const h = createHash('sha256'), g = o.geometry;
    for (const k of Object.keys(g.attributes).sort()) { const a = g.attributes[k]; h.update(k); h.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength)); }
    if (g.index) h.update(Buffer.from(g.index.array.buffer, g.index.array.byteOffset, g.index.array.byteLength));
    h.update(o.matrixWorld.elements.map((v) => v.toFixed(6)).join(','));
    let vis = true; for (let n = o; n && n !== root.parent; n = n.parent) if (!n.visible) vis = false;
    const key = o.name || '(unnamed)';
    out[key] = (out[key] ? out[key] + '+' : '') + h.digest('hex').slice(0, 16) + (vis ? '' : ':hidden') + (o.castShadow ? ':cast' : '');
  });
  return out;
}

/** House 98 in a series of view states; each state's mesh hashes. */
function house98States() {
  const house = buildHouse({ store, plan: PLAN, catalog });
  const states = {};
  const snap = (name) => { states[name] = meshHashes(house.group); };
  snap('default');
  house.setRoofVisible(true); snap('roof');
  house.setRoofVisible(false); house.setCutaway(120); snap('cutaway');
  house.setSunStudy(false); snap('cutaway-no-study');
  house.setSunStudy(true); house.setCutaway(null); house.setDoorsOpen(true); snap('doors-open');
  house.setDoorsOpen(false); house.rebuildPlan(); snap('rebuilt');
  house.dispose();
  return states;
}

group('House 98: every house mesh is byte-identical to the pre-F3 builder');
{
  const states = house98States();
  if (process.argv.includes('--write-golden')) {
    fs.writeFileSync(GOLDEN, JSON.stringify(states, null, 1) + '\n');
    console.log('  wrote', GOLDEN.pathname);
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  for (const [state, meshes] of Object.entries(golden)) {
    const got = states[state] || {}, diff = Object.keys({ ...meshes, ...got }).filter((k) => meshes[k] !== got[k]);
    check(`${state}: ${Object.keys(meshes).length} meshes identical`, diff.length === 0, diff.slice(0, 4).map((k) => `${k}: ${meshes[k]} → ${got[k]}`).join(' | '));
  }
}

// ───────────────────────── the Duplex (its void, no stair) ─────────────────────────
const { stairs: _st, ...L1IN } = DUPLEX.levels[0];
const INPUT = { walls: DUPLEX.walls, openings: DUPLEX.openings, heights: DUPLEX.heights, meta: { name: 'Duplex', floors: 2 }, levels: [L1IN] };
const DUPLEX_PLAN = B.buildPlan(INPUT, { levels: true }).plan;
const H98 = JSON.parse(JSON.stringify(PLAN));
const open = (basePlan) => store.openProject({ basePlan, phase: 'draft', design: { items: [], project: { ceilingHeight: basePlan.heights.ceiling } } });
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

/** World bounds (m) of the visible meshes under `root` whose name passes `pick`. */
function boundsOf(root, pick = () => true) {
  root.updateMatrixWorld(true);
  const b = new THREE.Box3();
  root.traverse((o) => { if (o.isMesh && pick(o.name) && o.geometry.index && o.geometry.index.count) { o.geometry.computeBoundingBox(); b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
  return b;
}
/** Plan area (cm²) of the triangles of a mesh whose normal points along `ny` (±1). */
function flatArea(mesh, ny) {
  const g = mesh.geometry, p = g.attributes.position, n = g.attributes.normal, idx = g.index.array;
  let a = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [i, j, k] = [idx[t], idx[t + 1], idx[t + 2]];
    if (Math.sign(n.getY(i)) !== ny || Math.abs(n.getY(i)) < 0.99) continue;
    a += Math.abs((p.getX(j) - p.getX(i)) * (p.getZ(k) - p.getZ(i)) - (p.getX(k) - p.getX(i)) * (p.getZ(j) - p.getZ(i))) / 2;
  }
  return a * 1e4;
}
const meshOf = (house, level, name) => { let m = null; house.group.getObjectByName('level:' + level)?.traverse((o) => { if (o.isMesh && o.name === name) m = o; }); return m; };
const drawn = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh && o.geometry.index && o.geometry.index.count) { let v = true; for (let q = o; q; q = q.parent) if (!q.visible) v = false; if (v) n++; } }); return n; };

group('Duplex: stacked shells');
open(DUPLEX_PLAN);
{
  const house = buildHouse({ store, plan: PLAN, catalog });
  house.setLevel('L1');
  const g0 = house.group.getObjectByName('level:L0'), g1 = house.group.getObjectByName('level:L1');
  check('one mesh group per level, L1 placed at Y = 3.00 m', g0 && g1 && g0.position.y === 0 && near(g1.position.y, 3), `${g1 && g1.position.y}`);
  const f1 = boundsOf(g1, (n) => n.startsWith('floor:')), w0 = boundsOf(g0, (n) => n.startsWith('wall:')), w1 = boundsOf(g1, (n) => n.startsWith('wall:'));
  check('L1 floors at Y = 3.00', near(f1.min.y, 3) && near(f1.max.y, 3), `${f1.min.y}..${f1.max.y}`);
  check('L0 walls 0 → 2.80 (up to the L1 slab), L1 walls 3.00 → 5.80', near(w0.max.y, 2.8) && near(w1.min.y, 3) && near(w1.max.y, 5.8) && w0.min.y < 0, `${w0.min.y.toFixed(3)}..${w0.max.y} / ${w1.min.y}..${w1.max.y}`);
  const L = house.levels();
  check('levels(): y / wall top / roof top', L.length === 2 && near(L[1].y, 3) && near(L[1].wallTop, 5.8) && near(L[1].top, 6.4) && near(L[0].wallTop, 2.8), JSON.stringify(L));
  const slab = meshOf(house, 'L1', 'slab'), sb = boundsOf(g1, (n) => n === 'slab');
  const slabArea = slab ? flatArea(slab, -1) : 0;
  check('slab under L1: 2.80 → 3.00, area = footprint − void (1000×800 − 100×374 cm²)', slab && near(sb.min.y, 2.8) && near(sb.max.y, 3) && near(slabArea, 1000 * 800 - 100 * 374, 1), `${slabArea.toFixed(1)} cm²`);
  check('slab volume = (footprint − void) × 0.20 m', near(slabArea / 1e4 * 0.2, (80 - 3.74) * 0.2, 1e-4), (slabArea / 1e4 * 0.2).toFixed(4) + ' m³');
  const fl = PLAN.levels[0].rooms.map((r) => meshOf(house, 'L1', 'floor:' + r.id)).reduce((s, m) => s + flatArea(m, 1), 0);
  const rooms1 = PLAN.levels[0].rooms.reduce((s, r) => s + Math.abs(r.polygon.reduce((a, p, i) => { const b = r.polygon[(i + 1) % r.polygon.length]; return a + p[0] * b[1] - b[0] * p[1]; }, 0)) / 2, 0);
  check('L1 floor finish has the void hole (rooms + the 90 × 10 door threshold − 100×374)', near(fl, rooms1 + 900 - 100 * 374, 1), `${fl} vs ${rooms1 + 900 - 100 * 374}`);
  const ceil0 = meshOf(house, 'L0', 'ceilings');
  check('L0 ceiling is open under the void', ceil0 && !ceil0.geometry.attributes.position.array.some(() => false) && (() => {
    const p = ceil0.geometry.attributes.position, idx = ceil0.geometry.index.array;
    for (let t = 0; t < idx.length; t += 3) { const cx = (p.getX(idx[t]) + p.getX(idx[t + 1]) + p.getX(idx[t + 2])) / 3, cz = (p.getZ(idx[t]) + p.getZ(idx[t + 1]) + p.getZ(idx[t + 2])) / 3; if (cx > 5.21 && cx < 6.19 && cz > 2.67 && cz < 6.39) return false; }
    return true;
  })());
  const r0 = meshOf(house, 'L0', 'roof:top'), r1 = meshOf(house, 'L1', 'roof:top');
  check('roof only over the top level (L1 covers all of L0)', (!r0 || !r0.visible || !r0.geometry.index.count) && r1 && r1.visible && near(flatArea(r1, 1), 1000 * 800, 1), r1 ? flatArea(r1, 1).toFixed(0) : 'none');
  const rb = boundsOf(g1, (n) => n === 'railing'), rail = meshOf(house, 'L1', 'railing');
  check('railing all round the void (no stair): 1.05 m high, 5 cm onto the floor', rail && near(rb.min.y, 3) && near(rb.max.y, 4.05) && near(rb.min.x, 5.15 - 0.025, 1e-3) && near(rb.max.x, 6.25 + 0.025, 1e-3) && near(rb.min.z, 2.61 - 0.025, 1e-3) && near(rb.max.z, 6.45 + 0.025, 1e-3),
    `x ${rb.min.x.toFixed(3)}..${rb.max.x.toFixed(3)} z ${rb.min.z.toFixed(3)}..${rb.max.z.toFixed(3)} y ${rb.min.y}..${rb.max.y}`);
  // view per level
  house.setLevel('L0');
  check('ui.level L0: L1 hidden, its shadow stand-ins cast (sun study)', !g1.visible && g0.visible && house.group.getObjectByName('house-level-casters').children.length > 0);
  house.setSunStudy(false);
  check('…no stand-ins without the sun study', house.group.getObjectByName('house-level-casters').children.length === 0);
  house.setSunStudy(true);
  house.setLevel('L1'); house.setCutaway(120);
  const c1 = boundsOf(g1, (n) => n.startsWith('wall:') && n !== 'wall:plinth'), c0 = boundsOf(g0, (n) => n.startsWith('wall:'));
  check('ui.level L1 + cut-away: L1 walls cut at 1.20 m, L0 complete', g1.visible && near(c1.max.y, 4.2) && near(c0.max.y, 2.8), `${c1.max.y} / ${c0.max.y}`);
  house.setCutaway(null); house.setWholeHouse(true); house.setRoofVisible(true);
  check('whole house: both levels, roof on', g0.visible && g1.visible && g1.getObjectByName('house-roof').visible);
  house.dispose();
}

group('Duplex with its stair: the arrival edge of the void stays open');
{
  const plan = JSON.parse(JSON.stringify(DUPLEX_PLAN));
  plan.stairs = JSON.parse(JSON.stringify(DUPLEX.stairs));
  open(plan);
  const house = buildHouse({ store, plan: PLAN, catalog });
  const rb = boundsOf(house.group.getObjectByName('level:L1'), (n) => n === 'railing');
  check('no rail along the north edge (y 266), rails on the other three', near(rb.min.z, 2.66, 1e-3) && near(rb.max.z, 6.45 + 0.025, 1e-3), `z ${rb.min.z.toFixed(3)}..${rb.max.z.toFixed(3)}`);
  house.dispose();
}

group('A smaller upper level: terrace roof on the level below');
{
  const small = JSON.parse(JSON.stringify(INPUT));
  const W = (id, x, y, w, h, kind) => ({ id, x, y, w, h, kind });
  small.levels[0] = { ...small.levels[0], voids: [], walls: [W('w01', 0, 0, 600, 20, 'exterior'), W('w02', 0, 780, 600, 20, 'exterior'), W('w03', 0, 20, 20, 760, 'exterior'), W('w04', 580, 20, 20, 760, 'exterior'), W('w05', 300, 20, 10, 760, 'interior')],
    openings: [small.levels[0].openings[0]] };
  const built = B.buildPlan(small, { levels: true });
  open(built.plan);
  const house = buildHouse({ store, plan: PLAN, catalog });
  house.setWholeHouse(true); house.setRoofVisible(true);
  const r0 = meshOf(house, 'L0', 'roof:top'), r1 = meshOf(house, 'L1', 'roof:top');
  const a0 = r0 ? flatArea(r0, 1) : 0, a1 = r1 ? flatArea(r1, 1) : 0;
  check('built (L1 = 600 × 800)', built.ok, JSON.stringify(built.warnings.filter((w) => w.level === 'error')));
  check('terrace roof on L0 = footprint(L0) − footprint(L1) = 400 × 800 cm²', near(a0, 400 * 800, 1), a0.toFixed(1));
  check('roof of L1 = its footprint', near(a1, 600 * 800, 1), a1.toFixed(1));
  const p0 = boundsOf(house.group.getObjectByName('level:L0'), (n) => n === 'roof:coping');
  check('terrace parapet + coping on the open edges only (east part of L0, at 2.80 + 0.20 + 0.40)', near(p0.min.x, 6, 1e-3) && near(p0.max.x, 10.02, 1e-3) && near(p0.max.y, 3.44, 1e-3), `x ${p0.min.x.toFixed(3)}..${p0.max.x.toFixed(3)} y ${p0.max.y.toFixed(3)}`);
  house.dispose();
}

group('Rebuild rules and disposal');
{
  const live = new Set();
  const setIndex = THREE.BufferGeometry.prototype.setIndex, dispose = THREE.BufferGeometry.prototype.dispose;
  THREE.BufferGeometry.prototype.setIndex = function (i) { live.add(this); return setIndex.call(this, i); };
  THREE.BufferGeometry.prototype.dispose = function () { live.delete(this); return dispose.call(this); };
  open(DUPLEX_PLAN);
  const house = buildHouse({ store, plan: PLAN, catalog });
  house.setLevel('L1');
  const before = { l0: meshOf(house, 'L0', 'wall:ext').geometry, l1: meshOf(house, 'L1', 'wall:ext').geometry };
  let ev = null;
  const off = store.on('plan', (e) => { ev = e; });
  E.setActiveLevel('L1');
  const r = E.addWall({ x1: 20, y1: 400, x2: 300, y2: 400, thickness: 10 });
  E.setActiveLevel('L0');
  off();
  const ms = house.rebuildPlan(ev);
  check('an L1 edit: the event names L1 and levels only', r.ok && ev && ev.levelId === 'L1' && ev.changed.levels && !ev.changed.walls, JSON.stringify(ev && ev.changed) + ' ' + (r.reason ? JSON.stringify(r.reason) : ''));
  check('…L1 rebuilt, L0 left alone', meshOf(house, 'L1', 'wall:ext').geometry !== before.l1 && meshOf(house, 'L0', 'wall:ext').geometry === before.l0, `${ms.toFixed(1)} ms`);
  house.setLevel('L0'); house.setCutaway(120); house.setLevel('L1'); house.setWholeHouse(true); house.setDoorsOpen(true);
  house.rebuildPlan();
  house.dispose();
  THREE.BufferGeometry.prototype.setIndex = setIndex; THREE.BufferGeometry.prototype.dispose = dispose;
  check('dispose: no geometry left behind', live.size === 0, `${live.size} left`);
}

group('Items, walk on an upper level');
{
  open(DUPLEX_PLAN);
  const { createItemsLayer } = await import('../src/view3d/items.js');
  const models = { buildModel: () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())); return g; } };
  const scene = new THREE.Scene();
  const layer = createItemsLayer({ scene, ctx: { store, plan: PLAN, models }, invalidate() {} });
  const up = store.addItem({ type: 'sofa', x: 700, y: 500, w: 200, d: 90, h: 80, rot: 0, elev: 0, placement: 'floor', level: 'L1' });
  const down = store.addItem({ type: 'sofa', x: 700, y: 500, w: 200, d: 90, h: 80, rot: 0, elev: 0, placement: 'floor' });
  const lamp = store.addItem({ type: 'pendant', x: 200, y: 400, w: 40, d: 40, h: 40, rot: 0, elev: 240, placement: 'ceiling', level: 'L1' });
  check('an item on L1 stands on the L1 floor (Y = 3.00), the same item on L0 at 0', near(layer.get(up.id).root.position.y, 3) && near(layer.get(down.id).root.position.y, 0) && layer.levelOf(up.id) === 'L1',
    `${layer.get(up.id).root.position.y} / ${layer.get(down.id).root.position.y}`);
  check('…its box too; a pendant on L1 hangs at 3.00 + 2.40', near(layer.boxOf(up.id).min.y, 3) && near(layer.boxOf(lamp.id).min.y, 5.4));
  layer.setLevelFilter((lv) => lv === 'L0');
  check('level filter: L1 items hidden while L0 is shown', !layer.get(up.id).root.visible && layer.get(down.id).root.visible);
  layer.setLevelFilter(null);
  store.setProject({ ceilingHeight: 270 });
  check('the project ceiling (the ground floor\'s) leaves L1 ceiling items alone', store.getItem(lamp.id).elev === 240);
  layer.dispose();

  globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
  const { createWalk } = await import('../src/view3d/walk.js');
  const dom = { addEventListener() {}, removeEventListener() {}, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  const cam = new THREE.PerspectiveCamera();
  const walk = createWalk({ camera: cam, dom, overlay: { append() {} }, ctx: { store, plan: PLAN, models: {} }, pickTarget: () => null, emit() {}, requestExit() {} });
  walk.start({ level: 'L1', pointerLock: false });
  const eye = walk.eyePose().position;
  check('walk on L1: eye at 3.00 + 1.65 = 4.65 m, inside an L1 room', walk.getLevel() === 'L1' && near(eye.y, 4.65) && walk.getState().spaceId && PLAN.levels[0].rooms.some((r) => r.id === walk.getState().spaceId), `${eye.y} ${walk.getState().spaceId}`);
  check('walk on L1: L1 walls block (partition x 300), L0 ones do not (partition x 500)', walk.blockedAt(305, 600, { furniture: false }) && !walk.blockedAt(505, 600, { furniture: false }));
  const robe1 = store.addItem({ type: 'wardrobe', x: 800, y: 300, w: 100, d: 60, h: 220, rot: 0, elev: 0, placement: 'floor', level: 'L1' });
  const robe0 = store.addItem({ type: 'wardrobe', x: 800, y: 600, w: 100, d: 60, h: 220, rot: 0, elev: 0, placement: 'floor' });
  check('walk on L1: L1 furniture blocks, L0 furniture does not', walk.blockedAt(800, 300) && !walk.blockedAt(800, 600));
  store.removeItems([robe1.id, robe0.id]);
  walk.start({ level: 'L0', pointerLock: false, x: 700, y: 650 });
  check('walk on L0: eye at 1.65 m, the L0 partition blocks', walk.getLevel() === 'L0' && near(walk.eyePose().position.y, 1.65) && walk.blockedAt(505, 600, { furniture: false }));
  walk.dispose();
  store.removeItems([up.id, down.id, lamp.id]);
}

group('Performance: two storeys vs one');
{
  const one = JSON.parse(JSON.stringify(INPUT)); delete one.levels;
  const single = B.buildPlan(one).plan;
  const time = (basePlan, n = 5) => {
    open(basePlan);
    let best = Infinity, calls = 0;
    for (let i = 0; i < n; i++) { const t0 = performance.now(); const h = buildHouse({ store, plan: PLAN, catalog }); best = Math.min(best, performance.now() - t0); h.setWholeHouse(true); calls = drawn(h.group); h.dispose(); }
    return { ms: best, calls };
  };
  const a = time(single), b = time(DUPLEX_PLAN);
  console.log(`      one storey: ${a.ms.toFixed(1)} ms, ${a.calls} meshes drawn · two storeys: ${b.ms.toFixed(1)} ms, ${b.calls} meshes drawn`);
  check('two storeys: at most 2× the meshes (draw calls) of one', b.calls <= 2 * a.calls, `${b.calls} vs ${a.calls}`);
  check('two storeys: at most 2× the build time of one (+2 ms slack)', b.ms <= 2 * a.ms + 2, `${b.ms.toFixed(1)} vs ${a.ms.toFixed(1)} ms`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
