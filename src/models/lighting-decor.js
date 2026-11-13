/**
 * Lighting & décor models: floor-lamp, table-lamp, pendant, ceiling-light, wall-light, ceiling-fan,
 * rug, wall-art, curtain, plant, vase, cushion.  See docs/CONTRACT.md § 3.
 *
 * Every builder lays the object out for the requested w × d × h box and is then passed through `fit()`,
 * which snaps the (already near-exact) bounding box onto the box, so real product dimensions are always honoured.
 */
import * as THREE from 'three';
import { registerModel } from './registry.js';
import { MODEL_TYPES } from './types.js';
import * as K from './kit.js';

// ───────────────────────── utilities ─────────────────────────
const TAU = Math.PI * 2;
const WARM = '#ffd9a6';
const DARK = '#2a2b2e';
const BRASS = '#b8975a';
const CREAM = '#f3ead8';
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const MATS = ['fabric', 'leather', 'velvet', 'wood', 'metal', 'rattan', 'plastic', 'glass', 'stone', 'ceramic', 'concrete', 'laminate', 'lacquer', 'aluminium', 'teak', 'textile'];

const clamp = (v, lo, hi) => Math.min(Math.max(hi, lo), Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const pos = (v, fb) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fb);
const obj = (p) => (p && typeof p === 'object' ? p : {});
const pick = (v, list) => (list.includes(v) ? v : list[0]);
const isOn = (p) => p.on !== false && p.on !== 'false' && p.on !== 0;
const truthy = (v) => v === true || v === 'true' || v === 1;
const seedOf = (item, salt) => K.hashStr(String((item && item.id) || salt));

function num(v, fb, lo = -Infinity, hi = Infinity) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? clamp(n, lo, hi) : fb;
}
const int = (v, fb, lo, hi) => Math.round(num(v, fb, lo, hi));

/** Validated colour: hex string or kit keyword, otherwise the fallback. */
function hex(c, fb) {
  if (typeof c === 'string') {
    if (HEX.test(c)) return c;
    const k = K.col(c, '');
    if (HEX.test(k)) return k;
  }
  return fb;
}
function rgba(c, a) {
  const k = new THREE.Color(hex(c, '#888888'));
  return `rgba(${Math.round(k.r * 255)},${Math.round(k.g * 255)},${Math.round(k.b * 255)},${a})`;
}
const matOf = (m, color, fb) => K.byMaterial(MATS.includes(m) ? m : fb, color);
const dbl = (color, opts = {}) => K.mat(color, { roughness: 0.9, ...opts, side: THREE.DoubleSide });
const noShadow = (m) => { m.userData.noShadow = true; m.castShadow = false; return m; };
const add = (g, ...c) => { c.flat().forEach((m) => m && g.add(m)); return g; };

const _memo = new Map();
function memo(key, make, cap = 120) {
  if (_memo.has(key)) return _memo.get(key);
  const v = make();
  _memo.set(key, v);
  if (_memo.size > cap) {                       // drop the oldest entry (textures re-upload on demand if still in use)
    const [k0, v0] = _memo.entries().next().value;
    _memo.delete(k0);
    if (v0 && v0.map && v0.map.dispose) v0.map.dispose();
  }
  return v;
}
function mkCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h));
  return c;
}
function canvasTex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
/** Cached textured material. paint(g, W, H) draws on a small canvas; opts are MeshStandardMaterial params. */
function texMat(key, W, H, paint, opts = {}, repeat = null) {
  return memo(key, () => {
    const c = mkCanvas(W, H);
    const m = new THREE.MeshStandardMaterial({ roughness: 0.92, ...opts });
    if (c) { paint(c.getContext('2d'), c.width, c.height); m.map = canvasTex(c, repeat); }
    return m;
  });
}

/** Invisible mesh that states the nominal product box (used where the visible geometry legitimately does not fill it). */
function bounds(w, d, h) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), memo('bounds', () => new THREE.MeshBasicMaterial({ visible: false })));
  m.position.y = h / 2; m.userData.noShadow = true; m.userData.isBounds = true;
  return m;
}

/** Snap the bounding box of `g` exactly onto x∈[-w/2,w/2], y∈[0,h], z∈[-d/2,d/2] (lights are ignored). */
function fit(g, w, d, h) {
  g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(g, true);
  if (b.isEmpty()) return g;
  const s = b.getSize(new THREE.Vector3());
  const f = (want, have) => (have > 1e-5 && Math.abs(want / have - 1) > 5e-4 ? want / have : 1);
  const sx = f(w, s.x), sy = f(h, s.y), sz = f(d, s.z);
  const out = new THREE.Group();
  out.scale.set(sx, sy, sz);
  out.position.set(-(b.min.x + b.max.x) / 2 * sx, -b.min.y * sy, -(b.min.z + b.max.z) / 2 * sz);
  out.add(g);
  const root = new THREE.Group();
  root.add(out);
  return root;
}

/** Register a type with sanitised inputs, default sizes from types.js and the exact-fit pass. */
function reg(type, build, draw) {
  const s = (MODEL_TYPES[type] || {}).size || { w: 50, d: 50, h: 50 };
  registerModel(type, {
    build(a) {
      const { w, d, h, p, item } = a || {};
      const W = pos(w, s.w / 100), D = pos(d, s.d / 100), H = pos(h, s.h / 100);
      return fit(build(W, D, H, obj(p), item), W, D, H);
    },
    draw2d(ctx, a) {
      const { w, d, h, p, px, item } = a || {};
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      draw(ctx, pos(w, s.w), pos(d, s.d), pos(h, s.h), obj(p), pos(px, 1), item);
    },
  });
}

// ───────────────────────── geometry helpers ─────────────────────────
/**
 * Surface of revolution from a profile [[radius, y], …] listed bottom → top for outward-facing walls.
 * Listing a point twice makes a crisp corner there (otherwise the profile is smooth-shaded).
 */
function lathe(pts, material, seg = 28) {
  const v = [];
  const nudge = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, e = Math.min(0.0004, l * 0.3);
    return new THREE.Vector2(Math.max(0, a[0] + dx / l * e), a[1] + dy / l * e);
  };
  const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], prev = pts[i - 1], next = pts[i + 1];
    if (same(a, next) && prev && !same(a, prev)) v.push(nudge(a, prev));
    else if (same(a, prev) && next && !same(a, next)) v.push(nudge(a, next));
    else if (!same(a, prev)) v.push(new THREE.Vector2(Math.max(0, a[0]), a[1]));
  }
  return new THREE.Mesh(new THREE.LatheGeometry(v, seg), material);
}
/** Thin closed shell (lamp shades): outer profile bottom → top, wall thickness t. */
function shell(outer, t = 0.003) {
  const inner = outer.map(([r, y]) => [Math.max(0.0005, r - t), y]).reverse();
  const o0 = outer[0], on = outer[outer.length - 1], i0 = inner[0], il = inner[inner.length - 1];
  return [...outer, on, i0, ...inner, il, o0, o0];
}
/** Smooth a profile with a spline (keeps the first point as a sharp base corner). */
function smooth(pts, n = 16) {
  const c = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y)));
  return c.getPoints(n).map((q) => [Math.max(0, q.x), q.y]);
}
const domePts = (r, hh, r0 = 0.012, n = 8) => Array.from({ length: n + 1 }, (_, i) => {
  const t = (i / n) * Math.PI / 2;
  return [Math.max(Math.min(r0, r * 0.5), r * Math.cos(t)), hh * Math.sin(t)];
});
function at(m, x, y, z) { m.position.set(x, y, z); return m; }
const xcyl = (r, len, material, x, y, z, seg = 12) => { const m = K.cyl(r, r, len, material, x, y, z, seg); m.rotation.z = Math.PI / 2; return m; };
function tube(pts, radius, material, segs = 24, radial = 8) {
  const c = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(q[0], q[1], q[2])), false, 'catmullrom', 0.5);
  const m = new THREE.Mesh(new THREE.TubeGeometry(c, segs, radius, radial, false), material);
  m.castShadow = true;
  return m;
}
function torus(R, t, material, arc = TAU, seg = 40) {
  return new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.001, R), Math.max(0.0005, t), 6, seg, arc), material);
}
const M4 = (x, y, z, yaw = 0, pitch = 0, roll = 0) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(roll, yaw, pitch, 'YZX')), new THREE.Vector3(1, 1, 1));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Accumulates loose triangles into ONE flat-shaded mesh (foliage, slats, louvres) — keeps mesh counts low. */
function tris() {
  const p = [];
  const api = {
    tri(a, b, c) { p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); return api; },
    quad(a, b, c, d) { return api.tri(a, b, c).tri(a, c, d); },
    /** n-sided prism between two points (stems, canes); r1 allows a taper. */
    stick(a, b, r0, r1 = r0, n = 4) {
      const dir = b.clone().sub(a);
      if (dir.lengthSq() < 1e-10) return api;
      dir.normalize();
      const u = new THREE.Vector3().crossVectors(Math.abs(dir.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0), dir).normalize();
      const w = new THREE.Vector3().crossVectors(dir, u);
      const ring = (c, r, i) => { const t = (i / n) * TAU; return c.clone().addScaledVector(u, Math.cos(t) * r).addScaledVector(w, Math.sin(t) * r); };
      for (let i = 0; i < n; i++) api.quad(ring(a, r0, i), ring(a, r0, i + 1), ring(b, r1, i + 1), ring(b, r1, i));
      return api;
    },
    /** Box of size (sx, sy, sz) transformed by matrix m. */
    box(m, sx, sy, sz) {
      const c = [];
      for (let i = 0; i < 8; i++) c.push(V((i & 1 ? 0.5 : -0.5) * sx, (i & 2 ? 0.5 : -0.5) * sy, (i & 4 ? 0.5 : -0.5) * sz).applyMatrix4(m));
      [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]].forEach((f) => api.quad(c[f[0]], c[f[1]], c[f[2]], c[f[3]]));
      return api;
    },
    /** Jittered low-poly blob (crown masses). */
    blob(cx, cy, cz, rx, ry, rz, s = 1) {
      const src = memo('ico1', () => new THREE.IcosahedronGeometry(1, 1).attributes.position.array);
      const q = [];
      for (let i = 0; i < src.length; i += 3) {
        const x = src[i], y = src[i + 1], z = src[i + 2];
        const f = 1 + 0.16 * Math.sin(x * 5.1 + s) * Math.cos(y * 4.3 + s * 1.7) + 0.08 * Math.sin(z * 6.7 + s * 0.6);
        q.push(V(cx + x * f * rx, cy + y * f * ry, cz + z * f * rz));
      }
      for (let i = 0; i < q.length; i += 3) api.tri(q[i], q[i + 1], q[i + 2]);
      return api;
    },
    mesh(material) {
      if (!p.length) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, material);
    },
  };
  return api;
}

// ───────────────────────── lamp parts ─────────────────────────
const shadeMat = (p, on, fb = CREAM) => { const c = hex(p.shade, fb); return on ? K.glow(c, 0.7) : K.fabric(c); };
const opal = (on, c = '#fff3dc') => (on ? K.glow(c, 0.95) : K.mat(K.shade(c, 0.1), { roughness: 0.3 }));
const bulbMat = (on) => (on ? K.glow('#fff0cf', 1.8) : K.mat('#efe9dc', { roughness: 0.3 }));
const linerMat = (on) => (on ? K.glow('#fff1d0', 0.85) : K.mat('#f1ece0', { roughness: 0.6 }));
const addLight = (g, p, on, x, y, z, intensity = 1, distance = 4.5) => { if (on) g.add(K.lampLight(hex(p.lightColor, WARM), intensity, distance, x, y, z)); };
const disc = (r, t, material, x = 0, y0 = 0, z = 0) => K.cylOn(r, r, t, material, x, y0, z, 32);
const pole = (y0, y1, r, material, x = 0, z = 0) => (y1 - y0 > 0.002 ? K.cylOn(r, r, y1 - y0, material, x, y0, z, 10) : null);

/** Opaque dome / cone shade open at the bottom, with lit liner and bulb. Occupies y ∈ [0, hh]. */
function domeShade(r, hh, outer, on, cone = false) {
  const r0 = Math.min(r * 0.5, cone ? 0.022 : 0.012);
  const pts = cone ? [[r, 0], [r0, hh]] : domePts(r, hh, r0);
  const top = pts[pts.length - 1];
  const g = new THREE.Group(), seg = r < 0.1 ? 18 : 28;
  g.add(lathe([...pts, top, [0, hh]], outer, seg));
  const e = Math.min(0.003, hh * 0.06);
  g.add(noShadow(lathe(pts.map(([a, b]) => [Math.max(0.001, a - e), b - e]).reverse(), linerMat(on), seg)));
  const br = clamp(r * 0.22, 0.008, 0.035);
  g.add(noShadow(K.sphere(br, bulbMat(on), 0, Math.max(br, hh * 0.3), 0, 12, 8)));
  return g;
}
/** Tapered fabric drum shade occupying y ∈ [y0, y0 + hh]. */
const drum = (rb, rt, hh, material, y0 = 0) => at(lathe(shell([[rb, 0], [rt, hh]]), material), 0, y0, 0);

/** Candle lantern: framed glass box with a small roof and a ring handle. Fills w × d × h. */
function lanternBox(w, d, h, frame, on) {
  const g = new THREE.Group(), m = Math.min(w, d);
  const t = clamp(m * 0.07, 0.005, 0.018), ringR = clamp(m * 0.16, 0.01, 0.05), rt = clamp(ringR * 0.14, 0.0015, 0.005);
  const roofH = Math.min(h * 0.18, m * 0.45), bodyTop = Math.max(h * 0.4, h - roofH - ringR * 2 - t);
  g.add(K.boxOn(w, t, d, frame), K.boxOn(w, t, d, frame, 0, bodyTop, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(K.boxOn(t, bodyTop - t, t, frame, sx * (w - t) / 2, t, sz * (d - t) / 2));
  const glass = K.glass('#dbe9ee', 0.22);
  g.add(noShadow(K.box(w - t, bodyTop - t, 0.002, glass, 0, (bodyTop + t) / 2, (d - t) / 2)), noShadow(K.box(w - t, bodyTop - t, 0.002, glass, 0, (bodyTop + t) / 2, -(d - t) / 2)));
  g.add(noShadow(K.box(0.002, bodyTop - t, d - t, glass, (w - t) / 2, (bodyTop + t) / 2, 0)), noShadow(K.box(0.002, bodyTop - t, d - t, glass, -(w - t) / 2, (bodyTop + t) / 2, 0)));
  const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1), frame), roof = new THREE.Group();
  cone.rotation.y = Math.PI / 4; roof.add(cone); roof.scale.set(w * 0.96, roofH, d * 0.96); roof.position.y = bodyTop + t + roofH / 2;
  const ring = torus(ringR - rt, rt, frame, TAU, 20);
  ring.position.y = h - ringR;
  const cr = m * 0.15, ch = (bodyTop - t) * 0.42, fh = clamp(ch * 0.35, 0.008, 0.03);
  const flame = noShadow(K.sphere(fh / 2, on ? K.glow('#ffd58a', 2) : K.mat('#f0e6d0'), 0, t + ch + 0.006 + fh / 2, 0, 10, 8));
  flame.scale.set(0.45, 1, 0.45);
  g.add(roof, ring, K.cylOn(cr, cr, ch, K.mat('#f3ecdd', { roughness: 0.5 }), 0, t, 0, 16), K.cylOn(0.001, 0.001, 0.008, K.mat('#333333'), 0, t + ch, 0, 5), flame);
  g.userData.bulbY = t + ch + fh;
  return g;
}

// ───────────────────────── floor-lamp ─────────────────────────
const FLOOR_V = ['shade', 'arc', 'tripod', 'reading', 'torchiere', 'paper', 'globe'];

function arcLamp(L, S, h, p, on, body, pr) {
  const g = new THREE.Group();
  const baseR = clamp(Math.min(S / 2, L * 0.18), 0.04, 0.2), rs = clamp(Math.min(S / 2, L * 0.26), 0.05, 0.3);
  const x0 = -L / 2 + baseR, x1 = L / 2 - rs, sp = x1 - x0, bt = clamp(h * 0.02, 0.015, 0.045);
  const sh = rs * 0.75, ys = h * 0.8 - sh;
  g.add(disc(baseR, bt, K.stone(hex(p.color2, '#e6e2da')), x0));
  g.add(tube([[x0, bt * 0.5, 0], [x0, h * 0.45, 0], [x0 + sp * 0.1, h * 0.8, 0], [x0 + sp * 0.45, h - pr, 0], [x0 + sp * 0.82, h * 0.94, 0], [x1, h * 0.8 + 0.02, 0]], pr, body, 40));
  g.add(at(domeShade(rs, sh, matOf(p.material2, hex(p.shade, hex(p.color, DARK)), 'metal'), on), x1, ys, 0));
  addLight(g, p, on, x1, ys + sh * 0.3, 0, 1.1, 5);
  return g;
}

function floorLamp(w, d, h, p) {
  const g = new THREE.Group(), v = pick(p.variant, FLOOR_V), on = isOn(p), r = Math.min(w, d) / 2;
  const tri = v === 'tripod';
  const body = matOf(p.material, hex(p.color, tri ? '#c8a476' : DARK), tri ? 'wood' : 'metal');
  const pr = clamp(r * 0.07, 0.008, 0.014), bt = clamp(h * 0.014, 0.012, 0.03), rb = clamp(r * 0.62, 0.04, 0.16);
  if (v === 'arc') {
    const a = w >= d ? arcLamp(w, d, h, p, on, body, pr) : arcLamp(d, w, h, p, on, body, pr);
    if (w < d) a.rotation.y = -Math.PI / 2;
    return add(g, a);
  }
  let ly = h * 0.85, lz = 0;
  if (v === 'shade') {
    const sh = Math.min(clamp(h * 0.2, 0.16, 0.36), h * 0.5);
    add(g, disc(rb, bt, body), pole(bt, h - sh * 0.45, pr, body), drum(r, r * 0.8, sh, shadeMat(p, on), h - sh));
    add(g, noShadow(K.sphere(clamp(r * 0.2, 0.015, 0.035), bulbMat(on), 0, h - sh * 0.5, 0, 12, 8)));
    ly = h - sh * 0.5;
  } else if (tri) {
    const sh = Math.min(clamp(h * 0.24, 0.18, 0.42), h * 0.5), ya = h - sh * 0.9, lr = clamp(r * 0.06, 0.009, 0.016);
    for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + i * TAU / 3; g.add(K.bar([0, ya, 0], [Math.cos(a) * r * 0.9, lr * 0.4, Math.sin(a) * r * 0.9], lr, body, 8)); }
    add(g, K.cyl(lr * 2.4, lr * 2.4, 0.03, K.metal(hex(p.color2, DARK)), 0, ya, 0, 14), drum(r, r * 0.9, sh, shadeMat(p, on), h - sh));
    add(g, noShadow(K.sphere(clamp(r * 0.18, 0.015, 0.035), bulbMat(on), 0, h - sh * 0.5, 0, 12, 8)));
    ly = h - sh * 0.5;
  } else if (v === 'reading') {
    const rbb = clamp(Math.min(w / 2, d * 0.3), 0.03, 0.15), rh = clamp(w * 0.32, 0.03, 0.09), zb = -d / 2 + rbb, z1 = d / 2 - rh * 1.25, lzz = z1 - zb, hy = h * 0.86;
    add(g, disc(rbb, bt, body, 0, 0, zb));
    g.add(tube([[0, bt, zb], [0, h * 0.45, zb], [0, h * 0.84, zb], [0, h - pr, zb + lzz * 0.32], [0, h * 0.955, zb + lzz * 0.75], [0, hy + rh * 0.9, z1]], pr * 0.8, body, 36));
    const head = domeShade(rh, rh * 1.3, matOf(p.material2, hex(p.shade, hex(p.color, DARK)), 'metal'), on, true);
    const hg = new THREE.Group(); head.position.y = -rh * 1.3; hg.add(head); hg.rotation.x = -0.55; hg.position.set(0, hy + rh * 0.95, z1);
    g.add(hg);
    ly = hy; lz = z1 + rh * 0.3;
  } else if (v === 'torchiere') {
    const bh = clamp(r * 0.55, 0.05, 0.18);
    add(g, disc(rb, bt, body), pole(bt, h - bh, pr, body));
    add(g, at(lathe([[0, 0], [pr * 1.5, 0], [r * 0.55, bh * 0.45], [r, bh], [r, bh], [r * 0.94, bh], [r * 0.5, bh * 0.55], [0, bh * 0.3]], matOf(p.material2, hex(p.shade, hex(p.color, DARK)), 'metal')), 0, h - bh, 0));
    add(g, noShadow(disc(r * 0.8, 0.003, linerMat(on), 0, h - bh * 0.2, 0)));
    ly = h - bh * 0.1;
  } else if (v === 'paper') {
    const y0 = clamp(h * 0.04, 0.02, 0.07), n = clamp(Math.round(h / 0.06), 6, 26), pts = [[0, y0]];
    for (let i = 0; i <= n; i++) { const t = i / n; pts.push([r * (0.88 + 0.12 * Math.sin(Math.PI * t)) * (i % 2 ? 1 : 0.975), lerp(y0, h, t)]); }
    pts.push([0, h]);
    add(g, disc(r * 0.55, y0, body), noShadow(lathe(pts, shadeMat(p, on, '#fbf3e2'))));
    ly = h * 0.5;
  } else {                                                   // globe
    const rg = Math.min(r, h * 0.25), rbase = rg < r - 0.005 ? r : rb;
    add(g, disc(rbase, bt, body), pole(bt, h - rg * 1.9, pr, body), K.cyl(pr * 2.2, pr * 2.2, 0.025, body, 0, h - rg * 1.93, 0, 14));
    add(g, noShadow(K.sphere(rg, on ? K.glow(hex(p.shade, '#fff3dc'), 0.95) : K.mat(hex(p.shade, '#f4f1ea'), { roughness: 0.25 }), 0, h - rg, 0, 28, 18)));
    ly = h - rg;
  }
  addLight(g, p, on, 0, ly, lz, 1.1, 5);
  return g;
}

// ───────────────────────── table-lamp ─────────────────────────
const TABLE_V = ['shade', 'dome', 'globe', 'desk', 'mushroom', 'lantern'];

function tableLamp(w, d, h, p) {
  const g = new THREE.Group(), v = pick(p.variant, TABLE_V), on = isOn(p), r = Math.min(w, d) / 2;
  const metal = matOf(p.material, hex(p.color, DARK), 'metal'), sr = clamp(r * 0.06, 0.004, 0.009);
  let ly = h * 0.75, lz = 0;
  if (v === 'shade') {
    const bh = h * 0.55, sh = h * 0.42;
    const prof = smooth([[0.42 * r, 0], [0.6 * r, 0.2 * bh], [0.52 * r, 0.52 * bh], [0.2 * r, 0.85 * bh], [0.13 * r, bh]], 14);
    add(g, lathe([[0, 0], [0.42 * r, 0], ...prof, [0, bh]], matOf(p.material, hex(p.color, '#e4dccd'), 'ceramic')));
    add(g, pole(bh, h - sh * 0.5, sr, K.metal(hex(p.color2, BRASS))), drum(r, r * 0.72, sh, shadeMat(p, on), h - sh));
    add(g, noShadow(K.sphere(clamp(r * 0.2, 0.01, 0.03), bulbMat(on), 0, h - sh * 0.5, 0, 12, 8)));
    ly = h - sh * 0.5;
  } else if (v === 'dome') {
    const dh = Math.min(r * 0.8, h * 0.45), bt = clamp(h * 0.035, 0.008, 0.02);
    add(g, disc(r * 0.6, bt, metal), pole(bt, h - dh * 0.3, sr, K.metal(hex(p.color2, hex(p.color, DARK)))), at(domeShade(r, dh, matOf(p.material2, hex(p.shade, hex(p.color, DARK)), 'metal'), on), 0, h - dh, 0));
    ly = h - dh * 0.7;
  } else if (v === 'globe') {
    const rg = Math.min(r, h / 2.25), hb = Math.max(0.01, h - rg * 1.9);
    add(g, lathe([[0, 0], [rg * 0.5, 0], [rg * 0.5, 0], [rg * 0.42, hb], [rg * 0.42, hb], [0, hb]], K.metal(hex(p.color, BRASS))));
    add(g, noShadow(K.sphere(rg, on ? K.glow(hex(p.shade, '#fff3dc'), 0.95) : K.mat(hex(p.shade, '#f4f1ea'), { roughness: 0.25 }), 0, h - rg, 0, 26, 16)));
    ly = h - rg;
  } else if (v === 'desk') {
    const rbb = clamp(Math.min(w, d) * 0.3, 0.03, 0.1), rh = clamp(w * 0.42, 0.025, 0.08), zb = -d / 2 + rbb, z1 = d / 2 - rh, bt = clamp(h * 0.03, 0.008, 0.02);
    const el = [0, h - sr * 2, zb + (z1 - zb) * 0.12], hd = [0, h * 0.72, z1 - rh * 0.2], ar = clamp(r * 0.045, 0.004, 0.007);
    add(g, disc(rbb, bt, metal, 0, 0, zb), K.bar([0, bt, zb], el, ar, metal, 8), K.bar(el, hd, ar, metal, 8), K.sphere(ar * 2, metal, el[0], el[1], el[2], 10, 8));
    const head = domeShade(rh, rh * 1.15, matOf(p.material2, hex(p.shade, hex(p.color, DARK)), 'metal'), on, true);
    const hg = new THREE.Group(); head.position.y = -rh * 1.15; hg.add(head); hg.rotation.x = -0.5; hg.position.set(hd[0], hd[1], hd[2]);
    g.add(hg);
    ly = h * 0.6; lz = z1;
  } else if (v === 'mushroom') {
    const capH = h * 0.42, sy = h - capH;
    add(g, lathe(smooth([[0.5 * r, 0], [0.44 * r, 0.03 * h], [0.2 * r, sy * 0.6], [0.15 * r, sy + 0.01]], 12), matOf(p.material, hex(p.color, '#e9e3d6'), 'lacquer')));
    const cap = [...domePts(r, capH, 0.004, 10), [0, capH]];
    add(g, at(noShadow(lathe([[0, capH * 0.12], [r * 0.9, 0.004], [r, 0], ...cap.slice(1)], shadeMat(p, on, hex(p.color, '#f2ead9')))), 0, sy, 0));
    ly = sy + capH * 0.3;
  } else {
    const lb = lanternBox(w, d, h, metal, on);
    g.add(lb); ly = lb.userData.bulbY;
  }
  addLight(g, p, on, 0, ly, lz, 0.8, 3.5);
  return g;
}

// ───────────────────────── pendant ─────────────────────────
const PEND_V = ['dome', 'globe', 'cone', 'cylinder', 'rattan', 'linear', 'cluster', 'chandelier', 'sputnik', 'paper', 'drum', 'ring'];

function weaveMat(color) {
  return texMat('weave|' + color, 64, 64, (c) => {
    c.clearRect(0, 0, 64, 64); c.strokeStyle = '#ffffff';
    c.lineWidth = 6; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(0, 8 + i * 16); c.lineTo(64, 8 + i * 16); c.stroke(); }
    c.lineWidth = 4; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(4 + i * 16, 0); c.lineTo(12 + i * 16, 64); c.stroke(); }
  }, { color: new THREE.Color(color), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }, [12, 5]);
}
function clusterLayout(n, r) {
  const rg = clamp(r * 0.42 * Math.pow(5 / n, 0.45), 0.015, r), pts = [{ x: 0, z: 0, k: 0 }];
  for (let i = 1; i < n; i++) { const a = (i - 1) * TAU / (n - 1) + 0.5; pts.push({ x: Math.cos(a) * (r - rg), z: Math.sin(a) * (r - rg), k: 0.15 + 0.85 * ((i * 0.618) % 1) }); }
  return { rg, pts };
}
const linearCount = (p, w, d) => int(p.count, clamp(Math.round(Math.max(w, d) / Math.max(0.2, Math.min(w, d) * 1.25)), 2, 6), 1, 12);

function pendant(w, d, h, p) {
  const g = new THREE.Group(), v = pick(p.variant, PEND_V), on = isOn(p), r = Math.min(w, d) / 2;
  const fancy = v === 'chandelier' || v === 'sputnik' || v === 'ring';
  const metal = matOf(p.material, hex(p.color, fancy ? BRASS : DARK), 'metal');
  const cordM = K.mat(hex(p.color2, '#2b2b2b'), { roughness: 0.8 });
  const ch = Math.min(0.025, h * 0.1), cr = clamp(r * 0.3, 0.03, 0.06), top = h - ch;
  const cord = (y0, x = 0, z = 0, cr0 = 0.0015) => pole(y0, top + 0.001, cr0, cordM, x, z);
  const n = v === 'linear' ? linearCount(p, w, d) : 1;
  const L = Math.max(w, d), S = Math.min(w, d), rsL = Math.min(S / 2, (L / n) / 2 * 0.9);
  const nat = { dome: r * 0.95, globe: 2 * r, cone: r * 1.15, cylinder: Math.max(2.4 * r, 0.12), rattan: r * 1.35, linear: rsL * 0.95, cluster: r, chandelier: r * 1.25, sputnik: 2 * r, paper: r * 1.75, drum: r * 0.85, ring: clamp(r * 0.1, 0.02, 0.05) }[v];
  const dropM = num(p.drop, NaN, 0, 2000) / 100;
  const hi = Math.max(0.02, top - 0.02);
  const sh = clamp(Number.isFinite(dropM) ? top - dropM : nat, Math.min(nat * 0.6, hi), Math.min(nat * 1.5, hi));
  let ly = sh * 0.5;
  if (v !== 'linear' && v !== 'cluster') g.add(K.cyl(cr, cr, ch, metal, 0, h - ch / 2, 0, 24));

  if (v === 'dome' || v === 'cone') {
    add(g, domeShade(r, sh, matOf(p.material, hex(p.shade, hex(p.color, DARK)), 'metal'), on, v === 'cone'), cord(sh));
    ly = sh * 0.3;
  } else if (v === 'globe') {
    const s = noShadow(K.sphere(r, on ? K.glow(hex(p.shade, '#fff3dc'), 0.95) : K.mat(hex(p.shade, '#f4f1ea'), { roughness: 0.25 }), 0, sh / 2, 0, 28, 18));
    s.scale.y = sh / (2 * r);
    add(g, s, K.cyl(r * 0.16, r * 0.2, Math.min(0.03, sh * 0.1), metal, 0, sh, 0, 14), cord(sh));
  } else if (v === 'cylinder') {
    add(g, lathe([[r, 0], [r, sh], [r, sh], [0, sh]], matOf(p.material, hex(p.shade, hex(p.color, DARK)), 'metal')), noShadow(lathe([[r - 0.003, Math.min(0.03, sh * 0.2)], [r - 0.003, 0.001]], linerMat(on))));
    add(g, noShadow(disc(r - 0.003, 0.002, bulbMat(on), 0, Math.min(0.03, sh * 0.2), 0)), cord(sh));
    ly = 0.02;
  } else if (v === 'rattan') {
    const prof = smooth([[r * 0.86, 0], [r, sh * 0.28], [r * 0.9, sh * 0.62], [r * 0.5, sh * 0.9], [r * 0.14, sh]], 14);
    add(g, lathe(prof, weaveMat(hex(p.shade, hex(p.color, '#c9a878'))), 36), noShadow(K.sphere(clamp(r * 0.16, 0.02, 0.045), bulbMat(on), 0, sh * 0.45, 0, 12, 8)), cord(sh * 0.45));
    add(g, torus(r * 0.86, 0.004, K.rattan(hex(p.shade, hex(p.color, '#b8946a'))), TAU, 36));
    g.children[g.children.length - 1].rotation.x = Math.PI / 2; g.children[g.children.length - 1].position.y = 0.004;
    ly = sh * 0.45;
  } else if (v === 'linear') {
    const a = new THREE.Group();
    a.add(K.box(Math.max(0.1, L - rsL * 2 + 0.06), ch, Math.min(S, 0.06), metal, 0, h - ch / 2, 0));
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : -L / 2 + rsL + i * (L - 2 * rsL) / (n - 1);
      add(a, at(domeShade(rsL, sh, matOf(p.material, hex(p.shade, hex(p.color, DARK)), 'metal'), on), x, 0, 0), cord(sh, x));
    }
    if (d > w) a.rotation.y = Math.PI / 2;
    g.add(a); ly = sh * 0.3;
  } else if (v === 'cluster') {
    const nc = int(p.count, 5, 1, 15), { rg, pts } = clusterLayout(nc, r), span = clamp(top - 2 * rg - 0.08, 0, h * 0.5);
    g.add(K.cyl(Math.max(cr, r - rg + 0.02), Math.max(cr, r - rg + 0.02), ch, metal, 0, h - ch / 2, 0, 32));
    const gm = on ? K.glow(hex(p.shade, '#fff3dc'), 0.95) : K.mat(hex(p.shade, '#f4f1ea'), { roughness: 0.25 });
    for (const q of pts) add(g, noShadow(K.sphere(rg, gm, q.x, rg + q.k * span, q.z, 20, 14)), K.cyl(rg * 0.2, rg * 0.24, 0.02, metal, q.x, 2 * rg + q.k * span, q.z, 10), cord(2 * rg + q.k * span, q.x, q.z, 0.0012));
    ly = rg + span * 0.4;
  } else if (v === 'chandelier') {
    const na = int(p.count, 6, 3, 12), c2 = clamp(r * 0.14, 0.012, 0.05), cup = clamp(r * 0.1, 0.01, 0.035), ra = r - cup;
    add(g, lathe([[0, 0], ...smooth([[c2 * 0.4, 0.015 * sh], [c2, 0.12 * sh], [c2 * 0.45, 0.26 * sh], [c2 * 0.9, 0.4 * sh], [c2 * 0.35, 0.6 * sh], [c2 * 0.6, 0.84 * sh], [c2 * 0.25, sh]], 24), [0, sh]], metal, 20), cord(sh, 0, 0, 0.003));
    const arm = new THREE.Group();
    arm.add(tube([[c2 * 0.4, 0.34 * sh, 0], [r * 0.42, 0.14 * sh, 0], [r * 0.78, 0.16 * sh, 0], [ra, 0.4 * sh, 0]], clamp(r * 0.014, 0.003, 0.006), metal, 16, 6));
    arm.add(at(lathe([[0, 0], [cup * 0.3, 0], [cup, cup * 0.5], [cup, cup * 0.5], [0, cup * 0.4]], metal, 14), ra, 0.4 * sh, 0));
    arm.add(K.cylOn(cup * 0.32, cup * 0.32, 0.2 * sh, K.mat('#f1ead9', { roughness: 0.5 }), ra, 0.4 * sh + cup * 0.4, 0, 10));
    const fl = noShadow(K.sphere(cup * 0.42, bulbMat(on), ra, 0.62 * sh + cup * 0.9, 0, 10, 8)); fl.scale.y = 1.6;
    arm.add(fl);
    for (let i = 0; i < na; i++) { const c = arm.clone(); c.rotation.y = i * TAU / na; g.add(c); }
    ly = sh * 0.6;
  } else if (v === 'sputnik') {
    const nb = int(p.count, 12, 4, 30), br = clamp(r * 0.1, 0.01, 0.04), c3 = clamp(r * 0.14, 0.015, 0.06), ky = (sh / 2 - br) / Math.max(0.01, r - br);
    add(g, K.sphere(c3, metal, 0, sh / 2, 0, 16, 12), pole(sh / 2, top + 0.001, 0.005, metal));
    for (let i = 0; i < nb; i++) {
      const y = 1 - 2 * (i + 0.5) / nb, rad = Math.sqrt(1 - y * y), ph = i * 2.39996;
      const tip = [Math.cos(ph) * rad * (r - br), sh / 2 + y * (r - br) * ky, Math.sin(ph) * rad * (r - br)];
      add(g, K.bar([0, sh / 2, 0], tip, 0.0025, metal, 6), noShadow(K.sphere(br, bulbMat(on), tip[0], tip[1], tip[2], 10, 8)));
    }
  } else if (v === 'paper') {
    const pts = [], rows = 14;
    for (let i = 0; i <= rows; i++) { const t = lerp(-1, 1, i / rows) * Math.PI / 2 * 0.86; pts.push([r * Math.cos(t) * (i % 2 ? 1 : 0.972), sh / 2 + (sh / 2) * Math.sin(t) / Math.sin(Math.PI / 2 * 0.86)]); }
    add(g, noShadow(lathe(pts, on ? K.mat(hex(p.shade, '#fbf4e4'), { emissive: hex(p.shade, '#fbf4e4'), emissiveIntensity: 0.7, roughness: 0.8, side: THREE.DoubleSide }) : dbl(hex(p.shade, '#fbf4e4')), 32)), cord(sh));
  } else if (v === 'drum') {
    add(g, drum(r, r, sh, shadeMat(p, on)), noShadow(disc(r - 0.004, 0.003, opal(on), 0, 0.004, 0)));
    const yw = Math.min(top, sh + Math.max(0.03, Math.min(0.25, (top - sh) * 0.6)));
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3; g.add(K.bar([Math.cos(a) * (r - 0.004), sh - 0.004, Math.sin(a) * (r - 0.004)], [0, yw, 0], 0.001, cordM, 5)); }
    add(g, cord(yw)); ly = sh * 0.5;
  } else {                                                   // ring
    const t = sh / 2;
    add(g, lathe(shellRing(r - 2 * t, r, 0.003, sh), metal, 56), noShadow(lathe([[r - 2 * t + 0.002, 0.003], [r - 2 * t + 0.002, 0], [r - 2 * t + 0.002, 0], [r - 0.002, 0], [r - 0.002, 0], [r - 0.002, 0.003]], opal(on), 56)));
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + 0.5; g.add(K.bar([Math.cos(a) * (r - t), sh, Math.sin(a) * (r - t)], [Math.cos(a) * cr * 0.7, top, Math.sin(a) * cr * 0.7], 0.001, cordM, 5)); }
    ly = 0;
  }
  addLight(g, p, on, 0, ly, 0, 1.2, 5);
  return g;
}
/** Square-section ring profile (inner radius a, outer b, from y0 to y1). */
const shellRing = (a, b, y0, y1) => [[a, y0], [b, y0], [b, y0], [b, y1], [b, y1], [a, y1], [a, y1], [a, y0]];

// ───────────────────────── ceiling-light ─────────────────────────
const CEIL_V = ['flush', 'spot', 'track', 'panel', 'semi-flush', 'downlight'];

function downlightLayout(p, w, d) {
  const L = Math.max(w, d), S = Math.min(w, d), row = L / S >= 1.8;
  const n = int(p.count, row ? clamp(Math.round(L / (S > 0.3 ? S : 0.6)) + (S > 0.3 ? 0 : 1), 2, 8) : (S > 0.5 ? 4 : 1), 1, 24);
  const cols = row ? (w >= d ? n : 1) : Math.ceil(Math.sqrt(n)), rows = row ? (w >= d ? 1 : n) : Math.ceil(n / cols);
  const ur = n === 1 ? S / 2 : clamp(Math.min(w / cols, d / rows) / 2, 0.02, 0.06), pts = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols && pts.length < n; i++) {
    pts.push({ x: cols === 1 ? 0 : -w / 2 + ur + i * (w - 2 * ur) / (cols - 1), z: rows === 1 ? 0 : -d / 2 + ur + j * (d - 2 * ur) / (rows - 1) });
  }
  return { ur, pts };
}
const headCount = (p, L, pitch, lo, hi) => int(p.count, clamp(Math.round(L / pitch), lo, hi), 1, 16);

function ceilingLight(w, d, h, p) {
  const g = new THREE.Group(), v = pick(p.variant, CEIL_V), on = isOn(p), r = Math.min(w, d) / 2;
  const white = v === 'flush' || v === 'panel' || v === 'downlight' || v === 'semi-flush';
  const metal = matOf(p.material, hex(p.color, white ? '#f1f0ec' : DARK), white ? 'lacquer' : 'metal');
  const L = Math.max(w, d), S = Math.min(w, d);
  if (v === 'flush') {
    const bt = Math.min(0.012, h * 0.2);
    if (Math.abs(w - d) < 0.25 * L) {
      add(g, noShadow(lathe([[0, 0], ...smooth([[r * 0.7, 0.002], [r * 0.96, h * 0.3], [r, h * 0.65], [r, h - bt]], 10)], opal(on, hex(p.shade, '#fff3dc')))), K.cyl(r, r, bt, metal, 0, h - bt / 2, 0, 32));
    } else {
      add(g, noShadow(K.rbox(w, h, d, opal(on, hex(p.shade, '#fff3dc')), 0, h / 2, 0, Math.min(h * 0.45, 0.03))), K.box(w, bt, d, metal, 0, h - bt / 2, 0));
    }
  } else if (v === 'semi-flush') {
    const ch = Math.min(0.02, h * 0.15), cr = clamp(r * 0.3, 0.03, 0.07), sh = clamp(h * 0.55, 0.03, Math.max(0.03, r * 0.9));
    add(g, K.cyl(cr, cr, ch, K.metal(hex(p.color2, BRASS)), 0, h - ch / 2, 0, 24), pole(sh * 0.9, h - ch, 0.008, K.metal(hex(p.color2, BRASS))));
    add(g, noShadow(lathe([[0, 0], ...smooth([[r * 0.55, 0.04 * sh], [r * 0.93, 0.45 * sh], [r, sh]], 10), [r, sh], [r * 0.3, sh * 0.92], [0, sh * 0.92]], opal(on, hex(p.shade, '#fff3dc')))));
    add(g, at(lathe(shellRing(r - 0.004, r + 0.0005, 0, Math.min(0.014, sh * 0.2)), K.metal(hex(p.color2, BRASS)), 40), 0, sh - Math.min(0.014, sh * 0.2), 0));
  } else if (v === 'spot' || v === 'track') {
    const a = new THREE.Group(), track = v === 'track';
    const n = headCount(p, L, track ? 0.3 : 0.16, track ? 2 : 1, track ? 8 : 6);
    const bt = Math.min(track ? 0.02 : 0.015, h * 0.25), hr = clamp(S * (track ? 0.4 : 0.3), 0.012, track ? 0.04 : 0.035);
    const hl = clamp((h - bt) * 0.82, 0.02, track ? 0.14 : 0.1), tilt = 0.5;
    if (n === 1 && !track) a.add(K.cyl(Math.min(S / 2, L / 2) * 0.7, Math.min(S / 2, L / 2) * 0.7, bt, metal, 0, h - bt / 2, 0, 28));
    else a.add(K.rbox(L, bt, Math.min(S, track ? 0.035 : 0.06), metal, 0, h - bt / 2, 0, Math.min(bt * 0.4, 0.006)));
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : -L / 2 + hr * 1.3 + i * (L - 2.6 * hr) / (n - 1), hg = new THREE.Group(), dir = i % 2 ? -1 : 1;
      add(hg, K.cyl(hr, hr * 0.88, hl, metal, 0, -hl / 2, 0, 16), noShadow(K.cyl(hr * 0.8, hr * 0.8, 0.002, bulbMat(on), 0, -hl - 0.001, 0, 16)));
      hg.rotation.x = dir * tilt; hg.position.set(x, h - bt - (h - bt - hl) * 0.6, 0);
      add(a, hg, K.cyl(0.005, 0.005, (h - bt - hl) * 0.6 + 0.004, metal, x, h - bt - (h - bt - hl) * 0.3, 0, 8));
    }
    if (d > w) a.rotation.y = Math.PI / 2;
    g.add(a);
  } else if (v === 'panel') {
    const f = clamp(S * 0.035, 0.006, 0.02), gt = Math.min(0.002, h * 0.2);
    add(g, K.box(w, h - gt, d, metal, 0, gt + (h - gt) / 2, 0), noShadow(K.box(w - 2 * f, gt, d - 2 * f, opal(on, hex(p.shade, '#fff6e6')), 0, gt / 2, 0)));
  } else {
    const { ur, pts } = downlightLayout(p, w, d), ry = Math.min(0.012, h * 0.4);
    for (const q of pts) {
      add(g, at(lathe([[ur * 0.72, ry], [ur * 0.78, 0], [ur, 0], [ur, 0], [ur, h], [ur, h], [0, h]], metal, 24), q.x, 0, q.z));
      add(g, noShadow(at(lathe([[0, ry], [ur * 0.72, ry]], bulbMat(on), 20), q.x, 0, q.z)));
    }
  }
  addLight(g, p, on, 0, -0.03, 0, 1.2, 5);
  return g;
}

// ───────────────────────── wall-light ─────────────────────────
const WALL_V = ['sconce', 'up-down', 'swing-arm', 'picture', 'bulkhead', 'lantern', 'strip'];

function wallLight(w, d, h, p) {
  const g = new THREE.Group(), v = pick(p.variant, WALL_V), on = isOn(p), z0 = -d / 2, pt = Math.min(0.012, d * 0.2);
  const metal = matOf(p.material, hex(p.color, v === 'sconce' ? BRASS : DARK), 'metal');
  let ly = h * 0.6, lz = d / 2;
  if (v === 'sconce') {
    const rs = Math.min(w / 2, (d - pt) / 2), zc = d / 2 - rs, sh = h * 0.5, pw = clamp(w * 0.5, 0.03, 0.12), ph = h * 0.5, ar = clamp(rs * 0.08, 0.003, 0.008);
    add(g, K.rbox(pw, ph, pt, metal, 0, ph / 2, z0 + pt / 2, Math.min(pt * 0.4, pw * 0.2)));
    add(g, tube([[0, ph * 0.5, z0 + pt], [0, ph * 0.42, lerp(z0, zc, 0.6)], [0, ph * 0.55, zc], [0, h - sh, zc]], ar, metal, 16, 6));
    add(g, K.cyl(rs * 0.3, rs * 0.2, 0.012, metal, 0, h - sh, zc, 12), at(drum(rs, rs * 0.72, sh, shadeMat(p, on)), 0, h - sh, zc));
    add(g, noShadow(K.sphere(clamp(rs * 0.25, 0.008, 0.025), bulbMat(on), 0, h - sh * 0.5, zc, 10, 8)));
    ly = h - sh * 0.5; lz = zc;
  } else if (v === 'up-down') {
    const e = Math.min(0.004, h * 0.05), bw = Math.min(w * 0.5, 0.05), bh = Math.min(h * 0.4, 0.08);
    if (w <= d * 1.3) {
      const rc = Math.min(w / 2, (d - pt) / 2), zc = d / 2 - rc;
      add(g, K.cyl(rc, rc, h - 2 * e, metal, 0, h / 2, zc, 28), noShadow(K.cyl(rc * 0.86, rc * 0.86, e, bulbMat(on), 0, e / 2, zc, 24)), noShadow(K.cyl(rc * 0.86, rc * 0.86, e, bulbMat(on), 0, h - e / 2, zc, 24)));
      add(g, K.box(bw, bh, zc - z0, metal, 0, h / 2, (zc + z0) / 2));
    } else {
      add(g, K.box(w, h - 2 * e, d - pt, metal, 0, h / 2, pt / 2), noShadow(K.box(w * 0.9, e, (d - pt) * 0.8, bulbMat(on), 0, e / 2, pt / 2)), noShadow(K.box(w * 0.9, e, (d - pt) * 0.8, bulbMat(on), 0, h - e / 2, pt / 2)));
      add(g, K.box(w * 0.6, bh, pt, metal, 0, h / 2, z0 + pt / 2));
    }
    ly = h / 2;
  } else if (v === 'swing-arm') {
    const rs = clamp(Math.min(w * 0.22, d * 0.3), 0.02, 0.09), sh = h * 0.6, ya = sh + rs * 0.15, pw = clamp(w * 0.14, 0.02, 0.08), xp = -w / 2 + pw / 2;
    const x1 = w / 2 - rs, z1 = d / 2 - rs, ar = clamp(rs * 0.09, 0.003, 0.006), j = [lerp(xp, x1, 0.35), ya, lerp(z0, z1, 0.75)];
    add(g, K.rbox(pw, 2 * (h - ya), pt, metal, xp, ya, z0 + pt / 2, pt * 0.3), K.bar([xp, ya, z0 + pt], j, ar, metal, 8), K.bar(j, [x1, ya, z1], ar, metal, 8));
    add(g, K.sphere(ar * 2, metal, j[0], j[1], j[2], 10, 8), K.sphere(ar * 2, metal, x1, ya, z1, 10, 8));
    add(g, at(domeShade(rs, sh, matOf(p.material2, hex(p.shade, hex(p.color, DARK)), 'metal'), on, true), x1, 0, z1));
    ly = sh * 0.3; lz = z1; g.userData.lx = x1;
  } else if (v === 'picture') {
    const tr = clamp(Math.min(h, d) * 0.12, 0.006, 0.02), pw = clamp(w * 0.25, 0.03, 0.14), ph = clamp(h * 0.5, 0.015, 0.07), ar = Math.max(0.002, tr * 0.3);
    add(g, K.rbox(pw, ph, pt, metal, 0, ph / 2, z0 + pt / 2, pt * 0.3), xcyl(tr, w, metal, 0, h - tr, d / 2 - tr, 14));
    for (const s of [-1, 1]) g.add(tube([[s * pw * 0.3, ph * 0.5, z0 + pt], [s * pw * 0.3, ph * 0.6, lerp(z0, d / 2, 0.45)], [s * pw * 0.3, h - tr, d / 2 - tr]], ar, metal, 12, 6));
    add(g, noShadow(K.box(w * 0.92, 0.002, tr * 1.2, bulbMat(on), 0, h - 2 * tr - 0.0005, d / 2 - tr)));
    ly = h - 2 * tr - 0.02; lz = d / 2 - tr;
  } else if (v === 'bulkhead') {
    const inner = new THREE.Group(), outer = new THREE.Group();
    add(inner, lathe([[0, 0], [1, 0], [1, 0], [1, 0.36 * d], [1, 0.36 * d], [0.86, 0.42 * d]], metal, 36));
    add(inner, noShadow(lathe(smooth([[0.88, 0.38 * d], [0.8, 0.7 * d], [0.5, 0.93 * d], [0, d]], 10), opal(on, hex(p.shade, '#fff3dc')), 36)));
    for (const ry of [0, Math.PI / 2]) { const a = torus(1, 0.045, metal, Math.PI, 20); a.scale.set(0.9, 0.64 * d * 1.02, 1); a.position.y = 0.37 * d; a.rotation.y = ry; inner.add(a); }
    inner.rotation.x = Math.PI / 2;
    outer.add(inner); outer.scale.set(w / 2, h / 2, 1); outer.position.set(0, h / 2, z0);
    g.add(outer); ly = h / 2;
  } else if (v === 'lantern') {
    const dl = Math.max(0.02, Math.min(d - pt - Math.min(0.02, d * 0.15), w)), pw = clamp(w * 0.4, 0.02, 0.1);
    add(g, K.rbox(pw, h * 0.6, pt, metal, 0, h * 0.5, z0 + pt / 2, pt * 0.3), K.box(Math.min(0.014, pw * 0.5), Math.min(0.014, pw * 0.5), d - dl, metal, 0, h * 0.5, z0 + (d - dl) / 2));
    const lb = lanternBox(w, dl, h, metal, on); lb.position.z = d / 2 - dl / 2;
    g.add(lb); ly = lb.userData.bulbY; lz = d / 2 - dl / 2;
  } else {
    add(g, K.box(w, h, d * 0.5, matOf(p.material, hex(p.color, '#c9cbce'), 'aluminium'), 0, h / 2, -d / 4), noShadow(K.rbox(Math.max(0.004, w - 0.004), Math.max(0.004, h - 0.004), d * 0.5, opal(on, hex(p.shade, '#fff6e6')), 0, h / 2, d / 4, Math.min(d * 0.2, 0.008))));
    ly = h / 2;
  }
  addLight(g, p, on, g.userData.lx || 0, ly, lz, 0.8, 3.5);
  return g;
}

// ───────────────────────── ceiling-fan ─────────────────────────
const FAN_V = ['modern', 'classic', 'industrial', 'tropical'];
const FAN_DEF = {
  modern: { n: 3, blade: '#f1efea', mat: 'lacquer', body: '#f1efea', w0: 0.15, w1: 0.085 },
  classic: { n: 5, blade: '#6b4a34', mat: 'wood', body: '#7a6248', w0: 0.105, w1: 0.15 },
  industrial: { n: 3, blade: '#34363a', mat: 'metal', body: '#2b2d31', w0: 0.1, w1: 0.11 },
  tropical: { n: 5, blade: '#a67c4f', mat: 'wood', body: '#5a4634', w0: 0.07, w1: 0.2 },
};
/** Blade outline in the x (radial) / z plane from r0 to R. */
function bladeOutline(v, r0, R, k) {
  const D = FAN_DEF[v], pts = [], n = 12, len = R - r0;
  const half = (t) => {
    if (v === 'tropical') return 0.5 * k * (D.w0 + (D.w1 - D.w0) * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.8));
    const tip = t > 0.88 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.88) / 0.12, 2))) : 1;
    return 0.5 * k * lerp(D.w0, D.w1, t) * (v === 'industrial' ? 1 : lerp(0.25, 1, tip));
  };
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([r0 + len * t, -half(t) + (v === 'modern' ? 0.03 * k * t * t : 0)]); }
  for (let i = n; i >= 0; i--) { const t = i / n; pts.push([r0 + len * t, half(t) + (v === 'modern' ? 0.03 * k * t * t : 0)]); }
  return pts;
}

function ceilingFan(w, d, h, p) {
  const g = new THREE.Group(), v = pick(p.variant, FAN_V), D = FAN_DEF[v], R = Math.min(w, d) / 2, k = clamp(R / 0.66, 0.4, 1.4);
  const n = int(p.blades, D.n, 2, 8), light = p.light == null ? v === 'classic' : truthy(p.light), on = light && isOn(p);
  const bladeM = matOf(p.material, hex(p.color, D.blade), D.mat), body = matOf(p.material2, hex(p.color2, D.body), v === 'modern' ? 'lacquer' : 'metal');
  const ch = Math.min(0.05, h * 0.16), cr = Math.min(0.065 * k, R * 0.3), mr = clamp(R * (v === 'industrial' ? 0.12 : 0.16), 0.03, 0.115);
  const lh = light ? clamp(h * 0.22, 0.02, 0.09) : Math.min(0.012, h * 0.05), mh = Math.max(0.02, Math.min(clamp(h * 0.32, 0.05, 0.15), h - lh - ch));
  const m0 = lh, m1 = lh + mh, yb = m0 + mh * (v === 'classic' || v === 'tropical' ? 0.3 : 0.55), bt = clamp(0.008 * k, 0.004, 0.012);
  // canopy, downrod, motor housing
  add(g, at(lathe([[0, 0], [0.015 * k, 0], [cr, ch * 0.65], [cr, ch], [cr, ch], [0, ch]], body, 24), 0, h - ch, 0), pole(m1 - 0.002, h - ch + 0.002, Math.min(0.012, mr * 0.2), body));
  const prof = v === 'industrial' ? [[0, 0], [mr * 0.5, 0], [mr, mh * 0.12], [mr, mh * 0.12], [mr, mh * 0.88], [mr, mh * 0.88], [mr * 0.4, mh], [0, mh]]
    : v === 'modern' ? [[0, 0], ...smooth([[mr * 0.55, mh * 0.03], [mr, mh * 0.4], [mr * 0.8, mh * 0.8], [mr * 0.25, mh]], 12), [0, mh]]
      : [[0, 0], [mr * 0.5, 0], [mr * 0.62, mh * 0.1], [mr * 0.62, mh * 0.1], [mr, mh * 0.22], [mr, mh * 0.55], [mr, mh * 0.55], [mr * 0.72, mh * 0.66], [mr * 0.6, mh * 0.9], [mr * 0.22, mh], [0, mh]];
  add(g, at(lathe(prof, body, 32), 0, m0, 0));
  // blades (+ irons)
  const r0 = mr * (v === 'modern' ? 0.75 : 1.25), blade = K.slab(bladeOutline(v, r0, R, k), bt, bladeM, -bt / 2);
  blade.rotation.x = v === 'industrial' ? 0.22 : 0.16;
  const one = new THREE.Group(); one.add(blade);
  if (v !== 'modern') one.add(K.box(r0 - mr * 0.6 + 0.07 * k, bt * 0.7, 0.035 * k, body, (r0 + mr * 0.6 + 0.07 * k) / 2, 0.002, 0));
  for (let i = 0; i < n; i++) { const c = one.clone(); c.rotation.y = i * TAU / n + Math.PI / 2; c.position.y = yb; g.add(c); }
  // light kit or bottom cap
  if (light) add(g, noShadow(lathe([[0, 0], ...smooth([[mr * 0.5, lh * 0.08], [mr * 0.8, lh * 0.55], [mr * 0.85, lh]], 8), [mr * 0.85, lh], [0, lh]], opal(on), 28)));
  else add(g, K.cylOn(mr * 0.3, mr * 0.45, lh, body, 0, 0, 0, 16));
  addLight(g, p, on, 0, -0.02, 0, 1.1, 5);
  g.add(bounds(w, d, h));                                    // nominal size = blade sweep (a static rotor cannot fill it)
  return g;
}

// ───────────────────────── 2D: lighting ─────────────────────────
const GLOW2D = 'rgba(255,221,150,0.38)';
function dash(ctx, px, a = 4, b = 3) { ctx.setLineDash([a * px, b * px]); }
function crossMark(ctx, x, y, s, px, stroke = K.INK) { K.line(ctx, x - s, y, x + s, y, stroke, px); K.line(ctx, x, y - s, x, y + s, stroke, px); }
function ell(ctx, x, y, rx, ry, fill, stroke, lw) {
  ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
const shade2d = (p, fb = CREAM) => K.tint(hex(p.shade, fb), 0.35);

function floorLamp2d(ctx, w, d, h, p, px) {
  const v = pick(p.variant, FLOOR_V), r = Math.min(w, d) / 2, ink = K.INK, body = K.tint(hex(p.color, DARK), 0.55);
  if (v === 'arc') {
    const along = w >= d, L = Math.max(w, d), S = Math.min(w, d), br = clamp(Math.min(S / 2, L * 0.18), 4, 20), rs = clamp(Math.min(S / 2, L * 0.26), 5, 30);
    ctx.save(); if (!along) ctx.rotate(Math.PI / 2);
    K.line(ctx, -L / 2 + br, 0, L / 2 - rs, 0, ink, 1.6 * px);
    K.fillCircle(ctx, -L / 2 + br, 0, br, K.tint(hex(p.color2, '#e6e2da'), 0.3), ink, px);
    K.fillCircle(ctx, L / 2 - rs, 0, rs, shade2d(p, hex(p.color, '#8a8a8a')), ink, px); K.fillCircle(ctx, L / 2 - rs, 0, Math.max(px, rs * 0.14), ink, null);
    ctx.restore(); return;
  }
  if (v === 'reading') {
    const rb = clamp(Math.min(w / 2, d * 0.3), 3, 15), rh = clamp(w * 0.32, 3, 9);
    K.line(ctx, 0, -d / 2 + rb, 0, d / 2 - rh, ink, 1.4 * px);
    K.fillCircle(ctx, 0, -d / 2 + rb, rb, body, ink, px); K.fillCircle(ctx, 0, d / 2 - rh * 1.2, rh, shade2d(p, hex(p.color, '#8a8a8a')), ink, px);
    return;
  }
  ctx.save(); ctx.scale(w / (2 * r), d / (2 * r));
  if (v === 'tripod') for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + i * TAU / 3; K.line(ctx, 0, 0, Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92, ink, 1.4 * px); }
  K.fillCircle(ctx, 0, 0, v === 'tripod' ? r * 0.78 : r, v === 'tripod' ? rgba(hex(p.shade, CREAM), 0.75) : shade2d(p), ink, px);
  if (v !== 'tripod') K.fillCircle(ctx, 0, 0, r * (v === 'globe' || v === 'paper' ? 0.5 : 0.62), null, K.INK_SOFT, px);
  crossMark(ctx, 0, 0, r * 0.28, px); K.fillCircle(ctx, 0, 0, Math.max(px, r * 0.08), ink, null);
  ctx.restore();
}

function tableLamp2d(ctx, w, d, h, p, px) {
  const v = pick(p.variant, TABLE_V), r = Math.min(w, d) / 2, ink = K.INK;
  if (v === 'desk') {
    const rb = clamp(Math.min(w, d) * 0.3, 2, 10), rh = clamp(w * 0.42, 2, 8);
    K.line(ctx, 0, -d / 2 + rb, 0, d / 2 - rh, ink, 1.3 * px);
    K.fillCircle(ctx, 0, -d / 2 + rb, rb, K.tint(hex(p.color, DARK), 0.55), ink, px); K.fillCircle(ctx, 0, d / 2 - rh, rh, shade2d(p, hex(p.color, '#8a8a8a')), ink, px);
    return;
  }
  if (v === 'lantern') {
    K.fillRR(ctx, 0, 0, w, d, 0, GLOW2D, ink, px); K.line(ctx, -w / 2, -d / 2, w / 2, d / 2, K.INK_SOFT, px); K.line(ctx, w / 2, -d / 2, -w / 2, d / 2, K.INK_SOFT, px);
    K.fillCircle(ctx, 0, 0, r * 0.3, '#fff3d0', ink, px); return;
  }
  ell(ctx, 0, 0, w / 2, d / 2, shade2d(p, v === 'dome' ? hex(p.color, '#8a8a8a') : CREAM), ink, px);
  ell(ctx, 0, 0, w * 0.27, d * 0.27, null, K.INK_SOFT, px);
  K.fillCircle(ctx, 0, 0, Math.max(px, r * 0.1), ink, null);
}

function pendant2d(ctx, w, d, h, p, px) {
  const v = pick(p.variant, PEND_V), r = Math.min(w, d) / 2, ink = K.INK, soft = K.INK_SOFT;
  const head = (x, y, rr) => { dash(ctx, px, 3, 2); K.fillCircle(ctx, x, y, rr, GLOW2D, ink, px); ctx.setLineDash([]); K.fillCircle(ctx, x, y, Math.max(px * 0.9, rr * 0.12), ink, null); };
  if (v === 'linear') {
    const n = linearCount(p, w / 100, d / 100), L = Math.max(w, d), S = Math.min(w, d), rs = Math.min(S / 2, (L / n) / 2 * 0.9);
    ctx.save(); if (d > w) ctx.rotate(Math.PI / 2);
    dash(ctx, px); K.line(ctx, -L / 2 + rs, 0, L / 2 - rs, 0, ink, px); ctx.setLineDash([]);
    for (let i = 0; i < n; i++) head(n === 1 ? 0 : -L / 2 + rs + i * (L - 2 * rs) / (n - 1), 0, rs);
    ctx.restore(); return;
  }
  ctx.save(); ctx.scale(w / (2 * r), d / (2 * r));
  if (v === 'cluster') {
    const { rg, pts } = clusterLayout(int(p.count, 5, 1, 15), r);
    for (const q of pts) head(q.x, q.z, rg);
  } else if (v === 'chandelier' || v === 'sputnik') {
    const n = v === 'chandelier' ? int(p.count, 6, 3, 12) : Math.max(6, Math.round(int(p.count, 12, 4, 30) * 0.66));
    for (let i = 0; i < n; i++) {
      const a = i * TAU / n + (v === 'sputnik' ? 0.3 : 0), rr = v === 'sputnik' && i % 2 ? r * 0.62 : r * 0.9;
      dash(ctx, px, 3, 2); K.line(ctx, 0, 0, Math.cos(a) * rr, Math.sin(a) * rr, ink, px); ctx.setLineDash([]);
      K.fillCircle(ctx, Math.cos(a) * rr, Math.sin(a) * rr, r * 0.1, '#ffe9b8', ink, px);
    }
    K.fillCircle(ctx, 0, 0, r * 0.14, K.tint(hex(p.color, BRASS), 0.4), ink, px);
  } else if (v === 'ring') {
    dash(ctx, px); K.fillCircle(ctx, 0, 0, r, null, ink, px); K.fillCircle(ctx, 0, 0, r * 0.88, null, soft, px); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(0, 0, r * 0.94, 0, TAU); ctx.strokeStyle = GLOW2D; ctx.lineWidth = r * 0.1; ctx.stroke();
    crossMark(ctx, 0, 0, r * 0.14, px, soft);
  } else {
    head(0, 0, r);
    dash(ctx, px, 2, 2); K.fillCircle(ctx, 0, 0, r * (v === 'rattan' || v === 'paper' ? 0.7 : 0.45), null, soft, px); ctx.setLineDash([]);
    if (v === 'rattan') for (let i = 0; i < 12; i++) { const a = i * TAU / 12; K.line(ctx, Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2, Math.cos(a) * r, Math.sin(a) * r, soft, px); }
    else crossMark(ctx, 0, 0, r * 0.22, px);
  }
  ctx.restore();
}

function ceilingLight2d(ctx, w, d, h, p, px) {
  const v = pick(p.variant, CEIL_V), r = Math.min(w, d) / 2, ink = K.INK, L = Math.max(w, d), S = Math.min(w, d);
  if (v === 'spot' || v === 'track') {
    const track = v === 'track', n = headCount(p, L / 100, track ? 0.3 : 0.16, track ? 2 : 1, track ? 8 : 6), hr = clamp(S * (track ? 0.4 : 0.3), 1.2, track ? 4 : 3.5);
    ctx.save(); if (d > w) ctx.rotate(Math.PI / 2);
    dash(ctx, px); K.fillRR(ctx, 0, 0, L, Math.min(S, track ? 3.5 : 6), 1, 'rgba(255,255,255,0.6)', ink, px); ctx.setLineDash([]);
    for (let i = 0; i < n; i++) { const x = n === 1 ? 0 : -L / 2 + hr * 1.3 + i * (L - 2.6 * hr) / (n - 1); K.fillCircle(ctx, x, (i % 2 ? -1 : 1) * S * 0.18, hr, '#ffe9b8', ink, px); }
    ctx.restore(); return;
  }
  if (v === 'downlight') {
    const { ur, pts } = downlightLayout(p, w / 100, d / 100);
    for (const q of pts) { K.fillCircle(ctx, q.x * 100, q.z * 100, ur * 100, GLOW2D, ink, px); crossMark(ctx, q.x * 100, q.z * 100, ur * 60, px, K.INK_SOFT); }
    return;
  }
  dash(ctx, px);
  if (v === 'panel' || (v === 'flush' && Math.abs(w - d) >= 0.25 * L)) {
    K.fillRR(ctx, 0, 0, w, d, v === 'panel' ? 0 : Math.min(3, S * 0.2), GLOW2D, ink, px); ctx.setLineDash([]);
    K.fillRR(ctx, 0, 0, w - Math.min(4, S * 0.15), d - Math.min(4, S * 0.15), 0, null, K.INK_SOFT, px);
    if (v === 'panel') { K.line(ctx, -w / 2, -d / 2, w / 2, d / 2, K.INK_SOFT, px); K.line(ctx, w / 2, -d / 2, -w / 2, d / 2, K.INK_SOFT, px); }
  } else {
    ell(ctx, 0, 0, w / 2, d / 2, GLOW2D, ink, px); ctx.setLineDash([]);
    ell(ctx, 0, 0, w * (v === 'semi-flush' ? 0.16 : 0.36), d * (v === 'semi-flush' ? 0.16 : 0.36), null, K.INK_SOFT, px);
    crossMark(ctx, 0, 0, r * 0.2, px);
  }
  ctx.setLineDash([]);
}

function wallLight2d(ctx, w, d, h, p, px) {
  const v = pick(p.variant, WALL_V), ink = K.INK, body = K.tint(hex(p.color, DARK), 0.5);
  if (v === 'strip' || v === 'picture' || v === 'lantern') {
    K.fillRR(ctx, 0, 0, w, d, Math.min(1, d * 0.2), GLOW2D, ink, px);
    if (v === 'lantern') crossMark(ctx, 0, 0, Math.min(w, d) * 0.25, px, K.INK_SOFT);
  } else if (v === 'swing-arm') {
    const rs = clamp(Math.min(w * 0.22, d * 0.3), 2, 9), xp = -w / 2 + w * 0.07;
    ctx.beginPath(); ctx.moveTo(xp, -d / 2); ctx.lineTo(lerp(xp, w / 2 - rs, 0.35), lerp(-d / 2, d / 2 - rs, 0.75)); ctx.lineTo(w / 2 - rs, d / 2 - rs); ctx.strokeStyle = ink; ctx.lineWidth = 1.3 * px; ctx.stroke();
    K.fillCircle(ctx, w / 2 - rs, d / 2 - rs, rs, GLOW2D, ink, px);
  } else {
    ctx.beginPath(); ctx.ellipse(0, -d / 2, w / 2, d, 0, 0, Math.PI); ctx.closePath();
    ctx.fillStyle = GLOW2D; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = px; ctx.stroke();
  }
  K.fillRR(ctx, 0, -d / 2 + Math.min(1, d * 0.1), v === 'swing-arm' ? w * 0.3 : w * 0.7, Math.min(2, d * 0.2), 0, body, ink, px);
}

function ceilingFan2d(ctx, w, d, h, p, px) {
  const v = pick(p.variant, FAN_V), D = FAN_DEF[v], R = Math.min(w, d) / 2, k = clamp(R / 66, 0.4, 1.4) * 100;
  const n = int(p.blades, D.n, 2, 8), mr = clamp(R * (v === 'industrial' ? 0.12 : 0.16), 3, 11.5);
  const light = p.light == null ? v === 'classic' : truthy(p.light);
  dash(ctx, px, 5, 4); ell(ctx, 0, 0, w / 2, d / 2, 'rgba(255,255,255,0.25)', K.INK_SOFT, px); ctx.setLineDash([]);
  const pts = bladeOutline(v, mr * (v === 'modern' ? 0.75 : 1.25) / 100, R / 100, k / 100);
  for (let i = 0; i < n; i++) {
    ctx.save(); ctx.rotate(i * TAU / n - Math.PI / 2);
    ctx.beginPath(); pts.forEach(([x, z], j) => (j ? ctx.lineTo(x * 100, z * 100) : ctx.moveTo(x * 100, z * 100))); ctx.closePath();
    ctx.fillStyle = rgba(K.tint(hex(p.color, D.blade), 0.35), 0.9); ctx.fill(); ctx.strokeStyle = K.INK; ctx.lineWidth = px; ctx.stroke();
    ctx.restore();
  }
  K.fillCircle(ctx, 0, 0, mr, K.tint(hex(p.color2, D.body), 0.45), K.INK, px);
  if (light) K.fillCircle(ctx, 0, 0, mr * 0.6, '#ffe9b8', K.INK, px); else K.fillCircle(ctx, 0, 0, Math.max(px, mr * 0.2), K.INK, null);
}

reg('floor-lamp', floorLamp, floorLamp2d);
reg('table-lamp', tableLamp, tableLamp2d);
reg('pendant', pendant, pendant2d);
reg('ceiling-light', ceilingLight, ceilingLight2d);
reg('wall-light', wallLight, wallLight2d);
reg('ceiling-fan', ceilingFan, ceilingFan2d);

// ───────────────────────── rug ─────────────────────────
const RUG_SHAPES = ['rect', 'round', 'oval', 'runner', 'hide'];
const RUG_PATTERNS = ['plain', 'border', 'stripes', 'geometric', 'persian', 'berber', 'checker', 'abstract', 'jute', 'shaggy'];
const RUG_DEF = {
  plain: ['#d6cec0', '#b9ae9c', '#8f8676'], border: ['#d9d2c5', '#5b6470', '#b9ae9c'], stripes: ['#e6dfd2', '#6f7f8c', '#c8a27a'],
  geometric: ['#e4dccd', '#3f4a54', '#c98b6b'], persian: ['#8e3b32', '#27364f', '#e7d7b6'], berber: ['#efe8da', '#3a3836', '#b9ae9c'],
  checker: ['#ece6da', '#4a4d52', '#b9ae9c'], abstract: ['#e8e1d5', '#c98b6b', '#6f8578'], jute: ['#c9ad7f', '#a88d62', '#e0cba6'],
  shaggy: ['#e9e4da', '#cfc8ba', '#f7f4ee'], hide: ['#efe7da', '#6b4a36', '#3d2c24'],
};
const HIDE_HALF = [[0, -0.46], [0.1, -0.5], [0.2, -0.44], [0.3, -0.4], [0.46, -0.47], [0.5, -0.36], [0.4, -0.27], [0.34, -0.12], [0.36, 0.05], [0.38, 0.18], [0.47, 0.3], [0.5, 0.42], [0.4, 0.47], [0.28, 0.38], [0.16, 0.42], [0.06, 0.5], [0, 0.46]];

function rugStyle(p) {
  const shape = pick(p.shape, RUG_SHAPES);
  const pattern = RUG_PATTERNS.includes(p.pattern) ? p.pattern : (shape === 'runner' ? 'border' : shape === 'hide' ? 'hide' : 'plain');
  const D = RUG_DEF[pattern];
  return { shape, pattern, c: [hex(p.color, D[0]), hex(p.color2, D[1]), hex(p.color3, D[2])], fringe: truthy(p.fringe) && (shape === 'rect' || shape === 'runner') };
}
/** Outline [[x, y], …] of a rug of size w × d centred on the origin (any unit); cr = corner radius. */
function rugOutline(shape, w, d, cr) {
  const pts = [];
  if (shape === 'round' || shape === 'oval') {
    const e = shape === 'oval' ? 2 / 2.7 : 1;
    for (let i = 0; i < 60; i++) { const a = (i / 60) * TAU, c = Math.cos(a), s = Math.sin(a); pts.push([Math.sign(c) * Math.pow(Math.abs(c), e) * w / 2, Math.sign(s) * Math.pow(Math.abs(s), e) * d / 2]); }
  } else if (shape === 'hide') {
    const ctrl = [...HIDE_HALF, ...HIDE_HALF.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
    const cv = new THREE.CatmullRomCurve3(ctrl.map(([x, y]) => V(x, y, 0)), true, 'catmullrom', 0.5).getPoints(80).slice(0, -1);
    const b = new THREE.Box3().setFromPoints(cv);
    for (const q of cv) pts.push([((q.x - b.min.x) / (b.max.x - b.min.x) - 0.5) * w, ((q.y - b.min.y) / (b.max.y - b.min.y) - 0.5) * d]);
  } else {
    const r = Math.max(0, Math.min(cr, w / 2, d / 2));
    [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([sx, sy], k) => {
      for (let i = 0; i <= 4; i++) { const a = k * Math.PI / 2 + (i / 4) * Math.PI / 2; pts.push([sx * (w / 2 - r) + Math.cos(a) * r, sy * (d / 2 - r) + Math.sin(a) * r]); }
    });
  }
  return pts;
}
function blobPath(g, cx, cy, r, rnd, n = 8) {
  const q = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU, rr = r * (0.65 + 0.6 * rnd()); q.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], s = mid(q[n - 1], q[0]);
  g.beginPath(); g.moveTo(s[0], s[1]);
  for (let i = 0; i < n; i++) { const e = mid(q[i], q[(i + 1) % n]); g.quadraticCurveTo(q[i][0], q[i][1], e[0], e[1]); }
  g.closePath();
}
function diamond(g, x, y, rx, ry) { g.beginPath(); g.moveTo(x, y - ry); g.lineTo(x + rx, y); g.lineTo(x, y + ry); g.lineTo(x - rx, y); g.closePath(); }

/** Paint a rug pattern on a W × H canvas (top of the canvas = back edge of the rug). */
function paintRug(g, W, H, pattern, c, shape) {
  const rnd = K.rng(K.hashStr(pattern) + 3), m = Math.min(W, H), [c1, c2, c3] = c;
  g.fillStyle = c1; g.fillRect(0, 0, W, H);
  if (pattern === 'border') {
    const b = m * 0.075;
    g.strokeStyle = c2; g.lineWidth = m * 0.05; g.strokeRect(b, b, W - 2 * b, H - 2 * b);
    g.strokeStyle = c3; g.lineWidth = Math.max(1, m * 0.014); g.strokeRect(b * 2, b * 2, W - 4 * b, H - 4 * b);
  } else if (pattern === 'stripes') {
    const along = H >= W, Ln = along ? H : W, n = Math.max(6, Math.round(Ln / 20)) * 2, bw = Ln / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? c2 : c3;
      const o = i * bw + (i % 2 ? 0.2 * bw : 0.44 * bw), t = i % 2 ? bw * 0.6 : (i % 4 === 0 ? bw * 0.12 : 0);
      if (t) (along ? g.fillRect(0, o, W, t) : g.fillRect(o, 0, t, H));
    }
  } else if (pattern === 'checker') {
    const cols = Math.max(2, Math.round(W / (m / 6))), rows = Math.max(2, Math.round(H / (m / 6))), cw = W / cols, rh = H / rows;
    g.fillStyle = c2;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if ((i + j) % 2) g.fillRect(i * cw, j * rh, cw, rh);
  } else if (pattern === 'geometric') {
    const cols = Math.max(2, Math.round(W / (m / 4))), rows = Math.max(2, Math.round(H / (m / 4))), cw = W / cols, rh = H / rows;
    g.strokeStyle = c2; g.lineWidth = Math.max(1.5, m * 0.02);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * cw, y = (j + 0.5) * rh;
      diamond(g, x, y, cw / 2, rh / 2); g.stroke();
      diamond(g, x, y, cw * 0.2, rh * 0.2); g.fillStyle = (i + j) % 2 ? c3 : c2; g.fill();
    }
  } else if (pattern === 'persian') {
    const b = m * 0.17, fw = W - 2 * b, fh = H - 2 * b;
    g.fillStyle = c2; g.fillRect(0, 0, W, H);
    g.fillStyle = c1; g.fillRect(b, b, fw, fh);
    g.strokeStyle = c3; g.lineWidth = Math.max(1, m * 0.012);
    for (const k of [0.16, 0.86, 1.12]) g.strokeRect(b * k, b * k, W - 2 * b * k, H - 2 * b * k);
    const step = b * 0.62, bd = (x, y, i) => { diamond(g, x, y, b * 0.17, b * 0.17); g.fillStyle = i % 2 ? c3 : c1; g.fill(); };
    for (let i = 0, x = b * 0.5; x < W - b * 0.3; x += step, i++) { bd(x, b * 0.5, i); bd(x, H - b * 0.5, i); }
    for (let i = 0, y = b * 0.5 + step; y < H - b * 0.8; y += step, i++) { bd(b * 0.5, y, i); bd(W - b * 0.5, y, i); }
    g.save(); g.beginPath(); g.rect(b * 1.12, b * 1.12, W - 2.24 * b, H - 2.24 * b); g.clip();
    for (const [x, y] of [[b, b], [W - b, b], [b, H - b], [W - b, H - b]]) {
      g.beginPath(); g.ellipse(x, y, fw * 0.3, fh * 0.2, 0, 0, TAU); g.fillStyle = c2; g.fill();
      g.beginPath(); g.ellipse(x, y, fw * 0.2, fh * 0.13, 0, 0, TAU); g.fillStyle = c3; g.fill();
    }
    g.restore();
    const cx = W / 2, cy = H / 2;
    diamond(g, cx, cy, fw * 0.36, fh * 0.4); g.fillStyle = c2; g.fill(); g.strokeStyle = c3; g.stroke();
    g.beginPath(); g.ellipse(cx, cy, fw * 0.24, fh * 0.2, 0, 0, TAU); g.fillStyle = c3; g.fill();
    g.beginPath(); g.ellipse(cx, cy, fw * 0.15, fh * 0.12, 0, 0, TAU); g.fillStyle = c1; g.fill();
    diamond(g, cx, cy, fw * 0.07, fh * 0.06); g.fillStyle = c2; g.fill();
    for (let i = 0; i < 26; i++) {
      const x = rnd() * fw * 0.42, y = rnd() * fh * 0.46;
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { g.fillStyle = i % 2 ? c3 : c2; g.globalAlpha = 0.7; g.fillRect(cx + sx * x - 1.5, cy + sy * y - 1.5, 3, 3); }
    }
    g.globalAlpha = 1;
  } else if (pattern === 'berber') {
    const s = m * 0.3;
    g.strokeStyle = c2; g.lineWidth = Math.max(1.5, m * 0.016);
    for (const dir of [1, -1]) for (let k = -Math.ceil(H / s) - 1; k < Math.ceil((W + H) / s) + 1; k++) {
      g.beginPath();
      for (let t = 0; t <= 16; t++) { const y = (t / 16) * H, x = k * s + dir * y * 0.8 + (dir < 0 ? H * 0.8 : 0) + Math.sin(t * 1.7 + k) * m * 0.012; if (t) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
  } else if (pattern === 'abstract' || pattern === 'hide') {
    const cols = pattern === 'hide' ? [c2, c2, c3, c2] : [c2, c3, K.shade(c2, 0.35), K.shade(c3, 0.3)];
    for (let i = 0; i < 7; i++) {
      blobPath(g, rnd() * W, rnd() * H, m * (0.14 + rnd() * 0.22), rnd);
      g.fillStyle = cols[i % 4]; g.globalAlpha = pattern === 'hide' ? 0.92 : 0.8; g.fill();
    }
    g.globalAlpha = 1;
    if (pattern === 'abstract') { g.strokeStyle = K.shade(c2, -0.3); g.lineWidth = Math.max(1, m * 0.008); for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(rnd() * W, rnd() * H, m * (0.3 + rnd() * 0.4), rnd() * TAU, rnd() * TAU + 1.6); g.stroke(); } }
  } else if (pattern === 'jute') {
    g.lineWidth = 2.2;
    if (shape === 'round' || shape === 'oval') {
      for (let k = 1, i = 0; k > 0.02; k -= 5 / m, i++) { g.strokeStyle = i % 2 ? c2 : c3; g.beginPath(); g.ellipse(W / 2, H / 2, W / 2 * k, H / 2 * k, 0, 0, TAU); g.stroke(); }
    } else {
      for (let j = 0, y = 0; y < H + 6; y += 6, j++) for (let x = (j % 2) * 3; x < W; x += 6) { g.strokeStyle = (x + j) % 12 < 6 ? c2 : c3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4, y + (j % 2 ? 4 : -4)); g.stroke(); }
    }
  } else if (pattern === 'shaggy') {
    const tones = [c2, c3, K.shade(c1, -0.12)];
    g.lineWidth = 1.4;
    for (let i = 0; i < 2600; i++) { const x = rnd() * W, y = rnd() * H, a = rnd() * TAU, l = 3 + rnd() * 5; g.strokeStyle = tones[i % 3]; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    g.globalAlpha = 1;
  }
  for (let i = 0; i < 500; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.05)'; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1); }
}
/** Layout shared by the 3D model and the plan symbol (any unit; `u` = 1 for metres, 100 for cm). */
function rugLayout(w, d, p, u) {
  const st = rugStyle(p), alongD = d >= w, fl = st.fringe ? clamp(Math.max(w, d) * 0.03, 0.02 * u, 0.08 * u) : 0;
  const bw = alongD ? w : w - 2 * fl, bd = alongD ? d - 2 * fl : d, L = Math.max(bw, bd), S = Math.min(bw, bd);
  const q = clamp(Math.round((256 * S / L) / 16) * 16, 32, 256), W = bw >= bd ? 256 : q, H = bw >= bd ? q : 256;
  const kind = st.shape === 'round' || st.shape === 'oval' ? 'o' : 'r';
  const material = texMat(['rug', st.pattern, kind, ...st.c, W, H].join('|'), W, H, (g, cw, chh) => paintRug(g, cw, chh, st.pattern, st.c, st.shape), { roughness: 0.97 });
  return { ...st, alongD, fl, bw, bd, S, material, outline: rugOutline(st.shape, bw, bd, Math.min(0.02 * u, S * 0.1)) };
}
const fringeMat = (color) => texMat('fringe|' + color, 128, 32, (g, W, H) => {
  const rnd = K.rng(11);
  g.clearRect(0, 0, W, H); g.strokeStyle = '#ffffff'; g.lineWidth = 2.2;
  for (let x = 2; x < W; x += 4.5) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + (rnd() - 0.5) * 3, H * (0.02 + rnd() * 0.22)); g.stroke(); }
}, { color: new THREE.Color(color), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 });

function rug(w, d, h, p) {
  const g = new THREE.Group(), R = rugLayout(w, d, p, 1);
  const body = K.slab(R.outline, h, R.material, 0), ps = body.geometry.attributes.position, uv = body.geometry.attributes.uv;
  for (let i = 0; i < ps.count; i++) uv.setXY(i, ps.getX(i) / R.bw + 0.5, 0.5 - ps.getZ(i) / R.bd);
  g.add(body);
  if (R.fl > 0) {
    const fg = new THREE.Group(), half = (R.alongD ? R.bd : R.bw) / 2, fm = fringeMat(K.shade(R.c[0], 0.55));
    for (const s of [-1, 1]) {
      const pl = noShadow(new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.01, R.S - 0.012), R.fl), fm));
      pl.rotation.x = s * Math.PI / 2; pl.position.set(0, Math.max(0.0015, h * 0.5), s * (half + R.fl / 2));
      fg.add(pl);
    }
    if (!R.alongD) fg.rotation.y = Math.PI / 2;
    g.add(fg);
  }
  return g;
}

function rug2d(ctx, w, d, h, p, px) {
  const R = rugLayout(w, d, p, 100);
  const path = () => { ctx.beginPath(); R.outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  if (R.fl > 0) {
    const half = (R.alongD ? R.bd : R.bw) / 2, n = Math.max(4, Math.round(R.S / Math.max(2.5, 3 * px)));
    ctx.save(); if (!R.alongD) ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    for (const s of [-1, 1]) for (let i = 0; i <= n; i++) { const x = -R.S / 2 + 0.6 + (i / n) * (R.S - 1.2); ctx.moveTo(x, s * half); ctx.lineTo(x, s * (half + R.fl)); }
    ctx.strokeStyle = K.INK_SOFT; ctx.lineWidth = px; ctx.stroke(); ctx.restore();
  }
  path(); ctx.fillStyle = K.tint(R.c[0], 0.3); ctx.fill();
  const img = R.material.map && R.material.map.image;
  if (img) {
    ctx.save(); path(); ctx.clip();
    ctx.globalAlpha = 0.6; ctx.drawImage(img, -R.bw / 2, -R.bd / 2, R.bw, R.bd);
    ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(-R.bw / 2, -R.bd / 2, R.bw, R.bd);
    ctx.restore();
  }
  path(); ctx.strokeStyle = K.INK; ctx.lineWidth = px; ctx.stroke();
}

// ───────────────────────── wall-art ─────────────────────────
const ART_V = ['canvas', 'framed', 'gallery', 'clock', 'macrame', 'metal', 'shelf-art', 'photo'];
const ART_PALETTES = [['#c98b6b', '#8a9a7b', '#e3c9a6', '#34495e'], ['#d9a5a0', '#6f8578', '#e9d8b8', '#3d405b'], ['#7d93a8', '#e0b98a', '#c97b5f', '#2f3e46'], ['#b0855a', '#d8c3a5', '#8e9b90', '#4a4e4d'], ['#e2b07a', '#a7b8a8', '#d98f76', '#5a6b7b']];
const ART_KINDS = ['shapes', 'landscape', 'lines'];

function artPalette(p, seed) {
  const own = Array.isArray(p.palette) ? p.palette.map((c) => hex(c, null)).filter(Boolean) : [];
  if (own.length) return own.slice(0, 6);
  const extra = [hex(p.color2, null), hex(p.color3, null)].filter(Boolean);
  return [...extra, ...ART_PALETTES[seed % ART_PALETTES.length]].slice(0, 5);
}
/** Deterministic tasteful abstract artwork: soft shapes, layered hills or flowing lines. Never text. */
function paintArt(g, W, H, kind, pal, seed) {
  const rnd = K.rng(seed + 17), m = Math.min(W, H), P = (i) => pal[i % pal.length];
  g.fillStyle = '#f2ede3'; g.fillRect(0, 0, W, H);
  if (kind === 'landscape') {
    const sky = g.createLinearGradient(0, 0, 0, H * 0.7);
    sky.addColorStop(0, K.shade(P(0), 0.55)); sky.addColorStop(1, '#f4eee2');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.beginPath(); g.arc(W * (0.25 + rnd() * 0.5), H * (0.24 + rnd() * 0.12), m * 0.11, 0, TAU); g.fillStyle = K.shade(P(1), 0.25); g.fill();
    for (let k = 0; k < 5; k++) {
      const base = H * (0.42 + 0.115 * k), a = H * (0.05 + rnd() * 0.04), ph = rnd() * TAU, f = 1 + rnd() * 1.6;
      g.beginPath(); g.moveTo(0, H);
      for (let i = 0; i <= 24; i++) { const x = (i / 24) * W; g.lineTo(x, base + Math.sin(ph + (i / 24) * f * Math.PI) * a + Math.sin(ph * 2 + i * 0.9) * a * 0.18); }
      g.lineTo(W, H); g.closePath(); g.fillStyle = K.shade(P(k + 2), 0.28 - k * 0.11); g.fill();
    }
  } else if (kind === 'lines') {
    blobPath(g, W * (0.3 + rnd() * 0.4), H * (0.35 + rnd() * 0.3), m * 0.3, rnd); g.fillStyle = P(0); g.globalAlpha = 0.75; g.fill();
    blobPath(g, W * (0.3 + rnd() * 0.4), H * (0.4 + rnd() * 0.3), m * 0.2, rnd); g.fillStyle = P(1); g.fill();
    g.globalAlpha = 1; g.strokeStyle = '#2f2c28'; g.lineWidth = Math.max(1, m * 0.008);
    for (let i = 0; i < 6; i++) {
      const y0 = H * (0.15 + 0.12 * i + rnd() * 0.05);
      g.beginPath(); g.moveTo(-4, y0); g.bezierCurveTo(W * 0.3, y0 - H * (0.1 + rnd() * 0.15), W * 0.65, y0 + H * (0.08 + rnd() * 0.18), W + 4, y0 - H * 0.04 * i * rnd()); g.stroke();
    }
  } else {
    const ax = W * (0.3 + rnd() * 0.4), aw = m * (0.3 + rnd() * 0.12), top = H * (0.3 + rnd() * 0.12);
    g.beginPath(); g.arc(W * (0.3 + rnd() * 0.45), H * (0.26 + rnd() * 0.1), m * (0.15 + rnd() * 0.06), 0, TAU); g.fillStyle = P(1); g.fill();
    g.beginPath(); g.moveTo(ax - aw / 2, H); g.lineTo(ax - aw / 2, top + aw / 2); g.arc(ax, top + aw / 2, aw / 2, Math.PI, 0); g.lineTo(ax + aw / 2, H); g.closePath(); g.fillStyle = P(0); g.fill();
    blobPath(g, W * (0.15 + rnd() * 0.7), H * (0.72 + rnd() * 0.12), m * 0.24, rnd); g.fillStyle = P(2); g.globalAlpha = 0.85; g.fill();
    g.beginPath(); g.arc(W * (0.2 + rnd() * 0.6), H * (0.5 + rnd() * 0.2), m * 0.07, 0, TAU); g.fillStyle = P(3); g.fill();
    g.globalAlpha = 1; g.strokeStyle = '#2f2c28'; g.lineWidth = Math.max(1, m * 0.008);
    g.beginPath(); g.arc(W * rnd(), H * (0.3 + rnd() * 0.5), m * (0.35 + rnd() * 0.3), rnd() * TAU, rnd() * TAU + 1.4); g.stroke();
    g.beginPath(); g.moveTo(W * 0.1, H * (0.86 + rnd() * 0.06)); g.lineTo(W * 0.9, H * (0.86 + rnd() * 0.06)); g.stroke();
  }
}
function artMat(p, seed, w, h, forceKind) {
  const pal = forceKind === 'mono' ? ['#b9b4aa', '#8f8a80', '#6a665f', '#45423d', '#2f2d2a'] : artPalette(p, seed);
  const kind = forceKind === 'mono' ? 'landscape' : ART_KINDS[seed % 3], L = Math.max(w, h), q = (v) => clamp(Math.round((192 * v / L) / 16) * 16, 32, 192);
  return texMat(['art', kind, pal.join(''), seed % 9973, q(w), q(h)].join('|'), q(w), q(h), (g, W, H) => paintArt(g, W, H, kind, pal, seed), { roughness: 0.85 });
}
/** Frame + optional mat board + artwork plane. Occupies x ∈ ±w/2, y ∈ [0,h], z ∈ ±d/2 (front = +z). */
function framedPiece(w, h, d, frameM, art, margin, fw) {
  const g = new THREE.Group(), rec = Math.min(0.01, d * 0.45), iw = Math.max(0.005, w - 2 * fw), ih = Math.max(0.005, h - 2 * fw);
  add(g, K.box(w, fw, d, frameM, 0, h - fw / 2, 0), K.box(w, fw, d, frameM, 0, fw / 2, 0), K.box(fw, ih, d, frameM, -(w - fw) / 2, h / 2, 0), K.box(fw, ih, d, frameM, (w - fw) / 2, h / 2, 0));
  add(g, K.box(iw, ih, Math.max(0.001, d - rec - 0.001), K.mat('#f4f1ea', { roughness: 0.9 }), 0, h / 2, -(rec + 0.001) / 2));
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.004, iw - 2 * margin), Math.max(0.004, ih - 2 * margin)), art);
  pl.position.set(0, h / 2, d / 2 - rec + 0.0012);
  return add(g, pl);
}
function galleryLayout(n, w, h) {
  const cols = clamp(Math.round(Math.sqrt(n * w / h)), 1, n), rows = Math.ceil(n / cols), gap = clamp(Math.min(w, h) * 0.05, 0.015, 0.08);
  return { cols, rows, gap, cw: (w - gap * (cols - 1)) / cols, rh: (h - gap * (rows - 1)) / rows };
}
const macrameMat = (color) => texMat('macrame|' + color, 128, 192, (g, W, H) => {
  const vy = H * 0.62, edge = (x) => lerp(H * 0.3, vy, 1 - Math.abs(x - W / 2) / (W / 2));
  g.clearRect(0, 0, W, H); g.strokeStyle = '#ffffff'; g.lineWidth = 2.6;
  for (let x = 2; x < W; x += 4) { g.beginPath(); g.moveTo(x, edge(x) - 2); g.lineTo(x, Math.min(H, edge(x) + H * 0.37)); g.stroke(); }
  g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, H * 0.3); g.lineTo(W / 2, vy); g.lineTo(0, H * 0.3); g.closePath(); g.fillStyle = '#ffffff'; g.fill();
  g.save(); g.clip(); g.strokeStyle = 'rgba(105,95,80,0.6)'; g.lineWidth = 2;
  for (let k = -8; k < 16; k++) { g.beginPath(); g.moveTo(k * 16, 0); g.lineTo(k * 16 + H * 0.7, H * 0.7); g.moveTo(k * 16, 0); g.lineTo(k * 16 - H * 0.7, H * 0.7); g.stroke(); }
  for (const y of [10, 16, H * 0.2]) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.restore();
}, { color: new THREE.Color(color), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 });

function wallArt(w, d, h, p, item) {
  const g = new THREE.Group(), v = pick(p.variant, ART_V), m = Math.min(w, h);
  const seed = seedOf(item, [v, p.color, p.frame, Math.round(w * 100), Math.round(h * 100)].join('|'));
  const fc = hex(p.frame, hex(p.color, v === 'metal' ? BRASS : '#2b2b2b')), frameM = matOf(p.material, fc, v === 'metal' ? 'metal' : 'lacquer');
  if (v === 'canvas') {
    const side = K.mat('#ece6d8', { roughness: 0.9 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, side, side, artMat(p, seed, w, h), side]);
    mesh.position.y = h / 2;
    g.add(mesh);
  } else if (v === 'framed' || v === 'photo') {
    const photo = v === 'photo', fw = clamp(m * (photo ? 0.025 : 0.045), 0.006, photo ? 0.02 : 0.04), mg = clamp(m * (photo ? 0.16 : 0.09), 0.01, 0.14);
    g.add(framedPiece(w, h, d, frameM, artMat(p, seed, w - 2 * fw - 2 * mg, h - 2 * fw - 2 * mg, photo ? 'mono' : null), mg, fw));
  } else if (v === 'gallery') {
    const n = int(p.count, 6, 1, 24), G = galleryLayout(n, w, h), fw = clamp(Math.min(G.cw, G.rh) * 0.05, 0.005, 0.025), mg = Math.min(G.cw, G.rh) * 0.12;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / G.cols), inRow = Math.min(G.cols, n - row * G.cols), col = i - row * G.cols;
      const x = (col - (inRow - 1) / 2) * (G.cw + G.gap), y = h - (row + 1) * G.rh - row * G.gap;
      g.add(at(framedPiece(G.cw, G.rh, d, frameM, artMat(p, seed + i * 7 + 1, G.cw, G.rh, i % 4 === 3 ? 'mono' : null), mg, fw), x, y, 0));
    }
  } else if (v === 'clock') {
    const R = m / 2, cy = h / 2, rt = clamp(R * 0.08, 0.003, 0.02), zf = -d / 2 + d * 0.55, ink = K.mat(hex(p.color2, '#26262a'), { roughness: 0.5 });
    const rim = lathe(shellRing(R - rt, R, 0, d), frameM, 48); rim.rotation.x = Math.PI / 2; rim.position.set(0, cy, -d / 2);
    const face = K.cyl(R - rt * 0.5, R - rt * 0.5, d * 0.55, K.mat(hex(p.color, '#f4f1ea'), { roughness: 0.6 }), 0, cy, -d / 2 + d * 0.275, 40); face.rotation.x = Math.PI / 2;
    add(g, rim, face);
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12, big = i % 3 === 0, len = R * (big ? 0.15 : 0.07), rr = R * 0.8 - len / 2;
      const tk = K.box(R * (big ? 0.035 : 0.018), len, d * 0.03, ink, Math.sin(a) * rr, cy + Math.cos(a) * rr, zf + d * 0.015); tk.rotation.z = -a; g.add(tk);
    }
    const hand = (len, wd, a, z, material) => { const hg = new THREE.Group(); hg.add(K.box(wd, len, d * 0.03, material, 0, len * 0.38, 0)); hg.rotation.z = -a; hg.position.set(0, cy, z); return hg; };
    add(g, hand(R * 0.5, R * 0.05, (10 + 10 / 60) / 12 * TAU, zf + d * 0.06, ink), hand(R * 0.74, R * 0.035, 10 / 60 * TAU, zf + d * 0.1, ink), hand(R * 0.8, R * 0.012, 35 / 60 * TAU, zf + d * 0.14, K.mat(hex(p.color3, '#c0453a'))));
    const cap = K.cyl(R * 0.045, R * 0.045, d * 0.2, ink, 0, cy, zf + d * 0.1, 14); cap.rotation.x = Math.PI / 2; g.add(cap);
  } else if (v === 'macrame') {
    const dr = Math.min(d / 2, 0.02), pl = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.86, h - dr), macrameMat(hex(p.color, '#e9e0cf')));
    pl.position.y = (h - dr) / 2;
    add(g, xcyl(dr, w, K.wood(hex(p.frame, hex(p.color2, '#c8a476'))), 0, h - dr, 0, 14), pl);
  } else if (v === 'metal') {
    const rnd = K.rng(seed), t = clamp(m * 0.012, 0.0025, Math.min(0.012, d / 2)), acc = K.metal(hex(p.color2, DARK));
    const rings = [[-w / 2 + m * 0.3, h - m * 0.3, m * 0.3], [w / 2 - m * 0.24, m * 0.24, m * 0.24]];
    for (let i = 0; i < 4; i++) { const r = m * (0.1 + rnd() * 0.12); rings.push([lerp(-w / 2 + r, w / 2 - r, rnd()), lerp(r, h - r, rnd()), r]); }
    rings.forEach(([x, y, r], i) => g.add(at(torus(r - t, t, i % 3 === 2 ? acc : frameM), x, y, lerp(-d / 2 + t, d / 2 - t, i / (rings.length - 1)))));
    for (let i = 0; i < 3; i++) {
      const r = m * (0.05 + rnd() * 0.06), dk = K.cyl(r, r, Math.min(0.004, d * 0.3), i === 1 ? acc : frameM, lerp(-w / 2 + r, w / 2 - r, rnd()), lerp(r, h - r, rnd()), 0, 28);
      dk.rotation.x = Math.PI / 2; g.add(dk);
    }
    add(g, K.box(t * 1.2, h * 0.9, t * 1.2, acc, w * (rnd() * 0.3 - 0.15), h * 0.5, -d / 2 + t), K.box(w * 0.9, t * 1.2, t * 1.2, acc, 0, h * (0.4 + rnd() * 0.2), -d / 2 + t));
  } else {                                                   // shelf-art: picture ledge with leaning frames
    const lt = Math.min(0.02, h * 0.1), sizes = [[0.4, 1], [0.3, 0.68], [0.22, 0.48]], lean = 0.07, td = Math.min(0.015, d * 0.4);
    add(g, K.box(w, lt, d, matOf(p.material2, hex(p.color2, '#c8a476'), 'wood'), 0, lt / 2, 0), K.box(w, Math.min(0.012, lt), Math.min(0.006, d * 0.2), matOf(p.material2, hex(p.color2, '#c8a476'), 'wood'), 0, lt + Math.min(0.006, lt / 2), d / 2 - Math.min(0.003, d * 0.1)));
    let x = -w / 2 + 0.01;
    sizes.forEach(([fw0, fh0], i) => {
      const pw = w * fw0, ph = (h - lt) * fh0 / Math.cos(lean), fw = clamp(Math.min(pw, ph) * 0.05, 0.004, 0.02);
      const fp = framedPiece(pw, ph, td, frameM, artMat(p, seed + i * 5, pw, ph, i === 2 ? 'mono' : null), Math.min(pw, ph) * 0.1, fw), hg = new THREE.Group();
      fp.position.z = -td / 2; hg.add(fp); hg.rotation.x = -lean; hg.position.set(x + pw / 2, lt, d / 2 - Math.min(0.012, d * 0.3) - i * 0.001);
      g.add(hg); x += pw + (w - 0.02 - w * 0.92) / 2;
    });
  }
  return g;
}

function wallArt2d(ctx, w, d, h, p, px) {
  const v = pick(p.variant, ART_V), fc = hex(p.frame, hex(p.color, v === 'metal' ? BRASS : '#2b2b2b')), fill = K.tint(fc, 0.4);
  if (v === 'gallery') {
    const G = galleryLayout(int(p.count, 6, 1, 24), w, h);
    for (let i = 0; i < G.cols; i++) K.fillRR(ctx, (i - (G.cols - 1) / 2) * (G.cw + G.gap), 0, G.cw, d, 0, fill, K.INK, px);
    return;
  }
  if (v === 'macrame') {
    K.fillRR(ctx, 0, 0, w, Math.min(d, 4), Math.min(d, 4) / 2, K.tint(hex(p.frame, '#c8a476'), 0.3), K.INK, px);
    K.line(ctx, -w * 0.43, 0, w * 0.43, 0, rgba(hex(p.color, '#b9ab90'), 0.9), Math.max(px, d * 0.3)); return;
  }
  K.fillRR(ctx, 0, 0, w, d, 0, v === 'canvas' ? '#f1ece2' : fill, K.INK, px);
  if (v === 'shelf-art') K.line(ctx, -w * 0.45, 0, w * 0.4, 0, K.INK_SOFT, px);
  else K.line(ctx, -w / 2 + px, d / 2 - Math.min(d * 0.3, 1), w / 2 - px, d / 2 - Math.min(d * 0.3, 1), K.INK_SOFT, px);
  if (v === 'clock') K.fillCircle(ctx, 0, d / 2, Math.max(1.5 * px, d * 0.35), '#ffffff', K.INK, px);
}

// ───────────────────────── curtain ─────────────────────────
const CURTAIN_V = ['curtain', 'sheer', 'roller', 'venetian', 'roman', 'vertical', 'shutter'];
const CURTAIN_OPEN = { curtain: 0.5, sheer: 0.15, roller: 0.35, venetian: 0, roman: 0.35, vertical: 0.15, shutter: 0.5 };

/** Pleated fabric sheet from x0..x1, y0..y1 with `folds` pleats of amplitude amp around z0 (pinched at the top). */
function pleated(x0, x1, y0, y1, folds, amp, z0, material) {
  const nx = Math.max(4, Math.round(folds * 8)), rows = [[0, 1], [0.93, 0.95], [1, 0.55]], ps = [], idx = [];
  for (const [t, a] of rows) for (let i = 0; i <= nx; i++) {
    const u = i / nx, ph = u * folds * TAU;
    ps.push(lerp(x0, x1, u), lerp(y0, y1, t), z0 + amp * a * (0.88 * Math.sin(ph) + 0.12 * Math.sin(ph * 0.5 + 1)));
  }
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, c = a + nx + 1; idx.push(a, a + 1, c + 1, a, c + 1, c); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}
/** Panel layout of a draped curtain (metres), shared by 3D and plan symbol. */
function drapeLayout(w, d, o, sheer) {
  const fr = sheer ? 0.004 : clamp(d * 0.16, 0.008, 0.022), amp = Math.min(d * (sheer ? 0.3 : 0.38), sheer ? 0.045 : 0.075), z0 = d / 2 - amp;
  const X = Math.max(0.02, w / 2 - fr * 2 - 0.004), single = w < 0.9, full = single ? 2 * X : X;
  const pw = lerp(full, Math.max(Math.min(0.1, full), full * 0.22), o), folds = Math.max(2, Math.round(full / (sheer ? 0.085 : 0.13)));
  return { fr, amp, z0, X, folds, panels: single ? [[-X, -X + pw]] : [[-X, -X + pw], [X - pw, X]] };
}
function vaneLayout(w, d, o) {
  const vw = clamp(d * 0.95, 0.02, 0.127), n = Math.max(2, Math.round(w / (vw * 0.88))), pitch = lerp((w - 0.04) / n, 0.012, o);
  return { vw, n, pitch, ang: lerp(0.95, Math.PI / 2, o), x0: -w / 2 + 0.02 + pitch / 2 };
}
const shutterPanels = (w) => clamp(Math.round(w / 0.45), 1, 8);

function curtain(w, d, h, p) {
  const g = new THREE.Group(), v = pick(p.variant, CURTAIN_V), o = num(p.open, CURTAIN_OPEN[v], 0, 1);
  const hard = v === 'venetian' || v === 'vertical' || v === 'shutter';
  const c1 = hex(p.color, v === 'sheer' ? '#f6f4ef' : hard ? '#f1efe9' : v === 'roller' ? '#e4dfd4' : '#cfc6b6');
  const rodM = K.metal(hex(p.rod, hex(p.color2, DARK))), railM = K.mat(hex(p.rod, hex(p.color2, '#e9e7e2')), { roughness: 0.5 });
  const fabM = dbl(c1, { roughness: p.material === 'velvet' ? 0.8 : 0.95 });
  if (v === 'curtain' || v === 'sheer') {
    const sheer = v === 'sheer', Lr = drapeLayout(w, d, o, sheer), rr = Math.min(0.012, Lr.fr);
    const mat = sheer ? K.mat(c1, { opacity: 0.55, roughness: 0.9, side: THREE.DoubleSide, depthWrite: false }) : fabM;
    let yT;
    if (sheer) {
      const th = Math.min(0.016, h * 0.05);
      add(g, K.box(w, th, Math.min(d * 0.4, 0.03), railM, 0, h - th / 2, Lr.z0));
      for (const s of [-1, 1]) g.add(K.box(0.02, th * 0.7, Lr.z0 + d / 2, railM, s * w * 0.4, h - th / 2, (Lr.z0 - d / 2) / 2));
      yT = h - th;
    } else {
      const yr = h - Lr.fr;
      add(g, xcyl(rr, w - 2 * Lr.fr, rodM, 0, yr, Lr.z0, 12));
      for (const s of [-1, 1]) {
        add(g, K.sphere(Lr.fr, rodM, s * (w / 2 - Lr.fr), yr, Lr.z0, 14, 10), K.bar([s * Lr.X * 0.92, yr, -d / 2], [s * Lr.X * 0.92, yr, Lr.z0], rr * 0.5, rodM, 6));
        const pl = K.cyl(rr * 1.6, rr * 1.6, 0.004, rodM, s * Lr.X * 0.92, yr, -d / 2 + 0.002, 12); pl.rotation.x = Math.PI / 2; g.add(pl);
      }
      yT = yr - rr - 0.002;
    }
    for (const [a, b] of Lr.panels) { const m = pleated(a, b, 0, yT, Lr.folds, Lr.amp, Lr.z0, mat); if (sheer) noShadow(m); g.add(m); }
  } else if (v === 'roller') {
    const tr = Math.max(0.004, Math.min(d / 2 - 0.003, 0.03)), bb = Math.min(0.02, h * 0.05), yb = o * Math.max(0, h - 2 * tr - 0.06), cl = Math.min(h * 0.6, h - 2 * tr);
    add(g, xcyl(tr, Math.max(0.01, w - 0.012), railM, 0, h - tr, 0, 16), K.box(Math.max(0.01, w - 0.02), Math.max(0.001, h - tr - yb - bb), 0.002, fabM, 0, (h - tr + yb + bb) / 2, -tr + 0.001));
    add(g, K.rbox(Math.max(0.01, w - 0.02), bb, Math.min(0.012, d * 0.3), railM, 0, yb + bb / 2, -tr + 0.001, 0.004), K.cylOn(0.001, 0.001, cl, K.mat('#cfcfcf', { roughness: 0.4 }), w / 2 - 0.014, h - tr - cl, d / 2 - 0.006, 5));
    for (const s of [-1, 1]) g.add(K.box(0.004, 2 * tr, d, rodM, s * (w / 2 - 0.002), h - tr, 0));
  } else if (v === 'venetian') {
    const hr = Math.min(0.025, h * 0.1), rail = Math.min(0.02, h * 0.08), sw = clamp(d * 0.9, 0.01, 0.05), slatM = matOf(p.material, c1, 'lacquer');
    const N = clamp(Math.floor((h - hr - rail) / (sw * 0.85)), 1, 70), pitch = (h - hr - rail) / N, nVis = Math.round(N * (1 - o)), stack = (N - nVis) * Math.min(0.0025, pitch * 0.2);
    const yRail = h - hr - nVis * pitch - stack - rail, tb = tris();
    for (let i = 0; i < nVis; i++) tb.box(M4(0, h - hr - (i + 0.5) * pitch, 0, 0, 0, 0.6), w - 0.012, 0.0018, sw);
    if (stack > 0) tb.box(M4(0, yRail + rail + stack / 2, 0), w - 0.012, stack, sw);
    add(g, tb.mesh(slatM), K.box(w, hr, d, slatM, 0, h - hr / 2, 0), K.box(w - 0.01, rail, sw * 0.8, slatM, 0, yRail + rail / 2, 0));
    for (const x of w > 1.6 ? [-0.38 * w, 0, 0.38 * w] : [-0.34 * w, 0.34 * w]) g.add(K.box(0.002, h - hr - yRail - rail, 0.002, K.mat('#d8d4cc'), x, (h - hr + yRail + rail) / 2, sw * 0.4));
  } else if (v === 'roman') {
    const hr = Math.min(0.03, h * 0.1), yb = o * Math.max(0, h - hr - 0.3), nF = o > 0.001 ? clamp(Math.round(o * h / 0.22), 1, 8) : 0, fh = Math.min(0.035, h * 0.1), fd = Math.min(d * 0.8, 0.06);
    const zf = -d / 2 + Math.min(0.02, d * 0.4), stackH = nF ? fh + (nF - 1) * 0.018 : 0, y0 = yb + stackH * 0.5;
    add(g, K.box(w, hr, d, railM, 0, h - hr / 2, 0), K.box(w - 0.004, Math.max(0.001, h - hr * 0.5 - y0), 0.004, fabM, 0, (h - hr * 0.5 + y0) / 2, zf));
    for (let i = 0; i < nF; i++) g.add(K.rbox(w - 0.004, fh, fd * (1 - i * 0.05), fabM, 0, yb + fh / 2 + i * 0.018, zf + fd * (1 - i * 0.05) / 2 - 0.004, 0.012));
    if (!nF) {
      for (let y = 0.25; y < h - hr - 0.1; y += 0.25) g.add(K.box(w - 0.004, 0.006, 0.008, fabM, 0, y, zf + 0.004));
      g.add(K.rbox(w - 0.004, Math.min(0.03, h * 0.1), Math.min(d * 0.5, 0.016), fabM, 0, Math.min(0.015, h * 0.05), zf, 0.005));
    }
  } else if (v === 'vertical') {
    const hr = Math.min(0.035, h * 0.1), Lv = vaneLayout(w, d, o), tb = tris();
    for (let i = 0; i < Lv.n; i++) tb.box(M4(Lv.x0 + i * Lv.pitch, (h - hr) / 2, 0, Lv.ang), Lv.vw, h - hr, 0.0015);
    add(g, K.box(w, hr, d, railM, 0, h - hr / 2, 0), tb.mesh(K.mat(c1, { roughness: 0.85, flat: true })));
  } else {                                                   // plantation shutter
    const fw = Math.min(0.035, w * 0.1, h * 0.1), np = shutterPanels(w), pw = (w - 2 * fw) / np, sw = Math.min(0.045, pw * 0.2), rl = Math.min(0.07, h * 0.08), pd = Math.min(d * 0.6, 0.032);
    const lw = clamp(d * 0.75, 0.02, 0.089), tb = tris(), tilt = Math.PI / 2 - lerp(0.15, Math.PI / 2, o), mid = h > 1.5;
    tb.box(M4(0, h - fw / 2, 0), w, fw, d).box(M4(0, fw / 2, 0), w, fw, d).box(M4(-(w - fw) / 2, h / 2, 0), fw, h - 2 * fw, d).box(M4((w - fw) / 2, h / 2, 0), fw, h - 2 * fw, d);
    const zones = mid ? [[fw + rl, h / 2 - rl / 2], [h / 2 + rl / 2, h - fw - rl]] : [[fw + rl, h - fw - rl]];
    for (let k = 0; k < np; k++) {
      const cx = -w / 2 + fw + (k + 0.5) * pw;
      for (const s of [-1, 1]) tb.box(M4(cx + s * (pw - sw) / 2, h / 2, 0), sw - 0.002, h - 2 * fw, pd);
      for (const y of mid ? [fw + rl / 2, h / 2, h - fw - rl / 2] : [fw + rl / 2, h - fw - rl / 2]) tb.box(M4(cx, y, 0), pw - 2 * sw, rl, pd);
      for (const [ya, yb2] of zones) {
        const nl = clamp(Math.round((yb2 - ya) / (lw * 0.82)), 1, 28), pitch = (yb2 - ya) / nl;
        for (let i = 0; i < nl; i++) tb.box(M4(cx, ya + (i + 0.5) * pitch, 0, 0, 0, tilt), pw - 2 * sw, 0.008, lw);
      }
    }
    g.add(tb.mesh(p.material === 'wood' ? K.wood(c1) : K.mat(c1, { roughness: 0.4, flat: true })));
  }
  if ((v === 'roller' || v === 'venetian' || v === 'roman') && o > 0.001) g.add(bounds(w, d, h));   // raised blind: nominal size = fully lowered
  return g;
}

function curtain2d(ctx, w, d, h, p, px) {
  const v = pick(p.variant, CURTAIN_V), o = num(p.open, CURTAIN_OPEN[v], 0, 1), ink = K.INK;
  const c1 = hex(p.color, v === 'sheer' ? '#f6f4ef' : '#cfc6b6');
  if (v === 'curtain' || v === 'sheer') {
    const Lr = drapeLayout(w / 100, d / 100, o, v === 'sheer'), yr = Lr.z0 * 100, amp = Lr.amp * 100;
    K.line(ctx, -w / 2, yr, w / 2, yr, K.INK_SOFT, px);
    if (v === 'curtain') for (const s of [-1, 1]) K.fillCircle(ctx, s * (w / 2 - Lr.fr * 100), yr, Math.max(px, Lr.fr * 100), ink, null);
    for (const [a, b] of Lr.panels) {
      const n = Lr.folds * 10;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const u = i / n, x = lerp(a, b, u) * 100, y = yr + amp * Math.sin(u * Lr.folds * TAU); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.strokeStyle = v === 'sheer' ? 'rgba(38,40,46,0.5)' : rgba(K.shade(c1, -0.35), 0.95); ctx.lineWidth = (v === 'sheer' ? 1 : 1.5) * px; ctx.stroke();
    }
    return;
  }
  if (v === 'vertical') {
    const Lv = vaneLayout(w / 100, d / 100, o);
    dash(ctx, px); K.fillRR(ctx, 0, 0, w, d, 0, 'rgba(255,255,255,0.5)', K.INK_SOFT, px); ctx.setLineDash([]);
    for (let i = 0; i < Lv.n; i++) { const x = (Lv.x0 + i * Lv.pitch) * 100, dx = Math.cos(Lv.ang) * Lv.vw * 50, dy = Math.sin(Lv.ang) * Lv.vw * 50; K.line(ctx, x - dx, dy, x + dx, -dy, ink, px); }
    return;
  }
  K.fillRR(ctx, 0, 0, w, d, 0, K.tint(hex(p.color, '#e4dfd4'), 0.4), ink, px);
  if (v === 'shutter') { const np = shutterPanels(w / 100); for (let i = 1; i < np; i++) K.line(ctx, -w / 2 + i * w / np, -d / 2, -w / 2 + i * w / np, d / 2, ink, px); K.line(ctx, -w / 2, 0, w / 2, 0, K.INK_SOFT, px); }
  else if (v === 'venetian') { K.line(ctx, -w / 2, -d * 0.2, w / 2, -d * 0.2, K.INK_SOFT, px); K.line(ctx, -w / 2, d * 0.2, w / 2, d * 0.2, K.INK_SOFT, px); }
  else K.line(ctx, -w / 2, v === 'roller' ? -d * 0.15 : 0, w / 2, v === 'roller' ? -d * 0.15 : 0, K.INK_SOFT, px);
}

reg('rug', rug, rug2d);
reg('wall-art', wallArt, wallArt2d);
reg('curtain', curtain, curtain2d);

// ───────────────────────── plant ─────────────────────────
const SPECIES = ['monstera', 'ficus', 'fiddle-leaf', 'palm', 'snake', 'pothos', 'succulent', 'cactus', 'olive', 'fern', 'orchid', 'herbs', 'bamboo', 'rubber', 'zz', 'dracaena', 'peace-lily'];
const POTS = ['ceramic', 'terracotta', 'basket', 'concrete', 'metal', 'plastic'];
const POT_COLOR = { ceramic: '#ece7dc', terracotta: '#c2714f', basket: '#c9a878', concrete: '#b5b2ab', metal: '#b79a62', plastic: '#3f4246' };
/** Per species: c leaf colour, pf pot Ø / footprint, ph pot height (of h), x / x2 accent colours, t trunk colour, sym plan-symbol style. */
const PLANT = {
  monstera: { c: '#3f7d44', pf: 0.55, ph: 0.25, sym: ['broad', 8, 0.5] },
  ficus: { c: '#4d8a45', pf: 0.5, ph: 0.18, sym: ['cloud'] },
  'fiddle-leaf': { c: '#3d7240', pf: 0.5, ph: 0.2, sym: ['broad', 7, 0.46] },
  palm: { c: '#4f8f43', pf: 0.5, ph: 0.2, sym: ['frond', 9] },
  snake: { c: '#3c6b4a', pf: 0.72, ph: 0.28, x: '#c9c56a', sym: ['spike', 9] },
  pothos: { c: '#5c9a48', pf: 0.6, ph: 0.42, t: '#6b5238', sym: ['broad', 12, 0.42] },
  succulent: { c: '#7fa58b', pf: 0.92, ph: -0.45, b: 0.12, sym: ['rosette'] },
  cactus: { c: '#4f7f4c', pf: 1, ph: 0.3, x: '#e58fa6', sym: ['star'] },
  olive: { c: '#8b9a79', pf: 0.5, ph: 0.2, t: '#7d7163', sym: ['cloud'] },
  fern: { c: '#5e9e4a', pf: 0.5, ph: 0.4, sym: ['frond', 14] },
  orchid: { c: '#3f7a45', pf: 0.5, ph: 0.25, x: '#f3e9ee', x2: '#b5477c', t: '#8a7a5a', sym: ['broad', 5, 0.32] },
  herbs: { c: '#5f9648', pf: 1, ph: 0.45, sym: ['cloud'] },
  bamboo: { c: '#6f9a45', pf: 0.6, ph: 0.2, x: '#a3ad62', sym: ['spike', 12] },
  rubber: { c: '#2f5238', pf: 0.5, ph: 0.2, x: '#8f3b3b', sym: ['broad', 8, 0.44] },
  zz: { c: '#356b3c', pf: 0.6, ph: 0.28, sym: ['frond', 8] },
  dracaena: { c: '#4a8046', pf: 0.45, ph: 0.18, t: '#8a7a63', sym: ['spike', 18] },
  'peace-lily': { c: '#2f6b3a', pf: 0.55, ph: 0.28, x: '#f7f6ee', x2: '#e3d79a', sym: ['broad', 11, 0.3] },
};
const PROF = {
  ovate: (t) => Math.sin(Math.PI * Math.pow(t, 0.8)),
  lance: (t) => Math.sin(Math.PI * t),
  heart: (t) => Math.min(1, 0.55 + 3.2 * t) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.6))),
  split: (t, i, n) => PROF.heart(t) * (i % 2 === 0 && i > 0 && i < n ? 0.6 : 1),
  fiddle: (t) => (t < 0.25 ? lerp(0.25, 0.6, t / 0.25) : t < 0.5 ? lerp(0.6, 0.52, (t - 0.25) / 0.25) : t < 0.75 ? lerp(0.52, 1, (t - 0.5) / 0.25) : lerp(1, 0.12, (t - 0.75) / 0.25)),
  strap: (t) => Math.min(1, 0.5 + 5 * t) * (1 - Math.pow(t, 2.5)),
  sword: (t) => Math.min(1, 0.55 + 3 * t) * (t < 0.72 ? 1 : (1 - t) / 0.28),
  spoon: (t) => Math.sin(Math.PI * Math.pow(t, 1.5)),
};
const leafM = (color, rough = 0.9) => K.mat(color, { roughness: rough, flat: true, side: THREE.DoubleSide });
const out = (a, r, y) => V(Math.cos(a) * r, y, Math.sin(a) * r);
const GOLD = 2.39996;

/** Leaf blade: base at the origin of m, growing along local +X, width along Z, facing +Y. `edge` = builder for a variegated margin. */
function leaf(tb, m, len, wid, prof, { droop = 0.25, fold = 0.15, n = 4, edge = null } = {}) {
  const mid = [], L = [], Rr = [], L2 = [], R2 = [], k = edge ? 0.7 : 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n, hw = wid * 0.5 * Math.max(0, prof(t, i, n)), x = len * t * (1 - 0.12 * Math.abs(droop) * t), y = -droop * len * t * t;
    mid.push(V(x, y, 0).applyMatrix4(m));
    L.push(V(x, y + hw * k * fold, -hw * k).applyMatrix4(m)); Rr.push(V(x, y + hw * k * fold, hw * k).applyMatrix4(m));
    if (edge) { L2.push(V(x, y + hw * fold, -hw).applyMatrix4(m)); R2.push(V(x, y + hw * fold, hw).applyMatrix4(m)); }
  }
  for (let i = 0; i < n; i++) {
    tb.quad(mid[i], mid[i + 1], L[i + 1], L[i]).quad(mid[i], Rr[i], Rr[i + 1], mid[i + 1]);
    if (edge) edge.quad(L[i], L[i + 1], L2[i + 1], L2[i]).quad(Rr[i], R2[i], R2[i + 1], Rr[i + 1]);
  }
}
/** Blade at point b growing toward azimuth a, tilted up by `pitch`. */
const blade = (tb, b, a, pitch, len, wid, prof, o, roll = 0) => leaf(tb, M4(b.x, b.y, b.z, -a, pitch, roll), len, wid, prof, o);
/** Point on an arching stem: out to radius Rf, rising Hf, peaking at t = tp and drooping after it. */
const arcPt = (c, a, Rf, Hf, tp, t, r0 = 0) => out(a, r0 + (Rf - r0) * Math.pow(t, 1.3), c.y0 + Hf * (2 * tp * t - t * t) / (tp * tp));

/** Leaves on petioles radiating from the pot centre (monstera, peace lily). */
function petioleLeaves(c, n, o) {
  const sr = clamp(c.R * 0.02, 0.0015, 0.005);
  for (let i = 0; i < n; i++) {
    const lvl = (i + 0.5) / n, a = i * GOLD + c.r(-0.2, 0.2), len = c.R * lerp(o.len[0], o.len[1], lvl), rb = c.R * lerp(o.rad[0], o.rad[1], lvl);
    const b = out(a, rb, c.y0 + c.F * lerp(o.hgt[0], o.hgt[1], lvl)), mid = out(a, rb * 0.3, lerp(c.y0, b.y, 0.6));
    c.B.stick(V(0, c.y0, 0), mid, sr, sr * 0.9, 3).stick(mid, b, sr * 0.9, sr * 0.7, 3);
    blade(i % 3 ? c.A : c.B, b, a, lerp(o.pitch[0], o.pitch[1], lvl), len, len * o.wid, o.prof, { droop: o.droop, fold: o.fold, n: o.segs });
  }
}
/** Pinnate frond (palms): arching rachis with single-triangle leaflets on both sides. */
function frond(c, tb, a, Rf, Hf, tp, st, ll, lw) {
  const sr = clamp(c.R * 0.018, 0.0015, 0.005), P = (t) => arcPt(c, a, Rf, Hf, tp, t, c.pr * 0.15), side = V(-Math.sin(a), 0, Math.cos(a));
  for (let i = 0; i < 8; i++) tb.stick(P(i / 8), P((i + 1) / 8), lerp(sr, sr * 0.5, i / 8), lerp(sr, sr * 0.5, (i + 1) / 8), 3);
  for (let s = 0; s < st; s++) {
    const t = lerp(0.28, 1, s / (st - 1)), q = P(t), tg = P(Math.min(1, t + 0.03)).sub(P(t - 0.03)).normalize(), len = ll * (0.45 + 0.55 * Math.sin(Math.PI * (s + 0.5) / st));
    for (const sg of [-1, 1]) {
      const tip = q.clone().addScaledVector(side, sg * len * 0.8).addScaledVector(tg, len * 0.45); tip.y -= len * 0.3;
      tb.tri(q.clone().addScaledVector(tg, -lw), q.clone().addScaledVector(tg, lw), tip);
    }
  }
}
/** Arching ribbon leaf / fern frond with an optionally serrated edge. */
function ribbon(c, tb, a, Rf, Hf, tp, wid, segs, serrate) {
  const side = V(-Math.sin(a), 0, Math.cos(a)), P = (t) => arcPt(c, a, Rf, Hf, tp, t, c.pr * 0.1);
  let pm = P(0), pl = pm, pr = pm;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs, hw = wid * 0.5 * Math.sin(Math.PI * Math.pow(t, 0.7)) * (serrate && i % 2 === 0 ? 0.55 : 1), m = P(t);
    const l = m.clone().addScaledVector(side, -hw), r = m.clone().addScaledVector(side, hw);
    l.y += hw * 0.25; r.y += hw * 0.25;
    tb.quad(pm, m, l, pl).quad(pm, pr, r, m);
    pm = m; pl = l; pr = r;
  }
}
/** Ribbed cactus column from a to b with a domed end. */
function ribbed(tb, a, b, r, ribs = 8) {
  const dir = b.clone().sub(a), len = dir.length();
  if (len < 1e-5) return;
  dir.normalize();
  const u = new THREE.Vector3().crossVectors(Math.abs(dir.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0), dir).normalize(), w = new THREE.Vector3().crossVectors(dir, u);
  const body = Math.max(0, len - r), rows = [[0, 1], [body, 1]];
  for (let j = 1; j <= 3; j++) { const t = (j / 3) * Math.PI / 2; rows.push([body + (len - body) * Math.sin(t), Math.max(0.03, Math.cos(t))]); }
  const n = ribs * 2, pt = (row, i) => { const t = (i / n) * TAU, rr = r * row[1] * (i % 2 ? 0.78 : 1); return a.clone().addScaledVector(dir, row[0]).addScaledVector(u, Math.cos(t) * rr).addScaledVector(w, Math.sin(t) * rr); };
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < n; i++) tb.quad(pt(rows[j], i), pt(rows[j], i + 1), pt(rows[j + 1], i + 1), pt(rows[j + 1], i));
}

const GROW = {
  monstera(c) { petioleLeaves(c, 11, { prof: PROF.split, len: [0.82, 0.62], wid: 1, pitch: [-0.2, 0.7], hgt: [0.3, 0.86], rad: [0.26, 0.08], droop: 0.3, fold: 0.1, segs: 7 }); },
  'peace-lily'(c) {
    petioleLeaves(c, 18, { prof: PROF.lance, len: [0.66, 0.5], wid: 0.36, pitch: [-0.1, 0.9], hgt: [0.25, 0.62], rad: [0.4, 0.1], droop: 0.45, fold: 0.2, segs: 4 });
    const sl = clamp(c.R * 0.45, 0.03, 0.14);
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 1, s = out(a, c.R * 0.3 * (i + 1) / 3, c.top - sl * 0.95 - c.F * 0.12 * i);
      c.B.stick(V(0, c.y0, 0), s, 0.003, 0.0025, 3);
      blade(c.X, s, a, 1.25, sl, sl * 0.55, PROF.ovate, { droop: 0.1, fold: 0.55, n: 3 });
      c.X2.stick(s, s.clone().add(out(a, sl * 0.1, sl * 0.5)), sl * 0.045, sl * 0.035, 4);
    }
  },
  ficus(c) {
    const ch = Math.min(c.F * 0.62, c.R * 2.6), yc = c.top - ch / 2, tr = clamp(c.R * 0.07, 0.006, 0.025), ll = clamp(c.R * 0.22, 0.025, 0.08);
    c.T.stick(V(0, c.y0, 0), V(c.R * 0.04, yc - ch * 0.25, 0), tr, tr * 0.7, 6);
    c.A.blob(0, yc, 0, c.R * 0.74, ch * 0.44, c.R * 0.74, 1);
    for (let i = 0; i < 5; i++) {
      const q = out(i * TAU / 5 + c.r(0, 0.5), c.R * 0.42, yc + ch * c.r(-0.18, 0.2));
      c.T.stick(V(0, yc - ch * 0.3, 0), q, tr * 0.5, tr * 0.3, 4);
      (i % 2 ? c.A : c.B).blob(q.x, q.y, q.z, c.R * 0.5, ch * 0.28, c.R * 0.5, i + 2);
    }
    for (let i = 0; i < 70; i++) {
      const y = c.r(-1, 1), rad = Math.sqrt(1 - y * y), a = c.r(0, TAU);
      blade(i % 2 ? c.A : c.B, V(Math.cos(a) * rad * c.R * 0.8, yc + y * ch * 0.42, Math.sin(a) * rad * c.R * 0.8), a, y * 0.8 - 0.2, ll, ll * 0.42, PROF.ovate, { n: 2, droop: 0.3 });
    }
  },
  olive(c) {
    const ch = Math.min(c.F * 0.6, c.R * 2.4), yc = c.top - ch / 2, tr = clamp(c.R * 0.08, 0.006, 0.03), ll = clamp(c.R * 0.3, 0.03, 0.09);
    const k1 = V(c.R * 0.08, lerp(c.y0, yc, 0.4), c.R * 0.04), k2 = V(-c.R * 0.05, yc - ch * 0.3, 0);
    c.T.stick(V(0, c.y0, 0), k1, tr, tr * 0.8, 6).stick(k1, k2, tr * 0.8, tr * 0.6, 6);
    for (let i = 0; i < 6; i++) {
      const e = out(i * TAU / 6 + c.r(0, 0.6), c.R * c.r(0.4, 0.6), yc + ch * c.r(-0.2, 0.3));
      c.T.stick(k2, e, tr * 0.4, tr * 0.15, 4);
      (i % 2 ? c.A : c.B).blob(e.x, e.y, e.z, c.R * 0.36, ch * 0.2, c.R * 0.36, i + 1);
    }
    c.B.blob(0, yc + ch * 0.08, 0, c.R * 0.55, ch * 0.34, c.R * 0.55, 3);
    for (let i = 0; i < 190; i++) {                           // airy silver leaves over the crown surface
      const y = c.r(-1, 1), rad = Math.sqrt(1 - y * y), a = c.r(0, TAU), k = c.r(0.72, 0.9);
      blade(i % 3 ? c.A : c.B, V(Math.cos(a) * rad * c.R * k, yc + y * ch * 0.5 * k, Math.sin(a) * rad * c.R * k), a + c.r(-0.6, 0.6), y * 0.9 + c.r(-0.2, 0.4), ll * c.r(0.7, 1), ll * 0.27, PROF.lance, { n: 2, droop: 0.15, fold: 0.1 });
    }
  },
  'fiddle-leaf'(c) {
    const tr = clamp(c.R * 0.06, 0.005, 0.02), topP = V(c.R * 0.06, c.y0 + c.F * 0.84, 0), n = clamp(Math.round(c.F / 0.05), 9, 22);
    c.T.stick(V(0, c.y0, 0), topP, tr, tr * 0.6, 6);
    for (let i = 0; i < n; i++) {
      const lvl = i / (n - 1), b = V(0, c.y0, 0).lerp(topP, lerp(0.28, 1, lvl)), len = c.R * lerp(1.05, 0.8, lvl);
      blade(i % 3 ? c.A : c.B, b, i * GOLD, lerp(0.2, 1.1, lvl), len, len * 0.78, PROF.fiddle, { droop: 0.3, fold: 0.1, n: 4 });
    }
  },
  rubber(c) {
    const tr = clamp(c.R * 0.055, 0.004, 0.018), topP = V(-c.R * 0.05, c.y0 + c.F * 0.85, 0), n = clamp(Math.round(c.F / 0.075), 7, 14);
    c.T.stick(V(0, c.y0, 0), topP, tr, tr * 0.6, 6);
    for (let i = 0; i < n; i++) {
      const lvl = i / (n - 1), b = V(0, c.y0, 0).lerp(topP, lerp(0.22, 1, lvl)), len = c.R * lerp(1, 0.72, lvl);
      blade(i % 3 ? c.A : c.B, b, i * GOLD, lerp(0.15, 0.95, lvl), len, len * 0.5, PROF.ovate, { droop: 0.22, fold: 0.1, n: 4 });
    }
    blade(c.X, topP, 0, 1.45, c.R * 0.55, c.R * 0.09, PROF.sword, { droop: 0, fold: 0.6, n: 2 });
  },
  palm(c) {
    for (let i = 0; i < 8; i++) {
      const lvl = i / 7;
      frond(c, i % 2 ? c.A : c.B, i * GOLD + c.r(-0.2, 0.2), c.R * lerp(0.92, 0.42, lvl), c.F * lerp(0.6, 1, lvl), lerp(0.62, 0.9, lvl), 11, c.R * 0.4, clamp(c.R * 0.07, 0.008, 0.03));
    }
  },
  fern(c) {
    for (let i = 0; i < 18; i++) {
      const lvl = i / 17;
      ribbon(c, i % 2 ? c.A : c.B, i * GOLD, c.R * lerp(1, 0.4, lvl), c.F * lerp(0.55, 1, lvl), lerp(0.46, 0.85, lvl), clamp(c.R * 0.3, 0.015, 0.09), 9, true);
    }
  },
  snake(c) {
    const n = clamp(Math.round(c.pr / 0.012), 6, 12), wid = clamp(c.R * 0.42, 0.012, 0.075);
    for (let i = 0; i < n; i++) {
      const rb = c.pr * 0.55 * Math.sqrt((i + 0.3) / n), maxLean = Math.asin(clamp((c.R - rb) / c.F, 0, 0.5));
      const lean = Math.min(0.04 + 0.3 * (rb / (c.pr * 0.55)) * c.r(0.6, 1), maxLean), len = c.F * (i === 0 ? 1 : c.r(0.5, 0.95)) / Math.cos(lean);
      blade(i % 2 ? c.A : c.B, out(i * GOLD, rb, c.y0), i * GOLD, Math.PI / 2 - lean, len, wid * c.r(0.8, 1), PROF.sword, { droop: 0.02, fold: 0.22, n: 4, edge: c.X }, c.r(0, TAU));
    }
  },
  pothos(c) {
    const pole = c.F > 0.4, ll = clamp(c.R * (pole ? 0.6 : 0.42), 0.03, 0.14), prr = clamp(c.R * 0.1, 0.01, 0.03);
    if (pole) c.T.stick(V(0, c.y0, 0), V(0, c.top - ll * 0.5, 0), prr, prr, 7);
    const n = pole ? clamp(Math.round(c.F / 0.035), 10, 40) : 22;
    for (let i = 0; i < n; i++) {
      const lvl = i / (n - 1), a = i * GOLD;
      const b = pole ? out(a, prr, lerp(c.y0 + 0.02, c.top - ll * 0.6, lvl)) : out(a, c.pr * 0.75 * Math.sqrt(lvl), c.y0 + c.F * 0.35 * (1 - lvl));
      blade(i % 3 ? c.A : c.B, b, a, pole ? c.r(-0.5, 0.5) : lerp(1.2, 0.1, lvl), ll * c.r(0.75, 1), ll * 0.8, PROF.heart, { droop: 0.35, fold: 0.15, n: 3 });
    }
    for (let k = 0; k < 6; k++) {
      const a = k * TAU / 6 + c.r(0, 0.5), gap = c.R - c.pr, rim = out(a, c.pr * 0.9, c.y0 + 0.01), over = out(a, c.pr + gap * 0.4, c.y0 - 0.01), end = out(a + c.r(-0.2, 0.2), c.pr + gap * 0.45, c.r(0.03, Math.max(0.04, c.y0 * 0.55)));
      c.B.stick(rim, over, 0.003, 0.003, 3).stick(over, end, 0.003, 0.002, 3);
      for (let j = 0; j < 5; j++) blade(j % 2 ? c.A : c.B, over.clone().lerp(end, j / 4), a + (j % 2 ? 0.7 : -0.7), -0.9, ll * 0.8, ll * 0.62, PROF.heart, { droop: 0.2, fold: 0.15, n: 3 });
    }
  },
  succulent(c) {
    for (let k = 0; k < 4; k++) {
      const lvl = k / 3, m = 5 + 3 * k, len = c.R * lerp(0.4, 1.02, lvl);
      for (let i = 0; i < m; i++) blade(k % 2 ? c.A : c.B, V(0, c.y0, 0), i * TAU / m + k * 0.5, lerp(1.25, 0.22, lvl), len, len * 0.5, PROF.spoon, { droop: -0.12, fold: 0.5, n: 3 });
    }
  },
  cactus(c) {
    const rc = clamp(c.R * 0.36, 0.01, 0.12), xr = c.R * 0.85 - rc * 0.75, y1 = c.y0 + c.F * 0.38, y2 = c.y0 + c.F * 0.55;
    ribbed(c.A, V(0, c.y0, 0), V(0, c.top, 0), rc);
    ribbed(c.A, V(0, y1, 0), V(xr, y1, 0), rc * 0.7); ribbed(c.A, V(xr, y1 - rc * 0.3, 0), V(xr, c.y0 + c.F * 0.8, 0), rc * 0.75);
    ribbed(c.B, V(0, y2, 0), V(-xr * 0.8, y2, 0), rc * 0.6); ribbed(c.B, V(-xr * 0.8, y2 - rc * 0.3, 0), V(-xr * 0.8, c.y0 + c.F * 0.92, 0), rc * 0.65);
    c.X.blob(xr, c.y0 + c.F * 0.8 + rc * 0.1, 0, rc * 0.3, rc * 0.22, rc * 0.3, 2);
  },
  orchid(c) {
    for (let i = 0; i < 5; i++) { const a = i * GOLD + 0.4, len = c.R * c.r(0.85, 1.02); blade(i % 2 ? c.A : c.B, out(a, c.pr * 0.1, c.y0), a, c.r(0.25, 0.6), len, len * 0.34, PROF.strap, { droop: 0.45, fold: 0.25, n: 4 }); }
    const fl = clamp(c.R * 0.3, 0.012, 0.05);
    for (let s = 0; s < 2; s++) {
      const a = s * 2.6 + 1, Rf = c.R * (0.8 - s * 0.2) - fl * 0.5, Hf = c.F * (1 - s * 0.18) - fl * 0.7, P = (t) => arcPt(c, a, Rf, Hf, 0.8, t);
      for (let i = 0; i < 8; i++) c.B.stick(P(i / 8), P((i + 1) / 8), 0.0025, 0.002, 3);
      c.T.stick(V(0, c.y0, 0), out(a, Rf * 0.14, c.y0 + Hf * 0.8), 0.002, 0.002, 3);
      for (let i = 0; i < 6; i++) {
        const q = P(lerp(0.5, 1, i / 5)), F = M4(q.x, q.y, q.z, -(a + (i % 2 ? 0.9 : -0.9)), -1.1);
        for (let k = 0; k < 5; k++) leaf(c.X, F.clone().multiply(new THREE.Matrix4().makeRotationY(k * TAU / 5)), fl, fl * 0.75, PROF.ovate, { droop: 0.1, fold: 0.1, n: 2 });
        leaf(c.X2, F.clone().multiply(new THREE.Matrix4().makeTranslation(-fl * 0.2, fl * 0.06, 0)), fl * 0.45, fl * 0.4, PROF.ovate, { droop: 0, fold: 0.3, n: 2 });
      }
    }
  },
  herbs(c) {
    const L = Math.max(c.w, c.d), Sd = Math.min(c.w, c.d), nc = c.trough ? clamp(Math.round(L / Sd), 2, 4) : 1, cr = Sd / 2 * 0.95;
    for (let k = 0; k < nc; k++) {
      const off = nc === 1 ? 0 : lerp(-L / 2 + Sd / 2, L / 2 - Sd / 2, k / (nc - 1)), cx = c.w >= c.d ? off : 0, cz = c.w >= c.d ? 0 : off, kind = k % 3;
      for (let i = 0; i < 28; i++) {
        const a = i * GOLD, rb = cr * 0.5 * Math.sqrt(i / 28), b = V(cx + Math.cos(a) * rb, c.y0, cz + Math.sin(a) * rb);
        if (kind === 1) { blade(i % 2 ? c.A : c.B, b, a, c.r(1.15, 1.5), c.F * (i === 0 ? 1 : c.r(0.6, 1)), clamp(cr * 0.12, 0.003, 0.012), PROF.lance, { droop: 0.05, fold: 0.2, n: 2 }); continue; }
        const hh = c.F * (kind === 0 ? (i === 0 ? 0.92 : c.r(0.35, 0.85)) : c.r(0.12, 0.4)), tp = V(b.x + Math.cos(a) * rb * 0.3, c.y0 + hh, b.z + Math.sin(a) * rb * 0.3), ll = cr * (kind === 0 ? 0.38 : 0.26);
        c.B.stick(b, tp, 0.0015, 0.0015, 3);
        blade(i % 2 ? c.A : c.B, tp, a, c.r(0, 0.7), ll, ll * 0.65, PROF.ovate, { droop: 0.3, fold: 0.2, n: 2 });
        blade(i % 2 ? c.B : c.A, tp, a + 2.6, c.r(0, 0.7), ll * 0.8, ll * 0.5, PROF.ovate, { droop: 0.3, fold: 0.2, n: 2 });
      }
    }
  },
  bamboo(c) {
    const n = clamp(Math.round(c.pr / 0.02), 4, 9), ll = clamp(c.R * 0.6, 0.04, 0.18), cr = clamp(c.R * 0.035, 0.003, 0.012);
    for (let i = 0; i < n; i++) {
      const a = i * GOLD, rb = c.pr * 0.6 * Math.sqrt((i + 0.5) / n), hh = c.F * (i === 0 ? 1 : c.r(0.6, 0.97)), base = out(a, rb, c.y0), tip = out(a, rb + c.R * 0.1, c.y0 + hh);
      c.X.stick(base, tip, cr, cr * 0.7, 5);
      const nodes = clamp(Math.round(hh / 0.22), 2, 7);
      for (let j = 1; j <= nodes; j++) for (let k = 0; k < 3; k++) {
        blade((j + k) % 2 ? c.A : c.B, base.clone().lerp(tip, lerp(0.35, 0.97, j / nodes)), a + k * 2.1 + j, c.r(-0.5, 0.4), ll * c.r(0.7, 1), ll * 0.17, PROF.lance, { droop: 0.3, fold: 0.15, n: 2 });
      }
    }
  },
  zz(c) {
    const ll = clamp(c.R * 0.36, 0.02, 0.09);
    for (let i = 0; i < 8; i++) {
      const lvl = i / 7, a = i * GOLD, P = (t) => arcPt(c, a, c.R * lerp(0.9, 0.3, lvl) - ll * 0.4, c.F * lerp(0.62, 1, lvl) - ll * 0.5, 1.05, t, c.pr * 0.15);
      for (let j = 0; j < 6; j++) c.B.stick(P(j / 6), P((j + 1) / 6), lerp(0.006, 0.003, j / 6), lerp(0.006, 0.003, (j + 1) / 6), 4);
      for (let j = 0; j < 9; j++) { const t = lerp(0.25, 1, j / 8); for (const s of [-1, 1]) blade((j + i) % 2 ? c.A : c.B, P(t), a + s * 1.25, 0.55, ll * lerp(1, 0.7, t), ll * 0.5, PROF.ovate, { droop: 0.15, fold: 0.15, n: 2 }); }
    }
  },
  dracaena(c) {
    const nC = c.F > 0.9 ? 3 : c.F > 0.45 ? 2 : 1, tr = Math.min(c.R * 0.85, c.F * 0.4), cr = clamp(c.R * 0.06, 0.004, 0.018), yTop = c.top - tr * 0.8, k0 = nC > 1 ? 1 : 0;
    for (let k = 0; k < nC; k++) {
      const a = k * 2.2 + 0.6, base = out(a, c.pr * 0.35 * k0, c.y0), tip = out(a, c.R * 0.12 * k0, lerp(c.y0, yTop, [1, 0.62, 0.36][k]));
      c.T.stick(base, tip, cr, cr * 0.8, 6);
      for (let i = 0; i < 28; i++) blade(i % 2 ? c.A : c.B, tip, i * GOLD, lerp(1.35, -0.3, Math.pow(i / 27, 0.8)), tr * c.r(0.85, 1.05), Math.max(0.008, tr * 0.12), PROF.strap, { droop: 0.5, fold: 0.3, n: 4 });
    }
  },
};

/** Round pot of the given style: outer radius r, height ph. Returns the group, soil level and inner radius. */
function potMesh(kind, r, ph, color) {
  const t = Math.min(0.012, r * 0.12), sy = ph - Math.min(0.02, ph * 0.15), g = new THREE.Group();
  let prof, material;
  if (kind === 'terracotta') {
    prof = [[0, 0], [r * 0.66, 0], [r * 0.66, 0], [r * 0.88, ph * 0.76], [r * 0.88, ph * 0.76], [r, ph * 0.76], [r, ph * 0.76]]; material = K.mat(color, { roughness: 0.85 });
    g.add(lathe([[0, 0], [r * 0.8, 0], [r * 0.8, 0], [r * 0.86, Math.min(0.012, ph * 0.1)], [r * 0.86, Math.min(0.012, ph * 0.1)], [r * 0.7, Math.min(0.012, ph * 0.1)]], material, 24));
  } else if (kind === 'basket') {
    prof = [[0, 0]];
    for (let i = 0; i <= 11; i++) { const tt = i / 11; prof.push([r * (0.74 + 0.26 * Math.sin(tt * Math.PI * 0.7)) * (i === 8 ? 1 : i % 2 ? 0.985 : 0.955), ph * tt]); }
    material = K.rattan(color);
  } else if (kind === 'concrete') { prof = [[0, 0], [r * 0.94, 0], [r * 0.94, 0]]; material = K.mat(color, { roughness: 0.95 }); }
  else if (kind === 'metal') { prof = [[0, 0], [r * 0.8, 0], [r * 0.8, 0]]; material = K.metal(color, { roughness: 0.4 }); }
  else if (kind === 'plastic') { prof = [[0, 0], [r * 0.7, 0], [r * 0.7, 0], [r * 0.94, ph * 0.85], [r * 0.94, ph * 0.85], [r, ph * 0.87]]; material = K.plastic(color); }
  else { prof = [[0, 0], [r * 0.68, 0], [r * 0.68, 0], [r * 0.8, ph * 0.3], [r * 0.93, ph * 0.7]]; material = K.ceramic(color); }
  g.add(lathe([...prof, [r, ph], [r, ph], [r - t, ph], [r - t, ph], [r - t - 0.001, sy - 0.002]], material, 28));
  return { g, sy, ri: r - t };
}

function plant(w, d, h, p, item) {
  const g = new THREE.Group(), sp = pick(p.species, SPECIES), S = PLANT[sp], kind = pick(p.pot, POTS), art = truthy(p.artificial);
  const rnd = K.rng(seedOf(item, sp)), R = Math.min(w, d) / 2, pr = R * S.pf;
  const potC = hex(p.potColor, hex(p.color, POT_COLOR[kind])), leafC = hex(p.color2, S.c), soil = K.mat(art ? '#77726a' : '#4a3a2c', { roughness: 1 });
  const ph = clamp(S.ph < 0 ? h + S.ph * R : h * S.ph, Math.min(0.03, h * 0.3), h * 0.85), trough = sp === 'herbs' && Math.max(w, d) / Math.min(w, d) > 1.6;
  let y0 = ph;
  if (trough) {
    const material = kind === 'terracotta' ? K.mat(potC, { roughness: 0.85 }) : kind === 'metal' ? K.metal(potC, { roughness: 0.4 }) : kind === 'basket' ? K.rattan(potC) : kind === 'concrete' ? K.mat(potC, { roughness: 0.95 }) : K.ceramic(potC);
    add(g, K.rboxOn(w, ph, d, material, 0, 0, 0, Math.min(0.012, ph * 0.2)), K.box(w - 0.016, 0.006, d - 0.016, soil, 0, ph - 0.002, 0));
  } else {
    const P = potMesh(kind, pr, ph, potC);
    add(g, P.g, K.cyl(P.ri, P.ri, 0.004, soil, 0, P.sy, 0, 24)); y0 = P.sy;
  }
  const c = { A: tris(), B: tris(), T: tris(), X: tris(), X2: tris(), rnd, R, y0, top: h, F: Math.max(0.02, h - y0), pr, w, d, trough, r: (a, b) => a + (b - a) * rnd() };
  GROW[sp](c);
  const gloss = sp === 'rubber' || sp === 'zz' || sp === 'monstera' || sp === 'peace-lily' || art ? 0.5 : 0.9;
  add(g, c.A.mesh(leafM(leafC, gloss)), c.B.mesh(leafM(K.shade(leafC, art ? -0.05 : S.b || -0.14), gloss)), c.T.mesh(leafM(S.t || '#7a6248')),
    c.X.mesh(leafM(hex(p.color3, S.x || '#f3e9ee'), 0.8)), c.X2.mesh(leafM(S.x2 || '#d8b24a', 0.8)));
  return g;
}

function leaf2d(ctx, a, r0, r1, wid) {
  const c = Math.cos(a), s = Math.sin(a), bx = c * r0, by = s * r0, tx = c * r1, ty = s * r1, mx = (bx + tx) / 2, my = (by + ty) / 2;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(mx - s * wid, my + c * wid, tx, ty); ctx.quadraticCurveTo(mx + s * wid, my - c * wid, bx, by); ctx.closePath();
}
function plant2d(ctx, w, d, h, p, px, item) {
  const sp = pick(p.species, SPECIES), S = PLANT[sp], kind = pick(p.pot, POTS), R = Math.min(w, d) / 2, rnd = K.rng(seedOf(item, sp));
  const leafC = hex(p.color2, S.c), fill = rgba(K.tint(leafC, 0.3), 0.82), edge = rgba(K.shade(leafC, -0.35), 0.8), potC = K.tint(hex(p.potColor, hex(p.color, POT_COLOR[kind])), 0.35);
  const [style, n = 8, wk = 0.4] = S.sym, trough = sp === 'herbs' && Math.max(w, d) / Math.min(w, d) > 1.6;
  const leafOut = (a, r0, r1, wid) => { leaf2d(ctx, a, r0, r1, wid); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = px; ctx.stroke(); K.line(ctx, Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1 * 0.85, Math.sin(a) * r1 * 0.85, edge, px * 0.7); };
  if (trough) K.fillRR(ctx, 0, 0, w, d, Math.min(2, d * 0.2), potC, K.INK, px);
  ctx.save(); ctx.scale(w / (2 * R), d / (2 * R));
  const lw = px * (2 * R) / Math.max(w, d);
  if (!trough && style !== 'cloud') K.fillCircle(ctx, 0, 0, R * S.pf, potC, K.INK, lw);
  if (style === 'broad') {
    for (let i = 0; i < n; i++) { const a = i * GOLD + 0.3, r1 = R * (i % 3 === 2 ? 0.72 : 0.98 - 0.12 * rnd()); leafOut(a, R * 0.08, r1, r1 * wk); }
  } else if (style === 'frond' || style === 'spike') {
    for (let i = 0; i < n; i++) { const a = i * TAU / n + (rnd() - 0.5) * 0.25, r1 = R * (0.98 - 0.25 * rnd() * (i % 2)); leafOut(a, R * 0.05, r1, r1 * (style === 'spike' ? 0.1 : 0.22)); }
  } else if (style === 'rosette') {
    [[1, 11], [0.68, 8], [0.38, 5]].forEach(([k, m], j) => { for (let i = 0; i < m; i++) leafOut(i * TAU / m + j * 0.4, R * k * 0.25, R * k, R * k * 0.5); });
  } else if (style === 'star') {
    for (const [x, r] of [[0, 0.36], [0.58, 0.27], [-0.46, 0.23]]) {
      K.fillCircle(ctx, x * R, 0, r * R, fill, edge, lw);
      for (let i = 0; i < 8; i++) K.line(ctx, x * R, 0, x * R + Math.cos(i * TAU / 8) * r * R, Math.sin(i * TAU / 8) * r * R, edge, lw * 0.7);
    }
  } else {
    const bumps = 11, k = trough ? 1 : (sp === 'herbs' ? 0.98 : 1);
    ctx.beginPath();
    for (let i = 0; i <= bumps; i++) {
      const a0 = (i / bumps) * TAU, a1 = ((i + 0.5) / bumps) * TAU, rr = R * k * (0.86 + 0.06 * rnd()), ro = R * k * 1.0;
      if (!i) ctx.moveTo(Math.cos(a0) * rr * 0.93, Math.sin(a0) * rr * 0.93);
      else ctx.quadraticCurveTo(Math.cos(a1 - TAU / bumps) * ro * 1.07, Math.sin(a1 - TAU / bumps) * ro * 1.07, Math.cos(a0) * rr * 0.93, Math.sin(a0) * rr * 0.93);
    }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = lw; ctx.stroke();
    for (let i = 0; i < 5; i++) { const a = i * GOLD, rr = R * (0.3 + 0.3 * rnd()); ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, R * 0.22, a - 0.9, a + 0.9); ctx.strokeStyle = edge; ctx.lineWidth = lw * 0.7; ctx.stroke(); }
    if (!trough && sp !== 'herbs') { dash(ctx, lw, 3, 2); K.fillCircle(ctx, 0, 0, R * S.pf, null, K.INK_SOFT, lw); ctx.setLineDash([]); K.fillCircle(ctx, 0, 0, Math.max(lw, R * 0.06), K.INK, null); }
  }
  ctx.restore();
}

// ───────────────────────── vase & decorative objects ─────────────────────────
const VASE_V = ['vase', 'bowl', 'candle', 'sculpture', 'books', 'tray', 'basket', 'lantern', 'diffuser', 'frame'];
const VASE_PROF = [
  [[0.5, 0], [0.9, 0.14], [1, 0.34], [0.8, 0.6], [0.36, 0.78], [0.3, 0.9], [0.4, 1]],
  [[0.45, 0], [0.82, 0.2], [1, 0.48], [0.85, 0.75], [0.52, 0.9], [0.62, 1]],
  [[0.8, 0], [0.98, 0.1], [1, 0.5], [0.96, 0.9], [0.9, 1]],
];
const BOOK_COLORS = ['#b65e45', '#2f4858', '#d8c7a5', '#6b7f6a', '#3b3b3f', '#c9a25a'];

function vaseBody(r, hh, material, style) {
  const raw = smooth(VASE_PROF[style].map(([a, b]) => [a * r, b * hh]), 18), mx = Math.max(...raw.map((q) => q[0])), o = raw.map(([a, b]) => [a * r / mx, clamp(b, 0, hh)]);
  const top = o[o.length - 1], t = Math.min(0.004, r * 0.1);
  return lathe([[0, 0], o[0], ...o, top, [top[0] - t, hh], [top[0] - t, hh], [(top[0] - t) * 0.85, hh * 0.94], [0, hh * 0.93]], material, 28);
}
function bouquet(g, r, y0, h, p, rnd, branches) {
  const st = tris(), pl = tris(), hr = clamp(r * 0.2, 0.005, 0.04), n = branches ? 5 : 9, fc = hex(p.color3, '#e7b3ad');
  const fm = [K.mat(fc, { roughness: 0.8, flat: true }), K.mat(K.shade(fc, 0.45), { roughness: 0.8, flat: true })];
  for (let i = 0; i < n; i++) {
    const a = i * GOLD, k = i === 0 ? 0 : Math.sqrt(i / (n - 1)), rr = (r - hr) * k, yt = h - hr - (i === 0 ? 0 : rnd() * (h - y0) * 0.3 * k);
    const tip = V(Math.cos(a) * rr, yt, Math.sin(a) * rr), base = V(Math.cos(a) * r * 0.05, y0 - (h - y0) * 0.3, Math.sin(a) * r * 0.05);
    st.stick(base, tip, 0.0015, 0.0012, 3);
    if (branches) pl.stick(base.clone().lerp(tip, 0.6), tip.clone().add(V(Math.cos(a) * hr * k, hr, Math.sin(a) * hr * k)), hr * 0.5, 0.002, 5);
    else {
      g.add(K.sphere(hr, fm[i % 2], tip.x, tip.y, tip.z, 8, 6));
      blade(st, base.clone().lerp(tip, 0.62), a + 1.5, 0.3, hr * 2.4, hr, PROF.lance, { n: 2, droop: 0.3 });
    }
  }
  add(g, st.mesh(leafM('#5d7f4a')), pl.mesh(leafM(hex(p.color3, '#e3d5bc'))));
}

function vase(w, d, h, p, item) {
  const g = new THREE.Group(), v = pick(p.variant, VASE_V), r = Math.min(w, d) / 2, seed = seedOf(item, v + (p.color || '')), rnd = K.rng(seed);
  const c1 = hex(p.color, null);
  if (v === 'vase') {
    const fl = p.flowers, has = truthy(fl) || fl === 'flowers' || fl === 'branches' || fl === 'pampas';
    const branches = fl === 'branches' || fl === 'pampas' || (has && (p.style === 'boho' || p.style === 'rustic' || p.style === 'minimal'));
    const style = { classic: 1, boho: 1, rustic: 1, minimal: 2, modern: 2, industrial: 2, scandinavian: 0 }[p.style] ?? seed % 3;
    const material = p.material === 'glass' ? K.glass(c1 || '#cfe3ea', 0.4) : matOf(p.material, c1 || '#e6ddd0', 'ceramic');
    const body = vaseBody(has ? r * 0.55 : r, has ? h * 0.52 : h, material, style);
    if (p.material === 'glass') noShadow(body);
    g.add(body);
    if (has) bouquet(g, r, h * 0.52, h, p, rnd, branches);
  } else if (v === 'bowl') {
    const t = Math.min(0.006, r * 0.08), o = smooth([[0.34 * r, 0], [0.8 * r, 0.36 * h], [r, h]], 10), inn = smooth([[r - t, h], [0.78 * r - t, 0.4 * h], [0.3 * r, 0.08 * h + t]], 10);
    g.add(lathe([[0, 0], [0.34 * r, 0], ...o, [r, h], ...inn, [0, 0.08 * h + t]], matOf(p.material, c1 || '#d9cfbf', 'ceramic'), 32));
    if (truthy(p.flowers)) for (let i = 0; i < 4; i++) { const a = i * TAU / 4 + 0.4, fr = r * 0.26; g.add(K.sphere(fr, K.mat(hex(p.color3, i % 2 ? '#e2a13a' : '#d9c24a'), { roughness: 0.6 }), Math.cos(a) * r * 0.36 * (i ? 1 : 0.2), Math.min(h - fr, 0.1 * h + fr), Math.sin(a) * r * 0.36, 12, 8)); }
  } else if (v === 'candle') {
    const n = clamp(Math.round(Math.min(w, d) / 0.065), 1, 3), fh = clamp(h * 0.09, 0.008, 0.03), pt = n > 1 ? Math.min(0.008, h * 0.06) : 0, cr = n === 1 ? r : r * 0.42;
    const wax = K.mat(c1 || '#f1eadc', { roughness: 0.55 });
    if (n > 1) g.add(disc(r, pt, K.metal(hex(p.color2, BRASS))));
    for (let i = 0; i < n; i++) {
      const a = i * TAU / n + 0.6, x = n === 1 ? 0 : Math.cos(a) * (r - cr), z = n === 1 ? 0 : Math.sin(a) * (r - cr), ch = (h - fh - pt - 0.006) * [1, 0.72, 0.5][i];
      const flame = noShadow(K.sphere(fh / 2, K.glow('#ffd58a', 2), x, pt + ch + 0.006 + fh / 2, z, 10, 8)); flame.scale.set(0.45, 1, 0.45);
      add(g, K.cylOn(cr, cr, ch, wax, x, pt, z, 20), K.cylOn(0.001, 0.001, 0.008, K.mat('#333333'), x, pt + ch, z, 5), flame);
    }
  } else if (v === 'sculpture') {
    const pl = Math.min(h * 0.12, 0.05), material = matOf(p.material, c1 || '#d9d2c4', 'stone'), base = matOf(p.material2, hex(p.color2, '#3a3a3c'), 'stone');
    g.add(K.boxOn(Math.min(w, d) * 0.62, pl, Math.min(w, d) * 0.62, base));
    if ((p.style === 'modern' || p.style === 'minimal') || (!p.style && seed % 2 === 0)) {
      const Ro = Math.min(w / 2, (h - pl) / 2), tb = Ro * 0.2, ring = torus(Ro - tb, tb, material, TAU, 36);
      ring.position.y = pl + Ro; ring.scale.set((w / 2) / Ro, ((h - pl) / 2) / Ro, Math.min(1, (d / 2) / tb));
      g.add(ring);
    } else {
      const hs = [0.44, 0.33, 0.23], rs = [1, 0.74, 0.5];
      let y = pl;
      hs.forEach((k, i) => { const hh = (h - pl) * k, s = K.sphere(1, material, (i === 1 ? 0.08 : i === 2 ? -0.05 : 0) * r, y + hh / 2, 0, 16, 12); s.scale.set(r * rs[i], hh / 2, r * rs[i]); y += hh; g.add(s); });
    }
  } else if (v === 'books') {
    const n = clamp(Math.round(h / 0.032), 1, 8), bh = h / n, cols = [c1, hex(p.color2, null), hex(p.color3, null)].filter(Boolean).concat(BOOK_COLORS), pages = K.mat('#f1ead9', { roughness: 0.9 });
    const spineX = w >= d;
    for (let i = 0; i < n; i++) {
      const bw = w * (i ? 1 - 0.14 * rnd() : 1), bd = d * (i ? 1 - 0.14 * rnd() : 1), cov = K.mat(cols[i % cols.length], { roughness: 0.75 }), ct = Math.min(0.0025, bh * 0.15), bk = new THREE.Group();
      add(bk, K.box(bw, ct, bd, cov, 0, ct / 2, 0), K.box(bw, ct, bd, cov, 0, bh - ct / 2, 0), K.box(Math.max(0.002, bw - 0.006), bh - 2 * ct, Math.max(0.002, bd - 0.006), pages, spineX ? 0 : -0.001, bh / 2, spineX ? 0.001 : 0));
      add(bk, spineX ? K.box(bw, bh, ct, cov, 0, bh / 2, -bd / 2 + ct / 2) : K.box(ct, bh, bd, cov, bw / 2 - ct / 2, bh / 2, 0));
      bk.position.y = i * bh; bk.rotation.y = i ? (rnd() - 0.5) * 0.14 : 0;
      g.add(bk);
    }
  } else if (v === 'tray') {
    const material = matOf(p.material, c1 || '#b08a5a', 'wood'), t = Math.min(0.008, Math.min(w, d) * 0.06), handles = h > 0.035, wh = handles ? h * 0.5 : h, hm = K.metal(hex(p.color2, BRASS));
    add(g, K.box(w, t, d, material, 0, t / 2, 0), K.box(w, wh, t, material, 0, wh / 2, -(d - t) / 2), K.box(w, wh, t, material, 0, wh / 2, (d - t) / 2), K.box(t, wh, d - 2 * t, material, -(w - t) / 2, wh / 2, 0), K.box(t, wh, d - 2 * t, material, (w - t) / 2, wh / 2, 0));
    if (handles) for (const s of [-1, 1]) {
      const x = s * (w - t) / 2, hw = d * 0.22, hr = Math.min(0.004, t * 0.6);
      add(g, K.bar([x, wh, -hw], [x, h - hr, -hw], hr, hm, 6), K.bar([x, wh, hw], [x, h - hr, hw], hr, hm, 6), K.bar([x, h - hr, -hw - hr], [x, h - hr, hw + hr], hr, hm, 6));
    }
  } else if (v === 'basket') {
    const hr = clamp(r * 0.3, 0.008, 0.06), hb = h - hr, t = Math.min(0.008, r * 0.1), prof = [[0, 0]], material = K.rattan(c1 || '#c9a878');
    for (let i = 0; i <= 11; i++) { const tt = i / 11; prof.push([r * (0.76 + 0.24 * Math.sin(tt * Math.PI * 0.72)) * (i === 8 ? 1 : i % 2 ? 0.985 : 0.955), hb * tt]); }
    const top = prof[prof.length - 1];
    g.add(lathe([...prof, top, [top[0] - t, hb], [top[0] - t, hb], [top[0] - t, hb * 0.12], [0, hb * 0.12]], material, 28));
    for (const s of [-1, 1]) { const a = torus(hr - 0.004, Math.min(0.005, hr * 0.2), material, Math.PI, 14); a.rotation.y = Math.PI / 2; a.position.set(s * (top[0] - t * 0.5), hb - 0.002, 0); g.add(a); }
  } else if (v === 'lantern') {
    g.add(lanternBox(w, d, h, matOf(p.material, c1 || DARK, 'metal'), true));
  } else if (v === 'diffuser') {
    const rb = clamp(r * 0.5, 0.008, 0.05), bh = clamp(h * 0.4, 0.02, 0.14), reed = K.mat(hex(p.color2, '#3a322b'), { roughness: 0.9 });
    g.add(noShadow(lathe([[0, 0], [rb, 0], [rb, 0], [rb, bh * 0.68], [rb * 0.45, bh * 0.86], [rb * 0.4, bh], [rb * 0.4, bh], [0, bh]], K.glass(c1 || '#c9a56b', 0.6), 24)));
    g.add(K.cyl(rb * 0.46, rb * 0.46, bh * 0.1, K.metal(hex(p.color3, BRASS)), 0, bh * 0.95, 0, 16));
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8, k = i % 2 ? 0.55 + 0.3 * rnd() : 1; g.add(K.bar([0, bh * 0.25, 0], [Math.cos(a) * (r - 0.002) * k, h * (i % 2 ? 0.9 + 0.08 * rnd() : 0.995), Math.sin(a) * (r - 0.002) * k], 0.0015, reed, 5)); }
  } else {                                                   // standing photo frame
    const t = Math.min(0.015, d * 0.5), lean = clamp(Math.atan2(d - t, h), 0.05, 0.45), L = h / Math.cos(lean), fw = clamp(Math.min(w, L) * 0.07, 0.004, 0.025), hg = new THREE.Group();
    const fp = framedPiece(w, L, t, matOf(p.material, hex(p.frame, c1 || '#c8a476'), 'wood'), artMat(p, seed, w, L, seed % 2 ? 'mono' : null), Math.min(w, L) * 0.08, fw);
    fp.position.z = -t / 2; hg.add(fp); hg.rotation.x = -lean; hg.position.z = d / 2 - 0.001;
    add(g, hg, K.bar([0, L * 0.6 * Math.cos(lean), d / 2 - t - L * 0.6 * Math.sin(lean)], [0, 0.002, -d / 2 + 0.003], 0.003, K.mat('#3a3a3c'), 6));
  }
  return g;
}

function vase2d(ctx, w, d, h, p, px) {
  const v = pick(p.variant, VASE_V), r = Math.min(w, d) / 2, ink = K.INK, soft = K.INK_SOFT;
  const def = { vase: '#e6ddd0', bowl: '#d9cfbf', candle: '#f1eadc', sculpture: '#d9d2c4', books: BOOK_COLORS[0], tray: '#b08a5a', basket: '#c9a878', lantern: DARK, diffuser: '#c9a56b', frame: '#c8a476' }[v];
  const fill = K.tint(hex(p.color, def), 0.4);
  if (v === 'books') { K.fillRR(ctx, 0, 0, w, d, 0.5, fill, ink, px); ctx.save(); ctx.rotate(0.07); K.fillRR(ctx, 0, 0, w * 0.9, d * 0.88, 0.5, K.tint(hex(p.color2, BOOK_COLORS[1]), 0.45), ink, px); ctx.restore(); return; }
  if (v === 'tray') { K.fillRR(ctx, 0, 0, w, d, Math.min(2, r * 0.3), fill, ink, px); K.fillRR(ctx, 0, 0, w - Math.min(3, w * 0.12), d - Math.min(3, d * 0.12), Math.min(1.5, r * 0.2), null, soft, px); return; }
  if (v === 'frame') { K.fillRR(ctx, 0, d * 0.25, w, d * 0.5, 0, fill, ink, px); K.line(ctx, 0, 0, 0, -d / 2, ink, px); return; }
  if (v === 'lantern') { K.fillRR(ctx, 0, 0, w, d, 0, GLOW2D, ink, px); K.fillCircle(ctx, 0, 0, r * 0.3, '#fff3d0', ink, px); return; }
  if (v === 'candle') {
    const n = clamp(Math.round(Math.min(w, d) / 6.5), 1, 3), cr = n === 1 ? r : r * 0.42;
    if (n > 1) ell(ctx, 0, 0, w / 2, d / 2, K.tint(hex(p.color2, BRASS), 0.5), ink, px);
    for (let i = 0; i < n; i++) { const a = i * TAU / n + 0.6, x = n === 1 ? 0 : Math.cos(a) * (r - cr), y = n === 1 ? 0 : Math.sin(a) * (r - cr); K.fillCircle(ctx, x, y, cr, fill, ink, px); K.fillCircle(ctx, x, y, Math.max(px * 0.8, cr * 0.18), '#e8a33a', null); }
    return;
  }
  const has = v === 'vase' && (truthy(p.flowers) || typeof p.flowers === 'string');
  if (has) for (let i = 0; i < 9; i++) { const a = i * GOLD, k = i ? Math.sqrt(i / 8) : 0; K.fillCircle(ctx, Math.cos(a) * r * 0.8 * k, Math.sin(a) * r * 0.8 * k, r * 0.2, rgba(K.tint(hex(p.color3, '#e7b3ad'), 0.2), 0.85), soft, px); }
  ell(ctx, 0, 0, (w / 2) * (has ? 0.55 : 1), (d / 2) * (has ? 0.55 : 1), has ? rgba(fill, 0.8) : fill, ink, px);
  if (v === 'sculpture') K.fillRR(ctx, 0, 0, r * 1.24, r * 1.24, 0, null, soft, px);
  else if (v === 'diffuser') for (let i = 0; i < 8; i++) K.line(ctx, 0, 0, Math.cos(i * TAU / 8) * w / 2, Math.sin(i * TAU / 8) * d / 2, soft, px);
  else ell(ctx, 0, 0, (w / 2) * (v === 'bowl' || v === 'basket' ? 0.8 : 0.35) * (has ? 0.55 : 1), (d / 2) * (v === 'bowl' || v === 'basket' ? 0.8 : 0.35) * (has ? 0.55 : 1), null, soft, px);
}

// ───────────────────────── cushion / throw / bedding ─────────────────────────
const CUSH_V = ['cushion', 'throw', 'bolster', 'floor-cushion', 'duvet-set'];
const CUSH_P = ['plain', 'stripes', 'geometric'];

function cushMat(p, c1, c2) {
  const pat = pick(p.pattern, CUSH_P);
  if (pat === 'plain') return matOf(p.material, c1, 'fabric');
  return texMat(['cush', pat, c1, c2].join('|'), 64, 64, (g, W, H) => {
    g.fillStyle = c1; g.fillRect(0, 0, W, H); g.fillStyle = c2; g.strokeStyle = c2; g.lineWidth = 2;
    if (pat === 'stripes') for (let i = 0; i < 6; i++) g.fillRect(i * W / 6 + W / 24, 0, W / 14, H);
    else for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { diamond(g, (i + 0.5) * W / 4, (j + 0.5) * H / 4, W / 8, H / 8); g.stroke(); diamond(g, (i + 0.5) * W / 4, (j + 0.5) * H / 4, W / 26, H / 26); g.fill(); }
  }, { roughness: 0.95 });
}
/** Soft pillow: pinched corners, fullest in the middle. Fills w × d × h (y ∈ [0, h]). */
function pillow(w, d, h, material, n = 12, pinch = 0.07) {
  const ps = [], uv = [], idx = [], N = (n + 1) * (n + 1);
  for (const s of [1, -1]) for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const a = 2 * i / n - 1, b = 2 * j / n - 1;
    const th = (h / 2) * Math.pow(Math.max(0, (1 - Math.pow(Math.abs(a), 2.6)) * (1 - Math.pow(Math.abs(b), 2.6))), 0.42);
    ps.push(a * (w / 2) * (1 - pinch * (1 - b * b)), h / 2 + s * th, b * (d / 2) * (1 - pinch * (1 - a * a)));
    uv.push(i / n, 1 - j / n);
  }
  for (let k = 0; k < 2; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = k * N + j * (n + 1) + i, b = a + 1, c = a + n + 1, e = c + 1;
    if (k === 0) idx.push(a, c, b, b, c, e); else idx.push(a, b, c, b, e, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}
const duvetLayout = (w, d) => ({ np: w >= 1.2 ? 2 : 1, pd: Math.min(0.5, d * 0.25), dz: d * 0.74 });

function cushion(w, d, h, p) {
  const g = new THREE.Group(), v = pick(p.variant, CUSH_V), c1 = hex(p.color, v === 'duvet-set' ? '#e9e4da' : '#c7b59b'), c2 = hex(p.color2, K.shade(c1, -0.28));
  const material = cushMat(p, c1, c2);
  if (v === 'cushion') g.add(pillow(w, d, h, material));
  else if (v === 'throw') {
    const n = h > 0.05 ? 3 : 2, lh = h / n, fl = clamp(w * 0.06, 0.01, 0.05), pat = pick(p.pattern, CUSH_P);
    for (let i = 0; i < n; i++) {
      const lw = (i ? w * (1 - 0.03 * i) : w) - (i === 0 ? fl : 0), m = pat === 'stripes' && i === 1 ? matOf(p.material, c2, 'fabric') : (pat === 'stripes' ? matOf(p.material, c1, 'fabric') : material);
      g.add(K.rbox(lw, lh * 1.04, d * (1 - 0.035 * i), m, i === 0 ? fl / 2 : w * 0.015 * i, lh * (i + 0.5) - (i ? lh * 0.02 : 0) + (i === 0 ? lh * 0.02 : 0), 0, lh * 0.46));
    }
    const fr = noShadow(new THREE.Mesh(new THREE.PlaneGeometry(d * 0.94, fl), fringeMat(K.shade(c1, 0.2))));
    fr.rotation.x = -Math.PI / 2; fr.rotation.z = -Math.PI / 2; fr.position.set(-w / 2 + fl / 2, Math.max(0.002, lh * 0.3), 0);
    g.add(fr);
  } else if (v === 'bolster') {
    const prof = smooth([[0.001, 0], [0.36, 0.012 * w], [0.5, 0.07 * w], [0.5, 0.5 * w], [0.5, 0.93 * w], [0.36, 0.988 * w], [0.001, w]], 20);
    const m = lathe(prof, material, 24), wrap = new THREE.Group();
    m.rotation.z = Math.PI / 2; m.position.set(w / 2, 0.5, 0); wrap.add(m); wrap.scale.set(1, h, d);
    for (const s of [-1, 1]) { const b = K.sphere(0.07, matOf(p.material, c2, 'fabric'), s * (w / 2 - 0.003), 0.5, 0, 10, 8); b.scale.x = 0.003 / 0.07; wrap.add(b); }
    g.add(wrap);
  } else if (v === 'floor-cushion') {
    const nt = Math.min(w, d) > 0.8 ? 3 : 2, bt = Math.min(0.004, h * 0.1), bm = matOf(p.material, c2, 'fabric');
    g.add(K.rbox(w, h, d, material, 0, h / 2, 0, Math.min(h * 0.38, 0.06)));
    for (let i = 0; i < nt; i++) for (let j = 0; j < nt; j++) g.add(K.cyl(0.012, 0.012, bt, bm, (i - (nt - 1) / 2) * w / (nt + 0.6), h - bt / 2, (j - (nt - 1) / 2) * d / (nt + 0.6), 12));
    g.add(K.rbox(Math.min(0.14, w * 0.3), Math.min(0.025, h * 0.3), 0.006, bm, 0, h / 2, d / 2 - 0.003, 0.002));
  } else {
    const Lr = duvetLayout(w, d), th = clamp(h * 0.55, 0.01, 0.12), pm = matOf(p.material, hex(p.color3, '#f6f4ef'), 'fabric'), pw = w / Lr.np;
    g.add(K.rbox(w, th, Lr.dz, material, 0, th / 2, d / 2 - Lr.dz / 2, th * 0.45));
    g.add(K.rbox(w, th * 0.55, d * 0.13, matOf(p.material, c2, 'fabric'), 0, th + th * 0.2, d / 2 - Lr.dz + d * 0.075, th * 0.25));
    for (let i = 0; i < Lr.np; i++) g.add(at(pillow(pw, Lr.pd, h, pm, 10, 0.05), (i - (Lr.np - 1) / 2) * pw, 0, -d / 2 + Lr.pd / 2));
  }
  return g;
}

function pillowPath(ctx, x, y, w, d, k = 0.07) {
  ctx.beginPath(); ctx.moveTo(x - w / 2, y - d / 2);
  ctx.quadraticCurveTo(x, y - d / 2 + d * k * 2, x + w / 2, y - d / 2); ctx.quadraticCurveTo(x + w / 2 - w * k * 2, y, x + w / 2, y + d / 2);
  ctx.quadraticCurveTo(x, y + d / 2 - d * k * 2, x - w / 2, y + d / 2); ctx.quadraticCurveTo(x - w / 2 + w * k * 2, y, x - w / 2, y - d / 2); ctx.closePath();
}
function cushion2d(ctx, w, d, h, p, px) {
  const v = pick(p.variant, CUSH_V), c1 = hex(p.color, v === 'duvet-set' ? '#e9e4da' : '#c7b59b'), c2 = hex(p.color2, K.shade(c1, -0.28)), fill = K.tint(c1, 0.35), ink = K.INK, soft = K.INK_SOFT;
  const pat = pick(p.pattern, CUSH_P);
  const fs = (path) => { path(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = px; ctx.stroke(); };
  if (v === 'duvet-set') {
    const Lr = duvetLayout(w / 100, d / 100), dz = Lr.dz * 100, pd = Lr.pd * 100, pw = w / Lr.np;
    K.fillRR(ctx, 0, d / 2 - dz / 2, w, dz, Math.min(6, w * 0.05), fill, ink, px);
    K.fillRR(ctx, 0, d / 2 - dz + d * 0.075, w, d * 0.13, Math.min(3, w * 0.03), K.tint(c2, 0.45), ink, px);
    for (let i = 0; i < Lr.np; i++) { pillowPath(ctx, (i - (Lr.np - 1) / 2) * pw, -d / 2 + pd / 2, pw * 0.96, pd, 0.05); ctx.fillStyle = K.tint(hex(p.color3, '#f6f4ef'), 0.3); ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = px; ctx.stroke(); }
    return;
  }
  if (v === 'cushion') fs(() => pillowPath(ctx, 0, 0, w, d));
  else if (v === 'bolster') { fs(() => K.rr(ctx, 0, 0, w, d, d * 0.4)); K.line(ctx, -w / 2 + d * 0.35, -d * 0.4, -w / 2 + d * 0.35, d * 0.4, soft, px); K.line(ctx, w / 2 - d * 0.35, -d * 0.4, w / 2 - d * 0.35, d * 0.4, soft, px); }
  else if (v === 'floor-cushion') {
    fs(() => K.rr(ctx, 0, 0, w, d, Math.min(w, d) * 0.14));
    const nt = Math.min(w, d) > 80 ? 3 : 2;
    for (let i = 0; i < nt; i++) for (let j = 0; j < nt; j++) K.fillCircle(ctx, (i - (nt - 1) / 2) * w / (nt + 0.6), (j - (nt - 1) / 2) * d / (nt + 0.6), Math.max(px, 1.2), ink, null);
  } else {
    const fl = clamp(w * 0.06, 1, 5);
    for (let y = -d * 0.44; y <= d * 0.44; y += Math.max(2 * px, d * 0.07)) K.line(ctx, -w / 2, y, -w / 2 + fl, y, soft, px);
    ctx.save(); ctx.translate(fl / 2, 0); fs(() => K.rr(ctx, 0, 0, w - fl, d, Math.min(w, d) * 0.08)); ctx.restore();
    K.line(ctx, -w / 2 + fl + w * 0.05, -d / 2, -w / 2 + fl + w * 0.05, d / 2, soft, px); K.line(ctx, w / 2 - w * 0.08, -d / 2, w / 2 - w * 0.08, d / 2, soft, px);
  }
  if (pat !== 'plain' && v !== 'throw') {
    ctx.save(); (v === 'cushion' ? pillowPath(ctx, 0, 0, w, d) : K.rr(ctx, 0, 0, w, d, Math.min(w, d) * 0.14)); ctx.clip();
    ctx.strokeStyle = rgba(c2, 0.55); ctx.lineWidth = Math.max(px, w * 0.03);
    if (pat === 'stripes') for (let i = 0; i < 6; i++) { const x = -w / 2 + (i + 0.5) * w / 6; ctx.beginPath(); ctx.moveTo(x, -d / 2); ctx.lineTo(x, d / 2); ctx.stroke(); }
    else { ctx.lineWidth = px; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { diamond(ctx, -w / 2 + (i + 0.5) * w / 4, -d / 2 + (j + 0.5) * d / 4, w / 8, d / 8); ctx.stroke(); } }
    ctx.restore();
  }
}

reg('plant', plant, plant2d);
reg('vase', vase, vase2d);
reg('cushion', cushion, cushion2d);
