/**
 * Storage & beds models: cabinet, wardrobe, bookcase, shelf-wall, bed, bunk-bed, crib, coat-rack.
 *
 * Every builder returns a group in METRES that fills the w × d × h box exactly (front = +Z, back = −Z) and every
 * type has a matching top-view plan symbol in CENTIMETRES. Panel thicknesses, reveals, legs and handles keep their
 * real-world size whatever the overall dimensions are. See docs/CONTRACT.md § 3.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerModel } from './registry.js';
import * as K from './kit.js';

// ───────────────────────── constants ─────────────────────────
const T = 0.018;      // carcass / front panel thickness
const GAP = 0.003;    // reveal between fronts
const BACK = 0.006;   // back panel thickness
const MATERIALS = ['fabric', 'leather', 'velvet', 'wood', 'metal', 'rattan', 'plastic', 'glass', 'stone', 'ceramic', 'concrete', 'laminate', 'lacquer', 'aluminium', 'teak', 'textile'];
const SOFT = ['fabric', 'leather', 'velvet', 'textile'];
const MUTED = ['#b9a48c', '#8c9a8b', '#cbbdaa', '#6f7f8f', '#ded6c9', '#a0725b', '#434a54', '#ece7de', '#9aa7ad', '#b88f7a', '#7d6f63'];
const BOOKS = ['#e9e3d6', '#d9cdb8', '#b9a48c', '#8a9a86', '#5f7361', '#aab4b8', '#56667a', '#2f3640', '#c08a6a', '#a6553f', '#d2b25f', '#f3f0ea', '#77706a'];
const CERAMICS = ['#ebe5d9', '#c9b9a3', '#8a9a86', '#3f4650', '#c08a6a', '#f4f1ea'];
const WHITE_LINEN = '#f4f1ea';

// ───────────────────────── param helpers ─────────────────────────
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const range = (n) => Array.from({ length: Math.max(0, n) }, (_, i) => i);
const r3 = (v) => Math.round(v * 1000) / 1000;
const pos = (v) => (v > 0.0005 ? v : 0.0005);
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Finite number from a param (numbers or numeric strings), clamped; otherwise `def`. */
function num(v, def, lo = -Infinity, hi = Infinity) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? clamp(n, lo, hi) : def;
}
const int = (v, def, lo, hi) => { const n = num(v, NaN, lo, hi); return Number.isFinite(n) ? Math.round(n) : def; };
const flag = (v, def = false) => (v === true || v === 'true' || v === 1 ? true : v === false || v === 'false' || v === 0 ? false : def);
const oneOf = (v, list, def) => (typeof v === 'string' && list.includes(v) ? v : def);
/** Safe hex colour from a param (hex string or kit colour keyword). */
function hex(c, fallback) {
  if (typeof c !== 'string') return fallback;
  if (HEX.test(c)) return c;
  const k = K.col(c, null);
  return typeof k === 'string' && HEX.test(k) ? k : fallback;
}
const _col = new THREE.Color();
function hsl(c) { const o = { h: 0, s: 0, l: 0 }; _col.set(c).getHSL(o, THREE.SRGBColorSpace); return o; }
const isNeutral = (c) => { const { s, l } = hsl(c); return s < 0.16 || l > 0.9 || l < 0.1; };
const seeded = (item, type) => K.rng(K.hashStr((item && item.id) || type));
const pickFrom = (rnd, list) => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];

// ───────────────────────── materials ─────────────────────────
const paint = (c) => K.mat(c, { roughness: 0.5 });
const MAT_DEFAULT = { metal: '#3a3d42', aluminium: '#b9bcc0', stone: '#e4e1db', concrete: '#b5b2ac', ceramic: '#f4f2ee', glass: '#f1eee8', plastic: '#f1eee8', laminate: '#f1eee8', lacquer: '#f1eee8', teak: '#a9743f' };

/** Panel finish for furniture bodies: the explicit material when valid, otherwise inferred from the colour. */
function finish(material, color, defColor = '#c8a476') {
  const m = oneOf(material, MATERIALS, null);
  const c = hex(color, null) || (m && MAT_DEFAULT[m]) || hex(defColor, '#c8a476');
  switch (m) {
    case 'wood': case 'teak': case 'rattan': return K.wood(c);
    case 'lacquer': return K.lacquer(c);
    case 'laminate': case 'plastic': case 'glass': return paint(c);
    case 'metal': case 'aluminium': return K.metal(c, { roughness: 0.5, metalness: 0.45 });
    case 'stone': case 'concrete': case 'ceramic': case 'fabric': case 'textile': case 'leather': case 'velvet': return K.byMaterial(m, c);
    default: return isNeutral(c) ? paint(c) : K.wood(c);
  }
}
const _bm = new Map();
/** Vertex-coloured material for merged detail meshes (books, clothes, handles…). */
function batchMat(roughness = 0.85, metalness = 0) {
  const k = `${roughness}|${metalness}`;
  if (!_bm.has(k)) _bm.set(k, new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness }));
  return _bm.get(k);
}
let _caneTex = null;
const _cane = new Map();
/** Woven cane / rattan webbing. */
function caneMat(color = '#dcc59c') {
  if (_cane.has(color)) return _cane.get(color);
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.9 });
  if (typeof document !== 'undefined') {
    if (!_caneTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
      g.strokeStyle = 'rgba(70,45,20,0.42)'; g.lineWidth = 2.2;
      for (let i = -64; i <= 128; i += 16) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke();
        g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke();
      }
      g.strokeStyle = 'rgba(70,45,20,0.2)'; g.lineWidth = 1.2;
      for (let i = 8; i < 64; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
      _caneTex = new THREE.CanvasTexture(c);
      _caneTex.wrapS = _caneTex.wrapT = THREE.RepeatWrapping;
      _caneTex.repeat.set(22, 12);
      _caneTex.colorSpace = THREE.SRGBColorSpace;
    }
    m.map = _caneTex;
  }
  _cane.set(color, m);
  return m;
}

// ───────────────────────── geometry helpers ─────────────────────────
const _grain = new Map();
/** Box geometry whose UVs are in metres with the wood grain running along the longest edge. */
function grainGeometry(w, h, d) {
  const k = `${r3(w)}|${r3(h)}|${r3(d)}`;
  if (_grain.has(k)) return _grain.get(k);
  const g = new THREE.BoxGeometry(w, h, d);
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
  const dims = [w, h, d], long = dims.indexOf(Math.max(w, h, d));
  for (let i = 0; i < P.count; i++) {
    const p = [P.getX(i), P.getY(i), P.getZ(i)], n = [Math.abs(N.getX(i)), Math.abs(N.getY(i)), Math.abs(N.getZ(i))];
    const axis = n.indexOf(Math.max(...n));
    const [a, b] = [0, 1, 2].filter((j) => j !== axis);
    const along = b === long ? b : a, across = b === long ? a : b;
    U.setXY(i, p[along] / 0.9 + 0.31, p[across] / 0.5 + 0.17);
  }
  _grain.set(k, g);
  return g;
}
/** Box centred at (x, y, z); textured materials get physically scaled UVs. */
function B(w, h, d, material, x = 0, y = 0, z = 0) {
  w = pos(w); h = pos(h); d = pos(d);
  if (!material.map) return K.box(w, h, d, material, x, y, z);
  const m = new THREE.Mesh(grainGeometry(w, h, d), material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
/** Box given by its extents. */
const span = (x0, x1, y0, y1, z0, z1, material) => B(x1 - x0, y1 - y0, z1 - z0, material, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
/** Horizontal round tubes along X / Z. */
const tubeX = (r, len, m, x, y, z, seg = 12) => { const t = K.cyl(r, r, pos(len), m, x, y, z, seg); t.rotation.z = Math.PI / 2; return t; };
const tubeZ = (r, len, m, x, y, z, seg = 12) => { const t = K.cyl(r, r, pos(len), m, x, y, z, seg); t.rotation.x = Math.PI / 2; return t; };

const _unitBox = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const _unitCyl = new Map();
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

/** Collects many small coloured solids and merges them into ONE mesh (keeps draw calls low). */
class Batch {
  constructor() { this.parts = []; }
  add(geometry, color, x = 0, y = 0, z = 0, { rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(_m4.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)));
    _col.set(hex(color, '#999999'));
    const n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = _col.r; arr[i * 3 + 1] = _col.g; arr[i * 3 + 2] = _col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    this.parts.push(g);
    return this;
  }
  box(w, h, d, color, x, y, z, rot = {}) { return this.add(_unitBox, color, x, y, z, { ...rot, sx: pos(w), sy: pos(h), sz: pos(d) }); }
  span(x0, x1, y0, y1, z0, z1, color) { return this.box(x1 - x0, y1 - y0, z1 - z0, color, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); }
  /** Cylinder (axis Y unless rotated). taper = top radius / bottom radius. */
  cyl(r, h, color, x, y, z, rot = {}, taper = 1, seg = 10) {
    const k = `${seg}|${taper}`;
    if (!_unitCyl.has(k)) _unitCyl.set(k, new THREE.CylinderGeometry(taper, 1, 1, seg).toNonIndexed());
    return this.add(_unitCyl.get(k), color, x, y, z, { ...rot, sx: pos(r), sy: pos(h), sz: pos(r) });
  }
  get empty() { return this.parts.length === 0; }
  mesh(material = batchMat()) {
    if (!this.parts.length) return null;
    const geo = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    if (!geo) return null;
    const m = new THREE.Mesh(geo, material);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  into(group, material) { const m = this.mesh(material); if (m) group.add(m); }
}

const _pillow = new Map();
/** Plump cushion: swells towards the centre and pinches to a seam along the edges. Exactly w × h × d. */
function pillowGeometry(w, h, d) {
  const k = `${r3(w)}|${r3(h)}|${r3(d)}`;
  if (_pillow.has(k)) return _pillow.get(k);
  const nx = 10, nz = 8, P = [], I = [];
  const prof = (s) => Math.pow(1 - Math.pow(Math.abs(s), 3.2), 0.55);
  for (let side = 0; side < 2; side++) {
    for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
      const u = (ix / nx) * 2 - 1, v = (iz / nz) * 2 - 1;
      P.push(u * (w / 2) * (1 - 0.035 * (1 - v * v)), (side ? -0.8 : 1) * (h / 1.8) * prof(u) * prof(v) - h / 2 + (h / 1.8) * 0.8, v * (d / 2) * (1 - 0.035 * (1 - u * u)));
    }
    const o = side * (nx + 1) * (nz + 1);
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const a = o + iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, e = c + 1;
      if (side) I.push(a, b, c, b, e, c); else I.push(a, c, b, b, c, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  _pillow.set(k, g);
  return g;
}
function pillow(w, h, d, material, x, y, z, lean = 0) {
  const m = new THREE.Mesh(pillowGeometry(pos(w), pos(h), pos(d)), material);
  m.position.set(x, y, z); m.rotation.x = lean; m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Prism with a profile given in the Z–Y plane ([[z, y], …]) extruded from x0 to x1 (leaning rails, wedges). */
function prismZY(points, x0, x1, material) {
  const s = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(s, { depth: pos(x1 - x0), bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  geo.translate(x1, 0, 0);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Hanging garment silhouette added to a batch. plane 'zy' = hanging on a rail that runs along X; 'xy' = flat against a wall. */
function garment(batch, { x, y, z, sw, len, t, color, flare = 0.92, plane = 'zy', hanger = true }) {
  const hw = Math.max(0.03, sw / 2 - 0.012), n = Math.min(0.05, hw * 0.4), sh = 0.06;
  const s = new THREE.Shape();
  s.moveTo(-n, 0); s.lineTo(n, 0); s.lineTo(hw, -sh); s.lineTo(hw * flare, -len); s.lineTo(-hw * flare, -len); s.lineTo(-hw, -sh);
  const geo = new THREE.ExtrudeGeometry(s, { depth: t * 0.5, bevelEnabled: true, bevelThickness: t * 0.25, bevelSize: 0.012, bevelSegments: 1, steps: 1, curveSegments: 1 });
  geo.translate(0, -0.012, -t * 0.25);
  if (plane === 'zy') geo.rotateY(Math.PI / 2);
  batch.add(geo, color, x, y, z);
  geo.dispose();
  if (hanger) {
    if (plane === 'zy') batch.box(0.012, 0.012, sw * 0.8, '#b89b72', x, y + 0.004, z).box(0.004, 0.06, 0.004, '#8a8d90', x, y + 0.035, z);
    else batch.box(sw * 0.8, 0.012, 0.012, '#b89b72', x, y + 0.004, z);
  }
}
/** A pair of shoes, toes towards +Z. */
function shoePair(batch, rnd, x, y, z, len, color) {
  const sole = rnd() < 0.5 ? '#f1ede4' : '#2b2b2d';
  for (const s of [-1, 1]) {
    const sx = x + s * 0.056;
    batch.box(0.092, 0.016, len, sole, sx, y + 0.008, z);
    batch.box(0.086, 0.062, len * 0.56, color, sx, y + 0.047, z - len * 0.2);
    batch.box(0.086, 0.036, len * 0.42, color, sx, y + 0.034, z + len * 0.27);
  }
}
/** Small stack of folded clothes. */
function foldedStack(batch, rnd, x, y, z, w, d, hMax) {
  let top = y;
  const n = 2 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const t = 0.024 + rnd() * 0.014;
    if (top + t > y + hMax) break;
    batch.box(w * (0.92 + rnd() * 0.08), t, d * (0.92 + rnd() * 0.08), pickFrom(rnd, MUTED), x + (rnd() - 0.5) * 0.012, top + t / 2, z + (rnd() - 0.5) * 0.012);
    top += t + 0.001;
  }
}

/** Registers a model with sanitised arguments so builders never see junk sizes or non-object params. */
function register(type, build, draw2d) {
  const size = (v) => (Number.isFinite(+v) && +v > 0 ? +v : 1);
  const params = (p) => (p && typeof p === 'object' ? p : {});
  registerModel(type, {
    build: (a = {}) => build({ w: size(a.w), d: size(a.d), h: size(a.h), p: params(a.p), item: a.item }),
    draw2d: (ctx, a = {}) => {
      ctx.save();
      ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
      draw2d(ctx, { w: size(a.w), d: size(a.d), h: size(a.h), p: params(a.p), px: a.px > 0 ? a.px : 1, item: a.item });
      ctx.restore();
    },
  });
}

// ───────────────────────── 2D helpers (cm) ─────────────────────────
/** Filled + outlined rectangle given by extents. */
function rect2(ctx, x0, y0, x1, y1, fill, stroke = K.INK, lw = 1) {
  ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function dashed(ctx, pattern, fn) { ctx.save(); ctx.setLineDash(pattern); fn(); ctx.restore(); }

// ═════════════════════════ CABINET ═════════════════════════
const defaultHandles = (style) => (style === 'minimal' ? 'none' : style === 'scandinavian' ? 'cutout' : style === 'classic' || style === 'rustic' || style === 'boho' ? 'knob' : 'bar');

/** Front counts when the product gives none: derived from the proportions of the piece. */
function autoCabinet(W, H, h, C, flaps) {
  const rows = clamp(Math.round(H / 0.2), 1, 5);
  if (flaps) return { D: clamp(Math.round(H / 0.42), 1, 4) * (W > 1 ? 2 : 1), R: 0, O: 0, C: 0 };
  if (C === 1 || (!C && W <= 0.62)) {
    if (h <= 0.72) return { D: 0, R: rows, O: 0, C: 1 };
    if (h <= 1.15) return { D: W > 0.5 ? 2 : 1, R: 1, O: 0, C: 1 };
    return { D: (W > 0.5 ? 2 : 1) * (h > 1.5 ? 2 : 1), R: 0, O: 0, C: W > 0.5 ? 2 : 1 };
  }
  if (h <= 0.52) {
    const c = C || 2 * clamp(Math.round(W / 1.2), 1, 3);
    return H >= 0.3 ? { D: 0, R: c, O: Math.max(1, Math.round(c / 2)), C: 0 } : { D: 0, R: c, O: 0, C: c };
  }
  if (h <= 1.1) {
    const c = C || clamp(Math.round(W / 0.58), 2, 6);
    if (c === 2) return W < 1.05 || C ? { D: 2, R: 0, O: 0, C: 0 } : { D: 2, R: rows, O: 0, C: 0 };
    if (c === 3) return { D: 2, R: rows, O: 0, C: 3 };
    if (c === 4) return { D: 2, R: rows * 2, O: 0, C: 4 };
    return { D: 4, R: rows * (c - 4), O: 0, C: c };
  }
  const c = C || clamp(Math.round(W / 0.48), 2, 6);
  return h > 1.5 ? { D: c * 2, R: 0, O: 0, C: c } : { D: c, R: 0, O: 0, C: 0 };
}

function cabinetOptions(w, d, h, p) {
  const style = typeof p.style === 'string' ? p.style : '';
  const cane = p.material === 'rattan';
  const glass = flag(p.glassDoors) || p.material === 'glass';
  const bodyHex = hex(p.color, p.material === 'glass' ? '#f1eee8' : (oneOf(p.material, MATERIALS, null) && MAT_DEFAULT[p.material]) || '#c8a476');
  const body = finish(p.material, p.color);
  const legs = oneOf(p.legs, ['wood', 'metal', 'plinth', 'none', 'wall'], h >= 1.1 ? 'plinth' : style === 'industrial' ? 'metal' : 'wood');
  let legH = 0;
  if (legs === 'plinth') legH = num(p.legHeight, 7, 2, 30) / 100;
  else if (legs === 'wood' || legs === 'metal') legH = num(p.legHeight, clamp(h * 18, 6, 15), 2, 120) / 100;
  legH = clamp(legH, 0, Math.max(0, h - 0.1));
  const twoTone = (legs === 'none' || legs === 'wall') && hex(p.color2, null);
  const carcass = twoTone ? finish(p.material2, p.color2) : body;
  const legMat = legs === 'metal' ? K.metal(hex(p.color2, '#2b2d31')) : legs === 'plinth' ? (hex(p.color2, null) ? finish(p.material2, p.color2) : body) : K.wood(hex(p.color2, isNeutral(bodyHex) ? '#c8a476' : K.shade(bodyHex, -0.12)));
  const topKind = oneOf(p.top, MATERIALS, null);
  let topMat = carcass;
  if (topKind) {
    const woody = topKind === 'wood' || topKind === 'teak';
    const tc = hex(p.topColor, (woody && hex(p.color2, null)) || MAT_DEFAULT[topKind] || '#c8a476');
    topMat = topKind === 'glass' ? K.glass() : woody ? K.wood(tc) : K.byMaterial(topKind, tc, 'lacquer');
  }
  const tt = Math.min(topKind === 'stone' || topKind === 'ceramic' || topKind === 'concrete' ? 0.02 : topKind === 'wood' || topKind === 'teak' ? 0.026 : topKind === 'glass' ? T + 0.006 : T, h * 0.3);
  const ov = topKind && topKind !== 'glass' ? Math.min(0.008, w * 0.05) : 0;
  const handles = oneOf(p.handles, ['bar', 'knob', 'none', 'cutout'], defaultHandles(style));
  const hp = handles === 'bar' ? 0.028 : handles === 'knob' ? 0.026 : 0;
  const W = w - 2 * ov, H = h - tt - legH;
  let D = int(p.doors, 0, 0, 12), R = int(p.drawers, 0, 0, 24), O = p.open === true ? 1 : int(p.open, 0, 0, 24), C = int(p.columns, 0, 0, 12);
  const shallow = d <= 0.26 && h >= 0.6;
  if (D + R + O === 0) ({ D, R, O, C } = autoCabinet(W, H, h, C, shallow));
  return { style, cane, glass, bodyHex, body, carcass, legs, legH, legMat, topKind, topMat, tt, ov, handles, hp, D, R, O, C, flaps: shallow && D > 0,
    handleHex: hex(p.color3, hsl(bodyHex).l < 0.3 ? '#c2a15c' : '#2e3033') };
}

/** Splits the front (W × H, origin bottom-left) into door / drawer / flap / open cells. */
function layoutCabinet(W, H, o) {
  const cells = [];
  const { D, R, O, C } = o;
  const add = (kind, x0, x1, y0, y1, hinge) => { if (x1 - x0 > 0.001 && y1 - y0 > 0.001) cells.push({ kind, x0, x1, y0, y1, hinge }); };
  const maxRows = (hh) => Math.max(1, Math.floor(hh / 0.1));
  const doorRow = (n, x0, x1, y0, y1) => {
    for (let i = 0; i < n; i++) {
      const a = x0 + ((x1 - x0) * i) / n, b = x0 + ((x1 - x0) * (i + 1)) / n;
      const hinge = n === 1 ? ((a + b) / 2 <= W / 2 + 0.001 ? 'l' : 'r') : i % 2 === 1 || (n % 2 === 1 && i === n - 1) ? 'r' : 'l';
      add('door', a, b, y0, y1, hinge);
    }
  };
  const doorGrid = (n, cols, x0, x1, y0, y1) => {
    cols = clamp(cols || n, 1, n);
    if ((x1 - x0) / cols < 0.2) cols = clamp(Math.floor((x1 - x0) / 0.26), 1, n);
    const tiers = Math.ceil(n / cols);
    const cut = tiers === 2 && y1 - y0 > 1.15 ? [0, 0.38, 1] : range(tiers + 1).map((i) => i / tiers);
    for (let t = 0; t < tiers; t++) doorRow(t < tiers - 1 ? cols : n - cols * (tiers - 1), x0, x1, y0 + (y1 - y0) * cut[t], y0 + (y1 - y0) * cut[t + 1]);
  };
  /** n cells in rows of `cols`; the top row takes the remainder as wider cells. */
  const grid = (kind, n, cols, x0, x1, y0, y1) => {
    if (n <= 0) return;
    cols = clamp(cols, 1, n);
    let rows = Math.ceil(n / cols);
    if (rows > maxRows(y1 - y0)) { cols = Math.ceil(n / maxRows(y1 - y0)); rows = Math.ceil(n / cols); }
    for (let r = 0; r < rows; r++) {
      const k = r === 0 ? n - cols * (rows - 1) : cols;
      const b = y1 - ((y1 - y0) * r) / rows, a = y1 - ((y1 - y0) * (r + 1)) / rows;
      for (let i = 0; i < k; i++) add(kind, x0 + ((x1 - x0) * i) / k, x0 + ((x1 - x0) * (i + 1)) / k, a, b, 'top');
    }
  };
  const doors = (n, x0, x1, y0, y1, cols) => (o.flaps ? grid('flap', n, x1 - x0 > 1 ? 2 : 1, x0, x1, y0, y1) : doorGrid(n, cols, x0, x1, y0, y1));
  const kinds = (D > 0) + (R > 0) + (O > 0);
  if (!kinds) return cells;
  if (kinds === 1) {
    if (R) grid('drawer', R, C || clamp(Math.round(W / 0.75), 1, 4), 0, W, 0, H);
    else if (O) grid('open', O, C || clamp(Math.round(W / 0.45), 1, O), 0, W, 0, H);
    else doors(D, 0, W, 0, H, C);
    return cells;
  }
  if (C === 1 || (!C && W <= 0.62)) {   // single bay: drawers on top, open niches, doors at the bottom
    const hd = R ? Math.min(clamp((H * 0.42) / R, 0.09, 0.2) * R, H * 0.7) : 0;
    const rest = H - hd;
    const ho = O ? (D ? Math.min(clamp((rest * 0.45) / O, 0.1, 0.3) * O, rest * 0.6) : rest) : 0;
    grid('drawer', R, 1, 0, W, H - hd, H);
    grid('open', O, 1, 0, W, H - hd - ho, H - hd);
    if (D) doors(D, 0, W, 0, H - hd - ho, D);
    return cells;
  }
  if (D && R && R <= D && H >= 0.5 && (C ? C <= D : H >= 0.62 || W / (D + 1) < 0.3)) {   // buffet: drawers above doors
    const Wd = O ? (W * D) / (D + 1) : W, hd = clamp(H * 0.24, 0.13, 0.2);
    grid('drawer', R, R, 0, Wd, H - hd, H);
    doors(D, 0, Wd, 0, H - hd, D);
    grid('open', O, 1, Wd, W, 0, H);
    return cells;
  }
  if (!D && H >= 0.3 && W >= 0.9) {   // media unit: open niches above drawers
    const ho = clamp(H * 0.42, 0.12, 0.22);
    grid('open', O, O, 0, W, H - ho, H);
    grid('drawer', R, C || clamp(Math.round(W / 0.6), 1, R), 0, W, 0, H - ho);
    return cells;
  }
  // side-by-side sections: doors outside, drawer stacks and open bays in the middle
  const rowsPref = clamp(Math.round(H / 0.2), 1, maxRows(H)), openRows = clamp(Math.round(H / 0.32), 1, 5);
  let ns = R ? Math.ceil(R / rowsPref) : 0, no = O ? Math.ceil(O / openRows) : 0;
  if (C && C - D >= (R > 0) + (O > 0)) {
    const other = C - D;
    if (R && O) { no = clamp(no, 1, other - 1); ns = other - no; } else if (R) ns = other; else no = other;
  }
  ns = Math.min(ns, R); no = Math.min(no, O);
  const share = (total, parts) => range(parts).map((i) => Math.floor(total / parts) + (i < total % parts ? 1 : 0));
  const dr = share(R, ns).map((n) => ({ kind: 'drawer', n, u: D >= 3 ? 1.25 : 1 })), op = share(O, no).map((n) => ({ kind: 'open', n, u: 1 }));
  const mid = [...dr.slice(0, Math.ceil(ns / 2)), ...op, ...dr.slice(Math.ceil(ns / 2))];
  const sections = D && D % 2 === 0 ? [{ kind: 'door', n: D / 2, u: D / 2 }, ...mid, { kind: 'door', n: D / 2, u: D / 2 }] : [...(D ? [{ kind: 'door', n: D, u: D }] : []), ...mid];
  const total = sections.reduce((s, c) => s + c.u, 0);
  let x = 0;
  for (const s of sections) {
    const x1 = x + (W * s.u) / total;
    if (s.kind === 'door') doors(s.n, x, x1, 0, H, s.n); else grid(s.kind, s.n, 1, x, x1, 0, H);
    x = x1;
  }
  return cells;
}

/** Door made of a frame with an infill pane (glass, cane…). */
function framedFront(g, x0, x1, y0, y1, z0, z1, frameMat, infill) {
  const fw = clamp(Math.min(x1 - x0, y1 - y0) * 0.14, 0.02, 0.05);
  g.add(span(x0, x0 + fw, y0, y1, z0, z1, frameMat), span(x1 - fw, x1, y0, y1, z0, z1, frameMat),
    span(x0 + fw, x1 - fw, y0, y0 + fw, z0, z1, frameMat), span(x0 + fw, x1 - fw, y1 - fw, y1, z0, z1, frameMat));
  const zi = (z0 + z1) / 2;
  const pane = span(x0 + fw, x1 - fw, y0 + fw, y1 - fw, zi - 0.003, zi + 0.003, infill);
  if (infill.transparent) pane.userData.noShadow = true;
  g.add(pane);
}

/** Adds the handle of one front to the handle batch. Coordinates are the front's rectangle; zf = its face. */
function addHandle(hb, kind, style, hp, colour, darkHex, { x0, x1, y0, y1, hinge }, zf) {
  if (style === 'none') return;
  const cw = x1 - x0, ch = y1 - y0, cx = (x0 + x1) / 2;
  const horizontal = kind !== 'door';
  const lower = y0 >= 0.9;                         // doors of an upper tier are gripped at the bottom
  if (style === 'cutout') {
    const len = horizontal ? clamp(cw * 0.26, 0.06, 0.16) : Math.min(0.09, cw * 0.5);
    const x = horizontal ? cx : hinge === 'l' ? x1 - 0.02 - len / 2 : x0 + 0.02 + len / 2;
    hb.box(len, 0.02, 0.002, darkHex, x, lower && !horizontal ? y0 + 0.0115 : y1 - 0.0115, zf - 0.0006);
    return;
  }
  const inset = Math.min(0.045, cw * 0.22);
  const xh = hinge === 'l' ? x1 - inset : x0 + inset;
  let len = horizontal ? clamp(cw * 0.3, 0.06, 0.32) : clamp(ch * 0.3, 0.06, ch > 1 ? 0.32 : 0.2);
  let yc;
  if (kind === 'flap') yc = y1 - Math.min(0.07, ch * 0.25);
  else if (horizontal) yc = y0 + ch * (ch < 0.16 ? 0.5 : 0.56);
  else if (y1 > 1.25 && y0 < 0.9) yc = clamp(1.02, y0 + len / 2 + 0.03, y1 - len / 2 - 0.03);
  else yc = lower ? y0 + 0.05 + len / 2 : y1 - 0.05 - len / 2;
  if (style === 'knob') {
    const xs = horizontal ? (cw > 0.75 ? [cx - cw * 0.25, cx + cw * 0.25] : [cx]) : [xh];
    const yk = horizontal ? yc : lower ? y0 + 0.07 : y1 > 1.25 && y0 < 0.9 ? yc : y1 - 0.07;
    for (const x of xs) {
      hb.cyl(0.0055, hp - 0.008, colour, x, yk, zf + (hp - 0.008) / 2, { rx: Math.PI / 2 });
      hb.cyl(0.014, 0.009, colour, x, yk, zf + hp - 0.0045, { rx: Math.PI / 2 }, 0.8, 14);
    }
    return;
  }
  len = Math.min(len, (horizontal ? cw : ch) - 0.02);
  const zb = zf + hp - 0.0045, off = len / 2 - 0.014, so = hp - 0.009;
  if (horizontal) {
    hb.box(len, 0.009, 0.009, colour, cx, yc, zb);
    for (const s of [-1, 1]) hb.box(0.008, 0.008, so, colour, cx + s * off, yc, zf + so / 2);
  } else {
    hb.box(0.009, len, 0.009, colour, xh, yc, zb);
    for (const s of [-1, 1]) hb.box(0.008, 0.008, so, colour, xh, yc + s * off, zf + so / 2);
  }
}

function cabinetLegs(o, wc, z0, z1) {
  const g = new THREE.Group(), legH = o.legH, dc = z1 - z0;
  if (o.legs === 'plinth') { g.add(span(-wc / 2 + 0.012, wc / 2 - 0.012, 0, legH, z0 + 0.01, z1 - 0.035, o.legMat)); return g; }
  const metal = o.legs === 'metal';
  const inset = Math.min(metal ? 0.022 : 0.05, wc * 0.2, dc * 0.22);
  const r = metal ? 0.011 : clamp(0.014 + legH * 0.05, 0.016, 0.024);
  const xs = wc > 1.5 ? [-wc / 2 + inset, 0, wc / 2 - inset] : [-wc / 2 + inset, wc / 2 - inset];
  for (const x of xs) for (const z of [z0 + inset, z1 - inset]) {
    g.add(metal ? K.boxOn(r * 2, legH, r * 2, o.legMat, x, 0, z) : K.cylOn(r, r * 0.62, legH, o.legMat, x, 0, z, 14));
  }
  if (metal && legH > 0.3) for (const x of xs) g.add(span(x - r, x + r, legH * 0.25, legH * 0.25 + r * 2, z0 + inset, z1 - inset, o.legMat));
  return g;
}

function buildCabinet({ w, d, h, p }) {
  const g = new THREE.Group();
  const o = cabinetOptions(w, d, h, p);
  const wc = w - 2 * o.ov, yB = o.legH, yT = h - o.tt;
  const cells = layoutCabinet(wc, yT - yB, o);
  const fronts = cells.some((c) => c.kind !== 'open');
  const hp = fronts ? o.hp : 0;
  const zBack = -d / 2, zFace = fronts ? d / 2 - Math.max(hp, o.ov) : d / 2;
  const tf = Math.min(T, d * 0.2);
  const zc = fronts ? zFace - tf - GAP : zFace - o.ov;
  const pt = Math.min(T, wc * 0.2, (yT - yB) * 0.2);
  const m = o.carcass;
  g.add(span(-wc / 2, -wc / 2 + pt, yB, yT, zBack, zc, m), span(wc / 2 - pt, wc / 2, yB, yT, zBack, zc, m),
    span(-wc / 2 + pt, wc / 2 - pt, yB, yB + pt, zBack, zc, m), span(-wc / 2 + pt, wc / 2 - pt, yB + pt, yT, zBack, zBack + BACK, m));
  const zTop = fronts ? zFace + o.ov : d / 2;
  if (o.topKind === 'glass') {
    g.add(span(-w / 2, w / 2, yT, h - 0.006, zBack, zTop, m));
    const sheet = span(-w / 2, w / 2, h - 0.006, h, zBack, zTop, o.topMat);
    sheet.userData.noShadow = true; g.add(sheet);
  } else g.add(span(-w / 2, w / 2, yT, h, zBack, zTop, o.topMat));
  if (o.legH > 0) g.add(cabinetLegs(o, wc, zBack, zc));

  const darkHex = K.shade(o.bodyHex, -0.68), dark = K.mat(darkHex, { roughness: 0.9 });
  const hb = new Batch(), done = new Set();
  const once = (k, make) => { if (!done.has(k)) { done.add(k); g.add(make()); } };
  const zi0 = zBack + BACK, zi1 = zc;
  for (const c of cells) {
    const x0 = -wc / 2 + c.x0, x1 = -wc / 2 + c.x1, y0 = yB + c.y0, y1 = yB + c.y1;
    const seeThrough = c.kind === 'open' || (o.glass && c.kind === 'door');
    if (seeThrough) {   // visible interior: partitions around the cell and shelves inside it
      if (c.x0 > 0.001) once(`v${r3(x0)}|${r3(y0)}|${r3(y1)}`, () => span(x0 - pt / 2, x0 + pt / 2, y0, y1, zi0, zi1, m));
      if (c.x1 < wc - 0.001) once(`v${r3(x1)}|${r3(y0)}|${r3(y1)}`, () => span(x1 - pt / 2, x1 + pt / 2, y0, y1, zi0, zi1, m));
      if (c.y0 > 0.001) once(`h${r3(y0)}|${r3(x0)}|${r3(x1)}`, () => span(x0, x1, y0 - pt / 2, y0 + pt / 2, zi0, zi1 - 0.002, m));
      if (c.y1 < yT - yB - 0.001) once(`h${r3(y1)}|${r3(x0)}|${r3(x1)}`, () => span(x0, x1, y1 - pt / 2, y1 + pt / 2, zi0, zi1 - 0.002, m));
      const n = Math.round((y1 - y0) / 0.34) - 1;
      for (let i = 1; i <= n; i++) { const y = y0 + ((y1 - y0) * i) / (n + 1); g.add(span(x0 + pt / 2, x1 - pt / 2, y - pt / 2, y + pt / 2, zi0, zi1 - 0.012, m)); }
    }
    if (c.kind === 'open') continue;
    const f = { x0: x0 + GAP / 2, x1: x1 - GAP / 2, y0: y0 + GAP / 2, y1: y1 - GAP / 2, hinge: c.hinge };
    if (seeThrough) framedFront(g, f.x0, f.x1, f.y0, f.y1, zFace - tf, zFace, o.body, K.glass());
    else {
      g.add(span(x0, x1, y0, y1, zc, zc + GAP - 0.001, dark));
      if (o.cane) framedFront(g, f.x0, f.x1, f.y0, f.y1, zFace - tf, zFace, o.body, caneMat());
      else g.add(span(f.x0, f.x1, f.y0, f.y1, zFace - tf, zFace, o.body));
    }
    addHandle(hb, c.kind, o.handles, hp, o.handleHex, darkHex, f, zFace);
  }
  hb.into(g, o.handles === 'cutout' ? batchMat(0.9) : batchMat(0.35, 0.8));
  return g;
}

function drawCabinet(ctx, { w, d, h, p, px }) {
  const o = cabinetOptions(w / 100, d / 100, h / 100, p);
  const cells = layoutCabinet(w / 100 - 2 * o.ov, h / 100 - o.tt - o.legH, o);
  const fronts = cells.some((c) => c.kind !== 'open');
  const hp = fronts ? o.hp * 100 : 0, ft = Math.min(2, d * 0.14), yf = d / 2 - hp;
  rect2(ctx, -w / 2, -d / 2, w / 2, yf, K.tint(o.topKind ? hex(p.topColor, MAT_DEFAULT[o.topKind] || o.bodyHex) : o.bodyHex, 0.55), K.INK, px);
  if (d / px < 12) return;
  if (fronts) rect2(ctx, -w / 2, yf - ft, w / 2, yf, K.tint(o.bodyHex, 0.3), K.INK, px * 0.8);
  else K.line(ctx, -w / 2, yf - ft, w / 2, yf - ft, K.INK_SOFT, px);
  if (w / px > 36) {
    K.line(ctx, -w / 2 + 1.8, -d / 2, -w / 2 + 1.8, yf - ft, K.INK_SOFT, px * 0.8);
    K.line(ctx, w / 2 - 1.8, -d / 2, w / 2 - 1.8, yf - ft, K.INK_SOFT, px * 0.8);
    const base = cells.filter((c) => c.y0 < 0.002);
    for (const c of base) {
      const x1 = -w / 2 + o.ov * 100 + c.x1 * 100, x0 = -w / 2 + o.ov * 100 + c.x0 * 100;
      if (x1 < w / 2 - 1) K.line(ctx, x1, yf - ft, x1, yf, K.INK, px * 0.8);
      if (c.kind === 'open') { ctx.fillStyle = K.tint(o.bodyHex, 0.75); ctx.fillRect(x0 + 1.8, yf - ft - px, x1 - x0 - 3.6, ft + px); }
      if (hp && c.kind !== 'open' && d / px > 30) {
        const len = c.kind === 'door' ? 1 : Math.min(18, (x1 - x0) * 0.3);
        const xc = c.kind === 'door' ? (c.hinge === 'l' ? x1 - 4 : x0 + 4) : (x0 + x1) / 2;
        rect2(ctx, xc - len / 2, yf, xc + len / 2, d / 2, K.tint(o.handleHex, 0.2), K.INK, px * 0.6);
      }
    }
  }
}
register('cabinet', buildCabinet, drawCabinet);

// ═════════════════════════ WARDROBE ═════════════════════════
function mirrorSet(n, m) {
  const s = new Set();
  m = clamp(m, 0, n);
  if (!m) return s;
  if ((n - m) % 2 === 1 && m % 2 === 0) for (let i = 0; i < m / 2; i++) { s.add(i); s.add(n - 1 - i); }
  else { const a = Math.floor((n - m) / 2); for (let i = 0; i < m; i++) s.add(a + i); }
  return s;
}
function wardrobeOptions(w, d, h, p) {
  const sliding = flag(p.sliding), open = flag(p.open);
  let n = int(p.doors, 0, 0, 12) || (sliding ? clamp(Math.round(w / 0.9), 2, 5) : clamp(Math.round(w / 0.5), 1, 12));
  if (sliding) n = Math.max(2, n);
  const handles = oneOf(p.handles, ['bar', 'knob', 'none'], 'bar');
  const bodyHex = hex(p.color, (oneOf(p.material, MATERIALS, null) && MAT_DEFAULT[p.material]) || '#f1eee8');
  const drawers = int(p.drawers, 0, 0, 12);
  const perRow = Math.min(drawers, Math.max(1, Math.ceil(n / 2)));
  const rows = drawers ? Math.ceil(drawers / perRow) : 0;
  return { sliding, open, n, handles, bodyHex, body: finish(p.material, p.color, '#f1eee8'), drawers, perRow, rows,
    hd: rows ? Math.min(0.2, (h * 0.4) / rows) : 0, mirrors: mirrorSet(n, p.mirror === true ? n : int(p.mirror, 0, 0, n)),
    hp: sliding || handles === 'none' ? 0 : handles === 'bar' ? 0.03 : 0.026,
    handleHex: hex(p.color3, hsl(bodyHex).l < 0.3 ? '#c2a15c' : '#2e3033'), metalHex: hex(p.color2, '#b4b6b8'), bays: clamp(Math.round((w - T) / 0.9), 1, 6) };
}

function openWardrobe(g, w, d, h, o, rnd) {
  const m = o.body, zB = -d / 2, zF = d / 2, base = Math.min(0.07, h * 0.08);
  g.add(span(-w / 2, -w / 2 + T, 0, h, zB, zF, m), span(w / 2 - T, w / 2, 0, h, zB, zF, m), span(-w / 2 + T, w / 2 - T, h - T, h, zB, zF, m),
    span(-w / 2 + T, w / 2 - T, base, base + T, zB, zF, m), span(-w / 2 + T, w / 2 - T, 0, base, zB + 0.02, zF - 0.035, m),
    span(-w / 2 + T, w / 2 - T, base + T, h - T, zB, zB + BACK, m));
  const nb = o.bays, pitch = (w - T) / nb, yLo = base + T, yHi = h - T, tall = yHi - yLo > 1.5;
  const cloth = new Batch(), rail = K.metal(o.metalHex, { roughness: 0.3 });
  const zc = (zB + BACK + zF) / 2, sw = Math.min(0.44, d - BACK - 0.05), depth = Math.min(0.34, d - 0.1);
  const darkHex = K.shade(o.bodyHex, -0.68);
  for (let i = 0; i < nb; i++) {
    const x0 = -w / 2 + T + i * pitch, x1 = x0 + pitch - T, bw = x1 - x0, cx = (x0 + x1) / 2;
    if (i > 0) g.add(span(x0 - T, x0, yLo, yHi, zB + BACK, zF - 0.002, m));
    const kind = ['hang', 'shelves', 'short'][i % 3];
    if (kind === 'shelves') {
      const n = Math.max(2, Math.round((yHi - yLo) / 0.35)), ph = (yHi - yLo) / n;
      for (let j = 0; j < n; j++) {
        const y = yLo + j * ph;
        if (j > 0) g.add(span(x0, x1, y - T / 2, y + T / 2, zB + BACK, zF - 0.012, m));
        const yb = j > 0 ? y + T / 2 : y, r = rnd();
        if (r < 0.14) continue;
        const k = Math.max(1, Math.floor(bw / 0.32));
        for (let s = 0; s < k; s++) {
          const sx = x0 + (bw * (s + 0.5)) / k;
          if (rnd() < 0.72) foldedStack(cloth, rnd, sx, yb, zF - 0.05 - depth / 2, Math.min(0.26, bw / k - 0.04), depth, ph - 0.07);
          else cloth.box(Math.min(0.3, bw / k - 0.03), Math.min(0.2, ph - 0.08), depth, pickFrom(rnd, ['#d9d2c5', '#b7b0a4', '#9da3a6', '#c9b59b']), sx, yb + Math.min(0.2, ph - 0.08) / 2, zF - 0.05 - depth / 2);
        }
      }
      continue;
    }
    const shelfY = tall ? yHi - 0.34 : yHi;
    if (tall) {
      g.add(span(x0, x1, shelfY - T, shelfY, zB + BACK, zF - 0.012, m));
      const k = Math.max(1, Math.floor(bw / 0.4));
      for (let s = 0; s < k; s++) cloth.box(Math.min(0.34, bw / k - 0.04), 0.2, depth, pickFrom(rnd, ['#d9d2c5', '#b7b0a4', '#9da3a6', '#c9b59b']), x0 + (bw * (s + 0.5)) / k, shelfY + 0.1, zF - 0.05 - depth / 2);
    }
    const yRail = shelfY - (tall ? T : 0) - 0.06;
    g.add(tubeX(0.012, bw, rail, cx, yRail, zc));
    let floorY = yLo;
    if (kind === 'short' && yRail - yLo > 1.1) {   // drawers below the short-hanging bay
      const nd = 2, hd = 0.2;
      for (let j = 0; j < nd; j++) {
        g.add(span(x0 + 0.002, x1 - 0.002, yLo + j * hd + 0.002, yLo + (j + 1) * hd - 0.002, zF - 0.02 - T, zF - 0.02, m));
        cloth.box(clamp(bw * 0.25, 0.06, 0.16), 0.02, 0.002, darkHex, cx, yLo + (j + 1) * hd - 0.014, zF - 0.02);
      }
      g.add(span(x0, x1, yLo + nd * hd, yLo + nd * hd + T, zB + BACK, zF - 0.012, m));
      floorY = yLo + nd * hd + T;
      foldedStack(cloth, rnd, cx - bw * 0.2, floorY, zF - 0.05 - depth / 2, Math.min(0.26, bw * 0.4), depth, 0.14);
    }
    const room = yRail - 0.075 - floorY - 0.04;
    const count = Math.min(11, Math.floor((bw - 0.06) / 0.062));
    for (let j = 0; j < count; j++) {
      if (rnd() < 0.14) continue;
      const len = Math.min(room, kind === 'short' ? 0.55 + rnd() * 0.22 : 0.8 + rnd() * 0.5);
      if (len < 0.2) break;
      garment(cloth, { x: x0 + 0.05 + ((bw - 0.1) * (j + 0.5)) / count, y: yRail - 0.062, z: zc, sw: sw * (0.9 + rnd() * 0.1), len, t: 0.03 + rnd() * 0.02, color: pickFrom(rnd, MUTED), flare: 0.86 + rnd() * 0.2 });
    }
    if (kind === 'hang' && room > 1.2) for (let s = 0; s < Math.min(3, Math.floor(bw / 0.26)); s++) shoePair(cloth, rnd, x0 + 0.14 + s * 0.26, yLo, zF - 0.06 - Math.min(0.27, d - 0.1) / 2, Math.min(0.27, d - 0.1), pickFrom(rnd, ['#3f4650', '#a0725b', '#ece7de', '#7d6f63']));
  }
  cloth.into(g, batchMat(0.9));
}

function buildWardrobe({ w, d, h, p, item }) {
  const g = new THREE.Group();
  const o = wardrobeOptions(w, d, h, p);
  if (o.open) { openWardrobe(g, w, d, h, o, seeded(item, 'wardrobe')); return g; }
  const m = o.body, zB = -d / 2, darkHex = K.shade(o.bodyHex, -0.68), dark = K.mat(darkHex, { roughness: 0.9 });
  const hb = new Batch();
  const mirror = K.mirrorMat();
  const zone = o.rows * o.hd;
  if (o.sliding) {
    const base = Math.min(0.06, h * 0.1), alu = K.metal(o.metalHex, { roughness: 0.35, metalness: 0.8 });
    g.add(span(-w / 2, -w / 2 + T, 0, h, zB, d / 2, m), span(w / 2 - T, w / 2, 0, h, zB, d / 2, m), span(-w / 2 + T, w / 2 - T, h - T, h, zB, d / 2, m),
      span(-w / 2 + T, w / 2 - T, 0, base, zB, d / 2 - 0.002, m), span(-w / 2 + T, w / 2 - T, base, h - T, zB, zB + BACK, m));
    const x0 = -w / 2 + T, x1 = w / 2 - T, y0 = base + zone, y1 = h - T, zt = Math.max(zB + 0.01, d / 2 - 0.078);
    g.add(span(x0, x1, y1 - 0.03, y1, zt, d / 2 - 0.004, alu), span(x0, x1, y0, y0 + 0.006, zt, d / 2 - 0.004, alu));
    const ovl = 0.026, pw = (x1 - x0 + (o.n - 1) * ovl) / o.n, sw = o.handles === 'none' ? 0.012 : 0.024;
    for (let i = 0; i < o.n; i++) {
      const a = x0 + i * (pw - ovl), b = a + pw, zf = i % 2 === 1 ? d / 2 - 0.006 : d / 2 - 0.038;
      g.add(span(a + sw, b - sw, y0 + 0.008, y1 - 0.012, zf - 0.02, zf - 0.004, o.mirrors.has(i) ? mirror : m));
      const sm = o.handles === 'none' ? m : alu;
      g.add(span(a, a + sw, y0 + 0.008, y1 - 0.012, zf - 0.024, zf, sm), span(b - sw, b, y0 + 0.008, y1 - 0.012, zf - 0.024, zf, sm));
    }
    for (let r = 0; r < o.rows; r++) for (let i = 0; i < o.perRow; i++) {
      const a = x0 + ((x1 - x0) * i) / o.perRow, b = x0 + ((x1 - x0) * (i + 1)) / o.perRow, ya = base + r * o.hd, yb = ya + o.hd;
      g.add(span(a + GAP / 2, b - GAP / 2, ya + GAP / 2, yb - GAP / 2, d / 2 - 0.022, d / 2 - 0.004, m));
      hb.box(clamp((b - a) * 0.2, 0.06, 0.16), 0.02, 0.002, darkHex, (a + b) / 2, yb - 0.013, d / 2 - 0.004);
    }
    if (o.rows) g.add(span(x0, x1, base, base + zone, d / 2 - 0.03, d / 2 - 0.024, dark));
    hb.into(g, batchMat(0.9));
    return g;
  }
  const pl = h > 1.2 ? 0.07 : Math.min(0.05, h * 0.1), zFace = d / 2 - o.hp, zc = zFace - T - GAP;
  g.add(span(-w / 2, -w / 2 + T, 0, h, zB, zc, m), span(w / 2 - T, w / 2, 0, h, zB, zc, m), span(-w / 2 + T, w / 2 - T, h - T, h, zB, zc, m),
    span(-w / 2 + T, w / 2 - T, pl, pl + T, zB, zc, m), span(-w / 2 + T, w / 2 - T, 0, pl, zB + 0.02, zc - 0.03, m),
    span(-w / 2 + T, w / 2 - T, pl + T, h - T, zB, zB + BACK, m), span(-w / 2 + 0.001, w / 2 - 0.001, pl, h - 0.001, zc, zc + GAP - 0.001, dark));
  for (let r = 0; r < o.rows; r++) for (let i = 0; i < o.perRow; i++) {
    const f = { x0: -w / 2 + (w * i) / o.perRow + GAP / 2, x1: -w / 2 + (w * (i + 1)) / o.perRow - GAP / 2, y0: pl + r * o.hd + GAP / 2, y1: pl + (r + 1) * o.hd - GAP / 2 };
    g.add(span(f.x0, f.x1, f.y0, f.y1, zFace - T, zFace, m));
    addHandle(hb, 'drawer', o.handles, o.hp, o.handleHex, darkHex, f, zFace);
  }
  for (let i = 0; i < o.n; i++) {
    const hinge = o.n === 1 ? 'l' : i % 2 === 1 || (o.n % 2 === 1 && i === o.n - 1) ? 'r' : 'l';
    const f = { x0: -w / 2 + (w * i) / o.n + GAP / 2, x1: -w / 2 + (w * (i + 1)) / o.n - GAP / 2, y0: pl + zone + GAP / 2, y1: h - 0.002, hinge };
    if (o.mirrors.has(i)) g.add(span(f.x0, f.x1, f.y0, f.y1, zFace - T, zFace - 0.004, m), span(f.x0 + 0.002, f.x1 - 0.002, f.y0 + 0.002, f.y1 - 0.002, zFace - 0.004, zFace, mirror));
    else g.add(span(f.x0, f.x1, f.y0, f.y1, zFace - T, zFace, m));
    addHandle(hb, 'door', o.handles, o.hp, o.handleHex, darkHex, f, zFace);
  }
  hb.into(g, batchMat(0.35, 0.8));
  return g;
}

function drawWardrobe(ctx, { w, d, h, p, px }) {
  const o = wardrobeOptions(w / 100, d / 100, h / 100, p);
  const hp = o.hp * 100, yf = d / 2 - hp, ft = o.sliding ? Math.min(7, d * 0.2) : Math.min(2, d * 0.1);
  rect2(ctx, -w / 2, -d / 2, w / 2, yf, K.tint(o.bodyHex, 0.6), K.INK, px);
  const small = w / px < 40 || d / px < 14;
  if (!small) {
    K.line(ctx, -w / 2 + 1.8, -d / 2, -w / 2 + 1.8, yf - ft, K.INK_SOFT, px * 0.8);
    K.line(ctx, w / 2 - 1.8, -d / 2, w / 2 - 1.8, yf - ft, K.INK_SOFT, px * 0.8);
    K.line(ctx, -w / 2 + 1.8, -d / 2 + 0.8, w / 2 - 1.8, -d / 2 + 0.8, K.INK_SOFT, px * 0.8);
    // hanging rail with hangers
    const yr = -hp / 2 - ft / 2, x0 = -w / 2 + 4, x1 = w / 2 - 4, hl = Math.min(22, d * 0.36);
    const hang = (a, b) => {
      dashed(ctx, [Math.max(9, 5 * px), Math.max(3, 2 * px), Math.max(1.5, px), Math.max(3, 2 * px)], () => K.line(ctx, a, yr, b, yr, K.INK, px));
      if (w / px > 90) { const n = Math.floor((b - a) / 7); for (let i = 0; i < n; i++) { const x = a + 3.5 + i * 7, s = (i % 3) - 1; K.line(ctx, x - s * 1.6, yr - hl, x + s * 1.6, yr + hl, K.INK_SOFT, px * 0.8); } }
    };
    if (o.open) {
      for (let i = 0; i < o.bays; i++) {
        const a = -w / 2 + 1.8 + (i * (w - 1.8)) / o.bays, b = a + (w - 1.8) / o.bays - 1.8;
        if (i > 0) K.line(ctx, a - 0.9, -d / 2, a - 0.9, yf, K.INK, px * 0.8);
        if (i % 3 === 1) for (let k = 1; k <= 2; k++) K.line(ctx, a + 2, -d / 2 + (d * k) / 3, b - 2, -d / 2 + (d * k) / 3, K.INK_SOFT, px * 0.8);
        else hang(a + 3, b - 3);
      }
    } else hang(x0, x1);
  }
  if (o.open) return;
  if (o.sliding) {
    const x0 = -w / 2 + 1.8, x1 = w / 2 - 1.8, ovl = 2.6, pw = (x1 - x0 + (o.n - 1) * ovl) / o.n;
    K.line(ctx, x0, yf - ft, x1, yf - ft, K.INK_SOFT, px * 0.8);
    for (let i = 0; i < o.n; i++) {
      const a = x0 + i * (pw - ovl), front = i % 2 === 1, y1 = front ? yf - 0.6 : yf - ft / 2 - 0.3;
      rect2(ctx, a, y1 - Math.max(2, ft / 2 - 1.2), a + pw, y1, o.mirrors.has(i) ? '#dfe9ee' : K.tint(o.bodyHex, 0.25), K.INK, px * 0.9);
    }
    return;
  }
  rect2(ctx, -w / 2, yf - ft, w / 2, yf, K.tint(o.bodyHex, 0.3), K.INK, px * 0.8);
  if (small) return;
  for (let i = 0; i < o.n; i++) {
    const a = -w / 2 + (w * i) / o.n, b = a + w / o.n, L = b - a;
    const left = o.n === 1 ? true : !(i % 2 === 1 || (o.n % 2 === 1 && i === o.n - 1));
    if (i > 0) K.line(ctx, a, yf - ft, a, yf, K.INK, px * 0.8);
    if (o.mirrors.has(i)) { ctx.fillStyle = '#cfe0e8'; ctx.fillRect(a + 1, yf - ft * 0.55, L - 2, ft * 0.5); }
    // door-leaf swing hint
    const hx = left ? a : b, s = left ? 1 : -1, ang = 0.5;
    const ex = hx + s * L * Math.cos(ang), ey = yf + L * Math.sin(ang);
    ctx.beginPath(); ctx.arc(hx, yf, L, left ? 0 : Math.PI - ang, left ? ang : Math.PI);
    ctx.strokeStyle = K.INK_SOFT; ctx.lineWidth = px * 0.8; ctx.stroke();
    K.line(ctx, hx, yf, ex, ey, K.INK_SOFT, px * 1.4);
  }
}
register('wardrobe', buildWardrobe, drawWardrobe);

// ═════════════════════════ BOOKCASE ═════════════════════════
/** Decorates shelf compartments with books and a few objects (all merged into the batch). */
function fillShelves(batch, comps, rnd) {
  let books = 170;
  const vase = (x, y, z, hMax) => {
    const r = 0.03 + rnd() * 0.02, hh = Math.min(hMax, 0.1 + rnd() * 0.12), c = pickFrom(rnd, CERAMICS);
    batch.cyl(r, hh * 0.7, c, x, y + hh * 0.35, z, {}, 0.75, 12).cyl(r * 0.5, hh * 0.3, c, x, y + hh * 0.85, z, {}, 0.8, 12);
  };
  for (const c of comps) {
    const cw = c.x1 - c.x0, ch = c.y1 - c.y0, cd = c.z1 - c.z0;
    if (cw < 0.12 || ch < 0.1 || cd < 0.09) continue;
    const r = rnd(), zf = c.z1 - 0.018;
    if (r < 0.1) continue;
    if (c.bin && r < 0.36) {
      const col = pickFrom(rnd, ['#d9d0c1', '#b9b2a6', '#8f9aa0', '#c5ae93']);
      batch.span(c.x0 + 0.01, c.x1 - 0.01, c.y0, c.y1 - 0.025, c.z0 + 0.01, c.z1 - 0.012, col);
      batch.box(0.09, 0.022, 0.002, K.shade(col, -0.5), (c.x0 + c.x1) / 2, c.y1 - 0.07, c.z1 - 0.011);
    } else if (r < 0.66 && ch >= 0.2) {
      const side = rnd() < 0.5 ? 1 : -1, run = cw * (0.45 + 0.5 * rnd()), base = Math.min(ch - 0.03, 0.2 + rnd() * 0.06);
      let x = 0.006;
      while (x < run && books > 0) {
        const t = 0.014 + rnd() * 0.03, bh = clamp(base * (0.8 + rnd() * 0.22), 0.08, ch - 0.015), bd = Math.min(cd - 0.03, 0.12 + rnd() * 0.06);
        if (x + t > cw - 0.006) break;
        batch.box(t, bh, bd, pickFrom(rnd, BOOKS), side > 0 ? c.x0 + x + t / 2 : c.x1 - x - t / 2, c.y0 + bh / 2, zf - bd / 2 - rnd() * 0.012);
        x += t + 0.0008; books--;
      }
      if (rnd() < 0.55 && cw - x > 0.1) {   // one book leaning against the row
        const a = 0.22, t = 0.022, bh = Math.min(base * 0.95, ch - 0.03), off = x + t / 2 + Math.sin(a) * bh / 2 + 0.004;
        batch.box(t, bh, Math.min(cd - 0.03, 0.15), pickFrom(rnd, BOOKS), side > 0 ? c.x0 + off : c.x1 - off, c.y0 + (Math.cos(a) * bh) / 2 + (Math.sin(a) * t) / 2, zf - 0.08, { rz: side * a });
        x = off + 0.06;
      }
      if (cw - x > 0.16 && rnd() < 0.6) vase(side > 0 ? c.x1 - 0.07 : c.x0 + 0.07, c.y0, zf - 0.07, ch - 0.04);
    } else if (r < 0.84) {
      const sx = c.x0 + cw * (0.3 + rnd() * 0.15);
      let top = c.y0;
      for (let i = 0, n = 2 + Math.floor(rnd() * 3); i < n && books > 0 && top + 0.04 < c.y1 - 0.02; i++, books--) {
        const t = 0.018 + rnd() * 0.02;
        batch.box(Math.min(cw - 0.03, 0.19 + rnd() * 0.05), t, Math.min(cd - 0.035, 0.14 + rnd() * 0.03), pickFrom(rnd, BOOKS), sx, top + t / 2, zf - 0.09, { ry: (rnd() - 0.5) * 0.12 });
        top += t;
      }
      if (cw > 0.36) vase(c.x1 - 0.09, c.y0, zf - 0.07, ch - 0.04);
    } else if (r < 0.92 || ch < 0.2) vase(c.x0 + cw * (0.35 + rnd() * 0.3), c.y0, zf - 0.07, ch - 0.04);
    else {   // potted plant
      const x = c.x0 + cw * (0.35 + rnd() * 0.3), ph = Math.min(0.09, ch * 0.3), fr = Math.min(0.075, (ch - ph) * 0.45, cd * 0.3);
      batch.cyl(0.045, ph, pickFrom(rnd, CERAMICS), x, c.y0 + ph / 2, zf - 0.07, {}, 1.2, 12);
      batch.add(_ico, '#6f8a66', x, c.y0 + ph + fr * 0.8, zf - 0.07, { sx: fr, sy: fr, sz: fr, ry: rnd() * 3 });
    }
  }
}
const _ico = new THREE.IcosahedronGeometry(1, 1);

function bookcaseOptions(w, d, h, p) {
  const frame = oneOf(p.frame, ['panel', 'metal', 'ladder', 'cube'], p.style === 'industrial' ? 'metal' : 'panel');
  const cube = frame === 'cube';
  const pl = frame === 'panel' && h > 1 ? 0.06 : 0;
  return { frame, cube, pl, bodyHex: hex(p.color, frame === 'metal' ? '#c8a476' : '#dcc199'), body: finish(p.material === 'metal' ? 'wood' : p.material, p.color, frame === 'metal' ? '#c8a476' : '#dcc199'),
    cols: int(p.columns, 0, 1, 12) || (frame === 'ladder' ? (w > 1.3 ? 2 : 1) : Math.max(1, Math.round(w / (cube ? 0.38 : 0.8)))),
    levels: int(p.shelves, 0, 1, 16) || clamp(Math.round((h - pl) / (cube ? 0.38 : frame === 'ladder' ? 0.42 : 0.35)), 1, 12),
    back: flag(p.back, frame === 'panel'), doors: frame === 'panel' || cube ? int(p.doors, 0, 0, 8) : 0, filled: flag(p.filled), frameHex: hex(p.color2, '#26282b') };
}

function buildBookcase({ w, d, h, p, item }) {
  const g = new THREE.Group();
  const o = bookcaseOptions(w, d, h, p), m = o.body, zB = -d / 2;
  const comps = [];
  if (o.frame === 'metal') {
    const tube = Math.min(0.02, w * 0.1), tb = 0.025, y0 = Math.min(0.1, h * 0.08), pitch = (h - tb - y0) / o.levels, fb = new Batch();
    const xs = range(o.cols + 1).map((i) => -w / 2 + tube / 2 + (i * (w - tube)) / o.cols);
    for (const x of xs) for (const z of [zB + tube / 2, d / 2 - tube / 2]) fb.box(tube, h, tube, o.frameHex, x, h / 2, z);
    for (let j = 0; j <= o.levels; j++) {
      const yb = y0 + j * pitch;
      g.add(span(-w / 2 + 0.003, w / 2 - 0.003, yb, yb + tb, zB + 0.003, d / 2 - 0.003, m));
      for (const x of xs) fb.box(tube, tube, d - 2 * tube, o.frameHex, x, yb - tube / 2, 0);
      if (j < o.levels) for (let i = 0; i < o.cols; i++) comps.push({ x0: xs[i] + tube / 2 + 0.005, x1: xs[i + 1] - tube / 2 - 0.005, y0: yb + tb, y1: yb + pitch - tube, z0: zB + 0.01, z1: d / 2 - 0.004 });
    }
    if (o.back) fb.span(-w / 2 + tube, w / 2 - tube, y0, h - tb, zB + 0.002, zB + 0.006, o.frameHex);
    fb.into(g, batchMat(0.45, 0.6));
  } else if (o.frame === 'ladder') {
    const rw = 0.03, tz = Math.min(0.045, d * 0.25), yA = Math.min(0.16, h * 0.12), yZ = h - Math.min(0.26, h * 0.16);
    const zAt = (y) => d / 2 - ((d - tz) * y) / h;   // front face of the leaning rails at height y
    const xs = range(o.cols + 1).map((i) => -w / 2 + (i * (w - rw)) / o.cols);
    for (const x of xs) g.add(prismZY([[d / 2, 0], [d / 2 - tz, 0], [zB, h], [zB + tz, h]], x, x + rw, m));
    for (let j = 0; j < o.levels; j++) {
      const y = o.levels === 1 ? yA : yA + ((yZ - yA) * j) / (o.levels - 1), zf = zAt(y + 0.02);
      g.add(span(-w / 2 + rw, w / 2 - rw, y, y + 0.02, zB, zf, m), span(-w / 2 + rw, w / 2 - rw, y + 0.02, y + 0.055, zB, zB + 0.012, m));
      const yN = j < o.levels - 1 ? yA + ((yZ - yA) * (j + 1)) / (o.levels - 1) : h;
      for (let i = 0; i < o.cols; i++) comps.push({ x0: xs[i] + rw + 0.01, x1: xs[i + 1] - 0.01, y0: y + 0.02, y1: Math.min(yN - 0.01, y + 0.5), z0: zB + 0.012, z1: Math.min(zf, zAt(Math.min(yN, y + 0.3))) + 0.01 });
    }
  } else {
    const to = o.cube ? Math.min(0.036, w * 0.2) : Math.min(T, w * 0.2), ti = o.cube ? 0.016 : T;
    const zc = o.doors ? d / 2 - T - GAP : d / 2, pl = o.pl;
    g.add(span(-w / 2, -w / 2 + to, 0, h, zB, zc, m), span(w / 2 - to, w / 2, 0, h, zB, zc, m), span(-w / 2 + to, w / 2 - to, h - to, h, zB, zc, m),
      span(-w / 2 + to, w / 2 - to, pl, pl + to, zB, zc, m));
    if (pl) g.add(span(-w / 2 + to, w / 2 - to, 0, pl, zB + 0.01, zc - 0.03, m));
    if (o.back) g.add(span(-w / 2 + to, w / 2 - to, pl + to, h - to, zB, zB + BACK, m));
    const xi = -w / 2 + to, yi = pl + to, zi = zB + (o.back ? BACK : 0);
    const bw = (w - 2 * to - (o.cols - 1) * ti) / o.cols, lh = (h - pl - 2 * to - (o.levels - 1) * ti) / o.levels;
    for (let i = 1; i < o.cols; i++) { const x = xi + i * bw + (i - 1) * ti; g.add(span(x, x + ti, yi, h - to, zi, zc - 0.001, m)); }
    for (let j = 1; j < o.levels; j++) { const y = yi + j * lh + (j - 1) * ti; g.add(span(xi, w / 2 - to, y, y + ti, zi, zc - 0.003, m)); }
    const k = o.doors ? (o.levels === 1 ? 1 : clamp(Math.round(0.75 / (lh + ti)), 1, o.levels - 1)) : 0;
    for (let i = 0; i < o.cols; i++) for (let j = k; j < o.levels; j++) {
      const x0 = xi + i * (bw + ti), y0 = yi + j * (lh + ti);
      comps.push({ x0: x0 + 0.004, x1: x0 + bw - 0.004, y0, y1: y0 + lh, z0: zi, z1: zc - 0.003, bin: o.cube });
    }
    if (o.doors) {
      const yd = k === o.levels ? h : yi + k * (lh + ti) - ti / 2, darkHex = K.shade(o.bodyHex, -0.68), hb = new Batch();
      g.add(span(-w / 2 + 0.001, w / 2 - 0.001, pl, yd, zc, zc + GAP - 0.001, K.mat(darkHex, { roughness: 0.9 })));
      for (let i = 0; i < o.doors; i++) {
        const hinge = o.doors === 1 ? 'l' : i % 2 === 1 || (o.doors % 2 === 1 && i === o.doors - 1) ? 'r' : 'l';
        const f = { x0: -w / 2 + (w * i) / o.doors + GAP / 2, x1: -w / 2 + (w * (i + 1)) / o.doors - GAP / 2, y0: pl + GAP / 2, y1: yd - GAP / 2, hinge };
        g.add(span(f.x0, f.x1, f.y0, f.y1, d / 2 - T, d / 2, m));
        addHandle(hb, 'door', 'cutout', 0, '', darkHex, f, d / 2);
      }
      hb.into(g, batchMat(0.9));
    }
  }
  if (o.filled) { const fill = new Batch(); fillShelves(fill, comps, seeded(item, 'bookcase')); fill.into(g, batchMat(0.8)); }
  return g;
}

function drawBookcase(ctx, { w, d, h, p, px, item }) {
  const o = bookcaseOptions(w / 100, d / 100, h / 100, p);
  rect2(ctx, -w / 2, -d / 2, w / 2, d / 2, K.tint(o.bodyHex, 0.6), K.INK, px);
  if (w / px < 30 || d / px < 10) return;
  const t = o.frame === 'metal' ? 2 : o.cube ? 3.6 : 1.8;
  if (o.frame === 'metal') {
    for (let i = 0; i <= o.cols; i++) for (const y of [-d / 2, d / 2 - t]) { const x = -w / 2 + (i * (w - t)) / o.cols; rect2(ctx, x, y, x + t, y + t, K.tint(o.frameHex, 0.25), K.INK, px * 0.7); }
  } else {
    if (o.back) K.line(ctx, -w / 2 + t, -d / 2 + 0.9, w / 2 - t, -d / 2 + 0.9, K.INK_SOFT, px * 0.8);
    for (let i = 0; i <= o.cols; i++) {
      const x = -w / 2 + t / 2 + (i * (w - t)) / o.cols;
      if (i > 0) K.line(ctx, x - t / 2, -d / 2, x - t / 2, d / 2, i < o.cols ? K.INK : K.INK_SOFT, px * 0.8);
      if (i < o.cols) K.line(ctx, x + t / 2, -d / 2, x + t / 2, d / 2, i > 0 ? K.INK : K.INK_SOFT, px * 0.8);
    }
  }
  if (o.doors) rect2(ctx, -w / 2, d / 2 - 2, w / 2, d / 2, K.tint(o.bodyHex, 0.3), K.INK, px * 0.8);
  if (o.filled && w / px > 70) {   // book spines seen from above
    const rnd = seeded(item, 'bookcase'), y1 = d / 2 - (o.doors ? 4 : 2);
    for (let i = 0; i < o.cols; i++) {
      const a = -w / 2 + t + 1 + (i * (w - t)) / o.cols, b = a + (w - t) / o.cols - t - 2;
      for (let x = a; x < a + (b - a) * (0.5 + rnd() * 0.45);) {
        const bt = 1.6 + rnd() * 3, bd = Math.min(d - 5, 12 + rnd() * 6);
        if (x + bt > b) break;
        rect2(ctx, x, y1 - bd, x + bt, y1, K.tint(pickFrom(rnd, BOOKS), 0.5), K.INK_SOFT, px * 0.6);
        x += bt;
      }
    }
  }
}
register('bookcase', buildBookcase, drawBookcase);

// ═════════════════════════ WALL SHELF ═════════════════════════
function shelfOptions(w, d, h, p) {
  let variant = oneOf(p.variant, ['floating', 'bracket', 'box', 'pegboard'], 'floating');
  if (variant === 'floating' && flag(p.brackets)) variant = 'bracket';
  const single = h <= 0.085;
  const n = int(p.shelves, 0, 1, 12) || (variant === 'box' ? Math.max(1, Math.round(h / 0.32)) : single ? 1 : Math.max(2, Math.round(h / 0.34) + 1));
  return { variant, n: variant === 'floating' && !single ? Math.max(2, n) : n, single, bodyHex: hex(p.color, variant === 'pegboard' ? '#e6d5b8' : '#c8a476'),
    body: finish(p.material, p.color, variant === 'pegboard' ? '#e6d5b8' : '#c8a476'), metalHex: hex(p.color2, '#26282b') };
}

function buildShelf({ w, d, h, p, item }) {
  const g = new THREE.Group();
  const o = shelfOptions(w, d, h, p), m = o.body, zB = -d / 2, zF = d / 2;
  if (o.variant === 'floating') {
    const t = o.single ? h : clamp(h * 0.04, 0.022, 0.04);
    for (let i = 0; i < o.n; i++) { const y = o.n === 1 ? 0 : ((h - t) * i) / (o.n - 1); g.add(span(-w / 2, w / 2, y, y + t, zB, zF, m)); }
  } else if (o.variant === 'bracket') {
    const fb = new Batch(), n = o.n, pitch = h / n, t = Math.min(0.022, pitch * 0.45), rail = n > 1 || pitch - t > 0.24;
    const nb = w > 1.3 ? 3 : 2, inset = Math.min(0.14, w * 0.14), xs = range(nb).map((i) => -w / 2 + inset + (i * (w - 2 * inset)) / (nb - 1));
    for (let i = 0; i < n; i++) {
      const yt = h - i * pitch, yb = yt - t, bh = rail ? Math.min(0.14, pitch - t) : pitch - t;
      g.add(span(-w / 2, w / 2, yb, yt, zB + (rail ? 0.008 : 0), zF, m));
      for (const x of xs) {
        fb.box(0.022, 0.006, d * 0.82, o.metalHex, x, yb - 0.003, zB + d * 0.41);
        fb.box(0.022, bh, 0.006, o.metalHex, x, yb - bh / 2, zB + (rail ? 0.011 : 0.003));
        if (bh > 0.07) { const L = Math.min(bh, d * 0.7) * 0.8; fb.box(0.006, L * Math.SQRT2, 0.014, o.metalHex, x, yb - L / 2 - 0.004, zB + L / 2 + 0.006, { rx: -Math.PI / 4 }); }
      }
    }
    if (rail) for (const x of xs) fb.box(0.026, h, 0.008, o.metalHex, x, h / 2, zB + 0.004);
    fb.into(g, batchMat(0.45, 0.6));
  } else if (o.variant === 'box') {
    const t = Math.min(T, h * 0.25, w * 0.2), vertical = h / w > 1.2;
    g.add(span(-w / 2, -w / 2 + t, 0, h, zB, zF, m), span(w / 2 - t, w / 2, 0, h, zB, zF, m), span(-w / 2 + t, w / 2 - t, 0, t, zB, zF, m), span(-w / 2 + t, w / 2 - t, h - t, h, zB, zF, m));
    if (flag(p.back, true)) g.add(span(-w / 2 + t, w / 2 - t, t, h - t, zB, zB + BACK, m));
    const k = vertical ? o.n : int(p.shelves, 0, 1, 12) || Math.max(1, Math.round(w / Math.max(0.3, h)));
    for (let i = 1; i < k; i++) {
      if (vertical) { const y = (h * i) / k; g.add(span(-w / 2 + t, w / 2 - t, y - t / 2, y + t / 2, zB + BACK, zF - 0.002, m)); }
      else { const x = -w / 2 + (w * i) / k; g.add(span(x - t / 2, x + t / 2, t, h - t, zB + BACK, zF - 0.002, m)); }
    }
  } else {   // pegboard
    const rnd = seeded(item, 'shelf-wall'), bt = Math.min(0.012, d * 0.4), fb = new Batch(), darkHex = K.shade(o.bodyHex, -0.55);
    g.add(span(-w / 2, w / 2, 0, h, zB, zB + bt, m));
    const pitch = Math.max(0.04, Math.sqrt((w * h) / 160)), nx = Math.max(1, Math.floor((w - 0.04) / pitch)), ny = Math.max(1, Math.floor((h - 0.04) / pitch));
    const ox = -((nx - 1) * pitch) / 2, oy = h / 2 - ((ny - 1) * pitch) / 2, at = (i, j) => [ox + clamp(i, 0, nx - 1) * pitch, oy + clamp(j, 0, ny - 1) * pitch];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) fb.add(_hole, darkHex, ox + i * pitch, oy + j * pitch, zB + bt + 0.0005, { sx: pitch * 0.11, sy: pitch * 0.11 });
    const peg = (i, j, len = d - bt) => { const [x, y] = at(i, j); fb.cyl(0.006, len, '#d9c9a8', x, y, zB + bt + len / 2, { rx: Math.PI / 2 }); return [x, y]; };
    const rows = [Math.round(ny * 0.72), Math.round(ny * 0.3)];
    rows.forEach((j, s) => {   // small shelves resting on pegs
      const span0 = Math.max(2, Math.round(nx * (0.3 + rnd() * 0.15))), i0 = s ? nx - span0 - 1 : 1;
      const [xa, y] = peg(i0, j), [xb] = peg(i0 + span0, j);
      if (ny > 2) g.add(span(Math.min(xa, xb) - 0.03, Math.max(xa, xb) + 0.03, y + 0.006, y + 0.018, zB + bt, zF, m));
    });
    peg(s3(nx, 0.2), Math.round(ny * 0.5), Math.min(d - bt, 0.05)); peg(s3(nx, 0.82), Math.round(ny * 0.6), Math.min(d - bt, 0.05));
    fb.into(g, batchMat(0.8));
  }
  return g;
}
const s3 = (n, f) => Math.round((n - 1) * f);
const _hole = new THREE.CircleGeometry(1, 6);

function drawShelf(ctx, { w, d, h, p, px }) {
  const o = shelfOptions(w / 100, d / 100, h / 100, p);
  rect2(ctx, -w / 2, -d / 2, w / 2, d / 2, K.tint(o.bodyHex, 0.55), K.INK, px);
  K.line(ctx, -w / 2, -d / 2 + Math.min(1, d * 0.1), w / 2, -d / 2 + Math.min(1, d * 0.1), K.INK, px * 1.6);
  if (w / px < 30) return;
  if (o.variant === 'bracket') {
    const nb = w > 130 ? 3 : 2, inset = Math.min(14, w * 0.14);
    for (let i = 0; i < nb; i++) { const x = -w / 2 + inset + (i * (w - 2 * inset)) / (nb - 1); dashed(ctx, [2 * px, 2 * px], () => rect2(ctx, x - 1.1, -d / 2, x + 1.1, -d / 2 + d * 0.82, null, K.INK_SOFT, px)); }
  } else if (o.variant === 'box') {
    K.line(ctx, -w / 2 + 1.8, -d / 2, -w / 2 + 1.8, d / 2, K.INK_SOFT, px * 0.8); K.line(ctx, w / 2 - 1.8, -d / 2, w / 2 - 1.8, d / 2, K.INK_SOFT, px * 0.8);
  } else if (o.variant === 'pegboard') {
    const bt = Math.min(1.2, d * 0.4);
    K.line(ctx, -w / 2, -d / 2 + bt, w / 2, -d / 2 + bt, K.INK, px * 0.8);
    for (const f of [0.2, 0.82]) K.line(ctx, -w / 2 + w * f, -d / 2 + bt, -w / 2 + w * f, Math.min(d / 2, -d / 2 + bt + 5), K.INK, px * 1.4);
  }
}
register('shelf-wall', buildShelf, drawShelf);

// ═════════════════════════ BED ═════════════════════════
const BED_VARIANTS = ['standard', 'platform', 'daybed', 'sofa-bed', 'youth'];
const turned = (g) => { g.rotation.y = Math.PI / 2; return K.group(g); };

function bedOptions(w, d, h, p, variant) {
  const platform = variant === 'platform', youth = variant === 'youth';
  const hbKind = oneOf(p.headboard, ['upholstered', 'wood', 'metal', 'none', 'rattan'], platform || youth ? 'wood' : 'upholstered');
  const softMat = oneOf(p.material, SOFT, null);
  const soft = hbKind === 'upholstered' || (hbKind === 'none' && !!softMat);
  const metalFrame = hbKind === 'metal' || (hbKind === 'none' && (p.material === 'metal' || p.material === 'aluminium'));
  const frameHex = hex(p.color, soft ? '#b9afa2' : metalFrame ? '#2b2d31' : '#c8a476');
  const frame = soft ? K.byMaterial(softMat || 'fabric', frameHex) : metalFrame ? K.metal(frameHex) : finish(softMat ? null : p.material, p.color);
  const storage = flag(p.storage) && !metalFrame && !platform;
  const thb = Math.min({ upholstered: 0.09, wood: 0.035, rattan: 0.04, metal: 0.028, none: 0 }[hbKind], d * 0.15);
  const tr = soft ? 0.05 : metalFrame ? 0.025 : 0.03, ph = 0.13;
  let mh = num(p.mattressHeight, platform ? 20 : 22, 8, 45) / 100;
  const mTop = Math.max(0.06, hbKind === 'none' ? h - ph : Math.min(platform ? 0.42 : youth ? 0.48 : 0.56, h * 0.58));
  mh = Math.min(mh, mTop * 0.7);
  const mBot = mTop - mh, sink = platform || metalFrame ? 0 : Math.min(0.04, mh * 0.3), railTop = mBot + sink;
  const legs = storage ? 'plinth' : oneOf(p.legs, ['wood', 'metal', 'plinth', 'none'], platform ? 'plinth' : metalFrame ? 'metal' : 'wood');
  let legH = legs === 'none' ? 0 : storage ? 0.025 : platform ? mBot - 0.1 : metalFrame ? mBot - 0.045 : legs === 'plinth' ? 0.06 : soft ? 0.07 : clamp(railTop - 0.2, 0.05, 0.16);
  legH = clamp(legH, 0, Math.max(0, railTop - 0.06));
  const edge = platform ? clamp(w * 0.05, 0.05, 0.1) : metalFrame ? 0.008 : tr + 0.006;
  const bedding = hex(p.bedding, youth ? '#c9d5dc' : '#efeae1'), light = hsl(bedding).l > 0.85;
  const hw = w / 2 - edge, mw = hw * 2;
  return { platform, youth, hbKind, soft, metalFrame, frameHex, frame, storage, thb, tr, ph, mh, mTop, mBot, sink, railTop, legs, legH, edge, hw,
    z0: -d / 2 + (hbKind === 'none' ? edge : thb + 0.004), z1: d / 2 - edge, fbTop: youth ? Math.min(h, mTop + 0.14) : railTop,
    bedding, foldHex: light ? K.shade(bedding, -0.07) : K.shade(bedding, 0.5), accent: hex(p.color3, youth ? '#e0b9a2' : light ? '#b9ab9b' : K.shade(bedding, -0.25)),
    throwHex: youth || w < 1.2 ? null : hex(p.color3, '#a89a8a'),
    pillows: int(p.pillows, 0, 0, 8) || (mw < 1.15 ? (youth ? 2 : 1) : w >= 1.5 && !platform ? 4 : 2),
    legHex: hex(p.color2, soft ? '#5e4533' : metalFrame ? frameHex : K.shade(frameHex, -0.1)) };
}

/** Duvet with a turned-back fold, pillows and an optional throw on a mattress. */
function dressBed(g, m, o) {
  const len = m.z1 - m.z0, td = 0.055, white = K.fabric(WHITE_LINEN);
  const zFold = m.z0 + clamp(len * 0.34, 0.24, 0.74);
  const half = Math.min(m.hw + 0.02, m.maxHalf), zEnd = Math.min(m.z1 + 0.012, m.zMax), dh = td + m.drop;
  g.add(K.rbox(half * 2, dh, zEnd - zFold, K.fabric(o.bedding), 0, m.top + td - dh / 2, (zFold + zEnd) / 2, 0.04));
  const fl = Math.min(0.24, len * 0.14), fh = td + 0.022 + m.drop * 0.9, fhalf = Math.min(half + 0.007, m.maxHalf);
  g.add(K.rbox(fhalf * 2, fh, fl, K.fabric(o.foldHex), 0, m.top + td + 0.022 - fh / 2, zFold + fl / 2 - 0.02, 0.035));
  if (o.throwHex && len > 1.5) {
    const tl = Math.min(0.5, len * 0.24), th = td + 0.016 + m.drop * 0.8, thalf = Math.min(half + 0.012, m.maxHalf);
    g.add(K.rbox(thalf * 2, th, tl, K.fabric(o.throwHex), 0, m.top + td + 0.016 - th / 2, zEnd - 0.14 - tl / 2, 0.03));
  }
  const mw = m.hw * 2, per = mw < 1.15 ? 1 : mw > 2.3 ? 3 : 2, zone = zFold - 0.02 - m.z0, slot = (mw - 0.04) / per;
  for (let left = o.pillows, row = 0; left > 0 && row < 3; row++) {
    const k = Math.min(left, per), accent = row > 0;
    const pw = Math.min(accent ? 0.58 : 0.72, slot - 0.03), pd = Math.min(accent ? 0.4 : 0.46, zone * 0.8), ph = accent ? 0.12 : o.ph || 0.13;
    const lean = m.lean ? (row === 0 ? 0.42 : 0.72) : 0;
    const zc = m.lean ? m.z0 + 0.035 + (pd / 2) * Math.cos(lean) + row * 0.15 : m.z0 + 0.03 + pd / 2 + row * (pd + 0.02);
    if (!m.lean && row > 0 && zc + pd / 2 > zFold + 0.04) break;
    const yc = m.top + ph / 2 + (pd / 2) * Math.sin(lean) * 0.92;
    for (let i = 0; i < k; i++) g.add(pillow(pw, ph, pd, accent ? K.fabric(o.accent) : white, (i - (k - 1) / 2) * slot, yc, zc, lean));
    left -= k;
  }
}

function headboard(g, o, w, h, y0, zo, style) {
  const xo = w / 2, z0 = -zo, z1 = -zo + o.thb, f = o.frame;
  if (o.hbKind === 'upholstered') {
    if (style === 'classic') {
      const n = Math.max(3, Math.round(w / 0.17));
      for (let i = 0; i < n; i++) g.add(K.rbox(w / n, h - y0, o.thb, f, -xo + (w * (i + 0.5)) / n, (y0 + h) / 2, (z0 + z1) / 2, 0.028, 1));
    } else g.add(K.rbox(w, h - y0, o.thb, f, 0, (y0 + h) / 2, (z0 + z1) / 2, 0.03));
  } else if (o.hbKind === 'wood') g.add(span(-xo, xo, y0, h, z0, z1, f));
  else if (o.hbKind === 'rattan') {
    const yp = Math.min(h - 0.2, Math.max(y0, o.mBot));
    framedFront(g, -xo, xo, yp, h, z0, z1, f, caneMat());
    if (yp > y0 + 0.01) g.add(span(-xo, -xo + 0.05, y0, yp, z0, z1, f), span(xo - 0.05, xo, y0, yp, z0, z1, f));
  } else if (o.hbKind === 'metal') {
    const r = Math.min(0.014, o.thb / 2), zc = z0 + r, yl = Math.min(h - 0.15, o.mTop - 0.03);
    g.add(K.cylOn(r, r, h - r, f, -xo + r, 0, zc, 12), K.cylOn(r, r, h - r, f, xo - r, 0, zc, 12), tubeX(r, w - 2 * r, f, 0, h - r, zc), tubeX(r * 0.8, w - 2 * r, f, 0, yl, zc));
    const n = Math.max(2, Math.round((w - 0.1) / 0.115));
    for (let i = 1; i < n; i++) g.add(K.cylOn(0.006, 0.006, h - r - yl, f, -xo + (w * i) / n, yl, zc, 8));
  }
}

/** Drawer fronts along one long side of a storage bed (s = ±1). */
function storageSide(g, hb, s, o, xo, y0, y1, za, zb, darkHex) {
  const xi = xo - o.tr, f = o.frame, X = (a, b) => (s > 0 ? [a, b] : [-b, -a]);
  const cap = y1 - 0.03, fixed = Math.min(0.32, (zb - za) * 0.18), n = 2, dl = (zb - za - fixed) / n;
  g.add(span(...X(xi, xo - 0.012), y0, cap, za, zb, K.mat(darkHex, { roughness: 0.9 })), span(...X(xi, xo), cap, y1, za, zb, f),
    span(...X(xo - 0.012, xo), y0, cap - GAP, za, za + fixed - GAP / 2, f));
  for (let i = 0; i < n; i++) {
    const a = za + fixed + i * dl + GAP / 2, b = a + dl - GAP;
    g.add(span(...X(xo - 0.012, xo), y0 + GAP / 2, cap - GAP, a, b, f));
    hb.box(0.002, 0.02, 0.15, darkHex, s * (xo - 0.0006), cap - GAP - 0.012, (a + b) / 2);
  }
}

function bedCore(w, d, h, p, variant) {
  const g = new THREE.Group(), o = bedOptions(w, d, h, p, variant);
  const xo = w / 2, zo = d / 2, f = o.frame, tr = o.tr, none = o.hbKind === 'none';
  const zr0 = -zo + (none ? 0 : o.thb), y0 = o.legH, y1 = o.railTop;
  const darkHex = K.shade(o.frameHex, -0.65), hb = new Batch();
  if (o.platform) g.add(span(-xo, xo, y0, o.mBot, zr0, zo, f));
  else if (o.soft) {
    const mid = (y0 + y1) / 2;
    for (const s of [-1, 1]) g.add(K.rbox(tr, y1 - y0, zo - zr0, f, s * (xo - tr / 2), mid, (zr0 + zo) / 2, 0.02, 2));
    g.add(K.rbox(w, y1 - y0, tr, f, 0, mid, zo - tr / 2, 0.02, 2));
    if (none) g.add(K.rbox(w, y1 - y0, tr, f, 0, mid, -zo + tr / 2, 0.02, 2));
  } else {
    const ya = o.metalFrame ? o.mBot - 0.045 : y0, yb = o.metalFrame ? o.mBot : y1;
    for (const s of [-1, 1]) {
      if (o.storage) storageSide(g, hb, s, o, xo, ya, yb, zr0, zo - tr, darkHex);
      else g.add(span(s > 0 ? xo - tr : -xo, s > 0 ? xo : -xo + tr, ya, yb, zr0, zo - tr, f));
    }
    g.add(span(-xo, xo, ya, o.metalFrame ? yb : o.fbTop, zo - tr, zo, f));
    if (none) g.add(span(-xo + tr, xo - tr, ya, yb, -zo, -zo + tr, f));
  }
  if (!none) headboard(g, o, w, h, o.platform ? y0 : o.metalFrame ? 0 : y0, zo, p.style);
  if (o.legH > 0.004) {
    if (o.legs === 'plinth') {
      const ins = o.platform ? Math.min(0.14, w * 0.12) : o.storage ? 0.012 : 0.05;
      g.add(span(-xo + ins, xo - ins, 0, o.legH, -zo + ins, zo - ins, K.mat(darkHex, { roughness: 0.8 })));
    } else {
      const metal = o.legs === 'metal', lm = metal ? K.metal(hex(p.color2, '#2b2d31')) : K.wood(o.legHex);
      const ins = metal ? 0.014 : o.soft ? 0.06 : 0.045, zs = [zo - ins];
      if (o.hbKind !== 'metal') zs.push(-zo + ins);
      for (const z of zs) for (const x of [-xo + ins, xo - ins]) {
        g.add(metal ? K.cylOn(0.013, 0.013, o.legH, lm, x, 0, z, 10) : o.soft ? K.boxOn(0.06, o.legH, 0.06, lm, x, 0, z) : K.cylOn(0.026, 0.017, o.legH, lm, x, 0, z, 14));
      }
      if (w >= 1.4) g.add(metal ? K.cylOn(0.013, 0.013, o.legH, lm, 0, 0, 0, 10) : K.cylOn(0.022, 0.016, o.legH, lm, 0, 0, 0, 12));
    }
  }
  g.add(K.rbox(o.hw * 2, o.mh, o.z1 - o.z0, K.fabric(WHITE_LINEN), 0, o.mBot + o.mh / 2, (o.z0 + o.z1) / 2, 0.035));
  dressBed(g, { hw: o.hw, z0: o.z0, z1: o.z1, top: o.mTop, drop: o.platform || o.metalFrame ? o.mh * 0.7 : clamp(o.mh - o.sink - 0.015, 0.02, 0.17), lean: !none,
    maxHalf: xo - 0.002, zMax: o.youth ? o.z1 + 0.003 : zo - (o.platform ? 0.01 : tr * 0.4) }, o);
  hb.into(g, batchMat(0.9));
  return g;
}

/** Day bed / closed sofa-bed: long side along X, back against −Z. */
function lounge(W, D, h, p, sofa) {
  const g = new THREE.Group(), xo = W / 2, zo = D / 2;
  if (sofa) {
    const cHex = hex(p.color, '#9a968f'), f = K.byMaterial(oneOf(p.material, SOFT, 'fabric'), cHex);
    const legH = Math.min(0.12, h * 0.15), seatTop = Math.min(0.43, h * 0.52), bt = Math.min(0.24, D * 0.3), n = clamp(Math.round(W / 0.95), 1, 3);
    const lm = p.legs === 'metal' ? K.metal(hex(p.color2, '#2b2d31')) : K.wood(hex(p.color2, '#6b4a34'));
    g.add(span(-xo + 0.02, xo - 0.02, legH, legH + 0.05, -zo + 0.02, zo - 0.03, K.mat(K.shade(cHex, -0.45), { roughness: 0.9 })));
    for (let i = 0; i < n; i++) {
      const x = -xo + (W * (i + 0.5)) / n;
      g.add(K.rbox(W / n, seatTop - legH - 0.04, D - bt * 0.5, f, x, (legH + 0.04 + seatTop) / 2, bt * 0.25, 0.05));
      g.add(K.rbox(W / n, h - seatTop + 0.07, bt, f, x, (seatTop - 0.07 + h) / 2, -zo + bt / 2, 0.06));
    }
    if (p.legs !== 'none') for (const x of W > 1.6 ? [-xo + 0.08, 0, xo - 0.08] : [-xo + 0.08, xo - 0.08]) for (const z of [-zo + 0.08, zo - 0.09]) g.add(K.cylOn(0.02, 0.014, legH, lm, x, 0, z, 12));
    const acc = K.fabric(hex(p.color3, '#c9b8a2'));
    for (const s of [-1, 1]) g.add(pillow(0.44, 0.13, 0.44, acc, s * (xo - 0.27), seatTop + 0.2, -zo + bt + 0.09, 1.2));
    return g;
  }
  const fHex = hex(p.color, '#f1eee8'), f = finish(oneOf(p.material, SOFT, null) ? null : p.material, p.color, '#f1eee8');
  const P = Math.min(0.045, W * 0.1), rt = 0.03, mTop = Math.min(0.5, h * 0.56), mh = Math.min(0.18, mTop * 0.4), mBot = mTop - mh, yr = mBot + 0.03, cap = h - 0.05;
  const sl = new Batch(), storage = flag(p.storage), darkHex = K.shade(fHex, -0.65);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(span(sx > 0 ? xo - P : -xo, sx > 0 ? xo : -xo + P, 0, h, sz > 0 ? zo - P : -zo, sz > 0 ? zo : -zo + P, f));
  g.add(span(-xo + P, xo - P, cap, h, -zo, -zo + rt, f), span(-xo + P, xo - P, mBot - 0.1, yr, -zo, -zo + rt, f), span(-xo + P, xo - P, mBot - 0.1, yr, zo - rt, zo, f));
  const nb = Math.max(2, Math.round((W - 2 * P) / 0.1));
  for (let i = 0; i < nb; i++) sl.box(0.045, cap - yr, 0.014, fHex, -xo + P + ((W - 2 * P) * (i + 0.5)) / nb, (cap + yr) / 2, -zo + rt / 2);
  for (const s of [-1, 1]) {
    g.add(span(s > 0 ? xo - rt : -xo, s > 0 ? xo : -xo + rt, cap, h, -zo + P, zo - P, f), span(s > 0 ? xo - rt : -xo, s > 0 ? xo : -xo + rt, mBot - 0.1, yr, -zo + P, zo - P, f));
    const na = Math.max(2, Math.round((D - 2 * P) / 0.1));
    for (let i = 0; i < na; i++) sl.box(0.014, cap - yr, 0.045, fHex, s * (xo - rt / 2), (cap + yr) / 2, -zo + P + ((D - 2 * P) * (i + 0.5)) / na);
  }
  if (storage) {
    const n = W > 1.6 ? 3 : 2, ya = 0.02, yb = mBot - 0.1 - GAP;
    g.add(span(-xo + P, xo - P, ya, yb, zo - 0.022, zo - 0.019, K.mat(darkHex, { roughness: 0.9 })));
    for (let i = 0; i < n; i++) {
      const a = -xo + P + ((W - 2 * P) * i) / n + GAP / 2, b = -xo + P + ((W - 2 * P) * (i + 1)) / n - GAP / 2;
      g.add(span(a, b, ya, yb, zo - 0.019, zo - 0.001, f));
      sl.box(0.14, 0.02, 0.002, darkHex, (a + b) / 2, yb - 0.012, zo - 0.001);
    }
  }
  sl.into(g, batchMat(0.55));
  const mx = xo - rt - 0.004, mz0 = -zo + rt + 0.004, mz1 = zo - rt - 0.004;
  g.add(K.rbox(mx * 2, mh, mz1 - mz0, K.fabric(hex(p.bedding, '#e6e0d4')), 0, mBot + mh / 2, (mz0 + mz1) / 2, 0.04));
  const k = clamp(Math.round(W / 0.62), 2, 4), cols = [hex(p.color3, '#b9a48c'), '#8c9a8b', WHITE_LINEN, '#cbbdaa'];
  const cw = Math.min(0.56, (mx * 2 - 0.1) / k - 0.02), ch = Math.min(0.44, (cap - mTop) * 1.1, D * 0.5);
  for (let i = 0; i < k; i++) g.add(pillow(cw, 0.14, ch, K.fabric(cols[i % cols.length]), (i - (k - 1) / 2) * ((mx * 2 - 0.1) / k), mTop + ch * 0.45 + 0.02, mz0 + 0.13, 1.15));
  g.add(K.rbox(Math.min(0.5, W * 0.25), 0.03, mz1 - mz0 + 0.004, K.fabric(hex(p.color3, '#a89a8a')), mx - Math.min(0.5, W * 0.25) / 2 - 0.06, mTop + 0.012, (mz0 + mz1) / 2, 0.012));
  return g;
}

function buildBed({ w, d, h, p }) {
  const variant = oneOf(p.variant, BED_VARIANTS, 'standard');
  if (variant === 'daybed') return w >= d ? lounge(w, d, h, p, false) : turned(lounge(d, w, h, p, false));
  if (variant === 'sofa-bed' && w >= d * 1.15) return lounge(w, d, h, p, true);
  const v = variant === 'sofa-bed' ? 'standard' : variant;
  if (!flag(p.canopy) || h < 1.2) return bedCore(w, d, h, p, v);
  // four-poster: the bed sits 4 mm inside the canopy frame
  const pc = Math.min(0.045, w * 0.1), o = bedOptions(w, d, h, p, v);
  const hi = o.hbKind === 'none' ? Math.min(0.62, h * 0.4) : clamp(num(p.headboardHeight, 105, 40, 400) / 100, 0.5, h - 0.15);
  const g = bedCore(w - 0.008, d - 0.008, hi, p, v);
  const fm = o.soft ? K.wood(hex(p.color2, '#6b4a34')) : o.frame, xo = w / 2, zo = d / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(span(sx > 0 ? xo - pc : -xo, sx > 0 ? xo : -xo + pc, 0, h, sz > 0 ? zo - pc : -zo, sz > 0 ? zo : -zo + pc, fm));
  for (const s of [-1, 1]) {
    g.add(span(-xo + pc, xo - pc, h - pc, h, s > 0 ? zo - pc : -zo, s > 0 ? zo : -zo + pc, fm));
    g.add(span(s > 0 ? xo - pc : -xo, s > 0 ? xo : -xo + pc, h - pc, h, -zo + pc, zo - pc, fm));
  }
  return g;
}

/** Plan view of a made bed: mattress, pillows and a duvet with a turned-down corner. Head at y0, foot at y1. */
function bedding2d(ctx, px, hw, y0, y1, o) {
  const len = y1 - y0, yF = y0 + clamp(len * 0.34, 24, 74), mw = hw * 2;
  K.fillRR(ctx, 0, (y0 + y1) / 2, mw, len, Math.min(4, hw * 0.2), '#fbfaf6', K.INK, px * 0.8);
  if (mw / px < 16) return;
  const per = mw < 115 ? 1 : mw > 230 ? 3 : 2, slot = (mw - 4) / per, pd = Math.min(42, (yF - y0) * 0.72);
  const rows = Math.min(2, Math.ceil(o.pillows / per));
  for (let r = 0; r < rows; r++) {
    const k = Math.min(per, o.pillows - r * per), pw = Math.min(r ? 54 : 70, slot - 3);
    for (let i = 0; i < k; i++) K.fillRR(ctx, (i - (k - 1) / 2) * slot, y0 + 3 + pd / 2 + r * Math.min(13, pd * 0.3), pw, r ? pd * 0.8 : pd, Math.min(6, pd * 0.25), r ? K.tint(o.accent, 0.35) : '#ffffff', K.INK, px * 0.8);
  }
  const x0 = -hw - 1, x1 = hw + 1, c = Math.min(26, mw * 0.24), r = Math.min(4, hw * 0.2), ye = y1 + 0.8;
  ctx.beginPath();
  ctx.moveTo(x0, yF); ctx.lineTo(x1 - c, yF); ctx.lineTo(x1, yF + c); ctx.lineTo(x1, ye - r); ctx.arcTo(x1, ye, x1 - r, ye, r);
  ctx.lineTo(x0 + r, ye); ctx.arcTo(x0, ye, x0, ye - r, r); ctx.closePath();
  ctx.fillStyle = K.tint(o.bedding, 0.25); ctx.fill(); ctx.strokeStyle = K.INK; ctx.lineWidth = px; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1 - c, yF); ctx.lineTo(x1, yF + c); ctx.lineTo(x1 - c, yF + c); ctx.closePath();
  ctx.fillStyle = K.tint(o.foldHex, 0.1); ctx.fill(); ctx.stroke();
  const yb = yF + Math.min(11, len * 0.07);
  K.line(ctx, x0, yb, x1 - c, yb, K.INK_SOFT, px);
  if (o.throwHex && len > 150) {
    const tl = Math.min(50, len * 0.24);
    rect2(ctx, x0, ye - 14 - tl, x1, ye - 14, K.tint(o.throwHex, 0.35), K.INK_SOFT, px * 0.8);
  }
}

function drawLounge(ctx, w, d, p, px, sofa) {
  if (sofa) {
    const c = hex(p.color, '#9a968f'), bt = Math.min(24, d * 0.3), n = clamp(Math.round(w / 95), 1, 3);
    K.fillRR(ctx, 0, 0, w, d, 4, K.tint(c, 0.45), K.INK, px);
    for (let i = 0; i < n; i++) {
      K.fillRR(ctx, -w / 2 + (w * (i + 0.5)) / n, -d / 2 + bt / 2, w / n - 1, bt - 1, 4, K.tint(c, 0.3), K.INK, px * 0.8);
      if (i > 0) K.line(ctx, -w / 2 + (w * i) / n, -d / 2 + bt, -w / 2 + (w * i) / n, d / 2, K.INK, px * 0.8);
    }
    for (const s of [-1, 1]) K.fillRR(ctx, s * (w / 2 - 27), -d / 2 + bt + 12, 40, 20, 6, K.tint(hex(p.color3, '#c9b8a2'), 0.3), K.INK, px * 0.8);
    return;
  }
  const c = hex(p.color, '#f1eee8'), rt = 3;
  rect2(ctx, -w / 2, -d / 2, w / 2, d / 2, K.tint(c, 0.4), K.INK, px);
  K.fillRR(ctx, 0, 0, w - 2 * rt, d - 2 * rt, 4, K.tint(hex(p.bedding, '#e6e0d4'), 0.4), K.INK, px * 0.8);
  if (w / px < 30) return;
  const k = clamp(Math.round(w / 62), 2, 4), cols = [hex(p.color3, '#b9a48c'), '#8c9a8b', WHITE_LINEN, '#cbbdaa'], cw = Math.min(56, (w - 16) / k - 2);
  for (let i = 0; i < k; i++) K.fillRR(ctx, (i - (k - 1) / 2) * ((w - 16) / k), -d / 2 + rt + 11, cw, 18, 6, K.tint(cols[i % 4], 0.35), K.INK, px * 0.8);
  const tw = Math.min(50, w * 0.25);
  rect2(ctx, w / 2 - rt - 6 - tw, -d / 2 + rt, w / 2 - rt - 6, d / 2 - rt, K.tint(hex(p.color3, '#a89a8a'), 0.35), K.INK_SOFT, px * 0.8);
}

function drawBed(ctx, { w, d, h, p, px }) {
  const variant = oneOf(p.variant, BED_VARIANTS, 'standard');
  if (variant === 'daybed') {
    if (w >= d) return drawLounge(ctx, w, d, p, px, false);
    ctx.rotate(-Math.PI / 2);
    return drawLounge(ctx, d, w, p, px, false);
  }
  if (variant === 'sofa-bed' && w >= d * 1.15) return drawLounge(ctx, w, d, p, px, true);
  const o = bedOptions(w / 100, d / 100, h / 100, p, variant === 'sofa-bed' ? 'standard' : variant);
  const thb = o.thb * 100;
  K.fillRR(ctx, 0, 0, w, d, o.soft ? 3 : 0.5, K.tint(o.frameHex, 0.45), K.INK, px);
  if (thb) K.fillRR(ctx, 0, -d / 2 + Math.max(thb, 3) / 2, w, Math.max(thb, 3), o.soft ? 2.5 : 0.5, K.tint(o.frameHex, 0.22), K.INK, px);
  bedding2d(ctx, px, o.hw * 100, o.z0 * 100, o.z1 * 100, o);
  if (o.youth) K.line(ctx, -w / 2, d / 2 - 3, w / 2, d / 2 - 3, K.INK, px * 0.8);
  if (flag(p.canopy) && h >= 120) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rect2(ctx, sx * w / 2 - (sx > 0 ? 4.5 : 0), sz * d / 2 - (sz > 0 ? 4.5 : 0), sx * w / 2 + (sx > 0 ? 0 : 4.5), sz * d / 2 + (sz > 0 ? 0 : 4.5), K.tint(o.frameHex, 0.1), K.INK, px);
    dashed(ctx, [6 * px, 4 * px], () => rect2(ctx, -w / 2 + 2.2, -d / 2 + 2.2, w / 2 - 2.2, d / 2 - 2.2, null, K.INK_SOFT, px));
  }
}
register('bed', buildBed, drawBed);

// ═════════════════════════ BUNK / LOFT ═════════════════════════
function bunkOptions(p) {
  return { variant: oneOf(p.variant, ['bunk', 'loft', 'trundle'], 'bunk'), side: oneOf(p.ladder, ['left', 'right', 'front'], 'right'),
    fHex: hex(p.color, '#e3cfa8'), bed1: hex(p.bedding, '#c9d5dc'), bed2: hex(p.color3, '#e2cfc0') };
}
function bunkCore(W, L, h, p) {
  const g = new THREE.Group(), o = bunkOptions(p), f = finish(p.material, p.color, '#e3cfa8');
  const xo = W / 2, zo = L / 2, t = 0.022;
  const dress = (hw, z0, z1, top, bedding) => {
    dressBed(g, { hw, z0, z1, top, drop: 0.03, lean: false, maxHalf: hw + 0.004, zMax: z1 }, { bedding, foldHex: K.shade(bedding, 0.45), accent: '#ffffff', pillows: 1, throwHex: null, ph: 0.1 });
  };
  if (o.variant === 'trundle') {
    const pt = 0.03, mTop = clamp(h * 0.55, 0.3, 0.52), mh = 0.16, mBot = mTop - mh, s = o.side === 'left' ? -1 : 1, hb = new Batch(), darkHex = K.shade(o.fHex, -0.65);
    g.add(span(-xo, xo, 0, h, -zo, -zo + pt, f), span(-xo, xo, 0, Math.max(mTop + 0.06, h * 0.62), zo - pt, zo, f));
    for (const sx of [-1, 1]) g.add(span(sx > 0 ? xo - t : -xo, sx > 0 ? xo : -xo + t, mBot - 0.1, mBot + 0.05, -zo + pt, zo - pt, f));
    const ty = Math.max(0.05, mBot - 0.11);
    g.add(span(-xo + 0.03, xo - 0.03, 0.03, ty - 0.02, -zo + pt + 0.03, zo - pt - 0.03, K.mat(darkHex, { roughness: 0.9 })));
    g.add(span(s > 0 ? xo - 0.02 : -xo, s > 0 ? xo : -xo + 0.02, 0.025, ty, -zo + pt + 0.02, zo - pt - 0.02, f));
    for (const z of [-L * 0.2, L * 0.2]) hb.box(0.002, 0.022, 0.13, darkHex, s * (xo - 0.0006), ty - 0.035, z);
    hb.into(g, batchMat(0.9));
    const hw = xo - t - 0.006;
    g.add(K.rbox(hw * 2, mh, L - 2 * pt - 0.012, K.fabric(WHITE_LINEN), 0, mBot + mh / 2, 0, 0.03));
    dressBed(g, { hw, z0: -zo + pt + 0.006, z1: zo - pt - 0.006, top: mTop, drop: 0.06, lean: true, maxHalf: xo - 0.002, zMax: zo - pt - 0.004 },
      { bedding: o.bed1, foldHex: K.shade(o.bed1, 0.45), accent: o.bed2, pillows: 2, throwHex: null });
    return g;
  }
  const P = Math.min(0.05, W * 0.1), gTop = h - 0.02, yU = h - clamp(h * 0.2, 0.24, 0.34);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(span(sx > 0 ? xo - P : -xo, sx > 0 ? xo : -xo + P, 0, h, sz > 0 ? zo - P : -zo, sz > 0 ? zo : -zo + P, f));
  const sideX = (s, y0, y1, z0, z1) => g.add(span(s > 0 ? xo - t : -xo, s > 0 ? xo : -xo + t, y0, y1, z0, z1, f));
  const endZ = (s, y0, y1, x0, x1) => g.add(span(x0, x1, y0, y1, s > 0 ? zo - t : -zo, s > 0 ? zo : -zo + t, f));
  const level = (yTop, bedding) => {
    for (const s of [-1, 1]) { sideX(s, yTop - 0.15, yTop, -zo + P, zo - P); endZ(s, yTop - 0.15, yTop, -xo + P, xo - P); }
    const hw = xo - P + 0.005;
    g.add(K.rbox(hw * 2, 0.13, L - 2 * P + 0.01, K.fabric(WHITE_LINEN), 0, yTop - 0.025, 0, 0.03));
    dress(hw - 0.01, -zo + P, zo - P, yTop + 0.04, bedding);
  };
  level(yU, o.bed1);
  // guard rails and ladder
  const lw = Math.min(0.38, L * 0.25), front = o.side === 'front', ls = o.side === 'left' ? -1 : 1;
  const slats = [[gTop - 0.07, gTop]];
  if (gTop - 0.07 - yU > 0.15) slats.push([(yU + gTop - 0.07) / 2 - 0.03, (yU + gTop - 0.07) / 2 + 0.03]);
  const zl1 = zo - P - 0.04, zl0 = zl1 - lw, xl1 = xo - P - 0.04, xl0 = xl1 - lw;
  for (const [a, b] of slats) {
    for (const s of [-1, 1]) sideX(s, a, b, -zo + P, !front && s === ls ? zl0 : zo - P);
    endZ(-1, a, b, -xo + P, xo - P);
    endZ(1, a, b, -xo + P, front ? xl0 : xo - P);
  }
  const rungs = [];
  for (let y = 0.26; y < yU - 0.04; y += 0.26) rungs.push(y);
  if (front) {
    for (const x of [xl0, xl1]) g.add(span(x - 0.0175, x + 0.0175, 0, gTop, zo - 0.03, zo, f));
    for (const y of rungs) g.add(span(xl0, xl1, y - 0.015, y + 0.015, zo - 0.026, zo - 0.004, f));
  } else {
    for (const z of [zl0, zl1]) g.add(span(ls > 0 ? xo - 0.03 : -xo, ls > 0 ? xo : -xo + 0.03, 0, gTop, z - 0.0175, z + 0.0175, f));
    for (const y of rungs) g.add(span(ls > 0 ? xo - 0.026 : -xo + 0.004, ls > 0 ? xo - 0.004 : -xo + 0.026, y - 0.015, y + 0.015, zl0, zl1, f));
  }
  if (o.variant === 'bunk') {
    const yL = clamp(yU - 0.8, 0.2, 0.36);
    level(yL, o.bed2);
    const ym = (yL + yU - 0.15) / 2;
    for (const s of [-1, 1]) endZ(s, ym - 0.04, ym + 0.04, -xo + P, xo - P);
  } else if (yU - 0.15 > 1.2) {   // loft: desk and shelves below
    const ds = front ? -1 : -ls, dd = Math.min(0.55, W * 0.6), x0 = ds > 0 ? xo - t - dd : -xo + t, x1 = x0 + dd;
    g.add(span(x0, x1, 0.715, 0.74, -zo + P, zo - P, f), span(x0 + 0.02, x1 - 0.02, 0.3, 0.715, -zo + P + 0.0, -zo + P + t, f));
    for (const y of [1.02, 1.3]) if (y < yU - 0.3) g.add(span(-xo + P, xo - P, y, y + t, -zo + 0.004, -zo + 0.22, f));
    g.add(span(-xo + P, xo - P, 0.3, 0.38, -zo, -zo + t, f));
  } else for (const s of [-1, 1]) endZ(s, 0.3, 0.38, -xo + P, xo - P);
  return g;
}
function buildBunk({ w, d, h, p }) { return w > d * 1.05 ? turned(bunkCore(d, w, h, p)) : bunkCore(w, d, h, p); }

function drawBunk(ctx, { w, d, p, px }) {
  if (w > d * 1.05) { ctx.rotate(-Math.PI / 2); [w, d] = [d, w]; }
  const o = bunkOptions(p), tr = o.variant === 'trundle', P = tr ? 3 : 5;
  rect2(ctx, -w / 2, -d / 2, w / 2, d / 2, K.tint(o.fHex, 0.45), K.INK, px);
  if (tr) rect2(ctx, -w / 2, -d / 2, w / 2, -d / 2 + 3, K.tint(o.fHex, 0.2), K.INK, px);
  else for (const sx of [-1, 1]) for (const sz of [-1, 1]) rect2(ctx, sx > 0 ? w / 2 - P : -w / 2, sz > 0 ? d / 2 - P : -d / 2, sx > 0 ? w / 2 : -w / 2 + P, sz > 0 ? d / 2 : -d / 2 + P, K.tint(o.fHex, 0.2), K.INK, px * 0.8);
  bedding2d(ctx, px, w / 2 - (tr ? 3 : P - 0.5), -d / 2 + P, d / 2 - P, { pillows: tr ? 2 : 1, bedding: o.bed1, foldHex: K.shade(o.bed1, 0.45), accent: o.bed2, throwHex: null });
  if (w / px < 24) return;
  if (tr) { const s = o.side === 'left' ? -1 : 1; dashed(ctx, [5 * px, 3 * px], () => K.line(ctx, s * (w / 2 - 2.2), -d / 2 + 6, s * (w / 2 - 2.2), d / 2 - 6, K.INK, px)); return; }
  const lw = Math.min(38, d * 0.25);
  if (o.side === 'front') { const x1 = w / 2 - P - 4; rect2(ctx, x1 - lw, d / 2 - 3, x1, d / 2, '#ffffff', K.INK, px); for (let i = 1; i < 4; i++) K.line(ctx, x1 - (lw * i) / 4, d / 2 - 3, x1 - (lw * i) / 4, d / 2, K.INK, px * 0.8); }
  else { const s = o.side === 'left' ? -1 : 1, z1 = d / 2 - P - 4, xa = s > 0 ? w / 2 - 3 : -w / 2; rect2(ctx, xa, z1 - lw, xa + 3, z1, '#ffffff', K.INK, px); for (let i = 1; i < 4; i++) K.line(ctx, xa, z1 - (lw * i) / 4, xa + 3, z1 - (lw * i) / 4, K.INK, px * 0.8); }
  dashed(ctx, [6 * px, 4 * px], () => {   // upper level hint
    rect2(ctx, -w / 2 + 2.2, -d / 2 + 2.2, w / 2 - 2.2, d / 2 - 2.2, null, K.INK_SOFT, px);
    if (o.variant === 'loft') { K.line(ctx, -w / 2 + 2.2, -d / 2 + 2.2, w / 2 - 2.2, d / 2 - 2.2, K.INK_SOFT, px); K.line(ctx, w / 2 - 2.2, -d / 2 + 2.2, -w / 2 + 2.2, d / 2 - 2.2, K.INK_SOFT, px); }
  });
}
register('bunk-bed', buildBunk, drawBunk);

// ═════════════════════════ CRIB ═════════════════════════
const CRIB_VARIANTS = ['crib', 'changing-table', 'toddler'];
function changingParams(p) { return { color: '#f1eee8', handles: 'knob', legs: 'wood', legHeight: 8, ...(p.doors || p.drawers || p.open ? {} : { drawers: 3 }), ...p, top: undefined }; }

function cribCore(W, L, h, p, toddler) {
  const g = new THREE.Group(), fHex = hex(p.color, '#f1eee8'), f = finish(p.material, p.color, '#f1eee8');
  const xo = W / 2, zo = L / 2, bars = new Batch(), sheet = K.fabric(hex(p.bedding, WHITE_LINEN)), blanket = hex(p.color3, '#d9c3b0');
  if (toddler) {
    const pt = 0.025, t = 0.022, mTop = clamp(h * 0.5, 0.16, 0.34), mh = Math.min(0.1, mTop * 0.5), mBot = mTop - mh, gy = Math.min(h - 0.03, mTop + 0.17), gl = (L - 2 * pt) * 0.45;
    g.add(span(-xo, xo, 0, h, -zo, -zo + pt, f), span(-xo, xo, 0, Math.max(mTop + 0.05, h * 0.72), zo - pt, zo, f));
    for (const s of [-1, 1]) {
      const xa = s > 0 ? xo - t : -xo, xb = xa + t;
      g.add(span(xa, xb, Math.max(0.02, mBot - 0.08), mBot + 0.03, -zo + pt, zo - pt, f), span(xa, xb, gy - 0.04, gy, -zo + pt, -zo + pt + gl, f));
      for (let i = 1; i <= 4; i++) bars.box(0.012, gy - 0.04 - mBot - 0.03, 0.03, fHex, s * (xo - t / 2), (gy - 0.04 + mBot + 0.03) / 2, -zo + pt + (gl * i) / 4 - 0.015);
    }
    const hw = xo - t - 0.006;
    g.add(K.rbox(hw * 2, mh, L - 2 * pt - 0.012, sheet, 0, mBot + mh / 2, 0, 0.025));
    dressBed(g, { hw, z0: -zo + pt + 0.006, z1: zo - pt - 0.006, top: mTop, drop: 0.03, lean: true, maxHalf: hw + 0.004, zMax: zo - pt - 0.004 },
      { bedding: hex(p.bedding, '#d5dfd8'), foldHex: '#f6f3ec', accent: blanket, pillows: 1, throwHex: null, ph: 0.09 });
  } else {
    const P = Math.min(0.04, W * 0.1), mTop = clamp(h * 0.52, 0.14, 0.5), mh = Math.min(0.1, mTop * 0.5), mBot = mTop - mh, sideTop = h - 0.04, rt = 0.028;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(span(sx > 0 ? xo - P : -xo, sx > 0 ? xo : -xo + P, 0, h, sz > 0 ? zo - P : -zo, sz > 0 ? zo : -zo + P, f));
    for (const s of [-1, 1]) {
      g.add(span(-xo + P, xo - P, Math.max(0.03, mBot - 0.16), h - 0.008, s * (zo - P / 2) - 0.009, s * (zo - P / 2) + 0.009, f));
      const xa = s > 0 ? xo - rt - 0.004 : -xo + 0.004, xb = xa + rt;
      g.add(span(xa, xb, sideTop - 0.035, sideTop, -zo + P, zo - P, f), span(xa, xb, mBot - 0.07, mBot + 0.01, -zo + P, zo - P, f));
      const n = Math.max(3, Math.round((L - 2 * P) / 0.07));
      for (let i = 1; i < n; i++) bars.cyl(0.0075, sideTop - 0.035 - mBot - 0.01, fHex, (xa + xb) / 2, (sideTop - 0.035 + mBot + 0.01) / 2, -zo + P + ((L - 2 * P) * i) / n);
    }
    const hw = xo - rt - 0.012, ml = L - 2 * P - 0.01;
    g.add(K.rbox(hw * 2, mh, ml, sheet, 0, mBot + mh / 2, 0, 0.025));
    g.add(K.rbox(hw * 2 - 0.02, 0.035, ml * 0.42, K.fabric(blanket), 0, mTop + 0.012, ml * 0.27, 0.015), K.rbox(hw * 2 - 0.016, 0.03, 0.09, K.fabric(K.shade(blanket, 0.4)), 0, mTop + 0.024, ml * 0.07, 0.014));
  }
  bars.into(g, batchMat(0.5));
  return g;
}
function buildCrib({ w, d, h, p }) {
  const variant = oneOf(p.variant, CRIB_VARIANTS, 'crib');
  if (variant === 'changing-table') {
    const rim = Math.min(0.1, h * 0.14), q = changingParams(p), g = buildCabinet({ w, d, h: h - rim, p: q });
    const f = finish(q.material, q.color), zf = d / 2 - 0.03, y0 = h - rim;
    g.add(span(-w / 2, w / 2, y0, h, -d / 2, -d / 2 + T, f), span(-w / 2, -w / 2 + T, y0, h, -d / 2 + T, zf, f), span(w / 2 - T, w / 2, y0, h, -d / 2 + T, zf, f),
      span(-w / 2 + T, w / 2 - T, y0, y0 + 0.03, zf - T, zf, f));
    const pm = K.fabric(hex(p.color3, '#cfd8d2')), pw = w - 2 * T - 0.02, pl = zf - T - (-d / 2 + T) - 0.02, zc = (-d / 2 + T + zf - T) / 2;
    g.add(K.rbox(pw, 0.045, pl, pm, 0, y0 + 0.0225, zc, 0.02));
    for (const s of [-1, 1]) g.add(K.rbox(Math.min(0.09, pw * 0.2), 0.075, pl, pm, s * (pw / 2 - Math.min(0.09, pw * 0.2) / 2), y0 + 0.0375, zc, 0.03));
    return g;
  }
  return w > d * 1.05 ? turned(cribCore(d, w, h, p, variant === 'toddler')) : cribCore(w, d, h, p, variant === 'toddler');
}
function drawCrib(ctx, { w, d, h, p, px }) {
  const variant = oneOf(p.variant, CRIB_VARIANTS, 'crib');
  if (variant === 'changing-table') {
    drawCabinet(ctx, { w, d, h: h * 0.86, p: changingParams(p), px });
    K.fillRR(ctx, 0, -1.5, w - 6, d - 9, 4, K.tint(hex(p.color3, '#cfd8d2'), 0.3), K.INK, px * 0.8);
    return;
  }
  if (w > d * 1.05) { ctx.rotate(-Math.PI / 2); [w, d] = [d, w]; }
  const c = hex(p.color, '#f1eee8'), blanket = hex(p.color3, '#d9c3b0');
  rect2(ctx, -w / 2, -d / 2, w / 2, d / 2, K.tint(c, 0.4), K.INK, px);
  if (variant === 'toddler') {
    rect2(ctx, -w / 2, -d / 2, w / 2, -d / 2 + 2.5, K.tint(c, 0.15), K.INK, px);
    bedding2d(ctx, px, w / 2 - 2.8, -d / 2 + 3.1, d / 2 - 3.1, { pillows: 1, bedding: hex(p.bedding, '#d5dfd8'), foldHex: '#f6f3ec', accent: blanket, throwHex: null });
    for (const s of [-1, 1]) K.line(ctx, s * (w / 2 - 1.1), -d / 2 + 2.5, s * (w / 2 - 1.1), -d / 2 + 2.5 + (d - 5) * 0.45, K.INK, px * 1.6);
    return;
  }
  K.fillRR(ctx, 0, 0, w - 8, d - 9, 3, '#fbfaf6', K.INK, px * 0.8);
  rect2(ctx, -w / 2 + 5, d * 0.06, w / 2 - 5, d / 2 - 5.5, K.tint(blanket, 0.3), K.INK, px * 0.8);
  if (d / px > 40) {
    const n = Math.max(3, Math.round((d - 8) / 7));
    for (const s of [-1, 1]) for (let i = 1; i < n; i++) { const y = -d / 2 + 4 + ((d - 8) * i) / n; K.line(ctx, s * (w / 2 - 3.2), y, s * (w / 2 - 0.4), y, K.INK, px * 0.8); }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rect2(ctx, sx > 0 ? w / 2 - 4 : -w / 2, sz > 0 ? d / 2 - 4 : -d / 2, sx > 0 ? w / 2 : -w / 2 + 4, sz > 0 ? d / 2 : -d / 2 + 4, K.tint(c, 0.15), K.INK, px * 0.8);
}
register('crib', buildCrib, drawCrib);

// ═════════════════════════ COAT RACK ═════════════════════════
function rackOptions(w, d, p) {
  const variant = oneOf(p.variant, ['stand', 'rail', 'shoe-rack', 'wall-hooks'], 'stand');
  const metal = p.material === 'metal' || p.material === 'aluminium' || (variant === 'rail' && !oneOf(p.material, MATERIALS, null));
  return { variant, metal, pole: variant === 'stand' && Math.max(w, d) / Math.min(w, d) <= 1.4,
    bodyHex: hex(p.color, metal ? '#26282b' : '#c8a476'), accHex: hex(p.color2, metal ? '#c8a476' : '#26282b') };
}
function buildCoatRack({ w, d, h, p, item }) {
  const g = new THREE.Group(), o = rackOptions(w, d, p), rnd = seeded(item, 'coat-rack'), cloth = new Batch(), hw = new Batch();
  const m = o.metal ? K.metal(o.bodyHex) : finish(p.material, p.color), xo = w / 2, zo = d / 2;
  const shoeLen = Math.min(0.27, d - 0.04), shoeCols = ['#3f4650', '#a0725b', '#ece7de', '#7d6f63', '#8c9a8b'];
  if (o.pole) {
    const R = Math.min(w, d) / 2, pr = Math.min(0.02, R * 0.2), kr = 0.013;
    g.add(K.cylOn(R * 0.7, R * 0.76, 0.028, m, 0, 0, 0, 28), K.cylOn(pr, pr * 1.2, h - 0.028, m, 0, 0.028, 0, 14));
    const y1 = Math.max(h * 0.5, h - 0.3);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tip = [dx * (xo - kr), h - 0.06, dz * (zo - kr)];
      g.add(K.bar([0, y1, 0], tip, 0.009, m), K.sphere(kr, m, ...tip));
    }
    const y2 = Math.max(h * 0.4, h - 0.55);
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const tip = [dx * xo * 0.55, y2 + 0.17, dz * zo * 0.55];
      g.add(K.bar([0, y2, 0], tip, 0.008, m), K.sphere(0.011, m, ...tip));
    }
    if (h > 1.2) {
      garment(cloth, { x: 0, y: y2 + 0.15, z: Math.min(zo - 0.04, pr + 0.07), sw: Math.min(0.42, w - 0.03), len: Math.min(0.85, y2 - 0.1), t: 0.065, color: pickFrom(rnd, MUTED), plane: 'xy', hanger: false });
      cloth.box(0.07, 0.5, 0.02, hex(p.color3, '#b88f7a'), -Math.min(xo * 0.5, 0.12), y2 - 0.1, -Math.min(zo * 0.5, 0.1), { ry: 0.6 });
    }
  } else if (o.variant === 'stand') {   // hall stand: hat shelf, hook rail and shoe bench
    const P = 0.03, seat = Math.min(0.45, h * 0.3), sd = Math.min(d, 0.3);
    for (const s of [-1, 1]) g.add(span(s > 0 ? xo - P : -xo, s > 0 ? xo : -xo + P, 0, h - 0.022, -zo, -zo + P, m), span(s > 0 ? xo - P : -xo, s > 0 ? xo : -xo + P, 0, seat, zo - P, zo, m));
    g.add(span(-xo, xo, h - 0.022, h, -zo, -zo + sd, m), span(-xo, xo, seat, seat + 0.026, -zo, zo, m), span(-xo + P, xo - P, h - 0.32, h - 0.22, -zo + 0.004, -zo + 0.022, m),
      span(-xo + P, xo - P, 0.15, 0.168, -zo + 0.01, zo - 0.01, m), span(-xo + P, xo - P, seat + 0.026, seat + 0.09, -zo + 0.004, -zo + 0.022, m));
    const n = Math.max(2, Math.round((w - 0.12) / 0.17)), xs = range(n).map((i) => -xo + 0.1 + ((w - 0.2) * i) / Math.max(1, n - 1));
    for (const x of xs) hw.cyl(0.007, 0.05, o.accHex, x, h - 0.27, -zo + 0.047, { rx: Math.PI / 2 }).cyl(0.012, 0.01, o.accHex, x, h - 0.27, -zo + 0.075, { rx: Math.PI / 2 });
    const room = h - 0.3 - seat - 0.12;
    if (room > 0.45) xs.forEach((x, i) => { if (i % 2 === 0 && i < 3) garment(cloth, { x: clamp(x, -xo + 0.2, xo - 0.2), y: h - 0.285, z: -zo + 0.065, sw: Math.min(0.4, w * 0.45), len: Math.min(room, 0.7 + rnd() * 0.25), t: 0.05, color: pickFrom(rnd, MUTED), plane: 'xy', hanger: false }); });
    for (let i = 0; i < Math.min(3, Math.floor((w - 0.1) / 0.27)); i++) shoePair(cloth, rnd, -xo + 0.2 + i * 0.27, 0.168, 0, shoeLen, pickFrom(rnd, shoeCols));
  } else if (o.variant === 'rail') {
    const r = 0.012, wood = K.wood(o.accHex);
    for (const s of [-1, 1]) g.add(K.cylOn(r, r, h - r, m, s * (xo - r), 0, 0, 12), tubeZ(r, d, m, s * (xo - r), r, 0));
    g.add(tubeX(r, w - 2 * r, m, 0, h - r, 0), span(-xo + 2 * r, xo - 2 * r, 0.15, 0.168, -d * 0.36, d * 0.36, wood));
    const count = Math.floor((w - 0.16) / 0.068), sw = Math.min(0.44, d - 0.02);
    for (let i = 0; i < count; i++) {
      if (rnd() < 0.25) continue;
      garment(cloth, { x: -xo + 0.08 + ((w - 0.16) * (i + 0.5)) / count, y: h - 0.075, z: 0, sw: sw * (0.9 + rnd() * 0.1), len: Math.min(h - 0.4, 0.65 + rnd() * 0.5), t: 0.03 + rnd() * 0.02, color: pickFrom(rnd, MUTED), flare: 0.86 + rnd() * 0.2 });
    }
    for (let i = 0; i < Math.min(2, Math.floor((w - 0.1) / 0.3)); i++) shoePair(cloth, rnd, -xo + 0.22 + i * 0.3, 0.168, 0, Math.min(shoeLen, d * 0.7), pickFrom(rnd, shoeCols));
  } else if (o.variant === 'shoe-rack') {
    const tiers = clamp(Math.round(h / 0.2), 2, 10), P = o.metal ? 0.016 : 0.024, shelf = o.metal ? K.wood(o.accHex) : m, y0 = Math.min(0.05, h * 0.1), pitch = (h - 0.018 - y0) / (tiers - 1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(span(sx > 0 ? xo - P : -xo, sx > 0 ? xo : -xo + P, 0, h - 0.018, sz > 0 ? zo - P : -zo, sz > 0 ? zo : -zo + P, m));
    g.add(span(-xo, xo, h - 0.018, h, -zo, zo, shelf));
    for (let j = 0; j < tiers - 1; j++) {
      const y = y0 + j * pitch;
      g.add(span(-xo + 0.004, xo - 0.004, y, y + 0.016, -zo + 0.004, zo - 0.004, shelf));
      if (pitch < 0.13) continue;
      const n = Math.floor((w - 0.06) / 0.25);
      for (let i = 0; i < n; i++) if (rnd() > 0.2) shoePair(cloth, rnd, -xo + 0.03 + ((w - 0.06) * (i + 0.5)) / n, y + 0.016, 0, shoeLen, pickFrom(rnd, shoeCols));
    }
  } else {   // wall hooks
    const bt = Math.min(0.02, d * 0.4), tall = h > 0.4, n = Math.max(2, Math.round(w / 0.15)), yh = tall ? h - 0.22 : h * 0.5, len = tall ? Math.min(d - bt, 0.07) : d - bt;
    if (tall) {
      const k = Math.max(2, Math.round(w / 0.12));
      for (let i = 0; i < k; i++) g.add(span(-xo + (w * i) / k + (i ? 0.003 : 0), -xo + (w * (i + 1)) / k - (i < k - 1 ? 0.003 : 0), 0, h - 0.02, -zo, -zo + bt, m));
      g.add(span(-xo, xo, h - 0.02, h, -zo, zo, m));
    } else g.add(span(-xo, xo, 0, h, -zo, -zo + bt, m));
    const xs = range(n).map((i) => -xo + (w * (i + 0.5)) / n), kr = Math.min(0.015, h * 0.3);
    for (const x of xs) hw.cyl(kr * 0.5, len, o.accHex, x, yh, -zo + bt + len / 2, { rx: Math.PI / 2 }).cyl(kr, 0.012, o.accHex, x, yh, -zo + bt + len - 0.006, { rx: Math.PI / 2 }, 1, 12);
    if (tall && h > 1) {
      garment(cloth, { x: xs[0] + 0.02, y: yh - 0.015, z: -zo + bt + 0.04, sw: Math.min(0.4, w * 0.5), len: Math.min(0.85, yh - 0.25), t: 0.05, color: pickFrom(rnd, MUTED), plane: 'xy', hanger: false });
      if (n > 2) cloth.box(0.26, 0.3, 0.05, hex(p.color3, '#cbbdaa'), xs[n - 1] - 0.04, yh - 0.42, -zo + bt + 0.035).box(0.012, 0.3, 0.012, '#7d6f63', xs[n - 1] - 0.04, yh - 0.14, -zo + bt + 0.03);
    }
  }
  hw.into(g, o.metal || o.variant === 'stand' || !isNeutral(o.accHex) ? batchMat(0.5, o.metal ? 0 : 0.5) : batchMat(0.4, 0.7));
  cloth.into(g, batchMat(0.9));
  return g;
}
function drawCoatRack(ctx, { w, d, p, px, item }) {
  const o = rackOptions(w / 100, d / 100, p), fill = K.tint(o.bodyHex, 0.55), rnd = seeded(item, 'coat-rack');
  const hangers = (y, a, b, len) => { const n = Math.floor((b - a) / 6.8); for (let i = 0; i < n; i++) { const x = a + ((b - a) * (i + 0.5)) / n, s = (i % 3) - 1; K.line(ctx, x - s * 1.5, y - len, x + s * 1.5, y + len, K.INK_SOFT, px * 0.9); } };
  if (o.pole) {
    const R = Math.min(w, d) / 2;
    K.fillCircle(ctx, 0, 0, R * 0.74, K.tint(o.bodyHex, 0.7), K.INK_SOFT, px);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { K.line(ctx, 0, 0, dx * (w / 2 - 1.3), dz * (d / 2 - 1.3), K.INK, px * 1.2); K.fillCircle(ctx, dx * (w / 2 - 1.3), dz * (d / 2 - 1.3), 1.3, fill, K.INK, px); }
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { K.line(ctx, 0, 0, dx * w * 0.275, dz * d * 0.275, K.INK, px); K.fillCircle(ctx, dx * w * 0.275, dz * d * 0.275, 1.1, fill, K.INK, px); }
    K.fillCircle(ctx, 0, 0, Math.min(2.2, R * 0.2), fill, K.INK, px);
  } else if (o.variant === 'stand') {
    rect2(ctx, -w / 2, -d / 2, w / 2, d / 2, fill, K.INK, px);
    K.line(ctx, -w / 2, -d / 2 + Math.min(d, 30), w / 2, -d / 2 + Math.min(d, 30), K.INK_SOFT, px);
    const n = Math.max(2, Math.round((w - 12) / 17));
    for (let i = 0; i < n; i++) K.fillCircle(ctx, -w / 2 + 10 + ((w - 20) * i) / Math.max(1, n - 1), -d / 2 + 6.5, 1.2, K.tint(o.accHex, 0.2), K.INK, px * 0.8);
    for (const s of [-1, 1]) rect2(ctx, s > 0 ? w / 2 - 3 : -w / 2, d / 2 - 3, s > 0 ? w / 2 : -w / 2 + 3, d / 2, K.tint(o.bodyHex, 0.3), K.INK, px * 0.8);
  } else if (o.variant === 'rail') {
    for (const s of [-1, 1]) K.fillRR(ctx, s * (w / 2 - 1.2), 0, 2.4, d, 1.2, fill, K.INK, px);
    K.fillRR(ctx, 0, 0, w - 4.8, d * 0.72, 1, K.tint(o.accHex, 0.7), K.INK_SOFT, px * 0.8);
    K.line(ctx, -w / 2 + 2.4, 0, w / 2 - 2.4, 0, K.INK, px * 1.8);
    if (w / px > 40) hangers(0, -w / 2 + 8, w / 2 - 8, Math.min(22, d / 2 - 1));
  } else if (o.variant === 'shoe-rack') {
    rect2(ctx, -w / 2, -d / 2, w / 2, d / 2, fill, K.INK, px);
    if (w / px > 40) {
      const n = Math.floor((w - 6) / 25), len = Math.min(27, d - 4);
      for (let i = 0; i < n; i++) for (const s of [-1, 1]) K.fillRR(ctx, -w / 2 + 3 + ((w - 6) * (i + 0.5)) / n + s * 5.6, 0, 9, len, 4, K.tint(pickFrom(rnd, MUTED), 0.4), K.INK_SOFT, px * 0.8);
    }
  } else {
    const bt = Math.min(2, d * 0.4), n = Math.max(2, Math.round(w / 15));
    rect2(ctx, -w / 2, -d / 2, w / 2, -d / 2 + bt, fill, K.INK, px);
    for (let i = 0; i < n; i++) { const x = -w / 2 + (w * (i + 0.5)) / n; K.line(ctx, x, -d / 2 + bt, x, d / 2 - 1, K.INK, px * 1.4); K.fillCircle(ctx, x, d / 2 - 1.2, Math.min(1.5, d * 0.2), K.tint(o.accHex, 0.2), K.INK, px * 0.8); }
  }
}
register('coat-rack', buildCoatRack, drawCoatRack);
