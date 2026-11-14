/**
 * Dimensions of angled walls (stage A3): an aligned chain along each face of an angled wall that borders open space
 * (offset outwards, text along the wall and kept upright, broken at its doors and windows) and the angle to the nearest
 * orthogonal wall as a small arc with its degrees. Drawn in the cached annotation layer when the "dimensions" display is
 * on, and in the structure overlay for the selected angled wall. Geometry: slant-tools.js (pure, tested).
 */
import { css } from './color.js';
import { dimText } from './dimensions.js';
import { alignedDim, slantFaceDims, angleToOrtho } from './slant-tools.js';

const DEG = Math.PI / 180;

/** Device-px AABB of a text box `w` × `h` centred at (x, y) and turned by `angle`. */
function rotatedBox(x, y, w, h, angle) {
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle)), hw = (w * c + h * s) / 2, hh = (w * s + h * c) / 2;
  return { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh };
}

/**
 * An aligned dimension chain. `a` = plan point at parameter 0, (ux, uy) along, (nx, ny) outwards; `pts` = parameters (cm)
 * of the breaks; the line sits `offPx` CSS px outside the measured line. opts: { color, size, units, boxes, total }.
 */
export function drawAlignedChain(G, pal, { a, ux, uy, nx, ny, pts, offPx = 18, color = pal.dim, size = 9.5, units = 'm', boxes = null, gapPx = 4 }) {
  const { ctx } = G, d = G.dpr, k = G.k;
  if (!pts || pts.length < 2) return;
  const off = (offPx * d) / k, gap = (gapPx * d) / k, over = (5 * d) / k;
  const P = (t) => [a[0] + ux * t, a[1] + uy * t];
  const first = alignedDim(P(pts[0]), P(pts[pts.length - 1]), nx, ny, off, { gap, over });
  ctx.beginPath();
  ctx.moveTo(G.X(first.p0[0]) - ux * 4 * d, G.Y(first.p0[1]) - uy * 4 * d); ctx.lineTo(G.X(first.p1[0]) + ux * 4 * d, G.Y(first.p1[1]) + uy * 4 * d);
  for (const [x1, y1, x2, y2] of first.ext) { ctx.moveTo(G.X(x1), G.Y(y1)); ctx.lineTo(G.X(x2), G.Y(y2)); }
  ctx.strokeStyle = css(color, 0.8); ctx.lineWidth = 1; ctx.stroke();
  // architectural slashes at every break (45° to the line)
  ctx.beginPath();
  const s = 3.5 * d, sx = (ux + nx) * Math.SQRT1_2, sy = (uy + ny) * Math.SQRT1_2;
  for (const t of pts) {
    const q = P(t), x = G.X(q[0] + nx * off), y = G.Y(q[1] + ny * off);
    ctx.moveTo(x - sx * s, y - sy * s); ctx.lineTo(x + sx * s, y + sy * s);
  }
  ctx.strokeStyle = color; ctx.lineWidth = G.px(1.4); ctx.stroke();
  // figures, upright, just outside the line
  for (let i = 0; i < pts.length - 1; i++) {
    const len = pts[i + 1] - pts[i];
    if (len < 1) continue;
    const dim = alignedDim(P(pts[i]), P(pts[i + 1]), nx, ny, off, { textOff: (size * 0.75 * d + 3 * d) / k });
    const text = dimText(len, units), angle = dim.text.angle;
    const tw = G.measure(text, size, 500), th = size * d;
    if (tw > len * k - 2 * d && pts.length > 2) continue;           // a jamb piece too short for its figure
    const x = G.X(dim.text.x), y = G.Y(dim.text.y);
    const box = rotatedBox(x, y, tw + 2 * d, th + 2 * d, angle);
    if (boxes) { if (boxes.collides(box, 1.5 * d)) continue; boxes.add(box); }
    G.text(text, x, y, { size, weight: 500, color, halo: pal.halo, angle });
  }
}

/** The angle between an angled wall and the nearest orthogonal wall (or north): a small arc and its degrees. */
export function drawAngleArc(G, pal, seg, rects, color = pal.dim, boxes = null) {
  const info = angleToOrtho(seg, rects);
  if (!(info.deg > 0.05)) return null;
  const { ctx } = G, d = G.dpr, r = 26 * d;
  const x = G.X(info.at[0]), y = G.Y(info.at[1]);
  let a0 = info.wallDeg * DEG, a1 = info.slantDeg * DEG, da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
  ctx.beginPath(); ctx.arc(x, y, r, a0, a0 + da, da < 0);
  ctx.strokeStyle = css(color, 0.85); ctx.lineWidth = G.px(1.1); ctx.stroke();
  // the arm along the reference (a short dashed line when it is north / not drawn as a wall)
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a0) * (r + 6 * d), y + Math.sin(a0) * (r + 6 * d));
  ctx.setLineDash([2 * d, 2 * d]); ctx.strokeStyle = css(color, 0.55); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
  const mid = a0 + da / 2, text = `${Number.isInteger(info.deg) ? info.deg : info.deg.toFixed(1)}°`;
  const tx = x + Math.cos(mid) * (r + 11 * d), ty = y + Math.sin(mid) * (r + 11 * d);
  const box = rotatedBox(tx, ty, G.measure(text, 9.5, 600) + 2 * d, 11 * d, 0);
  if (boxes) { if (boxes.collides(box, 1 * d)) return info; boxes.add(box); }
  G.text(text, tx, ty, { size: 9.5, weight: 600, color, halo: pal.halo });
  return info;
}

/**
 * Every dimension of one angled wall segment: an aligned chain per exposed face and the angle arc.
 * @param seg       its 'seg:a:' segment (x1…y2, t, faces)
 * @param openings  the openings in it
 * @param rects     the rect wall segments of the level (for the angle)
 */
export function drawSlantDims(G, pal, seg, openings, rects, { units = 'm', boxes = null, color = pal.dim, offPx = 16 } = {}) {
  for (const f of slantFaceDims(seg, openings)) drawAlignedChain(G, pal, { a: f.a, ux: f.ux, uy: f.uy, nx: f.nx, ny: f.ny, pts: f.pts, offPx, color, units, boxes });
  drawAngleArc(G, pal, seg, rects, color, boxes);
}
