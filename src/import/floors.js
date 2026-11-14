/**
 * Several floors from sketches (stage F8 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md; docs/CONTRACT.md § 12 "Several floors
 * in the import dialog"). Pure logic on the reader's results (`normalise` output: plan cm of each drawing, origin at its
 * rectangles' north-west corner) — no DOM, runs in a worker or Node.
 *
 *   floorFootprint(result)                     → the floor's outline (outer rings), wall faces, rect pieces
 *   alignFloors(lower, upper, opts)            → { rot, dx, dy, confidence, text, sides, overlap, warnings, … }
 *   placeFloor(result, rot)                    → the floor turned by `rot` (clockwise) about its own north-west corner
 *   detectStairSymbols(prims, result, opts)    → straight stairs drawn as runs of tread lines inside a rectangle
 *   detectVoidSymbols(prims, result, opts)     → rectangles with a cross or "void" / "חלל" text
 *   matchStairs(lowerStairs, upperMarks)       → which upper void / stair belongs to which lower stair, walking direction
 *   stairCandidates(stair, { rise, level })    → addStair inputs to try (the engine decides: proposeStair + canAddStair)
 *   levelsInput(floors, { meta, heights })     → buildPlan input with `levels` (each floor moved by its alignment)
 *
 * Coordinates: plan cm, +x east, +y south. `rot` is clockwise in 90° steps, as `normalise({ rotate })`: (x, y) → (−y, x).
 */
import { union, intersectArea } from '../core/polykernel.js';
import { joinSlants } from '../core/slant-geom.js';
import { proposeStair, stairGeometry } from '../core/stairs.js';

const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const ROTS = { 0: [1, 0, 0, 1], 90: [0, 1, -1, 0], 180: [-1, 0, 0, -1], 270: [0, -1, 1, 0] };   // [a b c d]: X = a·x + c·y, Y = b·x + d·y
const rotPt = (p, rot) => { const r = ROTS[((rot % 360) + 360) % 360]; return [r[0] * p[0] + r[2] * p[1], r[1] * p[0] + r[3] * p[1]]; };
const dirOf = (v) => (Math.abs(v[0]) > Math.abs(v[1]) ? (v[0] > 0 ? 'e' : 'w') : (v[1] > 0 ? 's' : 'n'));
const r2 = (v) => Math.round(v * 100) / 100;
const AX = 1e-6;

// ───────────────────────────── footprints ─────────────────────────────
const rectRing = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
const slantsOf = (r) => (r && Array.isArray(r.slants) ? r.slants : []);
function bboxOfPts(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}
/** Edges of rings with their outward normal (outer rings are clockwise on screen: the inside is on the right). */
function ringEdges(rings) {
  const out = [];
  for (const R of rings) {
    for (let i = 0; i < R.length; i++) {
      const p = R[i], q = R[(i + 1) % R.length], dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
      if (L < AX) continue;
      out.push({ p, q, n: [dy / L, -dx / L], len: L });
    }
  }
  return out;
}
/**
 * A floor's outline: the union of its walls, openings (so door gaps do not break the outline) and angled walls, with
 * every hole filled. `rings` (outer rings, clockwise), `edges` (outline edges + outward normal), `faces` (every face of
 * every wall piece, both sides — an upper wall standing on a lower partition counts), `box` (the rectangles' bounding box:
 * the origin `normalise` uses), `area` (cm²).
 */
export function floorFootprint(r) {
  const walls = (r && r.walls) || [];
  const rects = walls.map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h }));
  const ops = ((r && r.openings) || []).filter((o) => o.axis !== 'a' && Number.isFinite(o.x) && o.w > 0 && o.h > 0).map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
  let slantPolys = [];
  if (slantsOf(r).length) { try { slantPolys = joinSlants(slantsOf(r), rects).map((q) => q.poly).filter(Boolean); } catch (e) { slantPolys = []; } }
  const shapes = [...rects.map(rectRing), ...ops.map(rectRing), ...slantPolys];
  const u = shapes.length ? union(shapes) : [];
  const filled = u.length ? union(u.map((e) => e.outer)) : [];
  const rings = filled.map((e) => e.outer);
  const faces = [];
  for (const w of rects) faces.push(...ringEdges([rectRing(w)]));
  for (const P of slantPolys) faces.push(...ringEdges([P]).map(fixNormal(P)));
  const b = bboxOfPts(rects.flatMap(rectRing)) || bboxOfPts(rings.flat()) || { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { rings, edges: ringEdges(rings), faces, box: b, area: rings.reduce((t, R) => t + Math.abs(signedArea(R)), 0), rects };
}
const signedArea = (R) => { let a = 0; for (let i = 0; i < R.length; i++) { const p = R[i], q = R[(i + 1) % R.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
/** Outward normals of a polygon whatever its orientation. */
const fixNormal = (P) => { const cw = signedArea(P) > 0; return (e) => (cw ? e : { ...e, n: [-e.n[0], -e.n[1]] }); };

/** Turn a footprint (and marks) by `rot` about the origin, then move its rectangles' north-west corner to (0, 0). */
function turned(fp, marks, rot) {
  const R = (p) => rotPt(p, rot);
  const box0 = fp.box, corners = [[box0.x0, box0.y0], [box0.x1, box0.y1]].map(R);
  const ox = Math.min(corners[0][0], corners[1][0]), oy = Math.min(corners[0][1], corners[1][1]);
  const T = (p) => { const q = R(p); return [q[0] - ox, q[1] - oy]; };
  const Tv = (v) => R(v);
  const edge = (e) => ({ p: T(e.p), q: T(e.q), n: Tv(e.n), len: e.len });
  const rings = fp.rings.map((ring) => ring.map(T));
  const markRect = (m) => { const a = T([m.x, m.y]), b = T([m.x + m.w, m.y + m.h]); return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }; };
  const bx = bboxOfPts(rings.flat()) || { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { rot, rings, edges: fp.edges.map(edge), faces: fp.faces.map(edge), slabs: slabsOf(rings), box: bx, area: fp.area, marks: (marks || []).map(markRect) };
}
/** Disjoint rectangles of rings that are all axis-parallel (even–odd per horizontal slab), else null. */
function slabsOf(rings) {
  const ys = new Set(), vert = [];
  for (const R of rings) for (let i = 0; i < R.length; i++) {
    const p = R[i], q = R[(i + 1) % R.length];
    if (Math.abs(p[0] - q[0]) > 1e-6 && Math.abs(p[1] - q[1]) > 1e-6) return null;
    ys.add(p[1]);
    if (Math.abs(p[1] - q[1]) > 1e-6) vert.push([p[0], Math.min(p[1], q[1]), Math.max(p[1], q[1])]);
  }
  const Y = [...ys].sort((a, b) => a - b), out = [];
  for (let i = 0; i + 1 < Y.length; i++) {
    const y0 = Y[i], y1 = Y[i + 1], ym = (y0 + y1) / 2;
    const xs = vert.filter((v) => v[1] < ym && v[2] > ym).map((v) => v[0]).sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] > xs[k]) out.push([xs[k], y0, xs[k + 1], y1]);
  }
  return out;
}
const ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
function overlapArea(L, U, dx, dy) {
  if (L.slabs && U.slabs) {
    let s = 0;
    for (const a of L.slabs) for (const b of U.slabs) { const w = ov(a[0], a[2], b[0] + dx, b[2] + dx); if (w > 0) s += w * ov(a[1], a[3], b[1] + dy, b[3] + dy); }
    return s;
  }
  return intersectArea(L.rings, U.rings.map((R) => R.map(([x, y]) => [x + dx, y + dy])));
}
function markBonus(L, U, dx, dy) {
  let s = 0;
  for (const a of L.marks) for (const b of U.marks) s += ov(a.x, a.x + a.w, b.x + dx, b.x + b.w + dx) * ov(a.y, a.y + a.h, b.y + dy, b.y + b.h + dy);
  return s;
}
/**
 * Coinciding faces: upper outline edges lying on a lower wall face with the same outward direction (within `tol`).
 * Returns { weighted (length × closeness), byDir: { n|e|s|w: { len, on } } } — `on` counts faces within 1 cm.
 */
function coincide(L, U, dx, dy, tol = 1.5) {
  let weighted = 0;
  const byDir = { n: { len: 0, on: 0 }, e: { len: 0, on: 0 }, s: { len: 0, on: 0 }, w: { len: 0, on: 0 } };
  for (const e of U.edges) {
    const horiz = Math.abs(e.p[1] - e.q[1]) < 1e-6, vert = Math.abs(e.p[0] - e.q[0]) < 1e-6;
    const d = dirOf(e.n);
    byDir[d].len += e.len;
    if (!horiz && !vert) continue;
    const c = horiz ? e.p[1] + dy : e.p[0] + dx;
    const a0 = horiz ? Math.min(e.p[0], e.q[0]) + dx : Math.min(e.p[1], e.q[1]) + dy, a1 = horiz ? Math.max(e.p[0], e.q[0]) + dx : Math.max(e.p[1], e.q[1]) + dy;
    // coverage by lower faces facing the same way: weighted by closeness (for the search), and within 1 cm (for the read-out)
    const iv = [];
    let wsum = 0;
    for (const f of L.faces) {
      if (f.n[0] * e.n[0] + f.n[1] * e.n[1] < 0.99) continue;
      const fh = Math.abs(f.p[1] - f.q[1]) < 1e-6;
      if (fh !== horiz) continue;
      const fc = horiz ? f.p[1] : f.p[0], dist = Math.abs(fc - c);
      if (dist > tol) continue;
      const b0 = horiz ? Math.min(f.p[0], f.q[0]) : Math.min(f.p[1], f.q[1]), b1 = horiz ? Math.max(f.p[0], f.q[0]) : Math.max(f.p[1], f.q[1]);
      const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
      if (hi <= lo) continue;
      if (dist <= 1) iv.push([lo, hi]);
      wsum += (hi - lo) * (1 - dist / tol);
    }
    weighted += Math.min(e.len, wsum);
    if (iv.length) byDir[d].on += Math.min(e.len, mergedLen(iv));
  }
  return { weighted, byDir };
}
const FACE_W = 20;          // cm² of score per cm of coinciding outer face
const ROT_PRIOR = 0.99;     // a turned floor must fit clearly better than the floor as drawn
function scoreOf(L, U, dx, dy) {
  const area = overlapArea(L, U, dx, dy), c = coincide(L, U, dx, dy), marks = markBonus(L, U, dx, dy);
  const raw = area + FACE_W * c.weighted + marks;
  return { raw, score: raw * (U.rot ? ROT_PRIOR : 1) - 1e-4 * Math.hypot(dx, dy), area, faces: c, marks };
}

/**
 * Position the upper floor over the lower one. Both are `normalise` results (or { walls, openings, slants? }) in their own
 * plan cm. Options: `rotations` (default [0, 90, 180, 270]; pass [0] when the user set this floor's orientation),
 * `lowerMarks` / `upperMarks` (rects of stairs / voids found on each drawing — a matching stair well is strong evidence).
 * Search: aligned north-west corners, centroids, bounding-box sides and every pair of outline corners; the best few
 * refined within ± 50 cm at 5 cm, then ± 5 cm at 1 cm. Score = overlap area of the outlines + 20 cm² per cm of coinciding
 * outer wall face + the overlap of matching marks; a turn needs a 1 % better fit than the floor as drawn.
 * @returns {{ rot, dx, dy, score, overlap (0–1 of the upper floor), sides: { n, e, s, w: { overhang (cm, + = sticks out,
 *   − = set back), coincide: bool } }, coinciding, of, confidence: 'high' | 'medium' | 'low', text, notes: string[],
 *   warnings: string[], ambiguous: { translation: bool, rotation: number | null } }}
 */
export function alignFloors(lower, upper, { rotations = [0, 90, 180, 270], lowerMarks = [], upperMarks = [] } = {}) {
  const lf = floorFootprint(lower), uf = floorFootprint(upper);
  const L = { ...turned(lf, lowerMarks, 0) };
  if (!L.rings.length || !uf.rings.length) return { rot: 0, dx: 0, dy: 0, score: 0, overlap: 0, sides: null, coinciding: 0, of: 0, confidence: 'low', text: 'One of the floors has no walls to line up.', notes: [], warnings: [], ambiguous: { translation: false, rotation: null } };
  const lv = L.rings.flat(), lc = centroid(L.rings);
  const all = [];
  for (const rot of rotations) {
    const U = turned(uf, upperMarks, rot);
    const seen = new Set(), cand = [];
    const add = (dx, dy) => { const k = Math.round(dx) + ',' + Math.round(dy); if (seen.has(k)) return; seen.add(k); cand.push([dx, dy]); };
    add(L.box.x0 - U.box.x0, L.box.y0 - U.box.y0);
    const uc = centroid(U.rings); add(lc[0] - uc[0], lc[1] - uc[1]);
    for (const sx of ['x0', 'x1']) for (const sy of ['y0', 'y1']) add(L.box[sx] - U.box[sx], L.box[sy] - U.box[sy]);
    const uv = U.rings.flat();
    if (lv.length * uv.length <= 4000) for (const p of lv) for (const q of uv) add(p[0] - q[0], p[1] - q[1]);
    const scored = cand.map(([dx, dy]) => ({ dx, dy, ...scoreOf(L, U, dx, dy) })).sort((a, b) => b.score - a.score);
    // the best few distinct starts, refined coarse to fine
    const starts = [];
    for (const c of scored) { if (starts.length >= 6) break; if (starts.every((s) => Math.hypot(s.dx - c.dx, s.dy - c.dy) > 20)) starts.push(c); }
    for (const s0 of starts) {
      let best = s0;
      for (const [span, step] of [[50, 5], [5, 1]]) {
        const cx = best.dx, cy = best.dy;
        for (let i = -span; i <= span + 1e-9; i += step) for (let j = -span; j <= span + 1e-9; j += step) {
          if (!i && !j) continue;
          const sc = scoreOf(L, U, cx + i, cy + j);
          if (sc.score > best.score + 1e-9) best = { dx: cx + i, dy: cy + j, ...sc };
        }
      }
      all.push({ rot, U, ...best });
    }
  }
  all.sort((a, b) => b.score - a.score);
  const best = all[0];
  // ambiguity: another position of the same turn, or another turn, fitting (almost) as well
  const sameRot = all.filter((c) => c.rot === best.rot && Math.hypot(c.dx - best.dx, c.dy - best.dy) > 20);
  const transAmb = sameRot.some((c) => c.raw >= 0.98 * best.raw);
  const otherRot = all.filter((c) => c.rot !== best.rot).sort((a, b) => b.raw - a.raw)[0];
  const rotAmb = otherRot && otherRot.raw >= 0.995 * best.raw ? (otherRot.rot - best.rot + 360) % 360 : null;
  // read-out
  const U = best.U, ub = { x0: U.box.x0 + best.dx, y0: U.box.y0 + best.dy, x1: U.box.x1 + best.dx, y1: U.box.y1 + best.dy }, lb = L.box;
  const fp = coincide(L, U, best.dx, best.dy);
  const sides = {};
  const over = { n: lb.y0 - ub.y0, s: ub.y1 - lb.y1, w: lb.x0 - ub.x0, e: ub.x1 - lb.x1 };
  let coinciding = 0, of = 0;
  for (const d of ['n', 'e', 's', 'w']) {
    const c = fp.byDir[d], on = c.len > 0 && c.on >= 0.5 * c.len;
    if (c.len > 0) of++;
    if (on) coinciding++;
    sides[d] = { overhang: r2(over[d]), coincide: on };
  }
  const overlap = U.area > 0 ? best.area / U.area : 0;
  const warnings = [], notes = [];
  const NAMES = { n: 'north', e: 'east', s: 'south', w: 'west' };
  for (const d of ['n', 'e', 's', 'w']) if (sides[d].overhang > 150) warnings.push(`The upper floor sticks out ${Math.round(sides[d].overhang)} cm beyond the floor below on the ${NAMES[d]} side — check the alignment.`);
  if (overlap < 0.3) warnings.push(`The upper floor overlaps the floor below by only ${Math.round(overlap * 100)} % — check the alignment.`);
  if (transAmb) notes.push('Another position fits the outline about as well — check the alignment against a stair or a shaft.');
  if (rotAmb != null) notes.push(`The outline also fits turned by ${rotAmb}°; ${best.rot ? `turned by ${best.rot}°` : 'kept as drawn'} — check the stair or the inner walls.`);
  if (best.rot) notes.push(`The upper drawing was turned by ${best.rot}° clockwise to fit.`);
  const confidence = transAmb || coinciding <= 1 || overlap < 0.3 ? 'low' : rotAmb != null || coinciding === 2 ? 'medium' : 'high';
  const text = `Outer walls coincide on ${coinciding} of ${of} sides`;
  return { rot: best.rot, dx: r2(best.dx), dy: r2(best.dy), score: best.score, overlap: r2(overlap), sides, coinciding, of, confidence, text, notes, warnings,
    ambiguous: { translation: transAmb, rotation: rotAmb } };
}
function centroid(rings) {
  let A = 0, cx = 0, cy = 0;
  for (const R of rings) for (let i = 0; i < R.length; i++) { const p = R[i], q = R[(i + 1) % R.length], c = p[0] * q[1] - q[0] * p[1]; A += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; }
  return Math.abs(A) > 1e-9 ? [cx / (3 * A), cy / (3 * A)] : [0, 0];
}

/** Read-out of a given position (manual alignment): the same sides / overlap / warnings as alignFloors. */
export function alignmentReport(lower, upper, { rot = 0, dx = 0, dy = 0, lowerMarks = [], upperMarks = [] } = {}) {
  const L = turned(floorFootprint(lower), lowerMarks, 0), U = turned(floorFootprint(upper), upperMarks, rot);
  if (!L.rings.length || !U.rings.length) return { rot, dx, dy, overlap: 0, sides: null, coinciding: 0, of: 0, warnings: [], text: 'One of the floors has no walls to line up.', confidence: 'low', notes: [] };
  const fp = coincide(L, U, dx, dy), area = overlapArea(L, U, dx, dy);
  const ub = { x0: U.box.x0 + dx, y0: U.box.y0 + dy, x1: U.box.x1 + dx, y1: U.box.y1 + dy }, lb = L.box;
  const over = { n: lb.y0 - ub.y0, s: ub.y1 - lb.y1, w: lb.x0 - ub.x0, e: ub.x1 - lb.x1 };
  const sides = {}, NAMES = { n: 'north', e: 'east', s: 'south', w: 'west' }, warnings = [];
  let coinciding = 0, of = 0;
  for (const d of ['n', 'e', 's', 'w']) {
    const c = fp.byDir[d], on = c.len > 0 && c.on >= 0.5 * c.len;
    if (c.len > 0) of++;
    if (on) coinciding++;
    sides[d] = { overhang: r2(over[d]), coincide: on };
    if (over[d] > 150) warnings.push(`The upper floor sticks out ${Math.round(over[d])} cm beyond the floor below on the ${NAMES[d]} side — check the alignment.`);
  }
  const overlap = U.area > 0 ? area / U.area : 0;
  if (overlap < 0.3) warnings.push(`The upper floor overlaps the floor below by only ${Math.round(overlap * 100)} % — check the alignment.`);
  return { rot, dx, dy, overlap: r2(overlap), sides, coinciding, of, warnings, text: `Outer walls coincide on ${coinciding} of ${of} sides`,
    confidence: coinciding >= 3 && overlap >= 0.3 ? 'high' : coinciding === 2 && overlap >= 0.3 ? 'medium' : 'low', notes: [] };
}

/**
 * Wall faces near a point for snapping the dragged upper floor (manual alignment): the nearest translation that puts an
 * upper outline edge on a lower face of the same direction within `radius` cm, per axis. → { dx, dy } corrections (0 = none).
 */
export function snapFaces(lower, upper, { rot = 0, dx = 0, dy = 0, radius = 12 } = {}) {
  const L = turned(floorFootprint(lower), [], 0), U = turned(floorFootprint(upper), [], rot);
  let bx = null, by = null;
  for (const e of U.edges) {
    const horiz = Math.abs(e.p[1] - e.q[1]) < 1e-6, vert = Math.abs(e.p[0] - e.q[0]) < 1e-6;
    if (!horiz && !vert) continue;
    for (const f of L.faces) {
      if (f.n[0] * e.n[0] + f.n[1] * e.n[1] < 0.99) continue;
      const fh = Math.abs(f.p[1] - f.q[1]) < 1e-6;
      if (fh !== horiz) continue;
      const a0 = horiz ? Math.min(e.p[0], e.q[0]) + dx : Math.min(e.p[1], e.q[1]) + dy, a1 = horiz ? Math.max(e.p[0], e.q[0]) + dx : Math.max(e.p[1], e.q[1]) + dy;
      const b0 = horiz ? Math.min(f.p[0], f.q[0]) : Math.min(f.p[1], f.q[1]), b1 = horiz ? Math.max(f.p[0], f.q[0]) : Math.max(f.p[1], f.q[1]);
      if (Math.min(a1, b1) - Math.max(a0, b0) <= 0) continue;
      const d = horiz ? f.p[1] - (e.p[1] + dy) : f.p[0] - (e.p[0] + dx);
      if (Math.abs(d) > radius) continue;
      if (horiz) { if (by == null || Math.abs(d) < Math.abs(by)) by = d; } else if (bx == null || Math.abs(d) < Math.abs(bx)) bx = d;
    }
  }
  return { dx: bx || 0, dy: by || 0, x: bx != null, y: by != null };
}

/**
 * The floor turned by `rot` (clockwise) about its own rectangles' north-west corner, moved back to (0, 0) — the same frame
 * `normalise({ rotate: before + rot })` gives (rectangles not re-cut). For previews; the import re-reads the drawing.
 */
export function placeFloor(r, rot = 0, dx = 0, dy = 0) {
  const fp = floorFootprint(r);
  const box = fp.box, cs = [[box.x0, box.y0], [box.x1, box.y1]].map((p) => rotPt(p, rot));
  const ox = Math.min(cs[0][0], cs[1][0]) - dx, oy = Math.min(cs[0][1], cs[1][1]) - dy;
  const T = (p) => { const q = rotPt(p, rot); return [q[0] - ox, q[1] - oy]; };
  const rect = (w) => { const a = T([w.x, w.y]), b = T([w.x + w.w, w.y + w.h]); return { ...w, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }; };
  return {
    walls: ((r && r.walls) || []).map(rect),
    openings: ((r && r.openings) || []).filter((o) => o.axis !== 'a').map(rect),
    slants: slantsOf(r).map((s) => { const a = T([s.x1, s.y1]), b = T([s.x2, s.y2]); return { ...s, x1: a[0], y1: a[1], x2: b[0], y2: b[1] }; }),
    outline: fp.rings.map((R) => R.map(T)),
    /** plan point of the floor's own frame → the placed frame */
    map: T,
  };
}

// ───────────────────────────── stair and void symbols ─────────────────────────────
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** Straight segments of the drawing in plan cm (the result's page → plan transform), inside `box` (plan cm) when given. */
function planSegments(prims, T, box, pad = 60) {
  const segs = [];
  const inside = (x, y) => !box || (x >= box.x0 - pad && x <= box.x1 + pad && y >= box.y0 - pad && y <= box.y1 + pad);
  for (const p of (prims && prims.paths) || []) {
    if (p.curved || p.stroke === false) continue;
    const pts = p.pts, n = pts.length / 2;
    if (n < 2) continue;
    const P = [];
    for (let i = 0; i < pts.length; i += 2) P.push(apply(T, pts[i], pts[i + 1]));
    const m = p.closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = P[i], b = P[(i + 1) % n];
      if (!inside(a[0], a[1]) && !inside(b[0], b[1])) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) continue;
      const ang = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI) % 180;
      const o = ang < 2 || ang > 178 ? 'h' : Math.abs(ang - 90) < 2 ? 'v' : null;
      segs.push({ a, b, len, o, path: p, npts: n, closed: !!p.closed, P });
    }
  }
  return segs;
}
function wallsBox(r) {
  const pts = [];
  for (const w of (r && r.walls) || []) pts.push([w.x, w.y], [w.x + w.w, w.y + w.h]);
  for (const s of slantsOf(r)) pts.push([s.x1, s.y1], [s.x2, s.y2]);
  return bboxOfPts(pts);
}
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const UP_TEXT = /^(up|u\.?p\.?|עולה|עליה|עלייה)$/i, DOWN_TEXT = /^(dn|down|יורד|ירידה)$/i;
const VOID_TEXT = /(^|\s)(void|open(\s+to\s+below)?|חלל|פתוח)(\s|$)/i;

/**
 * Straight stairs drawn on a floor plan: a run of ≥ 6 parallel, equally spaced (22–32 cm, ± 1.5 cm) short lines (60–160 cm,
 * the treads) of equal extent, closed on both long sides by a line or a wall face (the stair's rectangle). A long hatch
 * (lines over 160 cm), fewer than 6 lines, uneven spacing or more than 30 lines is not a stair. The walking direction
 * comes from an arrow head (its tip at the top end) or "UP" / "עולה" text near the bottom end; else `up` is null.
 * @param prims  the drawing (readPdf / readDxf primitives — the same the result was read from)
 * @param r      the reader's result for this floor (`transform`: page → plan cm, `walls`)
 * @returns {Array<{ x, y, w, h (plan cm, the drawn footprint), axis: 'v' | 'h' (the run's direction), up: 'n'|'s'|'e'|'w'|null,
 *   lines, going (cm, median spacing), width (cm), evidence: string[], confidence }>}
 */
export function detectStairSymbols(prims, r, opts = {}) {
  if (!r || !Array.isArray(r.transform)) return [];
  const box = wallsBox(r);
  const segs = planSegments(prims, r.transform, box, 0);
  const minLen = opts.minLen || 55, maxLen = opts.maxLen || 160, minSp = 22, maxSp = 32, tolSp = 1.5, minLines = opts.minLines || 6, maxLines = 30;
  const texts = ((prims && prims.texts) || []).map((t) => ({ str: String(t.str || '').trim(), p: apply(r.transform, t.x + (t.w || 0) / 2, t.y - (t.h || 0) / 2) }));
  const arrows = arrowHeads(segs);
  const out = [];
  for (const o of ['h', 'v']) {
    // treads of orientation o: the run goes across them (o 'h' → run along y)
    const tr = segs.filter((s) => s.o === o && s.len >= minLen && s.len <= maxLen).map((s) => {
      const c = o === 'h' ? (s.a[1] + s.b[1]) / 2 : (s.a[0] + s.b[0]) / 2;
      const a0 = o === 'h' ? Math.min(s.a[0], s.b[0]) : Math.min(s.a[1], s.b[1]), a1 = o === 'h' ? Math.max(s.a[0], s.b[0]) : Math.max(s.a[1], s.b[1]);
      return { c, a0, a1 };
    }).sort((p, q) => p.a0 - q.a0 || p.c - q.c);
    // groups of equal extent (± 3 cm)
    const groups = [];
    for (const t of tr) {
      const g = groups.find((G) => Math.abs(G.a0 - t.a0) <= 3 && Math.abs(G.a1 - t.a1) <= 3);
      if (g) g.list.push(t); else groups.push({ a0: t.a0, a1: t.a1, list: [t] });
    }
    for (const g of groups) {
      const cs = [];
      for (const t of g.list.sort((p, q) => p.c - q.c)) if (!cs.length || t.c - cs[cs.length - 1] > 1) cs.push(t.c);   // double lines → one
      // maximal runs of near-equal spacing
      let i = 0;
      while (i < cs.length - 1) {
        let j = i + 1;
        const sp0 = cs[j] - cs[i];
        if (sp0 < minSp - tolSp || sp0 > maxSp + tolSp) { i++; continue; }
        const gaps = [sp0];
        while (j + 1 < cs.length) { const sp = cs[j + 1] - cs[j]; if (Math.abs(sp - median(gaps)) > tolSp || sp < minSp - tolSp || sp > maxSp + tolSp) break; gaps.push(sp); j++; }
        const n = j - i + 1;
        if (n >= minLines && n <= maxLines) {
          const c0 = cs[i], c1 = cs[j], a0 = g.a0, a1 = g.a1;
          const sides = sideLines(segs, r, o, a0, a1, c0, c1);
          if (sides.ok) {
            const rect = o === 'h' ? { x: a0, y: c0, w: a1 - a0, h: c1 - c0 } : { x: c0, y: a0, w: c1 - c0, h: a1 - a0 };
            const axis = o === 'h' ? 'v' : 'h';
            const ev = [`${n} tread lines ${median(gaps).toFixed(1)} cm apart`, sides.how];
            const up = upDirection(rect, axis, arrows, texts, ev);
            out.push({ ...mapRect(rect, r2), axis, up, lines: n, going: r2(median(gaps)), width: r2(a1 - a0), evidence: ev, confidence: up ? 0.8 : 0.6 });
          }
        }
        i = n >= minLines ? j : i + 1;
      }
    }
  }
  // overlapping finds (a run cut in two by a landing line): keep the larger
  out.sort((a, b) => b.lines - a.lines);
  return out.filter((s, k) => !out.slice(0, k).some((t) => ov(s.x, s.x + s.w, t.x, t.x + t.w) * ov(s.y, s.y + s.h, t.y, t.y + t.h) > 0.5 * Math.min(s.w * s.h, t.w * t.h)));
}
const mapRect = (r, f) => ({ x: f(r.x), y: f(r.y), w: f(r.w), h: f(r.h) });
/** Both long sides of a tread run closed by a drawn line or a wall face (≥ 70 % of the run). */
function sideLines(segs, r, o, a0, a1, c0, c1) {
  const span = c1 - c0, need = 0.7 * span;
  const cover = (pos) => {
    // lines parallel to the run (orientation opposite to the treads) at `pos` (± 3 cm)
    let best = 0, how = null;
    const po = o === 'h' ? 'v' : 'h';
    const iv = [];
    for (const s of segs) {
      if (s.o !== po) continue;
      const c = po === 'v' ? (s.a[0] + s.b[0]) / 2 : (s.a[1] + s.b[1]) / 2;
      if (Math.abs(c - pos) > 3) continue;
      const b0 = po === 'v' ? Math.min(s.a[1], s.b[1]) : Math.min(s.a[0], s.b[0]), b1 = po === 'v' ? Math.max(s.a[1], s.b[1]) : Math.max(s.a[0], s.b[0]);
      const lo = Math.max(b0, c0), hi = Math.min(b1, c1);
      if (hi > lo) iv.push([lo, hi]);
    }
    best = mergedLen(iv); if (best >= need) how = 'line';
    if (!how) {
      // a wall face: a wall rectangle whose side lies at pos
      const wv = [];
      for (const w of (r && r.walls) || []) {
        const faces = po === 'v' ? [w.x, w.x + w.w] : [w.y, w.y + w.h];
        if (!faces.some((f) => Math.abs(f - pos) <= 3)) continue;
        const b0 = po === 'v' ? w.y : w.x, b1 = po === 'v' ? w.y + w.h : w.x + w.w;
        const lo = Math.max(b0, c0), hi = Math.min(b1, c1);
        if (hi > lo) wv.push([lo, hi]);
      }
      if (mergedLen(wv) >= need) how = 'wall';
    }
    return how;
  };
  const s0 = cover(a0), s1 = cover(a1);
  return { ok: !!(s0 && s1), how: s0 === 'wall' || s1 === 'wall' ? 'closed by a line and a wall' : 'inside a drawn rectangle' };
}
function mergedLen(iv) {
  iv.sort((p, q) => p[0] - q[0]);
  let t = 0, cur = null;
  for (const v of iv) { if (cur && v[0] <= cur[1]) cur[1] = Math.max(cur[1], v[1]); else { if (cur) t += cur[1] - cur[0]; cur = v.slice(); } }
  return cur ? t + cur[1] - cur[0] : t;
}
/** Arrow heads: an open polyline of 3 points (a "V"), a closed triangle, or two short lines meeting at a point → { tip, dir }. */
function arrowHeads(segs) {
  const out = [];
  const head = (tip, l1, l2) => {
    const a = [l1[0] - tip[0], l1[1] - tip[1]], b = [l2[0] - tip[0], l2[1] - tip[1]], la = Math.hypot(...a), lb = Math.hypot(...b);
    if (la < 3 || lb < 3 || la > 60 || lb > 60) return;
    const cos = (a[0] * b[0] + a[1] * b[1]) / (la * lb);
    if (cos < Math.cos(150 * Math.PI / 180) || cos > Math.cos(15 * Math.PI / 180)) return;
    const m = [-(a[0] / la + b[0] / lb), -(a[1] / la + b[1] / lb)], lm = Math.hypot(...m);
    if (lm < 1e-6) return;
    out.push({ tip, dir: [m[0] / lm, m[1] / lm] });
  };
  const paths = new Set();
  for (const s of segs) {
    if (paths.has(s.path)) continue;
    paths.add(s.path);
    const P = s.P;
    if (!s.closed && s.npts === 3) head(P[1], P[0], P[2]);
    else if (s.closed && s.npts === 3) {
      // the tip is the vertex opposite the shortest side
      const L = [0, 1, 2].map((i) => Math.hypot(P[(i + 1) % 3][0] - P[(i + 2) % 3][0], P[(i + 1) % 3][1] - P[(i + 2) % 3][1]));
      const k = L.indexOf(Math.min(...L));
      head(P[k], P[(k + 1) % 3], P[(k + 2) % 3]);
    }
  }
  // two separate short lines sharing an end
  const shorts = segs.filter((s) => s.npts === 2 && s.len >= 3 && s.len <= 60 && !s.o);
  for (let i = 0; i < shorts.length; i++) for (let j = i + 1; j < shorts.length; j++) {
    const A = shorts[i], B = shorts[j];
    for (const [p, pa] of [[A.a, A.b], [A.b, A.a]]) for (const [q, qb] of [[B.a, B.b], [B.b, B.a]]) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 1) head(p, pa, qb);
  }
  return out;
}
function upDirection(rect, axis, arrows, texts, ev) {
  const inR = (p, pad = 5) => p[0] >= rect.x - pad && p[0] <= rect.x + rect.w + pad && p[1] >= rect.y - pad && p[1] <= rect.y + rect.h + pad;
  const along = axis === 'v' ? [0, 1] : [1, 0];
  for (const a of arrows) {
    if (!inR(a.tip)) continue;
    const d = a.dir[0] * along[0] + a.dir[1] * along[1];
    if (Math.abs(d) < 0.8) continue;
    ev.push('an arrow');
    return axis === 'v' ? (d > 0 ? 's' : 'n') : (d > 0 ? 'e' : 'w');
  }
  for (const t of texts) {
    if (!inR(t.p, 30)) continue;
    const up = UP_TEXT.test(t.str), dn = DOWN_TEXT.test(t.str);
    if (!up && !dn) continue;
    // "UP" stands at the bottom end; a "DN" label at the top end
    const mid = axis === 'v' ? rect.y + rect.h / 2 : rect.x + rect.w / 2, pos = axis === 'v' ? t.p[1] : t.p[0];
    const towardsPlus = up ? pos < mid : pos > mid;
    ev.push(`the text “${t.str}”`);
    return axis === 'v' ? (towardsPlus ? 's' : 'n') : (towardsPlus ? 'e' : 'w');
  }
  return null;
}

/**
 * Openings in a floor drawn on a plan: a rectangle (≥ 40 cm each side) with both diagonals drawn (a cross), or a closed
 * rectangle around "void" / "open to below" / "חלל" text. → [{ x, y, w, h, evidence }] (plan cm of the result).
 */
export function detectVoidSymbols(prims, r) {
  if (!r || !Array.isArray(r.transform)) return [];
  const box = wallsBox(r);
  const segs = planSegments(prims, r.transform, box, 0);
  const found = [];
  const add = (b, why) => {
    if (b.x1 - b.x0 < 40 || b.y1 - b.y0 < 40) return;
    const rect = { x: r2(b.x0), y: r2(b.y0), w: r2(b.x1 - b.x0), h: r2(b.y1 - b.y0) };
    if (found.some((f) => Math.abs(f.x - rect.x) < 3 && Math.abs(f.y - rect.y) < 3 && Math.abs(f.w - rect.w) < 3 && Math.abs(f.h - rect.h) < 3)) return;
    found.push({ ...rect, evidence: [why] });
  };
  // crosses: two diagonals with the same bounding box, sloping opposite ways
  const diag = segs.filter((s) => !s.o && s.len >= 50);
  for (let i = 0; i < diag.length; i++) for (let j = i + 1; j < diag.length; j++) {
    const A = diag[i], B = diag[j];
    const ba = bboxOfPts([A.a, A.b]), bb = bboxOfPts([B.a, B.b]);
    if (Math.abs(ba.x0 - bb.x0) > 2 || Math.abs(ba.x1 - bb.x1) > 2 || Math.abs(ba.y0 - bb.y0) > 2 || Math.abs(ba.y1 - bb.y1) > 2) continue;
    const sa = Math.sign((A.b[0] - A.a[0]) * (A.b[1] - A.a[1])), sb = Math.sign((B.b[0] - B.a[0]) * (B.b[1] - B.a[1]));
    if (sa === sb || !sa || !sb) continue;
    add({ x0: (ba.x0 + bb.x0) / 2, y0: (ba.y0 + bb.y0) / 2, x1: (ba.x1 + bb.x1) / 2, y1: (ba.y1 + bb.y1) / 2 }, 'a rectangle with a cross');
  }
  // text in a closed rectangle
  const texts = ((prims && prims.texts) || []).filter((t) => VOID_TEXT.test(String(t.str || ''))).map((t) => apply(r.transform, t.x + (t.w || 0) / 2, t.y - (t.h || 0) / 2));
  if (texts.length) {
    const rects = [];
    const seen = new Set();
    for (const s of segs) {
      if (seen.has(s.path)) continue;
      seen.add(s.path);
      // a closed path of 4 corners (or 5 points ending where it started)
      const P = s.P, ends = Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 0.5;
      const R = ends ? P.slice(0, -1) : P;
      if (R.length !== 4 || !(s.closed || ends)) continue;
      if (!R.every((p, k) => { const q = R[(k + 1) % 4]; return Math.abs(p[0] - q[0]) < 0.5 || Math.abs(p[1] - q[1]) < 0.5; })) continue;
      rects.push(bboxOfPts(R));
    }
    for (const p of texts) {
      const hit = rects.filter((b) => p[0] > b.x0 && p[0] < b.x1 && p[1] > b.y0 && p[1] < b.y1).sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0];
      if (hit) add(hit, 'a rectangle marked as a void');
    }
  }
  return found;
}

/**
 * Stairs of the floor below matched to what the floor above shows over them (plan cm of one common frame): an upper
 * void or stair symbol covering ≥ 30 % of the stair's footprint (or of itself) belongs to it. A stair whose direction was
 * not drawn goes up towards the end the opening above lies over.
 * @returns {{ stairs: [{ …stair, up, matched: { kind: 'void' | 'stair', index } | null }], plainVoids: [upperVoid…] }}
 */
export function matchStairs(lowerStairs, { voids = [], stairs = [] } = {}) {
  const used = new Set();
  const area = (a) => a.w * a.h, inter = (a, b) => ov(a.x, a.x + a.w, b.x, b.x + b.w) * ov(a.y, a.y + a.h, b.y, b.y + b.h);
  const out = lowerStairs.map((s) => {
    let hit = null;
    voids.forEach((v, i) => { const a = inter(s, v); if (a >= 0.3 * Math.min(area(s), area(v)) && (!hit || a > hit.a)) hit = { kind: 'void', index: i, a, box: v }; });
    if (!hit) stairs.forEach((u, i) => { const a = inter(s, u); if (a >= 0.3 * Math.min(area(s), area(u)) && (!hit || a > hit.a)) hit = { kind: 'stair', index: i, a, box: u }; });
    let up = s.up;
    if (hit && hit.kind === 'void') {
      used.add(hit.index);
      if (!up) {
        const sc = s.axis === 'v' ? s.y + s.h / 2 : s.x + s.w / 2, vc = s.axis === 'v' ? hit.box.y + hit.box.h / 2 : hit.box.x + hit.box.w / 2;
        if (Math.abs(vc - sc) > 5) up = s.axis === 'v' ? (vc < sc ? 'n' : 's') : (vc < sc ? 'w' : 'e');
      }
    }
    return { ...s, up, upFrom: s.up ? 'drawing' : up ? 'opening above' : null, matched: hit ? { kind: hit.kind, index: hit.index } : null };
  });
  return { stairs: out, plainVoids: voids.filter((_, i) => !used.has(i)) };
}

const ROT_OF = { n: 0, e: 90, s: 180, w: 270 };
/**
 * addStair inputs to try for a stair found on a drawing (plan cm of the BUILT plan), best first: the drawn going when the
 * engine accepts it (24–32 cm), else proposeStair's; risers always from the rise between the floors (never the drawn count).
 * Each candidate starts where the drawing's bottom step is and is centred across the drawn width (5 cm, 60–200 cm). A stair
 * without a direction is tried both ways. → [{ input (addStair), up, risers, going, drawnRisers, note }]
 */
export function stairCandidates(s, { rise, level = 'L0' } = {}) {
  if (!(rise > 0)) return [];
  const width = Math.max(60, Math.min(200, Math.round(s.width / 5) * 5 || 90));
  const prop = proposeStair({ rise, shape: 'straight', width });
  if (!prop) return [];
  const ups = s.up ? [s.up] : s.axis === 'v' ? ['n', 's'] : ['e', 'w'];
  const goings = [];
  const g = Math.round(s.going * 2) / 2;
  if (g >= 24 && g <= 32) goings.push(g);
  if (!goings.includes(prop.going)) goings.push(prop.going);
  const out = [];
  for (const up of ups) for (const going of goings) {
    const st = { shape: 'straight', x: 0, y: 0, rot: 0, width, risers: prop.risers, going, ...(prop.landing ? { landing: prop.landing } : {}) };
    const geo = stairGeometry(st, { rise });
    if (!geo) continue;
    const d = geo.size.d, w = geo.size.w;
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    const pose = up === 'n' ? { x: cx, y: s.y + s.h - d / 2 } : up === 's' ? { x: cx, y: s.y + d / 2 } : up === 'e' ? { x: s.x + d / 2, y: cy } : { x: s.x + s.w - d / 2, y: cy };
    const input = { level, shape: 'straight', x: r2(pose.x), y: r2(pose.y), rot: ROT_OF[up], width, risers: prop.risers, going, ...(prop.landing ? { landing: prop.landing } : {}) };
    const drawnRisers = s.lines;
    const notes = [];
    if (drawnRisers && drawnRisers !== prop.risers) notes.push(`The drawing shows ${drawnRisers} risers; ${prop.risers} are needed for the ${Math.round(rise)} cm between the floors (${(rise / prop.risers).toFixed(1)} cm each).`);
    if (going !== g && g > 0) notes.push(`Going ${going} cm instead of the drawn ${g} cm.`);
    out.push({ input, up, risers: prop.risers, going, width: w, length: d, drawnRisers, notes });
  }
  return out;
}

/**
 * Try the stairs found on the drawings on a BUILT plan with the plan engine itself (`PE` = the plan-edit module of an
 * isolated realm — a worker or a test: setBasePlan replaces its plan). Each stair: its candidates (stairCandidates) in
 * order; the first one canAddStair accepts is added (so the next stair sees it), else the engine's refusal of the first
 * one is reported. `stairs[i].level` = the floor it starts on ('L0'…), coordinates in the built plan's frame.
 * @returns {Array<{ ok, input?, reason?, code?, risers?, going?, notes: string[], voidId?, up? }>}
 */
export function stairVerdicts(PE, plan, stairs) {
  PE.setBasePlan(plan, { phase: 'draft' });
  const elev = (id) => (id === 'L0' ? 0 : ((plan.levels || []).find((l) => l.id === id) || {}).elevation);
  const above = (id) => { const ids = ['L0', ...(plan.levels || []).map((l) => l.id)]; return ids[ids.indexOf(id) + 1] || null; };
  return stairs.map((s) => {
    const level = s.level || 'L0', to = above(level);
    if (!to) return { ok: false, code: 'no-level-above', reason: 'There is no floor above this one.', notes: [] };
    const rise = elev(to) - elev(level);
    const cands = stairCandidates(s, { rise, level });
    if (!cands.length) return { ok: false, code: 'problems', reason: 'No stair fits these numbers.', notes: [] };
    let first = null;
    for (const c of cands) {
      const v = PE.canAddStair(c.input);
      if (v.ok) {
        const r = PE.addStair(c.input);
        if (r.ok) return { ok: true, input: c.input, up: c.up, risers: c.risers, going: c.going, rise, notes: c.notes, voidId: r.voidId || null, stairId: r.stairId };
        if (!first) first = { c, v: r };
        continue;
      }
      if (!first) first = { c, v };
    }
    return { ok: false, input: first.c.input, up: first.c.up, reason: first.v.reason, code: first.v.code, rise, notes: first.c.notes };
  });
}

/**
 * The buildPlan input for several floors (bottom-up). `floors[i]` = { result (normalise output), offset: { x, y } (where
 * this floor's own origin lies in the ground floor's frame — 0, 0 for the ground floor), name?, ceiling?, slab?, voids?:
 * [{ x, y, w, h }] (plain openings in this floor, its own frame) }. The ground floor is the top-level plan, the others
 * `levels: [{ id: 'L1'…, name, heights, walls, openings, slants?, voids? }]`. Opening ids are made unique per floor.
 */
export function levelsInput(floors, { meta, heights = {} } = {}) {
  const move = (r, off, pre) => {
    const walls = (r.walls || []).map(({ id, x, y, w, h, kind }) => ({ id, x: r2(x + off.x), y: r2(y + off.y), w, h, kind }));
    const openings = (r.openings || []).map(({ confidence, ...o }) => {
      const q = { ...o, id: pre ? `${pre}${o.id}` : o.id };
      if (o.axis !== 'a') { q.x = r2(o.x + off.x); q.y = r2(o.y + off.y); }
      return q;
    });
    const sl = slantsOf(r).map(({ id, x1, y1, x2, y2, t, kind, chain }) => ({ id, x1: r2(x1 + off.x), y1: r2(y1 + off.y), x2: r2(x2 + off.x), y2: r2(y2 + off.y), t, kind, ...(chain ? { chain } : {}) }));
    return { walls, openings, slants: sl };
  };
  const [g, ...ups] = floors;
  const off0 = g.offset || { x: 0, y: 0 };
  const base = move(g.result, off0, '');
  const input = { walls: base.walls, openings: base.openings, meta, heights: { ...heights, ...(g.ceiling ? { ceiling: g.ceiling } : {}) } };
  if (base.slants.length) input.slants = base.slants;
  let vid = 0;
  input.levels = ups.map((f, i) => {
    const off = f.offset || { x: 0, y: 0 }, m = move(f.result, off, `L${i + 1}-`);
    const lv = { id: `L${i + 1}`, name: f.name || undefined, heights: { ceiling: f.ceiling || input.heights.ceiling || undefined, ...(f.slab ? { slab: f.slab } : {}) }, walls: m.walls, openings: m.openings };
    if (!lv.name) delete lv.name;
    if (!lv.heights.ceiling) delete lv.heights.ceiling;
    if (m.slants.length) lv.slants = m.slants;
    const vs = (f.voids || []).map((v) => ({ id: `v${++vid}`, polygon: [[v.x + off.x, v.y + off.y], [v.x + v.w + off.x, v.y + off.y], [v.x + v.w + off.x, v.y + v.h + off.y], [v.x + off.x, v.y + v.h + off.y]].map((p) => p.map(r2)), stair: null, railing: true }));
    if (vs.length) lv.voids = vs;
    return lv;
  });
  return input;
}

/** The origin move buildPlan made ("moved by X cm east–west and Y cm north–south") → the shift to ADD to input coordinates. */
export function shiftOf(warnings) {
  const m = (warnings || []).map((w) => /moved by (-?[\d.]+) cm east–west and (-?[\d.]+) cm north–south/.exec(w.text)).find(Boolean);
  return m ? { x: -Number(m[1]), y: -Number(m[2]) } : { x: 0, y: 0 };
}

export { DIRS as FLOOR_DIRS };
