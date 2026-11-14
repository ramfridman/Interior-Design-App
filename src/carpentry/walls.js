/**
 * Wall stretches for carpentry: the free straight wall at a point (from geometry.wallFaces() + PLAN.openings),
 * run ↔ plan frames, and conflicts between units and doors / windows.
 *
 * Frame of a run: anchor (x, y) = the LEFT end of the run's back line as seen standing in front of it, `dir` = the units'
 * `rot` (degrees clockwise). along = (cos dir, sin dir), front normal = (−sin dir, cos dir).
 */
import { PLAN } from '../core/plan.js';
import { wallFaces, spaceAt, inWall, openingFrame, openingPoint } from '../core/geometry.js';
import { planOf } from './state.js';

const DEG = Math.PI / 180;
const rnd = (v) => Math.round(v * 1000) / 1000;
/**
 * Unit vectors of a direction. A multiple of 90° (every wall of an orthogonal plan) as before (rounded to 0.001, so
 * exactly 0 / ±1); any other direction — a run along an angled wall (stage A5) — exact (rounded to 1e-12).
 */
export function frame(dir) {
  const r = dir % 90 === 0 ? rnd : rnd12;
  const c = r(Math.cos(dir * DEG)), s = r(Math.sin(dir * DEG));
  return { ux: c, uy: s, nx: -s, ny: c };
}
const rnd12 = (v) => Math.round(v * 1e12) / 1e12;
/** Run-local (along, depth from the back line toward the front) → plan. */
export function toPlan(anchor, along, depth) {
  const f = frame(anchor.dir);
  return [anchor.x + f.ux * along + f.nx * depth, anchor.y + f.uy * along + f.ny * depth];
}
/** Plan → run-local [along, depth]. */
export function toLocal(anchor, x, y) {
  const f = frame(anchor.dir), dx = x - anchor.x, dy = y - anchor.y;
  return [dx * f.ux + dy * f.uy, dx * f.nx + dy * f.ny];
}
/**
 * rot (front direction) from an outward wall normal: whole degrees for a face on an axis (as before); the true direction
 * (to 1e-6°) for the face of an angled wall (stage A5).
 */
export function dirFromNormal(nx, ny) {
  if (nx === 0 || ny === 0) return ((Math.round(Math.atan2(-nx, ny) / DEG) % 360) + 360) % 360;
  return ((Math.round((Math.atan2(-nx, ny) / DEG) * 1e6) / 1e6) % 360 + 360) % 360;
}
/** A face (or face direction) on an axis? */
const onAxis = (f) => f.x1 === f.x2 || f.y1 === f.y2;

const solidAt = (x, y, plan = PLAN) => inWall(x, y, plan);

function distToSeg(px, py, f) {
  const vx = f.x2 - f.x1, vy = f.y2 - f.y1, L2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - f.x1) * vx + (py - f.y1) * vy) / L2));
  return Math.hypot(px - (f.x1 + t * vx), py - (f.y1 + t * vy));
}

/** Wall faces plus the room-side edges of openings collinear with a face (so a click in a doorway finds its wall). */
export function facesWithOpenings(plan) {
  const faces = wallFaces(plan), out = [...faces];
  for (const o of plan.openings) {
    const F = openingFrame(o, plan);
    for (const sgn of [-1, 1]) {
      // the opening's edge on one wall face, and the wall face (same line, same outward normal) it continues
      const [x1, y1] = openingPoint(F, 0, sgn < 0 ? 0 : F.T), [x2, y2] = openingPoint(F, F.L, sgn < 0 ? 0 : F.T);
      const nx = sgn * F.nx, ny = sgn * F.ny;
      const on = o.axis === 'a' ? (x, y) => Math.abs((x - x1) * F.nx + (y - y1) * F.ny) < 0.05 : (x, y) => (x - x1) * F.nx + (y - y1) * F.ny === 0;
      const same = o.axis === 'a' ? (g) => Math.abs(g.nx - nx) < 1e-6 && Math.abs(g.ny - ny) < 1e-6 : (g) => g.nx === nx && g.ny === ny;
      const f = faces.find((g) => same(g) && on(g.x1, g.y1) && on(g.x2, g.y2));
      if (f) out.push({ x1, y1, x2, y2, nx: f.nx, ny: f.ny, opening: o.id });
    }
  }
  return out;
}

/**
 * The free straight wall stretch at (x, y): the nearest wall face (≤ maxDist cm, point on the room side), merged with the
 * collinear faces across the openings in it, up to where the wall turns or ends.
 * Returns null, or { anchor: { x, y, dir }, length, a: [x, y], b: [x, y], normal: [nx, ny], roomId,
 *   ends: { left: 'wall' | 'open', right }, openings: [{ id, kind, style, from, to, width, sill, height, top }], at } — `at` = the
 *   point's position along the stretch (cm from the anchor). Positions are cm from the anchor (left end seen from the room).
 */
export function wallSpanAt(x, y, opts = {}) {
  const plan = opts.plan || PLAN, maxDist = opts.maxDist ?? 40;
  let best = null;
  for (const f of facesWithOpenings(plan)) {
    if ((x - f.x1) * f.nx + (y - f.y1) * f.ny < -1) continue;           // behind the face
    const dd = distToSeg(x, y, f);
    if (dd <= maxDist && (!best || dd < best.dd)) best = { f, dd };
  }
  if (!best) return null;
  if (!onAxis(best.f)) return angledSpan(best.f, x, y, plan);
  const f = best.f, horiz = f.y1 === f.y2, c = horiz ? f.y1 : f.x1;
  const iv = [];
  for (const g of wallFaces(plan)) {
    if (g.nx !== f.nx || g.ny !== f.ny) continue;
    if (horiz ? g.y1 === c && g.y2 === c : g.x1 === c && g.x2 === c) iv.push({ a: horiz ? Math.min(g.x1, g.x2) : Math.min(g.y1, g.y2), b: horiz ? Math.max(g.x1, g.x2) : Math.max(g.y1, g.y2), o: null });
  }
  for (const o of plan.openings) {
    // openings in a wall that runs along the face, with their face on the face's line
    const F = openingFrame(o, plan), sgn = f.nx * F.nx + f.ny * F.ny;
    if (Math.abs(sgn) < 0.999) continue;
    const p = openingPoint(F, 0, sgn > 0 ? F.T : 0), q = openingPoint(F, F.L, sgn > 0 ? F.T : 0);
    if ((horiz ? p[1] : p[0]) === c) iv.push({ a: horiz ? p[0] : p[1], b: horiz ? q[0] : q[1], o });
  }
  iv.sort((p, q) => p.a - q.a || p.b - q.b);
  const p = horiz ? x : y;
  // the merged chain containing p (or the face we found)
  const chains = [];
  for (const s of iv) {
    const last = chains[chains.length - 1];
    if (last && s.a <= last.b + 0.5) { last.b = Math.max(last.b, s.b); last.parts.push(s); } else chains.push({ a: s.a, b: s.b, parts: [s] });
  }
  const fa = horiz ? Math.min(f.x1, f.x2) : Math.min(f.y1, f.y2);
  const chain = chains.find((ch) => fa >= ch.a - 0.5 && fa <= ch.b + 0.5) || chains[0];
  const dir = dirFromNormal(f.nx, f.ny), fr = frame(dir);
  const A = horiz ? [chain.a, c] : [c, chain.a], B = horiz ? [chain.b, c] : [c, chain.b];
  const startPt = (A[0] * fr.ux + A[1] * fr.uy) <= (B[0] * fr.ux + B[1] * fr.uy) ? A : B, endPt = startPt === A ? B : A;
  const anchor = { x: startPt[0], y: startPt[1], dir };
  const length = chain.b - chain.a;
  const along = (px, py) => toLocal(anchor, px, py)[0];
  const openings = chain.parts.filter((s) => s.o).map(({ o, a, b }) => {
    const pa = along(horiz ? a : c, horiz ? c : a), pb = along(horiz ? b : c, horiz ? c : b);
    return { id: o.id, kind: o.kind, style: o.style, from: rnd(Math.min(pa, pb)), to: rnd(Math.max(pa, pb)), width: o.width, sill: o.sill || 0, height: o.height, top: (o.sill || 0) + o.height, hinge: o.hinge, swing: o.swing };
  }).sort((p1, p2) => p1.from - p2.from);
  const endType = (pt, sign) => {
    const [ex, ey] = [pt[0] + fr.ux * sign * 2 + fr.nx * 5, pt[1] + fr.uy * sign * 2 + fr.ny * 5];
    return solidAt(ex, ey, plan) ? 'wall' : 'open';
  };
  const room = spaceAt(x + fr.nx * 10 * Math.sign(1), y + fr.ny * 10, plan) || spaceAt(startPt[0] + fr.nx * 10 + fr.ux * 10, startPt[1] + fr.ny * 10 + fr.uy * 10, plan);
  const span = {
    anchor, length, a: startPt, b: endPt, normal: [f.nx, f.ny], roomId: room && room.kind === 'room' ? room.id : room ? room.id : null,
    ends: { left: endType(startPt, -1), right: endType(endPt, 1) }, openings, at: rnd(Math.max(0, Math.min(length, along(x, y)))),
  };
  return withCorners(span, plan);
}

/**
 * The stretch along the face of an angled wall (stage A5): as above in the face's own direction — the collinear faces of
 * that wall (wallFaces splits it at its openings) merged across the openings whose face lies on the same line, up to
 * where the wall turns or ends. `anchor.dir` is the face's true direction, so units are laid along it at that `rot`.
 */
function angledSpan(f0, x, y, plan) {
  // the outline is on the kernel's 0.001 cm grid, so a face's normal is only good to ~1e-5: take the slant's exact one
  let f = f0;
  for (const sl of plan.slants || []) {
    const L = Math.hypot(sl.x2 - sl.x1, sl.y2 - sl.y1), ux = (sl.x2 - sl.x1) / L, uy = (sl.y2 - sl.y1) / L;
    if (!(L > 0) || Math.abs(ux * f0.nx + uy * f0.ny) > 1e-4) continue;
    const sg = -uy * f0.nx + ux * f0.ny > 0 ? 1 : -1;
    f = { ...f0, nx: sg * -uy + 0, ny: sg * ux + 0 };
    break;
  }
  const dir = dirFromNormal(f.nx, f.ny), fr = frame(dir);
  const c = ((f0.x1 + f0.x2) / 2) * f.nx + ((f0.y1 + f0.y2) / 2) * f.ny, on = (px, py) => Math.abs(px * f.nx + py * f.ny - c) < 0.05;
  const S = (px, py) => px * fr.ux + py * fr.uy, P = (s) => [s * fr.ux + c * f.nx, s * fr.uy + c * f.ny];
  const same = (g) => Math.abs(g.nx - f.nx) < 1e-4 && Math.abs(g.ny - f.ny) < 1e-4;
  const iv = [];
  for (const g of wallFaces(plan)) if (same(g) && on(g.x1, g.y1) && on(g.x2, g.y2)) iv.push({ a: Math.min(S(g.x1, g.y1), S(g.x2, g.y2)), b: Math.max(S(g.x1, g.y1), S(g.x2, g.y2)), o: null });
  for (const o of plan.openings) {
    const F = openingFrame(o, plan), sgn = f.nx * F.nx + f.ny * F.ny;
    if (Math.abs(sgn) < 0.999) continue;
    const p = openingPoint(F, 0, sgn > 0 ? F.T : 0), q = openingPoint(F, F.L, sgn > 0 ? F.T : 0);
    if (on(p[0], p[1]) && on(q[0], q[1])) iv.push({ a: Math.min(S(...p), S(...q)), b: Math.max(S(...p), S(...q)), o });
  }
  iv.sort((p, q) => p.a - q.a || p.b - q.b);
  const chains = [];
  for (const s of iv) {
    const last = chains[chains.length - 1];
    if (last && s.a <= last.b + 0.5) { last.b = Math.max(last.b, s.b); last.parts.push(s); } else chains.push({ a: s.a, b: s.b, parts: [s] });
  }
  const fa = Math.min(S(f0.x1, f0.y1), S(f0.x2, f0.y2));
  const chain = chains.find((ch) => fa >= ch.a - 0.5 && fa <= ch.b + 0.5) || chains[0];
  const startPt = P(chain.a), endPt = P(chain.b), anchor = { x: startPt[0], y: startPt[1], dir }, length = chain.b - chain.a;
  const openings = chain.parts.filter((s) => s.o).map(({ o, a, b }) => ({ id: o.id, kind: o.kind, style: o.style, from: rnd(a - chain.a), to: rnd(b - chain.a), width: o.width, sill: o.sill || 0, height: o.height, top: (o.sill || 0) + o.height, hinge: o.hinge, swing: o.swing }))
    .sort((p1, p2) => p1.from - p2.from);
  const endType = (pt, sign) => (solidAt(pt[0] + fr.ux * sign * 2 + fr.nx * 5, pt[1] + fr.uy * sign * 2 + fr.ny * 5, plan) ? 'wall' : 'open');
  const room = spaceAt(x + fr.nx * 10, y + fr.ny * 10, plan) || spaceAt(startPt[0] + fr.nx * 10 + fr.ux * 10, startPt[1] + fr.ny * 10 + fr.uy * 10, plan);
  const span = {
    anchor, length, a: startPt, b: endPt, normal: [f.nx, f.ny], roomId: room ? room.id : null,
    ends: { left: endType(startPt, -1), right: endType(endPt, 1) }, openings, at: rnd(Math.max(0, Math.min(length, S(x, y) - chain.a))),
  };
  return withCorners(span, plan);
}

/**
 * Corners that are not square (stage A5): at an end of type 'wall', the room-side angle between this face and the wall
 * face that meets it there. Only when one of them differs from 90° by more than 0.5° the span gets
 * `corners: { left?, right? }` = { angle (deg, < 90 acute), inset(depth) → cm a unit `depth` deep must stay back from
 * that end so its front corner clears the wall (0 for an obtuse corner) } — an orthogonal plan never gets the key.
 */
function withCorners(span, plan) {
  const [nx, ny] = span.normal, out = {}, fr = frame(span.anchor.dir);
  for (const side of ['left', 'right']) {
    const pt = side === 'left' ? span.a : span.b, ox = side === 'left' ? -fr.ux : fr.ux, oy = side === 'left' ? -fr.uy : fr.uy;
    let g = null;
    for (const h of wallFaces(plan)) {
      if (Math.abs(h.nx * nx + h.ny * ny) > 0.9999) continue;                         // the same direction (or opposite)
      const d = Math.min(Math.hypot(h.x1 - pt[0], h.y1 - pt[1]), Math.hypot(h.x2 - pt[0], h.y2 - pt[1]));
      if (d < 1.5 && (!g || d < g.d)) g = { d, h };
    }
    // no neighbour, or a square one: the end keeps the probe's answer (an orthogonal plan never gets past here)
    if (!g || Math.abs(g.h.nx * nx + g.h.ny * ny) < 0.0087) continue;
    // the neighbouring face turns towards the room (its normal points back along the run): the wall goes on at an angle
    const concave = g.h.nx * ox + g.h.ny * oy < 0;
    span.ends[side] = concave ? 'wall' : 'open';
    if (!concave) continue;
    const angle = 180 - Math.acos(Math.max(-1, Math.min(1, g.h.nx * nx + g.h.ny * ny))) / DEG;
    const t = Math.tan(angle * DEG);
    out[side] = { angle: Math.round(angle * 10) / 10, with: [g.h.nx, g.h.ny], inset: (depth) => (angle < 90 ? rnd(depth / t) : 0) };
  }
  if (out.left || out.right) span.corners = out;
  return span;
}

/** Room-side angle of a run's end against the wall it meets (null when square or open) and the inset for `depth`. */
export function cornerAt(run, side, span = spanOfRun(run)) {
  const c = span && span.corners && span.corners[side];
  if (!c) return null;
  const at = side === 'left' ? span.runFrom : span.length - span.runTo;
  return at <= c.inset(120) + 1 ? c : null;
}

/** The stretch a run stands on (null for free-standing runs or when the wall has gone), on the run's floor (`run.level`). */
export function spanOfRun(run) {
  if (!run || run.kind === 'island' || run.freeStanding) return null;
  const [px, py] = toPlan(run.anchor, Math.min(5, run.length / 2), 2);
  const s = wallSpanAt(px, py, { maxDist: 6, plan: planOf(run) });
  if (!s || Math.abs(s.anchor.dir - run.anchor.dir) > 1e-6) return null;
  const off = toLocal(s.anchor, run.anchor.x, run.anchor.y);
  if (Math.abs(off[1]) > 1) return null;
  return { ...s, runFrom: rnd(off[0]), runTo: rnd(off[0] + run.length) };
}

const FLOOR = new Set(['base', 'tall', 'full', 'island']);
/**
 * Conflicts of laid-out units with the openings of their wall stretch.
 * `units` = [{ id, level, at, w, elev, h, virtual }] (along cm from the run anchor). Returns [{ code, unitId, opening }].
 * Rules: floor units (base / tall / full) may not cross a door; any unit whose height range meets a window's
 * (sill … sill + height) may not cover it — so a base unit under a window is fine while worktop height ≤ sill.
 */
export function openingConflicts(run, units, span = spanOfRun(run)) {
  const out = [];
  if (!span) return out;
  for (const u of units) {
    if (u.virtual) continue;
    const a = span.runFrom + u.at, b = a + u.w, lo = u.elev, hi = u.elev + u.h;
    for (const o of span.openings) {
      if (Math.min(b, o.to) - Math.max(a, o.from) <= 0.5) continue;
      const isDoor = o.kind !== 'window';
      if (isDoor && (FLOOR.has(u.level) || lo < o.top)) out.push({ code: 'door-crossing', unitId: u.id, opening: o });
      else if (!isDoor && hi > o.sill + 0.01 && lo < o.top) out.push({ code: u.level === 'wall' ? 'window-wall' : u.level === 'base' ? 'window-base' : 'window-tall', unitId: u.id, opening: o });
    }
  }
  return out;
}
