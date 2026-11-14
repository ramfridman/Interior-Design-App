/**
 * The "Align floors" viewer of the import dialog (stage F8): two floors drawn over each other in plan cm — the floor
 * below grey, the upper floor in the accent colour at 60 % opacity, moved by (dx, dy). Drag the upper floor with a finger
 * or the mouse (on release its wall faces snap to the lower floor's, else it lands on the 5 cm grid), drag elsewhere to
 * pan, pinch / wheel to zoom, arrow keys nudge 1 cm (Shift 5 cm). In 'pick' mode a click picks a point (snapped to the
 * nearest wall corner of the floor asked for) — "Match two points".
 *
 *   const v = createAlignView({ onMove(dx, dy, { final }), onPick(pt), snap(dx, dy, radiusCm) → { dx, dy } });
 *   v.set({ lower, upper, dx, dy, marks }); v.setMode('drag' | 'pick-upper' | 'pick-lower'); v.fit(); v.redraw();
 * `lower` / `upper` = { walls, openings, slants?, outline? } in their own plan cm (upper drawn at + (dx, dy)).
 */
import { h } from '../dom.js';
import { iconBtn } from '../components.js';

const CORNER_PX = 12;

export function createAlignView(o = {}) {
  const canvas = h('canvas', { class: 'ialign__canvas', role: 'img', tabindex: '0', 'aria-label': o.label || 'The two floors over each other. Drag the upper floor to move it; arrow keys nudge it by 1 cm, with Shift by 5 cm.' });
  const hint = h('p', { class: 'isheet__hint', hidden: true });
  const zoomIn = iconBtn('plus', 'Zoom in', { size: 16, onClick: () => zoomAt(cw / 2, ch / 2, 1.4) });
  const zoomOut = iconBtn('minus', 'Zoom out', { size: 16, onClick: () => zoomAt(cw / 2, ch / 2, 1 / 1.4) });
  const fitBtn = iconBtn('fit', 'Fit both floors', { size: 16, onClick: () => fit() });
  const el = h('div', { class: 'isheet ialign' }, canvas, h('div', { class: 'isheet__tools' }, zoomIn, zoomOut, fitBtn), hint);
  const ctx = canvas.getContext('2d');
  let D = { lower: null, upper: null, dx: 0, dy: 0, picks: [] };
  let mode = 'drag', zoom = 0.5, tx = 0, ty = 0, cw = 0, ch = 0, dpr = 1, fitted = false, raf = 0;
  const pal = palette();
  const X = (x) => x * zoom + tx, Y = (y) => y * zoom + ty;
  const toCm = (sx, sy) => [(sx - tx) / zoom, (sy - ty) / zoom];

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

  function boxOf(f, dx = 0, dy = 0) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const w of (f && f.walls) || []) { x0 = Math.min(x0, w.x + dx); y0 = Math.min(y0, w.y + dy); x1 = Math.max(x1, w.x + w.w + dx); y1 = Math.max(y1, w.y + w.h + dy); }
    for (const s of (f && f.slants) || []) for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) { x0 = Math.min(x0, x + dx); y0 = Math.min(y0, y + dy); x1 = Math.max(x1, x + dx); y1 = Math.max(y1, y + dy); }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
  }
  function fit() {
    if (!cw) return;
    const a = boxOf(D.lower), b = boxOf(D.upper, D.dx, D.dy);
    const bs = [a, b].filter(Boolean);
    if (!bs.length) return;
    const x0 = Math.min(...bs.map((q) => q.x0)), y0 = Math.min(...bs.map((q) => q.y0)), x1 = Math.max(...bs.map((q) => q.x1)), y1 = Math.max(...bs.map((q) => q.y1));
    const pad = 28;
    zoom = Math.min((cw - 2 * pad) / Math.max(1, x1 - x0), (ch - 2 * pad) / Math.max(1, y1 - y0));
    tx = (cw - (x1 - x0) * zoom) / 2 - x0 * zoom; ty = (ch - (y1 - y0) * zoom) / 2 - y0 * zoom;
    fitted = true;
    redraw();
  }
  function zoomAt(x, y, f) {
    const z = Math.max(0.01, Math.min(40, zoom * f));
    const [u, v] = toCm(x, y);
    zoom = z; tx = x - u * zoom; ty = y - v * zoom;
    redraw();
  }
  function redraw() { if (!raf) raf = requestAnimationFrame(paint); }

  function floorPath(f, dx, dy) {
    ctx.beginPath();
    for (const w of f.walls || []) ctx.rect(X(w.x + dx), Y(w.y + dy), w.w * zoom, w.h * zoom);
    for (const s of f.slants || []) {
      const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1, nx = -(s.y2 - s.y1) / L * s.t / 2, ny = (s.x2 - s.x1) / L * s.t / 2;
      ctx.moveTo(X(s.x1 + nx + dx), Y(s.y1 + ny + dy)); ctx.lineTo(X(s.x2 + nx + dx), Y(s.y2 + ny + dy)); ctx.lineTo(X(s.x2 - nx + dx), Y(s.y2 - ny + dy)); ctx.lineTo(X(s.x1 - nx + dx), Y(s.y1 - ny + dy)); ctx.closePath();
    }
  }
  function marksPath(list, dx, dy) {
    ctx.beginPath();
    for (const m of list || []) ctx.rect(X(m.x + dx), Y(m.y + dy), m.w * zoom, m.h * zoom);
  }
  function paint() {
    raf = 0;
    if (!cw) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, cw, ch);
    if (D.lower) {
      floorPath(D.lower, 0, 0);
      ctx.fillStyle = pal.lower; ctx.fill('nonzero');
      ctx.strokeStyle = pal.lowerLine; ctx.lineWidth = 1; ctx.stroke();
      if (D.lowerMarks) { marksPath(D.lowerMarks, 0, 0); ctx.setLineDash([4, 3]); ctx.strokeStyle = pal.lowerLine; ctx.stroke(); ctx.setLineDash([]); }
    }
    if (D.upper) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      floorPath(D.upper, D.dx, D.dy);
      ctx.fillStyle = pal.accent; ctx.fill('nonzero');
      ctx.restore();
      floorPath(D.upper, D.dx, D.dy);
      ctx.strokeStyle = pal.accent; ctx.lineWidth = 1; ctx.stroke();
      if (D.upperMarks) { marksPath(D.upperMarks, D.dx, D.dy); ctx.setLineDash([4, 3]); ctx.strokeStyle = pal.accent; ctx.stroke(); ctx.setLineDash([]); }
    }
    // picked points (Match two points): upper picks in the accent, lower picks dark
    for (const p of D.picks || []) {
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 5, 0, Math.PI * 2);
      ctx.fillStyle = p.which === 'upper' ? pal.accent : pal.ink; ctx.fill();
      ctx.strokeStyle = pal.paper; ctx.lineWidth = 1.5; ctx.stroke();
      if (p.label) { ctx.font = '600 11px system-ui, sans-serif'; ctx.fillStyle = p.which === 'upper' ? pal.accent : pal.ink; ctx.fillText(p.label, X(p.x) + 7, Y(p.y) - 7); }
    }
    if (hover && (mode === 'pick-upper' || mode === 'pick-lower')) {
      ctx.strokeStyle = mode === 'pick-upper' ? pal.accent : pal.ink; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(hover[0]) - 9, Y(hover[1])); ctx.lineTo(X(hover[0]) + 9, Y(hover[1])); ctx.moveTo(X(hover[0]), Y(hover[1]) - 9); ctx.lineTo(X(hover[0]), Y(hover[1]) + 9); ctx.stroke();
      ctx.beginPath(); ctx.arc(X(hover[0]), Y(hover[1]), 5, 0, Math.PI * 2); ctx.stroke();
    }
  }

  /** Nearest wall corner (plan cm, as drawn now) of the floor being picked, within CORNER_PX. */
  function cornerNear(sx, sy) {
    const f = mode === 'pick-upper' ? D.upper : D.lower, dx = mode === 'pick-upper' ? D.dx : 0, dy = mode === 'pick-upper' ? D.dy : 0;
    let best = null, bd = CORNER_PX * CORNER_PX;
    for (const w of (f && f.walls) || []) for (const [x, y] of [[w.x, w.y], [w.x + w.w, w.y], [w.x, w.y + w.h], [w.x + w.w, w.y + w.h]]) {
      const d = (X(x + dx) - sx) ** 2 + (Y(y + dy) - sy) ** 2;
      if (d < bd) { bd = d; best = [x + dx, y + dy]; }
    }
    return best || toCm(sx, sy);
  }
  const insideUpper = (sx, sy) => {
    const [x, y] = toCm(sx, sy), b = boxOf(D.upper, D.dx, D.dy);
    return !!b && x >= b.x0 - 20 && x <= b.x1 + 20 && y >= b.y0 - 20 && y <= b.y1 + 20;
  };

  // ── pointers ──
  const pointers = new Map();
  let drag = null, pinch = null, hover = null;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvas.setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      if (drag && drag.moving) o.onMove && o.onMove(drag.dx0, drag.dy0, { final: true });
      drag = null; return;
    }
    const moving = mode === 'drag' && insideUpper(p.x, p.y);
    drag = { x0: p.x, y0: p.y, tx, ty, dx0: D.dx, dy0: D.dy, moved: false, moving };
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      tx += cx - pinch.cx; ty += cy - pinch.cy; pinch.cx = cx; pinch.cy = cy;
      if (pinch.d > 0) zoomAt(cx, cy, (pinch.zoom * d / pinch.d) / zoom); else redraw();
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) > 3) drag.moved = true;
      if (drag.moved) {
        if (drag.moving) { D.dx = drag.dx0 + (p.x - drag.x0) / zoom; D.dy = drag.dy0 + (p.y - drag.y0) / zoom; o.onMove && o.onMove(D.dx, D.dy, { final: false }); }
        else { tx = drag.tx + p.x - drag.x0; ty = drag.ty + p.y - drag.y0; }
        canvas.style.cursor = 'grabbing';
      }
    }
    if (e.pointerType === 'mouse' && (mode === 'pick-upper' || mode === 'pick-lower')) hover = cornerNear(p.x, p.y);
    redraw();
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
    if (!drag) return;
    const d = drag; drag = null;
    canvas.style.cursor = '';
    if (e.type === 'pointercancel') return;
    if (d.moving && d.moved) {
      // land: wall faces snap onto the floor below, else the 5 cm grid (relative to where the drag started)
      let nx = D.dx, ny = D.dy;
      const s = o.snap ? o.snap(nx, ny, CORNER_PX / zoom) : null;
      if (s && s.x) nx += s.dx; else nx = d.dx0 + Math.round((nx - d.dx0) / 5) * 5;
      if (s && s.y) ny += s.dy; else ny = d.dy0 + Math.round((ny - d.dy0) / 5) * 5;
      D.dx = Math.round(nx * 100) / 100; D.dy = Math.round(ny * 100) / 100;
      o.onMove && o.onMove(D.dx, D.dy, { final: true });
    } else if (!d.moved && (mode === 'pick-upper' || mode === 'pick-lower')) {
      const p = local(e), pt = cornerNear(p.x, p.y);
      o.onPick && o.onPick(pt, mode === 'pick-upper' ? 'upper' : 'lower');
    }
    redraw();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { hover = null; redraw(); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoomAt(p.x, p.y, Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004)); }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!k) return;
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    D.dx = Math.round((D.dx + k[0] * step) * 100) / 100; D.dy = Math.round((D.dy + k[1] * step) * 100) / 100;
    o.onMove && o.onMove(D.dx, D.dy, { final: true, key: true });
    redraw();
  });

  return {
    el, canvas,
    set(next) { D = { ...D, ...next }; redraw(); },
    get state() { return { dx: D.dx, dy: D.dy, zoom, mode }; },
    setMode(m) { mode = m; hover = null; canvas.classList.toggle('is-pick', m !== 'drag'); redraw(); },
    setHint(text) { hint.textContent = text || ''; hint.hidden = !text; },
    fit, redraw, resize,
    /** Screen (CSS px relative to the canvas) of a plan point of the lower floor's frame — for tests. */
    toScreen: (x, y) => [X(x), Y(y)],
    destroy() { ro?.disconnect(); if (raf) cancelAnimationFrame(raf); },
  };
}

function palette() {
  const get = (name, fallback) => { try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; } catch (e) { return fallback; } };
  return { paper: get('--raised', '#ffffff'), lower: 'rgba(110, 118, 124, 0.55)', lowerLine: get('--ink-3', '#6b7478'), accent: get('--accent', '#1d4e89'), ink: get('--ink', '#172026') };
}
