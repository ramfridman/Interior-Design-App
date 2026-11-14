/**
 * Rooms tab: every room and outdoor area with its floor area, floor / wall finish pickers and shortcuts to see it
 * in the plan, in 3D or on foot. Also the default wall paint colour for the whole house and, at the top, what the
 * owner changed in the architect's plan. Rooms are re-read on every 'plan' event: a new wall can add a room (which
 * gets a name field and a type select), removing one merges two.
 */
import { BASE_PLAN, updateRoom, isBuiltinBase, levelPlan } from '../core/plan-edit.js';
import { FEATURES } from '../core/features.js';
import { GROUND, levelIds, levelName, upperLevels } from '../core/levels.js';
import { floorAreaM2, wallAreaM2, resolveFinish } from '../core/finishes.js';
import { h, setKids, debounce } from './dom.js';
import { icon } from './icons.js';
import { iconBtn, section, swatch, segmented } from './components.js';
import { openPopover } from './dialogs.js';
import { fmtArea, fmtPrice } from './format.js';
import { drawFinishSwatch } from './thumbs.js';
import { changesSection } from './structure-panels.js';

const WALL_PAINTS = ['#ffffff', '#f4f1ea', '#ece7dc', '#e3e6e1', '#d9dedb', '#e8e0d2', '#dcd3c3', '#cfd6d8'];
/** What a room the owner created can be. `wet` rooms get tiled walls by default. */
const ROOM_TYPES = [['bedroom', 'Bedroom'], ['living', 'Living space'], ['bathroom', 'Bathroom'], ['wc', 'WC'], ['service', 'Service room'], ['office', 'Office'], ['kitchen', 'Kitchen'], ['mamad', 'Safe room (mamad)']];
const WET_TYPES = ['bathroom', 'wc', 'service'];
/** The room of the base plan with this id, on any floor (room ids are unique across floors). */
const baseRoom = (id) => {
  const r = BASE_PLAN.rooms.find((x) => x.id === id);
  if (r || !upperLevels(BASE_PLAN).length) return r || null;
  for (const lid of levelIds(BASE_PLAN).slice(1)) { const v = levelPlan(BASE_PLAN, lid); const hit = v && v.rooms.find((x) => x.id === id); if (hit) return hit; }
  return null;
};

/** @param {HTMLElement} root  @param {object} app */
export function initRooms(root, app) {
  const { store, catalog, actions } = app;
  const plan0 = app.plan;
  let active = false, dirty = true, activeChanged = true, inStructure = app.structure.isActive();
  // several floors: the rooms of the floor shown, or of every floor
  let allFloors = false;
  const viewOf = (id) => (!id || id === GROUND ? plan0 : levelPlan(plan0, id) || plan0);
  const multi = () => FEATURES.levels && upperLevels(plan0).length > 0;
  const floorPick = segmented({ options: [{ value: 'one', label: 'This floor' }, { value: 'all', label: 'All floors' }], value: 'one', label: 'Rooms of', cls: 'seg--mini',
    onChange: (v) => { allFloors = v === 'all'; render(); } });

  const list = h('div', { class: 'rooms' });
  const paint = h('div', { class: 'swatches' });
  const changes = changesSection(app);
  root.append(changes, section('Default wall paint', h('div', { class: 'colrow' }, paint), h('p', { class: 'sec__note' }, 'Used for every room without its own wall finish.')), list);

  function swatchCanvas(params, type) {
    const c = h('canvas', { class: 'fswatch', width: 56, height: 56, 'aria-hidden': 'true' });
    const g = c.getContext('2d');
    if (g) drawFinishSwatch(g, 56, params, type);
    return c;
  }

  function finishButton(space, kind, plan = plan0) {
    const type = kind === 'floor' ? 'floor-finish' : 'wall-finish';
    let resolved = { params: {}, product: null };
    try { resolved = resolveFinish(space.id, kind, store, catalog); } catch (err) { /* keep the default */ }
    const area = kind === 'floor' ? floorAreaM2(space) : wallAreaM2(space, plan.levelId && plan.levelId !== GROUND ? (plan.heights && plan.heights.ceiling) || store.project.ceilingHeight : store.project.ceilingHeight, plan);
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

  /** Name field + type select for a room that is not on the architect's plan (created by a new wall). */
  function newRoomEditor(room) {
    const error = h('p', { class: 'form__error', role: 'alert', hidden: true });
    const apply = (patch) => { const res = updateRoom(room.id, patch); error.textContent = res.ok ? '' : res.reason; error.hidden = res.ok; return res.ok; };
    const name = h('input', { class: 'room__rename display', type: 'text', value: room.name, 'aria-label': 'Room name', spellcheck: 'false', maxlength: '40', autocomplete: 'off', 'data-fk': `name:${room.id}`,
      onKeydown: (e) => { if (e.key === 'Enter') name.blur(); if (e.key === 'Escape') { name.value = room.name; name.blur(); e.stopPropagation(); } },
      onChange: () => { const v = name.value.trim(); if (!v || v === room.name || !apply({ name: v })) name.value = room.name; } });
    const type = h('select', { class: 'select select--quiet room__type', 'aria-label': 'Room type', 'data-fk': `type:${room.id}`, onChange: () => { if (!apply({ type: type.value, wet: WET_TYPES.includes(type.value) })) type.value = room.type; } },
      ROOM_TYPES.map(([v, l]) => h('option', { value: v, selected: v === room.type }, l)),
      ROOM_TYPES.some(([v]) => v === room.type) ? null : h('option', { value: room.type, selected: true }, room.type));
    return { name, type, error };
  }

  function card(space, indoor, levelId = GROUND) {
    const plan = viewOf(levelId);
    // a room on another floor than the one shown: show that floor first
    const onFloor = (fn) => () => { if (levelId !== (store.ui.level || GROUND) && app.levels) app.levels.set(levelId); fn(); };
    const isActive = store.ui.activeSpace === space.id;
    const area = floorAreaM2(space);
    const base = indoor ? baseRoom(space.id) : null;
    const isNew = indoor && !base;
    const was = base ? floorAreaM2(base) : null;
    const resized = was != null && Math.abs(was - area) >= 0.05;
    // the architect's rooms keep their names; rooms of the user's own plan can always be named and typed
    const edit = isNew || (indoor && !isBuiltinBase()) ? newRoomEditor(space) : null;
    return h('article', { class: `room${isActive ? ' is-active' : ''}${isNew ? ' is-new' : ''}`, dataset: { id: space.id } },
      h('header', { class: 'room__head' },
        edit
          ? h('div', { class: 'room__name room__name--edit' }, edit.name)
          : h('button', { type: 'button', class: 'room__name', 'aria-pressed': String(isActive), 'data-tip': 'Make this the active room', onClick: () => store.setUI({ activeSpace: space.id }) },
            h('span', { class: 'display truncate' }, space.name)),
        h('span', { class: 'room__area num' }, fmtArea(area), resized ? h('small', { class: 'room__was', 'data-tip': isBuiltinBase() ? 'Area on the architect’s plan' : 'Area on the plan as built' }, `was ${fmtArea(was)}`) : null)),
      edit ? h('div', { class: 'room__newrow' }, isNew ? h('span', { class: 'tag tag--new' }, 'New room') : null, edit.type,
        isActive ? null : h('button', { type: 'button', class: 'room__activate', onClick: () => store.setUI({ activeSpace: space.id }) }, 'Make active')) : null,
      edit ? edit.error : null,
      h('div', { class: 'room__finishes' }, finishButton(space, 'floor', plan), indoor ? finishButton(space, 'wall', plan) : null),
      h('div', { class: 'room__actions' },
        iconBtn('plan', 'Show in plan', { onClick: onFloor(() => actions.focusSpace(space.id, { view: '2d' })) }),
        iconBtn('cube', 'Look in 3D', { onClick: () => actions.focusSpace(space.id, { view: '3d' }) }),
        iconBtn('walk', 'Walk here', { onClick: () => actions.walkTo(space.id) })));
  }

  function render() {
    dirty = false;
    // Keep the keyboard in the name field / type select of a new room across the re-render its own edit causes.
    const key = root.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
    changes.refresh();
    const current = (store.project.wallColor || '').toLowerCase();
    const custom = h('input', { type: 'color', class: 'swatch swatch--custom', value: /^#[0-9a-f]{6}$/i.test(current) ? current : '#f4f1ea', 'aria-label': 'Custom wall colour', 'data-tip': 'Custom colour', onChange: () => store.setProject({ wallColor: custom.value }) });
    setKids(paint, WALL_PAINTS.map((c) => swatch(c, { selected: current === c, onClick: () => store.setProject({ wallColor: c }) })), custom);
    const plan = plan0;
    if (multi()) {
      // one section per floor: the floor shown, or every floor (top floor last, like the switcher's list reversed)
      const cur = store.ui.level || GROUND, floors = allFloors ? levelIds(plan0) : [cur];
      floorPick.set(allFloors ? 'all' : 'one');
      setKids(list,
        h('div', { class: 'rooms__floors' }, h('span', { class: 'sec__note' }, allFloors ? 'Every floor' : levelName(plan0, cur)), floorPick),
        floors.map((id) => { const v = viewOf(id); return section(`Rooms · ${levelName(plan0, id)}`, { aside: h('span', { class: 'sec__note num' }, fmtArea(v.rooms.reduce((s, r) => s + floorAreaM2(r), 0))) },
          v.rooms.length ? v.rooms.map((r) => card(r, true, id)) : h('p', { class: 'sec__empty' }, 'No rooms yet: draw walls on this floor with the Structure tools.')); }),
        floors.includes(GROUND) && (plan.outdoorAreas || []).length ? section('Outdoor areas', plan.outdoorAreas.map((r) => card(r, false))) : null);
    } else setKids(list,
      section('Rooms', { aside: h('span', { class: 'sec__note num' }, fmtArea(plan.rooms.reduce((s, r) => s + floorAreaM2(r), 0))) }, plan.rooms.map((r) => card(r, true))),
      (plan.outdoorAreas || []).length ? section('Outdoor areas', plan.outdoorAreas.map((r) => card(r, false))) : null);
    if (key) { root.querySelector(`[data-fk="${key}"]`)?.focus({ preventScroll: true }); return; }
    const act = list.querySelector('.room.is-active');
    if (act && act.scrollIntoView && activeChanged) act.scrollIntoView({ block: 'nearest' });
    activeChanged = false;
  }

  const invalidate = debounce(() => { if (active) render(); else dirty = true; }, 60);
  store.on('finishes', invalidate);
  store.on('project', invalidate);
  store.on('ui', (e) => {
    if (e.keys.includes('activeSpace')) { activeChanged = true; invalidate(); }
    else if (e.keys.includes('level')) invalidate();
    else if (e.keys.includes('tool') && app.structure.isActive() !== inStructure) { inStructure = !inStructure; invalidate(); }   // the changes section offers "Change walls" only outside Structure
  });
  store.on('plan', (e) => { if (!e || !e.transient) invalidate(); });
  store.on('load', invalidate);

  return {
    activate() { active = true; if (dirty) render(); },
    deactivate() { active = false; },
  };
}
