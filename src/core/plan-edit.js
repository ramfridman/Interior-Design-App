/**
 * PLAN EDITING ENGINE — change interior walls, doors and windows "based on what is allowed".
 * Pure logic (no DOM, no THREE). See docs/CONTRACT.md § 7 for the public contract.
 *
 * MODEL
 *   `PLAN` (plan.js) is one shared object. An edit replaces PLAN.walls / openings / rooms / wallOutline with NEW
 *   arrays (same PLAN identity) and then tells the store, which records undo and emits 'plan'.
 *   `BASE_PLAN` is a deep-frozen copy of the base plan (the architect's for House 98; another project's after
 *   `setBasePlan()`), used for classification, diffing and reset. Phase 'draft' (see setPlanPhase) lifts every lock.
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
 *   A level with ANGLED WALLS (`slants`, stage A1) takes the mixed derive instead (deriveMixed below): rooms, outdoors
 *   and the outline come from exact polygons (polykernel), the rect walls keep the grid. Without slants the code path
 *   is exactly the one above.
 */
import { PLAN } from './plan.js';
import { pointInPolygon, polygonArea, invalidatePlanCaches } from './geometry.js';
import { OPTIONAL_KEYS, optionalKeysProblem, optionalPart, setOptionalKeys, normalizeOptionalKeys } from './plan-schema.js';
import { GROUND, upperLevels, levelOf, levelIndex, nextLevelId, recomputeElevations, levelName, footprintOf, levelIds, levelElevation, levelHeights, voidsOf, annotateVoids } from './levels.js';
import { stairGeometry, stairProblems, requiredVoid, proposeStair, SHAPES as STAIR_SHAPES } from './stairs.js';
import { faces as polyFaces, intersectArea, netArea, union as polyUnion, slitJoin, intersection as polyIntersection, difference as polyDifference } from './polykernel.js';
import { slantFrame, slantJoins, freePoly, atOf, openingQuad } from './slant-geom.js';
import { isAngledOpening, hasSlants, slantLevel, checkAngledOpenings, spaceLocator, labelCells, outlineEdges, slantSolids, quadOfOpening, denoiseFaces,
  r01, nearAxis, lineCross, snapSlantEnd, nearRects, centreIn, polyGap, bandExtent, clearPieces, bothFaces, openingRanges } from './slants.js';
import { normalizeOptionalKeys as normOpt } from './plan-schema.js';

/** Plan keys written only when needed (schema 2: angled walls, several levels — see plan-schema.js). Never on House 98. */
export { OPTIONAL_KEYS };

// ---------------------------------------------------------------- constants
const SNAP = 5;            // cm — every edit snaps to this grid
const TMAX = 30;           // cm — thickest wall (mamad south wall); longer runs in both directions = junction
const THICK = 15;          // cm — interior walls at least this thick may be structural
const MIN_JAMB = 10;       // cm of solid wall kept between an opening and wall ends / other openings
const CORNER_REACH = 20;   // cm — a door this close to a wall that ends on its wall travels with that wall when it moves
const MIN_WALL = 30;       // cm — shortest wall a user can draw; shorter free-ended leftovers are refused
const MIN_CLEAR = 60;      // cm — narrowest free space an edit may create
const TRIM = 15;           // cm — a drawn wall end this close to a wall face is extended to it
const REACH = 60;          // cm — how far addOpening looks for a wall around the requested point
const NEW_WALL = { min: 7, max: 20, def: 10, draftMax: TMAX };   // while drafting, exterior and safe-room walls (≤ 30 cm) can be drawn too

export const REASONS = Object.freeze({
  mamad: 'Altering the protective shell, door or window of a mamad (safe room) is prohibited by the Civil Defence (shelter specifications) regulations.',
  exteriorWall: 'Exterior walls are the building envelope and structure — they cannot be added, moved or removed. Their windows and doors can be changed with a building-permit amendment.',
  permit: 'Changing an exterior opening requires a building-permit amendment.',
  thick: (t) => `This ${t} cm wall may be structural — confirm with your structural engineer before changing it.`,
  level: 'Adding or removing a floor, or changing its height, changes the building — it requires a building permit.',
  // stage F4b
  stair: 'A stair and the opening it needs in the floor above change the structure of the building — they need a building-permit amendment.',
  // stage A1 texts, no longer returned since stage A2 (kept for callers that still compare with them)
  angledWalls: 'This floor has angled walls: its walls cannot be drawn, moved or removed here yet. Doors and windows in its straight walls, and room names, can be changed.',
  angledOpening: 'Doors and windows in angled walls cannot be added, moved or re-hung here yet — they can be removed.',
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

// ---------------------------------------------------------------- base plan (switchable, see setBasePlan)
/**
 * The plan edits are measured against: deep-frozen, same shape as PLAN. It is House 98 (the architect's plan) unless a
 * project with another house is open — `setBasePlan()` replaces it (ES live binding: importers always see the current one).
 */
export let BASE_PLAN = deepFreeze(clone(PLAN));
/** The built-in house (House 98, the architect's plan) — deep-frozen, never changes. */
export const BUILTIN_PLAN = BASE_PLAN;
const BUILTIN_KEY = JSON.stringify(BUILTIN_PLAN);
/** Keys of a PLAN-shaped object, in PLAN's own order (the built-in plan's: the optional keys are not among them). */
export const PLAN_KEYS = Object.freeze(Object.keys(PLAN));
/** Deep copy of the optional keys a plan carries (an empty object for a schema-1 plan). */
const optionalCopy = (p) => clone(optionalPart(p));
const sameOptional = (a, b) => JSON.stringify(optionalPart(a)) === JSON.stringify(optionalPart(b));

/** Safe-room shell of a base plan (it is locked, so it never changes while that plan is the base). */
function mamadOf(base) {
  const room = base.rooms.find((r) => r.id === 'mamad') || base.rooms.find((r) => r.type === 'mamad');
  const walls = base.walls.filter((w) => w.kind === 'mamad');
  if (!room) return { room: null, shell: null, rects: walls };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of room.polygon) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const inner = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  // expand the room outward to the outer faces of the shelter walls that surround it
  const grown = { x: x0 - 1, y: y0 - 1, w: x1 - x0 + 2, h: y1 - y0 + 2 };
  for (const w of walls) if (overlapArea(w, grown) > 0) { x0 = Math.min(x0, w.x); y0 = Math.min(y0, w.y); x1 = Math.max(x1, w.x + w.w); y1 = Math.max(y1, w.y + w.h); }
  const shell = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  return { room: inner, shell, rects: [shell, ...walls.filter((w) => overlapArea(w, shell) < w.w * w.h)] };
}
const NO_MAMAD = Object.freeze({ room: null, shell: null, rects: [] });
const isJunction = (s) => s.id.includes('seg:j:');

/**
 * Everything the derivation reads from the base plan, swapped as a whole when the base plan or the phase changes.
 * Phase 'draft' = the owner is still drawing the existing house: nothing is locked, nothing needs a permit, nothing is
 * "a change to the plan" (no safe-room shell, no base solids). Phase 'fixed' = the base plan is the house as built.
 */
function makeEnv(base, ph) {
  const draft = ph === 'draft';
  const env = { draft, solids: [...base.walls, ...rectOpenings(base.openings)], mamad: draft ? NO_MAMAD : mamadOf(base), outdoorAreas: base.outdoorAreas || [], baseWalls: base.walls };
  if (!draft && hasSlants(base)) env.slantSolids = baseSlantSolids(base.slants, env.solids, base.openings);
  return env;
}
/** Rect openings of a list (openings in slants, axis 'a', have no gap rectangle). */
function rectOpenings(list) { for (const o of list) if (o.axis === 'a') return list.filter((x) => x.axis !== 'a'); return list; }
/** Footprints of a base level's slants and their openings' gaps (for "is this angled wall new?"). */
function baseSlantSolids(slants, rects, openings) {
  const lv = slantLevel(slants, rects), { polys, quads } = slantSolids(lv, openings);
  return [...polys, ...quads];
}
let phase = 'fixed';
let ENV = makeEnv(BASE_PLAN, phase);
const inMamad = (r) => ENV.mamad.rects.some((s) => overlapArea(r, s) > 0);
/** Is an opening (rect, or in a slant: its gap quad) inside the safe-room shell? */
function inMamadOpening(o) {
  if (!isAngledOpening(o)) return inMamad(o);
  const q = ENV.mamad.rects.length ? quadOfOpening(o) : null;
  return !!q && intersectArea(q, ENV.mamad.rects) > 1;
}

const outdoorAt = (x, y) => { for (const o of ENV.outdoorAreas) if (pointInPolygon(x, y, o.polygon)) return o.id; return 'outside'; };
const isOutdoorId = (id) => id === 'outside' || ENV.outdoorAreas.some((o) => o.id === id);

// ---------------------------------------------------------------- grid model
const FREE = 0, WALL = 1, GAP = 2, SLANT = 3;   // cell states (SLANT: under an angled wall — mixed derive only)
const T_H = 1, T_V = 2, T_J = 3;          // bar orientation of a solid cell

function buildModel(solids, openings, extraX = [], extraY = []) {
  const xs0 = new Set(extraX), ys0 = new Set(extraY);
  for (const list of [solids, openings]) for (const r of list) { xs0.add(r.x); xs0.add(r.x + r.w); ys0.add(r.y); ys0.add(r.y + r.h); }
  if (!xs0.size) xs0.add(0);
  if (!ys0.size) ys0.add(0);
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
    if (core0[k] >= 0 || !cell[k] || type[k] === T_J || !type[k]) continue;   // !type: a SLANT cell (never a bar)
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
    c.isNew = !ENV.draft && coverage(r, ENV.solids) < 0.5;
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
  // upper levels: wall ids carry the level prefix ('L1|w03') so they are unique across levels; L0 ids are unchanged
  const pre = ENV.pre || '', mine = (w) => !pre || String(w.id).startsWith(pre + 'w');
  for (const w of [...ENV.baseWalls, ...(prevWalls || [])]) { const n = pre ? (mine(w) ? parseInt(String(w.id).slice(pre.length + 1), 10) : 0) : parseInt(String(w.id).slice(1), 10); if (n > next) next = n; }
  for (const w of prevWalls || []) if (!old.has(key(w)) && mine(w)) old.set(key(w), w.id);
  return rects.map((r) => {
    let id = old.get(key(r));
    if (!id || used.has(id)) id = pre + 'w' + String(++next).padStart(2, '0');
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

/** Distance from (x, y) to a polygon (0 inside). */
const polyDist = (x, y, poly) => Math.max(0, -distToPolygon(x, y, poly));

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
  const prev = prevBoxes(prevRooms);
  for (const c of comps) for (const k of c.cells) { const i = k % nx, j = (k - i) / nx; c.area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]); }
  // overlap of every component with every previous room, exact for rectilinear rooms: each grid row is cut into bands at
  // the room's own vertex heights, and each band's cross-section is intersected with the cells (a coarse grid — few
  // walls — would otherwise credit a whole wide cell to whichever room holds its centre)
  for (let p = 0; p < prev.length; p++) {
    const q = prev[p], poly = q.room.polygon;
    const vy = [...new Set(poly.map((v) => v[1]))].sort((a, b) => a - b);
    for (let j = 0; j < ny; j++) {
      const r0 = Math.max(ys[j], q.y0), r1 = Math.min(ys[j + 1], q.y1);
      if (r1 <= r0) continue;
      const stops = [r0, ...vy.filter((y) => y > r0 && y < r1), r1];
      for (let b = 0; b + 1 < stops.length; b++) {
        const cy = (stops[b] + stops[b + 1]) / 2, dy = stops[b + 1] - stops[b], cuts = [];
        for (let e = 0; e < poly.length; e++) {
          const a = poly[e], c = poly[(e + 1) % poly.length];
          if ((a[1] > cy) !== (c[1] > cy)) cuts.push(a[0] + ((cy - a[1]) * (c[0] - a[0])) / (c[1] - a[1]));
        }
        cuts.sort((a, c) => a - c);
        for (let t = 0; t + 1 < cuts.length; t += 2) {
          for (let i = Math.max(0, lowerBound(xs, cuts[t]) - 1); i < nx && xs[i] < cuts[t + 1]; i++) {
            const cid = comp[j * nx + i], len = Math.min(xs[i + 1], cuts[t + 1]) - Math.max(xs[i], cuts[t]);
            if (cid < 0 || len <= 0) continue;
            const o = comps[cid].overlap;
            o.set(p, (o.get(p) || 0) + len * dy);
          }
        }
      }
    }
  }
  const { rooms, roomOf } = matchRooms(comps, prev, prevRooms, (cid, c) => roomPolygon(m, comp, cid, c.cells));
  return { rooms, comp, roomOf };
}

/** Bounds of the previous rooms (matching state per room). */
const prevBoxes = (prevRooms) => prevRooms.map((r) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of r.polygon) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { room: r, x0, y0, x1, y1, best: -1, bestArea: 0 };
});

/**
 * Rooms for the found components (grid components or polygon faces): `comps[cid].overlap` = Map(previous room index →
 * overlap area); ids / names / labels / zones follow the previous rooms (ties → the room listed first; a split leaves
 * the id on the larger overlap; new rooms 'room-<n>', ids global across levels). `polygonOf(cid, comp)` → its polygon.
 */
function matchRooms(comps, prev, prevRooms, polygonOf) {
  comps.forEach((c, cid) => { for (const [p, a] of c.overlap) if (a > prev[p].bestArea) { prev[p].bestArea = a; prev[p].best = cid; } });
  const zones = prevRooms.flatMap((r) => r.zones || []);
  const taken = new Set(prevRooms.map((r) => r.id));
  const reserved = reservedRoomIds();                                   // room ids are global across levels
  if (reserved) for (const id of reserved) taken.add(id);
  const kept = new Array(prev.length).fill(null), fresh = [], roomOf = new Array(comps.length);
  let room;
  comps.forEach((c, cid) => {
    let winner = -1, parent = -1;
    for (const p of [...c.overlap.keys()].sort((a, b) => a - b)) {      // ties → the room listed first
      const a = c.overlap.get(p);
      if (parent < 0 || a > c.overlap.get(parent)) parent = p;
      if (prev[p].best === cid && (winner < 0 || a > c.overlap.get(winner))) winner = p;
    }
    let src = winner >= 0 ? prev[winner].room : null;
    let polygon = polygonOf(cid, c);
    if (src && reserved && reserved.has(src.id)) {                      // its id is another level's: same room, new id
      room = { ...src, id: null, polygon, label: interiorPoint(polygon) };
      fresh.push(room); roomOf[cid] = room;
      return;
    }
    if (src && cyclicEqual(polygon, src.polygon)) polygon = src.polygon;
    const area = polygonArea(polygon), mine = zones.filter((z) => pointInPolygon(z.label[0], z.label[1], polygon));
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
  return { rooms: [...kept.filter(Boolean), ...fresh], roomOf };
}

// ---------------------------------------------------------------- derive: everything that follows from walls + openings
/**
 * @param solids   rectangles of wall material INCLUDING the (rect) openings in them
 * @param openings opening objects (stamped on top of the solids)
 * @param slants   the level's angled walls (none / empty: the grid engine alone — today's code path, byte for byte)
 * @returns {{ walls, openings, rooms, wallOutline, segments, problems, narrow, m }}
 */
function derive(solids, openings, prevRooms, prevWalls, slants) {
  if ((slants && slants.length) || openings.some(isAngledOpening)) return deriveMixed(solids, openings, prevRooms, prevWalls, slants || []);
  const m = buildModel(solids, openings);
  floodOutdoor(m); computeTypes(m); computeCores(m);
  const { nx, cell, out, xs, ys, cores } = m;
  const { rooms, comp, roomOf } = buildRooms(m, prevRooms);
  const spaceOf = (i, j) => { const k = j * nx + i; if (cell[k]) return null; return out[k] ? outdoorAt((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2) : roomOf[comp[k]].id; };
  const problems = m.overlaps.map((id) => ({ id, type: 'overlap' }));
  const nextOpenings = openings.map((o) => rectOpeningSides(m, o, spaceOf, problems));
  const segments = cores.map((c) => rectSegment(m, c, spaceOf, nextOpenings));
  return { walls: buildWalls(m, prevWalls), openings: nextOpenings, rooms, wallOutline: buildOutline(m), segments, problems, narrow: narrowArea(m), m };
}

/** An opening in a rect wall checked against the grid (jambs, one core) and given its rooms / exterior / outside. */
function rectOpeningSides(m, o, spaceOf, problems) {
  const { nx, cell, xs, ys, cores, core0, type } = m;
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
  const outside = sidesOut(lo, hi) ? (horizontal ? (isOutdoorId(lo) ? 'n' : 's') : (isOutdoorId(lo) ? 'w' : 'e')) : undefined;
  return withSides(o, lo, hi, outside);
}
const sidesOut = (lo, hi) => isOutdoorId(lo) || isOutdoorId(hi);
/** `o` with rooms [indoor side first] / exterior / outside (the same object when nothing changed). `extra` = derived fields. */
function withSides(o, lo, hi, outside, extra) {
  const loOut = isOutdoorId(lo), hiOut = isOutdoorId(hi), exterior = loOut || hiOut;
  const pair = loOut && !hiOut ? [hi, lo] : [lo, hi];
  const norm = (list) => (list || []).map((id) => (isOutdoorId(id) ? '~' : id)).sort().join('|');
  const sameRooms = norm(o.rooms) === norm(pair) && (o.rooms || []).length === 2;
  const sameExtra = !extra || Object.keys(extra).every((k) => o[k] === extra[k]);
  if (sameRooms && !!o.exterior === exterior && o.outside === outside && sameExtra) return o;
  const next = { ...o, ...(extra || {}), rooms: sameRooms ? o.rooms : pair };
  if (exterior) { next.exterior = true; next.outside = outside; } else { delete next.exterior; delete next.outside; }
  return next;
}

/** Policy of a wall of class `cls` and thickness `t` (see CONTRACT § 7 "Classification and policy"). */
const wallPolicy = (cls, t) => (ENV.draft ? { level: 'free', reason: '' } : cls === 'mamad' ? { level: 'locked', reason: REASONS.mamad } : cls === 'exterior' ? { level: 'locked', reason: REASONS.exteriorWall }
  : cls === 'thick' ? { level: 'warn', reason: REASONS.thick(t) } : { level: 'free', reason: '' });

/** The selectable segment of a grid core. */
function rectSegment(m, c, spaceOf, openings) {
  const tile = cellRect(m, c.t.i0, c.t.i1, c.t.j0, c.t.j1), v = c.axis === 'v';
  const jm = (c.j0 + c.j1) >> 1, im = (c.i0 + c.i1) >> 1;
  return {
    id: (ENV.pre || '') + (c.junction ? `seg:j:${c.x}:${c.y}` : v ? `seg:v:${c.x}:${c.y}:${c.y + c.h}` : `seg:h:${c.y}:${c.x}:${c.x + c.w}`),
    axis: c.axis, ...tile, thickness: c.thickness, length: v ? tile.h : tile.w, cls: c.cls,
    policy: wallPolicy(c.cls, c.thickness),
    openingIds: openings.filter((o) => overlapArea(o, tile) > 0).map((o) => o.id),
    isNew: c.isNew,
    core: { x: c.x, y: c.y, w: c.w, h: c.h },
    between: v ? [spaceOf(c.i0 - 1, jm), spaceOf(c.i1, jm)] : [spaceOf(im, c.j0 - 1), spaceOf(im, c.j1)],
    freeEnds: [c.freeA, c.freeB],
  };
}

// ---------------------------------------------------------------- mixed derive: a level with angled walls (stage A1)
/*
 * Taken only when the level has at least one slant (or an opening in one). The polygons are exact (polykernel):
 *   solids  = wall rects ∪ rect openings ∪ joined slant footprints ∪ the gap quads of slant openings;
 *   faces   of the complement inside the grid frame (bbox + 100 cm): the face touching the frame is outdoors, every
 *           bounded face a room (openings are solid, so they separate rooms) — exact polygons and areas, matched to
 *           the previous rooms by overlap area with the grid engine's rules (matchRooms);
 *   rect walls keep the grid (cores, classes, jambs, ids); slant footprint vertices add grid lines and the free cells
 *           under a slant become SLANT (neither free nor bar); outdoors / spaces of the cells come from the faces;
 *   slants  one segment each ('seg:a:<id>'); classed from their faces (exterior if a face borders an outdoor face,
 *           mamad if the footprint enters the safe-room shell, else thick / partition by t and "new");
 *   outline = boundary of the wall material (union minus the openings' gaps), diagonal entries allowed.
 */
function deriveMixed(solids, openings, prevRooms, prevWalls, slants) {
  const rectSolids = solids.filter((r) => !isAngledOpening(r)), rOpenings = rectOpenings(openings), aOpenings = openings.filter(isAngledOpening);
  const L = slantLevel(slants, rectSolids);
  const { polys, quads, cuts } = slantSolids(L, aOpenings);
  const extraX = [], extraY = [];
  for (const p of [...polys, ...quads]) for (const [x, y] of p) { extraX.push(x); extraY.push(y); }
  const m = buildModel(rectSolids, rOpenings, extraX, extraY);
  const { nx, ny, xs, ys } = m, n = nx * ny;
  const F = denoiseFaces(polyFaces([...rectSolids, ...polys, ...quads], { x: xs[0], y: ys[0], w: xs[nx] - xs[0], h: ys[ny] - ys[0] }));
  const locate = spaceLocator(F), label = labelCells(xs, ys, locate);
  const out = new Uint8Array(n), flat = m.cell.slice();
  for (let k = 0; k < n; k++) {
    if (m.cell[k] !== FREE) continue;
    if (label[k] === -2) { m.cell[k] = SLANT; continue; }      // the cell's centre is under an angled wall
    if (label[k] === -1) out[k] = 1;
  }
  m.out = out;
  { const cell = m.cell; m.cell = flat; computeTypes(m); m.cell = cell; }   // SLANT cells break bars like free cells …
  computeCores(m);                                                           // … but are not free (joined wall ends)
  const { cell, cores } = m;

  // rooms: the bounded faces, matched to the previous rooms by exact overlap area
  const prev = prevBoxes(prevRooms);
  const comps = F.rooms.map((face) => {
    const overlap = new Map(), b = boxOfRing(face.outer), polygon = slitJoin(face.outer, face.holes);
    const same = prev.findIndex((q) => cyclicEqual(polygon, q.room.polygon));   // an unchanged room (rooms are disjoint)
    if (same >= 0) overlap.set(same, face.area);
    else prev.forEach((q, p) => {
      if (q.x0 >= b.x + b.w || b.x >= q.x1 || q.y0 >= b.y + b.h || b.y >= q.y1) return;
      const a = intersectArea([face], { polygon: q.room.polygon });
      if (a > 0) overlap.set(p, a);
    });
    return { overlap, area: face.area, face, polygon };
  });
  const { rooms, roomOf } = matchRooms(comps, prev, prevRooms, (cid, c) => c.polygon);
  const spaceAtFace = (id, x, y) => (id == null ? null : id === -1 ? outdoorAt(x, y) : roomOf[id].id);
  const spaceOf = (i, j) => { const k = j * nx + i; if (cell[k]) return null; return spaceAtFace(label[k], (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2); };

  const problems = m.overlaps.map((id) => ({ id, type: 'overlap' }));
  const checks = checkAngledOpenings(aOpenings, L, MIN_JAMB);
  const nextOpenings = openings.map((o) => {
    if (!isAngledOpening(o)) return rectOpeningSides(m, o, spaceOf, problems);
    const r = checks.get(o.id);
    if (!r.ok) { problems.push({ id: o.id, type: r.type }); return o; }
    const { g, geo } = r, f = g.f, d = f.hw + 1;
    const side = (sg) => { for (const k of [0, -0.25, 0.25, -0.45, 0.45]) { const a = o.at + k * o.width, x = g.s.x1 + f.ux * a + sg * f.nx * d, y = g.s.y1 + f.uy * a + sg * f.ny * d, s = spaceAtFace(locate(x, y), x, y); if (s != null) return s; } return null; };
    const lo = side(-1), hi = side(1);                       // 'l' face, 'r' face
    if (lo == null || hi == null) { problems.push({ id: o.id, type: 'blocked' }); return o; }
    const extra = { cx: geo.cx, cy: geo.cy, angle: geo.angle, t: geo.t, x: geo.x, y: geo.y, w: geo.w, h: geo.h };
    return withSides(o, lo, hi, sidesOut(lo, hi) ? (isOutdoorId(lo) ? 'l' : 'r') : undefined, extra);
  });

  const rectOps = rectOpenings(nextOpenings);
  const segments = cores.map((c) => {
    const seg = rectSegment(m, c, spaceOf, rectOps);
    if (seg.between[0] == null || seg.between[1] == null) seg.between = rectBetween(m, c, spaceOf, seg.between);
    return seg;
  });
  for (const g of L.list) segments.push(slantSegment(g, locate, spaceAtFace, nextOpenings));

  const wallOutline = outlineEdges([...rectSolids, ...polys], [...rOpenings, ...cuts]);
  return { walls: buildWalls(m, prevWalls), openings: nextOpenings, rooms, wallOutline, segments, problems, narrow: narrowArea(m), m, slantLevel: L, locate, faces: F, slants };
}
const boxOfRing = (ring) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
/** Spaces on the two faces of a grid core whose middle neighbour is under a slant: the first free neighbour along it. */
function rectBetween(m, c, spaceOf, was) {
  const v = c.axis === 'v', res = was.slice();
  for (let side = 0; side < 2; side++) {
    if (res[side] != null) continue;
    if (v) { const i = side ? c.i1 : c.i0 - 1; for (let j = c.j0; j < c.j1 && res[side] == null; j++) res[side] = spaceOf(i, j); } else { const j = side ? c.j1 : c.j0 - 1; for (let i = c.i0; i < c.i1 && res[side] == null; i++) res[side] = spaceOf(i, j); }
  }
  return res;
}

/** The segment of one slant: sides sampled along the free stretches of its faces (every ≤ 20 cm), classed, policy. */
function slantSegment(g, locate, spaceAtFace, openings) {
  const { s, f, poly, box } = g, d = f.hw + 1, between = [null, null];
  let ext = false;
  [['l', -1], ['r', 1]].forEach(([side, sg], k) => {
    const count = new Map();
    for (const [a0, a1] of g.faces[side]) {
      const steps = Math.max(2, Math.ceil((a1 - a0) / 20));
      for (let q = 0; q < steps; q++) {
        const a = a0 + ((a1 - a0) * (q + 0.5)) / steps, x = s.x1 + f.ux * a + sg * f.nx * d, y = s.y1 + f.uy * a + sg * f.ny * d;
        const id = locate(x, y);
        if (id == null) continue;
        if (id === -1) ext = true;
        const sp = spaceAtFace(id, x, y);
        count.set(sp, (count.get(sp) || 0) + 1);
      }
    }
    let best = null, bn = 0;
    for (const [sp, c] of count) if (c > bn) { best = sp; bn = c; }
    between[k] = best;
  });
  const isNew = !ENV.draft && (() => {
    const near = [...ENV.solids, ...(ENV.slantSolids || [])].filter((r) => (Array.isArray(r) ? overlapsBox(boxOfRing(r), box) : overlapArea(r, box) > 0));
    return !near.length || intersectArea(poly, near) < 0.5 * netArea([poly]);
  })();
  const mamad = ENV.mamad.rects.length > 0 && intersectArea(poly, ENV.mamad.rects) > 1;
  const cls = mamad ? 'mamad' : ext ? 'exterior' : f.t >= THICK && !isNew ? 'thick' : 'partition';
  return {
    id: (ENV.pre || '') + 'seg:a:' + s.id,
    axis: 'a', slantId: s.id, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, t: f.t, angle: f.angle,
    x: box.x, y: box.y, w: box.w, h: box.h, poly,
    thickness: f.t, length: f.len, cls, kind: KIND_OF[cls],
    policy: wallPolicy(cls, f.t),
    openingIds: openings.filter((o) => isAngledOpening(o) && o.wall === s.id).map((o) => o.id),
    isNew,
    core: { x: box.x, y: box.y, w: box.w, h: box.h },
    between,
    freeEnds: g.freeEnds.slice(),
    faces: { l: g.faces.l.map((iv) => iv.slice()), r: g.faces.r.map((iv) => iv.slice()) },
  };
}
const overlapsBox = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ---------------------------------------------------------------- live state
let host = { record() {}, changed() {}, intent() {}, content() { return null; } };
let modified = false, analysis = null, stateKey = null;
let foreign = new WeakMap();

/** Called once by the store: `record(opts)` takes the undo snapshot BEFORE a change, `changed(payload)` announces it. */
export function bindPlanHost(h) { host = { record: h.record || (() => {}), changed: h.changed || (() => {}), intent: h.intent || (() => {}), content: h.content || (() => null) }; }

/**
 * Live collaboration (CONTRACT § 13): every successful top-level mutation is reported as `host.intent(name, args)` so a
 * concurrent edit can be re-run on a newer plan. Calls made by another mutation (flipDoor → updateOpening) are not.
 */
let intentDepth = 0;
function tracked(name, impl, args) {
  intentDepth++;
  // on a plan with several levels the level the call ran on is recorded first ('setActiveLevel'), so a re-run after a
  // conflict edits the same level; a one-level plan records exactly what it always did
  const at = intentDepth === 1 && upperLevels(PLAN).length ? activeLevel() : null;
  try {
    const r = impl(...args);
    if (intentDepth === 1 && r && r.ok) {
      try { const a = JSON.parse(JSON.stringify(args)); if (at) host.intent('setActiveLevel', [at]); host.intent(name, a); } catch (e) { /* not recorded */ }
    }
    return r;
  } finally { intentDepth--; }
}

const solidsOf = (plan) => [...plan.walls, ...rectOpenings(plan.openings)];
/** The angled walls of the level being edited (L0's, or the swapped-in level's). */
let slantsOverride;                // a temporary slant list (rect ↔ slant conversion), else undefined
const liveSlants = () => (slantsOverride !== undefined ? slantsOverride : swap ? swap.lv.slants : PLAN.slants);
const current = () => analysis || (analysis = derive(solidsOf(PLAN), PLAN.openings, PLAN.rooms, PLAN.walls, liveSlants()));
const analysisOf = (plan) => {
  if (plan === PLAN) return current();
  const lv = viewLevel.get(plan);
  if (lv) return levelState(lv).d;                                 // a level view (levelPlan): that level's policy
  const hit = foreign.get(plan.walls);
  if (hit && hit.slants === plan.slants) return hit.d;
  const d = derive(solidsOf(plan), plan.openings, plan.rooms, plan.walls, plan.slants);
  foreign.set(plan.walls, { slants: plan.slants, d });
  return d;
};

// ---------------------------------------------------------------- levels (stage F1): per-level views, the active level
/*
 * L0 is the top-level plan and is edited exactly as before (no level code runs on a one-level plan's edits).
 * An upper level is edited by SWAPPING its arrays into PLAN (walls / openings / rooms / wallOutline, and its merged
 * heights), its analysis into `analysis` and its policy environment into ENV for the duration of one call: the same
 * engine code then runs on that level, and `commit` installs the result into it (PLAN.levels gets a new array with a
 * new object for that level; L0 is untouched). The swap never spans a host call (record / changed / intent), so
 * nothing outside this module ever sees it.
 */
let activeId = GROUND;
let swap = null;                   // { id, lv, saved } while an upper level is swapped into PLAN
let levelEnvs = new Map();         // level id → policy environment (reset whenever ENV is)
let levelData = new WeakMap();     // level object → { arrays, d }: its arrays (derived when saved without rooms) + analysis
const views = new WeakMap();       // a level's stored `walls` array → its PLAN-shaped view (stable identity)
const viewLevel = new WeakMap();   // view → the level object it shows now
const viewHeights = new WeakMap(); // view → the plan heights its merged heights were made from

function resetLevelCaches() { levelEnvs = new Map(); levelData = new WeakMap(); }

/** derive() under another policy environment. */
function deriveIn(env, solids, openings, prevRooms, prevWalls, slants) {
  const saved = ENV; ENV = env;
  try { return derive(solids, openings, prevRooms, prevWalls, slants); } finally { ENV = saved; }
}
/** L0's live arrays, also while a level is swapped in. */
const liveL0 = () => (swap ? swap.saved : PLAN);

/**
 * Room ids held by OTHER levels than the one being derived — new rooms avoid them (room ids are global, so finishes and
 * collab keys need no level). null on a one-level plan. A lower level saved without rooms contributes its derived ones.
 */
function reservedRoomIds() {
  if (ENV.reserved !== undefined) return ENV.reserved;
  const levels = upperLevels(PLAN);
  if (!levels.length) return null;
  const me = ENV.level || GROUND, ids = new Set();
  let myIdx = levelIndex(PLAN, me);
  if (myIdx < 0) myIdx = Infinity;                                 // a level being added (on top)
  if (me !== GROUND) for (const r of liveL0().rooms) ids.add(r.id);
  levels.forEach((l, i) => {
    if (l.id === me) return;
    if (Array.isArray(l.rooms)) for (const r of l.rooms) ids.add(r.id);
    else if (i + 1 < myIdx) for (const r of levelState(l).arrays.rooms) ids.add(r.id);
  });
  return ids;
}

/**
 * Policy environment of an upper level. A level of the base plan is classified against it like L0 (exterior walls
 * locked, mamad shell, isNew) unless drafting; a level the base plan does not have is new construction: nothing on it
 * is locked (as while drafting).
 */
function levelEnv(id) {
  let env = levelEnvs.get(id);
  if (env) return env;
  const base = levelOf(BASE_PLAN, id), pre = id + '|';
  const draftEnv = { draft: true, solids: [], mamad: NO_MAMAD, outdoorAreas: [], baseWalls: [], level: id, pre };
  if (!base) env = draftEnv;
  else {
    const bd = base.rooms && base.wallOutline ? base : deriveIn(draftEnv, [...base.walls, ...base.openings], base.openings, base.rooms || [], base.walls, base.slants);
    const draft = phase === 'draft';
    env = { draft, solids: [...bd.walls, ...rectOpenings(bd.openings)], mamad: draft ? NO_MAMAD : mamadOf(bd), outdoorAreas: base.outdoorAreas || [], baseWalls: bd.walls, level: id, pre };
    if (!draft && hasSlants(base)) env.slantSolids = baseSlantSolids(base.slants, env.solids, bd.openings);
  }
  levelEnvs.set(id, env);
  return env;
}

/** Arrays and analysis of a level (cached per level object; a level saved without rooms / outline gets derived ones). */
function levelState(lv) {
  let st = levelData.get(lv);
  if (st) return st;
  const d = deriveIn(levelEnv(lv.id), [...lv.walls, ...lv.openings], lv.openings, Array.isArray(lv.rooms) ? lv.rooms : [], lv.walls, lv.slants);
  st = { arrays: Array.isArray(lv.rooms) && Array.isArray(lv.wallOutline) ? lv : d, d };
  levelData.set(lv, st);
  return st;
}

/**
 * PLAN-shaped view of one level: that level's walls, wallOutline, openings, rooms, slants, stairs, voids and
 * outdoorAreas, the plan's shared meta, site, bounds and assumptions, `heights` = the plan's merged with the level's,
 * plus `levelId` and `elevation`. For 'L0' (or no id) it is `plan` itself; null for an unknown level.
 * The view object is the same for as long as the level's stored walls array is (its fields are refreshed in place, like
 * PLAN's), so caches keyed by the view or by `walls` keep working. Every pure function that takes `plan` works on it
 * (wallSegments, geometry, regulations, renderers). Treat it as read-only.
 */
export function levelPlan(plan = PLAN, id = activeLevel()) {
  if (id == null || id === GROUND) return plan;
  const lv = levelOf(plan, id);
  if (!lv) return null;
  const st = levelState(lv), a = st.arrays, H = plan === PLAN && swap ? swap.saved.heights : plan.heights;
  let v = views.get(lv.walls);
  if (!v) { v = {}; views.set(lv.walls, v); }
  if (viewLevel.get(v) !== lv || viewHeights.get(v) !== H) {
    v.heights = { ...H, ...lv.heights };
    viewHeights.set(v, H);
  }
  viewLevel.set(v, lv);
  v.meta = plan.meta; v.bounds = plan.bounds;
  v.walls = a.walls; v.wallOutline = a.wallOutline; v.openings = a.openings; v.rooms = a.rooms;
  v.outdoorAreas = lv.outdoorAreas || v.outdoorAreas || [];
  v.site = plan.site; v.assumptions = plan.assumptions;
  if (lv.slants) v.slants = lv.slants; else delete v.slants;
  if (lv.stairs) v.stairs = lv.stairs; else delete v.stairs;
  v.voids = lv.voids || (Array.isArray(v.voids) && !v.voids.length ? v.voids : []);   // never a removed level's old voids (F4b)
  v.levelId = lv.id; v.elevation = lv.elevation;
  return v;
}

/** The level the editing calls work on ('L0' = ground; falls back to 'L0' when that level no longer exists). */
export function activeLevel() {
  if (activeId !== GROUND && !levelOf(PLAN, activeId)) activeId = GROUND;
  return activeId;
}
/**
 * Choose the level every editing call and query works on (not part of the plan state: no undo step, no event).
 * @returns {{ ok: true, levelId } | { ok: false, reason }}
 */
export function setActiveLevel(id) {
  const want = id == null ? GROUND : id;
  if (want !== GROUND && !levelOf(PLAN, want)) return fail(`There is no level ${want}.`);
  activeId = want;
  return { ok: true, levelId: want };
}

function swapIn(id) {
  const lv = levelOf(PLAN, id), st = levelState(lv), heights = levelPlan(PLAN, id).heights;
  swap = { id, lv, saved: { walls: PLAN.walls, openings: PLAN.openings, rooms: PLAN.rooms, wallOutline: PLAN.wallOutline, heights: PLAN.heights, analysis, env: ENV } };
  PLAN.walls = st.arrays.walls; PLAN.openings = st.arrays.openings; PLAN.rooms = st.arrays.rooms; PLAN.wallOutline = st.arrays.wallOutline;
  PLAN.heights = heights; analysis = st.d; ENV = levelEnv(id);
}
function swapOut() {
  const { saved } = swap;
  PLAN.walls = saved.walls; PLAN.openings = saved.openings; PLAN.rooms = saved.rooms; PLAN.wallOutline = saved.wallOutline;
  PLAN.heights = saved.heights; analysis = saved.analysis; ENV = saved.env;
  swap = null;
}
/** Run `fn` with level `id` swapped in (L0, or a call nested in a level call: as is). `missing` = result for an unknown level. */
function onLevel(id, fn, missing) {
  if (swap || id == null || id === GROUND) return fn();
  if (!levelOf(PLAN, id)) return missing !== undefined ? missing : fail(`There is no level ${id}.`);
  swapIn(id);
  try { return fn(); } finally { if (swap) swapOut(); }
}
/** The level holding the opening / room with this id (ids are global), else the active level. */
function levelHolding(key, id) {
  if (swap) return swap.id;
  if (!upperLevels(PLAN).length) return GROUND;
  if (PLAN[key].some((x) => x.id === id)) return GROUND;
  for (const l of upperLevels(PLAN)) if (levelState(l).arrays[key].some((x) => x.id === id)) return l.id;
  return activeLevel();
}
const onActive = (impl) => (...a) => onLevel(activeLevel(), () => impl(...a));
const onHolder = (key, impl) => (id, ...a) => onLevel(levelHolding(key, id), () => impl(id, ...a));
/** Every opening id on every level (opening ids are global). */
function allOpeningIds() {
  const ids = new Set();
  for (const o of liveL0().openings) ids.add(o.id);
  for (const l of upperLevels(PLAN)) for (const o of l.openings) ids.add(o.id);
  if (swap) for (const o of PLAN.openings) ids.add(o.id);
  return ids;
}

const GEOMETRY_KEYS = ['kind', 'axis', 'x', 'y', 'w', 'h', 'width', 'height', 'sill'];
const LOOK_KEYS = ['style', 'hinge', 'swing'];
const sameOpening = (a, b, keys) => keys.every((k) => a[k] === b[k]);
/** Openings in slants: their geometry is the wall + position along it (x, y, w, h are derived bounds). */
const ANGLED_GEOMETRY_KEYS = ['kind', 'axis', 'wall', 'at', 'width', 'height', 'sill'];
const sameGeometry = (a, b) => sameOpening(a, b, a.axis === 'a' || b.axis === 'a' ? ANGLED_GEOMETRY_KEYS : GEOMETRY_KEYS);
/** Same centre line and thickness (a slant of a saved state vs a base slant). */
const sameSlant = (a, b) => !!a && !!b && a.id === b.id && a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2 && a.t === b.t;

/** Do two wall lists cover exactly the same area? */
function sameSolid(a, b) {
  const area = (list) => list.reduce((s, r) => s + r.w * r.h, 0);
  if (area(a) !== area(b)) return false;
  const all = buildModel([...a, ...b], []), A = buildModel(a, [], all.xs, all.ys), B = buildModel(b, [], all.xs, all.ys);
  return A.cell.length === B.cell.length && A.cell.every((v, k) => v === B.cell[k]);
}

function isArchitectPlan(d, opt = optionalPart(PLAN)) {
  const base = BASE_PLAN;
  if (!sameOptional(opt, base)) return false;
  return sameAsBase(d, base);
}
/** Do derived walls / openings / rooms equal a base level's (same solids, openings, room names)? */
function sameAsBase(d, base) {
  if (d.openings.length !== base.openings.length || d.rooms.length !== base.rooms.length) return false;
  for (const b of base.openings) { const o = d.openings.find((x) => x.id === b.id); if (!o || !sameGeometry(o, b) || !sameOpening(o, b, LOOK_KEYS)) return false; }
  for (const b of base.rooms) { const r = d.rooms.find((x) => x.id === b.id); if (!r || r.name !== b.name || r.type !== b.type || !!r.wet !== !!b.wet) return false; }
  return sameSolid(d.walls, base.walls);
}

function setBase() {
  PLAN.walls = clone(BASE_PLAN.walls); PLAN.openings = clone(BASE_PLAN.openings);
  PLAN.rooms = clone(BASE_PLAN.rooms); PLAN.wallOutline = clone(BASE_PLAN.wallOutline);
  if (!sameOptional(PLAN, BASE_PLAN)) setOptionalKeys(PLAN, optionalCopy(BASE_PLAN));
  modified = false; analysis = null;
  syncBounds();
}

/** Outer bounding box of wall rectangles (openings included), or null when there are none. */
export function wallBounds(walls, openings = []) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of [...walls, ...openings]) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
/** Bounds of the rect walls / openings and the (free) footprints of the slants of some levels. */
function angledBounds(levels) {
  const boxes = [];
  for (const l of levels) {
    boxes.push(...l.walls, ...rectOpenings(l.openings));
    for (const s of l.slants || []) { const hw = s.t / 2; boxes.push({ x: Math.min(s.x1, s.x2) - hw, y: Math.min(s.y1, s.y2) - hw, w: Math.abs(s.x2 - s.x1) + s.t, h: Math.abs(s.y2 - s.y1) + s.t }); }
  }
  return wallBounds(boxes);
}
/** While drafting, the house grows with the walls (of every level): PLAN.bounds follows them (a fixed plan keeps its base bounds). */
function syncBounds() {
  if (!ENV.draft) { if (JSON.stringify(PLAN.bounds) !== JSON.stringify(BASE_PLAN.bounds)) PLAN.bounds = clone(BASE_PLAN.bounds); return; }
  const ups = upperLevels(PLAN);
  const angled = hasSlants(PLAN) || ups.some(hasSlants);
  const b = (angled ? angledBounds([PLAN, ...ups]) : ups.length ? wallBounds([...PLAN.walls, ...ups.flatMap((l) => l.walls)], [...PLAN.openings, ...ups.flatMap((l) => l.openings.filter((o) => o.axis !== 'a'))])
    : wallBounds(PLAN.walls, PLAN.openings)) || BASE_PLAN.bounds;
  if (JSON.stringify(b) !== JSON.stringify(PLAN.bounds)) PLAN.bounds = clone(b);
}

/**
 * Install a derived plan as the live plan (no history, no event). Returns which parts changed. `opt` = the optional
 * schema-2 keys the plan must carry (from a saved state); undefined keeps the live ones (an edit never changes them).
 */
function install(d, opt) {
  const before = [PLAN.walls, PLAN.openings, PLAN.rooms].map((a) => JSON.stringify(a)), lv0 = PLAN.levels, st0 = stairSig();
  if (opt === undefined) opt = optionalPart(PLAN);
  else if (Array.isArray(opt.levels) && opt.levels.some((l) => voidsOf(l).length || (l.rooms || []).some((r) => r.voids))) opt = { ...opt, levels: opt.levels.map(annotateVoids) };
  if (isArchitectPlan(d, opt)) setBase();
  else {
    PLAN.walls = d.walls; PLAN.openings = d.openings; PLAN.rooms = d.rooms; PLAN.wallOutline = d.wallOutline; modified = true; analysis = d;
    if (!sameOptional(PLAN, opt)) setOptionalKeys(PLAN, opt);
    syncBounds();
  }
  stateKey = null; invalidatePlanCaches();
  const after = [PLAN.walls, PLAN.openings, PLAN.rooms].map((a) => JSON.stringify(a));
  return withStairs({ walls: before[0] !== after[0], openings: before[1] !== after[1], rooms: before[2] !== after[2], levels: levelsChanged(lv0) }, st0);
}
/** Did PLAN.levels change since it was `lv0`? (false on a one-level plan) */
const levelsChanged = (lv0) => lv0 !== PLAN.levels && JSON.stringify(lv0) !== JSON.stringify(PLAN.levels);
/** Stairs and voids of every level, as one string ('' on a plan without any — the usual case, cheap). */
function stairSig() {
  const ups = upperLevels(PLAN);
  if (!PLAN.stairs && !ups.some((l) => l.stairs || l.voids)) return '';
  return JSON.stringify([PLAN.stairs || null, ups.map((l) => [l.id, l.stairs || null, l.voids || null])]);
}
/**
 * `changed` + the stairs (stage F4b): when a stair or a void changed, `stairs: true` (absent otherwise, so the payloads of
 * plans without stairs are unchanged) and `levels: true` (a stair is schema-2 data of the levels: consumers that rebuild
 * on `levels` pick it up — a stair of the ground floor lives in PLAN.stairs, its void in the level above).
 */
function withStairs(changed, st0) {
  if (st0 === stairSig()) return changed;
  return { ...changed, levels: true, stairs: true };
}

/**
 * Install new optional keys (an upper level edited, added, removed…) with L0 unchanged: back to the exact base plan if
 * everything equals it again, else the plan is modified. Lazy schema: no upper level left → no `levels`, no `schema`.
 */
function installOptional(opt) {
  const before = [PLAN.walls, PLAN.openings, PLAN.rooms].map((a) => JSON.stringify(a)), lv0 = PLAN.levels, st0 = stairSig();
  const next = optionalPart(normalizeOptionalKeys({ ...opt }));
  if (Array.isArray(next.levels)) next.levels = next.levels.map(annotateVoids);   // rooms cut by a void say so (F4b)
  if (isArchitectPlan({ walls: PLAN.walls, openings: PLAN.openings, rooms: PLAN.rooms }, next)) setBase();
  else { setOptionalKeys(PLAN, next); modified = true; syncBounds(); }
  stateKey = null; invalidatePlanCaches();
  const after = [PLAN.walls, PLAN.openings, PLAN.rooms].map((a) => JSON.stringify(a));
  return withStairs({ walls: before[0] !== after[0], openings: before[1] !== after[1], rooms: before[2] !== after[2], levels: levelsChanged(lv0) }, st0);
}

/** A level object with the derived arrays `d` installed (the exact base level again when it equals it). */
function withDerived(lv, d) {
  const base = levelOf(BASE_PLAN, lv.id), sl = d.slants !== undefined ? d.slants : lv.slants;
  if (base && sameAsBase(d, levelState(base).arrays) && JSON.stringify(sl || []) === JSON.stringify(base.slants || [])) return clone(base);
  const next = { ...lv, walls: d.walls, wallOutline: d.wallOutline, openings: d.openings, rooms: d.rooms };
  if (d.slants !== undefined) { if (d.slants.length) next.slants = d.slants; else delete next.slants; }
  return next;
}
/** Install derived arrays into upper level `id`. */
function installLevel(id, d) {
  const levels = upperLevels(PLAN), lv = levels.find((l) => l.id === id), next = withDerived(lv, d);
  const changed = installOptional({ ...optionalPart(PLAN), levels: levels.map((l) => (l === lv ? next : l)) });
  const now = levelOf(PLAN, id);
  if (now && now.walls === d.walls) levelData.set(now, { arrays: now, d });   // its analysis is already known
  return changed;
}

const doorless = (rooms, openings) => rooms.filter((r) => !openings.some((o) => o.kind !== 'window' && (o.rooms || []).includes(r.id)));

/** Record undo, install, announce. `res` = { level, ids, warnings? }. */
function commit(d, reason, res, opts = {}) {
  if (swap) return commitLevel(d, reason, res, opts);
  const had = new Set(doorless(PLAN.rooms, PLAN.openings).map((r) => r.id));
  host.record(opts);
  // an edit of the angled walls installs the new slant list too (lazy schema: no slant left → no `slants`, no `schema`)
  const opt = d.slants !== undefined && d.slants !== liveSlants() ? optionalPart(normOpt({ ...optionalPart(PLAN), slants: d.slants })) : undefined;
  const changed = install(d, opt);
  const warnings = [...(res.warnings || [])];
  if (res.level === 'warn' && res.reason) warnings.unshift(res.reason);
  if (res.level === 'permit') warnings.unshift(REASONS.permit);
  for (const r of doorless(PLAN.rooms, PLAN.openings)) if (!had.has(r.id)) warnings.push(`${r.name} has no door or passage now.`);
  host.changed({ reason, changed, transient: !!opts.transient });
  return { ok: true, level: res.level, warnings, ids: res.ids || [] };
}
/** commit() for an upper level: un-swap, record, install into that level, announce (payload `levelId`). */
function commitLevel(d, reason, res, opts) {
  const id = swap.id, had = new Set(doorless(PLAN.rooms, PLAN.openings).map((r) => r.id));
  swapOut();
  host.record(opts);
  const changed = installLevel(id, d), v = levelPlan(PLAN, id);
  const warnings = [...(res.warnings || [])];
  if (res.level === 'warn' && res.reason) warnings.unshift(res.reason);
  if (res.level === 'permit') warnings.unshift(REASONS.permit);
  for (const r of doorless(v.rooms, v.openings)) if (!had.has(r.id)) warnings.push(`${r.name} has no door or passage now.`);
  host.changed({ reason, changed, transient: !!opts.transient, levelId: id });
  return { ok: true, level: res.level, warnings, ids: res.ids || [] };
}

// ---------------------------------------------------------------- persistence / history hooks (used by the store)
/**
 * `{ walls, openings, rooms }` of an edited plan (plus each optional schema-2 key the plan carries — schema, slants,
 * stairs, levels — only when present, so a schema-1 state is unchanged), or null while the plan is the architect's.
 */
export function planState() { return modified ? { walls: PLAN.walls, openings: PLAN.openings, rooms: PLAN.rooms, ...optionalPart(PLAN) } : null; }
/** JSON of planState(), cached until the plan changes (cheap to compare in history snapshots). */
export function planStateKey() { return stateKey || (stateKey = JSON.stringify(planState())); }

const validRect = (r) => r && num(r.x) && num(r.y) && num(r.w) && num(r.h) && r.w > 0 && r.h > 0;
const validOpening = (o) => !!o && typeof o.id === 'string' && (o.axis === 'a' ? typeof o.wall === 'string' && num(o.at) && num(o.width) && o.width > 0 : validRect(o) && (o.axis === 'h' || o.axis === 'v'));
const validRoom = (r) => r && typeof r.id === 'string' && Array.isArray(r.polygon) && r.polygon.length >= 3 && r.polygon.every((p) => Array.isArray(p) && num(p[0]) && num(p[1])) && Array.isArray(r.label);

/**
 * Replace the live plan with a saved state (null → the architect's plan). Used by store undo / redo / load.
 * Never throws: an unusable or tampered state (locked parts changed) falls back to the architect's plan.
 * @returns {{ ok: boolean, reason?: string, changed: { walls, openings, rooms } }}
 */
export function applyPlanState(state) {
  const none = { walls: false, openings: false, rooms: false, levels: false };
  const toBase = (reason) => {
    if (!modified) return { ok: !reason, reason, changed: none };
    const before = [PLAN.walls, PLAN.openings, PLAN.rooms].map((a) => JSON.stringify(a)), lv0 = PLAN.levels, st0 = stairSig();
    setBase(); stateKey = null; invalidatePlanCaches();
    const base = [PLAN.walls, PLAN.openings, PLAN.rooms].map((a) => JSON.stringify(a));
    return { ok: !reason, reason, changed: withStairs({ walls: before[0] !== base[0], openings: before[1] !== base[1], rooms: before[2] !== base[2], levels: levelsChanged(lv0) }, st0) };
  };
  if (!state) return toBase();
  try {
    if (JSON.stringify(state) === planStateKey()) return { ok: true, changed: none };
    const s = clone(state);
    if (optionalKeysProblem(s)) return toBase('The saved plan edits are not readable — the architect\'s plan was restored.');
    const opt = optionalPart(normalizeOptionalKeys(s));
    if (!Array.isArray(s.walls) || !Array.isArray(s.openings) || !s.walls.every(validRect)
      || !s.openings.every(validOpening)) return toBase('The saved plan edits are not readable — the architect\'s plan was restored.');
    const prevRooms = Array.isArray(s.rooms) && s.rooms.length && s.rooms.every(validRoom) ? s.rooms : clone(BASE_PLAN.rooms);
    const d = derive([...s.walls, ...s.openings], s.openings, prevRooms, s.walls, opt.slants);
    const intact = d.problems.length === 0 && (ENV.draft || (d.rooms.length > 0 && keepsBase(d, opt) && levelsIntact(opt.levels)));
    if (!intact) return toBase('The saved plan edits do not fit this house — the architect\'s plan was restored.');
    // keep the saved rectangles (ids included) when they describe the same walls, so undo / redo is exact
    const area = (list) => list.reduce((a, r) => a + r.w * r.h, 0);
    if (s.walls.every((w) => typeof w.id === 'string' && typeof w.kind === 'string') && area(s.walls) === area(d.walls)) d.walls = s.walls;
    return { ok: true, changed: install(d, opt) };
  } catch (e) {
    return toBase('The saved plan edits could not be applied — the architect\'s plan was restored.');
  }
}

/**
 * Does a derived L0 (`d`, with the optional keys `opt` of its state) keep what a fixed base plan locks: every locked wall
 * (a locked slant: the same centre line and thickness), the built footprint (walls + openings + rooms) and the safe
 * room's openings? Plans without slants: exactly the checks the grid engine always made.
 */
function keepsBase(d, opt) {
  const locked = analysisOf(BASE_PLAN).segments.filter((g) => g.policy.level === 'locked');
  if (!hasSlants(BASE_PLAN) && !hasSlants(opt) && !d.openings.some(isAngledOpening)) {
    const solids = [...d.walls, ...d.openings];
    const footprint = (walls, openings, rooms) => [...walls, ...openings].reduce((a, r) => a + r.w * r.h, 0) + rooms.reduce((a, r) => a + polygonArea(r.polygon), 0);
    return locked.every((g) => coverage(g, solids) > 0.999)
      && Math.abs(footprint(d.walls, d.openings, d.rooms) - footprint(BASE_PLAN.walls, BASE_PLAN.openings, BASE_PLAN.rooms)) < 1
      && BASE_PLAN.openings.filter(inMamad).every((b) => { const o = d.openings.find((x) => x.id === b.id); return o && JSON.stringify(o) === JSON.stringify(b); });
  }
  const solids = [...d.walls, ...rectOpenings(d.openings)];
  return locked.every((g) => (g.axis === 'a' ? (opt.slants || []).some((x) => sameSlant(x, { ...g, id: g.slantId })) : coverage(g, solids) > 0.999))
    && Math.abs(builtArea(d) - builtArea(analysisOf(BASE_PLAN))) < 2
    && BASE_PLAN.openings.filter(inMamadOpening).every((b) => { const o = d.openings.find((x) => x.id === b.id); return o && (isAngledOpening(b) ? sameGeometry(o, b) && sameOpening(o, b, LOOK_KEYS) : JSON.stringify(o) === JSON.stringify(b)); });
}
/** Built footprint of a derived level: area of the union of its wall material and openings, plus its rooms (cm²). */
function builtArea(d) {
  const L = d.slantLevel, { polys, quads } = L ? slantSolids(L, d.openings) : { polys: [], quads: [] };
  return netArea(polyUnion([...d.walls, ...rectOpenings(d.openings), ...polys, ...quads])) + d.rooms.reduce((a, r) => a + polygonArea(r.polygon), 0);
}

/** Saved upper levels keep the locked walls of the base plan's levels (a removed level is a whole-level change, allowed). */
function levelsIntact(levels) {
  for (const b of upperLevels(BASE_PLAN)) {
    const l = (levels || []).find((x) => x.id === b.id);
    if (!l) continue;
    const solids = [...l.walls, ...rectOpenings(l.openings)];
    const keeps = (g) => g.policy.level !== 'locked' || (g.axis === 'a' ? (l.slants || []).some((x) => sameSlant(x, { ...g, id: g.slantId })) : coverage(g, solids) > 0.999);
    if (!analysisOf(levelPlan(BASE_PLAN, b.id)).segments.every(keeps)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- queries
/**
 * The selectable units of the plan: maximal straight stretches of wall (openings included) between junctions
 * with perpendicular walls / wall ends. Segments tile the wall solids exactly once. Treat the result as read-only.
 * @returns {Array<{ id, axis, x, y, w, h, thickness, length, cls, policy: { level, reason }, openingIds, isNew, core, between }>}
 */
export function wallSegments(plan) { return analysisOf(plan === undefined ? (swap ? PLAN : levelPlan(PLAN, activeLevel())) : plan).segments; }

/** Segment under / nearest to a plan point (within `tol` cm) on the active level, or null. */
export function segmentAt(...a) { return onLevel(activeLevel(), () => segmentAtImpl(...a), null); }
function segmentAtImpl(x, y, tol = 6) {
  let best = null, bd = Infinity, slanted = null;
  for (const s of current().segments) {
    if (s.axis === 'a') { (slanted || (slanted = [])).push(s); continue; }
    const d = rectDist(x, y, s); if (d < bd) { bd = d; best = s; }
  }
  if (slanted && bd > 0) {
    // angled walls: inside a footprint, else the nearest footprint edge (rect segments first: a point inside one wins)
    for (const s of slanted) if (pointInPolygon(x, y, s.poly)) return s;
    for (const s of slanted) { const d = polyDist(x, y, s.poly); if (d < bd) { bd = d; best = s; } }
  }
  return best && bd <= tol ? best : null;
}

const segmentOfOpening = (o) => current().segments.find((s) => s.openingIds.includes(o.id)) || null;
function policyOfOpening(o) {
  if (ENV.draft) return { level: 'free', reason: '' };
  if (inMamadOpening(o) || o.style === 'mamad') return { level: 'locked', reason: REASONS.mamad };
  if (o.exterior) return { level: 'permit', reason: REASONS.permit };
  return { level: 'free', reason: '' };
}
/** What may be done with a door / window: `{ level: 'free' | 'permit' | 'locked', reason }`. */
export function openingPolicy(openingId) { return onLevel(levelHolding('openings', openingId), () => openingPolicyImpl(openingId), { level: 'locked', reason: 'No such opening.' }); }
function openingPolicyImpl(openingId) {
  const o = PLAN.openings.find((x) => x.id === openingId);
  return o ? policyOfOpening(o) : { level: 'locked', reason: 'No such opening.' };
}
/** True when the plan differs from the architect's (never while drafting: nothing is a change then). */
export function isPlanModified() { return modified && !ENV.draft; }

// ---------------------------------------------------------------- wall editing
/** Edit model of the current plan with extra grid lines, plus axis-agnostic accessors (u = across the wall, v = along it). */
function editModel(axis, alongExtra, crossExtra) {
  const h = axis === 'h';
  if (angledHere()) return mixedEditModel(axis, alongExtra, crossExtra);
  const m = buildModel(PLAN.walls, PLAN.openings, h ? alongExtra : crossExtra, h ? crossExtra : alongExtra);
  floodOutdoor(m); computeTypes(m);
  const A = h ? m.xs : m.ys, C = h ? m.ys : m.xs, K = h ? (u, v) => u * m.nx + v : (u, v) => v * m.nx + u;
  const rect = (c0, c1, a0, a1) => (h ? { x: a0, y: c0, w: a1 - a0, h: c1 - c0 } : { x: c0, y: a0, w: c1 - c0, h: a1 - a0 });
  return { m, A, C, K, rect, ai: (v) => lowerBound(A, v), ci: (v) => lowerBound(C, v) };
}
/**
 * Edit model of a level with angled walls: the rect walls / rect openings on the grid (slant footprint vertices add grid
 * lines); free cells that touch a slant footprint or the gap of an opening in one are SLANT (supercover: a rect wall
 * stops before them and is then fitted exactly to the face), outdoors comes from the polygon faces.
 */
function mixedEditModel(axis, alongExtra, crossExtra) {
  const h = axis === 'h', cur = current(), L = cur.slantLevel;
  const polys = L ? slantSolids(L, PLAN.openings.filter(isAngledOpening)) : { polys: [], quads: [] };
  const all = [...polys.polys, ...polys.quads];
  const ex = [...(h ? alongExtra : crossExtra)], ey = [...(h ? crossExtra : alongExtra)];
  for (const p of all) for (const [x, y] of p) { ex.push(x); ey.push(y); }
  const m = buildModel(PLAN.walls, rectOpenings(PLAN.openings), ex, ey);
  const { nx, ny, xs, ys } = m, out = new Uint8Array(nx * ny);
  const label = cur.locate ? labelCells(xs, ys, cur.locate) : null;
  for (let k = 0; k < nx * ny; k++) if (m.cell[k] === FREE && label) { if (label[k] === -2) m.cell[k] = SLANT; else if (label[k] === -1) out[k] = 1; }
  for (const p of all) {
    const b = boxOfRing(p), i0 = Math.max(0, lowerBound(xs, b.x) - 1), i1 = Math.min(nx, lowerBound(xs, b.x + b.w) + 1), j0 = Math.max(0, lowerBound(ys, b.y) - 1), j1 = Math.min(ny, lowerBound(ys, b.y + b.h) + 1);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const k = j * nx + i;
      if (m.cell[k] !== FREE) continue;
      if (cellHits(xs[i], ys[j], xs[i + 1], ys[j + 1], p)) m.cell[k] = SLANT;
    }
  }
  m.out = out;
  { const cell = m.cell; m.cell = cell.map((v) => (v === SLANT ? FREE : v)); computeTypes(m); m.cell = cell; }
  const A = h ? m.xs : m.ys, C = h ? m.ys : m.xs, K = h ? (u, v) => u * m.nx + v : (u, v) => v * m.nx + u;
  const rect = (c0, c1, a0, a1) => (h ? { x: a0, y: c0, w: a1 - a0, h: c1 - c0 } : { x: c0, y: a0, w: c1 - c0, h: a1 - a0 });
  return { m, A, C, K, rect, ai: (v) => lowerBound(A, v), ci: (v) => lowerBound(C, v), mixed: true, polys: polys.polys, quads: polys.quads };
}

/** Does polygon p overlap the open rectangle (x0, y0)–(x1, y1) (more than touching it)? */
function cellHits(x0, y0, x1, y1, p) {
  if (pointInPolygon((x0 + x1) / 2, (y0 + y1) / 2, p)) return true;
  const e = 1e-7;
  for (let i = 0; i < p.length; i++) {
    const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    let ok = true;
    for (const [q, r] of [[-dx, ax - x0 - e], [dx, x1 - e - ax], [-dy, ay - y0 - e], [dy, y1 - e - ay]]) {
      if (Math.abs(q) < 1e-15) { if (r < 0) { ok = false; break; } continue; }
      const t = r / q;
      if (q < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
    }
    if (ok && t1 - t0 > 1e-9) return true;
  }
  return false;
}

/**
 * Exact end of a rect wall (cross-section [c0, c1], axis) heading `dir` (±1) from `end` into an angled wall: the last
 * 5 cm grid position before the slant footprint (the joint fill closes the rest); null when nothing angled is ahead
 * within `reach`. `quad: true` when what it meets is the gap of an opening.
 */
function slantContact(E, axis, c0, c1, end, dir, reach) {
  let best = null;
  for (const [list, quad] of [[E.polys, false], [E.quads, true]]) for (const p of list) {
    const ext = bandExtent(p, axis, c0, c1);
    if (!ext) continue;
    const d = dir > 0 ? ext[0] - end : end - ext[1];
    if (d < -reach || d > reach) continue;
    if (!best || d < best.d) best = { d, quad, at: dir > 0 ? ext[0] : ext[1] };
  }
  if (!best) return null;
  return { quad: best.quad, end: dir > 0 ? Math.floor(best.at / SNAP + 1e-9) * SNAP : Math.ceil(best.at / SNAP - 1e-9) * SNAP };
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
const lockedAt = (rect) => current().segments.find((s) => s.policy.level === 'locked' && overlapArea(s, rect) > 0 && (s.axis !== 'a' || intersectArea([s.poly], rect) > 0.01)) || null;
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
  if (d.slantLevel || current().slantLevel ? narrowRooms(d) : d.narrow > current().narrow + 1) return `That would leave a space narrower than ${MIN_CLEAR} cm — join the wall to the next wall or leave at least ${MIN_CLEAR} cm.`;
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
    let slanted = 0;
    for (let u = u0; u < u1; u++) { const k = K(u, v), c = m.cell[k]; if (c === GAP) return 'opening'; if (c === SLANT) slanted++; else if (c === WALL) walls++; else if (m.out[k] && !ENV.draft) return 'out'; else free++; }
    return slanted ? 'slant' : walls === 0 ? 'free' : free === 0 ? 'wall' : 'mixed';
  };
  let ka = E.ai(a), kb = E.ai(b);
  if (slab(ka) === 'free') {
    let k = ka - 1, gap = 0;
    while (slab(k) === 'free' && gap <= TRIM) { gap += A[k + 1] - A[k]; k--; }
    if (gap <= TRIM && (slab(k) === 'wall' || slab(k) === 'slant')) ka = k + 1;
  } else while (ka < kb && (slab(ka) === 'wall' || slab(ka) === 'slant')) ka++;
  if (slab(kb - 1) === 'free') {
    let k = kb, gap = 0;
    while (slab(k) === 'free' && gap <= TRIM) { gap += A[k + 1] - A[k]; k++; }
    if (gap <= TRIM && (slab(k) === 'wall' || slab(k) === 'slant')) kb = k;
  } else while (kb > ka && (slab(kb - 1) === 'wall' || slab(kb - 1) === 'slant')) kb--;
  // While drafting, a wall drawn by its centre line from / to the centre line of another wall overlaps it partly at
  // the corner: take in the whole overlap (both walls' thickness) so the two make a clean corner.
  let lead = ka, trail = kb;
  if (ENV.draft) {
    while (slab(ka) === 'mixed' && slab(ka - 1) === 'mixed') ka--;
    while (kb > ka && slab(kb - 1) === 'mixed' && slab(kb) === 'mixed') kb++;
    lead = ka; while (lead < kb && slab(lead) === 'mixed') lead++;
    trail = kb; while (trail > lead && slab(trail - 1) === 'mixed') trail--;
  }
  if (kb <= ka || A[kb] - A[ka] < MIN_WALL) return fail(`A wall must be at least ${MIN_WALL} cm long.`);
  const rect = E.rect(c0, c1, A[ka], A[kb]);
  let fresh = 0;
  for (let v = ka; v < kb; v++) {
    const s = slab(v);
    if (s === 'out') return fail('A new wall must stay inside the house.');
    if (s === 'opening') return fail('A wall cannot run through a door or window.');
    if (s === 'mixed' && v >= lead && v < trail) return fail('A wall cannot run along or on top of another wall.');
    if (s === 'mixed') { fresh += A[v + 1] - A[v]; continue; }
    if (s === 'slant') {                                   // crossing an angled wall: only an unlocked one, never its door / window
      const r = E.rect(c0, c1, A[v], A[v + 1]), hit = lockedAt(r);
      if (hit) return fail(hit.cls === 'mamad' ? REASONS.mamad : 'A new wall cannot cross an exterior wall. ' + REASONS.exteriorWall);
      if (E.quads.some((q) => intersectArea([q], r) > 0.01)) return fail('A wall cannot run through a door or window.');
      continue;
    }
    if (s === 'free') fresh += A[v + 1] - A[v];
    else { const hit = lockedAt(E.rect(c0, c1, A[v], A[v + 1])); if (hit) return fail(hit.cls === 'mamad' ? REASONS.mamad : 'A new wall cannot cross an exterior wall. ' + REASONS.exteriorWall); }
  }
  if (!fresh) return fail('There is already a wall here.');
  if (ENV.mamad.shell && overlapArea(rect, ENV.mamad.shell) > 0) return fail('No walls may be built inside the safe room. ' + REASONS.mamad);
  if (slab(ka - 1) === 'opening' || slab(kb) === 'opening') return fail('A wall cannot end on a door or window.');
  if (E.mixed) {
    // ends next to an angled wall: fitted exactly to its face on the 5 cm grid (the slant's joint fill closes the rest)
    let a0 = A[ka], a1 = A[kb];
    const axis = E.rect(0, 1, 0, 1).w === 1 ? 'h' : 'v';
    if (slab(ka - 1) === 'slant') { const q = slantContact(E, axis, c0, c1, a0, -1, TRIM + TMAX); if (q) { if (q.quad) return fail('A wall cannot end on a door or window.'); a0 = q.end; } }
    if (slab(kb) === 'slant') { const q = slantContact(E, axis, c0, c1, a1, 1, TRIM + TMAX); if (q) { if (q.quad) return fail('A wall cannot end on a door or window.'); a1 = q.end; } }
    if (a1 - a0 < MIN_WALL) return fail(`A wall must be at least ${MIN_WALL} cm long.`);
    return { ok: true, rect: E.rect(c0, c1, a0, a1), ka, kb, u0, u1, exact: true };
  }
  return { ok: true, rect, ka, kb, u0, u1 };
}

/** Does the level being edited have angled walls (then its walls cannot be edited until stage A2)? */
const angledHere = () => { const sl = liveSlants(); return (Array.isArray(sl) && sl.length > 0) || PLAN.openings.some(isAngledOpening); };

function planAddWall(input) {
  const p = input || {};
  if (![p.x1, p.y1, p.x2, p.y2].every(num)) return fail('A wall needs two points.');
  if (p.angled === true && !nearAxis(p.x1, p.y1, p.x2, p.y2)) return planAddSlant(p);
  const t = Math.round(p.thickness == null ? NEW_WALL.def : p.thickness), max = ENV.draft ? NEW_WALL.draftMax : NEW_WALL.max;
  if (!(t >= NEW_WALL.min && t <= max)) return fail(ENV.draft ? `Walls are ${NEW_WALL.min}–${max} cm thick.` : `New partitions are ${NEW_WALL.min}–${max} cm thick.`);
  const x1 = snap(p.x1), y1 = snap(p.y1), x2 = snap(p.x2), y2 = snap(p.y2);
  const axis = Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? 'h' : 'v';
  const a = axis === 'h' ? Math.min(x1, x2) : Math.min(y1, y2), b = axis === 'h' ? Math.max(x1, x2) : Math.max(y1, y2);
  if (b - a < SNAP) return fail(`A wall must be at least ${MIN_WALL} cm long.`);
  const c0 = snap((axis === 'h' ? y1 : x1) - t / 2), c1 = c0 + t;
  const E = editModel(axis, [a, b], [c0, c1]);
  const fit = fitWall(E, c0, c1, a, b);
  if (!fit.ok) return fit;
  let d;
  if (fit.exact) d = derive([...PLAN.walls, fit.rect, ...rectOpenings(PLAN.openings)], PLAN.openings, PLAN.rooms, PLAN.walls, liveSlants());
  else { paint(E.m, fit.rect, WALL); d = derive([...wallRects(E.m), ...PLAN.openings], PLAN.openings, PLAN.rooms, PLAN.walls, liveSlants()); }
  const bad = fitChecks(d, fit.rect, axis);
  if (bad) return fail(bad);
  return { ok: true, rect: fit.rect, level: 'free', axis, d };
}

/** Dry run of addWall for live feedback while drawing: `{ ok, reason?, rect?, level? }` (rect = the trimmed wall). */
export function canAddWall(input) { return onLevel(activeLevel(), () => canAddWallImpl(input)); }
function canAddWallImpl(input) {
  const r = planAddWall(input);
  if (r.ok && r.slant) return { ok: true, slant: r.slant, poly: r.poly, level: r.level };
  return r.ok ? { ok: true, rect: r.rect, level: r.level } : r;
}

const idsIn = (d, rect, axis) => d.segments.filter((s) => s.axis === axis && overlapArea(s.core, rect) > 0).map((s) => s.id);

/**
 * Draw a new partition from (x1, y1) to (x2, y2) (centre line, cm). Axis-aligned (the smaller delta is dropped),
 * snapped to 5 cm, trimmed / extended (≤ 15 cm) to the faces of the walls it meets.
 */
export function addWall(...args) { return tracked('addWall', onActive(addWallImpl), args); }
function addWallImpl(input, opts) {
  const r = planAddWall(input);
  if (!r.ok) return r;
  if (r.slant) return commit(r.d, 'add-wall', { level: 'free', ids: [r.segId] }, opts);
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
const inCore = (s) => (o) => o.axis !== 'a' && overlapArea(o, s.core) > 0;

/** Remove a wall segment and the openings in it. Junction squares stay with the walls that meet there. */
export function removeWallSegment(...args) { return tracked('removeWallSegment', onActive(removeWallSegmentImpl), args); }
function removeWallSegmentImpl(segmentId, opts) {
  const q = editableSegment(segmentId);
  if (!q.ok) return q;
  if (q.s.axis === 'a') return removeSlant(q.s, opts);
  const { s } = q, E = editModel(s.axis, [], []);
  paint(E.m, s.core, FREE);
  const openings = PLAN.openings.filter((o) => !inCore(s)(o));
  const d = derive([...wallRects(E.m), ...openings], openings, PLAN.rooms, PLAN.walls, liveSlants());
  if (d.problems.length) return fail(problemText(d));
  return commit(d, 'remove-wall', { level: s.policy.level, reason: s.policy.reason, ids: [segmentId] }, opts);
}

/**
 * Move a wall segment sideways by `delta` cm (+ = east / south). Walls that meet its ends stretch or shrink to
 * follow; its doors travel with it.
 */
export function moveWallSegment(...args) { return tracked('moveWallSegment', onActive(moveWallSegmentImpl), args); }
function moveWallSegmentImpl(segmentId, delta, opts) {
  const q = editableSegment(segmentId);
  if (!q.ok) return q;
  if (q.s.axis === 'a') return moveSlant(q.s, delta, opts);
  const d0 = snap(num(delta) ? delta : 0), { s } = q;
  if (!d0) return { ok: true, level: s.policy.level, warnings: [], ids: [segmentId] };
  const riders = cornerOpenings(s, d0);
  if (typeof riders === 'string') return fail(riders);
  const r = riders.length ? withOpenings(riders, s, d0) : planMoveWall(s, d0);
  if (!r.ok) return r;
  return commit(r.d, 'move-wall', { level: s.policy.level, reason: s.policy.reason, ids: idsIn(r.d, r.target, s.axis) }, opts);
}

/**
 * Doors / passages "hung at the corner" of a wall that is about to move: in a perpendicular wall it ends on, with at
 * most CORNER_REACH cm of wall between them and the moving wall's face. They travel with the wall (same jamb), so a
 * bedroom door next to a partition does not pin the partition. Openings further away stay where they are and block
 * the move only if the wall would come too close (the usual jamb rule) or cut them.
 * @returns {Array<{ from: object, to: object }> | string}  the moves, or a refusal text
 */
function cornerOpenings(s, d0) {
  const { c0, c1, a0, a1 } = coreSpan(s), out = [];
  const hz = s.axis === 'h';
  for (const o of PLAN.openings) {
    if (o.axis === s.axis || o.axis === 'a') continue;
    // flush with one end of the core: the opening's wall is the wall this one ends on
    const across0 = hz ? o.x : o.y, across1 = hz ? o.x + o.w : o.y + o.h;
    if (across1 !== a0 && across0 !== a1) continue;
    const o0 = hz ? o.y : o.x, o1 = o0 + o.width;
    const ahead = o0 >= c1 ? o0 - c1 : o1 <= c0 ? c0 - o1 : -1;    // wall between the opening and the moving wall's face
    if (ahead < 0 || ahead > CORNER_REACH) continue;
    if (policyOfOpening(o).level !== 'free') continue;               // exterior / mamad openings never move by themselves
    const seg = segmentOfOpening(o);
    if (!seg) continue;
    const q = coreSpan(seg);
    // the far end of its own wall must leave room for the jamb (the near end follows the moving wall)
    if (o0 >= c1 ? o1 + d0 > q.a1 - MIN_JAMB : o0 + d0 < q.a0 + MIN_JAMB) {
      const what = openingWord(o);
      return `The ${what} beside the end of this wall has no room to move along with it — move or narrow the ${what} first.`;
    }
    out.push({ from: o, to: { ...o, ...(hz ? { y: o.y + d0 } : { x: o.x + d0 }) } });
  }
  return out;
}

/**
 * Move a wall while some openings ride along: the move is planned with those openings filled with wall (so they
 * neither pin the junction nor get in the way), then they are put back in at their new places and the result is
 * checked again (solid wall all along each of them, jambs, overlaps). The live plan is untouched.
 */
function withOpenings(moves, s, d0) {
  const saved = { walls: PLAN.walls, openings: PLAN.openings, rooms: PLAN.rooms, wallOutline: PLAN.wallOutline, analysis };
  const riding = new Set(moves.map((m) => m.from));
  const t = derive(solidsOf(PLAN), PLAN.openings.filter((o) => !riding.has(o)), PLAN.rooms, PLAN.walls, liveSlants());
  let r;
  PLAN.walls = t.walls; PLAN.openings = t.openings; PLAN.rooms = t.rooms; PLAN.wallOutline = t.wallOutline; analysis = t;
  try { r = planMoveWall(s, d0); } finally {
    PLAN.walls = saved.walls; PLAN.openings = saved.openings; PLAN.rooms = saved.rooms; PLAN.wallOutline = saved.wallOutline;
    analysis = saved.analysis;
    invalidatePlanCaches();
  }
  if (!r.ok) return r;
  const blocked = moves.find((m) => r.d.walls.reduce((a, w) => a + overlapArea(w, m.to), 0) !== m.to.w * m.to.h);
  if (blocked) return fail(`The ${openingWord(blocked.from)} next to this wall cannot move along with it here — move the ${openingWord(blocked.from)} first.`);
  // back in their original order, so ids / drawing order do not shuffle
  const order = new Map(PLAN.openings.map((o, i) => [o.id, i]));
  const openings = [...r.d.openings, ...moves.map((m) => m.to)].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  const d = derive([...r.d.walls, ...r.d.openings], openings, PLAN.rooms, PLAN.walls, liveSlants());
  const bad = fitChecks(d, r.target, s.axis);
  if (bad) return fail(bad === 'A wall cannot run along or on top of another wall.' ? 'That would cross another wall.' : bad);
  return { ok: true, d, target: r.target };
}
const openingWord = (o) => (o.kind === 'opening' ? 'passage' : o.kind === 'window' ? 'window' : 'door');

/** The geometry of a sideways wall move on the live plan: { ok, d, target } (nothing installed) or a refusal. */
function planMoveWall(s, d0) {
  const { c0, c1, a0, a1 } = coreSpan(s), t = c1 - c0, n0 = c0 + d0, n1 = c1 + d0;
  const E = editModel(s.axis, [a0 + t, a1 - t], [n0, n1]), { m, K } = E;
  const uc0 = E.ci(c0), uc1 = E.ci(c1), un0 = E.ci(n0), un1 = E.ci(n1), va0 = E.ai(a0), va1 = E.ai(a1);
  const cross = 'That would cross another wall.';
  // a level with angled walls: an end of this wall on an angled wall is refitted to its face at the new place
  const slantEnd = [false, false];
  let b0 = a0, b1 = a1;
  if (E.mixed) {
    for (const [n, v] of [[0, va0 - 1], [1, va1]]) for (let u = uc0; u < uc1; u++) if (v >= 0 && m.cell[K(u, v)] === SLANT) slantEnd[n] = true;
    for (const [n, dir] of [[0, -1], [1, 1]]) {
      if (!slantEnd[n]) continue;
      const q = slantContact(E, s.axis, n0, n1, n ? a1 : a0, dir, 200);
      if (!q) return fail('That wall would come off the angled wall it ends on.');
      if (q.quad) return fail('That wall would end on a door or window.');
      if (n) b1 = q.end; else b0 = q.end;
    }
  }
  for (let v = va0; v < va1; v++) for (let u = d0 > 0 ? uc1 : un0; u < (d0 > 0 ? un1 : uc0); u++) {
    const k = K(u, v);
    if (E.mixed && (E.A[v + 1] <= b0 || E.A[v] >= b1)) continue;          // beyond a refitted end
    if (m.cell[k] === SLANT && E.mixed) continue;
    if (m.cell[k]) return fail(cross);
    if (m.out[k] && !ENV.draft) return fail('A wall cannot leave the house.');
  }
  const hull0 = Math.min(uc0, un0), hull1 = Math.max(uc1, un1), fill = [], clear = [];
  for (const end of [{ v: va0 - 1, dir: -1, n: 0 }, { v: va1, dir: 1, n: 1 }]) {
    const across = (v, u0, u1, test) => { for (let u = u0; u < u1; u++) if (!test(K(u, v))) return false; return true; };
    if (slantEnd[end.n]) continue;                                                             // refitted below
    if (across(end.v, uc0, uc1, (k) => !m.cell[k])) continue;                                    // free end
    if (!across(end.v, uc0, uc1, (k) => m.cell[k] !== GAP)) return fail('That wall end meets a door or window — it cannot move.');
    if (!across(end.v, uc0, uc1, (k) => m.cell[k] === WALL)) return fail('That wall is only partly joined to its neighbour — remove it and draw it again instead.');
    if (across(end.v, uc0, uc1, (k) => m.type[k] === T_J)) {
      const rows = [];
      let v = end.v;
      while (across(v, uc0, uc1, (k) => m.cell[k] && m.type[k] === T_J)) { rows.push(v); v += end.dir; }
      const continues = across(v, uc0, uc1, (k) => m.cell[k] !== FREE);
      const landed = rows.every((r) => across(r, un0, un1, (k) => m.cell[k] === WALL));
      if (!rows.every((r) => across(r, un0, un1, (k) => m.cell[k] !== GAP))) return fail('That wall would end on a door or window.');
      for (const r of rows) for (let u = hull0; u < hull1; u++) {                               // stretch the wall it meets
        const k = K(u, r);
        if (m.cell[k] === FREE) { if (m.out[k] && !ENV.draft) return fail('A wall cannot leave the house.'); fill.push(k); }
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
  if (!E.mixed) for (let v = va0; v < va1; v++) { for (let u = un0; u < un1; u++) m.cell[K(u, v)] = WALL; }
  for (const k of clear) m.cell[k] = FREE;
  for (const k of fill) m.cell[k] = WALL;
  const moved = inCore(s), shift = s.axis === 'h' ? { y: d0 } : { x: d0 };
  const openings = PLAN.openings.map((o) => (moved(o) ? { ...o, x: o.x + (shift.x || 0), y: o.y + (shift.y || 0) } : o));
  let target = E.rect(n0, n1, a0, a1), extra = [];
  if (E.mixed) {
    if (b1 - b0 < MIN_WALL) return fail(`A wall must be at least ${MIN_WALL} cm long.`);
    if (openings.some((o) => moved(o) && (along(o) < b0 + MIN_JAMB || along(o) + o.width > b1 - MIN_JAMB))) return fail('That wall would end on a door or window.');
    target = E.rect(n0, n1, b0, b1);
    const sweep = E.rect(Math.min(c0, n0), Math.max(c1, n1), b0 + (slantEnd[0] ? TMAX : 0), b1 - (slantEnd[1] ? TMAX : 0));
    if ([...E.polys, ...E.quads].some((p) => intersectArea([p], target) > 0.5 || (sweep.w > 0 && sweep.h > 0 && intersectArea([p], sweep) > 0.5))) return fail(cross);
    extra = [target];
  }
  const d = derive([...wallRects(m), ...extra, ...(E.mixed ? rectOpenings(openings) : openings)], openings, PLAN.rooms, PLAN.walls, liveSlants());
  const bad = fitChecks(d, target, s.axis);
  if (bad) return fail(bad === 'A wall cannot run along or on top of another wall.' ? cross : bad);
  return { ok: true, d, target };
}

/**
 * Change where a wall segment starts / ends along its own axis (plan cm; omitted = unchanged). Ends are trimmed /
 * extended to wall faces like addWall. Shortening an end that met another wall leaves a gap of ≥ 60 cm.
 */
export function resizeWallSegment(...args) { return tracked('resizeWallSegment', onActive(resizeWallSegmentImpl), args); }
function resizeWallSegmentImpl(segmentId, range, opts) {
  const q = editableSegment(segmentId);
  if (!q.ok) return q;
  if (q.s.axis === 'a') return resizeSlant(q.s, range, opts);
  const { s } = q, { c0, c1, a0, a1 } = coreSpan(s), r = range || {};
  const a = num(r.start) ? snap(r.start) : a0, b = num(r.end) ? snap(r.end) : a1;
  if (a === a0 && b === a1) return { ok: true, level: s.policy.level, warnings: [], ids: [segmentId] };
  if (b - a < MIN_WALL) return fail(`A wall must be at least ${MIN_WALL} cm long.`);
  const E = editModel(s.axis, [a, b], []);
  paint(E.m, s.core, FREE);
  const fit = fitWall(E, c0, c1, a, b);
  if (!fit.ok) return fit;
  if (PLAN.openings.some((o) => inCore(s)(o) && overlapArea(o, fit.rect) < o.w * o.h)) return fail('Remove the door in this part of the wall first.');
  let d;
  if (fit.exact) d = derive([...wallRects(E.m), fit.rect, ...rectOpenings(PLAN.openings)], PLAN.openings, PLAN.rooms, PLAN.walls, liveSlants());
  else { paint(E.m, fit.rect, WALL); d = derive([...wallRects(E.m), ...PLAN.openings], PLAN.openings, PLAN.rooms, PLAN.walls, liveSlants()); }
  const bad = fitChecks(d, fit.rect, s.axis);
  if (bad) return fail(bad);
  return commit(d, 'resize-wall', { level: s.policy.level, reason: s.policy.reason, ids: idsIn(d, fit.rect, s.axis) }, opts);
}

// ---------------------------------------------------------------- angled walls: editing (stage A2)
/*
 * A slant is edited as data (its centre line + thickness in `slants`), then the level is derived (mixed derive) and the
 * result is checked with the same rules as rect walls, on polygons:
 *   problems of openings (jambs, overlaps) · a space narrower than 60 cm (every changed room shrunk by 30 cm with the
 *   polygon kernel: nothing left, or more pieces than before → too narrow) · crossing a locked wall (its centre line
 *   passes through one) · outside the house in a fixed plan · shorter than 30 cm · on top of / along another wall ·
 *   through, ending on or < 10 cm beside a door / window · inside the safe room.
 * Centre lines are kept on 0.1 cm; ends are snapped (slants.js snapSlantEnd). The joins are slant-geom's.
 */
const rectSolidsNow = () => [...PLAN.walls, ...rectOpenings(PLAN.openings)];
const slantOf = (seg) => (liveSlants() || []).find((x) => x.id === seg.slantId) || null;
const setEnd = (s, k, P) => (k ? { ...s, x2: P[0], y2: P[1] } : { ...s, x1: P[0], y1: P[1] });
const endOf = (s, k) => (k ? [s.x2, s.y2] : [s.x1, s.y1]);
const roundSlant = (s) => ({ ...s, x1: r01(s.x1), y1: r01(s.y1), x2: r01(s.x2), y2: r01(s.y2) });
/** A new slant id on the level being edited ('s<n>', above every id the level and its base level have used). */
function newSlantId(list) {
  const base = ENV.level ? levelOf(BASE_PLAN, ENV.level) : BASE_PLAN;
  let n = 0;
  for (const s of [...list, ...((base && base.slants) || [])]) { const k = /^s(\d+)$/.exec(s.id); if (k) n = Math.max(n, +k[1]); }
  return 's' + String(n + 1).padStart(2, '0');
}
/** Derive the level with these slants / openings / rect walls (nothing installed); `d.slants` = the slant list. */
function slantState(slants, openings, walls = PLAN.walls) {
  const d = derive([...walls, ...rectOpenings(openings)], openings, PLAN.rooms, PLAN.walls, slants);
  d.slants = slants;
  return d;
}
/** Is (x, y) outdoors in a derived level (polygon faces, or the grid of an orthogonal level)? */
function outdoorPoint(an, x, y) {
  if (an.locate) return an.locate(x, y) === -1;
  const m = an.m, i = lowerBound(m.xs, x) - 1, j = lowerBound(m.ys, y) - 1;
  if (i < 0 || j < 0 || i >= m.nx || j >= m.ny) return true;
  const k = j * m.nx + i;
  return !m.cell[k] && !!m.out[k];
}
/** A changed room narrower than MIN_CLEAR somewhere (see the block comment)? */
function narrowRooms(d) {
  const prev = new Map(PLAN.rooms.map((r) => [r.id, r])), half = MIN_CLEAR / 2;
  for (const r of d.rooms) {
    const p = prev.get(r.id);
    if (p && p.polygon === r.polygon) continue;
    const n = clearPieces(r.polygon, half);
    if (n === 0 || (n > 1 && n > (p ? clearPieces(p.polygon, half) : 1))) return true;
  }
  return false;
}
const ringOf = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
const NARROW = `That would leave a space narrower than ${MIN_CLEAR} cm — join the wall to the next wall or leave at least ${MIN_CLEAR} cm.`;

/**
 * The rules for changed slants `changed` (new objects) in the derived level `d`, against the level before (`before`).
 * `move`: wording of a move. Returns a refusal text or null.
 */
function slantChecks(d, changed, before, move = false) {
  const L = d.slantLevel, ids = new Set(changed.map((s) => s.id));
  for (const s of changed) {
    const g = L && L.byId.get(s.id);
    if (!g) continue;
    const f = g.f;
    if (f.len < MIN_WALL) return `A wall must be at least ${MIN_WALL} cm long.`;
    if (!ENV.draft && ENV.mamad.shell && intersectArea([g.poly], ENV.mamad.rects) > 1) return 'No walls may be built inside the safe room. ' + REASONS.mamad;
    const box = g.box, near = (r) => overlapsBox(Array.isArray(r) ? boxOfRing(r) : r, { x: box.x - 15, y: box.y - 15, w: box.w + 30, h: box.h + 30 });
    for (const seg of before.segments) {
      if (seg.policy.level !== 'locked' || (seg.axis === 'a' && ids.has(seg.slantId)) || !overlapsBox(seg, box)) continue;
      const ring = seg.axis === 'a' ? seg.poly : ringOf(seg);
      if (centreIn(s, ring).some(([a, b]) => a > 0.5 && b < f.len - 0.5)) return seg.cls === 'mamad' ? REASONS.mamad : (move ? 'A wall cannot cross an exterior wall. ' : 'A new wall cannot cross an exterior wall. ') + REASONS.exteriorWall;
    }
    if (!ENV.draft) for (let a = 0; a <= f.len; a += Math.max(5, f.len / Math.ceil(f.len / 20))) {
      if (outdoorPoint(before, s.x1 + f.ux * a, s.y1 + f.uy * a)) return move ? 'A wall cannot leave the house.' : 'A new wall must stay inside the house.';
    }
    // on top of / along another wall: the middle of its strip (ends excluded: joins overlap there)
    const cut = Math.min(f.len / 4, 1.5 * TMAX), mid = f.len - 2 * cut;
    if (mid > 1) {
      const strip = freePoly({ ...s, x1: s.x1 + f.ux * cut, y1: s.y1 + f.uy * cut, x2: s.x2 - f.ux * cut, y2: s.y2 - f.uy * cut });
      const others = [...PLAN.walls.filter(near), ...L.list.filter((o) => !ids.has(o.s.id) && near(o.poly)).map((o) => o.poly)];
      const ov = others.length ? intersectArea([strip], others) : 0, own = mid * f.t;
      if (ov > 0.9 * own) return 'There is already a wall here.';
      if (ov > 0.5 * own) return move ? 'That would cross another wall.' : 'A wall cannot run along or on top of another wall.';
    }
    // doors / windows of OTHER walls: not through them, not ending on them, ≥ 10 cm of wall beside them
    const gaps = [...rectOpenings(d.openings).filter(near).map((o) => ({ o, ring: ringOf(o) })),
      ...d.openings.filter((o) => isAngledOpening(o) && !ids.has(o.wall)).map((o) => ({ o, ring: quadOfOpening(o) })).filter((q) => q.ring && near(q.ring))];
    for (const { o, ring } of gaps) {
      if (intersectArea([g.poly], [ring]) > 0.01) return 'A wall cannot run through a door or window.';
      if (polyGap(g.poly, ring) < MIN_JAMB - 1e-6) return `Too close to ${o.kind === 'window' ? 'a window' : o.kind === 'opening' ? 'a passage' : 'a door'} — keep at least ${MIN_JAMB} cm of wall beside it.`;
    }
  }
  if (d.problems.length) return problemText(d);
  if (narrowRooms(d)) return NARROW;
  return null;
}
/** The new slants get their kind from their derived class (exterior / mamad / interior), as plan-build does. */
function withKinds(d, ids) {
  d.slants = d.slants.map((s) => {
    if (!ids.has(s.id)) return s;
    const g = d.segments.find((x) => x.axis === 'a' && x.slantId === s.id), k = g ? KIND_OF[g.cls] : s.kind;
    return k === s.kind ? s : { ...s, kind: k };
  });
  return d;
}
/** Openings of slant `old` re-measured on `next`, keeping their centre (moved by dx, dy). */
function remeasure(openings, old, next, dx = 0, dy = 0) {
  const fo = slantFrame(old);
  return openings.map((o) => {
    if (!isAngledOpening(o) || o.wall !== old.id) return o;
    const at = atOf(next, old.x1 + fo.ux * o.at + dx, old.y1 + fo.uy * o.at + dy);
    return Math.abs(at - o.at) < 1e-6 ? o : { ...o, at };
  });
}
/** Thickness of a wall being drawn (as addWall) → { t } or { reason }. */
function newThickness(p) {
  const t = Math.round(p.thickness == null ? NEW_WALL.def : p.thickness), max = ENV.draft ? NEW_WALL.draftMax : NEW_WALL.max;
  if (!(t >= NEW_WALL.min && t <= max)) return { reason: ENV.draft ? `Walls are ${NEW_WALL.min}–${max} cm thick.` : `New partitions are ${NEW_WALL.min}–${max} cm thick.` };
  return { t };
}

/** addWall({ …, angled: true }) off the axes: { ok, slant, poly, level, d, segId } or a refusal. */
function planAddSlant(p) {
  const th = newThickness(p);
  if (th.reason) return fail(th.reason);
  const list = liveSlants() || [], rects = rectSolidsNow();
  let s = { id: newSlantId(list), x1: r01(p.x1), y1: r01(p.y1), x2: r01(p.x2), y2: r01(p.y2), t: th.t, kind: 'interior' };
  if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < MIN_WALL) return fail(`A wall must be at least ${MIN_WALL} cm long.`);
  s = setEnd(s, 0, snapSlantEnd(s, 0, list, rects));
  s = setEnd(s, 1, snapSlantEnd(s, 1, list, rects));
  if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < MIN_WALL) return fail(`A wall must be at least ${MIN_WALL} cm long.`);
  const before = current(), d = slantState([...list, s], PLAN.openings);
  const bad = slantChecks(d, [s], before);
  if (bad) return fail(bad);
  withKinds(d, new Set([s.id]));
  const g = d.segments.find((x) => x.axis === 'a' && x.slantId === s.id);
  return { ok: true, slant: d.slants[d.slants.length - 1], poly: g.poly, level: 'free', d, segId: g.id };
}

/** Remove an angled wall and the openings in it (rooms merge). */
function removeSlant(seg, opts) {
  const s = slantOf(seg);
  if (!s) return fail('No such wall.');
  const d = slantState(liveSlants().filter((x) => x !== s), PLAN.openings.filter((o) => !(isAngledOpening(o) && o.wall === s.id)));
  if (d.problems.length) return fail(problemText(d));
  return commit(d, 'remove-wall', { level: seg.policy.level, reason: seg.policy.reason, ids: [seg.id] }, opts);
}

/**
 * The end face of rect wall `r` that heads into the slant with frame f (both corners on one side, the nearer one):
 * { axis, dir, c0, c1 } or null.
 */
function rectHeading(r, f) {
  const cand = r.w >= r.h ? [{ axis: 'h', dir: -1, c: [[r.x, r.y], [r.x, r.y + r.h]] }, { axis: 'h', dir: 1, c: [[r.x + r.w, r.y], [r.x + r.w, r.y + r.h]] }]
    : [{ axis: 'v', dir: -1, c: [[r.x, r.y], [r.x + r.w, r.y]] }, { axis: 'v', dir: 1, c: [[r.x, r.y + r.h], [r.x + r.w, r.y + r.h]] }];
  let best = null;
  for (const q of cand) {
    const d = q.c.map(([x, y]) => (x - f.x1) * f.nx + (y - f.y1) * f.ny);
    if (!(d[0] * d[1] > 0)) continue;
    const m = Math.min(Math.abs(d[0]), Math.abs(d[1]));
    if (!best || m < best.m) best = { ...q, m, c0: q.axis === 'h' ? r.y : r.x, c1: q.axis === 'h' ? r.y + r.h : r.x + r.w };
  }
  return best;
}
/**
 * Rect walls whose end met slant `old` (its joint fills) stretched / shrunk on the 5 cm grid to the face of `next`.
 * @returns {{ walls } | { reason }}
 */
function followRects(old, next, idx, joins, walls) {
  const nw = walls.length, out = walls.slice();
  const fo = slantFrame(old), fn = slantFrame(next), E = Math.max(200, 4 * TMAX);
  const strip = freePoly({ ...next, x1: next.x1 - fn.ux * E, y1: next.y1 - fn.uy * E, x2: next.x2 + fn.ux * E, y2: next.y2 + fn.uy * E });
  for (const ri of joins[idx].fills) {
    if (ri >= nw) return { reason: 'A door or window meets this wall at its end — it cannot move.' };
    const r = walls[ri], h = rectHeading(r, fo);
    if (!h) continue;
    const hit = lockedAt(r);
    if (hit && hit.axis !== 'a') return { reason: hit.cls === 'mamad' ? REASONS.mamad : REASONS.exteriorWall };
    const ext = bandExtent(strip, h.axis, h.c0, h.c1);
    if (!ext) return { reason: 'A wall that ends on this one would be left behind.' };
    const at = h.dir > 0 ? Math.floor(ext[0] / SNAP + 1e-9) * SNAP : Math.ceil(ext[1] / SNAP - 1e-9) * SNAP;
    const hz = h.axis === 'h', lo = hz ? r.x : r.y, hi = lo + (hz ? r.w : r.h);
    const a0 = h.dir > 0 ? lo : at, a1 = h.dir > 0 ? at : hi;
    if (a1 - a0 < SNAP) return { reason: 'That would squeeze a wall that ends on this one to nothing.' };
    out[ri] = hz ? { ...r, x: a0, w: a1 - a0 } : { ...r, y: a0, h: a1 - a0 };
  }
  return { walls: out };
}
/** Slants whose end makes a T on slant `old` (index idx): that end slides along its own line onto `next`. */
function followTees(list, idx, old, next, joins, changed) {
  const fo = slantFrame(old), fn = slantFrame(next);
  joins.forEach((jn, j) => {
    if (j === idx) return;
    jn.ends.forEach((e, k) => {
      if (e.type !== 'tee' || e.with[0] !== idx) return;
      const o = changed.get(list[j].id) || list[j], f = slantFrame(o), E = endOf(o, k);
      const X0 = lineCross(E[0], E[1], f.ux, f.uy, old.x1, old.y1, fo.ux, fo.uy), X1 = lineCross(E[0], E[1], f.ux, f.uy, next.x1, next.y1, fn.ux, fn.uy);
      if (X0 && X1) changed.set(o.id, setEnd(o, k, [r01(E[0] + X1[0] - X0[0]), r01(E[1] + X1[1] - X0[1])]));
    });
  });
}
/** Apply changed slants (Map id → slant) to the list and re-measure their openings. */
function applySlants(list, changed, openings, moved = null) {
  let ops = openings;
  const next = list.map((s) => changed.get(s.id) || s);
  for (const s of list) {
    const n = changed.get(s.id);
    if (n && n !== s) ops = moved && moved.id === s.id ? remeasure(ops, s, n, moved.dx, moved.dy) : remeasure(ops, s, n);
  }
  return { slants: next, openings: ops };
}

/**
 * Move an angled wall sideways by `delta` cm along its right-hand normal (+ = towards its 'r' side). Its ends slide along
 * the walls they meet (a slant end at a corner: the neighbour's end slides along the neighbour's own line, by line
 * intersection; on a rect: along the rect), walls that T onto it slide along their own lines, rect walls that end on it
 * stretch / shrink on the 5 cm grid; its openings travel with it.
 */
function moveSlant(seg, delta, opts) {
  const dl = r01(num(delta) ? delta : 0);
  if (!dl) return { ok: true, level: seg.policy.level, warnings: [], ids: [seg.id] };
  const list = liveSlants(), i = list.findIndex((x) => x.id === seg.slantId), s = list[i];
  if (!s) return fail('No such wall.');
  const f = slantFrame(s), rects = rectSolidsNow(), nw = PLAN.walls.length, joins = slantJoins(list, rects);
  const dx = f.nx * dl, dy = f.ny * dl, base = { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
  const changed = new Map(), joinedRects = new Set();
  let me = base;
  for (const k of [0, 1]) {
    const e = joins[i].ends[k], E0 = endOf(s, k);
    if (e.type === 'free' || e.type === 'degenerate') { me = setEnd(me, k, [r01(endOf(me, k)[0]), r01(endOf(me, k)[1])]); continue; }
    if (e.type === 'tee') {
      const b = list[e.with[0]], fb = slantFrame(b), P = lineCross(base.x1, base.y1, f.ux, f.uy, E0[0], E0[1], fb.ux, fb.uy);
      if (!P) return fail('That wall cannot slide along the wall it meets.');
      me = setEnd(me, k, [r01(P[0]), r01(P[1])]);
    } else if (e.type === 'rect') {
      if (e.with[0] >= nw) return fail('That wall end meets a door or window — it cannot move.');
      const r = rects[e.with[0]], hz = r.w >= r.h, P = lineCross(base.x1, base.y1, f.ux, f.uy, E0[0], E0[1], hz ? 1 : 0, hz ? 0 : 1);
      if (!P) return fail('That wall cannot slide along the wall it meets.');
      const a = hz ? P[0] : P[1], lo = hz ? r.x : r.y, hi = lo + (hz ? r.w : r.h);
      if (a < lo - s.t || a > hi + s.t) return fail('That wall would slide off the wall it ends on.');
      joinedRects.add(e.with[0]);
      me = setEnd(me, k, [r01(P[0]), r01(P[1])]);
    } else {
      const pts = [];
      for (const j of e.with) {
        const o = changed.get(list[j].id) || list[j], fo = slantFrame(o);
        const ko = Math.hypot(o.x1 - E0[0], o.y1 - E0[1]) <= Math.hypot(o.x2 - E0[0], o.y2 - E0[1]) ? 0 : 1, Q = endOf(o, ko);
        const P = lineCross(base.x1, base.y1, f.ux, f.uy, Q[0], Q[1], fo.ux, fo.uy);
        if (!P) return fail('That wall cannot slide along the wall it meets.');
        pts.push({ o, ko, P });
      }
      if (pts.some((q) => Math.hypot(q.P[0] - pts[0].P[0], q.P[1] - pts[0].P[1]) > 1)) return fail('Several walls meet at this wall\'s corner — it cannot be moved on its own.');
      const P = [r01(pts[0].P[0]), r01(pts[0].P[1])];
      me = setEnd(me, k, P);
      for (const q of pts) {
        const lockedO = current().segments.find((g) => g.axis === 'a' && g.slantId === q.o.id && g.policy.level === 'locked');
        if (lockedO) return fail(lockedO.cls === 'mamad' ? REASONS.mamad : REASONS.exteriorWall);
        changed.set(q.o.id, setEnd(q.o, q.ko, P));
      }
    }
  }
  changed.set(s.id, me);
  followTees(list, i, s, me, joins, changed);
  for (const id of changed.keys()) {
    if (id === s.id) continue;
    const g = current().segments.find((x) => x.axis === 'a' && x.slantId === id);
    if (g && g.policy.level === 'locked') return fail(g.cls === 'mamad' ? REASONS.mamad : REASONS.exteriorWall);
  }
  const fr = followRects(s, me, i, joins, PLAN.walls);
  if (fr.reason) return fail(fr.reason);
  // the strip it sweeps (its own ends and the walls that follow it excluded) must be clear of other walls
  const cut = Math.min(f.len / 3, 1.5 * TMAX), sg = Math.sign(dl), far = dl + sg * f.hw;
  const P1 = [s.x1 + f.ux * cut, s.y1 + f.uy * cut], P2 = [s.x2 - f.ux * cut, s.y2 - f.uy * cut];
  const sweep = [P1, P2, [P2[0] + f.nx * far, P2[1] + f.ny * far], [P1[0] + f.nx * far, P1[1] + f.ny * far]];
  const L0 = current().slantLevel, sb = boxOfRing(sweep);
  const obstacles = [...rects.filter((r, ri) => !joins[i].fills.includes(ri) && !joinedRects.has(ri) && overlapsBox(r, sb)),
    ...(L0 ? L0.list.filter((g) => !changed.has(g.s.id) && overlapsBox(g.box, sb)).map((g) => g.poly) : [])];
  if (obstacles.length && intersectArea([sweep], obstacles) > 0.5) return fail('That would cross another wall.');
  const { slants, openings } = applySlants(list, changed, PLAN.openings, { id: s.id, dx, dy });
  const before = current(), d = slantState(slants, openings, fr.walls);
  const bad = slantChecks(d, [...changed.values()], before, true);
  if (bad) return fail(bad);
  return commit(d, 'move-wall', { level: seg.policy.level, reason: seg.policy.reason, ids: [seg.id] }, opts);
}

/**
 * Lengthen / shorten an angled wall along its centre line: `start` / `end` = cm its start (x1, y1) / end (x2, y2) moves
 * OUTWARDS (+ longer, − shorter; omitted = 0). A moved end is snapped / joined like a drawn one; openings keep their place.
 */
function resizeSlant(seg, range, opts) {
  const r = range || {}, st = num(r.start) ? r01(r.start) : 0, en = num(r.end) ? r01(r.end) : 0;
  if (!st && !en) return { ok: true, level: seg.policy.level, warnings: [], ids: [seg.id] };
  const list = liveSlants(), s = slantOf(seg);
  if (!s) return fail('No such wall.');
  const f = slantFrame(s), others = list.filter((x) => x !== s), rects = rectSolidsNow();
  if (f.len + st + en < MIN_WALL) return fail(`A wall must be at least ${MIN_WALL} cm long.`);
  let ns = roundSlant({ ...s, x1: s.x1 - f.ux * st, y1: s.y1 - f.uy * st, x2: s.x2 + f.ux * en, y2: s.y2 + f.uy * en });
  if (st) ns = setEnd(ns, 0, snapSlantEnd(ns, 0, others, rects));
  if (en) ns = setEnd(ns, 1, snapSlantEnd(ns, 1, others, rects));
  const { slants, openings } = applySlants(list, new Map([[s.id, ns]]), PLAN.openings);
  const before = current(), d = slantState(slants, openings);
  const bad = slantChecks(d, [ns], before);
  if (bad) return fail(bad);
  return commit(d, 'resize-wall', { level: seg.policy.level, reason: seg.policy.reason, ids: [seg.id] }, opts);
}

/**
 * Drag one end of a wall to (x, y); the other end stays.
 *   An angled wall: the point is taken as given, then snapped / joined like a drawn end; other slant ends at the dragged
 *   corner follow it, walls that T onto it slide along their own lines, rect walls ending on it stretch; its openings
 *   keep their distance from the fixed end. Within 0.5° of an axis it becomes a rect wall (drawn as addWall would).
 *   A rect wall: with `angled: true` and the point off its axis it becomes an angled wall; otherwise the end moves along
 *   its own axis (= resizeWallSegment of that end).
 * @param {string} segmentId  'seg:a:<id>' or a rect segment id (prefixed on upper levels)
 * @param {'a' | 'b'} end     'a' = the start (x1, y1) of a slant / the west or north end of a rect core; 'b' = the other
 * @param {{ x, y, angled? }} point
 */
export function rotateWallEnd(...args) { return tracked('rotateWallEnd', onActive(rotateWallEndImpl), args); }
function rotateWallEndImpl(segmentId, end, point, opts) {
  const q = editableSegment(segmentId);
  if (!q.ok) return q;
  if (end !== 'a' && end !== 'b') return fail('The end must be \'a\' (start) or \'b\' (end).');
  const p = point || {};
  if (!num(p.x) || !num(p.y)) return fail('A wall end needs a point.');
  const seg = q.s, k = end === 'b' ? 1 : 0;
  if (seg.axis !== 'a') {
    const { c0, c1, a0, a1 } = coreSpan(seg), cm = (c0 + c1) / 2, h = seg.axis === 'h';
    const fixed = h ? [k ? a0 : a1, cm] : [cm, k ? a0 : a1];
    if (p.angled === true && !nearAxis(fixed[0], fixed[1], p.x, p.y)) return rectToSlant(seg, k, [p.x, p.y], opts);
    return resizeWallSegmentImpl(segmentId, k ? { end: h ? p.x : p.y } : { start: h ? p.x : p.y }, opts);
  }
  const list = liveSlants(), i = list.findIndex((x) => x.id === seg.slantId), s = list[i];
  if (!s) return fail('No such wall.');
  const fixed = endOf(s, 1 - k);
  if (nearAxis(fixed[0], fixed[1], p.x, p.y)) return slantToRect(seg, s, k, [p.x, p.y], opts);
  const E0 = endOf(s, k), atCorner = (o) => [0, 1].find((ko) => Math.hypot(endOf(o, ko)[0] - E0[0], endOf(o, ko)[1] - E0[1]) <= 1);
  const partners = list.filter((o) => o !== s && atCorner(o) !== undefined), rects = rectSolidsNow();
  let ns = setEnd(s, k, [r01(p.x), r01(p.y)]);
  ns = setEnd(ns, k, snapSlantEnd(ns, k, list.filter((o) => o !== s && !partners.includes(o)), rects));
  const P = endOf(ns, k);
  if (Math.hypot(P[0] - fixed[0], P[1] - fixed[1]) < MIN_WALL) return fail(`A wall must be at least ${MIN_WALL} cm long.`);
  const changed = new Map([[s.id, ns]]);
  for (const o of partners) {
    const g = current().segments.find((x) => x.axis === 'a' && x.slantId === o.id);
    if (g && g.policy.level === 'locked') return fail(g.cls === 'mamad' ? REASONS.mamad : REASONS.exteriorWall);
    changed.set(o.id, setEnd(o, atCorner(o), P));
  }
  const joins = slantJoins(list, rects);
  followTees(list, i, s, ns, joins, changed);
  const fr = followRects(s, ns, i, joins, PLAN.walls);
  if (fr.reason) return fail(fr.reason);
  const { slants, openings: ops0 } = applySlants(list.map((x) => (x === s ? s : x)), new Map([...changed].filter(([id]) => id !== s.id)), PLAN.openings);
  // its own openings keep their distance from the fixed end
  const L0 = slantFrame(s).len, L1 = slantFrame(ns).len;
  const openings = ops0.map((o) => (isAngledOpening(o) && o.wall === s.id && !k ? { ...o, at: L1 - (L0 - o.at) } : o));
  const sl = slants.map((x) => (x.id === s.id ? ns : x));
  const before = current(), d = slantState(sl, openings, fr.walls);
  const bad = slantChecks(d, [...changed.values()], before);
  if (bad) return fail(bad);
  return commit(d, 'rotate-wall', { level: seg.policy.level, reason: seg.policy.reason, ids: [seg.id] }, opts);
}

const HINGE_A = (h, u) => (h ? (u > 0 ? 'w' : 'e') : (u > 0 ? 'n' : 's'));          // rect jamb on the slant's 'a' side
const SWING_R = (h, u) => (h ? (u > 0 ? 's' : 'n') : (u > 0 ? 'w' : 'e'));          // rect side of the slant's right normal
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
/** An angled wall dragged onto an axis: it becomes a rect wall through its fixed end and the point (addWall's rules). */
function slantToRect(seg, s, k, P, opts) {
  const list = liveSlants().filter((x) => x !== s), mine = PLAN.openings.filter((o) => isAngledOpening(o) && o.wall === s.id);
  const fixed = endOf(s, 1 - k), d0 = slantState(list, PLAN.openings.filter((o) => !mine.includes(o)));
  const saved = { walls: PLAN.walls, openings: PLAN.openings, rooms: PLAN.rooms, wallOutline: PLAN.wallOutline, analysis };
  PLAN.walls = d0.walls; PLAN.openings = d0.openings; PLAN.rooms = d0.rooms; PLAN.wallOutline = d0.wallOutline; analysis = d0; slantsOverride = list;
  try {
    const line = k ? { x1: fixed[0], y1: fixed[1], x2: P[0], y2: P[1] } : { x1: P[0], y1: P[1], x2: fixed[0], y2: fixed[1] };
    const r = planAddWall({ ...line, thickness: s.t });
    if (!r.ok) return r;
    const h = r.axis === 'h', u = h ? Math.sign(line.x2 - line.x1) : Math.sign(line.y2 - line.y1);
    const L0 = slantFrame(s).len, fa = h ? fixed[0] : fixed[1], sg = k ? u : -u;      // from the fixed end towards the moved one
    const lo = h ? r.rect.x : r.rect.y, hi = lo + (h ? r.rect.w : r.rect.h);
    const conv = mine.map((o) => {
      const dist = k ? o.at : L0 - o.at, c = fa + sg * dist, start = Math.max(lo + MIN_JAMB, Math.min(hi - MIN_JAMB - o.width, snap(c - o.width / 2)));
      const { wall, at, cx, cy, angle, t, x, y, w, h: hh, rooms, exterior, outside, hinge, swing, axis, ...rest } = o;
      const n = { ...rest, axis: r.axis, ...(h ? { x: start, y: r.rect.y, w: o.width, h: r.rect.h } : { x: r.rect.x, y: start, w: r.rect.w, h: o.width }) };
      if (hinge != null) n.hinge = hinge === 'a' ? HINGE_A(h, u) : OPP[HINGE_A(h, u)];
      if (swing != null) n.swing = swing === 'r' ? SWING_R(h, u) : OPP[SWING_R(h, u)];
      n.rooms = [];
      return n;
    });
    const openings = [...r.d.openings, ...conv];
    const d = derive([...r.d.walls, ...rectOpenings(openings)], openings, PLAN.rooms, PLAN.walls, list);
    d.slants = list;
    if (d.problems.length) return fail(problemText(d));
    const ids = idsIn(d, r.rect, r.axis);
    PLAN.walls = saved.walls; PLAN.openings = saved.openings; PLAN.rooms = saved.rooms; PLAN.wallOutline = saved.wallOutline; analysis = saved.analysis; slantsOverride = undefined;
    return commit(d, 'rotate-wall', { level: seg.policy.level, reason: seg.policy.reason, ids }, opts);
  } finally {
    if (slantsOverride !== undefined) {
      PLAN.walls = saved.walls; PLAN.openings = saved.openings; PLAN.rooms = saved.rooms; PLAN.wallOutline = saved.wallOutline; analysis = saved.analysis; slantsOverride = undefined;
      invalidatePlanCaches();
    }
  }
}
/** A rect wall whose end is dragged off its axis with `angled: true`: it becomes an angled wall (its openings too). */
function rectToSlant(seg, k, P, opts) {
  const { c0, c1, a0, a1 } = coreSpan(seg), cm = (c0 + c1) / 2, h = seg.axis === 'h';
  const A = h ? [a0, cm] : [cm, a0], B = h ? [a1, cm] : [cm, a1];
  const list = liveSlants() || [], E = editModel(seg.axis, [], []);
  paint(E.m, seg.core, FREE);
  const walls = wallRects(E.m), rects = [...walls, ...rectOpenings(PLAN.openings).filter((o) => !inCore(seg)(o))];
  let ns = { id: newSlantId(list), x1: k ? A[0] : r01(P[0]), y1: k ? A[1] : r01(P[1]), x2: k ? r01(P[0]) : B[0], y2: k ? r01(P[1]) : B[1], t: seg.thickness, kind: 'interior' };
  ns = setEnd(ns, k, snapSlantEnd(ns, k, list, rects));
  const f = slantFrame(ns);
  if (f.len < MIN_WALL) return fail(`A wall must be at least ${MIN_WALL} cm long.`);
  const fixedA = k ? a0 : a1;
  const conv = PLAN.openings.filter(inCore(seg)).map((o) => {
    const c = along(o) + o.width / 2, dist = Math.abs(c - fixedA);
    const { x, y, w, h: hh, axis, rooms, exterior, outside, hinge, swing, ...rest } = o;
    const n = { ...rest, wall: ns.id, axis: 'a', at: k ? dist : f.len - dist };
    if (hinge != null) n.hinge = hinge === (h ? 'w' : 'n') ? 'a' : 'b';
    if (swing != null) n.swing = swing === (h ? 's' : 'w') ? 'r' : 'l';
    n.rooms = [];
    return n;
  });
  const openings = [...PLAN.openings.filter((o) => !inCore(seg)(o)), ...conv];
  const before = current(), d = slantState([...list, ns], openings, walls);
  const bad = slantChecks(d, [ns], before);
  if (bad) return fail(bad);
  withKinds(d, new Set([ns.id]));
  return commit(d, 'rotate-wall', { level: seg.policy.level, reason: seg.policy.reason, ids: [(ENV.pre || '') + 'seg:a:' + ns.id] }, opts);
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
  const width = snap(num(p.width) ? p.width : K.width);
  let s = null, sd = Infinity, want = null;
  if (p.wall != null) {
    // by wall: a slant ('seg:a:s01' / 's01', prefixed or not on upper levels) with `at`, or a rect segment with `at` = cm
    // from the start of its core
    const id = String(p.wall), segs = current().segments;
    s = segs.find((g) => g.id === id || (g.axis === 'a' && (g.slantId === id || g.id === (ENV.pre || '') + 'seg:a:' + id || g.id === (ENV.pre || '') + id))) || null;
    if (!s) return fail('There is no such wall.');
    if (s.axis === 'a') return planAddAngledOpening(p, K, s, width);
    if (!num(p.at)) return fail('An opening needs a position.');
    want = coreSpan(s).a0 + p.at - width / 2;
  } else {
    if (!num(p.x) || !num(p.y)) return fail('An opening needs a position.');
    let slanted = Infinity, sg = null;
    for (const g of current().segments) {
      if (g.axis === 'a') { const dd = polyDist(p.x, p.y, g.poly); if (dd < slanted) { slanted = dd; sg = g; } continue; }
      if (isJunction(g)) continue; const dist = rectDist(p.x, p.y, g.core); if (dist < sd) { sd = dist; s = g; }
    }
    if (sg && slanted <= REACH && slanted < sd) return planAddAngledOpening(p, K, sg, width);
    if (!s || sd > REACH) return fail('There is no wall here.');
  }
  if (s.cls === 'mamad') return fail(REASONS.mamad);
  const exterior = s.cls === 'exterior';
  if (p.kind === 'window' && !exterior) return fail('Windows belong in exterior walls — use a door or an open passage between rooms.');
  if (p.kind === 'opening' && exterior) return fail('An opening in an exterior wall needs a door or a window.');
  if (!(width >= K.minW && width <= K.maxW)) return fail(`Width must be ${K.minW}–${K.maxW} cm.`);
  const start = slot(s, width, want != null ? want : (s.axis === 'h' ? p.x : p.y) - width / 2, null);
  if (start == null) return fail(`There is not enough free wall here for a ${width} cm opening.`);
  return { ok: true, segmentId: s.id, rect: openingRect(s, start, width), level: exterior && !ENV.draft ? 'permit' : 'free', s, width, start };
}

/** Gap extents [a0, a1] of the openings of slant `id` (except `ignoreId`). */
const takenOn = (id, ignoreId) => PLAN.openings.filter((o) => isAngledOpening(o) && o.wall === id && o.id !== ignoreId).map((o) => [o.at - o.width / 2, o.at + o.width / 2]);
/**
 * Centre `at` for an opening of `width` in slant segment g: `exact` (cm from its start; checked, not moved) or, for a
 * point, the nearest place ≥ 10 cm from the ends of its faces (after mitres / joins) and from other openings.
 * @returns {{ at } | { reason }}
 */
function angledSlot(g, s, width, exact, point, ignoreId) {
  const free = bothFaces(g.faces), taken = takenOn(s.id, ignoreId), ranges = openingRanges(free, taken, width, MIN_JAMB);
  if (exact != null) {
    const at = r01(exact);
    if (ranges.some(([lo, hi]) => at >= lo - 1e-6 && at <= hi + 1e-6)) return { at };
    if (taken.some(([a0, a1]) => at - width / 2 < a1 && at + width / 2 > a0)) return { reason: 'Openings would overlap.' };
    if (!free.some(([p, q]) => at - width / 2 >= p - 1e-6 && at + width / 2 <= q + 1e-6)) return { reason: `Too close to the end of the wall — keep at least ${MIN_JAMB} cm of wall beside it.` };
    return { reason: `Too close to another opening — keep at least ${MIN_JAMB} cm of wall between them.` };
  }
  const want = atOf(s, point[0], point[1]);
  let best = null;
  for (const [lo0, hi0] of ranges) {
    const lo = Math.ceil(lo0 * 10 - 1e-6) / 10, hi = Math.floor(hi0 * 10 + 1e-6) / 10;
    if (hi < lo) continue;
    const at = Math.max(lo, Math.min(hi, r01(want)));
    if (best == null || Math.abs(at - want) < Math.abs(best - want)) best = at;
  }
  return best == null ? { reason: `There is not enough free wall here for a ${width} cm opening.` } : { at: best };
}
/** planAddOpening in an angled wall (segment g). */
function planAddAngledOpening(p, K, g, width) {
  if (g.cls === 'mamad' && !ENV.draft) return fail(REASONS.mamad);
  const exterior = g.cls === 'exterior', s = slantOf(g);
  if (!s) return fail('There is no such wall.');
  if (p.kind === 'window' && !exterior) return fail('Windows belong in exterior walls — use a door or an open passage between rooms.');
  if (p.kind === 'opening' && exterior) return fail('An opening in an exterior wall needs a door or a window.');
  if (!(width >= K.minW && width <= K.maxW)) return fail(`Width must be ${K.minW}–${K.maxW} cm.`);
  const exact = p.wall != null ? (num(p.at) ? p.at : null) : null;
  if (p.wall != null && exact == null) return fail('An opening needs a position (at).');
  const sl = angledSlot(g, s, width, exact, [p.x, p.y], null);
  if (sl.reason) return fail(sl.reason);
  const quad = openingQuad(s, sl.at, width);
  return { ok: true, angled: true, segmentId: g.id, s: g, slant: s, at: sl.at, width, quad, rect: boxOfRing(quad), level: exterior && !ENV.draft ? 'permit' : 'free' };
}

/**
 * Dry run of addOpening: where would a `kind` of `width` centred near (x, y) land?
 * @returns {{ ok, reason?, segmentId?, rect?, level? }}
 */
export function canAddOpening(input) { return onLevel(activeLevel(), () => canAddOpeningImpl(input)); }
function canAddOpeningImpl(input) {
  const r = planAddOpening(input);
  if (r.ok && r.angled) return { ok: true, segmentId: r.segmentId, wall: r.slant.id, at: r.at, width: r.width, quad: r.quad, rect: r.rect, level: r.level };
  return r.ok ? { ok: true, segmentId: r.segmentId, rect: r.rect, level: r.level } : r;
}

/** New opening id, unique across every level ('door-new-n' | 'win-new-n' | 'pass-new-n'). */
const newOpeningId = (kind, taken = upperLevels(PLAN).length ? allOpeningIds() : null) => {
  const pre = kind === 'window' ? 'win' : kind === 'opening' ? 'pass' : 'door';
  const used = taken ? (id) => taken.has(id) : (id) => PLAN.openings.some((o) => o.id === id);
  let n = 1; while (used(`${pre}-new-${n}`)) n++;
  return `${pre}-new-${n}`;
};
const HINGES = { h: ['w', 'e'], v: ['n', 's'] }, SWINGS = { h: ['n', 's'], v: ['w', 'e'] };

/**
 * Cut a door / window / sliding door / door-less passage into the wall nearest to (x, y).
 * Defaults: door 80 × 210, window 100 × 100 sill 110, sliding door 160 × 210, passage 90 × 210.
 */
export function addOpening(...args) { return tracked('addOpening', onActive(addOpeningImpl), args); }
function addOpeningImpl(input, opts) {
  const r = planAddOpening(input);
  if (!r.ok) return r;
  if (r.angled) return addAngledOpening(input, r, opts);
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
  const d = derive(solidsOf(PLAN), openings, PLAN.rooms, PLAN.walls, liveSlants());
  if (d.problems.length) return fail(problemText(d));
  return commit(d, 'add-opening', { level: r.level, ids: [o.id] }, opts);
}

/** addOpening in an angled wall (r = planAddAngledOpening's result). */
function addAngledOpening(p, r, opts) {
  const K = OPENING_KINDS[p.kind], g = r.s, exterior = g.cls === 'exterior';
  const height = num(p.height) ? Math.round(p.height) : K.height, sill = num(p.sill) ? Math.round(p.sill) : K.sill;
  const bad = checkSize(p.kind, r.width, height, sill);
  if (bad) return fail(bad);
  const style = p.style == null ? (exterior && K.extStyle) || K.style : p.style;
  if (!K.styles.includes(style)) return fail(`Style must be one of: ${K.styles.join(', ')}.`);
  const o = { id: newOpeningId(p.kind), kind: p.kind, style, wall: r.slant.id, axis: 'a', at: r.at, width: r.width, height, sill };
  if (p.kind === 'door') {
    const iv = bothFaces(g.faces).find(([a, b]) => a <= r.at && b >= r.at) || [0, g.length];
    const size = (id) => { const room = PLAN.rooms.find((x) => x.id === id); return room ? polygonArea(room.polygon) : Infinity; };
    o.hinge = p.hinge === 'a' || p.hinge === 'b' ? p.hinge : r.at - r.width / 2 - iv[0] <= iv[1] - (r.at + r.width / 2) ? 'a' : 'b';
    o.swing = p.swing === 'l' || p.swing === 'r' ? p.swing : size(g.between[0]) <= size(g.between[1]) ? 'l' : 'r';
  }
  o.rooms = [];
  o.label = labelOf(o);
  const openings = [...PLAN.openings, o];
  const d = derive(solidsOf(PLAN), openings, PLAN.rooms, PLAN.walls, liveSlants());
  if (d.problems.length) return fail(problemText(d));
  return commit(d, 'add-opening', { level: r.level, ids: [o.id] }, opts);
}
/** updateOpening of an opening in an angled wall: at / offset exact, x, y clamped; hinge 'a' | 'b', swing 'l' | 'r'. */
function updateAngledOpening(o, p, policy, opts) {
  const K = OPENING_KINDS[o.kind], g = current().segments.find((x) => x.axis === 'a' && x.slantId === o.wall), s = g && slantOf(g);
  if (!g || !s || !K) return fail('This opening cannot be edited.');
  const next = { ...o };
  if (num(p.width)) next.width = snap(p.width);
  if (num(p.height)) next.height = Math.round(p.height);
  if (num(p.sill)) next.sill = Math.round(p.sill);
  if (p.style != null) { if (!K.styles.includes(p.style)) return fail(`Style must be one of: ${K.styles.join(', ')}.`); next.style = p.style; }
  for (const [key, pair] of [['hinge', ['a', 'b']], ['swing', ['l', 'r']]]) {
    if (p[key] == null) continue;
    if (o.kind !== 'door' || !pair.includes(p[key])) return fail(`A ${key} of '${p[key]}' does not fit this ${o.kind === 'door' ? 'wall' : 'opening'}.`);
    next[key] = p[key];
  }
  const bad = checkSize(o.kind, next.width, next.height, next.sill);
  if (bad) return fail(bad);
  const exact = num(p.at) ? p.at : num(p.offset) ? p.offset : (num(p.x) && num(p.y)) ? null : next.width !== o.width ? o.at : null;
  if (exact != null || (num(p.x) && num(p.y))) {
    const sl = angledSlot(g, s, next.width, exact, [p.x, p.y], o.id);
    if (sl.reason) return fail(sl.reason);
    next.at = exact != null && r01(exact) === r01(o.at) ? o.at : sl.at;
  }
  const geometry = !sameOpening(next, o, ANGLED_GEOMETRY_KEYS);
  if (!geometry && sameOpening(next, o, LOOK_KEYS)) return { ok: true, level: 'free', warnings: [], ids: [o.id] };
  if (next.width !== o.width || next.height !== o.height || next.sill !== o.sill) {
    if (o.label != null || o.kind === 'window') next.label = labelOf(next);
    if (o.assumed) { const left = o.assumed.filter((k) => next[k] === o[k]); if (left.length) next.assumed = left; else delete next.assumed; }
  }
  const openings = PLAN.openings.map((x) => (x === o ? next : x));
  const d = derive(solidsOf(PLAN), openings, PLAN.rooms, PLAN.walls, liveSlants());
  if (d.problems.length) return fail(problemText(d));
  return commit(d, 'update-opening', { level: geometry && policy.level === 'permit' ? 'permit' : 'free', ids: [o.id] }, opts);
}

/**
 * Change a door / window. patch: { offset (cm from the start of its wall segment) | x, y (new centre — it slides
 * along its own wall, kept ≥ 10 cm from wall ends and other openings), width, height, sill, style, hinge, swing }.
 */
export function updateOpening(...args) { return tracked('updateOpening', onHolder('openings', updateOpeningImpl), args); }
function updateOpeningImpl(id, patch, opts) {
  const o = PLAN.openings.find((x) => x.id === id), p = patch || {};
  if (!o) return fail('No such opening.');
  const policy = policyOfOpening(o);
  if (policy.level === 'locked') return fail(policy.reason);
  if (isAngledOpening(o)) return updateAngledOpening(o, p, policy, opts);
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
  const d = derive(solidsOf(PLAN), openings, PLAN.rooms, PLAN.walls, liveSlants());
  if (d.problems.length) return fail(problemText(d));
  return commit(d, 'update-opening', { level: geometry && policy.level === 'permit' ? 'permit' : 'free', ids: [id] }, opts);
}

/** Remove a door / window; the gap is filled with wall. */
export function removeOpening(...args) { return tracked('removeOpening', onHolder('openings', removeOpeningImpl), args); }
function removeOpeningImpl(id, opts) {
  const o = PLAN.openings.find((x) => x.id === id);
  if (!o) return fail('No such opening.');
  const policy = policyOfOpening(o);
  if (policy.level === 'locked') return fail(policy.reason);
  const openings = PLAN.openings.filter((x) => x !== o);
  const d = derive(solidsOf(PLAN), openings, PLAN.rooms, PLAN.walls, liveSlants());
  if (d.problems.length) return fail(problemText(d));
  return commit(d, 'remove-opening', { level: policy.level, ids: [id] }, opts);
}

/** Re-hang a door: 'hinge' swaps the hinge jamb, 'swing' the side it opens into. */
export function flipDoor(...args) { return tracked('flipDoor', onHolder('openings', flipDoorImpl), args); }
function flipDoorImpl(id, how, opts) {
  const o = PLAN.openings.find((x) => x.id === id);
  if (!o) return fail('No such opening.');
  if (o.kind !== 'door' || (how !== 'hinge' && how !== 'swing')) return fail('Only hinged doors can be flipped (hinge or swing).');
  const pair = isAngledOpening(o) ? (how === 'hinge' ? ['a', 'b'] : ['l', 'r']) : (how === 'hinge' ? HINGES : SWINGS)[o.axis];
  return updateOpening(id, { [how]: o[how] === pair[0] ? pair[1] : pair[0] }, opts);
}

/** Rename / re-type a room: patch { name, nameHe, type, wet }. Names follow the room through later edits. */
export function updateRoom(...args) { return tracked('updateRoom', onHolder('rooms', updateRoomImpl), args); }
function updateRoomImpl(id, patch, opts) {
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
export function resetPlan(...args) { return tracked('resetPlan', resetPlanImpl, args); }
function resetPlanImpl(opts = {}) {
  if (!modified) return { ok: true, level: 'free', warnings: [], ids: [] };
  host.record(opts);
  const res = applyPlanState(null);
  host.changed({ reason: 'reset', changed: res.changed, transient: !!opts.transient });
  return { ok: true, level: 'free', warnings: [], ids: [] };
}

// ---------------------------------------------------------------- levels: add / remove / update (stage F1)
const LEVEL_LIMITS = { ceiling: [200, 600], slab: [0, 100], parapet: [0, 200] };
/** Heights patch → { heights } or { reason }. */
function readLevelHeights(patch, from) {
  const h = { ...from };
  for (const [k, [lo, hi]] of Object.entries(LEVEL_LIMITS)) {
    if (patch[k] == null) continue;
    const v = Math.round(patch[k]);
    if (!num(patch[k]) || v < lo || v > hi) return { reason: `The ${k === 'slab' ? 'floor slab' : k} must be ${lo}–${hi} cm.` };
    h[k] = v;
  }
  return { heights: h };
}
/** Same level objects where only the elevation changed get their cached arrays / analysis carried over. */
function carryLevelData(before, after) {
  for (const l of after) { const o = before.find((x) => x.id === l.id); if (o && o !== l && o.walls === l.walls && levelData.has(o) && !levelData.has(l)) levelData.set(l, levelData.get(o)); }
}
/** Record, install the new level list, announce. */
function commitLevels(levels, reason, id, opts = {}) {
  host.record(opts);
  const before = upperLevels(PLAN);
  carryLevelData(before, levels);
  const changed = installOptional({ ...optionalPart(PLAN), levels });
  host.changed({ reason, changed, transient: !!opts.transient, levelId: id });
  return changed;
}

/**
 * Add a level on top. `copyExterior` (default true): the envelope of the level below (its exterior walls, the outer
 * walls of a safe room included) and the windows in it are copied up; doors are not. Heights default to the level
 * below's; elevation = below's elevation + its ceiling + the new slab. Rooms are derived. Ids: 'L<n>'.
 * @param {{ copyExterior?: boolean, name?: string, nameHe?: string, heights?: { ceiling, slab, parapet } }} [input]
 * @returns {{ ok: true, level, warnings, ids: [levelId] } | { ok: false, reason }}
 */
export function addLevel(...args) { return tracked('addLevel', addLevelImpl, args); }
function addLevelImpl(input, opts) {
  const p = input || {}, levels = upperLevels(PLAN), id = nextLevelId(PLAN);
  const belowId = levels.length ? levels[levels.length - 1].id : GROUND, bh = levelPlan(PLAN, belowId).heights;
  const hr = readLevelHeights(p.heights || {}, { ceiling: bh.ceiling, slab: num(bh.slab) ? bh.slab : 20, parapet: num(bh.parapet) ? bh.parapet : 40 });
  if (hr.reason) return fail(hr.reason);
  let walls = [], openings = [], slants = [];
  if (p.copyExterior !== false) {
    const taken = allOpeningIds();
    onLevel(belowId, () => {
      const envelope = current().segments.filter((g) => g.cls === 'exterior' || g.between.some((b) => b != null && isOutdoorId(b)));
      walls = envelope.filter((g) => g.axis !== 'a').map((g) => ({ x: g.x, y: g.y, w: g.w, h: g.h, kind: 'exterior' }));
      // angled envelope walls go up as the same slants (centre line, thickness), with their windows
      slants = envelope.filter((g) => g.axis === 'a').map((g) => ({ id: g.slantId, x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, t: g.t, kind: 'exterior' }));
      openings = PLAN.openings.filter((o) => o.kind === 'window' && o.exterior && envelope.some((g) => g.openingIds.includes(o.id))).map((o) => {
        const { rooms, exterior, outside, ...rest } = o;
        if (isAngledOpening(o)) for (const k of ['cx', 'cy', 'angle', 't', 'x', 'y', 'w', 'h']) delete rest[k];
        const nid = newOpeningId('window', taken); taken.add(nid);
        return { ...rest, id: nid, rooms: [] };
      });
    });
  }
  for (const o of openings) if (o.sill + o.height > hr.heights.ceiling - HEAD_ROOM) return fail(`The windows copied up do not fit under a ${hr.heights.ceiling} cm ceiling.`);
  const env = levelEnv(id);
  let d = deriveIn(env, [...walls, ...openings], openings, [], [], slants);
  if (d.problems.length) { const bad = new Set(d.problems.map((x) => x.id)); openings = openings.filter((o) => !bad.has(o.id)); d = deriveIn(env, [...walls, ...openings], openings, [], [], slants); }
  const lv = { id };
  if (typeof p.name === 'string' && p.name.trim()) lv.name = p.name.trim();
  if (typeof p.nameHe === 'string' && p.nameHe.trim()) lv.nameHe = p.nameHe.trim();
  Object.assign(lv, { elevation: 0, heights: hr.heights, walls: d.walls, wallOutline: d.wallOutline, openings: d.openings, rooms: d.rooms });
  if (slants.length) lv.slants = slants;
  const next = recomputeElevations([...levels, lv], PLAN.heights);
  levelData.set(next[next.length - 1], { arrays: next[next.length - 1], d });
  commitLevels(next, 'add-level', id, opts);
  const fixed = phase !== 'draft';
  return { ok: true, level: fixed ? 'permit' : 'free', warnings: fixed ? [REASONS.level] : [], ids: [id] };
}

/**
 * Remove a level: the top one, or any level with no walls and no openings (the levels above then come down).
 * What still stands on it — items, carpentry runs, finishes of its rooms (store, via the host), stairs leading to it —
 * is reported in `content`; while there is any, the call is refused unless `opts.force` (the caller then deals with it:
 * e.g. removes those items in the same store.begin() … commit()). Finishes of its rooms are dropped by the store
 * ('finishes' event; undo brings them back).
 * @returns {{ ok: true, level, warnings, ids: [levelId], content } | { ok: false, reason, content? }}
 */
export function removeLevel(...args) { return tracked('removeLevel', removeLevelImpl, args); }
function removeLevelImpl(id, opts = {}) {
  if (id === GROUND || id == null) return fail('The ground floor cannot be removed.');
  const levels = upperLevels(PLAN), i = levels.findIndex((l) => l.id === id);
  if (i < 0) return fail(`There is no level ${id}.`);
  const lv = levels[i], empty = !lv.walls.length && !lv.openings.length;
  if (i !== levels.length - 1 && !empty) return fail('Only the top floor can be removed (or a floor with nothing drawn on it).');
  const held = host.content(id, levelPlan(PLAN, id).rooms.map((r) => r.id)) || {};
  const stairs = [...(PLAN.stairs || []), ...levels.flatMap((l) => l.stairs || [])].filter((st) => st.to === id).map((st) => st.id);
  const content = { items: held.items || [], runs: held.runs || [], finishes: held.finishes || [], stairs };
  const n = content.items.length + content.runs.length + content.finishes.length + content.stairs.length;
  if (n && !opts.force) {
    const parts = [[content.items.length, 'item'], [content.runs.length, 'carpentry run'], [content.finishes.length, 'room finish'], [content.stairs.length, 'stair']]
      .filter(([k]) => k).map(([k, w]) => `${k} ${w}${k === 1 ? '' : 's'}`);
    return { ok: false, reason: `${levelName(PLAN, id)} still holds ${parts.join(', ')} — move or delete them first.`, content };
  }
  if (activeId === id) activeId = i > 0 ? levels[i - 1].id : GROUND;
  commitLevels(recomputeElevations(levels.filter((l) => l !== lv), PLAN.heights), 'remove-level', id, opts);
  const fixed = phase !== 'draft';
  return { ok: true, level: fixed ? 'permit' : 'free', warnings: fixed ? [REASONS.level] : [], ids: [id], content };
}

/**
 * Rename a level or change its heights: patch { name, nameHe, heights: { ceiling, slab, parapet } } (cm). A new
 * ceiling or slab moves the levels above (elevations are recomputed). The ground level's heights are the house's.
 */
export function updateLevel(...args) { return tracked('updateLevel', updateLevelImpl, args); }
function updateLevelImpl(id, patch, opts) {
  if (id === GROUND || id == null) return fail('The ground floor\'s heights are the house\'s own — change them in the project settings.');
  const p = patch || {}, levels = upperLevels(PLAN), lv = levels.find((l) => l.id === id);
  if (!lv) return fail(`There is no level ${id}.`);
  const next = { ...lv };
  for (const k of ['name', 'nameHe']) if (typeof p[k] === 'string') { if (p[k].trim()) next[k] = p[k].trim(); else delete next[k]; }
  if (p.heights) {
    const hr = readLevelHeights(p.heights, lv.heights);
    if (hr.reason) return fail(hr.reason);
    const tall = levelState(lv).arrays.openings.find((o) => o.sill + o.height > hr.heights.ceiling - HEAD_ROOM);
    if (tall) return fail(`The ${openingName(tall)} ${tall.id} would not fit under a ${hr.heights.ceiling} cm ceiling — lower it first.`);
    next.heights = hr.heights;
  }
  if (JSON.stringify(next) === JSON.stringify(lv)) return { ok: true, level: 'free', warnings: [], ids: [id] };
  const heights = JSON.stringify(next.heights) !== JSON.stringify(lv.heights);
  if (levelData.has(lv)) levelData.set(next, levelData.get(lv));
  commitLevels(recomputeElevations(levels.map((l) => (l === lv ? next : l)), PLAN.heights), 'update-level', id, opts);
  const permit = heights && phase !== 'draft' && !!levelOf(BASE_PLAN, id);
  return { ok: true, level: permit ? 'permit' : 'free', warnings: permit ? [REASONS.level] : [], ids: [id] };
}

// ---------------------------------------------------------------- stairs and voids (stage F4b)
/*
 * A stair is stored on its bottom level (PLAN.stairs for L0, levels[i].stairs above) with its data fields only
 * (core/stairs.js); everything else is derived from stairGeometry. The opening it needs in the floor above (a void of
 * the upper level, `{ id, polygon, stair, railing }`) is created / grown by these calls: never smaller than the part of
 * the stair where the upper slab would leave less than 2.10 m headroom (requiredVoid), its free edges rounded OUT to the
 * 5 cm grid (edges flush with the stair's own sides / arrival stay exact). A void the user enlarged stays enlarged.
 * Every call is one undo step + one 'plan' event (changed.stairs, changed.levels), a tracked collaboration intent, and
 * 'permit' in a fixed plan (free while drafting). Rooms keep their outline; `room.voids` says which voids cut their floor.
 */
const STAIR_TOL = 1;               // cm² — overlaps smaller than this are touching, not crossing
const COVER_TOL = 2;               // cm² — an opening covers what a stair needs up to this (kernel rounding)
const AUTO_TOL = 60;               // cm² — an opening this close to what its stair needs was made for it (not enlarged)
const VOID_GRID = 5;               // cm — free void edges are rounded out to this grid
const ARRIVAL_CLEAR = 30;          // cm of floor that must be free beyond the top step
/** The stair fields a caller may set (everything else is derived). */
const STAIR_INPUT = ['shape', 'x', 'y', 'rot', 'width', 'risers', 'going', 'landing', 'turn', 'gap', 'nosing', 'guard', 'handrail'];
const STAIR_DATA = ['id', 'to', ...STAIR_INPUT];
const normRot = (r) => (((Math.round((num(r) ? r : 0) / 90) * 90) % 360) + 360) % 360;
const stairsOn = (plan, id) => { const lv = levelOf(plan, id); return lv && Array.isArray(lv.stairs) ? lv.stairs : []; };
const stairsOf = (plan) => levelIds(plan).flatMap((id) => stairsOn(plan, id).filter((s) => s && typeof s.id === 'string').map((stair) => ({ stair, levelId: id })));
const stairHolder = (id) => stairsOf(PLAN).find((x) => x.stair.id === id) || null;
function voidHolder(id) {
  for (const lid of levelIds(PLAN)) { const v = voidsOf(levelOf(PLAN, lid)).find((x) => x.id === id); if (v) return { void: v, levelId: lid }; }
  return null;
}
const levelAboveId = (id) => { const ids = levelIds(PLAN), i = ids.indexOf(id); return i >= 0 && i < ids.length - 1 ? ids[i + 1] : null; };
/** The level a stair arrives at (`to`, else the level above its own), or null. */
function stairTarget(stair, levelId) {
  const ids = levelIds(PLAN);
  if (stair.to == null) return levelAboveId(levelId);
  return ids.includes(stair.to) && ids.indexOf(stair.to) > ids.indexOf(levelId) ? stair.to : null;
}
const floorName = (id) => levelName(PLAN, id) || id;
const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
/** Next free id 'p<n>' over the live and the base plan (an id of a removed base stair is not re-used). */
function nextId(prefix, ids) {
  let n = 0;
  for (const id of ids) { const m = new RegExp(`^${prefix}(\\d+)$`).exec(id); if (m) n = Math.max(n, +m[1]); }
  return prefix + (n + 1);
}
const newStairId = () => nextId('st', [...stairsOf(PLAN), ...stairsOf(BASE_PLAN)].map((x) => x.stair.id));
const allVoids = (plan) => levelIds(plan).flatMap((id) => voidsOf(levelOf(plan, id)).map((v) => ({ void: v, levelId: id })));
const newVoidId = () => nextId('v', [...allVoids(PLAN), ...allVoids(BASE_PLAN)].map((x) => x.void.id));

/** The stored shape of a stair: its data fields with the defaults of its shape (derived fields are never stored). */
function cleanStair(s) {
  const shape = STAIR_SHAPES.includes(s.shape) ? s.shape : 'straight';
  const out = { id: s.id };
  if (s.to != null) out.to = s.to;
  Object.assign(out, { shape, x: r001(num(s.x) ? s.x : 0), y: r001(num(s.y) ? s.y : 0), rot: normRot(s.rot), width: s.width, risers: s.risers, going: s.going });
  const L = s.landing && typeof s.landing === 'object' ? s.landing : null;
  if (shape !== 'straight') {
    out.landing = { at: L && num(L.at) ? L.at : Math.ceil(s.risers / 2), size: L && num(L.size) ? L.size : s.width };
    out.turn = s.turn === 'left' ? 'left' : 'right';
    if (shape === 'U' && num(s.gap) && s.gap > 0) out.gap = s.gap;
  } else if (L) out.landing = { at: L.at, size: L.size };
  if (num(s.nosing)) out.nosing = s.nosing;
  for (const k of ['guard', 'handrail']) if (typeof s[k] === 'boolean') out[k] = s[k];
  return out;
}
/** Data fields only, for comparisons (a loaded stair may carry derived fields such as `up` or `footprint`). */
const stairData = (s) => { const o = {}; for (const k of STAIR_DATA) if (s[k] !== undefined) o[k] = s[k]; return o; };

const segShape = (g) => (g.axis === 'a' && Array.isArray(g.poly) ? { poly: g.poly } : { x: g.x, y: g.y, w: g.w, h: g.h });
/** The floor of a level view: its rooms, less its voids (except those of `skipStair`). */
function floorOf(view, skipStair = null) {
  const rooms = (view.rooms || []).filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3).map((r) => r.polygon);
  if (!rooms.length) return [];
  const all = polyUnion(rooms), cut = voidsOf(view).filter((v) => !skipStair || v.stair !== skipStair).map((v) => v.polygon);
  return cut.length ? polyDifference(all, cut) : all;
}
const roomsOf = (view) => { const rooms = (view.rooms || []).filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3).map((r) => r.polygon); return rooms.length ? polyUnion(rooms) : []; };
const piecesOf = (geo) => [...geo.flights.filter((f) => f.length > 1e-6).map((f) => f.poly), ...geo.landings.map((l) => l.poly)];
const sameRegion = (a, b) => netArea(a.length ? polyDifference(a, b.length ? b : []) : []) + netArea(b.length ? polyDifference(b, a.length ? a : []) : []) <= AUTO_TOL;
const ringsOfEx = (ex) => ex.map((e) => e.outer);

/**
 * Round the free edges of an orthogonal ring OUT to the 5 cm grid (edges whose coordinate is in `keepX` / `keepY` — the
 * stair's own sides and arrival — stay exact). A ring with a slanted edge is returned as it is.
 */
function snapRingOut(ring, keepX, keepY) {
  const n = ring.length;
  let a2 = 0;
  for (let i = 0; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; a2 += p[0] * q[1] - q[0] * p[1]; }
  const sg = Math.sign(a2) || 1, has = (set, v) => [...set].some((k) => Math.abs(k - v) < 1e-3);
  const ex = new Array(n), ey = new Array(n);                                   // snapped coordinate of edge i (or null)
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1];
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) > 1e-6) {                           // vertical edge at x
      const out = sg * dy > 0 ? 1 : -1, x = p[0];
      ex[i] = has(keepX, x) ? x : out > 0 ? Math.ceil(x / VOID_GRID - 1e-6) * VOID_GRID : Math.floor(x / VOID_GRID + 1e-6) * VOID_GRID;
    } else if (Math.abs(dy) < 1e-6 && Math.abs(dx) > 1e-6) {                    // horizontal edge at y
      const out = -sg * dx > 0 ? 1 : -1, y = p[1];
      ey[i] = has(keepY, y) ? y : out > 0 ? Math.ceil(y / VOID_GRID - 1e-6) * VOID_GRID : Math.floor(y / VOID_GRID + 1e-6) * VOID_GRID;
    } else return ring;
  }
  return ring.map((p, i) => {
    const prev = (i - 1 + n) % n;
    const x = ex[i] != null ? ex[i] : ex[prev] != null ? ex[prev] : p[0];
    const y = ey[i] != null ? ey[i] : ey[prev] != null ? ey[prev] : p[1];
    return [x, y];
  });
}
/** A void outline in its stored form: 0.001 cm (the kernel's unit), clockwise on screen, from its north-west-most corner. */
const r001 = (v) => Math.round(v * 1000) / 1000 + 0;
function voidRing(ring) {
  let r = ring.map((p) => [r001(p[0]), r001(p[1])]);
  r = r.filter((p, i) => { const q = r[(i + 1) % r.length]; return p[0] !== q[0] || p[1] !== q[1]; });
  let a2 = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a2 += p[0] * q[1] - q[0] * p[1]; }
  if (a2 < 0) r.reverse();
  let k = 0;
  r.forEach((p, i) => { if (p[1] < r[k][1] || (p[1] === r[k][1] && p[0] < r[k][0])) k = i; });
  return [...r.slice(k), ...r.slice(0, k)];
}
/** One outline for a region (expolygons): itself when it is one piece, else the box round it clipped to `clip`. */
function oneRing(ex, clip) {
  const pieces = ex.filter((e) => e.outer.length >= 3 && Math.abs(netArea([e])) > STAIR_TOL);
  if (!pieces.length) return null;
  if (pieces.length === 1) return voidRing(pieces[0].outer);
  const xs = pieces.flatMap((e) => e.outer.map((p) => p[0])), ys = pieces.flatMap((e) => e.outer.map((p) => p[1]));
  const box = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)], [Math.min(...xs), Math.max(...ys)]];
  const inside = clip && clip.length ? polyIntersection([box], clip) : [{ outer: box, holes: [] }];
  const best = inside.slice().sort((a, b) => Math.abs(netArea([b])) - Math.abs(netArea([a])))[0];
  return best ? voidRing(best.outer) : null;
}

/** Rise, geometry, the level above and the opening a stair needs there (no refusals): null when it cannot be built. */
function stairSetup(stair, levelId) {
  const to = stairTarget(stair, levelId);
  if (!to) return null;
  const rise = levelElevation(PLAN, to) - levelElevation(PLAN, levelId);
  const geo = rise > 0 && !stairProblems(stair, null, { rise }).length ? stairGeometry(stair, { rise }) : null;
  if (!geo || geo.footprint.length < 3) return null;
  const up = levelPlan(PLAN, to), underside = rise - ((levelHeights(PLAN, to) || {}).slab || 0);
  const req = requiredVoid(stair, geo, { slabUnderside: underside });
  const upFp = req.length ? footprintOf(up).polygons : [];
  const reqIn = upFp.length ? polyIntersection(req, upFp) : [];
  let need = [];
  if (netArea(reqIn) > STAIR_TOL) {
    const keepX = new Set(), keepY = new Set();
    for (const poly of piecesOf(geo)) for (const p of poly) { keepX.add(Math.round(p[0] * 1e3) / 1e3); keepY.add(Math.round(p[1] * 1e3) / 1e3); }
    const snapped = polyUnion(ringsOfEx(reqIn).map((r) => snapRingOut(r, keepX, keepY)));
    const rooms = roomsOf(up);
    need = rooms.length ? polyIntersection(snapped, rooms) : [];
  }
  return { to, rise, geo, up, underside, req, reqIn, need };
}

/**
 * Can this stair stand on level `levelId`? `{ ok: true, setup }` or `{ ok: false, reason, code }`. Codes: 'no-level-above',
 * 'problems' (stairProblems), 'opening', 'wall', 'outside', 'stair' (overlaps another stair), 'arrival', 'locked' (its
 * opening would cut a locked wall of the floor above), 'upper-wall' (… another wall up there).
 */
function stairFits(stair, levelId, ignoreId = null) {
  const to = stairTarget(stair, levelId);
  if (!to) return { ok: false, code: 'no-level-above', reason: stair.to != null && levelAboveId(levelId) ? `There is no floor ${stair.to} above ${lowerFirst(floorName(levelId))}.` : `A stair needs a floor above it — the ${lowerFirst(floorName(levelId))} is the top floor. Add a floor above first.` };
  const rise = levelElevation(PLAN, to) - levelElevation(PLAN, levelId);
  const problems = stairProblems(stair, null, { rise });
  if (problems.length) return { ok: false, code: 'problems', reason: problems[0].en, problems };
  const setup = stairSetup(stair, levelId);
  if (!setup) return { ok: false, code: 'problems', reason: 'The stair cannot be built from these numbers.' };
  const { geo, up } = setup, view = levelPlan(PLAN, levelId), pieces = piecesOf(geo);
  const opens = view.openings.filter((o) => o.axis !== 'a' && num(o.x));
  if (opens.length && intersectArea(pieces, opens) > STAIR_TOL) return { ok: false, code: 'opening', reason: 'The stair would stand in a doorway or a window — move it clear of the openings.' };
  const solids = wallSegments(view).map(segShape);
  if (solids.length && intersectArea(pieces, solids) > STAIR_TOL) return { ok: false, code: 'wall', reason: 'The stair would run into a wall — move it clear of the walls.' };
  const floor = floorOf(view);
  if (!floor.length || netArea(polyDifference(pieces, floor)) > STAIR_TOL) return { ok: false, code: 'outside', reason: `The stair must stand inside the house, on the floor of the ${lowerFirst(floorName(levelId))}${voidsOf(view).length ? ' (not over an opening)' : ''}.` };
  for (const other of stairsOn(PLAN, levelId)) {
    if (other.id === ignoreId) continue;
    const og = stairSetup(other, levelId);
    if (og && intersectArea(pieces, piecesOf(og.geo)) > STAIR_TOL) return { ok: false, code: 'stair', reason: `The stair would overlap stair ${other.id}.` };
  }
  // the top step must arrive on floor of the level above (not against a wall, not over an opening, not outside)
  const a = geo.arrival, d = a.dir, probe = [a.a, a.b, [a.b[0] + d[0] * ARRIVAL_CLEAR, a.b[1] + d[1] * ARRIVAL_CLEAR], [a.a[0] + d[0] * ARRIVAL_CLEAR, a.a[1] + d[1] * ARRIVAL_CLEAR]];
  const upSegs = wallSegments(up), upFloor = floorOf(up, stair.id);
  if ((upSegs.length && intersectArea([probe], upSegs.map(segShape)) > STAIR_TOL) || !upFloor.length || netArea(polyDifference([probe], upFloor)) > STAIR_TOL) {
    return { ok: false, code: 'arrival', reason: `The top of the stair would arrive against a wall, over an opening or outside the ${lowerFirst(floorName(to))} — leave at least ${ARRIVAL_CLEAR} cm of floor beyond its last step.` };
  }
  // the opening it needs up there must not cut a wall (a locked one names its reason)
  if (netArea(setup.reqIn) > STAIR_TOL) {
    const hit = upSegs.filter((g) => intersectArea(setup.reqIn, [segShape(g)]) > STAIR_TOL);
    if (hit.length) {
      const locked = hit.find((g) => g.policy.level === 'locked');
      const what = `The opening the stair needs in the floor of the ${lowerFirst(floorName(to))} (for ${(DEFAULT_HEADROOM_CM / 100).toFixed(2)} m headroom)`;
      return locked ? { ok: false, code: 'locked', reason: `${what} would cut a locked wall there. ${locked.policy.reason}` }
        : { ok: false, code: 'upper-wall', reason: `${what} would cut a wall there — move the stair, or move that wall first.` };
    }
  }
  return { ok: true, setup };
}
const DEFAULT_HEADROOM_CM = 210;

/**
 * The voids of the upper level after `stair` was added / changed (`old` = { stair, levelId } before, or null): its own
 * void follows it — replaced by the new requirement while it is exactly what the old stair needed, else (enlarged by the
 * user) moved with the stair and grown where it no longer covers. A plain void it overlaps is adopted.
 * @returns {{ list, voidId, note }}
 */
function voidsAfter(stair, setup, old) {
  const to = setup.to, lv = levelOf(PLAN, to), list = Array.isArray(lv.voids) ? lv.voids.slice() : [];
  const need = setup.need, rooms = roomsOf(setup.up);
  const at = list.findIndex((v) => v && v.stair === stair.id);
  if (at < 0) {
    if (!need.length) return { list, voidId: null };
    const plain = list.findIndex((v) => v && Array.isArray(v.polygon) && (!v.stair || !stairHolder(v.stair)) && intersectArea([v.polygon], need) > STAIR_TOL);
    if (plain >= 0) {
      const v = list[plain], ring = oneRing(polyUnion([v.polygon, ...ringsOfEx(need)]), rooms);
      list[plain] = { ...v, polygon: ring, stair: stair.id };
      return { list, voidId: v.id };
    }
    const id = newVoidId();
    list.push({ id, polygon: oneRing(need, rooms), stair: stair.id, railing: true });
    return { list, voidId: id };
  }
  const v = list[at], before = old ? stairSetup(old.stair, old.levelId) : null;
  const auto = !before || sameRegion([v.polygon], before.need);
  if (auto) {
    if (!need.length) { list.splice(at, 1); return { list, voidId: null }; }
    list[at] = { ...v, polygon: oneRing(need, rooms) };
    return { list, voidId: v.id };
  }
  // enlarged by the user: it moves with the stair (a plain move), stays inside the rooms and grows where it must
  let region = [v.polygon];
  if (old && old.stair.rot === stair.rot && old.stair.shape === stair.shape && (old.stair.x !== stair.x || old.stair.y !== stair.y)) {
    const dx = stair.x - old.stair.x, dy = stair.y - old.stair.y;
    region = [v.polygon.map((p) => [p[0] + dx, p[1] + dy])];
    if (rooms.length) region = ringsOfEx(polyIntersection(region, rooms));
  }
  if (need.length && netArea(polyDifference(ringsOfEx(need), region.length ? region : [])) > COVER_TOL) region = ringsOfEx(polyUnion([...region, ...ringsOfEx(need)]));
  const ring = oneRing(polyUnion(region), rooms);
  if (ring) list[at] = { ...v, polygon: ring }; else list.splice(at, 1);
  return { list, voidId: ring ? v.id : null };
}

/** Cached level data survives a stairs / voids change of a level whose walls did not change. */
function carryStairLevels(before) {
  for (const l of upperLevels(PLAN)) {
    const o = before.find((x) => x.id === l.id);
    if (!o || o === l || o.walls !== l.walls || !levelData.has(o) || levelData.has(l)) continue;
    const st = levelData.get(o);
    levelData.set(l, { arrays: Array.isArray(l.rooms) && Array.isArray(l.wallOutline) ? l : st.arrays, d: st.d });
  }
}
/**
 * Record, install new stairs / voids lists (`changes` = [{ levelId, stairs?, voids? }]), announce. Rooms of a level whose
 * voids changed get their `voids` note (installOptional).
 */
function commitStairs(changes, reason, res, opts = {}) {
  host.record(opts);
  const before = upperLevels(PLAN), opt = { ...optionalPart(PLAN) };
  let levels = before;
  for (const c of changes) {
    if (c.levelId === GROUND) { if (c.stairs) opt.stairs = c.stairs; continue; }
    levels = levels.map((l) => {
      if (l.id !== c.levelId) return l;
      const n = { ...l };
      for (const k of ['stairs', 'voids']) if (c[k]) { if (c[k].length) n[k] = c[k]; else delete n[k]; }
      return n;
    });
  }
  if (levels !== before) opt.levels = levels;
  const changed = installOptional(opt);
  carryStairLevels(before);
  host.changed({ reason, changed, transient: !!opts.transient, levelId: res.levelId });
  return { ok: true, level: res.level, warnings: res.warnings || [], ids: res.ids || [], ...(res.extra || {}) };
}
const stairPolicy = () => (phase === 'draft' ? { level: 'free', warnings: [] } : { level: 'permit', warnings: [REASONS.stair] });

/**
 * The defaults for a new stair on `level` (default: the active level): proposeStair for the rise to the level above,
 * then the caller's fields. Never stored; see addStair. @returns {object|null} null when there is no level above
 */
function stairDraft(p) {
  const levelId = p.level != null ? p.level : activeLevel();
  if (!levelOf(PLAN, levelId)) return { levelId, error: fail(`There is no level ${levelId}.`) };
  const to = p.to != null ? p.to : levelAboveId(levelId);
  const draft = { id: p.id || 'new', to, shape: STAIR_SHAPES.includes(p.shape) ? p.shape : 'straight' };
  const target = to ? stairTarget(draft, levelId) : null;
  if (!target) return { levelId, error: { ok: false, code: 'no-level-above', reason: stairFits(draft, levelId).reason } };
  const rise = levelElevation(PLAN, target) - levelElevation(PLAN, levelId);
  const base = proposeStair({ rise, shape: draft.shape, width: num(p.width) ? p.width : undefined, turn: p.turn }) || {};
  const input = {};
  for (const k of STAIR_INPUT) if (p[k] !== undefined && p[k] !== null) input[k] = p[k];
  const stair = { ...base, ...input, id: draft.id, to: target, shape: draft.shape };
  if (p.landing === null) delete stair.landing;
  return { levelId, stair: cleanStair(stair), rise };
}

/**
 * Dry run of addStair (live feedback while placing): `{ ok: true, stair, geo, need, level, levelId, to }` or
 * `{ ok: false, reason, code, stair?, geo? }` (stair / geo also when refused, to draw the ghost in the refusal colour).
 */
export function canAddStair(input) {
  const dr = stairDraft(input || {});
  if (dr.error) return dr.error;
  const fit = stairFits(dr.stair, dr.levelId);
  const setup = fit.ok ? fit.setup : stairSetup(dr.stair, dr.levelId);
  const out = { stair: dr.stair, geo: setup ? setup.geo : null, levelId: dr.levelId, to: dr.stair.to };
  if (!fit.ok) return { ok: false, reason: fit.reason, code: fit.code, ...out };
  return { ok: true, ...out, need: ringsOfEx(setup.need), level: stairPolicy().level };
}

/**
 * Add a stair on `level` (default: the active level) up to the level above it. input = { level?, shape?, x, y, rot?,
 * width?, risers?, going?, landing?, turn?, gap?, nosing?, guard?, handrail? }: missing fields come from proposeStair for
 * the rise. Creates (or grows, adopting a plain void it overlaps) the opening in the floor above. ids = [stairId, voidId?].
 * Refused (`code`): no level above ('no-level-above' — offer to add a floor), stairProblems, a footprint off the level's
 * floor / through a wall or an opening / over another stair, the top step not arriving on floor, the opening above
 * cutting a wall up there ('locked' when that wall is locked).
 */
export function addStair(...args) { return tracked('addStair', addStairImpl, args); }
function addStairImpl(input, opts) {
  const dr = stairDraft({ ...(input || {}), id: undefined });
  if (dr.error) return dr.error;
  const stair = cleanStair({ ...dr.stair, id: newStairId() });
  const fit = stairFits(stair, dr.levelId);
  if (!fit.ok) return { ok: false, reason: fit.reason, code: fit.code };
  const vo = voidsAfter(stair, fit.setup, null), pol = stairPolicy();
  return commitStairs([{ levelId: dr.levelId, stairs: [...stairsOn(PLAN, dr.levelId), stair] }, { levelId: fit.setup.to, voids: vo.list }], 'add-stair',
    { level: pol.level, warnings: pol.warnings, ids: vo.voidId ? [stair.id, vo.voidId] : [stair.id], levelId: dr.levelId, extra: { stairId: stair.id, voidId: vo.voidId } }, opts);
}

/**
 * Change a stair: patch { x, y (centre of its bounding box), rot (90° steps), shape, turn, width, risers, going, landing
 * ({ at, size } | null), gap, nosing, guard, handrail, fit: true (re-run proposeStair for its rise, shape, width and turn,
 * keeping its position) }. Same checks as addStair; its opening follows (see voidsAfter) and never ends up smaller than
 * the stair needs. ids = [stairId, voidId?].
 */
export function updateStair(...args) { return tracked('updateStair', updateStairImpl, args); }
function updateStairImpl(id, patch, opts) {
  const h = stairHolder(id);
  if (!h) return fail('There is no such stair.');
  const old = h.stair, p = patch || {}, was = cleanStair(old);
  const next = { ...was };
  for (const k of STAIR_INPUT) if (p[k] !== undefined && p[k] !== null) next[k] = p[k];
  if (p.landing === null) delete next.landing;
  const n = num(next.risers) ? next.risers : was.risers;
  if (p.shape !== undefined && p.shape !== was.shape && p.landing === undefined) {
    if (next.shape === 'straight') { delete next.landing; delete next.turn; delete next.gap; if (n > 18) next.landing = { at: Math.ceil(n / 2), size: next.width }; }
    else next.landing = { at: Math.ceil(n / 2), size: next.width };
  } else if (next.landing && p.landing === undefined) {
    // risers / width changed: a landing that was in the middle stays in the middle; an L's landing stays as deep as the stair is wide
    const L = { ...next.landing };
    if (p.risers !== undefined && was.landing && was.landing.at === Math.ceil(was.risers / 2)) L.at = Math.ceil(n / 2);
    else if (num(L.at)) L.at = Math.min(Math.max(1, L.at), n - 1);
    if (p.width !== undefined && was.landing && was.landing.size === was.width) L.size = next.width;
    if (next.shape === 'L' && num(L.size) && L.size < next.width) L.size = next.width;
    next.landing = L;
  }
  if (p.fit) {
    const to = stairTarget(next, h.levelId), rise = to ? levelElevation(PLAN, to) - levelElevation(PLAN, h.levelId) : 0;
    const prop = rise > 0 ? proposeStair({ rise, shape: next.shape, width: next.width, turn: next.turn }) : null;
    if (prop) { next.risers = prop.risers; next.going = prop.going; next.width = prop.width; if (prop.landing) next.landing = prop.landing; else delete next.landing; }
  }
  const stair = cleanStair(next);
  if (JSON.stringify(stair) === JSON.stringify(was)) return { ok: true, level: 'free', warnings: [], ids: [id] };
  const fit = stairFits(stair, h.levelId, id);
  if (!fit.ok) return { ok: false, reason: fit.reason, code: fit.code };
  const vo = voidsAfter(stair, fit.setup, h), pol = stairPolicy();
  const changes = [{ levelId: h.levelId, stairs: stairsOn(PLAN, h.levelId).map((s) => (s === old ? stair : s)) }, { levelId: fit.setup.to, voids: vo.list }];
  return commitStairs(changes, 'update-stair', { level: pol.level, warnings: pol.warnings, ids: vo.voidId ? [id, vo.voidId] : [id], levelId: h.levelId, extra: { stairId: id, voidId: vo.voidId } }, opts);
}

/**
 * Remove a stair. Its opening goes with it — unless the user had enlarged it: then it stays as a plain opening
 * (`stair: null`, with its railing) and `keptVoid` names it (a warning says so).
 */
export function removeStair(...args) { return tracked('removeStair', removeStairImpl, args); }
function removeStairImpl(id, opts) {
  const h = stairHolder(id);
  if (!h) return fail('There is no such stair.');
  const changes = [{ levelId: h.levelId, stairs: stairsOn(PLAN, h.levelId).filter((s) => s !== h.stair) }];
  const pol = stairPolicy(), warnings = [...pol.warnings];
  let keptVoid = null;
  for (const lid of levelIds(PLAN)) {
    const lv = levelOf(PLAN, lid), list = voidsOf(lv);
    if (!list.some((v) => v.stair === id)) continue;
    const setup = stairSetup(h.stair, h.levelId);
    const next = [];
    for (const v of lv.voids) {
      if (!v || v.stair !== id) { next.push(v); continue; }
      if (setup && sameRegion([v.polygon], setup.need)) continue;            // exactly what the stair needed: it goes
      next.push({ ...v, stair: null }); keptVoid = v.id;
    }
    changes.push({ levelId: lid, voids: next });
  }
  if (keptVoid) warnings.push(`The opening in the floor above was enlarged, so it stays as a plain opening with its railing (${keptVoid}). Remove it on that floor if it is no longer wanted.`);
  return commitStairs(changes, 'remove-stair', { level: pol.level, warnings, ids: [id], levelId: h.levelId, extra: { keptVoid } }, opts);
}

/** The stairs that need (part of) void `v` of level `levelId`: its own stair and any whose opening overlaps it. */
function stairsNeeding(levelId, v) {
  return stairsOf(PLAN).map((x) => ({ ...x, setup: stairSetup(x.stair, x.levelId) }))
    .filter((x) => x.setup && x.setup.to === levelId && x.setup.need.length && (x.stair.id === v.stair || intersectArea([v.polygon], x.setup.need) > STAIR_TOL));
}

/**
 * Enlarge / reshape an opening in a floor: patch { polygon: [[x, y]…] } (plan cm, 0.1 cm). It must stay on the floor of
 * its level (not through a wall or an opening), and never become smaller than what a stair it serves needs.
 */
export function updateVoid(...args) { return tracked('updateVoid', updateVoidImpl, args); }
function updateVoidImpl(id, patch, opts) {
  const h = voidHolder(id);
  if (!h) return fail('There is no such opening in a floor.');
  const raw = patch && patch.polygon;
  if (!Array.isArray(raw) || raw.length < 3 || !raw.every((p) => Array.isArray(p) && num(p[0]) && num(p[1]))) return fail('An opening in a floor needs an outline of at least three points.');
  const ring = voidRing(raw);
  if (ring.length < 3 || Math.abs(polygonArea(ring)) < 100) return fail('The opening is too small.');
  if (JSON.stringify(ring) === JSON.stringify(h.void.polygon)) return { ok: true, level: 'free', warnings: [], ids: [id] };
  const view = levelPlan(PLAN, h.levelId), segs = wallSegments(view);
  const hit = segs.filter((g) => intersectArea([ring], [segShape(g)]) > STAIR_TOL);
  if (hit.length) {
    const locked = hit.find((g) => g.policy.level === 'locked');
    return fail(locked ? `An opening in the floor cannot cut a locked wall. ${locked.policy.reason}` : 'An opening in the floor cannot cut a wall or a doorway — keep it inside the room.');
  }
  const rooms = roomsOf(view);
  if (!rooms.length || netArea(polyDifference([ring], rooms)) > STAIR_TOL) return fail(`The opening must stay inside the rooms of the ${lowerFirst(floorName(h.levelId))}.`);
  for (const x of stairsNeeding(h.levelId, h.void)) {
    if (netArea(polyDifference(ringsOfEx(x.setup.need), [ring])) > COVER_TOL) {
      const b = bboxOf(ringsOfEx(x.setup.need));
      return fail(`The opening cannot be smaller than stair ${x.stair.id} needs for ${(DEFAULT_HEADROOM_CM / 100).toFixed(2)} m headroom (x ${b.x0}–${b.x1}, y ${b.y0}–${b.y1}).`);
    }
  }
  const pol = stairPolicy(), lv = levelOf(PLAN, h.levelId);
  const list = lv.voids.map((v) => (v === h.void ? { ...v, polygon: ring } : v));
  return commitStairs([{ levelId: h.levelId, voids: list }], 'update-void', { level: pol.level, warnings: pol.warnings, ids: [id], levelId: h.levelId }, opts);
}
const bboxOf = (rings) => { const xs = rings.flat().map((p) => r01(p[0])), ys = rings.flat().map((p) => r01(p[1])); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };

/** Close an opening in a floor (refused while a stair needs it). */
export function removeVoid(...args) { return tracked('removeVoid', removeVoidImpl, args); }
function removeVoidImpl(id, opts) {
  const h = voidHolder(id);
  if (!h) return fail('There is no such opening in a floor.');
  const rest = voidsOf(levelOf(PLAN, h.levelId)).filter((v) => v !== h.void).map((v) => v.polygon);
  for (const x of stairsNeeding(h.levelId, h.void)) {
    if (x.stair.id === h.void.stair || netArea(polyDifference(ringsOfEx(x.setup.need), rest.length ? rest : [])) > COVER_TOL) return fail(`Stair ${x.stair.id} needs this opening — remove the stair first.`);
  }
  const pol = stairPolicy(), lv = levelOf(PLAN, h.levelId);
  return commitStairs([{ levelId: h.levelId, voids: lv.voids.filter((v) => v !== h.void) }], 'remove-void', { level: pol.level, warnings: pol.warnings, ids: [id], levelId: h.levelId }, opts);
}

/**
 * Everything the 2D view and the inspector need about one stair (read-only): `{ stair, levelId, to, rise, geo, need
 * (rings of the opening it needs above), voids (its voids on the level above), covers, data }` or null.
 */
export function stairInfo(id) {
  const h = stairHolder(id);
  if (!h) return null;
  const setup = stairSetup(h.stair, h.levelId), to = stairTarget(h.stair, h.levelId);
  const voids = to ? voidsOf(levelOf(PLAN, to)).filter((v) => v.stair === id) : [];
  const need = setup ? ringsOfEx(setup.need) : [];
  return { stair: h.stair, data: cleanStair(h.stair), levelId: h.levelId, to, rise: setup ? setup.rise : (to ? levelElevation(PLAN, to) - levelElevation(PLAN, h.levelId) : null),
    geo: setup ? setup.geo : null, need, voids, covers: !need.length || (voids.length > 0 && netArea(polyDifference(need, voids.map((v) => v.polygon))) <= COVER_TOL) };
}
/** One void with its level and the stair that needs it: `{ void, levelId, stair: info | null, need, covers }` or null. */
export function voidInfo(id) {
  const h = voidHolder(id);
  if (!h) return null;
  const users = stairsNeeding(h.levelId, h.void);
  const x = users.find((u) => u.stair.id === h.void.stair) || users[0] || null;
  const need = x ? ringsOfEx(x.setup.need) : [];
  return { void: h.void, levelId: h.levelId, stairId: x ? x.stair.id : null, need, covers: !need.length || netArea(polyDifference(need, [h.void.polygon])) <= COVER_TOL };
}
/** Every stair of the plan: `[{ stair, levelId }]` (bottom-up). */
export function allStairs() { return stairsOf(PLAN); }

// ---------------------------------------------------------------- planDiff entries for stairs and voids
const SHAPE_WORD = { straight: 'straight', L: 'L-shaped', U: 'U-shaped' };
const stairAt = (s) => ({ x: s.x, y: s.y });
function stairChanges(a, b) {
  const what = [];
  if (a.x !== b.x || a.y !== b.y) what.push(`moved ${Math.round(Math.abs(b.x - a.x) + Math.abs(b.y - a.y))} cm`);
  if ((a.rot || 0) !== (b.rot || 0)) what.push(`turned to ${b.rot}°`);
  if (a.shape !== b.shape || a.turn !== b.turn) what.push(`now ${SHAPE_WORD[b.shape] || b.shape}${b.turn ? ` turning ${b.turn}` : ''}`);
  if (a.width !== b.width) what.push(`width ${a.width} → ${b.width} cm`);
  if (a.risers !== b.risers || a.going !== b.going) what.push(`${b.risers} risers, going ${b.going} cm`);
  if (JSON.stringify(a.landing || null) !== JSON.stringify(b.landing || null)) what.push('landing changed');
  return what.length ? what : ['changed'];
}
/** Stairs and floor openings added / removed / changed against the base plan; every entry with `levelId`. */
function diffStairs() {
  const items = [];
  const was = new Map(stairsOf(BASE_PLAN).map((x) => [x.stair.id, x])), now = new Map(stairsOf(PLAN).map((x) => [x.stair.id, x]));
  const route = (x, plan) => { const to = x.stair.to || levelIds(plan)[levelIds(plan).indexOf(x.levelId) + 1]; return `from the ${lowerFirst(levelName(plan, x.levelId) || x.levelId)} to the ${lowerFirst(levelName(plan, to) || to || '?')}`; };
  for (const [id, b] of was) {
    const n = now.get(id);
    if (!n) { items.push({ kind: 'stair-removed', level: 'permit', text: `Removed the stair ${route(b, BASE_PLAN)}`, at: stairAt(b.stair), ref: id, levelId: b.levelId }); continue; }
    const A = cleanStair(stairData(b.stair)), B = cleanStair(stairData(n.stair));
    if (JSON.stringify(A) !== JSON.stringify(B)) items.push({ kind: 'stair-changed', level: 'permit', text: `Stair ${route(n, PLAN)}: ${stairChanges(A, B).join(', ')}`, at: stairAt(n.stair), ref: id, levelId: n.levelId });
  }
  for (const [id, n] of now) if (!was.has(id)) {
    const s = cleanStair(stairData(n.stair));
    items.push({ kind: 'stair-added', level: 'permit', text: `New ${SHAPE_WORD[s.shape] || ''} stair ${route(n, PLAN)} (${s.risers} risers, ${s.width} cm wide)`, at: stairAt(s), ref: id, levelId: n.levelId });
  }
  const vwas = new Map(allVoids(BASE_PLAN).map((x) => [x.void.id, x])), vnow = new Map(allVoids(PLAN).map((x) => [x.void.id, x]));
  const size = (v) => { const b = bboxOf([v.polygon]); return `${((b.x1 - b.x0) / 100).toFixed(2)} × ${((b.y1 - b.y0) / 100).toFixed(2)} m`; };
  const vat = (v) => { const b = bboxOf([v.polygon]); return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }; };
  const where = (x, plan) => `in the floor of the ${lowerFirst(levelName(plan, x.levelId) || x.levelId)}`;
  for (const [id, b] of vwas) {
    const n = vnow.get(id);
    if (!n) items.push({ kind: 'void-removed', level: 'permit', text: `Closed the opening ${where(b, BASE_PLAN)} (${size(b.void)})`, at: vat(b.void), ref: id, levelId: b.levelId });
    else if (JSON.stringify(n.void.polygon) !== JSON.stringify(b.void.polygon) || (n.void.stair || null) !== (b.void.stair || null) || n.void.railing !== b.void.railing) {
      items.push({ kind: 'void-changed', level: 'permit', text: `Opening ${where(n, PLAN)}: ${size(b.void)} → ${size(n.void)}`, at: vat(n.void), ref: id, levelId: n.levelId });
    }
  }
  for (const [id, n] of vnow) if (!vwas.has(id)) items.push({ kind: 'void-added', level: 'permit', text: `New opening ${where(n, PLAN)} (${size(n.void)})${n.void.stair ? ` for the stair` : ''}`, at: vat(n.void), ref: id, levelId: n.levelId });
  return items;
}

// ---------------------------------------------------------------- diff against the architect's plan
let diffBase = null;               // the base (level) planDiff compares with: BASE_PLAN, or a base level's view
const spaceName = (id) => {
  if (id == null || id === 'outside') return 'outside';
  const base = diffBase || BASE_PLAN;
  const s = PLAN.rooms.find((r) => r.id === id) || base.rooms.find((r) => r.id === id) || (base.outdoorAreas || []).find((r) => r.id === id);
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
  if (!modified || ENV.draft) return { changed: false, items };
  if (!upperLevels(PLAN).length && !upperLevels(BASE_PLAN).length) return { changed: true, items: diffItems(BASE_PLAN) };
  // several levels: L0 as always, then each upper level against the base plan's level; every entry carries `levelId`
  for (const it of diffItems(BASE_PLAN)) items.push({ ...it, levelId: GROUND });
  const ids = [...new Set([...upperLevels(BASE_PLAN), ...upperLevels(PLAN)].map((l) => l.id))];
  for (const id of ids) {
    const was = levelOf(BASE_PLAN, id), now = levelOf(PLAN, id);
    const at = (plan) => { const b = wallBounds(levelPlan(plan, id).walls); return b ? centreOf(b) : { x: 0, y: 0 }; };
    if (!was) items.push({ kind: 'level-added', level: 'permit', text: `Added a floor: ${levelName(PLAN, id)}`, at: at(PLAN), ref: id, levelId: id });
    else if (!now) items.push({ kind: 'level-removed', level: 'permit', text: `Removed a floor: ${levelName(BASE_PLAN, id)}`, at: at(BASE_PLAN), ref: id, levelId: id });
    else {
      if (JSON.stringify(was.heights) !== JSON.stringify(now.heights)) items.push({ kind: 'level-changed', level: 'permit', text: `${levelName(PLAN, id)}: heights changed`, at: at(PLAN), ref: id, levelId: id });
      if (now === was || JSON.stringify(now.walls) === JSON.stringify(was.walls) && JSON.stringify(now.openings) === JSON.stringify(was.openings) && JSON.stringify(now.rooms) === JSON.stringify(was.rooms)
        && JSON.stringify(now.slants) === JSON.stringify(was.slants)) continue;
      const baseView = levelPlan(BASE_PLAN, id);
      onLevel(id, () => {
        diffBase = baseView;
        try { for (const it of diffItems(baseView)) items.push({ ...it, levelId: id }); } finally { diffBase = null; }
      });
    }
  }
  items.push(...diffStairs());                          // stage F4b: stairs and openings in floors
  return { changed: true, items };
}

/** The changes of the live (or swapped-in) level against `base` (BASE_PLAN or a base level's view). */
function diffItems(base) {
  const items = [];
  const baseAn = analysisOf(base), cur = current(), solids = solidsOf(PLAN), coreLen = (s) => (s.axis === 'h' ? s.core.w : s.core.h);
  const gone = baseAn.segments.filter((s) => s.axis !== 'a' && coverage(s.core, solids) < 0.5), carried = [];
  // a short new piece in line with an existing wall is that wall stretched to follow a move, not a new wall
  const stretch = (n) => { const a = coreSpan(n); return cur.segments.some((g) => { const b = coreSpan(g); return !g.isNew && g.axis === n.axis && a.c0 === b.c0 && a.c1 === b.c1 && Math.min(Math.abs(b.a0 - a.a1), Math.abs(a.a0 - b.a1)) <= TMAX; }); };
  const added = cur.segments.filter((s) => s.axis !== 'a' && s.isNew && !isJunction(s) && !stretch(s));
  for (const g of gone) {
    const pos = (s) => (s.axis === 'h' ? s.core.y : s.core.x), a = coreSpan(g);
    const twin = added.find((n) => { const b = coreSpan(n); return n.axis === g.axis && n.thickness === g.thickness && Math.abs(pos(n) - pos(g)) <= 200 && overlapLen(a.a0, a.a1, b.a0, b.a1) >= 0.5 * Math.min(coreLen(g), coreLen(n)); });
    if (twin) {
      added.splice(added.indexOf(twin), 1);
      carried.push({ core: twin.core, dx: g.axis === 'v' ? pos(twin) - pos(g) : 0, dy: g.axis === 'h' ? pos(twin) - pos(g) : 0 });
      const by = pos(twin) - pos(g), dir = g.axis === 'h' ? (by > 0 ? 'south' : 'north') : (by > 0 ? 'east' : 'west');
      items.push({ kind: 'wall-moved', level: g.policy.level, text: `Moved the ${wallName(g)} ${sides(g)} ${Math.abs(by)} cm ${dir}`, at: centreOf(twin.core), ref: twin.id });
    } else items.push({ kind: 'wall-removed', level: g.policy.level, text: `Removed the ${wallName(g)} ${sides(g)} (${metres(coreLen(g))})`, at: centreOf(g.core), ref: g.id });
  }
  for (const n of added) items.push({ kind: 'wall-added', level: 'free', text: `New ${n.thickness} cm partition ${sides(n)} (${metres(coreLen(n))})`, at: centreOf(n.core), ref: n.id });
  const slantItems = diffSlants(base, baseAn, cur);
  if (!items.length && !sameSolid(PLAN.walls.concat(rectOpenings(PLAN.openings)), ENV.solids)) {
    const a = cur.segments.find((s) => s.axis !== 'a' && coverage(s.core, ENV.solids) < 0.999) || baseAn.segments.find((s) => s.axis !== 'a' && coverage(s.core, solids) < 0.999);
    if (a) items.push({ kind: 'wall-moved', level: a.policy.level === 'locked' ? 'free' : a.policy.level, text: `Changed the length of the ${wallName(a)} ${sides(a)}`, at: centreOf(a.core), ref: a.id });
  }
  items.push(...slantItems);
  const liveIds = new Set((liveSlants() || []).map((x) => x.id));
  for (const b of base.openings) {
    const o = PLAN.openings.find((x) => x.id === b.id), level = b.exterior ? 'permit' : 'free';
    if (!o) {
      const closed = isAngledOpening(b) ? liveIds.has(b.wall) : coverage(b, solids) >= 0.5;   // not when its wall went
      if (closed) items.push({ kind: 'opening-removed', level, text: `Closed the ${openingName(b)} (${b.width} cm) — ${whereOpening(b)}`, at: openingAt(b), ref: b.id });
      continue;
    }
    const what = [];
    if (isAngledOpening(o) || isAngledOpening(b)) {
      if (o.wall !== b.wall || o.axis !== b.axis) what.push('moved to another wall');
      else if (o.at !== b.at) {
        // an opening that travelled with its wall (the wall moved sideways) is not listed as moved
        const now = (liveSlants() || []).find((x) => x.id === o.wall), was = (base.slants || []).find((x) => x.id === b.wall);
        let by = Math.abs(o.at - b.at);
        if (now && was && !sameSlant(now, was) && num(o.cx) && num(b.cx)) { const f = slantFrame(now); by = Math.abs((o.cx - b.cx) * f.ux + (o.cy - b.cy) * f.uy); }
        if (by >= 0.5) what.push(`moved ${Math.round(by)} cm`);
      }
    } else {
      const rode = carried.some((c) => overlapArea(o, c.core) > 0 && o.x - b.x === c.dx && o.y - b.y === c.dy);   // travelled with its wall
      if ((o.x !== b.x || o.y !== b.y) && !rode) what.push(`moved ${Math.abs(o.x - b.x) + Math.abs(o.y - b.y)} cm`);
    }
    if (o.width !== b.width) what.push(`width ${b.width} → ${o.width} cm`);
    if (o.height !== b.height) what.push(`height ${b.height} → ${o.height} cm`);
    if (o.sill !== b.sill) what.push(`sill ${b.sill} → ${o.sill} cm`);
    const geometry = what.length > 0;
    if (o.style !== b.style) what.push(`style ${o.style}`);
    if (o.hinge !== b.hinge || o.swing !== b.swing) what.push('re-hung');
    if (what.length) items.push({ kind: 'opening-changed', level: geometry ? level : 'free', text: `${openingName(o)[0].toUpperCase() + openingName(o).slice(1)} — ${whereOpening(o)}: ${what.join(', ')}`, at: openingAt(o), ref: o.id });
  }
  for (const o of PLAN.openings) if (!base.openings.some((b) => b.id === o.id)) items.push({ kind: 'opening-added', level: o.exterior ? 'permit' : 'free', text: `New ${openingName(o)} ${labelOf(o)} — ${whereOpening(o)}`, at: openingAt(o), ref: o.id });
  return items;
}
/** Plan point of an opening for the changes list (its centre). */
const openingAt = (o) => (isAngledOpening(o) ? (num(o.cx) && num(o.cy) ? { x: o.cx, y: o.cy } : num(o.x) ? centreOf(o) : { x: 0, y: 0 }) : centreOf(o));
const slantText = (g) => `${g.thickness} cm angled ${g.cls === 'partition' ? 'partition' : 'wall'}`;
const slantMid = (s) => ({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 });
/**
 * Angled walls added / removed / changed (by slant id) against the base level: entries `slant-added` (level 'free'),
 * `slant-removed` and `slant-changed` (the base wall's policy level; 'locked' never happens on a fixed plan), ref =
 * the segment id ('seg:a:<id>', prefixed on upper levels).
 */
function diffSlants(base, baseAn, cur) {
  const was = base.slants || [], now = liveSlants() || [], items = [];
  if (!was.length && !now.length) return items;
  const segOf = (an, id) => an.segments.find((g) => g.axis === 'a' && g.slantId === id);
  for (const b of was) {
    const n = now.find((x) => x.id === b.id), g = segOf(baseAn, b.id);
    if (!g) continue;
    const level = g.policy.level === 'locked' ? 'permit' : g.policy.level;
    if (!n) items.push({ kind: 'slant-removed', level, text: `Removed the ${slantText(g)} ${sides(g)} (${metres(g.length)})`, at: slantMid(b), ref: g.id });
    else if (!sameSlant(n, b)) {
      const c = segOf(cur, n.id) || g, fb = slantFrame(b), fn = slantFrame(n);
      // what kind of change: moved (same direction, shifted sideways), resized (same line), rotated (direction), changed
      const turn = Math.abs(((fn.angle - fb.angle + 540) % 360) - 180), shift = (n.x1 - b.x1) * fb.nx + (n.y1 - b.y1) * fb.ny;
      const change = n.t !== b.t ? 'changed' : turn > 0.05 ? 'rotated' : Math.abs(shift) >= 0.05 ? 'moved' : 'resized';
      const text = change === 'moved' ? `Moved the ${slantText(g)} ${sides(g)} ${Math.round(Math.abs(shift))} cm`
        : change === 'rotated' ? `Turned the ${slantText(g)} ${sides(g)} by ${Math.round(turn)}° (${metres(g.length)} → ${metres(c.length)})`
          : `Changed the ${slantText(g)} ${sides(c)} (${metres(g.length)} → ${metres(c.length)})`;
      items.push({ kind: 'slant-changed', change, level, text, at: slantMid(n), ref: c.id });
    }
  }
  for (const n of now) {
    if (was.some((b) => b.id === n.id)) continue;
    const c = segOf(cur, n.id);
    if (c) items.push({ kind: 'slant-added', level: 'free', text: `New ${slantText(c)} ${sides(c)} (${metres(c.length)})`, at: slantMid(n), ref: c.id });
  }
  return items;
}

/** Test / tooling hook: everything derived from a plan's walls + openings (the same function used on load and after every edit). */
export function recomputePlan(plan = PLAN) {
  const d = derive(solidsOf(plan), plan.openings, plan.rooms, plan.walls, plan.slants);
  return { walls: d.walls, openings: d.openings, rooms: d.rooms, wallOutline: d.wallOutline, problems: d.problems };
}

// ---------------------------------------------------------------- switchable base plan and phase (projects)
/**
 * Replace the base plan at runtime (opening another project). `PLAN` keeps its identity; every field is replaced by a
 * copy of `planData` (meta, heights, bounds, walls, wallOutline, openings, rooms, outdoorAreas, site, assumptions),
 * `BASE_PLAN` becomes a deep-frozen copy, the derived state (safe-room shell, classification, caches) follows, and the
 * live plan is the base plan unedited. No history, no event: the store's `openProject()` wraps this and announces it.
 * The optional schema-2 keys (OPTIONAL_KEYS) are copied when present (lazy schema, see plan-schema.js) and DELETED from
 * PLAN when `planData` has none, so switching back to House 98 leaves PLAN exactly as plan.js built it.
 * @param {object} planData  a complete PLAN-shaped object (from `plan-build.js` `buildPlan()` or a saved project)
 * @param {{ phase?: 'draft' | 'fixed' }} [opts]
 */
export function setBasePlan(planData, opts = {}) {
  const data = normalizeOptionalKeys(clone(planData));
  if (Array.isArray(data.levels)) data.levels = data.levels.map(annotateVoids);   // rooms cut by a void say so (F4b)
  const base = deepFreeze(data);
  BASE_PLAN = JSON.stringify(base) === BUILTIN_KEY ? BUILTIN_PLAN : base;
  phase = opts.phase === 'draft' ? 'draft' : 'fixed';
  for (const k of Object.keys(PLAN)) if (!(k in BASE_PLAN)) delete PLAN[k];   // optional keys absent from the new base go too
  for (const k of Object.keys(BASE_PLAN)) if (!OPTIONAL_KEYS.includes(k)) PLAN[k] = clone(BASE_PLAN[k]);
  setOptionalKeys(PLAN, optionalCopy(BASE_PLAN));                            // last, in OPTIONAL_KEYS order (as the base)
  ENV = makeEnv(BASE_PLAN, phase);
  foreign = new WeakMap(); resetLevelCaches();
  modified = false; analysis = null; stateKey = null;
  activeLevel();
  syncBounds();
  invalidatePlanCaches();
}

/** True while the base plan is the built-in house (House 98 — the architect's plan and layout exist only for it). */
export function isBuiltinBase() { return BASE_PLAN === BUILTIN_PLAN; }

/** 'draft' (the existing house is still being drawn) | 'fixed' (the base plan is the house as built). */
export function planPhase() { return phase; }

/**
 * Switch the phase (engine only; use `store.setPlanPhase()` from the UI, which also clears the undo history and emits
 * 'plan'). draft → fixed: the current plan becomes the new base plan ("this is the house as built"), from then on the
 * permission levels and the changes list apply relative to it. fixed → draft: the base stays, every wall and opening is
 * free again and the changes list is empty; fixing again later restarts it from the plan as it is then.
 * @returns {{ changed: boolean }}
 */
export function setPlanPhase(next) {
  const want = next === 'draft' ? 'draft' : 'fixed';
  if (want === phase) return { changed: false };
  if (want === 'fixed') setBasePlan(currentPlanData(), { phase: 'fixed' });
  else {
    phase = 'draft'; ENV = makeEnv(BASE_PLAN, phase); foreign = new WeakMap(); resetLevelCaches();
    analysis = null; stateKey = null; syncBounds(); invalidatePlanCaches();
  }
  return { changed: true };
}

/** A plain copy of the live plan as a complete PLAN-shaped object (walls without the edit-only `cls`). */
export function currentPlanData() {
  const out = {};
  for (const k of Object.keys(PLAN)) out[k] = clone(PLAN[k]);
  out.walls = out.walls.map(({ cls, ...w }) => w);
  if (Array.isArray(out.levels)) for (const l of out.levels) if (Array.isArray(l.walls)) l.walls = l.walls.map(({ cls, ...w }) => w);
  return out;
}

/**
 * Pure derivation for building a NEW plan (no live state is read or changed): wall rectangles + openings → clean wall
 * rectangles, wall outline, rooms (enclosed indoor regions between walls, matched to `prevRooms` by overlap; new ones are
 * `{ id: 'room-<n>', name: 'New room' }`), openings with their rooms / exterior / outside sides, and problems
 * (`{ id, type: 'overlap' | 'jamb' | 'blocked' }` for openings that do not sit cleanly in a wall).
 * `slants`: the angled walls of that level (mixed derive; `segments` then include one `axis: 'a'` segment per slant).
 * Runs as a draft (nothing locked, no safe-room shell). Used by `plan-build.js`.
 */
export function analyseWalls(walls, openings, { prevRooms = [], outdoorAreas = [], level = null, reservedRoomIds = null, slants = null } = {}) {
  const saved = ENV;
  // `level` ('L1'…): ids for an upper level (prefixed wall / segment ids); `reservedRoomIds`: ids new rooms must avoid
  ENV = { draft: true, solids: [], mamad: NO_MAMAD, outdoorAreas, baseWalls: [], reserved: reservedRoomIds && reservedRoomIds.size ? reservedRoomIds : null,
    ...(level && level !== GROUND ? { level, pre: level + '|' } : {}) };
  try {
    const d = derive([...walls, ...openings], openings, prevRooms, [], slants);
    return { walls: d.walls, openings: d.openings, rooms: d.rooms, wallOutline: d.wallOutline, problems: d.problems, segments: d.segments };
  } finally { ENV = saved; }
}
