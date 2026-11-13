/**
 * Interaction overlay, drawn live on every frame above the cached plan: hover / selection outlines, handles,
 * marquee, smart guides, clearance read-outs, measurements, the placing ghost and the scale bar / north arrow.
 * While a structure tool is active the furniture is not selectable and the structure overlay takes over.
 */
import { itemCorners, itemAABB, itemLocalToPlan, DEG } from '../core/geometry.js';
import { css } from './color.js';
import { roundRect } from './gfx.js';
import { drawItem } from './items.js';
import { drawScaleBar, drawNorthArrow } from './hud.js';
import { dimText } from './dimensions.js';
import { isResizable } from './snapping.js';
import { isStructureTool } from './structure.js';
import { drawStructureOverlay } from './structure-overlay.js';
import { fmtDim as fmt, pill, drawGuides, drawClearances } from './readouts.js';

export const ROTATE_STEM = 26;   // CSS px from the item's front edge to the rotate handle

const HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

/**
 * Screen-space (CSS px) handles of an item: 8 resize handles (when resizable) and the rotate handle.
 * @returns {{ kind:'resize'|'rotate', hx?:number, hy?:number, x:number, y:number, ax?:number, ay?:number }[]}
 */
export function itemHandles(it, cam) {
  const out = [];
  if (it.locked) return out;
  const S = (lx, ly) => { const [x, y] = itemLocalToPlan(it, lx, ly); return cam.toScreen(x, y); };
  if (isResizable(it)) {
    for (const [hx, hy] of HANDLES) { const p = S((hx * it.w) / 2, (hy * it.d) / 2); out.push({ kind: 'resize', hx, hy, x: p.x, y: p.y }); }
  }
  const a = S(0, it.d / 2), r = (it.rot || 0) * DEG;
  out.push({ kind: 'rotate', x: a.x - Math.sin(r) * ROTATE_STEM, y: a.y + Math.cos(r) * ROTATE_STEM, ax: a.x, ay: a.y });
  return out;
}

function outline(G, it, color, lw, fill, dash) {
  const { ctx } = G;
  const c = itemCorners(it);
  ctx.beginPath();
  c.forEach(([x, y], i) => (i ? ctx.lineTo(G.X(x), G.Y(y)) : ctx.moveTo(G.X(x), G.Y(y))));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (dash) ctx.setLineDash(dash);
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.setLineDash([]);
}

function lockGlyph(G, pal, x, y) {
  const { ctx } = G, d = G.dpr;
  ctx.save(); ctx.translate(Math.round(x), Math.round(y));
  ctx.beginPath(); ctx.arc(0, 0, 9 * d, 0, Math.PI * 2); ctx.fillStyle = pal.accent; ctx.fill();
  ctx.strokeStyle = pal.onAccent; ctx.lineWidth = 1.4 * d;
  ctx.beginPath(); ctx.arc(0, -1.5 * d, 2.6 * d, Math.PI, 0); ctx.stroke();
  roundRect(ctx, -4 * d, -1.5 * d, 8 * d, 6 * d, 1.2 * d); ctx.fillStyle = pal.onAccent; ctx.fill();
  ctx.restore();
}

function drawMeasure(G, pal, units, m, draft) {
  const { ctx } = G, d = G.dpr;
  const ax = G.X(m.a.x), ay = G.Y(m.a.y), bx = G.X(m.b.x), by = G.Y(m.b.y);
  const len = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
  const dx = Math.abs(m.b.x - m.a.x), dy = Math.abs(m.b.y - m.a.y);
  const col = pal.guide;
  if (dx > 0.5 && dy > 0.5) {
    // Δx / Δy legs
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, ay); ctx.lineTo(bx, by);
    ctx.setLineDash([4 * d, 3 * d]); ctx.strokeStyle = css(col, 0.55); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    if (Math.abs(bx - ax) > 46 * d) G.text(`Δx ${fmt(dx, units)}`, (ax + bx) / 2, ay + (by > ay ? -8 : 9) * d, { size: 9.5, color: col, halo: pal.halo });
    if (Math.abs(by - ay) > 30 * d) G.text(`Δy ${fmt(dy, units)}`, bx + (bx > ax ? 6 : -6) * d, (ay + by) / 2, { size: 9.5, color: col, halo: pal.halo, align: bx > ax ? 'left' : 'right' });
  }
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  ctx.strokeStyle = col; ctx.lineWidth = G.px(1.5); ctx.stroke();
  const ang = Math.atan2(by - ay, bx - ax), nx = -Math.sin(ang), ny = Math.cos(ang);
  ctx.beginPath();
  for (const [x, y] of [[ax, ay], [bx, by]]) { ctx.moveTo(x - nx * 6 * d, y - ny * 6 * d); ctx.lineTo(x + nx * 6 * d, y + ny * 6 * d); }
  ctx.stroke();
  for (const [x, y] of [[ax, ay], [bx, by]]) { ctx.beginPath(); ctx.arc(x, y, 2.5 * d, 0, Math.PI * 2); ctx.fillStyle = draft ? pal.handle : col; ctx.fill(); ctx.stroke(); }
  if (len > 0.5) pill(G, fmt(len, units), (ax + bx) / 2 + nx * 13 * d * (ny < 0 ? 1 : -1), (ay + by) / 2 + ny * 13 * d * (ny < 0 ? 1 : -1), col, '#ffffff');
}

/**
 * @param G  gfx for the main canvas
 * @param V  view internals { cam, env, state, theme }
 */
export function drawOverlay(G, V) {
  const { ctx } = G, d = G.dpr, { env, state: st, cam } = V, { pal, store, ui } = env;
  const units = ui.units;
  const fb = st.feedback;
  const structure = isStructureTool(ui.tool) && !st.placing;

  for (const m of st.measures) drawMeasure(G, pal, units, m, false);
  if (st.measureDraft) drawMeasure(G, pal, units, st.measureDraft, true);

  // placing ghost
  if (st.placing && st.placing.visible) {
    const ghost = st.placing.item;
    drawItem(G, env, ghost, { alpha: 0.78 });
    G.deviceSpace();
    outline(G, ghost, fb && fb.problems && fb.problems.any ? pal.danger : pal.accent, G.px(1.5), fb && fb.problems && fb.problems.any ? css(pal.danger, 0.16) : null);
  }

  if (ui.showItems && !structure) {
    const moving = st.gesture && (st.gesture.type === 'move' || st.gesture.type === 'resize' || st.gesture.type === 'rotate');
    const hover = st.hoverId && !moving && !store.selection.includes(st.hoverId) ? store.getItem(st.hoverId) : null;
    if (hover && !hover.hidden) outline(G, hover, css(pal.accent, 0.65), G.px(1.25));

    const selected = store.getSelected().filter((it) => !it.hidden);
    for (const it of selected) {
      const bad = moving && fb && fb.problems && fb.problems.any && st.live.has(it.id);
      outline(G, it, bad ? pal.danger : pal.accent, G.px(1.5), bad ? css(pal.danger, 0.18) : css(pal.accent, moving ? 0 : 0.05));
      if (it.locked) { const b = itemAABB(it); lockGlyph(G, pal, G.X(b.x + b.w), G.Y(b.y)); }
    }
    if (selected.length > 1 && !moving) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const it of selected) { const b = itemAABB(it); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
      ctx.setLineDash([5 * d, 4 * d]); ctx.strokeStyle = css(pal.accent, 0.7); ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(G.X(x0) - 5 * d) + 0.5, Math.round(G.Y(y0) - 5 * d) + 0.5, Math.round((x1 - x0) * G.k + 10 * d), Math.round((y1 - y0) * G.k + 10 * d));
      ctx.setLineDash([]);
    }
    // handles for a single selection
    if (selected.length === 1 && !st.placing && (!st.gesture || st.gesture.type === 'resize' || st.gesture.type === 'rotate') && ui.tool === 'select') {
      const it = selected[0];
      for (const h of itemHandles(it, cam)) {
        const x = h.x * d, y = h.y * d;
        if (h.kind === 'rotate') {
          ctx.beginPath(); ctx.moveTo(h.ax * d, h.ay * d); ctx.lineTo(x, y); ctx.strokeStyle = pal.accent; ctx.lineWidth = G.px(1.25); ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, 6 * d, 0, Math.PI * 2); ctx.fillStyle = pal.handle; ctx.fill(); ctx.strokeStyle = pal.accent; ctx.lineWidth = G.px(1.5); ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, 2.6 * d, -Math.PI * 0.85, Math.PI * 0.45); ctx.lineWidth = G.px(1.1); ctx.stroke();
        } else {
          const s = 4 * d;
          ctx.fillStyle = pal.handle; ctx.fillRect(Math.round(x - s), Math.round(y - s), 2 * s, 2 * s);
          ctx.strokeStyle = pal.accent; ctx.lineWidth = G.px(1.5); ctx.strokeRect(Math.round(x - s) + 0.5 * G.px(1.5), Math.round(y - s) + 0.5 * G.px(1.5), 2 * s - G.px(1.5), 2 * s - G.px(1.5));
        }
      }
    }
  }

  if (fb) {
    // wall faces being snapped to, alignment guides, then the live clearances to the nearest walls
    drawGuides(G, pal, fb.guides);
    drawClearances(G, pal, fb.clear, units);
    if (fb.box) {
      const cx = G.X(fb.box.x + fb.box.w / 2), top = G.Y(fb.box.y), bottom = G.Y(fb.box.y + fb.box.h);
      if (fb.size) pill(G, `${dimText(fb.size.w, units)} × ${fmt(fb.size.d, units)}`, cx, bottom + 15 * d, pal.ink, pal.paper, 10);
      if (fb.problems && fb.problems.any) pill(G, fb.problems.hint, cx, top - 15 * d, pal.danger, '#ffffff', 10);
      if (fb.angle != null) pill(G, `${Math.round(fb.angle * 10) / 10}°`, cx, top - 15 * d, pal.accent, pal.onAccent, 10.5);
    }
  }

  drawStructureOverlay(G, V);

  if (st.marquee) {
    const m = st.marquee;
    const x = Math.round(Math.min(m.x0, m.x1) * d), y = Math.round(Math.min(m.y0, m.y1) * d), w = Math.round(Math.abs(m.x1 - m.x0) * d), h = Math.round(Math.abs(m.y1 - m.y0) * d);
    ctx.fillStyle = css(pal.accent, 0.09); ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }

  // scale bar + north arrow, kept clear of floating UI via --plan-inset-*
  if (!V.showHud()) return;
  const ins = V.theme.insets;
  const bx = (ins.left + 18) * d, by = G.height - (ins.bottom + 20) * d;
  const bw = drawScaleBar(G, pal, bx, by, units);
  drawNorthArrow(G, pal, bx + bw + 46 * d, by - 12 * d, env.plan.meta?.northAngle || 0);
}
