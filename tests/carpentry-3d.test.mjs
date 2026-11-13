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
  const island = g.level === 'island', sb = g.spec.splashback, wtop = g.H && g.H.worktop;
  let tap = C.MODULES[u.carp.module] && C.MODULES[u.carp.module].cutout && C.MODULES[u.carp.module].cutout !== 'hob' ? 30 : 4.5;   // a tap stands above the worktop
  if (!island && sb && sb.material !== 'none' && b.y1 > u.h + tap && wtop && near(u.h, wtop, 1)) tap = Math.max(tap, sb.height + (g.spec.worktop.upstand || 0) + 0.5);   // the splashback stands on the worktop                                                             // island fronts (and handles) face −Z
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


// first hit of a ray (local metres) → { z | y (cm), material colour hex } or null
const firstHit = (obj, from, dir) => { obj.updateMatrixWorld(true); const h = new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...dir).normalize()).intersectObject(obj, true)[0]; return h ? { x: h.point.x * 100, y: h.point.y * 100, z: h.point.z * 100, hex: h.object.material.color ? '#' + h.object.material.color.getHexString() : '' } : null; };

group('Splashback and worktop upstand (run spec)');
{
  const north = C.listRuns().find((r) => r.kind === 'kitchen' && C.getRun(r.id).units.some((u) => u.carp.module === 'base-door'));
  const nr = C.getRun(north.id), door = nr.units.find((u) => u.carp.module === 'base-door'), g = C.geometryOf(nr.run, door), wt = g.H.worktop;
  const back = (it, y) => firstHit(models.buildModel(it), [0, y / 100, 1], [0, 0, -1]);     // from the room towards the wall at height y
  const sb0 = nr.run.spec.splashback;
  check('kitchen spec has a splashback (default stone, 55 cm)', sb0 && sb0.material !== 'none' && sb0.height > 0, JSON.stringify(sb0));
  // the elevation drawing is the reference: where it draws splashback, the 3D has a panel; under the window it is cut
  const dr = C.drawings(north.id).find((d) => d.kind === 'elevation');
  const sbOps = dr.ops.filter((o) => o.role === 'splashback');
  const pos = new Map(nr.units.map((u) => [u.id, u.carp.at]));
  const covered = (x) => sbOps.some((o) => x > o.x + 0.5 && x < o.x + o.w - 0.5);
  let agree = 0, total = 0, yes = 0, mism = [];
  for (const u of nr.units.filter((q) => C.levelOf(q) === 'base' && C.MODULES[q.carp.module] && C.MODULES[q.carp.module].worktop)) {
    const x = pos.get(u.id) + u.carp.width / 2, hit = back(store.getItem(u.id), wt + 8);
    const has = !!(hit && hit.z < -u.d / 2 + 2);
    total++; if (has) yes++; if (has === covered(x)) agree++; else mism.push(`${u.carp.module}@${x}: 3D ${has} / drawing ${covered(x)}`);
  }
  check('3D splashback matches the elevation drawing over every base unit (window cut-outs included)', total > 2 && yes > 0 && agree === total, mism.join(' | ') || `${yes} of ${total} units carry splashback`);
  const sbu = nr.units.find((u) => C.levelOf(u) === 'base' && covered(pos.get(u.id) + u.carp.width / 2) && C.MODULES[u.carp.module].worktop) || door;
  let h = back(store.getItem(sbu.id), wt + 20);
  check('a splashback panel stands on the worktop against the wall', h && h.z < -sbu.d / 2 + 2 && h.z > -sbu.d / 2, h ? `${h.z.toFixed(1)} cm (wall at ${(-sbu.d / 2).toFixed(1)})` : 'no hit');
  const top = Math.max(...sbOps.map((o) => o.y + o.h));
  h = back(store.getItem(sbu.id), top + 3);
  check('…up to the height the drawing shows (55 cm or under the wall units)', near(top, wt + sb0.height, 0.6) || top < wt + sb0.height, `top ${top}`);
  check('…and no higher', !h || h.y > top + 1 || h.z < -sbu.d / 2 + 0.01, h ? `${h.y.toFixed(0)} ${h.z.toFixed(1)}` : 'no hit');
  C.updateRun(north.id, { spec: { worktop: { upstand: 10 } } });
  h = back(store.getItem(door.id), wt + 5);
  check('upstand 10 cm: a worktop strip stands in front of the splashback', h && h.z > -door.d / 2 + 1.5 && h.z < -door.d / 2 + 5, h ? `${h.z.toFixed(1)}` : 'no hit');
  for (const material of ['glass', 'tiles']) {
    C.updateRun(north.id, { spec: { splashback: { material } } });
    errors.length = 0;
    const m = models.buildModel(store.getItem(door.id));
    check(`splashback ${material} builds`, !errors.length && meshes(m) > 0, errors[0] || '');
  }
  C.updateRun(north.id, { spec: { splashback: { material: 'none' }, worktop: { upstand: 0 } } });
  h = back(store.getItem(door.id), wt + 20);
  check('splashback "none" and no upstand: nothing above the worktop at the wall', !h || h.z < -door.d / 2 + 0.01 || h.y > wt + 40, h ? `${h.y.toFixed(0)} ${h.z.toFixed(1)}` : '');
  C.updateRun(north.id, { spec: { splashback: sb0 } });
  const isl = C.listRuns().find((r) => r.kind === 'island');
  if (isl) { const iu = C.getRun(isl.id).units[0], b = boundsOf(models.buildModel(store.getItem(iu.id))); check('islands get no splashback', b.y1 < iu.h + 31, b.y1.toFixed(1)); }
}

group('Lift-off (removable) doors read as such while closed');
{
  const r = C.addUnit(host.runId, 'base-door', { width: 60, fronts: { operation: 'hinged' } });
  const it = () => store.getItem(r.unitId), g = C.geometryOf(C.getRun(host.runId).run, it()), f = g.fronts.find((q) => q.kind === 'door');
  const hinged = models.buildModel(it()), nH = meshes(hinged), bH = boundsOf(hinged);
  C.updateUnit(r.unitId, { fronts: { operation: 'removable' } });
  const rem = models.buildModel(it()), bR = boundsOf(rem);
  check('closed lift-off door has extra detail (hinges, shadow-gap rebate)', meshes(rem) > nH, `${nH} → ${meshes(rem)}`);
  const X = (x) => (x - g.w / 2) / 100, y = (f.y + f.h / 2 - g.elev) / 100, face = firstHit(rem, [X(f.x + f.w / 2), y, 1], [0, 0, -1]);
  const ex = f.hinge === 'R' ? f.x + f.w - 0.3 : f.x + 0.3, hy = (f.y + 0.6 + 11 - 2 - g.elev) / 100;
  const knuckle = firstHit(rem, [X(ex), hy, 1], [0, 0, -1]), noKnuckle = firstHit(hinged, [X(ex), hy, 1], [0, 0, -1]);
  check('exposed lift-off hinges on the hinge edge, standing proud of the door face', knuckle && face && knuckle.z > face.z + 0.3 && (!noKnuckle || noKnuckle.z <= face.z + 0.01), knuckle ? `hinge ${knuckle.z.toFixed(2)} vs face ${face.z.toFixed(2)}` : 'no hit');
  const gap = firstHit(rem, [X(f.x + 0.3), y, 1], [0, 0, -1]), mid = firstHit(rem, [X(f.x + f.w / 2), y, 1], [0, 0, -1]);
  check('a dark shadow gap all round the leaf (rebate seen through it)', gap && mid && gap.z < mid.z - 1 && gap.hex === '#1b1c1f', gap ? `${gap.z.toFixed(1)} ${gap.hex} vs door ${mid && mid.z.toFixed(1)}` : 'no hit');
  const open = boundsOf(models.buildModel({ ...it(), view: { open: true } }));
  check('open: the door is lifted off and set aside in front', open.z1 > bR.z1 + 20, `${open.z1.toFixed(1)}`);
  C.removeUnit(r.unitId);
}

group('Sliding wardrobe doors follow the run\'s door split (as the elevation)');
{
  const wr = C.createRun({ kind: 'wardrobe', anchor: { x: 2000, y: 3400, dir: 0 }, length: 250, freeStanding: true });
  check('a free wardrobe run', wr.ok, wr.reason && wr.reason.en);
  const a = C.addUnit(wr.runId, 'wardrobe-sliding', { width: 100 }), b = C.addUnit(wr.runId, 'wardrobe-sliding', { width: 120 });
  check('two sliding carcasses 100 + 120', a.ok && b.ok, ((a.reason || b.reason) || {}).en);
  if (a.ok && b.ok) {
    const el = C.drawings(wr.runId).find((d) => d.kind === 'elevation');
    const label = el.ops.find((o) => o.t === 'text' && /sliding doors/.test(o.text.en || o.text));
    const n = label ? parseInt((label.text.en || label.text), 10) : 0;
    check('elevation: 3 sliding doors over 220 cm', n === 3, label && (label.text.en || label.text));
    const units = C.getRun(wr.runId).units, at = new Map(units.map((u) => [u.id, u.carp.at]));
    const depthAt = (xr) => { const u = units.find((q) => xr > at.get(q.id) && xr < at.get(q.id) + q.carp.width), gg = C.geometryOf(C.getRun(wr.runId).run, u); const hh = firstHit(models.buildModel(store.getItem(u.id)), [(xr - at.get(u.id) - u.carp.width / 2) / 100, (gg.zone.y0 + gg.zone.y1) / 200 - gg.elev / 100, 2], [0, 0, -1]); return hh ? hh.z - u.d / 2 : null; };
    const track = (xr) => { const d = depthAt(xr); return d == null ? 'none' : d > -3 ? 'front' : 'rear'; };
    // 220 cm, 3 doors of 75.3 overlapping 3 cm: door 0 = 0..75.3 (front) · door 1 = 72.3..147.7 (rear) · door 2 = 144.7..220 (front)
    const probes = [[40, 'front'], [80, 'rear'], [120, 'rear'], [160, 'front'], [210, 'front']];
    const got = probes.map(([x]) => track(x));
    check('door tracks along the run match the 3-door split (front / rear / front, across the carcass joint at 100)', probes.every(([, t], i) => got[i] === t), probes.map(([x], i) => `${x.toFixed(0)}:${got[i]}`).join(' '));
    errors.length = 0;
    for (const u of units) models.buildModel({ ...store.getItem(u.id), view: { open: true } });
    check('sliding wardrobes build open', !errors.length, errors[0] || '');
  }
}

group('Studio light (view3d/carpentry.js)');
{
  const el = () => ({ style: {}, className: '', append() {}, remove() {}, replaceChildren() {}, addEventListener() {} });
  globalThis.document ??= { createElement: el, documentElement: {} };
  const { createCarpentryLayer } = await import('../src/view3d/carpentry.js');
  const scene = new THREE.Scene(), renderer = { clippingPlanes: [], toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.37 };
  scene.environmentIntensity = 0.14;
  const fakeItems = { setVariant() {}, setViewHidden() {}, setMarked() {}, resync() {}, boxOf: () => null };
  let walking = false;
  const layer = createCarpentryLayer({ scene, renderer, ctx: { store, plan: { walls: [] } }, items: fakeItems, rig: { frameBox() {} }, overlay: el(), invalidate() {}, isWalking: () => walking });
  const sun = new THREE.DirectionalLight(0xffffff, 2.2), env = { sun }, cam = new THREE.PerspectiveCamera();
  cam.position.set(3, 1.6, 4); cam.lookAt(0, 1, 0); cam.updateMatrixWorld();
  const kRun = C.listRuns().find((r) => r.kind === 'kitchen');
  check('off until a run is shown', layer.beginFrame(cam, { env }) === null);
  layer.show({ runId: kRun.id, studio: true });
  const undo = layer.beginFrame(cam, { env });
  const lights = scene.children.filter((o) => o.isDirectionalLight);
  check('studio on: neutral tone mapping, fixed exposure, sun eased, two white lights', undo && renderer.toneMapping === THREE.NeutralToneMapping && renderer.toneMappingExposure === 1 && sun.intensity < 2.2 && lights.length === 2 && lights.every((l) => l.intensity > 0 && l.color.getHex() === 0xffffff && !l.castShadow));
  undo();
  check('after the render everything is back exactly', renderer.toneMapping === THREE.ACESFilmicToneMapping && renderer.toneMappingExposure === 1.37 && sun.intensity === 2.2 && scene.environmentIntensity === 0.14 && lights.every((l) => l.intensity === 0));
  walking = true;
  check('walk mode: never', layer.beginFrame(cam, { env }) === null);
  walking = false;
  layer.show({ studio: false });
  check('toggle off: never', layer.beginFrame(cam, { env }) === null);
  layer.show({ studio: true, runId: null });
  check('tab left (no run): never', layer.beginFrame(cam, { env }) === null && layer.state().studioLit === false);
  layer.dispose();
  check('dispose removes the studio lights', !scene.children.some((o) => o.isDirectionalLight));
}

console.error = origError;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
