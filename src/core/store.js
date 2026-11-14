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
 *   'plan'       { reason, changed: { walls, openings, rooms, levels }, transient?, levelId? }
 *                                            – PLAN.walls / openings / rooms / wallOutline were REPLACED (core/plan-edit.js,
 *                                              undo / redo, load). reason: 'add-wall' | 'remove-wall' | 'move-wall' |
 *                                              'resize-wall' | 'add-opening' | 'update-opening' | 'remove-opening' |
 *                                              'update-room' | 'add-level' | 'remove-level' | 'update-level' | 'reset' | 'history' |
 *                                              'load' | 'base' (another project's base plan:
 *                                              EVERY part of PLAN was replaced, site and meta too) | 'phase' (draft ↔ fixed).
 *                                              `changed.levels`: PLAN.levels (upper floors) changed — an edit on an upper
 *                                              level changes only that (with `levelId` = the level edited).
 *                                              Rebuild everything drawn from PLAN.
 *   'carpentry'  { reason, runIds, transient? }  – store.carpentry (made-to-measure runs, src/carpentry/) changed.
 *                                              reason: an engine reason ('create-run', 'layout', 'adopt', …) | 'history' | 'load'
 *   'history'    { canUndo, canRedo }
 *   'load'       {}                          – whole design replaced (file open / reset)
 *   'base'       {}                          – another project was opened (store.openProject): base plan, site, location
 *                                              and design all replaced, history cleared. Emitted LAST, after 'plan' / 'load' /
 *                                              … — views that captured the site or the sun at creation are rebuilt on it.
 *   'underlay'   { reason, transient }       – the tracing underlay (store.underlay) was set, changed or removed
 *   'products'   { type: 'add' | 'update' | 'remove' | 'reset', ids }
 *                                            – the project's own products (store.customProducts, CONTRACT § 16) changed.
 *                                              The catalogue (setOwnProducts) is already up to date when it is emitted.
 *   '*'          (eventName, payload)        – everything
 *
 * PERSISTENCE
 *   Autosave is debounced (400 ms). With `store.saver = fn` set (src/core/projects.js does) it calls `fn()` — the
 *   current project is saved through the project storage; without it the design goes to the legacy localStorage key.
 *
 * HISTORY
 *   Every mutating call records one undo step, except calls with { transient: true } (used while dragging).
 *   Wrap a drag as: store.begin(); …updateItem(id, patch, { transient: true })…; store.commit('Move');
 *   Plan edits (core/plan-edit.js) are part of the same history: every snapshot also holds the edited plan
 *   ({ walls, openings, rooms }, or null while the plan is the architect's), so undo / redo / cancel restore it.
 */
import { PLAN } from './plan.js';
import { spaceAt } from './geometry.js';
import { bindPlanHost, planState, planStateKey, applyPlanState, setBasePlan, setPlanPhase as setEnginePhase, levelPlan, setActiveLevel, activeLevel } from './plan-edit.js';
import { GROUND, upperLevels, levelOf } from './levels.js';
import { setOwnProducts } from '../catalog/index.js';
import { normalizeOwnProduct, ownOrder, itemPatchFromProduct, ownItemFix, GENERIC_PATCH } from '../catalog/own.js';

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
  if ('level' in item && !(typeof item.level === 'string' && item.level)) delete item.level;   // optional: absent = ground level (L0)
  return item;
}

/** Did any part of the plan change? (`changed` of an engine result / 'plan' event) */
const planChanged = (c) => !!(c && (c.walls || c.openings || c.rooms || c.levels));

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
  lights: 'auto',          // 3D placed lamps: 'auto' (on when the sun is down) | 'on' | 'off' — lit lamps are solved with the daylight
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
  // ── carpentry (made-to-measure runs) — see docs/CONTRACT.md § 8; ui.tool 'carpentry' = Carpentry mode ──
  carpentrySel: null,      // { runId, unitId? } — the run / unit selected in Carpentry mode
  carpentryTier: null,     // null (each run's suggested tier) | 'basic' | 'mid' | 'premium' — estimate tier override
  carpentryTab: 'run',     // Carpentry inspector tab: 'run' | 'unit' | 'checks' | 'estimate' | 'quantities'
  // ── levels (several floors, docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md) — not used yet (features.js levels: false) ──
  level: 'L0',             // the level shown / edited in 2D ('L0' = ground floor, 'L1'… = PLAN.levels[i].id)
  ghostBelow: true,        // 2D: draw the level below faintly under the active one
};
/** UI keys left out of a saved design while they hold their default (so designs saved before them stay byte-identical). */
const UI_SAVED_ONLY_IF_SET = ['level', 'ghostBelow'];
const uiForSave = (ui) => {
  if (UI_SAVED_ONLY_IF_SET.every((k) => ui[k] !== DEFAULT_UI[k])) return ui;
  const out = { ...ui };
  for (const k of UI_SAVED_ONLY_IF_SET) if (out[k] === DEFAULT_UI[k]) delete out[k];
  return out;
};

const DEFAULT_PROJECT = {
  name: PLAN.meta.name,
  ceilingHeight: PLAN.heights.ceiling, // cm
  roof: 'flat',
  wallColor: '#f4f1ea',     // default interior wall paint
  exteriorColor: '#efece6', // exterior render
  frameColor: '#2b2d31',    // window / door frames (dark aluminium)
};
/** Project defaults for the plan that is open now (DEFAULT_PROJECT is the built-in house's). */
const defaultProject = () => ({ ...DEFAULT_PROJECT, name: PLAN.meta.name, ceilingHeight: PLAN.heights.ceiling });


/** A project's upper-floor underlays ({ L1: underlay, … }) as stored, or null: only entries with a picture are kept. */
function upperUnderlays(map) {
  if (!map || typeof map !== 'object') return null;
  const out = {};
  for (const [k, u] of Object.entries(map)) if (/^L[1-9]\d*$/.test(k) && u && typeof u.image === 'string') out[k] = { ...u };
  return Object.keys(out).length ? out : null;
}

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
    /** Large reference images of carpentry special requirements { [imageId]: dataUrl } — saved, but kept out of undo history. */
    this.carpentryImages = {};
    /**
     * Tracing underlay of the open project (an imported sketch under the 2D plan) or null:
     * { image: dataUrl (JPEG / WebP), width, height (px), transform: [a, b, c, d, e, f] image px → plan cm, opacity 0…1,
     *   visible, source?: { kind: 'pdf' | 'image', name, page } }. Saved with the project record (core/projects.js), never
     * part of the design, the undo history or exports. Change it with setUnderlay().
     */
    this.underlay = null;
    /**
     * Tracing underlays of the upper floors (stage F8, a project imported with several floors): { L1: underlay, … } in
     * the same shape as `underlay` (which stays the ground floor's), or null. Read one with underlayOf(levelId); change
     * it with setUnderlay(…, { level }). Saved with the project record (`underlays`) only when there is one.
     */
    this.underlays = null;
    /**
     * The project's own products ("Add your own product", CONTRACT § 16): catalogue-shaped products with ids 'own-…',
     * kept in canonical order (createdAt, id). Part of the design (saved only when there is at least one) and of the
     * undo history; registered with the catalogue on every change. Change them with add / update / removeCustomProduct.
     */
    this.customProducts = [];
    this._listeners = new Map();
    this._undo = [];
    this._redo = [];
    this._batch = null;
    this._saveTimer = null;
    this.persist = true;
    /** Autosave target (set by core/projects.js); null = the legacy single-design localStorage key. */
    this.saver = null;
    /**
     * Live collaboration hook (src/collab/, CONTRACT § 13) or null: { undo(), redo(), historyState(), batchEnded(),
     * planIntent(name, args) }. While set, undo / redo are per person (the collaboration client's own stacks).
     */
    this.collab = null;
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
  /** Room / outdoor area / garden an item's centre sits in — on the item's own level (`item.level`, absent = L0). */
  spaceOf(item) {
    if (!item.level || item.level === GROUND) return spaceAt(item.x, item.y);
    const plan = levelPlan(PLAN, item.level);
    return plan ? spaceAt(item.x, item.y, plan) : null;
  }
  /** Space ids (rooms and outdoor areas) of every level. */
  _spaceIds() {
    const ids = new Set([...PLAN.rooms, ...PLAN.outdoorAreas].map((s) => s.id));
    for (const l of upperLevels(PLAN)) { const v = levelPlan(PLAN, l.id); for (const s of [...v.rooms, ...v.outdoorAreas]) ids.add(s.id); }
    return ids;
  }
  /**
   * `ui.level` must name a level of the open plan: an unknown one (another project, a level removed by undo or by
   * someone else) falls back to 'L0'. Silent (like activeSpace). `push`: the plan engine's active level follows ui.level
   * (setUI, load); otherwise the engine keeps its own (it falls back to L0 by itself when its level goes).
   */
  _syncLevel(push = false) {
    if (this.ui.level !== GROUND && !levelOf(PLAN, this.ui.level)) this.ui.level = GROUND;
    if (push && activeLevel() !== this.ui.level) setActiveLevel(this.ui.level);
  }

  // ---------- history ----------
  _snapshot() { return `{"items":${JSON.stringify(this.items)},"finishes":${JSON.stringify(this.finishes)},"project":${JSON.stringify(this.project)},"plan":${planStateKey()},"carpentry":${JSON.stringify(this.carpentry)}${this.customProducts.length ? `,"customProducts":${JSON.stringify(this.customProducts)}` : ''}}`; }
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
    if (this.collab) this.collab.batchEnded();
  }
  /** Abort a gesture and restore the state from begin(). */
  cancel() {
    if (!this._batch) return;
    const before = this._batch; this._batch = null;
    this._restore(before);
    if (this.collab) this.collab.batchEnded();
  }
  historyState() { return this.collab ? this.collab.historyState() : { canUndo: this._undo.length > 0, canRedo: this._redo.length > 0 }; }
  _restore(snap) {
    const s = JSON.parse(snap);
    const plan = applyPlanState(s.plan || null);            // no-op unless the snapshot holds a different plan
    const carp = readCarpentry(s.carpentry), carpChanged = JSON.stringify(carp) !== JSON.stringify(this.carpentry);
    this.items = s.items; this.finishes = s.finishes || {}; this.project = { ...defaultProject(), ...s.project };
    this.carpentry = carp;
    const prodChanged = this._setCustomProducts(s.customProducts || []);
    this.selection = this.selection.filter((id) => this.getItem(id));
    this._syncLevel();
    if (planChanged(plan.changed)) this.emit('plan', { reason: 'history', changed: plan.changed });
    if (carpChanged) this.emit('carpentry', { reason: 'history', runIds: Object.keys(carp.runs) });
    if (prodChanged) this.emit('products', { type: 'reset', ids: this.customProducts.map((p) => p.id) });
    this.emit('items', { type: 'reset', ids: this.items.map((i) => i.id) });
    this.emit('finishes', { ids: Object.keys(this.finishes) });
    this.emit('project', { keys: Object.keys(this.project) });
    this.emit('selection', { ids: this.selection });
  }
  undo() {
    if (this.collab) { this.collab.undo(); return; }
    if (!this._undo.length) return;
    this._redo.push(this._snapshot());
    this._restore(this._undo.pop());
    this.emit('history', this.historyState());
  }
  redo() {
    if (this.collab) { this.collab.redo(); return; }
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
    if ('level' in patch && patch.level !== GROUND && !levelOf(PLAN, patch.level)) patch = { ...patch, level: GROUND };
    const keys = Object.keys(patch).filter((k) => this.ui[k] !== patch[k]);
    if (!keys.length) return;
    Object.assign(this.ui, patch);
    if (keys.includes('level')) this._syncLevel(true);
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
  /**
   * What stands on an upper level (plan-edit removeLevel asks before removing it): item ids with that `level`, carpentry
   * run ids with that `level`, finishes of its rooms (`roomIds`).
   */
  _levelContent(id, roomIds = []) {
    const runs = Object.values((this.carpentry && this.carpentry.runs) || {}).filter((r) => r && r.level === id).map((r) => r.id);
    return { items: this.items.filter((i) => i.level === id).map((i) => i.id), runs, finishes: roomIds.filter((r) => this.finishes[r]) };
  }
  /** Drop finishes of rooms that no longer exist (merged away by a plan edit). Returns the dropped space ids. */
  _pruneFinishes() {
    const spaces = upperLevels(PLAN).length ? this._spaceIds() : new Set([...PLAN.rooms, ...PLAN.outdoorAreas].map((s) => s.id));
    const gone = Object.keys(this.finishes).filter((id) => !spaces.has(id));
    for (const id of gone) delete this.finishes[id];
    if (this.ui.activeSpace && !spaces.has(this.ui.activeSpace)) this.ui.activeSpace = null;
    return gone;
  }
  /** plan-edit.js calls this right after it replaced the PLAN arrays. */
  _planChanged(payload) {
    this._syncLevel();
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

  // ---------- own products (CONTRACT § 16) ----------
  /**
   * Replace the own products (sanitised, canonical order) and register them with the catalogue. No event, no history.
   * Returns true when the list changed.
   */
  _setCustomProducts(list) {
    const seen = new Set();
    const next = (Array.isArray(list) ? list : []).map(normalizeOwnProduct).filter((p) => p && !seen.has(p.id) && seen.add(p.id)).sort(ownOrder);
    const changed = JSON.stringify(next) !== JSON.stringify(this.customProducts);
    this.customProducts = next;
    setOwnProducts(next);
    return changed;
  }
  getCustomProduct(id) { return this.customProducts.find((p) => p.id === id) || null; }
  /** Items placed from an own product (ids). */
  itemsOfProduct(id) { return this.items.filter((i) => i.productId === id).map((i) => i.id); }
  /** Space ids whose floor / wall finish is an own product: [{ spaceId, kind }]. */
  _finishesOfProduct(id) {
    const out = [];
    for (const [spaceId, f] of Object.entries(this.finishes)) for (const kind of ['floor', 'wall']) if (f && f[kind] === id) out.push({ spaceId, kind });
    return out;
  }
  /**
   * Add an own product (one undo step). `opts.linkItem` = id of a placed item that becomes this product (its size,
   * look, price and link; position stays) in the same step. Returns the stored product, or null if it is not valid.
   */
  addCustomProduct(product, opts = {}) {
    const p = normalizeOwnProduct(product);
    if (!p || this.getCustomProduct(p.id)) return null;
    this._record(opts);
    this._setCustomProducts([...this.customProducts, p]);
    this.emit('products', { type: 'add', ids: [p.id] });
    const link = opts.linkItem && this.getItem(opts.linkItem);
    if (link) {
      Object.assign(link, itemPatchFromProduct(p));
      this.emit('items', { type: 'update', ids: [link.id], keys: Object.keys(itemPatchFromProduct(p)) });
    }
    return this.getCustomProduct(p.id);
  }
  /**
   * Replace an own product with its edited version (same id) — one undo step. Every item placed from it takes the new
   * name, look, size, price and link (position, rotation, elevation, level, lock, note stay).
   */
  updateCustomProduct(id, product, opts = {}) {
    const prev = this.getCustomProduct(id);
    const p = normalizeOwnProduct({ ...product, id, createdAt: prev ? prev.createdAt : product.createdAt });
    if (!prev || !p) return null;
    this._record(opts);
    this._setCustomProducts(this.customProducts.map((x) => (x.id === id ? p : x)));
    this.emit('products', { type: 'update', ids: [id] });
    const ids = this.itemsOfProduct(id);
    const patch = itemPatchFromProduct(this.getCustomProduct(id));
    for (const iid of ids) Object.assign(this.getItem(iid), JSON.parse(JSON.stringify(patch)));
    if (ids.length) this.emit('items', { type: 'update', ids, keys: Object.keys(patch) });
    if (this._finishesOfProduct(id).length) this.emit('finishes', { ids: this._finishesOfProduct(id).map((f) => f.spaceId) });
    return this.getCustomProduct(id);
  }
  /**
   * Delete an own product — one undo step. Items placed from it stay in the plan as generic items with their size;
   * rooms that used it as a finish go back to the built-in default. Returns { items: n, finishes: n } or null.
   */
  removeCustomProduct(id, opts = {}) {
    if (!this.getCustomProduct(id)) return null;
    this._record(opts);
    const ids = this.itemsOfProduct(id), fins = this._finishesOfProduct(id);
    this._setCustomProducts(this.customProducts.filter((p) => p.id !== id));
    for (const iid of ids) Object.assign(this.getItem(iid), GENERIC_PATCH);
    for (const { spaceId, kind } of fins) this.finishes[spaceId] = { ...this.finishes[spaceId], [kind]: null };
    this.emit('products', { type: 'remove', ids: [id] });
    if (ids.length) this.emit('items', { type: 'update', ids, keys: Object.keys(GENERIC_PATCH) });
    if (fins.length) this.emit('finishes', { ids: [...new Set(fins.map((f) => f.spaceId))] });
    return { items: ids.length, finishes: fins.length };
  }
  /**
   * Bring placed items in line with the own products (after someone else's change arrived — live collaboration):
   * an item whose own product is gone becomes generic (size kept); an item whose product's price / link / shop changed
   * takes the new values. One undo step when anything changed; returns the ids changed.
   */
  syncOwnItems(opts = {}) {
    const byId = new Map(this.customProducts.map((p) => [p.id, p]));
    const fixes = [];
    for (const it of this.items) { const f = ownItemFix(it, byId); if (f) fixes.push([it.id, f]); }
    if (!fixes.length) return [];
    this._record(opts);
    for (const [iid, f] of fixes) Object.assign(this.getItem(iid), f);
    this.emit('items', { type: 'update', ids: fixes.map(([i]) => i), keys: [...new Set(fixes.flatMap(([, f]) => Object.keys(f)))] });
    return fixes.map(([i]) => i);
  }

  // ---------- persistence ----------
  /**
   * `planEdits` = { walls, openings, rooms } of an edited plan (+ the optional schema-2 keys schema / slants / stairs /
   * levels when the plan carries them), null while the plan is the architect's.
   */
  serialize() {
    const out = { app: 'e7-interior-design', version: 1, savedAt: new Date().toISOString(), project: this.project, items: this.items, finishes: this.finishes, ui: uiForSave(this.ui), planEdits: planState(), carpentry: this.carpentry, carpentryImages: this.carpentryImages };
    if (this.customProducts.length) out.customProducts = this.customProducts;   // only when there is one: older designs stay byte-identical
    return out;
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
    this.carpentryImages = data.carpentryImages && typeof data.carpentryImages === 'object' ? { ...data.carpentryImages } : {};
    this._setCustomProducts(data.customProducts);            // a file without customProducts has none
    this.project = { ...defaultProject(), ...(data.project || {}) };
    if (data.ui && opts.restoreUI) this.ui = { ...DEFAULT_UI, ...data.ui };
    this._syncLevel(true);
    this.selection = [];
    this._pruneFinishes();
    if (opts.base) this.emit('plan', { reason: 'base', changed: { walls: true, openings: true, rooms: true, levels: true } });
    else if (planChanged(plan.changed)) this.emit('plan', { reason: 'load', changed: plan.changed });
    this.emit('carpentry', { reason: 'load', runIds: Object.keys(this.carpentry.runs) });
    this.emit('products', { type: 'reset', ids: this.customProducts.map((p) => p.id) });
    this.emit('load', {});
    this.emit('items', { type: 'reset', ids: this.items.map((i) => i.id) });
    this.emit('finishes', { ids: Object.keys(this.finishes) });
    this.emit('project', { keys: Object.keys(this.project) });
    this.emit('selection', { ids: [] });
    this.emit('ui', { keys: Object.keys(this.ui) });
  }
  _scheduleSave() {
    if (!this.persist || (!this.saver && typeof localStorage === 'undefined')) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => { this._saveTimer = null; if (this.saver) this.saver(); else this.saveLocal(); }, 400);
  }
  /** True while an autosave is waiting to run. */
  get savePending() { return !!this._saveTimer; }

  // ---------- projects (see core/projects.js) ----------
  /**
   * Open another project in place: replace the base plan (`basePlan`, phase 'draft' | 'fixed'), then the whole design
   * (`design` = what serialize() returned, or nothing for an empty one), clear selection and undo history, and reset the
   * per-session UI state (structure / carpentry selection, active room, walk mode). Emits 'plan' { reason: 'base' }, the
   * usual 'load' events, then 'base'. Never autosaves by itself.
   */
  openProject({ basePlan, phase = 'fixed', design, name, underlay = null, underlays = null } = {}) {
    clearTimeout(this._saveTimer); this._saveTimer = null;
    const persist = this.persist;
    this.persist = false;
    try {
      this._undo = []; this._redo = []; this._batch = null;
      this.underlay = underlay && typeof underlay.image === 'string' ? { ...underlay } : null;
      this.underlays = upperUnderlays(underlays);
      if (basePlan) setBasePlan(basePlan, { phase });
      const data = design && Array.isArray(design.items) ? design : { items: [] };
      const project = { ...(data.project || {}), ...(name ? { name } : {}) };
      const ui = { ...(data.ui || this.ui), structureSel: null, carpentrySel: null, activeSpace: null };
      if (ui.mode === 'walk') ui.mode = '3d';
      this.load({ ...data, project, ui }, { restoreUI: true, base: true });
      this.emit('history', this.historyState());
      this.emit('underlay', { reason: 'open' });
      this.emit('base', {});
    } finally { this.persist = persist; }
  }
  /**
   * 'draft' (the existing house is still being drawn: everything editable, no permit warnings, no changes list) |
   * 'fixed' ("this is the house as built": the current plan becomes the base plan and the permission levels and the
   * changes list apply relative to it). Clears the undo history (old steps refer to the other base). Returns true if changed.
   */
  setPlanPhase(phase) {
    if (!setEnginePhase(phase).changed) return false;
    this._undo = []; this._redo = []; this._batch = null;
    const gone = this._pruneFinishes();
    this.emit('plan', { reason: 'phase', changed: { walls: true, openings: true, rooms: true, levels: true } });
    if (gone.length) this.emit('finishes', { ids: gone });
    this.emit('history', this.historyState());
    return true;
  }
  /**
   * Set (object), change (`patch` merged into the current one) or remove (null) the tracing underlay. Not undoable;
   * autosaves unless `opts.transient` (e.g. while an opacity slider is dragged). Emits 'underlay' { reason }.
   */
  setUnderlay(next, opts = {}) {
    const lv = opts.level && opts.level !== 'L0' ? String(opts.level) : null;
    if (lv) {
      // an upper floor's underlay (stage F8): the same rules on store.underlays[level]
      const cur = this.underlays && this.underlays[lv] ? this.underlays[lv] : null;
      let val;
      if (next == null) val = null;
      else if (opts.replace || !cur) val = typeof next.image === 'string' ? { opacity: 0.5, visible: true, ...next } : cur;
      else val = { ...cur, ...next };
      const map = { ...(this.underlays || {}) };
      if (val) map[lv] = val; else delete map[lv];
      this.underlays = Object.keys(map).length ? map : null;
      this.emit('underlay', { reason: next == null ? 'remove' : 'change', transient: !!opts.transient, level: lv });
      return;
    }
    if (next == null) this.underlay = null;
    else if (opts.replace || !this.underlay) this.underlay = typeof next.image === 'string' ? { opacity: 0.5, visible: true, ...next } : this.underlay;
    else this.underlay = { ...this.underlay, ...next };
    this.emit('underlay', { reason: next == null ? 'remove' : 'change', transient: !!opts.transient });
  }
  /** The tracing underlay of floor `levelId` ('L0' / absent = `underlay`, an upper floor from `underlays`) or null. */
  underlayOf(levelId) {
    if (!levelId || levelId === 'L0') return this.underlay;
    return (this.underlays && this.underlays[levelId]) || null;
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
bindPlanHost({ record: (opts) => store._record(opts), changed: (payload) => store._planChanged(payload), content: (id, roomIds) => store._levelContent(id, roomIds), intent: (name, args) => { if (store.collab && store.collab.planIntent) store.collab.planIntent(name, args); } });
export { DEFAULT_UI, DEFAULT_PROJECT, defaultProject, emptyCarpentry, normalizeItem, STORAGE_KEY };
export default store;
