/**
 * 2D plan editor — public entry point (docs/CONTRACT.md § 4).
 *
 *   const view = createView2D(container, { store, plan, catalog, models });
 *
 * Modules: camera (pan / zoom / fit), theme (palette from CSS custom properties), renderer (cached layers:
 * site, floors, walls, openings, items, annotations), overlay (selection, guides, read-outs), snapping,
 * interaction (pointer / wheel / keys), dimensions (chains derived from the plan) and export (PNG sheet).
 */
import { itemAABB, polygonBounds, clamp } from '../core/geometry.js';
import { Camera } from './camera.js';
import { createTheme } from './theme.js';
import { createRenderer } from './renderer.js';
import { createSnapper } from './snapping.js';
import { attachInteraction } from './interaction.js';
import { drawOverlay } from './overlay.js';
import { exportPNG } from './export.js';
import { houseEnvelope, dimensionMargin } from './annotations.js';

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
  const env = { store, plan, catalog, models, pal: null, font: 'sans-serif', ui: store.ui };
  const listeners = new Map();
  const state = { hoverId: null, gesture: null, placing: null, feedback: null, marquee: null, measures: [], measureDraft: null, spaceDown: false, live: new Set() };
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
  V.snapper = createSnapper({ plan, store });

  function frame(now) {
    raf = 0;
    if (!V.active || destroyed || canvas.width < 2 || canvas.height < 2) return;
    const dt = clamp(now - (lastTime || now), 0, 50);
    lastTime = now;
    const moving = cam.tick(now, dt || 16);
    env.ui = store.ui;
    const zooming = cam.scale !== lastScale;
    V.renderer.render(cam, { dpr: V.dpr, live: state.live, direct: zooming && Number.isFinite(lastScale), overlay: (G) => drawOverlay(G, V) });
    if (zooming) { lastScale = cam.scale; V.emit('zoom', { scale: cam.scale }); }
    if (moving) V.invalidate(); else lastTime = 0;
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
    if (target === 'house') {
      const h = houseEnvelope(plan);
      return { rect: { x: h.x0, y: h.y0, w: h.x1 - h.x0, h: h.y1 - h.y0 }, extra: store.ui.showDimensions ? dimensionMargin(plan) : 14 };
    }
    const b = plan.site.bounds || polygonBounds(plan.site.boundary);
    return { rect: { x: b.x, y: b.y, w: b.w, h: b.h }, extra: 26 };
  }
  /**
   * Frame a target in the view.
   * @param {'lot'|'house'|'selection'|{x:number,y:number,w:number,h:number}} target
   * @param {{ animate?: boolean, padding?: number }} opts
   */
  function fit(target = 'lot', opts = {}) {
    if (cam.w < 2 || cam.h < 2) return;
    const { rect, extra, maxScale } = targetRect(target);
    const base = clamp(Math.min(cam.w, cam.h) * 0.045, 10, 44) + (opts.padding ?? extra);
    const ins = V.theme.insets;
    const pad = { top: base + ins.top, right: base + ins.right, bottom: base + ins.bottom, left: base + ins.left };
    cam.goTo(cam.frame(rect, pad, maxScale), opts.animate === false ? 0 : 420);
    V.invalidate();
  }
  V.fit = fit;

  // ───────────── store wiring ─────────────
  const interaction = attachInteraction(V);
  const offs = [
    store.on('items', (e) => {
      if (e.transient) { if (!state.gesture) for (const id of e.ids) state.live.add(id); }
      else { if (!state.gesture) state.live.clear(); V.renderer.invalidate(); }
      interaction.externalItems(e);
      if (state.hoverId && !store.getItem(state.hoverId)) state.hoverId = null;
      V.invalidate();
    }),
    store.on('history', () => { if (!state.gesture && state.live.size) state.live.clear(); V.renderer.invalidate(); V.invalidate(); }),
    store.on('selection', () => V.invalidate()),
    store.on('ui', (e) => {
      if (e.keys && e.keys.includes('tool')) interaction.toolChanged();
      V.renderer.invalidate(); V.invalidate();
    }),
    store.on('project', () => { V.renderer.invalidate(); V.invalidate(); }),
    store.on('finishes', () => { V.renderer.invalidate(); V.invalidate(); }),
    store.on('load', () => { interaction.cancel(); state.live.clear(); state.hoverId = null; V.renderer.invalidate(); V.invalidate(); }),
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
    exportPNG: (opts) => exportPNG({ store, plan, catalog, models, font: env.font }, opts),
    /** Events: 'cursor' {x,y,space}, 'zoom' {scale}, 'placing' {state,…}, 'contextmenu' {item,clientX,clientY}, 'item-dblclick' {item}. */
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
    /** Test / diagnostics handle (not part of the contract). */
    _debug: { state, cam, env, stats: V.renderer.stats, snapper: V.snapper, renderNow() { if (raf) { cancelAnimationFrame(raf); raf = 0; } frame(performance.now()); return V.renderer.stats; } },
  };
}

export default createView2D;
