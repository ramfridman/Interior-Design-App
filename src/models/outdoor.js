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

const { box, rbox, cyl, cylOn, sphere } = K;
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
/** Rounded box geometry (copy of the kit's cached one) centred at (x, y, z). */
const rboxG = (w, h, d, r, x = 0, y = 0, z = 0) => rbox(w, h, d, null, 0, 0, 0, r, 2).geometry.clone().translate(x, y, z);
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
function fire(g, x, y, z, r, hgt, light = true) {
  const mk = (geo, m) => { const f = ns(new THREE.Mesh(geo, m)); f.userData.noFit = true; g.add(f); };
  const cone = (rr, hh, dx, dz) => { const c = new THREE.ConeGeometry(rr, hh, 7); c.translate(x + dx, y + hh / 2, z + dz); return c; };
  mk(mergeGeometries([cone(r * 0.55, hgt, 0, 0), cone(r * 0.4, hgt * 0.7, r * 0.45, r * 0.1), cone(r * 0.4, hgt * 0.62, -r * 0.4, -r * 0.2), cone(r * 0.32, hgt * 0.5, 0.05 * r, r * 0.5)]), K.glow('#ff8a2b', 1.6));
  mk(cone(r * 0.3, hgt * 0.6, 0, 0), K.glow('#ffd76a', 2));
  if (light) g.add(K.lampLight('#ff9a4a', 1.4, 5, x, y + hgt * 0.6, z));
}
/** Scale + centre `inner` so that its bounding box is exactly w × d × h; returns the wrapper group. */
function fit(inner, w, d, h, mode = {}) {
  const out = new THREE.Group(), b = new THREE.Box3(), t = new THREE.Box3();
  out.add(inner);
  inner.updateMatrixWorld(true);
  // bake rotated meshes into world-space geometry so that loose (Box3.setFromObject) and exact bounds coincide
  const rotated = [];
  inner.traverse((o) => { if (o.isMesh) { const e = o.matrixWorld.elements; if (Math.abs(e[1]) + Math.abs(e[2]) + Math.abs(e[4]) + Math.abs(e[6]) + Math.abs(e[8]) + Math.abs(e[9]) > 1e-6) rotated.push(o); } });
  for (const o of rotated) { o.geometry = o.geometry.clone().applyMatrix4(o.matrixWorld); inner.add(o); o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrixWorld(true); }
  inner.traverse((o) => {
    if (!o.isMesh || o.userData.noFit) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    b.union(t.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
  });
  if (b.isEmpty() || !Number.isFinite(b.min.x + b.max.x + b.min.y + b.max.y + b.min.z + b.max.z)) return out;
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
const STYLE_MAT = { modern: 'aluminium', minimal: 'aluminium', industrial: 'metal', rustic: 'wood', classic: 'wood', boho: 'wood', scandinavian: 'wood' };
function norm(a, min, styled) {
  const s = a || {};
  let p = s.p && typeof s.p === 'object' ? s.p : {};
  // the `style` hint picks the structure material when the product does not state one
  if (styled && !MATS.includes(p.material) && STYLE_MAT[p.style]) p = { ...p, material: STYLE_MAT[p.style] };
  return { w: dim(s.w, min), d: dim(s.d, min), h: dim(s.h, min), p, item: s.item || null };
}
/** Register a type from a table of variants: { name: { b(group, o) → fit mode?, s(ctx, o) } }. First variant = default. `styled`: style hint → material. */
function define(type, variants, fallbackSymbol, styled = false) {
  const names = Object.keys(variants);
  registerModel(type, {
    build(a) {
      const o = norm(a, 0.01, styled); o.v = pick(o.p.variant, names);
      const g = new THREE.Group();
      return fit(g, o.w, o.d, o.h, variants[o.v].b(g, o) || {});
    },
    draw2d(ctx, a) {
      const o = norm(a, 1, styled); o.v = pick(o.p.variant, names);
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
}, pergolaSym, true);

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
  const { w, d: L, h, p } = o, mat = MATS.includes(p.material) && p.material !== 'fabric' && p.material !== 'textile' ? p.material : 'aluminium';
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
      soft.push(rboxG(iw - 0.02, ct, ls - 0.02, 0.03, cx, ft + ct / 2, zh + ls / 2));
      bsoft.push(rboxG(iw - 0.02, ct, Lb - 0.02, 0.03, cx, 0.02 + ct / 2, -Lb / 2));
      geo2.push(rboxG(iw * 0.6, 0.06, 0.2, 0.028, cx, 0.02 + ct + 0.02, -Lb + 0.14));
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
  g.add(mesh(geo, K.fabric(C(p.color, '#5f7f8f'))));
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
}, null, true);

// ═════════════════════════ BBQ ═════════════════════════
const archProfile = (hw, hh, n = 8) => { const pts = [[-hw, 0]]; for (let i = 0; i <= n; i++) { const a = PI - (i / n) * PI; pts.push([Math.cos(a) * hw, hh - hw + Math.sin(a) * hw]); } pts.push([hw, 0]); return pts; };
/** Grill head (firebox + knobs + hinged lid + handle) sitting on y0, total height ht. */
function grillHead(g, x, y0, gw, D, ht, open, burners, body, acc, zc = 0) {
  const fb = (open ? 0.3 : 0.4) * ht, lh = open ? 0.45 * ht : ht - fb, th = open ? Math.asin(clamp((ht - fb) / D, 0.25, 0.95)) : 0;
  g.add(mesh(taperG(gw * 0.94, D * 0.88, gw, D, fb, x, y0, zc), body), box(gw, Math.min(0.09, fb * 0.8), 0.02, body, x, y0 + fb - Math.min(0.09, fb * 0.8) / 2, zc + D / 2 + 0.008));
  const n = Math.round(num(burners, Math.round(gw / 0.2), 1, 8)), kn = [];
  for (let i = 0; i < n; i++) kn.push(zCylG(Math.min(0.022, fb * 0.2), 0.03, x + lerp(-gw / 2, gw / 2, (i + 0.5) / n), y0 + fb - Math.min(0.045, fb * 0.4), zc + D / 2 + 0.03, 10));
  g.add(merge(kn, acc));
  const lid = new THREE.Group(); lid.position.set(x, y0 + fb, zc - D / 2); lid.rotation.x = -th;
  const lg = prismXG(fillet([[0, 0], [0, lh * 0.8, lh * 0.3], [D * 0.3, lh, D * 0.2], [D * 0.62, lh, D * 0.25], [D, lh * 0.35, lh * 0.3], [D, 0]], 4), gw - 0.01, 0.008);
  lid.add(mesh(lg, body), mesh(xCylG(0.012, gw * 0.7, 0, lh * 0.3, D + 0.035, 8), acc), box(0.02, 0.02, 0.04, acc, gw * 0.3, lh * 0.3, D + 0.018), box(0.02, 0.02, 0.04, acc, -gw * 0.3, lh * 0.3, D + 0.018));
  lid.add(rot(mesh(zCylG(Math.min(0.03, lh * 0.25), 0.012, 0, 0, 0, 12), acc, 0, lh * 0.62, D * 0.9), 0.55));
  g.add(lid);
  if (open) {
    const bars = [[gw - 0.04, 0.012, D - 0.04, x, y0 + fb - 0.03, zc]], nb = Math.max(4, Math.round(gw / 0.035));
    const gr = []; for (let i = 0; i < nb; i++) gr.push([0.008, 0.008, D - 0.05, x + lerp(-gw / 2 + 0.03, gw / 2 - 0.03, i / (nb - 1)), y0 + fb - 0.012, zc]);
    g.add(boxes(bars, dark('#141414')), boxes(gr, K.metal('#55585c', { roughness: 0.5 })));
  }
}
function bbqGas(g, o) {
  const { w, d, h, p } = o, body = M(p.material, C(p.color, '#26282b'), 'metal'), cart = M(p.material2, C(p.color2, '#3a3d42'), 'metal'), acc = p.color3 ? K.metal(C(p.color3, '#c9ccd0')) : inox();
  const shelves = flag(p.sideShelves, w > 0.95), sw = shelves ? clamp(w * 0.2, 0.15, 0.34) : 0, bw = w - 2 * sw, D = d - 0.05, yc = 0.6 * h, zc = -0.02;
  g.add(box(bw * 0.94, yc - 0.1, D * 0.9, cart, 0, 0.1 + (yc - 0.1) / 2, zc));
  for (const s of [-1, 1]) g.add(box(bw * 0.45, yc - 0.16, 0.015, cart, s * bw * 0.235, 0.13 + (yc - 0.16) / 2, zc + D * 0.45 + 0.006), box(0.014, Math.min(0.2, yc * 0.3), 0.02, acc, s * 0.035, yc - 0.06 - Math.min(0.2, yc * 0.3) / 2, zc + D * 0.45 + 0.025));
  grillHead(g, 0, yc, bw, D, h - yc, p.lid === 'open', p.burners, body, acc, zc);
  if (shelves) for (const s of [-1, 1]) g.add(box(sw, 0.03, D * 0.82, cart, s * (bw / 2 + sw / 2), yc + 0.4 * (h - yc) * (p.lid === 'open' ? 0.75 : 1) - 0.015, zc), rods([[[s * bw / 2, yc - 0.05, zc], [s * (w / 2 - 0.03), yc + 0.3 * (h - yc) * 0.7, zc]]], 0.008, acc, 5));
  wheelSet(g, [[-bw * 0.47 + 0.03, 0.08, zc - D * 0.3], [-bw * 0.47 + 0.03, 0.08, zc + D * 0.3]], 0.08, 0.04, dark('#55585c'));
  g.add(boxes([[0.04, 0.1, 0.04, bw * 0.42, 0.05, zc - D * 0.38], [0.04, 0.1, 0.04, bw * 0.42, 0.05, zc + D * 0.38]], dark()));
}
function bbqKettle(g, o) {
  const { w, d, h, p } = o, enamel = K.mat(C(p.color, '#1d1e20'), { roughness: 0.25, metalness: 0.2, side: THREE.DoubleSide }), leg = inox(), R = Math.min(w, d) / 2 - 0.035, open = p.lid === 'open';
  const yc = open ? h - 1.2 * R : h - 0.07 - 0.56 * R, lidP = [[R, 0], [0.93 * R, 0.24 * R], [0.62 * R, 0.47 * R], [0.25 * R, 0.55 * R], [0, 0.56 * R]];
  g.add(lathe([[0, yc - 0.62 * R], [0.5 * R, yc - 0.54 * R], [0.86 * R, yc - 0.3 * R], [R, yc]], enamel, 24), mesh(torusG(R, 0.012, 'xz', 0, yc, 0, 24, 5), leg));
  const lid = new THREE.Group(); lid.add(lathe(lidP, enamel, 24), box(0.14, 0.02, 0.035, dark(), 0, 0.56 * R + 0.05, 0), boxes([[0.015, 0.05, 0.02, 0.05, 0.56 * R + 0.02, 0], [0.015, 0.05, 0.02, -0.05, 0.56 * R + 0.02, 0]], leg), cyl(0.045, 0.045, 0.008, leg, 0.3 * R, 0.5 * R, 0.2 * R, 10));
  if (open) { lid.rotation.x = -PI / 2; lid.position.set(0, yc + 0.2 * R, -0.4 * R); g.add(cyl(R * 0.95, R * 0.95, 0.01, K.metal('#55585c', { roughness: 0.5 }), 0, yc - 0.05, 0, 24), cyl(R * 0.8, R * 0.8, 0.03, K.mat('#2a211d', { emissive: '#ff5a1a', emissiveIntensity: 0.3 }), 0, yc - 0.2 * R, 0, 16)); }
  else lid.position.y = yc;
  g.add(lid);
  const legs = [], yl = yc - 0.5 * R;
  for (const a of [PI / 2, PI * 7 / 6, PI * 11 / 6]) legs.push([[Math.cos(a) * R * 0.55, yl, Math.sin(a) * R * 0.55], [Math.cos(a) * R * 0.95, a === PI / 2 ? 0 : 0.07, Math.sin(a) * R * 0.95]]);
  g.add(rods(legs, 0.012, leg, 6), mesh(torusG(R * 0.72, 0.006, 'xz', 0, yl * 0.45, 0, 3, 4), leg), cyl(0.3 * R, 0.2 * R, 0.07, leg, 0, yc - 0.62 * R - 0.08, 0, 14));
  wheelSet(g, [[Math.cos(PI * 7 / 6) * R * 0.95 - 0.02, 0.07, Math.sin(PI * 7 / 6) * R * 0.95], [Math.cos(PI * 11 / 6) * R * 0.95 + 0.02, 0.07, Math.sin(PI * 11 / 6) * R * 0.95]], 0.07, 0.03, dark('#55585c'));
  g.add(boxes([[0.03, 0.02, 0.12, R + 0.02, yc - 0.04, 0], [0.03, 0.02, 0.12, -R - 0.02, yc - 0.04, 0]], dark()));
}
function bbqKamado(g, o) {
  const { w, d, h, p } = o, cer = K.mat(C(p.color, '#2f4a3c'), { roughness: 0.35 }), st = alu(C(p.color2, '#2b2d31')), shelves = flag(p.sideShelves, w > d * 1.4), sw = shelves ? clamp((w - d) / 2, 0.12, 0.4) : 0;
  const R = Math.min(w - 2 * sw, d) / 2 - 0.045, y0 = Math.min(0.3 * h, 0.4), H = h - y0 - 0.07;
  g.add(lathe([[0.3 * R, y0], [0.72 * R, y0 + 0.1 * H], [R, y0 + 0.42 * H], [0.98 * R, y0 + 0.58 * H], [0.84 * R, y0 + 0.82 * H], [0.45 * R, y0 + 0.97 * H], [0.2 * R, y0 + H]], cer, 24));
  g.add(merge([torusG(R * 1.0, 0.012, 'xz', 0, y0 + 0.5 * H, 0, 24, 5), torusG(R * 1.0, 0.012, 'xz', 0, y0 + 0.55 * H, 0, 24, 5), cylG(0.2 * R, 0.24 * R, 0.07, 0, y0 + H + 0.035, 0, 12), boxG(0.1, 0.12, 0.05, 0, y0 + 0.53 * H, -R - 0.01)], inox()));
  g.add(box(R * 0.9, 0.035, 0.035, K.wood('teak'), 0, y0 + 0.57 * H, R + 0.03), mesh(zCylG(0.035, 0.012, 0, y0 + 0.72 * H, R * 0.9, 12), inox()), box(0.16, 0.06, 0.02, dark(), 0, y0 + 0.14 * H, R * 0.8));
  const legs = []; for (let i = 0; i < 4; i++) { const a = PI / 4 + i * PI / 2; legs.push([[Math.cos(a) * R * 0.8, y0 + 0.2 * H, Math.sin(a) * R * 0.8], [Math.cos(a) * R * 0.95, 0.03, Math.sin(a) * R * 0.95]]); }
  g.add(rods(legs, 0.015, st, 6), merge([torusG(R * 0.82, 0.014, 'xz', 0, y0 + 0.2 * H, 0, 20, 5), ...legs.map(([, b]) => cylG(0.03, 0.03, 0.05, b[0], 0.025, b[2], 8))], st));
  if (shelves) for (const s of [-1, 1]) g.add(box(sw + 0.03, 0.025, Math.min(0.42, d * 0.7), K.wood('teak'), s * (w / 2 - sw / 2 - 0.015), y0 + 0.5 * H, 0), rods([[[s * R * 0.9, y0 + 0.3 * H, 0], [s * (w / 2 - 0.05), y0 + 0.49 * H, 0]]], 0.008, st, 5));
}
function bbqBuiltIn(g, o) {
  const { w, d, h, p } = o;
  grillHead(g, 0, 0, w, d - 0.05, h, p.lid === 'open', p.burners, M(p.material, C(p.color, '#c9ccd0'), 'metal'), p.color3 ? K.metal(C(p.color3, '#2b2d31')) : dark('#2b2d31'), -0.02);
}
function bbqKitchen(g, o) {
  const { w, d, h, p } = o, front = M(p.material, C(p.color, '#3a3d42'), 'aluminium'), top = M(p.material2, C(p.color2, '#c9c5bd'), 'stone'), acc = inox();
  const lh = clamp(0.2 * h, 0.08, 0.26), hc = h - lh, D = d - 0.03, n = Math.max(2, Math.round(w / 0.55)), gw = clamp(0.3 * w, 0.3, 0.9), gx = -w / 2 + 0.12 + gw / 2;
  g.add(box(w - 0.06, 0.08, D - 0.08, dark(), 0, 0.04, -0.03), box(w - 0.02, hc - 0.12, D - 0.02, front, 0, 0.08 + (hc - 0.12) / 2, -0.015), box(w, 0.04, d, top, 0, hc - 0.02, 0));
  const doors = [], hd = [];
  for (let i = 0; i < n; i++) { const x = lerp(-w / 2, w / 2, (i + 0.5) / n), dw = (w - 0.02) / n - 0.008; doors.push([dw, hc - 0.14, 0.018, x, 0.09 + (hc - 0.14) / 2, D / 2 - 0.016]); hd.push([Math.min(0.16, dw * 0.5), 0.012, 0.025, x, hc - 0.1, D / 2 + 0.004]); }
  g.add(boxes(doors, front), boxes(hd, acc));
  grillHead(g, gx, hc - 0.03, gw, D * 0.8, lh + 0.03, p.lid === 'open', p.burners, K.metal('#c9ccd0'), dark('#2b2d31'), -0.02);
  const sx = w / 2 - Math.min(0.5, w * 0.22), bwid = Math.min(0.45, w * 0.2);
  g.add(box(bwid + 0.04, 0.004, D * 0.62, acc, sx, hc + 0.002, 0.01), box(bwid, 0.006, D * 0.62 - 0.05, dark('#3a3c3f'), sx, hc + 0.004, 0.01));
  g.add(mesh(tubeG([[sx, hc, -D * 0.36], [sx, hc + lh * 0.78, -D * 0.36], [sx, hc + lh * 0.95, -D * 0.28], [sx, hc + lh * 0.82, -D * 0.2]], 0.011, 14, 6), acc), box(0.05, 0.012, 0.012, acc, sx + 0.06, hc + 0.04, -D * 0.36));
}
function bbqPizza(g, o) {
  const { w, d, h, p } = o, dome = M(p.material, C(p.color, '#d9d2c4'), 'stone'), trimM = K.mat(C(p.color2, '#b5654a'), { roughness: 0.9 }), st = alu(C(p.color3, '#2b2d31')), stand = h > 1.2;
  const yb = stand ? clamp(0.45 * h, 0.6, 0.95) : Math.min(0.05, h * 0.1), r = Math.min(w, d) / 2 - 0.03, hd = Math.min(r * 0.95, (h - yb - 0.06) * 0.62), sz = (d - 0.1) / (2 * r);
  if (stand) {
    const list = []; for (const sx of [-1, 1]) for (const s2 of [-1, 1]) list.push([0.05, yb, 0.05, sx * (w / 2 - 0.05), yb / 2, s2 * (d / 2 - 0.05)]);
    list.push([w - 0.06, 0.03, d - 0.06, 0, yb * 0.3, 0], [w - 0.06, 0.04, 0.04, 0, yb - 0.02, d / 2 - 0.05], [w - 0.06, 0.04, 0.04, 0, yb - 0.02, -d / 2 + 0.05]);
    g.add(boxes(list, st), merge([-0.2, -0.07, 0.07, 0.2, -0.13, 0.01].map((x, i) => zCylG(0.055, d * 0.6, x * Math.min(1, w), yb * 0.3 + 0.07 + (i > 3 ? 0.095 : 0), 0, 8)), K.wood('#8a6a4a')));
  } else g.add(boxes([-1, 1].flatMap((sx) => [-1, 1].map((s2) => [0.06, yb, 0.06, sx * (w / 2 - 0.08), yb / 2, s2 * (d / 2 - 0.08)])), st));
  g.add(box(w, 0.06, d, K.stone(C(p.color2, '#b9b2a6')), 0, yb + 0.03, 0));
  const dg = latheG([[r, 0], [r, 0.22 * hd], [0.9 * r, 0.55 * hd], [0.62 * r, 0.85 * hd], [0.25 * r, 0.98 * hd], [0, hd]], 24); dg.scale(1, 1, sz); dg.translate(0, yb + 0.06, -0.02);
  g.add(mesh(dg, dome));
  const zf = r * sz - 0.02, ah = Math.max(0.12, hd * 0.5);
  g.add(at(prismZ(archProfile(0.36 * r, ah), 0.14, trimM), 0, yb + 0.06, zf - 0.05), at(prismZ(archProfile(0.27 * r, ah * 0.8), 0.145, dark('#0f0f10')), 0, yb + 0.06, zf - 0.05));
  const cy0 = yb + 0.06 + hd * 0.82, ctop = h - 0.05;
  g.add(cylOn(0.06, 0.06, Math.max(0.02, ctop - cy0), st, 0, cy0, zf * 0.42, 12), cylOn(0.1, 0.1, 0.015, st, 0, ctop + 0.015, zf * 0.42, 12), cylOn(0.02, 0.02, 0.02, st, 0, ctop, zf * 0.42, 6), cylOn(0.03, 0.09, 0.02, st, 0, ctop + 0.03, zf * 0.42, 12));
}
function bbqSmoker(g, o) {
  const { w, d, h, p } = o, blk = K.metal(C(p.color, '#222426'), { roughness: 0.6, metalness: 0.5 }), acc = inox(), r = clamp(0.36 * d, 0.05, 0.42), yc = clamp(0.57 * h, r + 0.05, Math.max(r + 0.06, h - r - 0.2)), zc = -d / 2 + r;
  const Lm = 0.62 * w, xm = -w / 2 + 0.03 + Lm / 2, rf = r * 0.72, Lf = w - Lm - 0.05, xf = w / 2 - Lf / 2;
  g.add(merge([xCylG(r, Lm, xm, yc, zc, 20), xCylG(rf, Lf, xf, yc - (r - rf) - 0.04, zc, 16), cylG(0.045, 0.045, h - yc - 0.03, xm - Lm * 0.36, (h + yc - 0.03) / 2, zc, 10), cylG(0.07, 0.07, 0.012, xm - Lm * 0.36, h - 0.006, zc, 10)], blk));
  g.add(box(Lm * 0.6, 0.03, 0.03, K.wood('teak'), xm, yc + r * 0.3, zc + r + 0.045), boxes([[0.02, 0.02, 0.06, xm - Lm * 0.25, yc + r * 0.3, zc + r * 0.96 + 0.02], [0.02, 0.02, 0.06, xm + Lm * 0.25, yc + r * 0.3, zc + r * 0.96 + 0.02]], acc), rot(mesh(zCylG(0.035, 0.012, 0, 0, 0, 12), acc, xm, yc + r * 0.72, zc + r * 0.72), -0.78));
  const sh = Math.max(0.05, d - 2 * r - 0.01);
  g.add(boxes([0, 1, 2].map((i) => [Lm * 0.9, 0.02, sh / 3 - 0.012, xm, yc - r * 0.35, zc + r * 0.93 + sh * (i + 0.5) / 3]), K.wood('teak')));
  const legs = [];
  for (const sx of [-1, 1]) for (const s2 of [-1, 1]) legs.push([[xm + sx * Lm * 0.4, yc - r * 0.7, zc + s2 * r * 0.6], [xm + sx * Lm * 0.44, sx > 0 ? 0.09 : 0, zc + s2 * r * 0.85]]);
  legs.push([[xm - Lm * 0.42, yc * 0.3, zc - r * 0.75], [xm + Lm * 0.42, yc * 0.3, zc - r * 0.75]], [[xm - Lm * 0.42, yc * 0.3, zc + r * 0.75], [xm + Lm * 0.42, yc * 0.3, zc + r * 0.75]]);
  g.add(rods(legs, 0.016, blk, 6));
  wheelSet(g, [[xm + Lm * 0.44, 0.09, zc - r * 0.85 - 0.03], [xm + Lm * 0.44, 0.09, zc + r * 0.85 + 0.03]], 0.09, 0.035, dark('#55585c'));
}
function bbqTabun(g, o) {
  const { w, d, h, p } = o, clay = K.mat(C(p.color, '#b9714f'), { roughness: 0.95 }), stone = K.stone(C(p.color2, '#b9ad98')), irn = dark(C(p.color3, '#2b2d31')), r = Math.min(w, d) / 2, yb = 0.38 * h, hd = h - yb - 0.09;
  g.add(cylOn(r * 0.96, r * 0.96, yb - 0.05, stone, 0, 0, 0, 20), cylOn(r, r, 0.05, K.stone(K.shade(C(p.color2, '#b9ad98'), 0.15)), 0, yb - 0.05, 0, 20), merge([torusG(r * 0.965, 0.006, 'xz', 0, (yb - 0.05) / 3, 0, 20, 4), torusG(r * 0.965, 0.006, 'xz', 0, (yb - 0.05) * 2 / 3, 0, 20, 4)], dark('#6f675a')));
  g.add(lathe([[0.86 * r, yb], [0.9 * r, yb + 0.2 * hd], [0.78 * r, yb + 0.6 * hd], [0.46 * r, yb + 0.92 * hd], [0.3 * r, yb + hd]], clay, 22));
  g.add(cylOn(0.33 * r, 0.33 * r, 0.025, irn, 0, yb + hd, 0, 16), mesh(torusG(0.05, 0.008, 'xy', 0, yb + hd + 0.035, 0, 10, 4, PI), irn));
  g.add(at(prismZ(archProfile(0.3 * r, hd * 0.42), 0.1, irn), 0, yb + 0.01, 0.84 * r), box(0.1, 0.015, 0.03, inox(), 0, yb + hd * 0.26, 0.9 * r + 0.01));
}
function bbqMangal(g, o) {
  const { w, d, h, p } = o, stl = K.metal(C(p.color, '#2b2d31'), { roughness: 0.6, metalness: 0.5 }), shelf = flag(p.sideShelves, false), sw = shelf ? Math.min(0.25, w * 0.25) : 0, tw = w - sw, cx = sw / 2;
  const th = clamp(0.2 * h, 0.03, 0.18), yt = h - 0.012, y0 = yt - th, list = [[tw, 0.006, d - 0.04, cx, y0 + 0.003, 0]];
  for (const s of [-1, 1]) list.push([tw, th, 0.006, cx, y0 + th / 2, s * (d / 2 - 0.02)], [0.006, th, d - 0.04, cx + s * (tw / 2 - 0.003), y0 + th / 2, 0], [0.012, 0.012, 0.1, cx + s * (tw / 2 - 0.006), y0 + th * 0.6, 0]);
  for (const sx of [-1, 1]) for (const s2 of [-1, 1]) list.push([0.025, y0, 0.025, cx + sx * (tw / 2 - 0.03), y0 / 2, s2 * (d / 2 - 0.04)]);
  list.push([tw - 0.06, 0.012, 0.012, cx, y0 * 0.35, d / 2 - 0.04], [tw - 0.06, 0.012, 0.012, cx, y0 * 0.35, -d / 2 + 0.04]);
  g.add(boxes(list, stl), box(tw - 0.03, th * 0.35, d - 0.06, K.mat('#2a211d', { emissive: '#ff5a1a', emissiveIntensity: 0.35, roughness: 0.9 }), cx, y0 + th * 0.2, 0));
  const n = Math.max(2, Math.round(tw / 0.07)), sk = [], hnd = [], meat = [];
  for (let i = 0; i < n; i++) { const x = cx + lerp(-tw / 2 + 0.04, tw / 2 - 0.04, i / (n - 1)); sk.push([[x, yt + 0.006, -d / 2 + 0.01], [x, yt + 0.006, d / 2 - 0.08]]); hnd.push([[x, yt + 0.006, d / 2 - 0.08], [x, yt + 0.006, d / 2]]); if (i % 2 === 0) for (let k = 0; k < 4; k++) meat.push([0.028, 0.02, 0.03, x, yt + 0.006, lerp(-d / 2 + 0.07, d / 2 - 0.13, k / 3)]); }
  g.add(rods(sk, 0.003, inox(), 4), rods(hnd, 0.007, K.wood('walnut'), 5), boxes(meat, K.mat('#8a4a33', { roughness: 0.8 })));
  if (shelf) g.add(box(sw, 0.02, d * 0.8, K.wood('teak'), -w / 2 + sw / 2, y0 + th * 0.7, 0));
}
function bbqSym(ctx, { w, d, p, px, v }) {
  const col = C(p.color, v === 'outdoor-kitchen' ? '#3a3d42' : v === 'pizza-oven' ? '#d9d2c4' : v === 'tabun' ? '#b9714f' : v === 'kamado' ? '#2f4a3c' : v === 'built-in' ? '#c9ccd0' : '#26282b'), body = K.tint(col, 0.45), c2 = K.tint(C(p.color2, '#8d8f92'), 0.55);
  const grate = (x, y, gw, gd) => { rect(ctx, x, y, gw, gd, K.tint(col, 0.3), INK, px, 2); hatch(ctx, x - gw / 2, y - gd / 2, x + gw / 2, y + gd / 2, Math.max(2, Math.min(Math.round(gw / 6), Math.floor(gw / (3 * px)))), false, SOFT, px); };
  const knobs = (x, gw, y, n) => { for (let i = 0; i < n; i++) circ(ctx, x + lerp(-gw / 2, gw / 2, (i + 0.5) / n), y, Math.max(px, 1.6), INK, null); };
  if (v === 'gas' || v === 'built-in') {
    const sw = v === 'gas' && flag(p.sideShelves, w > 95) ? clamp(w * 0.2, 15, 34) : 0, bw = w - 2 * sw;
    if (sw) { rect(ctx, -w / 2 + sw / 2, -2, sw, d * 0.75, c2, INK, px, 1); rect(ctx, w / 2 - sw / 2, -2, sw, d * 0.75, c2, INK, px, 1); }
    rect(ctx, 0, -2, bw, d - 4, body, INK, px, 3); grate(0, -3, bw - 6, d - 14);
    line(ctx, -bw * 0.35, d / 2 - 1.5, bw * 0.35, d / 2 - 1.5, INK, 1.5 * px); knobs(0, bw, d / 2 - 5, Math.round(num(p.burners, Math.round(bw / 20), 1, 8)));
  } else if (v === 'charcoal-kettle' || v === 'kamado' || v === 'tabun') {
    const sw = v === 'kamado' && flag(p.sideShelves, w > d * 1.4) ? clamp((w - d) / 2, 12, 40) : 0, R = Math.min(w - 2 * sw, d) / 2 - (v === 'tabun' ? 0 : 3.5);
    if (sw) { rect(ctx, -w / 2 + sw / 2, 0, sw, Math.min(42, d * 0.7), K.tint('#a9743f', 0.4), INK, px, 1); rect(ctx, w / 2 - sw / 2, 0, sw, Math.min(42, d * 0.7), K.tint('#a9743f', 0.4), INK, px, 1); }
    if (v === 'tabun') circ(ctx, 0, 0, R, c2, INK, px);
    circ(ctx, 0, 0, R * (v === 'tabun' ? 0.88 : 1), body, INK, px); circ(ctx, 0, 0, R * 0.62, null, SOFT, px); circ(ctx, 0, 0, R * (v === 'tabun' ? 0.32 : 0.16), K.tint(col, 0.2), INK, px);
    if (v !== 'tabun') line(ctx, -R * 0.3, R + 1, R * 0.3, R + 1, INK, 1.5 * px); else rect(ctx, 0, R * 0.88, R * 0.5, 4, '#55585c', INK, px);
  } else if (v === 'outdoor-kitchen') {
    const gw = clamp(0.3 * w, 30, 90), gx = -w / 2 + 12 + gw / 2, sx = w / 2 - Math.min(50, w * 0.22), bw = Math.min(45, w * 0.2), n = Math.max(2, Math.round(w / 55));
    rect(ctx, 0, 0, w, d, K.tint(C(p.color2, '#c9c5bd'), 0.5), INK, px); grate(gx, -2, gw, d * 0.72); knobs(gx, gw, d * 0.4, 3);
    rect(ctx, sx, 1, bw, d * 0.58, '#eef1f2', INK, px, 4); circ(ctx, sx, -d * 0.36, Math.max(1.8, px), INK, null); line(ctx, sx, -d * 0.36, sx, -d * 0.18, INK, 1.5 * px);
    for (let i = 1; i < n; i++) line(ctx, lerp(-w / 2, w / 2, i / n), d / 2 - 3, lerp(-w / 2, w / 2, i / n), d / 2, INK, px);
  } else if (v === 'pizza-oven') {
    const r = Math.min(w, d) / 2 - 3;
    rect(ctx, 0, 0, w, d, c2, INK, px, 2); ell(ctx, 0, -2, r, (d - 10) / 2, body, INK, px); ell(ctx, 0, -2, r * 0.6, (d - 10) * 0.3, null, SOFT, px);
    rect(ctx, 0, d / 2 - 6, r * 0.72, 10, K.tint(C(p.color2, '#b5654a'), 0.25), INK, px, 1); rect(ctx, 0, d / 2 - 5, r * 0.5, 8, '#4a4744', null, px); circ(ctx, 0, d * 0.2, 6, '#55585c', INK, px);
  } else if (v === 'smoker') {
    const r = clamp(0.36 * d, 5, 42), Lm = 0.62 * w, xm = -w / 2 + 3 + Lm / 2, Lf = w - Lm - 5;
    rect(ctx, xm, -d / 2 + r + (d - 2 * r) / 2 + r * 0.5, Lm * 0.9, d - 2 * r, K.tint('#a9743f', 0.4), INK, px, 1);
    rect(ctx, w / 2 - Lf / 2, -d / 2 + r, Lf, r * 1.44, K.tint(col, 0.35), INK, px, 3); rect(ctx, xm, -d / 2 + r, Lm, 2 * r, body, INK, px, 4); line(ctx, xm - Lm / 2 + 3, -d / 2 + r, xm + Lm / 2 - 3, -d / 2 + r, SOFT, px); circ(ctx, xm - Lm * 0.36, -d / 2 + r, 4.5, '#55585c', INK, px);
  } else {
    rect(ctx, 0, 0, w, d - 4, body, INK, px, 1); rect(ctx, 0, 0, w - 4, d - 9, '#6a5a52', SOFT, px);
    hatch(ctx, -w / 2 + 2, -d / 2, w / 2 - 2, d / 2, Math.max(2, Math.min(Math.round(w / 7), Math.floor(w / (3 * px)))), false, INK, px);
  }
}
define('bbq', { gas: { b: bbqGas }, 'charcoal-kettle': { b: bbqKettle }, kamado: { b: bbqKamado }, 'built-in': { b: bbqBuiltIn }, 'outdoor-kitchen': { b: bbqKitchen }, 'pizza-oven': { b: bbqPizza }, smoker: { b: bbqSmoker }, tabun: { b: bbqTabun }, mangal: { b: bbqMangal } }, bbqSym);

// ═════════════════════════ FENCE ═════════════════════════
// [target post spacing, max post width, default infill colour, default post colour]
const FENCE = {
  'slat-horizontal': [1.8, 0.08, '#b98a5e', '#3a3d42'], 'slat-vertical': [1.8, 0.09, '#b98a5e', null], picket: [1.8, 0.09, '#f4f2ee', null], mesh: [2.5, 0.06, '#3a3d42', null],
  'stone-wall': [0, 0, '#b3a78f', '#d0c7b4'], 'block-wall': [3, 0.3, '#ece8df', '#cfc9bd'], 'hedge-screen': [2, 0.04, '#4f7a3d', '#3a3d42'], bamboo: [0, 0, '#c9a45c', '#6b4a34'], glass: [1.2, 0.05, '#cfe3ea', '#c9ccd0'],
  gate: [0, 0.1, '#b98a5e', '#3a3d42'], 'gate-sliding': [0, 0.06, '#3a3d42', null], gabion: [0, 0, '#a39c90', '#b9bdc2'], trellis: [1.8, 0.05, '#b98a5e', null], railing: [1.5, 0.04, '#26282b', null], 'pool-fence': [0.9, 0.028, '#22252a', '#c9ccd0'],
};
/** Post centre positions (same units as w) for a fence segment. */
function fencePosts(w, pw, span) {
  if (!(span > 0)) return [-w / 2 + pw / 2, w / 2 - pw / 2];
  const n = Math.max(1, Math.round((w - pw) / span));
  return Array.from({ length: n + 1 }, (_, i) => lerp(-w / 2 + pw / 2, w / 2 - pw / 2, i / n));
}
function buildFence(g, o) {
  const { w, d, h, p, v } = o, F = FENCE[v], col = C(p.color, isMetal(p.material) && F[2] === '#b98a5e' ? '#3a3d42' : F[2]), col2 = C(p.color2, F[3] || col), posts = flag(p.posts, true), gap = num(p.gap, v === 'picket' ? 0.45 : 0.18, 0, 0.9);
  const wooden = !isMetal(p.material) && !['plastic', 'glass', 'stone', 'concrete'].includes(p.material);
  const im = v === 'picket' && !isWood(p.material) && !isMetal(p.material) ? K.lacquer(col) : M(p.material, col, 'wood'), pm = p.color2 || !wooden || F[3] ? (wooden && !F[3] ? M(p.material, col2, 'wood') : alu(col2)) : im;
  const pw = Math.min(F[1], Math.max(d, 0.02)), xs = fencePosts(w, pw, F[0]), list = [], inf = [], rng = seedOf(o, v);
  const addPosts = (top = h, dep = d, z = 0) => { if (posts) xs.forEach((x) => list.push([pw, top, dep, x, top / 2, z])); };
  if (v === 'slat-horizontal') {
    const t = posts ? Math.min(0.02, d * 0.4) : d, bh = isMetal(p.material) ? 0.12 : 0.09, gs = clamp(bh * gap / (1 - gap), 0, 0.3), n = Math.max(1, Math.round((h - 0.03 + gs) / (bh + gs))), be = Math.max(0.01, (h - 0.03 - (n - 1) * gs) / n);
    for (let i = 0; i < n; i++) inf.push([w, be, t, 0, h - be / 2 - i * (be + gs), d / 2 - t / 2]);
    addPosts(h, d - t, -t / 2);
  } else if (v === 'slat-vertical' || v === 'picket') {
    const t = Math.min(0.02, d * 0.4), bw = v === 'picket' ? 0.07 : 0.09, gs = clamp(bw * gap / (1 - gap), 0, 0.3), n = Math.max(1, Math.floor((w + gs) / (bw + gs))), y0 = v === 'picket' ? 0.05 : 0.03, x0 = -((n - 1) * (bw + gs)) / 2;
    if (v === 'picket') { const pk = prismG([[-bw / 2, y0], [-bw / 2, h - bw * 0.6], [0, h], [bw / 2, h - bw * 0.6], [bw / 2, y0]], t); g.add(merge(Array.from({ length: n }, (_, i) => pk.clone().translate(x0 + i * (bw + gs), 0, d / 2 - t / 2)), im)); }
    else for (let i = 0; i < n; i++) inf.push([bw, h - y0, t, x0 + i * (bw + gs), y0 + (h - y0) / 2, d / 2 - t / 2]);
    for (const y of h > 1.3 ? [0.18, h / 2, h - 0.18] : [Math.min(0.18, h * 0.25), h - Math.min(0.2, h * 0.25)]) list.push([w, 0.07, Math.max(0.01, Math.min(0.04, d - t)), 0, y, d / 2 - t - Math.max(0.01, Math.min(0.04, d - t)) / 2]);
    addPosts(v === 'picket' ? h - 0.02 : h, d - t, -t / 2);
  } else if (v === 'mesh') {
    const sv = Math.max(0.1, w / 110), nv = Math.max(2, Math.round(w / sv)), nh = Math.max(2, Math.round((h - 0.05) / 0.2));
    for (let i = 0; i <= nv; i++) inf.push([0.004, h - 0.05, 0.004, lerp(-w / 2 + 0.01, w / 2 - 0.01, i / nv), 0.04 + (h - 0.05) / 2, 0]);
    for (let i = 0; i <= nh; i++) inf.push([w - 0.02, 0.005, 0.005, 0, lerp(0.05, h - 0.012, i / nh), 0.003]);
    addPosts();
  } else if (v === 'stone-wall') {
    const ct = Math.min(0.06, h * 0.2), nc = Math.max(1, Math.round((h - ct) / 0.2)), ch = (h - ct) / nc, k = Math.max(1, w / 14), sets = [[], [], []];
    for (let c = 0; c < nc; c++) for (let x = -w / 2; x < w / 2 - 0.01;) { const len = Math.min(w / 2 - x, (0.24 + rng() * 0.32) * k), l2 = w / 2 - x - len < 0.12 * k ? w / 2 - x : len; sets[Math.floor(rng() * 3)].push([l2 - 0.012, ch - 0.012, d, x + l2 / 2, c * ch + ch / 2, 0]); x += l2; }
    g.add(box(w - 0.004, h - ct, Math.max(0.005, d - 0.02), K.mat(K.shade(col, -0.35), { roughness: 1 }), 0, (h - ct) / 2, 0), box(w, ct, d, K.mat(col2, { roughness: 0.9 }), 0, h - ct / 2, 0));
    sets.forEach((s, i) => g.add(boxes(s, K.mat(K.shade(col, [-0.08, 0.04, 0.14][i]), { roughness: 0.95 }))));
  } else if (v === 'block-wall') {
    const ct = Math.min(0.05, h * 0.2), wall = K.mat(col, { roughness: 0.95 });
    g.add(box(w, h - ct, Math.max(0.005, d - 0.02), wall, 0, (h - ct) / 2, 0), box(w, ct, d, K.mat(col2, { roughness: 0.8 }), 0, h - ct / 2, 0), box(w, Math.min(0.12, h * 0.2), Math.max(0.006, d - 0.012), K.mat(K.shade(col, -0.08), { roughness: 0.95 }), 0, Math.min(0.06, h * 0.1), 0));
    if (posts && w > 2.4) g.add(boxes(xs.map((x) => [pw, h - ct, d, x, (h - ct) / 2, 0]), wall));
  } else if (v === 'hedge-screen') {
    const fw = w - (posts ? 2 * pw : 0), geo = new THREE.BoxGeometry(fw, h - 0.06, d * 0.8, Math.max(2, Math.min(40, Math.round(fw / 0.12))), Math.max(2, Math.min(20, Math.round(h / 0.12))), 1), q = geo.attributes.position;
    const jit = new Map();
    for (let i = 0; i < q.count; i++) { const key = `${q.getX(i).toFixed(3)},${q.getY(i).toFixed(3)},${Math.sign(q.getZ(i))}`; if (!jit.has(key)) jit.set(key, 1 - rng() * 0.45); if (Math.abs(q.getX(i)) < fw / 2 - 1e-4 && Math.abs(q.getY(i)) < (h - 0.06) / 2 - 1e-4) q.setZ(i, q.getZ(i) * jit.get(key)); }
    geo.computeVertexNormals(); geo.translate(0, 0.03 + (h - 0.06) / 2, 0);
    g.add(mesh(geo, K.foliage(col)));
    list.push([w, 0.03, d, 0, h - 0.015, 0], [w, 0.03, d, 0, 0.015, 0]); addPosts();
  } else if (v === 'bamboo') {
    const r = Math.min(Math.max(0.016, w / 220), d / 2), n = Math.max(1, Math.floor(w / (2 * r))), geos = [];
    for (let i = 0; i < n; i++) { const hh = i === 0 ? h : h * (0.955 + rng() * 0.04); geos.push(cylG(r * 0.92, r, hh, -w / 2 + r + i * (w - 2 * r) / Math.max(1, n - 1), hh / 2, (rng() - 0.5) * (d - 2 * r), 6)); }
    g.add(merge(geos, K.mat(col, { roughness: 0.55 })), boxes([[w, 0.03, d, 0, h * 0.22, 0], [w, 0.03, d, 0, h * 0.8, 0]], K.mat(col2, { roughness: 0.9 })));
  } else if (v === 'glass') {
    const gm = clear(col, 0.3), panes = [];
    if (posts) { for (let i = 0; i < xs.length - 1; i++) panes.push([xs[i + 1] - xs[i] - pw - 0.03, h - 0.14, Math.min(0.012, d), (xs[i] + xs[i + 1]) / 2, 0.08 + (h - 0.14) / 2, 0]); addPosts(h - 0.02); list.push([w, 0.04, d, 0, h - 0.02, 0]); }
    else { const n = Math.max(1, Math.round(w / 1.2)); for (let i = 0; i < n; i++) panes.push([w / n - 0.012, h - 0.04, Math.min(0.014, d), lerp(-w / 2, w / 2, (i + 0.5) / n), 0.04 + (h - 0.04) / 2, 0]); list.push([w, Math.min(0.1, h * 0.2), d, 0, Math.min(0.05, h * 0.1), 0]); }
    g.add(ns(boxes(panes, gm)));
  } else if (v === 'gate' || v === 'gate-sliding') {
    const slide = v === 'gate-sliding', leaves = !slide && w >= 2.2 ? 2 : 1, fz = Math.min(0.04, d), x0 = slide ? -w / 2 : -w / 2 + pw + 0.012, x1 = -x0, y0 = slide ? 0.09 : 0.06, y1 = h - (slide ? 0 : 0.04), lw = (x1 - x0) / leaves;
    for (let k = 0; k < leaves; k++) {
      const a = x0 + k * lw + (k ? 0.006 : 0), b = x0 + (k + 1) * lw - (k < leaves - 1 ? 0.006 : 0), fs = Math.min(0.045, (b - a) * 0.2);
      list.push([b - a, fs, fz, (a + b) / 2, y1 - fs / 2, 0], [b - a, slide ? 0.07 : fs, fz, (a + b) / 2, y0 + (slide ? 0.035 : fs / 2), 0], [fs, y1 - y0, fz, a + fs / 2, (y0 + y1) / 2, 0], [fs, y1 - y0, fz, b - fs / 2, (y0 + y1) / 2, 0]);
      if (wooden) { const bh = 0.09, gs = clamp(bh * gap / (1 - gap), 0, 0.3), n = Math.max(1, Math.floor((y1 - y0 - 2 * fs + gs) / (bh + gs))); for (let i = 0; i < n; i++) inf.push([b - a - 2 * fs, bh, Math.min(0.02, fz), (a + b) / 2, y1 - fs - bh / 2 - i * (bh + gs) - 0.005, 0]); }
      else { const n = Math.max(1, Math.round((b - a - 2 * fs) / 0.11)); for (let i = 1; i < n; i++) inf.push([0.016, y1 - y0 - 2 * fs, 0.016, lerp(a + fs, b - fs, i / n), (y0 + y1) / 2, 0]); }
      if (!slide) { const hx = leaves === 2 ? (k ? a + 0.07 : b - 0.07) : b - 0.07; g.add(box(0.03, 0.12, d, inox(), hx, Math.min(1.0, h * 0.6), 0), boxes([[0.03, 0.08, d, k ? b : a, y0 + 0.15, 0], [0.03, 0.08, d, k ? b : a, y1 - 0.15, 0]], dark())); }
    }
    if (slide) { g.add(box(w, 0.02, d, K.metal('#8a8d91', { roughness: 0.5 }), 0, 0.01, 0), merge([zCylG(0.045, d * 0.6, x0 + 0.3, 0.055, 0, 12), zCylG(0.045, d * 0.6, x1 - 0.3, 0.055, 0, 12)], dark('#55585c'))); }
    else xs.forEach((x) => list.push([pw, h, d, x, h / 2, 0]));
  } else if (v === 'gabion') {
    const geo = new THREE.BoxGeometry(w - 0.02, h - 0.02, Math.max(0.01, d - 0.02), Math.max(2, Math.min(28, Math.round(w / 0.14))), Math.max(2, Math.min(16, Math.round(h / 0.14))), 2), q = geo.attributes.position, jit = new Map();
    for (let i = 0; i < q.count; i++) { const key = `${q.getX(i).toFixed(3)},${q.getY(i).toFixed(3)},${q.getZ(i).toFixed(3)}`; if (!jit.has(key)) jit.set(key, rng() * Math.min(0.035, d * 0.12)); const s = jit.get(key), X = q.getX(i), Y = q.getY(i), Z = q.getZ(i); q.setXYZ(i, X - (Math.abs(X) > w / 2 - 0.02 ? Math.sign(X) * s : 0), Y - (Y > h / 2 - 0.02 ? s : 0), Z - (Math.abs(Z) > d / 2 - 0.02 ? Math.sign(Z) * s : 0)); }
    geo.computeVertexNormals(); geo.translate(0, 0.01 + (h - 0.02) / 2, 0);
    g.add(mesh(geo, K.mat(col, { roughness: 1, flat: true })));
    const s = Math.max(0.1, w / 36, h / 24), nx = Math.max(1, Math.round(w / s)), ny = Math.max(1, Math.round(h / s));
    for (let i = 0; i <= nx; i++) { const x = lerp(-w / 2 + 0.003, w / 2 - 0.003, i / nx); for (const sz of [-1, 1]) inf.push([0.006, h, 0.006, x, h / 2, sz * (d / 2 - 0.003)]); inf.push([0.006, 0.006, d, x, h - 0.003, 0]); }
    for (let j = 0; j <= ny; j++) for (const sz of [-1, 1]) inf.push([w, 0.006, 0.006, 0, lerp(0.003, h - 0.003, j / ny), sz * (d / 2 - 0.003)]);
    g.add(boxes(inf.splice(0), K.metal(col2, { roughness: 0.5, metalness: 0.6 })));
  } else if (v === 'trellis') {
    const xa = -w / 2 + pw, xb = w / 2 - pw, ya = 0.08, yb = h - 0.04, s = Math.max(0.14, (w + h) / 70) * Math.SQRT2, lt = Math.min(0.008, d / 2);
    for (let c = ya - xb + s / 2; c < yb - xa; c += s) { const a = Math.max(xa, ya - c), b = Math.min(xb, yb - c); if (b - a > 0.03) inf.push([(b - a) * Math.SQRT2, 0.03, lt, (a + b) / 2, (a + b) / 2 + c, lt / 2, 0, 0, PI / 4]); }
    for (let c = ya + xa + s / 2; c < yb + xb; c += s) { const a = Math.max(xa, c - yb), b = Math.min(xb, c - ya); if (b - a > 0.03) inf.push([(b - a) * Math.SQRT2, 0.03, lt, (a + b) / 2, c - (a + b) / 2, -lt / 2, 0, 0, -PI / 4]); }
    list.push([w, 0.04, d, 0, h - 0.02, 0], [w, 0.04, d, 0, 0.07, 0]); xs.forEach((x) => list.push([pw, h, d, x, h / 2, 0]));
  } else if (v === 'railing') {
    const sp = Math.max(0.11, w / 110), n = Math.max(1, Math.round(w / sp)), bt = Math.min(0.014, d);
    for (let i = 1; i < n; i++) inf.push([bt, h - 0.15, bt, lerp(-w / 2, w / 2, i / n), 0.1 + (h - 0.15) / 2, 0]);
    list.push([w, 0.04, d, 0, h - 0.02, 0], [w, 0.03, Math.min(0.03, d), 0, 0.1, 0]); addPosts();
  } else {
    const r = Math.min(0.02, d / 2);
    g.add(merge(xs.map((x) => cylG(r, r, h, x, h / 2, 0, 8)), alu(col2)), ns(box(w - 2 * r, h - 0.1, 0.003, clear(col, 0.4), 0, 0.05 + (h - 0.1) / 2, 0)), boxes([[w - 2 * r, 0.04, Math.min(0.006, d), 0, h - 0.04, 0], [w - 2 * r, 0.04, Math.min(0.006, d), 0, 0.06, 0]], K.fabric(col)));
  }
  if (list.length) g.add(boxes(list, pm));
  if (inf.length) g.add(boxes(inf, im));
}
function fenceSym(ctx, { w, d, p, px, v }) {
  const F = FENCE[v], col = C(p.color, isMetal(p.material) && F[2] === '#b98a5e' ? '#3a3d42' : F[2]), col2 = C(p.color2, F[3] || col), posts = flag(p.posts, true), t = Math.max(d, 2.4 * px), pw = Math.max(Math.min(F[1] * 100, Math.max(d, 2)), 3 * px);
  const xs = fencePosts(w, Math.min(F[1] * 100, Math.max(d, 2)), F[0] * 100);
  if (['stone-wall', 'block-wall', 'gabion', 'hedge-screen', 'bamboo'].includes(v)) {
    rect(ctx, 0, 0, w, t, K.tint(col, v === 'hedge-screen' ? 0.25 : 0.4), INK, px, v === 'hedge-screen' ? t / 3 : 0);
    if (v === 'stone-wall' || v === 'gabion') hatch(ctx, -w / 2, -t / 2, w / 2, t / 2, Math.max(1, Math.min(Math.round(w / 30), Math.floor(w / (5 * px)))), false, SOFT, px);
    if (v === 'bamboo') hatch(ctx, -w / 2, -t / 2, w / 2, t / 2, Math.max(1, Math.min(Math.round(w / 4), Math.floor(w / (3 * px)))), false, SOFT, px);
    if (v === 'block-wall' && posts && w > 240) xs.forEach((x) => rect(ctx, x, 0, 30, t, K.tint(col, 0.3), INK, px));
    return;
  }
  if (v === 'gate' || v === 'gate-sliding') {
    const leaves = v === 'gate' && w >= 220 ? 2 : 1, lw = (w - 2 * pw) / leaves;
    line(ctx, -w / 2, 0, w / 2, 0, rgba(col, 0.9), Math.max(t * 0.5, 1.6 * px));
    if (v === 'gate') {
      dashed(ctx, px, () => { for (let k = 0; k < leaves; k++) { const hx = k ? w / 2 - pw : -w / 2 + pw; ctx.beginPath(); ctx.arc(hx, 0, Math.max(0, lw), k ? PI / 2 : 0, k ? PI : PI / 2); ctx.strokeStyle = SOFT; ctx.lineWidth = px; ctx.stroke(); line(ctx, hx, 0, hx, Math.max(0, lw), SOFT, px); } });
      for (const s of [-1, 1]) rect(ctx, s * (w / 2 - pw / 2), 0, pw, Math.max(t, pw), K.shade(col2, -0.1), INK, px);
    } else { const y = t / 2 + 5 * px; line(ctx, -w * 0.3, y, w * 0.3, y, SOFT, px); poly(ctx, [[-w * 0.3 + 4 * px, y - 2.5 * px], [-w * 0.3, y], [-w * 0.3 + 4 * px, y + 2.5 * px]], null, SOFT, px, false); }
    return;
  }
  const band = v === 'glass' ? rgba('#8fc4d6', 0.7) : v === 'pool-fence' || v === 'mesh' ? rgba(col, 0.55) : rgba(col, 0.95);
  if (v === 'mesh' || v === 'trellis' || v === 'pool-fence' || v === 'railing') dashed(ctx, px, () => line(ctx, -w / 2, 0, w / 2, 0, band, Math.max(t * 0.4, 1.4 * px)), 5, 2);
  else rect(ctx, 0, 0, w, Math.max(t * 0.55, 1.6 * px), band, INK, px * 0.7);
  if (posts || v === 'trellis') xs.forEach((x) => rect(ctx, x, 0, pw, Math.max(t, pw), K.shade(col2, -0.15), INK, px));
}
define('fence', Object.fromEntries(Object.keys(FENCE).map((k) => [k, { b: buildFence }])), fenceSym, true);

// ═════════════════════════ SHED ═════════════════════════
/** Walls + roof of a small building. Returns { wb, db, yw (cladded wall height at the front), zf (front wall plane) }. */
function shedShell(g, w, d, h, roof, wallCol, roofM, material, ov = 0.06) {
  const wb = w - 2 * ov, db = d - 2 * ov, core = K.mat(K.shade(wallCol, -0.3), { roughness: 0.9 }), wall = isWood(material) ? K.wood(wallCol) : material === 'metal' || material === 'aluminium' ? K.metal(wallCol, { roughness: 0.55, metalness: 0.35 }) : K.mat(wallCol, { roughness: 0.6 });
  let yw, ywBack;
  if (roof === 'gable') {
    const rise = clamp(0.2 * w, 0.04, 0.45 * h), tv = Math.min(0.045, h * 0.1), ye = h - tv - rise; yw = ywBack = ye + rise * (ov / (w / 2));
    g.add(prismZ([[-w / 2, ye], [-w / 2, ye + tv], [0, h], [w / 2, ye + tv], [w / 2, ye], [0, h - tv]], d, roofM));
    g.add(prismZ([[-wb / 2, yw - 0.002], [0, h - tv - 0.004], [wb / 2, yw - 0.002]], db, wall));
  } else if (roof === 'pent') {
    const drop = clamp(0.12 * d, 0.03, 0.3 * h), tv = Math.min(0.045, h * 0.1), yb = h - tv - drop; yw = h - tv - drop * (ov / d) - 0.004; ywBack = yb + drop * (ov / d) - 0.004;
    g.add(prismX([[-d / 2, yb], [-d / 2, yb + tv], [d / 2, h], [d / 2, h - tv]], w, roofM), prismX([[-db / 2, ywBack - 0.002], [db / 2, yw], [db / 2, ywBack - 0.002]], wb, wall));
  } else { const tv = Math.min(0.06, h * 0.15); yw = ywBack = h - tv; g.add(box(w, tv, d, roofM, 0, h - tv / 2, 0)); }
  g.add(box(wb - 0.016, ywBack, db - 0.016, core, 0, ywBack / 2, 0), box(wb + 0.02, Math.min(0.05, h * 0.1), db + 0.02, dark('#3a3835'), 0, Math.min(0.025, h * 0.05), 0));
  const list = [];
  if (material === 'metal' || material === 'aluminium') {
    list.push([wb, ywBack, 0.006, 0, ywBack / 2, db / 2 - 0.003], [wb, ywBack, 0.006, 0, ywBack / 2, -db / 2 + 0.003], [0.006, ywBack, db, wb / 2 - 0.003, ywBack / 2, 0], [0.006, ywBack, db, -wb / 2 + 0.003, ywBack / 2, 0]);
    const nx = Math.max(2, Math.round(wb / 0.13)), nz = Math.max(2, Math.round(db / 0.13));
    for (let i = 0; i <= nx; i++) for (const s of [-1, 1]) list.push([0.03, ywBack, 0.012, lerp(-wb / 2 + 0.015, wb / 2 - 0.015, i / nx), ywBack / 2, s * (db / 2 + 0.002)]);
    for (let i = 0; i <= nz; i++) for (const s of [-1, 1]) list.push([0.012, ywBack, 0.03, s * (wb / 2 + 0.002), ywBack / 2, lerp(-db / 2 + 0.015, db / 2 - 0.015, i / nz)]);
  } else {
    const ph = isWood(material) ? 0.15 : 0.21, n = Math.max(1, Math.round(ywBack / ph)), ch = ywBack / n;
    for (let i = 0; i < n; i++) { const y = (i + 0.5) * ch; list.push([wb, ch - 0.007, 0.012, 0, y, db / 2 - 0.006], [wb, ch - 0.007, 0.012, 0, y, -db / 2 + 0.006], [0.012, ch - 0.007, db, wb / 2 - 0.006, y, 0], [0.012, ch - 0.007, db, -wb / 2 + 0.006, y, 0]); }
  }
  g.add(boxes(list, wall));
  return { wb, db, yw: roof === 'pent' ? ywBack : yw, yFront: yw, zf: db / 2 };
}
function shedDoors(g, S, n, doorM, trimM, wide, xOff = 0) {
  const dw = wide ? (S.wb - 0.14) / n : Math.min(0.8, (S.wb - 0.24) / n), dh = Math.max(0.05, Math.min(1.88, (wide ? S.yFront : S.yw) - 0.07)), tw = n * dw, list = [], hw = [];
  for (let i = 0; i < n; i++) { const x = xOff - tw / 2 + dw * (i + 0.5); list.push([dw - 0.012, dh, 0.03, x, 0.05 + dh / 2, S.zf + 0.008]); hw.push([0.02, Math.min(0.16, dh * 0.2), 0.03, n === 1 ? x + dw * 0.36 : xOff + (i ? 0.05 : -0.05), 0.05 + dh * 0.52, S.zf + 0.03]); }
  g.add(boxes(list, doorM), boxes(hw, inox()));
  g.add(boxes([[tw + 0.08, 0.04, 0.03, xOff, 0.05 + dh + 0.02, S.zf + 0.006], [0.04, dh, 0.03, xOff - tw / 2 - 0.02, 0.05 + dh / 2, S.zf + 0.006], [0.04, dh, 0.03, xOff + tw / 2 + 0.02, 0.05 + dh / 2, S.zf + 0.006],
    ...[0.33, 0.66].flatMap((t) => Array.from({ length: n }, (_, i) => [dw - 0.1, 0.012, 0.004, xOff - tw / 2 + dw * (i + 0.5), 0.05 + dh * t, S.zf + 0.024]))], trimM));
  return tw;
}
function shedWindow(g, x, y, z, s, trimM, side) {
  const fr = [[s, 0.03, 0.03, 0, s / 2, 0], [s, 0.03, 0.03, 0, -s / 2, 0], [0.03, s, 0.03, s / 2, 0, 0], [0.03, s, 0.03, -s / 2, 0, 0], [0.018, s, 0.02, 0, 0, 0], [s, 0.018, 0.02, 0, 0, 0]];
  const grp = new THREE.Group(); grp.add(boxes(fr, trimM), ns(box(s, s, 0.008, K.mat('#9fc0cf', { roughness: 0.08, metalness: 0.3 }), 0, 0, -0.004)));
  grp.position.set(x, y, z); if (side) grp.rotation.y = PI / 2;
  g.add(grp);
}
function shedPalette(p, defWall, defRoof, defDoor) { const wall = C(p.color, defWall); return { wall, roofM: K.mat(C(p.color2, defRoof), { roughness: 0.75 }), doorM: K.mat(C(p.color3, defDoor || K.shade(wall, -0.22)), { roughness: 0.6 }), trimM: K.mat(C(p.color2, defRoof), { roughness: 0.6 }) }; }
function buildShed(g, o) {
  const { w, d, h, p, v } = o, bike = v === 'bike-store', mat = MATS.includes(p.material) ? p.material : bike ? 'metal' : 'plastic';
  const P = shedPalette(p, isWood(mat) ? '#b98a5e' : isMetal(mat) ? '#6f7f7a' : '#d9d2c2', isWood(mat) ? '#4a4744' : '#5a5d61', isWood(mat) ? null : isMetal(mat) ? null : '#8a8378');
  const roof = ['gable', 'pent', 'flat'].includes(p.roof) ? p.roof : bike ? 'pent' : 'gable', S = shedShell(g, w, d, h, roof, P.wall, P.roofM, mat, Math.min(0.06, w * 0.08, d * 0.08));
  const n = bike ? 2 : Math.round(num(p.doors, w >= 1.5 ? 2 : 1, 1, 2)), win = flag(p.window, false) && !bike, room = (S.wb - n * Math.min(0.8, (S.wb - 0.24) / n)) / 2, front = win && room > 1.1, ws = Math.min(0.5, S.yw * 0.3);
  const tw = shedDoors(g, S, n, P.doorM, P.trimM, bike, front ? -S.wb / 2 + 0.16 + n * Math.min(0.8, (S.wb - 0.24) / n) / 2 : 0);
  if (win) { if (front) shedWindow(g, (-S.wb / 2 + 0.16 + tw + S.wb / 2) / 2 + 0.04, Math.min(1.45, S.yw - ws / 2 - 0.12), S.zf + 0.012, ws, P.trimM, false); else shedWindow(g, S.wb / 2 + 0.012, Math.min(1.45, S.yw - ws / 2 - 0.12), 0, Math.min(ws, S.db * 0.5), P.trimM, true); }
  if (roof === 'gable') g.add(box(Math.min(0.3, S.wb * 0.2), 0.1, 0.02, P.trimM, 0, S.yw + (h - S.yw) * 0.35, S.zf + 0.004));
}
function buildStorageBox(g, o) {
  const { w, d, h, p } = o, col = C(p.color, '#6b6460'), body = K.mat(col, { roughness: 0.6 }), lh = clamp(0.2 * h, 0.03, 0.14), bh = h - lh - 0.006, list = [], n = Math.max(2, Math.round(bh / 0.11));
  g.add(box(w - 0.05, bh, d - 0.05, K.mat(K.shade(col, -0.3), { roughness: 0.9 }), 0, bh / 2, 0));
  for (let i = 0; i < n; i++) { const y = 0.02 + (i + 0.5) * (bh - 0.02) / n, ph = (bh - 0.02) / n - 0.006; list.push([w - 0.03, ph, 0.012, 0, y, d / 2 - 0.021], [w - 0.03, ph, 0.012, 0, y, -d / 2 + 0.021], [0.012, ph, d - 0.03, w / 2 - 0.021, y, 0], [0.012, ph, d - 0.03, -w / 2 + 0.021, y, 0]); }
  for (const sx of [-1, 1]) for (const s2 of [-1, 1]) list.push([0.05, bh, 0.05, sx * (w / 2 - 0.035), bh / 2, s2 * (d / 2 - 0.035)]);
  g.add(boxes(list, body), rbox(w, lh, d, K.mat(C(p.color2, K.shade(col, -0.12)), { roughness: 0.55 }), 0, h - lh / 2, 0, Math.min(0.03, lh * 0.4), 2));
  g.add(box(0.08, 0.06, 0.02, K.mat(C(p.color3, '#2b2d31')), 0, bh - 0.02, d / 2 - 0.008), boxes([[0.012, 0.03, 0.14, w / 2 - 0.012, bh * 0.7, 0], [0.012, 0.03, 0.14, -w / 2 + 0.012, bh * 0.7, 0]], dark()));
}
function buildBinStore(g, o) {
  const { w, d, h, p } = o, wood = M(p.material, C(p.color, '#a9825a'), 'wood'), fr = M(p.material, C(p.color2, K.shade(C(p.color, '#a9825a'), -0.18)), 'wood'), n = Math.max(1, Math.round(w / 0.72)), cw = w / n, drop = Math.min(0.1, h * 0.1), list = [], sl = [];
  const hb = h - 0.03, hf = hb - drop, ns_ = Math.max(2, Math.round(hf / 0.1)), sh = hf / ns_;
  for (let i = 0; i <= n; i++) { const x = lerp(-w / 2 + 0.025, w / 2 - 0.025, i / n); list.push([0.05, hf, 0.05, x, hf / 2, d / 2 - 0.045], [0.05, hb, 0.05, x, hb / 2, -d / 2 + 0.025]); }
  for (let j = 0; j < ns_; j++) { const y = (j + 0.5) * sh; sl.push([w - 0.02, sh - 0.02, 0.016, 0, y, -d / 2 + 0.058], [0.016, sh - 0.02, d - 0.1, w / 2 - 0.012, y, -0.01], [0.016, sh - 0.02, d - 0.1, -w / 2 + 0.012, y, -0.01]); for (let i = 0; i < n; i++) sl.push([cw - 0.07, sh - 0.02, 0.016, -w / 2 + cw * (i + 0.5), y, d / 2 - 0.028]); }
  const ang = Math.atan2(drop, d), ll = Math.hypot(d, drop) - 0.01, nl = Math.max(2, Math.round(d / 0.11));
  for (let i = 0; i < n; i++) { const x = -w / 2 + cw * (i + 0.5); for (let k = 0; k < nl; k++) { const t = (k + 0.5) / nl; sl.push([cw - 0.012, 0.018, ll / nl - 0.008, x, lerp(h - 0.012, h - drop - 0.012, t), lerp(-d / 2, d / 2, t), ang]); } list.push([0.03, 0.03, ll, x - cw / 2 + 0.03, h - drop / 2 - 0.035, 0, ang], [0.03, 0.03, ll, x + cw / 2 - 0.03, h - drop / 2 - 0.035, 0, ang]); }
  g.add(boxes(list, fr), boxes(sl, wood), boxes(Array.from({ length: n }, (_, i) => [0.1, 0.02, 0.025, -w / 2 + cw * (i + 0.5), hf * 0.55, d / 2 - 0.005]), dark()));
}
function buildTallCabinet(g, o) {
  const { w, d, h, p } = o, col = C(p.color, '#d9d2c2'), body = K.mat(col, { roughness: 0.6 }), dm = K.mat(C(p.color3, '#8a8378'), { roughness: 0.6 }), cap = K.mat(C(p.color2, '#5a5d61'), { roughness: 0.6 }), ft = Math.min(0.05, h * 0.08), ct = Math.min(0.045, h * 0.06);
  g.add(box(w - 0.04, ft, d - 0.04, dark('#3a3835'), 0, ft / 2, 0), box(w - 0.02, h - ft - ct, d - 0.03, body, 0, ft + (h - ft - ct) / 2, -0.005), rbox(w, ct, d, cap, 0, h - ct / 2, 0, 0.015, 2));
  const dh = h - ft - ct - 0.03, dw = (w - 0.05) / 2, list = [], gr = [];
  for (const s of [-1, 1]) { list.push([dw - 0.006, dh, 0.02, s * dw / 2, ft + 0.015 + dh / 2, d / 2 - 0.012]); for (let k = 1; k < 4; k++) gr.push([0.006, dh - 0.1, 0.004, s * dw * k / 4, ft + 0.015 + dh / 2, d / 2 - 0.001]); }
  g.add(boxes(list, dm), boxes(gr, K.mat(K.shade(C(p.color3, '#8a8378'), -0.2))), boxes([[0.016, Math.min(0.22, dh * 0.2), 0.02, 0.03, ft + dh * 0.55, d / 2 - 0.004], [0.016, Math.min(0.22, dh * 0.2), 0.02, -0.03, ft + dh * 0.55, d / 2 - 0.004]], inox()));
}
function buildGreenhouse(g, o) {
  const { w, d, h, p } = o, fr = alu(C(p.color, '#d9dcdc')), gl = clear(C(p.color2, '#cfe6ea'), 0.22), rise = clamp(0.26 * w, 0.03, 0.45 * h), he = h - rise, b = 0.03, list = [], ang = Math.atan2(rise, w / 2), rl = Math.hypot(w / 2, rise);
  const nz = Math.max(1, Math.round(d / 0.62)), nx = Math.max(2, Math.round(w / 0.62));
  for (let j = 0; j <= nz; j++) { const z = lerp(-d / 2 + b / 2, d / 2 - b / 2, j / nz); for (const s of [-1, 1]) list.push([b, he, b, s * (w / 2 - b / 2), he / 2, z], [rl, b, b, s * (w / 4 - 0.004), he + rise / 2 - 0.012, z, 0, 0, -s * ang]); }
  for (const s of [-1, 1]) { list.push([b, b, d, s * (w / 2 - b / 2), he - b / 2, 0], [b * 1.3, 0.1, d, s * (w / 2 - b * 0.65), 0.05, 0], [w, 0.1, b * 1.3, 0, 0.05, s * (d / 2 - b * 0.65)], [w, b, b, 0, he - b / 2, s * (d / 2 - b / 2)]);
    for (let i = 1; i < nx; i++) { const x = lerp(-w / 2, w / 2, i / nx); list.push([b * 0.8, he + rise * (1 - Math.abs(x) / (w / 2)) - 0.02, b * 0.8, x, (he + rise * (1 - Math.abs(x) / (w / 2)) - 0.02) / 2, s * (d / 2 - b / 2)]); } }
  list.push([b * 1.4, b * 1.4, d, 0, h - b * 0.7, 0], [Math.min(0.7, w * 0.4), b, b * 1.2, 0, Math.min(1.9, he * 0.95), d / 2 - b * 0.4], [0.02, 0.14, 0.03, Math.min(0.3, w * 0.17) - 0.05, Math.min(1.0, he * 0.5), d / 2 + 0.002]);
  g.add(boxes(list, fr));
  const panes = [boxG(0.004, he - 0.1, d - b, w / 2 - b / 2, 0.1 + (he - 0.1) / 2, 0), boxG(0.004, he - 0.1, d - b, -w / 2 + b / 2, 0.1 + (he - 0.1) / 2, 0), boxG(rl, 0.004, d - b, w / 4, he + rise / 2 - 0.016, 0, 0, 0, -ang), boxG(rl, 0.004, d - b, -w / 4, he + rise / 2 - 0.016, 0, 0, 0, ang)];
  const gab = [[-w / 2 + b, 0.1], [-w / 2 + b, he - 0.01], [0, h - 0.04], [w / 2 - b, he - 0.01], [w / 2 - b, 0.1]];
  panes.push(prismG(gab, 0.004).translate(0, 0, d / 2 - b / 2), prismG(gab, 0.004).translate(0, 0, -d / 2 + b / 2));
  g.add(ns(merge(panes, gl)));
  const bw = Math.min(0.5, w * 0.28), bz = d - 0.3, wd = K.wood('pine');
  g.add(boxes([[bw, 0.025, bz, -w / 2 + b + bw / 2 + 0.03, Math.min(0.75, he * 0.45), 0], ...[-1, 1].flatMap((s) => [-1, 1].map((s2) => [0.035, Math.min(0.75, he * 0.45), 0.035, -w / 2 + b + 0.03 + bw / 2 + s * (bw / 2 - 0.03), Math.min(0.75, he * 0.45) / 2, s2 * (bz / 2 - 0.03)]))], wd));
  const pots = [], lf = [], yt = Math.min(0.75, he * 0.45) + 0.0125;
  for (let i = 0; i < Math.max(1, Math.round(bz / 0.4)); i++) { const z = lerp(-bz / 2 + 0.15, bz / 2 - 0.15, i / Math.max(1, Math.round(bz / 0.4) - 1 || 1)), x = -w / 2 + b + bw / 2 + 0.03; pots.push(cylG(0.075, 0.055, 0.12, x, yt + 0.06, z, 10)); lf.push(new THREE.ConeGeometry(0.1, 0.24 + (i % 2) * 0.1, 7).translate(x, yt + 0.12 + 0.12 + (i % 2) * 0.05, z)); }
  g.add(merge(pots, K.mat('#b9714f', { roughness: 0.9 })), merge(lf, K.foliage('#5d8a4a')));
}
function buildDogHouse(g, o) {
  const { w, d, h, p } = o, P = shedPalette(p, '#c9a476', '#8f3b2e'), S = shedShell(g, w, d, h, ['gable', 'pent', 'flat'].includes(p.roof) ? p.roof : 'gable', P.wall, P.roofM, MATS.includes(p.material) ? p.material : 'wood', Math.min(0.06, w * 0.08));
  const hw = Math.min(0.2, S.wb * 0.28), hh = Math.min(S.yw * 0.85, Math.max(hw * 1.2, S.yw * 0.72));
  g.add(at(prismZ(archProfile(hw + 0.03, hh + 0.03), 0.03, K.mat(C(p.color3, K.shade(P.wall, -0.25)), { roughness: 0.7 })), 0, 0.03, S.zf + 0.004), at(prismZ(archProfile(hw, hh), 0.034, dark('#141312')), 0, 0.03, S.zf + 0.004));
}
function shedSym(ctx, { w, d, h, p, px, v }) {
  const wallDef = v === 'storage-box' ? '#6b6460' : v === 'bin-store' ? '#a9825a' : v === 'dog-house' ? '#c9a476' : v === 'greenhouse' ? '#d9dcdc' : isWood(p.material) ? '#b98a5e' : isMetal(p.material) || v === 'bike-store' ? '#6f7f7a' : '#d9d2c2';
  const wall = K.tint(C(p.color, wallDef), 0.45), roofC = C(p.color2, v === 'dog-house' ? '#8f3b2e' : '#5a5d61'), ov = Math.min(6, w * 0.08, d * 0.08);
  if (v === 'storage-box') { rect(ctx, 0, 0, w, d, wall, INK, px, 3); rect(ctx, 0, 0, w - 6, d - 6, null, SOFT, px, 2); line(ctx, -w / 2 + 3, -d / 2 + 5, w / 2 - 3, -d / 2 + 5, SOFT, px); rect(ctx, 0, d / 2 - 2, 8, 3, '#55585c', null); return; }
  if (v === 'tall-cabinet') { rect(ctx, 0, 0, w, d, wall, INK, px, 2); line(ctx, 0, d / 2, 0, d / 2 - 4, INK, px); dashed(ctx, px, () => { for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * w / 2, d / 2, Math.max(0, w / 2), s > 0 ? PI / 2 : 0, s > 0 ? PI : PI / 2); ctx.strokeStyle = SOFT; ctx.lineWidth = px; ctx.stroke(); } }); return; }
  if (v === 'bin-store') { const n = Math.max(1, Math.round(w / 72)); rect(ctx, 0, 0, w, d, wall, INK, px, 1); for (let i = 0; i < n; i++) { const x = -w / 2 + (w / n) * (i + 0.5); rect(ctx, x, 0, w / n - 6, d - 6, K.tint(C(p.color, wallDef), 0.6), SOFT, px, 1); hatch(ctx, x - w / n / 2 + 3, -d / 2 + 3, x + w / n / 2 - 3, d / 2 - 3, Math.min(6, Math.floor(d / (4 * px))), true, SOFT, px); } return; }
  if (v === 'greenhouse') {
    rect(ctx, 0, 0, w, d, rgba('#bfe0e6', 0.45), INK, px); hatch(ctx, -w / 2, -d / 2, w / 2, d / 2, Math.max(1, Math.round(d / 62) - 1), true, SOFT, px); hatch(ctx, -w / 2, -d / 2, w / 2, d / 2, 1, false, INK, px);
    rect(ctx, -w / 2 + Math.min(50, w * 0.28) / 2 + 6, 0, Math.min(50, w * 0.28), d - 30, rgba('#c9a476', 0.5), SOFT, px); line(ctx, -Math.min(35, w * 0.2), d / 2, Math.min(35, w * 0.2), d / 2, INK, 2.5 * px); return;
  }
  const roof = ['gable', 'pent', 'flat'].includes(p.roof) ? p.roof : v === 'bike-store' ? 'pent' : 'gable';
  rect(ctx, 0, 0, w, d, K.tint(roofC, 0.55), INK, px, 1); dashed(ctx, px, () => rect(ctx, 0, 0, w - 2 * ov, d - 2 * ov, null, SOFT, px));
  if (roof === 'gable') { hatch(ctx, -w / 2, -d / 2, w / 2, d / 2, Math.min(Math.max(3, Math.round(w / 22) | 1), Math.floor(w / (4 * px))), false, SOFT, px); line(ctx, 0, -d / 2, 0, d / 2, INK, 1.6 * px); }
  else if (roof === 'pent') { hatch(ctx, -w / 2, -d / 2, w / 2, d / 2, Math.min(Math.max(2, Math.round(d / 25)), Math.floor(d / (4 * px))), true, SOFT, px); line(ctx, 0, d * 0.25, 0, -d * 0.25, SOFT, px); poly(ctx, [[-3 * px, -d * 0.25 + 4 * px], [0, -d * 0.25], [3 * px, -d * 0.25 + 4 * px]], null, SOFT, px, false); }
  if (v === 'dog-house') { rect(ctx, 0, d / 2 - 2, Math.min(40, w * 0.5), 4, '#4a4744', INK, px, 1); return; }
  const n = v === 'bike-store' ? 2 : Math.round(num(p.doors, w >= 150 ? 2 : 1, 1, 2)), wb = w - 2 * ov, dw = v === 'bike-store' ? (wb - 14) / n : Math.min(80, (wb - 24) / n), tw = n * dw;
  line(ctx, -tw / 2, d / 2 - ov, tw / 2, d / 2 - ov, K.shade(C(p.color3, '#8a8378'), -0.2), Math.max(2.5 * px, 3));
  if (h > 150) dashed(ctx, px, () => { for (let i = 0; i < n; i++) { const hx = n === 1 ? -tw / 2 : (i ? tw / 2 : -tw / 2), r = Math.max(0, Math.min(dw, 45)), left = n === 1 || !i; ctx.beginPath(); ctx.arc(hx, d / 2 - ov, r, left ? 0 : PI / 2, left ? PI / 2 : PI); ctx.strokeStyle = SOFT; ctx.lineWidth = px; ctx.stroke(); } });
}
define('shed', { shed: { b: buildShed }, 'storage-box': { b: buildStorageBox }, 'bin-store': { b: buildBinStore }, 'tall-cabinet': { b: buildTallCabinet }, 'bike-store': { b: buildShed }, greenhouse: { b: buildGreenhouse }, 'dog-house': { b: buildDogHouse } }, shedSym, true);

// ═════════════════════════ FIRE PIT ═════════════════════════
function logsG(x, y, z, r) {
  const mk = (a, tilt, dy) => { const c = new THREE.CylinderGeometry(r * 0.16, r * 0.16, r * 1.5, 7); c.rotateZ(PI / 2 - tilt); c.rotateY(a); c.translate(x, y + r * 0.2 + dy, z); return c; };
  return merge([mk(0.3, 0.2, 0), mk(2.3, 0.25, r * 0.12), mk(4.4, 0.2, r * 0.2)], K.wood('#5a4332'));
}
function buildFirePit(g, o) {
  const { w, d, h, p, v } = o, isLit = flag(p.lit, false), R = Math.min(w, d) / 2;
  if (v === 'bowl') {
    const m = K.metal(C(p.color, '#8a5a3c'), { roughness: 0.8, metalness: 0.3 }), st = alu(C(p.color2, '#2b2d31')), yb = 0.38 * h, bh = h - yb;
    g.add(mesh(latheG([[0, yb], [0.55 * R, yb + 0.22 * bh], [0.88 * R, yb + 0.66 * bh], [R, h]], 24), K.mat(C(p.color, '#8a5a3c'), { roughness: 0.8, metalness: 0.3, side: THREE.DoubleSide })), mesh(torusG(R - 0.008, 0.008, 'xz', 0, h - 0.008, 0, 24, 5), m));
    g.add(rods([0, 1, 2].map((i) => { const a = PI / 2 + (i * TAU) / 3; return [[Math.cos(a) * R * 0.5, yb + 0.2 * bh, Math.sin(a) * R * 0.5], [Math.cos(a) * R * 0.78, 0, Math.sin(a) * R * 0.78]]; }), 0.014, st, 6), mesh(torusG(R * 0.62, 0.01, 'xz', 0, yb * 0.55, 0, 20, 4), st));
    g.add(cyl(0.7 * R, 0.7 * R, 0.01, dark('#2a2725'), 0, yb + 0.42 * bh, 0, 16), logsG(0, yb + 0.42 * bh, 0, Math.min(R * 0.5, bh * 1.1)));
    if (isLit) fire(g, 0, yb + 0.5 * bh, 0, R * 0.38, Math.max(0.28, h * 0.9));
  } else if (v === 'table') {
    const body = M(p.material, C(p.color, '#8d8f92'), 'concrete'), tw = w * 0.62, td = Math.min(d * 0.42, 0.3);
    g.add(box(w - 0.1, 0.06, d - 0.1, dark(), 0, 0.03, 0), box(w, h - 0.07, d, body, 0, 0.06 + (h - 0.07) / 2, 0), box(tw + 0.03, 0.006, td + 0.03, inox(), 0, h - 0.007, 0), box(tw, 0.008, td, dark('#2a2725'), 0, h - 0.004, 0));
    const rk = seedOf(o, 'rk'), rocks = [], n = Math.max(6, Math.round(tw / 0.06));
    for (let i = 0; i < n; i++) rocks.push(new THREE.IcosahedronGeometry(0.02 + rk() * 0.012, 0).translate(lerp(-tw / 2 + 0.03, tw / 2 - 0.03, i / (n - 1)), h - 0.012, (rk() - 0.5) * (td - 0.06)));
    g.add(merge(rocks, K.mat(C(p.color2, '#4a433d'), { roughness: 1, flat: true })));
    if (isLit) { fire(g, 0, h, 0, 0.09, 0.2); fire(g, -tw * 0.28, h, 0, 0.07, 0.15, false); fire(g, tw * 0.28, h, 0, 0.07, 0.16, false); }
  } else if (v === 'chiminea') {
    const st = alu(C(p.color2, '#2b2d31'));
    g.add(lathe([[0.3 * R, 0.14 * h], [0.8 * R, 0.2 * h], [0.97 * R, 0.36 * h], [0.9 * R, 0.5 * h], [0.45 * R, 0.64 * h], [0.3 * R, 0.7 * h], [0.26 * R, 0.96 * h], [0.34 * R, h]], K.mat(C(p.color, '#b9714f'), { roughness: 0.9, side: THREE.DoubleSide }), 20));
    g.add(at(prismZ(archProfile(0.4 * R, 0.2 * h), 0.1, dark('#120f0e')), 0, 0.25 * h, 0.82 * R), mesh(torusG(R * 0.72, 0.012, 'xz', 0, 0.17 * h, 0, 18, 4), st), rods([0, 1, 2].map((i) => { const a = PI / 2 + (i * TAU) / 3; return [[Math.cos(a) * R * 0.72, 0.17 * h, Math.sin(a) * R * 0.72], [Math.cos(a) * R * 0.97, 0, Math.sin(a) * R * 0.97]]; }), 0.012, st, 6));
    if (isLit) fire(g, 0, 0.26 * h, 0.7 * R, 0.2 * R, 0.14 * h);
  } else if (v === 'heater-mushroom') {
    const m = M(p.material, C(p.color, '#c9ccd0'), 'metal'), rb = Math.min(R, 0.23), hk = h / 2.2;
    g.add(cylOn(rb, rb, 0.04, dark(), 0, 0, 0, 20), cylOn(rb * 0.82, rb * 0.82, 0.78 * hk, m, 0, 0.04, 0, 20), cylOn(0.028, 0.028, h - 0.36 * hk - 0.78 * hk, m, 0, 0.04 + 0.78 * hk, 0, 10));
    g.add(cylOn(0.085, 0.085, 0.2 * hk, isLit ? K.glow('#ff7a2b', 1.3) : dark('#55585c'), 0, h - 0.36 * hk, 0, 14), cylOn(0.1, 0.1, 0.03, m, 0, h - 0.39 * hk, 0, 14));
    g.add(mesh(latheG([[R, h - 0.1 * hk], [0.6 * R, h - 0.035 * hk], [0.1 * R, h - 0.012], [0, h]], 24), K.mat(C(p.color, '#c9ccd0'), { roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide })));
    if (isLit) g.add(K.lampLight('#ff9a4a', 1.2, 5, 0, h - 0.4 * hk, 0));
  } else if (v === 'heater-pyramid') {
    const m = M(p.material, C(p.color, '#c9ccd0'), 'metal'), frame = [];
    g.add(mesh(taperG(w, d, w * 0.72, d * 0.72, 0.36 * h), m), mesh(taperG(w * 0.66, d * 0.66, w * 0.2, d * 0.2, 0.1 * h, 0, 0.9 * h), m));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame.push([[sx * w * 0.34, 0.36 * h, sz * d * 0.34], [sx * w * 0.2, 0.9 * h, sz * d * 0.2]]);
    g.add(rods(frame, 0.012, m, 5), ns(cylOn(Math.min(w, d) * 0.13, Math.min(w, d) * 0.13, 0.53 * h, clear('#dfe9ec', 0.25), 0, 0.37 * h, 0, 14)));
    if (isLit) { const f = ns(mesh(new THREE.ConeGeometry(Math.min(w, d) * 0.07, 0.42 * h, 8).translate(0, 0.6 * h, 0), K.glow('#ff8a2b', 1.6))); g.add(f, K.lampLight('#ff9a4a', 1.2, 5, 0, 0.6 * h, 0)); }
  } else {
    const col = C(p.color, '#8a5a3c');
    g.add(mesh(latheG([[R - 0.012, 0], [R - 0.012, h], [R, h], [R, 0]], 28), K.metal(col, { roughness: 0.85, metalness: 0.25 })), cyl(R - 0.02, R - 0.02, 0.02, K.mat(C(p.color2, '#5a544d'), { roughness: 1 }), 0, Math.min(0.05, h * 0.3), 0, 20), logsG(0, Math.min(0.06, h * 0.3), 0, R * 0.6));
    if (isLit) fire(g, 0, Math.min(0.1, h * 0.4), 0, R * 0.36, Math.max(0.3, h * 1.3));
  }
}
function firePitSym(ctx, { w, d, p, px, v }) {
  const col = C(p.color, v === 'table' ? '#8d8f92' : v.startsWith('heater') ? '#c9ccd0' : v === 'chiminea' ? '#b9714f' : '#8a5a3c'), R = Math.min(w, d) / 2, ember = flag(p.lit, false) ? '#f6a04a' : '#6a5a52';
  if (v === 'table') { rect(ctx, 0, 0, w, d, K.tint(col, 0.5), INK, px, 2); rect(ctx, 0, 0, w * 0.62, Math.min(d * 0.42, 30), ember, INK, px, 2); return; }
  if (v === 'heater-pyramid') { rect(ctx, 0, 0, w, d, K.tint(col, 0.5), INK, px, 1); rect(ctx, 0, 0, w * 0.66, d * 0.66, null, SOFT, px); circ(ctx, 0, 0, R * 0.26, ember, INK, px); return; }
  ell(ctx, 0, 0, w / 2, d / 2, K.tint(col, v === 'heater-mushroom' ? 0.6 : 0.4), INK, px);
  if (v === 'heater-mushroom') { for (let i = 0; i < 8; i++) line(ctx, Math.cos(i * PI / 4) * R * 0.3, Math.sin(i * PI / 4) * R * 0.3, Math.cos(i * PI / 4) * R * 0.95, Math.sin(i * PI / 4) * R * 0.95, SOFT, px); circ(ctx, 0, 0, R * 0.26, ember, INK, px); }
  else if (v === 'chiminea') { circ(ctx, 0, 0, R * 0.34, K.tint(col, 0.2), INK, px); rect(ctx, 0, R * 0.8, R * 0.7, R * 0.22, '#4a4744', INK, px, 1); }
  else { ell(ctx, 0, 0, w / 2 * 0.8, d / 2 * 0.8, ember, SOFT, px); line(ctx, -R * 0.4, -R * 0.15, R * 0.4, R * 0.2, INK, 1.5 * px); line(ctx, -R * 0.3, R * 0.3, R * 0.35, -R * 0.3, INK, 1.5 * px); }
}
define('fire-pit', Object.fromEntries(['bowl', 'table', 'chiminea', 'heater-mushroom', 'heater-pyramid', 'ring'].map((k) => [k, { b: buildFirePit }])), firePitSym);

// ═════════════════════════ SWING BENCH / HAMMOCK ═════════════════════════
function hammockG(x0, x1, yEnd, sag, hw, gathered) {
  return surfG((u, t) => {
    const s = Math.sin(PI * u), k = gathered ? 0.03 + 0.97 * s ** 0.7 : 0.8 + 0.2 * s, vv = 2 * t - 1;
    return [lerp(x0, x1, u), yEnd - sag * s + 0.22 * hw * vv * vv * k, vv * hw * k];
  }, 16, 6);
}
function swingBench(g, o) {
  const { w, d, h, p } = o, fab = K.fabric(C(p.color, '#e3d9c2')), fr = M(p.material2, C(p.color2, '#3a3d42'), 'metal'), acc = K.fabric(C(p.color3, K.shade(C(p.color, '#e3d9c2'), -0.15)));
  const can = flag(p.canopy, true), yt = can ? h - 0.13 : h - 0.024, x = w / 2 - 0.024, zf = d / 2 - 0.024, list = [];
  for (const s of [-1, 1]) list.push([[s * x, yt, 0], [s * x, 0.024, zf]], [[s * x, yt, 0], [s * x, 0.024, -zf]], [[s * x, 0.024, -zf], [s * x, 0.024, zf]], [[s * x, yt * 0.42, -zf * 0.56], [s * x, yt * 0.42, zf * 0.56], 0.016]);
  list.push([[-x, yt, 0], [x, yt, 0]], [[-x, 0.024, -zf], [x, 0.024, -zf], 0.018]);
  const sw = w - 0.34, sy = Math.min(0.42, yt * 0.35), sd = Math.min(0.56, d * 0.5), n = Math.round(num(p.seats, Math.round(sw / 0.56), 1, 6)), cw = sw / n;
  for (const s of [-1, 1]) list.push([[s * sw / 2, yt, 0], [s * (sw / 2 + 0.01), sy + 0.2, sd / 2 - 0.04], 0.006], [[s * sw / 2, yt, 0], [s * (sw / 2 + 0.01), sy + 0.2, -sd / 2 + 0.02], 0.006], [[s * (sw / 2 + 0.01), sy + 0.2, sd / 2 - 0.02], [s * (sw / 2 + 0.01), sy + 0.2, -sd / 2], 0.014], [[s * (sw / 2 + 0.01), sy, sd / 2 - 0.04], [s * (sw / 2 + 0.01), sy + 0.2, sd / 2 - 0.04], 0.012]);
  if (can) for (const s of [-1, 1]) list.push([[s * x, yt, 0], [s * x, h - 0.02, d * 0.3], 0.012], [[s * x, yt, 0], [s * x, h - 0.02, -d * 0.3], 0.012]);
  g.add(rods(list, 0.024, fr, 8), box(sw, 0.03, sd, fr, 0, sy - 0.015, 0), rot(box(sw, 0.42, 0.025, fr, 0, sy + 0.2, -sd / 2 - 0.02), -0.2));
  for (let i = 0; i < n; i++) { const cx = -sw / 2 + cw * (i + 0.5); g.add(rbox(cw - 0.012, 0.1, sd - 0.03, fab, cx, sy + 0.05, 0.01, 0.035, 2), rot(rbox(cw - 0.012, 0.4, 0.1, i % 2 ? acc : fab, cx, sy + 0.28, -sd / 2 + 0.07, 0.04, 2), -0.2)); }
  if (can) g.add(box(w, 0.016, d, cloth(C(p.color, '#e3d9c2')), 0, h - 0.008, 0), boxes([[w, 0.1, 0.005, 0, h - 0.06, d / 2 - 0.0025], [w, 0.1, 0.005, 0, h - 0.06, -d / 2 + 0.0025]], cloth(C(p.color, '#e3d9c2'))));
}
function hammockStand(g, o) {
  const { w, d, h, p } = o, fab = cloth(C(p.color, '#e9e2d0')), st = M(p.material2, C(p.color2, 'teak'), 'wood'), tip = w / 2 - 0.04, xe = 0.34 * w, hw = Math.max(0.05, d / 2 - 0.08);
  g.add(mesh(tubeG([[-tip, h - 0.04, 0], [-0.4 * w, 0.52 * h, 0], [-0.24 * w, 0.12 * h, 0], [0, 0.045, 0], [0.24 * w, 0.12 * h, 0], [0.4 * w, 0.52 * h, 0], [tip, h - 0.04, 0]], 0.036, 30, 7), st), boxes([[0.08, 0.05, d, -0.2 * w, 0.025, 0], [0.08, 0.05, d, 0.2 * w, 0.025, 0]], st));
  g.add(mesh(hammockG(-xe, xe, 0.7 * h, 0.3 * h, hw, false), fab), rods([[[-xe, 0.7 * h + 0.2 * hw, -hw * 0.82], [-xe, 0.7 * h + 0.2 * hw, hw * 0.82]], [[xe, 0.7 * h + 0.2 * hw, -hw * 0.82], [xe, 0.7 * h + 0.2 * hw, hw * 0.82]]], 0.014, K.wood('oak'), 6));
  const ropes = []; for (const s of [-1, 1]) for (let i = 0; i < 5; i++) ropes.push([[s * (tip - 0.02), h - 0.07, 0], [s * xe, 0.7 * h + 0.2 * hw, lerp(-hw * 0.8, hw * 0.8, i / 4)]]);
  g.add(rods(ropes, 0.003, K.mat('#efe9dc'), 3));
}
function hammockPosts(g, o) {
  const { w, d, h, p } = o, fab = cloth(C(p.color, '#c9d6c6')), st = M(p.material2, C(p.color2, '#8a6a4a'), 'wood'), px_ = w / 2 - 0.06, hook = 0.86 * h, xe = 0.38 * w, ye = hook - 0.1 * h, sag = Math.max(0.05, Math.min(0.42 * h, ye - 0.45));
  g.add(merge([cylG(0.055, 0.06, h, -px_, h / 2, 0, 12), cylG(0.055, 0.06, h, px_, h / 2, 0, 12)], st), mesh(hammockG(-xe, xe, ye, sag, d / 2, true), fab));
  g.add(rods([[[-px_ + 0.05, hook, 0], [-xe, ye, 0]], [[px_ - 0.05, hook, 0], [xe, ye, 0]]], 0.006, K.mat('#efe9dc'), 4), rbox(0.4, 0.1, Math.min(0.4, d * 0.6), K.fabric(C(p.color3, '#efe9dc')), -xe * 0.62, ye - sag * 0.75 + 0.06, 0, 0.04, 2));
}
function hangingChair(g, o) {
  const { w, d, h, p } = o, fab = cloth(C(p.color, '#e9e2d0')), st = alu(C(p.color2, '#2b2d31')), R = Math.min(w, d) / 2, Rb = R - 0.025, ysp = h - 0.42, sw = Math.min(0.48, R * 0.85), ys = Math.min(0.45, h * 0.3);
  g.add(mesh(torusG(Rb, 0.025, 'xz', 0, 0.025, 0, 28, 6), st), mesh(tubeG([[0, 0.03, -Rb], [0, h * 0.45, -Rb + 0.01], [0, h * 0.82, -Rb * 0.86], [0, h - 0.04, -Rb * 0.4], [0, h - 0.035, 0.02]], 0.024, 24, 7), st));
  g.add(rods([[[-sw, ysp, 0], [sw, ysp, 0]]], 0.018, K.wood('oak'), 8), rods([[[0, h - 0.05, 0.02], [-sw, ysp, 0]], [[0, h - 0.05, 0.02], [sw, ysp, 0]], [[-sw, ysp, 0], [-sw * 0.92, ys + 0.2, 0.3]], [[sw, ysp, 0], [sw * 0.92, ys + 0.2, 0.3]]], 0.005, K.mat('#efe9dc'), 4));
  g.add(mesh(surfG((u, t) => { const uu = 2 * u - 1, zz = lerp(-0.26, 0.32, t), yy = t < 0.55 ? lerp(ysp - 0.03, ys, smooth(t / 0.55)) : lerp(ys, ys + 0.14, (t - 0.55) / 0.45); return [uu * sw * 0.95, yy + 0.3 * uu * uu * (ysp - ys) * (0.25 + 0.75 * (1 - t) * (1 - t)) * (t > 0.02 ? 1 : 0), zz]; }, 8, 10), fab));
  g.add(rbox(sw * 1.3, 0.09, 0.4, K.fabric(C(p.color3, '#9aa89a')), 0, ys + 0.07, 0.08, 0.04, 2));
}
function porchSwing(g, o) {
  const { w, d, h, p } = o, wd = M(p.material, C(p.color, '#b98a5e'), 'wood'), x = w / 2 - 0.045, yt = h - 0.05, zf = d / 2 - 0.05, len = Math.hypot(yt, zf), a = Math.atan2(zf, yt), list = [];
  for (const s of [-1, 1]) list.push([0.09, len, 0.09, s * x, yt / 2, zf / 2, -a], [0.09, len, 0.09, s * x, yt / 2, -zf / 2, a], [0.06, 0.07, zf * 1.25, s * x, yt * 0.38, 0], [0.09, 0.06, d, s * x, 0.03, 0]);
  list.push([w, 0.1, 0.1, 0, yt, 0]);
  const bw = w - 0.5, sy = Math.min(0.44, yt * 0.3), sd = Math.min(0.5, d * 0.42);
  for (let i = 0; i < 5; i++) list.push([bw, 0.022, sd / 5 - 0.012, 0, sy, lerp(-sd / 2, sd / 2, (i + 0.5) / 5)]);
  for (let i = 0; i < 4; i++) list.push([bw, 0.075, 0.022, 0, sy + 0.1 + i * 0.1, -sd / 2 - 0.02 - i * 0.022, -0.2]);
  for (const s of [-1, 1]) list.push([0.05, 0.03, sd + 0.05, s * (bw / 2 + 0.02), sy + 0.22, 0], [0.05, 0.22, 0.05, s * (bw / 2 + 0.02), sy + 0.11, sd / 2 - 0.03], [0.05, 0.5, 0.05, s * (bw / 2 + 0.02), sy + 0.24, -sd / 2 - 0.045, -0.2]);
  g.add(boxes(list, wd), rods([-1, 1].flatMap((s) => [[[s * (bw / 2 + 0.02), yt - 0.05, 0], [s * (bw / 2 + 0.02), sy + 0.24, sd / 2 - 0.03]], [[s * (bw / 2 + 0.02), yt - 0.05, 0], [s * (bw / 2 + 0.02), sy + 0.46, -sd / 2 - 0.09]]]), 0.005, inox(), 4));
}
function swingSym(ctx, { w, d, h, p, px, v }) {
  const fab = C(p.color, v === 'hammock-trees' ? '#c9d6c6' : v === 'porch-swing' ? '#b98a5e' : '#e3d9c2'), fr = C(p.color2, v === 'hammock-stand' ? '#a9743f' : '#3a3d42');
  const lens = (hx, hy) => { ctx.beginPath(); ctx.moveTo(-hx, 0); ctx.quadraticCurveTo(0, -hy * 2, hx, 0); ctx.quadraticCurveTo(0, hy * 2, -hx, 0); ctx.closePath(); ctx.fillStyle = K.tint(fab, 0.35); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke(); hatch(ctx, -hx * 0.7, -hy * 0.6, hx * 0.7, hy * 0.6, Math.min(7, Math.floor(hx / (3 * px))), false, SOFT, px); };
  if (v === 'hammock-stand') { for (const s of [-1, 1]) line(ctx, s * 0.2 * w, -d / 2, s * 0.2 * w, d / 2, fr, Math.max(2 * px, 8)); line(ctx, -w / 2 + 4, 0, w / 2 - 4, 0, fr, Math.max(2 * px, 7)); lens(0.36 * w, d / 2 - 8); return; }
  if (v === 'hammock-trees') { line(ctx, -w / 2 + 6, 0, w / 2 - 6, 0, SOFT, px); lens(0.38 * w, d / 2); for (const s of [-1, 1]) circ(ctx, s * (w / 2 - 6), 0, 6, K.tint('#8a6a4a', 0.2), INK, px); return; }
  if (v === 'hanging-chair') { const R = Math.min(w, d) / 2; circ(ctx, 0, 0, R - 1.5, null, fr, Math.max(px, 3)); ell(ctx, 0, R * 0.08, R * 0.7, R * 0.5, K.tint(fab, 0.4), INK, px); line(ctx, -R * 0.75, 0, R * 0.75, 0, '#8a6a4a', Math.max(1.5 * px, 3)); circ(ctx, 0, -R + 2.5, Math.max(2.5, 1.5 * px), fr, null); return; }
  const can = v === 'swing-bench' && flag(p.canopy, true), sw = w - (v === 'porch-swing' ? 50 : 34), sd = Math.min(v === 'porch-swing' ? 50 : 56, d * 0.5);
  for (const s of [-1, 1]) line(ctx, s * (w / 2 - 2.5), -d / 2, s * (w / 2 - 2.5), d / 2, fr, Math.max(1.6 * px, v === 'porch-swing' ? 9 : 4.5));
  line(ctx, -w / 2, 0, w / 2, 0, fr, Math.max(1.6 * px, v === 'porch-swing' ? 10 : 4.5));
  rect(ctx, 0, 0, sw, sd, K.tint(fab, 0.4), INK, px, 3);
  if (v === 'porch-swing') hatch(ctx, -sw / 2, -sd / 2, sw / 2, sd / 2, 4, true, SOFT, px);
  else { const n = Math.round(num(p.seats, Math.round(sw / 56), 1, 6)); for (let i = 1; i < n; i++) line(ctx, -sw / 2 + (sw / n) * i, -sd / 2, -sw / 2 + (sw / n) * i, sd / 2, SOFT, px); line(ctx, -sw / 2, -sd / 2 + 9, sw / 2, -sd / 2 + 9, SOFT, px); }
  if (can) { ctx.fillStyle = rgba(fab, 0.22); ctx.fillRect(-w / 2, -d / 2, w, d); dashed(ctx, px, () => rect(ctx, 0, 0, w, d, null, INK, px)); }
}
define('swing-bench', { 'swing-bench': { b: swingBench }, 'hammock-stand': { b: hammockStand }, 'hammock-trees': { b: hammockPosts }, 'hanging-chair': { b: hangingChair }, 'porch-swing': { b: porchSwing } }, swingSym);

// ═════════════════════════ OUTDOOR LIGHT ═════════════════════════
function buildLight(g, o) {
  const { w, d, h, p, v } = o, on = p.on !== false && p.on !== 'false' && p.on !== 0, lc = C(p.lightColor, '#ffe2b0'), body = M(p.material, C(p.color, v === 'post-lantern' || v === 'lantern' ? '#26282b' : '#3a3d42'), 'metal');
  const gm = on ? K.glow(lc, 1.5) : K.mat(C(p.color2, '#eeeae0'), { roughness: 0.5 }), R = Math.min(w, d) / 2;
  let L = [0, h * 0.85, 0, 1, 4];
  if (v === 'bollard') {
    g.add(cylOn(R, R, 0.78 * h, body, 0, 0, 0, 16), ns(cylOn(R * 0.82, R * 0.82, 0.15 * h, gm, 0, 0.78 * h, 0, 16)), cylOn(R, R, 0.07 * h, body, 0, 0.93 * h, 0, 16));
  } else if (v === 'spike-spot') {
    const head = new THREE.Group(), r = Math.min(w / 2, h * 0.3);
    head.add(mesh(zCylG(r, d * 0.7, 0, 0, 0, 14), body), ns(mesh(zCylG(r * 0.82, 0.006, 0, 0, d * 0.35 + 0.002, 14), gm)));
    head.position.set(0, 0.62 * h, 0); head.rotation.x = -0.6;
    g.add(head, cylOn(0.008, 0.004, 0.5 * h, body, 0, 0, 0, 6), box(0.02, 0.12 * h, 0.02, body, 0, 0.5 * h, 0)); L = [0, 0.8 * h, d * 0.3, 0.8, 4];
  } else if (v === 'post-lantern' || v === 'lantern') {
    const y0 = v === 'lantern' ? 0 : 0.8 * h, lh = h - y0, hw = w / 2, hd = d / 2, fr = [];
    if (v === 'post-lantern') g.add(cylOn(Math.min(0.09, R), Math.min(0.09, R), 0.03, body, 0, 0, 0, 14), cylOn(0.03, 0.04, y0 - 0.03, body, 0, 0.03, 0, 12));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) fr.push([[sx * hw * 0.62, y0 + 0.08 * lh, sz * hd * 0.62], [sx * hw * 0.82, y0 + 0.66 * lh, sz * hd * 0.82]]);
    g.add(rods(fr, Math.min(0.012, R * 0.08), body, 4), mesh(taperG(w * 0.5, d * 0.5, w * 0.66, d * 0.66, 0.08 * lh, 0, y0), body), mesh(taperG(w, d, w * 0.16, d * 0.16, 0.22 * lh, 0, y0 + 0.66 * lh), body));
    g.add(mesh(torusG(Math.min(0.5 * R, 0.06 * lh + 0.01), Math.min(0.006, R * 0.06), 'xy', 0, h - 0.06 * lh - 0.01, 0, 12, 4), body));
    g.add(ns(mesh(taperG(w * 0.6, d * 0.6, w * 0.8, d * 0.8, 0.58 * lh, 0, y0 + 0.08 * lh), clear('#e6eef0', 0.22))), ns(v === 'lantern' ? cylOn(R * 0.28, R * 0.28, 0.3 * lh, gm, 0, y0 + 0.08 * lh, 0, 10) : sphere(Math.min(R * 0.4, 0.06), gm, 0, y0 + 0.36 * lh, 0, 10, 8)));
    L = [0, y0 + 0.4 * lh, 0, v === 'lantern' ? 0.5 : 1.3, v === 'lantern' ? 3 : 6];
  } else if (v === 'string') {
    const pr = Math.min(0.022, d / 2), px_ = w / 2 - Math.max(d / 2, pr), span = 2 * px_, sag = Math.min(0.1 * span, 0.3 * h), yy = (t) => h - 0.04 - sag * (1 - (2 * t - 1) ** 2), wire = [], bulbs = [], sock = [];
    g.add(merge([cylG(pr, pr, h, -px_, h / 2, 0, 8), cylG(pr, pr, h, px_, h / 2, 0, 8), cylG(d / 2, d / 2, 0.02, -px_, 0.01, 0, 12), cylG(d / 2, d / 2, 0.02, px_, 0.01, 0, 12)], body));
    for (let i = 0; i < 16; i++) wire.push([[lerp(-px_, px_, i / 16), yy(i / 16), 0], [lerp(-px_, px_, (i + 1) / 16), yy((i + 1) / 16), 0]]);
    const n = Math.round(num(p.count, Math.round(span / 0.35), 2, 60)), br = clamp(span / n * 0.12, 0.012, 0.03);
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, x = lerp(-px_, px_, t); sock.push(cylG(br * 0.45, br * 0.45, br, x, yy(t) - br * 0.5, 0, 6)); bulbs.push(new THREE.SphereGeometry(br, 7, 5).translate(x, yy(t) - br * 1.7, 0)); }
    g.add(rods(wire, 0.003, dark(), 3), merge(sock, dark()), ns(merge(bulbs, gm))); L = [0, h - sag - 0.15, 0, 1.4, 7];
  } else if (v === 'wall' || v === 'step') {
    const bz = v === 'wall' ? 0.15 : 0.5;
    g.add(box(w * (v === 'wall' ? 0.7 : 1), h * (v === 'wall' ? 0.8 : 1), d * bz, body, 0, h / 2, -d / 2 + d * bz / 2));
    if (v === 'wall') g.add(box(w, h, d * 0.85, body, 0, h / 2, d * 0.075), ns(boxes([[w * 0.7, 0.003, d * 0.6, 0, h + 0.0005, d * 0.08], [w * 0.7, 0.003, d * 0.6, 0, -0.0005, d * 0.08]], gm)));
    else g.add(ns(box(w * 0.8, h * 0.4, 0.002, gm, 0, h * 0.4, 0.001)), boxes([0, 1, 2].map((i) => [w * 0.86, h * 0.07, d * 0.5, 0, h * (0.25 + i * 0.16), d * 0.25, 0.5]), body), boxes([[w, h * 0.12, d * 0.5, 0, h * 0.94, d * 0.25], [w, h * 0.12, d * 0.5, 0, h * 0.06, d * 0.25], [w * 0.08, h, d * 0.5, w * 0.46, h / 2, d * 0.25], [w * 0.08, h, d * 0.5, -w * 0.46, h / 2, d * 0.25]], body));
    L = [0, h / 2, d, 0.7, 3.5];
  } else if (v === 'solar-path') {
    g.add(cylOn(0.009, 0.005, 0.56 * h, body, 0, 0, 0, 6), ns(cylOn(R * 0.72, R * 0.6, 0.3 * h, on ? gm : clear('#eef2f2', 0.5), 0, 0.56 * h, 0, 12)), cylOn(R, R, 0.1 * h, body, 0, 0.86 * h, 0, 14), box(R * 1.1, 0.04 * h, R * 1.1, K.mat('#1c2a44', { roughness: 0.2, metalness: 0.4 }), 0, 0.98 * h, 0)); L = [0, 0.7 * h, 0, 0.5, 2.5];
  } else if (v === 'flood') {
    const head = new THREE.Group();
    head.add(box(w, 0.62 * h, d * 0.42, body, 0, 0, 0), ns(box(w * 0.88, 0.5 * h, 0.004, gm, 0, 0, d * 0.21 + 0.002)), boxes([0, 1, 2, 3, 4].map((i) => [w * 0.8, 0.012, d * 0.1, 0, lerp(-0.22, 0.22, i / 4) * h, -d * 0.25]), body));
    head.position.set(0, 0.6 * h, 0); head.rotation.x = -0.35;
    g.add(head, box(w * 0.6, 0.02, d * 0.7, body, 0, 0.01, 0), boxes([[0.012, 0.6 * h, 0.03, w / 2 + 0.006, 0.3 * h, 0], [0.012, 0.6 * h, 0.03, -w / 2 - 0.006, 0.3 * h, 0], [w + 0.024, 0.012, 0.03, 0, 0.026, 0]], body)); L = [0, 0.7 * h, d, 1.6, 8];
  } else {
    const sg = new THREE.SphereGeometry(0.5, 22, 14); sg.scale(w, 0.95 * h, d); sg.translate(0, 0.05 * h + 0.475 * h, 0);
    g.add(ns(mesh(sg, on ? K.glow(lc, 1.1) : K.mat('#f1efe8', { roughness: 0.4 }))), cylOn(R * 0.45, R * 0.5, 0.08 * h, body, 0, 0, 0, 14)); L = [0, h * 0.5, 0, 1.2, 5];
  }
  if (on) g.add(K.lampLight(lc, L[3], L[4], L[0], L[1], L[2]));
}
function lightSym(ctx, { w, d, p, px, v }) {
  const on = p.on !== false, col = C(p.color, '#3a3d42'), lc = C(p.lightColor, '#ffe2b0'), R = Math.max(Math.min(w, d) / 2, 2.5 * px);
  if (v === 'string') {
    const x = w / 2 - d / 2, n = Math.round(num(p.count, Math.round(2 * x / 35), 2, 60)), r = Math.max(1.2 * px, Math.min(4, x / n * 0.6));
    line(ctx, -x, 0, x, 0, INK, px);
    for (let i = 0; i < n; i++) circ(ctx, lerp(-x, x, (i + 0.5) / n), 0, r, on ? '#ffd27a' : '#eeeae0', INK, px * 0.6);
    for (const s of [-1, 1]) circ(ctx, s * x, 0, Math.max(d / 2, 2 * px), K.tint(col, 0.2), INK, px);
    return;
  }
  if (on) { const gr = ctx.createRadialGradient(0, 0, R * 0.5, 0, 0, R * 2.4); gr.addColorStop(0, rgba(lc, 0.55)); gr.addColorStop(1, rgba(lc, 0)); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, R * 2.4, 0, TAU); ctx.fill(); }
  if (v === 'wall' || v === 'step' || v === 'flood' || v === 'lantern' || v === 'post-lantern') rect(ctx, 0, 0, Math.max(w, 4 * px), Math.max(d, 3 * px), K.tint(col, 0.35), INK, px, 1);
  else circ(ctx, 0, 0, R, K.tint(col, 0.35), INK, px);
  circ(ctx, 0, 0, Math.max(R * 0.4, 1.2 * px), on ? '#ffd27a' : '#eeeae0', INK, px * 0.7);
}
define('outdoor-light', Object.fromEntries(['bollard', 'spike-spot', 'post-lantern', 'string', 'wall', 'step', 'solar-path', 'flood', 'lantern', 'globe'].map((k) => [k, { b: buildLight }])), lightSym);

// ═════════════════════════ PLAY ═════════════════════════
const PLAY_COLS = ['#e0552b', '#2f6f8f', '#e3b23c', '#4f8a5b'];
const toy = (c) => K.mat(c, { roughness: 0.45, side: THREE.DoubleSide });
/** U-shaped slide chute from (z0, y0) down to (z1, y1). */
const chuteG = (cw, z0, y0, z1, y1) => surfG((u, t) => { const uu = 2 * u - 1; return [uu * cw / 2, y1 + (y0 - y1) * (1 - t) ** 1.6 + 0.11 * uu ** 4, lerp(z0, z1, t)]; }, 8, 14);
const netM = (c = '#ffffff', a = 0.28) => K.mat(c, { roughness: 0.9, opacity: a, depthWrite: false, side: THREE.DoubleSide });

function playSwingSet(g, o) {
  const { w, d, h, p } = o, timber = !isMetal(p.material), fr = timber ? M(p.material, C(p.color2, '#b98a5e'), 'wood') : alu(C(p.color2, '#4f8a5b')), r = timber ? 0.045 : 0.03;
  const xa = Math.max(0.05, w / 2 - 0.28), xf = w / 2 - r, zf = d / 2 - r, yt = h - r, list = [], ropes = [], seats = [[], []];
  for (const s of [-1, 1]) list.push([[s * xa, yt, 0], [s * xf, 0, zf]], [[s * xa, yt, 0], [s * xf, 0, -zf]], [[s * lerp(xa, xf, 0.55), yt * 0.45, zf * 0.55], [s * lerp(xa, xf, 0.55), yt * 0.45, -zf * 0.55], r * 0.7]);
  list.push([[-xa - 0.1, yt, 0], [xa + 0.1, yt, 0]]);
  const n = Math.round(num(p.swings, clamp(Math.floor((2 * xa - 0.2) / 0.7), 1, 4), 1, 6)), sy = Math.min(0.5, 0.25 * h);
  for (let i = 0; i < n; i++) { const cx = lerp(-xa, xa, (i + 0.5) / n) * 0.86; ropes.push([[cx - 0.2, yt, 0], [cx - 0.2, sy, 0]], [[cx + 0.2, yt, 0], [cx + 0.2, sy, 0]]); seats[i % 2].push([0.44, 0.03, 0.17, cx, sy, 0]); }
  g.add(rods(list, r, fr, 8), rods(ropes, 0.005, K.mat('#3a5a8a', { roughness: 0.8 }), 4), boxes(seats[0], K.plastic(C(p.color, PLAY_COLS[0]))), boxes(seats[1], K.plastic(C(p.color3, PLAY_COLS[1]))));
}
function playSlide(g, o) {
  const { w, d, h, p } = o, fr = alu(C(p.color2, '#4a6a8a')), hp = 0.72 * h, cw = Math.max(0.05, w - 0.08), x = cw / 2, pd = Math.min(0.42, d * 0.2), zb = -d / 2 + 0.12, zf = zb + pd, list = [];
  for (const s of [-1, 1]) {
    list.push([[s * x, 0, zb], [s * x, h - 0.02, zb]], [[s * x, 0, zf], [s * x, h - 0.02, zf]], [[s * x, h - 0.02, zb], [s * x, h - 0.02, zf]], [[s * x, 0, -d / 2 + 0.02], [s * x, hp, zb], 0.018]);
    list.push([[s * x * 0.9, 0, lerp(zf, d / 2, 0.45)], [s * x * 0.9, 0.1 + (hp - 0.1) * 0.55 ** 1.6, lerp(zf, d / 2, 0.45)], 0.016]);
  }
  for (let y = 0.25; y < hp - 0.05; y += 0.25) list.push([[-x, y, lerp(-d / 2 + 0.02, zb, y / hp)], [x, y, lerp(-d / 2 + 0.02, zb, y / hp)], 0.014]);
  g.add(rods(list, 0.02, fr, 6), box(cw, 0.035, pd + 0.04, K.plastic(C(p.color3, '#e3b23c')), 0, hp - 0.0175, (zb + zf) / 2), mesh(chuteG(cw, zf, hp, d / 2, 0.1), toy(C(p.color, PLAY_COLS[0]))));
}
function playTrampoline(g, o) {
  const { w, d, h, p } = o, R = Math.min(w, d) / 2, net = flag(p.net, h > 1.5), hf = net ? Math.min(0.9, h * 0.34) : h, stl = K.metal('#b9bdc2', { roughness: 0.4, metalness: 0.7 }), col = C(p.color, '#2f6f8f'), legs = [], nl = R > 1.6 ? 6 : 4;
  g.add(mesh(latheG([[R * 0.84, hf - 0.035], [R * 0.84, hf], [R, hf], [R, hf - 0.045]], 32), K.mat(col, { roughness: 0.7 })), cyl(R * 0.85, R * 0.85, 0.006, K.mat('#1b1c1f', { roughness: 0.85 }), 0, hf - 0.02, 0, 32), mesh(torusG(R - 0.04, 0.022, 'xz', 0, hf - 0.05, 0, 32, 6), stl));
  for (let i = 0; i < nl; i++) { const a = (i / nl) * TAU + PI / nl, q = (da) => [Math.cos(a + da) * (R - 0.04), Math.sin(a + da) * (R - 0.04)], [ax, az] = q(-0.22), [bx, bz] = q(0.22); legs.push([[ax, hf - 0.05, az], [ax, 0.02, az]], [[bx, hf - 0.05, bz], [bx, 0.02, bz]], [[ax, 0.02, az], [bx, 0.02, bz]]); }
  g.add(rods(legs, 0.02, stl, 6));
  if (net) {
    const np = R > 1.3 ? 8 : 6, poles = [];
    for (let i = 0; i < np; i++) { const a = (i / np) * TAU; poles.push(cylG(0.022, 0.022, h - hf - 0.02, Math.cos(a) * (R - 0.03), hf + (h - hf - 0.02) / 2, Math.sin(a) * (R - 0.03), 8)); }
    g.add(merge(poles, K.mat(C(p.color3, col), { roughness: 0.8 })), mesh(torusG(R - 0.03, 0.014, 'xz', 0, h - 0.014, 0, 32, 5), stl));
    g.add(ns(mesh(new THREE.CylinderGeometry(R - 0.05, R - 0.05, h - hf - 0.03, 32, 1, true).translate(0, hf + (h - hf - 0.03) / 2, 0), netM('#1c1d20', 0.2))));
  }
}
function playHouse(g, o) {
  const { w, d, h, p } = o, P = shedPalette(p, '#f1e4c8', '#c0503a', '#5f8fa8'), S = shedShell(g, w, d, h, 'gable', P.wall, P.roofM, 'wood', Math.min(0.07, w * 0.08)), ws = Math.min(0.32, S.wb * 0.26), dw = Math.min(0.44, S.wb * 0.36), dh = Math.min(1.05, S.yw * 0.84), wy = S.yw * 0.62;
  g.add(box(dw, dh, 0.03, P.doorM, -S.wb * 0.2, 0.05 + dh / 2, S.zf + 0.008), box(dw + 0.06, dh + 0.03, 0.02, K.mat('#ffffff', { roughness: 0.6 }), -S.wb * 0.2, 0.05 + (dh + 0.03) / 2, S.zf + 0.002), sphere(0.02, inox(), -S.wb * 0.2 + dw * 0.34, 0.05 + dh * 0.5, S.zf + 0.03, 8, 6));
  shedWindow(g, S.wb * 0.24, wy, S.zf + 0.012, ws, K.mat('#ffffff', { roughness: 0.6 }), false); shedWindow(g, S.wb / 2 + 0.012, wy, 0, Math.min(ws, S.db * 0.4), K.mat('#ffffff', { roughness: 0.6 }), true);
  g.add(box(ws + 0.08, 0.07, 0.08, K.wood('walnut'), S.wb * 0.24, wy - ws / 2 - 0.06, S.zf + 0.04), merge([0, 1, 2, 3].map((i) => new THREE.IcosahedronGeometry(0.04, 0).translate(S.wb * 0.24 + lerp(-ws / 2, ws / 2, i / 3), wy - ws / 2 - 0.01, S.zf + 0.04)), K.foliage('#d9779a')));
}
function playSandbox(g, o) {
  const { w, d, h, p } = o, wd = M(p.material, C(p.color, '#c9a476'), 'wood'), roofed = h > 1, hb = roofed ? 0.26 : h, list = [];
  for (const s of [-1, 1]) list.push([w, hb - 0.03, 0.04, 0, (hb - 0.03) / 2, s * (d / 2 - 0.02)], [0.04, hb - 0.03, d - 0.08, s * (w / 2 - 0.02), (hb - 0.03) / 2, 0], [w, 0.03, Math.min(0.14, d * 0.2), 0, hb - 0.015, s * (d / 2 - Math.min(0.07, d * 0.1))], [Math.min(0.14, w * 0.2), 0.03, d - Math.min(0.28, d * 0.4), s * (w / 2 - Math.min(0.07, w * 0.1)), hb - 0.015, 0]);
  const sand = K.mat(C(p.color2, '#e3d3a8'), { roughness: 1 }), mound = new THREE.SphereGeometry(1, 12, 6, 0, TAU, 0, PI / 2).scale(w * 0.2, hb * 0.3, d * 0.18).translate(w * 0.1, hb * 0.6, -d * 0.08);
  g.add(box(w - 0.08, hb * 0.6, d - 0.08, sand, 0, hb * 0.3, 0), mesh(mound, sand), cylOn(0.07, 0.055, Math.min(0.13, hb * 0.36), K.plastic(PLAY_COLS[0]), -w * 0.2, hb * 0.6, d * 0.12, 10));
  if (roofed) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) list.push([0.06, h - 0.12, 0.06, sx * (w / 2 - 0.03), (h - 0.12) / 2, sz * (d / 2 - 0.03)]);
    g.add(prismZ([[-w / 2, h - 0.14], [-w / 2, h - 0.12], [0, h], [w / 2, h - 0.12], [w / 2, h - 0.14], [0, h - 0.02]], d, K.mat(C(p.color3, '#2f6f8f'), { roughness: 0.8 })));
  }
  g.add(boxes(list, wd));
}
function playClimb(g, o) {
  const { w, d, h, p } = o, wd = M(p.material, C(p.color2, '#b98a5e'), 'wood'), tw = Math.min(1.2, w * 0.42, d * 0.5), x0 = -w / 2, x1 = x0 + tw, z0 = -d / 2, z1 = z0 + tw, hp = Math.min(1.5, 0.5 * h), hr = 0.8 * h, ps = Math.min(0.09, tw * 0.15), xc = x0 + tw / 2, zc = z0 + tw / 2, list = [], rl = [];
  for (const x of [x0 + ps / 2, x1 - ps / 2]) for (const z of [z0 + ps / 2, z1 - ps / 2]) list.push([ps, hr, ps, x, hr / 2, z]);
  list.push([tw, 0.04, tw, xc, hp - 0.02, zc], [tw, 0.07, 0.03, xc, hp + 0.65, z0 + ps / 2], [tw, 0.07, 0.03, xc, hp + 0.3, z0 + ps / 2], [tw, 0.08, 0.04, xc, hr - 0.04, z0 + 0.02], [tw, 0.08, 0.04, xc, hr - 0.04, z1 - 0.02], [0.04, 0.08, tw, x0 + 0.02, hr - 0.04, zc], [0.04, 0.08, tw, x1 - 0.02, hr - 0.04, zc]);
  g.add(boxes(list, wd), at(prismZ([[x0, hr - 0.02], [x0, hr], [xc, h], [x1, hr], [x1, hr - 0.02], [xc, h - 0.03]], tw, K.mat(C(p.color, '#4f8a5b'), { roughness: 0.8 })), 0, 0, zc));
  for (let y = 0.25; y < hp - 0.1; y += 0.25) rl.push([[x0 + 0.03, y, z0 + ps], [x0 + 0.03, y, z1 - ps]]);
  const hm = clamp(0.74 * h, hp + 0.2, 2.1), xe = w / 2 - 0.05;
  for (const s of [-1, 1]) rl.push([[x1 - ps / 2, hm, zc + s * 0.22], [xe - 0.08, hm, zc + s * 0.22], 0.022], [[xe - 0.08, hm, zc + s * 0.22], [xe, 0, zc + s * Math.min(0.5, tw / 2)], 0.04]);
  for (let x = x1 + 0.2; x < xe - 0.15; x += 0.3) rl.push([[x, hm, zc - 0.22], [x, hm, zc + 0.22]]);
  g.add(rods(rl, 0.016, wd, 6), at(mesh(chuteG(Math.max(0.1, Math.min(0.5, tw - 2 * ps - 0.04)), z1, hp, d / 2, 0.1), toy(C(p.color3, '#e3b23c'))), xc, 0, 0));
  const rk = seedOf(o, 'holds'), sets = [[], [], []];
  for (let i = 0; i < 9; i++) sets[i % 3].push(new THREE.IcosahedronGeometry(0.035, 0).translate(lerp(x0 + ps + 0.08, x1 - ps - 0.08, rk()), lerp(0.15, hp - 0.15, (i + 0.5) / 9), z0 + 0.02));
  g.add(box(tw - 2 * ps, hp, 0.02, K.wood('birch'), xc, hp / 2, z0 + 0.045)); sets.forEach((s, i) => g.add(merge(s, K.plastic(PLAY_COLS[i]))));
}
function playSeesaw(g, o) {
  const { w, d, h, p } = o, fr = alu(C(p.color2, '#4a4d52')), col = K.mat(C(p.color, PLAY_COLS[0]), { roughness: 0.5 }), seat = K.plastic(C(p.color3, PLAY_COLS[1])), a = Math.atan2(0.3 * h, w / 2), L = w / Math.cos(a) - 0.1, yc = 0.5 * h, beam = new THREE.Group();
  beam.add(box(L, 0.05, Math.min(0.12, d * 0.5), col, 0, 0, 0));
  for (const s of [-1, 1]) beam.add(rbox(0.3, 0.035, Math.min(d, 0.26), seat, s * (L / 2 - 0.16), 0.042, 0, 0.015, 2), rods([[[s * (L / 2 - 0.42), 0.02, 0], [s * (L / 2 - 0.42), 0.26, 0]], [[s * (L / 2 - 0.42), 0.26, -d / 2 + 0.01], [s * (L / 2 - 0.42), 0.26, d / 2 - 0.01]]], 0.012, fr, 6));
  beam.position.y = yc; beam.rotation.z = a;
  g.add(beam, boxes([[0.06, yc, 0.03, 0.12, yc / 2, d / 2 - 0.015, 0, 0, 0.25], [0.06, yc, 0.03, -0.12, yc / 2, d / 2 - 0.015, 0, 0, -0.25], [0.06, yc, 0.03, 0.12, yc / 2, -d / 2 + 0.015, 0, 0, 0.25], [0.06, yc, 0.03, -0.12, yc / 2, -d / 2 + 0.015, 0, 0, -0.25], [0.5, 0.03, d, 0, 0.015, 0]], fr), mesh(zCylG(0.025, d, 0, yc, 0, 8), fr));
}
function playHoop(g, o) {
  const { w, d, h, p } = o, blk = dark(), bh = w * 0.62, zb = d / 2 - 0.62, bd = Math.min(0.95, d * 0.5), ry = h - bh * 0.78, rz = zb + 0.03 + 0.15 + 0.225;
  g.add(rbox(Math.min(w, 0.8), 0.2, bd, K.plastic(C(p.color2, '#1c1d20')), 0, 0.1, -d / 2 + bd / 2, 0.04, 2), rods([[[0, 0.2, -d / 2 + bd * 0.45], [0, h - bh * 0.6, zb - 0.4]], [[0, h - bh * 0.6, zb - 0.4], [0, h - bh * 0.35, zb - 0.02], 0.025], [[0, h - bh * 0.75, zb - 0.45], [0, h - bh * 0.8, zb - 0.02], 0.025], [[0, 0.2, -d / 2 + bd * 0.9], [0, h * 0.4, lerp(-d / 2 + bd * 0.45, zb - 0.4, 0.42)], 0.018]], 0.04, alu(C(p.color3, '#3a3d42')), 8));
  g.add(ns(box(w, bh, 0.02, clear('#e9eef0', 0.4), 0, h - bh / 2, zb)), boxes([[w, 0.03, 0.03, 0, h - 0.015, zb], [w, 0.03, 0.03, 0, h - bh + 0.015, zb], [0.03, bh, 0.03, w / 2 - 0.015, h - bh / 2, zb], [0.03, bh, 0.03, -w / 2 + 0.015, h - bh / 2, zb]], blk));
  const sq = K.mat(C(p.color, '#e0552b'), { roughness: 0.5 }), sw = 0.59, shh = 0.45;
  g.add(boxes([[sw, 0.03, 0.005, 0, ry + shh, zb + 0.012], [sw, 0.03, 0.005, 0, ry + 0.02, zb + 0.012], [0.03, shh, 0.005, sw / 2, ry + shh / 2, zb + 0.012], [0.03, shh, 0.005, -sw / 2, ry + shh / 2, zb + 0.012], [0.1, 0.02, 0.16, 0, ry, zb + 0.09]], sq), mesh(torusG(0.225, 0.01, 'xz', 0, ry, rz, 20, 5), sq));
  g.add(ns(mesh(new THREE.CylinderGeometry(0.225, 0.14, 0.38, 12, 1, true).translate(0, ry - 0.19, rz), netM('#ffffff', 0.45))));
  wheelSet(g, [[Math.min(w, 0.8) / 2 - 0.05, 0.05, -d / 2 + bd - 0.06], [-Math.min(w, 0.8) / 2 + 0.05, 0.05, -d / 2 + bd - 0.06]], 0.05, 0.04, dark('#55585c'));
}
function playGoal(g, o) {
  const { w, d, h, p } = o, wm = K.mat(C(p.color, '#f4f2ee'), { roughness: 0.4 }), r = Math.min(0.04, w * 0.05), x = w / 2 - r, zf = d / 2 - r, zb = -d / 2 + r, yt = h - r, zt = lerp(zf, zb, 0.35), list = [];
  for (const s of [-1, 1]) list.push([[s * x, 0, zf], [s * x, yt, zf]], [[s * x, r, zf], [s * x, r, zb], r * 0.6], [[s * x, yt, zf], [s * x, yt, zt], r * 0.6], [[s * x, yt, zt], [s * x, r, zb], r * 0.6]);
  list.push([[-x, yt, zf], [x, yt, zf]], [[-x, r, zb], [x, r, zb], r * 0.6], [[-x, yt, zt], [x, yt, zt], r * 0.5]);
  g.add(rods(list, r, wm, 8));
  const q = (a, b, c, e) => surfG((u, t) => { const m = [0, 1, 2].map((k) => lerp(lerp(a[k], b[k], u), lerp(e[k], c[k], u), t)); return m; }, Math.max(2, Math.round(w / 0.25)), 6);
  g.add(ns(merge([q([-x, yt, zt], [x, yt, zt], [x, r, zb], [-x, r, zb]), q([-x, yt, zf], [x, yt, zf], [x, yt, zt], [-x, yt, zt]), ...[-1, 1].map((s) => surfG((u, t) => [s * x, lerp(r, yt, t), lerp(zf, lerp(zb, zt, t), u)], 4, 6))], K.mat('#ffffff', { roughness: 0.9, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, flat: true }))));
}
function playPool(g, o) {
  const { w, d, h, p } = o, R = Math.min(w, d) / 2, n = h > 0.3 ? 3 : 2, rt = h / (2 * n), cols = [C(p.color, '#3fa7d6'), C(p.color2, '#f4f2ee')], sets = [[], []];
  for (let i = 0; i < n; i++) sets[i % 2].push(torusG(R - rt, rt, 'xz', 0, rt + i * 2 * rt, 0, 32, 8));
  sets.forEach((s, i) => g.add(merge(s, K.mat(cols[i], { roughness: 0.35 }))));
  g.add(cyl(R - rt, R - rt, 0.01, K.mat(cols[0], { roughness: 0.4 }), 0, 0.006, 0, 28), ns(cyl(R - 1.7 * rt, R - 1.7 * rt, 0.01, K.water(C(p.color3, '#6ec6e6'), 0.7), 0, h * 0.62, 0, 28)));
}
function playPingPong(g, o) {
  const { w, d, h, p } = o, nh = Math.min(0.1525, h * 0.17), ty = h - nh, top = K.mat(C(p.color, '#2f5f8f'), { roughness: 0.5 }), fr = alu(C(p.color2, '#2b2d31')), wl = K.mat('#f4f4f0', { roughness: 0.6 }), list = [], lw = 0.02;
  g.add(box(w, 0.02, d, top, 0, ty - 0.01, 0), boxes([[w, 0.04, 0.03, 0, ty - 0.04, d / 2 - 0.03], [w, 0.04, 0.03, 0, ty - 0.04, -d / 2 + 0.03]], fr));
  g.add(boxes([[w, 0.002, lw, 0, ty + 0.001, d / 2 - lw / 2], [w, 0.002, lw, 0, ty + 0.001, -d / 2 + lw / 2], [lw, 0.002, d, w / 2 - lw / 2, ty + 0.001, 0], [lw, 0.002, d, -w / 2 + lw / 2, ty + 0.001, 0], [w, 0.002, 0.004, 0, ty + 0.001, 0], [0.012, nh, 0.012, 0, ty + nh / 2, d / 2 - 0.006], [0.012, nh, 0.012, 0, ty + nh / 2, -d / 2 + 0.006], [0.006, 0.015, d, 0, h - 0.0075, 0]], wl), ns(box(0.003, nh - 0.015, d - 0.02, netM('#1c1d20', 0.5), 0, ty + (nh - 0.015) / 2, 0)));
  for (const sx of [-1, 1]) { const x = sx * w * 0.28; for (const sz of [-1, 1]) list.push([0.04, ty - 0.1, 0.04, x, 0.08 + (ty - 0.1) / 2, sz * (d / 2 - 0.12)]); list.push([0.04, 0.04, d - 0.2, x, 0.12, 0], [0.04, 0.04, d - 0.2, x, ty - 0.05, 0]); }
  list.push([w * 0.56, 0.04, 0.04, 0, 0.12, 0]);
  g.add(boxes(list, fr));
  wheelSet(g, [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [sx * w * 0.28, 0.05, sz * (d / 2 - 0.12)])), 0.05, 0.03, dark('#55585c'));
}
function playNinja(g, o) {
  const { w, d, h, p } = o, wd = M(p.material, C(p.color2, '#8a6a4a'), 'wood'), pr = Math.min(0.07, d / 2), x = w / 2 - pr, span = 2 * (x - pr), yl = h - 0.2, sag = Math.min(0.12, span * 0.02), yy = (t) => yl - sag * (1 - (2 * t - 1) ** 2), zr = d / 2 - 0.016, strap = [], hang = [], wood = [], rings = [], balls = [];
  g.add(merge([cylG(pr, pr, h, -x, h / 2, 0, 12), cylG(pr, pr, h, x, h / 2, 0, 12)], wd));
  for (let i = 0; i < 10; i++) strap.push([[lerp(-x + pr, x - pr, i / 10), yy(i / 10), 0], [lerp(-x + pr, x - pr, (i + 1) / 10), yy((i + 1) / 10), 0]]);
  const n = clamp(Math.round((span - 0.6) / 0.85), 2, 10);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, cx = lerp(-x + pr, x - pr, t), y0 = yy(t), kind = i % 4, len = 0.45 + (i % 3) * 0.12;
    if (kind === 0) { for (const s of [-1, 1]) { hang.push([[cx + s * 0.16, y0, 0], [cx + s * 0.16, y0 - len + 0.09, 0]]); rings.push(torusG(0.09, 0.012, 'xy', cx + s * 0.16, y0 - len, 0, 14, 5)); } }
    else if (kind === 1) { hang.push([[cx, y0, 0], [cx, y0 - len, -zr * 0.8]], [[cx, y0, 0], [cx, y0 - len, zr * 0.8]]); wood.push([[cx, y0 - len, -zr], [cx, y0 - len, zr]]); }
    else if (kind === 2) { hang.push([[cx, y0, 0], [cx, y0 - len, 0]]); balls.push(new THREE.SphereGeometry(Math.min(0.1, d / 2), 12, 8).translate(cx, y0 - len - 0.08, 0)); }
    else { for (const s of [-1, 1]) hang.push([[cx, y0, 0], [cx, y0 - len + 0.2, s * zr * 0.8]], [[cx, y0 - len + 0.2, s * zr * 0.8], [cx, y0 - len - 0.3, s * zr * 0.8]]); for (let k = 0; k < 3; k++) wood.push([[cx, y0 - len + 0.2 - k * 0.25, -zr], [cx, y0 - len + 0.2 - k * 0.25, zr]]); }
  }
  g.add(rods(strap, 0.013, K.fabric(C(p.color, PLAY_COLS[0])), 5), rods(hang, 0.006, K.fabric('#2b2d31'), 4), rods(wood, 0.016, K.wood('birch'), 6), merge(rings, K.plastic(C(p.color3, PLAY_COLS[2]))), merge(balls, K.plastic(PLAY_COLS[1])));
  g.add(box(span, 0.005, Math.min(0.05, d), K.fabric(C(p.color3, PLAY_COLS[2])), 0, Math.min(0.45, h * 0.25), 0));
}
function playMudKitchen(g, o) {
  const { w, d, h, p } = o, wd = M(p.material, C(p.color, '#d9b98a'), 'wood'), hc = Math.min(0.58, h * 0.6), ls = 0.045, list = [], acc = K.plastic(C(p.color3, PLAY_COLS[0]));
  for (const sx of [-1, 1]) list.push([ls, hc, ls, sx * (w / 2 - ls / 2), hc / 2, d / 2 - ls / 2], [ls, h, ls, sx * (w / 2 - ls / 2), h / 2, -d / 2 + ls / 2]);
  list.push([w, 0.025, d, 0, hc - 0.0125, 0], [w - 2 * ls, 0.02, d - 0.04, 0, 0.14, 0], [w - 2 * ls, 0.09, 0.02, 0, hc - 0.07, d / 2 - 0.015], [w, 0.022, Math.min(0.16, d * 0.45), 0, h - 0.011, -d / 2 + Math.min(0.08, d * 0.225)]);
  for (let i = 0; i < 3; i++) list.push([w - 2 * ls, 0.09, 0.016, 0, hc + 0.08 + i * (h - hc - 0.14) / 3, -d / 2 + 0.02]);
  g.add(boxes(list, wd));
  const sr = Math.min(0.13, w * 0.16, d * 0.32), sx = -w * 0.22;
  g.add(cyl(sr, sr, 0.006, inox(), sx, hc + 0.003, 0.01, 18), cyl(sr * 0.86, sr * 0.86, 0.008, dark('#6a6f73'), sx, hc + 0.004, 0.01, 18), merge([cylG(sr * 0.6, sr * 0.6, 0.004, w * 0.14, hc + 0.002, 0.02, 14), cylG(sr * 0.6, sr * 0.6, 0.004, w * 0.34, hc + 0.002, 0.02, 14)], dark()));
  g.add(merge([zCylG(0.02, 0.025, w * 0.14, hc - 0.07, d / 2, 10), zCylG(0.02, 0.025, w * 0.34, hc - 0.07, d / 2, 10), cylG(sr * 0.55, sr * 0.5, 0.07, w * 0.14, hc + 0.04, 0.02, 12)], acc), mesh(tubeG([[sx, hc, -d * 0.3], [sx, hc + 0.16, -d * 0.3], [sx, hc + 0.18, -d * 0.12]], 0.01, 10, 5), inox()));
  const hy = hc + 0.08 + 2 * (h - hc - 0.14) / 3;
  g.add(rods([-0.25, 0, 0.25].map((t) => [[t * w, hy, -d / 2 + 0.035], [t * w, hy - 0.16, -d / 2 + 0.035]]), 0.006, inox(), 4), merge([-0.25, 0, 0.25].map((t) => zCylG(0.03, 0.006, t * w, hy - 0.19, -d / 2 + 0.035, 10)), inox()));
}
function playSym(ctx, { w, d, h, p, px, v }) {
  const col = C(p.color, PLAY_COLS[0]), wood = '#b98a5e';
  if (v === 'swing-set') {
    const xa = Math.max(5, w / 2 - 28), n = Math.round(num(p.swings, clamp(Math.floor((2 * xa - 20) / 70), 1, 4), 1, 6));
    for (const s of [-1, 1]) { line(ctx, s * xa, 0, s * (w / 2 - 4), d / 2 - 4, C(p.color2, wood), Math.max(1.5 * px, 6)); line(ctx, s * xa, 0, s * (w / 2 - 4), -d / 2 + 4, C(p.color2, wood), Math.max(1.5 * px, 6)); }
    line(ctx, -xa - 10, 0, xa + 10, 0, C(p.color2, wood), Math.max(2 * px, 9));
    for (let i = 0; i < n; i++) rect(ctx, lerp(-xa, xa, (i + 0.5) / n) * 0.86, 0, 44, 17, K.tint(i % 2 ? C(p.color3, PLAY_COLS[1]) : col, 0.3), INK, px, 3);
    dashed(ctx, px, () => rect(ctx, 0, 0, w, d, null, SOFT, px));
  } else if (v === 'slide') {
    const pd = Math.min(42, d * 0.2), zb = -d / 2 + 12;
    rect(ctx, 0, (zb + pd + d / 2) / 2, w - 8, d / 2 - zb - pd, K.tint(col, 0.35), INK, px, 6); rect(ctx, 0, zb + pd / 2, w - 8, pd, K.tint(C(p.color3, '#e3b23c'), 0.3), INK, px);
    hatch(ctx, -w / 2 + 4, -d / 2, w / 2 - 4, zb, 2, true, INK, px); line(ctx, 0, zb + pd + 12, 0, d / 2 - 14, SOFT, px); poly(ctx, [[-4 * px, d / 2 - 14 - 5 * px], [0, d / 2 - 14], [4 * px, d / 2 - 14 - 5 * px]], null, SOFT, px, false);
  } else if (v === 'trampoline') {
    const R = Math.min(w, d) / 2, net = flag(p.net, h > 150), c = C(p.color, '#2f6f8f');
    circ(ctx, 0, 0, R, K.tint(c, 0.3), INK, px); circ(ctx, 0, 0, R * 0.84, '#8f9296', INK, px); circ(ctx, 0, 0, R * 0.5, null, 'rgba(255,255,255,0.5)', px);
    if (net) { const np = R > 130 ? 8 : 6; for (let i = 0; i < np; i++) circ(ctx, Math.cos(i / np * TAU) * (R - 3), Math.sin(i / np * TAU) * (R - 3), Math.max(2.5, 1.3 * px), K.shade(c, -0.2), INK, px * 0.7); }
  } else if (v === 'playhouse') {
    rect(ctx, 0, 0, w, d, K.tint(C(p.color2, '#c0503a'), 0.5), INK, px, 1); hatch(ctx, -w / 2, -d / 2, w / 2, d / 2, Math.min(5, Math.floor(w / (4 * px))), false, SOFT, px); line(ctx, 0, -d / 2, 0, d / 2, INK, 1.6 * px);
    line(ctx, -w * 0.36, d / 2 - 6, -w * 0.04, d / 2 - 6, C(p.color3, '#5f8fa8'), Math.max(2.5 * px, 3));
  } else if (v === 'sandbox') {
    rect(ctx, 0, 0, w, d, K.tint(C(p.color, '#c9a476'), 0.35), INK, px, 1); rect(ctx, 0, 0, w - Math.min(28, w * 0.4), d - Math.min(28, d * 0.4), '#efe3c2', INK, px);
    const rk = K.rng(7); for (let i = 0; i < 30; i++) circ(ctx, (rk() - 0.5) * (w - 40), (rk() - 0.5) * (d - 40), 0.7 * px, 'rgba(120,100,60,0.5)', null);
    if (h > 100) dashed(ctx, px, () => { line(ctx, 0, -d / 2, 0, d / 2, SOFT, px); });
  } else if (v === 'climbing-frame') {
    const tw = Math.min(120, w * 0.42, d * 0.5), x0 = -w / 2, z0 = -d / 2, xc = x0 + tw / 2, zc = z0 + tw / 2;
    rect(ctx, (x0 + tw + w / 2) / 2, zc, w / 2 - x0 - tw, 44, null, INK, px); hatch(ctx, x0 + tw, zc - 22, w / 2 - 5, zc + 22, Math.max(1, Math.round((w - tw) / 30) - 1), false, INK, px);
    rect(ctx, xc, (z0 + tw + d / 2) / 2, Math.min(50, tw - 22), d / 2 - z0 - tw, K.tint(C(p.color3, '#e3b23c'), 0.3), INK, px, 5);
    rect(ctx, xc, zc, tw, tw, K.tint(C(p.color, '#4f8a5b'), 0.4), INK, px); line(ctx, xc, z0, xc, z0 + tw, INK, 1.5 * px);
  } else if (v === 'seesaw') {
    rect(ctx, 0, 0, w - 8, Math.min(12, d * 0.5), K.tint(col, 0.3), INK, px, 2); for (const s of [-1, 1]) { rect(ctx, s * (w / 2 - 18), 0, 30, Math.min(d, 26), K.tint(C(p.color3, PLAY_COLS[1]), 0.3), INK, px, 4); line(ctx, s * (w / 2 - 44), -d / 2, s * (w / 2 - 44), d / 2, INK, 1.5 * px); }
    rect(ctx, 0, 0, 50, d, null, INK, px, 2);
  } else if (v === 'basketball-hoop') {
    const zb = d / 2 - 62, bd = Math.min(95, d * 0.5);
    rect(ctx, 0, -d / 2 + bd / 2, Math.min(w, 80), bd, '#6a6c70', INK, px, 5); line(ctx, 0, -d / 2 + bd * 0.5, 0, zb, INK, Math.max(2 * px, 6));
    line(ctx, -w / 2, zb, w / 2, zb, INK, Math.max(2 * px, 3)); circ(ctx, 0, zb + 40, 22.5, null, col, Math.max(1.5 * px, 2)); line(ctx, 0, zb, 0, zb + 18, col, Math.max(1.5 * px, 2));
  } else if (v === 'football-goal') {
    ctx.fillStyle = 'rgba(160,170,175,0.18)'; ctx.fillRect(-w / 2, -d / 2, w, d); hatch(ctx, -w / 2, -d / 2, w / 2, d / 2, Math.min(Math.round(w / 25), Math.floor(w / (3.5 * px))), false, SOFT, px * 0.7); hatch(ctx, -w / 2, -d / 2, w / 2, d / 2, Math.min(Math.round(d / 25), Math.floor(d / (3.5 * px))), true, SOFT, px * 0.7);
    poly(ctx, [[-w / 2 + 3, d / 2 - 3], [-w / 2 + 3, -d / 2 + 3], [w / 2 - 3, -d / 2 + 3], [w / 2 - 3, d / 2 - 3]], null, INK, px, false); line(ctx, -w / 2 + 3, d / 2 - 4, w / 2 - 3, d / 2 - 4, INK, Math.max(2 * px, 7)); line(ctx, -w / 2 + 3, d / 2 - 4, w / 2 - 3, d / 2 - 4, '#f4f2ee', Math.max(px, 4.5));
  } else if (v === 'paddling-pool') {
    const R = Math.min(w, d) / 2, c = C(p.color, '#3fa7d6'); circ(ctx, 0, 0, R, K.tint(c, 0.3), INK, px); circ(ctx, 0, 0, R * 0.86, K.tint(C(p.color2, '#f4f2ee'), 0.3), SOFT, px); circ(ctx, 0, 0, R * 0.72, rgba('#6ec6e6', 0.75), INK, px);
  } else if (v === 'ping-pong') {
    rect(ctx, 0, 0, w, d, K.tint(C(p.color, '#2f5f8f'), 0.25), INK, px); rect(ctx, 0, 0, w - 4, d - 4, null, '#ffffff', Math.max(px, 1.6)); line(ctx, -w / 2, 0, w / 2, 0, '#ffffff', px); line(ctx, 0, -d / 2 - 0, 0, d / 2, INK, 1.8 * px);
  } else if (v === 'ninja-line') {
    const x = w / 2 - Math.min(7, d / 2), n = clamp(Math.round((2 * x - 74) / 85), 2, 10);
    line(ctx, -x, 0, x, 0, col, Math.max(1.5 * px, 2.6)); for (let i = 0; i < n; i++) circ(ctx, lerp(-x, x, (i + 0.5) / n), 0, Math.max(2 * px, Math.min(9, d * 0.3)), K.tint(PLAY_COLS[(i + 1) % 4], 0.3), INK, px);
    for (const s of [-1, 1]) circ(ctx, s * x, 0, Math.max(Math.min(7, d / 2), 2.2 * px), K.tint('#8a6a4a', 0.2), INK, px);
  } else {
    const sr = Math.min(13, w * 0.16, d * 0.32); rect(ctx, 0, 0, w, d, K.tint(C(p.color, '#d9b98a'), 0.4), INK, px, 1); rect(ctx, 0, -d / 2 + Math.min(8, d * 0.22), w, Math.min(16, d * 0.45), null, SOFT, px);
    circ(ctx, -w * 0.22, 1, sr, '#e6eaec', INK, px); circ(ctx, w * 0.14, 2, sr * 0.6, '#55585c', INK, px); circ(ctx, w * 0.34, 2, sr * 0.6, '#55585c', INK, px);
  }
}
define('play', { 'swing-set': { b: playSwingSet }, slide: { b: playSlide }, trampoline: { b: playTrampoline }, playhouse: { b: playHouse }, sandbox: { b: playSandbox }, 'climbing-frame': { b: playClimb }, seesaw: { b: playSeesaw },
  'basketball-hoop': { b: playHoop }, 'football-goal': { b: playGoal }, 'paddling-pool': { b: playPool }, 'ping-pong': { b: playPingPong }, 'ninja-line': { b: playNinja }, 'mud-kitchen': { b: playMudKitchen } }, playSym, true);

// ═════════════════════════ UTILITY ═════════════════════════
const UTIL = ['clothesline-rotary', 'clothesline-wall', 'clothes-rack', 'outdoor-shower', 'hose-reel', 'tap', 'bin', 'bins-3', 'compost', 'mailbox', 'rain-barrel', 'ev-charger', 'gas-tanks', 'irrigation-controller', 'bike-rack', 'doormat-bench'];
const BIN_LIDS = ['#2f6f8f', '#e0762b', '#3d7a4a'];
function wheelie(g, cx, bw, d, h, bodyM, lidM) {
  const lt = 0.07 * h, hb = h - lt - 0.03, r = Math.min(0.1, 0.1 * h, d * 0.2);
  g.add(mesh(taperG(bw * 0.8, d * 0.68, bw * 0.96, d * 0.86, hb, cx, 0.03, 0.03, 0.02), bodyM), rbox(bw, lt, d * 0.94, lidM, cx, h - lt / 2, 0.01, Math.min(0.02, lt * 0.4), 2), box(bw * 0.6, 0.03, 0.03, bodyM, cx, hb, d / 2 - 0.015));
  g.add(mesh(xCylG(0.014, bw * 0.84, cx, h - lt - 0.01, -d / 2 + 0.014, 8), bodyM), boxes([[0.04, 0.05, 0.08, cx + bw * 0.3, h - lt - 0.01, -d / 2 + 0.05], [0.04, 0.05, 0.08, cx - bw * 0.3, h - lt - 0.01, -d / 2 + 0.05]], bodyM));
  wheelSet(g, [[cx + bw / 2 - 0.035, r, -d / 2 + r + 0.02], [cx - bw / 2 + 0.035, r, -d / 2 + r + 0.02]], r, 0.045, dark('#55585c'));
}
function buildUtility(g, o) {
  const { w, d, h, p, v } = o, R = Math.min(w, d) / 2, stl = alu(C(p.color2, '#b9bdc2')), cord = K.mat('#e6ebef', { roughness: 0.7 }), list = [], rl = [];
  if (v === 'clothesline-rotary') {
    const m = alu(C(p.color, '#c9ccd0')), yh = 0.74 * h, lines = [];
    g.add(cylOn(0.022, 0.022, 0.8 * h, m, 0, 0, 0, 10), cylOn(0.045, 0.045, 0.04, m, 0, 0, 0, 10), cylOn(0.04, 0.04, 0.08, dark(), 0, yh - 0.04, 0, 10));
    const tips = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => [sx * (w / 2 - 0.012), h - 0.012, sz * (d / 2 - 0.012)]);
    tips.forEach((t) => rl.push([[0, yh, 0], t], [[0, yh - 0.25 * h, 0], [t[0] * 0.45, lerp(yh, h, 0.45), t[2] * 0.45], 0.008]));
    for (let k = 0; k < 5; k++) { const t = lerp(0.32, 0.98, k / 4); tips.forEach((a, i) => { const b = tips[(i + 1) % 4]; lines.push([[a[0] * t, lerp(yh, a[1], t), a[2] * t], [b[0] * t, lerp(yh, b[1], t), b[2] * t]]); }); }
    g.add(rods(rl, 0.012, m, 6), rods(lines, 0.0025, cord, 3));
  } else if (v === 'clothesline-wall') {
    const m = alu(C(p.color, '#d9dcdc')), tall = h >= 1, x = w / 2 - 0.02, n = Math.max(3, Math.round(d / 0.12)), lines = [], ys = tall ? h - Math.min(0.6, 0.4 * h) : 0.015;
    for (const s of [-1, 1]) { if (tall) list.push([0.05, h, 0.05, s * (w / 2 - 0.025), h / 2, -d / 2 + 0.025]); list.push([0.03, 0.03, d - 0.03, s * x, h - 0.015, 0.015]); rl.push([[s * x, h - 0.03, d * 0.15], [s * x, ys, -d / 2 + 0.03]]); }
    list.push([w, 0.05, 0.04, 0, h - 0.025, -d / 2 + 0.02], [w, 0.03, 0.03, 0, h - 0.015, d / 2 - 0.015]);
    for (let i = 1; i < n; i++) lines.push([[-x, h - 0.015, lerp(-d / 2 + 0.04, d / 2 - 0.015, i / n)], [x, h - 0.015, lerp(-d / 2 + 0.04, d / 2 - 0.015, i / n)]]);
    g.add(boxes(list.splice(0), m), rods(rl, 0.012, m, 6), rods(lines, 0.0025, cord, 3));
  } else if (v === 'clothes-rack') {
    const m = K.mat(C(p.color, '#f1f1ee'), { roughness: 0.4 }), yc = 0.86 * h, xc = 0.25 * w, z = d / 2 - 0.012;
    for (const s of [-1, 1]) { rl.push([[-xc * 1.15, 0, s * z], [xc * 0.9, yc, s * z]], [[xc * 1.15, 0, s * z], [-xc * 0.9, yc, s * z]], [[-xc, yc, s * z], [xc, yc, s * z]], [[s * xc, yc, -z], [s * xc, yc, z]]); rl.push([[s * xc, yc, -z], [s * (w / 2 - 0.01), h - 0.01, -z]], [[s * xc, yc, z], [s * (w / 2 - 0.01), h - 0.01, z]], [[s * (w / 2 - 0.01), h - 0.01, -z], [s * (w / 2 - 0.01), h - 0.01, z]]); }
    for (let i = 1; i < 7; i++) rl.push([[lerp(-xc, xc, i / 7), yc, -z], [lerp(-xc, xc, i / 7), yc, z], 0.004]);
    for (const s of [-1, 1]) for (let i = 1; i < 4; i++) { const t = i / 4; rl.push([[s * lerp(xc, w / 2 - 0.01, t), lerp(yc, h - 0.01, t), -z], [s * lerp(xc, w / 2 - 0.01, t), lerp(yc, h - 0.01, t), z], 0.004]); }
    g.add(rods(rl, 0.009, m, 5));
  } else if (v === 'outdoor-shower') {
    const big = Math.min(w, d) >= 0.6, m = M(p.material, C(p.color, '#c9ccd0'), 'metal'), wd = K.wood(C(p.color2, 'teak')), zc = big ? -d / 2 + 0.12 : -d / 2 + 0.035, reach = Math.min(0.34, d - 0.16), hr = Math.min(0.11, (d - reach) * 0.9, w / 2);
    if (big) {
      const n = Math.max(2, Math.round(d / 0.1)), ns2 = Math.max(3, Math.round(0.72 * h / 0.1));
      for (let i = 0; i < n; i++) list.push([w, 0.03, d / n - 0.012, 0, 0.035, lerp(-d / 2, d / 2, (i + 0.5) / n)]);
      list.push([w, 0.02, 0.05, 0, 0.01, d * 0.3], [w, 0.02, 0.05, 0, 0.01, -d * 0.3]);
      for (let i = 0; i < ns2; i++) list.push([w, 0.07, 0.02, 0, lerp(0.16, 0.86 * h, i / (ns2 - 1)), -d / 2 + 0.03]);
      for (const s of [-1, 1]) list.push([0.05, 0.9 * h, 0.04, s * (w / 2 - 0.025), 0.45 * h, -d / 2 + 0.02]);
      g.add(boxes(list.splice(0), wd));
    } else g.add(cylOn(R, R, 0.015, m, 0, 0, 0, 20));
    g.add(mesh(tubeG([[0, 0.01, zc], [0, h - 0.12, zc], [0, h - 0.03, zc + 0.05], [0, h - 0.018, zc + reach * 0.6], [0, h - 0.018, zc + reach]], 0.018, 24, 8), m), cyl(hr, hr, 0.015, m, 0, h - 0.05, zc + reach, 18), cyl(0.02, 0.02, 0.03, m, 0, h - 0.03, zc + reach, 8));
    g.add(merge([zCylG(0.028, 0.05, 0, Math.min(1.1, h * 0.52), zc + 0.03, 10), zCylG(0.014, 0.1, 0, Math.min(0.35, h * 0.16), zc + 0.05, 8), boxG(0.012, 0.012, 0.09, 0.03, Math.min(1.1, h * 0.52), zc + 0.07)], m));
  } else if (v === 'hose-reel') {
    const m = alu(C(p.color2, '#3a3d42')), hose = K.mat(C(p.color, '#3d7a4a'), { roughness: 0.7 }), x = w / 2 - 0.018, rd = Math.min(0.3 * h, 0.36 * d), yc = Math.max(rd * 1.25 + 0.02, 0.45 * h), geos = [xCylG(rd, w - 0.14, 0, yc, 0, 18)];
    for (const s of [-1, 1]) rl.push([[s * x, 0.09, -d * 0.3], [s * x, h - 0.02, -d / 2 + 0.02]], [[s * x, 0, d / 2 - 0.02], [s * x, yc, 0]], [[s * x, 0.09, -d * 0.3], [s * x, yc, 0]]);
    rl.push([[-x, h - 0.02, -d / 2 + 0.02], [x, h - 0.02, -d / 2 + 0.02]], [[-x, 0.02, d / 2 - 0.02], [x, 0.02, d / 2 - 0.02]], [[-x, yc, 0], [x, yc, 0], 0.012]);
    for (let i = 0; i < 7; i++) geos.push(torusG(rd, 0.011, 'zy', lerp(-w / 2 + 0.09, w / 2 - 0.09, i / 6), yc, 0, 16, 5));
    g.add(rods(rl, 0.014, m, 6), merge(geos, hose), merge([xCylG(rd * 1.22, 0.012, w / 2 - 0.06, yc, 0, 18), xCylG(rd * 1.22, 0.012, -w / 2 + 0.06, yc, 0, 18)], dark('#2b2d31')), rods([[[w / 2 - 0.02, yc, 0], [w / 2 - 0.02, yc + rd * 0.6, rd * 0.5]]], 0.008, m, 5));
    wheelSet(g, [[w / 2 - 0.03, 0.09, -d * 0.3], [-w / 2 + 0.03, 0.09, -d * 0.3]], Math.min(0.09, h * 0.2), 0.03, dark('#55585c'));
  } else if (v === 'tap') {
    const post = M(p.material, C(p.color, '#b98a5e'), 'wood'), brass = K.metal('#c5a35a', { roughness: 0.3 }), ps = Math.min(0.1, w), zp = -d / 2 + ps / 2, yt = 0.78 * h;
    g.add(box(w, 0.02, d, K.stone(C(p.color2, '#b9b2a6')), 0, 0.01, 0), box(ps, h - 0.02, ps, post, 0, 0.02 + (h - 0.02) / 2, zp), box(ps + 0.02, 0.02, ps + 0.02 > d ? d : ps + 0.02, post, 0, h - 0.01, zp));
    g.add(merge([zCylG(0.012, 0.07, 0, yt, zp + ps / 2 + 0.035, 8), cylG(0.01, 0.01, 0.05, 0, yt - 0.02, zp + ps / 2 + 0.065, 8), cylG(0.006, 0.006, 0.04, 0, yt + 0.025, zp + ps / 2 + 0.04, 6), boxG(0.06, 0.008, 0.012, 0, yt + 0.045, zp + ps / 2 + 0.04)], brass));
    const br = Math.min(0.11, w * 0.45, (d - ps) * 0.42);
    if (br > 0.03) g.add(mesh(latheG([[br * 0.7, 0.02], [br, 0.02 + br * 1.7]], 14, 0, 0, zp + ps / 2 + br + 0.01), K.mat('#9aa3a8', { roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide })), cyl(br * 0.72, br * 0.72, 0.006, K.mat('#8a8d91'), 0, 0.024, zp + ps / 2 + br + 0.01, 12));
  } else if (v === 'bin') {
    const c = C(p.color, '#3d5a45'); wheelie(g, 0, w, d, h, K.mat(c, { roughness: 0.55 }), K.mat(C(p.color2, K.shade(c, -0.12)), { roughness: 0.5 }));
  } else if (v === 'bins-3') {
    const bw = (w - 0.06) / 3, body = K.mat(C(p.color, '#3a3d42'), { roughness: 0.55 });
    [C(p.color2, BIN_LIDS[0]), C(p.color3, BIN_LIDS[1]), BIN_LIDS[2]].forEach((lc, i) => wheelie(g, -w / 2 + bw / 2 + i * (bw + 0.03), bw, d, h, body, K.mat(lc, { roughness: 0.5 })));
  } else if (v === 'compost') {
    const c = C(p.color, '#2b3a2e'), m = K.mat(c, { roughness: 0.6 }), hb = 0.88 * h, geos = [];
    for (let i = 0; i < 3; i++) { const t0 = i / 3, t1 = (i + 1) / 3, f = (t) => lerp(0.98, 0.8, t); geos.push(taperG(w * f(t0), d * f(t0), w * (f(t1) + 0.015), d * (f(t1) + 0.015), hb / 3, 0, (hb * i) / 3)); }
    g.add(merge(geos, m), rbox(w * 0.84, h - hb, d * 0.84, K.mat(C(p.color2, K.shade(c, 0.12)), { roughness: 0.5 }), 0, hb + (h - hb) / 2, 0, 0.02, 2), box(w * 0.42, hb * 0.24, 0.02, K.mat(K.shade(c, 0.18), { roughness: 0.5 }), 0, hb * 0.14, d * 0.48), box(0.1, 0.02, 0.03, dark(), 0, hb * 0.2, d * 0.49 + 0.012));
  } else if (v === 'mailbox') {
    const m = K.metal(C(p.color, '#2b2d31'), { roughness: 0.5, metalness: 0.5 }), tall = h > 0.6, bh = tall ? Math.min(0.34, h * 0.3) : h, y0 = h - bh;
    if (tall) g.add(box(Math.min(0.07, w), y0, Math.min(0.07, d), alu(C(p.color2, '#3a3d42')), 0, y0 / 2, 0), box(Math.min(0.2, w), 0.012, Math.min(0.2, d), alu(C(p.color2, '#3a3d42')), 0, 0.006, 0), ns(mesh(new THREE.CylinderGeometry(0.05, 0.05, d * 0.9, 12, 1, true).rotateX(PI / 2).translate(0, y0 - 0.06, 0), K.mat(C(p.color, '#2b2d31'), { roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }))));
    g.add(rbox(w, bh - 0.02, d - 0.02, m, 0, y0 + (bh - 0.02) / 2, -0.01, 0.012, 2), box(w, 0.02, d, m, 0, h - 0.01, 0), box(w * 0.8, 0.012, 0.012, dark('#0f0f10'), 0, h - 0.06, d / 2 - 0.014), box(w * 0.84, 0.03, 0.008, inox(), 0, h - 0.045, d / 2 - 0.006), box(w * 0.4, bh * 0.16, 0.006, K.mat('#f1f1ee'), 0, y0 + bh * 0.35, d / 2 - 0.017));
  } else if (v === 'rain-barrel') {
    const c = C(p.color, '#4a5a4f'), y0 = 0.12 * h, H = h - y0 - 0.03;
    g.add(cylOn(0.82 * R, 0.82 * R, y0, K.stone(C(p.color2, '#a39c90')), 0, 0, 0, 16), lathe([[0.78 * R, y0], [0.95 * R, y0 + 0.2 * H], [R, y0 + 0.5 * H], [0.95 * R, y0 + 0.8 * H], [0.8 * R, y0 + H]], K.mat(c, { roughness: 0.6 }), 24), cylOn(0.84 * R, 0.84 * R, 0.03, K.mat(K.shade(c, -0.15), { roughness: 0.6 }), 0, h - 0.03, 0, 24));
    g.add(merge([torusG(0.955 * R, 0.008, 'xz', 0, y0 + 0.22 * H, 0, 24, 4), torusG(0.955 * R, 0.008, 'xz', 0, y0 + 0.78 * H, 0, 24, 4)], dark('#2b2d31')), merge([zCylG(0.012, 0.07, 0, y0 + 0.1 * H, 0.86 * R + 0.02, 8), cylG(0.01, 0.01, 0.04, 0, y0 + 0.085 * H, 0.86 * R + 0.045, 8)], K.metal('#c5a35a', { roughness: 0.3 })));
  } else if (v === 'ev-charger') {
    const body = K.mat(C(p.color, '#f1f1ee'), { roughness: 0.35 }), tall = h > 0.8, uh = tall ? Math.min(0.42, 0.3 * h) : h, y0 = h - uh, ud = tall ? clamp(d - 0.137, 0.04, 0.16) : Math.max(0.03, d - 0.057);
    if (tall) g.add(box(Math.min(w, 0.16), h, 0.08, alu(C(p.color2, '#3a3d42')), 0, h / 2, -d / 2 + 0.04), box(w, 0.012, d, alu(C(p.color2, '#3a3d42')), 0, 0.006, 0));
    const zu = tall ? -d / 2 + 0.08 + ud / 2 : -d / 2 + ud / 2, cr = Math.min(0.13, w * 0.42, uh * 0.4);
    g.add(rbox(w, uh, ud, body, 0, y0 + uh / 2, zu, 0.03, 2), box(w * 0.66, uh * 0.5, 0.006, dark('#17181a'), 0, y0 + uh * 0.6, zu + ud / 2 + 0.001), ns(box(w * 0.4, 0.012, 0.004, K.glow(C(p.color3, '#5fd08a'), 1.2), 0, y0 + uh * 0.22, zu + ud / 2 + 0.003)));
    g.add(merge([torusG(cr, 0.012, 'xy', 0, tall ? y0 - cr * 0.6 : cr + 0.012, zu + ud / 2 + 0.02, 18, 6), torusG(cr * 0.92, 0.012, 'xy', 0, tall ? y0 - cr * 0.6 : cr + 0.012, zu + ud / 2 + 0.045, 18, 6)], rubber()), box(0.05, 0.1, Math.max(0.02, d - (zu + ud / 2 + d / 2)), dark(), w * 0.28, tall ? y0 + uh * 0.2 : uh * 0.3, (zu + ud / 2 + d / 2) / 2));
  } else if (v === 'gas-tanks') {
    const c = C(p.color, '#b9bfc4'), m = K.mat(c, { roughness: 0.45, metalness: 0.3 }), r = Math.max(0.02, Math.min(w / 4 - 0.01, d / 2 - 0.01)), hc = h - 0.03, geos = [], col = [];
    for (const s of [-1, 1]) { const x = s * (w / 4); geos.push(latheG([[0.82 * r, 0.03], [r, 0.07], [r, 0.03 + 0.72 * hc], [0.72 * r, 0.03 + 0.86 * hc], [0.3 * r, 0.03 + 0.9 * hc]], 20, x, 0, 0)); col.push(new THREE.CylinderGeometry(0.5 * r, 0.5 * r, 0.1 * hc, 14, 1, true).translate(x, 0.03 + 0.95 * hc, 0)); rl.push([[x, 0.03 + 0.92 * hc, 0], [0, 0.03 + 0.8 * hc, -r * 0.6], 0.006]); }
    g.add(box(w, 0.03, d, K.stone(C(p.color2, '#a39c90')), 0, 0.015, 0), merge(geos, m), merge(col, K.mat(c, { roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide })), rods(rl, 0.006, K.mat('#e0762b', { roughness: 0.6 }), 5), box(0.07, 0.05, 0.05, K.mat(C(p.color3, '#b3272d'), { roughness: 0.5 }), 0, 0.03 + 0.8 * hc, -r * 0.6), merge([-1, 1].map((s) => cylG(0.018, 0.018, 0.05, s * w / 4, 0.03 + 0.92 * hc, 0, 8)), K.metal('#c5a35a', { roughness: 0.3 })));
  } else if (v === 'irrigation-controller') {
    const body = K.mat(C(p.color, '#d9dcdc'), { roughness: 0.5 }), tall = h > 0.5, uh = tall ? Math.min(0.3, 0.26 * h) : h, y0 = h - uh, ud = tall ? Math.min(0.12, d * 0.6) : d, zu = -d / 2 + (tall ? 0.05 : 0) + ud / 2;
    if (tall) {
      g.add(box(0.05, h - 0.01, 0.05, alu(C(p.color2, '#8a8d91')), 0, (h - 0.01) / 2, -d / 2 + 0.025), mesh(xCylG(0.02, w, 0, 0.1, 0, 10), dark('#2b2d31')));
      const n = Math.max(2, Math.round(w / 0.13));
      for (let i = 0; i < n; i++) { const x = lerp(-w / 2, w / 2, (i + 0.5) / n); list.push([0.07, 0.07, Math.min(0.1, d), x, 0.14, 0]); rl.push([[x, 0.17, 0], [x, 0.23, 0]]); }
      g.add(boxes(list.splice(0), dark('#1c1d20')), rods(rl, 0.02, K.plastic(C(p.color3, '#3fa7d6')), 8), box(w, 0.02, d, K.plastic('#3d7a4a'), 0, 0.01, 0));
    }
    g.add(rbox(w, uh, ud, body, 0, y0 + uh / 2, zu, 0.015, 2), box(w * 0.5, uh * 0.3, 0.004, dark('#22313a'), -w * 0.12, y0 + uh * 0.68, zu + ud / 2 + 0.001), mesh(zCylG(Math.min(0.035, w * 0.12), 0.015, w * 0.28, y0 + uh * 0.66, zu + ud / 2 + 0.006, 12), dark('#55585c')), boxes([0, 1, 2, 3].map((i) => [w * 0.12, uh * 0.1, 0.006, lerp(-w * 0.3, w * 0.3, i / 3), y0 + uh * 0.25, zu + ud / 2 + 0.002]), K.plastic(C(p.color3, '#3fa7d6'))));
  } else if (v === 'bike-rack') {
    const m = K.metal(C(p.color, '#b9bdc2'), { roughness: 0.4, metalness: 0.7 }), n = Math.max(2, Math.round(w / 0.4)), z = d / 2 - 0.02, geos = [boxG(w, 0.03, 0.04, 0, 0.015, z), boxG(w, 0.03, 0.04, 0, 0.015, -z)];
    for (let i = 0; i < n; i++) { const x = lerp(-w / 2 + 0.012, w / 2 - 0.012, n === 1 ? 0.5 : i / (n - 1)); geos.push(tubeG([[x, 0.02, -z], [x, h * 0.72, -z + Math.min(0.05, d * 0.1)], [x, h - 0.012, 0], [x, h * 0.72, z - Math.min(0.05, d * 0.1)], [x, 0.02, z]], 0.012, 14, 6)); }
    g.add(merge(geos, m));
  } else {
    const wd = M(p.material, C(p.color, '#c8a476'), 'wood'), fr = alu(C(p.color2, '#2b2d31')), tall = h > 1.2, hb = tall ? 0.45 : h, ls = 0.03, boots = [[], []];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) list.push([ls, hb - 0.035, ls, sx * (w / 2 - ls / 2 - 0.02), (hb - 0.035) / 2, sz * (d / 2 - ls / 2 - 0.01)]);
    for (const s of [-1, 1]) list.push([ls, ls, d - 0.04, s * (w / 2 - ls / 2 - 0.02), 0.11, 0]);
    g.add(boxes(list.splice(0), fr));
    list.push([w, 0.035, d, 0, hb - 0.0175, 0]);
    for (let i = 0; i < 3; i++) list.push([w - 0.1, 0.018, (d - 0.05) / 3 - 0.012, 0, 0.134, lerp(-d / 2 + 0.025, d / 2 - 0.025, (i + 0.5) / 3)]);
    if (tall) { for (const s of [-1, 1]) list.push([0.045, h - hb, 0.022, s * (w / 2 - 0.04), hb + (h - hb) / 2, -d / 2 + 0.011]); for (let i = 0; i < 3; i++) list.push([w, 0.11, 0.018, 0, h - 0.12 - i * 0.14, -d / 2 + 0.031]); list.push([w, 0.022, Math.min(d, 0.2), 0, h - 0.011, -d / 2 + Math.min(d, 0.2) / 2]); g.add(rods([-0.36, -0.12, 0.12, 0.36].map((t) => [[t * w, h - 0.26, -d / 2 + 0.04], [t * w, h - 0.29, -d / 2 + 0.085]]), 0.007, inox(), 5)); }
    g.add(boxes(list.splice(0), wd));
    const bs = Math.min(1, (hb - 0.17) / 0.26, d / 0.3);
    if (bs > 0.3) { [-0.3, -0.19, 0.12, 0.23].forEach((t, i) => { const x = t * w, k = i < 2 ? 0 : 1, sh = (k ? 0.1 : 0.24) * bs; boots[k].push([0.085 * bs, 0.06 * bs, 0.25 * bs, x, 0.143 + 0.03 * bs, 0.01], [0.08 * bs, sh, 0.1 * bs, x, 0.143 + 0.06 * bs + sh / 2 - 0.01, -0.065 * bs]); }); g.add(boxes(boots[0], K.mat(C(p.color3, '#3d5a45'), { roughness: 0.5 })), boxes(boots[1], K.leather('#7a5236'))); }
  }
}
function utilitySym(ctx, { w, d, h, p, px, v }) {
  const R = Math.min(w, d) / 2, col = C(p.color, '#c9ccd0'), tint = K.tint(col, 0.4);
  if (v === 'clothesline-rotary') {
    dashed(ctx, px, () => rect(ctx, 0, 0, w, d, null, SOFT, px));
    for (const s of [-1, 1]) line(ctx, -w / 2, s * d / 2, w / 2, -s * d / 2, INK, px);
    for (let k = 0; k < 5; k++) { const t = lerp(0.32, 0.98, k / 4); if (w * t > 6 * px * (k + 1)) rect(ctx, 0, 0, w * t, d * t, null, SOFT, px); }
    circ(ctx, 0, 0, Math.max(3, 1.6 * px), '#8a8d91', INK, px);
  } else if (v === 'clothesline-wall' || v === 'clothes-rack') {
    rect(ctx, 0, 0, w, d, 'rgba(255,255,255,0.35)', INK, px, 1);
    if (v === 'clothesline-wall') { hatch(ctx, -w / 2, -d / 2, w / 2, d / 2, Math.min(Math.max(3, Math.round(d / 12)) - 1, Math.floor(d / (3 * px))), true, SOFT, px); line(ctx, -w / 2, -d / 2 + 2, w / 2, -d / 2 + 2, INK, Math.max(2 * px, 4)); }
    else { hatch(ctx, -w / 2, -d / 2, w / 2, d / 2, Math.min(13, Math.floor(w / (3 * px))), false, SOFT, px); for (const s of [-1, 1]) line(ctx, s * w / 4, -d / 2, s * w / 4, d / 2, INK, px); }
  } else if (v === 'outdoor-shower') {
    const big = R >= 30, zc = big ? -d / 2 + 12 : -d / 2 + 3.5, reach = Math.min(34, d - 16);
    if (big) { rect(ctx, 0, 0, w, d, K.tint('#a9743f', 0.45), INK, px); hatch(ctx, -w / 2, -d / 2, w / 2, d / 2, Math.min(Math.max(2, Math.round(d / 10)) - 1, Math.floor(d / (3 * px))), true, SOFT, px); line(ctx, -w / 2, -d / 2 + 3, w / 2, -d / 2 + 3, K.shade('#a9743f', -0.2), Math.max(2 * px, 5)); }
    else circ(ctx, 0, 0, R, K.tint(col, 0.5), INK, px);
    line(ctx, 0, zc, 0, zc + reach, INK, 1.6 * px); circ(ctx, 0, zc + reach, Math.min(11, w / 2), '#eef1f2', INK, px); circ(ctx, 0, zc, Math.max(2, 1.4 * px), INK, null);
  } else if (v === 'hose-reel') {
    rect(ctx, 0, 0, w, d, null, INK, px, 2); rect(ctx, 0, 0, w - 14, Math.min(d * 0.72, h * 0.6), K.tint(C(p.color, '#3d7a4a'), 0.3), INK, px, 3); hatch(ctx, -w / 2 + 7, -d * 0.36, w / 2 - 7, d * 0.36, Math.min(6, Math.floor(w / (3 * px))), false, SOFT, px);
  } else if (v === 'tap') {
    const ps = Math.min(10, w); rect(ctx, 0, 0, w, d, K.tint(C(p.color2, '#b9b2a6'), 0.5), SOFT, px, 1); rect(ctx, 0, -d / 2 + ps / 2, ps, ps, K.tint(C(p.color, '#b98a5e'), 0.3), INK, px); circ(ctx, 0, -d / 2 + ps + Math.min(11, (d - ps) * 0.42) + 1, Math.min(11, w * 0.45, (d - ps) * 0.42), '#d5dadd', INK, px);
  } else if (v === 'bin' || v === 'bins-3') {
    const n = v === 'bin' ? 1 : 3, bw = (w - (n - 1) * 3) / n, lids = v === 'bin' ? [C(p.color2, C(p.color, '#3d5a45'))] : [C(p.color2, BIN_LIDS[0]), C(p.color3, BIN_LIDS[1]), BIN_LIDS[2]];
    for (let i = 0; i < n; i++) { const x = -w / 2 + bw / 2 + i * (bw + 3); rect(ctx, x, 0, bw, d, K.tint(lids[i], 0.35), INK, px, Math.min(6, bw * 0.15)); line(ctx, x - bw * 0.42, -d / 2 + d * 0.1, x + bw * 0.42, -d / 2 + d * 0.1, INK, 1.5 * px); line(ctx, x - bw * 0.3, d / 2 - d * 0.06, x + bw * 0.3, d / 2 - d * 0.06, SOFT, px); }
  } else if (v === 'compost') {
    rect(ctx, 0, 0, w, d, K.tint(C(p.color, '#2b3a2e'), 0.45), INK, px, 4); rect(ctx, 0, 0, w * 0.84, d * 0.84, K.tint(C(p.color, '#2b3a2e'), 0.6), INK, px, 3); line(ctx, -w * 0.15, 0, w * 0.15, 0, INK, 1.5 * px);
  } else if (v === 'mailbox') {
    rect(ctx, 0, 0, w, d, K.tint(C(p.color, '#2b2d31'), 0.45), INK, px, 1.5); line(ctx, -w * 0.4, d / 2 - Math.min(3, d * 0.2), w * 0.4, d / 2 - Math.min(3, d * 0.2), INK, 1.5 * px);
  } else if (v === 'rain-barrel') {
    circ(ctx, 0, 0, R, K.tint(C(p.color, '#4a5a4f'), 0.4), INK, px); circ(ctx, 0, 0, R * 0.84, null, SOFT, px); circ(ctx, 0, R * 0.9, Math.max(1.6, px), '#c5a35a', INK, px * 0.6);
  } else if (v === 'ev-charger') {
    const tall = h > 80; if (tall) rect(ctx, 0, -d / 2 + 4, Math.min(w, 16), 8, '#55585c', INK, px);
    rect(ctx, 0, tall ? -d / 2 + 8 + Math.min(d - 8, 16) / 2 : -d * 0.2, w, tall ? Math.min(d - 8, 16) : d * 0.6, K.tint(C(p.color, '#f1f1ee'), 0.2), INK, px, 3); circ(ctx, 0, d / 2 - Math.min(5, d * 0.2), Math.min(4, d * 0.18), '#5fd08a', INK, px * 0.7);
  } else if (v === 'gas-tanks') {
    const r = Math.max(2, Math.min(w / 4 - 1, d / 2 - 1)); rect(ctx, 0, 0, w, d, K.tint(C(p.color2, '#a39c90'), 0.55), SOFT, px);
    for (const s of [-1, 1]) { circ(ctx, s * w / 4, 0, r, K.tint(C(p.color, '#b9bfc4'), 0.3), INK, px); circ(ctx, s * w / 4, 0, r * 0.5, null, SOFT, px); circ(ctx, s * w / 4, 0, Math.max(1.5, px), '#c5a35a', null); }
    line(ctx, -w / 4, 0, w / 4, 0, '#e0762b', px);
  } else if (v === 'irrigation-controller') {
    rect(ctx, 0, 0, w, d, K.tint('#3d7a4a', 0.5), INK, px, 2); const n = Math.max(2, Math.round(w / 13)); for (let i = 0; i < n; i++) circ(ctx, lerp(-w / 2, w / 2, (i + 0.5) / n), d * 0.12, Math.min(3.5, d * 0.2), K.tint(C(p.color3, '#3fa7d6'), 0.2), INK, px * 0.7);
    rect(ctx, 0, -d / 2 + Math.min(6, d * 0.3), w, Math.min(12, d * 0.6), K.tint(C(p.color, '#d9dcdc'), 0.3), INK, px, 1.5);
  } else if (v === 'bike-rack') {
    const n = Math.max(2, Math.round(w / 40)); for (const s of [-1, 1]) line(ctx, -w / 2, s * (d / 2 - 2), w / 2, s * (d / 2 - 2), '#8a8d91', Math.max(1.5 * px, 4));
    for (let i = 0; i < n; i++) { const x = lerp(-w / 2 + 1.2, w / 2 - 1.2, i / (n - 1)); line(ctx, x, -d / 2 + 2, x, d / 2 - 2, INK, Math.max(1.5 * px, 2.4)); }
  } else {
    rect(ctx, 0, 0, w, d, K.tint(C(p.color, '#c8a476'), 0.4), INK, px, 1.5); hatch(ctx, -w / 2, -d / 2, w / 2, d / 2, 2, true, SOFT, px);
    if (h > 120) line(ctx, -w / 2, -d / 2 + 1.5, w / 2, -d / 2 + 1.5, K.shade(C(p.color, '#c8a476'), -0.25), Math.max(2 * px, 3));
  }
}
define('utility', Object.fromEntries(UTIL.map((k) => [k, { b: buildUtility }])), utilitySym);
