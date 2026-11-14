/**
 * Orbit-mode interaction: picking, hover, selection (two-way with store.selection), dragging items across the floor,
 * placing new items with a translucent ghost, and the selection / hover outline.
 *
 * The outline is a mask pass (selected items → red channel, hovered item / ghost → green channel) followed by one
 * full-screen edge pass drawn over the already rendered frame. It keeps the main render untouched (native MSAA,
 * tone mapping) and costs nothing when nothing is selected or hovered.
 */
import * as THREE from 'three';
import { wallFaces, wallsHitByItem, itemAABB, isIndoors, spaceAt, inWallOrOpening } from '../core/geometry.js';
import { groundY, visibleDeep, bakeModel, LAYER_SELECTED, LAYER_HOVER } from './items.js';

const SNAP_DIST = 8;        // cm — snap to a wall face when the item edge is this close
const SNAP_PENETRATION = 14; // cm — …or has been pushed this far into it
const CLICK_SLOP = 5;       // px
const ROT_FOR_NORMAL = (nx, ny) => (ny > 0.5 ? 0 : nx < -0.5 ? 90 : ny < -0.5 ? 180 : 270);

// ───────────────────────── wall runs (merged collinear wall faces) ─────────────────────────
const _runs = new WeakMap();
/** Forget the snap targets derived from a plan (call after the plan was edited in place). */
export function invalidateWallRuns(plan) { _runs.delete(plan); }
/**
 * Wall faces merged along each straight wall line, bridging door / window openings.
 * Cached per plan object and only while its wall / opening / outline arrays are the very same arrays.
 * @returns {{ nx: number, ny: number, c: number, a0: number, a1: number }[]}  c = coordinate across, a0..a1 = extent along
 */
export function wallRuns(plan) {
  const hit = _runs.get(plan);
  if (hit && hit.walls === plan.walls && hit.openings === plan.openings && hit.outline === plan.wallOutline) return hit.runs;
  const solid = (x, y) => inWallOrOpening(x, y, plan);
  const lines = new Map();
  for (const f of wallFaces(plan)) {
    const vertical = f.nx !== 0;
    const c = vertical ? f.x1 : f.y1;
    const a0 = vertical ? Math.min(f.y1, f.y2) : Math.min(f.x1, f.x2), a1 = vertical ? Math.max(f.y1, f.y2) : Math.max(f.x1, f.x2);
    const key = `${f.nx}|${f.ny}|${c}`;
    if (!lines.has(key)) lines.set(key, { nx: f.nx, ny: f.ny, c, segs: [] });
    lines.get(key).segs.push([a0, a1]);
  }
  const runs = [];
  for (const { nx, ny, c, segs } of lines.values()) {
    segs.sort((p, q) => p[0] - q[0]);
    let cur = null;
    for (const [a0, a1] of segs) {
      const mid = cur ? (cur.a1 + a0) / 2 : 0;
      const bridged = cur && (a0 - cur.a1 <= 1 || (nx ? solid(c - nx * 2, mid) : solid(mid, c - ny * 2)));
      if (bridged) cur.a1 = Math.max(cur.a1, a1);
      else { cur = { nx, ny, c, a0, a1 }; runs.push(cur); }
    }
  }
  _runs.set(plan, { walls: plan.walls, openings: plan.openings, outline: plan.wallOutline, runs });
  return runs;
}

/** Slide a wall-mounted item along the wall run nearest to (x, y): back against the wall, centred within the run. */
function slideOnWall(item, x, y, plan) {
  let best = null;
  for (const r of wallRuns(plan)) {
    const along = r.nx ? y : x, across = r.nx ? x : y;
    const a = Math.max(r.a0, Math.min(r.a1, along));
    const dist = Math.hypot(along - a, across - r.c);
    if (!best || dist < best.dist) best = { r, dist, along: a };
  }
  if (!best) return { x, y };
  const { r } = best, half = item.w / 2;
  const a = r.a1 - r.a0 >= item.w ? Math.max(r.a0 + half, Math.min(r.a1 - half, best.along)) : (r.a0 + r.a1) / 2;
  const off = item.d / 2;
  return r.nx
    ? { x: r.c + r.nx * off, y: a, rot: ROT_FOR_NORMAL(r.nx, 0) }
    : { x: a, y: r.c + r.ny * off, rot: ROT_FOR_NORMAL(0, r.ny) };
}

/** Snap a floor item's bounding box to nearby wall faces. */
function snapToWalls(item, x, y, plan) {
  const bb = itemAABB({ ...item, x, y });
  const hx = bb.w / 2, hy = bb.h / 2;
  let bx = null, by = null;
  for (const r of wallRuns(plan)) {
    if (r.nx) {
      if (y + hy < r.a0 + 2 || y - hy > r.a1 - 2) continue;
      const gapCm = (x - r.nx * hx - r.c) * r.nx;
      if (gapCm > SNAP_DIST || gapCm < -SNAP_PENETRATION) continue;
      if (!bx || Math.abs(gapCm) < Math.abs(bx.gap)) bx = { gap: gapCm, v: r.c + r.nx * hx };
    } else {
      if (x + hx < r.a0 + 2 || x - hx > r.a1 - 2) continue;
      const gapCm = (y - r.ny * hy - r.c) * r.ny;
      if (gapCm > SNAP_DIST || gapCm < -SNAP_PENETRATION) continue;
      if (!by || Math.abs(gapCm) < Math.abs(by.gap)) by = { gap: gapCm, v: r.c + r.ny * hy };
    }
  }
  return { x: bx ? bx.v : x, y: by ? by.v : y };
}

/** Push an item's bounding box out of the walls it overlaps; null if it cannot be freed with a small move. */
function pushOutOfWalls(item, x, y, plan) {
  for (let i = 0; i < 4; i++) {
    const probe = { ...item, x, y };
    const hits = wallsHitByItem(probe, plan);
    if (!hits.length) return { x, y };
    const bb = itemAABB(probe), w = hits[0];
    const left = bb.x + bb.w - w.x, right = w.x + w.w - bb.x, up = bb.y + bb.h - w.y, down = w.y + w.h - bb.y;
    const m = Math.min(left, right, up, down);
    if (m > 60) return null;
    if (m === left) x -= left; else if (m === right) x += right; else if (m === up) y -= up; else y += down;
  }
  return wallsHitByItem({ ...item, x, y }, plan).length ? null : { x, y };
}

// ───────────────────────── outline ─────────────────────────
function createOutline(accent) {
  const target = new THREE.WebGLRenderTarget(4, 4, { samples: 4, depthBuffer: false });
  const flat = (color, blending) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, fog: false, toneMapped: false, blending, side: THREE.DoubleSide });
  const selMat = flat(0xff0000, THREE.NoBlending), hovMat = flat(0x00ff00, THREE.AdditiveBlending);
  const srgb = (hex) => new THREE.Vector3().fromArray(new THREE.Color(hex).convertLinearToSRGB().toArray());
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { tMask: { value: target.texture }, texel: { value: new THREE.Vector2() }, px: { value: 1 }, selColor: { value: srgb(accent) }, hovColor: { value: srgb('#ffffff') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tMask; uniform vec2 texel; uniform float px; uniform vec3 selColor; uniform vec3 hovColor;
      varying vec2 vUv;
      void main() {
        vec2 c = texture2D(tMask, vUv).rg, mx = c, mn = c, far = vec2(0.0);
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.785398;
          vec2 d = vec2(cos(a), sin(a)) * texel * px;
          vec2 s = texture2D(tMask, vUv + d * 1.35).rg;
          mx = max(mx, s); mn = min(mn, s);
          far += texture2D(tMask, vUv + d * 4.5).rg;
        }
        far /= 8.0;
        vec2 line = clamp((mx - mn) * 1.25, 0.0, 1.0);
        float halo = far.r * (1.0 - c.r);
        float selA = max(line.r, halo * 0.34) + c.r * 0.05;
        vec3 selC = mix(selColor * 0.25, selColor, line.r);
        selC = mix(selC, selColor, c.r);
        float hovA = line.g * 0.9 * (1.0 - line.r) + far.g * (1.0 - c.g) * 0.22 * (1.0 - c.r);
        vec3 hovC = mix(vec3(0.08, 0.1, 0.14), hovColor, line.g);
        float a = clamp(selA + hovA * (1.0 - selA), 0.0, 1.0);
        vec3 col = a > 0.0 ? (selC * selA + hovC * hovA * (1.0 - selA)) / a : vec3(0.0);
        gl_FragColor = vec4(col, a);
      }`,
  }));
  quad.frustumCulled = false;
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2(), clear = new THREE.Color();

  return {
    /** Draw the outline over the frame that was just rendered. `sel` / `hov`: whether those layers have content. */
    render(renderer, scene, camera, sel, hov) {
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
      quad.material.uniforms.texel.value.set(1 / size.x, 1 / size.y);
      quad.material.uniforms.px.value = renderer.getPixelRatio();
      const prev = { mask: camera.layers.mask, bg: scene.background, over: scene.overrideMaterial, auto: renderer.autoClear, alpha: renderer.getClearAlpha(), shadows: renderer.shadowMap.autoUpdate };
      renderer.getClearColor(clear);
      renderer.shadowMap.autoUpdate = false;
      scene.background = null;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.autoClear = false;
      if (sel) { camera.layers.set(LAYER_SELECTED); scene.overrideMaterial = selMat; renderer.render(scene, camera); }
      if (hov) { camera.layers.set(LAYER_HOVER); scene.overrideMaterial = hovMat; renderer.render(scene, camera); }
      camera.layers.mask = prev.mask; scene.overrideMaterial = prev.over; scene.background = prev.bg;
      renderer.setRenderTarget(null);
      renderer.render(quad, quadCam);
      renderer.autoClear = prev.auto; renderer.setClearColor(clear, prev.alpha); renderer.shadowMap.autoUpdate = prev.shadows;
    },
    dispose() { target.dispose(); quad.geometry.dispose(); quad.material.dispose(); selMat.dispose(); hovMat.dispose(); },
  };
}

// ───────────────────────── interaction ─────────────────────────
/**
 * @param {{ dom: HTMLElement, camera: THREE.Camera, scene: THREE.Scene, ctx: object, items: object, rig: object,
 *           structures: () => THREE.Object3D[], cutHeight: () => number|null,
 *           invalidate: () => void, emit: (event: string, payload: object) => void }} o
 */
export function createInteraction({ dom, camera, scene, ctx, items, rig, structures, cutHeight, invalidate, emit, clipped = null }) {
  const { store, plan, models } = ctx;
  const host = dom.parentElement || dom;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), tmp = new THREE.Vector3();
  const accent = (getComputedStyle(host).getPropertyValue('--accent') || '').trim() || '#2f7cf6';
  const outline = createOutline(accent);

  let enabled = true, overlayHidden = false;
  let hoverId = null, hoverRaf = 0, lastMove = null;
  let down = null;          // { x, y, hit, candidate, dragging, mod }
  let drag = null;          // { ids, primary, planeY, off:{id:[dx,dy]}, start:{id:{x,y,rot}}, last:{x,y,rot} }
  let placing = null;       // { partial, ghost, onDone, rot, pos, mats }

  const ghostGroup = new THREE.Group();
  ghostGroup.name = 'placing-ghost';
  scene.add(ghostGroup);

  // ───────────── picking ─────────────
  function setRay(clientX, clientY) {
    const r = dom.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  function structureHit() {
    const cut = cutHeight();
    for (const h of raycaster.intersectObjects(structures(), true)) {
      const o = h.object;
      if (!o.isMesh || !visibleDeep(o) || (clipped && clipped(h.point))) continue;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && m.transparent && m.opacity < 0.5) continue;
      let spaceId = null;
      for (let n = o; n && !spaceId; n = n.parent) spaceId = n.userData && n.userData.spaceId;
      if (cut != null && !spaceId && h.point.y > cut + 0.03) continue;
      const normal = h.face ? h.face.normal.clone().transformDirection(o.matrixWorld) : null;
      return { point: h.point, distance: h.distance, spaceId: spaceId || null, normal };
    }
    return null;
  }
  /** Intersection of the current ray with the horizontal plane at world height y, as a plan point (cm). */
  function planeHit(y) {
    plane.constant = -y;
    const hit = raycaster.ray.intersectPlane(plane, tmp);
    if (!hit || hit.distanceTo(raycaster.ray.origin) > 180) return null;
    return { x: hit.x * 100, y: hit.z * 100 };
  }
  /** Plan point (cm) on the walkable ground under a screen position (floor level indoors / on slabs, garden level outside). */
  function floorPoint(clientX, clientY) {
    setRay(clientX, clientY);
    const a = planeHit(0);
    if (!a) return null;
    const g = groundY(a.x, a.y, plan);
    if (g === 0) return a;
    const b = planeHit(g);
    return b && groundY(b.x, b.y, plan) === g ? b : a;
  }
  /**
   * What is under a screen position.
   * @returns {{ kind: 'item', id: string, point: THREE.Vector3 } | { kind: 'floor', spaceId: string|null, point: THREE.Vector3 }
   *          | { kind: 'structure', point: THREE.Vector3, normal: THREE.Vector3|null } | null}
   */
  function pick(clientX, clientY) {
    setRay(clientX, clientY);
    const it = items.raycast(raycaster, { clipped });
    const st = structureHit();
    if (it && (!st || it.distance <= st.distance + 0.01)) return { kind: 'item', id: it.id, point: it.point, normal: it.normal };
    if (st) {
      if (st.spaceId) return { kind: 'floor', spaceId: st.spaceId, point: st.point };
      if (st.normal && st.normal.y > 0.7) {
        const s = spaceAt(st.point.x * 100, st.point.z * 100, plan);
        if (s && Math.abs(st.point.y - groundY(st.point.x * 100, st.point.z * 100, plan)) < 0.12) return { kind: 'floor', spaceId: s.id, point: st.point };
      }
      return { kind: 'structure', point: st.point, normal: st.normal };
    }
    const f = floorPoint(clientX, clientY);
    if (!f) return null;
    const s = spaceAt(f.x, f.y, plan);
    return s ? { kind: 'floor', spaceId: s.id, point: new THREE.Vector3(f.x / 100, groundY(f.x, f.y, plan), f.y / 100) } : null;
  }

  // ───────────── constraints ─────────────
  const placementOf = (it) => it.placement || (models.MODEL_TYPES && models.MODEL_TYPES[it.type] && models.MODEL_TYPES[it.type].placement) || 'floor';
  /** Final pose for an item the user wants at plan (x, y). Returns { x, y, rot? } or null when there is no valid spot. */
  function constrain(item, x, y, free) {
    const sb = plan.site.bounds;
    x = Math.max(sb.x, Math.min(sb.x + sb.w, x)); y = Math.max(sb.y, Math.min(sb.y + sb.h, y));
    const placement = placementOf(item);
    if (placement === 'wall') return slideOnWall(item, x, y, plan);
    if (free) return { x, y };
    if (placement === 'floor' && store.ui.snap !== false) ({ x, y } = snapToWalls(item, x, y, plan));
    return pushOutOfWalls(item, x, y, plan);
  }

  // ───────────── hover ─────────────
  function setHover(id) {
    if (id === hoverId) return;
    hoverId = id;
    items.setMarked(LAYER_HOVER, id ? [id] : []);
    invalidate();
  }
  function updateCursor() {
    if (drag) dom.style.cursor = 'grabbing';
    else if (placing) dom.style.cursor = 'copy';
    else if (hoverId) { const it = store.getItem(hoverId); dom.style.cursor = it && !it.locked && !it.carp && store.selection.includes(hoverId) ? 'move' : 'pointer'; }
    else dom.style.cursor = '';
  }
  function hoverNow() {
    hoverRaf = 0;
    if (!enabled || !lastMove || down || drag || placing) return;
    const hit = pick(lastMove.x, lastMove.y);
    setHover(hit && hit.kind === 'item' ? hit.id : null);
    updateCursor();
  }

  // ───────────── drag ─────────────
  function beginDrag(e) {
    const ids = store.selection.filter((id) => { const it = store.getItem(id); return it && !it.locked && !it.carp; });
    const primary = store.getItem(down.hit.id);
    if (!primary || !ids.includes(primary.id)) return false;
    setRay(down.x, down.y);
    const planeY = down.hit.point.y;
    const grab = planeHit(planeY) || { x: primary.x, y: primary.y };
    const start = {};
    for (const id of ids) { const it = store.getItem(id); start[id] = { x: it.x, y: it.y, rot: it.rot || 0 }; }
    drag = { ids, primary: primary.id, planeY, off: [primary.x - grab.x, primary.y - grab.y], start, last: start[primary.id] };
    store.begin();
    setHover(null);
    emit('drag', { phase: 'start', ids });
    dragTo(e);
    return true;
  }
  function dragTo(e) {
    setRay(e.clientX, e.clientY);
    const pt = planeHit(drag.planeY);
    const primary = store.getItem(drag.primary);
    if (!pt || !primary) return;
    const want = constrain(primary, pt.x + drag.off[0], pt.y + drag.off[1], e.altKey) || drag.last;
    drag.last = { x: want.x, y: want.y, rot: want.rot ?? drag.start[drag.primary].rot };
    const s0 = drag.start[drag.primary], dx = want.x - s0.x, dy = want.y - s0.y;
    store.updateItems(drag.ids, (it) => (it.id === drag.primary
      ? { x: want.x, y: want.y, rot: drag.last.rot }
      : { x: drag.start[it.id].x + dx, y: drag.start[it.id].y + dy }), { transient: true });
  }
  function endDrag(commit) {
    if (!drag) return;
    const ids = drag.ids;
    drag = null;
    if (commit) store.commit(); else store.cancel();
    emit('drag', { phase: commit ? 'end' : 'cancel', ids });
    updateCursor();
  }

  // ───────────── placing ─────────────
  function ghostFor(partial) {
    const mats = new Map();
    const model = bakeModel(models.buildModel({ params: {}, ...partial, id: '__ghost__' }));
    model.traverse((o) => {
      o.layers.enable(LAYER_HOVER);
      if (o.isLight) o.visible = false;
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = false;
      const swap = (m) => {
        if (!mats.has(m)) { const c = m.clone(); c.transparent = true; c.opacity = Math.min(m.opacity ?? 1, 0.62); mats.set(m, c); }
        return mats.get(m);
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    const w = (partial.w || 100) / 100, d = (partial.d || 100) / 100;
    const padGeo = new THREE.PlaneGeometry(w + 0.1, d + 0.1).rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = 0.012; pad.renderOrder = 2; pad.userData.pad = true;
    const g = new THREE.Group();
    g.add(model, pad);
    g.visible = false;
    return { group: g, model, pad, dispose() { mats.forEach((m) => m.dispose()); padGeo.dispose(); padMat.dispose(); model.traverse((o) => { if (o.isMesh && o.userData.baked) o.geometry.dispose(); }); } };
  }
  function defaultElev(partial) {
    if (partial.elev != null) return partial.elev;
    return placementOf(partial) === 'ceiling' ? Math.max(0, store.project.ceilingHeight - (partial.h || 0)) : 0;
  }
  /** Resolve where a partial item would land for a screen position: { x, y, rot } or null. */
  function landing(partial, clientX, clientY, rot) {
    const pt = floorPoint(clientX, clientY);
    if (!pt || !spaceAt(pt.x, pt.y, plan)) return null;
    const probe = { w: 100, d: 100, h: 100, ...partial, rot };
    const c = constrain(probe, pt.x, pt.y, false) || (placementOf(probe) === 'wall' ? null : { x: pt.x, y: pt.y });
    return c ? { x: c.x, y: c.y, rot: c.rot ?? rot } : null;
  }
  function addAt(partial, pos) {
    return store.addItem({ ...partial, x: Math.round(pos.x * 10) / 10, y: Math.round(pos.y * 10) / 10, rot: pos.rot, elev: defaultElev(partial), zone: isIndoors(pos.x, pos.y, plan) ? 'indoor' : 'outdoor' });
  }
  function moveGhost(clientX, clientY) {
    if (!placing) return;
    placing.at = { x: clientX, y: clientY };
    const pos = landing(placing.partial, clientX, clientY, placing.rot);
    placing.pos = pos;
    const g = placing.ghost.group;
    g.visible = !!pos && !overlayHidden;
    if (pos) {
      const base = groundY(pos.x, pos.y, plan);
      g.position.set(pos.x / 100, base, pos.y / 100);
      g.rotation.y = (-pos.rot * Math.PI) / 180;
      placing.ghost.model.position.y = defaultElev(placing.partial) / 100;
    }
    invalidate();
  }
  function stopPlacing(item) {
    if (!placing) return;
    const p = placing; placing = null;
    ghostGroup.remove(p.ghost.group); p.ghost.dispose();
    updateCursor(); invalidate();
    emit('placing', { active: false, item: item || null });
    if (p.onDone) p.onDone(item || null);
  }

  // ───────────── pointer / keyboard ─────────────
  const dist = (e) => Math.hypot(e.clientX - down.x, e.clientY - down.y);
  function onDown(e) {
    if (!enabled || e.button !== 0 || e.isPrimary === false || e.target !== dom) return;
    const mod = e.shiftKey || e.ctrlKey || e.metaKey;
    const hit = placing ? null : pick(e.clientX, e.clientY);
    down = { x: e.clientX, y: e.clientY, hit, mod, candidate: false, id: e.pointerId };
    if (hit && hit.kind === 'item' && !mod && store.selection.includes(hit.id)) {
      const it = store.getItem(hit.id);
      // carpentry units (item.carp) are made to measure: selectable, never dragged here (docs/CONTRACT.md § 8)
      if (it && !it.locked && !it.carp) { down.candidate = true; down.heldControls = true; rig.controls.enabled = false; }
    }
  }
  function onMove(e) {
    if (!enabled) return;
    if (down && down.candidate && e.pointerId === down.id) {
      if (!drag && dist(e) > CLICK_SLOP - 1 && !beginDrag(e)) down.candidate = false;
      else if (drag) dragTo(e);
      updateCursor();
      return;
    }
    if (e.target !== dom && !placing) { if (hoverId && !down) { lastMove = null; setHover(null); updateCursor(); } return; }
    if (placing) { if (e.target === dom) moveGhost(e.clientX, e.clientY); return; }
    lastMove = { x: e.clientX, y: e.clientY };
    if (!down && !hoverRaf) hoverRaf = requestAnimationFrame(hoverNow);
  }
  function onUp(e) {
    if (!down || e.pointerId !== down.id) return;
    const d = down, moved = dist(e);
    down = null;
    if (d.heldControls) rig.controls.enabled = true;
    if (drag) { endDrag(e.type !== 'pointercancel'); return; }
    if (!enabled || e.type === 'pointercancel' || moved > CLICK_SLOP) return;
    if (placing) {
      moveGhost(e.clientX, e.clientY);
      if (placing.pos) stopPlacing(addAt(placing.partial, placing.pos));
      return;
    }
    const hit = d.hit;
    if (hit && hit.kind === 'item') {
      if (d.mod) store.toggleSelect(hit.id); else store.select([hit.id]);
    } else {
      if (!d.mod) store.clearSelection();
      if (hit && hit.kind === 'floor' && hit.spaceId) store.setUI({ activeSpace: hit.spaceId });
    }
    emit('select', { ids: store.selection.slice(), spaceId: hit && hit.kind === 'floor' ? hit.spaceId : null });
    updateCursor();
  }
  function onDblClick(e) {
    if (!enabled || placing || e.target !== dom) return;
    const hit = pick(e.clientX, e.clientY);
    if (!hit) return;
    if (hit.kind === 'item' && items.boxOf(hit.id)) rig.focusPoint(items.boxOf(hit.id).getCenter(new THREE.Vector3()));
    else rig.focusPoint(hit.point);
  }
  function onKey(e) {
    if (!enabled) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.code === 'Escape' && (drag || placing)) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (drag) { endDrag(false); if (down && down.heldControls) rig.controls.enabled = true; down = null; }
      else stopPlacing(null);
    } else if (e.code === 'KeyR' && placing && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      placing.rot = (placing.rot + (e.shiftKey ? 270 : 90)) % 360;
      if (placing.at) moveGhost(placing.at.x, placing.at.y);
    }
  }
  function onLeave() { lastMove = null; if (!down) { setHover(null); updateCursor(); } }

  host.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  dom.addEventListener('dblclick', onDblClick);
  dom.addEventListener('pointerleave', onLeave);
  window.addEventListener('keydown', onKey, true);

  const offSel = store.on('selection', () => { items.setMarked(LAYER_SELECTED, store.selection); invalidate(); });
  const offItems = items.onChange(() => { if (hoverId && !store.getItem(hoverId)) setHover(null); });
  items.setMarked(LAYER_SELECTED, store.selection);

  /**
   * The building surface under a screen position, ignoring furniture (finish drops paint the room, not the sofa).
   * @returns {{ surface: 'floor', spaceId: string|null } | { surface: 'wall', point: THREE.Vector3, normal: THREE.Vector3 } | null}
   */
  function surfaceAt(clientX, clientY) {
    setRay(clientX, clientY);
    const st = structureHit();
    if (st) {
      if (st.spaceId) return { surface: 'floor', spaceId: st.spaceId };
      if (st.normal && st.normal.y > 0.7) {
        const s = spaceAt(st.point.x * 100, st.point.z * 100, plan);
        return { surface: 'floor', spaceId: s ? s.id : null };
      }
      if (st.normal && Math.abs(st.normal.y) < 0.3) return { surface: 'wall', point: st.point.clone(), normal: st.normal.clone() };
      return null;
    }
    const f = floorPoint(clientX, clientY);
    const s = f && spaceAt(f.x, f.y, plan);
    return s ? { surface: 'floor', spaceId: s.id } : null;
  }

  return {
    pick, floorPoint, surfaceAt,
    /** The plan was edited: drop the cached wall snap targets (they are re-derived on the next drag). */
    refreshPlan() { invalidateWallRuns(plan); },
    /** Where a walk-mode click should take the walker: plan cm, pulled back from walls / furniture. */
    walkTarget(clientX, clientY) {
      const hit = pick(clientX, clientY);
      if (!hit) return null;
      const pt = hit.point, flat = hit.kind === 'floor' || (hit.normal && hit.normal.y > 0.7 && pt.y < groundY(pt.x * 100, pt.z * 100, plan) + 0.3);
      if (flat) return { x: pt.x * 100, y: pt.z * 100 };
      const d = raycaster.ray.direction, len = Math.hypot(d.x, d.z) || 1;
      return { x: (pt.x - (d.x / len) * 0.45) * 100, y: (pt.z - (d.z / len) * 0.45) * 100 };
    },
    /** Start placing a new item: a ghost follows the cursor, click places it, Esc cancels, R rotates. */
    startPlacing(partial, { onDone } = {}) {
      stopPlacing(null);
      if (!partial || !partial.type) { if (onDone) onDone(null); return; }
      const ghost = ghostFor(partial);
      ghostGroup.add(ghost.group);
      placing = { partial, ghost, onDone, rot: partial.rot || 0, pos: null, at: null };
      setHover(null);
      if (lastMove) moveGhost(lastMove.x, lastMove.y);
      updateCursor();
      emit('placing', { active: true, item: null });
    },
    cancelPlacing: () => stopPlacing(null),
    isPlacing: () => !!placing,
    /** One-shot placement at a screen position (HTML5 drop). */
    dropAt(clientX, clientY, partial) {
      if (!partial || !partial.type) return null;
      const pos = landing(partial, clientX, clientY, partial.rot || 0);
      return pos ? addAt(partial, pos) : null;
    },
    /** Test hook: move the placing ghost as if the pointer were at this screen position. */
    pointAt: moveGhost,
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) { if (drag) endDrag(false); stopPlacing(null); down = null; setHover(null); dom.style.cursor = ''; }
    },
    /** Hide ghost + outline (used for snapshots). */
    setOverlayHidden(h) { overlayHidden = !!h; if (placing) placing.ghost.group.visible = !h && !!placing.pos; },
    hasOverlay: () => !overlayHidden && (items.markedCount(LAYER_SELECTED) > 0 || items.markedCount(LAYER_HOVER) > 0 || (placing && placing.ghost.group.visible)),
    renderOverlay(renderer) {
      if (overlayHidden) return;
      const sel = items.markedCount(LAYER_SELECTED) > 0;
      const hov = items.markedCount(LAYER_HOVER) > 0 || !!(placing && placing.ghost.group.visible);
      if (sel || hov) outline.render(renderer, scene, camera, sel, hov);
    },
    dispose() {
      if (drag) endDrag(false);
      stopPlacing(null);
      cancelAnimationFrame(hoverRaf);
      host.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      dom.removeEventListener('dblclick', onDblClick);
      dom.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKey, true);
      offSel(); offItems();
      scene.remove(ghostGroup);
      outline.dispose();
    },
  };
}
