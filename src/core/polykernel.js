/**
 * POLYGON KERNEL (stage A0 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md) — robust boolean operations, offsetting and
 * "rooms from walls" faces on arbitrary polygons, as a thin wrapper around the vendored Clipper 6.4.2
 * (vendor/clipper/, Boost licence). Pure functions, no global state, deterministic output order.
 * Not imported by the app yet (A1 wires it into the mixed derive); see CONTRACT "Polygon kernel and slant geometry".
 *
 * UNITS AND PRECISION
 *   Inputs and outputs are plan centimetres (floats). Internally every coordinate is rounded to integer units of
 *   0.01 mm (SCALE = 1000 units per cm), so output vertices are multiples of 0.001 cm and inputs on whole (or 0.1 / 0.01)
 *   centimetres come back exactly. Clipper's exact integer fast path holds while |coordinate| <= 47 453 cm (MAX_EXACT,
 *   ~474 m from the origin); beyond that Clipper switches to its slower 128-bit path, still exact.
 *   The rounding of an intersection vertex moves it by at most 0.0005 cm, so an area changes by at most
 *   ~0.0005 * (edge length) cm^2 per such vertex (< 0.5 cm^2 for a 10 m edge).
 *
 * SHAPES (input)
 *   ring        [[x, y], ...]                       a simple polygon, any orientation, open (last != first) or closed
 *   rect        { x, y, w, h }                      e.g. a wall rect or a rect opening
 *   { poly }    a ring under `poly` (a slant), or { polygon } (a room)
 *   expolygon   { outer: ring, holes: [ring, ...] } as returned by every operation below
 *   A "shapes" argument is one shape or an array of shapes. Every ring / rect / poly is a SOLID (its orientation is
 *   ignored); holes exist only inside an expolygon. Overlapping solids are fine (they are unioned).
 *
 * RESULTS (output): an array of expolygons { outer, holes }:
 *   outer  clockwise on screen (y down) = positive shoelace sum Σ(x1·y2 − x2·y1), starting at the vertex with the
 *          smallest y, then smallest x — exactly like the plan engine's room polygons (plan-edit.js traceLoops);
 *   holes  counter-clockwise on screen, each starting at its smallest x, then smallest y, sorted by that vertex (x, y);
 *   list   sorted by the start vertex of `outer` (y, then x), then by larger area first.
 *   No duplicate or collinear vertices; outputs are strictly simple (no self-touching rings; a region pinched at a
 *   single point is two expolygons, like the engine's 4-connected room cells).
 */
import ClipperLib from '../../vendor/clipper/clipper.js';

export const SCALE = 1000;                                   // integer units per cm (0.01 mm)
export const MAX_EXACT = Math.floor(ClipperLib.ClipperBase.loRange / SCALE);   // cm

const { Clipper, ClipperOffset, PolyTree, ClipType, PolyType, PolyFillType, JoinType, EndType } = ClipperLib;
const NONZERO = PolyFillType.pftNonZero;
const JOINS = { miter: JoinType.jtMiter, mitre: JoinType.jtMiter, square: JoinType.jtSquare, round: JoinType.jtRound };

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const toInt = (v) => Math.round(v * SCALE);
const isPoint = (p) => Array.isArray(p) && num(p[0]) && num(p[1]);
const isRing = (a) => Array.isArray(a) && a.length > 0 && isPoint(a[0]);

/** Signed area of a ring (cm²): positive = clockwise on screen (the engine's outer-ring orientation). */
export function area(poly) {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

/** Net area (cm²) of shapes: every solid counts positive, every expolygon hole negative (exact for operation results). */
export function netArea(shapes) {
  let s = 0;
  for (const sh of list(shapes)) {
    if (sh && sh.outer) { s += Math.abs(area(sh.outer)); for (const h of sh.holes || []) s -= Math.abs(area(h)); } else s += Math.abs(area(ringOf(sh)));
  }
  return s;
}

/** Axis-aligned bounds { x, y, w, h } of shapes (null when empty). */
export function bounds(shapes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sh of list(shapes)) for (const [x, y] of sh && sh.outer ? sh.outer : ringOf(sh)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Every ring of a result (outers and holes) as a flat list. */
export const rings = (expolys) => expolys.flatMap((e) => [e.outer, ...e.holes]);

/** The ring of a rect { x, y, w, h }, clockwise on screen from its top-left corner. */
export const rectRing = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];

// ---------------------------------------------------------------- input → Clipper paths
function list(shapes) {
  if (shapes == null) return [];
  if (isRing(shapes) || !Array.isArray(shapes)) return [shapes];
  return shapes;
}
function ringOf(sh) {
  if (isRing(sh)) return sh;
  if (sh && isRing(sh.poly)) return sh.poly;
  if (sh && isRing(sh.polygon)) return sh.polygon;
  if (sh && num(sh.x) && num(sh.y) && num(sh.w) && num(sh.h)) return rectRing(sh);
  if (Array.isArray(sh) && sh.length === 0) return [];
  throw new TypeError('polykernel: not a polygon, rect or expolygon');
}
function toPath(ring, positive) {
  const out = [];
  for (const p of ring) {
    if (!isPoint(p)) throw new TypeError('polykernel: bad point ' + JSON.stringify(p));
    const X = toInt(p[0]), Y = toInt(p[1]), q = out[out.length - 1];
    if (!q || q.X !== X || q.Y !== Y) out.push({ X, Y });
  }
  while (out.length > 1 && out[0].X === out[out.length - 1].X && out[0].Y === out[out.length - 1].Y) out.pop();
  if (out.length < 3) return null;
  if ((Clipper.Area(out) > 0) !== positive) out.reverse();
  return Clipper.Area(out) === 0 ? null : out;
}
/** Clipper paths of shapes: solids and outers positive, expolygon holes negative (fill rule non-zero). */
function paths(shapes) {
  const out = [];
  for (const sh of list(shapes)) {
    if (sh && sh.outer) {
      const o = toPath(sh.outer, true);
      if (!o) continue;
      out.push(o);
      for (const h of sh.holes || []) { const p = toPath(h, false); if (p) out.push(p); }
    } else { const p = toPath(ringOf(sh), true); if (p) out.push(p); }
  }
  return out;
}

// ---------------------------------------------------------------- Clipper output → normalised expolygons
/**
 * Clipper ring → cm ring without duplicate or collinear vertices — including zero-width spikes, which Clipper 6 can
 * leave where input polygons share an edge (exact integer arithmetic: |coordinates| <= MAX_EXACT).
 */
function fromPath(path) {
  const pts = [];
  for (const p of path) { const q = pts[pts.length - 1]; if (!q || q.X !== p.X || q.Y !== p.Y) pts.push(p); }
  while (pts.length > 1 && pts[0].X === pts[pts.length - 1].X && pts[0].Y === pts[pts.length - 1].Y) pts.pop();
  for (let changed = true; changed && pts.length >= 3;) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length >= 3; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], p = pts[i], b = pts[(i + 1) % pts.length];
      if ((p.X - a.X) * (b.Y - p.Y) - (p.Y - a.Y) * (b.X - p.X) === 0 || (a.X === b.X && a.Y === b.Y)) { pts.splice(i, 1); i--; changed = true; }
    }
  }
  return pts.length >= 3 ? pts.map((p) => [p.X / SCALE, p.Y / SCALE]) : null;
}
function fromTree(tree) {
  const out = [];
  const visit = (outerNode) => {
    const holes = [];
    for (const h of outerNode.Childs()) { const r = fromPath(h.Contour()); if (r) holes.push(normalise(r, { hole: true })); for (const o of h.Childs()) visit(o); }
    holes.sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1]);
    const outer = fromPath(outerNode.Contour());
    if (outer) out.push({ outer: normalise(outer), holes });
  };
  for (const n of tree.Childs()) visit(n);
  return sortExpolys(out);
}
function sortExpolys(list) {
  const keyed = list.map((e) => ({ e, a: area(e.outer) }));
  keyed.sort((p, q) => p.e.outer[0][1] - q.e.outer[0][1] || p.e.outer[0][0] - q.e.outer[0][0] || q.a - p.a);
  return keyed.map((k) => k.e);
}

/**
 * One boolean operation, in two Clipper passes: the operation itself, then a strictly-simple union of its output into
 * a PolyTree. Clipper 6 does not always merge input polygons that share an edge in one pass (it can return a ring
 * that runs both ways along the shared edge, which would join two rooms through a zero-width channel); re-reading its
 * own output resolves those edges, and the strictly-simple pass splits rings that touch at a point.
 */
function execute(type, subject, clip) {
  const c = new Clipper();
  if (subject.length) c.AddPaths(subject, PolyType.ptSubject, true);
  if (clip && clip.length) c.AddPaths(clip, PolyType.ptClip, true);
  const first = [];
  c.Execute(type, first, NONZERO, NONZERO);
  const c2 = new Clipper();
  c2.StrictlySimple = true;
  if (first.length) c2.AddPaths(first, PolyType.ptSubject, true);
  const tree = new PolyTree();
  c2.Execute(ClipType.ctUnion, tree, NONZERO, NONZERO);
  return tree;
}

// ---------------------------------------------------------------- boolean operations
/** Union of all shapes → expolygons. */
export const union = (shapes) => fromTree(execute(ClipType.ctUnion, paths(shapes)));
/** a − b → expolygons. */
export const difference = (a, b) => fromTree(execute(ClipType.ctDifference, paths(a), paths(b)));
/** a ∩ b → expolygons. */
export const intersection = (a, b) => fromTree(execute(ClipType.ctIntersection, paths(a), paths(b)));
/** Area (cm²) of a ∩ b. */
export const intersectArea = (a, b) => netArea(intersection(a, b));

/**
 * Offset (grow when delta > 0, shrink when delta < 0) the union of shapes by `delta` cm → expolygons.
 * join: 'miter' (default; corners further than miterLimit·|delta| are squared off) | 'square' | 'round'
 * (arcTolerance = max deviation of the arcs, cm). Shrinking can split a shape or make it vanish ([]), which is how
 * "too narrow" is detected (an inward offset by w/2 that is empty means no w-wide passage).
 */
export function offset(shapes, delta, { join = 'miter', miterLimit = 2, arcTolerance = 0.25 } = {}) {
  if (!num(delta)) throw new TypeError('polykernel.offset: delta must be a number');
  const jt = JOINS[join];
  if (jt == null) throw new TypeError('polykernel.offset: join must be miter | square | round');
  const clean = paths(union(shapes));
  if (!clean.length) return [];
  if (delta === 0) return fromTree(execute(ClipType.ctUnion, clean));
  const co = new ClipperOffset(miterLimit, arcTolerance * SCALE);
  co.AddPaths(clean, jt, EndType.etClosedPolygon);
  const tree = new PolyTree();
  co.Execute(tree, delta * SCALE);
  // one more strictly-simple union so the output conventions match every other operation
  return fromTree(execute(ClipType.ctUnion, paths(fromTree(tree))));
}

/**
 * Where is (x, y) relative to shapes? 1 inside, 0 outside, -1 on a boundary (within the 0.01 mm grid).
 * Note -1 is truthy: used as a boolean, "on the boundary" counts as inside.
 */
export function pointInPolys(x, y, shapes) {
  const pt = { X: toInt(x), Y: toInt(y) };
  let best = 0;
  for (const sh of list(shapes)) {
    const outer = toPath(sh && sh.outer ? sh.outer : ringOf(sh), true);
    if (!outer) continue;
    const o = Clipper.PointInPolygon(pt, outer);
    if (o === 0) continue;
    if (o === -1) { best = -1; continue; }
    let r = 1;
    for (const h of (sh && sh.holes) || []) {
      const hp = toPath(h, true);
      if (!hp) continue;
      const k = Clipper.PointInPolygon(pt, hp);
      if (k === 1) { r = 0; break; }
      if (k === -1) r = -1;
    }
    if (r === 1) return 1;
    if (r === -1) best = -1;
  }
  return best;
}

/**
 * Faces of the complement of `solids` inside `bbox` ({ x, y, w, h }; default: the solids' bounds grown by 100 cm,
 * like the engine's grid frame). The faces that touch the bbox frame are outdoors; every other (bounded) face is a
 * room. Semantics are those of the grid engine: openings passed as solids separate rooms; an enclosed courtyard is a
 * room; two regions that meet at a single point are two faces.
 * @returns {{ outdoor: Array<{outer, holes}>, rooms: Array<{outer, holes, area}> }}  (area = net cm²)
 */
export function faces(solids, bbox) {
  const sol = paths(solids);
  let b = bbox;
  if (!b) {
    const bb = bounds(solids);
    b = bb ? { x: bb.x - 100, y: bb.y - 100, w: bb.w + 200, h: bb.h + 200 } : { x: 0, y: 0, w: 0, h: 0 };
  }
  const frame = toPath(rectRing(b), true);
  if (!frame) return { outdoor: [], rooms: [] };
  const fx0 = toInt(b.x), fy0 = toInt(b.y), fx1 = toInt(b.x + b.w), fy1 = toInt(b.y + b.h);
  const tree = execute(ClipType.ctDifference, [frame], sol);
  const outdoor = [], rooms = [];
  const touches = (node) => node.Contour().some((p) => p.X === fx0 || p.X === fx1 || p.Y === fy0 || p.Y === fy1);
  const visit = (outerNode) => {
    const holes = [];
    for (const h of outerNode.Childs()) { const r = fromPath(h.Contour()); if (r) holes.push(normalise(r, { hole: true })); for (const o of h.Childs()) visit(o); }
    holes.sort((p, q) => p[0][0] - q[0][0] || p[0][1] - q[0][1]);
    const outer = fromPath(outerNode.Contour());
    if (!outer) return;
    const e = { outer: normalise(outer), holes };
    if (touches(outerNode)) outdoor.push(e);
    else rooms.push(Object.assign(e, { area: netArea([e]) }));
  };
  for (const n of tree.Childs()) visit(n);
  return { outdoor: sortExpolys(outdoor), rooms: sortExpolys(rooms) };
}

// ---------------------------------------------------------------- engine conventions
/**
 * A ring in the engine's room-polygon form: consecutive duplicates and straight-through collinear vertices removed
 * (zero-width slit spikes are kept), clockwise on screen starting at min y then min x — or, with { hole: true },
 * counter-clockwise starting at min x then min y (how plan-edit.js orders a hole before slitting it in).
 * Returns a new array of new [x, y] points.
 */
export function normalise(poly, { hole = false } = {}) {
  let pts = [];
  for (const p of poly) { const q = pts[pts.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) pts.push([p[0], p[1]]); }
  while (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  for (let changed = true; changed && pts.length > 3;) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], p = pts[i], b = pts[(i + 1) % pts.length];
      const cross = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
      const dot = (p[0] - a[0]) * (b[0] - p[0]) + (p[1] - a[1]) * (b[1] - p[1]);
      if (cross === 0 && dot > 0) { pts.splice(i, 1); i--; changed = true; }
    }
  }
  if ((area(pts) > 0) === hole) pts.reverse();
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], q = pts[s];
    if (hole ? p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]) : p[1] < q[1] || (p[1] === q[1] && p[0] < q[0])) s = i;
  }
  return pts.slice(s).concat(pts.slice(0, s));
}

/**
 * Polygon with holes → the single ring with zero-width slits the app's rooms use (plan-edit.js roomPolygon): the
 * outer ring is normalised; holes are normalised as holes and taken by their first vertex (x, then y); each is joined
 * by a horizontal slit from its first vertex leftwards to the nearest upward edge of the ring built so far
 * ([P, ...hole, hole[0], P] inserted after that edge's start, or after its end vertex when the slit lands on it).
 * A hole with no edge to its left is left out (as the engine does). For rectilinear input the result is identical
 * to the engine's polygon.
 */
export function slitJoin(outer, holes = []) {
  const poly = normalise(outer);
  const hs = holes.map((h) => normalise(h, { hole: true })).sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1]);
  for (const hole of hs) {
    const [vx, vy] = hole[0];
    let k = -1, px = -Infinity;
    for (let q = 0; q < poly.length; q++) {
      const a = poly[q], b = poly[(q + 1) % poly.length];
      if (!(a[1] > b[1] && vy < a[1] && vy >= b[1])) continue;
      const x = b[1] === vy ? b[0] : a[0] + ((vy - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (x <= vx && x > px) { px = x; k = q; }
    }
    if (k < 0) continue;
    const at = (k + 1) % poly.length, onVertex = poly[at][1] === vy && poly[at][0] === px;
    if (onVertex) poly.splice(at + 1, 0, ...hole.map((p) => [p[0], p[1]]), [vx, vy], [px, vy]);
    else poly.splice(k + 1, 0, [px, vy], ...hole.map((p) => [p[0], p[1]]), [vx, vy], [px, vy]);
  }
  return poly;
}
