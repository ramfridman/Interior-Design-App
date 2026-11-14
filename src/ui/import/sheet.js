/**
 * The drawing viewer of the import dialog: the page (or image) on a canvas with pan / zoom, an overlay painted by the
 * caller, and two pointer modes — 'pick' (precise point picking with a magnifying loupe and snapping to line ends)
 * and 'click' (a plain click on the drawing, e.g. to choose one of several drawings).
 *
 * Coordinates are SHEET UNITS: PDF points for a PDF page, pixels of the analysed image for a picture — the units the
 * engine's `transform` starts from. The image shown is `pxPerUnit` image pixels per sheet unit.
 *
 *   const sheet = createSheet({ label, onPick(pt, snapped), onClick(pt), snap(pt, radiusUnits) → [x, y] | null });
 *   sheet.setImage(canvas, pxPerUnit); sheet.setOverlay((ctx, S) => …); sheet.setMode('pick'); sheet.fit();
 *   S = { X(u), Y(v) → screen px (CSS), zoom (CSS px per unit), dpr, pal }
 */
import { h } from '../dom.js';
import { iconBtn } from '../components.js';

const LOUPE = 128, LOUPE_ZOOM = 4, SNAP_PX = 7;   // snap radius in screen px (the loupe shows it 4× larger)

export function createSheet(o = {}) {
  const canvas = h('canvas', { class: 'isheet__canvas', role: 'img', 'aria-label': o.label || 'The drawing' });
  const hint = h('p', { class: 'isheet__hint', hidden: true });
  const zoomIn = iconBtn('plus', 'Zoom in', { size: 16, onClick: () => zoomAt(cw / 2, ch / 2, 1.4) });
  const zoomOut = iconBtn('minus', 'Zoom out', { size: 16, onClick: () => zoomAt(cw / 2, ch / 2, 1 / 1.4) });
  const fitBtn = iconBtn('fit', 'Fit the drawing', { size: 16, onClick: () => fit() });
  const el = h('div', { class: 'isheet' }, canvas, h('div', { class: 'isheet__tools' }, zoomIn, zoomOut, fitBtn), hint);
  const ctx = canvas.getContext('2d');
  let img = null, ppu = 1, overlay = null, mode = 'view', showPage = true;
  let zoom = 1, tx = 0, ty = 0, cw = 0, ch = 0, dpr = 1, fitted = false;
  let cursor = null;        // { x, y } CSS px over the canvas while hovering
  let raf = 0;
  const pal = readPalette(el);

  const X = (u) => u * zoom + tx, Y = (v) => v * zoom + ty;
  const toUnits = (x, y) => [(x - tx) / zoom, (y - ty) / zoom];
  const S = { X, Y, get zoom() { return zoom; }, get dpr() { return dpr; }, pal };

  function resize() {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = r.width; ch = r.height;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    if (!fitted) fit(); else redraw();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  ro?.observe(el);

  function fit(box) {
    if (!img || !cw) return;
    const b = box || { x: 0, y: 0, w: img.width / ppu, h: img.height / ppu };
    const pad = 16;
    zoom = Math.min((cw - 2 * pad) / b.w, (ch - 2 * pad) / b.h);
    tx = (cw - b.w * zoom) / 2 - b.x * zoom; ty = (ch - b.h * zoom) / 2 - b.y * zoom;
    fitted = true;
    redraw();
  }
  function zoomAt(x, y, f) {
    const z = Math.max(0.02, Math.min(400, zoom * f));
    const [u, v] = toUnits(x, y);
    zoom = z; tx = x - u * zoom; ty = y - v * zoom;
    redraw();
  }
  function redraw() { if (!raf) raf = requestAnimationFrame(paint); }

  function snapAt(x, y) {
    const [u, v] = toUnits(x, y);
    if (mode === 'pick' && o.snap) { const p = o.snap([u, v], SNAP_PX / zoom); if (p) return { pt: p, snapped: true }; }
    return { pt: [u, v], snapped: false };
  }

  function paint() {
    raf = 0;
    if (!cw) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = pal.well; ctx.fillRect(0, 0, cw, ch);
    if (img) {
      const w = img.width / ppu * zoom, hh = img.height / ppu * zoom;
      if (showPage) {
        ctx.imageSmoothingEnabled = zoom * (1 / ppu) < 2;
        ctx.drawImage(img, tx, ty, w, hh);
      } else { ctx.fillStyle = '#ffffff'; ctx.fillRect(tx, ty, w, hh); }
      ctx.strokeStyle = pal.line; ctx.lineWidth = 1; ctx.strokeRect(Math.round(tx) + 0.5, Math.round(ty) + 0.5, Math.round(w), Math.round(hh));
    }
    if (overlay) { ctx.save(); try { overlay(ctx, S); } catch (e) { console.error('[import] overlay failed', e); } ctx.restore(); }
    if (mode === 'pick' && cursor && img) paintLoupe();
  }

  function paintLoupe() {
    const { pt, snapped } = snapAt(cursor.x, cursor.y);
    const sx = X(pt[0]), sy = Y(pt[1]);
    // crosshair at the (snapped) point
    ctx.strokeStyle = snapped ? pal.snap : pal.accent; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx - 9, sy); ctx.lineTo(sx + 9, sy); ctx.moveTo(sx, sy - 9); ctx.lineTo(sx, sy + 9); ctx.stroke();
    if (snapped) { ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.stroke(); }
    // the loupe: up-right of the cursor (flipped when it would leave the canvas)
    let lx = cursor.x + 22, ly = cursor.y - 22 - LOUPE;
    if (lx + LOUPE > cw - 4) lx = cursor.x - 22 - LOUPE;
    if (ly < 4) ly = cursor.y + 22;
    const z = zoom * LOUPE_ZOOM;
    ctx.save();
    ctx.beginPath(); ctx.arc(lx + LOUPE / 2, ly + LOUPE / 2, LOUPE / 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(lx, ly, LOUPE, LOUPE);
    const ox = lx + LOUPE / 2 - pt[0] * z, oy = ly + LOUPE / 2 - pt[1] * z;
    ctx.imageSmoothingEnabled = false;
    if (showPage) ctx.drawImage(img, ox, oy, img.width / ppu * z, img.height / ppu * z);
    if (overlay) {
      // the overlay again, magnified (same painter, a magnified view)
      const L = { X: (u) => u * z + ox, Y: (v) => v * z + oy, zoom: z, dpr, pal, loupe: true };
      try { overlay(ctx, L); } catch (e) { /* ignore */ }
    }
    ctx.strokeStyle = snapped ? pal.snap : pal.accent; ctx.lineWidth = 1;
    const c = [lx + LOUPE / 2, ly + LOUPE / 2];
    ctx.beginPath(); ctx.moveTo(c[0] - 14, c[1] + 0.5); ctx.lineTo(c[0] + 14, c[1] + 0.5); ctx.moveTo(c[0] + 0.5, c[1] - 14); ctx.lineTo(c[0] + 0.5, c[1] + 14); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = pal.line2; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(lx + LOUPE / 2, ly + LOUPE / 2, LOUPE / 2, 0, Math.PI * 2); ctx.stroke();
  }

  // ── pointer: drag pans, a click picks / clicks, the wheel zooms ──
  const pointers = new Map();
  let drag = null, pinch = null;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvas.setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      drag = null; return;
    }
    drag = { x0: p.x, y0: p.y, tx, ty, moved: false, touch: e.pointerType !== 'mouse' };
    if (drag.touch) { cursor = p; redraw(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.d > 0) { const f = (pinch.zoom * d / pinch.d) / zoom; zoomAt(pinch.cx, pinch.cy, f); }
      return;
    }
    if (drag) {
      // touch in pick mode: the finger moves the crosshair (loupe above it) instead of panning
      if (drag.touch && mode === 'pick') { cursor = p; drag.moved = true; redraw(); return; }
      if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) > 4) drag.moved = true;
      if (drag.moved) { tx = drag.tx + p.x - drag.x0; ty = drag.ty + p.y - drag.y0; canvas.style.cursor = 'grabbing'; }
    }
    if (e.pointerType === 'mouse') cursor = p;
    redraw();
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
    if (!drag) return;
    const d = drag; drag = null;
    canvas.style.cursor = '';
    if (e.type === 'pointercancel') return;
    const pickNow = d.touch && mode === 'pick' ? true : !d.moved;
    if (pickNow && img) {
      const p = d.touch && mode === 'pick' ? cursor : local(e);
      const { pt, snapped } = snapAt(p.x, p.y);
      if (mode === 'pick' && o.onPick) o.onPick(pt, snapped);
      else if (mode === 'click' && o.onClick) o.onClick(pt);
    }
    if (d.touch) cursor = null;
    redraw();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { cursor = null; redraw(); } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    zoomAt(p.x, p.y, Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004));
  }, { passive: false });

  return {
    el,
    setImage(canvasImg, pxPerUnit = 1) { img = canvasImg; ppu = pxPerUnit; fitted = false; resize(); },
    setOverlay(fn) { overlay = fn; redraw(); },
    setMode(m) { mode = m; canvas.classList.toggle('is-pick', m === 'pick'); canvas.classList.toggle('is-click', m === 'click'); if (m !== 'pick') cursor = null; redraw(); },
    setHint(text) { hint.textContent = text || ''; hint.hidden = !text; },
    showPage(on) { showPage = !!on; redraw(); },
    fit, redraw, resize,
    /** Screen (CSS px relative to the canvas) of a sheet point — for tests. */
    toScreen: (u, v) => [X(u), Y(v)],
    canvas,
    destroy() { ro?.disconnect(); if (raf) cancelAnimationFrame(raf); },
  };
}

/** Colours from the design tokens (the dialog lives in the themed document). */
function readPalette(el) {
  const get = (name, fallback) => { try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; } catch (e) { return fallback; } };
  return {
    well: get('--sunken', '#eceeea'), line: get('--line-strong', 'rgba(23,32,38,.24)'), line2: get('--ink-2', '#4b5759'),
    accent: get('--accent', '#1d4e89'), snap: get('--level-permit', '#6a3d9a'), warn: get('--warn', '#875100'),
    pass: get('--pass', '#256e43'), fail: get('--fail', '#a8322a'), ink: get('--ink', '#172026'),
  };
}
