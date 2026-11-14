/**
 * Angled walls in the plan (stage A3 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md) — the PURE geometry of the 2D tools:
 * angle and length snapping for the wall tool and the end grips, reference lines for parallel / perpendicular guides,
 * grips of a selected angled wall, aligned dimensions (upright text), the angle to the nearest orthogonal wall, the main
 * directions of a room with slanted sides, and compass words for wall ends. No DOM, no canvas: tests/slants-2d.test.mjs.
 *
 * Plan space: cm, +x east, +y SOUTH (screen). A "plan angle" is atan2(dy, dx) in degrees (clockwise on screen); the
 * angle shown to the owner is the usual counter-clockwise one from east (0° east, 90° north): shownAngle().
 */

const DEG = Math.PI / 180;
const norm360 = (d) => ((d % 360) + 360) % 360;
/** Smallest difference of two directions taken as LINES (mod 180), degrees ≥ 0. */
export const lineDelta = (a, b) => { const d = Math.abs(norm360(a - b)) % 180; return Math.min(d, 180 - d); };
/** Smallest difference of two directions (mod 360), degrees ≥ 0. */
export const dirDelta = (a, b) => { const d = norm360(a - b); return Math.min(d, 360 - d); };

/** Plan angle (deg, [0, 360)) of the direction (dx, dy). */
export const planAngle = (dx, dy) => norm360(Math.atan2(dy, dx) / DEG);
/** The angle shown to the owner: counter-clockwise from east, [0, 360), rounded to 0.1°. */
export const shownAngle = (dx, dy) => { const a = Math.round(norm360(-Math.atan2(dy, dx) / DEG) * 10) / 10; return a >= 360 ? 0 : a; };
/** Unit vector of a SHOWN angle (counter-clockwise from east) in plan coordinates. */
export const dirOfShown = (deg) => [Math.cos(deg * DEG) + 0, -Math.sin(deg * DEG) + 0];
/** Unit vector of a plan angle. */
export const dirOf = (deg) => [Math.cos(deg * DEG) + 0, Math.sin(deg * DEG) + 0];

/** Snap reach (degrees) of each kind of angle; 90° and 45° are "stronger" (they reach further). */
export const ANGLE_SNAP = { axis: 6, diag: 4.5, step: 2.5, parallel: 3 };
/** Walls within this distance (cm) of the start point offer parallel / perpendicular directions. */
export const PARALLEL_REACH = 400;
/** Lengths snap to this step (cm). */
export const LENGTH_STEP = 5;

/** Distance from a point to a segment. */
export function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * Reference lines of a plan for parallel / perpendicular snapping: one per wall segment (rect walls: the centre line of the
 * core; angled walls: their centre line). @param segments  wallSegments(plan) (junction squares are skipped)
 * @returns {{ id, x1, y1, x2, y2, deg }[]}  deg = plan angle of the line
 */
export function referenceLines(segments) {
  const out = [];
  for (const s of segments || []) {
    if (!s || (typeof s.id === 'string' && s.id.includes('seg:j:'))) continue;
    if (s.axis === 'a') { out.push({ id: s.id, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, deg: planAngle(s.x2 - s.x1, s.y2 - s.y1), slant: true }); continue; }
    const c = s.core || s;
    if (s.axis === 'h') out.push({ id: s.id, x1: c.x, y1: c.y + c.h / 2, x2: c.x + c.w, y2: c.y + c.h / 2, deg: 0 });
    else out.push({ id: s.id, x1: c.x + c.w / 2, y1: c.y, x2: c.x + c.w / 2, y2: c.y + c.h, deg: 90 });
  }
  return out;
}

/**
 * Snap a direction (plan angle `raw`, degrees) for a wall from `start`:
 *   free           → unchanged (Alt held)
 *   multiples of 90° within ANGLE_SNAP.axis, odd multiples of 45° within ANGLE_SNAP.diag win outright;
 *   otherwise the nearer of a 15° step (within ANGLE_SNAP.step) and a direction parallel / perpendicular to a reference
 *   line within PARALLEL_REACH of the start (within ANGLE_SNAP.parallel).
 * `lenPx` (the drawn length on screen) widens the reach of short lines so they do not flicker.
 * @returns {{ deg:number, kind:'axis'|'45'|'15'|'parallel'|'perp'|null, ref:object|null }}
 */
export function snapAngle(raw, { start = null, lines = [], free = false, lenPx = Infinity } = {}) {
  raw = norm360(raw);
  if (free) return { deg: raw, kind: null, ref: null };
  const widen = Number.isFinite(lenPx) && lenPx > 0 ? Math.atan2(5, lenPx) / DEG : 0;
  const reach = (base) => Math.max(base, widen);
  const step = (k) => norm360(Math.round(raw / k) * k);
  const a90 = step(90);
  if (dirDelta(raw, a90) <= reach(ANGLE_SNAP.axis)) return { deg: a90, kind: 'axis', ref: null };
  const a45 = step(45);
  if (dirDelta(raw, a45) <= reach(ANGLE_SNAP.diag)) return { deg: a45, kind: '45', ref: null };
  let best = null;
  const a15 = step(15), d15 = dirDelta(raw, a15);
  if (d15 <= reach(ANGLE_SNAP.step)) best = { deg: a15, kind: '15', ref: null, d: d15 };
  if (start) {
    for (const r of lines) {
      if (segDist(start.x, start.y, r.x1, r.y1, r.x2, r.y2) > PARALLEL_REACH) continue;
      for (const [kind, off] of [['parallel', 0], ['perp', 90]]) {
        // the direction of that line (either way along it) nearest to the raw direction
        const base = norm360(r.deg + off), cand = dirDelta(raw, base) <= 90 ? base : norm360(base + 180), d = dirDelta(raw, cand);
        if (d <= reach(ANGLE_SNAP.parallel) && (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && best.kind === '15'))) best = { deg: cand, kind, ref: r, d };
      }
    }
  }
  return best ? { deg: best.deg, kind: best.kind, ref: best.ref } : { deg: raw, kind: null, ref: null };
}

/** Snap a length to `step` cm (never below one step). */
export const snapLength = (len, step = LENGTH_STEP) => Math.max(step, Math.round(len / step) * step);

/** Where the ray start + t·u crosses the segment (x1, y1)–(x2, y2): t, or null. */
export function rayCross(sx, sy, ux, uy, x1, y1, x2, y2) {
  const ex = x2 - x1, ey = y2 - y1, den = ux * ey - uy * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((x1 - sx) * ey - (y1 - sy) * ex) / den, v = ((x1 - sx) * uy - (y1 - sy) * ux) / den;
  return v >= -1e-6 && v <= 1 + 1e-6 ? t : null;
}

/**
 * Snap the end of a wall drawn from `start` towards `pointer`, in this order:
 *   1  an existing point (wall-outline corners, wall ends) within `reach` cm of the pointer → exactly that point;
 *   2  the direction (snapAngle; `axisOnly` = only 0 / 90 / 180 / 270, `free` = as drawn);
 *   3  along that direction: a wall face it runs into (ray–face intersection) within `reach` of the pointer's distance,
 *      else an extension line of a wall end (the line through the end along its wall), else the length on LENGTH_STEP;
 *   typed values win: `typedLength` (cm) fixes the length, `typedAngle` (shown degrees) fixes the direction.
 * @param ctx  { points:[[x,y]], faces:[{x1,y1,x2,y2}], ends:[{x,y,ux,uy}], lines (referenceLines), reach (cm), scale,
 *               free, axisOnly, typedLength, typedAngle, step }
 * @returns {{ x, y, len, deg, shown, angleKind, endKind:'point'|'face'|'extension'|'length'|'typed', ref, guides:object[] }}
 */
export function snapWallEnd(start, pointer, ctx = {}) {
  const { points = [], faces = [], ends = [], lines = [], reach = 10, scale = 1, free = false, axisOnly = false, step = LENGTH_STEP } = ctx;
  const typedLen = Number.isFinite(ctx.typedLength) && ctx.typedLength > 0 ? ctx.typedLength : null;
  const typedAng = Number.isFinite(ctx.typedAngle) ? ctx.typedAngle : null;
  const guides = [];
  const dx = pointer.x - start.x, dy = pointer.y - start.y, raw = Math.hypot(dx, dy);
  const out = (x, y, deg, angleKind, endKind, ref) => {
    const len = Math.hypot(x - start.x, y - start.y);
    return { x, y, len, deg, shown: shownAngle(x - start.x, y - start.y), angleKind, endKind, ref, guides };
  };
  // 1 — an existing point (not when a length or an angle was typed)
  if (!typedLen && typedAng == null && !axisOnly) {
    let best = null;
    for (const [x, y] of points) {
      const d = Math.hypot(x - pointer.x, y - pointer.y);
      if (d <= reach && Math.hypot(x - start.x, y - start.y) > step && (!best || d < best.d)) best = { x, y, d };
    }
    if (best) return out(best.x, best.y, planAngle(best.x - start.x, best.y - start.y), null, 'point', null);
  }
  // 2 — the direction
  let a;
  if (typedAng != null) a = { deg: planAngle(...dirOfShown(typedAng)), kind: 'typed', ref: null };
  else if (raw < 1e-6) a = { deg: 0, kind: null, ref: null };
  else if (axisOnly) { const d = planAngle(dx, dy), q = norm360(Math.round(d / 90) * 90); a = { deg: q, kind: 'axis', ref: null }; }
  else a = snapAngle(planAngle(dx, dy), { start, lines, free, lenPx: raw * scale });
  const [ux, uy] = dirOf(a.deg);
  if (a.ref && (a.kind === 'parallel' || a.kind === 'perp')) guides.push({ kind: a.kind, x1: a.ref.x1, y1: a.ref.y1, x2: a.ref.x2, y2: a.ref.y2, ref: a.ref.id });
  // 3 — the length
  const along = Math.max(0, dx * ux + dy * uy);
  if (typedLen) return out(start.x + ux * typedLen, start.y + uy * typedLen, a.deg, a.kind, 'typed', a.ref);
  let hit = null;
  for (const f of faces) {
    const t = rayCross(start.x, start.y, ux, uy, f.x1, f.y1, f.x2, f.y2);
    if (t == null || t <= step) continue;
    const d = Math.abs(t - along);
    if (d <= reach && (!hit || d < hit.d)) hit = { t, d };
  }
  if (hit) return out(start.x + ux * hit.t, start.y + uy * hit.t, a.deg, a.kind, 'face', a.ref);
  let ext = null;
  for (const e of ends) {
    const t = rayCross(start.x, start.y, ux, uy, e.x - e.ux * 1e5, e.y - e.uy * 1e5, e.x + e.ux * 1e5, e.y + e.uy * 1e5);
    if (t == null || t <= step) continue;
    const d = Math.abs(t - along);
    if (d <= reach * 0.8 && (!ext || d < ext.d)) ext = { t, d, e };
  }
  if (ext) {
    const x = start.x + ux * ext.t, y = start.y + uy * ext.t;
    guides.push({ kind: 'extension', x1: ext.e.x, y1: ext.e.y, x2: x, y2: y });
    return out(x, y, a.deg, a.kind, 'extension', a.ref);
  }
  const len = snapLength(along, step);
  return out(start.x + ux * len, start.y + uy * len, a.deg, a.kind, 'length', a.ref);
}

/**
 * The points, faces, wall ends and reference lines the wall tool snaps to, from one plan revision.
 * @param plan      the level view (walls, wallOutline, slants)
 * @param segments  wallSegments(plan)
 * @param faces     wallFaces(plan) (any direction)
 */
export function snapTargets(plan, segments, faces) {
  const pts = new Map();
  for (const [x1, y1, x2, y2] of plan.wallOutline || []) { pts.set(`${x1},${y1}`, [x1, y1]); pts.set(`${x2},${y2}`, [x2, y2]); }
  const ends = [];
  for (const s of segments || []) {
    if (!s || (typeof s.id === 'string' && s.id.includes('seg:j:'))) continue;
    if (s.axis === 'a') {
      const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1, ux = (s.x2 - s.x1) / L, uy = (s.y2 - s.y1) / L;
      pts.set(`${s.x1},${s.y1}`, [s.x1, s.y1]); pts.set(`${s.x2},${s.y2}`, [s.x2, s.y2]);
      ends.push({ x: s.x1, y: s.y1, ux, uy }, { x: s.x2, y: s.y2, ux, uy });
    } else {
      const c = s.core || s, h = s.axis === 'h';
      if (h) ends.push({ x: c.x, y: c.y + c.h / 2, ux: 1, uy: 0 }, { x: c.x + c.w, y: c.y + c.h / 2, ux: 1, uy: 0 });
      else ends.push({ x: c.x + c.w / 2, y: c.y, ux: 0, uy: 1 }, { x: c.x + c.w / 2, y: c.y + c.h, ux: 0, uy: 1 });
    }
  }
  return { points: [...pts.values()], faces: (faces || []).map((f) => ({ x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2 })), ends, lines: referenceLines(segments) };
}

/** Unit frame of a centre line: u along, n = right-hand normal (−uy, ux) on screen ('r' side), length. */
export function lineFrame(x1, y1, x2, y2) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  return { ux, uy, nx: -uy + 0, ny: ux + 0, len };
}

/**
 * Grips of a selected angled wall (CSS px through `toScreen(x, y)`): the body grip 'move' in the middle (drags across the
 * wall: `nx, ny` = the allowed direction) and an end grip on each end ('end0' = (x1, y1) = end 'a', 'end1' = end 'b').
 */
export function slantHandles(seg, toScreen, scale = 1) {
  const f = lineFrame(seg.x1, seg.y1, seg.x2, seg.y2), out = [];
  const P = (x, y) => toScreen(x, y);
  if (f.len * scale >= 30) out.push({ kind: 'move', axis: 'a', ux: f.ux, uy: f.uy, nx: f.nx, ny: f.ny, ...P((seg.x1 + seg.x2) / 2, (seg.y1 + seg.y2) / 2) });
  out.push({ kind: 'end0', axis: 'a', end: 'a', ux: f.ux, uy: f.uy, nx: f.nx, ny: f.ny, ...P(seg.x1, seg.y1) });
  out.push({ kind: 'end1', axis: 'a', end: 'b', ux: f.ux, uy: f.uy, nx: f.nx, ny: f.ny, ...P(seg.x2, seg.y2) });
  return out;
}

/** The grip under a screen point: the nearest within `reach` CSS px (or null). */
export function handleAt(handles, p, reach = 9) {
  let best = null;
  for (const h of handles || []) {
    const d = Math.hypot(h.x - p.x, h.y - p.y);
    if (d <= reach && (!best || d < best.dist)) best = { ...h, dist: d };
  }
  return best;
}

/** CSS cursor for dragging along the plan direction (dx, dy). */
export function cursorFor(dx, dy) {
  const a = ((Math.atan2(dy, dx) / DEG) % 180 + 180) % 180;
  const k = Math.round(a / 45) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][k];
}

/**
 * Text angle (radians) that keeps text along a direction readable: in [−90°, 90°), so a vertical line reads bottom to top
 * as the orthogonal chains do.
 */
export function uprightAngle(rad) {
  let a = Math.atan2(Math.sin(rad), Math.cos(rad));            // (−π, π]
  if (a >= Math.PI / 2 - 1e-9) a -= Math.PI;
  else if (a < -Math.PI / 2 - 1e-9) a += Math.PI;
  return a + 0;
}

/**
 * An aligned dimension between plan points a and b, drawn `offset` cm away on the side of the unit normal (nx, ny):
 * the dimension line, the two extension lines (from `gap` cm off the measured points to `over` cm past the line) and the
 * figure's anchor `text` (`textOff` cm further out, at the middle) with its upright angle.
 * @returns {{ p0:[x,y], p1:[x,y], ext:[[x,y,x,y],[x,y,x,y]], text:{ x, y, angle }, length }}
 */
export function alignedDim(a, b, nx, ny, offset, { gap = 0, over = 0, textOff = 0 } = {}) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const p0 = [a[0] + nx * offset, a[1] + ny * offset], p1 = [b[0] + nx * offset, b[1] + ny * offset];
  const ext = [[a[0] + nx * gap, a[1] + ny * gap, p0[0] + nx * over, p0[1] + ny * over], [b[0] + nx * gap, b[1] + ny * gap, p1[0] + nx * over, p1[1] + ny * over]];
  const m = [(p0[0] + p1[0]) / 2 + nx * textOff, (p0[1] + p1[1]) / 2 + ny * textOff];
  return { p0, p1, ext, text: { x: m[0], y: m[1], angle: uprightAngle(Math.atan2(b[1] - a[1], b[0] - a[0])) }, length: len };
}

/**
 * The aligned dimensions of an angled wall segment: one per face that borders open space (seg.faces.l / .r, stretches in
 * cm along the centre line from (x1, y1)), measured on that face (half the thickness out), chained at the openings in
 * it, offset outwards. @param openings  the openings in this wall ({ at, width })
 * @returns {{ side:'l'|'r', nx, ny, pts:number[] (along the centre line), a:[x,y] (face point at u = 0) }[]}
 */
export function slantFaceDims(seg, openings = []) {
  const f = lineFrame(seg.x1, seg.y1, seg.x2, seg.y2), out = [];
  for (const side of ['l', 'r']) {
    const st = (seg.faces && seg.faces[side]) || [];
    if (!st.length) continue;
    const lo = Math.min(...st.map((q) => q[0])), hi = Math.max(...st.map((q) => q[1]));
    if (hi - lo < 20) continue;
    const sg = side === 'r' ? 1 : -1, nx = sg * f.nx + 0, ny = sg * f.ny + 0, hw = (seg.t || seg.thickness || 0) / 2;
    const pts = [lo];
    for (const o of openings.slice().sort((p, q) => p.at - q.at)) {
      const j0 = o.at - o.width / 2, j1 = o.at + o.width / 2;
      if (j0 > lo + 0.5 && j1 < hi - 0.5) pts.push(j0, j1);
    }
    pts.push(hi);
    out.push({ side, nx, ny, pts, a: [seg.x1 + nx * hw, seg.y1 + ny * hw], ux: f.ux, uy: f.uy });
  }
  return out;
}

/**
 * The angle between an angled wall and the nearest orthogonal (rect) wall touching or near one of its ends — for the
 * small arc beside it. Falls back to north when no rect wall is within `reach` cm.
 * @param rects  rect wall segments ({ axis, core })
 * @returns {{ at:[x,y], wallDeg:number, slantDeg:number, deg:number, ref:'wall'|'north' }}  deg = the acute angle
 *          (0–90, 0.1°); wallDeg / slantDeg = plan angles of the two arms from `at`
 */
export function angleToOrtho(seg, rects = [], reach = 60) {
  let best = null;
  for (const [k, x, y] of [[0, seg.x1, seg.y1], [1, seg.x2, seg.y2]]) {
    for (const r of rects) {
      if (!r || r.axis === 'a' || !r.core) continue;
      const c = r.core, d = Math.hypot(Math.max(c.x - x, 0, x - c.x - c.w), Math.max(c.y - y, 0, y - c.y - c.h));
      if (d <= reach && (!best || d < best.d)) best = { d, k, r };
    }
  }
  const k = best ? best.k : 0, at = k ? [seg.x2, seg.y2] : [seg.x1, seg.y1];
  const slantDeg = k ? planAngle(seg.x1 - seg.x2, seg.y1 - seg.y2) : planAngle(seg.x2 - seg.x1, seg.y2 - seg.y1);
  // the arm of the wall (or north) that makes the acute angle with the slant
  const base = best ? (best.r.axis === 'h' ? 0 : 90) : 270;
  const arms = best ? [base, base + 180] : [270];
  let wallDeg = arms[0], dmin = Infinity;
  for (const w of arms) { const d = dirDelta(slantDeg, w); if (d < dmin) { dmin = d; wallDeg = norm360(w); } }
  const deg = best ? Math.min(dmin, 180 - dmin) : dmin;
  return { at, wallDeg, slantDeg, deg: Math.round(deg * 10) / 10, ref: best ? 'wall' : 'north' };
}

/** Does a polygon have an edge that is neither horizontal nor vertical? */
export const hasSlantedEdge = (poly) => poly.some(([x1, y1], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; return Math.abs(x2 - x1) > 0.01 && Math.abs(y2 - y1) > 0.01; });

/**
 * Main directions of a room: the orthogonal frame (θ, θ + 90°) along which most of its outline runs (edge lengths summed
 * per direction mod 90°, directions within 1° pooled). Returns the plan angle θ in [0, 90).
 */
export function mainDirection(poly) {
  const bins = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length], len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) continue;
    const a = norm360(Math.atan2(y2 - y1, x2 - x1) / DEG) % 90;
    const bin = bins.find((b) => Math.min(Math.abs(b.a - a), 90 - Math.abs(b.a - a)) <= 1);
    if (bin) bin.w += len; else bins.push({ a, w: len });
  }
  if (!bins.length) return 0;
  bins.sort((p, q) => q.w - p.w || p.a - q.a);
  const a = Math.round(bins[0].a * 1000) / 1000;
  return a >= 90 - 0.001 || a <= 0.001 ? 0 : a;
}

/** The clear span of a polygon along the line through (px, py) in direction (ux, uy): [t0, t1] around the point, or null. */
export function spanAlong(poly, px, py, ux, uy) {
  let lo = -Infinity, hi = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const t = rayCross(px, py, ux, uy, x1, y1, x2, y2);
    if (t == null) continue;
    if (t <= 0 && t > lo) lo = t; else if (t > 0 && t < hi) hi = t;
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
/** Compass word of a plan direction (dx, dy): 'north', 'north-east', … (y down = south). */
export const compass8 = (dx, dy) => COMPASS[Math.round(planAngle(dx, dy) / 45) % 8];
/** "north-east" / "south-west" … names of the two ends of a centre line, as seen from its middle. */
export function endNames(x1, y1, x2, y2) {
  const a = compass8(x1 - x2, y1 - y2), b = compass8(x2 - x1, y2 - y1);
  return { a, b };
}
