/**
 * Outdoor furniture & structures — procedural 3D models (metres) and 2D plan symbols (cm).
 * Types: lounger, parasol, pergola, bbq, fire-pit, swing-bench, shed, fence, outdoor-light, play, car, utility.
 *
 * Every builder draws its parts at real-world thicknesses inside the requested box and the result is then
 * normalised by `fit()` so that the bounding box is exactly w × d × h (corrections are a few percent at most).
 *
 * Colour roles (common params):
 *   lounger      color = frame / body        color2 = cushions            color3 = stand, wheels
 *   parasol      color = canopy (or `canopy`) color2 = pole / frame        color3 = base
 *   pergola      color = structure           color2 / roofColor = roof    color3 = curtains
 *   bbq          color = body / lid          color2 = cart, shelves, counter   color3 = handles, knobs
 *   fire-pit     color = body                color2 = stand / burner      color3 = accent
 *   swing-bench  color = fabric / seat       color2 = frame               color3 = accent cushions
 *   shed         color = walls               color2 = roof / trim         color3 = doors
 *   fence        color = infill              color2 = posts / frame       color3 = accent
 *   outdoor-light color = body               color2 = diffuser (lightColor = light)
 *   play         color = main                color2 = frame               color3 = accent
 *   car          color = paint               color2 = trim / roof         color3 = seats
 *   utility      color = body                color2 = secondary           color3 = accent
 */
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerModel } from './registry.js';
import * as K from './kit.js';

const { box, boxOn, rbox, rboxOn, cyl, cylOn, sphere } = K;
const PI = Math.PI, TAU = PI * 2, UP = new THREE.Vector3(0, 1, 0);
const INK = K.INK, SOFT = K.INK_SOFT;

// ───────────────────────── params ─────────────────────────
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const MATS = ['fabric', 'leather', 'velvet', 'wood', 'metal', 'rattan', 'plastic', 'glass', 'stone', 'ceramic', 'concrete', 'laminate', 'lacquer', 'aluminium', 'teak', 'textile'];

/** Number param with default and clamp (junk → default). */
function num(v, def, lo = -Infinity, hi = Infinity) {
  const n = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN;
  return clamp(Number.isFinite(n) ? n : def, lo, hi);
}
const flag = (v, def) => (v === true || v === 'true' || v === 1 ? true : v === false || v === 'false' || v === 0 ? false : def);
const pick = (v, list) => (list.includes(v) ? v : list[0]);
/** Colour param: '#hex' or kit keyword, anything else → default. */
function C(v, def) {
  if (typeof v !== 'string') return def;
  if (v[0] === '#') return HEX.test(v) ? v : def;
  return K.col(v, def);
}
const M = (material, color, fallback) => K.byMaterial(MATS.includes(material) ? material : fallback, color, fallback);
const isWood = (m) => m === 'wood' || m === 'teak';
const isMetal = (m) => m === 'metal' || m === 'aluminium';
function rgba(hex, a) {
  let s = C(hex, '#cccccc').slice(1);
  if (s.length === 3) s = s.replace(/./g, '$&$&');
  const n = parseInt(s, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ───────────────────────── materials ─────────────────────────
const alu = (c = '#3a3d42') => K.metal(c, { roughness: 0.5, metalness: 0.6 });
const inox = () => K.metal('#c9ccd0', { roughness: 0.3, metalness: 0.9 });
const dark = (c = '#1c1d20') => K.mat(c, { roughness: 0.75 });
const rubber = () => K.mat('#17181a', { roughness: 0.92 });
const cloth = (c) => K.mat(c, { roughness: 0.95, side: THREE.DoubleSide });
const shell = (c, o = {}) => K.mat(c, { roughness: 0.6, side: THREE.DoubleSide, ...o });
const clear = (c = '#cfe3ea', a = 0.28) => K.mat(c, { roughness: 0.05, opacity: a, depthWrite: false, side: THREE.DoubleSide });
const paintM = (c) => K.mat(c, { roughness: 0.32, metalness: 0.45 });
const lit = (c, i = 0.35) => K.mat(c, { roughness: 0.2, emissive: c, emissiveIntensity: i });

// ───────────────────────── geometry helpers ─────────────────────────
const ns = (m) => { m.userData.noShadow = true; return m; };
const rot = (m, rx = 0, ry = 0, rz = 0) => { m.rotation.set(rx, ry, rz); return m; };
const at = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); return m; };
const mesh = (geo, material, x = 0, y = 0, z = 0) => at(new THREE.Mesh(geo, material), x, y, z);

/** Merge geometries into ONE mesh (empty list → empty group). */
function merge(geos, material) {
  const list = geos.filter(Boolean);
  if (!list.length) return new THREE.Group();
  const mixed = list.some((g) => !g.index);
  return new THREE.Mesh(mergeGeometries(mixed ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list), material);
}
/** Box geometry centred at (x, y, z) with optional Euler rotation. */
function boxG(w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}
/** Many boxes as one mesh. Entry: [w, h, d, x, y, z, rx, ry, rz]. */
const boxes = (list, material) => merge(list.map((b) => boxG(...b)), material);
/** Vertical cylinder geometry centred at (x, y, z). */
function cylG(rt, rb, h, x = 0, y = 0, z = 0, seg = 12, open = false) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  g.translate(x, y, z);
  return g;
}
/** Cylinder with its axis along X. */
function xCylG(r, len, x = 0, y = 0, z = 0, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(PI / 2); g.translate(x, y, z);
  return g;
}
/** Cylinder with its axis along Z. */
function zCylG(r, len, x = 0, y = 0, z = 0, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(PI / 2); g.translate(x, y, z);
  return g;
}
/** Straight rod geometry between two points. */
function rodG(a, b, r, seg = 8) {
  const va = new THREE.Vector3(a[0], a[1], a[2]), vb = new THREE.Vector3(b[0], b[1], b[2]);
  const len = Math.max(1e-4, va.distanceTo(vb));
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, vb.clone().sub(va).divideScalar(len)));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}
/** Many rods as one mesh. Entry: [from, to, radius?]. */
const rods = (list, r, material, seg = 8) => merge(list.map(([a, b, rr]) => rodG(a, b, rr || r, seg)), material);
/** Torus geometry lying in the given plane ('xz' flat, 'xy' facing Z, 'zy' facing X). */
function torusG(R, t, plane = 'xz', x = 0, y = 0, z = 0, seg = 24, tubeSeg = 8, arc = TAU) {
  const g = new THREE.TorusGeometry(R, t, tubeSeg, seg, arc);
  if (plane === 'xz') g.rotateX(-PI / 2); else if (plane === 'zy') g.rotateY(-PI / 2);
  g.translate(x, y, z);
  return g;
}
/** Smooth tube through points. */
function tubeG(points, r, seg = 24, radial = 8, closed = false) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(q[0], q[1], q[2])), closed), seg, r, radial, closed);
}
/** Solid / shell of revolution from a profile [[radius, y], …] listed bottom → top. */
function latheG(profile, seg = 24, x = 0, y = 0, z = 0) {
  const g = new THREE.LatheGeometry(profile.map(([r, yy]) => new THREE.Vector2(Math.max(0, r), yy)), seg);
  g.translate(x, y, z);
  return g;
}
const lathe = (profile, material, seg = 24, x = 0, y = 0, z = 0) => new THREE.Mesh(latheG(profile, seg, x, y, z), material);
/** Parametric surface fn(u, v) → [x, y, z]. */
function surfG(fn, nu, nv) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const q = fn(i / nu, j / nv); pos.push(q[0], q[1], q[2]); uv.push(i / nu, j / nv); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, c = a + nu + 1; idx.push(a, c, a + 1, a + 1, c, c + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** Rescale UVs to 0..1 (the kit wood texture is not tileable). */
function unitUV(geo) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
  const sx = 1 / Math.max(1e-6, x1 - x0), sy = 1 / Math.max(1e-6, y1 - y0);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - x0) * sx, (uv.getY(i) - y0) * sy);
  return geo;
}
/** Round the corners of a closed polygon. Points: [a, b, cut?] where cut = tangent length of the rounding. */
function fillet(pts, seg = 3) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const [px, py, r = 0] = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const ux = a[0] - px, uy = a[1] - py, vx = b[0] - px, vy = b[1] - py, lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (!(r > 0) || lu < 1e-6 || lv < 1e-6) { out.push([px, py]); continue; }
    const t = Math.min(r, lu * 0.45, lv * 0.45), s = [px + (ux / lu) * t, py + (uy / lu) * t], e = [px + (vx / lv) * t, py + (vy / lv) * t];
    for (let k = 0; k <= seg; k++) { const q = k / seg, m = 1 - q; out.push([m * m * s[0] + 2 * m * q * px + q * q * e[0], m * m * s[1] + 2 * m * q * py + q * q * e[1]]); }
  }
  return out;
}
/** Extruded profile (in XY), centred on Z. */
function prismG(profile, depth, bevel = 0, steps = 1) {
  const shape = new THREE.Shape(profile.map(([a, b]) => new THREE.Vector2(a, b)));
  const dep = bevel > 0 ? Math.max(1e-3, depth - 2 * bevel) : depth;
  const geo = new THREE.ExtrudeGeometry(shape, bevel > 0
    ? { depth: dep, steps, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2 }
    : { depth: dep, steps, bevelEnabled: false });
  geo.translate(0, 0, -dep / 2);
  return unitUV(geo);
}
/** Prism from a profile [[x, y], …] extruded along Z. */
const prismZ = (profile, depth, material, bevel = 0) => new THREE.Mesh(prismG(profile, depth, bevel), material);
/** Prism from a side profile [[z, y], …] extruded along X. */
function prismXG(profile, width, bevel = 0, steps = 1) { const g = prismG(profile, width, bevel, steps); g.rotateY(-PI / 2); return g; }
const prismX = (profile, width, material, bevel = 0) => new THREE.Mesh(prismXG(profile, width, bevel), material);
/** Box whose top face (wt × dt) differs from its bottom (wb × db); bottom at y = 0; top optionally shifted in z. */
function taperG(wb, db, wt, dt, h, x = 0, y0 = 0, z = 0, zShift = 0) {
  const g = new THREE.BoxGeometry(1, 1, 1), pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const top = pos.getY(i) > 0;
    pos.setXYZ(i, pos.getX(i) * (top ? wt : wb) + x, (top ? h : 0) + y0, pos.getZ(i) * (top ? dt : db) + z + (top ? zShift : 0));
  }
  g.computeVertexNormals();
  return g;
}
const taper = (wb, db, wt, dt, h, material, x, y0, z, zShift) => new THREE.Mesh(taperG(wb, db, wt, dt, h, x, y0, z, zShift), material);
/** Tyres + rims for a list of wheel centres (axis along X). */
function wheelSet(g, spots, r, t, rimM = K.metal('#b9bdc2', { roughness: 0.35, metalness: 0.8 })) {
  const ty = [], rim = [];
  for (const [x, y, z] of spots) {
    ty.push(xCylG(r, t, x, y, z, 20), xCylG(r * 0.2, t + 0.02, x, y, z, 10));
    rim.push(xCylG(r * 0.64, t + 0.012, x, y, z, 14));
  }
  g.add(merge(ty, rubber()), merge(rim, rimM));
}
/** Small fire: glowing cones + one lamp light. Not part of the fitted box. */
function fire(g, x, y, z, r, hgt) {
  const mk = (geo, m) => { const f = ns(new THREE.Mesh(geo, m)); f.userData.noFit = true; g.add(f); };
  const cone = (rr, hh, dx, dz) => { const c = new THREE.ConeGeometry(rr, hh, 7); c.translate(x + dx, y + hh / 2, z + dz); return c; };
  mk(mergeGeometries([cone(r * 0.55, hgt, 0, 0), cone(r * 0.4, hgt * 0.7, r * 0.45, r * 0.1), cone(r * 0.4, hgt * 0.62, -r * 0.4, -r * 0.2), cone(r * 0.32, hgt * 0.5, 0.05 * r, r * 0.5)]), K.glow('#ff8a2b', 1.6));
  mk(cone(r * 0.3, hgt * 0.6, 0, 0), K.glow('#ffd76a', 2));
  g.add(K.lampLight('#ff9a4a', 1.4, 5, x, y + hgt * 0.6, z));
}
/** Scale + centre `inner` so that its bounding box is exactly w × d × h; returns the wrapper group. */
function fit(inner, w, d, h, mode = {}) {
  const out = new THREE.Group(), b = new THREE.Box3(), t = new THREE.Box3();
  out.add(inner);
  inner.updateMatrixWorld(true);
  // mean of the loose (transformed geometry boxes) and the exact (per-vertex) bounds, so that either measure agrees within mm
  const v = new THREE.Vector3(), e = new THREE.Box3();
  inner.traverse((o) => {
    if (!o.isMesh || o.userData.noFit) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    b.union(t.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) e.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
  if (b.isEmpty() || !Number.isFinite(e.min.x + e.max.x + e.min.y + e.max.y + e.min.z + e.max.z)) return out;
  b.min.add(e.min).multiplyScalar(0.5); b.max.add(e.max).multiplyScalar(0.5);
  const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  const sx = mode.freeXZ ? 1 : w / Math.max(1e-6, s.x), sz = mode.freeXZ ? 1 : d / Math.max(1e-6, s.z), sy = mode.top ? 1 : h / Math.max(1e-6, s.y);
  inner.scale.set(sx, sy, sz);
  inner.position.set(-c.x * sx, mode.top ? h - b.max.y : -b.min.y * sy, -c.z * sz);
  return out;
}

// ───────────────────────── 2D helpers (cm) ─────────────────────────
function poly(ctx, pts, fill, stroke = INK, lw = 1, closed = true) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (closed) ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
/** Rect centred at (cx, cy). */
const rect = (ctx, cx, cy, w, h, fill, stroke = INK, lw = 1, r = 0) => K.fillRR(ctx, cx, cy, Math.max(0, w), Math.max(0, h), r, fill, stroke, lw);
const circ = (ctx, cx, cy, r, fill, stroke = INK, lw = 1) => K.fillCircle(ctx, cx, cy, Math.max(0, r), fill, stroke, lw);
const line = K.line;
function ell(ctx, cx, cy, rx, ry, fill, stroke = INK, lw = 1) {
  ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
/** n evenly spaced lines inside the rect (x0,y0)-(x1,y1); `alongX` → lines run in x. */
function hatch(ctx, x0, y0, x1, y1, n, alongX, stroke = SOFT, lw = 1) {
  ctx.beginPath();
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    if (alongX) { const y = lerp(y0, y1, t); ctx.moveTo(x0, y); ctx.lineTo(x1, y); } else { const x = lerp(x0, x1, t); ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
  }
  ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke();
}
function dashed(ctx, px, fn, on = 4, off = 3) { ctx.save(); ctx.setLineDash([on * px, off * px]); fn(); ctx.restore(); }

// ───────────────────────── registration ─────────────────────────
const dim = (v, min) => (Number.isFinite(+v) && +v > 0 ? Math.max(min, +v) : min);
function norm(a, min) {
  const s = a || {};
  return { w: dim(s.w, min), d: dim(s.d, min), h: dim(s.h, min), p: s.p && typeof s.p === 'object' ? s.p : {}, item: s.item || null };
}
/** Register a type from a table of variants: { name: { b(group, o) → fit mode?, s(ctx, o) } }. First variant = default. */
function define(type, variants, fallbackSymbol) {
  const names = Object.keys(variants);
  registerModel(type, {
    build(a) {
      const o = norm(a, 0.01); o.v = pick(o.p.variant, names);
      const g = new THREE.Group();
      return fit(g, o.w, o.d, o.h, variants[o.v].b(g, o) || {});
    },
    draw2d(ctx, a) {
      const o = norm(a, 1); o.v = pick(o.p.variant, names);
      o.px = Number.isFinite(+(a && a.px)) && +a.px > 0 ? +a.px : 1;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      (variants[o.v].s || fallbackSymbol)(ctx, o);
    },
  });
}
const seedOf = (o, salt = '') => K.rng(K.hashStr(((o.item && o.item.id) || o.v || 'x') + salt));

// ═════════════════════════ CAR ═════════════════════════
// Side profiles as fractions: z of length (front = +), y of height. Third value = corner rounding in metres.
const CAR = {
  sedan: { clear: 0.115, wr: 0.215, axF: 0.31, axR: -0.29, belt: 0.6, tum: 0.8, lampY: 0.42, tailY: 0.5,
    lower: [[-0.47, 0, 0.03], [-0.5, 0.27, 0.07], [-0.5, 0.58, 0.1], [-0.34, 0.6, 0.04], [0.21, 0.6, 0.04], [0.5, 0.5, 0.12], [0.5, 0.25, 0.07], [0.47, 0, 0.03]],
    cabin: [[-0.37, 0.56], [-0.22, 0.99, 0.16], [0.03, 1, 0.18], [0.23, 0.56]] },
  suv: { clear: 0.125, wr: 0.215, axF: 0.31, axR: -0.3, belt: 0.6, tum: 0.84, lampY: 0.47, tailY: 0.53, rails: true, cladding: true,
    lower: [[-0.47, 0, 0.03], [-0.5, 0.3, 0.07], [-0.5, 0.6, 0.08], [0.24, 0.6, 0.04], [0.5, 0.55, 0.12], [0.5, 0.28, 0.07], [0.47, 0, 0.03]],
    cabin: [[-0.49, 0.56], [-0.43, 0.985, 0.14], [0.03, 1, 0.2], [0.26, 0.56]] },
  hatchback: { clear: 0.115, wr: 0.215, axF: 0.32, axR: -0.31, belt: 0.6, tum: 0.8, lampY: 0.42, tailY: 0.5,
    lower: [[-0.46, 0, 0.03], [-0.5, 0.28, 0.07], [-0.5, 0.6, 0.08], [0.25, 0.6, 0.04], [0.5, 0.5, 0.12], [0.5, 0.25, 0.07], [0.47, 0, 0.03]],
    cabin: [[-0.49, 0.56], [-0.38, 0.99, 0.16], [0.06, 1, 0.18], [0.28, 0.56]] },
  ev: { clear: 0.105, wr: 0.225, axF: 0.33, axR: -0.31, belt: 0.6, tum: 0.78, lampY: 0.43, tailY: 0.53, ev: true,
    lower: [[-0.47, 0, 0.03], [-0.5, 0.3, 0.08], [-0.5, 0.6, 0.12], [-0.38, 0.61, 0.04], [0.27, 0.6, 0.04], [0.5, 0.48, 0.14], [0.5, 0.24, 0.08], [0.47, 0, 0.03]],
    cabin: [[-0.43, 0.56], [-0.1, 1, 0.5], [0.06, 1, 0.25], [0.31, 0.56]] },
  van: { clear: 0.1, wr: 0.17, axF: 0.33, axR: -0.3, belt: 0.52, tum: 0.94, lampY: 0.36, tailY: 0.4, decal: true,
    lower: [[-0.48, 0, 0.03], [-0.5, 0.2, 0.05], [-0.5, 0.53, 0.04], [0.33, 0.53, 0.03], [0.5, 0.42, 0.1], [0.5, 0.2, 0.06], [0.47, 0, 0.03]],
    cabin: [[-0.497, 0.5], [-0.492, 1, 0.07], [0.2, 1, 0.16], [0.4, 0.5]] },
  pickup: { clear: 0.13, wr: 0.205, axF: 0.31, axR: -0.3, belt: 0.6, tum: 0.84, lampY: 0.47, tailY: 0.5, bed: [-0.47, -0.115],
    lower: [[-0.48, 0, 0.03], [-0.5, 0.3, 0.05], [-0.5, 0.6, 0.04], [0.23, 0.6, 0.04], [0.5, 0.56, 0.12], [0.5, 0.28, 0.07], [0.47, 0, 0.03]],
    cabin: [[-0.09, 0.56], [-0.075, 0.99, 0.08], [0.05, 1, 0.16], [0.25, 0.56]] },
};

function buildCar(g, { w, d: L, h: H, p }, kind) {
  const st = CAR[kind];
  const paint = paintM(C(p.color, '#d5d9de')), trim = dark(C(p.color2, '#1d1f22')), glassM = K.mat('#17212a', { roughness: 0.08, metalness: 0.6 });
  const yb = st.clear * H, rw = Math.min(st.wr * H, 0.09 * L), ra = rw * 1.13, yBelt = st.belt * H;
  // lower body: filleted side profile with wheel arches, extruded across the width, then tapered / bulged at both ends
  const prof = st.lower.map(([z, y, r]) => [z * L, (y > 0 ? y : st.clear) * H, r]);
  const a0 = Math.asin(clamp((yb - rw) / ra, -0.9, 0.9));
  for (const zc of [st.axF * L, st.axR * L]) for (let i = 0; i <= 8; i++) { const a = a0 + (PI - 2 * a0) * (i / 8); prof.push([zc + ra * Math.cos(a), rw + ra * Math.sin(a), 0]); }
  let geo = prismXG(fillet(prof, 3), w, Math.min(0.055, w * 0.035), 6);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    const y = pos.getY(i), e = smooth((Math.abs(z) / (L / 2) - 0.55) / 0.45), k = (2 * x) / w;
    z -= Math.sign(z) * 0.035 * L * k * k * e;
    x *= 1 - 0.07 * e * e - 0.06 * clamp((0.26 * H - y) / Math.max(1e-3, 0.26 * H - yb), 0, 1);
    pos.setXYZ(i, x, y, z);
  }
  g.add(new THREE.Mesh(toCreasedNormals(geo, 0.7), paint));
  g.add(box(w * 0.8, rw * 1.5, L * 0.86, dark('#111214'), 0, yb + 0.01 + rw * 0.75, 0));
  // cabin
  const wc = w * 0.9, cab = st.cabin.map(([z, y, r]) => [z * L, y * H, r]), [P0, P1, P2, P3] = cab;
  const hw = (y) => (wc / 2) * lerp(1, st.tum, clamp((y - yBelt) / (H - yBelt), 0, 1));
  const tumble = (gg) => { const q = gg.attributes.position; for (let i = 0; i < q.count; i++) q.setX(i, q.getX(i) * lerp(1, st.tum, clamp((q.getY(i) - yBelt) / (H - yBelt), 0, 1))); return toCreasedNormals(gg, 0.7); };
  const outline = fillet(cab, 4);
  g.add(new THREE.Mesh(tumble(prismXG(outline, wc, 0.035, 2)), st.decal ? paint : glassM));
  const along = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  if (!st.decal) {
    const yCut = lerp(yBelt, H, 0.86), top = outline.filter((q) => q[1] >= yCut), zc = (P1[0] + P2[0]) / 2;
    if (top.length > 2) g.add(new THREE.Mesh(tumble(prismXG(top.map(([z, y]) => [z + (z - zc) * 0.012, y + 0.006]), wc * 1.035, 0.012, 2)), paint));
    const pil = [];
    for (const s of [-1, 1]) {
      const A = along(P3, P2, 0.84), Cc = along(P0, P1, 0.84), zB = lerp(P0[0], P3[0], kind === 'pickup' ? 0.5 : 0.47);
      pil.push([[s * hw(P3[1]) * 0.985, P3[1], P3[0] - 0.01], [s * hw(A[1]) * 0.985, A[1], A[0] - 0.01], 0.032]);
      pil.push([[s * hw(P0[1]) * 0.985, P0[1], P0[0] + 0.01], [s * hw(Cc[1]) * 0.985, Cc[1], Cc[0] + 0.01], 0.036]);
      pil.push([[s * hw(yBelt), yBelt, zB], [s * hw(H * 0.95), H * 0.95, zB - 0.01], 0.03]);
      if (kind === 'suv' || kind === 'hatchback') pil.push([[s * hw(yBelt), yBelt, lerp(P0[0], P3[0], 0.16)], [s * hw(H * 0.95), H * 0.95, lerp(P0[0], P3[0], 0.2)], 0.03]);
    }
    g.add(rods(pil, 0.03, paint, 4));
  } else {
    // painted cabin with glass panels: windscreen, front side windows, rear window
    const vz = P2[0] - P3[0], vy = P2[1] - P3[1], vl = Math.hypot(vz, vy), mid = along(P3, P2, 0.52);
    g.add(rot(box(hw(mid[1]) * 1.78, vl * 0.72, 0.012, glassM, 0, mid[1] - (vz / vl) * 0.012, mid[0] + (vy / vl) * 0.012), Math.atan2(vz, vy)));
    const ym = lerp(yBelt, H, 0.52), wh = (H - yBelt) * 0.5, tilt = Math.atan2((hw(yBelt) - hw(H)), H - yBelt);
    for (const s of [-1, 1]) {
      g.add(rot(box(0.012, wh, 0.2 * L, glassM, s * (hw(ym) + 0.004), ym + 0.02 * H, P2[0] - 0.115 * L), 0, 0, s * tilt));
      g.add(rot(box(0.012, wh, 0.26 * L, glassM, s * (hw(ym) + 0.004), ym + 0.02 * H, P2[0] - 0.37 * L), 0, 0, s * tilt));
    }
    g.add(box(wc * 0.74, wh * 0.9, 0.012, glassM, 0, ym + 0.03 * H, P0[0] - 0.003));
    g.add(box(0.01, (H - yb) * 0.86, 0.01, trim, 0, lerp(yb, H, 0.5), -L / 2 - 0.001));
  }
  // lamps, grille, plates
  const nose = (x) => L / 2 - 0.035 * L * ((2 * x) / w) ** 2, yaw = Math.atan((0.14 * L * 0.33) / w);
  const head = lit('#f2f5f8', 0.3), tail = lit('#a81c24', 0.45), plate = K.mat('#f0f0ea', { roughness: 0.5 });
  for (const s of [-1, 1]) {
    const x = s * 0.33 * w, tall = kind === 'van';
    g.add(rot(rbox(0.2 * w, 0.065 * H, 0.05, head, x, st.lampY * H, nose(x) - 0.018, 0.015, 2), 0, s * yaw, 0));
    g.add(rot(rbox(tall ? 0.07 * w : 0.2 * w, tall ? 0.2 * H : 0.06 * H, 0.05, tail, tall ? s * 0.4 * w : x, st.tailY * H, -(nose(x) - 0.018) + (tall ? -0.01 : 0), 0.015, 2), 0, -s * yaw, 0));
    g.add(rbox(0.07, 0.065, 0.11, st.decal ? trim : paint, s * (hw(yBelt) + 0.075), yBelt + 0.05 * H, P3[0] - 0.035 * L, 0.02, 2));
  }
  if (st.ev) g.add(box(0.46 * w, 0.014, 0.02, head, 0, st.lampY * H + 0.005, L / 2 - 0.006));
  else g.add(box(0.36 * w, 0.075 * H, 0.03, trim, 0, st.lampY * H - 0.015 * H, L / 2 - 0.012));
  g.add(box(0.62 * w, 0.06 * H, 0.03, trim, 0, yb + 0.075 * H, L / 2 - 0.013), box(0.7 * w, 0.05 * H, 0.03, trim, 0, yb + 0.065 * H, -L / 2 + 0.013));
  g.add(box(0.3, 0.07, 0.012, plate, 0, yb + 0.16 * H, L / 2 - 0.004), box(0.3, 0.07, 0.012, plate, 0, st.tailY * H - 0.1 * H, -L / 2 + 0.004));
  // door seams + handles
  const zA = Math.min(P3[0] - 0.01 * L, st.axF * L - ra - 0.04), zC = Math.max(st.bed ? P0[0] : P0[0] + 0.05 * L, st.axR * L + ra + 0.04), zB = lerp(zC, zA, 0.5);
  const seams = [], hnd = [], sh = yBelt - yb - 0.1;
  for (const s of [-1, 1]) {
    const x = s * (w / 2 + 0.001);
    for (const z of [zA, zB, zC]) seams.push([0.004, sh, 0.008, x, yb + 0.06 + sh / 2, z]);
    hnd.push([0.014, 0.022, 0.11, x, yBelt - 0.07 * H, zB + 0.09], [0.014, 0.022, 0.11, x, yBelt - 0.07 * H, zC + 0.09]);
  }
  g.add(boxes(seams, dark('#2c2e31')), boxes(hnd, inox()));
  if (st.cladding) {
    const cl = [boxG(0.012, 0.09 * H, st.axF * L - st.axR * L - 2 * ra, w / 2, yb + 0.05 * H, (st.axF + st.axR) * L / 2), boxG(0.012, 0.09 * H, st.axF * L - st.axR * L - 2 * ra, -w / 2, yb + 0.05 * H, (st.axF + st.axR) * L / 2)];
    for (const s of [-1, 1]) for (const zc of [st.axF * L, st.axR * L]) cl.push(torusG(ra, 0.028, 'zy', s * (w / 2 - 0.015), rw, zc, 12, 5, PI));
    g.add(merge(cl, trim));
  }
  if (st.rails) g.add(rods([-1, 1].map((s) => [[s * hw(H) * 0.86, H + 0.03, P1[0] + 0.06 * L], [s * hw(H) * 0.86, H + 0.03, P2[0] - 0.04 * L]]), 0.016, dark('#2a2c2f'), 6));
  if (st.bed) {
    const z0 = st.bed[0] * L, z1 = st.bed[1] * L;
    g.add(box(w * 0.8, 0.012, z1 - z0, dark('#222427'), 0, yBelt + 0.004, (z0 + z1) / 2), box(w * 0.86, 0.01, 0.012, dark('#2c2e31'), 0, yBelt - 0.12 * H, -L / 2 - 0.001));
  }
  const tw = clamp(0.115 * w, 0.12, 0.26), xw = w / 2 - tw / 2 - 0.012;
  wheelSet(g, [[xw, rw, st.axF * L], [-xw, rw, st.axF * L], [xw, rw, st.axR * L], [-xw, rw, st.axR * L]], rw, tw);
}

function carSym(ctx, { w, d: L, p, px }, kind) {
  const st = CAR[kind], col = C(p.color, '#d5d9de'), hw = w / 2, hl = L / 2, e = 0.02 * L;
  ctx.beginPath();
  ctx.moveTo(-hw * 0.6, hl - e); ctx.quadraticCurveTo(0, hl + e, hw * 0.6, hl - e);
  ctx.bezierCurveTo(hw * 0.95, hl - 2 * e, hw, hl - 0.07 * L, hw, hl - 0.2 * L); ctx.lineTo(hw, -hl + 0.2 * L);
  ctx.bezierCurveTo(hw, -hl + 0.06 * L, hw * 0.95, -hl + 1.6 * e, hw * 0.6, -hl + 0.8 * e); ctx.quadraticCurveTo(0, -hl - 0.8 * e, -hw * 0.6, -hl + 0.8 * e);
  ctx.bezierCurveTo(-hw * 0.95, -hl + 1.6 * e, -hw, -hl + 0.06 * L, -hw, -hl + 0.2 * L); ctx.lineTo(-hw, hl - 0.2 * L);
  ctx.bezierCurveTo(-hw, hl - 0.07 * L, -hw * 0.95, hl - 2 * e, -hw * 0.6, hl - e); ctx.closePath();
  ctx.fillStyle = K.tint(col, 0.3); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke();
  const [P0, P1, P2, P3] = st.cabin.map((q) => q[0] * L), gw = hw * 0.84, rw = hw * 0.7;
  if (st.bed) rect(ctx, 0, (st.bed[0] + st.bed[1]) * L / 2, w * 0.8, (st.bed[1] - st.bed[0]) * L, K.tint(col, 0.05), SOFT, px, 2);
  poly(ctx, [[-gw, P3 - 0.02 * L], [-rw * 0.95, P3], [rw * 0.95, P3], [gw, P3 - 0.02 * L], [gw, P0 + 0.02 * L], [rw * 0.95, P0], [-rw * 0.95, P0], [-gw, P0 + 0.02 * L]], 'rgba(62,84,104,0.62)', INK, px);
  rect(ctx, 0, (P1 + P2) / 2, rw * 2, Math.max(4, P2 - P1 + 0.03 * L), K.tint(col, 0.45), SOFT, px, 0.05 * w);
  for (const s of [-1, 1]) {
    ell(ctx, s * (hw + 0.035 * w), P3 - 0.03 * L, 0.05 * w, 0.025 * L, K.tint(col, 0.2), INK, px);
    line(ctx, s * gw * 0.9, P3, s * hw * 0.62, hl - 0.03 * L, SOFT, px);
    rect(ctx, s * hw * 0.62, hl - 0.035 * L, 0.2 * w, 0.02 * L, '#fff8dc', SOFT, px, 1);
    rect(ctx, s * hw * 0.62, -hl + 0.03 * L, 0.2 * w, 0.015 * L, '#d9777c', null, px, 1);
  }
}

// two-wheelers & small vehicles ------------------------------------------------
function buildMotorcycle(g, { w, d: L, h, p }) {
  const paint = paintM(C(p.color, '#b3272d')), blk = dark(C(p.color2, '#1c1d20')), R = Math.min(0.29 * h / 1.1, 0.16 * L), zf = L / 2 - R, zr = -L / 2 + R;
  g.add(merge([torusG(R - 0.055, 0.055, 'zy', 0, R, zf, 20, 8), torusG(R - 0.06, 0.06, 'zy', 0, R, zr, 20, 8)], rubber()));
  g.add(merge([xCylG(R - 0.1, 0.03, 0, R, zf, 16), xCylG(R - 0.11, 0.035, 0, R, zr, 16), xCylG(0.02, w * 0.3, 0, R, zf, 8), xCylG(0.02, w * 0.3, 0, R, zr, 8)], inox()));
  g.add(rbox(0.3, 0.2 * h, 0.26 * L, paint, 0, 0.72 * h, 0.08 * L, 0.07), rbox(0.2, 0.06 * h, 0.2 * L, paint, 0, 0.67 * h, -0.36 * L, 0.03, 2), rbox(0.14, 0.03, 0.16 * L, paint, 0, 2 * R + 0.03, zf - 0.02, 0.012, 2));
  g.add(rbox(0.28, 0.08 * h, 0.3 * L, K.leather('#22201f'), 0, 0.73 * h, -0.19 * L, 0.035, 2));
  g.add(box(0.26, 0.3 * h, 0.2 * L, blk, 0, 0.42 * h, 0.01 * L), merge([xCylG(0.09, 0.3, 0, 0.36 * h, 0.02 * L, 12), rodG([0.15, 0.3 * h, 0.02 * L], [0.17, 0.36 * h, -0.42 * L], 0.035, 10)], inox()));
  const fr = [[[0, 0.62 * h, 0.2 * L], [0, 0.3 * h, 0.12 * L]], [[0, 0.62 * h, -0.05 * L], [0, R, zr], 0.022], [[0, 0.3 * h, -0.06 * L], [0, R, zr], 0.022], [[0, 0.3 * h, 0.12 * L], [0, 0.3 * h, -0.08 * L]]];
  for (const s of [-1, 1]) fr.push([[s * 0.075, R, zf], [s * 0.075, 0.86 * h, zf - 0.17 * L], 0.022], [[s * w * 0.3, 0.9 * h, zf - 0.19 * L], [s * w * 0.36, h - 0.035, zf - 0.21 * L], 0.008]);
  fr.push([[-w / 2 + 0.06, 0.9 * h, zf - 0.19 * L], [w / 2 - 0.06, 0.9 * h, zf - 0.19 * L], 0.014]);
  g.add(rods(fr, 0.026, blk, 8));
  g.add(merge([xCylG(0.02, 0.1, -w / 2 + 0.05, 0.9 * h, zf - 0.19 * L, 8), xCylG(0.02, 0.1, w / 2 - 0.05, 0.9 * h, zf - 0.19 * L, 8), boxG(0.1, 0.07, 0.015, -w * 0.36, h - 0.035, zf - 0.21 * L), boxG(0.1, 0.07, 0.015, w * 0.36, h - 0.035, zf - 0.21 * L)], rubber()));
  g.add(mesh(zCylG(0.085, 0.1, 0, 0, 0, 14), blk, 0, 0.78 * h, zf - 0.11 * L), mesh(zCylG(0.07, 0.01, 0, 0, 0, 14), lit('#f5f6f0', 0.4), 0, 0.78 * h, zf - 0.11 * L + 0.052));
  g.add(box(0.16, 0.1, 0.01, K.mat('#f0f0ea'), 0, 0.6 * h, -L / 2 + 0.06), box(0.1, 0.04, 0.03, lit('#a81c24', 0.5), 0, 0.68 * h, -0.465 * L));
}

function buildBicycle(g, { w, d: L, h, p }, electric) {
  const paint = paintM(C(p.color, '#2f6f8f')), blk = dark('#1c1d20'), R = Math.min(0.335 * h / 1.05, 0.2 * L), zf = L / 2 - R, zr = -L / 2 + R;
  g.add(merge([torusG(R - 0.018, 0.018, 'zy', 0, R, zf, 24, 6), torusG(R - 0.018, 0.018, 'zy', 0, R, zr, 24, 6)], rubber()));
  const sp = [];
  for (const zc of [zf, zr]) for (let i = 0; i < 8; i++) { const a = (i / 8) * PI; sp.push([[0, R + Math.sin(a) * (R - 0.03), zc + Math.cos(a) * (R - 0.03)], [0, R - Math.sin(a) * (R - 0.03), zc - Math.cos(a) * (R - 0.03)]]); }
  g.add(rods(sp, 0.003, inox(), 3), merge([torusG(R - 0.04, 0.008, 'zy', 0, R, zf, 24, 4), torusG(R - 0.04, 0.008, 'zy', 0, R, zr, 24, 4), xCylG(0.02, 0.1, 0, R, zf, 8), xCylG(0.02, 0.12, 0, R, zr, 8)], inox()));
  const BB = [0, 0.27 * h, -0.04 * L], ST = [0, 0.74 * h, -0.13 * L], HT = [0, 0.8 * h, 0.2 * L], HB = [0, 0.66 * h, 0.215 * L], RA = [0, R, zr], FA = [0, R, zf];
  g.add(rods([[BB, ST], [ST, HT, 0.016], [BB, HB, electric ? 0.035 : 0.02], [ST, RA, 0.01], [BB, RA, 0.011], [HT, HB, 0.02], [HB, FA, 0.014]], 0.017, paint, 8));
  g.add(rods([[ST, [0, 0.86 * h, -0.145 * L], 0.012], [HT, [0, h - 0.03, 0.185 * L], 0.013], [[-w / 2 + 0.05, h - 0.02, 0.18 * L], [w / 2 - 0.05, h - 0.02, 0.18 * L], 0.011], [[-0.09, 0.27 * h, -0.04 * L], [0.09, 0.27 * h, -0.04 * L], 0.012], [[0.08, 0.27 * h, -0.04 * L], [0.08, 0.14 * h, -0.02 * L], 0.008], [[-0.08, 0.27 * h, -0.04 * L], [-0.08, 0.4 * h, -0.06 * L], 0.008]], 0.012, inox(), 6));
  g.add(merge([xCylG(0.016, 0.1, -w / 2 + 0.05, h - 0.02, 0.18 * L, 8), xCylG(0.016, 0.1, w / 2 - 0.05, h - 0.02, 0.18 * L, 8), boxG(0.09, 0.015, 0.06, 0.125, 0.14 * h, -0.02 * L), boxG(0.09, 0.015, 0.06, -0.125, 0.4 * h, -0.06 * L), xCylG(0.09, 0.006, 0.05, 0.27 * h, -0.04 * L, 14)], blk));
  g.add(rbox(0.14, 0.05, 0.26, K.leather('#2a2523'), 0, 0.875 * h, -0.15 * L, 0.02, 2));
  if (electric) g.add(box(0.08, 0.03, 0.4, blk, 0, R * 2 + 0.06, zr + 0.02), rods([[[0, R * 2 + 0.05, zr - 0.15], RA], [[0, R * 2 + 0.05, zr + 0.2], ST]], 0.007, inox(), 5));
}

function buildScooter(g, { w, d: L, h, p }) {
  const paint = alu(C(p.color, '#2b2d31')), acc = K.mat(C(p.color3, '#e0552b'), { roughness: 0.5 }), R = clamp(0.09 * L, 0.07, 0.13), zf = L / 2 - R, zr = -L / 2 + R;
  g.add(merge([xCylG(R, 0.05, 0, R, zf, 18), xCylG(R, 0.05, 0, R, zr, 18)], rubber()), merge([xCylG(R * 0.55, 0.056, 0, R, zf, 12), xCylG(R * 0.55, 0.056, 0, R, zr, 12)], acc));
  g.add(rbox(Math.min(w, 0.17), 0.05, L - 4 * R + 0.1, paint, 0, R + 0.03, -0.03 * L, 0.02, 2), box(Math.min(w, 0.17) * 0.86, 0.004, L - 4 * R, rubber(), 0, R + 0.057, -0.03 * L));
  g.add(rods([[[0, R, zf], [0, R * 2.2, zf - 0.03 * L], 0.024], [[0, R * 2.2, zf - 0.03 * L], [0, h - 0.03, zf - 0.1 * L], 0.022], [[-w / 2 + 0.06, h - 0.02, zf - 0.1 * L], [w / 2 - 0.06, h - 0.02, zf - 0.1 * L], 0.013]], 0.02, paint, 8));
  g.add(merge([xCylG(0.018, 0.11, -w / 2 + 0.055, h - 0.02, zf - 0.1 * L, 8), xCylG(0.018, 0.11, w / 2 - 0.055, h - 0.02, zf - 0.1 * L, 8), boxG(0.07, 0.012, 2.4 * R, 0, 2 * R + 0.02, zr)], rubber()));
  g.add(box(0.05, 0.03, 0.02, lit('#f5f6f0', 0.4), 0, h * 0.62, zf - 0.065 * L + 0.03));
}

function buildGolfCart(g, { w, d: L, h, p }) {
  const paint = paintM(C(p.color, '#f1f1ee')), roofM = K.plastic(C(p.color2, '#f4f3ef')), seat = K.leather(C(p.color3, '#d9cdb8')), blk = dark();
  const R = Math.min(0.22, 0.13 * h), yd = R + 0.06, sh = Math.min(0.42 * h, 0.72);
  wheelSet(g, [[w / 2 - 0.09, R, 0.36 * L], [-w / 2 + 0.09, R, 0.36 * L], [w / 2 - 0.09, R, -0.34 * L], [-w / 2 + 0.09, R, -0.34 * L]], R, 0.16);
  g.add(box(w * 0.86, 0.1, L * 0.94, blk, 0, yd, 0));
  g.add(mesh(toCreasedNormals(prismXG(fillet([[0.2 * L, yd], [0.2 * L, yd + 0.42 * sh, 0.04], [0.3 * L, yd + 0.62 * sh, 0.08], [0.5 * L, yd + 0.4 * sh, 0.1], [0.5 * L, yd, 0.04]], 3), w * 0.96, 0.04), 0.7), paint));
  g.add(mesh(toCreasedNormals(prismXG(fillet([[-0.5 * L, yd], [-0.5 * L, yd + 0.5 * sh, 0.06], [-0.2 * L, yd + 0.62 * sh, 0.05], [-0.06 * L, yd + 0.62 * sh, 0.03], [-0.06 * L, yd]], 3), w * 0.96, 0.04), 0.7), paint));
  g.add(rbox(w * 0.84, 0.1, 0.2 * L, seat, 0, yd + 0.62 * sh + 0.05, -0.15 * L, 0.035, 2), rot(rbox(w * 0.84, 0.36, 0.08, seat, 0, yd + 0.62 * sh + 0.3, -0.265 * L, 0.03, 2), -0.16));
  g.add(rbox(w, 0.06, 0.74 * L, roofM, 0, h - 0.03, -0.03 * L, 0.025, 2));
  const posts = [];
  for (const s of [-1, 1]) posts.push([[s * w * 0.42, yd + 0.55 * sh, 0.3 * L], [s * w * 0.44, h - 0.05, 0.22 * L]], [[s * w * 0.44, yd + 0.5 * sh, -0.4 * L], [s * w * 0.44, h - 0.05, -0.36 * L]]);
  g.add(rods(posts, 0.02, blk, 6));
  g.add(ns(mesh(surfG((u, v) => [lerp(-0.42, 0.42, u) * w, lerp(yd + 0.56 * sh, h - 0.08, v), lerp(0.3, 0.225, v) * L], 1, 1), clear('#cfe3ea', 0.3))));
  g.add(rods([[[w * 0.2, yd + 0.5 * sh, 0.22 * L], [w * 0.2, yd + 0.85 * sh, 0.1 * L]]], 0.014, blk, 6), rot(mesh(torusG(0.16, 0.014, 'xz', 0, 0, 0, 16, 5), blk, w * 0.2, yd + 0.86 * sh, 0.095 * L), 1.0));
  g.add(box(0.14, 0.06, 0.02, lit('#f5f6f0', 0.3), w * 0.3, yd + 0.3 * sh, 0.5 * L - 0.01), box(0.14, 0.06, 0.02, lit('#f5f6f0', 0.3), -w * 0.3, yd + 0.3 * sh, 0.5 * L - 0.01));
}

function buildKalnoit(g, { w, d: L, h, p }) {
  const paint = paintM(C(p.color, '#b3272d')), seat = K.leather(C(p.color3, '#2a2928')), blk = dark(), roofed = h > 1.42, hs = roofed ? Math.min(1.12, h * 0.7) : h;
  const R = clamp(0.11 * hs, 0.09, 0.15), yd = R + 0.05;
  wheelSet(g, [[w / 2 - 0.05, R, 0.37 * L], [-w / 2 + 0.05, R, 0.37 * L], [w / 2 - 0.05, R, -0.36 * L], [-w / 2 + 0.05, R, -0.36 * L]], R, 0.085);
  g.add(rbox(w * 0.78, 0.09, 0.9 * L, blk, 0, yd, 0, 0.03, 2), box(w * 0.6, 0.006, 0.34 * L, rubber(), 0, yd + 0.047, 0.08 * L));
  g.add(rbox(w * 0.92, 0.26 * hs, 0.38 * L, paint, 0, yd + 0.13 * hs, -0.3 * L, 0.06, 2), rbox(w * 0.74, 0.3 * hs, 0.2 * L, paint, 0, yd + 0.13 * hs, 0.4 * L, 0.06, 2));
  g.add(cylOn(0.035, 0.035, 0.2 * hs, inox(), 0, yd + 0.24 * hs, -0.24 * L, 10));
  const sy = yd + 0.44 * hs;
  g.add(rbox(w * 0.74, 0.09, 0.34 * L, seat, 0, sy + 0.04, -0.2 * L, 0.035, 2), rot(rbox(w * 0.7, hs - sy - 0.1, 0.08, seat, 0, sy + (hs - sy) / 2 + 0.01, -0.39 * L, 0.035, 2), -0.1));
  const arms = [];
  for (const s of [-1, 1]) arms.push([[s * w * 0.4, sy + 0.04, -0.36 * L], [s * w * 0.4, sy + 0.22, -0.34 * L]], [[s * w * 0.4, sy + 0.22, -0.34 * L], [s * w * 0.4, sy + 0.22, -0.1 * L], 0.022]);
  arms.push([[0, yd + 0.2 * hs, 0.38 * L], [0, 0.8 * hs, 0.25 * L], 0.025], [[-w * 0.3, 0.8 * hs, 0.25 * L], [w * 0.3, 0.8 * hs, 0.25 * L], 0.014]);
  g.add(rods(arms, 0.014, blk, 6), rbox(0.2, 0.08, 0.1, blk, 0, 0.8 * hs + 0.02, 0.255 * L, 0.02, 2));
  const by = 0.52 * hs, bz = 0.43 * L;
  g.add(boxes([[w * 0.5, 0.012, 0.2, 0, by, bz], [w * 0.5, 0.16, 0.012, 0, by + 0.08, bz + 0.1], [w * 0.5, 0.16, 0.012, 0, by + 0.08, bz - 0.1], [0.012, 0.16, 0.2, w * 0.25, by + 0.08, bz], [0.012, 0.16, 0.2, -w * 0.25, by + 0.08, bz]], dark('#3a3c40')));
  g.add(mesh(zCylG(0.05, 0.02, 0, 0, 0, 12), lit('#f5f6f0', 0.4), 0, yd + 0.2 * hs, 0.5 * L));
  if (roofed) {
    g.add(rbox(w, 0.05, 0.92 * L, K.plastic(C(p.color2, '#e9e8e4')), 0, h - 0.025, -0.02 * L, 0.02, 2));
    const ps = [];
    for (const s of [-1, 1]) ps.push([[s * w * 0.44, yd, 0.42 * L], [s * w * 0.46, h - 0.04, 0.36 * L]], [[s * w * 0.46, yd + 0.2 * hs, -0.46 * L], [s * w * 0.46, h - 0.04, -0.44 * L]]);
    g.add(rods(ps, 0.016, blk, 6));
    g.add(ns(mesh(surfG((u, v) => [lerp(-0.44, 0.44, u) * w, lerp(0.86 * hs, h - 0.06, v), lerp(0.405, 0.362, v) * L], 1, 1), clear('#cfe3ea', 0.3))));
  }
}

function smallVehicleSym(ctx, { w, d: L, p, px, v }) {
  const col = C(p.color, v === 'motorcycle' || v === 'kalnoit' ? '#b3272d' : v === 'golf-cart' ? '#f1f1ee' : '#2f6f8f'), tint = K.tint(col, 0.3);
  if (v === 'golf-cart' || v === 'kalnoit') {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) rect(ctx, sx * (w / 2 - 0.07 * w), sy * 0.35 * L, 0.14 * w, 0.16 * L, '#3a3c40', null, px, 0.03 * w);
    rect(ctx, 0, 0, w * 0.88, L, tint, INK, px, 0.14 * w);
    rect(ctx, 0, -0.2 * L, w * 0.74, 0.26 * L, K.tint(C(p.color3, '#d9cdb8'), 0.3), INK, px, 0.05 * w);
    line(ctx, -w * 0.37, -0.3 * L, w * 0.37, -0.3 * L, SOFT, px);
    if (v === 'golf-cart') { circ(ctx, w * 0.2, 0.1 * L, 0.11 * w, null, INK, px); dashed(ctx, px, () => rect(ctx, 0, -0.03 * L, w, 0.74 * L, null, SOFT, px, 0.05 * w)); }
    else { line(ctx, -w * 0.3, 0.25 * L, w * 0.3, 0.25 * L, INK, 1.5 * px); rect(ctx, 0, 0.43 * L, w * 0.5, 0.14 * L, null, INK, px, 1); }
    return;
  }
  const tw = v === 'motorcycle' ? 0.16 * w : Math.max(0.06 * w, 1.5 * px), R = v === 'e-scooter' ? 0.09 * L : 0.17 * L;
  rect(ctx, 0, L / 2 - R, tw, 2 * R, '#3a3c40', null, px, tw / 2); rect(ctx, 0, -L / 2 + R, tw, 2 * R, '#3a3c40', null, px, tw / 2);
  if (v === 'motorcycle') { ell(ctx, 0, 0.06 * L, 0.2 * w, 0.14 * L, tint, INK, px); rect(ctx, 0, -0.2 * L, 0.3 * w, 0.3 * L, '#55514d', INK, px, 0.1 * w); }
  else if (v === 'e-scooter') rect(ctx, 0, -0.03 * L, Math.min(w, 17), L * 0.62, tint, INK, px, 3);
  else { line(ctx, 0, L / 2 - R, 0, -L / 2 + R, col, Math.max(2 * px, 0.05 * w)); ell(ctx, 0, -0.15 * L, 0.11 * w, 0.07 * L, '#55514d', INK, px); }
  const hy = v === 'e-scooter' ? L / 2 - R - 0.1 * L : v === 'motorcycle' ? L / 2 - R - 0.19 * L : 0.18 * L;
  line(ctx, -w / 2, hy, w / 2, hy, INK, Math.max(1.5 * px, 0.03 * w));
}

const carKind = (k) => ({ b: (g, o) => buildCar(g, o, k), s: (ctx, o) => carSym(ctx, o, k) });
define('car', {
  sedan: carKind('sedan'), suv: carKind('suv'), hatchback: carKind('hatchback'), ev: carKind('ev'), van: carKind('van'), pickup: carKind('pickup'),
  motorcycle: { b: buildMotorcycle }, bicycle: { b: (g, o) => buildBicycle(g, o, false) }, 'e-scooter': { b: buildScooter },
  'golf-cart': { b: buildGolfCart }, kalnoit: { b: buildKalnoit },
}, smallVehicleSym);

// ═════════════════════════ PERGOLA ═════════════════════════
/** Post grid of a pergola (metres): perimeter posts, extra bays for long spans, no back row when attached. */
function pergolaLayout(w, d, p, v) {
  const timber = (v === 'slatted' || v === 'wall-mounted') && !isMetal(p.material);
  const ps = v === 'louvered' ? 0.14 : v === 'gazebo' ? 0.08 : timber ? 0.12 : 0.1;
  const inset = timber ? (Math.min(w, d) > 2.2 ? 0.25 : 0.06) : v === 'gazebo' ? 0.03 : 0;
  const n = num(p.posts, 4), attached = flag(p.attached, false) || n === 2 || v === 'wall-mounted';
  const x1 = Math.max(0.001, w / 2 - inset - ps / 2), z1 = Math.max(0.001, d / 2 - inset - ps / 2), x0 = -x1, z0 = -z1;
  const nx = Math.max(n === 6 ? 2 : 1, Math.ceil((x1 - x0) / 4.6)), nz = Math.max(1, Math.ceil((z1 - z0) / 5.2)), posts = [];
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    if ((i > 0 && i < nx && j > 0 && j < nz) || (attached && j === 0)) continue;
    posts.push([lerp(x0, x1, i / nx), lerp(z0, z1, j / nz)]);
  }
  return { ps, inset, timber, attached, posts, x0, x1, z0, z1, nx, nz };
}
function curtains(g, L, top, p) {
  const m = K.fabric(C(p.color3, '#f3efe6')), geos = [], ch = top - 0.06;
  L.posts.filter(([x, z]) => Math.abs(x) > L.x1 - 0.01 && Math.abs(z) > L.z1 - 0.01).forEach(([x, z]) => {
    const cx = x - Math.sign(x) * (L.ps / 2 + 0.07), cz = z - Math.sign(z) * (L.ps / 2 + 0.02);
    geos.push(cylG(0.1, 0.04, ch * 0.55, cx, top - 0.03 - ch * 0.275, cz, 8), cylG(0.04, 0.085, ch * 0.45, cx, 0.03 + ch * 0.225, cz, 8));
  });
  g.add(merge(geos, m));
}
const postBoxes = (L, top) => L.posts.map(([x, z]) => [L.ps, top, L.ps, x, top / 2, z]);

function pergolaSlatted(g, o) {
  const { w, d, h, p, v } = o, L = pergolaLayout(w, d, p, v), list = [];
  if (L.timber) {
    const m = M(p.material, C(p.color, '#b98a5e'), 'wood'), bt = h - 0.105, bl = w - Math.min(0.1, L.inset);
    list.push(...postBoxes(L, bt));
    for (const z of [L.z0, L.z1]) {
      if (z === L.z0 && L.attached) { list.push([w, 0.19, 0.045, 0, bt - 0.095, -d / 2 + 0.0225]); continue; }
      for (const s of [-1, 1]) list.push([bl, 0.19, 0.045, 0, bt - 0.095, z + s * (L.ps / 2 + 0.0225)]);
    }
    if (h > 1.7 && L.x1 > 0.9) L.posts.forEach(([x, z]) => { for (const s of [-1, 1]) if (Math.abs(x + s * 0.5) < L.x1) list.push([0.56, 0.07, 0.07, x + s * (L.ps / 2 + 0.19), bt - 0.4, z, 0, 0, s * PI / 4]); });
    const n = Math.round(num(p.slats, Math.round(w / 0.45) + 1, 2, 80));
    for (let i = 0; i < n; i++) list.push([0.045, 0.145, d, lerp(-w / 2 + 0.0225, w / 2 - 0.0225, i / (n - 1)), h - 0.0725, 0]);
    g.add(boxes(list, m));
  } else {
    const m = M(p.material, C(p.color, '#3a3d42'), 'aluminium'), sl = [];
    list.push(...postBoxes(L, h));
    for (const s of [-1, 1]) list.push([w, 0.16, 0.05, 0, h - 0.08, s * (d / 2 - 0.025)], [0.05, 0.16, d - 0.1, s * (w / 2 - 0.025), h - 0.08, 0]);
    for (let i = 1; i < L.nx; i++) list.push([0.05, 0.16, d - 0.1, lerp(L.x0, L.x1, i / L.nx), h - 0.08, 0]);
    const n = Math.round(num(p.slats, Math.round((w - 0.1) / 0.14), 2, 90));
    for (let i = 0; i < n; i++) sl.push([0.03, 0.08, d - 0.1, lerp(-w / 2 + 0.05, w / 2 - 0.05, (i + 0.5) / n), h - 0.045, 0]);
    g.add(boxes(list, m), boxes(sl, p.color2 || p.roofColor ? alu(C(p.roofColor, C(p.color2, '#3a3d42'))) : m));
  }
  if (flag(p.curtains, false)) curtains(g, L, h - 0.2, p);
}

function pergolaLouvered(g, o) {
  const { w, d, h, p, v } = o, L = pergolaLayout(w, d, p, v), m = M(p.material, C(p.color, '#3a3d42'), 'aluminium'), list = postBoxes(L, h), bl = [];
  for (const s of [-1, 1]) list.push([w, 0.22, 0.14, 0, h - 0.11, s * (d / 2 - 0.07)], [0.14, 0.22, d - 0.28, s * (w / 2 - 0.07), h - 0.11, 0]);
  for (let i = 1; i < L.nx; i++) list.push([0.1, 0.22, d - 0.28, lerp(L.x0, L.x1, i / L.nx), h - 0.11, 0]);
  const n = Math.round(num(p.slats, Math.round((w - 0.28) / 0.2), 2, 90));
  for (let i = 0; i < n; i++) bl.push([0.2, 0.025, d - 0.28, lerp(-w / 2 + 0.14, w / 2 - 0.14, (i + 0.5) / n), h - 0.11, 0, 0, 0, 0.5]);
  g.add(boxes(list, m), boxes(bl, alu(C(p.roofColor, C(p.color2, K.shade(C(p.color, '#3a3d42'), 0.12))))));
  if (flag(p.curtains, false)) curtains(g, L, h - 0.24, p);
}

function pergolaPent(g, o) {
  const { w, d, h, p, v } = o, L = pergolaLayout(w, d, p, v), m = M(p.material, C(p.color, '#3a3d42'), 'aluminium'), poly_ = v === 'polycarbonate';
  const drop = clamp(0.035 * d, 0.05, 0.3), rt = poly_ ? 0.016 : 0.08, bt = h - drop - rt - (poly_ ? 0.1 : 0), list = postBoxes(L, bt);
  for (const s of [-1, 1]) list.push([w, 0.16, 0.06, 0, bt - 0.08, s * (d / 2 - 0.03)], [0.06, 0.16, d - 0.12, s * (w / 2 - 0.03), bt - 0.08, 0]);
  const ang = Math.atan2(drop, d), len = Math.hypot(d, drop);
  if (poly_) {
    const n = Math.max(2, Math.round(w / 0.7) + 1);
    for (let i = 0; i < n; i++) { const x = lerp(-w / 2 + 0.025, w / 2 - 0.025, i / (n - 1)); list.push([0.05, 0.1, len, x, h - drop / 2 - rt - 0.05, 0, ang], [0.06, 0.012, len, x, h - drop / 2 + 0.002, 0, ang]); }
    g.add(ns(rot(box(w, rt, len, clear(C(p.roofColor, C(p.color2, '#c9b79a')), 0.42), 0, h - drop / 2 - rt / 2 - 0.006, 0), ang)));
  } else {
    g.add(prismX([[-d / 2, h - rt], [-d / 2, h], [d / 2, h - drop], [d / 2, h - drop - rt]], w, K.lacquer(C(p.roofColor, C(p.color2, '#eceae4')))));
    list.push([w, 0.1, 0.02, 0, h - drop - rt - 0.02, d / 2 - 0.01]);
  }
  g.add(boxes(list, m));
  if (flag(p.curtains, false)) curtains(g, L, bt - 0.16, p);
}

function pergolaGazebo(g, o) {
  const { w, d, h, p, v } = o, L = pergolaLayout(w, d, p, v), m = M(p.material, C(p.color, '#3a3d42'), 'metal'), roof = cloth(C(p.roofColor, C(p.color2, '#e9e2d0')));
  const rise = clamp(0.24 * Math.min(w, d), 0.25, 0.42 * h), he = h - rise, list = postBoxes(L, he);
  for (const s of [-1, 1]) list.push([w - 0.06, 0.07, 0.04, 0, he - 0.035, s * L.z1], [0.04, 0.07, d - 0.06, s * L.x1, he - 0.035, 0]);
  g.add(boxes(list, m));
  g.add(merge([taperG(w, d, w * 0.24, d * 0.24, rise * 0.76, 0, he), taperG(w * 0.36, d * 0.36, 0.01, 0.01, rise * 0.24, 0, h - rise * 0.24)], roof));
  g.add(boxes([[w, 0.14, 0.008, 0, he - 0.07, d / 2 - 0.004], [w, 0.14, 0.008, 0, he - 0.07, -d / 2 + 0.004], [0.008, 0.14, d, w / 2 - 0.004, he - 0.07, 0], [0.008, 0.14, d, -w / 2 + 0.004, he - 0.07, 0]], roof));
  if (flag(p.curtains, false)) curtains(g, L, he - 0.14, p);
}

function pergolaFabric(g, o) {
  const { w, d, h, p, v } = o, L = pergolaLayout(w, d, p, v), m = M(p.material, C(p.color, '#3a3d42'), 'aluminium'), list = postBoxes(L, h);
  for (const s of [-1, 1]) list.push([w, 0.15, 0.05, 0, h - 0.075, s * (d / 2 - 0.025)], [0.05, 0.15, d - 0.1, s * (w / 2 - 0.025), h - 0.075, 0]);
  const n = Math.max(2, Math.round(d / 0.55));
  for (let i = 1; i < n; i++) list.push([w - 0.1, 0.02, 0.02, 0, h - 0.04, lerp(-d / 2, d / 2, i / n)]);
  g.add(boxes(list, m));
  g.add(mesh(surfG((u, t) => [lerp(-w / 2 + 0.06, w / 2 - 0.06, u), h - 0.05 - 0.11 * Math.sin(PI * n * t) ** 2, lerp(-d / 2 + 0.05, d / 2 - 0.05, t)], 1, n * 6), cloth(C(p.roofColor, C(p.color2, '#efe9dc')))));
  if (flag(p.curtains, false)) curtains(g, L, h - 0.17, p);
}

function pergolaAwning(g, o) {
  const { w, d, h, p } = o, body = K.lacquer(C(p.color, '#f1f1ee')), fab = cloth(C(p.roofColor, C(p.color2, '#e3d9c2'))), tall = h >= 1;
  const cs = tall ? 0.16 : Math.min(0.16, h * 0.55), drop = tall ? clamp(0.2 * d, 0.25, 0.7) : h - cs / 2 - 0.03, yb = h - cs / 2, yf = yb - drop, zb = -d / 2 + cs, zf = d / 2 - 0.03;
  g.add(rbox(w, cs, cs, body, 0, h - cs / 2, -d / 2 + cs / 2, 0.03, 2), box(w, 0.06, 0.06, body, 0, yf, zf));
  g.add(mesh(surfG((u, t) => [lerp(-w / 2 + 0.02, w / 2 - 0.02, u), lerp(yb, yf + 0.03, t), lerp(zb - 0.02, zf, t)], 1, 1), fab));
  const arms = [];
  for (const s of [-1, 1]) {
    const xa = s * Math.max(0.05, w / 2 - 0.3), el = [s * Math.max(0.02, w / 2 - 0.3 - Math.min(0.9, w * 0.25)), lerp(yb, yf, 0.5) - 0.05, lerp(zb, zf, 0.5)];
    arms.push([[xa, yb - cs / 2 + 0.02, zb - 0.04], el], [el, [xa, yf, zf]]);
  }
  g.add(rods(arms, 0.02, body, 6));
  if (tall) {
    g.add(box(w - 0.04, 0.16, 0.006, fab, 0, yf - 0.1, zf + 0.027));
    g.add(rods([[[w / 2 - 0.06, h - cs, zb], [w / 2 - 0.06, h - cs - 1.3, zb + 0.05]], [[w / 2 - 0.06, h - cs - 1.3, zb + 0.05], [w / 2 - 0.06, h - cs - 1.42, zb + 0.12], 0.012]], 0.006, alu('#8a8d91'), 5));
  }
  return tall ? { top: true } : {};
}

function pergolaCarport(g, o) {
  const { w, d, h, p } = o, m = M(p.material, C(p.color, '#3a3d42'), 'metal'), ps = 0.1, canti = num(p.posts, 4) === 2;
  const s = clamp(0.1 * w, 0.12, 0.45), R = ((w / 2) ** 2 + s * s) / (2 * s), half = Math.asin(clamp(w / 2 / R, 0, 1)), cy = h - R, hb = h - s - 0.05;
  const zi = Math.min(0.35, d * 0.12), nz = Math.max(num(p.posts, 4) === 6 ? 2 : 1, Math.ceil((d - 2 * zi) / 3.3)), list = [], geos = [];
  for (let j = 0; j <= nz; j++) for (const sx of canti ? [-1] : [-1, 1]) list.push([ps, hb, ps, sx * (w / 2 - ps / 2), hb / 2, lerp(-d / 2 + zi, d / 2 - zi, j / nz)]);
  for (const sx of [-1, 1]) list.push([0.06, 0.14, d, sx * (w / 2 - 0.05), hb - 0.07 + 0.04, 0]);
  if (canti) for (let j = 0; j <= nz; j++) geos.push(rodG([-w / 2 + ps, hb - 0.9, lerp(-d / 2 + zi, d / 2 - zi, j / nz)], [w * 0.15, hb + s * 0.7, lerp(-d / 2 + zi, d / 2 - zi, j / nz)], 0.035, 4));
  const nr = Math.max(2, Math.round(d / 1.0) + 1);
  for (let i = 0; i < nr; i++) { const t = new THREE.TorusGeometry(R - 0.035, 0.025, 5, 14, 2 * half); t.rotateZ(PI / 2 - half); t.translate(0, cy, lerp(-d / 2 + 0.03, d / 2 - 0.03, i / (nr - 1))); geos.push(t); }
  g.add(boxes(list, m), merge(geos, m));
  const sheet = new THREE.CylinderGeometry(R, R, d, 18, 1, true, PI - half, 2 * half); sheet.rotateX(PI / 2); sheet.translate(0, cy, 0);
  g.add(mesh(sheet, shell(C(p.roofColor, C(p.color2, '#dfe1e0')), { roughness: 0.45 })));
}

function pergolaLeanTo(g, o) {
  const { w, d, h, p, v } = o, L = pergolaLayout(w, d, p, v), m = M(p.material, C(p.color, L.timber ? '#b98a5e' : '#3a3d42'), L.timber ? 'wood' : 'aluminium');
  const drop = clamp(0.09 * d, 0.1, 0.4), ang = Math.atan2(drop, d), len = Math.hypot(d, drop) - 0.02, bt = h - drop - 0.11, list = postBoxes(L, bt);
  list.push([w, 0.19, 0.045, 0, h - 0.11, -d / 2 + 0.0225], [w - Math.min(0.1, L.inset), 0.19, 0.06, 0, bt - 0.095, L.z1]);
  const n = Math.round(num(p.slats, Math.round(w / 0.5) + 1, 2, 80));
  for (let i = 0; i < n; i++) list.push([0.045, 0.145, len, lerp(-w / 2 + 0.0225, w / 2 - 0.0225, i / (n - 1)), h - drop / 2 - 0.075, 0, ang]);
  g.add(boxes(list, m));
  if (flag(p.curtains, false)) curtains(g, L, bt - 0.2, p);
}

function pergolaSym(ctx, { w, d, p, px, v }) {
  const L = pergolaLayout(w / 100, d / 100, p, v), col = C(p.color, L.timber ? '#b98a5e' : '#3a3d42'), roof = C(p.roofColor, C(p.color2, v === 'slatted' || v === 'louvered' || v === 'wall-mounted' ? col : '#e3d9c2'));
  const solid = v === 'solid-roof' || v === 'gazebo' || v === 'fabric' || v === 'retractable-awning' || v === 'carport' || v === 'polycarbonate';
  rect(ctx, 0, 0, w, d, rgba(roof, solid ? 0.3 : 0.1), INK, px);
  const lines = (n, alongX, st = rgba(col, 0.55)) => hatch(ctx, -w / 2, -d / 2, w / 2, d / 2, Math.max(1, Math.min(n, Math.floor((alongX ? d : w) / (3.5 * px)))), alongX, st, px);
  if (v === 'slatted' || v === 'wall-mounted') lines(Math.round(num(p.slats, L.timber ? w / 45 : w / 14, 2, 90)), false);
  else if (v === 'louvered') { lines(Math.round(num(p.slats, w / 20, 2, 90)), false); rect(ctx, 0, 0, w - 28, d - 28, null, SOFT, px); }
  else if (v === 'fabric') lines(Math.max(2, Math.round(d / 55)) - 1, true);
  else if (v === 'carport') lines(Math.max(2, Math.round(d / 100)), true, SOFT);
  else if (v === 'gazebo') { for (const s of [-1, 1]) { line(ctx, -w / 2, s * d / 2, -w * 0.12, s * d * 0.12, SOFT, px); line(ctx, w / 2, s * d / 2, w * 0.12, s * d * 0.12, SOFT, px); } rect(ctx, 0, 0, w * 0.24, d * 0.24, rgba(roof, 0.5), INK, px); }
  else if (v === 'retractable-awning') { lines(Math.round(w / 50), false, SOFT); rect(ctx, 0, -d / 2 + 8, w, 16, K.tint(C(p.color, '#f1f1ee'), 0.2), INK, px); line(ctx, -w / 2, d / 2 - 3, w / 2, d / 2 - 3, INK, 2 * px); }
  else lines(Math.max(2, Math.round(w / 70)), false, SOFT);
  if (v === 'retractable-awning') return;
  if (L.attached || v === 'wall-mounted') line(ctx, -w / 2, -d / 2 + 2.5, w / 2, -d / 2 + 2.5, rgba(col, 0.9), Math.max(2 * px, 4.5));
  let posts = L.posts.map(([x, z]) => [x * 100, z * 100]);
  if (v === 'carport') { const zi = Math.min(35, d * 0.12), nz = Math.max(num(p.posts, 4) === 6 ? 2 : 1, Math.ceil((d - 2 * zi) / 330)); posts = []; for (let j = 0; j <= nz; j++) for (const s of num(p.posts, 4) === 2 ? [-1] : [-1, 1]) posts.push([s * (w / 2 - 5), lerp(-d / 2 + zi, d / 2 - zi, j / nz)]); }
  const ps = Math.max(L.ps * 100, 3 * px);
  posts.forEach(([x, y]) => rect(ctx, x, y, ps, ps, K.shade(col, -0.25), INK, px));
}

define('pergola', {
  slatted: { b: pergolaSlatted }, louvered: { b: pergolaLouvered }, 'solid-roof': { b: pergolaPent }, gazebo: { b: pergolaGazebo }, fabric: { b: pergolaFabric },
  'retractable-awning': { b: pergolaAwning }, carport: { b: pergolaCarport }, 'wall-mounted': { b: pergolaLeanTo }, polycarbonate: { b: pergolaPent },
}, pergolaSym);

// ═════════════════════════ PARASOL ═════════════════════════
const canopyColor = (p, def = '#efe9dc') => C(p.canopy, C(p.color, def));
/** Open canopy (round = 8 gores, square/rect = pyramid) with valance, ribs and vent cap. Apex (cap top) at yTop. */
function canopy(g, cx, cz, cw, cd, yTop, rise, shape, fabM, ribM) {
  const sq = shape !== 'round', R = sq ? Math.SQRT2 : 1, seg = sq ? 4 : 8, ye = yTop - 0.03 - rise, geos = [];
  const mk = (geo, sx, sz, y) => { if (sq) geo.rotateY(PI / 4); geo.scale(sx, 1, sz); geo.translate(cx, y, cz); return geo; };
  geos.push(mk(new THREE.ConeGeometry(R, rise, seg, 1, true), cw / 2, cd / 2, ye + rise / 2));
  geos.push(mk(new THREE.CylinderGeometry(R, R, 0.09, seg, 1, true), cw / 2, cd / 2, ye - 0.045));
  geos.push(mk(new THREE.ConeGeometry(R, rise * 0.22 + 0.03, seg, 1, true), cw * 0.13, cd * 0.13, yTop - (rise * 0.22 + 0.03) / 2));
  g.add(mesh(mergeGeometries(geos), fabM));
  const ribs = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU, k = sq ? 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) : 1, ex = cx + Math.cos(a) * k * (cw / 2 - 0.01), ez = cz + Math.sin(a) * k * (cd / 2 - 0.01);
    ribs.push([[cx, yTop - 0.05, cz], [ex, ye - 0.012, ez]], [[cx, ye - 0.2, cz], [lerp(cx, ex, 0.5), lerp(yTop - 0.05, ye - 0.012, 0.5), lerp(cz, ez, 0.5)], 0.005]);
  }
  g.add(rods(ribs, 0.007, ribM, 4));
  return ye;
}
function parasolPole(g, o) {
  const { w, d, h, p } = o, fab = K.mat(canopyColor(p), { roughness: 0.95, side: THREE.DoubleSide, flat: true }), pole = M(p.material2, C(p.color2, isWood(p.material2) ? 'teak' : '#4a4d52'), 'aluminium');
  const rb = clamp(0.085 * Math.min(w, d), 0.16, 0.3), shape = pick(p.shape, ['round', 'square', 'rect']);
  g.add(cylOn(rb, rb, 0.07, K.stone(C(p.color3, '#8d8f92')), 0, 0, 0, 24), cylOn(0.035, 0.035, 0.3, pole, 0, 0.07, 0, 12), cylOn(0.024, 0.024, h - 0.03, pole, 0, 0, 0, 12), sphere(0.03, pole, 0, h - 0.03, 0, 10, 8));
  if (flag(p.open, true)) {
    const rise = clamp(0.17 * Math.min(w, d), 0.12, 0.7), ye = canopy(g, 0, 0, w, d, h - 0.045, rise, shape, fab, pole);
    g.add(cylOn(0.04, 0.04, 0.06, pole, 0, ye - 0.23, 0, 10));
    return {};
  }
  const len = Math.min(0.55 * Math.max(w, d), h * 0.62), y1 = h - 0.07;
  g.add(lathe([[0.1, y1 - len], [0.12, y1 - len * 0.8], [0.1, y1 - len * 0.4], [0.05, y1 - len * 0.05], [0.03, y1]], fab, 10), cylOn(0.105, 0.105, 0.03, dark('#55514d'), 0, y1 - len * 0.55, 0, 10));
  return { freeXZ: true };
}
function parasolArm(g, o) {
  const { w, d, h, p, v } = o, fab = K.mat(canopyColor(p), { roughness: 0.95, side: THREE.DoubleSide, flat: true }), fr = M(p.material2, C(p.color2, '#4a4d52'), 'aluminium'), wall = v === 'wall';
  const ms = wall ? 0.05 : 0.08, zb = -d / 2 + ms / 2, off = wall ? 0.06 : 0.14, cz = off / 2, shape = pick(p.shape, ['round', 'square', 'rect']);
  g.add(box(ms, h, ms, fr, 0, h / 2, zb), box(0.06, 0.07, cz - zb + 0.04, fr, 0, h - 0.035, (zb + cz) / 2 + 0.02));
  g.add(rods([[[0, clamp(h * 0.55, 0, h - 0.5), zb + ms / 2], [0, h - 0.06, lerp(zb, cz, 0.55)]]], 0.022, fr, 6), cylOn(0.035, 0.035, 0.1, fr, 0, h - 0.13, cz, 10));
  if (wall) g.add(boxes([[0.14, 0.07, 0.02, 0, h * 0.25, -d / 2 + 0.01], [0.14, 0.07, 0.02, 0, h * 0.8, -d / 2 + 0.01]], fr));
  else {
    const bx = Math.min(1, w), bz = Math.min(1.1, d * 0.42), st = K.stone(C(p.color3, '#8d8f92'));
    g.add(boxes([[bx, 0.05, 0.1, 0, 0.025, zb + 0.02], [0.1, 0.05, bz, 0, 0.025, -d / 2 + bz / 2]], fr), box(0.06, 0.1, 0.05, fr, 0.07, h * 0.45, zb));
    if (bx > 0.9) g.add(box(0.4, 0.06, 0.4, st, 0.27, 0.08, zb + 0.29), box(0.4, 0.06, 0.4, st, -0.27, 0.08, zb + 0.29));
  }
  if (flag(p.open, true)) canopy(g, 0, cz, w, d - off, h - 0.1, clamp(0.15 * Math.min(w, d), 0.1, 0.6), shape, fab, fr);
  else { const len = Math.min(0.5 * Math.max(w, d), h * 0.6); g.add(lathe([[0.1, h - 0.13 - len], [0.12, h - 0.13 - len * 0.8], [0.05, h - 0.16], [0.03, h - 0.12]], fab, 10, 0, 0, cz)); return { freeXZ: true }; }
  return {};
}
function sailCorners(w, d, h, tri) {
  const r = 0.045, lo = Math.max(h * 0.68, h - 1.1), x = w / 2 - r, z = d / 2 - r;
  return tri ? [[-x, h, -z], [x, lerp(lo, h, 0.5), -z], [0, lo, z]] : [[-x, h, -z], [x, lo, -z], [x, h, z], [-x, lo, z]];
}
function parasolSail(g, o) {
  const { w, d, h, p, v } = o, tri = v === 'sail-triangle', posts = sailCorners(w, d, h, tri), steel = M(p.material2, C(p.color2, '#8a8d91'), 'metal'), r = 0.045, geos = [], cab = [];
  const cxz = posts.reduce((a, q) => [a[0] + q[0] / posts.length, a[1] + q[2] / posts.length], [0, 0]);
  const corners = posts.map(([x, y, z]) => { const l = Math.hypot(cxz[0] - x, cxz[1] - z) || 1, k = Math.min(0.3, l * 0.2) / l; return [x + (cxz[0] - x) * k, y - 0.1, z + (cxz[1] - z) * k]; });
  posts.forEach(([x, y, z], i) => { geos.push(cylG(r, r, y - 0.02, x, (y - 0.02) / 2, z, 12), cylG(r * 1.9, r * 1.9, 0.012, x, 0.006, z, 12), new THREE.SphereGeometry(r, 10, 6, 0, TAU, 0, PI / 2).translate(x, y - r, z)); cab.push([[x, y - 0.08, z], corners[i]]); });
  g.add(merge(geos, steel), rods(cab, 0.005, inox(), 4));
  const fab = cloth(canopyColor(p, '#e6dfcf'));
  if (!flag(p.open, true)) { g.add(mesh(rodG(corners[0], corners[1], 0.05, 8), fab)); return {}; }
  const mix = (ws) => [0, 1, 2].map((k) => ws.reduce((s, wt, i) => s + wt * corners[i][k], 0));
  if (tri) g.add(mesh(surfG((u, t) => {
    const a = (1 - u) * (1 - t), b = u * (1 - t), c = t, q = mix([a, b, c]), k = 0.13;
    return q.map((val, i) => val + k * 4 * (a * b * (corners[2][i] - val) + b * c * (corners[0][i] - val) + c * a * (corners[1][i] - val)));
  }, 10, 10), fab));
  else g.add(mesh(surfG((u, t) => {
    const c = 0.085, uu = u + c * 4 * t * (1 - t) * (1 - 2 * u), tt = t + c * 4 * u * (1 - u) * (1 - 2 * t);
    return mix([(1 - uu) * (1 - tt), uu * (1 - tt), uu * tt, (1 - uu) * tt]);
  }, 12, 12), fab));
  return {};
}
function parasolSym(ctx, { w, d, h, p, px, v }) {
  const col = canopyColor(p, v.startsWith('sail') ? '#e6dfcf' : '#efe9dc'), fill = rgba(col, 0.42), fr = C(p.color2, '#4a4d52'), open = flag(p.open, true);
  if (v.startsWith('sail')) {
    const pts = sailCorners(w, d, h, v === 'sail-triangle').map(([x, , z]) => [x, z]), cx = pts.reduce((s, q) => s + q[0], 0) / pts.length, cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
    const inn = pts.map(([x, y]) => [lerp(x, cx, 0.1), lerp(y, cy, 0.1)]);
    if (open) {
      ctx.beginPath(); ctx.moveTo(inn[0][0], inn[0][1]);
      inn.forEach((a, i) => { const b = inn[(i + 1) % inn.length], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; ctx.quadraticCurveTo(lerp(mx, cx, 0.3), lerp(my, cy, 0.3), b[0], b[1]); });
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke();
    }
    pts.forEach((q, i) => { line(ctx, q[0], q[1], inn[i][0], inn[i][1], SOFT, px); circ(ctx, q[0], q[1], Math.max(4.5, 2 * px), K.shade(fr, -0.1), INK, px); });
    return;
  }
  const shape = pick(p.shape, ['round', 'square', 'rect']), off = v === 'cantilever' ? 14 : v === 'wall' ? 6 : 0, cy = off / 2, cd = d - off;
  if (v !== 'centre-pole') { line(ctx, 0, -d / 2 + 4, 0, cy, fr, Math.max(2 * px, 6)); rect(ctx, 0, -d / 2 + 4, 8, 8, fr, INK, px); }
  if (v === 'cantilever') { line(ctx, -Math.min(50, w / 2), -d / 2 + 6, Math.min(50, w / 2), -d / 2 + 6, fr, Math.max(px, 6)); }
  if (!open) { dashed(ctx, px, () => (shape === 'round' ? ell(ctx, 0, cy, w / 2, cd / 2, null, SOFT, px) : rect(ctx, 0, cy, w, cd, null, SOFT, px))); circ(ctx, 0, cy, 11, rgba(col, 0.9), INK, px); return; }
  if (shape === 'round') ell(ctx, 0, cy, w / 2, cd / 2, fill, INK, px); else rect(ctx, 0, cy, w, cd, fill, INK, px);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, k = shape === 'round' ? 1 : 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))); line(ctx, 0, cy, Math.cos(a) * k * w / 2, cy + Math.sin(a) * k * cd / 2, SOFT, px); }
  if (shape === 'round') ell(ctx, 0, cy, w * 0.13, cd * 0.13, rgba(col, 0.6), SOFT, px); else rect(ctx, 0, cy, w * 0.26, cd * 0.26, rgba(col, 0.6), SOFT, px);
  circ(ctx, 0, cy, Math.max(2.4, 1.5 * px), fr, null);
}
define('parasol', { 'centre-pole': { b: parasolPole }, cantilever: { b: parasolArm }, wall: { b: parasolArm }, sail: { b: parasolSail }, 'sail-triangle': { b: parasolSail } }, parasolSym);

// ═════════════════════════ LOUNGER ═════════════════════════
function buildLounger(g, o, lanes) {
  const { w, d: L, h, p } = o, mat = pick(p.material, MATS.filter((m) => m !== 'fabric' && m !== 'textile').concat(['aluminium'])) === p.material ? p.material : 'aluminium';
  const fr = M(mat, C(p.color, isWood(mat) ? 'teak' : mat === 'plastic' ? '#f1f1ee' : mat === 'rattan' ? '#8a7560' : '#3a3d42'), 'aluminium'), sling = isMetal(mat);
  const cush = flag(p.cushion, true), cm = K.fabric(C(p.color2, '#e9e2d0')), ct = cush ? 0.07 : 0, wheels = flag(p.wheels, true);
  const ft = h < 0.45 ? clamp(h * 0.8 - ct, 0.12, 0.3) : clamp(0.32 - ct * 0.3, 0.2, h * 0.5), R = Math.max(0.005, h - ft - ct - 0.02);
  const Lb = clamp(R / Math.sin(num(p.backAngle, 32, 3, 80) * PI / 180), 0.28 * L, 0.42 * L), ang = Math.asin(clamp(R / Lb, 0, 0.97)), zh = -L / 2 + 0.03 + Lb, ls = L / 2 - zh;
  const list = [], lw = w / lanes, soft = [], geo2 = [];
  for (let i = 0; i <= lanes; i++) list.push([0.035, 0.06, L, lerp(-w / 2 + 0.0175, w / 2 - 0.0175, i / lanes), ft - 0.03, 0]);
  list.push([w, 0.06, 0.035, 0, ft - 0.03, L / 2 - 0.0175], [w, 0.06, 0.035, 0, ft - 0.03, -L / 2 + 0.0175], [w - 0.07, 0.04, 0.04, 0, ft - 0.035, zh]);
  const lz = Math.min(0.25, L * 0.14), lh = ft - 0.06;
  for (const s of [-1, 1]) {
    list.push([0.04, lh, 0.05, s * (w / 2 - 0.02), lh / 2, L / 2 - lz]);
    if (!wheels) list.push([0.04, lh, 0.05, s * (w / 2 - 0.02), lh / 2, -L / 2 + lz]);
  }
  if (wheels) { const rw = Math.min(0.08, ft * 0.45); wheelSet(g, [[w / 2 - 0.025, rw, -L / 2 + lz], [-w / 2 + 0.025, rw, -L / 2 + lz]], rw, 0.035, dark(C(p.color3, '#55585c'))); list.push([w - 0.06, 0.03, 0.03, 0, rw, -L / 2 + lz], [0.04, lh - rw, 0.05, w / 2 - 0.06, rw + (lh - rw) / 2, -L / 2 + lz], [0.04, lh - rw, 0.05, -w / 2 + 0.06, rw + (lh - rw) / 2, -L / 2 + lz]); }
  // back panels are built flat (hinge at origin, head towards -z) and rotated up
  const back = new THREE.Group(); back.position.set(0, ft - 0.02, zh); back.rotation.x = ang;
  const bl = [], bsoft = [];
  for (let k = 0; k < lanes; k++) {
    const cx = -w / 2 + lw * (k + 0.5), iw = lw - 0.075;
    if (sling) { list.push([iw, 0.008, ls - 0.04, cx, ft - 0.008, zh + ls / 2]); bl.push([iw, 0.008, Lb - 0.03, cx, 0.012, -Lb / 2]); }
    else {
      const n = Math.max(2, Math.round(ls / 0.09)), nb = Math.max(2, Math.round(Lb / 0.09));
      for (let i = 0; i < n; i++) list.push([iw, 0.016, ls / n - 0.02, cx, ft - 0.008, zh + (i + 0.5) * ls / n]);
      for (let i = 0; i < nb; i++) bl.push([iw, 0.016, Lb / nb - 0.02, cx, 0.012, -(i + 0.5) * Lb / nb]);
    }
    for (const s of [-1, 1]) bl.push([0.03, 0.035, Lb, cx + s * (iw / 2 + 0.005), 0.003, -Lb / 2]);
    if (cush) {
      soft.push(new THREE.Mesh(K.rbox(iw - 0.02, ct, ls - 0.02, cm, 0, 0, 0, 0.03, 2).geometry, cm).geometry.clone().translate(cx, ft + ct / 2, zh + ls / 2));
      bsoft.push(K.rbox(iw - 0.02, ct, Lb - 0.02, cm, 0, 0, 0, 0.03, 2).geometry.clone().translate(cx, 0.02 + ct / 2, -Lb / 2));
      geo2.push(K.rbox(iw * 0.6, 0.06, 0.2, cm, 0, 0, 0, 0.028, 2).geometry.clone().translate(cx, 0.02 + ct + 0.02, -Lb + 0.14));
    }
  }
  back.add(boxes(bl, sling ? K.fabric(K.shade(C(p.color, '#3a3d42'), 0.25)) : fr));
  if (cush) { back.add(merge(bsoft, cm), merge(geo2, K.fabric(C(p.color3, K.shade(C(p.color2, '#e9e2d0'), -0.12))))); g.add(merge(soft, cm)); }
  g.add(boxes(sling ? list.filter((b) => b[1] !== 0.008) : list, fr), back);
  if (sling) g.add(boxes(list.filter((b) => b[1] === 0.008), K.fabric(K.shade(C(p.color, '#3a3d42'), 0.25))));
  if (ang > 0.12) g.add(rods([-1, 1].map((s) => [[s * (w / 2 - 0.05), ft - 0.03, zh - Lb * 0.78], [s * (w / 2 - 0.05), ft - 0.02 + Lb * 0.55 * Math.sin(ang), zh - Lb * 0.55 * Math.cos(ang)]]), 0.008, fr, 5));
}
function loungerSym(ctx, { w, d: L, h, p, px }, lanes) {
  const mat = MATS.includes(p.material) ? p.material : 'aluminium', col = C(p.color, isWood(mat) ? '#a9743f' : mat === 'plastic' ? '#f1f1ee' : '#3a3d42'), cush = flag(p.cushion, true), cc = K.tint(C(p.color2, '#e9e2d0'), 0.35);
  const Lb = clamp(0.36 * L, 0.28 * L, 0.42 * L), yh = -L / 2 + 3 + Lb, lw = w / lanes;
  rect(ctx, 0, 0, w, L, K.tint(col, 0.5), INK, px, 3);
  for (let k = 0; k < lanes; k++) {
    const cx = -w / 2 + lw * (k + 0.5), iw = lw - 7;
    if (cush) { rect(ctx, cx, (yh + L / 2) / 2, iw, L / 2 - yh - 2, cc, INK, px, 4); rect(ctx, cx, (yh - L / 2) / 2, iw, yh + L / 2 - 3, K.shade(cc, -0.05), INK, px, 4); rect(ctx, cx, -L / 2 + 14, iw * 0.6, 16, K.tint(C(p.color3, '#cfc6b2'), 0.2), INK, px, 5); }
    else { rect(ctx, cx, 0, iw, L - 6, K.tint(col, 0.65), SOFT, px, 2); hatch(ctx, cx - iw / 2, -L / 2 + 3, cx + iw / 2, L / 2 - 3, Math.min(Math.round(L / 9), Math.floor(L / (3 * px))), true, SOFT, px); line(ctx, cx - iw / 2, yh, cx + iw / 2, yh, INK, px); }
  }
}
function buildDaybed(g, o) {
  const { w, d, h, p } = o, body = M(p.material, C(p.color, isWood(p.material) ? 'teak' : isMetal(p.material) ? '#3a3d42' : '#8a7560'), 'rattan'), cm = K.fabric(C(p.color2, '#ece6d8')), ac = K.fabric(C(p.color3, '#9aa89a'));
  const can = h >= 1.6, hb = can ? Math.min(0.78, h * 0.42) : h, bh = Math.min(0.3, hb * 0.42), bt = Math.min(0.14, d * 0.12);
  g.add(box(w - 0.08, 0.05, d - 0.08, dark('#2a2725'), 0, 0.025, 0), rbox(w, bh - 0.05, d, body, 0, 0.05 + (bh - 0.05) / 2, 0, 0.025, 2));
  g.add(rbox(w, hb - bh + 0.03, bt, body, 0, bh - 0.03 + (hb - bh + 0.03) / 2, -d / 2 + bt / 2, 0.03, 2));
  for (const s of [-1, 1]) g.add(rbox(bt, (hb - bh) * 0.72 + 0.03, d * 0.62, body, s * (w / 2 - bt / 2), bh - 0.03 + ((hb - bh) * 0.72 + 0.03) / 2, -d / 2 + d * 0.31, 0.03, 2));
  const mt = Math.min(0.15, (hb - bh) * 0.45);
  g.add(rbox(w - 2 * bt - 0.02, mt, d - bt - 0.03, cm, 0, bh + mt / 2, bt / 2 + 0.005, 0.045, 2));
  const n = Math.max(2, Math.round((w - 2 * bt) / 0.52)), pw = (w - 2 * bt - 0.06) / n, ph = Math.min(0.4, (hb - bh - mt) * 0.9);
  for (let i = 0; i < n; i++) g.add(rot(rbox(pw - 0.03, ph, 0.13, i % 2 ? ac : cm, -w / 2 + bt + 0.03 + pw * (i + 0.5), bh + mt + ph / 2 - 0.02, -d / 2 + bt + 0.1, 0.05, 2), -0.22));
  if (can) {
    const pm = isWood(p.material) ? body : alu(C(p.color, '#3a3d42')), list = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) list.push([0.06, h, 0.06, sx * (w / 2 - 0.03), h / 2, sz * (d / 2 - 0.03)]);
    for (const s of [-1, 1]) list.push([w, 0.06, 0.04, 0, h - 0.03, s * (d / 2 - 0.02)], [0.04, 0.06, d, s * (w / 2 - 0.02), h - 0.03, 0]);
    g.add(boxes(list, pm), box(w - 0.06, 0.012, d - 0.06, cloth(C(p.color2, '#ece6d8')), 0, h - 0.035, 0));
    g.add(merge([-1, 1].flatMap((s) => [cylG(0.09, 0.035, (h - hb) * 0.6, s * (w / 2 - 0.12), h - 0.06 - (h - hb) * 0.3, -d / 2 + 0.1, 8), cylG(0.035, 0.07, (h - hb) * 0.36, s * (w / 2 - 0.12), hb + (h - hb) * 0.2, -d / 2 + 0.1, 8)]), cm));
  }
}
function daybedSym(ctx, { w, d, h, p, px }) {
  const body = K.tint(C(p.color, '#8a7560'), 0.45), cc = K.tint(C(p.color2, '#ece6d8'), 0.4), bt = Math.min(14, d * 0.12);
  rect(ctx, 0, 0, w, d, body, INK, px, 4);
  rect(ctx, 0, bt / 2, w - 2 * bt, d - bt - 3, cc, INK, px, 5);
  const n = Math.max(2, Math.round((w - 2 * bt) / 52)), pw = (w - 2 * bt - 6) / n;
  for (let i = 0; i < n; i++) rect(ctx, -w / 2 + bt + 3 + pw * (i + 0.5), -d / 2 + bt + 12, pw - 4, 20, i % 2 ? K.tint(C(p.color3, '#9aa89a'), 0.3) : K.shade(cc, -0.04), INK, px, 5);
  if (h >= 160) for (const sx of [-1, 1]) for (const sz of [-1, 1]) rect(ctx, sx * (w / 2 - 3), sz * (d / 2 - 3), 6, 6, K.shade(body, -0.4), INK, px);
}
function buildEgg(g, o) {
  const { w, d, h, p } = o, R = Math.min(w, d) / 2, stand = alu(C(p.color3, '#2b2d31')), Rb = R - 0.025;
  const basket = shell(C(p.color, '#a98b63'), { roughness: 0.9 }), cm = K.fabric(C(p.color2, '#ece6d8'));
  g.add(mesh(torusG(Rb, 0.025, 'xz', 0, 0.025, 0, 28, 6), stand));
  g.add(mesh(tubeG([[0, 0.03, -Rb], [0, h * 0.45, -Rb + 0.01], [0, h * 0.82, -Rb * 0.86], [0, h - 0.04, -Rb * 0.4], [0, h - 0.035, 0.02]], 0.024, 24, 7), stand));
  const yb = Math.min(0.32, h * 0.2), yt = Math.max(yb + 0.3, Math.min(h - 0.28, yb + 1.25)), re = Math.min(R * 0.84, 0.56), ry = (yt - yb) / 2, cy = (yt + yb) / 2, open = 0.78 * PI;
  const egg = new THREE.SphereGeometry(1, 18, 12, PI / 2 + open / 2, TAU - open); egg.scale(re, ry, re * 0.92); egg.translate(0, cy, 0.02);
  g.add(mesh(egg, basket));
  const rim = [];
  for (const [ph, dir] of [[PI / 2 + open / 2, 1], [PI / 2 - open / 2, -1]]) for (let i = 1; i < 9; i++) { const th = dir > 0 ? (i / 9) * PI : PI - (i / 9) * PI; rim.push([-Math.cos(ph) * Math.sin(th) * re, cy + Math.cos(th) * ry, Math.sin(ph) * Math.sin(th) * re * 0.92 + 0.02]); }
  g.add(mesh(tubeG(rim, 0.016, 40, 5, true), basket));
  g.add(rods([[[0, h - 0.05, 0.02], [0, yt - 0.01, 0.02]]], 0.007, stand, 5));
  const seat = new THREE.SphereGeometry(1, 14, 8); seat.scale(re * 0.82, 0.13, re * 0.72); seat.translate(0, yb + ry * 0.42, 0.04);
  g.add(mesh(seat, cm), rot(rbox(re * 1.15, ry * 0.75, 0.13, cm, 0, cy - ry * 0.08, -re * 0.55, 0.06, 2), -0.2));
}
function buildBeanBag(g, o) {
  const { p } = o, geo = new THREE.SphereGeometry(1, 22, 14), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i); const z = pos.getZ(i);
    y *= 0.6 + 0.4 * smooth((1 - z) / 2);
    if (y > 0) { y -= 0.26 * Math.exp(-(x * x + (z - 0.3) ** 2) / 0.2); x *= 1 - 0.1 * y; }
    pos.setXYZ(i, x, Math.max(y, -0.4), z);
  }
  geo.computeVertexNormals();
  g.add(mesh(geo, K.fabric(C(p.color, '#5f7f8f'))), box(0.3, 0.02, 0.06, K.fabric(C(p.color2, '#3a4a55')), 0, 0.93, -0.5));
}
define('lounger', {
  lounger: { b: (g, o) => buildLounger(g, o, 1), s: (c, o) => loungerSym(c, o, 1) },
  daybed: { b: buildDaybed, s: daybedSym },
  double: { b: (g, o) => buildLounger(g, o, 2), s: (c, o) => loungerSym(c, o, 2) },
  'hanging-egg': { b: buildEgg, s(ctx, { w, d, p, px }) {
    const R = Math.min(w, d) / 2; circ(ctx, 0, 0, R - 1.5, null, C(p.color3, '#2b2d31'), Math.max(px, 3));
    ell(ctx, 0, 1, R * 0.82, R * 0.78, K.tint(C(p.color, '#a98b63'), 0.4), INK, px); ell(ctx, 0, R * 0.14, R * 0.62, R * 0.52, K.tint(C(p.color2, '#ece6d8'), 0.4), INK, px);
    circ(ctx, 0, -R + 2.5, Math.max(2.5, 1.5 * px), C(p.color3, '#2b2d31'), null);
  } },
  'bean-bag': { b: buildBeanBag, s(ctx, { w, d, p, px }) {
    const col = C(p.color, '#5f7f8f'); ell(ctx, 0, 0, w / 2, d / 2, K.tint(col, 0.4), INK, px); ell(ctx, 0, d * 0.12, w * 0.3, d * 0.24, K.tint(col, 0.55), SOFT, px);
  } },
});
