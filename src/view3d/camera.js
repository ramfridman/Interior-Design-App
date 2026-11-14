/**
 * Orbit camera rig for the 3D viewer: damped OrbitControls, smooth zoom-to-cursor, eased preset tweens.
 * Every preset is derived from PLAN (house bounds, lot, street side, entrance / terrace doors) — no hard-coded coordinates.
 *
 * A pose is { target: Vector3, theta, phi, radius, fov }  (spherical offset of the camera around the target, radians).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { polygonBounds } from '../core/geometry.js';
import { levelIds, viewOf, elevationM, hasLevels } from './levels.js';

const SIDE = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
/** Unit plan vector [dx, dy] for a compass side ('n' | 's' | 'e' | 'w'). */
export const sideVec = (side) => SIDE[side] || SIDE.e;
/** Heading in degrees clockwise from plan "up" (north-up) for a compass side. */
export const sideHeading = (side) => ({ n: 0, e: 90, s: 180, w: 270 }[side] ?? 270);

const MAX_POLAR = THREE.MathUtils.degToRad(88);
const TWEEN_MS = 700;
/** A frame slower than this ends any running camera animation at once. */
export const STALL_MS = 250;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const _v = new THREE.Vector3(), _d = new THREE.Vector3();

/** Distance at which `box` fits the frustum when looked at from the spherical direction (theta, phi) around `target`. */
export function fitRadius(box, target, theta, phi, fovDeg, aspect, margin = 1.1) {
  const dir = new THREE.Vector3().setFromSphericalCoords(1, Math.max(phi, 1e-4), theta);
  const right = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
  const up = new THREE.Vector3().crossVectors(dir, right);
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2), tanH = tanV * Math.max(0.2, aspect);
  let r = 0.5;
  for (let i = 0; i < 8; i++) {
    _v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(target);
    const z = _v.dot(dir);
    r = Math.max(r, z + Math.abs(_v.dot(right)) / tanH, z + Math.abs(_v.dot(up)) / tanV);
  }
  return r * margin;
}

const _probe = new THREE.PerspectiveCamera();
/**
 * Tight framing of a point cloud seen from the spherical direction (theta, phi): the target is shifted so the
 * projected silhouette is centred and the radius shrunk until it just fills the frustum (× margin).
 * @returns {{ target: THREE.Vector3, radius: number }}
 */
export function framePoints(points, theta, phi, fovDeg, aspect, margin = 1.08) {
  const box = new THREE.Box3().setFromPoints(points);
  const target = box.getCenter(new THREE.Vector3());
  const ph = Math.max(phi, 6e-4), a = Math.max(0.2, aspect);
  let radius = fitRadius(box, target, theta, ph, fovDeg, a, 1);
  _probe.fov = fovDeg; _probe.aspect = a; _probe.near = 0.01; _probe.far = 5000; _probe.updateProjectionMatrix();
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  for (let pass = 0; pass < 6; pass++) {
    _probe.position.setFromSphericalCoords(radius, ph, theta).add(target);
    _probe.up.set(0, 1, 0); _probe.lookAt(target); _probe.updateMatrixWorld(true);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of points) {
      _v.copy(p).project(_probe);
      x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y);
    }
    const halfV = radius * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
    right.setFromMatrixColumn(_probe.matrixWorld, 0); up.setFromMatrixColumn(_probe.matrixWorld, 1);
    target.addScaledVector(right, ((x0 + x1) / 2) * halfV * a).addScaledVector(up, ((y0 + y1) / 2) * halfV);
    radius *= Math.max(0.05, Math.max(x1 - x0, y1 - y0) / 2);
  }
  return { target, radius: radius * margin };
}
const boxCorners = (box) => Array.from({ length: 8 }, (_, i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));

function poseFromEye(eye, target, fov) {
  const s = new THREE.Spherical().setFromVector3(_v.copy(eye).sub(target));
  return { target: target.clone(), theta: s.theta, phi: Math.min(s.phi, MAX_POLAR), radius: s.radius, fov };
}

/**
 * @param {{ camera: THREE.PerspectiveCamera, dom: HTMLElement, plan: object, onChange: () => void, isSlow?: () => boolean }} o
 *        isSlow: when it returns true (very low frame rate) poses are applied at once instead of tweened
 */
export function createOrbitRig({ camera, dom, plan, onChange, isSlow }) {
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.maxPolarAngle = MAX_POLAR;
  controls.minDistance = 0.8;
  controls.maxDistance = 160;
  controls.enableZoom = true;
  controls.rotateSpeed = 0.85;
  controls.screenSpacePanning = false;
  controls.addEventListener('change', onChange);

  const hb = plan.bounds, sb = plan.site.bounds, G = -plan.heights.floorAboveGround / 100;
  /** Top of the roof parapet (m): the top level's elevation + its ceiling, slab and parapet (one level: the plan's). */
  const roofTop = () => {
    if (!hasLevels(plan)) return (plan.heights.ceiling + plan.heights.slab + plan.heights.parapet) / 100;
    let top = 0;
    for (const id of levelIds(plan)) { const h = viewOf(plan, id).heights; top = Math.max(top, elevationM(plan, id) + (h.ceiling + h.slab + h.parapet) / 100); }
    return top;
  };
  let roofY = roofTop();
  const houseBox = new THREE.Box3(new THREE.Vector3(hb.x / 100, 0, hb.y / 100), new THREE.Vector3((hb.x + hb.w) / 100, roofY, (hb.y + hb.h) / 100));
  const lotBox = new THREE.Box3(new THREE.Vector3(sb.x / 100, G, sb.y / 100), new THREE.Vector3((sb.x + sb.w) / 100, roofY * 0.6, (sb.y + sb.h) / 100));
  const houseC = houseBox.getCenter(new THREE.Vector3());
  const lotC = lotBox.getCenter(new THREE.Vector3());
  /** Several floors: the total height follows levels being added / removed (frame-house presets, target clamp). */
  function refreshHeight() {
    const y = roofTop();
    if (y === roofY) return;
    roofY = y; houseBox.max.y = y; lotBox.max.y = y * 0.6;
    houseBox.getCenter(houseC); lotBox.getCenter(lotC);
  }
  const aspect = () => camera.aspect || 1;

  /** Street-side diagonal that also shows the parking bays: plan vector [dx, dy]. */
  function streetDiagonal(bias = 0.85) {
    const st = sideVec(plan.site.street && plan.site.street.side);
    const perp = [-st[1], st[0]];
    const pk = plan.site.parking || [];
    let px = lotC.x * 100, py = lotC.z * 100;
    if (pk.length) { px = pk.reduce((s, p) => s + p.x + p.w / 2, 0) / pk.length; py = pk.reduce((s, p) => s + p.y + p.h / 2, 0) / pk.length; }
    const sgn = Math.sign((px - lotC.x * 100) * perp[0] + (py - lotC.z * 100) * perp[1]) || 1;
    return [st[0] + perp[0] * sgn * bias, st[1] + perp[1] * sgn * bias];
  }
  const opening = (id) => plan.openings.find((o) => o.id === id) || null;
  const openingCentre = (o, y = 1.2) => new THREE.Vector3((o.x + o.w / 2) / 100, y, (o.y + o.h / 2) / 100);
  /** A room / outdoor area by id on any level, with the elevation (m) of its level. */
  const space = (id) => {
    for (const lv of levelIds(plan)) {
      const v = viewOf(plan, lv), s = v.rooms.find((r) => r.id === id) || v.outdoorAreas.find((r) => r.id === id);
      if (s) return lv === 'L0' ? s : { ...s, elevation: elevationM(plan, lv) };
    }
    return null;
  };

  /** Pose that frames `points` tightly from (theta, phi); the orbit target is slid along the view ray onto the floor. */
  function framed(points, theta, phi, fov, margin, floorY = 0) {
    const { target, radius } = framePoints(points, theta, phi, fov, aspect(), margin);
    const dirY = -Math.cos(Math.max(phi, 6e-4));
    let r = radius;
    if (dirY < -0.3) { const s = (floorY - target.y) / dirY; target.addScaledVector(_d.setFromSphericalCoords(1, Math.max(phi, 6e-4), theta), -s); r = radius + s; }
    return { target, theta, phi, fov, radius: Math.max(0.5, r) };
  }
  const lotPoints = () => [
    ...plan.site.boundary.map(([x, y]) => new THREE.Vector3(x / 100, G, y / 100)),
    ...(plan.site.parking || []).flatMap((p) => [new THREE.Vector3(p.x / 100, G, p.y / 100), new THREE.Vector3((p.x + p.w) / 100, G, (p.y + p.h) / 100)]),
    ...boxCorners(houseBox),
  ];

  /** Dollhouse view into one room from a raised corner. */
  function roomPose(room) {
    const b = polygonBounds(room.polygon), e = room.elevation || 0;      // a room of an upper level: its floor's height
    const box = new THREE.Box3(new THREE.Vector3(b.x / 100, e, b.y / 100), new THREE.Vector3((b.x + b.w) / 100, e + 2.2, (b.y + b.h) / 100));
    const c = box.getCenter(new THREE.Vector3()); c.y = e + 0.4;
    const diag = streetDiagonal(1);
    const dx = Math.abs(c.x - houseC.x) > 0.5 ? Math.sign(c.x - houseC.x) : Math.sign(diag[0]) || 1;
    const dz = Math.abs(c.z - houseC.z) > 0.5 ? Math.sign(c.z - houseC.z) : Math.sign(diag[1]) || 1;
    return framed(boxCorners(box), Math.atan2(dx, dz * 1.25), THREE.MathUtils.degToRad(27), 45, 1.3, e);
  }

  /** Pose for a named preset or a room id; null when unknown. */
  function presetPose(name) {
    refreshHeight();
    if (name === 'aerial') {
      const d = streetDiagonal();
      return framed(lotPoints(), Math.atan2(d[0], d[1]), THREE.MathUtils.degToRad(57), 40, 1.06);
    }
    if (name === 'top') {
      return framed(boxCorners(houseBox), 0, 0.0006, 20, 1.1);
    }
    if (name === 'front') {
      const door = opening('door-entry');
      const out = sideVec(door ? door.outside : plan.site.street && plan.site.street.side);
      const diag = streetDiagonal(0.16);
      const d = [out[0] + (out[0] ? 0 : diag[0]), out[1] + (out[1] ? 0 : diag[1])];
      const theta = Math.atan2(d[0], d[1]), phi = THREE.MathUtils.degToRad(86.5), fov = 50;
      const target = houseC.clone().setY(1.25);
      if (door) { const dc = openingCentre(door); target.x = lerp(target.x, dc.x, out[1] ? 0.5 : 0); target.z = lerp(target.z, dc.z, out[0] ? 0.5 : 0); }
      return { target, theta, phi, fov, radius: fitRadius(houseBox, target, theta, phi, fov, aspect(), 1.04) };
    }
    if (name === 'garden') {
      const door = opening('door-terrace');
      const terrace = plan.outdoorAreas.find((a) => a.type === 'terrace');
      if (!door && !terrace) return presetPose('aerial');
      const tb = terrace ? polygonBounds(terrace.polygon) : null;
      const target = door ? openingCentre(door, 1.15) : new THREE.Vector3((tb.x + tb.w / 2) / 100, 1.15, (tb.y + tb.h / 2) / 100);
      const out = door ? sideVec(door.outside) : [Math.sign(target.x - houseC.x) || -1, 0];
      const lat = [-out[1], out[0]];
      const tc = tb ? [(tb.x + tb.w / 2) / 100, (tb.y + tb.h / 2) / 100] : [target.x, target.z];
      const sgn = Math.sign((tc[0] - houseC.x) * lat[0] + (tc[1] - houseC.z) * lat[1]) || 1;
      const eye = new THREE.Vector3(target.x + out[0] * 9.5 + lat[0] * sgn * 4.2, 1.5 + G, target.z + out[1] * 9.5 + lat[1] * sgn * 4.2);
      eye.x = THREE.MathUtils.clamp(eye.x, lotBox.min.x + 0.7, lotBox.max.x - 0.7);
      eye.z = THREE.MathUtils.clamp(eye.z, lotBox.min.z + 0.7, lotBox.max.z - 0.7);
      return poseFromEye(eye, target, 55);
    }
    const room = name === 'interior'
      ? (plan.rooms.find((r) => r.type === 'living') || plan.rooms[0])
      : space(name);
    return room ? roomPose(room) : null;
  }

  // ───────────── pose get / set / tween ─────────────
  let tween = null;
  const sph = new THREE.Spherical();

  function getPose() {
    sph.setFromVector3(_v.copy(camera.position).sub(controls.target));
    return { target: controls.target.clone(), theta: sph.theta, phi: sph.phi, radius: sph.radius, fov: camera.fov };
  }
  function applyPose(p) {
    controls.target.copy(p.target);
    camera.position.setFromSphericalCoords(p.radius, Math.max(p.phi, 0.0006), p.theta).add(p.target);
    if (camera.fov !== p.fov) { camera.fov = p.fov; camera.updateProjectionMatrix(); }
    camera.up.set(0, 1, 0);
    camera.lookAt(p.target);
  }
  function setPose(pose, { animate = true } = {}) {
    if (!pose) return;
    if (!animate || reducedMotion() || (isSlow && isSlow())) { tween = null; applyPose(pose); controls.update(); onChange(); return; }
    const from = getPose();
    let dTheta = (pose.theta - from.theta) % (Math.PI * 2);
    if (dTheta > Math.PI) dTheta -= Math.PI * 2; else if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    tween = { from, to: pose, dTheta, start: performance.now(), last: performance.now() };
    onChange();
  }
  /** Tweens run on wall-clock time (never on a frame count); a frame that took > 250 ms snaps to the end pose. */
  function stepTween() {
    if (!tween) return false;
    const now = performance.now();
    const t = now - tween.last > STALL_MS ? 1 : Math.min(1, (now - tween.start) / TWEEN_MS);
    tween.last = now;
    const k = easeInOut(t), { from, to } = tween;
    applyPose({
      target: _t.copy(from.target).lerp(to.target, k),
      theta: from.theta + tween.dTheta * k,
      phi: lerp(from.phi, to.phi, k),
      radius: Math.exp(lerp(Math.log(from.radius), Math.log(to.radius), k)),
      fov: lerp(from.fov, to.fov, k),
    });
    if (t >= 1) { tween = null; applyPose(to); controls.update(); }
    return true;
  }
  const _t = new THREE.Vector3();
  controls.addEventListener('start', () => { tween = null; zoom.pending = 0; });

  // ───────────── smooth zoom-to-cursor (replaces the stepped OrbitControls wheel zoom) ─────────────
  const zoom = { pending: 0, point: new THREE.Vector3() };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function onWheel(e) {
    if (!controls.enabled) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.ray.intersectPlane(ground, zoom.point);
    if (!hit || hit.distanceTo(camera.position) > 220) zoom.point.copy(controls.target);
    const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 300 : 1;
    zoom.pending += THREE.MathUtils.clamp(e.deltaY * unit, -240, 240) * (e.ctrlKey ? 0.006 : 0.0016);
    tween = null;
    onChange();
  }
  // Captured on the parent so it always runs before (and replaces) the OrbitControls wheel handler.
  const wheelHost = dom.parentElement || dom;
  wheelHost.addEventListener('wheel', onWheel, { passive: false, capture: true });
  function stepZoom(dt) {
    if (Math.abs(zoom.pending) < 1e-4) { zoom.pending = 0; return false; }
    const k = zoom.pending * (reducedMotion() ? 1 : 1 - Math.exp(-dt * 14));
    zoom.pending -= k;
    const s = Math.exp(k);
    const dist = camera.position.distanceTo(controls.target) * s;
    if (dist < controls.minDistance || dist > controls.maxDistance) { zoom.pending = 0; return false; }
    camera.position.sub(zoom.point).multiplyScalar(s).add(zoom.point);
    controls.target.sub(zoom.point).multiplyScalar(s).add(zoom.point);
    return true;
  }

  function clampTarget() {
    const t = controls.target;
    const x = THREE.MathUtils.clamp(t.x, lotBox.min.x - 12, lotBox.max.x + 12);
    const y = THREE.MathUtils.clamp(t.y, 0, Math.max(8, roofY + 1));
    const z = THREE.MathUtils.clamp(t.z, lotBox.min.z - 12, lotBox.max.z + 12);
    if (x !== t.x || y !== t.y || z !== t.z) { camera.position.x += x - t.x; camera.position.y += y - t.y; camera.position.z += z - t.z; t.set(x, y, z); }
  }

  return {
    controls,
    /** Advance tweens / damping. Returns true while the camera is still moving. */
    update(dt) {
      if (stepTween()) return true;
      const zooming = stepZoom(dt);
      clampTarget();
      const moved = controls.enabled ? controls.update() : false;
      return zooming || moved;
    },
    presetPose,
    /** @returns {boolean} false if the preset / room id is unknown */
    setPreset(name, opts) { const p = presetPose(name); if (p) setPose(p, opts); return !!p; },
    getPose, setPose,
    /** Frame a world-space box, keeping the current viewing direction (or the given theta / phi). */
    frameBox(box, { animate = true, theta, phi, margin = 1.6, minRadius = 2.2 } = {}) {
      const cur = getPose();
      const target = box.getCenter(new THREE.Vector3());
      const th = theta ?? cur.theta, ph = phi ?? THREE.MathUtils.clamp(cur.phi, THREE.MathUtils.degToRad(35), THREE.MathUtils.degToRad(62));
      const fov = Math.max(cur.fov, 40);
      setPose({ target, theta: th, phi: ph, fov, radius: Math.max(minRadius, fitRadius(box, target, th, ph, fov, aspect(), margin)) }, { animate });
    },
    /** Re-centre the orbit on a world point without changing direction or distance. */
    focusPoint(point, { animate = true, radius } = {}) {
      const cur = getPose();
      setPose({ ...cur, target: point.clone().setY(Math.max(0, point.y)), radius: radius ?? cur.radius }, { animate });
    },
    isAnimating: () => !!tween,
    stop() { tween = null; zoom.pending = 0; },
    setEnabled(on) { controls.enabled = !!on; if (!on) { tween = null; zoom.pending = 0; } },
    dispose() {
      wheelHost.removeEventListener('wheel', onWheel, { capture: true });
      controls.removeEventListener('change', onChange);
      controls.dispose();
    },
  };
}
