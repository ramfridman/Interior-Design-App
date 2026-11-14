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
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 400000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (mask[y * w + x]) pts.push(x, y);
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
  // "angle" = rotation that straightens the drawing; the drawing's tilt is its negative
  return { angle: -angle, straighten: angle, confidence: +Math.min(1, (bs / med - 1) / 2).toFixed(2) };
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
 * @param thickMinPx  bars at least this thick become filled rectangles (solid walls)
 */
export function imageToPrims(mask, w, h, { minRun = 8, thickMinPx = Infinity } = {}) {
  const paths = [];
  const scan = (horiz) => {
    const A = horiz ? h : w, B = horiz ? w : h; // A = rows (for horizontal strokes), B = along
    let active = []; // groups: { a0, b0, b1, rows }
    const close = (g) => {
      const t = g.rows, k = g.a0 + t / 2, b0 = g.b0, b1 = g.b1;
      if (b1 - b0 < minRun || b1 - b0 < 2 * t) return; // not a line along this direction
      if (t >= thickMinPx) {
        const pts = horiz ? [b0, g.a0, b1, g.a0, b1, g.a0 + t, b0, g.a0 + t, b0, g.a0] : [g.a0, b0, g.a0 + t, b0, g.a0 + t, b1, g.a0, b1, g.a0, b0];
        paths.push({ pts, closed: true, stroke: false, fill: true, evenOdd: false, lw: 0, color: '#000000', fillColor: '#000000', dash: [], curved: false });
      } else {
        const pts = horiz ? [b0, k, b1, k] : [k, b0, k, b1];
        paths.push({ pts, closed: false, stroke: true, fill: false, evenOdd: false, lw: t, color: '#000000', fillColor: '#000000', dash: [], curved: false });
      }
    };
    for (let a = 0; a < A; a++) {
      const runs = [];
      for (let b = 0; b < B;) {
        const on = horiz ? mask[a * w + b] : mask[b * w + a];
        if (!on) { b++; continue; }
        let e = b + 1;
        while (e < B && (horiz ? mask[a * w + e] : mask[e * w + a])) e++;
        if (e - b >= minRun) runs.push([b, e]);
        b = e;
      }
      const next = [];
      for (const [b0, b1] of runs) {
        const g = active.find((q) => !q.taken && Math.abs(q.b0 - b0) <= 2 && Math.abs(q.b1 - b1) <= 2);
        if (g) { g.taken = true; g.rows++; g.b0 = Math.min(g.b0, b0); g.b1 = Math.max(g.b1, b1); next.push(g); }
        else next.push({ a0: a, b0, b1, rows: 1, taken: true });
      }
      for (const g of active) if (!g.taken) close(g);
      active = next.map((g) => { g.taken = false; return g; });
    }
    for (const g of active) close(g);
  };
  scan(true); scan(false);
  // stroke widths, quantised to whole pixels so pens group (run thickness jitters by ±1 px)
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
    const walls = detectWalls(prims, { cmPerUnit: scale.cmPerPx }, { mergeTol: Math.max(0.6, 1.5 * scale.cmPerPx), ...(opts.walls || {}) });
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
