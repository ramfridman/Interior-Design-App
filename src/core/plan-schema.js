/**
 * PLAN SCHEMA — the optional plan keys of schema 2 (angled walls and several levels, docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md
 * § 2) and their structural checks. Pure (no imports): used by the plan engine, project storage and the collaboration
 * room (which also runs inside the Cloudflare Durable Object).
 *
 *   schema   2 — written only while at least one of slants / stairs / levels is non-empty; absent = schema 1
 *   slants   [{ id, x1, y1, x2, y2, t, kind: 'interior' | 'exterior' | 'mamad', cls?, poly?: [[x, y]…] }]
 *   stairs   [{ id, x, y, rot?, to?, shape?: 'straight' | 'L' | 'U', width?, risers?, going?, … }]
 *   levels   [{ id: 'L1'…, elevation, heights: {…}, walls, openings, rooms?, wallOutline?, slants?, stairs?, voids?,
 *              outdoorAreas?, name?, nameHe? }]   — upper levels, bottom-up; the ground level (L0) is the top-level plan
 *
 * Nothing here derives anything: the checks are structural only (arrays of objects with the documented fields).
 */

/** Keys a plan carries only when needed (absent on every schema-1 plan, House 98 included). */
export const OPTIONAL_KEYS = Object.freeze(['schema', 'slants', 'stairs', 'levels']);
/** The optional keys that hold data (an empty list is the same as no key). */
const DATA_KEYS = ['slants', 'stairs', 'levels'];

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 120;
const isPoint = (p) => Array.isArray(p) && p.length >= 2 && num(p[0]) && num(p[1]);
const isPolygon = (p) => Array.isArray(p) && p.length >= 3 && p.every(isPoint);
const SLANT_KINDS = ['interior', 'exterior', 'mamad'];
const STAIR_SHAPES = ['straight', 'L', 'U'];

/** First duplicate id in a list of objects, or ''. */
function duplicateId(list) {
  const seen = new Set();
  for (const o of list) { if (seen.has(o.id)) return o.id; seen.add(o.id); }
  return '';
}

function slantProblem(s, where) {
  if (!isObj(s) || !isId(s.id)) return `${where}: a slant needs an id`;
  if (!['x1', 'y1', 'x2', 'y2', 't'].every((k) => num(s[k]))) return `${where}: slant ${s.id} needs x1, y1, x2, y2 and t (cm)`;
  if (s.t <= 0 || (s.x1 === s.x2 && s.y1 === s.y2)) return `${where}: slant ${s.id} has no length or no thickness`;
  if (!SLANT_KINDS.includes(s.kind)) return `${where}: slant ${s.id} has an unknown kind`;
  if (s.poly !== undefined && !isPolygon(s.poly)) return `${where}: slant ${s.id} has an unreadable outline`;
  return '';
}

function stairProblem(s, where) {
  if (!isObj(s) || !isId(s.id)) return `${where}: a stair needs an id`;
  if (!num(s.x) || !num(s.y)) return `${where}: stair ${s.id} needs a position (x, y)`;
  for (const k of ['rot', 'width', 'risers', 'going']) if (s[k] !== undefined && !num(s[k])) return `${where}: stair ${s.id}.${k} must be a number`;
  if (s.to !== undefined && !isId(s.to)) return `${where}: stair ${s.id}.to must be a level id`;
  if (s.shape !== undefined && !STAIR_SHAPES.includes(s.shape)) return `${where}: stair ${s.id} has an unknown shape`;
  return '';
}

/** Problem with a list of slants / stairs (absent is fine), or ''. */
function listProblem(list, check, where) {
  if (list === undefined) return '';
  if (!Array.isArray(list)) return `${where} must be a list`;
  for (const o of list) { const r = check(o, where); if (r) return r; }
  const dup = duplicateId(list);
  return dup ? `${where}: the id ${dup} is used twice` : '';
}

const validRect = (r) => isObj(r) && num(r.x) && num(r.y) && num(r.w) && num(r.h) && r.w > 0 && r.h > 0;
const validOpening = (o) => isObj(o) && isId(o.id) && typeof o.kind === 'string'
  && (o.axis === 'a' ? isId(o.wall) && num(o.at) : validRect(o));
const validRoom = (r) => isObj(r) && isId(r.id) && isPolygon(r.polygon);

function levelProblem(l, i) {
  const where = `levels[${i}]`;
  if (!isObj(l) || !isId(l.id) || !/^L[1-9][0-9]*$/.test(l.id)) return `${where} needs an id L1, L2…`;
  const at = `level ${l.id}`;
  if (!num(l.elevation) || l.elevation <= 0) return `${at} needs an elevation above the ground level (cm)`;
  if (!isObj(l.heights) || !Object.values(l.heights).every(num)) return `${at} needs its heights (cm)`;
  if (!Array.isArray(l.walls) || !l.walls.every(validRect)) return `${at}: walls must be a list of rectangles`;
  if (!Array.isArray(l.openings) || !l.openings.every(validOpening)) return `${at}: openings must be a list of openings`;
  if (l.rooms !== undefined && !(Array.isArray(l.rooms) && l.rooms.every(validRoom))) return `${at}: rooms must be a list of rooms`;
  for (const k of ['wallOutline', 'outdoorAreas']) if (l[k] !== undefined && !Array.isArray(l[k])) return `${at}: ${k} must be a list`;
  if (l.voids !== undefined && !(Array.isArray(l.voids) && l.voids.every((v) => isObj(v) && isId(v.id) && isPolygon(v.polygon)))) return `${at}: voids must be a list of outlines`;
  return listProblem(l.slants, slantProblem, `${at} slants`) || listProblem(l.stairs, stairProblem, `${at} stairs`);
}

/**
 * Structural problem with the optional schema-2 keys of a plan (or of saved plan edits), or '' when they are absent or
 * readable. Plain English, for logs and refusals.
 */
export function optionalKeysProblem(p) {
  if (!isObj(p)) return '';
  if (p.schema !== undefined && p.schema !== 1 && p.schema !== 2) return 'unknown plan schema';
  const r = listProblem(p.slants, slantProblem, 'slants') || listProblem(p.stairs, stairProblem, 'stairs');
  if (r) return r;
  if (p.levels === undefined) return '';
  if (!Array.isArray(p.levels)) return 'levels must be a list';
  for (let i = 0; i < p.levels.length; i++) { const lr = levelProblem(p.levels[i], i); if (lr) return lr; }
  const dup = duplicateId(p.levels);
  return dup ? `levels: the id ${dup} is used twice` : '';
}

/** True when a plan (or plan state) carries any schema-2 data. */
export function hasOptionalData(p) { return !!p && DATA_KEYS.some((k) => Array.isArray(p[k]) && p[k].length > 0); }

/** The optional keys present on `p`, as a new object in OPTIONAL_KEYS order (values not copied). */
export function optionalPart(p) {
  const out = {};
  if (isObj(p)) for (const k of OPTIONAL_KEYS) if (p[k] !== undefined) out[k] = p[k];
  return out;
}

/**
 * Put the optional keys of `opt` on `target` (in place), replacing the ones it had: they always come last, in
 * OPTIONAL_KEYS order, so the JSON of a plan does not depend on the order they were added in. Returns `target`.
 */
export function setOptionalKeys(target, opt) {
  for (const k of OPTIONAL_KEYS) delete target[k];
  for (const k of OPTIONAL_KEYS) if (opt && opt[k] !== undefined) target[k] = opt[k];
  return target;
}

/**
 * Lazy schema (in place): empty slants / stairs / levels are removed, `schema: 2` is written while any of them holds
 * data and removed when none does — so a plan that returns to orthogonal and one level is byte-identical to schema 1.
 * The optional keys are moved last (see setOptionalKeys). A schema-1 plan is not touched at all. Returns `p`.
 */
export function normalizeOptionalKeys(p) {
  if (!isObj(p) || !OPTIONAL_KEYS.some((k) => k in p)) return p;
  const opt = optionalPart(p);
  for (const k of DATA_KEYS) if (k in opt && !(Array.isArray(opt[k]) && opt[k].length)) delete opt[k];
  if (hasOptionalData(opt)) opt.schema = 2; else delete opt.schema;
  return setOptionalKeys(p, optionalPart(opt));
}
