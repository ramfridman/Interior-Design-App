/**
 * The building shell in 3D, generated entirely from PLAN (cm → m; X = x/100, Z = y/100, Y up, floor at Y = 0).
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
 */
import * as THREE from 'three';
import { resolveFinish } from '../core/finishes.js';
import { pointInPolygon } from '../core/geometry.js';
import { floorMaterial, wallMaterial, surfaceMaterial, disposeMaterials } from './textures.js';
import { Soup, buildOpenings, openingFrame } from './openings.js';

const OUT = 0, WALL = 1, OPENING = 2, ROOM = 3;
const SKIRT_H = 0.07, SKIRT_T = 0.012;        // skirting board (m)
const PARAPET_T = 20;                         // parapet thickness (cm) — same as the exterior block walls
const COPING_H = 0.04, COPING_OVER = 2;       // parapet coping: 4 cm slab, 2 cm overhang (cm)
const AO_FLOOR = { width: 0.45, alpha: 0.34 }, AO_CEILING = { width: 0.4, alpha: 0.2 };   // baked contact shading strips
const WALL_FADE = 0.45;                       // height (m) of the soft darkening at the foot / head of interior walls
const PLINTH_PROUD = 0.8;                     // cm the plinth course stands proud of the render
const IDENTITY = new THREE.Matrix4();

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
function makeGrid(plan) {
  const xs = new Set(), ys = new Set();
  const rect = (r) => { xs.add(r.x); xs.add(r.x + r.w); ys.add(r.y); ys.add(r.y + r.h); };
  plan.walls.forEach(rect); plan.openings.forEach(rect);
  for (const r of plan.rooms) for (const [x, y] of r.polygon) { xs.add(x); ys.add(y); }
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
  X.unshift(X[0] - 100); X.push(X[X.length - 1] + 100); Y.unshift(Y[0] - 100); Y.push(Y[Y.length - 1] + 100);
  const nx = X.length - 1, ny = Y.length - 1;
  const kind = new Uint8Array(nx * ny), ref = new Array(nx * ny).fill(null);
  const inRect = (r, x, y) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cx = (X[i] + X[i + 1]) / 2, cy = (Y[j] + Y[j + 1]) / 2, k = j * nx + i;
    let hit;
    if (plan.walls.some((w) => inRect(w, cx, cy))) kind[k] = WALL;
    else if ((hit = plan.openings.find((o) => inRect(o, cx, cy)))) { kind[k] = OPENING; ref[k] = hit; }
    else if ((hit = plan.rooms.find((r) => pointInPolygon(cx, cy, r.polygon)))) { kind[k] = ROOM; ref[k] = hit; }
  }
  const find = (A, v) => { let lo = 0, hi = A.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (A[m] <= v) lo = m; else hi = m - 1; } return lo; };
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
      if (nKind === OUT) addFace(axis, c + s * PLINTH_PROUD, s, a0, a1, -plinthDepth, 0.012, 'plinth');   // stands 8 mm proud, laps the wall foot
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
function buildFloorSoups(grid, plan) {
  const { X, Y, nx, ny, kind, ref } = grid;
  const roomIds = new Set(plan.rooms.map((r) => r.id));
  const floors = new Map(plan.rooms.map((r) => [r.id, new Soup()]));
  const ceilings = new Map(plan.rooms.map((r) => [r.id, new Soup()]));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    let id = null;
    if (kind[k] === ROOM) id = ref[k].id;
    else if (kind[k] === OPENING && !(ref[k].sill > 0)) id = (ref[k].rooms || []).find((r) => roomIds.has(r)) || null;   // door threshold
    if (!id) continue;
    const x0 = X[i] / 100, x1 = X[i + 1] / 100, z0 = Y[j] / 100, z1 = Y[j + 1] / 100;
    const uv = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    floors.get(id).quad([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], [0, 1, 0], uv);
    if (kind[k] === ROOM) ceilings.get(id).quad([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], [0, -1, 0], uv);
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
  prism(outline, [], H, H + slab, { top: topSoup, bottom: ext });
  prism(outline, [], H - 0.015, H + slab, { side: ext });               // laps the wall head so no hairline can open at the joint
  if (parapet > 0.01) {
    const inner = insetLoop(outline, PARAPET_T), y = H + slab;
    prism(outline, [inner], y, y + parapet, { side: ext });
    prism(insetLoop(outline, -COPING_OVER), [insetLoop(outline, PARAPET_T + COPING_OVER)], y + parapet, y + parapet + COPING_H, { top: coping, bottom: coping, side: coping });
  }
  return { ext, top: topSoup, coping };
}

// ───────────────────────── public API ─────────────────────────
/**
 * Build the house shell.
 * @param {{ store, plan, catalog, models }} ctx
 * @returns {{ group: THREE.Group, update(): void, setRoofVisible(v: boolean): void, setCutaway(heightCm: number|null): void,
 *             setDoorsOpen(v: boolean): void, floorMeshes: THREE.Object3D[], dispose(): void }}
 */
export function buildHouse(ctx) {
  const { store, plan } = ctx;
  const group = new THREE.Group(); group.name = 'house';
  const shell = new THREE.Group(); shell.name = 'house-shell';
  const roof = new THREE.Group(); roof.name = 'house-roof';
  group.add(shell, roof);

  const grid = makeGrid(plan);
  const sides = openingSides(grid, plan);
  const outline = traceFootprint(grid)[0] || null;
  const dryRooms = new Set(plan.rooms.filter((r) => !r.wet).map((r) => r.id));
  const plinthDepth = (plan.heights.floorAboveGround || 15) / 100 + 0.12;

  const state = {
    H: 0, cut: null, doorsOpen: false, roofVisible: !!(store.ui && store.ui.showRoof),
    exteriorColor: null, frameColor: null,
  };
  const own = {                                                         // materials owned (and disposed) by this module
    cap: new THREE.MeshStandardMaterial({ color: '#34363b', roughness: 0.9 }),
    plinth: new THREE.MeshStandardMaterial({ color: '#cfcbc3', roughness: 0.95 }),
    skirting: new THREE.MeshStandardMaterial({ color: '#f6f4ef', roughness: 0.5 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#fbf8f2', roughness: 0.96 }),
    coping: new THREE.MeshStandardMaterial({ color: '#dcd8d0', roughness: 0.85 }),
    shade: new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  };
  const meshes = new Map();

  /** Create or refresh a named mesh from a soup. */
  function setMesh(name, soup, parent, cast, receive) {
    let mesh = meshes.get(name);
    if (!soup || soup.empty) { if (mesh) mesh.visible = false; return mesh; }
    if (!mesh) {
      mesh = new THREE.Mesh(soup.toGeometry(name.startsWith('wall:room:')), own.cap);
      mesh.name = name; meshes.set(name, mesh); parent.add(mesh);
    } else { mesh.geometry.dispose(); mesh.geometry = soup.toGeometry(name.startsWith('wall:room:')); mesh.visible = true; }
    mesh.castShadow = cast; mesh.receiveShadow = receive;
    return mesh;
  }

  const ceilingH = () => {
    const v = Number(store.project && store.project.ceilingHeight);
    return (Number.isFinite(v) && v >= 200 ? Math.min(v, 600) : plan.heights.ceiling) / 100;
  };
  const topH = () => (state.cut == null ? state.H : Math.min(state.H, state.cut));

  // floors + ceilings: geometry depends on the plan only
  const floorMeshes = [];
  const fc = buildFloorSoups(grid, plan);
  for (const room of plan.rooms) {
    const mesh = setMesh('floor:' + room.id, fc.floors.get(room.id), shell, false, true);
    if (mesh) { mesh.userData.spaceId = room.id; floorMeshes.push(mesh); }
    const ceil = setMesh('ceiling:' + room.id, fc.ceilings.get(room.id), roof, false, false);
    if (ceil) ceil.material = own.ceiling;
  }

  function rebuildShell() {
    const { soups, aoFloor, aoCeiling } = buildShellSoups(grid, plan, sides, topH(), state.H, plinthDepth, dryRooms);
    for (const [name, strips, parent] of [['ao:floor', aoFloor, shell], ['ao:ceiling', aoCeiling, roof]]) {
      const mesh = setMesh(name, strips.idx.length ? { empty: false, toGeometry: () => strips.toGeometry() } : null, parent, false, false);
      if (mesh) { mesh.material = own.shade; mesh.renderOrder = 1; }
    }
    for (const key of new Set([...soups.keys(), ...[...meshes.keys()].filter((n) => n.startsWith('wall:')).map((n) => n.slice(5))])) {
      const mesh = setMesh('wall:' + key, soups.get(key), shell, true, true);
      if (mesh && key === 'skirting') mesh.castShadow = false;
    }
  }
  function rebuildRoof() {
    const r = buildRoofSoups(outline, state.H, (plan.heights.slab || 20) / 100, (plan.heights.parapet || 0) / 100);
    setMesh('roof:ext', r.ext, roof, true, true);
    setMesh('roof:top', r.top, roof, true, true);
    setMesh('roof:coping', r.coping, roof, true, true);
    for (const room of plan.rooms) { const c = meshes.get('ceiling:' + room.id); if (c) c.position.y = state.H - 0.002; }
  }
  const openingOpts = () => ({ ceilingH: state.H, cutH: state.cut == null ? null : topH(), doorsOpen: state.doorsOpen, frameColor: state.frameColor });

  function applyMaterials() {
    const p = store.project || {};
    const exterior = surfaceMaterial('render', { color: p.exteriorColor || '#efece6' });
    own.plinth.color.set(p.exteriorColor || '#efece6').multiplyScalar(0.8);
    const assign = (name, material) => { const m = meshes.get(name); if (m) m.material = material; };
    assign('wall:ext', exterior); assign('roof:ext', exterior);
    assign('wall:plinth', own.plinth); assign('wall:cap', own.cap); assign('wall:skirting', own.skirting);
    assign('roof:top', surfaceMaterial('roof')); assign('roof:coping', own.coping);
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
  };

  state.H = ceilingH();
  state.frameColor = (store.project && store.project.frameColor) || '#2b2d31';
  rebuildShell(); rebuildRoof();
  const openings = buildOpenings(plan, openingOpts());
  shell.add(openings.group);
  applyMaterials(); applyRoofVisibility();

  return {
    group,
    floorMeshes,
    /** Re-read store.project and store.finishes and refresh whatever changed. */
    update() {
      const H = ceilingH();
      if (H !== state.H) { state.H = H; rebuildShell(); rebuildRoof(); openings.rebuild(openingOpts()); }
      applyMaterials();
    },
    /** Show / hide roof slab, parapet and room ceilings (always hidden while a cutaway is active). */
    setRoofVisible(v) { state.roofVisible = !!v; applyRoofVisibility(); },
    /** Limit wall / window / door heights (cm above the floor) for a dollhouse view; null restores full height. */
    setCutaway(heightCm) {
      const cut = heightCm == null || !Number.isFinite(+heightCm) ? null : Math.max(0.1, +heightCm / 100);
      if (cut === state.cut) return;
      state.cut = cut;
      rebuildShell(); openings.rebuild(openingOpts()); applyMaterials(); applyRoofVisibility();
    },
    /** Open (≈ 85°, on the hinge, towards `swing`) or close all hinged doors; the terrace slider parks half open. */
    setDoorsOpen(v) {
      if (!!v === state.doorsOpen) return;
      state.doorsOpen = !!v;
      openings.rebuild(openingOpts());
    },
    dispose() {
      for (const mesh of meshes.values()) mesh.geometry.dispose();
      meshes.clear(); floorMeshes.length = 0;
      openings.dispose();
      Object.values(own).forEach((m) => m.dispose());
      disposeMaterials();
      group.clear();
    },
  };
}
