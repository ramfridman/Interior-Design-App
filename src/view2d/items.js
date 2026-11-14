/**
 * Item layer: soft drop shadow + the model's plan symbol under translate / rotate. Wall- and ceiling-mounted
 * items float above the floor, so they are drawn translucent with a dashed outline.
 */
import { DEG } from '../core/geometry.js';
import { css } from './color.js';

const BELOW_WALLS = new Set(['surface', 'rug']);
const ROUND = new Set(['tree', 'shrub', 'plant', 'planter', 'parasol', 'fire-pit', 'floor-lamp', 'table-lamp', 'pendant', 'ceiling-fan', 'vase', 'water-feature', 'spa']);
const NO_SHADOW = new Set(['surface', 'rug', 'pool', 'flower-bed', 'car']);

/** Items drawn underneath the walls (ground surfaces and rugs). */
export const isBelowWalls = (it) => BELOW_WALLS.has(it.type);
export const isFloating = (it) => it.placement === 'wall' || it.placement === 'ceiling';
const isRound = (it) => {
  const s = it.params && it.params.shape;
  return s === 'round' || s === 'oval' || (ROUND.has(it.type) && s !== 'square' && s !== 'rect');
};

function footprint(ctx, it, grow = 0) {
  const w = it.w + grow * 2, d = it.d + grow * 2;
  ctx.beginPath();
  if (isRound(it)) ctx.ellipse(0, 0, w / 2, d / 2, 0, 0, Math.PI * 2);
  else {
    const r = Math.min(4 + grow, w / 2, d / 2);
    ctx.moveTo(-w / 2 + r, -d / 2); ctx.arcTo(w / 2, -d / 2, w / 2, d / 2, r); ctx.arcTo(w / 2, d / 2, -w / 2, d / 2, r);
    ctx.arcTo(-w / 2, d / 2, -w / 2, -d / 2, r); ctx.arcTo(-w / 2, -d / 2, w / 2, -d / 2, r); ctx.closePath();
  }
}

/**
 * Draw one item. opts: { alpha, shadow }.
 */
export function drawItem(G, env, it, opts = {}) {
  const { ctx } = G, { pal, models } = env;
  const reach = Math.hypot(it.w, it.d) / 2 + 12;
  if (!G.visible(it.x - reach, it.y - reach, it.x + reach, it.y + reach)) return;
  const px = 1 / G.scale, rot = (it.rot || 0) * DEG;
  const floating = isFloating(it);
  const alpha = (opts.alpha ?? 1) * (floating ? 0.62 : 1);
  ctx.save();
  G.planSpace();
  // far-away: a plain tinted footprint is all that can be seen
  if (Math.max(it.w, it.d) * G.scale < 5) {
    ctx.translate(it.x, it.y); ctx.rotate(rot);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = css(pal.ink, 0.35);
    ctx.fillRect(-it.w / 2, -it.d / 2, it.w, it.d);
    ctx.restore();
    return;
  }
  if (opts.shadow !== false && !floating && !NO_SHADOW.has(it.type)) {
    const off = Math.max(1.2 * px, Math.min(7, 1.5 + (it.h || 0) * 0.028));
    ctx.save();
    ctx.translate(it.x + off * 0.75, it.y + off);
    ctx.rotate(rot);
    ctx.globalAlpha = alpha;
    footprint(ctx, it, off * 0.7); ctx.fillStyle = pal.shadow + pal.shadowAlpha * 0.6 + ')'; ctx.fill();
    footprint(ctx, it, 0); ctx.fillStyle = pal.shadow + pal.shadowAlpha + ')'; ctx.fill();
    ctx.restore();
  }
  ctx.translate(it.x, it.y); ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  models.drawSymbol(ctx, it, px);
  if (floating) {
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.setLineDash([4 * px, 3 * px]);
    ctx.strokeStyle = pal.inkSoft; ctx.lineWidth = px;
    ctx.strokeRect(-it.w / 2 - px, -it.d / 2 - px, it.w + 2 * px, it.d + 2 * px);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/**
 * Draw a pass of the item list in array order.
 * @param {'below'|'above'} pass  below = ground surfaces + rugs (under the walls); above = everything else
 * @param {Set<string>|null} skip  ids drawn live by the caller (being dragged)
 * @param {number} alpha  overall opacity (furniture is dimmed while the building is being edited)
 */
export function drawItems(G, env, pass, skip, alpha = 1) {
  const opts = alpha < 1 ? { alpha } : undefined;
  for (const it of env.store.items) {
    if ((env.shown ? !env.shown(it) : it.hidden) || isBelowWalls(it) !== (pass === 'below')) continue;
    if (skip && skip.has(it.id)) continue;
    drawItem(G, env, it, opts);
  }
  G.deviceSpace();
}
