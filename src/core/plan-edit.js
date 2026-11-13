/**
 * PLAN EDITING ENGINE — change interior walls, doors and windows "based on what is allowed".
 * Pure logic (no DOM, no THREE). See docs/CONTRACT.md § 7 for the public contract.
 *
 * MODEL
 *   `PLAN` (plan.js) is one shared object. An edit replaces PLAN.walls / openings / rooms / wallOutline with NEW
 *   arrays (same PLAN identity) and then tells the store, which records undo and emits 'plan'.
 *   `BASE_PLAN` is a deep-frozen copy of the architect's plan, used for classification, diffing and reset.
 *   A plan whose wall solids, openings and room names equal the architect's IS the architect's plan again
 *   (isPlanModified() → false, exact base arrays restored).
 *
 * HOW IT WORKS (everything is axis-aligned, so all geometry runs on a coordinate-compressed grid)
 *   1. cells     every distinct wall / opening coordinate becomes a grid line; a cell is free, wall or opening.
 *   2. outdoors  flood-fill of free cells from outside the house (terrace, porch, yard, garden).
 *   3. bars      a solid cell whose horizontal run is ≤ 30 cm is part of a north–south wall, one whose vertical run
 *                is ≤ 30 cm part of an east–west wall; cells long in BOTH directions are junction squares.
 *                A segment "core" = maximal stretch of bar cells with one cross-section, i.e. the wall between two
 *                junctions / wall ends (openings in it included). Junction squares are handed to the most important
 *                neighbouring core (mamad > exterior > thick > partition, then thicker, then longer) so that the
 *                segments tile the wall solids exactly once.
 *   4. classes   mamad (inside the shelter shell), exterior (touches outdoors), thick (≥ 15 cm), partition.
 *   5. rooms     connected components of indoor free cells → clockwise polygons, matched to the previous rooms by
 *                largest overlap so ids / names / finishes survive.
 */
import { PLAN } from './plan.js';
import { pointInPolygon, polygonArea, invalidatePlanCaches } from './geometry.js';

// ---------------------------------------------------------------- constants
const SNAP = 5;            // cm — every edit snaps to this grid
const TMAX = 30;           // cm — thickest wall (mamad south wall); longer runs in both directions = junction
const THICK = 15;          // cm — interior walls at least this thick may be structural
const MIN_JAMB = 10;       // cm of solid wall kept between an opening and wall ends / other openings
const MIN_WALL = 30;       // cm — shortest wall a user can draw; shorter free-ended leftovers are refused
const MIN_CLEAR = 60;      // cm — narrowest free space an edit may create
const TRIM = 15;           // cm — a drawn wall end this close to a wall face is extended to it
const REACH = 60;          // cm — how far addOpening looks for a wall around the requested point
const NEW_WALL = { min: 7, max: 20, def: 10 };

export const REASONS = Object.freeze({
  mamad: 'Altering the protective shell, door or window of a mamad (safe room) is prohibited by the Civil Defence (shelter specifications) regulations.',
  exteriorWall: 'Exterior walls are the building envelope and structure — they cannot be added, moved or removed. Their windows and doors can be changed with a building-permit amendment.',
  permit: 'Changing an exterior opening requires a building-permit amendment.',
  thick: (t) => `This ${t} cm wall may be structural — confirm with your structural engineer before changing it.`,
});

const OPENING_KINDS = {
  door: { width: 80, height: 210, sill: 0, style: 'interior', extStyle: 'service', styles: ['interior', 'entry', 'service'], minW: 60, maxW: 200, minH: 180, maxH: 260 },
  'sliding-door': { width: 160, height: 210, sill: 0, style: 'glass-sliding', styles: ['glass-sliding'], minW: 120, maxW: 400, minH: 180, maxH: 260 },
  window: { width: 100, height: 100, sill: 110, style: 'sliding', styles: ['sliding', 'tilt'], minW: 40, maxW: 400, minH: 30, maxH: 260 },
  opening: { width: 90, height: 210, sill: 0, style: 'open', styles: ['open'], minW: 60, maxW: 400, minH: 180, maxH: 280 },
};
const HEAD_ROOM = 20;      // cm of wall kept above any opening (lintel)

// ---------------------------------------------------------------- small helpers
const clone = (o) => JSON.parse(JSON.stringify(o));
const snap = (v) => Math.round(v / SNAP) * SNAP;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const fail = (reason) => ({ ok: false, reason });
const overlapLen = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const overlapArea = (a, b) => overlapLen(a.x, a.x + a.w, b.x, b.x + b.w) * overlapLen(a.y, a.y + a.h, b.y, b.y + b.h);
const rectDist = (x, y, r) => Math.hypot(Math.max(r.x - x, 0, x - r.x - r.w), Math.max(r.y - y, 0, y - r.y - r.h));
const coverage = (r, rects) => { let s = 0; for (const b of rects) s += overlapArea(r, b); return s / Math.max(1, r.w * r.h); };
const metres = (cm) => (cm / 100).toFixed(2) + ' m';
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}
function lowerBound(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}

/** The architect's plan: deep-frozen, never changes. */
export const BASE_PLAN = deepFreeze(clone(PLAN));
const BASE_SOLIDS = [...BASE_PLAN.walls, ...BASE_PLAN.openings];

/** Safe-room shell, derived once from the architect's plan (it is locked, so it never changes). */
const MAMAD = (() => {
  const room = BASE_PLAN.rooms.find((r) => r.id === 'mamad') || BASE_PLAN.rooms.find((r) => r.type === 'mamad');
  const walls = BASE_PLAN.walls.filter((w) => w.kind === 'mamad');
  if (!room) return { room: null, shell: null, rects: walls };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of room.polygon) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const inner = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  // expand the room outward to the outer faces of the shelter walls that surround it
  const grown = { x: x0 - 1, y: y0 - 1, w: x1 - x0 + 2, h: y1 - y0 + 2 };
  for (const w of walls) if (overlapArea(w, grown) > 0) { x0 = Math.min(x0, w.x); y0 = Math.min(y0, w.y); x1 = Math.max(x1, w.x + w.w); y1 = Math.max(y1, w.y + w.h); }
  const shell = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  return { room: inner, shell, rects: [shell, ...walls.filter((w) => overlapArea(w, shell) < w.w * w.h)] };
})();
const inMamad = (r) => MAMAD.rects.some((s) => overlapArea(r, s) > 0);

const outdoorAt = (x, y) => { for (const o of BASE_PLAN.outdoorAreas) if (pointInPolygon(x, y, o.polygon)) return o.id; return 'outside'; };
const isOutdoorId = (id) => id === 'outside' || BASE_PLAN.outdoorAreas.some((o) => o.id === id);

// ---------------------------------------------------------------- grid model
const FREE = 0, WALL = 1, GAP = 2;        // cell states
const T_H = 1, T_V = 2, T_J = 3;          // bar orientation of a solid cell

function buildModel(solids, openings, extraX = [], extraY = []) {
  const xs0 = new Set(extraX), ys0 = new Set(extraY);
  for (const list of [solids, openings]) for (const r of list) { xs0.add(r.x); xs0.add(r.x + r.w); ys0.add(r.y); ys0.add(r.y + r.h); }
  const xs = [...xs0].sort((a, b) => a - b), ys = [...ys0].sort((a, b) => a - b);
  xs.unshift(xs[0] - 100); xs.push(xs[xs.length - 1] + 100); ys.unshift(ys[0] - 100); ys.push(ys[ys.length - 1] + 100);
  const nx = xs.length - 1, ny = ys.length - 1;
  const m = { xs, ys, nx, ny, cell: new Uint8Array(nx * ny), overlaps: [] };
  for (const r of solids) paint(m, r, WALL);
  for (const o of openings) {
    const [i0, i1, j0, j1] = span(m, o);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { if (m.cell[j * nx + i] === GAP) m.overlaps.push(o.id); m.cell[j * nx + i] = GAP; }
  }
  return m;
}
const span = (m, r) => [lowerBound(m.xs, r.x), lowerBound(m.xs, r.x + r.w), lowerBound(m.ys, r.y), lowerBound(m.ys, r.y + r.h)];
function paint(m, r, v) {
  const [i0, i1, j0, j1] = span(m, r);
  for (let j = j0; j < j1; j++) m.cell.fill(v, j * m.nx + i0, j * m.nx + i1);
}
const cellRect = (m, i0, i1, j0, j1) => ({ x: m.xs[i0], y: m.ys[j0], w: m.xs[i1] - m.xs[i0], h: m.ys[j1] - m.ys[j0] });

/** Mark free cells reachable from outside the house. */
function floodOutdoor(m) {
  const { nx, ny, cell } = m, out = new Uint8Array(nx * ny), stack = [0];
  out[0] = 1;
  while (stack.length) {
    const k = stack.pop(), i = k % nx, j = (k - i) / nx;
    if (i > 0 && !cell[k - 1] && !out[k - 1]) { out[k - 1] = 1; stack.push(k - 1); }
    if (i < nx - 1 && !cell[k + 1] && !out[k + 1]) { out[k + 1] = 1; stack.push(k + 1); }
    if (j > 0 && !cell[k - nx] && !out[k - nx]) { out[k - nx] = 1; stack.push(k - nx); }
    if (j < ny - 1 && !cell[k + nx] && !out[k + nx]) { out[k + nx] = 1; stack.push(k + nx); }
  }
  m.out = out;
}

/** Straight solid runs through every cell and the resulting bar orientation. */
function computeTypes(m) {
  const { nx, ny, cell, xs, ys } = m, n = nx * ny;
  const hA = new Int32Array(n), hB = new Int32Array(n), vA = new Int32Array(n), vB = new Int32Array(n), type = new Uint8Array(n);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx;) {
    if (!cell[j * nx + i]) { i++; continue; }
    const s = i; while (i < nx && cell[j * nx + i]) i++;
    for (let t = s; t < i; t++) { hA[j * nx + t] = s; hB[j * nx + t] = i; }
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny;) {
    if (!cell[j * nx + i]) { j++; continue; }
    const s = j; while (j < ny && cell[j * nx + i]) j++;
    for (let t = s; t < j; t++) { vA[t * nx + i] = s; vB[t * nx + i] = j; }
  }
  for (let k = 0; k < n; k++) {
    if (!cell[k]) continue;
    const H = xs[hB[k]] - xs[hA[k]], V = ys[vB[k]] - ys[vA[k]];
    type[k] = H > TMAX && V > TMAX ? T_J : H <= TMAX && (V > TMAX || V > H) ? T_V : T_H;
  }
  Object.assign(m, { hA, hB, vA, vB, type });
}

const CLS_RANK = { mamad: 3, exterior: 2, thick: 1, partition: 0 };

/** Cores, their classes and the tiling of junction squares. Adds m.cores, m.core0 (core of each bar cell), m.owner (tile). */
function computeCores(m) {
  const { nx, ny, cell, type, hA, hB, vA, vB, out } = m, n = nx * ny;
  const core0 = new Int32Array(n).fill(-1), cores = [];
  const claim = (c) => { for (let j = c.j0; j < c.j1; j++) for (let i = c.i0; i < c.i1; i++) core0[j * nx + i] = cores.length; cores.push(c); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (core0[k] >= 0 || !cell[k] || type[k] === T_J) continue;
    if (type[k] === T_V) {
      let i0 = hA[k], i1 = hB[k], whole = true;
      for (let t = i0; t < i1; t++) if (type[j * nx + t] !== T_V || core0[j * nx + t] >= 0) whole = false;
      if (!whole) { i0 = i; i1 = i + 1; }
      const ok = (jj) => { for (let t = i0; t < i1; t++) { const q = jj * nx + t; if (type[q] !== T_V || core0[q] >= 0 || (whole && (hA[q] !== i0 || hB[q] !== i1))) return false; } return true; };
      let j1 = j + 1; while (j1 < ny && ok(j1)) j1++;
      claim({ axis: 'v', i0, i1, j0: j, j1 });
    } else {
      let j0 = vA[k], j1 = vB[k], whole = true;
      for (let t = j0; t < j1; t++) if (type[t * nx + i] !== T_H || core0[t * nx + i] >= 0) whole = false;
      if (!whole) { j0 = j; j1 = j + 1; }
      const ok = (ii) => { for (let t = j0; t < j1; t++) { const q = t * nx + ii; if (type[q] !== T_H || core0[q] >= 0 || (whole && (vA[q] !== j0 || vB[q] !== j1))) return false; } return true; };
      let i1 = i + 1; while (i1 < nx && ok(i1)) i1++;
      claim({ axis: 'h', i0: i, i1, j0, j1 });
    }
  }
  const owner = core0.slice();
  const describe = (c) => {
    const r = cellRect(m, c.i0, c.i1, c.j0, c.j1);
    Object.assign(c, r, { thickness: c.axis === 'v' ? r.w : r.h, length: c.axis === 'v' ? r.h : r.w });
    const outdoor = (i, j) => { const q = j * nx + i; return !cell[q] && out[q]; };
    const free = (i, j) => !cell[j * nx + i];
    let ext = false, freeA = true, freeB = true;
    for (let j = c.j0; j < c.j1; j++) { if (outdoor(c.i0 - 1, j) || outdoor(c.i1, j)) ext = true; if (c.axis === 'h') { if (!free(c.i0 - 1, j)) freeA = false; if (!free(c.i1, j)) freeB = false; } }
    for (let i = c.i0; i < c.i1; i++) { if (outdoor(i, c.j0 - 1) || outdoor(i, c.j1)) ext = true; if (c.axis === 'v') { if (!free(i, c.j0 - 1)) freeA = false; if (!free(i, c.j1)) freeB = false; } }
    c.freeA = freeA; c.freeB = freeB;
    c.isNew = coverage(r, BASE_SOLIDS) < 0.5;
    c.cls = inMamad(r) ? 'mamad' : ext ? 'exterior' : c.thickness >= THICK && !c.isNew ? 'thick' : 'partition';
    c.t = { i0: c.i0, i1: c.i1, j0: c.j0, j1: c.j1 };
  };
  cores.forEach(describe);
  // hand junction squares to the most important neighbouring core
  const order = cores.map((c, i) => i).sort((a, b) => {
    const A = cores[a], B = cores[b];
    return CLS_RANK[B.cls] - CLS_RANK[A.cls] || B.thickness - A.thickness || B.length - A.length || (A.axis === B.axis ? 0 : A.axis === 'h' ? -1 : 1) || A.y - B.y || A.x - B.x;
  });
  const takeRow = (c, idx, j) => { for (let i = c.i0; i < c.i1; i++) { const q = j * nx + i; if (type[q] !== T_J || owner[q] >= 0) return false; } for (let i = c.i0; i < c.i1; i++) owner[j * nx + i] = idx; return true; };
  const takeCol = (c, idx, i) => { for (let j = c.j0; j < c.j1; j++) { const q = j * nx + i; if (type[q] !== T_J || owner[q] >= 0) return false; } for (let j = c.j0; j < c.j1; j++) owner[j * nx + i] = idx; return true; };
  for (const idx of order) {
    const c = cores[idx];
    if (c.axis === 'v') { while (takeRow(c, idx, c.t.j0 - 1)) c.t.j0--; while (takeRow(c, idx, c.t.j1)) c.t.j1++; } else { while (takeCol(c, idx, c.t.i0 - 1)) c.t.i0--; while (takeCol(c, idx, c.t.i1)) c.t.i1++; }
  }
  // junction cells no core could reach in a straight line become tiny segments of their own
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (type[j * nx + i] !== T_J || owner[j * nx + i] >= 0) continue;
    let i1 = i + 1; while (i1 < nx && type[j * nx + i1] === T_J && owner[j * nx + i1] < 0) i1++;
    let j1 = j + 1;
    const rowFree = (jj) => { for (let t = i; t < i1; t++) if (type[jj * nx + t] !== T_J || owner[jj * nx + t] >= 0) return false; return true; };
    while (j1 < ny && rowFree(j1)) j1++;
    const c = { i0: i, i1, j0: j, j1, junction: true };
    c.axis = m.xs[i1] - m.xs[i] >= m.ys[j1] - m.ys[j] ? 'h' : 'v';
    for (let jj = j; jj < j1; jj++) for (let t = i; t < i1; t++) owner[jj * nx + t] = cores.length;
    cores.push(c); describe(c);
  }
  Object.assign(m, { cores, core0, owner });
}

/** Area (cm²) of indoor free cells that sit in a gap narrower than MIN_CLEAR. */
function narrowArea(m) {
  const { nx, ny, cell, out, xs, ys } = m, flag = new Uint8Array(nx * ny), open = (k) => !cell[k] && !out[k];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx;) {
    if (!open(j * nx + i)) { i++; continue; }
    const s = i; while (i < nx && open(j * nx + i)) i++;
    if (xs[i] - xs[s] < MIN_CLEAR) for (let t = s; t < i; t++) flag[j * nx + t] = 1;
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny;) {
    if (!open(j * nx + i)) { j++; continue; }
    const s = j; while (j < ny && open(j * nx + i)) j++;
    if (ys[j] - ys[s] < MIN_CLEAR) for (let t = s; t < j; t++) flag[t * nx + i] = 1;
  }
  let a = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (flag[j * nx + i]) a += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
  return a;
}

// ---------------------------------------------------------------- derived data: outline, walls, rooms
function buildOutline(m) {
  const { nx, ny, cell, xs, ys } = m, W = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny && cell[j * nx + i] === WALL ? 1 : 0), segs = [];
  for (let j = 1; j < ny; j++) for (let i = 0; i < nx;) {
    if (W(i, j - 1) === W(i, j)) { i++; continue; }
    const s = i; i++;
    while (i < nx && W(i, j - 1) !== W(i, j) && W(i - 1, j - 1) === W(i, j - 1) && W(i - 1, j) === W(i, j)) i++;
    segs.push([xs[s], ys[j], xs[i], ys[j]]);
  }
  for (let i = 1; i < nx; i++) for (let j = 0; j < ny;) {
    if (W(i - 1, j) === W(i, j)) { j++; continue; }
    const s = j; j++;
    while (j < ny && W(i - 1, j) !== W(i, j) && W(i - 1, j - 1) === W(i - 1, j) && W(i, j - 1) === W(i, j)) j++;
    segs.push([xs[i], ys[s], xs[i], ys[j]]);
  }
  return segs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
}

const KIND_OF = { mamad: 'mamad', exterior: 'exterior', thick: 'interior', partition: 'interior' };

/**
 * Clean wall rectangles. A wall that runs straight through T-junctions is ONE run (junction squares go to the
 * through wall), split only where its class changes and by openings; corner squares follow their segment.
 */
function buildWalls(m, prevWalls) {
  const { nx, ny, cell, cores, core0, type } = m;
  const parent = cores.map((c, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const own = m.owner.slice();
  cores.forEach((c, idx) => {
    if (c.junction) return;
    const v = c.axis === 'v', K = v ? (u, a) => a * nx + u : (u, a) => u * nx + a, u0 = v ? c.i0 : c.j0, u1 = v ? c.i1 : c.j1, lim = v ? ny : nx, gap = [];
    const junction = (a) => { for (let u = u0; u < u1; u++) if (type[K(u, a)] !== T_J) return false; return true; };
    let a = v ? c.j1 : c.i1;
    while (a < lim && junction(a)) gap.push(a++);
    const j = gap.length && a < lim ? core0[K(u0, a)] : -1, o = j >= 0 ? cores[j] : null;
    if (!o || o.axis !== c.axis || o.cls !== c.cls || (v ? o.i0 !== c.i0 || o.i1 !== c.i1 || o.j0 !== a : o.j0 !== c.j0 || o.j1 !== c.j1 || o.i0 !== a)) return;
    parent[find(j)] = find(idx);
    for (const g of gap) for (let u = u0; u < u1; u++) own[K(u, g)] = idx;
  });
  const seen = new Uint8Array(nx * ny), rects = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (cell[j * nx + i] !== WALL || seen[j * nx + i]) continue;
    const run = find(own[j * nx + i]), c = cores[run], same = (q) => cell[q] === WALL && !seen[q] && find(own[q]) === run;
    let i1 = i + 1, j1 = j + 1;
    const rowOk = (jj) => { for (let t = i; t < i1; t++) if (!same(jj * nx + t)) return false; return true; };
    const colOk = (ii) => { for (let t = j; t < j1; t++) if (!same(t * nx + ii)) return false; return true; };
    if (c.axis === 'h') { while (i1 < nx && same(j * nx + i1)) i1++; while (j1 < ny && rowOk(j1)) j1++; } else { while (j1 < ny && same(j1 * nx + i)) j1++; while (i1 < nx && colOk(i1)) i1++; }
    for (let jj = j; jj < j1; jj++) seen.fill(1, jj * nx + i, jj * nx + i1);
    rects.push({ ...cellRect(m, i, i1, j, j1), kind: KIND_OF[c.cls], cls: c.cls });
  }
  rects.sort((a, b) => a.y - b.y || a.x - b.x);
  const key = (r) => `${r.x},${r.y},${r.w},${r.h}`, old = new Map(), used = new Set();
  let next = 0;
  for (const w of [...BASE_PLAN.walls, ...(prevWalls || [])]) { const n = parseInt(String(w.id).slice(1), 10); if (n > next) next = n; }
  for (const w of prevWalls || []) if (!old.has(key(w))) old.set(key(w), w.id);
  return rects.map((r) => {
    let id = old.get(key(r));
    if (!id || used.has(id)) id = 'w' + String(++next).padStart(2, '0');
    used.add(id);
    return { id, x: r.x, y: r.y, w: r.w, h: r.h, kind: r.kind, cls: r.cls };
  });
}

/** Boundary loops of one room component, interior on the right (outer loop clockwise on screen). */
function traceLoops(m, comp, cid, cells) {
  const { nx, ny, xs, ys } = m, W = nx + 1;
  const inside = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && comp[j * nx + i] === cid;
  const from = new Map(), all = [];
  const add = (i1, j1, i2, j2, dir) => { const e = { key: j1 * W + i1, to: j2 * W + i2, dir, used: false }; if (!from.has(e.key)) from.set(e.key, []); from.get(e.key).push(e); all.push(e); };
  for (const k of cells) {
    const i = k % nx, j = (k - i) / nx;
    if (!inside(i, j - 1)) add(i, j, i + 1, j, 0);
    if (!inside(i + 1, j)) add(i + 1, j, i + 1, j + 1, 1);
    if (!inside(i, j + 1)) add(i + 1, j + 1, i, j + 1, 2);
    if (!inside(i - 1, j)) add(i, j + 1, i, j, 3);
  }
  const loops = [];
  for (const first of all) {
    if (first.used) continue;
    const pts = [];
    let e = first;
    for (let guard = 0; guard <= all.length; guard++) {
      e.used = true; pts.push(e.key);
      const options = from.get(e.to) || [];
      const pick = (dir) => options.find((o) => o.dir === dir);
      const nxt = pick((e.dir + 1) % 4) || pick(e.dir) || pick((e.dir + 3) % 4);
      if (!nxt || nxt === first || nxt.used) break;
      e = nxt;
    }
    const raw = pts.map((key) => [xs[key % W], ys[(key - (key % W)) / W]]);
    const loop = raw.filter((p, i) => { const a = raw[(i + raw.length - 1) % raw.length], b = raw[(i + 1) % raw.length]; return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1])); });
    let area = 0;
    for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; area += a[0] * b[1] - b[0] * a[1]; }
    loops.push({ pts: loop, area: area / 2 });
  }
  return loops;
}

/** One polygon per room: holes (free-standing walls) are joined to the outer loop by a zero-width slit. */
function roomPolygon(m, comp, cid, cells) {
  const loops = traceLoops(m, comp, cid, cells).sort((a, b) => b.area - a.area);
  let poly = loops[0].pts.slice();
  const start = poly.reduce((best, p, i) => (p[1] < poly[best][1] || (p[1] === poly[best][1] && p[0] < poly[best][0]) ? i : best), 0);
  poly = poly.slice(start).concat(poly.slice(0, start));
  const holes = loops.slice(1).map((l) => {
    const s = l.pts.reduce((best, p, i) => (p[0] < l.pts[best][0] || (p[0] === l.pts[best][0] && p[1] < l.pts[best][1]) ? i : best), 0);
    return l.pts.slice(s).concat(l.pts.slice(0, s));
  }).sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1]);
  for (const hole of holes) {
    const v = hole[0], vj = lowerBound(m.ys, v[1]);
    let i = lowerBound(m.xs, v[0]) - 1;
    while (i > 0 && comp[vj * m.nx + i - 1] === cid) i--;
    const px = m.xs[i], py = v[1];
    const k = poly.findIndex((a, q) => { const b = poly[(q + 1) % poly.length]; return a[0] === px && b[0] === px && a[1] > b[1] && py < a[1] && py >= b[1]; });
    if (k < 0) continue;                                    // cannot bridge — leave the hole out (area slightly over-stated)
    const at = (k + 1) % poly.length, onVertex = poly[at][1] === py;
    if (onVertex) poly.splice(at + 1, 0, ...hole, [v[0], v[1]], [px, py]);
    else poly.splice(k + 1, 0, [px, py], ...hole, [v[0], v[1]], [px, py]);
  }
  return poly;
}

function distToPolygon(x, y, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length], dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return pointInPolygon(x, y, poly) ? best : -best;
}

/** Pole of inaccessibility (centre of the largest inscribed circle) — a label point that is always well inside. */
function interiorPoint(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const size = Math.min(x1 - x0, y1 - y0);
  if (!(size > 0)) return [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)];
  const mk = (x, y, h) => { const d = distToPolygon(x, y, poly); return { x, y, h, d, max: d + h * Math.SQRT2 }; };
  const queue = [];
  for (let x = x0; x < x1; x += size) for (let y = y0; y < y1; y += size) queue.push(mk(x + size / 2, y + size / 2, size / 2));
  let best = mk((x0 + x1) / 2, (y0 + y1) / 2, 0);
  for (let guard = 0; queue.length && guard < 4000; guard++) {
    let q = 0; for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[q].max) q = i;
    const c = queue.splice(q, 1)[0];
    if (c.d > best.d + 0.5) best = c;
    if (c.max - best.d <= 2) continue;
    const h = c.h / 2;
    queue.push(mk(c.x - h, c.y - h, h), mk(c.x + h, c.y - h, h), mk(c.x - h, c.y + h, h), mk(c.x + h, c.y + h, h));
  }
  return [Math.round(best.x), Math.round(best.y)];
}

const cyclicEqual = (a, b) => {
  if (a.length !== b.length) return false;
  for (let s = 0; s < b.length; s++) if (a.every((p, i) => p[0] === b[(i + s) % b.length][0] && p[1] === b[(i + s) % b.length][1])) return true;
  return false;
};

/** Rooms from the indoor free space; ids and names follow the previous rooms by largest overlap. */
function buildRooms(m, prevRooms) {
  const { nx, ny, cell, out, xs, ys } = m, comp = new Int32Array(nx * ny).fill(-1), comps = [];
  for (let k0 = 0; k0 < nx * ny; k0++) {
    if (cell[k0] || out[k0] || comp[k0] >= 0) continue;
    const cid = comps.length, cells = [], stack = [k0];
    comp[k0] = cid;
    while (stack.length) {
      const k = stack.pop(); cells.push(k);
      for (let n = 0; n < 4; n++) { const q = n === 0 ? k - 1 : n === 1 ? k + 1 : n === 2 ? k - nx : k + nx; if (!cell[q] && !out[q] && comp[q] < 0) { comp[q] = cid; stack.push(q); } }
    }
    comps.push({ cells, overlap: new Map(), area: 0 });
  }
  const prev = prevRooms.map((r) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of r.polygon) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { room: r, x0, y0, x1, y1, best: -1, bestArea: 0 };
  });
  for (const c of comps) for (const k of c.cells) { const i = k % nx, j = (k - i) / nx; c.area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]); }
  // overlap of every component with every previous room: one scanline per grid row (cell centres)
  for (let j = 0; j < ny; j++) {
    const cy = (ys[j] + ys[j + 1]) / 2, dy = ys[j + 1] - ys[j];
    for (let p = 0; p < prev.length; p++) {
      const q = prev[p];
      if (cy < q.y0 || cy > q.y1) continue;
      const poly = q.room.polygon, cuts = [];
      for (let e = 0; e < poly.length; e++) {
        const a = poly[e], b = poly[(e + 1) % poly.length];
        if ((a[1] > cy) !== (b[1] > cy)) cuts.push(a[0] + ((cy - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      cuts.sort((a, b) => a - b);
      for (let t = 0; t + 1 < cuts.length; t += 2) {
        for (let i = Math.max(0, lowerBound(xs, cuts[t]) - 1); i < nx && xs[i] < cuts[t + 1]; i++) {
          const cx = (xs[i] + xs[i + 1]) / 2, cid = comp[j * nx + i];
          if (cid < 0 || cx <= cuts[t] || cx >= cuts[t + 1]) continue;
          const o = comps[cid].overlap;
          o.set(p, (o.get(p) || 0) + (xs[i + 1] - xs[i]) * dy);
        }
      }
    }
  }
  comps.forEach((c, cid) => { for (const [p, a] of c.overlap) if (a > prev[p].bestArea) { prev[p].bestArea = a; prev[p].best = cid; } });
  const zones = prevRooms.flatMap((r) => r.zones || []);
  const taken = new Set(prevRooms.map((r) => r.id));
  const kept = new Array(prev.length).fill(null), fresh = [], roomOf = new Array(comps.length);
  comps.forEach((c, cid) => {
    let winner = -1, parent = -1;
    for (const p of [...c.overlap.keys()].sort((a, b) => a - b)) {      // ties → the room listed first
      const a = c.overlap.get(p);
      if (parent < 0 || a > c.overlap.get(parent)) parent = p;
      if (prev[p].best === cid && (winner < 0 || a > c.overlap.get(winner))) winner = p;
    }
    const src = winner >= 0 ? prev[winner].room : null;
    let polygon = roomPolygon(m, comp, cid, c.cells);
    if (src && cyclicEqual(polygon, src.polygon)) polygon = src.polygon;
    const area = polygonArea(polygon), mine = zones.filter((z) => pointInPolygon(z.label[0], z.label[1], polygon));
    let room;
    if (src) {
      const before = polygonArea(src.polygon), same = polygon === src.polygon;
      const keepLabel = same || (Math.abs(area - before) < 0.15 * before && distToPolygon(src.label[0], src.label[1], polygon) >= 30);
      room = { ...src, polygon, label: keepLabel ? src.label : interiorPoint(polygon) };
      if (mine.length) room.zones = src.zones && src.zones.length === mine.length && mine.every((z, i) => z === src.zones[i]) ? src.zones : mine; else delete room.zones;
      if (room.drawnArea != null && (Math.abs(area - before) > 3000 || Math.abs(area / 1e4 - room.drawnArea) > 0.35)) delete room.drawnArea;
      kept[winner] = room;
    } else {
      const from = parent >= 0 ? prev[parent].room : null;
      room = { id: null, name: 'New room', nameHe: 'חדר חדש', type: from ? from.type : 'living', ...(from && from.wet ? { wet: true } : {}), polygon, label: interiorPoint(polygon), ...(mine.length ? { zones: mine } : {}) };
      fresh.push(room);
    }
    roomOf[cid] = room;
  });
  fresh.sort((a, b) => a.polygon[0][1] - b.polygon[0][1] || a.polygon[0][0] - b.polygon[0][0]);
  for (const r of fresh) { let n = 1; while (taken.has('room-' + n)) n++; r.id = 'room-' + n; taken.add(r.id); }
  return { rooms: [...kept.filter(Boolean), ...fresh], comp, roomOf };
}

// ---------------------------------------------------------------- derive: everything that follows from walls + openings
/**
 * @param solids   rectangles of wall material INCLUDING the openings in them
 * @param openings opening objects (stamped on top of the solids)
 * @returns {{ walls, openings, rooms, wallOutline, segments, problems, narrow, m }}
 */
function derive(solids, openings, prevRooms, prevWalls) {
  const m = buildModel(solids, openings);
  floodOutdoor(m); computeTypes(m); computeCores(m);
  const { nx, cell, out, xs, ys, cores, core0, type } = m;
  const { rooms, comp, roomOf } = buildRooms(m, prevRooms);
  const spaceOf = (i, j) => { const k = j * nx + i; if (cell[k]) return null; return out[k] ? outdoorAt((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2) : roomOf[comp[k]].id; };

  const problems = m.overlaps.map((id) => ({ id, type: 'overlap' }));
  const nextOpenings = openings.map((o) => {
    const [i0, i1, j0, j1] = span(m, o), horizontal = o.axis === 'h';
    const c = cores[core0[j0 * nx + i0]];
    let ok = !!c && !c.junction && c.axis === o.axis && (horizontal ? j0 === c.j0 && j1 === c.j1 : i0 === c.i0 && i1 === c.i1);
    for (let j = j0; ok && j < j1; j++) for (let i = i0; i < i1; i++) if (type[j * nx + i] === T_J || cores[core0[j * nx + i]] !== c) ok = false;
    if (ok) {
      // MIN_JAMB of solid wall of the same core on both sides
      const wallAt = (a) => { for (let t = horizontal ? j0 : i0; t < (horizontal ? j1 : i1); t++) { const k = horizontal ? t * nx + a : a * nx + t; if (cell[k] !== WALL || cores[core0[k]] !== c) return false; } return true; };
      const A = horizontal ? xs : ys, s = horizontal ? i0 : j0, e = horizontal ? i1 : j1;
      let a = s; while (a > 0 && wallAt(a - 1) && A[s] - A[a] < MIN_JAMB) a--;
      let b = e; while (b < A.length - 1 && wallAt(b) && A[b] - A[e] < MIN_JAMB) b++;
      if (A[s] - A[a] < MIN_JAMB || A[b] - A[e] < MIN_JAMB) ok = false;
    }
    if (!ok) { problems.push({ id: o.id, type: 'jamb' }); return o; }
    const im = (i0 + i1) >> 1, jm = (j0 + j1) >> 1;
    const lo = horizontal ? spaceOf(im, j0 - 1) : spaceOf(i0 - 1, jm), hi = horizontal ? spaceOf(im, j1) : spaceOf(i1, jm);
    if (lo == null || hi == null) { problems.push({ id: o.id, type: 'blocked' }); return o; }
    const loOut = isOutdoorId(lo), hiOut = isOutdoorId(hi), exterior = loOut || hiOut;
    const outside = exterior ? (horizontal ? (loOut ? 'n' : 's') : (loOut ? 'w' : 'e')) : undefined;
    const pair = loOut && !hiOut ? [hi, lo] : [lo, hi];
    const norm = (list) => (list || []).map((id) => (isOutdoorId(id) ? '~' : id)).sort().join('|');
    const sameRooms = norm(o.rooms) === norm(pair) && (o.rooms || []).length === 2;
    if (sameRooms && !!o.exterior === exterior && o.outside === outside) return o;
    const next = { ...o, rooms: sameRooms ? o.rooms : pair };
    if (exterior) { next.exterior = true; next.outside = outside; } else { delete next.exterior; delete next.outside; }
    return next;
  });

  const segments = cores.map((c) => {
    const tile = cellRect(m, c.t.i0, c.t.i1, c.t.j0, c.t.j1), v = c.axis === 'v';
    const jm = (c.j0 + c.j1) >> 1, im = (c.i0 + c.i1) >> 1;
    return {
      id: c.junction ? `seg:j:${c.x}:${c.y}` : v ? `seg:v:${c.x}:${c.y}:${c.y + c.h}` : `seg:h:${c.y}:${c.x}:${c.x + c.w}`,
      axis: c.axis, ...tile, thickness: c.thickness, length: v ? tile.h : tile.w, cls: c.cls,
      policy: c.cls === 'mamad' ? { level: 'locked', reason: REASONS.mamad } : c.cls === 'exterior' ? { level: 'locked', reason: REASONS.exteriorWall }
        : c.cls === 'thick' ? { level: 'warn', reason: REASONS.thick(c.thickness) } : { level: 'free', reason: '' },
      openingIds: nextOpenings.filter((o) => overlapArea(o, tile) > 0).map((o) => o.id),
      isNew: c.isNew,
      core: { x: c.x, y: c.y, w: c.w, h: c.h },
      between: v ? [spaceOf(c.i0 - 1, jm), spaceOf(c.i1, jm)] : [spaceOf(im, c.j0 - 1), spaceOf(im, c.j1)],
      freeEnds: [c.freeA, c.freeB],
    };
  });
  return { walls: buildWalls(m, prevWalls), openings: nextOpenings, rooms, wallOutline: buildOutline(m), segments, problems, narrow: narrowArea(m), m };
}

// ---------------------------------------------------------------- live state
let host = { record() {}, changed() {} };
let modified = false, revision = 0, analysis = null, stateKey = null;
const foreign = new WeakMap();

/** Called once by the store: `record(opts)` takes the undo snapshot BEFORE a change, `changed(payload)` announces it. */
export function bindPlanHost(h) { host = { record: h.record || (() => {}), changed: h.changed || (() => {}) }; }

const solidsOf = (plan) => [...plan.walls, ...plan.openings];
const current = () => analysis || (analysis = derive(solidsOf(PLAN), PLAN.openings, PLAN.rooms, PLAN.walls));
const analysisOf = (plan) => {
  if (plan === PLAN) return current();
  if (!foreign.has(plan.walls)) foreign.set(plan.walls, derive(solidsOf(plan), plan.openings, plan.rooms, plan.walls));
  return foreign.get(plan.walls);
};

const GEOMETRY_KEYS = ['kind', 'axis', 'x', 'y', 'w', 'h', 'width', 'height', 'sill'];
const LOOK_KEYS = ['style', 'hinge', 'swing'];
const sameOpening = (a, b, keys) => keys.every((k) => a[k] === b[k]);

/** Do two wall lists cover exactly the same area? */
function sameSolid(a, b) {
  const area = (list) => list.reduce((s, r) => s + r.w * r.h, 0);
  if (area(a) !== area(b)) return false;
  const all = buildModel([...a, ...b], []), A = buildModel(a, [], all.xs, all.ys), B = buildModel(b, [], all.xs, all.ys);
  return A.cell.length === B.cell.length && A.cell.every((v, k) => v === B.cell[k]);
}

function isArchitectPlan(d) {
  const base = BASE_PLAN;
  if (d.openings.length !== base.openings.length || d.rooms.length !== base.rooms.length) return false;
  for (const b of base.openings) { const o = d.openings.find((x) => x.id === b.id); if (!o || !sameOpening(o, b, GEOMETRY_KEYS) || !sameOpening(o, b, LOOK_KEYS)) return false; }
  for (const b of base.rooms) { const r = d.rooms.find((x) => x.id === b.id); if (!r || r.name !== b.name || r.type !== b.type || !!r.wet !== !!b.wet) return false; }
  return sameSolid(d.walls, base.walls);
}

function setBase() {
  PLAN.walls = clone(BASE_PLAN.walls); PLAN.openings = clone(BASE_PLAN.openings);
  PLAN.rooms = clone(BASE_PLAN.rooms); PLAN.wallOutline = clone(BASE_PLAN.wallOutline);
  modified = false; analysis = null;
}

/** Install a derived plan as the live plan (no history, no event). Returns which parts changed. */
function install(d) {
  const before = [PLAN.walls, PLAN.openings, PLAN.rooms].map((a) => JSON.stringify(a));
  if (isArchitectPlan(d)) setBase();
  else { PLAN.walls = d.walls; PLAN.openings = d.openings; PLAN.rooms = d.rooms; PLAN.wallOutline = d.wallOutline; modified = true; analysis = d; }
  revision++; stateKey = null; invalidatePlanCaches();
  const after = [PLAN.walls, PLAN.openings, PLAN.rooms].map((a) => JSON.stringify(a));
  return { walls: before[0] !== after[0], openings: before[1] !== after[1], rooms: before[2] !== after[2] };
}

const doorless = (rooms, openings) => rooms.filter((r) => !openings.some((o) => o.kind !== 'window' && (o.rooms || []).includes(r.id)));

/** Record undo, install, announce. `res` = { level, ids, warnings? }. */
function commit(d, reason, res, opts = {}) {
  const had = new Set(doorless(PLAN.rooms, PLAN.openings).map((r) => r.id));
  host.record(opts);
  const changed = install(d);
  const warnings = [...(res.warnings || [])];
  if (res.level === 'warn' && res.reason) warnings.unshift(res.reason);
  if (res.level === 'permit') warnings.unshift(REASONS.permit);
  for (const r of doorless(PLAN.rooms, PLAN.openings)) if (!had.has(r.id)) warnings.push(`${r.name} has no door or passage now.`);
  host.changed({ reason, changed, transient: !!opts.transient });
  return { ok: true, level: res.level, warnings, ids: res.ids || [] };
}

// ---------------------------------------------------------------- persistence / history hooks (used by the store)
/** `{ walls, openings, rooms }` of an edited plan, or null while the plan is the architect's. */
export function planState() { return modified ? { walls: PLAN.walls, openings: PLAN.openings, rooms: PLAN.rooms } : null; }
/** JSON of planState(), cached per revision (cheap to compare in history snapshots). */
export function planStateKey() { return stateKey || (stateKey = JSON.stringify(planState())); }

const validRect = (r) => r && num(r.x) && num(r.y) && num(r.w) && num(r.h) && r.w > 0 && r.h > 0;
const validRoom = (r) => r && typeof r.id === 'string' && Array.isArray(r.polygon) && r.polygon.length >= 4 && r.polygon.every((p) => Array.isArray(p) && num(p[0]) && num(p[1])) && Array.isArray(r.label);

/**
 * Replace the live plan with a saved state (null → the architect's plan). Used by store undo / redo / load.
 * Never throws: an unusable or tampered state (locked parts changed) falls back to the architect's plan.
 * @returns {{ ok: boolean, reason?: string, changed: { walls, openings, rooms } }}
 */
export function applyPlanState(state) {
  const none = { walls: false, openings: false, rooms: false };
  const toBase = (reason) => {
    if (!modified) return { ok: !reason, reason, changed: none };
    const before = [PLAN.walls, PLAN.openings, PLAN.rooms].map((a) => JSON.stringify(a));
    setBase(); revision++; stateKey = null; invalidatePlanCaches();
    const base = [PLAN.walls, PLAN.openings, PLAN.rooms].map((a) => JSON.stringify(a));
    return { ok: !reason, reason, changed: { walls: before[0] !== base[0], openings: before[1] !== base[1], rooms: before[2] !== base[2] } };
  };
  if (!state) return toBase();
  try {
    if (JSON.stringify(state) === planStateKey()) return { ok: true, changed: none };
    const s = clone(state);
    if (!Array.isArray(s.walls) || !Array.isArray(s.openings) || !s.walls.every(validRect)
      || !s.openings.every((o) => validRect(o) && typeof o.id === 'string' && (o.axis === 'h' || o.axis === 'v'))) return toBase('The saved plan edits are not readable — the architect\'s plan was restored.');
    const prevRooms = Array.isArray(s.rooms) && s.rooms.length && s.rooms.every(validRoom) ? s.rooms : clone(BASE_PLAN.rooms);
    const d = derive([...s.walls, ...s.openings], s.openings, prevRooms, s.walls);
    const locked = analysisOf(BASE_PLAN).segments.filter((g) => g.policy.level === 'locked');
    const solids = [...d.walls, ...d.openings];
    const footprint = (walls, openings, rooms) => [...walls, ...openings].reduce((a, r) => a + r.w * r.h, 0) + rooms.reduce((a, r) => a + polygonArea(r.polygon), 0);
    const intact = d.problems.length === 0 && d.rooms.length > 0
      && locked.every((g) => coverage(g, solids) > 0.999)
      && Math.abs(footprint(d.walls, d.openings, d.rooms) - footprint(BASE_PLAN.walls, BASE_PLAN.openings, BASE_PLAN.rooms)) < 1
      && BASE_PLAN.openings.filter(inMamad).every((b) => { const o = d.openings.find((x) => x.id === b.id); return o && JSON.stringify(o) === JSON.stringify(b); });
    if (!intact) return toBase('The saved plan edits do not fit this house — the architect\'s plan was restored.');
    // keep the saved rectangles (ids included) when they describe the same walls, so undo / redo is exact
    const area = (list) => list.reduce((a, r) => a + r.w * r.h, 0);
    if (s.walls.every((w) => typeof w.id === 'string' && typeof w.kind === 'string') && area(s.walls) === area(d.walls)) d.walls = s.walls;
    return { ok: true, changed: install(d) };
  } catch (e) {
    return toBase('The saved plan edits could not be applied — the architect\'s plan was restored.');
  }
}

// ---------------------------------------------------------------- queries
/**
 * The selectable units of the plan: maximal straight stretches of wall (openings included) between junctions
 * with perpendicular walls / wall ends. Segments tile the wall solids exactly once. Treat the result as read-only.
 * @returns {Array<{ id, axis, x, y, w, h, thickness, length, cls, policy: { level, reason }, openingIds, isNew, core, between }>}
 */
export function wallSegments(plan = PLAN) { return analysisOf(plan).segments; }

/** Segment under / nearest to a plan point (within `tol` cm), or null. */
export function segmentAt(x, y, tol = 6) {
  let best = null, bd = Infinity;
  for (const s of current().segments) { const d = rectDist(x, y, s); if (d < bd) { bd = d; best = s; } }
  return best && bd <= tol ? best : null;
}

const segmentOfOpening = (o) => current().segments.find((s) => s.openingIds.includes(o.id)) || null;
function policyOfOpening(o) {
  if (inMamad(o) || o.style === 'mamad') return { level: 'locked', reason: REASONS.mamad };
  if (o.exterior) return { level: 'permit', reason: REASONS.permit };
  return { level: 'free', reason: '' };
}
/** What may be done with a door / window: `{ level: 'free' | 'permit' | 'locked', reason }`. */
export function openingPolicy(openingId) {
  const o = PLAN.openings.find((x) => x.id === openingId);
  return o ? policyOfOpening(o) : { level: 'locked', reason: 'No such opening.' };
}
/** True when the plan differs from the architect's. */
export function isPlanModified() { return modified; }

// ---------------------------------------------------------------- wall editing
/** Edit model of the current plan with extra grid lines, plus axis-agnostic accessors (u = across the wall, v = along it). */
function editModel(axis, alongExtra, crossExtra) {
  const h = axis === 'h';
  const m = buildModel(PLAN.walls, PLAN.openings, h ? alongExtra : crossExtra, h ? crossExtra : alongExtra);
  floodOutdoor(m); computeTypes(m);
  const A = h ? m.xs : m.ys, C = h ? m.ys : m.xs, K = h ? (u, v) => u * m.nx + v : (u, v) => v * m.nx + u;
  const rect = (c0, c1, a0, a1) => (h ? { x: a0, y: c0, w: a1 - a0, h: c1 - c0 } : { x: c0, y: a0, w: c1 - c0, h: a1 - a0 });
  return { m, A, C, K, rect, ai: (v) => lowerBound(A, v), ci: (v) => lowerBound(C, v) };
}
function wallRects(m) {
  const { nx, ny, cell, xs, ys } = m, rects = [];
  let open = new Map();
  for (let j = 0; j < ny; j++) {
    const row = new Map();
    for (let i = 0; i < nx;) {
      if (cell[j * nx + i] !== WALL) { i++; continue; }
      const s = i; while (i < nx && cell[j * nx + i] === WALL) i++;
      const key = s + ':' + i, r = open.get(key);
      if (r) { r.h = ys[j + 1] - r.y; row.set(key, r); } else { const nr = { x: xs[s], y: ys[j], w: xs[i] - xs[s], h: ys[j + 1] - ys[j] }; rects.push(nr); row.set(key, nr); }
    }
    open = row;
  }
  return rects;
}
const lockedAt = (rect) => current().segments.find((s) => s.policy.level === 'locked' && overlapArea(s, rect) > 0) || null;
const problemText = (d) => {
  const p = d.problems[0], o = d.openings.find((x) => x.id === p.id);
  const what = o ? (o.kind === 'window' ? 'a window' : o.kind === 'opening' ? 'a passage' : 'a door') : 'an opening';
  return p.type === 'overlap' ? 'Openings would overlap.' : `Too close to ${what} — keep at least ${MIN_JAMB} cm of wall beside it.`;
};
/** Are all cells of `rect` part of a wall bar with exactly this cross-section (or junction squares)? */
function isCleanBar(d, rect, axis) {
  const { m } = d, [i0, i1, j0, j1] = span(m, rect);
  let bar = 0;
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const k = j * m.nx + i;
    if (m.type[k] === T_J) continue;
    const c = m.cores[m.core0[k]];
    if (!c || c.axis !== axis || (axis === 'h' ? c.y !== rect.y || c.h !== rect.h : c.x !== rect.x || c.w !== rect.w)) return false;
    bar++;
  }
  return bar > 0;
}
const stubs = (d) => d.segments.filter((s) => (s.freeEnds[0] || s.freeEnds[1]) && (s.axis === 'h' ? s.core.w : s.core.h) < MIN_WALL).map((s) => s.id);
function fitChecks(d, rect, axis) {
  if (d.problems.length) return problemText(d);
  if (!isCleanBar(d, rect, axis)) return 'A wall cannot run along or on top of another wall.';
  if (d.narrow > current().narrow + 1) return `That would leave a space narrower than ${MIN_CLEAR} cm — join the wall to the next wall or leave at least ${MIN_CLEAR} cm.`;
  const old = new Set(stubs(current()));
  if (stubs(d).some((id) => !old.has(id))) return `That would leave a wall stub shorter than ${MIN_WALL} cm.`;
  return null;
}

/**
 * Trim / extend a wall drawn across [a, b] (cross-section [c0, c1]) to the faces of the walls it meets and check
 * every cell it would occupy. Works on an edit model in which the wall itself (if it exists) has been cleared.
 */
function fitWall(E, c0, c1, a, b) {
  const { m, A, K } = E, u0 = E.ci(c0), u1 = E.ci(c1);
  const slab = (v) => {
    if (v < 0 || v >= A.length - 1) return 'out';
    let walls = 0, free = 0;
    for (let u = u0; u < u1; u++) { const k = K(u, v), c = m.cell[k]; if (c === GAP) return 'opening'; if (c === WALL) walls++; else if (m.out[k]) return 'out'; else free++; }
    return walls === 0 ? 'free' : free === 0 ? 'wall' : 'mixed';
  };
  let ka = E.ai(a), kb = E.ai(b);
  if (slab(ka) === 'free') {
    let k = ka - 1, gap = 0;
    while (slab(k) === 'free' && gap <= TRIM) { gap += A[k + 1] - A[k]; k--; }
    if (gap <= TRIM && slab(k) === 'wall') ka = k + 1;
  } else while (ka < kb && slab(ka) === 'wall') ka++;
  if (slab(kb - 1) === 'free') {
    let k = kb, gap = 0;
    while (slab(k) === 'free' && gap <= TRIM) { gap += A[k + 1] - A[k]; k++; }
    if (gap <= TRIM && slab(k) === 'wall') kb = k;
  } else while (kb > ka && slab(kb - 1) === 'wall') kb--;
  if (kb <= ka || A[kb] - A[ka] < MIN_WALL) return fail(`A wall must be at least ${MIN_WALL} cm long.`);
  const rect = E.rect(c0, c1, A[ka], A[kb]);
  let fresh = 0;
  for (let v = ka; v < kb; v++) {
    const s = slab(v);
    if (s === 'out') return fail('A new wall must stay inside the house.');
    if (s === 'opening') return fail('A wall cannot run through a door or window.');
    if (s === 'mixed') return fail('A wall cannot run along or on top of another wall.');
    if (s === 'free') fresh += A[v + 1] - A[v];
    else { const hit = lockedAt(E.rect(c0, c1, A[v], A[v + 1])); if (hit) return fail(hit.cls === 'mamad' ? REASONS.mamad : 'A new wall cannot cross an exterior wall. ' + REASONS.exteriorWall); }
  }
  if (!fresh) return fail('There is already a wall here.');
  if (MAMAD.shell && overlapArea(rect, MAMAD.shell) > 0) return fail('No walls may be built inside the safe room. ' + REASONS.mamad);
  if (slab(ka - 1) === 'opening' || slab(kb) === 'opening') return fail('A wall cannot end on a door or window.');
  return { ok: true, rect, ka, kb, u0, u1 };
}

function planAddWall(input) {
  const p = input || {};
  if (![p.x1, p.y1, p.x2, p.y2].every(num)) return fail('A wall needs two points.');
  const t = Math.round(p.thickness == null ? NEW_WALL.def : p.thickness);
  if (!(t >= NEW_WALL.min && t <= NEW_WALL.max)) return fail(`New partitions are ${NEW_WALL.min}–${NEW_WALL.max} cm thick.`);
  const x1 = snap(p.x1), y1 = snap(p.y1), x2 = snap(p.x2), y2 = snap(p.y2);
  const axis = Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? 'h' : 'v';
  const a = axis === 'h' ? Math.min(x1, x2) : Math.min(y1, y2), b = axis === 'h' ? Math.max(x1, x2) : Math.max(y1, y2);
  if (b - a < SNAP) return fail(`A wall must be at least ${MIN_WALL} cm long.`);
  const c0 = snap((axis === 'h' ? y1 : x1) - t / 2), c1 = c0 + t;
  const E = editModel(axis, [a, b], [c0, c1]);
  const fit = fitWall(E, c0, c1, a, b);
  if (!fit.ok) return fit;
  paint(E.m, fit.rect, WALL);
  const d = derive([...wallRects(E.m), ...PLAN.openings], PLAN.openings, PLAN.rooms, PLAN.walls);
  const bad = fitChecks(d, fit.rect, axis);
  if (bad) return fail(bad);
  return { ok: true, rect: fit.rect, level: 'free', axis, d };
}

/** Dry run of addWall for live feedback while drawing: `{ ok, reason?, rect?, level? }` (rect = the trimmed wall). */
export function canAddWall(input) {
  const r = planAddWall(input);
  return r.ok ? { ok: true, rect: r.rect, level: r.level } : r;
}

const idsIn = (d, rect, axis) => d.segments.filter((s) => s.axis === axis && overlapArea(s.core, rect) > 0).map((s) => s.id);

/**
 * Draw a new partition from (x1, y1) to (x2, y2) (centre line, cm). Axis-aligned (the smaller delta is dropped),
 * snapped to 5 cm, trimmed / extended (≤ 15 cm) to the faces of the walls it meets.
 */
export function addWall(input, opts) {
  const r = planAddWall(input);
  if (!r.ok) return r;
  return commit(r.d, 'add-wall', { level: 'free', ids: idsIn(r.d, r.rect, r.axis) }, opts);
}

const findSegment = (id) => current().segments.find((s) => s.id === id) || null;
function editableSegment(id) {
  const s = findSegment(id);
  if (!s) return fail('No such wall.');
  if (s.policy.level === 'locked') return fail(s.policy.reason);
  return { ok: true, s };
}
const coreSpan = (s) => (s.axis === 'h' ? { c0: s.core.y, c1: s.core.y + s.core.h, a0: s.core.x, a1: s.core.x + s.core.w } : { c0: s.core.x, c1: s.core.x + s.core.w, a0: s.core.y, a1: s.core.y + s.core.h });
const inCore = (s) => (o) => overlapArea(o, s.core) > 0;

/** Remove a wall segment and the openings in it. Junction squares stay with the walls that meet there. */
export function removeWallSegment(segmentId, opts) {
  const q = editableSegment(segmentId);
  if (!q.ok) return q;
  const { s } = q, E = editModel(s.axis, [], []);
  paint(E.m, s.core, FREE);
  const openings = PLAN.openings.filter((o) => !inCore(s)(o));
  const d = derive([...wallRects(E.m), ...openings], openings, PLAN.rooms, PLAN.walls);
  if (d.problems.length) return fail(problemText(d));
  return commit(d, 'remove-wall', { level: s.policy.level, reason: s.policy.reason, ids: [segmentId] }, opts);
}

/**
 * Move a wall segment sideways by `delta` cm (+ = east / south). Walls that meet its ends stretch or shrink to
 * follow; its doors travel with it.
 */
export function moveWallSegment(segmentId, delta, opts) {
  const q = editableSegment(segmentId);
  if (!q.ok) return q;
  const d0 = snap(num(delta) ? delta : 0), { s } = q;
  if (!d0) return { ok: true, level: s.policy.level, warnings: [], ids: [segmentId] };
  const { c0, c1, a0, a1 } = coreSpan(s), t = c1 - c0, n0 = c0 + d0, n1 = c1 + d0;
  const E = editModel(s.axis, [a0 + t, a1 - t], [n0, n1]), { m, K } = E;
  const uc0 = E.ci(c0), uc1 = E.ci(c1), un0 = E.ci(n0), un1 = E.ci(n1), va0 = E.ai(a0), va1 = E.ai(a1);
  const cross = 'That would cross another wall.';
  for (let v = va0; v < va1; v++) for (let u = d0 > 0 ? uc1 : un0; u < (d0 > 0 ? un1 : uc0); u++) {
    const k = K(u, v);
    if (m.cell[k]) return fail(cross);
    if (m.out[k]) return fail('A wall cannot leave the house.');
  }
  const hull0 = Math.min(uc0, un0), hull1 = Math.max(uc1, un1), fill = [], clear = [];
  for (const end of [{ v: va0 - 1, dir: -1 }, { v: va1, dir: 1 }]) {
    const across = (v, u0, u1, test) => { for (let u = u0; u < u1; u++) if (!test(K(u, v))) return false; return true; };
    if (across(end.v, uc0, uc1, (k) => !m.cell[k])) continue;                                    // free end
    if (!across(end.v, uc0, uc1, (k) => m.cell[k] === WALL)) return fail('That wall end meets a door or window — it cannot move.');
    if (across(end.v, uc0, uc1, (k) => m.type[k] === T_J)) {
      const rows = [];
      let v = end.v;
      while (across(v, uc0, uc1, (k) => m.cell[k] && m.type[k] === T_J)) { rows.push(v); v += end.dir; }
      const continues = across(v, uc0, uc1, (k) => m.cell[k] !== FREE);
      const landed = rows.every((r) => across(r, un0, un1, (k) => m.cell[k] === WALL));
      for (const r of rows) for (let u = hull0; u < hull1; u++) {                               // stretch the wall it meets
        const k = K(u, r);
        if (m.cell[k] === GAP) return fail('A door or window is in the way.');
        if (m.cell[k] === FREE) { if (m.out[k]) return fail('A wall cannot leave the house.'); fill.push(k); }
      }
      const trail = d0 > 0 ? uc0 - 1 : uc1, s0 = d0 > 0 ? uc0 : un1, s1 = d0 > 0 ? un0 : uc1;
      if (!continues && landed && rows.every((r) => m.cell[K(trail, r)] === FREE)                   // an L-corner: shrink the wall it meets
        && rows.every((r) => across(r, s0, s1, (k) => m.cell[k] === WALL)) && across(v, s0, s1, (k) => m.cell[k] === FREE)
        && !lockedAt(E.rect(E.C[s0], E.C[s1], E.A[Math.min(...rows)], E.A[Math.max(...rows) + 1]))) for (const r of rows) for (let u = s0; u < s1; u++) clear.push(K(u, r));
    } else if (!across(end.v, un0, un1, (k) => m.cell[k] === WALL)) {                             // collinear wall of another thickness: keep them joined with a jog
      if (a1 - a0 < 2 * t + MIN_WALL) return fail('That wall is too short to move on its own.');
      const j0 = end.dir < 0 ? va0 : E.ai(a1 - t), j1 = end.dir < 0 ? E.ai(a0 + t) : va1;
      for (let jv = j0; jv < j1; jv++) for (let u = hull0; u < hull1; u++) fill.push(K(u, jv));
    }
  }
  for (let v = va0; v < va1; v++) { for (let u = uc0; u < uc1; u++) m.cell[K(u, v)] = FREE; }
  for (let v = va0; v < va1; v++) { for (let u = un0; u < un1; u++) m.cell[K(u, v)] = WALL; }
  for (const k of clear) m.cell[k] = FREE;
  for (const k of fill) m.cell[k] = WALL;
  const moved = inCore(s), shift = s.axis === 'h' ? { y: d0 } : { x: d0 };
  const openings = PLAN.openings.map((o) => (moved(o) ? { ...o, x: o.x + (shift.x || 0), y: o.y + (shift.y || 0) } : o));
  const target = E.rect(n0, n1, a0, a1);
  const d = derive([...wallRects(m), ...openings], openings, PLAN.rooms, PLAN.walls);
  const bad = fitChecks(d, target, s.axis);
  if (bad) return fail(bad === 'A wall cannot run along or on top of another wall.' ? cross : bad);
  return commit(d, 'move-wall', { level: s.policy.level, reason: s.policy.reason, ids: idsIn(d, target, s.axis) }, opts);
}

/**
 * Change where a wall segment starts / ends along its own axis (plan cm; omitted = unchanged). Ends are trimmed /
 * extended to wall faces like addWall. Shortening an end that met another wall leaves a gap of ≥ 60 cm.
 */
export function resizeWallSegment(segmentId, range, opts) {
  const q = editableSegment(segmentId);
  if (!q.ok) return q;
  const { s } = q, { c0, c1, a0, a1 } = coreSpan(s), r = range || {};
  const a = num(r.start) ? snap(r.start) : a0, b = num(r.end) ? snap(r.end) : a1;
  if (a === a0 && b === a1) return { ok: true, level: s.policy.level, warnings: [], ids: [segmentId] };
  if (b - a < MIN_WALL) return fail(`A wall must be at least ${MIN_WALL} cm long.`);
  const E = editModel(s.axis, [a, b], []);
  paint(E.m, s.core, FREE);
  const fit = fitWall(E, c0, c1, a, b);
  if (!fit.ok) return fit;
  paint(E.m, fit.rect, WALL);
  if (PLAN.openings.some((o) => inCore(s)(o) && overlapArea(o, fit.rect) < o.w * o.h)) return fail('Remove the door in this part of the wall first.');
  const d = derive([...wallRects(E.m), ...PLAN.openings], PLAN.openings, PLAN.rooms, PLAN.walls);
  const bad = fitChecks(d, fit.rect, s.axis);
  if (bad) return fail(bad);
  return commit(d, 'resize-wall', { level: s.policy.level, reason: s.policy.reason, ids: idsIn(d, fit.rect, s.axis) }, opts);
}

// ---------------------------------------------------------------- openings
const along = (o) => (o.axis === 'h' ? o.x : o.y);
const labelOf = (o) => `${o.width} / ${o.height}` + (o.sill ? `(+${o.sill})` : '');

/** Start coordinate for an opening of `width` in segment `s`, as close to `want` as the wall allows (or null). */
function slot(s, width, want, ignoreId) {
  const { a0, a1 } = coreSpan(s);
  const taken = PLAN.openings.filter((o) => o.id !== ignoreId && inCore(s)(o)).map((o) => [along(o) - MIN_JAMB, along(o) + o.width + MIN_JAMB]).sort((p, q) => p[0] - q[0]);
  const gaps = [];
  let from = a0 + MIN_JAMB;
  for (const [p, q] of taken) { if (p > from) gaps.push([from, p]); from = Math.max(from, q); }
  if (a1 - MIN_JAMB > from) gaps.push([from, a1 - MIN_JAMB]);
  let best = null;
  for (const [p, q] of gaps) {
    const lo = Math.ceil(p / SNAP) * SNAP, hi = Math.floor((q - width) / SNAP) * SNAP;
    if (hi < lo) continue;
    const at = Math.max(lo, Math.min(hi, snap(want)));
    if (best == null || Math.abs(at - want) < Math.abs(best - want)) best = at;
  }
  return best;
}
const openingRect = (s, start, width) => (s.axis === 'h' ? { x: start, y: s.core.y, w: width, h: s.core.h } : { x: s.core.x, y: start, w: s.core.w, h: width });

function checkSize(kind, width, height, sill) {
  const K = OPENING_KINDS[kind];
  if (!(width >= K.minW && width <= K.maxW)) return `Width must be ${K.minW}–${K.maxW} cm.`;
  if (!(height >= K.minH && height <= K.maxH)) return `Height must be ${K.minH}–${K.maxH} cm.`;
  if (kind !== 'window' && sill !== 0) return 'Doors and passages start at the floor.';
  if (!(sill >= 0) || sill + height > PLAN.heights.ceiling - HEAD_ROOM) return `Sill + height must stay ${HEAD_ROOM} cm below the ${PLAN.heights.ceiling} cm ceiling.`;
  return null;
}

function planAddOpening(input) {
  const p = input || {}, K = OPENING_KINDS[p.kind];
  if (!K) return fail('Unknown opening kind.');
  if (!num(p.x) || !num(p.y)) return fail('An opening needs a position.');
  const width = snap(num(p.width) ? p.width : K.width);
  let s = null, sd = Infinity;
  for (const g of current().segments) { if (g.id.startsWith('seg:j')) continue; const dist = rectDist(p.x, p.y, g.core); if (dist < sd) { sd = dist; s = g; } }
  if (!s || sd > REACH) return fail('There is no wall here.');
  if (s.cls === 'mamad') return fail(REASONS.mamad);
  const exterior = s.cls === 'exterior';
  if (p.kind === 'window' && !exterior) return fail('Windows belong in exterior walls — use a door or an open passage between rooms.');
  if (p.kind === 'opening' && exterior) return fail('An opening in an exterior wall needs a door or a window.');
  if (!(width >= K.minW && width <= K.maxW)) return fail(`Width must be ${K.minW}–${K.maxW} cm.`);
  const start = slot(s, width, (s.axis === 'h' ? p.x : p.y) - width / 2, null);
  if (start == null) return fail(`There is not enough free wall here for a ${width} cm opening.`);
  return { ok: true, segmentId: s.id, rect: openingRect(s, start, width), level: exterior ? 'permit' : 'free', s, width, start };
}

/**
 * Dry run of addOpening: where would a `kind` of `width` centred near (x, y) land?
 * @returns {{ ok, reason?, segmentId?, rect?, level? }}
 */
export function canAddOpening(input) {
  const r = planAddOpening(input);
  return r.ok ? { ok: true, segmentId: r.segmentId, rect: r.rect, level: r.level } : r;
}

const newOpeningId = (kind) => { const pre = kind === 'window' ? 'win' : kind === 'opening' ? 'pass' : 'door'; let n = 1; while (PLAN.openings.some((o) => o.id === `${pre}-new-${n}`)) n++; return `${pre}-new-${n}`; };
const HINGES = { h: ['w', 'e'], v: ['n', 's'] }, SWINGS = { h: ['n', 's'], v: ['w', 'e'] };

/**
 * Cut a door / window / sliding door / door-less passage into the wall nearest to (x, y).
 * Defaults: door 80 × 210, window 100 × 100 sill 110, sliding door 160 × 210, passage 90 × 210.
 */
export function addOpening(input, opts) {
  const r = planAddOpening(input);
  if (!r.ok) return r;
  const p = input, K = OPENING_KINDS[p.kind], { s } = r, exterior = s.cls === 'exterior';
  const height = num(p.height) ? Math.round(p.height) : K.height, sill = num(p.sill) ? Math.round(p.sill) : K.sill;
  const bad = checkSize(p.kind, r.width, height, sill);
  if (bad) return fail(bad);
  const style = p.style == null ? (exterior && K.extStyle) || K.style : p.style;
  if (!K.styles.includes(style)) return fail(`Style must be one of: ${K.styles.join(', ')}.`);
  const o = { id: newOpeningId(p.kind), kind: p.kind, style, axis: s.axis, ...r.rect, width: r.width, height, sill };
  if (p.kind === 'door') {
    const { a0, a1 } = coreSpan(s), hinges = HINGES[s.axis], swings = SWINGS[s.axis];
    const size = (id) => { const room = PLAN.rooms.find((x) => x.id === id); return room ? polygonArea(room.polygon) : Infinity; };
    o.hinge = hinges.includes(p.hinge) ? p.hinge : r.start - a0 <= a1 - (r.start + r.width) ? hinges[0] : hinges[1];
    o.swing = swings.includes(p.swing) ? p.swing : size(s.between[0]) <= size(s.between[1]) ? swings[0] : swings[1];
  }
  o.rooms = [];
  o.label = labelOf(o);
  const openings = [...PLAN.openings, o];
  const d = derive(solidsOf(PLAN), openings, PLAN.rooms, PLAN.walls);
  if (d.problems.length) return fail(problemText(d));
  return commit(d, 'add-opening', { level: r.level, ids: [o.id] }, opts);
}

/**
 * Change a door / window. patch: { offset (cm from the start of its wall segment) | x, y (new centre — it slides
 * along its own wall, kept ≥ 10 cm from wall ends and other openings), width, height, sill, style, hinge, swing }.
 */
export function updateOpening(id, patch, opts) {
  const o = PLAN.openings.find((x) => x.id === id), p = patch || {};
  if (!o) return fail('No such opening.');
  const policy = policyOfOpening(o);
  if (policy.level === 'locked') return fail(policy.reason);
  const s = segmentOfOpening(o), K = OPENING_KINDS[o.kind];
  if (!s || !K) return fail('This opening cannot be edited.');
  const next = { ...o };
  if (num(p.width)) next.width = snap(p.width);
  if (num(p.height)) next.height = Math.round(p.height);
  if (num(p.sill)) next.sill = Math.round(p.sill);
  if (p.style != null) { if (!K.styles.includes(p.style)) return fail(`Style must be one of: ${K.styles.join(', ')}.`); next.style = p.style; }
  for (const [key, table] of [['hinge', HINGES], ['swing', SWINGS]]) {
    if (p[key] == null) continue;
    if (o.kind !== 'door' || !table[o.axis].includes(p[key])) return fail(`A ${key} of '${p[key]}' does not fit this ${o.kind === 'door' ? 'wall' : 'opening'}.`);
    next[key] = p[key];
  }
  const bad = checkSize(o.kind, next.width, next.height, next.sill);
  if (bad) return fail(bad);
  const { a0 } = coreSpan(s), centre = along(o) + o.width / 2;
  const want = num(p.offset) ? a0 + p.offset : (num(p.x) || num(p.y)) && num(o.axis === 'h' ? p.x : p.y) ? (o.axis === 'h' ? p.x : p.y) - next.width / 2 : centre - next.width / 2;
  const start = slot(s, next.width, want, o.id);
  if (start == null) return fail(`There is not enough free wall here for a ${next.width} cm opening.`);
  Object.assign(next, openingRect(s, start, next.width));
  const geometry = !sameOpening(next, o, GEOMETRY_KEYS);
  if (!geometry && sameOpening(next, o, LOOK_KEYS)) return { ok: true, level: 'free', warnings: [], ids: [id] };
  if (next.width !== o.width || next.height !== o.height || next.sill !== o.sill) {
    if (o.label != null || o.kind === 'window') next.label = labelOf(next);
    if (o.assumed) { const left = o.assumed.filter((k) => next[k] === o[k]); if (left.length) next.assumed = left; else delete next.assumed; }
  }
  const openings = PLAN.openings.map((x) => (x === o ? next : x));
  const d = derive(solidsOf(PLAN), openings, PLAN.rooms, PLAN.walls);
  if (d.problems.length) return fail(problemText(d));
  return commit(d, 'update-opening', { level: geometry && policy.level === 'permit' ? 'permit' : 'free', ids: [id] }, opts);
}

/** Remove a door / window; the gap is filled with wall. */
export function removeOpening(id, opts) {
  const o = PLAN.openings.find((x) => x.id === id);
  if (!o) return fail('No such opening.');
  const policy = policyOfOpening(o);
  if (policy.level === 'locked') return fail(policy.reason);
  const openings = PLAN.openings.filter((x) => x !== o);
  const d = derive(solidsOf(PLAN), openings, PLAN.rooms, PLAN.walls);
  if (d.problems.length) return fail(problemText(d));
  return commit(d, 'remove-opening', { level: policy.level, ids: [id] }, opts);
}

/** Re-hang a door: 'hinge' swaps the hinge jamb, 'swing' the side it opens into. */
export function flipDoor(id, how, opts) {
  const o = PLAN.openings.find((x) => x.id === id);
  if (!o) return fail('No such opening.');
  if (o.kind !== 'door' || (how !== 'hinge' && how !== 'swing')) return fail('Only hinged doors can be flipped (hinge or swing).');
  const pair = (how === 'hinge' ? HINGES : SWINGS)[o.axis];
  return updateOpening(id, { [how]: o[how] === pair[0] ? pair[1] : pair[0] }, opts);
}

/** Rename / re-type a room: patch { name, nameHe, type, wet }. Names follow the room through later edits. */
export function updateRoom(id, patch, opts) {
  const room = PLAN.rooms.find((r) => r.id === id), p = patch || {};
  if (!room) return fail('No such room.');
  const next = { ...room };
  for (const k of ['name', 'nameHe', 'type']) if (typeof p[k] === 'string' && p[k].trim()) next[k] = p[k].trim();
  if (typeof p.wet === 'boolean') { if (p.wet) next.wet = true; else delete next.wet; }
  if (JSON.stringify(next) === JSON.stringify(room)) return { ok: true, level: 'free', warnings: [], ids: [id] };
  const d = { ...current(), walls: PLAN.walls, openings: PLAN.openings, wallOutline: PLAN.wallOutline, rooms: PLAN.rooms.map((r) => (r === room ? next : r)) };
  return commit(d, 'update-room', { level: 'free', ids: [id] }, opts);
}

/** Back to the architect's plan (one undo step). */
export function resetPlan(opts = {}) {
  if (!modified) return { ok: true, level: 'free', warnings: [], ids: [] };
  host.record(opts);
  const res = applyPlanState(null);
  host.changed({ reason: 'reset', changed: res.changed, transient: !!opts.transient });
  return { ok: true, level: 'free', warnings: [], ids: [] };
}

// ---------------------------------------------------------------- diff against the architect's plan
const spaceName = (id) => {
  if (id == null || id === 'outside') return 'outside';
  const s = PLAN.rooms.find((r) => r.id === id) || BASE_PLAN.rooms.find((r) => r.id === id) || BASE_PLAN.outdoorAreas.find((r) => r.id === id);
  return s ? s.name : id;
};
const centreOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const wallName = (s) => `${s.thickness} cm ${s.cls === 'partition' ? 'partition' : 'wall'}`;
const sides = (s) => (s.between[0] === s.between[1] ? `in ${spaceName(s.between[0])}` : `between ${spaceName(s.between[0])} and ${spaceName(s.between[1])}`);
const openingName = (o) => (o.kind === 'window' ? 'window' : o.kind === 'opening' ? 'passage' : o.kind === 'sliding-door' ? 'sliding door' : 'door');
const whereOpening = (o) => (o.rooms || []).map(spaceName).join(' / ');

/**
 * What the owner changed compared with the architect's plan, for the "changes" list and the permit summary.
 * @returns {{ changed: boolean, items: Array<{ kind, level: 'free'|'warn'|'permit', text, at: {x, y}, ref }> }}
 */
export function planDiff() {
  const items = [];
  if (!modified) return { changed: false, items };
  const base = analysisOf(BASE_PLAN), cur = current(), solids = solidsOf(PLAN), coreLen = (s) => (s.axis === 'h' ? s.core.w : s.core.h);
  const gone = base.segments.filter((s) => coverage(s.core, solids) < 0.5), added = cur.segments.filter((s) => s.isNew && !s.id.startsWith('seg:j'));
  for (const g of gone) {
    const pos = (s) => (s.axis === 'h' ? s.core.y : s.core.x), a = coreSpan(g);
    const twin = added.find((n) => { const b = coreSpan(n); return n.axis === g.axis && n.thickness === g.thickness && Math.abs(pos(n) - pos(g)) <= 200 && overlapLen(a.a0, a.a1, b.a0, b.a1) >= 0.5 * Math.min(coreLen(g), coreLen(n)); });
    if (twin) {
      added.splice(added.indexOf(twin), 1);
      const by = pos(twin) - pos(g), dir = g.axis === 'h' ? (by > 0 ? 'south' : 'north') : (by > 0 ? 'east' : 'west');
      items.push({ kind: 'wall-moved', level: g.policy.level, text: `Moved the ${wallName(g)} ${sides(g)} ${Math.abs(by)} cm ${dir}`, at: centreOf(twin.core), ref: twin.id });
    } else items.push({ kind: 'wall-removed', level: g.policy.level, text: `Removed the ${wallName(g)} ${sides(g)} (${metres(coreLen(g))})`, at: centreOf(g.core), ref: g.id });
  }
  for (const n of added) items.push({ kind: 'wall-added', level: 'free', text: `New ${n.thickness} cm partition ${sides(n)} (${metres(coreLen(n))})`, at: centreOf(n.core), ref: n.id });
  if (!items.length && !sameSolid(PLAN.walls.concat(PLAN.openings), BASE_SOLIDS)) {
    const a = cur.segments.find((s) => coverage(s.core, BASE_SOLIDS) < 0.999) || base.segments.find((s) => coverage(s.core, solids) < 0.999);
    if (a) items.push({ kind: 'wall-moved', level: a.policy.level === 'locked' ? 'free' : a.policy.level, text: `Changed the length of the ${wallName(a)} ${sides(a)}`, at: centreOf(a.core), ref: a.id });
  }
  for (const b of BASE_PLAN.openings) {
    const o = PLAN.openings.find((x) => x.id === b.id), level = b.exterior ? 'permit' : 'free';
    if (!o) { if (coverage(b, solids) >= 0.5) items.push({ kind: 'opening-removed', level, text: `Closed the ${openingName(b)} (${b.width} cm) — ${whereOpening(b)}`, at: centreOf(b), ref: b.id }); continue; }
    const what = [];
    if (o.x !== b.x || o.y !== b.y) what.push(`moved ${Math.abs(o.x - b.x) + Math.abs(o.y - b.y)} cm`);
    if (o.width !== b.width) what.push(`width ${b.width} → ${o.width} cm`);
    if (o.height !== b.height) what.push(`height ${b.height} → ${o.height} cm`);
    if (o.sill !== b.sill) what.push(`sill ${b.sill} → ${o.sill} cm`);
    const geometry = what.length > 0;
    if (o.style !== b.style) what.push(`style ${o.style}`);
    if (o.hinge !== b.hinge || o.swing !== b.swing) what.push('re-hung');
    if (what.length) items.push({ kind: 'opening-changed', level: geometry ? level : 'free', text: `${openingName(o)[0].toUpperCase() + openingName(o).slice(1)} — ${whereOpening(o)}: ${what.join(', ')}`, at: centreOf(o), ref: o.id });
  }
  for (const o of PLAN.openings) if (!BASE_PLAN.openings.some((b) => b.id === o.id)) items.push({ kind: 'opening-added', level: o.exterior ? 'permit' : 'free', text: `New ${openingName(o)} ${labelOf(o)} — ${whereOpening(o)}`, at: centreOf(o), ref: o.id });
  return { changed: true, items };
}

/** Test / tooling hook: everything derived from a plan's walls + openings (the same function used on load and after every edit). */
export function recomputePlan(plan = PLAN) {
  const d = derive(solidsOf(plan), plan.openings, plan.rooms, plan.walls);
  return { walls: d.walls, openings: d.openings, rooms: d.rooms, wallOutline: d.wallOutline, problems: d.problems };
}
