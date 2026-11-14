/**
 * Structure guide card for the tracing underlay (store.underlay): show / hide, strength, "Re-align…" (scale from a
 * known length, move by matching a point, nudge) and "Remove sketch". Hidden when the project has no underlay.
 * A project imported with several floors (stage F8) has one underlay per floor: the card controls the floor shown.
 */
import { h, setKids } from '../dom.js';
import { icon } from '../icons.js';
import { btn, toggle } from '../components.js';
import { openDialog, confirmDialog, toast } from '../dialogs.js';
import { field, numInput, readNum } from '../projects.js';
import { createSheet } from './sheet.js';
import { affThen, affInv, affApply } from './affine.js';
import { levelPlan } from '../../core/plan-edit.js';

/** The floor shown in the plan ('L0' = ground) — a project imported with several floors has one underlay per floor. */
const shownLevel = (store) => (store.ui && store.ui.level && store.ui.level !== 'L0' ? store.ui.level : 'L0');
const underlayOn = (store, lv) => (store.underlayOf ? store.underlayOf(lv) : lv === 'L0' ? store.underlay : null);
/** setUnderlay for floor `lv` (the ground floor's call is exactly today's). */
const setOn = (store, lv, patch, opts = {}) => store.setUnderlay(patch, lv === 'L0' ? opts : { ...opts, level: lv });

export function underlayCard(app) {
  const { store } = app;
  const el = h('div', { class: 'iunder', hidden: true });
  let slider = null, vis = null;
  const render = () => {
    const lv = shownLevel(store), u = underlayOn(store, lv);
    if (!u) { el.hidden = true; setKids(el); return; }
    const floorName = store.underlays ? ` — ${(app.levels && app.levels.name && app.levels.name(lv)) || (lv === 'L0' ? 'Ground floor' : lv)}` : '';
    el.hidden = false;
    const pct = Math.round((u.opacity == null ? 0.5 : u.opacity) * 100);
    slider = h('input', { type: 'range', class: 'range', min: '10', max: '100', step: '5', value: String(pct), 'aria-label': 'Strength of the sketch under the plan', style: `--fill:${(pct - 10) / 0.9}%`,
      onInput: () => { const v = Number(slider.value); slider.style.setProperty('--fill', `${(v - 10) / 0.9}%`); setOn(store, lv, { opacity: v / 100 }, { transient: true }); },
      onChange: () => setOn(store, lv, { opacity: Number(slider.value) / 100 }) });
    vis = toggle({ label: 'Show the sketch', checked: u.visible !== false, onChange: (v) => setOn(store, lv, { visible: v }) });
    const src = u.source || {};
    setKids(el,
      h('p', { class: 'phase__title' }, icon('image', { size: 16 }), `Sketch underlay${floorName}`),
      h('p', { class: 'phase__text' }, `${src.name ? `“${src.name}”${src.page ? `, page ${src.page}` : ''}` : 'Your drawing'} lies under the plan to trace over. It is not printed, exported or shown in 3D.`),
      vis,
      h('label', { class: 'iunder__row' }, h('span', { class: 'iunder__label' }, 'Strength'), slider),
      h('div', { class: 'iunder__btns' },
        btn('Re-align…', { small: true, icon: 'target', onClick: () => openRealign(app) }),
        btn('Remove sketch', { small: true, variant: 'quiet', icon: 'trash', onClick: () => remove(app) })));
  };
  store.on('underlay', (e) => { if (e && e.transient) return; render(); });
  store.on('base', render);
  store.on('ui', (e) => { if (store.underlays && e && e.keys && e.keys.includes('level')) render(); });
  render();
  return el;
}

async function remove(app) {
  const ok = await confirmDialog({ title: 'Remove the sketch?', confirmLabel: 'Remove sketch', danger: true,
    message: 'The drawing under the plan is removed from this project. The walls, doors and windows stay. To get the drawing back you would have to import it again.' });
  if (!ok) return;
  setOn(app.store, shownLevel(app.store), null);
  toast('Sketch removed');
}

/**
 * Re-align the underlay: (1) scale — click two points on the drawing and type their real distance (the first point
 * stays put); (2) move — click a point on the drawing, then the wall corner where it belongs; (3) nudge east / south.
 */
export function openRealign(app) {
  const { store } = app;
  const lv = shownLevel(store);
  const u0 = underlayOn(store, lv);
  if (!u0) return null;
  const plan = lv === 'L0' ? app.plan : (levelPlan(app.plan, lv) || app.plan);   // the walls of the floor this sketch belongs to
  let T = u0.transform.slice();             // image px → plan cm (working copy)
  let mode = null, pts = [];
  const img = new Image();
  const status = h('p', { class: 'iside__text', 'aria-live': 'polite' });
  const sheet = createSheet({ label: 'The sketch and the walls', onPick: (p) => pick(p), snap: (p, r) => snap(p, r) });
  const cmInput = numInput('', { 'aria-label': 'Real distance in centimetres', placeholder: 'e.g. 500' });
  const east = numInput(0, { 'aria-label': 'Move east by (cm)' }), south = numInput(0, { 'aria-label': 'Move south by (cm)' });
  const modeBox = h('div', { class: 'iopts' });

  function corners() {
    // wall rectangle corners in image px, for snapping the "where it belongs" point
    const inv = affInv(T), out = [];
    for (const w of plan.walls) for (const [x, y] of [[w.x, w.y], [w.x + w.w, w.y], [w.x, w.y + w.h], [w.x + w.w, w.y + w.h]]) out.push(affApply(inv, x, y));
    return out;
  }
  function snap(p, r) {
    if (mode !== 'move' || pts.length !== 1) return null;
    let best = null, bd = r * r;
    for (const c of corners()) { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2; if (d < bd) { bd = d; best = c; } }
    return best;
  }
  function pick(p) {
    if (!mode) return;
    pts.push(p);
    if (mode === 'move' && pts.length === 2) {
      // the drawing point pts[0] goes where the plan point pts[1] is now
      const a = affApply(T, pts[0][0], pts[0][1]), b = affApply(T, pts[1][0], pts[1][1]);
      T = affThen(T, [1, 0, 0, 1, b[0] - a[0], b[1] - a[1]]);
      mode = null; pts = [];
      status.textContent = 'Moved. Check the walls against the drawing, then apply.';
    }
    sync();
  }
  function applyScale() {
    const cm = readNum(cmInput);
    if (!(cm > 0) || pts.length < 2) { status.textContent = 'Click two points, then type their real distance.'; return; }
    const a = affApply(T, pts[0][0], pts[0][1]), b = affApply(T, pts[1][0], pts[1][1]);
    const now = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(now > 0)) return;
    const f = cm / now;
    // scale about the first point (it stays where it is on the plan)
    T = affThen(T, [f, 0, 0, f, a[0] * (1 - f), a[1] * (1 - f)]);
    mode = null; pts = []; cmInput.value = '';
    status.textContent = `Scaled by ${f.toFixed(4)}. Check the walls against the drawing, then apply.`;
    sync();
  }
  function nudge() {
    const dx = readNum(east) || 0, dy = readNum(south) || 0;
    if (!dx && !dy) return;
    T = affThen(T, [1, 0, 0, 1, dx, dy]);
    east.value = '0'; south.value = '0';
    status.textContent = `Moved ${dx} cm east and ${dy} cm south.`;
    sync();
  }
  function sync() {
    sheet.setMode(mode && (mode !== 'scale' || pts.length < 2) ? 'pick' : 'view');
    sheet.setHint(mode === 'scale' ? (pts.length < 2 ? `Point ${pts.length + 1} of 2 on the drawing.` : 'Type the real distance.') : mode === 'move' ? (pts.length ? 'Now click the wall corner where that point belongs (corners snap).' : 'Click a recognisable point on the drawing (a corner of the house).') : '');
    setKids(modeBox,
      h('div', { class: `iopt${mode === 'scale' ? ' is-on' : ''}` },
        h('p', { class: 'iopt__title' }, 'Scale from a known length'),
        h('p', { class: 'iopt__text' }, 'Click both ends of a length you know on the drawing and type it. The first point stays where it is.'),
        mode === 'scale' && pts.length === 2 ? h('div', { class: 'iopt__rows' }, field('Distance', cmInput, 'cm'), btn('Scale the sketch', { small: true, variant: 'primary', onClick: applyScale }))
          : btn(mode === 'scale' ? 'Pick again' : 'Pick two points', { small: true, onClick: () => { mode = 'scale'; pts = []; sync(); } })),
      h('div', { class: `iopt${mode === 'move' ? ' is-on' : ''}` },
        h('p', { class: 'iopt__title' }, 'Move by matching a point'),
        h('p', { class: 'iopt__text' }, 'Click a point on the drawing, then the wall corner of the plan where it belongs.'),
        btn(mode === 'move' ? 'Pick again' : 'Pick the points', { small: true, onClick: () => { mode = 'move'; pts = []; sync(); } })),
      h('div', { class: 'iopt' },
        h('p', { class: 'iopt__title' }, 'Nudge'),
        h('div', { class: 'iopt__rows' }, field('East', east, 'cm'), field('South', south, 'cm'), btn('Move', { small: true, onClick: nudge }))));
    sheet.redraw();
  }
  sheet.setOverlay((ctx, V) => {
    const inv = affInv(T);
    ctx.fillStyle = 'rgba(29, 78, 137, 0.45)'; ctx.strokeStyle = '#1d4e89'; ctx.lineWidth = 1;
    for (const w of plan.walls) {
      const q = [[w.x, w.y], [w.x + w.w, w.y], [w.x + w.w, w.y + w.h], [w.x, w.y + w.h]].map(([x, y]) => affApply(inv, x, y));
      ctx.beginPath(); q.forEach(([a, b], i) => (i ? ctx.lineTo(V.X(a), V.Y(b)) : ctx.moveTo(V.X(a), V.Y(b)))); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#6a3d9a';
    for (const p of pts) { ctx.beginPath(); ctx.arc(V.X(p[0]), V.Y(p[1]), V.loupe ? 6 : 4, 0, Math.PI * 2); ctx.fill(); }
  });
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    sheet.setImage(c, (u0.width ? c.width / u0.width : 1));
  };
  img.src = u0.image;
  const dlg = openDialog({ title: 'Re-align the sketch', size: 'xl', cls: 'importdlg importdlg--realign',
    body: h('div', { class: 'iwiz' }, h('div', { class: 'iwiz__content' }, h('div', { class: 'isplit' },
      h('div', { class: 'isplit__main' }, sheet.el),
      h('div', { class: 'isplit__side' }, h('p', { class: 'iside__title' }, 'Line the drawing up with the walls'), status, modeBox)))),
    actions: [btn('Cancel', { variant: 'quiet', onClick: () => dlg.close() }),
      btn('Reset', { variant: 'quiet', onClick: () => { T = u0.transform.slice(); mode = null; pts = []; status.textContent = ''; sync(); } }),
      btn('Apply', { variant: 'primary', onClick: () => {
        const cur = underlayOn(store, lv), before = cur && cur.transform;
        setOn(store, lv, { transform: T.map((v) => +v.toFixed(6)) }); dlg.close();
        // the underlay is outside the undo history (CONTRACT § 12): offer the way back here
        toast('Sketch re-aligned', { kind: 'success', action: before && { label: 'Undo', fn: () => { if (underlayOn(store, lv)) setOn(store, lv, { transform: before }); } } });
      } })],
    onClose: () => sheet.destroy() });
  dlg.el._realign = { sheet, get transform() { return T.slice(); }, get mode() { return mode; }, get points() { return pts.length; } };   // for tests
  sync();
  requestAnimationFrame(() => sheet.resize());
  return dlg;
}
