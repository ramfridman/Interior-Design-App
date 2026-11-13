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

/** All straight stroked segments: { x1, y1, x2, y2, len, ang (0..180 deg), pen, lw, path, curved }. */
export function segmentsOf(prims) {
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
  const cx = mx + uc, cy = my + vc;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
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
 * Consecutive pieces of the same PDF path are joined first (CAD exports often split a quarter circle).
 */
export function arcsOf(prims, { excludePens = new Set() } = {}) {
  const arcs = [];
  prims.paths.forEach((p, pi) => {
    if (!p.stroke || excludePens.has(penKey(p))) return;
    if (!p.curved && p.pts.length < 10) return;
    const f = fitArc(p.pts);
    if (!f || f.r <= 0) return;
    if (f.rms > Math.max(0.03 * f.r, 0.05)) return;
    if (Math.abs(f.sweep) < 20) return;
    arcs.push({ ...f, path: pi, pen: penKey(p), dashed: !!(p.dash && p.dash.length && p.dash.some((d) => d > 0)) });
  });
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
