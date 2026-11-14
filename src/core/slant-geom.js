/**
 * SLANT GEOMETRY (stage A0 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md) — an angled wall ("slant") is a centre line
 * (x1, y1) → (x2, y2) with a thickness t, in plan centimetres. This module gives its frame, faces, openings, distances
 * and the joins with other slants and with the rect walls, producing each slant's footprint polygon `poly` (the
 * derived field of the plan JSON). Pure functions; nothing in the app imports this yet.
 * See CONTRACT "Polygon kernel and slant geometry" for the API summary.
 *
 * CONVENTIONS
 *   Direction u = unit (x2 − x1, y2 − y1). The RIGHT-hand normal on screen (y down) is n = (−uy, ux): for a wall
 *   running east, n points south. 'l' / 'r' (sideOf, opening swing / outside) are relative to the direction x1 → x2.
 *   `at` = cm along the centre line from (x1, y1). Polygons are rings [[x, y], ...] in the engine's room convention
 *   (clockwise on screen, starting at min y then min x), vertices on the kernel's 0.001 cm grid.
 *
 * JOINS (joinSlants) — each slant end is classified once, in this order:
 *   1. End meets end(s): ends of different slants within JOIN_EPS (1 cm) form a junction at C (their mean point).
 *      The walls are sorted by direction around C; between two neighbours the facing face lines meet at Q (the mitre
 *      point). Each wall keeps the wedge between the rays C→Q on its two sides ("pinwheel"), so the walls tile the
 *      junction exactly — no gap, no overlap — for 2, 3 or more walls. For two walls the cut is the one line through both
 *      mitre points (the classic mitre; along the bisector when t is equal); for three or more it covers exactly the star polygon of the Q points (the
 *      design's "hull joint piece" when that is convex; when it is not, the hull would poke out and the pinwheel does
 *      not). On an outer (reflex, > 180°) side the mitre is kept while |CQ| ≤ MITRE_LIMIT · t (3 t, t of the thicker
 *      wall), otherwise that corner is bevelled: cut by the chord between the two walls' face end points, the split
 *      ray going through the chord's midpoint. (Equal t: mitre down to an inner angle of 19.2°; 15° is bevelled.)
 *   2. End on a slant side (T): the end's centre line meets another slant's centre line inside that slant's length,
 *      the end stops short of its near face by at most its own thickness t (or overshoots by at most t): the end is
 *      cut along the other slant's centre line (extended or trimmed); the other wall covers the rest.
 *   3. End on a rect wall: the centre ray enters the rect within the same reach: the slant is cut at the face it
 *      enters through, and the part inside the rect is added clipped by the rect itself — so it reaches the far face
 *      and never pokes out of the rect, beyond its far face or its ends.
 *   4. Otherwise a free end: square (butt) cap through the end point, perpendicular to the wall.
 *   Rect end on a slant: a rect wall whose end face (short side) heads into a slant, with its nearest end corner at
 *   most the slant's t from the slant's near face, stays a rect; a joint fill — the rect's own extension from its
 *   end face along its sides up to the slant's centre line, clipped to the slant's length — is added to the slant's
 *   poly. (The design text says "hull of the end corners and their projections onto the centre line"; projections
 *   leave a notch whenever the rect meets the slant obliquely, the side-line extension is the gap-free version and
 *   contains the part of that hull that lies outside the slant.)
 *   joinSlants is order-independent (candidates are chosen by geometry, ties by a geometric key) and idempotent
 *   (`poly` is recomputed from centre lines, thickness and rects only).
 */
import { union, normalise, area, netArea } from './polykernel.js';

export const MITRE_LIMIT = 3;          // × t: longer outer mitres are bevelled
export const JOIN_EPS = 1;             // cm: slant ends this close are one junction
const MIN_SIN = Math.sin((5 * Math.PI) / 180);   // walls closer than 5° to parallel do not form a T / rect join
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- frame and helpers
/**
 * Frame of a slant: { x1, y1, x2, y2, len, ux, uy, nx, ny, t, hw, angle }. (nx, ny) is the RIGHT-hand normal on
 * screen ('r' side); angle = degrees of u from +x towards +y (screen), in (−180, 180]. A zero-length slant gets u = +x.
 */
export function slantFrame(s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy);
  const ux = len > 0 ? dx / len : 1, uy = len > 0 ? dy / len : 0, t = s.t;
  return { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, len, ux, uy, nx: -uy, ny: ux, t, hw: t / 2, angle: (Math.atan2(uy, ux) * 180) / Math.PI };
}

/** Point on the centre line `at` cm from (x1, y1) (not clamped). */
export function pointAt(s, at) { const f = slantFrame(s); return [s.x1 + f.ux * at, s.y1 + f.uy * at]; }
/** Position of (x, y) projected on the centre line, in cm from (x1, y1) (not clamped). */
export function atOf(s, x, y) { const f = slantFrame(s); return (x - s.x1) * f.ux + (y - s.y1) * f.uy; }
/** Signed perpendicular distance of (x, y) from the centre line (infinite line): + on the right ('r'), − on the left. */
export function offsetOf(s, x, y) { const f = slantFrame(s); return (x - s.x1) * f.nx + (y - s.y1) * f.ny; }
/** Side of (x, y) relative to the direction x1 → x2: 'l' | 'r' (null exactly on the centre line). */
export function sideOf(s, x, y) { const d = offsetOf(s, x, y); return d > 0 ? 'r' : d < 0 ? 'l' : null; }

/** The two face lines, each from the (x1, y1) end to the (x2, y2) end: { l: [[x, y], [x, y]], r: [...] }. */
export function faceLines(s) {
  const f = slantFrame(s), ox = f.nx * f.hw, oy = f.ny * f.hw;
  return { l: [[s.x1 - ox, s.y1 - oy], [s.x2 - ox, s.y2 - oy]], r: [[s.x1 + ox, s.y1 + oy], [s.x2 + ox, s.y2 + oy]] };
}

/** Footprint of a free slant (square caps through the end points). */
export function freePoly(s) {
  const f = slantFrame(s), ox = f.nx * f.hw, oy = f.ny * f.hw;
  return normalise([[s.x1 - ox, s.y1 - oy], [s.x2 - ox, s.y2 - oy], [s.x2 + ox, s.y2 + oy], [s.x1 + ox, s.y1 + oy]]);
}

/** The gap of an opening: the quad through the whole thickness between at − width/2 and at + width/2. */
export function openingQuad(s, at, width) {
  const f = slantFrame(s), a0 = at - width / 2, a1 = at + width / 2, ox = f.nx * f.hw, oy = f.ny * f.hw;
  const P = (a) => [s.x1 + f.ux * a, s.y1 + f.uy * a];
  const [p0, p1] = [P(a0), P(a1)];
  return normalise([[p0[0] - ox, p0[1] - oy], [p1[0] - ox, p1[1] - oy], [p1[0] + ox, p1[1] + oy], [p0[0] + ox, p0[1] + oy]]);
}

/** Distance from (x, y) to the centre-line segment. */
export function distToCentre(s, x, y) {
  const f = slantFrame(s), a = Math.max(0, Math.min(f.len, (x - s.x1) * f.ux + (y - s.y1) * f.uy));
  return Math.hypot(x - s.x1 - f.ux * a, y - s.y1 - f.uy * a);
}

/** Distance from (x, y) to the wall's footprint (0 inside): its `poly` when present, else the free footprint. */
export function distToWall(s, x, y) {
  if (!Array.isArray(s.poly) || s.poly.length < 3) {
    const f = slantFrame(s), a = (x - s.x1) * f.ux + (y - s.y1) * f.uy, d = (x - s.x1) * f.nx + (y - s.y1) * f.ny;
    return Math.hypot(Math.max(0, -a, a - f.len), Math.max(0, Math.abs(d) - f.hw));
  }
  const poly = s.poly;
  let best = Infinity, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside ? 0 : best;
}

// ---------------------------------------------------------------- convex clipping (half-plane: keep (p − P)·N ≥ 0)
const hp = (px, py, nx, ny) => ({ px, py, nx, ny });
/** Half-plane bounded by the line through (px, py) with direction (dx, dy), on the side of point (kx, ky). */
function hpToward(px, py, dx, dy, kx, ky) {
  let nx = -dy, ny = dx;
  if ((kx - px) * nx + (ky - py) * ny < 0) { nx = -nx; ny = -ny; }
  return hp(px, py, nx, ny);
}
function clipConvex(poly, h) {
  const out = [], n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const da = (a[0] - h.px) * h.nx + (a[1] - h.py) * h.ny, db = (b[0] - h.px) * h.nx + (b[1] - h.py) * h.ny;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) { const k = da / (da - db); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
  }
  return out;
}
const clipAll = (poly, hps) => { let p = poly; for (const h of hps) { if (p.length < 3) return []; p = clipConvex(p, h); } return p.length >= 3 ? p : []; };
const rectHps = (r) => [hp(r.x, r.y, 1, 0), hp(r.x + r.w, r.y, -1, 0), hp(r.x, r.y, 0, 1), hp(r.x, r.y + r.h, 0, -1)];
const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const keyOf = (s) => `${s.x1},${s.y1},${s.x2},${s.y2},${s.t},${s.id == null ? '' : s.id}`;
const rectKey = (r) => `${r.x},${r.y},${r.w},${r.h},${r.id == null ? '' : r.id}`;
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const validSlant = (s) => s && [s.x1, s.y1, s.x2, s.y2, s.t].every((v) => typeof v === 'number' && Number.isFinite(v)) && s.t > 0;
const validRect = (r) => r && [r.x, r.y, r.w, r.h].every((v) => typeof v === 'number' && Number.isFinite(v)) && r.w > 0 && r.h > 0;

// ---------------------------------------------------------------- join analysis
/**
 * How every slant end is joined, without building polygons:
 * [{ id, ends: [end0, end1], fills: [rectIndex, ...] }] in input order, where end = { type, with } and
 * type = 'free' | 'mitre' | 'bevel' | 'multi' (3+ walls; `bevel: true` when one of its outer corners is bevelled)
 *        | 'tee' (with = [slant index]) | 'rect' (with = [rect index]) | 'degenerate' (slant shorter than JOIN_EPS).
 * Indexes refer to the input arrays.
 */
export function slantJoins(slants, rects = []) {
  return analyse(slants, rects).map((a, i) => ({ id: slants[i].id, ends: a.ends.map((e) => ({ type: e.type, with: e.with, ...(e.bevel ? { bevel: true } : {}) })), fills: a.fills.map((f) => f.rect) }));
}

function analyse(slants, rectsIn) {
  const rects = rectsIn.map((r, i) => ({ r, i })).filter((q) => validRect(q.r));
  const S = slants.map((s, i) => {
    if (!validSlant(s)) throw new TypeError(`slant-geom: slant ${i} needs finite x1, y1, x2, y2 and t > 0`);
    const f = slantFrame(s);
    return { s, i, f, key: keyOf(s), degenerate: f.len <= JOIN_EPS, ends: [null, null], fills: [] };
  });
  // ends: point, direction INTO the wall from that end, the far end point
  const ends = [];
  for (const a of S) {
    if (a.degenerate) { a.ends = [{ type: 'degenerate', with: [] }, { type: 'degenerate', with: [] }]; continue; }
    const { f } = a;
    ends.push({ a, k: 0, x: f.x1, y: f.y1, dx: f.ux, dy: f.uy, fx: f.x2, fy: f.y2 });
    ends.push({ a, k: 1, x: f.x2, y: f.y2, dx: -f.ux, dy: -f.uy, fx: f.x1, fy: f.y1 });
  }
  // 1. junctions: connected components of ends closer than JOIN_EPS (order-independent)
  const parent = ends.map((e, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    if (ends[i].a === ends[j].a) continue;
    if (Math.hypot(ends[i].x - ends[j].x, ends[i].y - ends[j].y) <= JOIN_EPS) parent[find(i)] = find(j);
  }
  const groups = new Map();
  ends.forEach((e, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(e); });
  for (const g of groups.values()) if (g.length >= 2) junction(g);
  // 2–4. remaining ends: T on a slant, end on a rect, or free
  for (const e of ends) if (!e.a.ends[e.k]) single(e, S, rects);
  // rect ends on slants (joint fills)
  for (const { r, i } of rects) for (const a of S) if (!a.degenerate) { const fill = rectFill(r, a.f); if (fill) a.fills.push({ rect: i, poly: fill }); }
  return S;
}

function junction(members) {
  const pts = members.map((e) => [e.x, e.y]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length, C = [cx, cy];
  const M = members.map((e) => ({ e, ang: Math.atan2(e.dy, e.dx), hw: e.a.f.hw, t: e.a.f.t }));
  M.sort((p, q) => p.ang - q.ang || p.hw - q.hw || cmpStr(p.e.a.key, q.e.a.key) || p.e.k - q.e.k);
  const k = M.length, rays = new Array(k), cuts = new Array(k), bevels = new Array(k).fill(null);
  for (let g = 0; g < k; g++) {
    const m = M[g], q = M[(g + 1) % k];
    let theta = q.ang - m.ang + (g === k - 1 ? TAU : 0);
    if (theta < 0) theta = 0;
    // facing faces: m's face towards increasing angle, q's face towards decreasing angle
    const EA = [m.e.x - m.e.dy * m.hw, m.e.y + m.e.dx * m.hw], EB = [q.e.x + q.e.dy * q.hw, q.e.y - q.e.dx * q.hw];
    const cr = cross(m.e.dx, m.e.dy, q.e.dx, q.e.dy);
    let Q = null;
    if (Math.abs(cr) > 1e-9) { const s = cross(EB[0] - EA[0], EB[1] - EA[1], q.e.dx, q.e.dy) / cr; Q = [EA[0] + m.e.dx * s, EA[1] + m.e.dy * s]; } else if (theta > Math.PI / 2 && theta < 1.5 * Math.PI) Q = [(EA[0] + EB[0]) / 2, (EA[1] + EB[1]) / 2];
    if (Q && theta > Math.PI && Math.hypot(Q[0] - cx, Q[1] - cy) > MITRE_LIMIT * Math.max(m.t, q.t)) {
      Q = [(EA[0] + EB[0]) / 2, (EA[1] + EB[1]) / 2];
      bevels[g] = { EA, EB };
    }
    let rho = Q && Math.hypot(Q[0] - cx, Q[1] - cy) > 1e-9 ? Math.atan2(Q[1] - cy, Q[0] - cx) - m.ang : NaN;
    rho = ((rho % TAU) + TAU) % TAU;
    if (!(rho >= 0 && rho <= theta)) { rho = theta / 2; Q = null; }       // degenerate: split along the bisector
    rays[g] = m.ang + rho;
    cuts[g] = Q;
  }
  const anyBevel = bevels.some(Boolean);
  const keys = [C, ...cuts.filter(Boolean), ...bevels.filter(Boolean).flatMap((b) => [b.EA, b.EB])];
  for (let g = 0; g < k; g++) {
    const m = M[g], gp = (g + k - 1) % k, far = [m.e.fx, m.e.fy];
    const extra = [];
    for (const b of [bevels[gp], bevels[g]]) if (b) extra.push(hpToward(b.EA[0], b.EA[1], b.EB[0] - b.EA[0], b.EB[1] - b.EA[1], far[0], far[1]));
    let alts = null;
    const A = cuts[gp], B = cuts[g];
    if (k === 2 && A && B && Math.hypot(A[0] - B[0], A[1] - B[1]) > 1e-6) {
      // two walls: one cut line through both mitre (or bevel-split) points — the classic mitre, also for unequal t
      const H = hpToward(A[0], A[1], B[0] - A[0], B[1] - A[1], far[0], far[1]);
      if ((far[0] - A[0]) * H.nx + (far[1] - A[1]) * H.ny > 1e-9) alts = [[H, ...extra]];
    }
    if (!alts) {
      // pinwheel: the wedge between the rays C→cut on both sides; rays pass exactly through C and the cut points
      const start = rays[gp], span = (((rays[g] - start) % TAU) + TAU) % TAU || TAU;
      const mid = start + span / 2, wx = cx + Math.cos(mid), wy = cy + Math.sin(mid);
      const line = (Q, ang) => (Q ? [Q[0] - cx, Q[1] - cy] : [Math.cos(ang), Math.sin(ang)]);
      const [ax, ay] = line(A, start), [bx, by] = line(B, rays[g]);
      const H0 = hpToward(cx, cy, ax, ay, wx, wy), H1 = hpToward(cx, cy, bx, by, wx, wy);
      alts = span <= Math.PI + 1e-12 ? [[H0, H1, ...extra]] : [[H0, ...extra], [H1, ...extra]];
    }
    const others = M.filter((o) => o !== m).map((o) => o.e.a.i).sort((p, q) => p - q);
    const type = k === 2 ? (anyBevel ? 'bevel' : 'mitre') : 'multi';
    m.e.a.ends[m.e.k] = { type, with: others, alts, keys, ...(k > 2 && anyBevel ? { bevel: true } : {}) };
  }
}

function single(e, S, rects) {
  const a = e.a, t = a.f.t, ox = -e.dx, oy = -e.dy;          // outward direction at this end
  let best = null;
  const better = (c) => !best || Math.abs(c.entry) < Math.abs(best.entry) - 1e-9 || (Math.abs(c.entry) <= Math.abs(best.entry) + 1e-9 && (c.rank < best.rank || (c.rank === best.rank && cmpStr(c.key, best.key) < 0)));
  // T: the end's centre line meets another slant's centre line within that slant's length
  for (const b of S) {
    if (b === a || b.degenerate) continue;
    const { f } = b, cr = cross(ox, oy, f.ux, f.uy);
    if (Math.abs(cr) < MIN_SIN) continue;
    const s = cross(f.x1 - e.x, f.y1 - e.y, f.ux, f.uy) / cr;
    const X = [e.x + ox * s, e.y + oy * s], along = (X[0] - f.x1) * f.ux + (X[1] - f.y1) * f.uy;
    if (along < 0 || along > f.len) continue;
    const half = f.hw / Math.abs(cr);
    if (s - half > t || s + half < -t || s < -a.f.len / 2) continue;
    const c = { kind: 'tee', entry: s - half, rank: 0, key: b.key, b };
    if (better(c)) best = c;
  }
  // end on a rect: the centre ray enters the rect within reach
  for (const { r, i } of rects) {
    let sIn = -Infinity, sOut = Infinity, face = null;
    const axis = (p, d, lo, hi, name) => {
      if (Math.abs(d) < 1e-12) return p >= lo && p <= hi;
      let t0 = (lo - p) / d, t1 = (hi - p) / d, f0 = d > 0 ? lo : hi;
      if (t0 > t1) [t0, t1] = [t1, t0];
      if (t0 > sIn) { sIn = t0; face = { name, at: f0 }; }
      if (t1 < sOut) sOut = t1;
      return true;
    };
    if (!axis(e.x, ox, r.x, r.x + r.w, 'x') || !axis(e.y, oy, r.y, r.y + r.h, 'y') || !face || sOut - sIn <= 1e-9) continue;
    if (sIn > t || sOut < -t || sIn < -a.f.len / 2) continue;
    const c = { kind: 'rect', entry: sIn, rank: 1, key: rectKey(r), r, i, face };
    if (better(c)) best = c;
  }
  if (!best) {
    a.ends[e.k] = { type: 'free', with: [], alts: [[hp(e.x, e.y, e.dx, e.dy)]] };
  } else if (best.kind === 'tee') {
    const { f } = best.b;
    a.ends[e.k] = { type: 'tee', with: [best.b.i], alts: [[hpToward(f.x1, f.y1, f.ux, f.uy, e.fx, e.fy)]] };
  } else {
    const { face, r } = best;
    const H = face.name === 'x' ? hpToward(face.at, r.y, 0, 1, e.fx, e.fy) : hpToward(r.x, face.at, 1, 0, e.fx, e.fy);
    a.ends[e.k] = { type: 'rect', with: [best.i], alts: [[H]], rect: r };
  }
}

/** Joint fill of a rect end heading into slant frame f, or null. */
function rectFill(r, f) {
  const faces = [];
  if (r.w >= r.h) faces.push({ c: [[r.x, r.y], [r.x, r.y + r.h]], e: [-1, 0] }, { c: [[r.x + r.w, r.y], [r.x + r.w, r.y + r.h]], e: [1, 0] });
  if (r.h >= r.w) faces.push({ c: [[r.x, r.y], [r.x + r.w, r.y]], e: [0, -1] }, { c: [[r.x, r.y + r.h], [r.x + r.w, r.y + r.h]], e: [0, 1] });
  let best = null;
  for (const { c, e } of faces) {
    const d = c.map(([x, y]) => (x - f.x1) * f.nx + (y - f.y1) * f.ny);
    if (!(d[0] * d[1] > 0)) continue;
    const sg = Math.sign(d[0]), tx = -sg * f.nx, ty = -sg * f.ny, cosE = e[0] * tx + e[1] * ty;
    if (cosE < MIN_SIN) continue;
    const lam = d.map((v) => Math.abs(v) / cosE), gap = Math.min(...d.map((v) => (Math.abs(v) - f.hw) / cosE));
    if (gap > f.t) continue;
    const X = c.map(([x, y], k) => [x + e[0] * lam[k], y + e[1] * lam[k]]);
    const al = X.map(([x, y]) => (x - f.x1) * f.ux + (y - f.y1) * f.uy);
    if (Math.max(...al) < 0 || Math.min(...al) > f.len) continue;
    const quad = clipAll([c[0], c[1], X[1], X[0]], [hp(f.x1, f.y1, f.ux, f.uy), hp(f.x2, f.y2, -f.ux, -f.uy)]);
    if (quad.length < 3 || Math.abs(area(quad)) < 1e-6) continue;
    if (!best || gap < best.gap) best = { gap, quad };
  }
  return best ? best.quad : null;
}

// ---------------------------------------------------------------- polygons
/**
 * Every slant with its joined footprint: a new array in input order of `{ ...slant, poly }` (other fields kept).
 * `rects` are the level's rect walls ({ x, y, w, h }; rect openings may be included or not — they are solid wall).
 * A slant whose joins leave nothing (e.g. shorter than the junction it sits in) keeps its free footprint.
 */
export function joinSlants(slants, rects = []) {
  const A = analyse(slants, rects);
  const tmax = Math.max(1, ...A.map((a) => a.f.t), ...rects.filter(validRect).map((r) => Math.min(r.w, r.h)));
  return A.map((a) => ({ ...a.s, poly: polyOf(a, tmax) }));
}

function polyOf(a, tmax) {
  const { f } = a;
  if (a.degenerate) return freePoly(a.s);
  const E = f.len + 50 * tmax + 200, ox = f.nx * f.hw, oy = f.ny * f.hw;
  const sx = f.x1 - f.ux * E, sy = f.y1 - f.uy * E, ex = f.x2 + f.ux * E, ey = f.y2 + f.uy * E;
  const strip = [[sx - ox, sy - oy], [ex - ox, ey - oy], [ex + ox, ey + oy], [sx + ox, sy + oy]];
  const pieces = [];
  const [e0, e1] = a.ends;
  for (const c0 of e0.alts) for (const c1 of e1.alts) pieces.push(clipAll(strip, [...c0, ...c1]));
  for (const [end, other] of [[e0, e1], [e1, e0]]) {
    if (end.type !== 'rect') continue;
    // the part inside the rect; its near-face bound is moved 0.01 cm outwards so it overlaps the body piece
    const H = end.alts[0][0], inside = rectHps(end.rect).map((q) => (q.nx === -H.nx && q.ny === -H.ny ? hp(q.px - q.nx * 0.01, q.py - q.ny * 0.01, q.nx, q.ny) : q));
    for (const c of other.alts) pieces.push(clipAll(strip, [...inside, ...c]));
  }
  // shared junction points: snap the clipped copies to the one computed point, so neighbouring walls share their
  // cut edges exactly (bit for bit) and their union has no hairline gap after rounding to the kernel grid
  const keys = [...(e0.keys || []), ...(e1.keys || [])];
  if (keys.length) for (const p of pieces) for (let i = 0; i < p.length; i++) {
    for (const q of keys) if (Math.abs(p[i][0] - q[0]) < 1e-6 && Math.abs(p[i][1] - q[1]) < 1e-6) { p[i] = q; break; }
  }
  for (const fl of a.fills) pieces.push(fl.poly);
  const solid = pieces.filter((p) => p.length >= 3 && Math.abs(area(p)) > 1e-6);
  const u = solid.length ? union(solid) : [];
  if (!u.length) return freePoly(a.s);
  let best = u[0];
  for (const x of u) if (netArea([x]) > netArea([best])) best = x;
  return best.outer;
}
