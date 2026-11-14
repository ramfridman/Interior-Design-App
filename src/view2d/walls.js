/**
 * Walls: solid poché from `plan.walls` (pixel-snapped rects so neighbours never show seams), a concrete hatch
 * for the mamad shell, and the wall outline stroked crisply on top. `plan.walls` / `plan.wallOutline` are read on
 * every paint — the plan engine replaces them on each edit. While a structure tool is active the poché is tinted
 * by what may be done with each wall; walls that are not on the architect's plan get an accent tint.
 */
import { drawWallTints } from './structure.js';
import { slantPolys } from '../core/geometry.js';

/** Add a plan polygon to the current path (pixel-snapped vertices, like the rects, so joins never show seams). */
export function addPolyPath(G, poly) {
  poly.forEach(([x, y], i) => (i ? G.ctx.lineTo(G.RX(x), G.RY(y)) : G.ctx.moveTo(G.RX(x), G.RY(y))));
  G.ctx.closePath();
}
/** The joined footprints of the angled walls of a plan with each one's slant (kind), in plan.slants order. [] without. */
export function slantShapes(plan) {
  const sl = plan.slants;
  if (!Array.isArray(sl) || !sl.length) return [];
  const polys = slantPolys(plan), byId = new Map(sl.map((s) => [s.id, s]));
  return polys.map((poly) => ({ poly, slant: byId.get(poly.id) || { id: poly.id, kind: 'interior' } }));
}

const patterns = new Map();

function hatchPattern(ctx, color, dpr) {
  const key = `${color}|${dpr}`;
  if (!patterns.has(key)) {
    const size = Math.round(6 * dpr);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    g.strokeStyle = color; g.lineWidth = Math.max(1, dpr * 0.9); g.lineCap = 'square';
    g.beginPath();
    g.moveTo(-1, size + 1); g.lineTo(size + 1, -1);
    g.moveTo(-size - 1, size + 1); g.lineTo(size + 1, -size - 1);
    g.moveTo(-1, 2 * size + 1); g.lineTo(2 * size + 1, -1);
    g.stroke();
    patterns.set(key, { canvas: c, size });
  }
  const p = patterns.get(key);
  const pattern = ctx.createPattern(p.canvas, 'repeat');
  return { pattern, size: p.size };
}

export function drawWalls(G, env) {
  const { plan, pal } = env, { ctx } = G;
  const fills = { exterior: pal.wall, interior: pal.wallInterior, mamad: pal.wallMamad };
  const shapes = slantShapes(plan);     // angled walls (stage A3): their joined footprints, same poché and colours
  for (const kind of ['interior', 'mamad', 'exterior']) {
    ctx.beginPath();
    for (const w of plan.walls) if ((w.kind || 'exterior') === kind || (kind === 'exterior' && !fills[w.kind])) G.rect(w.x, w.y, w.w, w.h);
    for (const { poly, slant } of shapes) if ((slant.kind || 'exterior') === kind || (kind === 'exterior' && !fills[slant.kind])) addPolyPath(G, poly);
    ctx.fillStyle = fills[kind]; ctx.fill();
  }
  drawWallTints(G, env);
  // reinforced-concrete hatch for the shelter, anchored to the plan so it does not swim while panning
  const { pattern, size } = hatchPattern(ctx, pal.wallHatch, G.dpr);
  if (pattern) {
    if (pattern.setTransform) pattern.setTransform(new DOMMatrix().translate(((G.ox % size) + size) % size, ((G.oy % size) + size) % size));
    ctx.beginPath();
    for (const w of plan.walls) if (w.kind === 'mamad') G.rect(w.x, w.y, w.w, w.h);
    for (const { poly, slant } of shapes) if (slant.kind === 'mamad') addPolyPath(G, poly);
    ctx.fillStyle = pattern; ctx.fill();
  }
  const lw = G.px(G.scale >= 1.6 ? 1.5 : 1);
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of plan.wallOutline) {
    // a diagonal edge of an angled wall: between the same pixel-snapped corners as its poché
    if (x1 !== x2 && y1 !== y2) { ctx.moveTo(G.RX(x1), G.RY(y1)); ctx.lineTo(G.RX(x2), G.RY(y2)); } else G.seg(x1, y1, x2, y2, lw);
  }
  ctx.strokeStyle = pal.wallLine; ctx.lineWidth = lw; ctx.lineCap = 'square'; ctx.stroke(); ctx.lineCap = 'butt';
}
