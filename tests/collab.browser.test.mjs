// Live collaboration in real browsers against the dev server (dev/collab-server.mjs):
//   node tests/collab.browser.test.mjs
// Two people (plus a viewer) on one online project: drag → the other sees it move, pointer and selection; a wall drawn
// in Structure mode reaches the other plan, rooms and 3D; different fields of one item both survive; offline edits merge;
// a viewer cannot edit; no console errors. Prints measured latency and message sizes.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5000 + Math.floor(Math.random() * 400) + 600;
const BASE = `http://localhost:${PORT}`;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'e7-collab-test-'));
const server = spawn(process.execPath, [path.join(root, 'dev', 'collab-server.mjs'), String(PORT), '--data', data], { stdio: 'ignore' });
const shots = path.join(root, 'dev', 'screens');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(browser, email, query = '') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // record every WebSocket frame the page sends (size + type) for the report
  await page.addInitScript(() => {
    window.__wsSent = [];
    const send = WebSocket.prototype.send;
    window.__wsRecv = [];
    const Orig = window.WebSocket;
    window.WebSocket = function (...a) { const ws = new Orig(...a); ws.addEventListener('message', (e) => { try { const m = JSON.parse(e.data); window.__wsRecv.push({ t: m.t, at: Date.now() }); } catch (err) { /* not JSON */ } }); return ws; };
    window.WebSocket.prototype = Orig.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    WebSocket.prototype.send = function (d) { try { const m = JSON.parse(d); window.__wsSent.push({ t: m.t, n: d.length, at: Date.now() }); } catch (e) { /* not JSON */ } return send.call(this, d); };
  });
  await page.goto(`${BASE}/?as=${encodeURIComponent(email)}${query}`);
  await page.waitForFunction(() => document.documentElement.classList.contains('app-ready'), null, { timeout: 120000 });
  const start = page.getByRole('button', { name: 'Start designing' });
  if (await start.count()) await start.first().click().catch(() => {});
  await page.waitForFunction(() => !!(window.app && window.app.collab), null, { timeout: 30000 });
  return { page, context, errors };
}
const live = (page, n) => page.waitForFunction((n) => { const s = window.app.collab.session(); return s && s.client.status().state === 'live' && s.client.status().people === n; }, n, { timeout: 30000 });
const statusText = (page) => page.evaluate(() => (document.querySelector('.cl-status') || {}).textContent || '');
const design = (page) => page.evaluate(() => { const s = window.app.store.serialize(); delete s.savedAt; delete s.ui; return JSON.stringify(s); });
async function rest(email, method, p, body) {
  const r = await fetch(`${BASE}/api/${p}`, { method, headers: { 'x-dev-user': email, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

async function main() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (e) { /* not yet */ } await sleep(200); }
  const browser = await chromium.launch();
  const A = await openPage(browser, 'alice@example.com');
  check('the collaboration UI appears with a backend (status hidden until online, "Put online" shown)', await A.page.evaluate(() => !!document.querySelector('.cl-golive') && !document.querySelector('.cl-golive').hidden && document.querySelector('.cl-status').hidden));
  const put = await A.page.evaluate(() => window.app.projects.putOnline());
  check('A puts the project online', put.ok, put.reason || put.id);
  const id = put.id;
  await live(A.page, 1);
  check('status bar: "Live · 1 person"', (await statusText(A.page)) === 'Live · 1 person', await statusText(A.page));
  await rest('alice@example.com', 'PUT', `projects/${id}/members`, { members: { 'bob@example.com': 'editor', 'vera@example.com': 'viewer' } });
  const B = await openPage(browser, 'bob@example.com', `&online=${id}`);
  await live(B.page, 2); await live(A.page, 2);
  check('both see "Live · 2 people"', (await statusText(A.page)) === 'Live · 2 people' && (await statusText(B.page)) === 'Live · 2 people', `${await statusText(A.page)} / ${await statusText(B.page)}`);
  check('both start from the same design', (await design(A.page)) === (await design(B.page)));
  check('avatars in the top bar (initials + colour)', await B.page.evaluate(() => [...document.querySelectorAll('.cl-avatars .cl-av')].map((a) => a.textContent).join(',')) === 'BO,AL');

  // ---- 1. A drags a sofa with the mouse; B sees it move (transient), A's pointer and selection
  const sofa = await A.page.evaluate(() => { const it = window.app.store.items.find((i) => /sofa/i.test(i.type + i.name) && !i.locked) || window.app.store.items.find((i) => !i.fixture && !i.locked); return { id: it.id, x: it.x, y: it.y, name: it.name }; });
  await A.page.evaluate((id) => { window.app.store.setUI({ mode: '2d', tool: 'select' }); window.app.view2d.focusPlanPoint && 0; window.app.store.select([id]); }, sofa.id);
  await A.page.evaluate(() => { const st = window.app.store, c = st.commit.bind(st); st.commit = () => { window.__commitAt = Date.now(); return c(); }; });
  await B.page.evaluate((id) => { window.__seen = []; window.app.store.on('items', (e) => { if (e.ids.includes(id)) { const it = window.app.store.getItem(id); window.__seen.push({ x: it.x, at: Date.now(), transient: !!e.transient }); } }); }, sofa.id);
  const p0 = await A.page.evaluate(({ x, y }) => window.app.view2d.planToScreen(x, y), sofa);
  await A.page.mouse.move(p0.x, p0.y);
  await A.page.mouse.down();
  const tStart = Date.now();
  for (let i = 1; i <= 30; i++) { await A.page.mouse.move(p0.x + i * 4, p0.y); await sleep(16); }
  await sleep(300);
  const midB = await B.page.evaluate(() => window.__seen.filter((s) => s.transient).length);
  const lockSeen = await B.page.evaluate(() => { const p = window.app.collab.session().client.peers()[0]; return p && p.p && p.p.lock; });
  const lockedForB = await B.page.evaluate((id) => window.app.store.getItem(id).locked === true, sofa.id);
  await A.page.mouse.up();
  const finalA = await A.page.evaluate((id) => window.app.store.getItem(id).x, sofa.id);
  await B.page.waitForFunction(({ id, x }) => window.app.store.getItem(id).x === x, { id: sofa.id, x: finalA }, { timeout: 5000 });
  const seen = await B.page.evaluate(() => window.__seen);
  const firstMove = seen.find((s) => s.transient);
  const lastFinal = seen.filter((s) => !s.transient).pop();
  const dragMs = Date.now() - tStart;
  check(`B sees the sofa move during the drag (${midB} transient updates)`, midB >= 5, firstMove ? `first after ${firstMove.at - tStart} ms` : 'none');
  const tUp = await A.page.evaluate(() => window.__commitAt);
  check(`B has the final position within 500 ms of the mouse-up (${lastFinal ? lastFinal.at - tUp : '?'} ms)`, lastFinal && lastFinal.at - tUp <= 500 && finalA !== sofa.x);
  check('while A drags, B sees "being edited" (soft lock) and cannot grab it', lockSeen === 'item:' + sofa.id && lockedForB, String(lockSeen));
  await sleep(400);
  check('the soft lock is released after the drag', await B.page.evaluate((id) => window.app.store.getItem(id).locked !== true && !window.app.collab.session().client.peers()[0].p.lock, sofa.id));
  await A.page.mouse.move(p0.x + 200, p0.y + 40);
  await sleep(300);
  const pres = await B.page.evaluate(() => { const p = window.app.collab.session().client.peers()[0]; return p && p.p; });
  check('B sees A\'s pointer and selection', pres && pres.pointer && pres.sel.includes(sofa.id), JSON.stringify(pres));
  // a 60 Hz drag (what a real pointer produces on a fast machine; the headless mouse above is slower): B's update rate
  await B.page.evaluate(() => { window.__seen.length = 0; });
  await A.page.evaluate((id) => new Promise((done) => {
    const st = window.app.store, it = st.getItem(id), x0 = it.x; let n = 0;
    st.begin();
    const t = setInterval(() => { n++; st.updateItem(id, { x: x0 + n * 2 }, { transient: true }); if (n >= 90) { clearInterval(t); st.commit(); done(); } }, 16);
  }), sofa.id);
  await sleep(600);
  const tr = (await B.page.evaluate(() => window.__seen)).filter((s) => s.transient);
  const rate = tr.length > 1 ? (tr.length - 1) / ((tr[tr.length - 1].at - tr[0].at) / 1000) : 0;
  check(`B gets ≥ 10 updates / s during a 60 Hz drag (${rate.toFixed(1)} / s, ${tr.length} updates)`, rate >= 10);
  await B.page.evaluate(() => window.app.store.setUI({ mode: 'split' }));
  check('B draws A\'s selection in 3D', await B.page.waitForFunction((id) => !!document.querySelector(`.cl-3d__box[data-item="${id}"]`), sofa.id, { timeout: 8000 }).then(() => true, () => false));
  fs.mkdirSync(shots, { recursive: true });
  await B.page.screenshot({ path: path.join(shots, 'collab-b-sees-a.png') });
  await B.page.evaluate(() => window.app.store.setUI({ mode: '2d' }));
  check('same design after the drag', (await design(A.page)) === (await design(B.page)));

  // latency of one committed change, and message sizes
  const lat = [];
  for (let i = 0; i < 5; i++) {
    const t0 = await A.page.evaluate((id) => { window.app.store.updateItem(id, { rot: (window.app.store.getItem(id).rot + 90) % 360 }); return Date.now(); }, sofa.id);
    const rot = await A.page.evaluate((id) => window.app.store.getItem(id).rot, sofa.id);
    await B.page.waitForFunction(({ id, rot }) => window.app.store.getItem(id).rot === rot, { id: sofa.id, rot });
    lat.push((await B.page.evaluate(() => window.__seen[window.__seen.length - 1].at)) - t0);
  }
  const sent = await A.page.evaluate(() => window.__wsSent);
  const sizes = (t) => sent.filter((m) => m.t === t).map((m) => m.n);
  const avg = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0);
  console.log(`      latency A→B for one change: ${lat.join(', ')} ms (median ${lat.sort((a, b) => a - b)[2]} ms, includes polling)`);
  console.log(`      frames sent by A: tx ${sizes('tx').length} × ~${avg(sizes('tx'))} B, presence ${sizes('presence').length} × ~${avg(sizes('presence'))} B, ops ${sizes('ops').length} × ~${avg(sizes('ops'))} B (max ${Math.max(0, ...sizes('ops'))} B)`);
  const pps = sent.filter((m) => m.t === 'presence');
  let maxRate = 0; for (let i = 0; i < pps.length; i++) { const n = pps.filter((m) => m.at >= pps[i].at && m.at < pps[i].at + 1000).length; maxRate = Math.max(maxRate, n); }
  check(`presence is throttled (≤ 15 messages in any second: ${maxRate})`, maxRate <= 15);
  check(`median latency of a committed change ≤ 500 ms`, lat[2] <= 500);
  void dragMs;

  // ---- 2. B draws a wall in Structure mode → A's plan, rooms and 3D update
  const before = await A.page.evaluate(() => ({ walls: window.app.plan.walls.length, rooms: window.app.plan.rooms.length, rebuilds: window.app.view3d.debug ? window.app.view3d.debug.stats().planRebuilds : -1 }));
  const wall = await B.page.evaluate(async () => {
    window.app.store.setUI({ tool: 'structure' });
    const PE = await import('/src/core/plan-edit.js');
    return PE.addWall({ x1: 1000, y1: 135, x2: 1002, y2: 500 });
  });
  check('B draws a partition in Structure mode', wall.ok, wall.reason);
  await A.page.waitForFunction((n) => window.app.plan.walls.length !== n, before.walls, { timeout: 5000 }).catch(() => {});
  await sleep(300);
  const after = await A.page.evaluate(() => ({ walls: window.app.plan.walls.length, rooms: window.app.plan.rooms.length, rebuilds: window.app.view3d.debug ? window.app.view3d.debug.stats().planRebuilds : -1 }));
  const bPlan = await B.page.evaluate(() => ({ walls: window.app.plan.walls.length, rooms: window.app.plan.rooms.length }));
  check('A\'s plan gets the wall and the new room', after.walls === bPlan.walls && after.rooms === bPlan.rooms && after.rooms === before.rooms + 1, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  check('A\'s 3D view rebuilt the house', after.rebuilds > before.rebuilds, `${before.rebuilds} → ${after.rebuilds}`);
  await B.page.evaluate(() => window.app.store.setUI({ tool: 'select' }));

  // ---- 3. both edit different fields of one item at the same time
  sofa.y = await A.page.evaluate((id) => window.app.store.getItem(id).y, sofa.id);
  await Promise.all([
    A.page.evaluate((id) => window.app.store.updateItem(id, { note: 'velvet, green' }), sofa.id),
    B.page.evaluate((id) => window.app.store.updateItem(id, { y: window.app.store.getItem(id).y + 25 }), sofa.id),
  ]);
  await B.page.waitForFunction((id) => window.app.store.getItem(id).note === 'velvet, green', sofa.id, { timeout: 5000 }).catch(() => {});
  await A.page.waitForFunction((y) => window.app.store.items.some((i) => i.y === y), sofa.y + 25, { timeout: 5000 }).catch(() => {});
  const [ia, ib] = await Promise.all([A.page, B.page].map((p) => p.evaluate((id) => { const it = window.app.store.getItem(id); return { note: it.note, y: it.y }; }, sofa.id)));
  check('different fields of one item edited at once: both survive on both screens', ia.note === 'velvet, green' && ib.note === ia.note && ia.y === sofa.y + 25 && ib.y === ia.y, JSON.stringify([ia, ib]));

  // ---- 4. A goes offline, edits, comes back → merged
  await A.context.setOffline(true);
  await A.page.evaluate(() => { const s = window.app.collab.session().client.debug.sock(); if (s) s.close(); });
  await A.page.waitForFunction(() => window.app.collab.session().client.status().state !== 'live', null, { timeout: 5000 });
  const offline = await A.page.evaluate((id) => {
    const st = window.app.store;
    st.updateItem(id, { x: st.getItem(id).x - 40 });
    const it = st.addItem({ type: 'chair', name: 'Offline chair', w: 50, d: 50, h: 80, x: 700, y: 300 });
    return it.id;
  }, sofa.id);
  await B.page.evaluate((id) => window.app.store.updateItem(id, { note: 'velvet, green — confirmed' }), sofa.id);
  await sleep(2500);
  const offText = await statusText(A.page);
  check('A\'s status while offline', /Reconnecting|Offline/.test(offText), offText);
  await A.context.setOffline(false);
  await live(A.page, 2);
  await B.page.waitForFunction((id) => !!window.app.store.getItem(id), offline, { timeout: 10000 }).catch(() => {});
  await sleep(600);
  const [da, db] = await Promise.all([design(A.page), design(B.page)]);
  const merged = await B.page.evaluate(({ id, chair }) => ({ note: window.app.store.getItem(id).note, chair: !!window.app.store.getItem(chair) }), { id: sofa.id, chair: offline });
  check('offline edits merge on reconnect (both sides identical, nothing lost)', da === db && merged.chair && merged.note === 'velvet, green — confirmed', JSON.stringify(merged));

  // ---- 5. a viewer cannot edit
  const V = await openPage(browser, 'vera@example.com', `&online=${id}`);
  await live(V.page, 3);
  check('viewer: "· view only" in the status bar', /view only/.test(await statusText(V.page)), await statusText(V.page));
  const vBefore = await design(B.page);
  await V.page.evaluate((id) => window.app.store.updateItem(id, { x: 0 }), sofa.id);
  await sleep(800);
  check('a viewer\'s edit is undone on their screen and never reaches the others', (await design(B.page)) === vBefore && (await design(V.page)) === vBefore);

  // ---- 6. undo is per person
  await B.page.evaluate((id) => window.app.store.updateItem(id, { rot: 45 }), sofa.id);
  await sleep(500);
  await A.page.evaluate(() => window.app.store.undo());
  await sleep(700);
  const afterUndo = await B.page.evaluate((id) => window.app.store.getItem(id).rot, sofa.id);
  check('A\'s undo does not rewind B\'s change', afterUndo === 45);

  const allErrors = [...A.errors, ...B.errors, ...V.errors];
  check('no console errors on any page', allErrors.length === 0, allErrors.slice(0, 3).join(' | '));
  await browser.close();
}

main().catch((e) => { console.error(e); failed++; }).finally(() => { server.kill(); fs.rmSync(data, { recursive: true, force: true }); console.log(failed ? `\n${failed} check(s) failed` : '\nALL OK'); process.exit(failed ? 1 : 0); });
