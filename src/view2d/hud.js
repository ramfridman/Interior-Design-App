/**
 * Screen-anchored drawing aids: scale bar and north arrow (also reused by the PNG export title block).
 */
import { DEG } from '../core/geometry.js';

const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

/** Scale bar with its left end at (x, y) device px. Returns its width in device px. */
export function drawScaleBar(G, pal, x, y, units = 'm', targetCss = 120) {
  const { ctx } = G, d = G.dpr;
  const len = NICE.find((n) => n * G.scale >= targetCss * 0.6) || NICE[NICE.length - 1];
  const w = Math.round(len * G.k), h = Math.round(4 * d), parts = 4;
  x = Math.round(x); y = Math.round(y);
  for (let i = 0; i < parts; i++) {
    ctx.fillStyle = i % 2 ? pal.paper : pal.ink;
    ctx.fillRect(x + Math.round((w * i) / parts), y, Math.round(w / parts), h);
  }
  ctx.strokeStyle = pal.ink; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const fmt = (cm) => (units === 'cm' || len < 100 ? `${cm}` : `${cm / 100}`);
  const unit = units === 'cm' || len < 100 ? 'cm' : 'm';
  const opts = { size: 9.5, weight: 500, color: pal.inkSoft, halo: pal.halo, baseline: 'alphabetic' };
  G.text('0', x, y - 4 * d, opts);
  G.text(fmt(len / 2), x + w / 2, y - 4 * d, opts);
  G.text(`${fmt(len)} ${unit}`, x + w, y - 4 * d, { ...opts, align: 'center' });
  return w;
}

/** North arrow centred at (cx, cy) device px; `northAngle` = clockwise degrees from plan-up to true north. */
export function drawNorthArrow(G, pal, cx, cy, northAngle = 0, radiusCss = 15) {
  const { ctx } = G, d = G.dpr, r = radiusCss * d;
  ctx.save();
  ctx.translate(Math.round(cx), Math.round(cy));
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = pal.halo; ctx.fill();
  ctx.strokeStyle = pal.inkSoft; ctx.lineWidth = G.px(1); ctx.stroke();
  ctx.rotate(northAngle * DEG);
  // needle: dark half pointing north, light half pointing south
  ctx.beginPath(); ctx.moveTo(0, -r * 0.78); ctx.lineTo(r * 0.3, 0); ctx.lineTo(-r * 0.3, 0); ctx.closePath();
  ctx.fillStyle = pal.ink; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, r * 0.78); ctx.lineTo(r * 0.3, 0); ctx.lineTo(-r * 0.3, 0); ctx.closePath();
  ctx.fillStyle = pal.paper; ctx.fill(); ctx.strokeStyle = pal.ink; ctx.lineWidth = 1; ctx.stroke();
  // "N" just outside the ring, upright
  ctx.translate(0, -r - 8 * d);
  ctx.rotate(-northAngle * DEG);
  ctx.restore();
  const a = northAngle * DEG;
  G.text('N', cx + Math.sin(a) * (r + 8 * d), cy - Math.cos(a) * (r + 8 * d), { size: 10, weight: 700, color: pal.ink, halo: pal.halo });
}
