/**
 * Angled and curved walls for the sketch import (stage A6 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md). Only used when a
 * caller passes `slants: true`; the orthogonal engine (walls.js) is otherwise untouched. Drawing frame, cm.
 *
 *   1. wall-pen pieces that are neither horizontal nor vertical are split into straight angled lines and curve runs
 *      (a PDF path holding a Bézier is cut at its corners: straight orthogonal runs go back to the orthogonal engine);
 *   2. straight lines parallel within 1°, overlapping ≥ 60 % of the shorter one and 7–40 cm apart (nothing parallel in
 *      between) pair into a band: centre line + thickness. Curve runs that fit a circle pair when concentric, 7–40 cm
 *      apart and overlapping ≥ 60 % of the shorter sweep; other curves pair when one stays at a constant 7–40 cm
 *      offset from the other. Thin filled parallelograms (poché) are bands as they are;
 *   3. orthogonal outline lines that end on a band are closed so the parity fill sees closed rectilinear loops without
 *      the band: collinear pieces either side of a band are bridged, a horizontal and a vertical end meeting inside the
 *      band are extended to their corner, two parallel ends (a wall abutting the band) are closed at the corner that
 *      touches the band first (the design's "rect end on a slant" rule); short orthogonal caps / jogs lying on the band
 *      are dropped;
 *   4. collinear bands with a gap become one slant plus an opening (swing arc → door, glass lines → window, plain
 *      gap → passage), curved bands become chains of slants (sagitta ≤ 2 cm, chord ≥ 30 cm, ≥ 3 pieces per 90°),
 *      free slant ends are extended to the nearest wall face within 1.5 t, and exterior / interior comes from the same
 *      outside flood fill as the rectangles.
 * Slant conventions follow src/core/slant-geom.js: direction u = (x2 − x1, y2 − y1); the right-hand normal on screen is
 * (−uy, ux) ('r'); `at` is measured from (x1, y1); hinge 'a' / 'b' = jamb nearer the start / end.
 */
import { DEG, fitArc } from './prep.js';

const TAU = 2 * Math.PI;
export const SLANT_TOL = { sagitta: 2, minChord: 30, maxPieceDeg: 30, parallelDeg: 1, overlap: 0.6, extend: 1.5 };

// ---------------------------------------------------------------- lines
function mkLine(x1, y1, x2, y2, th) {
  if (th == null) { th = Math.atan2(y2 - y1, x2 - x1); if (th < 0) th += Math.PI; if (th >= Math.PI) th -= Math.PI; }
  const ux = Math.cos(th), uy = Math.sin(th), nx = -uy, ny = ux;
  const sa = x1 * ux + y1 * uy, sb = x2 * ux + y2 * uy;
  return { th, ux, uy, nx, ny, k: ((x1 + x2) / 2) * nx + ((y1 + y2) / 2) * ny, s0: Math.min(sa, sb), s1: Math.max(sa, sb), len: Math.hypot(x2 - x1, y2 - y1) };
}
const lineFrame = (th) => ({ th, ux: Math.cos(th), uy: Math.sin(th), nx: -Math.sin(th), ny: Math.cos(th) });
const proj = (f, x, y) => [x * f.ux + y * f.uy, x * f.nx + y * f.ny];          // → [s, k]
const unproj = (f, s, k) => [f.ux * s + f.nx * k, f.uy * s + f.ny * k];
const thDiff = (a, b) => { let d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d); };

/** Collinear angled lines (same direction ±0.5°, offset ≤ tol) with gaps ≤ gapTol merged into one. */
function mergeLines(lines, tol, gapTol) {
  const groups = [];
  for (const L of lines.slice().sort((a, b) => a.th - b.th || a.k - b.k)) {
    const g = groups.find((q) => thDiff(q.th, L.th) <= 0.5 * DEG && Math.abs(L.x * q.nx + L.y * q.ny - q.k) <= tol);
    if (g) { g.items.push(L); g.sw += L.len; g.sth += L.th * L.len; }
    else {
      const f = lineFrame(L.th);
      groups.push({ ...f, k: L.k, items: [L], sw: L.len, sth: L.th * L.len });
    }
    // L.x / L.y: a point on the line (its middle)
  }
  const out = [];
  for (const g of groups) {
    const f = lineFrame(g.sth / g.sw);
    let sk = 0;
    for (const L of g.items) sk += (L.x * f.nx + L.y * f.ny) * L.len;
    const k = sk / g.sw;
    const iv = g.items.map((L) => { const a = L.ends[0][0] * f.ux + L.ends[0][1] * f.uy, b = L.ends[1][0] * f.ux + L.ends[1][1] * f.uy; return [Math.min(a, b), Math.max(a, b)]; }).sort((p, q) => p[0] - q[0]);
    let cur = null;
    for (const v of iv) {
      if (cur && v[0] <= cur[1] + gapTol) cur[1] = Math.max(cur[1], v[1]);
      else { cur = v.slice(); out.push({ ...f, k, iv: cur }); }
    }
  }
  return out.map((m) => ({ th: m.th, ux: m.ux, uy: m.uy, nx: m.nx, ny: m.ny, k: m.k, s0: m.iv[0], s1: m.iv[1], len: m.iv[1] - m.iv[0] }));
}

/** Bands from pairs of parallel lines. */
function pairLines(lines, o) {
  const minT = o.minThickness - 0.5, maxT = o.maxThickness + 0.5, tol = o.mergeTol;
  const par = SLANT_TOL.parallelDeg * DEG;
  const at = (Q, f) => { const [s0] = proj(f, ...unproj(Q, Q.s0, Q.k)), [s1, k] = proj(f, ...unproj(Q, Q.s1, Q.k)); return { s0: Math.min(s0, s1), s1: Math.max(s0, s1), k }; };
  // clusters of near-parallel lines (chained by ≤ 1°), each scanned in order of offset: only lines within a wall
  // thickness of each other are compared (dense parallel sets such as exploded hatches stay cheap)
  const byTh = lines.slice().sort((a, b) => a.th - b.th), clusters = [];
  for (const Q of byTh) { const c = clusters[clusters.length - 1]; if (c && Q.th - c[c.length - 1].th <= par) c.push(Q); else clusters.push([Q]); }
  const cands = [];
  for (const C of clusters) {
    const fc = lineFrame(C.reduce((t, Q) => t + Q.th * Q.len, 0) / C.reduce((t, Q) => t + Q.len, 0));
    const maxLen = Math.max(...C.map((Q) => Q.len));
    const L = C.map((Q) => ({ Q, kc: at(Q, fc).k })).sort((p, q) => p.kc - q.kc);
    const reach = maxT + 0.02 * maxLen + tol;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length && L[j].kc - L[i].kc <= reach; j++) {
      const A = L[i].Q, B = L[j].Q;
      if (thDiff(A.th, B.th) > par) continue;
      const f = lineFrame((A.th * A.len + B.th * B.len) / (A.len + B.len));
      const a = at(A, f), b = at(B, f), d = Math.abs(b.k - a.k);
      if (d < minT || d > maxT) continue;
      const ov = Math.min(a.s1, b.s1) - Math.max(a.s0, b.s0);
      if (ov < SLANT_TOL.overlap * Math.min(A.len, B.len)) continue;
      const lo = Math.min(a.k, b.k), hi = Math.max(a.k, b.k), o0 = Math.max(a.s0, b.s0), o1 = Math.min(a.s1, b.s1);
      let between = false;
      for (let m = Math.max(0, i - 2); m <= Math.min(L.length - 1, j + 2) && !between; m++) {
        const M = L[m].Q;
        if (M === A || M === B || thDiff(M.th, f.th) > par) continue;
        const q = at(M, f);
        if (q.k > lo + tol && q.k < hi - tol && Math.min(q.s1, o1) - Math.max(q.s0, o0) > 0.5 * ov) between = true;
      }
      if (!between) cands.push({ A, B, a, b, d, f });
    }
  }
  // a face has wall on one side only: a line pairs on one side (the nearer partner wins where ranges overlap)
  cands.sort((p, q) => p.d - q.d);
  const acc = new Map();
  const bands = [];
  for (const c of cands) {
    const sideA = Math.sign(c.b.k - c.a.k), sideB = -sideA;
    const clash = (Q, side, r) => (acc.get(Q) || []).some((e) => e.side !== side && Math.min(e.s1, r.s1) - Math.max(e.s0, r.s0) > 0);
    if (clash(c.A, sideA, c.a) || clash(c.B, sideB, c.b)) continue;
    if (!acc.has(c.A)) acc.set(c.A, []); if (!acc.has(c.B)) acc.set(c.B, []);
    acc.get(c.A).push({ side: sideA, s0: c.a.s0, s1: c.a.s1 }); acc.get(c.B).push({ side: sideB, s0: c.b.s0, s1: c.b.s1 });
    const endTol = 1.5 * c.d + 2;
    // an end where both faces stop close together (they end on another wall's faces, or at a cap): the centre end is
    // their mean, and the band reaches as far as the longer face; else the band stops where the overlap does
    const m0 = Math.abs(c.a.s0 - c.b.s0) <= endTol, m1 = Math.abs(c.a.s1 - c.b.s1) <= endTol;
    const s0 = m0 ? (c.a.s0 + c.b.s0) / 2 : Math.max(c.a.s0, c.b.s0), s1 = m1 ? (c.a.s1 + c.b.s1) / 2 : Math.min(c.a.s1, c.b.s1);
    const b = lineBand(c.f, (c.a.k + c.b.k) / 2, s0, s1, c.d, 'lines');
    b.e0 = m0 ? Math.min(c.a.s0, c.b.s0) : s0; b.e1 = m1 ? Math.max(c.a.s1, c.b.s1) : s1;
    bands.push(b);
  }
  return bands;
}

function lineBand(f, kc, s0, s1, t, src) { return { type: 'line', th: f.th, ux: f.ux, uy: f.uy, nx: f.nx, ny: f.ny, kc, s0, s1, t, hw: t / 2, src }; }

// ---------------------------------------------------------------- curves
function polyLen(p) { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; }
function maxChordDev(p) {
  const n = p.length / 2, x1 = p[0], y1 = p[1], x2 = p[2 * n - 2], y2 = p[2 * n - 1], L = Math.hypot(x2 - x1, y2 - y1) || 1e-12;
  let m = 0;
  for (let i = 1; i < n - 1; i++) m = Math.max(m, Math.abs((x2 - x1) * (y1 - p[2 * i + 1]) - (x1 - p[2 * i]) * (y2 - y1)) / L);
  return m;
}
/** Cut a polyline at corners (turn > 25°): straight runs (deviation ≤ 0.3 cm) and gently turning runs. */
function runsOf(p) {
  const n = p.length / 2, out = [];
  let start = 0;
  for (let i = 1; i < n - 1; i++) {
    const ax = p[2 * i] - p[2 * i - 2], ay = p[2 * i + 1] - p[2 * i - 1], bx = p[2 * i + 2] - p[2 * i], by = p[2 * i + 3] - p[2 * i + 1];
    const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    if (turn > 25 * DEG) { out.push(p.slice(2 * start, 2 * i + 2)); start = i; }
  }
  out.push(p.slice(2 * start));
  return out.filter((r) => r.length >= 4);
}
const tangent = (p, atEnd) => {
  const n = p.length;
  const [dx, dy] = atEnd ? [p[n - 2] - p[n - 4], p[n - 1] - p[n - 3]] : [p[2] - p[0], p[3] - p[1]];
  const L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L];
};
/** Join curve runs that continue each other (end to end within 0.5 cm, tangents within 20°). */
function joinRuns(runs) {
  const list = runs.map((r) => r.slice());
  let joined = true;
  while (joined) {
    joined = false;
    outer: for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      const A = list[i];
      for (const rev of [false, true]) {
        let B = list[j];
        if (rev) { const r = []; for (let q = B.length - 2; q >= 0; q -= 2) r.push(B[q], B[q + 1]); B = r; }
        if (Math.hypot(A[A.length - 2] - B[0], A[A.length - 1] - B[1]) > 0.5) continue;
        const ta = tangent(A, true), tb = tangent(B, false);
        if (ta[0] * tb[0] + ta[1] * tb[1] < Math.cos(20 * DEG)) continue;
        list[i] = A.concat(B.slice(2));
        list.splice(j, 1);
        joined = true;
        break outer;
      }
    }
  }
  return list;
}
const arcInterval = (f) => {   // fitArc → [lo, sw] radians, ccw (in the drawing's own y-down atan2 sense)
  const a0 = f.a0 * DEG, sw = f.sweep * DEG;
  return sw >= 0 ? [a0, sw] : [a0 + sw, -sw];
};
const mod = (a, m) => ((a % m) + m) % m;

function pairArcs(arcs, o) {
  const minT = o.minThickness - 0.5, maxT = o.maxThickness + 0.5;
  const bands = [], used = new Set();
  const cands = [];
  for (let i = 0; i < arcs.length; i++) for (let j = i + 1; j < arcs.length; j++) {
    const A = arcs[i], B = arcs[j];
    if (Math.hypot(A.cx - B.cx, A.cy - B.cy) > Math.max(1.5, 0.01 * Math.max(A.r, B.r))) continue;
    const d = Math.abs(A.r - B.r);
    if (d < minT || d > maxT) continue;
    let best = null;
    for (const sh of [-TAU, 0, TAU]) {
      const lo2 = B.lo + sh;
      const ov = Math.min(A.lo + A.sw, lo2 + B.sw) - Math.max(A.lo, lo2);
      if (!best || ov > best.ov) best = { ov, lo2 };
    }
    if (best.ov < SLANT_TOL.overlap * Math.min(A.sw, B.sw)) continue;
    cands.push({ A, B, d, ...best });
  }
  cands.sort((p, q) => p.d - q.d);
  for (const c of cands) {
    if (used.has(c.A) || used.has(c.B)) continue;
    used.add(c.A); used.add(c.B);
    const rc = (c.A.r + c.B.r) / 2, endTol = (1.5 * c.d + 2) / rc;
    const A0 = c.A.lo, A1 = c.A.lo + c.A.sw, B0 = c.lo2, B1 = c.lo2 + c.B.sw;
    const lo = Math.abs(A0 - B0) <= endTol ? (A0 + B0) / 2 : Math.max(A0, B0);
    const hi = Math.abs(A1 - B1) <= endTol ? (A1 + B1) / 2 : Math.min(A1, B1);
    const w = c.A.len + c.B.len;
    bands.push({ type: 'arc', cx: (c.A.cx * c.A.len + c.B.cx * c.B.len) / w, cy: (c.A.cy * c.A.len + c.B.cy * c.B.len) / w, rc, lo, sw: hi - lo, t: c.d, hw: c.d / 2, curves: [c.A.src, c.B.src] });
  }
  return { bands, used };
}

function nearestOnPoly(p, x, y) {
  let best = Infinity, bx = 0, by = 0, bi = 0, bt = 0;
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], ay = p[i - 1], dx = p[i] - ax, dy = p[i + 1] - ay, L2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    const qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(x - qx, y - qy);
    if (d < best) { best = d; bx = qx; by = qy; bi = i / 2 - 1; bt = t; }
  }
  return { d: best, x: bx, y: by, i: bi, t: bt };
}
function densify(p, step) {
  const out = [p[0], p[1]];
  for (let i = 2; i < p.length; i += 2) {
    const x0 = p[i - 2], y0 = p[i - 1], L = Math.hypot(p[i] - x0, p[i + 1] - y0), n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push(x0 + (p[i] - x0) * k / n, y0 + (p[i + 1] - y0) * k / n);
  }
  return out;
}
/** Two non-circular curves at a constant offset → a band along their mid curve. */
function pairOffsetCurves(curves, used, o) {
  const minT = o.minThickness - 0.5, maxT = o.maxThickness + 0.5, bands = [];
  const box = (c) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < c.pts.length; i += 2) { x0 = Math.min(x0, c.pts[i]); x1 = Math.max(x1, c.pts[i]); y0 = Math.min(y0, c.pts[i + 1]); y1 = Math.max(y1, c.pts[i + 1]); } return { x0, y0, x1, y1 }; };
  const list = curves.filter((c) => !used.has(c)).map((c) => ({ c, b: box(c), len: polyLen(c.pts) })).sort((p, q) => q.len - p.len);
  const taken = new Set();
  for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
    if (i === j || taken.has(i) || taken.has(j)) continue;
    const S = list[i].len <= list[j].len ? list[i] : list[j], Lg = S === list[i] ? list[j] : list[i];
    if (S !== list[i]) continue;   // each unordered pair once, from its shorter curve
    const A = S.b, B = Lg.b;
    if (A.x0 > B.x1 + maxT || B.x0 > A.x1 + maxT || A.y0 > B.y1 + maxT || B.y0 > A.y1 + maxT) continue;
    const samp = densify(S.c.pts, 5), mids = [], ds = [];
    for (let q = 0; q < samp.length; q += 2) {
      const nn = nearestOnPoly(Lg.c.pts, samp[q], samp[q + 1]);
      const atEnd = (nn.i === 0 && nn.t === 0) || (nn.i === Lg.c.pts.length / 2 - 2 && nn.t === 1);
      if (nn.d >= minT && nn.d <= maxT && !atEnd) { mids.push((samp[q] + nn.x) / 2, (samp[q + 1] + nn.y) / 2); ds.push(nn.d); }
    }
    if (mids.length < 4 || (mids.length / 2) * 5 < SLANT_TOL.overlap * S.len) continue;
    const sd = ds.slice().sort((p, q) => p - q), t = sd[sd.length >> 1];
    if (sd[Math.floor(sd.length * 0.9)] - sd[Math.floor(sd.length * 0.1)] > 2) continue;
    taken.add(i); taken.add(j); used.add(S.c); used.add(Lg.c);
    bands.push({ type: 'poly', pts: mids, t, hw: t / 2, curves: [S.c.src, Lg.c.src] });
  }
  return bands;
}

// ---------------------------------------------------------------- band geometry
/** Group index per band: collinear straight bands (direction ±1°, centre lines < 2 cm apart, thickness ±1 cm) share one. */
export function bandGroups(bands) {
  const gid = bands.map((_, i) => i);
  const find = (i) => (gid[i] === i ? i : (gid[i] = find(gid[i])));
  for (let i = 0; i < bands.length; i++) for (let j = i + 1; j < bands.length; j++) {
    const a = bands[i], b = bands[j];
    if (a.type !== 'line' || b.type !== 'line' || thDiff(a.th, b.th) > SLANT_TOL.parallelDeg * DEG || Math.abs(a.t - b.t) > 1) continue;
    const [, k] = proj(a, ...unproj(b, (b.s0 + b.s1) / 2, b.kc));
    if (Math.abs(k - a.kc) < 2) gid[find(j)] = find(i);
  }
  return bands.map((_, i) => find(i));
}

/** Is (x, y) on the band (within its half thickness + e, and its length ± e)? */
export function touch(b, x, y, e) {
  if (b.type === 'line') {
    const s = x * b.ux + y * b.uy, k = x * b.nx + y * b.ny;
    return Math.abs(k - b.kc) <= b.hw + e && s >= Math.min(b.s0, b.e0 ?? b.s0) - e && s <= Math.max(b.s1, b.e1 ?? b.s1) + e;
  }
  if (b.type === 'arc') {
    const dx = x - b.cx, dy = y - b.cy, d = Math.abs(Math.hypot(dx, dy) - b.rc);
    if (d > b.hw + e) return false;
    const rel = mod(Math.atan2(dy, dx) - b.lo, TAU), m = e / b.rc;
    return rel <= b.sw + m || rel >= TAU - m;
  }
  return nearestOnPoly(b.pts, x, y).d <= b.hw + e;
}

// ---------------------------------------------------------------- 1–2. find bands
/**
 * @param odd    wall-pen segments in the frame that are not orthogonal straight lines: { x1, y1, x2, y2, len, path, curved }
 * @param fillBands  bands from filled parallelograms (wallFills)
 * @returns { bands, lines (merged angled lines), ortho: { H, V } (straight orthogonal runs of curved paths), unsupported (raw segs) }
 */
export function findBands(odd, fillBands, o) {
  const angled = [], curveRuns = [], H = [], V = [];
  const odd2 = [];   // segments that may end up unsupported
  // consecutive curved segments of one path → polylines
  let poly = null;
  const flush = () => {
    if (!poly) return;
    for (const r of runsOf(poly.pts)) {
      const L = polyLen(r), n = r.length;
      if (maxChordDev(r) <= Math.max(0.3, 0.002 * L)) {
        const x1 = r[0], y1 = r[1], x2 = r[n - 2], y2 = r[n - 1], dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1), len = Math.hypot(dx, dy);
        if (len < 0.2) continue;
        if (dy <= Math.max(0.3, len * Math.tan(1 * DEG))) { H.push({ k: (y1 + y2) / 2, a: Math.min(x1, x2), b: Math.max(x1, x2) }); continue; }
        if (dx <= Math.max(0.3, len * Math.tan(1 * DEG))) { V.push({ k: (x1 + x2) / 2, a: Math.min(y1, y2), b: Math.max(y1, y2) }); continue; }
        angled.push({ x1, y1, x2, y2 });
        odd2.push({ type: 'angled', path: poly.path, x1, y1, x2, y2, len });
      } else {
        curveRuns.push({ pts: r, src: poly.path });
        for (let i = 2; i < n; i += 2) odd2.push({ type: 'curved', path: poly.path, x1: r[i - 2], y1: r[i - 1], x2: r[i], y2: r[i + 1], len: Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]) });
      }
    }
    poly = null;
  };
  for (const s of odd) {
    if (s.curved) {
      if (poly && poly.path === s.path && Math.abs(poly.pts[poly.pts.length - 2] - s.x1) < 1e-6 && Math.abs(poly.pts[poly.pts.length - 1] - s.y1) < 1e-6) poly.pts.push(s.x2, s.y2);
      else { flush(); poly = { path: s.path, pts: [s.x1, s.y1, s.x2, s.y2] }; }
    } else {
      flush();
      angled.push(s);
      odd2.push({ type: 'angled', path: s.path, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, len: s.len });
    }
  }
  flush();
  const bands = [...fillBands];
  // straight angled lines
  const raw = angled.map((s) => { const L = mkLine(s.x1, s.y1, s.x2, s.y2); return { ...L, x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2, ends: [[s.x1, s.y1], [s.x2, s.y2]] }; });
  const lines = raw.length <= 4000 ? mergeLines(raw, o.mergeTol, Math.min(10, 0.4 * o.minOpening)) : [];
  bands.push(...pairLines(lines, o));
  // curves
  const runs = joinRuns(curveRuns.map((c) => c.pts));
  const curves = runs.map((pts, i) => ({ pts, src: 'c' + i }));
  const arcs = [];
  for (const c of curves) {
    const f = c.pts.length >= 8 ? fitArc(c.pts) : null;
    if (!f || f.rms > Math.max(0.3, 0.002 * f.r) || Math.abs(f.sweep) < 5) continue;
    const [lo, sw] = arcInterval(f);
    arcs.push({ cx: f.cx, cy: f.cy, r: f.r, lo, sw, len: polyLen(c.pts), src: c, curve: c });
  }
  const pa = pairArcs(arcs, o);
  bands.push(...pa.bands);
  const usedCurves = new Set([...pa.used].map((a) => a.curve));
  bands.push(...pairOffsetCurves(curves, usedCurves, o));
  // what is not on a band stays unsupported (caps and jamb lines of a band are part of it; a face line running past a
  // junction may end on two collinear bands)
  const gid = bandGroups(bands);
  const groupsAt = (x, y) => new Set(bands.map((b, i) => (touch(b, x, y, 1.5) ? gid[i] : -1)).filter((g) => g >= 0));
  const unsupported = odd2.filter((s) => { const A = groupsAt(s.x1, s.y1); if (!A.size) return true; const B = groupsAt(s.x2, s.y2); return ![...A].some((g) => B.has(g)); });
  return { bands, lines, ortho: { H, V }, unsupported };
}

/** Thin filled parallelogram (4 corners, long sides parallel within 1°, 7–40 cm apart) → a band, else null. */
export function fillBand(pts, o) {
  const q = pts.slice();
  if (q.length > 1 && Math.hypot(q[0][0] - q[q.length - 1][0], q[0][1] - q[q.length - 1][1]) < 1e-6) q.pop();
  if (q.length !== 4) return null;
  const e = [0, 1, 2, 3].map((i) => mkLine(q[i][0], q[i][1], q[(i + 1) % 4][0], q[(i + 1) % 4][1]));
  for (const [i, j] of [[0, 2], [1, 3]]) {
    const A = e[i], B = e[j];
    if (thDiff(A.th, B.th) > SLANT_TOL.parallelDeg * DEG || Math.min(A.len, B.len) < 1e-6) continue;
    const f = lineFrame((A.th * A.len + B.th * B.len) / (A.len + B.len));
    const mA = proj(f, (q[i][0] + q[(i + 1) % 4][0]) / 2, (q[i][1] + q[(i + 1) % 4][1]) / 2), mB = proj(f, (q[j][0] + q[(j + 1) % 4][0]) / 2, (q[j][1] + q[(j + 1) % 4][1]) / 2);
    const t = Math.abs(mA[1] - mB[1]);
    if (t < o.minThickness * 0.9 || t > o.maxThickness * 1.1 || Math.min(A.len, B.len) < 2 * t) continue;
    if (Math.min(thDiff(f.th, 0), thDiff(f.th, Math.PI / 2)) <= 1 * DEG) return null;   // rectilinear: the rect path
    const sA = [q[i], q[(i + 1) % 4]].map((p) => proj(f, p[0], p[1])[0]).sort((a, b) => a - b);
    const sB = [q[j], q[(j + 1) % 4]].map((p) => proj(f, p[0], p[1])[0]).sort((a, b) => a - b);
    return lineBand(f, (mA[1] + mB[1]) / 2, (sA[0] + sB[0]) / 2, (sA[1] + sB[1]) / 2, t, 'fill');
  }
  return null;
}

// ---------------------------------------------------------------- 3. orthogonal closure
/**
 * Close orthogonal outline lines (merged H / V: { k, a, b }) that end on a band. Returns new { H, V } (unmerged).
 */
export function closeAtBands(H0, V0, bands, o) {
  const e = 1;
  const pt = (L, end) => (L.h ? [L[end], L.k] : [L.k, L[end]]);
  const lines = [...H0.map((L) => ({ k: L.k, a: L.a, b: L.b, h: true })), ...V0.map((L) => ({ k: L.k, a: L.a, b: L.b, h: false }))];
  // caps and jogs lying on a band
  const keep = lines.filter((L) => !bands.some((b) => L.b - L.a <= 1.5 * b.t + 1 && touch(b, ...pt(L, 'a'), e) && touch(b, ...pt(L, 'b'), e)));
  const ends = [];
  const gid = bandGroups(bands);
  for (const L of keep) for (const end of ['a', 'b']) {
    const [x, y] = pt(L, end);
    const hit = bands.findIndex((b) => touch(b, x, y, e));
    if (hit < 0) continue;
    const bi = gid[hit];
    const sg = end === 'b' ? 1 : -1;
    ends.push({ L, end, x, y, dx: L.h ? sg : 0, dy: L.h ? 0 : sg, bi });
  }
  const cands = [];
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    const P = ends[i], Q = ends[j];
    if (P.bi !== Q.bi || P.L === Q.L) continue;
    const b = bands[P.bi], t = b.t;
    if (P.L.h === Q.L.h) {
      const dk = Math.abs(P.L.k - Q.L.k), along = (E) => (E.L.h ? E.x : E.y);
      if (dk <= o.mergeTol && P.dx * Q.dx + P.dy * Q.dy < 0) {
        const gap = (Q.x - P.x) * P.dx + (Q.y - P.y) * P.dy;
        if (gap > -o.mergeTol && gap <= 3 * t + 5) cands.push({ type: 'bridge', P, Q, cost: Math.max(0, gap) });
      } else if (P.dx === Q.dx && P.dy === Q.dy && dk >= o.minThickness * 0.9 && dk <= o.maxThickness * 1.1) {
        const stagger = Math.abs(along(P) - along(Q));
        if (stagger <= 6 * dk + 5) cands.push({ type: 'close', P, Q, cost: stagger + dk });
      }
    } else {
      const Hh = P.L.h ? P : Q, Vv = P.L.h ? Q : P;
      const X = Vv.L.k, Y = Hh.L.k;
      const eh = (X - Hh.x) * Hh.dx, ev = (Y - Vv.y) * Vv.dy;
      if (eh >= -0.5 && ev >= -0.5 && eh <= 2 * t + 5 && ev <= 2 * t + 5 && bands.some((q, i) => gid[i] === P.bi && touch(q, X, Y, 1.5))) cands.push({ type: 'corner', Hh, Vv, X, Y, cost: Math.max(0, eh) + Math.max(0, ev) });
    }
  }
  cands.sort((p, q) => p.cost - q.cost);
  const used = new Set(), extra = [];
  const setEnd = (E, v) => { E.L[E.end] = v; };
  for (const c of cands) {
    const es = c.type === 'corner' ? [c.Hh, c.Vv] : [c.P, c.Q];
    if (es.some((E) => used.has(E))) continue;
    es.forEach((E) => used.add(E));
    if (c.type === 'bridge') {
      const v = c.P.L.h ? c.Q.x : c.Q.y;
      setEnd(c.P, v);   // the two lines now touch; the collinear merge joins them
    } else if (c.type === 'corner') {
      setEnd(c.Hh, c.X); setEnd(c.Vv, c.Y);
    } else {
      const along = (E) => (E.L.h ? E.x : E.y);
      const dir = c.P.L.h ? c.P.dx : c.P.dy;
      const v = dir > 0 ? Math.min(along(c.P), along(c.Q)) : Math.max(along(c.P), along(c.Q));
      setEnd(c.P, v); setEnd(c.Q, v);
      extra.push({ k: v, a: Math.min(c.P.L.k, c.Q.L.k), b: Math.max(c.P.L.k, c.Q.L.k), h: !c.P.L.h });
    }
  }
  const all = [...keep, ...extra].filter((L) => L.b - L.a > 1e-6);
  return { H: all.filter((L) => L.h).map(({ k, a, b }) => ({ k, a, b })), V: all.filter((L) => !L.h).map(({ k, a, b }) => ({ k, a, b })) };
}

// ---------------------------------------------------------------- 4. slants, openings in slants, chains
const DOOR = { maxPassage: 120, minOpening: 25, maxOpening: 400, slidingDoorMin: 200 };

/** Evidence in the gap [sa, sb] of a straight band frame (arcs → door, thin parallel lines → window). */
function gapEvidence(f, kc, hw, sa, sb, ctx, o) {
  const W = sb - sa, tol = Math.max(10, 0.15 * W), tolX = 6 + 0.03 * W;
  const loc = (x, y) => { const [s, k] = proj(f, x, y); return [s, k - kc]; };
  const near = (a, jamb, frac) => { const [s, k] = loc(a.cx, a.cy); return Math.abs(s - jamb) <= tol && Math.abs(k) <= hw + tolX && a.r >= 0.7 * frac * W - 3 && a.r <= 1.15 * frac * W + 3 && a.sweep >= 55 && a.sweep <= 125; };
  const side = (a) => (loc(a.mid[0], a.mid[1])[1] > 0 ? 'r' : 'l');
  const hingeOf = (a) => { const s = loc(a.cx, a.cy)[0]; return Math.abs(s - sa) <= Math.abs(s - sb) ? 'a' : 'b'; };
  const singles = ctx.arcs.filter((a) => near(a, sa, 1) || near(a, sb, 1));
  const halves0 = ctx.arcs.filter((a) => near(a, sa, 0.5)), halves1 = ctx.arcs.filter((a) => near(a, sb, 0.5));
  if (singles.length) {
    singles.sort((a, b) => (a.dashed - b.dashed) || Math.abs(a.r - W) - Math.abs(b.r - W));
    const a = singles[0];
    const d = { kind: 'door', hinge: hingeOf(a), swing: side(a), confidence: a.dashed ? 0.75 : 0.9, evidence: { arcs: singles.length, radius: +a.r.toFixed(1), sweep: Math.round(a.sweep) } };
    const other = singles.find((b) => b !== a && side(b) !== d.swing);
    if (other) d.innerDoor = { width: W, hinge: hingeOf(other), swing: side(other), dashed: other.dashed };
    return d;
  }
  if (halves0.length && halves1.length && halves0.some((a) => halves1.some((b) => side(a) === side(b)))) {
    const a = halves0[0];
    return { kind: 'door', leaves: 2, hinge: hingeOf(a), swing: side(a), confidence: 0.8, evidence: { arcs: 2, radius: +a.r.toFixed(1) } };
  }
  const keys = new Set();
  for (const s of ctx.asegs || []) {
    if (thDiff(s.th, f.th) > SLANT_TOL.parallelDeg * DEG) continue;
    const [p0, k0] = loc(s.x1, s.y1), [p1, k1] = loc(s.x2, s.y2);
    if (Math.abs((k0 + k1) / 2) > hw + 1) continue;
    const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
    if (Math.min(hi, sb) - Math.max(lo, sa) >= 0.7 * W && hi - lo <= W * 1.6 + 30) keys.add(Math.round((k0 + k1) / 2));
  }
  if (keys.size) {
    const sliding = W >= (o.slidingDoorMin ?? DOOR.slidingDoorMin);
    return { kind: sliding ? 'sliding-door' : 'window', confidence: sliding ? 0.5 : (keys.size >= 2 ? 0.85 : 0.65), evidence: { lines: keys.size } };
  }
  return null;
}

/** Does a wall line run along a face of the band across [sa, sb] (a T-junction, not a hole)? */
function faceContinuous(f, kc, hw, sa, sb, lines) {
  const W = sb - sa;
  return lines.some((L) => {
    if (thDiff(L.th, f.th) > SLANT_TOL.parallelDeg * DEG) return false;
    const [p0, k0] = proj(f, ...unproj(L, L.s0, L.k)), [p1] = proj(f, ...unproj(L, L.s1, L.k));
    if (Math.abs(Math.abs(k0 - kc) - hw) > 1.5) return false;
    return Math.min(Math.max(p0, p1), sb) - Math.max(Math.min(p0, p1), sa) > 0.25 * W;
  });
}

/** Straight bands → slants (collinear pieces joined over their gaps, with openings); curved bands → chains. */
export function buildUnits(bands, ctx, lines, o) {
  const units = [];
  const straight = bands.filter((b) => b.type === 'line').sort((a, b) => a.th - b.th || a.kc - b.kc || a.s0 - b.s0);
  const groups = [];
  for (const b of straight) {
    const g = groups.find((q) => thDiff(q.f.th, b.th) <= SLANT_TOL.parallelDeg * DEG && Math.abs(q.t - b.t) <= 1 &&
      Math.abs(proj(q.f, ...unproj(b, (b.s0 + b.s1) / 2, b.kc))[1] - q.kc) < 2);
    const f = g ? g.f : lineFrame(b.th);
    const [s0, k] = proj(f, ...unproj(b, b.s0, b.kc)), [s1] = proj(f, ...unproj(b, b.s1, b.kc));
    const piece = { s0: Math.min(s0, s1), s1: Math.max(s0, s1), k, t: b.t, src: b.src };
    if (g) g.items.push(piece); else groups.push({ f, kc: k, t: b.t, items: [piece] });
  }
  for (const g of groups) {
    const items = g.items.sort((a, b) => a.s0 - b.s0);
    const wsum = items.reduce((s, p) => s + (p.s1 - p.s0), 0) || 1;
    g.kc = items.reduce((s, p) => s + p.k * (p.s1 - p.s0), 0) / wsum;
    g.t = items.reduce((s, p) => s + p.t * (p.s1 - p.s0), 0) / wsum;
    const hw = g.t / 2;
    let cur = null;
    const emit = () => { if (cur) units.push({ type: 'slant', f: g.f, kc: g.kc, t: g.t, s0: cur.s0, s1: cur.s1, openings: cur.openings, src: cur.src }); };
    for (const p of items) {
      if (!cur) { cur = { s0: p.s0, s1: p.s1, openings: [], src: p.src }; continue; }
      const sa = cur.s1, sb = p.s0, gap = sb - sa;
      let join = gap <= 1;
      if (!join && faceContinuous(g.f, g.kc, hw, sa, sb, lines)) join = true;
      else if (!join && gap >= o.minOpening && gap <= o.maxOpening) {
        const ev = gapEvidence(g.f, g.kc, hw, sa, sb, ctx, o);
        if (ev) { cur.openings.push({ ...ev, sa, sb }); join = true; }
        else if (gap <= o.maxPassage) { cur.openings.push({ kind: 'opening', confidence: 0.35, evidence: { empty: true }, sa, sb }); join = true; }
      }
      if (join) cur.s1 = Math.max(cur.s1, p.s1);
      else { emit(); cur = { s0: p.s0, s1: p.s1, openings: [], src: p.src }; }
    }
    emit();
  }
  // curved bands → chains
  for (const b of bands) {
    if (b.type === 'line') continue;
    const ch = b.type === 'arc' ? arcChain(b) : polyChain(b);
    if (ch.pts.length >= 2) units.push({ type: 'chain', t: b.t, pts: ch.pts, maxDev: ch.maxDev, band: b });
  }
  return units;
}

function arcChain(b) {
  const minN = Math.max(1, Math.ceil(b.sw / (SLANT_TOL.maxPieceDeg * DEG) - 1e-9));
  let N = minN;
  const sag = (n) => b.rc * (1 - Math.cos(b.sw / (2 * n))), chord = (n) => 2 * b.rc * Math.sin(b.sw / (2 * n));
  while (sag(N) > SLANT_TOL.sagitta && chord(N + 1) >= SLANT_TOL.minChord && N < 400) N++;
  const pts = [];
  for (let i = 0; i <= N; i++) { const a = b.lo + b.sw * i / N; pts.push([b.cx + b.rc * Math.cos(a), b.cy + b.rc * Math.sin(a)]); }
  return { pts, maxDev: sag(N) };
}

function polyChain(b) {
  const p = b.pts, n = p.length / 2, cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]));
  const L = cum[n - 1];
  let turn = 0;
  for (let i = 1; i < n - 1; i++) {
    const ax = p[2 * i] - p[2 * i - 2], ay = p[2 * i + 1] - p[2 * i - 1], bx = p[2 * i + 2] - p[2 * i], by = p[2 * i + 3] - p[2 * i + 1];
    turn += Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
  }
  const at = (s) => { let i = 1; while (i < n - 1 && cum[i] < s) i++; const f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [p[2 * i - 2] + (p[2 * i] - p[2 * i - 2]) * f, p[2 * i - 1] + (p[2 * i + 1] - p[2 * i - 1]) * f]; };
  const build = (N) => {
    const v = []; for (let k = 0; k <= N; k++) v.push(at(L * k / N));
    let dev = 0;
    for (let i = 0; i < n; i++) {
      const k = Math.min(N - 1, Math.floor(cum[i] / L * N)), [x1, y1] = v[k], [x2, y2] = v[k + 1], d = Math.hypot(x2 - x1, y2 - y1) || 1e-12;
      dev = Math.max(dev, Math.abs((x2 - x1) * (y1 - p[2 * i + 1]) - (x1 - p[2 * i]) * (y2 - y1)) / d);
    }
    return { pts: v, maxDev: dev };
  };
  let N = Math.max(1, Math.ceil(turn / (SLANT_TOL.maxPieceDeg * DEG) - 1e-9));
  let r = build(N);
  while (r.maxDev > SLANT_TOL.sagitta && L / (N + 1) >= SLANT_TOL.minChord && N < 400) r = build(++N);
  return r;
}

// unit geometry helpers
function unitPieces(u) {
  if (u.type === 'slant') { const [x1, y1] = unproj(u.f, u.s0, u.kc), [x2, y2] = unproj(u.f, u.s1, u.kc); return [{ x1, y1, x2, y2 }]; }
  const out = []; for (let i = 1; i < u.pts.length; i++) out.push({ x1: u.pts[i - 1][0], y1: u.pts[i - 1][1], x2: u.pts[i][0], y2: u.pts[i][1] }); return out;
}
const segDist = (s, x, y) => {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L2 = dx * dx + dy * dy || 1e-12, t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / L2));
  return Math.hypot(x - s.x1 - dx * t, y - s.y1 - dy * t);
};
const onUnit = (u, x, y, e) => unitPieces(u).some((s) => {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = Math.hypot(dx, dy) || 1e-12, ux = dx / L, uy = dy / L;
  const a = (x - s.x1) * ux + (y - s.y1) * uy, k = -(x - s.x1) * uy + (y - s.y1) * ux;
  return Math.abs(k) <= u.t / 2 + e && a >= -e && a <= L + e;
});
function rayHit(px, py, dx, dy, ax, ay, bx, by) {   // ray p + λ d against segment a–b → λ or null
  const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return null;
  const qx = ax - px, qy = ay - py, lam = (qx * ey - qy * ex) / den, mu = (qx * dy - qy * dx) / den;
  return lam > 1e-6 && mu >= -1e-9 && mu <= 1 + 1e-9 ? lam : null;
}

/** Extend free slant / chain ends to the nearest wall face (rect or slant) within 1.5 t. */
export function extendEnds(units, rects) {
  units.forEach((u, ui) => {
    for (const atEnd of [false, true]) {
      let E, D;
      if (u.type === 'slant') { E = unproj(u.f, atEnd ? u.s1 : u.s0, u.kc); D = atEnd ? [u.f.ux, u.f.uy] : [-u.f.ux, -u.f.uy]; }
      else {
        const P = u.pts, n = P.length, A = atEnd ? P[n - 2] : P[1], B = atEnd ? P[n - 1] : P[0], L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
        E = B; D = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
      }
      const inRect = rects.some((r) => E[0] >= r.x - 0.5 && E[0] <= r.x + r.w + 0.5 && E[1] >= r.y - 0.5 && E[1] <= r.y + r.h + 0.5);
      if (inRect || units.some((v, vi) => vi !== ui && onUnit(v, E[0], E[1], 0.5))) continue;
      const reach = SLANT_TOL.extend * u.t;
      let best = null;
      const consider = (lam) => { if (lam != null && lam <= reach && (best == null || lam < best)) best = lam; };
      for (const r of rects) {
        const c = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
        for (let i = 0; i < 4; i++) consider(rayHit(E[0], E[1], D[0], D[1], ...c[i], ...c[(i + 1) % 4]));
      }
      units.forEach((v, vi) => {
        if (vi === ui) return;
        for (const s of unitPieces(v)) {
          const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1, nx = -(s.y2 - s.y1) / L * v.t / 2, ny = (s.x2 - s.x1) / L * v.t / 2;
          for (const sg of [1, -1]) consider(rayHit(E[0], E[1], D[0], D[1], s.x1 + sg * nx, s.y1 + sg * ny, s.x2 + sg * nx, s.y2 + sg * ny));
        }
      });
      if (best == null) continue;
      if (u.type === 'slant') { if (atEnd) u.s1 += best; else u.s0 -= best; }   // opening `at` follows (it is measured from s0)
      else { const P = u.pts, i = atEnd ? P.length - 1 : 0; P[i] = [P[i][0] + D[0] * best, P[i][1] + D[1] * best]; }
      u.extended = (u.extended || 0) + best;
    }
  });
}

/** Slant pieces of the units for the outside mask: [{ x1, y1, x2, y2, t }]. */
export function unitSegments(units) {
  const out = [];
  for (const u of units) for (const s of unitPieces(u)) out.push({ ...s, t: u.t });
  return out;
}

/** Exterior / interior of each unit and the outside side ('l' | 'r') along a stretch, from the outside mask. */
export function sideCounts(pieces, m, from = null, to = null) {
  const { x0, y0, nx, ny, out, snap } = m;
  const isOut = (x, y) => { const i = Math.floor((x - x0) / snap), j = Math.floor((y - y0) / snap); return i >= 0 && j >= 0 && i < nx && j < ny && out[j * nx + i] === 1; };
  let l = 0, r = 0, n = 0, acc = 0;
  for (const s of pieces) {
    const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1e-12, ux = (s.x2 - s.x1) / L, uy = (s.y2 - s.y1) / L, off = s.t / 2 + 1.5 * snap;
    for (let a = snap / 2; a < L; a += snap) {
      const g = acc + a;
      if (from != null && (g < from || g > to)) continue;
      const cx = s.x1 + ux * a, cy = s.y1 + uy * a;
      n++;
      if (isOut(cx - uy * off, cy + ux * off)) r++;
      if (isOut(cx + uy * off, cy - ux * off)) l++;
    }
    acc += L;
  }
  return { l, r, n };
}

/** Bounding box of slant pieces (with their thickness). */
export function piecesBox(pieces) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of pieces) { const h = s.t / 2; x0 = Math.min(x0, s.x1 - h, s.x2 - h); y0 = Math.min(y0, s.y1 - h, s.y2 - h); x1 = Math.max(x1, s.x1 + h, s.x2 + h); y1 = Math.max(y1, s.y1 + h, s.y2 + h); }
  return { x0, y0, x1, y1 };
}

/** Rasterise slant pieces into an occupancy grid (cells within t/2 + 0.75 snap of the centre line: 4-connected). */
export function rasteriseSlants(occ, pieces) {
  const { g, nx, ny, x0, y0, snap } = occ;
  for (const s of pieces) {
    const R = s.t / 2 + 0.75 * snap;
    const i0 = Math.max(0, Math.floor((Math.min(s.x1, s.x2) - R - x0) / snap)), i1 = Math.min(nx - 1, Math.ceil((Math.max(s.x1, s.x2) + R - x0) / snap));
    const j0 = Math.max(0, Math.floor((Math.min(s.y1, s.y2) - R - y0) / snap)), j1 = Math.min(ny - 1, Math.ceil((Math.max(s.y1, s.y2) + R - y0) / snap));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (segDist(s, x0 + (i + 0.5) * snap, y0 + (j + 0.5) * snap) <= R) g[j * nx + i] = 1;
  }
}

/** Final frame-cm slants + their openings (ids s01…, chains c1…), with kinds from the outside mask. */
export function finishUnits(units, mask, o) {
  const snap = o.snap;
  const key = (u) => { const P = unitPieces(u); return [Math.min(...P.flatMap((s) => [s.y1, s.y2])), Math.min(...P.flatMap((s) => [s.x1, s.x2]))]; };
  const order = units.map((u) => ({ u, k: key(u) })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1]).map((e) => e.u);
  const slants = [], openings = [], chains = [];
  let n = 0, c = 0;
  for (const u of order) {
    const pieces = unitPieces(u).map((s) => ({ ...s, t: u.t }));
    const sc = mask ? sideCounts(pieces, mask) : { l: 0, r: 0, n: 0 };
    const ext = (q) => q > 0 && (q >= 0.2 * sc.n || q * snap >= 40);
    const kind = ext(sc.l) || ext(sc.r) ? 'exterior' : 'interior';
    const t = Math.round(u.t);
    if (u.type === 'slant') {
      const p = pieces[0], id = 's' + String(++n).padStart(2, '0');
      slants.push({ id, x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, t, kind });
      for (const op of u.openings) {
        const at = (op.sa + op.sb) / 2 - u.s0, width = op.sb - op.sa;
        const sd = mask ? sideCounts(pieces, mask, at - width / 2, at + width / 2) : { l: 0, r: 0 };
        const outside = sd.l || sd.r ? (sd.r >= sd.l ? 'r' : 'l') : null;
        const q = { wall: id, at, width, kind: op.kind, outside, confidence: op.confidence, evidence: op.evidence };
        if (op.hinge) { q.hinge = op.hinge; q.swing = op.swing; }
        if (op.leaves) q.leaves = op.leaves;
        if (op.innerDoor) q.innerDoor = op.innerDoor;
        openings.push(q);
      }
    } else {
      const cid = 'c' + (++c);
      chains.push({ id: cid, pieces: pieces.length, maxDev: u.maxDev, box: piecesBox(pieces) });
      for (const p of pieces) slants.push({ id: 's' + String(++n).padStart(2, '0'), x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, t, kind, chain: cid });
    }
  }
  return { slants, openings, chains };
}
