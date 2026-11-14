/**
 * Checks that depend only on the building and the lot (plan data + ceiling height + mamad wall finish).
 * Everything is computed from `plan` — no coordinates are hard-coded.
 */
import { roomFloorArea } from '../core/levels.js';
import { areaM2, polygonArea, pointInPolygon, polygonBounds, pointInRect, convexOverlap, edgeNormal, rectExtent, inWallOrOpening, openingFrame, openingPoint, openingPoly, wallPolys } from '../core/geometry.js';
import { ruleById, refString } from './rules.js';
import { m, num, planRev, rectPoly, wallObstacle, openingObstacle, freeDepth, largestInnerRect, narrowPassages, overshoot, segDist, polyInside } from './geom.js';

/** Build one finding; category / kind / reference come from the rule. */
export function finding(ruleId, severity, key, title, detail, extra) {
  const r = ruleById(ruleId);
  return { id: `${ruleId}:${key}`, ruleId, severity, category: r.category, kind: r.kind, title, detail, reference: refString(r), ...extra };
}

export const HABITABLE = new Set(['bedroom', 'living', 'mamad', 'study', 'dining', 'office', 'guest', 'family']);
export const SERVICE = new Set(['bathroom', 'wc']);
const CORRIDOR = new Set(['corridor', 'hall', 'passage', 'lobby']);
const pct = (v) => (v * 100).toFixed(1) + '%';
const centre = (poly) => { const b = polygonBounds(poly); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; };
const spot = (space) => (space.label ? { x: space.label[0], y: space.label[1] } : centre(space.polygon));
const openingCentre = (o) => { const F = openingFrame(o); return { x: F.cx, y: F.cy }; };
const isDoor = (o) => o.kind === 'door' || o.kind === 'sliding-door';
const isPassage = (o) => o.kind === 'opening';                         // door-less passage added by the owner
const isGlazed = (o) => o.kind === 'window' || o.kind === 'sliding-door' || /glass/.test(o.style || '');
export const roomById = (plan, id) => plan.rooms.find((r) => r.id === id) || plan.outdoorAreas.find((r) => r.id === id) || null;
const roomAt = (plan, x, y) => plan.rooms.find((r) => pointInPolygon(x, y, r.polygon)) || null;

/** Exterior glazed openings (windows and glazed doors) of a room. */
export const roomGlazing = (plan, roomId) => plan.openings.filter((o) => o.exterior && isGlazed(o) && (o.rooms || []).includes(roomId));
const openingArea = (o) => (o.width * o.height) / 1e4;

/**
 * Size and daylight of one room, computed from its polygon and the openings that list it. Works on edited plans:
 * the polygon may contain a zero-width slit (free-standing wall) — area, the largest clear rectangle and the
 * window list are not affected by it.
 * @returns {{ area, rect, width, windows, glazing, ratio }} area m², width cm (shorter side of the largest clear rectangle)
 */
export function roomMetrics(plan, r) {
  // a void (the opening over a stair, stage F4b) is not floor: the room's area is its polygon less its voids
  const area = Array.isArray(plan.voids) && plan.voids.length ? roomFloorArea(plan, r, polygonArea) / 1e4 : areaM2(r.polygon);
  const rect = largestInnerRect(r.polygon);
  const windows = roomGlazing(plan, r.id);
  const glazing = windows.reduce((s, o) => s + openingArea(o), 0);
  return { area, rect, width: Math.min(rect.w, rect.h), windows, glazing, ratio: area ? glazing / area : 0 };
}

const METRICS = new WeakMap();
/** roomMetrics of every room of a plan (Map room → metrics), computed once per plan revision. */
export function planMetrics(plan) {
  const rev = planRev(plan);
  const hit = METRICS.get(plan);
  if (hit && hit.rev === rev) return hit.map;
  const map = new Map(plan.rooms.map((r) => [r, roomMetrics(plan, r)]));
  METRICS.set(plan, { rev, map });
  return map;
}

/** The living-type room that holds the kitchen: the one with the 'kitchen' zone, else the largest. */
export function kitchenRoom(plan) {
  const living = plan.rooms.filter((r) => r.type === 'living');
  return living.find((r) => (r.zones || []).some((z) => z.id === 'kitchen'))
    || living.reduce((best, r) => (!best || areaM2(r.polygon) > areaM2(best.polygon) ? r : best), null);
}

/**
 * Verdict of the minimum-size rule for a room of this type: { ok, severity, need } (need = text of the minimum).
 * Rooms that are not for living, washing or cooking (closet, store, laundry) have no statutory minimum.
 */
export function sizeVerdict(type, area, width) {
  if (HABITABLE.has(type)) {
    if (area >= 8 && width >= 260) return { ok: true, severity: 'pass', need: '8.0 m² and 2.60 m' };
    // §2.04(a)(4): a "small room" (חדרון) may be 6.0 m² and 2.00 m wide
    return { ok: false, severity: area >= 6 && width >= 200 ? 'warn' : 'fail', half: area >= 6 && width >= 200, need: '8.0 m² and 2.60 m' };
  }
  if (type === 'kitchen') { const ok = area >= 6 && width >= 170; return { ok, severity: ok ? 'pass' : 'fail', need: '6.0 m² and 1.70 m' }; }
  if (type === 'bathroom') { const ok = area >= 2.5 && width >= 145; return { ok, severity: ok ? 'pass' : (area >= 1.8 && width >= 90 ? 'info' : 'fail'), need: '2.5 m² and 1.45 m (1.8 m² and 0.90 m for a shower-and-toilet room)' }; }
  if (type === 'wc') { const ok = area >= 1.1 && width >= 80; return { ok, severity: ok ? 'pass' : 'fail', need: '1.1 m² and 0.80 m' }; }
  return { ok: true, severity: 'pass', need: null };
}
const dimsOf = (o) => `${m(o.width)} × ${m(o.height)} m`;

// ───────────────────────── rooms ─────────────────────────

function checkRooms(plan, H, out, metrics, multi = false) {
  let big = null;
  const mismatches = [];
  const kitchenIn = kitchenRoom(plan);
  for (const r of plan.rooms) {
    const { area, rect, width } = metrics.get(r);
    const at = spot(r);
    const size = `${area.toFixed(2)} m², clear width ${m(width)} m`;
    const v = sizeVerdict(r.type, area, width);
    if (r.drawnArea && Math.abs(area - r.drawnArea) > 0.35) mismatches.push(`${r.name}: ${area.toFixed(2)} m² computed vs ${r.drawnArea} m² written`);
    if (HABITABLE.has(r.type)) {
      if (!big || area > big.area) big = { r, area };
      out.push(finding('room-size-habitable', v.severity, r.id, `${r.name}: ${size}`,
        v.ok ? `${r.name} is ${area.toFixed(2)} m² with ${m(width)} m between walls — meets the minimum for a habitable room (8.0 m² and 2.60 m).`
          : `${r.name} is ${area.toFixed(2)} m² with ${m(width)} m between walls — a habitable room needs at least 8.0 m² and 2.60 m.`
            + (v.half ? ' It is large enough only for a "small room" (חדרון, half room: 6.0 m² and 2.00 m) — it cannot be counted as a full bedroom or living room.'
              : ' Too small even for a half room (6.0 m² and 2.00 m): it can only serve as a closet room or store, which have no minimum — change the room type if that is the intention.'),
        { spaceId: r.id, at }));
      if (r === kitchenIn) {
        const ok = area >= 6 && width >= 170;
        out.push(finding('room-size-kitchen', ok ? 'pass' : 'fail', r.id, `Open kitchen inside ${r.name}`,
          ok ? `The kitchen is part of the open ${area.toFixed(1)} m² living space (largest clear rectangle ${m(rect.w)} × ${m(rect.h)} m), far above the 6.0 m² / 1.70 m required for a kitchen.`
            : `The space that holds the kitchen is ${area.toFixed(1)} m² with ${m(width)} m between walls — a kitchen needs 6.0 m² and 1.70 m.`,
          { spaceId: r.id, at }));
      }
    } else if (r.type === 'kitchen') {
      out.push(finding('room-size-kitchen', v.severity, r.id, `${r.name}: ${size}`,
        `${r.name} is ${area.toFixed(2)} m² and ${m(width)} m wide — ${v.ok ? 'meets' : 'below'} the kitchen minimum of 6.0 m² and 1.70 m (5.0 m² next to a dining area of at least 4.0 m²).`,
        { spaceId: r.id, at }));
    } else if (r.type === 'bathroom') {
      out.push(finding('room-size-bathroom', v.severity, r.id, `${r.name}: ${size}`,
        v.ok ? `${r.name} is ${area.toFixed(2)} m² and ${m(width)} m wide — above the bathroom minimum of 2.5 m² and 1.45 m.`
          : `${r.name} is ${area.toFixed(2)} m² and ${m(width)} m wide. A bathroom needs 2.5 m² and 1.45 m; a shower-and-toilet room 1.8 m² and 0.90 m.`,
        { spaceId: r.id, at }));
    } else if (r.type === 'wc') {
      out.push(finding('room-size-wc', v.severity, r.id, `${r.name}: ${size}`,
        `${r.name} is ${area.toFixed(2)} m² and ${m(width)} m wide — ${v.ok ? 'meets' : 'below'} the minimum of 1.1 m² and 0.80 m for a toilet room.`,
        { spaceId: r.id, at }));
    } else if (CORRIDOR.has(r.type)) {
      const ok = width >= 90;
      out.push(finding('corridor-width', ok ? 'pass' : 'fail', r.id, `${r.name}: ${m(width)} m wide`,
        `${r.name} is ${m(width)} m wide — ${ok ? 'above' : 'below'} the 0.90 m minimum for a corridor inside a dwelling (1.00 m where it is the main entrance).`, { spaceId: r.id, at }));
    } else {
      out.push(finding('room-size-service', 'pass', r.id, `${r.name}: ${size}`,
        `${r.name} is ${area.toFixed(2)} m² and ${m(width)} m wide. The regulations set no minimum area for a laundry / service room, closet room or store.`,
        { spaceId: r.id, at }));
    }
  }
  if (big && !multi) {                 // several floors: one check for the whole dwelling (regulations/levels.js)
    out.push(finding('room-size-habitable', big.area >= 12 ? 'pass' : 'fail', 'largest', `Largest room: ${big.r.name}, ${big.area.toFixed(1)} m²`,
      `A dwelling with two or more rooms needs at least one habitable room of 12.0 m²; ${big.r.name} has ${big.area.toFixed(1)} m².`, { spaceId: big.r.id, at: spot(big.r) }));
  }
  const habit = H >= 250, serv = H >= 205;
  out.push(finding('ceiling-height', habit ? 'pass' : 'fail', 'all', `Ceiling height ${m(H)} m`,
    habit ? `The ${m(H)} m ceiling is above the 2.50 m minimum for habitable rooms and the 2.05 m minimum for bathrooms, service rooms and corridors.`
      : `A ${m(H)} m ceiling is below the 2.50 m minimum for habitable rooms${serv ? ' (it would only be acceptable in bathrooms, service rooms and internal corridors, minimum 2.05 m)' : ''}.`));
  // openings must fit under the ceiling that is actually set for the project
  for (const o of plan.openings) {
    const head = num(o.sill, 0) + num(o.height, 0);
    if (head <= H) continue;
    out.push(finding('ceiling-height', 'fail', `opening:${o.id}`, `${o.kind === 'window' ? 'Window' : 'Door'} head at ${m(head)} m is above the ${m(H)} m ceiling`,
      `This ${o.kind === 'window' ? 'window' : 'opening'} reaches ${m(head)} m above the floor but the ceiling height of the project is ${m(H)} m. Lower the opening or correct the ceiling height.`, { at: openingCentre(o), spaceId: (o.rooms || [])[0] }));
  }
  if (!plan.rooms.some((r) => r.drawnArea)) out.push(finding('plan-consistency', 'info', 'areas', 'Not checked: room areas against the drawing', 'No room areas are written for this plan, so the computed areas cannot be compared with a drawing.'));
  else out.push(finding('plan-consistency', mismatches.length ? 'info' : 'pass', 'areas', mismatches.length ? 'Room areas differ from the drawing' : 'Room areas match the drawing',
    mismatches.length ? mismatches.join('; ') + '.' : 'Every room area computed from the digitised plan is within 0.35 m² of the area written on the drawing.'));
}

// ───────────────────────── light & ventilation ─────────────────────────

function checkLight(plan, out, metrics) {
  const kitchenIn = kitchenRoom(plan);
  for (const r of plan.rooms) {
    const { area, windows: wins, glazing: total, ratio } = metrics.get(r);
    const list = wins.length ? wins.map((o) => `${o.kind === 'window' ? 'window' : 'glazed door'} ${dimsOf(o)}`).join(', ') : 'no window';
    const assumed = wins.some((o) => (o.assumed || []).some((f) => f === 'height' || f === 'width'));
    const extra = { spaceId: r.id, at: wins[0] ? openingCentre(wins[0]) : spot(r) };
    if (HABITABLE.has(r.type)) {
      const ok = ratio >= 0.08;
      out.push(finding('light-habitable', ok ? 'pass' : 'fail', r.id, wins.length ? `${r.name}: windows ${pct(ratio)} of the floor` : `${r.name}: no window to the open air`,
        wins.length ? `${r.name} window area is ${total.toFixed(2)} m² (${list}) = ${pct(ratio)} of the ${area.toFixed(2)} m² floor — ${ok ? 'meets' : 'below'} the 8% minimum${r === kitchenIn ? ' (the open kitchen needs 5%)' : ''}.`
          + (ok ? '' : ` At least ${(area * 0.08).toFixed(2)} m² is required.`)
          : `${r.name} has no window or glazed door in an exterior wall. A habitable room must have windows to the open air with a total area of at least 8% of its floor (${(area * 0.08).toFixed(2)} m² here). Only a closet room or store may be windowless.`, extra));
    } else if (r.type === 'kitchen') {
      const ok = ratio >= 0.05;
      out.push(finding('light-kitchen', ok ? 'pass' : 'fail', r.id, wins.length ? `${r.name}: windows ${pct(ratio)} of the floor` : `${r.name}: no window to the open air`,
        `${r.name} window area is ${total.toFixed(2)} m² (${list}) = ${pct(ratio)} of the ${area.toFixed(2)} m² floor — ${ok ? 'meets' : 'below'} the 5% minimum for a kitchen.`, extra));
    } else if (SERVICE.has(r.type)) {
      const need = Math.max(area * 0.1, 0.3);
      const ok = total >= need - 1e-6;
      out.push(finding('light-service', ok ? 'pass' : 'warn', r.id,
        ok ? `${r.name}: window ${total.toFixed(2)} m² ventilates the room` : `${r.name}: window too small to ventilate alone — plan an extractor fan`,
        ok ? `${r.name} has ${total.toFixed(2)} m² of window (${list}); the minimum for natural ventilation is ${need.toFixed(2)} m² (10% of the ${area.toFixed(2)} m² floor, not less than 0.3 m²).`
          : `${r.name} has ${total.toFixed(2)} m² of window (${list}) but natural ventilation needs ${need.toFixed(2)} m² (10% of the ${area.toFixed(2)} m² floor, not less than 0.3 m²). `
            + 'This is allowed if a mechanical extractor or vent duct (at least 3 air changes per hour) is installed — make sure one is on the electrical and HVAC plans.'
            + (assumed ? ' The window height is an assumption (not written on the drawing); confirm it.' : ''), extra));
    } else if (!CORRIDOR.has(r.type)) {
      const solidDoor = plan.openings.some((o) => o.exterior && isDoor(o) && !isGlazed(o) && (o.rooms || []).includes(r.id));
      const laundry = r.type === 'service';
      out.push(finding('vent-laundry', total > 0 ? 'pass' : 'info', r.id, total > 0 ? `${r.name}: has a window` : `${r.name}: no window${laundry ? ' — add an extractor' : ''}`,
        total > 0 ? `${r.name} has ${total.toFixed(2)} m² of window.`
          : `${r.name} has no window${solidDoor ? ' (its outside door is solid)' : ''}. `
            + (laundry ? 'With a washer and dryer, plan a mechanical extractor or a louvred door to remove moisture and heat.' : 'That is acceptable for a closet room or store; if anything damp or warm is kept there, add a vent or a louvred door.'), extra));
    }
  }

  // window sills / fall protection
  // an upper floor (level view, stage F7) is its elevation higher above the garden
  const drop = num(plan.heights && plan.heights.floorAboveGround, 0) + num(plan.elevation, 0);
  const windows = plan.openings.filter((o) => o.kind === 'window' && o.exterior);
  if (windows.length) {
    const lowest = windows.reduce((a, b) => (b.sill < a.sill ? b : a));
    if (drop < 60) {
      out.push(finding('sill-guard', 'pass', 'all', `Window sills ${Math.min(...windows.map((o) => o.sill))}–${Math.max(...windows.map((o) => o.sill))} cm: no guards needed`,
        `The floor is only ${drop} cm above the garden, so no window has a fall of 60 cm or more and no guard rail is required. Lowest sill: ${lowest.sill} cm. (On an upper storey, sills below 1.05 m would need a guard.)`));
    } else {
      for (const o of windows.filter((w) => w.sill < 105)) {
        out.push(finding('sill-guard', 'warn', o.id, `Window sill ${o.sill} cm above a ${drop} cm drop`,
          `This window has a sill ${o.sill} cm above the floor and the ground outside is ${drop} cm lower — a guard to 1.05 m (SI 1142) or fixed safety glazing is needed.`, { at: openingCentre(o), spaceId: (o.rooms || [])[0] }));
      }
    }
  }
  const glazedDoors = plan.openings.filter((o) => o.exterior && o.kind !== 'window' && isGlazed(o));
  for (const o of glazedDoors) {
    out.push(finding('glazing-safety', 'info', o.id, `Glazed door ${dimsOf(o)}: specify safety glass`,
      `The ${dimsOf(o)} glazed door reaches the floor. Glazing must follow SI 1099 — ask for laminated or tempered safety glass and a visible marking at eye level.`, { at: openingCentre(o), spaceId: (o.rooms || [])[0] }));
  }
}

// ───────────────────────── doors & corridors ─────────────────────────

function checkDoors(plan, out, multi = false) {
  const doors = plan.openings.filter((o) => isDoor(o) || isPassage(o));
  let wideToiletDoor = false;
  const serviceDoors = [];
  for (const o of doors) {
    const rooms = (o.rooms || []).map((id) => roomById(plan, id)).filter(Boolean);
    const inner = rooms.filter((r) => plan.rooms.includes(r));
    const at = openingCentre(o);
    const size = `${o.width} × ${o.height} cm`;
    const hOk = o.height >= 198;
    const assumed = (o.assumed || []).includes('height') ? ' (height assumed — not written on the drawing)' : '';
    if (o.style === 'mamad') continue;                                   // checked with the safe room
    if (o.style === 'entry') {
      const ok = o.width >= 80 && hOk && o.kind === 'door';
      out.push(finding('door-entry', ok ? 'pass' : 'fail', o.id, `Entrance door ${size}`,
        ok ? `The entrance door is ${o.width} cm wide and ${o.height} cm high — above the 80 cm clear width and 1.98 m height required for the exit door of a dwelling, and it is hinged (a sliding door may not be the main entrance).`
          : `The entrance door is ${size}; the exit door of a dwelling needs 80 cm clear width, 1.98 m height and may not be a sliding door.`, { at, spaceId: inner[0] && inner[0].id }));
      continue;
    }
    if (o.kind === 'sliding-door') {
      out.push(finding('door-room', 'pass', o.id, `Sliding door ${size}`,
        `The ${m(o.width)} m sliding glass door is a secondary door — sliding doors are allowed inside a dwelling as long as they are not the main entrance.`, { at, spaceId: inner[0] && inner[0].id }));
      continue;
    }
    const svc = inner.find((r) => SERVICE.has(r.type));
    const other = inner.find((r) => r.type !== 'living') || inner[0];
    const name = (svc ? svc.name : other ? other.name : 'Door') + (o.exterior ? ' outside' : '');
    if (isPassage(o)) {
      // door-less passage: the clear opening must be as wide as the door it replaces
      const min = svc ? 60 : 70;
      const ok = o.width >= min && hOk;
      const between = rooms.map((r) => r.name).join(' and ') || name;
      out.push(finding(svc ? 'door-service' : 'door-room', ok ? 'pass' : 'fail', o.id, `Passage ${size} — ${between}`,
        `The open passage between ${between} is ${o.width} cm wide and ${o.height} cm high — ${ok ? 'above' : 'below'} the ${min} cm clear width and 1.98 m height the regulations set for the doorway of a ${svc ? 'service room' : 'room'} (applied here to an opening without a door leaf).`
        + (svc ? ' A bathroom or WC needs a door for privacy — a door-less passage into it is unusual.' : ''), { at, spaceId: (svc || other || {}).id }));
      continue;
    }
    if (svc) {
      serviceDoors.push({ o, svc });
      if (o.width >= 70) wideToiletDoor = true;
      const ok = o.width >= 60 && hOk;
      out.push(finding('door-service', ok ? 'pass' : 'fail', o.id, `${name} door ${size}`,
        `The door to ${name} is ${o.width} cm wide and ${o.height} cm high${assumed} — ${ok ? 'above' : 'below'} the minimum (70 cm for at least one room with a toilet, 60 cm for the others, 1.98 m high).`, { at, spaceId: svc.id }));
    } else {
      const ok = o.width >= 70 && hOk;
      out.push(finding('door-room', ok ? 'pass' : 'fail', o.id, `${name} door ${size}`,
        `The door to ${name} is ${o.width} cm wide and ${o.height} cm high${assumed} — ${ok ? 'above' : 'below'} the 70 cm clear width and 1.98 m height required for room doors.`, { at, spaceId: other && other.id }));
    }
  }
  if (serviceDoors.length && !wideToiletDoor && !multi) {      // several floors: checked for the whole dwelling
    out.push(finding('door-service', 'fail', 'one-wide', 'No bathroom door of 70 cm', 'At least one room with a toilet must have a door 70 cm wide.'));
  }

  // every room needs a way in
  for (const r of plan.rooms) {
    if (plan.openings.some((o) => o.kind !== 'window' && (o.rooms || []).includes(r.id))) continue;
    out.push(finding('room-access', 'warn', r.id, `${r.name} has no door or passage`,
      `${r.name} is closed on all sides — no door or passage leads into it. Add a door, or remove the wall that cut it off.`, { spaceId: r.id, at: spot(r) }));
  }

  // corridors: narrow parts of the open living space
  for (const r of plan.rooms.filter((x) => x.type === 'living')) {
    const seen = [];
    for (const p of narrowPassages(r.polygon)) {
      if (seen.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 60)) continue;
      seen.push(p);
      const zone = (r.zones || []).reduce((best, z) => {
        const d = Math.hypot(z.label[0] - p.x, z.label[1] - p.y);
        return !best || d < best.d ? { z, d } : best;
      }, null);
      const name = zone && zone.d < Math.max(p.length, 150) ? zone.z.name : 'Passage';
      const ok = p.width >= 90;
      out.push(finding('corridor-width', ok ? 'pass' : 'fail', `${r.id}:${Math.round(p.x)}:${Math.round(p.y)}`, `${name}: ${m(p.width)} m wide`,
        `The ${name.toLowerCase()} is ${m(p.width)} m wide over ${m(p.length)} m — ${ok ? 'above' : 'below'} the 0.90 m minimum for a corridor inside a dwelling (1.00 m where it is the main entrance).`
        + (ok ? ' Keep it free of furniture: a 30 cm console would leave only ' + m(p.width - 30) + ' m.' : ''), { spaceId: r.id, at: { x: p.x, y: p.y } }));
    }
  }

  const bedrooms = plan.rooms.filter((r) => r.type === 'bedroom');
  if (bedrooms.length) {
    out.push(finding('smoke-detectors', 'info', 'all', `Smoke detectors: ${bedrooms.length} bedrooms + lobby`,
      `Install a stand-alone smoke detector in each bedroom (${bedrooms.map((r) => r.name).join(', ')}) and in the hall leading to them`
      + (plan.rooms.some((r) => r.type === 'mamad') ? '; also in the safe room if someone sleeps there' : '') + '. They are required for the completion certificate and are not shown on the furniture plan.'));
  }
}

// ───────────────────────── safe room ─────────────────────────

/**
 * Walls and openings lying along each edge of a room, with thickness and whether the far side is outdoors.
 * Works on any edge direction; walls and openings are rects (their x / y / w / h), projected on the edge's axes.
 */
export function roomSides(plan, room) {
  const poly = room.polygon, sides = [], wp = wallPolys(plan);
  const lo = (r, d) => rectExtent(r, d[0], d[1])[0], ext = (r, d) => rectExtent(r, d[0], d[1])[1];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    if (x1 === x2 && y1 === y2) continue;
    // p = the edge's normal in a fixed orientation ((0, 1) for horizontal, (1, 0) for vertical edges), e = along the edge
    const p = edgeNormal(x1, y1, x2, y2);
    let e = [p[1], -p[0] + 0];
    if (e[0] + e[1] < 0 || (e[0] + e[1] === 0 && e[0] < 0)) e = [-e[0] + 0, -e[1] + 0];
    const ea = x1 * e[0] + y1 * e[1], eb = x2 * e[0] + y2 * e[1], a = Math.min(ea, eb), b = Math.max(ea, eb), c = x1 * p[0] + y1 * p[1];
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const s = pointInPolygon(mx + p[0], my + p[1], poly) ? -1 : 1, n = [s * p[0] + 0, s * p[1] + 0];   // n points away from the room
    const s0 = s < 0 ? c - 2 : c, sw = b - a;                                                           // a 2 cm strip beyond the edge
    const strip = !e[0] || !e[1] ? null : [[x1, y1], [x2, y2], [x2 + n[0] * 2, y2 + n[1] * 2], [x1 + n[0] * 2, y1 + n[1] * 2]];
    const touching = (r, rp) => {
      const ox = Math.min(lo(r, e) + ext(r, e), a + sw) - Math.max(lo(r, e), a), oy = Math.min(lo(r, p) + ext(r, p), s0 + 2) - Math.max(lo(r, p), s0);
      return ox > 0 && oy > 0 && ox > 5 && (!strip || convexOverlap(strip, rp(), 0));
    };
    const walls = plan.walls.filter((w, k) => touching(w, () => wp[k])), openings = plan.openings.filter((o) => touching(o, () => openingPoly(o)));
    if (!walls.length && !openings.length) continue;
    const thick = (r) => ext(r, p);
    const thickness = Math.min(...walls.map(thick), ...(walls.length ? [] : openings.map(thick)));
    const px = mx + n[0] * (thickness + 10), py = my + n[1] * (thickness + 10);
    const dir = Math.abs(n[1]) >= Math.abs(n[0]) ? (n[1] < 0 ? 'north' : 'south') : (n[0] < 0 ? 'west' : 'east');
    sides.push({ dir, n, walls, openings, thickness, exterior: !roomAt(plan, px, py), at: { x: mx, y: my } });
  }
  return sides;
}

function checkMamad(plan, H, store, catalog, out, metrics) {
  let wallObstacles = null;
  for (const r of plan.rooms.filter((x) => x.type === 'mamad')) {
    const { area, width } = metrics.get(r), volume = area * H / 100;
    const at = spot(r), ex = { spaceId: r.id, at };
    const okA = area >= 9 && volume >= 22.5;
    out.push(finding('mamad-area', okA ? 'pass' : (area >= 5 ? 'warn' : 'fail'), r.id, `Safe room: ${area.toFixed(1)} m² net, ${volume.toFixed(1)} m³`,
      `The mamad has ${area.toFixed(2)} m² of net floor (walls excluded) and ${volume.toFixed(1)} m³ — ${okA ? 'above' : 'below'} the minimum of 9 m² and 22.5 m³`
      + (okA ? '.' : ' (a smaller room down to 5 m² needs a specific Home Front Command approval).'), ex));
    const okH = H >= 250 && H <= 280, okW = width >= 160;
    out.push(finding('mamad-height', !okW || H < 250 ? 'fail' : okH ? 'pass' : 'warn', r.id,
      okH ? `Safe room: ${m(H)} m high, ${m(width)} m wide` : `Safe room height ${m(H)} m is outside 2.50–2.80 m`,
      (okH ? `Clear height ${m(H)} m is within the 2.50–2.80 m range` : H > 280
        ? `The house ceiling is ${m(H)} m, but a mamad may be at most 2.80 m high unless the Home Front Command approves a higher room. Confirm with the architect whether the mamad has its own lower slab (then furniture and built-ins there must fit 2.80 m) or an approval for ${m(H)} m`
        : `Clear height ${m(H)} m is below the 2.50 m minimum`)
      + `; width ${m(width)} m ${okW ? 'meets' : 'is below'} the 1.60 m minimum.`, ex));

    const sides = roomSides(plan, r);
    const ext = sides.filter((s) => s.exterior);
    out.push(finding('mamad-ext-walls', ext.length <= 2 ? 'pass' : 'warn', r.id, `Safe room: ${ext.length} external wall${ext.length === 1 ? '' : 's'}`,
      `The mamad has ${ext.length} external wall${ext.length === 1 ? '' : 's'}${ext.length ? ' (' + ext.map((s) => s.dir).join(', ') + ')' : ''}; up to two are allowed without special approval.`, ex));

    // walls — reg. 208: external ≥ 25 cm, internal ≥ 20 cm, a wall holding a SLIDING blast window ≥ 30 cm
    const parts = [], notes = [];
    let wallFail = false, windowWallThin = false;
    const win = plan.openings.filter((o) => o.kind === 'window' && (o.rooms || []).includes(r.id));
    const walled = sides.filter((s) => s.walls.length);
    for (const s of walled) {
      const hasWin = s.openings.some((o) => win.includes(o));
      const need = s.exterior ? 25 : 20;
      if (s.thickness < need) wallFail = true;
      else if (hasWin && s.thickness < 30) windowWallThin = true;
      parts.push(`${s.dir} ${s.thickness} cm (${s.exterior ? 'external' : 'internal'}${hasWin ? ', holds the blast window' : ''}; minimum ${hasWin ? `${need} cm, 30 cm for a sliding blast window` : `${need} cm`})`);
      const odd = s.walls.find((w) => w.kind !== 'mamad');
      if (odd) notes.push(`the ${s.dir} wall is recorded in the plan data as an ordinary ${odd.kind} wall`);
    }
    const range = walled.length ? `${Math.min(...walled.map((s) => s.thickness))}–${Math.max(...walled.map((s) => s.thickness))} cm` : 'not drawn';
    out.push(finding('mamad-walls', wallFail ? 'fail' : notes.length || windowWallThin || !walled.length ? 'info' : 'pass', r.id,
      wallFail ? 'Safe-room wall thinner than required' : `Safe-room walls ${range}`,
      `Wall thickness as drawn: ${parts.join('; ')}. Required for reinforced-concrete shelter walls: external 25 cm, internal 20 cm, and 30 cm for a wall that holds a sliding blast window`
      + (wallFail ? ' — at least one wall is thinner.' : windowWallThin ? ' — the window wall is thinner than 30 cm, which is acceptable only with an outward-opening (not sliding) blast window.' : ' — all met.')
      + (notes.length ? ` Note: ${notes.join(' and ')} — every wall of the mamad must be reinforced concrete cast with the shell; confirm on the structural drawings.`
        : walled.length ? ` All ${walled.length} walls are recorded as reinforced-concrete shelter walls.` : ''), ex));

    // door
    const doors = plan.openings.filter((o) => isDoor(o) && (o.rooms || []).includes(r.id));
    for (const o of doors) {
      const dAt = openingCentre(o);
      const side = sides.find((s) => s.openings.includes(o));
      const outward = side ? (o.swing === side.dir[0]) : true;
      const blast = o.style === 'mamad';
      const okSize = o.width >= 70 && o.width <= 90 && o.height >= 200;
      const std = o.width <= 80;
      const assumed = (o.assumed || []).length ? ' The door size is an assumption in the plan data — confirm it against the Home Front Command approved drawing.' : '';
      out.push(finding('mamad-door', okSize && outward && blast ? (std ? 'pass' : 'info') : 'fail', o.id,
        blast ? `Blast door ${o.width} × ${o.height} cm, opens ${outward ? 'outwards' : 'INTO the mamad'}` : `Safe-room door ${o.width} × ${o.height} cm is not a blast door`,
        `The ${blast ? 'blast door' : `door (style "${o.style}")`} is ${o.width} × ${o.height} cm clear and opens ${outward ? 'out of' : 'into'} the mamad. Required: one gas-tight steel blast door, 70–80 × 200 cm clear opening, opening outwards`
        + (o.width > 80 ? ' (80–90 cm is only for a door facing a concrete wall closer than 1.30 m).' : '.') + assumed, { spaceId: r.id, at: dAt }));

      // second, ordinary leaf in the same doorway
      const inn = o.innerDoor;
      if (inn) {
        const iw = num(inn.width, o.width), ih = num(inn.height, o.height);
        const inward = !side || !inn.swing || inn.swing !== side.dir[0];
        const fits = iw <= o.width && ih <= o.height;
        out.push(finding('mamad-inner-door', inward && fits ? 'info' : 'warn', o.id,
          inward ? `Inner door ${iw} × ${ih} cm behind the blast door — optional, not a requirement` : 'Inner door opens OUTWARDS, against the blast door',
          `The safe-room doorway is drawn with two leaves: the steel blast door (opens ${outward ? 'outwards' : 'inwards'}) and an ordinary inner door ${iw} × ${ih} cm that opens ${inward ? 'into the room' : 'outwards'}. `
          + 'Status: the inner door is NOT required by the regulations. The Civil Defence regulations require one gas-tight blast door opening outwards (regs. 202(a), 204(a)) and do not mention a second, ordinary door for the safe room of a dwelling; '
          + 'they expressly allow "a regular door, opening inwards, for everyday use" in addition to the blast door only for protected spaces in health institutions (reg. 287(b)), and a second blast door only in place of the window, with approval (reg. 204(b2)). '
          + 'For a home it is an optional comfort feature that Home Front Command guidance is reported to permit (press report; not verified on the Home Front Command site) — ask the architect to confirm that the plan approved by the Home Front Command shows it. '
          + 'Conditions: the blast door, its frame and its seal stay untouched and are never removed; the inner door opens into the room and must not stop the blast door closing; '
          + `keep its ${iw} cm arc inside the room free of furniture.`
          + (inward ? '' : ' As drawn it swings the same way as the blast door — the two leaves would collide; hang it to open inwards.')
          + (fits ? '' : ' It is drawn larger than the blast-door opening — check the size.'), { spaceId: r.id, at: dAt }));
      } else if (blast) {
        out.push(finding('mamad-inner-door', 'pass', o.id, 'Safe-room doorway has the blast door only — nothing more is required',
          'The regulations require one gas-tight blast door opening outwards (regs. 202(a), 204(a)). A second, ordinary inner door is not required; Home Front Command guidance is reported to allow one as a comfort feature, opening inwards, as long as the blast door, its frame and its seal are not touched (confirm with the architect before adding it).', { spaceId: r.id, at: dAt }));
      }

      if (side && !side.exterior) {
        const dist = rayToExterior(plan, dAt, side.n, side.thickness / 2);
        const ok = dist >= 400;
        out.push(finding('mamad-door-position', ok ? 'pass' : 'info', o.id, `Blast door faces an external wall ${m(dist)} m away`,
          `Measured straight out from the blast door, the first external wall is ${m(dist)} m away; the rule is at least 4.00 m`
          + (ok ? '.' : ' — otherwise the door must be shielded by a concrete wall as the Home Front Command specification details. Confirm with the architect.'), { spaceId: r.id, at: dAt }));

        // free floor in front of the door, up to the first wall (an interior wall the owner adds can come too close)
        if (!wallObstacles) wallObstacles = [...plan.walls.map((w, i) => wallObstacle(plan, i, { wall: w })), ...plan.openings.filter((x) => x.kind === 'window').map((x) => openingObstacle(x, { wall: x }))];
        const F = openingFrame(o, plan), outFace = side.n[0] * F.nx + side.n[1] * F.ny > 0;
        const face = openingPoint(F, F.L / 2, outFace ? F.T : 0);                 // centre of the door's face on that side
        const { depth, hit } = freeDepth({ o: face, u: side.n, v: [F.ux, F.uy], hw: o.width / 2 }, 400, wallObstacles, { inset: 1 });
        const w = hit && hit.wall;
        const light = w && (w.cls === 'partition' || (w.kind === 'interior' && Math.min(w.w, w.h) < 15));
        const sev = depth < o.width ? 'fail' : depth < 110 ? 'warn' : depth < 130 && o.width < 80 && !light ? 'info' : 'pass';
        out.push(finding('mamad-door-clear', sev, o.id,
          depth >= 400 ? 'More than 4 m clear in front of the blast door' : `${m(depth)} m clear in front of the blast door`,
          (depth >= 400 ? 'No wall stands within 4 m in front of the blast door.' : `Straight out from the blast door the first wall is ${m(depth)} m away${light ? ' (a light partition)' : ''}.`)
          + (sev === 'fail' ? ` The ${o.width} cm leaf opens outwards and cannot swing fully open — the wall stands inside its arc. Move the wall.`
            : sev === 'warn' ? ` A wall that is part of the structure or made of reinforced concrete must be at least 1.10 m from the door so that a wheelchair user can open it${light ? '; for a light partition the regulation does not apply as written, but the same space is needed in practice — an alert leaves seconds to get in' : ''}.`
            : sev === 'info' ? ` With a structural or concrete wall closer than 1.30 m the blast door must be 80–90 cm wide (it is ${o.width} cm).`
            : ' The regulation asks for at least 1.10 m to a structural or concrete wall facing the door; the leaf itself needs its full width to open.'), { spaceId: r.id, at: dAt }));
      } else if (side) {
        out.push(finding('mamad-door-position', 'warn', o.id, 'Blast door is in an external wall', 'The blast door must be in an internal wall of the mamad, entered from inside the dwelling.', { spaceId: r.id, at: dAt }));
      }
    }
    if (doors.length !== 1) out.push(finding('mamad-door', 'warn', r.id + ':count', `Safe room has ${doors.length} doors`, 'A mamad has one blast door (a second one only instead of the window, with approval).', ex));

    // window
    if (win.length !== 1) {
      out.push(finding('mamad-window', 'warn', r.id + ':count', `Safe room has ${win.length} windows`, 'A mamad must have exactly one blast window.', ex));
    }
    for (const o of win) {
      const a = openingArea(o);
      const ok = o.sill >= 105 && a <= 1.21 + 1e-9 && o.width >= 60 && o.width <= 110 && o.height >= 80 && o.height <= 110;
      out.push(finding('mamad-window', ok ? 'pass' : 'fail', o.id, `Blast window ${o.width} × ${o.height} cm, sill ${o.sill} cm`,
        `The blast window is ${o.width} × ${o.height} cm (${a.toFixed(2)} m²) with its sill ${o.sill} cm above the floor. Required: one window, sill at least 105 cm, area up to 1.21 m², width 60–110 cm, height 80–110 cm — ${ok ? 'all met' : 'not met'}.`,
        { spaceId: r.id, at: openingCentre(o) }));
    }

    // finishes
    const chosen = store && store.finishes && store.finishes[r.id] && store.finishes[r.id].wall;
    const prod = chosen && catalog && typeof catalog.getProduct === 'function' ? catalog.getProduct(chosen) : null;
    const kind = prod && prod.params && prod.params.kind;
    const hard = kind && ['tile', 'stone', 'brick'].includes(kind);
    out.push(finding('mamad-finishes', hard ? 'fail' : 'pass', r.id, hard ? `Safe-room walls: ${kind} cladding is not allowed` : 'Safe-room walls: paint / plaster finish',
      hard ? `"${prod.name}" is a ${kind} wall finish. The walls and ceiling of a mamad may not be clad with tiles, stone or similar — they shatter and fly in a blast. Use paint, thin plaster or wallpaper.`
        : 'The mamad walls are finished with paint or a thin coating, as required (no ceramic, stone or brick cladding on walls or ceiling; floor tiles and a 10 cm skirting are fine).', ex));
  }
}

/** Distance from `from` along unit vector `n` to the first exterior wall / opening or the edge of the house. */
function rayToExterior(plan, from, n, skip) {
  const b = plan.bounds;
  for (let d = skip + 5; d < 3000; d += 5) {
    const x = from.x + n[0] * d, y = from.y + n[1] * d;
    if (x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) return d - skip;
    if (plan.walls.some((w) => w.kind === 'exterior' && pointInRect(x, y, w)) || plan.openings.some((o) => o.exterior && pointInRect(x, y, o))) return d - skip;
    if (!roomAt(plan, x, y) && !inWallOrOpening(x, y, plan)) return d - skip;
  }
  return 3000;
}

// ───────────────────────── site ─────────────────────────

/** Boundary edge on a compass side: { a, b } end points. */
export function boundaryEdge(boundary, side) {
  const c = centre(boundary);
  let best = null;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    const mx = (a[0] + b[0]) / 2 - c.x, my = (a[1] + b[1]) / 2 - c.y;
    const score = side === 'n' ? -my : side === 's' ? my : side === 'e' ? mx : -mx;
    const along = side === 'n' || side === 's' ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1]);
    if (along < Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.7) continue;
    if (!best || score > best.score) best = { a, b, score };
  }
  return best;
}
const SIDE_NAME = { n: 'north', e: 'east', s: 'south', w: 'west' };

function checkSite(plan, out, outlines) {
  const site = plan.site;
  if (!site || !site.boundary) return;
  // several floors (stage F7): the ground footprint united with the projections of the upper floors
  const wallOutlines = outlines || wallPolys(plan);

  // setbacks of the house from each property line
  const parts = [];
  let worst = 'pass';
  for (const side of ['w', 'n', 'e', 's']) {
    const e = boundaryEdge(site.boundary, side); if (!e) continue;
    let dist = Infinity;
    for (const poly of wallOutlines) for (const [x, y] of poly) dist = Math.min(dist, segDist(x, y, e.a[0], e.a[1], e.b[0], e.b[1]));
    const need = site.setbacks && site.setbacks[side];
    const ok = need == null || dist >= need - 2;
    if (!ok) worst = 'fail';
    parts.push(`${SIDE_NAME[side]} ${m(dist)} m${need != null ? ` (required ${m(need)} m${ok ? '' : ' — TOO CLOSE'})` : ''}`);
  }
  if (!plan.walls.length) { /* no house drawn yet: nothing to measure */ } else if (!site.setbacks) out.push(finding('setbacks', 'info', 'house', 'Not checked: setbacks (none are known for this lot)',
    `No setbacks are recorded for this lot, so the distances cannot be checked. Shortest distance from the house walls to each property line: ${parts.join(', ')}.`));
  else out.push(finding('setbacks', worst, 'house', worst === 'pass' ? 'House setbacks respected on all four sides' : 'House is closer to the property line than the setback',
    `Shortest distance from the house walls to each property line: ${parts.join(', ')}.` + (site.street ? ` The street is on the ${SIDE_NAME[site.street.side] || site.street.side} side.` : '')));

  // building line
  if (site.buildingLine) {
    const over = Math.max(0, ...wallOutlines.map((p) => overshoot(p, site.buildingLine)));
    out.push(finding('building-line', over <= 1 ? 'pass' : 'fail', 'house', over <= 1 ? 'House is inside the building line' : `House crosses the building line by ${Math.round(over)} cm`,
      over <= 1 ? 'Every wall of the house lies inside the building line drawn on the site plan.' : `Part of the house lies ${Math.round(over)} cm beyond the building line — this is not permitted without a formal relaxation (הקלה).`));
    for (const a of plan.outdoorAreas || []) {
      const o = overshoot(a.polygon, site.buildingLine);
      if (o <= 1) continue;
      const inLot = polyInside(a.polygon, site.boundary, 2);
      out.push(finding('building-line', inLot ? 'info' : 'fail', a.id, `${a.name} extends ${m(o)} m beyond the building line`,
        `The ${a.name.toLowerCase()} reaches ${m(o)} m past the building line${inLot ? ' but stays inside the lot' : ' and OUTSIDE the lot'}. Uncovered paving, steps, a fence up to 1.5 m and service installations up to 1.5 m high (bins, gas, AC units) are normally allowed in the setback; `
        + 'a roof, a wall higher than 1.5 m or a closed room there is not. Keep it open and low, or confirm with the architect how it was approved.', { spaceId: a.id, at: spot(a) }));
    }
    if (site.setbacks) {
      const off = [];
      for (const side of ['w', 'n', 'e', 's']) {
        const e = boundaryEdge(site.boundary, side), bl = boundaryEdge(site.buildingLine, side);
        if (!e || !bl || site.setbacks[side] == null) continue;
        const d = Math.min(segDist(bl.a[0], bl.a[1], e.a[0], e.a[1], e.b[0], e.b[1]), segDist(bl.b[0], bl.b[1], e.a[0], e.a[1], e.b[0], e.b[1]));
        if (Math.abs(d - site.setbacks[side]) > 15) off.push(`${SIDE_NAME[side]}: drawn ${m(d)} m vs written ${m(site.setbacks[side])} m`);
      }
      out.push(finding('plan-consistency', off.length ? 'info' : 'pass', 'building-line', off.length ? 'Building line differs from the written setbacks' : 'Building line matches the written setbacks',
        off.length ? off.join('; ') + '.' : 'The digitised building line is within 15 cm of the setbacks written on the site plan on all four sides.'));
    }
  }

  // parking
  const bays = site.parking || [];
  const okCount = bays.length >= 2;
  if (!bays.length) out.push(finding('parking-count', 'info', 'count', 'Not checked: parking (no parking places are drawn)', 'The site plan of this project has no parking places, so the number and size of the bays cannot be checked. A detached house needs at least 2.'));
  else out.push(finding('parking-count', okCount ? 'pass' : 'fail', 'count', `${bays.length} parking place${bays.length === 1 ? '' : 's'} on the lot`,
    `The site plan shows ${bays.length} parking place${bays.length === 1 ? '' : 's'}; a detached house needs at least 2 (in a settlement without a mass-transit system).`,
    bays[0] ? { at: { x: bays[0].x + bays[0].w / 2, y: bays[0].y + bays[0].h / 2 } } : undefined));
  for (const p of bays) {
    const long = Math.max(p.w, p.h), short = Math.min(p.w, p.h);
    const okSize = long >= 499 && short >= 249;
    const inside = polyInside(rectPoly(p), site.boundary, 5);
    const beyond = site.buildingLine ? overshoot(rectPoly(p), site.buildingLine) > 1 : false;
    out.push(finding('parking-size', okSize && inside ? 'pass' : 'fail', p.id, `${p.name || p.id}: ${m(short)} × ${m(long)} m`,
      `${p.name || p.id} is ${m(short)} × ${m(long)} m — ${okSize ? 'the standard' : 'smaller than the standard'} 2.50 × 5.00 m bay — and lies ${inside ? 'inside' : 'partly OUTSIDE'} the lot`
      + (beyond ? '. It is in the setback, where open paved parking is permitted (a carport roof there would need a permit).' : '.'), { at: { x: p.x + p.w / 2, y: p.y + p.h / 2 } }));
  }

  // energy / roof
  const roof = plan.meta && plan.meta.grossFloorArea;
  out.push(finding('energy-roof', 'info', 'roof', 'Roof: solar hot water and a 5 kVA photovoltaic system',
    `The dwelling must have a hot-water system (solar collectors with a tank, a heat pump or equivalent). ${roof ? `With a roof of about ${roof} m² (over 100 m²), a` : 'A'} new ground-attached house is also required to get a photovoltaic system of 5 kVA unless the local engineer exempts it — keep roof space free and check what the permit says.`));
}

function checkAssumptions(plan, out) {
  for (const a of plan.assumptions || []) {
    const done = a.status === 'confirmed';
    out.push(finding('assumption', done ? 'pass' : 'info', a.id, done ? `Confirmed: ${a.text.split(' — ')[0]}` : `To confirm: ${a.text.split(' (')[0].split(' — ')[0]}`, a.text));
  }
}

/**
 * All plan-only findings. `level` (several floors, stage F7 — see levels.js): { id, outlines } — the plan is that level's
 * view; an upper level uses its own ceiling height and leaves the site, the assumptions and the dwelling-wide rules
 * (largest room, one 70 cm toilet door) to the caller; the ground level checks the site against `outlines`.
 */
export function checkBuilding({ plan, store, catalog, level }) {
  const out = [];
  const upper = !!level && level.id !== 'L0';
  const H = upper ? num(plan.heights && plan.heights.ceiling, 300) : num(store && store.project && store.project.ceilingHeight, num(plan.heights && plan.heights.ceiling, 300));
  const metrics = planMetrics(plan);
  checkRooms(plan, H, out, metrics, !!level);
  checkLight(plan, out, metrics);
  checkDoors(plan, out, !!level);
  checkMamad(plan, H, store, catalog, out, metrics);
  if (!upper) checkSite(plan, out, level && level.outlines);
  if (!upper) checkAssumptions(plan, out);
  return out;
}
