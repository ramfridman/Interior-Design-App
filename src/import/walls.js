/**
 * detectWalls — orthogonal wall rectangles (cm) from vector primitives.
 *
 * Method (generic, nothing drawing-specific):
 *   1. pens (width + colour + dash) are scored as wall outlines: thick, orthogonal in both directions, and paired
 *      with a parallel line of the same pen at a plausible wall thickness (default 7–40 cm at the given scale);
 *      filled rectilinear narrow polygons (poché walls) are scored the same way;
 *   2. the drawing is deskewed to the walls' own orientation and converted to cm;
 *   3. outline segments are merged (collinear overlaps), coordinates compressed into a grid, and every grid cell is
 *      classified by even–odd parity both along its row and along its column ("parity flood fill"); a cell is wall
 *      when both agree (one stray or unclosed line cannot flood a room);
 *   4. solid cells are decomposed into rectangles: a cell crossed straight through by a wall run belongs to that run
 *      (so a through wall keeps its T-junctions), corners go to the horizontal run; then edges are snapped to the grid
 *      (default 5 cm) relative to the house's north-west corner;
 *   5. pieces thicker than the thickness window are reported and left out (furniture, columns, leaks);
 *      wall-pen lines that are not orthogonal, or curved, are reported as unsupported pieces — never bent;
 *   6. exterior / interior: the outside is flood-filled from the border with every opening gap closed; a wall that
 *      faces the outside along at least half of one side is exterior.
 */
import { segmentsOf, penStats, dominantAngle, DEG, wMedian, penKey, affApply } from './prep.js';
import { findGaps, outsideMask, classifyKinds } from './gaps.js';
import { symbolContext, classifyGaps } from './openings.js';
import { findBands, fillBand, closeAtBands, buildUnits, extendEnds, unitSegments, piecesBox, finishUnits } from './slants.js';

const DEFAULTS = { snap: 5, minThickness: 7, maxThickness: 40, maxOpening: 400, minOpening: 25, mergeTol: 0.6, maxPassage: 120 };

/** Score pens as wall outlines at a given scale. Returns pens sorted by score with { score, thickness }. */
export function scoreWallPens(prims, cmPerUnit, opts = {}, pre = null) {
  const o = { ...DEFAULTS, ...opts };
  const stats = (pre || penStats(segmentsOf(prims))).map((s) => ({ ...s }));
  const maxLw = Math.max(1e-9, ...stats.map((s) => s.lw));
  for (const s of stats) {
    let inWin = 0, tot = 0;
    const th = [];
    for (const p of s.pairs) {
      const d = p.d * cmPerUnit;
      tot += p.len;
      if (d >= o.minThickness * 0.9 && d <= o.maxThickness * 1.1) { inWin += p.len; th.push({ v: d, w: p.len }); }
    }
    s.pairFrac = s.axisLen ? inWin / s.axisLen : 0;
    s.thickness = th.length ? wMedian(th) : null;
    const lenCm = s.axisLen * cmPerUnit;
    const lwRel = maxLw > 0 ? (s.lw || maxLw * 0.25) / maxLw : 1;
    s.score = s.pairFrac * s.axisFrac * Math.min(1, s.balance / 0.15) * lwRel * lwRel * Math.min(1, lenCm / 2000) * (s.dashed ? 0.2 : 1);
  }
  return stats.sort((a, b) => b.score - a.score);
}

/** Pick the wall pens: the best one plus any pen of similar weight and orientation that scores at least 40 % of it. */
export function pickWallPens(scored) {
  const best = scored[0];
  if (!best || best.score <= 0.02) return [];
  return scored.filter((s) => s === best || (s.score >= 0.4 * best.score && s.lw >= 0.7 * best.lw &&
    Math.abs(s.angle - best.angle) < 0.5));
}

/** Filled closed polygons that look like solid (poché) walls: rectilinear at `angle`, narrow side within the window. */
function wallFills(prims, toFrame, o) {
  const byColor = new Map();
  for (const p of prims.paths) {
    if (!p.fill || !p.closed || p.pts.length < 8) continue;
    const pts = [];
    for (let i = 0; i < p.pts.length; i += 2) pts.push(affApply(toFrame, p.pts[i], p.pts[i + 1]));
    let rect = true;
    for (let i = 1; i < pts.length; i++) {
      const dx = Math.abs(pts[i][0] - pts[i - 1][0]), dy = Math.abs(pts[i][1] - pts[i - 1][1]);
      if (Math.min(dx, dy) > 0.02 * Math.max(dx, dy) + 0.3) { rect = false; break; }
    }
    if (!rect) {
      // slants option: a thin filled parallelogram is an angled wall band
      const b = o.slants ? fillBand(pts, o) : null;
      if (b) {
        let g = byColor.get(p.fillColor);
        if (!g) byColor.set(p.fillColor, g = { n: 0, ok: 0, polys: [], area: 0 });
        g.n++; g.ok++; (g.bands || (g.bands = [])).push(b);
      }
      continue;
    }
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const t = Math.min(w, h);
    let g = byColor.get(p.fillColor);
    if (!g) byColor.set(p.fillColor, g = { n: 0, ok: 0, polys: [], area: 0 });
    g.n++;
    if (t >= o.minThickness * 0.9 && t <= o.maxThickness * 1.1 && Math.max(w, h) >= 2 * t) { g.ok++; g.polys.push({ pts, evenOdd: p.evenOdd }); g.area += w * h; }
  }
  const out = [];
  for (const [color, g] of byColor) if (g.ok >= 4 && g.ok >= 0.6 * g.n) out.push(g.bands ? { color, polys: g.polys, bands: g.bands } : { color, polys: g.polys });
  return out;
}

/**
 * @param prims  readPdf() output (or readImage().segmentsPrims)
 * @param scale  { cmPerUnit } (from detectScale or the user)
 * @param options { snap, minThickness, maxThickness, pens: [penKey…] (override), angle (deg, override), maxOpening }
 */
export function detectWalls(prims, scale, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const k = scale.cmPerUnit;
  const warnings = [];
  const segs = segmentsOf(prims);
  const scored = scoreWallPens(prims, k, o);
  const pens = o.pens ? scored.filter((s) => o.pens.includes(s.pen)) : pickWallPens(scored);
  const penSet = new Set(pens.map((p) => p.pen));
  const wallSegs = segs.filter((s) => penSet.has(s.pen));
  const angle = o.angle ?? (pens.length ? dominantAngle(wallSegs) : 0);
  const c = Math.cos(-angle * DEG), sn = Math.sin(-angle * DEG);
  const toFrame = [k * c, k * sn, -k * sn, k * c, 0, 0]; // page units -> cm, rotated so walls are axis-aligned
  const fills = wallFills(prims, toFrame, o);

  if (!pens.length && !fills.length) {
    warnings.push({ code: 'no-walls', text: 'No line weight or filled shape in the drawing looks like walls at this scale.', where: null });
    return { walls: [], frame: { matrix: toFrame, angle, cmPerUnit: k }, pens: [], fills: [], unsupported: [], warnings, stats: { pensConsidered: scored.length }, confidence: 0 };
  }

  // ---- 3. wall-pen segments in the frame; non-orthogonal / curved pieces are reported ----
  const H = [], V = [], unsupported = [];
  const clip = o.clip;
  const inClip = (x, y) => !clip || (x >= clip.x && x <= clip.x + clip.w && y >= clip.y && y <= clip.y + clip.h);
  if (clip) for (const f of fills) f.polys = f.polys.filter((p) => p.pts.every((q) => inClip(q[0], q[1])));
  // slants option: angled / curved pieces are collected for slant detection instead of being reported right away
  const odd = o.slants ? [] : null;
  for (const s of wallSegs) {
    const [ax, ay] = affApply(toFrame, s.x1, s.y1), [bx, by] = affApply(toFrame, s.x2, s.y2);
    if (!inClip(ax, ay) || !inClip(bx, by)) continue;
    const dx = Math.abs(bx - ax), dy = Math.abs(by - ay), len = Math.hypot(dx, dy);
    if (len < 0.2) continue;
    if (!s.curved && dy <= Math.max(0.3, len * Math.tan(1 * DEG))) H.push({ k: (ay + by) / 2, a: Math.min(ax, bx), b: Math.max(ax, bx) });
    else if (!s.curved && dx <= Math.max(0.3, len * Math.tan(1 * DEG))) V.push({ k: (ax + bx) / 2, a: Math.min(ay, by), b: Math.max(ay, by) });
    else if (odd) odd.push({ x1: ax, y1: ay, x2: bx, y2: by, len, path: s.path, curved: !!s.curved });
    else unsupported.push({ type: s.curved ? 'curved' : 'angled', path: s.path, x1: ax, y1: ay, x2: bx, y2: by, len });
  }
  let SL = null;
  if (odd) {
    const fb = [];
    for (const f of fills) if (f.bands) { if (clip) f.bands = f.bands.filter((b) => [b.s0, b.s1].every((s) => inClip(b.ux * s + b.nx * b.kc, b.uy * s + b.ny * b.kc))); fb.push(...f.bands); }
    SL = findBands(odd, fb, o);
    H.push(...SL.ortho.H); V.push(...SL.ortho.V);
    unsupported.push(...SL.unsupported);
  }
  const pieces = groupUnsupported(unsupported);
  for (const p of pieces) {
    warnings.push({ code: p.type === 'curved' ? 'curved-wall' : 'angled-wall',
      text: `${p.type === 'curved' ? 'Curved' : 'Angled'} wall line(s) of ${Math.round(p.len)} cm not converted (only orthogonal walls are supported); trace it by hand.`,
      where: { x: p.x, y: p.y, w: p.w, h: p.h, frame: 'drawing-cm' } });
  }

  // ---- merge collinear overlapping lines (duplicates would cancel each other's parity) ----
  let mH = mergeCollinear(H, o.mergeTol), mV = mergeCollinear(V, o.mergeTol);
  if (SL && SL.bands.length) {
    // orthogonal outlines that end on an angled / curved band are closed without it (see slants.js)
    const c = closeAtBands(mH, mV, SL.bands, o);
    mH = mergeCollinear(c.H, o.mergeTol); mV = mergeCollinear(c.V, o.mergeTol);
  }

  // ---- compressed grid ----
  const xsRaw = [], ysRaw = [];
  for (const s of mV) { xsRaw.push(s.k); ysRaw.push(s.a, s.b); }
  for (const s of mH) { ysRaw.push(s.k); xsRaw.push(s.a, s.b); }
  for (const f of fills) for (const p of f.polys) for (const q of p.pts) { xsRaw.push(q[0]); ysRaw.push(q[1]); }
  const xs = clusterCoords(xsRaw, o.mergeTol), ys = clusterCoords(ysRaw, o.mergeTol);
  const nx = xs.length - 1, ny = ys.length - 1;
  if (nx < 1 || ny < 1) return { walls: [], frame: { matrix: toFrame, angle, cmPerUnit: k }, pens, fills, unsupported: pieces, warnings, stats: {}, confidence: 0 };
  const ix = (v) => nearestIdx(xs, v), iy = (v) => nearestIdx(ys, v);
  // RT[j*(nx+1)+i]: vertical line at xs[i] crossing row j; CT[i*(ny+1)+j]: horizontal line at ys[j] crossing column i
  const RT = new Uint8Array((nx + 1) * ny), CT = new Uint8Array((ny + 1) * nx);
  for (const s of mV) { const i = ix(s.k), j0 = iy(s.a), j1 = iy(s.b); for (let j = j0; j < j1; j++) RT[j * (nx + 1) + i] ^= 1; }
  for (const s of mH) { const j = iy(s.k), i0 = ix(s.a), i1 = ix(s.b); for (let i = i0; i < i1; i++) CT[i * (ny + 1) + j] ^= 1; }
  const solid = new Uint8Array(nx * ny);
  let disagree = 0;
  const hp = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) { let p = 0; for (let i = 0; i < nx; i++) { p ^= RT[j * (nx + 1) + i]; hp[j * nx + i] = p; } }
  for (let i = 0; i < nx; i++) {
    let p = 0;
    for (let j = 0; j < ny; j++) {
      p ^= CT[i * (ny + 1) + j];
      const h = hp[j * nx + i];
      if (h && p) solid[j * nx + i] = 1; else if (h !== p) disagree += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
    }
  }
  // parallel line pairs: the band between two wall lines at a wall thickness (used when the outlines are not
  // closed — raster tracings, sloppy CAD — where parity cannot be trusted)
  let solidArea = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (solid[j * nx + i]) solidArea += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
  const fillMode = o.fill === 'pairs' || o.fill === 'parity' ? o.fill : (disagree > 0.25 * solidArea ? 'pairs' : 'parity');
  if (fillMode === 'pairs') {
    solid.fill(0);
    for (const r of pairRects(mH, mV, o.minThickness, o.maxThickness, o.mergeTol)) {
      const i0 = ix(r.x0), i1 = ix(r.x1), j0 = iy(r.y0), j1 = iy(r.y1);
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) solid[j * nx + i] = 1;
    }
    warnings.push({ code: 'pair-fill', text: 'Wall outlines are not closed; walls were filled between parallel wall lines instead (check corners and junctions).', where: null });
  }
  // filled wall polygons
  for (const f of fills) for (const poly of f.polys) {
    const px = poly.pts.map((q) => q[0]), py = poly.pts.map((q) => q[1]);
    const i0 = ix(Math.min(...px)), i1 = ix(Math.max(...px)), j0 = iy(Math.min(...py)), j1 = iy(Math.max(...py));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      if (inPoly(poly.pts, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)) solid[j * nx + i] = 1;
    }
  }

  // ---- 4. snap to a uniform grid (cell centres sampled from the parity grid), then decompose ----
  let ox = Infinity, oy = Infinity, ex = -Infinity, ey = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (solid[j * nx + i]) {
    ox = Math.min(ox, xs[i]); oy = Math.min(oy, ys[j]); ex = Math.max(ex, xs[i + 1]); ey = Math.max(ey, ys[j + 1]);
  }
  const step = o.snap;
  const gx = Math.max(0, Math.round((ex - ox) / step)), gy = Math.max(0, Math.round((ey - oy) / step));
  const U = new Uint8Array(gx * gy);
  {
    const colOf = new Int32Array(gx), rowOf = new Int32Array(gy);
    for (let i = 0; i < gx; i++) colOf[i] = cellIdx(xs, ox + (i + 0.5) * step);
    for (let j = 0; j < gy; j++) rowOf[j] = cellIdx(ys, oy + (j + 0.5) * step);
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
      const a = colOf[i], b = rowOf[j];
      if (a >= 0 && b >= 0 && a < nx && b < ny && solid[b * nx + a]) U[j * gx + i] = 1;
    }
  }
  const rects = decompose(U, gx, gy).map((r) => ({
    x0: ox + r.i0 * step, x1: ox + r.i1 * step, y0: oy + r.j0 * step, y1: oy + r.j1 * step, o: r.o,
  }));
  const snapped = rects;

  // ---- 5. thickness filter ----
  const walls = [], rejected = [];
  for (const r of snapped) {
    const w = r.x1 - r.x0, h = r.y1 - r.y0, t = Math.min(w, h);
    if (t > o.maxThickness * 1.25 + 1e-9) {
      rejected.push(r);
      warnings.push({ code: 'not-a-wall', text: `A solid ${Math.round(w)} × ${Math.round(h)} cm region drawn with the wall line is thicker than a wall (${o.maxThickness} cm max) and was left out (column, furniture, or an unclosed outline).`, where: { x: r.x0, y: r.y0, w, h, frame: 'drawing-cm' } });
      continue;
    }
    walls.push({ x: r.x0, y: r.y0, w, h, o: r.o });
  }
  if (disagree > 0 && fillMode === 'parity') {
    const area = walls.reduce((t, w) => t + w.w * w.h, 0);
    if (disagree > 0.02 * area) warnings.push({ code: 'open-outline', text: `Some wall outlines are not closed (${Math.round(disagree / 1e4 * 10) / 10} m² ambiguous); those parts were left out.`, where: null });
  }

  // ---- several drawings on one sheet (plan + site plan, two variants…): group walls, keep one ----
  const drawings = groupDrawings(walls, o.maxOpening);
  let chosen = 0;
  const strays = drawings.length === 1 && drawings[0].walls.length < walls.length;
  if ((drawings.length > 1 || strays) && !o.clip) {
    // re-run on the chosen drawing alone, so its grid snapping starts at its own corner
    chosen = Math.min(drawings.length - 1, Math.max(0, o.drawing ?? 0));
    const b = drawings[chosen].bbox, m = 60;
    const res = detectWalls(prims, scale, { ...options, angle, clip: { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m } });
    if (strays) res.warnings.unshift({ code: 'stray-walls', text: `${walls.length - drawings[0].walls.length} isolated wall-like piece(s) away from the building were left out.`, where: null });
    else res.warnings.unshift({ code: 'several-drawings', text: `The sheet holds ${drawings.length} separate wall drawings; drawing ${chosen + 1} (${drawings[chosen].walls.length} walls, the ${chosen ? 'number ' + (chosen + 1) + ' by' : 'largest by'} wall area) was used. Choose another with the "drawing" option.`, where: { ...b, frame: 'drawing-cm' } });
    res.drawings = drawings.map((d, i) => ({ index: i, bbox: d.bbox, walls: d.walls.length, area: Math.round(d.area) }));
    res.drawing = chosen;
    return res;
  }

  // ---- 6. exterior / interior ----
  // only gaps that hold a door / window symbol, or short collinear passages, close the envelope: a wide empty gap
  // (an open porch side) must let the outside in
  const gaps = findGaps(walls, o);
  const frame0 = { matrix: toFrame, angle, cmPerUnit: k };
  const ctx = symbolContext(prims, frame0, pens.map((p) => p.pen), SL ? { angled: true } : undefined);
  const closing = classifyGaps(gaps, ctx, o);
  let slantRes = null;
  if (SL) {
    // slants: collinear pieces joined over their openings, curves as chains, ends extended, kinds from the same flood
    let units = buildUnits(SL.bands, ctx, SL.lines, o);
    if (drawings.length) units = units.filter((u) => { const b = piecesBox(unitSegments([u])); return inBox({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }, drawings[chosen].bbox, o.maxOpening); });
    extendEnds(units, walls);
    const outside = outsideMask(walls, closing, o, unitSegments(units));
    classifyKinds(walls, outside);
    slantRes = finishUnits(units, outside, o);
    for (const ch of slantRes.chains) {
      const dev = Math.round(ch.maxDev * 10) / 10;
      warnings.push({ code: 'curved-wall-pieces', severity: 'info', text: `Curved wall drawn as ${ch.pieces} straight pieces, within ${Math.max(2, dev)} cm (largest deviation ${dev} cm).`,
        where: { x: ch.box.x0, y: ch.box.y0, w: ch.box.x1 - ch.box.x0, h: ch.box.y1 - ch.box.y0, frame: 'drawing-cm' } });
    }
  } else {
    const outside = outsideMask(walls, closing, o);
    classifyKinds(walls, outside);
  }
  walls.sort((a, b) => a.y - b.y || a.x - b.x);
  walls.forEach((w, i) => { w.id = 'w' + String(i + 1).padStart(2, '0'); });

  const conf = pens.length ? Math.min(1, pens[0].pairFrac + 0.1) * (disagree > 0 ? 0.9 : 1) * (pieces.length ? 0.9 : 1) : 0.6;
  const res = {
    walls, gaps, frame: { matrix: toFrame, angle, cmPerUnit: k, origin: [ox, oy], snap: o.snap },
    pens: pens.map((p) => ({ pen: p.pen, lw: p.lw, color: p.color, score: +p.score.toFixed(3), thickness: p.thickness, pairFrac: +p.pairFrac.toFixed(3) })),
    fills: fills.map((f) => ({ color: f.color, n: f.polys.length })),
    unsupported: pieces.filter((u) => !drawings.length || inBox(u, drawings[chosen].bbox, o.maxOpening)), rejected, warnings,
    drawings: drawings.map((d, i) => ({ index: i, bbox: d.bbox, walls: d.walls.length, area: Math.round(d.area) })), drawing: chosen, clip: clip || null,
    stats: { wallSegments: wallSegs.length, merged: mH.length + mV.length, grid: [nx, ny], rects: walls.length, ambiguousArea: Math.round(disagree), deskew: angle },
    confidence: +conf.toFixed(2),
    options: o,
  };
  if (slantRes) {
    // frame cm (not snapped); ids s01… (chains c1…) by their north-west-most point; openings refer to them by id
    res.slants = slantRes.slants;
    res.slantOpenings = slantRes.openings;
    res.chains = slantRes.chains;
    if (slantRes.slants.length) {
      res.stats.slants = slantRes.slants.length;
      res.stats.chains = slantRes.chains.length;
      res.stats.slantOpenings = slantRes.openings.length;
      if (slantRes.chains.length) res.stats.curveMaxDev = Math.round(Math.max(...slantRes.chains.map((c) => c.maxDev)) * 100) / 100;
    }
  }
  return res;
}

/**
 * Bands between parallel wall lines at a plausible thickness, plus the squares that complete corners and the
 * junction gaps of a through wall. Rectangles { x0, x1, y0, y1 } in the drawing frame (cm).
 */
export function pairRects(H, V, minT, maxT, tol = 0.6) {
  const bands = (list, horiz) => {
    const out = [];
    const L = list.slice().sort((a, b) => a.k - b.k);
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const s = L[i], t = L[j], d = t.k - s.k;
      if (d < minT * 0.9) continue;
      if (d > maxT * 1.1) break;
      const a = Math.max(s.a, t.a), b = Math.min(s.b, t.b);
      if (b - a <= tol) continue;
      let between = false;
      for (let m = i + 1; m < j && !between; m++) { const u = L[m]; if (u.k - s.k > tol && t.k - u.k > tol && Math.min(u.b, b) - Math.max(u.a, a) > 0.5 * (b - a)) between = true; }
      if (between) continue;
      out.push(horiz ? { x0: a, x1: b, y0: s.k, y1: t.k, o: 'h' } : { x0: s.k, x1: t.k, y0: a, y1: b, o: 'v' });
    }
    return out;
  };
  const hb = bands(H, true), vb = bands(V, false);
  const extra = [];
  const near = (p, q) => Math.abs(p - q) <= tol;
  for (const h of hb) for (const v of vb) {
    const xt = near(h.x0, v.x1) || near(h.x1, v.x0), yt = near(v.y0, h.y1) || near(v.y1, h.y0);
    if (xt && yt) extra.push({ x0: v.x0, x1: v.x1, y0: h.y0, y1: h.y1 });
  }
  const gaps = (list, perp, horiz) => {
    for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
      const p = list[i], q = list[j];
      if (horiz) {
        if (!near(p.y0, q.y0) || !near(p.y1, q.y1)) continue;
        const g = q.x0 - p.x1;
        if (g <= tol || g > maxT * 1.1) continue;
        if (perp.some((v) => v.x0 < q.x0 + tol && v.x1 > p.x1 - tol && (near(v.y1, p.y0) || near(v.y0, p.y1) || (v.y0 < p.y1 && v.y1 > p.y0)))) extra.push({ x0: p.x1, x1: q.x0, y0: p.y0, y1: p.y1 });
      } else {
        if (!near(p.x0, q.x0) || !near(p.x1, q.x1)) continue;
        const g = q.y0 - p.y1;
        if (g <= tol || g > maxT * 1.1) continue;
        if (perp.some((h) => h.y0 < q.y0 + tol && h.y1 > p.y1 - tol && (near(h.x1, p.x0) || near(h.x0, p.x1) || (h.x0 < p.x1 && h.x1 > p.x0)))) extra.push({ x0: p.x0, x1: p.x1, y0: p.y1, y1: q.y0 });
      }
    }
  };
  gaps(hb, vb, true); gaps(vb, hb, false);
  return [...hb, ...vb, ...extra];
}

const inBox = (r, b, m) => r.x + r.w >= b.x - m && r.x <= b.x + b.w + m && r.y + r.h >= b.y - m && r.y <= b.y + b.h + m;

/** Walls closer than `link` cm to each other belong to one drawing; groups sorted by wall area (largest first). */
function groupDrawings(walls, link) {
  const parent = walls.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const order = walls.map((w, i) => i).sort((a, b) => walls[a].x - walls[b].x);
  for (let a = 0; a < order.length; a++) {
    const p = walls[order[a]];
    for (let b = a + 1; b < order.length; b++) {
      const q = walls[order[b]];
      if (q.x > p.x + p.w + link) break;
      const dy = Math.max(0, q.y - (p.y + p.h), p.y - (q.y + q.h));
      if (dy <= link) parent[find(order[a])] = find(order[b]);
    }
  }
  const groups = new Map();
  walls.forEach((w, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(w); });
  return [...groups.values()].map((ws) => {
    const x0 = Math.min(...ws.map((w) => w.x)), y0 = Math.min(...ws.map((w) => w.y));
    const x1 = Math.max(...ws.map((w) => w.x + w.w)), y1 = Math.max(...ws.map((w) => w.y + w.h));
    return { walls: ws, area: ws.reduce((t, w) => t + w.w * w.h, 0), bbox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
  }).filter((g) => g.walls.length >= 3 || g.area >= 2e4).sort((a, b) => b.area - a.area);
}

function groupUnsupported(list) {
  const byPath = new Map();
  for (const u of list) {
    const key = u.type + ':' + u.path;
    let g = byPath.get(key);
    if (!g) byPath.set(key, g = { type: u.type, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, len: 0, segs: [] });
    g.x0 = Math.min(g.x0, u.x1, u.x2); g.y0 = Math.min(g.y0, u.y1, u.y2); g.x1 = Math.max(g.x1, u.x1, u.x2); g.y1 = Math.max(g.y1, u.y1, u.y2);
    g.len += u.len; g.segs.push([u.x1, u.y1, u.x2, u.y2]);
  }
  // join groups whose boxes touch (one angled wall = two parallel lines + caps)
  const gs = [...byPath.values()];
  const out = [];
  for (const g of gs) {
    const m = out.find((h) => h.type === g.type && g.x0 <= h.x1 + 1 && g.x1 >= h.x0 - 1 && g.y0 <= h.y1 + 1 && g.y1 >= h.y0 - 1);
    if (m) { m.x0 = Math.min(m.x0, g.x0); m.y0 = Math.min(m.y0, g.y0); m.x1 = Math.max(m.x1, g.x1); m.y1 = Math.max(m.y1, g.y1); m.len += g.len; m.segs.push(...g.segs); }
    else out.push({ ...g });
  }
  return out.map((g) => ({ type: g.type, x: g.x0, y: g.y0, w: g.x1 - g.x0, h: g.y1 - g.y0, len: g.len, segs: g.segs }));
}

function mergeCollinear(list, tol) {
  list.sort((a, b) => a.k - b.k || a.a - b.a);
  const groups = [];
  for (const s of list) {
    const g = groups.length && Math.abs(groups[groups.length - 1].k - s.k) <= tol ? groups[groups.length - 1] : null;
    if (g) { g.items.push(s); g.sk += s.k * (s.b - s.a + 1e-6); g.sw += s.b - s.a + 1e-6; g.k = g.sk / g.sw; }
    else groups.push({ k: s.k, sk: s.k * (s.b - s.a + 1e-6), sw: s.b - s.a + 1e-6, items: [s] });
  }
  const out = [];
  for (const g of groups) {
    const it = g.items.sort((a, b) => a.a - b.a);
    let cur = null;
    for (const s of it) {
      if (cur && s.a <= cur.b + tol) cur.b = Math.max(cur.b, s.b);
      else { cur = { k: g.k, a: s.a, b: s.b }; out.push(cur); }
    }
  }
  return out;
}

function clusterCoords(vals, tol) {
  const s = vals.slice().sort((a, b) => a - b);
  const out = [];
  let sum = 0, n = 0, last = -Infinity;
  for (const v of s) {
    if (n && v - last > tol) { out.push(sum / n); sum = 0; n = 0; }
    sum += v; n++; last = v;
  }
  if (n) out.push(sum / n);
  return out;
}

/** Index of the interval [arr[i], arr[i+1]) containing v, or -1. */
function cellIdx(arr, v) {
  if (v < arr[0] || v >= arr[arr.length - 1]) return -1;
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m; else hi = m; }
  return lo;
}

/**
 * Rectangle decomposition of a solid cell mask (uniform grid), scanline-greedy: take the top-most, then left-most
 * uncovered solid cell, extend right as far as the row stays solid and uncovered, then extend down while that whole
 * span stays solid and uncovered. This is the convention of a hand extraction read top-to-bottom: a wall reached
 * first keeps the junction (a vertical wall that starts at a corner takes the corner; a through wall keeps its
 * T-junctions when its top is above the branch). Deterministic; area is preserved exactly.
 */
export function decompose(U, gx, gy) {
  const used = new Uint8Array(gx * gy);
  const ok = (i, j) => i < gx && j < gy && U[j * gx + i] === 1 && !used[j * gx + i];
  const rects = [];
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    if (!ok(i, j)) continue;
    let e = i; while (ok(e, j)) e++;
    let jj = j + 1;
    const rowOk = (r) => { for (let t = i; t < e; t++) if (!ok(t, r)) return false; return true; };
    while (jj < gy && rowOk(jj)) jj++;
    for (let r = j; r < jj; r++) for (let t = i; t < e; t++) used[r * gx + t] = 1;
    rects.push({ i0: i, i1: e, j0: j, j1: jj, o: e - i >= jj - j ? 'h' : 'v' });
  }
  return rects;
}

function nearestIdx(arr, v) {
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m; else hi = m; }
  return Math.abs(arr[lo] - v) <= Math.abs(arr[hi] - v) ? lo : hi;
}

function inPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}


export { penKey };
