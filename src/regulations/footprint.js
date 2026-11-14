/**
 * The house on its lot when the plan has several floors (stage F7): the ground footprint united with the projections of
 * the upper floors (an overhanging storey covers ground too). Site rules (setbacks, building line, coverage) use it.
 * One-level plans never come here (their site checks are unchanged).
 */
import { GROUND, levelIds, footprintOf } from '../core/levels.js';
import { levelPlan } from '../core/plan-edit.js';
import { union, netArea } from '../core/polykernel.js';

const CACHE = new WeakMap();

/** Level views of a plan, bottom-up: [{ id, view }] (L0's view is the plan itself). */
export function levelViews(plan) {
  return levelIds(plan).map((id) => ({ id, view: id === GROUND ? plan : levelPlan(plan, id) })).filter((x) => x.view);
}

/**
 * @returns {{ polygons: Array<{ outer, holes }>, area: number (cm²), outlines: number[][][] (every ring),
 *             floors: Array<{ id, area: number (cm²) }> }}  `floors` = each level's own footprint (gross floor area)
 */
export function houseFootprint(plan) {
  const views = levelViews(plan);
  const parts = views.flatMap(({ view }) => [view.walls, view.openings, view.rooms, view.slants]);
  const hit = CACHE.get(plan);
  if (hit && hit.parts.length === parts.length && hit.parts.every((p, i) => p === parts[i])) return hit.value;
  const fps = views.map(({ id, view }) => ({ id, fp: footprintOf(view) }));
  const all = fps.flatMap((f) => f.fp.polygons);
  const polygons = all.length ? union(all) : [];
  const value = {
    polygons, area: netArea(polygons),
    outlines: polygons.flatMap((p) => [p.outer, ...(p.holes || [])]),
    floors: fps.map((f) => ({ id: f.id, area: f.fp.area })),
  };
  CACHE.set(plan, { parts, value });
  return value;
}

/** Ground covered by the house (all floors projected), m². */
export const coverageM2 = (plan) => houseFootprint(plan).area / 1e4;
