/**
 * Mount points for the panels another team member writes (estimate, quantities, quotation package, carpenters).
 * Each module default-exports `create(ctx) → { el: HTMLElement, update({ runId, unitId }), destroy() }` with
 *   ctx = { store, plan, catalog, models, view2d, view3d, Carp, ui: { toast, confirmDialog, openDialog, saveFile, setCarpentryBudget } }
 * (setCarpentryBudget({ low, typical, high } | null) feeds the shopping list's "Custom carpentry" row; also app.ui.setCarpentryBudget).
 * Modules are loaded with a dynamic import() on first use; while a file is missing (or fails) a quiet placeholder shows.
 */
import * as Carp from '../../carpentry/index.js';
import { h } from '../dom.js';
import { toast, confirmDialog, openDialog } from '../dialogs.js';
import { saveFile } from '../exporter.js';
import { setCarpentryBudget } from '../shopping.js';

const LOADERS = {
  estimate: () => import('./estimate-tab.js'),
  takeoff: () => import('./takeoff-tab.js'),
  quotation: () => import('./quotation.js'),
  carpenters: () => import('./carpenters.js'),
  stoneSuppliers: () => import('./stone-suppliers.js'),
};
const cache = new Map();

/** The context handed to every slot module. */
export function slotContext(app) {
  const { store, plan, catalog, models, view2d, view3d } = app;
  return { store, plan, catalog, models, view2d, view3d, Carp, ui: { toast, confirmDialog, openDialog, saveFile, setCarpentryBudget } };
}

/** Load a slot module's `create` (null when it is not available yet). */
export function loadSlot(name) {
  if (!cache.has(name)) {
    cache.set(name, (LOADERS[name] ? LOADERS[name]() : Promise.reject(new Error('unknown slot')))
      .then((m) => { const create = (m.default && m.default.create) || m.create || (typeof m.default === 'function' ? m.default : null); return typeof create === 'function' ? create : null; })
      .catch(() => null));
  }
  return cache.get(name);
}

/** "Coming soon" placeholder. */
export function placeholder(title, text) {
  return h('div', { class: 'cslot__ph' }, h('p', { class: 'cslot__phtitle' }, title), h('p', { class: 'cslot__phtext' }, text));
}

/**
 * Mount a slot into `host` (once). Returns { update(sel), destroy() } — safe to call before the module has loaded.
 * @param {string} name  @param {HTMLElement} host  @param {object} app  @param {{ title: string, text: string }} ph
 */
export function mountSlot(name, host, app, ph) {
  let inst = null, dead = false, pending = null;
  host.replaceChildren(h('div', { class: 'cslot__loading' }, 'Loading…'));
  loadSlot(name).then((create) => {
    if (dead) return;
    if (!create) { host.replaceChildren(placeholder(ph.title, ph.text)); return; }
    try {
      inst = create(slotContext(app));
      host.replaceChildren(inst && inst.el ? inst.el : placeholder(ph.title, ph.text));
      if (pending && inst && typeof inst.update === 'function') inst.update(pending);
    } catch (err) { console.error(`[carpentry] ${name} panel failed`, err); host.replaceChildren(placeholder(ph.title, 'This panel could not start. The rest of Carpentry keeps working.')); }
  });
  return {
    update(sel) { pending = sel; try { if (inst && typeof inst.update === 'function') inst.update(sel); } catch (err) { console.error(`[carpentry] ${name} update failed`, err); } },
    destroy() { dead = true; try { if (inst && typeof inst.destroy === 'function') inst.destroy(); } catch (err) { console.error(err); } inst = null; },
  };
}
