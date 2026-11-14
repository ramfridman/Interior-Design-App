/**
 * detectScale — candidate drawing scales with confidence. Page units are PDF points; a "1:S" scale means
 * cmPerUnit = S × 2.54 / 72 (true paper size assumed — a PDF printed "fit to page" breaks that, which is why the
 * user can always override with a known distance).
 *
 * Sources, strongest first:
 *   user        — { cmPerUnit } or { points: [[x1, y1], [x2, y2]], cm } (two picked points N cm apart)
 *   text        — a stated scale: "1:100", "M 1:50", "SCALE 1/100", "קנ"מ 1:50"
 *   dimensions  — numbers written along thin lines (dimension strings): value / line length, clustered
 *   geometry    — no usable text (e.g. text drawn as vector strokes): each standard scale is tried and scored by how
 *                 plausible the result is: door swings 70–100 cm, a wall pen paired at 7–40 cm, a building size of
 *                 3–100 m. A best guess, marked as such.
 */
import { PT_CM, arcsOf, penStats, segmentsOf, clusters, DEG } from './prep.js';
import { scoreWallPens, pickWallPens } from './walls.js';

export const STANDARD_SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 500, 1000];
/** Imperial architectural scales (3" = 1', 1" = 1', ½" = 1', ¼" = 1', ⅛" = 1', 1/16" = 1'): dimensions on an inch module. */
export const IMPERIAL_SCALES = [4, 12, 24, 48, 96, 192];

export const scaleFromPoints = (p1, p2, cm) => ({ cmPerUnit: cm / Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), source: 'user', confidence: 1, ratio: null, label: `${cm} cm between two points` });

const label = (S) => `1:${S}`;
const toCand = (S, source, confidence, evidence) => ({ cmPerUnit: S * PT_CM, ratio: S, label: label(S), source, confidence: +confidence.toFixed(2), evidence });

const SCALE_RE = /(?:^|[^\d.,/])1\s*[:/]\s*(\d{1,4}(?:[.,]\d+)?)(?!\d)/;
const KEYWORD_RE = /(scale|m\s*1|קנ["״'׳]?מ|קנה\s*מידה|massstab|échelle|escala)/i;

function fromText(texts) {
  const found = new Map();
  // join items on one line so "קנ"מ" "1:100" split into pieces still match
  const lines = [];
  for (const t of texts) {
    const l = lines.find((q) => Math.abs(q.y - t.y) < Math.max(2, 0.5 * t.h) && Math.abs(q.angle - t.angle) < 2 && t.x - (q.x1) < 3 * t.h && t.x + t.w > q.x - 3 * t.h);
    if (l) { l.str += ' ' + t.str; l.x = Math.min(l.x, t.x); l.x1 = Math.max(l.x1, t.x + t.w); }
    else lines.push({ str: t.str, x: t.x, x1: t.x + t.w, y: t.y, h: t.h, angle: t.angle });
  }
  for (const l of [...texts.map((t) => ({ str: t.str, x: t.x, y: t.y })), ...lines]) {
    const m = l.str.match(SCALE_RE);
    if (!m) continue;
    const S = parseFloat(m[1].replace(',', '.'));
    if (!(S >= 1 && S <= 5000)) continue;
    const kw = KEYWORD_RE.test(l.str);
    const bare = /^\s*(m\s*)?1\s*[:/]\s*\d/i.test(l.str) && l.str.trim().length <= 12;
    if (!kw && !bare && /\//.test(m[0])) continue; // "1/100" without a keyword is too ambiguous (dates, fractions)
    const e = found.get(S) || { S, n: 0, kw: false, where: [] };
    e.n++; e.kw ||= kw; if (e.where.length < 3) e.where.push({ x: l.x, y: l.y, text: l.str });
    found.set(S, e);
  }
  const list = [...found.values()];
  return list.map((e) => toCand(e.S, 'text', (e.kw ? 0.9 : 0.75) * (list.length > 1 ? 0.8 : 1), { mentions: e.n, where: e.where }));
}

const NUM_RE = /^\s*(\d{1,5})(?:[.,](\d{1,2}))?\s*$/;

function fromDimensions(prims) {
  const nums = [];
  for (const t of prims.texts) {
    const m = t.str.match(NUM_RE);
    if (!m) continue;
    const v = m[2] ? parseFloat(m[1] + '.' + m[2]) : parseInt(m[1], 10);
    if (!(v > 0)) continue;
    nums.push({ ...t, v, dec: !!m[2] });
  }
  if (nums.length < 3) return [];
  const segs = segmentsOf(prims).filter((s) => !s.curved && s.len > 2);
  const ratios = [];
  for (const t of nums) {
    const a = t.angle * DEG, ux = Math.cos(a), uy = Math.sin(a);
    const cx = t.x + ux * t.w / 2 + uy * t.h * 0.4, cy = t.y + uy * t.w / 2 - ux * t.h * 0.4; // text centre (y down)
    let best = null;
    for (const s of segs) {
      const sa = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      if (Math.abs(Math.sin(sa - a)) > 0.05) continue;
      if (s.len < t.w * 0.9) continue;
      const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
      const along = (mx - cx) * ux + (my - cy) * uy, perp = Math.abs(-(mx - cx) * uy + (my - cy) * ux);
      if (Math.abs(along) > s.len * 0.25 || perp > 2.5 * t.h) continue;
      const d = perp + Math.abs(along) * 0.2;
      if (!best || d < best.d) best = { d, len: s.len };
    }
    if (!best) continue;
    // a value is cm, or metres when written with decimals, or mm when large — keep every reading, the clusters decide
    const readings = t.dec ? [t.v * 100] : [t.v, t.v / 10];
    for (const cm of readings) ratios.push({ v: cm / best.len, w: 1 });
  }
  const cl = clusters(ratios, 0.02).filter((c) => c.n >= 3);
  if (!cl.length) return [];
  // the same numbers read as cm or as mm give two equally consistent clusters: the one whose scale makes the wall
  // lines a plausible wall thickness wins a tie
  const pre = penStats(segmentsOf(prims));
  for (const c of cl) { const best = pickWallPens(scoreWallPens(prims, c.v, {}, pre))[0]; c.pl = best ? best.score : 0; }
  cl.sort((a, b) => (Math.abs(a.n - b.n) <= 1 ? b.pl - a.pl : b.n - a.n));
  const tot = ratios.length / 2 || 1;
  return cl.slice(0, 2).map((c) => {
    const S = c.v / PT_CM;
    const std = STANDARD_SCALES.find((q) => Math.abs(q - S) / q < 0.015);
    const conf = Math.min(0.95, 0.45 + 0.08 * c.n) * Math.min(1, c.n / tot + 0.3);
    return std ? { ...toCand(std, 'dimensions', conf, { matches: c.n }), measured: c.v }
      : { cmPerUnit: c.v, ratio: null, label: `measured ${(S).toFixed(1)}`, source: 'dimensions', confidence: +(conf * 0.9).toFixed(2), evidence: { matches: c.n } };
  });
}

function fromGeometry(prims) {
  const pre = penStats(segmentsOf(prims));
  const arcs = arcsOf(prims).filter((a) => Math.abs(a.sweep) >= 70 && Math.abs(a.sweep) <= 110 && a.r > 0);
  const radii = clusters(arcs.map((a) => ({ v: a.r, w: 1 })), 0.04);
  const out = [], geoCache = new Map();
  for (const S of [...STANDARD_SCALES, ...IMPERIAL_SCALES]) {
    const k = S * PT_CM;
    const scored = scoreWallPens(prims, k, {}, pre);
    const pens = pickWallPens(scored);
    if (!pens.length) continue;
    const wall = pens[0];
    const tOk = wall.thickness && wall.thickness >= 8 && wall.thickness <= 35 ? 1 : 0.3;
    // doors: radii clusters whose size at this scale is a door leaf
    let doorW = 0, doorN = 0;
    for (const c of radii) { const cm = c.v * k; if (cm >= 60 && cm <= 125 && c.n > doorN) { doorN = c.n; doorW = cm; } }
    const doorScore = doorN >= 2 ? (doorW >= 70 && doorW <= 105 ? 1 : 0.7) : doorN === 1 ? 0.6 : 0.35;
    // building extent of the wall pen
    const geo = penGeometry(prims, wall.pen, geoCache);
    const ext = geo.extent * k;
    const extScore = ext >= 300 && ext <= 10000 ? 1 : 0.2;
    // module test: at the right scale the wall edges sit on a building module (5 cm, or 1 inch for imperial scales)
    const module = IMPERIAL_SCALES.includes(S) ? 2.54 : 5;
    const grid = moduleFit(geo, k, module);
    const score = wall.score * tOk * doorScore * extScore * (0.1 + grid);
    out.push({ S, score, ev: { moduleFit: +grid.toFixed(2), module, wallPen: wall.pen, wallThickness: wall.thickness && +wall.thickness.toFixed(1), doors: doorN, doorWidth: +doorW.toFixed(1), extent: Math.round(ext) } });
  }
  out.sort((a, b) => b.score - a.score);
  if (!out.length || out[0].score <= 0) return [];
  // confidence: how clearly the best beats the runner-up (never above 0.7 — this is inference, not a stated scale)
  return out.slice(0, 3).map((e, i) => {
    const other = i === 0 ? (out[1]?.score || 0) : out[0].score;
    return toCand(e.S, 'geometry', 0.7 * e.score / (e.score + other) * (e.ev.doors >= 2 ? 1 : 0.8), e.ev);
  });
}

/** Axis-aligned edge coordinates and extent of one pen (page units), computed once per pen. */
function penGeometry(prims, pen, cache) {
  if (cache.has(pen)) return cache.get(pen);
  const xs = [], ys = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segmentsOf(prims)) {
    if (s.pen !== pen) continue;
    x0 = Math.min(x0, s.x1, s.x2); x1 = Math.max(x1, s.x1, s.x2); y0 = Math.min(y0, s.y1, s.y2); y1 = Math.max(y1, s.y1, s.y2);
    if (s.curved) continue;
    if (Math.abs(s.y2 - s.y1) < 1e-3 * s.len + 1e-6) ys.push(s.y1); else if (Math.abs(s.x2 - s.x1) < 1e-3 * s.len + 1e-6) xs.push(s.x1);
  }
  const g = { xs: xs.sort((a, b) => a - b), ys: ys.sort((a, b) => a - b), extent: Number.isFinite(x0) ? Math.max(x1 - x0, y1 - y0) : 0 };
  cache.set(pen, g);
  return g;
}

/** Share of a pen's consecutive edge spacings that land on the building module at this scale, above chance. */
function moduleFit(geo, k, module) {
  const fit = (vals) => {
    const u = []; for (const v0 of vals) { const v = v0 * k; if (!u.length || v - u[u.length - 1] > 0.3) u.push(v); }
    if (u.length < 4) return null;
    // consecutive spacings (wall thicknesses, room sizes) — independent of where each drawing on the sheet starts
    const tol = module * 0.1;
    let on = 0, n = 0;
    for (let i = 1; i < u.length; i++) {
      const d = u[i] - u[i - 1];
      if (d > 3000) continue; // jump to another drawing
      n++; const r = d % module; if (Math.min(r, module - r) <= tol) on++;
    }
    return n ? { f: on / n, n } : null;
  };
  const parts = [fit(geo.xs), fit(geo.ys)].filter(Boolean);
  if (!parts.length) return 0.5;
  const f = parts.reduce((t, p) => t + p.f * p.n, 0) / parts.reduce((t, p) => t + p.n, 0);
  return Math.max(0, (f - 0.2) / 0.8);
}

/**
 * @param prims  readPdf() output (texts may be empty: many CAD PDFs draw text as strokes)
 * @param opts   { cmPerUnit } | { points: [[x, y], [x, y]], cm } | { ratio: 100 } — explicit override, used as is
 * @returns { best, candidates: [{ cmPerUnit, ratio, label, source, confidence, evidence }] }
 */
export function detectScale(prims, opts = {}) {
  const cands = [];
  if (opts.cmPerUnit) cands.push({ cmPerUnit: opts.cmPerUnit, ratio: null, label: 'given', source: 'user', confidence: 1 });
  if (opts.points && opts.cm) cands.push(scaleFromPoints(opts.points[0], opts.points[1], opts.cm));
  if (opts.ratio) cands.push(toCand(opts.ratio, 'user', 1, {}));
  if (!cands.length) {
    const t = fromText(prims.texts || []), d = fromDimensions(prims);
    cands.push(...t, ...d);
    // text and dimensions agreeing confirm each other
    for (const a of t) if (d.some((b) => b.ratio === a.ratio)) a.confidence = Math.min(0.99, a.confidence + 0.08);
    if (!t.length && !d.length) cands.push(...fromGeometry(prims));
    else if (Math.max(...cands.map((c) => c.confidence)) < 0.6) cands.push(...fromGeometry(prims));
  }
  cands.sort((a, b) => b.confidence - a.confidence);
  return { best: cands[0] || null, candidates: cands };
}

