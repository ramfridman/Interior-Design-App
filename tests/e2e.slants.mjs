// End-to-end: angled walls in the 2D plan (stage A3 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md), with `?angled=1`.
// An empty-lot draft project with a rectangular house; a 45° partition drawn with the Wall tool (pointer moves, the angle
// read-out snaps); the two rooms' areas in the Rooms tab against analytic values; a door added to the angled wall with the
// Door tool, flipped from the inspector; the wall's end dragged to 30° and back; an angle typed in the inspector; the wall
// moved by its body grip; typed length / angle while drawing; undo back to the rectangle (and redo); a sofa flush against
// the angled wall. The WEDGE fixture (buildPlan({ slants: true }) + projects.create({ fromPlan })) with its dimensions,
// a ∥ guide while drawing, and its plan PNG export. With the switch off: the House 98 plan PNG identical to the capture
// taken before stage A3 (tests/fixtures/house98-plan-png.json) and no new controls. A phone viewport: drawing by touch,
// the read-out lifted above the finger. The Wedge in 3D (stage A4): orbit, cut-away on / off, a wall finish dropped on the
// slanted wall, a walk into an angled wall (blocked). Stage A5: the Checks tab on the Wedge, a carpentry run picked on
// the angled wall s01 and its elevation. No console errors anywhere (THREE NaN warnings included).
//   node tests/e2e.slants.mjs [--shots]      (screenshots go to dev/screens/e2e-slants-*.png)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5303;
const shots = process.argv.includes('--shots');
const shotDir = path.join(root, 'dev', 'screens');
fs.mkdirSync(shotDir, { recursive: true });
const REF = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'house98-plan-png.json'), 'utf8'));

const server = spawn(process.execPath, [path.join(root, 'dev', 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };

async function boot(browser, query, viewport = { width: 1440, height: 900 }, extra = {}) {
  const context = await browser.newContext({ viewport, ...extra });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* none */ } });
  await page.goto(`http://localhost:${PORT}/index.html${query}`);
  const ready = await page.waitForFunction(() => document.documentElement.classList.contains('app-ready'), null, { timeout: 90000 }).then(() => true, () => false);
  await sleep(900);
  await page.getByRole('button', { name: 'Start designing' }).click({ timeout: 10000 }).catch(() => {});
  await sleep(400);
  return { context, page, errors, ready };
}
const scr = (page, x, y) => page.evaluate(({ x, y }) => window.app.view2d.planToScreen(x, y), { x, y });
const draft = (page) => page.evaluate(() => { const D = window.app.view2d._debug.state.struct.draft; return D ? { readout: D.readout, shown: D.shown, angleKind: D.angleKind, endKind: D.endKind, ok: D.ok, reason: D.reason, angled: D.angled, joined: D.joined, input: D.input, guides: (D.slantGuides || []).map((g) => g.kind) } : null; });
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shotDir, `e2e-slants-${name}.png`) }); };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
async function exportPng(page, ui) {
  const b64 = await page.evaluate(async (ui) => {
    if (ui) window.app.store.setUI(ui);
    await new Promise((r) => setTimeout(r, 300));
    const blob = await window.app.view2d.exportPNG({ scale: 1 });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, ui || null);
  return Buffer.from(b64, 'base64');
}

async function main() {
  await sleep(500);
  const browser = await chromium.launch();

  // ════════ the switch on: a rectangular house and a 45° partition ════════
  const { page, errors, ready } = await boot(browser, '?angled=1');
  check('app boots with ?angled=1', ready);
  if (!ready) { console.log(errors.join('\n')); await browser.close(); return; }

  const X0 = 600, Y0 = 500, X1 = 1400, Y1 = 1100, T = 25;      // centre lines (the engine puts the faces on its 5 cm grid)
  const made = await page.evaluate(async ({ X0, Y0, X1, Y1, T }) => {
    const { projects, store, plan } = window.app;
    const res = await projects.create({ name: 'E2E angled', from: 'blank', lot: { width: 2400, depth: 1800 } });
    const E = await import('/src/core/plan-edit.js');
    const r = [
      E.addWall({ x1: X0, y1: Y0, x2: X1, y2: Y0, thickness: T }), E.addWall({ x1: X1, y1: Y0, x2: X1, y2: Y1, thickness: T }),
      E.addWall({ x1: X1, y1: Y1, x2: X0, y2: Y1, thickness: T }), E.addWall({ x1: X0, y1: Y1, x2: X0, y2: Y0, thickness: T }),
    ];
    store.setUI({ mode: '2d', tool: 'select', showDimensions: true, wallThickness: 10, snap: true, units: 'm' });
    window.app.view2d.fit('house', { animate: false });
    window.__rect = JSON.stringify({ walls: plan.walls, openings: plan.openings, slants: plan.slants || null });
    const G = await import('/src/core/geometry.js');
    return { ok: res.ok, walls: r.map((x) => x.ok || x.reason), rooms: plan.rooms.length, phase: E.planPhase(), inner: plan.rooms[0] && G.polygonBounds(plan.rooms[0].polygon) };
  }, { X0, Y0, X1, Y1, T });
  check('empty-lot draft project with a rectangular house (1 room)', made.ok && made.walls.every((x) => x === true) && made.rooms === 1 && made.phase === 'draft', JSON.stringify(made));
  await sleep(300);

  // ── the Wall tool draws a 45° partition: from the west inner face to the north inner face ──
  await page.evaluate(() => window.app.store.setUI({ tool: 'wall', mode: '2d' }));
  await sleep(200);
  const IN = made.inner;                                                             // the room inside: 615 … 1390 × 515 … 1090
  const A = { x: IN.x, y: 900 }, Bp = { x: IN.x + (900 - IN.y), y: IN.y };            // west face → north face at 45°
  const a = await scr(page, A.x, A.y), b = await scr(page, Bp.x + 2, Bp.y + 3), mid = await scr(page, (A.x + Bp.x) / 2 + 6, (A.y + Bp.y) / 2 - 2);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 6 });
  const half = await draft(page);
  check('while dragging: an angled ghost, the read-out snaps to 45°', half && half.angled && half.shown === 45 && /45°/.test(half.readout) && half.angleKind === '45', JSON.stringify(half));
  await page.mouse.move(b.x, b.y, { steps: 6 });
  const end = await draft(page);
  check('the end runs into the north wall face (ray–face) and both ends are joined', end && end.endKind === 'face' && end.ok && end.joined && end.joined.every(Boolean), JSON.stringify(end));
  await shot(page, 'draw-45');
  await page.mouse.up();
  await sleep(300);
  const drawn = await page.evaluate(() => {
    const { plan, store } = window.app;
    const s = (plan.slants || [])[0];
    return { slants: (plan.slants || []).length, s, rooms: plan.rooms.length, sel: store.ui.structureSel, tool: store.ui.tool };
  });
  const s0 = drawn.s;
  check('one angled wall drawn at 45° (2 rooms), selected', drawn.slants === 1 && drawn.rooms === 2 && s0 && Math.abs(Math.abs((s0.y2 - s0.y1) / (s0.x2 - s0.x1)) - 1) < 1e-3 && drawn.sel && drawn.sel.id === `seg:a:${s0.id}`, JSON.stringify(drawn));

  // ── the two rooms' areas in the Rooms tab against analytic values ──
  const areas = await page.evaluate(async ({ A, B, t, IN }) => {
    const { fmtArea } = await import('/src/ui/format.js');
    const { polygonArea } = await import('/src/core/geometry.js');
    // centre line x + y = A.x + A.y; the room faces are 5 cm off it on each side (the wall's ends are cut by the outer walls)
    const c = A.x + A.y, corner = IN.x + IN.y, h = (t / 2) * Math.SQRT2;
    const L1 = c - h - corner, L2 = c + h - corner;
    const tri = (L1 * L1) / 2 / 1e4, rest = (IN.w * IN.h - (L2 * L2) / 2) / 1e4;
    const tab = document.querySelector('#tab-rooms'); if (tab) tab.click();
    await new Promise((r) => setTimeout(r, 400));
    const shown = [...document.querySelectorAll('#panel-rooms .room__area')].map((e) => e.firstChild.textContent.trim());
    const exact = window.app.plan.rooms.map((r) => polygonArea(r.polygon) / 1e4).sort((p, q) => p - q);
    return { analytic: [tri, rest], exact, shown, want: [fmtArea(tri), fmtArea(rest)] };
  }, { A, B: Bp, t: 10, IN });
  check('room areas are exact (< 1 cm² from the analytic triangle and the rest)', Math.abs(areas.exact[0] - areas.analytic[0]) < 1e-4 && Math.abs(areas.exact[1] - areas.analytic[1]) < 1e-4, JSON.stringify(areas));
  check('the Rooms tab shows both areas', areas.want.every((w) => areas.shown.includes(w)), JSON.stringify(areas.shown));

  // ── a door in the angled wall (Door tool), flipped from the inspector ──
  await page.evaluate(() => { window.app.store.setUI({ structureSel: null }); window.app.store.setUI({ tool: 'door', mode: '2d' }); });
  await sleep(200);
  const dm = await scr(page, (A.x + Bp.x) / 2 - 3, (A.y + Bp.y) / 2 + 3);
  await page.mouse.move(dm.x - 20, dm.y); await page.mouse.move(dm.x, dm.y, { steps: 3 });
  const ghost = await page.evaluate(() => { const g = window.app.view2d._debug.state.struct.ghost; return g && { ok: g.ok, axis: g.axis, hinge: g.hinge, swing: g.swing, at: g.at }; });
  check('the door ghost sits in the angled wall (canAddOpening)', ghost && ghost.ok && ghost.axis === 'a' && (ghost.swing === 'l' || ghost.swing === 'r'), JSON.stringify(ghost));
  await page.mouse.down(); await page.mouse.up();
  await sleep(300);
  const door = await page.evaluate(() => { const o = window.app.plan.openings.find((q) => q.axis === 'a'); return o && { id: o.id, hinge: o.hinge, swing: o.swing, wall: o.wall, at: o.at, rooms: o.rooms }; });
  check('a door in the angled wall, between the two rooms', door && door.wall === s0.id && door.rooms && door.rooms.length === 2, JSON.stringify(door));
  await page.evaluate((id) => { window.app.store.setUI({ tool: 'structure', structureSel: { type: 'opening', id } }); window.app.ui.openPanel && window.app.ui.openPanel('inspector'); }, door.id);
  await sleep(400);
  const words = await page.locator('.sinsp__hung').textContent().catch(() => '');
  check('the inspector says where it is hinged and where it opens, in words', /Hinged at the (north|south)-(east|west) end, opens into /.test(words), words);
  await page.getByRole('button', { name: 'Flip hinge side' }).click();
  await sleep(250);
  await page.getByRole('button', { name: 'Flip swing direction' }).click();
  await sleep(250);
  const flipped = await page.evaluate((id) => { const o = window.app.plan.openings.find((q) => q.id === id); return { hinge: o.hinge, swing: o.swing }; }, door.id);
  check('flip hinge and flip swing (a ↔ b, l ↔ r)', flipped.hinge !== door.hinge && flipped.swing !== door.swing, JSON.stringify(flipped));
  const words2 = await page.locator('.sinsp__hung').textContent().catch(() => '');
  check('the words follow the flip', words2 !== words && /opens into/.test(words2), words2);

  // ── slide the door along the angled wall, then drag a jamb (width) ──
  const handles = async () => page.evaluate(() => {
    const { view2d, store } = window.app, sel = store.ui.structureSel;
    return import('/src/view2d/structure.js').then((S) => S.selectionHandles(view2d._debug.env.plan, sel, view2d._debug.cam));
  });
  const canvasBox = await page.locator('.view2d-canvas').boundingBox();
  const hs = await handles(), slide = hs.find((q) => q.kind === 'slide');
  const o0 = await page.evaluate((id) => { const o = window.app.plan.openings.find((q) => q.id === id); return { at: o.at, width: o.width, ux: Math.cos(o.angle * Math.PI / 180), uy: Math.sin(o.angle * Math.PI / 180) }; }, door.id);
  const sc = await page.evaluate(() => window.app.view2d.getScale());
  const sx = canvasBox.x + slide.x, sy = canvasBox.y + slide.y, d40 = 40 * sc;
  await page.mouse.move(sx, sy); await page.mouse.down();
  await page.mouse.move(sx + o0.ux * d40 / 2, sy + o0.uy * d40 / 2, { steps: 3 }); await page.mouse.move(sx + o0.ux * d40, sy + o0.uy * d40, { steps: 3 });
  await page.mouse.up();
  await sleep(250);
  const slid = await page.evaluate((id) => window.app.plan.openings.find((q) => q.id === id).at, door.id);
  check('the door slides 40 cm along its angled wall', Math.abs(slid - o0.at - 40) < 1, `${o0.at} → ${slid}`);
  const hs2 = await handles(), j = hs2.find((q) => q.kind === 'w1');
  const jx = canvasBox.x + j.x, jy = canvasBox.y + j.y, d20 = 20 * sc;
  await page.mouse.move(jx, jy); await page.mouse.down();
  await page.mouse.move(jx + o0.ux * d20 / 2, jy + o0.uy * d20 / 2, { steps: 3 }); await page.mouse.move(jx + o0.ux * d20, jy + o0.uy * d20, { steps: 3 });
  await page.mouse.up();
  await sleep(250);
  const widened = await page.evaluate((id) => { const o = window.app.plan.openings.find((q) => q.id === id); return { at: o.at, width: o.width }; }, door.id);
  check('dragging its end jamb widens it by 20 cm, the other jamb stays', widened.width === o0.width + 20 && Math.abs((widened.at - widened.width / 2) - (slid - o0.width / 2)) < 0.15, JSON.stringify(widened));

  // ── drag the wall's end to 30° and back ──
  const segId = `seg:a:${s0.id}`;
  await page.evaluate((id) => window.app.store.setUI({ structureSel: { type: 'segment', id } }), segId);
  await sleep(250);
  const fixedA = [s0.x1, s0.y1], moveB = [s0.x2, s0.y2];
  const endB = await scr(page, moveB[0], moveB[1]);
  const at30 = { x: fixedA[0] + (fixedA[1] - IN.y) / Math.tan(Math.PI / 6), y: IN.y };          // on the north face, 30° from A
  const p30 = await scr(page, at30.x + 2, at30.y + 6);
  await page.mouse.move(endB.x, endB.y); await page.mouse.down();
  await page.mouse.move((endB.x + p30.x) / 2, (endB.y + p30.y) / 2 + 10, { steps: 5 });
  await page.mouse.move(p30.x, p30.y, { steps: 6 });
  const live30 = await page.evaluate(() => { const L = window.app.view2d._debug.state.struct.live; return L && { angle: L.angle, kind: L.kind }; });
  check('dragging the end: the angle read-out snaps to 30°', live30 && live30.angle === 30, JSON.stringify(live30));
  await page.mouse.up();
  await sleep(300);
  const after30 = await page.evaluate(() => { const s = window.app.plan.slants[0], d = window.app.plan.openings.find((o) => o.axis === 'a'); return { s, rooms: window.app.plan.rooms.length, door: !!d, ang: Math.atan2(-(s.y2 - s.y1), s.x2 - s.x1) * 180 / Math.PI }; });
  check('the wall is at 30°, still splitting the house, the door kept', Math.abs(after30.ang - 30) < 0.05 && after30.rooms === 2 && after30.door, JSON.stringify(after30));
  const endB2 = await scr(page, after30.s.x2, after30.s.y2), back = await scr(page, moveB[0] + 1, moveB[1] + 4);
  await page.mouse.move(endB2.x, endB2.y); await page.mouse.down();
  await page.mouse.move(back.x + 40, back.y + 10, { steps: 5 });
  await page.mouse.move(back.x, back.y, { steps: 6 });
  const liveBack = await page.evaluate(() => { const L = window.app.view2d._debug.state.struct.live; return L && { angle: L.angle, kind: L.kind, endKind: L.endKind, at: L.at }; });
  await page.mouse.up();
  await sleep(300);
  const after45 = await page.evaluate(() => { const s = window.app.plan.slants[0]; return { s, rooms: window.app.plan.rooms.length, ang: Math.atan2(-(s.y2 - s.y1), s.x2 - s.x1) * 180 / Math.PI }; });
  check('and back to 45°, the end on the north face again', Math.abs(after45.ang - 45) < 0.05 && Math.abs(after45.s.x2 - moveB[0]) < 0.2 && Math.abs(after45.s.y2 - moveB[1]) < 0.2 && after45.rooms === 2, JSON.stringify({ after45, liveBack }));

  // ── type an angle in the inspector ──
  await sleep(200);
  const angleInput = page.locator('.sinsp__angle input');
  check('the inspector of the angled wall: length, thickness, angle, the rooms it separates', await angleInput.isVisible() && /Between .* and /.test(await page.locator('#panel-inspector').textContent() || ''));
  await shot(page, 'inspector');
  await angleInput.fill('50');
  await angleInput.press('Enter');
  await sleep(400);
  const typed50 = await page.evaluate(() => { const s = window.app.plan.slants[0]; return { s, ang: Math.atan2(-(s.y2 - s.y1), s.x2 - s.x1) * 180 / Math.PI, sel: window.app.store.ui.structureSel }; });
  check('typing 50° turns it about its south-west end (that end stays; its far end now in the north wall)', Math.abs(typed50.ang - 50) < 0.1 && Math.abs(typed50.s.x1 - s0.x1) < 0.2 && Math.abs(typed50.s.y1 - s0.y1) < 0.2, JSON.stringify(typed50));

  // ── move the wall by its body grip (across itself) ──
  const s40 = typed50.s, mx = (s40.x1 + s40.x2) / 2, my = (s40.y1 + s40.y2) / 2, L = Math.hypot(s40.x2 - s40.x1, s40.y2 - s40.y1);
  const nx = -(s40.y2 - s40.y1) / L, ny = (s40.x2 - s40.x1) / L;
  const g0 = await scr(page, mx, my), g1 = await scr(page, mx + nx * 31 + 4 * (s40.x2 - s40.x1) / L, my + ny * 31 + 4 * (s40.y2 - s40.y1) / L);
  await page.mouse.move(g0.x, g0.y); await page.mouse.down();
  await page.mouse.move((g0.x + g1.x) / 2, (g0.y + g1.y) / 2, { steps: 4 }); await page.mouse.move(g1.x, g1.y, { steps: 4 });
  await page.mouse.up();
  await sleep(300);
  const moved = await page.evaluate(() => window.app.plan.slants[0]);
  const off = (moved.x1 - s40.x1) * nx + (moved.y1 - s40.y1) * ny;
  check('the body grip moves it across itself, in 5 cm steps (30 cm)', Math.abs(off - 30) < 0.6, `moved ${off.toFixed(2)} cm`);

  // ── typed length / angle while drawing (Tab to the angle, Enter builds) ──
  await page.evaluate(() => { window.app.store.setUI({ structureSel: null }); window.app.store.setUI({ tool: 'wall', mode: '2d' }); });
  await sleep(200);
  const t0 = await scr(page, IN.x + IN.w, 1000), t1 = await scr(page, IN.x + IN.w - 140, 900);
  await page.mouse.move(t0.x, t0.y); await page.mouse.down(); await page.mouse.up();      // click: the start; the draft follows the pointer
  await page.mouse.move(t1.x, t1.y, { steps: 4 });
  await page.keyboard.type('1.5');
  await page.keyboard.press('Tab');
  await page.keyboard.type('150');
  const typing = await draft(page);
  check('typed while drawing: 1.5 m at 150°', typing && Math.abs(Math.hypot(typing.input.x2 - typing.input.x1, typing.input.y2 - typing.input.y1) - 150) < 0.2 && typing.shown === 150, JSON.stringify(typing));
  await page.keyboard.press('Enter');
  await sleep(300);
  const typedWall = await page.evaluate(() => window.app.plan.slants.length);
  check('Enter builds it', typedWall === 2);
  await page.keyboard.press('Escape');

  // ── undo everything back to the rectangle, then redo ──
  const undone = await page.evaluate(async () => {
    const { store, plan } = window.app;
    let n = 0;
    while (n < 40 && JSON.stringify({ walls: plan.walls, openings: plan.openings, slants: plan.slants || null }) !== window.__rect) { store.undo(); n++; await new Promise((r) => setTimeout(r, 30)); }
    const same = JSON.stringify({ walls: plan.walls, openings: plan.openings, slants: plan.slants || null }) === window.__rect;
    const rooms = plan.rooms.length, hasKey = 'slants' in plan;
    for (let i = 0; i < n; i++) { store.redo(); await new Promise((r) => setTimeout(r, 30)); }
    return { n, same, rooms, hasKey, after: (plan.slants || []).length };
  });
  check('undo walks every step back to the rectangle (no slants key left), redo brings them back', undone.same && undone.rooms === 1 && !undone.hasKey && undone.after === 2 && undone.n >= 7, JSON.stringify(undone));

  // ── a sofa flush to the angled wall ──
  const sofa = await page.evaluate(async () => {
    const { store, plan, view2d, catalog } = window.app;
    store.setUI({ tool: 'select', structureSel: null });
    const sl = plan.slants.find((s) => Math.abs(Math.atan2(-(s.y2 - s.y1), s.x2 - s.x1) * 180 / Math.PI - 50) < 1) || plan.slants[0];
    const L = Math.hypot(sl.x2 - sl.x1, sl.y2 - sl.y1), ux = (sl.x2 - sl.x1) / L, uy = (sl.y2 - sl.y1) / L, nx = -uy, ny = ux;
    // the room on the right-hand side (south-east of the wall): 60 cm off its face, a third along it
    const px = sl.x1 + ux * L * 0.62 + nx * 70, py = sl.y1 + uy * L * 0.62 + ny * 70;
    const prod = (catalog && (catalog.products || catalog.items || [])).find?.((p) => p.type === 'sofa') || null;
    const partial = prod ? { productId: prod.id, type: 'sofa', name: prod.name, w: prod.w || 200, d: prod.d || 90, h: prod.h || 80, placement: 'floor' } : { type: 'sofa', name: 'Sofa', w: 200, d: 90, h: 80, placement: 'floor', generic: true };
    const p = view2d.planToScreen(px, py);
    const it = view2d.dropAt(p.x, p.y, partial);
    const G = await import('/src/core/geometry.js');
    const back = G.itemCorners(it).slice(0, 2).map(([x, y]) => (x - sl.x1) * nx + (y - sl.y1) * ny - sl.t / 2);
    return { ok: !!it, rot: it && it.rot, back, hit: it ? G.wallsHitByItem(it, plan).length : -1, wallDeg: Math.atan2(uy, ux) * 180 / Math.PI };
  });
  check('a sofa dropped beside the angled wall turns to it, its back flush (± 0.2 cm)', sofa.ok && sofa.back.every((v) => Math.abs(v) <= 0.2) && sofa.rot % 90 !== 0, JSON.stringify(sofa));
  // ── keys: an arrow nudges the selected angled wall across itself (5 cm), Delete removes it ──
  const keyWall = await page.evaluate(() => {
    const { store, plan } = window.app;
    const s = plan.slants.find((q) => Math.abs(Math.atan2(-(q.y2 - q.y1), q.x2 - q.x1) * 180 / Math.PI - 150) < 1);
    store.setUI({ tool: 'structure', structureSel: { type: 'segment', id: `seg:a:${s.id}` } });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    return s;
  });
  await sleep(200);
  await page.keyboard.press('ArrowUp');
  await sleep(200);
  const nudged = await page.evaluate((id) => window.app.plan.slants.find((q) => q.id === id), keyWall.id);
  const kL = Math.hypot(keyWall.x2 - keyWall.x1, keyWall.y2 - keyWall.y1), kn = [-(keyWall.y2 - keyWall.y1) / kL, (keyWall.x2 - keyWall.x1) / kL];
  const kOff = (nudged.x1 - keyWall.x1) * kn[0] + (nudged.y1 - keyWall.y1) * kn[1];
  check('↑ nudges the 150° wall 5 cm across itself (the side ↑ points to)', Math.abs(Math.abs(kOff) - 5) < 0.15 && kOff * (kn[1] < 0 ? 1 : -1) > 0, kOff.toFixed(2));
  await page.keyboard.press('Delete');
  await sleep(300);
  check('Delete removes it', await page.evaluate((id) => !(window.app.plan.slants || []).some((q) => q.id === id), keyWall.id));

  // ── a straight wall's free end dragged off its axis becomes an angled wall ──
  const rectEnd = await page.evaluate(async (IN) => {
    const E = await import('/src/core/plan-edit.js');
    const x = 1150, res = E.addWall({ x1: x, y1: IN.y + IN.h, x2: x, y2: 820, thickness: 10 });
    const seg = E.wallSegments().find((q) => q.axis === 'v' && q.core.x <= x && q.core.x + q.core.w >= x && q.freeEnds.some(Boolean));
    window.app.store.setUI({ tool: 'structure', structureSel: { type: 'segment', id: seg.id } });
    return { ok: res.ok, id: seg.id, top: seg.core.y, x: seg.core.x + seg.core.w / 2, bottom: seg.core.y + seg.core.h };
  }, IN);
  await sleep(250);
  const re0 = await scr(page, rectEnd.x, rectEnd.top), reTo = await scr(page, rectEnd.x - 104, rectEnd.bottom - 390);
  await page.mouse.move(re0.x, re0.y); await page.mouse.down();
  await page.mouse.move(re0.x - 15, re0.y + 4, { steps: 3 }); await page.mouse.move(reTo.x, reTo.y, { steps: 6 });
  await page.mouse.up();
  await sleep(300);
  const angledRect = await page.evaluate(() => { const { plan, store } = window.app, sel = store.ui.structureSel; const s = (plan.slants || []).find((q) => sel && sel.id === `seg:a:${q.id}`); return s && { ang: Math.atan2(-(s.y2 - s.y1), s.x2 - s.x1) * 180 / Math.PI, s }; });
  check('a straight wall’s end dragged off its axis turns it into an angled wall (75°)', rectEnd.ok && angledRect && Math.abs(Math.abs(angledRect.ang) - 75) < 0.1, JSON.stringify(angledRect));
  check('main page: no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));

  // ── Settings → Experimental carries the switch with its works / not-yet text ──
  const setting = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => /settings/i.test(b.getAttribute('aria-label') || ''));
    if (!btn) return { found: false };
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    const box = document.querySelector('.settings__sub--angled');
    const text = box ? box.textContent : '';
    const checked = box ? !!box.querySelector('input[type="checkbox"]')?.checked || box.querySelector('[aria-checked="true"]') !== null : false;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return { found: !!box, checked, works: /Works: drawing walls at any angle.*angled walls in 3D/.test(text), approx: /Approximate: the light simulation/.test(text), notYet: /Importing from a drawing works too/.test(text) && !/Not yet: importing/.test(text) && !/Not yet: angled walls in 3D/.test(text) && !/Not yet: the regulation/.test(text), a5: /Also works: the regulation checks.*carpentry runs along angled walls.*walk-through/.test(text) };
  });
  check('Settings → Experimental: "Angled walls (in development)", on, with what works (3D too), what is approximate (light) and what not yet', setting.found && setting.checked && setting.works && setting.approx && setting.notYet && setting.a5, JSON.stringify(setting));
  await sleep(300);

  // ════════ the Wedge: dimensions, a ∥ guide, the plan PNG ════════
  const wedge = await page.evaluate(async () => {
    const { WEDGE } = await import('/tests/fixtures/houses.mjs');
    const B = await import('/src/core/plan-build.js');
    const built = B.buildPlan({ walls: WEDGE.walls, slants: WEDGE.slants, openings: WEDGE.openings, heights: WEDGE.heights, meta: { name: 'Wedge' } }, { slants: true });
    const res = await window.app.projects.create({ name: 'Wedge', fromPlan: built.plan });
    window.app.store.setUI({ mode: '2d', tool: 'select', showDimensions: true, structureSel: null });
    await new Promise((r) => setTimeout(r, 300));
    window.app.view2d.fit('house', { animate: false });
    return { ok: res.ok, slants: (window.app.plan.slants || []).length, rooms: window.app.plan.rooms.length };
  });
  check('the Wedge opens (2 angled walls, 3 rooms)', wedge.ok && wedge.slants === 2 && wedge.rooms === 3, JSON.stringify(wedge));
  await sleep(400);
  await shot(page, 'wedge-dims');
  // drawing roughly parallel to s01 (117.2°) inside the east room: the ∥ guide
  await page.evaluate(() => window.app.store.setUI({ tool: 'wall', mode: '2d' }));
  await sleep(200);
  const w0 = await scr(page, 760, 300), dir = [Math.cos(116 * Math.PI / 180), Math.sin(116 * Math.PI / 180)];
  const w1 = await scr(page, 760 + 300 * dir[0] * -1, 300 + 300 * dir[1] * -1);
  await page.mouse.move(w0.x, w0.y); await page.mouse.down();
  await page.mouse.move(w1.x, w1.y, { steps: 8 });
  const par = await draft(page);
  check('drawing near 117° offers the parallel to s01 (∥ guide)', par && par.angleKind === 'parallel' && par.guides.includes('parallel'), JSON.stringify(par));
  await shot(page, 'parallel');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.evaluate(() => window.app.store.setUI({ tool: 'select' }));
  const png = await exportPng(page);
  check('the Wedge plan PNG exports (A3 sheet)', png.length > 50000 && png.slice(1, 4).toString() === 'PNG', `${png.length} bytes`);
  // ── stage A5: the Checks tab on the Wedge, and a carpentry run picked on the angled wall ──
  await page.evaluate(() => { window.app.store.setUI({ mode: '2d' }); window.app.ui.openPanel('checks'); });
  await page.waitForFunction(() => document.querySelectorAll('#panel-checks .checkrow').length > 5, null, { timeout: 20000 }).catch(() => {});
  const chk = await page.evaluate(() => [...document.querySelectorAll('#panel-checks .checkrow')].map((r) => r.textContent));
  check('Wedge: the Checks tab lists findings (the window in s01 read at its true angle, the rooms sized)', chk.length > 5 && chk.some((t) => /facing south-east/.test(t)) && chk.some((t) => /clear width/.test(t)), `${chk.length} rows`);
  await shot(page, 'wedge-checks');
  await page.evaluate(() => { window.app.ui.carpentry.enter(); window.app.ui.carpentry.startNewRun('kitchen'); });
  await sleep(400);
  const pickAt = await page.evaluate(async () => {
    const SG = await import('/src/core/slant-geom.js');
    const s = window.app.plan.slants.find((x) => x.id === 's01'), f = SG.slantFrame(s), [x, y] = SG.pointAt(s, 300);
    return { x: x + f.nx * 25, y: y + f.ny * 25 };
  });
  const pp = await scr(page, pickAt.x, pickAt.y);
  await page.mouse.move(pp.x, pp.y, { steps: 3 });
  await sleep(150);
  await page.mouse.click(pp.x, pp.y);
  await page.waitForFunction(() => Object.values(window.app.store.carpentry.runs).some((r) => r.anchor.dir % 90), null, { timeout: 10000 }).catch(() => {});
  const carp = await page.evaluate(() => {
    const runs = Object.values(window.app.store.carpentry.runs), r = runs.find((q) => q.anchor.dir % 90);
    const units = r ? r.unitIds.map((id) => window.app.store.getItem(id)).filter(Boolean) : [];
    return { n: runs.length, dir: r && r.anchor.dir, name: r && r.name, units: units.length, rots: [...new Set(units.map((u) => u.rot))] };
  });
  check('Carpentry: picking the angled wall s01 creates a run along it (dir ≈ 117.15°, units turned to it)', carp.dir && Math.abs(carp.dir - 117.15) < 0.05 && carp.name === 'Kitchen — angled wall' && carp.rots.length <= 1 && (!carp.units || Math.abs(carp.rots[0] - carp.dir) < 1e-6), JSON.stringify(carp));
  await page.locator('.cwb__tab', { hasText: 'Elevation' }).first().click().catch(() => {});
  await page.waitForFunction(() => { const s = document.querySelector('.cwb svg.cdraw'); return s && s.querySelectorAll('*').length > 30; }, null, { timeout: 10000 }).catch(() => {});
  const elev = await page.evaluate(() => { const s = document.querySelector('.cwb svg.cdraw'); const t = document.querySelector('.cwb__tab[aria-selected="true"]'); return { svg: !!s, n: s ? s.querySelectorAll('*').length : 0, tab: t && t.textContent }; });
  check('Carpentry: the run\'s Elevation tab renders', elev.svg && elev.n > 30 && elev.tab === 'Elevation', JSON.stringify(elev));
  await shot(page, 'wedge-carpentry');
  await page.evaluate(() => window.app.ui.carpentry.exit());
  await sleep(200);
  check('Wedge: no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));

  // ════════ the Wedge in 3D (stage A4) ════════
  const shot3d = async (name) => { if (shots) await page.locator('#view3d').screenshot({ path: path.join(shotDir, `e2e-slants-${name}.png`), scale: 'css' }); };
  const look = (t, theta, phi, radius) => page.evaluate(([t, th, ph, r]) => { const d = window.app.view3d.debug; d.rig.setPose({ target: new d.camera.position.constructor(...t), theta: th, phi: ph, radius: r, fov: 45 }, { animate: false }); d.renderNow(); }, [t, theta, phi, radius]);
  await page.evaluate(() => window.app.store.setUI({ mode: '3d', showRoof: false, wallsCutaway: false }));
  await sleep(4000);
  const in3d = await page.evaluate(() => {
    const d = window.app.view3d.debug, house = d.house(), names = [];
    let nan = 0, angled = 0;
    house.group.traverse((o) => {
      if (!o.isMesh) return;
      names.push(o.name);
      const g = o.geometry; g.computeBoundingSphere();
      if (!Number.isFinite(g.boundingSphere.radius)) nan++;
      if (o.name.startsWith('wall:room:')) { const n = g.attributes.normal; for (let i = 0; i < n.count; i++) if (Math.abs(n.getX(i)) > 0.1 && Math.abs(n.getZ(i)) > 0.1) { angled++; break; } }
    });
    return { ready: d.isReady(), nan, angled, walls: names.filter((n) => n.startsWith('wall:room:')).length, calls: d.stats().calls };
  });
  check('Wedge in 3D: room walls with angled faces, no NaN bounding spheres', in3d.angled >= 3 && in3d.walls === 3 && in3d.nan === 0, JSON.stringify(in3d));
  for (const [theta, phi] of [[0.6, 0.9], [2.4, 1.1], [-2.2, 0.8], [3.6, 1.2]]) { await look([5, 0.8, 4], theta, phi, 16); await sleep(250); }   // orbit
  await look([5, 0.8, 4], 0.9, 1.1, 17);
  await sleep(1500);
  await shot3d('wedge-3d-outside');
  await page.evaluate(() => window.app.store.setUI({ wallsCutaway: true }));
  await sleep(1500);
  const cut = await page.evaluate(() => { const h = window.app.view3d.debug.house(); let top = -Infinity; h.group.traverse((o) => { if (o.isMesh && o.name === 'wall:cap' && o.geometry.index.count) { o.geometry.computeBoundingBox(); top = Math.max(top, o.geometry.boundingBox.max.y); } }); return top; });
  check('cut-away on: the walls (angled ones too) are capped at the cut-away height', cut > 0.5 && cut < 1.6, String(cut));
  await look([5, 0, 4], 0.3, 0.35, 15);
  await sleep(1500);
  await shot3d('wedge-3d-cutaway');
  // a wall finish dropped on the inner face of s01 (the east room)
  const drop = await page.evaluate(async () => {
    const { plan, view3d, store } = window.app, d = view3d.debug;
    const s = plan.slants.find((q) => q.id === 's01'), L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1), ux = (s.x2 - s.x1) / L, uy = (s.y2 - s.y1) / L, nx = -uy, ny = ux;
    const east = plan.rooms.find((r) => r.polygon.some(([x]) => x > 900));
    const at = 0.3 * L, fx = s.x1 + ux * at + nx * (s.t / 2 + 1), fy = s.y1 + uy * at + ny * (s.t / 2 + 1);   // inner face ('r' side)
    const V = d.camera.position.constructor;
    d.rig.setPose({ target: new V(fx / 100, 0.6, fy / 100), theta: Math.atan2(nx, ny), phi: 1.05, radius: 3.2, fov: 45 }, { animate: false });
    d.renderNow();
    await new Promise((r) => setTimeout(r, 300));
    const p = new V(fx / 100, 0.6, fy / 100).project(d.camera), rect = d.renderer.domElement.getBoundingClientRect();
    const cx = rect.left + (p.x + 1) / 2 * rect.width, cy = rect.top + (1 - p.y) / 2 * rect.height;
    const target = view3d.finishTargetAt(cx, cy);
    const prod = (await import('/src/catalog/index.js')).allProducts().find((q) => q.type === 'wall-finish');
    let applied = null;
    if (prod) {
      const dt = new DataTransfer();
      dt.setData('application/x-e7-product', prod.id);
      document.getElementById('pane3d').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 400));
      applied = (store.finishes[east.id] || {}).wall || null;
    }
    return { target, east: east.id, prod: prod && prod.id, applied };
  });
  check('a wall finish dropped on the slanted wall (inside) goes to the east room', drop.target && drop.target.surface === 'wall' && drop.target.spaceId === drop.east && drop.prod && drop.applied === drop.prod, JSON.stringify(drop));
  await page.evaluate(() => window.app.store.setUI({ wallsCutaway: false }));
  await sleep(800);
  // inside the west room, looking at s02 and its door (the NW triangle and the west room have no window — the entry door
  // is closed — so under the daylight solve they are dark: this shot uses the standard lighting)
  await page.evaluate(() => window.app.store.setUI({ daylight: false }));
  await look([1.62, 1.1, 1.62], Math.PI / 4 + 0.3, 1.38, 3.0);
  await sleep(1500);
  await shot3d('wedge-3d-interior');
  await page.evaluate(() => window.app.store.setUI({ daylight: true }));
  // walk into s02 from the NW triangle, away from its door: blocked
  await page.evaluate(() => window.app.store.setUI({ mode: 'walk' }));
  await sleep(2500);
  await page.evaluate(() => window.app.view3d.debug.walk.teleport(60, 200, 135));
  await sleep(300);
  await page.keyboard.down('KeyW');
  await sleep(2500);
  await page.keyboard.up('KeyW');
  await sleep(300);
  const walked = await page.evaluate(() => window.app.view3d.debug.walker());
  check('walking into the 45° wall (not at its door) is blocked: the walker stays in the NW triangle', walked.x + walked.y > 270 && walked.x + walked.y < 318 - 5 && walked.x < 200, JSON.stringify({ x: walked.x, y: walked.y }));
  await page.evaluate(() => window.app.store.setUI({ mode: '3d' }));
  await sleep(1200);
  check('Wedge 3D: no console errors (no THREE NaN warnings)', errors.length === 0, errors.slice(0, 5).join(' | '));
  console.log(`      Wedge 3D: ${in3d.calls} draw calls (orbit, roof off)`);
  await page.context().close();

  // ════════ the switch off: House 98 identical, no new controls, the wall tool as before ════════
  {
    const off = await boot(browser, '');
    check('app boots without the switch', off.ready);
    const flags = await off.page.evaluate(async () => (await import('/src/core/features.js')).FEATURES.angledWalls);
    check('angledWalls is off', flags === false);
    for (const [name, ui] of [['plain', { mode: '2d', tool: 'select', showDimensions: true }], ['nodims', { mode: '2d', tool: 'select', showDimensions: false }]]) {
      const buf = await exportPng(off.page, ui);
      check(`House 98 plan PNG (${name}) identical to the capture before stage A3`, sha(buf) === REF[name], sha(buf).slice(0, 12));
    }
    const ctl = await off.page.evaluate(() => ({ tags: document.querySelectorAll('.tag--angled, .sinsp__angle, .sinsp__keep').length }));
    check('no angled-wall controls anywhere', ctl.tags === 0);
    // the Wall tool as before: a diagonal drag gives a straight wall (axis lock), no read-out at the pointer
    await off.page.evaluate(() => { window.app.store.setUI({ mode: '2d' }); window.app.store.setUI({ tool: 'wall', mode: '2d' }); });
    await sleep(200);
    const q0 = await scr(off.page, 300, 300), q1 = await scr(off.page, 500, 420);
    await off.page.mouse.move(q0.x, q0.y); await off.page.mouse.down(); await off.page.mouse.move(q1.x, q1.y, { steps: 6 });
    const d0 = await draft(off.page);
    check('switch off: the Wall tool draws axis-locked as before (no angle read-out)', d0 && !d0.angled && !d0.readout && d0.input && (d0.input.y1 === d0.input.y2 || d0.input.x1 === d0.input.x2), JSON.stringify(d0));
    await off.page.keyboard.press('Escape');
    await off.page.mouse.up();
    check('switch off: no console errors', off.errors.length === 0, off.errors.slice(0, 5).join(' | '));
    await off.context.close();
  }

  // ════════ a phone: drawing by touch ════════
  {
    const ph = await boot(browser, '?angled=1', { width: 390, height: 844 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    check('phone boots', ph.ready);
    await ph.page.evaluate(async () => {
      const { projects, store } = window.app;
      await projects.create({ name: 'Phone', from: 'blank', lot: { width: 1600, depth: 1600 } });
      const E = await import('/src/core/plan-edit.js');
      for (const [x1, y1, x2, y2] of [[300, 300, 1000, 300], [1000, 300, 1000, 900], [1000, 900, 300, 900], [300, 900, 300, 300]]) E.addWall({ x1, y1, x2, y2, thickness: 20 });
      store.setUI({ mode: '2d' });
      window.app.ui.closePanels && window.app.ui.closePanels();
      window.app.view2d.fit('house', { animate: false });
      window.app.store.setUI({ tool: 'wall', mode: '2d' });
    });
    await sleep(500);
    const cdp = await ph.context.newCDPSession(ph.page);
    const t0 = await scr(ph.page, 310, 700), t1 = await scr(ph.page, 600, 410);
    const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y, id: 1 }] });
    await touch('touchStart', t0);
    let seen = null;
    for (let i = 1; i <= 10; i++) {
      await touch('touchMove', { x: t0.x + ((t1.x - t0.x) * i) / 10, y: t0.y + ((t1.y - t0.y) * i) / 10 });
      await sleep(30);
    }
    seen = await ph.page.evaluate(() => { const S = window.app.view2d._debug.state.struct, D = S.draft; return D && { touch: S.touch, readout: D.readout, shown: D.shown, angled: D.angled }; });
    await shot(ph.page, 'phone');
    await touch('touchEnd', t1);
    await sleep(400);
    const res = await ph.page.evaluate(() => ({ slants: (window.app.plan.slants || []).length, rooms: window.app.plan.rooms.length }));
    check('touch: drag to draw an angled wall, the read-out lifted above the finger', seen && seen.touch && seen.angled && /°/.test(seen.readout || '') && res.slants === 1, JSON.stringify({ seen, res }));
    check('phone: the page root never scrolls', await ph.page.evaluate(() => document.scrollingElement.scrollTop === 0 && document.documentElement.scrollHeight <= window.innerHeight + 1));
    check('phone: no console errors', ph.errors.length === 0, ph.errors.slice(0, 5).join(' | '));
    await ph.context.close();
  }

  await browser.close();
}

main().catch((e) => { console.error(e); failed++; }).finally(() => {
  server.kill();
  console.log(failed ? `\ne2e.slants: ${failed} FAILED` : '\ne2e.slants: all passed');
  process.exit(failed ? 1 : 0);
});
