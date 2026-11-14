/**
 * Application bootstrap. Loads data, restores (or seeds) the design, then creates the views and the UI.
 * The DOM shell (index.html) provides the mount points #view2d and #view3d.
 */
import { store } from './core/store.js';
import { PLAN } from './core/plan.js';
import { initialLayout } from './core/initial-layout.js';
import { createProjects, createLocalAdapter } from './core/projects.js';
import * as catalog from './catalog/index.js';
import * as models from './models/index.js';

// The app is a fixed, full-window workspace: the page itself must never scroll (a phone browser may still try to
// scroll it when a field is focused or content is brought into view), so any page scroll is undone at once.
function pinPage() {
  const reset = () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    const b = document.body, d = document.documentElement;
    if (b && (b.scrollTop || b.scrollLeft)) { b.scrollTop = 0; b.scrollLeft = 0; }
    if (d.scrollTop || d.scrollLeft) { d.scrollTop = 0; d.scrollLeft = 0; }
  };
  window.addEventListener('scroll', reset, { passive: true });
  document.addEventListener('scroll', (e) => { if (e.target === document || e.target === document.body || e.target === document.documentElement) reset(); }, { passive: true, capture: true });
  reset();
}
pinPage();

async function boot() {
  const status = (msg) => { const el = document.getElementById('boot-status'); if (el) el.textContent = msg; };
  status('Loading catalogue and models…');
  await Promise.all([models.loadModels(), catalog.loadCatalog()]);

  // Open the last project from this browser. On the first run the old single autosave becomes a project (the old
  // key is kept as a backup); with nothing saved the built-in house starts from the architect's layout.
  store.persist = false;
  const projects = createProjects({ store, adapter: createLocalAdapter() });
  await projects.init();
  store.persist = true;

  const ctx = { store, plan: PLAN, catalog, models, projects };
  status('Preparing views…');
  const [{ createView2D }, { createView3D }, { initUI }] = await Promise.all([
    import('./view2d/index.js'), import('./view3d/index.js'), import('./ui/index.js'),
  ]);
  const view2d = swappableView(() => createView2D(document.getElementById('view2d'), ctx));
  const view3d = swappableView(() => createView3D(document.getElementById('view3d'), ctx));
  // Another project was opened (store 'base', emitted after the new design is loaded): both views are rebuilt from
  // scratch — site, sun, cameras, daylight caches, everything they captured at creation follows the new house.
  store.on('base', () => { view2d.rebuild(); view3d.rebuild(); });
  const ui = initUI({ ...ctx, view2d, view3d });

  // Debug / test handle.
  window.app = { store, plan: PLAN, catalog, models, projects, view2d, view3d, ui, resetToArchitectLayout() { store.load({ items: initialLayout() }, { recordUndo: true }); } };
  document.documentElement.classList.add('app-ready');
  document.getElementById('boot')?.remove();
  // Live collaboration (CONTRACT § 13): only when a backend answers /api/health — otherwise nothing changes.
  import('./collab/online.js').then((m) => m.initCollaboration(window.app)).catch(() => { /* no collaboration */ });
}

/**
 * A view whose instance can be rebuilt (project switch) while every holder keeps the same object: method calls go to
 * the current instance; subscriptions (`on`), plan overlays, the carpentry drag handler and the last `setActive` /
 * `showCarpentry` state are replayed on the new instance. Calls while no instance exists are no-ops.
 */
function swappableView(factory) {
  let inner = factory();
  const subs = new Set(), overlays = new Set(), state = new Map();
  const replay = (rec) => { try { rec.off = rec.kind === 'on' ? inner.on(rec.event, rec.fn) : inner.addOverlay(rec.fn); } catch (e) { rec.off = null; } };
  const hook = (set, rec) => {
    set.add(rec);
    if (inner) replay(rec);
    return () => { set.delete(rec); if (typeof rec.off === 'function') rec.off(); };
  };
  const remember = (name) => (...args) => { state.set(name, args); return inner && typeof inner[name] === 'function' ? inner[name](...args) : undefined; };
  const own = {
    on: (event, fn) => hook(subs, { kind: 'on', event, fn }),
    addOverlay: (fn) => hook(overlays, { kind: 'overlay', fn }),
    setActive: remember('setActive'), showCarpentry: remember('showCarpentry'), setCarpentryDrag: remember('setCarpentryDrag'),
    rebuild() {
      try { if (inner && typeof inner.destroy === 'function') inner.destroy(); } catch (e) { console.error('[views] destroy failed', e); }
      inner = null;
      inner = factory();
      for (const rec of [...subs, ...overlays]) replay(rec);
      for (const [name, args] of state) if (typeof inner[name] === 'function') { try { inner[name](...args); } catch (e) { console.error(e); } }
      if (typeof inner.resize === 'function') inner.resize();
    },
  };
  return new Proxy(own, {
    get(target, key) {
      if (key in target) return target[key];
      if (!inner) return typeof key === 'string' ? () => undefined : undefined;
      const v = inner[key];
      return typeof v === 'function' ? v.bind(inner) : v;
    },
    has(target, key) { return key in target || (!!inner && key in inner); },
  });
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('boot-status');
  if (el) { el.textContent = 'Something went wrong while starting the app: ' + (err && err.message ? err.message : err); el.classList.add('error'); }
});
