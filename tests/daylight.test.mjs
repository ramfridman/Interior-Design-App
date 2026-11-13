// Daylight solver (src/view3d/daylight/solver.js) on the real plan — plain node, no dependencies.
//   node tests/daylight.test.mjs
import { PLAN } from '../src/core/plan.js';
import { store } from '../src/core/store.js';
import * as E from '../src/core/plan-edit.js';
import { sunPosition, sunDirectionWorld } from '../src/view3d/sun.js';
import * as D from '../src/view3d/daylight/solver.js';
import { skyRadiance, LUX_PER_UNIT } from '../src/view3d/daylight/sky.js';
import { lampSpec, lampEmitters, occluderBox, kelvinColor } from '../src/view3d/daylight/lamps.js';

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const lux = (e) => `${Math.round(e * LUX_PER_UNIT)} lx`;
const lum = (a, i) => 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
const sunDir = (date, hours) => { const p = sunPosition({ date, hours, ...PLAN.meta }); return sunDirectionWorld(p.azimuth, p.elevation, PLAN.meta.northAngle); };
const OVERCAST = { sunDir: sunDir('2026-03-20', 12.5), sky: 'overcast' };
const now = () => performance.now();

/** Build + solve visibility for an input; returns { S, V, ms }. */
function solve(input, opts = {}) {
  const S = D.buildScene(input);
  const t0 = now();
  const V = D.computeVisibility(S, opts);
  return { S, V, ms: now() - t0 };
}
const totalE = (L, p) => lum(L.direct, p * 3) + lum(L.outside, p * 3) + lum(L.indirect, p * 3);
/** Area-weighted mean of a per-patch value over patches matching a filter. */
function mean(S, L, filter, value = (p) => totalE(L, p)) {
  let s = 0, a = 0;
  for (let p = 0; p < S.patch.count; p++) {
    if (!filter(p)) continue;
    const A = S.patch.area[p]; s += value(p) * A; a += A;
  }
  return a ? s / a : NaN;
}
const roomFloor = (S, id) => { const r = S.roomIds.indexOf(id); return (p) => S.patch.region[p] === r && S.patch.surf[p] === D.SURF.FLOOR; };
const roomWalls = (S, id) => { const r = S.roomIds.indexOf(id); return (p) => S.patch.region[p] === r && S.patch.surf[p] === D.SURF.WALL; };
const pos = (S, p) => [S.patch.pos[p * 3] * 100, S.patch.pos[p * 3 + 1] * 100, S.patch.pos[p * 3 + 2] * 100];   // cm
const nearestProbe = (S, room, xcm, ycm, layer = 0) => {
  let best = -1, bd = Infinity;
  S.probes.forEach((q, k) => { if (S.roomIds[q.room] !== room || q.layer !== layer) return; const d = Math.hypot(q.x * 100 - xcm, q.z * 100 - ycm); if (d < bd) { bd = d; best = k; } });
  return best;
};

// ───────────────────────── geometry & visibility ─────────────────────────
group('Scene and visibility cache (real plan, doors open)');
const input = D.sceneInputFromPlan(PLAN, { doorsOpen: true });
let t = now();
const S = D.buildScene(input);
const sceneMs = now() - t;
check('scene builds', S.patch.count > 5000, `${S.patch.count} patches in ${S.charts.length} charts, atlas ${S.atlas.width}×${S.atlas.height} (${(S.atlas.width * S.atlas.height * 8 / 1024).toFixed(0)} KB half-float RGBA), ${S.probes.length} probes, ${sceneMs.toFixed(0)} ms`);
t = now(); const Vc = D.computeVisibility(S, { coarse: true }); const coarseMs = now() - t;
t = now(); const V = D.computeVisibility(S, {}); const visMs = now() - t;
check('coarse visibility (preview) ≤ 2 s', coarseMs <= 2000, `${coarseMs.toFixed(0)} ms, ${Vc.idx.length.toLocaleString()} links`);
check('full visibility ≤ 8 s', visMs <= 8000, `${visMs.toFixed(0)} ms, ${V.idx.length.toLocaleString()} links, ${V.nFacades} facade elements`);
{
  let bad = 0, maxIn = 0, maxAll = 0;
  for (let p = 0; p < S.patch.count; p++) {
    let sIn = 0, sAll = 0;
    for (let q = V.start[p]; q < V.start[p + 1]; q++) { sAll += V.w[q]; if (V.idx[q] < S.patch.count) sIn += V.w[q]; if (!(V.w[q] >= 0)) bad++; }
    maxIn = Math.max(maxIn, sIn); maxAll = Math.max(maxAll, sAll);
  }
  check('form factors: indoor links of every patch sum to ≤ 1 (energy is not created)', maxIn <= 1 + 1e-4 && !bad, `max ${maxIn.toFixed(4)}`);
  check('form factors: indoor + outdoor (aperture quadrature) sum ≤ 1.1', maxAll <= 1.1, `max ${maxAll.toFixed(4)}`);
}

// ───────────────────────── relight timings ─────────────────────────
group('Relight speed');
const times = [];
for (let i = 0; i < 6; i++) { const t1 = now(); D.relight(S, V, { sunDir: sunDir('2026-06-21', 8 + i * 1.7) }); times.push(now() - t1); }
const steady = times.slice(2).sort((a, b) => a - b);
check('relight (sun, sky, ground, 5 bounces, probes, lightmap) ≤ 150 ms', steady[1] <= 150, `median ${steady[1].toFixed(1)} ms (first, cold: ${times[0].toFixed(0)} ms)`);

// ───────────────────────── hour and season ─────────────────────────
group('Hour of day (21 June): east bedrooms vs west-facing dining by the terrace door');
const L8 = D.relight(S, V, { sunDir: sunDir('2026-06-21', 8) });
const L17 = D.relight(S, V, { sunDir: sunDir('2026-06-21', 17) });
const L13 = D.relight(S, V, { sunDir: sunDir('2026-06-21', 12.65) });
const bedrooms = (p) => roomFloor(S, 'bedroom-1')(p) || roomFloor(S, 'bedroom-2')(p);
const terrace = PLAN.openings.find((o) => o.id === 'door-terrace');
const byTerrace = (p) => { const [x, , y] = pos(S, p); return roomFloor(S, 'main')(p) && x < terrace.x + 350 && y > terrace.y - 60 && y < terrace.y + terrace.h + 60; };
const b8 = mean(S, L8, bedrooms), b17 = mean(S, L17, bedrooms), w8 = mean(S, L8, byTerrace), w17 = mean(S, L17, byTerrace);
check('east bedrooms: 08:00 several times brighter than 17:00', b8 > 3 * b17, `${lux(b8)} vs ${lux(b17)} (×${(b8 / b17).toFixed(1)})`);
check('dining by the terrace door: 17:00 several times brighter than 08:00', w17 > 3 * w8, `${lux(w17)} vs ${lux(w8)} (×${(w17 / w8).toFixed(1)})`);
const decL = D.relight(S, V, { sunDir: sunDir('2026-12-21', 12) });
console.log(`       floor means: bedroom-1 08:00 ${lux(mean(S, L8, roomFloor(S, 'bedroom-1')))}, 12:40 ${lux(mean(S, L13, roomFloor(S, 'bedroom-1')))}, 17:00 ${lux(mean(S, L17, roomFloor(S, 'bedroom-1')))}; ` +
  `main 21 Jun 12:40 ${lux(mean(S, L13, roomFloor(S, 'main')))}, 21 Dec 12:00 ${lux(mean(S, decL, roomFloor(S, 'main')))}`);

group('Fall-off from the window (Bedroom 1, solar noon 21 June — no direct sun through the east window)');
{
  const win = PLAN.openings.find((o) => o.id === 'win-bedroom-1'), yc = win.y + win.h / 2;
  const bins = [];
  for (let p = 0; p < S.patch.count; p++) {
    if (!roomFloor(S, 'bedroom-1')(p)) continue;
    const [x, , y] = pos(S, p); if (Math.abs(y - yc) > 45) continue;
    const k = Math.floor((win.x - x) / 50); (bins[k] = bins[k] || []).push(totalE(L13, p));
  }
  const prof = bins.filter(Boolean).map((b) => b.reduce((s, v) => s + v, 0) / b.length);
  // the strip right under the 1.10 m sill sees the window only at grazing angles, so the floor peaks a little way
  // into the room (as in reality); from that peak on it must fall monotonically to the back wall
  const peak = prof.indexOf(Math.max(...prof));
  let mono = true; for (let i = peak + 1; i < prof.length; i++) if (prof[i] > prof[i - 1] * 1.02) mono = false;
  check('floor irradiance peaks within 1 m of the window wall', peak <= 1, `peak at ${peak * 50}–${peak * 50 + 50} cm`);
  check('…then decreases monotonically with distance from the window', mono && prof.length - peak >= 5, prof.map((v) => Math.round(v * LUX_PER_UNIT)).join(' → ') + ' lx (50 cm steps)');
}

// ───────────────────────── daylight factor ─────────────────────────
group('Daylight factor (CIE overcast sky, work plane 0.8 m)');
const Lo = D.relight(S, V, OVERCAST);
const Eh = skyRadiance({ sunDir: OVERCAST.sunDir, type: 'overcast' }).horizontal;
const df = (room, x, y) => { const k = nearestProbe(S, room, x, y); return (lum(Lo.probes, k * 18 + 6) / Eh) * 100; };
{
  const r = PLAN.rooms.find((q) => q.id === 'bedroom-1'), xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const mid = df('bedroom-1', cx, cy), near = df('bedroom-1', Math.max(...xs) - 40, cy);
  check('Bedroom 1 mid-room daylight factor within 0.5–8 %', mid >= 0.5 && mid <= 8, `${mid.toFixed(2)} %`);
  check('daylight factor higher near the window', near > mid, `${near.toFixed(2)} % by the window`);
  const living = df('main', 1125, 320);
  check('living room daylight factor within 0.5–8 %', living >= 0.5 && living <= 8, `${living.toFixed(2)} %`);
}

// ───────────────────────── energy bookkeeping ─────────────────────────
group('Energy');
{
  const rho = D.albedoArrays(S, V).patch;
  let inFlux = 0, absorbed = 0, maxRad = 0, maxInd = 0;
  for (let p = 0; p < S.patch.count; p++) {
    const A = S.patch.area[p], p3 = p * 3;
    const e0 = lum(L8.direct, p3) + lum(L8.outside, p3), et = e0 + lum(L8.indirect, p3);
    inFlux += A * e0;
    absorbed += A * (1 - lum(rho, p3)) * et;
    maxRad = Math.max(maxRad, lum(rho, p3) * et);
    maxInd = Math.max(maxInd, lum(L8.indirect, p3));
  }
  check('absorbed flux ≤ flux entering through the openings (+5 % Monte-Carlo tolerance)', absorbed <= inFlux * 1.05, `entering ${inFlux.toFixed(3)}, absorbed ${absorbed.toFixed(3)} (${(100 * absorbed / inFlux).toFixed(1)} %; the rest leaves through the openings)`);
  check('no patch receives more bounced light than the brightest surface it could see emits', maxInd <= maxRad * 1.0001, `max bounce ${lux(maxInd)} ≤ max radiosity ${lux(maxRad)}`);
  const it = L8.iterations;
  let conv = true; for (let i = 2; i < it.length; i++) if (!(it[i] < it[i - 1])) conv = false;
  check('bounces converge geometrically', conv && it[it.length - 1] < 0.15, it.map((v) => v.toFixed(3)).join(', '));
  const Lc = D.relight(S, Vc, { sunDir: sunDir('2026-06-21', 8) });
  const fine = mean(S, L8, roomFloor(S, 'main')), coarse = mean(S, Lc, roomFloor(S, 'main'));
  check('coarse preview agrees with the full solution (main room mean, ±25 %)', Math.abs(coarse / fine - 1) < 0.25, `${lux(coarse)} vs ${lux(fine)}`);
  let finite = true; for (const v of L8.lightmap) if (!Number.isFinite(v)) { finite = false; break; }
  check('lightmap is finite everywhere', finite);
}

// ───────────────────────── symmetry ─────────────────────────
group('Symmetry: the mirrored children\'s bedrooms under a symmetric (overcast) sky');
{
  const f1 = mean(S, Lo, roomFloor(S, 'bedroom-1')), f2 = mean(S, Lo, roomFloor(S, 'bedroom-2'));
  const w1 = mean(S, Lo, roomWalls(S, 'bedroom-1')), w2 = mean(S, Lo, roomWalls(S, 'bedroom-2'));
  check('floors within 10 %', Math.abs(f1 / f2 - 1) < 0.1, `${lux(f1)} vs ${lux(f2)}`);
  check('walls within 10 %', Math.abs(w1 / w2 - 1) < 0.1, `${lux(w1)} vs ${lux(w2)}`);
}

// ───────────────────────── no leaks: blocked window ─────────────────────────
group('A room whose window is blocked');
{
  const win = input.openings.find((o) => o.id === 'win-bedroom-1');
  const blocked = (doorsOpen) => ({ ...input, doorsOpen, openings: input.openings.filter((o) => o !== win), walls: [...input.walls, { x: win.x, y: win.y, w: win.w, h: win.h }] });
  const open = solve(blocked(true)), shut = solve(blocked(false));
  const Lb = D.relight(open.S, open.V, OVERCAST), Ls = D.relight(shut.S, shut.V, OVERCAST);
  const ref = mean(S, Lo, roomFloor(S, 'bedroom-1')), viaDoor = mean(open.S, Lb, roomFloor(open.S, 'bedroom-1')), dark = mean(shut.S, Ls, roomFloor(shut.S, 'bedroom-1'));
  check('door open: lit only through the doorway — dim but not black', viaDoor > 0 && viaDoor < ref * 0.25, `${lux(viaDoor)} vs ${lux(ref)} with the window (${(100 * viaDoor / ref).toFixed(1)} %)`);
  const doorSide = mean(open.S, Lb, (p) => roomFloor(open.S, 'bedroom-1')(p) && pos(open.S, p)[0] < 1300), farSide = mean(open.S, Lb, (p) => roomFloor(open.S, 'bedroom-1')(p) && pos(open.S, p)[0] > 1400);
  check('…brighter on the doorway side', doorSide > farSide, `${lux(doorSide)} near the door, ${lux(farSide)} at the far wall`);
  check('door closed as well: black — no light leaks through the 10 cm partitions', dark <= 1e-9, `${dark.toExponential(1)}`);
  // the bedroom next door is unaffected by the blocked window (its light cannot leak through the partition)
  const b2 = mean(S, Lo, roomFloor(S, 'bedroom-2')), b2s = mean(shut.S, Ls, roomFloor(shut.S, 'bedroom-2'));
  check('the neighbouring bedroom (doors shut) keeps its own light', b2s > 0.5 * b2, `${lux(b2s)}`);
  // laundry: no window, exterior door closed → lit only through its interior door
  const laundry = mean(S, Lo, roomFloor(S, 'service')), laundryShut = mean(shut.S, Ls, roomFloor(shut.S, 'service'));
  check('windowless laundry: dim through its open door, black with it shut', laundry > 0 && laundryShut <= 1e-9, `${lux(laundry)} open, ${laundryShut.toExponential(1)} shut`);
}

// ───────────────────────── plan edit: remove the partition between the bedrooms ─────────────────────────
group('Plan edit: remove the partition between Bedroom 1 and Bedroom 2 (plan-edit.js)');
{
  const seg = E.wallSegments().find((s) => s.axis === 'h' && s.between.includes('bedroom-1') && s.between.includes('bedroom-2'));
  const res = seg ? E.removeWallSegment(seg.id) : { ok: false, reason: 'segment not found' };
  check('partition removed', res.ok, res.ok ? seg.id : res.reason);
  if (res.ok) {
    const after = solve(D.sceneInputFromPlan(PLAN, { doorsOpen: true }));
    const La = D.relight(after.S, after.V, OVERCAST);
    const partY = seg.core.y + seg.core.h / 2;
    const near = (SS) => (p) => { const [x, , y] = pos(SS, p); return SS.patch.surf[p] === D.SURF.FLOOR && x > 1160 && Math.abs(y - partY) < 60; };
    const before = mean(S, Lo, near(S)), now2 = mean(after.S, La, near(after.S));
    check('floor along the old partition line gets brighter (it now sees both windows)', now2 > before * 1.05, `${lux(before)} → ${lux(now2)}`);
    const merged = after.S.roomIds.find((id) => id === 'bedroom-1' || id === 'bedroom-2');
    const m = mean(after.S, La, roomFloor(after.S, merged)), avgBefore = (mean(S, Lo, roomFloor(S, 'bedroom-1')) + mean(S, Lo, roomFloor(S, 'bedroom-2'))) / 2;
    check('merged room mean stays close to the two rooms\' mean (same window-to-floor ratio, ±30 %)', Math.abs(m / avgBefore - 1) < 0.3, `${lux(avgBefore)} → ${lux(m)}`);
    // lightmap carried over to the new layout (what the 3D view shows while the new solution is computed)
    const carried = D.transferLightmap(S, Lo.lightmap, after.S);
    let filled = 0; for (let p = 0; p < after.S.patch.count; p++) if (carried[after.S.texelOf[p] * 4 + 3] > 0 || carried[after.S.texelOf[p] * 4] > 0) filled++;
    check('old solution carried over to the new layout', filled > after.S.patch.count * 0.9, `${filled} / ${after.S.patch.count} texels`);
  }
  E.resetPlan();
}

// ───────────────────────── lamps (point emitters in the same solve) ─────────────────────────
group('Lamps at night: emitters with cached visibility, bounced like the sun');
const NIGHT = { sunDir: sunDir('2026-06-21', 23.5) };
const roomCentre = (id) => { const r = PLAN.rooms.find((q) => q.id === id), xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 200, (Math.min(...ys) + Math.max(...ys)) / 200]; };
const pendant = (id, lm = 1100) => { const [x, z] = roomCentre(id); return { x, y: 2.3, z, lm, lobe: -0.8, color: [1, 1, 1] }; };
{
  const shut = solve({ ...input, doorsOpen: false });
  const dark = D.relight(shut.S, shut.V, NIGHT);
  const lit = D.relight(shut.S, shut.V, { ...NIGHT, lamps: [pendant('bedroom-1')] });
  const f1 = mean(shut.S, lit, roomFloor(shut.S, 'bedroom-1'), (p) => lum(lit.lightmap, shut.S.texelOf[p] * 4));
  const f1dark = mean(shut.S, dark, roomFloor(shut.S, 'bedroom-1'), (p) => lum(dark.lightmap, shut.S.texelOf[p] * 4));
  const f2 = mean(shut.S, lit, roomFloor(shut.S, 'bedroom-2'), (p) => lum(lit.lightmap, shut.S.texelOf[p] * 4));
  const hall = mean(shut.S, lit, roomFloor(shut.S, 'main'), (p) => lum(lit.lightmap, shut.S.texelOf[p] * 4));
  check('a 1100 lm pendant lights its bedroom to a plausible 20–300 lx (floor mean, direct + bounced)', f1 * LUX_PER_UNIT >= 20 && f1 * LUX_PER_UNIT <= 300, `${lux(f1)} (unlit: ${lux(f1dark)})`);
  check('…and nothing behind the closed doors (bedroom 2, living room stay black)', f2 <= 1e-9 && hall <= 1e-9, `${f2.toExponential(1)}, ${hall.toExponential(1)}`);
  // energy: the flux the room's surfaces receive directly ≈ the lamp's flux (minus what leaves through the window)
  let flux = 0, out = 0;
  for (let p = 0; p < shut.S.patch.count; p++) flux += shut.S.patch.area[p] * lum(lit.lamp, p * 3);
  flux *= LUX_PER_UNIT;
  for (let p = 0; p < shut.S.patch.count; p++) out += shut.S.patch.area[p] * lum(lit.indirect, p * 3);
  check('direct flux on the surfaces = 80–102 % of the lamp\'s 1100 lm (the rest leaves through the window)', flux >= 0.8 * 1100 && flux <= 1.02 * 1100, `${flux.toFixed(0)} lm`);
  // closed room: the inter-reflected flux of a diffuse enclosure ≈ direct × ρ̄ / (1 − ρ̄) (ρ̄ = area-weighted albedo)
  const rho = D.albedoArrays(shut.S, shut.V).patch;
  let ra = 0, aa = 0; for (let p = 0; p < shut.S.patch.count; p++) if (shut.S.patch.region[p] === shut.S.roomIds.indexOf('bedroom-1')) { ra += lum(rho, p * 3) * shut.S.patch.area[p]; aa += shut.S.patch.area[p]; }
  const rb = ra / aa, expect = flux * rb / (1 - rb), inter = out * LUX_PER_UNIT;
  check('inter-reflected flux matches the enclosure estimate ρ̄/(1−ρ̄) × direct (±35 %)', Math.abs(inter / expect - 1) < 0.35, `${inter.toFixed(0)} lm vs ${expect.toFixed(0)} lm (ρ̄ = ${rb.toFixed(2)})`);
  let wallUp = 0; for (let p = 0; p < shut.S.patch.count; p++) if (roomWalls(shut.S, 'bedroom-1')(p) && shut.S.patch.pos[p * 3 + 1] > 2.5) wallUp = Math.max(wallUp, lum(lit.lightmap, shut.S.texelOf[p] * 4));
  check('lamp light is in the lightmap (no real-time lamp light indoors), probes see it too', lit.lampStats.lamps === 1 && lum(lit.probes, nearestProbe(shut.S, 'bedroom-1', ...roomCentre('bedroom-1').map((v) => v * 100)) * 18 + 6) > 0, `${lit.lampStats.rays} rays, ${lit.lampStats.ms} ms; top-of-wall max ${lux(wallUp)}`);
  const t1 = now(); const again = D.relight(shut.S, shut.V, { ...NIGHT, lamps: [pendant('bedroom-1')] }); const relMs = now() - t1;
  check('second relight with the same lamp reuses its cached visibility', again.lampStats.cached === 1, `${relMs.toFixed(0)} ms relight (first: ${lit.ms} ms incl. ${lit.lampStats.ms} ms of lamp rays)`);
  // doors open: the living-room lamp spills into the bedroom through its door
  const Lopen = D.relight(S, V, { ...NIGHT, lamps: [{ x: 11.0, y: 2.3, z: 10.0, lm: 1500, lobe: -0.5, color: [1, 1, 1] }] });
  const spill = mean(S, Lopen, roomFloor(S, 'bedroom-1'), (p) => lum(Lopen.lightmap, S.texelOf[p] * 4));
  const nearLamp = mean(S, Lopen, (p) => roomFloor(S, 'main')(p) && Math.hypot(pos(S, p)[0] - 1100, pos(S, p)[2] - 1000) < 150, (p) => lum(Lopen.lightmap, S.texelOf[p] * 4));
  check('doors open: a hall lamp spills into the bedroom through the doorway, dimmer than under the lamp', spill > 0 && spill < nearLamp * 0.3, `${lux(spill)} in bedroom 1, ${lux(nearLamp)} under the lamp`);
}

// ───────────────────────── sky switch ─────────────────────────
group('Sky: clear vs overcast at noon');
{
  const noon = sunDir('2026-03-20', 12.5);
  const Lc = D.relight(S, V, { sunDir: noon, sky: 'clear' }), Lov = D.relight(S, V, { sunDir: noon, sky: 'overcast' });
  let sunC = 0, sunO = 0; for (let p = 0; p < S.patch.count; p++) { sunC += Lc.sunFraction[p] > 0; sunO += Lov.sunFraction[p] > 0 || lum(Lov.direct, p * 3) > 0; }
  check('overcast: no direct sun anywhere (no sun patches, lightmap alpha 0)', sunO === 0 && sunC > 20, `${sunC} sunlit patches when clear`);
  const mc = mean(S, Lc, roomFloor(S, 'main')), mo = mean(S, Lov, roomFloor(S, 'main'));
  check('overcast living room is darker than under the clear sky + sun', mo < mc, `${lux(mo)} vs ${lux(mc)}`);
  const hz = skyRadiance({ sunDir: noon, type: 'overcast' }).horizontal * LUX_PER_UNIT;
  check('overcast sky follows the Krochmann level (≈ 0.3 + 21·sin h klux)', hz > 10000 && hz < 22000, `${Math.round(hz)} lx diffuse horizontal`);
}

// ───────────────────────── furniture occluders ─────────────────────────
group('Furniture blocks bounced light and sun (item boxes as occluders, incremental visibility)');
{
  const box = (id, x0, y0, x1, y1, h) => ({ id, corners: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], y0: 0, y1: h });
  const wardrobe = box('wardrobe', 1215, 1300, 1435, 1360, 2.2), bed = box('bed', 1330, 1130, 1500, 1290, 0.55);
  const L0 = D.relight(S, V, OVERCAST), Ls0 = D.relight(S, V, { sunDir: sunDir('2026-06-21', 8) });
  const occ = D.setOccluders(S, [wardrobe, bed]);
  const regions = new Set(); D.occluderRegions(S, wardrobe, regions); D.occluderRegions(S, bed, regions);
  const redo = D.receiversFor(S, regions);
  let t2 = now(); const job = D.createVisibilityJob(S, { base: V, redo }); job.step(1e12); const Vi = job.result(); const incMs = now() - t2;
  t2 = now(); const Vf = D.computeVisibility(S); const fullMs = now() - t2;
  check('incremental visibility (only the furnished room) is much cheaper than a full pass', incMs < fullMs * 0.5, `${incMs.toFixed(0)} ms for ${redo.count} of ${redo.length} receivers vs ${fullMs.toFixed(0)} ms full (${occ.cells} occluder cells, rasterised in ${occ.ms} ms)`);
  const L1 = D.relight(S, Vi, OVERCAST), Lf = D.relight(S, Vf, OVERCAST), Ls1 = D.relight(S, Vi, { sunDir: sunDir('2026-06-21', 8) });
  const under = (p) => roomFloor(S, 'bedroom-1')(p) && (() => { const [x, , y] = pos(S, p); return x > 1240 && x < 1410 && y > 1310; })();
  const front = (p) => roomFloor(S, 'bedroom-1')(p) && (() => { const [x, , y] = pos(S, p); return x > 1215 && x < 1330 && y > 1250 && y < 1300; })();
  const u0 = mean(S, L0, under), u1 = mean(S, L1, under), f0 = mean(S, L0, front), f1 = mean(S, L1, front);
  check('floor under the wardrobe goes (nearly) dark', u1 < 0.15 * u0, `${lux(u0)} → ${lux(u1)}`);
  check('floor in front of the wardrobe gets darker (it sees less of the room and window)', f1 < f0 * 0.97, `${lux(f0)} → ${lux(f1)}`);
  const room0 = mean(S, L0, roomFloor(S, 'bedroom-1')), roomI = mean(S, L1, roomFloor(S, 'bedroom-1')), roomF = mean(S, Lf, roomFloor(S, 'bedroom-1'));
  check('incremental result agrees with a full pass (room mean ±5 %)', Math.abs(roomI / roomF - 1) < 0.05, `${lux(roomI)} vs ${lux(roomF)} (empty room ${lux(room0)})`);
  const lit = (L) => { let n = 0; for (let p = 0; p < S.patch.count; p++) if (roomFloor(S, 'bedroom-1')(p) && L.sunFraction[p] > 0) n++; return n; };
  check('08:00 sun patch: the bed blocks part of it (sunlit floor texels drop)', lit(Ls1) < lit(Ls0) * 0.8, `${lit(Ls0)} → ${lit(Ls1)} texels`);
  const other = mean(S, L1, roomFloor(S, 'bedroom-2')), other0 = mean(S, L0, roomFloor(S, 'bedroom-2'));
  check('the neighbouring bedroom is (all but) unchanged', Math.abs(other / other0 - 1) < 0.01, `${lux(other0)} → ${lux(other)}`);
  D.setOccluders(S, []);
}

group('Lamp photometry and occluder boxes (lamps.js)');
{
  const spots = lampSpec({ type: 'ceiling-light', params: { variant: 'spot', count: 4 } }), pend = lampSpec({ type: 'pendant', params: { lumens: 800 } });
  check('lumen class per type / variant, product params override', spots.lm === 1800 && spots.down && pend.lm === 800 && lampSpec({ type: 'table-lamp', params: {} }).lm === 450, `spots ${spots.lm} lm, pendant ${pend.lm} lm`);
  check('switched-off lamps and non-lamps emit nothing', lampSpec({ type: 'pendant', params: { on: false } }) === null && lampSpec({ type: 'sofa', params: {} }) === null);
  const c = kelvinColor(2700), c6 = kelvinColor(6500), L = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  check('2700 K is warm (r > g > b), 6500 K near neutral, both unit luminance', c[0] > c[1] && c[1] > c[2] && Math.abs(L(c) - 1) < 1e-6 && Math.abs(c6[0] / c6[2] - 1) < 0.15, c.map((v) => v.toFixed(2)).join(' '));
  const em = lampEmitters({ id: 'x', type: 'pendant', params: { variant: 'cluster', count: 4 } }, [[1, 2, 3], [1.2, 2, 3]]);
  check('flux is split between bulb positions', em.length === 2 && em[0].lm + em[1].lm === 1600);
  const wd = occluderBox({ id: 'w', type: 'wardrobe', x: 100, y: 100, w: 160, d: 60, h: 240, rot: 90 }), bedB = occluderBox({ id: 'b', type: 'bed', x: 0, y: 0, w: 160, d: 200, h: 105 });
  check('wardrobe → rotated full-height box; bed → body only; chairs / outdoor items → none',
    wd && Math.abs(wd.corners[0][0] - 130) < 0.01 && wd.y1 === 2.4 && bedB.y1 === 0.55 && occluderBox({ type: 'chair', x: 0, y: 0, w: 50, d: 50, h: 90 }) === null && occluderBox({ type: 'cabinet', x: 0, y: 0, w: 100, d: 50, h: 80 }, -0.15) === null,
    JSON.stringify(wd.corners));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
