// Walking between floors (stage F5) in the real app, headless Chromium: the Duplex of tests/fixtures/houses.mjs WITH
// its stair, opened like tests/levels-3d.e2e.mjs (buildPlan(…, { levels: true }) + projects.create({ fromPlan })). Walk on
// L0 from the foot of the stair, hold W up to L1 (level + eye height from view3d.debug.walker()), the floor shown and the
// walk HUD follow, walk down again; no console errors.
//   node tests/walk-levels.e2e.mjs [--shots]     (screenshots: dev/screens/walk-levels-*.png)
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
    const built = buildPlan({ walls: DUPLEX.walls, openings: DUPLEX.openings, heights: DUPLEX.heights, meta: { name: 'Duplex', floors: 2 }, levels: [DUPLEX.levels[0]] }, { levels: true });
    built.plan.stairs = JSON.parse(JSON.stringify(DUPLEX.stairs));
    const { projects } = window.app;
    window.__home = projects.current().id;
    const res = await projects.create({ name: 'E2E duplex stair', fromPlan: built.plan });
    return { ok: res.ok && built.ok, levels: (window.app.plan.levels || []).length, stairs: (window.app.plan.stairs || []).length };
  });
  check('the Duplex with its stair opens (one upper level, one stair)', made.ok && made.levels === 1 && made.stairs === 1, JSON.stringify(made));

  const walker = () => page.evaluate(() => ({ ...window.app.view3d.debug.walker(), mode: window.app.view3d.getMode(), shown: window.app.store.ui.level || 'L0',
    where: (document.querySelector('.walk__where') || {}).textContent || '' }));
  const shot = async (name, sel = '#view3d') => { if (shots) await page.locator(sel).screenshot({ path: path.join(shotDir, `walk-levels-${name}.png`) }); };

  await page.evaluate(() => window.app.store.setUI({ level: 'L0', mode: 'walk' }));
  await sleep(3000);
  await page.evaluate(() => window.app.view3d.enterWalk({ x: 570, y: 740, heading: 0 }));
  await sleep(800);
  let w = await walker();
  check('walk on L0 at the foot of the stair, on it', w.mode === 'walk' && w.level === 'L0' && w.stair && w.stair.id === 'st1' && Math.abs(w.eye - 1.77) < 0.03, JSON.stringify(w));

  // hold W: up the stair (exposure sampled on the way: the eye adaptation must not jump)
  await page.locator('#view3d canvas').first().focus().catch(() => {});
  await page.keyboard.down('w');
  const samples = [];
  let t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    w = await walker();
    samples.push(w);
    if (w.level === 'L1' && w.y < 255) break;
    await sleep(80);
  }
  await page.keyboard.up('w');
  await sleep(1500);
  w = await walker();
  const ups = samples.filter((s) => s.stair);
  let mono = true; for (let i = 1; i < ups.length; i++) if (ups[i].eye < ups[i - 1].eye - 1e-6) mono = false;
  check('arrived on L1 north of the stair: eye 3.00 + 1.65 m (debug.walker)', w.level === 'L1' && !w.stair && Math.abs(w.eye - 4.65) < 1e-3 && w.y < 266, JSON.stringify(w));
  check('the eye rose monotonically on the stair', mono && ups.length > 5, `${ups.length} samples`);
  check('the floor shown follows the walker (ui.level L1) and the HUD says "First floor"', w.shown === 'L1' && /First floor/.test(w.where), `${w.shown} "${w.where}"`);
  let jump = 1;
  for (let i = 1; i < samples.length; i++) { const a = samples[i - 1].exposure, b = samples[i].exposure; if (a > 0 && b > 0) jump = Math.max(jump, b / a, a / b); }
  check('exposure stable on the way up (no step > ×1.35 between samples ~0.1 s apart)', jump < 1.35, `max ratio ${jump.toFixed(3)}, ${samples[0].exposure.toFixed(3)} → ${samples.at(-1).exposure.toFixed(3)}`);

  // walk down again
  await page.evaluate(() => window.app.view3d.enterWalk({ x: 570, y: 200, heading: 180 }));
  await sleep(600);
  await page.keyboard.down('w');
  t0 = Date.now();
  while (Date.now() - t0 < 40000) { w = await walker(); if (w.level === 'L0' && w.y > 740) break; await sleep(100); }
  await sleep(1200);
  await page.keyboard.up('w');
  await sleep(1200);
  w = await walker();
  check('walked down: back on L0 at the foot of the stair, eye ≈ 1.65 m, ui.level L0', w.level === 'L0' && Math.abs(w.eye - 1.65) < 0.012 && w.shown === 'L0' && /Ground floor/.test(w.where), JSON.stringify(w));
  // PageUp / PageDown
  await page.keyboard.press('PageUp');
  await sleep(500);
  const pu = await walker();
  await page.keyboard.press('PageDown');
  await sleep(500);
  const pd = await walker();
  check('PageUp: top of the stair (L1); PageDown: its foot (L0)', pu.level === 'L1' && Math.abs(pu.eye - 4.65) < 1e-3 && pd.level === 'L0' && Math.abs(pd.eye - 1.65) < 1e-3, `${pu.level} ${pu.eye} / ${pd.level} ${pd.eye}`);

  if (shots) {
    // screenshots with the realistic daylight off (the geometry reads better in the headless renderer): halfway up,
    // looking back from the L1 floor at the opening, its railing and the stair, and the mini-map on L1
    await page.evaluate(() => { window.app.store.setUI({ daylight: false }); window.app.view3d.enterWalk({ x: 570, y: 740, heading: 0 }); });
    await sleep(1500);
    await page.keyboard.down('w');
    t0 = Date.now();
    while (Date.now() - t0 < 30000) { w = await walker(); if (w.y < 530) break; await sleep(30); }
    await page.keyboard.up('w');
    await sleep(1500);
    await shot('halfway');
    await page.keyboard.down('w');
    t0 = Date.now();
    while (Date.now() - t0 < 30000) { w = await walker(); if (w.level === 'L1' && w.y < 255) break; await sleep(50); }
    await page.keyboard.up('w');
    await page.evaluate(() => window.app.view3d.enterWalk({ x: 600, y: 110, heading: 195 }));
    await sleep(2000);
    await shot('arrived-upper');
    await shot('minimap-upper', '.minimap');
    await page.evaluate(() => window.app.store.setUI({ daylight: true }));
  }

  await page.evaluate(() => window.app.store.setUI({ mode: '3d', level: 'L0' }));
  await sleep(1500);
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
