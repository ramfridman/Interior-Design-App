/**
 * Placed items → inputs of the daylight solver: lamps (point emitters) and furniture boxes (occluders).
 * Pure functions, no THREE, no DOM (unit-tested in node).
 *
 *   lampSpec(item)              → { lm, lobe, down, color } | null   luminous flux / distribution / colour of a lighting item
 *   lampEmitters(item, points)  → solver lamps for the item's bulb positions (world metres), flux split between them
 *   occluderBox(item, baseY)    → { id, corners, y0, y1 } | null     solid box for the visibility pass (big furniture only)
 *
 * Photometry (typical retail values for warm-white LED lamps; product params override):
 *   params.lumens / params.lm → flux; params.cct / params.kelvin → colour temperature (K); params.lightColor → colour.
 *   Default colour temperature 2700 K. The colour is a blackbody tint, partly white-balanced (the eye adapts to warm
 *   light), normalised to unit luminance — the solver multiplies it by lm / LUX_PER_UNIT.
 * Distribution: `down` = Lambertian downlight (flush ceiling lights, spots, panels); otherwise `lobe` ∈ [−1, 1]:
 *   intensity ∝ 1 + lobe · cos(angle from straight up) (−0.8 ≈ an opaque dome shade, 0 = bare bulb / paper globe,
 *   +0.9 = torchiere uplighter). Both keep the total flux.
 */

export const LAMP_TYPES = new Set(['floor-lamp', 'table-lamp', 'pendant', 'ceiling-light', 'wall-light', 'ceiling-fan', 'outdoor-light']);

const int = (v, d, lo = 1, hi = 24) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
/** [lm per bulb/head, lobe | 'down', bulbs from params.count?] per type → variant ('*' = default). */
const TABLE = {
  'ceiling-light': { '*': [1600, 'down'], flush: [1600, 'down'], 'semi-flush': [1600, -0.5], panel: [3000, 'down'], spot: [450, 'down', 3], track: [450, 'down', 3], downlight: [650, 'down', 1] },
  pendant: { '*': [1100, -0.8], dome: [1100, -0.85], cone: [1000, -0.9], cylinder: [900, -0.9], drum: [1300, -0.4], globe: [1200, -0.1], paper: [1100, 0], rattan: [900, -0.3], sputnik: [2000, -0.1], ring: [1600, -0.6], chandelier: [2400, -0.1], linear: [500, -0.7, 3], cluster: [400, -0.4, 3] },
  'floor-lamp': { '*': [1200, -0.3], shade: [1200, -0.3], arc: [1000, -0.8], tripod: [1100, -0.3], reading: [600, -0.8], torchiere: [2500, 0.9], paper: [1000, 0], globe: [1000, 0] },
  'table-lamp': { '*': [450, -0.3], shade: [450, -0.3], dome: [400, -0.8], globe: [350, 0], desk: [400, -0.9], mushroom: [350, -0.5], lantern: [300, 0] },
  'wall-light': { '*': [400, 0], sconce: [400, 0], 'up-down': [600, 0], 'swing-arm': [400, -0.6], picture: [250, -0.5], bulkhead: [500, -0.2], lantern: [400, 0], strip: [500, -0.3] },
  'ceiling-fan': { '*': [1200, 'down'] },
  'outdoor-light': { '*': [300, -0.5], bollard: [300, -0.8], 'spike-spot': [400, 0.6], 'post-lantern': [600, -0.2], string: [60, 0, 10], wall: [500, -0.4], step: [100, -0.9], 'solar-path': [50, -0.8], flood: [2000, -0.3], lantern: [400, 0], globe: [500, 0] },
};

const isOn = (p) => p.on !== false && p.on !== 'false' && p.on !== 0;

/** sRGB hex → linear RGB (null when unparsable). */
function hexLinear(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
}
const unitLum = (c) => { const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] || 1; return c.map((v) => v / l); };

/**
 * Linear RGB (unit luminance) of a blackbody at `kelvin`, 45 % white-balanced towards neutral (chromatic adaptation:
 * 2700 K reads warm, not orange). Tanner Helland's fit of the Planckian locus in sRGB.
 */
export function kelvinColor(kelvin = 2700, adapt = 0.45) {
  const t = Math.max(10, Math.min(400, Number(kelvin) / 100 || 27));
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const s = [r, g, b].map((v) => Math.max(0, Math.min(255, v)) / 255).map((v) => v + (1 - v) * adapt);
  return unitLum(s.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))));
}

/**
 * Photometry of a lighting item, or null if it is not a lamp / is switched off in its params.
 * @returns {{ lm: number, lobe: number, down: boolean, color: number[], kelvin: number } | null}
 */
export function lampSpec(item) {
  if (!item || !LAMP_TYPES.has(item.type)) return null;
  const p = item.params || {};
  if (!isOn(p)) return null;
  if (item.type === 'ceiling-fan' && !(p.light === true || p.light === 'true' || (p.light == null && (p.variant || 'modern') === 'classic'))) return null;
  const T = TABLE[item.type], row = T[p.variant] || T['*'];
  const bulbs = row[2] ? int(p.count, row[2]) : 1;
  let lm = row[0] * bulbs;
  const given = Number(p.lumens ?? p.lm);
  if (Number.isFinite(given) && given > 0) lm = given;
  const kelvin = Number(p.cct ?? p.kelvin) > 0 ? Number(p.cct ?? p.kelvin) : 2700;
  const color = (p.lightColor && hexLinear(p.lightColor) && unitLum(hexLinear(p.lightColor))) || kelvinColor(kelvin);
  return { lm, lobe: row[1] === 'down' ? 0 : row[1], down: row[1] === 'down', color, kelvin };
}

/** Solver lamps for an item: one emitter per bulb position (world m), the item's flux split between them. */
export function lampEmitters(item, points) {
  const s = lampSpec(item);
  if (!s || !points || !points.length) return [];
  const lm = s.lm / points.length;
  return points.map(([x, y, z]) => ({ id: item.id, x, y, z, lm, lobe: s.lobe, down: s.down, color: s.color }));
}

/**
 * Item types that block light, with the height (cm) of their solid part — a bed's or sofa's body, not the headboard
 * or back cushions; null = the whole box. Open furniture (tables, chairs, stools, desks), lamps, rugs, plants, décor
 * and wall art are left out: they cast little shade on bounced light (their real-time shadows still show).
 */
export const OCCLUDER_TYPES = {
  wardrobe: null, bookcase: null, cabinet: null, 'kitchen-base': null, 'kitchen-wall': null, 'kitchen-tall': null,
  fridge: null, range: null, dishwasher: null, washer: null, vanity: null, 'water-heater': null, 'carpentry-unit': null,
  bed: 55, 'bunk-bed': null, sofa: 70, armchair: 70, bathtub: 60,
};
const MIN_AREA_M2 = 0.12, MIN_HEIGHT_CM = 35;

/**
 * Occluder box of an item (or null): rotated footprint corners (plan cm) and solid height range (m above the floor).
 * @param {object} item  store item ({ type, x, y, w, d, h, rot, elev, hidden })
 * @param {number} [baseY=0] world Y (m) of the floor under the item (items outdoors are below 0 and are skipped)
 */
export function occluderBox(item, baseY = 0) {
  if (!item || item.hidden || !(item.type in OCCLUDER_TYPES) || baseY < -0.05) return null;
  const w = +item.w, d = +item.d, h = +item.h;
  if (!(w > 0 && d > 0 && h > 0)) return null;
  const cap = OCCLUDER_TYPES[item.type], solid = cap == null ? h : Math.min(h, cap);
  if ((w * d) / 1e4 < MIN_AREA_M2 || solid < MIN_HEIGHT_CM) return null;
  const c = Math.cos(((item.rot || 0) * Math.PI) / 180), s = Math.sin(((item.rot || 0) * Math.PI) / 180);
  const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([lx, ly]) => [
    Math.round((+item.x + lx * c - ly * s) * 10) / 10, Math.round((+item.y + lx * s + ly * c) * 10) / 10]);
  const y0 = Math.max(0, baseY + (+item.elev || 0) / 100);
  return { id: item.id, corners, y0: Math.round(y0 * 1000) / 1000, y1: Math.round((y0 + solid / 100) * 1000) / 1000 };
}
