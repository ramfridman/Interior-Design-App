/**
 * Openings: architectural symbols drawn exactly inside the wall gaps.
 *   window  — frame + glass (sliding = two overlapping panes, tilt = one pane, mamad = heavy frame + steel shutter pocket)
 *   door    — leaf + quarter-circle swing from `hinge` / `swing`, threshold lines. A doorway with `innerDoor`
 *             (the safe room: steel blast door + inner door) gets the second leaf on the other face of the wall,
 *             drawn dashed with a dashed swing — exactly as on the architect's sheet
 *   sliding-door — two overlapping glass panels
 *   opening — door-less passage: clear gap between the jambs with a fine dashed threshold on both faces
 * Local frame per opening: u runs along the wall (0..L), v across its thickness (0..T).
 */
import { css } from './color.js';
import { openingFrame, openingPoint, openingFaceSign, openingJambSign } from '../core/geometry.js';

function frame(o) {
  const F = openingFrame(o);
  return { L: F.L, T: F.T, P: (u, v) => openingPoint(F, u, v) };
}
/** v coordinate of the wall face on a side (`swing` / `outside` letter). */
const faceV = (o, T, side) => (openingFaceSign(o, side) < 0 ? 0 : T);
/** Pure helpers exposed for tests (tests/geometry.test.mjs). */
export { frame as openingLocalFrame, faceV as openingFaceV };

function localBox(G, f, u0, v0, u1, v1, fill, stroke, lw = 1) {
  const a = f.P(u0, v0), b = f.P(u1, v1);
  G.box(a[0], a[1], b[0], b[1], fill, stroke, lw);
}
function localSeg(G, f, u0, v0, u1, v1, lw = 1) {
  const a = f.P(u0, v0), b = f.P(u1, v1);
  G.seg(a[0], a[1], b[0], b[1], lw);
}

function drawWindow(G, pal, o) {
  const { ctx } = G, f = frame(o), { L, T } = f;
  const thick = T * G.k;
  localBox(G, f, 0, 0, L, T, pal.opening, pal.frame, 1);
  if (thick < 5) { ctx.beginPath(); localSeg(G, f, 0, T / 2, L, T / 2); ctx.strokeStyle = pal.frame; ctx.lineWidth = 1; ctx.stroke(); return; }
  const glass = pal.glass;
  if (o.style === 'mamad') {
    // heavy steel frame, glass pane inside, blast shutter half-way into its wall pocket on the outside face
    const out = faceV(o, T, o.outside || 'n') === 0;
    localBox(G, f, 0, 0, L, T, pal.opening, pal.frame, G.px(1.5));
    localBox(G, f, 0, out ? T * 0.55 : T * 0.2, L, out ? T * 0.8 : T * 0.45, glass, pal.frame, 1);
    const s0 = out ? T * 0.12 : T * 0.62, s1 = out ? T * 0.38 : T * 0.88;
    localBox(G, f, L, s0, L + L * 0.85, s1, pal.opening, pal.frame, 1);          // pocket in the wall
    localBox(G, f, L * 0.45, s0, L * 1.3, s1, css(pal.ink, 0.55), pal.frame, 1);  // the sliding steel leaf
    return;
  }
  if (o.style === 'sliding') {
    localBox(G, f, 0, T * 0.26, L * 0.54, T * 0.5, glass, pal.frame, 1);
    localBox(G, f, L * 0.46, T * 0.5, L, T * 0.74, glass, pal.frame, 1);
  } else {
    localBox(G, f, 0, T * 0.36, L, T * 0.64, glass, pal.frame, 1);
  }
}

function drawSlidingDoor(G, pal, o) {
  const { ctx } = G, f = frame(o), { L, T } = f;
  localBox(G, f, 0, 0, L, T, pal.opening, null);
  ctx.beginPath(); localSeg(G, f, 0, 0, L, 0); localSeg(G, f, 0, T, L, T);
  ctx.strokeStyle = pal.inkFaint; ctx.lineWidth = 1; ctx.stroke();
  localBox(G, f, 0, T * 0.24, L * 0.53, T * 0.5, pal.glass, pal.frame, 1);
  localBox(G, f, L * 0.47, T * 0.5, L, T * 0.76, pal.glass, pal.frame, 1);
}

/**
 * One hinged leaf with its swing. `d` = { hinge, swing, width } (the plan's side letters); `look` = { heavy, dashed }.
 * A dashed leaf is the secondary (inner) door of a double doorway.
 */
function drawLeaf(G, pal, o, f, d, look = {}) {
  const { ctx } = G, { L, T } = f;
  const W = Math.min(L, d.width || L);
  const hingeAtStart = openingJambSign(o, d.hinge) < 0;
  const uh = hingeAtStart ? 0 : L, dir = hingeAtStart ? 1 : -1;
  const vs = faceV(o, T, d.swing || 'n'), out = vs === 0 ? -1 : 1;
  const H = f.P(uh, vs), tip = f.P(uh, vs + out * W), closed = f.P(uh + dir * W, vs);
  const hx = G.X(H[0]), hy = G.Y(H[1]), r = W * G.k;
  const a0 = Math.atan2(tip[1] - H[1], tip[0] - H[0]), a1 = Math.atan2(closed[1] - H[1], closed[0] - H[0]);
  let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
  const dash = [5 * G.dpr, 3.5 * G.dpr];
  // swept area (very faint) + arc
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.arc(hx, hy, r, a0, a1, da < 0); ctx.closePath();
  ctx.fillStyle = css(pal.ink, (pal.dark ? 0.05 : 0.035) * (look.dashed ? 0.6 : 1)); ctx.fill();
  ctx.beginPath(); ctx.arc(hx, hy, r, a0, a1, da < 0);
  if (look.dashed) ctx.setLineDash(dash);
  ctx.strokeStyle = pal.inkSoft; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
  // leaf, standing open
  const thick = look.heavy ? 7 : 4;
  if (look.dashed) {
    const a = f.P(uh, vs), b = f.P(uh + dir * thick, vs + out * W);
    const x0 = G.RX(Math.min(a[0], b[0])) + 0.5, y0 = G.RY(Math.min(a[1], b[1])) + 0.5;
    const w = Math.max(2, G.RX(Math.max(a[0], b[0])) - G.RX(Math.min(a[0], b[0])) - 1), h = Math.max(2, G.RY(Math.max(a[1], b[1])) - G.RY(Math.min(a[1], b[1])) - 1);
    ctx.setLineDash(dash); ctx.strokeStyle = pal.frame; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, w, h); ctx.setLineDash([]);
  } else {
    localBox(G, f, uh, vs, uh + dir * thick, vs + out * W, look.heavy ? css(pal.ink, 0.6) : pal.white, pal.frame, 1);
  }
}

function drawDoor(G, pal, o) {
  const { ctx } = G, f = frame(o), { L, T } = f;
  localBox(G, f, 0, 0, L, T, pal.opening, null);
  // threshold
  ctx.beginPath(); localSeg(G, f, 0, 0, L, 0); localSeg(G, f, 0, T, L, T);
  ctx.strokeStyle = o.exterior ? pal.inkSoft : pal.inkFaint; ctx.lineWidth = 1; ctx.stroke();
  if (o.innerDoor) drawLeaf(G, pal, o, f, { width: o.width, ...o.innerDoor }, { dashed: true });
  drawLeaf(G, pal, o, f, o, { heavy: o.style === 'mamad' });
}

/** Door-less passage: the floor runs through; a fine dashed line marks the threshold on each face. */
function drawPassage(G, pal, o) {
  const { ctx } = G, f = frame(o), { L, T } = f;
  localBox(G, f, 0, 0, L, T, pal.opening, null);
  ctx.beginPath(); localSeg(G, f, 0, 0, L, 0); localSeg(G, f, 0, T, L, T);
  ctx.setLineDash([3 * G.dpr, 2.5 * G.dpr]); ctx.strokeStyle = pal.inkFaint; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
  // jambs (also part of the wall outline; repeated here so a ghost passage reads on its own)
  ctx.beginPath(); localSeg(G, f, 0, 0, 0, T); localSeg(G, f, L, 0, L, T);
  ctx.strokeStyle = pal.wallLine; ctx.lineWidth = 1; ctx.stroke();
}

/** Draw one opening symbol (also used for the placing ghost). */
export function drawOpening(G, pal, o) {
  if (o.kind === 'window') drawWindow(G, pal, o);
  else if (o.kind === 'sliding-door') drawSlidingDoor(G, pal, o);
  else if (o.kind === 'opening') drawPassage(G, pal, o);
  else drawDoor(G, pal, o);
}

export function drawOpenings(G, env) {
  const { plan, pal } = env;
  for (const o of plan.openings) {
    const reach = Math.max(o.w, o.h) + 10;
    if (!G.visible(o.x - reach, o.y - reach, o.x + o.w + reach, o.y + o.h + reach)) continue;
    drawOpening(G, pal, o);
  }
}
