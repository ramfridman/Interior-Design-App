/**
 * Frame composer. The plan is painted into two off-screen caches that are slightly larger than the view:
 *   under — paper, site, floors, grid, walls, openings and every item that is not being manipulated
 *   over  — labels and dimension lines
 * A frame is then: blit `under`, draw the few live (dragged) items, blit `over`, draw the interaction overlay.
 * Panning re-uses the caches (pixel-exact integer offsets) until the margin is used up; a zoom frame paints
 * straight to the screen. Nothing is drawn unless the view was invalidated.
 */
import { createGfx, createBoxes } from './gfx.js';
import { drawSiteGround, drawSiteLines } from './site.js';
import { drawOutdoorAreas, drawRoomFloors, drawGrid } from './floors.js';
import { drawWalls } from './walls.js';
import { drawOpenings } from './openings.js';
import { drawItems, drawItem } from './items.js';
import { drawRoomLabels, drawExteriorDims, drawInteriorDims } from './annotations.js';

const MARGIN = 192;   // device px of slack around the view in the caches

/** Everything below the annotations. `skip` = ids of items drawn live by the caller. */
export function paintUnder(G, env, skip = null) {
  const { ctx } = G, { ui, pal } = env;
  G.deviceSpace();
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, G.width, G.height);
  if (ui.showSite) drawSiteGround(G, env);
  drawOutdoorAreas(G, env);
  drawRoomFloors(G, env);
  if (ui.showGrid && !env.exporting) drawGrid(G, env);
  if (ui.showSite) drawSiteLines(G, env);
  if (ui.showItems) drawItems(G, env, 'below', skip);
  drawWalls(G, env);
  drawOpenings(G, env);
  if (ui.showItems) drawItems(G, env, 'above', skip);
}

/** Labels and dimensions. */
export function paintOver(G, env) {
  const { ui } = env;
  G.deviceSpace();
  const boxes = createBoxes();
  if (ui.showDimensions) drawExteriorDims(G, env, boxes);
  if (ui.showRoomLabels) drawRoomLabels(G, env, boxes);
  if (ui.showDimensions) drawInteriorDims(G, env, boxes);
}

export function createRenderer(canvas, env) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const under = document.createElement('canvas'), over = document.createElement('canvas');
  const uctx = under.getContext('2d', { alpha: false }), octx = over.getContext('2d');
  const cache = { scale: NaN, ox: 0, oy: 0, underOk: false, overOk: false, liveKey: '' };
  const stats = { ms: 0, mode: '', frames: 0, rebuilds: 0 };

  const gfx = (target, cam, dpr, ox, oy, w, h) => createGfx(target, { scale: cam.scale, dpr, ox, oy, width: w, height: h, font: env.font });

  return {
    stats,
    /** Mark caches stale: 'under', 'over' or both (default). */
    invalidate(which) {
      if (which !== 'over') cache.underOk = false;
      if (which !== 'under') cache.overOk = false;
    },
    /**
     * Paint one frame.
     * @param cam    Camera
     * @param frame  { dpr, live: Set<string>, direct: boolean, overlay(G): void }
     */
    render(cam, frame) {
      const t0 = performance.now();
      const { dpr, live } = frame;
      const W = canvas.width, H = canvas.height;
      const ox = Math.round(cam.tx * dpr), oy = Math.round(cam.ty * dpr);
      const G = gfx(ctx, cam, dpr, ox, oy, W, H);
      const liveItems = live && live.size ? env.store.items.filter((it) => live.has(it.id) && !it.hidden) : [];

      if (frame.direct) {
        paintUnder(G, env, live);
        if (env.ui.showItems) for (const it of liveItems) drawItem(G, env, it);
        paintOver(G, env);
        cache.underOk = cache.overOk = false;
        stats.mode = 'direct';
      } else {
        const cw = W + 2 * MARGIN, ch = H + 2 * MARGIN;
        const liveKey = live && live.size ? [...live].sort().join(',') : '';
        const moved = cache.scale !== cam.scale || Math.abs(ox - cache.ox) > MARGIN || Math.abs(oy - cache.oy) > MARGIN || under.width !== cw || under.height !== ch;
        if (moved) { cache.underOk = cache.overOk = false; cache.scale = cam.scale; cache.ox = ox; cache.oy = oy; }
        if (liveKey !== cache.liveKey) { cache.underOk = false; cache.liveKey = liveKey; }
        stats.mode = 'cached';
        if (!cache.underOk) {
          if (under.width !== cw || under.height !== ch) { under.width = cw; under.height = ch; }
          paintUnder(gfx(uctx, cam, dpr, cache.ox + MARGIN, cache.oy + MARGIN, cw, ch), env, live);
          cache.underOk = true; stats.mode = 'rebuild'; stats.rebuilds++;
        }
        if (!cache.overOk) {
          if (over.width !== cw || over.height !== ch) { over.width = cw; over.height = ch; }
          octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, cw, ch);
          paintOver(gfx(octx, cam, dpr, cache.ox + MARGIN, cache.oy + MARGIN, cw, ch), env);
          cache.overOk = true; stats.mode = 'rebuild';
        }
        const dx = ox - cache.ox - MARGIN, dy = oy - cache.oy - MARGIN;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
        ctx.drawImage(under, dx, dy);
        if (env.ui.showItems) for (const it of liveItems) drawItem(G, env, it);
        G.deviceSpace();
        ctx.drawImage(over, dx, dy);
      }
      G.deviceSpace();
      if (frame.overlay) frame.overlay(G);
      stats.ms = performance.now() - t0;
      stats.frames++;
    },
    destroy() { under.width = under.height = over.width = over.height = 0; },
  };
}
