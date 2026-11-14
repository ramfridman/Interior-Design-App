/**
 * Stairs and openings in floors in the 2D plan (stage F4b of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md, docs/CONTRACT.md
 * § 15). Everything is derived from the stored stair data through core/stairs.js stairGeometry — nothing derived is kept.
 *
 *   On its BOTTOM level a stair is drawn in the architectural convention: outline, a line per riser, landings, the
 *   walking line with a dot at the start and an arrow pointing UP, "UP" and the riser count at the start; the treads
 *   above the cut plane (1.20 m) are dashed beyond a break line (zigzag) across the flight.
 *   On its UPPER level: the opening in the floor (void) is drawn as a dashed outline with a cross, the treads that are
 *   seen through it, and the walking line with an arrow pointing DOWN and "DN" at the arrival.
 *   The ghost of the floor below draws the stairs of that floor faintly (levels.js).
 *
 * Pure helpers (no DOM) for the structure tools and the Node tests: stairsOfLevel, stairGeoOf, hitStair, hitVoid,
 * snapStairBox, wallFacesOf, stairHandles, voidHandles, moveVoidVertex, moveVoidEdge, doorSwingRects, boxGap.
 */
import { pointInPolygon, polygonBounds } from '../core/geometry.js';
import { levelIds, levelOf, levelElevation, voidsOf, GROUND } from '../core/levels.js';
import { stairGeometry } from '../core/stairs.js';
import { wallSegments } from '../core/plan-edit.js';
import { css } from './color.js';

export const CUT = 120;            // cm — the plan's cut plane above the floor: treads above it are dashed
const GRID = 5;

// ───────────── which stairs a level shows ─────────────
const geoCache = new WeakMap();    // stair object → { rise, geo }
/** stairGeometry of a stored stair for a rise (cached per stair object and rise). */
export function stairGeoOf(stair, rise) {
  const hit = geoCache.get(stair);
  if (hit && hit.rise === rise) return hit.geo;
  const geo = rise > 0 ? stairGeometry(stair, { rise }) : null;
  geoCache.set(stair, { rise, geo });
  return geo;
}
/**
 * The stairs to draw on level `id` of the root plan: `bottom` = the stairs that start there (full symbol), `top` = the
 * stairs that arrive there (seen through the void). Each `{ stair, levelId (bottom), to, rise, geo }`.
 */
export function stairsOfLevel(root, id = GROUND) {
  const ids = levelIds(root), bottom = [], top = [];
  ids.forEach((lid, i) => {
    const lv = levelOf(root, lid), list = lv && Array.isArray(lv.stairs) ? lv.stairs : [];
    for (const stair of list) {
      if (!stair || typeof stair.id !== 'string') continue;
      const to = stair.to != null ? (ids.includes(stair.to) && ids.indexOf(stair.to) > i ? stair.to : null) : ids[i + 1] || null;
      if (lid !== id && to !== id) continue;
      const rise = to ? levelElevation(root, to) - levelElevation(root, lid) : 0;
      const geo = stairGeoOf(stair, rise);
      if (!geo) continue;
      (lid === id ? bottom : top).push({ stair, levelId: lid, to, rise, geo });
    }
  });
  return { bottom, top };
}

/** The stair (on level `id`: one that starts there) whose footprint holds the plan point, or null. */
export function hitStair(root, id, x, y) {
  for (const s of stairsOfLevel(root, id).bottom) if (s.geo.footprint.length >= 3 && pointInPolygon(x, y, s.geo.footprint)) return s;
  return null;
}
/** The void of a level view that holds the plan point, or null. */
export function hitVoid(view, x, y) { return voidsOf(view).find((v) => pointInPolygon(x, y, v.polygon)) || null; }

// ───────────── snapping a stair to walls and the grid ─────────────
/**
 * Wall faces of a level view: `{ x: [{ v, lo, hi, side }], y: [...] }` — vertical faces (constant x, spanning y lo–hi)
 * and horizontal ones; `side` = +1 when the wall is on the + side of the face (its west / north face), −1 otherwise.
 */
export function wallFacesOf(view) {
  const xs = [], ys = [];
  for (const s of wallSegments(view)) {
    if (s.axis === 'a') continue;
    xs.push({ v: s.x, lo: s.y, hi: s.y + s.h, side: 1 }, { v: s.x + s.w, lo: s.y, hi: s.y + s.h, side: -1 });
    ys.push({ v: s.y, lo: s.x, hi: s.x + s.w, side: 1 }, { v: s.y + s.h, lo: s.x, hi: s.x + s.w, side: -1 });
  }
  return { x: xs, y: ys };
}
/**
 * Snap a stair's bounding box `{ x, y, w, h }` (plan cm): a side within `tol` cm of a wall face that it can rest against
 * (the wall outside the box, overlapping it along the face) lands flush on it; otherwise the box's west / north side goes
 * to the 5 cm grid. Returns `{ x, y, snapX, snapY }` (snapX / snapY = the face caught, or null).
 */
export function snapStairBox(box, faces, tol = 12) {
  const out = { x: box.x, y: box.y, snapX: null, snapY: null };
  const axis = (k, lo, len, crossLo, crossLen) => {
    let best = null;
    for (const f of faces[k]) {
      if (Math.min(f.hi, crossLo + crossLen) - Math.max(f.lo, crossLo) <= 1) continue;
      // the box's low side against a face with the wall below it (side −1), its high side against one with the wall above
      const cand = f.side < 0 ? f.v : f.v - len, d = Math.abs(cand - lo);
      if (d <= tol && (!best || d < best.d)) best = { d, at: cand, face: f.v };
    }
    return best;
  };
  const sx = axis('x', box.x, box.w, box.y, box.h), sy = axis('y', box.y, box.h, box.x, box.w);
  if (sx) { out.x = sx.at; out.snapX = sx.face; } else out.x = Math.round(box.x / GRID) * GRID;
  if (sy) { out.y = sy.at; out.snapY = sy.face; } else out.y = Math.round(box.y / GRID) * GRID;
  return out;
}

/** Hinged doors' swing squares of a level view (rect openings): `[{ id, x, y, w, h }]`. */
export function doorSwingRects(view) {
  const out = [];
  for (const o of view.openings || []) {
    if (o.kind !== 'door' || o.axis === 'a' || !o.swing) continue;
    const W = o.width || (o.axis === 'h' ? o.w : o.h);
    if (o.axis === 'h') out.push({ id: o.id, x: o.x, y: o.swing === 's' ? o.y + o.h : o.y - W, w: o.w, h: W });
    else out.push({ id: o.id, x: o.swing === 'e' ? o.x + o.w : o.x - W, y: o.y, w: W, h: o.h });
  }
  return out;
}
/** Gap between two boxes (0 when they touch or overlap) and the two nearest points `[ax, ay, bx, by]`. */
export function boxGap(a, b) {
  const cx = (lo0, hi0, lo1, hi1) => (hi0 < lo1 ? [hi0, lo1] : hi1 < lo0 ? [lo0, hi1] : [Math.max(lo0, lo1), Math.max(lo0, lo1)]);
  const [ax, bx] = cx(a.x, a.x + a.w, b.x, b.x + b.w), [ay, by] = cx(a.y, a.y + a.h, b.y, b.y + b.h);
  return { d: Math.hypot(bx - ax, by - ay), pts: [ax, ay, bx, by] };
}

// ───────────── handles ─────────────
/** Screen-space grips of a selected stair: 'stair-rot' beyond its first flight's start… and 'stair-width' on its right side. */
export function stairHandles(geo, cam) {
  if (!geo) return [];
  const f = geo.flights[0], mid = [f.origin[0] + f.dir[0] * f.length / 2, f.origin[1] + f.dir[1] * f.length / 2];
  const right = [mid[0] + f.right[0] * geo.width / 2, mid[1] + f.right[1] * geo.width / 2];
  const back = [geo.start.mid[0] - f.dir[0] * 1, geo.start.mid[1] - f.dir[1] * 1];
  const r = cam.toScreen(right[0], right[1]), b = cam.toScreen(back[0], back[1]);
  const off = 22;
  return [
    { kind: 'stair-rot', x: b.x - f.dir[0] * off, y: b.y - f.dir[1] * off, axis: Math.abs(f.dir[0]) > 0.5 ? 'h' : 'v' },
    { kind: 'stair-width', x: r.x, y: r.y, axis: Math.abs(f.right[0]) > 0.5 ? 'h' : 'v', dir: f.right },
  ];
}
/** Screen-space grips of a selected void: a square per corner ('vc<i>') and a bar per edge ('ve<i>'). */
export function voidHandles(v, cam) {
  const out = [], ring = v.polygon;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length], a = cam.toScreen(p[0], p[1]), b = cam.toScreen(q[0], q[1]);
    out.push({ kind: 'vc' + i, x: a.x, y: a.y, axis: 'c' });
    if (Math.hypot(b.x - a.x, b.y - a.y) > 36) out.push({ kind: 've' + i, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, axis: Math.abs(q[0] - p[0]) > Math.abs(q[1] - p[1]) ? 'h' : 'v' });
  });
  return out;
}
/** Move corner `i` of an orthogonal ring to (x, y); its two neighbours follow so every edge stays horizontal / vertical. */
export function moveVoidVertex(ring, i, x, y) {
  const n = ring.length, out = ring.map((p) => p.slice()), was = ring[i];
  const prev = (i - 1 + n) % n, next = (i + 1) % n;
  for (const k of [prev, next]) {
    const p = ring[k];
    if (Math.abs(p[0] - was[0]) < 1e-6) out[k][0] = x; else if (Math.abs(p[1] - was[1]) < 1e-6) out[k][1] = y;
  }
  out[i] = [x, y];
  return out;
}
/** Move edge `i` (corner i → i + 1) of an orthogonal ring sideways so it passes through (x, y). */
export function moveVoidEdge(ring, i, x, y) {
  const n = ring.length, a = ring[i], b = ring[(i + 1) % n], out = ring.map((p) => p.slice());
  if (Math.abs(a[0] - b[0]) < 1e-6) { out[i][0] = x; out[(i + 1) % n][0] = x; } else if (Math.abs(a[1] - b[1]) < 1e-6) { out[i][1] = y; out[(i + 1) % n][1] = y; }
  return out;
}

// ───────────── drawing ─────────────
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
function pathRing(G, ring) {
  const { ctx } = G;
  ctx.beginPath();
  ring.forEach((p, i) => (i ? ctx.lineTo(G.X(p[0]), G.Y(p[1])) : ctx.moveTo(G.X(p[0]), G.Y(p[1]))));
  ctx.closePath();
}
function line(G, a, b) { G.ctx.moveTo(G.X(a[0]), G.Y(a[1])); G.ctx.lineTo(G.X(b[0]), G.Y(b[1])); }
/** Arrow head at plan point `tip` pointing along the unit plan vector `d` (device px size). */
function arrowHead(G, tip, d, size) {
  const { ctx } = G, x = G.X(tip[0]), y = G.Y(tip[1]), nx = -d[1], ny = d[0];
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - d[0] * size + nx * size * 0.45, y - d[1] * size + ny * size * 0.45);
  ctx.lineTo(x - d[0] * size - nx * size * 0.45, y - d[1] * size - ny * size * 0.45);
  ctx.closePath(); ctx.fill();
}
/** Position along a flight (s from its start edge) where the cut plane passes, or null when it does not cross it. */
function cutAt(geo, f) {
  if (f.length <= 0 || f.h1 <= CUT || f.h0 >= CUT) return null;
  return Math.max(0, Math.min(f.length, (CUT / geo.riser - f.firstRiser) * geo.going));
}

/**
 * The full symbol of one stair (its bottom level). opts: { color, alpha, cut (draw the break line, default true),
 * label (UP + risers, default true), fill }.
 */
export function drawStairSymbol(G, pal, geo, opts = {}) {
  const { ctx } = G, d = G.dpr, color = opts.color || pal.ink, cut = opts.cut !== false;
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
  // body
  pathRing(G, geo.footprint);
  ctx.fillStyle = opts.fill || css(pal.paper, 0.6); ctx.fill();
  for (const l of geo.landings) { pathRing(G, l.poly); ctx.fillStyle = css(color, 0.05); ctx.fill(); }
  // riser lines: solid below the cut plane, dashed above it
  const solid = [], hidden = [], breaks = [];
  for (const f of geo.flights) {
    const sc = cut ? cutAt(geo, f) : null;
    const above = (h) => cut && h > CUT + 1e-6;
    for (const t of f.treads) (above(t.h) ? hidden : solid).push([t.poly[0], t.poly[1]]);
    if (f.treads.length) { const t = f.treads.at(-1); (above(f.h1) ? hidden : solid).push([t.poly[3], t.poly[2]]); }
    if (sc != null && sc > 0 && sc < f.length) breaks.push({ f, s: sc });
  }
  ctx.lineWidth = Math.max(1, d); ctx.strokeStyle = color;
  ctx.beginPath(); for (const [a, b] of solid) line(G, a, b); ctx.stroke();
  if (hidden.length) {
    ctx.setLineDash([3 * d, 3 * d]); ctx.strokeStyle = css(color, 0.55);
    ctx.beginPath(); for (const [a, b] of hidden) line(G, a, b); ctx.stroke();
    ctx.setLineDash([]); ctx.strokeStyle = color;
  }
  // break line: a zigzag across the flight where it passes the cut plane
  for (const { f, s } of breaks) {
    const W = geo.width, P = (u, v) => add(add(f.origin, mul(f.dir, v)), mul(f.right, u));
    const k = 14, pts = [P(-W / 2 - 6, s - k), P(-W * 0.08, s - k * 0.15), P(W * 0.02, s - k * 0.6), P(W * 0.1, s + k * 0.15), P(W / 2 + 6, s + k)];
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(G.X(p[0]), G.Y(p[1])) : ctx.moveTo(G.X(p[0]), G.Y(p[1]))));
    ctx.lineWidth = Math.max(1, 1.25 * d); ctx.stroke(); ctx.lineWidth = Math.max(1, d);
  }
  // outline
  pathRing(G, geo.footprint);
  ctx.lineWidth = Math.max(1, 1.5 * d); ctx.stroke();
  // walking line: a dot at the start, an arrow pointing up at the arrival
  const wl = geo.walkingLine;
  ctx.beginPath(); wl.forEach((p, i) => (i ? ctx.lineTo(G.X(p[0]), G.Y(p[1])) : ctx.moveTo(G.X(p[0]), G.Y(p[1]))));
  ctx.lineWidth = Math.max(1, d); ctx.strokeStyle = color; ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(G.X(wl[0][0]), G.Y(wl[0][1]), 2.6 * d, 0, Math.PI * 2); ctx.fill();
  const last = wl.at(-1), prev = wl.at(-2) || wl[0], L = Math.hypot(last[0] - prev[0], last[1] - prev[1]) || 1;
  arrowHead(G, last, [(last[0] - prev[0]) / L, (last[1] - prev[1]) / L], 9 * d);
  if (opts.label !== false && G.scale * geo.width > 34) {
    const f = geo.flights[0], at = add(f.origin, mul(f.dir, Math.min(f.length, geo.going * 1.6)));
    const size = Math.min(11, Math.max(8, G.scale * 9));
    G.text('UP', G.X(at[0]), G.Y(at[1]), { size, weight: 700, color, halo: css(pal.paper, 0.9) });
    const at2 = add(at, mul(f.dir, Math.min(f.length * 0.5, geo.going * 1.3)));
    G.text(`${geo.risers} R`, G.X(at2[0]), G.Y(at2[1]), { size: size - 1, weight: 500, color, halo: css(pal.paper, 0.9) });
  }
  ctx.restore();
}

/**
 * What of a stair is seen on its UPPER level: the treads inside the level's voids, the walking line through them with an
 * arrow pointing down and "DN" at the arrival.
 */
function drawStairArrival(G, pal, geo, voids, opts = {}) {
  const { ctx } = G, d = G.dpr, color = opts.color || pal.inkSoft;
  const inVoid = (p) => voids.some((v) => pointInPolygon(p[0], p[1], v.polygon));
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1, d);
  ctx.beginPath();
  for (const f of geo.flights) for (const t of f.treads) {
    const c = [(t.poly[0][0] + t.poly[2][0]) / 2, (t.poly[0][1] + t.poly[2][1]) / 2];
    if (inVoid(c)) { line(G, t.poly[0], t.poly[1]); line(G, t.poly[1], t.poly[2]); line(G, t.poly[3], t.poly[0]); }
  }
  ctx.stroke();
  // walking line down from the arrival, as far as it stays in the void
  const wl = geo.walkingLine.slice().reverse(), pts = [wl[0]];
  for (let i = 1; i < wl.length; i++) {
    const a = wl[i - 1], b = wl[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = 0;
    for (; s + 5 <= L; s += 5) if (!inVoid([a[0] + ((b[0] - a[0]) * (s + 5)) / L, a[1] + ((b[1] - a[1]) * (s + 5)) / L])) break;
    pts.push([a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L]);
    if (s + 5 <= L) break;
  }
  if (pts.length > 1) {
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(G.X(p[0]), G.Y(p[1])) : ctx.moveTo(G.X(p[0]), G.Y(p[1])))); ctx.stroke();
    const tip = pts.at(-1), from = pts.at(-2), L = Math.hypot(tip[0] - from[0], tip[1] - from[1]) || 1;
    if (L > 8) arrowHead(G, tip, [(tip[0] - from[0]) / L, (tip[1] - from[1]) / L], 9 * d);
  }
  if (G.scale * geo.width > 34) {
    const a = geo.arrival, at = add(a.mid, mul(a.dir, -Math.min(geo.going * 1.4, 45)));
    G.text('DN', G.X(at[0]), G.Y(at[1]), { size: Math.min(11, Math.max(8, G.scale * 9)), weight: 700, color: pal.ink, halo: css(pal.paper, 0.9) });
  }
  ctx.restore();
}

/** An opening in the floor: the floor fill taken out, a dashed outline and a cross. */
export function drawVoid(G, pal, v, opts = {}) {
  const { ctx } = G, d = G.dpr, ring = v.polygon;
  ctx.save();
  pathRing(G, ring);
  ctx.fillStyle = opts.fill || pal.paper; ctx.fill();
  ctx.fillStyle = css(pal.ink, pal.dark ? 0.1 : 0.05); ctx.fill();
  const b = polygonBounds(ring);
  ctx.save(); pathRing(G, ring); ctx.clip();
  ctx.beginPath(); line(G, [b.x, b.y], [b.x + b.w, b.y + b.h]); line(G, [b.x + b.w, b.y], [b.x, b.y + b.h]);
  ctx.strokeStyle = css(pal.ink, 0.22); ctx.lineWidth = Math.max(1, d); ctx.stroke();
  ctx.restore();
  pathRing(G, ring);
  ctx.setLineDash([6 * d, 4 * d]); ctx.strokeStyle = opts.color || css(pal.ink, 0.75); ctx.lineWidth = Math.max(1, 1.25 * d); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/** Layer of the cached plan (under the walls): the level's voids, then its stairs and the stairs arriving through them. */
export function drawStairs(G, env) {
  const root = env.rootPlan, view = env.plan, id = env.level || GROUND, pal = env.pal;
  if (!root || (!voidsOf(view).length && !root.stairs && !(root.levels || []).some((l) => l.stairs))) return;
  const voids = voidsOf(view);
  for (const v of voids) { const b = polygonBounds(v.polygon); if (G.visible(b.x, b.y, b.x + b.w, b.y + b.h)) drawVoid(G, pal, v); }
  const { bottom, top } = stairsOfLevel(root, id);
  for (const s of top) drawStairArrival(G, pal, s.geo, voids);
  for (const s of bottom) {
    const b = polygonBounds(s.geo.footprint);
    if (G.visible(b.x - 20, b.y - 20, b.x + b.w + 20, b.y + b.h + 20)) drawStairSymbol(G, pal, s.geo, { color: pal.ink });
  }
}

/** The stairs of the floor below, for its ghost (faint, no labels). */
export function drawStairsGhost(G, env, belowId) {
  const { bottom } = stairsOfLevel(env.rootPlan, belowId);
  for (const s of bottom) drawStairSymbol(G, env.pal, s.geo, { color: env.pal.ink, cut: false, label: false, fill: 'rgba(0,0,0,0)' });
}

/** Fingerprint of what this layer draws on a level (for the partial repaint after a plan edit). */
export function stairsSnapshot(root, view, id) {
  const out = new Map();
  for (const v of voidsOf(view)) out.set('v:' + v.id, { sig: JSON.stringify(v), rect: polygonBounds(v.polygon) });
  const { bottom, top } = stairsOfLevel(root, id);
  for (const s of [...bottom, ...top]) out.set('s:' + s.stair.id, { sig: JSON.stringify([s.stair, s.rise]), rect: polygonBounds(s.geo.footprint) });
  return out;
}
