/**
 * Daylight in the 3D view: connects the radiosity solver (solver.js, run by engine.js in a Web Worker) to the scene.
 *
 *   const daylight = createDaylight({ ctx, renderer, scene, invalidate });
 *   daylight.attach({ house, env, items });       // house shell → lightmaps, items + openings → probe field
 *   daylight.setDoorsOpen(true);                   // walk mode: interior doors open (new visibility, cached)
 *   daylight.relight();                            // date / hour / finishes changed
 *   daylight.onPlan();                             // the plan was edited (after house.rebuildPlan())
 *   daylight.update(camera, { mode, dollhouse });  // per frame: cross-fades, eye adaptation, exposure
 *
 * How the result is drawn
 *   • Building interior (floors, walls, reveals, ceilings, skirting): every material is a clone of the finish
 *     material whose indirect irradiance (hemisphere + ambient + diffuse IBL) is REPLACED by the solved lightmap
 *     (half-float RGBA atlas, second UV set `dlUv`). Direct sun and lamps still come from the real lights, so the
 *     crisp, shadow-mapped sun patches stay — and are not counted twice (the lightmap excludes direct sun).
 *   • Furniture, door leaves, frames, glass: their (shared) materials are patched in place to read an irradiance
 *     field — a 10 cm plan-space texture of probe ambient cubes (6 directions × 2 heights), sampled 15 cm in front
 *     of each fragment along its world normal, so a sofa is brighter on its window side and darker in a dim room.
 *     The field's alpha is 0 outdoors, so garden items and the exterior keep their normal sun / sky lighting.
 *   • Exposure: walking, the eye adapts (τ ≈ 0.45 s) to the luminance predicted by the solution around the camera
 *     (no GPU read-back). The roofless dollhouse uses a fixed interior display gain so rooms stay readable.
 *   • Night: the daylight weight fades out with the sun below −3…−8°; the original night look (lamps, warm fill)
 *     takes over. Everything degrades to the original lighting if the solver fails.
 */
import * as THREE from 'three';
import { buildScene, sceneInputFromPlan, chartFor, chartUV, transferLightmap, toHalf, roomAt, airRegionAt, hexToLinear, PROBE_HEIGHTS } from './solver.js';
import { createEngine } from './engine.js';
import { finishParams } from '../house.js';

const DOLL_TARGET = 0.3;                         // renderer units (≈ 15 klux): mean interior irradiance shown in the dollhouse
const ADAPT_KEY = 0.13, ADAPT_POWER = 0.75, MAX_ADAPT = 20;   // eye adaptation: target luminance, partial adaptation, cap
const FADE_S = 0.45, SLIDER_FADE_S = 0.12, ADAPT_S = 0.45;
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const INTERIOR = (name) => name.startsWith('floor:') || name.startsWith('wall:room:') || name === 'ceilings' || name === 'wall:skirting';

// ───────────────────────── shader patches ─────────────────────────
const LM_VERTEX_DECL = 'attribute vec2 dlUv;\nattribute vec4 dlBox;\nvarying vec2 vDlUv;\nvarying vec4 vDlBox;\n';
const FIELD_VERTEX_DECL = 'varying vec3 vDlW;\n';
const COMMON_FRAG_DECL = /* glsl */`
uniform float dlMix; uniform float dlOn; uniform float dlGain; uniform float dlSpec;
float dlLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;
const LM_FRAG_DECL = /* glsl */`
uniform sampler2D dlMapA; uniform sampler2D dlMapB;
varying vec2 vDlUv;
varying vec4 vDlBox;     // lookup clamp: keeps bilinear filtering from reaching texels behind a wall
`;
const FIELD_FRAG_DECL = /* glsl */`
uniform sampler2D dlFieldA; uniform sampler2D dlFieldB;
uniform vec4 dlFieldBox;   // origin x, origin z, texel size (m), unused
uniform vec2 dlFieldN;     // texels per tile (x, z)
uniform vec2 dlFieldH;     // probe heights of the two layers (m)
varying vec3 vDlW;
vec4 dlTap(sampler2D t, vec2 g, float dir, float layer) {
  vec2 c = clamp(g, vec2(0.5), dlFieldN - 0.5);
  return texture2D(t, vec2((dir * dlFieldN.x + c.x) / (6.0 * dlFieldN.x), (layer * dlFieldN.y + c.y) / (2.0 * dlFieldN.y)));
}
vec4 dlCube(sampler2D t, vec2 g, float layer, vec3 n) {
  vec3 q = n * n;
  return q.x * dlTap(t, g, n.x >= 0.0 ? 0.0 : 1.0, layer) + q.y * dlTap(t, g, n.y >= 0.0 ? 2.0 : 3.0, layer) + q.z * dlTap(t, g, n.z >= 0.0 ? 4.0 : 5.0, layer);
}
vec4 dlField(vec3 p, vec3 n) {
  vec2 g = (p.xz + n.xz * 0.15 - dlFieldBox.xy) / dlFieldBox.z;
  float h = clamp((p.y - dlFieldH.x) / max(0.01, dlFieldH.y - dlFieldH.x), 0.0, 1.0);
  vec4 a = mix(dlCube(dlFieldA, g, 0.0, n), dlCube(dlFieldA, g, 1.0, n), h);
  vec4 b = mix(dlCube(dlFieldB, g, 0.0, n), dlCube(dlFieldB, g, 1.0, n), h);
  return mix(a, b, dlMix);
}
`;
/** Replace the indirect light: `W` = weight expression, `E` = irradiance expression (renderer units). */
const indirect = (W, E) => /* glsl */`
#if defined( RE_IndirectDiffuse )
{
  vec3 dlE = ${E};
  float dlW = ${W};
  irradiance = mix(irradiance, dlE, dlW);
  #if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
    iblIrradiance *= 1.0 - dlW;
  #endif
  #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
    radiance *= mix(1.0, clamp(dlLum(dlE) * dlSpec, 0.0, 1.0), dlW);
  #endif
}
#endif
`;

function patchLightmapShader(shader, U) {
  Object.assign(shader.uniforms, { dlMapA: U.dlMapA, dlMapB: U.dlMapB, dlMix: U.dlMix, dlOn: U.dlOn, dlGain: U.dlGain, dlSpec: U.dlSpec });
  shader.vertexShader = LM_VERTEX_DECL + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvDlUv = dlUv;\n\tvDlBox = dlBox;');
  // lightmap alpha = fraction of the texel the solver found in the sun. Shadow maps leak a little light along the
  // wall / ceiling junctions (normal bias); the eye-adapted interior exposure would show those leaks as bright lines,
  // so on lit-by-lightmap surfaces the sun is masked where the solver says no sun can reach.
  const begin = THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= dlSunMask;');
  shader.fragmentShader = COMMON_FRAG_DECL + LM_FRAG_DECL + shader.fragmentShader
    .replace('#include <lights_fragment_begin>', 'vec2 dlUvC = clamp(vDlUv, vDlBox.xy, vDlBox.zw);\nvec4 dlTexel = mix(texture2D(dlMapA, dlUvC), texture2D(dlMapB, dlUvC), dlMix);\n'
      + 'float dlSunMask = mix(1.0, smoothstep(0.0, 0.2, dlTexel.a), dlOn);\n' + begin)
    .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + indirect('dlOn', 'dlTexel.rgb * dlGain'));
}
function patchFieldShader(shader, U) {
  Object.assign(shader.uniforms, { dlFieldA: U.dlFieldA, dlFieldB: U.dlFieldB, dlFieldBox: U.dlFieldBox, dlFieldN: U.dlFieldN, dlFieldH: U.dlFieldH, dlMix: U.dlFieldMix, dlOn: U.dlOn, dlGain: U.dlGain, dlSpec: U.dlSpec });
  shader.vertexShader = FIELD_VERTEX_DECL + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
	vec4 dlWp = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		dlWp = batchingMatrix * dlWp;
	#endif
	#ifdef USE_INSTANCING
		dlWp = instanceMatrix * dlWp;
	#endif
	vDlW = ( modelMatrix * dlWp ).xyz;`);
  shader.fragmentShader = COMMON_FRAG_DECL + FIELD_FRAG_DECL + shader.fragmentShader.replace('#include <lights_fragment_maps>',
    '#include <lights_fragment_maps>\nvec4 dlF = dlField(vDlW, normalize(inverseTransformDirection(normal, viewMatrix)));\n' + indirect('dlOn * clamp(dlF.a, 0.0, 1.0)', 'dlF.rgb * dlGain'));
}

// ───────────────────────── textures ─────────────────────────
function halfTexture(w, h, data) {
  const t = new THREE.DataTexture(data || new Uint16Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.NoColorSpace; t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/** Cross-faded pair of textures (A shown at mix 0, B at mix 1). */
class FadePair {
  constructor(uA, uB, uMix) { this.uA = uA; this.uB = uB; this.uMix = uMix; this.w = 0; this.h = 0; this.fade = 0; this.target = 1; }
  /** Replace both with `data` (no fade). */
  reset(w, h, data) {
    this.dispose();
    this.w = w; this.h = h;
    this.uA.value = halfTexture(w, h, data.slice());
    this.uB.value = halfTexture(w, h, data);
    this.uMix.value = 1; this.fade = 0;
  }
  /** Fade from what is shown now to `data` over `seconds`. */
  push(w, h, data, seconds) {
    if (w !== this.w || h !== this.h || !this.uA.value) { this.reset(w, h, data); return; }
    if (this.uMix.value >= 0.5) { const t = this.uA.value; this.uA.value = this.uB.value; this.uB.value = t; }
    const b = this.uB.value;
    b.image.data = data; b.needsUpdate = true;
    this.uMix.value = 0; this.fade = Math.max(0.001, seconds);
  }
  /** Advance; returns true while fading. */
  step(dt) {
    if (this.uMix.value >= 1) return false;
    this.uMix.value = Math.min(1, this.uMix.value + dt / this.fade);
    return this.uMix.value < 1;
  }
  dispose() { this.uA.value?.dispose?.(); this.uB.value?.dispose?.(); this.uA.value = null; this.uB.value = null; }
}

// ───────────────────────── controller ─────────────────────────
/**
 * @param {{ ctx: object, renderer: THREE.WebGLRenderer, scene: THREE.Scene, invalidate?: () => void }} o
 */
export function createDaylight({ ctx, renderer, scene, invalidate = () => {} }) {
  const { store, plan } = ctx;
  const U = {
    dlMapA: { value: null }, dlMapB: { value: null }, dlMix: { value: 1 },
    dlFieldA: { value: null }, dlFieldB: { value: null }, dlFieldMix: { value: 1 },
    dlFieldBox: { value: new THREE.Vector4() }, dlFieldN: { value: new THREE.Vector2(1, 1) }, dlFieldH: { value: new THREE.Vector2(PROBE_HEIGHTS[0], PROBE_HEIGHTS[1]) },
    dlOn: { value: 0 }, dlGain: { value: 1 }, dlSpec: { value: 1 },
  };
  const lm = new FadePair(U.dlMapA, U.dlMapB, U.dlMix), fieldTex = new FadePair(U.dlFieldA, U.dlFieldB, U.dlFieldMix);
  const state = {
    enabled: store.ui.daylight !== false, failed: false, ready: false, doorsOpen: true,
    on: 0, exposure: 1, adapted: null, fakeShading: true, dollGain: 1, lastT: 0, H: 0, serial: 0, layoutSerial: 0,
    lastLightmap: null, probes: null, fieldProbe: null, fieldWeight: null, fieldAlpha: null,
    timings: { scene: 0, uv: 0, coarse: null, fine: null, relight: null, relights: 0, upload: 0, firstResultMs: null },
    patches: 0, links: 0, facades: 0, coarse: true, sentAt: 0, workerMode: 'none', error: null,
  };
  let house = null, env = null, items = null, S = null;
  const lmMaterials = new Map();                                            // base material → patched clone
  const fieldPatched = new WeakSet();

  // ── engine: Web Worker, else main thread (time-sliced) ──
  let worker = null, local = null;
  const onMessage = (msg) => { try { receive(msg); } catch (e) { fail(e); } };
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => onMessage(e.data);
    worker.onerror = (e) => { e.preventDefault?.(); if (worker) { worker.terminate(); worker = null; startLocal(); } };
    state.workerMode = 'worker';
  } catch (e) { worker = null; startLocal(); }
  function startLocal() {
    if (local) return;
    local = createEngine((msg) => queueMicrotask(() => onMessage(msg)), { sliceMs: 8 });
    state.workerMode = 'main-thread';
    if (S) sendScene();
  }
  const send = (msg) => { if (worker) worker.postMessage(msg); else if (local) local.handle(msg); };
  function fail(e) {
    state.failed = true; state.error = String(e && e.message || e);
    console.warn('[view3d] daylight solver failed — falling back to the standard lighting', e);
    invalidate();
  }

  // ── geometry ──
  const ceilingCm = () => { const v = Number(store.project && store.project.ceilingHeight); return Number.isFinite(v) && v >= 200 ? Math.min(v, 600) : plan.heights.ceiling; };
  const input = () => sceneInputFromPlan(plan, { ceilingCm: ceilingCm(), doorsOpen: state.doorsOpen });
  function rebuildScene() {
    const t0 = performance.now();
    const S0 = S;
    S = buildScene(input(), { layoutOnly: true });                        // same layout as the worker's scene
    state.H = S.H; state.patches = S.patch.count;
    state.timings.scene = performance.now() - t0;
    const F = S.field;
    U.dlFieldBox.value.set(F.ox, F.oz, F.cell, 0); U.dlFieldN.value.set(F.nx, F.nz);
    // carry the old solution over to the new layout (no black frame, no pop)
    const carried = transferLightmap(S0, state.lastLightmap, S);
    lm.reset(S.atlas.width, S.atlas.height, toHalf(carried));
    state.lastLightmap = carried;
    if (!fieldTex.uA.value || fieldTex.w !== F.nx * 6 || fieldTex.h !== F.nz * 2) fieldTex.reset(F.nx * 6, F.nz * 2, new Uint16Array(F.nx * 6 * F.nz * 2 * 4));
    state.layoutSerial++;
    applyUVs();
  }
  function sendScene() {
    if (!S) return;
    state.serial++;
    state.sentAt = performance.now();
    send({ type: 'scene', serial: state.serial, input: S.input });
    relight();
  }

  /** Second UV set (`dlUv`) of an interior mesh: every triangle maps into the atlas chart of its surface. */
  function prepareMesh(mesh) {
    if (!S || !mesh || !mesh.geometry) return;
    const g = mesh.geometry, pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    if (!pos || !nor) return;
    let uv = g.getAttribute('dlUv'), box = g.getAttribute('dlBox');
    if (!uv || uv.count !== pos.count) { uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2); g.setAttribute('dlUv', uv); }
    if (!box || box.count !== pos.count) { box = new THREE.BufferAttribute(new Float32Array(pos.count * 4), 4); g.setAttribute('dlBox', box); }
    const idx = g.index ? g.index.array : null, n = idx ? idx.length : pos.count, out = [0, 0];
    const W = S.atlas.width, AH = S.atlas.height;
    const dy = mesh.name === 'ceilings' ? state.H : 0;                       // the ceiling soup sits at y = 0, moved up by its mesh
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
      const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3 + dy, cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
      const ch = chartFor(S, cx, cy, cz, nor.getX(a), nor.getY(a), nor.getZ(a));
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const v of [a, b, c]) {
        if (ch >= 0) chartUV(S, ch, pos.getX(v), pos.getY(v) + dy, pos.getZ(v), out); else { out[0] = 0; out[1] = 0; }
        uv.setXY(v, out[0], out[1]);
        u0 = Math.min(u0, out[0]); u1 = Math.max(u1, out[0]); v0 = Math.min(v0, out[1]); v1 = Math.max(v1, out[1]);
      }
      // floors / ceilings: on every edge that borders a wall (not open floor of the same room), clamp the lookup to
      // the centre of the edge texel, so bilinear filtering never mixes in the texel on the other side of the wall
      let bx0 = -1, by0 = -1, bx1 = 2, by1 = 2;
      const C = ch >= 0 ? S.charts[ch] : null;
      if (C && C.type === 'h') {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const v of [a, b, c]) { x0 = Math.min(x0, pos.getX(v)); x1 = Math.max(x1, pos.getX(v)); z0 = Math.min(z0, pos.getZ(v)); z1 = Math.max(z1, pos.getZ(v)); }
        const yy = C.normal[1] > 0 ? C.y + 0.01 : C.y - 0.01, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, e = 0.025;
        const open = (x, z) => airRegionAt(S, x, yy, z) === C.region;
        const centre = (t, size) => (Math.floor(t * size) + 0.5) / size;
        if (!open(x0 - e, mz)) bx0 = centre(u0 + 1e-6, W);
        if (!open(x1 + e, mz)) bx1 = centre(u1 - 1e-6, W);
        if (!open(mx, z0 - e)) by0 = centre(v0 + 1e-6, AH);
        if (!open(mx, z1 + e)) by1 = centre(v1 - 1e-6, AH);
        if (bx1 < bx0) bx0 = bx1 = (bx0 + bx1) / 2;
        if (by1 < by0) by0 = by1 = (by0 + by1) / 2;
      }
      for (const v of [a, b, c]) box.setXYZW(v, bx0, by0, bx1, by1);
    }
    uv.needsUpdate = true; box.needsUpdate = true;
  }
  function applyUVs() {
    const t0 = performance.now();
    if (house && house.forEachInterior) house.forEachInterior((name, mesh) => prepareMesh(mesh));
    state.timings.uv = performance.now() - t0;
  }

  /** Patched clone of a finish material for lightmapped interior surfaces. */
  function lightmapMaterial(base) {
    if (!base || !base.isMeshStandardMaterial) return base;
    let m = lmMaterials.get(base);
    if (m) return m;
    m = base.clone();
    m.vertexColors = false;                                                 // the old baked fake shading is replaced by real light
    m.onBeforeCompile = (shader) => patchLightmapShader(shader, U);
    m.customProgramCacheKey = () => 'daylight-lightmap';
    m.userData = { ...base.userData, daylightBase: base };
    lmMaterials.set(base, m);
    base.addEventListener('dispose', function gone() { base.removeEventListener('dispose', gone); m.dispose(); lmMaterials.delete(base); });
    return m;
  }
  /** Patch a (shared) material in place so it reads the irradiance field indoors. */
  function fieldMaterial(material) {
    const list = Array.isArray(material) ? material : [material];
    for (const m of list) {
      if (!m || !m.isMeshStandardMaterial || fieldPatched.has(m) || m.userData.daylightBase) continue;
      fieldPatched.add(m);
      const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
      m.onBeforeCompile = (shader, r) => { if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(m, shader, r); patchFieldShader(shader, U); };
      m.customProgramCacheKey = () => 'daylight-field|' + (prevKey ? prevKey.call(m) : '');
      m.needsUpdate = true;
    }
    return material;
  }
  const patchTree = (root) => root && root.traverse((o) => { if (o.isMesh && o.material) fieldMaterial(o.material); });

  // ── lighting input ──
  function albedoTable() {
    const rooms = {};
    const colour = (p, fallback) => {
      const a = hexToLinear(p && p.color, fallback), b = p && p.color2 ? hexToLinear(p.color2, a) : a;
      const k = p && p.color2 ? 0.7 : 1;
      return a.map((v, i) => v * k + b[i] * (1 - k));
    };
    for (const r of plan.rooms || []) {
      let f = null, w = null;
      try { f = finishParams(ctx, r.id, 'floor'); w = finishParams(ctx, r.id, 'wall'); } catch (e) { /* defaults */ }
      rooms[r.id] = { floor: colour(f, [0.45, 0.42, 0.38]), wall: colour(w, hexToLinear(store.project.wallColor, [0.8, 0.79, 0.76])) };
    }
    const ext = hexToLinear(store.project.exteriorColor || '#efece6', [0.8, 0.78, 0.74]).map((v) => v * 0.9);
    return {
      rooms, ceiling: [0.86, 0.85, 0.83], facade: ext,
      ground: { garden: [0.24, 0.2, 0.14], slab: hexToLinear('#b3afa6'), paving: [0.36, 0.34, 0.3] },
    };
  }
  let lightTimer = 0, planTimer = 0;
  function relight() {
    if (!S || !env || state.failed) return;
    if (lightTimer) return;
    lightTimer = requestAnimationFrame(() => {
      lightTimer = 0;
      const info = env.getSunInfo ? env.getSunInfo() : null;
      if (!info) return;
      const sunDir = info.direction || [0, 1, 0];
      const sun = env.sun;
      const up = info.elevation > -0.5 && sun && sun.intensity > 0;
      const sunE = up ? [sun.color.r * sun.intensity, sun.color.g * sun.intensity, sun.color.b * sun.intensity] : [0, 0, 0];
      state.sunElevation = info.elevation;
      state.relightAt = performance.now();
      send({ type: 'light', lighting: { sunDir, sunE, sky: store.ui.daylightSky === 'overcast' ? 'overcast' : 'clear', albedo: albedoTable() } });
    });
  }

  // ── results ──
  function receive(msg) {
    if (!msg) return;
    if (msg.type === 'error') { fail(msg.message); return; }
    if (msg.serial !== state.serial) return;                                // stale (an older geometry)
    if (msg.type === 'vis') {
      const ms = Math.round(performance.now() - state.sentAt);
      if (msg.coarse) state.timings.coarse = ms; else state.timings.fine = ms;
      state.visMs = msg.ms; state.links = msg.links; state.facades = msg.facades;
      state.fieldProbe = msg.fieldProbe; state.fieldWeight = msg.fieldWeight; state.fieldAlpha = msg.fieldAlpha;
      return;
    }
    if (msg.type === 'result') {
      if (!S || msg.width !== S.atlas.width || msg.height !== S.atlas.height) return;
      const t0 = performance.now();
      const visChange = state.coarse !== msg.coarse || !state.ready;
      const seconds = visChange ? FADE_S : SLIDER_FADE_S;
      lm.push(msg.width, msg.height, toHalf(msg.lightmap), seconds);
      fieldTex.push(S.field.nx * 6, S.field.nz * 2, msg.field, seconds);
      state.lastLightmap = msg.lightmap; state.probes = msg.probes; state.coarse = msg.coarse;
      {                                                                    // mean upward irradiance at the work plane
        let sum = 0, n = 0;
        for (let k = 0; k < S.probes.length; k++) if (S.probes[k].layer === 0) { sum += lum3(msg.probes, k * 18 + 6); n++; }
        const mean = n ? sum / n : 0;
        state.dollGain = mean > 1e-5 ? Math.min(30, Math.max(1, DOLL_TARGET / mean)) : 1;
      }
      state.timings.upload = performance.now() - t0;
      state.timings.relight = msg.ms; state.timings.relights++;
      state.iterations = msg.iterations;
      if (!state.ready) { state.ready = true; state.timings.firstResultMs = Math.round(performance.now() - state.sentAt); }
      invalidate();
    }
  }

  // ── irradiance at a point (CPU, from the probes) — eye adaptation and debug ──
  function cubeAt(x, y, z) {
    if (!S || !state.probes || !state.fieldProbe) return null;
    const F = S.field, a = Math.floor((x - F.ox) / F.cell), b = Math.floor((z - F.oz) / F.cell);
    if (a < 0 || b < 0 || a >= F.nx || b >= F.nz) return null;
    const f = b * F.nx + a;
    if (!state.fieldAlpha[f]) return null;
    const h = Math.max(0, Math.min(1, (y - PROBE_HEIGHTS[0]) / (PROBE_HEIGHTS[1] - PROBE_HEIGHTS[0])));
    const cube = new Float32Array(18);
    for (let m = 0; m < 4; m++) {
      const k = state.fieldProbe[f * 4 + m]; if (k < 0) break;
      const w = state.fieldWeight[f * 4 + m];
      const k1 = k + 1 < S.probes.length && S.probes[k + 1].layer === 1 && S.probes[k + 1].room === S.probes[k].room ? k + 1 : k;
      for (let q = 0; q < 18; q++) cube[q] += w * (state.probes[k * 18 + q] * (1 - h) + state.probes[k1 * 18 + q] * h);
    }
    return cube;
  }
  const lum3 = (c, o) => 0.2126 * c[o] + 0.7152 * c[o + 1] + 0.0722 * c[o + 2];

  const _dir = new THREE.Vector3(), _pos = new THREE.Vector3();
  /**
   * Per frame. `view` = { mode: 'orbit'|'walk', dollhouse: boolean } — dollhouse = roof hidden with sun study on.
   * Returns true while something is still animating (fade / adaptation): keep rendering.
   */
  function update(camera, view = {}) {
    const now = performance.now(), dt = state.lastT ? Math.min(0.25, (now - state.lastT) / 1000) : 0;
    state.lastT = now;
    let busy = false;
    busy = lm.step(dt) || busy;
    busy = fieldTex.step(dt) || busy;
    const elev = state.sunElevation == null ? 30 : state.sunElevation;
    const target = state.enabled && state.ready && !state.failed && S && !view.suppress ? smooth(-8, -3, elev) : 0;
    if (Math.abs(target - state.on) > 1e-3) { state.on += (target - state.on) * Math.min(1, dt / 0.35 || 1); busy = true; } else state.on = target;
    U.dlOn.value = state.on;
    if (env && env.setDaylight) env.setDaylight(state.on);
    const envExposure = env && env.getExposure ? env.getExposure() : renderer.toneMappingExposure;
    U.dlSpec.value = 0.25 / Math.max(0.02, scene.environmentIntensity || 0.14);
    const shading = state.on < 0.5;
    if (house && house.setFakeShading && shading !== state.fakeShading) { state.fakeShading = shading; house.setFakeShading(shading); }
    if (state.on <= 0.001) { state.adapted = null; U.dlGain.value = 1; renderer.toneMappingExposure = envExposure; state.exposure = envExposure; return busy; }

    // eye adaptation from the solution around the camera
    let exposure = envExposure, gain = 1;
    if (view.mode === 'walk' && camera) {
      camera.getWorldPosition(_pos); camera.getWorldDirection(_dir);
      const cube = cubeAt(_pos.x, _pos.y, _pos.z);
      let key = envExposure;
      if (cube) {
        // luminance the eye sees ≈ ρ/π × irradiance of the surfaces in view; they face the camera, so they receive
        // light from the hemisphere behind it (cube at −view) — blended with the average of all directions
        const d = [-_dir.x, -_dir.y, -_dir.z];
        let eView = 0, eAvg = 0;
        for (let i = 0; i < 6; i++) eAvg += lum3(cube, i * 3) / 6;
        eView = d[0] * d[0] * lum3(cube, (d[0] >= 0 ? 0 : 1) * 3) + d[1] * d[1] * lum3(cube, (d[1] >= 0 ? 2 : 3) * 3) + d[2] * d[2] * lum3(cube, (d[2] >= 0 ? 4 : 5) * 3);
        const L = (0.5 / Math.PI) * (0.6 * eView + 0.4 * eAvg);
        // partial adaptation (the eye never fully compensates: interiors still read darker than the garden)
        key = Math.min(MAX_ADAPT, Math.max(1, Math.pow(ADAPT_KEY / Math.max(1e-4, L), ADAPT_POWER))) * envExposure;
      }
      if (state.adapted == null) state.adapted = key;
      const k = 1 - Math.exp(-dt / ADAPT_S);
      state.adapted = Math.exp(Math.log(state.adapted) + (Math.log(key) - Math.log(state.adapted)) * k);
      if (Math.abs(state.adapted - key) / key > 0.01) busy = true;
      exposure = state.adapted;
    } else {
      state.adapted = null;
      // roofless dollhouse: a display gain (local tone mapping of the interior) maps the mean solved work-plane
      // irradiance to a readable level; sun patches stay brighter than the shade, the garden keeps its exposure
      if (view.dollhouse) { gain = state.dollGain; exposure = envExposure * 1.1; }
    }
    U.dlGain.value = 1 + (gain - 1) * state.on;
    const e = envExposure + (exposure - envExposure) * state.on;
    renderer.toneMappingExposure = e;
    state.exposure = e;
    return busy;
  }

  return {
    uniforms: U,
    /** Connect the house (lightmaps), the environment (sun / exposure) and the items layer (probe field). */
    attach(parts) {
      ({ house, env, items } = { house, env, items, ...parts });
      try {
        rebuildScene();
        if (house && house.setDaylight) house.setDaylight({ prepareMesh, lightmapMaterial, fieldMaterial, patchTree, active: () => state.on > 0.5 });
        if (items && items.setMaterialHook) items.setMaterialHook(fieldMaterial);
        sendScene();
      } catch (e) { fail(e); }
    },
    /** Walk mode opens the interior doors: new visibility (cached per state, so switching back is instant). */
    setDoorsOpen(open) {
      if (state.doorsOpen === !!open) return;
      state.doorsOpen = !!open;
      if (S) { S.input.doorsOpen = state.doorsOpen; sendScene(); }
    },
    setEnabled(on) { state.enabled = !!on; invalidate(); },
    /** Sun / sky / finishes changed. */
    relight,
    /** store 'plan': rebuild the layout (after house.rebuildPlan()), carry the old solution over, re-solve. */
    onPlan(e) {
      if (state.failed) return;
      clearTimeout(planTimer);
      // a wall / door being dragged sends a transient 'plan' per mouse move: re-solve once the drag pauses
      const go = () => { planTimer = 0; try { rebuildScene(); sendScene(); } catch (err) { fail(err); } };
      if (e && e.transient) planTimer = setTimeout(go, 250); else go();
    },
    /** store 'project': a new ceiling height changes the geometry; colours only need a relight. */
    onProject() {
      if (state.failed) return;
      if (S && Math.abs(ceilingCm() / 100 - S.H) > 1e-6) { try { rebuildScene(); sendScene(); } catch (e) { fail(e); } }
      else relight();
    },
    /** Light any extra object tree (e.g. a test bench's furniture group) from the probe field indoors. */
    patchFurniture: patchTree,
    /** The house rebuilt some meshes (cut-away, ceiling): map them into the atlas again. */
    refreshUVs: applyUVs,
    update,
    isActive: () => state.on > 0.001,
    dispose() {
      if (lightTimer) cancelAnimationFrame(lightTimer);
      clearTimeout(planTimer);
      if (worker) worker.terminate(); worker = null;
      if (local) local.dispose(); local = null;
      if (house && house.setDaylight) house.setDaylight(null);
      if (items && items.setMaterialHook) items.setMaterialHook(null);
      lm.dispose(); fieldTex.dispose();
      for (const m of lmMaterials.values()) m.dispose();
      lmMaterials.clear();
      U.dlOn.value = 0;
    },
    /** Test / debug hooks. */
    debug: {
      state: () => ({
        enabled: state.enabled, ready: state.ready, failed: state.failed, error: state.error, mode: state.workerMode,
        on: state.on, exposure: state.exposure, coarse: state.coarse, doorsOpen: state.doorsOpen,
        patches: state.patches, links: state.links, facades: state.facades, probes: S ? S.probes.length : 0,
        atlas: S ? [S.atlas.width, S.atlas.height] : null, field: S ? [S.field.nx * 6, S.field.nz * 2] : null,
        timings: { ...state.timings, visWorkerMs: state.visMs }, iterations: state.iterations,
      }),
      /** Irradiance (renderer units and lux) at a plan point (cm) and height (cm, default 80): ambient cube + floor patch. */
      sampleAt(xcm, ycm, hcm = 80) {
        const cube = cubeAt(xcm / 100, hcm / 100, ycm / 100);
        let floor = null;
        if (S && state.lastLightmap) {
          const ch = chartFor(S, xcm / 100, 0, ycm / 100, 0, 1, 0);
          if (ch >= 0) { const uv = chartUV(S, ch, xcm / 100, 0, ycm / 100); const t = (Math.floor(uv[1] * S.atlas.height) * S.atlas.width + Math.floor(uv[0] * S.atlas.width)) * 4; floor = Array.from(state.lastLightmap.slice(t, t + 3)); }
        }
        const room = S ? roomAt(S, xcm, ycm) : -1;
        return { room: room >= 0 ? S.roomIds[room] : null, cube: cube ? Array.from(cube) : null, up: cube ? Array.from(cube.slice(6, 9)) : null, floorLightmap: floor, lux: cube ? lum3(cube, 6) * 50000 : null };
      },
      scene: () => S,
    },
  };
}
