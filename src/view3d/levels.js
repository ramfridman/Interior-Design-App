/**
 * Levels (several floors) as the 3D view sees them — stage F3 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md.
 * Small pure helpers shared by the items layer, picking, walk, camera and environment. A plan without `levels` has
 * one level, 'L0', whose view is the plan itself, so every helper is a no-op there.
 */
import { levelIds, levelOf, levelElevation, levelHeights, hasLevels, GROUND } from '../core/levels.js';
import { levelPlan } from '../core/plan-edit.js';

export { GROUND, levelIds, hasLevels };

/** A level id of the plan, else 'L0'. */
export const validLevel = (plan, id) => (id && id !== GROUND && levelOf(plan, id) ? id : GROUND);
/** PLAN-shaped view of a level (the plan itself for L0 / unknown ids). */
export const viewOf = (plan, id) => (id && id !== GROUND && levelPlan(plan, id)) || plan;
/** Finished floor of a level above the L0 finished floor (m). */
export const elevationM = (plan, id) => (levelElevation(plan, id) || 0) / 100;
/** Ceiling height of a level (cm). */
export const ceilingCm = (plan, id) => { const h = levelHeights(plan, validLevel(plan, id)); return h ? h.ceiling : plan.heights.ceiling; };

/** The level an item stands on: `item.level`, for a carpentry unit without one its run's `level`; 'L0' when absent / unknown. */
export function itemLevel(item, plan, store) {
  let id = item && item.level;
  if (!id && item && item.carp && store && store.carpentry && store.carpentry.runs) {
    const run = store.carpentry.runs[item.carp.runId];
    id = run && run.level;
  }
  return validLevel(plan, id);
}

/** Level of the finished floor nearest below a world height (m) — e.g. a picked point. */
export function levelAtY(plan, y) {
  let best = GROUND;
  for (const id of levelIds(plan)) if (elevationM(plan, id) <= y + 0.05) best = id;
  return best;
}
