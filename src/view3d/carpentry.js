/**
 * Carpentry in the 3D view (docs/CONTRACT.md § 8; driven by the workbench's "3D" tab through view3d.showCarpentry()):
 *
 *  - keeps every carpentry unit's model in sync with its RUN (spec, worktop pieces, corner reservations) and its own
 *    `carp` data: both join the item's rebuild signature (items.setVariant), so a spec change re-renders the run;
 *  - focus on a run: frames it from the front (an island from its working side) and cuts away everything between the
 *    camera and the run with a vertical section plane (the facing wall, furniture in between); shadows and daylight still
 *    see the whole house, picking ignores what is cut away;
 *  - "open fronts" for the focused run (models/carpentry.js item.view.open);
 *  - fit problems: units flagged by checkRun (errors / warnings) are outlined + tinted in the warning colour, with a pin
 *    carrying the same message as the Checks list (click → selects the unit);
 *  - the carpentry selection (store.ui.carpentrySel.unitId) gets the normal selection outline.
 */
import * as THREE from 'three';
import * as Carp from '../carpentry/index.js';
import { LAYER_SELECTED } from './items.js';
import { viewOf, validLevel, itemLevel } from './levels.js';

const cssVar = (name, fallback) => { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch (e) { return fallback; } };

/** Ray (plan cm) from p along unit direction s against axis-aligned rectangles: nearest entry distance ≥ min, or Infinity. */
function rayRects(p, s, rects, min = 1) {
  let best = Infinity;
  for (const r of rects) {
    let t0 = -Infinity, t1 = Infinity;
    for (const [o, d, a, b] of [[p[0], s[0], r.x, r.x + r.w], [p[1], s[1], r.y, r.y + r.h]]) {
      if (Math.abs(d) < 1e-9) { if (o < a || o > b) { t0 = Infinity; break; } continue; }
      const u = (a - o) / d, v = (b - o) / d;
      t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v));
    }
    if (t0 <= t1 && t0 >= min && t0 < best) best = t0;
  }
  return best;
}

/**
 * @param {{ scene, renderer, ctx, items, rig, overlay: HTMLElement, invalidate: () => void, isWalking: () => boolean }} o
 */
export function createCarpentryLayer({ scene, renderer, ctx, items, rig, overlay, invalidate, isWalking }) {
  const { store, plan } = ctx;
  const state = { runId: null, open: false, cut: true, studio: false };
  const plane = new THREE.Plane();
  let planeSet = false, flagged = [], corridor = [];
  const group = new THREE.Group();
  group.name = 'carpentry-checks';
  scene.add(group);
  const pins = document.createElement('div');
  pins.className = 'c3d-pins';
  pins.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  overlay.append(pins);

  // ───────── model variants: run data + open fronts ─────────
  const runKeys = new WeakMap();
  const runKey = (run) => {
    if (!runKeys.has(run)) runKeys.set(run, JSON.stringify([run.spec, run.worktops, run.reserved || null, run.length, run.ends, run.kind]));
    return runKeys.get(run);
  };
  // the sibling units also shape a unit (splashback stops under the wall units, sliding doors span the run's carcasses):
  // their position / size / module joins the key, computed once per resync pass
  let sibs = null;
  const sibKey = (run) => {
    if (!sibs) { sibs = new Map(); queueMicrotask(() => { sibs = null; }); }
    if (!sibs.has(run.id)) sibs.set(run.id, (run.unitIds || []).map((id) => { const u = store.getItem(id); return u && u.carp ? `${u.carp.module},${u.carp.at},${u.carp.width},${u.carp.level || ''},${u.carp.elev ?? ''},${u.hidden ? 1 : 0}` : ''; }).join(';'));
    return sibs.get(run.id);
  };
  items.setVariant((item) => {
    if (!item.carp) return null;
    const run = store.carpentry && store.carpentry.runs && store.carpentry.runs[item.carp.runId];
    const open = state.open && state.runId === item.carp.runId;
    return { key: `${run ? runKey(run) + '|' + sibKey(run) : ''}|${JSON.stringify(item.carp)}${open ? '|open' : ''}`, view: open ? { open: true } : null };
  });

  // ───────── section cut ─────────
  /** Walls of the level a run stands on (several floors: `run.level`; the plan's own walls on the ground floor). */
  const runWalls = (run) => (run && run.level && plan.levels ? viewOf(plan, validLevel(plan, run.level)).walls : plan.walls) || [];
  /** Camera-side direction (plan, unit) and the cut distance (cm from the anchor line) for a run. */
  function cutFor(got) {
    const run = got.run, a = (run.anchor.dir * Math.PI) / 180, fn = [-Math.sin(a), Math.cos(a)];
    if (run.kind === 'island') return { s: [-fn[0], -fn[1]], D: 45 };
    const dmax = Math.max(30, ...got.units.filter((u) => !u.hidden).map((u) => u.d || 0));
    let tmin = Infinity;
    for (const k of [0.2, 0.5, 0.8]) {
      const [x, y] = Carp.toPlan(run.anchor, run.length * k, dmax + 1);
      tmin = Math.min(tmin, rayRects([x, y], fn, runWalls(run), 25));
    }
    return { s: fn, D: Number.isFinite(tmin) ? Math.max(dmax + 40, dmax + 1 + tmin - 2) : dmax + 220 };
  }
  function applyCut() {
    const got = state.runId && Carp.getRun(state.runId);
    planeSet = false; corridor = [];
    if (got) {
      const { s, D } = cutFor(got), A = got.run.anchor, run = got.run, a = (run.anchor.dir * Math.PI) / 180, along = [Math.cos(a), Math.sin(a)];
      plane.normal.set(-s[0], 0, -s[1]);
      plane.constant = (s[0] * A.x + s[1] * A.y + D) / 100;
      planeSet = true;
      // what stands between the run's fronts and the cut (an island, a table, another run) is hidden too
      const own = new Set(run.unitIds || []), dmin = run.kind === 'island' ? 1 : Math.max(20, ...got.units.filter((u) => !u.hidden).map((u) => u.d || 0)) - 5;
      const lv = plan.levels ? validLevel(plan, run.level) : null;          // several floors: only what stands on the run's level
      for (const it of store.items) {
        if (it.hidden || own.has(it.id) || it.placement === 'wall' || (lv && itemLevel(it, plan, store) !== lv)) continue;
        const dx = it.x - A.x, dy = it.y - A.y, dep = dx * s[0] + dy * s[1], al = dx * along[0] + dy * along[1];
        if (dep > dmin && dep < D && al > -60 && al < run.length + 60) corridor.push(it.id);
      }
    }
    syncClip();
  }
  const clipActive = () => planeSet && state.cut && !isWalking();
  function syncClip() {
    const want = clipActive();
    if (want !== renderer.clippingPlanes.length > 0) renderer.clippingPlanes = want ? [plane] : [];
    items.setViewHidden(want ? corridor : []);
    invalidate();
  }

  // ───────── fit problems ─────────
  function clearChecks() {
    for (const o of [...group.children]) { group.remove(o); o.geometry.dispose(); o.material.dispose(); }
    pins.replaceChildren();
    flagged = [];
  }
  function buildChecks() {
    clearChecks();
    if (!state.runId) return;
    let findings = [];
    try { findings = Carp.checkRun(state.runId) || []; } catch (e) { findings = []; }
    const per = new Map();
    for (const f of findings) {
      if (f.severity === 'info') continue;
      for (const id of f.unitIds || []) {
        const e = per.get(id) || { id, severity: 'warning', texts: [] };
        if (f.severity === 'error') e.severity = 'error';
        const t = (f.text && f.text.en) || f.code;
        if (!e.texts.includes(t)) e.texts.push(t);
        per.set(id, e);
      }
    }
    const warn = cssVar('--warn', '#c98a12'), fail = cssVar('--fail', '#c2412d');
    const mats = { warning: [new THREE.LineBasicMaterial({ color: warn, depthTest: false, transparent: true, opacity: 0.95 }), new THREE.MeshBasicMaterial({ color: warn, transparent: true, opacity: 0.16, depthWrite: false })],
      error: [new THREE.LineBasicMaterial({ color: fail, depthTest: false, transparent: true, opacity: 0.95 }), new THREE.MeshBasicMaterial({ color: fail, transparent: true, opacity: 0.18, depthWrite: false })] };
    for (const e of per.values()) {
      const it = store.getItem(e.id), box = items.boxOf(e.id);
      if (!it || it.hidden || !box || box.isEmpty()) continue;
      const size = box.getSize(new THREE.Vector3()).addScalar(0.03), c = box.getCenter(new THREE.Vector3());
      const geo = new THREE.BoxGeometry(size.x, size.y, size.z), [lm, fm] = mats[e.severity];
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lm), fill = new THREE.Mesh(geo, fm);
      lines.position.copy(c); fill.position.copy(c);
      lines.renderOrder = 10; fill.renderOrder = 9;
      fill.userData.noShadow = true;
      group.add(fill, lines);
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = `c3d-pin c3d-pin--${e.severity}`;
      pin.title = e.texts.join('\n');
      pin.textContent = e.texts[0] + (e.texts.length > 1 ? ` (+${e.texts.length - 1})` : '');
      pin.style.cssText = `position:absolute;left:0;top:0;pointer-events:auto;max-width:190px;transform:translate(-50%,-100%);font:500 11px/1.25 system-ui,sans-serif;color:#fff;background:${e.severity === 'error' ? fail : warn};border:0;border-radius:4px;padding:3px 7px;box-shadow:0 1px 4px rgba(0,0,0,.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer`;
      pin.addEventListener('click', () => { const u = store.getItem(e.id); if (u && u.carp) store.setUI({ carpentrySel: { runId: u.carp.runId, unitId: e.id } }); });
      pins.append(pin);
      flagged.push({ id: e.id, pin, top: new THREE.Vector3(c.x, box.max.y + 0.04, c.z) });
    }
    invalidate();
  }

  // ───────── selection outline for the carpentry selection ─────────
  function syncMarks() {
    const ids = store.selection.slice(), cs = store.ui.tool === 'carpentry' && store.ui.carpentrySel;
    if (cs && cs.unitId && !ids.includes(cs.unitId)) ids.push(cs.unitId);
    items.setMarked(LAYER_SELECTED, ids);
    invalidate();
  }

  // ───────── framing ─────────
  function frame({ animate = true } = {}) {
    const got = state.runId && Carp.getRun(state.runId);
    if (!got) return false;
    const box = new THREE.Box3();
    for (const u of got.units) { const b = !u.hidden && items.boxOf(u.id); if (b && !b.isEmpty()) box.union(b); }
    if (box.isEmpty()) return false;
    const { s } = cutFor(got);
    rig.frameBox(box, { theta: Math.atan2(s[0], s[1]), phi: THREE.MathUtils.degToRad(74), margin: 1.12, minRadius: 1.6, animate });
    return true;
  }

  // ───────── studio light ─────────
  // Item materials indoors take their INDIRECT light from the daylight probe field (daylight/index.js replaces the
  // hemisphere / ambient / IBL irradiance), so only direct lights can change how they read. While a run is shown with
  // "Studio light" on, the main render gets: two neutral-white shadowless directional lights that follow the camera
  // (key from above-left, fill from the right), the sun eased down (no hot window patches), a fixed exposure and the
  // Khronos PBR Neutral tone mapping (true product colours: whites stay white, no ACES hue shift). Everything is set
  // just before renderer.render() and put back right after it (beginFrame → undo), so the normal sun / daylight look,
  // eye adaptation and exposure are untouched the moment the tab is left or the toggle is off. The two lights are
  // created on first use and then stay in the scene at intensity 0 outside the studio render (a constant light count
  // avoids recompiling every material on each toggle).
  const STUDIO = { key: 2.4, fill: 1.0, sun: 0.35, env: 0.3, exposure: 1.0 };
  let studioLights = null;
  const _cd = new THREE.Vector3(), _cr = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function ensureStudio() {
    if (studioLights) return studioLights;
    const mk = (name) => { const l = new THREE.DirectionalLight(0xffffff, 0); l.name = name; l.castShadow = false; l.userData.noShadow = true; scene.add(l); return l; };
    studioLights = { key: mk('carpentry-studio-key'), fill: mk('carpentry-studio-fill') };
    return studioLights;
  }
  const studioActive = () => !!(state.studio && state.runId && !isWalking());
  /**
   * Called right before the main render. Returns an undo function (call it right after the render), or null when the
   * studio light is not active. `parts` = { env } (may be missing). The solved daylight (lightmaps / probe field, its
   * display gain) is left as it is: it stays the soft room backdrop and the neutral key light dominates the fronts.
   */
  function beginFrame(camera, parts = {}) {
    if (!studioActive() || !camera) return null;
    const L = ensureStudio(), env = parts.env, sun = env && env.sun;
    camera.getWorldDirection(_cd).negate();                        // towards the camera
    _cr.crossVectors(_up, _cd).normalize();                        // camera's right (seen from the run)
    if (!Number.isFinite(_cr.x) || _cr.lengthSq() < 1e-6) _cr.set(1, 0, 0);
    L.key.position.copy(_cd).addScaledVector(_cr, -0.55).addScaledVector(_up, 0.75).normalize();
    L.fill.position.copy(_cd).addScaledVector(_cr, 0.8).addScaledVector(_up, 0.15).normalize();
    L.key.updateMatrixWorld(); L.fill.updateMatrixWorld();
    L.key.intensity = STUDIO.key; L.fill.intensity = STUDIO.fill;
    const saved = { tm: renderer.toneMapping, ex: renderer.toneMappingExposure, envI: scene.environmentIntensity, sun: sun ? sun.intensity : null };
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = STUDIO.exposure;
    scene.environmentIntensity = Math.max(saved.envI ?? 0, STUDIO.env);
    if (sun) sun.intensity = saved.sun * STUDIO.sun;
    return () => {
      L.key.intensity = 0; L.fill.intensity = 0;
      renderer.toneMapping = saved.tm; renderer.toneMappingExposure = saved.ex; scene.environmentIntensity = saved.envI;
      if (sun) sun.intensity = saved.sun;
    };
  }

  const refresh = () => { if (state.runId) { applyCut(); buildChecks(); } };
  const offs = [
    store.on('carpentry', (e) => { items.resync(); if (!e || !e.transient) queueMicrotask(refresh); }),
    store.on('items', (e) => { if (state.runId && !(e && e.transient)) queueMicrotask(refresh); }),
    store.on('plan', (e) => { if (!(e && e.transient)) queueMicrotask(refresh); }),
    store.on('load', () => { items.resync(); queueMicrotask(refresh); }),
    store.on('selection', syncMarks),
    store.on('ui', ({ keys = [] }) => { if (keys.includes('carpentrySel') || keys.includes('tool')) syncMarks(); if (keys.includes('mode')) syncClip(); }),
  ];
  syncMarks();

  const _v = new THREE.Vector3();
  return {
    /**
     * Show a run in 3D: { runId (null clears), open (fronts open), cut (section cut in front of the run), studio (neutral
     * studio light while the run is shown), frame (move the camera) }.
     * Omitted keys keep their value.
     */
    show(opts = {}) {
      const prev = { ...state };
      if ('runId' in opts) state.runId = opts.runId || null;
      if ('open' in opts) state.open = !!opts.open;
      if ('cut' in opts) state.cut = opts.cut !== false;
      if ('studio' in opts) state.studio = !!opts.studio;
      if (prev.runId !== state.runId || prev.open !== state.open) items.resync();
      applyCut();
      buildChecks();
      if (state.runId && opts.frame) frame({ animate: opts.animate !== false });
      invalidate();
    },
    frame,
    state: () => ({ ...state, clipped: clipActive(), studioLit: studioActive(), flagged: flagged.map((f) => f.id) }),
    beginFrame,
    /** Picking: true for a world point removed by the section cut. */
    clipped: (p) => clipActive() && plane.distanceToPoint(p) < -0.005,
    /** After each render: place the check pins over their units. */
    update(camera, canvas) {
      if (!flagged.length) return;
      const w = canvas.clientWidth, h = canvas.clientHeight, walking = isWalking(), on = clipActive();
      for (const f of flagged) {
        _v.copy(f.top).project(camera);
        const vis = !walking && _v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05 && !(on && plane.distanceToPoint(f.top) < 0);
        f.pin.style.display = vis ? '' : 'none';
        if (vis) {
          // keep the whole label inside the pane (its width is measured once, when first shown)
          const half = (f.pw || (f.pw = f.pin.offsetWidth) || 0) / 2 + 4;
          const x = Math.min(Math.max(((_v.x + 1) / 2) * w, half), Math.max(half, w - half));
          const y = Math.max(((1 - _v.y) / 2) * h, 26);
          f.pin.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        }
      }
      group.visible = !walking;
    },
    syncClip,
    dispose() {
      offs.forEach((off) => off());
      items.setVariant(null); items.setViewHidden([]);
      clearChecks();
      if (studioLights) { scene.remove(studioLights.key, studioLights.fill); studioLights.key.dispose(); studioLights.fill.dispose(); studioLights = null; }
      scene.remove(group); pins.remove();
      renderer.clippingPlanes = [];
    },
  };
}
