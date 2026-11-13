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

const DEFAULTS = { snap: 5, minThickness: 7, maxThickness: 40, maxOpening: 400, minOpening: 25, mergeTol: 0.6 };

/** Score pens as wall outlines at a given scale. Returns pens sorted by score with { score, thickness }. */
export function scoreWallPens(prims, cmPerUnit, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const stats = penStats(segmentsOf(prims));
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
    if (!rect) continue;
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const t = Math.min(w, h);
    let g = byColor.get(p.fillColor);
    if (!g) byColor.set(p.fillColor, g = { n: 0, ok: 0, polys: [], area: 0 });
    g.n++;
    if (t >= o.minThickness * 0.9 && t <= o.maxThickness * 1.1 && Math.max(w, h) >= 2 * t) { g.ok++; g.polys.push({ pts, evenOdd: p.evenOdd }); g.area += w * h; }
  }
  const out = [];
  for (const [color, g] of byColor) if (g.ok >= 4 && g.ok >= 0.6 * g.n) out.push({ color, polys: g.polys });
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
  for (const s of wallSegs) {
    const [ax, ay] = affApply(toFrame, s.x1, s.y1), [bx, by] = affApply(toFrame, s.x2, s.y2);
    const dx = Math.abs(bx - ax), dy = Math.abs(by - ay), len = Math.hypot(dx, dy);
    if (len < 0.2) continue;
    if (!s.curved && dy <= Math.max(0.3, len * Math.tan(1 * DEG))) H.push({ k: (ay + by) / 2, a: Math.min(ax, bx), b: Math.max(ax, bx) });
    else if (!s.curved && dx <= Math.max(0.3, len * Math.tan(1 * DEG))) V.push({ k: (ax + bx) / 2, a: Math.min(ay, by), b: Math.max(ay, by) });
    else unsupported.push({ type: s.curved ? 'curved' : 'angled', path: s.path, x1: ax, y1: ay, x2: bx, y2: by, len });
  }
  const pieces = groupUnsupported(unsupported);
  for (const p of pieces) {
    warnings.push({ code: p.type === 'curved' ? 'curved-wall' : 'angled-wall',
      text: `${p.type === 'curved' ? 'Curved' : 'Angled'} wall line(s) of ${Math.round(p.len)} cm not converted (only orthogonal walls are supported); trace it by hand.`,
      where: { x: p.x, y: p.y, w: p.w, h: p.h, frame: 'drawing-cm' } });
  }

  // ---- merge collinear overlapping lines (duplicates would cancel each other's parity) ----
  const mH = mergeCollinear(H, o.mergeTol), mV = mergeCollinear(V, o.mergeTol);

  // ---- compressed grid ----
  const xsRaw = [], ysRaw = [];
  for (const s of mV) { xsRaw.push(s.k); ysRaw.push(s.a, s.b); }
  for (const s of mH) { ysRaw.push(s.k); xsRaw.push(s.a, s.b); }
  for (const f of fills) for (const p of f.polys) for (const q of p.pts) { xsRaw.push(q[0]); ysRaw.push(q[1]); }
  const xs = clusterCoords(xsRaw, o.mergeTol), ys = clusterCoords(ysRaw, o.mergeTol);
  const nx = xs.length - 1, ny = ys.length - 1;
  if (nx < 1 || ny < 1) return { walls: [], frame: { matrix: toFrame, angle, cmPerUnit: k }, pens, fills, unsupported: pieces, warnings, stats: {}, confidence: 0 };
  const ix = (v) => nearestIdx(xs, v), iy = (v) => nearestIdx(ys, v);
  // toggles
  const rowT = new Uint8Array(nx * ny + ny), colT = new Uint8Array(nx * ny + nx);
  // rowT[j*(nx+1)+i]: vertical line at xs[i] crossing row j
  const RT = new Uint8Array((nx + 1) * ny), CT = new Uint8Array((ny + 1) * nx);
  void rowT; void colT;
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
  // filled wall polygons
  for (const f of fills) for (const poly of f.polys) {
    const px = poly.pts.map((q) => q[0]), py = poly.pts.map((q) => q[1]);
    const i0 = ix(Math.min(...px)), i1 = ix(Math.max(...px)), j0 = iy(Math.min(...py)), j1 = iy(Math.max(...py));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      if (inPoly(poly.pts, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)) solid[j * nx + i] = 1;
    }
  }

  // ---- 4. decomposition ----
  const S = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && solid[j * nx + i] === 1;
  // run lengths for tie-breaks
  const label = new Int8Array(nx * ny); // 1 = H, 2 = V
  const runH = new Float64Array(nx * ny), runV = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx;) {
    if (!S(i, j)) { i++; continue; }
    let e = i; while (S(e, j)) e++;
    for (let t = i; t < e; t++) runH[j * nx + t] = xs[e] - xs[i];
    i = e;
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny;) {
    if (!S(i, j)) { j++; continue; }
    let e = j; while (S(i, e)) e++;
    for (let t = j; t < e; t++) runV[t * nx + i] = ys[e] - ys[j];
    j = e;
  }
  // band-level "through": a cell is crossed horizontally when the solid run continues on both sides of its
  // whole vertical band (the column run through it), so extra grid lines inside a wall do not change the result.
  const bandRow = (i, j) => { let a = j, b = j; while (S(i, a - 1)) a--; while (S(i, b + 1)) b++; return [a, b]; };
  const bandCol = (i, j) => { let a = i, b = i; while (S(a - 1, j)) a--; while (S(b + 1, j)) b++; return [a, b]; };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!S(i, j)) continue;
    const l = S(i - 1, j), r = S(i + 1, j), u = S(i, j - 1), d = S(i, j + 1);
    let hThrough = l && r, vThrough = u && d;
    // thick blobs: decide by the longer run
    let lab;
    if (hThrough && !vThrough) lab = 1;
    else if (vThrough && !hThrough) lab = 2;
    else if (hThrough && vThrough) {
      // inside a wall band (a cell in the middle of a thick wall) or a cross: use the band extents
      const [ca, cb] = bandCol(i, j), [ra, rb] = bandRow(i, j);
      const lenH = xs[cb + 1] - xs[ca], lenV = ys[rb + 1] - ys[ra];
      lab = lenH >= lenV ? 1 : 2;
    } else if ((l || r) && !(u || d)) lab = 1;
    else if ((u || d) && !(l || r)) lab = 2;
    else if (l || r) {
      // corner (one horizontal and one vertical neighbour): the horizontal run takes it, unless the cell is the end of
      // a vertical band that continues (thicker rows) — keep it simple and deterministic: horizontal
      lab = 1;
    } else lab = runH[j * nx + i] >= runV[j * nx + i] ? 1 : 2;
    label[j * nx + i] = lab;
  }
  // make labels consistent across a wall's thickness: a row band of a horizontal run takes the majority label
  const rects = [];
  const used = new Uint8Array(nx * ny);
  // horizontal: maximal runs per row, then stack identical runs
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx;) {
    const id = j * nx + i;
    if (label[id] !== 1 || used[id]) { i++; continue; }
    let e = i; while (e < nx && label[j * nx + e] === 1 && !used[j * nx + e]) e++;
    let jj = j + 1;
    const rowOk = (r) => { if (r >= ny) return false; if (i > 0 && label[r * nx + i - 1] === 1 && !used[r * nx + i - 1]) return false; for (let t = i; t < e; t++) if (label[r * nx + t] !== 1 || used[r * nx + t]) return false; return !(e < nx && label[r * nx + e] === 1 && !used[r * nx + e]); };
    while (rowOk(jj)) jj++;
    for (let r = j; r < jj; r++) for (let t = i; t < e; t++) used[r * nx + t] = 1;
    rects.push({ x0: xs[i], x1: xs[e], y0: ys[j], y1: ys[jj], o: 'h' });
    i = e;
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny;) {
    const id = j * nx + i;
    if (label[id] !== 2 || used[id]) { j++; continue; }
    let e = j; while (e < ny && label[e * nx + i] === 2 && !used[e * nx + i]) e++;
    let ii = i + 1;
    const colOk = (cc) => { if (cc >= nx) return false; if (j > 0 && label[(j - 1) * nx + cc] === 2 && !used[(j - 1) * nx + cc]) return false; for (let t = j; t < e; t++) if (label[t * nx + cc] !== 2 || used[t * nx + cc]) return false; return !(e < ny && label[e * nx + cc] === 2 && !used[e * nx + cc]); };
    while (colOk(ii)) ii++;
    for (let cc = i; cc < ii; cc++) for (let t = j; t < e; t++) used[t * nx + cc] = 1;
    rects.push({ x0: xs[i], x1: xs[ii], y0: ys[j], y1: ys[e], o: 'v' });
    j = e;
  }

  // ---- snapping (relative to the north-west corner of all solid cells) ----
  const ox = Math.min(...rects.map((r) => r.x0)), oy = Math.min(...rects.map((r) => r.y0));
  const sn5 = (v, org) => org + Math.round((v - org) / o.snap) * o.snap;
  let snapped = rects.map((r) => ({ ...r, x0: sn5(r.x0, ox), x1: sn5(r.x1, ox), y0: sn5(r.y0, oy), y1: sn5(r.y1, oy) }))
    .filter((r) => r.x1 > r.x0 && r.y1 > r.y0);
  snapped = mergeRects(snapped);

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
  if (disagree > 0) {
    const area = walls.reduce((t, w) => t + w.w * w.h, 0);
    if (disagree > 0.02 * area) warnings.push({ code: 'open-outline', text: `Some wall outlines are not closed (${Math.round(disagree / 1e4 * 10) / 10} m² ambiguous); those parts were left out.`, where: null });
  }

  // ---- 6. exterior / interior ----
  const gaps = findGaps(walls, o);
  const outside = outsideMask(walls, gaps, o);
  for (const w of walls) {
    w.kind = facesOutside(w, outside) ? 'exterior' : 'interior';
    w.thickness = Math.min(w.w, w.h);
  }
  walls.sort((a, b) => a.y - b.y || a.x - b.x);
  walls.forEach((w, i) => { w.id = 'w' + String(i + 1).padStart(2, '0'); });

  const conf = pens.length ? Math.min(1, pens[0].pairFrac + 0.1) * (disagree > 0 ? 0.9 : 1) * (pieces.length ? 0.9 : 1) : 0.6;
  return {
    walls, gaps, frame: { matrix: toFrame, angle, cmPerUnit: k, origin: [ox, oy], snap: o.snap },
    pens: pens.map((p) => ({ pen: p.pen, lw: p.lw, color: p.color, score: +p.score.toFixed(3), thickness: p.thickness, pairFrac: +p.pairFrac.toFixed(3) })),
    fills: fills.map((f) => ({ color: f.color, n: f.polys.length })),
    unsupported: pieces, rejected, warnings,
    stats: { wallSegments: wallSegs.length, merged: mH.length + mV.length, grid: [nx, ny], rects: walls.length, ambiguousArea: Math.round(disagree), deskew: angle },
    confidence: +conf.toFixed(2),
    options: o,
  };
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

/** Merge rectangles with the same orientation that together form a rectangle (repeat until stable). */
function mergeRects(rs) {
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) {
      const p = rs[a], q = rs[b];
      if (p.o !== q.o) continue;
      if (p.y0 === q.y0 && p.y1 === q.y1 && (p.x1 === q.x0 || q.x1 === p.x0)) {
        rs[a] = { ...p, x0: Math.min(p.x0, q.x0), x1: Math.max(p.x1, q.x1) }; rs.splice(b, 1); changed = true; break outer;
      }
      if (p.x0 === q.x0 && p.x1 === q.x1 && (p.y1 === q.y0 || q.y1 === p.y0)) {
        rs[a] = { ...p, y0: Math.min(p.y0, q.y0), y1: Math.max(p.y1, q.y1) }; rs.splice(b, 1); changed = true; break outer;
      }
    }
  }
  return rs;
}

/** Occupancy grid at `snap` resolution over the walls' bounding box plus a margin. */
export function occupancy(walls, snap, margin = 2) {
  const x0 = Math.min(...walls.map((w) => w.x)) - margin * snap, y0 = Math.min(...walls.map((w) => w.y)) - margin * snap;
  const x1 = Math.max(...walls.map((w) => w.x + w.w)) + margin * snap, y1 = Math.max(...walls.map((w) => w.y + w.h)) + margin * snap;
  const nx = Math.round((x1 - x0) / snap), ny = Math.round((y1 - y0) / snap);
  const g = new Uint8Array(nx * ny);
  const cx = (x) => Math.round((x - x0) / snap), cy = (y) => Math.round((y - y0) / snap);
  const fill = (r, v) => { for (let j = cy(r.y); j < cy(r.y + r.h); j++) for (let i = cx(r.x); i < cx(r.x + r.w); i++) g[j * nx + i] = v; };
  walls.forEach((w) => fill(w, 1));
  return { g, nx, ny, x0, y0, snap, cx, cy, fill, at: (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : g[j * nx + i]) };
}

/**
 * Gaps in walls: from the free end of a wall run, the wall's thickness band stays empty for 25–400 cm and is then
 * fully closed by another wall (collinear, or the face of a crossing wall). Returns gaps in drawing cm:
 * { x, y, w, h, axis: 'h'|'v' (direction the wall runs), width, thickness, from, to (wall indices) }.
 */
export function findGaps(walls, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!walls.length) return [];
  const occ = occupancy(walls, o.snap, Math.ceil(o.maxOpening / o.snap) + 2);
  const { at, cx, cy, snap } = occ;
  const owner = new Int32Array(occ.nx * occ.ny).fill(-1);
  walls.forEach((w, n) => { for (let j = cy(w.y); j < cy(w.y + w.h); j++) for (let i = cx(w.x); i < cx(w.x + w.w); i++) owner[j * occ.nx + i] = n; });
  const gaps = [], seen = new Set();
  const maxSteps = Math.round(o.maxOpening / snap);
  walls.forEach((w, n) => {
    const i0 = cx(w.x), i1 = cx(w.x + w.w), j0 = cy(w.y), j1 = cy(w.y + w.h);
    const sideFree = (dir) => {
      if (dir === 'e') { for (let j = j0; j < j1; j++) if (at(i1, j)) return false; return true; }
      if (dir === 'w') { for (let j = j0; j < j1; j++) if (at(i0 - 1, j)) return false; return true; }
      if (dir === 's') { for (let i = i0; i < i1; i++) if (at(i, j1)) return false; return true; }
      for (let i = i0; i < i1; i++) if (at(i, j0 - 1)) return false; return true;
    };
    const opp = { e: 'w', w: 'e', s: 'n', n: 's' };
    for (const dir of ['e', 'w', 's', 'n']) {
      const horiz = dir === 'e' || dir === 'w';
      const band = horiz ? w.h : w.w, along = horiz ? w.w : w.h;
      if (band > o.maxThickness * 1.25) continue;
      if (!sideFree(dir)) continue;
      // probe only along the wall: it is elongated that way, or it is the free end of a run that continues behind it
      if (!(along > band || !sideFree(opp[dir]))) continue;
      let hit = -1, steps = 0;
      for (let s = 1; s <= maxSteps; s++) {
        let occN = 0, tot = 0, who = -1;
        if (horiz) { const i = dir === 'e' ? i1 - 1 + s : i0 - s; for (let j = j0; j < j1; j++) { tot++; if (at(i, j)) { occN++; who = owner[j * occ.nx + i]; } } }
        else { const j = dir === 's' ? j1 - 1 + s : j0 - s; for (let i = i0; i < i1; i++) { tot++; if (at(i, j)) { occN++; who = owner[j * occ.nx + i]; } } }
        if (occN === 0) continue;
        if (occN === tot) { hit = who; steps = s - 1; }
        break;
      }
      if (hit < 0) continue;
      const width = steps * snap;
      if (width < o.minOpening) continue;
      let g;
      if (dir === 'e') g = { x: w.x + w.w, y: w.y, w: width, h: w.h, axis: 'h' };
      else if (dir === 'w') g = { x: w.x - width, y: w.y, w: width, h: w.h, axis: 'h' };
      else if (dir === 's') g = { x: w.x, y: w.y + w.h, w: w.w, h: width, axis: 'v' };
      else g = { x: w.x, y: w.y - width, w: w.w, h: width, axis: 'v' };
      const key = [g.x, g.y, g.w, g.h].join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      gaps.push({ ...g, width, thickness: band, from: n, to: hit });
    }
  });
  return gaps;
}

/** Outside cells: flood fill from the border over free cells, with the gaps closed. */
export function outsideMask(walls, gaps, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!walls.length) return null;
  const occ = occupancy(walls, o.snap, 3);
  gaps.forEach((g) => occ.fill(g, 1));
  const { g, nx, ny } = occ;
  const out = new Uint8Array(nx * ny);
  const st = [];
  for (let i = 0; i < nx; i++) { st.push(i, (ny - 1) * nx + i); }
  for (let j = 0; j < ny; j++) { st.push(j * nx, j * nx + nx - 1); }
  while (st.length) {
    const id = st.pop();
    if (out[id] || g[id]) continue;
    out[id] = 1;
    const i = id % nx, j = (id / nx) | 0;
    if (i > 0) st.push(id - 1); if (i < nx - 1) st.push(id + 1); if (j > 0) st.push(id - nx); if (j < ny - 1) st.push(id + nx);
  }
  return { ...occ, out };
}

export function facesOutside(w, m) {
  if (!m) return false;
  const { cx, cy, nx, ny, out } = m;
  const isOut = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && out[j * nx + i] === 1;
  const i0 = cx(w.x), i1 = cx(w.x + w.w), j0 = cy(w.y), j1 = cy(w.y + w.h);
  const frac = (cells) => cells.filter(Boolean).length / Math.max(1, cells.length);
  const range = (a, b) => Array.from({ length: b - a }, (_, t) => a + t);
  const sides = [
    range(i0, i1).map((i) => isOut(i, j0 - 1)), range(i0, i1).map((i) => isOut(i, j1)),
    range(j0, j1).map((j) => isOut(i0 - 1, j)), range(j0, j1).map((j) => isOut(i1, j)),
  ];
  return sides.some((s) => frac(s) >= 0.5);
}

/** Which side of a gap / wall faces the outside: 'n' | 's' | 'e' | 'w' | null (drawing frame). */
export function outsideSide(r, m) {
  if (!m) return null;
  const { cx, cy, nx, ny, out } = m;
  const isOut = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && out[j * nx + i] === 1;
  const i0 = cx(r.x), i1 = cx(r.x + r.w), j0 = cy(r.y), j1 = cy(r.y + r.h);
  const count = (cells) => cells.filter(Boolean).length;
  const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, t) => a + t);
  const s = { n: count(range(i0, i1).map((i) => isOut(i, j0 - 1))), s: count(range(i0, i1).map((i) => isOut(i, j1))),
    w: count(range(j0, j1).map((j) => isOut(i0 - 1, j))), e: count(range(j0, j1).map((j) => isOut(i1, j))) };
  const best = Object.entries(s).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : null;
}

export { penKey };
