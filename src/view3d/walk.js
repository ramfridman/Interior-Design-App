/**
 * Walk mode — first-person walk-through of the house and garden.
 *
 * Movement : WASD / arrows (← → turn, A D strafe), Q / E turn, Shift run, gamepad sticks, touch joystick (left half).
 * Looking  : Pointer Lock when the browser grants it, otherwise click-drag; touch: drag on the right half.
 * Glide    : click / tap a spot (no drag) to glide there.
 * Collision: the walker is a circle tested against rotated rectangles (walls + windows from walkBoxes(), tall floor
 *            furniture). Motion is sub-stepped (≤ 8 cm) and penetrations are pushed out along the contact normal, which
 *            gives wall sliding without corner jitter or tunnelling. Blockers that contain the walker when a move starts
 *            are ignored until they have been left.
 *
 * Plan units inside this module are METRES (x east, y south); the public API speaks plan centimetres.
 */
import * as THREE from 'three';
import { walkBoxes, spaceAt, openingFrame, pointInPolygon } from '../core/geometry.js';
import { groundY } from './items.js';
import { validLevel, viewOf, itemLevel, elevationM, GROUND } from './levels.js';
import { sideVec, sideHeading } from './camera.js';
import { stairGeometry, floorHeightAt, stairSides } from '../core/stairs.js';
import { levelIds, levelElevation, levelHeights, footprintOf, voidsOf } from '../core/levels.js';
import { pointInPolys } from '../core/polykernel.js';

export const EYE_HEIGHT = 1.65;
export const WALKER_RADIUS = 0.22;
const WALK_SPEED = 1.4, RUN_SPEED = 3.0, TOUCH_SPEED = 2.1, TURN_SPEED = 1.9;
const SUB_STEP = 0.08, LOT_MARGIN = 0.3, EMIT_MS = 1000 / 15;
const PITCH_LIMIT = THREE.MathUtils.degToRad(80);
/** Floor-standing types you can walk across or under. */
const PASSABLE = new Set(['rug', 'surface', 'flower-bed', 'pergola', 'parasol', 'play', 'cushion']);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Vertical FOV for walk mode: ~72° on narrow views, a little tighter on wide screens to avoid edge stretching. */
export function walkFov(aspect) {
  const v = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(48)) / Math.max(0.3, aspect)));
  return clamp(v, 60, 72);
}

/**
 * Default start: just inside the entrance door, looking along its swing direction into the house. An upper level (a
 * level view with `levelId`) has no entrance: the middle of its largest room, looking north.
 */
export function defaultWalkStart(plan) {
  if (plan.levelId && plan.levelId !== GROUND) {
    let best = null, area = 0;
    for (const r of plan.rooms || []) {
      const p = r.polygon, a = Math.abs(p.reduce((s, q, i) => { const b = p[(i + 1) % p.length]; return s + q[0] * b[1] - b[0] * q[1]; }, 0)) / 2;
      if (a > area) { area = a; best = r; }
    }
    if (best) {
      const at = Array.isArray(best.label) ? best.label : best.polygon.reduce((s, q) => [s[0] + q[0] / best.polygon.length, s[1] + q[1] / best.polygon.length], [0, 0]);
      return { x: at[0], y: at[1], heading: 0 };
    }
  }
  const door = plan.openings.find((o) => o.id === 'door-entry') || plan.openings.find((o) => o.kind === 'door' && o.exterior);
  if (!door) return { x: plan.bounds.x + plan.bounds.w / 2, y: plan.bounds.y + plan.bounds.h / 2, heading: 0 };
  const inward = door.swing || { n: 's', s: 'n', e: 'w', w: 'e' }[door.outside] || 'w';
  const F = openingFrame(door, plan), v = sideVec(inward), depth = F.T / 2 + 55;
  return { x: F.cx + v[0] * depth, y: F.cy + v[1] * depth, heading: sideHeading(inward) };
}

/** Oriented box in plan cm (walkBoxes()) → walker blocker in metres. */
const boxBlocker = (b) => ({ cx: b.cx / 100, cy: b.cy / 100, hw: b.hw / 100, hh: b.hh / 100, cos: b.cos, sin: b.sin, wall: true });
/** Collision boxes (metres) of the plan's walls and windows. */
export const wallBlockers = (plan) => walkBoxes({ ...plan }).map(boxBlocker);

function furnitureBlockers(items, models, onLevel = null) {
  const out = [];
  const carp = models && typeof models.getModel === 'function' ? models.getModel('carpentry-unit') : null;
  for (const it of items) {
    if ((onLevel && !onLevel(it)) || it.hidden || it.placement !== 'floor' || !(it.h > 45) || (it.elev || 0) > 120 || PASSABLE.has(it.type)) continue;
    const a = ((it.rot || 0) * Math.PI) / 180;
    // a corner pantry blocks its two arms, not the open floor inside its L
    const fp = it.carp && carp && carp.footprint ? carp.footprint(it) : null;
    if (fp && fp.rects) {
      const c = Math.cos(a), s = Math.sin(a);
      for (const r of fp.rects) { const lx = r.x + r.w / 2, ly = r.y + r.h / 2; out.push({ cx: (it.x + lx * c - ly * s) / 100, cy: (it.y + lx * s + ly * c) / 100, hw: r.w / 200, hh: r.h / 200, cos: c, sin: s, id: it.id }); }
      continue;
    }
    if (it.type === 'tree') { const t = clamp(Math.min(it.w, it.d) * 0.0008, 0.1, 0.3); out.push({ cx: it.x / 100, cy: it.y / 100, hw: t, hh: t, cos: 1, sin: 0 }); continue; }
    out.push({ cx: it.x / 100, cy: it.y / 100, hw: it.w / 200, hh: it.d / 200, cos: Math.cos(a), sin: Math.sin(a), id: it.id });
  }
  return out;
}

/** Signed gap between a circle centre and a blocker: ≥ r means clear, < 0 means the centre is inside. */
function gap(p, b) {
  const dx = p.x - b.cx, dy = p.y - b.cy;
  const lx = dx * b.cos + dy * b.sin, ly = -dx * b.sin + dy * b.cos;
  const ox = Math.abs(lx) - b.hw, oy = Math.abs(ly) - b.hh;
  if (ox <= 0 && oy <= 0) return Math.max(ox, oy);
  return Math.hypot(Math.max(ox, 0), Math.max(oy, 0));
}

/** Push the circle out of every (non-ignored) blocker it overlaps. */
function resolve(p, r, blockers, ignore) {
  for (let iter = 0; iter < 6; iter++) {
    let moved = false;
    for (const b of blockers) {
      if (ignore && ignore.has(b)) continue;
      const dx = p.x - b.cx, dy = p.y - b.cy;
      if (Math.abs(dx) > b.hw + b.hh + r || Math.abs(dy) > b.hw + b.hh + r) continue;
      const lx = dx * b.cos + dy * b.sin, ly = -dx * b.sin + dy * b.cos;
      const qx = clamp(lx, -b.hw, b.hw), qy = clamp(ly, -b.hh, b.hh);
      let nx = lx - qx, ny = ly - qy, push;
      const d2 = nx * nx + ny * ny;
      if (d2 >= r * r) continue;
      if (d2 > 1e-12) { const d = Math.sqrt(d2); nx /= d; ny /= d; push = r - d; }
      else {
        const px = b.hw - Math.abs(lx), py = b.hh - Math.abs(ly);
        if (px < py) { nx = lx < 0 ? -1 : 1; ny = 0; push = px + r; } else { nx = 0; ny = ly < 0 ? -1 : 1; push = py + r; }
      }
      p.x += (nx * b.cos - ny * b.sin) * (push + 1e-4);
      p.y += (nx * b.sin + ny * b.cos) * (push + 1e-4);
      moved = true;
    }
    if (!moved) return;
  }
}

// ───────────── stairs and voids (stage F5: walking between floors) ─────────────
// Plan cm in, walker boxes in metres out. A plan without stairs and voids gets none of this (one-level plans walk
// exactly as before).
const STEP_ON = 30;                 // cm: a stair surface within this of the floor underfoot can be stepped onto
const HEADROOM_MIN = 180;           // cm: clear height under a flight / landing below this blocks a walker under it
const WAIST = 18, LANDING_T = 20;   // cm: depth of a flight's waist / a landing slab (as view3d/stairs.js draws them)
const GUARD_T = 0.04;               // m: thickness of a guard / railing as a blocker
const STAIR_SPEED = 0.7;            // speed factor on a stair
const UPPER_WALLS = 200;            // cm: an upper level's walls block a walker on the stair within this below its floor
const NEAR_FLOOR_ITEMS = 60;        // cm: furniture of a floor blocks a walker on the stair within this of that floor

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/** Blocker (m) along the plan segment a → b (cm), `t` m thick, lying on its `out` side (unit vector). */
function segBox(a, b, out, t = GUARD_T) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1) return null;
  return { cx: (a[0] + b[0]) / 200 + (out[0] * t) / 2, cy: (a[1] + b[1]) / 200 + (out[1] * t) / 2, hw: L / 200, hh: t / 2, cos: (b[0] - a[0]) / L, sin: (b[1] - a[1]) / L, fixed: true };
}
/** Blocker (m) over a flight between s0 and s1 cm along it, its full width. */
function flightBox(f, W, s0, s1) {
  const c = [f.origin[0] + f.dir[0] * (s0 + s1) / 2, f.origin[1] + f.dir[1] * (s0 + s1) / 2];
  return { cx: c[0] / 100, cy: c[1] / 100, hw: (s1 - s0) / 200, hh: W / 200, cos: f.dir[0], sin: f.dir[1], fixed: true };
}
/** Blocker (m) over a rectangular ring (cm). */
function ringBox(r) {
  const L1 = Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]), L2 = Math.hypot(r[2][0] - r[1][0], r[2][1] - r[1][1]);
  const c = r.reduce((s, q) => [s[0] + q[0] / r.length, s[1] + q[1] / r.length], [0, 0]);
  return L1 < 1 || L2 < 1 ? null : { cx: c[0] / 100, cy: c[1] / 100, hw: L1 / 200, hh: L2 / 200, cos: (r[1][0] - r[0][0]) / L1, sin: (r[1][1] - r[0][1]) / L1, fixed: true };
}
/** The part [t0, t1] (0..1) of a side run, with its pitch heights. */
const sidePart = (sd, t0, t1) => ({ ...sd, a: lerp2(sd.a, sd.b, t0), b: lerp2(sd.a, sd.b, t1), ha: sd.ha + (sd.hb - sd.ha) * t0, hb: sd.ha + (sd.hb - sd.ha) * t1 });

/**
 * The stairs of a plan as the walker uses them: `[{ id, stair, geo, bottom, to, rise, base, underside, guard, low }]`
 * (rise / underside cm above the bottom floor; base m = the bottom level's elevation). `guard` = the blockers of a walker
 * ON the stair (every side, open or along a wall — except the first tread, which can be left sideways); `low` = the
 * blockers of a walker on the bottom floor next to / under it (the sides and the underside where the clear height is
 * below 1.80 m; the start stays open for a first step of up to 30 cm).
 */
export function walkStairs(root) {
  const ids = levelIds(root), out = [];
  ids.forEach((id, i) => {
    const view = viewOf(root, id);
    for (const st of view.stairs || []) {
      if (!st || typeof st.id !== 'string') continue;
      const to = st.to && ids.includes(st.to) ? st.to : (st.to ? null : ids[i + 1]);   // as view3d/house.js
      if (!to) continue;
      const rise = levelElevation(root, to) - levelElevation(root, id);
      const geo = rise > 0 ? stairGeometry(st, { rise }) : null;
      if (!geo || geo.footprint.length < 3) continue;
      const R = geo.riser, G = geo.going, W = geo.width, f0 = geo.flights[0];
      const free0 = Math.max(G, WALKER_RADIUS * 100 + 2);
      const guardSides = [];
      for (const raw of stairSides(st, geo, view)) {
        // sides as the walker needs them: `outward` really pointing off the stair, landing edges at the landing's height
        const m = lerp2(raw.a, raw.b, 0.5), off = pointInPolygon(m[0] + raw.outward[0] * 2, m[1] + raw.outward[1] * 2, geo.footprint);
        const lh = raw.piece === 'landing' && geo.landings[raw.index] ? geo.landings[raw.index].h : null;
        const sd = { ...raw, outward: off ? [-raw.outward[0], -raw.outward[1]] : raw.outward, ...(lh != null ? { ha: lh, hb: lh } : {}) };
        if (sd.piece === 'flight' && sd.index === 0) {
          const L = Math.hypot(sd.b[0] - sd.a[0], sd.b[1] - sd.a[1]), sa = dot2(sub(sd.a, f0.origin), f0.dir), sb = dot2(sub(sd.b, f0.origin), f0.dir);
          if (Math.max(sa, sb) <= free0 || L < 1) continue;
          if (Math.min(sa, sb) < free0) { const t = (free0 - sa) / (sb - sa); guardSides.push(sa < sb ? sidePart(sd, t, 1) : sidePart(sd, 0, t)); continue; }
        }
        guardSides.push(sd);
      }
      const guard = guardSides.map((sd) => segBox(sd.a, sd.b, sd.outward)).filter(Boolean);
      // from the bottom floor: the sides up to where the stair's underside clears 1.80 m, the underside itself below that
      const low = [], pMax = HEADROOM_MIN + R + WAIST;
      for (const sd of guardSides) {
        if (Math.min(sd.ha, sd.hb) >= pMax) continue;
        let part = sd;
        if (Math.max(sd.ha, sd.hb) > pMax) { const t = (pMax - sd.ha) / (sd.hb - sd.ha); part = sd.ha < sd.hb ? sidePart(sd, 0, t) : sidePart(sd, t, 1); }
        const b = segBox(part.a, part.b, part.outward);
        if (b) low.push(b);
      }
      for (const f of geo.flights) {
        if (!(f.length > 0)) continue;
        const slope = (f.h1 - f.h0) / f.length;
        const lo = f.index === 0 ? Math.max(STEP_ON / slope, WALKER_RADIUS * 100 + 5) : 0;
        const hi = Math.min(f.length, ((HEADROOM_MIN + WAIST - f.h0) * G) / R);
        if (hi > lo + 1) low.push(flightBox(f, W, lo, hi));
      }
      for (const l of geo.landings) if (l.h - LANDING_T < HEADROOM_MIN && l.poly.length === 4) { const b = ringBox(l.poly); if (b) low.push(b); }
      out.push({ id: st.id, stair: st, geo, bottom: id, to, rise, base: elevationM(root, id), underside: rise - ((levelHeights(root, to) || {}).slab || 0), guard, low });
    }
  });
  return out;
}

/**
 * Railings round the voids of a level, as blockers (m) set on the floor side of each edge — except where a stair
 * arrives: the stair's arrival edge (when it lies on the void's edge; otherwise the void edge facing its arrival,
 * as view3d/house.js leaves its railing open). A void without a railing blocks the same: nobody falls through.
 */
export function voidBoxes(root, id, stairs) {
  const voids = voidsOf(viewOf(root, id));
  if (!voids.length) return [];
  const arrivals = stairs.filter((s) => s.to === id).map((s) => ({ ...s.geo.arrival, matched: false }));
  const edges = [];
  for (const v of voids) {
    const ring = v.polygon, sgn = Math.sign(ring.reduce((s, p, i) => { const b = ring[(i + 1) % ring.length]; return s + p[0] * b[1] - b[0] * p[1]; }, 0)) || 1;
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1) return;
      const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], out = [u[1] * sgn, -u[0] * sgn];   // outward from the void, onto the floor
      let keep = [[0, L]];
      for (const ar of arrivals) {
        if (dot2(out, ar.dir) < 0.9) continue;
        const da = dot2(sub(ar.a, a), out), db = dot2(sub(ar.b, a), out);
        if (Math.abs(da) > 2 || Math.abs(db) > 2) continue;
        const t0 = Math.min(dot2(sub(ar.a, a), u), dot2(sub(ar.b, a), u)), t1 = Math.max(dot2(sub(ar.a, a), u), dot2(sub(ar.b, a), u));
        if (t1 < 0 || t0 > L) continue;
        ar.matched = true;
        keep = keep.flatMap(([k0, k1]) => [[k0, Math.min(k1, t0)], [Math.max(k0, t1), k1]].filter(([p, q]) => q - p > 1));
      }
      edges.push({ v, a, u, out, keep });
    });
  }
  // a stair arriving inside a void (not on its edge): that void's edges facing the arrival stay open
  for (const ar of arrivals) {
    if (ar.matched) continue;
    const probe = [ar.mid[0] - ar.dir[0] * 5, ar.mid[1] - ar.dir[1] * 5];
    for (const e of edges) if (dot2(e.out, ar.dir) > 0.9 && pointInPolygon(probe[0], probe[1], e.v.polygon)) e.keep = [];
  }
  const out = [];
  for (const e of edges) for (const [k0, k1] of e.keep) { const b = segBox([e.a[0] + e.u[0] * k0, e.a[1] + e.u[1] * k0], [e.a[0] + e.u[0] * k1, e.a[1] + e.u[1] * k1], e.out); if (b) out.push(b); }
  return out;
}

/**
 * Where a walker on an upper level has a floor under its feet (plan cm → bool): inside the footprint of its level or
 * of a level below (a terrace on the roof below), and not over a void of its level. null on the ground floor (anywhere).
 */
function floorTest(root, id) {
  if (id === GROUND) return null;
  const ids = levelIds(root), k = ids.indexOf(id);
  const fps = ids.slice(0, k + 1).map((l) => footprintOf(viewOf(root, l)).polygons).filter((p) => p.length);
  const voids = voidsOf(viewOf(root, id));
  return (x, y) => fps.some((p) => pointInPolys(x, y, p) !== 0) && !voids.some((v) => pointInPolygon(x, y, v.polygon));
}

const css = (el, text) => { el.style.cssText = text; return el; };

/**
 * @param {{ camera: THREE.PerspectiveCamera, dom: HTMLElement, overlay: HTMLElement, ctx: object,
 *           pickTarget: (clientX: number, clientY: number) => ({x: number, y: number}|null),
 *           emit: (event: string, payload: object) => void, requestExit: () => void,
 *           onLevelChange?: (levelId: string) => void }} o   onLevelChange: the walker went up / down a stair onto another level
 */
export function createWalk({ camera, dom, overlay, ctx, pickTarget, emit, requestExit, onLevelChange = null }) {
  const { store } = ctx;
  const sb = ctx.plan.site.bounds;
  const lot = { x0: sb.x / 100 - LOT_MARGIN, x1: (sb.x + sb.w) / 100 + LOT_MARGIN, y0: sb.y / 100 - LOT_MARGIN, y1: (sb.y + sb.h) / 100 + LOT_MARGIN };
  // several floors: the walker is on one level at a time — that level's walls, floor height and furniture only (`plan`
  // is that level's view, the plan itself on the ground floor) — and changes level on a stair (stage F5).
  let level = GROUND, plan = ctx.plan;
  const setLevel = (id) => { level = validLevel(ctx.plan, id); plan = viewOf(ctx.plan, level); };
  const floorY = (x, y) => (level === GROUND ? groundY(x, y, plan) : groundY(x, y, plan, level));
  const onLevel = (it) => itemLevel(it, ctx.plan, store) === level;
  // a shallow copy defeats any per-plan cache in core: the plan's arrays are replaced when the owner edits the house
  const readWalls = () => wallBlockers(plan);
  let walls = readWalls();

  // ── stairs (stage F5) ── `onStair` = the stair walked on (walkStairs record), `stairH` = height on it (cm above its
  // bottom floor, smooth along the walking line). The level changes at the stair's ends: at the top riser onto `to`, at
  // the bottom one back onto the bottom level (and on leaving the stair, by the end it was left at) — once per crossing.
  let stairs = [], stairsHere = [], extraOff = [], onFloor = null, onStair = null, stairH = 0;
  const wallsByLevel = new Map(), furnByLevel = new Map(), stairLists = new Map();
  const stairsActive = () => stairs.length > 0 || extraOff.length > 0 || onFloor !== null;
  function levelStairs() {
    stairsHere = stairs.filter((s) => s.bottom === level || s.to === level);
    extraOff = [...stairs.filter((s) => s.bottom === level).flatMap((s) => s.low), ...voidBoxes(ctx.plan, level, stairs)];
    onFloor = floorTest(ctx.plan, level);
  }
  function readStairs() {
    stairs = walkStairs(ctx.plan);
    wallsByLevel.clear(); stairLists.clear();
    if (onStair) onStair = stairs.find((s) => s.id === onStair.id) || null;
    levelStairs();
  }
  const wallsOf = (id) => {
    if (id === level) return walls;
    if (!wallsByLevel.has(id)) wallsByLevel.set(id, wallBlockers(viewOf(ctx.plan, id)));
    return wallsByLevel.get(id);
  };
  const furnOf = (id) => {
    if (id === level) return blockers.slice(walls.length);
    if (!furnByLevel.has(id)) furnByLevel.set(id, furnitureBlockers(store.items, ctx.models, (it) => itemLevel(it, ctx.plan, store) === id));
    return furnByLevel.get(id);
  };
  const stairHeight = (s) => floorHeightAt(s.stair, s.geo, p.x * 100, p.y * 100);
  /** Floor under the walker (m above the ground floor's finished floor). */
  const floorAt = () => (onStair ? onStair.base + stairH / 100 : floorY(p.x * 100, p.y * 100));

  let active = false;
  let blockers = walls, blockersDirty = true;
  let offAll = walls, offWalls = walls;      // blockers off a stair: the level's + its stairs' undersides and void railings
  const ignore = new Set();
  const p = { x: 0, y: 0 };
  const vel = { x: 0, y: 0 };
  let yaw = 0, pitch = 0, gy = 0, bob = 0, bobAmt = 0, speedNow = 0;
  let glide = null;
  let lastEmit = 0, lastSent = '';
  let usePointerLock = true, lockDenied = false, locked = false, selfUnlock = false, pendingClick = null;

  const keys = new Set();
  const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const look = { id: null, x: 0, y: 0, moved: 0, t: 0, type: 'mouse' };

  // ───────────── HUD (joystick, crosshair, hint) ─────────────
  const joyBase = css(document.createElement('div'), 'position:absolute;width:116px;height:116px;margin:-58px 0 0 -58px;border-radius:50%;border:1.5px solid rgba(255,255,255,.6);background:radial-gradient(circle,rgba(255,255,255,.10),rgba(20,22,26,.22));box-shadow:0 6px 24px rgba(0,0,0,.18);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;transition:opacity .18s ease;pointer-events:none');
  const joyKnob = css(document.createElement('div'), 'position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,255,255,.92);box-shadow:0 2px 10px rgba(0,0,0,.28);will-change:transform');
  joyBase.className = 'v3d-joystick'; joyBase.appendChild(joyKnob);
  const cross = css(document.createElement('div'), 'position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(255,255,255,.9);box-shadow:0 0 0 1.5px rgba(0,0,0,.35);opacity:0;transition:opacity .15s ease;pointer-events:none');
  cross.className = 'v3d-crosshair';
  const hint = css(document.createElement('div'), 'position:absolute;left:50%;bottom:22px;transform:translateX(-50%);max-width:calc(100% - 32px);padding:8px 14px;border-radius:999px;background:rgba(18,20,24,.62);color:#fff;font:500 12.5px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;transition:opacity .5s ease;pointer-events:none');
  hint.className = 'v3d-walk-hint';
  let hintTimer = 0;
  const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  function showHint() {
    hint.textContent = coarse()
      ? 'Left thumb to move · drag to look around · tap a spot to go there'
      : `WASD / arrows to move · ${usePointerLock && !lockDenied ? 'click to capture the mouse' : 'drag to look, click to go there'} · Shift to run${stairs.length ? ' · PgUp / PgDn: up / down the stairs' : ''} · Esc to exit`;
    hint.style.opacity = '1';
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hint.style.opacity = '0'; }, 5200);
  }
  function restJoystick() {
    joyBase.style.left = '86px'; joyBase.style.top = 'calc(100% - 96px)';
    joyKnob.style.transform = 'translate(0px,0px)';
    joyBase.style.opacity = coarse() ? '0.55' : '0';
  }

  // ───────────── blockers ─────────────
  function rebuildBlockers() {
    blockers = walls.concat(furnitureBlockers(store.items, ctx.models, level === GROUND && !ctx.plan.levels ? null : onLevel));
    blockersDirty = false;
    offAll = extraOff.length ? blockers.concat(extraOff) : blockers;
    offWalls = extraOff.length ? walls.concat(extraOff) : walls;
    furnByLevel.clear(); stairLists.clear();
    for (const b of [...ignore]) if (!b.wall) ignore.delete(b);
    adoptContaining();
  }
  /** Blockers the walker currently stands inside stop blocking until they are left. */
  function adoptContaining() {
    for (const b of blockers) if (gap(p, b) < 0.02) ignore.add(b);
  }
  function releaseLeft() {
    for (const b of ignore) if (gap(p, b) >= WALKER_RADIUS) ignore.delete(b);
  }
  function clampLot() { p.x = clamp(p.x, lot.x0, lot.x1); p.y = clamp(p.y, lot.y0, lot.y1); }

  /**
   * The blockers where the walker is: `kind` 'all' (walls, windows, furniture) or 'walls' (a glide crosses furniture).
   * Off a stair: the level's (+ its stairs' sides / undersides below 1.80 m and the void railings, when it has any).
   * On a stair: its guards, the bottom level's walls below the upper slab, the upper level's walls near the top, and
   * the furniture of a floor within 60 cm of it.
   */
  function listFor(kind) {
    if (!onStair) return kind === 'all' ? offAll : offWalls;
    const s = onStair, h = stairH;
    const lowW = h < s.underside, highW = h > s.rise - UPPER_WALLS, lowF = kind === 'all' && h < NEAR_FLOOR_ITEMS, highF = kind === 'all' && h > s.rise - NEAR_FLOOR_ITEMS;
    const key = `${s.id}|${+lowW}${+highW}${+lowF}${+highF}`;
    let list = stairLists.get(key);
    if (!list) {
      list = s.guard.slice();
      if (lowW) list.push(...wallsOf(s.bottom));
      if (highW) list.push(...wallsOf(s.to));
      if (lowF) list.push(...furnOf(s.bottom));
      if (highF) list.push(...furnOf(s.to));
      stairLists.set(key, list);
    }
    return list;
  }

  /** Several floors: the walker went onto another level (stair end) — its walls, furniture, floor, events. */
  function changeLevel(id) {
    if (id === level) return;
    setLevel(id);
    walls = readWalls();
    for (const b of [...ignore]) if (b.wall) ignore.delete(b);
    levelStairs();
    rebuildBlockers();
    emitPosition(performance.now(), true);
    if (onLevelChange) onLevelChange(level);
  }
  /** Step onto / along / off a stair at the walker's position (and change level at its ends). */
  function track() {
    if (onStair) {
      const s = onStair, h = stairHeight(s);
      if (h != null) {
        stairH = h;
        if (level === s.bottom && h >= s.rise - s.geo.riser) changeLevel(s.to);
        else if (level === s.to && h <= s.geo.riser) changeLevel(s.bottom);
        return;
      }
      onStair = null;
      changeLevel(stairH > s.rise / 2 ? s.to : s.bottom);
      return;
    }
    for (const s of stairsHere) {
      const h = stairHeight(s);
      if (h == null) continue;
      if (Math.abs(h - (level === s.bottom ? 0 : s.rise)) <= STEP_ON) { onStair = s; stairH = h; return; }
    }
  }
  /** After a sub-step: stairs, and no step off the floor of an upper level (back to the last point that had one). */
  function settle(px, py) {
    track();
    if (!onFloor || onStair || onFloor(p.x * 100, p.y * 100) || !onFloor(px * 100, py * 100)) return;
    if (onFloor(p.x * 100, py * 100)) p.y = py;
    else if (onFloor(px * 100, p.y * 100)) p.x = px;
    else { p.x = px; p.y = py; }
  }

  /** Move by (dx, dy) metres with collision; `kind` = which blockers to test ('all' | 'walls', see listFor). */
  function move(dx, dy, kind) {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / SUB_STEP));
    const staged = stairsActive();
    for (let i = 0; i < n; i++) {
      const px = p.x, py = p.y;
      p.x += dx / n; p.y += dy / n;
      resolve(p, WALKER_RADIUS, listFor(kind), ignore);
      clampLot();
      if (staged) settle(px, py);
    }
  }

  /**
   * PageUp / PageDown: to the top of the nearest stair going up from this level (+1) / the bottom of the nearest one
   * coming down to it (−1), a step off its end, facing on. False when there is none.
   */
  function stairJump(dir) {
    const cands = onStair ? [onStair] : stairs.filter((s) => (dir > 0 ? s.bottom === level : s.to === level));
    let best = null, bd = Infinity;
    for (const s of cands) { const e = dir > 0 ? s.geo.start : s.geo.arrival, d = Math.hypot(e.mid[0] - p.x * 100, e.mid[1] - p.y * 100); if (d < bd) { bd = d; best = s; } }
    if (!best) return false;
    const e = dir > 0 ? best.geo.arrival : best.geo.start, k = (WALKER_RADIUS * 100 + 15) * (dir > 0 ? 1 : -1);
    const v = dir > 0 ? e.dir : [-e.dir[0], -e.dir[1]];
    onStair = null;
    changeLevel(dir > 0 ? best.to : best.bottom);
    place(e.mid[0] + e.dir[0] * k, e.mid[1] + e.dir[1] * k, (Math.atan2(v[0], -v[1]) * 180) / Math.PI);
    applyCamera();
    emitPosition(performance.now(), true);
    return true;
  }

  // ───────────── state / events ─────────────
  const headingDeg = () => (((yaw * 180) / Math.PI) % 360 + 360) % 360;
  function state() {
    const s = spaceAt(p.x * 100, p.y * 100, plan);
    const out = { x: p.x * 100, y: p.y * 100, heading: headingDeg(), pitch: (pitch * 180) / Math.PI, spaceId: s ? s.id : null, speed: speedNow, gliding: !!glide, pointerLocked: locked };
    if (onStair) { out.stair = onStair.id; out.stairHeight = stairH; }
    return out;
  }
  function emitPosition(now, force) {
    if (!force && now - lastEmit < EMIT_MS) return;
    const s = state();
    const sig = `${s.x.toFixed(1)}|${s.y.toFixed(1)}|${s.heading.toFixed(1)}`;
    if (!force && sig === lastSent) return;
    lastSent = sig; lastEmit = now;
    emit('walk-position', level === GROUND ? { x: s.x, y: s.y, heading: s.heading, spaceId: s.spaceId } : { x: s.x, y: s.y, heading: s.heading, spaceId: s.spaceId, level });
  }

  function applyCamera() {
    const sway = Math.sin(bob) * 0.012 * bobAmt, lift = Math.abs(Math.sin(bob)) * 0.03 * bobAmt;
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch, -yaw, 0);
    camera.position.set(p.x + Math.cos(yaw) * sway, gy + EYE_HEIGHT - 0.012 * bobAmt + lift, p.y + Math.sin(yaw) * sway);
  }

  function place(x, y, heading) {
    p.x = x / 100; p.y = y / 100; clampLot();
    if (heading != null) yaw = (heading * Math.PI) / 180;
    vel.x = vel.y = 0; glide = null;
    ignore.clear();
    if (blockersDirty) rebuildBlockers(); else adoptContaining();
    resolve(p, WALKER_RADIUS, blockers, ignore);
    onStair = null;
    if (stairsActive()) { track(); if (!onStair) resolve(p, WALKER_RADIUS, offAll, ignore); }
    gy = floorAt();
  }

  /** Glide to a plan point (cm). Walls stop the glide; furniture is crossed and left on arrival. */
  function glideTo(x, y) {
    const to = { x: clamp(x / 100, lot.x0, lot.x1), y: clamp(y / 100, lot.y0, lot.y1) };
    resolve(to, WALKER_RADIUS, walls, null);
    const dist = Math.hypot(to.x - p.x, to.y - p.y);
    if (dist < 0.05) return;
    glide = { fx: p.x, fy: p.y, tx: to.x, ty: to.y, t: 0, dur: reducedMotion() ? 0.001 : clamp(dist / 5, 0.4, 1.15), px: p.x, py: p.y };
    vel.x = vel.y = 0;
  }

  // ───────────── input ─────────────
  const typing = (e) => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space']);
  function onKeyDown(e) {
    if (!active || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape') { e.preventDefault(); requestExit(); return; }
    if ((e.code === 'PageUp' || e.code === 'PageDown') && stairs.length) { e.preventDefault(); stairJump(e.code === 'PageUp' ? 1 : -1); return; }
    if (!MOVE_KEYS.has(e.code)) return;
    e.preventDefault();
    keys.add(e.code);
    if (e.code !== 'ShiftLeft' && e.code !== 'ShiftRight' && e.code !== 'Space') glide = null;
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function onBlur() { keys.clear(); }

  function requestLock() {
    if (!usePointerLock || lockDenied || typeof dom.requestPointerLock !== 'function') return false;
    try {
      const r = dom.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(onLockError);
    } catch (e) { onLockError(); return false; }
    return true;
  }
  function onLockError() {
    lockDenied = true;
    if (pendingClick && active) { const c = pendingClick; pendingClick = null; goTo(c.x, c.y); }
  }
  function onLockChange() {
    const now = document.pointerLockElement === dom;
    const was = locked; locked = now; pendingClick = null;
    cross.style.opacity = locked ? '1' : '0';
    dom.style.cursor = locked ? 'none' : 'grab';
    // The browser released the lock on Esc: that is the user's "leave walk mode".
    if (was && !now && active && !selfUnlock && document.hasFocus()) requestExit();
    selfUnlock = false;
  }
  function goTo(clientX, clientY) {
    const t = pickTarget(clientX, clientY);
    if (t) glideTo(t.x, t.y);
  }

  function onPointerDown(e) {
    if (!active) return;
    const rect = dom.getBoundingClientRect();
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (touch && joy.id === null && e.clientX - rect.left < rect.width / 2) {
      joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0;
      joyBase.style.left = `${e.clientX - rect.left}px`; joyBase.style.top = `${e.clientY - rect.top}px`;
      joyBase.style.opacity = '1';
      glide = null;
    } else if (look.id === null && (touch || e.button === 0)) {
      Object.assign(look, { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now(), type: e.pointerType });
      if (!locked) dom.style.cursor = 'grabbing';
    } else return;
    try { dom.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!active) return;
    if (e.pointerId === joy.id) {
      const R = 52, dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, len = Math.hypot(dx, dy) || 1, k = Math.min(1, R / len);
      joy.x = (dx * k) / R; joy.y = (dy * k) / R;
      joyKnob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
      return;
    }
    if (locked) { turn(e.movementX || 0, e.movementY || 0, 0.0022); return; }
    if (e.pointerId !== look.id) return;
    const dx = e.clientX - look.x, dy = e.clientY - look.y;
    look.x = e.clientX; look.y = e.clientY; look.moved += Math.abs(dx) + Math.abs(dy);
    if (look.moved > 4) turn(dx, dy, look.type === 'mouse' ? 0.0042 : 0.0052);
  }
  function turn(dx, dy, k) {
    yaw += dx * k;
    pitch = clamp(pitch - dy * k, -PITCH_LIMIT, PITCH_LIMIT);
  }
  function onPointerUp(e) {
    if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; restJoystick(); return; }
    if (e.pointerId !== look.id) return;
    look.id = null;
    if (!locked) dom.style.cursor = 'grab';
    if (!active || e.type === 'pointercancel') return;
    const click = look.moved < 6 && performance.now() - look.t < 450;
    if (!click) return;
    if (locked) { const r = dom.getBoundingClientRect(); goTo(r.left + r.width / 2, r.top + r.height / 2); return; }
    if (look.type === 'mouse' && requestLock()) { pendingClick = { x: e.clientX, y: e.clientY }; return; }
    goTo(e.clientX, e.clientY);
  }

  function gamepad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of pads) {
      if (!g || !g.connected || g.axes.length < 2) continue;
      const dz = (v) => (Math.abs(v) < 0.16 ? 0 : v);
      return { mx: dz(g.axes[0]), my: dz(g.axes[1]), lx: dz(g.axes[2] || 0), ly: dz(g.axes[3] || 0), run: !!(g.buttons[0] && g.buttons[0].pressed) };
    }
    return null;
  }

  const offItems = store.on('items', () => { blockersDirty = true; });

  function update(dt) {
    if (!active) return;
    if (blockersDirty) rebuildBlockers();
    const pad = gamepad();
    const k = (c) => (keys.has(c) ? 1 : 0);

    const turnIn = k('KeyE') + k('ArrowRight') - k('KeyQ') - k('ArrowLeft') + (pad ? pad.lx : 0);
    yaw += turnIn * TURN_SPEED * dt;
    if (pad && pad.ly) pitch = clamp(pitch - pad.ly * 1.4 * dt, -PITCH_LIMIT, PITCH_LIMIT);

    let fwd = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') - joy.y - (pad ? pad.my : 0);
    let side = k('KeyD') - k('KeyA') + joy.x + (pad ? pad.mx : 0);
    const mag = Math.hypot(fwd, side);
    if (mag > 1) { fwd /= mag; side /= mag; }
    const analog = joy.id !== null || (pad && (pad.mx || pad.my));
    let top = keys.has('ShiftLeft') || keys.has('ShiftRight') || (pad && pad.run) ? RUN_SPEED : analog ? TOUCH_SPEED : WALK_SPEED;
    if (onStair) top *= STAIR_SPEED;
    const fx = Math.sin(yaw), fy = -Math.cos(yaw), rx = Math.cos(yaw), ry = Math.sin(yaw);
    const tvx = (fx * fwd + rx * side) * top, tvy = (fy * fwd + ry * side) * top;
    if (mag > 0.05 && glide) glide = null;

    const x0 = p.x, y0 = p.y;
    if (glide) {
      glide.t = Math.min(1, glide.t + dt / glide.dur);
      const e = easeInOut(glide.t);
      const ix = glide.fx + (glide.tx - glide.fx) * e, iy = glide.fy + (glide.ty - glide.fy) * e;
      move(ix - glide.px, iy - glide.py, 'walls');
      glide.px = ix; glide.py = iy;
      if (glide.t >= 1) { glide = null; adoptContaining(); resolve(p, WALKER_RADIUS, stairsActive() ? listFor('all') : blockers, ignore); }
    } else {
      const a = 1 - Math.exp(-dt * (mag > 0.05 ? 9 : 12));
      vel.x += (tvx - vel.x) * a; vel.y += (tvy - vel.y) * a;
      if (Math.abs(vel.x) + Math.abs(vel.y) > 1e-3) move(vel.x * dt, vel.y * dt, 'all');
      else vel.x = vel.y = 0;
    }
    releaseLeft();

    speedNow = dt > 0 ? Math.hypot(p.x - x0, p.y - y0) / dt : 0;
    const wantBob = glide || reducedMotion() ? 0 : clamp(speedNow / WALK_SPEED, 0, 1.25);
    bobAmt += (wantBob - bobAmt) * (1 - Math.exp(-dt * 8));
    bob += speedNow * dt * 4.1;
    gy += (floorAt() - gy) * (1 - Math.exp(-dt / 0.07));
    applyCamera();
    emitPosition(performance.now(), false);
  }

  return {
    /**
     * @param {{ x?: number, y?: number, heading?: number, pointerLock?: boolean, level?: string }} [opts] plan cm / degrees
     *        clockwise from north-up; `level` (several floors): the level to walk on (default: the ground floor)
     */
    start(opts = {}) {
      const was = level;
      setLevel(opts.level);
      if (was !== level) { walls = readWalls(); ignore.clear(); }
      readStairs();
      const d = defaultWalkStart(plan);
      usePointerLock = opts.pointerLock !== false;
      blockersDirty = true;
      pitch = 0; bob = 0; bobAmt = 0;
      place(opts.x ?? d.x, opts.y ?? d.y, opts.heading ?? d.heading);
      if (active) { applyCamera(); emitPosition(performance.now(), true); return; }
      active = true;
      overlay.append(joyBase, cross, hint);
      restJoystick();
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      document.addEventListener('pointerlockchange', onLockChange);
      document.addEventListener('pointerlockerror', onLockError);
      dom.addEventListener('pointerdown', onPointerDown);
      dom.addEventListener('pointermove', onPointerMove);
      dom.addEventListener('pointerup', onPointerUp);
      dom.addEventListener('pointercancel', onPointerUp);
      dom.style.cursor = 'grab';
      applyCamera();
      showHint();
      emitPosition(performance.now(), true);
    },
    stop() {
      if (!active) return;
      active = false;
      keys.clear(); joy.id = null; look.id = null; glide = null; pendingClick = null;
      clearTimeout(hintTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      if (document.pointerLockElement === dom) { selfUnlock = true; document.exitPointerLock(); }
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      locked = false;
      joyBase.remove(); cross.remove(); hint.remove();
      cross.style.opacity = '0'; hint.style.opacity = '0';
      dom.style.cursor = '';
      camera.rotation.order = 'XYZ';
    },
    update,
    isActive: () => active,
    getState: state,
    /** Snap the camera to the walker (used right after the fly-in transition). */
    syncCamera: applyCamera,
    /** Eye pose for the current walker state: { position, quaternion }. */
    eyePose() {
      const e = new THREE.Euler(pitch, -yaw, 0, 'YXZ');
      return { position: new THREE.Vector3(p.x, gy + EYE_HEIGHT, p.y), quaternion: new THREE.Quaternion().setFromEuler(e) };
    },
    teleport(x, y, heading) { place(x, y, heading); applyCamera(); emitPosition(performance.now(), true); },
    /** Stage F5: PageUp / PageDown — to the top (+1) / bottom (−1) of the nearest stair; false when there is none. */
    stairJump,
    /** The stair walked on: { id, height (cm above its bottom floor), bottom, to } or null. */
    getStair: () => (onStair ? { id: onStair.id, height: stairH, bottom: onStair.bottom, to: onStair.to } : null),
    glideTo,
    /** Test hook: is a circle of the walker's radius at plan (x, y) cm overlapping a wall, window or blocking furniture? */
    blockedAt(x, y, { furniture = true, here = false } = {}) {
      if (blockersDirty) rebuildBlockers();
      const q = { x: x / 100, y: y / 100 };
      // here: what blocks where the walker now is (on its stair, or the level with its stairs and void railings)
      const list = here ? listFor(furniture ? 'all' : 'walls') : furniture ? blockers : walls;
      return list.some((b) => gap(q, b) < WALKER_RADIUS - 2e-3);
    },
    blockerCount: () => (blockersDirty ? (rebuildBlockers(), blockers.length) : blockers.length),
    /** The plan was edited: re-read walls / windows; a walker now standing inside a wall is let out, not trapped. */
    /** The level walked on ('L0' …). */
    getLevel: () => level,
    refreshPlan() {
      setLevel(level);
      walls = readWalls();
      readStairs();
      for (const b of [...ignore]) if (b.wall) ignore.delete(b);
      glide = null;
      rebuildBlockers();
      if (active) gy = floorAt();
    },
    dispose() { this.stop(); offItems(); },
  };
}
