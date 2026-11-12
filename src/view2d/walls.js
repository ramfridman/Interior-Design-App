/**
 * Walls: solid poché from `plan.walls` (pixel-snapped rects so neighbours never show seams), a concrete hatch
 * for the mamad shell, and the architect's outline stroked crisply on top.
 */
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
  for (const kind of ['interior', 'mamad', 'exterior']) {
    ctx.beginPath();
    for (const w of plan.walls) if ((w.kind || 'exterior') === kind || (kind === 'exterior' && !fills[w.kind])) G.rect(w.x, w.y, w.w, w.h);
    ctx.fillStyle = fills[kind]; ctx.fill();
  }
  // reinforced-concrete hatch for the shelter, anchored to the plan so it does not swim while panning
  const { pattern, size } = hatchPattern(ctx, pal.wallHatch, G.dpr);
  if (pattern) {
    if (pattern.setTransform) pattern.setTransform(new DOMMatrix().translate(((G.ox % size) + size) % size, ((G.oy % size) + size) % size));
    ctx.beginPath();
    for (const w of plan.walls) if (w.kind === 'mamad') G.rect(w.x, w.y, w.w, w.h);
    ctx.fillStyle = pattern; ctx.fill();
  }
  const lw = G.px(G.scale >= 1.6 ? 1.5 : 1);
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of plan.wallOutline) G.seg(x1, y1, x2, y2, lw);
  ctx.strokeStyle = pal.wallLine; ctx.lineWidth = lw; ctx.lineCap = 'square'; ctx.stroke(); ctx.lineCap = 'butt';
}
