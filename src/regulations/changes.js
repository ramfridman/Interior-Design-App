/**
 * "Changes to the approved plan" — what the owner changed compared with the architect's drawing (plan-edit.js
 * `planDiff()`), what each change means for the permit, and the regulation checks an edit can break.
 *
 * Only the live plan (`PLAN`) can be compared with the architect's; for any other plan object nothing is returned.
 */
import { PLAN } from '../core/plan.js';
import { BASE_PLAN, planDiff, isPlanModified } from '../core/plan-edit.js';
import { finding, roomMetrics, planMetrics, sizeVerdict, HABITABLE, SERVICE } from './building.js';
import { m } from './geom.js';

const RULE_OF = { free: 'plan-change-free', warn: 'plan-change-structural', permit: 'plan-change-permit' };
const SEVERITY_OF = { free: 'info', warn: 'warn', permit: 'warn' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

let baseMetrics = null;
/** Size and daylight of the architect's rooms, by id (computed once — BASE_PLAN never changes). */
function baseline() {
  if (!baseMetrics) baseMetrics = new Map(BASE_PLAN.rooms.map((r) => [r.id, { room: r, shape: JSON.stringify(r.polygon), ...roomMetrics(BASE_PLAN, r) }]));
  return baseMetrics;
}

function detailOf(item) {
  if (item.level === 'permit') {
    return `This changes an exterior wall opening, i.e. the outside of the building and its façade, so it is not an "internal change" (שינוי פנימי): `
      + 'under §145(a)(2) of the Planning and Building Law it has to be in the building permit — ask the architect to put it into the permit application, or to file an amendment if the permit was already issued, before it is built. '
      + 'Only swapping a window for one of the same size in the same place is exempt (exempt-works regulations, reg. 20(a)). The architect must also re-check the room\'s daylight, the lintel and the thermal calculation.';
  }
  if (item.level === 'warn') {
    const t = (/(\d+) cm/.exec(item.text) || [])[1] || '20';
    return `Caution rather than a regulation: the partitions on this plan are 10 cm thick, and a ${t} cm interior wall may be a load-bearing block or concrete wall, or may carry a beam or the roof slab — the drawing does not say which. `
      + 'Get written confirmation from the structural engineer of record before this wall is removed, moved or cut. '
      + 'If it turns out to be part of the structural frame (שלד), the change is no longer an "internal change" under §145(a)(2) of the Planning and Building Law and needs a permit amendment with the engineer\'s calculations.';
  }
  return `Non-structural change inside the house: it does not touch the exterior, the structural frame or the floor area, so it counts as an "internal change" (שינוי פנימי) that needs no permit under §145(a)(2) of the Planning and Building Law. `
    + 'Tell the architect so the working drawings (and the electrical and plumbing plans) follow it; the rooms it creates must still meet the minimum sizes, light and door widths checked below.';
}

/**
 * Findings of the category "Changes to the approved plan".
 * @param {{ plan: object }} args
 */
export function checkChanges({ plan }) {
  const out = [];
  if (plan !== PLAN) return out;
  const diff = isPlanModified() ? planDiff() : { changed: false, items: [] };
  if (!diff.changed) {
    out.push(finding('plan-change-summary', 'pass', 'all', 'The plan is the architect\'s drawing — nothing was changed',
      'Walls, doors and windows are exactly as on the architect\'s plan submitted for the permit.'));
    return out;
  }

  // one finding per change
  const seen = new Set();
  const count = { free: 0, warn: 0, permit: 0 };
  diff.items.forEach((item, i) => {
    const level = RULE_OF[item.level] ? item.level : 'free';
    count[level]++;
    let key = `${item.kind}:${item.ref}`;
    if (seen.has(key)) key += `:${i}`;
    seen.add(key);
    const head = level === 'permit' ? 'Permit: ' : level === 'warn' ? 'Structural engineer: ' : '';
    out.push(finding(RULE_OF[level], SEVERITY_OF[level], key, head + item.text, detailOf(item), item.at ? { at: { x: item.at.x, y: item.at.y } } : undefined));
  });

  // consequences: regulation checks that a change broke (rooms the owner created or reshaped, windows lost)
  const base = baseline(), metrics = planMetrics(plan);
  const broken = new Set();
  for (const r of plan.rooms) {
    const now = metrics.get(r);
    const was = base.get(r.id);
    const isNew = !was;
    const reshaped = was && (was.shape !== JSON.stringify(r.polygon) || was.room.type !== r.type);
    const at = r.label ? { x: r.label[0], y: r.label[1] } : undefined;
    const origin = isNew ? 'was created by a new wall' : 'was reshaped';

    if (isNew || reshaped) {
      const v = sizeVerdict(r.type, now.area, now.width);
      const before = was ? sizeVerdict(was.room.type, was.area, was.width) : null;
      if (!v.ok && (!before || before.ok)) {
        broken.add(r.id);
        out.push(finding('plan-change-room', v.severity === 'pass' ? 'info' : v.severity, r.id, `${r.name} is now ${now.area.toFixed(2)} m² and ${m(now.width)} m wide — below the minimum`,
          `${r.name} ${origin} and is ${now.area.toFixed(2)} m² with ${m(now.width)} m between walls`
          + (was ? ` (it was ${was.area.toFixed(2)} m² and ${m(was.width)} m)` : '') + `. A room of this type needs ${v.need}. `
          + (HABITABLE.has(r.type) ? (v.half ? 'As it stands it can only be counted as a "small room" (חדרון, 6.0 m² and 2.00 m), not as a full room. ' : '')
            + 'Move the wall to give it the minimum size, or — if it is meant as a walk-in closet or store — set its type accordingly: those have no minimum size and need no window.' : 'Move the wall back.'), { spaceId: r.id, at }));
      }
    }

    const lit = HABITABLE.has(r.type) || r.type === 'kitchen';
    const share = r.type === 'kitchen' ? 0.05 : 0.08;
    if (lit && now.ratio < share && (isNew || was.ratio >= share || !(HABITABLE.has(was.room.type) || was.room.type === 'kitchen'))) {
      broken.add(r.id);
      const lost = was ? was.windows.filter((o) => !now.windows.some((n) => n.id === o.id)).length : 0;
      out.push(finding('plan-change-light', 'fail', r.id, now.windows.length ? `${r.name}: windows are now only ${(now.ratio * 100).toFixed(1)}% of the floor` : `${r.name} has no window after the change`,
        `${r.name} ${isNew || reshaped ? origin + (lost ? ' and ' : '') : ''}${lost ? `lost ${plural(lost, 'window')}` : isNew || reshaped ? '' : 'has less window area than before'}: it now has ${now.glazing.toFixed(2)} m² of window for ${now.area.toFixed(2)} m² of floor. `
        + `A habitable room or kitchen must have windows to the open air of at least ${share * 100}% of its floor (${(now.area * share).toFixed(2)} m² here). `
        + 'Put a window in one of its exterior walls (a permit matter), move the wall so the room keeps a window, or make it a closet room / store, which needs neither light nor ventilation.', { spaceId: r.id, at }));
    } else if (SERVICE.has(r.type) && was && SERVICE.has(was.room.type)) {
      const need = Math.max(now.area * 0.1, 0.3), needWas = Math.max(was.area * 0.1, 0.3);
      if (now.glazing < need - 1e-6 && was.glazing >= needWas - 1e-6) {
        broken.add(r.id);
        out.push(finding('plan-change-light', 'warn', r.id, `${r.name} can no longer be ventilated by its window alone`,
          `After the change ${r.name} has ${now.glazing.toFixed(2)} m² of window but needs ${need.toFixed(2)} m² (10% of the floor, not less than 0.3 m²). A vent duct or mechanical extractor is now required.`, { spaceId: r.id, at }));
      }
    }
  }

  // summary
  const n = diff.items.length;
  const parts = [];
  if (count.permit) parts.push(`${count.permit} to an exterior opening (permit)`);
  if (count.warn) parts.push(`${count.warn} to a thick wall (structural engineer)`);
  if (count.free) parts.push(`${count.free} non-structural`);
  out.push(finding('plan-change-summary', count.permit || count.warn || broken.size ? 'warn' : 'info', 'all',
    n ? `${plural(n, 'change')} to the architect's plan: ${parts.join(', ')}` : 'The plan differs from the architect\'s drawing',
    (n ? `Compared with the architect's drawing: ${parts.join('; ')}.` : 'Room names or types were changed; walls and openings are as drawn.')
    + (count.permit ? ' Changes to exterior openings must go into the building permit before they are built.' : '')
    + (count.warn ? ' Changes to thick interior walls need the structural engineer\'s confirmation first.' : '')
    + (broken.size ? ` ${plural(broken.size, 'room')} no longer meet${broken.size === 1 ? 's' : ''} the size or daylight rules because of the changes — see the findings in this group.` : n ? ' The changed rooms still meet the size and daylight rules.' : '')
    + ' Building work must follow the permit (Planning and Building Law §145(a)) — give the architect this list so the drawings are updated before anything is built.'));
  return out;
}
