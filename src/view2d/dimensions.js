/**
 * Architect-style dimensions derived from the plan geometry (nothing is hard-coded):
 *   • exterior chains on all four sides — a detail chain broken at every wall / opening change, a chain of
 *     façade steps, and the overall size;
 *   • interior clear dimensions (W × D) of every rectangular room and of the named zones of open spaces.
 * The compute functions are pure; `drawDimensions` renders them with collision-free text.
 */
import { polygonBounds, slantPolys, openingPoly } from '../core/geometry.js';
import { hasSlantedEdge, mainDirection, spanAlong } from './slant-tools.js';

const uniq = (arr) => [...new Set(arr)].sort((a, b) => a - b);

/**
 * What an observer standing outside sees along one side of the house: consecutive runs of "the same thing at
 * the same depth" (a wall plane or one particular opening).
 * @param {'n'|'s'|'w'|'e'} side
 * @returns {{ from:number, to:number, depth:number, opening:object|null }[]}
 */
export function facadeProfile(plan, side) {
  const horiz = side === 'n' || side === 's';
  const lo = (r) => (horiz ? r.x : r.y), hi = (r) => (horiz ? r.x + r.w : r.y + r.h);
  const depth = (r) => (side === 'n' ? r.y : side === 's' ? r.y + r.h : side === 'w' ? r.x : r.x + r.w);
  const nearer = (a, b) => (side === 'n' || side === 'w' ? a < b : a > b);
  const angled = Array.isArray(plan.slants) && plan.slants.length > 0;
  const rects = [...plan.walls.map((r) => ({ r, opening: null })), ...plan.openings.filter((o) => !angled || o.axis !== 'a').map((r) => ({ r, opening: r }))];
  // angled walls (stage A3): each footprint is projected onto this side; its openings count as openings only on the side
  // the wall mainly faces (elsewhere they are part of its projection). Their depth is taken where they are crossed.
  if (angled) rects.push(...slantProfileShapes(plan, side));
  const depthAt = (c, mid) => (c.poly ? polyDepth(c.poly, side, mid) : depth(c.r));
  const cuts = uniq(rects.flatMap(({ r }) => [lo(r), hi(r)]));
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const mid = (cuts[i] + cuts[i + 1]) / 2;
    let best = null, bestDepth = 0;
    for (const c of rects) {
      if (lo(c.r) > mid || hi(c.r) < mid) continue;
      const dep = depthAt(c, mid);
      if (dep == null) continue;
      if (!best || nearer(dep, bestDepth)) { best = c; bestDepth = dep; }
    }
    if (!best) continue;
    const seg = { from: cuts[i], to: cuts[i + 1], depth: best.poly ? Math.round(bestDepth * 10) / 10 : bestDepth, opening: best.opening };
    if (best.slant) seg.slant = best.slant;
    const prev = out[out.length - 1];
    if (prev && prev.to === seg.from && prev.depth === seg.depth && prev.opening === seg.opening) prev.to = seg.to;
    // the projection of one angled wall (or of one opening in it) is one piece, at its outermost depth
    else if (prev && prev.to === seg.from && seg.slant && prev.slant === seg.slant && prev.opening === seg.opening) {
      prev.to = seg.to;
      if (side === 'n' || side === 'w' ? seg.depth < prev.depth : seg.depth > prev.depth) prev.depth = seg.depth;
    } else out.push(seg);
  }
  return out;
}

/**
 * The outermost extent of a polygon on a side, across the line at `at` (x for 'n' / 's', y for 'w' / 'e'): its min y on
 * the north side, max x on the east side … null when the line misses it.
 */
export function polyDepth(poly, side, at) {
  const horiz = side === 'n' || side === 's';
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const a1 = horiz ? x1 : y1, a2 = horiz ? x2 : y2, c1 = horiz ? y1 : x1, c2 = horiz ? y2 : x2;
    if ((at < Math.min(a1, a2)) || (at > Math.max(a1, a2))) continue;
    const vals = a1 === a2 ? [c1, c2] : [c1 + (c2 - c1) * ((at - a1) / (a2 - a1))];
    for (const v of vals) if (best == null || (side === 'n' || side === 'w' ? v < best : v > best)) best = v;
  }
  return best;
}
/** Which side an angled wall mainly faces (its outward face normal; for an interior one the side of its larger extent). */
function mainSide(s, poly) {
  const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1, nx = -(s.y2 - s.y1) / len, ny = (s.x2 - s.x1) / len;
  return Math.abs(nx) >= Math.abs(ny) ? ['w', 'e'] : ['n', 's'];
}
/** The angled walls of a plan as profile shapes ({ r: AABB, poly, opening, slant }) plus their openings on their main sides. */
function slantProfileShapes(plan, side) {
  const out = [], polys = slantPolys(plan), byId = new Map(plan.slants.map((s) => [s.id, s]));
  for (const poly of polys) {
    const s = byId.get(poly.id);
    if (!s) continue;
    out.push({ r: polygonBounds(poly), poly, opening: null, slant: s.id });
    if (!mainSide(s, poly).includes(side)) continue;
    for (const o of plan.openings) {
      if (o.axis !== 'a' || o.wall !== s.id) continue;
      const q = openingPoly(o, plan);
      out.push({ r: polygonBounds(q), poly: q, opening: o, slant: s.id });
    }
  }
  return out;
}

/** Merge a profile into its façade steps (same depth), dropping the opening detail. */
export function facadeSteps(profile) {
  const out = [];
  for (const s of profile) {
    const prev = out[out.length - 1];
    if (prev && prev.depth === s.depth && prev.to === s.from) prev.to = s.to;
    else out.push({ from: s.from, to: s.to, depth: s.depth, opening: null });
  }
  return out;
}

/**
 * Exterior dimension chains per side: rows[0] = detail, then façade steps, then the overall length
 * (rows that would repeat the previous one are dropped).
 * @returns {{ n: object[][], s: object[][], w: object[][], e: object[][] }}
 */
export function exteriorChains(plan) {
  const out = {};
  for (const side of ['n', 's', 'w', 'e']) {
    const detail = facadeProfile(plan, side);
    if (!detail.length) { out[side] = []; continue; }
    const steps = facadeSteps(detail);
    const total = [{ from: detail[0].from, to: detail[detail.length - 1].to, depth: 0, opening: null, total: true }];
    const rows = [detail];
    if (steps.length > 1 && steps.length < detail.length) rows.push(steps);
    if (rows[rows.length - 1].length > 1) rows.push(total);
    out[side] = rows;
  }
  return out;
}

const isRect = (poly) => poly.length === 4 && poly.every(([x, y], i) => { const [x2, y2] = poly[(i + 1) % 4]; return x === x2 || y === y2; });

/** Clear span of a polygon through point (px, py) along x ('h') or y ('v'): [from, to] or null. */
export function spanThrough(poly, px, py, dir) {
  let lo = -Infinity, hi = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    if (dir === 'h' && x1 === x2 && Math.min(y1, y2) < py && py < Math.max(y1, y2)) {
      if (x1 <= px) lo = Math.max(lo, x1); else hi = Math.min(hi, x1);
    } else if (dir === 'v' && y1 === y2 && Math.min(x1, x2) < px && px < Math.max(x1, x2)) {
      if (y1 <= py) lo = Math.max(lo, y1); else hi = Math.min(hi, y1);
    }
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/**
 * Interior clear dimensions: [{ dir:'h'|'v', from, to, at, room }] — `at` is the y (for 'h') or x (for 'v')
 * the measurement is taken at.
 */
export function interiorDims(plan) {
  const out = [];
  const seen = new Set();
  const push = (dir, span, at, room, primary) => {
    if (!span || span[1] - span[0] < 40) return;
    const key = `${room}|${dir}|${span[0]}|${span[1]}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ dir, from: span[0], to: span[1], at, room, primary });
  };
  for (const room of plan.rooms) {
    if (!isRect(room.polygon) && !(room.zones && room.zones.length) && hasSlantedEdge(room.polygon)) { slantedRoomDims(room, out); continue; }
    if (isRect(room.polygon)) {
      const b = polygonBounds(room.polygon);
      push('h', [b.x, b.x + b.w], b.y + b.h * 0.5, room.id, true);
      push('v', [b.y, b.y + b.h], b.x + b.w * 0.5, room.id, true);
    } else {
      for (const z of room.zones || []) {
        const [px, py] = z.label;
        push('h', spanThrough(room.polygon, px, py + 0.5, 'h'), py, room.id, false);
        push('v', spanThrough(room.polygon, px + 0.5, py, 'v'), px, room.id, false);
      }
    }
  }
  return out;
}

/**
 * A room with slanted sides (stage A3): its clear width and depth along its main directions (mainDirection), through
 * points beside its label point. On an axis frame they are ordinary 'h' / 'v' dimensions (fixed at that line); on a turned
 * frame 'a' dimensions { dir: 'a', px, py, ux, uy, from, to } (parameters along (ux, uy) from (px, py)).
 */
export function slantedRoomDims(room, out = []) {
  const poly = room.polygon, th = mainDirection(poly) * Math.PI / 180;
  const u = [Math.cos(th), Math.sin(th)], v = [-Math.sin(th), Math.cos(th)];
  const [lx, ly] = room.label || [0, 0];
  const add = (dirv, shift) => {
    const px = lx + shift[0], py = ly + shift[1], sp = spanAlong(poly, px, py, dirv[0], dirv[1]);
    if (!sp || sp[1] - sp[0] < 40) return;
    if (Math.abs(dirv[1]) < 1e-9) out.push({ dir: 'h', from: px + sp[0] * Math.sign(dirv[0]), to: px + sp[1] * Math.sign(dirv[0]), at: py, room: room.id, primary: false, fixed: true });
    else if (Math.abs(dirv[0]) < 1e-9) out.push({ dir: 'v', from: py + sp[0] * Math.sign(dirv[1]), to: py + sp[1] * Math.sign(dirv[1]), at: px, room: room.id, primary: false, fixed: true });
    else out.push({ dir: 'a', px, py, ux: dirv[0], uy: dirv[1], from: sp[0], to: sp[1], room: room.id, primary: false });
  };
  // beside the label (as the zone dimensions are): the width a little below it, the depth a little to its side
  add(u, [v[0] * 28, v[1] * 28]);
  add(v, [u[0] * 70, u[1] * 70]);
  for (const d of out) if (d.dir !== 'a' && d.from > d.to) [d.from, d.to] = [d.to, d.from];
  return out;
}

/** Format a dimension figure: bare number, cm or metres with two decimals. */
export const dimText = (cm, units) => (units === 'cm' ? String(Math.round(cm)) : (cm / 100).toFixed(2));
