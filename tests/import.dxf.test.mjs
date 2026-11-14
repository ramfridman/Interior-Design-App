// DXF import (src/import/dxf-read.js + dxf.js): fixtures generated here from the built-in house (src/core/plan.js)
// with tests/dxf-writer.mjs, then read and analysed with the unchanged detectors.   node tests/import.dxf.test.mjs
import v8 from 'node:v8';
import vm from 'node:vm';
import { PLAN } from '../src/core/plan.js';
import { readDxf, analyseDxf, firstLook, mtextPlain } from '../src/import/index.js';
import { dxfWriter, outlineLoops } from './dxf-writer.mjs';
import { houseDxf } from './dxf-fixtures.mjs';

let ok = true;
const fail = (m) => { ok = false; console.error('FAIL', m); };
const check = (cond, m) => { if (!cond) fail(m); else console.log('  ok', m); };
const t0 = Date.now();

// ---------- comparison helpers (same measures as tests/import.test.mjs) ----------
function cells(rects, step = 5) {
  const s = new Set();
  for (const r of rects) for (let y = r.y; y < r.y + r.h - 1e-6; y += step) for (let x = r.x; x < r.x + r.w - 1e-6; x += step) s.add(Math.round(x) + ',' + Math.round(y));
  return s;
}
/** Every plan wall covered by the found walls, nothing found further than `tol` from a plan wall. */
function compareWalls(found, plan, tol = 1) {
  const fu = cells(found, 1), pu = cells(plan, 1);
  let inter = 0; for (const k of fu) if (pu.has(k)) inter++;
  let sym = 0; for (const k of fu) if (!pu.has(k)) sym++; for (const k of pu) if (!fu.has(k)) sym++;
  const missing = plan.filter((p) => { const c = cells([p], 1); let n = 0; for (const k of c) if (fu.has(k)) n++; return n < c.size; });
  const grown = cells(plan.map((r) => ({ x: r.x - tol, y: r.y - tol, w: r.w + 2 * tol, h: r.h + 2 * tol })), 1);
  const stickOut = found.filter((f) => [...cells([f], 1)].some((k) => !grown.has(k)));
  return { recall: inter / pu.size, symDiffCm2: sym, missing, stickOut, found: found.length, plan: plan.length };
}
function compareOpenings(found, plan, tol = 1) {
  const used = new Set(), rows = [];
  for (const p of plan) {
    const m = found.find((f) => !used.has(f) && Math.abs(f.x - p.x) <= tol && Math.abs(f.y - p.y) <= tol && Math.abs(f.w - p.w) <= tol && Math.abs(f.h - p.h) <= tol);
    if (m) used.add(m);
    rows.push({ p, m, kindOk: !!m && m.kind === p.kind, widthOk: !!m && Math.abs(m.width - p.width) <= tol,
      hingeOk: !p.hinge || (!!m && m.hinge === p.hinge && m.swing === p.swing),
      innerOk: !p.innerDoor || (!!m && !!m.innerDoor && m.innerDoor.hinge === p.innerDoor.hinge && m.innerDoor.swing === p.innerDoor.swing) });
  }
  return { rows, extra: found.filter((f) => !used.has(f)) };
}

function runHouse(name, bytes, expectUnit) {
  const prims = readDxf(bytes);
  const look = firstLook(prims);
  const res = analyseDxf(prims, { candidates: look.candidates, layers: look.layers });
  const cw = compareWalls(res.walls, PLAN.walls, 1);
  const co = compareOpenings(res.openings, PLAN.openings, 1);
  const roles = Object.fromEntries(res.layers.filter((l) => l.role !== 'other').map((l) => [l.name, l.role]));
  console.log(`\n== ${name}: ${prims.paths.length} paths, units ${prims.dxf.units.name}, scale ${res.scale.label} (${res.scale.source}, ${res.scale.confidence}), roles ${JSON.stringify(roles)}`);
  console.log(`   walls ${cw.found} rects, recall ${(cw.recall * 100).toFixed(2)} %, symmetric difference ${cw.symDiffCm2} cm², missing ${cw.missing.map((w) => w.id).join(',') || 'none'}, sticking out ${cw.stickOut.length}`);
  const bad = co.rows.filter((r) => !r.m || !r.kindOk || !r.widthOk || !r.hingeOk || !r.innerOk);
  console.log(`   openings found ${co.rows.filter((r) => r.m).length}/${PLAN.openings.length}, kind right ${co.rows.filter((r) => r.kindOk).length}, hinge+swing right ${co.rows.filter((r) => r.m && r.p.hinge && r.hingeOk).length}/${PLAN.openings.filter((x) => x.hinge).length}, extra ${co.extra.length}`);
  for (const r of bad) console.log(`   ${r.p.id}: ${r.m ? `${r.m.kind} w ${r.m.width} hinge ${r.m.hinge} swing ${r.m.swing} inner ${JSON.stringify(r.m.innerDoor || null)}` : 'MISSED'}`);
  for (const e of co.extra) console.log(`   extra ${e.kind} [${e.x},${e.y},${e.w},${e.h}]`);
  console.log('   warnings:', res.warnings.map((x) => x.code).join(', ') || 'none');
  check(Math.abs(res.scale.cmPerDrawingUnit - expectUnit) < 1e-12 && res.scale.source === 'units' && res.scale.confidence >= 0.9, `${name}: scale exact from the file's units (1 unit = ${expectUnit} cm)`);
  check(cw.missing.length === 0 && cw.stickOut.length === 0 && cw.symDiffCm2 === 0, `${name}: every wall within 1 cm (wall area identical)`);
  check(co.rows.every((r) => r.m && r.kindOk && r.widthOk), `${name}: all ${PLAN.openings.length} openings found with the right kind and width`);
  check(co.rows.every((r) => r.hingeOk && r.innerOk), `${name}: every door's hinge and swing right (safe-room inner leaf included)`);
  check(co.extra.length === 0, `${name}: no extra openings`);
  return { prims, res };
}

// (a1) English layer names, centimetres, R2018 (UTF-8)
const A1 = runHouse('house, cm, A-WALL / A-DOOR / A-GLAZ', houseDxf({ unit: 1, insunits: 5 }).bytes(), 1);
check(A1.res.layers.find((l) => l.name === 'A-WALL').role === 'wall' && A1.res.layers.find((l) => l.name === 'A-DOOR').role === 'door' && A1.res.layers.find((l) => l.name === 'A-GLAZ').role === 'window'
  && A1.res.layers.find((l) => l.name === 'I-FURN').role === 'other', 'layer roles proposed from the names');
check(A1.res.openings.filter((o) => o.kind === 'door').every((o) => o.evidence && o.evidence.block === 'DOOR-90'), 'doors carry their block as evidence');
check(A1.prims.texts.some((t) => t.str === 'LIVING') && A1.prims.texts.some((t) => t.str === 'ROOM'), 'MTEXT formatting stripped and split into lines');
check(A1.prims.dims.length === 4 && A1.prims.dims.every((d) => Math.abs(d.value - d.du) < 1e-9), 'DIMENSIONs read (definition points and measured value)');

// (a2) Hebrew layer names, Windows-1255 code page, R2000
const A2 = runHouse('house, cm, Hebrew layers (ANSI_1255)', houseDxf({ unit: 1, insunits: 5, version: 'AC1015', codepage: 'ANSI_1255', names: { wall: 'קירות', door: 'דלתות', window: 'חלונות', dim: 'מידות', furn: 'ריהוט' }, title: 'תכנית קומת קרקע' }).bytes(), 1);
check(A2.prims.layers.some((l) => l.name === 'קירות' && l.dir === 'rtl') && A2.prims.texts.some((t) => t.str === 'תכנית קומת קרקע' && t.dir === 'rtl'), 'Hebrew layer names and text decoded from code page 1255');
check(A2.res.layers.find((l) => l.name === 'קירות').role === 'wall' && A2.res.layers.find((l) => l.name === 'דלתות').role === 'door' && A2.res.layers.find((l) => l.name === 'חלונות').role === 'window', 'Hebrew layer names → walls / doors / windows');

// (a3) millimetres
runHouse('house, mm', houseDxf({ unit: 0.1, insunits: 4 }).bytes(), 0.1);

// (a4) the common slip: $INSUNITS says mm but the drawing is in cm → the dimensions and proportions win, with a warning
{
  const prims = readDxf(houseDxf({ unit: 1, insunits: 4 }).bytes());
  const look = firstLook(prims);
  const res = analyseDxf(prims, { candidates: look.candidates, layers: look.layers });
  console.log(`\n== units slip: candidates ${look.candidates.map((c) => `${c.unit} ${c.source} ${c.confidence}`).join('; ')}`);
  check(look.candidates[0].cmPerDrawingUnit === 1 && res.warnings.some((w) => w.code === 'dxf-units-doubt'), '$INSUNITS = mm on a cm drawing: centimetres proposed, doubt reported');
}

// (a5) the user overrides the layer roles: walls taken from a layer the proposal did not know
{
  const prims = readDxf(houseDxf({ unit: 1, insunits: 5, names: { wall: 'L-STRUCT-07', door: 'L-12', window: 'L-13' } }).bytes());
  const look = firstLook(prims);
  const res = analyseDxf(prims, { candidates: look.candidates, layers: look.layers, roles: { 'L-STRUCT-07': 'wall', 'L-12': 'door', 'L-13': 'window' } });
  const cw = compareWalls(res.walls, PLAN.walls, 1), co = compareOpenings(res.openings, PLAN.openings, 1);
  console.log(`\n== unknown layer names: proposal ${JSON.stringify(look.layers.filter((l) => l.role !== 'other').map((l) => [l.name, l.role, l.reason]))}`);
  check(look.layers.find((l) => l.name === 'L-STRUCT-07').role === 'wall', 'wall layer found from geometry when its name says nothing');
  check(cw.missing.length === 0 && cw.symDiffCm2 === 0 && co.rows.every((r) => r.m && r.kindOk && r.hingeOk), 'user-chosen layer roles: walls and openings exact');
}

// (a6) walls drawn only as solid hatches (one per wall piece) on a layer whose name says nothing
{
  const w = houseDxf({ unit: 1, insunits: 5, names: { wall: 'P-01' } });
  const X = (x) => 12000 + x, Y = (y) => 30000 - y;
  // replace the outlines: the writer has no "remove", so build the hatch variant on a fresh layer and hide P-01's outlines
  for (const r of PLAN.walls) w.hatch([[X(r.x), Y(r.y)], [X(r.x + r.w), Y(r.y)], [X(r.x + r.w), Y(r.y + r.h)], [X(r.x), Y(r.y + r.h)]], { layer: 'P-02', color: 8 });
  w.layer('P-02', 8);
  const prims = readDxf(w.bytes());
  const look = firstLook(prims);
  const res = analyseDxf(prims, { candidates: look.candidates, layers: look.layers, roles: { 'P-01': 'other' } });
  const cw = compareWalls(res.walls, PLAN.walls, 1), co = compareOpenings(res.openings, PLAN.openings, 1);
  console.log(`\n== hatched walls: proposal ${JSON.stringify(look.layers.filter((l) => l.role !== 'other').map((l) => [l.name, l.role, l.reason]))}; walls ${res.walls.length}, openings ${co.rows.filter((r) => r.m && r.kindOk).length}`);
  check(look.layers.find((l) => l.name === 'P-02').role === 'wall', 'HATCH: a layer of wall-thickness hatches is proposed as walls');
  check(cw.missing.length === 0 && cw.symDiffCm2 === 0 && co.rows.every((r) => r.m && r.kindOk && r.hingeOk), 'HATCH-only walls (outline layer switched off): walls and openings exact');
}

// (a7) one pattern hatch (ANSI31) for all the walls: outer outline and every room as holes
{
  const w = houseDxf({ unit: 1, insunits: 5, names: { wall: 'P-01' } });
  const X = (x) => 12000 + x, Y = (y) => 30000 - y;
  w.layer('WALL-POCHE', 8);
  w.hatch(outlineLoops(PLAN.walls, 5).map((lp) => lp.map(([x, y]) => [X(x), Y(y)])), { layer: 'WALL-POCHE', pattern: 'ANSI31' });
  const prims = readDxf(w.bytes());
  const look = firstLook(prims);
  const res = analyseDxf(prims, { candidates: look.candidates, layers: look.layers, roles: { 'P-01': 'other' } });
  const cw = compareWalls(res.walls, PLAN.walls, 1);
  check(prims.paths.filter((p) => p.layer === 'WALL-POCHE').length === outlineLoops(PLAN.walls, 5).length, 'HATCH with holes: every boundary loop read');
  check(cw.missing.length === 0 && cw.symDiffCm2 === 0, 'one ring-shaped wall hatch (rooms as holes): walls exact');
}

// (a8) two plans side by side in model space (ground floor and a mirrored copy): the "which drawing" chooser
{
  const w = houseDxf({ unit: 1, insunits: 5 });
  // a second copy of the walls 25 m to the east (as a block, mirrored east–west)
  w.block('PLAN-COPY', [0, 0], (it) => { for (const loop of outlineLoops(PLAN.walls, 5)) w.lwpoly(loop.map(([x, y]) => [12000 + x, 30000 - y]), { into: it, layer: '0', closed: true }); });
  w.insert('PLAN-COPY', [12000 * 2 + 1535 + 2500 + 12000, 0], { layer: 'A-WALL', sx: -1 });
  const prims = readDxf(w.bytes());
  const look = firstLook(prims);
  const r0 = analyseDxf(prims, { candidates: look.candidates, layers: look.layers });
  const r1 = analyseDxf(prims, { candidates: look.candidates, layers: look.layers, walls: { drawing: 1 } });
  console.log(`\n== two plans: drawings ${JSON.stringify((r0.drawings || []).map((d) => [d.walls, d.bbox.x]))}; chosen ${r0.drawing} / ${r1.drawing}`);
  check(r0.drawings.length === 2 && r0.warnings.some((x) => x.code === 'several-drawings'), 'two plans side by side found as two drawings');
  const [a, b] = [r0, r1].map((r) => compareWalls(r.walls, PLAN.walls, 1));
  const mirrored = PLAN.walls.map((r) => ({ ...r, x: 1535 - r.x - r.w }));
  const b2 = compareWalls(r1.walls, mirrored, 1);
  check((a.symDiffCm2 === 0 && b2.symDiffCm2 === 0) || (compareWalls(r0.walls, mirrored, 1).symDiffCm2 === 0 && b.symDiffCm2 === 0), 'either drawing can be chosen and is read exactly');
}

// ---------- (b) R12: POLYLINE / VERTEX, no units, scale from the dimensions ----------
{
  // drawn in mm, dimension texts written in cm (an override string), no $INSUNITS
  const u = 0.1, X = (x) => (5000 + x) / u, Y = (y) => (9000 - y) / u;
  const w = dxfWriter({ version: 'AC1009', insunits: null, codepage: 'ANSI_1252' });
  w.layer('0', 7).layer('WALLS', 7).layer('DIM', 1);
  const rooms = [{ x: 0, y: 0, w: 600, h: 20 }, { x: 0, y: 380, w: 600, h: 20 }, { x: 0, y: 20, w: 20, h: 360 }, { x: 580, y: 20, w: 20, h: 360 }, { x: 290, y: 20, w: 10, h: 360 }];
  for (const loop of outlineLoops(rooms, 5)) w.poly(loop.map(([x, y]) => [X(x), Y(y)]), { layer: 'WALLS', closed: true });
  const dims = [[0, 600, -60], [0, 290, -30], [300, 600, -30]];
  for (const [a, b2, y] of dims) w.dim([X(a), Y(0)], [X(b2), Y(0)], [X(a), Y(y)], { layer: 'DIM', text: String(b2 - a) });
  w.dim([X(0), Y(0)], [X(0), Y(400)], [X(-60), Y(0)], { layer: 'DIM', angle: 90, text: '400' });
  const prims = readDxf(w.bytes());
  const look = firstLook(prims);
  const res = analyseDxf(prims, { candidates: look.candidates, layers: look.layers });
  console.log(`\n== R12 unitless: ${prims.paths.length} paths, ${prims.dims.length} dims, candidates ${look.candidates.map((c) => `${c.unit} ${c.source} ${c.confidence}`).join('; ')}; walls ${res.walls.length}`);
  check(prims.dxf.units.cmPerUnit === null && prims.warnings.some((x) => x.code === 'dxf-unitless'), 'R12: no units in the file, said so');
  check(look.candidates[0].unit === 'millimetres' && look.candidates[0].source === 'dimensions', 'R12: millimetres worked out from the dimension values');
  const cw = compareWalls(res.walls, rooms, 1);
  check(cw.missing.length === 0 && cw.symDiffCm2 === 0, 'R12: POLYLINE / VERTEX walls exact');
}

// ---------- (c) nested, arrayed and mirrored blocks ----------
{
  const w = dxfWriter({ version: 'AC1015', insunits: 5 });
  w.layer('0', 7).layer('A-WALL', 7).layer('X', 2);
  w.block('LEAF', [0, 0], (it) => { w.line([0, 0], [10, 0], { into: it, layer: '0' }); });
  w.block('PAIR', [5, 0], (it) => { w.insert('LEAF', [5, 0], { into: it, layer: '0' }); w.insert('LEAF', [5, 0], { into: it, layer: 'X', rot: 90 }); });
  w.insert('PAIR', [100, 100], { layer: 'A-WALL', sx: 2, sy: 2, rot: 90 });                       // nested, scaled, rotated
  w.insert('LEAF', [0, 0], { layer: 'A-WALL', cols: 3, rows: 2, dc: 50, dr: 20 });                  // MINSERT array
  w.insert('LEAF', [300, 0], { layer: 'A-WALL', sx: -1 });                                          // mirrored by scale
  w.insert('LEAF', [-400, 0], { layer: 'A-WALL', mirrored: true });                                 // mirrored by OCS
  const prims = readDxf(w.bytes());
  const T = prims.dxf.toPage, inv = (x, y) => [(x - T[4]) / T[0], (y - T[5]) / T[3]];
  const segs = prims.paths.map((p) => [...inv(p.pts[0], p.pts[1]), ...inv(p.pts[2], p.pts[3])].map((v) => Math.round(v * 1e6) / 1e6));
  const has = (a) => segs.some((s) => s.every((v, i) => Math.abs(v - a[i]) < 1e-6) || [s[2], s[3], s[0], s[1]].every((v, i) => Math.abs(v - a[i]) < 1e-6));
  console.log(`\n== blocks: ${segs.length} segments`, JSON.stringify(segs));
  // PAIR base (5, 0): LEAF at (5, 0) → (0..10 shifted) local (0,0)-(10,0); ×2, rot 90 → (100,100)-(100,120)
  check(has([100, 100, 100, 120]) && has([100, 100, 80, 100]), 'nested block: scale, rotation and base point applied at both levels');
  check(prims.paths.filter((p) => p.layer === 'X').length === 1 && prims.paths.filter((p) => p.layer === 'A-WALL').length === 9, 'layer 0 inside a block takes the insert\'s layer; a named layer is kept');
  check([[0, 0], [50, 0], [100, 0], [0, 20], [50, 20], [100, 20]].every(([x, y]) => has([x, y, x + 10, y])), 'array insert: 3 × 2 copies at the spacing');
  check(has([300, 0, 290, 0]) && has([400, 0, 390, 0]), 'mirrored inserts (negative x scale; OCS extrusion −1: OCS x −400 is WCS x 400)');
  check(prims.blocks.find((b) => b.name === 'LEAF').count === 8, 'block use counted (arrays included)');
}

// ---------- (c2) curves: bulge, ELLIPSE, SPLINE, CIRCLE, TEXT alignment, layer colour / frozen / off ----------
{
  const w = dxfWriter({ version: 'AC1018', insunits: 5, codepage: null });
  w.layer('0', 7).layer('C', 1).layer('FROZEN', 3, { frozen: true }).layer('OFF', 5, { off: true });
  w.lwpoly([[0, 0], [100, 0]], { layer: 'C', bulges: [1] });                                                    // a half circle, centre (50, 0)
  w.raw(['ELLIPSE', 100, 'AcDbEntity', 8, 'C', 100, 'AcDbEllipse', 10, 300, 20, 0, 30, 0, 11, 100, 21, 0, 31, 0, 210, 0, 220, 0, 230, 1, 40, 0.5, 41, 0, 42, 6.283185307179586]);
  w.raw(['SPLINE', 100, 'AcDbEntity', 8, 'C', 100, 'AcDbSpline', 70, 8, 71, 3, 72, 8, 73, 4, 74, 0, 40, 0, 40, 0, 40, 0, 40, 0, 40, 1, 40, 1, 40, 1, 40, 1,
    10, 500, 20, 0, 30, 0, 10, 530, 20, 60, 30, 0, 10, 570, 20, 60, 30, 0, 10, 600, 20, 0, 30, 0]);
  w.line([0, 200], [50, 200], { layer: 'FROZEN' }).line([0, 220], [50, 220], { layer: 'OFF' });
  w.text([700, 0], 10, 'מטבח', { layer: 'C' });
  const prims = readDxf(w.bytes());
  const T = prims.dxf.toPage, inv = (x, y) => [(x - T[4]) / T[0], (y - T[5]) / T[3]];
  const byKind = (k) => prims.paths.filter((p) => p.kind === k).map((p) => { const o = []; for (let i = 0; i < p.pts.length; i += 2) o.push(inv(p.pts[i], p.pts[i + 1])); return o; });
  const half = byKind('bulge')[0], ell = byKind('ellipse')[0], spl = byKind('spline')[0];
  check(half && half.every(([x, y]) => Math.abs(Math.hypot(x - 50, y) - 50) < 1e-9) && Math.min(...half.map((p) => p[1])) < -49.9, 'bulge 1 → a half circle of radius 50 (bulge sign: clockwise below the chord)');
  const ex = ell && [Math.min(...ell.map((p) => p[0])), Math.max(...ell.map((p) => p[0])), Math.min(...ell.map((p) => p[1])), Math.max(...ell.map((p) => p[1]))];
  check(ex && Math.abs(ex[0] - 200) < 1e-6 && Math.abs(ex[1] - 400) < 1e-6 && Math.abs(ex[2] + 50) < 0.2 && Math.abs(ex[3] - 50) < 0.2, `ELLIPSE flattened (extent ${ex && ex.map((v) => v.toFixed(1))})`);
  check(spl && Math.hypot(spl[0][0] - 500, spl[0][1]) < 1e-6 && Math.hypot(spl[spl.length - 1][0] - 600, spl[spl.length - 1][1]) < 1e-6 && Math.abs(Math.max(...spl.map((p) => p[1])) - 45) < 0.5, 'SPLINE (clamped cubic) flattened through its end points, peak 3/4 of the control height');
  const L = (n) => prims.layers.find((l) => l.name === n);
  check(L('C').colour === '#ff0000' && L('FROZEN').frozen && !L('FROZEN').visible && L('OFF').off && !L('OFF').visible, 'layer colour, frozen and off read');
  check(prims.texts.some((t) => t.str === 'מטבח' && t.dir === 'rtl'), 'Hebrew TEXT in an R2004 file without a code page (UTF-8 detected)');
}

// ---------- (d) a bulged polyline and a wall at 30°: reported, never bent or dropped ----------
{
  const w = houseDxf({ unit: 1, insunits: 5 });
  const X = (x) => 12000 + x, Y = (y) => 30000 - y;
  // a curved bay (bulged polyline pair) east of the house, and a 30° wall west of it
  w.lwpoly([[X(1600), Y(300)], [X(1600), Y(600)]], { layer: 'A-WALL', bulges: [0.4] });
  w.lwpoly([[X(1620), Y(300)], [X(1620), Y(600)]], { layer: 'A-WALL', bulges: [0.4] });
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  const a = [X(-100), Y(200)], L = 300, t = 20;
  w.lwpoly([a, [a[0] - L * c, a[1] + L * s], [a[0] - L * c - t * s, a[1] + L * s - t * c], [a[0] - t * s, a[1] - t * c]], { layer: 'A-WALL', closed: true });
  const prims = readDxf(w.bytes());
  const res = analyseDxf(prims);
  const codes = res.warnings.map((x) => x.code);
  console.log(`\n== curved + angled: warnings ${codes.join(', ')}; unsupported ${JSON.stringify(res.unsupported.map((u) => [u.type, u.len]))}`);
  check(codes.includes('curved-wall') && codes.includes('angled-wall'), 'curved and 30° wall lines reported (curved-wall, angled-wall)');
  check(res.unsupported.some((u) => u.type === 'curved') && res.unsupported.some((u) => u.type === 'angled'), 'both pieces listed as unsupported (with where)');
  const cw = compareWalls(res.walls, PLAN.walls, 1);
  check(cw.missing.length === 0 && cw.symDiffCm2 === 0, 'the orthogonal walls are unchanged');
}

// ---------- (e) binary, truncated, not a DXF ----------
{
  const err = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  const bin = new Uint8Array(64); bin.set(new TextEncoder().encode('AutoCAD Binary DXF\r\n\x1a\0'));
  const e1 = err(() => readDxf(bin));
  check(e1 && e1.plain && e1.code === 'dxf-binary' && /binary DXF/.test(e1.message) && /ASCII/.test(e1.message), `binary DXF refused in plain words (“${e1 && e1.message}”)`);
  const full = houseDxf({ unit: 1, insunits: 5 }).bytes();
  const e2 = err(() => readDxf(full.subarray(0, Math.floor(full.length * 0.6))));
  check(e2 && e2.plain && e2.code === 'dxf-truncated', `truncated file → plain error (“${e2 && e2.message}”)`);
  const e3 = err(() => readDxf(new TextEncoder().encode('hello\nworld\n')));
  check(e3 && e3.plain && /damaged|not a DXF/.test(e3.message), `not a DXF → plain error (“${e3 && e3.message}”)`);
  const e4 = err(() => readDxf(new Uint8Array(0)));
  check(e4 && e4.plain && e4.code === 'dxf-empty', 'empty file → plain error');
  check(mtextPlain('{\\H2.5x;\\C1;Bed\\~room}\\P%%c 10 \\S1/2;') .join('|') === 'Bed room|Ø 10 1/2', 'MTEXT codes stripped (height, colour, non-breaking space, %%c, stacked fraction)');
}

// ---------- (f) a 20 MB file: streaming read within time and memory bounds ----------
{
  const base = houseDxf({ unit: 1, insunits: 5 }).text_();
  // a furniture / hatch-line layer padding the file to ~20 MB of LINE entities
  const cut = base.lastIndexOf('  0\nENDSEC\n  0\nEOF');
  const parts = [base.slice(0, cut)];
  let size = base.length, n = 0;
  while (size < 20 * 1048576) {
    const x = 10000 + (n % 400) * 7.5, y = 20000 + Math.floor(n / 400) * 3.25;
    const e = `  0\nLINE\n  5\n${(0x10000 + n).toString(16)}\n100\nAcDbEntity\n  8\nI-FURN\n100\nAcDbLine\n 10\n${x}\n 20\n${y}\n 30\n0\n 11\n${x + 5.5}\n 21\n${y + 1.25}\n 31\n0\n`;
    parts.push(e); size += e.length; n++;
  }
  parts.push('  0\nENDSEC\n  0\nEOF\n');
  const bytes = new TextEncoder().encode(parts.join(''));
  parts.length = 0;
  v8.setFlagsFromString('--expose_gc');
  const gc = vm.runInNewContext('gc');
  gc();
  const m0 = process.memoryUsage().heapUsed, t = Date.now();
  const prims = readDxf(bytes);
  const ms = Date.now() - t;
  const peak = (v8.getHeapStatistics().total_heap_size - m0) / 1048576;  // heap reserved during the read (≥ the peak use)
  gc();
  const kept = (process.memoryUsage().heapUsed - m0) / 1048576;           // what the result holds
  console.log(`\n== 20 MB: ${(bytes.length / 1048576).toFixed(1)} MB, ${n} padding lines → ${prims.paths.length} paths in ${ms} ms; heap during the read ≤ +${peak.toFixed(0)} MB, result +${kept.toFixed(0)} MB`);
  check(bytes.length >= 20 * 1048576 && prims.paths.length > n, '20 MB file read completely');
  check(ms < 15000, `20 MB read within 15 s (${ms} ms)`);
  check(peak < 600 && kept < 300, `20 MB read within 600 MB of heap, result under 300 MB (${peak.toFixed(0)} / ${kept.toFixed(0)} MB)`);
}

console.log(`\n${ok ? 'ALL PASS' : 'SOME CHECKS FAILED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(ok ? 0 : 1);
