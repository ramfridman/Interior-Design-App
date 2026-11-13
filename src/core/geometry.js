/**
 * Shared 2D geometry helpers (plan space: cm, +x east, +y south). Pure functions, no DOM, no THREE.
 */
import { PLAN } from './plan.js';

export const DEG = Math.PI / 180;

export function polygonArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** Area in m² of a polygon given in cm. */
export const areaM2 = (poly) => polygonArea(poly) / 1e4;

export function polygonBounds(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const pointInRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
export const rectsOverlap = (a, b, eps = 0) =>
  a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;

/** The room / outdoor area / 'garden' / null (off the lot) containing a plan point. */
export function spaceAt(x, y, plan = PLAN) {
  for (const r of plan.rooms) if (pointInPolygon(x, y, r.polygon)) return { kind: 'room', ...r };
  for (const o of plan.outdoorAreas) if (pointInPolygon(x, y, o.polygon)) return { kind: 'outdoor-area', ...o };
  for (const p of plan.site.parking) if (pointInRect(x, y, p)) return { kind: 'parking', ...p };
  if (pointInPolygon(x, y, plan.site.boundary)) return { kind: 'garden', id: 'garden', name: 'Garden' };
  return null;
}

/** True if the point is inside the house envelope (a room or inside a wall/opening). */
export function isIndoors(x, y, plan = PLAN) {
  if (plan.rooms.some((r) => pointInPolygon(x, y, r.polygon))) return true;
  return plan.walls.some((w) => pointInRect(x, y, w)) || plan.openings.some((o) => pointInRect(x, y, o));
}

/**
 * Corners of an item's footprint in plan space.
 * Item convention: (x, y) = centre, w = width (local x), d = depth (local y), rot = degrees clockwise
 * as seen on the plan. Local +y is the item's FRONT; local -y is its BACK (the side that goes to a wall).
 * At rot = 0 the front faces south (+y).
 */
export function itemCorners(it) {
  const c = Math.cos((it.rot || 0) * DEG), s = Math.sin((it.rot || 0) * DEG);
  const hw = it.w / 2, hd = it.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, ly]) => [it.x + lx * c - ly * s, it.y + lx * s + ly * c]);
}

/** Axis-aligned bounding box of an item's (rotated) footprint. */
export const itemAABB = (it) => polygonBounds(itemCorners(it));

/** Local (item) → plan coordinates. */
export function itemLocalToPlan(it, lx, ly) {
  const c = Math.cos((it.rot || 0) * DEG), s = Math.sin((it.rot || 0) * DEG);
  return [it.x + lx * c - ly * s, it.y + lx * s + ly * c];
}

/** Plan → local (item) coordinates. */
export function planToItemLocal(it, px, py) {
  const c = Math.cos((it.rot || 0) * DEG), s = Math.sin((it.rot || 0) * DEG);
  const dx = px - it.x, dy = py - it.y;
  return [dx * c + dy * s, -dx * s + dy * c];
}

function projectPolygon(poly, ax, ay) {
  let mn = Infinity, mx = -Infinity;
  for (const [x, y] of poly) { const p = x * ax + y * ay; mn = Math.min(mn, p); mx = Math.max(mx, p); }
  return [mn, mx];
}

/** Separating-axis test for two convex polygons. `eps` (cm) lets touching shapes count as non-overlapping. */
export function convexOverlap(a, b, eps = 0.5) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y2 - y1, ny = x1 - x2;
      const len = Math.hypot(nx, ny) || 1;
      const [a0, a1] = projectPolygon(a, nx / len, ny / len);
      const [b0, b1] = projectPolygon(b, nx / len, ny / len);
      if (a1 <= b0 + eps || b1 <= a0 + eps) return false;
    }
  }
  return true;
}

const rectPoly = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];

/** Walls (and optionally closed openings) that an item footprint intersects. */
export function wallsHitByItem(it, plan = PLAN) {
  const poly = itemCorners(it);
  const bb = polygonBounds(poly);
  return plan.walls.filter((w) => rectsOverlap(bb, w) && convexOverlap(poly, rectPoly(w)));
}

/** Do two items' footprints overlap? (ignores elevation — callers decide whether that matters) */
export function itemsOverlap(a, b) {
  return convexOverlap(itemCorners(a), itemCorners(b));
}

/**
 * Wall faces usable for snapping: every straight edge of a solid wall that faces open space.
 * Returned as { x1, y1, x2, y2, nx, ny } where (nx, ny) is the unit normal pointing AWAY from the wall
 * (into the room / garden). Computed once and cached.
 */
let _faces = null;
/** Drop everything cached from PLAN. Called by core/plan-edit.js whenever walls / openings / rooms change. */
export function invalidatePlanCaches() { _faces = null; }
export function wallFaces(plan = PLAN) {
  if (_faces && plan === PLAN) return _faces;
  const solid = (x, y) => plan.walls.some((w) => pointInRect(x, y, w)) || plan.openings.some((o) => pointInRect(x, y, o));
  const faces = [];
  for (const [x1, y1, x2, y2] of plan.wallOutline) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    if (x1 === x2) {
      // vertical edge: which side is wall?
      const left = solid(mx - 1, my), right = solid(mx + 1, my);
      if (left && !right) faces.push({ x1, y1, x2, y2, nx: 1, ny: 0 });
      else if (right && !left) faces.push({ x1, y1, x2, y2, nx: -1, ny: 0 });
    } else {
      const up = solid(mx, my - 1), down = solid(mx, my + 1);
      if (up && !down) faces.push({ x1, y1, x2, y2, nx: 0, ny: 1 });
      else if (down && !up) faces.push({ x1, y1, x2, y2, nx: 0, ny: -1 });
    }
  }
  if (plan === PLAN) _faces = faces;
  return faces;
}

/**
 * Blocking rectangles for walk-mode collision: all solid walls + windows (you cannot walk through a window).
 * Doors and the sliding terrace door are passable.
 */
export function walkBlockers(plan = PLAN) {
  return [...plan.walls, ...plan.openings.filter((o) => o.kind === 'window')].map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const snapTo = (v, step) => Math.round(v / step) * step;
export const normDeg = (d) => ((d % 360) + 360) % 360;

/** Format a length given in cm, e.g. 315 → "3.15 m" or "315 cm". */
export function fmtLen(cm, units = 'm') {
  return units === 'cm' ? `${Math.round(cm)} cm` : `${(cm / 100).toFixed(2)} m`;
}

/** Format ILS price: 12345 → "₪12,345". */
export function fmtPrice(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return '₪' + Math.round(n).toLocaleString('en-US');
}
