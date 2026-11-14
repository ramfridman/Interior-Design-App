/**
 * Dialog sheets: first-run welcome, keyboard shortcuts, settings, and the item context menu.
 */
import { areaM2 } from '../core/geometry.js';
import { h, setKids } from './dom.js';
import { icon } from './icons.js';
import { btn, segmented, numField, toggle, kbd } from './components.js';
import { openDialog, openMenu } from './dialogs.js';
import { SHORTCUTS } from './keyboard.js';
import { planSvg } from './plan-svg.js';
import { applyTheme, getPref, setPref } from './prefs.js';
import { isBuiltinBase, planPhase } from '../core/plan-edit.js';
import { FEATURES, setFeature } from '../core/features.js';
import { upperLevels } from '../core/levels.js';

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/**
 * Verified facts about the house, all read from PLAN (nothing typed in by hand).
 * @returns {Array<[label: string, value: string, sub?: string]>}
 */
export function houseFacts(plan, store) {
  const m = plan.meta || {};
  const facts = plan.walls.length ? [['Footprint', `${(plan.bounds.w / 100).toFixed(2)} × ${(plan.bounds.h / 100).toFixed(2)} m`, 'outer walls']] : [['House', 'not drawn yet', 'Structure → draw walls']];
  if (m.grossFloorArea) facts.push(['Floor area', `${m.grossFloorArea} m²`, 'ground floor, as drawn']);
  const lot = plan.site && plan.site.boundary;
  if (lot && lot.length >= 4) {
    const ew = Math.round(dist(lot[0], lot[1]) / 100), ns = Math.round(dist(lot[3], lot[0]) / 100);
    facts.push(['Lot', `≈ ${Math.round(areaM2(lot) / 10) * 10} m²`, `${ew} × ${ns} m`]);
  }
  facts.push(['Ceiling', `${((store ? store.project.ceilingHeight : plan.heights.ceiling) / 100).toFixed(2)} m`, 'floor to ceiling']);
  const rooms = plan.rooms || [];
  const count = (...types) => rooms.filter((r) => types.includes(r.type)).length;
  const beds = count('bedroom', 'mamad'), baths = count('bathroom'), wcs = count('wc');
  if (!isBuiltinBase() && rooms.length) facts.push(['Rooms', `${rooms.length}`, `${Math.round(rooms.reduce((a, r) => a + areaM2(r.polygon), 0))} m² inside`]);
  else if (beds) {
    const sub = [count('mamad') ? 'incl. safe room' : '', baths ? `${baths} ${baths === 1 ? 'bath' : 'baths'}${wcs ? ' + WC' : ''}` : ''].filter(Boolean).join(', ');
    facts.push(['Rooms', `${beds} bedrooms`, sub]);
  }
  const bays = plan.site && plan.site.parking ? plan.site.parking.length : 0;
  if (bays) facts.push(['Parking', `${bays} ${bays === 1 ? 'bay' : 'bays'}`, 'on the lot']);
  return facts;
}

/** First-run welcome (also reachable from Help). */
export function openWelcome(app) {
  const { plan, store } = app;
  const m = plan.meta || {};
  const builtin = isBuiltinBase();
  const title = builtin && m.lot ? `House ${m.lot}, Kibbutz Afikim (model ${m.model || 'E7'})` : store.project.name || m.name;
  const open = (plan.assumptions || []).filter((a) => a.status !== 'confirmed');
  const tip = (name, head, text) => h('li', { class: 'tips__row' }, h('span', { class: 'tips__icon' }, icon(name, { size: 18 })), h('div', null, h('p', { class: 'tips__head' }, head), h('p', { class: 'tips__text' }, text)));
  // The drawing and the facts are read from PLAN, which the owner can edit (and undo) — redraw them when it changes.
  const drawing = h('div', { class: 'welcome__drawing' });
  const facts = h('dl', { class: 'titleblock' });
  const drawPlan = () => {
    if (!plan.walls.length) { setKids(drawing, h('p', { class: 'welcome__empty' }, 'No house drawn yet.')); setKids(facts, houseFacts(plan, store).map(([k, v, sub]) => h('div', { class: 'titleblock__cell' }, h('dt', null, k), h('dd', { class: 'num' }, v, sub ? h('small', null, sub) : null)))); return; }
    setKids(drawing, planSvg(plan, { pad: 80 }));
    setKids(facts, houseFacts(plan, store).map(([k, v, sub]) => h('div', { class: 'titleblock__cell' }, h('dt', null, k), h('dd', { class: 'num' }, v, sub ? h('small', null, sub) : null))));
  };
  drawPlan();
  const offPlan = store.on('plan', drawPlan);
  const offBase = store.on('base', () => dlg.close());     // another project was opened: this one's facts are stale
  const body = h('div', { class: 'welcome' },
    h('div', { class: 'welcome__plan' }, drawing,
      h('p', { class: 'welcome__caption' }, builtin ? [m.architect ? `Drawn from ${m.architect}` : 'Drawn from the architect’s plan', m.drawingScale ? `, ${m.drawingScale}` : '']
        : [m.location || 'Your own plan', planPhase() === 'draft' ? ' · draft' : ' · as built'])),
    h('div', { class: 'welcome__text' },
      h('p', { class: 'welcome__lead' }, builtin ? 'Furnish and landscape your real house. The plan is measured from the architect’s drawing, every product is on sale in Israel with its price and shop link, and you can walk through the result in 3D.'
        : 'Furnish and landscape your house. Every product is on sale in Israel with its price and shop link, and you can walk through the result in 3D.'),
      facts,
      !builtin ? h('ul', { class: 'tips' },
        planPhase() === 'draft' ? tip('wall', 'Draw the house as it is', 'Press B for Structure and W for the wall tool, then drag each wall. Add doors and windows, name the rooms, and press “This is the house as built” when the plan is right.') : null,
        tip('sofa', 'Drag products onto the plan', 'Or press the + on a product card, then click where it goes. Floors and wall finishes apply to the room you click.'),
        tip('carpentry', 'Design the made-to-measure carpentry', 'Press C for Carpentry: add kitchen, wardrobe and vanity runs along your walls and prepare a quotation package for carpenters.'),
        tip('walk', 'Walk through and keep an eye on the budget', 'Press 3 to walk the house and watch the sun move through the rooms. The shopping list adds up prices as you place things.'),
        tip('plan', 'Several projects', 'The project name at the top left switches between projects, creates new ones and exports a project to one file.'))
      : h('ul', { class: 'tips' },
        tip('sofa', 'Drag products onto the plan', 'Or press the + on a product card, then click where it goes. Floors and wall finishes apply to the room you click.'),
        tip('swap', 'Swap the architect’s placeholders', 'The furniture already on the plan has no product yet. Select a piece and pick a real one in the Inspector.'),
        tip('carpentry', 'Design the made-to-measure carpentry', 'Press C for Carpentry: start from the architect’s kitchen, wardrobes and vanities, edit units right in the elevation, and prepare a quotation package for carpenters.'),
        tip('wall', 'Change walls, doors and windows', 'Press B for Structure. Partitions and interior doors are yours to change; the app says what needs your engineer or a permit, and what is locked.'),
        tip('walk', 'Walk through and keep an eye on the budget', 'Press 3 to walk the house and watch the sun move through the rooms. The shopping list adds up prices as you place things.')),
      open.length ? h('details', { class: 'welcome__assume' },
        h('summary', null, `${open.length} ${open.length === 1 ? 'assumption' : 'assumptions'} to confirm${builtin ? ' with the architect' : ''}`),
        h('ul', null, open.map((a) => h('li', null, a.text)))) : null));
  const dlg = openDialog({
    title, size: 'xl', cls: 'dialog--welcome', body,
    actions: [btn('Keyboard shortcuts', { variant: 'quiet', icon: 'keyboard', onClick: () => { dlg.close(); openShortcuts(); } }), btn('Start designing', { variant: 'primary', onClick: () => dlg.close() })],
    onClose: () => { offPlan(); offBase(); setPref('welcomed', true); },
  });
  return dlg;
}

/** Keyboard shortcuts sheet. */
export function openShortcuts() {
  return openDialog({
    title: 'Keyboard shortcuts', size: 'lg',
    body: h('div', { class: 'shortcuts' }, SHORTCUTS.map((g) => h('section', { class: 'shortcuts__group' },
      h('h3', { class: 'sec__title' }, g.group),
      h('dl', { class: 'shortcuts__list' }, g.rows.map(([keys, label]) => h('div', { class: 'shortcuts__row' }, h('dt', null, label), h('dd', null, kbd(...keys)))))))),
  });
}

/** Settings sheet. */
export function openSettings(app) {
  const { store, actions } = app;
  const colour = (label, key) => {
    const input = h('input', { type: 'color', class: 'swatch swatch--custom', value: store.project[key] || '#ffffff', 'aria-label': label, onChange: () => store.setProject({ [key]: input.value }) });
    return h('label', { class: 'setrow' }, h('span', { class: 'setrow__label' }, label), input);
  };
  const grid = h('select', { class: 'select', 'aria-label': 'Grid step', onChange: () => store.setUI({ gridStep: Number(grid.value) }) },
    [1, 5, 10, 25, 50].map((v) => h('option', { value: String(v), selected: store.ui.gridStep === v }, `${v} cm`)));
  const body = h('div', { class: 'settings' },
    h('section', { class: 'settings__group' }, h('h3', { class: 'sec__title' }, 'Appearance'),
      h('div', { class: 'setrow' }, h('span', { class: 'setrow__label' }, 'Theme'),
        segmented({ options: [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], value: getPref('theme'), label: 'Theme',
          onChange: (v) => { setPref('theme', v); applyTheme(v); app.onThemeChange && app.onThemeChange(); } }))),
    h('section', { class: 'settings__group' }, h('h3', { class: 'sec__title' }, 'Measuring'),
      h('div', { class: 'setrow' }, h('span', { class: 'setrow__label' }, 'Units'),
        segmented({ options: [{ value: 'm', label: 'Metres' }, { value: 'cm', label: 'Centimetres' }], value: store.ui.units, label: 'Units', onChange: (v) => store.setUI({ units: v }) })),
      h('label', { class: 'setrow' }, h('span', { class: 'setrow__label' }, 'Grid step'), grid),
      toggle({ label: 'Snap to walls, grid and other items', checked: store.ui.snap, onChange: (v) => store.setUI({ snap: v }) })),
    h('section', { class: 'settings__group' }, h('h3', { class: 'sec__title' }, 'House'),
      h('div', { class: 'setrow' }, h('span', { class: 'setrow__label' }, 'Ceiling height', isBuiltinBase() ? h('small', { class: 'faint' }, 'Confirmed by the owner: 3.00 m') : null),
        numField({ value: store.project.ceilingHeight, min: 220, max: 450, step: 5, suffix: 'cm', title: 'Ceiling height in centimetres', onCommit: (v) => store.setProject({ ceilingHeight: Math.round(v) }) })),
      colour('Interior wall paint', 'wallColor'), colour('Exterior render', 'exteriorColor'), colour('Window and door frames', 'frameColor')),
    h('section', { class: 'settings__group' }, h('h3', { class: 'sec__title' }, 'Design'),
      h('div', { class: 'settings__buttons' },
        btn('Show the welcome again', { small: true, onClick: () => { dlg.close(); openWelcome(app); } }),
        isBuiltinBase() ? btn("Reset to architect's layout…", { small: true, icon: 'reset', onClick: () => { dlg.close(); actions.resetLayout(); } }) : null)),
    experimentalGroup(app));
  const dlg = openDialog({ title: 'Settings', size: 'md', body, actions: [btn('Done', { variant: 'primary', onClick: () => dlg.close() })] });
  return dlg;
}

/**
 * Settings → Experimental: features still in development that the owner can try in the published preview (where a URL
 * switch is not reachable). The choice is remembered in this browser (core/features.js).
 */
function experimentalGroup(app) {
  const note = h('p', { class: 'setnote setnote--warn', role: 'status', hidden: true });
  const paintNote = () => {
    const kept = !FEATURES.levels && upperLevels(app.plan).length > 0;
    note.hidden = !kept;
    note.textContent = kept ? `This project has ${upperLevels(app.plan).length + 1} floors. They are kept with the project; with the switch off only the ground floor's controls are shown. Turn it on again to see and edit the other floors.` : '';
  };
  const sw = toggle({ label: 'Several floors (in development)', checked: !!FEATURES.levels, onChange: (on) => { setFeature('levels', on); paintNote(); } });
  sw.classList.add('setrow--levels');
  paintNote();
  return h('section', { class: 'settings__group settings__group--exp' }, h('h3', { class: 'sec__title' }, 'Experimental'),
    sw,
    h('p', { class: 'setnote' }, 'Works: adding floors and switching between them in the plan and in 3D, furniture, carpentry and the checks per floor, and stairs (the Stairs tool in Structure, with the opening in the floor above and the stair rules), walking up and down them in the walk-through.'),
    h('p', { class: 'setnote' }, 'Not yet: realistic daylight on the upper floors, and importing a drawing with several floors.'),
    note,
    angledGroup(app));
}

/** Settings → Experimental → angled walls (stage A3): the switch only adds the tools that CREATE angled walls. */
function angledGroup(app) {
  const note = h('p', { class: 'setnote setnote--warn', role: 'status', hidden: true });
  const paintNote = () => {
    const has = Array.isArray(app.plan.slants) && app.plan.slants.length > 0;
    note.hidden = !(has && !FEATURES.angledWalls);
    note.textContent = note.hidden ? '' : 'This plan already has angled walls: they are always drawn and can be selected, moved and changed. The switch adds drawing new ones and angling straight walls.';
  };
  const sw = toggle({ label: 'Angled walls (in development)', checked: !!FEATURES.angledWalls, onChange: (on) => { setFeature('angledWalls', on); paintNote(); } });
  sw.classList.add('setrow--angled');
  paintNote();
  return h('div', { class: 'settings__sub settings__sub--angled' },
    sw,
    h('p', { class: 'setnote' }, 'Works: drawing walls at any angle in the plan (15° steps, parallel and perpendicular guides, typed length and angle), angling a straight wall by dragging its end, doors and windows in angled walls, the rooms and their areas, dimensions, the checks that already handle them, and angled walls in 3D (walls, doors, windows, floors, roofs, cut-away, finishes, walking).'),
    h('p', { class: 'setnote' }, 'Approximate: the light simulation. Angled walls block daylight and let it in through their windows, but each angled wall surface shows its room’s average light, not its own.'),
    h('p', { class: 'setnote' }, 'Not yet: the regulation and carpentry checks along angled walls, and importing them from a drawing.'),
    note);
}

/** Context menu for the current selection, at a screen point. */
export function openItemMenu(app, point) {
  const { store, actions } = app;
  const items = store.getSelected();
  if (!items.length) return null;
  const one = items.length === 1 ? items[0] : null;
  const ids = items.map((it) => it.id);
  const allLocked = items.every((it) => it.locked), allHidden = items.every((it) => it.hidden);
  if (one && one.carp && app.carpentry) {
    return openMenu(point, [{ heading: app.carpentry.unitLabel(one) }, { label: 'Edit in Carpentry', icon: 'carpentry', kbd: 'C', onSelect: () => app.carpentry.openUnit(one.id) }]);
  }
  return openMenu(point, [
    { heading: one ? one.name : `${items.length} items` },
    one && (one.generic || !one.productId) ? { label: 'Choose a product…', icon: 'swap', onSelect: () => app.openPanel('inspector') } : null,
    one && one.url ? { label: `Buy at ${one.retailer || 'the retailer'}`, icon: 'list', href: one.url } : null,
    { label: 'Duplicate', icon: 'duplicate', kbd: 'Ctrl D', onSelect: actions.duplicateSelection },
    { label: 'Rotate 90°', icon: 'rotate-cw', kbd: 'R', onSelect: () => actions.rotateSelection(90) },
    { separator: true },
    { label: allLocked ? 'Unlock' : 'Lock in place', icon: allLocked ? 'unlock' : 'lock', onSelect: () => store.updateItems(ids, { locked: !allLocked }) },
    { label: allHidden ? 'Show' : 'Hide', icon: allHidden ? 'eye' : 'eye-off', onSelect: () => store.updateItems(ids, { hidden: !allHidden }) },
    { label: 'Bring to front', icon: 'front', onSelect: () => store.bringToFront(ids) },
    { label: 'Send to back', icon: 'back', onSelect: () => store.sendToBack(ids) },
    { separator: true },
    { label: 'Remove', icon: 'trash', kbd: 'Del', danger: true, onSelect: actions.deleteSelection },
  ]);
}
