/**
 * Application bootstrap. Loads data, restores (or seeds) the design, then creates the views and the UI.
 * The DOM shell (index.html) provides the mount points #view2d and #view3d.
 */
import { store } from './core/store.js';
import { PLAN } from './core/plan.js';
import { initialLayout } from './core/initial-layout.js';
import * as catalog from './catalog/index.js';
import * as models from './models/index.js';

async function boot() {
  const status = (msg) => { const el = document.getElementById('boot-status'); if (el) el.textContent = msg; };
  status('Loading catalogue and models…');
  await Promise.all([models.loadModels(), catalog.loadCatalog()]);

  // Restore the last design from this browser, otherwise start from the architect's layout.
  store.persist = false;
  if (!store.loadLocal()) store.load({ items: initialLayout() });
  store.persist = true;

  const ctx = { store, plan: PLAN, catalog, models };
  status('Preparing views…');
  const [{ createView2D }, { createView3D }, { initUI }] = await Promise.all([
    import('./view2d/index.js'), import('./view3d/index.js'), import('./ui/index.js'),
  ]);
  const view2d = createView2D(document.getElementById('view2d'), ctx);
  const view3d = createView3D(document.getElementById('view3d'), ctx);
  const ui = initUI({ ...ctx, view2d, view3d });

  // Debug / test handle.
  window.app = { store, plan: PLAN, catalog, models, view2d, view3d, ui, resetToArchitectLayout() { store.load({ items: initialLayout() }, { recordUndo: true }); } };
  document.documentElement.classList.add('app-ready');
  document.getElementById('boot')?.remove();
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('boot-status');
  if (el) { el.textContent = 'Something went wrong while starting the app: ' + (err && err.message ? err.message : err); el.classList.add('error'); }
});
