/**
 * Room finishes (floor + wall) — defaults per space type and helpers shared by 2D, 3D, and the budget.
 *
 * store.finishes[spaceId] = { floor?: productId, wall?: productId }
 * A finish product is a catalogue product of type 'floor-finish' or 'wall-finish' (priceUnit 'm2');
 * its `params` describe the look (see MODEL_TYPES in models/types.js).
 */
import { PLAN } from './plan.js';
import { areaM2 } from './geometry.js';

/** Built-in looks used when the user has not picked a product. */
export const DEFAULT_FLOOR = {
  living:   { pattern: 'tile', tileW: 120, tileH: 60, color: '#d9d4ca', color2: '#c9c3b8', gloss: 0.35 },
  bedroom:  { pattern: 'plank', tileW: 120, tileH: 19, color: '#c9a77c', color2: '#b08e63', gloss: 0.25 },
  mamad:    { pattern: 'plank', tileW: 120, tileH: 19, color: '#c9a77c', color2: '#b08e63', gloss: 0.25 },
  bathroom: { pattern: 'tile', tileW: 60, tileH: 60, color: '#bfc3c4', color2: '#a9adae', gloss: 0.2 },
  wc:       { pattern: 'tile', tileW: 60, tileH: 60, color: '#bfc3c4', color2: '#a9adae', gloss: 0.2 },
  service:  { pattern: 'tile', tileW: 60, tileH: 60, color: '#cfcfcb', color2: '#b9b9b4', gloss: 0.2 },
  terrace:  { pattern: 'tile', tileW: 60, tileH: 60, color: '#c8c2b6', color2: '#aaa497', gloss: 0.05 },
  porch:    { pattern: 'tile', tileW: 60, tileH: 60, color: '#c8c2b6', color2: '#aaa497', gloss: 0.05 },
  utility:  { pattern: 'concrete', tileW: 100, tileH: 100, color: '#b7b5b0', color2: '#a3a19c', gloss: 0.02 },
};
export const DEFAULT_WALL = {
  bathroom: { kind: 'tile', color: '#eceae6', color2: '#d5d2cc', tileW: 60, tileH: 120, pattern: 'grid', gloss: 0.4 },
  wc:       { kind: 'tile', color: '#eceae6', color2: '#d5d2cc', tileW: 60, tileH: 120, pattern: 'grid', gloss: 0.4 },
  default:  { kind: 'paint', color: null /* → project.wallColor */, gloss: 0.05 },
};

export const allSpaces = (plan = PLAN) => [...plan.rooms, ...plan.outdoorAreas];
/** A room or outdoor area by id. Room ids are unique across floors, so upper floors are searched too. */
export function getSpace(id, plan = PLAN) {
  const here = allSpaces(plan).find((s) => s.id === id);
  if (here) return here;
  for (const lv of plan.levels || []) {
    const r = (lv.rooms || []).find((s) => s.id === id) || (lv.outdoorAreas || []).find((s) => s.id === id);
    if (r) return r;
  }
  return null;
}

/**
 * Resolve the look of a space's floor or walls.
 * @returns {{ params: object, product: object|null }}
 */
export function resolveFinish(spaceId, kind /* 'floor' | 'wall' */, store, catalog) {
  const space = getSpace(spaceId);
  const chosen = store.finishes[spaceId] && store.finishes[spaceId][kind];
  const product = chosen && catalog ? catalog.getProduct(chosen) : null;
  if (product) return { params: { ...product.params }, product };
  if (kind === 'floor') return { params: { ...(DEFAULT_FLOOR[space?.type] || DEFAULT_FLOOR.living) }, product: null };
  const base = { ...(DEFAULT_WALL[space?.type] || DEFAULT_WALL.default) };
  if (!base.color) base.color = store.project.wallColor;
  return { params: base, product: null };
}

/** Floor area of a room (m²): its outline less the openings in its floor (`room.voids`, stage F4b — absent elsewhere). */
export const floorAreaM2 = (space) => areaM2(space.polygon) - (Array.isArray(space.voids) ? space.voids.reduce((t, v) => t + (v.area || 0), 0) / 1e4 : 0);

/** Net wall area of a room in m² (perimeter × ceiling height minus door/window openings touching the room). */
export function wallAreaM2(space, ceilingHeightCm, plan = PLAN) {
  const p = space.polygon;
  let perim = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; perim += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  let openings = 0;
  for (const o of plan.openings) if (o.rooms && o.rooms.includes(space.id)) openings += o.width * o.height;
  return Math.max(0, (perim * ceilingHeightCm - openings) / 1e4);
}

/** Cost of the chosen finishes for one space: { floor, wall, total } in ILS (0 where nothing is chosen). */
export function finishCost(spaceId, store, catalog) {
  const space = getSpace(spaceId); if (!space) return { floor: 0, wall: 0, total: 0 };
  const f = store.finishes[spaceId] || {};
  const fp = f.floor && catalog.getProduct(f.floor), wp = f.wall && catalog.getProduct(f.wall);
  const floor = fp ? fp.price * floorAreaM2(space) : 0;
  const wall = wp ? wp.price * wallAreaM2(space, store.project.ceilingHeight) : 0;
  return { floor, wall, total: floor + wall };
}
