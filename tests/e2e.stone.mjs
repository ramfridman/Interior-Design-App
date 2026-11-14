// Worktop stone in the browser: Carpentry → kitchen run → Choose a stone → a veined slab → 3D tab → quotation (Hebrew) →
// stone supplier directory; then a phone viewport.   node tests/e2e.stone.mjs [--shots]   (screenshots → dev/screens/stone-*.png)
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

async function boot(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(`http://localhost:${PORT}/index.html`);
  const ready = await page.waitForFunction(() => document.documentElement.classList.contains('app-ready'), null, { timeout: 90000 }).then(() => true, () => false);
  check(`app boots ${viewport.width}×${viewport.height}`, ready);
  await sleep(800);
  await page.getByRole('button', { name: 'Start designing' }).click({ timeout: 15000 }).catch(() => {});
  await sleep(300);
  for (let i = 0; i < 3 && await page.locator('.scrim').count(); i++) { await page.keyboard.press('Escape'); await sleep(300); }
  return { page, errors };
}
/** Carpentry → adopt the architect's layout → the first kitchen run selected. */
async function toKitchen(page) {
  const seg = page.locator('.seg__btn[data-value="carpentry"]:visible');
  if (await seg.count()) await seg.first().click();
  else await page.evaluate(() => window.app.store.setUI({ tool: 'carpentry' }));          // phone: the mode lives in a menu
  await sleep(600);
  const adopt = page.locator('.cstart__opt--main');
  if (await adopt.count()) { await adopt.first().click(); await sleep(900); }
  if (!(await page.locator('.crun__main:visible').count())) { await page.locator('.mobnav__btn').filter({ hasText: 'Runs' }).first().click().catch(() => {}); await sleep(500); }
  const row = page.locator('.crun__main').filter({ hasText: /K1/ }).first();
  await (await row.count() ? row : page.locator('.crun__main').first()).click();
  await sleep(600);
  return page.evaluate(() => { const s = window.app.store.ui.carpentrySel || {}; const r = window.app.store.carpentry.runs[s.runId]; return r ? { id: r.id, code: r.code, kind: r.kind } : null; });
}

async function main() {
  await sleep(500);
  const browser = await chromium.launch();

  // ───────── desktop ─────────
  const { page, errors } = await boot(browser, { width: 1440, height: 900 });
  const run = await toKitchen(page);
  check('a kitchen run is selected in the studio', run && run.kind === 'kitchen', JSON.stringify(run));
  await page.locator('#ctab-run').click().catch(() => {});
  await sleep(300);
  const wt = page.locator('details.cgroup').filter({ hasText: 'Worktop' }).first();
  if (!(await wt.evaluate((d) => d.open))) await wt.locator('summary').click();
  await page.locator('[data-fk="w-stone"]').first().click();
  await page.waitForSelector('.dialog--cstone .cstone-card', { timeout: 15000 });
  const nCards = await page.locator('.dialog--cstone .cstone-card').count();
  check('picker lists the researched slabs as swatch cards', nCards === 140, String(nCards));
  // filters: material marble + colour veined, then search a code
  await page.locator('.dialog--cstone select[aria-label="Material"]').selectOption('marble');
  await sleep(150);
  const marble = await page.locator('.dialog--cstone .cstone-card:not([hidden])').count();
  check('material filter (marble)', marble === 5, String(marble));
  await page.locator('.dialog--cstone select[aria-label="Material"]').selectOption('all');
  await page.locator('.dialog--cstone [data-colour="veined"]').click();
  await sleep(150);
  const veinedAll = await page.locator('.dialog--cstone .cstone-card:not([hidden])').evaluateAll((els) => els.map((e) => e.dataset.pattern));
  check('colour filter "veined" shows only veined / marble-look slabs', veinedAll.length > 20 && veinedAll.every((p) => p === 'veined' || p === 'marble-look'), String(veinedAll.length));
  await page.locator('.dialog--cstone input[type="search"]').fill('5131');
  await sleep(300);
  const hit = await page.locator('.dialog--cstone .cstone-card:not([hidden])').evaluateAll((els) => els.map((e) => e.dataset.id));
  check('search by model code', hit.length === 1 && hit[0] === 'caesarstone-israel-5131', hit.join(', '));
  await page.locator('.dialog--cstone .cstone-card:not([hidden])').first().click();
  await sleep(200);
  const detail = await page.locator('.dialog--cstone .cstone__detail').textContent();
  check('detail pane: name, finish, price status, product page, who sells it', /Calacatta Nuvo/.test(detail) && /Finish/.test(detail) && /Price not published/.test(detail) && /Product page/.test(detail) && /Who sells or works it/.test(detail) && /colour approximate/i.test(detail), detail.slice(0, 200).replace(/\n/g, ' | '));
  // a natural veined marble with the suppliers' statements
  await page.locator('.dialog--cstone input[type="search"]').fill('Statuario');
  await sleep(300);
  await page.locator('.dialog--cstone .cstone-card:not([hidden])').first().click();
  await sleep(200);
  const nat = await page.locator('.dialog--cstone .cstone__nat').textContent().catch(() => '');
  check('natural stone: the suppliers\' own statements, quoted with their names', /What suppliers say/.test(nat) && /Daniel Marble/.test(nat) && /sealing/.test(nat), nat.slice(0, 120));
  if (shots) await page.screenshot({ path: path.join(shotDir, 'stone-picker.png') });
  await page.getByRole('button', { name: 'Use this stone' }).click();
  await sleep(900);
  const spec = await page.evaluate((id) => JSON.parse(JSON.stringify(window.app.store.carpentry.runs[id].spec.worktop)), run.id);
  check('choosing stores worktop.stone + material / colour from the slab', spec.stone && spec.stone.id === 'daniel-marble-hasson-statuario' && spec.material === 'marble' && spec.colorHex === '#cfcecc' && spec.stone.finish === 'polished', JSON.stringify(spec.stone));
  const card = await page.locator('[data-fk="stone-cur"]').first().innerText().catch(() => '');
  check('the run inspector shows the chosen stone', /Statuario/.test(card), card);
  const undone = await page.evaluate((id) => { const a = window.app; a.store.undo(); const s = !!a.store.carpentry.runs[id].spec.worktop.stone; a.store.redo(); return { afterUndo: s, afterRedo: !!a.store.carpentry.runs[id].spec.worktop.stone }; }, run.id);
  check('one undo step; redo restores it', !undone.afterUndo && undone.afterRedo, JSON.stringify(undone));

  // 3D tab: the worktop material is the stone texture
  await page.locator('.cwb__tab').filter({ hasText: '3D' }).first().click();
  await sleep(3500);
  const mat = await page.evaluate((id) => {
    const scene = window.app.view3d.debug && window.app.view3d.debug.scene; if (!scene) return null;
    const found = new Set();
    scene.traverse((o) => { const m = o.material; if (m && m.userData && m.userData.stone) found.add(m); });
    const list = [...found];
    return list.map((m) => ({ id: m.userData.stone.id, pattern: m.userData.stone.pattern, rough: m.roughness, map: !!m.map }));
  }, run.id);
  check('3D: the worktop uses one shared stone material with a texture (veined, polished)', mat && mat.length >= 1 && mat.some((m) => m.id === 'daniel-marble-hasson-statuario' && m.map && m.pattern === 'veined' && m.rough < 0.2), JSON.stringify(mat));
  if (shots) await page.screenshot({ path: path.join(shotDir, 'stone-3d.png') });

  // quotation dialog, Hebrew edition: the stone is named (Latin model name inside Hebrew text)
  await page.getByRole('button', { name: 'Quotation package…' }).click();
  await page.waitForSelector('.dialog--cquote', { timeout: 15000 });
  await sleep(1500);
  const he = await page.evaluate(async () => {
    const d = await import('/src/carpentry/doc/index.js');
    const doc = d.composeQuotation({ lang: 'he', src: { store: window.app.store, plan: window.app.plan } });
    return doc.pages.flatMap((p) => p.ops.filter((o) => o.t === 'text').map((o) => o.text)).filter((t) => /Statuario/.test(t)).slice(0, 4);
  });
  check('quotation (Hebrew) names the stone', he.length > 0 && he.some((t) => /[֐-׿]/.test(t)), he.join(' | ').slice(0, 200));
  const langBtn = page.locator('.dialog--cquote').getByRole('radio', { name: /עברית|Hebrew/ }).first();
  if (await langBtn.count()) { await langBtn.click(); await sleep(1500); }
  const previewHasStone = await page.locator('.dialog--cquote').evaluate((el) => /Statuario/.test(el.textContent || '')).catch(() => false);
  check('the quotation dialog preview shows the stone', previewHasStone);
  await page.keyboard.press('Escape');
  await sleep(400);

  // stone supplier directory
  await page.locator('[data-fk="find-stone"]').first().click();
  await page.waitForSelector('.dialog--cstonesup .cp-ss__card', { timeout: 15000 });
  await sleep(300);
  const dists = await page.locator('.dialog--cstonesup .cp-ss__card .cp-cc__dist').allInnerTexts();
  const nums = dists.map((t) => parseFloat(t)).filter(Number.isFinite);
  check('supplier directory: 31 cards, nearest first', dists.length === 31 && nums.every((v, i) => !i || v >= nums[i - 1]), dists.slice(0, 4).join(', '));
  const brandCheck = page.locator('.dialog--cstonesup .check').filter({ hasText: 'Works with' });
  check('"works with the chosen stone\'s brand" offered when a stone is chosen', await brandCheck.isVisible());
  await page.locator('.dialog--cstonesup select[aria-label="Kind"]').selectOption('fabricator');
  await sleep(150);
  const kinds = await page.locator('.dialog--cstonesup .cp-ss__card:not([hidden])').evaluateAll((els) => els.map((e) => e.dataset.kind));
  check('kind filter', kinds.length > 0 && kinds.every((k) => k === 'fabricator'), String(kinds.length));
  if (shots) await page.screenshot({ path: path.join(shotDir, 'stone-suppliers.png') });
  await page.keyboard.press('Escape');
  await sleep(300);
  const rootScroll = await page.evaluate(() => [document.documentElement.scrollTop, document.body.scrollTop]);
  check('the page root never scrolls', rootScroll.every((v) => v === 0), rootScroll.join(','));
  check('desktop: no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  await page.close();

  // ───────── phone ─────────
  const P = await boot(browser, { width: 390, height: 844 });
  const prun = await toKitchen(P.page);
  check('phone: a kitchen run is selected', prun && prun.kind === 'kitchen');
  const opened = await P.page.evaluate(async (id) => { const m = await import('/src/ui/carpentry/stone-picker.js'); const ui = await import('/src/ui/carpentry/index.js'); return !!m && !!id; }, prun && prun.id);
  // open the picker through the inspector when reachable, else straight from the module (the right panel is a sheet on phones)
  const btnP = P.page.locator('[data-fk="w-stone"]').first();
  if (await btnP.isVisible().catch(() => false)) await btnP.click();
  else await P.page.evaluate(async (id) => { const m = await import('/src/ui/carpentry/stone-picker.js'); m.openStonePicker({ C: { run: (fn) => ({ res: fn() }) }, runId: id }); }, prun.id);
  await P.page.waitForSelector('.dialog--cstone .cstone-card', { timeout: 15000 });
  const box = await P.page.locator('.dialog--cstone').boundingBox();
  check('phone: the picker is a sheet within the screen', opened && box && box.width <= 390 && box.x >= 0 && box.y + box.height <= 845, JSON.stringify(box));
  await P.page.locator('.dialog--cstone .cstone-card').nth(3).click();
  await sleep(200);
  const det = await P.page.locator('.dialog--cstone .cstone__detail').isVisible(), lst = await P.page.locator('.dialog--cstone .cstone__list').isVisible();
  check('phone: choosing a card shows its details in place of the list (with a way back)', det && !lst && await P.page.locator('.cstone__back').isVisible());
  const overflow = await P.page.evaluate(() => { const d = document.querySelector('.dialog--cstone'); return d.scrollWidth - d.clientWidth; });
  check('phone: no sideways overflow in the picker', overflow <= 1, String(overflow));
  await P.page.keyboard.press('Escape');
  await sleep(300);
  check('phone: no console errors', P.errors.length === 0, P.errors.slice(0, 4).join(' | '));
  await browser.close();
}

main().catch((e) => { console.error(e); failed++; }).finally(() => { server.kill(); console.log(failed ? `\n${failed} check(s) failed` : '\nALL OK'); process.exit(failed ? 1 : 0); });
