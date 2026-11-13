/**
 * UI entry point. Fills the shell from index.html (top bar, catalogue, right-hand tabs, viewport overlays, status
 * bar), owns view-mode switching, keyboard shortcuts, dialogs and exports.
 *
 *   const ui = initUI({ store, plan, catalog, models, view2d, view3d });
 *   ui.toast('Saved');  ui.openPanel('budget');
 *
 * The views come from other teams and may be missing methods (or be absent in test pages): every call into them is
 * feature-detected, and the UI never throws because of them.
 */
import { h, listen, debounce } from './dom.js';
import { icon } from './icons.js';
import { iconBtn } from './components.js';
import { toast, initTooltips, hasOpenLayer } from './dialogs.js';
import { applyTheme, getPref, setPref } from './prefs.js';
import { createThumbs } from './thumbs.js';
import { createActions } from './actions.js';
import { initTopbar } from './topbar.js';
import { initViewport } from './viewport.js';
import { initStatusbar } from './statusbar.js';
import { initKeyboard } from './keyboard.js';
import { initCatalogPanel } from './catalog-panel.js';
import { initInspector } from './inspector.js';
import { initBudget } from './budget.js';
import { initRooms } from './rooms.js';
import { initChecks } from './checks.js';
import { openWelcome, openShortcuts, openSettings, openItemMenu } from './sheets.js';

const TABS = [
  { id: 'inspector', label: 'Inspector', icon: 'inspector' },
  { id: 'budget', label: 'Shopping list', icon: 'list' },
  { id: 'rooms', label: 'Rooms', icon: 'rooms' },
  { id: 'checks', label: 'Checks', icon: 'checks' },
];
const COMPACT = '(max-width: 1099px)';
const PHONE = '(max-width: 699px)';

/**
 * @param {{ store: object, plan: object, catalog: object, models: object, view2d?: object, view3d?: object }} ctx
 * @returns {{ toast: Function, openPanel: Function, closePanels: Function, refreshCatalog: Function }}
 */
export function initUI(ctx) {
  const { store } = ctx;
  const root = document.getElementById('app');
  const left = document.getElementById('left');
  const right = document.getElementById('right');
  const mq = (q) => (typeof matchMedia === 'function' ? matchMedia(q) : { matches: false, addEventListener() {} });
  const compactMq = mq(COMPACT), phoneMq = mq(PHONE);

  applyTheme();
  initTooltips();

  const app = {
    ...ctx,
    toast,
    selectingFromPanel: false,
    pendingWalk: null,
    isCompact: () => compactMq.matches,
    isPhone: () => phoneMq.matches,
    openPanel, closePanels, setPanelOpen,
    closeDrawers: () => (compactMq.matches && (root.classList.contains('left-open') || root.classList.contains('right-open')) ? (closePanels(), true) : false),
    openWelcome: () => openWelcome(app),
    openShortcuts: () => { if (!hasOpenLayer()) openShortcuts(); },
    openSettings: () => openSettings(app),
  };
  app.thumbs = createThumbs(app);
  app.actions = createActions(app);

  /* ───────── Panels: docked on wide screens, drawers / sheets on narrow ones ───────── */
  function syncPanels() {
    const compact = compactMq.matches;
    root.classList.toggle('is-compact', compact);
    root.classList.toggle('left-collapsed', !compact && !getPref('leftOpen'));
    root.classList.toggle('right-collapsed', !compact && !getPref('rightOpen'));
    if (!compact) root.classList.remove('left-open', 'right-open');
    syncEdges();
  }
  function setPanelOpen(side, open) {
    if (compactMq.matches) {
      root.classList.toggle(`${side}-open`, open);
      if (open) root.classList.remove(side === 'left' ? 'right-open' : 'left-open');
    } else {
      setPref(side === 'left' ? 'leftOpen' : 'rightOpen', open);
      root.classList.toggle(`${side}-collapsed`, !open);
    }
    syncEdges();
    if (side === 'left' && open) catalogPanel && catalogPanel.relayout();
    viewport && viewport.resize();
  }
  function isOpen(side) {
    return compactMq.matches ? root.classList.contains(`${side}-open`) : !root.classList.contains(`${side}-collapsed`);
  }
  function closePanels() {
    if (!compactMq.matches) return;
    root.classList.remove('left-open', 'right-open');
    syncEdges();
  }
  /** Open a right-hand tab ('inspector' | 'budget' | 'rooms' | 'checks') or the catalogue ('catalog'). */
  function openPanel(name) {
    if (name === 'catalog') { setPanelOpen('left', true); return; }
    if (!TABS.some((t) => t.id === name)) return;
    store.setUI({ rightPanel: name });
    setPanelOpen('right', true);
  }

  /* ───────── Right sidebar: tabs ───────── */
  const tabButtons = new Map();
  const tabPanels = new Map();
  const checksBadge = h('span', { class: 'badge badge--tab', hidden: true });
  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Design panels' }, TABS.map((t) => {
    const b = h('button', { type: 'button', class: 'tab', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `panel-${t.id}`, 'aria-selected': 'false', tabindex: '-1',
      onClick: () => store.setUI({ rightPanel: t.id }) }, h('span', null, t.label), t.id === 'checks' ? checksBadge : null);
    tabButtons.set(t.id, b);
    return b;
  }));
  tablist.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === store.ui.rightPanel);
    const next = TABS[(i + dir + TABS.length) % TABS.length];
    store.setUI({ rightPanel: next.id });
    tabButtons.get(next.id).focus();
  });
  const body = h('div', { class: 'side__body' }, TABS.map((t) => {
    const p = h('div', { class: `tabpanel tabpanel--${t.id}`, role: 'tabpanel', id: `panel-${t.id}`, 'aria-labelledby': `tab-${t.id}`, tabindex: '-1', hidden: true });
    tabPanels.set(t.id, p);
    return p;
  }));
  right.append(h('header', { class: 'side__head side__head--tabs' }, tablist, iconBtn('panel-right', 'Hide this panel', { onClick: () => setPanelOpen('right', false) })), body);

  /* ───────── Build everything ───────── */
  let catalogPanel = null, viewport = null;
  initTopbar(document.getElementById('topbar'), app);
  viewport = initViewport(app);
  catalogPanel = initCatalogPanel(left, app);
  const panels = {
    inspector: initInspector(tabPanels.get('inspector'), app),
    budget: initBudget(tabPanels.get('budget'), app),
    rooms: initRooms(tabPanels.get('rooms'), app),
    checks: initChecks(tabPanels.get('checks'), app, (c) => {
      const n = c.fail + c.warn;
      checksBadge.hidden = !n;
      checksBadge.textContent = String(n);
      checksBadge.classList.toggle('badge--fail', c.fail > 0);
      tabButtons.get('checks').setAttribute('aria-label', n ? `Checks, ${n} to review` : 'Checks');
    }),
  };
  initStatusbar(document.getElementById('statusbar'), app);
  initKeyboard(app);

  function syncTab() {
    const current = TABS.some((t) => t.id === store.ui.rightPanel) ? store.ui.rightPanel : 'inspector';
    for (const t of TABS) {
      const on = t.id === current;
      tabButtons.get(t.id).setAttribute('aria-selected', String(on));
      tabButtons.get(t.id).tabIndex = on ? 0 : -1;
      tabPanels.get(t.id).hidden = !on;
      on ? panels[t.id].activate() : panels[t.id].deactivate();
    }
    syncNav();
  }

  /* ───────── Edge tabs (reopen a hidden sidebar) and the phone navigation ───────── */
  const edgeLeft = h('button', { type: 'button', class: 'edge edge--left', 'aria-label': 'Show the catalogue', 'data-tip': 'Catalogue', 'data-tip-side': 'right', onClick: () => setPanelOpen('left', true) }, icon('sofa', { size: 18 }));
  const edgeRight = h('button', { type: 'button', class: 'edge edge--right', 'aria-label': 'Show the inspector and lists', 'data-tip': 'Inspector, shopping list, rooms, checks', 'data-tip-side': 'left', onClick: () => setPanelOpen('right', true) }, icon('inspector', { size: 18 }));
  const scrim = h('div', { class: 'drawer-scrim', onClick: closePanels });
  document.getElementById('stage').append(edgeLeft, edgeRight, scrim);
  function syncEdges() {
    edgeLeft.hidden = isOpen('left');
    edgeRight.hidden = isOpen('right');
    syncNav();
  }

  const navButtons = new Map();
  const nav = h('nav', { class: 'mobnav', 'aria-label': 'Panels' },
    [{ id: 'catalog', label: 'Catalogue', icon: 'sofa' }, ...TABS.map((t) => ({ ...t, label: t.id === 'budget' ? 'List' : t.label }))].map((t) => {
      const b = h('button', { type: 'button', class: 'mobnav__btn', 'aria-pressed': 'false', onClick: () => {
        const open = t.id === 'catalog' ? isOpen('left') : isOpen('right') && store.ui.rightPanel === t.id;
        if (open) closePanels(); else openPanel(t.id);
      } }, icon(t.icon, { size: 20 }), h('span', null, t.label));
      navButtons.set(t.id, b);
      return b;
    }));
  root.append(nav);
  function syncNav() {
    for (const [id, b] of navButtons) {
      const on = id === 'catalog' ? isOpen('left') : isOpen('right') && store.ui.rightPanel === id;
      b.setAttribute('aria-pressed', String(compactMq.matches && on));
    }
  }

  /* ───────── Context menu on the views ───────── */
  listen(ctx.view2d, 'contextmenu', (p) => {
    if (!p) return;
    if (p.itemId && !store.selection.includes(p.itemId)) store.select([p.itemId]);
    const x = p.clientX ?? p.x, y = p.clientY ?? p.y;
    if (typeof x === 'number' && typeof y === 'number') openItemMenu(app, { x, y });
  });
  const pane2d = document.getElementById('pane2d');
  let downAt = null;
  pane2d.addEventListener('pointerdown', (e) => { if (e.button === 2) downAt = { x: e.clientX, y: e.clientY }; }, true);
  pane2d.addEventListener('contextmenu', (e) => {
    const still = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5;
    downAt = null;
    if (!store.selection.length) return;
    e.preventDefault();
    if (still) setTimeout(() => { if (!hasOpenLayer()) openItemMenu(app, { x: e.clientX, y: e.clientY }); }, 0);
  });

  /* ───────── Store wiring ───────── */
  let hadSelection = store.selection.length > 0;
  store.on('ui', (e) => { if (e.keys.includes('rightPanel')) syncTab(); });
  store.on('selection', () => {
    const has = store.selection.length > 0;
    // Selecting something in a view brings up the Inspector — unless a panel made the selection itself.
    if (has && !hadSelection && !app.selectingFromPanel && store.ui.rightPanel !== 'inspector' && !compactMq.matches) store.setUI({ rightPanel: 'inspector' });
    hadSelection = has;
  });
  store.on('load', debounce(() => catalogPanel.refresh(), 50));
  compactMq.addEventListener?.('change', syncPanels);
  app.onThemeChange = () => viewport.redrawMinimap();

  syncPanels();
  syncTab();
  root.classList.add('ui-ready');
  viewport.resize();

  if (!getPref('welcomed')) setTimeout(() => openWelcome(app), 350);

  return {
    toast,
    openPanel,
    closePanels,
    /** Call after the catalogue was (re)loaded. */
    refreshCatalog: () => catalogPanel.refresh(),
  };
}
