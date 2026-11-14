/**
 * Frame composer. The plan is painted into two off-screen caches that are slightly larger than the view:
 *   under — paper, site, floors, grid, walls, openings and every item that is not being manipulated
 *   over  — labels, dimension lines and the markers of the "changes" overlay
 * Everything is read from `env.plan` at paint time; a 'plan' event only has to invalidate the caches — and since
 * a plan edit is local (a wall, the rooms beside it, an opening), only that rectangle of the caches is repainted
 * (clipped, with everything outside it culled), which keeps dragging a wall well inside one frame.
 * While a structure tool is active the (dimmed) furniture has a cache of its own, so a plan edit does not redraw it.
 * A frame is then: blit `under`, draw the few live (dragged) items, blit `over`, draw the interaction overlay.
 * Panning re-uses the caches (pixel-exact integer offsets) until the margin is used up; a zoom frame paints
 * straight to the screen from vectors (always crisp). Nothing is drawn unless the view was invalidated.
 */
import { createGfx, createBoxes } from './gfx.js';
import { drawSiteGround, drawSiteLines, drawSiteLabels } from './site.js';
import { drawOutdoorAreas, drawRoomFloors, drawGrid } from './floors.js';
import { drawWalls } from './walls.js';
import { drawOpenings } from './openings.js';
import { drawItems, drawItem } from './items.js';
import { drawRoomLabels, drawExteriorDims, drawInteriorDims, dimBandRect } from './annotations.js';
import { isStructureTool, drawRemovedWalls, drawChangeMarkers } from './structure.js';
import { drawUnderlay } from './underlay.js';
import { drawGhostBelow, drawLotReference } from './levels.js';
import { drawStairs } from './stairs.js';

const MARGIN = 192;   // device px of slack around the view in the caches
const ITEMS_DIMMED = 0.35;
const DIRTY_PAD = 12;   // CSS px added around a repainted plan rectangle (outlines, halos, markers)

/** Optional per-layer timing (diagnostics only): env.profile = {} collects ms per layer, forcing a raster flush after each. */
function profiler(G, env) {
  if (!env.profile) return (name, fn) => fn();
  return (name, fn) => {
    const t = performance.now();
    fn();
    G.ctx.getImageData(0, 0, 1, 1);
    env.profile[name] = (env.profile[name] || 0) + performance.now() - t;
  };
}

/** All furniture, dimmed — the backdrop while the building itself is being edited. */
export function paintFurniture(G, env, skip = null) {
  drawItems(G, env, 'below', skip, ITEMS_DIMMED);
  drawItems(G, env, 'above', skip, ITEMS_DIMMED);
}

/**
 * Everything below the annotations. `skip` = ids of items drawn live by the caller; `furniture` = a canvas of the
 * same geometry that already holds paintFurniture() (structure tools only).
 */
export function paintUnder(G, env, skip = null, furniture = null) {
  const { ctx } = G, { ui, pal } = env;
  const step = profiler(G, env);
  G.deviceSpace();
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, G.width, G.height);
  // the site (street, garden, parking, lot lines) belongs to the ground floor; an upper floor keeps a faint lot line
  const ground = !env.level || env.level === 'L0';
  if (ui.showSite && ground) step('siteGround', () => drawSiteGround(G, env));
  step('floors', () => { drawOutdoorAreas(G, env); drawRoomFloors(G, env); });
  if (ui.showGrid && !env.exporting) step('grid', () => drawGrid(G, env));
  step('underlay', () => drawUnderlay(G, env));       // imported sketch to trace over (never exported)
  if (ui.showSite) step('siteLines', () => (ground ? drawSiteLines(G, env) : drawLotReference(G, env)));
  if (!ground) step('ghost', () => drawGhostBelow(G, env));   // the floor below, faint and never pickable
  if (isStructureTool(ui.tool) && !env.exporting) {
    // the furniture steps back: dimmed, not pickable, and under the walls and door swings being edited
    if (ui.showItems) step('items', () => { if (furniture) { G.deviceSpace(); ctx.drawImage(furniture, 0, 0); } else paintFurniture(G, env, skip); });
    step('stairs', () => drawStairs(G, env));        // stairs and openings in floors (stage F4b; nothing without them)
    step('walls', () => drawWalls(G, env));
    step('openings', () => drawOpenings(G, env));
    step('changes', () => drawRemovedWalls(G, env));
    return;
  }
  step('stairs', () => drawStairs(G, env));
  if (ui.showItems) step('itemsBelow', () => drawItems(G, env, 'below', skip));
  step('walls', () => drawWalls(G, env));
  step('openings', () => drawOpenings(G, env));
  step('changes', () => drawRemovedWalls(G, env));
  if (ui.showItems) step('items', () => drawItems(G, env, 'above', skip));
}

/** Labels and dimensions. */
export function paintOver(G, env) {
  const { ui } = env;
  const step = profiler(G, env);
  G.deviceSpace();
  const boxes = createBoxes();
  if (ui.showSite && (!env.level || env.level === 'L0')) drawSiteLabels(G, env, boxes);
  if (ui.showDimensions) step('extDims', () => drawExteriorDims(G, env, boxes));
  if (ui.showRoomLabels) step('labels', () => drawRoomLabels(G, env, boxes));
  if (ui.showDimensions) step('intDims', () => drawInteriorDims(G, env, boxes));
  drawChangeMarkers(G, env);
}

export function createRenderer(canvas, env) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const under = document.createElement('canvas'), over = document.createElement('canvas');
  const uctx = under.getContext('2d', { alpha: false }), octx = over.getContext('2d');
  let furn = null, fctx = null;          // dimmed furniture, only while a structure tool is active
  const cache = { scale: NaN, ox: 0, oy: 0, underOk: false, overOk: false, furnOk: false, liveKey: '', dirty: null };
  const furniture = () => (cache.furnOk ? furn : null);
  const stats = { ms: 0, fullMs: 0, mode: '', frames: 0, rebuilds: 0 };

  const gfx = (target, cam, dpr, ox, oy, w, h) => createGfx(target, { scale: cam.scale, dpr, ox, oy, width: w, height: h, font: env.font });

  /** Repaint the dirty plan rectangles of both caches: clip, cull everything outside, paint as usual. */
  function repaintDirty(cam, dpr, live, cw, ch) {
    const rects = cache.dirty.rects.slice();
    for (const side of cache.dirty.sides) { const band = dimBandRect(env.plan, env.ui, cam.scale, side); if (band) rects.push(band); }
    // rectangles that touch are painted as one
    const boxes = [];
    for (const r of rects) {
      let box = { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
      for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i];
        if (box.x0 <= b.x1 && b.x0 <= box.x1 && box.y0 <= b.y1 && b.y0 <= box.y1) {
          box = { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) };
          boxes.splice(i, 1); i = boxes.length;
        }
      }
      boxes.push(box);
    }
    const ox = cache.ox + MARGIN, oy = cache.oy + MARGIN, k = cam.scale * dpr, pad = Math.ceil(DIRTY_PAD * dpr);
    for (const b of boxes) {
      const x0 = Math.max(0, Math.floor(b.x0 * k + ox) - pad), y0 = Math.max(0, Math.floor(b.y0 * k + oy) - pad);
      const x1 = Math.min(cw, Math.ceil(b.x1 * k + ox) + pad), y1 = Math.min(ch, Math.ceil(b.y1 * k + oy) + pad);
      if (x1 <= x0 || y1 <= y0) continue;
      // cull against a slightly larger area than the clip, so nothing that rounds onto its edge pixels is skipped
      const view = { x0: (x0 - 3 - ox) / k, y0: (y0 - 3 - oy) / k, x1: (x1 + 3 - ox) / k, y1: (y1 + 3 - oy) / k };
      for (const target of [uctx, octx]) {
        const G = gfx(target, cam, dpr, ox, oy, cw, ch);
        G.view = view;
        target.save();
        target.setTransform(1, 0, 0, 1, 0, 0);
        target.beginPath(); target.rect(x0, y0, x1 - x0, y1 - y0); target.clip();
        if (target === octx) { target.clearRect(x0, y0, x1 - x0, y1 - y0); paintOver(G, env); } else paintUnder(G, env, live, furniture());
        target.restore();
      }
    }
  }

  return {
    stats,
    /** Mark caches stale: 'under', 'over' or both (default). */
    invalidate(which) {
      if (which !== 'over') cache.underOk = cache.furnOk = false;
      if (which !== 'under') cache.overOk = false;
      cache.dirty = null;
    },
    /**
     * A plan edit changed only part of the drawing: `dirt` = { rect: plan rectangle | null, sides: façades whose
     * dimension chains changed } (see structure.planDirt). Without `dirt` everything is repainted.
     */
    invalidatePlan(dirt) {
      if (!dirt) { this.invalidate(); return; }
      if (!cache.underOk || !cache.overOk) return;            // a full repaint is already due
      const d = cache.dirty || (cache.dirty = { rects: [], sides: new Set() });
      if (dirt.rect) d.rects.push(dirt.rect);
      for (const side of dirt.sides || []) d.sides.add(side);
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
      const liveItems = live && live.size ? env.store.items.filter((it) => live.has(it.id) && (env.shown ? env.shown(it) : !it.hidden)) : [];

      if (frame.direct) {
        // zoom frame: straight from vectors (always crisp); the caches are rebuilt once the zoom settles
        paintUnder(G, env, live);
        if (env.ui.showItems) for (const it of liveItems) drawItem(G, env, it);
        paintOver(G, env);
        cache.underOk = cache.overOk = false;
        stats.mode = 'direct';
        stats.fullMs = performance.now() - t0;
      } else {
        const cw = W + 2 * MARGIN, ch = H + 2 * MARGIN;
        const liveKey = live && live.size ? [...live].sort().join(',') : '';
        const moved = cache.scale !== cam.scale || Math.abs(ox - cache.ox) > MARGIN || Math.abs(oy - cache.oy) > MARGIN || under.width !== cw || under.height !== ch;
        if (moved) { cache.underOk = cache.overOk = cache.furnOk = false; cache.scale = cam.scale; cache.ox = ox; cache.oy = oy; }
        if (liveKey !== cache.liveKey) { cache.underOk = cache.furnOk = false; cache.liveKey = liveKey; }
        if (isStructureTool(env.ui.tool) && env.ui.showItems) {
          if (!cache.furnOk) {
            if (!furn) { furn = document.createElement('canvas'); fctx = furn.getContext('2d'); }
            if (furn.width !== cw || furn.height !== ch) { furn.width = cw; furn.height = ch; }
            fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, cw, ch);
            paintFurniture(gfx(fctx, cam, dpr, cache.ox + MARGIN, cache.oy + MARGIN, cw, ch), env, live);
            cache.furnOk = true;
          }
        } else if (furn) { furn.width = furn.height = 0; furn = fctx = null; cache.furnOk = false; }
        stats.mode = 'cached';
        if (cache.dirty && cache.underOk && cache.overOk) { repaintDirty(cam, dpr, live, cw, ch); stats.mode = 'partial'; }
        cache.dirty = null;
        const both = !cache.underOk && !cache.overOk;
        if (!cache.underOk) {
          if (under.width !== cw || under.height !== ch) { under.width = cw; under.height = ch; }
          paintUnder(gfx(uctx, cam, dpr, cache.ox + MARGIN, cache.oy + MARGIN, cw, ch), env, live, furniture());
          cache.underOk = true; stats.mode = 'rebuild'; stats.rebuilds++;
        }
        if (!cache.overOk) {
          if (over.width !== cw || over.height !== ch) { over.width = cw; over.height = ch; }
          octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, cw, ch);
          paintOver(gfx(octx, cam, dpr, cache.ox + MARGIN, cache.oy + MARGIN, cw, ch), env);
          cache.overOk = true; stats.mode = 'rebuild';
        }
        if (both) stats.fullMs = performance.now() - t0;
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
    destroy() { under.width = under.height = over.width = over.height = 0; if (furn) furn.width = furn.height = 0; },
  };
}
