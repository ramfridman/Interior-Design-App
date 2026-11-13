/**
 * Sky model for the daylight solver — pure maths, no THREE, no DOM (runs in node, in a Worker and in the page).
 *
 * The sky dome is split into the 145 Tregenza patches used by daylight-coefficient tools (Radiance / DAYSIM):
 * 12° altitude bands with 30, 30, 24, 24, 18, 12, 6 patches and one zenith cap. The solver caches, per receiver,
 * how much of each sky patch it sees (through glass, past the building); relighting for a new sun position is then
 * a sparse dot product with the patch radiances computed here.
 *
 * Luminance distribution: CIE standard general sky (ISO 15469 / CIE S 011) — type 12 "CIE standard clear sky,
 * low luminance turbidity" and type 1 "CIE standard overcast sky" — with the absolute level set from the diffuse
 * horizontal illuminance of a clear sky (IES clear-sky fit, 0.8 + 15.5·√sin h klux) or of an overcast sky
 * (Krochmann, 0.3 + 21·sin h klux). Twilight (sun below the horizon) decays exponentially to ≈ 4 lux at −6°.
 *
 * Frames and units
 *   world frame: X = plan east, Y = up, Z = plan south (the same as the 3D view); directions are unit vectors.
 *   photometric scale: 1 renderer unit of irradiance = LUX_PER_UNIT lux (the existing sun light of the 3D view has
 *   intensity ≈ 2 at high sun ≈ 100 klux direct normal illuminance).
 */

export const LUX_PER_UNIT = 50000;

const BAND_COUNTS = [30, 30, 24, 24, 18, 12, 6, 1];
const BAND_DEG = 12;
const DEG = Math.PI / 180;

/** Static description of the 145 sky bins. */
function makeBins() {
  const start = [], dirs = [], omega = [], cosOmega = [];
  let n = 0;
  for (let b = 0; b < BAND_COUNTS.length; b++) {
    start.push(n);
    const a0 = b * BAND_DEG * DEG, a1 = Math.min(90, (b + 1) * BAND_DEG) * DEG, count = BAND_COUNTS[b];
    const dPhi = (2 * Math.PI) / count;
    for (let i = 0; i < count; i++) {
      const alt = b === BAND_COUNTS.length - 1 ? 90 * DEG : (a0 + a1) / 2, az = (i + 0.5) * dPhi;
      dirs.push([Math.cos(alt) * Math.cos(az), Math.sin(alt), Math.cos(alt) * Math.sin(az)]);
      omega.push(dPhi * (Math.sin(a1) - Math.sin(a0)));
      cosOmega.push(dPhi * (Math.sin(a1) ** 2 - Math.sin(a0) ** 2) / 2);   // ∫ cos(zenith) dω over the bin
      n++;
    }
  }
  return { count: n, start, dirs, omega, cosOmega };
}
export const SKY = makeBins();
export const SKY_BINS = SKY.count;

/** Sky bin index of a world direction with dy ≥ 0 (directions below the horizon are clamped onto band 0). */
export function binOf(dx, dy, dz) {
  const alt = Math.asin(Math.max(0, Math.min(1, dy))) / DEG;
  const band = Math.min(BAND_COUNTS.length - 1, Math.floor(alt / BAND_DEG));
  const count = BAND_COUNTS[band];
  let az = Math.atan2(dz, dx); if (az < 0) az += 2 * Math.PI;
  return SKY.start[band] + Math.min(count - 1, Math.floor((az / (2 * Math.PI)) * count));
}

/** CIE general sky relative luminance (unnormalised) for a sky direction and a sun direction. */
const CIE = { clear: { a: -1, b: -0.32, c: 10, d: -3, e: 0.45 }, overcast: { a: 4, b: -0.7, c: 0, d: -1, e: 0 } };
function cieRelative(p, dir, sun) {
  const cz = Math.max(0.01, dir[1]);
  const phi = 1 + p.a * Math.exp(p.b / cz);
  const cosChi = Math.max(-1, Math.min(1, dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2]));
  const chi = Math.acos(cosChi);
  const f = 1 + p.c * (Math.exp(p.d * chi) - Math.exp(p.d * Math.PI / 2)) + p.e * cosChi * cosChi;
  return Math.max(0, phi * f);
}

/** Air mass (Kasten & Young 1989) for a solar altitude in degrees. */
export function airMass(altDeg) {
  const h = Math.max(-0.5, altDeg);
  return 1 / (Math.sin(h * DEG) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

/** Direct normal illuminance of the clear-sky sun in lux (Linke-like single-coefficient extinction). */
export function sunNormalLux(altDeg) {
  if (altDeg <= -0.5) return 0;
  return 127500 * Math.exp(-0.21 * airMass(altDeg)) * Math.min(1, (altDeg + 0.5) / 2);
}

/** Diffuse horizontal illuminance (lux) of an unobstructed sky for a solar altitude in degrees. */
export function diffuseHorizontalLux(altDeg, type = 'clear') {
  if (altDeg > 0) {
    const s = Math.sin(altDeg * DEG);
    return type === 'overcast' ? 300 + 21000 * s : 800 + 15500 * Math.sqrt(s);
  }
  const base = type === 'overcast' ? 300 : 800;
  return base * Math.exp(Math.max(-30, altDeg) * 0.9);                 // twilight: ≈ 3.6 lux at −6°, ~0 by −12°
}

/** Linear-RGB tints of the sky (unit luminance). */
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const unit = (c) => { const l = lum(c) || 1; return [c[0] / l, c[1] / l, c[2] / l]; };
const ZENITH = unit([0.42, 0.62, 1.0]), HORIZON = unit([0.9, 0.93, 0.97]), WARM = unit([1.0, 0.72, 0.45]), GREY = unit([0.92, 0.94, 0.97]);

/**
 * Radiance of every sky bin (renderer units per steradian, linear RGB, 3 floats per bin).
 * @param {{ sunDir: number[], type?: 'clear'|'overcast', scale?: number, out?: Float32Array }} o
 *        sunDir = world unit vector towards the sun (may point below the horizon); scale multiplies the result
 * @returns {{ radiance: Float32Array, horizontal: number }} horizontal = diffuse horizontal irradiance (renderer units)
 */
export function skyRadiance({ sunDir, type = 'clear', scale = 1, out }) {
  const radiance = out || new Float32Array(SKY_BINS * 3);
  const alt = Math.asin(Math.max(-1, Math.min(1, sunDir[1]))) / DEG;
  const p = CIE[type] || CIE.clear;
  const sun = [sunDir[0], Math.max(sunDir[1], -0.2), sunDir[2]];
  // relative luminance per bin (3×3 sub-samples so the circumsolar peak is integrated, not point-sampled)
  let norm = 0;
  const rel = new Float64Array(SKY_BINS);
  for (let b = 0; b < BAND_COUNTS.length; b++) {
    const count = BAND_COUNTS[b], a0 = b * BAND_DEG, a1 = Math.min(90, (b + 1) * BAND_DEG);
    for (let i = 0; i < count; i++) {
      let s = 0;
      for (let u = 0; u < 3; u++) for (let v = 0; v < 3; v++) {
        const al = (a0 + (a1 - a0) * (u + 0.5) / 3) * DEG, az = ((i + (v + 0.5) / 3) / count) * 2 * Math.PI;
        s += cieRelative(p, [Math.cos(al) * Math.cos(az), Math.sin(al), Math.cos(al) * Math.sin(az)], sun);
      }
      const k = SKY.start[b] + i;
      rel[k] = s / 9;
      norm += rel[k] * SKY.cosOmega[k];
    }
  }
  const horizontal = (diffuseHorizontalLux(alt, type) / LUX_PER_UNIT) * scale;
  const k = norm > 0 ? horizontal / norm : 0;
  const warmth = type === 'clear' ? Math.max(0, Math.min(1, 1 - (alt - 2) / 18)) : 0;  // low sun: warm horizon around the sun
  for (let i = 0; i < SKY_BINS; i++) {
    const d = SKY.dirs[i], t = Math.pow(Math.max(0, d[1]), 0.5);
    const toSun = Math.max(0, d[0] * sun[0] + d[2] * sun[2]) / Math.max(1e-6, Math.hypot(sun[0], sun[2]));
    let c;
    if (type === 'overcast') c = GREY;
    else {
      const h = HORIZON.map((x, j) => x + (WARM[j] - x) * warmth * toSun * (1 - t));
      c = h.map((x, j) => x + (ZENITH[j] - x) * t * (1 - 0.6 * warmth));
    }
    const l = rel[i] * k, cl = lum(c) || 1;
    radiance[i * 3] = (l * c[0]) / cl; radiance[i * 3 + 1] = (l * c[1]) / cl; radiance[i * 3 + 2] = (l * c[2]) / cl;
  }
  return { radiance, horizontal };
}
