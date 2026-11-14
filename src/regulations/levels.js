/**
 * Regulations on a plan with several floors (stage F7 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md). index.js calls these
 * only when the plan has upper levels; one-level plans keep the exact old path (House 98's findings are pinned).
 *
 * Every room / opening / clearance / furniture rule runs on each level's view (`levelPlan`) with that level's items
 * (`item.level`, absent = ground; a carpentry unit: its run's), and every finding carries `level` (the level id).
 * Findings of an upper level get the id suffix `@<level>` (L0 ids are unchanged). Some findings also carry `scope`:
 *   'site'   site and garden rules (setbacks, building line, parking, coverage, garden structures, assumptions): checked
 *            once, against the ground footprint united with the projections of the upper floors; level 'L0'.
 *   'house'  rules for the whole dwelling (one habitable room of 12 m², one 70 cm door to a room with a toilet, built
 *            area, the summary of changes): checked once over every floor; `level` = the floor the finding points at.
 * Ground-floor-only rules: the route from the entrance door, the garden and the entry path (their findings are on L0);
 * an upper floor says so in a note. Ceiling-height rules use each level's own heights; sill guards its elevation.
 */
import { GROUND, levelName } from '../core/levels.js';
import { planPhase } from '../core/plan-edit.js';
import { areaM2 } from '../core/geometry.js';
import { checkBuilding, finding, planMetrics, HABITABLE, SERVICE } from './building.js';
import { checkChanges } from './changes.js';
import { buildContext, checkInterior } from './interior.js';
import { checkOutdoor } from './outdoor.js';
import { planRev } from './geom.js';
import { levelViews, houseFootprint } from './footprint.js';

const SITE_CATEGORIES = new Set(['Site & parking', 'Garden & outdoor structures']);
const isSite = (f) => SITE_CATEGORIES.has(f.category) || f.ruleId === 'assumption' || f.id === 'plan-consistency:building-line';
const CACHE = new WeakMap();

const errorFinding = (label, err) => ({ id: `error:${label}`, ruleId: 'plan-consistency', severity: 'info', category: 'Assumptions', kind: 'best-practice',
  title: `The ${label} checks could not run`, detail: `An unexpected problem stopped these checks (${err && err.message ? err.message : 'unknown error'}). The other results are still valid.`, reference: '' });
function guarded(label, fn, out) {
  try { out.push(...fn()); return true; } catch (err) { out.push(errorFinding(label, err)); return false; }
}

/** Tag findings of one level: `level`, an `@<level>` id suffix above the ground floor, `scope` for site rules. */
export function tagLevel(list, id, scope) {
  return list.map((f) => {
    if (f.level && f.level !== id) return f;
    const s = scope || (f.scope ? f.scope : isSite(f) ? 'site' : null);
    return { ...f, id: id === GROUND || f.id.endsWith('@' + id) ? f.id : `${f.id}@${id}`, level: id, ...(s ? { scope: s } : {}) };
  });
}

const spot = (r) => (r.label ? { x: r.label[0], y: r.label[1] } : undefined);
const isDoor = (o) => o.kind === 'door' || o.kind === 'sliding-door';

/** Rules for the whole dwelling, over every floor. */
function dwellingFindings(plan, views) {
  const out = [];
  // one habitable room of at least 12 m² in the dwelling
  let big = null;
  for (const { id, view } of views) {
    const mt = planMetrics(view);
    for (const r of view.rooms) if (HABITABLE.has(r.type)) { const a = mt.get(r).area; if (!big || a > big.area) big = { r, area: a, id }; }
  }
  if (big) {
    const where = levelName(plan, big.id) || big.id;
    out.push(finding('room-size-habitable', big.area >= 12 ? 'pass' : 'fail', 'largest', `Largest room: ${big.r.name}, ${big.area.toFixed(1)} m² (${where})`,
      `A dwelling with two or more rooms needs at least one habitable room of 12.0 m²; the largest on any floor is ${big.r.name} on the ${where.toLowerCase()} with ${big.area.toFixed(1)} m².`,
      { spaceId: big.r.id, at: spot(big.r), level: big.id, scope: 'house' }));
  }
  // at least one door of 70 cm to a room with a toilet, anywhere in the dwelling
  const doors = [];
  for (const { id, view } of views) {
    for (const o of view.openings) {
      if (!isDoor(o) || o.kind === 'sliding-door' || o.style === 'entry' || o.style === 'mamad') continue;
      if ((o.rooms || []).some((rid) => { const r = view.rooms.find((x) => x.id === rid); return r && SERVICE.has(r.type); })) doors.push({ o, id });
    }
  }
  if (doors.length && !doors.some((d) => d.o.width >= 70)) {
    out.push(finding('door-service', 'fail', 'one-wide', 'No bathroom door of 70 cm on any floor', 'At least one room with a toilet in the dwelling must have a door 70 cm wide.', { level: GROUND, scope: 'house' }));
  }
  // built area: coverage of the lot and the floor area of every floor
  const fp = houseFootprint(plan), site = plan.site;
  const lot = site && site.boundary ? areaM2(site.boundary) : 0;
  const cover = fp.area / 1e4, floors = fp.floors.map((f) => ({ ...f, m2: f.area / 1e4 })), total = floors.reduce((s, f) => s + f.m2, 0);
  const list = floors.map((f) => `${levelName(plan, f.id) || f.id} ${f.m2.toFixed(1)} m²`).join(', ');
  out.push(finding('built-area', 'info', 'house', `Built area: ${total.toFixed(1)} m² on ${floors.length} floors, ${cover.toFixed(1)} m² of ground covered${lot ? ` (${(cover / lot * 100).toFixed(1)}% of the lot)` : ''}`,
    `Gross floor area per floor (outer walls included): ${list} — ${total.toFixed(1)} m² in all. The house covers ${cover.toFixed(1)} m² of ground (the ground floor united with the projection of the floors above)`
    + (lot ? ` on a ${lot.toFixed(0)} m² lot = ${(cover / lot * 100).toFixed(1)}% coverage and a floor-area ratio of ${(total / lot * 100).toFixed(1)}%` : '')
    + '. Compare these with the coverage (תכסית) and building percentages (אחוזי בנייה) the local plan allows for this lot.', { level: GROUND, scope: 'site' }));
  return out;
}

/** An upper floor: rules that are checked from the ground floor only. */
function groundOnlyNote(plan, id) {
  const name = levelName(plan, id) || id;
  return finding('walkway', 'info', `ground-only:${id}`, `${name}: routes from the entrance are checked on the ground floor`,
    `The walking routes are checked from the entrance door, which is on the ground floor; the garden, the entry path and the parking belong to the ground floor too. Stairs between the floors are not checked yet, so the routes on the ${name.toLowerCase()} are not measured.`);
}

/**
 * Plan-only findings of every floor (building checks per level, the site once, the whole-dwelling rules and the changes
 * to the approved plan). Cached per revision of every level, the phase, the project ceiling and the safe-room finishes.
 */
export function levelsBuilding(args) {
  const { plan, store, catalog } = args;
  const views = levelViews(plan);
  const fin = (store && store.finishes) || {};
  const mamadWalls = views.flatMap(({ view }) => view.rooms.filter((r) => r.type === 'mamad').map((r) => (fin[r.id] && fin[r.id].wall) || '')).join('|');
  const key = views.map(({ id, view }) => `${id}:${planRev(view)}:${JSON.stringify(view.heights)}:${view.elevation || 0}`).join('|')
    + `#${planPhase()}#${store && store.project ? store.project.ceilingHeight : ''}#${mamadWalls}`;
  const hit = CACHE.get(plan);
  if (hit && hit.key === key && hit.catalog === catalog) return hit.findings;
  const out = [];
  let ok = true;
  const fp = houseFootprint(plan);
  for (const { id, view } of views) {
    const part = [];
    ok = guarded(id === GROUND ? 'building' : `building (${levelName(plan, id) || id})`, () => checkBuilding({ plan: view, store, catalog, level: { id, outlines: id === GROUND ? fp.outlines : null } }), part) && ok;
    out.push(...tagLevel(part, id));
  }
  ok = guarded('whole house', () => dwellingFindings(plan, views), out) && ok;
  const changes = [];
  ok = guarded('plan changes', () => checkChanges(args), changes) && ok;
  out.push(...changes.map((f) => (f.level ? f : { ...f, level: GROUND, scope: 'house' })));
  if (ok) CACHE.set(plan, { key, catalog, findings: out });
  return out;
}

/** Furniture-layout findings of every floor: the ground floor's context `ctx0` (from index.js) and one per upper level. */
export function levelsInterior(args, ctx0) {
  const out = [...tagLevel(checkInterior(ctx0), GROUND)];
  for (const { id, view } of levelViews(args.plan)) {
    if (id === GROUND) continue;
    const part = [];
    guarded(`interior layout (${levelName(args.plan, id) || id})`, () => checkInterior(buildContext({ ...args, plan: view })), part);
    part.push(groundOnlyNote(args.plan, id));
    out.push(...tagLevel(part, id));
  }
  return out;
}

/** Garden findings: ground floor and site only. */
export const levelsOutdoor = (ctx) => tagLevel(checkOutdoor(ctx), GROUND, 'site');

/** Where a finding is, for the UI: the floor id and whether it is a site / whole-house finding. */
export const findingLevel = (f) => (f && f.level) || GROUND;
