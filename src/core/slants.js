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
import { joinSlants, slantJoins, slantFrame, openingQuad } from './slant-geom.js';
import { difference, rings } from './polykernel.js';

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
