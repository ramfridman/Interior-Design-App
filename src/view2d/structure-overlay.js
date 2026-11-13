/**
 * Live overlay of the structure tools, drawn on every frame above the cached plan: hover highlight (tinted by
 * policy level, padlock on locked parts), the selected wall segment / opening with its grips and read-outs,
 * the wall being drawn, the opening ghost, live distances while dragging, and the tooltip that carries the
 * engine's reason whenever something is locked or refused.
 */
import { css } from './color.js';
import { drawOpening } from './openings.js';
import { isStructureTool, structureOf, selectionHandles, policyOfTarget, spanOf } from './structure.js';
import { fmtDim, pill, pillWidth, drawGuides, drawClearances, drawTip, lockIcon } from './readouts.js';

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

function drawHandles(G, pal, handles, color, active) {
  const { ctx } = G, d = G.dpr;
  for (const h of handles) {
    const x = Math.round(h.x * d), y = Math.round(h.y * d), horiz = h.axis === 'h';
    const hot = active && active.kind === h.kind;
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
  if (o.kind === 'door' && o.swing) return o.swing === 'n' || o.swing === 'w' ? 1 : -1;
  if (o.outside) return o.outside === 'n' || o.outside === 'w' ? 1 : -1;
  return 1;
}

function drawSelection(G, V, d) {
  const { env, state: st, cam } = V, { pal, plan, ui } = env, S = st.struct, dpr = G.dpr;
  const sel = ui.structureSel;
  if (!sel) return;
  const policy = policyOfTarget(plan, sel), color = pal.level[policy.level] || pal.accent;
  const onColor = policy.level === 'free' ? pal.onAccent : (pal.dark ? '#16181b' : '#ffffff');
  const g = st.gesture, dragging = g && /^s-(move-wall|resize-wall|slide|width)$/.test(g.type);
  if (sel.type === 'segment') {
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
  if (!dragging || g.type === 's-width' || g.type === 's-resize-wall') {
    drawHandles(G, pal, selectionHandles(plan, sel, cam), color, dragging ? { kind: g.handle } : S.hoverHandle);
  }
}

function drawHover(G, V, d) {
  const { env, state: st } = V, { pal, plan, ui } = env, hv = st.struct.hover;
  if (!hv || st.gesture) return;
  const sel = ui.structureSel;
  if (sel && sel.type === hv.type && sel.id === hv.id) return;
  const color = pal.level[hv.level] || pal.accent;
  const r = hv.type === 'segment' ? d.byId.get(hv.id) : plan.openings.find((o) => o.id === hv.id);
  if (!r) return;
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
  }
}

function drawGhost(G, V, d) {
  const { env, state: st } = V, { pal, ui } = env, gh = st.struct.ghost, { ctx } = G;
  if (!gh || !gh.ok) return;
  const color = pal.level[gh.level] || pal.accent, onColor = gh.level === 'free' ? pal.onAccent : (pal.dark ? '#16181b' : '#ffffff');
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
  // the reason, next to the cursor
  const g = st.gesture, at = S.pointer;
  if (S.tip) drawTip(G, pal, S.tip.text, S.tip.tone, at);
  else if (S.draft && !S.draft.ok && S.draft.reason && S.draft.length >= 5) drawTip(G, pal, S.draft.reason, 'refused', at);
  else if (!g && S.ghost && !S.ghost.ok && S.ghost.reason) drawTip(G, pal, S.ghost.reason, S.ghost.lock ? 'locked' : 'note', at);
  else if (!g && ui.tool === 'structure' && S.hover && S.hover.level === 'locked') drawTip(G, pal, S.hover.reason, 'locked', at);
}
