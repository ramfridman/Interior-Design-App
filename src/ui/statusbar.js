/**
 * Status bar, laid out like a drawing's title block: cursor position, room under the cursor, selection summary,
 * zoom, units and the autosave state. Cells have fixed widths so nothing shifts while the cursor moves.
 */
import { spaceAt } from '../core/geometry.js';
import { h, listen, rafThrottle } from './dom.js';
import { segmented } from './components.js';
import { fmtPrice, fmtLen, toUnit, unitDigits } from './format.js';
import { LEVELS, segmentTitle, openingTitle } from './structure.js';
import { storageAvailable } from './prefs.js';
import { icon } from './icons.js';
import { FEATURES, onFeatureChange } from '../core/features.js';
import { upperLevels } from '../core/levels.js';
import { viewPlan } from './levels.js';

/** @param {HTMLElement} root  @param {object} app */
export function initStatusbar(root, app) {
  const { store, catalog, view2d } = app;
  const x = h('span', { class: 'sb__val num' }, '—');
  const y = h('span', { class: 'sb__val num' }, '—');
  const room = h('span', { class: 'sb__room truncate' }, '');
  const selection = h('span', { class: 'sb__sel truncate' }, '');
  const zoom = h('span', { class: 'sb__val num' }, '');
  const ratio = h('span', { class: 'sb__val num' }, '');
  const units = segmented({ options: [{ value: 'm', label: 'm' }, { value: 'cm', label: 'cm' }], value: store.ui.units, label: 'Units', cls: 'seg--mini', onChange: (v) => store.setUI({ units: v }) });
  const saved = h('span', { class: 'sb__saved' }, '');

  // several floors: the floor shown (only while the levels feature is on)
  const levelText = h('span', { class: 'truncate' }, '');
  const levelCell = app.levels ? h('div', { class: 'sb__cell sb__cell--level levels-only', role: 'status', 'aria-live': 'polite', 'data-tip': 'Floor shown in the plan (PgUp / PgDn)', 'data-tip-side': 'top' }, icon('levels', { size: 14 }), levelText) : null;
  if (levelCell) { const paintLevel = () => { levelText.textContent = app.levels.statusText(); }; app.levels.onChange(paintLevel); paintLevel(); }
  if (levelCell) root.append(levelCell);
  root.append(
    h('div', { class: 'sb__cell sb__coords hide-phone', 'aria-hidden': 'true' }, h('span', { class: 'sb__key' }, 'X'), x, h('span', { class: 'sb__key' }, 'Y'), y),
    h('div', { class: 'sb__cell sb__cell--room hide-phone' }, room),
    h('div', { class: 'sb__cell sb__cell--grow', role: 'status', 'aria-live': 'polite' }, selection),
    h('div', { class: 'sb__cell hide-compact', 'data-tip': 'Drawing scale on a 96 dpi screen', 'data-tip-side': 'top' }, h('span', { class: 'sb__key' }, 'Scale'), ratio),
    h('div', { class: 'sb__cell hide-phone', 'data-tip': 'Zoom (100% = 1 px per cm)', 'data-tip-side': 'top' }, h('span', { class: 'sb__key' }, 'Zoom'), zoom),
    h('div', { class: 'sb__cell' }, units),
    h('div', { class: 'sb__cell sb__cell--saved', role: 'status', 'aria-live': 'polite' }, saved),
  );

  /* Cursor */
  let last = null;
  const paintCursor = rafThrottle(() => {
    if (!last) { x.textContent = '—'; y.textContent = '—'; room.textContent = ''; return; }
    const u = store.ui.units, d = unitDigits(u);
    x.textContent = toUnit(last.x, u).toFixed(d);
    y.textContent = toUnit(last.y, u).toFixed(d);
    const space = last.space || spaceAt(last.x, last.y, viewPlan(app));
    const name = space ? space.name : 'Outside the lot';
    if (room.textContent !== name) room.textContent = name;
  });
  listen(view2d, 'cursor', (p) => {
    last = p && typeof p.x === 'number' && typeof p.y === 'number' ? p : null;
    paintCursor();
  });

  /* Zoom */
  app.onZoom = (pxPerCm, scaleText) => { zoom.textContent = `${Math.round(pxPerCm * 100)}%`; ratio.textContent = scaleText || ''; };

  /* Selection */
  function paintSelection() {
    if (app.structure.isActive()) {
      // Structure mode: the selected wall / opening and its level.
      const cur = app.structure.selected();
      if (!cur) { selection.textContent = 'Structure: select a wall, door or window'; return; }
      const level = cur.type === 'segment' ? cur.seg.policy.level : cur.policy.level;
      const what = cur.type === 'segment' ? `${segmentTitle(cur.seg)}, ${fmtLen(cur.seg.length, store.ui.units)}` : `${openingTitle(cur.opening)}, ${cur.opening.width} × ${cur.opening.height} cm`;
      selection.textContent = `${what} — ${LEVELS[level] ? LEVELS[level].title : ''}`;
      return;
    }
    const items = store.getSelected();
    if (!items.length) {
      // several floors: what stands on the floor shown, and in the whole design (carpentry units count on their run's floor)
      if (FEATURES.levels && upperLevels(app.plan).length) {
        const lv = store.ui.level || 'L0', runs = (store.carpentry && store.carpentry.runs) || {};
        const floorOf = (it) => it.level || (it.carp && runs[it.carp.runId] && runs[it.carp.runId].level) || 'L0';
        const here = store.items.filter((it) => floorOf(it) === lv).length;
        selection.textContent = `${here} ${here === 1 ? 'item' : 'items'} on this floor · ${store.items.length} in the design`;
      } else selection.textContent = `${store.items.length} items in the design`;
      return;
    }
    let cost = 0;
    for (const it of items) { try { cost += catalog.itemCost(it) || 0; } catch (err) { /* ignore */ } }
    const what = items.length === 1 ? items[0].name : `${items.length} items selected`;
    selection.textContent = cost > 0 ? `${what} — ${fmtPrice(cost)}` : what;
  }

  /* Autosave */
  const canStore = storageAvailable();
  let timer = 0;
  function markSaved() { saved.textContent = canStore ? 'Saved in this browser' : 'Not saved — use Save design'; saved.classList.toggle('is-warn', !canStore); }
  store.on('*', (event, payload) => {
    if (event === 'selection' || event === 'history' || (payload && payload.transient)) return;
    if (!canStore) return;
    saved.textContent = 'Saving…';
    clearTimeout(timer);
    timer = setTimeout(markSaved, 700);
  });

  store.on('selection', paintSelection);
  store.on('items', (e) => { if (!e.transient) paintSelection(); });
  store.on('ui', (e) => {
    if (e.keys.includes('units')) { units.set(store.ui.units); paintCursor(); }
    if (e.keys.includes('units') || e.keys.includes('tool') || e.keys.includes('structureSel') || e.keys.includes('level')) paintSelection();
  });
  const repaintStructure = rafThrottle(() => { if (app.structure.isActive()) paintSelection(); });
  store.on('plan', repaintStructure);
  store.on('plan', (e) => { if (!e || !e.transient) paintSelection(); });
  onFeatureChange(() => paintSelection());
  paintSelection();
  markSaved();
}
