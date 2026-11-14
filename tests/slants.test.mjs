// Angled walls in the plan engine — stage A1 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md ("mixed derive"): plans with
// slants load and are fully derived (rooms, classes, sides, outline, segments, openings in slants), survive every
// round trip (plan state, store, project file, collab doc), work per level, and come from buildPlan / the importer.
// The "Wedge" test house is in tests/fixtures/houses.mjs.
//   node tests/slants.test.mjs
import { PLAN } from '../src/core/plan.js';
import { store } from '../src/core/store.js';
import * as E from '../src/core/plan-edit.js';
import * as B from '../src/core/plan-build.js';
import * as G from '../src/core/geometry.js';
import * as K from '../src/core/polykernel.js';
import * as L from '../src/core/levels.js';
import * as SG from '../src/core/slant-geom.js';
import * as P from '../src/core/projects.js';
import * as OPS from '../src/collab/ops.js';
import { FEATURES } from '../src/core/features.js';
import { WEDGE } from './fixtures/houses.mjs';

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const clone = (o) => JSON.parse(JSON.stringify(o));
const H98 = JSON.stringify(PLAN);
const area = (poly) => G.polygonArea(poly);
const shoelace = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const timeIt = (f, n = 40) => { for (let i = 0; i < 10; i++) f(); const ts = []; for (let i = 0; i < n; i++) { const t = performance.now(); f(); ts.push(performance.now() - t); } return median(ts); };

// ───────────────────────── the Wedge, built ─────────────────────────
const INPUT = { walls: WEDGE.walls, slants: WEDGE.slants, openings: WEDGE.openings, heights: WEDGE.heights, meta: { name: 'Wedge' } };
const built = B.buildPlan(INPUT, { slants: true });
const W = built.plan;
const S01 = WEDGE.slants[0], S02 = WEDGE.slants[1];

/** Analytic room polygons of the Wedge (from the design's centre lines and thicknesses). */
function analytic() {
  // s02: centre x + y = 325, t 10 → faces x + y = 325 ∓ 5√2
  const lf = 325 - 5 * Math.SQRT2, rf = 325 + 5 * Math.SQRT2;
  const nw = [[20, 20], [lf - 20, 20], [20, lf - 20]];
  const west = [[rf - 20, 20], [500, 20], [500, 780], [20, 780], [20, rf - 20]];
  // s01: the inner (right-hand) face, offset 10 along n = (−uy, ux)
  const f = SG.slantFrame(S01), px = S01.x1 + f.nx * 10, py = S01.y1 + f.ny * 10;
  const xAt = (y) => px + ((y - py) * f.ux) / f.uy;
  const east = [[510, 20], [xAt(20), 20], [xAt(780), 780], [510, 780]];
  return { nw, west, east };
}

group('buildPlan: the Wedge with the slants option');
{
  check('ok, schema 2, slants s01 / s02 kept on their centre lines, kinds from the derive', built.ok && W.schema === 2 && W.slants.length === 2
    && W.slants.every((s, i) => ['x1', 'y1', 'x2', 'y2', 't'].every((k) => s[k] === WEDGE.slants[i][k]) && s.id === WEDGE.slants[i].id)
    && W.slants[0].kind === 'exterior' && W.slants[1].kind === 'interior', JSON.stringify(built.warnings.filter((w) => w.level !== 'info')));
  check('optional keys last (schema, slants); no poly stored', JSON.stringify(Object.keys(W).slice(-2)) === '["schema","slants"]' && W.slants.every((s) => !('poly' in s)));
  check('3 rooms', W.rooms.length === 3, String(W.rooms.length));
  const A = analytic(), got = W.rooms.map((r) => area(r.polygon)).sort((a, b) => a - b), want = [A.nw, A.east, A.west].map(shoelace).sort((a, b) => a - b);
  check('room areas = the analytic polygons, |Δ| < 1 cm² each', got.every((a, i) => near(a, want[i], 1)), `got ${got.map((a) => a.toFixed(2)).join(', ')} want ${want.map((a) => a.toFixed(2)).join(', ')}`);
  const east = W.rooms.find((r) => r.polygon.some(([x]) => x > 900));
  check('east trapezoid ≈ 20.43 m² with inner vertices (510,20) (973.6,20) (583.9,780) (510,780)', near(area(east.polygon) / 1e4, WEDGE.expect.eastRoomArea, 0.005)
    && [[510, 20], [973.6, 20], [583.9, 780], [510, 780]].every(([x, y]) => east.polygon.some((p) => near(p[0], x, 0.06) && near(p[1], y, 0.06))), JSON.stringify(east.polygon));
  const win = W.openings.find((o) => o.id === 'win-s01'), door = W.openings.find((o) => o.id === 'door-s02');
  const nw = W.rooms.find((r) => r.polygon.length === 3), westRoom = W.rooms.find((r) => r !== nw && r !== east);
  check('window in s01: rooms [east room, outside], exterior, outside l (computed)', win && win.exterior === true && win.outside === WEDGE.expect.windowOutside && win.rooms[0] === east.id && win.rooms[1] === 'outside', JSON.stringify(win && win.rooms));
  check('door in s02: rooms [NW triangle, west room] (l side, r side), not exterior', door && !door.exterior && door.rooms[0] === nw.id && door.rooms[1] === westRoom.id, JSON.stringify(door && door.rooms));
  const f1 = SG.slantFrame(S01), [cx, cy] = SG.pointAt(S01, win.at);
  check('derived fields of an opening in a slant: cx, cy, angle, t, AABB x y w h', near(win.cx, cx, 1e-9) && near(win.cy, cy, 1e-9) && near(win.angle, f1.angle, 1e-9) && win.t === 20
    && (() => { const q = SG.openingQuad(S01, win.at, win.width); const b = K.bounds([q]); return near(win.x, b.x, 1e-3) && near(win.w, b.w, 1e-3) && near(win.y, b.y, 1e-3) && near(win.h, b.h, 1e-3); })());
  check('rect openings unchanged in shape (partition door, entry door with outside s)', W.openings.find((o) => o.id === 'door-part').rooms.length === 2 && W.openings.find((o) => o.id === 'door-entry').outside === 's');
  check('bounds 0…1000 × 0…800', JSON.stringify(W.bounds) === JSON.stringify({ x: 0, y: 0, w: 1000, h: 800 }), JSON.stringify(W.bounds));
}

group('the Wedge as a fixed base plan: segments, classes, policy');
{
  E.setBasePlan(W, { phase: 'fixed' });
  check('opens unmodified, currentPlanData byte-identical', !E.isPlanModified() && JSON.stringify(E.currentPlanData()) === JSON.stringify(W));
  const segs = E.wallSegments(), a = segs.filter((s) => s.axis === 'a'), r = segs.filter((s) => s.axis !== 'a');
  const s1 = a.find((s) => s.id === 'seg:a:s01'), s2 = a.find((s) => s.id === 'seg:a:s02');
  check('wallSegments: rect and slant segments (one per slant)', r.length >= 5 && a.length === 2 && s1 && s2, segs.map((s) => s.id).join(' '));
  check('s01 exterior and locked', s1.cls === 'exterior' && s1.kind === 'exterior' && s1.policy.level === 'locked' && s1.policy.reason === E.REASONS.exteriorWall);
  check('s02 a free partition', s2.cls === 'partition' && s2.kind === 'interior' && s2.policy.level === 'free');
  const east = PLAN.rooms.find((x) => x.polygon.some(([px]) => px > 900)), nw = PLAN.rooms.find((x) => x.polygon.length === 3), west = PLAN.rooms.find((x) => x !== east && x !== nw);
  check('slant sides: s01 [outside, east room], s02 [NW triangle, west room] ([l, r])', JSON.stringify(s1.between) === JSON.stringify(['outside', east.id]) && JSON.stringify(s2.between) === JSON.stringify([nw.id, west.id]), JSON.stringify([s1.between, s2.between]));
  check('slant segment fields: centre line, t, poly, AABB, length, openingIds, freeEnds, core', s1.x1 === 990 && s1.y2 === 790 && s1.t === 20 && s1.thickness === 20 && Array.isArray(s1.poly) && s1.poly.length >= 4
    && near(s1.length, Math.hypot(400, 780), 1e-9) && JSON.stringify(s1.openingIds) === '["win-s01"]' && JSON.stringify(s2.openingIds) === '["door-s02"]'
    && JSON.stringify(s1.freeEnds) === '[false,false]' && s1.core.x === s1.x && s1.isNew === false && s1.slantId === 's01');
  const part = r.find((s) => s.axis === 'v' && s.core.x === 500), north = r.find((s) => s.axis === 'h' && s.core.y === 0 && s.core.x === 510);
  check('rect segments next to slants: the partition [west, east], the north wall east part [outside, east] and exterior / locked', part && JSON.stringify(part.between) === JSON.stringify([west.id, east.id]) && part.cls === 'partition'
    && north && north.cls === 'exterior' && north.policy.level === 'locked' && JSON.stringify(north.between) === JSON.stringify(['outside', east.id]), JSON.stringify([part && part.between, north && north.between]));
  check('openings in slants: window permit (exterior), door free', E.openingPolicy('win-s01').level === 'permit' && E.openingPolicy('door-s02').level === 'free');
  const solids = [...PLAN.walls, ...PLAN.openings.filter((o) => o.axis !== 'a'), ...G.slantPolys(PLAN), ...PLAN.openings.filter((o) => o.axis === 'a').map((o) => G.openingPoly(o))];
  const u = K.union(solids);
  check('union of all solids = one outer ring (the 3 rooms are its holes)', u.length === 1 && u[0].holes.length === 3, `${u.length} rings`);
  check('slantPolys = the segments\' polys (joinSlants, the same numbers)', JSON.stringify(G.slantPolys(PLAN).map((p) => p.map((q) => q.slice()))) === JSON.stringify([s1.poly, s2.poly]));
  check('wallOutline: diagonal entries, every entry from its west / north end, sorted', PLAN.wallOutline.some(([x1, y1, x2, y2]) => x1 !== x2 && y1 !== y2)
    && PLAN.wallOutline.every(([x1, y1, x2, y2]) => x1 < x2 || (x1 === x2 && y1 < y2)));

  group('queries: segmentAt, openingFrame, wallFaces, walkBoxes, wallPolys');
  const [mx, my] = SG.pointAt(S01, 200), f1 = SG.slantFrame(S01);
  check('segmentAt on the slant centre line → seg:a:s01', E.segmentAt(mx, my) && E.segmentAt(mx, my).id === 'seg:a:s01');
  check('segmentAt 4 cm beyond its outer face (tol 6) → s01; 30 cm away → null', E.segmentAt(mx - f1.nx * 14, my - f1.ny * 14)?.id === 'seg:a:s01' && E.segmentAt(mx - f1.nx * 40, my - f1.ny * 40) === null);
  check('segmentAt inside a rect wall → the rect segment (rects first)', E.segmentAt(505, 600)?.id === part.id && E.segmentAt(250, 10)?.axis === 'h');
  const win = PLAN.openings.find((o) => o.id === 'win-s01'), door = PLAN.openings.find((o) => o.id === 'door-s02');
  const F = G.openingFrame(win), [wx, wy] = SG.pointAt(S01, win.at);
  check('openingFrame(\'a\'): centre, unit direction x1→x2, right normal, L = width, T = t, angle', near(F.cx, wx, 1e-9) && near(F.cy, wy, 1e-9) && near(F.ux, f1.ux, 1e-12) && near(F.uy, f1.uy, 1e-12)
    && near(F.nx, f1.nx, 1e-12) && near(F.ny, f1.ny, 1e-12) && F.L === 120 && F.T === 20 && near(F.angle, f1.angle, 1e-9));
  const corner = G.openingPoint(F, 0, 0), q = SG.openingQuad(S01, win.at, win.width);
  check('openingPoint(F, 0, 0) = the start jamb on the left face; openingPoly = the gap quad', near(corner[0], wx - f1.ux * 60 - f1.nx * 10, 1e-9) && near(corner[1], wy - f1.uy * 60 - f1.ny * 10, 1e-9)
    && near(K.netArea([G.openingPoly(win)]), K.netArea([q]), 0.01) && near(K.intersectArea(G.openingPoly(win), q), K.netArea([q]), 0.1));
  const { cx, cy, angle, t, x, y, w, h, ...bare } = win;
  const Fb = G.openingFrame(bare, PLAN);
  check('openingFrame without derived fields: from the slant in plan.slants, same frame', ['cx', 'cy', 'ux', 'uy', 'nx', 'ny', 'L', 'T', 'x0', 'y0'].every((k) => near(Fb[k], F[k], 1e-9)));
  check('faces / jambs: l = −normal, hinge a = start jamb', G.openingFaceSign(win, 'l') === -1 && G.openingFaceSign(win, 'r') === 1 && G.openingFaceName(win, -1) === 'l' && G.openingJambSign(door, 'a') === -1);
  const hg = G.openingHinge(door), f2 = SG.slantFrame(S02), [dx0, dy0] = SG.pointAt(S02, door.at - 40);
  check('openingHinge of the s02 door (hinge a, swing r): on the start jamb, right face; opens along +n', near(hg.x, dx0 + f2.nx * 5, 1e-9) && near(hg.y, dy0 + f2.ny * 5, 1e-9) && near(hg.open[0], f2.nx, 1e-12) && near(hg.open[1], f2.ny, 1e-12));
  const faces = G.wallFaces(PLAN), diag = faces.filter((fc) => fc.x1 !== fc.x2 && fc.y1 !== fc.y2);
  const outer01 = diag.filter((fc) => near(fc.nx, -f1.nx, 1e-5) && near(fc.ny, -f1.ny, 1e-5)), inner01 = diag.filter((fc) => near(fc.nx, f1.nx, 1e-5) && near(fc.ny, f1.ny, 1e-5));
  check('wallFaces: s01 faces with true unit normals away from the wall (outer → left / outdoors, inner → right / room)', outer01.length >= 2 && inner01.length >= 2 && diag.every((fc) => near(Math.hypot(fc.nx, fc.ny), 1, 1e-9)), `${outer01.length} outer, ${inner01.length} inner`);
  const along = (fc) => [SG.atOf(S01, fc.x1, fc.y1), SG.atOf(S01, fc.x2, fc.y2)].sort((p, q2) => p - q2);
  check('…split at the window: no s01 face crosses its gap', [...outer01, ...inner01].every((fc) => { const [p, q2] = along(fc); return q2 <= win.at - 60 + 0.01 || p >= win.at + 60 - 0.01; }));
  const boxes = G.walkBoxes(PLAN), rot = boxes.filter((b) => b.cos !== 1);
  const inBox = (b, px, py) => { const dx = px - b.cx, dy = py - b.cy, u = dx * b.cos + dy * b.sin, v = -dx * b.sin + dy * b.cos; return Math.abs(u) <= b.hw && Math.abs(v) <= b.hh; };
  check('walkBoxes: the slants as rotated boxes (cos / sin of their direction), half thickness across', rot.some((b) => near(b.cos, f1.ux, 1e-12) && near(b.sin, f1.uy, 1e-12) && b.hh === 10) && rot.some((b) => near(b.cos, f2.ux, 1e-12) && b.hh === 5));
  check('…the s02 door is passable, the s01 window blocks', !boxes.some((b) => inBox(b, door.cx, door.cy)) && boxes.some((b) => inBox(b, win.cx, win.cy)));
  check('walkBlockers (axis-aligned) never get an opening in a slant', G.walkBlockers(PLAN).length === PLAN.walls.length + PLAN.openings.filter((o) => o.kind === 'window' && o.axis !== 'a').length);
  const wp = G.wallPolys(PLAN);
  check('wallPolys: the rects in plan.walls order, then the slant polys (ids s01, s02)', wp.length === PLAN.walls.length + 2 && wp.slice(0, PLAN.walls.length).every((p, i) => p.id === PLAN.walls[i].id) && wp[PLAN.walls.length].id === 's01' && wp[PLAN.walls.length + 1].id === 's02');
  check('inWall / inWallOrOpening: inside s01 yes; in the s01 window gap only "or opening"', G.inWall(mx, my) && G.inWallOrOpening(win.cx, win.cy) && !G.inWall(win.cx, win.cy));
  check('spaceAt in the trapezoid → the east room', G.spaceAt(700, 400)?.id === east.id);
  const fp = L.footprintOf(PLAN);
  check('footprintOf: the slants count (one polygon, area = solids + rooms)', fp.polygons.length === 1 && near(fp.area, K.netArea([{ outer: u[0].outer, holes: [] }]), 1), `${fp.area.toFixed(1)} vs ${K.netArea([{ outer: u[0].outer, holes: [] }]).toFixed(1)}`);
}

group('existing mutations on a level with slants (decision: walls refused until A2; openings in rect walls, rooms, removals work)');
{
  E.setBasePlan(W, { phase: 'fixed' });
  const events = [];
  const off = store.on('plan', (e) => events.push(e));
  const part = E.wallSegments().find((s) => s.axis === 'v' && s.core.x === 500);
  const refusals = [
    E.canAddWall({ x1: 600, y1: 100, x2: 600, y2: 600 }), E.addWall({ x1: 600, y1: 100, x2: 600, y2: 600 }), E.removeWallSegment(part.id), E.moveWallSegment(part.id, 20),
    E.resizeWallSegment(part.id, { end: 700 }), E.removeWallSegment('seg:a:s02'),
  ];
  check('addWall / canAddWall / remove / move / resize (rect or slant) are refused with the angled-walls reason, nothing changes', refusals.every((r) => !r.ok && r.reason === E.REASONS.angledWalls) && !E.isPlanModified() && events.length === 0);
  check('updateOpening / flipDoor of an opening in a slant: refused with its reason', !E.updateOpening('door-s02', { width: 90 }).ok && E.updateOpening('door-s02', { width: 90 }).reason === E.REASONS.angledOpening && E.flipDoor('door-s02', 'hinge').reason === E.REASONS.angledOpening);
  check('addOpening next to a slant → refused (A2); in a rect wall → works', E.addOpening({ kind: 'door', x: 162, y: 162 }).reason === E.REASONS.angledOpening);
  const add = E.addOpening({ kind: 'door', x: 505, y: 200, width: 80 });
  const nd = PLAN.openings.find((o) => o.id === add.ids[0]);
  check('…a door in the partition: added with its rooms, the slants and their openings kept and re-derived', add.ok && nd && nd.rooms.length === 2 && JSON.stringify(PLAN.slants) === JSON.stringify(W.slants)
    && PLAN.openings.find((o) => o.id === 'win-s01').outside === 'l' && PLAN.rooms.length === 3 && E.wallSegments().some((s) => s.id === 'seg:a:s01'), add.reason);
  const up = E.updateOpening('door-part', { width: 90 }), flip = E.flipDoor('door-part', 'swing');
  check('updateOpening / flipDoor of a door in a rect wall work (slants kept)', up.ok && flip.ok && PLAN.openings.find((o) => o.id === 'door-part').width === 90 && PLAN.openings.find((o) => o.id === 'door-part').swing === 'w'
    && JSON.stringify(PLAN.slants) === JSON.stringify(W.slants), JSON.stringify([up, flip]));
  store.undo(); store.undo();
  const st = E.planState();
  check('planState carries schema + slants (no poly), openings in slants with their derived fields', st && st.schema === 2 && JSON.stringify(st.slants) === JSON.stringify(W.slants) && st.openings.some((o) => o.axis === 'a' && Number.isFinite(o.cx)));
  const rm = E.removeOpening('door-s02');
  const nwId = PLAN.rooms.find((x) => x.polygon.length === 3);
  check('removeOpening of the s02 door works (the gap becomes wall: the NW triangle has no door)', rm.ok && !PLAN.openings.some((o) => o.id === 'door-s02') && rm.warnings.some((w) => /no door/.test(w)) && !!nwId, JSON.stringify(rm));
  const ren = E.updateRoom(PLAN.rooms[0].id, { name: 'Studio' });
  check('updateRoom works', ren.ok && PLAN.rooms[0].name === 'Studio');
  const diff = E.planDiff();
  check('planDiff lists the new door, the closed slant door (and the renamed room is a modification)', diff.changed && diff.items.some((i) => i.kind === 'opening-added') && diff.items.some((i) => i.kind === 'opening-removed' && i.ref === 'door-s02' && Number.isFinite(i.at.x)), JSON.stringify(diff.items.map((i) => i.kind)));
  store.undo(); store.undo(); store.undo();
  check('undo ×3 → the base plan again, byte-identical', !E.isPlanModified() && JSON.stringify(E.currentPlanData()) === JSON.stringify(W));
  store.redo();
  check('redo → the added door again', PLAN.openings.some((o) => o.id === add.ids[0]) && E.isPlanModified());
  E.resetPlan();
  check('resetPlan → base', !E.isPlanModified() && JSON.stringify(E.currentPlanData()) === JSON.stringify(W));
  off && off();
}

group('state round trips: planState → applyPlanState, store, project file, collab doc');
{
  const adapter = P.createMemoryAdapter();
  const projects = P.createProjects({ store, adapter });
  const cr = await projects.create({ name: 'Wedge', fromPlan: W, phase: 'fixed' });
  check('a project from the Wedge plan opens (isPlanData ok)', cr.ok && P.isPlanData(W) && JSON.stringify(E.BASE_PLAN) === JSON.stringify(W));
  E.updateRoom(PLAN.rooms[1].id, { name: 'Salon' });
  E.addOpening({ kind: 'window', x: 300, y: 10, width: 100 });
  const edited = JSON.stringify(E.currentPlanData()), key = E.planStateKey(), state = clone(E.planState());
  check('edited (room name + a window in the north wall)', E.isPlanModified() && state.openings.length === W.openings.length + 1);
  E.applyPlanState(null);
  check('applyPlanState(null) → base', !E.isPlanModified() && JSON.stringify(E.currentPlanData()) === JSON.stringify(W));
  const back = E.applyPlanState(state);
  check('applyPlanState(saved state) → the edited plan, byte-identical', back.ok && JSON.stringify(E.currentPlanData()) === edited && E.planStateKey() === key, back.reason);
  const file = clone(store.serialize());
  store.load(clone({ ...file, planEdits: null }));
  store.load(clone(file));
  check('store serialize → load: byte-identical', JSON.stringify(E.currentPlanData()) === edited && E.planStateKey() === key);
  const exp = await projects.exportFile();
  const imp = await projects.importFile(exp.text);
  check('project file export → import → open: base and edits byte-identical', imp.ok && JSON.stringify(E.BASE_PLAN) === JSON.stringify(W) && JSON.stringify(E.currentPlanData()) === edited);
  const record = { id: 'w1', name: 'Wedge', phase: 'fixed', basePlan: clone(W), design: clone(store.serialize()) };
  const doc = OPS.recordToDoc(record);
  check('collab doc: recordToDoc / docToRecord keep the plan, the op check passes', JSON.stringify(OPS.docToRecord(doc).basePlan) === JSON.stringify(W) && JSON.stringify(doc.e.plan.edits) === JSON.stringify(record.design.planEdits)
    && OPS.validateOps([{ k: 'plan', p: doc.e.plan }]) === '');
  const { createStoreBridge } = await import('../src/collab/bridge.js');
  const bridge = createStoreBridge(store, {});
  await projects.create({ from: 'house98', name: 'House' });
  check('(back on House 98 in between)', E.isBuiltinBase() && JSON.stringify(PLAN) === H98);
  bridge.openDoc(clone(doc));
  check('collab: opening the doc in a store gives the same base and edited plan', JSON.stringify(E.BASE_PLAN) === JSON.stringify(W) && JSON.stringify(E.currentPlanData()) === edited);
  const tampered = clone(state);
  tampered.slants[0] = { ...tampered.slants[0], x2: tampered.slants[0].x2 + 40 };
  const tr = E.applyPlanState(tampered);
  check('a state that moves the locked exterior slant is refused (base restored)', !tr.ok && /do not fit/.test(tr.reason) && !E.isPlanModified());
  const badA = E.applyPlanState({ ...clone(state), openings: [...state.openings, { id: 'x', kind: 'door', axis: 'a', wall: 's02' }] });
  check('an opening in a slant without at / width is unreadable', !badA.ok && /not readable/.test(badA.reason));
  await projects.create({ from: 'house98', name: 'House' });
  check('back to House 98: byte-identical, no optional keys', JSON.stringify(PLAN) === H98 && E.isBuiltinBase() && E.planStateKey() === 'null');
}

group('a schema-1 plan, one slant added in a saved state, then removed again → the schema-1 bytes');
{
  const rect = B.buildPlan({ walls: [[0, 0, 820, 20, 'exterior'], [0, 620, 820, 20, 'exterior'], [0, 20, 20, 600, 'exterior'], [800, 20, 20, 600, 'exterior'], [400, 20, 10, 600, 'interior']],
    openings: [{ kind: 'door', x: 400, y: 200, w: 10, h: 80 }, { kind: 'door', x: 100, y: 620, w: 90, h: 20 }] }).plan;
  const RECT = JSON.stringify(rect);
  E.setBasePlan(rect, { phase: 'fixed' });
  const slant = { id: 's01', x1: 500, y1: 150, x2: 650, y2: 400, t: 10, kind: 'interior' };
  const st = { walls: clone(PLAN.walls), openings: clone(PLAN.openings), rooms: clone(PLAN.rooms), schema: 2, slants: [slant] };
  const r1 = E.applyPlanState(st);
  check('applied: modified, schema 2 + slants on PLAN, the room has a hole (free-standing angled wall)', r1.ok && E.isPlanModified() && PLAN.schema === 2 && PLAN.slants.length === 1
    && PLAN.rooms.length === 2 && E.wallSegments().some((s) => s.id === 'seg:a:s01' && s.cls === 'partition' && JSON.stringify(s.freeEnds) === '[true,true]'), r1.reason);
  const hole = PLAN.rooms.find((r) => r.polygon.some(([x]) => x > 700));
  check('…its area = the room minus the slant footprint (exact)', near(area(hole.polygon), 390 * 600 - 10 * Math.hypot(150, 250), 0.5), String(area(hole.polygon)));
  const d = E.planDiff();
  check('planDiff: slant-added (free), ref seg:a:s01', d.items.some((i) => i.kind === 'slant-added' && i.level === 'free' && i.ref === 'seg:a:s01' && /angled partition/.test(i.text)), JSON.stringify(d.items));
  const r2 = E.applyPlanState({ walls: st.walls, openings: st.openings, rooms: st.rooms });
  check('the slant removed from the state → the base plan, byte-identical to the schema-1 plan', r2.ok && !E.isPlanModified() && JSON.stringify(PLAN) === RECT && !('schema' in PLAN) && !('slants' in PLAN) && E.planStateKey() === 'null');
  E.setBasePlan({ ...JSON.parse(RECT), schema: 2, slants: [slant] }, { phase: 'fixed' });
  const r3 = E.applyPlanState({ walls: clone(PLAN.walls), openings: clone(PLAN.openings), rooms: clone(PLAN.rooms) });
  const d3 = E.planDiff();
  check('base with a slant, state without it: slant-removed in planDiff', r3.ok && d3.items.some((i) => i.kind === 'slant-removed' && i.ref === 'seg:a:s01'), JSON.stringify(d3.items.map((i) => i.kind)));
  const r4 = E.applyPlanState({ walls: clone(PLAN.walls), openings: clone(PLAN.openings), rooms: clone(PLAN.rooms), schema: 2, slants: [{ ...slant, x2: 680 }] });
  check('…state with it moved: slant-changed', r4.ok && E.planDiff().items.some((i) => i.kind === 'slant-changed'), r4.reason);
  E.setBasePlan(E.BUILTIN_PLAN);
}

group('the Wedge as level L1 above a rectangular L0');
{
  const input = { walls: [[0, 0, 1000, 20, 'exterior'], [0, 780, 1000, 20, 'exterior'], [0, 20, 20, 760, 'exterior'], [980, 20, 20, 760, 'exterior']],
    openings: [{ kind: 'door', x: 400, y: 780, w: 90, h: 20 }], heights: WEDGE.heights, meta: { name: 'Wedge on top', floors: 2 },
    levels: [{ id: 'L1', walls: WEDGE.walls, slants: WEDGE.slants, openings: WEDGE.openings }] };
  const res = B.buildPlan(input, { levels: true, slants: true });
  const p = res.plan, up = p.levels && p.levels[0];
  check('built: L0 without slants, L1 with s01 / s02 and 3 rooms, room ids unique across levels', res.ok && !('slants' in p) && up.slants.length === 2 && up.rooms.length === 3
    && new Set([...p.rooms, ...up.rooms].map((r) => r.id)).size === p.rooms.length + 3, JSON.stringify(res.warnings.filter((w) => w.level !== 'info')));
  const A = analytic(), want = [A.nw, A.east, A.west].map(shoelace).sort((a, b) => a - b), got = up.rooms.map((r) => area(r.polygon)).sort((a, b) => a - b);
  check('L1 rooms = the Wedge\'s analytic areas (|Δ| < 1 cm²)', got.every((a, i) => near(a, want[i], 1)));
  E.setBasePlan(p, { phase: 'fixed' });
  const v = E.levelPlan(PLAN, 'L1'), segs = E.wallSegments(v);
  check('levelPlan(L1) carries the slants; wallSegments(view) has L1|seg:a:s01 / s02, prefixed like the rect ones', v.slants === PLAN.levels[0].slants && segs.some((s) => s.id === 'L1|seg:a:s01') && segs.some((s) => s.id === 'L1|seg:a:s02') && segs.filter((s) => s.axis !== 'a').every((s) => s.id.startsWith('L1|')));
  check('L0 segments unchanged (no slants there)', E.wallSegments(PLAN).every((s) => s.axis !== 'a' && !s.id.startsWith('L1|')));
  const s1 = segs.find((s) => s.id === 'L1|seg:a:s01');
  check('L1 policy: s01 exterior, locked (a level of the base plan)', s1.cls === 'exterior' && s1.policy.level === 'locked');
  E.setActiveLevel('L1');
  const [mx, my] = SG.pointAt(S01, 300);
  check('segmentAt on the active level L1 → L1|seg:a:s01', E.segmentAt(mx, my)?.id === 'L1|seg:a:s01');
  check('wall edits on L1 are refused (angled walls); a door in an L1 rect wall works', E.addWall({ x1: 700, y1: 100, x2: 700, y2: 500 }).reason === E.REASONS.angledWalls && E.addOpening({ kind: 'door', x: 505, y: 650, width: 80 }).ok);
  check('…the L1 slants are kept after the edit; L0 untouched', JSON.stringify(PLAN.levels[0].slants) === JSON.stringify(up.slants) && JSON.stringify(PLAN.walls) === JSON.stringify(p.walls));
  const fp = L.footprintOf(E.levelPlan(PLAN, 'L1')), outer = K.union([...W.walls, ...W.openings.map((o) => G.openingPoly(o, W)), ...G.slantPolys(W), ...W.rooms.map((r) => ({ polygon: r.polygon }))]);
  check('footprintOf(L1 view) includes the slants (one polygon, the Wedge\'s outline)', fp.polygons.length === 1 && near(fp.area, K.netArea([{ outer: outer[0].outer, holes: [] }]), 2), `${fp.area} vs ${K.netArea(outer)}`);
  const st = clone(E.planState());
  E.applyPlanState(null);
  const back = E.applyPlanState(st);
  check('plan state with the L1 slants: applyPlanState round trip', back.ok && JSON.stringify(E.planState()) === JSON.stringify(st), back.reason);
  const tampered = clone(st);
  tampered.levels[0].slants[0].x1 += 30;
  check('a state moving the locked L1 slant is refused (levelsIntact)', !E.applyPlanState(tampered).ok);
  E.resetPlan();
  E.setActiveLevel('L1');
  const add = E.addLevel({});
  const L2 = PLAN.levels[1];
  check('addLevel above L1 copies the exterior slant and its window up (new id), rooms derived', add.ok && L2 && (L2.slants || []).length === 1 && L2.slants[0].x1 === 990 && L2.slants[0].kind === 'exterior'
    && L2.openings.some((o) => o.axis === 'a' && o.wall === L2.slants[0].id && o.kind === 'window' && o.id !== 'win-s01'), JSON.stringify(L2 && L2.slants));
  E.setActiveLevel('L0');
  E.setBasePlan(E.BUILTIN_PLAN);
}

group('rotation invariance: a 400 × 300 room of four slants at 30° vs unrotated');
{
  const ring = (deg) => {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), R = ([x, y]) => [x * c - y * s + 1000, x * s + y * c + 1000];
    const pts = [[-210, -160], [210, -160], [210, 160], [-210, 160]].map(R);
    return pts.map((p, i) => ({ id: `s0${i + 1}`, x1: p[0], y1: p[1], x2: pts[(i + 1) % 4][0], y2: pts[(i + 1) % 4][1], t: 20, kind: 'exterior' }));
  };
  const roomArea = (deg) => { const d = E.analyseWalls([], [], { slants: ring(deg) }); return d.rooms.length === 1 ? area(d.rooms[0].polygon) : NaN; };
  const a0 = roomArea(0), a30 = roomArea(30);
  check('both give one room of 12 m², within 1 cm² of each other', near(a0, 120000, 1) && near(a30, a0, 1), `${a0.toFixed(3)} vs ${a30.toFixed(3)}`);
  const d30 = E.analyseWalls([], [], { slants: ring(30) });
  check('the rotated room\'s four walls are exterior slants with [outside, room] sides', d30.segments.length === 4 && d30.segments.every((s) => s.axis === 'a' && s.cls === 'exterior' && s.between.includes('outside') && s.between.includes(d30.rooms[0].id)));
}

group('buildPlan: diagonal input, the switch, near-axis slants, joined ends');
{
  const diag = { walls: [{ x1: 0, y1: 0, x2: 300, y2: 400, thickness: 10 }] };
  const off = B.buildPlan(diag);
  check('switch off, no option: a diagonal wall is still an error (orthogonal-only)', !off.ok && off.warnings.some((w) => w.level === 'error' && /diagonal.*orthogonal/i.test(w.text)) && !('slants' in off.plan) && FEATURES.angledWalls === false);
  const on = B.buildPlan(diag, { slants: true });
  check('{ slants: true }: the diagonal centre line becomes slant s01 (origin moved to its NW corner)', on.ok && on.plan.slants.length === 1 && on.plan.slants[0].id === 's01' && on.plan.slants[0].t === 10);
  const nearAxis = B.buildPlan({ walls: [{ x1: 0, y1: 0, x2: 500, y2: 3, thickness: 20 }, { x1: 0, y1: 0, x2: 2, y2: 400, thickness: 20 }] }, { slants: true });
  check('within 0.5° of an axis → rect walls, no slants', nearAxis.plan.walls.length >= 2 && !('slants' in nearAxis.plan), JSON.stringify(nearAxis.plan.walls));
  // two collinear slants whose ends stop 12.4 cm apart (t 10 → within 1.5 t, no T: parallel) → one junction point
  const gap = B.buildPlan({ walls: [[0, 0, 600, 20, 'exterior']], slants: [{ id: 'a', x1: 100, y1: 200, x2: 300, y2: 150, t: 10 }, { id: 'b', x1: 312, y1: 147, x2: 500, y2: 100, t: 10 }] }, { slants: true });
  const [a, b] = gap.plan.slants;
  check('free ends within 1.5 t of each other meet at their mean point', a && b && a.x2 === b.x1 && a.y2 === b.y1 && near(a.x2 - b.x2, 306 - 500, 0.11), JSON.stringify(gap.plan.slants));
  // a free end 12.5 cm (along its centre line) short of a rect wall face: beyond the join reach t, within 1.5 t → extended
  const ext = B.buildPlan({ walls: [[0, 0, 600, 20, 'exterior']], slants: [{ id: 'c', x1: 100, y1: 30, x2: 300, y2: 296.7, t: 10 }],
    openings: [{ kind: 'door', axis: 'a', wall: 'c', at: 150, width: 80 }] }, { slants: true });
  const c = ext.plan.slants && ext.plan.slants[0], od = ext.plan.openings.find((o) => o.axis === 'a');
  check('…a free end within 1.5 t of a wall face is extended to it (its openings keep their place: at re-measured)', c && c.y1 === 20 && near(c.x1, 92.5, 0.11) && od && near(od.at, 150 + 12.5, 0.11), JSON.stringify([c, od && od.at, ext.warnings.filter((w) => w.level !== 'info')]));
  const shifted = B.buildPlan({ ...INPUT, walls: WEDGE.walls.map((w) => ({ ...w, x: w.x + 50, y: w.y + 30 })), slants: WEDGE.slants.map((s) => ({ ...s, x1: s.x1 + 50, x2: s.x2 + 50, y1: s.y1 + 30, y2: s.y2 + 30 })) }, { slants: true });
  check('origin shift applied to the slants too (same plan as unshifted)', JSON.stringify(shifted.plan.slants) === JSON.stringify(W.slants) && JSON.stringify(shifted.plan.rooms) === JSON.stringify(W.rooms));
  const conv = B.buildPlan({ walls: [[0, 0, 600, 20, 'exterior'], [0, 400, 600, 20, 'exterior'], [0, 20, 20, 380, 'exterior']], slants: [{ id: 'e', x1: 590, y1: 20, x2: 591, y2: 400, t: 20, kind: 'exterior' }],
    openings: [{ kind: 'window', axis: 'a', wall: 'e', at: 190, width: 100 }] }, { slants: true });
  const cw = conv.plan.openings.find((o) => o.kind === 'window');
  check('an opening in a near-axis slant becomes a rect opening in the rect wall', conv.ok && !('slants' in conv.plan) && cw && cw.axis === 'v' && cw.h === 100 && cw.exterior, JSON.stringify(conv.warnings.filter((w) => w.level !== 'info')));
}

group('import reader → buildPlan (the Wedge drawn as a PDF, slants option)');
{
  const { analysePrims } = await import('../src/import/index.js');
  const F = await import('./import-slant-fixtures.mjs');
  const d = F.wedgeDrawing();
  const res = analysePrims(F.pdfPrims({ lines: d.lines, symLines: [...d.winLines, ...d.doorLines], symArcs: d.arcs }), { slants: true });
  const imp = B.buildPlan({ walls: res.walls, openings: res.openings, slants: res.slants, meta: { name: 'Wedge (import)' } }, { slants: true });
  const ip = imp.plan;
  const ia = ip.rooms.map((r) => area(r.polygon)).sort((a, b) => a - b), wa = W.rooms.map((r) => area(r.polygon)).sort((a, b) => a - b);
  // the reader's centre lines are on 0.1 cm (its s01 is ≤ 0.05 cm off the design line): its rooms are exact for ITS lines
  const rs = res.slants.find((s) => s.t === 20), rf = SG.slantFrame(rs), sg = Math.sign(rf.ny) === Math.sign(SG.slantFrame(S01).ny) ? 1 : -1;
  const px = rs.x1 + sg * rf.nx * 10, py = rs.y1 + sg * rf.ny * 10, xAt = (y) => px + ((y - py) * rf.ux) / rf.uy;
  const eastImp = shoelace([[510, 20], [xAt(20), 20], [xAt(780), 780], [510, 780]]);
  check('ok; 3 rooms: the NW and west rooms = the designed ones (|Δ| < 1 cm²), the east room = the analytic polygon of the reader\'s s01 (|Δ| < 1 cm²) and within 0.01 % of the design',
    imp.ok && ip.rooms.length === 3 && near(ia[0], wa[0], 1) && near(ia[2], wa[2], 1) && near(ia[1], eastImp, 1) && near(ia[1], wa[1], wa[1] * 1e-4),
    `${ia.map((a) => a.toFixed(2))} vs ${wa.map((a) => a.toFixed(2))}, east analytic ${eastImp.toFixed(2)} ${JSON.stringify(imp.warnings.filter((w) => w.level !== 'info'))}`);
  const ang = (plan) => plan.openings.filter((o) => o.axis === 'a').map((o) => ({ kind: o.kind, width: o.width, cx: o.cx, cy: o.cy, exterior: !!o.exterior, hinge: o.hinge, swing: o.swing }));
  const A1 = ang(ip), A2 = ang(W);
  check('the same openings in slants (kind, width, centre within 0.5 cm, exterior)', A1.length === 2 && A2.every((o) => A1.some((q) => q.kind === o.kind && near(q.width, o.width, 0.5) && near(q.cx, o.cx, 0.5) && near(q.cy, o.cy, 0.5) && q.exterior === o.exterior)), JSON.stringify(A1));
  const rect = (plan) => plan.openings.filter((o) => o.axis !== 'a').map((o) => [o.kind, o.x, o.y, o.w, o.h].join(',')).sort();
  check('the same rect openings', JSON.stringify(rect(ip)) === JSON.stringify(rect(W)), JSON.stringify(rect(ip)));
  const cls = (plan) => { E.setBasePlan(plan, { phase: 'fixed' }); return E.wallSegments().filter((s) => s.axis === 'a').map((s) => s.cls).sort(); };
  check('the same slant classes (one exterior, one partition)', JSON.stringify(cls(ip)) === JSON.stringify(cls(W)) && JSON.stringify(cls(W)) === '["exterior","partition"]');
  E.setBasePlan(E.BUILTIN_PLAN);
}

group('performance (median of 40 runs after warm-up; steady state: the plan\'s own derived rooms as the previous ones)');
{
  const wedge = () => E.recomputePlan(W);
  const t1 = timeIt(wedge);
  // House 98 + two slants: a free-standing angled screen in the living area and an angled wall across a room corner
  const h98 = clone(E.BUILTIN_PLAN);
  const big = h98.rooms.slice().sort((a, b) => area(b.polygon) - area(a.polygon))[0];
  const bb = G.polygonBounds(big.polygon), lab = big.label;
  h98.schema = 2;
  h98.slants = [{ id: 's01', x1: lab[0] - 120, y1: lab[1] - 60, x2: lab[0] + 60, y2: lab[1] + 90, t: 10, kind: 'interior' },
    { id: 's02', x1: bb.x + 20, y1: lab[1] + 140, x2: bb.x + 150, y2: lab[1] + 40, t: 10, kind: 'interior' }];
  const r98 = E.recomputePlan(h98), h98d = { ...h98, walls: r98.walls, openings: r98.openings, rooms: r98.rooms, wallOutline: r98.wallOutline };
  const t2 = timeIt(() => E.recomputePlan(h98d)), t2first = timeIt(() => E.recomputePlan(h98), 20);
  const ortho = timeIt(() => E.recomputePlan(E.BUILTIN_PLAN), 200);
  console.log(`   mixed derive: Wedge ${t1.toFixed(2)} ms, House 98 + 2 slants ${t2.toFixed(2)} ms (first derive after adding them, label points recomputed: ${t2first.toFixed(2)} ms; ${r98.rooms.length} rooms, ${r98.problems.length} problems); orthogonal House 98 ${ortho.toFixed(2)} ms`);
  check('mixed derive of the Wedge < 10 ms', t1 < 10, `${t1.toFixed(2)} ms`);
  check('mixed derive of House 98 + 2 slants < 10 ms (and it derives: rooms, no problems)', t2 < 10 && r98.rooms.length >= E.BUILTIN_PLAN.rooms.length && r98.problems.length === 0, `${t2.toFixed(2)} ms`);
  check('the orthogonal derive stays on the grid path (House 98 < 5 ms; ≈ 1 ms unloaded)', ortho < 5, `${ortho.toFixed(2)} ms`);
}

group('identity: House 98 untouched');
{
  check('PLAN byte-identical to plan.js, built-in base', JSON.stringify(PLAN) === H98 && E.isBuiltinBase());
  check('no segment of House 98 is angled; the derive is the grid one (recomputePlan = the stored arrays)', E.wallSegments().every((s) => s.axis !== 'a') && JSON.stringify(E.recomputePlan().rooms) === JSON.stringify(PLAN.rooms));
}

console.log(`\nslants: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
