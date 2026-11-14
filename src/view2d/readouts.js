/**
 * Small screen-space read-out primitives shared by the item overlay and the structure overlay: value pills,
 * snap guides, clearance dimensions and the tooltip that explains why something cannot be done.
 */
import { css, mix } from './color.js';
import { roundRect } from './gfx.js';
import { dimText } from './dimensions.js';

/** "3.60 m" / "360 cm". */
export const fmtDim = (cm, units) => `${dimText(cm, units)} ${units === 'cm' ? 'cm' : 'm'}`;

/** Width in device px a pill needs for `text`. */
export const pillWidth = (G, text, size = 10.5) => G.measure(text, size, 600) + 12 * G.dpr;

/** Rounded value pill centred at (x, y) device px. Returns its box. */
export function pill(G, text, x, y, bg, color, size = 10.5) {
  const { ctx } = G, d = G.dpr;
  const w = pillWidth(G, text, size), h = (size + 7) * d;
  x = Math.round(x - w / 2); y = Math.round(y - h / 2);
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = bg; ctx.fill();
  G.text(text, x + w / 2, y + h / 2 + 0.5 * d, { size, weight: 600, color });
  return { x0: x, y0: y, x1: x + w, y1: y + h };
}

/** Snap guides: `kind` 'wall' = the face being snapped to (bold), 'center' = dash-dot, anything else = thin. */
export function drawGuides(G, pal, guides) {
  const { ctx } = G, d = G.dpr;
  for (const g of guides || []) {
    const x1 = G.X(g.x1), y1 = G.Y(g.y1), x2 = G.X(g.x2), y2 = G.Y(g.y2);
    const vert = g.x1 === g.x2, ext = g.kind === 'wall' ? 0 : 10 * d;
    const lw = g.kind === 'wall' ? G.px(2.5) : G.px(1), off = lw % 2 ? 0.5 : 0;
    ctx.beginPath();
    if (g.x1 !== g.x2 && g.y1 !== g.y2) {
      // along an angled wall's face
      const L = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / L, uy = (y2 - y1) / L;
      ctx.moveTo(x1 - ux * ext, y1 - uy * ext); ctx.lineTo(x2 + ux * ext, y2 + uy * ext);
    } else if (vert) { ctx.moveTo(Math.round(x1) + off, Math.min(y1, y2) - ext); ctx.lineTo(Math.round(x1) + off, Math.max(y1, y2) + ext); }
    else { ctx.moveTo(Math.min(x1, x2) - ext, Math.round(y1) + off); ctx.lineTo(Math.max(x1, x2) + ext, Math.round(y1) + off); }
    if (g.kind === 'center') ctx.setLineDash([6 * d, 3 * d, 1.5 * d, 3 * d]);
    ctx.strokeStyle = pal.guide; ctx.lineWidth = lw; ctx.stroke(); ctx.setLineDash([]);
  }
}

/** Clearance dimensions ({ x1, y1, x2, y2, dist } in plan cm): a line with end ticks and the distance. */
export function drawClearances(G, pal, list, units, color = pal.accent, onColor = pal.onAccent) {
  const { ctx } = G, d = G.dpr;
  for (const c of list || []) {
    const x1 = Math.round(G.X(c.x1)) + 0.5, y1 = Math.round(G.Y(c.y1)) + 0.5, x2 = Math.round(G.X(c.x2)) + 0.5, y2 = Math.round(G.Y(c.y2)) + 0.5;
    const vert = c.x1 === c.x2, t = 4 * d;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    if (vert) { ctx.moveTo(x1 - t, y1); ctx.lineTo(x1 + t, y1); ctx.moveTo(x2 - t, y2); ctx.lineTo(x2 + t, y2); }
    else { ctx.moveTo(x1, y1 - t); ctx.lineTo(x1, y1 + t); ctx.moveTo(x2, y2 - t); ctx.lineTo(x2, y2 + t); }
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
    if (Math.hypot(x2 - x1, y2 - y1) > 30 * d) pill(G, fmtDim(c.dist, units), (x1 + x2) / 2, (y1 + y2) / 2, color, onColor, 9.5);
  }
}

/** A small padlock centred at (x, y) device px. */
export function lockIcon(G, x, y, color, s = 1) {
  const { ctx } = G, d = G.dpr * s;
  ctx.save(); ctx.translate(Math.round(x), Math.round(y));
  ctx.strokeStyle = color; ctx.lineWidth = 1.4 * d;
  ctx.beginPath(); ctx.arc(0, -1.5 * d, 2.6 * d, Math.PI, 0); ctx.stroke();
  roundRect(ctx, -4 * d, -1.5 * d, 8 * d, 6 * d, 1.2 * d); ctx.fillStyle = color; ctx.fill();
  ctx.restore();
}

function wrap(G, text, maxW, size) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && G.measure(next, size, 500) > maxW) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Tooltip beside the cursor (CSS px `at`), wrapped to a readable width and kept inside the canvas.
 * tone: 'locked' (neutral, with a padlock) | 'note' (neutral) | 'refused' (danger).
 */
export function drawTip(G, pal, text, tone, at) {
  if (!text || !at) return;
  const { ctx } = G, d = G.dpr, size = 11;
  const lock = tone === 'locked', icon = lock ? 18 * d : 0;
  const lines = wrap(G, text, 270 * d, size);
  const tw = Math.max(...lines.map((l) => G.measure(l, size, 500)));
  const lh = Math.round(size * 1.38 * d), padX = 10 * d, padY = 7 * d;
  const w = Math.ceil(tw + icon + 2 * padX), h = lines.length * lh + 2 * padY;
  let x = at.x * d + 16 * d, y = at.y * d + 20 * d;
  if (x + w > G.width - 6 * d) x = at.x * d - 16 * d - w;
  if (y + h > G.height - 6 * d) y = at.y * d - 14 * d - h;
  x = Math.round(Math.max(6 * d, x)); y = Math.round(Math.max(6 * d, y));
  const bg = tone === 'refused' ? pal.danger : (pal.dark ? css(mix(pal.paper, '#ffffff', 0.16)) : pal.ink);
  const fg = tone === 'refused' ? (pal.dark ? '#16181b' : '#ffffff') : (pal.dark ? pal.ink : pal.paper);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 10 * d; ctx.shadowOffsetY = 2 * d;
  roundRect(ctx, x, y, w, h, 7 * d); ctx.fillStyle = bg; ctx.fill();
  ctx.restore();
  if (lock) lockIcon(G, x + padX + 5 * d, y + padY + lh / 2 + 0.5 * d, fg);
  lines.forEach((l, i) => G.text(l, x + padX + icon, y + padY + lh * (i + 0.5) + 0.5 * d, { size, weight: 500, color: fg, align: 'left' }));
}
