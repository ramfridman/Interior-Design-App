/**
 * Application store — the ONLY place design state lives. Views and UI read from it and subscribe to events;
 * nobody keeps a private copy of items.
 *
 *   import { store } from './core/store.js';
 *   const off = store.on('items', (e) => { ... });   // e = { type, ids }
 *
 * EVENTS
 *   'items'      { type: 'add' | 'update' | 'remove' | 'reset', ids: string[], transient?: boolean }
 *   'selection'  { ids: string[] }
 *   'ui'         { keys: string[] }          – store.ui changed
 *   'project'    { keys: string[] }          – store.project changed (ceiling height, roof, name…)
 *   'finishes'   { ids: string[] }           – room floor / wall finish changed
 *   'plan'       { reason, changed: { walls, openings, rooms }, transient? }
 *                                            – PLAN.walls / openings / rooms / wallOutline were REPLACED (core/plan-edit.js,
 *                                              undo / redo, load). reason: 'add-wall' | 'remove-wall' | 'move-wall' |
 *                                              'resize-wall' | 'add-opening' | 'update-opening' | 'remove-opening' |
 *                                              'update-room' | 'reset' | 'history' | 'load'. Rebuild everything drawn from PLAN.
 *   'carpentry'  { reason, runIds, transient? }  – store.carpentry (made-to-measure runs, src/carpentry/) changed.
 *                                              reason: an engine reason ('create-run', 'layout', 'adopt', …) | 'history' | 'load'
 *   'history'    { canUndo, canRedo }
 *   'load'       {}                          – whole design replaced (file open / reset)
 *   '*'          (eventName, payload)        – everything
 *
 * HISTORY
 *   Every mutating call records one undo step, except calls with { transient: true } (used while dragging).
 *   Wrap a drag as: store.begin(); …updateItem(id, patch, { transient: true })…; store.commit('Move');
 *   Plan edits (core/plan-edit.js) are part of the same history: every snapshot also holds the edited plan
 *   ({ walls, openings, rooms }, or null while the plan is the architect's), so undo / redo / cancel restore it.
 */
import { PLAN } from './plan.js';
import { spaceAt } from './geometry.js';
import { bindPlanHost, planState, planStateKey, applyPlanState } from './plan-edit.js';

const STORAGE_KEY = 'e7-interior-design/v1';
const HISTORY_LIMIT = 200;

let _id = 0;
const newId = () => 'it_' + Date.now().toString(36) + (_id++).toString(36) + Math.random().toString(36).slice(2, 5);
const clone = (o) => JSON.parse(JSON.stringify(o));
/** Empty carpentry state (see docs/CONTRACT.md § 8). */
const emptyCarpentry = () => ({ runs: {}, settings: {} });
/** Accept whatever a file holds for `carpentry`; anything unreadable becomes the empty state. */
function readCarpentry(raw) {
  if (!raw || typeof raw !== 'object' || !raw.runs || typeof raw.runs !== 'object' || Array.isArray(raw.runs)) return emptyCarpentry();
  return { runs: clone(raw.runs), settings: raw.settings && typeof raw.settings === 'object' ? clone(raw.settings) : {} };
}

/** Fill in every item field with its default and guarantee a unique id. */
function normalizeItem(partial) {
  const item = {
    id: null, productId: null, type: 'cabinet', name: 'Item', params: {},
    x: 0, y: 0, rot: 0, elev: 0, w: 100, d: 50, h: 80,
    placement: 'floor', zone: 'indoor', price: null, priceUnit: 'item', url: null, retailer: null, brand: null,
    locked: false, hidden: false, fixture: false, generic: false, note: '',
    ...clone(partial),
  };
  if (!item.id) item.id = newId();
  if (!item.params || typeof item.params !== 'object') item.params = {};
  return item;
}

/** Today's calendar date at the house ('YYYY-MM-DD' in PLAN.meta.timeZone) — the default day for the 3D sun. */
function siteToday() {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: PLAN.meta.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch (e) { return new Date().toISOString().slice(0, 10); }
}

const DEFAULT_UI = {
  mode: '2d',              // '2d' | '3d' | 'walk' | 'split'
  tool: 'select',          // 'select' | 'pan' | 'measure'
  units: 'm',              // 'm' | 'cm'
  snap: true,              // snap to walls / grid / other items
  gridStep: 5,             // cm
  showGrid: true,
  showDimensions: true,    // architect dimension lines
  showRoomLabels: true,
  showSite: true,          // lot boundary, building line, parking
  showItems: true,
  showRoof: false,         // 3D: roof + ceiling visible (auto-on in walk mode)
  wallsCutaway: false,     // 3D orbit: cut walls to 1.2 m for a dollhouse view
  timeOfDay: 15,           // hours 0..24 local clock time, drives the sun in 3D
  date: siteToday(),       // 'YYYY-MM-DD' — day of the year for the 3D sun (default: today at the house)
  sunStudy: true,          // 3D: a hidden roof / cut-away walls still block the sun, so rooms show the true sun patches
  daylight: true,          // 3D: diffuse daylight solver (sky + bounced light through the real openings); false = simple fill lights
  daylightSky: 'clear',    // 3D daylight sky model: 'clear' (CIE clear sky + sun) | 'overcast' (CIE overcast, no sun)
  leftPanel: 'catalog',    // which left panel tab is open
  rightPanel: 'inspector', // 'inspector' | 'budget' | 'checks' | 'rooms'
  catalogZone: 'indoor',   // 'indoor' | 'outdoor'
  activeSpace: null,       // id of the room / outdoor area the user last clicked (target for finishes)
  // ── structure editing (walls / doors / windows) — see docs/CONTRACT.md § 7 ──
  //   ui.tool also takes 'structure' (select / move walls & openings), 'wall' (draw a partition),
  //   'door' | 'window' | 'passage' (place an opening).
  structureSel: null,      // { type: 'segment' | 'opening', id } — the wall segment / opening selected in the plan
  wallThickness: 10,       // cm, for the draw-wall tool (7–20)
  showPlanChanges: true,   // highlight differences from the architect's plan
};

const DEFAULT_PROJECT = {
  name: PLAN.meta.name,
  ceilingHeight: PLAN.heights.ceiling, // cm
  roof: 'flat',
  wallColor: '#f4f1ea',     // default interior wall paint
  exteriorColor: '#efece6', // exterior render
  frameColor: '#2b2d31',    // window / door frames (dark aluminium)
};

class Store {
  constructor() {
    this.items = [];            // array of item objects (see docs/CONTRACT.md § Item)
    this.selection = [];        // selected item ids
    this.ui = { ...DEFAULT_UI };
    this.project = { ...DEFAULT_PROJECT };
    /** finishes[spaceId] = { floor: productId | null, wall: productId | null, floorParams?, wallColor? } */
    this.finishes = {};
    /** Made-to-measure carpentry: { runs: { [id]: Run }, settings } — written only by src/carpentry/ (§ 8). */
    this.carpentry = emptyCarpentry();
    this._listeners = new Map();
    this._undo = [];
    this._redo = [];
    this._batch = null;
    this._saveTimer = null;
    this.persist = true;
  }

  // ---------- events ----------
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event)?.delete(fn);
  }
  emit(event, payload = {}) {
    this._listeners.get(event)?.forEach((fn) => { try { fn(payload); } catch (e) { console.error(`[store] listener for "${event}" failed`, e); } });
    this._listeners.get('*')?.forEach((fn) => { try { fn(event, payload); } catch (e) { console.error(e); } });
    if (event !== 'selection' && event !== 'history' && !(payload && payload.transient)) this._scheduleSave();
  }

  // ---------- read helpers ----------
  getItem(id) { return this.items.find((i) => i.id === id) || null; }
  getSelected() { return this.selection.map((id) => this.getItem(id)).filter(Boolean); }
  /** Room / outdoor area / garden an item's centre sits in. */
  spaceOf(item) { return spaceAt(item.x, item.y); }

  // ---------- history ----------
  _snapshot() { return `{"items":${JSON.stringify(this.items)},"finishes":${JSON.stringify(this.finishes)},"project":${JSON.stringify(this.project)},"plan":${planStateKey()},"carpentry":${JSON.stringify(this.carpentry)}}`; }
  _pushUndo(snap) {
    this._undo.push(snap);
    if (this._undo.length > HISTORY_LIMIT) this._undo.shift();
    this._redo.length = 0;
    this.emit('history', this.historyState());
  }
  _record(opts) {
    if (opts && opts.transient) return;
    if (this._batch) return;                    // the batch snapshot was already taken in begin()
    this._pushUndo(this._snapshot());
  }
  /** Start a gesture (drag, slider scrub). Takes one snapshot; all changes until commit() are one undo step. */
  begin() { if (!this._batch) this._batch = this._snapshot(); }
  /** End a gesture started with begin(). */
  commit() {
    if (!this._batch) return;
    const before = this._batch; this._batch = null;
    if (before !== this._snapshot()) this._pushUndo(before);
    this._scheduleSave();
  }
  /** Abort a gesture and restore the state from begin(). */
  cancel() {
    if (!this._batch) return;
    const before = this._batch; this._batch = null;
    this._restore(before);
  }
  historyState() { return { canUndo: this._undo.length > 0, canRedo: this._redo.length > 0 }; }
  _restore(snap) {
    const s = JSON.parse(snap);
    const plan = applyPlanState(s.plan || null);            // no-op unless the snapshot holds a different plan
    const carp = readCarpentry(s.carpentry), carpChanged = JSON.stringify(carp) !== JSON.stringify(this.carpentry);
    this.items = s.items; this.finishes = s.finishes || {}; this.project = { ...DEFAULT_PROJECT, ...s.project };
    this.carpentry = carp;
    this.selection = this.selection.filter((id) => this.getItem(id));
    if (plan.changed.walls || plan.changed.openings || plan.changed.rooms) this.emit('plan', { reason: 'history', changed: plan.changed });
    if (carpChanged) this.emit('carpentry', { reason: 'history', runIds: Object.keys(carp.runs) });
    this.emit('items', { type: 'reset', ids: this.items.map((i) => i.id) });
    this.emit('finishes', { ids: Object.keys(this.finishes) });
    this.emit('project', { keys: Object.keys(this.project) });
    this.emit('selection', { ids: this.selection });
  }
  undo() {
    if (!this._undo.length) return;
    this._redo.push(this._snapshot());
    this._restore(this._undo.pop());
    this.emit('history', this.historyState());
  }
  redo() {
    if (!this._redo.length) return;
    this._undo.push(this._snapshot());
    this._restore(this._redo.pop());
    this.emit('history', this.historyState());
  }

  // ---------- items ----------
  /**
   * Add an item. `partial` needs at least { type, w, d, h } and usually x, y.
   * Returns the created item (with id). Use createItemFromProduct() in catalog/index.js to build `partial`.
   */
  addItem(partial, opts = {}) {
    this._record(opts);
    const item = normalizeItem(partial);
    this.items.push(item);
    this.emit('items', { type: 'add', ids: [item.id] });
    if (opts.select !== false) this.select([item.id]);
    return item;
  }
  addItems(partials, opts = {}) {
    this._record(opts);
    const wasBatch = this._batch; if (!wasBatch) this._batch = '__inner__';
    const made = partials.map((p) => this.addItem(p, { transient: true, select: false }));
    if (!wasBatch) this._batch = null;
    if (opts.select !== false) this.select(made.map((m) => m.id));
    return made;
  }
  updateItem(id, patch, opts = {}) {
    const item = this.getItem(id);
    if (!item) return null;
    this._record(opts);
    Object.assign(item, patch);
    this.emit('items', { type: 'update', ids: [id], transient: !!opts.transient, keys: Object.keys(patch) });
    return item;
  }
  updateItems(ids, patchOrFn, opts = {}) {
    this._record(opts);
    const done = [];
    for (const id of ids) {
      const item = this.getItem(id); if (!item) continue;
      Object.assign(item, typeof patchOrFn === 'function' ? patchOrFn(item) : patchOrFn);
      done.push(id);
    }
    if (done.length) this.emit('items', { type: 'update', ids: done, transient: !!opts.transient });
  }
  removeItems(ids, opts = {}) {
    ids = ids.filter((id) => this.getItem(id));
    if (!ids.length) return;
    this._record(opts);
    this.items = this.items.filter((i) => !ids.includes(i.id));
    this.selection = this.selection.filter((id) => !ids.includes(id));
    this.emit('items', { type: 'remove', ids });
    this.emit('selection', { ids: this.selection });
  }
  duplicateItems(ids, offset = { x: 30, y: 30 }) {
    const src = ids.map((id) => this.getItem(id)).filter(Boolean);
    if (!src.length) return [];
    return this.addItems(src.map((s) => ({ ...clone(s), id: undefined, x: s.x + offset.x, y: s.y + offset.y, locked: false })));
  }
  /** Replace an item's product/model but keep its position and rotation (used by "Swap for…" in the inspector). */
  swapItem(id, partial) {
    const item = this.getItem(id); if (!item) return null;
    const keep = { x: item.x, y: item.y, rot: item.rot, id: item.id };
    return this.updateItem(id, { ...clone(partial), ...keep });
  }
  /** Z-order for 2D drawing: move to the end of the list. */
  bringToFront(ids) {
    this._record();
    const top = this.items.filter((i) => ids.includes(i.id));
    this.items = this.items.filter((i) => !ids.includes(i.id)).concat(top);
    this.emit('items', { type: 'reset', ids });
  }
  sendToBack(ids) {
    this._record();
    const bottom = this.items.filter((i) => ids.includes(i.id));
    this.items = bottom.concat(this.items.filter((i) => !ids.includes(i.id)));
    this.emit('items', { type: 'reset', ids });
  }

  // ---------- selection ----------
  select(ids) {
    ids = (ids || []).filter((id) => this.getItem(id));
    if (ids.length === this.selection.length && ids.every((id, i) => id === this.selection[i])) return;
    this.selection = ids;
    this.emit('selection', { ids });
  }
  toggleSelect(id) { this.select(this.selection.includes(id) ? this.selection.filter((s) => s !== id) : [...this.selection, id]); }
  clearSelection() { this.select([]); }

  // ---------- ui / project / finishes ----------
  setUI(patch) {
    const keys = Object.keys(patch).filter((k) => this.ui[k] !== patch[k]);
    if (!keys.length) return;
    Object.assign(this.ui, patch);
    this.emit('ui', { keys });
  }
  setProject(patch, opts = {}) {
    const keys = Object.keys(patch).filter((k) => this.project[k] !== patch[k]);
    if (!keys.length) return;
    this._record(opts);
    Object.assign(this.project, patch);
    this.emit('project', { keys, transient: !!opts.transient });
  }
  /** Set floor / wall finish of a room or outdoor area. patch: { floor?: productId|null, wall?: productId|null, wallColor?: '#hex' } */
  setFinish(spaceId, patch, opts = {}) {
    this._record(opts);
    this.finishes[spaceId] = { ...(this.finishes[spaceId] || {}), ...patch };
    this.emit('finishes', { ids: [spaceId], transient: !!opts.transient });
  }

  // ---------- plan edits (see core/plan-edit.js) ----------
  /** Drop finishes of rooms that no longer exist (merged away by a plan edit). Returns the dropped space ids. */
  _pruneFinishes() {
    const spaces = new Set([...PLAN.rooms, ...PLAN.outdoorAreas].map((s) => s.id));
    const gone = Object.keys(this.finishes).filter((id) => !spaces.has(id));
    for (const id of gone) delete this.finishes[id];
    if (this.ui.activeSpace && !spaces.has(this.ui.activeSpace)) this.ui.activeSpace = null;
    return gone;
  }
  /** plan-edit.js calls this right after it replaced the PLAN arrays. */
  _planChanged(payload) {
    const gone = this._pruneFinishes();
    this.emit('plan', payload);
    if (gone.length) this.emit('finishes', { ids: gone, transient: !!payload.transient });
  }

  // ---------- carpentry (see src/carpentry/, docs/CONTRACT.md § 8) ----------
  /**
   * Engine hook, not for views: apply a carpentry change prepared by src/carpentry/ as ONE undo step.
   * `change` = { carpentry, add: Item[], update: { [id]: Item }, remove: id[], reason, runIds }.
   */
  _applyCarpentry(change, opts = {}) {
    this._record(opts);
    const transient = !!opts.transient;
    this.carpentry = change.carpentry;
    const removed = (change.remove || []).filter((id) => this.getItem(id));
    if (removed.length) this.items = this.items.filter((i) => !removed.includes(i.id));
    const updated = [];
    for (const [id, next] of Object.entries(change.update || {})) {
      const i = this.items.findIndex((it) => it.id === id);
      if (i >= 0) { this.items[i] = normalizeItem(next); updated.push(id); }
    }
    const added = (change.add || []).map((p) => { const it = normalizeItem(p); this.items.push(it); return it.id; });
    if (removed.length) {
      this.selection = this.selection.filter((id) => !removed.includes(id));
      this.emit('items', { type: 'remove', ids: removed, transient });
    }
    if (updated.length) this.emit('items', { type: 'update', ids: updated, transient });
    if (added.length) this.emit('items', { type: 'add', ids: added, transient });
    if (removed.length) this.emit('selection', { ids: this.selection });
    this.emit('carpentry', { reason: change.reason, runIds: change.runIds || [], transient });
    return added;
  }

  // ---------- persistence ----------
  /** `planEdits` = { walls, openings, rooms } of an edited plan, null while the plan is the architect's. */
  serialize() {
    return { app: 'e7-interior-design', version: 1, savedAt: new Date().toISOString(), project: this.project, items: this.items, finishes: this.finishes, ui: this.ui, planEdits: planState(), carpentry: this.carpentry };
  }
  /** Replace the whole design. `data` is the output of serialize(). */
  load(data, opts = {}) {
    if (!data || !Array.isArray(data.items)) throw new Error('Not a valid design file');
    if (opts.recordUndo) this._pushUndo(this._snapshot());
    const plan = applyPlanState(data.planEdits || null);    // a file without planEdits restores the architect's plan
    const seen = new Set();
    this.items = data.items.map((raw) => {
      const item = normalizeItem(raw);
      if (seen.has(item.id)) item.id = newId();   // never allow duplicate ids from a hand-edited file
      seen.add(item.id);
      return item;
    });
    this.finishes = clone(data.finishes || {});
    this.carpentry = readCarpentry(data.carpentry);           // a file without carpentry has no runs
    this.project = { ...DEFAULT_PROJECT, ...(data.project || {}) };
    if (data.ui && opts.restoreUI) this.ui = { ...DEFAULT_UI, ...data.ui };
    this.selection = [];
    this._pruneFinishes();
    if (plan.changed.walls || plan.changed.openings || plan.changed.rooms) this.emit('plan', { reason: 'load', changed: plan.changed });
    this.emit('carpentry', { reason: 'load', runIds: Object.keys(this.carpentry.runs) });
    this.emit('load', {});
    this.emit('items', { type: 'reset', ids: this.items.map((i) => i.id) });
    this.emit('finishes', { ids: Object.keys(this.finishes) });
    this.emit('project', { keys: Object.keys(this.project) });
    this.emit('selection', { ids: [] });
    this.emit('ui', { keys: Object.keys(this.ui) });
  }
  _scheduleSave() {
    if (!this.persist || typeof localStorage === 'undefined') return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveLocal(), 400);
  }
  saveLocal() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.serialize())); } catch (e) { /* storage unavailable — design still works in memory */ } }
  /** Returns true if a saved design was restored. */
  loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      this.load(JSON.parse(raw), { restoreUI: true });
      return true;
    } catch (e) { return false; }
  }
  clearLocal() { try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ } }
}

export const store = new Store();
bindPlanHost({ record: (opts) => store._record(opts), changed: (payload) => store._planChanged(payload) });
export { DEFAULT_UI, DEFAULT_PROJECT, emptyCarpentry };
export default store;
