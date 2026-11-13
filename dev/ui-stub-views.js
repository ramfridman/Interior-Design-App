/**
 * DEV ONLY — minimal stand-ins for the 2D and 3D views so the UI can be developed and screenshotted on its own.
 * They implement the method names of docs/CONTRACT.md § 4 with the simplest behaviour that exercises the UI.
 */
import { spaceAt, itemCorners, pointInPolygon } from '../src/core/geometry.js';

const emitter = () => {
  const map = new Map();
  return {
    on(ev, fn) { if (!map.has(ev)) map.set(ev, new Set()); map.get(ev).add(fn); return () => map.get(ev).delete(fn); },
    emit(ev, payload) { map.get(ev)?.forEach((fn) => fn(payload)); },
  };
};
const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function createStubView2D(container, { store, plan, models }) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
  container.append(canvas);
  const g = canvas.getContext('2d');
  const ev = emitter();
  let scale = 0.3, ox = 0, oy = 0, active = true, placing = null, ghost = null, raf = 0;

  const toScreen = (x, y) => ({ x: x * scale + ox, y: y * scale + oy });
  const toPlan = (cx, cy) => { const r = canvas.getBoundingClientRect(); return { x: (cx - r.left - ox) / scale, y: (cy - r.top - oy) / scale }; };
  const request = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

  function fit(target = 'house') {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    let b = target === 'lot' ? plan.site.bounds : plan.bounds;
    if (target === 'selection') {
      const pts = store.getSelected().flatMap(itemCorners);
      if (pts.length) { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); b = { x: Math.min(...xs) - 150, y: Math.min(...ys) - 150, w: Math.max(...xs) - Math.min(...xs) + 300, h: Math.max(...ys) - Math.min(...ys) + 300 }; }
    } else if (target && typeof target === 'object') b = target;
    const pad = target === 'house' ? 110 : 40;
    scale = Math.min((w - pad) / b.w, (h - pad) / b.h);
    ox = (w - b.w * scale) / 2 - b.x * scale; oy = (h - b.h * scale) / 2 - b.y * scale;
    ev.emit('zoom', scale); request();
  }

  function draw() {
    const dpr = Math.min(2, devicePixelRatio || 1), w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const dark = css('color-scheme', 'light').includes('dark') || document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    const paper = dark ? '#161d24' : '#f7f8f5', ink = dark ? '#e8ebea' : '#172026', soft = dark ? 'rgba(214,228,240,.12)' : 'rgba(23,32,38,.1)';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = paper; g.fillRect(0, 0, w, h);
    if (store.ui.showGrid) {
      g.strokeStyle = soft; g.lineWidth = 0.5; g.beginPath();
      const step = 100 * scale;
      for (let x = ((ox % step) + step) % step; x < w; x += step) { g.moveTo(x, 0); g.lineTo(x, h); }
      for (let y = ((oy % step) + step) % step; y < h; y += step) { g.moveTo(0, y); g.lineTo(w, y); }
      g.stroke();
    }
    g.save(); g.translate(ox, oy); g.scale(scale, scale);
    const poly = (p) => { g.beginPath(); p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
    if (store.ui.showSite) {
      g.strokeStyle = '#3f74b5'; g.lineWidth = 1.5 / scale; g.setLineDash([10 / scale, 6 / scale]); poly(plan.site.boundary); g.stroke(); g.setLineDash([]);
      g.strokeStyle = soft; for (const p of plan.site.parking) g.strokeRect(p.x, p.y, p.w, p.h);
    }
    g.fillStyle = soft; for (const o of plan.outdoorAreas) { poly(o.polygon); g.fill(); }
    if (store.ui.activeSpace) { const s = [...plan.rooms, ...plan.outdoorAreas].find((r) => r.id === store.ui.activeSpace); if (s) { g.fillStyle = dark ? 'rgba(141,187,238,.12)' : 'rgba(29,78,137,.08)'; poly(s.polygon); g.fill(); } }
    for (const it of store.items) {
      if (it.hidden) continue;
      g.save(); g.translate(it.x, it.y); g.rotate((it.rot || 0) * Math.PI / 180);
      try { models.drawSymbol(g, it, 1 / scale); } catch (e) { g.strokeRect(-it.w / 2, -it.d / 2, it.w, it.d); }
      if (store.selection.includes(it.id)) { g.strokeStyle = dark ? '#8dbbee' : '#1d4e89'; g.lineWidth = 2 / scale; g.strokeRect(-it.w / 2 - 3, -it.d / 2 - 3, it.w + 6, it.d + 6); }
      g.restore();
    }
    g.fillStyle = ink; for (const wl of plan.walls) g.fillRect(wl.x, wl.y, wl.w, wl.h);
    if (ghost) { g.globalAlpha = 0.5; g.save(); g.translate(ghost.x, ghost.y); try { models.drawSymbol(g, ghost, 1 / scale); } catch (e) { /* ignore */ } g.restore(); g.globalAlpha = 1; }
    g.restore();
    if (store.ui.showRoomLabels) {
      g.fillStyle = dark ? '#aab5b9' : '#4b5759'; g.font = '500 11px "Hanken Grotesk Variable", system-ui'; g.textAlign = 'center';
      for (const r of [...plan.rooms, ...plan.outdoorAreas]) { const p = toScreen(r.label[0], r.label[1]); g.fillText(r.name, p.x, p.y); }
    }
  }

  const hit = (p) => [...store.items].reverse().find((it) => !it.hidden && pointInPolygon(p.x, p.y, itemCorners(it)));
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    const p = toPlan(e.clientX, e.clientY);
    if (placing) { const item = store.addItem({ ...placing.partial, x: p.x, y: p.y }); placing.onDone && placing.onDone(item); placing = null; ghost = null; ev.emit('placing', false); request(); return; }
    const it = store.ui.tool === 'select' && e.button === 0 ? hit(p) : null;
    canvas.setPointerCapture(e.pointerId);
    if (it) {
      if (e.shiftKey) store.toggleSelect(it.id); else if (!store.selection.includes(it.id)) store.select([it.id]);
      if (!it.locked) { store.begin(); drag = { kind: 'move', start: p, items: store.getSelected().map((s) => ({ id: s.id, x: s.x, y: s.y })) }; }
    } else {
      const s = spaceAt(p.x, p.y, plan);
      if (store.ui.tool === 'select' && e.button === 0) { store.clearSelection(); store.setUI({ activeSpace: s && (s.kind === 'room' || s.kind === 'outdoor-area') ? s.id : null }); }
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox, oy };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toPlan(e.clientX, e.clientY);
    ev.emit('cursor', { x: p.x, y: p.y, space: spaceAt(p.x, p.y, plan) });
    if (placing) { ghost = { ...placing.partial, x: p.x, y: p.y }; request(); }
    if (!drag) return;
    if (drag.kind === 'pan') { ox = drag.ox + e.clientX - drag.sx; oy = drag.oy + e.clientY - drag.sy; request(); }
    else for (const s of drag.items) store.updateItem(s.id, { x: Math.round(s.x + p.x - drag.start.x), y: Math.round(s.y + p.y - drag.start.y) }, { transient: true });
  });
  canvas.addEventListener('pointerup', () => { if (drag && drag.kind === 'move') store.commit(); drag = null; });
  canvas.addEventListener('pointerleave', () => ev.emit('cursor', null));
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); const it = hit(toPlan(e.clientX, e.clientY)); ev.emit('contextmenu', { clientX: e.clientX, clientY: e.clientY, itemId: it ? it.id : null }); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && placing) { placing = null; ghost = null; request(); } });
  function zoomAt(f, cx, cy) {
    const r = canvas.getBoundingClientRect(), px = cx - r.left, py = cy - r.top;
    const ns = Math.max(0.05, Math.min(4, scale * f));
    ox = px - (px - ox) * (ns / scale); oy = py - (py - oy) * (ns / scale); scale = ns;
    ev.emit('zoom', scale); request();
  }
  store.on('*', request);
  setTimeout(() => fit('house'), 0);

  return {
    resize() { if (active) { if (!canvas.width) fit('house'); request(); } },
    setActive(b) { active = b; if (b) request(); },
    fit, zoomBy(f) { const r = canvas.getBoundingClientRect(); zoomAt(f, r.left + r.width / 2, r.top + r.height / 2); },
    getScale: () => scale,
    screenToPlan: toPlan,
    planToScreen: (x, y) => { const r = canvas.getBoundingClientRect(), p = toScreen(x, y); return { x: p.x + r.left, y: p.y + r.top }; },
    startPlacing(partial, opts = {}) { placing = { partial, onDone: opts.onDone }; ev.emit('placing', true); },
    dropAt(cx, cy, partial) { const p = toPlan(cx, cy); return store.addItem({ ...partial, x: Math.round(p.x), y: Math.round(p.y) }); },
    exportPNG() { return new Promise((res) => canvas.toBlob(res, 'image/png')); },
    on: ev.on,
    destroy() { canvas.remove(); },
  };
}

export function createStubView3D(container, { store, plan }) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  container.append(canvas);
  const g = canvas.getContext('2d');
  const ev = emitter();
  let mode = 'orbit', active = false, timer = 0, t = 0, preset = 'aerial';

  function draw() {
    const dpr = Math.min(2, devicePixelRatio || 1), w = container.clientWidth, h = container.clientHeight;
    if (!w || !h || !active) return;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const day = Math.max(0, Math.sin(((store.ui.timeOfDay ?? 12) - 6) / 12 * Math.PI));
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, `hsl(210 ${30 + day * 30}% ${12 + day * 62}%)`); sky.addColorStop(0.62, `hsl(205 ${25 + day * 25}% ${22 + day * 66}%)`);
    sky.addColorStop(0.62, `hsl(95 ${14 + day * 16}% ${16 + day * 42}%)`); sky.addColorStop(1, `hsl(95 ${14 + day * 16}% ${12 + day * 34}%)`);
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    // Simple axonometric of the walls.
    const b = plan.site.bounds, s = Math.min(w / (b.w * 1.25), h / (b.h * 1.1));
    const cx = w / 2, cy = h * 0.56, zh = (store.ui.wallsCutaway ? 120 : 300) * s * 0.55;
    const P = (x, y, z = 0) => [cx + ((x - 767) - (y - 690)) * s * 0.62, cy + ((x - 767) + (y - 690)) * s * 0.34 - z];
    const quad = (pts, fill) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fillStyle = fill; g.fill(); };
    quad(plan.site.boundary.map(([x, y]) => P(x, y)), `hsl(100 ${18 + day * 14}% ${22 + day * 34}%)`);
    quad([[0, 0], [1535, 0], [1535, 1380], [0, 1380]].map(([x, y]) => P(x, y)), `hsl(40 12% ${30 + day * 50}%)`);
    for (const it of store.items) if (!it.hidden) { const c = itemCorners(it); const z = Math.min(it.h, 240) * s * 0.55; quad(c.map(([x, y]) => P(x, y, z)), it.params?.color || '#b9b2a6'); }
    const walls = [...plan.walls].sort((a, c) => (a.x + a.y) - (c.x + c.y));
    for (const wl of walls) {
      const c = [[wl.x, wl.y], [wl.x + wl.w, wl.y], [wl.x + wl.w, wl.y + wl.h], [wl.x, wl.y + wl.h]];
      quad([P(...c[3]), P(...c[2]), P(...c[2], zh), P(...c[3], zh)], `hsl(40 8% ${40 + day * 38}%)`);
      quad([P(...c[1]), P(...c[2]), P(...c[2], zh), P(...c[1], zh)], `hsl(40 8% ${34 + day * 34}%)`);
      quad(c.map((p) => P(...p, zh)), `hsl(40 10% ${50 + day * 42}%)`);
    }
    if (store.ui.showRoof && !store.ui.wallsCutaway) { g.globalAlpha = 0.85; quad([[0, 0], [1535, 0], [1535, 1380], [0, 1380]].map(([x, y]) => P(x, y, zh + 12)), `hsl(40 6% ${56 + day * 36}%)`); g.globalAlpha = 1; }
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '500 11px system-ui'; g.textAlign = 'left';
    g.fillText(`Stub 3D view (${mode}${mode === 'orbit' ? ', ' + preset : ''})`, 14, h - 14);
  }
  function tick() {
    t += 0.03;
    const room = plan.rooms.find((r) => r.type === 'living') || plan.rooms[0];
    ev.emit('walk-position', { x: room.label[0] + Math.cos(t) * 160, y: room.label[1] + Math.sin(t) * 120, heading: ((t * 180 / Math.PI) + 180) % 360 });
  }
  function setMode(m) {
    if (m === mode) return;
    mode = m; clearInterval(timer);
    if (m === 'walk') timer = setInterval(tick, 60);
    ev.emit('mode', m); draw();
  }
  store.on('*', () => requestAnimationFrame(draw));
  return {
    resize: draw, setActive(b) { active = b; draw(); },
    setMode, getMode: () => mode,
    setCameraPreset(p) { preset = p; draw(); },
    enterWalk() { setMode('walk'); }, exitWalk() { setMode('orbit'); },
    focusItem() {}, startPlacing(partial, opts = {}) { const item = store.addItem({ ...partial, x: 780, y: 700 }); opts.onDone && opts.onDone(item); },
    dropAt(cx, cy, partial) { return store.addItem({ ...partial, x: 780, y: 700 }); },
    snapshot() { return Promise.resolve(canvas.toDataURL('image/png')); },
    on: ev.on, destroy() { clearInterval(timer); canvas.remove(); },
  };
}
