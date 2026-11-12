/**
 * Modelling kit — shared materials + primitive helpers so that every model in the catalogue looks like it
 * belongs to the same world. Model modules should use these instead of creating ad-hoc materials.
 *
 * All sizes in METRES. Y is up. Helpers return THREE.Mesh / THREE.Group already positioned.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ───────────────────────── materials (cached) ─────────────────────────
const _mats = new Map();
const key = (...a) => a.join('|');

/** Generic cached PBR material. opts: { roughness, metalness, opacity, emissive, emissiveIntensity, side, flat } */
export function mat(color = '#cccccc', opts = {}) {
  const k = key('m', color, JSON.stringify(opts));
  if (_mats.has(k)) return _mats.get(k);
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? 0.7,
    metalness: opts.metalness ?? 0,
    transparent: opts.opacity != null && opts.opacity < 1,
    opacity: opts.opacity ?? 1,
    emissive: new THREE.Color(opts.emissive || '#000000'),
    emissiveIntensity: opts.emissiveIntensity ?? (opts.emissive ? 1 : 0),
    side: opts.side ?? THREE.FrontSide,
    flatShading: !!opts.flat,
  });
  if (opts.map) m.map = opts.map;
  if (opts.depthWrite === false) m.depthWrite = false;
  _mats.set(k, m);
  return m;
}

export const WOOD_TONES = {
  oak: '#c8a476', 'light-oak': '#dcc199', walnut: '#6b4a34', birch: '#e3cfa8', pine: '#dfc08a', ash: '#d9c7a6',
  teak: '#a9743f', beech: '#d8b384', wenge: '#3d2c24', black: '#26221f', white: '#f2efe8', acacia: '#8f5f3a', bamboo: '#d6b775',
  mahogany: '#6e3524', cherry: '#9c5a3c', grey: '#9a938a', eucalyptus: '#b98a5e',
};

/** Resolve a colour that may be a hex string or a wood-tone / named colour keyword. */
export function col(c, fallback = '#cccccc') {
  if (!c) return fallback;
  if (typeof c === 'string' && c[0] === '#') return c;
  return WOOD_TONES[c] || NAMED[c] || fallback;
}
const NAMED = { white: '#f4f2ee', black: '#1f2023', grey: '#8e9094', gray: '#8e9094', beige: '#d8cbb5', anthracite: '#3a3d42', chrome: '#d7dade', brass: '#c5a35a', gold: '#c9a750', copper: '#b87333', nickel: '#b9b7b0', cream: '#efe7d6', taupe: '#a39887', natural: '#cdb48f', green: '#5d7a55', blue: '#4f6d8f', terracotta: '#c2714f' };

let _woodTex = null;
function woodTexture() {
  if (_woodTex) return _woodTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 140; i++) {
    const y = Math.random() * 256;
    g.strokeStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.07})`;
    g.lineWidth = 0.5 + Math.random() * 1.6;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 2.2);
    g.stroke();
  }
  _woodTex = new THREE.CanvasTexture(c);
  _woodTex.wrapS = _woodTex.wrapT = THREE.RepeatWrapping;
  _woodTex.colorSpace = THREE.SRGBColorSpace;
  return _woodTex;
}

/** Wood with subtle grain. tone: hex or a key of WOOD_TONES. */
export function wood(tone = 'oak', opts = {}) {
  const color = col(tone, WOOD_TONES.oak);
  const k = key('w', color, opts.roughness ?? '');
  if (_mats.has(k)) return _mats.get(k);
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: opts.roughness ?? 0.62, metalness: 0 });
  if (typeof document !== 'undefined') m.map = woodTexture();
  _mats.set(k, m);
  return m;
}
export const fabric = (color = '#b8b2a7', opts = {}) => mat(col(color), { roughness: 0.95, ...opts });
export const velvet = (color = '#5c6b5a') => mat(col(color), { roughness: 0.85 });
export const leather = (color = '#7a5236') => mat(col(color), { roughness: 0.45 });
export const metal = (color = '#2b2d31', opts = {}) => mat(col(color), { roughness: opts.roughness ?? 0.35, metalness: opts.metalness ?? 0.85 });
export const chrome = () => mat('#d9dce0', { roughness: 0.12, metalness: 1 });
export const plastic = (color = '#f1f1f1') => mat(col(color), { roughness: 0.4 });
export const ceramic = (color = '#f7f7f5') => mat(col(color), { roughness: 0.18 });
export const stone = (color = '#d9d6d0') => mat(col(color), { roughness: 0.35 });
export const lacquer = (color = '#f3f1ec') => mat(col(color), { roughness: 0.3 });
export const rattan = (color = '#c9a878') => mat(col(color), { roughness: 0.9 });
export const glass = (tint = '#cfe3ea', opacity = 0.28) => mat(tint, { roughness: 0.05, metalness: 0, opacity, depthWrite: false });
export const mirrorMat = () => mat('#dfe6ea', { roughness: 0.03, metalness: 1 });
export const water = (color = '#4fb3d9', opacity = 0.78) => mat(color, { roughness: 0.08, opacity });
export const foliage = (color = '#4f7a3d') => mat(col(color), { roughness: 0.9, flat: true });
/** Self-lit surface (lamp shades / bulbs / screens). */
export const glow = (color = '#fff1d6', intensity = 1.2) => mat(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.6 });

/** Pick a material from the common `material` param vocabulary. */
export function byMaterial(material, color, fallback = 'fabric') {
  switch (material || fallback) {
    case 'wood': case 'teak': return wood(color || (material === 'teak' ? 'teak' : 'oak'));
    case 'leather': return leather(color);
    case 'velvet': return velvet(color);
    case 'metal': case 'aluminium': return metal(color || '#3a3d42', material === 'aluminium' ? { roughness: 0.5, metalness: 0.6 } : {});
    case 'rattan': return rattan(color);
    case 'plastic': return plastic(color);
    case 'glass': return glass(color);
    case 'stone': case 'concrete': return stone(color);
    case 'ceramic': return ceramic(color);
    case 'lacquer': case 'laminate': return lacquer(color);
    case 'fabric': case 'textile': default: return fabric(color);
  }
}

// ───────────────────────── primitives ─────────────────────────
const _geo = new Map();
function cached(k, make) { if (!_geo.has(k)) _geo.set(k, make()); return _geo.get(k); }
const r3 = (v) => Math.round(v * 1000) / 1000;

function place(mesh, x, y, z) { mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }

/** Box of size (w, h, d) CENTRED at (x, y, z). */
export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const g = cached(key('b', r3(w), r3(h), r3(d)), () => new THREE.BoxGeometry(w, h, d));
  return place(new THREE.Mesh(g, material), x, y, z);
}
/** Box sitting on height y0 (its bottom), centred in x/z. Handy for furniture carcasses. */
export const boxOn = (w, h, d, material, x = 0, y0 = 0, z = 0) => box(w, h, d, material, x, y0 + h / 2, z);

/** Rounded box (soft upholstery, appliances). r = corner radius. Centred at (x, y, z). */
export function rbox(w, h, d, material, x = 0, y = 0, z = 0, r = 0.03, seg = 3) {
  const rr = Math.max(0.001, Math.min(r, w / 2 - 0.0005, h / 2 - 0.0005, d / 2 - 0.0005));
  const g = cached(key('rb', r3(w), r3(h), r3(d), r3(rr), seg), () => new RoundedBoxGeometry(w, h, d, seg, rr));
  return place(new THREE.Mesh(g, material), x, y, z);
}
export const rboxOn = (w, h, d, material, x = 0, y0 = 0, z = 0, r = 0.03) => rbox(w, h, d, material, x, y0 + h / 2, z, r);

/** Vertical cylinder (radiusTop, radiusBottom, height) centred at (x, y, z). */
export function cyl(rt, rb, h, material, x = 0, y = 0, z = 0, seg = 24) {
  const g = cached(key('c', r3(rt), r3(rb), r3(h), seg), () => new THREE.CylinderGeometry(rt, rb, h, seg));
  return place(new THREE.Mesh(g, material), x, y, z);
}
export const cylOn = (rt, rb, h, material, x = 0, y0 = 0, z = 0, seg = 24) => cyl(rt, rb, h, material, x, y0 + h / 2, z, seg);

export function sphere(r, material, x = 0, y = 0, z = 0, ws = 20, hs = 14) {
  const g = cached(key('s', r3(r), ws, hs), () => new THREE.SphereGeometry(r, ws, hs));
  return place(new THREE.Mesh(g, material), x, y, z);
}

/** Straight bar between two points (legs at an angle, frames, cords). */
export function bar(from, to, radius, material, seg = 10) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, seg), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Four legs at the corners of a w × d footprint, inset from the edge. Returns a Group. shape: 'round'|'square'|'tapered' */
export function legs4(w, d, h, material, { inset = 0.04, r = 0.02, shape = 'round', y0 = 0 } = {}) {
  const g = new THREE.Group();
  const xs = [-w / 2 + inset, w / 2 - inset], zs = [-d / 2 + inset, d / 2 - inset];
  for (const x of xs) for (const z of zs) {
    g.add(shape === 'square' ? boxOn(r * 2, h, r * 2, material, x, y0, z) : cylOn(r, shape === 'tapered' ? r * 0.55 : r, h, material, x, y0, z, 12));
  }
  return g;
}

/** Flat extruded shape from 2D points [[x, z], …] (metres) with thickness h, bottom at y0. */
export function slab(points, h, material, y0 = 0) {
  const s = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, material);
  m.position.y = y0; m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Group helper: group(a, b, c…) */
export function group(...children) { const g = new THREE.Group(); children.flat().forEach((c) => c && g.add(c)); return g; }

/** Optional real light for lamps. Kept cheap: no shadows. Views may disable these via userData.isLampLight. */
export function lampLight(color = '#ffe2b8', intensity = 1.2, distance = 5, x = 0, y = 0, z = 0) {
  const l = new THREE.PointLight(new THREE.Color(color), intensity, distance, 2);
  l.position.set(x, y, z); l.castShadow = false; l.userData.isLampLight = true;
  return l;
}

/** Deterministic pseudo-random generator (so a model looks the same every time it is rebuilt). */
export function rng(seed = 1) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
export function hashStr(str = '') { let h = 7; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 2147483647; return h; }

/** Lighten (amt > 0) or darken (amt < 0) a hex colour; amt in -1..1. */
export function shade(hex, amt) {
  const c = new THREE.Color(col(hex));
  if (amt >= 0) c.lerp(new THREE.Color('#ffffff'), amt); else c.lerp(new THREE.Color('#000000'), -amt);
  return '#' + c.getHexString();
}

// ───────────────────────── 2D symbol helpers (cm) ─────────────────────────
export const INK = 'rgba(38,40,46,0.85)';
export const INK_SOFT = 'rgba(38,40,46,0.35)';

/** Rounded rectangle path centred on (cx, cy). */
export function rr(ctx, cx, cy, w, h, r = 0) {
  const x = cx - w / 2, y = cy - h / 2; r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}
/** Fill + stroke a rounded rect. */
export function fillRR(ctx, cx, cy, w, h, r, fill, stroke = INK, lw = 1) {
  rr(ctx, cx, cy, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
export function fillCircle(ctx, cx, cy, r, fill, stroke = INK, lw = 1) {
  ctx.beginPath(); ctx.ellipse(cx, cy, r, r, 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
export function line(ctx, x1, y1, x2, y2, stroke = INK, lw = 1) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke();
}
/** A soft, plan-friendly tint of a product colour (so symbols stay light and legible on the plan). */
export function tint(hex, amt = 0.45) { return shade(hex || '#cfc9bd', amt); }
