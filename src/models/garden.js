/**
 * Garden models — trees, shrubs, hedges, beds, planters, ground surfaces, pools, spas, water features and décor.
 * See docs/CONTRACT.md § 3. Everything is procedural; each object is merged into one mesh per material
 * (vertex colours carry the tonal variation) so that a garden with dozens of plants stays cheap to draw.
 *
 * Sections: 1 core helpers · 2 materials · 3 ground textures · 4 2D helpers · 5 trees · 6 shrubs · 7 hedge ·
 *           8 beds & planters · 9 surface · 10 pool · 11 spa · 12 water features · 13 décor
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerModel } from './registry.js';
import * as K from './kit.js';

// ═════════════════════════════════ 1. core helpers ═════════════════════════════════
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const num = (v, def, lo = -Infinity, hi = Infinity) => { const n = typeof v === 'boolean' || v === null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? clamp(n, lo, hi) : def; };
const oneOf = (v, list, def) => (typeof v === 'string' && list.includes(v) ? v : def);
const params = (p) => (p && typeof p === 'object' ? p : {});
/** Validated colour: '#rgb' / '#rrggbb' or a kit colour keyword; anything else → fallback. */
function hexOf(v, fallback) {
  if (typeof v !== 'string') return fallback;
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + [...v.slice(1)].map((c) => c + c).join('').toLowerCase();
  return K.col(v, fallback);
}
const seedOf = (item, salt) => K.hashStr(String((item && item.id) || salt || 'garden'));

const _colors = new Map();
/** Cached THREE.Color (linear working space) for a hex string. Never mutate the result. */
function C(hex) {
  let c = _colors.get(hex);
  if (!c) { c = new THREE.Color(hex); _colors.set(hex, c); }
  return c;
}
const _tc = new THREE.Color();
/** Mix two hex colours → hex. */
function mix(a, b, t) { return '#' + _tc.copy(C(a)).lerp(C(b), t).getHexString(); }
/** Hue / saturation / lightness shifted copy of a hex colour. */
function hsl(hex, dh = 0, ds = 0, dl = 0) {
  const o = {}; C(hex).getHSL(o);
  return '#' + _tc.setHSL((o.h + dh + 1) % 1, clamp(o.s + ds, 0, 1), clamp(o.l + dl, 0, 1)).getHexString();
}
const rgba = (hex, a) => { const c = C(hex); _tc.copy(c).convertLinearToSRGB(); return `rgba(${Math.round(_tc.r * 255)},${Math.round(_tc.g * 255)},${Math.round(_tc.b * 255)},${a})`; };

// ── geometry painting (vertex colours) ──
function colorAttr(g) {
  let a = g.attributes.color;
  if (!a) { a = new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3); g.setAttribute('color', a); }
  return a;
}
/** Uniform vertex colour. */
function paint(g, hex) {
  const a = colorAttr(g), c = C(hex), arr = a.array;
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  return g;
}
/** Vertical gradient between two colours over [y0, y1]. */
function paintY(g, lo, hi, y0, y1) {
  const a = colorAttr(g).array, p = g.attributes.position, c0 = C(lo), c1 = C(hi);
  for (let i = 0; i < p.count; i++) {
    const t = clamp((p.getY(i) - y0) / Math.max(1e-6, y1 - y0), 0, 1);
    a[i * 3] = lerp(c0.r, c1.r, t); a[i * 3 + 1] = lerp(c0.g, c1.g, t); a[i * 3 + 2] = lerp(c0.b, c1.b, t);
  }
  return g;
}
/**
 * Foliage shading for a NON-indexed geometry: per-face tone that is darker underneath and lighter on top
 * (cheap ambient occlusion + sun), with a little random sparkle per face.
 */
function paintFoliage(g, hex, rnd, { lo = -0.34, hi = 0.12, ao = 1, sparkle = 0.1 } = {}) {
  const a = colorAttr(g).array, p = g.attributes.position, c = C(hex);
  g.computeBoundingBox();
  const y0 = g.boundingBox.min.y, dy = Math.max(1e-6, g.boundingBox.max.y - y0);
  for (let i = 0; i < p.count; i += 3) {
    const t = ((p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3 - y0) / dy;
    const f = (1 + lerp(lo, hi, t)) * ao * (1 - sparkle / 2 + rnd() * sparkle);
    for (let k = 0; k < 3; k++) { const j = (i + k) * 3; a[j] = c.r * f; a[j + 1] = c.g * f * (1 + 0.03 * t); a[j + 2] = c.b * f * (1 - 0.1 * t); }
  }
  return g;
}

// ── batch: collects geometries per material and merges them into one mesh each ──
class Batch {
  constructor() { this.buckets = new Map(); }
  /** Add a private geometry (it is consumed). `color` = hex for a uniform vertex colour (optional if already painted). */
  add(material, geo, color) {
    if (!geo || !material) return this;
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (color) paint(g, color); else if (!g.attributes.color) paint(g, '#ffffff');
    g.morphAttributes = {};
    let list = this.buckets.get(material);
    if (!list) { list = []; this.buckets.set(material, list); }
    list.push(g);
    return this;
  }
  /** Bounding box of everything added so far. */
  bounds() {
    const bb = new THREE.Box3();
    for (const list of this.buckets.values()) for (const g of list) { g.computeBoundingBox(); bb.union(g.boundingBox); }
    return bb;
  }
  /**
   * Stretch the content so that it fills exactly x ∈ [-w/2, w/2], z ∈ [-d/2, d/2], y ∈ [0, h].
   * Each side of the origin is scaled separately, so whatever stands at the origin (a trunk) stays there.
   */
  fit(w, d, h) {
    const bb = this.bounds();
    if (bb.isEmpty()) return this;
    const s = (half, v) => (Math.abs(v) > 1e-5 ? half / Math.abs(v) : 1);
    const sxp = s(w / 2, bb.max.x), sxn = s(w / 2, bb.min.x), szp = s(d / 2, bb.max.z), szn = s(d / 2, bb.min.z);
    const sy = h != null && bb.max.y - bb.min.y > 1e-5 ? h / (bb.max.y - bb.min.y) : 1, y0 = h != null ? bb.min.y : 0;
    for (const list of this.buckets.values()) for (const g of list) {
      const a = g.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) {
        a[i] *= a[i] >= 0 ? sxp : sxn; a[i + 1] = (a[i + 1] - y0) * sy; a[i + 2] *= a[i + 2] >= 0 ? szp : szn;
      }
      g.boundingBox = null;
    }
    return this;
  }
  /** Merge and return a Group with one mesh per material. */
  build(group = new THREE.Group()) {
    for (const [material, list] of this.buckets) {
      const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, material);
      if (material.transparent || material.userData.noShadow) mesh.userData.noShadow = true;
      if (material.userData.renderOrder) mesh.renderOrder = material.userData.renderOrder;
      mesh.castShadow = !mesh.userData.noShadow; mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
  /** Number of triangles collected so far. */
  triangles() { let t = 0; for (const list of this.buckets.values()) for (const g of list) t += g.attributes.position.count / 3; return t; }
}

// ── primitive geometries (fresh, already positioned) ──
const boxG = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const boxOnG = (w, h, d, x = 0, y0 = 0, z = 0) => boxG(w, h, d, x, y0 + h / 2, z);
const cylG = (rt, rb, h, x = 0, y0 = 0, z = 0, seg = 16, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).translate(x, y0 + h / 2, z);
const sphG = (r, x = 0, y = 0, z = 0, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs).translate(x, y, z);
const torusG = (R, r, x = 0, y = 0, z = 0, rs = 8, ts = 24) => new THREE.TorusGeometry(R, r, rs, ts).rotateX(Math.PI / 2).translate(x, y, z);
/** Lathe around the Y axis from [[radius, y], …] (bottom → top). */
const latheG = (pts, seg = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y)), seg);
/** Rotate about Y then move. */
const placed = (g, x = 0, y = 0, z = 0, ry = 0) => { if (ry) g.rotateY(ry); return g.translate(x, y, z); };
/** Straight round bar between two points. */
function barG(a, b, r, seg = 6) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), len = Math.max(1e-4, va.distanceTo(vb));
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return g.applyQuaternion(q).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}
/** Flat quad from four corners (counter-clockwise seen from its front). */
function quadG(a, b, c, d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c, ...a, ...c, ...d]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), 2));
  g.computeVertexNormals();
  return g;
}
/** Non-indexed geometry from a flat list of triangle vertex coordinates. */
function trisG(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr instanceof Float32Array ? arr : new Float32Array(arr), 3));
  g.computeVertexNormals();
  return g;
}
/** Extruded 2D outline [[x, z], …] of thickness h with its bottom at y0 (holes = more outlines). */
function extrudeG(pts, h, y0 = 0, holes = []) {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const hole of holes) s.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
  return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 4 }).rotateX(-Math.PI / 2).translate(0, y0, 0);
}
/** Flat horizontal polygon facing up at height y, with world-scaled UVs (u = x / su, v = z / sv). */
function flatG(pts, y, su = 1, sv = su, holes = []) {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const hole of holes) s.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
  const g = new THREE.ShapeGeometry(s, 4).rotateX(-Math.PI / 2).translate(0, y, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / su, p.getZ(i) / sv);
  return g;
}

const _ico = [0, 1, 2].map((d) => new THREE.IcosahedronGeometry(1, d).attributes.position.array);
/**
 * Lumpy ellipsoid “foliage / rock blob” (non-indexed icosphere displaced by smooth noise).
 * o: { detail 0-2, amp noise amplitude, floor: clamp to y ≥ floor, squash: flatten the underside }
 */
function blobG(rx, ry, rz, x, y, z, rnd, o = {}) {
  const src = _ico[o.detail ?? 1], n = src.length / 3, amp = o.amp ?? 0.2;
  const pos = new Float32Array(src.length), nor = new Float32Array(src.length);
  const s1 = rnd() * 9, s2 = rnd() * 9, s3 = rnd() * 9, yaw = rnd() * TAU, ca = Math.cos(yaw), sa = Math.sin(yaw);
  for (let i = 0; i < n; i++) {
    const ax = src[i * 3], ay = src[i * 3 + 1], az = src[i * 3 + 2];
    const k = 1 + amp * (Math.sin(ax * 3.3 + s1) * Math.sin(ay * 3.1 + s2) + 0.7 * Math.sin(az * 3.9 + s3) * Math.sin(ax * 2.3 + s2));
    const px = (ax * ca - az * sa) * k, pz = (ax * sa + az * ca) * k;
    let py = ay * k;
    if (o.squash && py < 0) py *= o.squash;
    let wy = y + py * ry;
    if (o.floor != null && wy < o.floor) wy = o.floor;
    pos[i * 3] = x + px * rx; pos[i * 3 + 1] = wy; pos[i * 3 + 2] = z + pz * rz;
    nor[i * 3] = px; nor[i * 3 + 1] = py; nor[i * 3 + 2] = pz;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/**
 * Tapered tube along a poly-line (trunks, branches, canes, rails).
 * o: { flute amplitude, lobes, spin (flute twist per ring), cap: close the far end, rough: per-vertex radius noise (needs rnd) }
 */
function tubeG(pts, radii, seg = 7, o = {}) {
  const n = pts.length, pos = [], idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(1, 0, 0), B = new THREE.Vector3(), P = new THREE.Vector3();
  const rad = (i) => (Array.isArray(radii) ? radii[Math.min(i, radii.length - 1)] : radii);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
    T.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    if (T.lengthSq() < 1e-12) T.set(0, 1, 0);
    T.normalize();
    if (i === 0 && Math.abs(T.x) > 0.9) N.set(0, 0, 1);
    N.sub(P.copy(T).multiplyScalar(N.dot(T)));
    if (N.lengthSq() < 1e-8) N.set(T.y, -T.x, 0);
    N.normalize(); B.crossVectors(T, N);
    const r = rad(i);
    for (let j = 0; j < seg; j++) {
      const ang = (j / seg) * TAU;
      let rr = r;
      if (o.flute) rr *= 1 + o.flute * Math.sin(ang * (o.lobes || 5) + i * (o.spin || 0) + (o.phase || 0));
      if (o.rough && o.rnd) rr *= 1 + (o.rnd() - 0.5) * o.rough;
      const cx = Math.cos(ang) * rr, sx = Math.sin(ang) * rr;
      pos.push(pts[i][0] + N.x * cx + B.x * sx, pts[i][1] + N.y * cx + B.y * sx, pts[i][2] + N.z * cx + B.z * sx);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
    idx.push(a, b, c, b, d, c);
  }
  if (o.cap) {
    const e = pos.length / 3; pos.push(...pts[n - 1]);
    for (let j = 0; j < seg; j++) idx.push((n - 1) * seg + j, (n - 1) * seg + ((j + 1) % seg), e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** Points along a quadratic Bézier a → b with control c. */
function bez(a, c, b, n = 5) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2]]);
  }
  return out;
}
const taper = (r0, r1, n) => Array.from({ length: n + 1 }, (_, i) => lerp(r0, r1, i / n));

/**
 * A cloud of n small two-sided leaf “cards” (diamonds) on an ellipsoid shell — breaks up blob silhouettes.
 * o: { aspect width/length, hang 0..1 (leaves point down), colors: [hex…], up: keep to the upper part }
 */
function leafCloudG(c, r, n, size, rnd, o = {}) {
  const pos = new Float32Array(n * 18), col = new Float32Array(n * 18), aspect = o.aspect ?? 0.45, colors = o.colors || ['#5c8a45'];
  const d = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const cy = o.up ? rnd() * 1.2 - 0.2 : rnd() * 1.7 - 0.7, a = rnd() * TAU, sr = Math.sqrt(Math.max(0, 1 - Math.min(1, cy * cy)));
    d.set(Math.cos(a) * sr, clamp(cy, -1, 1), Math.sin(a) * sr);
    const k = (o.shell ?? 0.92) + rnd() * (o.spread ?? 0.3);
    const px = c[0] + d.x * r[0] * k, py = c[1] + d.y * r[1] * k, pz = c[2] + d.z * r[2] * k;
    u.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).addScaledVector(d, 0.6);
    if (o.hang) u.lerp(q.set(d.x * 0.25, -1, d.z * 0.25), o.hang);
    u.normalize();
    v.crossVectors(u, q.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5)).normalize();
    const L = size * (0.7 + rnd() * 0.6) / 2, Wd = L * aspect;
    const A = [px - u.x * L, py - u.y * L, pz - u.z * L], Bp = [px + u.x * L, py + u.y * L, pz + u.z * L];
    const m = -0.15 * L, Lf = [px + u.x * m + v.x * Wd, py + u.y * m + v.y * Wd, pz + u.z * m + v.z * Wd], Rt = [px + u.x * m - v.x * Wd, py + u.y * m - v.y * Wd, pz + u.z * m - v.z * Wd];
    pos.set([...A, ...Lf, ...Bp, ...A, ...Bp, ...Rt], i * 18);
    const cc = C(colors[Math.floor(rnd() * colors.length) % colors.length]), f = 0.82 + rnd() * 0.3 + 0.1 * d.y;
    for (let k2 = 0; k2 < 6; k2++) { col[i * 18 + k2 * 3] = cc.r * f; col[i * 18 + k2 * 3 + 1] = cc.g * f; col[i * 18 + k2 * 3 + 2] = cc.b * f; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A long leaf / frond blade as a two-sided strip along a poly-line: width follows profile(t), the two halves
 * fold down (fold > 0) or up (fold < 0) from the midrib. `up` is the reference “up” direction.
 */
function bladeG(pts, width, profile, o = {}) {
  const n = pts.length, fold = o.fold ?? 0.25, tri = [];
  const T = new THREE.Vector3(), S = new THREE.Vector3(), U = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
    T.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]).normalize();
    S.crossVectors(T, up);
    if (S.lengthSq() < 1e-6) S.set(1, 0, 0);
    S.normalize(); U.crossVectors(S, T);
    const wd = (width / 2) * profile(i / (n - 1));
    L.push([pts[i][0] + S.x * wd - U.x * wd * fold, pts[i][1] + S.y * wd - U.y * wd * fold, pts[i][2] + S.z * wd - U.z * wd * fold]);
    R.push([pts[i][0] - S.x * wd - U.x * wd * fold, pts[i][1] - S.y * wd - U.y * wd * fold, pts[i][2] - S.z * wd - U.z * wd * fold]);
  }
  for (let i = 0; i < n - 1; i++) {
    if (o.skip && o.skip(i)) continue;
    tri.push(...pts[i], ...L[i], ...L[i + 1], ...pts[i], ...L[i + 1], ...pts[i + 1], ...pts[i], ...pts[i + 1], ...R[i + 1], ...pts[i], ...R[i + 1], ...R[i]);
  }
  return trisG(tri);
}
const lanceolate = (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.8);
const strap = (t) => (t < 0.12 ? 0.55 + t * 3.75 : Math.pow(1 - (t - 0.12) / 0.88, 0.55));

/** Closed 2D outline helpers: all return [[x, z], …] counter-clockwise in plan (x right, z front). */
function ellipsePts(rx, rz, n = 40, cx = 0, cz = 0) { return Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * TAU) * rx, cz + Math.sin((i / n) * TAU) * rz]); }
function roundRectPts(w, d, r, seg = 5) {
  r = Math.max(0, Math.min(r, w / 2 - 1e-4, d / 2 - 1e-4));
  if (r < 1e-4) return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  const out = [], corners = [[w / 2 - r, -d / 2 + r, -Math.PI / 2], [w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, Math.PI / 2], [-w / 2 + r, -d / 2 + r, Math.PI]];
  for (const [cx, cz, a0] of corners) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return out;
}
/** Organic closed outline: an ellipse whose radius is modulated by a few harmonics. */
function organicPts(rx, rz, rnd, n = 36, amp = 0.12) {
  const ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU], out = [];
  let mx = 0, mz = 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, k = 1 + amp * (Math.sin(a * 2 + ph[0]) + 0.6 * Math.sin(a * 3 + ph[1]) + 0.35 * Math.sin(a * 5 + ph[2]));
    out.push([Math.cos(a) * k, Math.sin(a) * k]); mx = Math.max(mx, Math.abs(out[i][0])); mz = Math.max(mz, Math.abs(out[i][1]));
  }
  return out.map(([x, z]) => [(x / mx) * rx, (z / mz) * rz]);
}
/** Offset a closed counter-clockwise outline inwards (dist > 0) with mitred corners. */
function insetPts(pts, dist) {
  const n = pts.length, out = [];
  let area = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    let ax = p1[0] - p0[0], az = p1[1] - p0[1], bx = p2[0] - p1[0], bz = p2[1] - p1[1];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const n1x = -az * sgn, n1z = ax * sgn, n2x = -bz * sgn, n2z = bx * sgn;   // inward normals
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = dist / Math.max(0.35, mx * n1x + mz * n1z);
    out.push([p1[0] + mx * k, p1[1] + mz * k]);
  }
  return out;
}
/** Vertical wall strip along a closed outline between y0 and y1; inward = faces look to the inside. */
function wallG(pts, y0, y1, inward = false, su = 1) {
  const tri = [], uv = [], n = pts.length;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]), u1 = u + len / su;
    const A0 = [a[0], y0, a[1]], B0 = [b[0], y0, b[1]], A1 = [a[0], y1, a[1]], B1 = [b[0], y1, b[1]];
    if (inward) { tri.push(...A0, ...B0, ...B1, ...A0, ...B1, ...A1); uv.push(u, y0 / su, u1, y0 / su, u1, y1 / su, u, y0 / su, u1, y1 / su, u, y1 / su); }
    else { tri.push(...A0, ...B1, ...B0, ...A0, ...A1, ...B1); uv.push(u, y0 / su, u1, y1 / su, u1, y0 / su, u, y0 / su, u, y1 / su, u1, y1 / su); }
    u = u1;
  }
  const g = trisG(tri);
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  return g;
}

// ═════════════════════════════════ 2. materials ═════════════════════════════════
const _vm = new Map();
/**
 * Shared vertex-coloured materials (white base — the colour comes from the geometry):
 * 'leaf' flat + two-sided foliage · 'flat' faceted (rocks) · 'bark' / 'matte' / 'satin' / 'gloss' smooth with falling roughness.
 */
function vmat(kind = 'matte') {
  let m = _vm.get(kind);
  if (m) return m;
  const def = { leaf: [0.86, true, THREE.DoubleSide], flat: [0.92, true, THREE.FrontSide], bark: [0.95, false, THREE.FrontSide], matte: [0.85, false, THREE.FrontSide],
    satin: [0.5, false, THREE.FrontSide], gloss: [0.16, false, THREE.FrontSide], two: [0.8, false, THREE.DoubleSide], metal: [0.38, false, THREE.FrontSide] }[kind] || [0.85, false, THREE.FrontSide];
  m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: def[0], metalness: kind === 'metal' ? 0.85 : 0, flatShading: def[1], side: def[2] });
  m.name = 'garden-' + kind;
  _vm.set(kind, m);
  return m;
}
/** Material for a pot / frame from the common `material` vocabulary → [material, colour]. */
function bodyMat(material, color) {
  switch (material) {
    case 'ceramic': return [vmat('gloss'), color || '#e9e6df'];
    case 'terracotta': return [vmat('matte'), color || '#c2714f'];
    case 'concrete': case 'stone': return [vmat('matte'), color || '#a9a8a3'];
    case 'fibre-clay': case 'fiber-clay': case 'fibreclay': return [vmat('matte'), color || '#4a4c50'];
    case 'plastic': return [vmat('satin'), color || '#5b5f66'];
    case 'metal': case 'aluminium': case 'steel': return [vmat('metal'), color || '#7d8288'];
    case 'corten': return [vmat('matte'), color || '#9a5230'];
    case 'wood': case 'teak': return [K.wood(color || (material === 'teak' ? 'teak' : '#a9774a')), null];
    case 'rattan': return [vmat('matte'), color || '#c9a878'];
    default: return [vmat('matte'), color || '#c2714f'];
  }
}

// ═════════════════════════════════ 3. procedural ground textures (world-scaled) ═════════════════════════════════
const _ground = new Map();
const hasDom = typeof document !== 'undefined';
function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h)); return c; }
/** Draw something that may cross the edges of a tiling canvas at every wrapped position. */
function wrapDraw(cw, ch, x, y, r, fn) {
  const xs = [x], ys = [y];
  if (x < r) xs.push(x + cw); else if (x > cw - r) xs.push(x - cw);
  if (y < r) ys.push(y + ch); else if (y > ch - r) ys.push(y - ch);
  for (const xx of xs) for (const yy of ys) fn(xx, yy);
}
function grain(g, cw, ch, rnd, n, alpha = 0.08, size = 1.4) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${alpha * rnd()})` : `rgba(255,255,255,${alpha * rnd()})`;
    g.fillRect(rnd() * cw, rnd() * ch, size * (0.5 + rnd()), size * (0.5 + rnd()));
  }
}
function blotches(g, cw, ch, rnd, n, colors, rMin, rMax, alpha) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * cw, y = rnd() * ch, r = lerp(rMin, rMax, rnd()), col = colors[Math.floor(rnd() * colors.length)];
    wrapDraw(cw, ch, x, y, r, (xx, yy) => {
      const gr = g.createRadialGradient(xx, yy, 0, xx, yy, r);
      gr.addColorStop(0, rgba(col, alpha)); gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.fillRect(xx - r, yy - r, r * 2, r * 2);
    });
  }
}
/** Loose particles (gravel, tuff, bark chips…): n random convex polygons with a light edge. */
function pebbles(g, cw, ch, rnd, n, colors, rMin, rMax, o = {}) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * cw, y = rnd() * ch, r = lerp(rMin, rMax, rnd() * rnd()), rot = rnd() * TAU, el = o.elong ? lerp(1.6, o.elong, rnd()) : 1 + rnd() * 0.5;
    const col = colors[Math.floor(rnd() * colors.length)], sides = o.sides || 7, k = Array.from({ length: sides }, () => 0.78 + rnd() * 0.3);
    wrapDraw(cw, ch, x, y, r * el + 2, (xx, yy) => {
      g.save(); g.translate(xx, yy); g.rotate(rot);
      g.beginPath();
      for (let s = 0; s < sides; s++) { const a = (s / sides) * TAU; g.lineTo(Math.cos(a) * r * el * k[s], Math.sin(a) * r * k[s]); }
      g.closePath();
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.translate(0.8, 1.1); g.fill(); g.translate(-0.8, -1.1);
      g.fillStyle = col; g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = 1; g.stroke();
      g.restore();
    });
  }
}
/** Rectangular unit layouts (in tile units) for the paving patterns → { rects: [x, y, w, h][], pw, pd } in metres. */
function tileLayout(pattern, tw, th, rnd) {
  const rects = [];
  if (pattern === 'herringbone') {
    const s = Math.min(tw, th), n = 8;
    for (let r = -2; r < n; r++) for (let c = -2; c < n; c++) {
      const k = (((c - r) % 4) + 4) % 4;
      if (k === 0) rects.push([c * s, r * s, 2 * s, s]); else if (k === 3) rects.push([c * s, r * s, s, 2 * s]);
    }
    return { rects, pw: n * s, pd: n * s };
  }
  if (pattern === 'random') {
    const courses = [1, 0.62, 0.8, 1, 0.62, 0.8].map((k) => k * th), pw = tw * 4;
    let y = 0;
    for (const hC of courses) {
      let x = -rnd() * tw;
      while (x < pw) { const len = Math.min(tw * (0.7 + rnd() * 0.9), 2 * tw); rects.push([x, y, len, hC]); x += len; }
      const last = rects[rects.length - 1]; last[2] = pw + rects.find((q) => q[1] === y)[0] - last[0];
      y += hC;
    }
    return { rects, pw, pd: y };
  }
  if (pattern === 'planks') {
    const rows = 8, pw = Math.max(tw, 3.6);
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * pw * 0.5; const first = x;
      while (x < pw + first - 0.4) { const len = Math.min(pw * (0.35 + rnd() * 0.3), pw + first - x); rects.push([x, r * th, len, th]); x += len; }
      const last = rects[rects.length - 1]; last[2] = pw + first - last[0];
    }
    return { rects, pw, pd: rows * th };
  }
  const nx = tw >= 0.5 ? 4 : 8, ny = th >= 0.5 ? 4 : 8;
  for (let r = 0; r < ny; r++) for (let c = -1; c < nx; c++) rects.push([c * tw + (pattern === 'running-bond' && r % 2 ? tw / 2 : 0), r * th, tw, th]);
  return { rects, pw: nx * tw, pd: ny * th };
}
/** Paint a tile layout: per-tile tone variation, soft bevel, optional speckle / veins / wood grain. */
function drawTiles(g, cw, ch, ppm, L, rnd, o) {
  g.fillStyle = o.joint; g.fillRect(0, 0, cw, ch);
  const j = Math.max(0.6, o.jointW * ppm);
  for (const [rx, ry, rw, rh] of L.rects) {
    const tone = K.shade(o.color, (rnd() - 0.5) * 2 * o.vary), tone2 = o.color3 && rnd() < 0.3 ? K.shade(o.color3, (rnd() - 0.5) * o.vary) : tone;
    const seeds = Array.from({ length: 10 }, () => rnd());
    for (const ox of [0, -L.pw, L.pw]) for (const oy of [0, -L.pd, L.pd]) {
      const x = (rx + ox) * ppm + j / 2, y = (ry + oy) * ppm + j / 2, w = rw * ppm - j, h = rh * ppm - j;
      if (x > cw || y > ch || x + w < 0 || y + h < 0) continue;
      g.save(); g.beginPath();
      if (o.round) { const r = Math.min(w, h) * o.round; g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); } else g.rect(x, y, w, h);
      g.fillStyle = tone2; g.fill(); g.clip();
      if (o.grain) {                                    // wood: streaks along the long side
        const horiz = w >= h;
        for (let i = 0; i < 9; i++) {
          g.strokeStyle = `rgba(${seeds[i] < 0.5 ? '0,0,0' : '255,255,255'},${0.04 + seeds[(i + 3) % 10] * 0.07})`; g.lineWidth = 0.6 + seeds[(i + 5) % 10] * 1.6;
          const q = (i + seeds[i]) / 9;
          g.beginPath();
          if (horiz) { g.moveTo(x, y + q * h); g.bezierCurveTo(x + w * 0.3, y + q * h + 2 * (seeds[i] - 0.5), x + w * 0.7, y + q * h - 2 * (seeds[i] - 0.5), x + w, y + q * h); } else { g.moveTo(x + q * w, y); g.lineTo(x + q * w, y + h); }
          g.stroke();
        }
      }
      if (o.grooves) { g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = 1; for (let q = y + 2; q < y + h; q += Math.max(2.5, h / 9)) { g.beginPath(); g.moveTo(x, q); g.lineTo(x + w, q); g.stroke(); } }
      if (o.veins) {
        for (let i = 0; i < 3; i++) {
          g.strokeStyle = rgba(o.veins, 0.1 + seeds[i] * 0.16); g.lineWidth = 0.6 + seeds[i + 3] * 1.2;
          g.beginPath(); g.moveTo(x + seeds[i] * w, y); g.bezierCurveTo(x + seeds[i + 1] * w, y + h * 0.3, x + seeds[i + 2] * w, y + h * 0.6, x + seeds[i + 4] * w, y + h); g.stroke();
        }
      }
      if (o.cloud) { const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, `rgba(255,255,255,${o.cloud * seeds[0]})`); gr.addColorStop(1, `rgba(0,0,0,${o.cloud * seeds[1]})`); g.fillStyle = gr; g.fillRect(x, y, w, h); }
      if (o.bevel) {
        g.lineWidth = Math.max(1, o.bevel * ppm);
        g.strokeStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y); g.lineTo(x + w, y); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.stroke();
      }
      g.restore();
    }
  }
}
/** Crazy paving: wrapped Voronoi cells with mortar joints, rendered per pixel. */
function drawVoronoi(g, cw, ch, rnd, cells, o) {
  const pts = [], nx = cells, ny = Math.max(2, Math.round(cells * ch / cw));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push([(i + 0.15 + rnd() * 0.7) / nx * cw, (j + 0.15 + rnd() * 0.7) / ny * ch, C(K.shade(o.colors[Math.floor(rnd() * o.colors.length)], (rnd() - 0.5) * 2 * o.vary))]);
  const img = g.createImageData(cw, ch), data = img.data, jc = C(o.joint), cell = cw / nx, jw = o.jointW;
  const srgb = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    let d1 = 1e9, d2 = 1e9, best = null;
    const ci = Math.floor(x / cw * nx), cj = Math.floor(y / ch * ny);
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const ii = ci + di, jj = cj + dj, p = pts[(((jj % ny) + ny) % ny) * nx + (((ii % nx) + nx) % nx)];
      const px = p[0] + Math.floor(ii / nx) * cw, py = p[1] + Math.floor(jj / ny) * ch, dd = Math.hypot(px - x, py - y);
      if (dd < d1) { d2 = d1; d1 = dd; best = p; } else if (dd < d2) d2 = dd;
    }
    const edge = (d2 - d1) / 2, k = (y * cw + x) * 4, n = 0.94 + 0.12 * Math.sin(x * 12.9898 + y * 78.233) * Math.sin(x * 3.7 + y * 1.3);
    const c = edge < jw ? jc : best[2], f = edge < jw ? 1 : clamp(0.82 + (edge - jw) / (cell * 0.12), 0.82, 1) * n;
    data[k] = srgb(c.r * f); data[k + 1] = srgb(c.g * f); data[k + 2] = srgb(c.b * f); data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

const SURFACE_KINDS = ['lawn', 'synthetic-grass', 'deck-wood', 'deck-composite', 'paving-concrete', 'paving-stone', 'porcelain-tile', 'gravel', 'tuff', 'mulch', 'soil', 'sand',
  'stepping-stones', 'concrete', 'asphalt', 'brick', 'terrazzo', 'rubber', 'cobble', 'crazy-paving', 'bark'];
const SURFACE_DEF = {
  lawn: { color: '#5d9440', color2: '#7fae4f', rough: 0.95 }, 'synthetic-grass': { color: '#4f9a3c', color2: '#5fa848', rough: 0.9 },
  'deck-wood': { color: '#a9774a', color2: '#3a2c20', tile: 14, rough: 0.7 }, 'deck-composite': { color: '#7d7068', color2: '#2e2a27', tile: 14.5, rough: 0.75 },
  'paving-concrete': { color: '#b5afa4', color2: '#8a857b', tile: 20, pattern: 'running-bond', rough: 0.9 }, 'paving-stone': { color: '#c9bca4', color2: '#8f8676', tile: 60, pattern: 'random', rough: 0.85 },
  'porcelain-tile': { color: '#cfcac1', color2: '#9a958c', tile: 60, pattern: 'grid', rough: 0.45 }, gravel: { color: '#b9b2a4', color2: '#8c8679', rough: 1 },
  tuff: { color: '#8e3f2c', color2: '#4a2219', rough: 1 }, mulch: { color: '#6e4a30', color2: '#3a2618', rough: 1 }, bark: { color: '#6e4a30', color2: '#3a2618', rough: 1 },
  soil: { color: '#59402e', color2: '#3d2b1f', rough: 1 }, sand: { color: '#dfcda4', color2: '#cdb98c', rough: 1 }, 'stepping-stones': { color: '#bdb5a6', color2: '#5d9440', tile: 45, rough: 0.9 },
  concrete: { color: '#b9b8b3', color2: '#8f8e89', tile: 200, rough: 0.9 }, asphalt: { color: '#4a4b4e', color2: '#333437', rough: 0.95 },
  brick: { color: '#a8563c', color2: '#c9bfae', tile: 20, pattern: 'running-bond', rough: 0.9 }, terrazzo: { color: '#d9d2c4', color2: '#a9a294', tile: 30, pattern: 'grid', rough: 0.4 },
  rubber: { color: '#b8503c', color2: '#7d3528', tile: 50, pattern: 'grid', rough: 0.95 }, cobble: { color: '#9a9690', color2: '#55524d', tile: 10, rough: 0.85 },
  'crazy-paving': { color: '#c7b596', color2: '#8d8474', tile: 45, rough: 0.85 },
};
/** Resolve the look of a ground kind from params (colour, joint colour, tile size in metres, pattern). */
function surfaceOpts(kind, p) {
  const D = SURFACE_DEF[kind] || SURFACE_DEF.lawn;
  const pattern = oneOf(p.pattern, ['grid', 'running-bond', 'herringbone', 'planks', 'random'], D.pattern || 'grid');
  return { kind, color: hexOf(p.color, D.color), color2: hexOf(p.color2, D.color2), tile: num(p.tile, D.tile || 30, 2, 400) / 100, pattern, rough: D.rough, base: oneOf(p.base, ['grass', 'gravel', 'tuff', 'sand'], 'grass') };
}
/**
 * Cached ground texture → { map, pw, pd (metres covered by one repeat), avg (flat colour for edges / 2D) }.
 * The caller scales UVs by 1 / pw, 1 / pd so the pattern keeps its real size whatever the object's size.
 */
function groundTex(o) {
  const key = [o.kind, o.color, o.color2, o.tile, o.pattern].join('|');
  let t = _ground.get(key);
  if (t) return t;
  const rnd = K.rng(K.hashStr(key));
  const kind = o.kind;
  let pw = 2, pd = 2, cw = 512, ch = 512, draw = null, avg = o.color;
  const tiles = (tw, th, pattern, opt) => {
    const L = tileLayout(pattern, tw, th, rnd), ppm = Math.min(1024 / L.pw, 1024 / L.pd, 420);
    pw = L.pw; pd = L.pd; cw = Math.round(L.pw * ppm); ch = Math.round(L.pd * ppm);
    draw = (g) => { drawTiles(g, cw, ch, ppm, L, rnd, { color: o.color, joint: o.color2, vary: 0.08, jointW: 0.004, ...opt }); grain(g, cw, ch, rnd, opt.grainN ?? 5000, opt.grainA ?? 0.07); };
  };
  if (kind === 'lawn' || kind === 'synthetic-grass') {
    const syn = kind === 'synthetic-grass'; pw = pd = 3;
    draw = (g) => {
      g.fillStyle = o.color; g.fillRect(0, 0, cw, ch);
      blotches(g, cw, ch, rnd, syn ? 14 : 70, [hsl(o.color, 0.02, 0, 0.07), hsl(o.color, -0.02, 0.05, -0.07), o.color2, hsl(o.color, -0.05, -0.1, 0.05)], 30, syn ? 70 : 120, syn ? 0.07 : 0.2);
      const cols = [hsl(o.color, 0, 0, 0.09), hsl(o.color, 0.015, 0.05, -0.1), o.color2, hsl(o.color, -0.03, -0.05, 0.14), hsl(o.color, 0, 0.05, -0.16)];
      g.lineCap = 'round';
      for (let i = 0; i < 15000; i++) {
        const x = rnd() * cw, y = rnd() * ch, a = (syn ? -Math.PI / 2 + (rnd() - 0.5) * 0.5 : rnd() * TAU), l = 2 + rnd() * (syn ? 3 : 5);
        g.strokeStyle = rgba(cols[Math.floor(rnd() * cols.length)], syn ? 0.3 : 0.5); g.lineWidth = 0.8 + rnd() * 0.6;
        wrapDraw(cw, ch, x, y, 8, (xx, yy) => { g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx + Math.cos(a) * l, yy + Math.sin(a) * l); g.stroke(); });
      }
    };
  } else if (kind === 'deck-wood' || kind === 'deck-composite') {
    const wood = kind === 'deck-wood';
    tiles(3.6, o.tile, 'planks', { vary: wood ? 0.1 : 0.035, jointW: 0.006, grain: wood, grooves: !wood, bevel: 0.003, grainN: wood ? 2500 : 6000, grainA: 0.05 });
  } else if (kind === 'paving-concrete') {
    const sq = o.pattern === 'grid'; tiles(o.tile, sq ? o.tile : o.tile / 2, o.pattern === 'planks' ? 'running-bond' : o.pattern, { vary: 0.09, jointW: 0.005, bevel: 0.004, color3: hsl(o.color, 0.02, 0.06, -0.06), cloud: 0.06, grainN: 14000, grainA: 0.1 });
  } else if (kind === 'brick') {
    const sq = o.pattern === 'grid'; tiles(o.tile, sq ? o.tile : o.tile / 2, o.pattern === 'planks' ? 'running-bond' : o.pattern, { vary: 0.12, jointW: 0.008, bevel: 0.003, color3: hsl(o.color, -0.02, 0, -0.1), cloud: 0.1, grainN: 12000, grainA: 0.09 });
  } else if (kind === 'paving-stone') {
    const sq = o.pattern === 'grid'; tiles(o.tile, sq ? o.tile : o.tile * 0.6, o.pattern === 'planks' ? 'random' : o.pattern, { vary: 0.07, jointW: 0.008, bevel: 0.004, veins: hsl(o.color, 0, -0.1, -0.2), color3: hsl(o.color, 0.03, -0.05, 0.03), cloud: 0.1, grainN: 9000, grainA: 0.07 });
  } else if (kind === 'porcelain-tile') {
    const sq = o.pattern === 'grid'; tiles(o.tile, sq ? o.tile : o.tile / 2, o.pattern === 'planks' || o.pattern === 'random' ? 'running-bond' : o.pattern, { vary: 0.02, jointW: 0.003, veins: hsl(o.color, 0, 0, -0.14), cloud: 0.05, grainN: 2500, grainA: 0.035 });
  } else if (kind === 'terrazzo') {
    const L = tileLayout('grid', o.tile, o.tile, rnd), ppm = Math.min(1024 / L.pw, 420);
    pw = L.pw; pd = L.pd; cw = ch = Math.round(pw * ppm);
    draw = (g) => {
      g.fillStyle = o.color; g.fillRect(0, 0, cw, ch);
      pebbles(g, cw, ch, rnd, Math.round(cw * ch / 110), ['#8d8a84', '#b9a48c', '#5a5753', '#f1ede4', '#a9765c', '#c9c2b4', '#3c3a38'], 1.2, 5.5, { sides: 5 });
      g.globalAlpha = 0.55; g.fillStyle = o.color; g.fillRect(0, 0, cw, ch); g.globalAlpha = 1;
      pebbles(g, cw, ch, rnd, Math.round(cw * ch / 200), ['#8d8a84', '#b9a48c', '#5a5753', '#f1ede4', '#a9765c', '#3c3a38'], 1.2, 4.5, { sides: 5 });
      g.strokeStyle = rgba(o.color2, 0.9); g.lineWidth = Math.max(1, 0.003 * ppm);
      for (let i = 0; i <= Math.round(pw / o.tile); i++) { const q = i * o.tile * ppm; g.beginPath(); g.moveTo(q, 0); g.lineTo(q, ch); g.moveTo(0, q); g.lineTo(cw, q); g.stroke(); }
    };
  } else if (kind === 'rubber') {
    const L = tileLayout('grid', o.tile, o.tile, rnd), ppm = Math.min(1024 / L.pw, 320);
    pw = L.pw; pd = L.pd; cw = ch = Math.round(pw * ppm);
    draw = (g) => {
      g.fillStyle = o.color; g.fillRect(0, 0, cw, ch);
      pebbles(g, cw, ch, rnd, Math.round(cw * ch / 16), [K.shade(o.color, 0.12), K.shade(o.color, -0.16), o.color, o.color2, '#2a2a2c'], 0.7, 1.7, { sides: 4 });
      g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1.2;
      for (let i = 0; i <= Math.round(pw / o.tile); i++) { const q = i * o.tile * ppm; g.beginPath(); g.moveTo(q, 0); g.lineTo(q, ch); g.moveTo(0, q); g.lineTo(cw, q); g.stroke(); }
    };
  } else if (kind === 'cobble') {
    const s = o.tile, L = tileLayout('running-bond', s, s, rnd), ppm = Math.min(1024 / L.pw, 640);
    pw = L.pw; pd = L.pd; cw = Math.round(pw * ppm); ch = Math.round(pd * ppm);
    draw = (g) => { drawTiles(g, cw, ch, ppm, L, rnd, { color: o.color, joint: o.color2, vary: 0.16, jointW: s * 0.13, round: 0.28, bevel: s * 0.06, cloud: 0.2 }); grain(g, cw, ch, rnd, 9000, 0.1); };
  } else if (kind === 'crazy-paving') {
    pw = pd = o.tile * 6; cw = ch = 512;
    draw = (g) => { drawVoronoi(g, cw, ch, rnd, 6, { colors: [o.color, hsl(o.color, 0.02, -0.05, 0.05), hsl(o.color, -0.02, 0.04, -0.06), hsl(o.color, 0.04, -0.08, -0.02)], joint: o.color2, vary: 0.06, jointW: Math.max(1.5, 0.012 * cw / pw) }); grain(g, cw, ch, rnd, 7000, 0.07); };
  } else if (kind === 'concrete') {
    pw = pd = o.tile; const ppm = Math.min(512 / pw, 300); cw = ch = Math.round(pw * ppm);
    draw = (g) => {
      g.fillStyle = o.color; g.fillRect(0, 0, cw, ch);
      blotches(g, cw, ch, rnd, 40, [K.shade(o.color, 0.1), K.shade(o.color, -0.1), o.color2], 20, 90, 0.16); grain(g, cw, ch, rnd, 16000, 0.09);
      g.strokeStyle = rgba(o.color2, 0.95); g.lineWidth = Math.max(1.5, 0.008 * ppm); g.strokeRect(0, 0, cw, ch);
    };
  } else if (kind === 'asphalt') {
    pw = pd = 1.5;
    draw = (g) => { g.fillStyle = o.color; g.fillRect(0, 0, cw, ch); blotches(g, cw, ch, rnd, 25, [K.shade(o.color, 0.08), o.color2], 30, 110, 0.2); pebbles(g, cw, ch, rnd, 9000, [K.shade(o.color, 0.16), K.shade(o.color, 0.07), o.color2, K.shade(o.color, 0.28)], 0.6, 1.8, { sides: 5 }); };
  } else if (kind === 'sand') {
    pw = pd = 2;
    draw = (g) => {
      g.fillStyle = o.color; g.fillRect(0, 0, cw, ch); blotches(g, cw, ch, rnd, 40, [K.shade(o.color, 0.1), o.color2, K.shade(o.color, -0.08)], 30, 100, 0.2);
      g.strokeStyle = rgba(K.shade(o.color, -0.15), 0.1); g.lineWidth = 3;
      for (let i = 0; i < 16; i++) { const y = (i + 0.5) * ch / 16; g.beginPath(); for (let x = 0; x <= cw; x += 16) g.lineTo(x, y + Math.sin(x / cw * TAU * 3 + i) * 5); g.stroke(); }
      grain(g, cw, ch, rnd, 26000, 0.1, 1.1);
    };
  } else if (kind === 'soil') {
    pw = pd = 1.6;
    draw = (g) => { g.fillStyle = o.color2; g.fillRect(0, 0, cw, ch); pebbles(g, cw, ch, rnd, 5200, [o.color, K.shade(o.color, 0.08), K.shade(o.color, -0.14), o.color2, hsl(o.color, 0.01, -0.05, 0.05)], 2, 8, { sides: 6 }); grain(g, cw, ch, rnd, 9000, 0.1); };
  } else if (kind === 'mulch' || kind === 'bark') {
    pw = pd = 1.2;
    draw = (g) => { g.fillStyle = o.color2; g.fillRect(0, 0, cw, ch); pebbles(g, cw, ch, rnd, 3600, [o.color, K.shade(o.color, 0.14), K.shade(o.color, -0.2), hsl(o.color, 0.02, -0.1, 0.08), hsl(o.color, -0.02, 0.05, -0.08)], 3, 8, { sides: 5, elong: 3.4 }); };
  } else if (kind === 'tuff') {
    pw = pd = 1.2;
    draw = (g) => { g.fillStyle = o.color2; g.fillRect(0, 0, cw, ch); pebbles(g, cw, ch, rnd, 3400, [o.color, K.shade(o.color, 0.12), K.shade(o.color, -0.2), hsl(o.color, 0.02, -0.08, 0.05), hsl(o.color, -0.015, 0.05, -0.1), hsl(o.color, 0.01, -0.25, -0.12)], 3, 9, { sides: 6 }); grain(g, cw, ch, rnd, 4000, 0.1); };
  } else {                                              // gravel (default)
    pw = pd = 1.2;
    draw = (g) => { g.fillStyle = o.color2; g.fillRect(0, 0, cw, ch); pebbles(g, cw, ch, rnd, 3800, [o.color, K.shade(o.color, 0.18), K.shade(o.color, -0.16), hsl(o.color, 0.03, 0.06, 0.02), hsl(o.color, -0.03, -0.04, -0.06), '#e6e1d6', '#8a8780'], 2.5, 8, { sides: 7 }); };
  }
  let map = null;
  if (hasDom) {
    const canvas = newCanvas(cw, ch), g = canvas.getContext('2d', { willReadFrequently: true });
    draw(g);
    const s = newCanvas(1, 1).getContext('2d', { willReadFrequently: true }); s.drawImage(canvas, 0, 0, 1, 1);
    const px = s.getImageData(0, 0, 1, 1).data; avg = '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    map = new THREE.CanvasTexture(canvas);
    map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  }
  t = { map, pw, pd, avg };
  _ground.set(key, t);
  return t;
}
const _groundMats = new Map();
/** Cached textured material for a ground kind (+ its texture info). */
function groundMat(o) {
  const tex = groundTex(o), key = [o.kind, o.color, o.color2, o.tile, o.pattern].join('|');
  let m = _groundMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: tex.map ? '#ffffff' : o.color, map: tex.map, roughness: o.rough ?? 0.9, metalness: 0 });
    if (tex.map && ['gravel', 'tuff', 'mulch', 'bark', 'cobble', 'crazy-paving', 'paving-concrete', 'paving-stone', 'brick', 'deck-wood', 'deck-composite', 'soil'].includes(o.kind)) { m.bumpMap = tex.map; m.bumpScale = o.kind.startsWith('deck') || o.kind.startsWith('paving') || o.kind === 'brick' ? 0.6 : 1.4; }
    m.name = 'ground-' + o.kind;
    _groundMats.set(key, m);
  }
  return { mat: m, ...tex };
}
/** Horizontal textured patch (outline [[x, z]…]) at height y for a ground kind, added to a batch. */
function addGround(b, pts, y, o, holes = []) {
  const G = groundMat(o);
  b.add(G.mat, flatG(pts, y, G.pw, G.pd, holes));
  return G;
}
