/**
 * Daylight, sky and exposure for the 3D view.
 *
 *   const env = createEnvironment({ scene, renderer, ctx });
 *   env.setTimeOfDay(store.ui.timeOfDay);      // 0..24 h local clock time
 *   env.setInteriorMode(true);                 // roof on / walk-through: soft fill so rooms read well
 *   env.update(camera);                        // once per frame (cheap)
 *
 * Sun path: real solar geometry for the site (32.68° N, plan north from PLAN.meta.northAngle) on a late-spring
 * day (declination +15°, Israel summer time) — high crisp noon sun, long warm evenings, sunset ≈ 19:15.
 * The sun is one DirectionalLight whose orthographic shadow frustum is fitted to the whole lot (it does not
 * follow the camera, so shadows never swim). After sunset the same light becomes a dim moon.
 * The module configures the renderer it is given: soft shadow maps, ACES tone mapping, sRGB output, exposure.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const LATITUDE = 32.68, DECLINATION = 15, SOLAR_NOON = 12.65;   // degrees, degrees, clock hour of solar noon (IDT)
const DEG = Math.PI / 180;
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
 * Sun position for a clock hour at the site.
 * @returns {{ altitude: number, azimuth: number }} degrees; azimuth clockwise from true north
 */
export function sunPosition(hours) {
  const ha = (hours - SOLAR_NOON) * 15 * DEG, lat = LATITUDE * DEG, dec = DECLINATION * DEG;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));
  return { altitude: alt / DEG, azimuth: ((az / DEG) + 360) % 360 };
}

/**
 * @param {{ scene: THREE.Scene, renderer: THREE.WebGLRenderer, ctx: object, shadowMapSize?: number }} options
 * @returns {{ setTimeOfDay(hours: number): void, setInteriorMode(on: boolean): void, update(camera: THREE.Camera): void,
 *             sun: THREE.DirectionalLight, hemisphere: THREE.HemisphereLight, sky: THREE.Mesh, dispose(): void }}
 */
export function createEnvironment({ scene, renderer, ctx, shadowMapSize }) {
  const plan = ctx.plan;
  const northAngle = (plan.meta && Number(plan.meta.northAngle)) || 0;
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
  sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.022; sun.shadow.radius = 2.2;
  sun.target.position.copy(centre);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xb7a184, 1);
  hemisphere.name = 'sky-fill';
  const ambient = new THREE.AmbientLight(0xffffff, 0.2);
  const fills = new THREE.Group(); fills.name = 'interior-fill'; fills.visible = false;
  const fillLights = [];
  for (let i = 0; i < FILL_COUNT; i++) { const l = new THREE.PointLight(0xfff1e0, 0, 10, 1.5); l.castShadow = false; fillLights.push(l); fills.add(l); }
  scene.add(sun, sun.target, hemisphere, ambient, fills);

  /** Anchor points of the bounce / fill lights: one per room, one per named zone of the open-plan space. */
  const anchors = [];
  for (const room of plan.rooms || []) {
    const spots = room.zones && room.zones.length ? room.zones.map((z) => z.label) : [room.label];
    for (const p of spots) if (Array.isArray(p)) anchors.push(new THREE.Vector3(p[0] / 100, 0, p[1] / 100));
  }

  // ── shadow frustum fitted to the lot ──
  const boxCorners = [];
  for (const x of [lot.x / 100 - 1.5, (lot.x + lot.w) / 100 + 1.5]) for (const z of [lot.y / 100 - 1.5, (lot.y + lot.h) / 100 + 1.5]) for (const y of [-0.4, 9]) boxCorners.push(new THREE.Vector3(x, y, z));
  const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function fitShadow(dir) {
    sun.position.copy(centre).addScaledVector(dir, 70);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    _m.lookAt(sun.position, centre, _up).setPosition(sun.position).invert();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const c of boxCorners) {
      _v.copy(c).applyMatrix4(_m);
      x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y); z0 = Math.min(z0, -_v.z); z1 = Math.max(z1, -_v.z);
    }
    const cam = sun.shadow.camera;
    cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1; cam.near = Math.max(0.5, z0 - 2); cam.far = z1 + 2;
    cam.updateProjectionMatrix();
  }

  /** World direction (towards the light) for a compass azimuth / altitude, honouring the plan's north. */
  const direction = (azimuth, altitude, out) => {
    const th = (northAngle + azimuth) * DEG, al = altitude * DEG;
    return out.set(Math.sin(th) * Math.cos(al), Math.sin(al), -Math.cos(th) * Math.cos(al)).normalize();
  };

  const S = { zenith: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color() };
  const state = { hours: 13, interior: false, night: 0, day: 1, exposure: 1 };
  const sunDir = new THREE.Vector3(), moonDir = direction(MOON.azimuth, MOON.altitude, new THREE.Vector3()), lightDir = new THREE.Vector3();
  const interiorBounce = new THREE.Color('#fff1df'), warm = new THREE.Color('#ffd7a3'), dayFill = new THREE.Color('#fff3e4'), white = new THREE.Color('#ffffff');

  function apply() {
    const { altitude, azimuth } = sunPosition(state.hours);
    sample(altitude, S);
    direction(azimuth, altitude, sunDir);
    const night = smooth(-3, -9, altitude), day = smooth(-6, 8, altitude);
    state.night = night; state.day = day;

    // key light: sun above the horizon, moon after dusk (cross-faded through zero, so no visible jump)
    if (altitude > -3.5) {
      lightDir.copy(sunDir); if (lightDir.y < 0.035) { lightDir.y = 0.035; lightDir.normalize(); }
      sun.color.copy(S.sun); sun.intensity = S.sunI;
    } else {
      lightDir.copy(moonDir); sun.color.copy(MOON.color); sun.intensity = MOON.intensity * smooth(-4.5, -10, altitude);
    }
    fitShadow(lightDir);

    const interior = state.interior;
    // outdoors: blue sky above, warm earth bounce below; indoors: near-white bounce from ceiling and floor
    if (interior) {                                                    // floors get little from above, ceilings a bright floor bounce
      hemisphere.color.copy(interiorBounce).lerp(S.zenith, 0.12).multiplyScalar(0.5);
      hemisphere.groundColor.copy(interiorBounce).lerp(S.sun, 0.25 * day);
    } else {
      hemisphere.color.copy(S.zenith).lerp(white, 0.55);
      hemisphere.groundColor.set('#b9a385').lerp(S.horizon, 0.25).multiplyScalar(0.55 + 0.45 * day);
    }
    hemisphere.intensity = S.hemiI * (interior ? 1.9 : 1);
    ambient.color.copy(S.horizon).lerp(white, interior ? 0.8 : 0.5);
    ambient.intensity = S.ambI * (interior ? 2 : 1);
    scene.environmentIntensity = S.envI * (interior ? 1.15 : 1);

    // interior fill: neutral bounce by day, warm "lights on" glow after dark
    fills.visible = interior;
    state.fillColor = dayFill.clone().lerp(warm, 1 - day);
    state.fillIntensity = 2.1 * day + 5.5 * (1 - day);

    state.exposure = S.exposure * (interior ? 1.5 : 1);
    if (renderer) renderer.toneMappingExposure = state.exposure;

    const u = skyMaterial.uniforms;
    u.uZenith.value.copy(S.zenith); u.uHorizon.value.copy(S.horizon); u.uSunColor.value.copy(S.sun);
    u.uSunDir.value.copy(sunDir); u.uMoonDir.value.copy(moonDir);
    u.uGlow.value = S.glow; u.uNight.value = night; u.uSunDisc.value = smooth(-2.5, 1.5, altitude);
    scene.fog.color.copy(S.horizon);
  }

  const order = anchors.map((_, i) => i), dist = new Float32Array(anchors.length);
  apply();

  return {
    sun, hemisphere, sky,
    /** Clock time 0..24 h → sun / moon position, sky colours, light intensities, exposure. */
    setTimeOfDay(hours) {
      const h = Number(hours);
      state.hours = Number.isFinite(h) ? ((h % 24) + 24) % 24 : 13;
      apply();
    },
    /** true while the roof / ceilings are shown (walk-through): adds soft per-room fill so interiors are inviting. */
    setInteriorMode(on) {
      if (state.interior === !!on) return;
      state.interior = !!on;
      apply();
    },
    /** Per-frame hook: keeps the sky centred on the camera and moves the fill lights to the rooms around it. */
    update(camera) {
      if (!camera) return;
      camera.getWorldPosition(_v);
      sky.position.copy(_v);
      if (camera.far) { sky.scale.setScalar(camera.far * 0.95); scene.fog.far = Math.min(330, camera.far * 0.9); }
      if (!state.interior || !anchors.length) return;
      const y = ceilingH() * 0.6;
      for (let i = 0; i < anchors.length; i++) dist[i] = Math.hypot(anchors[i].x - _v.x, anchors[i].z - _v.z);
      order.sort((a, b) => dist[a] - dist[b]);
      const cutoff = anchors.length > FILL_COUNT ? dist[order[FILL_COUNT]] : Infinity;
      for (let i = 0; i < FILL_COUNT; i++) {
        const light = fillLights[i], a = order[i];
        if (a === undefined) { light.intensity = 0; continue; }
        light.position.set(anchors[a].x, y, anchors[a].z);
        light.color.copy(state.fillColor);
        light.intensity = state.fillIntensity * (cutoff === Infinity ? 1 : smooth(0, 2.5, cutoff - dist[a]));
      }
    },
    dispose() {
      scene.remove(sun, sun.target, hemisphere, ambient, fills, sky);
      sun.shadow.map?.dispose(); sun.dispose();
      sky.geometry.dispose(); skyMaterial.dispose();
      if (envTexture) envTexture.dispose();
      scene.environment = previousEnvironment || null;
      scene.fog = previousFog || null;
    },
  };
}
