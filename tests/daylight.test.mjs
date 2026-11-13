// Daylight solver (src/view3d/daylight/solver.js) on the real plan — plain node, no dependencies.
//   node tests/daylight.test.mjs
import { PLAN } from '../src/core/plan.js';
import { store } from '../src/core/store.js';
import * as E from '../src/core/plan-edit.js';
import { sunPosition, sunDirectionWorld } from '../src/view3d/sun.js';
import * as D from '../src/view3d/daylight/solver.js';
import { skyRadiance, LUX_PER_UNIT } from '../src/view3d/daylight/sky.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
