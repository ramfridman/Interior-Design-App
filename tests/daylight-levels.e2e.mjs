// Realistic daylight on every floor (stage F6) in the real app, headless Chromium: the Duplex (tests/fixtures/houses.mjs,
// its void, no stair) with furniture and lamps on both floors, "Realistic daylight" on: switch floors, whole house,
// walk on L0 under the void and on L1, dusk with lamps; both levels solved, no console errors.
//   node tests/daylight-levels.e2e.mjs [--shots]     (screenshots: dev/screens/daylight-levels-*.png)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5319;
const shots = process.argv.includes('--shots');
const shotDir = path.join(root, 'dev', 'screens');
fs.mkdirSync(shotDir, { recursive: true });

const server = spawn(process.execPath, [path.join(root, 'dev', 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };

async function main() {
  await sleep(500);
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

  await page.goto(`http://localhost:${PORT}/index.html?levels=1`);
  const ready = await page.waitForFunction(() => document.documentElement.classList.contains('app-ready'), null, { timeout: 30000 }).then(() => true, () => false);
  check('app boots with ?levels=1', ready);
  if (!ready) { console.log(errors.join('\n')); await browser.close(); return; }
  await sleep(1000);
  await page.getByRole('button', { name: 'Start designing' }).click({ timeout: 3000 }).catch(() => {});
  await sleep(300);

  const made = await page.evaluate(async () => {
    const F = await import('/src/core/features.js');
    if (!F.FEATURES.levels) F.setFeatureForTests('levels', true);
    const { buildPlan } = await import('/src/core/plan-build.js');
    const { DUPLEX } = await import('/tests/fixtures/houses.mjs');
    const { stairs, ...L1 } = DUPLEX.levels[0];
    const built = buildPlan({ walls: DUPLEX.walls, openings: DUPLEX.openings, heights: DUPLEX.heights, meta: { name: 'Duplex', floors: 2 }, levels: [L1] }, { levels: true });
    const { projects, store, catalog } = window.app;
    window.__home = projects.current().id;
    const res = await projects.create({ name: 'E2E daylight duplex', fromPlan: built.plan });
    const find = (type) => catalog.allProducts().find((p) => p.type === type);
    const add = (type, x, y, level) => { const p = find(type); return p ? store.addItem({ ...catalog.itemFromProduct(p, { x, y }), ...(level ? { level } : {}) }) : null; };
    const items = [add('sofa', 760, 600, 'L1'), add('wardrobe', 120, 700, 'L1'), add('floor-lamp', 900, 700, 'L1'), add('pendant', 820, 200, 'L1'),
      add('sofa', 760, 600), add('floor-lamp', 900, 680), add('pendant', 250, 400)];
    store.setUI({ daylight: true, daylightSky: 'clear', lights: 'auto', date: '2026-06-21', timeOfDay: 9 });
    return { ok: res.ok && built.ok, levels: (window.app.plan.levels || []).length, items: items.map((i) => i && (i.level || 'L0')) };
  });
  check('two-level project with furniture and lamps on both floors', made.ok && made.levels === 1 && made.items.filter(Boolean).length >= 5, JSON.stringify(made));

  const dl = () => page.evaluate(() => { const d = window.app.view3d.debug.daylight && window.app.view3d.debug.daylight(); if (!d) return { levels: [], on: 0, failed: false }; const s = d.state(); return { ready: s.ready, failed: s.failed, error: s.error, on: +s.on.toFixed(2), mode: s.mode, active: s.active, gain: +s.gain.toFixed(2), exposure: +s.exposure.toFixed(2), lamps: s.lamps, levels: s.levels.map((l) => ({ id: l.id, ready: l.ready, coarse: l.coarse, on: +l.on.toFixed(2), patches: l.patches, portals: l.portals, lux: l.meanUpLux, t: l.timings, kb: l.memoryKB })) }; });
  const waitSolved = async (ms = 60000) => { const t0 = Date.now(); let s; do { await sleep(500); s = await dl(); } while (Date.now() - t0 < ms && !(s.levels.every((l) => l.ready && !l.coarse) || s.failed)); return s; };
  const shot = async (name) => { if (shots) await page.locator('#view3d').screenshot({ path: path.join(shotDir, `daylight-levels-${name}.png`) }); };
  const look = (target, theta, phi, radius) => page.evaluate(([t, th, ph, r]) => { const d = window.app.view3d.debug; d.rig.setPose({ target: new d.camera.position.constructor(...t), theta: th, phi: ph, radius: r, fov: 40 }, { animate: false }); d.renderNow(); }, [target, theta, phi, radius]);

  // L1 shown first: it is the active level, solved first
  const t0 = Date.now();
  await page.evaluate(() => window.app.store.setUI({ mode: '3d', level: 'L1', showRoof: false, wallsCutaway: true }));
  let firstL1 = null, firstL0 = null;
  for (let i = 0; i < 120 && !(firstL1 && firstL0); i++) {
    await sleep(250);
    const s = await dl();
    const l0 = s.levels.find((l) => l.id === 'L0'), l1 = s.levels.find((l) => l.id === 'L1');
    if (l1 && l1.ready && !firstL1) firstL1 = Date.now() - t0;
    if (l0 && l0.ready && !firstL0) firstL0 = Date.now() - t0;
  }
  let s = await waitSolved();
  check('3D on L1: both levels solved in the worker, L1 (shown) first', s.mode === 'worker' && !s.failed && s.levels.length === 2 && s.levels.every((l) => l.ready) && firstL1 != null && firstL1 <= firstL0,
    `L1 first light after ≈ ${firstL1} ms, L0 ≈ ${firstL0} ms; ${JSON.stringify(s.levels)}`);
  check('the upper floor shows the solved light (not suppressed)', s.on > 0.9 && s.active === 'L1' && s.levels.every((l) => l.on > 0.9), JSON.stringify({ on: s.on, active: s.active, gain: s.gain }));
  await look([7.2, 3.3, 3.8], 0.95, 0.75, 10);
  await sleep(2500);
  await shot('upper-morning-sun');

  // time-of-day scrub on the shown level: relights keep coming while it moves
  const scrub = await page.evaluate(async () => {
    const { store } = window.app, d = window.app.view3d.debug.daylight();
    const n0 = d.state().timings.relights, t0 = performance.now();
    for (let h = 8; h <= 12; h += 0.25) { store.setUI({ timeOfDay: h }); await new Promise((r) => setTimeout(r, 60)); }
    await new Promise((r) => setTimeout(r, 1500));
    return { relights: d.state().timings.relights - n0, ms: Math.round(performance.now() - t0), relightMs: d.state().timings.relight };
  });
  check('time-of-day scrub: the solve follows (several relights, each fast)', scrub.relights >= 4 && scrub.relightMs < 400, JSON.stringify(scrub));

  await page.evaluate(() => window.app.store.setUI({ level: 'L0' }));
  await sleep(2500);
  s = await dl();
  check('ground floor shown: solved light, L0 active', s.on > 0.9 && s.active === 'L0', JSON.stringify({ on: s.on, active: s.active }));

  // walk on L0 under the void, looking up into the upper floor
  await page.evaluate(() => { window.app.store.setUI({ mode: 'walk', level: 'L0', timeOfDay: 12 }); });
  await sleep(1500);
  await page.evaluate(() => { const w = window.app.view3d.debug.walk; w.teleport(570, 520, 0); });
  const box = await page.locator('#view3d canvas').boundingBox();
  if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 160, { steps: 8 }); await page.mouse.up(); }
  await sleep(3500);
  s = await dl();
  const pose = await page.evaluate(() => window.app.view3d.debug.walk.getState ? window.app.view3d.debug.walk.getState() : null);
  check('walk on L0 under the void: solved light, sane exposure (not blown out)', s.on > 0.9 && s.exposure > 0.2 && s.exposure < 12, JSON.stringify({ on: s.on, exposure: s.exposure, gain: s.gain, pose }));
  await shot('ground-under-void');

  await page.evaluate(() => window.app.store.setUI({ mode: '3d', level: 'L1' }));
  await sleep(1500);
  await page.evaluate(() => window.app.store.setUI({ mode: 'walk', level: 'L1' }));
  await sleep(3500);
  s = await dl();
  const lv = await page.evaluate(() => window.app.view3d.debug.levels());
  check('walk on L1: the walker\'s level is the active one, solved light shown', lv.walk === 'L1' && s.active === 'L1' && s.on > 0.9, JSON.stringify({ walk: lv.walk, active: s.active, on: s.on, exposure: s.exposure }));

  // dusk, whole house, lamps on both floors
  await page.evaluate(() => { window.app.store.setUI({ mode: '3d', level: 'L1', timeOfDay: 20.6, lights: 'on', showRoof: false, wallsCutaway: true }); window.app.view3d.setWholeHouse(true); window.app.store.setUI({ showRoof: false }); });
  await sleep(1000);
  s = await waitSolved(30000);
  await look([5, 2.5, 4], 0.8, 0.8, 16);
  await sleep(3000);
  s = await dl();
  check('whole house at dusk, lamps on: lamps solved on both floors', s.lamps >= 3 && s.levels.every((l) => l.ready && l.lux > 0), JSON.stringify(s.levels.map((l) => ({ id: l.id, lux: l.lux }))));
  await shot('whole-dusk-lamps');

  // realistic daylight off: the fallback on every level
  await page.evaluate(() => window.app.store.setUI({ daylight: false }));
  await sleep(1500);
  s = await dl();
  check('"Realistic daylight" off: solved light off on every level', s.on < 0.01 && s.levels.every((l) => l.on < 0.01), JSON.stringify({ on: s.on }));
  await page.evaluate(() => { window.app.view3d.setWholeHouse(false); window.app.store.setUI({ daylight: true, mode: '3d', level: 'L0', lights: 'auto' }); });
  await sleep(1500);
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`      timings / memory per level: ${JSON.stringify((await dl()).levels.map((l) => ({ id: l.id, patches: l.patches, coarse: l.t.coarse, fine: l.t.fine, visWorker: l.t.visWorkerMs, relight: l.t.relight, kb: l.kb })))}`);

  const back = await page.evaluate(async () => {
    const { projects, store } = window.app;
    store.setUI({ mode: '2d' });
    const tmp = projects.current().id;
    const ok = await projects.open(window.__home);
    await projects.remove(tmp);
    return ok;
  });
  await sleep(1500);
  check('back to the first project, the duplex removed, no errors', back && errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

main().catch((e) => { console.error(e); failed++; }).finally(() => {
  server.kill();
  console.log(failed ? `\n${failed} FAILED` : '\nALL OK');
  process.exit(failed ? 1 : 0);
});
