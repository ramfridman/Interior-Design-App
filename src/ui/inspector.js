/**
 * Inspector tab. Three states: nothing selected (active room + project summary), one item (full editor) and several
 * items (totals, align / distribute, group actions). The DOM is rebuilt only when the selection or the item's
 * structure changes; while an item is dragged in a view only the number fields are patched, so nothing jumps.
 * In Structure mode the tab shows the selected wall / opening instead (structure-inspector.js).
 */
import { normDeg } from '../core/geometry.js';
import { getSpace, floorAreaM2, resolveFinish } from '../core/finishes.js';
import { h, setKids, rafThrottle } from './dom.js';
import { icon } from './icons.js';
import { btn, iconBtn, numField, section, swatch, extLink, emptyState } from './components.js';
import { fmtPrice, fmtDims, fmtArea, fmtUnitPrice, toUnit, fromUnit, unitDigits, RESIZABLE_TYPES } from './format.js';
import { shoppingTotal } from './shopping.js';
import { createStructureInspector } from './structure-inspector.js';
import { FEATURES } from '../core/features.js';
import { viewPlan } from './levels.js';

const PALETTE = ['#f3f1ec', '#d9d2c5', '#b9b2a6', '#3a3d42', '#c8a476', '#8a5a3b', '#5c6b5a', '#3e5c76', '#b4543a'];
const STRUCTURAL = ['productId', 'type', 'generic', 'placement', 'locked', 'hidden', 'params', 'price', 'url', 'retailer', 'priceUnit'];

/** @param {HTMLElement} root  @param {object} app */
export function initInspector(root, app) {
  const { store, plan, catalog, actions, thumbs } = app;
  let active = false, dirty = true;
  let fields = null;     // live controls of the single-item editor: { x, y, rot, elev, w, d, h, name, dial, cost }
  let shownId = null;
  const structurePanel = createStructureInspector(app);
  let structureShown = false;

  const units = () => store.ui.units;
  const typeLabel = (item) => (catalog.MODEL_TYPES && catalog.MODEL_TYPES[item.type] ? catalog.MODEL_TYPES[item.type].label.split(' / ')[0] : item.type);
  const costOf = (item) => { try { return catalog.itemCost(item) || 0; } catch (err) { return 0; } };

  function render() {
    dirty = false;
    fields = null;
    shownId = null;
    structureShown = app.structure.isActive();
    if (structureShown) {
      // Keep the keyboard where it was when the panel has to be rebuilt (a style change, a wall that changed class).
      const key = root.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
      setKids(root, structurePanel.render());
      if (key) root.querySelector(`[data-fk="${key}"]`)?.focus({ preventScroll: true });
      return;
    }
    const items = store.getSelected();
    if (!items.length) setKids(root, renderNothing());
    else if (items.length === 1 && items[0].carp) setKids(root, renderCarp(items[0]));
    else if (items.length === 1) { shownId = items[0].id; setKids(root, renderOne(items[0])); }
    else setKids(root, renderMany(items));
  }

  /* ───────── Nothing selected ───────── */
  function renderNothing() {
    const space = getSpace(store.ui.activeSpace, viewPlan(app));   // the floor shown
    const t = shoppingTotal(app);
    const roomCard = space
      ? h('div', { class: 'card' },
        h('div', { class: 'card__head' }, h('h3', { class: 'card__title display' }, space.name), h('span', { class: 'card__aside num' }, fmtArea(floorAreaM2(space)))),
        h('dl', { class: 'facts' },
          h('dt', null, 'Floor'), h('dd', null, finishName(space.id, 'floor')),
          viewPlan(app).rooms.includes(space) ? [h('dt', null, 'Walls'), h('dd', null, finishName(space.id, 'wall'))] : null,
          h('dt', null, 'Items'), h('dd', { class: 'num' }, String(store.items.filter((it) => spaceId(it) === space.id).length))),
        h('div', { class: 'card__actions' },
          btn('Change finishes', { small: true, icon: 'paint', onClick: () => app.openPanel('rooms') }),
          btn('Select all here', { small: true, onClick: () => actions.selectAll() })))
      : emptyState({ icon: 'select', title: 'Nothing selected', text: 'Click an item to edit it, or click a room in the plan to make it the active room.' });
    const m = plan.meta || {};
    return [
      section('Active room', roomCard),
      section('Project', h('dl', { class: 'facts facts--wide' },
        h('dt', null, 'House'), h('dd', null, `${m.name || store.project.name}`),
        h('dt', null, 'Footprint'), h('dd', { class: 'num' }, `${(plan.bounds.w / 100).toFixed(2)} × ${(plan.bounds.h / 100).toFixed(2)} m`),
        m.grossFloorArea ? [h('dt', null, 'Floor area'), h('dd', { class: 'num' }, `${m.grossFloorArea} m²`)] : null,
        h('dt', null, 'Ceiling'), h('dd', { class: 'num' }, `${(store.project.ceilingHeight / 100).toFixed(2)} m`),
        h('dt', null, 'Items placed'), h('dd', { class: 'num' }, String(t.pieces)),
        h('dt', null, 'Still to choose'), h('dd', { class: 'num' }, String(t.pending)),
        h('dt', null, 'Budget so far'), h('dd', { class: 'num strong' }, fmtPrice(t.total))),
      btn('Open the shopping list', { small: true, icon: 'list', onClick: () => app.openPanel('budget') })),
    ];
  }

  function finishName(id, kind) {
    try {
      const f = resolveFinish(id, kind, store, catalog);
      return f.product ? f.product.name : 'Built-in default';
    } catch (err) { return 'Built-in default'; }
  }
  function spaceId(item) { try { const s = store.spaceOf(item); return s ? s.id : null; } catch (err) { return null; } }

  /* ───────── A carpentry unit: made to measure, edited in Carpentry mode ───────── */
  function renderCarp(item) {
    const C = app.carpentry;
    const run = C.Carp.runOfItem(item);
    const mod = C.Carp.MODULES[item.carp.module];
    return [
      h('div', { class: 'ccard' },
        h('span', { class: 'ccard__icon' }, icon('carpentry', { size: 22 })),
        h('div', { class: 'ccard__body' },
          h('p', { class: 'ccard__title display' }, C.unitLabel(item)),
          h('p', { class: 'ccard__meta' }, `${mod ? mod.name.en : item.name} · ${Math.round(item.carp.width * 10) / 10} cm wide${run ? ` · ${run.name}` : ''}`),
          h('p', { class: 'ccard__lead' }, 'Made-to-measure carpentry — edit in Carpentry mode'),
          h('p', { class: 'ccard__text' }, 'Its size, position, fronts and materials are set in Carpentry, so it cannot be moved, resized or rotated here.'),
          btn('Edit in Carpentry mode', { small: true, variant: 'primary', icon: 'carpentry', kbd: 'C', onClick: () => C.openUnit(item.id) }))),
    ];
  }

  /* ───────── One item ───────── */
  function renderOne(item) {
    const u = units(), digits = unitDigits(u), step = u === 'cm' ? 1 : 0.01;
    const patch = (p, opts) => store.updateItem(item.id, p, opts);
    const live = () => store.getItem(item.id) || item;
    const lenField = (label, key, o = {}) => numField({
      label, value: toUnit(item[key] || 0, u), digits, step, suffix: u, min: o.min != null ? toUnit(o.min, u) : -Infinity, disabled: o.disabled, title: o.title,
      onCommit: (v) => patch({ [key]: fromUnit(v, u) }),
    });

    const name = h('input', { class: 'insp__name display', type: 'text', value: item.name, 'aria-label': 'Item name', spellcheck: 'false', maxlength: '80',
      onKeydown: (e) => { if (e.key === 'Enter') name.blur(); },
      onChange: () => { const v = name.value.trim() || item.name; name.value = v; if (v !== live().name) patch({ name: v }); } });
    const space = (() => { try { return store.spaceOf(item); } catch (err) { return null; } })();
    const cost = h('span', { class: 'insp__price num' }, item.price != null ? fmtPrice(costOf(item)) : '');
    const head = h('div', { class: 'insp__head' },
      h('div', { class: 'insp__thumb' }, thumbs.el(item, { size: 128, lazy: false })),
      h('div', { class: 'insp__id' }, name,
        h('p', { class: 'insp__meta truncate' }, [typeLabel(item), space ? `, ${space.name}` : '']),
        item.price != null
          ? h('p', { class: 'insp__buy' }, cost, item.priceUnit !== 'item' ? h('span', { class: 'faint' }, ` (${fmtUnitPrice(item.price, item.priceUnit)})`) : null)
          : null,
        item.retailer ? h('p', { class: 'insp__retailer' }, extLink(`Buy at ${item.retailer}`, item.url) || item.retailer) : null));

    const generic = item.generic || (!item.productId && item.price == null);
    const nudge = generic ? h('div', { class: 'callout' }, icon('info', { size: 16 }),
      h('div', null, h('p', { class: 'callout__title' }, 'No product chosen yet'),
        h('p', { class: 'callout__text' }, 'This piece comes from the architect’s drawing. Pick a real product to get its exact size, price and shop link.'),
        btn('Choose a product', { small: true, variant: 'primary', onClick: () => root.querySelector('.swap')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }))) : null;

    /* Position & rotation */
    const x = lenField('X', 'x', { title: 'Position X (from the house west face)' });
    const y = lenField('Y', 'y', { title: 'Position Y (from the house north face)' });
    const rot = numField({ label: 'Angle', value: normDeg(item.rot || 0), digits: 0, step: 5, suffix: '°', onCommit: (v) => patch({ rot: normDeg(v) }) });
    const dial = rotationDial(item.rot || 0, {
      onStart: () => store.begin(),
      onTurn: (deg) => patch({ rot: deg }, { transient: true }),
      onEnd: () => store.commit(),
    });
    const elevated = item.placement === 'wall' || item.placement === 'ceiling' || item.placement === 'surface';
    const elev = elevated ? lenField('Height above floor', 'elev', { min: 0 }) : null;
    const position = section('Position',
      h('div', { class: 'grid2' }, x, y),
      h('div', { class: 'rotrow' }, dial, rot,
        iconBtn('rotate-ccw', 'Rotate 90° counter-clockwise', { kbd: 'Shift R', variant: 'outlined', onClick: () => patch({ rot: normDeg((live().rot || 0) - 90) }) }),
        iconBtn('rotate-cw', 'Rotate 90° clockwise', { kbd: 'R', variant: 'outlined', onClick: () => patch({ rot: normDeg((live().rot || 0) + 90) }) })),
      elev);

    /* Size */
    const resizable = generic || RESIZABLE_TYPES.has(item.type);
    const freeH = generic;
    const w = lenField('Width', 'w', { min: 1, disabled: !resizable });
    const d = lenField('Depth', 'd', { min: 1, disabled: !resizable });
    const ht = lenField('Height', 'h', { min: 0.5, disabled: !freeH });
    const size = section('Size', { aside: resizable ? null : h('span', { class: 'sec__note' }, 'Fixed by the product') },
      h('div', { class: 'grid3' }, w, d, ht));

    /* Colours */
    const colourRow = (label, key) => {
      const current = (live().params || {})[key];
      const set = (c) => patch({ params: { ...(live().params || {}), [key]: c } });
      const custom = h('input', { type: 'color', class: 'swatch swatch--custom', value: /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#cccccc', 'aria-label': `${label}: custom colour`, 'data-tip': 'Custom colour', onChange: () => set(custom.value) });
      return h('div', { class: 'colrow' }, h('span', { class: 'colrow__label' }, label),
        h('div', { class: 'swatches' }, PALETTE.map((c) => swatch(c, { selected: (current || '').toLowerCase() === c, onClick: () => set(c) })), custom));
    };
    const colours = section('Colour', colourRow('Main', 'color'), colourRow('Second', 'color2'));

    /* Actions */
    const acts = h('div', { class: 'actrow', role: 'group', 'aria-label': 'Item actions' },
      iconBtn(item.locked ? 'lock' : 'unlock', item.locked ? 'Unlock' : 'Lock in place', { variant: 'outlined', pressed: !!item.locked, onClick: () => patch({ locked: !live().locked }) }),
      iconBtn(item.hidden ? 'eye-off' : 'eye', item.hidden ? 'Show' : 'Hide', { variant: 'outlined', pressed: !!item.hidden, onClick: () => patch({ hidden: !live().hidden }) }),
      iconBtn('duplicate', 'Duplicate', { kbd: 'Ctrl D', variant: 'outlined', onClick: () => store.duplicateItems([item.id]) }),
      iconBtn('front', 'Bring to front', { variant: 'outlined', onClick: () => store.bringToFront([item.id]) }),
      iconBtn('back', 'Send to back', { variant: 'outlined', onClick: () => store.sendToBack([item.id]) }),
      iconBtn('target', 'Find in the view', { variant: 'outlined', onClick: () => actions.focusItems([item.id]) }),
      moveToFloorBtn([item.id], item.carp),
      iconBtn('trash', 'Remove', { kbd: 'Delete', variant: 'danger', onClick: () => actions.deleteSelection() }));

    const note = h('textarea', { class: 'textarea', rows: '2', placeholder: 'Fabric to confirm, delivery date, measurements to check…', 'aria-label': 'Note',
      onChange: () => patch({ note: note.value }) });
    note.value = item.note || '';

    fields = { x, y, rot, elev, w, d, h: ht, name, dial, cost };
    return [head, nudge, h('div', { class: 'insp__actions' }, acts), position, size, colours, section('Note', note), renderSwap(item, generic)];
  }

  function renderSwap(item, generic) {
    let alts = [];
    try { alts = catalog.alternativesFor(item, 12) || []; } catch (err) { alts = []; }
    const rows = alts.map((p) => h('button', { type: 'button', class: 'altrow', 'aria-label': `Swap for ${p.name}, ${fmtPrice(p.price)}`,
      onClick: () => {
        store.swapItem(item.id, { ...catalog.itemFromProduct(p, {}, store.project.ceilingHeight), generic: false });
        app.toast(`Swapped for ${p.name}`, { kind: 'success', action: { label: 'Undo', fn: () => app.actions.undo() } });
      } },
    h('span', { class: 'altrow__thumb' }, thumbs.el(p, { size: 88 })),
    h('span', { class: 'altrow__text' }, h('span', { class: 'altrow__name truncate' }, p.name),
      h('span', { class: 'altrow__meta truncate num' }, `${p.retailer}, ${fmtDims(p.dims.w, p.dims.d, p.dims.h)}`)),
    h('span', { class: 'altrow__price num' }, fmtPrice(p.price))));
    return section(generic ? 'Choose a real product' : 'Swap for a similar product', { class: 'swap' },
      rows.length ? h('div', { class: 'altlist' }, rows)
        : h('p', { class: 'sec__empty' }, `No ${typeLabel(item).toLowerCase()} products in the catalogue yet. Browse the catalogue on the left for something close.`));
  }

  /** Several floors: "Move to floor…" (a menu of the other floors). Nothing while the levels feature is off. */
  function moveToFloorBtn(ids, carpentry) {
    if (!FEATURES.levels || !app.levels) return null;
    const b = iconBtn('levels', 'Move to floor…', { variant: 'outlined', disabled: !!carpentry, onClick: () => app.levels.openMoveMenu(b, ids) });
    b.setAttribute('aria-haspopup', 'menu');
    return b;
  }

  /* ───────── Several items ───────── */
  function renderMany(items) {
    const ids = items.map((it) => it.id);
    const cost = items.reduce((s, it) => s + costOf(it), 0);
    const unchosen = items.filter((it) => it.price == null).length;
    const allLocked = items.every((it) => it.locked), allHidden = items.every((it) => it.hidden);
    const al = (edge, label) => iconBtn(`align-${edge}`, label, { variant: 'outlined', onClick: () => actions.align(edge) });
    return [
      h('div', { class: 'insp__head insp__head--multi' },
        h('div', { class: 'insp__id' }, h('h3', { class: 'insp__count display' }, `${items.length} items selected`),
          h('p', { class: 'insp__buy' }, h('span', { class: 'insp__price num' }, fmtPrice(cost)), unchosen ? h('span', { class: 'faint' }, ` (${unchosen} still to choose)`) : null))),
      section('Align', h('div', { class: 'actrow', role: 'group', 'aria-label': 'Align' },
        al('left', 'Align left edges'), al('center', 'Align centres horizontally'), al('right', 'Align right edges'),
        al('top', 'Align top edges'), al('middle', 'Align centres vertically'), al('bottom', 'Align bottom edges'))),
      section('Distribute', h('div', { class: 'actrow', role: 'group', 'aria-label': 'Distribute' },
        iconBtn('distribute-h', 'Space evenly, left to right', { variant: 'outlined', disabled: items.length < 3, onClick: () => actions.distribute('x') }),
        iconBtn('distribute-v', 'Space evenly, top to bottom', { variant: 'outlined', disabled: items.length < 3, onClick: () => actions.distribute('y') }),
        iconBtn('rotate-ccw', 'Rotate each 90° counter-clockwise', { variant: 'outlined', onClick: () => actions.rotateSelection(-90) }),
        iconBtn('rotate-cw', 'Rotate each 90° clockwise', { variant: 'outlined', onClick: () => actions.rotateSelection(90) }))),
      section('Group', h('div', { class: 'actrow', role: 'group', 'aria-label': 'Group actions' },
        iconBtn(allLocked ? 'lock' : 'unlock', allLocked ? 'Unlock all' : 'Lock all', { variant: 'outlined', pressed: allLocked, onClick: () => store.updateItems(ids, { locked: !allLocked }) }),
        iconBtn(allHidden ? 'eye-off' : 'eye', allHidden ? 'Show all' : 'Hide all', { variant: 'outlined', pressed: allHidden, onClick: () => store.updateItems(ids, { hidden: !allHidden }) }),
        iconBtn('duplicate', 'Duplicate', { variant: 'outlined', onClick: () => actions.duplicateSelection() }),
        iconBtn('front', 'Bring to front', { variant: 'outlined', onClick: () => store.bringToFront(ids) }),
        moveToFloorBtn(ids, items.every((it) => it.carp)),
        iconBtn('trash', 'Remove', { variant: 'danger', onClick: () => actions.deleteSelection() }))),
      section('Selected', h('ul', { class: 'sellist' }, items.slice(0, 40).map((it) => h('li', null,
        h('button', { type: 'button', class: 'sellist__row', onClick: () => actions.focusItems([it.id]) },
          h('span', { class: 'truncate' }, it.name), h('span', { class: 'num faint' }, it.price != null ? fmtPrice(costOf(it)) : '—')))))),
    ];
  }

  /* ───────── In-place patching while dragging / nudging ───────── */
  function sync() {
    if (!fields || !shownId) return;
    const item = store.getItem(shownId);
    if (!item) return;
    const u = units();
    fields.x.set(toUnit(item.x, u));
    fields.y.set(toUnit(item.y, u));
    fields.rot.set(normDeg(item.rot || 0));
    fields.dial.set(item.rot || 0);
    fields.elev && fields.elev.set(toUnit(item.elev || 0, u));
    fields.w.set(toUnit(item.w, u));
    fields.d.set(toUnit(item.d, u));
    fields.h.set(toUnit(item.h, u));
    if (document.activeElement !== fields.name) fields.name.value = item.name;
    if (item.price != null) fields.cost.textContent = fmtPrice(costOf(item));
  }

  const invalidate = () => { if (active) render(); else dirty = true; };
  // Structure: coalesce "plan changed" + "the edited wall was re-selected under its new id" into one in-place patch.
  const syncStructure = rafThrottle(() => {
    if (!app.structure.isActive()) return;
    if (!active) { dirty = true; return; }
    if (!structureShown || !structurePanel.sync()) render();
  });
  store.on('plan', () => { if (app.structure.isActive()) syncStructure(); else if (!store.selection.length) invalidate(); });
  store.on('selection', invalidate);
  store.on('items', (e) => {
    const sel = store.selection;
    if (e.type === 'update' && sel.length === 1 && e.ids.includes(sel[0]) && shownId === sel[0]) {
      const structural = !e.keys || e.keys.some((k) => STRUCTURAL.includes(k));
      if (e.transient || !structural) { if (active) sync(); else dirty = true; return; }
    }
    if (e.transient) return;
    if (!sel.length || e.type !== 'update' || e.ids.some((id) => sel.includes(id))) invalidate();
  });
  store.on('ui', (e) => {
    if (e.keys.includes('tool') && app.structure.isActive() !== structureShown) invalidate();
    else if (app.structure.isActive() && (e.keys.includes('structureSel') || e.keys.includes('units'))) syncStructure();
    else if (e.keys.includes('units') || (e.keys.includes('activeSpace') && !store.selection.length)) invalidate();
  });
  store.on('finishes', () => { if (!store.selection.length) invalidate(); });
  store.on('project', () => { if (!store.selection.length) invalidate(); });

  return {
    activate() { active = true; if (dirty) render(); },
    deactivate() { active = false; },
  };
}

/** Small draggable dial. 0° points down (the item's front faces south), clockwise as on the plan. */
function rotationDial(value, { onStart, onTurn, onEnd }) {
  const needle = h('span', { class: 'dial__needle' });
  const el = h('div', { class: 'dial', role: 'slider', tabindex: '0', 'aria-label': 'Rotation', 'aria-valuemin': '0', 'aria-valuemax': '359', 'data-tip': 'Drag to rotate (Shift for free angle)' }, needle);
  el.set = (deg) => { const v = normDeg(deg); needle.style.transform = `rotate(${v}deg)`; el.setAttribute('aria-valuenow', String(Math.round(v))); };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    onStart();
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const move = (ev) => {
      // Screen angle → plan rotation: needle at 0° points down (+y), increasing clockwise.
      let deg = normDeg(Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI - 90);
      if (!ev.shiftKey) deg = normDeg(Math.round(deg / 15) * 15);
      el.set(deg);
      onTurn(deg);
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); onEnd(); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    move(e);
  });
  el.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!dir) return;
    e.preventDefault(); e.stopPropagation();
    const next = normDeg(Number(el.getAttribute('aria-valuenow')) + dir * (e.shiftKey ? 1 : 15));
    onStart(); el.set(next); onTurn(next); onEnd();
  });
  el.set(value);
  return el;
}

