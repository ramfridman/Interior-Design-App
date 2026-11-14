/**
 * detectOpenings — doors, windows and passages in the gaps of detected walls (drawing frame, cm).
 *
 *   door      : a gap with a swing arc (radius ≈ gap width, centre at one jamb) → width, hinge jamb, swing side;
 *               a second arc on the other face (e.g. dashed inner leaf) becomes `innerDoor`; two half-width arcs at
 *               opposite jambs make a double door (`leaves: 2`).
 *   window    : a gap with thin lines parallel to the wall spanning it (glass / frame lines); 'sliding-door' when such a
 *               gap is at least `slidingDoorMin` wide (a drawing convention, not a certainty — confidence 0.5).
 *   opening   : an empty gap framed by collinear walls of the same thickness (a passage), low confidence.
 * Openings drawn over continuous wall lines (no gap in the wall outline) cannot be found: the wall is solid there.
 */
import { arcsOf, segmentsOf, affApply, DEG } from './prep.js';
import { findGaps, outsideMask, outsideSide } from './gaps.js';

const DEFAULTS = { slidingDoorMin: 200, maxPassage: 250, doorHeight: 210, windowHeight: 120, windowSill: 90 };

/** Arcs and thin straight segments (everything not drawn with a wall pen), in the drawing frame (cm). */
export function symbolContext(prims, frame, wallPens = [], opt = null) {
  const M = frame.matrix, k = frame.cmPerUnit;
  const ex = new Set(wallPens);
  const arcs = arcsOf(prims, { excludePens: ex }).map((a) => {
    const p = a.pts, n = p.length / 2, m = Math.floor(n / 2);
    const [cx, cy] = affApply(M, a.cx, a.cy);
    return { cx, cy, r: a.r * k, sweep: Math.abs(a.sweep), dashed: a.dashed, pen: a.pen,
      mid: affApply(M, p[2 * m], p[2 * m + 1]), p0: affApply(M, p[0], p[1]), p1: affApply(M, p[2 * n - 2], p[2 * n - 1]) };
  });
  const segs = [];
  const asegs = opt && opt.angled ? [] : null;   // slants option: thin angled lines too (window glass in angled walls)
  for (const s of segmentsOf(prims)) {
    if (ex.has(s.pen) || s.curved) continue;
    const [ax, ay] = affApply(M, s.x1, s.y1), [bx, by] = affApply(M, s.x2, s.y2);
    const dx = Math.abs(bx - ax), dy = Math.abs(by - ay), len = Math.hypot(dx, dy);
    if (len < 5) continue;
    if (dy <= len * Math.tan(1 * DEG)) segs.push({ o: 'h', k: (ay + by) / 2, a: Math.min(ax, bx), b: Math.max(ax, bx), pen: s.pen, len });
    else if (dx <= len * Math.tan(1 * DEG)) segs.push({ o: 'v', k: (ax + bx) / 2, a: Math.min(ay, by), b: Math.max(ay, by), pen: s.pen, len });
    else if (asegs) { let th = Math.atan2(by - ay, bx - ax); if (th < 0) th += Math.PI; if (th >= Math.PI) th -= Math.PI; asegs.push({ x1: ax, y1: ay, x2: bx, y2: by, th, pen: s.pen, len }); }
  }
  return asegs ? { arcs, segs, asegs } : { arcs, segs };
}

/** Classify wall gaps. Returns openings in the drawing frame (no exterior / outside yet). */
export function classifyGaps(gaps, ctx, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const out = [];
  for (const g of gaps) {
    const W = g.width, horiz = g.axis === 'h';
    // jamb lines: along the wall at s = start / end of the gap; across the wall from t0 to t1
    const s0 = horiz ? g.x : g.y, s1 = horiz ? g.x + g.w : g.y + g.h;
    const t0 = horiz ? g.y : g.x, t1 = horiz ? g.y + g.h : g.x + g.w;
    const along = (p) => (horiz ? p[0] : p[1]), across = (p) => (horiz ? p[1] : p[0]);
    const tol = Math.max(10, 0.15 * W);
    const tolX = 6 + 0.03 * W; // hinge centres lie on (or very near) a face of the wall
    const near = (a, jamb, frac) => Math.abs(along([a.cx, a.cy]) - jamb) <= tol && across([a.cx, a.cy]) >= t0 - tolX && across([a.cx, a.cy]) <= t1 + tolX &&
      a.r >= 0.7 * frac * W - 3 && a.r <= 1.15 * frac * W + 3 && a.sweep >= 55 && a.sweep <= 125;
    const side = (a) => (across(a.mid) < (t0 + t1) / 2 ? (horiz ? 'n' : 'w') : (horiz ? 's' : 'e'));
    const hingeOf = (a) => (Math.abs(along([a.cx, a.cy]) - s0) <= Math.abs(along([a.cx, a.cy]) - s1) ? (horiz ? 'w' : 'n') : (horiz ? 'e' : 's'));
    const singles = ctx.arcs.filter((a) => near(a, s0, 1) || near(a, s1, 1));
    const halves0 = ctx.arcs.filter((a) => near(a, s0, 0.5)), halves1 = ctx.arcs.filter((a) => near(a, s1, 0.5));
    // window / glazing lines inside the gap band, parallel to the wall, spanning most of it
    const lines = ctx.segs.filter((s) => s.o === g.axis && s.k > t0 - 1 && s.k < t1 + 1 &&
      Math.min(s.b, s1) - Math.max(s.a, s0) >= 0.7 * W && s.b - s.a <= W * 1.6 + 30);
    const lineKeys = [...new Set(lines.map((s) => Math.round(s.k)))];
    const base = { axis: g.axis, x: g.x, y: g.y, w: g.w, h: g.h, width: W, thickness: g.thickness };
    if (singles.length) {
      singles.sort((a, b) => (a.dashed - b.dashed) || Math.abs(a.r - W) - Math.abs(b.r - W));
      const a = singles[0];
      const d = { ...base, kind: 'door', hinge: hingeOf(a), swing: side(a), confidence: a.dashed ? 0.75 : 0.9,
        evidence: { arcs: singles.length, radius: +a.r.toFixed(1), sweep: Math.round(a.sweep) } };
      const other = singles.find((b) => b !== a && side(b) !== d.swing);
      if (other) d.innerDoor = { width: W, hinge: hingeOf(other), swing: side(other), dashed: other.dashed };
      out.push(d);
    } else if (g.collinear && halves0.length && halves1.length && halves0.some((a) => halves1.some((b) => side(a) === side(b)))) {
      const a = halves0[0];
      out.push({ ...base, kind: 'door', leaves: 2, hinge: hingeOf(a), swing: side(a), confidence: 0.8, evidence: { arcs: 2, radius: +a.r.toFixed(1) } });
    } else if (lineKeys.length >= 2 || (lineKeys.length === 1 && g.collinear)) {
      const sliding = W >= o.slidingDoorMin;
      out.push({ ...base, kind: sliding ? 'sliding-door' : 'window', confidence: sliding ? 0.5 : (lineKeys.length >= 2 ? 0.85 : 0.65),
        evidence: { lines: lineKeys.length } });
    } else if (g.collinear && W <= o.maxPassage) {
      out.push({ ...base, kind: 'opening', confidence: 0.35, evidence: { empty: true } });
    }
  }
  return out;
}

/**
 * @param prims   readPdf() output
 * @param walls   detectWalls() result (uses its walls, frame, pens, gaps and options)
 * @param scale   { cmPerUnit } (only checked against the walls' frame)
 * @returns { openings: [...] (drawing frame, cm), warnings, stats }
 */
export function detectOpenings(prims, walls, scale, opts = {}) {
  const o = { ...DEFAULTS, ...(walls.options || {}), ...opts };
  const warnings = [];
  if (scale && walls.frame && Math.abs(scale.cmPerUnit - walls.frame.cmPerUnit) > 1e-9 * scale.cmPerUnit) {
    warnings.push({ code: 'scale-mismatch', text: 'Openings were measured with the scale the walls were detected at.', where: null });
  }
  const list = walls.walls || [];
  const gaps = walls.gaps || findGaps(list, o);
  const ctx = symbolContext(prims, walls.frame, (walls.pens || []).map((p) => p.pen));
  const found = classifyGaps(gaps, ctx, o);
  // a gap found from both ends keeps one entry; a smaller gap inside a bigger one (stepped jambs) is dropped
  const uniq = [];
  const ov = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (const f of found.sort((a, b) => b.confidence - a.confidence || b.w * b.h - a.w * a.h)) {
    if (uniq.some((u) => u.axis === f.axis && ov(u, f) >= 0.5 * Math.min(u.w * u.h, f.w * f.h))) continue;
    uniq.push(f);
  }
  const outside = walls.slants ? outsideMask(list, uniq, o, walls.slants) : outsideMask(list, uniq, o);
  const counters = {};
  const openings = uniq.sort((a, b) => a.y - b.y || a.x - b.x).map((f) => {
    const side = outsideSide(f, outside);
    const exterior = !!side && (f.axis === 'h' ? side === 'n' || side === 's' : side === 'e' || side === 'w');
    const kind = f.kind;
    const n = (counters[kind] = (counters[kind] || 0) + 1);
    const id = { door: 'door', window: 'win', 'sliding-door': 'slide', opening: 'open' }[kind] + '-' + n;
    const op = { id, kind, axis: f.axis, x: f.x, y: f.y, w: f.w, h: f.h, width: f.width, exterior };
    if (exterior) op.outside = side;
    if (kind === 'door') {
      Object.assign(op, { style: exterior ? (f.width >= 100 ? 'entry' : 'service') : 'interior', height: o.doorHeight, sill: 0, hinge: f.hinge, swing: f.swing, assumed: ['height', 'style'] });
      if (f.leaves) op.leaves = f.leaves;
      if (f.innerDoor) op.innerDoor = { style: 'interior', width: f.innerDoor.width, height: o.doorHeight, hinge: f.innerDoor.hinge, swing: f.innerDoor.swing };
    } else if (kind === 'sliding-door') Object.assign(op, { style: 'glass-sliding', height: o.doorHeight, sill: 0, assumed: ['height', 'kind'] });
    else if (kind === 'window') Object.assign(op, { style: f.width <= 90 ? 'tilt' : 'sliding', height: o.windowHeight, sill: o.windowSill, assumed: ['height', 'sill', 'style'] });
    else Object.assign(op, { style: 'open', height: o.doorHeight, sill: 0, assumed: ['height'] });
    op.confidence = f.confidence;
    op.evidence = f.evidence;
    return op;
  });
  // slants option: openings in angled walls (found by detectWalls between collinear slant pieces), PLAN shape
  // "opening in a slant": { wall: <slant id>, axis: 'a', at (cm from x1, y1 to the centre), hinge 'a'|'b', swing / outside 'l'|'r' }
  for (const f of walls.slantOpenings || []) {
    const kind = f.kind;
    const n = (counters[kind] = (counters[kind] || 0) + 1);
    const id = { door: 'door', window: 'win', 'sliding-door': 'slide', opening: 'open' }[kind] + '-' + n;
    const exterior = !!f.outside;
    const op = { id, kind, style: null, width: f.width, height: 0, sill: 0, wall: f.wall, axis: 'a', at: f.at };
    if (kind === 'door') {
      Object.assign(op, { style: exterior ? (f.width >= 100 ? 'entry' : 'service') : 'interior', height: o.doorHeight, sill: 0, hinge: f.hinge, swing: f.swing });
      if (f.leaves) op.leaves = f.leaves;
      if (f.innerDoor) op.innerDoor = { style: 'interior', width: f.innerDoor.width, height: o.doorHeight, hinge: f.innerDoor.hinge, swing: f.innerDoor.swing };
    } else if (kind === 'sliding-door') Object.assign(op, { style: 'glass-sliding', height: o.doorHeight, sill: 0 });
    else if (kind === 'window') Object.assign(op, { style: f.width <= 90 ? 'tilt' : 'sliding', height: o.windowHeight, sill: o.windowSill });
    else Object.assign(op, { style: 'open', height: o.doorHeight, sill: 0 });
    if (exterior) op.outside = f.outside;
    op.exterior = exterior;
    op.assumed = kind === 'door' ? ['height', 'style'] : kind === 'sliding-door' ? ['height', 'kind'] : kind === 'window' ? ['height', 'sill', 'style'] : ['height'];
    op.confidence = f.confidence;
    op.evidence = f.evidence;
    openings.push(op);
  }
  return { openings, warnings, stats: { gaps: gaps.length, arcs: ctx.arcs.length, doors: openings.filter((x) => x.kind === 'door').length,
    windows: openings.filter((x) => x.kind === 'window').length, other: openings.filter((x) => x.kind !== 'door' && x.kind !== 'window').length } };
}
