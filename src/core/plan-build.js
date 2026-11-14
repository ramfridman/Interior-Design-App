/**
 * PLAN BUILDER — a complete, validated PLAN-shaped object from just walls and openings.
 * Pure logic (no DOM, no THREE, no live state). See docs/CONTRACT.md § 10 "Projects and plan source".
 *
 *   import { buildPlan } from './core/plan-build.js';
 *   const { ok, plan, warnings } = buildPlan({ walls, openings, meta, heights, site });
 *
 * INPUT (plan space as everywhere: cm, +x east, +y south, origin = the house's outer north-west corner)
 *   walls     [{ x, y, w, h, kind?, id? }] or [[x, y, w, h, kind?]] — the exact shapes of PLAN.walls (axis-aligned
 *             rectangles of solid wall; door / window gaps are NOT wall). An axis-aligned centre line
 *             { x1, y1, x2, y2, thickness } is accepted too. The engine is ORTHOGONAL and has ONE FLOOR: diagonal or
 *             curved walls, polygons and upper floors are reported as errors and left out.
 *   openings  [{ kind: 'door' | 'window' | 'sliding-door' | 'opening', x, y, w, h, axis?, width?, height?, sill?, style?,
 *             hinge?, swing?, id? }] — the shapes of PLAN.openings; the rectangle is the gap through the wall.
 *   meta      { name, location, latitude, longitude, timeZone, northAngle (clockwise degrees from plan "up" to true
 *             north), … } — anything missing gets a default and an entry in `plan.assumptions`.
 *   heights   { ceiling, slab, parapet, floorAboveGround, doorDefault } (cm)
 *   site      { boundary?: [[x, y]…], margins?: { n, e, s, w } (cm, default 300), lot?: { width, depth } (cm; the house
 *             sits at margins.w / margins.n from the lot's NW corner), street?: 'n'|'e'|'s'|'w', buildingLine?, setbacks?,
 *             parking?, paths?, features? }
 *   outdoorAreas  optional [{ id, name, type, polygon }] (none by default)
 *   slants / stairs / levels   optional schema-2 data (docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md § 2, plan-schema.js) —
 *             carried into the plan (nothing is derived from them; they are moved with the origin like the walls) only
 *             with the option `passThrough: true`; `meta.floors` then becomes 1 + levels.length. Without it they are
 *             ignored and upper floors stay an error (today's behaviour).
 *   levels    FIRST-CLASS upper floors (stage F1) with the option `levels: true` or while FEATURES.levels is on:
 *             [{ id?: 'L1'…, name?, nameHe?, heights?: { ceiling, slab, parapet }, walls, openings, voids?, stairs?,
 *             slants?, elevation? }] bottom-up — each level's walls + openings are read and derived exactly like L0's
 *             (rooms, outline, opening sides; wall ids 'L1|w01'…; room and opening ids unique across levels);
 *             heights default to L0's; elevation = level below's elevation + its ceiling + this level's slab (a different
 *             given elevation is reported); the origin is the north-west corner of all levels together.
 *
 * OPTIONS  { passThrough?: boolean, levels?: boolean }
 *
 * OUTPUT  { ok, plan, warnings }  — never throws on user data.
 *   ok        false when any warning has level 'error' (something was left out); `plan` is still complete and usable.
 *   plan      { meta, heights, bounds, walls, wallOutline, openings, rooms, outdoorAreas, site, assumptions }
 *             walls / wallOutline / rooms / opening sides are derived by the plan engine (plan-edit.js) exactly as after
 *             an edit; rooms get a first-guess name and type (largest = living space) that the user can change.
 *   warnings  [{ level: 'error' | 'warning' | 'info', text, ref? }] — plain English, ready to show.
 */
import { analyseWalls, wallBounds, BUILTIN_PLAN } from './plan-edit.js';
import { FEATURES } from './features.js';
import { isLevelId, recomputeElevations } from './levels.js';
import { optionalKeysProblem, optionalPart, normalizeOptionalKeys, setOptionalKeys } from './plan-schema.js';
import { polygonArea } from './geometry.js';

const DEFAULT_MARGIN = 300;               // cm of garden around the house on a default lot
const MAX_WALL = 30;                      // cm — thickest wall the engine understands (thicker = a solid block)
const OPENING_DEFAULTS = {
  door: { height: 210, sill: 0, style: 'interior', extStyle: 'service' },
  'sliding-door': { height: 210, sill: 0, style: 'glass-sliding' },
  window: { height: 100, sill: 110, style: 'sliding' },
  opening: { height: 210, sill: 0, style: 'open' },
};
const HINGES = { h: 'w', v: 'n' }, SWINGS = { h: 's', v: 'e' };

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const toNum = (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);
const r1 = (v) => Math.round(v);

/** The built-in house's location — the default for a new plan (Israel). */
export const DEFAULT_LOCATION = Object.freeze({
  location: BUILTIN_PLAN.meta.location, latitude: BUILTIN_PLAN.meta.latitude, longitude: BUILTIN_PLAN.meta.longitude, timeZone: BUILTIN_PLAN.meta.timeZone,
});
/** Default vertical dimensions (cm) — the built-in house's. */
export const DEFAULT_HEIGHTS = Object.freeze({ ...BUILTIN_PLAN.heights });

/**
 * Build a complete plan from walls and openings. See the file header for the shapes.
 * @returns {{ ok: boolean, plan: object, warnings: Array<{ level: 'error'|'warning'|'info', text: string, ref?: string }> }}
 */
export function buildPlan(input = {}, { passThrough = false, levels: levelsOption } = {}) {
  const warnings = [];
  const say = (level, text, ref) => warnings.push(ref == null ? { level, text } : { level, text, ref });
  try {
    const src = input && typeof input === 'object' ? input : {};
    const firstClass = (levelsOption === true || (levelsOption !== false && FEATURES.levels)) && Array.isArray(src.levels) && src.levels.length > 0;
    let extra = passThrough ? readOptional(firstClass ? { ...src, levels: undefined } : src, say) : null;
    const meta = readMeta(src.meta, say, firstClass ? 1 + src.levels.length : extra ? 1 + (extra.levels ? extra.levels.length : 0) : 1);
    const heights = readHeights(src.heights, say);
    const ups = firstClass ? readLevelInputs(src.levels, heights, say) : null;
    let walls = readWalls(src.walls, say);
    const openingIds = new Set();
    let openings = readOpenings(src.openings, heights, say, openingIds);
    if (ups) for (const u of ups) u.openings = readOpenings(u.rawOpenings, u.heightsAll, u.say, openingIds);

    // origin = outer north-west corner of the house (of every level)
    const box = wallBounds(ups ? [...walls, ...ups.flatMap((u) => u.walls)] : walls);
    let shift = { x: 0, y: 0 };
    if (box && (box.x !== 0 || box.y !== 0)) {
      shift = { x: -box.x, y: -box.y };
      walls = walls.map((w) => ({ ...w, x: w.x + shift.x, y: w.y + shift.y }));
      openings = openings.map((o) => ({ ...o, x: o.x + shift.x, y: o.y + shift.y }));
      if (ups) for (const u of ups) { u.walls = u.walls.map((w) => ({ ...w, x: w.x + shift.x, y: w.y + shift.y })); u.openings = u.openings.map((o) => ({ ...o, x: o.x + shift.x, y: o.y + shift.y })); Object.assign(u.extra, shiftOptional(u.extra, shift)); }
      if (extra) extra = shiftOptional(extra, shift);
      say('info', `The plan was moved by ${-shift.x} cm east–west and ${-shift.y} cm north–south so that the house's north-west corner is the origin.`);
    }
    const outdoorAreas = readOutdoorAreas(src.outdoorAreas, shift, say);

    // openings must sit in a wall: those that touch no wall at all are left out
    openings = openingsInWalls(walls, openings, say);

    let derived = analyseWalls(walls, openings, { outdoorAreas });
    const bad = new Map(derived.problems.map((p) => [p.id, p.type]));
    if (bad.size) {
      for (const [id, type] of bad) {
        const o = openings.find((x) => x.id === id);
        const text = type === 'overlap' ? 'overlaps another opening' : type === 'blocked' ? 'does not lead anywhere (a wall blocks one side)' : 'does not sit cleanly in one straight wall, or has less than 10 cm of wall beside it';
        say('error', `The ${o ? word(o) : 'opening'} ${id} ${text} — it was left out.`, id);
      }
      openings = openings.filter((o) => !bad.has(o.id));
      derived = analyseWalls(walls, openings, { outdoorAreas });
    }

    const rooms = nameRooms(derived.rooms, say);
    const finalOpenings = derived.openings.map(finalOpening);
    const levels = ups ? buildLevels(ups, rooms, heights) : null;
    const bounds = (levels ? wallBounds([...derived.walls, ...levels.flatMap((l) => l.walls)], [...finalOpenings, ...levels.flatMap((l) => l.openings)]) : wallBounds(derived.walls, finalOpenings)) || { x: 0, y: 0, w: 0, h: 0 };
    const site = readSite(src.site, bounds, shift, say);
    if (!walls.length) say('info', 'There are no walls yet — draw the house with the Structure tools.');
    else if (!rooms.length) say('warning', 'No enclosed room was found: walls must meet (or cross) to close a room, and door / window gaps must be inside walls.');

    const plan = {
      meta,
      heights,
      bounds,
      walls: derived.walls.map(({ cls, ...w }) => w),
      wallOutline: derived.wallOutline,
      openings: finalOpenings,
      rooms,
      outdoorAreas,
      site,
      assumptions: assumptionsFor(src, meta, heights),
    };
    if (levels) setOptionalKeys(plan, optionalPart(normalizeOptionalKeys({ ...(extra || {}), levels })));
    else if (extra) setOptionalKeys(plan, extra);
    return { ok: !warnings.some((w) => w.level === 'error'), plan, warnings };
  } catch (err) {
    say('error', 'The plan could not be built: ' + (err && err.message ? err.message : String(err)));
    return { ok: false, plan: emptyPlan(), warnings };
  }
}

/** An empty lot (no walls): `lot` = { width, depth } in cm, the origin `margins.w` / `margins.n` in from its NW corner. */
export function emptyPlan({ meta, heights, lot, margins, street } = {}) {
  return buildPlan({ walls: [], openings: [], meta, heights, site: { lot, margins, street } }).plan;
}

/** Exterior doors without a given style get the exterior style; the reader's marker goes. */
function finalOpening(o) {
  const d = OPENING_DEFAULTS[o.kind];
  const next = { ...o };
  if (o.kind === 'door' && o.exterior && !o.styleGiven && next.style === d.style) next.style = d.extStyle;
  delete next.styleGiven;
  return next;
}

/** Openings that touch no wall of their level are left out (an error each). */
function openingsInWalls(walls, openings, say) {
  return openings.filter((o) => {
    const hit = walls.some((w) => w.x < o.x + o.w && o.x < w.x + w.w && w.y < o.y + o.h && o.y < w.y + w.h);
    const near = hit || walls.some((w) => (w.x === o.x + o.w || o.x === w.x + w.w) && w.y < o.y + o.h && o.y < w.y + w.h)
      || walls.some((w) => (w.y === o.y + o.h || o.y === w.y + w.h) && w.x < o.x + o.w && o.x < w.x + w.w);
    if (!near) say('error', `The ${word(o)} ${o.id} is not in any wall — it was left out.`, o.id);
    return near;
  });
}

/** Optional data (slants, stairs, levels, voids…) moved by `shift` (the origin move): positions, outlines, labels. */
function shiftOptional(data, shift) {
  const dx = shift.x, dy = shift.y, P = (p) => [p[0] + dx, p[1] + dy];
  const obj = (o) => {
    if (!o || typeof o !== 'object') return o;
    const n = { ...o };
    if (num(n.x) && num(n.y) && n.axis !== 'a') { n.x += dx; n.y += dy; }
    if (['x1', 'y1', 'x2', 'y2'].every((k) => num(n[k]))) { n.x1 += dx; n.y1 += dy; n.x2 += dx; n.y2 += dy; }
    for (const k of ['poly', 'polygon']) if (Array.isArray(n[k])) n[k] = n[k].map(P);
    if (Array.isArray(n.label) && n.label.length >= 2) n.label = P(n.label);
    if (n.footprint && num(n.footprint.x) && num(n.footprint.y)) n.footprint = { ...n.footprint, x: n.footprint.x + dx, y: n.footprint.y + dy };
    if (Array.isArray(n.zones)) n.zones = n.zones.map((z) => (z && Array.isArray(z.label) ? { ...z, label: P(z.label) } : z));
    return n;
  };
  const list = (a) => (Array.isArray(a) ? a.map(obj) : a);
  const out = { ...data };
  for (const k of ['slants', 'stairs', 'voids', 'outdoorAreas', 'walls', 'openings', 'rooms']) if (out[k] !== undefined) out[k] = list(out[k]);
  if (Array.isArray(out.wallOutline)) out.wallOutline = out.wallOutline.map((g) => (Array.isArray(g) && g.length >= 4 ? [g[0] + dx, g[1] + dy, g[2] + dx, g[3] + dy] : g));
  if (Array.isArray(out.levels)) out.levels = out.levels.map((l) => shiftOptional(l, shift));
  return out;
}

/** First-class upper levels: read (walls; openings are read later with the global id set), heights, ids, names. */
function readLevelInputs(raw, heights, say) {
  const out = [], ids = new Set();
  raw.forEach((l0, i) => {
    const l = l0 && typeof l0 === 'object' ? l0 : {};
    let id = isLevelId(l.id) && !ids.has(l.id) ? l.id : null;
    if (!id) { let n = i + 1; while (ids.has('L' + n)) n++; id = 'L' + n; if (l.id != null) say('warning', `Floor ${i + 1} was renamed ${id} (its id "${l.id}" is not usable).`); }
    ids.add(id);
    const label = typeof l.name === 'string' && l.name.trim() ? l.name.trim() : `Floor ${i + 1}`;
    const lsay = (level, text, ref) => say(level, `${label}: ${text}`, ref);
    const h = { ceiling: heights.ceiling, slab: heights.slab, parapet: heights.parapet };
    if (l.heights && typeof l.heights === 'object') for (const [k, lo, hi] of [['ceiling', 200, 600], ['slab', 0, 100], ['parapet', 0, 200]]) {
      const v = toNum(l.heights[k]);
      if (v == null) continue;
      if (num(v) && v >= lo && v <= hi) h[k] = Math.round(v); else lsay('warning', `Height "${k}" is not ${lo}–${hi} cm — ${h[k]} cm was used.`);
    }
    const extra = {};
    for (const k of ['voids', 'stairs', 'slants']) if (Array.isArray(l[k]) && l[k].length) extra[k] = clone(l[k]);
    out.push({ id, name: typeof l.name === 'string' && l.name.trim() ? l.name.trim() : null, nameHe: typeof l.nameHe === 'string' && l.nameHe.trim() ? l.nameHe.trim() : null,
      givenElevation: num(toNum(l.elevation)) ? toNum(l.elevation) : null, heights: h, heightsAll: { ...heights, ...h }, say: lsay,
      walls: readWalls(Array.isArray(l.walls) ? l.walls.map((w) => (w && typeof w === 'object' && !Array.isArray(w) && w.floor != null ? { ...w, floor: undefined } : w)) : l.walls, lsay),
      rawOpenings: l.openings, extra });
  });
  return out;
}

/** Derive every upper level like L0 (rooms named, ids global), elevations from the heights. */
function buildLevels(ups, groundRooms, heights) {
  const taken = new Set(groundRooms.map((r) => r.id));
  const built = ups.map((u) => {
    let openings = openingsInWalls(u.walls, u.openings, u.say);
    let derived = analyseWalls(u.walls, openings, { level: u.id, reservedRoomIds: taken });
    const bad = new Map(derived.problems.map((p) => [p.id, p.type]));
    if (bad.size) {
      for (const [id, type] of bad) {
        const o = openings.find((x) => x.id === id);
        const text = type === 'overlap' ? 'overlaps another opening' : type === 'blocked' ? 'does not lead anywhere (a wall blocks one side)' : 'does not sit cleanly in one straight wall, or has less than 10 cm of wall beside it';
        u.say('error', `The ${o ? word(o) : 'opening'} ${id} ${text} — it was left out.`, id);
      }
      openings = openings.filter((o) => !bad.has(o.id));
      derived = analyseWalls(u.walls, openings, { level: u.id, reservedRoomIds: taken });
    }
    if (!u.walls.length) u.say('info', 'There are no walls on this floor yet.');
    const rooms = nameRooms(derived.rooms, u.say);
    for (const r of rooms) taken.add(r.id);
    const lv = { id: u.id };
    if (u.name) lv.name = u.name;
    if (u.nameHe) lv.nameHe = u.nameHe;
    Object.assign(lv, { elevation: 0, heights: u.heights, walls: derived.walls.map(({ cls, ...w }) => w), wallOutline: derived.wallOutline, openings: derived.openings.map(finalOpening), rooms }, u.extra);
    return lv;
  });
  const levels = recomputeElevations(built, heights);
  levels.forEach((l, i) => { const g = ups[i].givenElevation; if (g != null && g !== l.elevation) ups[i].say('warning', `The floor's elevation was computed from the heights: ${l.elevation} cm (${g} cm was given).`); });
  return levels;
}

// ---------------------------------------------------------------- readers
const word = (o) => (o.kind === 'window' ? 'window' : o.kind === 'opening' ? 'passage' : o.kind === 'sliding-door' ? 'sliding door' : 'door');

/** Optional schema-2 data (passThrough): a deep copy with the lazy schema applied, or {} when unreadable / absent. */
function readOptional(src, say) {
  const part = clone(optionalPart(src));
  const problem = optionalKeysProblem(part);
  if (problem) { say('error', `The angled walls, stairs or upper floors are not readable (${problem}) — they were left out.`); return {}; }
  return optionalPart(normalizeOptionalKeys(part));
}

function readMeta(raw, say, floors = 1) {
  const m = raw && typeof raw === 'object' ? clone(raw) : {};
  const meta = {
    name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : 'New house',
    location: typeof m.location === 'string' ? m.location : '',
    floors,
    northAngle: num(toNum(m.northAngle)) ? toNum(m.northAngle) : 0,
    latitude: num(toNum(m.latitude)) && Math.abs(toNum(m.latitude)) <= 90 ? toNum(m.latitude) : DEFAULT_LOCATION.latitude,
    longitude: num(toNum(m.longitude)) && Math.abs(toNum(m.longitude)) <= 180 ? toNum(m.longitude) : DEFAULT_LOCATION.longitude,
    timeZone: typeof m.timeZone === 'string' && validZone(m.timeZone) ? m.timeZone : DEFAULT_LOCATION.timeZone,
  };
  if (m.floors != null && m.floors !== floors) say('error', 'Only one floor is supported: the plan engine models a single-storey house. The plan was built as one floor.');
  if (m.latitude != null && meta.latitude !== toNum(m.latitude)) say('warning', 'The latitude is not a number between −90 and 90 — the default location was used.');
  if (m.longitude != null && meta.longitude !== toNum(m.longitude)) say('warning', 'The longitude is not a number between −180 and 180 — the default location was used.');
  meta.northAngle = ((meta.northAngle % 360) + 540) % 360 - 180;
  for (const [k, v] of Object.entries(m)) if (!(k in meta) && v != null && typeof v !== 'object') meta[k] = v;   // keep extra facts (architect, lot, model…)
  return meta;
}
function validZone(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; } }

function readHeights(raw, say) {
  const h = { ...DEFAULT_HEIGHTS };
  if (raw && typeof raw === 'object') for (const k of Object.keys(h)) {
    const v = toNum(raw[k]);
    if (v == null) continue;
    if (num(v) && v >= 0 && v <= 1000) h[k] = Math.round(v); else say('warning', `Height "${k}" is not a sensible number of centimetres — ${h[k]} cm was used.`);
  }
  if (h.ceiling < 200 || h.ceiling > 600) { say('warning', `A ${h.ceiling} cm ceiling is unusual — 300 cm was used.`); h.ceiling = DEFAULT_HEIGHTS.ceiling; }
  return h;
}

function readWalls(raw, say) {
  const out = [];
  if (raw != null && !Array.isArray(raw)) { say('error', 'Walls must be a list.'); return out; }
  (raw || []).forEach((w0, i) => {
    const n = i + 1;
    let w = w0;
    if (Array.isArray(w)) w = { x: w[0], y: w[1], w: w[2], h: w[3], kind: w[4] };
    if (!w || typeof w !== 'object') { say('error', `Wall ${n} is not readable — it was left out.`); return; }
    if (w.polygon || w.points || w.curve || w.arc) { say('error', `Wall ${n} is not a rectangle. Only straight walls running east–west or north–south can be modelled (the plan engine is orthogonal) — it was left out.`, w.id); return; }
    if (w.floor != null && w.floor !== 0 && w.floor !== 1) { say('error', `Wall ${n} is on another floor. Only one floor is supported — it was left out.`, w.id); return; }
    let rect;
    if (['x1', 'y1', 'x2', 'y2'].every((k) => num(toNum(w[k])))) {
      const x1 = toNum(w.x1), y1 = toNum(w.y1), x2 = toNum(w.x2), y2 = toNum(w.y2), t = num(toNum(w.thickness)) ? toNum(w.thickness) : 10;
      if (x1 !== x2 && y1 !== y2) { say('error', `Wall ${n} runs diagonally. Only walls running east–west or north–south can be modelled (the plan engine is orthogonal) — it was left out.`, w.id); return; }
      rect = x1 === x2 ? { x: x1 - t / 2, y: Math.min(y1, y2), w: t, h: Math.abs(y2 - y1) } : { x: Math.min(x1, x2), y: y1 - t / 2, w: Math.abs(x2 - x1), h: t };
    } else rect = { x: toNum(w.x), y: toNum(w.y), w: toNum(w.w), h: toNum(w.h) };
    if (![rect.x, rect.y, rect.w, rect.h].every(num) || rect.w <= 0 || rect.h <= 0) { say('error', `Wall ${n} has no usable position and size (x, y, w, h in cm) — it was left out.`, w.id); return; }
    rect = { x: r1(rect.x), y: r1(rect.y), w: Math.max(1, r1(rect.w)), h: Math.max(1, r1(rect.h)) };
    if (Math.min(rect.w, rect.h) > MAX_WALL) say('warning', `Wall ${n} is ${Math.min(rect.w, rect.h)} cm thick; walls thicker than ${MAX_WALL} cm are treated as solid blocks.`, w.id);
    const kind = ['exterior', 'interior', 'mamad'].includes(w.kind) ? w.kind : 'interior';
    out.push({ id: typeof w.id === 'string' && w.id ? w.id : 'w' + String(n).padStart(2, '0'), ...rect, kind });
  });
  return out;
}

function readOpenings(raw, heights, say, ids = new Set()) {
  const out = [];
  if (raw != null && !Array.isArray(raw)) { say('error', 'Openings must be a list.'); return out; }
  const counters = { door: 0, window: 0, 'sliding-door': 0, opening: 0 };
  (raw || []).forEach((o, i) => {
    const n = i + 1;
    if (!o || typeof o !== 'object') { say('error', `Opening ${n} is not readable — it was left out.`); return; }
    const kind = OPENING_DEFAULTS[o.kind] ? o.kind : null;
    if (!kind) { say('error', `Opening ${n} has an unknown kind "${o.kind}" (door, window, sliding-door or opening) — it was left out.`, o.id); return; }
    const x = toNum(o.x), y = toNum(o.y), w = toNum(o.w), h = toNum(o.h);
    if (![x, y, w, h].every(num) || w <= 0 || h <= 0) { say('error', `The ${kind} ${o.id || n} has no usable rectangle (x, y, w, h in cm) — it was left out.`, o.id); return; }
    const axis = o.axis === 'h' || o.axis === 'v' ? o.axis : w >= h ? 'h' : 'v';
    const d = OPENING_DEFAULTS[kind];
    const width = r1(axis === 'h' ? w : h);
    const height = num(toNum(o.height)) ? r1(toNum(o.height)) : kind === 'window' ? d.height : heights.doorDefault || d.height;
    const sill = kind === 'window' ? (num(toNum(o.sill)) ? r1(toNum(o.sill)) : d.sill) : 0;
    let id = typeof o.id === 'string' && o.id && !ids.has(o.id) ? o.id : null;
    if (!id) { const pre = kind === 'window' ? 'win' : kind === 'opening' ? 'pass' : 'door'; do id = `${pre}-${++counters[kind]}`; while (ids.has(id)); }
    ids.add(id);
    const next = { id, kind, style: typeof o.style === 'string' && o.style ? o.style : d.style, axis, x: r1(x), y: r1(y), w: r1(w), h: r1(h), width, height, sill };
    if (!o.style) next.styleGiven = false; else next.styleGiven = true;
    if (kind === 'door') { next.hinge = ['n', 's', 'e', 'w'].includes(o.hinge) ? o.hinge : HINGES[axis]; next.swing = ['n', 's', 'e', 'w'].includes(o.swing) ? o.swing : SWINGS[axis]; }
    if (sill + height > heights.ceiling - 20) say('warning', `The ${word(next)} ${id} reaches ${sill + height} cm — less than 20 cm below the ${heights.ceiling} cm ceiling.`, id);
    next.label = `${width} / ${height}` + (sill ? `(+${sill})` : '');
    if (o.assumed) next.assumed = clone(o.assumed);
    out.push(next);
  });
  return out;
}

function readOutdoorAreas(raw, shift, say) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((a, i) => {
    const poly = a && Array.isArray(a.polygon) ? a.polygon.map((p) => [toNum(p[0]) + shift.x, toNum(p[1]) + shift.y]) : null;
    if (!poly || poly.length < 3 || !poly.every((p) => num(p[0]) && num(p[1]))) { say('warning', `Outdoor area ${i + 1} has no usable outline — it was left out.`); return; }
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    out.push({ id: typeof a.id === 'string' && a.id ? a.id : `outdoor-${i + 1}`, name: a.name || 'Outdoor area', type: a.type || 'terrace', polygon: poly,
      label: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] });
  });
  return out;
}

function readSite(raw, bounds, shift, say) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const mg = { n: DEFAULT_MARGIN, e: DEFAULT_MARGIN, s: DEFAULT_MARGIN, w: DEFAULT_MARGIN };
  if (s.margins && typeof s.margins === 'object') for (const k of Object.keys(mg)) { const v = toNum(s.margins[k]); if (num(v) && v >= 0) mg[k] = v; }
  const movePoly = (poly) => poly.map((p) => [toNum(p[0]) + shift.x, toNum(p[1]) + shift.y]);
  let boundary = null;
  if (Array.isArray(s.boundary) && s.boundary.length >= 3) {
    boundary = movePoly(s.boundary);
    if (!boundary.every((p) => num(p[0]) && num(p[1]))) { say('warning', 'The lot boundary is not readable — a rectangular lot around the house was used.'); boundary = null; }
  }
  if (!boundary && s.lot && num(toNum(s.lot.width)) && num(toNum(s.lot.depth)) && toNum(s.lot.width) > 0 && toNum(s.lot.depth) > 0) {
    const W = toNum(s.lot.width), D = toNum(s.lot.depth);
    boundary = [[-mg.w, -mg.n], [W - mg.w, -mg.n], [W - mg.w, D - mg.n], [-mg.w, D - mg.n]];
    if (bounds.w > 0 && (bounds.x + bounds.w > W - mg.w || bounds.y + bounds.h > D - mg.n)) say('warning', 'The house does not fit inside the lot as given.');
  }
  if (!boundary) {
    const b = bounds.w > 0 ? bounds : { x: 0, y: 0, w: 1200, h: 1000 };
    boundary = [[b.x - mg.w, b.y - mg.n], [b.x + b.w + mg.e, b.y - mg.n], [b.x + b.w + mg.e, b.y + b.h + mg.s], [b.x - mg.w, b.y + b.h + mg.s]];
  }
  boundary = boundary.map(([x, y]) => [r1(x), r1(y)]);
  const xs = boundary.map((p) => p[0]), ys = boundary.map((p) => p[1]);
  const site = {
    boundary,
    parking: [], paths: [], features: [],
    street: { side: ['n', 'e', 's', 'w'].includes(s.street) ? s.street : s.street && ['n', 'e', 's', 'w'].includes(s.street.side) ? s.street.side : 'e' },
    bounds: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
  };
  if (Array.isArray(s.buildingLine) && s.buildingLine.length >= 3) site.buildingLine = movePoly(s.buildingLine);
  if (s.setbacks && typeof s.setbacks === 'object') site.setbacks = clone(s.setbacks);
  for (const k of ['parking', 'paths', 'features']) if (Array.isArray(s[k])) site[k] = clone(s[k]);
  if (polygonArea(boundary) <= 0) say('warning', 'The lot has no area.');
  return site;
}

/** Name and type the derived rooms: a first guess (largest = living space, ≥ 6 m² bedroom, smaller service room). */
function nameRooms(rooms, say) {
  if (!rooms.length) return [];
  const area = (r) => polygonArea(r.polygon) / 1e4;
  const largest = rooms.reduce((a, r) => (area(r) > area(a) ? r : a), rooms[0]);
  const order = [...rooms].sort((a, b) => a.label[1] - b.label[1] || a.label[0] - b.label[0]);
  let n = 0;
  const named = new Map();
  for (const r of order) {
    if (r === largest) { named.set(r, { name: 'Living space', type: 'living' }); continue; }
    n++;
    named.set(r, area(r) >= 6 ? { name: `Room ${n}`, type: 'bedroom' } : { name: `Room ${n}`, type: 'service', wet: true });
  }
  if (rooms.length) say('info', `${rooms.length} ${rooms.length === 1 ? 'room was' : 'rooms were'} found. Their names and types are first guesses — check them in the Rooms tab.`);
  return rooms.map((r) => {
    const { name, type, wet } = named.get(r);
    const { nameHe, wet: _w, ...rest } = r;
    return { ...rest, name, type, ...(wet ? { wet: true } : {}) };
  });
}

function assumptionsFor(src, meta, heights) {
  const out = [];
  const given = (o, k) => o && typeof o === 'object' && o[k] != null;
  out.push({ id: 'ceiling', status: given(src.heights, 'ceiling') ? 'confirmed' : 'assumed', text: `Ceiling height ${(heights.ceiling / 100).toFixed(2)} m${given(src.heights, 'ceiling') ? '' : ' (assumed)'}.` });
  if (!given(src.meta, 'latitude') || !given(src.meta, 'longitude')) out.push({ id: 'location', status: 'assumed', text: `Location for the sun not given — ${DEFAULT_LOCATION.location} was used.` });
  if (!given(src.meta, 'northAngle')) out.push({ id: 'north', status: 'assumed', text: 'North is assumed to point straight up on the plan.' });
  if (!(src.site && (src.site.boundary || src.site.lot))) out.push({ id: 'lot', status: 'assumed', text: 'The lot is a rectangle with 3 m of garden around the house (no survey).' });
  out.push({ id: 'roof-build', status: 'assumed', text: `Flat roof: slab ${heights.slab} cm, parapet ${heights.parapet} cm; floor ${heights.floorAboveGround} cm above the garden.` });
  return out;
}
