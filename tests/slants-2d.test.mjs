// Angled walls in the 2D plan — stage A3 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md. The pure parts of the plan tools
// (src/view2d/slant-tools.js): angle snapping (15° steps, 45° / 90° stronger, parallel / perpendicular to a wall within
// 4 m, Shift = axes only, Alt = free), length snapping, the end snapping order (points, faces, extension lines, length),
// grips and their hit-test, aligned dimensions (figure position, upright rule), the angle to the nearest straight wall,
// the main directions of a slanted room; the diagonal furniture runs (snapping.js) and the Wedge's façade chains /
// interior dimensions (dimensions.js); and the Wedge painted headless (a recording canvas: no throw, no NaN).
// The browser part is tests/e2e.slants.mjs.
//   node tests/slants-2d.test.mjs
const calls = { n: 0, nan: [] };
const rec = (name) => (...args) => { calls.n++; if (args.some((a) => typeof a === 'number' && !Number.isFinite(a))) calls.nan.push(`${name}(${args.join(',')})`); return ctx2d; };
const ctx2d = new Proxy({ measureText: (t) => ({ width: String(t).length * 6 }), createPattern: () => ({ setTransform() {} }), getImageData: () => ({ data: [0, 0, 0, 0] }) },
  { get: (t, k) => (k in t ? t[k] : rec(String(k))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ width: 0, height: 0, style: {}, className: '', getContext: () => ctx2d, append() {}, appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {} });
globalThis.document ??= { createElement: el, documentElement: {}, addEventListener() {}, removeEventListener() {} };
globalThis.performance ??= { now: () => Date.now() };
globalThis.DOMMatrix ??= class { translate() { return this; } };

const T = await import('../src/view2d/slant-tools.js');
const { PLAN } = await import('../src/core/plan.js');
const { store } = await import('../src/core/store.js');
const E = await import('../src/core/plan-edit.js');
const B = await import('../src/core/plan-build.js');
const G = await import('../src/core/geometry.js');
const SN = await import('../src/view2d/snapping.js');
const D = await import('../src/view2d/dimensions.js');
const ST = await import('../src/view2d/structure.js');
const { createGfx, createBoxes } = await import('../src/view2d/gfx.js');
const { paintUnder, paintOver } = await import('../src/view2d/renderer.js');
const { exportPalette } = await import('../src/view2d/theme.js');
const { WEDGE } = await import('./fixtures/houses.mjs');

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const H98 = JSON.stringify(PLAN);

group('angles: plan angle, the shown angle (counter-clockwise from east), directions');
{
  check('planAngle: east 0, south 90 (y down), west 180, north 270', T.planAngle(1, 0) === 0 && T.planAngle(0, 1) === 90 && T.planAngle(-1, 0) === 180 && T.planAngle(0, -1) === 270);
  check('shownAngle: north-east is 45°, north 90°, south 270°', T.shownAngle(1, -1) === 45 && T.shownAngle(0, -1) === 90 && T.shownAngle(0, 1) === 270);
  const [ux, uy] = T.dirOfShown(30);
  check('dirOfShown(30°) points up-right on screen', near(ux, Math.cos(Math.PI / 6)) && near(uy, -0.5));
  check('lineDelta treats a line both ways (10° vs 190° = 0)', T.lineDelta(10, 190) === 0 && T.lineDelta(5, 175) === 10);
}

group('angle snapping: 90° and 45° win outright, then the nearer of a 15° step and a parallel / perpendicular wall');
{
  check('92° → 90° (axis, reach 6°)', T.snapAngle(92).deg === 90 && T.snapAngle(92).kind === 'axis');
  check('84.5° → 90° (still within the axis reach)', T.snapAngle(84.5).deg === 90);
  check('48.5° → 45° (reach 4.5°)', T.snapAngle(48.5).deg === 45 && T.snapAngle(48.5).kind === '45');
  check('61.5° → 60° (a 15° step, reach 2.5°)', T.snapAngle(61.5).deg === 60 && T.snapAngle(61.5).kind === '15');
  check('49.6° is not 45° (outside its reach), and not 15° (outside) → stays', near(T.snapAngle(53).deg, 53) && T.snapAngle(53).kind === null);
  check('45° is stronger than a 15° step: 41.5° → 45°, not 45/30', T.snapAngle(41.5).deg === 45);
  check('angles are taken mod 360 (−3° → 0°, 357° → 0°)', T.snapAngle(-3).deg === 0 && T.snapAngle(357).deg === 0);
  // a wall at 117.2° (the Wedge's s01) within 4 m of the start
  const wall = { id: 'seg:a:s01', x1: 990, y1: 10, x2: 590, y2: 790, deg: T.planAngle(-400, 780) };
  const start = { x: 800, y: 300 };
  const par = T.snapAngle(116, { start, lines: [wall] });
  check('116° → parallel to the 117.2° wall (nearer than 120°)', par.kind === 'parallel' && near(par.deg, wall.deg, 1e-9) && par.ref === wall, JSON.stringify(par));
  const par2 = T.snapAngle(296.5, { start, lines: [wall] });
  check('the other way along it too (296.5° → 297.2°)', par2.kind === 'parallel' && near(par2.deg, wall.deg + 180, 1e-9));
  const perp = T.snapAngle(28, { start, lines: [wall] });
  check('28° → perpendicular to it (27.2°)', perp.kind === 'perp' && near(perp.deg, wall.deg - 90, 1e-9), JSON.stringify(perp));
  check('119.4° → the 15° step 120° (nearer than the parallel)', T.snapAngle(119.4, { start, lines: [wall] }).deg === 120);
  check('a wall more than 4 m away offers nothing', T.snapAngle(116, { start: { x: 2000, y: 2000 }, lines: [wall] }).kind === null);
  check('Alt (free) keeps the drawn angle', near(T.snapAngle(92, { free: true }).deg, 92) && T.snapAngle(92, { free: true }).kind === null);
  check('a short line on screen gets a wider reach (12° off at 20 px → axis)', T.snapAngle(12, { lenPx: 20 }).deg === 0 && T.snapAngle(12, { lenPx: 2000 }).deg !== 0);
}

group('length and end snapping (snapWallEnd): points, faces (ray–face), extension lines, 5 cm');
{
  check('snapLength: 5 cm steps, never below one step', T.snapLength(123.4) === 125 && T.snapLength(122.4) === 120 && T.snapLength(1) === 5);
  const start = { x: 0, y: 0 };
  const r = T.snapWallEnd(start, { x: 203, y: -199 }, {});
  check('45° from a free drag; length on 5 cm', r.angleKind === '45' && r.shown === 45 && r.endKind === 'length' && near(r.len % 5, 0, 1e-6) || near(r.len % 5, 5, 1e-6), JSON.stringify(r));
  const face = { x1: 300, y1: -500, x2: 300, y2: 500 };
  const f = T.snapWallEnd(start, { x: 296, y: -300 }, { faces: [face], reach: 10 });
  check('runs into a wall face → ends exactly on it (ray–face intersection)', f.endKind === 'face' && near(f.x, 300) && near(f.y, -300), JSON.stringify(f));
  const p = T.snapWallEnd(start, { x: 104, y: 52 }, { points: [[100, 50]], reach: 10 });
  check('an existing point wins (exactly that point, any angle)', p.endKind === 'point' && p.x === 100 && p.y === 50);
  const ext = T.snapWallEnd(start, { x: 152, y: -147 }, { ends: [{ x: 150, y: -400, ux: 0, uy: 1 }], reach: 10 });
  check('an extension line of a wall end (x = 150 continued) catches the end', ext.endKind === 'extension' && near(ext.x, 150) && ext.guides.some((g) => g.kind === 'extension'), JSON.stringify(ext));
  const ax = T.snapWallEnd(start, { x: 300, y: 70 }, { axisOnly: true });
  check('Shift (axis only): 13° → 0°', ax.deg === 0 && near(ax.y, 0));
  const free = T.snapWallEnd(start, { x: 300, y: -70 }, { free: true, step: 1 });
  check('Alt (free angle): the drawn direction', near(free.deg, T.planAngle(300, -70)));
  const typed = T.snapWallEnd(start, { x: 300, y: -10 }, { typedLength: 250, typedAngle: 30 });
  check('typed length 250 and angle 30° win over the pointer', typed.endKind === 'typed' && near(typed.len, 250) && typed.shown === 30);
  const typedLen = T.snapWallEnd(start, { x: 0, y: -300 }, { typedLength: 120 });
  check('typed length only: the direction still follows the pointer (90°)', near(typedLen.len, 120) && typedLen.shown === 90);
  const pg = T.snapWallEnd({ x: 800, y: 300 }, { x: 800 + 300 * Math.cos(116 * Math.PI / 180), y: 300 + 300 * Math.sin(116 * Math.PI / 180) }, { lines: [{ id: 'w', x1: 990, y1: 10, x2: 590, y2: 790, deg: T.planAngle(-400, 780) }] });
  check('a parallel direction carries its guide (∥ drawn by the overlay)', pg.angleKind === 'parallel' && pg.guides.some((g) => g.kind === 'parallel' && g.ref === 'w'));
}

group('grips of an angled wall and their hit-test');
{
  const seg = { id: 'seg:a:s02', x1: 25, y1: 300, x2: 300, y2: 25 };
  const toScreen = (x, y) => ({ x: x * 2, y: y * 2 });
  const hs = T.slantHandles(seg, toScreen, 2);
  const move = hs.find((h) => h.kind === 'move');
  check('a body grip in the middle and a grip on each end', hs.length === 3 && move && near(move.x, 325) && near(move.y, 325) && hs.find((h) => h.kind === 'end0').end === 'a' && hs.find((h) => h.kind === 'end1').end === 'b');
  check('the body grip carries the direction it may move (the normal)', near(move.nx * move.ux + move.ny * move.uy, 0) && near(Math.hypot(move.nx, move.ny), 1));
  check('handleAt: the nearest grip within reach', T.handleAt(hs, { x: 52, y: 598 }, 9).kind === 'end0' && T.handleAt(hs, { x: 330, y: 330 }, 9).kind === 'move' && T.handleAt(hs, { x: 200, y: 600 }, 9) === null);
  const tiny = T.slantHandles({ x1: 0, y1: 0, x2: 10, y2: 10 }, toScreen, 1);
  check('a wall shorter than 30 px on screen has no body grip', !tiny.some((h) => h.kind === 'move'));
  check('cursorFor: across a 45° wall the cursor is diagonal', T.cursorFor(-1, 1) === 'nesw-resize' && T.cursorFor(1, 1) === 'nwse-resize' && T.cursorFor(1, 0) === 'ew-resize');
}

group('aligned dimensions: geometry and the upright rule');
{
  check('uprightAngle keeps text in [−90°, 90°): 135° → −45°, −135° → 45°, 90° → −90° (reads upwards)',
    near(T.uprightAngle(3 * Math.PI / 4), -Math.PI / 4) && near(T.uprightAngle(-3 * Math.PI / 4), Math.PI / 4) && near(T.uprightAngle(Math.PI / 2), -Math.PI / 2) && near(T.uprightAngle(0), 0));
  const dim = T.alignedDim([0, 0], [300, -300], Math.SQRT1_2, Math.SQRT1_2, 20, { gap: 2, over: 5, textOff: 8 });
  check('the line is offset along the normal', near(dim.p0[0], 20 * Math.SQRT1_2) && near(dim.p1[1], -300 + 20 * Math.SQRT1_2) && near(dim.length, Math.hypot(300, 300)));
  check('the figure sits at the middle, further out, turned with the wall and upright', near(dim.text.x, 150 + 28 * Math.SQRT1_2) && near(dim.text.y, -150 + 28 * Math.SQRT1_2) && near(dim.text.angle, -Math.PI / 4));
  const back = T.alignedDim([300, -300], [0, 0], -Math.SQRT1_2, -Math.SQRT1_2, 20);
  check('measured the other way, the text angle is the same (never upside down)', near(back.text.angle, dim.text.angle));
  check('extension lines run from the gap to past the line', near(dim.ext[0][0], 2 * Math.SQRT1_2) && near(dim.ext[0][2], 25 * Math.SQRT1_2));
  const seg = { x1: 0, y1: 0, x2: 400, y2: 0, t: 10, faces: { l: [[5, 395]], r: [[0, 180], [260, 400]] } };
  const fd = T.slantFaceDims(seg, [{ at: 220, width: 80 }]);
  const l = fd.find((q) => q.side === 'l'), r = fd.find((q) => q.side === 'r');
  check('one chain per exposed face, on its own side', fd.length === 2 && l.ny === -1 && r.ny === 1 && near(l.a[1], -5) && near(r.a[1], 5));
  check('broken at the jambs of an opening within it', JSON.stringify(r.pts) === JSON.stringify([0, 180, 260, 400]) && JSON.stringify(l.pts) === JSON.stringify([5, 180, 260, 395]));
}

group('angle to the nearest straight wall, compass words, main directions of a room');
{
  const rects = [{ axis: 'h', core: { x: 0, y: 0, w: 1000, h: 20 } }];
  const a = T.angleToOrtho({ x1: 990, y1: 10, x2: 590, y2: 790 }, rects);
  check('the Wedge’s s01 meets the north wall at 62.85° (shown 62.9°)', a.ref === 'wall' && near(a.deg, 62.9, 0.051) && a.at[0] === 990, JSON.stringify(a));
  const b = T.angleToOrtho({ x1: 25, y1: 300, x2: 300, y2: 25 }, [{ axis: 'v', core: { x: 0, y: 20, w: 20, h: 760 } }]);
  check('s02 against the west wall: 45°', near(b.deg, 45));
  check('no straight wall near: measured from north', T.angleToOrtho({ x1: 0, y1: 0, x2: 100, y2: -100 }, []).ref === 'north');
  check('compass8 / endNames', T.compass8(1, -1) === 'north-east' && T.compass8(0, 1) === 'south' && JSON.stringify(T.endNames(25, 300, 300, 25)) === JSON.stringify({ a: 'south-west', b: 'north-east' }));
  const trap = [[510, 20], [973.6, 20], [583.9, 780], [510, 780]];
  check('a trapezoid with one slanted side keeps the axis frame (most of its outline)', T.mainDirection(trap) === 0 && T.hasSlantedEdge(trap));
  const rot = [[0, 0], [400, 0], [400, 300], [0, 300]].map(([x, y]) => [x * Math.cos(0.5) - y * Math.sin(0.5), x * Math.sin(0.5) + y * Math.cos(0.5)]);
  check('a rotated rectangle: its own direction', near(T.mainDirection(rot), 0.5 * 180 / Math.PI, 0.002));
  const sp = T.spanAlong(trap, 600, 400, 1, 0);
  check('spanAlong: the clear span through a point', sp && near(600 + sp[0], 510) && near(600 + sp[1], 973.6 + (583.9 - 973.6) * (380 / 760), 1e-6), JSON.stringify(sp));
}

// ───────── the Wedge in the plan ─────────
const built = B.buildPlan({ walls: WEDGE.walls, slants: WEDGE.slants, openings: WEDGE.openings, heights: WEDGE.heights, meta: { name: 'Wedge' } }, { slants: true });
E.setBasePlan(built.plan);
const plan = PLAN;

group('the Wedge: structure data, removed-walls ghost, snapshot');
{
  const d = ST.structureOf(plan);
  const s02 = d.byId.get('seg:a:s02');
  check('slant segments have a footprint piece with their door as a hole', s02 && d.polys.get('seg:a:s02')[0].holes.length === 1 && d.segOfOpening.get('door-s02') === s02);
  const snap = ST.planSnapshot(plan);
  check('the snapshot signs a slant’s footprint (a neighbour’s join changes it)', snap.segs.get('seg:a:s01').sig.includes('|') && snap.segs.get('seg:a:s01').sig.split('|').length >= 5);
  const mv = E.moveWallSegment('seg:a:s02', 20);
  const dirt = ST.planDirt(snap, ST.planSnapshot(PLAN));
  check('moving s02: the dirty rectangle covers it and its dimension band is flagged', mv.ok && dirt.rect && dirt.slants && dirt.slants.length >= 2, JSON.stringify(dirt).slice(0, 160));
  E.moveWallSegment('seg:a:s02', -20);
}

group('the Wedge: façade chains with a slanted side, dimensions of slanted rooms');
{
  const east = D.facadeProfile(PLAN, 'e');
  const win = east.find((q) => q.opening && q.opening.id === 'win-s01');
  check('east side: the slanted wall is projected (one piece each side of its window)', east.length <= 5 && east.some((q) => q.slant === 's01' && !q.opening), JSON.stringify(east.map((q) => [q.from, q.to, q.slant || '', q.opening ? q.opening.id : ''])));
  check('its window shows as an opening on the side it mainly faces', !!win && win.to - win.from > 100);
  const north = D.facadeProfile(PLAN, 'n');
  check('the window is not an opening on the north side', !north.some((q) => q.opening && q.opening.id === 'win-s01'));
  const dims = D.interiorDims(PLAN);
  const east2 = PLAN.rooms.find((r) => Math.abs(G.polygonArea(r.polygon) / 1e4 - 20.43) < 0.05);
  check('the trapezoid gets clear dimensions along its main directions', east2 && dims.filter((q) => q.room === east2.id).length === 2, JSON.stringify(dims.filter((q) => east2 && q.room === east2.id)));
  check('House-98-style rooms are unchanged (rect rooms keep their primary dims)', D.interiorDims({ rooms: [{ id: 'r', polygon: [[0, 0], [400, 0], [400, 300], [0, 300]] }] }).every((q) => q.primary));
}

group('furniture: diagonal runs, a sofa flush against an angled wall');
{
  const runs = SN.buildRuns(PLAN), diag = runs.filter((r) => r.diag);
  check('buildRuns gains diagonal face runs (after the orthogonal ones)', diag.length >= 3 && runs.findIndex((r) => r.diag) === runs.length - diag.length);
  const items = [];
  const sn = SN.createSnapper({ plan: () => PLAN, store: { items, ui: { gridStep: 0 } } });
  // a sofa dropped near s01's inner (Room 2) face
  const s01 = PLAN.slants.find((s) => s.id === 's01'), f = T.lineFrame(s01.x1, s01.y1, s01.x2, s01.y2);
  const at = 250, px = s01.x1 + f.ux * at + f.nx * 60, py = s01.y1 + f.uy * at + f.ny * 60;
  const sofa = { x: px, y: py, w: 200, d: 90, rot: 0, placement: 'floor', type: 'sofa' };
  const res = sn.snapItem(sofa, { scale: 1, enabled: true, autoOrient: true, state: {} });
  const r = res.attached;
  check('the sofa attaches to a diagonal run', r && r.diag, JSON.stringify({ x: res.x, y: res.y, rot: res.rot }));
  if (r) {
    const back = G.itemLocalToPlan({ ...sofa, x: res.x, y: res.y, rot: res.rot }, 0, -sofa.d / 2);
    const gap = back[0] * r.nx + back[1] * r.ny - r.c;
    check('its back is flush with the face (± 0.01 cm) and it faces away from the wall', near(gap, 0, 0.01) && near(res.rot, Math.round(SN.faceRot(r.nx, r.ny)), 0.5) && res.rot === SN.diagRot(r.nx, r.ny));
    const corners = G.itemCorners({ ...sofa, x: res.x, y: res.y, rot: res.rot }).slice(0, 2).map(([x, y]) => x * r.nx + y * r.ny - r.c);
    check('both back corners on the face (± 0.1 cm)', corners.every((v) => Math.abs(v) <= 0.1), JSON.stringify(corners));
    check('the rotation follows the wall (not a multiple of 90°)', res.rot % 90 !== 0, String(res.rot));
    check('it no longer overlaps a wall', !G.wallsHitByItem({ ...sofa, x: res.x, y: res.y, rot: res.rot }, PLAN).length);
  }
  const lamp = { x: px, y: py, w: 30, d: 20, rot: 0, placement: 'wall', type: 'wall-lamp' };
  const wl = sn.snapItem(lamp, { scale: 1, enabled: true, state: {} });
  check('a wall-mounted item glues to the angled face too', wl.attached && wl.attached.diag);
  const cl = sn.clearances({ x: 700, y: 400, w: 10, h: 10 });
  const eastRay = cl.find((c) => c.y1 === c.y2 && c.x2 > c.x1);
  check('clearances stop at an angled wall (s01’s inner face at y 405 ≈ x 776.2)', eastRay && near(eastRay.x2, 990 - 400 * (395 / 780) - 10 * Math.hypot(400, 780) / 780, 0.05), JSON.stringify(eastRay));
}

group('the Wedge painted headless (paintUnder / paintOver with every layer): no throw, no NaN');
{
  const pal = exportPalette();
  const ui = { ...store.ui, showGrid: false, showDimensions: true, showRoomLabels: true, showSite: true, showItems: true, tool: 'structure', structureSel: { type: 'segment', id: 'seg:a:s02' }, units: 'm' };
  const env = { store, plan: PLAN, rootPlan: PLAN, level: 'L0', pal, ui, font: 'sans-serif', shown: () => true, catalog: null, models: null };
  const Gx = createGfx(ctx2d, { scale: 0.8, dpr: 1, ox: 100, oy: 100, width: 1200, height: 900, font: 'sans-serif' });
  let err = null;
  try { paintUnder(Gx, env); paintOver(Gx, env); env.ui = { ...ui, tool: 'select', showPlanChanges: true }; paintUnder(Gx, env); paintOver(Gx, env); } catch (e) { err = e; }
  check('no throw', !err, err ? err.stack : '');
  check('canvas calls made, none with a NaN / infinite number', calls.n > 500 && calls.nan.length === 0, calls.nan.slice(0, 3).join(' '));
}

E.resetPlan();
E.setBasePlan(JSON.parse(H98));
check('House 98 restored byte-identical', JSON.stringify(PLAN) === H98);

console.log(`\nslants-2d: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
