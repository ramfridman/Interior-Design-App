/**
 * Rooms tab: every room and outdoor area with its floor area, floor / wall finish pickers and shortcuts to see it
 * in the plan, in 3D or on foot. Also the default wall paint colour for the whole house.
 */
import { floorAreaM2, wallAreaM2, resolveFinish } from '../core/finishes.js';
import { h, setKids, debounce } from './dom.js';
import { icon } from './icons.js';
import { iconBtn, section, swatch } from './components.js';
import { openPopover } from './dialogs.js';
import { fmtArea, fmtPrice } from './format.js';
import { drawFinishSwatch } from './thumbs.js';

const WALL_PAINTS = ['#ffffff', '#f4f1ea', '#ece7dc', '#e3e6e1', '#d9dedb', '#e8e0d2', '#dcd3c3', '#cfd6d8'];

/** @param {HTMLElement} root  @param {object} app */
export function initRooms(root, app) {
  const { store, plan, catalog, actions } = app;
  let active = false, dirty = true;

  const list = h('div', { class: 'rooms' });
  const paint = h('div', { class: 'swatches' });
  root.append(section('Default wall paint', h('div', { class: 'colrow' }, paint), h('p', { class: 'sec__note' }, 'Used for every room without its own wall finish.')), list);

  function swatchCanvas(params, type) {
    const c = h('canvas', { class: 'fswatch', width: 56, height: 56, 'aria-hidden': 'true' });
    const g = c.getContext('2d');
    if (g) drawFinishSwatch(g, 56, params, type);
    return c;
  }

  function finishButton(space, kind) {
    const type = kind === 'floor' ? 'floor-finish' : 'wall-finish';
    let resolved = { params: {}, product: null };
    try { resolved = resolveFinish(space.id, kind, store, catalog); } catch (err) { /* keep the default */ }
    const area = kind === 'floor' ? floorAreaM2(space) : wallAreaM2(space, store.project.ceilingHeight, plan);
    const b = h('button', { type: 'button', class: 'fpick', 'aria-haspopup': 'dialog', 'aria-label': `${kind === 'floor' ? 'Floor' : 'Wall'} finish of ${space.name}: ${resolved.product ? resolved.product.name : 'built-in default'}. Change`,
      onClick: () => openPicker(b, space, kind, type, area) },
    swatchCanvas(resolved.params, type),
    h('span', { class: 'fpick__text' },
      h('span', { class: 'fpick__kind' }, kind === 'floor' ? 'Floor' : 'Walls'),
      h('span', { class: 'fpick__name truncate' }, resolved.product ? resolved.product.name : 'Built-in default')),
    h('span', { class: 'fpick__cost num' }, resolved.product ? fmtPrice(resolved.product.price * area) : ''),
    icon('chevron-down', { size: 14 }));
    return b;
  }

  function openPicker(anchor, space, kind, type, area) {
    let products = [];
    try { products = catalog.searchProducts({ type, sort: 'price-asc' }); } catch (err) { products = []; }
    const chosen = (store.finishes[space.id] || {})[kind] || null;
    const choose = (id) => { store.setFinish(space.id, { [kind]: id }); pop.close(); };
    const option = (id, name, sub, params, cost) => h('button', { type: 'button', class: 'fopt', role: 'option', 'aria-selected': String(chosen === id), onClick: () => choose(id) },
      swatchCanvas(params, type), h('span', { class: 'fopt__text' }, h('span', { class: 'fopt__name truncate' }, name), h('span', { class: 'fopt__sub truncate num' }, sub)),
      h('span', { class: 'fopt__cost num' }, cost));
    let defaults = { params: {} };
    try { defaults = resolveFinish(space.id, kind, { finishes: {}, project: store.project }, catalog); } catch (err) { /* ignore */ }
    const body = h('div', { class: 'fopts', role: 'listbox', 'aria-label': `${kind === 'floor' ? 'Floor' : 'Wall'} finishes` },
      h('p', { class: 'fopts__title' }, `${kind === 'floor' ? 'Floor' : 'Walls'} of ${space.name}`, h('span', { class: 'num faint' }, fmtArea(area))),
      option(null, 'Built-in default', 'No product, not in the budget', defaults.params, ''),
      products.map((p) => option(p.id, p.name, `${p.retailer}, ${fmtPrice(p.price)} per m²`, p.params, fmtPrice(p.price * area))),
      !products.length ? h('p', { class: 'sec__empty' }, `No ${kind === 'floor' ? 'flooring' : 'wall finish'} products in the catalogue yet.`) : null);
    const pop = openPopover(anchor, body, { cls: 'popover--panel popover--finishes', placement: 'left-start', label: 'Choose a finish' });
  }

  function card(space, indoor) {
    const isActive = store.ui.activeSpace === space.id;
    return h('article', { class: `room${isActive ? ' is-active' : ''}`, dataset: { id: space.id } },
      h('header', { class: 'room__head' },
        h('button', { type: 'button', class: 'room__name', 'aria-pressed': String(isActive), 'data-tip': 'Make this the active room', onClick: () => store.setUI({ activeSpace: space.id }) },
          h('span', { class: 'display truncate' }, space.name)),
        h('span', { class: 'room__area num' }, fmtArea(floorAreaM2(space)))),
      h('div', { class: 'room__finishes' }, finishButton(space, 'floor'), indoor ? finishButton(space, 'wall') : null),
      h('div', { class: 'room__actions' },
        iconBtn('plan', 'Show in plan', { onClick: () => actions.focusSpace(space.id, { view: '2d' }) }),
        iconBtn('cube', 'Look in 3D', { onClick: () => actions.focusSpace(space.id, { view: '3d' }) }),
        iconBtn('walk', 'Walk here', { onClick: () => actions.walkTo(space.id) })));
  }

  function render() {
    dirty = false;
    const current = (store.project.wallColor || '').toLowerCase();
    const custom = h('input', { type: 'color', class: 'swatch swatch--custom', value: /^#[0-9a-f]{6}$/i.test(current) ? current : '#f4f1ea', 'aria-label': 'Custom wall colour', 'data-tip': 'Custom colour', onChange: () => store.setProject({ wallColor: custom.value }) });
    setKids(paint, WALL_PAINTS.map((c) => swatch(c, { selected: current === c, onClick: () => store.setProject({ wallColor: c }) })), custom);
    setKids(list,
      section('Rooms', { aside: h('span', { class: 'sec__note num' }, fmtArea(plan.rooms.reduce((s, r) => s + floorAreaM2(r), 0))) }, plan.rooms.map((r) => card(r, true))),
      (plan.outdoorAreas || []).length ? section('Outdoor areas', plan.outdoorAreas.map((r) => card(r, false))) : null);
    const act = list.querySelector('.room.is-active');
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
  }

  const invalidate = debounce(() => { if (active) render(); else dirty = true; }, 60);
  store.on('finishes', invalidate);
  store.on('project', invalidate);
  store.on('ui', (e) => { if (e.keys.includes('activeSpace')) invalidate(); });

  return {
    activate() { active = true; if (dirty) render(); },
    deactivate() { active = false; },
  };
}
