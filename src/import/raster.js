/**
 * readImage — pieces a guided-tracing UI needs for raster sketches (PNG / JPG / a scanned PDF page rendered to
 * pixels). Raster detection is NOT exact: every proposal from here is marked low confidence and is meant to be
 * corrected by the user on top of the image.
 *
 *   readImage(image, { cmPerPx?, points?: [[x, y], [x, y]], cm?, deskew?: true, propose?: true, threshold? })
 *     image : { width, height, data } — ImageData-like (RGBA) or { width, height, gray: Uint8Array }
 *   → { width, height, threshold, deskew: { angle (deg, the drawing's tilt), confidence },
 *       scale: { cmPerPx } | null, strokes: { thin, thick } (px), prims (vector-like strokes, deskewed px),
 *       toImage: [a..f] (deskewed px → original image px), proposal (normalise() output, or null), warnings }
 *
 * Method: ink = dark, unsaturated pixels (Otsu threshold on luminance; coloured fills and lines are not ink);
 * deskew = the angle that makes the row / column ink profiles sharpest (orthogonal drawings have peaked profiles);
 * strokes = run-length analysis: horizontal / vertical ink runs grouped across neighbouring rows / columns into
 * line pieces whose width is their run thickness; thick bars (≥ the minimum wall thickness at the given scale)
 * become filled rectangles (poché walls), narrower ones become stroked lines with that width. The vector engine
 * (detectWalls / detectOpenings) then runs on those pieces. Swing arcs are not traced in raster, so doors come out
 * as plain passages at best.
 */
import { detectWalls } from './walls.js';
import { detectOpenings } from './openings.js';
import { normalise } from './normalise.js';
import { DEG } from './prep.js';

export const scaleFromImagePoints = (p1, p2, cm) => ({ cmPerPx: cm / Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), source: 'user', confidence: 1 });

/** Luminance (0..255) per pixel; coloured pixels (saturation) are pushed to white so they never count as ink. */
export function toGray(image) {
  const { width: w, height: h } = image;
  if (image.gray) return image.gray;
  const d = image.data, g = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const r = d[p], gg = d[p + 1], b = d[p + 2], a = d[p + 3] == null ? 255 : d[p + 3];
    const lum = 0.299 * r + 0.587 * gg + 0.114 * b;
    const sat = Math.max(r, gg, b) - Math.min(r, gg, b);
    const v = sat > 80 ? 255 : lum;
    g[i] = Math.round(255 - (255 - v) * a / 255);
  }
  return g;
}

export function otsu(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

/** Deskew estimate (deg): maximise the sharpness of ink projection profiles over ±maxAngle. */
export function estimateDeskew(mask, w, h, { maxAngle = 10 } = {}) {
  const pts = [];
  // sample ink pixels pseudo-randomly (a regular sampling grid would itself peak at 0°)
  let ink = 0; for (let i = 0; i < w * h; i++) ink += mask[i];
  const keep = Math.min(1, 60000 / Math.max(1, ink));
  let seed = 12345;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    seed = (seed * 1103515245 + 12345) >>> 0;
    if (seed / 4294967296 < keep) pts.push(i % w, (i / w) | 0);
  }
  const n = pts.length / 2;
  if (n < 50) return { angle: 0, confidence: 0 };
  const cx = w / 2, cy = h / 2, diag = Math.ceil(Math.hypot(w, h)) + 4;
  const score = (deg) => {
    const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
    const rows = new Float64Array(diag), cols = new Float64Array(diag);
    for (let i = 0; i < n; i++) {
      const x = pts[2 * i] - cx, y = pts[2 * i + 1] - cy;
      const X = c * x + s * y, Y = -s * x + c * y;
      rows[(Y + diag / 2) | 0]++; cols[(X + diag / 2) | 0]++;
    }
    let e = 0; for (let i = 0; i < diag; i++) e += rows[i] * rows[i] + cols[i] * cols[i];
    return e;
  };
  let best = 0, bs = -1;
  const scores = [];
  for (let a = -maxAngle; a <= maxAngle + 1e-9; a += 0.5) { const v = score(a); scores.push(v); if (v > bs) { bs = v; best = a; } }
  for (let a = best - 0.5; a <= best + 0.5 + 1e-9; a += 0.05) { const v = score(a); if (v > bs) { bs = v; best = a; } }
  const sorted = scores.slice().sort((p, q) => p - q), med = sorted[sorted.length >> 1];
  const angle = Math.abs(best) < 0.05 ? 0 : +best.toFixed(2);
  // angle = the drawing's tilt, clockwise on screen (y down), in degrees; it is undone by turning the image back
  return { angle, straighten: angle, confidence: +Math.min(1, (bs / med - 1) / 2).toFixed(2) };
}

function rotateMask(mask, w, h, deg) {
  if (!deg) return { mask, w, h, toImage: [1, 0, 0, 1, 0, 0] };
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  const W = Math.ceil(Math.abs(w * c) + Math.abs(h * s)), H = Math.ceil(Math.abs(w * s) + Math.abs(h * c));
  const out = new Uint8Array(W * H);
  const cx = w / 2, cy = h / 2, CX = W / 2, CY = H / 2;
  // inverse map: output (X, Y) -> input (x, y) = R(-deg) (X - CX, Y - CY) + (cx, cy)
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const dx = X - CX, dy = Y - CY;
    const x = Math.round(c * dx + s * dy + cx), y = Math.round(-s * dx + c * dy + cy);
    if (x >= 0 && y >= 0 && x < w && y < h) out[Y * W + X] = mask[y * w + x];
  }
  // toImage: deskewed px -> original px
  return { mask: out, w: W, h: H, toImage: [c, -s, s, c, cx - c * CX - s * CY, cy + s * CX - c * CY] };
}

/**
 * Run-length strokes → vector-like primitives (page units = px). Horizontal and vertical pieces only.
 * For horizontal strokes every ink pixel gets the length of the vertical ink run through it (its stroke thickness);
 * the pixels at the middle of their vertical run form the stroke's centre line. Centre pixels are chained along the
 * row (bridging crossings of other strokes, up to `bridge` px) and split where the thickness changes; each chain
 * becomes a line of that width — or a filled rectangle when it is at least `thickMinPx` thick (solid walls).
 * Vertical strokes: the same with rows and columns swapped.
 */
export function imageToPrims(mask, w, h, { minRun = 8, thickMinPx = Infinity, maxStroke = 64, bridge = 4 } = {}) {
  const paths = [];
  const scan = (horiz) => {
    // thickness across the stroke direction: horizontal strokes -> vertical runs
    const A = horiz ? h : w, B = horiz ? w : h; // A: across index, B: along index
    const at = horiz ? (a, b) => mask[a * w + b] : (a, b) => mask[b * w + a];
    const T = new Uint16Array(w * h), C = new Uint8Array(w * h); // thickness, is-centre
    const id = horiz ? (a, b) => a * w + b : (a, b) => b * w + a;
    for (let b = 0; b < B; b++) for (let a = 0; a < A;) {
      if (!at(a, b)) { a++; continue; }
      let e = a + 1; while (e < A && at(e, b)) e++;
      const t = e - a;
      for (let q = a; q < e; q++) T[id(q, b)] = t;
      if (t <= maxStroke) C[id(a + ((t - 1) >> 1), b)] = 1;
      a = e;
    }
    for (let a = 0; a < A; a++) {
      let b = 0;
      while (b < B) {
        if (!C[id(a, b)]) { b++; continue; }
        // chain centre pixels along the row, bridging short interruptions
        const ts = [];
        let e = b, last = b;
        while (e < B) {
          if (C[id(a, e)]) { ts.push(T[id(a, e)]); last = e; e++; continue; }
          let k = e; while (k < B && k - last <= bridge && !C[id(a, k)]) k++;
          if (k < B && k - last <= bridge && C[id(a, k)]) { e = k; continue; }
          break;
        }
        emit(horiz, a, b, last + 1, ts);
        b = last + 1;
      }
    }
  };
  const emit = (horiz, a, b0, b1, ts) => {
    // split where the thickness changes clearly (a thin line continuing a thick one)
    let start = 0;
    const flush = (i0, i1) => {
      if (i1 - i0 < minRun) return;
      const seg = ts.slice(i0, i1).sort((p, q) => p - q), t = seg[seg.length >> 1];
      if (i1 - i0 < 2 * t) return;
      const k = a + 0.5, x0 = b0 + i0, x1 = b0 + i1;
      if (t >= thickMinPx) {
        const lo = a - ((t - 1) >> 1), hi = lo + t;
        const pts = horiz ? [x0, lo, x1, lo, x1, hi, x0, hi, x0, lo] : [lo, x0, hi, x0, hi, x1, lo, x1, lo, x0];
        paths.push({ pts, closed: true, stroke: false, fill: true, evenOdd: false, lw: 0, color: '#000000', fillColor: '#000000', dash: [], curved: false });
      } else {
        const off = (t % 2 === 0) ? 0.5 : 0; // even thickness: the centre lies between two pixel rows
        const kk = k + off;
        const pts = horiz ? [x0, kk, x1, kk] : [kk, x0, kk, x1];
        paths.push({ pts, closed: false, stroke: true, fill: false, evenOdd: false, lw: t, color: '#000000', fillColor: '#000000', dash: [], curved: false });
      }
    };
    let med = ts[0];
    for (let i = 1; i <= ts.length; i++) {
      if (i === ts.length) { flush(start, i); break; }
      const t = ts[i];
      if (Math.abs(t - med) > Math.max(1, 0.4 * med)) {
        // ignore single-pixel spikes (crossings)
        if (i + 1 < ts.length && Math.abs(ts[i + 1] - med) <= Math.max(1, 0.4 * med)) continue;
        flush(start, i); start = i; med = t;
      } else if (i - start < 8) med = ts.slice(start, i + 1).sort((p, q) => p - q)[(i - start + 1) >> 1];
    }
  };
  scan(true); scan(false);
  // stroke widths jitter by ±1 px with sub-pixel position: a width next to a much more common width joins it
  const strokes = paths.filter((p) => p.stroke);
  const hist = new Map();
  for (const p of strokes) hist.set(p.lw, (hist.get(p.lw) || 0) + Math.abs(p.pts[2] - p.pts[0]) + Math.abs(p.pts[3] - p.pts[1]));
  const map = new Map();
  for (const [t, L] of hist) {
    let to = t;
    for (const d of [-1, 1]) { const L2 = hist.get(t + d) || 0; if (L2 > 3 * L && L2 > (hist.get(to) || 0)) to = t + d; }
    map.set(t, to);
  }
  for (const p of strokes) { p.rawWidth = p.lw; p.lw = map.get(p.lw); }
  return { pageBox: { w, h }, units: 'px', paths, texts: [], images: [] };
}

export function readImage(image, opts = {}) {
  const w = image.width, h = image.height;
  const warnings = [{ code: 'raster', text: 'Raster image: walls are a best-effort proposal (low confidence) — check every wall against the image.', where: null }];
  const gray = toGray(image);
  const threshold = opts.threshold ?? Math.min(200, otsu(gray));
  const mask0 = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask0[i] = gray[i] <= threshold ? 1 : 0;
  const desk = opts.deskew === false ? { angle: 0, straighten: 0, confidence: 0 } : estimateDeskew(mask0, w, h);
  const rot = rotateMask(mask0, w, h, -(desk.straighten || 0));
  let scale = null;
  if (opts.cmPerPx) scale = { cmPerPx: opts.cmPerPx, source: 'user', confidence: 1 };
  else if (opts.points && opts.cm) scale = scaleFromImagePoints(opts.points[0], opts.points[1], opts.cm);
  const minT = (opts.walls && opts.walls.minThickness) || 7;
  const prims = imageToPrims(rot.mask, rot.w, rot.h, { thickMinPx: scale ? Math.max(4, minT / scale.cmPerPx) : Infinity });
  // stroke width statistics (px)
  const widths = prims.paths.filter((p) => p.stroke).map((p) => ({ v: p.lw, w: Math.hypot(p.pts[2] - p.pts[0], p.pts[3] - p.pts[1]) }));
  widths.sort((a, b) => a.v - b.v);
  const tot = widths.reduce((t, e) => t + e.w, 0);
  let acc = 0, thin = 1;
  for (const e of widths) { acc += e.w; if (acc >= tot / 2) { thin = e.v; break; } }
  const thick = widths.length ? widths.filter((e) => e.v > thin).reduce((m, e) => (e.w > (m.w || 0) ? e : m), {}).v || thin : thin;
  let proposal = null;
  if (scale && opts.propose !== false) {
    const walls = detectWalls(prims, { cmPerUnit: scale.cmPerPx }, { mergeTol: Math.max(0.6, 1.5 * scale.cmPerPx), fill: 'pairs', ...(opts.walls || {}) });
    walls.confidence = Math.min(0.4, walls.confidence * 0.5);
    const openings = detectOpenings(prims, walls, { cmPerUnit: scale.cmPerPx });
    for (const o of openings.openings) o.confidence = Math.min(0.3, o.confidence * 0.4);
    proposal = normalise({ walls, openings, scale: { cmPerUnit: scale.cmPerPx, confidence: scale.confidence }, pageBox: { w: rot.w, h: rot.h } },
      { rotate: opts.rotate || 0, mirror: opts.mirror || false });
    proposal.warnings.unshift(...warnings);
    proposal.lowConfidence = true;
    // plan cm <- deskewed px  composed with  deskewed px <- image px
    proposal.imageTransform = composeInverse(proposal.transform, rot.toImage);
  } else if (!scale) warnings.push({ code: 'no-scale', text: 'Pick two points a known distance apart to set the scale; then walls can be proposed.', where: null });
  return { width: w, height: h, threshold, deskew: desk, scale, strokes: { thin, thick }, prims, toImage: rot.toImage, proposal, warnings };
}

/** image px → plan cm, given deskewed px → plan cm (T) and deskewed px → image px (R). */
function composeInverse(T, R) {
  const det = R[0] * R[3] - R[1] * R[2];
  const inv = [R[3] / det, -R[1] / det, -R[2] / det, R[0] / det, (R[2] * R[5] - R[3] * R[4]) / det, (R[1] * R[4] - R[0] * R[5]) / det];
  // first inv (image -> deskewed), then T
  return [
    T[0] * inv[0] + T[2] * inv[1], T[1] * inv[0] + T[3] * inv[1],
    T[0] * inv[2] + T[2] * inv[3], T[1] * inv[2] + T[3] * inv[3],
    T[0] * inv[4] + T[2] * inv[5] + T[4], T[1] * inv[4] + T[3] * inv[5] + T[5],
  ];
}
