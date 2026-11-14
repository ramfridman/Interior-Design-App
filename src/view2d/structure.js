/**
 * Structure editing — what the view derives from one plan revision (docs/CONTRACT.md § 7) and the parts of it
 * that are painted into the cached plan layers:
 *   • wall poché tinted by policy level while a structure tool is active (free / warn / locked);
 *   • the "changes" overlay: new walls tinted, removed architect walls as dashed ghosts, markers on openings
 *     that were added / changed / removed (also part of the PNG export).
 * Everything is recomputed lazily when the engine hands out a new `wallSegments()` array — nothing is kept
 * across plan revisions.
 */
import { wallSegments, openingPolicy, planDiff, isPlanModified, BASE_PLAN, levelPlan, planPhase, REASONS } from '../core/plan-edit.js';
import { polygonBounds, openingPoly, openingFrame, openingPoint } from '../core/geometry.js';
import { slantHandles } from './slant-tools.js';
import { css } from './color.js';
import { chainSignatures } from './annotations.js';
import { PLAN } from '../core/plan.js';
import { stairsSnapshot, stairsOfLevel, stairHandles, voidHandles } from './stairs.js';
import { voidsOf } from '../core/levels.js';

export const STRUCTURE_TOOLS = ['structure', 'wall', 'door', 'window', 'passage', 'stairs'];
/** Is `tool` one of the wall / door / window editing tools? */
export const isStructureTool = (tool) => STRUCTURE_TOOLS.includes(tool);
/** Engine opening kind placed by each opening tool. */
export const OPENING_TOOL_KIND = { door: 'door', window: 'window', passage: 'opening' };
/** Junction squares where two walls cross belong to neither wall — they are not selectable. */
export const isJunction = (seg) => seg.id.includes('seg:j:');   // upper levels prefix the id ('L1|seg:j:…')

/** Distance from a point to a rectangle { x, y, w, h } (0 inside). */
export function rectDist(px, py, r) {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w)), dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** Span of a rect along / across a wall axis: { a0, a1 } along, { c0, c1 } across. */
export function spanOf(r, axis) {
  return axis === 'h' ? { a0: r.x, a1: r.x + r.w, c0: r.y, c1: r.y + r.h } : { a0: r.y, a1: r.y + r.h, c0: r.x, c1: r.x + r.w };
}
/** Rect from spans (inverse of spanOf). */
export const rectOf = (axis, a0, a1, c0, c1) => (axis === 'h' ? { x: a0, y: c0, w: a1 - a0, h: c1 - c0 } : { x: c0, y: a0, w: c1 - c0, h: a1 - a0 });

/** [a0, a1] minus a list of [lo, hi] intervals → remaining intervals. */
function subtract(a0, a1, cuts) {
  const out = [];
  let from = a0;
  for (const [lo, hi] of cuts.slice().sort((p, q) => p[0] - q[0])) {
    if (hi <= from) continue;
    if (lo >= a1) break;
    if (lo > from) out.push([from, lo]);
    from = Math.max(from, hi);
  }
  if (from < a1) out.push([from, a1]);
  return out;
}

const cache = new WeakMap();

/**
 * Derived data of the current plan revision:
 *   segs        selectable wall segments (no junction squares)
 *   byId        Map id → segment (all segments)
 *   pieces      Map id → solid wall rectangles of the segment (its rectangle minus its openings)
 *   segOfOpening  Map opening id → its segment
 */
export function structureOf(plan) {
  const segments = wallSegments(plan);
  let d = cache.get(segments);
  if (d && d.openings === plan.openings) return d;
  const openings = new Map(plan.openings.map((o) => [o.id, o]));
  d = { openings: plan.openings, segments, segs: [], byId: new Map(), pieces: new Map(), polys: new Map(), segOfOpening: new Map(), removed: null, diff: null };
  for (const s of segments) {
    d.byId.set(s.id, s);
    if (!isJunction(s)) d.segs.push(s);
    if (s.axis === 'a') {
      // an angled wall (stage A3): its joined footprint, with the gap quads of its openings as holes (even-odd fill)
      const holes = [];
      for (const id of s.openingIds) { const o = openings.get(id); if (o) { d.segOfOpening.set(id, s); holes.push(openingPoly(o, plan)); } }
      d.pieces.set(s.id, []);
      d.polys.set(s.id, [{ poly: s.poly, holes }]);
      continue;
    }
    const { a0, a1, c0, c1 } = spanOf(s, s.axis);
    const cuts = [];
    for (const id of s.openingIds) {
      const o = openings.get(id);
      if (!o) continue;
      d.segOfOpening.set(id, s);
      const q = spanOf(o, s.axis);
      cuts.push([q.a0, q.a1]);
    }
    d.pieces.set(s.id, subtract(a0, a1, cuts).map(([p, q]) => rectOf(s.axis, p, q, c0, c1)));
  }
  cache.set(segments, d);
  return d;
}

/** Policy of a selectable target: `{ level, reason }`. */
export function policyOfTarget(plan, target) {
  if (!target) return { level: 'locked', reason: '' };
  if (target.type === 'opening') return openingPolicy(target.id);
  if (target.type === 'stair' || target.type === 'void') return stairPolicy();
  const s = structureOf(plan).byId.get(target.id);
  return s ? s.policy : { level: 'locked', reason: '' };
}

/** Stairs and openings in floors (stage F4b): a structural change — 'permit' in a fixed plan, free while drafting. */
export const stairPolicy = () => (planPhase() === 'draft' ? { level: 'free', reason: '' } : { level: 'permit', reason: REASONS.stair });
/** The stair `id` that starts on the level view `plan` (with its geometry), or null. */
export const stairOn = (plan, id) => stairsOfLevel(PLAN, plan.levelId || 'L0').bottom.find((s) => s.stair.id === id) || null;
/** The void `id` of the level view `plan`, or null. */
export const voidOn = (plan, id) => voidsOf(plan).find((v) => v.id === id) || null;

/**
 * Screen-space (CSS px) grips of the selected wall segment / opening:
 *   segment — 'move' (middle, drags the wall sideways) and 'end0' / 'end1' on free wall ends
 *   opening — 'slide' (middle) and 'w0' / 'w1' on the jambs (width)
 * Locked targets have none. @returns {{ kind:string, axis:'h'|'v', x:number, y:number }[]}
 */
export function selectionHandles(plan, sel, cam) {
  const out = [];
  if (!sel) return out;
  if (sel.type === 'segment') {
    const s = structureOf(plan).byId.get(sel.id);
    if (!s || isJunction(s) || s.policy.level === 'locked') return out;
    if (s.axis === 'a') return slantHandles(s, (x, y) => cam.toScreen(x, y), cam.scale);
    const { a0, a1, c0, c1 } = spanOf(s.core, s.axis), c = (c0 + c1) / 2;
    const P = (a) => (s.axis === 'h' ? cam.toScreen(a, c) : cam.toScreen(c, a));
    if ((a1 - a0) * cam.scale >= 30 || !(s.freeEnds[0] || s.freeEnds[1])) out.push({ kind: 'move', axis: s.axis, ...P((a0 + a1) / 2) });
    if (s.freeEnds[0]) out.push({ kind: 'end0', axis: s.axis, ...P(a0) });
    if (s.freeEnds[1]) out.push({ kind: 'end1', axis: s.axis, ...P(a1) });
  } else if (sel.type === 'stair') {
    const st = stairOn(plan, sel.id);
    if (st) out.push(...stairHandles(st.geo, cam));
  } else if (sel.type === 'void') {
    const v = voidOn(plan, sel.id);
    if (v) out.push(...voidHandles(v, cam));
  } else if (sel.type === 'opening') {
    const o = plan.openings.find((q) => q.id === sel.id);
    if (!o || openingPolicy(o.id).level === 'locked') return out;
    if (o.axis === 'a') {
      // in an angled wall: jamb grips and the slide grip on the centre line, oriented along the wall
      const F = openingFrame(o, plan), P = (u) => { const q = openingPoint(F, u, F.T / 2); return cam.toScreen(q[0], q[1]); };
      const dir = { axis: 'a', ux: F.ux, uy: F.uy, nx: F.nx, ny: F.ny };
      out.push({ kind: 'w0', ...dir, ...P(0) }, { kind: 'w1', ...dir, ...P(F.L) });
      if (F.L * cam.scale >= 34) out.push({ kind: 'slide', ...dir, ...P(F.L / 2) });
      return out;
    }
    const { a0, a1, c0, c1 } = spanOf(o, o.axis), c = (c0 + c1) / 2;
    const P = (a) => (o.axis === 'h' ? cam.toScreen(a, c) : cam.toScreen(c, a));
    out.push({ kind: 'w0', axis: o.axis, ...P(a0) }, { kind: 'w1', axis: o.axis, ...P(a1) });
    if ((a1 - a0) * cam.scale >= 34) out.push({ kind: 'slide', axis: o.axis, ...P((a0 + a1) / 2) });
  }
  return out;
}

/** Parts of the architect's walls that are no longer wall (removed or moved away), as rectangles. */
function removedWalls(plan, d) {
  if (d.removed) return d.removed;
  const solids = [...plan.walls, ...plan.openings.filter((o) => o.axis !== 'a')], out = [];
  // an upper level is compared with the same level of the base plan (none: a new floor, nothing was removed)
  const base = plan.levelId && plan.levelId !== 'L0' ? levelPlan(BASE_PLAN, plan.levelId) : BASE_PLAN;
  if (!base) { d.removed = out; return out; }
  const now = new Set((plan.slants || []).map((x) => `${x.x1},${x.y1},${x.x2},${x.y2},${x.t}`));
  for (const b of wallSegments(base)) {
    if (b.axis === 'a') {
      // an angled wall of the base plan that is no longer there (removed, moved or turned): its footprint as a polygon
      if (!now.has(`${b.x1},${b.y1},${b.x2},${b.y2},${b.t}`)) out.push({ poly: b.poly, ...polygonBounds(b.poly) });
      continue;
    }
    const { a0, a1, c0, c1 } = spanOf(b, b.axis);
    const cover = [];
    for (const r of solids) {
      const q = spanOf(r, b.axis);
      if (q.a1 <= a0 || q.a0 >= a1 || Math.min(c1, q.c1) - Math.max(c0, q.c0) < (c1 - c0) / 2) continue;
      cover.push([q.a0, q.a1]);
    }
    for (const [p, q] of subtract(a0, a1, cover)) if (q - p >= 1) out.push(rectOf(b.axis, p, q, c0, c1));
  }
  d.removed = out;
  return out;
}

/** Should the "changes from the architect's plan" overlay be drawn? */
export const showsChanges = (env) => !!env.ui.showPlanChanges && isPlanModified();

/**
 * Wall fills that replace the normal poché: level tints while a structure tool is active, and the accent tint
 * of walls that are not on the architect's plan. Called by drawWalls between the fills and the outline.
 */
export function drawWallTints(G, env) {
  const { plan, pal, ui } = env, { ctx } = G;
  const levels = isStructureTool(ui.tool) && !env.exporting, changes = showsChanges(env);
  if (!levels && !changes) return;
  const d = structureOf(plan);
  const groups = { free: [], warn: [], locked: [], fresh: [] }, polys = { free: [], warn: [], locked: [], fresh: [] };
  for (const s of d.segments) {
    const key = changes && s.isNew ? 'fresh' : levels ? s.policy.level : null;
    if (key && groups[key]) { groups[key].push(...d.pieces.get(s.id)); if (d.polys.has(s.id)) polys[key].push(...d.polys.get(s.id)); }
  }
  const fills = { locked: pal.wallTint.locked, warn: pal.wallTint.warn, free: pal.wallTint.free, fresh: pal.wallNew };
  for (const key of ['locked', 'warn', 'free', 'fresh']) {
    if (!groups[key].length && !polys[key].length) continue;
    ctx.beginPath();
    for (const r of groups[key]) G.rect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = fills[key]; ctx.fill();
    if (polys[key].length) fillPolyPieces(G, polys[key], fills[key]);
  }
}

/** Fill angled-wall pieces ({ poly, holes }) — the holes (gaps of openings) are left out (even-odd). */
export function fillPolyPieces(G, pieces, color) {
  const { ctx } = G;
  for (const { poly, holes } of pieces) {
    ctx.beginPath();
    for (const ring of [poly, ...(holes || [])]) ring.forEach(([x, y], i) => (i ? ctx.lineTo(G.RX(x), G.RY(y)) : ctx.moveTo(G.RX(x), G.RY(y))));
    ctx.fillStyle = color; ctx.fill('evenodd');
  }
}

/** Dashed ghosts of the architect's walls that were removed or moved away. */
export function drawRemovedWalls(G, env) {
  if (!showsChanges(env)) return;
  const { plan, pal } = env, { ctx } = G;
  const all = removedWalls(plan, structureOf(plan));
  if (!all.length) return;
  const list = all.filter((r) => !r.poly), polys = all.filter((r) => r.poly);
  const dpr = G.dpr;
  if (polys.length) drawRemovedPolys(G, env, polys);
  if (!list.length) return;
  ctx.save();
  ctx.beginPath();
  for (const r of list) G.rect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = pal.removedFill || css(pal.ink, 0.07); ctx.fill();
  // 45° hatch inside the ghost: readable on any floor tint, and never mistaken for a wall that is still there
  ctx.clip();
  const step = Math.max(4, Math.round(5 * dpr));
  ctx.beginPath();
  for (const r of list) {
    const x0 = G.RX(r.x), y0 = G.RY(r.y), x1 = G.RX(r.x + r.w), y1 = G.RY(r.y + r.h);
    for (let t = Math.floor((x0 + y0) / step) * step; t < x1 + y1 + step; t += step) { ctx.moveTo(t - y0, y0); ctx.lineTo(t - y1, y1); }
  }
  ctx.strokeStyle = pal.removedHatch || css(pal.ink, 0.3); ctx.lineWidth = Math.max(1, Math.round(dpr)); ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  for (const r of list) {
    const x0 = G.RX(r.x) + 0.5, y0 = G.RY(r.y) + 0.5;
    ctx.rect(x0, y0, Math.max(1, G.RX(r.x + r.w) - G.RX(r.x) - 1), Math.max(1, G.RY(r.y + r.h) - G.RY(r.y) - 1));
  }
  ctx.setLineDash([4 * dpr, 3 * dpr]);
  ctx.strokeStyle = pal.removedLine || css(pal.ink, 0.6); ctx.lineWidth = Math.max(1, Math.round(1.25 * dpr)); ctx.stroke();
  ctx.setLineDash([]);
}

/** Removed / moved angled walls of the base plan: the same ghost (fill, 45° hatch, dashed outline) on their footprints. */
function drawRemovedPolys(G, env, list) {
  const { pal } = env, { ctx } = G, dpr = G.dpr;
  const path = () => { ctx.beginPath(); for (const r of list) r.poly.forEach(([x, y], i) => (i ? ctx.lineTo(G.X(x), G.Y(y)) : ctx.moveTo(G.X(x), G.Y(y)))); };
  ctx.save();
  path(); ctx.fillStyle = pal.removedFill || css(pal.ink, 0.07); ctx.fill();
  ctx.clip();
  const step = Math.max(4, Math.round(5 * dpr));
  ctx.beginPath();
  for (const r of list) {
    const x0 = G.RX(r.x), y0 = G.RY(r.y), x1 = G.RX(r.x + r.w), y1 = G.RY(r.y + r.h);
    for (let t = Math.floor((x0 + y0) / step) * step; t < x1 + y1 + step; t += step) { ctx.moveTo(t - y0, y0); ctx.lineTo(t - y1, y1); }
  }
  ctx.strokeStyle = pal.removedHatch || css(pal.ink, 0.3); ctx.lineWidth = Math.max(1, Math.round(dpr)); ctx.stroke();
  ctx.restore();
  path(); ctx.closePath();
  ctx.setLineDash([4 * dpr, 3 * dpr]);
  ctx.strokeStyle = pal.removedLine || css(pal.ink, 0.6); ctx.lineWidth = Math.max(1, Math.round(1.25 * dpr)); ctx.stroke();
  ctx.setLineDash([]);
}

const MARK = { 'opening-added': '+', 'opening-removed': '−', 'opening-changed': '' };

/** Small level-coloured markers on openings that differ from the architect's plan. */
export function drawChangeMarkers(G, env) {
  if (!showsChanges(env)) return;
  const { plan, pal } = env, { ctx } = G, dpr = G.dpr;
  const d = structureOf(plan);
  // on a plan with several levels every entry names its level: only this level's markers
  const lid = plan.levelId || 'L0';
  if (!d.diff) d.diff = planDiff().items.filter((it) => it.kind in MARK && (it.levelId === undefined || it.levelId === lid));
  const r = 6.5 * dpr;
  for (const it of d.diff) {
    const m = 12 / G.scale;
    if (!G.visible(it.at.x - m, it.at.y - m, it.at.x + m, it.at.y + m)) continue;
    const x = Math.round(G.X(it.at.x)), y = Math.round(G.Y(it.at.y));
    const col = pal.level[it.level] || pal.level.free;
    ctx.beginPath(); ctx.arc(x, y, r + 1.5 * dpr, 0, Math.PI * 2); ctx.fillStyle = pal.paper; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    const ink = pal.dark ? '#101418' : '#ffffff', arm = 3.2 * dpr;
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = Math.max(1, 1.6 * dpr); ctx.lineCap = 'round';
    ctx.beginPath();
    if (it.kind === 'opening-changed') { ctx.arc(x, y, 2 * dpr, 0, Math.PI * 2); ctx.fill(); }
    else {
      ctx.moveTo(x - arm, y); ctx.lineTo(x + arm, y);
      if (it.kind === 'opening-added') { ctx.moveTo(x, y - arm); ctx.lineTo(x, y + arm); }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
}

// ───────────── what a plan edit touched ─────────────
const grow = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

/**
 * Compact fingerprint of everything the plan layers draw, taken after each plan revision. Two snapshots are
 * compared by `planDirt` to find the part of the drawing that has to be repainted.
 */
export function planSnapshot(plan) {
  const walls = new Map(), openings = new Map(), rooms = new Map(), segs = new Map();
  for (const w of plan.walls) walls.set(`${w.x},${w.y},${w.w},${w.h},${w.kind}`, w);
  // a door reaches as far as its leaf swings
  for (const o of plan.openings) openings.set(o.id, { sig: JSON.stringify(o), rect: grow(o, Math.max(o.w, o.h) + 12) });
  for (const r of plan.rooms) rooms.set(r.id, { sig: JSON.stringify(r), rect: polygonBounds(r.polygon) });
  // (an angled wall: its joined footprint too — a neighbour's join changes it without changing its bounding box)
  for (const s of wallSegments(plan)) segs.set(s.id, { sig: `${s.policy.level}|${s.isNew}|${s.x},${s.y},${s.w},${s.h}|${s.openingIds}${s.axis === 'a' ? `|${s.poly}` : ''}`, rect: s });
  return { walls, openings, rooms, segs, stairs: stairsSnapshot(PLAN, plan, plan.levelId || 'L0'), chains: chainSignatures(plan) };
}

/**
 * Where two plan snapshots differ.
 * @returns {{ rect: {x,y,w,h}|null, sides: string[] }}  rect = bounding box (plan cm) of every changed wall,
 *   opening, room and segment (null when nothing changed); sides = façades whose dimension chains changed.
 */
export function planDirt(a, b) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (r) => { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); };
  for (const [k, w] of a.walls) if (!b.walls.has(k)) add(w);
  for (const [k, w] of b.walls) if (!a.walls.has(k)) add(w);
  for (const name of ['openings', 'rooms', 'segs', 'stairs']) {
    for (const [k, v] of a[name]) { const o = b[name].get(k); if (!o || o.sig !== v.sig) { add(v.rect); if (o) add(o.rect); } }
    for (const [k, v] of b[name]) if (!a[name].has(k)) add(v.rect);
  }
  const sides = Object.keys(b.chains).filter((side) => a.chains[side] !== b.chains[side]);
  return { rect: x1 >= x0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null, sides };
}
