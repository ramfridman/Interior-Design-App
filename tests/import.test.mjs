// Sketch import engine (src/import/): real architect PDFs against the hand extraction in src/core/plan.js,
// synthetic vector cases, and a best-effort raster case.   node tests/import.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { PLAN } from '../src/core/plan.js';
import { readPdf, analysePrims, detectScale, detectWalls, detectOpenings, normalise, readImage, scaleFromPoints } from '../src/import/index.js';
import { PT_CM } from '../src/import/prep.js';

let ok = true;
const fail = (m) => { ok = false; console.error('FAIL', m); };
const check = (cond, m) => { if (!cond) fail(m); };
const t0 = Date.now();

// ---------- comparison helpers ----------
const key = (r) => [r.x, r.y, r.w, r.h].join(',');
function cells(rects, step = 5) {
  const s = new Set();
  for (const r of rects) for (let y = r.y; y < r.y + r.h - 1e-6; y += step) for (let x = r.x; x < r.x + r.w - 1e-6; x += step) s.add(Math.round(x) + ',' + Math.round(y));
  return s;
}
/** Every plan wall matched within `tol` cm: by an equal rectangle (all edges within tol) or, where the engine split /
 *  merged rectangles differently, by the found union covering it with nothing sticking out by more than tol. */
function compareWalls(found, plan, tol = 5) {
  const fu = cells(found), pu = cells(plan);
  const exact = plan.filter((p) => found.some((f) => Math.abs(f.x - p.x) <= tol && Math.abs(f.y - p.y) <= tol && Math.abs(f.x + f.w - p.x - p.w) <= tol && Math.abs(f.y + f.h - p.y - p.h) <= tol));
  const covered = plan.filter((p) => { const c = cells([p]); let n = 0; for (const k of c) if (fu.has(k)) n++; return n >= 0.99 * c.size; });
  const grow = (r) => ({ x: r.x - tol, y: r.y - tol, w: r.w + 2 * tol, h: r.h + 2 * tol });
  const puGrown = cells(plan.map(grow));
  const stickOut = found.filter((f) => [...cells([f])].some((k) => !puGrown.has(k)));
  const within = plan.filter((p) => exact.includes(p) || covered.includes(p));
  let sym = 0; for (const k of fu) if (!pu.has(k)) sym++; for (const k of pu) if (!fu.has(k)) sym++;
  const area = (a) => a.reduce((t, w) => t + w.w * w.h, 0);
  let inter = 0; for (const k of fu) if (pu.has(k)) inter++;
  let near5 = 0; for (const k of fu) if (puGrown.has(k)) near5++;
  const recall = pu.size ? inter / pu.size : 0, precision = fu.size ? near5 / fu.size : 0;
  return { recall, precision, found: found.length, plan: plan.length, exact: exact.length, within: within.length, missing: plan.filter((p) => !within.includes(p)),
    stickOut, areaFound: area(found), areaPlan: area(plan), symDiffCm2: sym * 25,
    extra: found.filter((f) => !plan.some((p) => key(p) === key(f))), notExact: plan.filter((p) => !exact.includes(p)) };
}
function compareOpenings(found, plan, tol = 5) {
  const rows = [];
  const used = new Set();
  for (const p of plan) {
    const m = found.find((f) => !used.has(f) && Math.abs(f.x - p.x) <= tol && Math.abs(f.y - p.y) <= tol && Math.abs(f.w - p.w) <= tol && Math.abs(f.h - p.h) <= tol);
    if (m) used.add(m);
    rows.push({ id: p.id, kind: p.kind, found: m || null, kindOk: !!m && m.kind === p.kind, hingeOk: !p.hinge || (!!m && m.hinge === p.hinge && m.swing === p.swing),
      extOk: !!m && !!m.exterior === !!p.exterior && (!p.exterior || m.outside === p.outside), innerOk: !p.innerDoor || (!!m && !!m.innerDoor && m.innerDoor.hinge === p.innerDoor.hinge && m.innerDoor.swing === p.innerDoor.swing) });
  }
  return { rows, extra: found.filter((f) => !used.has(f)) };
}
function report(name, res, plan) {
  const cw = compareWalls(res.walls, plan.walls);
  console.log(`\n== ${name}: scale ${res.scale.label} (${res.scale.source}, confidence ${res.scale.confidence}), bounds ${res.stats.bounds.w} × ${res.stats.bounds.h} cm`);
  console.log(`walls: found ${cw.found}, plan ${cw.plan}; identical rectangles ${cw.exact}; plan walls matched within 5 cm ${cw.within}/${cw.plan}; ` +
    `area ${cw.areaFound} vs ${cw.areaPlan} cm² (${((cw.areaFound / cw.areaPlan - 1) * 100).toFixed(2)} %), symmetric difference ${cw.symDiffCm2} cm²`);
  if (cw.notExact.length) console.log('  plan rectangles not reproduced 1:1 (decomposition differs, area identical):', cw.notExact.map((w) => `${w.id} [${key(w)}] ${w.kind}`).join('; '));
  if (cw.extra.length) console.log('  engine rectangles not in plan.js:', cw.extra.map((w) => `[${key(w)}] ${w.kind}`).join('; '));
  if (cw.missing.length) console.log('  MISSING:', cw.missing.map((w) => w.id).join(', '));
  const kinds = res.walls.map((f) => { const p = plan.walls.find((q) => key(q) === key(f)); return p && p.kind !== f.kind ? `${p.id} ${p.kind}→${f.kind}` : null; }).filter(Boolean);
  console.log('  kind differences:', kinds.join('; ') || 'none');
  const co = compareOpenings(res.openings, plan.openings);
  const hit = co.rows.filter((r) => r.found);
  console.log(`openings: plan ${plan.openings.length}, found ${hit.length} (kind right ${co.rows.filter((r) => r.kindOk).length}, hinge+swing right ${co.rows.filter((r) => r.found && r.hingeOk && r.found.hinge !== undefined).length}/${plan.openings.filter((o) => o.hinge).length} doors, exterior/outside right ${co.rows.filter((r) => r.extOk).length}), extra ${co.extra.length}`);
  for (const r of co.rows) if (!r.found || !r.kindOk || !r.hingeOk || !r.extOk || !r.innerOk) console.log(`  ${r.id}: ${r.found ? `${r.found.kind} hinge ${r.found.hinge} swing ${r.found.swing} ext ${r.found.exterior}/${r.found.outside}${r.innerOk ? '' : ' innerDoor wrong'}` : 'MISSED'}`);
  for (const e of co.extra) console.log(`  extra ${e.kind} [${key(e)}] confidence ${e.confidence}`);
  console.log('  warnings:', res.warnings.map((w) => w.code).join(', ') || 'none');
  return { cw, co };
}

// ---------- 1. lot 98 site plan (the owner's house) ----------
const LOT98 = 'docs/reference/lot-98-site-plan-2026-11-10.pdf', LOT99 = 'docs/reference/E7-dimension-sheet-2026-11-08-mirror-twin.pdf';
if (!existsSync(LOT98)) console.log('reference PDFs not present: skipping the real-drawing cases');
else {
  const prims = await readPdf(readFileSync(LOT98));
  check(prims.paths.length > 1000 && prims.pageBox.w > 0, 'readPdf returns vector paths');
  const res = analysePrims(prims);
  check(res.scale.ratio === 100, `lot 98 scale 1:100 (got ${res.scale.label})`);
  const { cw, co } = report('lot 98 site plan', res, PLAN);
  // count: the hand extraction splits one straight 20 cm wall run (x 340, y 890–1380) into three pieces by meaning
  // (partition / safe-room shell / exterior) that the drawing does not distinguish → the engine has one piece there.
  check(Math.abs(cw.found - cw.plan) <= 3, `lot 98 wall count ${cw.found} vs ${cw.plan} (± 3)`);
  check(cw.within === cw.plan && cw.stickOut.length === 0, 'lot 98: every wall within 5 cm');
  check(Math.abs(cw.areaFound / cw.areaPlan - 1) <= 0.01, 'lot 98 wall area within 1 %');
  check(res.stats.bounds.w === 1535 && res.stats.bounds.h === 1380, 'lot 98 house bounds 1535 × 1380');
  const found = co.rows.filter((r) => r.found && r.kindOk).length;
  check(found >= 22, `lot 98 openings found with the right kind: ${found}/24`);
  check(co.rows.filter((r) => r.found && r.found.kind === 'door').every((r) => r.hingeOk), 'lot 98 door hinge / swing');
  check(co.extra.length <= 2, `lot 98 extra openings ${co.extra.length}`);
  // transform: the plan's NW corner maps back to the page where the outline is
  const T = res.transform, inv = (X, Y) => { const det = T[0] * T[3] - T[1] * T[2]; return [(T[3] * (X - T[4]) - T[2] * (Y - T[5])) / det, (-T[1] * (X - T[4]) + T[0] * (Y - T[5])) / det]; };
  const [px, py] = inv(340, 0); // the north-west corner of the kitchen's north wall
  const near = prims.paths.some((p) => p.lw > 1 && p.pts.some((v, i) => i % 2 === 0 && Math.hypot(v - px, p.pts[i + 1] - py) < 0.5));
  check(near, 'transform maps plan (0,0) onto a wall-outline vertex on the page');

  // the output is accepted as is by the plan builder (src/core/plan-build.js), when present
  if (existsSync('src/core/plan-build.js')) {
    const { buildPlan } = await import('../src/core/plan-build.js');
    const b = buildPlan({ walls: res.walls, openings: res.openings });
    console.log(`  buildPlan: ok ${b.ok}, ${b.plan.walls.length} walls, ${b.plan.openings.length} openings, ${b.plan.rooms.length} rooms`);
    check(b.ok && b.plan.openings.length === res.openings.length, 'buildPlan accepts the import (no errors, every opening kept)');
  }

  // ---------- 2. the mirror-twin dimension sheet → lot 98 by mirroring north–south ----------
  const prims99 = await readPdf(readFileSync(LOT99));
  for (const drawing of [0, 1]) {
    const r99 = analysePrims(prims99, { mirror: 'ns', walls: { drawing } });
    const { cw: c2, co: o2 } = report(`lot 99 dimension sheet, drawing ${drawing + 1} of ${r99.drawings.length} (${r99.drawings[drawing].bbox.x > r99.drawings[1 - drawing].bbox.x ? 'right-hand: dimension plan' : 'left-hand: site plan'}), mirrored N–S`, r99, PLAN);
    check(r99.scale.ratio === 100, 'lot 99 scale 1:100');
    check(Math.abs(c2.found - c2.plan) <= 3, `lot 99 (drawing ${drawing + 1}) wall count ${c2.found} vs ${c2.plan}`);
    check(Math.abs(c2.areaFound / c2.areaPlan - 1) <= 0.01, `lot 99 (drawing ${drawing + 1}) wall area within 1 %`);
    check(c2.within >= c2.plan - 2, `lot 99 (drawing ${drawing + 1}) walls within 5 cm: ${c2.within}/${c2.plan}`);
    check(o2.rows.filter((r) => r.found).length >= 20, `lot 99 (drawing ${drawing + 1}) openings found ${o2.rows.filter((r) => r.found).length}/24`);
  }
}

// ---------- 3. synthetic: two rooms at 1:50 with a stated scale, a door and a window ----------
/** Outline segments (page units) of a union of cm rectangles drawn at 1:S, origin offset (pt). */
function outline(rects, S, off = [40, 60], step = 5) {
  const k = 1 / (S * PT_CM);
  const solid = cells(rects, step);
  const has = (x, y) => solid.has(x + ',' + y);
  const H = [], V = [];
  for (const c of solid) {
    const [x, y] = c.split(',').map(Number);
    if (!has(x, y - step)) H.push([x, y, x + step, y]);
    if (!has(x, y + step)) H.push([x, y + step, x + step, y + step]);
    if (!has(x - step, y)) V.push([x, y, x, y + step]);
    if (!has(x + step, y)) V.push([x + step, y, x + step, y + step]);
  }
  const P = (x, y) => [off[0] + x * k, off[1] + y * k];
  return [...H, ...V].map(([a, b, c, d]) => [...P(a, b), ...P(c, d)]);
}
const pen = (pts, lw, extra = {}) => ({ pts, closed: false, stroke: true, fill: false, evenOdd: false, lw, color: '#000000', fillColor: '#000000', dash: [], curved: false, ...extra });
function arcPts(cx, cy, r, a0, a1, n = 12) { const o = []; for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; o.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); } return o; }
{
  const S = 50, k = 1 / (S * PT_CM), off = [40, 60];
  const P = (x, y) => [off[0] + x * k, off[1] + y * k];
  // 800 × 500 outside, 20 cm exterior walls, 10 cm partition at x 400–410 with a 90 cm door (y 200–290),
  // a 120 cm window in the north wall (x 150–270)
  const walls = [
    { x: 0, y: 0, w: 150, h: 20 }, { x: 270, y: 0, w: 530, h: 20 }, { x: 0, y: 20, w: 20, h: 480 }, { x: 780, y: 20, w: 20, h: 480 },
    { x: 20, y: 480, w: 760, h: 20 }, { x: 400, y: 20, w: 10, h: 180 }, { x: 400, y: 290, w: 10, h: 190 },
  ];
  const paths = outline(walls, S, off).map((s) => pen(s, 0.7));
  paths.push(pen([...P(150, 8), ...P(270, 8)], 0.18), pen([...P(150, 12), ...P(270, 12)], 0.18)); // window glass lines
  const [hx, hy] = P(410, 200); // hinge on the east face, north jamb; leaf swings east
  paths.push(pen([hx, hy, hx + 90 * k, hy], 0.18), pen(arcPts(hx, hy, 90 * k, 0, 90), 0.18, { curved: true }));
  const prims = { pageBox: { w: 595, h: 842 }, paths, texts: [{ str: 'SCALE 1:50', x: 400, y: 800, w: 60, h: 8, angle: 0 }, { str: 'PLAN', x: 40, y: 40, w: 30, h: 8, angle: 0 }], images: [] };
  const res = analysePrims(prims);
  console.log(`\n== synthetic 1:50 two rooms: scale ${res.scale.label} (${res.scale.source}), walls ${res.walls.length}, openings ${res.openings.map((o) => `${o.kind} ${o.width} hinge ${o.hinge || '-'} swing ${o.swing || '-'}`).join('; ')}`);
  check(res.scale.ratio === 50 && res.scale.source === 'text', 'synthetic: scale from "SCALE 1:50" text');
  const cw = compareWalls(res.walls, walls);
  check(cw.within === walls.length && cw.areaFound === cw.areaPlan, 'synthetic: walls exact');
  // convention (same as the hand extraction): a wall reached first in a top-down scan keeps the junction, so the
  // partition runs through the south wall's band and splits it in two → 8 rectangles, 6 exterior + 2 interior
  check(res.walls.length === 8 && res.walls.filter((w) => w.kind === 'exterior').length === 6, `synthetic: exterior / interior classification (${res.walls.map((w) => w.kind[0]).join('')})`);
  const door = res.openings.find((o) => o.kind === 'door'), win = res.openings.find((o) => o.kind === 'window');
  check(door && door.width === 90 && door.x === 400 && door.y === 200 && door.hinge === 'n' && door.swing === 'e', 'synthetic: door width / hinge / swing');
  check(win && win.width === 120 && win.x === 150 && win.exterior && win.outside === 'n', 'synthetic: window');
  // scale from dimension strings (no scale text): numbers written along thin dimension lines
  const dimPrims = { ...prims, texts: [], paths: [...prims.paths] };
  for (const [x0, x1, y] of [[0, 800, -80], [0, 150, -50], [150, 270, -50], [270, 800, -50]]) {
    const [ax, ay] = P(x0, y), [bx] = P(x1, y);
    dimPrims.paths.push(pen([ax, ay, bx, ay], 0.12));
    const str = String(x1 - x0), tw = str.length * 4;
    dimPrims.texts.push({ str, x: (ax + bx) / 2 - tw / 2, y: ay - 1.5, w: tw, h: 6, angle: 0 });
  }
  const ds = detectScale(dimPrims);
  console.log(`== synthetic dimension strings: ${ds.best.label} (${ds.best.source}, confidence ${ds.best.confidence})`);
  check(ds.best.source === 'dimensions' && ds.best.ratio === 50, 'scale from dimension strings');
  // explicit overrides
  check(Math.abs(detectScale(prims, { cmPerUnit: 2 }).best.cmPerUnit - 2) < 1e-12, 'scale override { cmPerUnit }');
  const [ax, ay] = P(0, 0), [bx, by] = P(800, 0);
  check(Math.abs(scaleFromPoints([ax, ay], [bx, by], 800).cmPerUnit - S * PT_CM) < 1e-9, 'scale from two points');
  // rotate 90° clockwise + mirror: geometry stays consistent
  const w = detectWalls(prims, { cmPerUnit: S * PT_CM }), o = detectOpenings(prims, w, { cmPerUnit: S * PT_CM });
  const r90 = normalise({ walls: w, openings: o }, { rotate: 90 });
  check(r90.stats.bounds.w === 500 && r90.stats.bounds.h === 800, 'rotate 90: bounds swap');
  const d90 = r90.openings.find((x) => x.kind === 'door');
  check(d90.axis === 'h' && d90.hinge === 'e' && d90.swing === 's', `rotate 90: door axis / hinge / swing (${d90.axis} ${d90.hinge} ${d90.swing})`);

  // ---------- 4. synthetic: an angled wall must be reported, not bent or dropped silently ----------
  const angled = { ...prims, paths: [...prims.paths] };
  // a 45° wall piece (20 cm thick, ~300 cm long) attached outside the south-east corner
  const a0 = P(800, 500), d = 300 * k / Math.SQRT2, t = 20 * k / Math.SQRT2;
  angled.paths.push(pen([a0[0], a0[1], a0[0] + d, a0[1] + d], 0.7), pen([a0[0] - t, a0[1] + t, a0[0] + d - t, a0[1] + d + t], 0.7));
  const ra = analysePrims(angled);
  const warn = ra.warnings.find((x) => x.code === 'angled-wall');
  console.log(`== synthetic angled wall: warnings ${ra.warnings.map((x) => x.code).join(', ')}; unsupported ${JSON.stringify(ra.unsupported.map((u) => [u.type, u.len]))}`);
  check(!!warn && ra.unsupported.length >= 1, 'angled wall reported');
  check(compareWalls(ra.walls, walls).within === walls.length, 'angled wall: the orthogonal walls are unchanged');

  // ---------- 4b. the same with the slants option: converted, the rest unchanged ----------
  const rs = analysePrims(angled, { slants: true });
  console.log(`== synthetic angled wall, slants option: slants ${JSON.stringify(rs.slants)}; unsupported ${rs.unsupported.length}; warnings ${rs.warnings.map((x) => x.code).join(', ') || 'none'}`);
  const s45 = rs.slants && rs.slants[0];
  check(rs.slants && rs.slants.length === 1 && s45.t === 20 && rs.unsupported.length === 0 && !rs.warnings.some((x) => x.code === 'angled-wall'), 'slants option: the 45° wall pair becomes one slant of 20 cm');
  // its centre line: 10 cm off the drawn line from the house's south-east corner, 300 cm long
  const dcl = (x, y) => Math.abs((x - 800) - (y - 500) + 10 * Math.SQRT2) / Math.SQRT2;
  // (its house end stops 7 cm short of the corner's faces and is extended to them: ≤ 1.5 t)
  const len45 = s45 && Math.hypot(s45.x2 - s45.x1, s45.y2 - s45.y1);
  check(s45 && dcl(s45.x1, s45.y1) <= 0.2 && dcl(s45.x2, s45.y2) <= 0.2 && len45 >= 300 && len45 <= 330 && Math.abs(s45.y1 - 500) <= 0.1, `slants option: 45° centre line exact, house end extended to the wall face (${s45 && [s45.x1, s45.y1, s45.x2, s45.y2]})`);
  check(JSON.stringify(rs.walls) === JSON.stringify(ra.walls) && JSON.stringify(rs.openings) === JSON.stringify(ra.openings), 'slants option: the orthogonal walls and openings are byte-identical to the default run');
  check(!('slants' in ra), 'default run: no `slants` key');
}

// ---------- 6. angled and curved walls with the slants option (stage A6): the "Wedge" and a quarter circle ----------
{
  const { WEDGE, wedgeDrawing, pdfPrims, quarterOutline, QUARTER, wedgeSolids, unionOutline, slantLen } = await import('./import-slant-fixtures.mjs');
  const d = wedgeDrawing();
  const prims = pdfPrims({ lines: d.lines, symLines: [...d.winLines, ...d.doorLines], symArcs: d.arcs });
  const res = analysePrims(prims, { slants: true });
  console.log(`\n== Wedge (PDF-like), slants option: ${res.walls.length} rects, slants ${JSON.stringify(res.slants)}`);
  console.log(`   openings ${JSON.stringify(res.openings.map((o) => (o.axis === 'a' ? [o.kind, o.wall, o.at, o.width, o.hinge, o.swing, o.outside] : [o.kind, o.x, o.y, o.w, o.h, o.hinge, o.swing, o.outside])))}; warnings ${res.warnings.map((x) => x.code).join(', ') || 'none'}`);
  wedgeChecks('Wedge PDF', res, WEDGE, slantLen);

  // the orthogonal part equals the orthogonal-only drawing of the same rectangles (without the slants)
  const orthoOnly = (() => {
    const polys = wedgeSolids().slice(0, 6);
    return pdfPrims({ lines: unionOutline(polys), symLines: d.doorLines.slice(2), symArcs: d.arcs.slice(1) });
  })();
  const ro = analysePrims(orthoOnly);
  const geo = (ws) => JSON.stringify(ws.map((w) => [w.x, w.y, w.w, w.h]));
  const ogeo = (os) => JSON.stringify(os.filter((o) => o.axis !== 'a').map((o) => [o.kind, o.x, o.y, o.w, o.h, o.hinge, o.swing]));
  check(geo(res.walls) === geo(ro.walls) && ogeo(res.openings) === ogeo(ro.openings), `Wedge: rectangles and their openings identical to the orthogonal-only drawing (${geo(res.walls)})`);

  // rotation and mirrors: the same detection through normalise
  const sc = { cmPerUnit: 50 * PT_CM };
  const w = detectWalls(prims, sc, { slants: true }), o = detectOpenings(prims, w, sc);
  const r0 = normalise({ walls: w, openings: o });
  check(JSON.stringify(r0.slants) === JSON.stringify(res.slants) && JSON.stringify(r0.openings) === JSON.stringify(res.openings), 'Wedge: detectWalls / detectOpenings / normalise give the analysePrims result');
  const B = r0.stats.bounds;
  for (const [opt, map] of [[{ rotate: 90 }, (x, y) => [B.h - y, x]], [{ mirror: 'ns' }, (x, y) => [x, B.h - y]], [{ mirror: 'ew' }, (x, y) => [B.w - x, y]], [{ rotate: 270, mirror: 'ew' }, (x, y) => [y, x]]]) {
    const r = normalise({ walls: w, openings: o }, opt);
    const name = JSON.stringify(opt);
    const okS = r0.slants.every((s) => { const a = map(s.x1, s.y1), b = map(s.x2, s.y2); return r.slants.some((q) => q.t === s.t && q.kind === s.kind && ((Math.hypot(q.x1 - a[0], q.y1 - a[1]) <= 0.15 && Math.hypot(q.x2 - b[0], q.y2 - b[1]) <= 0.15) || (Math.hypot(q.x1 - b[0], q.y1 - b[1]) <= 0.15 && Math.hypot(q.x2 - a[0], q.y2 - a[1]) <= 0.15))); });
    const g0 = r0.openings.filter((x) => x.axis === 'a').map((x) => opGeom(x, r0.slants)), g1 = r.openings.filter((x) => x.axis === 'a').map((x) => opGeom(x, r.slants));
    const mp = (p) => p && map(p[0], p[1]);
    const same = (p, q) => (!p && !q) || (p && q && Math.hypot(p[0] - q[0], p[1] - q[1]) <= 0.3);
    const okO = g0.length === g1.length && g0.every((a) => g1.some((b) => b.kind === a.kind && Math.abs(b.width - a.width) <= 0.1 && same(mp(a.c), b.c) && same(mp(a.hingePt), b.hingePt) && same(mp(a.swingPt), b.swingPt) && same(mp(a.outPt), b.outPt)));
    // (rectangles are re-cut top-down in the output orientation, so a junction square can change hands: ≤ 2 × 20 × 10 cm²)
    const area = (ws, kind) => ws.filter((x) => !kind || x.kind === kind).reduce((t, x) => t + x.w * x.h, 0);
    const okW = area(r.walls) === area(r0.walls) && Math.abs(area(r.walls, 'interior') - area(r0.walls, 'interior')) <= 400;
    const canon = r.slants.every((s) => s.y1 < s.y2 || (s.y1 === s.y2 && s.x1 <= s.x2));
    console.log(`   ${name}: slants ${JSON.stringify(r.slants.map((s) => [s.id, s.x1, s.y1, s.x2, s.y2]))}; slant openings ${JSON.stringify(r.openings.filter((x) => x.axis === 'a').map((x) => [x.kind, x.wall, x.at, x.hinge, x.swing, x.outside]))}`);
    check(okS && okO && okW && canon, `Wedge ${name}: centre lines, thickness, kinds, opening positions, hinge / swing / outside sides and wall areas consistent`);
  }

  // filled (poché) walls: thin filled parallelograms are slants too
  const fillPrims = { pageBox: prims.pageBox, texts: prims.texts, images: [], paths: [...prims.paths.filter((p) => p.lw < 0.5),
    ...wedgeSolids().map((poly) => { const k = 1 / (50 * PT_CM), pts = []; for (const [x, y] of [...poly, poly[0]]) pts.push(60 + x * k, 80 + y * k); return { pts, closed: true, stroke: false, fill: true, evenOdd: false, lw: 0, color: '#000000', fillColor: '#404040', dash: [], curved: false }; })] };
  const rf = analysePrims(fillPrims, { slants: true });
  console.log(`== Wedge as filled polygons, slants option: ${rf.walls.length} rects, slants ${JSON.stringify(rf.slants)}; openings ${rf.openings.length}`);
  check(rf.slants && rf.slants.length === 2 && WEDGE.slants.every((s) => rf.slants.some((q) => q.t === s.t && q.kind === s.kind && distLine(q.x1, q.y1, s) <= 2 && distLine(q.x2, q.y2, s) <= 2)) &&
    rf.openings.some((x) => x.axis === 'a' && x.kind === 'window') && rf.openings.some((x) => x.axis === 'a' && x.kind === 'door'), 'filled angled wall bands → slants (window and door found in them)');

  // a 10 cm wall abutting s01 from the west (y 600–610) and s02's door drawn without its swing: the wall stops at its
  // first corner on s01's face, s01 stays one slant across the junction, the plain gap in s02 is a passage
  {
    const polys = [...wedgeSolids(), [[510, 600], [685, 600], [685, 610], [510, 610]]];
    const rj = analysePrims(pdfPrims({ lines: unionOutline(polys), symLines: [...d.winLines, ...d.doorLines.slice(1)], symArcs: d.arcs.slice(1) }), { slants: true });
    const s1 = WEDGE.slants[0], yAt = 610, xFace = 973.63 - (yAt - 20) * (973.63 - 583.89) / 760;
    const tw = rj.walls.find((x) => x.y === 600 && x.h === 10);
    const pas = rj.openings.find((x) => x.axis === 'a' && x.kind === 'opening');
    console.log(`== T-junction on s01 + plain gap in s02: wall ${JSON.stringify(tw)} (face at y 610: x ${xFace.toFixed(1)}), slants ${rj.slants.length}, passage ${JSON.stringify(pas)}`);
    check(tw && tw.x === 510 && tw.x + tw.w === Math.floor(xFace / 5) * 5 && tw.kind === 'interior' && rj.slants.length === 2 && rj.slants.some((q) => q.t === 20 && distLine(q.x1, q.y1, s1) <= 2 && distLine(q.x2, q.y2, s1) <= 2 && Math.hypot(q.x2 - q.x1, q.y2 - q.y1) > 850) &&
      rj.unsupported.length === 0, 'a wall abutting a slant stops at its first corner on the slant face; the slant stays whole across the junction');
    check(pas && pas.style === 'open' && Math.abs(pas.width - 80) <= 0.5 && pas.assumed.includes('height') && rj.openings.filter((x) => x.axis === 'a').length === 2, 'a plain gap between collinear slants → a passage (opening / open)');
  }

  // a quarter-circle wall (Béziers flattened as in a PDF) → a chain of slants
  const q = quarterOutline();
  const rq = analysePrims(pdfPrims({ lines: q.lines, wallArcs: q.arcs }), { slants: true });
  const dev = Math.max(...(rq.slants || []).map((s) => { let m = 0; for (let i = 0; i <= 20; i++) { const x = s.x1 + (s.x2 - s.x1) * i / 20, y = s.y1 + (s.y2 - s.y1) * i / 20; m = Math.max(m, Math.abs(Math.hypot(x - QUARTER.cx, y - QUARTER.cy) - QUARTER.r)); } return m; }));
  const chords = (rq.slants || []).map((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1));
  const info = rq.warnings.find((x) => x.code === 'curved-wall-pieces');
  console.log(`== quarter circle r 300 (PDF Béziers): ${rq.slants && rq.slants.length} pieces, chords ${Math.min(...chords).toFixed(1)}–${Math.max(...chords).toFixed(1)} cm, max deviation from the true centre circle ${dev.toFixed(2)} cm (stats ${rq.stats.curveMaxDev}); "${info && info.text}"`);
  check(rq.slants && rq.slants.length >= 3 && rq.slants.every((s) => s.chain === 'c1' && s.t === 20 && s.kind === 'exterior') && dev <= 2 && Math.min(...chords) >= 30, 'quarter-circle wall → one chain of slants, max deviation ≤ 2 cm, chords ≥ 30 cm, ≥ 3 pieces per 90°');
  check(info && info.severity === 'info' && rq.stats.curveMaxDev <= 2 && rq.unsupported.length === 0, 'curved wall: info warning with the tolerance, deviation in stats, nothing left unsupported');
  check(rq.walls.length === 4 && rq.walls.reduce((t, x) => t + x.w * x.h, 0) === QUARTER.rects.reduce((t, x) => t + x.w * x.h, 0), 'quarter circle: the four orthogonal walls exact');

  // a wall 0.3° off the axis is an ordinary rectangle; an unpaired angled wall line stays unsupported
  const S = 50, k = 1 / (S * PT_CM), P = (x, y) => [60 + x * k, 80 + y * k];
  // a 600 × 420 box of 20 cm walls; a 10 cm partition from the north to the south wall, drawn 0.3° off the vertical
  // (its faces shift 2 cm over 380 cm)
  const L = (a, b, c, e) => pen([...P(a, b), ...P(c, e)], 0.7);
  const box = [L(0, 0, 600, 0), L(600, 0, 600, 420), L(600, 420, 0, 420), L(0, 420, 0, 0), L(20, 20, 20, 400), L(580, 20, 580, 400)];
  const tilted = { pageBox: { w: 842, h: 595 }, texts: [{ str: 'SCALE 1:50', x: 600, y: 560, w: 60, h: 8, angle: 0 }], images: [],
    paths: [...box, L(20, 20, 301, 20), L(311, 20, 580, 20), L(20, 400, 299, 400), L(309, 400, 580, 400), L(301, 20, 299, 400), L(311, 20, 309, 400)] };
  const rt = analysePrims(tilted, { slants: true });
  console.log(`== 0.3° partition, slants option: rects ${JSON.stringify(rt.walls.map((x) => [x.x, x.y, x.w, x.h]))}, slants ${JSON.stringify(rt.slants || null)}`);
  check(!rt.slants && rt.unsupported.length === 0 && rt.walls.some((x) => x.x === 300 && x.w === 10 && x.h >= 370), 'a wall 0.3° off the axis → an ordinary rectangle, not a slant');
  const lone = { ...tilted, paths: [...box, pen([...P(100, 100), ...P(300, 300)], 0.7)] };
  const rl = analysePrims(lone, { slants: true });
  check(!rl.slants && rl.unsupported.length === 1 && rl.warnings.some((x) => x.code === 'angled-wall'), 'an unpaired angled wall line stays unsupported (angled-wall warning)');

}

function distLine(x, y, s) { const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1); return Math.abs((s.x2 - s.x1) * (s.y1 - y) - (s.x1 - x) * (s.y2 - s.y1)) / L; }
/** Geometry of an opening in a slant (plan cm): centre, hinge jamb point, a point on the swing side and on the outside. */
function opGeom(op, slants) {
  const s = slants.find((q) => q.id === op.wall), L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1), ux = (s.x2 - s.x1) / L, uy = (s.y2 - s.y1) / L, nx = -uy, ny = ux;
  const c = [s.x1 + ux * op.at, s.y1 + uy * op.at];
  const side = (lr, d) => (lr ? [c[0] + (lr === 'r' ? 1 : -1) * nx * d, c[1] + (lr === 'r' ? 1 : -1) * ny * d] : null);
  const hingePt = op.hinge ? [c[0] + (op.hinge === 'a' ? -1 : 1) * ux * op.width / 2, c[1] + (op.hinge === 'a' ? -1 : 1) * uy * op.width / 2] : null;
  return { kind: op.kind, width: op.width, c, hingePt, swingPt: side(op.swing, 40), outPt: side(op.outside, 40) };
}
/** The Wedge expectations (design § 4): slants within 2 cm, thickness exact, kinds; openings in the slants. */
function wedgeChecks(name, res, WEDGE, slantLen) {
  const found = res.slants || [];
  const match = WEDGE.slants.map((s) => found.find((q) => q.t === s.t && distLine(q.x1, q.y1, s) <= 2 && distLine(q.x2, q.y2, s) <= 2));
  check(found.length === 2 && match.every(Boolean), `${name}: both slants found, centre lines within 2 cm, thickness exact`);
  check(match.every((q, i) => q && q.kind === WEDGE.slants[i].kind), `${name}: kinds (s01 exterior, s02 interior)`);
  // each found slant spans the design's free length (its ends on the faces of the walls it meets)
  const span = (q, s) => { const L = slantLen(s), ux = (s.x2 - s.x1) / L, uy = (s.y2 - s.y1) / L, a = (q.x1 - s.x1) * ux + (q.y1 - s.y1) * uy, b = (q.x2 - s.x1) * ux + (q.y2 - s.y1) * uy; return [Math.min(a, b), Math.max(a, b)]; };
  const [a1, b1] = match[0] ? span(match[0], WEDGE.slants[0]) : [NaN, NaN], [a2, b2] = match[1] ? span(match[1], WEDGE.slants[1]) : [NaN, NaN];
  console.log(`   ${name}: s01 found from ${a1.toFixed(1)} to ${b1.toFixed(1)} cm along the design centre line (design 0–${slantLen(WEDGE.slants[0]).toFixed(1)}); s02 from ${a2.toFixed(1)} to ${b2.toFixed(1)} (design 0–${slantLen(WEDGE.slants[1]).toFixed(1)})`);
  check(a1 >= 0 && a1 <= 15 && b1 >= slantLen(WEDGE.slants[0]) - 15 && b1 <= slantLen(WEDGE.slants[0]) && a2 >= -10 && a2 <= 0 && b2 >= slantLen(WEDGE.slants[1]) && b2 <= slantLen(WEDGE.slants[1]) + 10, `${name}: slant ends on the faces of the walls they meet`);
  const sop = res.openings.filter((o) => o.axis === 'a');
  const win = sop.find((o) => match[0] && o.wall === match[0].id), door = sop.find((o) => match[1] && o.wall === match[1].id);
  const geoOf = (o, q) => opGeom(o, [q]);
  // window: centre at half of s01's design length, 120 wide, outside to the east
  const s1 = WEDGE.slants[0], L1 = slantLen(s1), wc = [s1.x1 + (s1.x2 - s1.x1) / 2, s1.y1 + (s1.y2 - s1.y1) / 2];
  const wg = win && geoOf(win, match[0]);
  check(win && win.kind === 'window' && Math.abs(win.width - 120) <= 0.5 && Math.hypot(wg.c[0] - wc[0], wg.c[1] - wc[1]) <= 2 && win.exterior && wg.outPt && wg.outPt[0] > wc[0] && win.sill === 90 && win.assumed.includes('sill'),
    `${name}: window in s01 (at within 2 cm, 120 wide, outside east: ${win && [win.at, win.width, win.outside]})`);
  // door: centre at s02's midpoint, 80 wide, hinge at the design's jamb a (nearer (25, 300)), swinging to the north-west
  const s2 = WEDGE.slants[1], L2 = slantLen(s2), u2 = [(s2.x2 - s2.x1) / L2, (s2.y2 - s2.y1) / L2], dc = [s2.x1 + u2[0] * L2 / 2, s2.y1 + u2[1] * L2 / 2];
  const hinge = [dc[0] - u2[0] * 40, dc[1] - u2[1] * 40], swingPt = [dc[0] - u2[1] * 40, dc[1] + u2[0] * 40];
  const dg = door && geoOf(door, match[1]);
  check(door && door.kind === 'door' && Math.abs(door.width - 80) <= 0.5 && Math.hypot(dg.c[0] - dc[0], dg.c[1] - dc[1]) <= 2 && !door.exterior && door.style === 'interior',
    `${name}: door in s02 (at within 2 cm, 80 wide, interior: ${door && [door.at, door.width, door.style]})`);
  check(door && Math.hypot(dg.hingePt[0] - hinge[0], dg.hingePt[1] - hinge[1]) <= 2 && Math.hypot(dg.swingPt[0] - swingPt[0], dg.swingPt[1] - swingPt[1]) <= 2, `${name}: door hinge / swing (${door && [door.hinge, door.swing]})`);
  // the orthogonal walls: the design's rectangles with the two rect doors cut out (cell union), kinds
  const want = [{ x: 0, y: 0, w: 1000, h: 20 }, { x: 0, y: 20, w: 20, h: 760 }, { x: 0, y: 780, w: 200, h: 20 }, { x: 290, y: 780, w: 310, h: 20 }, { x: 500, y: 20, w: 10, h: 330 }, { x: 500, y: 430, w: 10, h: 350 }];
  const cw = compareWalls(res.walls, want, 0);
  check(cw.symDiffCm2 === 0, `${name}: rectangles = the design's (wall area identical, symmetric difference ${cw.symDiffCm2} cm²)`);
  check(res.walls.every((x) => (x.x >= 500 && x.x + x.w <= 510 ? x.kind === 'interior' : x.kind === 'exterior')), `${name}: rect kinds (partition interior, the rest exterior)`);
  const pd = res.openings.find((o) => o.axis === 'v'), ed = res.openings.find((o) => o.axis === 'h');
  check(pd && pd.kind === 'door' && pd.y === 350 && pd.h === 80 && pd.hinge === 'n' && pd.swing === 'e' && !pd.exterior && ed && ed.kind === 'door' && ed.x === 200 && ed.w === 90 && ed.exterior && ed.outside === 's',
    `${name}: partition door interior, entry door exterior (the slant closes the outline)`);
  check(res.unsupported.length === 0 && !res.warnings.some((x) => /angled-wall|curved-wall$|pair-fill|open-outline/.test(x.code)), `${name}: nothing unsupported, outlines closed (warnings ${res.warnings.map((x) => x.code).join(', ') || 'none'})`);
}

// ---------- 5. raster: House 98 rendered at 150 dpi (best effort, reported, not gated on perfection) ----------
if (existsSync(LOT98)) {
  const prims = await readPdf(readFileSync(LOT98));
  const dpi = 150, z = dpi / 72;
  const W = Math.ceil(prims.pageBox.w * z), H = Math.ceil(prims.pageBox.h * z);
  const gray = rasterise(prims, W, H, z);
  const truth = 2.54 / dpi * 100; // cm per px at 1:100
  // the user picks two wall corners 1535 cm apart (here: taken from the vector outline, as a click would be)
  const ref = analysePrims(prims), Ti = ref.transform;
  const toPage = (X, Y) => { const det = Ti[0] * Ti[3] - Ti[1] * Ti[2]; return [(Ti[3] * (X - Ti[4]) - Ti[2] * (Y - Ti[5])) / det, (-Ti[1] * (X - Ti[4]) + Ti[0] * (Y - Ti[5])) / det]; };
  const p1 = toPage(0, 1380).map((v) => v * z), p2 = toPage(1535, 1380).map((v) => v * z);
  const t1 = Date.now();
  const img = readImage({ width: W, height: H, gray }, { points: [p1, p2], cm: 1535 });
  const ms = Date.now() - t1;
  const res = img.proposal;
  const cw = compareWalls(res.walls, PLAN.walls, 5);
  const cw10 = compareWalls(res.walls, PLAN.walls, 10);
  const co = compareOpenings(res.openings, PLAN.openings, 10);
  console.log(`\n== raster 150 dpi (${W} × ${H} px, ${ms} ms): scale ${img.scale.cmPerPx.toFixed(4)} cm/px (true ${truth.toFixed(4)}), deskew ${img.deskew.angle}°, strokes thin ${img.strokes.thin}px thick ${img.strokes.thick}px`);
  console.log(`walls: found ${cw.found} vs ${cw.plan}; identical ${cw.exact}; within 5 cm ${cw.within}, within 10 cm ${cw10.within}; area ${cw.areaFound} vs ${cw.areaPlan} (${((cw.areaFound / cw.areaPlan - 1) * 100).toFixed(1)} %), symmetric difference ${(cw.symDiffCm2 / 1e4).toFixed(2)} m²; bounds ${res.stats.bounds && res.stats.bounds.w} × ${res.stats.bounds && res.stats.bounds.h}`);
  console.log(`wall area: recall ${(cw.recall * 100).toFixed(1)} % of the plan's wall area found; precision ${(cw.precision * 100).toFixed(1)} % of the found area lies within 5 cm of a plan wall`);
  console.log(`openings (gaps) within 10 cm: ${co.rows.filter((r) => r.found).length}/${PLAN.openings.length} (raster has no swing arcs: doors come out as passages / windows at best); extra ${co.extra.length}`);
  check(res.lowConfidence && res.confidence.walls <= 0.4, 'raster proposal is marked low confidence');
  // not gated on perfection: a regression guard on what the best-effort path achieves today (see the numbers above)
  check(cw.recall >= 0.6 && cw.precision >= 0.8, `raster: wall-area recall ≥ 60 % and precision ≥ 80 % (${(cw.recall * 100).toFixed(0)} / ${(cw.precision * 100).toFixed(0)})`);

  // deskew: the same page rotated by 3°
  const rot = rotateGray(gray, W, H, 3);
  const est = readImage({ width: rot.w, height: rot.h, gray: rot.g }, { cmPerPx: img.scale.cmPerPx });
  const cr = compareWalls(est.proposal.walls, PLAN.walls);
  console.log(`page turned 3° clockwise: deskew estimate ${est.deskew.angle}° (confidence ${est.deskew.confidence}); walls after deskew: recall ${(cr.recall * 100).toFixed(1)} %, precision ${(cr.precision * 100).toFixed(1)} %`);
  check(Math.abs(est.deskew.angle - 3) <= 0.15, 'deskew estimate within 0.15°');
}

function rasterise(prims, W, H, z) {
  const g = new Uint8Array(W * H).fill(255);
  const ink = (c) => { const r = parseInt(c.slice(1, 3), 16), gg = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16); const sat = Math.max(r, gg, b) - Math.min(r, gg, b); return sat > 80 ? 255 : Math.round(0.299 * r + 0.587 * gg + 0.114 * b); };
  for (const p of prims.paths) {
    if (!p.stroke) continue;
    const v = ink(p.color), r = Math.max(0.5, p.lw * z / 2);
    if (v > 200) continue;
    for (let i = 2; i < p.pts.length; i += 2) {
      const x1 = p.pts[i - 2] * z, y1 = p.pts[i - 1] * z, x2 = p.pts[i] * z, y2 = p.pts[i + 1] * z;
      const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2) + 1;
      for (let s = 0; s <= n; s++) {
        const x = x1 + (x2 - x1) * s / n, y = y1 + (y2 - y1) * s / n;
        for (let yy = Math.floor(y - r + 0.5); yy <= Math.floor(y + r - 0.5); yy++) for (let xx = Math.floor(x - r + 0.5); xx <= Math.floor(x + r - 0.5); xx++) {
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && g[yy * W + xx] > v) g[yy * W + xx] = v;
        }
      }
    }
  }
  return g;
}
function rotateGray(g, w, h, deg) {
  const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
  const W = Math.ceil(Math.abs(w * c) + Math.abs(h * s)), H = Math.ceil(Math.abs(w * s) + Math.abs(h * c));
  const out = new Uint8Array(W * H).fill(255);
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const dx = X - W / 2, dy = Y - H / 2, x = Math.round(c * dx + s * dy + w / 2), y = Math.round(-s * dx + c * dy + h / 2);
    if (x >= 0 && y >= 0 && x < w && y < h) out[Y * W + X] = g[y * w + x];
  }
  return { g: out, w: W, h: H };
}

console.log(`\n${ok ? 'IMPORT OK' : 'IMPORT HAS FAILURES'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(ok ? 0 : 1);
