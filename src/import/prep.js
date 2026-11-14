/**
 * Shared preparation of vector primitives: segments, line classes (pen = width + colour + dash), dominant
 * orientation (deskew), arc fitting. Pure functions over the plain data returned by readPdf / readImage.
 */

export const DEG = Math.PI / 180;
export const PT_CM = 2.54 / 72; // one PDF point on paper, in cm (1:1)

/** 2D affine [a, b, c, d, e, f]: X = a x + c y + e, Y = b x + d y + f (canvas setTransform order). */
export const affApply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** n ∘ m : first m, then n. */
export const affThen = (m, n) => [
  n[0] * m[0] + n[2] * m[1], n[1] * m[0] + n[3] * m[1],
  n[0] * m[2] + n[2] * m[3], n[1] * m[2] + n[3] * m[3],
  n[0] * m[4] + n[2] * m[5] + n[4], n[1] * m[4] + n[3] * m[5] + n[5],
];
export const affInvert = (m) => {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
};

/** Key of a pen: width class (2 significant digits, 0 = hairline), colour, dashed. */
export function penKey(p) {
  const lw = p.lw > 0 ? Number(p.lw.toPrecision(2)) : 0;
  return `${lw}|${p.color}|${p.dash && p.dash.length && p.dash.some((d) => d > 0) ? 'dash' : 'solid'}`;
}

// per-primitives caches (the same page is analysed by several detectors; the data is never mutated)
const segCache = new WeakMap(), arcCache = new WeakMap();

/** All straight stroked segments: { x1, y1, x2, y2, len, ang (0..180 deg), pen, lw, path, curved }. */
export function segmentsOf(prims) {
  if (segCache.has(prims)) return segCache.get(prims);
  const out = [];
  prims.paths.forEach((p, pi) => {
    if (!p.stroke) return;
    const pen = penKey(p);
    for (let i = 2; i < p.pts.length; i += 2) {
      const x1 = p.pts[i - 2], y1 = p.pts[i - 1], x2 = p.pts[i], y2 = p.pts[i + 1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1e-9) continue;
      let ang = Math.atan2(y2 - y1, x2 - x1) / DEG; if (ang < 0) ang += 180; if (ang >= 180) ang -= 180;
      out.push({ x1, y1, x2, y2, len, ang, pen, lw: p.lw, path: pi, curved: p.curved });
    }
  });
  segCache.set(prims, out);
  return out;
}

/**
 * Dominant drawing orientation (deg, in (-45, 45]): the angle the walls are rotated by on the page.
 * Length × width weighted histogram of segment angles modulo 90°, 0.1° bins, refined by a weighted mean.
 */
export function dominantAngle(segs) {
  const bins = new Float64Array(900);
  for (const s of segs) {
    if (s.curved) continue;
    const a = ((s.ang % 90) + 90) % 90;
    bins[Math.min(899, Math.round(a * 10) % 900)] += s.len * Math.max(s.lw, 0.1);
  }
  let best = 0;
  for (let i = 1; i < 900; i++) if (bins[i] > bins[best]) best = i;
  let sw = 0, sa = 0;
  for (let k = -5; k <= 5; k++) { const i = (best + k + 900) % 900; sw += bins[i]; sa += bins[i] * (best + k) / 10; }
  let ang = sw ? sa / sw : 0;
  if (ang > 45) ang -= 90;
  return Math.abs(ang) < 0.05 ? 0 : ang;
}

/**
 * Pens with statistics (scale-free, page units): total length, own orientation, fraction axis-aligned at that
 * orientation, H/V balance, and the nearest parallel-partner distance of every axis-aligned segment of the same pen
 * (for wall-thickness analysis).
 */
export function penStats(segs) {
  const by = new Map();
  for (const s of segs) {
    let st = by.get(s.pen);
    if (!st) by.set(s.pen, st = { pen: s.pen, lw: s.lw, color: s.pen.split('|')[1], dashed: s.pen.endsWith('dash'), n: 0, len: 0, axisLen: 0, curvedLen: 0, segs: [] });
    st.n++; st.len += s.len;
    if (s.curved) st.curvedLen += s.len; else st.segs.push(s);
  }
  for (const st of by.values()) {
    // the pen's own orientation (a hatch is "orthogonal" too, but only in one direction: see balance)
    const angle = dominantAngle(st.segs);
    st.angle = angle;
    const c = Math.cos(-angle * DEG), sn = Math.sin(-angle * DEG);
    const H = [], V = [];
    let hl = 0, vl = 0;
    for (const s of st.segs) {
      const d = Math.abs(((s.ang - angle) % 90 + 90) % 90);
      if (Math.min(d, 90 - d) >= 1) continue;
      st.axisLen += s.len;
      const ax = c * s.x1 - sn * s.y1, ay = sn * s.x1 + c * s.y1, bx = c * s.x2 - sn * s.y2, by2 = sn * s.x2 + c * s.y2;
      if (Math.abs(ax - bx) >= Math.abs(ay - by2)) { H.push({ k: (ay + by2) / 2, a: Math.min(ax, bx), b: Math.max(ax, bx), len: s.len }); hl += s.len; }
      else { V.push({ k: (ax + bx) / 2, a: Math.min(ay, by2), b: Math.max(ay, by2), len: s.len }); vl += s.len; }
    }
    st.pairs = [...nearestParallel(H), ...nearestParallel(V)]; // [{ d, len }] page units
    st.axisFrac = st.len ? st.axisLen / st.len : 0;
    st.balance = st.axisLen ? Math.min(hl, vl) / st.axisLen : 0;
    delete st.segs;
  }
  return [...by.values()];
}

/** For each segment: distance to the nearest other parallel segment that overlaps it by ≥ 50 % of the shorter. */
function nearestParallel(list) {
  list.sort((p, q) => p.k - q.k);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    let best = Infinity;
    for (const dir of [-1, 1]) {
      for (let j = i + dir; j >= 0 && j < list.length; j += dir) {
        const t = list[j];
        const d = Math.abs(t.k - s.k);
        if (d >= best) break;
        if (d < 1e-6) continue;
        const ov = Math.min(s.b, t.b) - Math.max(s.a, t.a);
        if (ov >= 0.5 * Math.min(s.b - s.a, t.b - t.a) && ov > 0) { best = d; break; }
      }
    }
    if (best < Infinity) out.push({ d: best, len: s.len });
  }
  return out;
}

/**
 * Circle fit (Kåsa) of a polyline; returns { cx, cy, r, sweep (deg), rms, a0, a1 (start/end angle, deg) } or null.
 */
export function fitArc(pts) {
  const n = pts.length / 2;
  if (n < 4) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += pts[2 * i]; sy += pts[2 * i + 1]; }
  const mx = sx / n, my = sy / n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (let i = 0; i < n; i++) {
    const u = pts[2 * i] - mx, v = pts[2 * i + 1] - my;
    suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const b1 = (suuu + suvv) / 2, b2 = (svvv + svuu) / 2;
  const uc = (b1 * svv - b2 * suv) / det, vc = (suu * b2 - suv * b1) / det;
  let cx = mx + uc, cy = my + vc;
  let r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  // geometric refinement (Gauss–Newton on the distances), removes the algebraic fit's bias on short arcs
  for (let it = 0; it < 12; it++) {
    let a11 = 0, a12 = 0, a13 = 0, a22 = 0, a23 = 0, a33 = 0, g1 = 0, g2 = 0, g3 = 0;
    for (let i = 0; i < n; i++) {
      const dx = cx - pts[2 * i], dy = cy - pts[2 * i + 1], d = Math.hypot(dx, dy) || 1e-12;
      const j1 = dx / d, j2 = dy / d, j3 = -1, res = d - r;
      a11 += j1 * j1; a12 += j1 * j2; a13 += j1 * j3; a22 += j2 * j2; a23 += j2 * j3; a33 += j3 * j3;
      g1 += j1 * res; g2 += j2 * res; g3 += j3 * res;
    }
    const D = a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33 - a23 * a13) + a13 * (a12 * a23 - a22 * a13);
    if (Math.abs(D) < 1e-18) break;
    const s1 = (g1 * (a22 * a33 - a23 * a23) - a12 * (g2 * a33 - a23 * g3) + a13 * (g2 * a23 - a22 * g3)) / D;
    const s2 = (a11 * (g2 * a33 - a23 * g3) - g1 * (a12 * a33 - a23 * a13) + a13 * (a12 * g3 - g2 * a13)) / D;
    const s3 = (a11 * (a22 * g3 - g2 * a23) - a12 * (a12 * g3 - g2 * a13) + g1 * (a12 * a23 - a22 * a13)) / D;
    cx -= s1; cy -= s2; r -= s3;
    if (Math.abs(s1) + Math.abs(s2) + Math.abs(s3) < 1e-9 * (1 + r)) break;
  }
  if (!(r > 0) || !Number.isFinite(cx + cy + r)) return null;
  let e = 0;
  for (let i = 0; i < n; i++) { const d = Math.hypot(pts[2 * i] - cx, pts[2 * i + 1] - cy) - r; e += d * d; }
  const rms = Math.sqrt(e / n);
  // sweep: accumulate signed angle steps
  let sweep = 0, prev = Math.atan2(pts[1] - cy, pts[0] - cx);
  const a0 = prev;
  for (let i = 1; i < n; i++) {
    const a = Math.atan2(pts[2 * i + 1] - cy, pts[2 * i] - cx);
    let d = a - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    sweep += d; prev = a;
  }
  return { cx, cy, r, rms, sweep: sweep / DEG, a0: a0 / DEG, a1: prev / DEG };
}

/**
 * Arcs drawn on the page (curved paths, or polylines of ≥ 5 points that fit a circle), in page units.
 * Each arc keeps its points (`pts`).
 */
export function arcsOf(prims, { excludePens = new Set(), joinGap = 2.5, maxPiece = 6 } = {}) {
  const key = joinGap + '|' + maxPiece;
  let c = arcCache.get(prims);
  if (!c) arcCache.set(prims, c = new Map());
  if (!c.has(key)) c.set(key, allArcs(prims, joinGap, maxPiece));
  return c.get(key).filter((a) => !excludePens.has(a.pen));
}

function allArcs(prims, joinGap, maxPiece) {
  const excludePens = new Set();
  const arcs = [];
  const tryFit = (pts, extra) => {
    const f = fitArc(pts);
    if (!f || f.r <= 0) return;
    if (f.rms > Math.max(0.035 * f.r, 0.05)) return;
    if (Math.abs(f.sweep) < 20) return;
    arcs.push({ ...f, ...extra, pts });
  };
  const pieces = [];
  prims.paths.forEach((p, pi) => {
    if (!p.stroke) return;
    const pen = penKey(p);
    if (excludePens.has(pen)) return;
    const dashed = !!(p.dash && p.dash.length && p.dash.some((d) => d > 0));
    if (p.curved || p.pts.length >= 10) tryFit(p.pts, { path: pi, pen, dashed });
    const n = p.pts.length, loop = Math.hypot(p.pts[0] - p.pts[n - 2], p.pts[1] - p.pts[n - 1]) < 1e-6;
    if (!p.curved && !p.closed && !loop && n / 2 <= maxPiece) pieces.push({ pi, pen, pts: p.pts });
  });
  // arcs drawn as separate short pieces (hand-dashed swings, exploded polylines): chain pieces of one pen whose
  // ends are within joinGap page units, then fit
  // hatch pens (hundreds of pieces nearly all in one direction) cannot form arcs: leave them out of the chaining
  const dirs = new Map();
  for (const q of pieces) {
    const n = q.pts.length, a = Math.round(((Math.atan2(q.pts[n - 1] - q.pts[1], q.pts[n - 2] - q.pts[0]) / DEG) + 360) % 180 / 2);
    let h = dirs.get(q.pen); if (!h) dirs.set(q.pen, h = { n: 0, bins: new Map() });
    h.n++; h.bins.set(a, (h.bins.get(a) || 0) + 1);
  }
  const hatch = new Set([...dirs].filter(([, h]) => h.n >= 200 && Math.max(...h.bins.values()) >= 0.85 * h.n).map(([pen]) => pen));
  if (hatch.size) for (let i = pieces.length - 1; i >= 0; i--) if (hatch.has(pieces[i].pen)) pieces.splice(i, 1);
  const cell = joinGap, grid = new Map();
  const keyOf = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
  const ends = (q) => [[q.pts[0], q.pts[1]], [q.pts[q.pts.length - 2], q.pts[q.pts.length - 1]]];
  pieces.forEach((q, n) => ends(q).forEach(([x, y], e) => { const k = keyOf(x, y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([n, e]); }));
  const used = new Uint8Array(pieces.length);
  // a piece may continue the chain only if it turns gently, the same way as the chain so far (an arc does;
  // hatch zig-zags and glyph strokes do not)
  const dirAt = (pts, atEnd) => {
    const n = pts.length;
    return atEnd ? [pts[n - 2] - pts[n - 4], pts[n - 1] - pts[n - 3]] : [pts[0] - pts[2], pts[1] - pts[3]];
  };
  const turn = (u, v) => Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
  const findNext = (chain, dir, pen, sign) => {
    const atEnd = dir > 0;
    const x = atEnd ? chain[chain.length - 2] : chain[0], y = atEnd ? chain[chain.length - 1] : chain[1];
    const d0 = dirAt(chain, atEnd);
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let best = null, bd = joinGap;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [n, e] of grid.get((cx + a) + ',' + (cy + b)) || []) {
      if (used[n] || pieces[n].pen !== pen) continue;
      const q = pieces[n].pts;
      if (q.length < 4) continue;
      const [px, py] = ends(pieces[n])[e];
      const d = Math.hypot(px - x, py - y);
      if (d >= bd) continue;
      // direction of the piece leaving the joint (away from the chain)
      const d1 = e === 0 ? [q[2] - q[0], q[3] - q[1]] : [q[q.length - 4] - q[q.length - 2], q[q.length - 3] - q[q.length - 1]];
      const t = turn(d0, d1);
      if (Math.abs(t) > 45 * DEG || Math.abs(t) < 1 * DEG) continue; // arcs turn at every joint; straight dashes do not
      bd = d; best = [n, e, t];
    }
    return best;
  };
  for (let n0 = 0; n0 < pieces.length; n0++) {
    if (used[n0]) continue;
    used[n0] = 1;
    let chain = pieces[n0].pts.slice(), count = 1;
    for (const dir of [1, -1]) {
      let sign = 0;
      for (;;) {
        const nx = findNext(chain, dir, pieces[n0].pen, sign * dir);
        if (!nx) break;
        const [n, e, t] = nx; used[n] = 1; count++;
        if (Math.abs(t) > 1e-3 && !sign) sign = Math.sign(t) * dir;
        let pts = pieces[n].pts.slice();
        if ((dir > 0 && e === 1) || (dir < 0 && e === 0)) { const r = []; for (let i = pts.length - 2; i >= 0; i -= 2) r.push(pts[i], pts[i + 1]); pts = r; }
        chain = dir > 0 ? chain.concat(pts) : pts.concat(chain);
      }
    }
    if (count >= 3 && chain.length >= 10) tryFit(chain, { path: pieces[n0].pi, pen: pieces[n0].pen, dashed: true, joined: count });
  }
  return arcs;
}

/** Weighted median of [{ v, w }]. */
export function wMedian(list) {
  if (!list.length) return NaN;
  const s = list.slice().sort((a, b) => a.v - b.v);
  const tot = s.reduce((t, e) => t + e.w, 0);
  let acc = 0;
  for (const e of s) { acc += e.w; if (acc >= tot / 2) return e.v; }
  return s[s.length - 1].v;
}

/** Cluster sorted numbers with a relative tolerance; returns [{ v (weighted mean), w, n }] sorted by weight desc. */
export function clusters(values, rel = 0.06, abs = 0) {
  const s = values.slice().sort((a, b) => a.v - b.v);
  const out = [];
  let cur = null;
  for (const e of s) {
    if (cur && e.v - cur.last <= Math.max(abs, rel * cur.last)) { cur.sw += e.w; cur.sv += e.v * e.w; cur.n++; cur.last = e.v; }
    else { cur = { sw: e.w, sv: e.v * e.w, n: 1, last: e.v }; out.push(cur); }
  }
  return out.map((c) => ({ v: c.sv / c.sw, w: c.sw, n: c.n })).sort((a, b) => b.w - a.w);
}
