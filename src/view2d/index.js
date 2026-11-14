/**
 * 2D plan editor — public entry point (docs/CONTRACT.md § 4).
 *
 *   const view = createView2D(container, { store, plan, catalog, models });
 *
 * Modules: camera (pan / zoom / fit), theme (palette from CSS custom properties), renderer (cached layers:
 * site, floors, walls, openings, items, annotations), overlay (selection, guides, read-outs), snapping,
 * interaction (pointer / wheel / keys), dimensions (chains derived from the plan) and export (PNG sheet).
 * Editing the building itself (docs/CONTRACT.md § 7): structure (per-revision data + cached tints / changes),
 * structure-tools (gestures → core/plan-edit.js) and structure-overlay (hover, grips, ghosts, read-outs).
 *
 * Several floors (docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md, stage F2): the view shows ONE level, `store.ui.level`.
 * `env.plan` is that level's PLAN-shaped view (levelPlan; PLAN itself on the ground floor) and is read at use, never
 * kept; items are filtered by their `level` (env.shown), the floor below is drawn as a faint ghost (levels.js).
 *
 * The plan engine REPLACES plan.walls / openings / rooms on every edit and the store emits 'plan'. Nothing in
 * this view keeps those arrays: every layer reads `plan` when it paints, per-revision data is cached on the
 * arrays' identity, and a 'plan' event only has to invalidate the layer caches.
 */
import { itemAABB, polygonBounds, clamp } from '../core/geometry.js';
import { Camera } from './camera.js';
import { createTheme } from './theme.js';
import { createRenderer } from './renderer.js';
import { createSnapper } from './snapping.js';
import { attachInteraction } from './interaction.js';
import { drawOverlay } from './overlay.js';
import { exportPNG } from './export.js';
import { houseEnvelope, dimensionOverhang } from './annotations.js';
import { planSnapshot, planDirt } from './structure.js';
import { levelPlan } from '../core/plan-edit.js';
import { levelOf } from '../core/levels.js';
import { isShownOn } from './levels.js';

/** `store.ui` keys that change what the cached plan layers look like. */
const PAINTED_UI = new Set(['tool', 'units', 'showGrid', 'showDimensions', 'showRoomLabels', 'showSite', 'showItems', 'showPlanChanges', 'level', 'ghostBelow']);

/**
 * @param {HTMLElement} container  mount point; the view fills it
 * @param {{ store, plan, catalog, models }} ctx
 */
export function createView2D(container, ctx) {
  const { store, plan, catalog, models } = ctx;
  const canvas = document.createElement('canvas');
  canvas.className = 'view2d-canvas';
  canvas.setAttribute('aria-label', 'Floor plan editor');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', touchAction: 'none', userSelect: 'none', outline: 'none' });
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(canvas);

  const cam = new Camera();
  const env = { store, catalog, models, pal: null, font: 'sans-serif', ui: store.ui, onUnderlayReady: null, rootPlan: plan };
  // The level shown and its plan view, read at every use (an edit on an upper level gives that level a new view object;
  // undo or someone else can remove the level, and the store then falls back to the ground floor).
  const levelId = () => store.ui.level || 'L0';
  const viewPlan = () => { const id = levelId(); return id === 'L0' ? plan : levelPlan(plan, id) || plan; };
  Object.defineProperty(env, 'plan', { get: viewPlan, enumerable: true });
  // (cheap: no view refresh — read on every item of every frame)
  Object.defineProperty(env, 'level', { get: () => { const id = levelId(); return id === 'L0' || !levelOf(plan, id) ? 'L0' : id; }, enumerable: true });
  /** Drawn, picked and snapped to: not hidden and on the floor shown. */
  env.shown = (it) => isShownOn(it, env.level);
  const listeners = new Map();
  const state = { hoverId: null, gesture: null, placing: null, feedback: null, marquee: null, measures: [], measureDraft: null, spaceDown: false, live: new Set(), struct: null, flash: null };
  const V = { container, canvas, cam, env, state, active: true, selfWrite: false, dpr: 1, renderer: null, snapper: null, theme: null };

  let raf = 0, lastTime = 0, lastScale = NaN, fitted = false, destroyed = false;

  // The built-in scale bar / north arrow step aside when the host UI overlays its own on this pane.
  let hudChecked = 0, hudFree = true;
  V.showHud = () => {
    if (!V.theme.hud) return false;
    const now = performance.now();
    if (now - hudChecked > 1000) { hudChecked = now; hudFree = !container.parentElement?.querySelector('.scalebar, .compass'); }
    return hudFree;
  };
  V.emit = (name, payload) => {
    listeners.get(name)?.forEach((fn) => { try { fn(payload); } catch (err) { console.error(`[view2d] "${name}" listener failed`, err); } });
  };
  V.invalidate = () => { if (!raf && V.active && !destroyed) raf = requestAnimationFrame(frame); };

  V.theme = createTheme(container, (t) => { env.pal = t.palette; env.font = t.font; V.renderer?.invalidate(); V.invalidate(); });
  env.pal = V.theme.palette; env.font = V.theme.font;
  V.renderer = createRenderer(canvas, env);
  V.snapper = createSnapper({ plan: viewPlan, store, shown: env.shown });

  function frame(now) {
    raf = 0;
    if (!V.active || destroyed || canvas.width < 2 || canvas.height < 2) return;
    const dt = clamp(now - (lastTime || now), 0, 50);
    lastTime = now;
    const moving = cam.tick(now, dt || 16);
    env.ui = store.ui;
    const zooming = cam.scale !== lastScale;
    V.renderer.render(cam, { dpr: V.dpr, live: state.live, direct: zooming && Number.isFinite(lastScale), overlay: (G) => { drawOverlay(G, V); paintExtraOverlays(G); } });
    if (zooming) { lastScale = cam.scale; V.emit('zoom', { scale: cam.scale }); }
    if (state.flash && now - state.flash.t0 > 1500) state.flash = null;
    if (moving || state.flash) V.invalidate(); else lastTime = 0;
  }

  // ───────────── sizing ─────────────
  function applySize(cssW, cssH, pxW, pxH) {
    if (cssW < 1 || cssH < 1) return;
    const dpr = window.devicePixelRatio || 1;
    const w = pxW || Math.round(cssW * dpr), h = pxH || Math.round(cssH * dpr);
    if (canvas.width === w && canvas.height === h && cam.w === cssW && cam.h === cssH) return;
    // keep the same plan point in the centre of the view
    if (fitted) { cam.tx += (cssW - cam.w) / 2; cam.ty += (cssH - cam.h) / 2; }
    canvas.width = w; canvas.height = h;
    cam.w = cssW; cam.h = cssH;
    V.dpr = w / cssW;
    V.renderer.invalidate();
    if (!fitted) { fitted = true; fit(store.ui.showSite ? 'lot' : 'house', { animate: false }); }
    V.invalidate();
  }
  function resize() {
    V.theme.refresh();
    applySize(container.clientWidth, container.clientHeight);
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    const e = entries[entries.length - 1];
    const dp = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0];
    const cb = e.contentBoxSize && e.contentBoxSize[0];
    const cssW = cb ? cb.inlineSize : e.contentRect.width, cssH = cb ? cb.blockSize : e.contentRect.height;
    applySize(cssW, cssH, dp ? dp.inlineSize : 0, dp ? dp.blockSize : 0);
  }) : null;
  if (ro) { try { ro.observe(container, { box: 'device-pixel-content-box' }); } catch (err) { ro.observe(container); } }

  // ───────────── camera API ─────────────
  function targetRect(target) {
    if (target && typeof target === 'object') return { rect: { x: +target.x || 0, y: +target.y || 0, w: Math.max(1, +target.w || 1), h: Math.max(1, +target.h || 1) }, extra: 0 };
    if (target === 'selection') {
      const sel = store.getSelected();
      if (sel.length) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const it of sel) { const b = itemAABB(it); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
        return { rect: { x: x0, y: y0, w: Math.max(40, x1 - x0), h: Math.max(40, y1 - y0) }, extra: 60, maxScale: 3 };
      }
      target = 'house';
    }
    const plan = env.plan;
    if (target === 'house' && !plan.walls.length) target = 'lot';   // nothing drawn yet (a new project): frame the lot
    if (target === 'house') {
      const h = houseEnvelope(plan);
      return { rect: { x: h.x0, y: h.y0, w: h.x1 - h.x0, h: h.y1 - h.y0 }, extra: 14, dims: true, nearOnly: true };
    }
    const b = plan.site.bounds || polygonBounds(plan.site.boundary);
    return { rect: { x: b.x, y: b.y, w: b.w, h: b.h }, extra: 26, dims: true };
  }
  /**
   * Frame a target in the view. With dimensions on, the lot / the house are framed together with their exterior
   * dimension chains (whose distance from the house depends on the zoom, hence the short iteration); for the
   * house only the chains that sit right beside it count.
   * @param {'lot'|'house'|'selection'|{x:number,y:number,w:number,h:number}} target
   * @param {{ animate?: boolean, padding?: number }} opts
   */
  function fit(target = 'lot', opts = {}) {
    if (cam.w < 2 || cam.h < 2) return;
    const { rect, extra, maxScale, dims, nearOnly } = targetRect(target);
    const edge = clamp(Math.min(cam.w, cam.h) * 0.045, 10, 44), own = opts.padding ?? extra;
    const ins = V.theme.insets;
    const pads = (over) => ({
      top: edge + ins.top + Math.max(own, over.top), right: edge + ins.right + Math.max(own, over.right),
      bottom: edge + ins.bottom + Math.max(own, over.bottom), left: edge + ins.left + Math.max(own, over.left),
    });
    let pad = pads({ top: 0, right: 0, bottom: 0, left: 0 });
    if (dims && store.ui.showDimensions && opts.padding == null) {
      for (let i = 0; i < 3; i++) {
        const over = dimensionOverhang(env.plan, store.ui, cam.frame(rect, pad, maxScale).scale, rect, nearOnly);
        pad = pads({ top: over.top + 6, right: over.right + 6, bottom: over.bottom + 6, left: over.left + 6 });
      }
    }
    cam.goTo(cam.frame(rect, pad, maxScale), opts.animate === false ? 0 : 420);
    V.invalidate();
  }
  /**
   * Bring a plan point to the middle of the view (animated) and pulse it — used by the "changes" list.
   * @param {number} x  plan cm
   * @param {number} y  plan cm
   * @param {{ zoom?: number, animate?: boolean }} opts  zoom = CSS px per cm (default: at least 0.9, never zooming out)
   */
  function focusPlanPoint(x, y, opts = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || cam.w < 2 || cam.h < 2) return;
    const scale = clamp(Number(opts.zoom) > 0 ? Number(opts.zoom) : Math.max(cam.scale, 0.9), cam.minScale, cam.maxScale);
    const ins = V.theme.insets;
    const cx = ins.left + (cam.w - ins.left - ins.right) / 2, cy = ins.top + (cam.h - ins.top - ins.bottom) / 2;
    cam.goTo({ scale, tx: cx - x * scale, ty: cy - y * scale }, opts.animate === false ? 0 : 420);
    state.flash = { x, y, t0: performance.now() + (opts.animate === false ? 0 : 260) };
    V.invalidate();
  }
  V.fit = fit;

  // Host overlays (hook for the UI's Carpentry mode): painted on top of the plan every frame, in device space.
  const extraOverlays = new Set();
  function paintExtraOverlays(G) {
    for (const fn of extraOverlays) { try { G.deviceSpace(); fn(G, env.pal); } catch (err) { console.error('[view2d] overlay failed', err); } }
    G.deviceSpace();
  }

  // ───────────── store wiring ─────────────
  env.onUnderlayReady = () => { if (!destroyed) { V.renderer?.invalidate(); V.invalidate(); } };   // the sketch image finished decoding
  const interaction = attachInteraction(V);
  let planShot = planSnapshot(env.plan), shotLevel = env.level;   // fingerprint of the drawn plan, to find what the next edit touched
  /** The floor shown changed (or fell back to the ground floor): drop what was in progress, repaint everything. */
  function levelShown() {
    shotLevel = env.level;
    planShot = planSnapshot(env.plan);
    interaction.levelChanged();
    state.live.clear(); state.hoverId = null;
    V.renderer.invalidate();
  }
  const offs = [
    store.on('items', (e) => {
      if (e.transient) { if (!state.gesture || state.gesture.type === 'c-drag') for (const id of e.ids) state.live.add(id); }   // c-drag: an island moved in Carpentry mode
      else { if (!state.gesture) state.live.clear(); V.renderer.invalidate(); }
      interaction.externalItems(e);
      if (state.hoverId && !store.getItem(state.hoverId)) state.hoverId = null;
      V.invalidate();
    }),
    // (undo / redo restore through 'items' / 'plan' / 'finishes' / 'project' events, which repaint what they touch)
    store.on('history', () => { if (!state.gesture && state.live.size) { state.live.clear(); V.renderer.invalidate(); } V.invalidate(); }),
    store.on('selection', () => V.invalidate()),
    store.on('ui', (e) => {
      if (e.keys && e.keys.includes('tool')) interaction.toolChanged();
      if (e.keys && e.keys.includes('structureSel')) interaction.structureSelChanged();
      if (e.keys && e.keys.includes('level') && env.level !== shotLevel) levelShown();
      // only these settings are baked into the cached layers; the rest (selection, panels, 3D settings …) is not
      if (!e.keys || e.keys.some((k) => PAINTED_UI.has(k))) V.renderer.invalidate();
      V.invalidate();
    }),
    // walls / openings / rooms were replaced: repaint every layer from the new plan (snapping, hit-testing and
    // the dimension chains re-derive themselves from the new arrays the next time they are used)
    store.on('plan', (e) => {
      if (env.level !== shotLevel) { levelShown(); interaction.planChanged(e); V.invalidate(); return; }   // its level went
      interaction.planChanged(e);
      const shot = planSnapshot(env.plan);
      // on an upper level a change elsewhere (the floor below = the ghost, undo of another floor) repaints everything
      const elsewhere = env.level !== 'L0' && !(e && e.levelId === env.level);
      if (elsewhere) V.renderer.invalidate(); else V.renderer.invalidatePlan(planDirt(planShot, shot));
      planShot = shot;
      V.invalidate();
    }),
    store.on('project', () => { V.renderer.invalidate(); V.invalidate(); }),
    store.on('finishes', () => { V.renderer.invalidate(); V.invalidate(); }),
    store.on('underlay', () => { V.renderer.invalidate(); V.invalidate(); }),
    store.on('load', () => { if (env.level !== shotLevel) levelShown(); interaction.cancel(); state.live.clear(); state.hoverId = null; V.renderer.invalidate(); V.invalidate(); }),
  ];

  resize();

  return {
    /** Re-measure the container (call after layout changes; a ResizeObserver also does this automatically). */
    resize,
    /** Pause / resume rendering and input (the view is hidden while another mode is shown). */
    setActive(on) {
      V.active = !!on;
      if (V.active) { resize(); V.renderer.invalidate(); V.invalidate(); }
      else { interaction.cancel(); if (raf) { cancelAnimationFrame(raf); raf = 0; } lastTime = 0; }
    },
    fit,
    /** Zoom by a factor about the centre of the view (animated). */
    zoomBy(factor) { if (factor > 0) { cam.zoomToward(cam.w / 2, cam.h / 2, factor); V.invalidate(); } },
    /** Current zoom in CSS px per cm. */
    getScale: () => cam.scale,
    screenToPlan(clientX, clientY) { const r = canvas.getBoundingClientRect(); return cam.toPlan(clientX - r.left, clientY - r.top); },
    planToScreen(x, y) { const r = canvas.getBoundingClientRect(), p = cam.toScreen(x, y); return { x: p.x + r.left, y: p.y + r.top }; },
    /** Ghost follows the cursor; click places (Shift keeps placing), Esc / right-click cancels. onDone(item|null). */
    startPlacing: (partial, opts) => interaction.startPlacing(partial, opts),
    /** Rotate the ghost while placing (not in the contract; handy for an "R" shortcut). */
    rotatePlacing: (deg) => interaction.rotatePlacing(deg),
    cancelPlacing: () => interaction.cancelPlacing(),
    isPlacing: () => !!state.placing,
    /** One-shot snapped placement at a client position (HTML5 drag-and-drop). */
    dropAt: (clientX, clientY, partial) => interaction.dropAt(clientX, clientY, partial),
    /** PNG sheet of the floor shown. opts.ghost: also draw the ghost of the floor below (off by default). */
    exportPNG: (opts = {}) => exportPNG({ store, plan: env.plan, rootPlan: plan, level: env.level, shown: env.shown, exportGhost: !!opts.ghost, catalog, models, font: env.font }, opts),
    focusPlanPoint,
    /** Wall segment / opening under the cursor while the 'structure' tool is active: `{ type, id, level, reason }` or null. */
    getStructureHover: () => interaction.getStructureHover(),
    /**
     * Events: 'cursor' {x,y,space}, 'zoom' {scale}, 'placing' {state,…}, 'contextmenu' {item,structure?,clientX,clientY},
     * 'item-dblclick' {item}, 'structure' {type:'done'|'refused'|'locked'|'warning', op, level, text, clientX, clientY},
     * 'carpentry-pick' {x, y, clientX, clientY, itemId|null} (Carpentry mode: a click on the plan; itemId = the carpentry unit
     * under it), 'carpentry-locked' {itemId, op} (a furniture gesture refused on a carpentry unit).
     */
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      offs.forEach((off) => off());
      interaction.destroy(); V.theme.destroy(); V.renderer.destroy(); ro?.disconnect();
      canvas.remove(); listeners.clear();
    },
    /**
     * Hook (Carpentry mode): paint `fn(G, palette)` over the plan on every frame (G = the device-space drawing helper of
     * gfx.js). Returns a function that removes it. Call redraw() when what it paints changes.
     */
    addOverlay(fn) { if (typeof fn !== 'function') return () => {}; extraOverlays.add(fn); V.invalidate(); return () => { extraOverlays.delete(fn); V.invalidate(); }; },
    /**
     * Hook (Carpentry mode): `handler = { canDrag(itemId) → bool, start({ itemId, x, y }), move({ itemId, x, y, dx, dy, snap }),
     * end({ itemId }), cancel() }` (plan cm). A press-drag on a carpentry unit the handler accepts is reported to it instead of
     * panning; Esc / pointer-cancel calls cancel(). Pass null to remove it.
     */
    setCarpentryDrag(handler) { interaction.setCarpentryDrag(handler); },
    /** Request a repaint of the overlay (cheap: the cached plan layers are reused). */
    redraw() { V.invalidate(); },
    /** Test / diagnostics handle (not part of the contract). */
    _debug: { state, cam, env, stats: V.renderer.stats, snapper: V.snapper, renderNow() { if (raf) { cancelAnimationFrame(raf); raf = 0; } frame(performance.now()); return V.renderer.stats; } },
  };
}

export default createView2D;
