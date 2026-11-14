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
  return inWallOrOpening(x, y, plan);
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

// ───────────────────────── wall / opening geometry (the seams for non-orthogonal walls) ─────────────────────────
// Every consumer of wall or opening GEOMETRY goes through the helpers below instead of reading `o.axis`, `o.x / o.w`
// or a wall rectangle directly, so a later kind of wall (a slant, see docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md) is added
// here only. Rect walls and 'h' / 'v' openings give exactly the numbers the consumers computed before.

/**
 * Per-axis description of an opening in a straight wall. `frame` gives the opening's local frame (see openingFrame);
 * `faces` names the two wall faces (−normal side, +normal side) and `jambs` the two jambs (start, end) in the letters
 * the plan uses for `swing` / `outside` and `hinge`.
 */
const OPENING_AXES = {
  // wall runs east–west: gap along +x, thickness along y; the +normal face is the south one
  h: { frame: (o) => ({ cx: o.x + o.w / 2, cy: o.y + o.h / 2, ux: 1, uy: 0, nx: 0, ny: 1, L: o.w, T: o.h, angle: 0, x0: o.x, y0: o.y }), faces: ['n', 's'], jambs: ['w', 'e'] },
  // wall runs north–south: gap along +y, thickness along x; the +normal face is the east one
  v: { frame: (o) => ({ cx: o.x + o.w / 2, cy: o.y + o.h / 2, ux: 0, uy: 1, nx: 1, ny: 0, L: o.h, T: o.w, angle: 90, x0: o.x, y0: o.y }), faces: ['w', 'e'], jambs: ['n', 's'] },
  // 'a' (an opening in a slant, later stage): frame from the slant's centre line and `o.at` (needs `plan`),
  // faces ['l', 'r'] relative to x1 → x2, jambs ['a', 'b'].
};
/** Anything but 'h' is treated as 'v', as the consumers always did. */
const axisOf = (o) => OPENING_AXES[o.axis] || OPENING_AXES.v;

/**
 * Local frame of an opening (plan cm):
 *   cx, cy  centre of the gap;   ux, uy  unit vector along the wall (from the start jamb to the end jamb);
 *   nx, ny  unit normal across the wall (towards the second of the two faces);   L  gap length along the wall;
 *   T  wall thickness;   angle  direction of (ux, uy) in degrees;   x0, y0  the corner at u = 0, v = 0 (start jamb, −normal face).
 * Local (u, v) → plan: openingPoint(F, u, v). `plan` is not needed for 'h' / 'v' openings.
 */
export function openingFrame(o, plan = PLAN) { return axisOf(o).frame(o, plan); }

/** Local (u along the wall from the start jamb, v across from the −normal face) → plan [x, y]. */
export const openingPoint = (F, u, v) => [F.x0 + F.ux * u + F.nx * v, F.y0 + F.uy * u + F.ny * v];

/**
 * Axis-aligned bounding box { x, y, w, h } of the local box u0 … u0 + du (along), v0 … v0 + dv (across; dv ≥ 0, du ≥ 0)
 * of an opening frame — exact for 'h' / 'v' openings (e.g. the approach zone in front of a face).
 */
export function openingBox(F, u0, du, v0, dv) {
  return {
    x: F.x0 + Math.min(F.ux * u0, F.ux * (u0 + du)) + Math.min(F.nx * v0, F.nx * (v0 + dv)),
    y: F.y0 + Math.min(F.uy * u0, F.uy * (u0 + du)) + Math.min(F.ny * v0, F.ny * (v0 + dv)),
    w: Math.abs(F.ux) * du + Math.abs(F.nx) * dv,
    h: Math.abs(F.uy) * du + Math.abs(F.ny) * dv,
  };
}

/** -1 when `side` (a `swing` / `outside` letter) names the opening's −normal face, else +1. */
export const openingFaceSign = (o, side) => (side === axisOf(o).faces[0] ? -1 : 1);
/** The side letter of the −normal (sign < 0) or +normal face. */
export const openingFaceName = (o, sign) => axisOf(o).faces[sign < 0 ? 0 : 1];
/** -1 when `hinge` names the start jamb (u = 0), else +1 (the end jamb, u = L). */
export const openingJambSign = (o, hinge) => (hinge === axisOf(o).jambs[0] ? -1 : 1);

/**
 * A hinged leaf in an opening: the hinge point (on the hinge jamb, on the face the leaf swings to), the unit direction
 * the leaf points when open (`open`, away from the wall) and when closed (`closed`, along the wall across the gap).
 */
export function openingHinge(o, hinge = o.hinge, swing = o.swing) {
  const F = openingFrame(o), js = openingJambSign(o, hinge), fs = openingFaceSign(o, swing);
  const [x, y] = openingPoint(F, js < 0 ? 0 : F.L, fs < 0 ? 0 : F.T);
  return { x, y, open: [fs * F.nx + 0, fs * F.ny + 0], closed: [-js * F.ux + 0, -js * F.uy + 0] };
}

/** Footprint polygon of an opening's gap (corners as rectPoly). */
export const openingPoly = (o) => rectPoly(o);

let _wallPolys = new WeakMap();
/** One polygon ([[x, y], …], carrying the wall's `id`) per wall, same order as `plan.walls`. Cached per walls array. */
export function wallPolys(plan = PLAN) {
  let polys = _wallPolys.get(plan.walls);
  if (!polys) {
    polys = plan.walls.map((w) => { const p = rectPoly(w); p.id = w.id; return p; });
    _wallPolys.set(plan.walls, polys);
  }
  return polys;
}

/**
 * Extent of an axis-aligned rect { x, y, w, h } along the unit direction (dx, dy): [lo, len] — the rect covers
 * lo … lo + len of that axis. Exact for axis directions (for those, lo + len is the rect's own x + w / y + h).
 */
export function rectExtent(r, dx, dy) {
  return [r.x * dx + r.y * dy + Math.min(0, dx * r.w) + Math.min(0, dy * r.h), Math.abs(dx) * r.w + Math.abs(dy) * r.h];
}

/** Is the point inside (or on the edge of) a solid wall? */
export const inWall = (x, y, plan = PLAN) => plan.walls.some((w) => pointInRect(x, y, w));
/** Is the point inside (or on the edge of) a solid wall or an opening's gap? */
export const inWallOrOpening = (x, y, plan = PLAN) => inWall(x, y, plan) || plan.openings.some((o) => pointInRect(x, y, o));

/**
 * Unit normal of the edge (x1, y1) → (x2, y2) in a fixed orientation: the one with nx + ny > 0 (nx > 0 on a tie), so
 * (0, 1) for any horizontal edge and (1, 0) for any vertical one (also for a zero-length edge). Never returns -0.
 */
export function edgeNormal(x1, y1, x2, y2) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (!len) return [1, 0];
  let nx = (y2 - y1) / len, ny = (x1 - x2) / len;
  if (nx + ny < 0 || (nx + ny === 0 && nx < 0)) { nx = -nx; ny = -ny; }
  return [nx + 0, ny + 0];
}

/** Walls (and optionally closed openings) that an item footprint intersects. */
export function wallsHitByItem(it, plan = PLAN) {
  const poly = itemCorners(it);
  const bb = polygonBounds(poly), polys = wallPolys(plan);
  return plan.walls.filter((w, i) => rectsOverlap(bb, w) && convexOverlap(poly, polys[i]));   // w.x/y/w/h = bounding box (culling)
}

/** Do two items' footprints overlap? (ignores elevation — callers decide whether that matters) */
export function itemsOverlap(a, b) {
  return convexOverlap(itemCorners(a), itemCorners(b));
}

/**
 * Wall faces usable for snapping: every straight edge of a solid wall that faces open space.
 * Returned as { x1, y1, x2, y2, nx, ny } where (nx, ny) is the unit normal pointing AWAY from the wall
 * (into the room / garden). Cached per plan parts (walls, openings, outline arrays): plan-edit.js replaces them on
 * every change. Callers must not modify the result.
 */
let _faces = new WeakMap();
/** Drop everything cached from PLAN. Called by core/plan-edit.js whenever walls / openings / rooms change. */
export function invalidatePlanCaches() { _faces = new WeakMap(); _wallPolys = new WeakMap(); }
export function wallFaces(plan = PLAN) {
  const hit = _faces.get(plan.walls);
  if (hit && hit.openings === plan.openings && hit.outline === plan.wallOutline) return hit.faces;
  const faces = [];
  for (const [x1, y1, x2, y2] of plan.wallOutline) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, [nx, ny] = edgeNormal(x1, y1, x2, y2);
    // which side is wall?
    const back = inWallOrOpening(mx - nx, my - ny, plan), front = inWallOrOpening(mx + nx, my + ny, plan);
    if (back && !front) faces.push({ x1, y1, x2, y2, nx, ny });
    else if (front && !back) faces.push({ x1, y1, x2, y2, nx: -nx + 0, ny: -ny + 0 });
  }
  _faces.set(plan.walls, { openings: plan.openings, outline: plan.wallOutline, faces });
  return faces;
}

/**
 * Blocking rectangles for walk-mode collision: all solid walls + windows (you cannot walk through a window).
 * Doors and the sliding terrace door are passable. Axis-aligned bounding boxes; see walkBoxes() for the exact shapes.
 */
export function walkBlockers(plan = PLAN) {
  return [...plan.walls, ...plan.openings.filter((o) => o.kind === 'window')].map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
}

/**
 * The same blockers as oriented boxes (cm): { cx, cy, hw, hh, cos, sin } — centre, half extents along the box's own
 * axes and the rotation of its first axis. Rect walls and 'h' / 'v' openings are unrotated (cos 1, sin 0).
 */
export function walkBoxes(plan = PLAN) {
  return walkBlockers(plan).map((r) => ({ cx: r.x + r.w / 2, cy: r.y + r.h / 2, hw: r.w / 2, hh: r.h / 2, cos: 1, sin: 0 }));
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
