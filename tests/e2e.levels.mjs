// End-to-end: several floors in the 2D plan (stage F2 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md), with `?levels=1`.
// An empty-lot project, a small house, a floor added above (outer walls copied), a partition, a door and a bed on it,
// switching floors (the bed and the ghost of the ground floor), undo across the floor change, and removing the floor
// with "move everything to the floor below". Stairs (stage F4b): a two-level house, the Stairs tool (one level: it offers
// to add a floor), a straight stair placed with the ghost, its symbol on both floors, the inspector's rule hints, Checks
// under the right floor, 3D, move by drag, undo, remove; the stair inspector on a phone. No console errors.
//   node tests/e2e.levels.mjs [--shots]      (screenshots go to dev/screens/e2e-levels-*.png, e2e-stairs-*.png)
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

  // ── stage F7: checks grouped by floor, click-through to the finding's floor ──
  await page.evaluate(() => { window.app.store.setUI({ level: 'L0', mode: '2d' }); window.app.ui.openPanel('checks'); });
  await page.waitForFunction(() => document.querySelectorAll('#panel-checks .floorgroup').length >= 2, null, { timeout: 20000 }).catch(() => {});
  const groups = await page.evaluate(() => [...document.querySelectorAll('#panel-checks .floorgroup')].map((g) => g.dataset.floor));
  check('Checks tab: findings grouped by floor (whole house / site, then each floor)', groups.includes('house') && groups.includes('L0') && groups.includes('L1') && groups[0] === 'house', JSON.stringify(groups));
  if (shots) {
    const box = await page.locator('#panel-checks').boundingBox();
    if (box) await page.screenshot({ path: path.join(shotDir, 'e2e-levels-checks.png'), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 620) } });
  }
  const upRow = page.locator('#panel-checks .floorgroup[data-floor="L1"] .checkrow.is-link').first();
  const hasUpRow = await upRow.count();
  if (hasUpRow) { await upRow.click(); await sleep(400); }
  const afterClick = await page.evaluate(() => window.app.store.ui.level);
  check('clicking a first-floor finding shows the first floor', hasUpRow > 0 && afterClick === 'L1', `${hasUpRow} rows, level ${afterClick}`);

  // ── a carpentry run created on the first floor stands at that floor's height in 3D ──
  const runUp = await page.evaluate(async () => {
    const { store } = window.app;
    const C = await import('/src/carpentry/index.js');
    store.setUI({ level: 'L1' });
    const res = C.createRun({ kind: 'wardrobe', x: 1200, y: 530, units: [{ module: 'wardrobe-hinged', width: 100 }] });
    if (!res.ok) return { ok: false, reason: res.reason && res.reason.en };
    const got = C.getRun(res.runId);
    return { ok: true, runId: res.runId, level: got.run.level, unitLevels: got.units.map((u) => u.level), unit: got.units[0].id };
  });
  check('createRun on the first floor (active floor): run and units carry L1', runUp.ok && runUp.level === 'L1' && runUp.unitLevels.every((l) => l === 'L1'), JSON.stringify(runUp));
  const in3d = await page.evaluate(async (unitId) => {
    const { store, view3d } = window.app;
    store.setUI({ mode: '3d' });
    await new Promise((r) => setTimeout(r, 2500));
    const d = view3d.debug, THREE = d.scene.constructor;
    let obj = null; d.scene.traverse((o) => { if (!obj && o.userData && o.userData.itemId === unitId) obj = o; });
    const L1 = d.levels().list.find((l) => l.id === 'L1');
    if (!obj || !L1) return { found: !!obj, L1: !!L1 };
    obj.updateMatrixWorld(true);
    let minY = Infinity;
    obj.traverse((m) => { if (m.isMesh && m.geometry) { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld); minY = Math.min(minY, b.min.y); } });
    store.setUI({ mode: '2d' });
    return { found: true, minY, floorY: L1.y };
  }, runUp.unitId || runUp.unit);
  check('…its unit stands on the first floor in 3D (bottom at the floor height)', in3d.found && Math.abs(in3d.minY - in3d.floorY) < 0.2, JSON.stringify(in3d));
  await page.evaluate(() => { window.app.ui.carpentry.enter(); });
  await sleep(500);
  if (shots) {
    await page.evaluate(() => window.app.ui.openPanel('catalog'));
    await sleep(300);
    const box = await page.locator('.cpanel').boundingBox();
    if (box) await page.screenshot({ path: path.join(shotDir, 'e2e-levels-runs.png'), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 520) } });
  }
  const runsPanel = await page.evaluate(() => [...document.querySelectorAll('.cpanel .floorgroup')].map((g) => g.dataset.floor));
  check('runs panel: runs grouped by floor, the floor shown first', runsPanel[0] === 'L1', JSON.stringify(runsPanel));
  await page.evaluate(() => window.app.ui.carpentry.exit());
  await sleep(200);

  // ── remove the first floor with "move everything down": the bed and the run come down ──
  await page.locator('.lvlswitch').click();
  await sleep(200);
  await page.getByRole('menuitem', { name: 'Remove floor…' }).click();
  await sleep(300);
  const dlg2 = await page.locator('.lvldlg--remove').textContent().catch(() => '');
  const moveEnabled = await page.getByRole('button', { name: 'Move everything to Ground floor' }).isEnabled();
  check('remove dialog lists the carpentry run, both actions enabled', /1 carpentry run/.test(dlg2) && moveEnabled && await page.getByRole('button', { name: 'Delete it with the floor' }).isEnabled(), dlg2.slice(0, 200));
  await page.getByRole('button', { name: 'Move everything to Ground floor' }).click();
  await sleep(500);
  const down2 = await page.evaluate(({ bedId, runId }) => {
    const { store, plan } = window.app, run = store.carpentry.runs[runId];
    return { levels: (plan.levels || []).length, bed: (store.getItem(bedId) || {}).level || 'L0', run: run ? run.level || 'L0' : null, units: run ? run.unitIds.map((id) => (store.getItem(id) || {}).level || 'L0') : [] };
  }, { bedId: bed.id, runId: runUp.runId });
  check('floor removed: the bed and the run (with its units) are on the ground floor', down2.levels === 0 && down2.bed === 'L0' && down2.run === 'L0' && down2.units.every((l) => l === 'L0'), JSON.stringify(down2));
  await page.keyboard.press('Control+z');
  await sleep(400);
  const back2 = await page.evaluate(({ runId }) => ({ levels: (window.app.plan.levels || []).length, run: (window.app.store.carpentry.runs[runId] || {}).level }), { runId: runUp.runId });
  check('one undo brings the floor, the bed and the run back', back2.levels === 1 && back2.run === 'L1', JSON.stringify(back2));

  // ── Settings → Experimental: the floors switch hides / shows the floor controls at runtime ──
  await page.evaluate(() => window.app.store.setUI({ level: 'L1' }));
  await page.locator('button[aria-label="Settings"]').first().click();
  await sleep(300);
  const sw = page.getByRole('switch', { name: /Several floors/ });
  check('Settings has the "Several floors (in development)" switch, on', await sw.isChecked());
  await sw.click({ force: true });
  await sleep(300);
  const off = await page.evaluate(() => ({ on: 'levels' in document.documentElement.dataset, switcher: document.querySelector('.lvlswitch').offsetParent !== null, status: !!document.querySelector('.sb__cell--level') && document.querySelector('.sb__cell--level').offsetParent !== null, level: window.app.store.ui.level, levels: (window.app.plan.levels || []).length, note: document.querySelector('.setnote--warn') && !document.querySelector('.setnote--warn').hidden ? document.querySelector('.setnote--warn').textContent : '' }));
  if (shots) {
    const box = await page.locator('.settings__group--exp').boundingBox();
    if (box) await page.screenshot({ path: path.join(shotDir, 'e2e-levels-settings.png'), clip: { x: box.x - 12, y: box.y - 8, width: box.width + 24, height: box.height + 16 } });
  }
  check('switch off: floor controls hidden, ground floor shown, the upper floor kept (with a note)', !off.on && !off.switcher && !off.status && off.level === 'L0' && off.levels === 1 && /kept/.test(off.note), JSON.stringify(off));
  await sw.click({ force: true });
  await sleep(300);
  const on2 = await page.evaluate(() => ({ on: 'levels' in document.documentElement.dataset, switcher: document.querySelector('.lvlswitch').offsetParent !== null }));
  check('switch on again: the floor controls are back', on2.on && on2.switcher, JSON.stringify(on2));
  await page.getByRole('button', { name: 'Done' }).click();
  await sleep(200);

  // ── stairs (stage F4b): a two-level house, the Stairs tool, the symbol on both floors, 3D, inspector, Checks, move, undo, remove ──
  {
    const house = await page.evaluate(async () => {
      const { projects, store } = window.app;
      await projects.create({ name: 'E2E stairs', from: 'blank', lot: { width: 2400, depth: 1800 } });
      const E = await import('/src/core/plan-edit.js');
      const X0 = 600, Y0 = 500, X1 = 1600, Y1 = 1300, t = 20;
      const r = [E.addWall({ x1: X0, y1: Y0, x2: X1, y2: Y0, thickness: t }), E.addWall({ x1: X1, y1: Y0, x2: X1, y2: Y1, thickness: t }), E.addWall({ x1: X1, y1: Y1, x2: X0, y2: Y1, thickness: t }),
        E.addWall({ x1: X0, y1: Y1, x2: X0, y2: Y0, thickness: t }), E.addWall({ x1: 1100, y1: Y0, x2: 1100, y2: Y1, thickness: 10 })];
      store.setUI({ mode: '2d', tool: 'select', level: 'L0' });
      window.app.view2d.fit('house', { animate: false });
      return r.every((x) => x.ok) && window.app.plan.rooms.length === 2;
    });
    check('stairs: a one-level house (two rooms)', house);
    // one level: the Stairs tool explains that a stair needs a floor above and offers to add one
    await page.keyboard.press('b'); await sleep(200);
    await page.keyboard.press('t'); await sleep(400);
    const offer = page.locator('.toast').filter({ hasText: 'needs a floor above' });
    check('stairs: on a one-level house the Stairs tool says a stair needs a floor above', await offer.isVisible() && (await page.evaluate(() => window.app.store.ui.tool)) === 'stairs');
    await offer.getByRole('button', { name: 'Add floor above…' }).click();
    await sleep(300);
    await page.getByRole('button', { name: 'Add floor', exact: true }).click();
    await sleep(500);
    await page.evaluate(() => window.app.store.setUI({ level: 'L0' }));
    await sleep(300);
    // the Stairs tool: hover → a ghost that fits, click → a stair and the opening above
    await page.keyboard.press('t'); await sleep(200);
    const at = await page.evaluate(() => window.app.view2d.planToScreen(1350, 900));
    const before = await page.evaluate(() => window.app.view2d._debug.renderNow() && true);
    await page.mouse.move(at.x - 40, at.y); await sleep(100);
    await page.mouse.move(at.x, at.y); await sleep(250);
    const ghost = await page.evaluate(() => { const g = window.app.view2d._debug.state.struct.stairGhost; return g && { ok: g.ok, reason: g.reason }; });
    check('stairs: the ghost follows the pointer and fits (green)', before && ghost && ghost.ok, JSON.stringify(ghost));
    await page.mouse.click(at.x, at.y); await sleep(500);
    const placed = await page.evaluate(async () => {
      const { plan, store } = window.app, E = await import('/src/core/plan-edit.js');
      const info = E.stairInfo('st1');
      return { stairs: (plan.stairs || []).map((s) => s.id), voids: (plan.levels[0].voids || []).map((v) => ({ id: v.id, stair: v.stair })), covers: info && info.covers, sel: store.ui.structureSel, tool: store.ui.tool };
    });
    check('stairs: a click places a straight stair on the ground floor and its opening in the floor above', placed.stairs.join() === 'st1' && placed.voids.length === 1 && placed.voids[0].stair === 'st1' && placed.covers
      && placed.sel && placed.sel.type === 'stair' && placed.tool === 'structure', JSON.stringify(placed));
    // the symbol on both floors: the drawn pixels inside the stair's box change with the stair (sampled from the plan canvas)
    const sample = () => page.evaluate(async () => {
      const v = window.app.view2d, E = await import('/src/core/plan-edit.js'), info = E.stairInfo('st1');
      v._debug.renderNow();
      const c = document.querySelector('.view2d-canvas'), ctx = c.getContext('2d'), r = c.getBoundingClientRect(), dpr = c.width / r.width;
      const xs = info.geo.footprint.map((p) => p[0]), ys = info.geo.footprint.map((p) => p[1]);
      const a = v.planToScreen(Math.min(...xs), Math.min(...ys)), b = v.planToScreen(Math.max(...xs), Math.max(...ys));
      const d = ctx.getImageData(Math.round((a.x - r.left) * dpr), Math.round((a.y - r.top) * dpr), Math.round((b.x - a.x) * dpr), Math.round((b.y - a.y) * dpr)).data;
      const cols = new Set();
      for (let i = 0; i < d.length; i += 4) cols.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
      return cols.size;
    });
    await page.evaluate(() => window.app.store.setUI({ structureSel: null }));
    await page.mouse.move(at.x + 400, at.y + 300); await sleep(150);       // no hover tint on the stair
    const colsL0 = await sample();
    if (shots) {
      const box = await page.evaluate(() => { const v = window.app.view2d, a = v.planToScreen(1150, 560), b = v.planToScreen(1560, 1240); return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }; });
      await page.screenshot({ path: path.join(shotDir, 'e2e-stairs-ground.png'), clip: box });
    }
    await page.keyboard.press('PageUp'); await sleep(400);
    const colsL1 = await sample();
    const up1 = await page.evaluate(async () => {
      const { stairsOfLevel } = await import('/src/view2d/stairs.js');
      const s = stairsOfLevel(window.app.plan, 'L1');
      return { level: window.app.store.ui.level, top: s.top.map((x) => x.stair.id), bottom: s.bottom.length, voids: window.app.view2d._debug.env.plan.voids.length };
    });
    check('stairs: drawn on the ground floor (treads, walking line, UP) and on the first floor (dashed opening, DN)', colsL0 >= 4 && colsL1 >= 4 && up1.level === 'L1' && up1.top.join() === 'st1' && up1.bottom === 0 && up1.voids === 1, `${colsL0} / ${colsL1} colours, ${JSON.stringify(up1)}`);
    if (shots) {
      const box = await page.evaluate(() => { const v = window.app.view2d, a = v.planToScreen(1150, 560), b = v.planToScreen(1560, 1240); return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }; });
      await page.screenshot({ path: path.join(shotDir, 'e2e-stairs-upper.png'), clip: box });
    }
    await page.keyboard.press('PageDown'); await sleep(300);
    // the inspector: shape, sizes and the rule hints with their sourced limits
    await page.evaluate(() => { window.app.store.setUI({ structureSel: { type: 'stair', id: 'st1' } }); window.app.openPanel && window.app.openPanel('inspector'); });
    await sleep(400);
    const insp = await page.evaluate(() => {
      const el = document.querySelector('.sinsp__rules');
      return { rules: el ? [...el.querySelectorAll('dt')].map((d) => d.textContent) : [], tags: el ? [...el.querySelectorAll('.tag')].map((t) => t.textContent) : [], fit: !![...document.querySelectorAll('button')].find((b) => /Fit to the rules/.test(b.textContent)) };
    });
    check('stairs: the inspector shows riser, going, 2R + G, width, headroom with pass hints and "Fit to the rules"', ['Riser height', 'Going', '2R + G', 'Width', 'Headroom'].every((r) => insp.rules.includes(r)) && insp.tags.length >= 5 && insp.tags.every((t) => t === 'OK') && insp.fit, JSON.stringify(insp));
    if (shots) {
      const box = await page.locator('.side-right').boundingBox();
      if (box) await page.screenshot({ path: path.join(shotDir, 'e2e-stairs-inspector.png'), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 760) } });
    }
    // Checks: the stair findings are filed under the ground floor
    await page.evaluate(() => window.app.openPanel && window.app.openPanel('checks'));
    await page.locator('[role="tab"]', { hasText: 'Checks' }).first().click().catch(() => {});
    await sleep(1500);
    const chk = await page.evaluate(() => {
      const groups = [...document.querySelectorAll('.floorgroup')];
      const where = (re) => groups.filter((g) => [...g.querySelectorAll('.checkrow__title')].some((t) => re.test(t.textContent))).map((g) => g.dataset.floor);
      return { stairs: where(/^Stair st1/), floors: groups.map((g) => g.dataset.floor) };
    });
    check('stairs: Checks lists the stair findings under the ground floor', chk.stairs.length === 1 && chk.stairs[0] === 'L0', JSON.stringify(chk));
    // 3D: the stair mesh, and at its top one continuous railing (the stair's guard stops where the void railing begins)
    await page.keyboard.press('2'); await sleep(2500);
    const d3 = await page.evaluate(() => {
      const dbg = window.app.view3d && window.app.view3d.debug, sc = dbg && dbg.scene, m = sc && sc.getObjectByName('stair:st1');
      return { mesh: !!m, visible: !!(m && m.visible), level: m && m.userData.levelId };
    });
    check('stairs: in 3D the stair stands on the ground floor', d3.mesh && d3.visible && d3.level === 'L0', JSON.stringify(d3));
    if (shots) {
      await page.evaluate(async () => {
        window.app.store.setUI({ level: 'L1', showRoof: false, wallsCutaway: true, daylight: false });   // simple fill lights: no wait for the daylight solve
        const dbg = window.app.view3d.debug, m = dbg.scene.getObjectByName('stair:st1');
        m.geometry.computeBoundingBox();
        const box = new m.geometry.boundingBox.constructor().setFromObject(m), c = box.getCenter(dbg.camera.position.clone());
        c.y = 2.9; c.z = box.min.z + 1.2;                                   // the top of the stair, from the north-west, above
        dbg.rig.setPose({ ...dbg.rig.getPose(), target: c, theta: -2.5, phi: 0.6, radius: 4.5 }, { animate: false });
        dbg.renderNow();
      });
      await sleep(4000);
      await page.evaluate(() => window.app.view3d.debug.renderNow());
      await sleep(300);

      const box = await page.locator('#view3d, .view3d').first().boundingBox().catch(() => null);
      await page.screenshot({ path: path.join(shotDir, 'e2e-stairs-3d.png'), clip: box ? { x: box.x + box.width * 0.05, y: box.y + box.height * 0.08, width: box.width * 0.6, height: box.height * 0.8 } : undefined });
      await page.evaluate(() => window.app.store.setUI({ level: 'L0', wallsCutaway: false, daylight: true }));
    }
    await page.keyboard.press('1'); await sleep(600);
    // move it by dragging (it snaps; the opening above follows), then undo
    await page.evaluate(() => window.app.store.setUI({ tool: 'structure', structureSel: { type: 'stair', id: 'st1' } }));
    await sleep(200);
    const p0 = await page.evaluate(() => window.app.view2d.planToScreen(1350, 950));
    const p1 = await page.evaluate(() => window.app.view2d.planToScreen(1250, 950));
    await page.mouse.move(p0.x, p0.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(p0.x + ((p1.x - p0.x) * i) / 8, p0.y); await sleep(30); }
    await page.mouse.up(); await sleep(400);
    const moved = await page.evaluate(() => ({ x: window.app.plan.stairs[0].x, v: window.app.plan.levels[0].voids[0].polygon[0][0] }));
    check('stairs: dragged 1 m west, it moves with its opening above', Math.abs(moved.x - 1250) <= 15 && Math.abs(moved.v - (moved.x - 45)) < 0.01, JSON.stringify(moved));
    await page.keyboard.press('Control+z'); await sleep(400);
    const undone = await page.evaluate(() => ({ x: window.app.plan.stairs[0].x, v: window.app.plan.levels[0].voids[0].polygon[0][0] }));
    check('stairs: one undo puts it (and the opening) back', undone.x === 1350 && undone.v === 1305, JSON.stringify(undone));
    // remove it with Delete: the opening goes with it
    await page.evaluate(() => window.app.store.setUI({ structureSel: { type: 'stair', id: 'st1' } }));
    await page.locator('.view2d-canvas').focus().catch(() => {});
    await page.keyboard.press('Delete'); await sleep(400);
    const gone = await page.evaluate(() => ({ stairs: (window.app.plan.stairs || []).length, voids: (window.app.plan.levels[0].voids || []).length }));
    check('stairs: Delete removes the stair and its opening', gone.stairs === 0 && gone.voids === 0, JSON.stringify(gone));
    await page.evaluate(() => window.app.store.setUI({ tool: 'select' }));
  }

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

  // phone: the stair inspector (the stair placed again through the engine) fits, no page scroll
  const phoneStair = await page.evaluate(async () => {
    const E = await import('/src/core/plan-edit.js');
    window.app.store.setUI({ level: 'L0' });
    const r = E.addStair({ level: 'L0', x: 1350, y: 902.25 });
    window.app.store.setUI({ tool: 'structure', mode: '2d' });
    window.app.store.setUI({ structureSel: { type: 'stair', id: r.ids[0] } });
    if (window.app.openPanel) window.app.openPanel('inspector');
    return r.ok;
  });
  await sleep(600);
  const phoneInsp = await page.evaluate(() => {
    const rules = document.querySelector('.sinsp__rules'), r = rules && rules.getBoundingClientRect();
    return { rules: !!(rules && rules.offsetParent), inside: !!r && r.left >= 0 && r.right <= window.innerWidth + 0.5,
      scroll: document.scrollingElement.scrollHeight <= window.innerHeight && document.scrollingElement.scrollWidth <= window.innerWidth };
  });
  check('phone: the stair inspector is shown within the screen, no page scroll', phoneStair && phoneInsp.rules && phoneInsp.inside && phoneInsp.scroll, JSON.stringify(phoneInsp));

  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
}

main().catch((e) => { console.error(e); failed++; }).finally(() => { server.kill(); console.log(failed ? `\n${failed} check(s) failed` : '\nALL OK'); process.exit(failed ? 1 : 0); });
