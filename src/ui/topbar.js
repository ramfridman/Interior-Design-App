/**
 * Top bar: product mark + project name, undo / redo, the Furnish | Structure switch with the tools of the current
 * mode, the view switch, plan-display toggles, the "plan modified" chip, the live budget and the file / settings /
 * help menus. On narrow screens the structure tools float over the plan instead (same element, moved).
 */
import { h, debounce, rafThrottle, isMac } from './dom.js';
import { icon } from './icons.js';
import { iconBtn, segmented } from './components.js';
import { openMenu } from './dialogs.js';
import { canPrint } from './exporter.js';
import { fmtPrice } from './format.js';
import { shoppingTotal } from './shopping.js';
import { WALL_THICKNESSES } from './structure.js';
import { STRUCTURE_TOOL_LIST, planChip } from './structure-panels.js';

const MOD = isMac() ? '⌘' : 'Ctrl';

export const VIEW_MODES = [
  { value: '2d', label: 'Plan', icon: 'plan', kbd: '1' },
  { value: '3d', label: '3D', icon: 'cube', kbd: '2' },
  { value: 'walk', label: 'Walk', icon: 'walk', kbd: '3' },
  { value: 'split', label: 'Split', icon: 'split', kbd: '4' },
];
const TOOLS = [
  { value: 'select', label: 'Select', icon: 'select', kbd: 'V' },
  { value: 'pan', label: 'Pan', icon: 'pan', kbd: 'H' },
  { value: 'measure', label: 'Measure', icon: 'measure', kbd: 'M' },
];
const EDIT_MODES = [
  { value: 'furnish', label: 'Furnish', tip: 'Furnish: place and arrange products', kbd: 'B' },
  { value: 'structure', label: 'Structure', tip: 'Structure: change walls, doors and windows', kbd: 'B' },
];
const TOGGLES = [
  { key: 'snap', label: 'Snap to walls and grid', icon: 'snap' },
  { key: 'showGrid', label: 'Grid', icon: 'grid', kbd: 'G' },
  { key: 'showDimensions', label: 'Dimensions', icon: 'dimensions' },
  { key: 'showRoomLabels', label: 'Room labels', icon: 'labels' },
  { key: 'showSite', label: 'Lot and setbacks', icon: 'site' },
];

/** @param {HTMLElement} root  @param {object} app */
export function initTopbar(root, app) {
  const { store, actions, structure } = app;

  /* Mark + project name */
  const mark = h('div', { class: 'mark', 'aria-hidden': 'true' }, h('span', { class: 'mark__text display' }, app.plan.meta.model || 'E7'));
  const name = h('input', { class: 'projname display', type: 'text', value: store.project.name, 'aria-label': 'Project name', spellcheck: 'false', maxlength: '60', autocomplete: 'off',
    onKeydown: (e) => { if (e.key === 'Enter') name.blur(); if (e.key === 'Escape') { name.value = store.project.name; name.blur(); e.stopPropagation(); } },
    onBlur: () => { const v = name.value.trim() || app.plan.meta.name; name.value = v; if (v !== store.project.name) store.setProject({ name: v }); } });

  /* History */
  const undo = iconBtn('undo', 'Undo', { kbd: `${MOD} Z`, onClick: actions.undo });
  const redo = iconBtn('redo', 'Redo', { kbd: `${MOD} ⇧ Z`, onClick: actions.redo });

  /* Furnish | Structure, and the tools of each mode */
  const editMode = segmented({ options: EDIT_MODES, value: structure.isActive() ? 'structure' : 'furnish', label: 'Editing mode', cls: 'seg--mode',
    onChange: (v) => (v === 'structure' ? structure.enter() : structure.exit()) });
  const editBadge = h('span', { class: 'badge', hidden: true });
  const editBtn = iconBtn('wall', 'Structure: change walls, doors and windows', { kbd: 'B', pressed: structure.isActive(), class: 'only-compact modebtn', onClick: () => structure.toggle() });
  editBtn.append(editBadge);
  const tools = segmented({ options: TOOLS, value: store.ui.tool, iconOnly: true, label: 'Tool', cls: 'seg--tools', onChange: (tool) => store.setUI({ tool }) });

  const sTools = segmented({ options: STRUCTURE_TOOL_LIST.map((t) => ({ value: t.value, label: t.long, icon: t.icon, kbd: t.kbd })), value: store.ui.tool, iconOnly: true, iconSize: 18,
    label: 'Structure tool', cls: 'seg--tools seg--stools', onChange: (tool) => structure.setTool(tool) });
  const thickness = segmented({ options: WALL_THICKNESSES.map((v) => ({ value: v, label: String(v), tip: `Draw ${v} cm walls` })), value: store.ui.wallThickness,
    label: 'Thickness of new walls, in centimetres', cls: 'seg--thick', onChange: (v) => { store.setUI({ wallThickness: v }); structure.setTool('wall'); } });
  const showChanges = iconBtn('changes', 'Highlight changes to the architect’s plan', { pressed: !!store.ui.showPlanChanges, onClick: () => store.setUI({ showPlanChanges: !store.ui.showPlanChanges }) });
  const resetPlanBtn = iconBtn('reset', 'Reset to architect’s plan…', { onClick: () => structure.reset() });
  const structureBar = h('div', { class: 'sbar', role: 'group', 'aria-label': 'Structure tools' },
    sTools,
    h('div', { class: 'sbar__thick', 'data-tip': 'Thickness of new walls' }, icon('wall', { size: 16 }), thickness, h('span', { class: 'sbar__unit' }, 'cm')),
    h('span', { class: 'sbar__sep', 'aria-hidden': 'true' }),
    h('div', { class: 'sbar__plan' }, showChanges, resetPlanBtn));
  const structureHost = h('div', { class: 'topbar__group topbar__structure' });
  const structureFloat = h('div', { class: 'ov__tc sbar-float' });
  document.getElementById('ov2d')?.append(structureFloat);
  const placeStructureBar = () => (app.isCompact() ? structureFloat : structureHost).append(structureBar);
  if (typeof matchMedia === 'function') matchMedia('(max-width: 1099px)').addEventListener?.('change', placeStructureBar);

  const chip = planChip(app);
  const views = segmented({ options: VIEW_MODES, value: store.ui.mode, label: 'View', cls: 'seg--views', onChange: (mode) => actions.setMode(mode) });

  /* Display toggles (inline on wide screens, in a menu on narrow ones) */
  const toggleBtns = TOGGLES.map((t) => {
    const b = iconBtn(t.icon, t.label, { kbd: t.kbd, pressed: !!store.ui[t.key], onClick: () => store.setUI({ [t.key]: !store.ui[t.key] }) });
    b.dataset.key = t.key;
    return b;
  });
  const togglesMenuBtn = iconBtn('site', 'Plan display', { class: 'only-compact toggles-menu', onClick: () => openMenu(togglesMenuBtn, [
    ...TOGGLES.map((t) => ({ label: t.label, checked: !!store.ui[t.key], kbd: t.kbd, onSelect: () => store.setUI({ [t.key]: !store.ui[t.key] }) })),
    { separator: true },
    { label: 'Changes to the architect’s plan', checked: !!store.ui.showPlanChanges, onSelect: () => store.setUI({ showPlanChanges: !store.ui.showPlanChanges }) },
  ], { placement: 'bottom-end' }) });
  togglesMenuBtn.setAttribute('aria-haspopup', 'menu');

  /* Budget */
  const budgetValue = h('span', { class: 'budget__value num' }, fmtPrice(0));
  const budgetMeta = h('span', { class: 'budget__meta' }, '');
  const budget = h('button', { type: 'button', class: 'budget', 'data-tip': 'Open the shopping list', onClick: () => app.openPanel('budget') },
    h('span', { class: 'budget__label' }, 'Budget'), budgetValue, budgetMeta);
  const refreshBudget = debounce(() => {
    const t = shoppingTotal(app);
    budgetValue.textContent = fmtPrice(t.total);
    budgetMeta.textContent = t.pending ? `${t.pending} to choose` : '';
    budgetMeta.hidden = !t.pending;
    budget.setAttribute('aria-label', `Budget ${fmtPrice(t.total)}${t.pending ? `, ${t.pending} items still to choose` : ''}. Open the shopping list`);
    fit();
  }, 120);

  /* Menus */
  const fileBtn = iconBtn('more', 'File and export', { onClick: () => openMenu(fileBtn, fileMenu(), { placement: 'bottom-end' }) });
  fileBtn.setAttribute('aria-haspopup', 'menu');
  const settingsBtn = iconBtn('settings', 'Settings', { class: 'hide-phone', onClick: () => app.openSettings() });
  const helpBtn = iconBtn('help', 'Help', { class: 'hide-phone', onClick: () => openMenu(helpBtn, [
    { label: 'Keyboard shortcuts', icon: 'keyboard', kbd: '?', onSelect: () => app.openShortcuts() },
    { label: 'Welcome and house facts', icon: 'home', onSelect: () => app.openWelcome() },
  ], { placement: 'bottom-end' }) });
  helpBtn.setAttribute('aria-haspopup', 'menu');

  function fileMenu() {
    const compact = app.isCompact();
    return [
      { label: 'Save design', icon: 'save', kbd: `${MOD} S`, onSelect: actions.saveDesign },
      { label: 'Open design…', icon: 'open', onSelect: actions.openDesign },
      { label: "Reset to architect's layout…", icon: 'reset', onSelect: actions.resetLayout },
      { separator: true },
      { label: 'Export plan as PNG', icon: 'image', onSelect: actions.exportPlanPNG },
      { label: 'Export 3D snapshot', icon: 'camera', onSelect: actions.export3DSnapshot },
      { label: 'Export shopping list as CSV', icon: 'table', onSelect: actions.exportCSV },
      canPrint()
        ? { label: 'Print shopping list', icon: 'print', onSelect: actions.printShoppingList }
        : { label: 'Copy shopping list', icon: 'copy', onSelect: actions.copyShoppingList },
      compact && { separator: true },
      compact && { label: 'Settings', icon: 'settings', onSelect: () => app.openSettings() },
      compact && { label: 'Keyboard shortcuts', icon: 'keyboard', onSelect: () => app.openShortcuts() },
      compact && { label: 'Welcome and house facts', icon: 'home', onSelect: () => app.openWelcome() },
      compact && { heading: 'Tool' },
      ...(compact && !structure.isActive() ? TOOLS.map((t) => ({ label: t.label, icon: t.icon, checked: store.ui.tool === t.value ? true : undefined, onSelect: () => store.setUI({ tool: t.value }) })) : []),
      ...(compact && structure.isActive() ? STRUCTURE_TOOL_LIST.map((t) => ({ label: t.long, icon: t.icon, checked: store.ui.tool === t.value ? true : undefined, onSelect: () => structure.setTool(t.value) })) : []),
    ];
  }

  const center = h('div', { class: 'topbar__center' }, views);
  root.append(
    h('div', { class: 'topbar__group topbar__brand' }, mark, name),
    h('div', { class: 'topbar__group', role: 'group', 'aria-label': 'History' }, undo, redo),
    h('div', { class: 'topbar__group topbar__edit' }, h('div', { class: 'hide-compact' }, editMode), editBtn),
    h('div', { class: 'topbar__group topbar__furnish hide-phone' }, tools),
    structureHost,
    center,
    h('div', { class: 'topbar__group topbar__toggles hide-compact', role: 'group', 'aria-label': 'Plan display' }, toggleBtns),
    h('div', { class: 'topbar__group topbar__end' }, togglesMenuBtn, chip, budget, fileBtn, settingsBtn, helpBtn),
  );
  placeStructureBar();

  /*
   * Fit: the bar holds more in Structure mode and once the plan is modified. When it gets cramped the least important
   * things give way first — classes fit1 … fit6 on the bar, cumulative (see layout.css) — instead of anything overlapping.
   */
  const FIT_STEPS = 6;
  const cramped = () => (name.offsetParent !== null && name.offsetWidth < 96)
    || views.offsetWidth > center.clientWidth + 0.5 || root.lastElementChild.getBoundingClientRect().right > root.getBoundingClientRect().right + 0.5;
  const fit = rafThrottle(() => {
    for (let i = 1; i <= FIT_STEPS; i++) root.classList.remove(`fit${i}`);
    for (let i = 1; i <= FIT_STEPS && cramped(); i++) root.classList.add(`fit${i}`);
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(root);

  /* Store → controls */
  const syncHistory = () => { const s = store.historyState(); undo.disabled = !s.canUndo; redo.disabled = !s.canRedo; };
  const syncUI = () => {
    const on = structure.isActive();
    editMode.set(on ? 'structure' : 'furnish');
    editBtn.setPressed(on);
    tools.set(on ? null : store.ui.tool);
    sTools.set(on ? store.ui.tool : null);
    thickness.set(store.ui.wallThickness);
    showChanges.setPressed(!!store.ui.showPlanChanges);
    views.set(store.ui.mode);
    toggleBtns.forEach((b) => b.setPressed(!!store.ui[b.dataset.key]));
    fit();
  };
  const syncPlan = () => {
    chip.refresh();
    const modified = structure.isModified(), n = structure.diff().items.length;
    resetPlanBtn.disabled = !modified;
    editBadge.hidden = !modified;
    editBadge.textContent = String(n || '•');
    editBtn.setAttribute('aria-label', `Structure: change walls, doors and windows${modified ? ` (plan modified, ${n} ${n === 1 ? 'change' : 'changes'})` : ''}`);
    fit();
  };
  store.on('plan', (e) => { if (!e || !e.transient) syncPlan(); });
  store.on('load', syncPlan);
  store.on('history', syncHistory);
  store.on('ui', syncUI);
  store.on('project', () => { if (document.activeElement !== name) name.value = store.project.name; refreshBudget(); });
  store.on('items', (e) => { if (!e.transient) refreshBudget(); });
  store.on('finishes', refreshBudget);
  store.on('plan', (e) => { if (!e || !e.transient) refreshBudget(); });
  syncHistory(); syncUI(); syncPlan(); refreshBudget();
}

