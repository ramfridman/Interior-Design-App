/**
 * Commands shared by the top bar, keyboard shortcuts, context menu and panels. Each command is safe to call at any
 * time: it checks what is available (views are written by another team and may lack a method) and reports problems
 * as toasts instead of throwing.
 */
import { itemAABB, polygonBounds, normDeg } from '../core/geometry.js';
import { allSpaces, getSpace } from '../core/finishes.js';
import { h, call } from './dom.js';
import { btn } from './components.js';
import { openDialog, confirmDialog, toast, openMenu } from './dialogs.js';
import { saveFile, canPrint, printPage, copyText } from './exporter.js';
import { shoppingCSV, shoppingText } from './shopping.js';
import { getPref } from './prefs.js';

const slug = (name) => (String(name || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'design');

/** @param {object} app  UI context: { store, plan, catalog, view2d, view3d, … } */
export function createActions(app) {
  const { store, plan, catalog } = app;
  const movable = (ids = store.selection) => ids.map((id) => store.getItem(id)).filter((it) => it && !it.locked);
  const show2d = () => store.ui.mode === '2d' || store.ui.mode === 'split';
  const show3d = () => store.ui.mode !== '2d';

  const actions = {
    /* ── modes ── */
    setMode(mode) { store.setUI({ mode }); },
    /** The view a new item should be placed in. */
    activeView() { return show2d() ? app.view2d : app.view3d; },

    /* ── history ── */
    undo() { if (store.historyState().canUndo) store.undo(); },
    redo() { if (store.historyState().canRedo) store.redo(); },

    /* ── selection ── */
    deleteSelection() {
      const ids = store.selection.slice();
      if (!ids.length) return;
      const free = movable(ids).map((it) => it.id);
      if (!free.length) { toast('Unlock the item to remove it', { kind: 'warn' }); return; }
      store.removeItems(free);
      toast(free.length === 1 ? 'Item removed' : `${free.length} items removed`, { action: { label: 'Undo', fn: () => store.undo() } });
    },
    duplicateSelection() {
      if (!store.selection.length) return;
      store.duplicateItems(store.selection.slice());
    },
    rotateSelection(delta) {
      const ids = movable().map((it) => it.id);
      if (ids.length) store.updateItems(ids, (it) => ({ rot: normDeg((it.rot || 0) + delta) }));
    },
    nudge(dx, dy) {
      const ids = movable().map((it) => it.id);
      if (ids.length) store.updateItems(ids, (it) => ({ x: it.x + dx, y: it.y + dy }));
    },
    selectAll() {
      const spaceId = store.ui.activeSpace;
      const ids = store.items.filter((it) => !it.hidden && (!spaceId || safeSpaceId(it) === spaceId)).map((it) => it.id);
      store.select(ids);
    },
    /** Esc. `event` (the key press) lets Structure mode tell whether the plan view already acted on it. */
    escape(event) {
      if (store.ui.mode === 'walk') { store.setUI({ mode: '3d' }); return; }
      if (app.structure.isActive()) { app.structure.escape(event); return; }
      if (store.ui.tool !== 'select') { store.setUI({ tool: 'select' }); return; }
      store.clearSelection();
    },
    /** Align the selection's bounding boxes. edge: 'left'|'center'|'right'|'top'|'middle'|'bottom' */
    align(edge) {
      const items = movable();
      if (items.length < 2) return;
      const boxes = items.map((it) => ({ it, b: itemAABB(it) }));
      const x0 = Math.min(...boxes.map((o) => o.b.x)), x1 = Math.max(...boxes.map((o) => o.b.x + o.b.w));
      const y0 = Math.min(...boxes.map((o) => o.b.y)), y1 = Math.max(...boxes.map((o) => o.b.y + o.b.h));
      const patch = new Map();
      for (const { it, b } of boxes) {
        if (edge === 'left') patch.set(it.id, { x: it.x + (x0 - b.x) });
        else if (edge === 'right') patch.set(it.id, { x: it.x + (x1 - (b.x + b.w)) });
        else if (edge === 'center') patch.set(it.id, { x: it.x + ((x0 + x1) / 2 - (b.x + b.w / 2)) });
        else if (edge === 'top') patch.set(it.id, { y: it.y + (y0 - b.y) });
        else if (edge === 'bottom') patch.set(it.id, { y: it.y + (y1 - (b.y + b.h)) });
        else if (edge === 'middle') patch.set(it.id, { y: it.y + ((y0 + y1) / 2 - (b.y + b.h / 2)) });
      }
      store.updateItems([...patch.keys()], (it) => patch.get(it.id));
    },
    /** Space the selection's centres evenly along 'x' or 'y'. */
    distribute(axis) {
      const items = movable().slice().sort((a, b) => a[axis] - b[axis]);
      if (items.length < 3) return;
      const first = items[0][axis], step = (items[items.length - 1][axis] - first) / (items.length - 1);
      const target = new Map(items.map((it, i) => [it.id, first + step * i]));
      store.updateItems([...target.keys()], (it) => ({ [axis]: target.get(it.id) }));
    },

    /* ── focus ── */
    /** Select items and bring them into view in whichever view is showing. */
    focusItems(ids) {
      ids = ids.filter((id) => store.getItem(id));
      if (!ids.length) return;
      app.selectingFromPanel = true;
      store.select(ids);
      app.selectingFromPanel = false;
      if (show2d()) call(app.view2d, 'fit', 'selection', { animate: true });
      if (show3d() && store.ui.mode !== 'walk') call(app.view3d, 'focusItem', ids[0]);
    },
    /** Make a room / outdoor area the active space and frame it. */
    focusSpace(spaceId, { view } = {}) {
      const space = getSpace(spaceId, plan);
      store.setUI({ activeSpace: spaceId });
      if (!space) return;
      if (view === '2d' && !show2d()) store.setUI({ mode: '2d' });
      if (view === '3d' && (store.ui.mode === '2d' || store.ui.mode === 'walk')) store.setUI({ mode: '3d' });
      const b = polygonBounds(space.polygon), pad = 120;
      if (show2d() && view !== '3d') call(app.view2d, 'fit', { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, { animate: true });
      if (show3d() && store.ui.mode !== 'walk' && view !== '2d') call(app.view3d, 'setCameraPreset', spaceId, { animate: true });
    },
    walkTo(spaceId) {
      const space = getSpace(spaceId, plan);
      const at = space && space.label ? { x: space.label[0], y: space.label[1], heading: 0 } : undefined;
      app.pendingWalk = at || null;
      if (store.ui.mode === 'walk') { call(app.view3d, 'enterWalk', at); app.pendingWalk = null; }
      else store.setUI({ mode: 'walk' });
    },
    fit() {
      if (show2d()) call(app.view2d, 'fit', store.selection.length ? 'selection' : 'house', { animate: true });
      if (store.ui.mode === '3d') call(app.view3d, 'setCameraPreset', 'aerial', { animate: true });
    },

    /* ── catalogue → plan ── */
    /** Start placing a catalogue product in the active view (or apply it, for floor / wall finishes). */
    place(product) {
      if (!product) return;
      if (catalog.isFinish ? catalog.isFinish(product) : /-finish$/.test(product.type)) { actions.applyFinish(product); return; }
      if (store.ui.mode === 'walk') store.setUI({ mode: '3d' });
      const partial = catalog.itemFromProduct(product, {}, store.project.ceilingHeight);
      const view = actions.activeView();
      if (app.isCompact()) app.closePanels();
      if (view && typeof view.startPlacing === 'function') {
        try {
          view.startPlacing(partial, { onDone: () => {} });
          toast(show2d() ? 'Click in the plan to place it. Esc cancels.' : 'Click in the 3D view to place it. Esc cancels.');
          return;
        } catch (err) { console.error('[ui] startPlacing failed', err); }
      }
      // No placing tool available: drop it in the middle of the active room so nothing is lost.
      const space = getSpace(store.ui.activeSpace, plan) || plan.rooms.find((r) => r.type === 'living') || plan.rooms[0];
      const at = space && space.label ? { x: space.label[0], y: space.label[1] } : { x: plan.bounds.w / 2, y: plan.bounds.h / 2 };
      store.addItem({ ...partial, ...at });
      toast(`Placed in ${space ? space.name : 'the house'}`);
    },
    /** Apply a floor / wall finish product to a space (asks which room when none is active). */
    applyFinish(product, spaceId, anchor) {
      const kind = product.type === 'wall-finish' ? 'wall' : 'floor';
      const target = spaceId || store.ui.activeSpace;
      const candidates = kind === 'wall' ? plan.rooms : allSpaces(plan);
      const apply = (id) => {
        const space = getSpace(id, plan);
        if (!space) return;
        store.setFinish(id, { [kind]: product.id });
        toast(`${kind === 'wall' ? 'Walls' : 'Floor'} of ${space.name} updated`, { kind: 'success', action: { label: 'Undo', fn: () => store.undo() } });
      };
      if (target && candidates.some((s) => s.id === target)) { apply(target); return; }
      const items = [{ heading: kind === 'wall' ? 'Apply to the walls of' : 'Apply to the floor of' },
        ...candidates.map((s) => ({ label: s.name, icon: kind === 'wall' ? 'paint' : 'floor', onSelect: () => apply(s.id) }))];
      if (anchor && anchor.isConnected) openMenu(anchor, items, { placement: 'right-start' });
      else {
        const dlg = openDialog({ title: kind === 'wall' ? 'Which walls?' : 'Which floor?', size: 'sm', body: h('div', { class: 'picklist' },
          candidates.map((s) => btn(s.name, { variant: 'quiet', block: true, icon: kind === 'wall' ? 'paint' : 'floor', onClick: () => { dlg.close(); apply(s.id); } }))) });
      }
    },

    /* ── files ── */
    async saveDesign() {
      const res = await saveFile({ name: `${slug(store.project.name)}.json`, mime: 'application/json', data: JSON.stringify(store.serialize(), null, 2) });
      if (res.ok && !res.dialog) toast('Design saved', { kind: 'success' });
    },
    openDesign() {
      const load = (text) => {
        try {
          const data = JSON.parse(text);
          store.load(data, { recordUndo: true });
          dlg.close();
          toast('Design opened', { kind: 'success', action: { label: 'Undo', fn: () => store.undo() } });
        } catch (err) {
          error.textContent = 'This is not a design file saved from this app. Nothing was changed.';
          error.hidden = false;
        }
      };
      const error = h('p', { class: 'form__error', role: 'alert', hidden: true });
      const file = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', id: 'open-design-file', onChange: () => {
        const f = file.files && file.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => load(String(reader.result));
        reader.onerror = () => { error.textContent = 'The file could not be read.'; error.hidden = false; };
        reader.readAsText(f);
      } });
      const area = h('textarea', { class: 'export__text', rows: '7', spellcheck: 'false', placeholder: 'Or paste the contents of a design file here', 'aria-label': 'Design file contents' });
      const dlg = openDialog({
        title: 'Open design', size: 'md',
        body: [
          h('p', { class: 'dialog__text' }, 'Opening a design replaces the current one. You can undo it afterwards.'),
          h('label', { class: 'btn btn--default filepick', for: 'open-design-file', tabindex: '0', 'data-autofocus': '', onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } } }, 'Choose a .json file'),
          file, area, error,
        ],
        actions: [btn('Cancel', { variant: 'quiet', onClick: () => dlg.close() }), btn('Open pasted design', { variant: 'primary', onClick: () => { if (area.value.trim()) load(area.value); else area.focus(); } })],
      });
    },
    async resetLayout() {
      const ok = await confirmDialog({ title: "Reset to the architect's layout?", message: 'Your furniture and garden are replaced by the layout from the architect’s drawing. You can undo this.', confirmLabel: 'Reset layout', danger: true });
      if (!ok) return;
      try {
        if (window.app && typeof window.app.resetToArchitectLayout === 'function') window.app.resetToArchitectLayout();
        else { const { initialLayout } = await import('../core/initial-layout.js'); store.load({ items: initialLayout() }, { recordUndo: true }); }
        toast("Back to the architect's layout", { action: { label: 'Undo', fn: () => store.undo() } });
      } catch (err) { console.error(err); toast('Could not reset the layout', { kind: 'error' }); }
    },
    async exportPlanPNG() {
      if (!app.view2d || typeof app.view2d.exportPNG !== 'function') { toast('Plan export is not available yet', { kind: 'warn' }); return; }
      try {
        const blob = await app.view2d.exportPNG({ scale: 2 });
        if (!blob) throw new Error('empty export');
        await saveFile({ name: `${slug(store.project.name)}-plan.png`, mime: 'image/png', data: blob });
      } catch (err) { console.error(err); toast('Could not export the plan', { kind: 'error' }); }
    },
    async export3DSnapshot() {
      if (!app.view3d || typeof app.view3d.snapshot !== 'function') { toast('3D snapshots are not available yet', { kind: 'warn' }); return; }
      try {
        const url = await app.view3d.snapshot({ width: 1920, height: 1080 });
        if (!url) throw new Error('empty snapshot');
        await saveFile({ name: `${slug(store.project.name)}-3d.png`, mime: 'image/png', data: url });
      } catch (err) { console.error(err); toast('Could not take the 3D snapshot', { kind: 'error' }); }
    },
    async exportCSV() {
      await saveFile({ name: `${slug(store.project.name)}-shopping-list.csv`, mime: 'text/csv', data: shoppingCSV(app, getPref('budgetGroup')) });
    },
    async copyShoppingList() {
      const text = shoppingText(app, getPref('budgetGroup'));
      const ok = await copyText(text);
      if (ok) toast('Shopping list copied', { kind: 'success' });
      else saveFile({ name: 'shopping-list.txt', mime: 'text/plain', data: text });
    },
    printShoppingList() {
      if (!canPrint()) { actions.copyShoppingList(); return; }
      app.preparePrint && app.preparePrint();
      printPage();
    },
  };

  function safeSpaceId(item) {
    try { const s = store.spaceOf(item); return s ? s.id : null; } catch (err) { return null; }
  }
  return actions;
}
