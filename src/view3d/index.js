/**
 * 3D viewer: renderer + scene assembly + orbit / walk modes. API: docs/CONTRACT.md § 4.
 *
 * The building (house.js), the lot (site.js) and the sky / lights (environment.js) are loaded with dynamic import();
 * while one of them is missing or fails, a simple built-in stand-in is used so the viewer always works.
 *
 * Rendering is on demand in orbit mode (store events, camera moves, resize, animations) and continuous in walk mode.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createOrbitRig, STALL_MS } from './camera.js';
import { createItemsLayer } from './items.js';
import { createInteraction } from './interaction.js';
import { createWalk, walkFov } from './walk.js';
import { createCarpentryLayer } from './carpentry.js';
import { createFinishDrop } from './finish-drop.js';
import { sunPosition, sunTimes, sunDirectionWorld, compassPoint, todayAt } from './sun.js';

const CUTAWAY_CM = 120;
const WALK_NEAR = 0.05, ORBIT_NEAR = 0.1, FAR = 600;
const ROOF_OFF_PRESETS = new Set(['top', 'interior']);
const ROOF_ON_PRESETS = new Set(['front', 'garden']);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const LAMPS_ON_BELOW = 5;   // degrees of sun elevation under which lamps are lit in orbit mode

/**
 * @param {HTMLElement} container mount point (#view3d)
 * @param {{ store: object, plan: object, catalog: object, models: object }} ctx
 */
export function createView3D(container, ctx) {
  const { store, plan } = ctx;
  const handlers = new Map();
  const emit = (event, payload = {}) => handlers.get(event)?.forEach((fn) => { try { fn(payload); } catch (e) { console.error(`[view3d] "${event}" listener failed`, e); } });

  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none;touch-action:none;user-select:none;-webkit-user-select:none';
  canvas.setAttribute('aria-label', '3D view of the house');

  const attrs = { alpha: true, depth: true, stencil: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
  let gl = null;
  try { gl = canvas.getContext('webgl2', attrs); } catch (e) { gl = null; }
  if (!gl) return unavailableView(container, handlers);

  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const overlay = document.createElement('div');
  overlay.className = 'v3d-overlay';
  overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
  container.append(canvas, overlay);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, ORBIT_NEAR, FAR);
  scene.add(camera);

  // ───────────── loop state ─────────────
  let active = true, destroyed = false, contextLost = false, ready = false;
  let raf = 0, dirty = true, lastT = 0, houseDirty = false;
  let probe = 0;
  let slow = false;         // last measured frame interval was > 250 ms: camera animations are skipped, not played in slow motion
  let mode = 'orbit', fly = null, saved = null;
  let house = null, site = null, env = null, daylight = null;
  let sunInfo = null, planRebuildMs = 0, planRebuilds = 0;
  const standIns = { house: false, site: false, environment: false };
  const stats = { frameMs: 0, renderMs: 0, fps: 0, frames: 0 };
  const lastCam = new THREE.Matrix4();

  function invalidate() { dirty = true; schedule(); }
  function schedule() { if (!raf && active && !destroyed && !contextLost) raf = requestAnimationFrame(frame); }

  const rig = createOrbitRig({ camera, dom: canvas, plan, onChange: invalidate, isSlow: () => slow });
  let framing = 'aerial';   // preset the camera still shows untouched (re-fitted on resize); null once the user moves it
  rig.controls.addEventListener('start', () => { framing = null; });
  canvas.addEventListener('wheel', () => { framing = null; }, { passive: true });
  const items = createItemsLayer({ scene, ctx, invalidate });
  items.group.visible = store.ui.showItems !== false;
  const interaction = createInteraction({
    dom: canvas, camera, scene, ctx, items, rig, invalidate, emit,
    structures: () => [house && house.group, site && site.group].filter(Boolean),
    cutHeight: () => (mode === 'orbit' && store.ui.wallsCutaway ? CUTAWAY_CM / 100 : null),
    clipped: (p) => !!(carpentry && carpentry.clipped(p)),
  });
  // finish drag-and-drop: target under the cursor + highlight of the floor / walls it would cover
  const finishDrop = createFinishDrop({
    scene, ctx, invalidate, surfaceAt: (x, y) => interaction.surfaceAt(x, y),
    wallTop: () => (mode === 'orbit' && store.ui.wallsCutaway ? CUTAWAY_CM : plan.heights.ceiling) / 100,
    accent: (getComputedStyle(container).getPropertyValue('--accent') || '').trim() || undefined,
  });
  // carpentry: models follow their run, the workbench's 3D tab (section cut, open fronts, fit problems)
  const carpentry = createCarpentryLayer({ scene, renderer, ctx, items, rig, overlay, invalidate, isWalking: () => mode === 'walk' });
  const walk = createWalk({
    camera, dom: canvas, overlay, ctx, emit,
    pickTarget: (x, y) => interaction.walkTarget(x, y),
    requestExit: () => { exitWalk(); if (store.ui.mode === 'walk') store.setUI({ mode: '3d' }); },
  });

  // ───────────── house / site / environment ─────────────
  const call = (obj, method, ...args) => { try { if (obj && typeof obj[method] === 'function') return obj[method](...args); } catch (e) { console.error(`[view3d] ${method}() failed`, e); } return undefined; };
  function applyHouseState() {
    const walking = mode === 'walk' && !(fly && fly.deferRoof);
    call(house, 'setCutaway', !walking && store.ui.wallsCutaway ? CUTAWAY_CM : null);
    call(house, 'setRoofVisible', walking || !!store.ui.showRoof);
    call(house, 'setDoorsOpen', mode === 'walk');
    // sun study: a hidden roof / cut-away walls keep blocking the sun (invisible shadow casters in house.js)
    const study = store.ui.sunStudy !== false;
    call(house, 'setSunStudy', study);
    call(env, 'setSunStudy', study && !walking && (!store.ui.showRoof || !!store.ui.wallsCutaway));
    call(env, 'setInteriorMode', mode === 'walk');
    carpentry.syncClip();
    call(daylight, 'setDoorsOpen', true);                              // daylight always treats interior doors as open, so door-lit rooms (baths, WC, laundry) are not black in the dollhouse
    invalidate();
  }
  /** How the daylight solution is shown: walk (eye adaptation), roofless dollhouse (display gain), or not at all. */
  const daylightView = () => {
    const walking = mode === 'walk' && !(fly && fly.deferRoof);
    const roofHidden = !walking && (!store.ui.showRoof || !!store.ui.wallsCutaway);
    // without sun study the hidden roof casts nothing — the solved interior (which has a roof) would not match
    return { mode: walking ? 'walk' : 'orbit', dollhouse: roofHidden, suppress: roofHidden && store.ui.sunStudy === false };
  };

  /** Sun position and today's key times: from the environment, or straight from the ephemeris while a stand-in is used. */
  function readSun() {
    const info = call(env, 'getSunInfo');
    if (info) return info;
    const meta = plan.meta || {}, where = { latitude: meta.latitude, longitude: meta.longitude, timeZone: meta.timeZone };
    const date = store.ui.date || todayAt(meta.timeZone), hours = Number(store.ui.timeOfDay) || 0;
    const p = sunPosition({ date, hours, ...where }), t = sunTimes(date, where);
    return { date, hours, azimuth: p.azimuth, elevation: p.elevation, compass: compassPoint(p.azimuth), sunrise: t.sunrise, sunset: t.sunset, solarNoon: t.solarNoon, dayLength: t.dayLength, isDay: p.elevation > -0.3 };
  }
  /** Push store.ui.date / timeOfDay into the environment and tell the UI where the sun now is. */
  function applySun() {
    call(env, 'setDate', store.ui.date);
    call(env, 'setTimeOfDay', store.ui.timeOfDay);
    call(daylight, 'relight');
    sunInfo = readSun();
    emit('sun', sunInfo);
    invalidate();
  }

  /**
   * The plan object was edited in place (store event 'plan'): rebuild everything derived from it — shell, floors,
   * roof, openings, walk blockers, snap faces, fill-light anchors, item ground levels. Camera, mode, selection,
   * roof / cut-away / door / sun state are untouched. All synchronous: the next frame shows the finished house.
   */
  function rebuildFromPlan(e) {
    if (!house || destroyed) return;
    const t0 = performance.now();
    call(house, 'rebuildPlan');
    call(env, 'refreshPlan');
    walk.refreshPlan(); interaction.refreshPlan(); items.refreshPlan(); finishDrop.refreshPlan();
    call(daylight, 'onPlan', e);
    if (mode === 'walk' && !fly) walk.syncCamera();
    planRebuildMs = performance.now() - t0; planRebuilds++;
    invalidate();
  }

  async function assemble() {
    const load = (file) => import(file).catch(() => null);
    const [houseMod, siteMod, envMod, dlMod] = await Promise.all([load('./house.js'), load('./site.js'), load('./environment.js'), load('./daylight/index.js')]);
    if (destroyed) return;
    const build = (name, real, fallback, valid) => {
      if (real) {
        try { const made = real(); if (made && valid(made)) return made; } catch (e) { console.warn(`[view3d] ${name} module failed — using the built-in stand-in`, e); }
      }
      standIns[name] = true;
      return fallback();
    };
    house = build('house', houseMod && houseMod.buildHouse && (() => houseMod.buildHouse(ctx)), () => standInHouse(ctx), (h) => h.group && h.group.isObject3D);
    site = build('site', siteMod && siteMod.buildSite && (() => siteMod.buildSite(ctx)), () => standInSite(ctx), (s) => s.group && s.group.isObject3D);
    scene.add(house.group, site.group);
    env = build('environment', envMod && envMod.createEnvironment && (() => envMod.createEnvironment({ scene, renderer, ctx, shadowMapSize: softwareGL(gl) ? 2048 : undefined })), () => standInEnvironment({ scene, renderer, ctx }), (e) => typeof e.setTimeOfDay === 'function');
    // diffuse daylight (radiosity solver in a worker → lightmaps + probes); the standard lighting stays as the fallback
    if (dlMod && dlMod.createDaylight && !standIns.house && !standIns.environment) {
      try {
        daylight = dlMod.createDaylight({ ctx, renderer, scene, invalidate });
        daylight.setEnabled(store.ui.daylight !== false);
        daylight.attach({ house, env, items });
      } catch (e) { console.warn('[view3d] daylight unavailable — using the standard lighting', e); daylight = null; }
    }
    applyHouseState();
    ready = true;
    applySun();
    emit('ready', { standIns: { ...standIns } });
  }

  // ───────────── rendering ─────────────
  function renderNow() {
    if (destroyed || contextLost || !canvas.width || !canvas.height) return;
    const t0 = performance.now();
    call(env, 'update', camera);
    const dlBusy = call(daylight, 'update', camera, daylightView());
    // lamps: on at dusk / night; walking they used to stay on all day — with the solved daylight they follow the sun too
    const dayLit = daylight && daylight.isActive();
    items.updateLamps(camera, (mode === 'walk' && !dayLit) || !sunInfo || sunInfo.elevation < LAMPS_ON_BELOW);
    const undoStudio = carpentry.beginFrame(camera, { env });   // carpentry 3D tab "Studio light": this render only
    renderer.render(scene, camera);
    if (undoStudio) undoStudio();
    if (dlBusy) { dirty = true; schedule(); }
    interaction.renderOverlay(renderer);
    carpentry.update(camera, canvas);
    dirty = false;
    stats.renderMs += (performance.now() - t0 - stats.renderMs) * 0.1;
    stats.frames++;
    if (!lastCam.equals(camera.matrixWorld)) { lastCam.copy(camera.matrixWorld); emit('camera', {}); }
  }

  function frame(now) {
    raf = 0;
    // First frame after an idle period has no meaningful delta; slow frames are clamped rather than dropped.
    let dt = lastT ? (now - lastT) / 1000 : 0;
    lastT = now;
    if (dt > 0) { stats.frameMs += (Math.min(dt, 1) * 1000 - stats.frameMs) * 0.1; slow = dt * 1000 > STALL_MS; }
    dt = dt > 0 ? Math.min(dt, 0.25) : 1 / 60;
    stats.fps = stats.frameMs ? 1000 / stats.frameMs : 0;
    let again = false;
    if (fly) { stepFly(); again = true; }
    else if (mode === 'walk') { walk.update(dt); again = true; }
    else again = rig.update(dt);
    if (houseDirty) { houseDirty = false; call(house, 'update'); call(site, 'update'); dirty = true; }
    const rendered = dirty || again;
    if (rendered) renderNow();
    if (again) schedule();
    else {
      lastT = 0;
      // Going idle: one empty callback measures how long that last frame really took to present.
      if (rendered && !probe) probe = requestAnimationFrame((t) => { probe = 0; const ms = t - now; if (ms < 5000) slow = ms > STALL_MS; });
    }
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h || destroyed) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (mode === 'walk' && !fly) camera.fov = walkFov(camera.aspect);
    camera.updateProjectionMatrix();
    // Until the user moves the camera, keep the current preset framed for the new aspect ratio.
    if (framing && mode === 'orbit' && !fly && !rig.isAnimating()) rig.setPreset(framing, { animate: false });
    if (active) renderNow();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (observer) observer.observe(container);
  window.addEventListener('resize', resize);

  function onContextLost(e) { e.preventDefault(); contextLost = true; cancelAnimationFrame(raf); raf = 0; }
  function onContextRestored() { contextLost = false; renderer.shadowMap.needsUpdate = true; houseDirty = true; invalidate(); }
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  // ───────────── camera fly (orbit ⇄ walk transition) ─────────────
  function flyTo(position, quaternion, fov, seconds, done, extra = {}) {
    const now = performance.now();
    fly = { p0: camera.position.clone(), q0: camera.quaternion.clone(), f0: camera.fov, p1: position, q1: quaternion, f1: fov, start: now, last: now, dur: seconds * 1000, done, ...extra };
    invalidate();
  }
  /** Wall-clock driven; a frame that took > 250 ms snaps straight to the end pose. */
  function stepFly() {
    const f = fly, now = performance.now();
    const t = now - f.last > STALL_MS ? 1 : Math.min(1, (now - f.start) / f.dur);
    f.last = now;
    const k = ease(t);
    camera.position.lerpVectors(f.p0, f.p1, k);
    camera.quaternion.slerpQuaternions(f.q0, f.q1, k);
    camera.fov = f.f0 + (f.f1 - f.f0) * k;
    camera.updateProjectionMatrix();
    if (f.deferRoof && camera.position.y < store.project.ceilingHeight / 100 - 0.1) { f.deferRoof = false; applyHouseState(); }
    if (t >= 1) finishFly();
  }
  function finishFly() {
    if (!fly) return;
    const f = fly; fly = null;
    camera.position.copy(f.p1); camera.quaternion.copy(f.q1); camera.fov = f.f1; camera.updateProjectionMatrix();
    f.done();
    invalidate();
  }

  // ───────────── modes ─────────────
  function enterWalk(opts = {}) {
    if (destroyed) return;
    if (mode === 'walk') {
      // Already walking: a bare repeat call (UI + store both asking) is a no-op; explicit coordinates teleport.
      if (opts.x == null && opts.y == null && opts.heading == null) return;
      finishFly(); walk.start(opts); invalidate(); return;
    }
    finishFly();
    saved = { pose: rig.getPose(), near: camera.near };
    const from = { p: camera.position.clone(), q: camera.quaternion.clone(), fov: camera.fov };
    mode = 'walk';
    rig.setEnabled(false);
    interaction.setEnabled(false);
    camera.near = WALK_NEAR;
    walk.start(opts);
    const eye = walk.eyePose(), fov = walkFov(camera.aspect);
    const settle = () => { camera.fov = fov; camera.updateProjectionMatrix(); walk.syncCamera(); applyHouseState(); };
    if (opts.animate === false || reducedMotion() || !ready || slow) settle();
    else {
      camera.position.copy(from.p); camera.quaternion.copy(from.q); camera.fov = from.fov;
      flyTo(eye.position, eye.quaternion, fov, 0.8, settle, { deferRoof: true });
    }
    camera.updateProjectionMatrix();
    applyHouseState();
    emit('mode', { mode });
    invalidate();
  }

  function exitWalk(opts = {}) {
    if (mode !== 'walk' || destroyed) return;
    finishFly();
    walk.stop();
    mode = 'orbit';
    const pose = saved ? saved.pose : rig.presetPose('aerial');
    const restore = () => {
      camera.near = saved ? saved.near : ORBIT_NEAR;
      camera.up.set(0, 1, 0);
      rig.setEnabled(true);
      rig.setPose(pose, { animate: false });
      interaction.setEnabled(true);
    };
    if (opts.animate === false || reducedMotion() || slow) restore();
    else {
      const ghost = camera.clone();
      ghost.position.setFromSphericalCoords(pose.radius, pose.phi, pose.theta).add(pose.target);
      ghost.up.set(0, 1, 0); ghost.lookAt(pose.target);
      flyTo(ghost.position.clone(), ghost.quaternion.clone(), pose.fov, 0.65, restore);
    }
    applyHouseState();
    emit('mode', { mode });
    invalidate();
  }

  // ───────────── store wiring ─────────────
  const offs = [
    store.on('ui', ({ keys = [] }) => {
      if (keys.includes('timeOfDay') || keys.includes('date')) applySun();
      if (keys.includes('showItems')) items.group.visible = store.ui.showItems !== false;
      if (keys.includes('daylight')) call(daylight, 'setEnabled', store.ui.daylight !== false);
      if (keys.includes('daylightSky')) call(daylight, 'relight');
      if (keys.includes('showRoof') || keys.includes('wallsCutaway') || keys.includes('sunStudy')) applyHouseState();
      if (keys.includes('mode')) {
        if (store.ui.mode === 'walk' && mode !== 'walk') enterWalk();
        else if (store.ui.mode !== 'walk' && mode === 'walk') exitWalk({ animate: false });
      }
      invalidate();
    }),
    store.on('project', () => { houseDirty = true; call(daylight, 'onProject'); invalidate(); }),
    store.on('finishes', () => { houseDirty = true; call(daylight, 'relight'); invalidate(); }),
    store.on('selection', invalidate),
    store.on('plan', rebuildFromPlan),
  ];

  resize();
  rig.setPreset(framing, { animate: false });
  assemble().catch((e) => console.error('[view3d] scene assembly failed', e));

  const api = {
    resize,
    /** Pause / resume the render loop (nothing is freed). */
    setActive(on) {
      active = !!on;
      if (!active) { cancelAnimationFrame(raf); raf = 0; lastT = 0; } else { resize(); invalidate(); }
    },
    setMode(m) { if (m === 'walk') enterWalk(); else exitWalk(); },
    getMode: () => mode,
    /** 'aerial' | 'top' | 'front' | 'garden' | 'interior' | room / outdoor-area id */
    setCameraPreset(name, opts = {}) {
      if (!rig.presetPose(name)) return false;
      if (mode === 'walk') exitWalk({ animate: false });
      const roomView = ROOF_OFF_PRESETS.has(name) || !['aerial', 'front', 'garden'].includes(name);
      if (roomView && store.ui.showRoof) store.setUI({ showRoof: false });
      else if (ROOF_ON_PRESETS.has(name) && !store.ui.showRoof) store.setUI({ showRoof: true });
      framing = name;
      return rig.setPreset(name, opts);
    },
    enterWalk, exitWalk,
    /** Frame an item in the orbit camera. */
    focusItem(id, opts = {}) {
      const box = items.boxOf(id);
      if (!box || mode === 'walk') return false;
      framing = null;
      rig.frameBox(box, opts);
      return true;
    },
    /**
     * Carpentry workbench 3D tab: { runId (null = off), open (fronts open), cut (section cut in front of the run), frame
     * (move the camera onto the run), animate }. Omitted keys keep their value. Returns the current carpentry 3D state.
     */
    showCarpentry(opts = {}) {
      if (opts.frame && mode === 'walk') exitWalk({ animate: false });
      if (opts.frame) framing = null;
      carpentry.show(opts);
      return carpentry.state();
    },
    startPlacing(partial, opts) { if (mode === 'walk') exitWalk({ animate: false }); interaction.startPlacing(partial, opts); },
    cancelPlacing: () => interaction.cancelPlacing(),
    dropAt: (clientX, clientY, partial) => interaction.dropAt(clientX, clientY, partial),
    /** Finish drag-and-drop: the room / outdoor area under a screen position ({ spaceId, surface: 'floor'|'wall' } | null). */
    finishTargetAt: (clientX, clientY) => finishDrop.targetAt(clientX, clientY),
    /** Highlight the floor or the walls a dragged finish would cover ({ spaceId, kind: 'floor'|'wall' }), or clear (null). */
    setFinishHighlight: (target) => finishDrop.highlight(target || null),
    /** Off-screen high-resolution render of the current view (no outline / ghost / HUD) as a PNG data URL. */
    async snapshot({ width = 1920, height = 1080 } = {}) {
      if (contextLost || destroyed) return '';
      const max = Math.min(8192, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 4096);
      const k = Math.min(1, max / width, max / height);
      const w = Math.max(16, Math.round(width * k)), h = Math.max(16, Math.round(height * k));
      const prev = { pr: renderer.getPixelRatio(), size: renderer.getSize(new THREE.Vector2()), aspect: camera.aspect };
      interaction.setOverlayHidden(true);
      renderer.setPixelRatio(1); renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      call(env, 'update', camera);
      call(daylight, 'update', camera, daylightView());
      renderer.render(scene, camera);
      const url = canvas.toDataURL('image/png');
      renderer.setPixelRatio(prev.pr); renderer.setSize(prev.size.x, prev.size.y, false);
      camera.aspect = prev.aspect; camera.updateProjectionMatrix();
      interaction.setOverlayHidden(false);
      renderNow();
      return url;
    },
    /** Screen-space rectangle (client px) of an item — handy for floating toolbars. */
    itemScreenRect(id) {
      const box = items.boxOf(id);
      if (!box) return null;
      const r = canvas.getBoundingClientRect(), v = new THREE.Vector3();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, front = false;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
        if (v.z < 1) front = true;
        const sx = r.left + (v.x * 0.5 + 0.5) * r.width, sy = r.top + (-v.y * 0.5 + 0.5) * r.height;
        x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, visible: front };
    },
    /**
     * Events: 'mode' {mode} · 'walk-position' {x,y,heading,spaceId} · 'ready' · 'select' {ids,spaceId} · 'drag' · 'placing' · 'camera'
     * · 'sun' { date, hours, azimuth, elevation, compass, sunrise, sunset, solarNoon, dayLength, isDay } — angles in degrees
     *   (azimuth clockwise from true north), times in decimal local clock hours; sent whenever store.ui.date / timeOfDay
     *   change and once to every new subscriber.
     */
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
      if (event === 'ready' && ready) queueMicrotask(() => fn({ standIns: { ...standIns } }));
      if (event === 'sun' && ready && sunInfo) queueMicrotask(() => fn(sunInfo));
      return () => handlers.get(event)?.delete(fn);
    },
    destroy() {
      if (destroyed) return;
      finishFly();
      destroyed = true;
      cancelAnimationFrame(raf); cancelAnimationFrame(probe);
      offs.forEach((off) => off());
      if (observer) observer.disconnect();
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      call(daylight, 'dispose'); daylight = null;
      carpentry.dispose(); walk.dispose(); finishDrop.dispose(); interaction.dispose(); items.dispose(); rig.dispose();
      call(house, 'dispose'); call(site, 'dispose'); call(env, 'dispose');
      renderer.dispose();
      canvas.remove(); overlay.remove();
      handlers.clear();
    },
    /** Test / debug hooks (not part of the contract). */
    debug: {
      renderer, scene, camera, rig, items, interaction, walk, carpentry,
      standIns,
      isReady: () => ready,
      isFlying: () => !!fly,
      stats: () => ({ ...stats, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, items: items.count(), planRebuildMs, planRebuilds }),
      house: () => house, environment: () => env, sun: () => sunInfo,
      /** Daylight solver: state() (patch count, timings, …), sampleAt(xcm, ycm, hcm) → irradiance there. */
      daylight: () => (daylight ? daylight.debug : null),
      renderNow,
    },
  };
  return api;
}

/** True when WebGL runs on a CPU rasteriser (SwiftShader / llvmpipe), where big shadow maps are very slow. */
function softwareGL(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    return /swiftshader|llvmpipe|software|softpipe/i.test(name);
  } catch (e) { return false; }
}

/** Graceful placeholder when WebGL 2 is not available: same API, nothing rendered. */
function unavailableView(container, handlers) {
  const box = document.createElement('div');
  box.className = 'v3d-unavailable';
  box.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:32px;text-align:center;background:#f3f1ec;color:#3a3d42;font:500 15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
  const inner = document.createElement('div'), title = document.createElement('div'), text = document.createElement('div');
  inner.style.maxWidth = '420px';
  title.style.cssText = 'font-size:19px;font-weight:650;margin-bottom:8px';
  title.textContent = '3D view is not available';
  text.textContent = 'This browser or device could not start WebGL. The 2D plan keeps working — try enabling hardware acceleration or another browser to walk through the house in 3D.';
  inner.append(title, text);
  box.appendChild(inner);
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(box);
  const noop = () => {};
  return {
    resize: noop, setActive: noop, setMode: noop, getMode: () => 'orbit', setCameraPreset: () => false,
    enterWalk: noop, exitWalk: noop, focusItem: () => false,
    /**
     * Carpentry workbench 3D tab: { runId (null = off), open (fronts open), cut (section cut in front of the run), frame
     * (move the camera onto the run), animate }. Omitted keys keep their value. Returns the current carpentry 3D state.
     */
    showCarpentry: () => ({ runId: null, open: false, cut: false, studio: false, clipped: false, studioLit: false, flagged: [] }),   // nothing to show without WebGL
    startPlacing(partial, opts) { if (opts && opts.onDone) opts.onDone(null); }, cancelPlacing: noop, dropAt: () => null,
    snapshot: async () => '', itemScreenRect: () => null,
    on(event, fn) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn); return () => handlers.get(event)?.delete(fn); },
    destroy() { box.remove(); handlers.clear(); },
    unavailable: true,
  };
}

// ───────────────────────── built-in stand-ins (used only while the real modules are missing) ─────────────────────────
function flatShape(polygon, y) {
  const shape = new THREE.Shape(polygon.map(([px, py]) => new THREE.Vector2(px / 100, -py / 100)));
  const g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}
const boxAt = (r, y0, y1) => new THREE.BoxGeometry(r.w / 100, y1 - y0, r.h / 100).translate((r.x + r.w / 2) / 100, (y0 + y1) / 2, (r.y + r.h / 2) / 100);

function standInHouse({ plan, store }) {
  const group = new THREE.Group();
  group.name = 'house (stand-in)';
  const wallMat = new THREE.MeshStandardMaterial({ color: store.project.wallColor, roughness: 0.92 });
  const floorMat = new THREE.MeshStandardMaterial({ color: '#d8d2c6', roughness: 0.75 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#e9e6e0', roughness: 0.95 });
  const floorMeshes = [];
  let walls = null, roof = null, cut = null, roofOn = false;
  for (const room of plan.rooms) {
    const m = new THREE.Mesh(flatShape(room.polygon, 0), floorMat);
    m.receiveShadow = true; m.userData.spaceId = room.id;
    group.add(m); floorMeshes.push(m);
  }
  const base = new THREE.Mesh(boxAt(plan.bounds, -plan.heights.floorAboveGround / 100, -0.005), roofMat);
  base.receiveShadow = true;
  group.add(base);
  function rebuild() {
    const H = store.project.ceilingHeight / 100, top = cut != null ? Math.min(H, cut / 100) : H;
    const parts = plan.walls.map((w) => boxAt(w, 0, top));
    for (const o of plan.openings) {
      if (o.sill > 0) parts.push(boxAt(o, 0, Math.min(top, o.sill / 100)));
      const head = (o.sill + o.height) / 100;
      if (head < top) parts.push(boxAt(o, head, top));
    }
    if (walls) { group.remove(walls); walls.geometry.dispose(); }
    walls = new THREE.Mesh(mergeGeometries(parts, false), wallMat);
    walls.castShadow = walls.receiveShadow = true;
    parts.forEach((p) => p.dispose());
    group.add(walls);
    if (roof) { group.remove(roof); roof.geometry.dispose(); }
    roof = new THREE.Mesh(boxAt(plan.bounds, H, H + plan.heights.slab / 100), roofMat);
    roof.castShadow = roof.receiveShadow = true;
    roof.visible = roofOn && cut == null;
    group.add(roof);
    wallMat.color.set(store.project.wallColor);
  }
  rebuild();
  return {
    group, floorMeshes,
    update: rebuild,
    rebuildPlan() {
      for (const m of floorMeshes) { group.remove(m); m.geometry.dispose(); }
      floorMeshes.length = 0;
      for (const room of plan.rooms) {
        const m = new THREE.Mesh(flatShape(room.polygon, 0), floorMat);
        m.receiveShadow = true; m.userData.spaceId = room.id;
        group.add(m); floorMeshes.push(m);
      }
      rebuild();
    },
    setSunStudy() {},
    setRoofVisible(v) { roofOn = !!v; if (roof) roof.visible = roofOn && cut == null; },
    setCutaway(h) { if (h === cut) return; cut = h; rebuild(); },
    setDoorsOpen() {},
    dispose() { group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); wallMat.dispose(); floorMat.dispose(); roofMat.dispose(); },
  };
}

function standInSite({ plan }) {
  const group = new THREE.Group();
  group.name = 'site (stand-in)';
  const G = -plan.heights.floorAboveGround / 100;
  const groundMeshes = [];
  const add = (geo, color, spaceId) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
    m.receiveShadow = true; m.userData.spaceId = spaceId;
    group.add(m); groundMeshes.push(m);
  };
  const sb = plan.site.bounds, pad = 3000;
  add(flatShape([[sb.x - pad, sb.y - pad], [sb.x + sb.w + pad, sb.y - pad], [sb.x + sb.w + pad, sb.y + sb.h + pad], [sb.x - pad, sb.y + sb.h + pad]], G - 0.02), '#b9b3a4', null);
  add(flatShape(plan.site.boundary, G), '#8fae76', 'garden');
  for (const p of plan.site.paths || []) add(flatShape(p.polygon, G + 0.01), '#c9c5bc', 'garden');
  for (const p of plan.site.parking || []) add(flatShape([[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]], G + 0.012), '#aeb0b2', p.id);
  for (const a of plan.outdoorAreas) add(flatShape(a.polygon, -0.02), '#cfc8ba', a.id);
  return {
    group, groundMeshes,
    update() {},
    dispose() { group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); },
  };
}

function standInEnvironment({ scene, ctx }) {
  const { plan } = ctx;
  const sky = new THREE.Color('#cfe3f4');
  const prevBackground = scene.background;
  scene.background = sky;
  const hemi = new THREE.HemisphereLight('#ffffff', '#b8b09c', 1.1);
  const sun = new THREE.DirectionalLight('#fff4e2', 2.6);
  const sb = plan.site.bounds, cx = (sb.x + sb.w / 2) / 100, cz = (sb.y + sb.h / 2) / 100, reach = Math.max(sb.w, sb.h) / 100 * 0.75;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 120 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  sun.target.position.set(cx, 0, cz);
  scene.add(hemi, sun, sun.target);
  let interior = false, day = 1, date = todayAt(plan.meta.timeZone), clock = 13;
  const applyLevels = () => { hemi.intensity = (0.25 + 0.85 * day) * (interior ? 1.5 : 1); };
  function place() {
    const p = sunPosition({ date, hours: clock, latitude: plan.meta.latitude, longitude: plan.meta.longitude, timeZone: plan.meta.timeZone });
    const elev = Math.sin(p.elevation * Math.PI / 180);
    const d = sunDirectionWorld(p.azimuth, Math.max(p.elevation, 4), plan.meta.northAngle || 0);
    day = THREE.MathUtils.clamp(elev * 2.2 + 0.1, 0, 1);
    sun.position.set(cx + d[0] * 45, d[1] * 45, cz + d[2] * 45);
    sun.intensity = 2.8 * THREE.MathUtils.clamp(p.elevation / 3, 0, 1) * day;
    sun.color.set('#ffb070').lerp(new THREE.Color('#fff4e2'), THREE.MathUtils.clamp(elev * 2, 0, 1));
    sky.set('#141a2a').lerp(new THREE.Color('#cfe3f4'), day);
    applyLevels();
  }
  return {
    sun,
    setTimeOfDay(hours) { clock = Number.isFinite(+hours) ? +hours : 13; place(); },
    setDate(d) { date = typeof d === 'string' && d ? d : todayAt(plan.meta.timeZone); place(); },
    setInteriorMode(on) { interior = !!on; applyLevels(); },
    update() {},
    dispose() { scene.remove(hemi, sun, sun.target); scene.background = prevBackground; sun.shadow.map?.dispose(); },
  };
}
