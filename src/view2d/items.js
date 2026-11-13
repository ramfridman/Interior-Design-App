/**
 * Item layer: soft drop shadow + the model's plan symbol under translate / rotate. Wall- and ceiling-mounted
 * items float above the floor, so they are drawn translucent with a dashed outline.
 */
import { DEG } from '../core/geometry.js';
import { css } from './color.js';
import { createGfx } from './gfx.js';

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

// ───────────── sprite cache ─────────────
// While the camera zooms every frame is a full repaint; re-running 150 detailed symbols would dominate it.
// Each item is therefore kept as a small bitmap (symbol + shadow, already rotated) that is blitted pixel-exact
// at its own zoom level and stretched for the few frames in between; stale sprites are refreshed within a
// per-frame time budget, and the resting image is always redrawn from vectors.
const sprites = new Map();
const MAX_SPRITE = 1500, PIXEL_BUDGET = 48e6, REFRESH_MS = 2.5;
let spritePixels = 0;

const signature = (it, pal) => `${it.type}|${it.w}|${it.d}|${it.h}|${it.rot || 0}|${it.placement}|${it.elev}|${pal.dark ? 1 : 0}|${JSON.stringify(it.params || {})}`;

function renderSprite(sp, G, env, it) {
  const r = (it.rot || 0) * DEG, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const pad = 14 * G.k + 4 * G.dpr;
  const w = 2 * Math.ceil((c * it.w + s * it.d) / 2 * G.k + pad), h = 2 * Math.ceil((s * it.w + c * it.d) / 2 * G.k + pad);
  sp.k = G.k; sp.ok = w <= MAX_SPRITE && h <= MAX_SPRITE;
  if (!sp.ok) return;
  if (!sp.canvas) { sp.canvas = document.createElement('canvas'); sp.ctx = sp.canvas.getContext('2d'); }
  spritePixels += w * h - sp.canvas.width * sp.canvas.height * (sp.sized ? 1 : 0);
  sp.canvas.width = w; sp.canvas.height = h; sp.sized = true;
  const g = createGfx(sp.ctx, { scale: G.scale, dpr: G.dpr, ox: w / 2 - it.x * G.k, oy: h / 2 - it.y * G.k, width: w, height: h, font: G.font });
  drawItem(g, env, it);
}

/**
 * Draw an item through its sprite. `clock()` returns the ms left for refreshing stale sprites this frame;
 * with `exact` the sprite is always brought to the current zoom first (used for the few items being dragged).
 */
export function drawItemSprite(G, env, it, clock, exact = false) {
  const reach = Math.hypot(it.w, it.d) / 2 + 12;
  if (!G.visible(it.x - reach, it.y - reach, it.x + reach, it.y + reach)) return;
  if (Math.max(it.w, it.d) * G.scale < 5) { drawItem(G, env, it); return; }
  const sig = signature(it, env.pal);
  let sp = sprites.get(it.id);
  const usable = sp && sp.sig === sig;
  const ratio = usable ? G.k / sp.k : 0;
  if (!usable || (exact ? ratio !== 1 : ratio > 1.45 || ratio < 0.62)) {
    if (exact || clock() > 0) {
      if (!sp) { sp = {}; sprites.set(it.id, sp); }
      sp.sig = sig;
      renderSprite(sp, G, env, it);
    } else if (!usable) { drawItem(G, env, it); return; }
  }
  if (!sp.ok) { drawItem(G, env, it); return; }
  const { ctx } = G, f = G.k / sp.k, w = sp.canvas.width, h = sp.canvas.height;
  if (f === 1) ctx.drawImage(sp.canvas, Math.round(G.X(it.x)) - w / 2, Math.round(G.Y(it.y)) - h / 2);
  else ctx.drawImage(sp.canvas, G.X(it.x) - (w * f) / 2, G.Y(it.y) - (h * f) / 2, w * f, h * f);
}

/** Drop sprites of items that no longer exist (or everything, when the memory budget is exceeded). */
export function pruneSprites(store) {
  if (spritePixels > PIXEL_BUDGET) { sprites.clear(); spritePixels = 0; return; }
  if (sprites.size <= store.items.length + 24) return;
  const alive = new Set(store.items.map((it) => it.id));
  for (const [id, sp] of sprites) if (!alive.has(id)) { if (sp.canvas) spritePixels -= sp.canvas.width * sp.canvas.height; sprites.delete(id); }
}

/** A per-frame stopwatch for sprite refreshes. */
export const spriteClock = () => { const t0 = performance.now(); return () => REFRESH_MS - (performance.now() - t0); };

/**
 * Draw a pass of the item list in array order.
 * @param {'below'|'above'} pass  below = ground surfaces + rugs (under the walls); above = everything else
 * @param {Set<string>|null} skip  ids drawn live by the caller (being dragged)
 * @param {Function|null} clock    when given, items are drawn through the sprite cache (zoom frames)
 */
export function drawItems(G, env, pass, skip, clock = null) {
  for (const it of env.store.items) {
    if (it.hidden || isBelowWalls(it) !== (pass === 'below')) continue;
    if (skip && skip.has(it.id)) continue;
    if (clock) drawItemSprite(G, env, it, clock); else drawItem(G, env, it);
  }
  G.deviceSpace();
}
