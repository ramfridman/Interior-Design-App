/**
 * Checks on the furniture layout inside the house (store.items against the plan).
 */
import { itemCorners, polygonBounds, pointInPolygon, convexOverlap, wallsHitByItem, wallFaces, itemLocalToPlan, DEG, openingFrame, openingPoly, rectExtent, wallPolys } from '../core/geometry.js';
import { finding } from './building.js';
import { GROUND, hasLevels } from '../core/levels.js';
import { coverageM2 } from './footprint.js';
import {
  rectPoly, wallObstacle, openingObstacle, m, num, cmStr, segDist, polyDist, faceFrame, freeDepth, compass, doorSwing, openingSides,
  makeGrid, cloneGrid, fillPoly, clearance, flood, reachedNear, cellsNear, planRev,
} from './geom.js';

const SEATS = new Set(['chair', 'bar-stool', 'office-chair', 'pouf']);
const FLAT = new Set(['rug', 'surface', 'floor-finish', 'wall-finish']);
const KITCHEN_UNITS = new Set(['kitchen-base', 'kitchen-tall', 'kitchen-island', 'fridge', 'range', 'dishwasher']);
const WET_ROOM = new Set(['bathroom', 'wc']);
const names = (list) => [...new Set(list.map((i) => i.name || i.type))].join(', ');
const ids = (list) => list.map((i) => i.id).filter(Boolean);
const at = (it) => ({ x: Math.round(it.x), y: Math.round(it.y) });

/**
 * Normalised view of the design used by the interior and outdoor checks.
 * @returns {{ plan, items: object[], byRoom: Map, walls: object[], H: number, roomOf: Function }}
 */
export function buildContext({ store, plan, catalog }) {
  // several floors (stage F7): a level view (`plan.levelId`) or a plan with upper levels takes only the items of its
  // own floor (`item.level`, absent = ground; a carpentry unit without one: its run's) and its own ceiling height
  const floor = plan.levelId || (hasLevels(plan) ? GROUND : null);
  const H = floor && floor !== GROUND ? num(plan.heights && plan.heights.ceiling, 300) : num(store && store.project && store.project.ceilingHeight, num(plan.heights && plan.heights.ceiling, 300));
  const items = [];
  const raw = (store && Array.isArray(store.items) ? store.items : []);
  const runs = (store && store.carpentry && store.carpentry.runs) || {};
  const floorOf = (it) => (typeof it.level === 'string' && it.level ? it.level : it.carp && runs[it.carp.runId] && runs[it.carp.runId].level ? runs[it.carp.runId].level : GROUND);
  raw.forEach((src, idx) => {
    if (!src || src.hidden || !(num(src.w, 0) > 0) || !(num(src.d, 0) > 0)) return;
    if (floor && floorOf(src) !== floor) return;
    const it = { ...src, id: src.id || `item-${idx}`, x: num(src.x, 0), y: num(src.y, 0), rot: num(src.rot, 0), h: num(src.h, 0), elev: num(src.elev, 0), params: src.params || {}, placement: src.placement || 'floor' };
    it.poly = itemCorners(it);
    it.bb = polygonBounds(it.poly);
    it.room = plan.rooms.find((r) => pointInPolygon(it.x, it.y, r.polygon)) || null;
    it.area = it.room ? null : (plan.outdoorAreas || []).find((r) => pointInPolygon(it.x, it.y, r.polygon)) || null;
    it.bottom = it.placement === 'ceiling' ? (it.elev > 0 ? it.elev : H - it.h) : it.elev;
    it.top = it.bottom + it.h;
    // solid = stands on the floor and takes up floor space
    it.solid = it.placement === 'floor' && !FLAT.has(it.type) && it.h > 8 && it.elev < 60;
    it.obstacle = { poly: it.poly, bb: it.bb, item: it };
    items.push(it);
  });
  const byRoom = new Map(plan.rooms.map((r) => [r.id, []]));
  for (const it of items) if (it.room) byRoom.get(it.room.id).push(it);
  const walls = [
    ...plan.walls.map((w, i) => wallObstacle(plan, i, { wall: w })),
    ...plan.openings.filter((o) => o.kind === 'window').map((o) => openingObstacle(o, { opening: o })),
  ];
  const ctx = { plan, store, catalog, items, byRoom, walls, H };
  if (floor === GROUND) ctx.coverage = coverageM2(plan);       // ground covered by the house, all floors projected (m²)
  return ctx;
}

const hitName = (hit) => (!hit ? 'open floor' : hit.item ? (hit.item.name || hit.item.type) : hit.opening ? 'the window wall' : 'the wall');

/** Obstacles a piece of furniture meets inside its room. */
function obstaclesFor(ctx, it, { skipSeats = false, skip } = {}) {
  const list = ctx.walls.slice();
  const pool = it.room ? ctx.byRoom.get(it.room.id) : ctx.items;
  for (const o of pool) {
    if (o === it || !o.solid) continue;
    if (skipSeats && SEATS.has(o.type)) continue;
    if (skip && skip(o)) continue;
    list.push(o.obstacle);
  }
  return list;
}

// ───────────────────────── walls, overlaps, placement ─────────────────────────

function checkPlacement(ctx, out) {
  const { plan, items } = ctx;
  let inWall = 0, overlaps = 0, outside = 0, wallBad = 0, wallCount = 0;
  const faces = wallFaces(plan);
  for (const it of items) {
    if (FLAT.has(it.type) || it.type === 'curtain') continue;
    const indoor = it.zone !== 'outdoor';
    if (indoor || it.bb.x < plan.bounds.x + plan.bounds.w) {
      const hit = wallsHitByItem(it, plan);
      const win = plan.openings.filter((o) => o.kind === 'window' && convexOverlap(it.poly, openingPoly(o), 1));
      if (hit.length || win.length) {
        inWall++;
        out.push(finding('item-in-wall', 'fail', it.id, `${it.name || it.type} overlaps ${hit.length ? 'a wall' : 'a window'}`,
          `${it.name || it.type} cuts into ${hit.length ? `${hit.length} wall segment${hit.length > 1 ? 's' : ''}` : 'a window opening'}. Move it clear of the wall.`, { itemIds: [it.id], spaceId: it.room && it.room.id, at: at(it) }));
      }
    }
    if (indoor && !it.room) {
      outside++;
      out.push(finding('item-outside-room', it.area ? 'info' : 'warn', it.id, `${it.name || it.type} is ${it.area ? 'on the ' + it.area.name.toLowerCase() : 'outside the house'}`,
        it.area ? `${it.name || it.type} is an indoor piece standing on the ${it.area.name.toLowerCase()} — make sure it is suitable for outdoor use.`
          : `${it.name || it.type} is an indoor piece but its centre is not inside any room.`, { itemIds: [it.id], at: at(it) }));
    }
    if (it.placement === 'wall' && indoor) {
      wallCount++;
      const c = Math.cos(it.rot * DEG), s = Math.sin(it.rot * DEG);
      const front = [-s, c];
      const [bx, by] = itemLocalToPlan(it, 0, -it.d / 2);
      let near = null;
      for (const f of faces) {
        const d = segDist(bx, by, f.x1, f.y1, f.x2, f.y2);
        if (d <= 20 && (!near || d < near.d)) near = { d, dot: front[0] * f.nx + front[1] * f.ny };
      }
      const onOpening = plan.openings.some((o) => bx >= o.x - 20 && bx <= o.x + o.w + 20 && by >= o.y - 20 && by <= o.y + o.h + 20);
      if (near && near.dot < 0.5) {
        wallBad++;
        out.push(finding('wall-item-side', 'warn', it.id, `${it.name || it.type} faces the wall`,
          `${it.name || it.type} is wall-mounted but its front points into the wall (or along it). Rotate it so its back is on the wall and it faces the room.`, { itemIds: [it.id], spaceId: it.room && it.room.id, at: at(it) }));
      } else if (!near && !onOpening) {
        wallBad++;
        out.push(finding('wall-item-side', 'info', it.id, `${it.name || it.type} is not on a wall`,
          `${it.name || it.type} is a wall-mounted piece but its back is more than 20 cm from any wall face. Snap it to a wall.`, { itemIds: [it.id], spaceId: it.room && it.room.id, at: at(it) }));
      }
    }
  }
  // overlapping floor pieces (same room)
  for (const list of ctx.byRoom.values()) {
    const solid = list.filter((i) => i.solid);
    for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      if (SEATS.has(a.type) || SEATS.has(b.type)) continue;            // chairs tuck under tables
      if (a.bb.x > b.bb.x + b.bb.w || b.bb.x > a.bb.x + a.bb.w || a.bb.y > b.bb.y + b.bb.h || b.bb.y > a.bb.y + a.bb.h) continue;
      if (!(a.bottom < b.top && b.bottom < a.top) || !convexOverlap(a.poly, b.poly, 4)) continue;
      overlaps++;
      out.push(finding('item-overlap', 'warn', `${a.id}+${b.id}`, `${a.name || a.type} overlaps ${b.name || b.type}`,
        `${a.name || a.type} and ${b.name || b.type} occupy the same floor space in ${a.room.name}.`, { itemIds: [a.id, b.id], spaceId: a.room.id, at: at(a) }));
    }
  }
  if (!inWall) out.push(finding('item-in-wall', 'pass', 'all', 'No furniture cuts into a wall or window', `All ${items.length} placed items stand clear of the walls.`));
  if (!overlaps) out.push(finding('item-overlap', 'pass', 'all', 'No overlapping furniture', 'No two floor-standing pieces occupy the same floor space.'));
  if (!outside) out.push(finding('item-outside-room', 'pass', 'all', 'All indoor pieces are inside rooms', 'Every indoor item has its centre inside a room.'));
  if (wallCount && !wallBad) out.push(finding('wall-item-side', 'pass', 'all', 'Wall-mounted items sit on walls and face the room', `${wallCount} wall-mounted item${wallCount > 1 ? 's are' : ' is'} correctly placed against a wall face.`));
}

// ───────────────────────── doors, windows, routes ─────────────────────────

function checkDoorsAndWindows(ctx, out) {
  const { plan, items } = ctx;
  let blockedDoors = 0, blockedWindows = 0;
  const movable = items.filter((i) => i.solid);
  const rugs = items.filter((i) => i.type === 'rug');
  for (const o of plan.openings) {
    const centre = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
    const mamad = (o.rooms || []).some((id) => (plan.rooms.find((r) => r.id === id) || {}).type === 'mamad');
    if (o.kind === 'door' || o.kind === 'sliding-door' || o.kind === 'opening') {
      const swing = doorSwing(o);
      const label = o.style === 'entry' ? 'the entrance door' : o.style === 'mamad' ? 'the blast door of the safe room' : o.kind === 'sliding-door' ? `the sliding ${o.exterior ? 'terrace ' : ''}door`
        : `the ${o.kind === 'opening' ? 'passage' : 'door'} between ${(o.rooms || []).map((id) => (plan.rooms.find((r) => r.id === id) || (plan.outdoorAreas || []).find((r) => r.id === id) || { name: id }).name).join(' and ')}`;
      const R = Math.max(o.width, 60) + 5;
      const nearby = movable.filter((i) => i.bb.x < o.x + o.w + R && i.bb.x + i.bb.w > o.x - R && i.bb.y < o.y + o.h + R && i.bb.y + i.bb.h > o.y - R);
      const inSwing = swing ? nearby.filter((i) => convexOverlap(i.poly, swing, 1.5)) : [];
      const zones = openingSides(o, 60).map((s) => rectPoly(s.rect));
      // second leaf hung in the same doorway (the safe room's inner door, which opens into the room)
      const innerSwing = o.innerDoor ? doorSwing({ ...o, ...o.innerDoor, kind: 'door', width: num(o.innerDoor.width, o.width) }) : null;
      const inInner = innerSwing ? nearby.filter((i) => !inSwing.includes(i) && convexOverlap(i.poly, innerSwing, 1.5)) : [];
      const inWay = nearby.filter((i) => !inSwing.includes(i) && !inInner.includes(i) && zones.some((z) => convexOverlap(i.poly, z, 10)));
      if (inSwing.length) {
        blockedDoors++;
        out.push(finding(mamad ? 'mamad-openings' : 'door-swing', mamad ? 'fail' : 'warn', o.id, `${names(inSwing)} blocks the swing of ${label}`,
          `${names(inSwing)} stand${inSwing.length > 1 ? '' : 's'} inside the ${o.width} cm arc that ${label} sweeps when it opens, so the door cannot open fully.`
          + (mamad ? ' The blast door must swing shut freely within seconds of an alert.' : ''), { itemIds: ids(inSwing), at: centre, spaceId: inSwing[0].room && inSwing[0].room.id }));
      }
      if (inWay.length) {
        blockedDoors++;
        out.push(finding(mamad ? 'mamad-openings' : 'doorway-clear', 'warn', o.id + ':way', `${names(inWay)} stands in front of ${label}`,
          `${names(inWay)} ${inWay.length > 1 ? 'are' : 'is'} within 60 cm of ${label}, narrowing the way through.`, { itemIds: ids(inWay), at: centre, spaceId: inWay[0].room && inWay[0].room.id }));
      }
      if (inInner.length) {
        blockedDoors++;
        out.push(finding(mamad ? 'mamad-openings' : 'door-swing', 'warn', o.id + ':inner', `${names(inInner)} blocks the inner door of ${mamad ? 'the safe room' : label}`,
          `${names(inInner)} stand${inInner.length > 1 ? '' : 's'} inside the arc of the inner door, which opens into the room, so that door cannot open fully`
          + (mamad ? ' and the way into the safe room is narrowed — an alert leaves only seconds to get in.' : '.'), { itemIds: ids(inInner), at: centre, spaceId: inInner[0].room && inInner[0].room.id }));
      }
      const underDoor = swing ? rugs.filter((r) => convexOverlap(r.poly, swing, 2)) : [];
      if (underDoor.length) {
        out.push(finding('rug-door', underDoor.some((r) => r.h > 1.5) ? 'warn' : 'info', o.id, `${names(underDoor)} lies under the swing of ${label}`,
          `${names(underDoor)} is under the door's arc. Doors clear the floor by about 1 cm — check the rug's pile height (${underDoor.map((r) => r.h + ' cm').join(', ')}) or move it.`, { itemIds: ids(underDoor), at: centre }));
      }
    } else if (o.kind === 'window') {
      const side = openingSides(o, mamad ? 60 : 30).find((s) => plan.rooms.some((r) => pointInPolygon(s.probe[0], s.probe[1], r.polygon)));
      if (!side) continue;
      const zone = rectPoly(side.rect);
      const tall = movable.filter((i) => i.room && i.top > o.sill + 5 && i.bb.x < o.x + o.w + 65 && i.bb.x + i.bb.w > o.x - 65 && i.bb.y < o.y + o.h + 65 && i.bb.y + i.bb.h > o.y - 65 && convexOverlap(i.poly, zone, 1.5));
      if (tall.length) {
        blockedWindows++;
        const room = tall[0].room;
        out.push(finding(mamad ? 'mamad-openings' : 'window-blocked', 'warn', o.id, `${names(tall)} stands in front of ${mamad ? 'the blast window' : 'a window'}`,
          `${names(tall)} (${tall.map((i) => Math.round(i.top) + ' cm high').join(', ')}) is taller than the ${o.sill} cm sill of the ${o.width} cm wide window`
          + (mamad ? ' of the safe room. The inner window and the steel shutter must be reachable and able to close fully — keep 60 cm in front of it free above sill height.'
            : `${room ? ' in ' + room.name : ''}: it blocks daylight, ventilation and access to the handle.`), { itemIds: ids(tall), at: centre, spaceId: room && room.id }));
      }
    }
  }
  if (!blockedDoors) out.push(finding('door-swing', 'pass', 'all', 'All doors open fully', 'No furniture stands in a door swing or within 60 cm of a doorway.'));
  if (!blockedWindows) out.push(finding('window-blocked', 'pass', 'all', 'No tall furniture in front of windows', 'Nothing taller than the sill stands in front of a window.'));
}

const GRID = new WeakMap();
/**
 * Static walkable raster of the house: room floors, doorways and door-less passages are free.
 * Rebuilt when the plan is edited (keyed on planRev — the plan object stays the same, its arrays are replaced);
 * the scratch buffers are kept across rebuilds while the grid size is unchanged.
 */
function houseGrid(plan) {
  const rev = planRev(plan);
  let g = GRID.get(plan);
  if (!g || g.rev !== rev) {
    const old = g;
    g = makeGrid(plan.bounds, 5);
    g.rev = rev;
    for (const r of plan.rooms) fillPoly(g, r.polygon, 1);
    for (const o of plan.openings) if (o.kind !== 'window') fillPoly(g, openingPoly(o), 1);
    const n = g.free.length;                                   // scratch buffers reused on every run
    g.scratch = old && old.free.length === n ? old.scratch
      : { free: new Uint8Array(n), dist: new Float32Array(n), wide: new Uint8Array(n), narrow: new Uint8Array(n), queue: new Int32Array(n) };
    GRID.set(plan, g);
  }
  return g;
}

function checkRoutes(ctx, out) {
  const { plan, items } = ctx;
  const entry = plan.openings.find((o) => o.style === 'entry') || plan.openings.find((o) => o.exterior && o.kind === 'door');
  if (!entry) return;
  const base = houseGrid(plan), sc = base.scratch;
  const g = cloneGrid(base, sc.free);
  for (const it of items) if (it.solid && it.room) fillPoly(g, it.poly, 0);
  const dist = clearance(g, sc.dist);
  const inRoom = (p) => plan.rooms.find((r) => pointInPolygon(p[0], p[1], r.polygon));
  const seeds = [];
  for (const s of openingSides(entry, 60, 25)) if (inRoom(s.probe)) seeds.push(...cellsNear(g, s.probe[0], s.probe[1], 25));
  if (!seeds.length) return;
  const wide = flood(g, dist, 35, seeds, sc.wide, sc.queue), narrow = flood(g, dist, 25, seeds, sc.narrow, sc.queue);       // 80 cm and 60 cm routes, ± one 5 cm cell
  const targets = new Map();                                                         // room / outside door → probes
  for (const o of plan.openings) {
    if (o.kind === 'window' || o === entry) continue;
    for (const s of openingSides(o, 60, 25)) {
      const room = inRoom(s.probe); if (!room) continue;
      const far = (o.rooms || []).filter((id) => id !== room.id)[0];
      const outdoor = (plan.outdoorAreas || []).find((a) => a.id === far);
      const key = outdoor ? `out:${o.id}` : room.id;
      const name = outdoor ? `the door to the ${outdoor.name.toLowerCase()}` : room.name;
      if (!targets.has(key)) targets.set(key, { name, room, probes: [], opening: o });
      targets.get(key).probes.push(s.probe);
    }
  }
  const ok = [];
  for (const [key, t] of targets) {
    const w = t.probes.some((p) => reachedNear(g, wide, p[0], p[1], 30));
    const n = w || t.probes.some((p) => reachedNear(g, narrow, p[0], p[1], 30));
    const where = { x: t.opening.x + t.opening.w / 2, y: t.opening.y + t.opening.h / 2 };
    if (w) { ok.push(t.name); continue; }
    out.push(finding('walkway', n ? 'info' : 'warn', key, n ? `Route to ${t.name} is narrower than 80 cm` : `Route to ${t.name} is narrower than 60 cm`,
      n ? `Walking from the front door to ${t.name}, furniture squeezes the route to between 60 and 80 cm somewhere on the way. 80–90 cm is the comfortable width for a main route.`
        : `Furniture leaves less than about 60 cm on every route from the front door to ${t.name} — one person cannot pass comfortably. Move the pieces that stand in the way.`, { spaceId: t.room.id, at: where }));
  }
  if (ok.length === targets.size) {
    out.push(finding('walkway', 'pass', 'all', 'Every room is reachable along routes at least 80 cm wide',
      `From the front door, routes at least about 80 cm wide (measured on a 5 cm grid) lead to: ${ok.join(', ')}.`));
  } else if (ok.length) {
    out.push(finding('walkway', 'pass', 'some', `${ok.length} of ${targets.size} destinations have an 80 cm route`, `Routes at least about 80 cm wide lead to: ${ok.join(', ')}.`));
  }
}

// ───────────────────────── furniture clearances ─────────────────────────

function checkBeds(ctx, out) {
  for (const it of ctx.items.filter((i) => i.type === 'bed' && i.room)) {
    const obs = obstaclesFor(ctx, it);
    const foot60 = { a0: -it.d / 2 + it.d * 0.4, a1: it.d / 2 };
    const L = freeDepth(faceFrame(it, 'left'), 150, obs, foot60), R = freeDepth(faceFrame(it, 'right'), 150, obs, foot60);
    const F = freeDepth(faceFrame(it, 'front'), 150, obs);
    const double = it.w >= 120;
    const sides = [L, R].map((s) => s.depth), good = sides.filter((d) => d >= 60).length;
    const sev = double ? (good === 2 ? 'pass' : 'warn') : (good >= 1 ? 'pass' : 'warn');
    const txt = (s) => (s.depth >= 150 ? 'more than 1.5 m' : cmStr(s.depth) + ` (to ${hitName(s.hit)})`);
    out.push(finding('bed-clearance', sev, it.id, sev === 'pass' ? `${it.name || 'Bed'}: ${double ? 'both sides' : 'one side'} accessible` : `${it.name || 'Bed'}: tight access`,
      `Free space beside ${it.name || 'the bed'} in ${it.room.name}: ${txt(L)} on one side, ${txt(R)} on the other, ${txt(F)} at the foot. `
      + (double ? 'A double bed needs at least 60 cm on both sides' : 'A single bed needs at least 60 cm on one long side')
      + (sev === 'pass' ? ' — met.' : ' — not met; move the bed or the piece next to it.'), { itemIds: [it.id], spaceId: it.room.id, at: at(it) }));
  }
}

function checkFronts(ctx, out) {
  for (const it of ctx.items) {
    if (!it.room) continue;
    if (it.type === 'wardrobe') {
      const f = freeDepth(faceFrame(it, 'front'), 200, obstaclesFor(ctx, it, { skipSeats: true }));
      const sliding = !!it.params.sliding;
      const sev = f.depth < 60 ? 'warn' : f.depth < 80 && !sliding ? 'info' : 'pass';
      out.push(finding('wardrobe-clearance', sev, it.id, `${it.name || 'Wardrobe'}: ${f.depth >= 200 ? 'over 2 m' : cmStr(f.depth)} in front`,
        `There is ${f.depth >= 200 ? 'more than 2 m' : cmStr(f.depth)} of free floor in front of ${it.name || 'the wardrobe'} in ${it.room.name}${f.hit ? ` (up to ${hitName(f.hit)})` : ''}. `
        + (sev === 'pass' ? 'Enough to open the doors and stand in front (80–90 cm recommended).' : sev === 'info' ? '80–90 cm is recommended so hinged doors open fully with room to stand; consider sliding doors here.' : 'Less than 60 cm: the doors cannot be used comfortably.'),
        { itemIds: [it.id, ...(f.hit && f.hit.item ? [f.hit.item.id] : [])], spaceId: it.room.id, at: at(it) }));
    } else if (it.type === 'desk') {
      const f = freeDepth(faceFrame(it, 'front'), 200, obstaclesFor(ctx, it, { skipSeats: true }));
      const sev = f.depth < 60 ? 'warn' : f.depth < 90 ? 'info' : 'pass';
      out.push(finding('desk-clearance', sev, it.id, `${it.name || 'Desk'}: ${f.depth >= 200 ? 'over 2 m' : cmStr(f.depth)} for the chair`,
        `Behind the working edge of ${it.name || 'the desk'} in ${it.room.name} there is ${f.depth >= 200 ? 'more than 2 m' : cmStr(f.depth)}${f.hit ? ` (to ${hitName(f.hit)})` : ''}; a desk chair needs about 90 cm to roll back (75 cm minimum).`,
        { itemIds: [it.id], spaceId: it.room.id, at: at(it) }));
    } else if (it.type === 'toilet') {
      const obs = obstaclesFor(ctx, it);
      const L = freeDepth(faceFrame(it, 'left'), 100, obs).depth + it.w / 2, R = freeDepth(faceFrame(it, 'right'), 100, obs).depth + it.w / 2;
      const F = freeDepth(faceFrame(it, 'front'), 150, obs);
      const side = Math.min(L, R);
      const sev = side < 38 || F.depth < 53 ? 'warn' : side < 40 || F.depth < 60 ? 'info' : 'pass';
      out.push(finding('toilet-clearance', sev, it.id, `Toilet in ${it.room.name}: ${Math.round(side)} cm to the side, ${F.depth >= 150 ? 'over 150' : Math.round(F.depth)} cm in front`,
        `From the centre line of the toilet it is ${Math.round(L)} cm and ${Math.round(R)} cm to the nearest wall or fixture on either side (minimum 38 cm, 46 cm comfortable) and ${F.depth >= 150 ? 'more than 150 cm' : cmStr(F.depth)} is clear in front (minimum 53 cm, 60–76 cm comfortable).`,
        { itemIds: [it.id], spaceId: it.room.id, at: at(it) }));
    } else if (it.type === 'vanity' || (it.type === 'sink' && WET_ROOM.has(it.room.type))) {
      const F = freeDepth(faceFrame(it, 'front'), 150, obstaclesFor(ctx, it));
      const sev = F.depth < 53 ? 'warn' : F.depth < 70 ? 'info' : 'pass';
      out.push(finding('basin-clearance', sev, it.id, `${it.name || 'Basin'} in ${it.room.name}: ${F.depth >= 150 ? 'over 150' : Math.round(F.depth)} cm in front`,
        `In front of ${it.name || 'the basin'} there is ${F.depth >= 150 ? 'more than 150 cm' : cmStr(F.depth)} of free floor${F.hit ? ` (to ${hitName(F.hit)})` : ''}; 53 cm is the minimum and 76 cm is comfortable.`,
        { itemIds: [it.id], spaceId: it.room.id, at: at(it) }));
    }
  }
}

function checkDining(ctx, out) {
  for (const it of ctx.items.filter((i) => i.type === 'table' && i.h >= 65 && i.room)) {
    const chairs = ctx.byRoom.get(it.room.id).filter((c) => (c.type === 'chair' || c.type === 'bench') && polyDist(c.poly, it.poly) <= 30);
    if (!chairs.length) continue;
    const obs = obstaclesFor(ctx, it, { skip: (o) => chairs.includes(o) });
    const parts = [];
    let sev = 'pass';
    const culprits = [];
    for (const side of ['front', 'back', 'left', 'right']) {
      const fr = faceFrame(it, side);
      const seated = chairs.some((c) => {
        const a = (c.x - fr.o[0]) * fr.v[0] + (c.y - fr.o[1]) * fr.v[1], b = (c.x - fr.o[0]) * fr.u[0] + (c.y - fr.o[1]) * fr.u[1];
        return b > -35 && b < 90 && Math.abs(a) <= fr.hw + 15;
      });
      const f = freeDepth(fr, 200, obs);
      const s = seated ? (f.depth < 75 ? 'warn' : f.depth < 90 ? 'info' : 'pass') : (f.depth < 45 ? 'info' : 'pass');
      if (s === 'warn' || (s === 'info' && sev === 'pass')) sev = s;
      if (s !== 'pass' && f.hit && f.hit.item) culprits.push(f.hit.item.id);
      parts.push(`${compass(fr.u)} ${f.depth >= 200 ? 'over 2 m' : cmStr(f.depth)}${seated ? ' (seats)' : ''}${s !== 'pass' ? ` — tight, to ${hitName(f.hit)}` : ''}`);
    }
    out.push(finding('dining-clearance', sev, it.id, sev === 'pass' ? `${it.name || 'Dining table'}: chairs can be pulled out on every side` : `${it.name || 'Dining table'}: not enough room to pull out the chairs`,
      `Free distance from the table edge in ${it.room.name}: ${parts.join('; ')}. A seated side needs 75–90 cm to pull a chair out and sit down (110 cm if people walk behind).`
      + (sev === 'warn' ? ' Move the table away from the tight side or use a bench there.' : ''), { itemIds: [it.id, ...culprits], spaceId: it.room.id, at: at(it) }));
    const rug = ctx.items.find((r) => r.type === 'rug' && pointInPolygon(it.x, it.y, r.poly));
    if (rug) {
      const margin = Math.min(...['front', 'back', 'left', 'right'].map((side) => rugMargin(faceFrame(it, side), rug)));
      out.push(finding('rug-dining', margin >= 60 ? 'pass' : 'info', rug.id, `${rug.name || 'Rug'} extends ${Math.round(margin)} cm beyond the dining table`,
        `The rug reaches ${Math.round(margin)} cm past the table edge on its shortest side; 60 cm or more keeps the chairs on the rug when pulled out.`, { itemIds: [rug.id, it.id], spaceId: it.room.id, at: at(rug) }));
    }
  }
}
/** How far a rug extends beyond a table face (cm). */
function rugMargin(fr, rug) {
  let far = 0;
  for (const [x, y] of rug.poly) far = Math.max(far, (x - fr.o[0]) * fr.u[0] + (y - fr.o[1]) * fr.u[1]);
  return far;
}

function checkLiving(ctx, out) {
  const { items } = ctx;
  for (const t of items.filter((i) => i.type === 'table' && i.h < 60 && i.room)) {
    const sofas = ctx.byRoom.get(t.room.id).filter((s) => s.type === 'sofa' || s.type === 'armchair');
    let best = null;
    for (const s of sofas) {
      // an L-shaped sofa's box includes the chaise: measure from the seat front (about 100 cm deep)
      const deep = s.type === 'sofa' && (s.params.corner || (s.params.chaise && s.params.chaise !== 'none')) ? Math.min(s.d, 100) : s.d;
      const seat = { ...s, d: deep };
      const [cx, cy] = itemLocalToPlan(s, 0, -s.d / 2 + deep / 2);
      seat.x = cx; seat.y = cy;
      const gap = polyDist(itemCorners(seat), t.poly);
      if (!best || gap < best.gap) best = { gap, s };
    }
    if (!best || best.gap > 150) continue;
    const sev = best.gap < 30 || best.gap > 60 ? 'info' : 'pass';
    out.push(finding('sofa-table', sev, t.id, `${t.name || 'Coffee table'}: ${Math.round(best.gap)} cm from the sofa seat`,
      `The gap between ${best.s.name || 'the sofa'} and ${t.name || 'the coffee table'} is about ${Math.round(best.gap)} cm; 40–45 cm is ideal (30–60 cm acceptable) — close enough to reach, wide enough to walk through.`,
      { itemIds: [t.id, best.s.id], spaceId: t.room.id, at: at(t) }));
  }
  for (const tv of items.filter((i) => i.type === 'tv' && i.room && (!i.params.variant || i.params.variant === 'tv' || i.params.variant === 'frame'))) {
    const seats = ctx.byRoom.get(tv.room.id).filter((s) => s.type === 'sofa' || s.type === 'armchair' || s.type === 'bed');
    if (!seats.length) continue;
    const fr = faceFrame(tv, 'front');
    let best = null;
    for (const s of seats) {
      const [sx, sy] = itemLocalToPlan(s, 0, -s.d / 2 + Math.min(s.d, 100) * 0.55);
      const b = (sx - fr.o[0]) * fr.u[0] + (sy - fr.o[1]) * fr.u[1];
      if (b > 50 && (!best || b < best.b)) best = { b, s };
    }
    if (!best) continue;
    const diag = tv.w / 0.8716, inch = diag / 2.54, ratio = best.b / diag;
    const centreH = tv.bottom + tv.h / 2;
    const sev = ratio < 1.0 || ratio > 2.5 ? 'info' : 'pass';
    out.push(finding('tv-distance', sev, tv.id, `${tv.name || 'TV'}: viewed from ${m(best.b, 1)} m (${ratio.toFixed(1)} × the diagonal)`,
      `The ${Math.round(inch)}" screen (${Math.round(diag)} cm diagonal) is watched from about ${m(best.b, 1)} m at ${best.s.name || 'the sofa'}. For 4K, 1.2–1.6 × the diagonal (${m(diag * 1.2, 1)}–${m(diag * 1.6, 1)} m) feels cinematic and up to 2.5 × is comfortable`
      + (ratio > 1.6 && ratio <= 2.5 ? `; at this distance a screen up to about ${Math.round(best.b / 1.6 / 2.54 * 0.99)}" would still suit.` : '.')
      + (centreH > 125 ? ` The screen centre is ${Math.round(centreH)} cm above the floor — seated eye level is about 105–115 cm, so consider mounting it lower.` : ''),
      { itemIds: [tv.id, best.s.id], spaceId: tv.room.id, at: at(tv) }));
  }
}

function checkCeiling(ctx, out) {
  for (const it of ctx.items) {
    if (!it.room && !it.area) continue;
    const spaceId = (it.room || it.area).id;
    if (it.type === 'pendant') {
      const under = ctx.items.find((t) => t !== it && t.solid && (t.type === 'table' || t.type === 'kitchen-island' || t.type === 'desk' || t.type === 'cabinet' || t.type === 'bed') && pointInPolygon(it.x, it.y, t.poly));
      if (under && under.type !== 'bed') {
        const gap = it.bottom - under.top;
        const sev = gap < 65 || gap > 105 ? 'info' : 'pass';
        out.push(finding('pendant-height', sev, it.id, `${it.name || 'Pendant'}: ${Math.round(gap)} cm above ${under.name || under.type}`,
          `The bottom of the pendant hangs ${Math.round(gap)} cm above the top of ${under.name || 'the surface'} (${Math.round(it.bottom)} cm above the floor). 75–90 cm lights the surface without glare or blocking the view across.`,
          { itemIds: [it.id, under.id], spaceId, at: at(it) }));
      } else {
        const sev = it.bottom < 200 ? 'warn' : it.bottom < 210 ? 'info' : 'pass';
        out.push(finding('pendant-height', sev, it.id, `${it.name || 'Pendant'}: ${m(it.bottom)} m head room`,
          `Nothing stands under this pendant, so people walk beneath it: its lowest point is ${m(it.bottom)} m above the floor. Keep at least 2.00 m (2.10 m is better) or hang it over a table.`, { itemIds: [it.id], spaceId, at: at(it) }));
      }
    } else if (it.type === 'ceiling-fan') {
      const r = Math.max(it.w, it.d) / 2;
      let gap = Infinity, near = null;
      for (const w of ctx.walls) { const d = polyDist([[it.x, it.y]], w.poly) - r; if (d < gap) { gap = d; near = 'a wall'; } }
      for (const o of ctx.items) if (o !== it && o.solid && o.top > it.bottom - 20) { const d = polyDist([[it.x, it.y]], o.poly) - r; if (d < gap) { gap = d; near = o.name || o.type; } }
      const sev = it.bottom < 213 ? 'warn' : it.bottom < 230 || gap < 45 ? 'info' : 'pass';
      out.push(finding('fan-clearance', sev, it.id, `${it.name || 'Ceiling fan'}: blades ${m(it.bottom)} m above the floor`,
        `The fan's lowest point is ${m(it.bottom)} m above the floor (2.30 m required by the appliance standard) and its blade tips are ${gap === Infinity ? 'far' : cmStr(Math.max(0, gap))} from ${near || 'anything'} (45–60 cm recommended).`
        + (it.bottom < 230 ? ` With a ${m(ctx.H)} m ceiling choose a fan no deeper than ${Math.round(ctx.H - 230)} cm.` : ''), { itemIds: [it.id], spaceId, at: at(it) }));
    }
  }
}

// ───────────────────────── kitchen ─────────────────────────

function checkKitchen(ctx, out) {
  for (const [roomId, list] of ctx.byRoom) {
    const units = list.filter((i) => KITCHEN_UNITS.has(i.type));
    if (!units.length) continue;
    const room = units[0].room;
    // narrowest aisle between facing runs
    let aisle = null;
    for (const u of units) {
      for (const side of u.type === 'kitchen-island' ? ['front', 'back', 'left', 'right'] : ['front']) {
        const f = freeDepth(faceFrame(u, side), 250, obstaclesFor(ctx, u, { skipSeats: true }));
        if (!f.hit || f.depth < 5 || f.depth >= 250) continue;                 // touching neighbour in an L corner, or open floor
        if (f.hit.item && !KITCHEN_UNITS.has(f.hit.item.type)) continue;
        if (!aisle || f.depth < aisle.depth) aisle = { depth: f.depth, a: u, b: f.hit };
      }
    }
    if (aisle) {
      const sev = aisle.depth < 90 ? 'warn' : aisle.depth < 100 ? 'info' : 'pass';
      out.push(finding('kitchen-aisle', sev, roomId, `Kitchen aisle ${Math.round(aisle.depth)} cm`,
        `The narrowest working aisle is ${Math.round(aisle.depth)} cm, between ${aisle.a.name || aisle.a.type} and ${hitName(aisle.b)}. 100–120 cm is recommended (107 cm for one cook, 122 cm for two); below 90 cm two people cannot pass and oven / dishwasher doors block the aisle.`,
        { itemIds: [aisle.a.id, ...(aisle.b.item ? [aisle.b.item.id] : [])], spaceId: roomId, at: at(aisle.a) }));
    }
    // work triangle
    const front = (i) => faceFrame(i, 'front').o;
    const sink = list.find((i) => (KITCHEN_UNITS.has(i.type) && i.params.sink) || (i.type === 'sink' && /kitchen/.test(i.params.variant || '')));
    const hob = list.find((i) => (KITCHEN_UNITS.has(i.type) && i.params.cooktop) || i.type === 'cooktop' || i.type === 'range');
    const fridge = list.find((i) => i.type === 'fridge' || (i.type === 'kitchen-tall' && i.params.fridge));
    if (sink && hob && fridge) {
      const d = (a, b) => Math.hypot(front(a)[0] - front(b)[0], front(a)[1] - front(b)[1]);
      const legs = [d(sink, hob), d(hob, fridge), d(fridge, sink)], sum = legs[0] + legs[1] + legs[2];
      const ok = sum <= 790 && legs.every((l) => l >= 120 && l <= 270);
      out.push(finding('kitchen-triangle', ok ? 'pass' : 'info', roomId, `Work triangle ${m(sum, 1)} m`,
        `Sink → cooktop ${m(legs[0], 1)} m, cooktop → refrigerator ${m(legs[1], 1)} m, refrigerator → sink ${m(legs[2], 1)} m; total ${m(sum, 1)} m. The guideline is 1.2–2.7 m per leg and no more than 7.9 m in total`
        + (ok ? ' — met.' : ` — ${legs[2] > 270 || legs[1] > 270 ? 'the refrigerator is a long walk from the sink / cooktop' : 'outside the guideline'}; acceptable in a large open kitchen with an island, but consider it when placing the fridge.`),
        { itemIds: [sink.id, hob.id, fridge.id], spaceId: roomId, at: at(hob) }));
    }
    if (hob) {
      const win = ctx.plan.openings.find((o) => o.kind === 'window' && polyDist(hob.poly, openingPoly(o)) < 15 && rangesOverlap(hob.bb, o));
      if (win) {
        out.push(finding('kitchen-hood-window', 'info', hob.id, 'Cooktop sits under a window',
          `${hob.name || 'The cooktop'} is directly below the ${win.width} cm window (sill ${win.sill} cm). A wall-mounted hood cannot be fitted there — plan a ceiling or downdraft extractor, keep curtains away from the burners, and note that a breeze can blow out a gas flame.`,
          { itemIds: [hob.id], spaceId: roomId, at: at(hob) }));
      }
    }
    // island seating
    for (const isl of units.filter((u) => u.type === 'kitchen-island')) {
      const stools = list.filter((s) => (s.type === 'bar-stool' || s.type === 'chair') && polyDist(s.poly, isl.poly) <= 25);
      if (!stools.length) continue;
      let bestSide = null;
      for (const side of ['front', 'back', 'left', 'right']) {
        const fr = faceFrame(isl, side);
        const n = stools.filter((s) => { const b = (s.x - fr.o[0]) * fr.u[0] + (s.y - fr.o[1]) * fr.u[1], a = (s.x - fr.o[0]) * fr.v[0] + (s.y - fr.o[1]) * fr.v[1]; return b > -30 && Math.abs(a) <= fr.hw + 10; }).length;
        if (!bestSide || n > bestSide.n) bestSide = { n, fr, side };
      }
      const len = bestSide.fr.hw * 2, per = len / bestSide.n;
      const over = num(isl.params.overhang, null);
      const need = isl.h >= 100 ? 30 : isl.h >= 85 ? 38 : 46;
      const tight = per < 59.5, shallow = over != null && over < need - 2;
      out.push(finding('kitchen-seating', tight || shallow ? 'info' : 'pass', isl.id, `Island seating: ${bestSide.n} seats, ${Math.round(per)} cm each`,
        `${bestSide.n} stools share the ${m(len)} m side of the island = ${Math.round(per)} cm per person; 61 cm each is recommended${tight ? `, so ${Math.floor(len / 61)} stools fit comfortably` : ''}.`
        + (over != null ? ` Knee overhang ${over} cm; ${need} cm is recommended at a ${Math.round(isl.h)} cm high counter${shallow ? ' — ask the kitchen maker for a deeper overhang' : ''}.` : ''),
        { itemIds: [isl.id, ...ids(stools)], spaceId: roomId, at: at(isl) }));
      const behind = freeDepth(bestSide.fr, 200, obstaclesFor(ctx, isl, { skip: (o) => stools.includes(o) }));
      const sev = behind.depth < 81 ? 'warn' : behind.depth < 112 ? 'info' : 'pass';
      out.push(finding('kitchen-seating-behind', sev, isl.id, `Behind the island seats: ${behind.depth >= 200 ? 'over 2 m' : cmStr(behind.depth)}`,
        `From the counter edge to ${hitName(behind.hit)} behind the stools there is ${behind.depth >= 200 ? 'more than 2 m' : cmStr(behind.depth)}. 81 cm is needed just to sit, 91 cm to edge past and 112 cm to walk past a seated person.`,
        { itemIds: [isl.id], spaceId: roomId, at: at(isl) }));
    }
  }
}
/** Do a box and an opening overlap along the opening's wall? */
const rangesOverlap = (bb, o) => {
  const F = openingFrame(o), [b0, bl] = rectExtent(bb, F.ux, F.uy), [o0, ol] = rectExtent(o, F.ux, F.uy);
  return b0 < o0 + ol && o0 < b0 + bl;
};

// ───────────────────────── bathrooms: electrical zones ─────────────────────────

function checkWetZones(ctx, out) {
  const ELECTRIC = new Set(['washer', 'water-heater', 'wall-light', 'ac-unit', 'tv', 'floor-lamp', 'table-lamp']);
  for (const [roomId, list] of ctx.byRoom) {
    const wet = list.filter((i) => i.type === 'shower' || i.type === 'bathtub');
    if (!wet.length) continue;
    const close = list.filter((i) => (ELECTRIC.has(i.type) || (i.type === 'towel-rail' && i.params.variant === 'heated') || (i.type === 'mirror' && i.params.frame === 'led'))
      && i.bottom < 225 && wet.some((w) => polyDist(i.poly, w.poly) < 60));
    if (close.length) {
      out.push(finding('bath-electric-zones', 'warn', roomId, `${names(close)} within 60 cm of the shower / bath`,
        `${names(close)} ${close.length > 1 ? 'are' : 'is'} inside the 60 cm zone around the shower or bath (zones 1–2). No socket may be installed there and any fixed equipment must be splash-proof (IPX4 / IPX5) and wired by a licensed electrician; move plug-in appliances further away.`,
        { itemIds: ids(close), spaceId: roomId, at: at(close[0]) }));
    } else {
      out.push(finding('bath-electric-zones', 'pass', roomId, `${wet[0].room.name}: no appliances in the wet zone`,
        'No electrical appliance stands within 60 cm of the shower or bath. Sockets belong at least 60 cm away (zone 3) on a 30 mA residual-current device.', { spaceId: roomId }));
    }
  }
}

// ───────────────────────── safe room ─────────────────────────

function checkMamadItems(ctx, out) {
  const { plan } = ctx;
  for (const room of plan.rooms.filter((r) => r.type === 'mamad')) {
    const list = ctx.byRoom.get(room.id) || [];
    const ex = { spaceId: room.id };
    const wetUse = list.filter((i) => ['toilet', 'shower', 'bathtub', 'range', 'cooktop', 'kitchen-base', 'kitchen-island', 'kitchen-tall', 'dishwasher'].includes(i.type));
    out.push(finding('mamad-use', wetUse.length ? 'fail' : 'pass', room.id, wetUse.length ? `Safe room is fitted as a ${wetUse.some((i) => /kitchen|range|cooktop|dishwasher/.test(i.type)) ? 'kitchen' : 'bathroom'}` : 'Safe room used as a normal room',
      wetUse.length ? `${names(wetUse)} in the mamad: a safe room may not serve as a kitchen, bathroom or toilet room.`
        : 'The mamad is furnished as a bedroom / study, which is allowed and recommended; it may not become a kitchen, bathroom or WC.', { ...ex, itemIds: ids(wetUse) }));

    const beds = list.filter((i) => i.type === 'bed' || i.type === 'bunk-bed' || i.type === 'crib' || (i.type === 'sofa'));
    const hung = list.filter((i) => i.placement === 'wall' && i.type !== 'curtain' && i.type !== 'ac-unit' && i.type !== 'wall-light');
    const above = hung.filter((i) => beds.some((b) => i.bottom >= b.top - 30 && polyDist(i.poly, b.poly) < 20));
    if (above.length) {
      out.push(finding('mamad-above-bed', 'warn', room.id, `${names(above)} hangs above a bed in the safe room`,
        `${names(above)} ${above.length > 1 ? 'are' : 'is'} mounted over a bed or sofa in the mamad. Blast shaking can throw wall-hung objects down — hang nothing heavy or breakable above where people sleep or sit.`, { ...ex, itemIds: ids(above), at: at(above[0]) }));
    }
    const glass = list.filter((i) => i.type === 'mirror' || (i.type === 'wardrobe' && num(i.params.mirror, 0) > 0) || (i.type === 'wall-art' && ['framed', 'gallery', 'photo'].includes(i.params.variant))
      || ((i.type === 'cabinet' || i.type === 'bookcase') && i.params.glassDoors) || (i.type === 'table' && i.params.top === 'glass') || (i.type === 'vase'));
    const heavyLight = list.filter((i) => i.type === 'ceiling-fan' || (i.type === 'pendant' && ['chandelier', 'sputnik', 'cluster'].includes(i.params.variant)));
    const tall = list.filter((i) => i.solid && i.top >= 120 && ['wardrobe', 'bookcase', 'cabinet', 'kitchen-tall', 'coat-rack'].includes(i.type));
    const sides = openingSidesOfRoom(plan, room);
    const tvOut = list.filter((i) => i.type === 'tv' && i.placement === 'wall' && sides.exterior.some((w) => polyDist(i.poly, w) < 15));
    const notes = [];
    if (glass.length) notes.push(`${names(glass)}: glass, mirrors and ceramics can shatter — the guidance is not to hang or keep them in the mamad (use acrylic mirrors, canvas art, unglazed frames)`);
    if (heavyLight.length) notes.push(`${names(heavyLight)}: prefer a light flush ceiling fitting to a chandelier or heavy fixture`);
    if (tvOut.length) notes.push(`${names(tvOut)}: mount the TV on an internal wall rather than the external one`);
    if (tall.length) notes.push(`${names(tall)}: fix tall cabinets and shelves to the concrete walls with proper anchors, keep heavy things on the low shelves and lock the doors if possible`);
    out.push(finding('mamad-furnishing', glass.length || heavyLight.length || tvOut.length ? 'warn' : tall.length ? 'info' : 'pass', room.id,
      glass.length ? 'Safe room: glass / mirror items' : heavyLight.length ? 'Safe room: heavy ceiling fitting' : tvOut.length ? 'Safe room: TV on the external wall' : tall.length ? `Safe room: anchor ${tall.length} tall piece${tall.length > 1 ? 's' : ''} to the wall` : 'Safe room furnishing follows the guidance',
      notes.length ? notes.join('. ') + '.' : 'Nothing breakable, heavy or wall-hung in the mamad conflicts with the Home Front Command guidance.',
      { ...ex, itemIds: ids([...glass, ...heavyLight, ...tvOut, ...tall]) }));

    const ac = list.filter((i) => i.type === 'ac-unit');
    if (ac.length) {
      out.push(finding('mamad-ac', 'info', room.id, 'Air conditioner in the safe room', 'An AC unit in the mamad must be installed per SI 994 part 5: the pipes pass through the sealed sleeve cast in the wall for that purpose. Do not let an installer drill a new hole through a mamad wall without the Home Front Command approved sealing detail.', { ...ex, itemIds: ids(ac), at: at(ac[0]) }));
    }
    // LPG near the mamad walls
    const gas = ctx.items.filter((i) => (i.type === 'utility' && i.params.variant === 'gas-tanks') || (i.type === 'bbq' && (!i.params.variant || /gas|outdoor-kitchen|built-in/.test(i.params.variant))));
    const shell = polygonBounds(room.polygon);
    const outer = rectPoly({ x: shell.x - 30, y: shell.y - 30, w: shell.w + 60, h: shell.h + 60 });
    for (const gItem of gas) {
      const d = polyDist(gItem.poly, outer);
      if (d >= 300) continue;
      const tank = gItem.type === 'utility';
      out.push(finding('mamad-gas', tank ? 'fail' : 'info', gItem.id, `${gItem.name || 'Gas cylinders'} ${m(d, 1)} m from the safe-room wall`,
        `${gItem.name || 'The gas cylinders'} ${tank ? 'are' : 'has a gas cylinder'} about ${m(d, 1)} m from the mamad walls. LPG cylinders must be at least 3 m away from the walls of the safe room.`, { itemIds: [gItem.id], at: at(gItem) }));
    }
  }
}
/** Polygons of the external wall pieces of a room (used for "TV on an internal wall"). */
function openingSidesOfRoom(plan, room) {
  const bb = polygonBounds(room.polygon);
  const exterior = [], polys = wallPolys(plan);
  for (const [i, w] of plan.walls.entries()) {
    const touches = w.x <= bb.x + bb.w + 1 && w.x + w.w >= bb.x - 1 && w.y <= bb.y + bb.h + 1 && w.y + w.h >= bb.y - 1;
    if (!touches) continue;
    const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
    const dx = cx < bb.x ? -1 : cx > bb.x + bb.w ? 1 : 0, dy = cy < bb.y ? -1 : cy > bb.y + bb.h ? 1 : 0;
    if (dx && dy) continue;
    const px = cx + dx * (w.w / 2 + 10), py = cy + dy * (w.h / 2 + 10);
    if (!plan.rooms.some((r) => pointInPolygon(px, py, r.polygon))) exterior.push(polys[i]);
  }
  return { exterior };
}

/** All interior-layout findings. */
export function checkInterior(ctx) {
  const out = [];
  checkPlacement(ctx, out);
  checkDoorsAndWindows(ctx, out);
  checkRoutes(ctx, out);
  checkBeds(ctx, out);
  checkFronts(ctx, out);
  checkDining(ctx, out);
  checkLiving(ctx, out);
  checkCeiling(ctx, out);
  checkKitchen(ctx, out);
  checkWetZones(ctx, out);
  checkMamadItems(ctx, out);
  return out;
}

