/**
 * Wall stretches for carpentry: the free straight wall at a point (from geometry.wallFaces() + PLAN.openings),
 * run ↔ plan frames, and conflicts between units and doors / windows.
 *
 * Frame of a run: anchor (x, y) = the LEFT end of the run's back line as seen standing in front of it, `dir` = the units'
 * `rot` (degrees clockwise). along = (cos dir, sin dir), front normal = (−sin dir, cos dir).
 */
import { PLAN } from '../core/plan.js';
import { wallFaces, spaceAt, pointInRect } from '../core/geometry.js';

const DEG = Math.PI / 180;
const rnd = (v) => Math.round(v * 1000) / 1000;
/** Unit vectors of a direction. */
export function frame(dir) {
  const c = rnd(Math.cos(dir * DEG)), s = rnd(Math.sin(dir * DEG));
  return { ux: c, uy: s, nx: -s, ny: c };
}
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
/** rot (front direction) from an outward wall normal. */
export function dirFromNormal(nx, ny) { return ((Math.round(Math.atan2(-nx, ny) / DEG) % 360) + 360) % 360; }

const solidAt = (x, y, plan = PLAN) => plan.walls.some((w) => pointInRect(x, y, w));

function distToSeg(px, py, f) {
  const vx = f.x2 - f.x1, vy = f.y2 - f.y1, L2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - f.x1) * vx + (py - f.y1) * vy) / L2));
  return Math.hypot(px - (f.x1 + t * vx), py - (f.y1 + t * vy));
}

/** Wall faces plus the room-side edges of openings collinear with a face (so a click in a doorway finds its wall). */
function facesWithOpenings(plan) {
  const faces = wallFaces(plan), out = [...faces];
  for (const o of plan.openings) {
    const edges = o.axis === 'h' ? [[o.x, o.y, o.x + o.w, o.y], [o.x, o.y + o.h, o.x + o.w, o.y + o.h]] : [[o.x, o.y, o.x, o.y + o.h], [o.x + o.w, o.y, o.x + o.w, o.y + o.h]];
    for (const [x1, y1, x2, y2] of edges) {
      const f = faces.find((g) => (o.axis === 'h' ? g.y1 === y1 && g.y2 === y1 && g.ny !== 0 && (g.ny > 0 ? y1 === o.y + o.h : y1 === o.y) : g.x1 === x1 && g.x2 === x1 && g.nx !== 0 && (g.nx > 0 ? x1 === o.x + o.w : x1 === o.x)));
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
  const f = best.f, horiz = f.y1 === f.y2, c = horiz ? f.y1 : f.x1;
  const iv = [];
  for (const g of wallFaces(plan)) {
    if (g.nx !== f.nx || g.ny !== f.ny) continue;
    if (horiz ? g.y1 === c && g.y2 === c : g.x1 === c && g.x2 === c) iv.push({ a: horiz ? Math.min(g.x1, g.x2) : Math.min(g.y1, g.y2), b: horiz ? Math.max(g.x1, g.x2) : Math.max(g.y1, g.y2), o: null });
  }
  for (const o of plan.openings) {
    if (horiz && o.axis === 'h' && (f.ny > 0 ? o.y + o.h === c : o.y === c)) iv.push({ a: o.x, b: o.x + o.w, o });
    if (!horiz && o.axis === 'v' && (f.nx > 0 ? o.x + o.w === c : o.x === c)) iv.push({ a: o.y, b: o.y + o.h, o });
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
  const openings = chain.parts.filter((s) => s.o).map(({ o }) => {
    const pa = along(horiz ? o.x : c, horiz ? c : o.y), pb = along(horiz ? o.x + o.w : c, horiz ? c : o.y + o.h);
    return { id: o.id, kind: o.kind, style: o.style, from: rnd(Math.min(pa, pb)), to: rnd(Math.max(pa, pb)), width: o.width, sill: o.sill || 0, height: o.height, top: (o.sill || 0) + o.height, hinge: o.hinge, swing: o.swing };
  }).sort((p1, p2) => p1.from - p2.from);
  const endType = (pt, sign) => {
    const [ex, ey] = [pt[0] + fr.ux * sign * 2 + fr.nx * 5, pt[1] + fr.uy * sign * 2 + fr.ny * 5];
    return solidAt(ex, ey, plan) ? 'wall' : 'open';
  };
  const room = spaceAt(x + fr.nx * 10 * Math.sign(1), y + fr.ny * 10, plan) || spaceAt(startPt[0] + fr.nx * 10 + fr.ux * 10, startPt[1] + fr.ny * 10 + fr.uy * 10, plan);
  return {
    anchor, length, a: startPt, b: endPt, normal: [f.nx, f.ny], roomId: room && room.kind === 'room' ? room.id : room ? room.id : null,
    ends: { left: endType(startPt, -1), right: endType(endPt, 1) }, openings, at: rnd(Math.max(0, Math.min(length, along(x, y)))),
  };
}

/** The stretch a run stands on (null for free-standing runs or when the wall has gone). */
export function spanOfRun(run) {
  if (!run || run.kind === 'island' || run.freeStanding) return null;
  const [px, py] = toPlan(run.anchor, Math.min(5, run.length / 2), 2);
  const s = wallSpanAt(px, py, { maxDist: 6 });
  if (!s || s.anchor.dir !== run.anchor.dir) return null;
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
