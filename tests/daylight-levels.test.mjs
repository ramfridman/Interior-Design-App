// Daylight on every floor (stage F6): one solve per level, massing between levels, stair-void light exchange.
//   node tests/daylight-levels.test.mjs
import { createHash } from 'node:crypto';
import { PLAN } from '../src/core/plan.js';
import { store } from '../src/core/store.js';
import * as E from '../src/core/plan-edit.js';
import * as B from '../src/core/plan-build.js';
import { sunPosition, sunDirectionWorld } from '../src/view3d/sun.js';
import * as D from '../src/view3d/daylight/solver.js';
import { createEngine, memoryOf } from '../src/view3d/daylight/engine.js';
import { skyRadiance, LUX_PER_UNIT, binOf } from '../src/view3d/daylight/sky.js';
import { DUPLEX } from './fixtures/houses.mjs';

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const now = () => performance.now();
const lum = (a, i) => 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
const lux = (e) => `${Math.round(e * LUX_PER_UNIT)} lx`;
const hash = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
const META = { latitude: 32.08, longitude: 34.78, timeZone: 'Asia/Jerusalem', northAngle: 0 };
const sunDirAt = (meta, date, hours) => { const p = sunPosition({ date, hours, ...meta }); return { dir: sunDirectionWorld(p.azimuth, p.elevation, meta.northAngle || 0), p }; };

// ───────────────────────── House 98: exactly today's numbers ─────────────────────────
// Hashes captured on the solver before stage F6 (one-level plans take the unchanged code path).
group('House 98 (one level): lightmap / probe / visibility hashes unchanged by F6');
{
  const GOLD = {
    vis: 'f9f3bddb4a7833f2 6f6f3f166d2bae1c 4ee698fbf32019a5 963aabee97e041ad 190',
    sun: '601df68aa2f3f654 ab485e8b8b17eca2 1302be6ba296611e',
    overcast: '24e92b206bd5c5db 1dd623d54c1a19a9',
    lamp: '9012d1017016bd72 8f771a80c0ee3f47',
    occ: 'ee350f6bc627f3b3 bda02512410bea42',
    visShut: 'a0e434b0f4623e36 19847cc90cbe0d45 152ff64f628263d1 19b84e68dc497729 183',
  };
  const sd = (date, h) => sunDirAt(PLAN.meta, date, h).dir;
  const S = D.buildScene(D.sceneInputFromPlan(PLAN, { doorsOpen: true }));
  const sameInput = JSON.stringify(D.sceneInputFromPlan(PLAN, { doorsOpen: true })) === JSON.stringify(D.sceneInputFromPlan(PLAN, { doorsOpen: true, level: 'L0' }));
  check('a plan without levels ignores `level` (same input)', sameInput && !S.lv && !S.portal);
  let t = now(); const V = D.computeVisibility(S, {}); const visMs = now() - t;
  check('visibility hash', [hash(V.idx), hash(V.w), hash(V.outdoor.idx), hash(V.outdoor.w), V.nFacades].join(' ') === GOLD.vis, `${visMs.toFixed(0)} ms`);
  t = now(); const Ls = D.relight(S, V, { sunDir: sd('2026-06-21', 9) }); const relMs = now() - t;
  check('sun relight: lightmap / probes / field hashes', [hash(Ls.lightmap), hash(Ls.probes), hash(Ls.field)].join(' ') === GOLD.sun, `${relMs.toFixed(0)} ms`);
  const Lo = D.relight(S, V, { sunDir: sd('2026-03-20', 12.5), sky: 'overcast' });
  check('overcast relight hashes', [hash(Lo.lightmap), hash(Lo.probes)].join(' ') === GOLD.overcast);
  const Ll = D.relight(S, V, { sunDir: sd('2026-06-21', 23.5), lamps: [{ x: 11, y: 2.3, z: 10, lm: 1500, lobe: -0.5, color: [1, 1, 1] }] });
  check('lamp relight hashes', [hash(Ll.lightmap), hash(Ll.probes)].join(' ') === GOLD.lamp);
  const box = (id, x0, y0, x1, y1, h) => ({ id, corners: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], y0: 0, y1: h });
  D.setOccluders(S, [box('wardrobe', 1215, 1300, 1435, 1360, 2.2), box('bed', 1330, 1130, 1500, 1290, 0.55)]);
  const V2 = D.computeVisibility(S, {}), L2 = D.relight(S, V2, { sunDir: sd('2026-06-21', 8) });
  check('furniture occluders: hashes', [hash(L2.lightmap), hash(L2.probes)].join(' ') === GOLD.occ);
  const Sc = D.buildScene(D.sceneInputFromPlan(PLAN, { doorsOpen: false })), Vc = D.computeVisibility(Sc, {});
  check('doors closed: visibility hash', [hash(Vc.idx), hash(Vc.w), hash(Vc.outdoor.idx), hash(Vc.outdoor.w), Vc.nFacades].join(' ') === GOLD.visShut);
  console.log(`  (House 98: ${S.patch.count} patches, visibility ${visMs.toFixed(0)} ms, relight ${relMs.toFixed(0)} ms)`);
}

// ───────────────────────── the Duplex and its variants ─────────────────────────
const W = (id, x, y, w, h, kind = 'exterior') => ({ id, x, y, w, h, kind });
const EXT = (x0, y0, x1, y1) => [W('w01', x0, y0, x1 - x0, 20), W('w02', x0, y1 - 20, x1 - x0, 20), W('w03', x0, y0 + 20, 20, y1 - y0 - 40), W('w04', x1 - 20, y0 + 20, 20, y1 - y0 - 40)];
const { stairs: _st, ...L1BASE } = DUPLEX.levels[0];
/** Build a Duplex variant (L1 overrides) and open it; returns the plan (PLAN, edited in place). */
function openDuplex(l1 = {}, l0 = {}) {
  const input = { walls: DUPLEX.walls, openings: DUPLEX.openings, heights: DUPLEX.heights, meta: { name: 'Duplex', floors: 2, ...META }, ...l0, levels: [{ ...L1BASE, ...l1 }] };
  const built = B.buildPlan(input, { levels: true });
  if (!built.plan) throw new Error('buildPlan: ' + JSON.stringify(built.problems || built).slice(0, 400));
  store.openProject({ basePlan: built.plan, phase: 'draft', design: { items: [], project: { ceilingHeight: built.plan.heights.ceiling } } });
  return PLAN;
}
function solveLevel(plan, level, opts = {}) {
  const S = D.buildScene(D.sceneInputFromPlan(plan, { level, doorsOpen: true, ...opts }));
  const t0 = now(); const V = D.computeVisibility(S); return { S, V, ms: now() - t0 };
}
const floorOf = (S, id) => { const r = S.roomIds.indexOf(id); return (p) => S.patch.region[p] === r && S.patch.surf[p] === D.SURF.FLOOR; };
function mean(S, filter, value) { let s = 0, a = 0; for (let p = 0; p < S.patch.count; p++) if (filter(p)) { s += value(p) * S.patch.area[p]; a += S.patch.area[p]; } return a ? s / a : NaN; }
const roomOfPoint = (S, xcm, ycm) => { const r = D.roomAt(S, xcm, ycm); return r >= 0 ? S.roomIds[r] : null; };
const OVER = sunDirAt(META, '2026-03-20', 12.5).dir;
const Eh = skyRadiance({ sunDir: OVER, type: 'overcast' }).horizontal;
/** Sky link weight (Σ over sky bins) of a receiver. */
const skyOf = (V, r) => { let s = 0; for (let q = V.start[r]; q < V.start[r + 1]; q++) if (V.idx[q] >= V.SRC_SKY && V.idx[q] < V.SRC_GROUND) s += V.w[q]; return s; };
/** Patch of a level scene nearest to a point (m) with a given surface / normal. */
function patchNear(S, x, y, z, surf) {
  let best = -1, bd = Infinity;
  for (let p = 0; p < S.patch.count; p++) {
    if (S.patch.surf[p] !== surf) continue;
    const d = Math.hypot(S.patch.pos[p * 3] - x, S.patch.pos[p * 3 + 1] - y, S.patch.pos[p * 3 + 2] - z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

group('Duplex: one solve per level, in the level\'s own frame');
const P = openDuplex();
const L0 = solveLevel(P, 'L0'), L1 = solveLevel(P, 'L1');
check('L0 and L1 scenes: level-local heights, shared grid, the other storey as massing',
  L0.S.H === 2.8 && L1.S.H === 2.8 && Math.abs(L1.S.drop - 3.15) < 1e-9 && L0.S.nx === L1.S.nx && L0.S.ox === L1.S.ox && L0.S.lv.skyTop > 6.3 && L1.S.lv.skyTop < 3.5,
  `L0 skyTop ${L0.S.lv.skyTop.toFixed(2)} m (L1's roof + parapet), L1 ground at −${L1.S.drop.toFixed(2)} m`);
check('rooms per level come from the level views', L0.S.roomIds.join() !== L1.S.roomIds.join() && L1.S.nR === 2, `L0 ${L0.S.roomIds}, L1 ${L1.S.roomIds}`);
{
  const lo = D.relight(L1.S, L1.V, { sunDir: OVER, sky: 'overcast' });
  const east = roomOfPoint(L1.S, 700, 500), west = roomOfPoint(L1.S, 150, 400);
  const e = mean(L1.S, floorOf(L1.S, east), (p) => lum(lo.outside, p * 3) + lum(lo.indirect, p * 3));
  const nearWin = mean(L1.S, (p) => floorOf(L1.S, east)(p) && L1.S.patch.pos[p * 3] > 8.4 && Math.abs(L1.S.patch.pos[p * 3 + 2] - 3.6) < 1, (p) => lum(lo.outside, p * 3) + lum(lo.indirect, p * 3));
  const df = (e / Eh) * 100, dfWin = (nearWin / Eh) * 100;
  check('L1 east room gets daylight through the L1 east window (> 0 lx, plausible daylight factor)', e * LUX_PER_UNIT > 20 && df > 0.2 && df < 5 && dfWin > df,
    `floor mean ${lux(e)} = DF ${df.toFixed(2)} % (by the window ${dfWin.toFixed(1)} %), west room ${lux(mean(L1.S, floorOf(L1.S, west), (p) => lum(lo.outside, p * 3) + lum(lo.indirect, p * 3)))}`);
  // sun at 09:00 in June through the east window: the patch lands where the window's height says
  const { dir, p } = sunDirAt(META, '2026-06-21', 9);
  const ls = D.relight(L1.S, L1.V, { sunDir: dir });
  let sx = 0, sz = 0, sa = 0;
  for (let q = 0; q < L1.S.patch.count; q++) if (L1.S.patch.surf[q] === D.SURF.FLOOR && ls.sunFraction[q] > 0) { const a = L1.S.patch.area[q] * ls.sunFraction[q]; sx += L1.S.patch.pos[q * 3] * a; sz += L1.S.patch.pos[q * 3 + 2] * a; sa += a; }
  // expected: centre of the glass (x 9.9, y 3.6, z 1.5 m above the L1 floor) moved down the beam to the floor
  const k = 1.5 / dir[1], ex = 9.9 - dir[0] * k, ez = 3.6 - dir[2] * k;
  const d = sa ? Math.hypot(sx / sa - ex, sz / sa - ez) : Infinity;
  check('direct sun enters the upper window with the geometry of its height (sun-patch centre within 0.45 m)', sa > 0.3 && d < 0.45,
    `sun ${p.elevation.toFixed(0)}° alt: patch ${sa.toFixed(2)} m² centred (${(sx / sa).toFixed(2)}, ${(sz / sa).toFixed(2)}) vs (${ex.toFixed(2)}, ${ez.toFixed(2)})`);
}

group('Massing between levels: the L0 north window under the upper storey');
{
  // the same ground floor as a one-storey house: what the north window sees of the sky
  const solo = B.buildPlan({ walls: DUPLEX.walls, openings: DUPLEX.openings, heights: DUPLEX.heights, meta: { name: 'Solo', ...META } }).plan;
  store.openProject({ basePlan: solo, phase: 'draft', design: { items: [], project: { ceilingHeight: 280 } } });
  const Ssolo = D.buildScene(D.sceneInputFromPlan(PLAN, { doorsOpen: true })); const t0 = now(); const Vsolo = D.computeVisibility(Ssolo); const soloMs = now() - t0;
  // the floor patch 40 cm inside the window centre (plans are re-based by buildPlan: read the window's position)
  const winAt = () => { const o = PLAN.openings.find((q) => q.id === 'win-north'); return { x0: o.x / 100, x1: (o.x + o.w) / 100, plane: (o.y + o.h / 2) / 100, inner: (o.y + o.h) / 100 }; };
  const pick = (S, w = winAt()) => patchNear(S, (w.x0 + w.x1) / 2, 0, w.inner + 0.4, D.SURF.FLOOR);
  const sSolo = skyOf(Vsolo, pick(Ssolo)), sDup = skyOf(L0.V, pick(L0.S, { x0: 6.5, x1: 8, plane: 0.1, inner: 0.2 }));
  check('Duplex (L1 = same footprint): the L0 north window\'s sky view is unaffected (±2 %)', Math.abs(sDup / sSolo - 1) < 0.02, `sky form factor ${sDup.toFixed(4)} vs one storey ${sSolo.toFixed(4)}`);
  // L1 1.5 m larger to the north: a cantilever over the L0 north window
  const big = openDuplex({ walls: [...EXT(0, -150, 1000, 800), W('w05', 300, -130, 10, 910, 'interior')] });
  const Ob = solveLevel(big, 'L0'), wb = winAt(), dz = wb.plane - 0.1;               // (the variant is shifted by buildPlan)
  const sOver = skyOf(Ob.V, pick(Ob.S, wb));
  // expected: independent Monte-Carlo of the same receiver through the window rectangle against a box overhang
  const recv = Array.from(Ob.S.patch.pos.slice(pick(Ob.S, wb) * 3, pick(Ob.S, wb) * 3 + 3));
  recv[2] -= dz;                                                                // into the unshifted frame of the box below
  let skyN = 0, blocked = 0;
  const rand = (() => { let a = 12345; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  for (let s = 0; s < 400000; s++) {
    const u1 = rand(), u2 = rand(), r = Math.sqrt(u1), ph = 2 * Math.PI * u2;
    const d = [r * Math.cos(ph), Math.sqrt(1 - u1), r * Math.sin(ph)];          // cosine-weighted about +y (a floor patch)
    if (d[2] >= -1e-6) continue;                                                // towards the north wall (z = 0.2 → 0 m)
    const tw = (0.1 - recv[2]) / d[2];                                          // glass plane, mid-wall
    const wx = recv[0] + d[0] * tw, wy = recv[1] + d[1] * tw;
    if (wx < 6.5 || wx > 8.0 || wy < 0.9 || wy > 2.1) continue;                  // through the 150 × 120 window only
    if (d[1] <= 0) continue;                                                    // below the horizon: ground
    skyN++;
    // overhang box: x 0…10, z −1.5…0, from the L1 slab underside (2.8 m) up
    const tz = (-1.5 - recv[2]) / d[2], yAtEdge = recv[1] + d[1] * tz, xAtEdge = recv[0] + d[0] * tz;
    if (yAtEdge > 2.8 && xAtEdge > 0 && xAtEdge < 10) blocked++;
    else if (yAtEdge > 2.8) { const t28 = (2.8 - recv[1]) / d[1], x28 = recv[0] + d[0] * t28, z28 = recv[2] + d[2] * t28; if (z28 > -1.5 && x28 > 0 && x28 < 10) blocked++; }
  }
  const expectLoss = blocked / skyN, gotLoss = 1 - sOver / sDup;
  check('L1 cantilevered 1.5 m over the L0 north window: the window loses the expected sky fraction (±0.08)', Math.abs(gotLoss - expectLoss) < 0.08 && gotLoss > 0.1,
    `sky form factor ${sDup.toFixed(4)} → ${sOver.toFixed(4)}: −${(gotLoss * 100).toFixed(0)} % (geometry: −${(expectLoss * 100).toFixed(0)} %)`);
  const lo0 = D.relight(L0.S, L0.V, { sunDir: OVER, sky: 'overcast' }), lo1 = D.relight(Ob.S, Ob.V, { sunDir: OVER, sky: 'overcast' });
  const r0 = roomOfPoint(L0.S, 750, 300), r1 = roomOfPoint(Ob.S, 750, 300 + dz * 100);
  const m0 = mean(L0.S, floorOf(L0.S, r0), (p) => lum(lo0.outside, p * 3) + lum(lo0.indirect, p * 3)), m1 = mean(Ob.S, floorOf(Ob.S, r1), (p) => lum(lo1.outside, p * 3) + lum(lo1.indirect, p * 3));
  check('…and its room is darker under the overcast sky', m1 < m0 * 0.95, `${lux(m0)} → ${lux(m1)}`);
  check('performance: two storeys ≈ 2 × one storey of visibility (≤ 2.6 ×)', (L0.ms + L1.ms) <= 2.6 * soloMs + 150,
    `one storey ${soloMs.toFixed(0)} ms; Duplex L0 ${L0.ms.toFixed(0)} ms + L1 ${L1.ms.toFixed(0)} ms`);
}

group('Massing between levels: an upper window over a terrace sees the terrace as its ground');
{
  // L1 only over the west 6 m: the rest of the L0 roof is a terrace (parapet 40 cm) in front of an L1 east window
  const terr = openDuplex({
    walls: [...EXT(0, 0, 600, 800), W('w05', 300, 20, 10, 760, 'interior')],
    openings: [DUPLEX.levels[0].openings[0], { id: 'win-east-1', kind: 'window', style: 'sliding', axis: 'v', x: 580, y: 300, w: 20, h: 120, width: 120, height: 120, sill: 90 }],
    voids: [],
  });
  const T = solveLevel(terr, 'L1');
  const G = T.S.ground, e = (xm, zm) => (Math.floor(zm - G.oz) * G.nx + Math.floor(xm - G.ox));
  check('ground elements over the terrace are at the L0 roof (local 0 m, kind roof), beyond it at the real ground',
    Math.abs(G.y[e(8.0, 4.0)]) < 0.05 && G.kind[e(8.0, 4.0)] === 3 && Math.abs(G.y[e(12.5, 4.0)] + 3.15) < 1e-6,
    `terrace ${G.y[e(8.0, 4.0)].toFixed(2)} m, garden ${G.y[e(12.5, 4.0)].toFixed(2)} m (level-local)`);
  // where the east window's light comes from below the horizon: mostly the terrace, not the garden 3 m lower
  let wT = 0, wG = 0;
  const east = roomOfPoint(T.S, 450, 400), rEast = T.S.roomIds.indexOf(east);
  for (let p = 0; p < T.S.patch.count; p++) {
    if (T.S.patch.region[p] !== rEast) continue;
    for (let q = T.V.start[p]; q < T.V.start[p + 1]; q++) {
      const s = T.V.idx[q]; if (s < T.V.SRC_GROUND || s >= T.V.SRC_FACADE) continue;
      const g = s - T.V.SRC_GROUND; if (G.y[g] > -0.5) wT += T.V.w[q]; else wG += T.V.w[q];
    }
  }
  // no ray goes through the terrace: every ground element the room sees in front of the window, up to the parapet, is the roof
  let through = 0;
  for (let p = 0; p < T.S.patch.count; p++) {
    if (T.S.patch.region[p] !== rEast) continue;
    for (let q = T.V.start[p]; q < T.V.start[p + 1]; q++) {
      const s = T.V.idx[q]; if (s < T.V.SRC_GROUND || s >= T.V.SRC_FACADE) continue;
      const g = s - T.V.SRC_GROUND, gx = G.ox + (g % G.nx) + 0.5, gz = G.oz + Math.floor(g / G.nx) + 0.5;
      if (gx > 6.2 && gx < 9.7 && gz > 0.3 && gz < 7.7 && G.y[g] < -0.5) through++;
    }
  }
  check('the east room sees the terrace as its ground: no link to the garden under the terrace, a large share of its ground light from it',
    through === 0 && wT / (wT + wG) > 0.3, `terrace ${(100 * wT / (wT + wG)).toFixed(0)} % of the ground light (the rest: the garden beyond the parapet)`);
  // parapet: the L0 roof edge band stands 40 cm proud — an obstruction a ray towards the garden can hit
  const S = T.S, c = (xcm, ycm) => Math.floor((ycm / 100 - S.oz) / D.CELL_M) * S.nx + Math.floor((xcm / 100 - S.ox) / D.CELL_M);
  check('the lower roof\'s parapet band is raised ground (+0.40 m) at the terrace edge only', Math.abs(S.lv.gY[c(990, 400)] - 0.4) < 1e-4 && Math.abs(S.lv.gY[c(800, 400)]) < 1e-4,
    `edge ${S.lv.gY[c(990, 400)].toFixed(2)} m, terrace ${S.lv.gY[c(800, 400)].toFixed(2)} m`);
  const L0t = solveLevel(terr, 'L0');
  const top = L0t.S.lv.top, c0 = (xcm, ycm) => Math.floor((ycm / 100 - L0t.S.oz) / D.CELL_M) * L0t.S.nx + Math.floor((xcm / 100 - L0t.S.ox) / D.CELL_M);
  check('in the L0 scene the upper storey closes only the columns it covers', top[c0(200, 400)] > 5.9 && top[c0(800, 400)] < 3.1, `under L1 ${top[c0(200, 400)].toFixed(2)} m, terrace ${top[c0(800, 400)].toFixed(2)} m`);
}

group('Stair void: light exchange between the levels (lamp on L1 at night)');
const NIGHT = sunDirAt(META, '2026-06-21', 23.5).dir;
openDuplex();
const lamp = { x: 6.6, y: 2.4, z: 3.0, lm: 1500, lobe: -0.3, color: [1, 1, 1] };
{
  check('portals: L1 floor over the void and the L0 ceiling under it', L1.S.portal.downPatch.length > 0 && L0.S.portal.upPatch.length > 0 && !L0.S.portal.downPatch.length,
    `${L1.S.portal.downCell.length} / ${L0.S.portal.upCell.length} cells`);
  const a1 = D.relight(L1.S, L1.V, { sunDir: NIGHT, lamps: [lamp] });
  const a0 = D.relight(L0.S, L0.V, { sunDir: NIGHT });
  const under = (S) => (p) => S.patch.surf[p] === D.SURF.FLOOR && S.patch.pos[p * 3] > 5.2 && S.patch.pos[p * 3] < 6.2 && S.patch.pos[p * 3 + 2] > 2.7 && S.patch.pos[p * 3 + 2] < 6.4;
  const lm = (L) => (p) => lum(L.lightmap, L0.S.texelOf[p] * 4);
  const e1 = mean(L1.S, floorOf(L1.S, roomOfPoint(L1.S, 700, 300)), (p) => lum(a1.lightmap, L1.S.texelOf[p] * 4));
  const dark0 = mean(L0.S, under(L0.S), lm(a0));
  check('the L1 lamp lights its L1 room; without the exchange L0 stays (night-sky) dark', e1 * LUX_PER_UNIT > 10 && dark0 * LUX_PER_UNIT < 0.05, `L1 room ${lux(e1)}, L0 under the void ${(dark0 * LUX_PER_UNIT).toFixed(3)} lx`);
  // exchange: L1 → L0 → L1 → L0
  const em0 = D.portalEmit(L0.S, L1.S, a1.portalE, 'down');
  const b0 = D.relight(L0.S, L0.V, { sunDir: NIGHT, emit: em0 });
  const em1 = D.portalEmit(L1.S, L0.S, b0.portalE, 'up');
  const b1 = D.relight(L1.S, L1.V, { sunDir: NIGHT, lamps: [lamp], emit: em1 });
  const c0 = D.relight(L0.S, L0.V, { sunDir: NIGHT, emit: D.portalEmit(L0.S, L1.S, b1.portalE, 'down') });
  const below = mean(L0.S, under(L0.S), lm(c0)), farRoom = mean(L0.S, floorOf(L0.S, roomOfPoint(L0.S, 150, 400)), lm(c0));
  check('with the exchange the lamp spills through the void: L0 floor under the void lit, the far room (through a door) much less', below * LUX_PER_UNIT > 1 && below > 20 * dark0 && farRoom < below * 0.3,
    `${lux(below)} under the void, ${lux(farRoom)} in the west room`);
  // flux bookkeeping: what leaves through the L0 ceiling portal ≤ what reached the L1 floor portal
  const fluxOf = (S, E, list) => { let f = 0; for (const p of list) f += lum(E, p * 3) * S.patch.area[p]; return f * LUX_PER_UNIT; };
  const upPatches = [...new Set(L0.S.portal.upPatch)], downPatches = [...new Set(L1.S.portal.downPatch)];
  const into = fluxOf(L1.S, b1.portalE, downPatches), outOf = fluxOf(L0.S, D.portalEmit(L0.S, L1.S, b1.portalE, 'down'), upPatches);
  check('portal: flux emitted below ≤ flux received above (no light created)', outOf <= into * 1.0001 && outOf > 0.9 * into, `${outOf.toFixed(1)} lm out of ${into.toFixed(1)} lm`);
  check('L1 sees L0\'s light back through the void (second iteration adds, never removes)', mean(L1.S, () => true, (p) => lum(b1.lightmap, L1.S.texelOf[p] * 4)) >= mean(L1.S, () => true, (p) => lum(a1.lightmap, L1.S.texelOf[p] * 4)));
}

group('Energy: a closed Duplex lit by one lamp — absorbed flux ≤ the lamp\'s');
{
  const closed = openDuplex({ openings: [DUPLEX.levels[0].openings[0]] }, { openings: DUPLEX.openings.filter((o) => o.kind === 'door') });
  const A = solveLevel(closed, 'L0'), Bv = solveLevel(closed, 'L1');
  let e0 = null, e1 = null, r0 = null, r1 = null;
  for (let it = 0; it < 6; it++) {
    r1 = D.relight(Bv.S, Bv.V, { sunDir: NIGHT, lamps: [lamp], emit: e1, extrapolate: false, filter: false, bounces: 12 });
    e0 = D.portalEmit(A.S, Bv.S, r1.portalE, 'down');
    r0 = D.relight(A.S, A.V, { sunDir: NIGHT, emit: e0, extrapolate: false, filter: false, bounces: 12 });
    e1 = D.portalEmit(Bv.S, A.S, r0.portalE, 'up');
  }
  const absorbed = (S, L) => {
    const rho = D.albedoArrays(S, null).patch;
    let f = 0;
    for (let p = 0; p < S.patch.count; p++) {
      if (S.patch.surf[p] === D.SURF.VOID_FLOOR || S.patch.surf[p] === D.SURF.VOID_CEILING) continue;
      const E = lum(L.direct, p * 3) + lum(L.lamp, p * 3) + lum(L.outside, p * 3) + lum(L.indirect, p * 3);
      f += (1 - lum(rho, p * 3)) * E * S.patch.area[p];
    }
    return f * LUX_PER_UNIT;
  };
  const a0 = absorbed(A.S, r0), a1 = absorbed(Bv.S, r1), tot = a0 + a1;
  check('total absorbed (both floors) ≤ entering (1500 lm lamp), and most of it accounted for', tot <= 1500 * 1.02 && tot > 1500 * 0.7, `${tot.toFixed(0)} lm (L1 ${a1.toFixed(0)}, L0 ${a0.toFixed(0)} through the void)`);
}

group('Furniture occlusion on L1');
{
  const box = { id: 'wardrobe', corners: [[700, 720], [940, 720], [940, 780], [700, 780]], y0: 0, y1: 2.2 };
  const before = D.relight(L1.S, L1.V, { sunDir: OVER, sky: 'overcast' });
  const regions = new Set(); D.occluderRegions(L1.S, box, regions);
  D.setOccluders(L1.S, [box]);
  const job = D.createVisibilityJob(L1.S, { base: L1.V, redo: D.receiversFor(L1.S, regions) }); job.step(1e12);
  const after = D.relight(L1.S, job.result(), { sunDir: OVER, sky: 'overcast' });
  const under = (p) => L1.S.patch.surf[p] === D.SURF.FLOOR && L1.S.patch.pos[p * 3] > 7.25 && L1.S.patch.pos[p * 3] < 9.15 && L1.S.patch.pos[p * 3 + 2] > 7.3;
  const u0 = mean(L1.S, under, (p) => lum(before.lightmap, L1.S.texelOf[p] * 4)), u1 = mean(L1.S, under, (p) => lum(after.lightmap, L1.S.texelOf[p] * 4));
  const room = mean(L1.S, floorOf(L1.S, roomOfPoint(L1.S, 700, 400)), (p) => lum(after.lightmap, L1.S.texelOf[p] * 4));
  // under the box the floor sees only the furniture proxy surface (FURNITURE_ALBEDO × the room's mean irradiance)
  check('an L1 wardrobe darkens the L1 floor under it (down to the furniture-proxy level)', u1 < 0.6 * u0 && u1 <= (D.FURNITURE_ALBEDO + 0.02) * room, `${lux(u0)} → ${lux(u1)} (room mean ${lux(room)})`);
  D.setOccluders(L1.S, []);
}

group('Edits: an L1-only edit re-solves L1, not L0; the engine solves the active level first');
{
  openDuplex();
  const keys = () => Object.fromEntries(['L0', 'L1'].map((id) => [id, JSON.stringify(D.sceneInputFromPlan(PLAN, { level: id, doorsOpen: true }))]));
  const k0 = keys();
  E.setActiveLevel('L1');
  const add = E.addOpening({ kind: 'window', x: 990, y: 650 });
  const k1 = keys();
  check('adding a window on L1 changes L1\'s input only (L0 keeps its visibility)', add.ok && k1.L0 === k0.L0 && k1.L1 !== k0.L1, add.ok ? '' : JSON.stringify(add.reason));
  const grow = E.updateLevel('L1', { heights: { ceiling: 300 } });
  const k2 = keys();
  check('changing L1\'s height changes the massing seen from L0 (L0 re-solved too)', grow.ok && k2.L0 !== k1.L0, grow.ok ? '' : JSON.stringify(grow.reason));
  E.setActiveLevel('L0');

  // engine: both levels, L1 active
  openDuplex();
  const msgs = [];
  const eng = createEngine((m) => msgs.push({ ...m, at: now() }));
  const inp = (id) => D.sceneInputFromPlan(PLAN, { level: id, doorsOpen: true });
  const t0 = now();
  eng.handle({ type: 'levels', ids: ['L0', 'L1'], active: 'L1' });
  eng.handle({ type: 'scene', serial: 1, level: 'L0', input: inp('L0') });
  eng.handle({ type: 'scene', serial: 1, level: 'L1', input: inp('L1') });
  eng.handle({ type: 'light', lighting: { sunDir: OVER, sky: 'overcast', lampsByLevel: { L1: [lamp] } } });
  const idle = async () => { for (let i = 0; i < 2000; i++) { await new Promise((r) => setTimeout(r, 5)); if (!eng.debug().some((d) => d.busy)) { await new Promise((r) => setTimeout(r, 30)); if (!eng.debug().some((d) => d.busy)) return; } } };
  await idle();
  const results = msgs.filter((m) => m.type === 'result');
  const first = results[0], firstL0 = results.find((m) => m.level === 'L0');
  check('the active level (L1) gets the first result, before L0', first && first.level === 'L1' && firstL0 && first.at <= firstL0.at, `${first && first.level} at ${(first.at - t0).toFixed(0)} ms, L0 at ${(firstL0.at - t0).toFixed(0)} ms`);
  const fine = (lv) => msgs.filter((m) => m.type === 'vis' && m.level === lv && !m.coarse);
  check('both levels reach their fine visibility; exchange rounds 1 and 2 posted', fine('L0').length === 1 && fine('L1').length === 1 && results.some((m) => m.round === 2), `${results.length} results`);
  const mem = eng.debug().map((d) => `${d.level} ${(d.bytes / 1048576).toFixed(1)} MB`).join(', ');
  const visL0 = msgs.filter((m) => m.type === 'vis' && m.level === 'L0').length;
  msgs.length = 0;
  E.setActiveLevel('L1'); E.addOpening({ kind: 'window', x: 990, y: 650 }); E.setActiveLevel('L0');
  eng.handle({ type: 'scene', serial: 2, level: 'L1', input: inp('L1') });
  await idle();
  check('an L1-only edit: new L1 visibility, none for L0 (L0 only relit for the void light)', msgs.some((m) => m.type === 'vis' && m.level === 'L1') && !msgs.some((m) => m.type === 'vis' && m.level === 'L0') && visL0 === 2, `memory per level: ${mem}`);
  eng.dispose();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
