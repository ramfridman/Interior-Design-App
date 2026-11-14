// Several floors in the 3D view (stage F3) in the real app, headless Chromium: a two-level project (the Duplex of
// tests/fixtures/houses.mjs with its void, without its stair) built with buildPlan(…, { levels: true }) and opened with
// projects.create({ fromPlan }), then 3D: ui.level 0 → 1 → 0, "Show whole house", walk on the upper floor, no console errors.
//   node tests/levels-3d.e2e.mjs [--shots]     (screenshots: dev/screens/levels-*.png)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5317;
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
    const res = await projects.create({ name: 'E2E duplex', fromPlan: built.plan });
    const sofa = catalog.allProducts().find((p) => p.type === 'sofa');
    const lamp = catalog.allProducts().find((p) => p.type === 'floor-lamp');
    const a = store.addItem({ ...catalog.itemFromProduct(sofa, { x: 760, y: 560 }), level: 'L1' });
    const b = store.addItem(catalog.itemFromProduct(sofa, { x: 760, y: 560 }));
    const c = store.addItem({ ...catalog.itemFromProduct(lamp, { x: 900, y: 700 }), level: 'L1' });
    return { ok: res.ok && built.ok, levels: (window.app.plan.levels || []).length, flag: F.FEATURES.levels, items: [a, b, c].map((i) => i && i.level) };
  });
  check('two-level project opens (flag on, one upper level, items on both)', made.ok && made.levels === 1 && made.flag, JSON.stringify(made));

  const state = () => page.evaluate(() => {
    const v = window.app.view3d, d = v.debug, L = d.levels(), st = d.stats();
    const item = (lv) => window.app.store.items.find((i) => (i.level || 'L0') === lv && i.type === 'sofa');
    const root = (it) => d.items.get(it.id).root;
    return { ...L, calls: st.calls, triangles: st.triangles, mode: v.getMode(), camY: d.camera.position.y,
      sofaL1: { y: root(item('L1')).position.y, visible: root(item('L1')).visible }, sofaL0: { y: root(item('L0')).position.y, visible: root(item('L0')).visible },
      pill: (document.querySelector('.v3d-levels') || {}).style?.display, roof: window.app.store.ui.showRoof };
  });
  const shot = async (name) => { if (shots) await page.locator('#view3d').screenshot({ path: path.join(shotDir, `levels-${name}.png`) }); };
  const look = (target, theta, phi, radius) => page.evaluate(([t, th, ph, r]) => { const d = window.app.view3d.debug; d.rig.setPose({ target: new d.camera.position.constructor(...t), theta: th, phi: ph, radius: r, fov: 40 }, { animate: false }); d.renderNow(); }, [target, theta, phi, radius]);

  await page.evaluate(() => window.app.store.setUI({ mode: '3d', level: 'L0', showRoof: false, wallsCutaway: false }));
  await sleep(4000);
  let s = await state();
  check('3D on L0: L1 and its items hidden, the pill shows', s.list.length === 2 && s.list[0].visible && !s.list[1].visible && !s.sofaL1.visible && s.sofaL0.visible && s.pill === 'flex', JSON.stringify(s));
  const callsL0 = s.calls;

  await page.evaluate(() => window.app.store.setUI({ level: 'L1', wallsCutaway: true }));
  await sleep(2500);
  s = await state();
  check('ui.level → L1: both levels shown, the L1 sofa at 3.00 m', s.shown === 'L1' && s.list[1].visible && s.sofaL1.visible && Math.abs(s.sofaL1.y - 3) < 1e-6 && Math.abs(s.list[1].y - 3) < 1e-6, JSON.stringify(s));
  await look([5.7, 3.2, 4.4], 0.75, 0.85, 12);
  await sleep(2500);
  await shot('upper-cutaway');

  await page.evaluate(() => window.app.store.setUI({ level: 'L0' }));
  await sleep(2500);
  s = await state();
  check('ui.level → L0 again: L1 hidden', s.shown === 'L0' && !s.list[1].visible && !s.sofaL1.visible, JSON.stringify(s));
  await look([5, 0.8, 4], 0.75, 0.9, 15);
  await sleep(2500);
  await shot('ground-upper-hidden');

  await page.evaluate(() => { window.app.store.setUI({ wallsCutaway: false }); window.app.view3d.setWholeHouse(true); window.app.view3d.setCameraPreset('aerial', { animate: false }); });
  await sleep(3000);
  s = await state();
  check('"Show whole house": every level, roof on', s.whole && s.list.every((l) => l.visible) && s.roof && s.view === 'L1', JSON.stringify(s));
  const callsWhole = s.calls;
  await shot('whole-house');
  console.log(`      draw calls: ground floor shown ${callsL0}, whole house ${callsWhole}`);
  await page.locator('.v3d-whole-house').click();
  await sleep(1200);
  s = await state();
  check('the pill button turns the whole house off again', !s.whole && !s.list[1].visible, JSON.stringify(s));

  await page.evaluate(() => window.app.store.setUI({ level: 'L1', mode: 'walk' }));
  await sleep(3500);
  s = await state();
  check('walk on L1: the walker stays on L1, eye at 4.65 m', s.mode === 'walk' && s.walk === 'L1' && Math.abs(s.camY - 4.65) < 0.08, JSON.stringify(s));
  await page.evaluate(() => window.app.store.setUI({ mode: '3d', level: 'L0' }));
  await sleep(2000);
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

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
