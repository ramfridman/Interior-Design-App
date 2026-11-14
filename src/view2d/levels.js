/**
 * Levels in the 2D plan (stage F2 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md): which items belong to the floor being
 * shown, the ghost of the floor below, the faint lot outline of an upper floor and the selection clean-up when the
 * floor changes. The pure helpers (no DOM) are exported for the Node tests; the two draw* functions paint into the
 * cached plan layer.
 *
 * Words: "level" in code ('L0' = ground, 'L1'…), "floor" in UI text. An item's `level` is absent on the ground floor.
 * The plan view always shows ONE level: `env.plan` = levelPlan(PLAN, store.ui.level) (PLAN itself for 'L0'), so with
 * one level nothing here does anything.
 */
import { GROUND, levelIds } from '../core/levels.js';
import { levelPlan, wallSegments } from '../core/plan-edit.js';
import { css } from './color.js';
import { drawStairsGhost } from './stairs.js';

/** The level an item stands on ('L0' when it has none). */
export const itemLevel = (it) => (it && typeof it.level === 'string' && it.level ? it.level : GROUND);
/** Does the item stand on level `id`? */
export const isOnLevel = (it, id = GROUND) => itemLevel(it) === (id || GROUND);
/** The items of one level (array order kept: it is the 2D drawing order). */
export const itemsOnLevel = (items, id = GROUND) => (items || []).filter((it) => isOnLevel(it, id));
/** Drawn, picked and snapped to in the plan: not hidden and on the level shown. */
export const isShownOn = (it, id = GROUND) => !!it && !it.hidden && isOnLevel(it, id);

/**
 * The `level` field a NEW item gets on level `id`: `{}` on the ground floor (no key, so a one-level design stays
 * byte-identical), `{ level: id }` above it.
 */
export const levelPatch = (id) => (!id || id === GROUND ? {} : { level: id });

/** The level directly below `id`, or null (ground floor, unknown level). */
export function levelBelow(plan, id) {
  const ids = levelIds(plan), i = ids.indexOf(id || GROUND);
  return i > 0 ? ids[i - 1] : null;
}
/** The level directly above `id`, or null. */
export function levelAbove(plan, id) {
  const ids = levelIds(plan), i = ids.indexOf(id || GROUND);
  return i >= 0 && i < ids.length - 1 ? ids[i + 1] : null;
}

/**
 * What the ghost of the floor below draws while level `id` is shown: that level's wall rectangles, wall outline,
 * openings and stairs (read-only references into its view, never pickable). null on the ground floor.
 * @returns {{ levelId, walls, outline, openings, stairs } | null}
 */
export function ghostOf(plan, id) {
  const below = levelBelow(plan, id);
  if (!below) return null;
  const v = levelPlan(plan, below);
  if (!v) return null;
  return { levelId: below, walls: v.walls || [], outline: v.wallOutline || [], openings: v.openings || [], stairs: v.stairs || [] };
}

/**
 * Selection clean-up when the floor shown changes: the ids of `selection` whose items stand on level `id`.
 * @param {object[]} items  store.items  @param {string[]} selection  store.selection
 */
export function selectionOnLevel(items, selection, id) {
  const byId = new Map((items || []).map((it) => [it.id, it]));
  return (selection || []).filter((sid) => byId.has(sid) && isOnLevel(byId.get(sid), id));
}

/**
 * The structure selection (`store.ui.structureSel`) if what it names is on the level view `view`, else null.
 * Segment ids of upper levels are prefixed ('L1|seg:v:…'), opening ids are unique across levels.
 */
export function structureSelOn(sel, view) {
  if (!sel || !sel.id || !view) return null;
  if (sel.type === 'segment') return wallSegments(view).some((s) => s.id === sel.id) ? sel : null;
  if (sel.type === 'opening') return (view.openings || []).some((o) => o.id === sel.id) ? sel : null;
  if (sel.type === 'void') return (view.voids || []).some((v) => v && v.id === sel.id) ? sel : null;
  if (sel.type === 'stair') return (view.stairs || []).some((s) => s && s.id === sel.id) ? sel : null;   // a stair is picked on its bottom level
  return null;
}

/** Should the ghost of the floor below be painted? (`exporting`: only when the export asked for it) */
export const showsGhost = (env) => !!env.ui.ghostBelow && (env.level || GROUND) !== GROUND && (!env.exporting || !!env.exportGhost);

/** Ghost of the floor below, at about a quarter of the strength of the real walls. */
export function drawGhostBelow(G, env) {
  if (!showsGhost(env)) return;
  const g = ghostOf(env.rootPlan, env.level);
  if (!g) return;
  const { ctx } = G, { pal } = env;
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  for (const w of g.walls) G.rect(w.x, w.y, w.w, w.h);
  ctx.fillStyle = pal.wall; ctx.fill();
  const lw = G.px(1);
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of g.outline) G.seg(x1, y1, x2, y2, lw);
  ctx.strokeStyle = pal.wallLine; ctx.lineWidth = lw; ctx.stroke();
  // windows and doors of the floor below as thin lines across their gaps
  ctx.beginPath();
  for (const o of g.openings) {
    if (o.axis === 'h') G.seg(o.x, o.y + o.h / 2, o.x + o.w, o.y + o.h / 2, lw);
    else if (o.axis === 'v') G.seg(o.x + o.w / 2, o.y, o.x + o.w / 2, o.y + o.h, lw);
  }
  ctx.strokeStyle = pal.inkSoft; ctx.stroke();
  if (g.stairs.length) drawStairsGhost(G, env, g.levelId);     // the stairs of the floor below (stage F4b)
  ctx.restore();
}

/** Upper floors: the lot line stays as a faint dashed reference (the site itself is drawn on the ground floor only). */
export function drawLotReference(G, env) {
  const site = env.plan && env.plan.site;
  if (!site || !Array.isArray(site.boundary) || site.boundary.length < 3) return;
  const { ctx } = G, dpr = G.dpr;
  ctx.save();
  G.poly(site.boundary);
  ctx.setLineDash([6 * dpr, 4 * dpr]);
  ctx.strokeStyle = css(env.pal.ink, 0.22); ctx.lineWidth = Math.max(1, Math.round(dpr)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}
