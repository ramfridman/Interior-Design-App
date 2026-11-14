/**
 * Floors (levels) in the UI — stage F2 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md. Everything the user sees of the
 * floors goes through this controller: the switcher in the top bar (list, "+ Add floor above", rename, heights,
 * remove), the floor rows of the phone mode menu, PageUp / PageDown, "Move to floor…" for furniture, the status-bar
 * text, and the hygiene when the floor shown changes (selections of the other floor are dropped, a tool in progress
 * is cancelled by the plan view, undo / redo that changed another floor goes there).
 *
 * The entry points exist only while FEATURES.levels is on (`?levels=1` for manual checks); with it off the app is
 * exactly what it was. The engine side is core/plan-edit.js (addLevel / removeLevel / updateLevel, levelPlan) and the
 * store (`ui.level`, `ui.ghostBelow`). Words: "level" in code, "floor" in UI text.
 */
import { FEATURES } from '../core/features.js';
import { GROUND, levelIds, levelName, levelOf, upperLevels } from '../core/levels.js';
import { levelPlan, addLevel, removeLevel, updateLevel, planPhase, REASONS } from '../core/plan-edit.js';
import { selectionOnLevel, structureSelOn, itemLevel, levelBelow, levelPatch } from '../view2d/levels.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { btn } from './components.js';
import { openDialog, openMenu, toast, confirmDialog } from './dialogs.js';
import { moveRunToLevel, removeRun } from '../carpentry/index.js';
import { levelBanner } from './structure.js';
import { field, numInput, readNum } from './projects.js';

/** The plan view of the floor shown (PLAN itself on the ground floor). */
export function viewPlan(app) {
  const id = app.store.ui.level || GROUND;
  return id === GROUND ? app.plan : levelPlan(app.plan, id) || app.plan;
}

/**
 * Which floors an undo / redo touched, from two signatures (see `historySignature`): level ids whose walls, openings,
 * rooms or heights changed, levels that appeared or went, and the floors of items that were added, removed or changed.
 * Pure (exported for the tests).
 */
export function changedLevels(before, after) {
  const out = new Set();
  for (const [id, s] of after.levels) if (before.levels.get(id) !== s) out.add(id);
  for (const id of before.levels.keys()) if (!after.levels.has(id)) out.add(id);
  for (const [id, s] of after.items) { const was = before.items.get(id); if (was !== s) { out.add(after.itemLevel.get(id)); if (was) out.add(before.itemLevel.get(id)); } }
  for (const id of before.items.keys()) if (!after.items.has(id)) out.add(before.itemLevel.get(id));
  return out;
}
/** What changedLevels compares: per level a JSON of its plan part, per item its JSON and its level. */
export function historySignature(plan, items) {
  const levels = new Map();
  for (const id of levelIds(plan)) {
    if (id === GROUND) levels.set(id, JSON.stringify([plan.walls, plan.openings, (plan.rooms || []).map((r) => [r.id, r.name, r.type])]));
    else levels.set(id, JSON.stringify(levelOf(plan, id)));
  }
  const sig = new Map(), lvl = new Map();
  for (const it of items) { sig.set(it.id, JSON.stringify(it)); lvl.set(it.id, itemLevel(it)); }
  return { levels, items: sig, itemLevel: lvl };
}

/** @param {object} app  UI context ({ store, plan, … }) */
export function createLevels(app) {
  const { store } = app;
  const plan = app.plan;
  const enabled = () => !!FEATURES.levels;
  const current = () => store.ui.level || GROUND;
  const ids = () => levelIds(plan);
  const nameOf = (id) => levelName(plan, id) || id;
  const fixed = () => planPhase() !== 'draft';
  const listeners = new Set();
  const changed = () => { for (const fn of listeners) { try { fn(); } catch (err) { console.error('[levels]', err); } } };
  const undoAction = { label: 'Undo', fn: () => api.undo() };

  /* ───────── hygiene: the floor shown changed ───────── */
  let shown = current();
  function levelShown() {
    const id = current();
    if (id === shown) return;
    shown = id;
    // selections that are not on this floor go (the plan view cancels a gesture or a tool in progress itself)
    const keep = selectionOnLevel(store.items, store.selection, id);
    if (keep.length !== store.selection.length) store.select(keep);
    const patch = {};
    if (store.ui.structureSel && !structureSelOn(store.ui.structureSel, viewPlan(app))) patch.structureSel = null;
    const view = viewPlan(app);
    if (store.ui.activeSpace && ![...(view.rooms || []), ...(view.outdoorAreas || [])].some((s) => s.id === store.ui.activeSpace)) patch.activeSpace = null;
    if (Object.keys(patch).length) store.setUI(patch);
    changed();
  }
  store.on('ui', (e) => { if (e.keys.includes('level')) levelShown(); });
  // undo, a load or someone else can remove the floor shown: the store then falls back to the ground floor silently
  for (const ev of ['plan', 'load', 'base']) store.on(ev, (e) => { if (ev !== 'plan' || !e || !e.transient) { if (current() !== shown) levelShown(); else changed(); } });

  /* ───────── undo / redo that changed another floor: show it ───────── */
  function followHistory(run) {
    if (!enabled()) { run(); return; }
    const before = historySignature(plan, store.items);
    run();
    const after = historySignature(plan, store.items);
    if (!upperLevels(plan).length && before.levels.size < 2) return;
    const touched = changedLevels(before, after);
    if (!touched.size || touched.has(current())) return;
    const go = [...touched].find((id) => id && (id === GROUND || levelOf(plan, id)));
    if (!go) return;
    store.setUI({ level: go });
    toast(`Showing ${nameOf(go)}, where that change is`);
  }

  /* ───────── switching ───────── */
  function set(id) {
    if (!id || id === current()) return false;
    if (id !== GROUND && !levelOf(plan, id)) return false;
    store.setUI({ level: id });
    return true;
  }
  /** PageUp (+1) / PageDown (-1). */
  function step(dir) {
    const list = ids(), i = list.indexOf(current()), next = list[i + dir];
    if (!next) { toast(dir > 0 ? `${nameOf(current())} is the top floor` : 'This is the ground floor'); return false; }
    set(next);
    return true;
  }

  /* ───────── dialogs ───────── */
  function permitNote() { return fixed() ? levelBanner('permit', REASONS.level || 'Adding a storey changes the building: it needs a building permit.') : null; }

  function openAdd() {
    const below = ids()[ids().length - 1], bh = viewPlanOf(below).heights || {};
    const defaultName = levelName({ ...plan, levels: [...upperLevels(plan), { id: 'Lx' }] }, 'Lx');
    const name = h('input', { class: 'field__input', type: 'text', value: defaultName, maxlength: '40', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Floor name', style: 'text-align:left', 'data-autofocus': '' });
    const ceiling = numInput(((bh.ceiling || 280) / 100).toFixed(2), { 'aria-label': 'Ceiling height in metres' });
    const copy = h('input', { type: 'checkbox', class: 'check__input', checked: true });
    const error = h('p', { class: 'form__error', role: 'alert', hidden: true });
    const go = () => {
      const c = readNum(ceiling);
      if (!(c >= 2.2 && c <= 6)) { error.textContent = 'Ceiling height: a number of metres between 2.20 and 6.00.'; error.hidden = false; return; }
      const nm = name.value.trim();
      const res = addLevel({ copyExterior: copy.checked, ...(nm && nm !== defaultName ? { name: nm } : {}), heights: { ceiling: Math.round(c * 100) } });
      if (!res || !res.ok) { error.textContent = (res && res.reason) || 'The floor could not be added.'; error.hidden = false; return; }
      dlg.close();
      set(res.ids[0]);
      toast(`${nameOf(res.ids[0])} added${copy.checked ? ' with the outer walls and windows of the floor below' : ''}`, { kind: 'success', action: undoAction });
    };
    const dlg = openDialog({
      title: 'Add a floor above', size: 'sm', cls: 'lvldlg',
      body: h('div', { class: 'newproj', onKeydown: (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') go(); } },
        field('Name', name),
        h('div', { class: 'newproj__row' }, field('Ceiling height', ceiling, 'm')),
        h('label', { class: 'check' }, copy, h('span', { class: 'check__label' }, `Copy the outer walls and windows from ${nameOf(below).toLowerCase() === 'ground floor' ? 'the ground floor' : nameOf(below)}`)),
        h('p', { class: 'newproj__hint' }, `It goes on top of ${nameOf(below)}. Doors are not copied; draw the inner walls with the Structure tools.`),
        permitNote(),
        error),
      actions: [btn('Cancel', { variant: 'quiet', onClick: () => dlg.close() }), btn('Add floor', { variant: 'primary', icon: 'plus', onClick: go })],
    });
    setTimeout(() => { name.focus(); name.select(); }, 30);
    return dlg;
  }
  const viewPlanOf = (id) => (id === GROUND ? plan : levelPlan(plan, id) || plan);

  function openRename(id = current()) {
    if (id === GROUND) { toast('The ground floor keeps its name'); return null; }
    const input = h('input', { class: 'field__input', type: 'text', value: nameOf(id), maxlength: '40', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Floor name', style: 'text-align:left', 'data-autofocus': '',
      onKeydown: (e) => { if (e.key === 'Enter') go(); } });
    const error = h('p', { class: 'form__error', role: 'alert', hidden: true });
    const go = () => {
      const res = updateLevel(id, { name: input.value });
      if (!res || !res.ok) { error.textContent = (res && res.reason) || 'The floor could not be renamed.'; error.hidden = false; return; }
      dlg.close();
    };
    const dlg = openDialog({ title: 'Rename floor', size: 'sm', cls: 'lvldlg', body: h('div', { class: 'newproj' }, field('Name', input), h('p', { class: 'newproj__hint' }, 'Leave it empty for the default name.'), error),
      actions: [btn('Cancel', { variant: 'quiet', onClick: () => dlg.close() }), btn('Rename', { variant: 'primary', onClick: go })] });
    setTimeout(() => { input.focus(); input.select(); }, 30);
    return dlg;
  }

  function openHeights(id = current()) {
    if (id === GROUND) {
      const info = openDialog({ title: 'Floor heights', size: 'sm', cls: 'lvldlg', body: h('p', { class: 'dialog__text' }, 'The ground floor’s heights are the house’s own: the ceiling height is set when the project is created. Pick an upper floor to change its heights.'),
        actions: [btn('Close', { variant: 'primary', onClick: () => info.close() })] });
      return info;
    }
    const lv = levelOf(plan, id), hh = (lv && lv.heights) || {};
    const ceiling = numInput(((hh.ceiling || 280) / 100).toFixed(2), { 'aria-label': 'Ceiling height in metres', 'data-autofocus': '' });
    const slab = numInput(String(hh.slab ?? 20), { 'aria-label': 'Slab under this floor in centimetres' });
    const parapet = numInput(String(hh.parapet ?? 40), { 'aria-label': 'Parapet in centimetres' });
    const error = h('p', { class: 'form__error', role: 'alert', hidden: true });
    const go = () => {
      const c = readNum(ceiling), s = readNum(slab), p = readNum(parapet);
      if (!(c >= 2.2 && c <= 6)) { error.textContent = 'Ceiling height: a number of metres between 2.20 and 6.00.'; error.hidden = false; return; }
      if (!(s >= 5 && s <= 80) || !(p >= 0 && p <= 200)) { error.textContent = 'Slab: 5 to 80 cm. Parapet: 0 to 200 cm.'; error.hidden = false; return; }
      const res = updateLevel(id, { heights: { ceiling: Math.round(c * 100), slab: Math.round(s), parapet: Math.round(p) } });
      if (!res || !res.ok) { error.textContent = (res && res.reason) || 'The heights could not be changed.'; error.hidden = false; return; }
      dlg.close();
      if (res.warnings && res.warnings.length) toast(res.warnings[0], { level: res.level });
    };
    const dlg = openDialog({ title: `Heights of ${nameOf(id)}`, size: 'sm', cls: 'lvldlg',
      body: h('div', { class: 'newproj', onKeydown: (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') go(); } },
        h('div', { class: 'newproj__row' }, field('Ceiling', ceiling, 'm'), field('Slab below', slab, 'cm')),
        h('div', { class: 'newproj__row' }, field('Parapet', parapet, 'cm')),
        h('p', { class: 'newproj__hint' }, `Floor level ${((lv.elevation || 0) / 100).toFixed(2)} m above the ground floor. A new ceiling or slab moves the floors above.`),
        permitNote(), error),
      actions: [btn('Cancel', { variant: 'quiet', onClick: () => dlg.close() }), btn('Save heights', { variant: 'primary', onClick: go })] });
    return dlg;
  }

  /** What stands on a floor, in words, for the remove dialog. */
  function contentList(content) {
    const items = (content.items || []).map((iid) => store.getItem(iid)).filter(Boolean);
    const rows = [];
    if (items.length) {
      const names = items.slice(0, 6).map((it) => it.name || it.type || 'Item');
      rows.push(h('li', null, `${items.length} ${items.length === 1 ? 'item' : 'items'}: ${names.join(', ')}${items.length > names.length ? ` and ${items.length - names.length} more` : ''}`));
    }
    if ((content.runs || []).length) rows.push(h('li', null, `${content.runs.length} carpentry ${content.runs.length === 1 ? 'run' : 'runs'}`));
    if ((content.finishes || []).length) rows.push(h('li', null, `Floor or wall finishes of ${content.finishes.length} ${content.finishes.length === 1 ? 'room' : 'rooms'} (they go with the rooms)`));
    if ((content.stairs || []).length) rows.push(h('li', null, `${content.stairs.length} ${content.stairs.length === 1 ? 'stair leads' : 'stairs lead'} up to it`));
    return h('ul', { class: 'lvlcontent' }, rows);
  }

  /**
   * Remove a floor. An empty one after a confirmation; one with things on it offers: move everything to the floor
   * below / delete it with the floor / cancel (in-app dialog). Always one undo step.
   */
  async function remove(id = current()) {
    if (id === GROUND) { toast('The ground floor cannot be removed'); return { ok: false }; }
    const below = levelBelow(plan, id) || GROUND, name = nameOf(id);
    // what is on it (the same question the engine asks the store)
    const roomIds = (viewPlanOf(id).rooms || []).map((r) => r.id);
    // carpentry units go with their runs (never moved as items)
    const items = store.items.filter((it) => !it.carp && itemLevel(it) === id).map((it) => it.id);
    const runs = Object.values((store.carpentry && store.carpentry.runs) || {}).filter((r) => r && r.level === id).map((r) => r.id);
    const runCodes = runs.map((rid) => store.carpentry.runs[rid].code);
    const finishes = roomIds.filter((r) => store.finishes[r]);
    const content = { items, runs, finishes, stairs: [] };
    const busy = items.length + runs.length > 0;
    if (!busy) {
      const ok = await confirmDialog({ title: `Remove ${name}?`, confirmLabel: 'Remove floor', danger: true,
        body: [h('p', { class: 'dialog__text' }, `Its walls, doors and windows are removed${finishes.length ? ', and the finishes of its rooms' : ''}. You can undo this.`), permitNote()] });
      if (!ok) return { ok: false, cancelled: true };
      return finish(removeLevel(id, { force: finishes.length > 0 }), id);
    }
    return new Promise((resolve) => {
      let done = false;
      const end = (r) => { if (!done) { done = true; resolve(r); } };
      const choose = (how) => {
        dlg.close();
        store.begin();
        if (how === 'move') {
          const patch = levelPatch(below);
          if (items.length) store.updateItems(items, () => (below === GROUND ? { level: undefined } : patch));
          // carpentry runs: a wall-bound run needs a wall at the same place on the floor below
          for (const rid of runs) {
            const r = moveRunToLevel(rid, below);
            if (!r || !r.ok) {
              store.cancel();
              const why = (r && r.reason && r.reason.en) || 'A carpentry run could not be moved.';
              toast(`${why} Nothing was changed: move or remove that run in Carpentry mode first, or delete it with the floor.`, { kind: 'warn', duration: 8000 });
              end(r || { ok: false }); return;
            }
          }
        } else {
          if (items.length) store.removeItems(items);
          for (const rid of runs) removeRun(rid);
        }
        const res = removeLevel(id, { force: true });
        if (!res || !res.ok) { store.cancel(); toast((res && res.reason) || 'The floor could not be removed.', { kind: 'warn' }); end(res || { ok: false }); return; }
        store.commit();
        const what = [items.length && `${items.length} ${items.length === 1 ? 'item' : 'items'}`, runs.length && `${runs.length} carpentry ${runs.length === 1 ? 'run' : 'runs'}`].filter(Boolean).join(' and ');
        end(finish(res, id, how === 'move' ? `${what} moved to ${nameOf(below)}` : null));
      };
      const dlg = openDialog({
        title: `Remove ${name}?`, size: 'md', cls: 'lvldlg lvldlg--remove', onClose: () => end({ ok: false, cancelled: true }),
        body: [
          h('p', { class: 'dialog__text' }, `${name} still holds:`),
          contentList(content),
          h('p', { class: 'dialog__text dialog__text--after' }, `Move ${runs.length ? 'the furniture and the carpentry' : 'the furniture'} to ${nameOf(below)} (${runs.length ? 'everything keeps' : 'it keeps'} its place on the plan${runs.length ? `; a run along a wall needs a wall at the same place there — ${runCodes.join(', ')}` : ''}), or delete it together with the floor. You can undo either.`),
          permitNote(),
        ],
        actions: [
          btn('Cancel', { variant: 'quiet', onClick: () => dlg.close() }),
          btn('Delete it with the floor', { variant: 'danger', onClick: () => choose('delete') }),
          btn(`Move everything to ${nameOf(below)}`, { variant: 'primary', onClick: () => choose('move') }),
        ],
      });
    });
  }
  function finish(res, id, extra) {
    if (!res || !res.ok) { toast((res && res.reason) || 'The floor could not be removed.', { kind: 'warn' }); return res || { ok: false }; }
    toast(`${extra ? extra + '. ' : ''}Floor removed`, { action: undoAction });
    return res;
  }

  /* ───────── furniture between floors ───────── */
  /** Move items (not carpentry units) to floor `id` and show that floor with them selected. */
  function moveItemsTo(itemIds, id) {
    const list = itemIds.map((i) => store.getItem(i)).filter((it) => it && !it.carp && itemLevel(it) !== id);
    if (!list.length || (id !== GROUND && !levelOf(plan, id))) return 0;
    const moved = list.map((it) => it.id);
    store.updateItems(moved, () => (id === GROUND ? { level: undefined } : { level: id }));
    set(id);
    store.select(moved);
    toast(`${moved.length === 1 ? list[0].name || 'Item' : `${moved.length} items`} moved to ${nameOf(id)}`, { action: undoAction });
    return moved.length;
  }
  function moveMenuItems(itemIds) {
    const here = itemIds.length ? itemLevel(store.getItem(itemIds[0])) : current();
    return [{ heading: 'Move to floor' }, ...ids().filter((id) => id !== here).map((id) => ({ label: nameOf(id), icon: 'levels', onSelect: () => moveItemsTo(itemIds, id) }))];
  }
  function openMoveMenu(anchor, itemIds) { if (ids().length > 1) openMenu(anchor, moveMenuItems(itemIds), { placement: 'bottom-start' }); else toast('There is only one floor. Add a floor above first.'); }

  /* ───────── menus ───────── */
  /** The floor rows of a menu: one per floor (top floor first, like a building), then the floor commands. */
  function menuItems({ heading = true } = {}) {
    const list = ids().slice().reverse(), cur = current();
    return [
      heading && { heading: 'Floors' },
      ...list.map((id) => ({ label: nameOf(id), checked: id === cur, icon: 'levels', onSelect: () => set(id) })),
      { separator: true },
      { label: 'Add floor above…', icon: 'plus', onSelect: openAdd },
      { label: 'Rename floor…', icon: 'labels', disabled: cur === GROUND, onSelect: () => openRename(cur) },
      { label: 'Floor heights…', icon: 'dimensions', onSelect: () => openHeights(cur) },
      { label: 'Remove floor…', icon: 'trash', danger: true, disabled: cur === GROUND, onSelect: () => remove(cur) },
    ];
  }

  /** The top-bar switcher: the floor shown, a menu with the floors and the floor commands. */
  function switcher() {
    const label = h('span', { class: 'lvlswitch__label truncate' });
    const el = h('button', { type: 'button', class: 'lvlswitch', 'aria-haspopup': 'menu', 'data-tip': 'Floors', 'data-kbd': 'PgUp PgDn',
      onClick: () => openMenu(el, menuItems(), { placement: 'bottom-start' }) },
    icon('levels', { size: 16 }), label, icon('chevron-down', { size: 14 }));
    const sync = () => {
      label.textContent = nameOf(current());
      el.setAttribute('aria-label', `Floor shown: ${nameOf(current())}. Floors`);
      el.dataset.level = current();
    };
    listeners.add(sync);
    sync();
    return el;
  }

  /* ───────── where things are (stage F7) ───────── */
  /** The floor that holds a room / outdoor area (null when unknown). */
  function levelOfSpace(spaceId) {
    if (!spaceId) return null;
    for (const id of ids()) { const v = viewPlanOf(id); if ([...(v.rooms || []), ...(v.outdoorAreas || [])].some((s) => s.id === spaceId)) return id; }
    return null;
  }
  /** The floor of an item (a carpentry unit without `level`: its run's). */
  function levelOfItem(it) {
    if (!it) return GROUND;
    if (it.level) return it.level;
    const run = it.carp && store.carpentry && store.carpentry.runs && store.carpentry.runs[it.carp.runId];
    return (run && run.level) || GROUND;
  }
  /** Show the floor of a space, items or an explicit level before something is focused there (feature on only). */
  function showFloorOf({ level, spaceId, itemIds } = {}) {
    if (!enabled() || !upperLevels(plan).length) return false;
    const want = level || levelOfSpace(spaceId) || (itemIds && itemIds.length ? levelOfItem(store.getItem(itemIds[0])) : null);
    return want ? set(want) : false;
  }

  const api = {
    enabled, current, ids, set, step, name: nameOf, menuItems, switcher, levelOfSpace, levelOfItem, showFloorOf,
    openAdd, openRename, openHeights, remove, moveItemsTo, moveMenuItems, openMoveMenu,
    followHistory,
    undo() { api.followHistory(() => store.undo()); },
    /** Call `fn` whenever the floor shown, the floors or their names change. Returns an unsubscribe function. */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** "Ground floor" / "First floor · 3.20 m" for the status bar. */
    statusText() { const id = current(), e = id === GROUND ? 0 : (levelOf(plan, id) || {}).elevation || 0; return id === GROUND ? nameOf(id) : `${nameOf(id)} · +${(e / 100).toFixed(2)} m`; },
  };
  return api;
}
