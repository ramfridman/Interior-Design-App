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
function paintFoliage(g, hex, rnd, { lo = -0.34, hi = 0.12, ao = 1, sparkle = 0.07 } = {}) {
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
  /** Move everything from another batch into this one, turned by ry and shifted by (dx, dy, dz). */
  merge(other, dx = 0, dy = 0, dz = 0, ry = 0) {
    for (const [m, list] of other.buckets) {
      if (!this.buckets.has(m)) this.buckets.set(m, []);
      for (const g of list) { if (ry) g.rotateY(ry); g.translate(dx, dy, dz); g.boundingBox = null; this.buckets.get(m).push(g); }
    }
    other.buckets.clear();
    return this;
  }
  /** Scale heights so the content spans y ∈ [0, top], and clamp x / z into the w × d footprint. */
  settle(top, w, d) {
    const bb = this.bounds();
    if (bb.isEmpty()) return this;
    const sy = bb.max.y > 1e-5 ? top / bb.max.y : 1;
    for (const list of this.buckets.values()) for (const g of list) {
      const a = g.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) { a[i] = clamp(a[i], -w / 2, w / 2); a[i + 1] = Math.max(0, a[i + 1] * sy); a[i + 2] = clamp(a[i + 2], -d / 2, d / 2); }
      g.boundingBox = null;
    }
    return this;
  }
  /** Clamp x into [x0, x1] and z into [z0, z1] (keeps climbers on their trellis, reeds inside their pond). */
  clampXZ(x0, x1, z0 = -Infinity, z1 = Infinity) {
    for (const list of this.buckets.values()) for (const g of list) { const a = g.attributes.position.array; for (let i = 0; i < a.length; i += 3) { a[i] = clamp(a[i], x0, x1); a[i + 2] = clamp(a[i + 2], z0, z1); } g.boundingBox = null; }
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
    const k = 1 + amp * (Math.sin(ax * 3.3 + s1) * Math.sin(ay * 3.1 + s2) + 0.7 * Math.sin(az * 3.9 + s3) * Math.sin(ax * 2.3 + s2) + 0.4 * Math.sin(ax * 7.1 + s3) * Math.sin(ay * 6.3 + s1) * Math.sin(az * 6.7 + s2));
    const px = (ax * ca - az * sa) * k, pz = (ax * sa + az * ca) * k;
    let py = ay * k;
    if (o.squash && py < 0) py *= o.squash;
    let wy = y + py * ry;
    if (o.floor != null && wy < o.floor) wy = o.floor;
    pos[i * 3] = x + px * rx; pos[i * 3 + 1] = wy; pos[i * 3 + 2] = z + pz * rz;
    nor[i * 3] = px / k; nor[i * 3 + 1] = ay; nor[i * 3 + 2] = pz / k;
  }
  const fc = o.facet ?? 0.45;                         // blend the round normal with each face's own → soft facets
  for (let i = 0; i < n; i += 3) {
    const a = i * 3, ux = pos[a + 3] - pos[a], uy = pos[a + 4] - pos[a + 1], uz = pos[a + 5] - pos[a + 2], vx = pos[a + 6] - pos[a], vy = pos[a + 7] - pos[a + 1], vz = pos[a + 8] - pos[a + 2];
    let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    for (let q = 0; q < 3; q++) { const j = a + q * 3, nx = lerp(nor[j], fx, fc), ny = lerp(nor[j + 1], fy, fc), nz = lerp(nor[j + 2], fz, fc), l = Math.hypot(nx, ny, nz) || 1; nor[j] = nx / l; nor[j + 1] = ny / l; nor[j + 2] = nz / l; }
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
 * Small two-sided leaf “cards” (diamonds) at the given samples [[x, y, z, nx, ny, nz], …] — they break up blob silhouettes.
 * o: { aspect width/length, hang 0..1 (leaves point down), colors: [hex…] }. Normals are “puffy” (the sample's direction).
 */
function cardsG(samples, size, rnd, o = {}) {
  const n = samples.length, pos = new Float32Array(n * 18), col = new Float32Array(n * 18), nrm = new Float32Array(n * 18), aspect = o.aspect ?? 0.45, colors = o.colors || ['#5c8a45'];
  const d = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const [px, py, pz] = samples[i];
    d.set(samples[i][3], samples[i][4], samples[i][5]);
    u.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).addScaledVector(d, 0.6);
    if (o.hang) u.lerp(q.set(d.x * 0.25, -1, d.z * 0.25), o.hang);
    u.normalize();
    v.crossVectors(u, q.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5)).normalize();
    const L = size * (0.7 + rnd() * 0.6) / 2, Wd = L * aspect;
    const A = [px - u.x * L, py - u.y * L, pz - u.z * L], Bp = [px + u.x * L, py + u.y * L, pz + u.z * L];
    const m = -0.15 * L, Lf = [px + u.x * m + v.x * Wd, py + u.y * m + v.y * Wd, pz + u.z * m + v.z * Wd], Rt = [px + u.x * m - v.x * Wd, py + u.y * m - v.y * Wd, pz + u.z * m - v.z * Wd];
    pos.set([...A, ...Lf, ...Bp, ...A, ...Bp, ...Rt], i * 18);
    const cc = C(colors[Math.floor(rnd() * colors.length) % colors.length]), f = 0.82 + rnd() * 0.3 + 0.1 * d.y;
    const ny = Math.max(d.y, -0.2) + 0.25, nl = Math.hypot(d.x, ny, d.z) || 1;
    for (let k2 = 0; k2 < 6; k2++) { const j = i * 18 + k2 * 3; col[j] = cc.r * f; col[j + 1] = cc.g * f; col[j + 2] = cc.b * f; nrm[j] = d.x / nl; nrm[j + 1] = ny / nl; nrm[j + 2] = d.z / nl; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}
/** Leaf cards on an ellipsoid shell (centre c, radii r). o as cardsG + { up: keep to the upper part, shell, spread }. */
function leafCloudG(c, r, n, size, rnd, o = {}) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const cy = clamp(o.up ? rnd() * 1.2 - 0.2 : rnd() * 1.7 - 0.7, -1, 1), a = rnd() * TAU, sr = Math.sqrt(1 - cy * cy), k = (o.shell ?? 0.98) + rnd() * (o.spread ?? 0.28);
    const dx = Math.cos(a) * sr, dz = Math.sin(a) * sr;
    samples.push([c[0] + dx * r[0] * k, c[1] + cy * r[1] * k, c[2] + dz * r[2] * k, dx, cy, dz]);
  }
  return cardsG(samples, size, rnd, o);
}
/** Leaf cards on the top and sides of a box w × h × d standing on y = 0 (trimmed hedges). */
function leafBoxG(w, h, d, n, size, rnd, o = {}) {
  const samples = [], aT = w * d, aF = w * h, aS = d * h, tot = aT + 2 * aF + 2 * aS;
  for (let i = 0; i < n; i++) {
    const r = rnd() * tot, u = rnd() - 0.5, v = rnd();
    if (r < aT) samples.push([u * w, h, (v - 0.5) * d, 0, 1, 0]);
    else if (r < aT + 2 * aF) { const sg = r < aT + aF ? 1 : -1; samples.push([u * w, v * h, sg * d / 2, 0, 0.1, sg]); }
    else { const sg = r < aT + 2 * aF + aS ? 1 : -1; samples.push([sg * w / 2, v * h, u * d, sg, 0.1, 0]); }
  }
  return cardsG(samples, size, rnd, o);
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
const lanceolate = (t) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(clamp(t, 0, 1), 0.7))), 0.8);
const strap = (t) => (t < 0.12 ? 0.55 + t * 3.75 : Math.pow(Math.max(0, 1 - (t - 0.12) / 0.88), 0.55));

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
  let x0 = 0, x1 = 0, z0 = 0, z1 = 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, k = 1 + amp * (Math.sin(a * 2 + ph[0]) + 0.6 * Math.sin(a * 3 + ph[1]) + 0.35 * Math.sin(a * 5 + ph[2]));
    out.push([Math.cos(a) * k, Math.sin(a) * k]); x0 = Math.min(x0, out[i][0]); x1 = Math.max(x1, out[i][0]); z0 = Math.min(z0, out[i][1]); z1 = Math.max(z1, out[i][1]);
  }
  return out.map(([x, z]) => [(x / (x >= 0 ? x1 : -x0)) * rx, (z / (z >= 0 ? z1 : -z0)) * rz]);    // touches the box on all four sides
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
 * 'leaf' soft two-sided foliage · 'frond' faceted two-sided blades · 'flat' faceted (rocks) · 'bark' / 'matte' / 'satin' / 'gloss' smooth with falling roughness.
 */
function vmat(kind = 'matte') {
  let m = _vm.get(kind);
  if (m) return m;
  const def = { leaf: [0.86, false, THREE.DoubleSide], frond: [0.86, true, THREE.DoubleSide], flat: [0.92, true, THREE.FrontSide], bark: [0.95, false, THREE.FrontSide], matte: [0.85, false, THREE.FrontSide],
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
    const c = edge < jw ? jc : best[2], f = edge < jw || o.flat ? 1 : clamp(0.82 + (edge - jw) / (cell * 0.12), 0.82, 1) * n;
    data[k] = srgb(c.r * f); data[k + 1] = srgb(c.g * f); data[k + 2] = srgb(c.b * f); data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

const SURFACE_KINDS = ['lawn', 'synthetic-grass', 'deck-wood', 'deck-composite', 'paving-concrete', 'paving-stone', 'porcelain-tile', 'gravel', 'tuff', 'mulch', 'soil', 'sand',
  'stepping-stones', 'concrete', 'asphalt', 'brick', 'terrazzo', 'rubber', 'cobble', 'crazy-paving', 'bark'];
const SURFACE_DEF = {
  lawn: { color: '#4d8235', color2: '#6f9c45', rough: 0.95 }, 'synthetic-grass': { color: '#43882f', color2: '#52963c', rough: 0.9 },
  'deck-wood': { color: '#a9774a', color2: '#3a2c20', tile: 14, rough: 0.7 }, 'deck-composite': { color: '#7d7068', color2: '#2e2a27', tile: 14.5, rough: 0.75 },
  'paving-concrete': { color: '#a8a297', color2: '#7d786f', tile: 20, pattern: 'running-bond', rough: 0.9 }, 'paving-stone': { color: '#bfb199', color2: '#857c6c', tile: 60, pattern: 'random', rough: 0.85 },
  'porcelain-tile': { color: '#bdb8ae', color2: '#8c877e', tile: 60, pattern: 'grid', rough: 0.45 }, gravel: { color: '#b9b2a4', color2: '#8c8679', rough: 1 },
  tuff: { color: '#7c3626', color2: '#3f1d15', rough: 1 }, mulch: { color: '#6e4a30', color2: '#3a2618', rough: 1 }, bark: { color: '#6e4a30', color2: '#3a2618', rough: 1 },
  soil: { color: '#59402e', color2: '#3d2b1f', rough: 1 }, sand: { color: '#dfcda4', color2: '#cdb98c', rough: 1 }, 'stepping-stones': { color: '#bdb5a6', color2: '#5d9440', tile: 45, rough: 0.9 },
  concrete: { color: '#aaa9a4', color2: '#84837e', tile: 200, rough: 0.9 }, asphalt: { color: '#4a4b4e', color2: '#333437', rough: 0.95 },
  brick: { color: '#96492f', color2: '#b5ab9a', tile: 20, pattern: 'running-bond', rough: 0.9 }, terrazzo: { color: '#d9d2c4', color2: '#a9a294', tile: 30, pattern: 'grid', rough: 0.4 },
  rubber: { color: '#a4452f', color2: '#6f2f22', tile: 50, pattern: 'grid', rough: 0.95 }, cobble: { color: '#9a9690', color2: '#55524d', tile: 10, rough: 0.85 },
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
    const sq = o.pattern === 'grid'; tiles(o.tile, sq ? o.tile : o.tile / 2, o.pattern === 'planks' ? 'running-bond' : o.pattern, { vary: 0.07, jointW: 0.008, bevel: 0.003, color3: hsl(o.color, -0.015, 0, -0.07), cloud: 0.08, grainN: 12000, grainA: 0.09 });
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

// ═════════════════════════════════ 4. 2D plan-symbol helpers (cm) ═════════════════════════════════
const INK = K.INK;
/** Scalloped (cloud-like) closed path that touches the ellipse rx × ry. `rnd` = generator or a pre-drawn array of lobe factors. */
function scallopPath(ctx, cx, cy, rx, ry, lobes, depth, rnd, rot = 0) {
  const ks = Array.isArray(rnd) ? rnd : Array.from({ length: lobes }, () => 1 - depth * (0.7 + (rnd ? rnd() * 0.6 : 0.3)));
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(rot) * rx * ks[0], cy + Math.sin(rot) * ry * ks[0]);
  for (let i = 0; i < lobes; i++) {
    const a = rot + ((i + 0.5) / lobes) * TAU, a1 = rot + ((i + 1) / lobes) * TAU, k1 = ks[(i + 1) % lobes];
    const c = 2 - ((ks[i] + k1) / 2) * Math.cos(Math.PI / lobes);
    ctx.quadraticCurveTo(cx + Math.cos(a) * rx * c, cy + Math.sin(a) * ry * c, cx + Math.cos(a1) * rx * k1, cy + Math.sin(a1) * ry * k1);
  }
  ctx.closePath();
  return ks;
}
function pathPts(ctx, pts, close = true) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (close) ctx.closePath(); }
const dot = (ctx, x, y, r, fill) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = fill; ctx.fill(); };
/**
 * Layered organic canopy: translucent fill (what is underneath stays readable), inner clumps, crisp scalloped outline.
 * o: { accent: colour of bloom / fruit dots, dots: how many, clumps, alpha, lobes }
 */
function canopy2D(ctx, rx, ry, color, rnd, px, o = {}) {
  const r = Math.min(rx, ry), detail = r / px > 9, dark = K.shade(color, -0.45), lobes = o.lobes || Math.round(clamp(8 + r / 22, 9, 18));
  const rot = rnd() * TAU;
  const ks = scallopPath(ctx, 0, 0, rx, ry, lobes, 0.1, rnd, rot);
  ctx.fillStyle = rgba(color, o.alpha ?? 0.34); ctx.fill();
  if (detail) {
    const n = o.clumps ?? 6;
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU + rnd() * 0.5, k = 0.44 + rnd() * 0.14, cr = 0.36 + rnd() * 0.1;
      scallopPath(ctx, Math.cos(a) * rx * k, Math.sin(a) * ry * k, rx * cr, ry * cr, 7, 0.14, rnd, a);
      ctx.fillStyle = rgba(K.shade(color, i % 2 ? 0.18 : -0.12), 0.2); ctx.fill();
      ctx.strokeStyle = rgba(dark, 0.3); ctx.lineWidth = px * 0.8; ctx.stroke();
    }
    if (o.accent) for (let i = 0; i < (o.dots ?? 16); i++) { const a = rnd() * TAU, k = Math.sqrt(rnd()) * 0.86; dot(ctx, Math.cos(a) * rx * k, Math.sin(a) * ry * k, Math.max(1.3 * px, r * (o.dotR ?? 0.05)), rgba(o.accent, 0.85)); }
  }
  scallopPath(ctx, 0, 0, rx, ry, lobes, 0.1, ks, rot);
  ctx.strokeStyle = rgba(dark, 0.9); ctx.lineWidth = px * 1.25; ctx.lineJoin = 'round'; ctx.stroke();
}
/** Trunk dot with thin radiating branch lines. */
function trunk2D(ctx, rx, ry, bark, rnd, px, r = 6, branches = 5) {
  if (Math.min(rx, ry) / px > 12) {
    ctx.strokeStyle = rgba(K.shade(bark, -0.2), 0.5); ctx.lineWidth = px;
    for (let i = 0; i < branches; i++) { const a = (i / branches) * TAU + rnd(), k = 0.4 + rnd() * 0.2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(Math.cos(a + 0.3) * rx * k * 0.5, Math.sin(a + 0.3) * ry * k * 0.5, Math.cos(a) * rx * k, Math.sin(a) * ry * k); ctx.stroke(); }
  }
  K.fillCircle(ctx, 0, 0, Math.max(1.8 * px, r), bark, INK, px);
}
/** A pointed leaf / frond shape from (0,0) towards angle a. */
function leaf2D(ctx, a, len, wid, fill, stroke, px, rib = true) {
  ctx.save(); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.45, -wid, len, 0); ctx.quadraticCurveTo(len * 0.45, wid, 0, 0); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  ctx.strokeStyle = stroke; ctx.lineWidth = px; ctx.stroke();
  if (rib) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len * 0.95, 0); ctx.lineWidth = px * 0.7; ctx.stroke(); }
  ctx.restore();
}
/** Radiating fronds / leaves filling the ellipse rx × ry. */
function fronds2D(ctx, rx, ry, n, color, rnd, px, widK = 0.16) {
  ctx.save(); ctx.scale(1, ry / rx);
  const dark = rgba(K.shade(color, -0.45), 0.85);
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU + rnd() * 0.15, len = rx * (i % 2 ? 0.8 + rnd() * 0.12 : 1); leaf2D(ctx, a, len, len * widK, rgba(K.shade(color, i % 2 ? 0.1 : -0.08), 0.42), dark, px, rx / px > 14); }
  ctx.restore();
}

const _pat = new Map();
/**
 * Zoom-aware repeating fill: `draw(g, pw, ph, lw)` paints one period (in cm units) on a small canvas whose resolution
 * follows the current zoom; returns a CanvasPattern anchored at (ox, oy), or `flat` when the period would be sub-pixel noise.
 */
function patternFill(ctx, key, pw, ph, px, flat, draw, ox = 0, oy = 0) {
  if (!hasDom || typeof DOMMatrix === 'undefined' || Math.min(pw, ph) / px < 5) return flat;
  let s = Math.pow(2, Math.round(Math.log2(1 / px)));
  s = Math.min(s, 512 / Math.max(pw, ph), 8); s = Math.max(s, 12 / Math.min(pw, ph));
  const k = key + '|' + s.toFixed(4);
  let c = _pat.get(k);
  if (!c) {
    if (_pat.size > 160) _pat.clear();
    c = newCanvas(pw * s, ph * s);
    const g = c.getContext('2d');
    g.scale(c.width / pw, c.height / ph);
    g.fillStyle = flat; g.fillRect(0, 0, pw, ph);
    draw(g, pw, ph, 1 / s);
    _pat.set(k, c);
  }
  const pat = ctx.createPattern(c, 'repeat');
  if (!pat) return flat;
  pat.setTransform(new DOMMatrix().translate(ox, oy).scale(pw / c.width, ph / c.height));
  return pat;
}
/** Plan fill for a ground kind (see SURFACE_KINDS): planks lines, paver joints, gravel stipple, grass ticks… */
function groundFill2D(ctx, o, px, ox, oy) {
  const kind = o.kind, base = K.tint(o.color, ['lawn', 'synthetic-grass'].includes(kind) ? 0.52 : ['soil', 'mulch', 'bark', 'tuff', 'asphalt'].includes(kind) ? 0.42 : 0.3);
  const ink = rgba(K.shade(o.color, -0.5), 0.5), key = ['g2', kind, o.color, o.color2, o.tile, o.pattern].join('|');
  const rnd = K.rng(K.hashStr(key));
  const stipple = (g, pw, ph, lw, n, r0, r1, cols) => { for (let i = 0; i < n; i++) { const x = rnd() * pw, y = rnd() * ph, r = lerp(r0, r1, rnd()); g.fillStyle = cols[i % cols.length]; for (const dx of [0, pw, -pw]) for (const dy of [0, ph, -ph]) { if (x + dx < -r || x + dx > pw + r || y + dy < -r || y + dy > ph + r) continue; g.beginPath(); g.arc(x + dx, y + dy, Math.max(r, lw * 0.7), 0, TAU); g.fill(); } } };
  const rectsOf = (pattern, tw, th) => tileLayout(pattern, tw / 100, th / 100, rnd);
  const joints = (pattern, tw, th, col = ink, vary = 0.05) => {
    const L = rectsOf(pattern, tw, th), pw = L.pw * 100, ph = L.pd * 100;
    return patternFill(ctx, key, pw, ph, px, base, (g, _w, _h, lw) => {
      for (const [x, y, w, h] of L.rects) for (const dx of [0, pw, -pw]) for (const dy of [0, ph, -ph]) {
        const X = x * 100 + dx, Y = y * 100 + dy, W = w * 100, H = h * 100;
        if (X > pw || Y > ph || X + W < 0 || Y + H < 0) continue;
        g.fillStyle = K.shade(base, (((Math.abs(Math.round(x * 131 + y * 71))) % 7) / 7 - 0.5) * vary * 2); g.fillRect(X, Y, W, H);
        g.strokeStyle = col; g.lineWidth = lw; g.strokeRect(X, Y, W, H);
      }
    }, ox, oy);
  };
  const t = o.tile * 100;
  switch (kind) {
    case 'lawn': case 'synthetic-grass':
      return patternFill(ctx, key, 120, 120, px, base, (g, pw, ph, lw) => {
        g.lineWidth = lw; g.lineCap = 'round';
        for (let i = 0; i < 26; i++) {
          const x = rnd() * pw, y = rnd() * ph, l = 4 + rnd() * 4;
          g.strokeStyle = rgba(K.shade(o.color, -0.1), kind === 'lawn' ? 0.45 : 0.25);
          g.beginPath(); g.moveTo(x - l * 0.35, y); g.lineTo(x - l * 0.5, y - l * 0.8); g.moveTo(x, y); g.lineTo(x, y - l); g.moveTo(x + l * 0.35, y); g.lineTo(x + l * 0.5, y - l * 0.8); g.stroke();
        }
      }, ox, oy);
    case 'deck-wood': case 'deck-composite': return joints('planks', 360, t, ink, kind === 'deck-wood' ? 0.07 : 0.02);
    case 'paving-concrete': case 'brick': return joints(o.pattern === 'planks' ? 'running-bond' : o.pattern, t, o.pattern === 'grid' ? t : t / 2, ink, 0.08);
    case 'paving-stone': return joints(o.pattern === 'planks' ? 'random' : o.pattern, t, o.pattern === 'grid' ? t : t * 0.6, ink, 0.06);
    case 'porcelain-tile': return joints(['planks', 'random'].includes(o.pattern) ? 'running-bond' : o.pattern, t, o.pattern === 'grid' ? t : t / 2, rgba(K.shade(o.color, -0.4), 0.4), 0.02);
    case 'terrazzo': case 'rubber': case 'concrete':
      return patternFill(ctx, key, t * (kind === 'concrete' ? 1 : 2), t * (kind === 'concrete' ? 1 : 2), px, base, (g, pw, ph, lw) => {
        stipple(g, pw, ph, lw, kind === 'concrete' ? 60 : 90, 0.5, kind === 'terrazzo' ? 2 : 1, [rgba(K.shade(o.color, -0.45), 0.4), rgba(K.shade(o.color, -0.2), 0.4), rgba('#a9765c', kind === 'terrazzo' ? 0.5 : 0)]);
        g.strokeStyle = ink; g.lineWidth = lw; for (let q = 0; q <= pw + 1e-6; q += t) { g.beginPath(); g.moveTo(q, 0); g.lineTo(q, ph); g.moveTo(0, q); g.lineTo(pw, q); g.stroke(); }
      }, ox, oy);
    case 'cobble': return patternFill(ctx, key, t * 4, t * 4, px, base, (g, pw, ph, lw) => {
      g.strokeStyle = ink; g.lineWidth = lw;
      for (let r = 0; r < 4; r++) for (let c = -1; c < 4; c++) { g.fillStyle = K.shade(base, (rnd() - 0.5) * 0.16); K.rr(g, (c + 0.5 + (r % 2) * 0.5) * t, (r + 0.5) * t, t * 0.86, t * 0.86, t * 0.25); g.fill(); g.stroke(); }
    }, ox, oy);
    case 'crazy-paving': {
      const n = 4, pw = t * n;
      return patternFill(ctx, key, pw, pw, px, K.tint(o.color2, 0.3), (g, _w, _h, lw) => {
        const P = []; for (let j = 0; j <= n; j++) { P.push([]); for (let i = 0; i <= n; i++) P[j].push([(rnd() - 0.5) * t * 0.5, (rnd() - 0.5) * t * 0.5]); }
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { P[j][n] = P[j][0]; P[n][i] = P[0][i]; }
        P[n][n] = P[0][0];
        g.strokeStyle = ink; g.lineWidth = lw;
        for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) {
          const q = (a, bq) => { const v = P[((bq % n) + n) % n][((a % n) + n) % n]; return [a * t + v[0], bq * t + v[1]]; };
          const cs = [q(i, j), q(i + 1, j), q(i + 1, j + 1), q(i, j + 1)], cx = (cs[0][0] + cs[2][0]) / 2, cy = (cs[0][1] + cs[2][1]) / 2;
          g.beginPath(); cs.forEach(([x, y], m) => { const X = cx + (x - cx) * 0.9, Y = cy + (y - cy) * 0.9; m ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.closePath();
          g.fillStyle = K.shade(base, ((((i + n) * 7 + (j + n) * 13) % 5) / 5 - 0.5) * 0.14); g.fill(); g.stroke();
        }
      }, ox, oy);
    }
    case 'sand': return patternFill(ctx, key, 80, 80, px, base, (g, pw, ph, lw) => stipple(g, pw, ph, lw, 70, 0.3, 0.6, [rgba(K.shade(o.color, -0.4), 0.45)]), ox, oy);
    case 'asphalt': return patternFill(ctx, key, 80, 80, px, base, (g, pw, ph, lw) => stipple(g, pw, ph, lw, 90, 0.3, 0.8, [rgba('#111111', 0.3), rgba('#ffffff', 0.25)]), ox, oy);
    case 'soil': return patternFill(ctx, key, 80, 80, px, base, (g, pw, ph, lw) => stipple(g, pw, ph, lw, 60, 0.5, 1.6, [rgba(K.shade(o.color, -0.4), 0.4), rgba(K.shade(o.color, 0.2), 0.35)]), ox, oy);
    case 'mulch': case 'bark': return patternFill(ctx, key, 80, 80, px, base, (g, pw, ph, lw) => {
      g.lineWidth = Math.max(lw, 1.3); g.lineCap = 'round';
      for (let i = 0; i < 70; i++) { const x = rnd() * pw, y = rnd() * ph, a = rnd() * TAU, l = 2 + rnd() * 3; g.strokeStyle = rgba(K.shade(o.color, (rnd() - 0.6) * 0.5), 0.6); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    }, ox, oy);
    default: return patternFill(ctx, key, 80, 80, px, base, (g, pw, ph, lw) => {    // gravel, tuff
      for (let i = 0; i < 110; i++) { const x = rnd() * pw, y = rnd() * ph, r = 0.9 + rnd() * 1.5; g.fillStyle = rgba(K.shade(o.color, (rnd() - 0.5) * 0.4), 0.75); g.strokeStyle = rgba(K.shade(o.color, -0.5), 0.45); g.lineWidth = lw * 0.8; g.beginPath(); g.ellipse(x, y, r * 1.25, r, rnd() * 3, 0, TAU); g.fill(); g.stroke(); }
    }, ox, oy);
  }
}

// ═════════════════════════════════ 5. trees ═════════════════════════════════
const ENV = {
  round: (t) => Math.pow(Math.max(0, 1 - (2 * t - 1) ** 2), 0.42),
  oval: (t) => Math.pow(Math.max(0, 1 - (2 * t - 1) ** 2), 0.3),
  umbrella: (t) => (t < 0.3 ? lerp(0.7, 1, t / 0.3) : Math.sqrt(Math.max(0, 1 - ((t - 0.3) / 0.7) ** 2))),
  flat: (t) => (t < 0.5 ? lerp(0.45, 1, Math.pow(t / 0.5, 0.7)) : Math.pow(Math.max(0, 1 - ((t - 0.5) / 0.5) ** 3), 0.5)),
  vase: (t) => (t < 0.62 ? lerp(0.3, 1, Math.pow(t / 0.62, 0.8)) : Math.sqrt(Math.max(0, 1 - ((t - 0.62) / 0.38) ** 2))),
};
/**
 * Species table. f foliage tones · bark · tr trunk radius (m, for a 4 m tree) · clear = share of the height that is bare trunk ·
 * shape crown envelope · k clusters · nb blobs per cluster · bs blob size (share of the crown radius) · gnarl trunk fluting ·
 * fork height (share of the bare trunk) · leaf cards { n per blob, s size m, a aspect, c colours, hang } · bloom · fruit · kind = special builder.
 */
const TREES = {
  olive: { f: ['#7f9368', '#93a57f', '#6b7f58'], bark: '#6d6052', tr: 0.19, clear: 0.36, shape: 'round', k: 9, nb: 3, bs: 0.3, gnarl: 0.24, fork: 0.7, leaf: { n: 30, s: 0.1, a: 0.25, c: ['#a9b698', '#8c9c7c', '#c2cbb3'] }, fruit: { c: '#3b3442', r: 0.02, n: 40 } },
  lemon: { f: ['#3f7a35', '#4c8a3e', '#33682c'], bark: '#6f6048', tr: 0.075, clear: 0.27, shape: 'round', k: 10, nb: 3, bs: 0.42, leaf: { n: 9, s: 0.09, a: 0.5, c: ['#5a9a48', '#4c8a3e'] }, fruit: { c: '#f3d63a', r: 0.05, n: 30, el: 1.25, def: true } },
  orange: { f: ['#2f6b2e', '#3c7a38', '#25551f'], bark: '#6a5a45', tr: 0.08, clear: 0.27, shape: 'round', k: 10, nb: 3, bs: 0.42, leaf: { n: 9, s: 0.09, a: 0.5, c: ['#4a8a42', '#3c7a38'] }, fruit: { c: '#f28c1e', r: 0.055, n: 30, def: true } },
  pomegranate: { f: ['#5d8f3a', '#73a046', '#4b7a30'], bark: '#8c7862', tr: 0.065, clear: 0.3, shape: 'vase', k: 8, nb: 3, bs: 0.33, fork: 0.12, limbs: 5, leaf: { n: 18, s: 0.07, a: 0.3, c: ['#86b04e', '#b0623a', '#6f9a40'] }, bloom: { c: ['#e8502a'], dots: 14 }, fruit: { c: '#b5282d', r: 0.062, n: 16, def: true } },
  fig: { f: ['#4f8a3a', '#5f9a45', '#3f7630'], bark: '#a59c8e', tr: 0.12, clear: 0.2, shape: 'umbrella', k: 8, nb: 3, bs: 0.42, fork: 0.45, leaf: { n: 16, s: 0.26, a: 0.8, c: ['#6aa54a', '#588f3e'] }, fruit: { c: '#5a3a5c', r: 0.028, n: 20 } },
  'date-palm': { kind: 'palm', f: ['#6f8f5a', '#7f9c64', '#5d7d4e'], bark: '#7d6c56', fruit: { c: '#c9782c' } },
  'washingtonia-palm': { kind: 'palm', fan: true, f: ['#5f8a48', '#6c9a50', '#4f7a3e'], bark: '#8c8273' },
  ficus: { f: ['#2d5f2a', '#386b30', '#244f23'], bark: '#9c968a', tr: 0.2, clear: 0.36, shape: 'umbrella', k: 12, nb: 3, bs: 0.42, gnarl: 0.12, leaf: { n: 8, s: 0.08, a: 0.5, c: ['#3f7a36', '#2f6a2c'] } },
  jacaranda: { f: ['#6b9650', '#7ea55e'], bark: '#70675a', tr: 0.11, clear: 0.4, shape: 'vase', k: 10, nb: 3, bs: 0.33, leaf: { n: 22, s: 0.12, a: 0.35, c: ['#8fb86a', '#7ea55e'] }, bloom: { c: ['#8d72d8', '#a188e8', '#7a5fc8'], cover: 0.72 } },
  poinciana: { f: ['#4f8f3a', '#62a046'], bark: '#8c8274', tr: 0.14, clear: 0.5, shape: 'flat', k: 11, nb: 3, bs: 0.34, leaf: { n: 18, s: 0.12, a: 0.35, c: ['#74b050', '#62a046'] }, bloom: { c: ['#e23a1c', '#f05a24', '#d42a18'], caps: 0.8 } },
  cypress: { kind: 'column', f: ['#2f4f33', '#3a5c3b', '#263f2a'], bark: '#5a4a3c' },
  carob: { f: ['#34582c', '#41672f', '#2a4a26'], bark: '#5c4c3e', tr: 0.17, clear: 0.28, shape: 'umbrella', k: 12, nb: 3, bs: 0.42, gnarl: 0.15, leaf: { n: 8, s: 0.09, a: 0.7, c: ['#4a7436', '#3a6430'] }, fruit: { c: '#4a3020', r: 0.02, n: 22, pods: true } },
  mango: { f: ['#2f5a2a', '#3d6b30', '#254a22'], bark: '#5f5245', tr: 0.14, clear: 0.3, shape: 'round', k: 11, nb: 3, bs: 0.42, leaf: { n: 14, s: 0.18, a: 0.25, c: ['#4a7a36', '#9a5a3c', '#b06a40', '#3d6b30'], hang: 0.5 }, fruit: { c: '#e8a03a', r: 0.065, n: 14, el: 1.4 } },
  avocado: { f: ['#4a7a34', '#5a8a3d', '#3a672c'], bark: '#6a5c4c', tr: 0.11, clear: 0.28, shape: 'oval', k: 10, nb: 3, bs: 0.37, leader: true, leaf: { n: 12, s: 0.14, a: 0.45, c: ['#6a9a48', '#5a8a3d'] }, fruit: { c: '#2f4a26', r: 0.045, n: 12, el: 1.45 } },
  almond: { f: ['#5f8a45', '#6f9a52'], bark: '#4f4238', tr: 0.09, clear: 0.33, shape: 'vase', k: 10, nb: 3, bs: 0.27, leaf: { n: 34, s: 0.1, a: 0.7, c: ['#7aa858', '#6f9a52'] }, bloom: { c: ['#f7e3ea', '#f1cfdc', '#fdf6f8'], cover: 0.82 }, fruit: { c: '#9aa870', r: 0.018, n: 24, el: 1.3 } },
  'bougainvillea-tree': { f: ['#4a7a38', '#5a8a42'], bark: '#7a6a58', tr: 0.08, clear: 0.42, shape: 'round', k: 9, nb: 3, bs: 0.4, gnarl: 0.2, leaf: { n: 24, s: 0.09, a: 0.7, c: ['#5a8a42', '#6a9a4c'] }, bloom: { c: ['#c8287f', '#d6409a', '#b81f70'], cover: 0.8 } },
  plumeria: { kind: 'plumeria', f: ['#4f8a3a', '#5c9644', '#437a32'], bark: '#9a958a', bloom: { c: ['#fbf7ea'] } },
  moringa: { f: ['#6f9a4a', '#82aa5a'], bark: '#b5aa98', tr: 0.07, clear: 0.42, shape: 'vase', k: 9, nb: 2, bs: 0.24, leaf: { n: 46, s: 0.06, a: 0.6, c: ['#8fba62', '#7aa850', '#a3c878'] }, fruit: { c: '#7a8a4a', r: 0.012, n: 16, pods: true } },
  banana: { kind: 'banana', f: ['#5f9a3a', '#6fa844', '#4f8a32'], bark: '#8a9248', fruit: { c: '#d9c945' } },
  oak: { f: ['#4a6b35', '#587a3e', '#3b5a2c'], bark: '#5a4a3c', tr: 0.2, clear: 0.3, shape: 'round', k: 12, nb: 3, bs: 0.4, gnarl: 0.1, leaf: { n: 10, s: 0.09, a: 0.6, c: ['#6a8a48', '#587a3e'] }, fruit: { c: '#9a7a4a', r: 0.012, n: 24, el: 1.4 } },
  eucalyptus: { f: ['#6b8a68', '#7c9a78', '#5a7a5c'], bark: '#cfc7b6', bark2: '#a08c74', tr: 0.13, clear: 0.45, shape: 'oval', leader: true, k: 10, nb: 3, bs: 0.3, leaf: { n: 30, s: 0.13, a: 0.16, c: ['#8faa8a', '#9db898', '#7c9a78'], hang: 0.8 } },
  mulberry: { f: ['#4f8a34', '#5c9a3d', '#3f752b'], bark: '#6a5a48', tr: 0.13, clear: 0.3, shape: 'umbrella', k: 11, nb: 3, bs: 0.42, leaf: { n: 10, s: 0.14, a: 0.8, c: ['#6aa844', '#5c9a3d'] }, fruit: { c: '#3a1f3a', r: 0.015, n: 30, el: 1.5 } },
  guava: { f: ['#5a8a45', '#6a9a50', '#4a7838'], bark: '#b89474', bark2: '#8a6a50', tr: 0.07, clear: 0.32, shape: 'round', k: 8, nb: 3, bs: 0.34, leaf: { n: 16, s: 0.11, a: 0.5, c: ['#7aa858', '#6a9a50'] }, fruit: { c: '#c9d46a', r: 0.035, n: 14 } },
  loquat: { f: ['#3d6b33', '#4c7a3a', '#2f5829'], bark: '#5f5044', tr: 0.08, clear: 0.3, shape: 'round', k: 9, nb: 3, bs: 0.42, leaf: { n: 18, s: 0.2, a: 0.3, c: ['#5a8a45', '#8a9a6a', '#4c7a3a'] }, fruit: { c: '#f0b030', r: 0.032, n: 36 } },
  generic: { f: ['#4f7f3c', '#5f8f48', '#40702f'], bark: '#6a5a4a', tr: 0.11, clear: 0.33, shape: 'round', k: 10, nb: 3, bs: 0.4, leaf: { n: 12, s: 0.1, a: 0.5, c: ['#6a9a50', '#5f8f48'] } },
};
/** Per-vertex mottled bark (call on the indexed tube, before it goes into a batch). */
function paintBark(g, bark, rnd, y1 = 1, bark2) {
  const a = colorAttr(g).array, p = g.attributes.position, c0 = C(K.shade(bark, -0.3)), c1 = C(bark), c2 = C(bark2 || K.shade(bark, -0.12));
  for (let i = 0; i < p.count; i++) {
    const t = clamp(p.getY(i) / Math.max(1e-6, y1), 0, 1), m = rnd() * (bark2 ? 0.8 : 0.5), k = 0.55 + 0.45 * t;
    a[i * 3] = lerp(lerp(c0.r, c1.r, k), c2.r, m); a[i * 3 + 1] = lerp(lerp(c0.g, c1.g, k), c2.g, m); a[i * 3 + 2] = lerp(lerp(c0.b, c1.b, k), c2.b, m);
  }
  return g;
}
/** Resolve species colours with the common params: color → foliage, color2 → bloom / fruit, color3 → bark. */
function treeLook(S, P) {
  const f = P.color ? [P.color, K.shade(P.color, 0.1), K.shade(P.color, -0.12)] : S.f;
  const bloom = S.bloom ? { ...S.bloom, c: P.color2 ? [P.color2, K.shade(P.color2, 0.14), K.shade(P.color2, -0.1)] : S.bloom.c } : null;
  const fruit = S.fruit ? { ...S.fruit, c: P.color2 && !S.bloom ? P.color2 : S.fruit.c } : null;
  return { f, bloom, fruit, bark: P.color3 || S.bark };
}

/** Generic broad-leaf tree: trunk → limbs → clustered foliage blobs + leaf cards (+ bloom, fruit). */
function broadleaf(b, S, W, D, H, rnd, o) {
  const leafM = vmat('leaf'), barkM = vmat('bark'), young = o.young, look = o.look;
  const rx = W / 2, rz = D / 2, clear = clamp(S.clear * (young ? 1.25 : 1), 0.05, 0.75), cb = H * clear, CH = H - cb;
  const tr = Math.max(0.012, S.tr * Math.pow(H / 4, 0.8) * (young ? 0.5 : 1));
  const env = ENV[S.shape] || ENV.round, bs = S.bs * (young ? 0.9 : 1), nK = Math.max(4, Math.round(S.k * (young ? 0.65 : 1)));
  const hr = bs * Math.min(rx, rz), vr = clamp(bs * CH * 0.6, hr * 0.6, hr * 1.5);
  const world = (q) => [q[0] * rx, cb + q[1] * CH, q[2] * rz];
  // cluster centres spread over the crown shell (best-candidate sampling)
  const cl = [[0.04, S.shape === 'flat' ? 0.68 : 0.8, -0.03]];
  while (cl.length < nK) {
    let best = null, bd = -1;
    for (let c = 0; c < 10; c++) {
      const t = 0.16 + 0.68 * rnd(), a = rnd() * TAU, R = env(t) * (cl.length % 5 === 4 ? 0.28 : 0.58 + 0.1 * rnd());
      const q = [Math.cos(a) * R, t, Math.sin(a) * R];
      let md = 9; for (const e of cl) md = Math.min(md, Math.hypot(q[0] - e[0], (q[1] - e[1]) * 1.7, q[2] - e[2]));
      if (md > bd) { bd = md; best = q; }
    }
    cl.push(best);
  }
  // trunk
  const forkY = Math.max(0.04 * H, cb * (S.fork ?? 0.82)), g0 = S.gnarl || 0;
  const fork = [(rnd() - 0.5) * 0.08 * W * (0.5 + g0 * 3), forkY, (rnd() - 0.5) * 0.08 * D * (0.5 + g0 * 3)];
  const ctrl = [(rnd() - 0.5) * tr * (1.5 + g0 * 8), forkY * 0.5, (rnd() - 0.5) * tr * (1.5 + g0 * 8)];
  const tp = bez([0, 0, 0], ctrl, fork, 6);
  const top = S.leader ? [fork[0] * 0.5, cb + CH * 0.8, fork[2] * 0.5] : null;
  const tR = tp.map((_, i) => { const t = i / 6; return tr * (1 + 0.5 * (1 - t) ** 3) * lerp(1, 0.74, t); });
  if (top) { tp.push([lerp(fork[0], top[0], 0.5), lerp(forkY, top[1], 0.5), lerp(fork[2], top[2], 0.5)], top); tR.push(tr * 0.5, tr * 0.14); }
  b.add(barkM, paintBark(tubeG(tp, tR, 9, { flute: g0, lobes: 5, spin: 0.55 }), look.bark, rnd, forkY, S.bark2));
  // limbs: a few primaries from the fork, the other clusters branch off the nearest primary
  const order = cl.map((_, i) => i).sort((i, j) => Math.atan2(cl[i][2], cl[i][0]) - Math.atan2(cl[j][2], cl[j][0]));
  const nP = Math.min(S.limbs || 4, nK), prim = new Map();
  const limbCol = K.shade(look.bark, -0.06);
  for (let i = 0; i < nP; i++) {
    const ci = order[Math.floor((i + 0.5) * nK / nP)], c = world(cl[ci]);
    const s = top ? [lerp(fork[0], top[0], 0.3), clamp(c[1] - 0.3 * CH, forkY, top[1]), lerp(fork[2], top[2], 0.3)] : fork;
    const pts = bez(s, [lerp(s[0], c[0], 0.3), lerp(s[1], c[1], 0.8), lerp(s[2], c[2], 0.3)], c, 5);
    prim.set(ci, pts);
    b.add(barkM, paintBark(tubeG(pts, taper(tr * (top ? 0.3 : 0.52), tr * 0.13, 5), 6, { flute: g0 * 0.6, lobes: 4 }), limbCol, rnd, 0, S.bark2));
  }
  for (let i = 0; i < nK; i++) {
    if (prim.has(i)) continue;
    const c = world(cl[i]);
    let s = null, bd = 1e9;
    for (const pts of prim.values()) { const m = pts[2], dd = Math.hypot(m[0] - c[0], m[1] - c[1], m[2] - c[2]); if (dd < bd) { bd = dd; s = m; } }
    b.add(barkM, paintBark(tubeG(bez(s, [lerp(s[0], c[0], 0.4), lerp(s[1], c[1], 0.8), lerp(s[2], c[2], 0.4)], c, 4), taper(tr * 0.3, tr * 0.09, 4), 5), limbCol, rnd, 0, S.bark2));
  }
  // foliage
  const blobs = [], bloom = look.bloom, sizeK = Math.sqrt(clamp(H / 4, 0.5, 2.2));
  cl.forEach((q) => {
    const c = world(q);
    for (let j = 0; j < S.nb; j++) {
      const k = j === 0 ? 1 : 0.62 + rnd() * 0.3, a = rnd() * TAU, off = j === 0 ? 0 : 0.78;
      const x = c[0] + Math.cos(a) * off * bs * rx, z = c[2] + Math.sin(a) * off * bs * rz, y = c[1] + (j === 0 ? 0 : (rnd() - 0.4) * vr * 0.9);
      const tt = (y - cb) / CH, isBloom = !!(bloom && bloom.cover && rnd() < bloom.cover);
      const col = isBloom ? bloom.c[Math.floor(rnd() * bloom.c.length)] : look.f[Math.floor(rnd() * look.f.length)];
      const bl = { x, y, z, bx: bs * rx * k, by: vr * k, bz: bs * rz * k, isBloom };
      b.add(leafM, paintFoliage(blobG(bl.bx, bl.by, bl.bz, x, y, z, rnd, { amp: j === 0 ? 0.17 : 0.2, detail: j === 0 ? 2 : 1 }), col, rnd, { ao: lerp(0.8, 1.06, clamp(tt, 0, 1)), lo: isBloom ? -0.2 : -0.34 }));
      blobs.push(bl);
      if (bloom && bloom.caps && tt > 0.42 && rnd() < bloom.caps) {            // flowers carried on top of the foliage (poinciana)
        const bc = bloom.c[Math.floor(rnd() * bloom.c.length)];
        b.add(leafM, paintFoliage(blobG(bl.bx * 0.86, bl.by * 0.42, bl.bz * 0.86, x, y + bl.by * 0.66, z, rnd, { amp: 0.25 }), bc, rnd, { lo: -0.15 }));
        b.add(leafM, leafCloudG([x, y + bl.by * 0.7, z], [bl.bx, bl.by * 0.5, bl.bz], 14, 0.14 * sizeK, rnd, { aspect: 0.7, colors: [bc, K.shade(bc, 0.2)], up: true }));
      }
      if (S.leaf) {
        const colors = isBloom ? [K.shade(col, 0.15), col, K.shade(col, 0.3)] : (o.P.color ? [K.shade(o.P.color, 0.2), o.P.color] : S.leaf.c);
        b.add(leafM, leafCloudG([x, y, z], [bl.bx, bl.by, bl.bz], Math.round(S.leaf.n * (young ? 0.8 : 1) * (j === 0 ? 1.3 : 0.8)), S.leaf.s * sizeK * 1.45, rnd, { aspect: S.leaf.a, hang: S.leaf.hang, colors }));
      }
    }
  });
  const onBlob = (lowBias) => { const bl = blobs[Math.floor(rnd() * blobs.length)], a = rnd() * TAU, dy = lowBias ? -0.55 + rnd() * 0.9 : rnd() * 0.9, sr = Math.sqrt(1 - dy * dy); return [bl.x + Math.cos(a) * sr * bl.bx * 1.05, bl.y + dy * bl.by * 1.05, bl.z + Math.sin(a) * sr * bl.bz * 1.05]; };
  const areaK = clamp(Math.sqrt(W * D) / 3, 0.5, 2) * (young ? 0.6 : 1);
  if (bloom && bloom.dots) for (let i = 0; i < bloom.dots * areaK; i++) { const q = onBlob(false); b.add(leafM, paintFoliage(blobG(0.045 * sizeK, 0.04 * sizeK, 0.045 * sizeK, q[0], q[1], q[2], rnd, { detail: 0, amp: 0.1 }), bloom.c[0], rnd, { lo: -0.1 })); }
  if (o.fruit && look.fruit) {
    const F = look.fruit, fm = vmat('satin');
    for (let i = 0; i < Math.round(F.n * areaK); i++) {
      const q = onBlob(true), r = F.r * (0.85 + rnd() * 0.3) * sizeK;
      if (F.pods) b.add(fm, placed(boxG(r * 0.6, r * 9, r * 1.6, 0, -r * 4.5, 0), q[0], q[1], q[2], rnd() * TAU), K.shade(F.c, (rnd() - 0.5) * 0.2));
      else b.add(fm, blobG(r, r * (F.el || 1), r, q[0], q[1] - r * 0.3, q[2], rnd, { detail: 0, amp: 0.04, facet: 0 }), K.shade(F.c, (rnd() - 0.5) * 0.16));
    }
  }
}

/** Columnar conifer (Italian cypress): a flame of stacked, vertically stretched blobs. */
function columnTree(b, S, W, D, H, rnd, o) {
  const leafM = vmat('leaf'), rx = W / 2, rz = D / 2, n = clamp(Math.round(H / 0.42), 6, 16), y0 = H * 0.05;
  b.add(vmat('bark'), paintBark(tubeG([[0, 0, 0], [0, y0 * 1.6, 0]], [Math.min(rx, rz) * 0.16, Math.min(rx, rz) * 0.12], 7), o.look.bark, rnd, y0));
  const prof = (t) => (t < 0.18 ? lerp(0.62, 1, t / 0.18) : 1 - 0.95 * Math.pow((t - 0.18) / 0.82, o.young ? 1.3 : 1.9));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), y = lerp(y0 + H * 0.06, H * 0.94, t), r = Math.max(0.12, prof(t)), a = i * 2.4 + rnd();
    for (let j = 0; j < 2; j++) {
      const off = j ? 0.3 * r : 0.12 * r, aa = a + j * Math.PI;
      const g = blobG(rx * r * (j ? 0.62 : 0.86), (H / n) * (j ? 1.1 : 1.5), rz * r * (j ? 0.62 : 0.86), Math.cos(aa) * off * rx, y + (j ? H / n * 0.4 : 0), Math.sin(aa) * off * rz, rnd, { amp: 0.16 });
      b.add(leafM, paintFoliage(g, o.look.f[(i + j) % o.look.f.length], rnd, { lo: -0.28, hi: 0.1, ao: lerp(0.85, 1.05, t) }));
    }
  }
  b.add(leafM, paintFoliage(blobG(rx * 0.16, H * 0.07, rz * 0.16, 0, H * 0.95, 0, rnd, { amp: 0.1 }), o.look.f[0], rnd));
}

/** Date palm (feather fronds, diamond-patterned trunk) and Washingtonia (fan fronds, slim ringed trunk, dry skirt). */
function palmTree(b, S, W, D, H, rnd, o) {
  const leafM = vmat('frond'), fan = !!S.fan, R = Math.min(W, D) / 2, L = R * 1.1, look = o.look;
  const yT = Math.max(H * 0.2, H - L * (fan ? 0.6 : 0.75));
  const tr = (fan ? 0.15 : 0.23) * Math.sqrt(clamp(H, 2, 16) / 8) * (o.young ? 0.85 : 1), seg = 10;
  const n = clamp(Math.round(yT / (fan ? 0.16 : 0.2)), 4, 44), lean = (rnd() - 0.5) * 0.06 * H, la = rnd() * TAU;
  const pts = [], rad = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n; pts.push([Math.cos(la) * lean * t * t, yT * t, Math.sin(la) * lean * t * t]);
    rad.push(tr * (1 + (fan ? 0.7 : 0.25) * (1 - t) ** 4) * lerp(1, fan ? 0.72 : 0.9, t) * (fan ? (i % 2 ? 1 : 0.9) : 1));
  }
  const tg = tubeG(pts, rad, seg, fan ? {} : { flute: 0.09, lobes: 5, spin: Math.PI, phase: Math.PI / 2 });
  const ca = colorAttr(tg).array, c1 = C(look.bark), c2 = C(K.shade(look.bark, -0.28));
  for (let i = 0; i <= n; i++) for (let j = 0; j < seg; j++) { const c = (fan ? i % 2 : (i + j) % 2) ? c1 : c2, k = (i * seg + j) * 3, f = 0.85 + rnd() * 0.25; ca[k] = c.r * f; ca[k + 1] = c.g * f; ca[k + 2] = c.b * f; }
  b.add(fan ? vmat('bark') : vmat('flat'), tg);
  const top = pts[n];
  if (fan) b.add(leafM, paintFoliage(blobG(tr * 2.3, Math.min(yT * 0.14, L * 0.45), tr * 2.3, top[0], top[1] - Math.min(yT * 0.1, L * 0.3), top[2], rnd, { amp: 0.3 }), '#8f7a58', rnd, { lo: -0.3 }));
  else b.add(leafM, paintFoliage(blobG(tr * 1.55, tr * 2.2, tr * 1.55, top[0], top[1] - tr * 0.6, top[2], rnd, { amp: 0.25 }), '#9a7248', rnd, { lo: -0.3 }));
  const nF = o.young ? 18 : fan ? 28 : 32, T = new THREE.Vector3(), Sd = new THREE.Vector3(), Up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < nF; i++) {
    const u = (i + 0.5) / nF, az = i * 2.39996 + rnd() * 0.3, dx = Math.cos(az), dz = Math.sin(az);
    const th0 = lerp(1.38, fan ? -0.25 : -0.05, Math.pow(u, 0.85)), droop = lerp(0.7, 1.5, u), Lf = L * (0.9 + rnd() * 0.2) * (fan ? 0.55 : 1);
    const col = K.shade(look.f[i % look.f.length], lerp(0.1, -0.12, u)), m = 14, rp = [[top[0] + dx * tr * 0.4, top[1], top[2] + dz * tr * 0.4]];
    for (let s = 1; s <= m; s++) { const ang = th0 - droop * Math.pow(s / m, 1.7), q = rp[s - 1]; rp.push([q[0] + dx * Math.cos(ang) * Lf / m, q[1] + Math.sin(ang) * Lf / m, q[2] + dz * Math.cos(ang) * Lf / m]); }
    const tri = [];
    const stem = bladeG(rp, tr * 0.22, (t) => 1 - 0.7 * t, { fold: 0.3 });
    b.add(leafM, paintFoliage(stem, fan ? '#7f9a50' : '#8a9a52', rnd, { lo: -0.1 }));
    if (!fan) {
      for (let s = 1; s <= m; s++) {
        const p = rp[s], q = rp[s - 1], t = s / m, ll = Lf * 0.26 * Math.pow(Math.sin(Math.PI * clamp(t * 0.92 + 0.06, 0, 1)), 0.6);
        T.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]); const sp = T.length() * 0.46; T.normalize();
        Sd.crossVectors(T, Up).normalize();
        for (const sgn of [1, -1]) {
          const tip = [p[0] + Sd.x * sgn * ll + T.x * ll * 0.5, p[1] + Sd.y * sgn * ll + T.y * ll * 0.5 + ll * 0.22 - ll * 0.3 * t, p[2] + Sd.z * sgn * ll + T.z * ll * 0.5];
          tri.push(p[0] - T.x * sp, p[1] - T.y * sp, p[2] - T.z * sp, p[0] + T.x * sp, p[1] + T.y * sp, p[2] + T.z * sp, ...tip);
        }
      }
    } else {
      const c = rp[m], q = rp[m - 2], nS = 9, rf = L * 0.62 * (0.9 + rnd() * 0.2), rim = [];
      T.set(c[0] - q[0], c[1] - q[1], c[2] - q[2]).normalize(); Sd.crossVectors(T, Up).normalize();
      const U2 = new THREE.Vector3().crossVectors(Sd, T);
      for (let s = 0; s <= nS * 2; s++) {
        const ph = lerp(-2.0, 2.0, s / (nS * 2)), k = rf * (s % 2 ? 0.8 : 1), cu = 0.22 * rf * (s % 2 ? 1 : -0.4) - rf * 0.3 * (1 - Math.cos(ph)) * 0.5;
        rim.push([c[0] + (T.x * Math.cos(ph) + Sd.x * Math.sin(ph)) * k + U2.x * cu, c[1] + (T.y * Math.cos(ph) + Sd.y * Math.sin(ph)) * k + U2.y * cu - rf * 0.12 * Math.abs(ph), c[2] + (T.z * Math.cos(ph) + Sd.z * Math.sin(ph)) * k + U2.z * cu]);
      }
      for (let s = 0; s < rim.length - 1; s++) tri.push(...c, ...rim[s], ...rim[s + 1]);
    }
    b.add(leafM, paintFoliage(trisG(tri), col, rnd, { lo: -0.22, hi: 0.14 }));
  }
  if (o.fruit && !fan) for (let i = 0; i < 7; i++) {
    const az = rnd() * TAU, l = L * (0.28 + rnd() * 0.1), e = [top[0] + Math.cos(az) * l, top[1] - l * 0.75, top[2] + Math.sin(az) * l];
    b.add(leafM, paintFoliage(tubeG(bez(top, [top[0] + Math.cos(az) * l * 0.8, top[1] + l * 0.2, top[2] + Math.sin(az) * l * 0.8], e, 4), tr * 0.07, 4), '#c9a04a', rnd, { lo: 0 }));
    b.add(leafM, paintFoliage(blobG(l * 0.2, l * 0.42, l * 0.2, e[0], e[1] - l * 0.2, e[2], rnd, { amp: 0.25 }), look.fruit.c, rnd, { lo: -0.3 }));
  }
}

/** Banana clump: fat green pseudostems and huge arching paddle leaves (some torn by the wind). */
function bananaTree(b, S, W, D, H, rnd, o) {
  const leafM = vmat('frond'), R = Math.min(W, D) / 2, stems = o.young ? 1 : 3, look = o.look;
  const paddle = (t) => (t < 0.1 ? 0.14 : Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(clamp((t - 0.1) / 0.9, 0, 1), 0.72))), 0.55));
  for (let s = 0; s < stems; s++) {
    const k = s === 0 ? 1 : 0.62 + rnd() * 0.2, a0 = rnd() * TAU, off = s === 0 ? 0 : R * 0.28;
    const bx = Math.cos(a0 + s * 2.2) * off, bz = Math.sin(a0 + s * 2.2) * off, hs = H * 0.5 * k, r = 0.1 * Math.pow(H / 3, 0.7) * k;
    const sp = [[bx, 0, bz], [bx * 1.05, hs * 0.5, bz * 1.05], [bx * 1.1, hs, bz * 1.1]];
    b.add(vmat('matte'), paintBark(tubeG(sp, [r * 1.25, r, r * 0.7], 9), look.bark, rnd, hs, '#6a5a3a'));
    const nL = s === 0 ? 8 : 5, top = sp[2];
    for (let i = 0; i < nL; i++) {
      const u = (i + 0.5) / nL, az = a0 + i * 2.39996, th0 = lerp(1.45, 0.35, u), droop = lerp(0.9, 1.9, u), Ll = (R * 1.08 - off * 0.5) * k * (0.85 + rnd() * 0.25), m = 9;
      const pts = [top];
      for (let q = 1; q <= m; q++) { const ang = th0 - droop * Math.pow(q / m, 1.6), pr = pts[q - 1]; pts.push([pr[0] + Math.cos(az) * Math.cos(ang) * Ll / m, pr[1] + Math.sin(ang) * Ll / m, pr[2] + Math.sin(az) * Math.cos(ang) * Ll / m]); }
      const g = bladeG(pts, Ll * 0.34, paddle, { fold: 0.22, skip: (q) => q > 2 && rnd() < 0.07 });
      b.add(leafM, paintFoliage(g, K.shade(look.f[i % look.f.length], lerp(0.12, -0.1, u)), rnd, { lo: -0.2, hi: 0.16, sparkle: 0.06 }));
    }
    if (o.fruit && s === 0) {
      const az = a0 + 1, e = [top[0] + Math.cos(az) * R * 0.3, top[1] - hs * 0.28, top[2] + Math.sin(az) * R * 0.3];
      b.add(vmat('matte'), tubeG(bez(top, [top[0] + Math.cos(az) * R * 0.3, top[1] + hs * 0.1, top[2] + Math.sin(az) * R * 0.3], e, 4), r * 0.2, 5), '#7f8a45');
      for (let q = 0; q < 4; q++) b.add(leafM, paintFoliage(blobG(r * (1.5 - q * 0.2), r * 0.8, r * (1.5 - q * 0.2), e[0], e[1] - q * r * 1.2, e[2], rnd, { amp: 0.3 }), q < 3 ? look.fruit.c : '#7a3050', rnd, { lo: -0.3 }));
    }
  }
}

/** Plumeria (frangipani): thick grey candelabra branches, leaf rosettes and flower clusters at the tips. */
function plumeriaTree(b, S, W, D, H, rnd, o) {
  const leafM = vmat('frond'), barkM = vmat('bark'), R = Math.min(W, D) / 2, look = o.look, levels = o.young ? 2 : 3;
  const r0 = 0.075 * Math.pow(H / 3, 0.8) * (o.young ? 0.7 : 1), flower = look.bloom ? look.bloom.c[0] : '#fbf7ea';
  const grow = (p, dir, len, r, depth) => {
    const e = [p[0] + dir[0] * len, p[1] + dir[1] * len, p[2] + dir[2] * len], mid = [lerp(p[0], e[0], 0.5) + dir[0] * 0.02, lerp(p[1], e[1], 0.5) - len * 0.06, lerp(p[2], e[2], 0.5)];
    b.add(barkM, paintBark(tubeG(bez(p, mid, e, 3), taper(r, r * 0.8, 3), 7, { cap: true }), look.bark, rnd, 0));
    if (depth >= levels) {
      for (let i = 0; i < 8; i++) {
        const az = (i / 8) * TAU + rnd() * 0.4, el = 0.15 + rnd() * 0.5, Ll = R * 0.36 * (0.8 + rnd() * 0.4), pts = [e];
        for (let q = 1; q <= 4; q++) { const ang = el - 0.9 * Math.pow(q / 4, 1.5), pr = pts[q - 1]; pts.push([pr[0] + Math.cos(az) * Math.cos(ang) * Ll / 4, pr[1] + Math.sin(ang) * Ll / 4, pr[2] + Math.sin(az) * Math.cos(ang) * Ll / 4]); }
        b.add(leafM, paintFoliage(bladeG(pts, Ll * 0.3, lanceolate, { fold: 0.2 }), look.f[i % look.f.length], rnd, { lo: -0.2 }));
      }
      for (let i = 0; i < 4; i++) {
        const az = rnd() * TAU, fr = R * 0.06, q = [e[0] + Math.cos(az) * fr * 1.3, e[1] + fr * (1.2 + rnd()), e[2] + Math.sin(az) * fr * 1.3];
        b.add(leafM, paintFoliage(blobG(fr, fr * 0.6, fr, q[0], q[1], q[2], rnd, { detail: 0, amp: 0.2 }), flower, rnd, { lo: -0.08 }));
        b.add(leafM, blobG(fr * 0.4, fr * 0.4, fr * 0.4, q[0], q[1] + fr * 0.4, q[2], rnd, { detail: 0, amp: 0 }), '#f2c230');
      }
      return;
    }
    const nC = depth === 0 ? 3 : 2, a0 = rnd() * TAU;
    for (let i = 0; i < nC; i++) {
      const az = a0 + (i / nC) * TAU + (rnd() - 0.5) * 0.5, tilt = depth === 0 ? 0.75 : 0.6 + rnd() * 0.25;
      const base = new THREE.Vector3(...dir), side = new THREE.Vector3(Math.cos(az), 0.25, Math.sin(az)).normalize();
      const nd = base.multiplyScalar(Math.cos(tilt)).addScaledVector(side, Math.sin(tilt)).normalize();
      grow(e, [nd.x, Math.max(0.25, nd.y), nd.z], len * 0.78, r * 0.72, depth + 1);
    }
  };
  grow([0, 0, 0], [0.03, 1, 0.02], H * 0.3, r0, 0);
}

const TREE_BUILDERS = { palm: palmTree, column: columnTree, banana: bananaTree, plumeria: plumeriaTree };
registerModel('tree', {
  build({ w, d, h, p, item }) {
    const P = params(p), species = oneOf(P.species, Object.keys(TREES), 'generic'), S = TREES[species];
    const Pc = { color: hexOf(P.color, null), color2: hexOf(P.color2, null), color3: hexOf(P.color3, null) };
    const look = treeLook(S, Pc), rnd = K.rng(seedOf(item, species)), b = new Batch();
    const fruit = P.fruit === true || P.fruit === 'true' || (P.fruit == null && !!(S.fruit && S.fruit.def));
    (TREE_BUILDERS[S.kind] || broadleaf)(b, S, w, d, h, rnd, { young: P.age === 'young', fruit, look, P: Pc });
    return b.fit(w, d, h).build();
  },
  draw2d(ctx, { w, d, p, px, item }) {
    const P = params(p), species = oneOf(P.species, Object.keys(TREES), 'generic'), S = TREES[species];
    const look = treeLook(S, { color: hexOf(P.color, null), color2: hexOf(P.color2, null), color3: hexOf(P.color3, null) });
    const rnd = K.rng(seedOf(item, species)), rx = w / 2, ry = d / 2, r = Math.min(rx, ry), col = look.f[0];
    const fruit = P.fruit === true || (P.fruit == null && !!(S.fruit && S.fruit.def));
    if (S.kind === 'palm') {
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.fillStyle = rgba(col, 0.12); ctx.fill();
      fronds2D(ctx, rx, ry, S.fan ? 18 : 14, col, rnd, px, S.fan ? 0.2 : 0.11);
      if (fruit && !S.fan) for (let i = 0; i < 6; i++) dot(ctx, Math.cos(i * 1.05) * rx * 0.2, Math.sin(i * 1.05) * ry * 0.2, Math.max(1.5 * px, r * 0.045), rgba(look.fruit.c, 0.9));
      K.fillCircle(ctx, 0, 0, Math.max(2 * px, Math.min(r * 0.14, 22)), look.bark, INK, px);
    } else if (S.kind === 'banana') {
      fronds2D(ctx, rx, ry, 9, col, rnd, px, 0.3);
      K.fillCircle(ctx, 0, 0, Math.max(2 * px, Math.min(r * 0.1, 12)), K.tint(look.bark, 0.2), INK, px);
    } else if (S.kind === 'column') {
      canopy2D(ctx, rx, ry, col, rnd, px, { alpha: 0.55, clumps: 0, lobes: 11 });
      scallopPath(ctx, 0, 0, rx * 0.6, ry * 0.6, 9, 0.12, rnd); ctx.fillStyle = rgba(K.shade(col, -0.2), 0.4); ctx.fill(); ctx.strokeStyle = rgba(K.shade(col, -0.5), 0.6); ctx.lineWidth = px; ctx.stroke();
      dot(ctx, 0, 0, Math.max(1.5 * px, r * 0.08), rgba(K.shade(col, -0.55), 0.9));
    } else if (S.kind === 'plumeria') {
      canopy2D(ctx, rx, ry, col, rnd, px, { alpha: 0.2, clumps: 0 });
      for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU + rnd() * 0.3, k = 0.5 + rnd() * 0.22; ctx.save(); ctx.translate(Math.cos(a) * rx * k, Math.sin(a) * ry * k); fronds2D(ctx, r * 0.3, r * 0.3, 7, col, rnd, px, 0.2); dot(ctx, 0, 0, Math.max(1.4 * px, r * 0.05), rgba(look.bloom.c[0], 0.95)); ctx.restore(); }
      trunk2D(ctx, rx, ry, look.bark, rnd, px, Math.min(r * 0.07, 9), 6);
    } else {
      const bloom = look.bloom && look.bloom.cover ? look.bloom.c[0] : null, base = bloom ? mix(col, bloom, 0.6) : col;
      const accent = bloom || (look.bloom && look.bloom.dots ? look.bloom.c[0] : fruit && look.fruit ? look.fruit.c : null);
      canopy2D(ctx, rx, ry, base, rnd, px, { accent, dots: bloom ? 26 : 14, dotR: bloom ? 0.06 : fruit ? clamp(look.fruit.r * 1.4, 0.03, 0.06) : 0.04, alpha: S.bs < 0.32 ? 0.24 : 0.36 });
      trunk2D(ctx, rx, ry, look.bark, rnd, px, clamp(S.tr * 100 * (P.age === 'young' ? 0.5 : 1), 3, r * 0.14));
    }
  },
});

// ═════════════════════════════════ 6. shrubs ═════════════════════════════════
/** Thin 3-sided spike from p0 to its apex p1. */
function spikeG(p0, p1, r) {
  const a = [p0[0] + r, p0[1], p0[2]], b2 = [p0[0] - r / 2, p0[1], p0[2] + r * 0.87], c = [p0[0] - r / 2, p0[1], p0[2] - r * 0.87];
  return [...a, ...b2, ...p1, ...b2, ...c, ...p1, ...c, ...a, ...p1];
}
/** 3-sided spindle (flower bud / spike head) between p0 and p1, widest at 40 %. */
function budG(p0, p1, r) {
  const m = [lerp(p0[0], p1[0], 0.4), lerp(p0[1], p1[1], 0.4), lerp(p0[2], p1[2], 0.4)];
  const a = [m[0] + r, m[1], m[2]], b2 = [m[0] - r / 2, m[1], m[2] + r * 0.87], c = [m[0] - r / 2, m[1], m[2] - r * 0.87];
  return [...a, ...b2, ...p1, ...b2, ...c, ...p1, ...c, ...a, ...p1, ...b2, ...a, ...p0, ...c, ...b2, ...p0, ...a, ...c, ...p0];
}
/** Five-petalled flat flower facing direction dir. */
function starG(c, dir, r, petals = 5) {
  const n = new THREE.Vector3(...dir).normalize(), u = new THREE.Vector3(n.z, 0, -n.x), tri = [];
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
  u.normalize(); const v = new THREE.Vector3().crossVectors(n, u);
  const at = (a, k, lift) => [c[0] + (u.x * Math.cos(a) + v.x * Math.sin(a)) * r * k + n.x * r * lift, c[1] + (u.y * Math.cos(a) + v.y * Math.sin(a)) * r * k + n.y * r * lift, c[2] + (u.z * Math.cos(a) + v.z * Math.sin(a)) * r * k + n.z * r * lift];
  for (let i = 0; i < petals; i++) { const a = (i / petals) * TAU, w = Math.PI / petals * 0.92; tri.push(...c, ...at(a - w, 0.62, 0.12), ...at(a, 1, 0.3), ...c, ...at(a, 1, 0.3), ...at(a + w, 0.62, 0.12)); }
  return tri;
}
/**
 * n blades radiating from point c (rosettes, grasses, ferns, paddles): elevation runs el0 (inner) → el1 (outer) and
 * every blade arches down by `curve`. o: { wid ratio, el0, el1, curve, colors, segs, profile, fold, r0 start radius }
 */
function bladeFan(b, mat, c, n, L, rnd, o) {
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, az = i * 2.39996 + rnd() * 0.4, el = lerp(o.el0, o.el1, Math.pow(u, 0.9)), Ll = L * (0.8 + rnd() * 0.35), m = o.segs || 4, r0 = o.r0 || 0;
    const pts = [[c[0] + Math.cos(az) * r0, c[1], c[2] + Math.sin(az) * r0]];
    for (let q = 1; q <= m; q++) { const ang = el - o.curve * Math.pow(q / m, 1.6), pr = pts[q - 1]; pts.push([pr[0] + Math.cos(az) * Math.cos(ang) * Ll / m, pr[1] + Math.sin(ang) * Ll / m, pr[2] + Math.sin(az) * Math.cos(ang) * Ll / m]); }
    b.add(mat, paintFoliage(bladeG(pts, Ll * o.wid, o.profile || strap, { fold: o.fold ?? 0.25 }), K.shade(o.colors[i % o.colors.length], lerp(0.1, -0.1, u)), rnd, { lo: -0.22, hi: 0.14 }));
  }
}
const SHRUBS = {
  bougainvillea: { f: ['#4a7a38', '#5a8a42'], k: 8, up: 0.2, fl: { c: '#c8287f', mode: 'cover', cover: 0.7 }, sprays: 7, leaf: { n: 14, s: 0.1, a: 0.7 } },
  lavender: { kind: 'spikes', f: ['#8a9a80', '#7c8c74'], fl: { c: '#8a6fd0' }, n: 90, len: 0.42 },
  rosemary: { kind: 'spikes', f: ['#4f6a4a', '#5c7854'], fl: { c: '#9aa8e0' }, n: 80, len: 0.22, upright: true, green: true },
  hibiscus: { f: ['#2f6a30', '#3b7a38', '#28582a'], k: 8, up: 0.7, stems: true, fl: { c: '#e0283a', mode: 'star', n: 12, s: 0.08 } },
  oleander: { f: ['#4a6f42', '#587c4c'], k: 8, up: 1, stems: true, fl: { c: '#f08aa8', mode: 'cluster', n: 20, s: 0.06, top: true }, leaf: { n: 16, s: 0.13, a: 0.18 } },
  rose: { f: ['#3f6f38', '#4c7c42'], k: 7, up: 0.6, stems: true, fl: { c: '#d8243c', mode: 'rose', n: 12, s: 0.055 } },
  lantana: { f: ['#4f7f3c', '#5c8c46'], k: 8, up: 0, fl: { c: '#f2a024', c2: ['#f2d024', '#f05a3a', '#f07aa0'], mode: 'cluster', n: 34, s: 0.035 } },
  plumbago: { f: ['#5f8f4a', '#6c9c54'], k: 8, up: 0.2, fl: { c: '#9fc4ee', mode: 'cluster', n: 30, s: 0.045 } },
  myrtle: { f: ['#33602f', '#3f6c38', '#2a5028'], k: 9, up: 0.4, fl: { c: '#f4f1e4', mode: 'dots', n: 26, s: 0.02 }, leaf: { n: 12, s: 0.05, a: 0.5 } },
  pittosporum: { f: ['#6a9a55', '#7aa862', '#5a8a48'], k: 9, up: 0.3, leaf: { n: 14, s: 0.07, a: 0.6, c: ['#cfe0a8', '#8fba6a'] } },
  duranta: { f: ['#a8c040', '#b8cc4c', '#94ac38'], k: 8, up: 0.4, fl: { c: '#8f7ae0', c2: ['#f0a030'], mode: 'cluster', n: 20, s: 0.04 } },
  jasmine: { f: ['#3f7038', '#4c7c42'], k: 8, up: 0.1, fl: { c: '#fffdf4', mode: 'dots', n: 40, s: 0.024 } },
  agave: { kind: 'rosette', f: ['#7f9c8c', '#8caa98', '#708c7e'], n: 30, wid: 0.3, el: [1.35, 0.05], curve: 0.45 },
  aloe: { kind: 'rosette', f: ['#6f9a5a', '#7ca864'], n: 20, wid: 0.14, el: [1.4, 0.25], curve: 0.5, stalk: '#f06a2a', hK: 0.6 },
  cactus: { kind: 'cactus', f: ['#4f7a4a', '#5c8854', '#6a9a5a'], fl: { c: '#f2c63a' } },
  yucca: { kind: 'rosette', f: ['#5f8a5a', '#6c9864', '#52784e'], n: 44, wid: 0.075, el: [1.45, -0.55], curve: 0.25, trunk: 0.4, stalk: '#f4efd8', hK: 0.72 },
  'ornamental-grass': { kind: 'grass', f: ['#8aa860', '#9ab46a', '#b8b070'], fl: { c: '#e4d4b0' } },
  'bird-of-paradise': { kind: 'paddle', f: ['#4f8a4a', '#5c9854', '#427a40'], fl: { c: '#f08a1e' } },
  geranium: { f: ['#4f8a3c', '#5c9846'], k: 7, up: 0, fl: { c: '#e8303a', mode: 'cluster', n: 14, s: 0.06, raise: 0.5 } },
  sage: { kind: 'spikes', f: ['#8fa088', '#9cac94'], fl: { c: '#7a5fc0' }, n: 60, len: 0.36 },
  'succulent-mix': { kind: 'succulents', f: ['#7fa894', '#9a6a7a', '#a8c070', '#6f9a8a', '#c0a0a8'] },
  fern: { kind: 'fern', f: ['#4f8a3a', '#5c9a44', '#427a32'] },
  generic: { f: ['#4f7f3c', '#5f8f48', '#40702f'], k: 8, up: 0.3 },
};
/** Dome of foliage blobs with flowers by mode: cover | dots | cluster | star | rose. o: { f foliage tones, fl flower spec, custom } */
function moundShrub(b, S, W, D, H, rnd, o) {
  const leafM = vmat('leaf'), rx = W / 2, rz = D / 2, up = S.up ?? 0.3, k = S.k || 8, f = o.f, fl = o.fl, blobs = [];
  const sizeK = clamp(Math.sqrt(W * D), 0.45, 1.8), lf = S.leaf || { n: 16, s: 0.08, a: 0.5 };
  const add = (x, y, z, bx, by, bz, main, forceFl) => {
    const cover = forceFl || (fl && fl.mode === 'cover' && !main && rnd() < fl.cover), col = cover ? K.shade(fl.c, (rnd() - 0.5) * 0.2) : f[Math.floor(rnd() * f.length)];
    b.add(leafM, paintFoliage(blobG(bx, by, bz, x, y, z, rnd, { detail: main ? 2 : 1, amp: 0.2, floor: 0 }), col, rnd, { lo: cover ? -0.2 : -0.36 }));
    b.add(leafM, leafCloudG([x, y, z], [bx, by, bz], Math.round(lf.n * (main ? 1.5 : 1)), lf.s * sizeK * 1.3, rnd, { aspect: lf.a, hang: 0, colors: cover ? [fl.c, K.shade(fl.c, 0.2)] : (lf.c && !o.custom ? lf.c : [K.shade(col, 0.15), col]), up: true }));
    blobs.push({ x, y, z, bx, by, bz });
  };
  add(0, H * lerp(0.42, 0.5, up), 0, rx * lerp(0.66, 0.5, up), H * lerp(0.42, 0.5, up), rz * lerp(0.66, 0.5, up), true);
  for (let i = 0; i < k; i++) {
    const a = (i / k) * TAU + rnd() * 0.5, R = lerp(0.55, 0.42, up), hh = H * clamp(lerp(0.62, 0.78, up) + (rnd() - 0.3) * 0.35, 0.35, 1);
    add(Math.cos(a) * R * rx, hh * 0.56, Math.sin(a) * R * rz, rx * 0.42, hh * 0.46, rz * 0.42, false);
  }
  if (S.stems) for (let i = 0; i < 5; i++) { const bl = blobs[1 + i]; b.add(vmat('bark'), tubeG(bez([0, 0, 0], [bl.x * 0.3, bl.y * 0.7, bl.z * 0.3], [bl.x, bl.y, bl.z], 3), taper(0.016 * sizeK, 0.007 * sizeK, 3), 5), '#6a5a48'); }
  if (S.sprays && fl) for (let i = 0; i < S.sprays; i++) {
    const a = (i / S.sprays) * TAU + rnd(), pts = bez([0, H * 0.5, 0], [Math.cos(a) * rx * 0.5, H * 1.1, Math.sin(a) * rz * 0.5], [Math.cos(a) * rx * 0.92, H * (0.35 + rnd() * 0.35), Math.sin(a) * rz * 0.92], 5);
    for (let q = 2; q <= 5; q++) add(pts[q][0], pts[q][1], pts[q][2], rx * 0.17, H * 0.1, rz * 0.17, false, true);
  }
  if (fl && fl.mode !== 'cover') {
    const n = Math.min(90, Math.round(fl.n * clamp(W * D, 0.35, 4))), fm = vmat('frond'), tri = {};
    for (let i = 0; i < n; i++) {
      const bl = blobs[Math.floor(rnd() * blobs.length)], a = rnd() * TAU, dy = fl.top ? 0.55 + rnd() * 0.45 : 0.1 + rnd() * 0.85, sr = Math.sqrt(1 - dy * dy), dir = [Math.cos(a) * sr, dy, Math.sin(a) * sr];
      const q = [bl.x + dir[0] * bl.bx * 1.05, bl.y + dir[1] * bl.by * 1.05 + (fl.raise || 0) * fl.s, bl.z + dir[2] * bl.bz * 1.05], s = fl.s * sizeK * (1.1 + rnd() * 0.5);
      const col = fl.c2 && rnd() < 0.5 ? fl.c2[Math.floor(rnd() * fl.c2.length)] : fl.c;
      if (fl.mode === 'star') { (tri[col] = tri[col] || []).push(...starG(q, dir, s * 1.5)); b.add(leafM, blobG(s * 0.25, s * 0.5, s * 0.25, q[0] + dir[0] * s * 0.5, q[1] + dir[1] * s * 0.5, q[2] + dir[2] * s * 0.5, rnd, { detail: 0, amp: 0 }), '#f2d24a'); }
      else if (fl.mode === 'rose') { b.add(leafM, paintFoliage(blobG(s * 1.25, s, s * 1.25, q[0], q[1], q[2], rnd, { detail: 0, amp: 0.15 }), col, rnd, { lo: -0.3, hi: 0.1 })); b.add(leafM, blobG(s * 0.6, s * 0.6, s * 0.6, q[0] + dir[0] * s * 0.6, q[1] + dir[1] * s * 0.6, q[2] + dir[2] * s * 0.6, rnd, { detail: 0, amp: 0.1 }), K.shade(col, -0.2)); }
      else b.add(leafM, paintFoliage(blobG(s, s * 0.6, s, q[0], q[1], q[2], rnd, { detail: 0, amp: 0.2 }), K.shade(col, (rnd() - 0.5) * 0.15), rnd, { lo: -0.12 }));
    }
    for (const col of Object.keys(tri)) b.add(fm, paintFoliage(trisG(tri[col]), col, rnd, { lo: -0.1, hi: 0.1 }));
  }
}
/** Lavender / rosemary / sage: a low mound bristling with fine stems tipped by flower spikes. */
function spikeShrub(b, S, W, D, H, rnd, o) {
  const rx = W / 2, rz = D / 2, green = [], flower = [], base = S.upright ? 0.5 : 0.4;
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + rnd(); b.add(vmat('leaf'), paintFoliage(blobG(rx * 0.5, H * base * 0.6, rz * 0.5, Math.cos(a) * rx * 0.28, H * base * 0.5, Math.sin(a) * rz * 0.28, rnd, { amp: 0.25, floor: 0 }), o.f[i % o.f.length], rnd)); }
  for (let i = 0; i < S.n; i++) {
    const a = rnd() * TAU, el = S.upright ? 0.75 + rnd() * 0.8 : 0.3 + rnd() * 1.27, ce = Math.cos(el), se = Math.sin(el), k = 0.9 + rnd() * 0.1;
    const p1 = [Math.cos(a) * ce * rx * k, se * H * k, Math.sin(a) * ce * rz * k], p0 = [p1[0] * 0.45, p1[1] * 0.4, p1[2] * 0.45], pm = [lerp(p0[0], p1[0], 1 - S.len), lerp(p0[1], p1[1], 1 - S.len), lerp(p0[2], p1[2], 1 - S.len)];
    green.push(...spikeG(p0, S.green ? p1 : pm, 0.012 * (S.green ? 1.6 : 1)));
    if (!S.green || rnd() < 0.35) flower.push(...budG(S.green ? lerp3(pm, p1, 0.5) : pm, p1, S.green ? 0.012 : 0.016));
  }
  b.add(vmat('frond'), paintFoliage(trisG(green), K.shade(o.f[0], S.green ? 0.05 : 0.12), rnd, { lo: -0.25 }));
  if (flower.length) b.add(vmat('frond'), paintFoliage(trisG(flower), o.fl.c, rnd, { lo: -0.15, hi: 0.15, sparkle: 0.2 }));
}
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** Agave / aloe / yucca: a rosette of stiff channelled leaves, optionally on a trunk and with a flower stalk. */
function rosetteShrub(b, S, W, D, H, rnd, o) {
  const R = Math.min(W, D) / 2, y0 = S.trunk ? H * S.trunk : 0, top = H * (S.hK || 1), L = S.trunk ? R * 1.02 : Math.max(R * 1.05, (top - y0) * 0.8);
  if (S.trunk) {
    b.add(vmat('bark'), paintBark(tubeG([[0, 0, 0], [R * 0.05, y0 * 0.5, 0], [0, y0, 0]], [R * 0.16, R * 0.12, R * 0.11], 8, { rough: 0.3, rnd }), '#7a6a55', rnd, y0));
    b.add(vmat('frond'), paintFoliage(blobG(R * 0.3, y0 * 0.2, R * 0.3, 0, y0 * 0.84, 0, rnd, { amp: 0.35 }), '#a39472', rnd));
  }
  bladeFan(b, vmat('frond'), [0, y0, 0], S.n, L, rnd, { wid: S.wid, el0: S.el[0], el1: S.el[1], curve: S.curve, colors: o.f, segs: 4, fold: -0.3, r0: R * 0.04 });
  if (S.stalk) {
    const n = S.trunk ? 1 : 2, col = o.fl ? o.fl.c : S.stalk;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * R * 0.3, yT = H * (1 - i * 0.12);
      b.add(vmat('matte'), tubeG([[x * 0.3, y0, 0], [x, lerp(y0, yT, 0.6), 0]], 0.012, 5), '#8a9a5a');
      for (let q = 0; q < 5; q++) { const t = q / 4; b.add(vmat('leaf'), paintFoliage(blobG(R * lerp(S.trunk ? 0.2 : 0.07, 0.04, t), (yT - y0) * 0.07, R * lerp(S.trunk ? 0.2 : 0.07, 0.04, t), x, lerp(lerp(y0, yT, 0.55), yT * 0.97, t), 0, rnd, { detail: 1, amp: 0.3 }), col, rnd, { lo: -0.15 })); }
    }
  }
}
/** Columnar cactus with arms next to a prickly-pear with pads. */
function cactusShrub(b, S, W, D, H, rnd, o) {
  const flat = vmat('flat'), rc = Math.min(W, D) * 0.13, cx = -W * 0.16, col = (i) => o.f[i % o.f.length];
  const column = (x, z, r, h, i) => {
    b.add(flat, paintY(tubeG([[x, 0, z], [x, h * 0.5, z], [x, h - r * 0.8, z]], [r * 0.92, r, r * 0.95], 16, { flute: 0.13, lobes: 8 }), K.shade(col(i), -0.2), col(i), 0, h));
    b.add(flat, blobG(r * 0.98, r * 0.85, r * 0.98, x, h - r * 0.85, z, rnd, { amp: 0.03 }), col(i));
  };
  column(cx, -D * 0.1, rc, H, 0); column(cx + rc * 2.1, D * 0.12, rc * 0.82, H * 0.62, 1); column(cx - rc * 0.6, D * 0.3, rc * 0.7, H * 0.4, 2);
  for (const [sg, hy] of [[1, 0.42], [-1, 0.55]]) {                       // arms
    const e = [cx + sg * rc * 2.4, H * (hy + 0.3), -D * 0.1], pts = bez([cx, H * hy, -D * 0.1], [cx + sg * rc * 2.6, H * hy - rc * 0.3, -D * 0.1], e, 5);
    if (sg > 0 && cx + rc * 3.2 > W / 2) continue;
    b.add(flat, tubeG(pts, rc * 0.6, 12, { flute: 0.13, lobes: 6 }), col(sg > 0 ? 1 : 0));
    b.add(flat, blobG(rc * 0.6, rc * 0.55, rc * 0.6, e[0], e[1], e[2], rnd, { amp: 0.03 }), col(1));
  }
  const px = W * 0.24, pr = Math.min(W, D) * 0.15;                          // opuntia pads
  const pads = [[px, pr * 1.0, D * 0.05, 0, 0.3], [px - pr * 0.9, pr * 2.3, D * 0.08, 0.5, 1.2], [px + pr * 0.7, pr * 2.5, D * 0.0, -0.45, 2.2], [px - pr * 0.2, pr * 3.7, D * 0.1, 0.15, 0.6], [px + pr * 0.2, pr * 0.9, -D * 0.2, 0.2, 1.9]];
  pads.forEach(([x, y, z, tilt, yaw], i) => {
    const s = i < 1 ? 1 : 0.82, g = blobG(pr * s, pr * 1.25 * s, pr * 0.2, 0, 0, 0, rnd, { amp: 0.08 }).rotateZ(tilt).rotateY(yaw).translate(x, y, z);
    b.add(flat, paintFoliage(g, col(i + 1), rnd, { lo: -0.2, hi: 0.08 }));
    if (i > 0) b.add(vmat('leaf'), blobG(pr * 0.16, pr * 0.2, pr * 0.16, x - Math.sin(tilt) * pr * 1.2 * s, y + pr * 1.25 * s * Math.cos(tilt), z, rnd, { detail: 0, amp: 0.1 }), i % 2 ? o.fl.c : '#d8405a');
  });
}
/** Fountain grass: fine arching blades and feathery plumes. */
function grassShrub(b, S, W, D, H, rnd, o) {
  const R = Math.min(W, D) / 2, fm = vmat('frond');
  bladeFan(b, fm, [0, 0, 0], 64, Math.max(H * 0.95, R * 1.2), rnd, { wid: 0.035, el0: 1.52, el1: 0.75, curve: 1.25, colors: o.f, segs: 3, fold: 0.3, r0: R * 0.06 });
  for (let i = 0; i < 9; i++) {
    const a = rnd() * TAU, r = R * (0.25 + rnd() * 0.5), e = [Math.cos(a) * r, H * (0.86 + rnd() * 0.14), Math.sin(a) * r];
    b.add(fm, tubeG([[e[0] * 0.15, 0, e[2] * 0.15], [e[0] * 0.7, e[1] * 0.6, e[2] * 0.7], e], 0.004, 3), o.f[0]);
    b.add(vmat('leaf'), paintFoliage(blobG(R * 0.07, H * 0.11, R * 0.07, e[0], e[1] - H * 0.09, e[2], rnd, { detail: 0, amp: 0.3 }), o.fl.c, rnd, { lo: -0.12 }));
  }
}
/** Bird-of-paradise: upright paddle leaves on long stalks plus orange-and-blue crests. */
function paddleShrub(b, S, W, D, H, rnd, o) {
  const R = Math.min(W, D) / 2, fm = vmat('frond'), prof = (t) => (t < 0.42 ? 0.1 : Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(clamp((t - 0.42) / 0.58, 0, 1), 0.8))), 0.6));
  bladeFan(b, fm, [0, 0, 0], 11, Math.max(H * 1.02, R), rnd, { wid: 0.2, el0: 1.52, el1: 1.0, curve: 0.5, colors: o.f, segs: 7, fold: 0.18, profile: prof, r0: R * 0.05 });
  for (let i = 0; i < 3; i++) {
    const a = rnd() * TAU, r = R * (0.3 + rnd() * 0.3), e = [Math.cos(a) * r, H * (0.6 + rnd() * 0.15), Math.sin(a) * r], tri = [];
    b.add(vmat('matte'), tubeG([[e[0] * 0.2, 0, e[2] * 0.2], e], 0.011, 5), '#5c8a4a');
    for (let q = 0; q < 4; q++) tri.push(...budG(e, [e[0] + Math.cos(a) * H * 0.05 * (q + 1), e[1] + H * (0.12 - q * 0.015), e[2] + Math.sin(a) * H * 0.05 * (q + 1)], H * 0.014));
    b.add(fm, paintFoliage(trisG(tri), o.fl.c, rnd, { lo: -0.1 }));
    b.add(fm, trisG(budG(e, [e[0] + Math.cos(a) * H * 0.14, e[1] + H * 0.02, e[2] + Math.sin(a) * H * 0.14], H * 0.012)), '#3a4aa0');
  }
}
function fernShrub(b, S, W, D, H, rnd, o) {
  const R = Math.min(W, D) / 2;
  bladeFan(b, vmat('frond'), [0, 0, 0], 18, Math.max(R * 1.25, H * 1.1), rnd, { wid: 0.3, el0: 1.4, el1: 0.35, curve: 1.3, colors: o.f, segs: 6, fold: 0.12, profile: (t) => lanceolate(t) * (0.7 + 0.3 * Math.abs(Math.sin(t * 22))), r0: R * 0.04 });
}
/** Succulent mix: a handful of low rosettes and cushions in contrasting tones. */
function succulentShrub(b, S, W, D, H, rnd, o) {
  const rx = W / 2, rz = D / 2, fm = vmat('frond'), n = clamp(Math.round(W * D * 14), 5, 14);
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996, k = i === 0 ? 0 : 0.35 + 0.5 * Math.sqrt(i / n), x = Math.cos(a) * rx * k, z = Math.sin(a) * rz * k, r = Math.min(rx, rz) * (i === 0 ? 0.42 : 0.2 + rnd() * 0.14), col = o.f[i % o.f.length];
    if (i % 3 === 2) b.add(vmat('leaf'), paintFoliage(blobG(r, H * 0.5, r, x, H * 0.25, z, rnd, { amp: 0.3, floor: 0 }), col, rnd, { lo: -0.25 }));
    else { bladeFan(b, fm, [x, 0, z], 12, r * 1.15, rnd, { wid: 0.5, el0: 1.3, el1: 0.2, curve: 0.2, colors: [col, K.shade(col, 0.12)], segs: 2, fold: -0.25, profile: lanceolate }); b.add(vmat('leaf'), blobG(r * 0.2, H * 0.25, r * 0.2, x, H * 0.2, z, rnd, { detail: 0, amp: 0.1 }), K.shade(col, 0.2)); }
  }
}
/** Clipped topiary: ball or cone of tight foliage. */
function topiaryShrub(b, shape, W, D, H, rnd, o) {
  const leafM = vmat('leaf'), rx = W / 2, rz = D / 2, col = o.f[0];
  b.add(vmat('bark'), tubeG([[0, 0, 0], [0, H * 0.2, 0]], Math.min(rx, rz) * 0.07, 6), '#6a5a48');
  if (shape === 'cone') {
    const g = new THREE.ConeGeometry(1, 1, 14, 6).toNonIndexed(), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + 0.07 * Math.sin(x * 9 + y * 7) * Math.sin(z * 8 + y * 5); p.setXYZ(i, x * rx * k, (y + 0.5) * H * 0.95 + H * 0.05, z * rz * k); }
    b.add(leafM, paintFoliage(g, col, rnd, { lo: -0.3 }));
    b.add(leafM, leafCloudG([0, H * 0.3, 0], [rx * 0.8, H * 0.3, rz * 0.8], 40, 0.06, rnd, { colors: [K.shade(col, 0.15), col], shell: 0.8, spread: 0.15 }));
  } else {
    b.add(leafM, paintFoliage(blobG(rx, H * 0.47, rz, 0, H * 0.53, 0, rnd, { detail: 2, amp: 0.05 }), col, rnd, { lo: -0.34 }));
    b.add(leafM, leafCloudG([0, H * 0.53, 0], [rx, H * 0.47, rz], 70, 0.06, rnd, { colors: [K.shade(col, 0.15), col], shell: 0.97, spread: 0.06 }));
  }
}
const SHRUB_BUILDERS = { spikes: spikeShrub, rosette: rosetteShrub, cactus: cactusShrub, grass: grassShrub, paddle: paddleShrub, fern: fernShrub, succulents: succulentShrub };
/** Resolve shrub colours: color → foliage, flowerColor (or color2) → flowers. */
function shrubLook(S, P) {
  const color = hexOf(P.color, null), fc = hexOf(P.flowerColor, null) || hexOf(P.color2, null);
  return { f: color ? [color, K.shade(color, 0.1), K.shade(color, -0.12)] : S.f, fl: S.fl ? { ...S.fl, c: fc || S.fl.c, c2: fc ? null : S.fl.c2 } : (fc && !S.kind ? { c: fc, mode: 'dots', n: 24, s: 0.03 } : null), custom: !!color };
}
/** Add a shrub of the given species to a batch, filling w × d × h (shared by shrubs, planters and hedges). */
function addShrub(b, species, shape, w, d, h, rnd, P = {}) {
  const S = SHRUBS[species] || SHRUBS.generic, look = shrubLook(S, P), sub = new Batch();
  if ((shape === 'ball' || shape === 'cone') && !S.kind) topiaryShrub(sub, shape, w, d, h, rnd, look);
  else (SHRUB_BUILDERS[S.kind] || moundShrub)(sub, S, w, d, h, rnd, look);
  b.merge(sub.fit(w, d, h));
}
registerModel('shrub', {
  build({ w, d, h, p, item }) {
    const P = params(p), species = oneOf(P.species, Object.keys(SHRUBS), 'generic'), b = new Batch();
    addShrub(b, species, oneOf(P.shape, ['natural', 'ball', 'cone'], 'natural'), w, d, h, K.rng(seedOf(item, species)), P);
    return b.build();
  },
  draw2d(ctx, { w, d, p, px, item }) {
    const P = params(p), species = oneOf(P.species, Object.keys(SHRUBS), 'generic');
    shrub2D(ctx, species, oneOf(P.shape, ['natural', 'ball', 'cone'], 'natural'), w / 2, d / 2, K.rng(seedOf(item, species)), px, P);
  },
});
/** Plan symbol of a shrub centred on the origin. */
function shrub2D(ctx, species, shape, rx, ry, rnd, px, P = {}) {
  const S = SHRUBS[species] || SHRUBS.generic, look = shrubLook(S, P), col = look.f[0], r = Math.min(rx, ry), fl = look.fl;
  if (shape !== 'natural' && !S.kind) {
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.fillStyle = rgba(col, 0.5); ctx.fill(); ctx.strokeStyle = rgba(K.shade(col, -0.45), 0.9); ctx.lineWidth = px * 1.2; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, rx * (shape === 'cone' ? 0.45 : 0.72), ry * (shape === 'cone' ? 0.45 : 0.72), 0, 0, TAU); ctx.lineWidth = px * 0.8; ctx.stroke();
    if (shape === 'cone') dot(ctx, 0, 0, Math.max(px, r * 0.06), rgba(K.shade(col, -0.5), 0.9));
  } else if (S.kind === 'rosette' || S.kind === 'grass' || S.kind === 'fern' || S.kind === 'paddle' || S.kind === 'spikes') {
    if (S.kind === 'spikes' || S.kind === 'grass') { ctx.beginPath(); ctx.ellipse(0, 0, rx * 0.8, ry * 0.8, 0, 0, TAU); ctx.fillStyle = rgba(S.kind === 'spikes' && fl ? mix(col, fl.c, 0.5) : col, 0.3); ctx.fill(); }
    const n = { rosette: S.n > 30 ? 22 : 14, grass: 26, fern: 12, paddle: 9, spikes: 24 }[S.kind], wk = { rosette: S.wid * 0.9, grass: 0.03, fern: 0.2, paddle: 0.22, spikes: 0.035 }[S.kind];
    fronds2D(ctx, rx, ry, n, col, rnd, px, wk);
    if (S.kind === 'spikes' && fl && r / px > 8) for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU + 0.1; dot(ctx, Math.cos(a) * rx * (i % 2 ? 0.74 : 0.92), Math.sin(a) * ry * (i % 2 ? 0.74 : 0.92), Math.max(px, r * 0.045), rgba(fl.c, 0.9)); }
    if (S.stalk || S.kind === 'paddle') dot(ctx, 0, 0, Math.max(1.2 * px, r * 0.09), rgba(fl ? fl.c : S.stalk, 0.95));
  } else if (S.kind === 'cactus') {
    for (const [x, y, k] of [[-0.32, -0.2, 0.3], [0.02, 0.24, 0.24], [-0.5, 0.6, 0.2]]) { ctx.save(); ctx.translate(x * rx, y * ry); fronds2D(ctx, rx * k, ry * k, 8, col, rnd, px, 0.3); ctx.restore(); }
    for (const [x, y, k] of [[0.5, 0.1, 0.42], [0.3, -0.5, 0.3]]) { ctx.beginPath(); ctx.ellipse(x * rx, y * ry, rx * k, ry * k * 0.5, 0.6, 0, TAU); ctx.fillStyle = rgba(look.f[1], 0.45); ctx.fill(); ctx.strokeStyle = rgba(K.shade(col, -0.45), 0.85); ctx.lineWidth = px; ctx.stroke(); }
  } else if (S.kind === 'succulents') {
    const n = 7;
    for (let i = 0; i < n; i++) { const a = i * 2.39996, k = i === 0 ? 0 : 0.35 + 0.5 * Math.sqrt(i / n), rr = i === 0 ? 0.42 : 0.26; ctx.save(); ctx.translate(Math.cos(a) * rx * k, Math.sin(a) * ry * k); fronds2D(ctx, rx * rr, ry * rr, 9, look.f[i % look.f.length], rnd, px, 0.4); ctx.restore(); }
  } else {
    const cover = fl && fl.mode === 'cover';
    canopy2D(ctx, rx, ry, cover ? mix(col, fl.c, 0.6) : col, rnd, px, { accent: fl ? fl.c : null, dots: fl ? (fl.mode === 'dots' ? 18 : 11) : 0, dotR: fl && (fl.mode === 'star' || fl.mode === 'rose') ? 0.085 : 0.06, clumps: 5, alpha: 0.4, lobes: Math.round(clamp(7 + r / 12, 8, 14)) });
    dot(ctx, 0, 0, Math.max(px, Math.min(r * 0.05, 3)), rgba(K.shade(col, -0.55), 0.8));
  }
}

// ═════════════════════════════════ 7. hedge ═════════════════════════════════
const HEDGES = {
  ficus: { f: ['#2f632c', '#3a7034', '#285526'] }, myrtle: { f: ['#33602f', '#3f6c38', '#2a5028'], fl: '#f4f1e4', flN: 5 }, pittosporum: { f: ['#6a9a55', '#7aa862', '#5a8a48'], lc: ['#cfe0a8', '#8fba6a'] },
  cypress: { f: ['#2f4f33', '#3a5c3b', '#263f2a'], natural: true }, bamboo: { f: ['#6f9a45', '#82aa52', '#5c8a3c'], natural: true }, duranta: { f: ['#a8c040', '#b8cc4c', '#94ac38'], fl: '#8f7ae0', flN: 6 },
  bougainvillea: { f: ['#4a7a38', '#5a8a42'], fl: '#c8287f', flN: 60, natural: true }, generic: { f: ['#3f7436', '#4c8240', '#34642e'] },
};
/** Clump of bamboo canes with leaf tufts filling w × d × h. */
function bambooCanes(b, W, D, H, rnd, f, trimmed) {
  const n = clamp(Math.round((W / 0.065) * Math.max(1, D / 0.35)), 5, 110), fm = vmat('leaf');
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * W * 0.9, z = (rnd() - 0.5) * D * 0.7, hh = H * (trimmed ? 0.9 + rnd() * 0.06 : 0.68 + rnd() * 0.3), r = 0.008 + rnd() * 0.008, lx = (rnd() - 0.5) * 0.12 * hh, lz = (rnd() - 0.5) * 0.08 * hh;
    b.add(vmat('satin'), paintY(tubeG([[x, 0, z], [x + lx * 0.3, hh * 0.5, z + lz * 0.3], [x + lx, hh, z + lz]], [r, r * 0.9, r * 0.5], 5), '#8a9a48', rnd() < 0.3 ? '#c8b860' : '#7fa04a', 0, hh));
    for (let q = 0; q < 2; q++) { const t = 0.5 + rnd() * 0.5; b.add(fm, leafCloudG([x + lx * t * t, hh * t, z + lz * t * t], [Math.min(0.22, W * 0.3), 0.16, Math.min(0.2, D * 0.4)], 6, 0.16, rnd, { aspect: 0.2, hang: 0.55, colors: f, shell: 0.3, spread: 0.8 })); }
  }
}
registerModel('hedge', {
  build({ w, d, h, p, item }) {
    const P = params(p), species = oneOf(P.species, Object.keys(HEDGES), 'generic'), S = HEDGES[species], rnd = K.rng(seedOf(item, species)), b = new Batch(), leafM = vmat('leaf');
    const color = hexOf(P.color, null), f = color ? [color, K.shade(color, 0.1), K.shade(color, -0.12)] : S.f, fl = S.fl ? hexOf(P.color2, S.fl) : null;
    const trimmed = P.trimmed == null ? !S.natural : !(P.trimmed === false || P.trimmed === 'false' || P.trimmed === 0);
    if (species === 'bamboo') bambooCanes(b, w, d, h, rnd, f, trimmed);
    else if (species === 'cypress') {
      const n = Math.max(1, Math.round(w / Math.max(0.45, d * 0.9))), cw = w / n;
      for (let i = 0; i < n; i++) { const sub = new Batch(), hh = h * (trimmed ? 1 : 0.9 + rnd() * 0.1); columnTree(sub, TREES.cypress, cw * 1.12, d, hh, rnd, { look: { f, bark: '#5a4a3c' }, young: false }); b.merge(sub.fit(cw * 1.12, d, hh), -w / 2 + (i + 0.5) * cw); }
    } else if (trimmed) {
      const sx = clamp(Math.round(w / 0.22), 2, 64), sy = clamp(Math.round(h / 0.24), 2, 10), sz = clamp(Math.round(d / 0.2), 2, 6);
      const gi = new THREE.BoxGeometry(w, h, d, sx, sy, sz).translate(0, h / 2, 0), a = gi.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) {
        const x = a[i], y = a[i + 1], z = a[i + 2], n1 = 0.5 + 0.5 * Math.sin(x * 9.1 + y * 3.3) * Math.sin(y * 7.3 + z * 4.1) * Math.sin(z * 8.7 + x * 2.9), amt = 0.012 + 0.05 * n1;
        const ex = Math.pow(Math.abs(x) / (w / 2), 8), ez = Math.pow(Math.abs(z) / (d / 2), 8), ey = Math.pow(y / h, 8), round = 0.05 * ey;
        a[i] = x - Math.sign(x) * (amt * ex + round * ex); a[i + 2] = z - Math.sign(z) * (amt * ez + round * ez); a[i + 1] = y - amt * ey * 0.7 - 0.03 * ey * Math.max(ex, ez);
      }
      gi.computeVertexNormals();
      b.add(leafM, paintFoliage(gi.toNonIndexed(), f[0], rnd, { lo: -0.3, hi: 0.1, sparkle: 0.07 }));
      const area = w * d + 2 * w * h + 2 * d * h;
      b.add(leafM, leafBoxG(w * 0.99, h * 0.99, d * 0.99, clamp(Math.round(area * 55), 30, 700), 0.075, rnd, { colors: S.lc || [f[1], K.shade(f[1], 0.14), f[2]], aspect: 0.55 }));
      if (fl) b.add(leafM, leafBoxG(w, h, d, clamp(Math.round(area * S.flN), 4, 300), 0.06, rnd, { colors: [fl, K.shade(fl, 0.2)], aspect: 0.9 }));
    } else {
      const n = Math.max(1, Math.round(w / Math.max(0.4, d * 0.95))), cw = w / n;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (i + 0.5) * cw + (rnd() - 0.5) * cw * 0.2, hh = h * (0.82 + rnd() * 0.18);
        for (let j = 0; j < 4; j++) {
          const main = j < 2, bx = cw * (main ? 0.66 : 0.48), by = hh * (main ? 0.33 : 0.26), ox = main ? (j ? (rnd() - 0.5) * cw * 0.25 : 0) : (j === 2 ? -1 : 1) * cw * 0.32, y = main ? hh * (j ? 0.68 : 0.32) : hh * (0.35 + rnd() * 0.4), z = main ? 0 : (rnd() - 0.5) * d * 0.3, bz = d * (main ? 0.5 : 0.36);
          const flower = fl && rnd() < (S.flN > 20 ? 0.6 : 0), col = flower ? K.shade(fl, (rnd() - 0.5) * 0.2) : f[Math.floor(rnd() * f.length)];
          b.add(leafM, paintFoliage(blobG(bx, by, bz, x + ox, y, z, rnd, { detail: 1, amp: 0.2, floor: 0 }), col, rnd, { lo: flower ? -0.2 : -0.36, ao: lerp(0.85, 1.05, y / hh) }));
          b.add(leafM, leafCloudG([x + ox, y, z], [bx, by, bz], main ? 14 : 9, 0.1, rnd, { colors: flower ? [fl, K.shade(fl, 0.2)] : S.lc || [f[1], K.shade(f[1], 0.14)], aspect: 0.6, up: true }));
        }
      }
    }
    return b.fit(w, d, h).build();
  },
  draw2d(ctx, { w, d, p, px, item }) {
    const P = params(p), species = oneOf(P.species, Object.keys(HEDGES), 'generic'), S = HEDGES[species], col = hexOf(P.color, S.f[0]), fl = S.fl ? hexOf(P.color2, S.fl) : null, rnd = K.rng(seedOf(item, species));
    const trimmed = P.trimmed == null ? !S.natural : !(P.trimmed === false || P.trimmed === 'false');
    const dark = rgba(K.shade(col, -0.45), 0.9), fill = rgba(fl && S.flN > 20 ? mix(col, fl, 0.5) : col, 0.42);
    if (species === 'cypress') {
      const n = Math.max(1, Math.round(w / Math.max(45, d * 0.9))), cw = w / n;
      for (let i = 0; i < n; i++) { ctx.save(); ctx.translate(-w / 2 + (i + 0.5) * cw, 0); canopy2D(ctx, cw * 0.56, d / 2, col, rnd, px, { alpha: 0.55, clumps: 0, lobes: 9 }); dot(ctx, 0, 0, Math.max(px, d * 0.06), dark); ctx.restore(); }
      return;
    }
    const n = Math.max(2, Math.round(w / (d * (trimmed ? 0.5 : 0.8)))), m = Math.max(1, Math.round(d / (w / n))), dep = Math.min(d * (trimmed ? 0.07 : 0.14), w / n / 3), sx = w / n, sy = d / m;
    ctx.beginPath(); ctx.moveTo(-w / 2 + dep, -d / 2 + dep);
    for (let i = 0; i < n; i++) ctx.quadraticCurveTo(-w / 2 + (i + 0.5) * sx, -d / 2 - dep, i === n - 1 ? w / 2 - dep : -w / 2 + (i + 1) * sx, -d / 2 + dep);
    for (let j = 0; j < m; j++) ctx.quadraticCurveTo(w / 2 + dep, -d / 2 + (j + 0.5) * sy, w / 2 - dep, j === m - 1 ? d / 2 - dep : -d / 2 + (j + 1) * sy);
    for (let i = n - 1; i >= 0; i--) ctx.quadraticCurveTo(-w / 2 + (i + 0.5) * sx, d / 2 + dep, i === 0 ? -w / 2 + dep : -w / 2 + i * sx, d / 2 - dep);
    for (let j = m - 1; j >= 0; j--) ctx.quadraticCurveTo(-w / 2 - dep, -d / 2 + (j + 0.5) * sy, -w / 2 + dep, j === 0 ? -d / 2 + dep : -d / 2 + j * sy);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = dark; ctx.lineWidth = px * 1.2; ctx.lineJoin = 'round'; ctx.stroke();
    if (d / px > 10) {
      ctx.strokeStyle = rgba(K.shade(col, -0.4), 0.4); ctx.lineWidth = px * 0.8;
      if (species === 'bamboo') { for (let i = 0; i < Math.min(160, w / 7); i++) dot(ctx, (rnd() - 0.5) * w * 0.9, (rnd() - 0.5) * d * 0.6, Math.max(px * 0.8, 1.1), rgba('#7a8a40', 0.9)); }
      else if (trimmed) { ctx.beginPath(); ctx.moveTo(-w / 2 + d * 0.3, 0); ctx.lineTo(w / 2 - d * 0.3, 0); ctx.setLineDash([d * 0.25, d * 0.18]); ctx.stroke(); ctx.setLineDash([]); }
      else for (let i = 0; i < n; i++) { scallopPath(ctx, -w / 2 + (i + 0.5) * sx, 0, sx * 0.4, d * 0.3, 6, 0.15, rnd, rnd() * 3); ctx.stroke(); }
      if (fl) for (let i = 0; i < Math.min(120, (w / d) * (S.flN > 20 ? 9 : 3)); i++) dot(ctx, (rnd() - 0.5) * w * 0.92, (rnd() - 0.5) * d * 0.8, Math.max(px, d * 0.05), rgba(fl, 0.9));
    }
  },
});

// ═════════════════════════════════ 8. beds, planters, raised beds ═════════════════════════════════
const FLOWER_COLORS = ['#e8303a', '#f2c63a', '#f08aa8', '#ffffff', '#8a6fd0', '#f08a2a'];
/** Small low-poly plants for beds: kind ∈ tuft | spikes | grass | rosette | rock | cactus | lettuce | tomato | mat | berry. */
function miniPlant(b, kind, x, y, z, r, hgt, rnd, c, fl, lod) {
  const leafM = vmat('leaf'), fm = vmat('frond'), det = lod ? 0 : 1;
  const flowers = (n, top, spread, s) => { if (!fl) return; const tri = []; for (let i = 0; i < n; i++) { const a = rnd() * TAU, k = Math.sqrt(rnd()) * spread, q = [x + Math.cos(a) * k, y + top * (0.82 + rnd() * 0.2), z + Math.sin(a) * k]; tri.push(...budG([q[0], q[1] - s, q[2]], [q[0], q[1] + s * 0.6, q[2]], s)); } b.add(fm, paintFoliage(trisG(tri), fl, rnd, { lo: -0.1, hi: 0.15, sparkle: 0.2 })); };
  switch (kind) {
    case 'rock': b.add(vmat('flat'), paintFoliage(blobG(r, hgt * 0.7, r * 0.8, x, y + hgt * 0.3, z, rnd, { detail: 1, amp: 0.3, floor: y }), c, rnd, { lo: -0.25, hi: 0.1 })); break;
    case 'grass': bladeFan(b, fm, [x, y, z], lod ? 9 : 16, hgt * 1.05, rnd, { wid: 0.09, el0: 1.5, el1: 0.85, curve: 1.1, colors: [c, K.shade(c, 0.12)], segs: 2, fold: 0.3 }); break;
    case 'rosette': bladeFan(b, fm, [x, y, z], lod ? 7 : 11, Math.max(r * 1.1, hgt), rnd, { wid: 0.28, el0: 1.3, el1: 0.2, curve: 0.3, colors: [c, K.shade(c, 0.1)], segs: 2, fold: -0.3, profile: lanceolate }); break;
    case 'spikes': {
      b.add(leafM, paintFoliage(blobG(r * 0.8, hgt * 0.35, r * 0.8, x, y + hgt * 0.3, z, rnd, { detail: det, amp: 0.25, floor: y }), c, rnd));
      const g = [], f2 = [];
      for (let i = 0; i < (lod ? 6 : 10); i++) { const a = rnd() * TAU, el = 0.7 + rnd() * 0.8, p1 = [x + Math.cos(a) * Math.cos(el) * r, y + Math.sin(el) * hgt, z + Math.sin(a) * Math.cos(el) * r], p0 = [lerp(x, p1[0], 0.3), y + hgt * 0.25, lerp(z, p1[2], 0.3)], pm = lerp3(p0, p1, 0.6); g.push(...spikeG(p0, pm, 0.008)); f2.push(...budG(pm, p1, 0.013)); }
      b.add(fm, paintFoliage(trisG(g), K.shade(c, 0.1), rnd)); b.add(fm, paintFoliage(trisG(f2), fl || '#8a6fd0', rnd, { lo: -0.1 }));
      break;
    }
    case 'cactus': b.add(vmat('flat'), tubeG([[x, y, z], [x, y + hgt * 0.85, z]], r * 0.7, 10, { flute: 0.14, lobes: 5 }), c); b.add(vmat('flat'), blobG(r * 0.7, r * 0.6, r * 0.7, x, y + hgt * 0.85, z, rnd, { detail: 0, amp: 0.03 }), K.shade(c, 0.08)); break;
    case 'lettuce': bladeFan(b, fm, [x, y, z], lod ? 6 : 9, r * 1.15, rnd, { wid: 0.6, el0: 1.2, el1: 0.25, curve: 0.5, colors: [c, K.shade(c, 0.15)], segs: 2, fold: -0.2, profile: lanceolate }); b.add(leafM, paintFoliage(blobG(r * 0.45, hgt * 0.5, r * 0.45, x, y + hgt * 0.4, z, rnd, { detail: 0, amp: 0.2 }), K.shade(c, 0.2), rnd)); break;
    case 'tomato': {
      b.add(vmat('matte'), cylG(0.008, 0.008, hgt, x, y, z, 4), '#b89a6a');
      for (let i = 0; i < 3; i++) b.add(leafM, paintFoliage(blobG(r * (0.9 - i * 0.15), hgt * 0.22, r * (0.9 - i * 0.15), x + (rnd() - 0.5) * r * 0.3, y + hgt * (0.3 + i * 0.25), z + (rnd() - 0.5) * r * 0.3, rnd, { detail: det, amp: 0.3 }), c, rnd));
      for (let i = 0; i < (lod ? 3 : 6); i++) { const a = rnd() * TAU; b.add(vmat('satin'), blobG(0.022, 0.022, 0.022, x + Math.cos(a) * r * 0.75, y + hgt * (0.25 + rnd() * 0.5), z + Math.sin(a) * r * 0.75, rnd, { detail: 0, amp: 0, facet: 0 }), fl || '#e03a2a'); }
      break;
    }
    case 'mat': b.add(leafM, paintFoliage(blobG(r * 1.25, hgt * 0.8, r * 1.25, x, y + hgt * 0.25, z, rnd, { detail: det, amp: 0.3, floor: y }), c, rnd, { lo: -0.2 })); flowers(lod ? 4 : 7, hgt * 0.95, r, 0.012); break;
    case 'berry': bladeFan(b, fm, [x, y, z], lod ? 6 : 9, r * 1.1, rnd, { wid: 0.55, el0: 1.1, el1: 0.3, curve: 0.5, colors: [c, K.shade(c, 0.12)], segs: 2, fold: 0.1, profile: lanceolate }); for (let i = 0; i < 4; i++) { const a = rnd() * TAU; b.add(vmat('satin'), blobG(0.014, 0.018, 0.014, x + Math.cos(a) * r * 0.7, y + 0.03, z + Math.sin(a) * r * 0.7, rnd, { detail: 0, amp: 0, facet: 0 }), i % 4 ? '#d8242c' : '#f4f1e4'); } break;
    default:
      b.add(leafM, paintFoliage(blobG(r, hgt * 0.5, r, x, y + hgt * 0.45, z, rnd, { detail: det, amp: 0.2, floor: y }), c, rnd));
      if (!lod) b.add(leafM, leafCloudG([x, y + hgt * 0.45, z], [r, hgt * 0.5, r], 12, 0.07, rnd, { colors: [K.shade(c, 0.15)], up: true }));
      flowers(lod ? 4 : 7, hgt, r * 0.8, Math.max(0.014, r * 0.13));
  }
}
const G1 = '#4f8a3c', G2 = '#3f7436', G3 = '#6a9a50';
/** Planting schemes: sp spacing (m) · mulch default · plants [kind, radius m, relative height, colour, flower ('F' = from flowerColors)]. */
const BEDS = {
  mixed: { sp: 0.36, mulch: 'bark', plants: [['tuft', 0.17, 0.5, G1, 'F'], ['spikes', 0.16, 0.6, '#8a9a80', '#8a6fd0'], ['grass', 0.16, 1, '#8aa860'], ['tuft', 0.2, 0.8, G2, 'F'], ['rosette', 0.14, 0.4, '#7f9c8c'], ['tuft', 0.13, 0.35, G3, 'F']] },
  flowers: { sp: 0.26, mulch: 'soil', plants: [['tuft', 0.12, 0.6, G1, 'F'], ['tuft', 0.1, 0.45, G3, 'F'], ['tuft', 0.13, 0.8, G2, 'F'], ['spikes', 0.1, 1, G1, 'F']] },
  succulents: { sp: 0.3, mulch: 'gravel', plants: [['rosette', 0.13, 0.5, '#7f9c8c'], ['rosette', 0.1, 0.35, '#9a6a7a'], ['tuft', 0.1, 0.3, '#a8c070'], ['rock', 0.12, 0.4, '#a8a39a'], ['cactus', 0.06, 1, '#5c8854'], ['rosette', 0.16, 0.7, '#6f9a5a']] },
  herbs: { sp: 0.3, mulch: 'soil', plants: [['tuft', 0.13, 0.6, '#5c9a3c'], ['spikes', 0.13, 1, '#4f6a4a', '#9aa8e0'], ['tuft', 0.14, 0.4, '#7a9a6a'], ['spikes', 0.12, 0.8, '#8a9a80', '#8a6fd0'], ['grass', 0.1, 0.7, '#4f8a3a']] },
  vegetables: { sp: 0.34, mulch: 'soil', rows: true, plants: [['lettuce', 0.14, 0.3, '#8fc050'], ['tomato', 0.15, 1, '#4f8a3a', '#e03a2a'], ['tuft', 0.15, 0.45, '#3f7a4a'], ['grass', 0.09, 0.5, '#5c9a4a'], ['lettuce', 0.15, 0.35, '#7a4a6a'], ['tomato', 0.14, 0.8, '#4f8a3a', '#f0c030']] },
  grasses: { sp: 0.42, mulch: 'gravel', plants: [['grass', 0.2, 1, '#8aa860'], ['grass', 0.17, 0.7, '#b8b070'], ['grass', 0.14, 0.5, '#7a9a8a'], ['grass', 0.2, 0.85, '#9a7a5a']] },
  groundcover: { sp: 0.24, mulch: 'bark', plants: [['mat', 0.16, 1, '#4f8a3c', 'F'], ['mat', 0.15, 0.8, '#5c9a46'], ['mat', 0.14, 0.9, '#6a9a5a', 'F']] },
  'rock-garden': { sp: 0.36, mulch: 'gravel', plants: [['rock', 0.16, 0.7, '#a8a39a'], ['rosette', 0.12, 0.5, '#7f9c8c'], ['grass', 0.12, 1, '#b8b070'], ['rock', 0.1, 0.4, '#8f8a82'], ['tuft', 0.1, 0.4, '#6f9a5a', 'F'], ['rock', 0.22, 0.9, '#b5aea2'], ['spikes', 0.12, 0.8, '#8a9a80', '#8a6fd0']] },
  strawberries: { sp: 0.28, mulch: 'soil', rows: true, plants: [['berry', 0.13, 1, '#4f8a3a']] },
  empty: { sp: 1, mulch: 'soil', plants: [] },
};
/**
 * Deterministic planting plan for a w × d patch (metres): constant density, jittered grid (or straight crop rows).
 * → [{ x, z, kind, r, hk, c, fl }]; the same list drives the 3D model and the plan symbol.
 */
function plantPlan(scheme, w, d, rnd, flowerColors) {
  const B = BEDS[scheme] || BEDS.mixed, out = [];
  if (!B.plants.length || w < 0.12 || d < 0.12) return out;
  let sp = B.sp; const count = (w / sp) * (d / sp); if (count > 420) sp *= Math.sqrt(count / 420);
  const nx = Math.max(1, Math.round(w / sp)), nz = Math.max(1, Math.round(d / sp)), along = w >= d;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const jit = B.rows ? 0.12 : 0.7, row = along ? j : i, pl = B.plants[B.rows ? row % B.plants.length : Math.floor(rnd() * B.plants.length)];
    const r = Math.min(pl[1] * (0.85 + rnd() * 0.3), w / 2, d / 2), x = clamp(-w / 2 + (i + 0.5 + (rnd() - 0.5) * jit) * (w / nx), -w / 2 + r, w / 2 - r), z = clamp(-d / 2 + (j + 0.5 + (rnd() - 0.5) * jit) * (d / nz), -d / 2 + r, d / 2 - r);
    out.push({ x, z, kind: pl[0], r, hk: pl[2] * (0.85 + rnd() * 0.25), c: pl[3], fl: pl[4] === 'F' ? flowerColors[Math.floor(rnd() * flowerColors.length)] : pl[4] });
  }
  return out;
}
/** Build the plants of a plan into a batch whose tallest point is `top` and which stays inside w × d. */
function plantsBatch(plan, w, d, top, rnd) {
  const pb = new Batch(), lod = plan.length > 70;
  for (const q of plan) miniPlant(pb, q.kind, q.x, 0, q.z, q.r, Math.max(0.05, top * q.hk), rnd, q.c, q.fl, lod);
  return pb.settle(top, w, d);
}
function plants2D(ctx, plan, px) {
  for (const q of plan) {
    const x = q.x * 100, y = q.z * 100, r = q.r * 100;
    if (r / px < 1.2) continue;
    ctx.save(); ctx.translate(x, y);
    if (q.kind === 'rock') { ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.8, q.hk * 3, 0, TAU); ctx.fillStyle = K.tint(q.c, 0.3); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px * 0.8; ctx.stroke(); }
    else if (['grass', 'rosette', 'lettuce', 'berry', 'spikes'].includes(q.kind) && r / px > 5) fronds2D(ctx, r, r, q.kind === 'grass' ? 10 : 7, q.kind === 'spikes' && q.fl ? mix(q.c, q.fl, 0.5) : q.c, K.rng(Math.round(x * 7 + y * 13) + 5), px, q.kind === 'grass' || q.kind === 'spikes' ? 0.06 : 0.3);
    else { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = rgba(q.c, 0.5); ctx.fill(); ctx.strokeStyle = rgba(K.shade(q.c, -0.45), 0.8); ctx.lineWidth = px * 0.8; ctx.stroke(); }
    if (q.fl && q.kind !== 'spikes' && r / px > 2.5) dot(ctx, 0, 0, Math.max(px, r * (q.kind === 'tomato' ? 0.3 : 0.42)), rgba(q.fl, 0.95));
    ctx.restore();
  }
}
const EDGING = { stone: 0.1, steel: 0.005, wood: 0.028, brick: 0.1, none: 0 };
function bedSetup(P, w, d, h, item) {
  const variant = oneOf(P.variant, Object.keys(BEDS).filter((k) => k !== 'empty' && k !== 'strawberries'), 'mixed'), edging = oneOf(P.edging, Object.keys(EDGING), 'none');
  const mulch = oneOf(P.mulch, ['bark', 'tuff', 'gravel', 'soil'], BEDS[variant].mulch), ew = Math.min(EDGING[edging], w * 0.2, d * 0.2);
  const cols = Array.isArray(P.flowerColors) ? P.flowerColors.map((c) => hexOf(c, null)).filter(Boolean) : [];
  const rnd = K.rng(seedOf(item, 'bed' + variant)), iw = w - 2 * ew, id = d - 2 * ew;
  return { variant, edging, mulch, ew, iw, id, rnd, plan: plantPlan(variant, iw - 0.04, id - 0.04, rnd, cols.length ? cols : FLOWER_COLORS), ground: surfaceOpts(mulch, {}) };
}
/** Edging ring around a w × d rectangle, top at height eh. */
function addEdging(b, kind, w, d, ew, eh, rnd, color) {
  if (kind === 'none' || ew <= 0) return;
  if (kind === 'steel' || kind === 'wood') {
    const [m, c] = kind === 'steel' ? [vmat('matte'), color || '#6a4a38'] : [K.wood(color || '#9a7448'), null];
    b.add(m, boxOnG(w, eh, ew, 0, 0, d / 2 - ew / 2), c); b.add(m, boxOnG(w, eh, ew, 0, 0, -d / 2 + ew / 2), c);
    b.add(m, boxOnG(ew, eh, d - 2 * ew, w / 2 - ew / 2, 0, 0), c); b.add(m, boxOnG(ew, eh, d - 2 * ew, -w / 2 + ew / 2, 0, 0), c);
    return;
  }
  const brick = kind === 'brick', len = brick ? 0.2 : 0.16, run = (L, place) => { const n = Math.max(1, Math.round(L / len)), s = L / n; for (let i = 0; i < n; i++) place(-L / 2 + (i + 0.5) * s, s); };
  const unit = (x, z, sx, sz) => {
    if (brick) b.add(vmat('matte'), boxOnG(sx - 0.008, eh * (0.92 + rnd() * 0.08), sz - 0.008, x, 0, z), K.shade(color || '#a8563c', (rnd() - 0.5) * 0.25));
    else { const g = blobG(sx * 0.52, eh * 0.62, sz * 0.52, x, eh * 0.45, z, rnd, { detail: 1, amp: 0.16, floor: 0 }), a = g.attributes.position.array; for (let i = 0; i < a.length; i += 3) { a[i] = clamp(a[i], -w / 2, w / 2); a[i + 1] = Math.min(a[i + 1], eh); a[i + 2] = clamp(a[i + 2], -d / 2, d / 2); } b.add(vmat('flat'), paintFoliage(g, K.shade(color || '#b5ada0', (rnd() - 0.5) * 0.2), rnd, { lo: -0.2, hi: 0.1 })); }
  };
  run(w, (x, s) => { unit(x, d / 2 - ew / 2, s, ew); unit(x, -d / 2 + ew / 2, s, ew); });
  run(d - 2 * ew, (z, s) => { unit(w / 2 - ew / 2, z, ew, s); unit(-w / 2 + ew / 2, z, ew, s); });
}
const rectPts = (w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
registerModel('flower-bed', {
  build({ w, d, h, p, item }) {
    const P = params(p), S = bedSetup(P, w, d, h, item), b = new Batch(), bh = Math.min(0.05, h * 0.5), eh = Math.min(h, S.edging === 'steel' ? 0.09 : S.edging === 'wood' ? 0.12 : 0.085);
    const G = addGround(b, rectPts(S.iw, S.id), bh, S.ground);
    b.add(vmat('matte'), wallG(rectPts(w - (S.ew ? 0.002 : 0), d - (S.ew ? 0.002 : 0)), 0, bh), G.avg);
    addEdging(b, S.edging, w, d, S.ew, eh, S.rnd, hexOf(P.color, null));
    if (S.plan.length) b.merge(plantsBatch(S.plan, S.iw, S.id, h - bh, S.rnd), 0, bh, 0);
    else b.add(vmat('matte'), boxOnG(0.02, h, 0.02, 0, 0, 0), G.avg);
    return b.build();
  },
  draw2d(ctx, { w, d, h, p, px, item }) {
    const P = params(p), S = bedSetup(P, w / 100, d / 100, h / 100, item), ew = S.ew * 100;
    K.rr(ctx, 0, 0, w, d, Math.min(4, w / 8, d / 8));
    ctx.fillStyle = groundFill2D(ctx, S.ground, px, -w / 2, -d / 2); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke();
    if (ew / px > 1.5) { ctx.fillStyle = { stone: '#d6d0c4', brick: '#d0a090', wood: '#c9a878', steel: '#7a6a5a' }[S.edging] || '#ccc'; ctx.beginPath(); ctx.rect(-w / 2, -d / 2, w, d); ctx.rect(-w / 2 + ew, -d / 2 + ew, w - 2 * ew, d - 2 * ew); ctx.fill('evenodd'); ctx.strokeRect(-w / 2 + ew, -d / 2 + ew, w - 2 * ew, d - 2 * ew); }
    else if (S.edging !== 'none') { ctx.lineWidth = px * 2.2; ctx.strokeStyle = S.edging === 'steel' ? '#6a4a38' : '#9a7448'; ctx.strokeRect(-w / 2, -d / 2, w, d); }
    plants2D(ctx, S.plan, px);
  },
});

// ── planters ──
const POT_SHAPES = ['round', 'square', 'rect', 'bowl', 'tall', 'trough', 'hanging', 'wall'];
const POT_PLANTS = ['none', 'shrub', 'flowers', 'palm', 'olive', 'citrus', 'cactus', 'succulents', 'herbs', 'grass', 'topiary', 'bamboo', 'bougainvillea'];
const POT_PROFILES = {
  round: [[0.001, 0], [0.66, 0], [0.7, 0.02], [0.94, 0.84], [1, 0.85], [1, 1]],
  bowl: [[0.001, 0], [0.42, 0], [0.5, 0.03], [0.76, 0.3], [0.93, 0.66], [1, 0.97], [1, 1]],
  tall: [[0.001, 0], [0.6, 0], [0.64, 0.01], [0.74, 0.4], [0.9, 0.8], [1, 0.985], [1, 1]],
};
function planterSetup(P, w, d, h) {
  const shape = oneOf(P.shape, POT_SHAPES, 'round'), plant = oneOf(P.plant, POT_PLANTS, 'shrub');
  const material = typeof P.material === 'string' ? P.material : { round: 'terracotta', bowl: 'ceramic', tall: 'fibre-clay', square: 'concrete', rect: 'fibre-clay', trough: 'fibre-clay', hanging: 'rattan', wall: 'terracotta' }[shape];
  const hanging = shape === 'hanging', maxPot = hanging ? Math.min(h * 0.4, w * 0.6) : h;
  let ph = plant === 'none' ? 0 : num(P.plantHeight, -1, 0, 2000) / 100;
  if (plant !== 'none' && ph <= 0) ph = hanging ? maxPot * 0.9 : h * 0.55;
  const potH = hanging ? Math.max(0.04, maxPot) : clamp(h - ph, Math.min(h, Math.max(0.05, h * 0.18)), h);
  return { shape, plant, material, hanging, potH, ph: hanging ? Math.min(ph, h - potH - 0.05) : h - potH, t: clamp(Math.min(w, d) * 0.07, 0.008, 0.035) };
}
/** Plant standing on the soil of a pot: fills pw × pd × ph and starts at y = 0 of the returned batch. */
function potPlant(kind, pw, pd, ph, rnd, P) {
  const pb = new Batch();
  const tree = (sp, o) => { const S = TREES[sp]; broadleaf(pb, S, pw, pd, ph, rnd, { young: true, fruit: !!o.fruit, look: treeLook(S, {}), P: {} }); pb.fit(pw, pd, ph); };
  switch (kind) {
    case 'flowers': addShrub(pb, 'geranium', 'natural', pw, pd, ph, rnd, { flowerColor: P.flowerColor || P.color2 }); break;
    case 'palm': bladeFan(pb, vmat('frond'), [0, 0, 0], 12, ph * 1.05, rnd, { wid: 0.2, el0: 1.55, el1: 1.05, curve: 0.75, colors: TREES['date-palm'].f.map((c) => K.shade(c, 0.05)), segs: 7, fold: 0.3, profile: (t) => (t < 0.25 ? 0.08 : lanceolate((t - 0.25) / 0.75) * (0.6 + 0.4 * Math.abs(Math.sin(t * 30)))) }); pb.fit(pw, pd, ph); break;
    case 'olive': tree('olive', {}); break;
    case 'citrus': tree('lemon', { fruit: true }); break;
    case 'cactus': addShrub(pb, 'cactus', 'natural', pw, pd, ph, rnd); break;
    case 'succulents': addShrub(pb, 'succulent-mix', 'natural', pw, pd, ph, rnd); break;
    case 'herbs': addShrub(pb, 'rosemary', 'natural', pw, pd, ph, rnd); break;
    case 'grass': addShrub(pb, 'ornamental-grass', 'natural', pw, pd, ph, rnd); break;
    case 'topiary': addShrub(pb, 'myrtle', 'ball', pw, pd, ph, rnd); break;
    case 'bamboo': bambooCanes(pb, pw, pd, ph, rnd, HEDGES.bamboo.f, false); pb.fit(pw, pd, ph); break;
    case 'bougainvillea': addShrub(pb, 'bougainvillea', 'natural', pw, pd, ph, rnd, { flowerColor: P.flowerColor || P.color2 }); break;
    default: addShrub(pb, 'pittosporum', 'natural', pw, pd, ph, rnd);
  }
  return pb;
}
registerModel('planter', {
  build({ w, d, h, p, item }) {
    const P = params(p), S = planterSetup(P, w, d, h), rnd = K.rng(seedOf(item, 'planter' + S.shape + S.plant)), b = new Batch();
    const [m, c] = bodyMat(S.material, hexOf(P.color, null)), H = S.potH, t = S.t, soilY = H - Math.min(0.035, H * 0.25), SOIL = '#3d2b1f';
    const lathe = (prof, phi0, phiLen, rxy, rz) => {
      const outer = prof.map(([r, y]) => [r, y * H]), lip = [[1 - t / rxy, H], [1 - t / rxy - 0.02, soilY - 0.01]];
      const g = new THREE.LatheGeometry([...outer, ...lip].map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y)), phiLen < 6 ? 14 : 28, phi0, phiLen);
      return g.scale(rxy, 1, rz);
    };
    if (S.shape === 'round' || S.shape === 'bowl' || S.shape === 'tall' || S.hanging) {
      b.add(m, lathe(POT_PROFILES[S.hanging ? 'bowl' : S.shape], 0, TAU, w / 2, d / 2), c);
      b.add(vmat('matte'), flatG(ellipsePts(w / 2 - t, d / 2 - t, 24), soilY), SOIL);
      if (S.hanging) {
        const mm = K.metal('#3a3d42'), topY = h - 0.03;
        for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + 0.5; b.add(mm, barG([Math.cos(a) * (w / 2 - t / 2), H, Math.sin(a) * (d / 2 - t / 2)], [0, topY, 0], 0.0025, 4)); }
        b.add(mm, new THREE.TorusGeometry(0.012, 0.003, 5, 12).translate(0, h - 0.015, 0));
      }
    } else if (S.shape === 'wall') {
      const g = lathe(POT_PROFILES.round, -Math.PI / 2, Math.PI, w / 2, d).translate(0, 0, -d / 2);
      b.add(m, g, c); b.add(m, boxOnG(w, H, Math.min(0.012, d * 0.2), 0, 0, -d / 2 + Math.min(0.006, d * 0.1)), c);
      b.add(vmat('matte'), flatG(ellipsePts(w / 2 - t, d - t, 24).filter(([, z]) => z >= 0).map(([x, z]) => [x, z - d / 2]), soilY), SOIL);
    } else {
      const wood = S.material === 'wood' || S.material === 'teak', feet = S.shape === 'trough' ? Math.min(0.04, H * 0.15) : 0;
      if (wood) {
        const n = Math.max(1, Math.round((H - feet) / 0.11)), ph2 = (H - feet) / n;
        for (let i = 0; i < n; i++) { const y = feet + i * ph2; b.add(m, boxOnG(w - 0.01, ph2 - 0.004, t, 0, y, d / 2 - t / 2 - 0.005)); b.add(m, boxOnG(w - 0.01, ph2 - 0.004, t, 0, y, -d / 2 + t / 2 + 0.005)); b.add(m, boxOnG(t, ph2 - 0.004, d - 2 * t - 0.01, w / 2 - t / 2 - 0.005, y, 0)); b.add(m, boxOnG(t, ph2 - 0.004, d - 2 * t - 0.01, -w / 2 + t / 2 + 0.005, y, 0)); }
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(m, boxOnG(0.035, H, 0.035, sx * (w / 2 - 0.0175), 0, sz * (d / 2 - 0.0175)));
      } else {
        const rim = Math.min(0.03, H * 0.15), ins = Math.min(0.006, t * 0.4);
        b.add(m, boxOnG(w - 2 * ins, H - rim - feet, d - 2 * ins, 0, feet, 0), c);
        b.add(m, extrudeG(rectPts(w, d), rim, H - rim, [rectPts(w - 2 * t, d - 2 * t).reverse()]), c);
        if (feet) for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(m, boxOnG(0.05, feet, 0.05, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.045)), c);
      }
      b.add(vmat('matte'), flatG(rectPts(w - 2 * t, d - 2 * t), soilY), SOIL);
    }
    if (S.plant !== 'none' && S.ph > 0.02) {
      const k = S.shape === 'wall' ? 0.9 : 0.96, pd = S.shape === 'wall' ? d * 0.9 : d * k;
      b.merge(potPlant(S.plant, w * k, pd, S.ph + (H - soilY), rnd, P), 0, soilY, S.shape === 'wall' ? (d - pd) / 2 - 0.001 : 0);
      if (S.hanging) b.add(vmat('leaf'), leafCloudG([0, H * 0.75, 0], [w * 0.47, H * 0.55, d * 0.47], 40, 0.07, rnd, { colors: ['#5c9846', '#4f8a3c'], hang: 0.8, aspect: 0.5, shell: 0.85, spread: 0.15 }));
    }
    return b.build();
  },
  draw2d(ctx, { w, d, h, p, px, item }) {
    const P = params(p), S = planterSetup(P, w / 100, d / 100, h / 100), rnd = K.rng(seedOf(item, 'planter' + S.shape + S.plant)), t = Math.max(S.t * 100, 1.5 * px);
    const [, c] = bodyMat(S.material, hexOf(P.color, null)), fill = K.tint(c || K.col(P.color, '#a9774a'), 0.35), round = ['round', 'bowl', 'tall', 'hanging'].includes(S.shape);
    if (round) { ctx.beginPath(); ctx.ellipse(0, 0, w / 2, d / 2, 0, 0, TAU); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke(); ctx.beginPath(); ctx.ellipse(0, 0, Math.max(1, w / 2 - t), Math.max(1, d / 2 - t), 0, 0, TAU); ctx.fillStyle = '#8a6a50'; ctx.fill(); ctx.stroke(); }
    else if (S.shape === 'wall') { ctx.beginPath(); ctx.moveTo(-w / 2, -d / 2); ctx.lineTo(w / 2, -d / 2); ctx.ellipse(0, -d / 2, w / 2, d, 0, 0, Math.PI); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke(); }
    else { K.fillRR(ctx, 0, 0, w, d, 1.5, fill, INK, px); K.fillRR(ctx, 0, 0, w - 2 * t, d - 2 * t, 1, '#8a6a50', INK, px); }
    if (S.plant === 'none') return;
    ctx.save(); if (S.shape === 'wall') { ctx.translate(0, -d / 2 + d * 0.48); ctx.scale(1, 0.5); }
    const k = 0.47, sp = { flowers: 'geranium', cactus: 'cactus', succulents: 'succulent-mix', herbs: 'rosemary', grass: 'ornamental-grass', bougainvillea: 'bougainvillea', topiary: 'myrtle' }[S.plant];
    if (S.plant === 'palm' || S.plant === 'bamboo') fronds2D(ctx, w * k, d * k, S.plant === 'palm' ? 11 : 16, '#6f9a4a', rnd, px, S.plant === 'palm' ? 0.16 : 0.05);
    else if (S.plant === 'olive' || S.plant === 'citrus') canopy2D(ctx, w * k, d * k, S.plant === 'olive' ? TREES.olive.f[0] : TREES.lemon.f[0], rnd, px, { accent: S.plant === 'citrus' ? '#f3d63a' : null, dots: 7, dotR: 0.09, clumps: 4, alpha: 0.5, lobes: 9 });
    else shrub2D(ctx, sp || 'pittosporum', S.plant === 'topiary' ? 'ball' : 'natural', w * k, d * k, rnd, px, { flowerColor: P.flowerColor || P.color2 });
    ctx.restore();
  },
});

// ── raised beds ──
const BED_FRAMES = { wood: 0.035, steel: 0.02, corten: 0.006, stone: 0.12, plastic: 0.03 };
function raisedSetup(P, w, d, item) {
  const frame = oneOf(P.frame, Object.keys(BED_FRAMES), typeof P.material === 'string' && P.material === 'metal' ? 'steel' : 'wood'), crop = oneOf(P.crop, ['vegetables', 'herbs', 'empty', 'flowers', 'strawberries'], 'vegetables');
  const t = Math.min(BED_FRAMES[frame], w * 0.2, d * 0.2), rnd = K.rng(seedOf(item, 'raised' + frame + crop)), trellis = P.trellis === true || P.trellis === 'true' || P.trellis === 1;
  const iw = w - 2 * t, id = d - 2 * t, cd = trellis ? id - 0.1 : id;
  return { frame, crop, t, rnd, trellis, iw, id, cd, plan: plantPlan(crop, iw - 0.06, cd - 0.06, rnd, FLOWER_COLORS) };
}
registerModel('raised-bed', {
  build({ w, d, h, p, item }) {
    const P = params(p), S = raisedSetup(P, w, d, item), b = new Batch(), t = S.t, rnd = S.rnd, color = hexOf(P.color, null), soilY = Math.max(h * 0.5, h - 0.045);
    const ring = (y0, hh, m, c, ins = 0, tt = t) => b.add(m, extrudeG(rectPts(w - 2 * ins, d - 2 * ins), hh, y0, [rectPts(w - 2 * ins - 2 * tt, d - 2 * ins - 2 * tt).reverse()]), c);
    if (S.frame === 'wood') {
      const m = K.wood(color || '#b08a5a'), n = Math.max(1, Math.round(h / 0.145)), ph = h / n, post = Math.min(0.07, w * 0.2, d * 0.2);
      for (let i = 0; i < n; i++) {
        const y = i * ph, hh = ph - 0.004;
        b.add(m, boxOnG(w, hh, t, 0, y, d / 2 - t / 2)); b.add(m, boxOnG(w, hh, t, 0, y, -d / 2 + t / 2)); b.add(m, boxOnG(t, hh, d - 2 * t, w / 2 - t / 2, y, 0)); b.add(m, boxOnG(t, hh, d - 2 * t, -w / 2 + t / 2, y, 0));
      }
      const xs = [-1, 1].map((s) => s * (w / 2 - t - post / 2)); for (let x = -w / 2 + 1.2; x < w / 2 - 0.6; x += 1.2) xs.push(x);
      for (const x of xs) for (const sz of [-1, 1]) b.add(m, boxOnG(post, h - 0.01, post, x, 0, sz * (d / 2 - t - post / 2)));
    } else if (S.frame === 'steel') {
      const outer = roundRectPts(w - 0.016, d - 0.016, Math.min(0.12, w * 0.2, d * 0.2), 5), pts = [], mm = vmat('metal'), col = color || '#b4b9bd';
      for (let i = 0; i < outer.length; i++) { const a = outer[i], c = outer[(i + 1) % outer.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]), n = Math.max(1, Math.round(len / 0.019)), nx = (c[1] - a[1]) / (len || 1), nz = -(c[0] - a[0]) / (len || 1); for (let q = 0; q < n; q++) { const k = (pts.length % 2 ? 0.008 : -0.001); pts.push([lerp(a[0], c[0], q / n) + nx * k, lerp(a[1], c[1], q / n) + nz * k]); } }
      b.add(mm, wallG(pts, 0, h - 0.012), col); b.add(mm, wallG(insetPts(outer, 0.012), soilY - 0.01, h - 0.012, true), K.shade(col, -0.15));
      b.add(mm, extrudeG(roundRectPts(w, d, Math.min(0.128, w * 0.2, d * 0.2), 5), 0.012, h - 0.012, [insetPts(outer, 0.016).reverse()]), K.shade(col, 0.08));
    } else if (S.frame === 'corten') {
      const col = color || '#9a5230', g = extrudeG(rectPts(w - 0.02, d - 0.02), h - 0.006, 0, [rectPts(w - 0.02 - 2 * t, d - 0.02 - 2 * t).reverse()]);
      b.add(vmat('matte'), paintFoliage(g, col, rnd, { lo: -0.18, hi: 0.08, sparkle: 0.2 })); ring(h - 0.006, 0.006, vmat('matte'), K.shade(col, -0.1), 0, Math.min(0.03, w * 0.2));
    } else if (S.frame === 'stone') {
      const bh = clamp(h / Math.max(1, Math.round(h / 0.1)), 0.04, 0.2), rows = Math.max(1, Math.round(h / bh)), col = color || '#b9b0a0';
      for (let r = 0; r < rows; r++) {
        const course = (L, place) => { const n = Math.max(1, Math.round(L / 0.22)), s = L / n; for (let i = 0; i < n; i++) place(-L / 2 + (i + 0.5) * s + (r % 2 && n > 1 ? (i === n - 1 ? 0 : s * 0) : 0), s); };
        const blk = (x, z, sx, sz) => b.add(vmat('flat'), paintFoliage(boxOnG(sx - 0.006, bh - 0.005, sz - 0.006, x, r * bh, z).toNonIndexed(), K.shade(col, (rnd() - 0.5) * 0.22), rnd, { lo: -0.1, hi: 0.06, sparkle: 0.05 }));
        const ex = r % 2 ? t : 0;
        course(w - 2 * ex, (x, s) => { blk(x, d / 2 - t / 2, s, t); blk(x, -d / 2 + t / 2, s, t); });
        course(d - 2 * (t - ex), (z, s) => { blk(w / 2 - t / 2, z, t, s); blk(-w / 2 + t / 2, z, t, s); });
      }
    } else {
      const col = color || '#4a4d52', m = vmat('satin');
      ring(0, h, m, col, 0.006); ring(h - 0.025, 0.025, m, K.shade(col, 0.08));
      for (let x = -w / 2 + 0.2; x < w / 2 - 0.1; x += 0.2) for (const sz of [-1, 1]) b.add(m, boxOnG(0.02, h - 0.03, 0.006, x, 0, sz * (d / 2 - 0.003)), K.shade(col, 0.05));
      for (let z = -d / 2 + 0.2; z < d / 2 - 0.1; z += 0.2) for (const sx of [-1, 1]) b.add(m, boxOnG(0.006, h - 0.03, 0.02, sx * (w / 2 - 0.003), 0, z), K.shade(col, 0.05));
    }
    addGround(b, rectPts(S.iw, S.id), soilY, surfaceOpts('soil', {}));
    const cropH = { vegetables: 0.6, herbs: 0.35, flowers: 0.4, strawberries: 0.16, empty: 0 }[S.crop];
    if (S.plan.length) b.merge(plantsBatch(S.plan, S.iw, S.cd, cropH, rnd), 0, soilY, S.trellis ? 0.05 : 0);
    if (S.trellis) {
      const m = K.wood('#b08a5a'), z = -d / 2 + t + 0.03, th = 1.3, x0 = -w / 2 + t + 0.03, x1 = w / 2 - t - 0.03, top = h + th;
      for (const x of [x0, x1]) b.add(m, boxOnG(0.035, top - soilY, 0.035, x, soilY, z));
      for (let y = h + 0.15; y <= top + 1e-6; y += (th - 0.15) / 4) b.add(m, boxG(x1 - x0, 0.018, 0.012, 0, y - 0.009, z));
      const nv = Math.max(1, Math.round((x1 - x0) / 0.2)); for (let i = 1; i < nv; i++) b.add(m, boxOnG(0.012, top - h - 0.1, 0.012, lerp(x0, x1, i / nv), h + 0.08, z + 0.012));
      const vb = new Batch();
      for (let i = 0; i < nv; i++) { const x = lerp(x0, x1, (i + 0.5) / nv), hh = th * (0.5 + rnd() * 0.45); for (let q = 0; q < 3; q++) { const y = h + hh * (0.2 + q * 0.3); vb.add(vmat('leaf'), paintFoliage(blobG(0.11, 0.13, 0.06, x + (rnd() - 0.5) * 0.08, y, z + 0.03, rnd, { detail: 1, amp: 0.3 }), q % 2 ? '#5c9a3c' : '#4f8a3a', rnd)); } vb.add(vmat('leaf'), leafCloudG([x, h + hh * 0.5, z + 0.03], [0.12, hh * 0.5, 0.05], 12, 0.09, rnd, { colors: ['#6aa844', '#5c9a3c'], aspect: 0.8 })); }
      b.merge(vb.clampXZ(-w / 2, w / 2));
    }
    return b.build();
  },
  draw2d(ctx, { w, d, p, px, item }) {
    const P = params(p), S = raisedSetup(P, w / 100, d / 100, item), t = Math.max(S.t * 100, 1.6 * px), col = hexOf(P.color, { wood: '#b08a5a', steel: '#b4b9bd', corten: '#9a5230', stone: '#b9b0a0', plastic: '#4a4d52' }[S.frame]);
    const r = S.frame === 'steel' ? Math.min(12, w * 0.2, d * 0.2) : 0.8;
    K.fillRR(ctx, 0, 0, w, d, r, K.tint(col, 0.3), INK, px);
    K.rr(ctx, 0, 0, w - 2 * t, d - 2 * t, Math.max(0, r - t)); ctx.fillStyle = groundFill2D(ctx, surfaceOpts('soil', {}), px, -w / 2, -d / 2); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke();
    ctx.save(); ctx.translate(0, S.trellis ? 5 : 0); plants2D(ctx, S.plan, px); ctx.restore();
    if (S.trellis) { const z = -d / 2 + t + 3; K.line(ctx, -w / 2 + t + 3, z, w / 2 - t - 3, z, '#8a6a40', px * 2); for (const x of [-w / 2 + t + 3, w / 2 - t - 3]) K.fillRR(ctx, x, z, 4, 4, 0, '#b08a5a', INK, px); }
  },
});

// ═════════════════════════════════ 9. ground surfaces ═════════════════════════════════
/** Stones of a stepping-stone path: [{ pts (plan outline, metres), tone }]. */
function steppingStones(w, d, tile, rnd) {
  const pitch = tile + 0.16, along = w >= d, L = along ? w : d, Wd = along ? d : w, n = Math.max(1, Math.floor((L + 0.1) / pitch)), rows = Math.max(1, Math.floor((Wd + 0.12) / pitch)), out = [];
  for (let r = 0; r < rows; r++) for (let i = 0; i < n; i++) {
    const a = -L / 2 + (i + 0.5) * (L / n), c = -Wd / 2 + (r + 0.5) * (Wd / rows) + (rows === 1 ? (rnd() - 0.5) * Math.max(0, Wd - tile) * 0.5 : 0);
    const rx = Math.min(tile / 2, L / n / 2 - 0.02) * (0.9 + rnd() * 0.1), rz = Math.min(tile / 2, Wd / rows / 2 - 0.01) * (0.8 + rnd() * 0.2), rot = rnd() * TAU, ca = Math.cos(rot) * 0.3, o = organicPts(1, 1, rnd, 14, 0.07);
    out.push({ pts: o.map(([x, z]) => { const px = x * rx * (1 + ca * z * 0.2), pz = z * rz; return along ? [a + px, c + pz] : [c + pz, a + px]; }), tone: (rnd() - 0.5) * 0.2 });
  }
  return out;
}
function surfaceSetup(P, w, d, item) {
  const kind = oneOf(P.kind, SURFACE_KINDS, 'lawn'), o = surfaceOpts(kind, P);
  if (kind !== 'stepping-stones') return { kind, o };
  const baseKind = { grass: 'lawn', gravel: 'gravel', tuff: 'tuff', sand: 'sand' }[o.base];
  return { kind, o, base: surfaceOpts(baseKind, baseKind === 'lawn' && P.color2 ? { color: P.color2 } : {}), stones: steppingStones(w, d, Math.min(o.tile, w, d), K.rng(seedOf(item, 'stones'))) };
}
registerModel('surface', {
  build({ w, d, h, p, item }) {
    const P = params(p), S = surfaceSetup(P, w, d, item), b = new Batch(), corner = [[0, 0], [w, 0], [w, d], [0, d]];
    const top = S.stones ? Math.max(h * 0.55, h - 0.012) : h, opts = S.stones ? S.base : S.o, G = groundMat(opts);
    b.add(G.mat, flatG(corner, top, G.pw, G.pd).translate(-w / 2, 0, -d / 2));           // pattern starts at the back-left corner
    b.add(vmat('matte'), wallG(rectPts(w, d), 0, top), K.shade(G.avg, -0.12));
    if (S.stones) for (const st of S.stones) { const g = extrudeG(st.pts, h, 0); b.add(vmat('flat'), paintFoliage(g, K.shade(S.o.color, st.tone), K.rng(7), { lo: -0.25, hi: 0.04, sparkle: 0.03 })); }
    const grp = b.build();
    grp.traverse((m) => { if (m.isMesh) { m.userData.noShadow = true; m.castShadow = false; } });   // thin ground slabs only receive shadows
    return grp;
  },
  draw2d(ctx, { w, d, p, px, item }) {
    const P = params(p), S = surfaceSetup(P, w / 100, d / 100, item);
    ctx.beginPath(); ctx.rect(-w / 2, -d / 2, w, d);
    ctx.fillStyle = groundFill2D(ctx, S.stones ? S.base : S.o, px, -w / 2, -d / 2); ctx.fill();
    ctx.strokeStyle = K.INK_SOFT; ctx.lineWidth = px; ctx.stroke();
    if (S.stones) for (const st of S.stones) { pathPts(ctx, st.pts.map(([x, z]) => [x * 100, z * 100])); ctx.fillStyle = K.tint(K.shade(S.o.color, st.tone), 0.3); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke(); }
  },
});

// ═════════════════════════════════ 10. pools ═════════════════════════════════
const _water = new Map();
/** Semi-transparent water with a caustic network (world-scaled: one repeat = 1.6 m). */
function waterMat(color = '#45b0dc', opacity = 0.62) {
  const key = color + '|' + opacity;
  let m = _water.get(key);
  if (m) return m;
  let map = null;
  if (hasDom) {
    const c = newCanvas(256, 256), g = c.getContext('2d');
    drawVoronoi(g, 256, 256, K.rng(11), 6, { colors: [color, K.shade(color, 0.05), K.shade(color, -0.05)], joint: K.shade(color, 0.22), vary: 0.02, jointW: 1.2, flat: true });
    map = new THREE.CanvasTexture(c); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  }
  m = new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : color, map, roughness: 0.06, metalness: 0, transparent: true, opacity, depthWrite: false });
  m.name = 'garden-water'; m.userData.noShadow = true;
  _water.set(key, m);
  return m;
}
const WATER_UV = 1.6;
const _poolMats = new Map();
/** Basin tiles: slightly self-lit so the basin still reads as blue tile when the ground above it shades it. */
function poolTileMat(color) {
  let m = _poolMats.get(color);
  if (!m) {
    const tex = groundTex({ kind: 'porcelain-tile', color, color2: K.shade(color, 0.35), tile: 0.25, pattern: 'grid' });
    m = new THREE.MeshStandardMaterial({ color: tex.map ? '#ffffff' : color, map: tex.map, roughness: 0.3, emissive: tex.map ? '#ffffff' : color, emissiveMap: tex.map, emissiveIntensity: 0.14 });
    m.name = 'garden-pool-tile'; m.userData.pw = tex.pw;
    _poolMats.set(color, m);
  }
  return m;
}
let _maskMat = null;
/** Invisible depth mask: drawn before the ground so that the ground is not painted inside the pool opening. */
function maskMat() {
  if (!_maskMat) { _maskMat = new THREE.MeshBasicMaterial({ colorWrite: false }); _maskMat.name = 'garden-pool-mask'; _maskMat.userData.noShadow = true; }
  return _maskMat;
}
const _fakeFloor = new Map();
/** Flat “deep water” colour shown if the renderer drew the ground first (then the real basin is hidden below it). */
function fakeFloorMat(color) {
  let m = _fakeFloor.get(color);
  if (!m) { m = new THREE.MeshBasicMaterial({ color, depthWrite: false }); m.name = 'garden-pool-fake-floor'; m.userData.noShadow = true; _fakeFloor.set(color, m); }
  return m;
}
const POOL_VARIANTS = ['in-ground', 'above-ground-frame', 'above-ground-round', 'inflatable', 'plunge', 'lap', 'kids', 'natural'];
function poolOutline(shape, w, d, rnd, natural) {
  if (natural) return organicPts(w / 2, d / 2, rnd, 44, 0.1);
  if (shape === 'round' || shape === 'oval') return ellipsePts(w / 2, d / 2, 48);
  if (shape === 'kidney') {
    const pts = ellipsePts(1, 1, 56).map(([x, z]) => [x, z < 0 ? z * (1 - 0.5 * Math.exp(-(x * x) / 0.12)) : z]);
    const z0 = Math.min(...pts.map((q) => q[1])), z1 = Math.max(...pts.map((q) => q[1]));
    return pts.map(([x, z]) => [x * w / 2, (((z - z0) / (z1 - z0)) * 2 - 1) * d / 2]);
  }
  if (shape === 'L') return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, -d / 2 + d * 0.52], [-w / 2 + w * 0.48, -d / 2 + d * 0.52], [-w / 2 + w * 0.48, d / 2], [-w / 2, d / 2]];
  return roundRectPts(w, d, Math.min(0.12, w * 0.1, d * 0.1), 4);
}
function poolSetup(P, w, d, h, item) {
  const variant = oneOf(P.variant, POOL_VARIANTS, 'in-ground'), inGround = ['in-ground', 'plunge', 'lap', 'natural'].includes(variant), natural = variant === 'natural';
  let shape = oneOf(P.shape, ['rect', 'round', 'oval', 'kidney', 'L'], 'rect');
  if (['above-ground-round', 'inflatable', 'kids'].includes(variant)) shape = 'round'; else if (variant === 'above-ground-frame' || variant === 'lap') shape = 'rect';
  const steps = oneOf(P.steps, ['none', 'corner', 'full-width', 'ladder'], { 'in-ground': 'corner', plunge: 'full-width', lap: 'ladder' }[variant] || 'none');
  const deck = inGround ? clamp(num(P.deck, natural ? 35 : 30, 0, 1000) / 100, 0.06, Math.min(w, d) * 0.3) : 0;
  const depth = clamp(num(P.depth, 0, 0, 1000) / 100 || (inGround ? h : h * 0.85), 0.2, 4), rnd = K.rng(seedOf(item, 'pool' + variant));
  const outer = poolOutline(shape, w, d, rnd, natural);
  const inner = natural ? insetPts(outer, deck) : shape === 'rect' ? roundRectPts(w - 2 * deck, d - 2 * deck, Math.min(0.1, w * 0.08, d * 0.08), 4) : shape === 'round' || shape === 'oval' ? ellipsePts(w / 2 - deck, d / 2 - deck, 48) : insetPts(outer, deck);
  const xs = inner.map((q) => q[0]), zs = inner.map((q) => q[1]);
  return { variant, inGround, natural, shape, steps, deck, depth, rnd, outer, inner, cover: P.cover === true || P.cover === 'true' || P.cover === 1,
    coping: hexOf(P.coping, variant === 'plunge' ? '#a39d92' : '#ddd6c8'), water: hexOf(P.water, natural ? '#4f9488' : '#45b0dc'),
    x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), corner: inner.reduce((a, q) => (q[0] + q[1] < a[0] + a[1] ? q : a), inner[0]), stepR: clamp(Math.min(w, d) * 0.3, 0.5, 1.3) };
}
/** In-ground pool: coping ring above ground, real tiled basin below y = 0 revealed through a depth mask, water just under the coping. */
function inGroundPool(b, S, w, d, P) {
  const cop = 0.07, waterY = 0.05, maskY = 0.042, D = S.depth, tile = poolTileMat(K.shade(S.water, 0.3)), tu = tile.userData.pw || 1, rnd = S.rnd;
  if (S.natural) {
    const n = clamp(Math.round((w + d) * 2 / 0.3), 10, 90), flat = vmat('flat');
    addGround(b, S.outer, 0.02, surfaceOpts('gravel', {}), [S.inner]);
    for (let i = 0; i < n; i++) {
      const k = Math.floor((i / n) * S.outer.length), o = S.outer[k], q = S.inner[k], t = 0.3 + rnd() * 0.45, r = S.deck * (0.3 + rnd() * 0.25), x = lerp(o[0], q[0], t), z = lerp(o[1], q[1], t);
      const g = blobG(r * 1.2, r * 0.9, r, x, r * 0.35, z, rnd, { amp: 0.25, floor: 0 }), a = g.attributes.position.array;
      for (let j = 0; j < a.length; j += 3) { a[j] = clamp(a[j], -w / 2, w / 2); a[j + 2] = clamp(a[j + 2], -d / 2, d / 2); }
      b.add(flat, paintFoliage(g, K.shade(i % 3 ? '#a8a297' : '#8f897e', (rnd() - 0.5) * 0.2), rnd, { lo: -0.25, hi: 0.08 }));
    }
    b.add(vmat('matte'), wallG(S.outer, 0, 0.02), '#9a958a');
    const reeds = new Batch();
    for (let i = 0; i < 3; i++) { const q = S.inner[Math.floor(rnd() * S.inner.length)]; bladeFan(reeds, vmat('frond'), [q[0] * 0.96, 0.03, q[1] * 0.96], 16, 0.7 + rnd() * 0.4, rnd, { wid: 0.035, el0: 1.55, el1: 1.15, curve: 0.5, colors: ['#5c8a4a', '#6f9a52'], segs: 3 }); }
    b.merge(reeds.clampXZ(-w / 2, w / 2, -d / 2, d / 2));
  } else {
    const G = groundMat(surfaceOpts('paving-stone', { color: S.coping, color2: K.shade(S.coping, -0.25), pattern: 'grid', tile: clamp(S.deck * 100, 20, 60) }));
    b.add(G.mat, flatG(S.outer, cop, G.pw, G.pd, [S.inner]));
    b.add(vmat('matte'), wallG(S.outer, 0, cop), K.shade(S.coping, -0.08));
    b.add(vmat('matte'), wallG(S.inner, maskY - 0.01, cop, true), K.shade(S.coping, -0.03));
  }
  if (S.cover) {
    const C2 = groundMat(surfaceOpts('deck-composite', { color: hexOf(P.color, '#7f9ab0'), color2: '#4a5a6a', tile: 8 }));
    b.add(C2.mat, flatG(S.inner, cop - 0.012, C2.pw, C2.pd));
    return;
  }
  const basin = S.natural ? groundMat(surfaceOpts('gravel', { color: '#8f9a8a', color2: '#4a5a52' })).mat : tile, bu = S.natural ? 1.2 : tu;
  b.add(fakeFloorMat(K.shade(S.water, -0.2)), flatG(S.inner, maskY - 0.004));
  b.add(basin, wallG(S.inner, -D, maskY + 0.004, true, bu));
  b.add(S.natural ? basin : poolTileMat(K.shade(S.water, -0.04)), flatG(S.inner, -D, bu, bu));
  if (!S.natural) b.add(poolTileMat(K.shade(S.water, -0.3)), wallG(insetPts(S.inner, 0.004), waterY - 0.16, maskY + 0.004, true, bu));   // waterline tile band
  b.add(maskMat(), flatG(S.inner, maskY));
  b.add(waterMat(S.water, S.natural ? 0.7 : 0.36), flatG(S.inner, waterY, WATER_UV));
  // steps & ladder live inside the basin (anything outside the opening is hidden by the ground)
  const stepM = S.natural ? basin : poolTileMat(K.shade(S.water, 0.55)), nS = clamp(Math.round(D / 0.28), 2, 5), sh = Math.min(0.28, D / (nS + 1));
  if (S.steps === 'corner') for (let i = 0; i < nS; i++) { const r = S.stepR * (1 - i / (nS + 0.6)), g = cylG(r, r, D + waterY - 0.14 - (nS - 1 - i) * sh, S.corner[0], -D, S.corner[1], 28), a = g.attributes.position.array; for (let j = 0; j < a.length; j += 3) { a[j] = clamp(a[j], S.x0, S.x1); a[j + 2] = clamp(a[j + 2], S.z0, S.z1); } b.add(stepM, g); }
  if (S.steps === 'full-width') for (let i = 0; i < nS; i++) { const len = 0.32 * (nS - i), top = waterY - 0.14 - i * sh; b.add(stepM, boxOnG(len, D + top, S.z1 - S.z0, S.x0 + len / 2, -D, (S.z0 + S.z1) / 2)); }
  if (S.steps === 'ladder') {
    const ch = K.chrome(), xe = S.x1, xo = Math.min(xe + 0.24, w / 2 - 0.03), zc = (S.z0 + S.z1) / 2, topY = cop + 0.7;
    for (const sz of [-0.24, 0.24]) b.add(ch, tubeG([[xe - 0.16, -Math.min(D * 0.8, 1), zc + sz], [xe - 0.16, topY - 0.15, zc + sz], [xe - 0.1, topY - 0.03, zc + sz], [xe, topY, zc + sz], [lerp(xe, xo, 0.7), topY - 0.04, zc + sz], [xo, topY - 0.2, zc + sz], [xo, cop, zc + sz]], 0.019, 7));
    for (let i = 0; i < 3; i++) b.add(ch, boxG(0.07, 0.02, 0.48, xe - 0.16, -0.12 - i * 0.26, zc));
  }
  if (S.variant === 'lap') b.add(poolTileMat(K.shade(S.water, -0.45)), boxOnG(S.x1 - S.x0 - 1.2, 0.004, 0.22, (S.x0 + S.x1) / 2, -D, (S.z0 + S.z1) / 2));
}
/** Above-ground pools: steel-frame rectangle, round steel-wall, inflatable ring pool, kids' ring pool. */
function aboveGroundPool(b, S, w, d, h, P) {
  const v = S.variant, wm = waterMat(S.water, 0.6), satin = vmat('satin');
  const ladder = (xr, zc, m) => {
    const mm = vmat('metal'), c = '#dfe3e6';
    for (const sz of [-0.22, 0.22]) { b.add(mm, barG([xr + m - 0.03, 0, zc + sz], [xr + 0.04, h - 0.01, zc + sz], 0.016), c); b.add(mm, barG([xr - 0.3, 0.03, zc + sz], [xr - 0.06, h - 0.01, zc + sz], 0.016), c); }
    b.add(satin, boxG(0.3, 0.025, 0.46, xr - 0.01, h - 0.0125, zc), '#f1f3f4');
    for (let i = 1; i <= 2; i++) { const t = i / 3; b.add(satin, boxG(0.1, 0.02, 0.42, lerp(xr - 0.3, xr - 0.06, t), lerp(0.03, h, t), zc), '#f1f3f4'); b.add(satin, boxG(0.08, 0.02, 0.42, lerp(xr + m - 0.03, xr + 0.04, t), h * t, zc), '#f1f3f4'); }
  };
  if (v === 'above-ground-frame') {
    const m = Math.min(0.13, w * 0.12, d * 0.12), L = roundRectPts(w - 2 * m, d - 2 * m, Math.min(0.14, w * 0.1), 4), inn = insetPts(L, 0.012), col = hexOf(P.color, '#66788a'), rail = '#e3e6e8', mm = vmat('metal');
    b.add(satin, wallG(L, 0, h - 0.03), col); b.add(satin, wallG(insetPts(L, -0.003), h * 0.7, h * 0.8), K.shade(col, -0.3));
    b.add(satin, wallG(inn, 0.02, h - 0.03, true), '#8fd2ec'); b.add(satin, flatG(inn, 0.02), '#7cc6e4');
    b.add(mm, tubeG([...L, L[0], L[1]].map(([x, z]) => [x, h - 0.026, z]), 0.026, 7), rail);
    const leg = (x, z, nx, nz) => { b.add(mm, barG([x, h - 0.04, z], [x + nx * (m - 0.02), 0.02, z + nz * (m - 0.02)], 0.018), rail); b.add(mm, barG([x, 0.02, z], [x + nx * (m - 0.02), 0.02, z + nz * (m - 0.02)], 0.018), rail); b.add(mm, barG([x + nx * 0.005, 0.02, z + nz * 0.005], [x + nx * 0.005, h - 0.04, z + nz * 0.005], 0.014), rail); };
    const nx = Math.max(1, Math.round((w - 2 * m - 0.3) / 0.85)), nz = Math.max(1, Math.round((d - 2 * m - 0.3) / 0.85));
    for (let i = 0; i < nx; i++) { const x = lerp(-w / 2 + m + 0.2, w / 2 - m - 0.2, nx === 1 ? 0.5 : i / (nx - 1)); leg(x, d / 2 - m, 0, 1); leg(x, -d / 2 + m, 0, -1); }
    for (let i = 0; i < nz; i++) { const z = lerp(-d / 2 + m + 0.2, d / 2 - m - 0.2, nz === 1 ? 0.5 : i / (nz - 1)); if (S.steps === 'ladder' && Math.abs(z) < 0.3) { leg(-w / 2 + m, z, -1, 0); continue; } leg(w / 2 - m, z, 1, 0); leg(-w / 2 + m, z, -1, 0); }
    if (!S.cover) b.add(wm, flatG(inn, h - 0.14, WATER_UV)); else b.add(satin, flatG(insetPts(L, -0.02), h + 0.001), hexOf(P.color2, '#3f4f5f'));
    if (S.steps === 'ladder') ladder(w / 2 - m, 0, m);
  } else if (v === 'above-ground-round') {
    const m = Math.min(0.07, w * 0.08), rx = w / 2 - m, rz = d / 2 - m, col = hexOf(P.color, '#e9ecee'), E = ellipsePts(rx, rz, 48), inn = ellipsePts(rx - 0.012, rz - 0.012, 48), mm = vmat('metal');
    b.add(satin, wallG(E, 0, h - 0.03), col); b.add(satin, wallG(inn, 0.02, h - 0.03, true), '#8fd2ec'); b.add(satin, flatG(inn, 0.02), '#7cc6e4');
    b.add(satin, extrudeG(ellipsePts(w / 2 - 0.005, d / 2 - 0.005, 48), 0.03, h - 0.03, [ellipsePts(rx - 0.05, rz - 0.05, 48)]), K.shade(col, -0.06));
    const n = Math.max(6, Math.round((Math.PI * (rx + rz)) / 0.9));
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU + 0.2; b.add(mm, placed(boxOnG(0.09, h - 0.03, m - 0.012, 0, 0, 0), Math.cos(a) * (rx + m / 2 - 0.004), 0, Math.sin(a) * (rz + m / 2 - 0.004), -a + Math.PI / 2), K.shade(col, -0.12)); }
    if (!S.cover) b.add(wm, flatG(inn, h - 0.14, WATER_UV)); else b.add(satin, flatG(ellipsePts(rx + 0.02, rz + 0.02, 48), h + 0.001), hexOf(P.color2, '#3f4f5f'));
    if (S.steps === 'ladder') ladder(rx, 0, m);
  } else {
    const kids = v === 'kids', two = vmat('two'), rx = w / 2, zs = d / w;
    if (kids) {
      const tr = h / 6, cols = [hexOf(P.color, '#4fb0e0'), hexOf(P.color2, '#f6f6f2'), hexOf(P.color3, '#f08a3a')];
      for (let i = 0; i < 3; i++) b.add(satin, torusG(rx - tr, tr, 0, tr * (1 + 2 * i), 0, 10, 40).scale(1, 1, zs), cols[i]);
      b.add(satin, flatG(ellipsePts(rx - tr, (rx - tr) * zs, 40), 0.012), '#8fd6f0');
      if (!S.cover) b.add(wm, flatG(ellipsePts(rx - tr * 1.6, (rx - tr * 1.6) * zs, 40), h * 0.6, WATER_UV));
    } else {
      const tr = Math.min(h * 0.14, 0.14), col = hexOf(P.color, '#2f6db0'), top = h - 2 * tr;
      b.add(two, latheG([[rx * 0.955, 0], [rx, top * 0.3], [rx * 0.975, top * 0.65], [rx * 0.9 - tr * 0.3, top + tr * 0.6]], 40).scale(1, 1, zs), col);
      b.add(satin, torusG(rx * 0.9 - tr, tr, 0, h - tr, 0, 10, 40).scale(1, 1, zs), K.shade(col, 0.1));
      b.add(satin, flatG(ellipsePts(rx * 0.95, rx * 0.95 * zs, 40), 0.012), '#7cc6e4');
      if (!S.cover) b.add(wm, flatG(ellipsePts(rx * 0.9 - tr * 1.2, (rx * 0.9 - tr * 1.2) * zs, 40), top - 0.02, WATER_UV)); else b.add(satin, flatG(ellipsePts(rx * 0.9, rx * 0.9 * zs, 40), h - tr * 0.5), hexOf(P.color2, '#3f4f5f'));
    }
  }
}
registerModel('pool', {
  build({ w, d, h, p, item }) {
    const P = params(p), S = poolSetup(P, w, d, h, item), b = new Batch();
    if (!S.inGround) { aboveGroundPool(b, S, w, d, h, P); return b.fit(w, d, h).build(); }
    inGroundPool(b, S, w, d, P);
    const grp = b.build();
    // draw order of the “hole in the ground” trick: fake floor → basin and everything opaque → depth mask → (ground, drawn by the view) → water
    grp.traverse((m) => { if (m.isMesh) m.renderOrder = m.material === maskMat() ? -1 : m.material.name === 'garden-pool-fake-floor' ? -3 : m.material.transparent ? 1 : -2; });
    return grp;
  },
  draw2d(ctx, { w, d, h, p, px, item }) {
    const P = params(p), S = poolSetup(P, w / 100, d / 100, h / 100, item), cm = (pts) => pts.map(([x, z]) => [x * 100, z * 100]), waterFill = K.tint(S.water, 0.38), ripple = () => {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = px * 1.2; ctx.lineCap = 'round';
      const n = clamp(Math.round((w * d) / 60000), 2, 9);
      for (let i = 0; i < n; i++) { const x = (S.rnd() - 0.5) * w * 0.6, y = (S.rnd() - 0.5) * d * 0.55, l = Math.min(w, d) * 0.12; ctx.beginPath(); ctx.moveTo(x - l, y); ctx.bezierCurveTo(x - l / 2, y - l * 0.3, x, y + l * 0.3, x + l * 0.5, y); ctx.stroke(); }
    };
    if (S.inGround) {
      const inner = cm(S.inner);
      pathPts(ctx, cm(S.outer)); ctx.fillStyle = S.natural ? '#d9d5c9' : K.tint(S.coping, 0.3); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke();
      if (S.natural) { const n = clamp(Math.round((w + d) * 2 / 30), 10, 90); for (let i = 0; i < n; i++) { const k = Math.floor((i / n) * S.outer.length), o = S.outer[k], q = S.inner[k], t = 0.3 + S.rnd() * 0.45, r = S.deck * 100 * (0.3 + S.rnd() * 0.25); ctx.beginPath(); ctx.ellipse(lerp(o[0], q[0], t) * 100, lerp(o[1], q[1], t) * 100, r * 1.2, r, 0, 0, TAU); ctx.fillStyle = '#c4beb2'; ctx.fill(); ctx.lineWidth = px * 0.8; ctx.stroke(); } }
      pathPts(ctx, inner); ctx.fillStyle = S.cover ? '#b9c7d4' : waterFill; ctx.fill(); ctx.lineWidth = px; ctx.strokeStyle = INK; ctx.stroke();
      ctx.save(); pathPts(ctx, inner); ctx.clip();
      if (S.cover) { ctx.strokeStyle = 'rgba(60,80,100,0.45)'; ctx.lineWidth = px; for (let x = -w / 2; x < w / 2; x += Math.max(12, 4 * px)) { ctx.beginPath(); ctx.moveTo(x, -d / 2); ctx.lineTo(x, d / 2); ctx.stroke(); } }
      else {
        pathPts(ctx, cm(insetPts(S.inner, Math.min(0.12, w / 1200)))); ctx.strokeStyle = rgba(K.shade(S.water, -0.25), 0.35); ctx.lineWidth = px; ctx.stroke();
        ctx.strokeStyle = rgba(K.shade(S.water, -0.4), 0.8); ctx.lineWidth = px;
        if (S.steps === 'corner') for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(S.corner[0] * 100, S.corner[1] * 100, S.stepR * 100 * (1 - i / 3.6), 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill(); ctx.stroke(); }
        if (S.steps === 'full-width') for (let i = 1; i <= 3; i++) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(S.x0 * 100, -d / 2, 32 * (4 - i), d); K.line(ctx, S.x0 * 100 + 32 * i, -d / 2, S.x0 * 100 + 32 * i, d / 2, ctx.strokeStyle, px); }
        if (S.variant === 'lap') K.line(ctx, S.x0 * 100 + 60, 0, S.x1 * 100 - 60, 0, rgba(K.shade(S.water, -0.5), 0.6), Math.max(px, 8));
        if (S.natural) for (let i = 0; i < 5; i++) dot(ctx, (S.rnd() - 0.5) * w * 0.5, (S.rnd() - 0.5) * d * 0.5, Math.max(px * 1.5, 9), 'rgba(90,150,90,0.8)');
        ripple();
      }
      ctx.restore();
      if (S.steps === 'ladder' && !S.cover) { const x = S.x1 * 100, zc = (S.z0 + S.z1) * 50; for (const s of [-24, 24]) K.line(ctx, x - 20, zc + s, x + 22, zc + s, INK, px * 1.6); for (let i = 0; i < 3; i++) K.line(ctx, x - 16 + i * 8, zc - 24, x - 16 + i * 8, zc + 24, INK, px); }
      return;
    }
    const round = S.shape === 'round', m = S.variant === 'above-ground-frame' ? Math.min(13, w * 0.12, d * 0.12) : S.variant === 'above-ground-round' ? Math.min(7, w * 0.08) : 0;
    const body = (inset) => { if (round) { ctx.beginPath(); ctx.ellipse(0, 0, Math.max(1, w / 2 - inset), Math.max(1, d / 2 - inset), 0, 0, TAU); } else K.rr(ctx, 0, 0, w - 2 * inset, d - 2 * inset, 14); };
    const col = hexOf(P.color, { 'above-ground-frame': '#66788a', 'above-ground-round': '#cfd4d8', inflatable: '#2f6db0', kids: '#4fb0e0' }[S.variant]);
    if (m) {
      ctx.strokeStyle = INK; ctx.lineWidth = px * 1.4;
      if (round) { const n = Math.max(6, Math.round((Math.PI * (w + d - 4 * m) / 2) / 90)); for (let i = 0; i < n; i++) { const a = (i / n) * TAU + 0.2; K.line(ctx, Math.cos(a) * (w / 2 - m), Math.sin(a) * (d / 2 - m), Math.cos(a) * w / 2, Math.sin(a) * d / 2, INK, px * 2.5); } }
      else { const nx = Math.max(1, Math.round((w - 2 * m - 30) / 85)), nz = Math.max(1, Math.round((d - 2 * m - 30) / 85)); for (let i = 0; i < nx; i++) { const x = lerp(-w / 2 + m + 20, w / 2 - m - 20, nx === 1 ? 0.5 : i / (nx - 1)); K.line(ctx, x, -d / 2, x, -d / 2 + m, INK, px * 2); K.line(ctx, x, d / 2, x, d / 2 - m, INK, px * 2); } for (let i = 0; i < nz; i++) { const z = lerp(-d / 2 + m + 20, d / 2 - m - 20, nz === 1 ? 0.5 : i / (nz - 1)); K.line(ctx, -w / 2, z, -w / 2 + m, z, INK, px * 2); K.line(ctx, w / 2, z, w / 2 - m, z, INK, px * 2); } }
    }
    body(m); ctx.fillStyle = K.tint(col, 0.25); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke();
    const rim = m ? m + 4 : Math.max(w * (S.variant === 'kids' ? 0.1 : 0.09), 2 * px);
    if (S.variant === 'kids') { body(rim * 0.5); ctx.fillStyle = K.tint(hexOf(P.color3, '#f08a3a'), 0.3); ctx.fill(); ctx.stroke(); }
    body(rim); ctx.fillStyle = S.cover ? K.tint(hexOf(P.color2, '#3f4f5f'), 0.5) : waterFill; ctx.fill(); ctx.stroke();
    if (!S.cover) { ctx.save(); body(rim); ctx.clip(); ripple(); ctx.restore(); }
    if (S.steps === 'ladder' && m) { ctx.fillStyle = '#f1f3f4'; ctx.fillRect(w / 2 - m - 32, -23, 32 + m, 46); ctx.strokeRect(w / 2 - m - 32, -23, 32 + m, 46); for (let i = 1; i < 4; i++) K.line(ctx, w / 2 - m - 32 + i * (32 + m) / 4, -23, w / 2 - m - 32 + i * (32 + m) / 4, 23, INK, px); }
  },
});

// ═════════════════════════════════ 11. spas & saunas ═════════════════════════════════
const SPA_VARIANTS = ['square', 'round', 'inflatable', 'swim-spa', 'sauna-barrel', 'sauna-cabin', 'cold-plunge'];
const flag = (v) => v === true || v === 'true' || v === 1;
function spaSetup(P, w, d) {
  const variant = oneOf(P.variant, SPA_VARIANTS, 'square'), steps = flag(P.steps) && (variant === 'square' || variant === 'swim-spa'), stepD = steps ? Math.min(0.62, d * 0.3) : 0;
  return { variant, steps, stepD, cover: flag(P.cover), seats: Math.round(num(P.seats, variant === 'swim-spa' ? 3 : 5, 1, 10)), water: hexOf(P.water, variant === 'cold-plunge' ? '#a4dcec' : '#55b8dc') };
}
/**
 * Moulded acrylic shell seen from above: rim, upper wall, seat shelf, footwell, water.
 * o: { shell, rim width, margins [left, right, back, front] of the seat shelf (null = plain well), water, wet: draw water, top }
 */
function tubShell(b, w, d, h, o) {
  const gl = vmat('gloss'), rw = Math.min(o.rim, w * 0.2, d * 0.2), r = Math.min(0.14, w * 0.12, d * 0.12), outer = roundRectPts(w, d, r, 4), A = roundRectPts(w - 2 * rw, d - 2 * rw, Math.max(0.03, r - rw * 0.5), 4);
  const rimH = Math.min(0.05, h * 0.2), seatY = Math.max(h * 0.25, h - 0.42), floorY = Math.max(0.04, h - 0.82);
  b.add(gl, extrudeG(outer, rimH, h - rimH, [A]), o.shell);
  if (!o.wet) return A;
  const m = o.margins, iw = w - 2 * rw, id = d - 2 * rw;
  if (m && iw - m[0] - m[1] > 0.2 && id - m[2] - m[3] > 0.2) {
    const B = roundRectPts(iw - m[0] - m[1], id - m[2] - m[3], 0.06, 3).map(([x, z]) => [x + (m[0] - m[1]) / 2, z + (m[2] - m[3]) / 2]);
    b.add(gl, wallG(A, seatY, h - rimH * 0.5, true), o.shell); b.add(gl, flatG(A, seatY, 1, 1, [B]), K.shade(o.shell, -0.05));
    b.add(gl, wallG(B, floorY, seatY, true), K.shade(o.shell, -0.02)); b.add(gl, flatG(B, floorY), K.shade(o.shell, -0.08));
  } else { b.add(gl, wallG(A, floorY, h - rimH * 0.5, true), o.shell); b.add(gl, flatG(A, floorY), K.shade(o.shell, -0.06)); }
  b.add(waterMat(o.water, 0.55), flatG(A, h - Math.min(0.13, h * 0.2), WATER_UV));
  return A;
}
/** Acrylic hot tub / swim spa / cold plunge: cabinet + shell (+ pillows, control panel, cover). */
function acrylicTub(b, S, w, d, h, P) {
  const swim = S.variant === 'swim-spa', cold = S.variant === 'cold-plunge', cab = hexOf(P.color, cold ? '#2f3236' : '#6a5d52'), shell = hexOf(P.color2, '#eef0f2'), coverH = S.cover ? Math.min(0.1, h * 0.15) : 0, H = h - coverH;
  const r = Math.min(0.14, w * 0.12, d * 0.12), skirt = roundRectPts(w - 0.02, d - 0.02, r, 4), matte = vmat('matte');
  b.add(matte, wallG(skirt, 0.05, H - 0.04), cab); b.add(matte, wallG(roundRectPts(w - 0.04, d - 0.04, r, 4), 0, 0.05), K.shade(cab, -0.35));
  for (let i = 1; i <= 3; i++) b.add(matte, wallG(roundRectPts(w - 0.016, d - 0.016, r, 4), lerp(0.05, H - 0.04, i / 4) - 0.004, lerp(0.05, H - 0.04, i / 4) + 0.004), K.shade(cab, -0.3));
  const rim = cold ? 0.05 : swim ? 0.14 : 0.16, sm = swim ? [Math.min(1.5, w * 0.35), 0.12, 0.3, 0.3] : cold ? null : [0.42, 0.42, 0.42, 0.42];
  const A = tubShell(b, w, d, H, { shell, rim, margins: sm, water: S.water, wet: !S.cover });
  if (S.cover) {
    const cc = hexOf(P.color3, '#4f463f');
    for (const sx of [-1, 1]) b.add(matte, extrudeG(roundRectPts(w / 2 - 0.006, d, r, 4).map(([x, z]) => [x + sx * w / 4, z]), coverH, H), K.shade(cc, sx * 0.03));
    b.add(matte, boxG(0.012, 0.012, d * 0.96, 0, h - 0.004, 0), K.shade(cc, -0.3));
    return;
  }
  if (cold) { for (let i = 0; i < 7; i++) b.add(K.glass('#e8f6fa', 0.5), placed(boxG(0.045, 0.045, 0.045, 0, 0, 0), (S.rnd() - 0.5) * (w - 0.3), H - Math.min(0.13, H * 0.2) + 0.008, (S.rnd() - 0.5) * (d - 0.3), S.rnd() * 3)); return; }
  const xs = A.map((q) => q[0]), zs = A.map((q) => q[1]), ax = Math.max(...xs), az = Math.max(...zs), dark = vmat('satin');
  for (let i = 0; i < S.seats; i++) {                   // headrest pillows + jets on the seat backs
    const side = i % 4, t = (Math.floor(i / 4) + 0.5) / Math.ceil((S.seats - side) / 4), u = lerp(-0.55, 0.55, t), pos = side === 0 ? [u * 2 * ax * 0.8, -az] : side === 1 ? [ax, u * 2 * az * 0.8] : side === 2 ? [-u * 2 * ax * 0.8, az] : [-ax, -u * 2 * az * 0.8];
    if (swim && side !== 3 && i > 0) continue;
    const horiz = side % 2 === 0, inx = side === 1 ? -1 : side === 3 ? 1 : 0, inz = side === 0 ? 1 : side === 2 ? -1 : 0;
    b.add(dark, boxG(horiz ? 0.24 : 0.05, 0.09, horiz ? 0.05 : 0.24, pos[0] + inx * 0.03, H - 0.07, pos[1] + inz * 0.03), '#3a3d42');
    for (const k of [-0.09, 0.09]) b.add(K.chrome(), sphG(0.016, pos[0] + inx * 0.012 + (horiz ? k : 0), H - 0.24, pos[1] + inz * 0.012 + (horiz ? 0 : k), 8, 6));
  }
  b.add(dark, boxG(0.22, 0.012, 0.07, 0, H + 0.004, d / 2 - 0.07), '#26282c');
  if (swim) for (let i = -1; i <= 1; i++) b.add(K.chrome(), new THREE.CylinderGeometry(0.05, 0.05, 0.02, 14).rotateZ(Math.PI / 2).translate(ax - 0.01, H - 0.3, i * Math.min(0.3, d * 0.2)));
}
function roundTub(b, S, w, d, h, P) {
  const R = w / 2, inflatable = S.variant === 'inflatable', coverH = S.cover ? Math.min(0.07, h * 0.12) : 0, H = h - coverH, wm = waterMat(S.water, 0.55);
  if (inflatable) {
    const col = hexOf(P.color, '#3d4249'), t = Math.min(0.24, R * 0.3);
    b.add(vmat('satin'), latheG([[R - 0.03, 0], [R, 0.07], [R, H - 0.09], [R - 0.035, H - 0.02], [R - 0.1, H], [R - t + 0.08, H], [R - t + 0.02, H - 0.03], [R - t, H - 0.12], [R - t, 0.05]], 40), col);
    for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; b.add(vmat('satin'), placed(boxOnG(0.012, H - 0.2, 0.006, 0, 0.08, R + 0.001), 0, 0, 0, a), K.shade(col, 0.12)); }
    b.add(vmat('satin'), flatG(ellipsePts(R - t, R - t, 40), 0.05), '#dfe6ea');
    if (!S.cover) b.add(wm, flatG(ellipsePts(R - t, R - t, 40), H - 0.16, WATER_UV));
  } else {
    const wood = K.wood(hexOf(P.color, '#b07a4a')), n = clamp(Math.round((TAU * R) / 0.1), 12, 72), sw = (TAU * (R - 0.006)) / n * 0.975, metal = K.metal('#3a3d42');
    for (let i = 0; i < n; i++) b.add(wood, placed(boxOnG(sw, H, 0.035, 0, 0, R - 0.0235), 0, 0, 0, (i / n) * TAU));
    for (const y of [0.18, 0.78]) b.add(metal, torusG(R - 0.0045, 0.0045, 0, H * y, 0, 5, 48));
    const seatY = Math.max(H * 0.3, H - 0.45), ri = R - 0.04;
    b.add(wood, flatG(ellipsePts(ri, ri, 40), seatY, 1, 1, [ellipsePts(ri - 0.36, ri - 0.36, 40)])); b.add(wood, wallG(ellipsePts(ri - 0.36, ri - 0.36, 40), 0.06, seatY, true)); b.add(wood, flatG(ellipsePts(ri - 0.36, ri - 0.36, 40), 0.06));
    if (!S.cover) b.add(wm, flatG(ellipsePts(ri, ri, 40), H - 0.14, WATER_UV));
  }
  if (S.cover) b.add(vmat('matte'), latheG([[0.001, H + coverH * 0.2], [R - 0.01, H], [R - 0.004, H + coverH * 0.7], [R * 0.8, h], [0.001, h]], 40), hexOf(P.color3, inflatable ? '#5a6068' : '#4f463f'));
}
function barrelSauna(b, w, d, h, P) {
  const R = w / 2, wood = K.wood(hexOf(P.color, '#c08a52')), n = clamp(Math.round((TAU * R) / 0.11), 16, 64), sw = (TAU * (R - 0.02)) / n * 0.98, porch = Math.min(0.45, d * 0.2), zf = d / 2 - porch;
  for (let i = 0; i < n; i++) b.add(wood, boxG(sw, 0.04, d, 0, R - 0.02, 0).rotateZ((i / n) * TAU).translate(0, R, 0));
  for (const z of [-d * 0.3, d * 0.3]) { b.add(K.metal('#3a3d42'), new THREE.TorusGeometry(R - 0.004, 0.004, 5, 44).translate(0, R, z)); b.add(wood, boxOnG(w * 0.72, R * 0.3, 0.12, 0, 0, z)); }
  const wall = (z) => new THREE.CylinderGeometry(R - 0.04, R - 0.04, 0.045, 36).rotateX(Math.PI / 2).translate(0, R, z);
  b.add(wood, wall(zf)); b.add(wood, wall(-d / 2 + 0.04));
  const dw = Math.min(0.62, R * 0.9), dh = Math.min(1.75, R * 1.5), dy = R * 0.2;
  b.add(K.wood('#7a5230'), boxOnG(dw + 0.1, dh + 0.08, 0.03, 0, dy - 0.03, zf + 0.03));
  const gl = K.glass('#a9c4cc', 0.45); b.add(gl, boxOnG(dw, dh, 0.012, 0, dy, zf + 0.05));
  b.add(K.metal('#2b2d31'), boxOnG(0.02, 0.3, 0.03, dw / 2 - 0.06, dy + dh * 0.4, zf + 0.07));
  b.add(wood, boxOnG(w * 0.55, 0.04, porch - 0.06, 0, R * 0.2 - 0.04, d / 2 - porch / 2));
  b.add(gl, new THREE.CylinderGeometry(R * 0.28, R * 0.28, 0.012, 24).rotateX(Math.PI / 2).translate(0, R * 1.2, -d / 2 + 0.014));
}
function cabinSauna(b, w, d, h, P) {
  const wood = K.wood(hexOf(P.color, '#c69a62')), dark = vmat('matte'), t = 0.06, iw = w - 0.08, id = d - 0.08, roofH = Math.min(0.09, h * 0.1), H = h - roofH, gl = K.glass('#a9c4cc', 0.4);
  b.add(wood, boxOnG(iw, H, t, 0, 0, -id / 2 + t / 2)); for (const sx of [-1, 1]) b.add(wood, boxOnG(t, H, id - t, sx * (iw / 2 - t / 2), 0, t / 2));
  for (let y = 0.16; y < H - 0.05; y += 0.16) { b.add(dark, boxG(iw + 0.004, 0.006, 0.006, 0, y, -id / 2 - 0.001), '#8a6a42'); for (const sx of [-1, 1]) b.add(dark, boxG(0.006, 0.006, id, sx * (iw / 2 + 0.001), y, 0), '#8a6a42'); }
  b.add(dark, boxOnG(w, roofH, d, 0, H, 0), hexOf(P.color2, '#34373c')); b.add(wood, boxOnG(iw, 0.05, id, 0, 0, 0));
  const fz = id / 2 - 0.02, post = 0.07, dwid = Math.min(0.7, iw * 0.42);
  for (const x of [-iw / 2 + post / 2, iw / 2 - post / 2, -iw / 2 + post + dwid + post / 2]) b.add(wood, boxOnG(post, H, post, x, 0, fz - post / 2 + 0.02));
  b.add(wood, boxOnG(iw, 0.1, post, 0, H - 0.1, fz - post / 2 + 0.02));
  b.add(gl, boxOnG(iw - 2 * post, H - 0.15, 0.012, 0, 0.05, fz - 0.02));
  b.add(K.wood('#7a5230'), boxOnG(0.035, 0.4, 0.04, -iw / 2 + post + dwid - 0.07, H * 0.42, fz + 0.01));
  const bd = Math.min(0.55, id * 0.4);
  b.add(wood, boxOnG(iw - 2 * t, 0.05, bd, 0, 0.45, -id / 2 + t + bd / 2)); b.add(wood, boxOnG(iw - 2 * t, 0.05, bd * 0.75, 0, 0.9, -id / 2 + t + bd * 0.375));
  b.add(dark, boxOnG(0.36, 0.55, 0.3, iw / 2 - t - 0.25, 0.05, fz - 0.4), '#2b2d31');
  b.add(vmat('flat'), blobG(0.16, 0.06, 0.13, iw / 2 - t - 0.25, 0.62, fz - 0.4, K.rng(3), { amp: 0.4 }), '#77726a');
}
registerModel('spa', {
  build({ w, d, h, p, item }) {
    const P = params(p), S = spaSetup(P, w, d), b = new Batch(); S.rnd = K.rng(seedOf(item, 'spa' + S.variant));
    if (S.variant === 'round' || S.variant === 'inflatable') roundTub(b, S, w, d, h, P);
    else if (S.variant === 'sauna-barrel') barrelSauna(b, w, d, h, P);
    else if (S.variant === 'sauna-cabin') { cabinSauna(b, w, d, h, P); return b.build(); }
    else {
      const sub = new Batch(), dt = d - S.stepD;
      acrylicTub(sub, S, w, dt, h, P); b.merge(sub.fit(w, dt, h), 0, 0, -S.stepD / 2);
      if (S.steps) { const sw = Math.min(w * 0.6, 0.9), c = K.shade(hexOf(P.color, '#6a5d52'), -0.1), m = vmat('matte'); b.add(m, boxOnG(sw, h * 0.33, S.stepD, 0, 0, d / 2 - S.stepD / 2), c); b.add(m, boxOnG(sw, h * 0.33, S.stepD / 2, 0, h * 0.33, d / 2 - S.stepD * 0.75), c); }
      return b.build();
    }
    return b.fit(w, d, h).build();
  },
  draw2d(ctx, { w, d, p, px }) {
    const P = params(p), S = spaSetup(P, w / 100, d / 100), sd = S.stepD * 100, water = S.cover ? K.tint(hexOf(P.color3, '#4f463f'), 0.5) : K.tint(S.water, 0.35);
    if (S.variant === 'round' || S.variant === 'inflatable') {
      const t = S.variant === 'inflatable' ? Math.min(24, w * 0.15) : 4;
      ctx.beginPath(); ctx.ellipse(0, 0, w / 2, d / 2, 0, 0, TAU); ctx.fillStyle = K.tint(hexOf(P.color, S.variant === 'inflatable' ? '#3d4249' : '#b07a4a'), 0.35); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, 0, w / 2 - t, d / 2 - t, 0, 0, TAU); ctx.fillStyle = water; ctx.fill(); ctx.stroke();
      if (!S.cover && S.variant === 'round') { ctx.beginPath(); ctx.ellipse(0, 0, Math.max(1, w / 2 - 40), Math.max(1, d / 2 - 40), 0, 0, TAU); ctx.strokeStyle = K.INK_SOFT; ctx.stroke(); }
      if (S.cover) K.line(ctx, 0, -d / 2 + t, 0, d / 2 - t, K.INK_SOFT, px);
    } else if (S.variant === 'sauna-barrel' || S.variant === 'sauna-cabin') {
      const barrel = S.variant === 'sauna-barrel', col = hexOf(P.color, '#c08a52'), porch = barrel ? Math.min(45, d * 0.2) : 4;
      K.fillRR(ctx, 0, 0, w, d, barrel ? 6 : 1, K.tint(col, 0.4), INK, px);
      if (barrel) { for (let x = -w / 2 + 11; x < w / 2; x += 11) K.line(ctx, x, -d / 2, x, d / 2, K.INK_SOFT, px * 0.7); K.line(ctx, -w / 2, d / 2 - porch, w / 2, d / 2 - porch, INK, px * 1.5); }
      else { K.fillRR(ctx, 0, -d / 2 + 10 + Math.min(55, d * 0.4) / 2, w - 20, Math.min(55, d * 0.4), 1, K.tint(col, 0.6), INK, px); K.line(ctx, -w / 2 + 10, -d / 2 + 10 + Math.min(55, d * 0.4) * 0.6, w / 2 - 10, -d / 2 + 10 + Math.min(55, d * 0.4) * 0.6, K.INK_SOFT, px); K.fillRR(ctx, w / 2 - 34, d / 2 - 52, 34, 28, 2, '#8a8f96', INK, px); }
      const dw = Math.min(62, w * 0.42), dx = barrel ? -dw / 2 : -w / 2 + 12, dy = d / 2 - porch;
      K.line(ctx, dx, dy, dx + dw, dy, '#ffffff', px * 3); ctx.beginPath(); ctx.moveTo(dx, dy); ctx.arc(dx, dy, dw, 0, Math.PI / 4); ctx.strokeStyle = K.INK_SOFT; ctx.lineWidth = px; ctx.stroke();
    } else {
      const dt = d - sd, cy = -sd / 2, rim = S.variant === 'cold-plunge' ? 5 : 15, cab = hexOf(P.color, S.variant === 'cold-plunge' ? '#2f3236' : '#6a5d52');
      K.fillRR(ctx, 0, cy, w, dt, 13, K.tint(hexOf(P.color2, '#eef0f2'), 0.2), INK, px); ctx.lineWidth = px * 2; ctx.strokeStyle = rgba(cab, 0.8); K.rr(ctx, 0, cy, w - 2 * px, dt - 2 * px, 13); ctx.stroke();
      K.fillRR(ctx, 0, cy, w - 2 * rim, dt - 2 * rim, 9, water, INK, px);
      if (S.cover) K.line(ctx, 0, cy - dt / 2, 0, cy + dt / 2, INK, px);
      else if (S.variant !== 'cold-plunge') {
        const m = S.variant === 'swim-spa' ? [Math.min(150, w * 0.35), 12, 30, 30] : [42, 42, 42, 42];
        K.fillRR(ctx, (m[0] - m[1]) / 2, cy + (m[2] - m[3]) / 2, w - 2 * rim - m[0] - m[1], dt - 2 * rim - m[2] - m[3], 6, rgba(K.shade(S.water, -0.2), 0.35), K.INK_SOFT, px);
        for (let i = 0; i < S.seats && S.variant === 'square'; i++) { const side = i % 4, k = (side < 2 ? 1 : -1), hx = side % 2 ? k * (w / 2 - rim - 4) : 0, hy = side % 2 ? cy : cy - k * (dt / 2 - rim - 4); K.fillRR(ctx, hx, hy, side % 2 ? 5 : 22, side % 2 ? 22 : 5, 2, '#5a5d62', null); }
      }
      if (sd) { const sw = Math.min(w * 0.6, 90); K.fillRR(ctx, 0, d / 2 - sd / 2, sw, sd, 1, K.tint(cab, 0.4), INK, px); K.line(ctx, -sw / 2, d / 2 - sd / 2, sw / 2, d / 2 - sd / 2, INK, px); }
    }
  },
});

// ═════════════════════════════════ 12. water features ═════════════════════════════════
const WF_VARIANTS = ['fountain-tier', 'fountain-wall', 'fountain-sphere', 'pond', 'bird-bath', 'stream', 'bubbler'];
/** Ring of rough stones between two outlines (pond / stream banks), clamped into the w × d footprint and below `top`. */
function stoneRing(b, outer, inner, n, size, top, w, d, rnd) {
  for (let i = 0; i < n; i++) {
    const k = Math.floor((i / n) * outer.length), o = outer[k], q = inner[k % inner.length], t = 0.25 + rnd() * 0.5, r = size * (0.7 + rnd() * 0.6), x = lerp(o[0], q[0], t), z = lerp(o[1], q[1], t);
    const g = blobG(r * 1.2, top * (0.55 + rnd() * 0.3), r, x, top * 0.35, z, rnd, { amp: 0.25, floor: 0 }), a = g.attributes.position.array;
    for (let j = 0; j < a.length; j += 3) { a[j] = clamp(a[j], -w / 2, w / 2); a[j + 1] = Math.min(a[j + 1], top); a[j + 2] = clamp(a[j + 2], -d / 2, d / 2); }
    b.add(vmat('flat'), paintFoliage(g, K.shade(i % 3 ? '#a8a297' : '#8f897e', (rnd() - 0.5) * 0.22), rnd, { lo: -0.25, hi: 0.08 }));
  }
}
function wfSetup(P, w, d, item) {
  const variant = oneOf(P.variant, WF_VARIANTS, 'fountain-tier'), rnd = K.rng(seedOf(item, 'wf' + variant)), m = Math.min(0.14, w * 0.14, d * 0.14);
  const outer = organicPts(w / 2, d / 2, K.rng(seedOf(item, 'pond')), 36, 0.09);
  return { variant, rnd, m, outer, inner: insetPts(outer, m * 1.5), stone: hexOf(P.color, '#c9c2b4'), water: hexOf(P.color2, '#5fb4d4') };
}
const streamZ = (x, w, d) => Math.sin((x / w) * TAU * 1.15 + 0.6) * d * 0.17;
registerModel('water-feature', {
  build({ w, d, h, p, item }) {
    const P = params(p), S = wfSetup(P, w, d, item), b = new Batch(), R = w / 2, st = vmat('matte'), col = S.stone, wm = waterMat(S.water, 0.7), fall = K.water('#cfeaf6', 0.5), rnd = S.rnd;
    const disc = (r, y) => flatG(ellipsePts(r, r, 28), y, 0.8);
    switch (S.variant) {
      case 'fountain-wall': {
        const tw = Math.min(0.14, d * 0.3), th = Math.min(h * 0.38, 0.5), t = 0.06, sy = h * 0.62;
        b.add(st, boxOnG(w, h - 0.05, tw, 0, 0, -d / 2 + tw / 2), col); b.add(st, boxOnG(w, 0.05, tw, 0, h - 0.05, -d / 2 + tw / 2), K.shade(col, -0.1));
        b.add(st, boxOnG(w, th, t, 0, 0, d / 2 - t / 2), col); for (const sx of [-1, 1]) b.add(st, boxOnG(t, th, d - tw - t, sx * (w / 2 - t / 2), 0, (tw - t) / 2), col);
        b.add(st, boxOnG(w - 2 * t, 0.04, d - tw - t, 0, 0, (tw - t) / 2), K.shade(col, -0.15));
        b.add(wm, flatG(rectPts(w - 2 * t, d - tw - t), th - 0.05, WATER_UV).translate(0, 0, (tw - t) / 2));
        b.add(vmat('metal'), new THREE.CylinderGeometry(0.09, 0.09, 0.02, 20).rotateX(Math.PI / 2).translate(0, sy, -d / 2 + tw + 0.01), '#8a6a3a');
        b.add(vmat('metal'), new THREE.CylinderGeometry(0.018, 0.018, 0.1, 10).rotateX(Math.PI / 2).translate(0, sy, -d / 2 + tw + 0.06), '#8a6a3a');
        b.add(fall, boxG(0.035, sy - th + 0.05, 0.012, 0, (sy + th - 0.05) / 2, -d / 2 + tw + 0.105));
        return b.build();
      }
      case 'fountain-sphere': case 'bubbler': {
        b.add(st, cylG(R, R, Math.min(0.06, h * 0.2), 0, 0, 0, 32), K.shade(col, -0.25));
        for (let i = 0; i < 30; i++) { const a = rnd() * TAU, k = 0.5 + rnd() * 0.44, r = R * 0.07; b.add(vmat('flat'), paintFoliage(blobG(r, r * 0.6, r, Math.cos(a) * R * k, Math.min(0.06, h * 0.2) + r * 0.2, Math.sin(a) * R * k, rnd, { detail: 0, amp: 0.2 }), K.shade('#b5aea2', (rnd() - 0.5) * 0.3), rnd, { lo: -0.2 })); }
        if (S.variant === 'fountain-sphere') { const rs = Math.min(R * 0.66, (h - 0.03) / 2); b.add(vmat('gloss'), sphG(rs, 0, h - rs - 0.002, 0, 28, 18), hexOf(P.color, '#4a4d52')); b.add(K.water('#d8eef6', 0.28), sphG(rs + 0.002, 0, h - rs - 0.002, 0, 28, 18)); }
        else {
          b.add(vmat('gloss'), latheG([[R * 0.36, 0.03], [R * 0.52, h * 0.06], [R * 0.74, h * 0.36], [R * 0.62, h * 0.7], [R * 0.34, h * 0.88], [R * 0.42, h * 0.97], [R * 0.37, h], [R * 0.28, h * 0.975]], 28), hexOf(P.color, '#3f7f9a'));
          b.add(wm, disc(R * 0.3, h * 0.985)); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; b.add(fall, barG([Math.cos(a) * R * 0.42, h * 0.96, Math.sin(a) * R * 0.42], [Math.cos(a) * R * 0.75, h * 0.38, Math.sin(a) * R * 0.75], 0.005, 4)); }
        }
        return b.fit(w, d, h).build();
      }
      case 'bird-bath':
        b.add(st, latheG([[R * 0.5, 0], [R * 0.55, h * 0.03], [R * 0.3, h * 0.08], [R * 0.16, h * 0.2], [R * 0.14, h * 0.7], [R * 0.3, h * 0.83]], 24), col);
        b.add(st, latheG([[R * 0.25, h * 0.8], [R * 0.9, h * 0.9], [R, h], [R * 0.94, h], [R * 0.2, h * 0.9]], 32), col);
        b.add(wm, disc(R * 0.9, h * 0.975));
        return b.fit(w, d, h).build();
      case 'pond': {
        const wy = h * 0.3;
        b.add(vmat('matte'), flatG(S.outer, 0.006), '#59503f'); b.add(vmat('matte'), flatG(S.inner, 0.012), '#1f2e2a');
        stoneRing(b, S.outer, S.inner, clamp(Math.round((w + d) * 2 / 0.22), 10, 80), S.m * 0.8, h * 0.62, w, d, rnd);
        b.add(waterMat(hexOf(P.color2, '#4f8f86'), 0.8), flatG(S.inner, wy, WATER_UV));
        for (let i = 0; i < clamp(Math.round(w * d * 2.2), 3, 14); i++) {
          const q = S.inner[Math.floor(rnd() * S.inner.length)], k = 0.15 + rnd() * 0.55, x = q[0] * k, z = q[1] * k, r = 0.08 + rnd() * 0.07, a0 = rnd() * TAU;
          b.add(vmat('two'), flatG([[x, z], ...Array.from({ length: 11 }, (_, j) => [x + Math.cos(a0 + 0.35 + (j / 10) * (TAU - 0.7)) * r, z + Math.sin(a0 + 0.35 + (j / 10) * (TAU - 0.7)) * r])], wy + 0.004 + i * 0.0004), K.shade('#4f8a4a', (rnd() - 0.5) * 0.2));
          if (i % 3 === 0) { b.add(vmat('frond'), trisG(starG([x, wy + 0.012, z], [0, 1, 0], r * 0.55, 8)), i % 2 ? '#f6f2ec' : '#f2a8c2'); b.add(vmat('matte'), sphG(r * 0.13, x, wy + 0.03, z, 6, 4), '#f2c63a'); }
        }
        const q = S.inner[Math.floor(S.inner.length * 0.62)];
        bladeFan(b, vmat('frond'), [q[0] * 0.9, wy, q[1] * 0.9], 18, h - wy, rnd, { wid: 0.04, el0: 1.56, el1: 1.25, curve: 0.35, colors: ['#5c8a4a', '#6f9a52'], segs: 3 });
        return b.settle(h, w, d).build();
      }
      case 'stream': {
        const n = 24, ws = d * 0.3, L = [], Rr = [];
        addGround(b, rectPts(w, d), 0.012, surfaceOpts('gravel', {})); b.add(vmat('matte'), wallG(rectPts(w, d), 0, 0.012), '#9a958a');
        for (let i = 0; i <= n; i++) { const x = -w / 2 + (i / n) * w, z = streamZ(x, w, d), k = 1 + 0.2 * Math.sin(i * 1.3); L.push([x, z - ws / 2 * k]); Rr.push([x, z + ws / 2 * k]); }
        const tri = []; for (let i = 0; i < n; i++) tri.push(L[i][0], 0.03, L[i][1], Rr[i][0], 0.03, Rr[i][1], Rr[i + 1][0], 0.03, Rr[i + 1][1], L[i][0], 0.03, L[i][1], Rr[i + 1][0], 0.03, Rr[i + 1][1], L[i + 1][0], 0.03, L[i + 1][1]);
        const g = trisG(tri), uv = new Float32Array(tri.length / 3 * 2); for (let i = 0; i < tri.length / 3; i++) { uv[i * 2] = tri[i * 3] / WATER_UV; uv[i * 2 + 1] = tri[i * 3 + 2] / WATER_UV; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        b.add(wm, g);
        const bank = (pts, sg) => pts.map(([x, z]) => [x, z + sg * 0.09]);
        stoneRing(b, bank(L, -1.5), bank(L, -0.1), Math.round(w / 0.3), 0.06, h, w, d, rnd); stoneRing(b, bank(Rr, 1.5), bank(Rr, 0.1), Math.round(w / 0.3), 0.06, h, w, d, rnd);
        for (let i = 0; i < 4; i++) { const x = (rnd() - 0.5) * w * 0.8; b.add(vmat('flat'), paintFoliage(blobG(0.07, 0.05, 0.06, x, 0.03, streamZ(x, w, d) + (rnd() - 0.5) * ws * 0.4, rnd, { amp: 0.25, floor: 0 }), '#8f897e', rnd)); }
        return b.settle(h, w, d).build();
      }
      default: {
        b.add(st, latheG([[R * 0.9, 0], [R, h * 0.03], [R, h * 0.2], [R * 0.93, h * 0.2], [R * 0.9, h * 0.08], [0.001, h * 0.08]], 36), col); b.add(wm, disc(R * 0.92, h * 0.17));
        b.add(st, latheG([[R * 0.17, h * 0.08], [R * 0.1, h * 0.2], [R * 0.08, h * 0.45], [R * 0.14, h * 0.5]], 16), col);
        b.add(st, latheG([[R * 0.12, h * 0.48], [R * 0.5, h * 0.52], [R * 0.6, h * 0.58], [R * 0.56, h * 0.58], [R * 0.1, h * 0.535]], 28), col); b.add(wm, disc(R * 0.56, h * 0.568));
        b.add(st, latheG([[R * 0.07, h * 0.53], [R * 0.05, h * 0.75], [R * 0.09, h * 0.78]], 12), col);
        b.add(st, latheG([[R * 0.08, h * 0.77], [R * 0.28, h * 0.8], [R * 0.33, h * 0.85], [R * 0.3, h * 0.85], [R * 0.06, h * 0.815]], 24), col); b.add(wm, disc(R * 0.3, h * 0.842));
        b.add(st, latheG([[R * 0.05, h * 0.81], [R * 0.035, h * 0.93], [R * 0.06, h * 0.96], [0.001, h]], 12), col);
        for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; b.add(fall, barG([Math.cos(a) * R * 0.6, h * 0.578, Math.sin(a) * R * 0.6], [Math.cos(a) * R * 0.66, h * 0.17, Math.sin(a) * R * 0.66], 0.006, 4)); if (i % 2) b.add(fall, barG([Math.cos(a) * R * 0.33, h * 0.848, Math.sin(a) * R * 0.33], [Math.cos(a) * R * 0.37, h * 0.57, Math.sin(a) * R * 0.37], 0.005, 4)); }
        return b.fit(w, d, h).build();
      }
    }
  },
  draw2d(ctx, { w, d, p, px, item }) {
    const P = params(p), S = wfSetup(P, w / 100, d / 100, item), stone = K.tint(S.stone, 0.3), water = K.tint(S.water, 0.35), ring = (k, fill) => { ctx.beginPath(); ctx.ellipse(0, 0, w / 2 * k, d / 2 * k, 0, 0, TAU); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke(); };
    switch (S.variant) {
      case 'fountain-wall': { const tw = Math.min(14, d * 0.3); K.fillRR(ctx, 0, 0, w, d, 1, stone, INK, px); K.fillRR(ctx, 0, tw / 2 - 3, w - 12, d - tw - 6, 1, water, INK, px); K.fillRR(ctx, 0, -d / 2 + tw / 2, w, tw, 0, K.tint(S.stone, 0.1), INK, px); dot(ctx, 0, -d / 2 + tw + 5, Math.max(1.5 * px, 3), '#8a6a3a'); break; }
      case 'fountain-sphere': ring(1, '#d9d5cc'); ring(0.66, K.tint(hexOf(P.color, '#4a4d52'), 0.45)); dot(ctx, -w * 0.1, -d * 0.1, Math.max(px, w * 0.05), 'rgba(255,255,255,0.7)'); break;
      case 'bubbler': ring(1, '#d9d5cc'); ring(0.74, K.tint(hexOf(P.color, '#3f7f9a'), 0.4)); ring(0.3, water); break;
      case 'bird-bath': ring(1, stone); ring(0.9, water); ring(0.15, stone); break;
      case 'pond': case 'stream': {
        if (S.variant === 'pond') {
          const cm = (pts) => pts.map(([x, z]) => [x * 100, z * 100]);
          pathPts(ctx, cm(S.outer)); ctx.fillStyle = '#d6d1c5'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke();
          pathPts(ctx, cm(S.inner)); ctx.fillStyle = K.tint(hexOf(P.color2, '#4f8f86'), 0.35); ctx.fill(); ctx.stroke();
          const n = S.outer.length; for (let i = 0; i < n; i += 2) { const o = S.outer[i], q = S.inner[i]; ctx.beginPath(); ctx.ellipse((o[0] + q[0]) * 50, (o[1] + q[1]) * 50, S.m * 80, S.m * 60, i, 0, TAU); ctx.fillStyle = '#c4beb2'; ctx.fill(); ctx.lineWidth = px * 0.8; ctx.stroke(); }
          for (let i = 0; i < 6; i++) { const q = S.inner[Math.floor(S.rnd() * S.inner.length)], k = 0.15 + S.rnd() * 0.5; dot(ctx, q[0] * k * 100, q[1] * k * 100, Math.max(1.5 * px, 9), 'rgba(80,140,80,0.85)'); if (i % 3 === 0) dot(ctx, q[0] * k * 100, q[1] * k * 100, Math.max(px, 3.5), '#f6d2e0'); }
        } else {
          ctx.beginPath(); ctx.rect(-w / 2, -d / 2, w, d); ctx.fillStyle = groundFill2D(ctx, surfaceOpts('gravel', {}), px, -w / 2, -d / 2); ctx.fill(); ctx.strokeStyle = K.INK_SOFT; ctx.lineWidth = px; ctx.stroke();
          const n = 24, ws = d * 0.3; ctx.beginPath();
          for (let i = 0; i <= n; i++) { const x = -w / 2 + (i / n) * w; ctx.lineTo(x, streamZ(x / 100, w / 100, d / 100) * 100 - ws / 2 * (1 + 0.2 * Math.sin(i * 1.3))); }
          for (let i = n; i >= 0; i--) { const x = -w / 2 + (i / n) * w; ctx.lineTo(x, streamZ(x / 100, w / 100, d / 100) * 100 + ws / 2 * (1 + 0.2 * Math.sin(i * 1.3))); }
          ctx.closePath(); ctx.fillStyle = water; ctx.fill(); ctx.strokeStyle = INK; ctx.stroke();
          for (let i = 0; i < Math.round(w / 20); i++) for (const sg of [-1, 1]) { const x = -w / 2 + (i + 0.5) * 20; ctx.beginPath(); ctx.ellipse(x, clamp(streamZ(x / 100, w / 100, d / 100) * 100 + sg * (ws / 2 * 1.2 + 9), -d / 2 + 7, d / 2 - 7), 9, 7, i, 0, TAU); ctx.fillStyle = '#c4beb2'; ctx.fill(); ctx.lineWidth = px * 0.8; ctx.stroke(); }
        }
        break;
      }
      default: ring(1, stone); ring(0.92, water); ring(0.6, stone); ring(0.56, water); ring(0.33, stone); ring(0.3, water); dot(ctx, 0, 0, Math.max(px, w * 0.03), INK);
    }
  },
});

// ═════════════════════════════════ 13. garden décor ═════════════════════════════════
const DECOR = ['boulder', 'rocks', 'statue', 'bird-feeder', 'arch', 'obelisk', 'stepping-stone', 'edging', 'sundial', 'gnome', 'sign', 'bridge', 'wind-chime'];
const rockG = (rx, ry, rz, x, z, rnd, tone = '#a8a297') => paintFoliage(blobG(rx, ry, rz, x, ry * 0.7, z, rnd, { detail: 2, amp: 0.26, floor: 0, squash: 0.5 }), K.shade(tone, (rnd() - 0.5) * 0.18), rnd, { lo: -0.3, hi: 0.1, sparkle: 0.1 });
function decorSetup(P, item) {
  const variant = oneOf(P.variant, DECOR, 'boulder');
  const edge = P.material === 'metal' ? 'steel' : P.material === 'wood' ? 'wood' : P.material === 'ceramic' ? 'brick' : 'stone';
  return { variant, edge, rnd: K.rng(seedOf(item, 'decor' + variant)), color: hexOf(P.color, null), color2: hexOf(P.color2, null) };
}
registerModel('garden-decor', {
  build({ w, d, h, p, item }) {
    const P = params(p), S = decorSetup(P, item), b = new Batch(), rnd = S.rnd, R = Math.min(w, d) / 2, flat = vmat('flat'), matte = vmat('matte'), col = S.color;
    const metal = K.metal(col || '#2b2d31'), wood = K.wood(col || '#a9774a'), stone = col || '#c9c2b4';
    switch (S.variant) {
      case 'rocks': {
        const n = clamp(Math.round(w * d * 5) + 3, 4, 9);
        for (let i = 0; i < n; i++) { const a = i * 2.39996, k = i === 0 ? 0.1 : 0.3 + 0.6 * Math.sqrt(i / n), s = i === 0 ? 0.5 : 0.18 + rnd() * 0.2; b.add(flat, rockG(w * s * 0.6, h * s * 1.1, d * s * 0.6, Math.cos(a) * w / 2 * k, Math.sin(a) * d / 2 * k, rnd, col || (i % 2 ? '#a8a297' : '#8f897e'))); }
        return b.fit(w, d, h).build();
      }
      case 'statue': {
        const ph = h * 0.16, rr = (h - ph) * 0.3, m = P.material === 'metal' ? vmat('metal') : vmat('satin'), c = col || (P.material === 'metal' ? '#8a6a44' : '#e9e6df');
        b.add(matte, boxOnG(w, ph, d, 0, 0, 0), S.color2 || '#8f8a82');
        const art = new Batch();
        art.add(m, new THREE.TorusGeometry(rr, rr * 0.42, 14, 36).scale(0.85, 1.25, 0.8).rotateY(0.5).translate(0, rr * 1.9, 0), c);
        art.add(m, sphG(rr * 0.36, rr * 0.25, rr * 3.6, 0, 16, 12), c);
        art.add(m, latheG([[rr * 0.5, 0], [rr * 0.34, rr * 0.3], [rr * 0.3, rr * 0.6]], 16), c);
        return b.merge(art.fit(w * 0.86, d * 0.86, h - ph), 0, ph, 0).build();
      }
      case 'bird-feeder': {
        const th = h * 0.62, hw = w / 2, hd = d / 2;
        b.add(wood, cylG(R * 0.1, R * 0.12, th, 0, 0, 0, 10)); b.add(wood, boxOnG(w * 0.5, 0.03, d * 0.5, 0, 0, 0));
        b.add(wood, boxOnG(w * 0.92, 0.025, d * 0.92, 0, th, 0)); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(wood, boxOnG(0.025, h * 0.2, 0.025, sx * hw * 0.78, th, sz * hd * 0.78));
        const y0 = th + h * 0.2;
        b.add(vmat('flat'), trisG([-hw, y0, hd, hw, y0, hd, 0, h, 0, hw, y0, hd, hw, y0, -hd, 0, h, 0, hw, y0, -hd, -hw, y0, -hd, 0, h, 0, -hw, y0, -hd, -hw, y0, hd, 0, h, 0, -hw, y0, -hd, hw, y0, -hd, hw, y0, hd, -hw, y0, -hd, hw, y0, hd, -hw, y0, hd]), S.color2 || '#7a4a34');
        return b.build();
      }
      case 'arch': {
        const r = 0.012, x0 = w / 2 - r, z0 = d / 2 - r, ra = x0, ys = Math.max(h * 0.3, h - ra - r), n = 12, m = K.metal(col || '#2b2d31');
        for (const sz of [-1, 1]) {
          const pts = [[-x0, 0, sz * z0], [-x0, ys, sz * z0]]; for (let i = 1; i <= n; i++) { const a = Math.PI - (i / n) * Math.PI; pts.push([Math.cos(a) * ra, ys + Math.sin(a) * (h - r - ys), sz * z0]); } pts.push([x0, 0, sz * z0]);
          b.add(m, tubeG(pts, r, 6));
        }
        for (let y = 0.25; y < ys; y += 0.3) for (const sx of [-1, 1]) b.add(m, barG([sx * x0, y, -z0], [sx * x0, y, z0], r * 0.7, 5));
        for (let i = 0; i <= n; i += 2) { const a = Math.PI - (i / n) * Math.PI; b.add(m, barG([Math.cos(a) * ra, ys + Math.sin(a) * (h - r - ys), -z0], [Math.cos(a) * ra, ys + Math.sin(a) * (h - r - ys), z0], r * 0.7, 5)); }
        const vine = new Batch();
        for (let i = 0; i < 9; i++) { const t = i / 8, y = t * (ys + 0.2), x = -x0 + (t > 0.85 ? (t - 0.85) * ra * 2 : 0); vine.add(vmat('leaf'), paintFoliage(blobG(0.12, 0.14, Math.min(0.12, z0), x + 0.02, y + 0.1, (rnd() - 0.5) * z0, rnd, { amp: 0.3 }), i % 2 ? '#4f8a3c' : '#5c9846', rnd)); if (i % 2) vine.add(vmat('leaf'), blobG(0.035, 0.03, 0.035, x + 0.1, y + 0.12, (rnd() - 0.5) * z0 * 1.5, rnd, { detail: 0, amp: 0.2 }), S.color2 || '#e8506a'); }
        for (const list of vine.buckets.values()) for (const g of list) { const a = g.attributes.position.array; for (let i = 0; i < a.length; i += 3) { a[i] = clamp(a[i], -w / 2, w / 2); a[i + 1] = clamp(a[i + 1], 0, h); a[i + 2] = clamp(a[i + 2], -d / 2, d / 2); } }
        return b.merge(vine).fit(w, d, h).build();
      }
      case 'obelisk': {
        const r = 0.011, top = [0, h * 0.93, 0];
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(metal, barG([sx * (w / 2 - r), 0, sz * (d / 2 - r)], top, r, 6));
        for (const t of [0.25, 0.5, 0.72]) { const k = 1 - t / 0.93, y = h * t, c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [sx * (w / 2 - r) * k, y, sz * (d / 2 - r) * k]); for (let i = 0; i < 4; i++) b.add(metal, barG(c[i], c[(i + 1) % 4], r * 0.75, 5)); }
        b.add(metal, sphG(h * 0.035, 0, h - h * 0.035, 0, 10, 8));
        return b.fit(w, d, h).build();
      }
      case 'stepping-stone': b.add(flat, paintFoliage(extrudeG(organicPts(w / 2, d / 2, rnd, 16, 0.07), h, 0), stone, rnd, { lo: -0.25, hi: 0.04, sparkle: 0.03 })); return b.build();
      case 'edging': {
        if (S.edge === 'steel') { b.add(matte, boxOnG(w, h, Math.min(d, 0.006), 0, 0, 0), col || '#6a4a38'); b.add(matte, boxOnG(w, h * 0.3, d, 0, 0, 0), K.shade(col || '#6a4a38', -0.2)); return b.build(); }
        const len = S.edge === 'wood' ? Math.max(0.05, d) : 0.2, n = Math.max(1, Math.round(w / len)), s = w / n;
        for (let i = 0; i < n; i++) {
          const x = -w / 2 + (i + 0.5) * s;
          if (S.edge === 'wood') b.add(wood, cylG(s / 2 - 0.002, s / 2 - 0.002, h * (0.9 + (i % 2) * 0.1), x, 0, 0, 10).scale(1, 1, d / s));
          else if (S.edge === 'brick') b.add(matte, boxOnG(s - 0.008, h * (0.93 + rnd() * 0.07), d, x, 0, 0), K.shade(col || '#a8563c', (rnd() - 0.5) * 0.25));
          else { const g = blobG(s * 0.54, h * 0.62, d * 0.56, x, h * 0.45, 0, rnd, { amp: 0.16, floor: 0 }), a = g.attributes.position.array; for (let j = 0; j < a.length; j += 3) { a[j] = clamp(a[j], -w / 2, w / 2); a[j + 1] = Math.min(a[j + 1], h); a[j + 2] = clamp(a[j + 2], -d / 2, d / 2); } b.add(flat, paintFoliage(g, K.shade(stone, (rnd() - 0.5) * 0.2), rnd, { lo: -0.2, hi: 0.1 })); }
        }
        return b.fit(w, d, h).build();
      }
      case 'sundial': {
        b.add(matte, latheG([[R * 0.75, 0], [R * 0.8, h * 0.04], [R * 0.45, h * 0.1], [R * 0.3, h * 0.25], [R * 0.26, h * 0.75], [R * 0.5, h * 0.86], [R * 0.95, h * 0.9], [R, h * 0.94], [0.001, h * 0.94]], 20), stone);
        b.add(vmat('metal'), cylG(R * 0.8, R * 0.8, h * 0.012, 0, h * 0.94, 0, 28), '#b8964e');
        b.add(vmat('metal'), trisG([0, h * 0.952, -R * 0.55, 0, h * 0.952, R * 0.5, 0, h, R * 0.5, 0, h * 0.952, R * 0.5, 0, h * 0.952, -R * 0.55, 0, h, R * 0.5]), '#8a6a3a');
        return b.fit(w, d, h).build();
      }
      case 'gnome': {
        const g = vmat('satin');
        b.add(g, latheG([[R * 0.5, 0], [R * 0.82, h * 0.03], [R * 0.9, h * 0.2], [R * 0.7, h * 0.42], [R * 0.4, h * 0.5]], 16), col || '#2f6db0');
        b.add(g, latheG([[R * 0.86, h * 0.02], [R * 0.95, h * 0.07], [R * 0.6, h * 0.1]], 16).translate(0, 0, R * 0.05), '#3a3028');
        b.add(g, sphG(R * 0.5, 0, h * 0.56, 0, 14, 10), '#f0c4a0'); b.add(g, sphG(R * 0.13, 0, h * 0.56, R * 0.5, 8, 6), '#e8a888');
        b.add(vmat('flat'), new THREE.ConeGeometry(R * 0.52, h * 0.3, 8).rotateX(Math.PI).translate(0, h * 0.44, R * 0.34), '#f4f1ea');
        b.add(g, new THREE.ConeGeometry(R * 0.6, h * 0.36, 14).translate(0, h * 0.82, 0), S.color2 || '#d8242c');
        return b.fit(w, d, h).build();
      }
      case 'sign': {
        const bh = Math.min(h * 0.4, 0.4);
        b.add(wood, boxOnG(Math.min(0.05, w * 0.15), h - bh * 0.3, Math.min(0.05, d * 0.6), 0, 0, -d * 0.15));
        b.add(K.wood(S.color2 || '#e3cfa8'), boxOnG(w, bh, d * 0.45, 0, h - bh, d * 0.275));
        for (let i = 0; i < 3; i++) b.add(matte, boxG(w * (0.7 - i * 0.12), bh * 0.07, 0.002, 0, h - bh * (0.3 + i * 0.2), d / 2 + 0.0005), '#4a3a2c');
        b.add(wood, boxOnG(w * 0.3, 0.02, d, 0, 0, 0));
        return b.fit(w, d, h).build();
      }
      case 'bridge': {
        const rise = Math.min(h * 0.32, w * 0.14), n = Math.max(6, Math.round(w / 0.11)), yAt = (x) => 0.03 + rise * (1 - (x / (w / 2)) ** 2), rh = h - rise - 0.03, zr = d / 2 - 0.03;
        for (let i = 0; i < n; i++) { const x = -w / 2 + (i + 0.5) * (w / n), sl = Math.atan(-2 * rise * x / (w / 2) ** 2); b.add(wood, boxG(w / n - 0.008, 0.025, d - 0.1, 0, 0, 0).rotateZ(sl).translate(x, yAt(x) + 0.0125, 0)); }
        for (const sz of [-1, 1]) {
          const arc = (y0) => Array.from({ length: 13 }, (_, i) => { const x = -w / 2 + 0.02 + (i / 12) * (w - 0.04); return [x, yAt(x) + y0, sz * zr]; });
          b.add(wood, tubeG(arc(-0.02), 0.03, 6)); b.add(wood, tubeG(arc(rh - 0.03), 0.028, 6)); b.add(wood, tubeG(arc(rh * 0.5), 0.016, 5));
          for (let i = 0; i <= 4; i++) { const x = -w / 2 + 0.05 + (i / 4) * (w - 0.1); b.add(wood, boxOnG(0.05, rh, 0.05, x, yAt(x), sz * zr)); }
        }
        return b.fit(w, d, h).build();
      }
      case 'wind-chime': {
        const m = K.metal(col || '#2b2d31'), cx = R * 0.45, cy = h * 0.8;
        b.add(m, cylG(R, R, 0.012, 0, 0, 0, 24)); 
        const pts = [[-R * 0.5, 0, 0], [-R * 0.5, h * 0.86, 0]]; for (let i = 1; i <= 8; i++) { const a = Math.PI - (i / 8) * Math.PI * 1.15; pts.push([-R * 0.5 + (cx + R * 0.5) / 2 * (1 + Math.cos(a)), h * 0.86 + Math.sin(a) * (h * 0.14 - 0.01), 0]); }
        b.add(m, tubeG(pts, 0.009, 6));
        const e = pts[pts.length - 1];
        b.add(m, barG(e, [cx, cy, 0], 0.0015, 3)); b.add(wood, cylG(R * 0.3, R * 0.3, 0.012, cx, cy, 0, 16));
        for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU, len = h * (0.16 + 0.03 * i), x = cx + Math.cos(a) * R * 0.22, z = Math.sin(a) * R * 0.22; b.add(vmat('metal'), cylG(0.008, 0.008, len, x, cy - 0.04 - len, z, 6), S.color2 || '#c9ccd0'); b.add(m, barG([x, cy, z], [x, cy - 0.04, z], 0.001, 3)); }
        b.add(m, barG([cx, cy, 0], [cx, cy - h * 0.34, 0], 0.001, 3)); b.add(wood, cylG(R * 0.1, R * 0.1, 0.01, cx, cy - h * 0.16, 0, 10)); b.add(wood, boxG(R * 0.22, R * 0.3, 0.004, cx, cy - h * 0.36, 0));
        return b.fit(w, d, h).build();
      }
      default: b.add(flat, rockG(w / 2, h * 0.6, d / 2, 0, 0, rnd, col || '#a8a297')); return b.fit(w, d, h).build();
    }
  },
  draw2d(ctx, { w, d, p, px, item }) {
    const P = params(p), S = decorSetup(P, item), rnd = S.rnd, R = Math.min(w, d) / 2, col = S.color, rock = (x, y, rx, ry, rot) => { pathPts(ctx, organicPts(rx, ry, rnd, 12, 0.1).map(([a, c]) => [x + a * Math.cos(rot) - c * Math.sin(rot), y + a * Math.sin(rot) + c * Math.cos(rot)])); ctx.fillStyle = K.tint(col || '#a8a297', 0.35); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke(); };
    const circle = (r, fill) => K.fillCircle(ctx, 0, 0, r, fill, INK, px);
    switch (S.variant) {
      case 'rocks': { const n = clamp(Math.round(w * d / 2000) + 3, 4, 9); for (let i = n - 1; i >= 0; i--) { const a = i * 2.39996, k = i === 0 ? 0.1 : 0.3 + 0.45 * Math.sqrt(i / n), s = i === 0 ? 0.5 : 0.22 + rnd() * 0.14; rock(Math.cos(a) * w / 2 * k, Math.sin(a) * d / 2 * k, w * s * 0.55, d * s * 0.55, rnd() * 3); } break; }
      case 'statue': K.fillRR(ctx, 0, 0, w, d, 1, K.tint(S.color2 || '#8f8a82', 0.4), INK, px); ctx.beginPath(); ctx.ellipse(0, 0, R * 0.62, R * 0.3, 0.5, 0, TAU); ctx.fillStyle = K.tint(col || '#e9e6df', 0.2); ctx.fill(); ctx.stroke(); break;
      case 'bird-feeder': K.fillRR(ctx, 0, 0, w, d, 1, K.tint(S.color2 || '#7a4a34', 0.4), INK, px); K.line(ctx, -w / 2, -d / 2, w / 2, d / 2, INK, px); K.line(ctx, w / 2, -d / 2, -w / 2, d / 2, INK, px); break;
      case 'arch': for (const sz of [-1, 1]) K.line(ctx, -w / 2, sz * (d / 2 - px), w / 2, sz * (d / 2 - px), INK, px * 1.5); for (let i = 0; i <= 6; i++) K.line(ctx, -w / 2 + (i / 6) * w, -d / 2, -w / 2 + (i / 6) * w, d / 2, K.INK_SOFT, px); ctx.save(); ctx.translate(-w / 2 + d * 0.4, 0); canopy2D(ctx, d * 0.45, d * 0.5, '#4f8a3c', rnd, px, { clumps: 0, accent: S.color2 || '#e8506a', dots: 4, dotR: 0.12 }); ctx.restore(); break;
      case 'obelisk': ctx.strokeStyle = INK; ctx.lineWidth = px; for (const k of [1, 0.72, 0.45, 0.22]) ctx.strokeRect(-w / 2 * k, -d / 2 * k, w * k, d * k); K.line(ctx, -w / 2, -d / 2, w / 2, d / 2, INK, px); K.line(ctx, w / 2, -d / 2, -w / 2, d / 2, INK, px); dot(ctx, 0, 0, Math.max(1.5 * px, R * 0.1), INK); break;
      case 'stepping-stone': pathPts(ctx, organicPts(w / 2, d / 2, rnd, 16, 0.07)); ctx.fillStyle = K.tint(col || '#c9c2b4', 0.3); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = px; ctx.stroke(); break;
      case 'edging': { K.fillRR(ctx, 0, 0, w, d, S.edge === 'stone' ? d * 0.3 : 0, K.tint(col || { steel: '#6a4a38', wood: '#a9774a', brick: '#a8563c', stone: '#c9c2b4' }[S.edge], 0.35), INK, px); const len = S.edge === 'wood' ? Math.max(5, d) : 20, n = Math.max(1, Math.round(w / len)); if (S.edge !== 'steel' && w / n / px > 3) for (let i = 1; i < n; i++) K.line(ctx, -w / 2 + (i / n) * w, -d / 2, -w / 2 + (i / n) * w, d / 2, K.INK_SOFT, px); break; }
      case 'sundial': circle(R, K.tint(col || '#c9c2b4', 0.3)); circle(R * 0.8, '#e6d6a8'); for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; K.line(ctx, Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62, Math.cos(a) * R * 0.76, Math.sin(a) * R * 0.76, INK, px); } K.line(ctx, 0, -R * 0.5, 0, R * 0.5, INK, px * 2); break;
      case 'gnome': circle(R, K.tint(col || '#2f6db0', 0.35)); circle(R * 0.6, K.tint(S.color2 || '#d8242c', 0.2)); dot(ctx, 0, 0, Math.max(px, R * 0.08), INK); break;
      case 'sign': K.fillRR(ctx, 0, d * 0.275, w, d * 0.45, 0, K.tint(S.color2 || '#e3cfa8', 0.3), INK, px); K.fillRR(ctx, 0, -d * 0.15, Math.min(5, w * 0.15), Math.min(5, d * 0.6), 0, K.tint(col || '#a9774a', 0.2), INK, px); break;
      case 'bridge': { K.fillRR(ctx, 0, 0, w, d - 6, 0, K.tint(col || '#a9774a', 0.4), INK, px); const n = Math.max(6, Math.round(w / 11)); if (w / n / px > 3) for (let i = 1; i < n; i++) K.line(ctx, -w / 2 + (i / n) * w, -d / 2 + 5, -w / 2 + (i / n) * w, d / 2 - 5, K.INK_SOFT, px); for (const sz of [-1, 1]) { K.fillRR(ctx, 0, sz * (d / 2 - 3), w, 6, 1, K.tint(col || '#a9774a', 0.15), INK, px); for (let i = 0; i <= 4; i++) K.fillRR(ctx, -w / 2 + 5 + (i / 4) * (w - 10), sz * (d / 2 - 3), 5, 5, 0, '#8a6a40', null); } break; }
      case 'wind-chime': circle(R, 'rgba(120,125,130,0.18)'); K.line(ctx, -R * 0.5, 0, R * 0.45, 0, INK, px * 1.5); dot(ctx, -R * 0.5, 0, Math.max(1.5 * px, 1.5), INK); K.fillCircle(ctx, R * 0.45, 0, R * 0.3, K.tint('#a9774a', 0.3), INK, px); for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; dot(ctx, R * 0.45 + Math.cos(a) * R * 0.22, Math.sin(a) * R * 0.22, Math.max(px, 1), '#6a6d72'); } break;
      default: rock(0, 0, w / 2, d / 2, 0);
    }
  },
});
