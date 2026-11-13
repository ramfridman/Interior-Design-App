/**
 * PNG export: the whole lot (or just the house when the site is hidden) drawn as an A3-landscape sheet at a
 * true architectural scale, on white paper, with a frame and a title block.
 */
import { polygonBounds, areaM2 } from '../core/geometry.js';
import { createGfx } from './gfx.js';
import { exportPalette } from './theme.js';
import { paintUnder, paintOver } from './renderer.js';
import { houseEnvelope, dimensionMargin } from './annotations.js';
import { streetPolygon } from './site.js';
import { drawScaleBar, drawNorthArrow } from './hud.js';

const SHEET = { w: 2100, h: 1485 };          // A3 landscape, 50 CSS px per paper centimetre
const MARGIN = 30, TITLE_H = 104;
const SCALES = [50, 100, 200, 500];

/**
 * @param env    { store, plan, catalog, models, font }
 * @param opts   { scale = 2 } pixel density of the sheet (2 → 4200 × 2970 px)
 * @returns {Promise<Blob>}
 */
export function exportPNG(env, { scale = 2 } = {}) {
  const { store, plan } = env;
  const dpr = Math.max(0.5, Math.min(4, Number(scale) || 2));
  const pal = exportPalette();
  const ui = { ...store.ui, showGrid: false };
  const e2 = { ...env, pal, ui, exporting: true };

  // what must be on the sheet
  let x0, y0, x1, y1;
  if (ui.showSite) {
    const b = plan.site.bounds || polygonBounds(plan.site.boundary);
    x0 = b.x; y0 = b.y; x1 = b.x + b.w; y1 = b.y + b.h;
    const st = streetPolygon(plan.site);
    if (st) {
      const sb = polygonBounds(st.poly);
      if (st.out[0]) { x0 = Math.min(x0, sb.x); x1 = Math.max(x1, sb.x + sb.w); } else { y0 = Math.min(y0, sb.y); y1 = Math.max(y1, sb.y + sb.h); }
    }
  } else {
    const h = houseEnvelope(plan);
    x0 = h.x0; y0 = h.y0; x1 = h.x1; y1 = h.y1;
  }
  const area = { x: MARGIN, y: MARGIN, w: SHEET.w - 2 * MARGIN, h: SHEET.h - 2 * MARGIN - TITLE_H };
  const padPx = ui.showSite ? 34 : (ui.showDimensions ? dimensionMargin(plan) : 0) + 24;
  const denom = SCALES.find((n) => (x1 - x0) * 50 / n + 2 * padPx <= area.w && (y1 - y0) * 50 / n + 2 * padPx <= area.h) || SCALES[SCALES.length - 1];
  const s = 50 / denom;                       // CSS px per plan cm on the sheet

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(SHEET.w * dpr); canvas.height = Math.round(SHEET.h * dpr);
  const ctx = canvas.getContext('2d');
  const ox = Math.round((area.x + area.w / 2 - ((x0 + x1) / 2) * s) * dpr);
  const oy = Math.round((area.y + area.h / 2 - ((y0 + y1) / 2) * s) * dpr);
  const G = createGfx(ctx, { scale: s, dpr, ox, oy, width: canvas.width, height: canvas.height, font: env.font });

  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.beginPath(); ctx.rect(Math.round(area.x * dpr), Math.round(area.y * dpr), Math.round(area.w * dpr), Math.round(area.h * dpr)); ctx.clip();
  paintUnder(G, e2);
  paintOver(G, e2);
  ctx.restore();
  G.deviceSpace();

  // frame + title block
  const fx = Math.round(MARGIN * dpr), fy = Math.round(MARGIN * dpr), fw = Math.round((SHEET.w - 2 * MARGIN) * dpr), fh = Math.round((SHEET.h - 2 * MARGIN) * dpr);
  const ty = fy + fh - Math.round(TITLE_H * dpr);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(fx, ty, fw, Math.round(TITLE_H * dpr));
  ctx.strokeStyle = pal.ink; ctx.lineWidth = Math.max(1, Math.round(1.5 * dpr));
  ctx.strokeRect(fx, fy, fw, fh);
  ctx.beginPath(); ctx.moveTo(fx, ty); ctx.lineTo(fx + fw, ty);
  const c1 = fx + Math.round(fw * 0.5), c2 = fx + Math.round(fw * 0.76);
  ctx.moveTo(c1, ty); ctx.lineTo(c1, fy + fh); ctx.moveTo(c2, ty); ctx.lineTo(c2, fy + fh);
  ctx.lineWidth = Math.max(1, Math.round(dpr)); ctx.stroke();

  const L = (t, x, y, o) => G.text(t, x, y, { align: 'left', baseline: 'alphabetic', color: pal.ink, ...o });
  const meta = plan.meta || {}, pad = 18 * dpr;
  const cap = { size: 8.5, weight: 600, color: pal.inkFaint, spacing: 0.16 };
  L('PROJECT', fx + pad, ty + 24 * dpr, cap);
  L(store.project.name || meta.name || 'Plan', fx + pad, ty + 52 * dpr, { size: 22, weight: 600 });
  const where = [meta.location, plan.site.lot != null ? `Lot ${plan.site.lot}` : null].filter(Boolean).join('  ·  ');
  L(where, fx + pad, ty + 74 * dpr, { size: 11.5, color: pal.inkSoft });
  L(ui.showSite ? 'Ground floor & site plan — furniture and garden layout' : 'Ground floor plan — furniture layout', fx + pad, ty + 91 * dpr, { size: 11.5, color: pal.inkSoft });

  const date = new Date().toISOString().slice(0, 10);
  const rows = [['DATE', date], ['SCALE', `1:${denom} when printed on A3 (420 × 297 mm)`],
    ['AREAS', [meta.grossFloorArea ? `House ${meta.grossFloorArea} m²` : null, `Lot ${Math.round(areaM2(plan.site.boundary))} m²`].filter(Boolean).join('  ·  ')]];
  rows.forEach(([k, v], i) => {
    const y = ty + (30 + i * 26) * dpr;
    L(k, c1 + pad, y, cap);
    L(v, c1 + pad + 64 * dpr, y, { size: 12, weight: 500 });
  });
  if (meta.architect) L(`Base drawing: ${meta.architect}`, c1 + pad, ty + 91 * dpr, { size: 10, color: pal.inkFaint });

  const bw = drawScaleBar(G, pal, c2 + pad, ty + 58 * dpr, ui.units, 150);
  drawNorthArrow(G, pal, Math.max(c2 + pad + bw + 60 * dpr, fx + fw - 64 * dpr), ty + 56 * dpr, meta.northAngle || 0, 20);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))), 'image/png');
  });
}
