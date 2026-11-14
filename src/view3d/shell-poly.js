/**
 * The shell of a level WITH ANGLED WALLS (stage A4 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md) — the general builder.
 * house.js keeps its irregular-grid builder for every level without slants (House 98 and every orthogonal plan are
 * byte-identical); a level with ≥ 1 slant is built here, the WHOLE level (rect walls too), so there is no seam between
 * two builders. Units: plan cm in, metres out (X = x / 100, Z = y / 100, Y up, the level's finished floor at Y = 0).
 *
 * How it is built
 * ---------------
 *   solid footprint  R = rect walls ∪ joined slant footprints (geometry.js slantPolys) ∪ every opening's gap polygon
 *                    (openingPoly: a rect, or the gap quad through a slant) — the plan engine's own solids, with the
 *                    polygon kernel (exact on the 0.001 cm grid);
 *   height bands     cut at 0, every sill and head, the soft-shading heights and the top (ceiling or cut-away height);
 *                    in a band the solid region is R minus the gaps that are open at that height (cached per set);
 *   vertical faces   every boundary edge of a band's region → one quad per band (u = metres along the edge, v = height,
 *                    the same texture scale as the grid builder), outward normal from the ring orientation (solid on the
 *                    right of each kernel ring), material from the space on its free side — sampled 1 cm out from the
 *                    middle of the piece: a room → `room:<id>` (its wall finish), outdoors → `ext`, an open gap → a
 *                    reveal, split at the frame plane like the grid (room side → that room, outer side → exterior);
 *   horizontal faces where two bands differ: sill tops (up) and lintel undersides (down), split at the frame plane; the
 *                    wall caps at the top (the cut-away section) and the foot at Y = 0 (down, never seen) close the solid;
 *   conformity       every edge is split at every vertex of every band / piece that lies on it (and every triangle
 *                    edge too), so the shell is one closed 2-manifold: each edge is shared by exactly two triangles
 *                    (tests/slants-3d.test.mjs) — no cracks, no internal faces, no z-fighting where slants meet rects.
 *   floors           each room's exact polygon (+ its door thresholds, − stair voids), triangulated; ceilings over the
 *                    rooms and the wall heads (− the voids of the level above);
 *   skirting, shade  along every room face that reaches the floor (any angle): mitred boards (dry rooms, stopped at doors)
 *                    and the baked contact-shading strips (mitred in room corners, inset at wall ends and doors);
 *   plinth           the outdoor-facing edges of R offset by 8 mm (ground level only).
 */
import * as THREE from 'three';
import { union, difference, offset } from '../core/polykernel.js';
import { slantPolys, openingFrame, openingPoly, openingPoint, pointInPolygon } from '../core/geometry.js';
import { Soup, openingFrame as frameAcross } from './openings.js';

const Q = 1000;                                           // the polygon kernel's grid (0.001 cm)
const snap = (v) => Math.round(v * Q) / Q;
const TOL = 0.0025;                                       // cm: a vertex this close to an edge lies on it
const PLINTH_PROUD = 0.8;                                 // cm (as house.js)

/** Does a level view have angled walls (→ this builder)? */
export const hasSlants = (plan) => !!plan && Array.isArray(plan.slants) && plan.slants.length > 0;

/** Space at a plan point: { mat: 'room:<id>' | 'ext', room } — rooms by their exact polygons. */
function spaceMat(rooms, x, y) {
  for (const r of rooms) if (pointInPolygon(x, y, r.polygon)) return { mat: 'room:' + r.id, room: r };
  return { mat: 'ext', room: null };
}

/**
 * Everything of a level that does not depend on the view state (cut-away height, ceiling): the solid footprint, the
 * openings with their gap polygons, frame planes and side materials, and a cache of band regions. Built once per plan
 * revision (house.js readPlan()).
 */
export function preparePolyLevel(plan) {
  const rooms = (plan.rooms || []).filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3);
  const solids = [...plan.walls.filter((w) => w.w > 0 && w.h > 0).map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h })), ...slantPolys(plan)];
  const ops = [];
  for (const o of plan.openings || []) {
    if (!(o.width > 0) || !(o.height > 0)) continue;
    const poly = openingPoly(o, plan).map(([x, y]) => [snap(x), snap(y)]);
    if (poly.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
    const F = openingFrame(o, plan), A = frameAcross(o, plan), off = F.T / 2 + 1;
    const sill = (o.sill || 0) / 100, head = sill + o.height / 100;
    // what is cut out where the gap is open: the gap through the wall, 0.05 cm proud of both faces (outside the wall, so
    // nothing more is removed, and no rounding sliver of the face can survive along an angled gap)
    const cut = [[0, -0.05], [F.L, -0.05], [F.L, F.T + 0.05], [0, F.T + 0.05]].map(([u, v]) => openingPoint(F, u, v)).map(([x, y]) => [snap(x), snap(y)]);
    ops.push({
      o, poly, cut, F, plane: A.plane, sill, head,
      lowMat: spaceMat(rooms, F.cx - F.nx * off, F.cy - F.ny * off).mat, highMat: spaceMat(rooms, F.cx + F.nx * off, F.cy + F.ny * off).mat,
    });
  }
  const full = union([solids, ops.map((p) => p.poly)]);
  const regions = new Map();
  /** Solid region (expolygons) with the gaps of `open` (indexes into ops) cut out. */
  const regionFor = (open) => {
    const key = open.join(',');
    if (!regions.has(key)) regions.set(key, open.length ? difference(full, open.map((i) => ops[i].cut)) : full);
    return regions.get(key);
  };
  return { plan, rooms, ops, full, regionFor };
}

/** Height bands (m) from 0 to `top`: cut at sills, heads and the soft-shading heights; `open` = ops whose gap is open. */
function bandsOf(geo, top, ceiling, fade) {
  const ys = [0, top];
  for (const p of geo.ops) for (const y of [p.sill, p.head]) ys.push(y);
  ys.push(fade, ceiling - fade);
  const cut = [...new Set(ys.filter((y) => y >= 0 && y <= top))].sort((a, b) => a - b).filter((y, i, a) => i === 0 || y - a[i - 1] > 1e-6);
  const bands = [];
  for (let i = 0; i < cut.length - 1; i++) {
    const y0 = cut[i], y1 = cut[i + 1], ym = (y0 + y1) / 2;
    const open = [];
    geo.ops.forEach((p, k) => { if (ym > p.sill && ym < p.head) open.push(k); });
    bands.push({ y0, y1, open });
  }
  return bands;
}

const WELD = 0.02;                                       // cm: vertices this close are one (kernel rounding jogs, ≤ 0.2 mm)
/**
 * Point set with welding and "points on a segment" queries (the conformity splits). Vertices of different kernel
 * results that should coincide can differ by a rounding step (0.001 cm): `canon` maps every vertex to one
 * representative within WELD, so all faces use the very same numbers.
 */
class PointSet {
  constructor() { this.grid = new Map(); this.all = []; this.list = null; }
  canon(x, y) {
    const gx = Math.floor(x / (2 * WELD)), gy = Math.floor(y / (2 * WELD));
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const cell = this.grid.get((gx + i) + ',' + (gy + j));
      if (cell) for (const p of cell) if (Math.abs(p[0] - x) <= WELD && Math.abs(p[1] - y) <= WELD) return p;
    }
    const p = [x, y], k = gx + ',' + gy;
    if (!this.grid.has(k)) this.grid.set(k, []);
    this.grid.get(k).push(p); this.all.push(p); this.list = null;
    return p;
  }
  addRings(expolys) { for (const e of expolys) for (const r of [e.outer, ...e.holes]) for (const p of r) this.canon(p[0], p[1]); }
  /** Expolygons with every vertex replaced by its representative (consecutive duplicates dropped). */
  canonical(expolys) {
    const ring = (r) => {
      const out = [];
      for (const p of r) { const c = this.canon(p[0], p[1]); if (out[out.length - 1] !== c) out.push(c); }
      if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
      for (let i = 0; out.length >= 3 && i < out.length;) {             // a notch welded shut leaves a spike a → b → a
        const n = out.length, a = out[(i + n - 1) % n], b = out[(i + 1) % n];
        if (a === b) { out.splice(i, 1); out.splice(i % out.length, 1); i = Math.max(0, i - 1); } else i++;
      }
      return out;
    };
    return expolys.map((e) => ({ outer: ring(e.outer), holes: e.holes.map(ring).filter((h) => h.length >= 3) })).filter((e) => e.outer.length >= 3);
  }
  sorted() { if (!this.list) this.list = this.all.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); return this.list; }
  /** Points strictly inside segment a→b (within TOL of it), ordered from a. */
  on(a, b) {
    const L = this.sorted(), x0 = Math.min(a[0], b[0]) - TOL, x1 = Math.max(a[0], b[0]) + TOL, y0 = Math.min(a[1], b[1]) - TOL, y1 = Math.max(a[1], b[1]) + TOL;
    let lo = 0, hi = L.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (L[m][0] < x0) lo = m + 1; else hi = m; }
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), out = [];
    if (len < 1e-9) return out;
    for (let i = lo; i < L.length && L[i][0] <= x1; i++) {
      const p = L[i];
      if (p === a || p === b || p[1] < y0 || p[1] > y1) continue;
      const s = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len;
      if (s < TOL || s > len - TOL) continue;
      if (Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len > TOL) continue;
      out.push([s, p]);
    }
    return out.sort((p, q) => p[0] - q[0]).map((e) => e[1]);
  }
}
/** Does p lie on segment a–b (strictly inside, within TOL)? */
function onSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (len < 1e-9 || p === a || p === b) return false;
  const s = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len;
  return s > TOL && s < len - TOL && Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len <= TOL;
}

/** Ring edges of expolygons with direction, outward normal (solid on the right of a kernel ring) and neighbours. */
function ringEdges(expolys) {
  const out = [];
  for (const e of expolys) for (const ring of [e.outer, ...e.holes]) {
    const n = ring.length, edges = [];
    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-9) continue;
      const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
      edges.push({ p, q, len, ux, uy, ox: uy, oy: -ux });
    }
    edges.forEach((ed, i) => { ed.prev = edges[(i + edges.length - 1) % edges.length]; ed.next = edges[(i + 1) % edges.length]; });
    out.push(edges);
  }
  return out;
}

/** u (m) along an edge direction in a fixed orientation: plain x for an east–west edge, y for a north–south one. */
function uAxis(ux, uy) { return ux > 1e-9 || (Math.abs(ux) <= 1e-9 && uy > 0) ? [ux, uy] : [-ux, -uy]; }

/** Where segment a–b crosses the line p·n = c (computed in a canonical order: the same numbers from either side). */
function crossing(a, b, nx, ny, c) {
  const [P, R] = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? [a, b] : [b, a];
  const fP = P[0] * nx + P[1] * ny - c, fR = R[0] * nx + R[1] * ny - c, t = fP / (fP - fR);
  return [P[0] + (R[0] - P[0]) * t, P[1] + (R[1] - P[1]) * t];
}

/** Clip a ring to the half-plane p·n ≥ c (keep = 1) or ≤ c (keep = −1); kept vertices are the ring's own objects. */
function clipHalf(ring, nx, ny, c, keep) {
  const out = [], f = (p) => keep * (p[0] * nx + p[1] * ny - c);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa > 0 && fb < 0) || (fa < 0 && fb > 0)) out.push(crossing(a, b, nx, ny, c));
  }
  return out.length >= 3 ? out : null;
}

/**
 * Triangles of a polygon with holes (cm rings), each triangle edge split at the points of `V` on it (fans), so the
 * horizontal faces share every edge with the vertical ones. `fn(a, b, c)` gets plan points [x, y].
 */
function triangles(outer, holes, V, fn) {
  if (V) { outer = V.canonical([{ outer, holes: [] }])[0]?.outer; holes = holes.map((h) => V.canonical([{ outer: h, holes: [] }])[0]?.outer).filter(Boolean); if (!outer) return; }
  const v2 = (r) => r.map(([x, y]) => new THREE.Vector2(x, y));
  const contour = v2(outer), hv = holes.map(v2), all = [...outer, ...holes.flat()];
  const faces = THREE.ShapeUtils.triangulateShape(contour, hv);
  const emit = (a, b, c, depth) => {
    if (a === b || b === c || a === c) return;
    // a sliver whose apex lies on the opposite edge: its neighbour across that edge is split there instead
    if (V && (onSeg(c, a, b) || onSeg(a, b, c) || onSeg(b, c, a))) return;
    if (depth < 12) {
      for (const [p, q, r] of [[a, b, c], [b, c, a], [c, a, b]]) {
        const pts = V ? V.on(p, q) : [];
        if (!pts.length) continue;
        const chain = [p, ...pts, q];
        for (let i = 0; i < chain.length - 1; i++) emit(chain[i], chain[i + 1], r, depth + 1);
        return;
      }
    }
    fn(a, b, c);
  };
  for (const [i, j, k] of faces) emit(all[i], all[j], all[k], 0);
}

/**
 * Walls of a mixed level → material soups, plus the contact-shade strips — the same output as house.js buildShellSoups.
 * @param {object} geo preparePolyLevel(plan)
 * @param {{ top: number, ceiling: number, plinthDepth: number|null, dryRooms: Set<string>, K: object }} o
 *   top = the walls' top (ceiling or cut-away, m); K = { Strips, wallShade, SKIRT_H, SKIRT_T, AO_FLOOR, AO_CEILING, WALL_FADE }
 * @returns {{ soups: Map<string, Soup>, aoFloor, aoCeiling, stats: { skirting: Map<string, number>, bands: number } }}
 */
export function buildPolyShell(geo, { top, ceiling, plinthDepth, dryRooms, K }) {
  const soups = new Map(), aoFloor = new K.Strips(), aoCeiling = new K.Strips();
  const soup = (key) => { if (!soups.has(key)) soups.set(key, new Soup()); return soups.get(key); };
  const stats = { skirting: new Map(), bands: 0 };
  if (!(top > 1e-6)) return { soups, aoFloor, aoCeiling, stats };
  const bands = bandsOf(geo, top, ceiling, K.WALL_FADE);
  stats.bands = bands.length;
  const regs = bands.map((b) => geo.regionFor(b.open));

  // horizontal pieces between bands (sill tops / lintel undersides), the foot and the cap
  const horiz = [{ y: 0, up: false, polys: regs[0], cap: true }];
  for (let k = 1; k < bands.length; k++) {
    if (regs[k] === regs[k - 1]) continue;
    const y = bands[k].y0;
    horiz.push({ y, up: true, polys: difference(regs[k - 1], regs[k]) }, { y, up: false, polys: difference(regs[k], regs[k - 1]) });
  }
  horiz.push({ y: top, up: true, polys: regs[regs.length - 1], cap: true });

  // every vertex of every band and piece, + the frame-plane points on the reveals
  const V = new PointSet();
  for (const r of new Set(regs)) V.addRings(r);
  for (const h of horiz) V.addRings(h.polys);
  const ringsOf = new Map();                                // region → its ring edges on the welded vertices (computed once)
  const edgesOf = (r) => { if (!ringsOf.has(r)) ringsOf.set(r, ringEdges(V.canonical(r))); return ringsOf.get(r); };
  /** What an edge piece (mid point m, outward o) faces in band b: an open gap (reveal) or a space. */
  const facing = (b, mx, my, ox, oy) => {
    const sx = mx + ox, sy = my + oy;
    for (const k of b.open) if (pointInPolygon(sx, sy, geo.ops[k].poly)) return { op: geo.ops[k] };
    return spaceMat(geo.rooms, sx, sy);
  };
  bands.forEach((b, k) => {
    for (const ring of edgesOf(regs[k])) for (const e of ring) {
      const f = facing(b, (e.p[0] + e.q[0]) / 2, (e.p[1] + e.q[1]) / 2, e.ox, e.oy);
      if (!f.op) continue;
      const n = [f.op.F.nx, f.op.F.ny], fp = e.p[0] * n[0] + e.p[1] * n[1] - f.op.plane, fq = e.q[0] * n[0] + e.q[1] * n[1] - f.op.plane;
      if (!((fp > TOL && fq < -TOL) || (fp < -TOL && fq > TOL))) continue;
      const x = crossing(e.p, e.q, n[0], n[1], f.op.plane);
      V.canon(snap(x[0]), snap(x[1]));
    }
  });

  // ── vertical faces ──
  const shadeOf = (mat, y) => (mat.startsWith('room:') ? K.wallShade(y, ceiling) : 1);
  const floorEdges = [], ceilingEdges = [];                // ring edges of the bottom / top band with their materials
  bands.forEach((b, k) => {
    const isFloor = k === 0, isTop = k === bands.length - 1;
    for (const ring of edgesOf(regs[k])) {
      const keep = [];
      for (const e of ring) {
        const [ax, ay] = uAxis(e.ux, e.uy), chain = [e.p, ...V.on(e.p, e.q), e.q];
        const n = [e.ox, 0, e.oy];
        const mats = new Set();
        for (let i = 0; i < chain.length - 1; i++) {
          const p = chain[i], q = chain[i + 1], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
          const f = facing(b, mx, my, e.ox, e.oy);
          const mat = f.op ? ((mx * f.op.F.nx + my * f.op.F.ny) < f.op.plane ? f.op.lowMat : f.op.highMat) : f.mat;
          mats.add(f.op ? 'reveal' : mat);
          const up = (p[0] * ax + p[1] * ay) / 100, uq = (q[0] * ax + q[1] * ay) / 100;
          const P = [p[0] / 100, b.y0, p[1] / 100], Qp = [q[0] / 100, b.y0, q[1] / 100], Q1 = [q[0] / 100, b.y1, q[1] / 100], P1 = [p[0] / 100, b.y1, p[1] / 100];
          soup(mat).quad([P, Qp, Q1, P1], n, [[up, b.y0], [uq, b.y0], [uq, b.y1], [up, b.y1]], [shadeOf(mat, b.y0), shadeOf(mat, b.y0), shadeOf(mat, b.y1), shadeOf(mat, b.y1)]);
        }
        keep.push({ ...e, mat: mats.has('reveal') ? 'reveal' : mats.size === 1 ? [...mats][0] : '' });
      }
      keep.forEach((e, i) => { e.prev = keep[(i + keep.length - 1) % keep.length]; e.next = keep[(i + 1) % keep.length]; });
      if (isFloor) floorEdges.push(keep);
      if (isTop) ceilingEdges.push(keep);
    }
  });

  // ── horizontal faces ──
  for (const h of horiz) {
    const n = [0, h.up ? 1 : -1, 0];
    const put = (mat, outer, holes) => triangles(outer, holes, V, (a, b, c) => soup(mat).tri(
      [a[0] / 100, h.y, a[1] / 100], [b[0] / 100, h.y, b[1] / 100], [c[0] / 100, h.y, c[1] / 100], n,
      [[a[0] / 100, a[1] / 100], [b[0] / 100, b[1] / 100], [c[0] / 100, c[1] / 100]]));
    for (const e of h.polys) {
      if (h.cap) { put('cap', e.outer, e.holes); continue; }
      const cx = e.outer.reduce((s, p) => s + p[0], 0) / e.outer.length, cy = e.outer.reduce((s, p) => s + p[1], 0) / e.outer.length;
      const op = geo.ops.find((p) => pointInPolygon(cx, cy, p.poly));
      if (!op) { put('cap', e.outer, e.holes); continue; }
      for (const [keep, mat] of [[-1, op.lowMat], [1, op.highMat]]) {
        const part = clipHalf(e.outer, op.F.nx, op.F.ny, op.plane, keep);
        if (part) put(mat, part.map((p) => (e.outer.includes(p) ? p : [snap(p[0]), snap(p[1])])), []);
      }
    }
  }

  // ── skirting boards and contact-shade strips along the room faces ──
  const isRoom = (e) => e && typeof e.mat === 'string' && e.mat.startsWith('room:');
  const turn = (a, b) => a.ux * b.uy - a.uy * b.ux;              // < 0: a room corner (concave), > 0: a wall end (convex)
  const mitre = (p, e1, e2, d) => {                              // point d out from both faces at their corner p
    const ox = e1.ox + e2.ox, oy = e1.oy + e2.oy, k = 1 + e1.ox * e2.ox + e1.oy * e2.oy;
    return k > 0.3 ? [p[0] + (d * ox) / k, p[1] + (d * oy) / k] : null;
  };
  const strips = (edgesList, S, y, cfg, up) => {
    const w = cfg.width * 100;
    for (const ring of edgesList) for (const e of ring) {
      if (!isRoom(e)) continue;
      const ends = [[e.p, e.prev, -1], [e.q, e.next, 1]].map(([pt, nb, s]) => {
        const t = s < 0 ? turn(nb, e) : turn(e, nb);
        if (nb.mat === e.mat && Math.abs(t) < 1e-6) return [pt[0] + e.ox * w, pt[1] + e.oy * w];
        if (nb.mat === e.mat && t < 0) { const m = s < 0 ? mitre(pt, nb, e, w) : mitre(pt, e, nb, w); if (m) return m; }
        return [pt[0] + e.ox * w - s * e.ux * w, pt[1] + e.oy * w - s * e.uy * w];
      });
      const along = (q) => (q[0] - e.p[0]) * e.ux + (q[1] - e.p[1]) * e.uy;
      if (along(ends[1]) - along(ends[0]) < 2) continue;
      const P = (q) => [q[0] / 100, y, q[1] / 100];
      S.add(P(e.p), P(e.q), P(ends[1]), P(ends[0]), cfg.alpha, up);
    }
  };
  strips(floorEdges, aoFloor, 0.003, K.AO_FLOOR, true);
  if (top >= ceiling - 1e-6) strips(ceilingEdges, aoCeiling, ceiling - 0.005, K.AO_CEILING, false);

  {
    const T = K.SKIRT_T * 100, H = K.SKIRT_H, sk = soup('skirting');
    for (const ring of floorEdges) for (const e of ring) {
      if (!isRoom(e) || !dryRooms.has(e.mat.slice(5))) continue;
      const end = (pt, nb, s) => (nb.mat === e.mat ? (s < 0 ? mitre(pt, nb, e, T) : mitre(pt, e, nb, T)) : null);
      const f0 = end(e.p, e.prev, -1), f1 = end(e.q, e.next, 1);
      const a = e.p, b = e.q, af = f0 || [a[0] + e.ox * T, a[1] + e.oy * T], bf = f1 || [b[0] + e.ox * T, b[1] + e.oy * T];
      const M = (q, y) => [q[0] / 100, y, q[1] / 100];
      const L = e.len / 100, la = ((af[0] - a[0]) * e.ux + (af[1] - a[1]) * e.uy) / 100, lb = L + ((bf[0] - b[0]) * e.ux + (bf[1] - b[1]) * e.uy) / 100;
      sk.quad([M(a, H), M(b, H), M(bf, H), M(af, H)], [0, 1, 0], [[0, 0], [L, 0], [lb, K.SKIRT_T], [la, K.SKIRT_T]]);
      sk.quad([M(af, 0), M(bf, 0), M(bf, H), M(af, H)], [e.ox, 0, e.oy], [[la, 0], [lb, 0], [lb, H], [la, H]]);
      if (!f0) sk.quad([M(a, 0), M(af, 0), M(af, H), M(a, H)], [-e.ux, 0, -e.uy], [[0, 0], [K.SKIRT_T, 0], [K.SKIRT_T, H], [0, H]]);
      if (!f1) sk.quad([M(b, 0), M(bf, 0), M(bf, H), M(b, H)], [e.ux, 0, e.uy], [[0, 0], [K.SKIRT_T, 0], [K.SKIRT_T, H], [0, H]]);
      const id = e.mat.slice(5);
      stats.skirting.set(id, (stats.skirting.get(id) || 0) + e.len);
    }
  }

  // ── plinth (ground level): the outdoor-facing edges of the footprint, 8 mm proud ──
  if (plinthDepth != null) {
    for (const ring of ringEdges(offset(geo.full, PLINTH_PROUD, { join: 'miter' }))) for (const e of ring) {
      const mx = (e.p[0] + e.q[0]) / 2 + e.ox, my = (e.p[1] + e.q[1]) / 2 + e.oy;
      if (spaceMat(geo.rooms, mx, my).room) continue;
      const [ax, ay] = uAxis(e.ux, e.uy), up = (e.p[0] * ax + e.p[1] * ay) / 100, uq = (e.q[0] * ax + e.q[1] * ay) / 100, y0 = -plinthDepth, y1 = 0.012;
      soup('plinth').quad([[e.p[0] / 100, y0, e.p[1] / 100], [e.q[0] / 100, y0, e.q[1] / 100], [e.q[0] / 100, y1, e.q[1] / 100], [e.p[0] / 100, y1, e.p[1] / 100]],
        [e.ox, 0, e.oy], [[up, y0], [uq, y0], [uq, y1], [up, y1]]);
    }
  }
  return { soups, aoFloor, aoCeiling, stats };
}

/**
 * Floors (one soup per room: its exact polygon + its door thresholds − the stair voids of this level) and the ceiling
 * (rooms + wall heads − the voids of the level above), at Y = 0 like house.js buildFloorSoups.
 */
export function buildPolyFloors(geo, floorHoles = null, ceilingHoles = null) {
  const { rooms, ops } = geo;
  const ids = new Set(rooms.map((r) => r.id));
  const floors = new Map(rooms.map((r) => [r.id, new Soup()]));
  const ceilings = new Soup();
  const flat = (soup, polys, ny) => {
    for (const e of polys) triangles(e.outer, e.holes, null, (a, b, c) => soup.tri([a[0] / 100, 0, a[1] / 100], [b[0] / 100, 0, b[1] / 100], [c[0] / 100, 0, c[1] / 100], [0, ny, 0],
      [[a[0] / 100, a[1] / 100], [b[0] / 100, b[1] / 100], [c[0] / 100, c[1] / 100]]));
  };
  const thresholds = new Map();
  for (const p of ops) {
    if (p.o.sill > 0) continue;
    const id = (p.o.rooms || []).find((r) => ids.has(r));
    if (id) { if (!thresholds.has(id)) thresholds.set(id, []); thresholds.get(id).push(p.poly); }
  }
  for (const r of rooms) {
    let polys = union([{ polygon: r.polygon }, ...(thresholds.get(r.id) || [])]);
    if (floorHoles && floorHoles.length) polys = difference(polys, floorHoles);
    flat(floors.get(r.id), polys, 1);
  }
  let top = union([...rooms.map((r) => ({ polygon: r.polygon })), geo.full]);
  if (ceilingHoles && ceilingHoles.length) top = difference(top, ceilingHoles);
  flat(ceilings, top, -1);
  return { floors, ceilings };
}
