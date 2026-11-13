// End-to-end smoke test: boots the real app in headless Chromium and exercises every view mode.
//   node tests/e2e.smoke.mjs [--shots]      (screenshots go to dev/screens/e2e-*.png)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5299;
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

  await page.goto(`http://localhost:${PORT}/index.html`);
  const ready = await page.waitForFunction(() => document.documentElement.classList.contains('app-ready'), null, { timeout: 30000 }).then(() => true, () => false);
  check('app boots (app-ready)', ready, ready ? '' : await page.evaluate(() => document.getElementById('boot-status')?.textContent || ''));
  if (!ready) { console.log(errors.join('\n')); await browser.close(); return; }
  await sleep(1200);
  // Dismiss the first-run welcome so screenshots show the views.
  await page.getByRole('button', { name: 'Start designing' }).click({ timeout: 3000 }).catch(() => {});
  await sleep(400);

  const info = await page.evaluate(() => {
    const a = window.app;
    return {
      items: a.store.items.length,
      products: a.catalog.allProducts().length,
      models: a.models.registeredTypes().length,
      types: Object.keys(a.models.MODEL_TYPES).length,
      missingModels: [...new Set(a.catalog.allProducts().map((p) => p.type))].filter((t) => !a.models.hasModel(t) && t !== 'floor-finish' && t !== 'wall-finish'),
      retailers: a.catalog.retailers().length,
    };
  });
  console.log('     ', JSON.stringify(info));
  check('architect layout loaded', info.items >= 50);
  check('catalogue has products', info.products > 0, `${info.products} products from ${info.retailers} retailers`);
  check('every catalogue type has a 3D model', info.missingModels.length === 0, info.missingModels.join(', '));
  if (shots) await page.screenshot({ path: path.join(shotDir, 'e2e-2d.png') });

  for (const mode of ['3d', 'split', 'walk', '2d']) {
    await page.evaluate((m) => window.app.store.setUI({ mode: m }), mode);
    await sleep(mode === '2d' ? 400 : 2500);
    if (shots) await page.screenshot({ path: path.join(shotDir, `e2e-${mode}.png`) });
    check(`mode ${mode} renders without errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  }

  // Add, move, undo an item through the store and make sure nothing throws.
  const roundTrip = await page.evaluate(() => {
    const { store, catalog } = window.app;
    const p = catalog.allProducts().find((x) => x.type === 'sofa') || catalog.allProducts()[0];
    if (!p) return 'no product';
    const n = store.items.length;
    const it = store.addItem(catalog.itemFromProduct(p, { x: 700, y: 950 }));
    store.updateItem(it.id, { rot: 90 });
    store.undo(); store.undo();
    return store.items.length === n ? 'ok' : 'undo mismatch';
  });
  check('add / rotate / undo round-trip', roundTrip === 'ok', roundTrip);
  check('no console errors overall', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
}

main().catch((e) => { console.error(e); failed++; }).finally(() => { server.kill(); console.log(failed ? `\n${failed} check(s) failed` : '\nALL OK'); process.exit(failed ? 1 : 0); });
