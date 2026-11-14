/**
 * PROJECTS — several houses, each with its own base plan, site, location and design.
 * Pure logic + storage (no DOM besides the optional browser storage). See docs/CONTRACT.md § 10.
 *
 *   import { createProjects, createLocalAdapter } from './core/projects.js';
 *   const projects = createProjects({ store, adapter: createLocalAdapter() });
 *   await projects.init();                      // migrates the old single autosave on first run, opens the last project
 *   await projects.create({ name, from: 'blank', lot: { width: 2500, depth: 2000 } });
 *   await projects.create({ name, fromPlan: buildPlan({ walls, openings }).plan });   // the sketch-import wizard
 *
 * A project = { id, name, createdAt, updatedAt, phase: 'draft' | 'fixed', builtin: boolean, basePlan, design, thumbnail?, underlay? }
 *   basePlan  complete PLAN-shaped object (plan.js shape; House 98 = the built-in plan)
 *   design    what store.serialize() returns (items, finishes, plan edits relative to basePlan, carpentry, ui…)
 *   underlay  the tracing underlay of an imported sketch (store.underlay: a JPEG / WebP data URL + image px → plan cm
 *             transform, opacity, visible) — kept beside the design, out of the undo history (CONTRACT § 12)
 *
 * STORAGE goes through an adapter — async { list() → summaries, get(id) → project | null, put(project), remove(id) } —
 * so an online backend can replace the local one without touching callers. `createLocalAdapter()` uses IndexedDB, falls
 * back to localStorage, then to memory (sandboxed iframe / private window: the app still runs, nothing is kept).
 */
import { BUILTIN_PLAN, BASE_PLAN, planPhase, isBuiltinBase } from './plan-edit.js';
import { emptyPlan, DEFAULT_HEIGHTS } from './plan-build.js';
import { initialLayout } from './initial-layout.js';
import { optionalKeysProblem, normalizeOptionalKeys } from './plan-schema.js';
import { STORAGE_KEY } from './store.js';

export const PROJECT_FILE_APP = 'e7-house-designer';
export const PROJECT_FILE_KIND = 'project';
const CURRENT_KEY = 'e7-projects/current';
const clone = (o) => JSON.parse(JSON.stringify(o));
const now = () => new Date().toISOString();
const newId = () => 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const slug = (name) => (String(name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project');

/** The summary kept in lists (no plan, no design). */
export const summaryOf = (p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, phase: p.phase || 'fixed', builtin: !!p.builtin, ...(p.thumbnail ? { thumbnail: p.thumbnail } : {}) });

/**
 * A plausible base plan (the minimum the app needs to open it). The optional schema-2 keys (schema, slants, stairs,
 * levels — plan-schema.js) may be present; when they are they must be readable.
 */
export function isPlanData(p) {
  return !!(p && typeof p === 'object' && p.meta && typeof p.meta === 'object' && p.heights && Array.isArray(p.walls) && Array.isArray(p.openings)
    && Array.isArray(p.rooms) && Array.isArray(p.wallOutline) && Array.isArray(p.outdoorAreas) && p.site && Array.isArray(p.site.boundary) && p.bounds)
    && !optionalKeysProblem(p);
}

// ---------------------------------------------------------------- adapters
/** In-memory adapter (tests, and the last fallback when the browser keeps nothing). */
export function createMemoryAdapter(seed = []) {
  const map = new Map(seed.map((p) => [p.id, clone(p)]));
  return {
    kind: 'memory',
    async list() { return [...map.values()].map(summaryOf); },
    async get(id) { return map.has(id) ? clone(map.get(id)) : null; },
    async put(project) { map.set(project.id, clone(project)); },
    async remove(id) { map.delete(id); },
  };
}

function storageOK(s) { try { const k = '__e7_probe__'; s.setItem(k, '1'); s.removeItem(k); return true; } catch (e) { return false; } }

/** localStorage adapter: an index of summaries + one key per project. */
export function createLocalStorageAdapter(storage = globalThis.localStorage, prefix = 'e7-projects/v1/') {
  const index = () => { try { const v = JSON.parse(storage.getItem(prefix + 'index') || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const writeIndex = (list) => storage.setItem(prefix + 'index', JSON.stringify(list));
  return {
    kind: 'localStorage',
    async list() { return index(); },
    async get(id) { try { const raw = storage.getItem(prefix + 'p/' + id); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } },
    async put(project) {
      storage.setItem(prefix + 'p/' + project.id, JSON.stringify(project));
      writeIndex([...index().filter((s) => s.id !== project.id), summaryOf(project)]);
    },
    async remove(id) { storage.removeItem(prefix + 'p/' + id); writeIndex(index().filter((s) => s.id !== id)); },
  };
}

/** IndexedDB adapter (two stores: full projects and their summaries). Resolves to null when IndexedDB is unusable. */
export function openIndexedDBAdapter(name = 'e7-house-designer', idb = globalThis.indexedDB, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(null), timeoutMs);
    let req;
    try { req = idb.open(name, 1); } catch (e) { finish(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('summaries')) db.createObjectStore('summaries', { keyPath: 'id' });
    };
    req.onerror = () => finish(null);
    req.onblocked = () => finish(null);
    req.onsuccess = () => {
      const db = req.result;
      const run = (stores, mode, fn) => new Promise((res, rej) => {
        let out;
        const tx = db.transaction(stores, mode);
        tx.oncomplete = () => res(out);
        tx.onerror = () => rej(tx.error || new Error('IndexedDB transaction failed'));
        tx.onabort = () => rej(tx.error || new Error('IndexedDB transaction aborted'));
        out = fn(tx);
      });
      const result = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      finish({
        kind: 'indexedDB',
        async list() { let r; await run(['summaries'], 'readonly', (tx) => { r = result(tx.objectStore('summaries').getAll()); }); return (await r) || []; },
        async get(id) { let r; await run(['projects'], 'readonly', (tx) => { r = result(tx.objectStore('projects').get(id)); }); return (await r) || null; },
        async put(project) { await run(['projects', 'summaries'], 'readwrite', (tx) => { tx.objectStore('projects').put(clone(project)); tx.objectStore('summaries').put(summaryOf(project)); }); },
        async remove(id) { await run(['projects', 'summaries'], 'readwrite', (tx) => { tx.objectStore('projects').delete(id); tx.objectStore('summaries').delete(id); }); },
      });
    };
  });
}

/**
 * The browser's own storage: IndexedDB, else localStorage, else memory. Picked lazily on the first call; `kind` tells
 * which one is in use ('pending' until then). Never throws because storage is missing.
 */
export function createLocalAdapter() {
  let picked = null;
  const pick = () => picked || (picked = (async () => {
    try { if (globalThis.indexedDB) { const a = await openIndexedDBAdapter(); if (a) { await a.list(); return a; } } } catch (e) { /* fall through */ }
    try { if (globalThis.localStorage && storageOK(globalThis.localStorage)) return createLocalStorageAdapter(globalThis.localStorage); } catch (e) { /* fall through */ }
    return createMemoryAdapter();
  })());
  const api = {
    kind: 'pending',
    async list() { const a = await pick(); api.kind = a.kind; return a.list(); },
    async get(id) { return (await pick()).get(id); },
    async put(p) { return (await pick()).put(p); },
    async remove(id) { return (await pick()).remove(id); },
  };
  return api;
}

// ---------------------------------------------------------------- the manager
const readCurrent = () => { try { return globalThis.localStorage ? globalThis.localStorage.getItem(CURRENT_KEY) : null; } catch (e) { return null; } };
const writeCurrent = (id) => { try { if (globalThis.localStorage) globalThis.localStorage.setItem(CURRENT_KEY, id); } catch (e) { /* not kept */ } };
const readLegacy = (key) => { try { const raw = globalThis.localStorage ? globalThis.localStorage.getItem(key) : null; return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };

/** The built-in house's starting design: the architect's furniture (exactly what a first visit got before projects). */
export const builtinDesign = () => ({ items: initialLayout() });

/**
 * @param {{ store: object, adapter?: object, legacyKey?: string }} o
 * @returns the project manager (see docs/CONTRACT.md § 10)
 */
export function createProjects({ store, adapter = createMemoryAdapter(), legacyKey = STORAGE_KEY } = {}) {
  let current = null;            // the open project's record without design (basePlan / design live in the store)
  let online = null;             // summary of the open ONLINE project (live collaboration, CONTRACT § 13) — never saved here
  let saving = Promise.resolve();
  let lastError = null;
  const listeners = new Set();
  const emit = (type, detail = {}) => listeners.forEach((fn) => { try { fn({ type, ...detail }); } catch (e) { console.error('[projects] listener failed', e); } });

  /** A full record of the open project as it is now. */
  function snapshot() {
    const design = store.serialize();
    const { online: _o, role: _r, ...open } = current || online;   // an online project can be exported / duplicated as a local copy too
    const rec = { ...open, name: store.project.name || open.name, updatedAt: now(), phase: planPhase(), builtin: isBuiltinBase(), basePlan: clone(BASE_PLAN), design };
    if (store.underlay) rec.underlay = store.underlay;   // immutable once set (setUnderlay replaces the object): no copy needed
    return rec;
  }
  /** Save the open project now (autosave calls this). Resolves when stored; storage errors are reported, not thrown. */
  function save() {
    if (!current) return saving;
    const rec = snapshot();
    current = { ...summaryOf(rec) };
    saving = saving.then(() => adapter.put(rec)).then(() => {
      if (lastError) { lastError = null; emit('saved', { ok: true }); }
    }, (err) => {
      lastError = 'Your changes could not be saved in this browser (storage is full or blocked). Export the project to keep it.';
      emit('error', { message: lastError, error: err });
    });
    return saving;
  }
  /** Finish a pending autosave of the open project before something else happens. */
  async function flush() { if (store.savePending) { clearTimeout(store._saveTimer); store._saveTimer = null; await save(); } else await saving; }

  async function put(rec) { await adapter.put(rec); return summaryOf(rec); }

  const api = {
    adapter,
    /** Summary of the open project ({ id, name, createdAt, updatedAt, phase, builtin }) or null. */
    current: () => (current ? { ...current } : online ? { ...online } : null),
    /** Last storage problem (plain English) or null. */
    lastError: () => lastError,
    /** Subscribe: { type: 'open' | 'list' | 'error' | 'saved', … }. Returns unsubscribe. */
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /**
     * First run: if no project exists, migrate the old single autosave (localStorage `legacyKey`) into a project named
     * after the built-in house (the old key is left untouched as a backup), or start the built-in house with the
     * architect's furniture. Then open the last used project. Wires the store's autosave to this project.
     */
    async init() {
      let list = [];
      try { list = await adapter.list(); } catch (e) { list = []; }
      if (!list.length) {
        const legacy = readLegacy(legacyKey);
        const design = legacy && Array.isArray(legacy.items) ? legacy : builtinDesign();
        const name = (legacy && legacy.project && legacy.project.name) || BUILTIN_PLAN.meta.name;
        const rec = { id: newId(), name, createdAt: now(), updatedAt: now(), phase: 'fixed', builtin: true, basePlan: clone(BUILTIN_PLAN), design, ...(legacy ? { migratedFrom: legacyKey } : {}) };
        try { await adapter.put(rec); list = [summaryOf(rec)]; } catch (e) { list = []; }
        if (!list.length) { await openRecord(rec, { restoreUI: !!legacy }); return api.current(); }
      }
      const want = readCurrent();
      const pickId = list.some((s) => s.id === want) ? want : [...list].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0].id;
      const ok = await api.open(pickId, { skipFlush: true });
      if (!ok) {
        for (const s of list) if (s.id !== pickId && await api.open(s.id, { skipFlush: true })) return api.current();
        await openRecord({ id: newId(), name: BUILTIN_PLAN.meta.name, createdAt: now(), updatedAt: now(), phase: 'fixed', builtin: true, basePlan: clone(BUILTIN_PLAN), design: builtinDesign() });
      }
      return api.current();
    },

    /** All projects (summaries), most recently changed first. */
    async list() {
      let list = [];
      try { list = await adapter.list(); } catch (e) { list = []; }
      if (current && !list.some((s) => s.id === current.id)) list.push(current);   // memory-only current project
      return list.map((s) => (current && s.id === current.id ? { ...s, name: store.project.name || s.name } : s))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },

    /** Open a project by id (saves the open one first). Resolves true when it opened. */
    async open(id, { skipFlush = false } = {}) {
      if (!skipFlush) await flush();
      let rec = null;
      try { rec = await adapter.get(id); } catch (e) { rec = null; }
      if (!rec || !isPlanData(rec.basePlan)) { emit('error', { message: 'That project could not be read.' }); return false; }
      await openRecord(rec);
      return true;
    },

    /**
     * Create a project and (by default) open it.
     * @param {{ name?: string,
     *   from?: 'blank' | 'house98' | 'plan' | 'file',
     *   fromPlan?: object,          // a complete plan (plan-build.js buildPlan().plan) → phase 'draft' unless `phase` says otherwise
     *   phase?: 'draft' | 'fixed',
     *   lot?: { width, depth },     // cm, 'blank' only (default 25 × 20 m)
     *   location?: { name?, latitude, longitude, timeZone? }, northAngle?: number, ceiling?: number,   // 'blank' only (ceiling: also 'house98')
     *   file?: string | object,     // 'file': a project file (or an old design file)
     *   design?: object, open?: boolean,
     *   underlay?: object }} opts   // tracing underlay (store.underlay shape), e.g. the imported sketch
     * @returns {Promise<{ ok: boolean, project?: object, reason?: string }>}
     */
    async create(opts = {}) {
      const from = opts.fromPlan ? 'plan' : opts.from || 'blank';
      if (from === 'file') return api.importFile(opts.file, { open: opts.open });
      const name = String(opts.name || '').trim() || (from === 'house98' ? `Copy of ${BUILTIN_PLAN.meta.name}` : 'New house');
      let basePlan, phase, design;
      if (from === 'plan') {
        if (!isPlanData(opts.fromPlan)) return { ok: false, reason: 'The plan is incomplete — build it with buildPlan() first.' };
        basePlan = clone(opts.fromPlan); phase = opts.phase === 'fixed' ? 'fixed' : 'draft';
        design = opts.design || { items: [], project: { ceilingHeight: basePlan.heights.ceiling } };
      } else if (from === 'house98') {
        basePlan = clone(BUILTIN_PLAN); phase = 'fixed';
        design = opts.design || { ...builtinDesign(), project: { ceilingHeight: opts.ceiling > 0 ? Math.round(opts.ceiling) : BUILTIN_PLAN.heights.ceiling } };
      } else {
        const loc = opts.location || {};
        const ceiling = opts.ceiling > 0 ? Math.round(opts.ceiling) : DEFAULT_HEIGHTS.ceiling;
        basePlan = emptyPlan({
          meta: { name, location: loc.name || '', latitude: loc.latitude, longitude: loc.longitude, timeZone: loc.timeZone, northAngle: opts.northAngle },
          heights: { ...DEFAULT_HEIGHTS, ceiling },
          lot: opts.lot && opts.lot.width > 0 && opts.lot.depth > 0 ? opts.lot : { width: 2500, depth: 2000 },
        });
        phase = 'draft';
        design = opts.design || { items: [], project: { ceilingHeight: ceiling } };
      }
      design = { ...design, project: { ...(design.project || {}), name } };
      const rec = { id: newId(), name, createdAt: now(), updatedAt: now(), phase, builtin: from === 'house98', basePlan, design };
      if (opts.underlay && typeof opts.underlay.image === 'string') rec.underlay = { opacity: 0.5, visible: true, ...opts.underlay };
      try { await put(rec); } catch (e) { if (opts.open === false) return { ok: false, reason: 'The project could not be stored in this browser.' }; }
      if (opts.open !== false) { await flush(); await openRecord(rec); }
      emit('list');
      return { ok: true, project: summaryOf(rec) };
    },

    /** Rename a project (the open one too). */
    async rename(id, name) {
      const n = String(name || '').trim();
      if (!n) return { ok: false, reason: 'A project needs a name.' };
      if (online && id === online.id) {               // online: the name is part of the shared design
        store.setProject({ name: n });
        online = { ...online, name: n };
      } else if (current && id === current.id) {
        store.setProject({ name: n }, { transient: true });
        current = { ...current, name: n };
        await save();
      } else {
        const rec = await adapter.get(id);
        if (!rec) return { ok: false, reason: 'No such project.' };
        rec.name = n; rec.updatedAt = now();
        if (rec.design && rec.design.project) rec.design.project.name = n;
        await put(rec);
      }
      emit('list');
      return { ok: true };
    },

    /** Copy a project (not opened). */
    async duplicate(id, { open = false } = {}) {
      if (current && id === current.id) await flush();
      const src = (current || online) && id === (current || online).id ? snapshot() : await adapter.get(id);
      if (!src) return { ok: false, reason: 'No such project.' };
      const name = `${src.name} (copy)`;
      const rec = { ...clone(src), id: newId(), name, createdAt: now(), updatedAt: now() };
      if (rec.design && rec.design.project) rec.design.project.name = name;
      try { await put(rec); } catch (e) { return { ok: false, reason: 'The copy could not be stored in this browser.' }; }
      if (open) { await flush(); await openRecord(rec); }
      emit('list');
      return { ok: true, project: summaryOf(rec) };
    },

    /** Delete a project. Deleting the open one opens the most recent other one (or a fresh built-in house). */
    async remove(id) {
      if (current && id === current.id) { clearTimeout(store._saveTimer); store._saveTimer = null; current = null; }
      await saving;
      try { await adapter.remove(id); } catch (e) { return { ok: false, reason: 'The project could not be deleted.' }; }
      if (!current) {
        const rest = await api.list();
        let opened = false;
        for (const s of rest) if (await api.open(s.id, { skipFlush: true })) { opened = true; break; }
        if (!opened) await api.create({ from: 'house98', name: BUILTIN_PLAN.meta.name, design: builtinDesign() });
      }
      emit('list');
      return { ok: true };
    },

    /** One file with everything: { filename, text } (JSON). */
    async exportFile(id = current && current.id) {
      if (current && id === current.id) await flush();
      const rec = (current || online) && id === (current || online).id ? snapshot() : await adapter.get(id);
      if (!rec) return { ok: false, reason: 'No such project.' };
      const file = { app: PROJECT_FILE_APP, kind: PROJECT_FILE_KIND, version: 1, exportedAt: now(), project: rec };
      return { ok: true, filename: `${slug(rec.name)}.e7project.json`, text: JSON.stringify(file) };
    },

    /**
     * Import a project file (or a design file saved by an earlier version — it becomes a project on the built-in house).
     * Always a NEW project (new id). Opens it unless `open: false`.
     */
    async importFile(textOrObject, { open = true } = {}) {
      let data = textOrObject;
      try { if (typeof data === 'string') data = JSON.parse(data); } catch (e) { return { ok: false, reason: 'This is not a project file — it could not be read.' }; }
      let rec;
      if (data && data.app === PROJECT_FILE_APP && data.project && isPlanData(data.project.basePlan)) {
        const p = data.project;
        rec = { ...clone(p), id: newId(), name: String(p.name || 'Imported project'), createdAt: p.createdAt || now(), updatedAt: now(), phase: p.phase === 'draft' ? 'draft' : 'fixed', design: p.design && Array.isArray(p.design.items) ? p.design : { items: [] } };
        rec.builtin = JSON.stringify(normalizeOptionalKeys(clone(rec.basePlan))) === JSON.stringify(BUILTIN_PLAN);
      } else if (data && Array.isArray(data.items)) {
        const name = (data.project && data.project.name) || BUILTIN_PLAN.meta.name;
        rec = { id: newId(), name, createdAt: now(), updatedAt: now(), phase: 'fixed', builtin: true, basePlan: clone(BUILTIN_PLAN), design: data };
      } else return { ok: false, reason: 'This is not a project or design file saved from this app.' };
      try { await put(rec); } catch (e) { if (!open) return { ok: false, reason: 'The project could not be stored in this browser.' }; }
      if (open) { await flush(); await openRecord(rec); }
      emit('list');
      return { ok: true, project: summaryOf(rec) };
    },

    /**
     * Live collaboration (src/collab/online.js, CONTRACT § 13): an online project is about to be opened into the store by
     * its room. Local saving stops (the room keeps it) until a local project is opened again. Emits 'closing' then 'open'.
     */
    detachForOnline(summary) {
      clearTimeout(store._saveTimer); store._saveTimer = null;
      emit('closing', {});
      current = null; online = { ...summary, online: true };
    },
    /** Announce the online project once its room has opened it. */
    onlineOpened(summary) { online = { ...(online || {}), ...summary, online: true }; emit('open', { project: api.current() }); },

    /** Save the open project now. */
    save,
    flush,
  };

  async function openRecord(rec, { restoreUI = true } = {}) {
    const design = rec.design && Array.isArray(rec.design.items) ? rec.design : { items: [] };
    emit('closing', {});            // an online session (src/collab/) lets go of the store before it is replaced
    online = null;
    current = summaryOf(rec);
    store.openProject({ basePlan: rec.basePlan, phase: rec.phase === 'draft' ? 'draft' : 'fixed', design: restoreUI ? design : { ...design, ui: undefined }, name: rec.name, underlay: rec.underlay || null });
    writeCurrent(rec.id);
    emit('open', { project: api.current() });
  }

  store.saver = () => { save(); };
  return api;
}
