// Carpentry 3D model (src/models/carpentry.js) under plain node: bare 'three' imports are mapped to vendor/three.
//   node tests/carpentry-3d.test.mjs
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
  const base = ${JSON.stringify(new URL('../vendor/three/', import.meta.url).href)};
  export async function resolve(spec, ctx, next) {
    if (spec === 'three') return { url: base + 'three.module.min.js', shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: base + 'addons/' + spec.slice(13), shortCircuit: true };
    return next(spec, ctx);
  }`));

const THREE = await import('three');
const { store } = await import('../src/core/store.js');
const { initialLayout } = await import('../src/core/initial-layout.js');
const C = await import('../src/carpentry/index.js');
const models = await import('../src/models/index.js');
await models.loadModels();

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const errors = [];
const origError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); };

/** Model bounds in cm (local frame: x across, y up, z depth). */
function boundsOf(obj) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3();
  obj.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
  return { x0: b.min.x * 100, x1: b.max.x * 100, y0: b.min.y * 100, y1: b.max.y * 100, z0: b.min.z * 100, z1: b.max.z * 100 };
}
const meshes = (o) => { let n = 0; o.traverse((x) => { if (x.isMesh) n++; }); return n; };
const near = (a, b, e = 0.6) => Math.abs(a - b) <= e;

group('Routing');
store.addItems(initialLayout(), { select: false });
const adopt = C.adoptArchitectLayout();
check('architect layout adopted', adopt.ok);
const units = store.items.filter((i) => i.carp);
check('every carpentry unit keeps its generic type (contract § 8)', units.every((u) => u.type !== 'carpentry-unit'));
check('the registry routes carpentry items to carpentry-unit', models.hasModel('carpentry-unit'));

group('Every adopted unit builds and fits its box');
const box = new Map();
let bad = [];
for (const u of units) {
  const m = models.buildModel(u), b = boundsOf(m), n = meshes(m);
  box.set(u.id, b);
  if (u.hidden) continue;
  const g = C.geometryOf(C.runOfItem(u), u);
  if (g.corner) continue;
  const tap = C.MODULES[u.carp.module] && C.MODULES[u.carp.module].cutout && C.MODULES[u.carp.module].cutout !== 'hob' ? 30 : 4.5;   // a tap stands above the worktop
  const island = g.level === 'island';                                                             // island fronts (and handles) face −Z
  const ok = n > 0 && near(b.x0, -u.w / 2, 1) && near(b.x1, u.w / 2, 1) && b.y0 > -0.6 && b.y1 > u.h - 0.6 && b.y1 <= u.h + tap
    && (island ? b.z0 >= -u.d / 2 - 4.5 && near(b.z1, u.d / 2, 1) : near(b.z0, -u.d / 2, 1) && b.z1 <= u.d / 2 + 4.5);
  if (!ok) bad.push(`${u.carp.module} ${u.w}×${u.d}×${u.h} → x ${b.x0.toFixed(1)}..${b.x1.toFixed(1)} y ${b.y0.toFixed(1)}..${b.y1.toFixed(1)} z ${b.z0.toFixed(1)}..${b.z1.toFixed(1)}`);
}
check(`${units.length} units: bounds = w × d × h (handles / taps may stand proud of the front / top)`, !bad.length, bad.slice(0, 4).join(' | '));
check('no build errors', !errors.length, errors.slice(0, 2).join(' | '));

group('Every module id builds (closed and open)');
const run = C.listRuns().find((r) => r.kind === 'kitchen');
const host = C.createRun({ kind: 'custom', anchor: { x: 2000, y: 2000, dir: 0 }, length: 2000 });
check('a free test run', host.ok, host.reason && host.reason.en);
const fails = [];
for (const id of Object.keys(C.MODULES)) {
  const mod = C.MODULES[id];
  const levels = mod.level === 'any' ? ['base', 'wall', 'tall', 'full'] : [mod.level];
  for (const level of levels) {
    const opts = { width: mod.w.std, ...(mod.level === 'any' ? { level } : {}) };
    if (id === 'custom') Object.assign(opts, C.customLayoutTemplate('bar-niche'), { width: 80 });
    const r = C.addUnit(host.runId, id, opts);
    if (!r.ok) { fails.push(`${id}/${level}: add refused (${r.reason && r.reason.en})`); continue; }
    const it = store.getItem(r.unitId);
    for (const open of [false, true]) {
      errors.length = 0;
      const m = models.buildModel(open ? { ...it, view: { open: true } } : it);
      if (errors.length || !meshes(m)) fails.push(`${id}/${level}${open ? ' open' : ''}: ${errors[0] || 'no meshes'}`);
    }
    C.removeUnit(r.unitId);
  }
}
check('all modules × levels build without error, closed and with open fronts', !fails.length, fails.slice(0, 4).join(' | '));

group('Open fronts');
const doorUnit = units.find((u) => u.carp.module === 'base-door' || u.carp.module === 'base-sink');
const drawerUnit = units.find((u) => u.carp.module === 'base-drawers' || u.carp.module === 'base-hob');
if (doorUnit) {
  const a = boundsOf(models.buildModel(doorUnit)), b = boundsOf(models.buildModel({ ...doorUnit, view: { open: true } }));
  check('open doors swing out in front of the unit', b.z1 > a.z1 + 20, `front ${a.z1.toFixed(1)} → ${b.z1.toFixed(1)} cm`);
}
if (drawerUnit) {
  const a = boundsOf(models.buildModel(drawerUnit)), b = boundsOf(models.buildModel({ ...drawerUnit, view: { open: true } }));
  check('drawers pulled ~30 cm', b.z1 - a.z1 > 20 && b.z1 - a.z1 < 40, `${(b.z1 - a.z1).toFixed(1)} cm`);
}
const op = C.addUnit(host.runId, 'base-door', { width: 60, fronts: { operation: 'none' } });
const nOpen = meshes(models.buildModel(store.getItem(op.unitId)));
C.updateUnit(op.unitId, { fronts: { operation: 'hinged' } });
check('operation "none" has no doors (fewer meshes than hinged)', nOpen < meshes(models.buildModel(store.getItem(op.unitId))));
C.removeUnit(op.unitId);

group('Tall corner pantry occupies both arms');
const kr = C.createRun({ kind: 'pantry', anchor: { x: 2000, y: 2600, dir: 0 }, length: 300 });
const cp = C.addUnit(kr.runId, 'tall-corner-pantry', { width: 110, internals: { cornerPantry: 'l-doors', shelves: 5 } });
check('corner pantry added', cp.ok, cp.reason && cp.reason.en);
if (cp.ok) {
  const it = store.getItem(cp.unitId), g = C.geometryOf(C.getRun(kr.runId).run, it);
  const b = boundsOf(models.buildModel(it));
  check('bounding box = legA × legB × h', near(b.x1 - b.x0, g.w, 1) && near(b.z1 - b.z0, it.d, 1) && near(b.y1, it.h, 1), `${(b.x1 - b.x0).toFixed(1)} × ${(b.z1 - b.z0).toFixed(1)} × ${b.y1.toFixed(1)}`);
  // the inside of the L (in front of both faces) must stay empty at mid height
  const m = models.buildModel(it); m.updateMatrixWorld(true);
  const side = g.corner.side, X = (u) => ((side === 'L' ? u : g.w - u) - g.w / 2) / 100, Z = (v) => (v - it.d / 2) / 100;
  const probe = (u, v) => { const rc = new THREE.Raycaster(new THREE.Vector3(X(u), 3, Z(v)), new THREE.Vector3(0, -1, 0)); return rc.intersectObject(m, true).some((h) => h.point.y > 0.5 && h.point.y < 2.2); };
  const k = g.corner;
  check('carcass on arm A (along this run)', probe(k.legA - 10, k.dA / 2));
  check('carcass on arm B (along the other run)', probe(k.dB / 2, k.legB - 10));
  check('the inside of the L is open floor', !probe((k.dB + k.legA) / 2 + 5, (k.dA + k.legB) / 2 + 5));
  check('walk footprint is the L polygon', ((models.getModel('carpentry-unit').footprint(it) || {}).poly || []).length === 6 && models.getModel('carpentry-unit').footprint(it).rects.length === 2);
  const nClosed = meshes(m), open = boundsOf(models.buildModel({ ...it, view: { open: true } }));
  check('corner pantry builds open (doors swing beyond the faces)', nClosed > 10 && (open.z1 > b.z1 + 5 || open.x1 > b.x1 + 5 || open.x0 < b.x0 - 5));
  for (const variant of ['diagonal', 'walk-in']) {
    const r2 = C.updateUnit(cp.unitId, { internals: { cornerPantry: variant }, ...(variant === 'walk-in' ? { width: 130, legB: 130 } : {}) });
    errors.length = 0;
    models.buildModel(store.getItem(cp.unitId));
    check(`corner pantry variant ${variant} builds`, r2.ok !== false && !errors.length, (r2.reason && r2.reason.en) || errors[0] || '');
  }
}

group('Worktop and cut-outs');
const sink = units.find((u) => u.carp.module === 'base-sink');
if (sink) {
  const m = models.buildModel(sink); m.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(new THREE.Vector3(0, 2, 0.02), new THREE.Vector3(0, -1, 0));
  const hits = rc.intersectObject(m, true).map((h) => h.point.y * 100);
  check('sink cut-out: a ray down the bowl centre passes the worktop level', hits.length && hits[0] < sink.h - 4, hits.map((y) => y.toFixed(0)).join(', '));
}

console.error = origError;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
