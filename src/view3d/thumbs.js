/**
 * Catalogue thumbnails rendered from the real 3D models.
 *
 *   getThumbnail(productOrItem, size = 176) → Promise<string>   // PNG data URL, transparent background
 *
 * One small shared WebGLRenderer serves every thumbnail (its own GL context, so the main view is never touched).
 * Requests go through a FIFO queue that is drained in idle time with a ≤ 6 ms budget per slice, and results are
 * cached in memory by id + params + dimensions. Finishes ('floor-finish' / 'wall-finish') render as a material
 * swatch tile using textures.js (flat colour if that module is unavailable).
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildModel, drawSymbol, loadModels } from '../models/index.js';
import { framePoints } from './camera.js';

const BUDGET_MS = 6;
const FINISHES = new Set(['floor-finish', 'wall-finish']);
const cache = new Map();
const queue = [];
let studio = null, studioBroken = false, scheduled = false, prep = null, textures = null;

/** Normalise a catalogue product or a store item into the minimal item buildModel() needs. */
function toItem(src) {
  const dims = src.dims || src;
  return {
    id: `thumb:${src.id || src.productId || src.type}`, type: src.type, params: src.params || {},
    w: dims.w > 0 ? dims.w : 100, d: dims.d > 0 ? dims.d : 100, h: dims.h > 0 ? dims.h : 100,
    placement: src.placement || 'floor',
  };
}
const keyOf = (src, size) => { const it = toItem(src); return `${it.id}|${JSON.stringify(it.params)}|${it.w}x${it.d}x${it.h}|${size}`; };

function createStudio() {
  const canvas = document.createElement('canvas');
  let gl = null;
  try { gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true, depth: true, stencil: false, preserveDrawingBuffer: false }); } catch (e) { gl = null; }
  if (!gl) return null;
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, alpha: true, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.55;
  room.dispose(); pmrem.dispose();

  const key = new THREE.DirectionalLight('#fff6ea', 2.3), fill = new THREE.DirectionalLight('#e8f0ff', 0.7), hemi = new THREE.HemisphereLight('#ffffff', '#d8d2c8', 0.75);
  const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 200);
  scene.add(hemi, camera);
  camera.add(key, key.target, fill, fill.target);   // lights travel with the camera: same look for every model
  key.position.set(-2.2, 3.4, 2.5); fill.position.set(3, 0.6, 1.5);
  key.target.position.set(0, 0, -6); fill.target.position.set(0, 0, -6);

  // Soft contact shadow: a radial-gradient blob under the model.
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.42)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.16)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false }));
  blob.renderOrder = -1;
  scene.add(blob);

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (studio && studio.canvas === canvas) studio = null; });
  return { canvas, renderer, scene, camera, blob };
}

/** Aim the studio camera at `box` from (theta, phi), framed tightly with a little margin. */
function frame(camera, box, theta, phi, margin) {
  const pts = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  const { target, radius } = framePoints(pts, theta, phi, camera.fov, 1, margin);
  camera.position.setFromSphericalCoords(radius, phi, theta).add(target);
  camera.lookAt(target);
}

function shoot(s, px) {
  s.renderer.setSize(px, px, false);
  s.renderer.render(s.scene, s.camera);
  return s.canvas.toDataURL('image/png');
}

function renderModel(s, src, px) {
  const item = toItem(src);
  const model = buildModel(item);
  model.traverse((o) => { if (o.isLight) o.visible = false; });
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) box.set(new THREE.Vector3(-item.w / 200, 0, -item.d / 200), new THREE.Vector3(item.w / 200, item.h / 100, item.d / 200));
  const size = box.getSize(new THREE.Vector3());
  const flat = size.y < Math.max(size.x, size.z) * 0.12;
  s.scene.add(model);
  frame(s.camera, box, THREE.MathUtils.degToRad(-34), THREE.MathUtils.degToRad(flat ? 48 : 68), 1.13);
  const grounded = item.placement === 'floor' || item.placement === 'surface';
  s.blob.visible = grounded && !flat;
  s.blob.position.set((box.min.x + box.max.x) / 2, box.min.y + 0.002, (box.min.z + box.max.z) / 2);
  s.blob.scale.set(size.x * 1.45 + 0.05, 1, size.z * 1.45 + 0.05);
  // lamps always look lit here: the 3D view's lights switch dims the glowing shades / bulbs by changing the shared
  // (cached) materials in place (items.js, base kept in userData.lampEmissive) — put the glow back for this shot only
  const dimmed = new Map();
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m && m.userData && m.userData.lampEmissive !== undefined && m.emissiveIntensity !== m.userData.lampEmissive && !dimmed.has(m)) {
        dimmed.set(m, m.emissiveIntensity); m.emissiveIntensity = m.userData.lampEmissive;
      }
    }
  });
  let url;
  try { url = shoot(s, px); } finally { for (const [m, v] of dimmed) m.emissiveIntensity = v; }
  s.scene.remove(model);
  return url;
}

function renderFinish(s, src, px) {
  const params = src.params || {}, floor = src.type === 'floor-finish';
  let material = null;
  try { if (textures) material = floor ? textures.floorMaterial(params) : textures.wallMaterial(params); } catch (e) { material = null; }
  const own = !material;
  if (own) material = new THREE.MeshStandardMaterial({ color: params.color || '#cfcac0', roughness: 1 - Math.min(0.8, (params.gloss ?? 0.2) * 0.9) });
  const S = 1.5, r = 0.09, shape = new THREE.Shape();
  shape.moveTo(r, 0); shape.lineTo(S - r, 0); shape.quadraticCurveTo(S, 0, S, r); shape.lineTo(S, S - r); shape.quadraticCurveTo(S, S, S - r, S);
  shape.lineTo(r, S); shape.quadraticCurveTo(0, S, 0, S - r); shape.lineTo(0, r); shape.quadraticCurveTo(0, 0, r, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false, curveSegments: 6 });   // UVs = metres, as textures.js expects
  // textures.js wall materials multiply by vertex colours (house.js bakes soft shading there): plain white here.
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
  if (floor) geo.rotateX(-Math.PI / 2);
  const tile = new THREE.Mesh(geo, material);
  const box = new THREE.Box3().setFromObject(tile);
  s.scene.add(tile);
  frame(s.camera, box, THREE.MathUtils.degToRad(floor ? -28 : -30), THREE.MathUtils.degToRad(floor ? 40 : 76), 1.1);
  s.blob.visible = true;
  s.blob.position.set((box.min.x + box.max.x) / 2, box.min.y - 0.01, (box.min.z + box.max.z) / 2);
  s.blob.scale.set(S * 1.5, 1, floor ? S * 1.5 : 0.7);
  const url = shoot(s, px);
  s.scene.remove(tile);
  geo.dispose();
  if (own) material.dispose();
  return url;
}

/** 2D fallback when WebGL is unavailable: the plan symbol (or a colour chip for finishes). */
function renderFallback(src, px) {
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d');
  if (FINISHES.has(src.type)) {
    g.fillStyle = (src.params && src.params.color) || '#cfcac0';
    g.beginPath(); g.roundRect ? g.roundRect(px * 0.12, px * 0.12, px * 0.76, px * 0.76, px * 0.06) : g.rect(px * 0.12, px * 0.12, px * 0.76, px * 0.76); g.fill();
    return c.toDataURL('image/png');
  }
  const item = toItem(src), k = (px * 0.8) / Math.max(item.w, item.d);
  g.translate(px / 2, px / 2); g.scale(k, k);
  drawSymbol(g, item, 1 / k);
  return c.toDataURL('image/png');
}

function run(job) {
  try {
    if (!studio && !studioBroken) { studio = createStudio(); studioBroken = !studio; }
    const px = Math.round(job.size * Math.min(window.devicePixelRatio || 1, 2));
    if (!studio) return job.resolve(renderFallback(job.src, px));
    job.resolve(FINISHES.has(job.src.type) ? renderFinish(studio, job.src, px) : renderModel(studio, job.src, px));
  } catch (e) {
    console.error('[thumbs] could not render', job.src && job.src.id, e);
    try { job.resolve(renderFallback(job.src, job.size)); } catch (e2) { job.resolve(''); }
  }
}

function pump() {
  scheduled = false;
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < BUDGET_MS) run(queue.shift());
  if (queue.length) schedule();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  if (typeof requestIdleCallback === 'function') requestIdleCallback(pump, { timeout: 150 });
  else setTimeout(pump, 16);
}

/**
 * Thumbnail of a catalogue product or a placed item, rendered from its 3D model.
 * @param {object} productOrItem  catalogue product ({ id, type, dims, params }) or store item ({ type, w, d, h, params })
 * @param {number} [size=176]     CSS pixels (the PNG is rendered at up to 2× for sharp displays)
 * @returns {Promise<string>}     PNG data URL ('' if nothing could be drawn)
 */
export function getThumbnail(productOrItem, size = 176) {
  if (!productOrItem || !productOrItem.type) return Promise.resolve('');
  const key = keyOf(productOrItem, size);
  if (cache.has(key)) return cache.get(key);
  if (!prep) prep = Promise.all([loadModels().catch(() => false), import('./textures.js').then((m) => { textures = m; }).catch(() => { textures = null; })]);
  const promise = new Promise((resolve) => {
    prep.then(() => { queue.push({ src: productOrItem, size, resolve }); schedule(); });
  });
  cache.set(key, promise);
  return promise;
}
