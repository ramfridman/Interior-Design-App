// Geometry seams (stage G1 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md): golden results of every consumer of wall /
// opening geometry on the built-in house (House 98) and on one edited plan. The numbers in
// tests/fixtures/geometry-golden.json were captured BEFORE the consumers were ported to the general helpers
// (openingFrame, wallPolys, wallFaces with general normals); they must stay equal (numbers to 1e-9, ids and order exact).
//   node tests/geometry.test.mjs            compare with the golden file
//   node tests/geometry.test.mjs --update   rewrite the golden file (only when a change of results is intended)
import { register } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
register('data:text/javascript,' + encodeURIComponent(`
  const base = ${JSON.stringify(new URL('../vendor/three/', import.meta.url).href)};
  export async function resolve(spec, ctx, next) {
    if (spec === 'three') return { url: base + 'three.module.min.js', shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: base + 'addons/' + spec.slice(13), shortCircuit: true };
    return next(spec, ctx);
  }`));

const { PLAN } = await import('../src/core/plan.js');
const { store } = await import('../src/core/store.js');
const { initialLayout } = await import('../src/core/initial-layout.js');
const G = await import('../src/core/geometry.js');
const E = await import('../src/core/plan-edit.js');
const { runChecks } = await import('../src/regulations/index.js');
const RG = await import('../src/regulations/geom.js');
const { roomSides } = await import('../src/regulations/building.js');
const C = await import('../src/carpentry/index.js');
const CW = await import('../src/carpentry/walls.js');
const CC = await import('../src/carpentry/checks.js');
const O2 = await import('../src/view2d/openings.js');
const O3 = await import('../src/view3d/openings.js');
const W = await import('../src/view3d/walk.js');
const D = await import('../src/view3d/daylight/solver.js');
const SN = await import('../src/view2d/snapping.js');
const I3 = await import('../src/view3d/interaction.js');

const GOLDEN = new URL('./fixtures/geometry-golden.json', import.meta.url);
const UPDATE = process.argv.includes('--update');

store.persist = false;
let failed = 0, passed = 0;
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const plain = (v) => JSON.parse(JSON.stringify(v));

// ───────────────────────── capture ─────────────────────────
/** Item poses for wallsHitByItem: fixed probes across walls and openings, plus every item of the initial layout. */
const PROBES = [
  { x: 350, y: 500, w: 60, d: 60, rot: 0 }, { x: 660, y: 975, w: 100, d: 50, rot: 45 }, { x: 1300, y: 300, w: 200, d: 40, rot: 90 },
  { x: 20, y: 900, w: 80, d: 80, rot: 30 }, { x: 800, y: 700, w: 300, d: 30, rot: 0 }, { x: 1060, y: 630, w: 40, d: 160, rot: 0 },
  { x: 500, y: 1300, w: 120, d: 60, rot: 180 }, { x: 1520, y: 900, w: 60, d: 200, rot: 270 }, { x: 900, y: 50, w: 50, d: 50, rot: 15 },
];

/** Sample points (metres) for the daylight chart lookup: a coarse grid at two heights with six normals, plus every wall face. */
function chartSamples(plan) {
  const pts = [], b = plan.bounds, normals = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
  for (let y = b.y + 13; y < b.y + b.h; y += 41) for (let x = b.x + 7; x < b.x + b.w; x += 41) for (const n of normals) pts.push([x / 100, 1.2, y / 100, ...n]);
  for (const f of G.wallFaces(plan)) {
    const mx = (f.x1 + f.x2) / 2 + f.nx * 0.5, my = (f.y1 + f.y2) / 2 + f.ny * 0.5;
    for (const h of [0.05, 1.3, 2.6]) pts.push([mx / 100, h, my / 100, f.nx, 0, f.ny]);
  }
  return pts;
}

/** Points just in front of every wall face (and every room edge, inward) for the carpentry stretch lookup. */
function spanSamples(plan) {
  const pts = [];
  for (const f of CW.facesWithOpenings(plan)) {
    const L = Math.hypot(f.x2 - f.x1, f.y2 - f.y1);
    for (const t of [0.5, 0.15]) pts.push([f.x1 + (f.x2 - f.x1) * t + f.nx * 5, f.y1 + (f.y2 - f.y1) * t + f.ny * 5, L]);
  }
  for (const r of plan.rooms) {
    const p = r.polygon;
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length], len = Math.hypot(x2 - x1, y2 - y1) || 1;
      let nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      if (!G.pointInPolygon(mx + nx * 3, my + ny * 3, p)) { nx = -nx; ny = -ny; }
      pts.push([mx + nx * 8, my + ny * 8, len]);
    }
  }
  return pts;
}

function meshSummary(group) {
  const out = [];
  group.updateMatrixWorld(true);
  group.traverse((m) => {
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position'), a = pos.array;
    let sx = 0, sy = 0, sz = 0, sq = 0;
    for (let i = 0; i < a.length; i += 3) { sx += a[i]; sy += a[i + 1]; sz += a[i + 2]; sq += a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2]; }
    out.push({ name: m.name, material: m.material && m.material.name, count: pos.count, index: m.geometry.index ? m.geometry.index.count : 0, sx, sy, sz, sq, matrix: [...m.matrixWorld.elements] });
  });
  return out;
}

function capturePlan(plan, { full }) {
  const items = store.items;
  const out = {
    wallFaces: G.wallFaces(plan),
    wallFacesCopy: G.wallFaces({ ...plan }),
    walkBlockers: G.walkBlockers(plan),
    wallsHitByItem: [...PROBES, ...items].map((it) => G.wallsHitByItem(it, plan).map((w) => w.id ?? `${w.x},${w.y},${w.w},${w.h}`)),
    findings: plain(runChecks({ store, plan, catalog: null })),
    roomSides: plan.rooms.map((r) => ({ room: r.id, sides: roomSides(plan, r).map((s) => ({ ...s, walls: s.walls.map((w) => w.id), openings: s.openings.map((o) => o.id) })) })),
    doorSwing: plan.openings.map((o) => [o.id, RG.doorSwing(o)]),
    openingSides: plan.openings.map((o) => [o.id, RG.openingSides(o), RG.openingSides(o, 90, 35)]),
    facesWithOpenings: CW.facesWithOpenings(plan),
    wallSpans: spanSamples(plan).map(([x, y]) => [x, y, plain(CW.wallSpanAt(x, y, { plan }))]),
    swingRect: plan.openings.map((o) => [o.id, CC.swingRect(o)]),
    doorSwingHit: [...PROBES, ...items].map((it) => (CC.doorSwingHit(it) || {}).id || null),
    carpentry: plain(C.checkRun('all')),
    clearances: plain(C.listRuns().map((r) => [r.id, C.runClearances(r.id)])),
    drawings: plain(C.listRuns().map((r) => [r.id, C.drawings(r.id)])),
    snapRuns: SN.buildRuns(plan).map((r) => ({ ...r, openings: r.openings.map((q) => ({ ...q, o: q.o.id })) })),
    wallRuns3d: I3.wallRuns(plan),
    walkWalls: W.wallBlockers(plan),
    walkStart: W.defaultWalkStart(plan),
    view2d: plan.openings.map((o) => {
      const f = O2.openingLocalFrame(o);
      return { id: o.id, L: f.L, T: f.T, P: [[0, 0], [f.L, f.T], [f.L * 0.3, f.T * 0.7], [-f.L * 0.2, f.T * 1.4]].map(([u, v]) => f.P(u, v)), faceV: ['n', 's', 'e', 'w'].map((s) => O2.openingFaceV(o, f.T, s)) };
    }),
    view3d: plan.openings.map((o) => ({
      id: o.id, frame: O3.openingFrame(o),
      place: ['n', 's', 'e', 'w'].map((s) => [...O3.openingPlacement(o, s).elements]),
      runBeside: (o.axis === 'h' ? ['w', 'e'] : ['n', 's']).map((s) => O3.wallRunBeside(o, plan, s)),
    })),
  };
  if (full) {
    const ob = O3.buildOpenings(plan, { ceilingH: 3, cutH: null, doorsOpen: true, frameColor: '#2b2d31' });
    out.openingMeshes = meshSummary(ob.group);
    const ob2 = O3.buildOpenings(plan, { ceilingH: 3, cutH: 1.2, doorsOpen: false, frameColor: '#2b2d31', shadowFull: true });
    out.openingMeshesCut = meshSummary(ob2.group);
  }
  const input = D.sceneInputFromPlan(plan);
  const S = D.buildScene(input);
  out.sceneInput = input;
  out.scene = { nx: S.nx, ny: S.ny, charts: S.charts.length, patches: S.patch.count };
  out.chartFor = chartSamples(plan).map((p) => D.chartFor(S, ...p));
  out.patchAt = chartSamples(plan).filter((_, i) => i % 3 === 0).map(([x, y, z, nx, ny, nz]) => D.patchAt(S, x, y, z, [nx, ny, nz]));
  return out;
}

function captureAll() {
  store.load({ items: initialLayout() });
  const res = C.adoptArchitectLayout();
  if (!res.ok) throw new Error('adoptArchitectLayout failed');
  const builtin = capturePlan(PLAN, { full: true });
  // an edited plan: the partition between the bedrooms removed, a small room added in the south-east corner with a door
  const partition = E.wallSegments().find((s) => s.cls === 'partition' && s.between.includes('bedroom-1') && s.between.includes('bedroom-2'));
  const r1 = E.removeWallSegment(partition.id);
  const living = PLAN.rooms.find((r) => r.id === 'main'), east = Math.max(...living.polygon.map((p) => p[0]));
  const south = Math.max(...living.polygon.filter((p) => p[0] === east).map((p) => p[1]));        // SE corner of the living room
  const r2 = E.addWall({ x1: east - 200, y1: south - 90, x2: east - 200, y2: south });
  const r3 = E.addWall({ x1: east - 200, y1: south - 85, x2: east, y2: south - 85 });
  const r4 = E.addOpening({ kind: 'door', x: east - 100, y: south - 85, width: 70 });
  const r5 = E.updateOpening('win-bedroom-1', { x: 1525, y: 1150 });
  const edited = { steps: [r1.ok, r2.ok, r3.ok, r4.ok, r5.ok], ...capturePlan(PLAN, { full: true }) };
  E.resetPlan();
  const reset = { wallFaces: G.wallFaces(PLAN), findings: plain(runChecks({ store, plan: PLAN, catalog: null })) };
  // generated ids (runs, units) carry a time stamp: number them in order of first appearance
  const ids = new Map();
  return JSON.parse(JSON.stringify({ builtin, edited, reset }).replace(/\b(cu|run|it)[-_][a-z0-9]{8,}\b/g, (m, k) => {
    if (!ids.has(m)) ids.set(m, `${k}-#${ids.size}`);
    return ids.get(m);
  }));
}

// ───────────────────────── compare ─────────────────────────
function diff(a, b, path, out) {
  if (out.length >= 20) return;
  if (typeof a === 'number' && typeof b === 'number') { if (!(a === b || Math.abs(a - b) <= 1e-9)) out.push(`${path}: ${a} ≠ ${b}`); return; }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { if (a !== b) out.push(`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); return; }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${path}: array vs object`); return; }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.join('|') !== kb.join('|')) { out.push(`${path}: keys [${ka.join(',')}] ≠ [${kb.join(',')}]`); return; }
  for (const k of ka) diff(a[k], b[k], `${path}.${k}`, out);
}

const now = captureAll();
if (UPDATE || !existsSync(GOLDEN)) {
  mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
  writeFileSync(GOLDEN, JSON.stringify(now) + '\n');
  console.log(`wrote ${GOLDEN.pathname}`);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
check('the edit steps of the edited plan all succeed', now.edited.steps.every(Boolean), JSON.stringify(now.edited.steps));
check('golden covers the built-in plan', now.builtin.wallFaces.length > 50 && now.builtin.findings.length > 50 && now.builtin.chartFor.length > 1000,
  `${now.builtin.wallFaces.length} faces, ${now.builtin.findings.length} findings, ${now.builtin.chartFor.length} chart lookups`);
for (const scen of Object.keys(golden)) {
  for (const key of Object.keys(golden[scen])) {
    const out = [];
    diff(now[scen][key], golden[scen][key], `${scen}.${key}`, out);
    check(`${scen}: ${key}`, out.length === 0, out.slice(0, 5).join('; '));
  }
}
check('no scenario / key missing', JSON.stringify(Object.keys(now).map((s) => [s, Object.keys(now[s])])) === JSON.stringify(Object.keys(golden).map((s) => [s, Object.keys(golden[s])])));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
