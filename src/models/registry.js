/**
 * Model registry. Each model module calls registerModel(type, def) at import time.
 *
 *   registerModel('sofa', {
 *     // REQUIRED. Returns a THREE.Object3D in METRES:
 *     //   x ∈ [-w/2, w/2], z ∈ [-d/2, d/2], y ∈ [0, h]   (origin = centre of the footprint, on the floor)
 *     //   FRONT of the object faces +Z, BACK is at -Z (the side that goes against a wall).
 *     //   The model MUST fill exactly the w × d × h box it is given (that is how real product
 *     //   dimensions are honoured). p = params (may be {}), never mutate it.
 *     build({ w, d, h, p, item }) { … return group; },
 *
 *     // REQUIRED. Top-view plan symbol, drawn in CENTIMETRES with the origin at the footprint centre,
 *     // +x = width, +y = FRONT (so the back edge is at y = -d/2). The context is already translated/rotated.
 *     // `px` = size of one screen pixel in cm (use ctx.lineWidth = px for hairlines).
 *     // Draw fills + strokes; the 2D view draws selection, labels and shadows itself.
 *     draw2d(ctx, { w, d, h, p, px, item }) { … },
 *   });
 */
import * as THREE from 'three';
import { MODEL_TYPES } from './types.js';

const REGISTRY = new Map();

export function registerModel(type, def) {
  if (!MODEL_TYPES[type]) console.warn(`[models] "${type}" is not declared in types.js`);
  REGISTRY.set(type, def);
}

export const hasModel = (type) => REGISTRY.has(type);
export const getModel = (type) => REGISTRY.get(type) || null;
export const registeredTypes = () => [...REGISTRY.keys()];

function fallbackBox(w, d, h, color = '#b9b4aa') {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  m.position.y = h / 2; m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return g;
}

/**
 * Build the 3D object for a store item (or a catalogue product turned into an item-like object).
 * Returned group is in metres, sits on y = 0 and is NOT yet positioned/rotated in the world.
 * Never throws: a broken or missing builder yields a plain box of the right size.
 */
export function buildModel(item) {
  const w = Math.max(0.01, (item.w || 1) / 100), d = Math.max(0.01, (item.d || 1) / 100), h = Math.max(0.005, (item.h || 1) / 100);
  const def = REGISTRY.get(item.type);
  let obj;
  if (def && def.build) {
    try { obj = def.build({ w, d, h, p: item.params || {}, item }); }
    catch (e) { console.error(`[models] build failed for "${item.type}"`, e); }
  }
  if (!obj) obj = fallbackBox(w, d, h, item.params && item.params.color);
  obj.traverse((o) => { if (o.isMesh) { if (o.userData.noShadow !== true) o.castShadow = true; o.receiveShadow = true; } });
  obj.userData.itemId = item.id;
  obj.userData.type = item.type;
  return obj;
}

/** Draw the 2D plan symbol of an item at the current transform (see contract in the header). */
export function drawSymbol(ctx, item, px = 1) {
  const def = REGISTRY.get(item.type);
  const { w, d, h } = item;
  ctx.save();
  try {
    if (def && def.draw2d) def.draw2d(ctx, { w, d, h, p: item.params || {}, px, item });
    else drawFallbackSymbol(ctx, item, px);
  } catch (e) {
    console.error(`[models] draw2d failed for "${item.type}"`, e);
    ctx.restore(); ctx.save();
    drawFallbackSymbol(ctx, item, px);
  }
  ctx.restore();
}

export function drawFallbackSymbol(ctx, item, px = 1) {
  const { w, d } = item;
  ctx.fillStyle = (item.params && item.params.color) || '#d9d4c8';
  ctx.strokeStyle = 'rgba(40,40,45,0.75)';
  ctx.lineWidth = px;
  ctx.beginPath(); ctx.rect(-w / 2, -d / 2, w, d); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-w / 2, d / 2 - Math.min(6, d * 0.2)); ctx.lineTo(w / 2, d / 2 - Math.min(6, d * 0.2)); ctx.stroke();
}
