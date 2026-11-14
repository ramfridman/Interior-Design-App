/**
 * Daylight in the 3D view: connects the radiosity solver (solver.js, run by engine.js in a Web Worker) to the scene.
 *
 *   const daylight = createDaylight({ ctx, renderer, scene, invalidate });
 *   daylight.attach({ house, env, items });       // house shell → lightmaps, items + openings → probe field
 *   daylight.setDoorsOpen(true);                   // walk mode: interior doors open (new visibility, cached)
 *   daylight.relight();                            // date / hour / finishes changed
 *   daylight.onPlan();                             // the plan was edited (after house.rebuildPlan())
 *   daylight.update(camera, { mode, dollhouse });  // per frame: cross-fades, eye adaptation, exposure
 *   daylight.setLampsLit(true);                    // lamps on: indoor lamps become emitters of the same solve
 *   daylight.solvesLamp(id, x, y, z)               // true → this bulb is lit by the solver (no real-time light)
 *
 * Several floors (stage F6): one solve per level (solver.sceneInputFromPlan(plan, { level })), each in its level-local
 * frame with the massing of the other storeys; each level has its own layout, lightmap atlas (its own uniforms and
 * material clones — house.setDaylight hands every storey `dl.level(id)` hooks) and probes. The probe field texture
 * stacks the levels (2 × nz rows each); furniture picks its level by world height (dlLevelA / dlLevelB floors). The
 * level shown / walked is solved first (engine 'active'), the others in the background; a level shows the solved
 * light once its own solution arrived (until then the standard look). Stair voids pass light between levels
 * (engine.js, solver.portalEmit).
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
 *   • Lamps: indoor lighting items (lamps.js: lumen class, distribution, colour temperature per type) are point
 *     emitters of the same radiosity solve (cached visibility per lamp, in the worker): their direct light AND its
 *     bounces are in the lightmap / probe field, so light spills through open doors and furniture is lit by the
 *     probes — no real-time lights indoors (the 8-light pool only serves garden lights). Shades glow while lit.
 *   • Furniture: big items (wardrobes, beds, sofas, kitchen units …) are occluder boxes in the visibility pass,
 *     sent 300 ms after the last move; the worker re-gathers only the rooms whose boxes changed.
 *   • Direct sun through glass: interior surfaces and indoor furniture receive the real-time sun × the glazing
 *     transmittance the solver applies to sky light (normal-incidence 0.78).
 *   • Night: with the lamps lit the solution stays on (eye adaptation moves into a display gain of the solved
 *     interior, up to ×500, so a lamp-lit room reads as lit and unlit rooms stay dark, while the exterior keeps its
 *     night exposure); lamps off → the daylight weight fades out with the sun below −3…−8° and the original night
 *     look takes over. Everything degrades to the original lighting if the solver fails.
 */
import * as THREE from 'three';
import { buildScene, sceneInputFromPlan, chartFor, chartUV, transferLightmap, toHalf, roomAt, airRegionAt, hexToLinear, PROBE_HEIGHTS, DEFAULTS } from './solver.js';
import { lampEmitters, occluderBox } from './lamps.js';
import { createEngine } from './engine.js';
import { finishParams } from '../house.js';
import { hasLevels, levelIds, viewOf, elevationM, itemLevel, GROUND } from '../levels.js';

const DOLL_TARGET = 0.3;                         // renderer units (≈ 15 klux): mean interior irradiance shown in the dollhouse
const ADAPT_KEY = 0.13, ADAPT_POWER = 0.75, MAX_ADAPT = 20;   // eye adaptation: target luminance, partial adaptation, cap
const MAX_ADAPT_NIGHT = 500;                     // night (lamp light ≈ 50–300 lx vs ≈ 1–20 klux by day): the eye opens up much further
const DOLL_TARGET_NIGHT = 0.12, DOLL_MAX_NIGHT = 600;  // dollhouse at night: lamp-lit rooms (not the dark ones) set the gain
const WINDOW_GAIN_NIGHT = 60;                    // orbit view, roof on, at night: lit windows glow (the eye is adapted to the dark garden)
const OCCLUDER_DEBOUNCE_MS = 300;
const FIELD_HOLDER = new WeakMap();               // shared material → { U } of the daylight instance it reads (patched once)
const FADE_S = 0.45, SLIDER_FADE_S = 0.12, ADAPT_S = 0.45;
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const NO_LEVEL = 1e5;                             // field shader: "no such level" floor height (m)
const INTERIOR = (name) => name.startsWith('floor:') || name.startsWith('wall:room:') || name === 'ceilings' || name === 'wall:skirting';

// ───────────────────────── shader patches ─────────────────────────
const LM_VERTEX_DECL = 'attribute vec2 dlUv;\nattribute vec4 dlBox;\nvarying vec2 vDlUv;\nvarying vec4 vDlBox;\n';
const FIELD_VERTEX_DECL = 'varying vec3 vDlW;\n';
const COMMON_FRAG_DECL = /* glsl */`
uniform float dlMix; uniform float dlOn; uniform float dlGain; uniform float dlSpec; uniform float dlGlass;
float dlLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;
const LM_FRAG_DECL = /* glsl */`
uniform sampler2D dlMapA; uniform sampler2D dlMapB;
varying vec2 vDlUv;
varying vec4 vDlBox;     // lookup clamp: keeps bilinear filtering from reaching texels behind a wall
`;
const FIELD_FRAG_DECL = /* glsl */`
uniform sampler2D dlFieldA; uniform sampler2D dlFieldB;
uniform vec4 dlFieldBox;   // origin x, origin z, texel size (m), top (m; > 0 with several floors: nothing above the top level's roof reads the field)
uniform vec2 dlFieldN;     // texels per tile (x, z)
uniform vec2 dlFieldH;     // probe heights of the two layers (m, above the level's finished floor)
uniform vec4 dlLevelA; uniform vec4 dlLevelB;   // several floors: finished floor (m) of levels 0–3, 4–7 (1e5 = none)
uniform float dlLevels;    // levels stacked in the field texture (1 for a one-level plan)
varying vec3 vDlW;
float dlLevelOf(float y) {  // index of the level whose storey contains world height y
  float q = y + 0.05;
  return step(dlLevelA.y, q) + step(dlLevelA.z, q) + step(dlLevelA.w, q) + step(dlLevelB.x, q) + step(dlLevelB.y, q) + step(dlLevelB.z, q) + step(dlLevelB.w, q);
}
float dlFloorOf(float k) { int i = int(k + 0.5); return i < 4 ? dlLevelA[i] : dlLevelB[i - 4]; }
vec4 dlTap(sampler2D t, vec2 g, float dir, float layer) {
  vec2 c = clamp(g, vec2(0.5), dlFieldN - 0.5);
  return texture2D(t, vec2((dir * dlFieldN.x + c.x) / (6.0 * dlFieldN.x), (layer * dlFieldN.y + c.y) / (2.0 * dlFieldN.y * dlLevels)));
}
vec4 dlCube(sampler2D t, vec2 g, float layer, vec3 n) {
  vec3 q = n * n;
  return q.x * dlTap(t, g, n.x >= 0.0 ? 0.0 : 1.0, layer) + q.y * dlTap(t, g, n.y >= 0.0 ? 2.0 : 3.0, layer) + q.z * dlTap(t, g, n.z >= 0.0 ? 4.0 : 5.0, layer);
}
float dlBelowTop(vec3 p) { return dlFieldBox.w > 0.0 ? step(p.y, dlFieldBox.w) : 1.0; }   // several floors: nothing above the top storey
vec4 dlField(vec3 p, vec3 n) {
  vec2 g = (p.xz + n.xz * 0.15 - dlFieldBox.xy) / dlFieldBox.z;
  float lev = dlLevelOf(p.y), l0 = lev * 2.0;                                // each level: its own two probe layers
  float h = clamp((p.y - dlFloorOf(lev) - dlFieldH.x) / max(0.01, dlFieldH.y - dlFieldH.x), 0.0, 1.0);
  vec4 a = mix(dlCube(dlFieldA, g, l0, n), dlCube(dlFieldA, g, l0 + 1.0, n), h);
  vec4 b = mix(dlCube(dlFieldB, g, l0, n), dlCube(dlFieldB, g, l0 + 1.0, n), h);
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
  Object.assign(shader.uniforms, { dlMapA: U.dlMapA, dlMapB: U.dlMapB, dlMix: U.dlMix, dlOn: U.dlOn, dlGain: U.dlGain, dlSpec: U.dlSpec, dlGlass: U.dlGlass });
  shader.vertexShader = LM_VERTEX_DECL + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvDlUv = dlUv;\n\tvDlBox = dlBox;');
  // lightmap alpha = fraction of the texel the solver found in the sun. Shadow maps leak a little light along the
  // wall / ceiling junctions (normal bias); the eye-adapted interior exposure would show those leaks as bright lines,
  // so on lit-by-lightmap surfaces the sun is masked where the solver says no sun can reach.
  const begin = THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= dlSunMask;');
  shader.fragmentShader = COMMON_FRAG_DECL + LM_FRAG_DECL + shader.fragmentShader
    .replace('#include <lights_fragment_begin>', 'vec2 dlUvC = clamp(vDlUv, vDlBox.xy, vDlBox.zw);\nvec4 dlTexel = mix(texture2D(dlMapA, dlUvC), texture2D(dlMapB, dlUvC), dlMix);\n'
      // indoor sun patches came through glazing: the same transmittance the solver applies to sky light
      + 'float dlSunMask = mix(1.0, smoothstep(0.0, 0.2, dlTexel.a) * dlGlass, dlOn);\n' + begin)
    .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + indirect('dlOn', 'dlTexel.rgb * dlGain'));
}
function patchFieldShader(shader, U) {
  Object.assign(shader.uniforms, { dlFieldA: U.dlFieldA, dlFieldB: U.dlFieldB, dlFieldBox: U.dlFieldBox, dlFieldN: U.dlFieldN, dlFieldH: U.dlFieldH, dlLevelA: U.dlLevelA, dlLevelB: U.dlLevelB, dlLevels: U.dlLevels, dlMix: U.dlFieldMix, dlOn: U.dlOn, dlGain: U.dlGain, dlSpec: U.dlSpec, dlGlass: U.dlGlass });
  shader.vertexShader = FIELD_VERTEX_DECL + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
	vec4 dlWp = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		dlWp = batchingMatrix * dlWp;
	#endif
	#ifdef USE_INSTANCING
		dlWp = instanceMatrix * dlWp;
	#endif
	vDlW = ( modelMatrix * dlWp ).xyz;`);
  // indoors (field alpha 1) the sun reaches furniture only through glazing: × its transmittance
  const begin = THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= dlSunGlass;');
  shader.fragmentShader = COMMON_FRAG_DECL + FIELD_FRAG_DECL + shader.fragmentShader
    .replace('#include <lights_fragment_begin>', 'float dlSunGlass = mix(1.0, dlGlass, dlOn * clamp(dlTap(dlFieldB, (vDlW.xz - dlFieldBox.xy) / dlFieldBox.z, 2.0, dlLevelOf(vDlW.y) * 2.0).a, 0.0, 1.0) * dlBelowTop(vDlW));\n' + begin)
    .replace('#include <lights_fragment_maps>',
    '#include <lights_fragment_maps>\nvec4 dlF = dlField(vDlW, normalize(inverseTransformDirection(normal, viewMatrix)));\n' + indirect('dlOn * clamp(dlF.a, 0.0, 1.0) * dlBelowTop(vDlW)', 'dlF.rgb * dlGain'));
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
    dlFieldA: { value: null }, dlFieldB: { value: null }, dlFieldMix: { value: 1 },
    dlFieldBox: { value: new THREE.Vector4() }, dlFieldN: { value: new THREE.Vector2(1, 1) }, dlFieldH: { value: new THREE.Vector2(PROBE_HEIGHTS[0], PROBE_HEIGHTS[1]) },
    dlLevelA: { value: new THREE.Vector4(0, NO_LEVEL, NO_LEVEL, NO_LEVEL) }, dlLevelB: { value: new THREE.Vector4(NO_LEVEL, NO_LEVEL, NO_LEVEL, NO_LEVEL) }, dlLevels: { value: 1 },
    dlOn: { value: 0 }, dlGain: { value: 1 }, dlSpec: { value: 1 }, dlGlass: { value: DEFAULTS.glass },
  };
  const fieldTex = new FadePair(U.dlFieldA, U.dlFieldB, U.dlFieldMix);
  const state = {
    enabled: store.ui.daylight !== false, failed: false, doorsOpen: true,
    on: 0, exposure: 1, adapted: null, lastT: 0, H: 0,
    timings: { scene: 0, uv: 0, coarse: null, fine: null, relight: null, relights: 0, upload: 0, firstResultMs: null },
    workerMode: 'none', error: null,
    lampsLit: false, lampsByLevel: {}, lampIds: new Set(), lampKey: '{}', lampStats: null, night: 0,
    occKeys: {}, occluders: 0, occSentAt: 0, occTimings: [], visIncremental: false, redone: 0,
    fieldData: null, fieldDims: '', view: null,
  };
  let house = null, env = null, items = null;
  const fieldPatched = new WeakSet();
  const multi = () => hasLevels(plan);
  /** Level ids the solver handles: every level of a plan with floors, else just 'L0'. */
  const ids = () => (multi() ? levelIds(plan) : [GROUND]);

  // ── per-level state: scene layout, lightmap (its own atlas + uniforms + material clones), probes, readiness ──
  const levels = new Map();
  function levelState(id) {
    let L = levels.get(id);
    if (L) return L;
    const LU = { dlMapA: { value: null }, dlMapB: { value: null }, dlMix: { value: 1 }, dlOn: { value: 0 }, dlGain: U.dlGain, dlSpec: U.dlSpec, dlGlass: U.dlGlass };
    L = {
      id, U: LU, lm: new FadePair(LU.dlMapA, LU.dlMapB, LU.dlMix), S: null, key: '', serial: 0, sentAt: 0, ready: false, coarse: true,
      lastLightmap: null, probes: null, fieldProbe: null, fieldWeight: null, fieldAlpha: null, w: 0, materials: new Map(), elev: 0,
      dollGain: 1, dollGainLit: 1, meanUp: 0, fakeShading: true, links: 0, facades: 0, visMs: 0, coarseMs: null, fineMs: null, relightMs: null, firstResultMs: null,
    };
    levels.set(id, L);
    return L;
  }
  const ground = () => levelState(GROUND);

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
    if (levels.size) { sendLevels(); for (const L of levels.values()) if (L.S) sendScene(L, false); relight(); }
  }
  const send = (msg) => { if (worker) worker.postMessage(msg); else if (local) local.handle(msg); };
  function fail(e) {
    state.failed = true; state.error = String(e && e.message || e);
    console.warn('[view3d] daylight solver failed — falling back to the standard lighting', e);
    invalidate();
  }

  // ── geometry ──
  const ceilingCm = () => { const v = Number(store.project && store.project.ceilingHeight); return Number.isFinite(v) && v >= 200 ? Math.min(v, 600) : plan.heights.ceiling; };
  /** Solver input of a level: a one-level plan exactly as before; several floors: that level in its local frame + the massing of the others. */
  const input = (id) => (multi() ? sceneInputFromPlan(plan, { level: id, doorsOpen: state.doorsOpen }) : sceneInputFromPlan(plan, { ceilingCm: ceilingCm(), doorsOpen: state.doorsOpen }));
  /** (Re)build the layout of the levels whose input changed (all with `force`); returns the levels rebuilt. */
  function rebuildScenes(force = false) {
    const t0 = performance.now();
    const list = ids(), changed = [];
    for (const id of [...levels.keys()]) if (!list.includes(id)) dropLevel(id);
    for (const id of list) {
      const L = levelState(id), inp = input(id), key = JSON.stringify(inp);
      L.elev = multi() ? elevationM(plan, id) : 0;
      if (!force && L.S && key === L.key) continue;
      const S0 = L.S;
      L.S = buildScene(inp, { layoutOnly: true });                          // same layout as the worker's scene
      L.key = key; L.ready = L.ready && !!S0;
      // carry the old solution over to the new layout (no black frame, no pop)
      const carried = transferLightmap(S0, L.lastLightmap, L.S);
      L.lm.reset(L.S.atlas.width, L.S.atlas.height, toHalf(carried));
      L.lastLightmap = carried;
      changed.push(id);
    }
    const G = ground();
    state.H = G.S ? G.S.H : 0;
    state.timings.scene = performance.now() - t0;
    syncField();
    for (const id of changed) applyUVs(id);
    return changed;
  }
  function dropLevel(id) {
    const L = levels.get(id);
    if (!L) return;
    L.lm.dispose();
    for (const m of L.materials.values()) m.dispose();
    levels.delete(id);
  }
  /** The probe field: one texture, the levels stacked (each 2 × nz rows); level floors / count in uniforms. */
  function syncField() {
    const list = ids().filter((id) => levels.get(id) && levels.get(id).S);
    if (!list.length) return;
    const F = levels.get(list[0]).S.field, nL = list.length;
    let top = 0;
    const floors = list.map((id) => levels.get(id).elev);
    for (const id of list) { const L = levels.get(id); top = Math.max(top, L.elev + L.S.H); }
    U.dlFieldBox.value.set(F.ox, F.oz, F.cell, multi() ? top + 0.05 : 0); U.dlFieldN.value.set(F.nx, F.nz);
    const at = (k) => (k < floors.length ? floors[k] : NO_LEVEL);
    U.dlLevelA.value.set(at(0), at(1), at(2), at(3)); U.dlLevelB.value.set(at(4), at(5), at(6), at(7));
    U.dlLevels.value = nL;
    const dims = `${F.nx}x${F.nz}x${nL}`;
    if (!fieldTex.uA.value || state.fieldDims !== dims) {
      state.fieldDims = dims;
      state.fieldData = new Uint16Array(F.nx * 6 * F.nz * 2 * nL * 4);
      fieldTex.reset(F.nx * 6, F.nz * 2 * nL, state.fieldData.slice());
      for (const L of levels.values()) L.fieldDirty = true;
    }
  }
  function sendLevels() { if (multi()) send({ type: 'levels', ids: ids(), active: activeLevel() }); }
  function sendScene(L, light = true) {
    if (!L.S) return;
    L.serial++;
    L.sentAt = performance.now();
    send(multi() ? { type: 'scene', serial: L.serial, level: L.id, input: L.S.input } : { type: 'scene', serial: L.serial, input: L.S.input });
    if (light) relight();
  }

  /** Second UV set (`dlUv`) of an interior mesh of level `id`: every triangle maps into that level's atlas chart. */
  function prepareMesh(mesh, id = GROUND) {
    const L = levels.get(id), S = L && L.S;
    if (!S || !mesh || !mesh.geometry) return;
    const g = mesh.geometry, pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    if (!pos || !nor) return;
    let uv = g.getAttribute('dlUv'), box = g.getAttribute('dlBox');
    if (!uv || uv.count !== pos.count) { uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2); g.setAttribute('dlUv', uv); }
    if (!box || box.count !== pos.count) { box = new THREE.BufferAttribute(new Float32Array(pos.count * 4), 4); g.setAttribute('dlBox', box); }
    const idx = g.index ? g.index.array : null, n = idx ? idx.length : pos.count, out = [0, 0];
    const W = S.atlas.width, AH = S.atlas.height;
    const dy = mesh.name === 'ceilings' ? S.H : 0;                          // the ceiling soup sits at y = 0, moved up by its mesh
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
  function applyUVs(only = null) {
    const t0 = performance.now();
    if (house && house.forEachInterior) house.forEachInterior((name, mesh, id) => { const lid = id || GROUND; if (!only || only === lid) prepareMesh(mesh, lid); }, only);
    state.timings.uv = performance.now() - t0;
  }

  /** Patched clone of a finish material for the lightmapped interior surfaces of level `id`. */
  function lightmapMaterial(base, id = GROUND) {
    if (!base || !base.isMeshStandardMaterial) return base;
    const L = levelState(id);
    let m = L.materials.get(base);
    if (m) return m;
    m = base.clone();
    m.vertexColors = false;                                                 // the old baked fake shading is replaced by real light
    const LU = L.U;
    m.onBeforeCompile = (shader) => patchLightmapShader(shader, LU);
    m.customProgramCacheKey = () => 'daylight-lightmap';
    m.userData = { ...base.userData, daylightBase: base, daylightLevel: id };
    L.materials.set(base, m);
    base.addEventListener('dispose', function gone() { base.removeEventListener('dispose', gone); m.dispose(); L.materials.delete(base); });
    return m;
  }
  /** Patch a (shared) material in place so it reads the irradiance field indoors. */
  function fieldMaterial(material) {
    const list = Array.isArray(material) ? material : [material];
    for (const m of list) {
      if (!m || !m.isMeshStandardMaterial || fieldPatched.has(m) || m.userData.daylightBase) continue;
      fieldPatched.add(m);
      // shared materials (model caches) outlive this instance: the 3D view is rebuilt on every project switch. Patch a
      // material only once ever and point it at the newest instance's uniforms (wrapping again stacked the patch).
      const holder = FIELD_HOLDER.get(m);
      if (holder) { holder.U = U; m.needsUpdate = true; continue; }
      const ref = { U };
      FIELD_HOLDER.set(m, ref);
      const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
      m.onBeforeCompile = (shader, r) => { if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(m, shader, r); patchFieldShader(shader, ref.U); };
      m.customProgramCacheKey = () => 'daylight-field|' + (prevKey ? prevKey.call(m) : '');
      m.needsUpdate = true;
    }
    return material;
  }
  const patchTree = (root) => root && root.traverse((o) => { if (o.isMesh && o.material) fieldMaterial(o.material); });
  /** The house's hooks for one level's interior (lightmap UVs + material clones of that level's atlas). */
  const hooksFor = (id) => ({
    level: id,
    prepareMesh: (mesh) => prepareMesh(mesh, id),
    lightmapMaterial: (material) => lightmapMaterial(material, id),
    fieldMaterial, patchTree,
    active: () => state.on > 0.5 && levelState(id).ready,
  });

  // ── lighting input ──
  function albedoTable() {
    const rooms = {};
    const colour = (p, fallback) => {
      const a = hexToLinear(p && p.color, fallback), b = p && p.color2 ? hexToLinear(p.color2, a) : a;
      const k = p && p.color2 ? 0.7 : 1;
      return a.map((v, i) => v * k + b[i] * (1 - k));
    };
    const all = multi() ? ids().flatMap((id) => (viewOf(plan, id).rooms || [])) : (plan.rooms || []);
    for (const r of all) {
      let f = null, w = null;
      try { f = finishParams(ctx, r.id, 'floor'); w = finishParams(ctx, r.id, 'wall'); } catch (e) { /* defaults */ }
      rooms[r.id] = { floor: colour(f, [0.45, 0.42, 0.38]), wall: colour(w, hexToLinear(store.project.wallColor, [0.8, 0.79, 0.76])) };
    }
    const ext = hexToLinear(store.project.exteriorColor || '#efece6', [0.8, 0.78, 0.74]).map((v) => v * 0.9);
    return {
      rooms, ceiling: [0.86, 0.85, 0.83], facade: ext,
      ground: { garden: [0.24, 0.2, 0.14], slab: hexToLinear('#b3afa6'), paving: [0.36, 0.34, 0.3], roof: [0.36, 0.35, 0.33] },
    };
  }
  let lightTimer = 0, planTimer = 0;
  function relight() {
    if (!levels.size || !env || state.failed) return;
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
      const lighting = { sunDir, sunE, sky: store.ui.daylightSky === 'overcast' ? 'overcast' : 'clear', albedo: albedoTable() };
      if (multi()) lighting.lampsByLevel = state.lampsLit ? state.lampsByLevel : {};
      else lighting.lamps = state.lampsLit ? state.lampsByLevel[GROUND] || [] : [];
      send({ type: 'light', lighting });
    });
  }

  // ── results ──
  function receive(msg) {
    if (!msg) return;
    if (msg.type === 'error') { fail(msg.message); return; }
    const L = levels.get(msg.level || GROUND);
    if (!L || msg.serial !== L.serial) return;                             // stale (an older geometry, a removed level)
    if (msg.type === 'vis') {
      const ms = Math.round(performance.now() - L.sentAt);
      if (msg.coarse) L.coarseMs = ms; else L.fineMs = ms;
      if (L.id === GROUND) { if (msg.coarse) state.timings.coarse = ms; else state.timings.fine = ms; }
      L.visMs = msg.ms; L.links = msg.links; L.facades = msg.facades;
      state.visIncremental = !!msg.incremental; state.redone = msg.redone || 0;
      if (msg.incremental && state.occSentAt) { state.occTimings.push(Math.round(performance.now() - state.occSentAt)); state.occTimings = state.occTimings.slice(-8); state.occSentAt = 0; }
      L.fieldProbe = msg.fieldProbe; L.fieldWeight = msg.fieldWeight; L.fieldAlpha = msg.fieldAlpha;
      return;
    }
    if (msg.type === 'result') {
      const S = L.S;
      if (!S || msg.width !== S.atlas.width || msg.height !== S.atlas.height) return;
      const t0 = performance.now();
      const visChange = L.coarse !== msg.coarse || !L.ready;
      const seconds = visChange ? FADE_S : SLIDER_FADE_S;
      L.lm.push(msg.width, msg.height, toHalf(msg.lightmap), seconds);
      // the field texture holds every level: write this level's slice, show the whole stack
      const k = ids().indexOf(L.id), F = S.field, slice = F.nx * 6 * F.nz * 2 * 4;
      if (k >= 0 && state.fieldData && msg.field.length === slice && state.fieldData.length >= (k + 1) * slice) {
        state.fieldData.set(msg.field, k * slice);
        fieldTex.push(F.nx * 6, F.nz * 2 * U.dlLevels.value, state.fieldData.slice(), seconds);
      }
      L.lastLightmap = msg.lightmap; L.probes = msg.probes; L.coarse = msg.coarse;
      {                                                                    // mean upward irradiance at the work plane
        let sum = 0, n = 0;
        for (let q = 0; q < S.probes.length; q++) if (S.probes[q].layer === 0) { sum += lum3(msg.probes, q * 18 + 6); n++; }
        const mean = n ? sum / n : 0;
        L.meanUp = mean;
        L.dollGain = mean > 1e-5 ? Math.min(30, Math.max(1, DOLL_TARGET / mean)) : 1;
        // night: the mean of the lit probes (≥ 5 % of the brightest) — lamp-lit rooms read as lit, dark rooms stay dark
        let max = 0; for (let q = 0; q < S.probes.length; q++) if (S.probes[q].layer === 0) max = Math.max(max, lum3(msg.probes, q * 18 + 6));
        let ls = 0, ln = 0; for (let q = 0; q < S.probes.length; q++) if (S.probes[q].layer === 0) { const v = lum3(msg.probes, q * 18 + 6); if (v >= 0.05 * max && v > 0) { ls += v; ln++; } }
        const lit = ln ? ls / ln : 0;
        L.dollGainLit = lit > 1e-8 ? Math.min(DOLL_MAX_NIGHT, Math.max(1, DOLL_TARGET_NIGHT / lit)) : 1;
      }
      if (L.id === GROUND || !multi()) state.lampStats = msg.lampStats || null;
      state.timings.upload = performance.now() - t0;
      L.relightMs = msg.ms;
      state.timings.relight = msg.ms; state.timings.relights++;
      state.iterations = msg.iterations;
      if (!L.ready) { L.ready = true; L.firstResultMs = Math.round(performance.now() - L.sentAt); if (state.timings.firstResultMs == null) state.timings.firstResultMs = L.firstResultMs; }
      invalidate();
    }
  }

  // ── irradiance at a point (CPU, from the probes) — eye adaptation and debug ──
  /** Level whose storey contains world height y (m). */
  function levelAtY(y) {
    const list = ids();
    let best = list[0];
    for (const id of list) { const L = levels.get(id); if (L && L.elev <= y + 0.05) best = id; }
    return best;
  }
  function cubeAt(x, y, z, id = levelAtY(y)) {
    const L = levels.get(id), S = L && L.S;
    if (!S || !L.probes || !L.fieldProbe) return null;
    const F = S.field, a = Math.floor((x - F.ox) / F.cell), b = Math.floor((z - F.oz) / F.cell);
    if (a < 0 || b < 0 || a >= F.nx || b >= F.nz) return null;
    const f = b * F.nx + a;
    if (!L.fieldAlpha[f]) return null;
    const h = Math.max(0, Math.min(1, (y - L.elev - PROBE_HEIGHTS[0]) / (PROBE_HEIGHTS[1] - PROBE_HEIGHTS[0])));
    const cube = new Float32Array(18);
    for (let m = 0; m < 4; m++) {
      const k = L.fieldProbe[f * 4 + m]; if (k < 0) break;
      const w = L.fieldWeight[f * 4 + m];
      const k1 = k + 1 < S.probes.length && S.probes[k + 1].layer === 1 && S.probes[k + 1].room === S.probes[k].room ? k + 1 : k;
      for (let q = 0; q < 18; q++) cube[q] += w * (L.probes[k * 18 + q] * (1 - h) + L.probes[k1 * 18 + q] * h);
    }
    return cube;
  }
  const lum3 = (c, o) => 0.2126 * c[o] + 0.7152 * c[o + 1] + 0.0722 * c[o + 2];
  /** Several floors: is plan point (x, z) (m) within `r` m of a stair void of the level above `id`? */
  function underVoid(id, x, z, r = 1) {
    const list = ids(), up = list[list.indexOf(id) + 1];
    if (!up) return false;
    for (const v of viewOf(plan, up).voids || []) {
      const p = v && v.polygon; if (!Array.isArray(p) || p.length < 3) continue;
      const xs = p.map((q) => q[0] / 100), zs = p.map((q) => q[1] / 100);
      if (x > Math.min(...xs) - r && x < Math.max(...xs) + r && z > Math.min(...zs) - r && z < Math.max(...zs) + r) return true;
    }
    return false;
  }

  /** The level the display is built around: the walker's (by camera height) / the view's / the shown one. */
  function activeLevel() {
    const v = state.view;
    if (!multi()) return GROUND;
    if (v && v.level && ids().includes(v.level)) return v.level;
    return ids().includes(store.ui.level) ? store.ui.level : GROUND;
  }
  let sentActive = null;

  const _dir = new THREE.Vector3(), _pos = new THREE.Vector3();
  /**
   * Per frame. `view` = { mode: 'orbit'|'walk', dollhouse: boolean, suppress?: boolean, level?: string } — dollhouse =
   * roof hidden with sun study on; level (several floors) = the level shown / walked (solved first, sets the gain).
   * Returns true while something is still animating (fade / adaptation): keep rendering.
   */
  function update(camera, view = {}) {
    const now = performance.now(), dt = state.lastT ? Math.min(0.25, (now - state.lastT) / 1000) : 0;
    state.lastT = now;
    let busy = false;
    let walkLevel = null;
    if (view.mode === 'walk' && camera && multi()) { camera.getWorldPosition(_pos); walkLevel = levelAtY(_pos.y - 1.0); }
    state.view = { ...view, level: walkLevel || view.level };
    const act = activeLevel();
    if (act !== sentActive && multi()) { sentActive = act; send({ type: 'active', level: act }); }
    for (const L of levels.values()) busy = L.lm.step(dt) || busy;
    busy = fieldTex.step(dt) || busy;
    const A = levels.get(act) || ground();
    const elev = state.sunElevation == null ? 30 : state.sunElevation;
    // with indoor lamps placed the solution is the interior's light at any hour (lit → lamp light, switched off →
    // honestly dark); a house without lamps falls back to the original night look after dusk
    const lampsSolved = Object.values(state.lampsByLevel).some((l) => l.length > 0);
    const target = state.enabled && A && A.ready && !state.failed && A.S && !view.suppress ? (lampsSolved ? 1 : smooth(-8, -3, elev)) : 0;
    // night weight: adaptation moves from the camera exposure (day) into the interior display gain (night)
    const n = (overcastNow() ? smooth(4, -6, elev) : smooth(-2, -9, elev)) * (lampsSolved ? 1 : 0);
    state.night = n;
    if (Math.abs(target - state.on) > 1e-3) { state.on += (target - state.on) * Math.min(1, dt / 0.35 || 1); busy = true; } else state.on = target;
    U.dlOn.value = state.on;
    // each level's lightmapped surfaces show the solution once that level is solved (until then: the standard look)
    for (const L of levels.values()) {
      const t = L.ready ? 1 : 0;
      if (Math.abs(t - L.w) > 1e-3) { L.w += (t - L.w) * Math.min(1, dt / 0.35 || 1); busy = true; } else L.w = t;
      L.U.dlOn.value = state.on * L.w;
      const shading = L.U.dlOn.value < 0.5;
      if (house && house.setFakeShading && shading !== L.fakeShading) { L.fakeShading = shading; if (multi()) house.setFakeShading(shading, L.id); else house.setFakeShading(shading); }
    }
    if (env && env.setDaylight) env.setDaylight(state.on);
    const envExposure = env && env.getExposure ? env.getExposure() : renderer.toneMappingExposure;
    U.dlSpec.value = 0.25 / Math.max(0.02, scene.environmentIntensity || 0.14);
    if (state.on <= 0.001) { state.adapted = null; U.dlGain.value = 1; renderer.toneMappingExposure = envExposure; state.exposure = envExposure; return busy; }

    // eye adaptation from the solution around the camera
    let exposure = envExposure, gain = 1;
    if (view.mode === 'walk' && camera) {
      camera.getWorldPosition(_pos); camera.getWorldDirection(_dir);
      const here = walkLevel || GROUND, cube = cubeAt(_pos.x, _pos.y, _pos.z, here);
      let key = envExposure;
      if (cube) {
        // luminance the eye sees ≈ ρ/π × irradiance of the surfaces in view; they face the camera, so they receive
        // light from the hemisphere behind it (cube at −view) — blended with the average of all directions
        const d = [-_dir.x, -_dir.y, -_dir.z];
        let eView = 0, eAvg = 0;
        for (let i = 0; i < 6; i++) eAvg += lum3(cube, i * 3) / 6;
        eView = d[0] * d[0] * lum3(cube, (d[0] >= 0 ? 0 : 1) * 3) + d[1] * d[1] * lum3(cube, (d[1] >= 0 ? 2 : 3) * 3) + d[2] * d[2] * lum3(cube, (d[2] >= 0 ? 4 : 5) * 3);
        let L = (0.5 / Math.PI) * (0.6 * eView + 0.4 * eAvg);
        // several floors: under a stair void the (brighter) storey above is in view — the eye also adapts to it, so the
        // upper floor seen through the void is not blown out (its work-plane light, weighted by how much is in view)
        if (multi() && underVoid(here, _pos.x, _pos.z)) {
          const list = ids(), up = list[list.indexOf(here) + 1], UL = levels.get(up);
          const upCube = UL && UL.ready ? cubeAt(_pos.x, UL.elev + PROBE_HEIGHTS[0], _pos.z, up) : null;
          if (upCube) { const lup = (0.5 / Math.PI) * lum3(upCube, 6); L = Math.max(L, lup * (0.3 + 0.4 * Math.max(0, _dir.y))); }
        }
        // partial adaptation (the eye never fully compensates: interiors still read darker than the garden)
        const cap = Math.exp(Math.log(MAX_ADAPT) + (Math.log(MAX_ADAPT_NIGHT) - Math.log(MAX_ADAPT)) * n);
        key = Math.min(cap, Math.max(1, Math.pow(ADAPT_KEY / Math.max(1e-7, L), ADAPT_POWER))) * envExposure;
      }
      if (state.adapted == null) state.adapted = key;
      const k = 1 - Math.exp(-dt / ADAPT_S);
      state.adapted = Math.exp(Math.log(state.adapted) + (Math.log(key) - Math.log(state.adapted)) * k);
      if (Math.abs(state.adapted - key) / key > 0.01) busy = true;
      // day: the camera exposure adapts; night: only the solved interior is gained, the dark garden keeps its exposure
      const ratio = state.adapted / envExposure, viaExposure = Math.pow(ratio, 1 - n);
      exposure = envExposure * viaExposure; gain = ratio / viaExposure;
    } else {
      state.adapted = null;
      // roofless dollhouse: a display gain (local tone mapping of the interior) maps the mean solved work-plane
      // irradiance of the level in view to a readable level; sun patches stay brighter than the shade, the garden keeps its exposure
      if (view.dollhouse) { gain = Math.exp(Math.log(A.dollGain) * (1 - n) + Math.log(A.dollGainLit) * n); exposure = envExposure * 1.1; }
      else gain = 1 + (WINDOW_GAIN_NIGHT - 1) * n;                       // roof on: lamp-lit windows glow at night
    }
    U.dlGain.value = 1 + (gain - 1) * state.on;
    const e = envExposure + (exposure - envExposure) * state.on;
    renderer.toneMappingExposure = e;
    state.exposure = e;
    return busy;
  }

  // ── lamps and furniture from the items layer ──
  const overcastNow = () => store.ui.daylightSky === 'overcast';
  const getItem = (id) => (store.getItem ? store.getItem(id) : (store.items || []).find((i) => i.id === id));
  /** Indoor, switched-on lamp models → solver emitters (level-local m), per level. Lamps outside the rooms stay real-time lights. */
  function refreshLamps() {
    if (!items || !items.lampPoints || !levels.size) return;
    const by = {}, ids2 = new Set();
    for (const { id, points } of items.lampPoints()) {
      const item = getItem(id);
      if (!item) continue;
      const lid = multi() ? itemLevel(item, plan, store) : GROUND, L = levels.get(lid);
      if (!L || !L.S) continue;
      const local = points.map(([x, y, z]) => [x, y - L.elev, z]);
      const inside = local.filter(([x, y, z]) => roomAt(L.S, x * 100, z * 100) >= 0 && y > -0.05 && y < L.S.H + 0.3);
      if (!inside.length) continue;
      const list = by[lid] || (by[lid] = []);
      for (const e of lampEmitters(item, inside)) list.push({ x: +e.x.toFixed(3), y: +e.y.toFixed(3), z: +e.z.toFixed(3), lm: e.lm, lobe: e.lobe, down: e.down, color: e.color.map((v) => +v.toFixed(4)) });
      ids2.add(id);
    }
    const key = JSON.stringify(by);
    state.lampIds = ids2;
    if (key === state.lampKey) return;
    state.lampKey = key; state.lampsByLevel = by;
    if (state.lampsLit) relight();
  }
  /** Big furniture → occluder boxes of each level (level-local heights); sent (debounced) only when they changed. */
  let occTimer = 0;
  function refreshOccluders(now = false) {
    clearTimeout(occTimer); occTimer = 0;
    const go = () => {
      occTimer = 0;
      if (state.failed) return;
      const by = {};
      for (const id of ids()) by[id] = [];
      for (const item of store.items || []) {
        const lid = multi() ? itemLevel(item, plan, store) : GROUND, L = levels.get(lid);
        if (!by[lid] || !L) continue;
        const b = items && items.boxOf ? items.boxOf(item.id) : null;
        const box = occluderBox(item, b && Number.isFinite(b.min.y) ? b.min.y - (item.elev || 0) / 100 - L.elev : 0);
        if (box) by[lid].push(box);
      }
      let total = 0;
      for (const [lid, boxes] of Object.entries(by)) {
        total += boxes.length;
        const key = JSON.stringify(boxes);
        if (key === state.occKeys[lid]) continue;
        state.occKeys[lid] = key; state.occSentAt = performance.now();
        send(multi() ? { type: 'occluders', level: lid, boxes } : { type: 'occluders', boxes });
      }
      state.occluders = total;
    };
    if (now) go(); else occTimer = setTimeout(go, OCCLUDER_DEBOUNCE_MS);
  }
  let offItems = null;
  function attachHouse() {
    if (!house || !house.setDaylight) return;
    const dl = { prepareMesh: (mesh) => prepareMesh(mesh, GROUND), lightmapMaterial: (m) => lightmapMaterial(m, GROUND), fieldMaterial, patchTree, active: () => state.on > 0.5, level: hooksFor };
    house.setDaylight(dl);
  }

  return {
    uniforms: U,
    /** Lamps switched on / off (view3d: Lights auto / on / off). */
    setLampsLit(on) {
      if (state.lampsLit === !!on) return;
      state.lampsLit = !!on;
      refreshLamps();
      relight();
      invalidate();
    },
    /** True when the solver lights this lamp model (so the real-time lamp pool must skip it). */
    solvesLamp: (id) => {
      if (!(state.lampsLit && !state.failed && state.enabled && state.on > 0.001 && state.lampIds.has(id))) return false;
      if (!multi()) return true;
      const item = getItem(id), L = item && levels.get(itemLevel(item, plan, store));
      return !!(L && L.ready && L.w > 0.5);
    },
    /** Items changed (moved, added, removed, rebuilt): lamps now, occluders after a pause. */
    onItems() { refreshLamps(); refreshOccluders(); },
    /** Connect the house (lightmaps), the environment (sun / exposure) and the items layer (probe field). */
    attach(parts) {
      ({ house, env, items } = { house, env, items, ...parts });
      try {
        rebuildScenes(true);
        attachHouse();
        if (items && items.setMaterialHook) items.setMaterialHook(fieldMaterial);
        if (items && items.onChange && !offItems) offItems = items.onChange(() => { try { refreshLamps(); refreshOccluders(); } catch (e) { fail(e); } });
        sendLevels();
        refreshOccluders(true);
        for (const id of priorityOrder()) sendScene(levels.get(id), false);
        relight();
        refreshLamps();
      } catch (e) { fail(e); }
    },
    /** Walk mode opens the interior doors: new visibility (cached per state, so switching back is instant). */
    setDoorsOpen(open) {
      if (state.doorsOpen === !!open) return;
      state.doorsOpen = !!open;
      for (const L of levels.values()) if (L.S) { L.S.input.doorsOpen = state.doorsOpen; L.key = JSON.stringify(L.S.input); }
      for (const id of priorityOrder()) sendScene(levels.get(id), false);
      relight();
    },
    setEnabled(on) { state.enabled = !!on; invalidate(); },
    /** Sun / sky / finishes changed. */
    relight,
    /**
     * store 'plan': rebuild the layout (after house.rebuildPlan()), carry the old solution over, re-solve. Several
     * floors: only the levels whose solver input changed — the edited level, and a neighbour only when its massing
     * (the footprint / heights of the storeys around it, the voids above it) changed.
     */
    onPlan(e) {
      if (state.failed) return;
      clearTimeout(planTimer);
      // a wall / door being dragged sends a transient 'plan' per mouse move: re-solve once the drag pauses
      const go = () => {
        planTimer = 0;
        try {
          const before = [...levels.keys()].join(',');
          const changed = rebuildScenes(false);
          if ([...levels.keys()].join(',') !== before) { sendLevels(); attachHouse(); }
          state.lastRebuilt = changed;
          for (const id of priorityOrder()) if (changed.includes(id)) sendScene(levels.get(id), false);
          if (changed.length) relight();
          refreshLamps(); refreshOccluders();
        } catch (err) { fail(err); }
      };
      if (e && e.transient) planTimer = setTimeout(go, 250); else go();
    },
    /** store 'project': a new ceiling height changes the geometry; colours only need a relight. */
    onProject() {
      if (state.failed) return;
      const changed = rebuildScenes(false);
      if (changed.length) { for (const id of priorityOrder()) if (changed.includes(id)) sendScene(levels.get(id), false); }
      relight();
    },
    /** Light any extra object tree (e.g. a test bench's furniture group) from the probe field indoors. */
    patchFurniture: patchTree,
    /** The house rebuilt some meshes (cut-away, ceiling): map them into the atlas again. */
    refreshUVs: () => applyUVs(),
    update,
    isActive: () => state.on > 0.001,
    dispose() {
      if (lightTimer) cancelAnimationFrame(lightTimer);
      clearTimeout(planTimer); clearTimeout(occTimer);
      if (offItems) offItems(); offItems = null;
      if (worker) worker.terminate(); worker = null;
      if (local) local.dispose(); local = null;
      if (house && house.setDaylight) house.setDaylight(null);
      if (items && items.setMaterialHook) items.setMaterialHook(null);
      for (const id of [...levels.keys()]) dropLevel(id);
      fieldTex.dispose();
      U.dlOn.value = 0;
    },
    /** Test / debug hooks. */
    debug: {
      state: () => {
        const G = levels.get(GROUND), S = G && G.S;
        return {
          enabled: state.enabled, ready: !!(G && G.ready), failed: state.failed, error: state.error, mode: state.workerMode,
          on: state.on, exposure: state.exposure, coarse: G ? G.coarse : true, doorsOpen: state.doorsOpen,
          patches: S ? S.patch.count : 0, links: G ? G.links : 0, facades: G ? G.facades : 0, probes: S ? S.probes.length : 0,
          atlas: S ? [S.atlas.width, S.atlas.height] : null, field: S ? [S.field.nx * 6, S.field.nz * 2 * U.dlLevels.value] : null,
          timings: { ...state.timings, visWorkerMs: G ? G.visMs : null, occluderUpdatesMs: state.occTimings.slice() }, iterations: state.iterations,
          lampsLit: state.lampsLit, lamps: Object.values(state.lampsByLevel).reduce((a, l) => a + l.length, 0),
          lampLumens: Object.values(state.lampsByLevel).flat().reduce((a, l) => a + l.lm, 0), lampStats: state.lampStats,
          occluders: state.occluders, visIncremental: state.visIncremental, redone: state.redone, night: state.night, gain: U.dlGain.value,
          dollGain: G ? G.dollGain : 1, dollGainLit: G ? G.dollGainLit : 1,
          active: activeLevel(), lastRebuilt: state.lastRebuilt || null,
          levels: ids().map((id) => {
            const L = levels.get(id);
            if (!L) return { id };
            return {
              id, ready: L.ready, coarse: L.coarse, on: L.U.dlOn.value, elevation: L.elev, H: L.S ? L.S.H : null, patches: L.S ? L.S.patch.count : 0,
              probes: L.S ? L.S.probes.length : 0, atlas: L.S ? [L.S.atlas.width, L.S.atlas.height] : null, links: L.links, facades: L.facades,
              portals: L.S && L.S.portal ? L.S.portal.count : 0, serial: L.serial,
              timings: { coarse: L.coarseMs, fine: L.fineMs, visWorkerMs: L.visMs, relight: L.relightMs, firstResultMs: L.firstResultMs },
              meanUpLux: Math.round(L.meanUp * 50000), dollGain: L.dollGain,
              memoryKB: L.S ? Math.round((L.S.atlas.width * L.S.atlas.height * 8 * 2 + L.links * 8 + L.S.patch.count * 40) / 1024) : 0,
            };
          }),
        };
      },
      /** Irradiance (renderer units and lux) at a plan point (cm) and height (cm above the level's floor, default 80). */
      sampleAt(xcm, ycm, hcm = 80, level = GROUND) {
        const L = levels.get(level) || ground(), S = L.S;
        const cube = cubeAt(xcm / 100, L.elev + hcm / 100, ycm / 100, L.id);
        let floor = null;
        if (S && L.lastLightmap) {
          const ch = chartFor(S, xcm / 100, 0, ycm / 100, 0, 1, 0);
          if (ch >= 0) { const uv = chartUV(S, ch, xcm / 100, 0, ycm / 100); const t = (Math.floor(uv[1] * S.atlas.height) * S.atlas.width + Math.floor(uv[0] * S.atlas.width)) * 4; floor = Array.from(L.lastLightmap.slice(t, t + 3)); }
        }
        const room = S ? roomAt(S, xcm, ycm) : -1;
        return { level: L.id, room: room >= 0 ? S.roomIds[room] : null, cube: cube ? Array.from(cube) : null, up: cube ? Array.from(cube.slice(6, 9)) : null, floorLightmap: floor, lux: cube ? lum3(cube, 6) * 50000 : null };
      },
      scene: (level = GROUND) => (levels.get(level) ? levels.get(level).S : null),
    },
  };
  /** Levels, the active one first, then by distance from it. */
  function priorityOrder() {
    const list = ids(), a = Math.max(0, list.indexOf(activeLevel()));
    return list.filter((id) => levels.get(id)).sort((p, q) => Math.abs(list.indexOf(p) - a) - Math.abs(list.indexOf(q) - a) || list.indexOf(p) - list.indexOf(q));
  }
}
