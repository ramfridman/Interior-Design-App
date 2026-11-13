/**
 * Geometry helpers for the regulation checks. Pure functions; plan space (cm, +x east, +y south).
 */
import { polygonBounds, pointInPolygon, DEG } from '../core/geometry.js';

export const rectPoly = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
export const m = (cm, digits = 2) => (cm / 100).toFixed(digits);
export const cmStr = (cm) => `${Math.round(cm)} cm`;
export const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const REV = new WeakMap();
const REV_KEYS = ['walls', 'openings', 'rooms', 'wallOutline', 'outdoorAreas', 'site', 'bounds', 'heights', 'assumptions', 'meta'];
/**
 * Revision number of a plan, for caches. The `plan` object stays the same when the owner edits it — plan-edit.js
 * REPLACES `plan.walls / openings / rooms / wallOutline` with new arrays — so everything cached "per plan" must be
 * keyed on this number, which goes up whenever one of the plan's parts is a different object than last time.
 * Costs ten identity comparisons; never changes while nothing was replaced.
 */
export function planRev(plan) {
  let s = REV.get(plan);
  if (!s) { s = { rev: 0, parts: [] }; REV.set(plan, s); }
  let same = s.rev > 0;
  for (let i = 0; i < REV_KEYS.length && same; i++) same = s.parts[i] === plan[REV_KEYS[i]];
  if (!same) { s.rev++; s.parts = REV_KEYS.map((k) => plan[k]); }
  return s.rev;
}

/** Distance from point p to segment ab. */
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Distance from a point to the outline of a polygon. */
export function pointPolyEdgeDist(px, py, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const d = segDist(px, py, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return best;
}

const segsCross = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
};

/** Minimum distance between two filled polygons (0 when they touch or overlap). */
export function polyDist(A, B) {
  for (const p of A) if (pointInPolygon(p[0], p[1], B)) return 0;
  for (const p of B) if (pointInPolygon(p[0], p[1], A)) return 0;
  let best = Infinity;
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i], a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const b1 = B[j], b2 = B[(j + 1) % B.length];
      if (segsCross(a1, a2, b1, b2)) return 0;
      best = Math.min(best, segDist(a1[0], a1[1], b1[0], b1[1], b2[0], b2[1]), segDist(b1[0], b1[1], a1[0], a1[1], a2[0], a2[1]));
    }
  }
  return best;
}

/** True when every vertex of `poly` lies inside `outer` (with a tolerance in cm). */
export function polyInside(poly, outer, tol = 0) {
  return poly.every(([x, y]) => pointInPolygon(x, y, outer) || pointPolyEdgeDist(x, y, outer) <= tol);
}

/** Largest distance by which a vertex of `poly` lies outside `outer` (0 when fully inside). */
export function overshoot(poly, outer) {
  let worst = 0;
  for (const [x, y] of poly) if (!pointInPolygon(x, y, outer)) worst = Math.max(worst, pointPolyEdgeDist(x, y, outer));
  return worst;
}

/**
 * Local frame of one side of an item: origin at the middle of that face, `u` pointing away from the item,
 * `v` along the face, `hw` half the face length. Sides: 'front' (+y local), 'back', 'left' (−x), 'right' (+x).
 */
export function faceFrame(it, side) {
  const c = Math.cos((it.rot || 0) * DEG), s = Math.sin((it.rot || 0) * DEG);
  const ex = [c, s], ey = [-s, c];
  const hw = it.w / 2, hd = it.d / 2;
  if (side === 'front') return { o: [it.x + ey[0] * hd, it.y + ey[1] * hd], u: ey, v: ex, hw };
  if (side === 'back') return { o: [it.x - ey[0] * hd, it.y - ey[1] * hd], u: [-ey[0], -ey[1]], v: ex, hw };
  if (side === 'right') return { o: [it.x + ex[0] * hw, it.y + ex[1] * hw], u: ex, v: ey, hw: hd };
  return { o: [it.x - ex[0] * hw, it.y - ex[1] * hw], u: [-ex[0], -ex[1]], v: ey, hw: hd };
}

/** Plan-space name of the direction a unit vector points to. */
export function compass([x, y]) {
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'east' : 'west';
  return y > 0 ? 'south' : 'north';
}

function clipHalf(pts, axis, limit, keepGreater) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const pin = keepGreater ? p[axis] >= limit : p[axis] <= limit;
    const qin = keepGreater ? q[axis] >= limit : q[axis] <= limit;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (limit - p[axis]) / (q[axis] - p[axis]);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}

/**
 * Free depth in front of a face: sweeps a strip (the face width, optionally a sub-range `a0..a1` along the face)
 * outwards up to `max` cm and returns { depth, hit } — the distance to the first obstacle and that obstacle.
 * Obstacles: [{ poly, bb, ... }].
 */
export function freeDepth(frame, max, obstacles, { inset = 3, a0 = -frame.hw, a1 = frame.hw, skip } = {}) {
  const { o, u, v } = frame;
  const lo = a0 + inset, hi = a1 - inset;
  // bounding box of the strip, for a quick reject
  const xs = [], ys = [];
  for (const a of [lo, hi]) for (const b of [0, max]) { xs.push(o[0] + v[0] * a + u[0] * b); ys.push(o[1] + v[1] * a + u[1] * b); }
  const sx0 = Math.min(...xs), sx1 = Math.max(...xs), sy0 = Math.min(...ys), sy1 = Math.max(...ys);
  let depth = max, hit = null;
  for (const ob of obstacles) {
    if (skip && skip(ob)) continue;
    const bb = ob.bb;
    if (bb.x > sx1 || bb.x + bb.w < sx0 || bb.y > sy1 || bb.y + bb.h < sy0) continue;
    let pts = ob.poly.map(([x, y]) => [(x - o[0]) * v[0] + (y - o[1]) * v[1], (x - o[0]) * u[0] + (y - o[1]) * u[1]]);
    pts = clipHalf(pts, 0, lo, true); if (pts.length < 3) continue;
    pts = clipHalf(pts, 0, hi, false); if (pts.length < 3) continue;
    pts = clipHalf(pts, 1, 0, true); if (pts.length < 3) continue;
    pts = clipHalf(pts, 1, depth, false); if (pts.length < 3) continue;
    let mn = Infinity, mxA = -Infinity, mnA = Infinity;
    for (const p of pts) { if (p[1] < mn) mn = p[1]; if (p[0] > mxA) mxA = p[0]; if (p[0] < mnA) mnA = p[0]; }
    if (mxA - mnA < 0.5) continue;                       // sliver touching the strip edge
    if (mn < depth) { depth = Math.max(0, mn); hit = ob; }
  }
  return { depth, hit };
}

/** Obstacle record for a plan rectangle. */
export const rectObstacle = (r, extra) => ({ poly: rectPoly(r), bb: { x: r.x, y: r.y, w: r.w, h: r.h }, ...extra });

/** Quarter-circle swept by a hinged door leaf, as a convex polygon; null for sliding doors / windows. */
export function doorSwing(o) {
  if (o.kind !== 'door' || !o.hinge || !o.swing) return null;
  let hx, hy, closed, open;
  if (o.axis === 'v') {
    hy = o.hinge === 'n' ? o.y : o.y + o.h; closed = [0, o.hinge === 'n' ? 1 : -1];
    hx = o.swing === 'w' ? o.x : o.x + o.w; open = [o.swing === 'w' ? -1 : 1, 0];
  } else {
    hx = o.hinge === 'w' ? o.x : o.x + o.w; closed = [o.hinge === 'w' ? 1 : -1, 0];
    hy = o.swing === 'n' ? o.y : o.y + o.h; open = [0, o.swing === 'n' ? -1 : 1];
  }
  const R = o.width, poly = [[hx, hy]];
  for (let a = 0; a <= 90; a += 15) {
    const ca = Math.cos(a * DEG), sa = Math.sin(a * DEG);
    poly.push([hx + R * (ca * closed[0] + sa * open[0]), hy + R * (ca * closed[1] + sa * open[1])]);
  }
  return poly;
}

/**
 * The two sides of an opening: for each, the outward unit normal, a probe point `dist` cm beyond the wall face
 * and the approach rectangle (`depth` cm deep across the opening width).
 */
export function openingSides(o, depth = 60, dist = 20) {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  const sides = [];
  for (const sgn of [-1, 1]) {
    if (o.axis === 'v') {
      const face = sgn < 0 ? o.x : o.x + o.w;
      sides.push({ n: [sgn, 0], probe: [face + sgn * dist, cy], rect: { x: sgn < 0 ? face - depth : face, y: o.y, w: depth, h: o.h } });
    } else {
      const face = sgn < 0 ? o.y : o.y + o.h;
      sides.push({ n: [0, sgn], probe: [cx, face + sgn * dist], rect: { x: o.x, y: sgn < 0 ? face - depth : face, w: o.w, h: depth } });
    }
  }
  return sides;
}

// ───────────────────────── raster grid for route checks ─────────────────────────

/** Grid of `cell`-cm squares over `bounds`; `free[i]` = 1 where a person may stand. */
export function makeGrid(bounds, cell) {
  const nx = Math.ceil(bounds.w / cell), ny = Math.ceil(bounds.h / cell);
  return { x0: bounds.x, y0: bounds.y, cell, nx, ny, free: new Uint8Array(nx * ny) };
}
/** Copy of a grid; pass a scratch `free` buffer of the same size to avoid allocating. */
export function cloneGrid(g, buffer) {
  if (buffer && buffer.length === g.free.length) { buffer.set(g.free); return { ...g, free: buffer }; }
  return { ...g, free: g.free.slice() };
}

/** Scan-line fill of a polygon with `value`. */
export function fillPoly(g, poly, value) {
  const bb = polygonBounds(poly);
  const j0 = Math.max(0, Math.floor((bb.y - g.y0) / g.cell)), j1 = Math.min(g.ny - 1, Math.ceil((bb.y + bb.h - g.y0) / g.cell));
  for (let j = j0; j <= j1; j++) {
    const y = g.y0 + (j + 0.5) * g.cell;
    const xs = [];
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.cell - 0.5)), i1 = Math.min(g.nx - 1, Math.floor((xs[k + 1] - g.x0) / g.cell - 0.5));
      for (let i = i0; i <= i1; i++) g.free[j * g.nx + i] = value;
    }
  }
}

/** Clear radius (cm) of every cell: distance from the cell to the nearest non-free cell edge (chamfer transform). */
export function clearance(g, buffer) {
  const { nx, ny, free, cell } = g;
  const d = buffer && buffer.length === nx * ny ? buffer : new Float32Array(nx * ny);
  const BIG = 1e6, D = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = free[i] ? BIG : 0;
  // forward pass (cells outside the grid count as blocked)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let v = d[k]; if (v === 0) continue;
      let t = (i > 0 ? d[k - 1] : 0) + 1; if (t < v) v = t;
      t = (j > 0 ? d[k - nx] : 0) + 1; if (t < v) v = t;
      t = (i > 0 && j > 0 ? d[k - nx - 1] : 0) + D; if (t < v) v = t;
      t = (i < nx - 1 && j > 0 ? d[k - nx + 1] : 0) + D; if (t < v) v = t;
      d[k] = v;
    }
  }
  // backward pass
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      let v = d[k]; if (v === 0) continue;
      let t = (i < nx - 1 ? d[k + 1] : 0) + 1; if (t < v) v = t;
      t = (j < ny - 1 ? d[k + nx] : 0) + 1; if (t < v) v = t;
      t = (i < nx - 1 && j < ny - 1 ? d[k + nx + 1] : 0) + D; if (t < v) v = t;
      t = (i > 0 && j < ny - 1 ? d[k + nx - 1] : 0) + D; if (t < v) v = t;
      d[k] = v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = d[i] > 0.5 ? (d[i] - 0.5) * cell : 0;
  return d;
}

/**
 * Flood fill from seed cells through free cells whose clear radius is at least `minR`. Returns the reached mask.
 * `seen` / `queue` are optional scratch buffers to avoid allocating on every run.
 */
export function flood(g, dist, minR, seeds, seen, queue) {
  const { nx, ny, free } = g;
  if (seen && seen.length === nx * ny) seen.fill(0); else seen = new Uint8Array(nx * ny);
  if (!queue || queue.length !== nx * ny) queue = new Int32Array(nx * ny);
  let head = 0, tail = 0;
  for (const s of seeds) if (s >= 0 && free[s] && !seen[s]) { seen[s] = 1; queue[tail++] = s; }
  while (head < tail) {
    const k = queue[head++];
    const i = k % nx, j = (k - i) / nx;
    if (i > 0) { const n = k - 1; if (!seen[n] && free[n] && dist[n] >= minR) { seen[n] = 1; queue[tail++] = n; } }
    if (i < nx - 1) { const n = k + 1; if (!seen[n] && free[n] && dist[n] >= minR) { seen[n] = 1; queue[tail++] = n; } }
    if (j > 0) { const n = k - nx; if (!seen[n] && free[n] && dist[n] >= minR) { seen[n] = 1; queue[tail++] = n; } }
    if (j < ny - 1) { const n = k + nx; if (!seen[n] && free[n] && dist[n] >= minR) { seen[n] = 1; queue[tail++] = n; } }
  }
  return seen;
}

/** Was any cell within `r` cm of (x, y) reached? */
export function reachedNear(g, seen, x, y, r = 30) {
  const n = Math.ceil(r / g.cell);
  const ci = Math.floor((x - g.x0) / g.cell), cj = Math.floor((y - g.y0) / g.cell);
  for (let j = Math.max(0, cj - n); j <= Math.min(g.ny - 1, cj + n); j++) {
    for (let i = Math.max(0, ci - n); i <= Math.min(g.nx - 1, ci + n); i++) if (seen[j * g.nx + i]) return true;
  }
  return false;
}

/** Cells within `r` cm of (x, y) that are free — used as flood seeds. */
export function cellsNear(g, x, y, r = 20) {
  const out = [], n = Math.ceil(r / g.cell);
  const ci = Math.floor((x - g.x0) / g.cell), cj = Math.floor((y - g.y0) / g.cell);
  for (let j = Math.max(0, cj - n); j <= Math.min(g.ny - 1, cj + n); j++) {
    for (let i = Math.max(0, ci - n); i <= Math.min(g.nx - 1, ci + n); i++) if (g.free[j * g.nx + i]) out.push(j * g.nx + i);
  }
  return out;
}

/**
 * Largest axis-aligned rectangle (by its shorter side, then area) inside a rectilinear polygon.
 * Works on the coordinate grid of the polygon's vertices, so a zero-width slit (free-standing wall inside the room)
 * costs nothing and the hole it leads to is excluded. O(nx² · ny) for nx × ny grid cells.
 */
export function largestInnerRect(poly) {
  const xs = [...new Set(poly.map((p) => p[0]))].sort((a, b) => a - b);
  const ys = [...new Set(poly.map((p) => p[1]))].sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1;
  let best = { x: 0, y: 0, w: 0, h: 0 };
  if (nx < 1 || ny < 1) return best;
  // down[j * nx + i] = number of consecutive inside cells from row j downwards in column i
  const down = new Int32Array(nx * ny);
  for (let j = ny - 1; j >= 0; j--) for (let i = 0; i < nx; i++) {
    if (pointInPolygon((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2, poly)) down[j * nx + i] = 1 + (j < ny - 1 ? down[(j + 1) * nx + i] : 0);
  }
  for (let j0 = 0; j0 < ny; j0++) for (let i0 = 0; i0 < nx; i0++) {
    let rows = Infinity;
    for (let i1 = i0; i1 < nx; i1++) {
      const d = down[j0 * nx + i1];
      if (!d) break;
      if (d < rows) rows = d;
      // for a fixed width the tallest rectangle is never worse, so only that one is a candidate
      const w = xs[i1 + 1] - xs[i0], h = ys[j0 + rows] - ys[j0];
      const a = Math.min(w, h), c = Math.min(best.w, best.h);
      if (a > c || (a === c && w * h > best.w * best.h)) best = { x: xs[i0], y: ys[j0], w, h };
    }
  }
  return best;
}

/**
 * The real wall faces of a rectilinear room polygon: its axis-aligned edges with zero-width slits removed.
 * A room that contains a free-standing wall is one polygon whose outline runs to that wall and back along the same
 * line (a slit); those two coincident stretches are not walls and cancel out here.
 * @returns {{ H: Array<{ c, a, b }>, V: Array<{ c, a, b }> }} c = the fixed coordinate, a..b = the extent
 */
export function polyEdges(poly) {
  const groups = { H: new Map(), V: new Map() };
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    if (y1 === y2 && x1 !== x2) add(groups.H, y1, x1, x2);
    else if (x1 === x2 && y1 !== y2) add(groups.V, x1, y1, y2);
  }
  function add(map, c, p, q) {
    if (!map.has(c)) map.set(c, []);
    map.get(c).push({ a: Math.min(p, q), b: Math.max(p, q), dir: q > p ? 1 : -1 });
  }
  const resolve = (map) => {
    const out = [];
    for (const [c, list] of map) {
      if (list.length === 1) { out.push({ c, a: list[0].a, b: list[0].b }); continue; }
      const cuts = [...new Set(list.flatMap((e) => [e.a, e.b]))].sort((p, q) => p - q);
      let run = null;
      for (let k = 0; k + 1 < cuts.length; k++) {
        const mid = (cuts[k] + cuts[k + 1]) / 2;
        let net = 0;
        for (const e of list) if (e.a < mid && mid < e.b) net += e.dir;
        if (net !== 0 && run && run.dir === Math.sign(net) && run.b === cuts[k]) run.b = cuts[k + 1];
        else { if (run) out.push({ c, a: run.a, b: run.b }); run = net !== 0 ? { a: cuts[k], b: cuts[k + 1], dir: Math.sign(net) } : null; }
      }
      if (run) out.push({ c, a: run.a, b: run.b });
    }
    return out;
  };
  return { H: resolve(groups.H), V: resolve(groups.V) };
}

/**
 * Narrow passages of a rectilinear room polygon: pairs of facing parallel wall faces closer than `maxWidth`
 * with free floor between them. Returns [{ width, length, x, y }] (x, y = centre). Slits are ignored (polyEdges).
 */
export function narrowPassages(poly, maxWidth = 150) {
  const { H, V } = polyEdges(poly);
  const out = [];
  const scan = (edges, horizontal) => {
    for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
      const e = edges[i], f = edges[j];
      const width = Math.abs(e.c - f.c);
      if (width < 30 || width > maxWidth) continue;
      const a = Math.max(e.a, f.a), b = Math.min(e.b, f.b);
      if (b - a < width) continue;
      const mid = (a + b) / 2, c = (e.c + f.c) / 2;
      const [px, py] = horizontal ? [mid, c] : [c, mid];
      if (!pointInPolygon(px, py, poly)) continue;
      // the floor between the two faces must be free all the way across (no other wall in between)
      const lo = Math.min(e.c, f.c), hi = Math.max(e.c, f.c);
      if (edges.some((g) => g !== e && g !== f && g.c > lo && g.c < hi && g.a < mid && g.b > mid)) continue;
      out.push({ width, length: b - a, x: px, y: py });
    }
  };
  scan(H, true); scan(V, false);
  return out.sort((p, q) => p.width - q.width);
}
