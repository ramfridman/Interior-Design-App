/**
 * Items layer: one Object3D per store item, kept in sync with store 'items' events.
 *
 * - Models come from ctx.models.buildModel(item) and are "baked" (static meshes merged per material) so a
 *   furnished house costs a few hundred draw calls instead of several thousand.
 * - A model is rebuilt only when type / params / size / product changed; moves and rotations just re-pose it.
 * - Lamp lights inside models (userData.isLampLight) are never rendered directly: a fixed pool of point lights
 *   is moved onto the lamps nearest to the camera, so the light count (and therefore the shader set) stays stable.
 *   When the daylight solver lights the interior, indoor lamps are solved there (lampPoints()) and the pool only
 *   serves the lamps it does not cover (garden lights). setLampsLit() switches the glowing shades / bulbs.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { spaceAt, isIndoors, itemCorners } from '../core/geometry.js';
import { itemLevel, viewOf, elevationM, GROUND } from './levels.js';

/** Layers used by the selection / hover outline mask (see interaction.js). */
export const LAYER_SELECTED = 1;
export const LAYER_HOVER = 2;
const LAMP_POOL = 8;
const LAMP_TYPES = new Set(['floor-lamp', 'table-lamp', 'pendant', 'ceiling-light', 'wall-light', 'ceiling-fan', 'outdoor-light']);

/**
 * World Y (m) of the walkable ground under a plan point: 0 on the house floor and slabs, garden level elsewhere.
 * `level` (several floors): an upper level's finished floor everywhere on that level (its floor, or the roof below).
 */
export function groundY(x, y, plan, level) {
  if (level && level !== GROUND) return plan.levelId === level ? (plan.elevation || 0) / 100 : elevationM(plan, level);   // a level view or the whole plan
  const s = spaceAt(x, y, plan);
  if (s && (s.kind === 'room' || s.kind === 'outdoor-area')) return 0;
  if (isIndoors(x, y, plan)) return 0;
  return -plan.heights.floorAboveGround / 100;
}

const signature = (it, extra) => [it.type, it.w, it.d, it.h, it.productId || '', JSON.stringify(it.params || {}), extra || ''].join('|');

/** True if the object and all its ancestors are visible. */
export function visibleDeep(o) {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

function normalised(mesh, toRoot) {
  const src = mesh.geometry;
  const g = new THREE.BufferGeometry();
  const pos = src.attributes.position;
  if (pos.isInterleavedBufferAttribute) return null;
  g.setAttribute('position', pos.clone());
  if (src.attributes.normal && !src.attributes.normal.isInterleavedBufferAttribute) g.setAttribute('normal', src.attributes.normal.clone());
  const uv = src.attributes.uv;
  g.setAttribute('uv', uv && !uv.isInterleavedBufferAttribute ? uv.clone() : new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  if (src.index) g.setIndex(src.index.clone());
  else { const idx = new Uint32Array(pos.count); for (let i = 0; i < idx.length; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
  if (!g.attributes.normal) g.computeVertexNormals();
  const m = new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
  g.applyMatrix4(m);
  if (m.determinant() < 0) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t; } }
  return g;
}

/**
 * Merge the static meshes of a model per material. Lights, lines, sprites, instanced / multi-material meshes are kept.
 * Returns a new Group (or the original model if anything looks unusual).
 */
export function bakeModel(model) {
  try {
    model.updateMatrixWorld(true);
    const toRoot = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const buckets = new Map(), keep = [];
    model.traverse((o) => {
      if (o === model || !visibleDeep(o)) return;
      const plain = o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !o.isBatchedMesh && o.material && !Array.isArray(o.material)
        && !o.material.vertexColors && o.geometry && o.geometry.attributes.position && !Object.keys(o.geometry.morphAttributes || {}).length
        && !o.userData.noMerge;
      if (plain) {
        const key = `${o.material.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.renderOrder}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(o);
      } else if (o.isMesh || o.isLight || o.isLine || o.isPoints || o.isSprite) keep.push(o);
    });
    const out = new THREE.Group();
    out.userData = { ...model.userData };
    for (const list of buckets.values()) {
      const first = list[0];
      if (list.length === 1) { keep.push(first); continue; }
      const geos = list.map((m) => normalised(m, toRoot));
      const merged = geos.every(Boolean) ? mergeGeometries(geos, false) : null;
      if (!merged) { keep.push(...list); continue; }
      const mesh = new THREE.Mesh(merged, first.material);
      mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow; mesh.renderOrder = first.renderOrder;
      mesh.userData.baked = true;
      if (first.userData.noShadow) mesh.userData.noShadow = true;
      out.add(mesh);
    }
    const mats = keep.map((o) => new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld));
    keep.forEach((o, i) => {
      for (let c = o.children.length - 1; c >= 0; c--) o.remove(o.children[c]);
      o.removeFromParent();
      mats[i].decompose(o.position, o.quaternion, o.scale);
      out.add(o);
    });
    return out;
  } catch (e) {
    return model;
  }
}

function disposeBaked(root) {
  root.traverse((o) => { if (o.isMesh && o.userData.baked) o.geometry.dispose(); });
}

/**
 * @param {{ scene: THREE.Scene, ctx: object, invalidate: () => void }} o
 */
export function createItemsLayer({ scene, ctx, invalidate }) {
  const { store, plan, models } = ctx;
  const group = new THREE.Group();
  group.name = 'items';
  scene.add(group);

  /** @type {Map<string, { id: string, root: THREE.Group, sig: string, lamps: object[], box: THREE.Box3 }>} */
  const entries = new Map();
  const marks = { [LAYER_SELECTED]: new Set(), [LAYER_HOVER]: new Set() };
  const listeners = new Set();
  let materialHook = null;                                             // daylight: patches item materials for the probe field
  let viewHidden = new Set();                                          // hidden by the view only (carpentry section cut)
  let variant = null;                                                  // (item) => { key, view? } | null: extra build state (carpentry)
  let levelShown = null, levelKey = null;                              // (levelId) => boolean | null: items of hidden levels are hidden
  const variantOf = (item) => { try { return variant ? variant(item) : null; } catch (e) { return null; } };
  const notify = () => listeners.forEach((fn) => fn());

  // ───────────── lamp light pool ─────────────
  const pool = [];
  let lampsOn = false, lampGain = 1, lampsLit = true;
  /** Glowing materials of lamp models: emissiveIntensity follows the lights switch (base kept in userData). */
  function applyGlow(entry) {
    for (const m of entry.glow) m.emissiveIntensity = lampsLit ? m.userData.lampEmissive : 0;
  }
  for (let i = 0; i < LAMP_POOL; i++) {
    const l = new THREE.PointLight(0xffe2b8, 0, 5, 2);
    l.visible = false; l.castShadow = false;
    group.add(l); pool.push(l);
  }
  const _p = new THREE.Vector3();

  function applyMarks(entry) {
    for (const layer of [LAYER_SELECTED, LAYER_HOVER]) {
      const on = marks[layer].has(entry.id);
      entry.root.traverse((o) => { if (on) o.layers.enable(layer); else o.layers.disable(layer); });
    }
  }

  function build(item) {
    const root = new THREE.Group();
    root.userData.itemId = item.id;
    const v = variantOf(item);
    const model = bakeModel(models.buildModel(v && v.view ? { ...item, view: v.view } : item));
    const lamps = [], glow = new Set();
    model.traverse((o) => {
      if (o.isLight && o.userData.isLampLight) { lamps.push({ light: o, intensity: o.intensity }); o.visible = false; }
    });
    if (LAMP_TYPES.has(item.type)) model.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || !('emissiveIntensity' in m)) continue;
        if (m.userData.lampEmissive === undefined) { if (!(m.emissiveIntensity > 0) || !m.emissive || m.emissive.getHex() === 0) continue; m.userData.lampEmissive = m.emissiveIntensity; }
        glow.add(m);
      }
    });
    root.add(model);
    if (materialHook) root.traverse((o) => { if (o.isMesh && o.material) materialHook(o.material); });
    const entry = { id: item.id, type: item.type, root, sig: signature(item, v && v.key), lamps, glow: [...glow], box: new THREE.Box3() };
    applyGlow(entry);
    return entry;
  }

  function pose(entry, item) {
    const level = itemLevel(item, plan, store);                         // several floors: Y += the level's elevation
    const base = level === GROUND ? groundY(item.x, item.y, plan) : groundY(item.x, item.y, plan, level);
    entry.level = level;
    entry.root.position.set(item.x / 100, base + (item.elev || 0) / 100, item.y / 100);
    entry.root.rotation.y = (-(item.rot || 0) * Math.PI) / 180;
    entry.root.visible = !item.hidden && !viewHidden.has(item.id) && !(levelShown && !levelShown(level));
    entry.root.updateMatrixWorld(true);
    const b = entry.box.makeEmpty();
    for (const [cx, cy] of itemCorners(item)) {
      b.expandByPoint(_p.set(cx / 100, entry.root.position.y, cy / 100));
      b.expandByPoint(_p.set(cx / 100, entry.root.position.y + Math.max(1, item.h) / 100, cy / 100));
    }
  }

  function add(item) {
    const entry = build(item);
    entries.set(item.id, entry);
    group.add(entry.root);
    pose(entry, item);
    applyMarks(entry);
  }
  function remove(id) {
    const entry = entries.get(id);
    if (!entry) return;
    group.remove(entry.root);
    disposeBaked(entry.root);
    entries.delete(id);
  }
  function refresh(item) {
    const entry = entries.get(item.id);
    if (!entry) return add(item);
    const v = variantOf(item);
    if (entry.sig !== signature(item, v && v.key)) { remove(item.id); return add(item); }
    pose(entry, item);
  }
  function syncAll() {
    const alive = new Set(store.items.map((i) => i.id));
    for (const id of [...entries.keys()]) if (!alive.has(id)) remove(id);
    for (const item of store.items) refresh(item);
  }

  const offItems = store.on('items', (e) => {
    if (e.type === 'remove') e.ids.forEach(remove);
    else if (e.type === 'reset') syncAll();
    else for (const id of e.ids) { const item = store.getItem(id); if (item) refresh(item); else remove(id); }
    notify();
    invalidate();
  });

  // Ceiling-mounted items follow the ceiling when its height changes.
  let ceiling = store.project.ceilingHeight;
  const offProject = store.on('project', () => {
    const h = store.project.ceilingHeight;
    if (h === ceiling || !(h > 0)) return;
    ceiling = h;
    // (the project's ceiling is the ground floor's: ceiling items of upper levels keep theirs)
    const ids = store.items.filter((i) => i.placement === 'ceiling' && i.elev !== Math.max(0, h - i.h) && (!i.level || itemLevel(i, plan, store) === GROUND)).map((i) => i.id);
    if (ids.length) store.updateItems(ids, (i) => ({ elev: Math.max(0, h - i.h) }), { transient: true });
  });

  syncAll();

  return {
    group,
    get: (id) => entries.get(id) || null,
    has: (id) => entries.has(id),
    /** World-space bounding box of an item (analytic: footprint × height). */
    boxOf: (id) => (entries.get(id) ? entries.get(id).box : null),
    /** The plan was edited: items stand on the house floor or on garden level depending on where the walls now are. */
    refreshPlan() { for (const item of store.items) { const entry = entries.get(item.id); if (entry) pose(entry, item); } },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /**
     * Extra build state per item: `fn(item)` → { key, view? } | null. `key` joins the rebuild signature; `view` is passed to
     * the model as `item.view` (never stored). Used by the carpentry view (run spec / worktops, open fronts).
     */
    setVariant(fn) { variant = typeof fn === 'function' ? fn : null; },
    /** Several floors: `fn(levelId)` → false hides the items of that level (levels above the one shown); null shows all. `key`: same key = no change. */
    setLevelFilter(fn, key = null) {
      const next = typeof fn === 'function' ? fn : null;
      if (!next && !levelShown) return;
      if (next && levelShown && key != null && key === levelKey) return;
      levelShown = next; levelKey = next ? key : null;
      for (const item of store.items) { const entry = entries.get(item.id); if (entry) pose(entry, item); }
      notify(); invalidate();
    },
    /** Level id an item is drawn on ('L0' …). */
    levelOf: (id) => (entries.get(id) ? entries.get(id).level : GROUND),
    /** The level view (PLAN-shaped) an item stands on. */
    planOf: (item) => viewOf(plan, itemLevel(item, plan, store)),
    /** Hide these item ids in the view only (the store is untouched); [] shows them again. */
    setViewHidden(ids) {
      const next = new Set(ids || []);
      if (next.size === viewHidden.size && [...next].every((id) => viewHidden.has(id))) return;
      viewHidden = next;
      for (const item of store.items) { const entry = entries.get(item.id); if (entry) pose(entry, item); }
      notify(); invalidate();
    },
    /** Re-check every item against its signature (rebuilds only what changed). */
    resync() { syncAll(); notify(); invalidate(); },
    /** Put exactly these item ids on an outline layer (LAYER_SELECTED / LAYER_HOVER). */
    setMarked(layer, ids) {
      const next = new Set(ids), prev = marks[layer];
      const touched = new Set([...prev, ...next]);
      marks[layer] = next;
      for (const id of touched) if (prev.has(id) !== next.has(id) && entries.has(id)) applyMarks(entries.get(id));
    },
    /** Number of rendered items currently on a layer. */
    markedCount(layer) { let n = 0; for (const id of marks[layer]) { const e = entries.get(id); if (e && e.root.visible) n++; } return n; },
    /**
     * Nearest item under a ray. Cheap: tests each item's box first, then only the meshes of candidates.
     * @returns {{ id: string, point: THREE.Vector3, distance: number, normal: THREE.Vector3|null }|null}
     */
    raycast(raycaster, { skip, clipped } = {}) {
      if (!group.visible) return null;
      let best = null;
      const hits = [];
      for (const entry of entries.values()) {
        if (!entry.root.visible || (skip && skip.has(entry.id))) continue;
        if (!raycaster.ray.intersectsBox(entry.box)) continue;
        hits.length = 0;
        raycaster.intersectObject(entry.root, true, hits);
        const h = hits.find((x) => x.object.isMesh && !(clipped && clipped(x.point)));
        if (h && (!best || h.distance < best.distance)) {
          best = { id: entry.id, point: h.point.clone(), distance: h.distance, normal: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null };
        }
      }
      return best;
    },
    setLampGain(g) { lampGain = g; },
    /** `fn(material)` is called for every mesh material of every item (now and on each build); null removes it. */
    setMaterialHook(fn) {
      materialHook = typeof fn === 'function' ? fn : null;
      if (materialHook) for (const entry of entries.values()) entry.root.traverse((o) => { if (o.isMesh && o.material) materialHook(o.material); });
    },
    /** Lights switched on (true) or off: the glowing parts of every lamp model follow. */
    setLampsLit(on) {
      if (lampsLit === !!on) return;
      lampsLit = !!on;
      for (const entry of entries.values()) applyGlow(entry);
      invalidate();
    },
    /** Bulb positions (world m) of every visible, switched-on lamp model: [{ id, points: [[x, y, z], …] }]. */
    lampPoints() {
      const out = [];
      if (!group.visible) return out;
      for (const entry of entries.values()) {
        if (!entry.root.visible || !entry.lamps.length) continue;
        out.push({ id: entry.id, points: entry.lamps.map((l) => l.light.getWorldPosition(_p).toArray()) });
      }
      return out;
    },
    /**
     * Enable / disable lamp lighting and move the pool onto the lamps nearest to the camera.
     * `skip(id, x, y, z)` → true leaves a lamp to another renderer (the daylight solver lights indoor lamps).
     */
    updateLamps(camera, enabled, skip = null) {
      const cands = [];
      if (enabled && group.visible) {
        for (const entry of entries.values()) {
          if (!entry.root.visible) continue;
          for (const lamp of entry.lamps) {
            lamp.light.getWorldPosition(_p);
            if (skip && skip(entry.id, _p.x, _p.y, _p.z)) continue;
            cands.push({ lamp, x: _p.x, y: _p.y, z: _p.z, d: _p.distanceToSquared(camera.position) });
          }
        }
        cands.sort((a, b) => a.d - b.d);
      }
      const n = Math.min(LAMP_POOL, cands.length);
      lampsOn = n > 0;
      pool.forEach((l, i) => {
        l.visible = i < n;
        if (i >= n) return;
        const c = cands[i], src = c.lamp.light;
        l.position.set(c.x, c.y, c.z);
        l.color.copy(src.color); l.intensity = c.lamp.intensity * lampGain; l.distance = src.distance; l.decay = src.decay;
      });
    },
    lampsOn: () => lampsOn,
    count: () => entries.size,
    dispose() {
      offItems(); offProject();
      for (const id of [...entries.keys()]) remove(id);
      scene.remove(group);
      listeners.clear();
    },
  };
}
