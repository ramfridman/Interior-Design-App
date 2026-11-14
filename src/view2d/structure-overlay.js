/**
 * Live overlay of the structure tools, drawn on every frame above the cached plan: hover highlight (tinted by
 * policy level, padlock on locked parts), the selected wall segment / opening with its grips and read-outs,
 * the wall being drawn, the opening ghost, live distances while dragging, and the tooltip that carries the
 * engine's reason whenever something is locked or refused.
 */
import { css } from './color.js';
import { drawOpening } from './openings.js';
import { isStructureTool, structureOf, selectionHandles, policyOfTarget, spanOf, stairOn, voidOn } from './structure.js';
import { drawStairSymbol } from './stairs.js';
import { polygonBounds, openingPoly } from '../core/geometry.js';
import { fmtDim, pill, pillWidth, drawGuides, drawClearances, drawTip, lockIcon } from './readouts.js';
import { fillPolyPieces } from './structure.js';
import { drawSlantDims, drawAlignedChain } from './slant-dims.js';
import { lineFrame } from './slant-tools.js';

const GHOST_STYLE = { door: 'interior', window: 'sliding', opening: 'open' };

/** Crisp outline hugging the outside of a plan rect (`grow` device px away from it). */
function frame(G, r, color, lw, grow = 0, dash = null) {
  const { ctx } = G;
  const x0 = G.RX(r.x) - grow - lw, y0 = G.RY(r.y) - grow - lw, x1 = G.RX(r.x + r.w) + grow + lw, y1 = G.RY(r.y + r.h) + grow + lw;
  if (dash) ctx.setLineDash(dash);
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'miter';
  ctx.strokeRect(x0 + lw / 2, y0 + lw / 2, x1 - x0 - lw, y1 - y0 - lw);
  if (dash) ctx.setLineDash([]);
}
function fillRects(G, rects, color) {
  const { ctx } = G;
  ctx.beginPath();
  for (const r of rects) G.rect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = color; ctx.fill();
}
/** Padlock badge centred at device px (x, y). */
function lockBadge(G, pal, x, y) {
  const { ctx } = G, d = G.dpr;
  ctx.beginPath(); ctx.arc(Math.round(x), Math.round(y), 8.5 * d, 0, Math.PI * 2);
  ctx.fillStyle = pal.dark ? '#2b2f34' : '#ffffff'; ctx.fill();
  ctx.strokeStyle = pal.locked; ctx.lineWidth = G.px(1.25); ctx.stroke();
  lockIcon(G, x, y - 0.5 * d, pal.dark ? pal.ink : pal.inkSoft, 0.85);
}
function triangle(ctx, x, y, dx, dy, s) {
  // tip at (x + dx·s, y + dy·s), base centred on (x, y)
  ctx.moveTo(x + dx * s, y + dy * s); ctx.lineTo(x - dy * s * 0.8, y + dx * s * 0.8); ctx.lineTo(x + dy * s * 0.8, y - dx * s * 0.8); ctx.closePath();
}

/** Grips of an angled wall / an opening in one: the same shapes as the straight ones, turned to the wall. */
function drawAngledHandle(G, pal, h, color, hot) {
  const { ctx } = G, d = G.dpr, x = Math.round(h.x * d), y = Math.round(h.y * d);
  ctx.lineWidth = G.px(1.5); ctx.strokeStyle = color; ctx.fillStyle = hot ? color : pal.handle;
  if (h.kind === 'move' || h.kind === 'slide') {
    const along = h.kind === 'slide', ux = along ? h.ux : h.nx, uy = along ? h.uy : h.ny;
    ctx.beginPath(); ctx.arc(x, y, (along ? 5 : 6) * d, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const gap = (along ? 9.5 : 11.5) * d;
    ctx.beginPath();
    triangle(ctx, x + ux * gap, y + uy * gap, ux, uy, 4 * d);
    triangle(ctx, x - ux * gap, y - uy * gap, -ux, -uy, 4 * d);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = pal.handle; ctx.lineWidth = 1; ctx.stroke();
    return;
  }
  const bar = h.kind === 'w0' || h.kind === 'w1';
  // jamb grip: a bar across the wall; end grip: a square turned with the wall
  const a = bar ? 2.5 * d : 4.5 * d, b = bar ? 7.5 * d : 4.5 * d;
  ctx.beginPath();
  [[-a, -b], [a, -b], [a, b], [-a, b]].forEach(([p, q], i) => { const px = x + h.ux * p + h.nx * q, py = y + h.uy * p + h.ny * q; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

function drawHandles(G, pal, handles, color, active) {
  const { ctx } = G, d = G.dpr;
  for (const h of handles) {
    const x = Math.round(h.x * d), y = Math.round(h.y * d), horiz = h.axis === 'h';
    const hot = active && active.kind === h.kind;
    if (h.axis === 'a') { drawAngledHandle(G, pal, h, color, hot); continue; }
    ctx.lineWidth = G.px(1.5); ctx.strokeStyle = color; ctx.fillStyle = hot ? color : pal.handle;
    if (h.kind === 'move' || h.kind === 'slide') {
      // round grip with two arrow heads: across the wall for 'move', along it for 'slide'
      const along = h.kind === 'slide', ux = along === horiz ? 1 : 0, uy = along === horiz ? 0 : 1;
      ctx.beginPath(); ctx.arc(x, y, (along ? 5 : 6) * d, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const gap = (along ? 9.5 : 11.5) * d;
      ctx.beginPath();
      triangle(ctx, x + ux * gap, y + uy * gap, ux, uy, 4 * d);
      triangle(ctx, x - ux * gap, y - uy * gap, -ux, -uy, 4 * d);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = pal.handle; ctx.lineWidth = 1; ctx.stroke();
    } else if (h.kind === 'stair-rot') {
      // turning grip: a round button with a quarter-turn arrow
      ctx.beginPath(); ctx.arc(x, y, 8 * d, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 4.2 * d, -Math.PI * 0.9, Math.PI * 0.35); ctx.strokeStyle = hot ? pal.handle : color; ctx.lineWidth = G.px(1.4); ctx.stroke();
      const ax = x + Math.cos(Math.PI * 0.35) * 4.2 * d, ay = y + Math.sin(Math.PI * 0.35) * 4.2 * d;
      ctx.beginPath(); ctx.moveTo(ax + 2.6 * d, ay - 1.2 * d); ctx.lineTo(ax - 0.6 * d, ay + 2.6 * d); ctx.lineTo(ax - 2.2 * d, ay - 1.6 * d); ctx.closePath();
      ctx.fillStyle = hot ? pal.handle : color; ctx.fill();
    } else if (h.kind === 'stair-width' || h.kind.startsWith('ve')) {
      // a bar along the side it moves: across the stair's side / along the void's edge
      const along = h.kind === 'stair-width' ? h.axis !== 'h' : h.axis === 'h';
      const w = (along ? 15 : 5) * d, hh = (along ? 5 : 15) * d;
      ctx.beginPath(); ctx.rect(Math.round(x - w / 2) + 0.5, Math.round(y - hh / 2) + 0.5, Math.round(w), Math.round(hh)); ctx.fill(); ctx.stroke();
    } else if (h.kind === 'w0' || h.kind === 'w1') {
      // jamb grip: a short bar across the wall
      const w = (horiz ? 5 : 15) * d, hh = (horiz ? 15 : 5) * d;
      ctx.beginPath(); ctx.rect(Math.round(x - w / 2) + 0.5, Math.round(y - hh / 2) + 0.5, Math.round(w), Math.round(hh)); ctx.fill(); ctx.stroke();
    } else {
      const s = 4.5 * d;
      ctx.beginPath(); ctx.rect(Math.round(x - s) + 0.5, Math.round(y - s) + 0.5, Math.round(2 * s), Math.round(2 * s)); ctx.fill(); ctx.stroke();
    }
  }
}

/**
 * Mini dimension chain along a wall for an opening: distance to the wall's start, the width, distance to its end.
 * `side` = +1 (south / east of the wall) or −1.
 */
function drawOpeningChain(G, pal, units, axis, wall, open, side, color, onColor) {
  const { ctx } = G, d = G.dpr, horiz = axis === 'h';
  const face = side > 0 ? wall.c1 : wall.c0;
  const A = (v) => (horiz ? G.RX(v) : G.RY(v));
  const line = (horiz ? G.RY(face) : G.RX(face)) + side * Math.round(15 * d) + 0.5;
  const pts = [wall.a0, open.a0, open.a1, wall.a1].map(A);
  // line + ticks
  ctx.beginPath();
  if (horiz) { ctx.moveTo(pts[0], line); ctx.lineTo(pts[3], line); } else { ctx.moveTo(line, pts[0]); ctx.lineTo(line, pts[3]); }
  for (const p of pts) {
    if (horiz) { ctx.moveTo(p + 0.5, line - 4 * d); ctx.lineTo(p + 0.5, line + 4 * d); } else { ctx.moveTo(line - 4 * d, p + 0.5); ctx.lineTo(line + 4 * d, p + 0.5); }
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
  // figures: the two distances on the line, the width on it too when it fits, else one row further out
  const size = 9.5, ph = (size + 7) * d;
  const extent = (text) => (horiz ? pillWidth(G, text, size) : ph);
  const texts = [fmtDim(open.a0 - wall.a0, units), fmtDim(open.a1 - open.a0, units), fmtDim(wall.a1 - open.a1, units)];
  const widthFits = pts[2] - pts[1] >= extent(texts[1]) + 6 * d;
  const second = line + side * (horiz ? ph + 3 * d : Math.max(...texts.map((t) => pillWidth(G, t, size))) / 2 + pillWidth(G, texts[1], size) / 2 + 4 * d);
  const put = (text, a, across, bg, fg) => (horiz ? pill(G, text, a, across, bg, fg, size) : pill(G, text, across, a, bg, fg, size));
  const soft = pal.dark ? '#2b2f34' : '#ffffff';
  if (open.a0 - wall.a0 > 0.5) {
    const e = extent(texts[0]), mid = (pts[0] + pts[1]) / 2;
    put(texts[0], pts[1] - pts[0] >= e + 4 * d ? mid : Math.min(mid, pts[1] - e / 2 - 3 * d), line, soft, color);
  }
  if (wall.a1 - open.a1 > 0.5) {
    const e = extent(texts[2]), mid = (pts[2] + pts[3]) / 2;
    put(texts[2], pts[3] - pts[2] >= e + 4 * d ? mid : Math.max(mid, pts[2] + e / 2 + 3 * d), line, soft, color);
  }
  put(texts[1], (pts[1] + pts[2]) / 2, widthFits ? line : second, color, onColor);
}

/** Which side of its wall an opening's read-outs go: away from the door swing / inside for windows. */
function chainSide(o) {
  if (o.axis === 'a') {
    // the 'r' face is the +normal one: read-outs go to the other side of the swing / to the inside
    if (o.kind === 'door' && o.swing) return o.swing === 'r' ? -1 : 1;
    if (o.outside) return o.outside === 'r' ? -1 : 1;
    return 1;
  }
  if (o.kind === 'door' && o.swing) return o.swing === 'n' || o.swing === 'w' ? 1 : -1;
  if (o.outside) return o.outside === 'n' || o.outside === 'w' ? 1 : -1;
  return 1;
}

/** Outline of a plan polygon (selection / hover of an angled wall or an opening in one). */
function polyOutline(G, poly, color, lw, dash = null) {
  const { ctx } = G;
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(G.X(x), G.Y(y)) : ctx.moveTo(G.X(x), G.Y(y))));
  ctx.closePath();
  if (dash) ctx.setLineDash(dash);
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'miter'; ctx.stroke();
  if (dash) ctx.setLineDash([]);
}
/** Chain of an opening in an angled wall: wall start → jamb, the width, jamb → wall end, along the wall on `side`. */
function drawAngledOpeningChain(G, pal, units, seg, at, width, side, color) {
  const f = lineFrame(seg.x1, seg.y1, seg.x2, seg.y2), sg = side > 0 ? 1 : -1, hw = seg.t / 2;
  const nx = sg * f.nx, ny = sg * f.ny, pts = [0, at - width / 2, at + width / 2, f.len].filter((v, i, a) => i === 0 || v - a[i - 1] > 0.5);
  drawAlignedChain(G, pal, { a: [seg.x1 + nx * hw, seg.y1 + ny * hw], ux: f.ux, uy: f.uy, nx, ny, pts, offPx: 15, color, units, size: 9.5 });
}
/** Live read-out beside the pointer (CSS px), lifted above a finger on touch screens. */
function pointerPill(G, pal, text, at, bg, fg, touch) {
  if (!at) return;
  const d = G.dpr, w = pillWidth(G, text, 10.5);
  let x = at.x * d + 18 * d + w / 2, y = at.y * d - (touch ? 64 : 22) * d;
  if (x + w / 2 > G.width - 6 * d) x = at.x * d - 18 * d - w / 2;
  if (y < 12 * d) y = at.y * d + 30 * d;
  pill(G, text, x, y, bg, fg, 10.5);
}
/** Parallel / perpendicular / extension guides of the angle tools: the reference line, dashed, with a small ∥ or ⟂. */
function drawSlantGuides(G, pal, guides) {
  const { ctx } = G, d = G.dpr;
  for (const g of guides || []) {
    const x1 = G.X(g.x1), y1 = G.Y(g.y1), x2 = G.X(g.x2), y2 = G.Y(g.y2), len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const ext = g.kind === 'extension' ? 0 : 24 * d;
    ctx.beginPath(); ctx.moveTo(x1 - ux * ext, y1 - uy * ext); ctx.lineTo(x2 + ux * ext, y2 + uy * ext);
    ctx.setLineDash(g.kind === 'extension' ? [2 * d, 3 * d] : [6 * d, 3 * d]); ctx.strokeStyle = pal.guide; ctx.lineWidth = G.px(1.25); ctx.stroke(); ctx.setLineDash([]);
    if (g.kind === 'parallel' || g.kind === 'perp') {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      G.text(g.kind === 'parallel' ? '∥' : '⟂', mx - uy * 10 * d, my + ux * 10 * d, { size: 12, weight: 700, color: pal.guide, halo: pal.halo });
    }
  }
}

function drawSelection(G, V, d) {
  const { env, state: st, cam } = V, { pal, plan, ui } = env, S = st.struct, dpr = G.dpr;
  const sel = ui.structureSel;
  if (!sel) return;
  const policy = policyOfTarget(plan, sel), color = pal.level[policy.level] || pal.accent;
  const onColor = policy.level === 'free' ? pal.onAccent : (pal.dark ? '#16181b' : '#ffffff');
  const g = st.gesture, dragging = g && /^s-(move-wall|resize-wall|slide|width|move-stair|stair-rot|stair-width|void|move-slant|end-slant|slide-a|width-a)$/.test(g.type);
  if (sel.type === 'stair' || sel.type === 'void') {
    drawStairSelection(G, V, sel, color, onColor, dragging);
    if (!dragging || g.type === 's-stair-width' || g.type === 's-void') drawHandles(G, pal, selectionHandles(plan, sel, cam), color, dragging ? { kind: g.handle } : S.hoverHandle);
    return;
  }
  if (sel.type === 'segment' && d.byId.get(sel.id) && d.byId.get(sel.id).axis === 'a') {
    drawSlantSelection(G, V, d, d.byId.get(sel.id), policy, color, onColor, dragging);
  } else if (sel.type === 'opening' && (plan.openings.find((q) => q.id === sel.id) || {}).axis === 'a') {
    const o = plan.openings.find((q) => q.id === sel.id), quad = openingPoly(o, plan);
    polyOutline(G, quad, pal.halo, G.px(4)); polyOutline(G, quad, color, G.px(2));
    const seg = d.segOfOpening.get(o.id);
    if (seg) drawAngledOpeningChain(G, pal, ui.units, seg, o.at, o.width, chainSide(o), color);
    if (policy.level === 'locked') lockBadge(G, pal, G.X(o.cx), G.Y(o.cy));
  } else if (sel.type === 'segment') {
    const s = d.byId.get(sel.id);
    if (!s) return;
    frame(G, s, pal.halo, G.px(1), G.px(2));
    frame(G, s, color, G.px(2));
    if (policy.level === 'locked') lockBadge(G, pal, G.X(s.x + s.w / 2), G.Y(s.y + s.h / 2));
    // length · thickness, beside the middle of the wall (and how far it was dragged)
    const live = S.live && dragging ? S.live : null;
    let text = `${fmtDim(s.length, ui.units)}  ·  ${s.thickness} cm`;
    if (live && live.op === 'move-wall' && live.delta) text += `   ${live.delta > 0 ? '+' : '−'}${fmtDim(Math.abs(live.delta), ui.units)}`;
    const w = pillWidth(G, text, 10);
    if (s.axis === 'h') pill(G, text, G.X(s.x + s.w / 2), G.RY(s.y + s.h) + 27 * dpr, pal.ink, pal.paper, 10);
    else pill(G, text, G.RX(s.x + s.w) + 20 * dpr + w / 2, G.Y(s.y + s.h / 2), pal.ink, pal.paper, 10);
    if (live) drawClearances(G, pal, live.clear, ui.units, color, onColor);
  } else {
    const o = plan.openings.find((q) => q.id === sel.id);
    if (!o) return;
    frame(G, o, pal.halo, G.px(1), G.px(2));
    frame(G, o, color, G.px(2));
    const seg = d.segOfOpening.get(o.id);
    if (seg) drawOpeningChain(G, pal, ui.units, o.axis, spanOf(seg.core, seg.axis), spanOf(o, o.axis), chainSide(o), color, onColor);
    if (policy.level === 'locked') lockBadge(G, pal, G.X(o.x + o.w / 2), G.Y(o.y + o.h / 2));
  }
  if (!dragging || g.type === 's-width' || g.type === 's-resize-wall' || g.type === 's-width-a' || g.type === 's-end-slant') {
    drawHandles(G, pal, selectionHandles(plan, sel, cam), color, dragging ? { kind: g.handle } : S.hoverHandle);
  }
}

/** The selected angled wall: its outline, its read-out (length · thickness · angle), its dimensions and the drag guides. */
function drawSlantSelection(G, V, d, s, policy, color, onColor, dragging) {
  const { env, state: st } = V, { pal, plan, ui } = env, S = st.struct, dpr = G.dpr, { ctx } = G;
  polyOutline(G, s.poly, pal.halo, G.px(4)); polyOutline(G, s.poly, color, G.px(2));
  const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
  if (policy.level === 'locked') lockBadge(G, pal, G.X(mx), G.Y(my));
  // its dimensions (aligned, per face) and its angle to the nearest straight wall
  const openings = s.openingIds.map((id) => plan.openings.find((o) => o.id === id)).filter(Boolean);
  if (!ui.showDimensions) drawSlantDims(G, pal, s, openings, d.segs.filter((q) => q.axis !== 'a'), { units: ui.units, color: pal.ink });   // (else already on the plan)
  const live = S.live && dragging ? S.live : null;
  const angle = Math.round(((360 - Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180 / Math.PI) % 180) * 10) / 10;
  let text = `${fmtDim(s.length, ui.units)}  ·  ${s.thickness} cm  ·  ${angle % 180}°`;
  if (live && live.op === 'move-wall' && live.delta) text += `   ${live.delta > 0 ? '+' : '−'}${fmtDim(Math.abs(live.delta), ui.units)}`;
  if (live && live.n && st.gesture && st.gesture.type === 's-move-slant') {
    // the direction the wall may move: a guide across it through the grip
    const gx = G.X(mx), gy = G.Y(my), L = 60 * dpr;
    ctx.beginPath(); ctx.moveTo(gx - live.n[0] * L, gy - live.n[1] * L); ctx.lineTo(gx + live.n[0] * L, gy + live.n[1] * L);
    ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.strokeStyle = pal.guide; ctx.lineWidth = G.px(1.25); ctx.stroke(); ctx.setLineDash([]);
  }
  if (live && st.gesture && st.gesture.type === 's-end-slant') {
    drawSlantGuides(G, pal, live.guides);
    if (live.length != null) pointerPill(G, pal, `${fmtDim(live.length, ui.units)}  ·  ${live.angle}°`, S.pointer, color, onColor, S.touch);
  } else {
    const f = lineFrame(s.x1, s.y1, s.x2, s.y2), side = f.ny > 0 ? 1 : -1;      // below the wall on screen
    pill(G, text, G.X(mx + f.nx * side * (s.t / 2)) + f.nx * side * 30 * dpr, G.Y(my + f.ny * side * (s.t / 2)) + f.ny * side * 30 * dpr, pal.ink, pal.paper, 10);
  }
}

/** Outline of a plan ring, `grow` device px wide. */
function ringPath(G, ring) {
  const { ctx } = G;
  ctx.beginPath();
  ring.forEach((p, i) => (i ? ctx.lineTo(G.X(p[0]), G.Y(p[1])) : ctx.moveTo(G.X(p[0]), G.Y(p[1]))));
  ctx.closePath();
}
const metres = (cm) => `${(cm / 100).toFixed(2)} m`;
/** A selected stair (outline, read-out, clearances while dragging) or a selected opening in the floor (outline, size). */
function drawStairSelection(G, V, sel, color, onColor, dragging) {
  const { env, state: st } = V, { pal, plan, ui } = env, S = st.struct, { ctx } = G, dpr = G.dpr;
  if (sel.type === 'stair') {
    const s = stairOn(plan, sel.id);
    if (!s) return;
    ringPath(G, s.geo.footprint); ctx.strokeStyle = pal.halo; ctx.lineWidth = G.px(4); ctx.stroke();
    ringPath(G, s.geo.footprint); ctx.fillStyle = css(color, 0.1); ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = G.px(2); ctx.stroke();
    const b = polygonBounds(s.geo.footprint), geo = s.geo;
    const text = `${geo.risers} × ${(geo.riser).toFixed(1)} cm  ·  going ${geo.going}  ·  ${geo.width} wide`;
    pill(G, text, G.RX(b.x + b.w) + 16 * dpr + pillWidth(G, text, 10) / 2, G.Y(b.y + b.h / 2), pal.ink, pal.paper, 10);
    const live = S.live && S.live.stair === sel.id && dragging ? S.live : null;
    if (live) drawStairReadouts(G, pal, ui.units, live, color, onColor);
    return;
  }
  const v = voidOn(plan, sel.id);
  if (!v) return;
  ringPath(G, v.polygon); ctx.strokeStyle = pal.halo; ctx.lineWidth = G.px(4); ctx.stroke();
  ringPath(G, v.polygon); ctx.fillStyle = css(color, 0.12); ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = G.px(2); ctx.stroke();
  const b = polygonBounds(v.polygon);
  pill(G, `Opening ${metres(b.w)} × ${metres(b.h)}`, G.X(b.x + b.w / 2), G.RY(b.y + b.h) + 18 * dpr, pal.ink, pal.paper, 10);
}
/** Free width beside a stair being moved / placed (to the walls) and the distance to the nearest door swing. */
function drawStairReadouts(G, pal, units, r, color, onColor) {
  if (r.clear) drawClearances(G, pal, r.clear.filter((c) => c.dist <= 300), units, color, onColor);
  if (r.door) {
    const { ctx } = G, d = G.dpr, [ax, ay, bx, by] = r.door.pts;
    ctx.beginPath(); ctx.moveTo(G.X(ax), G.Y(ay)); ctx.lineTo(G.X(bx), G.Y(by));
    ctx.setLineDash([3 * d, 2 * d]); ctx.strokeStyle = pal.warn; ctx.lineWidth = G.px(1.5); ctx.stroke(); ctx.setLineDash([]);
    const text = r.door.d < 0.5 ? 'In a door swing' : `Door swing ${fmtDim(r.door.d, units)}`;
    pill(G, text, (G.X(ax) + G.X(bx)) / 2, (G.Y(ay) + G.Y(by)) / 2 - 12 * d, r.door.d < 0.5 ? pal.danger : pal.warn, '#ffffff', 9.5);
  }
}
/** The stair being placed with the Stairs tool: green-ish (the level colour) when it fits, red with the reason when not. */
function drawStairGhost(G, V) {
  const { env, state: st } = V, { pal, ui } = env, gh = st.struct.stairGhost, { ctx } = G;
  if (!gh || !gh.geo) return;
  const color = gh.ok ? (pal.level[gh.level] || pal.accent) : pal.danger;
  ctx.save(); ctx.globalAlpha = 0.9;
  drawStairSymbol(G, pal, gh.geo, { color, cut: false, fill: css(color, 0.12) });
  ctx.restore();
  // the opening it needs in the floor above, dashed
  for (const ring of gh.need || []) {
    ringPath(G, ring); ctx.setLineDash([5 * G.dpr, 4 * G.dpr]); ctx.strokeStyle = css(color, 0.8); ctx.lineWidth = G.px(1.25); ctx.stroke(); ctx.setLineDash([]);
  }
  if (gh.ok) drawStairReadouts(G, pal, ui.units, gh, color, gh.level === 'free' ? pal.onAccent : '#ffffff');
}

function drawHover(G, V, d) {
  const { env, state: st } = V, { pal, plan, ui } = env, hv = st.struct.hover;
  if (!hv || st.gesture) return;
  const sel = ui.structureSel;
  if (sel && sel.type === hv.type && sel.id === hv.id) return;
  const color = pal.level[hv.level] || pal.accent;
  if (hv.type === 'stair' || hv.type === 'void') {
    const ring = hv.type === 'stair' ? (stairOn(plan, hv.id) || {}).geo?.footprint : (voidOn(plan, hv.id) || {}).polygon;
    if (!ring) return;
    ringPath(G, ring); G.ctx.fillStyle = css(color, 0.14); G.ctx.fill(); G.ctx.strokeStyle = color; G.ctx.lineWidth = G.px(1.5); G.ctx.stroke();
    return;
  }
  const r = hv.type === 'segment' ? d.byId.get(hv.id) : plan.openings.find((o) => o.id === hv.id);
  if (!r) return;
  if (r.axis === 'a') {
    // an angled wall / an opening in one: its footprint (gaps left out) or its gap quad
    if (hv.type === 'segment') { fillPolyPieces(G, d.polys.get(hv.id) || [], css(color, hv.level === 'locked' ? 0.5 : 0.8)); polyOutline(G, r.poly, color, G.px(1.5)); }
    else { const quad = openingPoly(r, plan); G.poly(quad); G.ctx.fillStyle = css(color, 0.22); G.ctx.fill(); polyOutline(G, quad, color, G.px(1.5)); }
    const cx = hv.type === 'segment' ? (r.x1 + r.x2) / 2 : r.cx, cy = hv.type === 'segment' ? (r.y1 + r.y2) / 2 : r.cy;
    if (hv.level === 'locked') lockBadge(G, pal, G.X(cx), G.Y(cy));
    return;
  }
  if (hv.type === 'segment') fillRects(G, d.pieces.get(hv.id) || [], css(color, hv.level === 'locked' ? 0.5 : 0.8));
  else fillRects(G, [r], css(color, 0.22));
  frame(G, r, color, G.px(1.5));
  if (hv.level === 'locked') lockBadge(G, pal, G.X(r.x + r.w / 2), G.Y(r.y + r.h / 2));
}

function drawDraft(G, V) {
  const { env, state: st } = V, { pal, ui } = env, S = st.struct, D = S.draft, { ctx } = G, d = G.dpr;
  if (S.marker && !D) {
    // where a wall would start: a small target that fills in when it caught a corner or a wall face
    const x = Math.round(G.X(S.marker.x)) + 0.5, y = Math.round(G.Y(S.marker.y)) + 0.5, r = 4 * d;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = S.marker.kind ? pal.guide : pal.handle; ctx.fill();
    ctx.strokeStyle = S.marker.kind ? pal.guide : pal.accent; ctx.lineWidth = G.px(1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 9 * d, y); ctx.lineTo(x - 5.5 * d, y); ctx.moveTo(x + 5.5 * d, y); ctx.lineTo(x + 9 * d, y);
    ctx.moveTo(x, y - 9 * d); ctx.lineTo(x, y - 5.5 * d); ctx.moveTo(x, y + 5.5 * d); ctx.lineTo(x, y + 9 * d);
    ctx.lineWidth = 1; ctx.stroke();
  }
  if (D && D.angled && D.poly) { drawAngledDraft(G, V, D); return; }
  if (!D || !D.rect) return;
  const bad = !D.ok && D.length >= 5, color = bad ? pal.danger : pal.accent;
  drawGuides(G, pal, D.guides);
  fillRects(G, [D.rect], css(color, 0.42));
  frame(G, D.rect, color, G.px(1.5), -G.px(1.5));
  if (D.length >= 5) {
    if (D.ok) drawClearances(G, pal, D.clear, ui.units);
    const text = `${fmtDim(D.length, ui.units)}  ·  ${D.thickness} cm`, w = pillWidth(G, text, 10);
    const r = D.rect, onColor = bad ? '#ffffff' : pal.onAccent;
    if (D.axis === 'h') pill(G, text, G.X(r.x + r.w / 2), G.RY(r.y) - 15 * d, color, onColor, 10);
    else pill(G, text, G.RX(r.x) - 9 * d - w / 2, G.Y(r.y + r.h / 2), color, onColor, 10);
    // angled walls switched on: the angle (and anything typed) beside the pointer too
    if (D.readout) pointerPill(G, pal, readoutText(D), S.pointer, color, onColor, S.touch);
  }
}

/** "3.25 m · 45°", with the typed field shown while a length / an angle is being typed. */
function readoutText(D) {
  const T = D.typed;
  if (!T || (!T.len && !T.ang && T.field === 'len')) return D.readout;
  const caret = (f) => (T.field === f ? '▏' : '');
  return `Length ${T.len || '…'}${caret('len')}  ·  Angle ${T.ang || '…'}${caret('ang')}°`;
}
/** A wall being drawn at an angle: its footprint (the engine's verdict in its colour), joined ends, guides, read-out. */
function drawAngledDraft(G, V, D) {
  const { env, state: st } = V, { pal } = env, S = st.struct, { ctx } = G, d = G.dpr;
  const bad = !D.ok && D.length >= 30, color = bad ? pal.danger : pal.accent, onColor = bad ? '#ffffff' : pal.onAccent;
  drawSlantGuides(G, pal, D.slantGuides);
  G.poly(D.poly); ctx.fillStyle = css(color, 0.42); ctx.fill();
  polyOutline(G, D.poly, color, G.px(1.5));
  // the ends the engine joins to other walls
  (D.ends || []).forEach(([x, y], k) => {
    if (!D.joined || !D.joined[k]) return;
    ctx.beginPath(); ctx.arc(G.X(x), G.Y(y), 4.5 * d, 0, Math.PI * 2);
    ctx.fillStyle = pal.guide; ctx.fill(); ctx.strokeStyle = pal.handle; ctx.lineWidth = G.px(1.25); ctx.stroke();
  });
  if (D.length >= 5) pointerPill(G, pal, readoutText(D), S.pointer, color, onColor, S.touch);
}

function drawGhost(G, V, d) {
  const { env, state: st } = V, { pal, ui } = env, gh = st.struct.ghost, { ctx } = G;
  if (!gh || !gh.ok) return;
  const color = pal.level[gh.level] || pal.accent, onColor = gh.level === 'free' ? pal.onAccent : (pal.dark ? '#16181b' : '#ffffff');
  if (gh.axis === 'a') {
    // in an angled wall: the symbol turned to the wall, its gap quad, the chain along the wall
    const o = { kind: gh.kind, style: GHOST_STYLE[gh.kind], axis: 'a', wall: gh.wall, at: gh.at, cx: gh.cx, cy: gh.cy, angle: gh.angle, t: gh.t, width: gh.width, hinge: gh.hinge, swing: gh.swing, exterior: gh.level === 'permit' };
    ctx.save(); ctx.globalAlpha = 0.92; drawOpening(G, pal, o); ctx.restore();
    G.poly(gh.quad); ctx.fillStyle = css(color, 0.16); ctx.fill();
    polyOutline(G, gh.quad, color, G.px(1.5));
    const seg = d.byId.get(gh.segmentId);
    if (seg) drawAngledOpeningChain(G, pal, ui.units, seg, gh.at, gh.width, chainSide(o), color);
    return;
  }
  const o = { kind: gh.kind, style: GHOST_STYLE[gh.kind], axis: gh.axis, ...gh.rect, width: gh.width, hinge: gh.hinge, swing: gh.swing, exterior: gh.level === 'permit' };
  ctx.save(); ctx.globalAlpha = 0.92;
  drawOpening(G, pal, o);
  ctx.restore();
  fillRects(G, [gh.rect], css(color, 0.16));
  frame(G, gh.rect, color, G.px(1.5));
  const seg = d.byId.get(gh.segmentId);
  if (seg) drawOpeningChain(G, pal, ui.units, gh.axis, spanOf(seg.core, seg.axis), spanOf(gh.rect, gh.axis), chainSide(o), color, onColor);
}

/** Pulse that shows where focusPlanPoint() landed. */
function drawFlash(G, V) {
  const f = V.state.flash;
  if (!f) return;
  const { ctx } = G, d = G.dpr, pal = V.env.pal;
  const t = (performance.now() - f.t0) / 1500;
  if (t < 0 || t >= 1) return;
  const x = G.X(f.x), y = G.Y(f.y), k = (t * 2) % 1;
  ctx.beginPath(); ctx.arc(x, y, (9 + 22 * k) * d, 0, Math.PI * 2);
  ctx.strokeStyle = css(pal.guide, 1 - k); ctx.lineWidth = G.px(2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, 3 * d, 0, Math.PI * 2); ctx.fillStyle = css(pal.guide, 1 - t * t); ctx.fill();
}

/**
 * @param G  gfx for the main canvas (device space)
 * @param V  view internals { cam, env, state }
 */
export function drawStructureOverlay(G, V) {
  const { env, state: st } = V, { pal, plan, ui } = env, S = st.struct;
  drawFlash(G, V);
  if (!S || !isStructureTool(ui.tool) || st.placing) return;
  const d = structureOf(plan);
  drawHover(G, V, d);
  drawSelection(G, V, d);
  drawDraft(G, V);
  drawGhost(G, V, d);
  drawStairGhost(G, V);
  // the reason, next to the cursor
  const g = st.gesture, at = S.pointer;
  if (S.tip) drawTip(G, pal, S.tip.text, S.tip.tone, at);
  else if (S.draft && !S.draft.ok && S.draft.reason && S.draft.length >= 5) drawTip(G, pal, S.draft.reason, 'refused', at);
  else if (!g && S.ghost && !S.ghost.ok && S.ghost.reason) drawTip(G, pal, S.ghost.reason, S.ghost.lock ? 'locked' : 'note', at);
  else if (ui.tool === 'stairs' && S.stairGhost && !S.stairGhost.ok && S.stairGhost.reason) drawTip(G, pal, S.stairGhost.reason, S.stairGhost.lock ? 'locked' : 'note', at);
  else if (!g && ui.tool === 'structure' && S.hover && S.hover.level === 'locked') drawTip(G, pal, S.hover.reason, 'locked', at);
}
