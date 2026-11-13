/**
 * Orbit camera rig for the 3D viewer: damped OrbitControls, smooth zoom-to-cursor, eased preset tweens.
 * Every preset is derived from PLAN (house bounds, lot, street side, entrance / terrace doors) — no hard-coded coordinates.
 *
 * A pose is { target: Vector3, theta, phi, radius, fov }  (spherical offset of the camera around the target, radians).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { polygonBounds } from '../core/geometry.js';

const SIDE = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
/** Unit plan vector [dx, dy] for a compass side ('n' | 's' | 'e' | 'w'). */
export const sideVec = (side) => SIDE[side] || SIDE.e;
/** Heading in degrees clockwise from plan "up" (north-up) for a compass side. */
export const sideHeading = (side) => ({ n: 0, e: 90, s: 180, w: 270 }[side] ?? 270);

const MAX_POLAR = THREE.MathUtils.degToRad(88);
const TWEEN_MS = 700;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const _v = new THREE.Vector3();

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

function poseFromEye(eye, target, fov) {
  const s = new THREE.Spherical().setFromVector3(_v.copy(eye).sub(target));
  return { target: target.clone(), theta: s.theta, phi: Math.min(s.phi, MAX_POLAR), radius: s.radius, fov };
}

/**
 * @param {{ camera: THREE.PerspectiveCamera, dom: HTMLElement, plan: object, onChange: () => void }} o
 */
export function createOrbitRig({ camera, dom, plan, onChange }) {
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
  const roofY = (plan.heights.ceiling + plan.heights.slab + plan.heights.parapet) / 100;
  const houseBox = new THREE.Box3(new THREE.Vector3(hb.x / 100, 0, hb.y / 100), new THREE.Vector3((hb.x + hb.w) / 100, roofY, (hb.y + hb.h) / 100));
  const lotBox = new THREE.Box3(new THREE.Vector3(sb.x / 100, G, sb.y / 100), new THREE.Vector3((sb.x + sb.w) / 100, roofY * 0.6, (sb.y + sb.h) / 100));
  const houseC = houseBox.getCenter(new THREE.Vector3());
  const lotC = lotBox.getCenter(new THREE.Vector3());
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
  const space = (id) => plan.rooms.find((r) => r.id === id) || plan.outdoorAreas.find((r) => r.id === id) || null;

  /** Dollhouse view into one room from a raised corner. */
  function roomPose(room) {
    const b = polygonBounds(room.polygon);
    const box = new THREE.Box3(new THREE.Vector3(b.x / 100, 0, b.y / 100), new THREE.Vector3((b.x + b.w) / 100, 2.2, (b.y + b.h) / 100));
    const c = box.getCenter(new THREE.Vector3()); c.y = 0.4;
    const diag = streetDiagonal(1);
    const dx = Math.abs(c.x - houseC.x) > 0.5 ? Math.sign(c.x - houseC.x) : Math.sign(diag[0]) || 1;
    const dz = Math.abs(c.z - houseC.z) > 0.5 ? Math.sign(c.z - houseC.z) : Math.sign(diag[1]) || 1;
    const theta = Math.atan2(dx, dz * 1.25), phi = THREE.MathUtils.degToRad(33), fov = 45;
    return { target: c, theta, phi, fov, radius: fitRadius(box, c, theta, phi, fov, aspect(), 1.12) };
  }

  /** Pose for a named preset or a room id; null when unknown. */
  function presetPose(name) {
    if (name === 'aerial') {
      const d = streetDiagonal();
      const theta = Math.atan2(d[0], d[1]), phi = THREE.MathUtils.degToRad(57), fov = 40;
      const target = lotC.clone().setY(0);
      return { target, theta, phi, fov, radius: fitRadius(lotBox, target, theta, phi, fov, aspect(), 1.02) };
    }
    if (name === 'top') {
      const target = houseC.clone().setY(0), fov = 20;
      return { target, theta: 0, phi: 0.0006, fov, radius: fitRadius(houseBox, target, 0, 0.0006, fov, aspect(), 1.1) };
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
    if (!animate || reducedMotion()) { tween = null; applyPose(pose); controls.update(); onChange(); return; }
    const from = getPose();
    let dTheta = (pose.theta - from.theta) % (Math.PI * 2);
    if (dTheta > Math.PI) dTheta -= Math.PI * 2; else if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    tween = { from, to: pose, dTheta, t: 0 };
    onChange();
  }
  function stepTween(dt) {
    if (!tween) return false;
    tween.t = Math.min(1, tween.t + (dt * 1000) / TWEEN_MS);
    const k = easeInOut(tween.t), { from, to } = tween;
    applyPose({
      target: _t.copy(from.target).lerp(to.target, k),
      theta: from.theta + tween.dTheta * k,
      phi: lerp(from.phi, to.phi, k),
      radius: Math.exp(lerp(Math.log(from.radius), Math.log(to.radius), k)),
      fov: lerp(from.fov, to.fov, k),
    });
    if (tween.t >= 1) { tween = null; controls.update(); }
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
    const y = THREE.MathUtils.clamp(t.y, 0, 8);
    const z = THREE.MathUtils.clamp(t.z, lotBox.min.z - 12, lotBox.max.z + 12);
    if (x !== t.x || y !== t.y || z !== t.z) { camera.position.x += x - t.x; camera.position.y += y - t.y; camera.position.z += z - t.z; t.set(x, y, z); }
  }

  return {
    controls,
    /** Advance tweens / damping. Returns true while the camera is still moving. */
    update(dt) {
      if (stepTween(dt)) return true;
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
