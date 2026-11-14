/**
 * The building shell in 3D, generated entirely from PLAN (cm → m; X = x/100, Z = y/100, Y up, ground floor at Y = 0).
 *
 * How it is built
 * ---------------
 * All plan coordinates (wall rectangles, opening rectangles, room polygons) are rasterised onto one irregular
 * grid whose lines are exactly those coordinates. Every grid cell is wall, opening, room or outdoors, and has a
 * vertical "solid profile" (wall: floor→ceiling; window: sill wall + lintel; door: lintel only). A face is
 * emitted only where a solid cell meets something emptier, so:
 *   • the shell is one watertight surface — no internal faces, no overlaps, no z-fighting, no seams;
 *   • each face knows what it looks at: a room (→ that room's wall finish), outdoors (→ exterior render) or an
 *     opening (→ reveal, split at the frame plane into a room-side and an outdoor-side part);
 *   • floors, ceilings, door thresholds, skirting boards, wall caps and the roof outline come from the same grid.
 * Collinear faces are merged into long quads; UVs are metres (u along the wall, v = height) so finishes are to scale.
 *
 * Sun study
 * ---------
 * Direct sun may enter a room only through its real openings — also while the roof is hidden or the walls are cut
 * away for the dollhouse view. With `setSunStudy(true)` the hidden parts keep casting: an invisible copy of the roof
 * slab / parapet, and (cut-away) invisible full-height walls, lintels and window / door frames. They are drawn with
 * `colorWrite: false, depthWrite: false`, so they exist only in the sun's shadow map.
 *
 * Several levels (stage F3, docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md)
 * -------------------------------------------------------------------
 * Every level is built by the same grid builder (buildStorey) on its PLAN-shaped view (core/plan-edit.js levelPlan) in
 * level-local coordinates and placed at Y = elevation / 100. A level below another one has walls up to that level's
 * slab; the slab under level k ≥ 1 is a prism of its footprint minus its voids; the roof of each level covers its
 * footprint minus the footprint of the level above (core/polykernel.js), with the parapet / coping only on the open
 * edges — a smaller upper level leaves a terrace roof on the one below. Voids cut the upper floor finish and the
 * ceiling below and get a 1.05 m guard rail (open on a stair's arrival edge). Plinth and ground contact: L0 only.
 * A plan without `levels` takes exactly the old path (tests/levels-3d.test.mjs hashes every House 98 mesh).
 * The daylight solver is attached to L0 only (upper levels keep the standard lighting until stage F6).
 *
 * Live plan edits
 * ---------------
 * Nothing derived from the plan outlives `rebuildPlan()`: grid, opening sides, footprint, floors, ceilings, shell,
 * roof and openings are rebuilt from `ctx.plan` as it is at that moment and swapped in within the same frame.
 * With levels, `rebuildPlan(e)` rebuilds L0 on its own edits, an upper level when its data changed, and only a level's
 * roof when just the footprint above it moved.
 */
import * as THREE from 'three';
import { resolveFinish } from '../core/finishes.js';
import { pointInPolygon } from '../core/geometry.js';
import { floorMaterial, wallMaterial, surfaceMaterial, disposeMaterials } from './textures.js';
import { Soup, buildOpenings, openingFrame, mergeSoups, casterMaterial, casterMesh } from './openings.js';
import { levelIds, levelElevation, levelHeights, footprintOf, GROUND } from '../core/levels.js';
import { levelPlan } from '../core/plan-edit.js';
import { difference, offset, union } from '../core/polykernel.js';

const OUT = 0, WALL = 1, OPENING = 2, ROOM = 3;
const SKIRT_H = 0.07, SKIRT_T = 0.012;        // skirting board (m)
const PARAPET_T = 20;                         // parapet thickness (cm) — same as the exterior block walls
const COPING_H = 0.04, COPING_OVER = 2;       // parapet coping: 4 cm slab, 2 cm overhang (cm)
const AO_FLOOR = { width: 0.45, alpha: 0.34 }, AO_CEILING = { width: 0.4, alpha: 0.2 };   // baked contact shading strips
const WALL_FADE = 0.45;                       // height (m) of the soft darkening at the foot / head of interior walls
const PLINTH_PROUD = 0.8;                     // cm the plinth course stands proud of the render
const IDENTITY = new THREE.Matrix4();
/** Meshes of the room interiors (lit by the daylight lightmap when the daylight solver is attached). */
const isInterior = (name) => name.startsWith('floor:') || name.startsWith('wall:room:') || name === 'ceilings' || name === 'wall:skirting';

/** Soft contact-shadow strips (black, per-vertex alpha) laid on floors and ceilings along the walls. */
class ShadeStrips {
  constructor() { this.pos = []; this.col = []; this.idx = []; }
  /** Strip from the wall line a→b (alpha at the wall) to a2→b2 inside the room (alpha 0); all points [x, y, z]. */
  add(a, b, b2, a2, alpha, up) {
    const base = this.pos.length / 3;
    for (const [p, al] of [[a, alpha], [b, alpha], [b2, 0], [a2, 0]]) { this.pos.push(p[0], p[1], p[2]); this.col.push(0.09, 0.075, 0.06, al); }
    _e1.set(b[0] - a[0], 0, b[2] - a[2]); _e2.set(a2[0] - a[0], 0, a2[2] - a[2]);
    const ccwUp = _e1.cross(_e2).y > 0;
    if (ccwUp === up) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3); else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.setIndex(this.idx);
    return g;
  }
}
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();

/** Baked brightness of an interior wall at height y: a little darker at the floor and under the ceiling. */
function wallShade(y, ceiling) {
  if (y < WALL_FADE) return 0.8 + 0.2 * (y / WALL_FADE);
  if (y > ceiling - WALL_FADE) return 1 - 0.12 * Math.min(1, (y - (ceiling - WALL_FADE)) / WALL_FADE);
  return 1;
}

/**
 * Look of a space's floor or walls: catalogue product → store overrides (`wallColor`, `floorParams`) → defaults.
 * Shared with site.js. Never throws.
 */
export function finishParams(ctx, spaceId, kind) {
  const { store, catalog } = ctx;
  let params = {};
  try { params = resolveFinish(spaceId, kind, store, catalog).params || {}; } catch (e) { params = {}; }
  const f = (store.finishes && store.finishes[spaceId]) || {};
  const product = f[kind] && catalog && catalog.getProduct ? catalog.getProduct(f[kind]) : null;
  if (!product) {
    if (kind === 'wall' && f.wallColor) params = { kind: 'paint', color: f.wallColor, gloss: 0.05 };
    if (kind === 'floor' && f.floorParams && typeof f.floorParams === 'object') params = { ...params, ...f.floorParams };
  }
  return params;
}

// ───────────────────────── plan grid ─────────────────────────
function makeGrid(plan, extra = null) {
  const xs = new Set(), ys = new Set();
  const rect = (r) => { xs.add(r.x); xs.add(r.x + r.w); ys.add(r.y); ys.add(r.y + r.h); };
  plan.walls.forEach(rect); plan.openings.forEach(rect);
  for (const r of plan.rooms) for (const [x, y] of r.polygon) { xs.add(x); ys.add(y); }
  if (extra) for (const poly of extra) for (const [x, y] of poly) { xs.add(x); ys.add(y); }   // upper levels: void outlines
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
  X.unshift(X[0] - 100); X.push(X[X.length - 1] + 100); Y.unshift(Y[0] - 100); Y.push(Y[Y.length - 1] + 100);
  const nx = X.length - 1, ny = Y.length - 1;
  const kind = new Uint8Array(nx * ny), ref = new Array(nx * ny).fill(null);
  const find = (A, v) => { let lo = 0, hi = A.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (A[m] <= v) lo = m; else hi = m - 1; } return lo; };
  /** Visit the cells whose centres lie inside a rectangle (its edges are grid lines). Priority: wall > opening > room. */
  const cells = (x0, y0, x1, y1, fn) => {
    for (let j = find(Y, y0), j1 = find(Y, y1 - 1e-6); j <= j1; j++) for (let i = find(X, x0), i1 = find(X, x1 - 1e-6); i <= i1; i++) fn(j * nx + i, (X[i] + X[i + 1]) / 2, (Y[j] + Y[j + 1]) / 2);
  };
  for (const r of plan.rooms) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of r.polygon) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 > x0 && y1 > y0) cells(x0, y0, x1, y1, (k, cx, cy) => { if (kind[k] === OUT && pointInPolygon(cx, cy, r.polygon)) { kind[k] = ROOM; ref[k] = r; } });
  }
  for (let q = plan.openings.length - 1; q >= 0; q--) {                 // back to front: the first opening listed wins, as before
    const o = plan.openings[q];
    if (o.w > 0 && o.h > 0) cells(o.x, o.y, o.x + o.w, o.y + o.h, (k) => { kind[k] = OPENING; ref[k] = o; });
  }
  for (const w of plan.walls) if (w.w > 0 && w.h > 0) cells(w.x, w.y, w.x + w.w, w.y + w.h, (k) => { kind[k] = WALL; ref[k] = null; });
  /** Cell index containing a plan point (clamped to the grid). */
  const cellAt = (x, y) => find(Y, y) * nx + find(X, x);
  return { X, Y, nx, ny, kind, ref, cellAt };
}

const faceMat = (grid, k) => (grid.kind[k] === ROOM ? 'room:' + grid.ref[k].id : 'ext');

/** Per opening: frame plane across the wall and the material key on each side of it. */
function openingSides(grid, plan) {
  const map = new Map();
  for (const o of plan.openings) {
    const F = openingFrame(o), cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    const lo = o.axis === 'h' ? grid.cellAt(cx, o.y - 1) : grid.cellAt(o.x - 1, cy);
    const hi = o.axis === 'h' ? grid.cellAt(cx, o.y + o.h + 1) : grid.cellAt(o.x + o.w + 1, cy);
    map.set(o, { plane: F.plane, lowMat: faceMat(grid, lo), highMat: faceMat(grid, hi) });
  }
  return map;
}

/** Vertical solid intervals (m) of a cell, limited to `top`. */
function solidOf(grid, k, top) {
  if (grid.kind[k] === WALL) return [[0, top]];
  if (grid.kind[k] !== OPENING) return [];
  const o = grid.ref[k], sill = (o.sill || 0) / 100, head = sill + o.height / 100, out = [];
  if (sill > 0) out.push([0, Math.min(sill, top)]);
  if (head < top) out.push([head, top]);
  return out;
}

/** a − b for sorted, disjoint interval lists. */
function subtract(a, b) {
  let res = a;
  for (const [b0, b1] of b) {
    const next = [];
    for (const [a0, a1] of res) {
      if (b1 <= a0 || b0 >= a1) { next.push([a0, a1]); continue; }
      if (b0 > a0) next.push([a0, b0]);
      if (b1 < a1) next.push([b1, a1]);
    }
    res = next;
  }
  return res.filter(([p, q]) => q - p > 1e-6);
}

// ───────────────────────── shell: walls, reveals, caps, skirting ─────────────────────────
function buildShellSoups(grid, plan, sides, top, ceiling, plinthDepth, dryRooms) {
  const { X, Y, nx, ny, kind, ref } = grid;
  const soups = new Map(), aoFloor = new ShadeStrips(), aoCeiling = new ShadeStrips();
  const soup = (key) => { if (!soups.has(key)) soups.set(key, new Soup()); return soups.get(key); };
  const faces = new Map();                                             // merge key → [{a0, a1}]
  const addFace = (axis, c, s, a0, a1, y0, y1, mat) => {
    if (a1 - a0 < 1e-6 || y1 - y0 < 1e-6) return;
    const key = `${axis}|${c}|${s}|${mat}|${y0}|${y1}`;
    if (!faces.has(key)) faces.set(key, { axis, c, s, y0, y1, mat, segs: [] });
    faces.get(key).segs.push([a0, a1]);
  };
  /** Split a face lying across an opening's wall thickness at the frame plane. */
  const splitAcross = (o, a0, a1, emit) => {
    const sd = sides.get(o), p = Math.min(a1, Math.max(a0, sd.plane));
    emit(a0, p, sd.lowMat); emit(p, a1, sd.highMat);
  };
  const horizontal = (o, i, j, y, up) => {                             // sill top / lintel underside of an opening cell
    const across = o.axis === 'h' ? [Y[j], Y[j + 1]] : [X[i], X[i + 1]];
    splitAcross(o, across[0], across[1], (a0, a1, mat) => {
      if (a1 - a0 < 1e-6) return;
      const x0 = (o.axis === 'h' ? X[i] : a0) / 100, x1 = (o.axis === 'h' ? X[i + 1] : a1) / 100;
      const z0 = (o.axis === 'h' ? a0 : Y[j]) / 100, z1 = (o.axis === 'h' ? a1 : Y[j + 1]) / 100;
      soup(mat).quad([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, up ? 1 : -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
    });
  };

  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (kind[k] !== WALL && kind[k] !== OPENING) continue;
    const solid = solidOf(grid, k, top);
    // vertical faces towards the four neighbours
    for (const [di, dj, axis, c, s, a0, a1] of [
      [1, 0, 'x', X[i + 1], 1, Y[j], Y[j + 1]], [-1, 0, 'x', X[i], -1, Y[j], Y[j + 1]],
      [0, 1, 'z', Y[j + 1], 1, X[i], X[i + 1]], [0, -1, 'z', Y[j], -1, X[i], X[i + 1]],
    ]) {
      const nk = (j + dj) * nx + (i + di), nKind = kind[nk];
      if (nKind === WALL) continue;
      if (nKind === OUT && plinthDepth != null) addFace(axis, c + s * PLINTH_PROUD, s, a0, a1, -plinthDepth, 0.012, 'plinth');   // stands 8 mm proud, laps the wall foot
      for (const [y0, y1] of subtract(solid, solidOf(grid, nk, top))) {
        if (nKind === OPENING) splitAcross(ref[nk], a0, a1, (p, q, mat) => addFace(axis, c, s, p, q, y0, y1, mat));
        else addFace(axis, c, s, a0, a1, y0, y1, faceMat(grid, nk));
      }
    }
    // horizontal faces
    const x0 = X[i] / 100, x1 = X[i + 1] / 100, z0 = Y[j] / 100, z1 = Y[j + 1] / 100;
    solid.forEach(([y0, y1]) => {
      if (y1 >= top - 1e-6) soup('cap').quad([[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]], [0, 1, 0]);
      else if (kind[k] === OPENING) horizontal(ref[k], i, j, y1, true);
      if (y0 > 1e-6 && kind[k] === OPENING) horizontal(ref[k], i, j, y0, false);
    });
  }

  // merge collinear segments → long quads (+ skirting along dry-room faces that reach the floor)
  const floorSolid = (x, y) => { const k = grid.cellAt(x, y); return kind[k] === WALL || (kind[k] === OPENING && (ref[k].sill || 0) > 0); };
  const isDoor = (x, y) => { const k = grid.cellAt(x, y); return kind[k] === OPENING && !(ref[k].sill > 0); };
  for (const f of faces.values()) {
    f.segs.sort((p, q) => p[0] - q[0]);
    const runs = [];
    for (const sg of f.segs) { const last = runs[runs.length - 1]; if (last && Math.abs(last[1] - sg[0]) < 1e-6) last[1] = sg[1]; else runs.push([sg[0], sg[1]]); }
    const c = f.c / 100, n = f.axis === 'x' ? [f.s, 0, 0] : [0, 0, f.s];
    for (const [a0, a1] of runs) {
      const p0 = a0 / 100, p1 = a1 / 100;
      const band = (y0, y1, s0, s1) => {
        const q = f.axis === 'x' ? [[c, y0, p0], [c, y0, p1], [c, y1, p1], [c, y1, p0]] : [[p0, y0, c], [p1, y0, c], [p1, y1, c], [p0, y1, c]];
        soup(f.mat).quad(q, n, [[p0, y0], [p1, y0], [p1, y1], [p0, y1]], [s0, s0, s1, s1]);
      };
      if (!f.mat.startsWith('room:')) { band(f.y0, f.y1, 1, 1); continue; }

      // interior wall: gentle darkening towards floor and ceiling + contact strips on floor / ceiling (cheap fake GI)
      const atFloor = f.y0 === 0, atCeiling = f.y1 >= ceiling - 1e-6;
      const cuts = [f.y0, WALL_FADE, ceiling - WALL_FADE, f.y1].filter((y) => y >= f.y0 && y <= f.y1).sort((p, q) => p - q);
      for (let q = 0; q < cuts.length - 1; q++) if (cuts[q + 1] - cuts[q] > 1e-6) band(cuts[q], cuts[q + 1], wallShade(cuts[q], ceiling), wallShade(cuts[q + 1], ceiling));
      const ends = [a0, a1].map((e, q) => {                             // what happens past each end of the run
        const along = e + (q ? 1 : -1), wallPt = f.c - f.s, roomPt = f.c + f.s;
        const W = f.axis === 'x' ? [wallPt, along] : [along, wallPt], R = f.axis === 'x' ? [roomPt, along] : [along, roomPt];
        return floorSolid(R[0], R[1]) ? 'concave' : floorSolid(W[0], W[1]) ? 'straight' : isDoor(W[0], W[1]) ? 'door' : 'convex';
      });
      const strip = (S, y, cfg, up) => {
        const t0 = ends[0] === 'concave' || ends[0] === 'straight' ? 0 : cfg.width, t1 = ends[1] === 'concave' || ends[1] === 'straight' ? 0 : cfg.width;
        if (p1 - p0 < t0 + t1 + 0.02) return;
        const P = (along, off) => (f.axis === 'x' ? [c + f.s * off, y, along] : [along, y, c + f.s * off]);
        S.add(P(p0, 0), P(p1, 0), P(p1 - t1, cfg.width), P(p0 + t0, cfg.width), cfg.alpha, up);
      };
      if (atFloor) strip(aoFloor, 0.003, AO_FLOOR, true);
      if (atCeiling) strip(aoCeiling, ceiling - 0.005, AO_CEILING, false);

      if (!atFloor || f.y1 < SKIRT_H || !dryRooms.has(f.mat.slice(5))) continue;
      const ext = ends.map((e) => (e === 'convex' ? SKIRT_T : 0));       // wrap convex corners, stop at doors / concave corners
      const b0 = p0 - ext[0], b1 = p1 + ext[1], d0 = Math.min(c, c + f.s * SKIRT_T), d1 = Math.max(c, c + f.s * SKIRT_T);
      if (f.axis === 'x') soup('skirting').box(IDENTITY, d0, d1, 0, SKIRT_H, b0, b1, 'b');
      else soup('skirting').box(IDENTITY, b0, b1, 0, SKIRT_H, d0, d1, 'b');
    }
  }
  return { soups, aoFloor, aoCeiling };
}

// ───────────────────────── floors & ceilings ─────────────────────────
function buildFloorSoups(grid, plan, floorHoles = null, ceilingHoles = null) {
  const { X, Y, nx, ny, kind, ref } = grid;
  /** Cell centre inside one of the hole polygons (a stair void in this level's floor / in the slab above). */
  const inHole = (holes, i, j) => !!holes && holes.some((p) => pointInPolygon((X[i] + X[i + 1]) / 2, (Y[j] + Y[j + 1]) / 2, p));
  const roomIds = new Set(plan.rooms.map((r) => r.id));
  const floors = new Map(plan.rooms.map((r) => [r.id, new Soup()]));
  const ceilings = new Soup();
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    let id = null;
    if (kind[k] === ROOM) id = ref[k].id;
    else if (kind[k] === OPENING && !(ref[k].sill > 0)) id = (ref[k].rooms || []).find((r) => roomIds.has(r)) || null;   // door threshold
    if (!id) continue;
    const x0 = X[i] / 100, x1 = X[i + 1] / 100, z0 = Y[j] / 100, z1 = Y[j + 1] / 100;
    const uv = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    if (!floorHoles || !inHole(floorHoles, i, j)) floors.get(id).quad([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], [0, 1, 0], uv);
    if (kind[k] === ROOM && !(ceilingHoles && inHole(ceilingHoles, i, j))) ceilings.quad([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], [0, -1, 0], uv);
  }
  // the ceiling also runs over the wall heads (hidden inside the walls): the hair-line cracks of the wall / ceiling
  // T-junctions then show ceiling, not the exterior roof soffit above it (visible indoors once the eye adapts)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (kind[k] !== WALL && kind[k] !== OPENING) continue;
    if (ceilingHoles && inHole(ceilingHoles, i, j)) continue;
    const xs = [X[i] / 100, (X[i] + X[i + 1]) / 200, X[i + 1] / 100], zs = [Y[j] / 100, (Y[j] + Y[j + 1]) / 200, Y[j + 1] / 100];
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {             // halves: each takes the room on its own side
      const x0 = xs[a], x1 = xs[a + 1], z0 = zs[b], z1 = zs[b + 1];
      ceilings.quad([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
    }
  }
  return { floors, ceilings };
}

// ───────────────────────── footprint outline & roof ─────────────────────────
/** Closed outline loops (cm) of all non-outdoor cells; interior on the right-hand side walking +x along the north edge. */
function traceFootprint(grid) {
  const { X, Y, nx, ny, kind } = grid;
  const inside = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && kind[j * nx + i] !== OUT;
  const next = new Map();
  const edge = (x0, y0, x1, y1) => { const key = `${x0},${y0}`; if (!next.has(key)) next.set(key, []); next.get(key).push([x1, y1]); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!inside(i, j)) continue;
    if (!inside(i, j - 1)) edge(X[i], Y[j], X[i + 1], Y[j]);
    if (!inside(i + 1, j)) edge(X[i + 1], Y[j], X[i + 1], Y[j + 1]);
    if (!inside(i, j + 1)) edge(X[i + 1], Y[j + 1], X[i], Y[j + 1]);
    if (!inside(i - 1, j)) edge(X[i], Y[j + 1], X[i], Y[j]);
  }
  const loops = [];
  for (const [start] of next) {
    while (next.get(start) && next.get(start).length) {
      const loop = []; let key = start;
      for (let guard = 0; guard < 100000; guard++) {
        const outs = next.get(key); if (!outs || !outs.length) break;
        const [x, y] = outs.pop(); loop.push(key.split(',').map(Number)); key = `${x},${y}`;
        if (key === start) break;
      }
      const simple = loop.filter((p, q) => {                            // drop collinear points
        const a = loop[(q + loop.length - 1) % loop.length], b = loop[(q + 1) % loop.length];
        return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
      });
      if (simple.length >= 4) loops.push(simple);
    }
  }
  const area = (l) => Math.abs(l.reduce((s, p, q) => { const b = l[(q + 1) % l.length]; return s + p[0] * b[1] - b[0] * p[1]; }, 0));
  return loops.sort((a, b) => area(b) - area(a));
}

/** Offset a rectilinear loop by `d` cm towards its interior (d < 0 = outwards). */
function insetLoop(loop, d) {
  const n = loop.length;
  const normal = (a, b) => { const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]); return [-dy, dx]; };
  return loop.map((p, q) => {
    const n0 = normal(loop[(q + n - 1) % n], p), n1 = normal(p, loop[(q + 1) % n]);
    return [p[0] + (n0[0] + n1[0]) * d, p[1] + (n0[1] + n1[1]) * d];
  });
}

/** Vertical prism between y0 and y1 (m) over a plan polygon (cm, traced like traceFootprint) with optional holes; parts → named soups { top, bottom, side }. */
export function prism(outline, holes, y0, y1, soups) {
  const v2 = (l) => l.map(([x, y]) => new THREE.Vector2(x / 100, y / 100));
  const contour = v2(outline), holeV = holes.map(v2);
  const all = contour.concat(...holeV);
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, holeV)) {
    const t = [all[a], all[b], all[c]];
    if (soups.top) soups.top.tri(...t.map((p) => [p.x, y1, p.y]), [0, 1, 0], t.map((p) => [p.x, p.y]));
    if (soups.bottom) soups.bottom.tri(...t.map((p) => [p.x, y0, p.y]), [0, -1, 0], t.map((p) => [p.x, p.y]));
  }
  const side = (loop, sign) => {
    if (!soups.side) return;
    loop.forEach((p, q) => {
      const b = loop[(q + 1) % loop.length], len = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
      const dx = (b[0] - p[0]) / len, dy = (b[1] - p[1]) / len;
      const n = [dy * sign, 0, -dx * sign];                             // outward for the traced orientation
      const u0 = (Math.abs(dx) >= Math.abs(dy) ? p[0] : p[1]) / 100, u1 = (Math.abs(dx) >= Math.abs(dy) ? b[0] : b[1]) / 100;
      soups.side.quad([[p[0] / 100, y0, p[1] / 100], [b[0] / 100, y0, b[1] / 100], [b[0] / 100, y1, b[1] / 100], [p[0] / 100, y1, p[1] / 100]], n, [[u0, y0], [u1, y0], [u1, y1], [u0, y1]]);
    });
  };
  side(outline, 1); holes.forEach((h) => side(h, -1));
}

function buildRoofSoups(outline, H, slab, parapet) {
  const ext = new Soup(), topSoup = new Soup(), coping = new Soup();
  if (!outline) return { ext, top: topSoup, coping };
  prism(outline, [], H, H + slab, { top: topSoup });
  prism(insetLoop(outline, 4), [], H, H + slab, { bottom: ext });       // soffit (shadow caster) kept clear of the facade plane → no acne line
  prism(outline, [], H - 0.015, H + slab, { side: ext });               // laps the wall head so no hairline can open at the joint
  if (parapet > 0.01) {
    const inner = insetLoop(outline, PARAPET_T), y = H + slab;
    prism(outline, [inner], y, y + parapet, { side: ext });
    prism(insetLoop(outline, -COPING_OVER), [insetLoop(outline, PARAPET_T + COPING_OVER)], y + parapet, y + parapet + COPING_H, { top: coping, bottom: coping, side: coping });
  }
  return { ext, top: topSoup, coping };
}

// ───────────────────────── several levels: roofs, slabs, railings from polygons (cm) ─────────────────────────
/** Polygon-kernel expolygons → prism() rings: outer as is (clockwise on screen, like traceFootprint), holes turned clockwise too. */
const prismRings = (e) => ({ outer: e.outer, holes: e.holes.map((h) => h.slice().reverse()) });

/**
 * Flat roof over a region of a level (several levels: the level's footprint minus the one above) — the same parts as
 * buildRoofSoups(): slab (top + soffit + edge), parapet and coping, each a list of expolygons.
 */
function buildRoofPolySoups(shape, H) {
  const ext = new Soup(), topSoup = new Soup(), coping = new Soup();
  if (!shape) return { ext, top: topSoup, coping };
  const slab = shape.slab, parapet = shape.parapet;
  for (const e of shape.polys.map(prismRings)) prism(e.outer, e.holes, H, H + slab, { top: topSoup });
  for (const e of shape.soffit.map(prismRings)) prism(e.outer, e.holes, H, H + slab, { bottom: ext });
  for (const e of shape.polys.map(prismRings)) prism(e.outer, e.holes, H - 0.015, H + slab, { side: ext });
  if (parapet > 0.01) {
    const y = H + slab;
    for (const e of shape.parapetPolys.map(prismRings)) prism(e.outer, e.holes, y, y + parapet, { side: ext });
    for (const e of shape.copingPolys.map(prismRings)) prism(e.outer, e.holes, y + parapet, y + parapet + COPING_H, { top: coping, bottom: coping, side: coping });
  }
  return { ext, top: topSoup, coping };
}

/** The structural slab under an upper level: its footprint minus its voids, from −depth to the finished floor (no top: the floors cover it). */
function buildSlabSoup(shape) {
  const soup = new Soup();
  if (!shape) return soup;
  for (const e of shape.polys.map(prismRings)) prism(e.outer, e.holes, -shape.depth, 0, { bottom: soup, side: soup });
  return soup;
}

const RAIL_H = 1.05, RAIL_POST = 0.04, RAIL_SPACING = 1.2, RAIL_INSET = 0.05;   // m: guard rail height, post size, max bay, set back from the void edge
const UP_VEC = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
/** Walking direction of a stair (plan unit vector): its `up` side, else from its rotation (rot 0 = towards the north). */
function stairUp(st) {
  if (st && UP_VEC[st.up]) return UP_VEC[st.up];
  const a = ((Number(st && st.rot) || 0) * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)];
}
/**
 * A simple guard rail around each void of a level (1.05 m: posts + top rail, mid rail, bottom rail), set back 5 cm
 * onto the floor. The edge where the void's stair arrives (`void.stair` → that stair's walking direction) stays open.
 */
function buildRailingSoup(voids, stairOf) {
  const soup = new Soup(), m = new THREE.Matrix4();
  for (const v of voids) {
    if (!v || v.railing === false || !Array.isArray(v.polygon) || v.polygon.length < 3) continue;
    const ring = v.polygon, sgn = Math.sign(ring.reduce((s, p, i) => { const b = ring[(i + 1) % ring.length]; return s + p[0] * b[1] - b[0] * p[1]; }, 0)) || 1;
    const st = v.stair ? stairOf(v.stair) : null, up = st ? stairUp(st) : null;
    ring.forEach((p, i) => {
      const b = ring[(i + 1) % ring.length], len = Math.hypot(b[0] - p[0], b[1] - p[1]) / 100;
      if (len < 0.05) return;
      const ux = (b[0] - p[0]) / 100 / len, uy = (b[1] - p[1]) / 100 / len;
      const ox = uy * sgn, oy = -ux * sgn;                               // outward from the void, onto the floor
      if (up && ox * up[0] + oy * up[1] > 0.9) return;                  // the stair's arrival edge stays open
      // local frame: x along the edge from p, z across (+z onto the floor), y up
      m.set(ux, 0, ox, p[0] / 100 + ox * RAIL_INSET, 0, 1, 0, 0, uy, 0, oy, p[1] / 100 + oy * RAIL_INSET, 0, 0, 0, 1);
      const h = RAIL_POST / 2, bays = Math.max(1, Math.ceil(len / RAIL_SPACING));
      for (let q = 0; q <= bays; q++) { const x = Math.min(len - h, Math.max(h, (len * q) / bays)); soup.box(m, x - h, x + h, 0, RAIL_H - 0.04, -h, h); }
      soup.box(m, 0, len, RAIL_H - 0.04, RAIL_H, -0.025, 0.025);         // handrail
      soup.box(m, 0, len, 0.52, 0.545, -0.012, 0.012);                    // mid rail
      soup.box(m, 0, len, 0.1, 0.125, -0.012, 0.012);                     // bottom rail
    });
  }
  return soup;
}

// ───────────────────────── one level ─────────────────────────
/**
 * The shell of ONE level, built in level-local coordinates (its finished floor at Y = 0); the caller places it.
 * This is the original single-storey builder: with no options it builds exactly what it always built.
 * @param {object} ctx { store, catalog }
 * @param {{ view: () => object, levelId?: string, ground?: boolean, ceilingH?: () => number|null,
 *           roofShape?: () => object|undefined, slabShape?: () => object|null, ceilingHoles?: () => number[][][],
 *           stairOf?: (id) => object|null }} opts  view() = the level's PLAN-shaped view (re-read on every rebuild);
 *           roofShape() undefined = the classic roof over the traced outline; ceilingH() null = the project's ceiling.
 */
function buildStorey(ctx, opts) {
  const { store } = ctx;
  const ground = opts.ground !== false;
  let plan = opts.view();
  const group = new THREE.Group(); group.name = 'level:' + (opts.levelId || 'L0'); group.userData.levelId = opts.levelId || 'L0';
  const shell = new THREE.Group(); shell.name = 'house-shell';
  const roof = new THREE.Group(); roof.name = 'house-roof';
  const casters = new THREE.Group(); casters.name = 'house-sun-casters';   // shadow-only stand-ins for hidden roof / cut walls
  group.add(shell, roof, casters);

  // everything derived from the plan — refreshed by readPlan(), never kept across a plan edit
  let grid, sides, outline, dryRooms, floorHoles = null, ceilingHoles = null, viewChanged = false;
  function readPlan() {
    const next = opts.view();
    if (next && next !== plan) { plan = next; viewChanged = true; }
    if (!ground) floorHoles = (plan.voids || []).map((v) => v && v.polygon).filter((p) => Array.isArray(p) && p.length >= 3);
    const above = opts.ceilingHoles ? opts.ceilingHoles() : null;
    ceilingHoles = above && above.length ? above : null;
    const extra = [...(floorHoles || []), ...(ceilingHoles || [])];
    grid = extra.length ? makeGrid(plan, extra) : makeGrid(plan);
    if (floorHoles && !floorHoles.length) floorHoles = null;
    sides = openingSides(grid, plan);
    outline = traceFootprint(grid)[0] || null;
    dryRooms = new Set(plan.rooms.filter((r) => !r.wet).map((r) => r.id));
  }
  readPlan();
  const plinthDepth = ground ? (plan.heights.floorAboveGround || 15) / 100 + 0.12 : null;   // the plinth / ground contact: L0 only

  const state = {
    H: 0, cut: null, doorsOpen: false, roofVisible: !!(store.ui && store.ui.showRoof),
    sunStudy: !store.ui || store.ui.sunStudy !== false,
    exteriorColor: null, frameColor: null,
  };
  const own = {                                                         // materials owned (and disposed) by this module
    cap: new THREE.MeshStandardMaterial({ color: '#34363b', roughness: 0.9 }),
    plinth: new THREE.MeshStandardMaterial({ color: '#cfcbc3', roughness: 0.95 }),
    skirting: new THREE.MeshStandardMaterial({ color: '#f6f4ef', roughness: 0.5 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#fbf8f2', roughness: 0.96 }),
    coping: new THREE.MeshStandardMaterial({ color: '#dcd8d0', roughness: 0.85 }),
    shade: new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    caster: casterMaterial(),                                           // cut-away walls: back faces, exactly like the visible shell
    roofCaster: Object.assign(casterMaterial(), { shadowSide: THREE.DoubleSide }),   // hidden roof: both faces, so nothing touching the ceiling plane is lit
  };
  if (!ground) own.railing = new THREE.MeshStandardMaterial({ color: '#3b3d41', roughness: 0.45, metalness: 0.55 });
  const meshes = new Map();
  let daylight = null;                                                  // daylight/index.js hooks (lightmap UVs + materials)
  let fakeShading = true;                                               // baked contact strips: off while real daylight is shown

  /** Create or refresh a named mesh from a soup. */
  function setMesh(name, soup, parent, cast, receive) {
    let mesh = meshes.get(name);
    if (!soup || soup.empty) { if (mesh) mesh.visible = false; return mesh; }
    if (!mesh) {
      mesh = new THREE.Mesh(soup.toGeometry(name.startsWith('wall:room:')), own.cap);
      mesh.name = name; meshes.set(name, mesh); parent.add(mesh);
    } else { mesh.geometry.dispose(); mesh.geometry = soup.toGeometry(name.startsWith('wall:room:')); mesh.visible = true; }
    mesh.castShadow = cast; mesh.receiveShadow = receive;
    if (daylight && isInterior(name)) daylight.prepareMesh(mesh);
    return mesh;
  }

  const ceilingH = () => {
    const forced = opts.ceilingH ? opts.ceilingH() : null;              // several levels: the next level's slab sits on it
    if (forced != null) return forced;
    if (!ground) return plan.heights.ceiling / 100;
    const v = Number(store.project && store.project.ceilingHeight);
    return (Number.isFinite(v) && v >= 200 ? Math.min(v, 600) : plan.heights.ceiling) / 100;
  };
  const topH = () => (state.cut == null ? state.H : Math.min(state.H, state.cut));

  // floors + ceilings: geometry depends on the plan only
  const floorMeshes = [];
  function rebuildFloors() {
    const fc = floorHoles || ceilingHoles ? buildFloorSoups(grid, plan, floorHoles, ceilingHoles) : buildFloorSoups(grid, plan);
    const ids = new Set(plan.rooms.map((r) => r.id));
    for (const [name, mesh] of [...meshes]) {                           // rooms that no longer exist
      if (!name.startsWith('floor:') || ids.has(name.slice(6))) continue;
      mesh.geometry.dispose(); mesh.removeFromParent(); meshes.delete(name);
    }
    floorMeshes.length = 0;                                             // same array object: callers may hold on to it
    for (const room of plan.rooms) {
      const mesh = setMesh('floor:' + room.id, fc.floors.get(room.id), shell, false, true);
      if (mesh) { mesh.userData.spaceId = room.id; if (!ground) mesh.userData.levelId = opts.levelId; if (mesh.visible) floorMeshes.push(mesh); }
    }
    const ceilingMesh = setMesh('ceilings', fc.ceilings, roof, false, false);
    if (ceilingMesh) ceilingMesh.material = own.ceiling;
  }
  rebuildFloors();

  /** Shadow casting of the visible shell: off while invisible full-height walls cast in its place. */
  const wallsCast = () => !(state.sunStudy && state.cut != null);
  function rebuildShell() {
    const { soups, aoFloor, aoCeiling } = buildShellSoups(grid, plan, sides, topH(), state.H, plinthDepth, dryRooms);
    for (const [name, strips, parent] of [['ao:floor', aoFloor, shell], ['ao:ceiling', aoCeiling, roof]]) {
      const mesh = setMesh(name, strips.idx.length ? { empty: false, toGeometry: () => strips.toGeometry() } : null, parent, false, false);
      if (mesh) { mesh.material = own.shade; mesh.renderOrder = 1; if (mesh.visible) mesh.visible = fakeShading; }
    }
    for (const key of new Set([...soups.keys(), ...[...meshes.keys()].filter((n) => n.startsWith('wall:')).map((n) => n.slice(5))])) {
      const mesh = setMesh('wall:' + key, soups.get(key), shell, wallsCast(), true);
      if (mesh && key === 'skirting') mesh.castShadow = false;
      if (mesh && key === 'cap') mesh.receiveShadow = false;           // a section cut through solid wall: evenly lit, never patchy
    }
    const rooms = new Set(plan.rooms.map((r) => 'wall:room:' + r.id));
    for (const [name, mesh] of [...meshes]) {                           // finishes of rooms that no longer exist
      if (!name.startsWith('wall:room:') || rooms.has(name) || mesh.visible) continue;
      mesh.geometry.dispose(); mesh.removeFromParent(); meshes.delete(name);
    }
    wallCasterStale = true;
  }
  /** Upper levels: the slab under the floor (footprint minus voids) and the guard rails around the voids. */
  function rebuildStructure() {
    if (ground) return;
    const slab = setMesh('slab', buildSlabSoup(opts.slabShape ? opts.slabShape() : null), shell, true, true);
    if (slab) slab.userData.levelId = opts.levelId;
    setMesh('railing', buildRailingSoup(plan.voids || [], opts.stairOf || (() => null)), shell, true, true);
  }
  function rebuildRoof() {
    const shape = opts.roofShape ? opts.roofShape() : undefined;
    const r = shape === undefined
      ? buildRoofSoups(outline, state.H, (plan.heights.slab || 20) / 100, (plan.heights.parapet || 0) / 100)
      : buildRoofPolySoups(shape, state.H);
    setMesh('roof:ext', r.ext, roof, true, true);
    setMesh('roof:top', r.top, roof, true, true);
    setMesh('roof:coping', r.coping, roof, true, true);
    const ceilingMesh = meshes.get('ceilings');
    if (ceilingMesh) ceilingMesh.position.y = state.H - 0.002;
  }
  const openingOpts = () => ({ ceilingH: state.H, cutH: state.cut == null ? null : topH(), doorsOpen: state.doorsOpen, frameColor: state.frameColor, shadowFull: state.sunStudy });

  // ── sun study: invisible shadow casters for whatever is hidden ──
  const casterMeshes = new Map();
  let wallCasterStale = true;
  /** Create / refresh a shadow-only mesh; `geometry` null hides it. `shared` geometries belong to a visible mesh. */
  function setCaster(name, geometry, shared) {
    let mesh = casterMeshes.get(name);
    if (!geometry) { if (mesh) mesh.visible = false; return; }
    if (!mesh) { mesh = casterMesh('caster:' + name, geometry, shared ? own.roofCaster : own.caster); casterMeshes.set(name, mesh); casters.add(mesh); }
    else if (mesh.geometry !== geometry) { if (!mesh.userData.shared) mesh.geometry.dispose(); mesh.geometry = geometry; }
    mesh.userData.shared = shared; mesh.visible = true;
  }
  /** Keep the shadow-only copies in step with what is currently hidden. */
  function syncCasters() {
    const roofHidden = !(state.roofVisible && state.cut == null);
    for (const name of ['roof:ext', 'roof:top', 'roof:coping']) {       // the roof's own geometry, re-used
      const src = meshes.get(name);
      setCaster(name, state.sunStudy && roofHidden && src && src.visible ? src.geometry : null, true);
    }
    const fullWalls = state.sunStudy && state.cut != null;
    if (fullWalls && (wallCasterStale || !casterMeshes.get('walls'))) {
      const { soups } = buildShellSoups(grid, plan, sides, state.H, state.H, plinthDepth, dryRooms);
      setCaster('walls', mergeSoups([...soups].filter(([key]) => key !== 'skirting').map(([, soup]) => soup)), false);
      wallCasterStale = false;
    } else setCaster('walls', fullWalls ? casterMeshes.get('walls').geometry : null, false);
    for (const [name, mesh] of meshes) if (name.startsWith('wall:') && name !== 'wall:skirting') mesh.castShadow = wallsCast();
  }

  function applyMaterials() {
    const p = store.project || {};
    const exterior = surfaceMaterial('render', { color: p.exteriorColor || '#efece6' });
    own.plinth.color.set(p.exteriorColor || '#efece6').multiplyScalar(0.8);
    const assign = (name, material) => { const m = meshes.get(name); if (m) m.material = daylight && isInterior(name) ? daylight.lightmapMaterial(material) : material; };
    assign('ceilings', own.ceiling);
    assign('wall:ext', exterior); assign('roof:ext', exterior);
    assign('wall:plinth', own.plinth); assign('wall:cap', own.cap); assign('wall:skirting', own.skirting);
    assign('roof:top', surfaceMaterial('roof')); assign('roof:coping', own.coping);
    if (!ground) { assign('slab', exterior); assign('railing', own.railing); }
    for (const room of plan.rooms) {
      assign('floor:' + room.id, floorMaterial(finishParams(ctx, room.id, 'floor')));
      assign('wall:room:' + room.id, wallMaterial(finishParams(ctx, room.id, 'wall')));
    }
    if (p.frameColor && p.frameColor !== state.frameColor) { state.frameColor = p.frameColor; openings.setFrameColor(p.frameColor); }
  }
  const applyRoofVisibility = () => {
    roof.visible = state.roofVisible && state.cut == null;
    const cap = meshes.get('wall:cap');                                 // hidden under the slab (its edge would show as a hairline)
    if (cap && cap.geometry.index.count) cap.visible = !roof.visible;
    syncCasters();
  };

  state.H = ceilingH();
  state.frameColor = (store.project && store.project.frameColor) || '#2b2d31';
  rebuildShell(); rebuildRoof(); rebuildStructure();
  let openings = buildOpenings(plan, openingOpts());
  shell.add(openings.group);
  viewChanged = false;
  const rebuildOpenings = () => {
    if (viewChanged) {                                                  // an upper level's view object was replaced: new builder on it
      viewChanged = false;
      shell.remove(openings.group); openings.dispose();
      openings = buildOpenings(plan, openingOpts());
      shell.add(openings.group);
    } else openings.rebuild(openingOpts());
    if (daylight) daylight.patchTree(openings.group);
  };
  applyMaterials(); applyRoofVisibility();

  return {
    group,
    floorMeshes,
    levelId: opts.levelId || 'L0',
    /** Height (m) of this level's walls (its ceiling) as built. */
    height: () => state.H,
    /** Re-read store.project and store.finishes and refresh whatever changed. */
    update() {
      const H = ceilingH();
      if (H !== state.H) { state.H = H; rebuildShell(); rebuildRoof(); rebuildOpenings(); }
      applyMaterials(); applyRoofVisibility();
    },
    /**
     * The plan was edited in place (walls / openings / rooms / outline replaced): rebuild every piece of geometry that
     * derives from it. Roof, cut-away, open doors, sun study, finishes and colours are kept. Everything is built and
     * swapped synchronously, so no frame ever shows a half-built house.
     * @returns {number} milliseconds the rebuild took
     */
    rebuildPlan() {
      const t0 = performance.now();
      state.H = ceilingH();
      readPlan();
      rebuildFloors(); rebuildShell(); rebuildRoof(); rebuildStructure();
      rebuildOpenings();
      applyMaterials(); applyRoofVisibility();
      return performance.now() - t0;
    },
    /** Several levels: only the roof changed (the footprint of the level above moved). */
    rebuildRoof() { rebuildRoof(); applyMaterials(); applyRoofVisibility(); },
    /** Show / hide roof slab, parapet and room ceilings (always hidden while a cutaway is active). */
    setRoofVisible(v) { if (!!v === state.roofVisible) return; state.roofVisible = !!v; applyRoofVisibility(); },
    /** Limit wall / window / door heights (cm above the floor) for a dollhouse view; null restores full height. */
    setCutaway(heightCm) {
      const cut = heightCm == null || !Number.isFinite(+heightCm) ? null : Math.max(0.1, +heightCm / 100);
      if (cut === state.cut) return;
      state.cut = cut;
      rebuildShell(); rebuildOpenings(); applyMaterials(); applyRoofVisibility();
    },
    /**
     * Sun study: true (default) = a hidden roof and cut-away walls still block the sun (invisible shadow casters), so
     * rooms show the real sun patches; false = hidden parts cast nothing (evenly lit dollhouse).
     */
    setSunStudy(v) {
      if (!!v === state.sunStudy) return;
      state.sunStudy = !!v;
      if (state.cut != null) rebuildOpenings();
      applyRoofVisibility();
    },
    /**
     * Attach / detach the daylight solver: { prepareMesh(mesh), lightmapMaterial(material), patchTree(root) }.
     * Interior meshes get a second UV set into the lightmap atlas and lightmap-aware material clones.
     */
    setDaylight(dl) {
      daylight = dl || null;
      if (!daylight) this.setFakeShading(true);
      for (const [name, mesh] of meshes) if (daylight && isInterior(name) && mesh.visible) daylight.prepareMesh(mesh);
      if (daylight) daylight.patchTree(openings.group);
      applyMaterials();
    },
    /** Visit every interior mesh (floors, room walls, ceilings, skirting) — `fn(name, mesh)`. */
    forEachInterior(fn) { for (const [name, mesh] of meshes) if (isInterior(name) && mesh.visible) fn(name, mesh); },
    /** Show / hide the baked contact-shading strips (the old fake ambient occlusion). */
    setFakeShading(on) {
      fakeShading = !!on;
      for (const name of ['ao:floor', 'ao:ceiling']) { const m = meshes.get(name); if (m && m.geometry.index && m.geometry.index.count) m.visible = fakeShading; }
    },
    /** Open (≈ 85°, on the hinge, towards `swing`) or close all hinged doors; the terrace slider parks half open. */
    setDoorsOpen(v) {
      if (!!v === state.doorsOpen) return;
      state.doorsOpen = !!v;
      rebuildOpenings();
    },
    /** Geometries that stand in for this level in the sun's shadow map while it is hidden (shared — never dispose them). */
    shadowGeometries() {
      const out = [];
      for (const [name, mesh] of meshes) if (mesh.visible && (name === 'slab' || name.startsWith('roof:') || (name.startsWith('wall:') && name !== 'wall:skirting' && name !== 'wall:cap'))) out.push(mesh.geometry);
      return out;
    },
    /** `keepShared`: leave the module-wide finish material cache alone (another level still uses it). */
    dispose(keepShared = false) {
      for (const mesh of meshes.values()) mesh.geometry.dispose();
      for (const mesh of casterMeshes.values()) if (!mesh.userData.shared) mesh.geometry.dispose();
      meshes.clear(); casterMeshes.clear(); floorMeshes.length = 0;
      openings.dispose();
      Object.values(own).forEach((m) => m.dispose());
      if (!keepShared) disposeMaterials();
      group.clear();
    },
  };
}

// ───────────────────────── public API ─────────────────────────
/** Small integer id per array object (cheap change detection of a level's arrays). */
const arrayIds = new WeakMap();
let arraySerial = 0;
const idOf = (a) => { if (!a || typeof a !== 'object') return 0; let v = arrayIds.get(a); if (!v) { v = ++arraySerial; arrayIds.set(a, v); } return v; };

/**
 * Build the house: one shell per level (docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md, stage F3), each placed at
 * Y = elevation / 100. A plan without `levels` is exactly the one-storey house it always was.
 *
 * Several levels: the slab under level k (k ≥ 1) is its footprint minus its voids; the roof of level k covers its
 * footprint minus the footprint of level k + 1 (the top level: all of it) — a smaller upper level leaves a terrace roof
 * with its parapet on the level below; guard rails run around the voids (open at a stair's arrival edge).
 * View: `setLevel(id)` — levels above it are hidden (shadow-only stand-ins keep blocking the sun in the sun study), the
 * active level follows the roof / cut-away controls, levels below are complete (their roof where nothing stands on it);
 * `setWholeHouse(true)` treats the top level as the active one.
 * @param {{ store, plan, catalog, models }} ctx
 * @returns {{ group: THREE.Group, update(): void, rebuildPlan(e?): number, setRoofVisible(v: boolean): void,
 *             setCutaway(heightCm: number|null): void, setDoorsOpen(v: boolean): void, setSunStudy(v: boolean): void,
 *             setLevel(id: string): void, setWholeHouse(v: boolean): void, levels(): object[],
 *             floorMeshes: THREE.Object3D[], dispose(): void }}
 */
export function buildHouse(ctx) {
  const { store, plan } = ctx;
  const group = new THREE.Group(); group.name = 'house';
  const stand = new THREE.Group(); stand.name = 'house-level-casters';   // shadow-only stand-ins of hidden upper levels
  group.add(stand);
  const standMat = Object.assign(casterMaterial(), { shadowSide: THREE.DoubleSide });
  const storeys = new Map();                                            // level id → { s: storey, shellKey, roofKey }
  const floorMeshes = [];
  const view = {
    level: GROUND, whole: false, cut: null, roof: !!(store.ui && store.ui.showRoof),
    study: !store.ui || store.ui.sunStudy !== false, doors: false,
  };
  let daylight = null, fakeShading = true;

  const ids = () => levelIds(plan);
  const multi = () => ids().length > 1;
  const viewOf = (id) => levelPlan(plan, id) || plan;
  const elevationOf = (id) => (levelElevation(plan, id) || 0) / 100;
  const voidsOf = (id) => (id === GROUND ? [] : (viewOf(id).voids || []).map((v) => v && v.polygon).filter((p) => Array.isArray(p) && p.length >= 3));
  const above = (id) => { const l = ids(); const i = l.indexOf(id); return i >= 0 && i + 1 < l.length ? l[i + 1] : null; };
  function stairOf(sid) {
    for (const l of ids()) { const st = (viewOf(l).stairs || []).find((s) => s && s.id === sid); if (st) return st; }
    return (plan.stairs || []).find((s) => s && s.id === sid) || null;
  }
  /** Wall height (m) of a level under another level: up to that level's slab. */
  function stackedCeiling(id) {
    const up = above(id);
    if (!up) return id === GROUND ? null : viewOf(id).heights.ceiling / 100;
    return Math.max(2, (levelElevation(plan, up) - (levelHeights(plan, up).slab || 0) - levelElevation(plan, id)) / 100);
  }
  function roofShape(id) {
    if (!multi()) return undefined;                                     // one level: the classic roof over the traced outline
    const v = viewOf(id), fp = footprintOf(v).polygons, up = above(id);
    const upFp = up ? footprintOf(viewOf(up)).polygons : [];
    // what the level above covers; for the coping also its overhang next to the upper walls, outside this footprint
    const cover = (polys, overhang = false) => (!upFp.length ? polys : difference(polys, overhang ? union([upFp, difference(offset(upFp, COPING_OVER), fp)]) : upFp));
    const polys = cover(fp);
    const slab = ((up ? levelHeights(plan, up).slab : v.heights.slab) || 20) / 100;
    const parapet = (v.heights.parapet || 0) / 100;
    return {
      polys, slab, parapet,
      soffit: polys.length ? offset(polys, -4) : [],
      parapetPolys: parapet > 0.01 && polys.length ? cover(difference(fp, offset(fp, -PARAPET_T))) : [],
      copingPolys: parapet > 0.01 && polys.length ? cover(difference(offset(fp, COPING_OVER), offset(fp, -(PARAPET_T + COPING_OVER))), true) : [],
    };
  }
  function slabShape(id) {
    const v = viewOf(id), holes = voidsOf(id), fp = footprintOf(v).polygons;
    return { polys: holes.length ? difference(fp, holes) : fp, depth: (v.heights.slab || 0) / 100 };
  }

  function makeStorey(id) {
    const s = buildStorey(ctx, {
      view: () => viewOf(id), levelId: id, ground: id === GROUND,
      ceilingH: () => (multi() ? stackedCeiling(id) : null),
      roofShape: () => roofShape(id),
      slabShape: () => slabShape(id),
      ceilingHoles: () => { const up = above(id); return up ? voidsOf(up) : []; },
      stairOf,
    });
    s.group.position.y = elevationOf(id);
    group.add(s.group);
    return s;
  }
  const keysOf = (id) => {
    const v = viewOf(id), up = above(id);
    return {
      shell: [idOf(v.walls), idOf(v.openings), idOf(v.rooms), idOf(v.wallOutline), JSON.stringify(v.heights), v.elevation || 0,
        JSON.stringify(v.voids || []), up ? JSON.stringify(voidsOf(up)) : '', multi() ? stackedCeiling(id) : '-', id === GROUND ? '' : JSON.stringify(stairsKey())].join('|'),
      roof: JSON.stringify(roofShape(id) || null),
    };
  };
  const stairsKey = () => ids().map((l) => viewOf(l).stairs || null).concat([plan.stairs || null]);

  /** Create / rebuild / drop level shells after a plan change. `e` = the store 'plan' event (optional). */
  function syncLevels(e) {
    const list = ids(), all = !e, levelsOnly = !!(e && e.changed && e.changed.levels && !e.changed.walls && !e.changed.openings && !e.changed.rooms);
    let rebuilt = 0;
    for (const [id, rec] of [...storeys]) if (!list.includes(id)) { rec.s.group.removeFromParent(); rec.s.dispose(true); storeys.delete(id); }
    for (const id of list) {
      const keys = keysOf(id);
      let rec = storeys.get(id);
      if (!rec) { rec = { s: makeStorey(id), ...keys }; storeys.set(id, rec); if (daylight && id === GROUND) rec.s.setDaylight(daylight); rebuilt++; continue; }
      // L0 is rebuilt on every edit of its own (as always); an upper level when its data changed or the edit was on it
      const own = id === GROUND ? !levelsOnly : !!(e && e.levelId === id);
      if (all || own || keys.shell !== rec.shell) { rec.s.rebuildPlan(); rebuilt++; }
      else if (keys.roof !== rec.roof) rec.s.rebuildRoof();
      rec.shell = keys.shell; rec.roof = keys.roof;
      rec.s.group.position.y = elevationOf(id);
    }
    floorMeshes.length = 0;
    for (const id of list) floorMeshes.push(...storeys.get(id).s.floorMeshes);
    return rebuilt;
  }

  /** Visibility per level from the active level, the whole-house switch and the roof / cut-away controls. */
  function applyView() {
    const list = ids();
    const ai = view.whole ? list.length - 1 : Math.max(0, list.indexOf(view.level));
    list.forEach((id, i) => {
      const s = storeys.get(id).s;
      s.group.visible = i <= ai;
      s.setSunStudy(view.study);
      s.setDoorsOpen(view.doors);
      if (i === ai) { s.setCutaway(view.cut); s.setRoofVisible(view.roof); }
      else if (i < ai) { s.setCutaway(null); s.setRoofVisible(true); }
    });
    // hidden upper levels keep blocking the sun in the sun study (like the hidden roof of the active level)
    for (const m of [...stand.children]) stand.remove(m);
    if (view.study) list.forEach((id, i) => {
      if (i <= ai) return;
      const s = storeys.get(id).s;
      for (const g of s.shadowGeometries()) { const m = casterMesh('caster:level:' + id, g, standMat); m.position.y = elevationOf(id); stand.add(m); }
    });
  }

  syncLevels();
  applyView();

  const ground = () => storeys.get(GROUND).s;
  return {
    group,
    floorMeshes,
    /** Re-read store.project and store.finishes and refresh whatever changed. */
    update() { for (const id of ids()) storeys.get(id).s.update(); applyView(); },
    /**
     * The plan was edited in place: rebuild what derives from it — L0 on its own edits, an upper level when its data
     * changed (`e.levelId` / its arrays, heights, voids), a level's roof alone when only the level above moved.
     * @param {object} [e] the store 'plan' event
     * @returns {number} milliseconds the rebuild took
     */
    rebuildPlan(e) {
      const t0 = performance.now();
      syncLevels(e && typeof e === 'object' ? e : null);
      applyView();
      return performance.now() - t0;
    },
    setRoofVisible(v) { view.roof = !!v; applyView(); },
    setCutaway(heightCm) { view.cut = heightCm == null || !Number.isFinite(+heightCm) ? null : +heightCm; applyView(); },
    setSunStudy(v) { view.study = !!v; applyView(); },
    setDoorsOpen(v) { view.doors = !!v; applyView(); },
    /** The level shown (store.ui.level): levels above it are hidden, it follows the roof / cut-away controls. */
    setLevel(id) { const next = ids().includes(id) ? id : GROUND; if (next === view.level) return; view.level = next; applyView(); },
    /** "Show whole house": every level, the top one following the roof / cut-away controls. */
    setWholeHouse(v) { if (!!v === view.whole) return; view.whole = !!v; applyView(); },
    /** The level the view is built around (the top one while the whole house is shown). */
    viewLevel: () => { const l = ids(); return view.whole ? l[l.length - 1] : (l.includes(view.level) ? view.level : GROUND); },
    /** Levels bottom-up: { id, y (finished floor, m), wallTop (m), top (roof incl. parapet, m), visible }. */
    levels() {
      return ids().map((id) => {
        const s = storeys.get(id).s, v = viewOf(id), y = elevationOf(id), H = s.height();
        return { id, y, wallTop: y + H, top: y + H + ((v.heights.slab || 0) + (v.heights.parapet || 0)) / 100, visible: s.group.visible };
      });
    },
    /** Level id of a scene object of the house (its level group), or null. */
    levelOfObject(o) { for (let n = o; n; n = n.parent) if (n.userData && n.userData.levelId) return n.userData.levelId; return null; },
    /** Attach / detach the daylight solver — the ground level only (upper levels keep the standard lighting until F6). */
    setDaylight(dl) { daylight = dl || null; ground().setDaylight(daylight); },
    forEachInterior(fn) { ground().forEachInterior(fn); },
    setFakeShading(on) { fakeShading = !!on; ground().setFakeShading(fakeShading); },
    dispose() {
      for (const rec of storeys.values()) rec.s.dispose(true);
      storeys.clear(); floorMeshes.length = 0;
      standMat.dispose();
      disposeMaterials();
      group.clear();
    },
  };
}
