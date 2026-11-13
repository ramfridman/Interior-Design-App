/**
 * Dialog sheets: first-run welcome, keyboard shortcuts, settings, and the item context menu.
 */
import { areaM2 } from '../core/geometry.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { btn, segmented, numField, toggle, kbd } from './components.js';
import { openDialog, openMenu } from './dialogs.js';
import { SHORTCUTS } from './keyboard.js';
import { planSvg } from './plan-svg.js';
import { applyTheme, getPref, setPref } from './prefs.js';

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/**
 * Verified facts about the house, all read from PLAN (nothing typed in by hand).
 * @returns {Array<[label: string, value: string, sub?: string]>}
 */
export function houseFacts(plan, store) {
  const m = plan.meta || {};
  const facts = [['Footprint', `${(plan.bounds.w / 100).toFixed(2)} × ${(plan.bounds.h / 100).toFixed(2)} m`, 'outer walls']];
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
  if (beds) {
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
  const title = m.lot ? `House ${m.lot}, Kibbutz Afikim (model ${m.model || 'E7'})` : (m.name || store.project.name);
  const open = (plan.assumptions || []).filter((a) => a.status !== 'confirmed');
  const tip = (name, head, text) => h('li', { class: 'tips__row' }, h('span', { class: 'tips__icon' }, icon(name, { size: 18 })), h('div', null, h('p', { class: 'tips__head' }, head), h('p', { class: 'tips__text' }, text)));
  const body = h('div', { class: 'welcome' },
    h('div', { class: 'welcome__plan' }, planSvg(plan, { pad: 80 }),
      h('p', { class: 'welcome__caption' }, [m.architect ? `Drawn from ${m.architect}` : 'Drawn from the architect’s plan', m.drawingScale ? `, ${m.drawingScale}` : ''])),
    h('div', { class: 'welcome__text' },
      h('p', { class: 'welcome__lead' }, 'Furnish and landscape your real house. The plan is measured from the architect’s drawing, every product is on sale in Israel with its price and shop link, and you can walk through the result in 3D.'),
      h('dl', { class: 'titleblock' }, houseFacts(plan, store).map(([k, v, sub]) => h('div', { class: 'titleblock__cell' }, h('dt', null, k), h('dd', { class: 'num' }, v, sub ? h('small', null, sub) : null)))),
      h('ul', { class: 'tips' },
        tip('sofa', 'Drag products onto the plan', 'Or press the + on a product card, then click where it goes. Floors and wall finishes apply to the room you click.'),
        tip('swap', 'Swap the architect’s placeholders', 'The furniture already on the plan has no product yet. Select a piece and pick a real one in the Inspector.'),
        tip('walk', 'Walk through and keep an eye on the budget', 'Press 3 to walk the house. The shopping list adds up prices as you place things.')),
      open.length ? h('details', { class: 'welcome__assume' },
        h('summary', null, `${open.length} ${open.length === 1 ? 'assumption' : 'assumptions'} to confirm with the architect`),
        h('ul', null, open.map((a) => h('li', null, a.text)))) : null));
  const dlg = openDialog({
    title, size: 'xl', cls: 'dialog--welcome', body,
    actions: [btn('Keyboard shortcuts', { variant: 'quiet', icon: 'keyboard', onClick: () => { dlg.close(); openShortcuts(); } }), btn('Start designing', { variant: 'primary', onClick: () => dlg.close() })],
    onClose: () => setPref('welcomed', true),
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
      h('div', { class: 'setrow' }, h('span', { class: 'setrow__label' }, 'Ceiling height', h('small', { class: 'faint' }, 'Confirmed by the owner: 3.00 m')),
        numField({ value: store.project.ceilingHeight, min: 220, max: 450, step: 5, suffix: 'cm', title: 'Ceiling height in centimetres', onCommit: (v) => store.setProject({ ceilingHeight: Math.round(v) }) })),
      colour('Interior wall paint', 'wallColor'), colour('Exterior render', 'exteriorColor'), colour('Window and door frames', 'frameColor')),
    h('section', { class: 'settings__group' }, h('h3', { class: 'sec__title' }, 'Design'),
      h('div', { class: 'settings__buttons' },
        btn('Show the welcome again', { small: true, onClick: () => { dlg.close(); openWelcome(app); } }),
        btn("Reset to architect's layout…", { small: true, icon: 'reset', onClick: () => { dlg.close(); actions.resetLayout(); } }))));
  const dlg = openDialog({ title: 'Settings', size: 'md', body, actions: [btn('Done', { variant: 'primary', onClick: () => dlg.close() })] });
  return dlg;
}

/** Context menu for the current selection, at a screen point. */
export function openItemMenu(app, point) {
  const { store, actions } = app;
  const items = store.getSelected();
  if (!items.length) return null;
  const one = items.length === 1 ? items[0] : null;
  const ids = items.map((it) => it.id);
  const allLocked = items.every((it) => it.locked), allHidden = items.every((it) => it.hidden);
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
