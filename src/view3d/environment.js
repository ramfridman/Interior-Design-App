/**
 * Daylight, sky and exposure for the 3D view.
 *
 *   const env = createEnvironment({ scene, renderer, ctx });
 *   env.setDate(store.ui.date);                // 'YYYY-MM-DD' civil date at the site
 *   env.setTimeOfDay(store.ui.timeOfDay);      // 0..24 h local clock time (daylight-saving time included)
 *   env.getSunInfo();                          // { azimuth, elevation, sunrise, sunset, solarNoon, isDay, compass, … }
 *   env.setInteriorMode(true);                 // roof on / walk-through: soft fill so rooms read well
 *   env.setSunStudy(true);                     // roofless dollhouse whose (invisible) roof still blocks the sun
 *   env.update(camera);                        // once per frame (cheap)
 *
 * Sun path: the real ephemeris of sun.js (NOAA / Meeus) for PLAN.meta.latitude / longitude / timeZone, mapped into
 * world space with PLAN.meta.northAngle. Light colour and strength follow the sun's elevation (warm and weak when
 * low); below 3° the direct light fades out and is off at the horizon — after dusk the same light becomes a dim moon.
 * The sun is one DirectionalLight whose orthographic shadow frustum is fitted to the whole lot: it never follows
 * the camera, so shadows cannot swim while orbiting or walking, and it is snapped to whole shadow-map texels so the
 * edges do not crawl while the time slider moves.
 * The module configures the renderer it is given: soft shadow maps, ACES tone mapping, sRGB output, exposure.
 *
 * Direct-beam strength follows the same illuminance model as the daylight solver (daylight/sky.js sunNormalLux:
 * Kasten–Young air mass, single-coefficient extinction — ≈ 103 klux at the zenith, 15 klux at 5°), so sunrise and
 * sunset are as dim as the solver assumes; colours, sky fill and exposure still come from the KEYS table.
 * Sky 'overcast' (setSky): no direct sun, a grey CIE-overcast-like dome, sky fill scaled by the overcast / clear
 * diffuse illuminance ratio of the same model, and +0.7 EV of camera exposure.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { sunPosition, sunTimes, sunDirectionWorld, compassPoint, todayAt, DEFAULT_SITE } from './sun.js';
import { sunNormalLux, diffuseHorizontalLux, LUX_PER_UNIT } from './daylight/sky.js';
import { levelIds, viewOf, elevationM, hasLevels } from './levels.js';

const DEG = Math.PI / 180;
const MIN_LIGHT_ELEVATION = 2;                                   // degrees — the shadow frustum never goes flatter than this
const SHADOW_BIAS_M = 0.008, SHADOW_NORMAL_BIAS_M = 0.02;        // metres: depth offset towards the light / along the receiver normal
const TEXEL_LADDER = 1.03;                                       // shadow texel sizes are quantised to this ratio (stable while time changes)
const FILL_COUNT = 3;                                            // interior fill lights (constant count → no shader recompiles; each costs fill-rate)

/** Look-up table by sun altitude (degrees). Colours are sRGB hex; values in between are interpolated. */
const KEYS = [
  { alt: -18, zenith: '#05070f', horizon: '#0d1220', sun: '#8fa6ff', sunI: 0.0, hemiI: 0.07, ambI: 0.035, envI: 0.03, exposure: 1.25, glow: 0 },
  { alt: -9, zenith: '#0b1630', horizon: '#243556', sun: '#ff8a4a', sunI: 0.0, hemiI: 0.1, ambI: 0.04, envI: 0.04, exposure: 1.25, glow: 0.25 },
  { alt: -4, zenith: '#1d3768', horizon: '#8f7f92', sun: '#ff7a36', sunI: 0.0, hemiI: 0.2, ambI: 0.05, envI: 0.07, exposure: 1.2, glow: 0.8 },
  { alt: 0, zenith: '#33598f', horizon: '#f2b184', sun: '#ff8438', sunI: 0.6, hemiI: 0.27, ambI: 0.05, envI: 0.09, exposure: 1.15, glow: 1 },
  { alt: 5, zenith: '#4374b8', horizon: '#f6d3ab', sun: '#ffa55c', sunI: 1.35, hemiI: 0.33, ambI: 0.05, envI: 0.12, exposure: 1.1, glow: 0.85 },
  { alt: 12, zenith: '#4682cc', horizon: '#e6e1d6', sun: '#ffc88f', sunI: 1.8, hemiI: 0.38, ambI: 0.05, envI: 0.13, exposure: 1.05, glow: 0.4 },
  { alt: 25, zenith: '#3f83d4', horizon: '#d3e2ee', sun: '#ffe6c8', sunI: 2.0, hemiI: 0.4, ambI: 0.05, envI: 0.14, exposure: 1.0, glow: 0.1 },
  { alt: 45, zenith: '#377dd2', horizon: '#cfe1f0', sun: '#fff3e2', sunI: 2.05, hemiI: 0.42, ambI: 0.05, envI: 0.14, exposure: 1.0, glow: 0 },
  { alt: 90, zenith: '#3278d0', horizon: '#d2e3f1', sun: '#fff7ec', sunI: 2.1, hemiI: 0.42, ambI: 0.05, envI: 0.14, exposure: 1.0, glow: 0 },
].map((k) => ({ ...k, zenith: new THREE.Color(k.zenith), horizon: new THREE.Color(k.horizon), sun: new THREE.Color(k.sun) }));

const STUDY = { sun: 1.25, fill: 0.9 };
const SUN_SCALE = 2.1 / (sunNormalLux(90) / LUX_PER_UNIT);           // ≈ 1.015: the model's zenith sun = the old table's 2.1
/** Direct sun on a surface facing it (renderer units) for a solar altitude — the solver's model. */
export const sunIntensityAt = (alt) => (sunNormalLux(alt) / LUX_PER_UNIT) * SUN_SCALE;
const OVERCAST = { zenith: new THREE.Color('#c3c8ce'), horizon: new THREE.Color('#a9aeb4'), exposure: 1.6 };                             // sun-study dollhouse: sun / sky-fill multipliers
const MOON = { color: new THREE.Color('#93a9e6'), intensity: 0.22, azimuth: 150, altitude: 48 };

const SKY_VERTEX = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;                         // always at the far plane
  }`;
const SKY_FRAGMENT = /* glsl */`
  uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uGlowColor, uMoonDir;
  uniform float uGlow, uNight, uSunDisc;
  varying vec3 vDir;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  void main() {
    vec3 d = normalize(vDir);
    float t = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(t, 0.45));
    float toSun = max(dot(d, uSunDir), 0.0);
    // warm band around the sun's azimuth at dawn / dusk (zero exactly at the horizon so it meets the fogged ground)
    float az = max(dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz + 1e-5)), 0.0);
    col = mix(col, uGlowColor, uGlow * pow(az, 3.0) * pow(1.0 - t, 5.0) * smoothstep(0.0, 0.05, d.y) * 0.85);
    col += uSunColor * (pow(toSun, 900.0) * 1.6 + pow(toSun, 60.0) * 0.22 + pow(toSun, 8.0) * 0.08) * uSunDisc;
    // night: stars and a small moon
    float above = smoothstep(0.02, 0.3, d.y);
    vec3 cell = floor(d * 190.0);
    float star = step(0.9972, hash(cell)) * smoothstep(0.42, 0.05, length(fract(d * 190.0) - 0.5));
    col += vec3(0.85, 0.9, 1.0) * star * uNight * above * 0.9;
    float toMoon = max(dot(d, uMoonDir), 0.0);
    col += vec3(0.82, 0.86, 0.95) * (smoothstep(0.99975, 0.99985, toMoon) + pow(toMoon, 300.0) * 0.12) * uNight;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Interpolate the altitude table. */
function sample(alt, out) {
  let i = 0;
  while (i < KEYS.length - 2 && alt > KEYS[i + 1].alt) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = Math.max(0, Math.min(1, (alt - a.alt) / (b.alt - a.alt)));
  for (const k of ['sunI', 'hemiI', 'ambI', 'envI', 'exposure', 'glow']) out[k] = a[k] + (b[k] - a[k]) * t;
  out.zenith.copy(a.zenith).lerp(b.zenith, t); out.horizon.copy(a.horizon).lerp(b.horizon, t); out.sun.copy(a.sun).lerp(b.sun, t);
  return out;
}

/**
 * @param {{ scene: THREE.Scene, renderer: THREE.WebGLRenderer, ctx: object, shadowMapSize?: number }} options
 * @returns {{ setDate(date: string): void, setTimeOfDay(hours: number): void, getSunInfo(): object,
 *             setInteriorMode(on: boolean): void, setSunStudy(on: boolean): void, refreshPlan(): void,
 *             update(camera: THREE.Camera): void,
 *             sun: THREE.DirectionalLight, hemisphere: THREE.HemisphereLight, sky: THREE.Mesh, dispose(): void }}
 */
export function createEnvironment({ scene, renderer, ctx, shadowMapSize }) {
  const plan = ctx.plan;
  const meta = plan.meta || {};
  const northAngle = Number(meta.northAngle) || 0;
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const where = { latitude: num(meta.latitude, DEFAULT_SITE.latitude), longitude: num(meta.longitude, DEFAULT_SITE.longitude), timeZone: meta.timeZone || DEFAULT_SITE.timeZone };
  const lot = (plan.site && plan.site.bounds) || { x: plan.bounds.x - 600, y: plan.bounds.y - 400, w: plan.bounds.w + 1200, h: plan.bounds.h + 800 };
  const centre = new THREE.Vector3((lot.x + lot.w / 2) / 100, 0, (lot.y + lot.h / 2) / 100);
  const ceilingH = () => ((ctx.store.project && ctx.store.project.ceilingHeight) || plan.heights.ceiling) / 100;

  // ── renderer ──
  if (renderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  // ── image-based lighting for soft reflections on glass, metal and glossy floors ──
  let envTexture = null;
  const previousEnvironment = scene.environment, previousFog = scene.fog;
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    envTexture = pmrem.fromScene(room, 0.04).texture;
    scene.environment = envTexture;
    room.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    pmrem.dispose();
  }

  // ── sky dome ──
  const skyMaterial = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color() }, uGlowColor: { value: new THREE.Color('#ff9a52') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: 0 }, uNight: { value: 0 }, uSunDisc: { value: 1 },
    },
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMaterial);
  sky.name = 'sky'; sky.frustumCulled = false; sky.renderOrder = -1000; sky.raycast = () => {};
  sky.userData.noShadow = true; sky.scale.setScalar(900);
  scene.add(sky);
  scene.fog = new THREE.Fog(0xffffff, 55, 330);

  // ── lights ──
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.name = 'sun'; sun.castShadow = true;
  const size = shadowMapSize || (renderer && renderer.capabilities.maxTextureSize >= 8192 && !/Mobi|Android/i.test(globalThis.navigator ? navigator.userAgent : '') ? 4096 : 2048);
  sun.shadow.mapSize.set(size, size);
  sun.shadow.normalBias = SHADOW_NORMAL_BIAS_M;                    // bias is set per fit (it is a fraction of the depth range)
  sun.target.position.copy(centre);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xb7a184, 1);
  hemisphere.name = 'sky-fill';
  const ambient = new THREE.AmbientLight(0xffffff, 0.2);
  const fills = new THREE.Group(); fills.name = 'interior-fill'; fills.visible = false;
  const fillLights = [];
  for (let i = 0; i < FILL_COUNT; i++) { const l = new THREE.PointLight(0xfff1e0, 0, 10, 1.5); l.castShadow = false; fillLights.push(l); fills.add(l); }
  scene.add(sun, sun.target, hemisphere, ambient, fills);

  /**
   * Anchor points of the bounce / fill lights: one per room, one per named zone of the open-plan space. Several floors:
   * the rooms of every level, each anchor's y = its level's elevation (m) and `ceiling` = that level's ceiling (m).
   */
  const anchors = [];
  let order = [], dist = new Float32Array(0), multi = false, houseTop = 0;
  function readAnchors() {
    anchors.length = 0;
    multi = hasLevels(plan);
    houseTop = 0;
    for (const id of multi ? levelIds(plan) : ['L0']) {
      const v = multi ? viewOf(plan, id) : plan, y = multi ? elevationM(plan, id) : 0;
      if (multi) houseTop = Math.max(houseTop, y + v.heights.ceiling / 100);
      for (const room of v.rooms || []) {
        const spots = room.zones && room.zones.length ? room.zones.map((z) => z.label) : [room.label];
        for (const p of spots) if (Array.isArray(p)) { const a = new THREE.Vector3(p[0] / 100, y, p[1] / 100); if (multi) a.ceiling = v.heights.ceiling / 100; anchors.push(a); }
      }
    }
    order = anchors.map((_, i) => i); dist = new Float32Array(anchors.length);
  }
  readAnchors();

  // ── shadow frustum: the whole lot, independent of the camera, snapped to whole texels ──
  // several floors: the box reaches 2 m over the top of the house, so the upper storeys cast and receive like the rest
  const boxCorners = [];
  const readBox = () => {
    boxCorners.length = 0;
    const top = multi ? Math.max(9, houseTop + 2.6) : 9;
    for (const x of [lot.x / 100 - 1.5, (lot.x + lot.w) / 100 + 1.5]) for (const z of [lot.y / 100 - 1.5, (lot.y + lot.h) / 100 + 1.5]) for (const y of [-0.4, top]) boxCorners.push(new THREE.Vector3(x, y, z));
  };
  readBox();
  const _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _lx = new THREE.Vector3(), _ly = new THREE.Vector3();
  const ladder = (v) => Math.pow(TEXEL_LADDER, Math.ceil(Math.log(v) / Math.log(TEXEL_LADDER)));
  /**
   * Fit the sun's orthographic shadow camera around the lot for a light direction.
   * The light-space axes are anchored at the world origin; the texel size is quantised and the frustum centre is
   * rounded to whole texels, so the same world point always lands on the same texel for a given sun direction.
   */
  function fitShadow(dir) {
    _lx.crossVectors(_up, dir).normalize(); _ly.crossVectors(dir, _lx);                // = the shadow camera's own x / y axes
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, d0 = Infinity, d1 = -Infinity;
    for (const c of boxCorners) {
      const x = c.dot(_lx), y = c.dot(_ly), d = c.dot(dir);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); d0 = Math.min(d0, d); d1 = Math.max(d1, d);
    }
    const n = sun.shadow.mapSize.x;
    const tx = ladder((x1 - x0) / (n - 4)), ty = ladder((y1 - y0) / (n - 4));          // 2 texels of slack on every side
    const cx = Math.round((x0 + x1) / 2 / tx) * tx, cy = Math.round((y0 + y1) / 2 / ty) * ty;
    const near = 1, depth = d1 - d0 + 2;
    sun.position.set(0, 0, 0).addScaledVector(_lx, cx).addScaledVector(_ly, cy).addScaledVector(dir, d1 + near + 1);
    sun.target.position.copy(sun.position).sub(dir);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.left = -tx * n / 2; cam.right = tx * n / 2; cam.bottom = -ty * n / 2; cam.top = ty * n / 2; cam.near = near; cam.far = near + depth;
    cam.updateProjectionMatrix();
    sun.shadow.bias = -SHADOW_BIAS_M / depth;
    state.texel = Math.max(tx, ty);
  }

  /** World direction (towards the light) for a compass azimuth / altitude, honouring the plan's north. */
  const direction = (azimuth, altitude, out) => out.fromArray(sunDirectionWorld(azimuth, altitude, northAngle)).normalize();

  const S = { zenith: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color() };
  const state = {
    hours: 13, date: todayAt(where.timeZone), interior: false, study: false, night: 0, day: 1, exposure: 1, k: 0, texel: 0, daylight: 0,
    sky: 'clear', moon: 0,
    fillColor: new THREE.Color(), fillIntensity: 0, info: null,
  };
  const hb = plan.bounds, houseBox = { x0: hb.x / 100, x1: (hb.x + hb.w) / 100, z0: hb.y / 100, z1: (hb.y + hb.h) / 100 };
  const sunDir = new THREE.Vector3(), moonDir = direction(MOON.azimuth, MOON.altitude, new THREE.Vector3()), lightDir = new THREE.Vector3();
  const interiorBounce = new THREE.Color('#fff1df'), warm = new THREE.Color('#ffd7a3'), dayFill = new THREE.Color('#fff3e4'), white = new THREE.Color('#ffffff');

  const OUTSIDE = { sky: new THREE.Color(), ground: new THREE.Color(), ambient: new THREE.Color(), hemi: 1, amb: 0, env: 0, exposure: 1 };
  const INSIDE = { sky: new THREE.Color(), ground: new THREE.Color(), ambient: new THREE.Color(), hemi: 1, amb: 0, env: 0, exposure: 1 };
  /** Mix the outdoor (k = 0) and indoor (k = 1) fill-light looks. */
  function blend(k) {
    state.k = k;
    const mix = (a, b) => a + (b - a) * k;
    hemisphere.color.copy(OUTSIDE.sky).lerp(INSIDE.sky, k);
    hemisphere.groundColor.copy(OUTSIDE.ground).lerp(INSIDE.ground, k);
    hemisphere.intensity = mix(OUTSIDE.hemi, INSIDE.hemi);
    ambient.color.copy(OUTSIDE.ambient).lerp(INSIDE.ambient, k);
    ambient.intensity = mix(OUTSIDE.amb, INSIDE.amb);
    scene.environmentIntensity = mix(OUTSIDE.env, INSIDE.env);
    state.exposure = mix(OUTSIDE.exposure, INSIDE.exposure);
    if (renderer) renderer.toneMappingExposure = state.exposure;
    fills.visible = k > 0.001;
  }

  function apply() {
    const pos = sunPosition({ date: state.date, hours: state.hours, ...where });
    const times = state.info && state.info.date === state.date ? state.info : sunTimes(state.date, where);
    const altitude = pos.elevation, azimuth = pos.azimuth;
    sample(altitude, S);
    const overcast = state.sky === 'overcast';
    if (overcast) {                                                     // grey dome; at night the night colours stay
      const d = smooth(-6, 4, altitude);
      S.zenith.lerp(OVERCAST.zenith, d); S.horizon.lerp(OVERCAST.horizon, d); S.glow = 0;
      const ratio = diffuseHorizontalLux(altitude, 'overcast') / Math.max(1e-6, diffuseHorizontalLux(altitude, 'clear'));
      S.hemiI *= Math.max(0.4, Math.min(1.4, ratio)) * (1 + 0.25 * d);   // no sun: the sky is the only light
      S.exposure *= 1 + (OVERCAST.exposure - 1) * d;
    }
    direction(azimuth, altitude, sunDir);
    const night = smooth(-3, -9, altitude), day = smooth(-6, 8, altitude);
    state.night = night; state.day = day;
    state.info = {
      date: state.date, hours: state.hours, azimuth, elevation: altitude, compass: compassPoint(azimuth),
      sunrise: times.sunrise, sunset: times.sunset, solarNoon: times.solarNoon, dayLength: times.dayLength,
      isDay: altitude > -0.3, declination: pos.declination, utcOffset: pos.utcOffset, direction: sunDir.toArray(),
    };

    // key light: the sun while it is above the horizon (fading out below 3°), off through twilight, a dim moon after dusk
    if (altitude > -3.5) {
      const floor = Math.sin(MIN_LIGHT_ELEVATION * DEG);
      lightDir.copy(sunDir); if (lightDir.y < floor) { lightDir.y = floor; lightDir.normalize(); }
      sun.color.copy(S.sun); sun.intensity = overcast ? 0 : sunIntensityAt(altitude) * (state.study ? STUDY.sun : 1);
      state.moon = 0;
    } else {
      lightDir.copy(moonDir); sun.color.copy(MOON.color);
      state.moon = overcast ? 0 : MOON.intensity * smooth(-4.5, -10, altitude);
      sun.intensity = state.moon * (1 - 0.8 * state.daylight);          // solved (lamp-lit) interiors: a dimmer, truer moon
    }
    fitShadow(lightDir);

    // two looks, blended per frame by how far inside the house the camera is (see update()):
    // outdoors — blue sky from above, warm earth bounce from below;
    // indoors  — little light from above, a bright warm floor bounce on ceilings, lifted exposure (eye adaptation)
    OUTSIDE.sky.copy(S.zenith).lerp(white, 0.55);
    OUTSIDE.ground.set('#b9a385').lerp(S.horizon, 0.25).multiplyScalar(0.55 + 0.45 * day);
    const lift = state.study ? STUDY.fill : 1;                        // sun study: the shaded rooms stay readable from above
    OUTSIDE.hemi = S.hemiI * lift; OUTSIDE.amb = S.ambI * lift; OUTSIDE.env = S.envI; OUTSIDE.exposure = S.exposure;
    OUTSIDE.ambient.copy(S.horizon).lerp(white, 0.5);
    INSIDE.sky.copy(interiorBounce).lerp(S.zenith, 0.12).multiplyScalar(0.5);
    INSIDE.ground.copy(interiorBounce).lerp(S.sun, 0.25 * day);
    // while direct sun is entering the rooms the fill is held back, so the sun patches stay the brightest thing indoors
    const direct = smooth(0, 12, altitude);
    INSIDE.hemi = S.hemiI * (1.9 - 0.45 * direct); INSIDE.amb = S.ambI * 2; INSIDE.env = S.envI * 1.15; INSIDE.exposure = S.exposure * (1.5 - 0.12 * direct);
    INSIDE.ambient.copy(S.horizon).lerp(white, 0.8);
    // interior fill: neutral bounce by day, warm "lights on" glow after dark
    state.fillColor.copy(dayFill).lerp(warm, 1 - day);
    state.fillIntensity = (2.1 - 0.9 * direct) * day + 5.5 * (1 - day);
    blend(state.k);

    const u = skyMaterial.uniforms;
    u.uZenith.value.copy(S.zenith); u.uHorizon.value.copy(S.horizon); u.uSunColor.value.copy(S.sun);
    u.uSunDir.value.copy(sunDir); u.uMoonDir.value.copy(moonDir);
    u.uGlow.value = S.glow; u.uNight.value = night; u.uSunDisc.value = overcast ? 0 : smooth(-2.5, 1.5, altitude);
    scene.fog.color.copy(S.horizon);
  }

  apply();

  return {
    sun, hemisphere, sky,
    /** Clock time 0..24 h (civil time at the site) → sun / moon position, sky colours, light intensities, exposure. */
    setTimeOfDay(hours) {
      const h = Number(hours);
      state.hours = Number.isFinite(h) ? ((h % 24) + 24) % 24 : 13;
      apply();
    },
    /** Calendar day 'YYYY-MM-DD' at the site; anything unparsable falls back to today. */
    setDate(date) {
      const next = typeof date === 'string' && /^\d{4}-\d{1,2}-\d{1,2}/.test(date) ? date.slice(0, 10) : todayAt(where.timeZone);
      if (next === state.date) return;
      state.date = next;
      apply();
    },
    /**
     * Where the sun is right now and today's key times.
     * @returns {{ date: string, hours: number, azimuth: number, elevation: number, compass: string, sunrise: number|null,
     *             sunset: number|null, solarNoon: number, dayLength: number, isDay: boolean, declination: number,
     *             utcOffset: number, direction: number[] }} angles in degrees (azimuth clockwise from true north),
     *             times in decimal local clock hours, `direction` = world unit vector towards the sun
     */
    getSunInfo: () => ({ ...state.info, direction: state.info.direction.slice() }),
    /** Size (m) of one shadow-map texel on a surface facing the light — for diagnostics. */
    getShadowTexel: () => state.texel,
    /**
     * Sun-study look for the roofless dollhouse: the (invisible) roof blocks the sun, so the rooms are lit by sky
     * light only — it is lifted a little and the sun eased so shaded floors stay readable next to the sun patches.
     */
    setSunStudy(on) {
      if (state.study === !!on) return;
      state.study = !!on;
      apply();
    },
    /** Re-read the room list after the plan was edited (anchor points of the interior fill lights; several floors: the shadow box height). */
    refreshPlan() {
      const was = boxCorners.length ? boxCorners[1].y : 0;
      readAnchors(); readBox();
      if (boxCorners[1].y !== was) apply();
    },
    /**
     * true while the roof / ceilings are shown (walk-through). Rooms then get a soft bounce / fill look and a lifted
     * exposure — applied only while the camera is actually inside the house, so exterior views keep true daylight.
     */
    setInteriorMode(on) {
      if (state.interior === !!on) return;
      state.interior = !!on;
      if (!state.interior) blend(0);
    },
    /**
     * Weight (0..1) of the solved daylight (daylight/index.js). While it is shown, the interior "fill" look — point
     * lights in the rooms, warm hemisphere, lifted exposure — is retired: the rooms are lit by the solution instead,
     * and the exterior keeps the true outdoor sky light. At night the weight fades to 0 and the old look returns.
     */
    setDaylight(w) {
      const v = Math.max(0, Math.min(1, Number(w) || 0));
      if (Math.abs(v - state.daylight) < 1e-4) return;
      state.daylight = v;
      if (state.moon > 0) sun.intensity = state.moon * (1 - 0.8 * v);
      if (state.interior) state.forceBlend = true;
    },
    /** Sky model: 'clear' (sun + blue sky) or 'overcast' (no direct sun, grey sky). */
    setSky(type) {
      const next = type === 'overcast' ? 'overcast' : 'clear';
      if (next === state.sky) return;
      state.sky = next;
      apply();
    },
    getSky: () => state.sky,
    /** Night weight 0…1 (1 = the sun more than 9° below the horizon). */
    getNight: () => state.night,
    /** Exposure of the current outdoor / indoor look (before the daylight eye adaptation). */
    getExposure: () => state.exposure,
    /** Per-frame hook: keeps the sky centred on the camera and moves the fill lights to the rooms around it. */
    update(camera) {
      if (!camera || state.disposed) return;
      camera.getWorldPosition(_v);
      sky.position.copy(_v);
      if (camera.far) { sky.scale.setScalar(camera.far * 0.95); scene.fog.far = Math.min(330, camera.far * 0.9); }
      if (!state.interior) return;
      // indoor look only while the camera is under the roof; fades out within 2.5 m of the facade
      const H = multi ? houseTop : ceilingH();                         // several floors: under the top level's ceiling
      const away = Math.max(houseBox.x0 - _v.x, _v.x - houseBox.x1, houseBox.z0 - _v.z, _v.z - houseBox.z1, _v.y - H, 0);
      const k = (1 - smooth(0, 2.5, away)) * (1 - state.daylight);
      if (Math.abs(k - state.k) > 0.002 || state.forceBlend) { state.forceBlend = false; blend(k); }
      if (k <= 0.001 || !anchors.length) return;
      const y = H * 0.6;
      // several floors: the anchors of the camera's own level come first (another storey's rooms are 3 m × 4 further)
      if (multi) for (let i = 0; i < anchors.length; i++) dist[i] = Math.hypot(anchors[i].x - _v.x, anchors[i].z - _v.z, _v.y >= anchors[i].y - 0.2 && _v.y < anchors[i].y + anchors[i].ceiling + 0.4 ? 0 : 12);
      else for (let i = 0; i < anchors.length; i++) dist[i] = Math.hypot(anchors[i].x - _v.x, anchors[i].z - _v.z);
      order.sort((a, b) => dist[a] - dist[b]);
      const cutoff = anchors.length > FILL_COUNT ? dist[order[FILL_COUNT]] : Infinity;
      for (let i = 0; i < FILL_COUNT; i++) {
        const light = fillLights[i], a = order[i];
        if (a === undefined) { light.intensity = 0; continue; }
        light.position.set(anchors[a].x, multi ? anchors[a].y + anchors[a].ceiling * 0.6 : y, anchors[a].z);
        light.color.copy(state.fillColor);
        light.intensity = state.fillIntensity * k * (cutoff === Infinity ? 1 : smooth(0, 2.5, cutoff - dist[a]));
      }
    },
    dispose() {
      state.disposed = true;
      scene.remove(sun, sun.target, hemisphere, ambient, fills, sky);
      sun.shadow.map?.dispose(); sun.dispose();
      sky.geometry.dispose(); skyMaterial.dispose();
      if (envTexture) envTexture.dispose();
      scene.environment = previousEnvironment || null;
      scene.fog = previousFog || null;
    },
  };
}
