/**
 * STAIRS — pure geometry of a stair between two levels (stage F4a of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md § 3
 * "Stairs (F4)"). No DOM, no THREE, no plan engine: the 2D symbol (F4b), the 3D model (view3d/stairs.js), the walk (F5)
 * and the regulation checks (regulations/stairs.js) all read the same numbers from here.
 *
 * DATA (stored on the stair's bottom level: `plan.stairs` for L0, `plan.levels[i].stairs` above)
 *   { id: 'st1', to: 'L1', shape: 'straight' | 'L' | 'U', x, y, rot, width: 100, risers: 18, going: 29,
 *     landing?: { at: 9, size: 100 }, turn?: 'left' | 'right', gap?: 0, nosing?: 3, guard?: false }
 *   x, y     centre of the stair's bounding rectangle in its own frame (cm, like an item's pose)
 *   rot      clockwise degrees, like items: rot 0 = the first flight goes UP TOWARDS THE NORTH (−y); 90 = east …
 *   risers   the NUMBER of risers from the lower finished floor to the upper one; the riser height is not stored:
 *            riser = rise / risers, rise = elevation(upper level) − elevation(lower level)
 *   going    tread depth, nosing to nosing (cm); every flight of a stair has the same going and riser
 *   width    clear width of every flight (cm)
 *   landing  `at` = risers below the landing (the landing is the top of riser `at`); `size` = its depth along the
 *            first flight (cm). Optional on a straight stair; L and U default to { at: ceil(risers / 2), size: width }
 *   turn     L / U: the side the second flight leaves to, seen walking up the first flight (default 'right')
 *   gap      U: the well between the two flights (cm, default 0)
 *   nosing   3D / rules only: tread overhang (cm, default 3)
 *   guard    false = no guard on the open sides (the rules then report it)
 * Ignored if present (derived, never trusted): `up`, `w`, `d`, `riser`, `footprint` (the test fixture writes them).
 *
 * FRAMES
 *   walk frame  u = across the first flight (+ = right when walking up), v = along it (+ = up the stair), origin at
 *               the middle of the first riser; heights h in cm above the lower finished floor.
 *   local       item-local coordinates (lx, ly) of the pose: lx = u − cu, ly = −(v − cv), (cu, cv) = centre of the
 *               stair's bounding box in the walk frame. So rot 0 maps "up the first flight" to −y (north) and
 *               "right" to +x (east), exactly like core/geometry.js itemLocalToPlan / itemCorners.
 *   plan        itemLocalToPlan(stair, lx, ly). The pose of the bounding box is { x, y, rot, w: size.w, d: size.d }.
 *
 * Every flight has m risers and m − 1 treads; its last riser lands on the landing / the upper floor. A straight stair
 * of n risers and going G has a run of (n − 1)·G (the Duplex: 17 × 29 = 493 cm).
 */
import { itemLocalToPlan, planToItemLocal, pointInPolygon } from './geometry.js';
import { union, difference, netArea } from './polykernel.js';

export const SHAPES = Object.freeze(['straight', 'L', 'U']);
export const DEFAULT_HEADROOM = 210;            // cm — PBR Second Schedule 3.2.2.4 (see regulations/stairs.js)
const EPS = 1e-6;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len2 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const rightOf = (d) => [d[1], -d[0]];           // walk frame: right of walking direction (u, v) = (v, −u)

/** Shape, turn side (+1 right / −1 left), landing and the other inputs with defaults; null when unusable. */
function inputs(stair) {
  if (!stair || typeof stair !== 'object') return null;
  const shape = stair.shape || 'straight';
  if (!SHAPES.includes(shape)) return null;
  const n = stair.risers, W = stair.width, G = stair.going;
  if (!(Number.isInteger(n) && n >= 2 && num(W) && W > 0 && num(G) && G > 0)) return null;
  const sigma = stair.turn === 'left' ? -1 : 1;
  let landing = null;
  if (stair.landing && typeof stair.landing === 'object') landing = { at: stair.landing.at, size: stair.landing.size };
  if (shape !== 'straight') landing = { at: num(landing && landing.at) ? landing.at : Math.ceil(n / 2), size: num(landing && landing.size) ? landing.size : W };
  if (landing && !(Number.isInteger(landing.at) && landing.at >= 1 && landing.at <= n - 1 && num(landing.size) && landing.size > 0)) return null;
  if (shape === 'L' && landing.size < W - EPS) return null;
  const gap = shape === 'U' && num(stair.gap) && stair.gap > 0 ? stair.gap : 0;
  return { shape, n, W, G, sigma, landing, gap };
}

/** Flights and landings in the walk frame (rise-independent except for the heights, given as riser indices). */
function walkLayout(I) {
  const { shape, n, W, G, sigma, landing, gap } = I;
  const flights = [], landings = [];
  const flight = (o, d, m, k0) => flights.push({ o, d, r: rightOf(d), m, k0, len: (m - 1) * G });
  const rect = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  if (!landing) { flight([0, 0], [0, 1], n, 0); return { flights, landings }; }
  const k = landing.at, S = landing.size, L0 = (k - 1) * G;
  flight([0, 0], [0, 1], k, 0);
  if (shape === 'straight') {
    landings.push({ ring: rect(-W / 2, W / 2, L0, L0 + S), k });
    flight([0, L0 + S], [0, 1], n - k, k);
  } else if (shape === 'L') {
    landings.push({ ring: rect(-W / 2, W / 2, L0, L0 + S), k });
    flight([sigma * W / 2, L0 + S - W / 2], [sigma, 0], n - k, k);
  } else {                                                              // U: half landing across both flights
    const far = sigma * (1.5 * W + gap);
    landings.push({ ring: rect(Math.min(-W / 2 * sigma, far), Math.max(-W / 2 * sigma, far), L0, L0 + S), k });
    flight([sigma * (W + gap), L0], [0, -1], n - k, k);
  }
  return { flights, landings };
}

/** Corners of a flight in the walk frame (start-left, start-right, end-right, end-left). */
const flightRing = (f, W) => {
  const hl = mul(f.r, W / 2), e = add(f.o, mul(f.d, f.len));
  return [add(f.o, mul(hl, -1)), add(f.o, hl), add(e, hl), add(e, mul(hl, -1))];
};

/**
 * Walking direction of the last flight (= the direction one steps off onto the upper floor), as a plan unit vector.
 * Rise-independent; `up` / other stored hints are ignored. The F3 void railing leaves open the void edge that faces it.
 * @returns {[number, number]} e.g. [0, −1] for a straight stair at rot 0 (north)
 */
export function stairArrivalDir(stair) {
  const I = inputs(stair);
  const d = I ? walkLayout(I).flights.at(-1).d : [0, 1];
  return dirToPlan(stair, d);
}
/** Walk-frame vector → plan vector (rotation only). */
function dirToPlan(stair, d) {
  const a = ((Number(stair && stair.rot) || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const lx = d[0], ly = -d[1];
  const v = [lx * c - ly * s, lx * s + ly * c];
  return [Math.abs(v[0]) < 1e-12 ? 0 : v[0], Math.abs(v[1]) < 1e-12 ? 0 : v[1]];
}

/**
 * Full geometry of a stair in plan coordinates.
 * @param {object} stair  the stair data (see the header)
 * @param {{ rise: number }} opts  floor-to-floor rise (cm) = elevation(upper) − elevation(lower)
 * @returns {null | {
 *   shape, rise, risers, riser, going, width, turn,
 *   flights: Array<{ index, risers, firstRiser, h0, h1, length, origin, dir, right, poly,
 *                    start: { a, b, h }, end: { a, b, h }, treads: Array<{ index, h, poly }> }>,
 *   landings: Array<{ index, at, h, size, poly }>,
 *   walkingLine: Array<[x, y, h]>, walkLength, run, footprint: [x, y][], start: edge, arrival: edge & { dir },
 *   size: { w, d }, treadCount }}  null when the stair cannot be built (see stairProblems)
 *   Tread `index` = the riser it stands on (1…n − 1, counted from the bottom); its height h = index × riser.
 */
export function stairGeometry(stair, { rise } = {}) {
  const I = inputs(stair);
  if (!I || !num(rise) || rise <= 0) return null;
  const { n, W, G } = I, R = rise / n;
  const lay = walkLayout(I);
  // bounding box in the walk frame → pose centre
  const pts = [...lay.flights.flatMap((f) => flightRing(f, W)), ...lay.landings.flatMap((l) => l.ring)];
  const us = pts.map((p) => p[0]), vs = pts.map((p) => p[1]);
  const box = { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
  const cu = (box.u0 + box.u1) / 2, cv = (box.v0 + box.v1) / 2;
  const P = (p) => itemLocalToPlan(stair, p[0] - cu, -(p[1] - cv));
  const D = (d) => dirToPlan(stair, d);
  const r6 = (p) => p.map((v) => Math.round(v * 1e6) / 1e6);
  const PP = (p) => r6(P(p));

  const flights = lay.flights.map((f, i) => {
    const h0 = f.k0 * R, h1 = (f.k0 + f.m) * R, hl = mul(f.r, W / 2), e = add(f.o, mul(f.d, f.len));
    const treads = [];
    for (let t = 1; t < f.m; t++) {
      const s0 = add(f.o, mul(f.d, (t - 1) * G)), s1 = add(f.o, mul(f.d, t * G));
      treads.push({ index: f.k0 + t, h: (f.k0 + t) * R, poly: [add(s0, mul(hl, -1)), add(s0, hl), add(s1, hl), add(s1, mul(hl, -1))].map(PP) });
    }
    return {
      index: i, risers: f.m, firstRiser: f.k0 + 1, h0, h1, length: f.len,
      origin: PP(f.o), dir: D(f.d), right: D(f.r), poly: flightRing(f, W).map(PP),
      start: { a: PP(add(f.o, mul(hl, -1))), b: PP(add(f.o, hl)), h: h0 },
      end: { a: PP(add(e, mul(hl, -1))), b: PP(add(e, hl)), h: h1 },
      treads,
    };
  });
  const landings = lay.landings.map((l, i) => ({ index: i, at: l.k, h: l.k * R, size: I.landing.size, poly: l.ring.map(PP) }));

  // walking line (centre of each flight; through the corner / middle of a landing)
  const line = [];
  const push = (p, h) => { const q = PP(p); const last = line.at(-1); if (!last || Math.hypot(last[0] - q[0], last[1] - q[1]) > 1e-6 || Math.abs(last[2] - h) > 1e-6) line.push([q[0], q[1], h]); };
  lay.flights.forEach((f, i) => {
    const h0 = f.k0 * R, h1 = (f.k0 + f.m) * R, e = add(f.o, mul(f.d, f.len));
    if (i > 0) {                                                        // across the landing to this flight
      const prev = lay.flights[i - 1], pe = add(prev.o, mul(prev.d, prev.len));
      if (I.shape === 'L') push([pe[0], f.o[1]], h0);
      else if (I.shape === 'U') { const vm = pe[1] + I.landing.size / 2; push([pe[0], vm], h0); push([f.o[0], vm], h0); }
    }
    push(f.o, h0); push(e, h1);
  });
  let walkLength = 0;
  for (let i = 1; i < line.length; i++) walkLength += len2(line[i - 1], line[i]);

  const fp = union([...flights.filter((f) => f.length > EPS).map((f) => f.poly), ...landings.map((l) => l.poly)]);
  const footprint = fp.length ? fp.slice().sort((a, b) => Math.abs(netArea([b])) - Math.abs(netArea([a])))[0].outer : [];
  const first = flights[0], last = flights.at(-1);
  return {
    shape: I.shape, rise, risers: n, riser: R, going: G, width: W, turn: I.shape === 'straight' ? null : (I.sigma > 0 ? 'right' : 'left'),
    gap: I.gap, landingInput: I.landing,
    flights, landings,
    walkingLine: line, walkLength, run: walkLength,
    footprint,
    start: { a: first.start.a, b: first.start.b, mid: mid(first.start.a, first.start.b), h: 0, dir: first.dir },
    arrival: { a: last.end.a, b: last.end.b, mid: mid(last.end.a, last.end.b), h: rise, dir: last.dir },
    size: { w: box.u1 - box.u0, d: box.v1 - box.v0 },
    treadCount: flights.reduce((s, f) => s + f.treads.length, 0),
  };
}

/** Position of a plan point in a flight's frame: s along (from the start edge), t across (from the centre line). */
function inFlight(f, x, y) {
  const p = [x - f.origin[0], y - f.origin[1]];
  return { s: dot(p, f.dir), t: dot(p, f.right) };
}
function flightAt(geo, x, y, eps = 1e-6) {
  for (const f of geo.flights) {
    if (f.length <= EPS) continue;
    const { s, t } = inFlight(f, x, y);
    if (s >= -eps && s <= f.length + eps && Math.abs(t) <= geo.width / 2 + eps) return { f, s: Math.min(Math.max(s, 0), f.length) };
  }
  return null;
}
const landingAt = (geo, x, y) => geo.landings.find((l) => pointInPolygon(x, y, l.poly) || onRingEdge(x, y, l.poly)) || null;
function onRingEdge(x, y, ring, eps = 1e-6) {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ab = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(ab[0], ab[1]);
    if (L < EPS) continue;
    const t = ((x - a[0]) * ab[0] + (y - a[1]) * ab[1]) / (L * L);
    if (t < -eps || t > 1 + eps) continue;
    if (Math.abs((x - a[0]) * ab[1] - (y - a[1]) * ab[0]) / L <= eps) return true;
  }
  return false;
}

/**
 * Height of the walking surface above the lower floor at a plan point on the stair (cm), or null off the stair.
 * Default: interpolated along the walking line — linear over each flight from its start edge (h0) to its end edge (h1),
 * flat on landings — what the walk (F5) wants for a smooth eye height. `{ stepped: true }`: the actual tread height.
 */
export function floorHeightAt(stair, geometry, x, y, { stepped = false } = {}) {
  const geo = geometry;
  if (!geo) return null;
  const L = landingAt(geo, x, y);
  const hit = flightAt(geo, x, y);
  if (hit) {
    const { f, s } = hit;
    if (L && s >= f.length - 1e-6) return L.h;
    if (stepped) {
      if (s >= f.length - 1e-9) return f.h1;
      const i = Math.min(f.risers - 1, Math.floor(s / geo.going + 1e-9) + 1);
      return f.h0 + i * geo.riser;
    }
    return f.length > 0 ? f.h0 + (s / f.length) * (f.h1 - f.h0) : f.h1;
  }
  return L ? L.h : null;
}

/**
 * Height of the pitch line (the line through the tread nosings) above the lower floor at a plan point (cm), or null
 * off the stair; on a landing its walking level. Headroom and guard heights are measured from it (PBR 3.2.2.4).
 */
export function pitchHeightAt(stair, geometry, x, y) {
  const geo = geometry;
  if (!geo) return null;
  const hit = flightAt(geo, x, y);
  if (hit) return Math.min(hit.f.h1, hit.f.h0 + geo.riser + (hit.s * geo.riser) / geo.going);
  const L = landingAt(geo, x, y);
  return L ? L.h : null;
}

/**
 * The headroom envelope: a surface `headroom` cm above the pitch line (flights) / the walking level (landings).
 * @returns {{ headroom, pieces: Array<{ kind: 'flight'|'landing', index, poly, origin?, dir?, base, slope }> }}
 *   envelope height at a point of a piece = base + slope · s (s = distance along `dir` from `origin`; 0 on landings)
 */
export function headroomEnvelope(stair, geometry, { headroom = DEFAULT_HEADROOM } = {}) {
  const geo = geometry;
  if (!geo) return { headroom, pieces: [] };
  const pieces = [];
  for (const f of geo.flights) if (f.length > EPS) pieces.push({ kind: 'flight', index: f.index, poly: f.poly, origin: f.origin, dir: f.dir, base: f.h0 + geo.riser + headroom, slope: geo.riser / geo.going, top: f.h1 + headroom });
  for (const l of geo.landings) pieces.push({ kind: 'landing', index: l.index, poly: l.poly, base: l.h + headroom, slope: 0, top: l.h + headroom });
  return { headroom, pieces };
}
/** Envelope height (cm above the lower floor) at a plan point, or null off the stair. */
export function envelopeHeightAt(stair, geometry, x, y, { headroom = DEFAULT_HEADROOM } = {}) {
  const p = pitchHeightAt(stair, geometry, x, y);
  return p == null ? null : p + headroom;
}

/**
 * The part of the stair's plan over which the slab of the upper level must be open: where the slab underside is less
 * than `headroom` above the pitch line (flights) or the walking level (landings). A void may be larger, never smaller.
 * @param {{ slabUnderside: number, headroom?: number }} opts  slabUnderside = height of the upper slab's underside
 *        above the lower finished floor (cm) = rise − slab thickness of the upper level
 * @returns {Array<[number, number][]>} outer rings (plan cm), empty when nothing is needed
 */
export function requiredVoid(stair, geometry, { slabUnderside, headroom = DEFAULT_HEADROOM } = {}) {
  const geo = geometry;
  if (!geo || !num(slabUnderside)) return [];
  const T = slabUnderside - headroom, rects = [];
  for (const f of geo.flights) {
    if (f.length <= EPS) continue;
    const sStar = ((T - f.h0 - geo.riser) * geo.going) / geo.riser;    // pitch(s) > T  ⇔  s > s*
    if (sStar >= f.length - 1e-9) continue;
    const s0 = Math.max(0, sStar), hl = mul(f.right, geo.width / 2);
    const a = add(f.origin, mul(f.dir, s0)), b = add(f.origin, mul(f.dir, f.length));
    rects.push([add(a, mul(hl, -1)), add(a, hl), add(b, hl), add(b, mul(hl, -1))]);
  }
  for (const l of geo.landings) if (l.h > T + 1e-9) rects.push(l.poly);
  if (!rects.length) return [];
  return union(rects).map((e) => e.outer.map((p) => p.map((v) => Math.round(v * 1e3) / 1e3)));
}

const ringsOf = (v) => {
  if (!v) return [];
  if (Array.isArray(v.polygon)) return [v.polygon];
  if (Array.isArray(v) && v.length && Array.isArray(v[0]) && typeof v[0][0] === 'number') return [v];
  if (Array.isArray(v)) return v.flatMap(ringsOf);
  return [];
};
/** The part of `required` (rings) not covered by a void (a void object, a ring, or a list of either): expolygons. */
export function uncoveredVoid(voids, required) {
  const req = ringsOf(required), have = ringsOf(voids);
  if (!req.length) return [];
  return have.length ? difference(req, have) : union(req);
}
/** True when the void(s) cover the required void (tolerance `tol` cm², default 1). */
export function voidCovers(voids, required, { tol = 1 } = {}) {
  return netArea(uncoveredVoid(voids, required)) <= tol;
}

/**
 * Side edges of the stair (flight sides and landing edges, without the start, the arrival and the joints between
 * pieces), split where they run along a wall of the lower level. A side counts as "wall" where a wall lies within
 * `near` cm (default 5) outside it — it then gets a wall-mounted handrail; elsewhere it is open (a guard).
 * @param {object} lowerPlan  PLAN-shaped view of the stair's bottom level (walls rects, slants with `poly`)
 * @returns {Array<{ a, b, wall: boolean, piece: 'flight'|'landing', index, outward: [nx, ny], ha, hb }>}
 *          ha / hb = pitch-line height at a / b (cm above the lower floor)
 */
export function stairSides(stair, geometry, lowerPlan, { near = 5, step = 5 } = {}) {
  const geo = geometry;
  if (!geo) return [];
  const walls = [];
  for (const w of (lowerPlan && lowerPlan.walls) || []) if (num(w.x) && num(w.w)) walls.push([[w.x, w.y], [w.x + w.w, w.y], [w.x + w.w, w.y + w.h], [w.x, w.y + w.h]]);
  for (const s of (lowerPlan && lowerPlan.slants) || []) if (Array.isArray(s.poly) && s.poly.length >= 3) walls.push(s.poly);
  const inWall = (p) => walls.some((poly) => pointInPolygon(p[0], p[1], poly));
  const W = geo.width, out = [];
  // joints: start / end edges of flights (the landing edges they share are not sides)
  const joints = geo.flights.flatMap((f) => [[f.start.a, f.start.b], [f.end.a, f.end.b]]);
  const candidates = [];
  geo.flights.forEach((f) => {
    if (f.length <= EPS) return;
    const hl = mul(f.right, W / 2), e = add(f.origin, mul(f.dir, f.length));
    candidates.push({ a: add(f.origin, mul(hl, -1)), b: add(e, mul(hl, -1)), outward: mul(f.right, -1), piece: 'flight', index: f.index, side: 'left' });
    candidates.push({ a: add(f.origin, hl), b: add(e, hl), outward: f.right, piece: 'flight', index: f.index, side: 'right' });
  });
  geo.landings.forEach((l) => {
    const ring = l.poly, sgn = Math.sign(ring.reduce((s, p, i) => { const b = ring[(i + 1) % ring.length]; return s + p[0] * b[1] - b[0] * p[1]; }, 0)) || 1;
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length], L = len2(a, b);
      if (L < EPS) return;
      const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      candidates.push({ a, b, outward: [-u[1] * sgn, u[0] * sgn], piece: 'landing', index: l.index });
    });
  });
  // U with no (or a narrow) well: the first flight's inner side lies against the second flight, which is higher
  if (geo.shape === 'U' && geo.gap < 10) {
    const inner = geo.turn === 'left' ? 'left' : 'right';
    const k = candidates.findIndex((c) => c.piece === 'flight' && c.index === 0 && c.side === inner);
    if (k >= 0) candidates.splice(k, 1);
  }
  for (const c of candidates) {
    const L = len2(c.a, c.b), u = [(c.b[0] - c.a[0]) / L, (c.b[1] - c.a[1]) / L];
    // remove the parts covered by joints (collinear, overlapping)
    let keep = [[0, L]];
    for (const [ja, jb] of joints) {
      const da = dot([ja[0] - c.a[0], ja[1] - c.a[1]], [-u[1], u[0]]), db = dot([jb[0] - c.a[0], jb[1] - c.a[1]], [-u[1], u[0]]);
      if (Math.abs(da) > 0.01 || Math.abs(db) > 0.01) continue;
      const t0 = Math.min(dot([ja[0] - c.a[0], ja[1] - c.a[1]], u), dot([jb[0] - c.a[0], jb[1] - c.a[1]], u));
      const t1 = Math.max(dot([ja[0] - c.a[0], ja[1] - c.a[1]], u), dot([jb[0] - c.a[0], jb[1] - c.a[1]], u));
      keep = keep.flatMap(([k0, k1]) => [[k0, Math.min(k1, t0)], [Math.max(k0, t1), k1]].filter(([p, q]) => q - p > 0.5));
    }
    for (const [k0, k1] of keep) {
      // classify samples along the kept part, then merge runs of the same kind
      const nS = Math.max(2, Math.ceil((k1 - k0) / step) + 1), cls = [];
      for (let i = 0; i < nS; i++) {
        const t = k0 + ((k1 - k0) * i) / (nS - 1), p = add(c.a, mul(u, Math.min(k1 - 0.5, Math.max(k0 + 0.5, t))));
        cls.push([1, near / 2, near].some((d) => inWall(add(p, mul(c.outward, d)))));
      }
      let i0 = 0;
      for (let i = 1; i <= nS; i++) {
        if (i < nS && cls[i] === cls[i0]) continue;
        const ta = k0 + ((k1 - k0) * Math.max(0, i0 - 0.5)) / (nS - 1), tb = k0 + ((k1 - k0) * Math.min(nS - 1, i - 0.5)) / (nS - 1);
        const a = add(c.a, mul(u, i0 === 0 ? k0 : ta)), b = add(c.a, mul(u, i === nS ? k1 : tb));
        const inside = (p) => add(p, mul(c.outward, -0.01));
        const ha = pitchHeightAt(stair, geo, ...inside(a)), hb = pitchHeightAt(stair, geo, ...inside(b));
        out.push({ a: a.map((v) => Math.round(v * 1e4) / 1e4), b: b.map((v) => Math.round(v * 1e4) / 1e4), wall: cls[i0], piece: c.piece, index: c.index, outward: c.outward, ha: ha == null ? 0 : ha, hb: hb == null ? 0 : hb });
        i0 = i;
      }
    }
  }
  return out;
}

/**
 * Problems that make a stair impossible to build as drawn (not regulation findings).
 * @param {object} stair
 * @param {object|null} [geometry]  stairGeometry(...) — its `rise` is used when given
 * @param {{ rise?: number }} [opts]
 * @returns {Array<{ code: string, en: string }>} empty when the stair is buildable
 */
export function stairProblems(stair, geometry, { rise } = {}) {
  const out = [], say = (code, en) => out.push({ code, en });
  if (!stair || typeof stair !== 'object') { say('stair', 'Not a stair.'); return out; }
  const shape = stair.shape || 'straight', n = stair.risers;
  const R = geometry ? geometry.rise : rise;
  if (!SHAPES.includes(shape)) say('shape', `Unknown stair shape "${shape}" (straight, L or U).`);
  if (!Number.isInteger(n) || n < 2) say('risers', `A stair needs a whole number of at least 2 risers (has ${n}).`);
  if (!(num(stair.width) && stair.width > 0)) say('width', 'The stair has no width.');
  if (!(num(stair.going) && stair.going > 0)) say('going', 'The stair has no going (tread depth).');
  if (R !== undefined && !(num(R) && R > 0)) say('rise', 'There is no level above this stair, or it is not higher than the stair\'s level.');
  const lan = stair.landing;
  if (lan && typeof lan === 'object' && Number.isInteger(n)) {
    if (lan.at !== undefined && !(Number.isInteger(lan.at) && lan.at >= 1 && lan.at <= n - 1)) say('landing-at', `The landing must sit between the first and the last riser (at 1…${n - 1}, has ${lan.at}).`);
    if (lan.size !== undefined && !(num(lan.size) && lan.size > 0)) say('landing-size', 'The landing has no depth.');
  }
  if (shape === 'L' && num(stair.width)) {
    const size = lan && num(lan.size) ? lan.size : stair.width;
    if (size < stair.width - EPS) say('landing-size', `The quarter landing (${size} cm) is shorter than the stair is wide (${stair.width} cm): the second flight does not fit.`);
  }
  if (stair.turn !== undefined && stair.turn !== 'left' && stair.turn !== 'right') say('turn', 'turn must be "left" or "right".');
  if (!out.length && !geometry && num(R) && R > 0 && !stairGeometry(stair, { rise: R })) say('stair', 'The stair cannot be built from these numbers.');
  return out;
}

/** Limits a proposal respects (the regulation numbers, regulations/stairs.js): cm. */
export const PROPOSAL = Object.freeze({ maxRiser: 17.5, minGoing: 26, comfort: 62, maxFlightRisers: 18, minWidth: 80 });

/**
 * A default stair for a floor-to-floor rise that satisfies the stair rules: the fewest risers whose height is
 * ≤ 17.5 cm, the going from the comfort relation 2R + G = 62 cm (to 0.5 cm), a landing in the middle when a straight
 * flight would have more than 18 risers (and always for L / U, depth = the width).
 * @param {{ rise: number, shape?: 'straight'|'L'|'U', width?: number, turn?: 'left'|'right' }} opts
 * @returns {object|null} { shape, x: 0, y: 0, rot: 0, width, risers, going, landing?, turn? } (add id / to / pose)
 */
export function proposeStair({ rise, shape = 'straight', width = 90, turn = 'right' } = {}) {
  if (!num(rise) || rise <= 0 || !SHAPES.includes(shape)) return null;
  const W = num(width) && width > 0 ? Math.max(width, PROPOSAL.minWidth) : 90;
  const n = Math.max(2, Math.ceil(rise / PROPOSAL.maxRiser - 1e-9));
  const R = rise / n;
  const going = Math.max(PROPOSAL.minGoing, Math.round((PROPOSAL.comfort - 2 * R) * 2) / 2);
  const st = { shape, x: 0, y: 0, rot: 0, width: W, risers: n, going };
  if (shape !== 'straight') { st.landing = { at: Math.ceil(n / 2), size: W }; st.turn = turn === 'left' ? 'left' : 'right'; }
  else if (n > PROPOSAL.maxFlightRisers) st.landing = { at: Math.ceil(n / 2), size: W };
  return st;
}

/** Plan point → the stair's local (item) frame; re-exported for the 2D symbol (F4b). */
export const toStairLocal = (stair, x, y) => planToItemLocal(stair, x, y);
