// "Import a sketch…" through the real dialog in headless Chromium:
//   1. the lot-98 site-plan PDF (docs/reference): file input → confirm scale 1:100 → orientation → review → create;
//      the new draft project has the built-in house's walls (within 5 cm), 23 openings and 9 rooms; the tracing
//      underlay is stored and aligned with the engine's page → plan transform; the built-in project is untouched;
//      a reload keeps the project and its underlay.
//   2. a PNG rendering of the same page: the flow completes with the low-confidence banner and an underlay.
//   3. a broken file and a password-protected PDF give plain messages; re-align is exercised with real clicks.
//      node tests/import.ui.test.mjs [--shots]      (screenshots → $SHOTS_DIR or dev/screens/import-*.png)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PDF = path.join(root, 'docs/reference/lot-98-site-plan-2026-11-10.pdf');
if (!fs.existsSync(PDF)) { console.log('reference PDF not present: skipped'); process.exit(0); }
const PORT = 5323;
const shots = process.argv.includes('--shots');
const shotDir = process.env.SHOTS_DIR || path.join(root, 'dev', 'screens');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e7-import-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };

// ── wall comparison (as in tests/import.test.mjs): every plan wall equal within 5 cm or covered by the found union ──
function cells(rects, step = 5) {
  const s = new Set();
  for (const r of rects) for (let y = r.y; y < r.y + r.h - 1e-6; y += step) for (let x = r.x; x < r.x + r.w - 1e-6; x += step) s.add(Math.round(x) + ',' + Math.round(y));
  return s;
}
function compareWalls(found, plan, tol = 5) {
  const fu = cells(found);
  const exact = plan.filter((p) => found.some((f) => Math.abs(f.x - p.x) <= tol && Math.abs(f.y - p.y) <= tol && Math.abs(f.x + f.w - p.x - p.w) <= tol && Math.abs(f.y + f.h - p.y - p.h) <= tol));
  const covered = plan.filter((p) => { const c = cells([p]); let n = 0; for (const k of c) if (fu.has(k)) n++; return n >= 0.99 * c.size; });
  const grow = (r) => ({ x: r.x - tol, y: r.y - tol, w: r.w + 2 * tol, h: r.h + 2 * tol });
  const puGrown = cells(plan.map(grow));
  const stickOut = found.filter((f) => [...cells([f])].some((k) => !puGrown.has(k)));
  const within = plan.filter((p) => exact.includes(p) || covered.includes(p));
  return { within: within.length, plan: plan.length, found: found.length, stickOut: stickOut.length };
}

// ── a one-page PDF locked with a user password (standard security handler, revision 2 / RC4 40-bit; pdf-lib cannot
//    encrypt). The page has no content stream, so nothing else needs encrypting. ──
function encryptedPdf(userPw, ownerPw = userPw + '-owner') {
  const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
  const padded = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);
  const md5 = (...b) => crypto.createHash('md5').update(Buffer.concat(b)).digest();
  const rc4 = (key, data) => {
    const s = [...Array(256).keys()]; let j = 0;
    for (let i = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
    const out = Buffer.alloc(data.length); let i = 0; j = 0;
    for (let k = 0; k < data.length; k++) { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; out[k] = data[k] ^ s[(s[i] + s[j]) & 255]; }
    return out;
  };
  const P = -44, id = crypto.randomBytes(16);
  const O = rc4(md5(padded(ownerPw)).subarray(0, 5), padded(userPw));
  const pLE = Buffer.alloc(4); pLE.writeInt32LE(P);
  const U = rc4(md5(padded(userPw), O, pLE, id).subarray(0, 5), PAD);
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P ${P} >>`];
  let body = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, k) => { offs.push(body.length); body += `${k + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const server = spawn(process.execPath, [path.join(root, 'dev', 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
const browser = await chromium.launch();
try {
  await sleep(400);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [], foreign = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(`http://localhost:${PORT}/`) && !/^(data|blob):/.test(u)) foreign.push(u); });

  const boot = async () => {
    const ok = await page.waitForFunction(() => document.documentElement.classList.contains('app-ready') && window.app && window.app.projects && window.app.projects.current(), null, { timeout: 90000 }).then(() => true, () => false);
    await sleep(800);
    await page.getByRole('button', { name: 'Start designing' }).click({ timeout: 5000 }).catch(() => {});
    await sleep(300);
    // anything else still open (a first-run sheet): close it
    for (let i = 0; i < 3 && await page.locator('.scrim').count(); i++) { console.log('      (closing: ' + (await page.locator('.scrim .dialog__title').first().textContent().catch(() => '?')) + ')'); await page.keyboard.press('Escape'); await sleep(300); }
    return ok;
  };
  await page.goto(`http://localhost:${PORT}/index.html`);
  check('app boots', await boot());

  const before = await page.evaluate(() => {
    const a = window.app;
    return { id: a.projects.current().id, builtin: a.projects.current().builtin, walls: a.plan.walls.map(({ x, y, w, h }) => ({ x, y, w, h })), openings: a.plan.openings.length, rooms: a.plan.rooms.length, items: a.store.items.length };
  });
  check('starts on the built-in house', before.builtin, `${before.walls.length} walls, ${before.openings} openings, ${before.rooms} rooms`);

  const W = () => page.evaluate(() => { const d = document.querySelector('.importdlg'); const s = d && d._import && d._import.state; return s ? { ranIn: s.ranIn, step: s.step, busy: s.busy, error: s.error, kind: s.kind, sheet: !!s.sheet, first: !!s.first, result: s.result ? { walls: s.result.walls.length, openings: s.result.openings.length, low: !!s.result.lowConfidence } : null } : null; });
  const until = async (fn, ms = 60000) => { const t0 = Date.now(); for (;;) { const v = await W(); if (v && fn(v)) return v; if (v && v.error) return v; if (Date.now() - t0 > ms) return v; await sleep(200); } };
  const nextBtn = () => page.locator('.importdlg .dialog__foot .btn--primary');

  // ─────────── 1. vector PDF ───────────
  // entry point: the project switcher menu
  await page.locator('.projname--switch').click();
  await page.getByRole('menuitem', { name: /Import a sketch/ }).click();
  await page.waitForSelector('.importdlg', { timeout: 10000 });
  check('dialog opens from the project menu', true);
  check('says the file stays on this device', await page.locator('.importdlg', { hasText: 'stays on this device' }).count() === 1);
  await page.setInputFiles('#import-sketch-file', PDF);
  let st = await until((s) => s.sheet && s.first && !s.busy, 90000);
  check('PDF read, page shown and analysed', st && st.kind === 'pdf' && st.first && !st.error, JSON.stringify(st));
  check('analysis ran in a Web Worker', st && st.ranIn === 'worker', st && st.ranIn);
  await nextBtn().click();
  await page.waitForSelector('.iopts');
  check('scale step offers measuring, 1 : N and a labelled guess',
    await page.locator('.iopt', { hasText: 'Measure a known length' }).count() === 1 && await page.locator('.iopt', { hasText: /Best guess: 1:100/ }).count() === 1,
    await page.locator('.iopt__title').allTextContents().then((t) => t.join(' | ')));
  check('Next is disabled until a scale is chosen', await nextBtn().isDisabled());
  // measure a known length: the house's outer north-west and north-east corners (snapping to the line ends), 15.35 m
  await page.locator('.iopt', { hasText: 'Measure a known length' }).locator('input[type=radio]').check();
  const corners = await page.evaluate(async () => {
    const { affInv, affApply } = await import('/src/ui/import/affine.js');
    const d = document.querySelector('.importdlg'), s = d._import.state, r = s.first;
    const inv = affInv(r.transform), b = r.stats.bounds, rect = d._import.sheet.canvas.getBoundingClientRect();
    return [[b.x, b.y], [b.x + b.w, b.y]].map(([x, y]) => { const p = affApply(inv, x, y), q = d._import.sheet.toScreen(p[0], p[1]); return [rect.left + q[0] + 1, rect.top + q[1] + 1]; });
  });
  await page.mouse.move(corners[0][0] + 20, corners[0][1] + 15);
  await page.mouse.move(corners[0][0], corners[0][1], { steps: 4 });
  if (shots) await page.screenshot({ path: path.join(shotDir, 'import-scale.png') });
  await page.mouse.click(corners[0][0], corners[0][1]);
  await page.mouse.click(corners[1][0], corners[1][1]);
  await page.getByLabel('Real length between the two points in centimetres').fill('1535');
  await sleep(200);
  const measured = await page.locator('.isanity').textContent();
  const mw = Number((/house (\d+\.\d\d) ×/.exec(measured) || [])[1]);
  check('measuring between two snapped corners gives the house size (within 1 %)', Math.abs(mw - 15.35) <= 0.15, measured.trim());
  await page.locator('.iopt', { hasText: 'Type the scale' }).locator('input[type=radio]').check();
  await page.getByLabel('Scale denominator (1 : N)').fill('100');
  await sleep(200);
  const sanity = await page.locator('.isanity').textContent();
  check('sanity read-out shows the house size', /15\.\d\d × 13\.\d\d m/.test(sanity) && /door \d+ cm/.test(sanity), sanity.trim());
  await nextBtn().click();                                   // → orientation
  await page.waitForSelector('.inorth');
  await nextBtn().click();                                   // → analysis → review
  st = await until((s) => s.step === 3 && s.result && !s.busy, 90000);
  check('review shows the detection', st && st.result && st.result.walls > 40 && st.result.openings === 23, JSON.stringify(st && st.result));
  const legend = await page.locator('.ilegend').textContent();
  check('review legend counts walls, doors and windows', /Exterior walls\d+/.test(legend) && /Doors\d+/.test(legend) && /Windows\d+/.test(legend), legend);
  if (shots) await page.screenshot({ path: path.join(shotDir, 'import-review.png') });
  await nextBtn().click();                                   // → create
  await page.waitForSelector('.icreate');
  await page.getByLabel('Project name').fill('Imported lot 98');
  check('create step: no errors from buildPlan', await page.locator('.lvlbanner--locked').count() === 0);
  await nextBtn().click();
  await page.waitForFunction(() => !document.querySelector('.importdlg') && window.app.projects.current().name === 'Imported lot 98', null, { timeout: 30000 }).catch(() => {});
  await sleep(600);

  const after = await page.evaluate(() => {
    const a = window.app;
    const u = a.store.underlay;
    return {
      cur: a.projects.current(), phase: a.store.ui && window.app.projects.current().phase,
      tool: a.store.ui.tool, nextCard: !!document.querySelector('.inext'),
      walls: a.plan.walls.map(({ x, y, w, h }) => ({ x, y, w, h })), openings: a.plan.openings.length, rooms: a.plan.rooms.length,
      underlay: u ? { len: u.image.length, mime: u.image.slice(5, 15), width: u.width, height: u.height, transform: u.transform, visible: u.visible } : null,
      underlayCard: !!document.querySelector('.iunder:not([hidden])'),
    };
  });
  check('a new draft project is open', after.cur.name === 'Imported lot 98' && after.cur.phase === 'draft' && after.cur.id !== before.id, JSON.stringify(after.cur));
  check('Structure mode with the "what next" card', after.tool === 'structure' && after.nextCard, after.tool);
  const cw = compareWalls(after.walls, before.walls);
  check('walls = the built-in house within 5 cm', cw.within === cw.plan && cw.stickOut === 0, JSON.stringify(cw));
  check('23 openings', after.openings === 23, String(after.openings));
  check('9 rooms', after.rooms === 9, String(after.rooms));
  check('underlay stored (compact WebP / JPEG)', after.underlay && /image\/(webp|jpeg)/.test(after.underlay.mime) && after.underlay.len < 2.5e6 && Math.max(after.underlay.width, after.underlay.height) <= 2400,
    after.underlay && `${after.underlay.mime} ${after.underlay.width}×${after.underlay.height}, ${Math.round(after.underlay.len / 1024)} kB`);
  check('underlay card in the Structure guide', after.underlayCard);

  // alignment: along a line across the north wall, the dark ink of the stored underlay sits where the page rendered with
  // the engine's own page → plan transform has it (the engine run independently here, at 1:100)
  const align = await page.evaluate(async (pdfUrl) => {
    const eng = await import('/src/import/index.js');
    const { affInv, affApply, affThen } = await import('/src/ui/import/affine.js');
    const bytes = new Uint8Array(await (await fetch(pdfUrl)).arrayBuffer());
    const res = await eng.importPdfSketch(bytes, { scale: { cmPerUnit: 100 * 2.54 / 72 } });
    const p0 = 3, pageCanvas = document.createElement('canvas');
    await eng.renderPdfPage(bytes, { pxPerUnit: p0, canvas: pageCanvas });
    const u = window.app.store.underlay;
    const img = new Image(); img.src = u.image; await img.decode();
    const uc = document.createElement('canvas'); uc.width = img.naturalWidth; uc.height = img.naturalHeight; uc.getContext('2d').drawImage(img, 0, 0);
    const dark = (canvas, M, x, y) => { const [px, py] = affApply(M, x, y); const d = canvas.getContext('2d').getImageData(Math.round(px), Math.round(py), 1, 1).data; return 255 - (d[0] + d[1] + d[2]) / 3; };
    const Mpage = affThen(affInv(res.transform), [p0, 0, 0, p0, 0, 0]), Mu = affInv(u.transform);
    // the longest exterior wall running east–west on the north side
    const w = window.app.plan.walls.filter((q) => q.w > q.h && q.y < 50).sort((a, b) => b.w - a.w)[0];
    const out = [];
    for (const fx of [0.3, 0.5, 0.7]) {
      const x = w.x + w.w * fx;
      if (window.app.plan.openings.some((o) => x >= o.x - 10 && x <= o.x + o.w + 10)) continue;
      const prof = (canvas, M) => { const v = []; for (let y = w.y - 30; y <= w.y + w.h + 30; y += 1) v.push([y, dark(canvas, M, x, y)]); return v; };
      const centroid = (v) => { const hi = v.filter(([, d]) => d > 90); return hi.length ? hi.reduce((t, [y]) => t + y, 0) / hi.length : null; };
      const edges = (v) => { const hi = v.filter(([, d]) => d > 90).map(([y]) => y); return hi.length ? [Math.min(...hi), Math.max(...hi)] : null; };
      const a = prof(pageCanvas, Mpage), b = prof(uc, Mu);
      out.push({ x, page: centroid(a), underlay: centroid(b), pageEdges: edges(a), underlayEdges: edges(b) });
    }
    return { wall: w, samples: out, firstWall: res.walls[0] };
  }, `/docs/reference/${path.basename(PDF)}`);
  const ok = align.samples.length >= 2 && align.samples.every((s) => s.page != null && s.underlay != null && Math.abs(s.page - s.underlay) <= 3);
  check('underlay aligned with the engine’s page → plan transform (within 3 cm)', ok, JSON.stringify(align.samples.map((s) => ({ x: Math.round(s.x), page: s.page && +s.page.toFixed(1), underlay: s.underlay && +s.underlay.toFixed(1), edges: s.underlayEdges })) ) + ` wall y ${align.wall.y}`);
  if (shots) await page.screenshot({ path: path.join(shotDir, 'import-draft.png') });

  // the built-in project is untouched
  const builtin = await page.evaluate(async (id) => {
    const rec = await window.app.projects.adapter.get(id);
    const { BUILTIN_PLAN } = await import('/src/core/plan-edit.js');
    return rec ? { same: JSON.stringify(rec.basePlan) === JSON.stringify(BUILTIN_PLAN), items: rec.design.items.length, underlay: !!rec.underlay, phase: rec.phase } : null;
  }, before.id);
  check('built-in project untouched', builtin && builtin.same && builtin.items === before.items && !builtin.underlay && builtin.phase === 'fixed', JSON.stringify(builtin));

  // export file carries the underlay; reload keeps project + underlay
  const exp = await page.evaluate(async () => { const r = await window.app.projects.exportFile(); const f = JSON.parse(r.text); return { ok: r.ok, underlay: !!(f.project.underlay && f.project.underlay.image) }; });
  check('project file includes the underlay', exp.ok && exp.underlay);
  await page.evaluate(() => window.app.projects.flush());
  await page.reload();
  await boot();
  const reloaded = await page.evaluate(() => ({ name: window.app.projects.current().name, phase: window.app.projects.current().phase, walls: window.app.plan.walls.length, openings: window.app.plan.openings.length, underlay: !!(window.app.store.underlay && window.app.store.underlay.image), t: window.app.store.underlay && window.app.store.underlay.transform }));
  check('reload keeps the project and the underlay', reloaded.name === 'Imported lot 98' && reloaded.phase === 'draft' && reloaded.walls === after.walls.length && reloaded.openings === 23 && reloaded.underlay && JSON.stringify(reloaded.t) === JSON.stringify(after.underlay.transform), JSON.stringify({ ...reloaded, t: undefined }));
  const exported = await page.evaluate(() => { const v = window.app.view2d; return v && v._debug ? 'n/a' : 'n/a'; });
  void exported;
  // the underlay is never painted into exports
  const exportClean = await page.evaluate(async () => {
    const { underlayShown } = await import('/src/view2d/underlay.js');
    return underlayShown({ store: window.app.store, exporting: true }) === false && underlayShown({ store: window.app.store }) === true;
  });
  check('underlay is skipped when exporting', exportClean);

  // re-align (Structure guide → Sketch underlay → Re-align…) with real clicks: two-point scale, point → wall corner move,
  // Reset / Cancel leave the stored transform alone, Apply offers Undo in its toast (the underlay is outside the history)
  {
    const T0 = await page.evaluate(() => window.app.store.underlay.transform);
    const openRealign = async () => { await page.getByRole('button', { name: 'Re-align…' }).click(); await page.waitForSelector('.importdlg--realign'); await sleep(500); };
    const dlgR = page.locator('.importdlg--realign');
    const toScr = (pp) => page.evaluate(async (pp) => {
      const { affInv, affApply } = await import('/src/ui/import/affine.js');
      const R = document.querySelector('.importdlg--realign')._realign, inv = affInv(R.transform), rect = R.sheet.canvas.getBoundingClientRect();
      return pp.map(([x, y]) => { const p = affApply(inv, x, y), q = R.sheet.toScreen(p[0], p[1]); return [rect.left + q[0], rect.top + q[1]]; });
    }, pp);
    const T = () => page.evaluate(() => document.querySelector('.importdlg--realign')._realign.transform);
    const ap = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
    const det = T0[0] * T0[3] - T0[1] * T0[2];
    const inv0 = (X, Y) => [(T0[3] * (X - T0[4]) - T0[2] * (Y - T0[5])) / det, (-T0[1] * (X - T0[4]) + T0[0] * (Y - T0[5])) / det];
    const near = (p, q, tol = 1) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
    const nw = inv0(0, 0), ne = inv0(1535, 0);           // drawing points now under the plan's outer NW / NE corners
    await openRealign();
    await dlgR.getByRole('button', { name: 'Pick two points' }).click();
    let [a, b] = await toScr([[0, 0], [1535, 0]]);
    await page.mouse.click(a[0], a[1]); await page.mouse.click(b[0], b[1]);
    await page.getByLabel('Real distance in centimetres').fill('3070');
    await dlgR.getByRole('button', { name: 'Scale the sketch' }).click();
    let t = await T();
    check('re-align: two-point scale doubles about the first point', near(ap(t, ...nw), [0, 0]) && near(ap(t, ...ne), [3070, 0]), JSON.stringify(t));
    await dlgR.getByRole('button', { name: 'Reset', exact: true }).click();
    check('re-align: Reset restores the stored alignment', JSON.stringify(await T()) === JSON.stringify(T0));
    await dlgR.getByRole('button', { name: 'Pick the points' }).click();
    [a] = await toScr([[0, 0]]); await page.mouse.click(a[0], a[1]);
    [b] = await toScr([[933, 4]]); await page.mouse.click(b[0], b[1]);       // a few cm off the plan corner (930, 0): snaps
    t = await T();
    check('re-align: a drawing point moved onto a wall corner (snapped)', near(ap(t, ...nw), [930, 0]), JSON.stringify(ap(t, ...nw)));
    await dlgR.getByRole('button', { name: 'Cancel' }).click(); await sleep(300);
    check('re-align: Cancel keeps the stored alignment', JSON.stringify(await page.evaluate(() => window.app.store.underlay.transform)) === JSON.stringify(T0));
    await openRealign();
    await dlgR.getByRole('button', { name: 'Pick the points' }).click();
    [a] = await toScr([[0, 0]]); await page.mouse.click(a[0], a[1]);
    [b] = await toScr([[1535, 0]]); await page.mouse.click(b[0], b[1]);
    await dlgR.getByRole('button', { name: 'Apply' }).click(); await sleep(300);
    const T1 = await page.evaluate(() => window.app.store.underlay.transform);
    check('re-align: Apply stores the move', near(ap(T1, ...nw), [1535, 0]), JSON.stringify(T1));
    await page.locator('.toast__action', { hasText: 'Undo' }).click(); await sleep(200);
    check('re-align: the toast’s Undo puts the sketch back', JSON.stringify(await page.evaluate(() => window.app.store.underlay.transform)) === JSON.stringify(T0));
  }

  // ─────────── 2. raster: a PNG rendering of the page ───────────
  const pngB64 = await page.evaluate(async (pdfUrl) => {
    const eng = await import('/src/import/index.js');
    const bytes = new Uint8Array(await (await fetch(pdfUrl)).arrayBuffer());
    const c = document.createElement('canvas');
    await eng.renderPdfPage(bytes, { pxPerUnit: 150 / 72, canvas: c });          // 150 dpi
    return c.toDataURL('image/png').split(',')[1];
  }, `/docs/reference/${path.basename(PDF)}`);
  const PNG = path.join(tmp, 'lot-98-plan.png');
  fs.writeFileSync(PNG, Buffer.from(pngB64, 'base64'));
  // entry point: New project → "From a sketch (PDF or image)"
  await page.locator('.inext .btn--primary').click().catch(() => {});
  await page.evaluate(() => window.app.store.setUI({ tool: 'select' }));
  await sleep(300);
  await page.locator('.projname--switch').click();
  await page.getByRole('menuitem', { name: /New project/ }).click();
  await page.getByRole('radio', { name: 'From a sketch (PDF or image)' }).click();
  await page.getByRole('button', { name: 'Choose the drawing…' }).click();
  await page.waitForSelector('.importdlg');
  check('New project → From a sketch opens the import', true);
  await page.setInputFiles('#import-sketch-file', PNG);
  st = await until((s) => s.sheet && !s.busy, 60000);
  check('PNG read', st && st.kind === 'image' && !st.error, JSON.stringify(st));
  await nextBtn().click();
  await page.locator('.iopt', { hasText: 'Type the scale' }).locator('input[type=radio]').check();
  await page.getByLabel('Scale denominator (1 : N)').fill('100');
  await page.getByLabel('Scan resolution in dots per inch').fill('150');
  await sleep(150);
  await nextBtn().click();
  await page.waitForSelector('.inorth');
  await nextBtn().click();
  st = await until((s) => s.step === 3 && s.result && !s.busy, 120000);
  check('raster review reached', st && st.step === 3 && st.result && st.result.low, JSON.stringify(st && st.result));
  check('low-confidence banner shown', await page.locator('.ibanner', { hasText: 'A starting point to trace over' }).count() === 1);
  await nextBtn().click();
  await page.waitForSelector('.icreate');
  await page.getByLabel('Project name').fill('Traced photo');
  await nextBtn().click();
  await page.waitForFunction(() => !document.querySelector('.importdlg') && window.app.projects.current().name === 'Traced photo', null, { timeout: 30000 }).catch(() => {});
  const raster = await page.evaluate(() => ({ name: window.app.projects.current().name, phase: window.app.projects.current().phase, walls: window.app.plan.walls.length, underlay: !!(window.app.store.underlay && window.app.store.underlay.image), low: !!(window.app.store.underlay && window.app.store.underlay.source && window.app.store.underlay.source.lowConfidence) }));
  check('raster flow creates a draft with an underlay', raster.name === 'Traced photo' && raster.phase === 'draft' && raster.underlay && raster.low, JSON.stringify(raster));

  // ─────────── 3. a file that is not a drawing, then a picture with nothing to find → an empty draft to trace over ───────────
  const BAD = path.join(tmp, 'notes.pdf'), BLANK = path.join(tmp, 'blank.png');
  fs.writeFileSync(BAD, 'this is not a PDF');
  fs.writeFileSync(BLANK, Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900); return c.toDataURL('image/png').split(',')[1]; }), 'base64'));
  await page.locator('.inext .btn--primary').click().catch(() => {});
  await page.evaluate(() => window.app.store.setUI({ tool: 'select' }));
  await sleep(300);
  await page.locator('.projname--switch').click();
  await page.getByRole('menuitem', { name: /Import a sketch/ }).click();
  await page.waitForSelector('.importdlg');
  await page.setInputFiles('#import-sketch-file', BAD);
  st = await until((s) => !s.busy && s.error, 20000);
  check('a broken file gives a plain message, not a stuck dialog', st && /could not be read as a PDF/.test(st.error) && !st.busy, st && st.error);
  const LOCKED = path.join(tmp, 'locked.pdf');
  fs.writeFileSync(LOCKED, encryptedPdf('open-sesame'));
  await page.setInputFiles('#import-sketch-file', LOCKED);
  st = await until((s) => !s.busy && s.error, 20000);
  check('a password-protected PDF gives the plain message', st && /password-protected/.test(st.error) && !st.busy, st && st.error);
  await page.setInputFiles('#import-sketch-file', BLANK);
  st = await until((s) => s.sheet && !s.busy, 30000);
  await nextBtn().click();
  await page.locator('.iopt', { hasText: 'Type the scale' }).locator('input[type=radio]').check();
  await page.getByLabel('Scale denominator (1 : N)').fill('100');
  await nextBtn().click();
  await page.waitForSelector('.inorth');
  await nextBtn().click();
  st = await until((s) => s.step === 3 && s.result && !s.busy, 60000);
  check('nothing found: the review says the project is still created', await page.locator('.callout', { hasText: 'Nothing to convert automatically' }).count() === 1);
  await nextBtn().click();
  await page.waitForSelector('.icreate');
  await page.getByLabel('Project name').fill('Blank trace');
  await nextBtn().click();
  await page.waitForFunction(() => !document.querySelector('.importdlg') && window.app.projects.current().name === 'Blank trace', null, { timeout: 30000 }).catch(() => {});
  const blank = await page.evaluate(() => ({ name: window.app.projects.current().name, phase: window.app.projects.current().phase, walls: window.app.plan.walls.length, underlay: !!(window.app.store.underlay && window.app.store.underlay.image), lot: window.app.plan.site.bounds }));
  check('…an empty draft with the underlay, the lot covering the picture', blank.name === 'Blank trace' && blank.phase === 'draft' && blank.walls === 0 && blank.underlay && blank.lot.w > 1500, JSON.stringify(blank));

  // ─────────── 4. phone (390 × 800, touch): pinch zooms, two fingers pan, one finger picks a snapped corner ───────────
  {
    const pctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const pp = await pctx.newPage();
    pp.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
    await pp.goto(`http://localhost:${PORT}/index.html`);
    await pp.waitForFunction(() => document.documentElement.classList.contains('app-ready') && window.app && window.app.projects && window.app.projects.current(), null, { timeout: 90000 });
    await sleep(800);
    await pp.getByRole('button', { name: 'Start designing' }).tap({ timeout: 5000 }).catch(() => {});
    for (let i = 0; i < 3 && await pp.locator('.scrim').count(); i++) { await pp.keyboard.press('Escape'); await sleep(300); }
    await pp.getByRole('button', { name: 'File and export' }).tap(); await sleep(300);
    await pp.locator('.menu__item', { hasText: 'Projects' }).first().tap(); await sleep(300);
    await pp.locator('.menu__item', { hasText: /Import a sketch/ }).first().tap();
    await pp.waitForSelector('.importdlg');
    await pp.setInputFiles('#import-sketch-file', PDF);
    await pp.waitForFunction(() => { const s = document.querySelector('.importdlg')?._import?.state; return s && s.sheet && s.first && !s.busy; }, null, { timeout: 90000 });
    await pp.locator('.importdlg .dialog__foot .btn--primary').tap();
    await pp.locator('.iopt', { hasText: 'Measure a known length' }).locator('input[type=radio]').check();
    await sleep(300);
    const cdp = await pctx.newCDPSession(pp);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    const geo = () => pp.evaluate(async () => {
      const { affInv, affApply } = await import('/src/ui/import/affine.js');
      const d = document.querySelector('.importdlg'), r = d._import.state.first, b = r.stats.bounds, rect = d._import.sheet.canvas.getBoundingClientRect();
      const inv = affInv(r.transform);
      return { rect: [rect.left, rect.top, rect.width, rect.height], c: [[b.x, b.y], [b.x + b.w, b.y]].map(([x, y]) => { const p = affApply(inv, x, y), q = d._import.sheet.toScreen(p[0], p[1]); return [rect.left + q[0], rect.top + q[1]]; }) };
    });
    const g0 = await geo(), [L, T, Wd, Ht] = g0.rect, mid = [L + Wd / 2, T + Ht / 2];
    await touch('touchStart', [[mid[0] - 40, mid[1]], [mid[0] + 40, mid[1]]]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[mid[0] - 40 - 12 * i, mid[1]], [mid[0] + 40 + 12 * i, mid[1]]]);
    await touch('touchEnd', []);
    await sleep(150);
    const g1 = await geo(), f = (g1.c[1][0] - g1.c[0][0]) / (g0.c[1][0] - g0.c[0][0]);
    const tgt = [L + Wd * 0.35, T + Ht * 0.7], dx = tgt[0] - g1.c[0][0], dy = tgt[1] - g1.c[0][1];
    await touch('touchStart', [[mid[0] - 30, mid[1]], [mid[0] + 30, mid[1]]]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[mid[0] - 30 + dx * i / 8, mid[1] + dy * i / 8], [mid[0] + 30 + dx * i / 8, mid[1] + dy * i / 8]]);
    await touch('touchEnd', []);
    await sleep(150);
    const g2 = await geo();
    check('phone: pinch zooms the drawing', f > 2, f.toFixed(2));
    check('phone: two fingers pan it (while picking)', Math.hypot(g2.c[0][0] - tgt[0], g2.c[0][1] - tgt[1]) < 3, JSON.stringify(g2.c[0]));
    const c0 = g2.c[0];
    await touch('touchStart', [[c0[0] + 14, c0[1] + 11]]);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [[c0[0] + 14 - 2.6 * i, c0[1] + 11 - 2 * i]]);
    await touch('touchEnd', []);
    await sleep(200);
    const picked = await pp.evaluate(() => document.querySelector('.importdlg')._import.state.measure.pts);
    const want = await pp.evaluate(async () => {
      const { affInv, affApply } = await import('/src/ui/import/affine.js');
      const r = document.querySelector('.importdlg')._import.state.first;
      return affApply(affInv(r.transform), r.stats.bounds.x, r.stats.bounds.y);
    });
    check('phone: a finger slid onto the corner picks it (no pick from the gestures)', picked.length === 1 && Math.hypot(picked[0][0] - want[0], picked[0][1] - want[1]) < 1.5, JSON.stringify({ picked, want }));
    const lay = await pp.evaluate(() => ({ scroll: document.scrollingElement.scrollTop + document.documentElement.scrollWidth - innerWidth,
      foot: [...document.querySelectorAll('.importdlg .dialog__foot button')].filter((b) => b.offsetWidth).every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }) }));
    check('phone: no page scroll, footer buttons on screen', lay.scroll === 0 && lay.foot, JSON.stringify(lay));
    await pctx.close();
  }

  check('no request left this machine', foreign.length === 0, foreign.join(' '));
  check('no errors in the console', errors.length === 0, errors.slice(0, 5).join(' | '));
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `${failed} FAILED` : 'IMPORT UI OK');
process.exit(failed ? 1 : 0);
