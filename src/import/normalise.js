/**
 * normalise — bring a detection into plan space (the PLAN schema of src/core/plan.js): cm, origin at the outer
 * north-west corner of the house, +x east, +y south (down), optional north-up rotation and mirror.
 *
 *   normalise({ walls: detectWalls(...), openings: detectOpenings(...), scale, pageBox }, { rotate, mirror })
 *     rotate : 0 | 90 | 180 | 270 — clockwise quarter turns applied to the drawing (to put north up)
 *     mirror : false | 'ns' | 'ew' — flip north–south (top–bottom) or east–west (left–right) BEFORE rotating
 *
 * Returns { walls, openings, scale, pageBox, transform, warnings, stats, confidence, unsupported }
 *   transform : [a, b, c, d, e, f] page units → plan cm (X = a·x + c·y + e, Y = b·x + d·y + f), i.e. what
 *               ctx.setTransform needs (times the view's own cm→px) to lay the rendered page under the plan.
 */
import { affThen, affApply } from './prep.js';
import { outsideMask, classifyKinds } from './gaps.js';

/** Greedy top-down re-decomposition of wall rectangles on a `step` grid; a rectangle never mixes kinds. */
function recut(rects, step) {
  if (!rects.length) return rects;
  const gx = Math.round(Math.max(...rects.map((r) => r.x + r.w)) / step), gy = Math.round(Math.max(...rects.map((r) => r.y + r.h)) / step);
  const kinds = [...new Set(rects.map((r) => r.kind))];
  const K = new Uint8Array(gx * gy);
  for (const r of rects) {
    const v = kinds.indexOf(r.kind) + 1;
    for (let j = Math.round(r.y / step); j < Math.round((r.y + r.h) / step); j++) for (let i = Math.round(r.x / step); i < Math.round((r.x + r.w) / step); i++) K[j * gx + i] = v;
  }
  const used = new Uint8Array(gx * gy), out = [];
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const v = K[j * gx + i];
    if (!v || used[j * gx + i]) continue;
    const ok = (a, b) => a < gx && b < gy && K[b * gx + a] === v && !used[b * gx + a];
    let e = i; while (ok(e, j)) e++;
    let jj = j + 1;
    const row = (r) => { for (let t = i; t < e; t++) if (!ok(t, r)) return false; return true; };
    while (jj < gy && row(jj)) jj++;
    for (let r = j; r < jj; r++) for (let t = i; t < e; t++) used[r * gx + t] = 1;
    out.push({ x: i * step, y: j * step, w: (e - i) * step, h: (jj - j) * step, kind: kinds[v - 1] });
  }
  return out;
}

const ROT = { 0: [1, 0, 0, 1], 90: [0, 1, -1, 0], 180: [-1, 0, 0, -1], 270: [0, -1, 1, 0] }; // [a b c d], y down, clockwise
const DIRV = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

function linear(rotate, mirror) {
  const m = mirror === 'ns' || mirror === 'y' ? [1, 0, 0, -1] : mirror === 'ew' || mirror === 'x' ? [-1, 0, 0, 1] : [1, 0, 0, 1];
  const r = ROT[((rotate % 360) + 360) % 360];
  if (!r) throw new Error('rotate must be 0, 90, 180 or 270');
  return affThen([...m, 0, 0], [...r, 0, 0]);
}

const mapDir = (L, d) => {
  if (!d) return d;
  const [x, y] = DIRV[d];
  const X = L[0] * x + L[2] * y, Y = L[1] * x + L[3] * y;
  return Math.abs(X) > Math.abs(Y) ? (X > 0 ? 'e' : 'w') : (Y > 0 ? 's' : 'n');
};

const r6 = (v) => Math.round(v * 1e6) / 1e6;

export function normalise(result, { rotate = 0, mirror = false } = {}) {
  const W = result.walls || {}, OP = result.openings || {};
  const wallList = Array.isArray(W) ? W : W.walls || [];
  const openList = Array.isArray(OP) ? OP : OP.openings || [];
  const frame = W.frame || { matrix: [1, 0, 0, 1, 0, 0] };
  const L = linear(rotate, mirror);
  const swap = rotate % 180 !== 0;
  const mapRect = (r) => {
    const p = [affApply(L, r.x, r.y), affApply(L, r.x + r.w, r.y + r.h)];
    return { x: Math.min(p[0][0], p[1][0]), y: Math.min(p[0][1], p[1][1]), w: Math.abs(p[1][0] - p[0][0]), h: Math.abs(p[1][1] - p[0][1]) };
  };
  const mw = wallList.map((w) => ({ ...w, ...mapRect(w) }));
  const ox = mw.length ? Math.min(...mw.map((w) => w.x)) : 0, oy = mw.length ? Math.min(...mw.map((w) => w.y)) : 0;
  const snap = (frame.snap || 0) > 0 ? frame.snap : 0;
  const fix = (v) => (snap ? Math.round(r6(v) / snap * 1e6) / 1e6 * snap : r6(v));
  const shift = (r) => ({ x: fix(r.x - ox), y: fix(r.y - oy), w: fix(r.w), h: fix(r.h) });

  // the rectangle decomposition follows the top-down scan convention in the OUTPUT orientation: after a mirror or a
  // rotation the pieces are re-cut (area unchanged, each cell keeps its kind)
  let shifted = mw.map((w) => ({ ...shift(w), kind: w.kind }));
  const reoriented = !!((rotate % 360) || mirror);
  if (reoriented) shifted = recut(shifted.map((w) => ({ ...w, kind: 'wall' })), snap || 5);
  const walls0 = shifted;
  const openings = openList.map((o) => {
    const r = shift(mapRect(o));
    const out = { id: o.id, kind: o.kind, style: o.style, axis: swap ? (o.axis === 'h' ? 'v' : 'h') : o.axis, ...r,
      width: o.width, height: o.height, sill: o.sill, exterior: !!o.exterior };
    if (o.outside) out.outside = mapDir(L, o.outside);
    if (o.hinge) out.hinge = mapDir(L, o.hinge);
    if (o.swing) out.swing = mapDir(L, o.swing);
    if (o.leaves) out.leaves = o.leaves;
    if (o.innerDoor) out.innerDoor = { ...o.innerDoor, hinge: mapDir(L, o.innerDoor.hinge), swing: mapDir(L, o.innerDoor.swing) };
    if (o.assumed) out.assumed = o.assumed.slice();
    out.confidence = o.confidence;
    return out;
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  if (reoriented) classifyKinds(walls0, outsideMask(walls0, openings, { snap: snap || 5 }));
  const walls = walls0
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((w, i) => ({ id: 'w' + String(i + 1).padStart(2, '0'), x: w.x, y: w.y, w: w.w, h: w.h, kind: w.kind }));



  // page -> frame cm -> mirrored / rotated -> shifted to the house corner
  const transform = affThen(affThen(frame.matrix, L), [1, 0, 0, 1, -ox, -oy]).map(r6);
  const unsupported = (W.unsupported || []).map((u) => ({ type: u.type, len: Math.round(u.len), ...shift(mapRect(u)) }));
  const warnings = [...(W.warnings || []), ...(OP.warnings || [])].map((w) => (w.where && w.where.frame === 'drawing-cm'
    ? { ...w, where: { ...shift(mapRect(w.where)), frame: 'plan-cm' } } : w));
  const scale = result.scale || (frame.cmPerUnit ? { cmPerUnit: frame.cmPerUnit } : null);
  const sConf = scale && scale.confidence != null ? scale.confidence : 1;
  const wConf = W.confidence != null ? W.confidence : 0.5;
  const area = walls.reduce((t, w) => t + w.w * w.h, 0);
  const bounds = walls.length ? { x: 0, y: 0, w: Math.max(...walls.map((w) => w.x + w.w)), h: Math.max(...walls.map((w) => w.y + w.h)) } : null;
  return {
    walls, openings, scale, pageBox: result.pageBox || null, transform, rotate, mirror: mirror || false,
    warnings, unsupported,
    stats: { walls: walls.length, exterior: walls.filter((w) => w.kind === 'exterior').length, wallArea: area, bounds,
      openings: openings.length, doors: openings.filter((o) => o.kind === 'door').length, windows: openings.filter((o) => o.kind === 'window').length,
      deskew: frame.angle || 0, ...(W.stats || {}) },
    confidence: { scale: sConf, walls: wConf, openings: openings.length ? +(openings.reduce((t, o) => t + o.confidence, 0) / openings.length).toFixed(2) : null,
      overall: +(wConf * (0.5 + 0.5 * sConf)).toFixed(2) },
  };
}
