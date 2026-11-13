/**
 * Store binding for the carpentry engine. Mutations work on a DRAFT (copy-on-write items + a cloned carpentry state)
 * and are committed as ONE undo step through store._applyCarpentry(); a refused draft changes nothing.
 */
import { store as defaultStore } from '../core/store.js';
import { PLAN } from '../core/plan.js';

let S = defaultStore;
/** Point the engine at another store instance (tests / workers). */
export function bindStore(s) { S = s; }
export function getStore() { return S; }

export const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
export const emptyCarpentry = () => ({ runs: {}, settings: {} });

/** The ceiling height carpentry is designed to (PLAN.heights.ceiling, 300). */
export const ceilingOf = () => (PLAN.heights && PLAN.heights.ceiling) || 300;

/**
 * Read-only view of the state: `src` = { carpentry, items } (e.g. a parsed design file) or the bound store.
 * Returns { carpentry, items, item(id), run(id), runs() }.
 */
export function view(src) {
  const carpentry = (src && src.carpentry) || S.carpentry || emptyCarpentry();
  const items = (src && src.items) || S.items || [];
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    carpentry, items,
    item: (id) => byId.get(id) || null,
    run: (id) => (carpentry.runs && carpentry.runs[id]) || null,
    runs: () => Object.values(carpentry.runs || {}),
  };
}

let _seq = 0;
export const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${(_seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A copy-on-write draft of the store's items + a cloned carpentry state. */
export function makeDraft() {
  const orig = new Map(S.items.map((i) => [i.id, i]));
  const touched = new Map(), added = new Map(), removed = new Set();
  const d = {
    carpentry: clone(S.carpentry || emptyCarpentry()),
    /** Writable item (cloned on first access). */
    item(id) {
      if (removed.has(id)) return null;
      if (added.has(id)) return added.get(id);
      if (touched.has(id)) return touched.get(id);
      const o = orig.get(id);
      if (!o) return null;
      const c = clone(o); touched.set(id, c); return c;
    },
    /** Read without cloning. */
    peek(id) { return removed.has(id) ? null : added.get(id) || touched.get(id) || orig.get(id) || null; },
    add(item) { if (!item.id) item.id = newId('cu'); added.set(item.id, item); return item; },
    remove(id) { if (added.has(id)) added.delete(id); else if (orig.has(id)) removed.add(id); touched.delete(id); },
    /** Current item list (store order, then added). */
    items() {
      const out = [];
      for (const [id, it] of orig) if (!removed.has(id)) out.push(touched.get(id) || it);
      for (const it of added.values()) out.push(it);
      return out;
    },
    _diff() {
      const update = {};
      for (const [id, it] of touched) if (JSON.stringify(it) !== JSON.stringify(orig.get(id))) update[id] = it;
      return { add: [...added.values()], update, remove: [...removed] };
    },
  };
  return d;
}

/**
 * Run `fn(draft)`; if it returns { ok: false, … } nothing changes. Otherwise the draft is committed as one undo step and
 * one 'carpentry' event { reason, runIds } (plus 'items' events). Returns fn's result (ok: true added if missing).
 */
export function mutate(reason, fn, opts = {}) {
  const draft = makeDraft();
  let res;
  try { res = fn(draft) || {}; } catch (e) { return { ok: false, reason: { en: `Internal error: ${e.message}`, he: `שגיאה פנימית: ${e.message}` } }; }
  if (res.ok === false) return res;
  const diff = draft._diff();
  const carpChanged = JSON.stringify(draft.carpentry) !== JSON.stringify(S.carpentry || emptyCarpentry());
  if (!carpChanged && !diff.add.length && !diff.remove.length && !Object.keys(diff.update).length) return { ok: true, warnings: [], ids: [], ...res, changed: false };
  S._applyCarpentry({ carpentry: draft.carpentry, ...diff, reason, runIds: res.runIds || [] }, opts);
  return { ok: true, warnings: [], ids: [], ...res, changed: true };
}
