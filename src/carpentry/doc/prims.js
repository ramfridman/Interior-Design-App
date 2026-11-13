/**
 * Page primitives shared by the composer and both renderers.
 *
 * PageOp (page millimetres, origin top-left, y DOWN; colours are PALETTE tokens or '#rrggbb'):
 *   { t:'line', x1, y1, x2, y2, lw, color, dash? }
 *   { t:'rect', x, y, w, h, lw?, color?, fill?, dash? }            stroke only when `color` and `lw` are set
 *   { t:'poly', pts: [[x, y]…], close, lw?, color?, fill?, dash? }
 *   { t:'arc', cx, cy, r, a0, a1, lw, color, dash? }               degrees counter-clockwise AS SEEN, a0 → a1
 *   { t:'text', x, y, text, vis, size, font, color, align, w, dir, rot?, maxWidth? }
 *        (x, y) = anchor on the BASELINE; align 'left'|'center'|'right' is physical; size in pt; w = drawn width (mm)
 *        measured with the real font metrics; `vis` = the characters in left-to-right drawing order (bidi applied).
 *   { t:'drawing', id, kind, runId, scale, box: [x, y, w, h], ops: PageOp[] }   a shop drawing flattened to page mm
 * Any op may carry `role` and `unitId` (kept from the engine op) for styling / hit-testing.
 */
import { visualOrder, autoDir } from './bidi.js';
import { sanitize, textWidth, capHalf, PT, isVectorSymbol, symbolAdvance } from './metrics.js';
import { tr } from './strings.js';

/** Print palette: black / greys and one restrained accent. */
export const PALETTE = {
  ink: '#1c1c1a', ink2: '#454543', grey: '#7d7d79', rule: '#a9a9a4', hair: '#d4d4cf', tint: '#f1f1ee', paper: '#ffffff',
  accent: '#2d5c66', accentTint: '#e2ebed', accentMid: '#8fb0b6',
  fWall: '#d6d6d1', fPlinth: '#e4e4e0', fWorktop: '#c4c4bf', fAppliance: '#f3f3f1', fGlass: '#e4eef1', fSplash: '#ededea',
  fVoid: '#fafaf8', fSection: '#e2e2de', fBlind: '#f4f4f2', hatch: '#8d8d88',
};
/** Screen palette for drawingToSVG (theme-aware: CSS variables with currentColor-based fallbacks). */
export const SCREEN_PALETTE = {
  ink: 'var(--carp-ink, currentColor)', ink2: 'var(--carp-ink2, currentColor)', grey: 'var(--carp-muted, currentColor)',
  rule: 'var(--carp-rule, currentColor)', hair: 'var(--carp-hair, currentColor)', tint: 'var(--carp-tint, rgba(128,128,128,.08))',
  paper: 'var(--carp-paper, transparent)', accent: 'var(--carp-accent, #3d7c87)', accentTint: 'var(--carp-accent-tint, rgba(61,124,135,.15))', accentMid: 'var(--carp-accent, #3d7c87)',
  fWall: 'var(--carp-fill-wall, rgba(128,128,128,.30))', fPlinth: 'var(--carp-fill-plinth, rgba(128,128,128,.16))', fWorktop: 'var(--carp-fill-worktop, rgba(128,128,128,.38))',
  fAppliance: 'var(--carp-fill-appliance, rgba(128,128,128,.07))', fGlass: 'var(--carp-fill-glass, rgba(90,160,190,.18))', fSplash: 'var(--carp-fill-splash, rgba(128,128,128,.10))',
  fVoid: 'var(--carp-fill-void, rgba(128,128,128,.04))', fSection: 'var(--carp-fill-section, rgba(128,128,128,.20))', fBlind: 'var(--carp-fill-blind, rgba(128,128,128,.06))',
  hatch: 'var(--carp-hatch, currentColor)',
};
/** Resolve a colour token with a palette. */
export const color = (c, pal = PALETTE) => (c == null ? null : pal[c] || c);

/** Dash patterns in mm. */
export const DASH = { dash: [1.8, 1.0], dot: [0.25, 0.8], center: [5, 1, 0.6, 1] };

/** Semantic engine fills → palette tokens + optional hatch { angle, gap, lw }. */
const FILLS = {
  wall: { fill: 'fWall', hatch: { gap: 1.2, lw: 0.09 } }, plinth: { fill: 'fPlinth' }, worktop: { fill: 'fWorktop' }, appliance: { fill: 'fAppliance' },
  glass: { fill: 'fGlass' }, blind: { fill: 'fBlind', hatch: { gap: 2.2, lw: 0.07 } }, splashback: { fill: 'fSplash', hatch: { gap: 0.9, lw: 0.06 } },
  void: { fill: 'fVoid' }, section: { fill: 'fSection' },
};

/** Text op (sanitised, measured, bidi-ordered). x, y = baseline anchor. */
export function textOp(x, y, text, { size = 9, font = 'regular', color: c = 'ink', align = 'left', dir = 'ltr', rot, maxWidth, role, unitId } = {}) {
  const s = sanitize(text).replace(/\n/g, ' ');
  const op = { t: 'text', x: r2(x), y: r2(y), text: s, vis: visualOrder(s, dir), size, font, color: c, align, w: r2(textWidth(s, size, font)), dir };
  if (rot) op.rot = rot;
  if (maxWidth) op.maxWidth = r2(maxWidth);
  if (role) op.role = role;
  if (unitId) op.unitId = unitId;
  if (Array.from(s).some(isVectorSymbol)) op.parts = symbolParts(op);
  return op;
}

/**
 * A text op whose string contains glyphs the font lacks (door-operation keys, circled numbers) is drawn as `parts`:
 * plain text segments + vector symbols at the exact advance positions. Renderers draw `parts` instead of the text.
 */
function symbolParts(op) {
  const a = ((op.rot || 0) * Math.PI) / 180, ux = Math.cos(a), uy = -Math.sin(a), vx = Math.sin(a), vy = Math.cos(a);
  const shift = op.align === 'right' ? op.w : op.align === 'center' ? op.w / 2 : 0;
  const x0 = op.x - ux * shift, y0 = op.y - uy * shift, em = op.size * PT;
  const P = (d, v) => [r2(x0 + ux * d + vx * v), r2(y0 + uy * d + vy * v)];
  const parts = [];
  let d = 0, seg = '', segD = 0;
  const flush = () => {
    if (seg.trim()) { const [px, py] = P(segD, 0); parts.push({ t: 'text', x: px, y: py, text: seg, vis: seg, size: op.size, font: op.font, color: op.color, align: 'left', w: r2(textWidth(seg, op.size, op.font)), dir: 'ltr', ...(op.rot ? { rot: op.rot } : {}) }); }
    seg = '';
  };
  for (const c of Array.from(op.vis)) {
    if (!isVectorSymbol(c)) { if (!seg) segD = d; seg += c; d += textWidth(c, op.size, op.font); continue; }
    flush();
    const w = symbolAdvance(c) * em;
    parts.push(...symbolOps(c, d, w, em, P, op));
    d += w;
  }
  flush();
  return parts;
}

/** Vector drawing of one symbol: local d (along the baseline) / v (down) in mm, through P(d, v) → page point. */
function symbolOps(c, d, w, em, P, op) {
  const h = 0.66 * em, mid = -0.36 * em, lw = r2(Math.max(0.1, em * 0.075)), col = op.color || 'ink';
  const L = (pts, close = false, fill) => ({ t: 'poly', pts: pts.map(([dd, v]) => P(d + dd * w, v)), close, lw, color: col, ...(fill ? { fill } : {}) });
  const circle = (r, cv) => { const pts = []; for (let i = 0; i <= 24; i++) { const t = (i / 24) * Math.PI * 2; pts.push([0.5 + (Math.cos(t) * r) / w, cv + Math.sin(t) * r]); } return L(pts); };
  const head = (tip, dirx) => L([[tip - dirx * 0.22, mid - 0.16 * em], [tip, mid], [tip - dirx * 0.22, mid + 0.16 * em]]);
  switch (c) {
    case '◁': return [L([[0.18, mid], [0.86, mid - h / 2], [0.86, mid + h / 2]], true)];
    case '△': return [L([[0.5, -h], [0.14, 0], [0.86, 0]], true)];
    case '▽': return [L([[0.14, -h], [0.86, -h], [0.5, 0]], true)];
    case '↔': return [L([[0.1, mid], [0.9, mid]]), head(0.1, -1), head(0.9, 1)];
    case '⇤': return [L([[0.1, mid - h / 2], [0.1, mid + h / 2]]), L([[0.14, mid], [0.9, mid]]), head(0.14, -1)];
    case '⇥': return [L([[0.9, mid - h / 2], [0.9, mid + h / 2]]), L([[0.1, mid], [0.86, mid]]), head(0.86, 1)];
    case 'Λ': return [L([[0.14, 0], [0.5, -h], [0.86, 0]])];
    case '≡': return [-0.16, -0.36, -0.56].map((k) => L([[0.12, k * em], [0.88, k * em]]));
    case '∿': { const pts = []; for (let i = 0; i <= 16; i++) pts.push([0.1 + (0.8 * i) / 16, mid - Math.sin((i / 16) * Math.PI * 2) * 0.18 * em]); return [L(pts)]; }
    case '○': return [circle(0.3 * em, mid)];
    default: {                                                       // circled number: circle + the plain digits
      const n = String(c.codePointAt(0) - 0x2460 + 1), size = op.size * (n.length > 1 ? 0.5 : 0.6);
      const [tx, ty] = P(d + w / 2, mid + (size * PT * 0.7) / 2);
      return [circle(0.43 * em, mid), { t: 'text', x: tx, y: ty, text: n, vis: n, size: r2(size), font: 'medium', color: col, align: 'center', w: r2(textWidth(n, size, 'medium')), dir: 'ltr', ...(op.rot ? { rot: op.rot } : {}) }];
    }
  }
}
export const r2 = (v) => Math.round(v * 100) / 100;

/** Points of an arc (page coords, visual CCW degrees) as a polyline. */
export function arcPoints(cx, cy, r, a0, a1) {
  let sweep = a1 - a0;
  while (sweep < 0) sweep += 360;
  if (sweep === 0) sweep = 360;
  const n = Math.max(4, Math.ceil(sweep / 5)), pts = [];
  for (let i = 0; i <= n; i++) { const a = ((a0 + (sweep * i) / n) * Math.PI) / 180; pts.push([r2(cx + r * Math.cos(a)), r2(cy - r * Math.sin(a))]); }
  return pts;
}

/** 45° hatch lines ("/") clipped to a rectangle. */
export function hatchLines(x, y, w, h, gap, lw, c = 'hatch', extra = {}) {
  const out = [], step = gap * Math.SQRT2, x1 = x + w, y1 = y + h;
  for (let k = x + y + step / 2; k < x1 + y1; k += step) {
    const xa = Math.max(x, k - y1), xb = Math.min(x1, k - y);
    if (xb - xa > 0.05) out.push({ t: 'line', x1: r2(xa), y1: r2(k - xa), x2: r2(xb), y2: r2(k - xb), lw, color: c, ...extra });
  }
  return out;
}

/** Colours of the engine's special roles (callout balloons accent; reserved zones / cells / legends quieter). */
const ROLE_INK = { callout: 'accent', reserved: 'grey', 'op-symbol': 'ink2', legend: 'ink2', cell: 'ink2' };
/** Font weight of an engine text op. */
const FONT_OF = (op) => (op.weight === 'bold' ? 'bold' : op.role === 'code' ? 'medium' : 'regular');

/**
 * Flatten an engine Drawing (real cm, y up) into page ops inside `box` ([x, y, w, h] mm) at 1:`scale`.
 * Text keeps its real size relative to the geometry when the drawing is printed coarser than the engine's own scale
 * (so dimension texts never collide); line weights stay in paper mm.
 * @returns {{ ops: PageOp[], origin: (X, Y) => [x, y], k: number }}  k = page mm per cm
 */
export function flattenDrawing(d, { lang = 'en', box, scale, align = 'center' } = {}) {
  const S = scale || d.scale, k = 10 / S, b = d.bounds;
  const tscale = Math.min(1, d.scale / S);
  const cw = b.w * k, ch = b.h * k;
  const ox = align === 'left' ? box[0] : box[0] + (box[2] - cw) / 2, oy = box[1] + (box[3] - ch) / 2;
  const X = (x) => r2(ox + (x - b.x) * k), Y = (y) => r2(oy + (b.y + b.h - y) * k);
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const ops = [];
  const meta = (o) => { const m = {}; if (o.role) m.role = o.role; if (o.unitId) m.unitId = o.unitId; return m; };
  for (const o of d.ops) {
    const m = meta(o), dash = o.dash && DASH[o.dash] ? o.dash : undefined, ink = ROLE_INK[o.role] || 'ink';
    if (o.t === 'line') ops.push({ t: 'line', x1: X(o.x1), y1: Y(o.y1), x2: X(o.x2), y2: Y(o.y2), lw: o.lw, color: ink, ...(dash ? { dash } : {}), ...m });
    else if (o.t === 'rect') {
      const x = X(o.x), y = Y(o.y + o.h), w = r2(o.w * k), h = r2(o.h * k), F = FILLS[o.fill] || null, H = FILLS[o.hatch] || null;
      if (F) ops.push({ t: 'rect', x, y, w, h, fill: F.fill, ...m });
      else if (H) ops.push({ t: 'rect', x, y, w, h, fill: H.fill, ...m });
      const hat = (H && H.hatch) || (F && F.hatch);
      if (hat) ops.push(...hatchLines(x, y, w, h, hat.gap, hat.lw, 'hatch', m));
      ops.push({ t: 'rect', x, y, w, h, lw: o.lw, color: ink, ...(dash ? { dash } : {}), ...m });
    } else if (o.t === 'poly') {
      const F = FILLS[o.fill];
      ops.push({ t: 'poly', pts: o.pts.map(([x, y]) => [X(x), Y(y)]), close: !!o.close, lw: o.lw, color: ink, ...(F ? { fill: F.fill } : {}), ...(dash ? { dash } : {}), ...m });
    } else if (o.t === 'arc') ops.push({ t: 'arc', cx: X(o.cx), cy: Y(o.cy), r: r2(o.r * k), a0: o.a0, a1: o.a1, lw: o.lw, color: ink, ...(dash ? { dash } : {}), ...m });
    else if (o.t === 'text') {
      const size = (o.size * tscale) / PT, rot = o.rot || 0, a = (rot * Math.PI) / 180, ch2 = capHalf(size);
      const x = X(o.x) + Math.sin(a) * ch2, y = Y(o.y) + Math.cos(a) * ch2;     // vertical centre → baseline
      const align = o.anchor === 'start' ? 'left' : o.anchor === 'end' ? 'right' : 'center';
      const col = ROLE_INK[o.role] || (o.role === 'label' || o.role === 'note' || o.role === 'legend' ? 'ink2' : 'ink');
      const s = tr(o.text, lang);
      if ((o.role === 'code' || o.role === 'callout') && !rot) {                                      // knock-out box so codes read over door symbols
        const t = textOp(x, y, s, { size: r2(size), font: FONT_OF(o), align, dir });
        const b = textBounds(t), p = 0.35;
        ops.push({ t: 'rect', x: r2(b.x0 - p), y: r2(y - capHalf(size) * 2 - p), w: r2(b.x1 - b.x0 + 2 * p), h: r2(capHalf(size) * 2 + 2 * p), fill: 'paper', role: 'halo' });
      }
      ops.push(textOp(x, y, s, { size: r2(size), font: o.role === 'callout' ? 'bold' : o.role === 'op-symbol' ? 'bold' : FONT_OF(o), color: col, align, dir: o.role === 'note' || o.role === 'callout' ? autoDir(s, dir) : dir, rot: rot || undefined, ...m }));
    }
  }
  return { ops, k, origin: (x, y) => [X(x), Y(y)], size: [cw, ch], offset: [ox, oy] };
}

/** Axis-aligned bounding box of a text op (mm). */
export function textBounds(op) {
  const a = ((op.rot || 0) * Math.PI) / 180, ux = Math.cos(a), uy = -Math.sin(a);   // reading direction
  const s0 = op.align === 'right' ? -op.w : op.align === 'center' ? -op.w / 2 : 0, s1 = s0 + op.w;
  const asc = op.size * PT * 0.75, desc = op.size * PT * 0.25, vx = Math.sin(a), vy = Math.cos(a);  // glyph "down"
  const pts = [];
  for (const s of [s0, s1]) for (const v of [-asc, desc]) pts.push([op.x + ux * s + vx * v, op.y + uy * s + vy * v]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
