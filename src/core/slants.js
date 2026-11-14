/**
 * ANGLED WALLS — the polygon half of the MIXED DERIVE (stage A1 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md § 3).
 * Pure functions on top of polykernel.js / slant-geom.js; plan-edit.js runs the mixed derive (its grid half) with them
 * on every level that has at least one slant. A level without slants never reaches this file.
 *
 *   slantLevel(slants, rects)        joined footprints (slant-geom joinSlants: never trusts a saved `poly`), frames,
 *                                    free ends, the openings' gap quads, and the free stretches of every face
 *   angledOpeningGeom(o, slant)      derived geometry of an opening in a slant (cx, cy, angle, t, quad, AABB x, y, w, h)
 *   spaceLocator(faces)              point → outdoor face (-1) / room face index / null (inside a solid)
 *   labelCells(xs, ys, locator)      the same for the centre of every grid cell (scanline, exact)
 *   outlineEdges(solids, cuts)       boundary edges of the wall material (diagonal entries allowed), engine order
 *
 * Conventions as slant-geom.js: u = unit x1 → x2, n = (−uy, ux) is the RIGHT ('r') side, `at` = cm from (x1, y1).
 */
import { joinSlants, slantJoins, slantFrame, openingQuad, freePoly } from './slant-geom.js';
import { difference, rings, offset as polyOffset } from './polykernel.js';

export const isAngledOpening = (o) => !!o && o.axis === 'a';
/** True when a plan / level / plan state carries at least one slant. */
export const hasSlants = (p) => !!p && Array.isArray(p.slants) && p.slants.length > 0;

const EPS = 1e-6;
const bboxOf = (pts) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const rectRing = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
const boxHit = (a, b, pad = 0) => a.x - pad <= b.x + b.w && b.x - pad <= a.x + a.w && a.y - pad <= b.y + b.h && b.y - pad <= a.y + a.h;

// ---------------------------------------------------------------- 1-D intervals along a line
/** Sorted disjoint parameter intervals [a0, a1] where the line P + a·u lies inside the ring (even-odd). */
function lineIn(px, py, ux, uy, ring) {
  const cuts = [], n = ring.length;
  for (let i = 0; i < n; i++) {
    const A = ring[i], B = ring[(i + 1) % n];
    const dA = (A[0] - px) * -uy + (A[1] - py) * ux, dB = (B[0] - px) * -uy + (B[1] - py) * ux;
    if ((dA > 0) === (dB > 0)) continue;
    const k = dA / (dA - dB), X = A[0] + (B[0] - A[0]) * k, Y = A[1] + (B[1] - A[1]) * k;
    cuts.push((X - px) * ux + (Y - py) * uy);
  }
  cuts.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < cuts.length; i += 2) if (cuts[i + 1] > cuts[i]) out.push([cuts[i], cuts[i + 1]]);
  return out;
}
function unite(list) {
  const s = list.slice().sort((p, q) => p[0] - q[0]), out = [];
  for (const iv of s) { const last = out[out.length - 1]; if (last && iv[0] <= last[1] + EPS) last[1] = Math.max(last[1], iv[1]); else out.push(iv.slice()); }
  return out;
}
function subtract(a, b) {
  const out = [];
  for (const [p, q] of a) {
    let cur = p;
    for (const [r, s] of b) {
      if (s <= cur || r >= q) continue;
      if (r > cur) out.push([cur, r]);
      cur = Math.max(cur, s);
      if (cur >= q) break;
    }
    if (cur < q) out.push([cur, q]);
  }
  return out.filter(([p, q]) => q - p > 1);
}

// ---------------------------------------------------------------- slants of one level
/**
 * slant-geom joinSlants + slantJoins on the rects that can take part in a join (those near a slant: a join reaches at
 * most the slant's thickness beyond its footprint; the others cannot change a polygon). Same polygons as passing them all.
 * @returns {{ joined: Array<slant & { poly }>, joins: ReturnType<typeof slantJoins> }}
 */
export function joinLevelSlants(slants, rects) {
  const boxes = slants.map((s) => { const m = 3 * Math.max(1, s.t || 0); return { x: Math.min(s.x1, s.x2) - m, y: Math.min(s.y1, s.y2) - m, w: Math.abs(s.x2 - s.x1) + 2 * m, h: Math.abs(s.y2 - s.y1) + 2 * m }; });
  const near = rects.filter((r) => boxes.some((b) => boxHit(r, b)));
  return { joined: joinSlants(slants, near), joins: slantJoins(slants, near) };
}
/**
 * Everything the derive needs about the slants of a level: `rects` are the level's rect solids (walls + rect openings).
 * @returns {{ list: Array<{ s, i, f, poly, box, freeEnds: [bool, bool], faces: { l: [[a0, a1]…], r: […] } }>, byId: Map }}
 *   faces.l / faces.r = the stretches (cm along the centre line from x1, y1) where that face borders open space (not
 *   another wall, not the wall's own joints) — what jambs are measured on and where the spaces on its sides are sampled.
 */
export function slantLevel(slants, rects) {
  const { joined, joins } = joinLevelSlants(slants, rects);
  const list = joined.map((s, i) => {
    const f = slantFrame(s), poly = s.poly;
    return { s: slants[i], i, f, poly, box: bboxOf(poly), freeEnds: joins[i].ends.map((e) => e.type === 'free' || e.type === 'degenerate') };
  });
  const rectSolids = rects.map((r) => ({ ring: rectRing(r), box: { x: r.x, y: r.y, w: r.w, h: r.h } }));
  for (const g of list) {
    const { f } = g, reach = { x: g.box.x - 2, y: g.box.y - 2, w: g.box.w + 4, h: g.box.h + 4 };
    const others = [...rectSolids.filter((o) => boxHit(o.box, reach)), ...list.filter((o) => o !== g && boxHit(o.box, reach)).map((o) => ({ ring: o.poly }))];
    g.faces = {};
    for (const [side, sg] of [['l', -1], ['r', 1]]) {
      const inn = f.hw - Math.min(0.05, f.hw / 4), outd = f.hw + 0.5;
      const ix = f.x1 + sg * f.nx * inn, iy = f.y1 + sg * f.ny * inn, ox = f.x1 + sg * f.nx * outd, oy = f.y1 + sg * f.ny * outd;
      // the face is free where just inside it is this wall and no other (not a joint inside a rect / another slant) and
      // just outside it is no wall at all
      const own = lineIn(ix, iy, f.ux, f.uy, g.poly);
      const blocked = unite([...lineIn(ox, oy, f.ux, f.uy, g.poly), ...others.flatMap((o) => [...lineIn(ox, oy, f.ux, f.uy, o.ring), ...lineIn(ix, iy, f.ux, f.uy, o.ring)])]);
      g.faces[side] = subtract(own, blocked);
    }
  }
  return { list, byId: new Map(list.map((g) => [g.s.id, g])) };
}

/**
 * Derived geometry of an opening in a slant: centre (cx, cy), direction `angle` (degrees, of x1 → x2), wall thickness
 * `t`, the gap quad through the whole thickness, its axis-aligned bounds x, y, w, h (culling only).
 */
export function angledOpeningGeom(o, s) {
  const f = slantFrame(s), cx = s.x1 + f.ux * o.at, cy = s.y1 + f.uy * o.at, quad = openingQuad(s, o.at, o.width);
  return { cx, cy, angle: f.angle, t: f.t, ux: f.ux, uy: f.uy, quad, ...bboxOf(quad) };
}

/** The gap quad of an opening in a slant from its derived fields (cx, cy, angle, t, width), or null. */
export function quadOfOpening(o) {
  if (![o.cx, o.cy, o.angle, o.t, o.width].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const a = (o.angle * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, L = o.width / 2, T = o.t / 2;
  return [[o.cx - ux * L - nx * T, o.cy - uy * L - ny * T], [o.cx + ux * L - nx * T, o.cy + uy * L - ny * T], [o.cx + ux * L + nx * T, o.cy + uy * L + ny * T], [o.cx - ux * L + nx * T, o.cy - uy * L + ny * T]];
}

/**
 * Check the openings of the slants: each must sit inside its wall with ≥ `minJamb` cm of wall beside it on BOTH faces
 * (so on the shorter face after mitres and joints), and must not overlap / crowd another opening of the same wall.
 * @returns {Map<id, { ok: boolean, type?: 'jamb' | 'overlap', g?, geo? }>}
 */
export function checkAngledOpenings(openings, level, minJamb) {
  const res = new Map(), perWall = new Map();
  for (const o of openings) {
    const g = level.byId.get(o.wall);
    if (!g || !(typeof o.at === 'number' && Number.isFinite(o.at)) || !(o.width > 0)) { res.set(o.id, { ok: false, type: 'jamb' }); continue; }
    const geo = angledOpeningGeom(o, g.s), a0 = o.at - o.width / 2, a1 = o.at + o.width / 2;
    const fits = (ivs) => ivs.some(([p, q]) => p <= a0 - minJamb + EPS && q >= a1 + minJamb - EPS);
    res.set(o.id, fits(g.faces.l) && fits(g.faces.r) ? { ok: true, g, geo } : { ok: false, type: 'jamb', g, geo });
    if (!perWall.has(o.wall)) perWall.set(o.wall, []);
    perWall.get(o.wall).push({ o, a0, a1 });
  }
  for (const list of perWall.values()) {
    list.sort((p, q) => p.a0 - q.a0);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1], cur = list[i], r = res.get(cur.o.id);
      if (cur.a0 < prev.a1 - EPS) res.set(cur.o.id, { ...r, ok: false, type: 'overlap' });
      else if (cur.a0 - prev.a1 < minJamb - EPS && r.ok) res.set(cur.o.id, { ...r, ok: false, type: 'jamb' });
    }
  }
  return res;
}

// ---------------------------------------------------------------- point location in the faces
/**
 * Locator over polykernel `faces()` output: (x, y) → -1 (an outdoor face), the index of a room face, or null (inside a
 * solid / on no face). Even-odd over each face's rings, bounding boxes first.
 */
export function spaceLocator(F) {
  const entries = [...F.outdoor.map((e) => ({ id: -1, e })), ...F.rooms.map((e, i) => ({ id: i, e }))].map(({ id, e }) => ({ id, rings: [e.outer, ...e.holes], box: bboxOf(e.outer) }));
  const locate = (x, y) => {
    for (const en of entries) {
      const b = en.box;
      if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) continue;
      let inside = false;
      for (const r of en.rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return en.id;
    }
    return null;
  };
  locate.entries = entries;
  return locate;
}

/**
 * Face of the centre of every grid cell: Int32Array (row-major, nx = xs.length − 1) of -1 (outdoor), a room face index,
 * or -2 (inside a solid). One scanline per row through every face's rings.
 */
export function labelCells(xs, ys, locator) {
  const nx = xs.length - 1, ny = ys.length - 1, label = new Int32Array(nx * ny).fill(-2);
  const cxs = new Float64Array(nx);
  for (let i = 0; i < nx; i++) cxs[i] = (xs[i] + xs[i + 1]) / 2;
  const first = (v) => { let lo = 0, hi = nx; while (lo < hi) { const mid = (lo + hi) >> 1; if (cxs[mid] < v) lo = mid + 1; else hi = mid; } return lo; };
  const cys = new Float64Array(ny);
  for (let j = 0; j < ny; j++) cys[j] = (ys[j] + ys[j + 1]) / 2;
  const firstRow = (v) => { let lo = 0, hi = ny; while (lo < hi) { const mid = (lo + hi) >> 1; if (cys[mid] < v) lo = mid + 1; else hi = mid; } return lo; };
  for (const en of locator.entries) {
    // each edge adds its crossing to the rows whose centre line it crosses (half-open in y, as the even-odd test)
    const rows = new Map();
    for (const r of en.rings) for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
      const [xi, yi] = r[i], [xk, yk] = r[k];
      if (yi === yk) continue;
      const lo = Math.min(yi, yk), hi = Math.max(yi, yk);
      for (let j = firstRow(lo); j < ny && cys[j] < hi; j++) {
        const cy = cys[j];
        if ((yi > cy) === (yk > cy)) continue;
        let cuts = rows.get(j);
        if (!cuts) rows.set(j, (cuts = []));
        cuts.push(xi + ((cy - yi) * (xk - xi)) / (yk - yi));
      }
    }
    for (const [j, cuts] of rows) {
      cuts.sort((p, q) => p - q);
      for (let c = 0; c + 1 < cuts.length; c += 2) for (let i = first(cuts[c]); i < nx && cxs[i] < cuts[c + 1]; i++) if (cxs[i] > cuts[c]) label[j * nx + i] = en.id;
    }
  }
  return label;
}

// ---------------------------------------------------------------- rounding noise
/**
 * A ring without the rounding jogs that joined pieces leave on a straight face (a vertex closer than NOISE cm to the
 * segment between its neighbours, i.e. within the kernel's 0.001 cm grid of a straight line). Rect-only rings are unchanged.
 */
export const NOISE = 0.0015;
export function denoise(ring) {
  let pts = ring;
  for (let changed = true; changed && pts.length > 3;) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], p = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (!L) continue;
      const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (L * L)));
      if (Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy) < NOISE) { if (pts === ring) pts = ring.slice(); pts.splice(i, 1); i--; changed = true; }
    }
  }
  return pts;
}
/** faces() output with denoised room rings (outdoor faces are only located in, never output). */
export function denoiseFaces(F) {
  return { outdoor: F.outdoor, rooms: F.rooms.map((r) => ({ ...r, outer: denoise(r.outer), holes: r.holes.map(denoise) })) };
}

// ---------------------------------------------------------------- outline
/**
 * Boundary of the wall material (union of `solids` minus `cuts` = the openings' gaps) as straight segments
 * [x1, y1, x2, y2], each from its west (then north) end, sorted like the grid engine's outline. Jamb lines are included.
 */
export function outlineEdges(solids, cuts) {
  const out = [];
  for (const r0 of rings(difference(solids, cuts))) for (let i = 0, r = denoise(r0); i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    out.push(a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? [a[0], a[1], b[0], b[1]] : [b[0], b[1], a[0], a[1]]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
}

/**
 * The solids of the slants of a level: their joined footprints, the gap quads of their openings, and the same gaps
 * 0.01 cm deeper on each face (`cuts`, to cut the gaps out of the wall material without leaving a hairline sliver
 * along a face where the quad and the footprint meet after rounding).
 */
export function slantSolids(level, openings) {
  const polys = level.list.map((g) => g.poly), quads = [], cuts = [];
  for (const o of openings) {
    if (!isAngledOpening(o)) continue;
    const g = level.byId.get(o.wall);
    if (g && o.width > 0 && Number.isFinite(o.at)) { quads.push(openingQuad(g.s, o.at, o.width)); cuts.push(openingQuad({ ...g.s, t: g.s.t + 0.02 }, o.at, o.width)); }
  }
  return { polys, quads, cuts };
}

// ---------------------------------------------------------------- editing helpers (stage A2)
/*
 * Pure helpers for the editing calls on angled walls (plan-edit.js "angled walls: editing"). Same conventions: u = unit
 * x1 → x2, n = (−uy, ux) = the right ('r') side, `at` = cm from (x1, y1). Centre lines are kept on 0.1 cm.
 */
/** Centre-line precision of an edited slant (cm). */
export const r01 = (v) => Math.round(v * 10) / 10 + 0;
/** Degrees: an angled wall this close to an axis is a rect wall (same tolerance as plan-build). */
export const AXIS_TOL = 0.5;
/** 'h' | 'v' when the centre line (x1, y1) → (x2, y2) is within AXIS_TOL of an axis, else null. */
export function nearAxis(x1, y1, x2, y2) {
  const off = (Math.atan2(Math.abs(y2 - y1), Math.abs(x2 - x1)) * 180) / Math.PI;
  return off <= AXIS_TOL ? 'h' : off >= 90 - AXIS_TOL ? 'v' : null;
}
const cross2 = (ax, ay, bx, by) => ax * by - ay * bx;
/** Intersection of the lines P + s·u and Q + r·v (null when within 5° of parallel). */
export function lineCross(px, py, ux, uy, qx, qy, vx, vy) {
  const cr = cross2(ux, uy, vx, vy), lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
  if (!lu || !lv || Math.abs(cr) < Math.sin((5 * Math.PI) / 180) * lu * lv) return null;
  const s = cross2(qx - px, qy - py, vx, vy) / cr;
  return [px + ux * s, py + uy * s];
}
/** Distance along the ray (px, py) + h·(dx, dy) to where it enters rect r (Infinity if it does not; 0 if it starts inside). */
export function rayRect(px, py, dx, dy, r) {
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, d, lo, hi] of [[px, dx, r.x, r.x + r.w], [py, dy, r.y, r.y + r.h]]) {
    if (Math.abs(d) < 1e-12) { if (p < lo || p > hi) return Infinity; continue; }
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  return t1 < Math.max(t0, 0) ? Infinity : Math.max(t0, 0);
}
/** Distance along the ray to the first crossing of a polygon edge (Infinity if none). */
export function rayPoly(px, py, dx, dy, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length], ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const h = ((ax - px) * ey - (ay - py) * ex) / den, u = ((ax - px) * dy - (ay - py) * dx) / den;
    if (h >= 0 && u >= 0 && u <= 1 && h < best) best = h;
  }
  return best;
}

/**
 * Snap end `k` (0 = (x1, y1), 1 = (x2, y2)) of a slant being drawn / dragged, among the level's other slants and rect
 * solids (walls + rect openings). Returns the point [x, y] (0.1 cm):
 *   1. within 1.5 t (the thicker wall's) of another slant's end → exactly that end point (the two share it);
 *   2. joined as it is (slant-geom: a T onto a slant side, an end on / in a rect — within the join reach t) → as given;
 *   3. else extended along its own direction to the nearest wall face (rect or slant) ahead within 1.5 t;
 *   4. else as given (a free end).
 */
export function snapSlantEnd(s, k, others, rects) {
  const P = k ? [s.x2, s.y2] : [s.x1, s.y1];
  let best = null, bd = Infinity;
  for (const o of others) for (const q of [[o.x1, o.y1], [o.x2, o.y2]]) {
    const d = Math.hypot(q[0] - P[0], q[1] - P[1]);
    if (d <= 1.5 * Math.max(s.t, o.t) && d < bd) { bd = d; best = q; }
  }
  if (best) return [best[0], best[1]];
  const f = slantFrame(s);
  if (!(f.len > 1)) return [r01(P[0]), r01(P[1])];
  const near = nearRects(s, rects);
  const j = slantJoins([s, ...others], near)[0].ends[k];
  if (j.type === 'tee' || j.type === 'rect') return [r01(P[0]), r01(P[1])];
  const dx = k ? f.ux : -f.ux, dy = k ? f.uy : -f.uy, reach = 1.5 * s.t;
  let h = Infinity;
  for (const r of near) { const q = rayRect(P[0], P[1], dx, dy, r); if (q > 1e-9 && q < h) h = q; }
  for (const o of others) { const q = rayPoly(P[0], P[1], dx, dy, freePoly(o)); if (q > 1e-9 && q < h) h = q; }
  return h <= reach ? [r01(P[0] + dx * h), r01(P[1] + dy * h)] : [r01(P[0]), r01(P[1])];
}
/** The rects that can take part in a join of slant s (within 3 t of its free footprint's bounds). */
export function nearRects(s, rects) {
  const m = 3 * Math.max(1, s.t), b = { x: Math.min(s.x1, s.x2) - m, y: Math.min(s.y1, s.y2) - m, w: Math.abs(s.x2 - s.x1) + 2 * m, h: Math.abs(s.y2 - s.y1) + 2 * m };
  return rects.filter((r) => boxHit(r, b));
}

/** Parameter intervals [a0, a1] (cm from (x1, y1), clipped to the centre line) where the centre line runs inside `ring`. */
export function centreIn(s, ring) {
  const f = slantFrame(s);
  return lineIn(s.x1, s.y1, f.ux, f.uy, ring).map(([a, b]) => [Math.max(0, a), Math.min(f.len, b)]).filter(([a, b]) => b > a);
}

/** Smallest distance between two polygons (0 when they overlap or touch). */
export function polyGap(a, b) {
  const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
  if (a.some((p) => inside(p, b)) || b.some((p) => inside(p, a))) return 0;
  const segD = (p, q0, q1) => { const dx = q1[0] - q0[0], dy = q1[1] - q0[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p[0] - q0[0]) * dx + (p[1] - q0[1]) * dy) / L)) : 0; return Math.hypot(p[0] - q0[0] - t * dx, p[1] - q0[1] - t * dy); };
  const cross = (p0, p1, q0, q1) => { const d1 = cross2(p1[0] - p0[0], p1[1] - p0[1], q0[0] - p0[0], q0[1] - p0[1]), d2 = cross2(p1[0] - p0[0], p1[1] - p0[1], q1[0] - p0[0], q1[1] - p0[1]), d3 = cross2(q1[0] - q0[0], q1[1] - q0[1], p0[0] - q0[0], p0[1] - q0[1]), d4 = cross2(q1[0] - q0[0], q1[1] - q0[1], p1[0] - q0[0], p1[1] - q0[1]); return d1 * d2 < 0 && d3 * d4 < 0; };
  let best = Infinity;
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i], a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j], b1 = b[(j + 1) % b.length];
      if (cross(a0, a1, b0, b1)) return 0;
      best = Math.min(best, segD(a0, b0, b1), segD(b0, a0, a1));
    }
  }
  return best;
}

/**
 * Extent along an axis ('h': x, 'v': y) of the part of polygon `poly` inside the band c0 ≤ cross ≤ c1 (y for 'h', x for
 * 'v'): [min, max], or null when the polygon does not enter the band.
 */
export function bandExtent(poly, axis, c0, c1) {
  const A = axis === 'h' ? 0 : 1, C = 1 - A;
  let p = poly;
  for (const [lim, sg] of [[c0, 1], [c1, -1]]) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], da = (a[C] - lim) * sg, db = (b[C] - lim) * sg;
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { const k = da / (da - db); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
    }
    p = out;
    if (!p.length) return null;
  }
  let lo = Infinity, hi = -Infinity;
  for (const q of p) { if (q[A] < lo) lo = q[A]; if (q[A] > hi) hi = q[A]; }
  return hi > lo ? [lo, hi] : null;
}

/** Number of pieces left when a room shrinks by `half` cm (0: nothing that wide; > 1: a neck narrower than 2·half). */
export const clearPieces = (polygon, half) => polyOffset([{ polygon }], -half).length;

/**
 * Free stretches of an angled wall where an opening can sit: the parts of the centre line where BOTH faces border open
 * space (segment `faces`), as [[a0, a1]…] in cm from (x1, y1).
 */
export function bothFaces(faces) {
  const out = [];
  for (const [p, q] of faces.l) for (const [r, s] of faces.r) { const a = Math.max(p, r), b = Math.min(q, s); if (b > a) out.push([a, b]); }
  return out.sort((x, y) => x[0] - y[0]);
}
/**
 * Allowed ranges of the CENTRE `at` of an opening of `width` in a wall with free stretches `free` and other openings
 * `taken` ([[a0, a1]…] gap extents): ≥ jamb cm of wall on both faces beside it and between it and every other opening.
 */
export function openingRanges(free, taken, width, jamb) {
  const half = width / 2 + jamb;
  // centre ranges allowed by the free stretches, minus the centres forbidden by each other opening
  let ranges = free.map(([p, q]) => [p + half, q - half]).filter(([a, b]) => b >= a - EPS);
  for (const [a0, a1] of taken) {
    const f0 = a0 - half, f1 = a1 + half, next = [];
    for (const [a, b] of ranges) {
      if (f1 <= a + EPS || f0 >= b - EPS) { next.push([a, b]); continue; }
      if (f0 >= a - EPS) next.push([a, f0]);
      if (f1 <= b + EPS) next.push([f1, b]);
    }
    ranges = next.filter(([a, b]) => b >= a - EPS);
  }
  return ranges;
}
