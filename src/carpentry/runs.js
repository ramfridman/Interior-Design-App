/**
 * Run lifecycle (create / update / remove / duplicate), units (add / update / remove / move / width), layout and fit.
 * Every mutation returns { ok: true, ids, runIds, warnings: { en, he }[], changed } or { ok: false, reason: { en, he } }.
 * A refused call changes nothing; a successful one is ONE undo step and ONE 'carpentry' event.
 * Last optional argument everywhere: opts = { transient } (inside store.begin() … commit()).
 */
import { mutate, view, newId, clone } from './state.js';
import { MODULES } from './modules.js';
import { defaultSpec, deepMerge, RULES, VOCAB } from './spec.js';
import { wallSpanAt, spanOfRun, openingConflicts, toPlan, frame } from './walls.js';
import { layoutInDraft, unitsOf, positions, levelOf, geometryOf, isFloorLevel } from './layout.js';
import { computeWorktops } from './worktop.js';
import { spaceAt } from '../core/geometry.js';
import { validateCustomLayout, frontsToLayout } from './bespoke.js';
import { toLocal } from './walls.js';

const L = (en, he) => ({ en, he });
const FAIL = (en, he) => ({ ok: false, reason: L(en, he) });
const r1 = (v) => Math.round(v * 10) / 10;

/** Levels each run kind normally holds (stored on the run as `levels`). */
export const KIND_LEVELS = {
  kitchen: ['base', 'wall', 'tall'], island: ['island'], wardrobe: ['full'], pantry: ['tall', 'base', 'wall'], vanity: ['base', 'wall'],
  utility: ['base', 'wall', 'tall', 'full'], media: ['base', 'wall'], entry: ['full', 'base'], shelving: ['full', 'wall'], desk: ['base', 'wall'],
  custom: ['base', 'wall', 'tall', 'full'],
};
const KIND_CODE = { kitchen: 'K', island: 'KI', wardrobe: 'WR', pantry: 'PN', vanity: 'VN', utility: 'UT', media: 'MW', entry: 'EN', shelving: 'SH', desk: 'DK', custom: 'CU' };
const SIDE = { 0: L('north wall', 'קיר צפוני'), 90: L('east wall', 'קיר מזרחי'), 180: L('south wall', 'קיר דרומי'), 270: L('west wall', 'קיר מערבי') };

function nextCode(carpentry, kind) {
  const p = KIND_CODE[kind] || 'CU', used = new Set(Object.values(carpentry.runs).map((r) => r.code));
  for (let i = 1; ; i++) if (!used.has(p + i)) return p + i;
}

/** Other runs whose worktop butts into `run` (L corners). */
function buttsInto(carpentry, run) {
  const out = [];
  for (const r of Object.values(carpentry.runs)) for (const side of ['left', 'right']) {
    const e = r.ends && r.ends[side];
    if (e && e.type === 'run' && e.runId === run.id) out.push({ side: e.at || 'left', depth: r.spec.worktop.depth });
  }
  return out;
}
/** Lay out runs (and the runs linked to them) inside a draft. */
export function relayout(draft, runIds) {
  const all = new Set(runIds.filter((id) => draft.carpentry.runs[id]));
  for (const r of Object.values(draft.carpentry.runs)) for (const side of ['left', 'right']) {
    const e = r.ends && r.ends[side];
    if (e && e.type === 'run' && (all.has(e.runId) || all.has(r.id))) { all.add(r.id); if (draft.carpentry.runs[e.runId]) all.add(e.runId); }
  }
  computeReserves(draft, [...all]);
  for (const id of all) layoutInDraft(draft, id, (run, units) => computeWorktops(run, units, buttsInto(draft.carpentry, run)));
  return [...all];
}

/**
 * Corner footprints that reach into another arm: for every run end linked to another run ({ type: 'run' }) whose corner unit
 * (first / last floor unit at that end, module with `cornerLeg`) has a leg longer than the distance from its wall to this run's
 * end, reserve the difference at this end. Writes run.reserved = { left, right, by: { left|right: { cm, level, runId, unitId } } }.
 */
function computeReserves(draft, ids) {
  for (const id of ids) {
    const r = draft.carpentry.runs[id];
    if (!r) continue;
    const res = {};
    for (const side of ['left', 'right']) {
      const e = r.ends && r.ends[side], o = e && e.type === 'run' && draft.carpentry.runs[e.runId];
      if (!o) continue;
      const fl = (o.unitIds || []).map((x) => draft.peek(x)).filter((u) => u && u.carp && isFloorLevel(levelOf(u)));
      const cu = e.at === 'right' ? fl[fl.length - 1] : fl[0], m = cu && MODULES[cu.carp.module];
      if (!m || !m.cornerLeg) continue;
      const [ex, ey] = toPlan(r.anchor, side === 'left' ? 0 : r.length, 0), vEnd = toLocal(o.anchor, ex, ey)[1];
      const cm = r1(m.cornerLeg(cu.carp) - vEnd);
      if (cm > 0.05) res[side] = { cm, level: levelOf(cu), runId: o.id, unitId: cu.id };
    }
    if (res.left || res.right) r.reserved = { left: res.left ? res.left.cm : 0, right: res.right ? res.right.cm : 0, by: res };
    else delete r.reserved;
  }
}

/** Bespoke layout of a unit valid for its geometry? → null or a FAIL result. */
function layoutError(run, draft, unitId) {
  const u = draft.peek(unitId);
  if (!u || u.carp.module !== 'custom' || !u.carp.internals || !u.carp.internals.layout) return null;
  const g = geometryOf(run, u), errs = validateCustomLayout(u.carp.internals.layout, g.w, g.zone.y1 - g.zone.y0);
  return errs.length ? { ok: false, reason: errs[0], reasons: errs } : null;
}

/** A unit item (not yet laid out). */
function makeUnit(run, moduleId, o = {}) {
  const mod = MODULES[moduleId];
  const level = mod.level === 'any' ? (o.level || 'base') : mod.level;
  const width = o.width ?? (mod.appliance && mod.appliance.w && mod.w.min === mod.w.max ? mod.w.std : mod.w.std);
  const carp = {
    runId: run.id, module: moduleId, level, width: r1(width), at: 0,
    internals: deepMerge((mod.internals && mod.internals.default) || {}, o.internals || {}),
    fronts: clone(o.fronts || {}), spec: clone(o.spec || {}), handed: o.handed || 'L', note: o.note || '',
  };
  for (const k of ['appliance', 'hob', 'cutout', 'offset', 'elev', 'h', 'depth', 'cornerSide', 'blind', 'worktop', 'sink', 'basins', 'mirror', 'legB', 'noPlinth']) if (o[k] !== undefined) carp[k] = clone(o[k]);
  return { id: newId('cu'), type: 'cabinet', name: mod.name.en, params: {}, x: 0, y: 0, rot: run.anchor.dir, w: width, d: 60, h: 90, elev: 0,
    placement: 'floor', zone: 'indoor', price: null, priceUnit: 'item', url: null, retailer: null, brand: null, productId: null,
    locked: false, hidden: !!mod.virtual, fixture: true, generic: false, note: '', carp };
}
function widthError(mod, w) {
  if (!(w >= mod.w.min - 0.01 && w <= mod.w.max + 0.01)) return FAIL(`${mod.name.en}: width ${w} cm is outside ${mod.w.min}–${mod.w.max} cm.`, `${mod.name.he}: רוחב ${w} ס״מ מחוץ לטווח ${mod.w.min}–${mod.w.max} ס״מ.`);
  return null;
}
/** Conflicts of one unit (after layout) that refuse an edit: base / tall / full across a door, tall / full over a window. */
function hardConflicts(run, draft, unitIds) {
  const units = unitsOf(run, draft), pos = positions(run, units);
  const list = units.filter((u) => unitIds.includes(u.id)).map((u) => {
    const g = geometryOf(run, u);
    return { id: u.id, level: levelOf(u), at: pos.get(u.id).at, w: u.carp.width, elev: g.elev, h: g.h, virtual: !!g.mod.virtual };
  });
  return openingConflicts(run, list).filter((c) => c.code === 'door-crossing' || c.code === 'window-tall');
}
const conflictReason = (c) => (c.code === 'door-crossing'
  ? L(`A unit cannot cross the doorway ${c.opening.id}.`, `ארון אינו יכול לחסום את הפתח ${c.opening.id}.`)
  : L(`A tall unit cannot cover the window ${c.opening.id} (sill ${c.opening.sill} cm).`, `ארון גבוה אינו יכול לכסות את החלון ${c.opening.id} (אדן ${c.opening.sill} ס״מ).`));

// ───────────────────────── runs ─────────────────────────

/**
 * Create a run.
 *   Against a wall: { kind, x, y } = a point on / near the wall face (the free stretch around it, between doors — and
 *     windows for tall / full runs — is used), optionally { from, to } (cm along the stretch from its left end) or { length }.
 *   Explicit: { kind, anchor: { x, y, dir }, length }.
 *   Island / free-standing: { kind: 'island', x, y (centre), rot, length, depth }.
 *   Optional: name, nameHe, roomId, spec (deep-merged over the kind default), ends: { left, right } ('wall'|'open'|{type,runId,at}),
 *   levels, notes, units: [{ module, …addUnit options }].
 */
export function createRun(opts = {}, mopts) {
  const kind = VOCAB.runKind[opts.kind] ? opts.kind : 'custom';
  const levels = opts.levels || KIND_LEVELS[kind];
  const floorRun = levels.some(isFloorLevel);
  const freeStanding = kind === 'island' || !!opts.freeStanding;
  let anchor, length, roomId = opts.roomId ?? null, side = null;
  let ends = { left: { type: 'open' }, right: { type: 'open' } };
  const spec = deepMerge(defaultSpec(kind), opts.spec || {});
  if (opts.anchor) {
    anchor = { x: +opts.anchor.x, y: +opts.anchor.y, dir: ((+opts.anchor.dir || 0) % 360 + 360) % 360 };
    length = +opts.length;
    if (!(length > 0)) return FAIL('A run needs a length.', 'יש להגדיר אורך.');
  } else if (freeStanding) {
    length = +opts.length || 240;
    const depth = +opts.depth || spec.worktop.depth || 120, dir = ((+opts.rot || 0) % 360 + 360) % 360;
    if (kind === 'island') spec.worktop.depth = depth;
    const [x, y] = toPlan({ x: +opts.x, y: +opts.y, dir }, -length / 2, -depth / 2);
    anchor = { x: r1(x), y: r1(y), dir };
  } else {
    const span = wallSpanAt(+opts.x, +opts.y);
    if (!span) return FAIL('No wall face near this point.', 'לא נמצא קיר ליד הנקודה.');
    const tallOnly = !levels.includes('base') && levels.some((l) => l === 'tall' || l === 'full');
    const blocks = span.openings.filter((o) => (floorRun && o.kind !== 'window') || (tallOnly && o.kind === 'window'));
    let from, to;
    if (opts.from != null || opts.to != null) { from = +(opts.from ?? 0); to = +(opts.to ?? span.length); }
    else if (opts.length) { from = Math.max(0, Math.min(span.at, span.length - opts.length)); to = from + +opts.length; }
    else {
      from = Math.max(0, ...blocks.filter((o) => o.to <= span.at + 0.01).map((o) => o.to));
      to = Math.min(span.length, ...blocks.filter((o) => o.from >= span.at - 0.01).map((o) => o.from));
    }
    if (from < -0.5 || to > span.length + 0.5) return FAIL('The run is longer than the wall.', 'אורך הקו ארוך מהקיר.');
    if (to - from < 10) return FAIL('Not enough free wall here.', 'אין מספיק קיר פנוי כאן.');
    if (floorRun) {
      const door = span.openings.find((o) => o.kind !== 'window' && Math.min(to, o.to) - Math.max(from, o.from) > 0.5);
      if (door) return FAIL(`A base / tall run cannot cross the doorway ${door.id}.`, `קו ארונות תחתון / גבוה אינו יכול לחצות את הפתח ${door.id}.`);
    }
    const [ax, ay] = toPlan(span.anchor, from, 0);
    anchor = { x: r1(ax), y: r1(ay), dir: span.anchor.dir };
    length = r1(to - from);
    ends = { left: { type: from < 0.5 ? span.ends.left : 'open' }, right: { type: to > span.length - 0.5 ? span.ends.right : 'open' } };
    roomId = roomId ?? span.roomId;
    side = SIDE[span.anchor.dir];
  }
  if (opts.ends) for (const s of ['left', 'right']) if (opts.ends[s]) ends[s] = typeof opts.ends[s] === 'string' ? { type: opts.ends[s] } : clone(opts.ends[s]);
  if (!roomId) {
    const [cx, cy] = toPlan(anchor, length / 2, 20), sp = spaceAt(cx, cy);
    roomId = sp ? sp.id : null;
  }
  for (const u of opts.units || []) {
    const mod = MODULES[u.module];
    if (!mod) return FAIL(`Unknown module "${u.module}".`, `מודול לא מוכר "${u.module}".`);
    const err = u.width != null && widthError(mod, u.width);
    if (err) return err;
  }
  return mutate('create-run', (d) => {
    const id = newId('run'), kindL = VOCAB.runKind[kind];
    const run = {
      id, code: nextCode(d.carpentry, kind), kind,
      name: opts.name || (side ? `${kindL.en} — ${side.en}` : kindL.en), nameHe: opts.nameHe || (side ? `${kindL.he} — ${side.he}` : kindL.he),
      roomId, anchor, length, levels: [...levels], freeStanding, spec, unitIds: [], worktops: [], ends, notes: opts.notes || '', source: opts.source || 'user',
    };
    d.carpentry.runs[id] = run;
    for (const u of opts.units || []) { const it = makeUnit(run, u.module, u); d.add(it); run.unitIds.push(it.id); }
    const runIds = relayout(d, [id]);
    const bad = run.unitIds.length ? hardConflicts(run, d, run.unitIds) : [];
    if (bad.length) return { ok: false, reason: conflictReason(bad[0]) };
    return { runId: id, ids: [id, ...run.unitIds], runIds };
  }, mopts);
}

/** Patch a run: { name, nameHe, notes, roomId, spec (deep-merged), length, anchor, ends, levels, kind }. Re-lays it out. */
export function updateRun(runId, patch = {}, mopts) {
  if (!view().run(runId)) return FAIL('No such run.', 'קו ארונות לא קיים.');
  return mutate('update-run', (d) => {
    const run = d.carpentry.runs[runId];
    for (const k of ['name', 'nameHe', 'notes', 'roomId']) if (patch[k] !== undefined) run[k] = patch[k];
    if (patch.kind && VOCAB.runKind[patch.kind]) run.kind = patch.kind;
    if (patch.levels) run.levels = [...patch.levels];
    if (patch.spec) run.spec = deepMerge(run.spec, patch.spec);
    if (patch.length != null) { if (!(+patch.length > 0)) return FAIL('Length must be positive.', 'האורך חייב להיות חיובי.'); run.length = r1(+patch.length); }
    if (patch.anchor) run.anchor = { ...run.anchor, ...patch.anchor };
    if (patch.ends) for (const s of ['left', 'right']) if (patch.ends[s]) run.ends[s] = typeof patch.ends[s] === 'string' ? { type: patch.ends[s] } : clone(patch.ends[s]);
    return { runIds: relayout(d, [runId]), ids: [runId] };
  }, mopts);
}

/** Remove a run and its units (links from other runs become open ends). */
export function removeRun(runId, mopts) {
  if (!view().run(runId)) return FAIL('No such run.', 'קו ארונות לא קיים.');
  return mutate('remove-run', (d) => {
    const run = d.carpentry.runs[runId];
    for (const id of run.unitIds) d.remove(id);
    delete d.carpentry.runs[runId];
    const touched = [];
    for (const r of Object.values(d.carpentry.runs)) for (const s of ['left', 'right']) if (r.ends[s] && r.ends[s].runId === runId) { r.ends[s] = { type: 'open' }; touched.push(r.id); }
    return { runIds: [runId, ...relayout(d, touched)], ids: [runId] };
  }, mopts);
}

/** Copy a run with new ids. opts: { anchor } | { x, y } (a wall point, as createRun) | default 100 cm in front of the original. */
export function duplicateRun(runId, opts = {}, mopts) {
  const src = view().run(runId);
  if (!src) return FAIL('No such run.', 'קו ארונות לא קיים.');
  let anchor;
  if (opts.anchor) anchor = { ...src.anchor, ...opts.anchor };
  else if (opts.x != null) { const s = wallSpanAt(opts.x, opts.y); if (!s) return FAIL('No wall face near this point.', 'לא נמצא קיר ליד הנקודה.'); const [x, y] = toPlan(s.anchor, Math.min(s.at, Math.max(0, s.length - src.length)), 0); anchor = { x, y, dir: s.anchor.dir }; }
  else { const f = frame(src.anchor.dir); anchor = { ...src.anchor, x: src.anchor.x + f.nx * 100, y: src.anchor.y + f.ny * 100 }; }
  return mutate('duplicate-run', (d) => {
    const id = newId('run'), run = { ...clone(src), id, code: nextCode(d.carpentry, src.kind), anchor, unitIds: [], ends: { left: { type: 'open' }, right: { type: 'open' } }, name: src.name + ' (copy)', nameHe: (src.nameHe || '') + ' (העתק)', source: 'user' };
    d.carpentry.runs[id] = run;
    for (const uid of src.unitIds) { const u = d.peek(uid); if (!u) continue; const c = clone(u); c.id = newId('cu'); c.carp.runId = id; d.add(c); run.unitIds.push(c.id); }
    return { runId: id, ids: [id, ...run.unitIds], runIds: relayout(d, [id]) };
  }, mopts);
}

/** Re-apply the layout (no change → { ok: true, changed: false }). */
export function layoutRun(runId, mopts) {
  if (!view().run(runId)) return FAIL('No such run.', 'קו ארונות לא קיים.');
  return mutate('layout', (d) => ({ runIds: relayout(d, [runId]) }), mopts);
}

// ───────────────────────── units ─────────────────────────

/** Row of a unit for ordering: 'floor' | 'wall'. */
const rowOf = (u) => (isFloorLevel(levelOf(u)) ? 'floor' : 'wall');
function orderRows(run, draft) {
  const units = unitsOf(run, draft);
  run.unitIds = [...units.filter((u) => rowOf(u) === 'floor'), ...units.filter((u) => rowOf(u) === 'wall')].map((u) => u.id);
}

/**
 * Add a unit. o = { index (position in its row, default: end) | at (cm along the run: inserted before the unit there),
 * width, level (fillers / panels), internals, fronts, spec, handed, appliance, hob, cutout, offset, elev, h, depth, note }.
 * Refused: width outside the module's min / max, or the new unit would block a door / cover a window (tall / full).
 */
export function addUnit(runId, moduleId, o = {}, mopts) {
  const run0 = view().run(runId), mod = MODULES[moduleId];
  if (!run0) return FAIL('No such run.', 'קו ארונות לא קיים.');
  if (!mod) return FAIL(`Unknown module "${moduleId}".`, `מודול לא מוכר "${moduleId}".`);
  const err = o.width != null && widthError(mod, o.width);
  if (err) return err;
  return mutate('add-unit', (d) => {
    const run = d.carpentry.runs[runId];
    orderRows(run, d);
    const it = makeUnit(run, moduleId, o);
    d.add(it);
    const row = rowOf(it), units = unitsOf(run, d), pos = positions(run, units);
    const rowIds = units.filter((u) => rowOf(u) === row).map((u) => u.id);
    let idx = rowIds.length;
    if (o.index != null) idx = Math.max(0, Math.min(rowIds.length, o.index | 0));
    else if (o.at != null) { const k = rowIds.findIndex((id) => pos.get(id).at + d.peek(id).carp.width / 2 > o.at); idx = k < 0 ? rowIds.length : k; }
    rowIds.splice(idx, 0, it.id);
    const other = units.filter((u) => rowOf(u) !== row).map((u) => u.id);
    run.unitIds = row === 'floor' ? [...rowIds, ...other] : [...other, ...rowIds];
    const runIds = relayout(d, [runId]);
    const bad = hardConflicts(run, d, [it.id]);
    if (bad.length) return { ok: false, reason: conflictReason(bad[0]) };
    const le = layoutError(run, d, it.id);
    if (le) return le;
    return { ids: [it.id], unitId: it.id, runIds };
  }, mopts);
}

function runOfUnit(unitId) {
  const v = view(), u = v.item(unitId);
  return u && u.carp ? v.run(u.carp.runId) : null;
}

/** Patch a unit's carp: { module, width, level, internals (merged), fronts (merged), spec (deep-merged), handed, appliance, hob, cutout, offset, elev, h, depth, note, worktop, cornerSide, blind }. */
export function updateUnit(unitId, patch = {}, mopts) {
  const run0 = runOfUnit(unitId);
  if (!run0) return FAIL('No such unit.', 'יחידה לא קיימת.');
  const cur = view().item(unitId).carp;
  const mod = MODULES[patch.module || cur.module];
  if (!mod) return FAIL(`Unknown module "${patch.module}".`, `מודול לא מוכר "${patch.module}".`);
  const w = patch.width != null ? +patch.width : patch.module ? Math.min(mod.w.max, Math.max(mod.w.min, cur.width)) : cur.width;
  const err = widthError(mod, w);
  if (err) return err;
  return mutate('update-unit', (d) => {
    const it = d.item(unitId), c = it.carp, run = d.carpentry.runs[c.runId];
    if (patch.module && patch.module !== c.module) { c.module = patch.module; c.internals = clone((mod.internals && mod.internals.default) || {}); c.fronts = {}; it.hidden = !!mod.virtual; if (mod.level !== 'any') c.level = mod.level; }
    c.width = r1(w);
    if (patch.internals) c.internals = deepMerge(c.internals || {}, patch.internals);
    if (patch.fronts) c.fronts = { ...(c.fronts || {}), ...patch.fronts };
    if (patch.spec) c.spec = deepMerge(c.spec || {}, patch.spec);
    for (const k of ['level', 'handed', 'appliance', 'hob', 'cutout', 'offset', 'elev', 'h', 'depth', 'note', 'worktop', 'cornerSide', 'blind', 'sink', 'basins', 'mirror', 'legB', 'noPlinth']) {
      if (patch[k] === null) delete c[k]; else if (patch[k] !== undefined) c[k] = clone(patch[k]);
    }
    orderRows(run, d);
    const runIds = relayout(d, [run.id]);
    const bad = hardConflicts(run, d, [unitId]);
    if (bad.length) return { ok: false, reason: conflictReason(bad[0]) };
    const le = layoutError(run, d, unitId);
    if (le) return le;
    return { ids: [unitId], runIds };
  }, mopts);
}

/**
 * Convert any unit into a bespoke unit (`custom` with carp.internals.layout) that keeps its look: same level, size, height,
 * elevation, depth, worktop and fronts. Door operation and features are kept. The owner can then change anything.
 */
export function toCustom(unitId, mopts) {
  const run0 = runOfUnit(unitId);
  if (!run0) return FAIL('No such unit.', 'יחידה לא קיימת.');
  return mutate('update-unit', (d) => {
    const run = d.carpentry.runs[run0.id], it = d.item(unitId), c = it.carp, g = geometryOf(run, it), m = MODULES[c.module];
    if (c.module === 'custom' && c.internals && c.internals.layout) return { ids: [unitId], runIds: [] };
    const layout = frontsToLayout(g);
    const op = c.fronts && c.fronts.operation;
    c.module = 'custom'; c.level = g.level; c.h = g.h; c.elev = g.elev; c.depth = g.dc;
    if (m.worktop && (g.level === 'base' || g.level === 'island') && run.spec.worktop.material !== 'none' && c.worktop !== false) c.worktop = true;
    if (g.level !== 'wall' && g.carcassY[0] === g.elev) c.noPlinth = true;
    c.internals = { layout }; c.fronts = op ? { operation: op } : {}; c.convertedFrom = m.id;
    it.hidden = false;
    const runIds = relayout(d, [run.id]), le = layoutError(run, d, unitId);
    if (le) return le;
    return { ids: [unitId], runIds };
  }, mopts);
}
/** Set a unit's width (refused outside the module's min / max). */
export function setUnitWidth(unitId, width, mopts) { return updateUnit(unitId, { width }, mopts); }

/** Remove a unit; the units after it close up. */
export function removeUnit(unitId, mopts) {
  const run0 = runOfUnit(unitId);
  if (!run0) return FAIL('No such unit.', 'יחידה לא קיימת.');
  return mutate('remove-unit', (d) => {
    const run = d.carpentry.runs[run0.id];
    run.unitIds = run.unitIds.filter((id) => id !== unitId);
    d.remove(unitId);
    return { ids: [unitId], runIds: relayout(d, [run.id]) };
  }, mopts);
}

/** Move a unit to position `index` within its row (0 = left end). */
export function moveUnit(unitId, index, mopts) {
  const run0 = runOfUnit(unitId);
  if (!run0) return FAIL('No such unit.', 'יחידה לא קיימת.');
  return mutate('move-unit', (d) => {
    const run = d.carpentry.runs[run0.id];
    orderRows(run, d);
    const u = d.peek(unitId), row = rowOf(u), units = unitsOf(run, d);
    const rowIds = units.filter((x) => rowOf(x) === row && x.id !== unitId).map((x) => x.id);
    rowIds.splice(Math.max(0, Math.min(rowIds.length, index | 0)), 0, unitId);
    const other = units.filter((x) => rowOf(x) !== row).map((x) => x.id);
    run.unitIds = row === 'floor' ? [...rowIds, ...other] : [...other, ...rowIds];
    const runIds = relayout(d, [run.id]);
    const bad = hardConflicts(run, d, run.unitIds);
    if (bad.length) return { ok: false, reason: conflictReason(bad[0]) };
    return { ids: [unitId], runIds };
  }, mopts);
}

// ───────────────────────── fit ─────────────────────────

const isAdjustable = (u) => { const m = MODULES[u.carp.module]; return m && !m.appliance && m.id !== 'filler' && m.id !== 'panel' && m.w.max > m.w.min; };
const handleless = (spec) => ['none', 'push'].includes(spec.handles.type) || ['j-profile', 'gola'].includes(spec.fronts.style);

/** Spread `amount` (cm, + grows) over units within their min / max; whole cm where possible. Returns the remainder. */
function spread(units, amount, minOf, maxOf) {
  let rest = amount;
  for (let guard = 0; guard < 20 && Math.abs(rest) > 0.001; guard++) {
    const open = units.filter((u) => (rest > 0 ? u.carp.width < maxOf(u) - 0.001 : u.carp.width > minOf(u) + 0.001));
    if (!open.length) break;
    const share = rest / open.length;
    for (const u of open) {
      const nw = Math.max(minOf(u), Math.min(maxOf(u), u.carp.width + share));
      rest -= nw - u.carp.width; u.carp.width = nw;
    }
  }
  // whole centimetres: round all but the last open unit, which takes the rounding
  let carry = 0;
  units.forEach((u, i) => {
    if (i === units.length - 1) { u.carp.width = r1(u.carp.width + carry); return; }
    const w = Math.round(u.carp.width);
    if (w >= minOf(u) && w <= maxOf(u)) { carry += u.carp.width - w; u.carp.width = w; }
  });
  return rest;
}

/**
 * Fit a run exactly to its length (or opts.length, or — with opts.toSpan — the free wall between the nearest walls /
 * blocking doors). mode:
 *   'fillers' (default) — a filler of the recommended width (5 cm, 3 cm handle-less) at every end against a wall or another run;
 *                         adjustable units absorb the rest; the fillers take what limits leave (2–15 cm);
 *   'stretch'           — no new fillers; adjustable units absorb the difference, then existing fillers;
 *   'units'             — only opts.unitIds absorb the difference, then fillers.
 * Appliance modules, panels and fixed-width modules never change; no unit leaves its min / max. Refused if impossible.
 */
export function fitRun(runId, opts = {}, mopts) {
  const run0 = view().run(runId);
  if (!run0) return FAIL('No such run.', 'קו ארונות לא קיים.');
  const mode = opts.mode || 'fillers';
  return mutate('fit', (d) => {
    const run = d.carpentry.runs[runId];
    if (opts.toSpan) {
      const span = spanOfRun(run);
      if (!span) return FAIL('This run is not on a wall.', 'קו הארונות אינו צמוד לקיר.');
      const floorRun = run.levels.some(isFloorLevel), mid = (span.runFrom + span.runTo) / 2;
      const blocks = span.openings.filter((o) => floorRun && o.kind !== 'window');
      const from = Math.max(0, ...blocks.filter((o) => o.to <= mid).map((o) => o.to)), to = Math.min(span.length, ...blocks.filter((o) => o.from >= mid).map((o) => o.from));
      const [ax, ay] = toPlan(span.anchor, from, 0);
      run.anchor = { x: r1(ax), y: r1(ay), dir: run.anchor.dir }; run.length = r1(to - from);
      if (from < 0.5) run.ends.left = { type: span.ends.left }; if (to > span.length - 0.5) run.ends.right = { type: span.ends.right };
    }
    const reservedCm = (run.reserved ? run.reserved.left + run.reserved.right : 0);
    if (opts.length != null) run.length = r1(+opts.length);
    orderRows(run, d);
    let units = unitsOf(run, d);
    const floorUnits = units.filter((u) => rowOf(u) === 'floor');
    const row = floorUnits.length ? 'floor' : 'wall';
    const rowUnits = () => unitsOf(run, d).filter((u) => rowOf(u) === row);
    if (!rowUnits().length) return FAIL('The run has no units to fit.', 'אין ארונות בקו.');
    const needsFillers = !['shelving', 'desk', 'media', 'vanity', 'island'].includes(run.kind);
    if (mode === 'fillers' && needsFillers) {
      for (const side of ['left', 'right']) {
        const e = run.ends[side], t = e && e.type;
        if (t !== 'wall' && t !== 'run') continue;
        const ru = rowUnits(), end = side === 'left' ? ru[0] : ru[ru.length - 1];
        const m = MODULES[end.carp.module];
        if (m.id === 'filler' || m.id === 'panel' || m.virtual || m.corner) continue;
        if (m.id === 'tall-fridge-niche') continue;
        const fw = handleless(run.spec) ? RULES.fillerAtWallHandleless : RULES.fillerAtWall;
        const it = makeUnit(run, 'filler', { width: fw, level: levelOf(end) });
        d.add(it);
        const ids = ru.map((u) => u.id);
        if (side === 'left') ids.unshift(it.id); else ids.push(it.id);
        const other = unitsOf(run, d).filter((u) => rowOf(u) !== row && u.id !== it.id).map((u) => u.id);
        run.unitIds = row === 'floor' ? [...ids, ...other] : [...other, ...ids];
      }
    }
    const ru = rowUnits().map((u) => d.item(u.id));
    const target = run.length - (row === 'floor' ? reservedCm : 0);
    const sum = () => ru.reduce((s, u) => s + u.carp.width, 0);
    const minOf = (u) => MODULES[u.carp.module].w.min, maxOf = (u) => MODULES[u.carp.module].w.max;
    const fillers = ru.filter((u) => u.carp.module === 'filler');
    const adj = mode === 'units' ? ru.filter((u) => (opts.unitIds || []).includes(u.id) && isAdjustable(u)) : ru.filter(isAdjustable);
    let rest = target - sum();
    if (Math.abs(rest) > 0.001) rest = spread(adj, rest, minOf, maxOf);
    rest = target - sum();
    if (Math.abs(rest) > 0.001 && fillers.length) rest = spread(fillers, rest, minOf, maxOf);
    rest = r1(target - sum());
    if (Math.abs(rest) > 0.05) {
      return FAIL(`Cannot fit: ${Math.abs(rest)} cm ${rest > 0 ? 'left over' : 'too much'} within the module limits — ${rest > 0 ? 'add' : 'remove'} a unit.`,
        `לא ניתן להתאים: ${Math.abs(rest)} ס״מ ${rest > 0 ? 'עודפים' : 'חסרים'} במסגרת מגבלות המודולים — יש ${rest > 0 ? 'להוסיף' : 'להסיר'} ארון.`);
    }
    for (const u of ru) u.carp.width = r1(u.carp.width);
    return { runIds: relayout(d, [runId]), ids: ru.map((u) => u.id) };
  }, mopts);
}
