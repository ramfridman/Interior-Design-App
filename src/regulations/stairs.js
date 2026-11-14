/**
 * Stair rules (stage F4a of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md) — every stair of every level, with the numbers of
 * the Planning & Building Regulations, Second Schedule, Part C (sign ב' of chapter ב', applied inside a dwelling by
 * §3.8.5.1 / §3.8.5.7) and the User Safety regulations (guards). Sources and wording: rules.js and docs/REGULATIONS.md.
 * Geometry comes from src/core/stairs.js. A plan without stairs gets no finding at all.
 * Every finding carries `level` (the stair's bottom level) and `stairId`; ids are `<rule>:<stairId>` (stair ids are
 * unique across levels).
 */
import { levelIds, levelOf, levelElevation, levelHeights, footprintOf, GROUND, voidsOf, levelName } from '../core/levels.js';
import { itemCorners } from '../core/geometry.js';
import { levelPlan } from '../core/plan-edit.js';
import { intersection, difference, intersectArea, netArea } from '../core/polykernel.js';
import { stairGeometry, stairProblems, requiredVoid, stairSides, DEFAULT_HEADROOM } from '../core/stairs.js';
import { finding } from './building.js';

/** The numbers (cm). Each one is sourced in rules.js (the rule with the same name). */
export const STAIR_LIMITS = Object.freeze({
  riserMin: 10, riserMax: 17.5,                // §3.2.2.5(א)
  goingMin: 26,                                // §3.2.2.5(ב)
  comfortMin: 61, comfortMax: 63,              // §3.2.2.5(ד)
  widthMin: 80,                                // §3.2.2.2(1), §3.8.5.7(ב)
  headroom: DEFAULT_HEADROOM,                  // §3.2.2.4 (210)
  flightMax: 18,                               // §3.8.5.7(ד)
  landingMin: 80,                              // §3.2.2.10(1), §3.8.5.7(ג)
  handrailFrom: 3,                             // §3.2.2.15
  nosingMax: 4,                                // §3.2.2.11
  guardDrop: 60,                               // User Safety reg. 4(א)
  guardFlat: 105, guardStair: 90,              // SI 1142 — unverified (secondary source)
});
const L = STAIR_LIMITS;
const cm = (v) => `${(Math.round(v * 10) / 10).toString()} cm`;
const mm = (v) => `${(v / 100).toFixed(2)} m`;

/** Stairs of a plan with their level, the level above and the rise: [{ stair, level, to, rise }]. */
export function stairsOfPlan(plan) {
  const ids = levelIds(plan), out = [];
  ids.forEach((id, i) => {
    const lv = levelOf(plan, id), list = (lv && Array.isArray(lv.stairs)) ? lv.stairs : [];
    for (const stair of list) {
      if (!stair || typeof stair !== 'object') continue;
      const to = stair.to && ids.includes(stair.to) ? stair.to : (stair.to ? null : ids[i + 1] || null);
      const rise = to ? levelElevation(plan, to) - levelElevation(plan, id) : null;
      out.push({ stair, level: id, to, rise });
    }
  });
  return out;
}

/** Voids of the upper level that belong to a stair: those naming it, else those overlapping its footprint. */
function voidsFor(plan, to, stair, geo) {
  const up = levelOf(plan, to), all = ((up && up.voids) || []).filter((v) => v && Array.isArray(v.polygon) && v.polygon.length >= 3);
  const named = all.filter((v) => v.stair === stair.id);
  if (named.length) return named;
  return geo && geo.footprint.length ? all.filter((v) => intersectArea([v.polygon], [geo.footprint]) > 1) : [];
}

/** Highest pitch-line point of each flight / landing under the slab (outside the voids): the lowest headroom. */
function minHeadroom(geo, obstruction, underside) {
  let worst = null;
  for (const f of geo.flights) {
    if (f.length <= 1e-6) continue;
    const parts = intersection([f.poly], obstruction);
    for (const e of parts) for (const p of [e.outer, ...e.holes].flat()) {
      const s = Math.min(f.length, Math.max(0, (p[0] - f.origin[0]) * f.dir[0] + (p[1] - f.origin[1]) * f.dir[1]));
      const pitch = Math.min(f.h1, f.h0 + geo.riser + (s * geo.riser) / geo.going), clear = underside - pitch;
      if (!worst || clear < worst.clear) worst = { clear, at: { x: p[0], y: p[1] } };
    }
  }
  for (const l of geo.landings) {
    const parts = intersection([l.poly], obstruction);
    if (netArea(parts) > 1) { const clear = underside - l.h, p = parts[0].outer[0]; if (!worst || clear < worst.clear) worst = { clear, at: { x: p[0], y: p[1] } }; }
  }
  return worst;
}

/** Findings for one stair. */
function checkStair(plan, { stair, level, to, rise }) {
  const out = [], key = stair.id, extra = (at) => ({ level, stairId: stair.id, ...(at ? { at } : {}) });
  const name = `Stair ${stair.id}`;
  const geo = to && rise > 0 ? stairGeometry(stair, { rise }) : null;
  const problems = to ? stairProblems(stair, geo, { rise }) : [{ code: 'rise', en: 'There is no floor above it to arrive at.' }, ...stairProblems(stair, null)];
  const centre = { x: stair.x, y: stair.y };
  if (problems.length || !geo) {
    out.push(finding('stair-geometry', 'fail', key, `${name} cannot be built as drawn`, problems.map((p) => p.en).join(' ') || 'The stair cannot be built from these numbers.', extra(centre)));
    return out;
  }
  out.push(finding('stair-geometry', 'pass', key, `${name}: ${geo.risers} risers of ${cm(geo.riser)} over ${mm(rise)}`, `${geo.shape === 'straight' ? 'Straight' : geo.shape + '-shaped'} stair, going ${cm(geo.going)}, width ${cm(geo.width)}, walking line ${mm(geo.walkLength)}.`, extra(centre)));

  const R = geo.riser, G = geo.going;
  const okR = R >= L.riserMin - 1e-9 && R <= L.riserMax + 1e-9;
  out.push(finding('stair-riser', okR ? 'pass' : 'fail', key, `${name}: riser ${cm(R)}`,
    `${geo.risers} risers over ${mm(rise)} give ${cm(R)} each; the regulation allows ${L.riserMin}–${L.riserMax} cm.${okR ? '' : ` At least ${Math.ceil(rise / L.riserMax - 1e-9)} risers are needed.`}`, extra(centre)));
  const okG = G >= L.goingMin - 1e-9;
  out.push(finding('stair-going', okG ? 'pass' : 'fail', key, `${name}: going ${cm(G)}`, `The tread depth is ${cm(G)}; at least ${L.goingMin} cm is required.`, extra(centre)));
  const c = 2 * R + G, okC = c >= L.comfortMin - 0.05 && c <= L.comfortMax + 0.05;
  out.push(finding('stair-comfort', okC ? 'pass' : 'fail', key, `${name}: 2R + G = ${cm(c)}`,
    `Two risers plus the going make ${cm(c)}; the regulation asks for ${L.comfortMin}–${L.comfortMax} cm.${okC ? '' : ` With this riser a going of ${cm(Math.max(L.goingMin, L.comfortMin - 2 * R))}–${cm(L.comfortMax - 2 * R)} would fit.`}`, extra(centre)));
  const okW = geo.width >= L.widthMin - 1e-9;
  out.push(finding('stair-width', okW ? 'pass' : 'fail', key, `${name}: width ${cm(geo.width)}`, `A stair inside a dwelling must be at least ${L.widthMin} cm wide; this one is ${cm(geo.width)}.`, extra(centre)));
  const most = Math.max(...geo.flights.map((f) => f.risers));
  out.push(finding('stair-flight', most <= L.flightMax ? 'pass' : 'fail', key, `${name}: ${most} risers in the longest flight`,
    `At most ${L.flightMax} steps per flight inside a dwelling; ${most <= L.flightMax ? 'met' : 'add a landing'} (flights: ${geo.flights.map((f) => f.risers).join(' + ')}).`, extra(centre)));
  if (geo.landings.length) {
    const short = geo.landings.filter((l) => l.size < L.landingMin - 1e-9);
    out.push(finding('stair-landing', short.length ? 'fail' : 'pass', key, `${name}: landing ${cm(geo.landings[0].size)} deep`,
      `A landing must be at least ${L.landingMin} cm deep in the direction of travel; ${short.length ? 'it is shorter' : 'met'}.`, extra({ x: geo.landings[0].poly[0][0], y: geo.landings[0].poly[0][1] })));
  }
  const nosing = Number.isFinite(stair.nosing) ? stair.nosing : 3;
  out.push(finding('stair-nosing', nosing <= L.nosingMax ? 'pass' : 'fail', key, `${name}: nosing ${cm(nosing)}`, `Treads may project at most ${L.nosingMax} cm over the riser below.`, extra(centre)));

  // headroom and the opening in the floor above
  const upView = levelPlan(plan, to) || levelOf(plan, to);
  const slab = (levelHeights(plan, to) || {}).slab || 0, underside = rise - slab;
  const upFp = upView ? footprintOf(upView).polygons : [];
  const voids = voidsFor(plan, to, stair, geo);
  const obstruction = upFp.length ? (voids.length ? difference(upFp, voids.map((v) => v.polygon)) : upFp) : [];
  const worst = obstruction.length ? minHeadroom(geo, obstruction, underside) : null;
  const okH = !worst || worst.clear >= L.headroom - 0.05;
  out.push(finding('stair-headroom', okH ? 'pass' : 'fail', key, worst ? `${name}: ${mm(worst.clear)} headroom under the floor above` : `${name}: open above`,
    worst ? `The lowest point of the slab above the stair (underside ${mm(underside)}) is ${mm(worst.clear)} above the nosing line; at least ${mm(L.headroom)} is required.` : 'Nothing of the floor above is over the stair.', extra(worst ? worst.at : centre)));
  const required = requiredVoid(stair, geo, { slabUnderside: underside, headroom: L.headroom });
  const needed = upFp.length && required.length ? intersection(required, upFp) : [];
  const missing = needed.length ? (voids.length ? difference(needed, voids.map((v) => v.polygon)) : needed) : [];
  const gap = netArea(missing);
  if (needed.length) {
    const xs = needed.flatMap((e) => e.outer.map((p) => p[0])), ys = needed.flatMap((e) => e.outer.map((p) => p[1]));
    const ext = `x ${Math.min(...xs).toFixed(1)}–${Math.max(...xs).toFixed(1)}, y ${Math.min(...ys).toFixed(1)}–${Math.max(...ys).toFixed(1)}`;
    out.push(finding('stair-void', gap <= 1 ? 'pass' : 'fail', key, gap <= 1 ? `${name}: the opening above is large enough` : (voids.length ? `${name}: the opening above is too small` : `${name}: no opening in the floor above`),
      `For ${mm(L.headroom)} headroom the floor above must be open over ${ext} (${(netArea(needed) / 1e4).toFixed(2)} m²)${gap <= 1 ? '; the opening covers it.' : `; ${(gap / 1e4).toFixed(2)} m² of it is still slab. Enlarge the opening.`}`,
      extra(gap > 1 ? { x: missing[0].outer[0][0], y: missing[0].outer[0][1] } : centre)));
  }

  // handrail, guards
  const sides = stairSides(stair, geo, levelPlan(plan, level) || plan);
  const open = sides.filter((s) => !s.wall && Math.max(s.ha, s.hb) >= L.guardDrop);
  const needsRail = geo.flights.some((f) => f.risers >= L.handrailFrom);
  if (needsRail) {
    const none = stair.handrail === false && (stair.guard === false || !sides.some((s) => !s.wall));
    out.push(finding('stair-handrail', none ? 'fail' : 'pass', key, `${name}: handrail`,
      none ? 'This stair has no handrail; a flight of 3 or more steps needs one (one side is enough inside a dwelling).'
        : `Handrail on ${sides.some((s) => s.wall) ? 'the wall side' : ''}${sides.some((s) => s.wall) && sides.some((s) => !s.wall) ? ' and ' : ''}${sides.some((s) => !s.wall) ? 'the guard of the open side' : ''}.`, extra(centre)));
  }
  const openVoidEdges = voids.filter((v) => v.railing === false);
  const guardMissing = (open.length && stair.guard === false) || openVoidEdges.length;
  if (open.length || voids.length) {
    out.push(finding('stair-guard', guardMissing ? 'fail' : 'pass', key, `${name}: guards`,
      guardMissing ? `A guard is required where the drop is ${L.guardDrop} cm or more: ${[open.length && stair.guard === false ? 'the open side of the stair' : '', openVoidEdges.length ? 'round the opening in the floor above' : ''].filter(Boolean).join(' and ')} has none.`
        : `${open.length ? `${open.length} open side${open.length > 1 ? 's' : ''} of the stair` : 'No open side'}${voids.length ? ' and the opening above' : ''} ha${open.length + (voids.length ? 1 : 0) > 1 ? 've' : 's'} a guard (drop ≥ ${L.guardDrop} cm).`, extra(centre)));
    out.push(finding('stair-guard-height', 'info', key, `${name}: guard heights used`,
      `Unverified — secondary source: the 3D guard is ${mm(L.guardStair)} above the nosing line along the stair and ${mm(L.guardFlat)} round the opening above; SI 1142 itself was not read.`, extra(centre)));
  }
  return out;
}

/**
 * Findings for every stair of every level.
 * @param {{ plan: object }} args
 * @returns {object[]}
 */
export function checkStairs({ plan, store }) {
  if (!plan) return [];
  const list = stairsOfPlan(plan);
  return [...list.flatMap((s) => checkStair(plan, s)), ...itemsInVoids(plan, store)];
}

/**
 * Furniture standing over an opening in the floor (stage F4b): every item (not hidden) on a level whose footprint
 * overlaps one of that level's voids by more than 1 cm². Findings `item-in-void:<itemId>` with `level` and `itemIds`.
 */
function itemsInVoids(plan, store) {
  const items = (store && Array.isArray(store.items)) ? store.items : [];
  if (!items.length) return [];
  const out = [];
  for (const id of levelIds(plan)) {
    const voids = voidsOf(levelOf(plan, id));
    if (!voids.length) continue;
    for (const it of items) {
      if (!it || it.hidden || (it.level || GROUND) !== id || !(it.w > 0 && it.d > 0)) continue;
      const v = voids.find((q) => intersectArea([itemCorners(it)], [q.polygon]) > 1);
      if (!v) continue;
      out.push(finding('item-in-void', 'fail', it.id, `${it.name || it.type || 'An item'} stands over the opening in the floor`,
        `It overlaps the opening ${v.id}${v.stair ? ` above stair ${v.stair}` : ''} on the ${String(levelName(plan, id) || id).toLowerCase()}: move it onto the floor.`,
        { level: id, itemIds: [it.id], at: { x: it.x, y: it.y } }));
    }
  }
  return out;
}

export { GROUND };
