// Several floors through the sketch importer — stage F8 (docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md § 3 "Import per floor",
// docs/CONTRACT.md § 12 "Several floors in the import dialog"). Engine level (src/import/floors.js + buildPlan + the
// plan engine's own stairs): alignment of two floor outlines (shifted, with a wing, turned 90°, a smaller terrace floor,
// an ambiguous pair of squares, an overhang warning), stair and void symbols on synthetic primitives (the Duplex stair
// found within 5 cm; a hatch of long lines, too few treads and uneven spacing rejected), and the whole pipeline on the
// Duplex drawn floor by floor — two plans side by side on one DXF sheet, two DXF files (the upper one turned 90°), and
// PDF-like primitives — → one plan with 2 levels, 2 rooms per level, levels aligned within 5 cm, the stair added by
// addStair with a valid void, per-floor underlay transforms mapping known wall corners.
//   node tests/import-floors.test.mjs
import { DUPLEX } from './fixtures/houses.mjs';
import { duplexFloor, duplexSheet, floorPrims, floorsDxf, mapFloor, shiftBy, stairSymbol } from './import-floor-fixtures.mjs';
import { analysePrims, readDxf, analyseDxf, firstLook } from '../src/import/index.js';
import { alignFloors, alignmentReport, placeFloor, detectStairSymbols, detectVoidSymbols, matchStairs, stairCandidates, stairVerdicts, levelsInput, shiftOf, snapFaces } from '../src/import/floors.js';
import { buildPlan } from '../src/core/plan-build.js';
import * as PE from '../src/core/plan-edit.js';
import { voidCovers, stairGeometry, requiredVoid } from '../src/core/stairs.js';
import { affThen, affApply } from '../src/ui/import/affine.js';

let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const t0 = Date.now();
const L0 = { walls: DUPLEX.walls, openings: DUPLEX.openings };
const L1 = { walls: DUPLEX.levels[0].walls, openings: DUPLEX.levels[0].openings };
const STAIR = DUPLEX.stairs[0].footprint, VOID = { x: 520, y: 266, w: 100, h: 404 };
const moveFloor = (f, dx, dy) => ({ walls: f.walls.map((w) => ({ ...w, x: w.x + dx, y: w.y + dy })), openings: f.openings.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy })) });
const maxErr = (pairs) => Math.max(...pairs.map(([p, q]) => Math.hypot(p[0] - q[0], p[1] - q[1])));
/** Corners of every wall of `truth` (its own frame) mapped from the drawn copy through the alignment vs. where they are. */
function alignedError(a, drawn, map, truth) {
  const P = placeFloor(drawn, a.rot, a.dx, a.dy);
  const pairs = [];
  for (const w of truth.walls) for (const c of [[w.x, w.y], [w.x + w.w, w.y + w.h]]) pairs.push([P.map(map(c)), c]);
  return maxErr(pairs);
}
const markOf = (r, m) => { const a = m([r.x, r.y]), b = m([r.x + r.w, r.y + r.h]); return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }; };

// ───────────────────────── alignment ─────────────────────────
group('Alignment of two floor outlines');
{
  // the first floor drawn 137 cm east and 43 cm north of where the ground floor is on its sheet
  const drawn = moveFloor(L1, 137, -43), back = ([x, y]) => [x + 137, y - 43];
  let t = Date.now();
  const a = alignFloors(L0, drawn, { lowerMarks: [STAIR], upperMarks: [markOf(VOID, back)] });
  const ms = Date.now() - t;
  check('shifted by a known offset: aligned within 1 cm, not turned', a.rot === 0 && alignedError(a, drawn, back, L1) <= 1, JSON.stringify({ rot: a.rot, dx: a.dx, dy: a.dy, err: alignedError(a, drawn, back, L1) }));
  check('…confidence high: "Outer walls coincide on 4 of 4 sides"', a.confidence === 'high' && a.text === 'Outer walls coincide on 4 of 4 sides' && a.coinciding === 4, a.text);
  check('…every side flush (overhang 0), no warning', ['n', 'e', 's', 'w'].every((d) => a.sides[d].overhang === 0 && a.sides[d].coincide) && !a.warnings.length, JSON.stringify(a.sides));
  check('…in well under a second', ms < 1000, `${ms} ms`);

  // a first floor with a balcony room 120 cm north of the ground floor's north wall (so its NW corner is elsewhere)
  const wing = { walls: [...L1.walls, { id: 'b1', x: 700, y: -120, w: 300, h: 20, kind: 'exterior' }, { id: 'b2', x: 700, y: -100, w: 20, h: 100, kind: 'exterior' }, { id: 'b3', x: 980, y: -100, w: 20, h: 100, kind: 'exterior' }], openings: L1.openings };
  const drawnW = moveFloor(wing, 55, 310), backW = ([x, y]) => [x + 55, y + 310];
  const aw = alignFloors(L0, drawnW, { rotations: [0] });
  check('a floor with a wing: placed within 1 cm (its own corner 120 cm north of the house)', alignedError(aw, drawnW, backW, wing) <= 1 && aw.dy === -120, JSON.stringify({ dx: aw.dx, dy: aw.dy, err: alignedError(aw, drawnW, backW, wing) }));
  check('…read-out: sticks out 120 cm on the north side, flush elsewhere; no warning under 150 cm', aw.sides.n.overhang === 120 && aw.sides.e.overhang === 0 && aw.sides.s.overhang === 0 && aw.sides.w.overhang === 0 && !aw.warnings.length, JSON.stringify(aw.sides));

  // the first floor drawn turned 90° counter-clockwise: the search turns it back
  const turned = placeFloor(L1, 270), mapT = turned.map;
  const at = alignFloors(L0, { walls: turned.walls, openings: turned.openings }, { lowerMarks: [STAIR], upperMarks: [markOf(VOID, mapT)] });
  check('turned by 90°: found the 90° turn and aligned within 1 cm', at.rot === 90 && alignedError(at, { walls: turned.walls, openings: turned.openings }, mapT, L1) <= 1, JSON.stringify({ rot: at.rot, dx: at.dx, dy: at.dy }));
  check('…confidence high, with a note about the turn', at.confidence === 'high' && at.notes.some((n) => /turned by 90°/.test(n)), at.notes.join(' | '));
  const at2 = alignFloors(L0, { walls: turned.walls, openings: turned.openings });
  check('turned by 90°, without the stair well: the outline alone also fits at 180° more → medium, says so', at2.confidence === 'medium' && at2.ambiguous.rotation === 180 && at2.notes.some((n) => /also fits turned by 180°/.test(n)), `${at2.confidence} ${at2.notes.join(' | ')}`);
  const fixed = alignFloors(L0, { walls: turned.walls, openings: turned.openings }, { rotations: [0] });
  check('orientation set by the user (rotations [0]): no turn tried', fixed.rot === 0);

  // a smaller upper floor (a terrace over the east part): its outer east wall stands on the ground floor's partition
  const ter = { walls: [{ x: 0, y: 0, w: 510, h: 20 }, { x: 0, y: 780, w: 510, h: 20 }, { x: 0, y: 20, w: 20, h: 760 }, { x: 490, y: 20, w: 20, h: 760 }], openings: [] };
  const drawnT = moveFloor(ter, 222, 111), backT = ([x, y]) => [x + 222, y + 111];
  const ar = alignFloors(L0, drawnT, { rotations: [0] });
  check('a smaller upper floor aligns on its shared walls (west, north, south + the partition under its east wall)', alignedError(ar, drawnT, backT, ter) <= 1 && ar.coinciding === 4, JSON.stringify({ dx: ar.dx, dy: ar.dy, text: ar.text }));
  check('…read-out: set back 490 cm on the east side, no warning (overlap 100 %)', ar.sides.e.overhang === -490 && ar.overlap === 1 && !ar.warnings.length, JSON.stringify(ar.sides));

  // a deliberately ambiguous case: a 6 × 6 m square floor over a 10 × 10 m square
  const sq = (s) => ({ walls: [{ x: 0, y: 0, w: s, h: 20 }, { x: 0, y: s - 20, w: s, h: 20 }, { x: 0, y: 20, w: 20, h: s - 40 }, { x: s - 20, y: 20, w: 20, h: s - 40 }], openings: [] });
  const aq = alignFloors(sq(1000), sq(600));
  check('square floors: low confidence, "another position fits about as well"', aq.confidence === 'low' && aq.ambiguous.translation && aq.notes.some((n) => /Another position/.test(n)), `${aq.confidence} ${aq.text} ${aq.notes.join(' | ')}`);
  const aq2 = alignFloors(sq(1000), sq(1000));
  check('two equal squares: placed exactly, but any turn fits as well → not high', aq2.dx === 0 && aq2.dy === 0 && aq2.confidence !== 'high' && aq2.ambiguous.rotation != null, `${aq2.confidence} ${aq2.notes.join(' | ')}`);

  // an upper floor sticking out 300 cm east
  const big = { walls: [{ x: 0, y: 0, w: 1300, h: 20 }, { x: 0, y: 780, w: 1300, h: 20 }, { x: 0, y: 20, w: 20, h: 760 }, { x: 1280, y: 20, w: 20, h: 760 }], openings: [] };
  const rep = alignmentReport(L0, big, { rot: 0, dx: 0, dy: 0 });
  check('read-out of a chosen position: sticks out 300 cm east → a warning', rep.sides.e.overhang === 300 && rep.warnings.some((w) => /300 cm beyond the floor below on the east side/.test(w)), rep.warnings.join(' | '));
  const far = alignmentReport(L0, L1, { rot: 0, dx: 800, dy: 0 });
  check('read-out: hardly overlapping (20 %) → a warning', far.overlap < 0.3 && far.warnings.some((w) => /overlaps the floor below by only/.test(w)), far.warnings.join(' | '));
  const sn = snapFaces(L0, L1, { rot: 0, dx: 7, dy: -4 });
  check('dragging: wall faces snap back onto the floor below (7 cm east, 4 cm north → −7, +4)', sn.dx === -7 && sn.dy === 4, JSON.stringify(sn));
}

// ───────────────────────── stair and void symbols ─────────────────────────
group('Stair and void symbols on synthetic primitives');
const SC = { cmPerUnit: 100 * 2.54 / 72 };
{
  const prims = floorPrims([duplexFloor(0)]);
  const r = analysePrims(prims, { scale: SC });
  const st = detectStairSymbols(prims, r);
  const s = st[0] || {};
  const off = s.x != null ? Math.max(Math.abs(s.x - STAIR.x), Math.abs(s.y - STAIR.y), Math.abs(s.x + s.w - STAIR.x - STAIR.w), Math.abs(s.y + s.h - STAIR.y - STAIR.h)) : Infinity;
  check('the Duplex stair: one straight run found, footprint within 5 cm', st.length === 1 && off <= 5, JSON.stringify(st));
  check('…18 riser lines 29 cm apart, 100 cm wide, going up north (from the arrow)', s.lines === 18 && Math.abs(s.going - 29) < 0.5 && Math.abs(s.width - 100) < 1 && s.up === 'n' && s.evidence.includes('an arrow'), JSON.stringify(s.evidence));
  check('…no void symbol on the ground floor', detectVoidSymbols(prims, r).length === 0);

  // without the arrow: the text "UP" at the bottom end says it
  const noArrow = duplexFloor(0); noArrow.stair = stairSymbol(STAIR, { up: 'n', arrow: false, text: true });
  const pa = floorPrims([noArrow]), ra = analysePrims(pa, { scale: SC }), sa = detectStairSymbols(pa, ra);
  check('without an arrow: "UP" near the bottom end gives the direction', sa.length === 1 && sa[0].up === 'n' && sa[0].evidence.some((e) => /UP/.test(e)), JSON.stringify(sa.map((x) => [x.up, x.evidence])));
  // neither: no direction — the opening drawn on the floor above decides
  const bare = duplexFloor(0); bare.stair = stairSymbol(STAIR, { up: 'n', arrow: false, text: false });
  const pb = floorPrims([bare]), rb = analysePrims(pb, { scale: SC }), sb = detectStairSymbols(pb, rb);
  check('no arrow, no text: direction unknown', sb.length === 1 && sb[0].up === null);
  const m = matchStairs(sb, { voids: [VOID] });
  check('…matched to the opening above, it goes up towards it (north)', m.stairs[0].up === 'n' && m.stairs[0].upFrom === 'opening above' && m.stairs[0].matched.kind === 'void' && !m.plainVoids.length);
  const mp = matchStairs(sb, { voids: [VOID, { x: 100, y: 100, w: 120, h: 120 }] });
  check('…another drawn opening that no stair uses stays a plain void', mp.plainVoids.length === 1 && mp.plainVoids[0].x === 100);

  // a stair going east in another room
  const east = duplexFloor(0); east.stair = stairSymbol({ x: 40, y: 500, w: 377, h: 90 }, { up: 'e', risers: 14, going: 29 });
  const pe = floorPrims([east]), re = analysePrims(pe, { scale: SC }), se = detectStairSymbols(pe, re);
  check('a run going east (14 risers, 90 cm wide) is found with its direction', se.length === 1 && se[0].axis === 'h' && se[0].up === 'e' && se[0].lines === 14 && Math.abs(se[0].width - 90) < 1, JSON.stringify(se.map((x) => [x.x, x.y, x.w, x.h, x.up, x.lines])));

  // not stairs: 40 long hatch lines across a room; 5 treads; uneven spacing
  const hatch = duplexFloor(0); hatch.stair = { lines: [], polys: [], texts: [] };
  for (let k = 0; k < 40; k++) hatch.stair.lines.push([30, 30 + k * 18, 490, 30 + k * 18]);
  const ph = floorPrims([hatch]), rh = analysePrims(ph, { scale: SC });
  check('a hatch of 40 long parallel lines across a room is not a stair', detectStairSymbols(ph, rh).length === 0);
  const short = duplexFloor(0); short.stair = { lines: [[520, 600, 620, 600], [520, 600, 520, 716], [620, 600, 620, 716]], polys: [], texts: [] };
  for (let k = 0; k < 5; k++) short.stair.lines.push([520, 600 + k * 29, 620, 600 + k * 29]);
  const ps = floorPrims([short]), rs = analysePrims(ps, { scale: SC });
  check('5 tread lines in a rectangle are too few for a stair', detectStairSymbols(ps, rs).length === 0);
  const uneven = duplexFloor(0); uneven.stair = { lines: [[520, 300, 520, 700], [620, 300, 620, 700]], polys: [], texts: [] };
  for (const y of [300, 325, 360, 380, 420, 445, 490, 510, 560]) uneven.stair.lines.push([520, y, 620, y]);
  const pu = floorPrims([uneven]), ru = analysePrims(pu, { scale: SC });
  check('lines at uneven spacing are not a stair', detectStairSymbols(pu, ru).length === 0);
  const free = duplexFloor(0); free.stair = { lines: [], polys: [], texts: [] };
  for (let k = 0; k < 10; k++) free.stair.lines.push([120, 200 + k * 27, 220, 200 + k * 27]);
  const pf = floorPrims([free]), rf = analysePrims(pf, { scale: SC });
  check('10 short evenly spaced lines with no rectangle around them are not a stair', detectStairSymbols(pf, rf).length === 0);

  // voids on the first floor
  const p1 = floorPrims([duplexFloor(1)]), r1 = analysePrims(p1, { scale: SC }), v1 = detectVoidSymbols(p1, r1);
  check('the first floor: the opening (rectangle + cross) found at x 520–620, y 266–670 (± 1 cm)', v1.length === 1 && Math.abs(v1[0].x - 520) <= 1 && Math.abs(v1[0].y - 266) <= 1 && Math.abs(v1[0].w - 100) <= 1 && Math.abs(v1[0].h - 404) <= 1, JSON.stringify(v1));
  const tv = duplexFloor(1); tv.stair = { lines: [], polys: [[[100, 100], [250, 100], [250, 220], [100, 220], [100, 100]]], texts: [{ str: 'VOID', x: 150, y: 165, h: 10 }] };
  const pt = floorPrims([tv]), rt = analysePrims(pt, { scale: SC }), vt = detectVoidSymbols(pt, rt);
  check('a rectangle marked "VOID" (no cross) is an opening too', vt.length === 1 && Math.abs(vt[0].x - 100) <= 1 && Math.abs(vt[0].w - 150) <= 1, JSON.stringify(vt));
  check('the walls of each floor are unchanged by the stair / void symbols', JSON.stringify(analysePrims(floorPrims([{ ...duplexFloor(0), stair: { lines: [], polys: [], texts: [] } }]), { scale: SC }).walls) === JSON.stringify(r.walls)
    && JSON.stringify(analysePrims(floorPrims([{ ...duplexFloor(1), stair: { lines: [], polys: [], texts: [] } }]), { scale: SC }).walls) === JSON.stringify(r1.walls));
}

// ───────────────────────── the whole pipeline ─────────────────────────
/**
 * Two floor results (ground, first) → aligned, stairs matched, built, the stair added by the engine.
 * Returns everything the checks need.
 */
function pipeline(prims0, r0, prims1, r1, { rotations } = {}) {
  const st0 = detectStairSymbols(prims0, r0), v1 = detectVoidSymbols(prims1, r1), st1 = detectStairSymbols(prims1, r1);
  const a = alignFloors(r0, r1, { rotations, lowerMarks: st0, upperMarks: [...v1, ...st1] });
  return { st0, v1, st1, a };
}
function build(r0, r1, a, st0, v1, st1) {
  const off = { x: a.dx, y: a.dy };
  const toG = (q) => ({ ...q, x: q.x + off.x, y: q.y + off.y });
  const m = matchStairs(st0, { voids: v1.map(toG), stairs: st1.map(toG) });
  const input = levelsInput([{ result: r0, offset: { x: 0, y: 0 }, ceiling: 280 }, { result: r1, offset: off, name: 'First floor', ceiling: 280, voids: m.plainVoids.map((q) => ({ ...q, x: q.x - off.x, y: q.y - off.y })) }], { meta: { name: 'Duplex import' }, heights: { ceiling: 280, slab: 20 } });
  const b = buildPlan(input, { levels: true });
  const shift = shiftOf(b.warnings);
  const stairs = m.stairs.map((s) => ({ ...s, level: 'L0', x: s.x + shift.x, y: s.y + shift.y }));
  const verdicts = b.ok ? stairVerdicts(PE, b.plan, stairs) : [];
  return { m, input, b, shift, verdicts, off };
}
function cellsOf(rects, step = 5) {
  const s = new Set();
  for (const r of rects) for (let y = Math.round(r.y); y < r.y + r.h - 1e-6; y += step) for (let x = Math.round(r.x); x < r.x + r.w - 1e-6; x += step) s.add(Math.round(x) + ',' + Math.round(y));
  return s;
}
const symDiff = (a, b) => { const A = cellsOf(a), B = cellsOf(b); let n = 0; for (const k of A) if (!B.has(k)) n++; for (const k of B) if (!A.has(k)) n++; return n; };
const roomsOf = (l) => (l.rooms || []).length;
function pipelineChecks(label, P, B, cornerChecks) {
  const { a } = P, { b, verdicts } = B;
  check(`${label}: aligned with high confidence (${a.text})`, a.confidence === 'high' && a.coinciding === 4, `${a.confidence} rot ${a.rot} dx ${a.dx} dy ${a.dy}`);
  check(`${label}: one plan with 2 levels`, b.ok && (b.plan.levels || []).length === 1 && b.plan.meta.floors === 2, b.warnings.filter((w) => w.level !== 'info').map((w) => w.text).join(' | '));
  const lv = (b.plan.levels || [])[0] || { walls: [], rooms: [] };
  check(`${label}: 2 rooms on each floor`, roomsOf(b.plan) === 2 && roomsOf(lv) === 2, `${roomsOf(b.plan)} / ${roomsOf(lv)}`);
  // the imported walls stop at the door / window gaps; the design's walls run through them (openings on top)
  const gaps = (os) => os.filter((o) => o.axis !== 'a').map(({ x, y, w, h }) => ({ x, y, w, h }));
  const d0 = symDiff([...b.plan.walls, ...gaps(b.plan.openings)], DUPLEX.walls), d1 = symDiff([...lv.walls, ...gaps(lv.openings)], DUPLEX.levels[0].walls);
  check(`${label}: ground and first floor walls (+ their door / window gaps) are the Duplex's (5 cm cells, symmetric difference 0) — levels aligned within 5 cm`, d0 === 0 && d1 === 0, `${d0} / ${d1}`);
  const v = verdicts[0] || {};
  check(`${label}: the stair is added by the engine (addStair) with its void`, verdicts.length === 1 && v.ok && v.voidId, JSON.stringify(v));
  const info = v.stairId ? PE.stairInfo(v.stairId) : null;
  check(`${label}: …18 risers of 16.7 cm, going 29 (as drawn), going up north, the void covers the headroom need`, info && info.data.risers === 18 && info.data.going === 29 && info.data.rot === 0 && info.covers && voidCovers(info.voids.map((q) => q.polygon), info.need), info && JSON.stringify(info.data));
  const fp = info && info.geo ? info.geo.footprint : [];
  const xs = fp.map((p) => p[0]), ys = fp.map((p) => p[1]);
  check(`${label}: …where it is drawn (x 520–620, y 266–759 ± 1 cm)`, fp.length && Math.abs(Math.min(...xs) - 520) <= 1 && Math.abs(Math.max(...xs) - 620) <= 1 && Math.abs(Math.min(...ys) - 266) <= 1 && Math.abs(Math.max(...ys) - 759) <= 1, JSON.stringify([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]));
  const vd = info && info.voids[0] ? info.voids[0].polygon : [];
  check(`${label}: …its void is the Duplex's v1 (x 520–620, y 266–670)`, vd.length && Math.min(...vd.map((p) => p[0])) === 520 && Math.max(...vd.map((p) => p[0])) === 620 && Math.min(...vd.map((p) => p[1])) === 266 && Math.max(...vd.map((p) => p[1])) === 670, JSON.stringify(vd));
  for (const [name, err] of cornerChecks) check(`${label}: underlay transform — ${name}`, err <= 1, `${err.toFixed(3)} cm`);
}

group('Pipeline: the Duplex as two plans side by side on one DXF sheet');
{
  const bytes = floorsDxf(duplexSheet()).bytes();
  const prims = readDxf(bytes), look = firstLook(prims);
  const opts = { candidates: look.candidates, layers: look.layers };
  const first = analyseDxf(prims, opts);
  check('the sheet holds 2 drawings', (first.drawings || []).length === 2, JSON.stringify(first.drawings));
  const rs = [0, 1].map((d) => analyseDxf(prims, { ...opts, walls: { drawing: d } }));
  // the ground floor is the one with the stair symbol (the dialog lets the user assign them)
  const gi = rs.findIndex((r) => detectStairSymbols(prims, r).length === 1);
  check('one drawing shows the stair (the ground floor), the other its opening (the first floor)', gi >= 0 && detectVoidSymbols(prims, rs[1 - gi]).length === 1);
  const r0 = rs[gi], r1 = rs[1 - gi];
  const P = pipeline(prims, r0, prims, r1);
  const B = build(r0, r1, P.a, P.st0, P.v1, P.st1);
  // per-floor underlay transforms: page → plan cm of the built plan = the result's transform, then the floor's offset, then
  // buildPlan's origin shift. Known corners: the first floor's partition NW corner (300, 20) and the ground floor's (500, 20)
  const T0 = affThen(r0.transform, [1, 0, 0, 1, B.shift.x, B.shift.y]), T1 = affThen(r1.transform, [1, 0, 0, 1, B.off.x + B.shift.x, B.off.y + B.shift.y]);
  const toPage = (x, y) => affApply(prims.dxf.toPage, 5000 + x, 20000 - y);       // floorsDxf: model = (5000 + x, 20000 − y)
  const e1 = Math.hypot(...affApply(T1, ...toPage(1700 + 300, 20)).map((v, i) => v - [300, 20][i]));
  const e0 = Math.hypot(...affApply(T0, ...toPage(500, 20)).map((v, i) => v - [500, 20][i]));
  pipelineChecks('one sheet', P, B, [['first floor partition corner (300, 20)', e1], ['ground floor partition corner (500, 20)', e0]]);
  check('one sheet: the first floor partition really is at (300, 20) in the built plan', (B.b.plan.levels[0].walls || []).some((w) => w.x === 300 && w.y === 20));
}

group('Pipeline: the Duplex as two DXF files, the first floor drawn turned 90°');
{
  const g = floorsDxf([duplexFloor(0)]).bytes(), u = floorsDxf([mapFloor(duplexFloor(1), ([x, y]) => [800 - y, x])]).bytes();
  const p0 = readDxf(g), p1 = readDxf(u);
  const l0 = firstLook(p0), l1 = firstLook(p1);
  const r0 = analyseDxf(p0, { candidates: l0.candidates, layers: l0.layers });
  let r1 = analyseDxf(p1, { candidates: l1.candidates, layers: l1.layers });
  const P = pipeline(p0, r0, p1, r1);
  check('two files: the alignment turns the first floor by 270° (it was drawn turned 90° clockwise)', P.a.rot === 270, `rot ${P.a.rot}`);
  // the dialog re-reads a turned floor with the extra rotation (normalise re-cuts the rectangles), keeping dx / dy
  r1 = analyseDxf(p1, { candidates: l1.candidates, layers: l1.layers, rotate: P.a.rot });
  const v1 = detectVoidSymbols(p1, r1), st1 = detectStairSymbols(p1, r1);
  const a2 = alignFloors(r0, r1, { rotations: [0], lowerMarks: P.st0, upperMarks: [...v1, ...st1] });
  check('…re-read turned: the same position (dx, dy) with no further turn', a2.rot === 0 && Math.abs(a2.dx - P.a.dx) <= 1 && Math.abs(a2.dy - P.a.dy) <= 1, JSON.stringify([P.a.dx, P.a.dy, a2.dx, a2.dy]));
  const B = build(r0, r1, a2, P.st0, v1, st1);
  const T1 = affThen(r1.transform, [1, 0, 0, 1, B.off.x + B.shift.x, B.off.y + B.shift.y]);
  const toPage = (x, y) => affApply(p1.dxf.toPage, 5000 + x, 20000 - y);
  const q = [800 - 20, 300];   // the partition's NW corner (300, 20) as drawn turned
  const e1 = Math.hypot(...affApply(T1, ...toPage(...q)).map((v, i) => v - [300, 20][i]));
  pipelineChecks('two files', { ...P, a: a2 }, B, [['first floor partition corner (300, 20) from the turned drawing', e1]]);
}

group('Pipeline: PDF-like primitives (one page, two plans)');
{
  const prims = floorPrims(duplexSheet());
  const rs = [0, 1].map((d) => analysePrims(prims, { scale: SC, walls: { drawing: d } }));
  const gi = rs.findIndex((r) => detectStairSymbols(prims, r).length === 1);
  const r0 = rs[gi], r1 = rs[1 - gi];
  const P = pipeline(prims, r0, prims, r1);
  const B = build(r0, r1, P.a, P.st0, P.v1, P.st1);
  const k = 1 / (100 * 2.54 / 72), toPage = (x, y) => [40 + x * k, 60 + y * k];
  const T1 = affThen(r1.transform, [1, 0, 0, 1, B.off.x + B.shift.x, B.off.y + B.shift.y]);
  const e1 = Math.hypot(...affApply(T1, ...toPage(1700 + 980, 300)).map((v, i) => v - [980, 300][i]));
  pipelineChecks('PDF page', P, B, [['first floor east window jamb (980, 300)', e1]]);
  // a refused proposal keeps the engine's reason: a stair drawn into the partition
  const bad = [{ x: 450, y: 266, w: 100, h: 493, axis: 'v', up: 'n', lines: 18, going: 29, width: 100, level: 'L0' }];
  const vb = stairVerdicts(PE, B.b.plan, bad.map((s) => ({ ...s, x: s.x + B.shift.x, y: s.y + B.shift.y })));
  check('a proposal across the partition is refused with the engine\'s reason (through its doorway / wall)', vb.length === 1 && !vb[0].ok && ['opening', 'wall'].includes(vb[0].code) && /move it clear of the (openings|walls)/.test(vb[0].reason), JSON.stringify(vb.map((x) => [x.code, x.reason])));
  const cand = stairCandidates({ x: 520, y: 266, w: 100, h: 493, axis: 'v', up: 'n', lines: 14, going: 29, width: 100 }, { rise: 300 });
  check('drawn riser count differs from what the rise needs → reported, the engine\'s count used', cand[0].risers === 18 && cand[0].notes.some((n) => /shows 14 risers; 18 are needed for the 300 cm/.test(n)), cand[0].notes.join(' | '));
}

group('One floor: nothing changes');
{
  const prims = floorPrims([duplexFloor(0)]);
  const before = JSON.stringify(analysePrims(prims, { scale: SC }));
  detectStairSymbols(prims, JSON.parse(before)); detectVoidSymbols(prims, JSON.parse(before));
  check('the reader\'s result is the same before and after looking for stairs (detection is read-only)', JSON.stringify(analysePrims(prims, { scale: SC })) === before);
  const one = levelsInput([{ result: JSON.parse(before), offset: { x: 0, y: 0 } }], { meta: { name: 'x' } });
  check('levelsInput with one floor has no upper levels', Array.isArray(one.levels) && one.levels.length === 0);
}

console.log(`\nimport-floors: ${passed} passed, ${failed} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
