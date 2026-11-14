/**
 * Carpentry workbench — the drawings of the selected run under the plan (a resizable split inside the stage; a
 * bottom sheet on phones: half / full height, the bottom navigation stays usable): Elevation · Plan · Internal · Worktop · Section, rendered by the shared SVG renderer
 * (`src/carpentry/doc/svg.js`, or svg-fallback.js while that is not there) and edited directly:
 *
 *   click a unit ................ store.ui.carpentrySel.unitId
 *   drag a unit sideways ........ Carp.moveUnit(unitId, indexInRow)                one undo step, on release
 *   drag its side edge .......... Carp.setUnitWidth(unitId, w, { transient })     5 cm steps (Alt: 1 cm), live, inside
 *                                 store.begin() … store.commit() → one undo step; clamped to the module's min / max
 *   drop a palette module ....... Carp.addUnit(runId, moduleId, { index })        at the drop position
 *   wheel / pinch / drag empty .. zoom / pan (vector SVG, re-rasterised at every zoom → crisp)
 *
 * The 3D tab shows the run in the app's own 3D view (the stage switches to Split while it is open, and back): the camera
 * frames the run, a section cut removes the room in front of it, "Open fronts" swings doors / pulls drawers, "Studio light" lights the run evenly in neutral white, and units with
 * fit problems are outlined with their Checks message (view3d.showCarpentry). Clicking a unit in 3D selects it here.
 *
 * The view keeps its scale and the screen position of the run's origin while the drawing changes, so nothing jumps
 * during a gesture. Unit rectangles for hit-testing come from the engine geometry (positions + geometryOf), not from
 * the SVG, so the renderer stays a dumb painter. Findings are marked on the units they concern.
 */
import * as Carp from '../../carpentry/index.js';
import { drawingToSVG as fallbackSVG } from './svg-fallback.js';
import { h, setKids, rafThrottle, clamp, call } from '../dom.js';
import { icon } from '../icons.js';
import { iconBtn } from '../components.js';
import { openMenu } from '../dialogs.js';
import { getPref, setPref } from '../prefs.js';
import { DND_MODULE } from './runs-panel.js';
import { focusFeature } from './bespoke.js';
import { rowOf } from './index.js';
import { num } from './vocab.js';

export const WB_TABS = [
  { id: 'elevation', label: 'Elevation' }, { id: 'plan', label: 'Plan' }, { id: 'internal', label: 'Internal' },
  { id: 'worktop', label: 'Worktop' }, { id: 'section', label: 'Section' }, { id: '3d', label: '3D' },
];
const EDITABLE = new Set(['elevation', 'plan']);
const SLOP = 5;
const SVGNS = 'http://www.w3.org/2000/svg';

let renderSVG = fallbackSVG;
let realRenderer = false;
/** Use the shared renderer as soon as it exists (quietly keeps the fallback otherwise). */
const rendererReady = import('../../carpentry/doc/svg.js')
  .then((m) => { const fn = m.drawingToSVG || m.default; if (typeof fn === 'function') { renderSVG = fn; realRenderer = true; } })
  .catch(() => { /* not written yet: the local fallback renders the same op format */ });

/** @param {object} app  @param {object} C  carpentry controller */
export function initWorkbench(app, C) {
  const { store } = app;
  const stage = document.getElementById('stage');
  const S = { runId: null, tab: getPref('carpWbTab') === '3d' ? 'elevation' : getPref('carpWbTab') || 'elevation', drawings: [], drawing: null, scale: 1, ox: 0, oy: 0, fitted: '', userView: false,
    fitWhole: false, noReveal: false, rects: [], hover: null, gesture: null, drop: null, paletteModule: null, tip: null, svgEl: null };

  /* ───────── DOM ───────── */
  const tabBtns = new Map();
  const tablist = h('div', { class: 'cwb__tabs', role: 'tablist', 'aria-label': 'Drawings' }, WB_TABS.map((t) => {
    const b = h('button', { type: 'button', class: 'cwb__tab', role: 'tab', 'aria-selected': 'false', onClick: () => setTab(t.id) }, t.label);
    tabBtns.set(t.id, b);
    return b;
  }));
  tablist.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault(); e.stopPropagation();
    const avail = WB_TABS.filter((t) => !tabBtns.get(t.id).disabled);
    const i = avail.findIndex((t) => t.id === S.tab);
    const next = avail[(i + dir + avail.length) % avail.length];
    if (next) { setTab(next.id); tabBtns.get(next.id).focus(); }
  });
  const strip = h('div', { class: 'cwb__strip', 'aria-live': 'polite' });
  const fitMain = h('button', { type: 'button', class: 'btn btn--sm cwb__fit', 'data-tip': 'Fit the units to the run length, with fillers at the walls', 'data-kbd': 'F', onClick: () => S.runId && C.fit(S.runId, 'fillers') }, icon('fit', { size: 15 }), h('span', null, 'Fit'));
  const fitMore = h('button', { type: 'button', class: 'btn btn--sm cwb__fitmore', 'aria-label': 'More ways to fit', 'aria-haspopup': 'menu', onClick: () => openMenu(fitMore, [
    { heading: 'Fit the run' },
    { label: 'With fillers at the walls (recommended)', icon: 'fit', kbd: 'F', onSelect: () => C.fit(S.runId, 'fillers') },
    { label: 'Stretch the units, no new fillers', icon: 'resize', onSelect: () => C.fit(S.runId, 'stretch') },
    { label: 'To the free wall (re-measure the run)', icon: 'wall', onSelect: () => C.fit(S.runId, 'span') },
  ], { placement: 'bottom-end' }) }, icon('chevron-down', { size: 14 }));
  const fitGroup = h('div', { class: 'cwb__fitgrp', role: 'group', 'aria-label': 'Fit' }, fitMain, fitMore);
  const zoomOut = iconBtn('minus', 'Zoom out', { size: 16, onClick: () => zoomAt(null, 1 / 1.25) });
  const zoomFit = iconBtn('fit', 'Fit the drawing', { size: 16, onClick: () => { S.userView = false; S.fitWhole = true; fit(); } });
  const zoomIn = iconBtn('plus', 'Zoom in', { size: 16, onClick: () => zoomAt(null, 1.25) });
  const collapse = iconBtn('chevron-down', 'Hide the drawings', { size: 16, class: 'hide-phone', onClick: () => setCollapsed(!collapsed) });
  const close = iconBtn('close', 'Close the drawings', { size: 18, class: 'cwb__close', onClick: () => setSheet(false) });
  // Phone: a grab handle at the sheet's top edge — tap (or drag up / down) switches between the half and the full height.
  const handle = h('button', { type: 'button', class: 'cwb__handle', 'aria-expanded': 'false', 'aria-label': 'Make the drawings taller', onClick: () => { if (handleDragged) { handleDragged = false; return; } setFull(!full); } }, h('span', { class: 'cwb__pill' }));
  let handleDragged = false;
  handle.addEventListener('pointerdown', (e) => {
    const y0 = e.clientY;
    handleDragged = false;
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    const up = (ev) => {
      handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
      const dy = ev.clientY - y0;
      if (ev.type === 'pointerup' && Math.abs(dy) > 24) { handleDragged = true; setFull(dy < 0); }
    };
    handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  });
  const grip = h('div', { class: 'cwb__grip', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize the drawings', tabindex: '0', 'data-tip': 'Drag to resize' });
  const sheet = h('div', { class: 'cwb__sheet' });
  const ov = document.createElementNS(SVGNS, 'svg');
  ov.setAttribute('class', 'cwb__ov');
  ov.setAttribute('aria-hidden', 'true');
  const tip = h('div', { class: 'cwb__tip', hidden: true, role: 'status' });
  const empty = h('div', { class: 'cwb__empty' });
  const p3d = h('div', { class: 'c3d', hidden: true });
  const view = h('div', { class: 'cwb__view', tabindex: '0', 'aria-label': 'Drawing of the selected run. Click a unit to select it; drag it to reorder; drag its edge to change its width.' }, sheet, ov, tip, empty, p3d);
  const title = h('div', { class: 'cwb__title' });
  const el = h('section', { class: 'cwb', 'aria-label': 'Carpentry drawings' },
    grip, handle,
    h('header', { class: 'cwb__bar' }, title, tablist, strip, fitGroup,
      h('div', { class: 'cwb__zoom', role: 'group', 'aria-label': 'Zoom' }, zoomOut, zoomFit, zoomIn), collapse, close),
    view);
  stage.append(el);
  // Phone: the workbench is a bottom sheet opened from a button over the plan (half height first).
  const openBtn = h('button', { type: 'button', class: 'cwb-open', onClick: () => setSheet(true) }, icon('carpentry', { size: 16 }), h('span', null, 'Drawings'));
  document.getElementById('ov2d')?.append(openBtn);

  /* ───────── size, collapse, sheet ───────── */
  let collapsed = !!getPref('carpWbCollapsed');
  const setHeight = (px) => { const max = Math.max(160, stage.clientHeight - 120); const v = clamp(Math.round(px), 150, max); stage.style.setProperty('--cwb-h', `${v}px`); return v; };
  setHeight(getPref('carpWbH') || Math.max(300, Math.round(stage.clientHeight * 0.42)));
  function setCollapsed(v) {
    collapsed = v;
    setPref('carpWbCollapsed', v);
    el.classList.toggle('is-collapsed', v);
    collapse.setIcon(v ? 'chevron-up' : 'chevron-down');
    collapse.setAttribute('aria-label', v ? 'Show the drawings' : 'Hide the drawings');
    collapse.dataset.tip = v ? 'Show the drawings' : 'Hide the drawings';
    requestAnimationFrame(() => { app.view2d && app.view2d.resize && app.view2d.resize(); layout(); });
  }
  setCollapsed(collapsed);
  let full = false;
  const isPhone = () => window.matchMedia('(max-width: 699px)').matches;
  /** Phone sheet height: half (about 46% of the screen, the plan stays in sight above) or full (up to the top bar). */
  function setFull(v) {
    full = !!v;
    el.classList.toggle('is-full', full);
    handle.setAttribute('aria-expanded', String(full));
    handle.setAttribute('aria-label', full ? 'Make the drawings shorter' : 'Make the drawings taller');
    requestAnimationFrame(fitPhone3d);                              // the view resizes → its observer refits the drawing
  }
  function setSheet(open) {
    el.classList.toggle('is-open', open);
    setFull(false);
    if (!open) leave3d();                                          // phone: closing the sheet gives the plan back
    if (open) { requestAnimationFrame(() => { S.userView = false; render(true); }); }
  }
  // Picking a run in the Runs sheet shows its drawings (half height).
  C.on('show-drawings', () => { if (C.isActive() && isPhone()) setSheet(true); });
  grip.addEventListener('pointerdown', (e) => {
    if (collapsed) setCollapsed(false);
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = el.getBoundingClientRect().height;
    el.classList.add('is-resizing');
    const move = (ev) => { setHeight(h0 + (y0 - ev.clientY)); };
    const up = () => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      el.classList.remove('is-resizing');
      setPref('carpWbH', el.getBoundingClientRect().height);
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowUp' ? 24 : e.key === 'ArrowDown' ? -24 : 0;
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    setPref('carpWbH', setHeight(el.getBoundingClientRect().height + d));
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (!S.userView) fit(); else layout(); }).observe(view);

  /* ───────── tabs ───────── */
  function setTab(id) {
    if (S.tab === id) return;
    S.tab = id;
    if (id !== '3d') { leave3d(); setPref('carpWbTab', id); }
    S.userView = false;
    render(true);
  }

  /* ───────── geometry: drawing cm ↔ view px ───────── */
  const mirror = () => !!(S.drawing && (S.drawing.kind === 'elevation' || S.drawing.kind === 'internal') && S.runKind === 'island');
  const toX = (x) => S.ox + x * S.scale;
  const toY = (y) => S.oy - y * S.scale;
  const fromX = (px) => (px - S.ox) / S.scale;
  function local(e) { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  /** Unit rectangles (drawing cm) of the current run for the current drawing. */
  function computeRects() {
    S.rects = [];
    const got = S.runId && Carp.getRun(S.runId);
    if (!got || !S.drawing) return;
    const kind = S.drawing.kind;
    if (kind === 'section') return;
    const run = got.run, units = got.units, pos = Carp.positions(run, units), L = run.length;
    for (const u of units) {
      const p = pos.get(u.id);
      if (!p) continue;
      let g;
      try { g = Carp.geometryOf(run, u); } catch (err) { continue; }
      let x0 = p.at, x1 = p.at + u.carp.width;
      if (mirror()) { const a = L - x1, b = L - x0; x0 = a; x1 = b; }
      let y0, y1;
      if (kind === 'plan' || kind === 'worktop') { y0 = -g.d; y1 = 0; }
      else { y0 = g.elev; y1 = g.elev + g.h; }
      if (kind === 'worktop' && rowOf(u) === 'wall') continue;
      S.rects.push({ id: u.id, x0, x1, y0, y1, row: rowOf(u), unit: u, mod: Carp.MODULES[u.carp.module] });
    }
  }
  /** Unit under a view point (px). Prefers the floor row in plan views; the smallest rectangle otherwise. */
  function unitAt(p, target) {
    const tid = target && target.closest && target.closest('[data-unit-id]');
    if (tid && S.rects.some((r) => r.id === tid.dataset.unitId)) return S.rects.find((r) => r.id === tid.dataset.unitId);
    const x = fromX(p.x), y = (S.oy - p.y) / S.scale, tol = 3 / S.scale;
    const hits = S.rects.filter((r) => x >= r.x0 - tol && x <= r.x1 + tol && y >= r.y0 - tol && y <= r.y1 + tol);
    if (!hits.length) return null;
    if (S.drawing.kind === 'plan') { const f = hits.filter((r) => r.row === 'floor'); if (f.length) return f[0]; }
    return hits.sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0];
  }
  /** Which edge grip of the selected unit is under p: 'left' | 'right' | null. */
  function gripAt(p) {
    if (!EDITABLE.has(S.drawing && S.drawing.kind)) return null;
    const sel = store.ui.carpentrySel;
    const r = sel && sel.unitId && S.rects.find((q) => q.id === sel.unitId);
    if (!r || !r.mod || r.mod.w.min === r.mod.w.max) return null;
    const yTop = toY(r.y1), yBot = toY(r.y0);
    if (p.y < yTop - 4 || p.y > yBot + 4) return null;
    const L = toX(r.x0), R = toX(r.x1);
    if (Math.abs(p.x - R) <= 7) return 'right';
    if (Math.abs(p.x - L) <= 7) return 'left';
    return null;
  }

  /* ───────── render ───────── */
  function render(refit = false) {
    if (!C.isActive()) return;
    const cur = C.current();
    const runId = cur ? cur.run.id : null;
    const changedRun = runId !== S.runId;
    S.runId = runId;
    S.runKind = cur ? cur.run.kind : null;
    if (!cur) {
      S.drawings = []; S.drawing = null; S.rects = [];
      sheet.replaceChildren(); S.svgEl = null;
      title.replaceChildren();
      strip.replaceChildren();
      fitGroup.hidden = true;
      empty.hidden = false;
      const any = Carp.listRuns().length;
      setKids(empty, h('p', { class: 'cwb__emptytitle' }, any ? 'Select a run to see its drawings' : 'No carpentry yet'),
        h('p', { class: 'cwb__emptytext' }, any ? 'Click a unit in the plan, or a run in the list on the left. Its elevation, plan, internal view, worktop and section appear here, and you can edit the units right in the drawing.' : 'Start from the architect’s layout or add a run from the panel on the left.'));
      tabBtns.forEach((b) => { b.disabled = true; b.setAttribute('aria-selected', 'false'); });
      leave3d();
      drawOverlay();
      return;
    }
    empty.hidden = true;
    fitGroup.hidden = false;
    try { S.drawings = Carp.drawings(runId) || []; } catch (err) { console.error('[carpentry] drawings failed', err); S.drawings = []; }
    const kinds = new Set(S.drawings.map((d) => d.kind));
    for (const t of WB_TABS) {
      const b = tabBtns.get(t.id);
      b.disabled = t.id === '3d' ? !app.view3d : !kinds.has(t.id);
    }
    if (S.tab === '3d' && !app.view3d) S.tab = 'elevation';
    if (!kinds.has(S.tab) && S.tab !== '3d') S.tab = kinds.has('elevation') ? 'elevation' : (S.drawings[0] && S.drawings[0].kind) || 'elevation';
    for (const t of WB_TABS) { const b = tabBtns.get(t.id), on = t.id === S.tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    S.drawing = S.tab === '3d' ? null : S.drawings.find((d) => d.kind === S.tab) || null;
    title.replaceChildren(h('span', { class: 'cwb__code num' }, cur.run.code), h('span', { class: 'cwb__name truncate' }, cur.run.name));
    renderStrip(cur);
    el.classList.toggle('is-3d', S.tab === '3d');
    p3d.hidden = S.tab !== '3d';
    if (S.tab === '3d') { sheet.replaceChildren(); S.svgEl = null; S.rects = []; render3d(cur, changedRun); drawOverlay(); return; }
    if (S.drawing) {
      let markup = '';
      try { markup = renderSVG(S.drawing, { lang: 'en', interactive: true, padding: 0, className: `cdraw--${S.drawing.kind}` }); } catch (err) { console.error('[carpentry] drawing render failed', err); }
      sheet.innerHTML = markup;
      S.svgEl = sheet.querySelector('svg');
      if (S.svgEl) { S.svgEl.removeAttribute('width'); S.svgEl.removeAttribute('height'); S.svgEl.classList.add('cdraw'); if (realRenderer) S.svgEl.classList.add('cdraw--shared'); }
    } else { sheet.replaceChildren(); S.svgEl = null; }
    computeRects();
    const key = `${runId}|${S.tab}`;
    if (refit || changedRun || S.fitted !== key || !S.userView) { const refitted = refit || changedRun || S.fitted !== key;
      if (refitted) { S.userView = false; S.fitWhole = false; }
      if (!S.userView) fit();
      S.fitted = key;
      const sel = store.ui.carpentrySel;
      if (refitted && sel && sel.unitId && sel.runId === runId) reveal(sel.unitId);
    }
    layout();
  }

  function renderStrip(cur) {
    const { run, units } = cur;
    const floor = units.filter((u) => rowOf(u) === 'floor'), wall = units.filter((u) => rowOf(u) === 'wall');
    const sum = (l) => Math.round(l.reduce((s, u) => s + u.carp.width, 0) * 10) / 10;
    const fU = sum(floor), wU = sum(wall), free = Math.round((run.length - fU) * 10) / 10;
    const cls = Math.abs(free) < 0.05 ? 'is-ok' : free < 0 ? 'is-over' : 'is-free';
    const cell = (k, v, c = '') => h('span', { class: `cwb__cell ${c}` }, h('span', { class: 'cwb__k' }, k), h('span', { class: 'cwb__v num' }, v));
    const status = Math.abs(free) < 0.05 ? 'Fits' : free > 0 ? `${num(free)} cm free` : `${num(-free)} cm too long`;
    setKids(strip,
      floor.length ? cell(run.kind === 'island' ? 'Island / run' : 'Floor row / run', `${num(fU)} / ${num(run.length)} cm`) : cell('Run', `${num(run.length)} cm`),
      wall.length ? cell('Wall row', `${num(wU)} cm`, 'cwb__cell--wall') : null,
      floor.length ? cell('Status', status, cls) : null);
    fitMain.classList.toggle('is-hot', Math.abs(free) >= 0.05 && floor.length > 0);
  }

  /** Phone: Elevation / Internal / Section open fitted to the sheet's height (readable units), starting at the run's left end. */
  const PHONE_TALL = new Set(['elevation', 'internal', 'section']);
  function fit() {
    const d = S.drawing;
    const W = view.clientWidth, H = view.clientHeight;
    if (!d || W < 20 || H < 20) return;
    const b = d.bounds, pad = Math.min(28, Math.max(10, Math.min(W, H) * 0.05));
    if (isPhone() && !S.fitWhole && PHONE_TALL.has(d.kind)) {
      S.scale = Math.max(0.05, (H - 2 * pad) / b.h);
      S.ox = b.w * S.scale + 2 * pad <= W ? W / 2 - (b.x + b.w / 2) * S.scale : pad - b.x * S.scale;
      S.oy = H / 2 + (b.y + b.h / 2) * S.scale;
      layout();
      return;
    }
    S.scale = Math.max(0.05, Math.min((W - 2 * pad) / b.w, (H - 2 * pad) / b.h));
    S.ox = W / 2 - (b.x + b.w / 2) * S.scale;
    S.oy = H / 2 + (b.y + b.h / 2) * S.scale;
    layout();
  }
  /** Phone: scroll a unit that is (partly) out of sight into view. */
  function reveal(unitId) {
    if (!isPhone() || !S.drawing) return;
    const r = S.rects.find((q) => q.id === unitId);
    const W = view.clientWidth, pad = 12;
    if (!r || W < 20) return;
    const L = toX(r.x0), R = toX(r.x1);
    if (L >= pad && R <= W - pad) return;
    S.ox += (R - L > W - 2 * pad) ? pad - L : W / 2 - (L + R) / 2;
    S.userView = true;
    layout();
  }
  function zoomAt(p, factor) {
    if (!S.drawing) return;
    const W = view.clientWidth, H = view.clientHeight;
    const q = p || { x: W / 2, y: H / 2 };
    const ns = clamp(S.scale * factor, 0.08, 40);
    const f = ns / S.scale;
    S.ox = q.x - (q.x - S.ox) * f; S.oy = q.y - (q.y - S.oy) * f; S.scale = ns;
    S.userView = true;
    layout();
  }
  /** Place the SVG for the current scale / origin (re-rasterised: crisp at every zoom). */
  function layout() {
    const svg = S.svgEl, d = S.drawing;
    if (svg && d) {
      const b = d.bounds;
      svg.style.left = `${toX(b.x)}px`;
      svg.style.top = `${toY(b.y + b.h)}px`;
      svg.style.width = `${b.w * S.scale}px`;
      svg.style.height = `${b.h * S.scale}px`;
    }
    drawOverlay();
  }

  /* ───────── overlay (screen px) ───────── */
  function svgEl(tag, attrs, kids = []) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    for (const c of kids) e.append(c);
    return e;
  }
  function drawOverlay() {
    ov.setAttribute('width', view.clientWidth); ov.setAttribute('height', view.clientHeight);
    const out = [];
    if (S.drawing && S.rects.length) {
      const sel = store.ui.carpentrySel || {};
      const flashed = C.flashed();
      const findings = S.runId ? C.findings(S.runId) : [];
      const sev = new Map(), texts = new Map();
      for (const f of findings) {
        if (f.severity === 'info') continue;
        for (const id of f.unitIds || []) {
          if (sev.get(id) !== 'error') sev.set(id, f.severity);
          texts.set(id, [...(texts.get(id) || []), (f.text && f.text.en) || f.code]);
        }
      }
      const g = S.gesture;
      for (const r of S.rects) {
        const x = toX(r.x0), y = toY(r.y1), w = (r.x1 - r.x0) * S.scale, hh = (r.y1 - r.y0) * S.scale;
        const isSel = r.id === sel.unitId, isHover = S.hover === r.id && !isSel, s = sev.get(r.id);
        const dragging = g && g.type === 'reorder' && g.unitId === r.id;
        if (isSel || isHover || flashed.has(r.id) || dragging) {
          out.push(svgEl('rect', { x, y, width: Math.max(1, w), height: Math.max(1, hh), class: `cov__u${isSel ? ' is-sel' : ''}${isHover ? ' is-hover' : ''}${flashed.has(r.id) ? ' is-flash' : ''}${dragging ? ' is-dragged' : ''}` }));
        }
        if (s) {
          out.push(svgEl('rect', { x: x + 1.5, y: y + 1.5, width: Math.max(1, w - 3), height: Math.max(1, hh - 3), class: `cov__find cov__find--${s}` }));
          const bx = x + w - 9, by = y + 9;
          const badge = svgEl('g', { class: `cov__badge cov__badge--${s}`, 'data-tip': texts.get(r.id).join(' · '), 'data-tip-side': 'top', role: 'img', 'aria-label': texts.get(r.id).join('. ') },
            [svgEl('circle', { cx: bx, cy: by, r: 7.5 }), svgEl('text', { x: bx, y: by + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, [document.createTextNode('!')])]);
          badge.addEventListener('pointerdown', (e) => { e.stopPropagation(); C.select(S.runId, r.id); store.setUI({ carpentryTab: 'checks' }); app.setPanelOpen('right', true); });
          out.push(badge);
        }
        if (isSel && EDITABLE.has(S.drawing.kind) && r.mod && r.mod.w.min !== r.mod.w.max) {
          for (const side of ['left', 'right']) {
            const gx = side === 'left' ? x : x + w;
            out.push(svgEl('rect', { x: gx - 3, y: y + hh / 2 - 14, width: 6, height: 28, rx: 3, class: `cov__grip${g && g.type === 'resize' && g.side === side ? ' is-active' : ''}` }));
          }
        }
      }
      // reorder ghost + insertion marker, palette drop marker
      const marker = (S.gesture && S.gesture.type === 'reorder' && S.gesture.marker) || S.drop;
      if (marker) {
        const x = toX(marker.x), y0 = toY(marker.y1), y1 = toY(marker.y0);
        out.push(svgEl('line', { x1: x, y1: y0 - 6, x2: x, y2: y1 + 6, class: 'cov__ins' }));
        out.push(svgEl('path', { d: `M${x - 6} ${y0 - 12}h12l-6 7z`, class: 'cov__insarrow' }));
      }
      if (S.gesture && S.gesture.type === 'reorder' && S.gesture.ghost) {
        const gh = S.gesture.ghost;
        out.push(svgEl('rect', { x: gh.x, y: gh.y, width: gh.w, height: gh.h, class: 'cov__ghost' }));
      }
    }
    ov.replaceChildren(...out);
  }

  /* ───────── live tip (readouts and refusals next to the cursor) ───────── */
  function showTip(p, text, kind = '') {
    tip.hidden = false;
    tip.className = `cwb__tip${kind ? ' is-' + kind : ''}`;
    tip.textContent = text;
    const W = view.clientWidth;
    tip.style.left = `${clamp(p.x + 14, 6, Math.max(6, W - tip.offsetWidth - 6))}px`;
    tip.style.top = `${Math.max(6, p.y - 34)}px`;
  }
  const hideTip = () => { tip.hidden = true; };

  /* ───────── gestures ───────── */
  const pointers = new Map();
  let pinch = null;
  view.addEventListener('pointerdown', (e) => {
    if (!S.drawing) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    try { view.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    if (pointers.size === 2) {
      cancelGesture();
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') { if (e.button === 1) S.gesture = { type: 'pan', last: p, start: p, moved: false }; return; }
    view.focus({ preventScroll: true });
    const callout = calloutAt(p);
    if (callout) { focusFeature(C, store, callout); app.setPanelOpen('right', true); return; }
    const side = gripAt(p);
    if (side) {
      const sel = store.ui.carpentrySel, r = S.rects.find((q) => q.id === sel.unitId);
      S.gesture = { type: 'resize', unitId: r.id, side, start: p, w0: r.unit.carp.width, last: r.unit.carp.width, began: false, mod: r.mod };
      e.preventDefault();
      return;
    }
    const r = unitAt(p, e.target);
    if (r && e.pointerType === 'touch' && isPhone()) {
      // Phone: one finger drags the drawing; a tap selects; press and hold arms the reorder drag.
      const g = { type: 'press', unitId: r.id, start: p, row: r.row, touch: true, armed: false, last: p };
      g.timer = setTimeout(() => { g.armed = true; if (S.gesture === g && EDITABLE.has(S.drawing && S.drawing.kind)) showTip(g.start, 'Drag to move this unit'); }, 380);
      S.gesture = g;
    } else if (r) {
      if (!store.ui.carpentrySel || store.ui.carpentrySel.unitId !== r.id) C.select(S.runId, r.id);
      S.gesture = { type: 'press', unitId: r.id, start: p, row: r.row };
    } else {
      S.gesture = { type: 'pan', last: p, start: p, moved: false, empty: true };
    }
  });
  view.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      S.ox += cx - pinch.cx; S.oy += cy - pinch.cy;
      zoomAt({ x: cx, y: cy }, d / pinch.d);
      pinch = { d, cx, cy };
      return;
    }
    const g = S.gesture;
    if (!g) { hover(p, e.target); return; }
    const far = Math.hypot(p.x - g.start.x, p.y - g.start.y) > SLOP;
    if (g.type === 'pan') {
      if (!g.moved && !far) return;
      g.moved = true;
      S.ox += p.x - g.last.x; S.oy += p.y - g.last.y; g.last = p; S.userView = true;
      view.classList.add('is-panning');
      layout();
    } else if (g.type === 'press' && g.touch && !g.armed) {
      if (!far) return;
      clearTimeout(g.timer);
      g.type = 'pan'; g.moved = true; g.empty = false;
      S.ox += p.x - g.last.x; S.oy += p.y - g.last.y; g.last = p; S.userView = true;
      view.classList.add('is-panning');
      layout();
    } else if (g.type === 'press') {
      if (far && EDITABLE.has(S.drawing.kind) && Math.abs(p.x - g.start.x) > SLOP) beginReorder(g, p);
    } else if (g.type === 'reorder') updateReorder(g, p);
    else if (g.type === 'resize') updateResize(g, p, e);
  });
  const endPointer = (e, cancelled) => {
    pointers.delete(e.pointerId);
    try { view.releasePointerCapture(e.pointerId); } catch (err) { /* not captured */ }
    if (pinch) { if (pointers.size < 2) pinch = null; S.gesture = null; return; }
    const g = S.gesture;
    S.gesture = null;
    view.classList.remove('is-panning', 'is-reordering');
    if (!g) return;
    if (g.timer) { clearTimeout(g.timer); hideTip(); }
    if (g.touch && g.type === 'press' && !cancelled) { S.noReveal = true; try { C.select(S.runId, g.unitId); } finally { S.noReveal = false; } }
    if (cancelled) { if (g.type === 'resize' && g.began) store.cancel(); hideTip(); drawOverlay(); return; }
    if (g.type === 'pan' && g.empty && !g.moved) { const sel = store.ui.carpentrySel; if (sel && sel.unitId) C.select(sel.runId, null); }
    else if (g.type === 'resize') { if (g.began) store.commit(); hideTip(); }
    else if (g.type === 'reorder') {
      hideTip();
      if (g.index != null && g.index !== g.from) C.run(() => Carp.moveUnit(g.unitId, g.index));
    }
    drawOverlay();
  };
  view.addEventListener('pointerup', (e) => endPointer(e, false));
  view.addEventListener('pointercancel', (e) => endPointer(e, true));
  view.addEventListener('pointerleave', () => { if (!S.gesture && S.hover) { S.hover = null; view.style.cursor = ''; drawOverlay(); } });
  view.addEventListener('dblclick', (e) => {
    const r = unitAt(local(e), e.target);
    if (r) { store.setUI({ carpentryTab: 'unit' }); app.setPanelOpen('right', true); }
    else { S.userView = false; S.fitWhole = true; fit(); }
  });
  view.addEventListener('wheel', (e) => {
    if (!S.drawing) return;
    e.preventDefault();
    const p = local(e);
    if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) { S.ox -= e.deltaX; S.userView = true; layout(); return; }
    const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    zoomAt(p, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
  }, { passive: false });
  view.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.gesture) { e.stopPropagation(); e.preventDefault(); const g = S.gesture; S.gesture = null; if (g.type === 'resize' && g.began) store.cancel(); hideTip(); view.classList.remove('is-reordering'); drawOverlay(); }
  });

  /** Special-requirement callout (numbered balloon, ops with role 'callout') under p → its featureId. */
  function calloutAt(p) {
    if (!S.drawing) return null;
    for (const o of S.drawing.ops) {
      if (o.role !== 'callout' || o.t !== 'arc' || !o.featureId) continue;
      if (Math.hypot(toX(o.cx) - p.x, toY(o.cy) - p.y) <= Math.max(8, o.r * S.scale + 3)) return o.featureId;
    }
    return null;
  }
  function hover(p, target) {
    if (!S.drawing) return;
    if (calloutAt(p)) { view.style.cursor = 'pointer'; if (S.hover) { S.hover = null; drawOverlay(); } return; }
    const side = gripAt(p);
    const r = side ? null : unitAt(p, target);
    const id = r ? r.id : null;
    view.style.cursor = side ? 'ew-resize' : r ? (EDITABLE.has(S.drawing.kind) ? 'grab' : 'pointer') : '';
    if (id !== S.hover) { S.hover = id; drawOverlay(); }
  }

  /* reorder */
  function rowRects(row, exclude) { return S.rects.filter((r) => r.row === row && r.id !== exclude).sort((a, b) => a.x0 - b.x0); }
  function insertion(row, xCm, exclude) {
    const list = rowRects(row, exclude);
    let index = list.filter((r) => (r.x0 + r.x1) / 2 < xCm).length;
    if (mirror()) index = list.length - index;
    const y0 = list.length ? Math.min(...list.map((r) => r.y0)) : row === 'wall' ? 145 : 0;
    const y1 = list.length ? Math.max(...list.map((r) => r.y1)) : row === 'wall' ? 220 : 90;
    const sorted = list;
    const k = mirror() ? sorted.length - index : index;
    const x = k <= 0 ? (sorted[0] ? sorted[0].x0 : 0) : sorted[k - 1].x1;
    return { index, marker: { x, y0, y1 } };
  }
  function beginReorder(g, p) {
    const r = S.rects.find((q) => q.id === g.unitId);
    if (!r) return;
    const got = Carp.getRun(S.runId);
    const order = C.ordered(got.run, got.units).filter((u) => rowOf(u) === r.row);
    g.type = 'reorder';
    g.from = order.findIndex((u) => u.id === g.unitId);
    g.dx = p.x - toX(r.x0);
    g.r = r;
    view.classList.add('is-reordering');
    updateReorder(g, p);
  }
  function updateReorder(g, p) {
    const r = g.r;
    const w = (r.x1 - r.x0) * S.scale, hh = (r.y1 - r.y0) * S.scale;
    g.ghost = { x: p.x - g.dx, y: toY(r.y1) + (p.y - g.start.y) * 0.15, w, h: hh };
    const centre = fromX(p.x - g.dx + w / 2);
    const ins = insertion(r.row, centre, g.unitId);
    g.index = ins.index; g.marker = ins.marker;
    const code = codeOf(g.unitId);
    showTip(p, g.index === g.from ? `${code}: drop to keep its place` : `Move ${code} to position ${g.index + 1}`);
    drawOverlay();
  }
  /* resize */
  function updateResize(g, p, e) {
    const sign = (g.side === 'right' ? 1 : -1) * (mirror() ? -1 : 1);
    const raw = g.w0 + sign * (p.x - g.start.x) / S.scale;
    const step = e.altKey ? 1 : 5;
    let w = Math.round(raw / step) * step;
    const m = g.mod;
    let note = '';
    if (w < m.w.min) { w = m.w.min; note = `${num(m.w.min)} cm is the narrowest ${m.name.en.toLowerCase()}`; }
    if (w > m.w.max) { w = m.w.max; note = `${num(m.w.max)} cm is the widest ${m.name.en.toLowerCase()}`; }
    if (w !== g.last) {
      if (!g.began) { store.begin(); g.began = true; }
      const res = Carp.setUnitWidth(g.unitId, w, { transient: true });
      if (res && res.ok) g.last = w;
      else note = (res && res.reason && res.reason.en) || 'Not possible here';
    }
    showTip(p, `${codeOf(g.unitId)} · ${num(g.last)} cm${g.last !== g.w0 ? ` (was ${num(g.w0)})` : ''}${note ? ` — ${note}` : ''}`, note ? 'warn' : '');
  }
  function cancelGesture() {
    const g = S.gesture;
    S.gesture = null;
    if (g && g.type === 'resize' && g.began) store.cancel();
    hideTip(); view.classList.remove('is-reordering', 'is-panning');
  }
  function codeOf(id) {
    const got = Carp.getRun(S.runId);
    return (got && Carp.unitCodes(got.run, got.units).get(id)) || 'Unit';
  }

  /* ───────── palette drops ───────── */
  C.on('palette-drag', (d) => { S.paletteModule = d ? d.module : null; if (!d && S.drop) { S.drop = null; drawOverlay(); } });
  view.addEventListener('dragover', (e) => {
    if (!S.drawing || !S.runId || !e.dataTransfer || ![...e.dataTransfer.types].includes(DND_MODULE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const m = Carp.MODULES[S.paletteModule];
    const row = m && m.level === 'wall' ? 'wall' : 'floor';
    const p = local(e);
    const ins = insertion(row, fromX(p.x));
    S.drop = { ...ins.marker, index: ins.index, row };
    showTip(p, `${m ? m.name.en : 'Unit'} → position ${ins.index + 1}`);
    drawOverlay();
  });
  view.addEventListener('dragleave', (e) => { if (!view.contains(e.relatedTarget)) { S.drop = null; hideTip(); drawOverlay(); } });
  view.addEventListener('drop', (e) => {
    const id = e.dataTransfer && e.dataTransfer.getData(DND_MODULE);
    const drop = S.drop;
    S.drop = null; hideTip();
    if (!id || !S.runId || !drop) { drawOverlay(); return; }
    e.preventDefault();
    const m = Carp.MODULES[id];
    const opts = { index: drop.index };
    if (m && m.level === 'any') opts.level = S.runKind === 'island' ? 'island' : drop.row === 'wall' ? 'wall' : 'base';
    if (id === 'custom') opts.internals = { layout: { columns: [{ flex: 1, cells: [{ flex: 1, kind: 'door' }] }] } };
    const got = Carp.getRun(S.runId);
    const unitId = C.addUnit(S.runId, id, opts);
    if (unitId) app.toast(`${m.name.en} added to ${got.run.code}`, { action: { label: 'Undo', fn: () => store.undo() } });
    drawOverlay();
  });

  /* ───────── 3D tab ───────── */
  const stageEl = () => document.getElementById('viewport');
  const T3 = { on: false, runId: null, prevMode: null, open: !!getPref('carp3dOpen'), cut: getPref('carp3dCut') !== false, studio: getPref('carp3dStudio') !== false };
  const PREF3 = { open: 'carp3dOpen', cut: 'carp3dCut', studio: 'carp3dStudio' };
  const toggle = (label, tipText, key) => h('button', { type: 'button', class: 'chip c3d__toggle', 'aria-pressed': String(!!T3[key]), 'data-tip': tipText, onClick: (e) => {
    T3[key] = !T3[key]; setPref(PREF3[key], T3[key]);
    e.currentTarget.setAttribute('aria-pressed', String(T3[key]));
    call(app.view3d, 'showCarpentry', { [key]: T3[key] });
  } }, label);
  const openFrontsBtn = toggle('Open fronts', 'Swing the doors open and pull the drawers out to see the internal layout', 'open');
  const studioBtn = toggle('Studio light', 'Light the run evenly with neutral white light so colours and details read true (the normal daylight returns when you leave this tab)', 'studio');
  const cutBtn = toggle('Cut away the room in front', 'Remove the facing wall and everything between the camera and the run', 'cut');
  const frameBtn = h('button', { type: 'button', class: 'btn btn--sm', 'data-tip': 'Bring the camera back onto the run', onClick: () => call(app.view3d, 'showCarpentry', { frame: true }) }, icon('target', { size: 15 }), h('span', null, 'Frame the run'));
  const c3dList = h('div', { class: 'c3d__checks', role: 'list', 'aria-label': 'Fit problems shown in 3D' });
  p3d.append(h('div', { class: 'c3d__bar' }, openFrontsBtn, studioBtn, cutBtn, frameBtn), c3dList,
    h('p', { class: 'c3d__hint' }, 'The run is shown in the 3D view above, beside a small key plan. Click a unit there to select it; drag to orbit, scroll to zoom. Units outlined in orange or red have a fit problem — the message is pinned on the unit and listed here. Units are made to measure: change them in the Elevation or Plan tab or in the inspector.'));
  /** Show the run in 3D (the stage switches to the 3D view while the tab is open), list its fit problems. */
  function render3d(cur, changedRun) {
    const runId = cur.run.id;
    if (!T3.on) {
      T3.on = true;
      // Carpentry lives in Plan and Split: show the 3D view beside a narrow key plan while the tab is open, then give the plan back.
      if (store.ui.mode === '2d') { T3.prevMode = '2d'; store.setUI({ mode: 'split' }); }
      stageEl()?.classList.add('is-carp3d');
      window.addEventListener('resize', fitPhone3d);
    }
    fitPhone3d();
    const first = T3.runId !== runId;
    T3.runId = runId;
    // two frames: the 3D canvas has picked up its new size (split / phone sheet) before the camera frames the run
    if (first || changedRun) requestAnimationFrame(() => requestAnimationFrame(() => call(app.view3d, 'showCarpentry', { runId, open: T3.open, cut: T3.cut, studio: T3.studio, frame: true })));
    const codes = Carp.unitCodes(cur.run, cur.units), list = C.findings(runId).filter((f) => f.severity !== 'info');
    setKids(c3dList, list.length ? list.map((f) => h('button', { type: 'button', role: 'listitem', class: `c3d__check c3d__check--${f.severity}`, onClick: () => { const id = (f.unitIds || [])[0]; if (id) { C.select(runId, id); C.flash(f.unitIds); } } },
      icon(f.severity === 'error' ? 'fail' : 'warn', { size: 14 }),
      h('span', { class: 'c3d__codes num' }, (f.unitIds || []).map((id) => codes.get(id)).filter(Boolean).join(' ') || cur.run.code),
      h('span', { class: 'c3d__text' }, (f.text && f.text.en) || f.code)))
      : [h('p', { class: 'c3d__ok' }, icon('check', { size: 14 }), h('span', null, 'No fit problems: the run fits the room.'))]);
  }
  /** Phone: the 3D tab's sheet covers the bottom of the stage — shorten the viewport by that overlap (cleared on leaving). */
  function fitPhone3d() {
    const vp = stageEl();
    if (!vp) return;
    if (!T3.on || !el.classList.contains('is-open') || !isPhone()) { vp.style.removeProperty('max-height'); return; }
    if (full) return;                                              // full height: the 3D view hides behind the sheet, keep its size
    vp.style.removeProperty('max-height');
    const over = vp.getBoundingClientRect().bottom - el.getBoundingClientRect().top;
    if (over > 1) vp.style.maxHeight = `calc(100% - ${Math.round(over)}px)`;   // the stage is a flex column in Carpentry mode
  }
  /** Leave the 3D tab state: clear the 3D overlays and go back to the view the user had before the tab opened. */
  function leave3d() {
    if (!T3.on) return;
    T3.on = false; T3.runId = null;
    window.removeEventListener('resize', fitPhone3d);
    stageEl()?.style.removeProperty('max-height');
    el.classList.remove('is-3d');
    p3d.hidden = true;
    call(app.view3d, 'showCarpentry', { runId: null });
    stageEl()?.classList.remove('is-carp3d');
    if (T3.prevMode && store.ui.mode === 'split') store.setUI({ mode: T3.prevMode });
    T3.prevMode = null;
  }

  /* ───────── store wiring ───────── */
  const schedule = rafThrottle((refit) => render(refit));
  store.on('carpentry', () => { if (C.isActive()) schedule(false); });
  store.on('plan', (e) => { if ((!e || !e.transient) && C.isActive()) schedule(false); });
  store.on('load', () => schedule(true));
  store.on('ui', (e) => {
    if (e.keys.includes('tool')) {
      if (C.isActive()) requestAnimationFrame(() => render(true));
      else { el.classList.remove('is-open'); cancelGesture(); leave3d(); }
    } else if (e.keys.includes('carpentrySel')) {
      const sel = store.ui.carpentrySel;
      if ((sel ? sel.runId : null) !== S.runId) schedule(true);
      else { drawOverlay(); if (sel && sel.unitId && !S.noReveal) reveal(sel.unitId); }
    }
  });
  C.on('flash', drawOverlay);
  C.on('focus', () => { S.userView = false; S.fitWhole = false; fit(); });
  rendererReady.then(() => { if (C.isActive()) render(false); });
  if (C.isActive()) requestAnimationFrame(() => render(true));
  return { render, fit };
}
