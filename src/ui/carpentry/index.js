/**
 * Carpentry mode — the workspace where the owner designs made-to-measure carpentry (kitchen, island, wardrobes, pantry,
 * vanities…) as runs of units, on top of the engine in src/carpentry/ (docs/CONTRACT.md § 8).
 *
 * The app is in Carpentry mode whenever `store.ui.tool === 'carpentry'` (a sibling of Structure mode; Plan and Split
 * only). This module owns the mode itself, the selection (`store.ui.carpentrySel = { runId, unitId? }`), the "click a
 * wall" new-run flow, the plan overlay (furniture dimmed, runs highlighted, the wall stretch under the cursor while
 * picking), keyboard handling and the engine-result reporting; the panels live in sibling files:
 *
 *   runs-panel.js   left sidebar: runs by room, new run, module palette
 *   workbench.js    drawings under the plan: elevation / plan / internal / worktop / section, with direct editing
 *   inspector.js    right sidebar: Run (specification) · Unit · Checks · Estimate · Quantities (+ quotation, carpenters)
 *   slots.js        mounts the colleague's estimate / take-off / quotation / carpenter modules
 *
 * Free-standing runs (islands) are moved here too: drag one in the plan (5 cm steps; Ctrl / ⌘ = 1 cm), arrow keys nudge it
 * 5 cm (Shift: 1 cm), R turns it 90° — all through Carp.moveRun(); a drag is transient moves inside store.begin(), then
 * ONE real moveRun() of the whole distance (one undo step). Live walkway clearances (Carp.runClearances) are painted while
 * moving. Wall-bound runs are positioned by their wall and never move this way.
 */
import * as Carp from '../../carpentry/index.js';
import { itemCorners, itemAABB } from '../../core/geometry.js';
import { h, call, listen } from '../dom.js';
import { icon } from '../icons.js';
import { toast, confirmDialog } from '../dialogs.js';
import { KINDS, kindInfo, starterUnits, num, roomName } from './vocab.js';
import { initRunsPanel } from './runs-panel.js';
import { initWorkbench } from './workbench.js';
import { initCarpentryInspector } from './inspector.js';

const FLOOR = new Set(['base', 'tall', 'full', 'island']);
/** 'floor' | 'wall' — the row a unit is laid out in. */
export const rowOf = (u) => (FLOOR.has(Carp.levelOf(u)) ? 'floor' : 'wall');

/** @param {object} app  UI context */
export function createCarpentry(app) {
  const { store, plan, view2d } = app;
  const root = document.getElementById('app');
  const planShown = () => store.ui.mode === '2d' || store.ui.mode === 'split';
  const undo = { label: 'Undo', fn: () => store.undo() };
  let pick = null;                    // { kind, hover: span|null } while the "click a wall" prompt is up
  let flash = { ids: new Set(), until: 0 };
  let findingsCache = new Map();      // runId → Finding[]
  const subs = new Set();

  const api = {
    Carp,
    isActive: () => store.ui.tool === 'carpentry',
    /** Enter Carpentry mode (from Furnish, Structure, 3D or the walk-through). */
    enter() {
      if (api.isActive()) return;
      // A carpentry unit selected in Furnish comes along as the carpentry selection (its run + the unit).
      const one = store.selection.length === 1 ? store.getItem(store.selection[0]) : null;
      store.clearSelection();
      store.setUI(planShown() ? { tool: 'carpentry' } : { tool: 'carpentry', mode: '2d' });
      if (one && one.carp && Carp.getRun(one.carp.runId)) store.setUI({ carpentrySel: { runId: one.carp.runId, unitId: one.id } });
      if (app.isCompact()) toast('Carpentry: tap a run in the plan, or open Runs to start one', { action: { label: 'Runs', fn: () => app.openPanel('catalog') } });
    },
    exit() { if (api.isActive()) { cancelPick(); store.setUI({ tool: 'select' }); } },
    toggle() { if (api.isActive()) api.exit(); else api.enter(); },
    /** Esc: the wall prompt → the unit → the run → leave the mode. */
    escape() {
      if (pick) { cancelPick(); return; }
      const sel = store.ui.carpentrySel;
      if (sel && sel.unitId) api.select(sel.runId, null);
      else if (sel && sel.runId) api.select(null);
      else api.exit();
    },

    /* ───────── selection ───────── */
    /** { run, units, unit } of the current selection (resolved against the store), or null. */
    current() {
      const sel = store.ui.carpentrySel;
      if (!sel || !sel.runId) return null;
      const got = Carp.getRun(sel.runId);
      if (!got) return null;
      const unit = sel.unitId ? got.units.find((u) => u.id === sel.unitId) || null : null;
      return { run: got.run, units: got.units, unit };
    },
    select(runId, unitId = null) {
      const cur = store.ui.carpentrySel;
      if (!runId) { if (cur) store.setUI({ carpentrySel: null }); return; }
      if (!cur || cur.runId !== runId || (cur.unitId || null) !== (unitId || null)) store.setUI({ carpentrySel: unitId ? { runId, unitId } : { runId } });
    },
    selectUnit(unitId) {
      const it = store.getItem(unitId);
      if (it && it.carp) api.select(it.carp.runId, unitId);
    },
    /** Units of the run in reading order: the floor row, then the wall row (each left to right). */
    ordered(run, units) {
      const pos = Carp.positions(run, units);
      const by = (row) => units.filter((u) => rowOf(u) === row).sort((a, b) => pos.get(a.id).at - pos.get(b.id).at);
      return [...by('floor'), ...by('wall')];
    },
    codes: (run, units) => Carp.unitCodes(run, units),

    /* ───────── findings ───────── */
    findings(runId) {
      if (!findingsCache.has(runId)) { let f = []; try { f = Carp.checkRun(runId) || []; } catch (err) { console.error('[carpentry] checkRun failed', err); } findingsCache.set(runId, f); }
      return findingsCache.get(runId);
    },
    /** { error, warning, info } counts for a run. */
    counts(runId) {
      const c = { error: 0, warning: 0, info: 0 };
      for (const f of api.findings(runId)) c[f.severity] = (c[f.severity] || 0) + 1;
      return c;
    },
    /** Briefly highlight units (from the Checks tab). */
    flash(ids) { flash = { ids: new Set(ids), until: performance.now() + 2600 }; emit('flash'); redrawPlan(); setTimeout(() => { emit('flash'); redrawPlan(); }, 2700); },
    flashed: () => (performance.now() < flash.until ? flash.ids : new Set()),

    /* ───────── engine calls ───────── */
    /**
     * Report an engine result. Returns '' when it went through, otherwise the refusal text (also toasted unless quiet).
     * Engine warnings ({ en, he }) become toasts.
     */
    report(res, { quiet = false, done } = {}) {
      if (!res) { if (!quiet) toast('That change is not possible here.', { kind: 'warn' }); return 'That change is not possible here.'; }
      if (!res.ok) { const t = (res.reason && res.reason.en) || 'That change is not possible here.'; if (!quiet) toast(t, { kind: 'warn', duration: 6000 }); return t; }
      for (const w of res.warnings || []) toast(w.en || String(w), { kind: 'warn', duration: 6000 });
      if (done && res.changed !== false) toast(done, { action: undo });
      return '';
    },
    run(fn, opts) { let res; try { res = fn(); } catch (err) { console.error('[carpentry]', err); res = { ok: false, reason: { en: 'Something went wrong with that change. Nothing was changed.' } }; } return { res, refusal: api.report(res, opts) }; },

    /** Fit the selected run (mode: 'fillers' | 'stretch' | 'span'). */
    fit(runId, mode = 'fillers') {
      const r = Carp.getRun(runId);
      if (!r) return;
      const opts = mode === 'span' ? { mode: 'fillers', toSpan: true } : { mode };
      const { res } = api.run(() => Carp.fitRun(runId, opts));
      if (res && res.ok) toast(res.changed === false ? `${r.run.code} already fits` : `${r.run.code} fitted${mode === 'span' ? ' to the wall' : mode === 'stretch' ? ' (units stretched)' : ' with fillers'}`, res.changed === false ? {} : { kind: 'success', action: undo });
    },
    addUnit(runId, moduleId, opts = {}) {
      const { res } = api.run(() => Carp.addUnit(runId, moduleId, opts));
      if (res && res.ok && res.unitId) { api.select(runId, res.unitId); return res.unitId; }
      return null;
    },
    removeUnit(unitId) {
      const it = store.getItem(unitId);
      if (!it || !it.carp) return;
      const cur = api.current();
      const order = cur ? api.ordered(cur.run, cur.units) : [];
      const i = order.findIndex((u) => u.id === unitId);
      const { res } = api.run(() => Carp.removeUnit(unitId));
      if (res && res.ok) {
        const next = order[i + 1] || order[i - 1];
        api.select(it.carp.runId, next && next.id !== unitId ? next.id : null);
        toast(`${it.name} removed`, { action: undo });
      }
    },
    /** Move a unit one place left (-1) or right (+1) within its row. */
    shiftUnit(unitId, dir) {
      const it = store.getItem(unitId), got = it && it.carp && Carp.getRun(it.carp.runId);
      if (!got) return;
      const row = api.ordered(got.run, got.units).filter((u) => rowOf(u) === rowOf(it));
      const i = row.findIndex((u) => u.id === unitId), j = i + dir;
      if (j < 0 || j >= row.length) { toast(dir < 0 ? 'Already the first unit in its row' : 'Already the last unit in its row'); return; }
      api.run(() => Carp.moveUnit(unitId, j));
    },
    /** Width ± delta (cm), clamped to the module limits with the reason said in words. */
    nudgeWidth(unitId, delta) {
      const it = store.getItem(unitId);
      if (!it || !it.carp) return;
      const m = Carp.MODULES[it.carp.module];
      const want = Math.round((it.carp.width + delta) * 10) / 10;
      if (m && (want < m.w.min - 0.01 || want > m.w.max + 0.01)) { toast(`${m.name.en}: ${want < m.w.min ? `${num(m.w.min)} cm is the narrowest` : `${num(m.w.max)} cm is the widest`} it comes.`, { kind: 'warn' }); return; }
      api.run(() => Carp.setUnitWidth(unitId, want));
    },
    /**
     * Re-create a unit with a different `carp` (one undo step) — used to drop per-unit spec overrides, which the engine's
     * deep-merging updateUnit() cannot delete. Keeps position, module, width and every other field.
     */
    replaceUnit(unitId, carpPatch) {
      const it = store.getItem(unitId);
      if (!it || !it.carp) return null;
      const got = Carp.getRun(it.carp.runId);
      const row = api.ordered(got.run, got.units).filter((u) => rowOf(u) === rowOf(it));
      const index = row.findIndex((u) => u.id === unitId);
      const c = { ...JSON.parse(JSON.stringify(it.carp)), ...carpPatch };
      const opts = {};
      for (const k of ['width', 'level', 'internals', 'fronts', 'spec', 'handed', 'appliance', 'hob', 'cutout', 'offset', 'elev', 'h', 'depth', 'note', 'cornerSide', 'blind', 'worktop', 'sink', 'basins', 'mirror']) if (c[k] !== undefined) opts[k] = c[k];
      store.begin();
      const a = Carp.removeUnit(unitId, { transient: true });
      const b = a.ok ? Carp.addUnit(got.run.id, c.module, { ...opts, index }, { transient: true }) : a;
      if (!b.ok) { store.cancel(); api.report(b); return null; }
      store.commit();
      api.select(got.run.id, b.unitId);
      return b.unitId;
    },
    async removeRun(runId) {
      const got = Carp.getRun(runId);
      if (!got) return;
      const ok = await confirmDialog({ title: `Remove ${got.run.code}?`, confirmLabel: 'Remove run', danger: true,
        message: `“${got.run.name}” and its ${got.units.length} ${got.units.length === 1 ? 'unit' : 'units'} are taken out of the design. You can undo this.` });
      if (!ok) return;
      const { res } = api.run(() => Carp.removeRun(runId));
      if (res && res.ok) { api.select(null); toast(`${got.run.code} removed`, { action: undo }); }
    },
    duplicateRun(runId) {
      const { res } = api.run(() => Carp.duplicateRun(runId));
      if (res && res.ok && res.runId) { api.select(res.runId); const r = Carp.getRun(res.runId); toast(`Copied as ${r ? r.run.code : 'a new run'}, 1 m in front. Move it with Fit to wall or change its place in the Run tab.`, { action: undo }); }
    },
    /** Adopt the architect's layout (one undo step). */
    adopt() {
      const before = Carp.listRuns().length;
      const { res } = api.run(() => Carp.adoptArchitectLayout({}));
      if (!res || !res.ok) return;
      const runs = Carp.listRuns();
      if (res.changed === false) { toast('The architect’s carpentry is already adopted'); return; }
      toast(`${runs.length - before} runs created from the architect’s layout`, { kind: 'success', action: undo });
      const k = runs.find((r) => r.kind === 'kitchen') || runs[0];
      if (k) api.select(k.id);
    },

    /* ───────── new run: "click a wall" ───────── */
    startNewRun(kind) {
      if (!api.isActive()) api.enter();
      if (!planShown()) store.setUI({ mode: '2d' });
      pick = { kind, hover: null };
      root.classList.add('is-carp-picking');
      syncPickBanner();
      if (app.isCompact()) app.closePanels();
      redrawPlan();
    },
    isPicking: () => !!pick,
    cancelPick,

    /** Frame a run in the plan (and the workbench). */
    focusRun(runId) {
      const got = Carp.getRun(runId);
      if (!got || !got.units.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const u of got.units) { const b = itemAABB(u); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
      const pad = 160;
      if (planShown()) call(view2d, 'fit', { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad }, { animate: true });
      emit('focus');
    },

    /** Move / turn a free-standing run (island): { dx, dy, rot }. Returns true when it moved. */
    moveRun(runId, delta) {
      const got = Carp.getRun(runId);
      if (!got) return false;
      if (!Carp.isFreeRun(got.run)) { wallBoundHint(got.run); return false; }
      const { res } = api.run(() => Carp.moveRun(runId, delta));
      if (res && res.ok && res.changed !== false) { showClear(runId, 2600); return true; }
      return false;
    },
    rotateRun(runId, deg = 90) { return api.moveRun(runId, { rot: deg }); },
    /** Live clearances being shown: { runId, refusal } or null. */
    clearShown: () => (drag ? { runId: drag.runId, refusal: drag.refusal } : clearFor && performance.now() < clearFor.until ? { runId: clearFor.runId, refusal: null } : null),

    /** Keyboard (Carpentry mode only). Returns true when the key was used. */
    handleKey(e, key) {
      const cur = api.current();
      const unit = cur && cur.unit;
      if (cur && Carp.isFreeRun(cur.run) && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const step = e.shiftKey ? 1 : 5;
        const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key];
        if (mv) { e.preventDefault(); api.moveRun(cur.run.id, { dx: mv[0], dy: mv[1] }); return true; }
        if (key === 'r' || key === 'R') { e.preventDefault(); api.rotateRun(cur.run.id, e.shiftKey ? -90 : 90); return true; }
      } else if ((key === 'r' || key === 'R') && cur && !e.ctrlKey && !e.metaKey) { wallBoundHint(cur.run); return true; }
      if (key === 'Delete' || key === 'Backspace') { if (unit) { e.preventDefault(); api.removeUnit(unit.id); } return true; }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        if (!cur) return true;
        e.preventDefault();
        const dir = key === 'ArrowLeft' ? -1 : 1;
        if (e.altKey && unit) { api.shiftUnit(unit.id, dir); return true; }
        const order = api.ordered(cur.run, cur.units).filter((u) => !u.hidden || u.carp.module === 'base-space');
        if (!order.length) return true;
        const i = unit ? order.findIndex((u) => u.id === unit.id) : -1;
        const next = i < 0 ? order[dir > 0 ? 0 : order.length - 1] : order[Math.max(0, Math.min(order.length - 1, i + dir))];
        api.select(cur.run.id, next.id);
        return true;
      }
      if ((key === '+' || key === '=' || key === '-' || key === '_') && unit) { e.preventDefault(); api.nudgeWidth(unit.id, (key === '-' || key === '_' ? -1 : 1) * 5); return true; }
      if (key === 'f' && cur) { if (e.shiftKey) api.focusRun(cur.run.id); else api.fit(cur.run.id, 'fillers'); return true; }
      if (key === 'n') { app.openPanel('catalog'); emit('new-run'); return true; }
      return false;
    },

    on(name, fn) { const s = { name, fn }; subs.add(s); return () => subs.delete(s); },
    emit,
  };
  function emit(name, payload) { for (const s of subs) if (s.name === name) { try { s.fn(payload); } catch (err) { console.error('[carpentry]', err); } } }

  /* ───────── moving a free-standing run (island) in the plan ───────── */
  let drag = null;          // { runId, applied: { x, y }, refusal }
  let clearFor = null;      // { runId, until } — clearances shown briefly after a nudge / turn
  let clearTimer = 0;
  function showClear(runId, ms) {
    clearFor = { runId, until: performance.now() + ms };
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => { clearFor = null; redrawPlan(); }, ms + 50);
    redrawPlan();
  }
  let lastWallHint = 0;
  function wallBoundHint(run) {
    if (performance.now() - lastWallHint < 4000) return;
    lastWallHint = performance.now();
    toast(`${run.code} stands against its wall: it is positioned by the wall. Change its length or use Fit to wall instead.`);
  }
  call(view2d, 'setCarpentryDrag', {
    canDrag(itemId) {
      if (!api.isActive() || pick) return false;
      const it = store.getItem(itemId), run = it && it.carp && Carp.runOfItem(it);
      return !!run && Carp.isFreeRun(run);
    },
    start({ itemId }) {
      const it = store.getItem(itemId), run = it && Carp.runOfItem(it);
      if (!run) return;
      const sel = store.ui.carpentrySel;
      if (!sel || sel.runId !== run.id) api.select(run.id, itemId);
      store.begin();
      const fp = Carp.runFootprint(run);
      drag = { runId: run.id, applied: { x: 0, y: 0 }, refusal: null, x0: fp ? fp.x : 0, y0: fp ? fp.y : 0 };
      redrawPlan();
    },
    move({ dx, dy, snap }) {
      if (!drag) return;
      const step = snap ? 5 : 1;
      // the footprint's north-west corner lands on the 5 cm grid (1 cm with Ctrl / ⌘ held or snapping off)
      const want = { x: Math.round((drag.x0 + dx) / step) * step - drag.x0, y: Math.round((drag.y0 + dy) / step) * step - drag.y0 };
      want.x = Math.round(want.x * 10) / 10; want.y = Math.round(want.y * 10) / 10;
      const tryTo = (tx, ty) => {
        const ddx = tx - drag.applied.x, ddy = ty - drag.applied.y;
        if (!ddx && !ddy) return { ok: true };
        const res = Carp.moveRun(drag.runId, { dx: ddx, dy: ddy }, { transient: true });
        if (res.ok) drag.applied = { x: tx, y: ty };
        return res;
      };
      let res = tryTo(want.x, want.y);
      if (!res.ok) {
        // slide along whatever stopped it: keep the axis that still works
        const refusal = res.reason;
        if (!tryTo(want.x, drag.applied.y).ok) tryTo(drag.applied.x, want.y);
        drag.refusal = refusal ? refusal.en : 'It cannot go there.';
      } else drag.refusal = null;
      redrawPlan();
    },
    end() {
      if (!drag) return;
      const { runId, applied } = drag;
      drag = null;
      store.cancel();                                   // back to where the drag began, then one real step
      if (applied.x || applied.y) {
        const { res } = api.run(() => Carp.moveRun(runId, { dx: applied.x, dy: applied.y }));
        if (res && res.ok) showClear(runId, 1800);
      }
      redrawPlan();
    },
    cancel() { if (!drag) return; drag = null; store.cancel(); redrawPlan(); },
  });

  /* ───────── new-run flow ───────── */
  const banner = h('div', { class: 'cpick', role: 'status', hidden: true });
  document.getElementById('ov2d')?.append(banner);
  function syncPickBanner() {
    banner.hidden = !pick;
    if (!pick) return;
    const k = kindInfo(pick.kind);
    banner.replaceChildren(icon(k.icon, { size: 16 }),
      h('span', { class: 'cpick__text' }, pick.kind === 'island' ? `Click in a room to place the island` : `Click a wall for the new ${k.label.toLowerCase()}`),
      h('span', { class: 'cpick__hint' }, pick.hover ? `${num(pick.hover.length)} cm free` : 'Esc cancels'),
      h('button', { type: 'button', class: 'cpick__cancel', onClick: cancelPick }, 'Cancel'));
  }
  function cancelPick() {
    if (!pick) return;
    pick = null;
    root.classList.remove('is-carp-picking');
    syncPickBanner();
    redrawPlan();
  }
  /** The free stretch createRun() would use at (x, y) for `kind`: { span, from, to } or null. */
  function stretchAt(kind, x, y) {
    const span = Carp.wallSpanAt(x, y);
    if (!span) return null;
    const levels = Carp.KIND_LEVELS[kind] || ['base'];
    const floorRun = levels.some((l) => FLOOR.has(l));
    const tallOnly = !levels.includes('base') && levels.some((l) => l === 'tall' || l === 'full');
    const blocks = span.openings.filter((o) => (floorRun && o.kind !== 'window') || (tallOnly && o.kind === 'window'));
    const from = Math.max(0, ...blocks.filter((o) => o.to <= span.at + 0.01).map((o) => o.to));
    const to = Math.min(span.length, ...blocks.filter((o) => o.from >= span.at - 0.01).map((o) => o.from));
    const windows = span.openings.some((o) => o.kind === 'window' && Math.min(to, o.to) - Math.max(from, o.from) > 0.5);
    return { span, from, to, length: to - from, windows };
  }
  function createAt(x, y) {
    const kind = pick.kind, k = kindInfo(kind);
    let res;
    if (kind === 'island') {
      res = Carp.createRun({ kind, x: Math.round(x), y: Math.round(y), rot: 0, length: 240, units: [{ module: 'island', width: 240 }] });
    } else {
      const st = stretchAt(kind, x, y);
      if (!st) { toast('Click on or right beside a wall face.', { kind: 'warn' }); return; }
      if (st.length < 10) { toast('Not enough free wall here, between the doors.', { kind: 'warn' }); return; }
      const units = starterUnits(kind, st.length, { windows: st.windows });
      res = Carp.createRun({ kind, x, y, units });
      if (!res.ok && units.length) {
        const bare = Carp.createRun({ kind, x, y });
        if (bare.ok) { toast(`${res.reason.en} The run was created empty: add units from the palette.`, { kind: 'warn', duration: 7000 }); res = bare; }
      }
    }
    if (!res || !res.ok) { api.report(res); return; }
    cancelPick();
    const got = Carp.getRun(res.runId);
    store.setUI({ carpentrySel: { runId: res.runId }, carpentryTab: 'run' });
    const used = got.units.filter((u) => rowOf(u) === 'floor').reduce((s, u) => s + u.carp.width, 0);
    const free = Math.round((got.run.length - used) * 10) / 10;
    const what = `${got.run.code} · ${k.label}, ${num(got.run.length)} cm`;
    if (kind !== 'island' && Math.abs(free) > 0.05) toast(`${what}: ${got.units.length} starter units, ${num(Math.abs(free))} cm ${free > 0 ? 'free' : 'too long'}.`, { action: { label: 'Fit to wall', fn: () => api.fit(res.runId, 'fillers') }, duration: 9000 });
    else toast(`${what} created`, { kind: 'success', action: undo });
  }

  /* ───────── plan view hooks ───────── */
  listen(view2d, 'carpentry-pick', (e) => {
    if (!e || !api.isActive()) return;
    if (pick) { createAt(e.x, e.y); return; }
    if (e.itemId) { api.selectUnit(e.itemId); return; }
    const sel = store.ui.carpentrySel;
    if (sel && sel.unitId) api.select(sel.runId, null);
    else if (sel) api.select(null);
  });
  listen(view2d, 'carpentry-locked', (e) => {
    const it = e && store.getItem(e.itemId);
    if (it) lockedToast(it);
  });
  listen(view2d, 'cursor', (e) => {
    if (!pick || !e) return;
    const st = pick.kind === 'island' ? null : stretchAt(pick.kind, e.x, e.y);
    const prev = pick.hover;
    pick.hover = st ? { ...st, x: e.x, y: e.y } : (pick.kind === 'island' ? { island: true, x: e.x, y: e.y, length: 240 } : null);
    if (!prev !== !pick.hover || (prev && pick.hover && prev.length !== pick.hover.length)) syncPickBanner();
    redrawPlan();
  });

  /** "Kitchen run K1 · unit B3 — edit it in Carpentry" (furniture tools refuse carpentry units). */
  let lastLocked = 0;
  function lockedToast(it) {
    const run = Carp.runOfItem(it);
    if (performance.now() - lastLocked < 4000) return run;      // one explanation per burst of attempts
    lastLocked = performance.now();
    toast(`${unitLabel(it)} is made to measure: edit it in Carpentry.`, { action: { label: 'Edit in Carpentry', fn: () => api.openUnit(it.id) } });
    return run;
  }
  /** "Kitchen run K1 · unit B3" */
  function unitLabel(it) {
    const run = Carp.runOfItem(it);
    if (!run) return it.name;
    const got = Carp.getRun(run.id), code = got ? Carp.unitCodes(run, got.units).get(it.id) : '';
    return `${kindInfo(run.kind).label} ${run.code}${code ? ` · unit ${code}` : ''}`;
  }
  api.unitLabel = unitLabel;
  api.lockedToast = lockedToast;
  /** Switch to Carpentry with this unit selected. */
  api.openUnit = (id) => {
    const it = store.getItem(id);
    if (!it || !it.carp) return;
    api.enter();
    store.setUI({ carpentrySel: { runId: it.carp.runId, unitId: id }, carpentryTab: 'unit' });
    if (!app.isCompact()) app.setPanelOpen('right', true);
  };

  /* ───────── plan overlay: dim furniture, show runs, preview the stretch while picking ───────── */
  function redrawPlan() { call(view2d, 'redraw'); }
  function paintPlan(G, pal) {
    if (!api.isActive() || !store.ui.showItems || !pal) return;
    const { ctx } = G;
    const sel = store.ui.carpentrySel || {};
    const flashed = api.flashed();
    G.deviceSpace();
    // 1. Furniture steps back (carpentry units stay fully visible).
    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = pal.paper;
    for (const it of store.items) {
      if (it.carp || it.hidden) continue;
      G.poly(itemCorners(it)); ctx.fill();
    }
    ctx.restore();
    // 2. Runs: outline by run; the selected run in the accent; the selected unit filled.
    const runs = Carp.listRuns();
    ctx.save();
    ctx.lineJoin = 'round';
    for (const run of runs) {
      const got = Carp.getRun(run.id);
      if (!got) continue;
      const on = run.id === sel.runId;
      const findings = on ? api.findings(run.id) : [];
      const bad = new Map();
      for (const f of findings) for (const id of f.unitIds || []) if (f.severity !== 'info' && !(bad.get(id) === 'error')) bad.set(id, f.severity);
      for (const u of got.units) {
        if (u.hidden && u.carp.module !== 'base-space') continue;
        const pts = itemCorners(u);
        const isSel = u.id === sel.unitId, wall = rowOf(u) === 'wall';
        if (isSel || flashed.has(u.id)) {
          G.poly(pts); ctx.fillStyle = withAlpha(pal.accent, flashed.has(u.id) && !isSel ? 0.3 : 0.22); ctx.fill();
        }
        G.poly(pts);
        ctx.setLineDash(wall ? [G.px(4), G.px(3)] : []);
        ctx.strokeStyle = bad.has(u.id) ? (bad.get(u.id) === 'error' ? pal.danger : pal.warn) : on ? pal.accent : withAlpha(pal.ink, 0.55);
        ctx.lineWidth = isSel ? G.px(2.25) : on ? G.px(1.5) : G.px(1);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // run tag at the front middle
      const depth = run.kind === 'island' ? (run.spec.worktop.depth || 100) / 2 : 0;
      const [tx, ty] = Carp.toPlan(run.anchor, run.length / 2, run.kind === 'island' ? depth : 70);
      const label = run.code, fs = G.px(10.5);
      ctx.font = `600 ${fs}px ${G.font || 'sans-serif'}`;
      const w = ctx.measureText(label).width + G.px(10), hgt = fs + G.px(6);
      const X = G.X(tx), Y = G.Y(ty);
      ctx.fillStyle = on ? pal.accent : withAlpha(pal.paper, 0.92);
      ctx.strokeStyle = on ? pal.accent : withAlpha(pal.ink, 0.45);
      ctx.lineWidth = G.px(1);
      roundRect(ctx, X - w / 2, Y - hgt / 2, w, hgt, G.px(3)); ctx.fill(); ctx.stroke();
      ctx.fillStyle = on ? pal.onAccent || '#fff' : pal.ink;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, X, Y + G.px(0.5));
    }
    ctx.restore();
    // 3. Walkway clearances while an island is moved (≥ RULES.aisleMin, RULES.aisleRecommended–aisleTwoCooks preferred).
    const cs = api.clearShown();
    if (cs) paintClearances(G, pal, cs);
    // 4. The stretch a click would use.
    if (pick && pick.hover) {
      const hv = pick.hover;
      ctx.save();
      ctx.strokeStyle = pal.accent; ctx.fillStyle = withAlpha(pal.accent, 0.16); ctx.lineWidth = G.px(1.75); ctx.setLineDash([G.px(5), G.px(3)]);
      if (hv.island) {
        const pts = [[hv.x - 120, hv.y - 60], [hv.x + 120, hv.y - 60], [hv.x + 120, hv.y + 60], [hv.x - 120, hv.y + 60]];
        G.poly(pts); ctx.fill(); ctx.stroke();
      } else {
        const d = { wardrobe: 60, entry: 40, utility: 60, shelving: 30, vanity: 50, media: 40 }[pick.kind] || 60;
        const a = hv.span.anchor;
        const pts = [Carp.toPlan(a, hv.from, 0), Carp.toPlan(a, hv.to, 0), Carp.toPlan(a, hv.to, d), Carp.toPlan(a, hv.from, d)];
        G.poly(pts); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
        const [mx, my] = Carp.toPlan(a, (hv.from + hv.to) / 2, d / 2);
        const fs = G.px(11);
        ctx.font = `600 ${fs}px ${G.font || 'sans-serif'}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = G.px(3); ctx.strokeStyle = pal.paper; ctx.strokeText(`${num(hv.length)} cm`, G.X(mx), G.Y(my));
        ctx.fillStyle = pal.accent; ctx.fillText(`${num(hv.length)} cm`, G.X(mx), G.Y(my));
      }
      ctx.restore();
    }
  }
  function paintClearances(G, pal, cs) {
    const { ctx } = G;
    let list = [];
    try { list = Carp.runClearances(cs.runId); } catch (err) { console.error('[carpentry] clearances', err); }
    const R = Carp.RULES, colour = { ok: pal.accent, tight: pal.warn, short: pal.danger };
    ctx.save();
    const fs = G.px(10.5);
    ctx.font = `600 ${fs}px ${G.font || 'sans-serif'}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const c of list) {
      if (c.d == null || !c.to) continue;
      const col = colour[c.level] || pal.ink;
      const [x0, y0] = c.from, [x1, y1] = c.to;
      ctx.strokeStyle = col; ctx.lineWidth = G.px(1.25); ctx.setLineDash([G.px(4), G.px(3)]);
      ctx.beginPath(); ctx.moveTo(G.X(x0), G.Y(y0)); ctx.lineTo(G.X(x1), G.Y(y1)); ctx.stroke();
      ctx.setLineDash([]);
      for (const [x, y] of [c.from, c.to]) { ctx.beginPath(); ctx.arc(G.X(x), G.Y(y), G.px(2.2), 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); }
      const label = `${num(Math.round(c.d))}${c.level === 'short' ? ` < ${R.aisleMin}` : ''}`;
      const X = (G.X(x0) + G.X(x1)) / 2, Y = (G.Y(y0) + G.Y(y1)) / 2;
      const w = ctx.measureText(label).width + G.px(10), hgt = fs + G.px(6);
      ctx.fillStyle = col; roundRect(ctx, X - w / 2, Y - hgt / 2, w, hgt, G.px(3)); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillText(label, X, Y + G.px(0.5));
    }
    if (cs.refusal) {
      const b = Carp.runFootprint(Carp.getRun(cs.runId).run);
      if (b) {
        const X = G.X(b.x + b.w / 2), Y = G.Y(b.y) - G.px(16);
        const w = ctx.measureText(cs.refusal).width + G.px(12), hgt = fs + G.px(8);
        ctx.fillStyle = pal.danger; roundRect(ctx, X - w / 2, Y - hgt / 2, w, hgt, G.px(3)); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.fillText(cs.refusal, X, Y + G.px(0.5));
      }
    }
    ctx.restore();
  }
  call(view2d, 'addOverlay', paintPlan);

  /* ───────── panels ───────── */
  api.mount = () => {
    initRunsPanel(document.getElementById('left'), app, api);
    initWorkbench(app, api);
    initCarpentryInspector(document.getElementById('right'), app, api);
  };

  /* ───────── store wiring ───────── */
  const syncClasses = () => root.classList.toggle('is-carpentry', api.isActive());
  /** Drop a selection that no longer exists (undo, removed run / unit). */
  function prune() {
    const sel = store.ui.carpentrySel;
    if (!sel) return;
    const got = sel.runId && Carp.getRun(sel.runId);
    if (!got) { store.setUI({ carpentrySel: null }); return; }
    if (sel.unitId && !got.units.some((u) => u.id === sel.unitId)) store.setUI({ carpentrySel: { runId: sel.runId } });
  }
  const invalidateFindings = () => { findingsCache = new Map(); };
  store.on('carpentry', (e) => { invalidateFindings(); if (!e || !e.transient) queueMicrotask(prune); redrawPlan(); });
  store.on('items', (e) => { if (!e.transient) invalidateFindings(); });
  store.on('plan', (e) => { if (!e || !e.transient) { invalidateFindings(); redrawPlan(); } });
  store.on('load', () => { invalidateFindings(); prune(); });
  store.on('ui', (e) => {
    if (e.keys.includes('mode') && api.isActive() && !planShown()) api.exit();     // Carpentry lives in Plan and Split
    if (e.keys.includes('tool')) {
      if (!api.isActive()) cancelPick();
      if (api.isActive() && store.selection.length) store.clearSelection();
      syncClasses();
      redrawPlan();
    }
    if (e.keys.includes('carpentrySel')) redrawPlan();
  });
  // A panel selected furniture (shopping list, checks…): the user is furnishing again.
  // A carpentry unit selected that way becomes the carpentry selection instead.
  store.on('selection', () => {
    if (!store.selection.length || !api.isActive()) return;
    const ids = store.selection.slice();
    if (!ids.every((id) => (store.getItem(id) || {}).carp)) { api.exit(); return; }
    store.clearSelection();
    api.selectUnit(ids[0]);
  });

  if (api.isActive() && !planShown()) api.exit();
  syncClasses();
  return api;
}

let normCtx = null;
/** Any CSS colour → the same colour at alpha `a` (the canvas normalises it to #rrggbb or rgba()). */
function withAlpha(color, a) {
  if (typeof color !== 'string') return color;
  if (!normCtx) normCtx = document.createElement('canvas').getContext('2d');
  normCtx.fillStyle = '#000'; normCtx.fillStyle = color;
  const c = normCtx.fillStyle;
  const m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) { const v = parseInt(m[1], 16); return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`; }
  const r = c.match(/^rgba?\(([^,]+),([^,]+),([^,)]+)/);
  return r ? `rgba(${r[1]},${r[2]},${r[3]},${a})` : color;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

export { KINDS, roomName };
