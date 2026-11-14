/**
 * LIVE COLLABORATION — the store adapter: reads the synchronised entities out of the store (CONTRACT § 13), reports
 * local edits from the store's events, and applies remote changes with the same events a local edit emits.
 *
 *   const bridge = createStoreBridge(store, { fetchUnderlay, uploadUnderlay });
 *   const client = createClient({ adapter: bridge, connect });
 *   bridge.attach(client);   // store.collab is set: undo / redo become per person
 */
import { PLAN } from '../core/plan.js';
import * as PE from '../core/plan-edit.js';
import { defaultProject, normalizeItem } from '../core/store.js';
import { keyType, keyId, TYPE_ORDER, docToRecord } from './ops.js';
import { normalizeOptionalKeys } from '../core/plan-schema.js';

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const TX_FIELDS = ['x', 'y', 'rot', 'elev', 'w', 'd', 'h'];
// 'setActiveLevel' is recorded (on a plan with upper levels) before each call, so a re-run edits the same level
const PLAN_CALLS = ['addWall', 'removeWallSegment', 'moveWallSegment', 'resizeWallSegment', 'addOpening', 'updateOpening', 'removeOpening', 'flipDoor', 'updateRoom', 'resetPlan',
  'addLevel', 'removeLevel', 'updateLevel', 'setActiveLevel', 'rotateWallEnd',
  'addStair', 'updateStair', 'removeStair', 'updateVoid', 'removeVoid'];   // stage F4b

/**
 * Drawing order → `@z`: keep the values of the longest run of items already in increasing order, give the others values
 * between their neighbours. Returns the ids whose `@z` changed.
 */
export function assignZ(ids, zmap) {
  const vals = ids.map((id) => (zmap.has(id) ? zmap.get(id) : null));
  // longest strictly increasing subsequence over the known values (patience sorting, O(n log n))
  const tails = [], tailIdx = [], prev = new Array(ids.length).fill(-1);
  vals.forEach((v, i) => {
    if (v == null) return;
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < v) lo = mid + 1; else hi = mid; }
    tails[lo] = v; tailIdx[lo] = i; prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  });
  const keep = new Set();
  for (let i = tailIdx[tails.length - 1] ?? -1; i >= 0; i = prev[i]) keep.add(i);
  const changed = [], live = new Set(ids);
  for (const id of [...zmap.keys()]) if (!live.has(id)) zmap.delete(id);
  let i = 0;
  while (i < ids.length) {
    if (keep.has(i)) { i++; continue; }
    let j = i; while (j < ids.length && !keep.has(j)) j++;          // gap [i, j)
    const lo = i > 0 ? zmap.get(ids[i - 1]) : null, hi = j < ids.length ? zmap.get(ids[j]) : null, n = j - i;
    for (let t = 0; t < n; t++) {
      const z = lo == null && hi == null ? t : hi == null ? lo + t + 1 : lo == null ? hi - (n - t) : lo + ((hi - lo) * (t + 1)) / (n + 1);
      if (zmap.get(ids[i + t]) !== z) { zmap.set(ids[i + t], z); changed.push(ids[i + t]); }
    }
    i = j;
  }
  return changed;
}

/**
 * @param {object} store
 * @param {{ fetchUnderlay?: (assetId) => Promise<string|null>, uploadUnderlay?: (image, meta) => Promise<any> }} [o]
 */
export function createStoreBridge(store, { fetchUnderlay = async () => null, uploadUnderlay = null } = {}) {
  const zmap = new Map();
  let client = null, off = null, collecting = null, intents = [], opening = false, onDetached = null;
  const softLocks = new Map();   // item id → its own `locked` value while someone else holds a soft lock on it (local only)
  let baseRef = null, baseVal = null, underlayImg = null, underlayImage = null, uploading = null;
  const baseNow = () => { if (PE.BASE_PLAN !== baseRef) { baseRef = PE.BASE_PLAN; baseVal = clone(PE.BASE_PLAN); } return baseVal; };
  const runIndex = () => Object.keys((store.carpentry && store.carpentry.runs) || {});

  function get(k) {
    const t = keyType(k), id = keyId(k);
    switch (t) {
      case 'item': {
        const it = store.getItem(id);
        if (!it) return undefined;
        const v = { ...clone(it), '@z': zmap.has(id) ? zmap.get(id) : 0 };
        if (softLocks.has(id)) v.locked = softLocks.get(id);
        return v;
      }
      case 'finish': return store.finishes[id] ? clone(store.finishes[id]) : undefined;
      case 'project': return clone(store.project);
      case 'plan': return { phase: PE.planPhase(), base: baseNow(), edits: clone(PE.planState()) };
      case 'run': return store.carpentry.runs[id] ? clone(store.carpentry.runs[id]) : undefined;
      case 'carp': return clone(store.carpentry.settings || {});
      case 'cimg': return typeof store.carpentryImages[id] === 'string' ? { url: store.carpentryImages[id] } : undefined;
      case 'cprod': { const p = store.getCustomProduct ? store.getCustomProduct(id) : null; return p ? clone(p) : undefined; }
      case 'underlay': {
        if (!store.underlay) return undefined;
        const { image, ...meta } = store.underlay;
        if (image !== underlayImage && uploadUnderlay && image && uploading !== image) {      // a new picture: through REST
          uploading = image;
          Promise.resolve(uploadUnderlay(image, meta)).then((id) => { if (typeof id === 'string' && store.underlay && store.underlay.image === image) { underlayImg = id; underlayImage = image; } })
            .catch(() => {}).finally(() => { if (uploading === image) uploading = null; });
        }
        return { ...clone(meta), img: underlayImg };
      }
      default: return undefined;
    }
  }
  function allTypeKeys(t) {
    switch (t) {
      case 'item': return store.items.map((i) => 'item:' + i.id);
      case 'finish': return Object.keys(store.finishes).map((id) => 'finish:' + id);
      case 'run': return runIndex().map((id) => 'run:' + id);
      case 'cimg': return Object.keys(store.carpentryImages || {}).map((id) => 'cimg:' + id);
      case 'cprod': return (store.customProducts || []).map((p) => 'cprod:' + p.id);
      case 'project': case 'plan': case 'carp': return [t];
      case 'underlay': return store.underlay ? ['underlay'] : [];
      default: return [];
    }
  }
  const keys = () => TYPE_ORDER.flatMap(allTypeKeys);

  /** Store events → changed keys. */
  function onEvent(ev, p = {}) {
    if (p && p.collabLocal) return;                       // soft-lock repaint: not a change
    if (ev === 'base' && !opening && client) { const c = client; api.detach(); c.dispose(); if (onDetached) onDetached(); return; }
    let ks = [];
    const transient = !!(p && p.transient);
    let tx = null;
    switch (ev) {
      case 'items': {
        ks = (p.ids || []).map((id) => 'item:' + id);
        if (!collecting && (p.type === 'add' || p.type === 'reset')) for (const id of assignZ(store.items.map((i) => i.id), zmap)) ks.push('item:' + id);
        if (transient && p.type === 'update') {
          tx = {};
          for (const id of p.ids || []) { const it = store.getItem(id); if (!it) continue; const s = {}; for (const f of TX_FIELDS) s[f] = it[f]; tx['item:' + id] = s; }
        }
        break;
      }
      case 'finishes': ks = (p.ids || []).map((id) => 'finish:' + id); break;
      case 'project': ks = ['project']; break;
      case 'plan': ks = ['plan']; break;
      case 'carpentry': ks = ['*run', 'carp', '*cimg']; break;
      case 'underlay': ks = ['underlay']; break;
      case 'products': ks = p.type === 'reset' ? ['*cprod'] : (p.ids || []).map((id) => 'cprod:' + id); break;
      case 'load': if (!collecting) assignZ(store.items.map((i) => i.id), zmap); ks = ['*']; break;
      default: return;
    }
    if (collecting) { for (const k of ks) if (k[0] !== '*') collecting.add(k); return; }
    if (client) client.localChange(ks, { transient, tx });
  }

  /** Apply remote / reconciled values with the events a local edit emits. Returns keys touched on the side. */
  function apply(changes, { transient = false } = {}) {
    collecting = new Set();
    try {
      if (transient) {
        const ids = [];
        for (const [k, v] of changes) { const it = keyType(k) === 'item' && v && store.getItem(keyId(k)); if (!it) continue; for (const f of TX_FIELDS) if (typeof v[f] === 'number') it[f] = v[f]; ids.push(it.id); }
        if (ids.length) store.emit('items', { type: 'update', ids, transient: true });
        return collecting;
      }
      const by = (t) => [...changes].filter(([k]) => keyType(k) === t);
      // plan
      for (const [, v] of by('plan')) {
        if (!v) continue;
        const baseKey = v.base ? JSON.stringify(normalizeOptionalKeys(clone(v.base))) : null;   // BASE_PLAN holds the optional keys normalised
        if ((baseKey && baseKey !== JSON.stringify(baseNow())) || v.phase !== PE.planPhase()) {
          PE.setBasePlan(v.base || baseNow(), { phase: v.phase });
          PE.applyPlanState(v.edits || null);
          store._planChanged({ reason: 'phase', changed: { walls: true, openings: true, rooms: true, levels: true } });
        } else {
          const res = PE.applyPlanState(v.edits || null);
          if (res.changed.walls || res.changed.openings || res.changed.rooms || res.changed.levels) store._planChanged({ reason: 'remote', changed: res.changed });
        }
      }
      // project
      for (const [, v] of by('project')) {
        if (!v) continue;
        const before = store.project, next = { ...defaultProject(), ...clone(v) };
        const changedKeys = [...new Set([...Object.keys(before), ...Object.keys(next)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]));
        store.project = next;
        if (changedKeys.length) store.emit('project', { keys: changedKeys });
      }
      // carpentry
      const runs = by('run'), carp = by('carp'), imgs = by('cimg');
      if (imgs.length) { const m = { ...store.carpentryImages }; for (const [k, v] of imgs) { if (v) m[keyId(k)] = v.url; else delete m[keyId(k)]; } store.carpentryImages = m; }
      if (runs.length || carp.length) {
        const r = { ...store.carpentry.runs };
        for (const [k, v] of runs) { if (v) r[keyId(k)] = clone(v); else delete r[keyId(k)]; }
        store.carpentry = { ...store.carpentry, runs: r, settings: carp.length && carp[0][1] ? clone(carp[0][1]) : store.carpentry.settings };
      }
      // own products (before the items placed from them)
      const prods = by('cprod');
      if (prods.length) {
        const m = new Map((store.customProducts || []).map((x) => [x.id, x]));
        for (const [k, v] of prods) { if (v) m.set(keyId(k), clone(v)); else m.delete(keyId(k)); }
        store._setCustomProducts([...m.values()]);
        const pids = prods.map(([k]) => keyId(k));
        store.emit('products', { type: 'update', ids: pids });
        const spaces = Object.keys(store.finishes).filter((sid) => { const f = store.finishes[sid]; return f && (pids.includes(f.floor) || pids.includes(f.wall)); });
        if (spaces.length) store.emit('finishes', { ids: spaces });   // a room finish that is an own product looks different now
      }
      // items
      const removed = [], updated = [], added = [];
      let reorder = false;
      for (const [k, v] of by('item')) {
        const id = keyId(k), idx = store.items.findIndex((i) => i.id === id);
        if (!v) { if (idx >= 0) { store.items.splice(idx, 1); removed.push(id); } zmap.delete(id); continue; }
        const { '@z': z, ...raw } = v;
        const fields = normalizeItem(raw);
        if (zmap.get(id) !== z) reorder = true;
        zmap.set(id, typeof z === 'number' ? z : 0);
        if (softLocks.has(id)) { softLocks.set(id, fields.locked); fields.locked = true; }
        if (idx >= 0) { const obj = store.items[idx]; for (const f of Object.keys(obj)) if (!(f in fields)) delete obj[f]; Object.assign(obj, fields); updated.push(id); }
        else { store.items.push(fields); added.push(id); reorder = true; }
      }
      if (reorder) store.items.sort((a, b) => ((zmap.get(a.id) ?? 0) - (zmap.get(b.id) ?? 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      if (runs.length || carp.length || imgs.length) store.emit('carpentry', { reason: 'remote', runIds: runs.map(([k]) => keyId(k)) });
      if (removed.length) { store.selection = store.selection.filter((id) => !removed.includes(id)); store.emit('items', { type: 'remove', ids: removed }); }
      if (updated.length) store.emit('items', { type: 'update', ids: updated });
      if (added.length) store.emit('items', { type: 'add', ids: added });
      if (reorder && !added.length) store.emit('items', { type: 'reset', ids: [] });
      if (removed.length) store.emit('selection', { ids: store.selection });
      // finishes
      const fin = by('finish');
      if (fin.length) {
        for (const [k, v] of fin) { if (v) store.finishes[keyId(k)] = clone(v); else delete store.finishes[keyId(k)]; }
        store.emit('finishes', { ids: fin.map(([k]) => keyId(k)) });
      }
      // underlay (meta in the op stream, the picture through REST)
      for (const [, v] of by('underlay')) {
        if (!v) { store.underlay = null; underlayImg = null; underlayImage = null; store.emit('underlay', { reason: 'remote' }); continue; }
        const { img, ...meta } = clone(v);
        const keepImage = img === underlayImg && store.underlay ? store.underlay.image : underlayImage && img === underlayImg ? underlayImage : null;
        store.underlay = keepImage ? { ...meta, image: keepImage } : store.underlay ? { ...meta, image: store.underlay.image } : null;
        if (img !== underlayImg) {
          underlayImg = img;
          const want = img;
          Promise.resolve(img ? fetchUnderlay(img) : null).then((image) => {
            if (underlayImg !== want || !image) return;
            underlayImage = image;
            const cur = client ? (client.debug.confirmed().e.underlay || meta) : meta;
            const { img: _i, ...m } = cur;
            store.underlay = { opacity: 0.5, visible: true, ...m, image };
            collecting = new Set(); try { store.emit('underlay', { reason: 'remote' }); } finally { collecting = null; }
          }).catch(() => {});
        }
        store.emit('underlay', { reason: 'remote' });
      }
      if (prods.length || by('item').length) scheduleOwnSync();
      return collecting;
    } finally { collecting = null; }
  }

  /**
   * Own products (CONTRACT § 16): someone else's change can leave an item pointing at an own product that was deleted
   * meanwhile (it becomes generic, size kept) or carrying an old price / link (it takes the product's). Every replica
   * makes the same fix as an ordinary change of its own, so the values converge whoever's fix the room orders last.
   */
  let syncQueued = false;
  function scheduleOwnSync() {
    if (syncQueued || typeof store.syncOwnItems !== 'function') return;
    syncQueued = true;
    Promise.resolve().then(() => {
      syncQueued = false;
      if (!client || store._batch || (client.role && client.role() === 'viewer')) return;
      client.flush();                                       // the person's own pending change stays a group of its own
      if (store.syncOwnItems().length) client.flush('sys');   // the fix is not on the person's undo stack
    });
  }

  const api = {
    get, keys, allTypeKeys, apply,
    inBatch: () => !!store._batch,
    takeIntent() { if (!intents.length) return null; const out = intents; intents = []; return out; },
    /** Re-run recorded plan-engine calls on the current plan (after a conflict). */
    runIntent(list) {
      intents = [];
      const mine = PE.activeLevel();          // the person's own level: calls start on L0 unless a recorded level says otherwise
      PE.setActiveLevel('L0');
      try {
        for (const call of list || []) {
          if (!PLAN_CALLS.includes(call.name)) return { ok: false, reason: 'Unknown plan change.' };
          const r = PE[call.name](...(call.args || []));
          if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || 'The plan engine refused it.' };
        }
        return { ok: true };
      } finally { PE.setActiveLevel(mine); }
    },
    /**
     * Open a room's doc as the store's project (base plan, phase, design; the underlay picture is fetched).
     * Keeps the person's own UI state. Call before the client takes its mirror (the client's 'welcome' listener).
     */
    openDoc(doc) {
      const rec = docToRecord(doc);
      const persist = store.persist;
      softLocks.clear();
      opening = true;
      try { store.openProject({ basePlan: rec.basePlan || clone(PE.BASE_PLAN), phase: rec.phase, design: { ...rec.design, ui: store.ui }, name: rec.name, underlay: null }); } finally { opening = false; }
      store.persist = persist;
      api.loaded(doc);
      const u = doc.e.underlay;
      if (u && u.img) Promise.resolve(fetchUnderlay(u.img)).then((image) => {
        if (!image || underlayImg !== u.img) return;
        const cur = (client && client.debug.confirmed().e.underlay) || u;
        const { img, ...meta } = cur;
        underlayImage = image;
        store.underlay = { opacity: 0.5, visible: true, ...meta, image };
        collecting = new Set(); try { store.emit('underlay', { reason: 'open' }); } finally { collecting = null; }
      }).catch(() => {});
    },
    /** The doc that was just opened into the store: take its drawing order and underlay asset id. */
    loaded(doc) {
      zmap.clear();
      for (const [k, v] of Object.entries(doc.e)) if (keyType(k) === 'item') zmap.set(keyId(k), v['@z']);
      assignZ(store.items.map((i) => i.id), zmap);
      underlayImg = doc.e.underlay ? doc.e.underlay.img || null : null;
      underlayImage = store.underlay ? store.underlay.image : null;
    },
    /** The local user just uploaded `image` as asset `id` (the server's underlay group follows). */
    underlayUploaded(id, image) { underlayImg = id; underlayImage = image; },
    attach(c) {
      client = c;
      off = store.on('*', onEvent);
      const offHistory = c.on('history', () => store.emit('history', store.historyState()));
      const offRole = c.on('role', () => store.emit('history', store.historyState()));
      off = ((o) => () => { o(); offHistory(); offRole(); })(off);
      store.collab = { undo: () => c.undo(), redo: () => c.redo(), historyState: () => c.historyState(), batchEnded: () => c.batchEnded(), planIntent: (name, args) => { intents.push({ name, args }); } };
      store.emit('history', store.historyState());
    },
    /** Called when the bridge let go by itself (another project was opened into the store). */
    onDetached(fn) { onDetached = fn; },
    /**
     * Soft lock (someone else is dragging / editing it): the item behaves as locked here until released. Local only —
     * never captured or sent (get() reports the item's own value).
     */
    softLock(id, on) {
      const it = store.getItem(id);
      if (on && it && !softLocks.has(id)) { softLocks.set(id, it.locked); it.locked = true; }
      else if (!on && softLocks.has(id)) { if (it) it.locked = softLocks.get(id); softLocks.delete(id); }
      else return;
      store.emit('items', { type: 'update', ids: [id], transient: true, collabLocal: true });
    },
    softLocked: () => [...softLocks.keys()],
    detach() {
      for (const id of [...softLocks.keys()]) api.softLock(id, false); if (off) off(); off = null; client = null; store.collab = null; intents = []; store.emit('history', store.historyState()); },
    zmap,
  };
  void PLAN;
  return api;
}
