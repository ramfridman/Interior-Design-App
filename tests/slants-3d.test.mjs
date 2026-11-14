// Angled walls in the 3D view — stage A4 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md. Headless (plain node, like
// tests/levels-3d.test.mjs): the Wedge (tests/fixtures/houses.mjs) built by src/view3d/shell-poly.js through house.js.
//   node tests/slants-3d.test.mjs
// Checks: the shell is a closed 2-manifold (every edge in exactly two triangles, also cut away), wall faces carry the
// material of the space they face, the window in s01 and the door in s02 have reveals / sill / lintel and correctly
// placed frames (no NaN anywhere), floor areas, skirting lengths, House 98 meshes unchanged, a two-level house with the
// Wedge upstairs (slab / roof / terrace areas), the daylight fallback (slants block light, angled faces read the room
// average), build time and draw calls.
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
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ctx2d), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ width: 0, height: 0, style: {}, className: '', getContext: () => ctx2d, append() {}, appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {} });
globalThis.document ??= { createElement: el, documentElement: {}, addEventListener() {}, removeEventListener() {} };
globalThis.performance ??= { now: () => Date.now() };

const THREE = await import('three');
const { PLAN } = await import('../src/core/plan.js');
const { store } = await import('../src/core/store.js');
const { buildHouse } = await import('../src/view3d/house.js');
const SP = await import('../src/view3d/shell-poly.js');
const B = await import('../src/core/plan-build.js');
const G = await import('../src/core/geometry.js');
const K = await import('../src/core/polykernel.js');
const LV = await import('../src/core/levels.js');
const D = await import('../src/view3d/daylight/solver.js');
const { WEDGE } = await import('./fixtures/houses.mjs');

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const catalog = { getProduct: () => null };
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const open = (basePlan) => store.openProject({ basePlan, phase: 'draft', design: { items: [], project: { ceilingHeight: basePlan.heights.ceiling } } });

// ───────────────────────── helpers ─────────────────────────
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
const meshesOf = (root, pick) => { const out = []; root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.index && o.geometry.index.count && pick(o.name)) out.push(o); }); return out; };
/** Triangles of meshes as world-space [a, b, c] (THREE.Vector3) + the stored normal of the first corner. */
function trisOf(meshes) {
  const out = [];
  for (const m of meshes) {
    m.updateMatrixWorld(true);
    const p = m.geometry.attributes.position, n = m.geometry.attributes.normal, idx = m.geometry.index.array;
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]].map((i) => new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m.matrixWorld));
      out.push({ v, n: n ? new THREE.Vector3(n.getX(idx[t]), n.getY(idx[t]), n.getZ(idx[t])) : null, mesh: m.name });
    }
  }
  return out;
}
/** Closed 2-manifold test: every undirected edge in exactly two triangles, once in each direction. */
function manifold(tris) {
  const key = (v) => `${Math.round(v.x * 1e5)},${Math.round(v.y * 1e5)},${Math.round(v.z * 1e5)}`;
  const und = new Map(), dir = new Map();
  let degenerate = 0;
  for (const { v } of tris) {
    const k = v.map(key);
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) { degenerate++; continue; }
    for (let i = 0; i < 3; i++) {
      const a = k[i], b = k[(i + 1) % 3], u = a < b ? a + '|' + b : b + '|' + a;
      und.set(u, (und.get(u) || 0) + 1); dir.set(a + '>' + b, (dir.get(a + '>' + b) || 0) + 1);
    }
  }
  const bad = [...und].filter(([, c]) => c !== 2), flipped = [...dir].filter(([k, c]) => { const [a, b] = k.split('>'); return c !== 1 || dir.get(b + '>' + a) !== 1; });
  return { edges: und.size, bad: bad.length, flipped: flipped.length, degenerate, sample: bad.slice(0, 3).map(([k, c]) => `${k}×${c}`).join(' ') };
}
function nanFree(root) {
  let bad = [];
  root.traverse((o) => {
    if (!o.isMesh && !o.isLine) return;
    const g = o.geometry;
    for (const [k, a] of Object.entries(g.attributes)) for (const v of a.array) if (!Number.isFinite(v)) { bad.push(`${o.name}.${k}`); break; }
    g.computeBoundingSphere();
    if (!g.boundingSphere || !Number.isFinite(g.boundingSphere.radius) || !Number.isFinite(g.boundingSphere.center.x)) bad.push(`${o.name}.boundingSphere`);
  });
  return bad;
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
const meshNamed = (root, name) => { let m = null; root.traverse((o) => { if (o.isMesh && o.name === name) m = o; }); return m; };
const shellOf = (house, level = 'L0') => house.group.getObjectByName('level:' + level).getObjectByName('house-shell');
/** The closed wall shell: every wall soup except skirting and plinth (trim that stands on / beside it). */
const wallTris = (house, level) => trisOf(meshesOf(shellOf(house, level), (n) => n.startsWith('wall:') && n !== 'wall:skirting' && n !== 'wall:plinth'));

// ───────────────────────── the Wedge ─────────────────────────
const W = B.buildPlan({ walls: WEDGE.walls, slants: WEDGE.slants, openings: WEDGE.openings, heights: WEDGE.heights, meta: { name: 'Wedge' } }, { slants: true }).plan;
const H98 = JSON.parse(JSON.stringify(PLAN));
open(W);
const east = PLAN.rooms.find((r) => r.polygon.some(([x]) => x > 900)), nw = PLAN.rooms.find((r) => r.polygon.length === 3), west = PLAN.rooms.find((r) => r !== east && r !== nw);
const win = PLAN.openings.find((o) => o.id === 'win-s01'), door = PLAN.openings.find((o) => o.id === 'door-s02');

group('The Wedge builds with the general shell');
const house = buildHouse({ store, plan: PLAN, catalog });
{
  const names = new Set(meshesOf(house.group, () => true).map((m) => m.name));
  check('one level, its walls by room + exterior, cap, skirting, plinth, floors per room, ceilings, roof, openings',
    ['wall:ext', `wall:room:${east.id}`, `wall:room:${nw.id}`, `wall:room:${west.id}`, 'wall:cap', 'wall:skirting', 'wall:plinth', `floor:${east.id}`, `floor:${nw.id}`, `floor:${west.id}`, 'ceilings', 'roof:top', 'roof:ext', 'roof:coping', 'openings:glass', 'openings:door'].every((n) => names.has(n)),
    [...names].join(' '));
  const bad = nanFree(house.group);
  check('no NaN in any geometry attribute or bounding sphere (walls, floors, roof, openings)', bad.length === 0, bad.slice(0, 5).join(' '));
  house.setDoorsOpen(true);
  check('… nor with the doors open', nanFree(house.group).length === 0);
  house.setDoorsOpen(false);
}

group('Watertight: every edge of the wall shell in exactly two triangles');
{
  const m = manifold(wallTris(house));
  check(`full height: ${m.edges} edges, closed and consistently oriented`, m.bad === 0 && m.flipped === 0 && m.degenerate === 0, JSON.stringify(m));
  for (const cut of [120, 95, 30]) {
    house.setCutaway(cut);
    const c = manifold(wallTris(house));
    check(`cut away at ${cut} cm: still closed (the section caps the cut)`, c.bad === 0 && c.flipped === 0 && c.degenerate === 0, JSON.stringify(c));
  }
  house.setCutaway(null);
  // normals point away from the solid: 1 cm behind a vertical face is wall, 1 cm in front is not
  const geo = SP.preparePolyLevel(PLAN), inFull = (x, y) => !!K.pointInPolys(x, y, geo.full);
  let wrong = 0, total = 0;
  for (const t of wallTris(house)) {
    if (Math.abs(t.n.y) > 0.5) continue;
    const c = t.v[0].clone().add(t.v[1]).add(t.v[2]).multiplyScalar(1 / 3), n2 = Math.hypot(t.n.x, t.n.z);
    const x = c.x * 100, y = c.z * 100, nx = t.n.x / n2, ny = t.n.z / n2;
    total++;
    if (!inFull(x - nx, y - ny) || (inFull(x + nx, y + ny) && !geo.ops.some((p) => G.pointInPolygon(x + nx, y + ny, p.poly)))) { wrong++; if (process.env.DBG) console.log(t.mesh, x.toFixed(2), y.toFixed(2), c.y.toFixed(2), nx.toFixed(3), ny.toFixed(3), inFull(x - nx, y - ny), inFull(x + nx, y + ny)); }
  }
  check(`every vertical face normal points out of the wall (${total} triangles)`, wrong === 0, `${wrong} wrong`);
}

group('Materials: each wall face carries the space it looks at');
{
  const geo = SP.preparePolyLevel(PLAN);
  const tris = trisOf(meshesOf(shellOf(house), (n) => n.startsWith('wall:room:') || n === 'wall:ext'));
  let wrong = 0, checked = 0, revealRoomSide = 0;
  const angled = new Map();                                  // material → triangles on angled faces
  for (const t of tris) {
    if (Math.abs(t.n.y) > 0.5) continue;
    const c = t.v[0].clone().add(t.v[1]).add(t.v[2]).multiplyScalar(1 / 3), n2 = Math.hypot(t.n.x, t.n.z);
    const x = c.x * 100 + (t.n.x / n2) * 2, y = c.z * 100 + (t.n.z / n2) * 2;
    if (Math.abs(t.n.x) > 0.05 && Math.abs(t.n.z) > 0.05) angled.set(t.mesh, (angled.get(t.mesh) || 0) + 1);
    if (geo.ops.some((p) => G.pointInPolygon(x, y, p.poly))) { if (t.mesh.startsWith('wall:room:')) revealRoomSide++; continue; }   // a reveal
    const s = G.spaceAt(x, y, PLAN), want = s && s.kind === 'room' ? 'wall:room:' + s.id : 'wall:ext';
    checked++; if (want !== t.mesh) wrong++;
  }
  check(`${checked} face triangles: room finish / exterior render by the space in front`, wrong === 0, `${wrong} wrong`);
  check('angled faces: the east trapezoid (s01 inside), the NW triangle and the west room (both faces of s02), the exterior (s01 outside)',
    angled.get(`wall:room:${east.id}`) > 0 && angled.get(`wall:room:${nw.id}`) > 0 && angled.get(`wall:room:${west.id}`) > 0 && angled.get('wall:ext') > 0, JSON.stringify([...angled]));
  check('reveals: their room-side parts carry room finishes', revealRoomSide > 0, String(revealRoomSide));
}

group('Openings in the slants: reveals, sill, lintel, frames on the wall line');
{
  const all = trisOf(meshesOf(shellOf(house), (n) => n.startsWith('wall:') && n !== 'wall:skirting' && n !== 'wall:plinth'));
  /** Triangles inside an opening's gap (frame coordinates of the centroid: |along| ≤ L/2 + ε, |across| ≤ T/2 + ε). */
  const inGap = (o, eps = 0.5) => {
    const F = G.openingFrame(o, PLAN);
    return all.filter((t) => {
      const c = t.v[0].clone().add(t.v[1]).add(t.v[2]).multiplyScalar(1 / 3), dx = c.x * 100 - F.cx, dy = c.z * 100 - F.cy;
      return Math.abs(dx * F.ux + dy * F.uy) <= F.L / 2 + eps && Math.abs(dx * F.nx + dy * F.ny) <= F.T / 2 + eps;
    }).map((t) => ({ ...t, F }));
  };
  for (const [o, sill] of [[win, 0.9], [door, 0]]) {
    const g = inGap(o), F = G.openingFrame(o, PLAN);
    const jambs = g.filter((t) => Math.abs(t.n.y) < 0.1 && Math.abs(Math.abs(t.n.x * F.ux + t.n.z * F.uy) - 1) < 1e-3);
    const head = (sill * 100 + o.height) / 100;
    const lintel = g.filter((t) => t.n.y < -0.99 && t.v.every((v) => Math.abs(v.y - head) < 1e-4));
    const sillTop = g.filter((t) => t.n.y > 0.99 && t.v.every((v) => Math.abs(v.y - sill) < 1e-4));
    const jambMats = new Set(jambs.map((t) => t.mesh)), lintelMats = new Set(lintel.map((t) => t.mesh));
    const area = (ts) => ts.reduce((s, t) => s + new THREE.Triangle(...t.v).getArea(), 0) * 1e4;
    check(`${o.id}: jambs at both ends (along ±u of the slant), split room / other side`, jambs.length >= 4 && jambMats.size === 2, [...jambMats].join(' '));
    check(`${o.id}: lintel underside at ${head.toFixed(2)} m = the gap (${(o.width * o.t).toFixed(0)} cm²), both materials`, Math.abs(area(lintel) - o.width * o.t) < 1 && lintelMats.size === 2, `${area(lintel).toFixed(1)} cm² ${[...lintelMats].join(' ')}`);
    if (sill > 0) check(`${o.id}: sill top at ${sill} m = the gap`, Math.abs(area(sillTop) - o.width * o.t) < 1, `${area(sillTop).toFixed(1)} cm²`);
  }
  // window: glass parallel to s01, inside the wall thickness, centred on the opening
  const F = G.openingFrame(win, PLAN), glass = trisOf([meshNamed(house.group, 'openings:glass')]).filter((t) => {
    const c = t.v[0].clone().add(t.v[1]).add(t.v[2]).multiplyScalar(1 / 3); return Math.hypot(c.x * 100 - F.cx, c.z * 100 - F.cy) < 150;
  });
  const across = glass.flatMap((t) => t.v.map((v) => (v.x * 100 - F.cx) * F.nx + (v.z * 100 - F.cy) * F.ny));
  const along = glass.flatMap((t) => t.v.map((v) => (v.x * 100 - F.cx) * F.ux + (v.z * 100 - F.cy) * F.uy));
  check('window glass lies in the slant (parallel to s01, within its thickness, within its width)', glass.length > 0
    && glass.every((t) => Math.abs(Math.abs(t.n.x * F.nx + t.n.z * F.ny) - 1) < 1e-3 || Math.abs(t.n.y) > 0.99 || Math.abs(Math.abs(t.n.x * F.ux + t.n.z * F.uy) - 1) < 1e-3)
    && Math.max(...across.map(Math.abs)) <= F.T / 2 && Math.max(...along.map(Math.abs)) <= F.L / 2, `across ±${Math.max(...across.map(Math.abs)).toFixed(1)} along ±${Math.max(...along.map(Math.abs)).toFixed(1)}`);
  // door in s02: closed in the wall, open towards 'r' on hinge 'a'
  const Fd = G.openingFrame(door, PLAN);
  const doorPts = () => trisOf([meshNamed(house.group, 'openings:door')]).flatMap((t) => t.v).filter((v) => Math.hypot(v.x * 100 - Fd.cx, v.z * 100 - Fd.cy) < 120)
    .map((v) => ({ a: (v.x * 100 - Fd.cx) * Fd.ux + (v.z * 100 - Fd.cy) * Fd.uy, n: (v.x * 100 - Fd.cx) * Fd.nx + (v.z * 100 - Fd.cy) * Fd.ny }));
  const shut = doorPts();
  check('door in s02, closed: the leaf and frame stay in the wall line (± 13 cm of the centre line)', shut.length > 0 && shut.every((p) => Math.abs(p.n) <= 13 && Math.abs(p.a) <= 46), `max across ${Math.max(...shut.map((p) => Math.abs(p.n))).toFixed(1)}`);
  house.setDoorsOpen(true);
  const swung = doorPts(), far = swung.filter((p) => Math.abs(p.n) > 40);
  check(`door in s02, open: swings to its 'r' side (into the west room) on hinge 'a' (the start jamb)`, far.length > 0 && far.every((p) => p.n > 0 && p.a < -20), `${far.length} pts, along ${Math.min(...far.map((p) => p.a)).toFixed(0)}…${Math.max(...far.map((p) => p.a)).toFixed(0)}`);
  house.setDoorsOpen(false);
}

group('Floors and skirting from the exact room polygons');
{
  const thr = (r) => PLAN.openings.filter((o) => !(o.sill > 0) && (o.rooms || []).find((id) => PLAN.rooms.some((q) => q.id === id)) === r.id)
    .reduce((s, o) => s + (o.axis === 'a' ? o.width * o.t : o.w * o.h), 0);
  for (const r of PLAN.rooms) {
    const m = meshNamed(house.group, 'floor:' + r.id), want = G.polygonArea(r.polygon) + thr(r), got = flatArea(m, 1);
    check(`floor of ${r.id}: room polygon ${(G.polygonArea(r.polygon) / 1e4).toFixed(3)} m² + door thresholds, within 1 cm²`, Math.abs(got - want) < 1, `${got.toFixed(2)} vs ${want.toFixed(2)} cm²`);
  }
  const geo = SP.preparePolyLevel(PLAN), dry = new Set(PLAN.rooms.filter((r) => !r.wet).map((r) => r.id));
  const K0 = { Strips: class { constructor() { this.idx = []; } add() { this.idx.push(0); } }, wallShade: () => 1, SKIRT_H: 0.07, SKIRT_T: 0.012, AO_FLOOR: { width: 0.45, alpha: 0.34 }, AO_CEILING: { width: 0.4, alpha: 0.2 }, WALL_FADE: 0.45 };
  const { stats } = SP.buildPolyShell(geo, { top: 3, ceiling: 3, plinthDepth: 0.27, dryRooms: dry, K: K0 });
  const perim = (p) => p.reduce((s, q, i) => s + Math.hypot(p[(i + 1) % p.length][0] - q[0], p[(i + 1) % p.length][1] - q[1]), 0);
  for (const r of PLAN.rooms) {
    const doors = PLAN.openings.filter((o) => !(o.sill > 0) && (o.rooms || []).includes(r.id)).reduce((s, o) => s + o.width, 0);
    const want = dry.has(r.id) ? perim(r.polygon) - doors : 0, got = stats.skirting.get(r.id) || 0;
    check(`skirting of ${r.id}${dry.has(r.id) ? '' : ' (wet: none)'} = perimeter − door widths (${(want / 100).toFixed(2)} m)`, Math.abs(got - want) < 0.05, `${got.toFixed(2)} cm`);
  }
  const sk = meshNamed(house.group, 'wall:skirting');
  check('skirting boards follow the angled faces (mesh has non-axis normals)', sk && trisOf([sk]).some((t) => Math.abs(t.n.x) > 0.1 && Math.abs(t.n.z) > 0.1));
  const ao = meshNamed(house.group, 'ao:floor');
  check('contact-shade strips along every room face (any angle)', ao && ao.geometry.index.count > 0);
}

group('Roof from the polygon footprint (the slanted exterior wall)');
{
  const fp = LV.footprintOf(PLAN).area, top = flatArea(meshNamed(house.group, 'roof:top'), 1);
  check('roof slab top = the footprint (± 1 cm²)', Math.abs(top - fp) < 1, `${top.toFixed(1)} vs ${fp.toFixed(1)}`);
}

group('House 98: every mesh byte-identical (tests/fixtures/house98-mesh-hashes.json)');
{
  open(H98);
  const h = buildHouse({ store, plan: PLAN, catalog });
  const states = {};
  const snap = (name) => { states[name] = meshHashes(h.group); };
  snap('default');
  h.setRoofVisible(true); snap('roof');
  h.setRoofVisible(false); h.setCutaway(120); snap('cutaway');
  h.setSunStudy(false); snap('cutaway-no-study');
  h.setSunStudy(true); h.setCutaway(null); h.setDoorsOpen(true); snap('doors-open');
  h.setDoorsOpen(false); h.rebuildPlan(); snap('rebuilt');
  h.dispose();
  const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/house98-mesh-hashes.json', import.meta.url), 'utf8'));
  for (const [state, meshes] of Object.entries(golden)) {
    const got = states[state] || {}, diff = Object.keys({ ...meshes, ...got }).filter((k) => meshes[k] !== got[k]);
    check(`${state}: ${Object.keys(meshes).length} meshes identical`, diff.length === 0, diff.slice(0, 3).join(' '));
  }
}

group('Two levels: the Wedge upstairs over a rectangle');
{
  const EXT = [{ id: 'w01', x: 0, y: 0, w: 1000, h: 20, kind: 'exterior' }, { id: 'w02', x: 0, y: 780, w: 1000, h: 20, kind: 'exterior' }, { id: 'w03', x: 0, y: 20, w: 20, h: 760, kind: 'exterior' }, { id: 'w04', x: 980, y: 20, w: 20, h: 760, kind: 'exterior' }];
  const input = {
    walls: EXT, openings: [{ id: 'door-entry', kind: 'door', style: 'entry', axis: 'h', x: 200, y: 780, w: 90, h: 20, width: 90, height: 210, sill: 0, hinge: 'w', swing: 'n' }],
    heights: WEDGE.heights, meta: { name: 'Wedge over a box', floors: 2 },
    levels: [{ id: 'L1', name: 'First floor', elevation: 320, heights: { ceiling: 280, slab: 20, parapet: 40 }, walls: WEDGE.walls, slants: WEDGE.slants,
      openings: WEDGE.openings.filter((o) => o.id !== 'door-entry'), voids: [], outdoorAreas: [] }],
  };
  const built = B.buildPlan(input, { levels: true, slants: true });
  check('buildPlan: two levels, the slants on L1', built.ok && built.plan.levels && (built.plan.levels[0].slants || []).length === 2, JSON.stringify((built.warnings || []).filter((w) => w.level === 'error')));
  open(built.plan);
  const h2 = buildHouse({ store, plan: PLAN, catalog });
  h2.setWholeHouse(true);
  const g1 = h2.group.getObjectByName('level:L1');
  check('L1 placed at its elevation, built by the general shell (angled faces)', g1 && Math.abs(g1.position.y - 3.2) < 1e-9
    && trisOf(meshesOf(g1, (n) => n.startsWith('wall:room:'))).some((t) => Math.abs(t.n.x) > 0.1 && Math.abs(t.n.z) > 0.1));
  const m1 = manifold(wallTris(h2, 'L1'));
  check('L1 wall shell closed', m1.bad === 0 && m1.flipped === 0, JSON.stringify(m1));
  check('no NaN on either level', nanFree(h2.group).length === 0);
  const view1 = LV.levelOf(PLAN, 'L1');
  const fp0 = LV.footprintOf(PLAN).area, fp1 = LV.footprintOf(B.buildPlan ? (await import('../src/core/plan-edit.js')).levelPlan(PLAN, 'L1') : view1).area;
  const slab = flatArea(meshNamed(g1, 'slab'), -1), roof1 = flatArea(meshNamed(g1, 'roof:top'), 1), terrace = flatArea(meshNamed(h2.group.getObjectByName('level:L0'), 'roof:top'), 1);
  check(`slab under L1 = its footprint (${(fp1 / 1e4).toFixed(2)} m²)`, Math.abs(slab - fp1) < 1, `${slab.toFixed(1)} vs ${fp1.toFixed(1)}`);
  check('L1 roof = its footprint', Math.abs(roof1 - fp1) < 1, `${roof1.toFixed(1)}`);
  check(`L0 roof = the terrace east of s01 = L0 footprint − L1 footprint (${((fp0 - fp1) / 1e4).toFixed(2)} m²)`, Math.abs(terrace - (fp0 - fp1)) < 1 && terrace > 1e4, `${terrace.toFixed(1)} vs ${(fp0 - fp1).toFixed(1)}`);
  h2.dispose();
}

group('Daylight fallback: slants occlude, angled faces read the room average');
{
  open(W);
  const input = D.sceneInputFromPlan(PLAN, { doorsOpen: true }), S = D.buildScene(input);
  // every cell under the slants' footprints (outside their gaps) is solid in the occlusion grid
  const polys = G.slantPolys(PLAN), gaps = PLAN.openings.filter((o) => o.axis === 'a').map((o) => G.openingPoly(o, PLAN));
  let holes = 0, cells = 0;
  for (let j = 0; j < S.ny; j++) for (let i = 0; i < S.nx; i++) {
    const x = (S.ox + (i + 0.5) * D.CELL_M) * 100, y = (S.oz + (j + 0.5) * D.CELL_M) * 100;
    if (!polys.some((p) => G.pointInPolygon(x, y, p)) || gaps.some((q) => G.pointInPolygon(x, y, q))) continue;
    cells++; if (S.kind[j * S.nx + i] !== 2) holes++;
  }
  check(`slant footprints rasterised as wall cells (${cells} cells)`, cells > 0 && holes === 0, `${holes} open`);
  // 4-connected leak test: from inside the NW triangle, a flood through non-wall cells (doors / windows closed = their cells)
  // must not reach the west room except through the door gap
  const F = G.openingFrame(win, PLAN), c = S.chartByKey;
  const winK = S.openingIds.indexOf('win-s01'), doorK = S.openingIds.indexOf('door-s02');
  check('the openings in the slants are in the solve (rasterised gaps, sill / head)', winK >= 0 && doorK >= 0 && Math.abs(S.oSill[winK] - 0.9) < 1e-6 && Math.abs(S.oHead[winK] - 2.1) < 1e-6 && S.oAxisN[winK] === 3);
  const flood = () => {
    const seen = new Uint8Array(S.nx * S.ny), start = Math.floor((1.0 - S.oz) / D.CELL_M) * S.nx + Math.floor((1.0 - S.ox) / D.CELL_M), q = [start];
    seen[start] = 1;
    while (q.length) { const k = q.pop(), i = k % S.nx, j = (k - i) / S.nx; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= S.nx || jj >= S.ny) continue; const n = jj * S.nx + ii; if (seen[n] || S.kind[n] === 2 || S.kind[n] === 3) continue; seen[n] = 1; q.push(n); } }
    return seen;
  };
  const seen = flood(), westCell = Math.floor((4.0 - S.oz) / D.CELL_M) * S.nx + Math.floor((3.0 - S.ox) / D.CELL_M);
  check('s02 (10 cm at 45°) is watertight in the 5 cm grid: no 4-connected leak from the NW triangle to the west room', seen[Math.floor((1.0 - S.oz) / D.CELL_M) * S.nx + Math.floor((1.0 - S.ox) / D.CELL_M)] && !seen[westCell]);
  // a render face on s01 (inside, angled normal) maps to the east room's average chart; an axis face keeps its own chart
  const mid = [F.cx + F.ux * 200 + F.nx * (F.T / 2), F.cy + F.uy * 200 + F.ny * (F.T / 2)];
  const ch = D.chartFor(S, mid[0] / 100, 1.5, mid[1] / 100, F.nx, 0, F.ny), eastIdx = S.roomIds.indexOf(east.id);
  check('chartFor on the inner face of s01 → the east room\'s average chart (the fallback)', ch >= 0 && S.charts[ch].type === 'a' && S.charts[ch].region === eastIdx, String(ch >= 0 && S.charts[ch].key));
  const axis = D.chartFor(S, 0.2 + 0.001, 1.5, 6.0, 1, 0, 0);
  check('chartFor on a straight wall face of the same level → its own wall chart', axis >= 0 && S.charts[axis].type === 'v');
  // light enters through the window in s01: the east room is lit
  const V = D.computeVisibility(S, { coarse: true });
  const L = D.relight(S, V, { sky: 'overcast', sunDir: [0, 0.8, 0.6] });
  const mean = (room) => { let s = 0, n = 0; for (let p = 0; p < S.patch.count; p++) if (S.patch.region[p] === room && S.patch.surf[p] === D.SURF.FLOOR) { s += L.lightmap[S.texelOf[p] * 4 + 1]; n++; } return n ? s / n : 0; };
  // the same 120 × 120 window in a straight east wall of a larger box room: the angled one must not lose its light
  // (a supercover that closed the gap's mouth once let through ~ 1/4)
  const BOX = B.buildPlan({ walls: WEDGE.walls.concat([{ id: 'w05', x: 980, y: 20, w: 20, h: 760, kind: 'exterior' }, { id: 'w06', x: 600, y: 780, w: 400, h: 20, kind: 'exterior' }]),
    openings: WEDGE.openings.filter((o) => o.axis !== 'a').concat([{ id: 'win-e', kind: 'window', style: 'sliding', axis: 'v', x: 980, y: 340, w: 20, h: 120, width: 120, height: 120, sill: 90 }]),
    heights: WEDGE.heights, meta: { name: 'Box' } }).plan;
  const Sb = D.buildScene(D.sceneInputFromPlan(BOX, { doorsOpen: true })), Lb = D.relight(Sb, D.computeVisibility(Sb, { coarse: true }), { sky: 'overcast', sunDir: [0, 0.8, 0.6] });
  const boxEast = Sb.roomIds.indexOf(BOX.rooms.find((r) => r.polygon.some(([x]) => x > 900)).id);
  let sb = 0, nb = 0; for (let p = 0; p < Sb.patch.count; p++) if (Sb.patch.region[p] === boxEast && Sb.patch.surf[p] === D.SURF.FLOOR) { sb += Lb.lightmap[Sb.texelOf[p] * 4 + 1]; nb++; }
  check('light enters through the window in s01: the east room (20.4 m²) is lit at least as well as a 35 m² box room with the same window in a straight wall',
    mean(eastIdx) > sb / nb, `${mean(eastIdx).toExponential(2)} vs ${(sb / nb).toExponential(2)}`);
  // House 98's solver input is unchanged (no slant keys)
  open(H98);
  const in98 = D.sceneInputFromPlan(PLAN, { doorsOpen: true });
  check('House 98 solver input has no slant keys', !('slants' in in98) && in98.openings.every((o) => o.axis !== 'a'));
}

group('Performance: the Wedge vs an orthogonal house of similar size');
{
  const time = (plan) => {
    open(plan);
    const h = buildHouse({ store, plan: PLAN, catalog });
    const ts = []; for (let i = 0; i < 15; i++) ts.push(h.rebuildPlan());
    let draws = 0; h.group.traverse((o) => { if (o.isMesh && o.geometry.index && o.geometry.index.count && !o.userData.shadowOnly) { let v = true; for (let q = o; q; q = q.parent) if (!q.visible) v = false; if (v) draws++; } });
    let tris = 0; h.group.traverse((o) => { if (o.isMesh && o.geometry.index) tris += o.geometry.index.count / 3; });
    h.dispose();
    return { ms: median(ts), draws, tris };
  };
  const ORTHO = B.buildPlan({ walls: WEDGE.walls.concat([{ id: 'w05', x: 980, y: 20, w: 20, h: 760, kind: 'exterior' }, { id: 'w06', x: 600, y: 780, w: 400, h: 20, kind: 'exterior' }, { id: 'w07', x: 20, y: 300, w: 480, h: 10, kind: 'interior' }]),
    openings: WEDGE.openings.filter((o) => o.axis !== 'a').concat([{ id: 'win-e', kind: 'window', style: 'sliding', axis: 'v', x: 980, y: 340, w: 20, h: 120, width: 120, height: 120, sill: 90 }, { id: 'door-w', kind: 'door', style: 'interior', axis: 'h', x: 200, y: 300, w: 80, h: 10, width: 80, height: 210, sill: 0, hinge: 'w', swing: 's' }]),
    heights: WEDGE.heights, meta: { name: 'Box' } }).plan;
  const w = time(W), o = time(ORTHO);
  console.log(`      Wedge: ${w.ms.toFixed(1)} ms, ${w.draws} draw calls, ${w.tris} triangles · orthogonal box of the same size: ${o.ms.toFixed(1)} ms, ${o.draws} draw calls, ${o.tris} triangles`);
  check('Wedge build (median rebuild) under 30 ms', w.ms < 30, `${w.ms.toFixed(1)} ms`);
  check('draw calls comparable to the orthogonal house (≤ +3)', w.draws <= o.draws + 3, `${w.draws} vs ${o.draws}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
