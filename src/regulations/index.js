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
 *             reference: string, spaceId?, itemIds?, at?: { x, y } }
 */
import { RULES, DISCLAIMER, CATEGORIES, ruleById } from './rules.js';
import { checkBuilding } from './building.js';
import { buildContext, checkInterior } from './interior.js';
import { checkOutdoor } from './outdoor.js';

export { RULES, DISCLAIMER, CATEGORIES, ruleById };

const SEVERITY_ORDER = { fail: 0, warn: 1, info: 2, pass: 3 };
const BUILDING_CACHE = new WeakMap();

/** Plan-only findings change only with the ceiling height and the safe-room wall finish — cache them per plan. */
function buildingFindings(args) {
  const { plan, store } = args;
  const mamadWalls = plan.rooms.filter((r) => r.type === 'mamad').map((r) => (store && store.finishes && store.finishes[r.id] && store.finishes[r.id].wall) || '').join('|');
  const key = `${store && store.project ? store.project.ceilingHeight : ''}#${mamadWalls}`;
  const hit = BUILDING_CACHE.get(plan);
  if (hit && hit.key === key) return hit.findings;
  const findings = checkBuilding(args);
  BUILDING_CACHE.set(plan, { key, findings });
  return findings;
}

function guarded(label, fn, out) {
  try { out.push(...fn()); } catch (err) {
    out.push({ id: `error:${label}`, ruleId: 'plan-consistency', severity: 'info', category: 'Assumptions', kind: 'best-practice',
      title: `The ${label} checks could not run`, detail: `An unexpected problem stopped these checks (${err && err.message ? err.message : 'unknown error'}). The other results are still valid.`, reference: '' });
  }
}

/**
 * Run every check.
 * @param {{ store: object, plan: object, catalog?: object }} args
 * @returns {object[]} findings, grouped by category and ordered fail → warn → info → pass
 */
export function runChecks(args) {
  const out = [];
  if (!args || !args.plan || !Array.isArray(args.plan.rooms)) return out;
  guarded('building', () => buildingFindings(args), out);
  let ctx = null;
  guarded('layout', () => { ctx = buildContext(args); return []; }, out);
  if (ctx) {
    guarded('interior layout', () => checkInterior(ctx), out);
    guarded('garden', () => checkOutdoor(ctx), out);
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
