/**
 * LIVE COLLABORATION — the synchronised data model and its operations (pure: no store, no DOM, no plan engine; runs in
 * the browser, under Node and inside a Cloudflare Durable Object). See docs/CONTRACT.md § 13.
 *
 *   Doc   = { e: { [key]: Entity }, v: { [key]: [seq, cid] } }
 *   key   = 'item:<id>' | 'finish:<spaceId>' | 'project' | 'plan' | 'run:<id>' | 'carp' | 'cimg:<id>' | 'underlay'
 *           | 'cprod:<id>' (an own product, CONTRACT § 16)
 *   Op    = { k, p: Entity } (put) | { k, s: { field: value }, u: [field] } (set / unset fields) | { k, d: 1 } (delete)
 *   Group = { gid, base, ops, label? } — one user action
 *
 * The room applies groups with `applyGroup()` (ordering + conflict rules) and sends everyone the *effective* ops, which
 * clients apply verbatim with `applyOps()`.
 */

import { optionalKeysProblem } from '../core/plan-schema.js';   // pure (no plan engine)

export const PROTOCOL = 1;
export const LIMITS = Object.freeze({
  groupBytes: 1024 * 1024,      // one op group (and one entity)
  docBytes: 32 * 1024 * 1024,   // the whole project
  txBytes: 16 * 1024,           // one transient / presence message
  underlayBytes: 4 * 1024 * 1024,
  opsPerGroup: 5000,
});

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const BAD_FIELD = new Set(['__proto__', 'constructor', 'prototype']);

// ---------------------------------------------------------------- keys
export const KEY_RE = /^(item|finish|run|cimg|cprod):[A-Za-z0-9_.:\-]{1,120}$|^(project|plan|carp|underlay)$/;
export const keyType = (k) => { const i = k.indexOf(':'); return i < 0 ? k : k.slice(0, i); };
export const keyId = (k) => { const i = k.indexOf(':'); return i < 0 ? '' : k.slice(i + 1); };

/** Order of application inside one batch of changes (plan first: finishes / rooms depend on it; own products before the items placed from them). */
export const TYPE_ORDER = ['plan', 'project', 'run', 'carp', 'cimg', 'cprod', 'item', 'finish', 'underlay'];

// ---------------------------------------------------------------- doc ⇄ project record
/** An empty doc. */
export const emptyDoc = () => ({ e: {}, v: {} });

/**
 * Build a doc from a project record (§ 10 shape: { basePlan, phase, design, underlay? }). Pure.
 * Item order becomes `@z` = index.
 */
export function recordToDoc(rec) {
  const doc = emptyDoc(), d = rec && rec.design && Array.isArray(rec.design.items) ? rec.design : { items: [] };
  const e = doc.e;
  e.project = clone({ ...(d.project || {}), ...(rec && rec.name && !(d.project && d.project.name) ? { name: rec.name } : {}) });
  e.plan = { phase: rec && rec.phase === 'draft' ? 'draft' : 'fixed', base: clone(rec && rec.basePlan) || null, edits: clone(d.planEdits) || null };
  const used = new Set();
  d.items.forEach((it, i) => {
    if (!it || typeof it !== 'object') return;
    let id = typeof it.id === 'string' && /^[A-Za-z0-9_.:\-]{1,120}$/.test(it.id) ? it.id : `it_r${i.toString(36)}`;   // files may hold items without ids
    while (used.has(id)) id += '_';
    used.add(id);
    e['item:' + id] = { ...clone(it), id, '@z': i };
  });
  for (const [id, f] of Object.entries(d.finishes || {})) if (isObj(f)) e['finish:' + id] = clone(f);
  const carp = d.carpentry && isObj(d.carpentry.runs) ? d.carpentry : { runs: {}, settings: {} };
  for (const [id, r] of Object.entries(carp.runs)) if (isObj(r)) e['run:' + id] = clone(r);
  e.carp = clone(isObj(carp.settings) ? carp.settings : {});
  for (const [id, url] of Object.entries(d.carpentryImages || {})) if (typeof url === 'string') e['cimg:' + id] = { url };
  for (const p of Array.isArray(d.customProducts) ? d.customProducts : []) if (isObj(p) && typeof p.id === 'string' && /^own-[A-Za-z0-9_.\-]{1,116}$/.test(p.id)) e['cprod:' + p.id] = clone(p);
  if (rec && rec.underlay) { const { image, ...meta } = rec.underlay; e.underlay = { ...clone(meta), img: rec.underlayAsset || (image ? 'inline' : null) }; }
  for (const k of Object.keys(e)) doc.v[k] = [0, ''];
  return doc;
}

/** Item ids in drawing order (`@z`, ties by id). */
export function orderedItemKeys(e) {
  return Object.keys(e).filter((k) => k.startsWith('item:'))
    .sort((a, b) => (e[a]['@z'] - e[b]['@z']) || (a < b ? -1 : a > b ? 1 : 0));
}

/** The project record parts held by a doc: { name, phase, basePlan, design, underlay (meta, no picture) }. Pure. */
export function docToRecord(doc) {
  const e = doc.e, plan = e.plan || {};
  const items = orderedItemKeys(e).map((k) => { const { '@z': z, ...it } = e[k]; return clone(it); });
  const finishes = {}, runs = {}, images = {}, prods = [];
  for (const k of Object.keys(e)) {
    const t = keyType(k);
    if (t === 'finish') finishes[keyId(k)] = clone(e[k]);
    else if (t === 'run') runs[keyId(k)] = clone(e[k]);
    else if (t === 'cimg') images[keyId(k)] = e[k].url;
    else if (t === 'cprod') prods.push(clone(e[k]));
  }
  const design = { app: 'e7-interior-design', version: 1, project: clone(e.project || {}), items, finishes, planEdits: clone(plan.edits) || null, carpentry: { runs, settings: clone(e.carp || {}) }, carpentryImages: images };
  // own products: only when there is one (docs without them give the same record as before); canonical order
  if (prods.length) design.customProducts = prods.sort((a, b) => (String(a.createdAt || '') < String(b.createdAt || '') ? -1 : String(a.createdAt || '') > String(b.createdAt || '') ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { name: (e.project && e.project.name) || 'Project', phase: plan.phase === 'draft' ? 'draft' : 'fixed', basePlan: clone(plan.base), design, underlay: e.underlay ? clone(e.underlay) : null };
}

// ---------------------------------------------------------------- diff / apply
/** The op that turns entity `a` into `b` (either may be undefined), or null when they are equal. */
export function diffEntity(k, a, b) {
  if (a === undefined && b === undefined) return null;
  if (b === undefined) return { k, d: 1 };
  if (a === undefined) return { k, p: clone(b) };
  const s = {}, u = [];
  for (const f of Object.keys(b)) if (b[f] !== undefined && !same(a[f], b[f])) s[f] = clone(b[f]);
  for (const f of Object.keys(a)) if (a[f] !== undefined && b[f] === undefined) u.push(f);
  if (!Object.keys(s).length && !u.length) return null;
  const op = { k };
  if (Object.keys(s).length) op.s = s;
  if (u.length) op.u = u;
  return op;
}

/** Apply one op to an entity value (pure): returns the new value (undefined = deleted). */
export function applyOpTo(value, op) {
  if (op.d) return undefined;
  if (op.p) return clone(op.p);
  if (value === undefined) return undefined;          // set on a missing entity: deletes win
  const next = { ...value };
  if (op.s) for (const [f, v] of Object.entries(op.s)) next[f] = clone(v);
  if (op.u) for (const f of op.u) delete next[f];
  return next;
}

/**
 * Apply effective ops verbatim (clients). Mutates `doc`; records `v` (also on the group's guard keys, exactly as the
 * room did) when `stamp` = [seq, cid] is given.
 */
export function applyOps(doc, ops, stamp, guardKeys) {
  const guards = !stamp ? [] : Array.isArray(guardKeys) ? guardKeys : guardsOf(doc, ops);
  for (const op of ops) {
    const next = applyOpTo(doc.e[op.k], op);
    if (next === undefined) delete doc.e[op.k]; else doc.e[op.k] = next;
    if (stamp) doc.v[op.k] = stamp;
  }
  if (stamp && ops.length) for (const g of guards) doc.v[g] = stamp;
  return doc;
}

/** The ops that undo `ops` when applied after them, computed from the values BEFORE them (`get(key)`). */
export function invertOps(get, ops) {
  const before = new Map();
  for (const op of ops) if (!before.has(op.k)) before.set(op.k, clone(get(op.k)));
  const after = new Map([...before].map(([k, v]) => [k, v]));
  for (const op of ops) after.set(op.k, applyOpTo(after.get(op.k), op));
  const inv = [];
  for (const [k, v] of before) { const op = diffEntity(k, after.get(k), v); if (op) inv.push(op); }
  return inv;
}

/** Keys an op list touches (in order, unique). */
export const keysOf = (ops) => [...new Set(ops.map((o) => o.k))];

// ---------------------------------------------------------------- validation
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const ITEM_NUM = ['x', 'y', 'rot', 'elev', 'w', 'd', 'h'];
/** Entity checks by key type: return a reason or ''. */
function checkEntity(k, v) {
  if (!isObj(v)) return 'entity must be an object';
  for (const f of Object.keys(v)) if (BAD_FIELD.has(f)) return 'bad field name';
  const t = keyType(k);
  if (t === 'item') {
    if (v.id !== keyId(k)) return 'item id does not match its key';
    for (const f of ITEM_NUM) if (v[f] !== undefined && !num(v[f])) return `item.${f} must be a number`;
    if (!num(v['@z'])) return 'item @z must be a number';
    if (typeof v.type !== 'string') return 'item.type must be a string';
    if (v.level !== undefined && typeof v.level !== 'string') return 'item.level must be a level id';
  } else if (t === 'plan') {
    if (v.phase !== 'draft' && v.phase !== 'fixed') return 'plan.phase';
    if (v.edits != null && (!isObj(v.edits) || !Array.isArray(v.edits.walls) || !Array.isArray(v.edits.openings) || optionalKeysProblem(v.edits))) return 'plan.edits';
    if (v.base != null && (!isObj(v.base) || !Array.isArray(v.base.walls) || optionalKeysProblem(v.base))) return 'plan.base';
  } else if (t === 'run') {
    if (v.id !== undefined && v.id !== keyId(k)) return 'run id does not match its key';
  } else if (t === 'cprod') {
    if (v.id !== keyId(k)) return 'own product id does not match its key';
    if (typeof v.type !== 'string' || typeof v.name !== 'string') return 'own product needs a type and a name';
    if (v.price != null && !num(v.price)) return 'own product price must be a number or null';
    if (v.url != null && (typeof v.url !== 'string' || !/^https:\/\//i.test(v.url))) return 'own product links are https only';
  } else if (t === 'cimg') {
    if (typeof v.url !== 'string' || !/^data:image\//.test(v.url)) return 'cimg.url must be an image data URL';
  } else if (t === 'underlay') {
    if ('image' in v) return 'the underlay picture goes through REST, not the op stream';
    if (v.transform !== undefined && !(Array.isArray(v.transform) && v.transform.length === 6 && v.transform.every(num))) return 'underlay.transform';
  }
  return '';
}

/** Validate an op list from a client: returns '' or a plain reason. */
export function validateOps(ops) {
  if (!Array.isArray(ops) || !ops.length) return 'no operations';
  if (ops.length > LIMITS.opsPerGroup) return 'too many operations';
  for (const op of ops) {
    if (!isObj(op) || typeof op.k !== 'string' || !KEY_RE.test(op.k)) return 'bad key';
    const kinds = (op.p ? 1 : 0) + (op.d ? 1 : 0) + (op.s || op.u ? 1 : 0);
    if (kinds !== 1) return 'an op is exactly one of put / set / delete';
    if (op.d && op.d !== 1) return 'bad delete';
    if (op.p) { const r = checkEntity(op.k, op.p); if (r) return r; }
    if (op.s) {
      if (!isObj(op.s)) return 'bad set';
      for (const f of Object.keys(op.s)) if (BAD_FIELD.has(f)) return 'bad field name';
      if ((keyType(op.k) === 'item' || keyType(op.k) === 'cprod') && ('id' in op.s)) return 'item ids cannot change';
      const probe = checkEntity(op.k, { ...(keyType(op.k) === 'item' ? { id: keyId(op.k), type: 'x', '@z': 0 } : {}), ...(keyType(op.k) === 'cprod' ? { id: keyId(op.k), type: 'x', name: 'x' } : {}), ...(keyType(op.k) === 'plan' ? { phase: 'fixed' } : {}), ...(keyType(op.k) === 'cimg' ? { url: 'data:image/x' } : {}), ...op.s });
      if (probe) return probe;
    }
    if (op.u && (!Array.isArray(op.u) || op.u.some((f) => typeof f !== 'string' || BAD_FIELD.has(f) || f === 'id' || f === '@z'))) return 'bad unset';
  }
  return '';
}

// ---------------------------------------------------------------- the room's rules
/** Guard keys of a group (derived from the ops and the doc, never trusted from a client). */
export function guardsOf(doc, ops) {
  const g = new Set();
  for (const op of ops) {
    const t = keyType(op.k);
    if (t === 'plan') g.add('plan');
    else if (t === 'run') g.add(op.k);
    else if (t === 'item') {
      const before = doc.e[op.k], after = applyOpTo(before, op);
      for (const it of [before, after]) if (it && it.carp && typeof it.carp.runId === 'string') g.add('run:' + it.carp.runId);
    }
  }
  return [...g];
}

/**
 * Apply a client's group under the ordering and conflict rules (room). Mutates `doc` only when accepted.
 * @returns {{ ok: true, effective: Op[], guards: string[] } | { ok: false, code: 'conflict', keys: string[] }}
 */
export function applyGroup(doc, ops, { seq, cid, base }) {
  const changedByOther = (k) => { const v = doc.v[k]; return !!v && v[0] > base && v[1] !== cid; };
  const guards = guardsOf(doc, ops);
  const conflicts = guards.filter(changedByOther);
  if (conflicts.length) return { ok: false, code: 'conflict', keys: conflicts };
  const effective = [];
  for (const op of ops) {
    const cur = doc.e[op.k];
    if (op.s || op.u) { if (cur === undefined) continue; }                                 // deletes win
    else if (op.p && cur === undefined && doc.v[op.k] && changedByOther(op.k)) continue;   // someone else deleted it since
    else if (op.d && cur === undefined) continue;
    const next = applyOpTo(cur, op);
    if (next === undefined) delete doc.e[op.k]; else doc.e[op.k] = next;
    doc.v[op.k] = [seq, cid];
    effective.push(op);
  }
  if (effective.length) for (const g of guards) doc.v[g] = [seq, cid];   // a run's version covers its unit items too
  return { ok: true, effective, guards: effective.length ? guards : [] };
}

/** The ops that turn doc `a` into doc `b` (restore points). */
export function diffDocs(a, b) {
  const ops = [];
  for (const k of new Set([...Object.keys(a.e), ...Object.keys(b.e)])) { const op = diffEntity(k, a.e[k], b.e[k]); if (op) ops.push(op); }
  return ops;
}

/** UTF-16 length of the JSON text (cheap size measure used for limits). */
export const sizeOf = (o) => { try { return JSON.stringify(o).length; } catch (e) { return Infinity; } };
