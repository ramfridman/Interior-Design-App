// End-to-end: several floors in the 2D plan (stage F2 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md), with `?levels=1`.
// An empty-lot project, a small house, a floor added above (outer walls copied), a partition, a door and a bed on it,
// switching floors (the bed and the ghost of the ground floor), undo across the floor change, and removing the floor
// with "move everything to the floor below". No console errors.
//   node tests/e2e.levels.mjs [--shots]      (screenshots go to dev/screens/e2e-levels-*.png)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5301;
const shots = process.argv.includes('--shots');
const shotDir = path.join(root, 'dev', 'screens');
fs.mkdirSync(shotDir, { recursive: true });

const server = spawn(process.execPath, [path.join(root, 'dev', 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };

async function main() {
  await sleep(500);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* none */ } });

  await page.goto(`http://localhost:${PORT}/index.html?levels=1`);
  const ready = await page.waitForFunction(() => document.documentElement.classList.contains('app-ready'), null, { timeout: 90000 }).then(() => true, () => false);
  check('app boots with ?levels=1', ready);
  if (!ready) { console.log(errors.join('\n')); await browser.close(); return; }
  await sleep(1000);
  await page.getByRole('button', { name: 'Start designing' }).click({ timeout: 10000 }).catch(() => {});
  await sleep(500);
  check('the floor switcher is in the top bar', await page.locator('.lvlswitch').isVisible());

  // ── an empty lot and a small house (draft): 8 × 6 m, 25 cm outer walls, one inner wall, a window ──
  const made = await page.evaluate(async () => {
    const { projects, store, plan } = window.app;
    const res = await projects.create({ name: 'E2E floors', from: 'blank', lot: { width: 2400, depth: 1800 } });
    const E = await import('/src/core/plan-edit.js');
    const X0 = 600, Y0 = 500, X1 = 1400, Y1 = 1100, t = 25;
    const r = [
      E.addWall({ x1: X0, y1: Y0, x2: X1, y2: Y0, thickness: t }), E.addWall({ x1: X1, y1: Y0, x2: X1, y2: Y1, thickness: t }),
      E.addWall({ x1: X1, y1: Y1, x2: X0, y2: Y1, thickness: t }), E.addWall({ x1: X0, y1: Y1, x2: X0, y2: Y0, thickness: t }),
      E.addWall({ x1: 1000, y1: Y0, x2: 1000, y2: Y1, thickness: 10 }),
    ];
    const win = E.addOpening({ kind: 'window', x: 800, y: Y1, width: 120 });
    store.setUI({ mode: '2d', tool: 'select' });
    window.app.view2d.fit('house', { animate: false });
    return { ok: res.ok, walls: r.map((x) => x.ok || x.reason), win: win.ok || win.reason, rooms: plan.rooms.length, level: store.ui.level };
  });
  check('empty-lot project with a small house (2 rooms, a window)', made.ok && made.walls.every((x) => x === true) && made.win === true && made.rooms === 2 && made.level === 'L0', JSON.stringify(made));

  // ── add a floor above through the switcher ──
  await page.locator('.lvlswitch').click();
  await sleep(250);
  await page.getByRole('menuitem', { name: 'Add floor above…' }).click();
  await sleep(250);
  const dlgCopy = await page.locator('.lvldlg input[type="checkbox"]').isChecked();
  check('"Add a floor above" dialog: copy the outer walls is ticked', dlgCopy);
  await page.getByRole('button', { name: 'Add floor' }).click();
  await sleep(400);
  const up = await page.evaluate(async () => {
    const { store, plan } = window.app;
    const E = await import('/src/core/plan-edit.js');
    const v = E.levelPlan(plan, 'L1');
    return { level: store.ui.level, levels: (plan.levels || []).length, walls: v ? v.walls.length : 0, windows: v ? v.openings.filter((o) => o.kind === 'window').length : 0, rooms: v ? v.rooms.length : 0,
      label: document.querySelector('.lvlswitch').textContent.trim(), status: document.querySelector('.sb__cell--level')?.textContent.trim() };
  });
  check('a floor above with the outer walls and the window copied, shown', up.level === 'L1' && up.levels === 1 && up.walls > 0 && up.windows === 1 && up.rooms === 1, JSON.stringify(up));
  if (shots) {
    await page.locator('.lvlswitch').click();
    await sleep(250);
    await page.screenshot({ path: path.join(shotDir, 'e2e-levels-switcher.png'), clip: { x: 640, y: 0, width: 560, height: 300 } });
    await page.keyboard.press('Escape');
    await sleep(150);
  }
  check('switcher and status bar name the floor shown', /First floor/.test(up.label) && /First floor/.test(up.status || ''), `${up.label} | ${up.status}`);

  // ── a partition with the wall tool (pointer drag), a door with the door tool (click) ──
  const scr = (x, y) => page.evaluate(({ x, y }) => window.app.view2d.planToScreen(x, y), { x, y });
  await page.evaluate(() => window.app.store.setUI({ tool: 'wall', wallThickness: 10 }));
  let a = await scr(1100, 500 + 13), b = await scr(1100, 1100 - 13);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x, (a.y + b.y) / 2, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  await sleep(300);
  await page.evaluate(() => window.app.store.setUI({ tool: 'door' }));
  a = await scr(1100, 800);
  await page.mouse.move(a.x - 3, a.y); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.up();
  await sleep(300);
  const drawn = await page.evaluate(async () => {
    const { plan } = window.app;
    const E = await import('/src/core/plan-edit.js');
    const v = E.levelPlan(plan, 'L1');
    return { rooms: v.rooms.length, doors: v.openings.filter((o) => o.kind === 'door').length, l0Rooms: plan.rooms.length, l0Doors: plan.openings.filter((o) => o.kind === 'door').length,
      partition: E.wallSegments(v).some((s) => s.cls === 'partition' && s.id.startsWith('L1|')) };
  });
  check('partition and door drawn on the first floor (2 rooms), ground floor untouched', drawn.rooms === 2 && drawn.doors === 1 && drawn.partition && drawn.l0Rooms === 2 && drawn.l0Doors === 0, JSON.stringify(drawn));

  // ── a bed on the first floor (catalogue drop) ──
  await page.evaluate(() => window.app.store.setUI({ tool: 'select' }));
  const bed = await page.evaluate(() => {
    const { catalog, view2d, store } = window.app;
    const p = catalog.allProducts().find((x) => x.type === 'bed') || catalog.allProducts()[0];
    const at = view2d.planToScreen(1250, 800);
    const it = view2d.dropAt(at.x, at.y, catalog.itemFromProduct(p, {}, store.project.ceilingHeight));
    store.clearSelection();
    return it ? { id: it.id, level: it.level, x: it.x, y: it.y, w: it.w, d: it.d } : null;
  });
  check('a bed placed on the first floor gets level L1', bed && bed.level === 'L1', JSON.stringify(bed));
  await sleep(300);

  /** Mean ink (0 = paper … 255) of a small square around a plan point, read from the plan canvas. */
  const inkAt = (x, y, r = 6) => page.evaluate(({ x, y, r }) => {
    const v = window.app.view2d; v._debug.renderNow();
    const c = document.querySelector('.view2d-canvas'), box = c.getBoundingClientRect(), dpr = c.width / box.width;
    const p = v.planToScreen(x, y), g = c.getContext('2d');
    const d = g.getImageData(Math.round((p.x - box.left - r) * dpr), Math.round((p.y - box.top - r) * dpr), Math.round(2 * r * dpr), Math.round(2 * r * dpr)).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += 255 - (d[i] + d[i + 1] + d[i + 2]) / 3;
    return s / (d.length / 4);
  }, { x, y, r });
  const bedInkUp = await inkAt(bed.x, bed.y, 10);
  const ghostUp = await inkAt(1000, 650, 3);           // the ground floor's inner wall, under the first floor
  if (shots) {
    const p0 = await scr(450, 380), p1 = await scr(1550, 1220);
    await page.screenshot({ path: path.join(shotDir, 'e2e-levels-ghost.png'), clip: { x: Math.max(0, p0.x), y: Math.max(50, p0.y), width: Math.min(1100, p1.x - p0.x), height: Math.min(800, p1.y - p0.y) } });
  }

  // ── PageDown: the ground floor; the bed is not drawn, no ghost ──
  await page.mouse.move(1200, 600);
  await page.keyboard.press('PageDown');
  await sleep(300);
  const down = await page.evaluate((id) => { const { store, view2d } = window.app; return { level: store.ui.level, shown: view2d._debug.env.shown(store.getItem(id)), status: document.querySelector('.sb__cell--level')?.textContent.trim() }; }, bed.id);
  const bedInkDown = await inkAt(bed.x, bed.y, 10);
  const wallInkDown = await inkAt(1000, 650, 3);
  check('PageDown shows the ground floor; the bed is not drawn there', down.level === 'L0' && down.shown === false && Math.abs(bedInkUp - bedInkDown) > 5, `${JSON.stringify(down)} ink up ${bedInkUp.toFixed(1)} / down ${bedInkDown.toFixed(1)}`);
  check('the ground floor has no ghost (its own inner wall is solid)', wallInkDown > ghostUp * 1.8, `wall ${wallInkDown.toFixed(1)} vs ghost ${ghostUp.toFixed(1)}`);

  // ── PageUp: the first floor; the bed is drawn, the ground floor's inner wall shows as a ghost ──
  await page.keyboard.press('PageUp');
  await sleep(300);
  const bedInkUp2 = await inkAt(bed.x, bed.y, 10), ghost2 = await inkAt(1000, 650, 3);
  await page.evaluate(() => window.app.store.setUI({ ghostBelow: false }));
  const noGhost = await inkAt(1000, 650, 3);
  await page.evaluate(() => window.app.store.setUI({ ghostBelow: true }));
  check('PageUp: the bed is drawn again', Math.abs(bedInkUp2 - bedInkUp) < 1 && Math.abs(bedInkUp2 - bedInkDown) > 5, `${bedInkUp2.toFixed(1)}`);
  check('the ghost of the ground floor is visible (faint) and goes with the toggle', ghost2 > noGhost + 3 && ghost2 < wallInkDown * 0.6, `ghost ${ghost2.toFixed(1)}, off ${noGhost.toFixed(1)}, real wall ${wallInkDown.toFixed(1)}`);

  // ── undo back across the floor change: on the ground floor, Ctrl+Z removes the bed and shows the first floor ──
  await page.keyboard.press('PageDown');
  await sleep(200);
  await page.keyboard.press('Control+z');
  await sleep(300);
  const undone = await page.evaluate((id) => ({ level: window.app.store.ui.level, bed: !!window.app.store.getItem(id) }), bed.id);
  check('undo of the bed from the ground floor switches to the first floor', undone.level === 'L1' && !undone.bed, JSON.stringify(undone));
  await page.keyboard.press('PageDown');
  await sleep(200);
  await page.keyboard.press('Control+Shift+z');
  await sleep(300);
  const redone = await page.evaluate((id) => ({ level: window.app.store.ui.level, bed: window.app.store.getItem(id) && window.app.store.getItem(id).level }), bed.id);
  check('redo brings the bed back on the first floor and shows it', redone.level === 'L1' && redone.bed === 'L1', JSON.stringify(redone));
  check('switching floors in 3D and split does not throw', await page.evaluate(async () => {
    const { store } = window.app;
    for (const mode of ['3d', 'split']) { store.setUI({ mode }); await new Promise((r) => setTimeout(r, 1500)); store.setUI({ level: 'L0' }); await new Promise((r) => setTimeout(r, 300)); store.setUI({ level: 'L1' }); await new Promise((r) => setTimeout(r, 300)); }
    store.setUI({ mode: '2d' });
    return true;
  }) && errors.length === 0, errors.slice(0, 2).join(' | '));
  await sleep(400);

  // ── remove the first floor: it holds the bed → move everything to the floor below ──
  await page.locator('.lvlswitch').click();
  await sleep(200);
  await page.getByRole('menuitem', { name: 'Remove floor…' }).click();
  await sleep(300);
  const dlgText = await page.locator('.lvldlg--remove').textContent().catch(() => '');
  check('remove dialog lists what is on the floor', /1 item/.test(dlgText) && /Move everything to Ground floor/.test(dlgText), dlgText.slice(0, 160));
  if (shots) await page.screenshot({ path: path.join(shotDir, 'e2e-levels-remove.png'), clip: { x: 380, y: 220, width: 680, height: 460 } });
  await page.getByRole('button', { name: 'Move everything to Ground floor' }).click();
  await sleep(400);
  const gone = await page.evaluate((id) => {
    const { store, plan } = window.app, it = store.getItem(id);
    return { levels: (plan.levels || []).length, schema: plan.schema, level: store.ui.level, bed: !!it, bedLevel: it ? it.level || 'L0' : null, label: document.querySelector('.lvlswitch').textContent.trim() };
  }, bed.id);
  check('floor removed, the bed moved to the ground floor, ground floor shown', gone.levels === 0 && gone.schema === undefined && gone.level === 'L0' && gone.bed && gone.bedLevel === 'L0' && /Ground floor/.test(gone.label), JSON.stringify(gone));
  await page.keyboard.press('Control+z');
  await sleep(300);
  const back = await page.evaluate((id) => ({ levels: (window.app.plan.levels || []).length, bed: (window.app.store.getItem(id) || {}).level }), bed.id);
  check('one undo brings the floor and the bed on it back', back.levels === 1 && back.bed === 'L1', JSON.stringify(back));

  // ── phone: the floors are in the mode menu ──
  await page.setViewportSize({ width: 390, height: 800 });
  await sleep(500);
  await page.locator('.modebtn--menu').click();
  await sleep(250);
  const phone = await page.evaluate(() => ({
    menu: [...document.querySelectorAll('.menu .menu__label')].map((e) => e.textContent),
    scroll: document.scrollingElement.scrollHeight <= window.innerHeight && document.scrollingElement.scrollWidth <= window.innerWidth,
    switcher: getComputedStyle(document.querySelector('.lvlswitch')).display,
  }));
  if (shots) await page.screenshot({ path: path.join(shotDir, 'e2e-levels-phone.png') });
  await page.keyboard.press('Escape');
  check('phone (390 × 800): floors in the mode menu, no page scroll', phone.menu.includes('First floor') && phone.menu.includes('Add floor above…') && phone.switcher === 'none' && phone.scroll, JSON.stringify(phone));

  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
}

main().catch((e) => { console.error(e); failed++; }).finally(() => { server.kill(); console.log(failed ? `\n${failed} check(s) failed` : '\nALL OK'); process.exit(failed ? 1 : 0); });
