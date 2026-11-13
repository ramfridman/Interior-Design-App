/**
 * The stage: shows / hides the 2D and 3D panes for the current view mode, the split divider, drag-and-drop from the
 * catalogue, and the quiet controls that float over each view (zoom, compass, scale bar, camera, sun, walk HUD).
 * The sun control itself lives in sun.js.
 */
import { spaceAt } from '../core/geometry.js';
import { h, append, call, listen, clamp, rafThrottle } from './dom.js';
import { icon } from './icons.js';
import { btn, iconBtn, kbd } from './components.js';
import { openMenu, toast } from './dialogs.js';
import { getPref, setPref } from './prefs.js';
import { createSunControl } from './sun.js';

export const DND_TYPE = 'application/x-e7-product';

/** "Nice" scale-bar lengths in cm. */
const SCALE_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

/** @param {object} app  UI context */
export function initViewport(app) {
  const { store, plan, view2d, view3d, actions } = app;
  const stage = document.getElementById('stage');
  const viewport = document.getElementById('viewport');
  const pane2d = document.getElementById('pane2d');
  const pane3d = document.getElementById('pane3d');
  const handle = document.getElementById('split-handle');
  const ov2d = document.getElementById('ov2d');
  const ov3d = document.getElementById('ov3d');

  /* ───────── Mode switching ───────── */
  const resizeViews = rafThrottle(() => {
    if (!pane2d.hidden) call(view2d, 'resize');
    if (!pane3d.hidden) call(view3d, 'resize');
    syncScale();
  });

  function applyMode() {
    const mode = store.ui.mode;
    const show2d = mode === '2d' || mode === 'split';
    const show3d = mode !== '2d';
    pane2d.hidden = !show2d;
    pane3d.hidden = !show3d;
    handle.hidden = mode !== 'split';
    viewport.dataset.mode = mode;
    document.getElementById('app').dataset.mode = mode;
    viewport.style.setProperty('--split', String(getPref('split')));
    call(view2d, 'setActive', show2d);
    call(view3d, 'setActive', show3d);
    const current = call(view3d, 'getMode');
    if (mode === 'walk') {
      if (current !== 'walk' || app.pendingWalk) {
        if (view3d && typeof view3d.enterWalk === 'function') call(view3d, 'enterWalk', app.pendingWalk || undefined);
        else call(view3d, 'setMode', 'walk');
      }
      app.pendingWalk = null;
    } else if (show3d && current === 'walk') {
      if (view3d && typeof view3d.exitWalk === 'function') call(view3d, 'exitWalk');
      call(view3d, 'setMode', 'orbit');
    }
    walkHud.hidden = mode !== 'walk';
    orbitHud.hidden = mode === 'walk';
    resizeViews();
  }

  // The 3D view may leave / enter walk mode on its own (Esc while the pointer is locked, a double-click…).
  listen(view3d, 'mode', (payload) => {
    const m = typeof payload === 'string' ? payload : payload && payload.mode;
    if (m === 'orbit' && store.ui.mode === 'walk') store.setUI({ mode: '3d' });
    else if (m === 'walk' && store.ui.mode !== 'walk') store.setUI({ mode: 'walk' });
  });

  if (typeof ResizeObserver === 'function') new ResizeObserver(resizeViews).observe(viewport);
  else window.addEventListener('resize', resizeViews);

  /* ───────── Split divider ───────── */
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', 'Resize plan and 3D views');
  handle.tabIndex = 0;
  const setSplit = (ratio) => {
    const r = clamp(ratio, 0.2, 0.8);
    setPref('split', r);
    viewport.style.setProperty('--split', String(r));
    handle.setAttribute('aria-valuenow', String(Math.round(r * 100)));
    resizeViews();
  };
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    viewport.classList.add('is-splitting');
    const rect = viewport.getBoundingClientRect();
    const stacked = getComputedStyle(viewport).flexDirection === 'column';
    const move = (ev) => setSplit(stacked ? (ev.clientY - rect.top) / rect.height : (ev.clientX - rect.left) / rect.width);
    const up = () => { viewport.classList.remove('is-splitting'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setSplit(getPref('split') - 0.03); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setSplit(getPref('split') + 0.03); }
  });

  /* ───────── Drag-and-drop from the catalogue ───────── */
  for (const [pane, getView, is2d] of [[pane2d, () => view2d, true], [pane3d, () => view3d, false]]) {
    const accepts = (e) => e.dataTransfer && [...e.dataTransfer.types].includes(DND_TYPE);
    pane.addEventListener('dragenter', (e) => { if (accepts(e)) { e.preventDefault(); pane.classList.add('is-droptarget'); } });
    pane.addEventListener('dragover', (e) => { if (accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    pane.addEventListener('dragleave', (e) => { if (!pane.contains(e.relatedTarget)) pane.classList.remove('is-droptarget'); });
    pane.addEventListener('drop', (e) => {
      pane.classList.remove('is-droptarget');
      if (!accepts(e)) return;
      e.preventDefault();
      const product = app.catalog.getProduct(e.dataTransfer.getData(DND_TYPE));
      if (!product) return;
      const view = getView();
      if (/-finish$/.test(product.type)) {
        const pt = is2d ? call(view, 'screenToPlan', e.clientX, e.clientY) : null;
        const space = pt ? spaceAt(pt.x, pt.y, plan) : null;
        if (space && (space.kind === 'room' || space.kind === 'outdoor-area')) actions.applyFinish(product, space.id);
        else toast('Drop a finish on a room in the plan, or pick the room in the Rooms tab');
        return;
      }
      if (store.ui.mode === 'walk') { toast('Leave the walk-through to place items'); return; }
      const partial = app.catalog.itemFromProduct(product, {}, store.project.ceilingHeight);
      const placed = call(view, 'dropAt', e.clientX, e.clientY, partial);
      if (!placed && !(view && typeof view.dropAt === 'function')) actions.place(product);
    });
  }

  /* ───────── 2D overlay: zoom, compass, scale bar ───────── */
  const scaleBar = h('div', { class: 'scalebar' });
  const scaleText = h('span', { class: 'scalebar__text num' });
  const scaleRatio = h('span', { class: 'scalebar__ratio num' });
  const scale = h('div', { class: 'ovl scale', 'aria-hidden': 'true' }, scaleBar, h('div', { class: 'scale__labels' }, scaleText, scaleRatio));
  function syncScale() {
    const pxPerCm = call(view2d, 'getScale');
    if (!(pxPerCm > 0)) { scale.hidden = true; return; }
    scale.hidden = false;
    const cm = SCALE_STEPS.find((s) => s * pxPerCm >= 56) || SCALE_STEPS[SCALE_STEPS.length - 1];
    scaleBar.style.width = `${Math.round(cm * pxPerCm)}px`;
    scaleText.textContent = cm >= 100 ? `${cm / 100} m` : `${cm} cm`;
    // Drawing scale on a 96 dpi screen: 1 CSS px is 2.54/96 cm of glass and shows 1/pxPerCm cm of house.
    const ratio = (96 / 2.54) / pxPerCm;
    scaleRatio.textContent = `1:${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}`;
    app.onZoom && app.onZoom(pxPerCm, scaleRatio.textContent);
  }
  listen(view2d, 'zoom', syncScale);

  const north = plan.meta && typeof plan.meta.northAngle === 'number' ? plan.meta.northAngle : 0;
  const compass = h('div', { class: 'ovl compass', role: 'img', 'aria-label': `North is ${Math.abs(north)}° ${north < 0 ? 'left' : 'right'} of up on the plan`, 'data-tip': 'North', 'data-tip-side': 'left' });
  compass.append(compassSvg(north));

  const zoom = h('div', { class: 'ovl ovl--stack', role: 'group', 'aria-label': 'Zoom' },
    iconBtn('plus', 'Zoom in', { kbd: '+', onClick: () => call(view2d, 'zoomBy', 1.25) }),
    iconBtn('minus', 'Zoom out', { kbd: '−', onClick: () => call(view2d, 'zoomBy', 0.8) }),
    iconBtn('fit', 'Fit the house', { kbd: 'F', onClick: () => call(view2d, 'fit', 'house', { animate: true }) }),
    iconBtn('site', 'Fit the whole lot', { onClick: () => call(view2d, 'fit', 'lot', { animate: true }) }));
  // The real plan view draws its own scale bar and north arrow on the canvas; ours appear only for views that ask
  // for them (view2d.needsHud === true, e.g. the dev stub), so the two never show twice.
  const ownHud = !view2d || view2d.needsHud === true;
  append(ov2d, [ownHud && h('div', { class: 'ov__tr' }, compass), h('div', { class: 'ov__br' }, zoom), ownHud && h('div', { class: 'ov__bl' }, scale)]);

  /* ───────── 3D overlay: camera, roof, cutaway, sun, walk ───────── */
  const cameraBtn = btn('Views', { icon: 'camera', iconRight: 'chevron-down', small: true, attrs: { 'aria-haspopup': 'menu' }, onClick: () => openMenu(cameraBtn, [
    { heading: 'Outside' },
    { label: 'Aerial', icon: 'home', onSelect: () => call(view3d, 'setCameraPreset', 'aerial', { animate: true }) },
    { label: 'Top', icon: 'plan', onSelect: () => call(view3d, 'setCameraPreset', 'top', { animate: true }) },
    { label: 'Front', icon: 'roof', onSelect: () => call(view3d, 'setCameraPreset', 'front', { animate: true }) },
    { label: 'Garden', icon: 'tree', onSelect: () => call(view3d, 'setCameraPreset', 'garden', { animate: true }) },
    { heading: 'Rooms' },
    ...plan.rooms.map((r) => ({ label: r.name, onSelect: () => { store.setUI({ activeSpace: r.id }); call(view3d, 'setCameraPreset', r.id, { animate: true }); } })),
  ]) });
  const roofBtn = iconBtn('roof', 'Show roof', { pressed: !!store.ui.showRoof, onClick: () => store.setUI({ showRoof: !store.ui.showRoof }) });
  const cutBtn = iconBtn('cutaway', 'Cut walls low (dollhouse view)', { pressed: !!store.ui.wallsCutaway, onClick: () => store.setUI({ wallsCutaway: !store.ui.wallsCutaway }) });

  const sun = createSunControl(app);

  const walkBtn = btn('Walk through', { icon: 'walk', variant: 'primary', kbd: '3', onClick: () => actions.setMode('walk') });
  const orbitHud = h('div', { class: 'ov__layer' },
    h('div', { class: 'ov__tl' }, h('div', { class: 'ovl ovl--row' }, cameraBtn)),
    h('div', { class: 'ov__tr' }, h('div', { class: 'ovl ovl--row', role: 'group', 'aria-label': '3D display' }, roofBtn, cutBtn)),
    h('div', { class: 'ov__br' }, walkBtn));

  /* ───────── Walk HUD ───────── */
  const walkRoom = h('span', { class: 'walk__room display' }, '');
  const mini = h('canvas', { class: 'minimap__canvas', width: 320, height: 320, role: 'img', 'aria-label': 'Mini-map of the house showing where you are' });
  const hint = h('div', { class: 'ovl walk__hint' },
    h('span', null, kbd('W', 'A', 'S', 'D'), ' move'), h('span', null, kbd('Mouse'), ' look'), h('span', null, kbd('Shift'), ' run'), h('span', null, kbd('Esc'), ' exit'));
  const walkHud = h('div', { class: 'ov__layer', hidden: true },
    h('div', { class: 'walk__top' },
      h('div', { class: 'ovl walk__where' }, icon('pin', { size: 16 }), walkRoom),
      hint,
      btn('Exit walk', { icon: 'close', small: true, onClick: () => actions.setMode('3d') })),
    h('div', { class: 'ov__br' }, h('div', { class: 'ovl minimap' }, mini)));
  // The sun control stays available on foot: it sits clear of the mini-map (see .sunhost in panels.css).
  ov3d.append(orbitHud, walkHud, h('div', { class: 'ov__bc sunhost' }, sun.el));

  let lastPos = null;
  const drawMini = rafThrottle(() => drawMinimap(mini, plan, lastPos));
  listen(view3d, 'walk-position', (pos) => {
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
    lastPos = pos;
    const space = spaceAt(pos.x, pos.y, plan);
    const label = space ? space.name : 'Outside the lot';
    if (walkRoom.textContent !== label) walkRoom.textContent = label;
    drawMini();
  });

  /* ───────── Store wiring ───────── */
  store.on('ui', (e) => {
    if (e.keys.includes('mode')) applyMode();
    if (e.keys.includes('showRoof')) roofBtn.setPressed(store.ui.showRoof);
    if (e.keys.includes('wallsCutaway')) cutBtn.setPressed(store.ui.wallsCutaway);
  });
  if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', drawMini);

  // Walls can change (Structure mode, undo, opening a design): the mini-map is drawn from PLAN.walls.
  store.on('plan', drawMini);

  applyMode();
  drawMini();
  return { resize: resizeViews, redrawMinimap: drawMini, stage };
}

/** Compass rose: a needle rotated to true north. */
function compassSvg(northDeg) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 44 44');
  svg.setAttribute('width', '44');
  svg.setAttribute('height', '44');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<circle cx="22" cy="22" r="17.5" fill="none" stroke="currentColor" stroke-opacity=".28"/>
    <g transform="rotate(${Number(northDeg) || 0} 22 22)">
      <path d="M22 7.500 26.200 22H17.800z" fill="currentColor"/>
      <path d="M22 36.500 26.200 22H17.800z" fill="none" stroke="currentColor" stroke-width="1.200" stroke-linejoin="round"/>
      <text x="22" y="5.200" text-anchor="middle" font-size="7.500" font-weight="600" fill="currentColor" font-family="inherit">N</text>
    </g>`;
  return svg;
}

/** Draw the plan outline and the walker's position / heading. */
function drawMinimap(canvas, plan, pos) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const css = getComputedStyle(canvas);
  const ink = css.getPropertyValue('--ink').trim() || '#172026';
  const accent = css.getPropertyValue('--accent').trim() || '#1d4e89';
  const soft = css.getPropertyValue('--line-strong').trim() || 'rgba(0,0,0,.2)';
  const size = canvas.width, pad = 22;
  const b = plan.bounds;
  const s = (size - pad * 2) / Math.max(b.w, b.h);
  const ox = (size - b.w * s) / 2 - b.x * s, oy = (size - b.h * s) / 2 - b.y * s;
  g.clearRect(0, 0, size, size);
  g.fillStyle = soft;
  for (const o of plan.outdoorAreas || []) {
    g.beginPath();
    o.polygon.forEach(([x, y], i) => (i ? g.lineTo(ox + x * s, oy + y * s) : g.moveTo(ox + x * s, oy + y * s)));
    g.closePath();
    g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1;
  }
  g.fillStyle = ink;
  for (const w of plan.walls) g.fillRect(ox + w.x * s, oy + w.y * s, Math.max(1.5, w.w * s), Math.max(1.5, w.h * s));
  if (!pos) return;
  const px = clamp(ox + pos.x * s, 8, size - 8), py = clamp(oy + pos.y * s, 8, size - 8);
  // Heading: degrees clockwise from plan north (up). A unit vector { dx, dy } wins when the view provides one.
  let ang = ((Number(pos.heading) || 0) - 90) * Math.PI / 180;
  if (typeof pos.dx === 'number' && typeof pos.dy === 'number' && (pos.dx || pos.dy)) ang = Math.atan2(pos.dy, pos.dx);
  g.save();
  g.translate(px, py);
  g.rotate(ang);
  g.fillStyle = accent;
  g.globalAlpha = 0.22;
  g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 46, -0.5, 0.5); g.closePath(); g.fill();
  g.globalAlpha = 1;
  g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.stroke();
  g.restore();
}
