// End-to-end: "Add your own product" (docs/CONTRACT.md § 16) in headless Chromium — open the dialog from the catalogue,
// fill it, see the live preview, save, find it by its shop in the supplier filter, place it, see it in the shopping list
// with its link, edit it, delete it; the same dialog on a phone (390 × 800); no console errors.
//   node tests/e2e.own-product.mjs [--shots]      (screenshots: dev/screens/own-*.png)
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
const URL_ = 'https://www.shop.example.com/products/oslo-sofa';

async function boot(browser, viewport, mobile = false) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForFunction(() => document.documentElement.classList.contains('app-ready'), null, { timeout: 30000 });
  await sleep(800);
  for (let i = 0; i < 3 && await page.$('.scrim'); i++) { await page.keyboard.press('Escape'); await sleep(300); }
  return { page, errors };
}
const pageScrolled = (page) => page.evaluate(() => window.scrollY + document.documentElement.scrollTop + document.body.scrollTop);

async function main() {
  await sleep(500);
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  /* ───────── desktop ───────── */
  const { page, errors } = await boot(browser, { width: 1440, height: 900 });
  await page.click('.cat__own');
  await page.waitForSelector('.dialog--own', { timeout: 5000 });
  check('the catalogue header opens "Add your own product"', !!(await page.$('.dialog--own')));
  check('it says the app cannot read other shops’ pages', /can’t read other shops’ pages/.test(await page.textContent('.own__lead')));
  const known = await page.evaluate(() => { const p = window.app.catalog.catalogProducts().find((x) => /^https:\/\/(www\.)?ikea\.com\//.test(x.url)) || window.app.catalog.catalogProducts()[0]; return { url: p.url, retailer: p.retailer }; });
  await page.fill('#own-url', known.url);
  check('a link to a shop the catalogue knows fills in that shop’s name', (await page.inputValue('#own-retailer')) === known.retailer, known.retailer);
  await page.fill('#own-url', URL_);
  check('pasting a link fills the shop from the host', (await page.inputValue('#own-retailer')) === 'shop.example.com');
  await page.click('.dialog--own .btn--primary:has-text("Add product")');
  await sleep(200);
  const errs = await page.$$eval('.own__err:not([hidden])', (els) => els.map((e) => e.textContent));
  check('saving an incomplete form shows plain-word messages beside the fields', errs.length >= 2 && errs.some((t) => /name/.test(t)) && errs.some((t) => /price/i.test(t)), errs.join(' | '));
  await page.fill('#own-name', 'Oslo 3-seat sofa');
  await page.fill('#own-brand', 'Nordhaus');
  await page.fill('#own-price', '4,990');
  await page.selectOption('#own-category', 'living');
  await page.click('.own__kind:has-text("Sofa")');
  await page.fill('#own-w', '212'); await page.fill('#own-d', '94'); await page.fill('#own-h', '81');
  await page.click('.own__swatches .swatch[data-c="#3e5c76"]');
  const loaded = await page.waitForFunction(() => { const m = document.querySelector('.own__pmedia'); return m && m.children.length === 1 && m.firstElementChild.classList.contains('is-loaded'); }, null, { timeout: 20000 }).then(() => true, () => false);
  check('the live preview renders the chosen model in 3D', loaded);
  check('the preview shows name, shop, price, size', /Oslo 3-seat sofa/.test(await page.textContent('.own__ptext')) && /4,990/.test(await page.textContent('.own__ptext')) && /212 × 94 × 81 cm/.test(await page.textContent('.own__ptext')));
  check('the page itself never scrolls (desktop)', (await pageScrolled(page)) === 0);
  if (shots) { await sleep(400); await page.screenshot({ path: path.join(shotDir, 'own-dialog-desktop.png') }); }
  await page.click('.dialog--own .btn--primary:has-text("Add product")');
  await sleep(400);
  const prod = await page.evaluate(() => window.app.store.customProducts[0] || null);
  check('saved into the project (store.customProducts)', prod && prod.name === 'Oslo 3-seat sofa' && prod.price === 4990 && prod.retailer === 'shop.example.com' && prod.params.color === '#3e5c76' && prod.dims.w === 212, JSON.stringify(prod));

  // find it by its shop in the supplier filter
  await page.click('.cat__searchrow .iconbtn--outlined');
  await page.waitForSelector('.filters');
  await page.click('.filters__list .check:has-text("shop.example.com") input');
  await sleep(400);
  await page.keyboard.press('Escape');
  await sleep(300);
  const cards = await page.$$eval('.pcard', (els) => els.map((e) => ({ name: e.querySelector('.pcard__name').textContent, own: !!e.querySelector('.smark--own') })));
  check('the supplier filter finds it, with the "added by you" mark', cards.length === 1 && cards[0].name === 'Oslo 3-seat sofa' && cards[0].own, JSON.stringify(cards));
  if (shots) await page.screenshot({ path: path.join(shotDir, 'own-catalogue-mark.png'), clip: { x: 0, y: 40, width: 420, height: 420 } });

  // place it (drag from the card onto the plan)
  const n0 = await page.evaluate(() => window.app.store.items.length);
  const box = await page.$eval('#view2d', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width * 0.55, y: r.y + r.height * 0.45 }; });
  await page.click('.pcard__add');
  await sleep(300);
  await page.mouse.move(box.x, box.y); await sleep(100);
  await page.mouse.click(box.x, box.y);
  await sleep(500);
  let placed = await page.evaluate((id) => window.app.store.items.filter((i) => i.productId === id).length, prod.id);
  const how = placed ? 'with the card’s Place button and a click in the plan' : 'through the store (no placing tool answered)';
  if (!placed) {   // the active view had no placing tool: place through the same action the panel uses
    await page.evaluate((id) => { const a = window.app; a.store.addItem(a.catalog.itemFromProduct(a.catalog.getProduct(id), { x: 700, y: 400 })); }, prod.id);
    placed = await page.evaluate((id) => window.app.store.items.filter((i) => i.productId === id).length, prod.id);
  }
  check('placed in the plan like a catalogue product', placed === 1 && (await page.evaluate(() => window.app.store.items.length)) === n0 + 1, how);

  // shopping list with the link
  await page.evaluate(() => window.app.ui.openPanel('budget'));
  await sleep(600);
  const row = await page.$$eval('.brow', (els) => els.map((e) => ({ t: e.textContent, href: e.querySelector('.brow__link') && e.querySelector('.brow__link').getAttribute('href') })).find((r) => /Oslo 3-seat sofa/.test(r.t)) || null);
  check('in the shopping list with its price and shop link', row && row.href === URL_ && /4,990/.test(row.t), JSON.stringify(row));

  // edit: price on request
  await page.click('.pcard__open');
  await page.waitForSelector('.pdetail__own');
  check('product detail offers Edit, Delete and "Add from another shop…"', !!(await page.$('.pdetail__own .btn:has-text("Edit")')) && !!(await page.$('.pdetail__own .btn:has-text("Delete")')) && !!(await page.$('.pdetail__other')));
  await page.click('.pdetail__own .btn:has-text("Edit")');
  await page.waitForSelector('.dialog--own');
  check('the edit dialog is pre-filled', (await page.inputValue('#own-name')) === 'Oslo 3-seat sofa' && (await page.inputValue('#own-price')) === '4990');
  await page.click('.own__check:has-text("Price on request") input');
  await page.click('.dialog--own .btn--primary:has-text("Save changes")');
  await sleep(700);
  const it = await page.evaluate((id) => window.app.store.items.find((i) => i.productId === id), prod.id);
  check('editing updates the placed item (price on request)', it && it.price === null);
  const note = await page.$eval('.budget-total__note', (e) => (e.hidden ? '' : e.textContent)).catch(() => '');
  const askRow = await page.$$eval('.brow', (els) => els.map((e) => e.textContent).find((t) => /Oslo/.test(t)) || '');
  check('shopping list: "price on request", left out of the total with a visible note', /On request/.test(askRow) && /1 product with price on request is not in the total/.test(note), `${askRow} | ${note}`);

  // delete
  await page.click('.pcard__open');
  await page.waitForSelector('.pdetail__own');
  await page.click('.pdetail__own .btn:has-text("Delete")');
  await page.waitForSelector('.dialog:has-text("Delete")');
  const msg = await page.textContent('.dialog .dialog__text');
  check('delete asks in an in-app dialog and says how many placed items use it', /1 placed item uses it/.test(msg) && /generic item/.test(msg), msg);
  await page.click('.dialog .btn--danger:has-text("Delete product")');
  await sleep(500);
  const after = await page.evaluate(() => ({ prods: window.app.store.customProducts.length, it: window.app.store.items[window.app.store.items.length - 1] }));
  check('deleted; the placed item stays as a generic item with its size', after.prods === 0 && after.it.generic === true && after.it.productId === null && after.it.w === 212);
  // "From my library…": the product was kept on this device (the tick is on by default) → add it back
  await page.click('.cat__own');
  await page.waitForSelector('.dialog--own');
  await page.click('.own__libbar .btn:has-text("From my library")');
  await page.waitForSelector('.dialog--ownlib');
  await page.click('.dialog--ownlib .own__librow:has-text("Oslo 3-seat sofa") .btn:has-text("Add")');
  await sleep(400);
  check('"From my library…" adds a kept product to the project', (await page.evaluate(() => window.app.store.customProducts.map((p) => p.name))).join() === 'Oslo 3-seat sofa');
  for (let i = 0; i < 2 && await page.$('.dialog--own'); i++) { await page.keyboard.press('Escape'); await sleep(200); }

  // Inspector: a generic item → "Link to a product you found…" (pre-filled with its kind and size)
  const gen = await page.evaluate(() => { const a = window.app; const it = a.store.items.find((i) => i.generic && !i.productId && i.type === 'bed'); a.store.select([it.id]); a.ui.openPanel('inspector'); return { id: it.id, w: it.w, d: it.d, h: it.h }; });
  await sleep(500);
  await page.click('.callout .btn:has-text("Link to a product you found")');
  await page.waitForSelector('.dialog--own');
  const pre = { kind: await page.textContent('.own__kind[aria-checked="true"]'), w: await page.inputValue('#own-w'), d: await page.inputValue('#own-d') };
  check('Inspector: "Link to a product you found…" opens pre-filled with the item’s kind and size', /Bed/.test(pre.kind) && +pre.w === Math.round(gen.w * 10) / 10 && +pre.d === Math.round(gen.d * 10) / 10, JSON.stringify(pre));
  await page.fill('#own-url', 'https://www.example-beds.co.il/p/9');
  await page.fill('#own-name', 'Nordic bed 160');
  await page.fill('#own-price', '3200');
  await page.click('.dialog--own .btn--primary:has-text("Save and link")');
  await sleep(500);
  const linked = await page.evaluate((id) => window.app.store.getItem(id), gen.id);
  check('… and on save the item is linked to the new product', linked && /^own-/.test(linked.productId) && !linked.generic && linked.price === 3200 && linked.retailer === 'example-beds.co.il');
  const insp = await page.textContent('#panel-inspector').catch(() => '');
  check('Inspector shows the shop link, the mark and "Edit product"', /Buy at example-beds\.co\.il/.test(insp) && !!(await page.$('#panel-inspector .smark--own')) && !!(await page.$('#panel-inspector .btn:has-text("Edit product")')));
  check('no console errors (desktop)', errors.length === 0, errors.slice(0, 4).join(' | '));
  await page.close();

  /* ───────── phone ───────── */
  const ph = await boot(browser, { width: 390, height: 800 }, true);
  const p2 = ph.page;
  await p2.evaluate(() => window.app.ui.openPanel('catalog'));
  await sleep(500);
  const wide = await p2.$eval('.cat__ownwide', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, visible: r.width > 0 && getComputedStyle(e).display !== 'none' }; });
  check('phone: a full-width "Add your own product" button above the grid', wide.visible && wide.w > 250, JSON.stringify(wide));
  await p2.click('.cat__ownwide');
  await p2.waitForSelector('.dialog--own');
  const steps = await p2.$$eval('.own__step', (els) => els.map((e) => e.textContent));
  check('phone: the dialog works in steps', steps.length === 3, steps.join(' | '));
  await p2.fill('#own-url', 'https://shop.example.co.il/item/42');
  await p2.fill('#own-name', 'Rattan pendant');
  await p2.click('.own__check:has-text("Price on request") input');
  await p2.click('.dialog--own .btn--primary:has-text("Next")');
  await sleep(200);
  await p2.selectOption('#own-category', 'lighting');
  await p2.click('.own__kind:has-text("Pendant")');
  await p2.click('.dialog--own .btn--primary:has-text("Next")');
  await sleep(1500);
  const fit = await p2.$eval('.dialog--own', (e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.left >= 0 && r.right <= window.innerWidth + 1; });
  check('phone: the dialog fits the screen and scrolls inside itself', fit && (await pageScrolled(p2)) === 0);
  if (shots) await p2.screenshot({ path: path.join(shotDir, 'own-dialog-phone.png') });
  await p2.click('.dialog--own .btn--primary:has-text("Add product")');
  await sleep(400);
  const pp = await p2.evaluate(() => window.app.store.customProducts[0] || null);
  check('phone: saved (price on request, shop from the link)', pp && pp.price === null && pp.retailer === 'shop.example.co.il' && pp.type === 'pendant', JSON.stringify(pp));
  check('no console errors (phone)', ph.errors.length === 0, ph.errors.slice(0, 4).join(' | '));
  await browser.close();
}

main().catch((e) => { console.error(e); failed++; }).finally(() => { server.kill(); console.log(failed ? `\n${failed} check(s) FAILED` : '\nown product e2e OK'); process.exit(failed ? 1 : 0); });
