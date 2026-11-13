/**
 * Daylight solver — a small, physically based diffuse global-illumination engine for this house.
 * Pure JavaScript: no THREE, no DOM. Runs under plain node (tests), in a Web Worker and on the main thread.
 *
 * GEOMETRY (exploits the extruded orthogonal plan)
 *   Every plan coordinate is on a 5 cm grid, so the building is rasterised exactly into 5 cm columns:
 *   ROOM (air from the floor 0 to the ceiling H), WALL (solid 0…H), OPEN (an opening: solid below the sill and above
 *   the head, air — or glass — in between) and OUT (outdoors, ground at −0.15 m garden / −0.02 m slabs). The roof
 *   slab + parapet closes every non-OUT column from H up to H + slab + parapet. Closed doors are solid columns.
 *   Rays are marched through this grid with a 2D DDA (Amanatides–Woo) plus empty-space skipping (a Chebyshev
 *   distance field) and exact height tests per column — light cannot leak through a 10 cm partition.
 *
 * SURFACES → PATCHES → LIGHTMAP TEXELS
 *   Every indoor surface (floors, ceilings, wall faces, window / door reveals, sills, lintels, door thresholds) is
 *   split into charts (one per surface plane and region) of ≈ 25 cm texels (ceilings 50 cm). One texel = one patch.
 *   Regions are rooms or openings, so a chart never spans a wall: texels on both sides of a partition are separate.
 *
 * VISIBILITY CACHE (expensive, geometry only; recomputed on plan / ceiling / door changes)
 *   For every receiver (patch, or one of the 6 axis directions of an irradiance probe):
 *   • hemisphere rays (stratified, cosine weighted) that stay indoors → links to the patches they hit;
 *   • aperture sampling: stratified points on the glass plane of every exterior opening the receiver can see
 *     (form-factor quadrature cosθr·cosθa·A/(π r²)), each ray continued outdoors → sky bin (145 Tregenza bins),
 *     ground cell (1 m), facade element, or an indoor patch it re-enters. Glass multiplies by its transmittance.
 *   Hemisphere rays leaving the building are dropped (the apertures account for everything outdoors), so the two
 *   estimators partition the hemisphere without double counting.
 *   Outdoor elements (ground cells, facade elements) cache their own sky-bin and outdoor links.
 *
 * RELIGHT (fast; any sun position / sky / albedo)
 *   sky bin radiances (CIE clear or overcast) → outdoor element radiance (sun with a shadow ray, sky, ground–facade
 *   exchange) → per patch: direct sun (shadow rays, only for patches that can see the sun's sky region), cached
 *   sky + outdoor light, then Jacobi diffuse bounces between patches (albedo from the finishes, colour bleeding).
 *   Output: the lightmap irradiance (everything EXCEPT the direct sun on the receiving surface — that is drawn by the
 *   shadow-mapped sun of the 3D view, so it is never counted twice) and probe ambient cubes for furniture.
 *
 * UNITS: linear RGB irradiance in renderer units (1 unit = LUX_PER_UNIT lux, see sky.js). Distances in metres.
 */
import { SKY_BINS, SKY, binOf, skyRadiance, LUX_PER_UNIT } from './sky.js';

export { LUX_PER_UNIT };
export const CELL_M = 0.05;
const CS = CELL_M, CELL_CM = 5;
const OUT = 0, ROOM = 1, WALL = 2, OPEN = 3;
export const SURF = { FLOOR: 0, CEILING: 1, WALL: 2, SILL: 3, LINTEL: 4, THRESHOLD: 5, AVERAGE: 6 };
const PAD = 1;                                     // atlas padding (texels) around every chart
const HIT_NONE = 0, HIT_PATCH = 1, HIT_SKY = 2, HIT_GROUND = 3, HIT_FACADE = 4, HIT_EXITED = 5;
const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const PROBE_HEIGHTS = [0.8, 1.7];           // m — work plane and upper body / eye height
const FIELD_CELLS = 2;                             // field texel = 2 × 2 cells = 10 cm

export const DEFAULTS = {
  glass: 0.78,             // normal-incidence visible transmittance of the double glazing
  tile: 5, ceilingTile: 10, rowCm: 25,
  hemiRays: 64, apertureCm: 40, probeSpacing: 1.0, probeRays: 48,
  outdoorRays: 32, ground: 1.0,
  sunSamples: 3,
};

// ───────────────────────── small helpers ─────────────────────────
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Deterministic PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hexToLinear = (hex, fallback = [0.6, 0.6, 0.6]) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return fallback.slice();
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
};
export { hexToLinear };

/** Growable typed arrays for the sparse link lists. */
class Links {
  constructor(cap = 1 << 16) { this.idx = new Int32Array(cap); this.w = new Float32Array(cap); this.n = 0; this.start = [0]; }
  push(i, w) {
    if (this.n === this.idx.length) {
      const idx = new Int32Array(this.idx.length * 2); idx.set(this.idx); this.idx = idx;
      const ww = new Float32Array(this.w.length * 2); ww.set(this.w); this.w = ww;
    }
    this.idx[this.n] = i; this.w[this.n++] = w;
  }
  close() { this.start.push(this.n); }
  pack() { return { start: Int32Array.from(this.start), idx: this.idx.slice(0, this.n), w: this.w.slice(0, this.n) }; }
}

// ───────────────────────── input ─────────────────────────
/**
 * Plain, transferable description of the building from PLAN (+ live project values).
 * @param {object} plan PLAN
 * @param {{ ceilingCm?: number, doorsOpen?: boolean, glass?: number }} [o]
 */
export function sceneInputFromPlan(plan, o = {}) {
  const h = plan.heights || {};
  const ceiling = Number(o.ceilingCm) >= 200 ? Math.min(600, Number(o.ceilingCm)) : (h.ceiling || 300);
  const rect = (r) => ({ x: +r.x, y: +r.y, w: +r.w, h: +r.h });
  return {
    walls: (plan.walls || []).filter((w) => w.w > 0 && w.h > 0).map(rect),
    openings: (plan.openings || []).filter((q) => q.w > 0 && q.h > 0).map((q) => ({
      ...rect(q), id: q.id, axis: q.axis, kind: q.kind, style: q.style, sill: +q.sill || 0, height: +q.height || 0,
      width: +q.width || 0, exterior: !!q.exterior, rooms: (q.rooms || []).slice(),
    })),
    rooms: (plan.rooms || []).filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3).map((r) => ({ id: r.id, type: r.type, polygon: r.polygon.map((p) => [p[0], p[1]]) })),
    outdoorAreas: (plan.outdoorAreas || []).map((a) => ({ id: a.id, type: a.type, polygon: a.polygon.map((p) => [p[0], p[1]]) })),
    paths: ((plan.site && plan.site.paths) || []).map((p) => p.polygon.map((q) => [q[0], q[1]])),
    parking: ((plan.site && plan.site.parking) || []).map(rect),
    lot: rect((plan.site && plan.site.bounds) || { x: plan.bounds.x - 500, y: plan.bounds.y - 500, w: plan.bounds.w + 1000, h: plan.bounds.h + 1000 }),
    bounds: rect(plan.bounds),
    H: ceiling / 100, slab: (h.slab || 20) / 100, parapet: (h.parapet || 0) / 100, drop: (h.floorAboveGround || 15) / 100,
    doorsOpen: o.doorsOpen !== false, glass: Number.isFinite(o.glass) ? o.glass : DEFAULTS.glass,
  };
}

// ───────────────────────── scene: grid, charts, patches, atlas ─────────────────────────
/**
 * Rasterise the building and lay out patches + lightmap atlas. Fast (≈ 10–40 ms); deterministic, so the page and the
 * worker build identical layouts from the same input.
 */
export function buildScene(input, opts = {}) {
  const O = { ...DEFAULTS, ...opts };
  const H = input.H, roofTop = input.H + input.slab + input.parapet, drop = input.drop;
  const B = input.bounds, M = 20;                                          // 20 cm of outdoors around the house
  const oxcm = Math.floor((B.x - M) / CELL_CM) * CELL_CM, ozcm = Math.floor((B.y - M) / CELL_CM) * CELL_CM;
  const nx = Math.ceil((B.x + B.w + M - oxcm) / CELL_CM), ny = Math.ceil((B.y + B.h + M - ozcm) / CELL_CM), nc = nx * ny;
  const ox = oxcm / 100, oz = ozcm / 100;
  const kind = new Uint8Array(nc), reg = new Int16Array(nc).fill(-1), gcls = new Uint8Array(nc);
  const cellsIn = (x0, y0, x1, y1, fn) => {                                // cells whose centres lie in the cm rectangle
    const i0 = Math.max(0, Math.round((x0 - oxcm) / CELL_CM)), i1 = Math.min(nx, Math.round((x1 - oxcm) / CELL_CM));
    const j0 = Math.max(0, Math.round((y0 - ozcm) / CELL_CM)), j1 = Math.min(ny, Math.round((y1 - ozcm) / CELL_CM));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) fn(j * nx + i, i, j);
  };
  const rooms = input.rooms, nR = rooms.length;
  rooms.forEach((r, ri) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of r.polygon) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    cellsIn(x0, y0, x1, y1, (c, i, j) => {
      if (kind[c] === OUT && pointInPolygon(oxcm + (i + 0.5) * CELL_CM, ozcm + (j + 0.5) * CELL_CM, r.polygon)) { kind[c] = ROOM; reg[c] = ri; }
    });
  });
  // openings: profile per opening
  const ops = input.openings, nO = ops.length;
  const oSill = new Float32Array(nO), oHead = new Float32Array(nO), oGlass = new Float32Array(nO).fill(1), oOpen = new Uint8Array(nO);
  const oAxisN = new Uint8Array(nO), oPlane = new Float32Array(nO), oExt = new Uint8Array(nO);
  ops.forEach((o, k) => {
    const hinged = o.kind === 'door';
    oOpen[k] = hinged ? (!o.exterior && input.doorsOpen ? 1 : 0) : 1;
    const glazed = o.kind === 'window' || o.kind === 'sliding-door';
    oGlass[k] = glazed ? input.glass : 1;
    oSill[k] = Math.max(0, o.sill / 100); oHead[k] = Math.min(H, (o.sill + o.height) / 100);
    if (oHead[k] <= oSill[k] + 0.01) oOpen[k] = 0;
    oAxisN[k] = o.axis === 'h' ? 2 : 0;                                    // axis of the wall NORMAL (x for a north-south wall)
    oPlane[k] = o.axis === 'h' ? (o.y + o.h / 2) / 100 : (o.x + o.w / 2) / 100;
    oExt[k] = o.exterior ? 1 : 0;
  });
  for (let k = nO - 1; k >= 0; k--) {
    const o = ops[k];
    // always rasterised as an opening, so the chart layout does not depend on door states; a closed door (or a gap
    // with no height) is solid while marching
    cellsIn(o.x, o.y, o.x + o.w, o.y + o.h, (c) => { kind[c] = OPEN; reg[c] = k; });
  }
  for (const w of input.walls) cellsIn(w.x, w.y, w.x + w.w, w.y + w.h, (c) => { kind[c] = WALL; reg[c] = -1; });
  // the outdoor slabs (terrace, porch, utility yard) are 13 cm above the garden
  const slabAt = (xcm, ycm) => input.outdoorAreas.some((a) => pointInPolygon(xcm, ycm, a.polygon));
  for (const a of input.outdoorAreas) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of a.polygon) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    cellsIn(x0, y0, x1, y1, (c, i, j) => { if (kind[c] === OUT && pointInPolygon(oxcm + (i + 0.5) * CELL_CM, ozcm + (j + 0.5) * CELL_CM, a.polygon)) gcls[c] = 1; });
  }

  // empty-space skipping: Chebyshev clearance (in cells) to the nearest cell of another class
  const clear = new Uint8Array(nc);
  if (!O.layoutOnly) {                                                     // the page only needs the layout (UVs)
    const cls = new Uint8Array(nc);
    for (let c = 0; c < nc; c++) cls[c] = kind[c] === ROOM ? 1 : kind[c] === OUT ? 2 + gcls[c] : 0;
    const queue = new Int32Array(nc); let qh = 0, qt = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i, k = cls[c];
      let edge = k === 0 || i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
      if (!edge) {
        const u = c - nx, d = c + nx;
        edge = cls[u - 1] !== k || cls[u] !== k || cls[u + 1] !== k || cls[c - 1] !== k || cls[c + 1] !== k || cls[d - 1] !== k || cls[d] !== k || cls[d + 1] !== k;
      }
      if (edge) { clear[c] = 1; queue[qt++] = c; }
    }
    while (qh < qt) {
      const c = queue[qh++], i = c % nx, j = (c - i) / nx, k = cls[c], d = clear[c];
      if (d >= 250 || i === 0 || j === 0 || i === nx - 1 || j === ny - 1) continue;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const n = c + dj * nx + di;
        if (!clear[n] && cls[n] === k) { clear[n] = d + 1; queue[qt++] = n; }
      }
    }
  }

  // ── charts & patches ──
  const nRows = Math.max(4, Math.round((H * 100) / O.rowCm)), rowH = H / nRows;
  const charts = [], chartByKey = new Map();
  const getChart = (key, make) => { let ch = chartByKey.get(key); if (!ch) { ch = make(); ch.id = charts.length; ch.key = key; charts.push(ch); chartByKey.set(key, ch); } return ch; };
  const solidOf = (c) => {                                                 // solid height intervals of a column (≤ 2)
    const k = kind[c];
    if (k === WALL) return [[0, H]];
    if (k !== OPEN) return [];
    const o = reg[c], s = [];
    if (oSill[o] > 1e-6) s.push([0, oSill[o]]);
    if (oHead[o] < H - 1e-6) s.push([oHead[o], H]);
    return s;
  };
  const subtract = (a, b) => {
    let res = a;
    for (const [b0, b1] of b) {
      const next = [];
      for (const [a0, a1] of res) { if (b1 <= a0 || b0 >= a1) { next.push([a0, a1]); continue; } if (b0 > a0) next.push([a0, b0]); if (b1 < a1) next.push([b1, a1]); }
      res = next;
    }
    return res.filter(([p, q]) => q - p > 1e-6);
  };
  const regionOf = (c) => (kind[c] === ROOM ? reg[c] : kind[c] === OPEN ? nR + reg[c] : -1);
  const contribH = [], contribV = [];                                      // collected first, laid out afterwards
  const floorChart = new Int32Array(nc).fill(-1), ceilChart = new Int32Array(nc).fill(-1), faceChart = new Int32Array(nc * 4).fill(-1);
  const hCache = new Map();                                               // numeric keys on the hot path
  const hChart = (surf, region, tile, y, normalY) => {
    const nk = surf * 65536 + region;
    let ch = hCache.get(nk);
    if (!ch) { ch = getChart(`h:${surf}:${region}`, () => ({ type: 'h', surf, region, tile, y, normal: [0, normalY, 0], i0: Infinity, j0: Infinity, i1: -Infinity, j1: -Infinity })); hCache.set(nk, ch); }
    return ch;
  };
  const vCache = new Map();
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i, k = kind[c];
    if (k === ROOM) {
      const r = reg[c];
      const f = hChart(SURF.FLOOR, r, O.tile, 0, 1), cl = hChart(SURF.CEILING, r, O.ceilingTile, H, -1);
      floorChart[c] = f.id; ceilChart[c] = cl.id; contribH.push(c, f.id, c, cl.id);
    } else if (k === OPEN) {
      const o = reg[c], r = nR + o;
      const f = oSill[o] > 1e-6 ? hChart(SURF.SILL, r, 2, oSill[o], 1) : hChart(SURF.THRESHOLD, r, 2, 0, 1);
      floorChart[c] = f.id; contribH.push(c, f.id);
      if (oHead[o] < H - 1e-6) { const l = hChart(SURF.LINTEL, r, 2, oHead[o], -1); ceilChart[c] = l.id; contribH.push(c, l.id); }
    }
    if (k !== WALL && k !== OPEN) continue;
    const solid = solidOf(c);
    for (let s = 0; s < 4; s++) {
      const ii = i + (s === 0 ? 1 : s === 1 ? -1 : 0), jj = j + (s === 2 ? 1 : s === 3 ? -1 : 0);
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const n = jj * nx + ii, nk = kind[n];
      if (nk === OUT || nk === WALL) continue;
      const iv = nk === ROOM ? solid : subtract(solid, solidOf(n));
      if (!iv.length) continue;
      const region = regionOf(n), plane = s === 0 ? i + 1 : s === 1 ? i : s === 2 ? j + 1 : j, along = s < 2 ? j : i;
      const vk = (s * 8192 + plane) * 65536 + region;
      let ch = vCache.get(vk);
      if (!ch) {
        ch = getChart(`v:${s}:${plane}:${region}`, () => ({
          type: 'v', surf: SURF.WALL, region, side: s, plane, tile: region >= nR ? 2 : O.tile, a0: Infinity, a1: -Infinity,
          normal: [s === 0 ? 1 : s === 1 ? -1 : 0, 0, s === 2 ? 1 : s === 3 ? -1 : 0],
        }));
        vCache.set(vk, ch);
      }
      faceChart[c * 4 + s] = ch.id;
      for (const [y0, y1] of iv) contribV.push(ch.id, along, y0, y1);
    }
  }
  // per-region average charts (1 texel) — fallback for odd faces (skirting ends …)
  const nRegions = nR + nO;
  for (let r = 0; r < nRegions; r++) getChart(`a:${r}`, () => ({ type: 'a', surf: SURF.AVERAGE, region: r, normal: [0, 1, 0], cols: 1, rows: 1 }));
  for (let q = 0; q < contribH.length; q += 2) {
    const c = contribH[q], ch = charts[contribH[q + 1]], i = c % nx, j = (c - i) / nx;
    ch.i0 = Math.min(ch.i0, i); ch.j0 = Math.min(ch.j0, j); ch.i1 = Math.max(ch.i1, i); ch.j1 = Math.max(ch.j1, j);
  }
  for (let q = 0; q < contribV.length; q += 4) { const ch = charts[contribV[q]], along = contribV[q + 1]; if (along < ch.a0) ch.a0 = along; if (along > ch.a1) ch.a1 = along; }
  for (const ch of charts) {
    if (ch.type === 'h') { ch.cols = Math.floor((ch.i1 - ch.i0) / ch.tile) + 1; ch.rows = Math.floor((ch.j1 - ch.j0) / ch.tile) + 1; }
    else if (ch.type === 'v') { ch.cols = Math.floor((ch.a1 - ch.a0) / ch.tile) + 1; ch.rows = nRows; }
    ch.texPatch = new Int32Array(ch.cols * ch.rows).fill(-1);
  }
  // patches
  const P = { chart: [], texel: [], area: [], sx: [], sy: [], sz: [], ax: [], ay: [], az: [] };
  const patchAt = (ch, t, x, y, z) => {
    let p = ch.texPatch[t];
    if (p < 0) { p = ch.texPatch[t] = P.chart.length; P.chart.push(ch.id); P.texel.push(t); P.area.push(0); P.sx.push(0); P.sy.push(0); P.sz.push(0); P.ax.push(x); P.ay.push(y); P.az.push(z); }
    return p;
  };
  for (let q = 0; q < contribH.length; q += 2) {
    const c = contribH[q], ch = charts[contribH[q + 1]], i = c % nx, j = (c - i) / nx;
    const t = Math.floor((j - ch.j0) / ch.tile) * ch.cols + Math.floor((i - ch.i0) / ch.tile);
    const x = ox + (i + 0.5) * CS, z = oz + (j + 0.5) * CS, a = CS * CS;
    const p = patchAt(ch, t, x, ch.y, z);
    P.area[p] += a; P.sx[p] += x * a; P.sy[p] += ch.y * a; P.sz[p] += z * a;
  }
  for (let q = 0; q < contribV.length; q += 4) {
    const ch = charts[contribV[q]], along = contribV[q + 1], y0 = contribV[q + 2], y1 = contribV[q + 3];
    const col = Math.floor((along - ch.a0) / ch.tile);
    const planeM = ch.plane * CS, alongM = (along + 0.5) * CS;
    for (let r = Math.max(0, Math.floor(y0 / rowH)); r < Math.min(nRows, Math.ceil(y1 / rowH - 1e-9)); r++) {
      const ov = Math.min(y1, (r + 1) * rowH) - Math.max(y0, r * rowH);
      if (ov <= 1e-6) continue;
      const ym = (Math.min(y1, (r + 1) * rowH) + Math.max(y0, r * rowH)) / 2;
      const x = ch.side < 2 ? ox + planeM : ox + alongM, z = ch.side < 2 ? oz + alongM : oz + planeM;
      const p = patchAt(ch, r * ch.cols + col, x, ym, z), a = CS * ov;
      P.area[p] += a; P.sx[p] += x * a; P.sy[p] += ym * a; P.sz[p] += z * a;
    }
  }
  const nP = P.chart.length;
  const patch = {
    count: nP, chart: Int32Array.from(P.chart), texel: Int32Array.from(P.texel), area: Float32Array.from(P.area),
    pos: new Float32Array(nP * 3), nrm: new Int8Array(nP * 3), surf: new Uint8Array(nP), region: new Int16Array(nP),
  };
  const airRegion = (px, py, pz) => {
    const i = Math.floor((px - ox) / CS), j = Math.floor((pz - oz) / CS);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
    const c = j * nx + i;
    if (kind[c] === ROOM) return py > 0 && py < H ? reg[c] : -1;
    if (kind[c] === OPEN) return py > oSill[reg[c]] && py < oHead[reg[c]] ? nR + reg[c] : -1;
    return -1;
  };
  for (let p = 0; p < nP; p++) {
    const ch = charts[P.chart[p]], a = P.area[p] || 1;
    let x = P.sx[p] / a, y = P.sy[p] / a, z = P.sz[p] / a;
    const n = ch.normal;
    if (airRegion(x + n[0] * 0.01, y + n[1] * 0.01, z + n[2] * 0.01) !== ch.region) { x = P.ax[p]; y = P.ay[p]; z = P.az[p]; }
    patch.nrm[p * 3] = ch.normal[0]; patch.nrm[p * 3 + 1] = ch.normal[1]; patch.nrm[p * 3 + 2] = ch.normal[2];
    patch.surf[p] = ch.surf; patch.region[p] = ch.region;
    patch.pos[p * 3] = x; patch.pos[p * 3 + 1] = y; patch.pos[p * 3 + 2] = z;
  }

  // ── atlas: shelf packing ──
  const order = charts.map((ch) => ch.id).sort((a, b) => charts[b].rows - charts[a].rows || charts[b].cols - charts[a].cols || a - b);
  let total = 0; for (const ch of charts) total += (ch.cols + 2 * PAD) * (ch.rows + 2 * PAD);
  let W = 64; while (W * W < total * 1.25) W *= 2;
  let x = 0, y = 0, shelf = 0;
  for (const id of order) {
    const ch = charts[id], w = ch.cols + 2 * PAD, h = ch.rows + 2 * PAD;
    if (w > W) W = w;
    if (x + w > W) { x = 0; y += shelf; shelf = 0; }
    ch.ax = x; ch.ay = y; x += w; shelf = Math.max(shelf, h);
  }
  const AH = Math.max(4, Math.ceil((y + shelf) / 4) * 4);
  // texel of every patch, and a fill plan for the empty / padding texels (dilation, never across charts)
  const texelOf = new Int32Array(nP);
  const filled = new Uint8Array(W * AH);
  for (let p = 0; p < nP; p++) {
    const ch = charts[patch.chart[p]], t = patch.texel[p], col = t % ch.cols, row = (t - col) / ch.cols;
    texelOf[p] = (ch.ay + PAD + row) * W + ch.ax + PAD + col; filled[texelOf[p]] = 1;
  }
  const avgTexel = new Int32Array(nRegions);
  for (let r = 0; r < nRegions; r++) { const ch = chartByKey.get(`a:${r}`); avgTexel[r] = (ch.ay + PAD) * W + ch.ax + PAD; }
  const fillDst = [], fillSrcStart = [0], fillSrc = [];
  for (const ch of charts) {
    if (ch.type === 'a') {                                                 // average chart: centre is written; ring copies it
      const centre = (ch.ay + PAD) * W + ch.ax + PAD;
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) { const t = (ch.ay + dy) * W + ch.ax + dx; if (t !== centre) { fillDst.push(t); fillSrc.push(centre); fillSrcStart.push(fillSrc.length); } }
      continue;
    }
    const w = ch.cols + 2 * PAD, h = ch.rows + 2 * PAD, done = new Uint8Array(w * h);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) done[r * w + c] = filled[(ch.ay + r) * W + ch.ax + c];
    let remaining = 0; for (const d of done) if (!d) remaining++;
    if (remaining === w * h) continue;
    for (let pass = 0; remaining > 0 && pass < w + h; pass++) {
      const now = [];
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        if (done[r * w + c]) continue;
        const src = [];
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if ((dr || dc) && rr >= 0 && cc >= 0 && rr < h && cc < w && done[rr * w + cc]) src.push((ch.ay + rr) * W + ch.ax + cc);
        }
        if (src.length) now.push([r * w + c, (ch.ay + r) * W + ch.ax + c, src]);
      }
      for (const [local, t, src] of now) { done[local] = 1; remaining--; fillDst.push(t); fillSrc.push(...src); fillSrcStart.push(fillSrc.length); }
    }
  }

  // ── probes: ≈ 1 m grid per room, two heights ──
  const probes = [];
  const roomy = (c) => {                                                   // ≥ 10 cm of the same room all round
    const i = c % nx, j = (c - i) / nx;
    if (i < 2 || j < 2 || i >= nx - 2 || j >= ny - 2) return false;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const q = c + dj * nx + di; if (kind[q] !== ROOM || reg[q] !== reg[c]) return false; }
    return true;
  };
  rooms.forEach((r, ri) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of r.polygon) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
    const sp = O.probeSpacing * 100, cols = Math.max(1, Math.round((x1 - x0) / sp)), rows = Math.max(1, Math.round((y1 - y0) / sp));
    for (let b = 0; b < rows; b++) for (let a = 0; a < cols; a++) {
      const px = x0 + ((a + 0.5) * (x1 - x0)) / cols, py = y0 + ((b + 0.5) * (y1 - y0)) / rows;
      // nearest cell of this room at least 15 cm from anything else (search a small neighbourhood)
      const ci = Math.floor((px - oxcm) / CELL_CM), cj = Math.floor((py - ozcm) / CELL_CM);
      let best = -1, bd = Infinity;
      for (let dj = -10; dj <= 10; dj++) for (let di = -10; di <= 10; di++) {
        const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const c = jj * nx + ii; if (kind[c] !== ROOM || reg[c] !== ri || !roomy(c)) continue;
        const d = di * di + dj * dj; if (d < bd) { bd = d; best = c; }
      }
      if (best < 0) continue;
      const bi = best % nx, bj = (best - bi) / nx;
      for (const hgt of PROBE_HEIGHTS) if (hgt < H - 0.1) probes.push({ room: ri, x: ox + (bi + 0.5) * CS, y: hgt, z: oz + (bj + 0.5) * CS, layer: PROBE_HEIGHTS.indexOf(hgt) });
    }
  });

  // ── ground elements (1 m) over the lot ──
  const lot = input.lot, gox = Math.floor(lot.x / 100), goz = Math.floor(lot.y / 100);
  const gnx = Math.max(1, Math.ceil((lot.x + lot.w) / 100) - gox), gnz = Math.max(1, Math.ceil((lot.y + lot.h) / 100) - goz);
  const groundKind = new Uint8Array(gnx * gnz);                            // 0 garden, 1 slab, 2 paving
  for (let b = 0; b < gnz; b++) for (let a = 0; a < gnx; a++) {
    const xcm = (gox + a + 0.5) * 100, ycm = (goz + b + 0.5) * 100;
    groundKind[b * gnx + a] = slabAt(xcm, ycm) ? 1 : input.paths.some((pp) => pointInPolygon(xcm, ycm, pp)) || input.parking.some((q) => xcm >= q.x && xcm <= q.x + q.w && ycm >= q.y && ycm <= q.y + q.h) ? 2 : 0;
  }

  const scene = {
    input, opts: O, H, roofTop, drop, nx, ny, ox, oz, kind, reg, gcls, clear, nR, nO, nRegions,
    roomIds: rooms.map((r) => r.id), roomTypes: rooms.map((r) => r.type), openingIds: ops.map((o) => o.id), openingRooms: ops.map((o) => o.rooms),
    oSill, oHead, oGlass, oOpen, oAxisN, oPlane, oExt, nRows, rowH,
    charts, chartByKey, floorChart, ceilChart, faceChart, patch, texelOf, avgTexel,
    atlas: { width: W, height: AH, fillDst: Int32Array.from(fillDst), fillSrcStart: Int32Array.from(fillSrcStart), fillSrc: Int32Array.from(fillSrc) },
    probes, ground: { ox: gox, oz: goz, nx: gnx, nz: gnz, kind: groundKind },
  };
  scene.field = fieldLayout(scene);
  return scene;
}

// ───────────────────────── ray marching ─────────────────────────
/** Reusable hit record. */
function hitRecord() { return { type: HIT_NONE, idx: -1, T: 1, x: 0, y: 0, z: 0, exitOpen: -1, side: 0 }; }

/** Ground level (m) and element index outdoors at world x, z. */
function groundElement(S, x, z) {
  const G = S.ground;
  const a = Math.min(G.nx - 1, Math.max(0, Math.floor(x - G.ox))), b = Math.min(G.nz - 1, Math.max(0, Math.floor(z - G.oz)));
  return b * G.nx + a;
}

/**
 * March a ray through the plan grid.
 * @param stopOut  true → stop with HIT_EXITED as soon as the ray reaches an outdoor cell (hemisphere gathering)
 * Fills R: type, idx (patch / sky bin / ground element / facade key), T (glass transmittance), hit point, exitOpen.
 */
function march(S, px, py, pz, dx, dy, dz, stopOut, R) {
  const { nx, ny, ox, oz, kind, reg, clear, H, roofTop } = S;
  R.type = HIT_NONE; R.idx = -1; R.T = 1; R.exitOpen = -1;
  let T = 1, lastOpen = -1, exited = false;
  const adx = Math.abs(dx), adz = Math.abs(dz), amax = Math.max(adx, adz);
  const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
  const tDX = adx > 1e-12 ? CS / adx : Infinity, tDZ = adz > 1e-12 ? CS / adz : Infinity;
  let t = 0, i, j, tMaxX, tMaxZ, side = -1, prev = -1;
  const reinit = () => {
    const gx = (px + dx * t - ox) / CS, gz = (pz + dz * t - oz) / CS;
    i = Math.floor(gx); j = Math.floor(gz);
    tMaxX = adx > 1e-12 ? t + ((dx > 0 ? i + 1 - gx : gx - i) * CS) / adx : Infinity;
    tMaxZ = adz > 1e-12 ? t + ((dz > 0 ? j + 1 - gz : gz - j) * CS) / adz : Infinity;
  };
  reinit();
  for (let guard = 0; guard < 20000; guard++) {
    if (i < 0 || j < 0 || i >= nx || j >= ny) {                          // left the grid: open land, nothing to hit but the ground
      if (stopOut) { R.type = HIT_EXITED; return R; }
      if (!exited) R.exitOpen = lastOpen;
      if (dy < -1e-9) {
        const tg = (-S.drop - py) / dy;
        R.type = HIT_GROUND; R.x = px + dx * tg; R.y = -S.drop; R.z = pz + dz * tg; R.idx = groundElement(S, R.x, R.z); R.T = T; return R;
      }
      R.type = HIT_SKY; R.idx = binOf(dx, dy, dz); R.T = T; return R;
    }
    const c = j * nx + i, k = kind[c];
    const tExit = tMaxX < tMaxZ ? tMaxX : tMaxZ;
    const yIn = py + dy * t;
    if (k === ROOM || k === OUT) {
      if (k === OUT) {
        if (stopOut) { R.type = HIT_EXITED; return R; }
        if (!exited) { exited = true; R.exitOpen = lastOpen; }
        if (dy >= 0 && yIn > roofTop) { R.type = HIT_SKY; R.idx = binOf(dx, dy, dz); R.T = T; return R; }
      }
      let tEnd = tExit, jump = false;
      const cl = clear[c];
      if (cl > 1 && amax > 1e-9) { const ts = t + ((cl - 1) * CS) / amax; if (ts > tEnd) { tEnd = ts; jump = true; } }
      if (k === ROOM) {
        if (dy > 1e-12) {
          const tc = (H - py) / dy;
          if (tc <= tEnd) { const x = px + dx * tc, z = pz + dz * tc; return hitH(S, x, H, z, -1, T, R); }
        } else if (dy < -1e-12) {
          const tf = -py / dy;
          if (tf <= tEnd) { const x = px + dx * tf, z = pz + dz * tf; return hitH(S, x, 0, z, 1, T, R); }
        }
      } else if (dy < -1e-12) {
        const g = S.gcls[c] ? -0.02 : -S.drop, tg = (g - py) / dy;
        if (tg <= tEnd) { R.type = HIT_GROUND; R.x = px + dx * tg; R.y = g; R.z = pz + dz * tg; R.idx = groundElement(S, R.x, R.z); R.T = T; return R; }
      }
      if (jump) { t = tEnd; reinit(); prev = -1; continue; }
    } else if (k === WALL || (k === OPEN && (!S.oOpen[reg[c]] || yIn < S.oSill[reg[c]] - 1e-7 || yIn > S.oHead[reg[c]] + 1e-7))) {
      return hitV(S, c, side, prev, px + dx * t, yIn, pz + dz * t, T, R);
    } else {                                                             // inside the air band of an opening
      const o = reg[c];
      lastOpen = o;
      if (S.oGlass[o] < 1) {
        const a = S.oAxisN[o], tp = a === 0 ? (adx > 1e-12 ? (S.oPlane[o] - px) / dx : -1) : (adz > 1e-12 ? (S.oPlane[o] - pz) / dz : -1);
        if (tp > t - 1e-9 && tp <= tExit) T *= S.oGlass[o];
      }
      if (dy < -1e-12) {
        const ts = (S.oSill[o] - py) / dy;
        if (ts <= tExit) { const x = px + dx * ts, z = pz + dz * ts; return hitH(S, x, S.oSill[o], z, 1, T, R); }
      } else if (dy > 1e-12) {
        const th = (S.oHead[o] - py) / dy;
        if (th <= tExit) { const x = px + dx * th, z = pz + dz * th; return hitH(S, x, S.oHead[o], z, -1, T, R); }
      }
    }
    prev = c;
    if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDX; i += stepI; side = stepI > 0 ? 1 : 0; }
    else { t = tMaxZ; tMaxZ += tDZ; j += stepJ; side = stepJ > 0 ? 3 : 2; }
  }
  return R;
}

/** Horizontal surface hit (floor / ceiling / sill / lintel / threshold) at a world point; ny = surface normal y. */
function hitH(S, x, y, z, ny, T, R) {
  const i = Math.min(S.nx - 1, Math.max(0, Math.floor((x - S.ox) / CS))), j = Math.min(S.ny - 1, Math.max(0, Math.floor((z - S.oz) / CS)));
  const c = j * S.nx + i;
  let ch = ny > 0 ? S.floorChart[c] : S.ceilChart[c];
  if (ch < 0) { R.type = HIT_NONE; return R; }
  const chart = S.charts[ch];
  const col = Math.min(chart.cols - 1, Math.max(0, Math.floor((i - chart.i0) / chart.tile))), row = Math.min(chart.rows - 1, Math.max(0, Math.floor((j - chart.j0) / chart.tile)));
  const p = chart.texPatch[row * chart.cols + col];
  if (p < 0) { R.type = HIT_NONE; return R; }
  R.type = HIT_PATCH; R.idx = p; R.T = T; R.x = x; R.y = y; R.z = z;
  return R;
}

/** Vertical face hit: entering solid cell c through its side `side`, coming from cell `prev`. */
function hitV(S, c, side, prev, x, y, z, T, R) {
  R.x = x; R.y = y; R.z = z; R.T = T;
  if (side < 0) { R.type = HIT_NONE; return R; }
  if (prev < 0 || S.kind[prev] === OUT || y > S.H - 1e-6) {               // exterior face, roof edge or parapet
    const i = c % S.nx, j = (c - i) / S.nx, plane = side === 0 ? i + 1 : side === 1 ? i : side === 2 ? j + 1 : j;
    const along = side < 2 ? j : i;
    R.type = HIT_FACADE; R.side = side;
    R.idx = ((side * 4096 + plane) * 512 + Math.floor(along / 20)) * 16 + Math.min(15, Math.max(0, Math.floor(y)));   // ≈ 1 m × 1 m facade elements
    return R;
  }
  const ch = S.faceChart[c * 4 + side];
  if (ch < 0) { R.type = HIT_NONE; return R; }
  const chart = S.charts[ch], i = c % S.nx, j = (c - i) / S.nx, along = side < 2 ? j : i;
  const col = Math.min(chart.cols - 1, Math.max(0, Math.floor((along - chart.a0) / chart.tile)));
  let row = Math.min(S.nRows - 1, Math.max(0, Math.floor(y / S.rowH)));
  let p = chart.texPatch[row * chart.cols + col];
  if (p < 0 && row > 0) p = chart.texPatch[(row - 1) * chart.cols + col];
  if (p < 0 && row < S.nRows - 1) p = chart.texPatch[(row + 1) * chart.cols + col];
  if (p < 0) { R.type = HIT_NONE; return R; }
  R.type = HIT_PATCH; R.idx = p;
  return R;
}

// ───────────────────────── apertures ─────────────────────────
/** Exterior openings that let light in, with stratified sample points on their glass plane. */
function apertures(S) {
  const list = [];
  S.input.openings.forEach((o, k) => {
    if (!S.oExt[k] || !S.oOpen[k]) return;
    const a0 = (o.axis === 'h' ? o.x : o.y) / 100, a1 = (o.axis === 'h' ? o.x + o.w : o.y + o.h) / 100;
    const y0 = S.oSill[k], y1 = S.oHead[k], w = a1 - a0, h = y1 - y0;
    if (w <= 0.01 || h <= 0.01) return;
    const step = S.opts.apertureCm / 100;
    const nu = Math.min(10, Math.max(2, Math.ceil(w / step))), nv = Math.min(8, Math.max(2, Math.ceil(h / step)));
    list.push({ k, axisN: S.oAxisN[k], plane: S.oPlane[k], a0, a1, y0, y1, nu, nv, area: w * h });
  });
  return list;
}
const apPoint = (ap, u, v, out) => {                                     // u, v ∈ [0, 1]
  const a = ap.a0 + (ap.a1 - ap.a0) * u, y = ap.y0 + (ap.y1 - ap.y0) * v;
  if (ap.axisN === 0) { out[0] = ap.plane; out[1] = y; out[2] = a; } else { out[0] = a; out[1] = y; out[2] = ap.plane; }
  return out;
};

// ───────────────────────── visibility ─────────────────────────
/**
 * Visibility job: compute (progressively) the cached light-transport links of the scene.
 *   const job = createVisibilityJob(scene, { coarse: true });
 *   while (!job.step(16)) {}                // run in slices of ~16 ms (or all at once in a worker)
 *   const vis = job.result();
 * `coarse`: only every other texel per chart direction (+ fewer rays); the others copy their neighbour's links.
 */
export function createVisibilityJob(S, { coarse = false } = {}) {
  const O = S.opts, nP = S.patch.count, probes = S.probes;
  const nRec = nP + probes.length * 6;
  const G = S.ground, nGround = G.nx * G.nz;
  const facadeIndex = new Map(), facades = [];                              // facade key → index
  const SRC_SKY = nP, SRC_GROUND = nP + SKY_BINS, SRC_FACADE = nP + SKY_BINS + nGround;
  const facadeSrc = (R) => {
    let f = facadeIndex.get(R.idx);
    if (f === undefined) {
      f = facades.length; facadeIndex.set(R.idx, f);
      facades.push({ x: R.x, y: R.y, z: R.z, nx: R.side === 0 ? 1 : R.side === 1 ? -1 : 0, nz: R.side === 2 ? 1 : R.side === 3 ? -1 : 0, hits: 1 });
    } else { const F = facades[f]; F.hits++; F.x += (R.x - F.x) / F.hits; F.y += (R.y - F.y) / F.hits; F.z += (R.z - F.z) / F.hits; }
    return SRC_FACADE + f;
  };
  const links = new Links(1 << 18);
  const apMask = new Uint32Array(nRec);                                     // bit a = receiver sees aperture a (≤ 32)
  let curRec = 0;
  const owner = new Int32Array(nRec).fill(-1);                              // coarse pass: receiver whose links are reused
  const aps = apertures(S);
  const hemiN = coarse ? 16 : O.hemiRays, probeN = coarse ? 16 : O.probeRays;
  const sideN = Math.round(Math.sqrt(hemiN));
  // dense accumulator for merging duplicate links per receiver
  let acc = new Float32Array(SRC_FACADE + 1024), touched = new Int32Array(4096), nt = 0;
  const add = (src, w) => {
    if (src >= acc.length) { const a = new Float32Array(Math.max(src + 1, acc.length * 2)); a.set(acc); acc = a; }
    if (acc[src] === 0) { if (nt === touched.length) { const t2 = new Int32Array(nt * 2); t2.set(touched); touched = t2; } touched[nt++] = src; }
    acc[src] += w;
  };
  const flush = () => {
    for (let q = 0; q < nt; q++) { const s = touched[q]; if (acc[s] > 1e-7) links.push(s, acc[s]); acc[s] = 0; }
    nt = 0; links.close();
  };
  const R = hitRecord(), ap3 = [0, 0, 0];
  const isSeed = (p) => {
    if (!coarse) return true;
    const ch = S.charts[S.patch.chart[p]], t = S.patch.texel[p], col = t % ch.cols, row = (t - col) / ch.cols;
    return ch.type === 'v' ? (col % 2 === 0 && row % 2 === 0) : (col % 2 === 0 && row % 2 === 0);
  };

  /** Gather one receiver at point (x, y, z) with axis normal n. */
  function gather(x, y, z, n, nRays, seed) {
    const rand = rng(seed * 2654435761 + 12345);
    const ex = 0.002;
    const sx = x + n[0] * ex, sy = y + n[1] * ex, sz = z + n[2] * ex;
    // tangent frame for an axis-aligned normal
    const t1 = Math.abs(n[1]) > 0.5 ? [1, 0, 0] : [0, 1, 0];
    const t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
    const s = Math.max(1, Math.round(Math.sqrt(nRays))), N = s * s, w = 1 / N;
    // A) hemisphere: indoor inter-reflection only
    for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) {
      const u1 = (a + rand()) / s, u2 = (b + rand()) / s, r = Math.sqrt(u1), ph = 2 * Math.PI * u2;
      const lx = r * Math.cos(ph), ly = r * Math.sin(ph), lz = Math.sqrt(Math.max(0, 1 - u1));
      const dx = t1[0] * lx + t2[0] * ly + n[0] * lz, dy = t1[1] * lx + t2[1] * ly + n[1] * lz, dz = t1[2] * lx + t2[2] * ly + n[2] * lz;
      march(S, sx, sy, sz, dx, dy, dz, true, R);
      if (R.type === HIT_PATCH) add(R.idx, w * R.T);
    }
    // B) apertures: everything outdoors (sky, ground, facades) and what re-enters
    for (const A of aps) {
      // receiver in front of the aperture?  quick test with the centre + 4 inset corners
      let any = false;
      for (const [u, v] of [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]]) {
        apPoint(A, u, v, ap3);
        let dx = ap3[0] - x, dy = ap3[1] - y, dz = ap3[2] - z;
        const d = Math.hypot(dx, dy, dz); if (d < 1e-4) continue;
        dx /= d; dy /= d; dz /= d;
        if (dx * n[0] + dy * n[1] + dz * n[2] <= 1e-4) continue;
        march(S, sx, sy, sz, dx, dy, dz, false, R);
        if (R.exitOpen === A.k) { any = true; break; }
      }
      if (!any) continue;
      apMask[curRec] |= 1 << (aps.indexOf(A) & 31);
      const nu = coarse ? Math.max(2, Math.ceil(A.nu / 2)) : A.nu, nv = coarse ? Math.max(2, Math.ceil(A.nv / 2)) : A.nv;
      const dA = A.area / (nu * nv);
      for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
        apPoint(A, (a + 0.5) / nu, (b + 0.5) / nv, ap3);
        let dx = ap3[0] - x, dy = ap3[1] - y, dz = ap3[2] - z;
        const d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2);
        if (d < 1e-4) continue;
        dx /= d; dy /= d; dz /= d;
        const cosR = dx * n[0] + dy * n[1] + dz * n[2];
        if (cosR <= 1e-4) continue;
        const cosA = Math.abs(A.axisN === 0 ? dx : dz);
        const dOmega = Math.min((cosA * dA) / d2, 1.0);                     // clamp the near-field singularity
        march(S, sx, sy, sz, dx, dy, dz, false, R);
        if (R.exitOpen !== A.k) continue;                                  // blocked, or left through another opening
        const wt = (cosR * dOmega) / Math.PI * R.T;
        if (R.type === HIT_SKY) add(SRC_SKY + R.idx, wt);
        else if (R.type === HIT_GROUND) add(SRC_GROUND + R.idx, wt);
        else if (R.type === HIT_FACADE) add(facadeSrc(R), wt);
        else if (R.type === HIT_PATCH) add(R.idx, wt);
      }
    }
    flush();
  }

  // receivers in order: patches, then probe directions; the job is resumable
  let next = 0, phase = 0;
  const outdoor = new Links(1 << 14);
  let outNext = 0;
  const stats = { rays: 0, ms: 0 };
  const t0 = Date.now();
  function stepReceivers(budgetMs) {
    const end = Date.now() + budgetMs;
    while (next < nRec) {
      const r = next++;
      curRec = r;
      if (r < nP) {
        if (!isSeed(r)) { links.close(); owner[r] = -2; continue; }
        const p3 = r * 3;
        gather(S.patch.pos[p3], S.patch.pos[p3 + 1], S.patch.pos[p3 + 2], [S.patch.nrm[p3], S.patch.nrm[p3 + 1], S.patch.nrm[p3 + 2]], hemiN, r);
      } else {
        const q = r - nP, pr = probes[Math.floor(q / 6)];
        gather(pr.x, pr.y, pr.z, DIRS6[q % 6], probeN, r);
      }
      if ((next & 15) === 0 && Date.now() > end) return false;
    }
    return true;
  }
  // outdoor elements: ground cells then facades (facades may discover new facades — processed until none left)
  function stepOutdoor(budgetMs) {
    const end = Date.now() + budgetMs;
    const nOut = () => nGround + facades.length;
    while (outNext < nOut()) {
      const e = outNext++;
      let x, y, z, n;
      if (e < nGround) { const a = e % G.nx, b = (e - a) / G.nx; x = G.ox + a + 0.5; z = G.oz + b + 0.5; y = (G.kind[e] === 1 ? -0.02 : -S.drop) + 0.01; n = [0, 1, 0]; }
      else { const F = facades[e - nGround]; x = F.x + F.nx * 0.01; y = F.y; z = F.z + F.nz * 0.01; n = [F.nx, 0, F.nz]; }
      const rand = rng(e * 7919 + 17);
      const s = Math.max(1, Math.round(Math.sqrt(O.outdoorRays))), w = 1 / (s * s);
      const t1 = Math.abs(n[1]) > 0.5 ? [1, 0, 0] : [0, 1, 0];
      const t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
      for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) {
        const u1 = (a + rand()) / s, u2 = (b + rand()) / s, r = Math.sqrt(u1), ph = 2 * Math.PI * u2;
        const lx = r * Math.cos(ph), ly = r * Math.sin(ph), lz = Math.sqrt(Math.max(0, 1 - u1));
        const dx = t1[0] * lx + t2[0] * ly + n[0] * lz, dy = t1[1] * lx + t2[1] * ly + n[1] * lz, dz = t1[2] * lx + t2[2] * ly + n[2] * lz;
        march(S, x, y, z, dx, dy, dz, false, R);
        if (R.type === HIT_SKY) add(SRC_SKY + R.idx, w * R.T);
        else if (R.type === HIT_GROUND) add(SRC_GROUND + R.idx, w * R.T);
        else if (R.type === HIT_FACADE) add(facadeSrc(R), w * R.T);
      }
      for (let q = 0; q < nt; q++) { const src = touched[q]; if (acc[src] > 1e-7) outdoor.push(src - nP, acc[src]); acc[src] = 0; }
      nt = 0; outdoor.close();
      if ((outNext & 15) === 0 && Date.now() > end) return false;
    }
    return true;
  }
  let fieldDone = false;
  return {
    get progress() { return phase === 0 ? next / nRec * 0.9 : phase === 1 ? 0.9 + 0.08 * (outNext / Math.max(1, nGround + facades.length)) : 1; },
    /** Advance by about `budgetMs`; returns true when finished. */
    step(budgetMs = 1e9) {
      if (phase === 0) { if (!stepReceivers(budgetMs)) return false; phase = 1; }
      if (phase === 1) { if (!stepOutdoor(budgetMs)) return false; phase = 2; }
      if (!fieldDone) { fieldWeights(S); fieldDone = true; }
      stats.ms = Date.now() - t0;
      return true;
    },
    result() {
      const L = links.pack();
      if (coarse) {                                                        // copy links from the nearest seed of the same chart
        for (let p = 0; p < nP; p++) {
          if (owner[p] !== -2) continue;
          const ch = S.charts[S.patch.chart[p]], t = S.patch.texel[p], col = t % ch.cols, row = (t - col) / ch.cols;
          let best = -1;
          for (const [dc, dr] of [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 0], [0, 1], [1, 1], [-1, 1], [1, -1]]) {
            const c2 = col + dc, r2 = row + dr;
            if (c2 < 0 || r2 < 0 || c2 >= ch.cols || r2 >= ch.rows) continue;
            const q = ch.texPatch[r2 * ch.cols + c2];
            if (q >= 0 && isSeed(q)) { best = q; break; }
          }
          owner[p] = best;
        }
      }
      return {
        coarse, nP, nRec, nGround, SRC_SKY, SRC_GROUND, SRC_FACADE, nFacades: facades.length,
        facades: Float32Array.from(facades.flatMap((F) => [F.x, F.y, F.z, F.nx, F.nz])),
        start: L.start, idx: L.idx, w: L.w, owner, apMask, outdoor: outdoor.pack(), ms: stats.ms,
        apertures: aps.map((A) => ({ k: A.k, axisN: A.axisN, plane: A.plane, a0: A.a0, a1: A.a1, y0: A.y0, y1: A.y1 })),
      };
    },
  };
}

/** Run a whole visibility computation synchronously (node tests / worker). */
export function computeVisibility(S, opts = {}) {
  const job = createVisibilityJob(S, opts);
  job.step(1e12);
  return job.result();
}

// ───────────────────────── probe field (10 cm texture over the plan) ─────────────────────────
function fieldLayout(S) {
  const fnx = Math.ceil(S.nx / FIELD_CELLS), fnz = Math.ceil(S.ny / FIELD_CELLS);
  return { nx: fnx, nz: fnz, ox: S.ox, oz: S.oz, cell: CS * FIELD_CELLS, probe: null, weight: null, alpha: null };
}
/** For every field texel: up to 4 probes of the same room in line of sight (inverse-distance weights). */
function fieldWeights(S) {
  const F = S.field, n = F.nx * F.nz, K = 4;
  const probe = new Int32Array(n * K).fill(-1), weight = new Float32Array(n * K), alpha = new Float32Array(n);
  // probes per room, layer 0 only (both layers share x/z)
  const byRoom = new Map();
  S.probes.forEach((p, k) => { if (p.layer !== 0) return; if (!byRoom.has(p.room)) byRoom.set(p.room, []); byRoom.get(p.room).push(k); });
  const air = (c) => S.kind[c] === ROOM || (S.kind[c] === OPEN && S.oOpen[S.reg[c]] && S.oSill[S.reg[c]] < 1.0 && S.oHead[S.reg[c]] > 1.0);
  const lineClear = (x0, z0, x1, z1) => {                                  // 2D line of sight at ~1 m height
    const d = Math.hypot(x1 - x0, z1 - z0), steps = Math.ceil(d / (CS * 0.7));
    for (let s = 1; s < steps; s++) {
      const x = x0 + ((x1 - x0) * s) / steps, z = z0 + ((z1 - z0) * s) / steps;
      const i = Math.floor((x - S.ox) / CS), j = Math.floor((z - S.oz) / CS);
      if (i < 0 || j < 0 || i >= S.nx || j >= S.ny || !air(j * S.nx + i)) return false;
    }
    return true;
  };
  // room of each field texel: room of its centre cell, else of the nearest air cell within 25 cm (walls, openings)
  for (let b = 0; b < F.nz; b++) for (let a = 0; a < F.nx; a++) {
    const f = b * F.nx + a;
    const ci = Math.min(S.nx - 1, a * FIELD_CELLS + 1), cj = Math.min(S.ny - 1, b * FIELD_CELLS + 1);
    const x = S.ox + (a + 0.5) * F.cell, z = S.oz + (b + 0.5) * F.cell;
    let room = -1, rx = x, rz = z;
    const c0 = cj * S.nx + ci;
    if (S.kind[c0] === ROOM) room = S.reg[c0];
    else if (S.kind[c0] !== OUT) {
      let bd = Infinity;
      for (let dj = -5; dj <= 5; dj++) for (let di = -5; di <= 5; di++) {
        const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= S.nx || jj >= S.ny) continue;
        const c = jj * S.nx + ii; if (S.kind[c] !== ROOM) continue;
        const d = di * di + dj * dj; if (d < bd) { bd = d; room = S.reg[c]; rx = S.ox + (ii + 0.5) * CS; rz = S.oz + (jj + 0.5) * CS; }
      }
    }
    if (room < 0) continue;
    const list = byRoom.get(room); if (!list) continue;
    alpha[f] = 1;
    const cand = list.map((k) => [k, Math.hypot(S.probes[k].x - rx, S.probes[k].z - rz)]).sort((p, q) => p[1] - q[1]);
    let m = 0, sum = 0;
    for (const [k, d] of cand) {
      if (m >= K) break;
      if (m > 0 && d > 2.5 * O_FIELD_REACH) break;
      if (!lineClear(rx, rz, S.probes[k].x, S.probes[k].z) && m > 0) continue;
      const w = 1 / Math.max(0.05, d) ** 2;
      probe[f * K + m] = k; weight[f * K + m] = w; sum += w; m++;
    }
    if (!m && cand.length) { probe[f * K] = cand[0][0]; weight[f * K] = 1; sum = 1; m = 1; }
    for (let q = 0; q < m; q++) weight[f * K + q] /= sum;
  }
  F.probe = probe; F.weight = weight; F.alpha = alpha;
}
const O_FIELD_REACH = 1.0;

// ───────────────────────── relight ─────────────────────────
/**
 * Albedo table → per patch / per outdoor element linear-RGB reflectance.
 * @param {{ rooms?: Object<string, { floor?: number[], wall?: number[] }>, ceiling?: number[], reveal?: number[],
 *           ground?: { garden?: number[], slab?: number[], paving?: number[] }, facade?: number[] }} table
 */
export function albedoArrays(S, vis, table = {}) {
  const nP = S.patch.count, rho = new Float32Array(nP * 3);
  const clamp = (c) => c.map((v) => Math.min(0.92, Math.max(0.02, v)));
  const room = (r) => (table.rooms && table.rooms[S.roomIds[r]]) || {};
  const def = { floor: [0.45, 0.42, 0.38], wall: [0.75, 0.74, 0.72] };
  const ceiling = clamp(table.ceiling || [0.85, 0.84, 0.82]);
  for (let p = 0; p < nP; p++) {
    const surf = S.patch.surf[p], r = S.patch.region[p];
    let c;
    if (r < S.nR) c = surf === SURF.FLOOR ? room(r).floor || def.floor : surf === SURF.CEILING ? ceiling : room(r).wall || def.wall;
    else {                                                                  // opening reveal / sill / lintel / threshold
      const rooms = S.openingRooms[r - S.nR] || [], ri = S.roomIds.findIndex((id) => rooms.includes(id));
      c = surf === SURF.THRESHOLD ? (ri >= 0 && room(ri).floor) || def.floor : (ri >= 0 && room(ri).wall) || table.reveal || def.wall;
    }
    c = clamp(c);
    rho[p * 3] = c[0]; rho[p * 3 + 1] = c[1]; rho[p * 3 + 2] = c[2];
  }
  const G = S.ground, gr = table.ground || {};
  const nOut = G.nx * G.nz + (vis ? vis.nFacades : 0), out = new Float32Array(nOut * 3);
  const gk = [clamp(gr.garden || [0.2, 0.17, 0.13]), clamp(gr.slab || [0.42, 0.4, 0.36]), clamp(gr.paving || [0.33, 0.31, 0.28])];
  for (let e = 0; e < G.nx * G.nz; e++) out.set(gk[G.kind[e]], e * 3);
  const fa = clamp(table.facade || [0.75, 0.73, 0.68]);
  for (let e = G.nx * G.nz; e < nOut; e++) out.set(fa, e * 3);
  return { patch: rho, outdoor: out };
}

/**
 * Relight the cached scene.
 * @param {object} S   scene (buildScene)
 * @param {object} vis visibility (computeVisibility / job.result())
 * @param {{ sunDir: number[], sunE?: number[], sky?: 'clear'|'overcast', skyScale?: number, albedo?: object,
 *           bounces?: number, sunSamples?: number }} L
 *   sunDir = world unit vector towards the sun; sunE = linear-RGB irradiance of the sun on a surface facing it
 *   (renderer units; default = clear-sky model). albedo = albedoArrays() result or a table for it.
 * @returns {{ direct: Float32Array, outside: Float32Array, indirect: Float32Array, lightmap: Float32Array,
 *             probes: Float32Array, field: Float32Array, sky: Float32Array, ms: number, iterations: number[] }}
 */
export function relight(S, vis, L) {
  const t0 = Date.now();
  const nP = S.patch.count, sunDir = L.sunDir;
  const alt = Math.asin(Math.max(-1, Math.min(1, sunDir[1]))) * 180 / Math.PI;
  let sunE = L.sunE;
  if (!sunE) { const e = alt > 0 ? sunNormal(alt) : 0; sunE = [e, e * 0.97, e * 0.9]; }
  if (L.sky === 'overcast') sunE = [0, 0, 0];
  const albedo = L.albedo && L.albedo.patch ? L.albedo : albedoArrays(S, vis, L.albedo || {});
  const rho = albedo.patch, rhoOut = albedo.outdoor;
  const { radiance: sky } = skyRadiance({ sunDir, type: L.sky === 'overcast' ? 'overcast' : 'clear', scale: L.skyScale == null ? 1 : L.skyScale });
  const R = hitRecord();
  const sunOn = (sunE[0] + sunE[1] + sunE[2]) > 1e-6 && sunDir[1] > 0.0;
  // sky bins near the sun: a receiver that sees none of them cannot be in the sun
  const sunVis = (x, y, z) => { march(S, x, y, z, sunDir[0], sunDir[1], sunDir[2], false, R); return R.type === HIT_SKY ? R.T : 0; };

  // ── outdoor elements ──
  const G = S.ground, nGround = G.nx * G.nz, nOut = nGround + vis.nFacades;
  const outE = new Float32Array(nOut * 3), outL = new Float32Array(nOut * 3), outSun = new Float32Array(nOut);
  const OL = vis.outdoor;
  for (let e = 0; e < nOut; e++) {
    let x, y, z, n;
    if (e < nGround) { const a = e % G.nx, b = (e - a) / G.nx; x = G.ox + a + 0.5; z = G.oz + b + 0.5; y = (G.kind[e] === 1 ? -0.02 : -S.drop) + 0.01; n = [0, 1, 0]; }
    else { const f = (e - nGround) * 5; x = vis.facades[f] + vis.facades[f + 3] * 0.02; y = vis.facades[f + 1]; z = vis.facades[f + 2] + vis.facades[f + 4] * 0.02; n = [vis.facades[f + 3], 0, vis.facades[f + 4]]; }
    const cos = n[0] * sunDir[0] + n[1] * sunDir[1] + n[2] * sunDir[2];
    if (sunOn && cos > 0) {
      let v = 0;
      const offs = e < nGround ? [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]] : [[0, 0]];
      for (const [u, w] of offs) v += e < nGround ? sunVis(x + u, y, z + w) : sunVis(x, y, z);
      outSun[e] = (v / offs.length) * cos;
    }
  }
  for (let it = 0; it < 3; it++) {
    for (let e = 0; e < nOut; e++) {
      let r = sunE[0] * outSun[e], g = sunE[1] * outSun[e], b = sunE[2] * outSun[e];
      for (let q = OL.start[e]; q < OL.start[e + 1]; q++) {
        const s = OL.idx[q], w = OL.w[q] * Math.PI;
        if (s < SKY_BINS) { r += w * sky[s * 3]; g += w * sky[s * 3 + 1]; b += w * sky[s * 3 + 2]; }
        else { const o = (s - SKY_BINS) * 3; r += w * outL[o]; g += w * outL[o + 1]; b += w * outL[o + 2]; }
      }
      outE[e * 3] = r; outE[e * 3 + 1] = g; outE[e * 3 + 2] = b;
    }
    for (let e = 0; e < nOut * 3; e++) outL[e] = (rhoOut[e] * outE[e]) / Math.PI;
  }

  // ── patches: direct sun, cached outdoor light ──
  const direct = new Float32Array(nP * 3), outside = new Float32Array(nP * 3), sunFrac = new Float32Array(nP);
  const linkOf = (r) => (vis.owner[r] >= 0 ? vis.owner[r] : r);
  const sources = (r, cb) => { const o = linkOf(r); for (let q = vis.start[o]; q < vis.start[o + 1]; q++) cb(vis.idx[q], vis.w[q]); };
  const samples = L.sunSamples || S.opts.sunSamples;
  for (let p = 0; p < nP; p++) {
    let r = 0, g = 0, b = 0;
    const o = linkOf(p);
    for (let q = vis.start[o]; q < vis.start[o + 1]; q++) {
      const s = vis.idx[q]; if (s < nP) continue;
      const w = vis.w[q] * Math.PI;
      if (s < vis.SRC_GROUND) { const k = s - vis.SRC_SKY; r += w * sky[k * 3]; g += w * sky[k * 3 + 1]; b += w * sky[k * 3 + 2]; }
      else { const k = (s - vis.SRC_GROUND) * 3; r += w * outL[k]; g += w * outL[k + 1]; b += w * outL[k + 2]; }
    }
    outside[p * 3] = r; outside[p * 3 + 1] = g; outside[p * 3 + 2] = b;
    if (!sunOn) continue;
    const p3 = p * 3, nx = S.patch.nrm[p3], ny = S.patch.nrm[p3 + 1], nz = S.patch.nrm[p3 + 2];
    const cos = nx * sunDir[0] + ny * sunDir[1] + nz * sunDir[2];
    if (cos <= 0) continue;
    // does the sun beam from this patch pass through one of the windows it can see? (patch-size tolerance)
    const mask = vis.apMask[o];
    if (!mask) continue;
    let beam = false;
    for (let a = 0; a < vis.apertures.length && !beam; a++) {
      if (!(mask & (1 << (a & 31)))) continue;
      const A = vis.apertures[a], dn = A.axisN === 0 ? sunDir[0] : sunDir[2];
      if (Math.abs(dn) < 1e-6) continue;
      const t = (A.plane - S.patch.pos[p3 + A.axisN]) / dn;
      if (t <= 0) continue;
      const y = S.patch.pos[p3 + 1] + sunDir[1] * t, al = A.axisN === 0 ? S.patch.pos[p3 + 2] + sunDir[2] * t : S.patch.pos[p3] + sunDir[0] * t;
      const tol = 0.4;
      beam = y > A.y0 - tol && y < A.y1 + tol && al > A.a0 - tol && al < A.a1 + tol;
    }
    if (!beam) continue;
    // sun samples spread over the patch (texel) along its tangent axes
    const ch = S.charts[S.patch.chart[p]];
    const du = ch.type === 'h' ? ch.tile * CS : ch.tile * CS, dv = ch.type === 'h' ? ch.tile * CS : S.rowH;
    let v = 0;
    for (let k = 0; k < samples; k++) {
      const u = ((k + 0.5) / samples - 0.5) * du * 0.8, w = ((((k * 7) % samples) + 0.5) / samples - 0.5) * dv * 0.8;
      let x = S.patch.pos[p3] + nx * 0.003, y = S.patch.pos[p3 + 1] + ny * 0.003, z = S.patch.pos[p3 + 2] + nz * 0.003;
      if (ch.type === 'h') { x += u; z += w; } else if (ch.side < 2) { z += u; y += w; } else { x += u; y += w; }
      const tv = sunVis(x, y, z);
      v += tv; if (tv > 0) sunFrac[p] += 1 / samples;
    }
    v *= cos / samples;
    direct[p3] = sunE[0] * v; direct[p3 + 1] = sunE[1] * v; direct[p3 + 2] = sunE[2] * v;
  }

  // ── diffuse bounces (Jacobi) ──
  const bounces = L.bounces == null ? 5 : L.bounces;
  let ind = new Float32Array(nP * 3), nxt = new Float32Array(nP * 3);
  const B = new Float32Array(nP * 3);                                      // radiosity × π  (= ρ · E_total)
  const iterations = [];
  for (let it = 0; it < bounces; it++) {
    for (let k = 0; k < nP * 3; k++) B[k] = rho[k] * (direct[k] + outside[k] + ind[k]);
    let delta = 0, total = 0;
    for (let p = 0; p < nP; p++) {
      let r = 0, g = 0, b = 0;
      const o = linkOf(p);
      for (let q = vis.start[o]; q < vis.start[o + 1]; q++) {
        const s = vis.idx[q]; if (s >= nP) continue;
        const w = vis.w[q], s3 = s * 3; r += w * B[s3]; g += w * B[s3 + 1]; b += w * B[s3 + 2];
      }
      const p3 = p * 3;
      delta += Math.abs(r - ind[p3]) + Math.abs(g - ind[p3 + 1]) + Math.abs(b - ind[p3 + 2]);
      total += r + g + b;
      nxt[p3] = r; nxt[p3 + 1] = g; nxt[p3 + 2] = b;
    }
    [ind, nxt] = [nxt, ind];
    iterations.push(total > 0 ? delta / total : 0);
  }
  // the bounces not iterated form a geometric series: add its remainder (ratio from the last two passes)
  if (bounces >= 3 && L.extrapolate !== false) {
    const r = iterations[bounces - 1] / Math.max(1e-9, iterations[bounces - 2]);
    if (r > 0 && r < 0.95) { const k = r / (1 - r); for (let q = 0; q < nP * 3; q++) ind[q] += Math.max(0, ind[q] - nxt[q]) * k; }
  }
  // hemisphere sampling of small bright sources (sun patches) is noisy: smooth the bounce term inside each chart
  if (L.filter !== false) ind = filterCharts(S, ind, L.filterRadius || 2, L.filterSigma || 1.1);
  // after the last pass, B for the probes (radiosity of every patch)
  for (let k = 0; k < nP * 3; k++) B[k] = rho[k] * (direct[k] + outside[k] + ind[k]);

  // ── lightmap: irradiance without the direct sun (drawn by the shadow-mapped sun) ──
  const A = S.atlas, lightmap = new Float32Array(A.width * A.height * 4);
  const regionSum = new Float64Array(S.nRegions * 4);
  for (let p = 0; p < nP; p++) {
    const t = S.texelOf[p] * 4, p3 = p * 3;
    lightmap[t] = outside[p3] + ind[p3]; lightmap[t + 1] = outside[p3 + 1] + ind[p3 + 1]; lightmap[t + 2] = outside[p3 + 2] + ind[p3 + 2]; lightmap[t + 3] = sunFrac[p];
    const r4 = S.patch.region[p] * 4, a = S.patch.area[p];
    regionSum[r4] += lightmap[t] * a; regionSum[r4 + 1] += lightmap[t + 1] * a; regionSum[r4 + 2] += lightmap[t + 2] * a; regionSum[r4 + 3] += a;
  }
  for (let r = 0; r < S.nRegions; r++) {
    const t = S.avgTexel[r] * 4, r4 = r * 4, a = regionSum[r4 + 3] || 1;
    lightmap[t] = regionSum[r4] / a; lightmap[t + 1] = regionSum[r4 + 1] / a; lightmap[t + 2] = regionSum[r4 + 2] / a; lightmap[t + 3] = 1;   // unknown faces: never mask the sun
  }
  for (let k = 0; k < A.fillDst.length; k++) {
    const d = A.fillDst[k] * 4, s0 = A.fillSrcStart[k], s1 = A.fillSrcStart[k + 1], inv = 1 / (s1 - s0);
    let r = 0, g = 0, b = 0, a = 0;
    for (let q = s0; q < s1; q++) { const s = A.fillSrc[q] * 4; r += lightmap[s]; g += lightmap[s + 1]; b += lightmap[s + 2]; a = Math.max(a, lightmap[s + 3]); }
    lightmap[d] = r * inv; lightmap[d + 1] = g * inv; lightmap[d + 2] = b * inv; lightmap[d + 3] = a;
  }

  // ── probes: ambient cubes (6 × RGB), no direct sun (the 3D view's sun light adds it) ──
  const nPr = S.probes.length, probes = new Float32Array(nPr * 18);
  for (let q = 0; q < nPr * 6; q++) {
    let r = 0, g = 0, b = 0;
    sources(nP + q, (s, w) => {
      if (s < nP) { const s3 = s * 3; r += w * B[s3]; g += w * B[s3 + 1]; b += w * B[s3 + 2]; }
      else if (s < vis.SRC_GROUND) { const k = (s - vis.SRC_SKY) * 3, ww = w * Math.PI; r += ww * sky[k]; g += ww * sky[k + 1]; b += ww * sky[k + 2]; }
      else { const k = (s - vis.SRC_GROUND) * 3, ww = w * Math.PI; r += ww * outL[k]; g += ww * outL[k + 1]; b += ww * outL[k + 2]; }
    });
    probes[q * 3] = r; probes[q * 3 + 1] = g; probes[q * 3 + 2] = b;
  }
  const field = fieldTexture(S, probes);
  return { direct, sunFraction: sunFrac, outside, indirect: ind, lightmap, probes, field, sky, sunE, ms: Date.now() - t0, iterations, outdoorE: outE };
}
/** Gaussian filter of a per-patch RGB array over each chart's texel grid (never across charts / regions). */
function filterCharts(S, src, radius, sigma) {
  const out = new Float32Array(src.length), k = [];
  for (let d = -radius; d <= radius; d++) k.push(Math.exp(-(d * d) / (2 * sigma * sigma)));
  for (let p = 0; p < S.patch.count; p++) {
    const ch = S.charts[S.patch.chart[p]], t = S.patch.texel[p], col = t % ch.cols, row = (t - col) / ch.cols;
    let r = 0, g = 0, b = 0, w = 0;
    for (let dr = -radius; dr <= radius; dr++) {
      const rr = row + dr; if (rr < 0 || rr >= ch.rows) continue;
      for (let dc = -radius; dc <= radius; dc++) {
        const cc = col + dc; if (cc < 0 || cc >= ch.cols) continue;
        const q = ch.texPatch[rr * ch.cols + cc]; if (q < 0) continue;
        const ww = k[dr + radius] * k[dc + radius] * Math.sqrt(S.patch.area[q] / (S.patch.area[p] || 1e-9) > 1 ? 1 : S.patch.area[q] / (S.patch.area[p] || 1e-9));
        r += ww * src[q * 3]; g += ww * src[q * 3 + 1]; b += ww * src[q * 3 + 2]; w += ww;
      }
    }
    out[p * 3] = r / w; out[p * 3 + 1] = g / w; out[p * 3 + 2] = b / w;
  }
  return out;
}
const sunNormal = (alt) => {
  const m = 1 / (Math.sin(alt * Math.PI / 180) + 0.50572 * Math.pow(alt + 6.07995, -1.6364));
  return (127500 * Math.exp(-0.21 * m) * Math.min(1, (alt + 0.5) / 2)) / LUX_PER_UNIT;
};

/**
 * Probe field texture: width = 6 · nx (one tile per direction +X −X +Y −Y +Z −Z), height = 2 · nz (two layers: the
 * probe heights). RGBA float; alpha = 1 inside the house, 0 outdoors.
 */
function fieldTexture(S, probes) {
  const F = S.field, n = F.nx * F.nz, W = F.nx * 6, out = new Float32Array(W * F.nz * 2 * 4);
  if (!F.probe) return out;
  for (let layer = 0; layer < 2; layer++) {
    for (let f = 0; f < n; f++) {
      const a = f % F.nx, b = (f - a) / F.nx, al = F.alpha[f];
      for (let d = 0; d < 6; d++) {
        let r = 0, g = 0, bl = 0;
        for (let m = 0; m < 4; m++) {
          let k = F.probe[f * 4 + m]; if (k < 0) break;
          const w = F.weight[f * 4 + m];
          if (layer === 1 && k + 1 < S.probes.length && S.probes[k + 1].layer === 1 && S.probes[k + 1].room === S.probes[k].room) k += 1;
          const o = (k * 6 + d) * 3; r += w * probes[o]; g += w * probes[o + 1]; bl += w * probes[o + 2];
        }
        const t = ((layer * F.nz + b) * W + d * F.nx + a) * 4;
        out[t] = r; out[t + 1] = g; out[t + 2] = bl; out[t + 3] = al;
      }
    }
  }
  return out;
}

// ───────────────────────── queries ─────────────────────────
/** Patch whose surface contains / is nearest to a world point with a given axis normal (or -1). */
export function patchAt(S, x, y, z, n) {
  const i = Math.floor((x + n[0] * 0.01 - S.ox) / CS), j = Math.floor((z + n[2] * 0.01 - S.oz) / CS);
  if (i < 0 || j < 0 || i >= S.nx || j >= S.ny) return -1;
  const c = j * S.nx + i;
  if (Math.abs(n[1]) > 0.5) {
    const ch = n[1] > 0 ? S.floorChart[c] : S.ceilChart[c]; if (ch < 0) return -1;
    const C = S.charts[ch], col = Math.floor((i - C.i0) / C.tile), row = Math.floor((j - C.j0) / C.tile);
    return col < 0 || row < 0 || col >= C.cols || row >= C.rows ? -1 : C.texPatch[row * C.cols + col];
  }
  const side = n[0] > 0.5 ? 0 : n[0] < -0.5 ? 1 : n[2] > 0.5 ? 2 : 3;
  const si = Math.floor((x - n[0] * 0.025 - S.ox) / CS), sj = Math.floor((z - n[2] * 0.025 - S.oz) / CS);
  if (si < 0 || sj < 0 || si >= S.nx || sj >= S.ny) return -1;
  const ch = S.faceChart[(sj * S.nx + si) * 4 + side]; if (ch < 0) return -1;
  const C = S.charts[ch], along = side < 2 ? sj : si, col = Math.floor((along - C.a0) / C.tile), row = Math.min(S.nRows - 1, Math.max(0, Math.floor(y / S.rowH)));
  return col < 0 || col >= C.cols ? -1 : C.texPatch[row * C.cols + col];
}

/**
 * Lightmap chart for a surface element (centre point + normal), used to map render geometry into the atlas.
 * Returns a chart id, or the region-average chart, or -1 (not an indoor surface).
 */
export function chartFor(S, x, y, z, nx, ny, nz) {
  const cell = (px, pz) => { const i = Math.floor((px - S.ox) / CS), j = Math.floor((pz - S.oz) / CS); return i < 0 || j < 0 || i >= S.nx || j >= S.ny ? -1 : j * S.nx + i; };
  const avg = (c) => { const r = c >= 0 ? (S.kind[c] === ROOM ? S.reg[c] : S.kind[c] === OPEN ? S.nR + S.reg[c] : -1) : -1; return r >= 0 ? S.chartByKey.get(`a:${r}`).id : -1; };
  if (Math.abs(ny) > 0.7) {
    let c = cell(x, z); if (c < 0) return -1;
    if (S.kind[c] !== ROOM && S.kind[c] !== OPEN) {
      if (ny > 0 || S.kind[c] !== WALL && S.kind[c] !== OPEN) return -1;
      // ceiling over a wall head (only ever seen through hair-line cracks): use the nearest room's ceiling
      let best = -1, bd = Infinity;
      for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
        const q = cell(x + di * CS, z + dj * CS); if (q < 0 || S.kind[q] !== ROOM) continue;
        const d = di * di + dj * dj; if (d < bd) { bd = d; best = q; }
      }
      if (best < 0) return -1;
      c = best;
    }
    const ch = ny > 0 ? S.floorChart[c] : S.ceilChart[c];
    return ch >= 0 ? ch : avg(c);
  }
  const side = Math.abs(nx) >= Math.abs(nz) ? (nx > 0 ? 0 : 1) : (nz > 0 ? 2 : 3);
  const n = [side === 0 ? 1 : side === 1 ? -1 : 0, side === 2 ? 1 : side === 3 ? -1 : 0];
  const front = cell(x + n[0] * 0.012, z + n[1] * 0.012);
  if (front < 0 || (S.kind[front] !== ROOM && S.kind[front] !== OPEN)) return -1;
  const solid = cell(x - n[0] * 0.025, z - n[1] * 0.025);
  const ch = solid >= 0 ? S.faceChart[solid * 4 + side] : -1;
  if (ch >= 0) return ch;
  // skirting / trim a little proud of the wall: look one cell further back
  const solid2 = cell(x - n[0] * 0.06, z - n[1] * 0.06);
  const ch2 = solid2 >= 0 ? S.faceChart[solid2 * 4 + side] : -1;
  return ch2 >= 0 ? ch2 : avg(front);
}

/** Atlas UV (0..1) of a world point on a chart (clamped inside the chart + its padding). */
export function chartUV(S, chId, x, y, z, out = [0, 0]) {
  const C = S.charts[chId], W = S.atlas.width, Hh = S.atlas.height;
  let u, v;
  if (C.type === 'h') { u = ((x - S.ox) / CS - C.i0) / C.tile; v = ((z - S.oz) / CS - C.j0) / C.tile; }
  else if (C.type === 'v') { const along = C.side < 2 ? (z - S.oz) / CS : (x - S.ox) / CS; u = (along - C.a0) / C.tile; v = y / S.rowH; }
  else { u = 0.5; v = 0.5; }
  u = Math.min(C.cols + PAD - 0.5, Math.max(-PAD + 0.5, u)); v = Math.min(C.rows + PAD - 0.5, Math.max(-PAD + 0.5, v));
  out[0] = (C.ax + PAD + u) / W; out[1] = (C.ay + PAD + v) / Hh;
  return out;
}

/** Region (room index, or nR + opening index) of the air at a world point, or -1 (solid / outdoors). */
export function airRegionAt(S, x, y, z) {
  const i = Math.floor((x - S.ox) / CS), j = Math.floor((z - S.oz) / CS);
  if (i < 0 || j < 0 || i >= S.nx || j >= S.ny) return -1;
  const c = j * S.nx + i;
  if (S.kind[c] === ROOM) return y >= 0 && y <= S.H ? S.reg[c] : -1;
  if (S.kind[c] === OPEN) return y >= S.oSill[S.reg[c]] - 1e-6 && y <= S.oHead[S.reg[c]] + 1e-6 ? S.nR + S.reg[c] : -1;
  return -1;
}

/** Room index of a plan point (cm), or -1. */
export function roomAt(S, xcm, ycm) {
  const i = Math.floor((xcm / 100 - S.ox) / CS), j = Math.floor((ycm / 100 - S.oz) / CS);
  if (i < 0 || j < 0 || i >= S.nx || j >= S.ny) return -1;
  const c = j * S.nx + i;
  return S.kind[c] === ROOM ? S.reg[c] : -1;
}

/**
 * Carry a lightmap over to a new layout after a plan edit: every new texel takes the value of the old patch at the
 * same place (same room / surface), else its room's old average — so nothing pops while the new solution is computed.
 * @returns {Float32Array} RGBA float lightmap in S1's atlas
 */
export function transferLightmap(S0, lm0, S1) {
  const out = new Float32Array(S1.atlas.width * S1.atlas.height * 4);
  if (!S0 || !lm0 || lm0.length !== S0.atlas.width * S0.atlas.height * 4) return out;
  const n = [0, 0, 0];
  for (let p = 0; p < S1.patch.count; p++) {
    const p3 = p * 3; n[0] = S1.patch.nrm[p3]; n[1] = S1.patch.nrm[p3 + 1]; n[2] = S1.patch.nrm[p3 + 2];
    const q = patchAt(S0, S1.patch.pos[p3], S1.patch.pos[p3 + 1], S1.patch.pos[p3 + 2], n);
    let src = q >= 0 ? S0.texelOf[q] : -1;
    if (src < 0) {
      const r = S1.patch.region[p], id = r < S1.nR ? S1.roomIds[r] : null, r0 = id ? S0.roomIds.indexOf(id) : -1;
      if (r0 >= 0) src = S0.avgTexel[r0];
    }
    if (src < 0) continue;
    out.set(lm0.subarray(src * 4, src * 4 + 4), S1.texelOf[p] * 4);
  }
  const A = S1.atlas;
  for (let k = 0; k < A.fillDst.length; k++) {
    const d = A.fillDst[k] * 4, s0 = A.fillSrcStart[k], s1 = A.fillSrcStart[k + 1], inv = 1 / (s1 - s0);
    let r = 0, g = 0, b = 0;
    for (let q = s0; q < s1; q++) { const s = A.fillSrc[q] * 4; r += out[s]; g += out[s + 1]; b += out[s + 2]; }
    out[d] = r * inv; out[d + 1] = g * inv; out[d + 2] = b * inv; out[d + 3] = 1;
  }
  return out;
}

/** Float32 → IEEE half (Uint16) for a whole array. */
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
export function toHalf(src, out = new Uint16Array(src.length)) {
  for (let k = 0; k < src.length; k++) {
    _f32[0] = src[k]; const x = _u32[0];
    const s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
    if (e <= 0) out[k] = s | (e < -10 ? 0 : ((m | 0x800000) >>> (1 - e)) >>> 13);
    else if (e >= 31) out[k] = s | 0x7bff;
    else out[k] = s | (e << 10) | (m >>> 13);
  }
  return out;
}
