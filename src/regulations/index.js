/**
 * Regulations & best-practice checker for the E7 house.
 *
 *   import { runChecks, summarize, RULES, DISCLAIMER } from './regulations/index.js';
 *   const findings = runChecks({ store, plan, catalog });
 *
 * Pure and synchronous: no DOM, no I/O. Everything is computed from `plan` (walls, openings, rooms, site) and
 * `store` (items, project, finishes); nothing about the house is hard-coded. The rules and their sources are in
 * rules.js and explained in docs/REGULATIONS.md.
 *
 * Finding = { id, ruleId, severity: 'pass'|'info'|'warn'|'fail', category, kind, title, detail,
 *             reference: string, spaceId?, itemIds?, at?: { x, y }, level?, scope? }
 * Several floors (plan.levels, stage F7): every finding carries `level` (the floor it is on) and, for site / whole-house
 * rules, `scope: 'site' | 'house'` — see levels.js.
 *
 * The plan may be edited at runtime (src/core/plan-edit.js): call runChecks again on the store's 'plan' event.
 * Results are always computed for the plan as it is at the time of the call; nothing is recomputed while the plan,
 * the ceiling height and the safe-room finish are unchanged.
 */
import { RULES, DISCLAIMER, CATEGORIES, ruleById } from './rules.js';
import { checkBuilding } from './building.js';
import { checkChanges } from './changes.js';
import { planRev } from './geom.js';
import { planPhase } from '../core/plan-edit.js';
import { buildContext, checkInterior } from './interior.js';
import { checkOutdoor } from './outdoor.js';
import { hasLevels } from '../core/levels.js';
import { levelsBuilding, levelsInterior, levelsOutdoor } from './levels.js';

export { RULES, DISCLAIMER, CATEGORIES, ruleById };

const SEVERITY_ORDER = { fail: 0, warn: 1, info: 2, pass: 3 };
const BUILDING_CACHE = new WeakMap();

/**
 * Plan-only findings (building checks + the owner's changes) depend on the plan, the ceiling height and the
 * safe-room wall finish. They are cached per plan REVISION: plan-edit.js keeps the `plan` object and replaces its
 * arrays, so the key is `planRev(plan)` (identity of walls / openings / rooms …), not the object.
 */
function buildingFindings(args) {
  const { plan, store } = args;
  const mamadWalls = plan.rooms.filter((r) => r.type === 'mamad').map((r) => (store && store.finishes && store.finishes[r.id] && store.finishes[r.id].wall) || '').join('|');
  const key = `${planRev(plan)}#${planPhase()}#${store && store.project ? store.project.ceilingHeight : ''}#${mamadWalls}`;
  const hit = BUILDING_CACHE.get(plan);
  if (hit && hit.key === key && hit.catalog === args.catalog) return hit.findings;
  const findings = [];
  // each group is guarded on its own so a problem in one does not hide the other; errors are not cached
  let failed = false;
  for (const [label, fn] of [['building', () => checkBuilding(args)], ['plan changes', () => checkChanges(args)]]) {
    try { findings.push(...fn()); } catch (err) { failed = true; findings.push(errorFinding(label, err)); }
  }
  if (!failed) BUILDING_CACHE.set(plan, { key, catalog: args.catalog, findings });
  return findings;
}

const errorFinding = (label, err) => ({ id: `error:${label}`, ruleId: 'plan-consistency', severity: 'info', category: 'Assumptions', kind: 'best-practice',
  title: `The ${label} checks could not run`, detail: `An unexpected problem stopped these checks (${err && err.message ? err.message : 'unknown error'}). The other results are still valid.`, reference: '' });

function guarded(label, fn, out) {
  try { out.push(...fn()); } catch (err) { out.push(errorFinding(label, err)); }
}

/**
 * Run every check.
 * @param {{ store: object, plan: object, catalog?: object }} args
 * @returns {object[]} findings, grouped by category and ordered fail → warn → info → pass
 */
export function runChecks(args) {
  const out = [];
  if (!args || !args.plan || !Array.isArray(args.plan.rooms)) return out;
  const floors = hasLevels(args.plan);              // several floors (stage F7): per level, see levels.js
  guarded('building', () => (floors ? levelsBuilding(args) : buildingFindings(args)), out);
  let ctx = null;
  guarded('layout', () => { ctx = buildContext(args); return []; }, out);
  if (ctx) {
    guarded('interior layout', () => (floors ? levelsInterior(args, ctx) : checkInterior(ctx)), out);
    guarded('garden', () => (floors ? levelsOutdoor(ctx) : checkOutdoor(ctx)), out);
  }
  const cat = (f) => { const i = CATEGORIES.indexOf(f.category); return i < 0 ? CATEGORIES.length : i; };
  return out
    .map((f, i) => ({ f, i }))
    .sort((a, b) => cat(a.f) - cat(b.f) || SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity] || a.i - b.i)
    .map((x) => x.f);
}

/** Count findings by severity. */
export function summarize(findings) {
  const counts = { pass: 0, info: 0, warn: 0, fail: 0 };
  for (const f of findings || []) if (f && counts[f.severity] != null) counts[f.severity]++;
  return counts;
}

export default { RULES, DISCLAIMER, runChecks, summarize };
