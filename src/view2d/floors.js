/**
 * Floors: room fills derived from the chosen finish (with a faint tile / plank hint at high zoom),
 * paved outdoor areas with a tile hatch, and the adaptive grid.
 */
import { polygonBounds, clamp } from '../core/geometry.js';
import { resolveFinish } from '../core/finishes.js';
import { css } from './color.js';

const PLAIN = new Set(['concrete', 'terrazzo', 'marble', 'microcement', 'stone']);

function patternLines(G, poly, params, color, strength) {
  const { ctx } = G;
  const tw = Math.max(5, params.tileW || 60), th = Math.max(5, params.tileH || 60);
  if (PLAIN.has(params.pattern)) return;
  const minPx = Math.min(tw, th) * G.scale;
  const alpha = clamp((minPx - 5) / 12, 0, 1) * strength;
  if (alpha < 0.03) return;
  const b = polygonBounds(poly);
  const x0 = Math.max(b.x, G.view.x0), x1 = Math.min(b.x + b.w, G.view.x1), y0 = Math.max(b.y, G.view.y0), y1 = Math.min(b.y + b.h, G.view.y1);
  if (x1 <= x0 || y1 <= y0) return;
  ctx.save();
  G.poly(poly); ctx.clip();
  ctx.beginPath();
  const plank = params.pattern === 'plank' || params.pattern === 'deck' || params.pattern === 'herringbone' || params.pattern === 'chevron';
  if (plank) {
    // boards run along the longer side of the room; end joints are staggered row by row
    const alongX = b.w >= b.h;
    const long = Math.max(tw, th), short = Math.min(tw, th);
    const a0 = alongX ? y0 : x0, a1 = alongX ? y1 : x1, origin = alongX ? b.y : b.x;
    const l0 = alongX ? x0 : y0, l1 = alongX ? x1 : y1, lorigin = alongX ? b.x : b.y;
    for (let row = Math.floor((a0 - origin) / short); origin + row * short < a1; row++) {
      const p = origin + row * short;
      if (alongX) G.seg(l0, p, l1, p); else G.seg(p, l0, p, l1);
      const shift = ((row * 0.37) % 1) * long;
      for (let q = lorigin + shift + Math.floor((l0 - lorigin - shift) / long) * long; q < l1; q += long) {
        if (alongX) G.seg(q, p, q, p + short); else G.seg(p, q, p + short, q);
      }
    }
  } else {
    for (let x = b.x + Math.ceil((x0 - b.x) / tw) * tw; x < x1; x += tw) G.seg(x, y0, x, y1);
    for (let y = b.y + Math.ceil((y0 - b.y) / th) * th; y < y1; y += th) G.seg(x0, y, x1, y);
  }
  ctx.strokeStyle = css(color, alpha); ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

/** Terrace, porch, utility yard: paving tint + tile hatch + thin outline. */
export function drawOutdoorAreas(G, env) {
  const { plan, pal, store, catalog } = env, { ctx } = G;
  for (const area of plan.outdoorAreas) {
    const fin = resolveFinish(area.id, 'floor', store, catalog).params;
    G.poly(area.polygon); ctx.fillStyle = pal.floor(fin.color); ctx.fill();
    patternLines(G, area.polygon, fin, pal.floorLine(fin.color), 0.9);
    G.poly(area.polygon); ctx.strokeStyle = pal.inkFaint; ctx.lineWidth = 1; ctx.stroke();
  }
}

/** Indoor room floors. */
export function drawRoomFloors(G, env) {
  const { plan, pal, store, catalog } = env, { ctx } = G;
  // the house footprint under walls and openings, so no garden shows through door gaps
  ctx.beginPath();
  for (const o of plan.openings) G.rect(o.x, o.y, o.w, o.h);
  ctx.fillStyle = pal.opening; ctx.fill();
  for (const room of plan.rooms) {
    const fin = resolveFinish(room.id, 'floor', store, catalog).params;
    G.poly(room.polygon); ctx.fillStyle = pal.floor(fin.color); ctx.fill();
    patternLines(G, room.polygon, fin, pal.floorLine(fin.color), 0.55);
  }
}

const GRID_LEVELS = [5, 10, 50, 100, 500, 1000];

/** Adaptive grid: every level fades in as it becomes wide enough on screen. */
export function drawGrid(G, env) {
  const { pal } = env, { ctx } = G;
  const { x0, y0, x1, y1 } = G.view;
  for (const step of GRID_LEVELS) {
    const px = step * G.scale;
    if (px < 7) continue;
    const alpha = clamp((px - 7) / 90, 0, 1) * (pal.dark ? 0.075 : 0.06) + 0.01;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const X = G.RX(x) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, G.height); }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const Y = G.RY(y) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(G.width, Y); }
    ctx.strokeStyle = css(pal.ink, alpha); ctx.lineWidth = 1; ctx.stroke();
  }
}
