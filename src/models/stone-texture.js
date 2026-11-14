/**
 * Worktop stone — a cheap procedural look for a chosen slab (spec.worktop.stone / spec.splashback.stone, see
 * src/carpentry/stone.js): a small seamless canvas texture painted from the slab's `hex`, `pattern` and vein colour, and a
 * roughness from its finish. It approximates the supplier's swatch; no image is shipped or loaded.
 *
 *   stoneMaterial(ref)            → shared MeshStandardMaterial (cached per slab + finish); userData.stone = { id, hex, pattern, finish, veinHex }
 *   stoneUV(geometry, ox, oy, oz) → planar UVs in metres (top faces x / z, front faces x / y, ends z / y) offset into the run's
 *                                   frame, so neighbouring pieces continue the same veins.
 * One texture covers SLAB_M × SLAB_M metres (texture.repeat = 1 / SLAB_M). Under node (no canvas) the material carries the
 * flat colour only.
 */
import * as THREE from 'three';

export const SLAB_M = 1.6;
const PX = 512;
const _mats = new Map();
/** Roughness per finish (polished stone is glossy, honed / leathered / brushed less so). Unknown finish: a mid value. */
export const FINISH_ROUGHNESS = { polished: 0.12, lapato: 0.3, satin: 0.36, velvet: 0.58, matte: 0.62, brushed: 0.55, stone: 0.56 };
const roughOf = (f) => FINISH_ROUGHNESS[f] ?? 0.34;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function rgb(hex) {
  const s = typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : 'd9d6d0';
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const shade = (c, t) => (t >= 0 ? mix(c, [255, 255, 255], t) : mix(c, [0, 0, 0], -t));
const css = (c, a = 1) => `rgba(${c.map((v) => Math.round(clamp(v, 0, 255))).join(',')},${a})`;
const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** The vein colour: the slab's own, else a contrast of the base. */
export function veinOf(ref) {
  if (ref && /^#[0-9a-f]{6}$/i.test(ref.veinHex || '')) return ref.veinHex;
  const c = rgb(ref && ref.hex), l = lum(c);
  return '#' + shade(c, l > 0.5 ? -0.32 : 0.45).map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}
const keyOf = (ref) => [ref.id || '', ref.hex, ref.pattern || 'plain', ref.veinHex || '', ref.finish || ''].join('|');

/** Draw `fn` 9 times, wrapped, so shapes crossing an edge tile seamlessly. */
function wrapped(g, fn) { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { g.save(); g.translate(i * PX, j * PX); fn(); g.restore(); } }
function clouds(g, r, base, n, alpha) {
  for (let i = 0; i < n; i++) {
    const x = r() * PX, y = r() * PX, rad = PX * (0.08 + r() * 0.22), c = shade(base, (r() - 0.5) * 0.16);
    wrapped(g, () => { const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, css(c, alpha)); gr.addColorStop(1, css(c, 0)); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); });
  }
}
function speckle(g, r, cols, n, size, alpha) {
  for (let i = 0; i < n; i++) { g.fillStyle = css(cols[Math.floor(r() * cols.length)], alpha * (0.4 + r() * 0.6)); const s = 0.6 + r() * size; g.fillRect(r() * PX, r() * PX, s, s); }
}
/** A soft vein: a wandering curve drawn as a few strokes of falling width / rising opacity. */
function vein(g, r, col, strength) {
  const pts = [], steps = 9;
  let x = r() * PX, y = r() * PX, ang = r() * Math.PI * 2;
  const len = PX * (0.7 + r() * 0.8);
  for (let i = 0; i <= steps; i++) { pts.push([x, y]); ang += (r() - 0.5) * 0.9; x += Math.cos(ang) * (len / steps); y += Math.sin(ang) * (len / steps); }
  const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); } g.stroke(); };
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const [w, a] of [[14, 0.05], [6, 0.12], [2.2, 0.32], [0.9, 0.55]]) { g.strokeStyle = css(col, a * strength); g.lineWidth = w * (0.6 + r() * 0.8); wrapped(g, path); }
}

/** Paint the slab look on a PX × PX canvas (one SLAB_M square). */
export function paintStone(ref) {
  const c = document.createElement('canvas'); c.width = PX; c.height = PX;
  const g = c.getContext('2d'), r = prng(hashStr(keyOf(ref))), base = rgb(ref.hex), vc = rgb(veinOf(ref)), p = ref.pattern || 'plain';
  g.fillStyle = css(base); g.fillRect(0, 0, PX, PX);
  if (p === 'plain') { clouds(g, r, base, 10, 0.18); speckle(g, r, [shade(base, -0.12), shade(base, 0.12)], 2600, 1.2, 0.18); }
  else if (p === 'fine-grain') {
    clouds(g, r, base, 8, 0.2);
    speckle(g, r, [shade(base, -0.28), shade(base, 0.22), vc, shade(vc, -0.2)], 16000, 2.2, 0.5);
    speckle(g, r, [shade(base, -0.45)], 3000, 1.4, 0.45);
  } else if (p === 'veined' || p === 'marble-look') {
    clouds(g, r, base, 14, 0.25);
    const n = p === 'marble-look' ? 4 : 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) vein(g, r, vc, i === 0 ? 1 : 0.55 + r() * 0.35);
    speckle(g, r, [shade(base, -0.08), shade(base, 0.08)], 1800, 1, 0.14);
  } else if (p === 'concrete') {
    clouds(g, r, base, 22, 0.35);
    speckle(g, r, [shade(base, -0.18), shade(base, 0.14)], 9000, 1.4, 0.3);
    for (let i = 0; i < 160; i++) { g.fillStyle = css(shade(base, -0.35), 0.35); g.beginPath(); g.arc(r() * PX, r() * PX, 0.5 + r() * 1.3, 0, Math.PI * 2); g.fill(); }
  } else if (p === 'terrazzo') {
    clouds(g, r, base, 8, 0.15);
    const chips = [vc, shade(vc, 0.25), shade(base, -0.3), shade(base, 0.2)];
    for (let i = 0; i < 520; i++) {
      const x = r() * PX, y = r() * PX, s = 1.5 + r() * r() * 9, col = chips[Math.floor(r() * chips.length)], k = 3 + Math.floor(r() * 3), a0 = r() * 6;
      g.fillStyle = css(col, 0.85); g.beginPath();
      for (let j = 0; j < k; j++) { const a = a0 + (j / k) * Math.PI * 2, rr = s * (0.6 + r() * 0.5); g[j ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.closePath(); g.fill();
    }
  } else clouds(g, r, base, 10, 0.18);
  return c;
}

/** Shared material of a chosen slab (cached per slab + finish, so every piece of a run uses the same one). */
export function stoneMaterial(ref) {
  const k = keyOf(ref);
  if (_mats.has(k)) return _mats.get(k);
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(ref.hex || '#d9d6d0'), roughness: roughOf(ref.finish), metalness: 0 });
  if (typeof document !== 'undefined' && document.createElement) {
    try {
      const t = new THREE.CanvasTexture(paintStone(ref));
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1 / SLAB_M, 1 / SLAB_M); t.anisotropy = 4;
      m.map = t; m.color.set('#ffffff');
    } catch (e) { /* flat colour */ }
  }
  m.userData.stone = { id: ref.id || null, hex: ref.hex, pattern: ref.pattern || 'plain', finish: ref.finish || null, veinHex: veinOf(ref) };
  _mats.set(k, m);
  return m;
}

/**
 * Planar UVs in metres by face direction: top / bottom faces (x, z), faces looking along ±z (x, y), ends (z, y); (ox, oy, oz)
 * shift the geometry's local coordinates into the run frame. Works on indexed and non-indexed geometry with per-face normals.
 */
export function stoneUV(geo, ox = 0, oy = 0, oz = 0) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const P = geo.attributes.position, N = geo.attributes.normal, uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i) + ox, y = P.getY(i) + oy, z = P.getZ(i) + oz, nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i)), nz = Math.abs(N.getZ(i));
    if (ny >= nx && ny >= nz) { uv[i * 2] = x; uv[i * 2 + 1] = z; } else if (nz >= nx) { uv[i * 2] = x; uv[i * 2 + 1] = y; } else { uv[i * 2] = z; uv[i * 2 + 1] = y; }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Free the cached stone materials and textures. */
export function disposeStoneMaterials() { for (const m of _mats.values()) { if (m.map) m.map.dispose(); m.dispose(); } _mats.clear(); }
