/**
 * LEVELS — pure helpers for plans with several floors (stage F1 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md § 2).
 * No live state and no plan-engine dependency, so geometry, views, regulations and the importer can import it freely.
 * The PLAN-shaped per-level view (`levelPlan`) lives in plan-edit.js: a level saved without its derived rooms / outline
 * needs the engine (and that level's policy) to produce them. Words: "level" in code, "floor / storey" in UI text.
 *
 *   L0       the ground level = the top-level plan fields (walls, openings, rooms, wallOutline, heights …)
 *   L1, L2…  `plan.levels[i]`, bottom-up: { id, name?, nameHe?, elevation, heights: { ceiling, slab, parapet },
 *            walls, openings, rooms?, wallOutline?, slants?, stairs?, voids?, outdoorAreas? }
 *   elevation (cm, finished floor above the L0 finished floor) = elevation of the level below + its ceiling + this
 *            level's slab (`heights.slab` = the slab under this level's floor) — see recomputeElevations().
 */
import { union, netArea, intersection } from './polykernel.js';
import { openingQuad } from './slant-geom.js';
import { joinLevelSlants } from './slants.js';

export const GROUND = 'L0';
const LEVEL_ID = /^L[1-9][0-9]*$/;
const NAMES = { en: (n) => (n === 1 ? 'First floor' : n === 2 ? 'Second floor' : n === 3 ? 'Third floor' : `Floor ${n}`), he: (n) => `קומה ${n}` };

/** The upper levels of a plan (an empty list for a one-level plan). */
export const upperLevels = (plan) => (plan && Array.isArray(plan.levels) ? plan.levels : []);
/** Ids of every level, bottom-up: ['L0', 'L1', …]. */
export function levelIds(plan) { return [GROUND, ...upperLevels(plan).map((l) => l.id)]; }
/** True when the plan has upper levels. */
export const hasLevels = (plan) => upperLevels(plan).length > 0;
/** A well-formed upper-level id ('L1', 'L2', …). */
export const isLevelId = (id) => typeof id === 'string' && LEVEL_ID.test(id);
/** Position of a level (0 = L0), or -1. */
export function levelIndex(plan, id) { if (id == null || id === GROUND) return 0; const i = upperLevels(plan).findIndex((l) => l.id === id); return i < 0 ? -1 : i + 1; }
/** The level object: the plan itself for L0 (it carries L0's walls / openings / rooms), `plan.levels[i]` above, or null. */
export function levelOf(plan, id) {
  if (id == null || id === GROUND) return plan || null;
  return upperLevels(plan).find((l) => l.id === id) || null;
}
/** Finished floor height of a level above the L0 finished floor (cm); 0 for L0, null for an unknown level. */
export function levelElevation(plan, id) { const l = levelOf(plan, id); return !l ? null : l === plan ? 0 : l.elevation; }
/** Heights of a level: the plan's heights with the level's own merged over them. */
export function levelHeights(plan, id) { const l = levelOf(plan, id); return !l ? null : l === plan ? plan.heights : { ...plan.heights, ...l.heights }; }
/** Display name ('en' | 'he'). */
export function levelName(plan, id, lang = 'en') {
  const i = levelIndex(plan, id);
  if (i < 0) return null;
  if (i === 0) return lang === 'he' ? 'קומת קרקע' : 'Ground floor';
  const l = upperLevels(plan)[i - 1], own = lang === 'he' ? l.nameHe : l.name;
  return typeof own === 'string' && own.trim() ? own : NAMES[lang === 'he' ? 'he' : 'en'](i);
}
/** Next free upper-level id. */
export function nextLevelId(plan) { let n = 0; for (const l of upperLevels(plan)) n = Math.max(n, parseInt(l.id.slice(1), 10) || 0); return 'L' + (n + 1); }

/**
 * Elevations recomputed bottom-up from the heights (L0's `groundHeights.ceiling`, then each level's ceiling and slab).
 * Returns a new array; a level whose elevation is already right is the same object (so caches keyed by it survive).
 */
export function recomputeElevations(levels, groundHeights) {
  let below = 0, ceiling = groundHeights.ceiling;
  return levels.map((l) => {
    const h = l.heights || {}, slab = Number.isFinite(h.slab) ? h.slab : groundHeights.slab;
    const elevation = below + ceiling + slab;
    below = elevation; ceiling = Number.isFinite(h.ceiling) ? h.ceiling : groundHeights.ceiling;
    return l.elevation === elevation ? l : { ...l, elevation };
  });
}

const footprints = new WeakMap();
/**
 * Footprint of a level (or of a PLAN-shaped level view): the union of its walls, openings and rooms, as polygon-kernel
 * expolygons `[{ outer, holes }]` (outer clockwise on screen; holes = courtyards / light wells open to the sky), plus its
 * area in cm². Pass a view from `levelPlan()` for a level saved without rooms. Cached per `walls` array.
 * @returns {{ polygons: Array<{ outer, holes }>, area: number }}
 */
export function footprintOf(level) {
  if (!level || !Array.isArray(level.walls)) return { polygons: [], area: 0 };
  const hit = footprints.get(level.walls);
  if (hit && hit.openings === level.openings && hit.rooms === level.rooms && hit.slants === level.slants) return hit.value;
  const rects = [...level.walls, ...(level.openings || []).filter((o) => o.axis !== 'a')];
  const shapes = [...rects, ...(level.rooms || []).map((r) => ({ polygon: r.polygon })), ...slantShapes(level, rects)];
  const polygons = shapes.length ? union(shapes) : [];
  const value = { polygons, area: netArea(polygons) };
  footprints.set(level.walls, { openings: level.openings, rooms: level.rooms, slants: level.slants, value });
  return value;
}
/** Angled walls of a level as solids: their joined footprints (recomputed — a saved `poly` is not trusted) + gap quads. */
function slantShapes(level, rects) {
  const sl = Array.isArray(level.slants) ? level.slants : [];
  if (!sl.length) return [];
  const joined = joinLevelSlants(sl, rects).joined, byId = new Map(sl.map((s) => [s.id, s]));
  const quads = (level.openings || []).filter((o) => o.axis === 'a' && byId.has(o.wall) && Number.isFinite(o.at) && o.width > 0).map((o) => openingQuad(byId.get(o.wall), o.at, o.width));
  return [...joined.map((s) => ({ poly: s.poly })), ...quads];
}

// ---------------------------------------------------------------- voids (stage F4b): openings in a level's floor
/** The usable voids of a level (or of a PLAN-shaped level view): `[{ id, polygon, stair, railing }]` with ≥ 3 points. */
export const voidsOf = (level) => (level && Array.isArray(level.voids) ? level.voids.filter((v) => v && typeof v.id === 'string' && Array.isArray(v.polygon) && v.polygon.length >= 3) : []);

/**
 * The parts of a room's floor that are voids (openings in the slab of this level, e.g. over a stair). A room keeps its
 * outline (walls did not move); its FLOOR area is the polygon minus these. Computed from the geometry (never trusted
 * from stored data). @returns {Array<{ id, area }>} area in cm² (only voids that overlap the room by more than 1 cm²)
 */
export function roomVoids(level, room) {
  const voids = voidsOf(level);
  if (!voids.length || !room || !Array.isArray(room.polygon) || room.polygon.length < 3) return [];
  const out = [];
  for (const v of voids) {
    const a = Math.round(netArea(intersection([room.polygon], [v.polygon])));
    if (a > 1) out.push({ id: v.id, area: a });
  }
  return out;
}
/** Floor area of a room (cm²): its polygon minus the voids in it. */
export function roomFloorArea(level, room, polygonArea) {
  const whole = polygonArea(room.polygon);
  return whole - roomVoids(level, room).reduce((s, v) => s + v.area, 0);
}

/**
 * A level object with its rooms annotated: `room.voids = [{ id, area }]` (cm²) for every room a void cuts, the key
 * removed from the others. The SAME level object is returned when nothing changes (no voids and no stale keys), so a
 * level without voids is untouched byte for byte. Used by the plan engine whenever it installs levels.
 */
export function annotateVoids(level) {
  if (!level || !Array.isArray(level.rooms)) return level;
  const hasVoids = voidsOf(level).length > 0;
  if (!hasVoids && !level.rooms.some((r) => r && r.voids !== undefined)) return level;
  let changed = false;
  const rooms = level.rooms.map((r) => {
    const vs = hasVoids ? roomVoids(level, r) : [];
    const was = r.voids === undefined ? '' : JSON.stringify(r.voids), now = vs.length ? JSON.stringify(vs) : '';
    if (was === now) return r;
    changed = true;
    const next = { ...r };
    if (vs.length) next.voids = vs; else delete next.voids;
    return next;
  });
  return changed ? { ...level, rooms } : level;
}
