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
  return new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.001, R), Math.max(0.0005, t), 8, seg, arc), material);
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
      const src = memo('ico1', () => new THREE.IcosahedronGeometry(1, 1).toNonIndexed().attributes.position.array);
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
  const g = new THREE.Group();
  g.add(lathe([...pts, top, [0, hh]], outer));
  const e = Math.min(0.003, hh * 0.06);
  g.add(noShadow(lathe(pts.map(([a, b]) => [Math.max(0.001, a - e), b - e]).reverse(), linerMat(on))));
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
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1), frame);
  roof.rotation.y = Math.PI / 4; roof.scale.set(w * 0.96, roofH, d * 0.96); roof.position.y = bodyTop + t + roofH / 2;
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
    add(g, K.cyl(rs * 0.3, rs * 0.2, 0.012, metal, 0, h - sh, zc, 12), at(drum(rs, rs * 0.72, sh, shadeMat(p, on)), 0, 0, zc));
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

//@@PART2@@
