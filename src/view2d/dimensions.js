/**
 * Architect-style dimensions derived from the plan geometry (nothing is hard-coded):
 *   • exterior chains on all four sides — a detail chain broken at every wall / opening change, a chain of
 *     façade steps, and the overall size;
 *   • interior clear dimensions (W × D) of every rectangular room and of the named zones of open spaces.
 * The compute functions are pure; `drawDimensions` renders them with collision-free text.
 */
import { polygonBounds } from '../core/geometry.js';

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
  const rects = [...plan.walls.map((r) => ({ r, opening: null })), ...plan.openings.map((r) => ({ r, opening: r }))];
  const cuts = uniq(rects.flatMap(({ r }) => [lo(r), hi(r)]));
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const mid = (cuts[i] + cuts[i + 1]) / 2;
    let best = null;
    for (const c of rects) {
      if (lo(c.r) > mid || hi(c.r) < mid) continue;
      if (!best || nearer(depth(c.r), depth(best.r))) best = c;
    }
    if (!best) continue;
    const seg = { from: cuts[i], to: cuts[i + 1], depth: depth(best.r), opening: best.opening };
    const prev = out[out.length - 1];
    if (prev && prev.to === seg.from && prev.depth === seg.depth && prev.opening === seg.opening) prev.to = seg.to;
    else out.push(seg);
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

/** Format a dimension figure: bare number, cm or metres with two decimals. */
export const dimText = (cm, units) => (units === 'cm' ? String(Math.round(cm)) : (cm / 100).toFixed(2));
