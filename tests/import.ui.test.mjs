// "Import a sketch…" through the real dialog in headless Chromium:
//   1. the lot-98 site-plan PDF (docs/reference): file input → confirm scale 1:100 → orientation → review → create;
//      the new draft project has the built-in house's walls (within 5 cm), 23 openings and 9 rooms; the tracing
//      underlay is stored and aligned with the engine's page → plan transform; the built-in project is untouched;
//      a reload keeps the project and its underlay.
//   2. a PNG rendering of the same page: the flow completes with the low-confidence banner and an underlay.
//   3. a broken file and a password-protected PDF give plain messages; re-align is exercised with real clicks.
//   3b. a DXF of the built-in house (Hebrew layers, code page 1255): an unreadable DWG gets the short "save it as DXF"
//       note, binary DXF refused, layer panel pre-ticked, units read, project created with walls within 1 cm and a DXF
//       rendering as the underlay.
//   3b2. a real DWG of the built-in house (tests/fixtures/dwg/house-cm-2018.dwg, read by LibreDWG in the worker): layer
//       panel, units from the file, project created with walls within 1 cm and 23 openings.
//   5. several floors (stage F8): the Duplex as two plans in one DXF — switch off: no floor list; ?levels=1: the second
//      drawing added as a floor, reordered, Align floors (proposal, arrow keys, drag, Match two points), Review with the
//      engine's stair, Create → 2 floors, the stair and its void, one underlay per floor (aligned, shown per floor), reload.
//      node tests/import.ui.test.mjs [--shots]      (screenshots → $SHOTS_DIR or dev/screens/import-*.png)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { houseDxf } from './dxf-fixtures.mjs';

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

// ── a one-page vector PDF of the Wedge drawing at 1 : S on a 842 × 595 pt page (wall lines 0.7 pt, symbols 0.18 pt, door swings
//    as Bézier arcs, "SCALE 1:S" text, a small title block so the page reads as a drawing) ──
function wedgePdf(d, S) {
  const k = 1 / (S * 2.54 / 72), X = (x) => (60 + x * k).toFixed(2), Y = (y) => (595 - (80 + y * k)).toFixed(2);
  const ops = ['0 0 0 RG', '0.7 w'];
  for (const [x1, y1, x2, y2] of d.lines) ops.push(`${X(x1)} ${Y(y1)} m ${X(x2)} ${Y(y2)} l S`);
  ops.push('0.18 w');
  for (const [x1, y1, x2, y2] of [...d.winLines, ...d.doorLines]) ops.push(`${X(x1)} ${Y(y1)} m ${X(x2)} ${Y(y2)} l S`);
  for (const a of d.arcs) {
    const n = Math.max(1, Math.ceil(Math.abs(a.a1 - a.a0) / 90 - 1e-9));
    for (let i = 0; i < n; i++) {
      const t0 = (a.a0 + (a.a1 - a.a0) * i / n) * Math.PI / 180, t1 = (a.a0 + (a.a1 - a.a0) * (i + 1) / n) * Math.PI / 180, hh = 4 / 3 * Math.tan((t1 - t0) / 4);
      const p0 = [a.cx + a.r * Math.cos(t0), a.cy + a.r * Math.sin(t0)], p3 = [a.cx + a.r * Math.cos(t1), a.cy + a.r * Math.sin(t1)];
      const p1 = [p0[0] - hh * a.r * Math.sin(t0), p0[1] + hh * a.r * Math.cos(t0)], p2 = [p3[0] + hh * a.r * Math.sin(t1), p3[1] - hh * a.r * Math.cos(t1)];
      ops.push(`${X(p0[0])} ${Y(p0[1])} m ${X(p1[0])} ${Y(p1[1])} ${X(p2[0])} ${Y(p2[1])} ${X(p3[0])} ${Y(p3[1])} c S`);
    }
  }
  for (let i = 0; i < 12; i++) ops.push(`${690 + i * 10} 30 m ${690 + i * 10} 62 l S`);   // title block ticks
  ops.push('BT /F1 9 Tf 700 40 Td (SCALE 1:' + S + ') Tj ET');
  const stream = ops.join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let body = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
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

  // ─────────── 3b. AutoCAD DXF (Hebrew layer names, code page 1255): layer panel, units, create, underlay ───────────
  {
    const DXF = path.join(tmp, 'house-he.dxf'), DWG = path.join(tmp, 'house.dwg'), BIN = path.join(tmp, 'binary.dxf');
    fs.writeFileSync(DXF, houseDxf({ unit: 1, insunits: 5, version: 'AC1015', codepage: 'ANSI_1255', names: { wall: 'קירות', door: 'דלתות', window: 'חלונות', dim: 'מידות', furn: 'ריהוט' }, title: 'תכנית קומת קרקע' }).bytes());
    fs.writeFileSync(DWG, Buffer.concat([Buffer.from('AC1032'), Buffer.alloc(64)]));
    fs.writeFileSync(BIN, Buffer.concat([Buffer.from('AutoCAD Binary DXF\r\n\x1a\0', 'latin1'), Buffer.alloc(64)]));
    await page.locator('.inext .btn--primary').click().catch(() => {});
    await page.evaluate(() => window.app.store.setUI({ tool: 'select' }));
    await sleep(300);
    await page.locator('.projname--switch').click();
    await page.getByRole('menuitem', { name: /Import a sketch/ }).click();
    await page.waitForSelector('.importdlg');
    check('DXF: the file picker accepts .dxf and .dwg', await page.evaluate(() => /\.dxf/.test(document.querySelector('#import-sketch-file').accept) && /\.dwg/.test(document.querySelector('#import-sketch-file').accept)));
    await page.setInputFiles('#import-sketch-file', DWG);
    st = await until((s) => !s.busy && s.error, 60000);
    await sleep(300);
    const dwg = await page.locator('.idwg').textContent().catch(() => '');
    // (DWG files are read since § 11.2; this one is only a header followed by zeros, so it cannot be)
    check('an unreadable DWG: plain message and the short "save it as DXF" note, Next stays off', st && st.kind === 'dwg' && /could not be read/.test(st.error) && /save it as DXF/.test(dwg) && /Save As/.test(dwg) && await nextBtn().isDisabled(), `${st && st.error} | ${dwg.slice(0, 80)}`);
    await page.setInputFiles('#import-sketch-file', BIN);
    st = await until((s) => !s.busy && s.error, 20000);
    check('binary DXF: plain message', st && /binary DXF/.test(st.error), st && st.error);
    await page.setInputFiles('#import-sketch-file', DXF);
    st = await until((s) => s.sheet && s.first && !s.busy, 60000);
    check('DXF read in the worker, drawn and analysed', st && st.kind === 'dxf' && !st.error && st.ranIn === 'worker', JSON.stringify(st));
    const layers = await page.evaluate(() => [...document.querySelectorAll('.ilayers__row')].map((r) => ({ name: r.dataset.layer, role: r.querySelector('select').value, dir: getComputedStyle(r.querySelector('.ilayers__name')).direction, text: r.querySelector('.ilayers__name').textContent })));
    const role = (n) => (layers.find((l) => l.name === n) || {}).role;
    check('DXF: layer panel with the proposal pre-ticked (walls / doors / windows / other)', role('קירות') === 'wall' && role('דלתות') === 'door' && role('חלונות') === 'window' && role('ריהוט') === 'other', JSON.stringify(layers));
    check('DXF: Hebrew layer names shown as they are', layers.some((l) => l.text === 'קירות'));
    await page.locator('.ilayers__row', { hasText: 'דלתות' }).hover();
    await sleep(300);
    check('DXF: pointing at a layer highlights it on the drawing', await page.evaluate(() => document.querySelector('.importdlg')._import.state.dxf.highlight === 'דלתות' && !!document.querySelector('.ilayers__row.is-hl')));
    if (shots) await page.screenshot({ path: path.join(shotDir, 'import-dxf-layers.png') });
    await nextBtn().click();
    await page.waitForSelector('.iopts');
    const first = (await page.locator('.iopt__title').first().textContent()).trim();
    const on = await page.locator('.iopt.is-on .iopt__title').textContent().catch(() => '');
    const sanityDxf = await page.locator('.isanity').textContent();
    check('DXF scale: first option reads the file\'s units, chosen, with the live read-out', first === 'The file is drawn in centimetres (1 unit = 1 cm)' && on.trim() === first && /15\.35 × 13\.80 m/.test(sanityDxf), `${first} | ${sanityDxf.trim()}`);
    await nextBtn().click();
    await page.waitForSelector('.inorth');
    await nextBtn().click();
    st = await until((s) => s.step === 3 && s.result && !s.busy, 60000);
    check('DXF review: walls and 23 openings', st && st.result && st.result.walls > 40 && st.result.openings === 23, JSON.stringify(st && st.result));
    await nextBtn().click();
    await page.waitForSelector('.icreate');
    await page.getByLabel('Project name').fill('Imported DXF');
    await nextBtn().click();
    await page.waitForFunction(() => !document.querySelector('.importdlg') && window.app.projects.current().name === 'Imported DXF', null, { timeout: 30000 }).catch(() => {});
    await sleep(600);
    const dx = await page.evaluate(() => {
      const a = window.app, u = a.store.underlay;
      return { name: a.projects.current().name, walls: a.plan.walls.map(({ x, y, w, h }) => ({ x, y, w, h })), openings: a.plan.openings.length, rooms: a.plan.rooms.length,
        underlay: u ? { kind: u.source.kind, width: u.width, height: u.height, transform: u.transform, mime: u.image.slice(5, 15) } : null };
    });
    // every coordinate is on the 5 cm grid, so "within 1 cm" means the same wall area cell for cell
    const cwd = compareWalls(dx.walls, before.walls, 5), fu = cells(dx.walls), pu = cells(before.walls);
    const symd = [...fu].filter((k) => !pu.has(k)).length + [...pu].filter((k) => !fu.has(k)).length;
    check('DXF project: walls = the built-in house within 1 cm (identical wall area)', dx.name === 'Imported DXF' && cwd.within === cwd.plan && cwd.stickOut === 0 && symd === 0, JSON.stringify({ ...cwd, symDiffCells: symd }));
    check('DXF project: 23 openings, 9 rooms', dx.openings === 23 && dx.rooms === 9, `${dx.openings} / ${dx.rooms}`);
    check('DXF project: underlay is a rendering of the DXF', dx.underlay && dx.underlay.kind === 'dxf' && /image\/(webp|jpeg)/.test(dx.underlay.mime) && Math.max(dx.underlay.width, dx.underlay.height) <= 2400, JSON.stringify(dx.underlay));
    // the underlay's ink sits on the wall faces: across the longest north wall, dark pixels at y ≈ 0 and y ≈ thickness
    const ink = await page.evaluate(async () => {
      const { affInv, affApply } = await import('/src/ui/import/affine.js');
      const u = window.app.store.underlay, img = new Image(); img.src = u.image; await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
      const M = affInv(u.transform), g = c.getContext('2d');
      const w = window.app.plan.walls.filter((q) => q.w > q.h && q.y < 50).sort((a, b) => b.w - a.w)[0];
      const out = [];
      for (const fx of [0.3, 0.5, 0.7]) {
        const x = w.x + w.w * fx;
        if (window.app.plan.openings.some((o) => x >= o.x - 10 && x <= o.x + o.w + 10)) continue;
        const dark = [];
        for (let y = w.y - 30; y <= w.y + w.h + 30; y += 0.5) { const [px, py] = affApply(M, x, y); const d = g.getImageData(Math.round(px), Math.round(py), 1, 1).data; if (255 - (d[0] + d[1] + d[2]) / 3 > 90) dark.push(y); }
        out.push({ x, top: dark.length ? Math.min(...dark) : null, bottom: dark.length ? Math.max(...dark) : null, wy: w.y, wh: w.h });
      }
      return out;
    });
    check('DXF underlay aligned with the walls (ink on both faces within 3 cm)', ink.length >= 2 && ink.every((s) => s.top != null && Math.abs(s.top - s.wy) <= 3 && Math.abs(s.bottom - (s.wy + s.wh)) <= 3), JSON.stringify(ink));
    if (shots) await page.screenshot({ path: path.join(shotDir, 'import-dxf-draft.png') });
  }

  // ─────────── 3b2. AutoCAD DWG (2018 format), read by LibreDWG in the worker: the same DXF path ───────────
  {
    const DWGF = path.join(root, 'tests/fixtures/dwg/house-cm-2018.dwg');
    await page.locator('.projname--switch').click();
    await page.getByRole('menuitem', { name: /Import a sketch/ }).click();
    await page.waitForSelector('.importdlg');
    const hint = await page.locator('.idrop__title').textContent();
    check('DWG: the drop zone lists DWG among the file types', /DWG/.test(hint), hint);
    await page.setInputFiles('#import-sketch-file', DWGF);
    st = await until((s) => s.sheet && s.first && !s.busy, 90000);
    const facts = await page.locator('.idrop__text').textContent();
    check('DWG read in the worker and drawn like a DXF', st && st.kind === 'dxf' && !st.error && st.ranIn === 'worker' && /AutoCAD DWG \(2018 and later format\)/.test(facts) && /drawn in centimetres/.test(facts), `${JSON.stringify(st)} | ${facts}`);
    check('DWG: no "save it as DXF" note when the file reads', await page.locator('.idwg').count() === 0);
    const layers = await page.evaluate(() => [...document.querySelectorAll('.ilayers__row')].map((r) => ({ name: r.dataset.layer, role: r.querySelector('select').value })));
    const role = (n) => (layers.find((l) => l.name === n) || {}).role;
    check('DWG: layer panel with the proposal pre-ticked', role('A-WALL') === 'wall' && role('A-DOOR') === 'door' && role('A-GLAZ') === 'window' && role('I-FURN') === 'other', JSON.stringify(layers));
    if (shots) await page.screenshot({ path: path.join(shotDir, 'import-dwg-layers.png') });
    await nextBtn().click();
    await page.waitForSelector('.iopts');
    const first = (await page.locator('.iopt__title').first().textContent()).trim();
    const firstText = await page.locator('.iopt').first().textContent();
    check('DWG scale: the file\'s units, chosen', first === 'The file is drawn in centimetres (1 unit = 1 cm)' && /The DWG says so/.test(firstText), `${first} | ${firstText.slice(0, 120)}`);
    await nextBtn().click();
    await page.waitForSelector('.inorth');
    await nextBtn().click();
    st = await until((s) => s.step === 3 && s.result && !s.busy, 60000);
    check('DWG review: walls and 23 openings', st && st.result && st.result.walls > 40 && st.result.openings === 23, JSON.stringify(st && st.result));
    await nextBtn().click();
    await page.waitForSelector('.icreate');
    await page.getByLabel('Project name').fill('Imported DWG');
    await nextBtn().click();
    await page.waitForFunction(() => !document.querySelector('.importdlg') && window.app.projects.current().name === 'Imported DWG', null, { timeout: 30000 }).catch(() => {});
    await sleep(600);
    const dw = await page.evaluate(() => {
      const a = window.app, u = a.store.underlay;
      return { name: a.projects.current().name, walls: a.plan.walls.map(({ x, y, w, h }) => ({ x, y, w, h })), openings: a.plan.openings.length, rooms: a.plan.rooms.length, underlay: u ? { kind: u.source.kind, name: u.source.name } : null };
    });
    const cw2 = compareWalls(dw.walls, before.walls, 5), fu2 = cells(dw.walls), pu2 = cells(before.walls);
    const symd2 = [...fu2].filter((k) => !pu2.has(k)).length + [...pu2].filter((k) => !fu2.has(k)).length;
    check('DWG project: walls = the built-in house within 1 cm (identical wall area)', dw.name === 'Imported DWG' && cw2.within === cw2.plan && cw2.stickOut === 0 && symd2 === 0, JSON.stringify({ ...cw2, symDiffCells: symd2 }));
    check('DWG project: 23 openings, 9 rooms, the drawing as the underlay', dw.openings === 23 && dw.rooms === 9 && dw.underlay && dw.underlay.name === 'house-cm-2018.dwg', JSON.stringify({ ...dw, walls: dw.walls.length }));
  }

  // ─────────── 3c. angled and curved walls (stage A6b): the Wedge and a quarter-circle wall as DXF, the Wedge as a PDF ───────────
  {
    const { WEDGE, wedgeDrawing, dxfOf, quarterOutline, QUARTER, wedgeSymbols } = await import('./import-slant-fixtures.mjs');
    const { WEDGE: DESIGN } = await import('./fixtures/houses.mjs');
    const { buildPlan } = await import('../src/core/plan-build.js');
    const d = wedgeDrawing(), q = quarterOutline();
    const WEDGE_DXF = path.join(tmp, 'wedge.dxf'), QUARTER_DXF = path.join(tmp, 'quarter.dxf'), WEDGE_PDF = path.join(tmp, 'wedge.pdf');
    fs.writeFileSync(WEDGE_DXF, Buffer.from(dxfOf({ lines: d.lines, symLines: d.doorLines, symArcs: d.arcs, winLines: d.winLines }).bytes()));
    fs.writeFileSync(QUARTER_DXF, Buffer.from(dxfOf({ lines: q.lines, wallArcs: q.arcs }).bytes()));
    fs.writeFileSync(WEDGE_PDF, wedgePdf(d, 50));
    // the design's rooms, by the plan builder itself (areas in cm², sorted)
    const ref = buildPlan({ walls: DESIGN.walls, slants: DESIGN.slants, openings: DESIGN.openings, heights: DESIGN.heights, meta: { name: 'Wedge' } }, { slants: true });
    const polyArea = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p0 = P[i], p1 = P[(i + 1) % P.length]; a += p0[0] * p1[1] - p1[0] * p0[1]; } return Math.abs(a) / 2; };
    const refAreas = ref.plan.rooms.map((r) => polyArea(r.polygon)).sort((a, b) => a - b);
    check('reference: the design builds to 3 rooms', ref.ok && refAreas.length === 3, refAreas.map((a) => (a / 1e4).toFixed(3)).join(' / ') + ' m²');

    const driver = (pg) => {
      const state = () => pg.evaluate(() => { const dd = document.querySelector('.importdlg'); const s = dd && dd._import && dd._import.state; return s ? { step: s.step, busy: s.busy, error: s.error, kind: s.kind, sheet: !!s.sheet, first: !!s.first,
        result: s.result ? { walls: s.result.walls.length, openings: s.result.openings.length, slants: (s.result.slants || []).length, unsupported: (s.result.unsupported || []).length, slantsOn: !!s.result.slantsOn } : null } : null; });
      const until = async (fn, ms = 60000) => { const t0 = Date.now(); for (;;) { const v = await state(); if (v && fn(v)) return v; if (v && v.error) return v; if (Date.now() - t0 > ms) return v; await sleep(200); } };
      const nextBtn = () => pg.locator('.importdlg .dialog__foot .btn--primary');
      return { state, until, nextBtn };
    };
    const bootPage = async (pg) => {
      await pg.waitForFunction(() => document.documentElement.classList.contains('app-ready') && window.app && window.app.projects && window.app.projects.current(), null, { timeout: 90000 });
      await sleep(800);
      await pg.getByRole('button', { name: 'Start designing' }).click({ timeout: 5000 }).catch(() => {});
      await sleep(300);
      for (let i = 0; i < 3 && await pg.locator('.scrim').count(); i++) { await pg.keyboard.press('Escape'); await sleep(300); }
    };
    /** Open the dialog, read `file`, confirm the file's own scale, choose the orientation and arrive at the Review step. */
    const toReview = async (pg, dr, file, { rotate = 0, mirror = false } = {}) => {
      await pg.locator('.inext .btn--primary').click().catch(() => {});
      await pg.evaluate(() => window.app.store.setUI({ tool: 'select' }));
      await sleep(200);
      await pg.locator('.projname--switch').click();
      await pg.getByRole('menuitem', { name: /Import a sketch/ }).click();
      await pg.waitForSelector('.importdlg');
      await pg.setInputFiles('#import-sketch-file', file);
      let st = await dr.until((x) => x.sheet && x.first && !x.busy, 90000);
      if (!st || st.error) return st;
      await dr.nextBtn().click();
      await pg.waitForSelector('.iopts');
      if (file.endsWith('.pdf')) {
        await pg.locator('.iopt', { hasText: 'Type the scale' }).locator('input[type=radio]').check();
        await pg.getByLabel('Scale denominator (1 : N)').fill('50');
        await sleep(150);
      }
      await dr.nextBtn().click();
      await pg.waitForSelector('.inorth');
      if (rotate) await pg.locator(`.seg [data-value="${rotate}"]`).first().click();
      if (mirror) await pg.locator(`.seg [data-value="${mirror}"]`).first().click();
      await dr.nextBtn().click();
      return dr.until((x) => x.step === 3 && x.result && !x.busy, 90000);
    };
    /** What the open project's plan says about its angled walls and rooms (plan cm), computed in the page. */
    const planFacts = (pg) => pg.evaluate(async () => {
      const { slantFrame, pointAt } = await import('/src/core/slant-geom.js');
      const P = window.app.plan;
      const area = (Q) => { let a = 0; for (let i = 0; i < Q.length; i++) { const p0 = Q[i], p1 = Q[(i + 1) % Q.length]; a += p0[0] * p1[1] - p1[0] * p0[1]; } return Math.abs(a) / 2; };
      const inside = (Q, x, y) => { let c = false; for (let i = 0, j = Q.length - 1; i < Q.length; j = i++) { const [xi, yi] = Q[i], [xj, yj] = Q[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
      const slants = (P.slants || []).map((s) => ({ ...s }));
      const doors = (P.openings || []).filter((o) => o.axis === 'a').map((o) => {
        const s = slants.find((x) => x.id === o.wall), f = slantFrame(s), sg = o.swing === 'r' ? 1 : -1;
        const c = pointAt(s, o.at), hat = o.hinge === 'b' ? o.at + o.width / 2 : o.at - o.width / 2, hp = pointAt(s, hat);
        const sp = [c[0] + f.nx * sg * 45, c[1] + f.ny * sg * 45], room = P.rooms.find((r) => inside(r.polygon, sp[0], sp[1]));
        return { id: o.id, kind: o.kind, wall: o.wall, wallKind: s.kind, at: o.at, width: o.width, hinge: o.hinge, swing: o.swing, hingePt: [hp[0] + f.nx * sg * s.t / 2, hp[1] + f.ny * sg * s.t / 2], swingRoom: room ? area(room.polygon) : null };
      });
      return { name: window.app.projects.current().name, phase: window.app.projects.current().phase, walls: P.walls.length, slants, doors, rooms: P.rooms.map((r) => area(r.polygon)).sort((a, b) => a - b), underlay: !!(window.app.store.underlay && window.app.store.underlay.image), bounds: P.bounds };
    });
    const create = async (pg, dr, name) => {
      await dr.nextBtn().click();
      await pg.waitForSelector('.icreate');
      await pg.getByLabel('Project name').fill(name);
      const warnText = await pg.locator('.icreate').textContent();
      const errBanner = await pg.locator('.lvlbanner--locked').count();
      await dr.nextBtn().click();
      await pg.waitForFunction((n) => !document.querySelector('.importdlg') && window.app.projects.current().name === n, name, { timeout: 30000 }).catch(() => {});
      await sleep(600);
      return { warnText, errBanner };
    };
    const distLine = (x, y, s) => { const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1); return Math.abs((s.x2 - s.x1) * (s.y1 - y) - (s.x1 - x) * (s.y2 - s.y1)) / L; };

    // ── switch OFF (the default): today's behaviour plus the hint line ──
    {
      const dr = driver(page);
      const st = await toReview(page, dr, WEDGE_DXF);
      check('switch off: the Wedge reviews with its angled pieces unsupported (4), no slants', st && st.result && st.result.slants === 0 && st.result.unsupported === 4 && !st.result.slantsOn, JSON.stringify(st && st.result));
      const lg = await page.locator('.ilegend').textContent(), side = await page.locator('.importdlg .isplit__side').textContent();
      check('switch off: legend has the amber "Not understood" count, no angled walls line', /Not understood \(angled \/ curved\)4/.test(lg) && !/Angled walls/.test(lg), lg);
      check('switch off: still says to redraw them by hand as straight walls', /redraw them by hand as straight walls/.test(side));
      check('switch off: the new hint line under the amber list', side.includes('Angled walls can be imported — turn on “Angled walls (in development)” in Settings → Experimental and import again.'));
      await page.locator('.importdlg .dialog__foot').getByRole('button', { name: 'Cancel' }).click();
      await sleep(300);
    }

    // ── switch ON (?angled=1) ──
    const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pa = await actx.newPage();
    pa.on('pageerror', (e) => errors.push('angled pageerror: ' + e.message));
    pa.on('console', (m) => { if (m.type() === 'error') errors.push('angled: ' + m.text()); });
    await pa.goto(`http://localhost:${PORT}/index.html?angled=1`);
    await bootPage(pa);
    check('?angled=1 turns the Angled walls switch on', await pa.evaluate(async () => (await import('/src/core/features.js')).FEATURES.angledWalls === true));
    const dr = driver(pa);

    // the Wedge as DXF
    let st = await toReview(pa, dr, WEDGE_DXF);
    check('switch on: DXF Wedge reviews with 2 slants, 4 openings, nothing unsupported', st && st.result && st.result.slants === 2 && st.result.openings === 4 && st.result.unsupported === 0 && st.result.slantsOn, JSON.stringify(st && st.result));
    let lg = await pa.locator('.ilegend').textContent();
    check('review legend: "Angled walls 2" with their 2 openings', /Angled walls2/.test(lg) && /with 2 openings in them/.test(lg) && !/Not understood/.test(lg) && !/Curved wall pieces/.test(lg), lg);
    check('review: no "redraw by hand" text and no switch hint', !/by hand/.test(await pa.locator('.importdlg .isplit__side').textContent()) && !/can be imported/.test(await pa.locator('.importdlg .isplit__side').textContent()));
    // the overlay really paints angled bands: wall colour pixels along the s01 centre line away from the opening
    const paint = await pa.evaluate(() => {
      const dd = document.querySelector('.importdlg'), r = dd._import.state.result, sh = dd._import.sheet;
      const cv = sh.canvas, rect = cv.getBoundingClientRect(), g = cv.getContext('2d'), dpr = cv.width / rect.width;
      const inv = (a) => { const [A, B, C, D, E, F] = a, det = A * D - B * C; return [D / det, -B / det, -C / det, A / det, (C * F - D * E) / det, (B * E - A * F) / det]; };
      const T = inv(r.sheetTransform);
      const at = (x, y) => { const u = T[0] * x + T[2] * y + T[4], v = T[1] * x + T[3] * y + T[5], p = sh.toScreen(u, v); return g.getImageData(Math.round(p[0] * dpr), Math.round(p[1] * dpr), 1, 1).data; };
      return r.slants.map((s) => { const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1), f = 0.2; const px = s.x1 + (s.x2 - s.x1) * f, py = s.y1 + (s.y2 - s.y1) * f; return { id: s.id, kind: s.kind, rgb: [...at(px, py)].slice(0, 3), L }; });
    });
    check('review paints the slants as coloured bands (exterior blue-ish, interior green-ish)', paint.length === 2 && paint.every((p) => p.rgb.some((v) => v < 200)), JSON.stringify(paint));
    if (shots) await pa.screenshot({ path: path.join(shotDir, 'import-angled-review.png') });
    let made = await create(pa, dr, 'Imported Wedge');
    check('create step: no errors; plan has no stray angled-wall warnings', made.errBanner === 0 && /2 angled walls/.test(made.warnText) && !/does not meet another wall/.test(made.warnText), made.warnText.replace(/\s+/g, ' ').slice(0, 260));
    let pf = await planFacts(pa);
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    const mapped = DESIGN.slants.map((ds) => pf.slants.find((s) => s.t === ds.t && s.kind === ds.kind && distLine(s.x1, s.y1, ds) <= 2 && distLine(s.x2, s.y2, ds) <= 2));
    check('Wedge project: both slants within 2 cm of the design centre lines, thickness and kind right', pf.name === 'Imported Wedge' && pf.slants.length === 2 && mapped.every(Boolean), JSON.stringify(pf.slants));
    const areasOk = (areas) => areas.length === 3 && areas.every((a, i) => Math.abs(a - refAreas[i]) / refAreas[i] <= 0.001);
    check('Wedge project: 3 rooms, areas within 0.1 % of the design', areasOk(pf.rooms), pf.rooms.map((a) => (a / 1e4).toFixed(3)).join(' / ') + ' vs ' + refAreas.map((a) => (a / 1e4).toFixed(3)).join(' / '));
    const win = pf.doors.find((o) => o.kind === 'window'), door = pf.doors.find((o) => o.kind === 'door');
    check('Wedge project: the window (120 cm) in the exterior slant, the door (80 cm) in the interior one', win && near(win.width, 120, 0.6) && win.wallKind === 'exterior' && door && near(door.width, 80, 0.6) && door.wallKind === 'interior', JSON.stringify(pf.doors));
    check('Wedge project: a draft with the underlay, the 4 orthogonal walls + doors kept', pf.phase === 'draft' && pf.underlay && pf.walls >= 6, JSON.stringify({ phase: pf.phase, underlay: pf.underlay, walls: pf.walls }));
    // the design's hinge point of the s02 door (jamb a, 5 cm onto the swing side)
    const s2 = DESIGN.slants[1], L2 = Math.hypot(s2.x2 - s2.x1, s2.y2 - s2.y1), u2 = [(s2.x2 - s2.x1) / L2, (s2.y2 - s2.y1) / L2], n2 = [-u2[1], u2[0]];
    const hingeDesign = [s2.x1 + u2[0] * (L2 / 2 - 40) + n2[0] * 5, s2.y1 + u2[1] * (L2 / 2 - 40) + n2[1] * 5];
    check('Wedge project: the door hinges at the design\'s jamb, on the design\'s swing side', door && Math.hypot(door.hingePt[0] - hingeDesign[0], door.hingePt[1] - hingeDesign[1]) <= 2 && near(door.swingRoom, refAreas[2], refAreas[2] * 0.001), JSON.stringify({ hinge: door && door.hingePt, want: hingeDesign, room: door && door.swingRoom }));
    if (shots) await pa.screenshot({ path: path.join(shotDir, 'import-angled-draft.png') });

    // mirrored north–south: the plan is the design reflected (y → 800 − y), room areas equal, hinge and swing mirrored
    st = await toReview(pa, dr, WEDGE_DXF, { mirror: 'ns' });
    check('mirror north–south: review finds the same 2 slants', st && st.result && st.result.slants === 2 && st.result.openings === 4, JSON.stringify(st && st.result));
    made = await create(pa, dr, 'Wedge flipped');
    pf = await planFacts(pa);
    const flip = (s) => ({ ...s, y1: 800 - s.y1, y2: 800 - s.y2 });
    const mmapped = DESIGN.slants.map((ds) => pf.slants.find((s) => s.t === ds.t && s.kind === ds.kind && distLine(s.x1, s.y1, flip(ds)) <= 2 && distLine(s.x2, s.y2, flip(ds)) <= 2));
    check('mirrored Wedge: slants on the reflected centre lines', pf.name === 'Wedge flipped' && pf.slants.length === 2 && mmapped.every(Boolean), JSON.stringify(pf.slants));
    check('mirrored Wedge: room areas equal to the design\'s', areasOk(pf.rooms), pf.rooms.map((a) => (a / 1e4).toFixed(3)).join(' / '));
    const mdoor = pf.doors.find((o) => o.kind === 'door');
    check('mirrored Wedge: the door hinge is at the reflected jamb and it swings into the same (mirrored) room', mdoor && Math.hypot(mdoor.hingePt[0] - hingeDesign[0], mdoor.hingePt[1] - (800 - hingeDesign[1])) <= 2 && near(mdoor.swingRoom, refAreas[2], refAreas[2] * 0.001), JSON.stringify(mdoor));

    // the same drawing as a PDF page at 1 : 50
    st = await toReview(pa, dr, WEDGE_PDF);
    check('switch on: PDF Wedge reviews with 2 slants and 4 openings', st && st.kind === 'pdf' && st.result && st.result.slants === 2 && st.result.openings === 4 && st.result.unsupported === 0, JSON.stringify(st));
    if (st && st.result && st.result.slants === 2) {
      made = await create(pa, dr, 'Wedge from PDF');
      pf = await planFacts(pa);
      const pm = DESIGN.slants.map((ds) => pf.slants.find((s) => s.t === ds.t && s.kind === ds.kind && distLine(s.x1, s.y1, ds) <= 2 && distLine(s.x2, s.y2, ds) <= 2));
      check('PDF Wedge project: slants within 2 cm of the design centre lines, 3 rooms within 0.1 %', pm.every(Boolean) && areasOk(pf.rooms), JSON.stringify({ slants: pf.slants.length, rooms: pf.rooms.map((a) => (a / 1e4).toFixed(3)) }));
    } else await pa.locator('.importdlg .dialog__foot').getByRole('button', { name: 'Cancel' }).click().catch(() => {});

    // the quarter-circle wall: a chain of straight pieces and the note
    st = await toReview(pa, dr, QUARTER_DXF);
    const pieces = st && st.result ? st.result.slants : 0;
    check('quarter circle: the review finds a chain of straight pieces, nothing unsupported', pieces >= 3 && st.result.unsupported === 0, JSON.stringify(st && st.result));
    lg = await pa.locator('.ilegend').textContent();
    const notes = await pa.locator('.iwarns').textContent().catch(() => '');
    check('quarter circle: legend counts the curved wall pieces and the note says N straight pieces within 2 cm', new RegExp(`Curved wall pieces${pieces}`).test(lg) && !/Angled walls\d/.test(lg) && new RegExp(`Curved wall drawn as ${pieces} straight pieces, within 2 cm`).test(notes), lg + ' | ' + notes);
    made = await create(pa, dr, 'Quarter circle');
    pf = await planFacts(pa);
    const radii = pf.slants.map((s) => { let m = 0; for (let i = 0; i <= 20; i++) { const x = s.x1 + (s.x2 - s.x1) * i / 20, y = s.y1 + (s.y2 - s.y1) * i / 20; m = Math.max(m, Math.abs(Math.hypot(x - QUARTER.cx, y - QUARTER.cy) - QUARTER.r)); } return m; });
    check('quarter-circle project: chain pieces created, all within 2 cm of the circle, thickness 20', pf.slants.length === pieces && pf.slants.every((s) => s.chain && s.t === 20) && Math.max(...radii) <= 2 && pf.rooms.length >= 1, JSON.stringify({ n: pf.slants.length, dev: Math.max(...radii), rooms: pf.rooms.length, errBanner: made.errBanner }));
    await actx.close();

    // every rotation × mirror: the converted slants and the door agree with the design (engine, as the dialog calls it)
    const { readDxf, analyseDxf } = await import('../src/import/index.js');
    const { slantFrame, pointAt } = await import('../src/core/slant-geom.js');
    const prims = readDxf(Buffer.from(fs.readFileSync(WEDGE_DXF)));
    const s2d = DESIGN.slants[1], hd = [s2d.x1 + u2[0] * (L2 / 2 - 40) + n2[0] * 5, s2d.y1 + u2[1] * (L2 / 2 - 40) + n2[1] * 5];
    let okAll = true; const bad = [];
    for (const rotate of [0, 90, 180, 270]) for (const mirror of [false, 'ns', 'ew']) {
      const T = (x, y) => { if (mirror === 'ns') y = -y; if (mirror === 'ew') x = -x; return rotate === 90 ? [-y, x] : rotate === 180 ? [-x, -y] : rotate === 270 ? [y, -x] : [x, y]; };
      const cs = [[0, 0], [1000, 0], [0, 800], [1000, 800]].map(([x, y]) => T(x, y)), ox = Math.min(...cs.map((p) => p[0])), oy = Math.min(...cs.map((p) => p[1]));
      const out = (x, y) => { const p = T(x, y); return [p[0] - ox, p[1] - oy]; };
      const r = analyseDxf(prims, { slants: true, rotate, mirror });
      const b = buildPlan({ walls: r.walls.map(({ id, x, y, w, h, kind }) => ({ id, x, y, w, h, kind })), slants: r.slants, openings: r.openings.map(({ confidence, ...o }) => o) }, { slants: true });
      const lines = DESIGN.slants.map((ds) => { const a = out(ds.x1, ds.y1), c = out(ds.x2, ds.y2); return { x1: a[0], y1: a[1], x2: c[0], y2: c[1] }; });
      const onLines = DESIGN.slants.every((ds, i) => (b.plan.slants || []).some((s) => s.t === ds.t && s.kind === ds.kind && distLine(s.x1, s.y1, lines[i]) <= 2 && distLine(s.x2, s.y2, lines[i]) <= 2));
      const dop = b.plan.openings.find((o) => o.axis === 'a' && o.kind === 'door'), ds = dop && b.plan.slants.find((x) => x.id === dop.wall);
      let hingeErr = Infinity;
      if (ds) { const f = slantFrame(ds), sg = dop.swing === 'r' ? 1 : -1, c = pointAt(ds, dop.hinge === 'b' ? dop.at + dop.width / 2 : dop.at - dop.width / 2), want = out(...hd); hingeErr = Math.hypot(c[0] + f.nx * sg * ds.t / 2 - want[0], c[1] + f.ny * sg * ds.t / 2 - want[1]); }
      const areas = b.plan.rooms.map((x) => polyArea(x.polygon)).sort((x, y) => x - y);
      if (!(b.ok && onLines && hingeErr <= 2 && areasOk(areas))) { okAll = false; bad.push(`${rotate}/${mirror}: ok ${b.ok} lines ${onLines} hinge ${hingeErr.toFixed(1)}`); }
    }
    check('all 4 rotations × both mirrors: slants, hinge side and room areas agree with the design', okAll, bad.join('; '));
  }

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

  // ─────────── 5. several floors (stage F8): the Duplex as two plans side by side in one DXF ───────────
  {
    const { floorsDxf, duplexSheet } = await import('./import-floor-fixtures.mjs');
    const TWO = path.join(tmp, 'duplex-two-floors.dxf');
    fs.writeFileSync(TWO, Buffer.from(floorsDxf(duplexSheet()).bytes()));
    const bootIt = async (pg) => {
      await pg.waitForFunction(() => document.documentElement.classList.contains('app-ready') && window.app && window.app.projects && window.app.projects.current(), null, { timeout: 90000 });
      await sleep(800);
      await pg.getByRole('button', { name: 'Start designing' }).click({ timeout: 5000 }).catch(() => {});
      await sleep(300);
      for (let i = 0; i < 3 && await pg.locator('.scrim').count(); i++) { await pg.keyboard.press('Escape'); await sleep(300); }
    };
    const openWith = async (pg, file) => {
      await pg.locator('.inext .btn--primary').click().catch(() => {});
      await pg.evaluate(() => window.app.store.setUI({ tool: 'select' }));
      await sleep(200);
      await pg.locator('.projname--switch').click();
      await pg.getByRole('menuitem', { name: /Import a sketch/ }).click();
      await pg.waitForSelector('.importdlg');
      await pg.setInputFiles('#import-sketch-file', file);
      await pg.waitForFunction(() => { const s = document.querySelector('.importdlg')?._import?.state; return s && s.sheet && s.first && !s.busy; }, null, { timeout: 90000 });
      await sleep(300);
    };
    const fstate = (pg) => pg.evaluate(() => { const s = document.querySelector('.importdlg')?._import?.state; return s ? { step: s.step, busy: s.busy, error: s.error, floors: s.floors ? s.floors.length : null, cur: s.cur } : null; });
    const funtil = async (pg, fn, ms = 90000) => { const t0 = Date.now(); for (;;) { const v = await fstate(pg); if (v && (fn(v) || v.error)) return v; if (Date.now() - t0 > ms) return v; await sleep(200); } };
    const fnext = (pg) => pg.locator('.importdlg .dialog__foot .btn--primary').click();

    // ── switch OFF: no floor list, today's "Which drawing?" chooser and five steps ──
    await openWith(page, TWO);
    const off = await page.evaluate(() => ({ floorsBox: document.querySelectorAll('.importdlg .ifloorsbox').length, chooser: document.querySelectorAll('.importdlg .idrawings__btn').length, steps: document.querySelectorAll('.importdlg .istep__item').length, floors: document.querySelector('.importdlg')._import.state.floors }));
    check('floors switch off: no floor list, the drawing chooser, five steps', off.floorsBox === 0 && off.chooser === 2 && off.steps === 5 && off.floors === null, JSON.stringify(off));
    await page.locator('.importdlg .dialog__foot').getByRole('button', { name: 'Cancel' }).click();
    await sleep(300);

    // ── switch ON (?levels=1) ──
    const fctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pf = await fctx.newPage();
    pf.on('pageerror', (e) => errors.push('floors pageerror: ' + e.message));
    pf.on('console', (m) => { if (m.type() === 'error') errors.push('floors: ' + m.text()); });
    await pf.goto(`http://localhost:${PORT}/index.html?levels=1`);
    await bootIt(pf);
    await openWith(pf, TWO);
    check('floors on: the Drawing step has a floor list with one floor and "Add drawing 2 as a floor"', await pf.locator('.ifloor').count() === 1 && await pf.getByRole('button', { name: /Add drawing \d as a floor/ }).count() === 1);
    await pf.getByRole('button', { name: /Add drawing \d as a floor/ }).click();
    await sleep(400);
    let fs1 = await fstate(pf);
    check('a second drawing of the sheet becomes the first floor; the steps gain "Align floors"', fs1.floors === 2 && await pf.locator('.ifloor').count() === 2 && (await pf.locator('.istep').textContent()).includes('Align floors'), JSON.stringify(fs1));
    // the ground floor is the drawing on the left of the sheet (the one with the stair): put it first
    const order = await pf.evaluate(() => {
      const s = document.querySelector('.importdlg')._import.state;
      const d = s.first.drawings, left = d.indexOf([...d].sort((a, b) => a.bbox.x - b.bbox.x)[0]);
      return { left, floors: s.floors.map((F, i) => (i === s.cur ? s.drawing : F.drawing)) };
    });
    if (order.floors[0] !== order.left) await pf.getByRole('button', { name: 'Move Ground floor up a floor' }).click();
    await sleep(300);
    const order2 = await pf.evaluate(() => { const s = document.querySelector('.importdlg')._import.state; return s.floors.map((F, i) => ({ name: F.name, drawing: i === s.cur ? s.drawing : F.drawing })); });
    check('reordered bottom-up: the ground floor reads the left drawing (names follow the order)', order2[0].drawing === order.left && order2[0].name === 'Ground floor' && order2[1].name === 'First floor', JSON.stringify(order2));
    for (const n of ['Ground floor', 'First floor']) await pf.getByLabel(`Ceiling height of ${n} in metres`).fill('2.80');
    const labels = await pf.locator('.idrawings__floor').allTextContents();
    check('the drawing chooser says which drawing is which floor', labels.length === 2 && labels.some((t) => /Ground floor/.test(t)) && labels.some((t) => /First floor/.test(t)), labels.join(' | '));
    if (shots) await pf.screenshot({ path: path.join(shotDir, 'import-floors-list.png') });

    await fnext(pf);
    await pf.waitForSelector('.ifloortabs');
    check('Scale step: the floors as tabs', await pf.locator('.ifloortabs__tab').count() === 2);
    await pf.locator('.ifloortabs__tab', { hasText: 'First floor' }).click();
    await sleep(200);
    check('…the first floor offers "Same scale as the ground floor", pre-ticked (same file, same units)', await pf.getByLabel('Same scale as the ground floor').isChecked());
    await fnext(pf);
    await pf.waitForSelector('.inorth');
    check('Orientation step: floor tabs, no ceiling field (the floor list has them)', await pf.locator('.ifloortabs__tab').count() === 2 && await pf.getByLabel('Ceiling height in metres').count() === 0);
    await fnext(pf);
    fs1 = await funtil(pf, (v) => v.step === 3 && !v.busy);
    await pf.waitForSelector('.ialign__info');
    await sleep(500);
    const side = await pf.locator('.importdlg .isplit__side').textContent();
    check('Align floors: proposed automatically, "outer walls coincide on 4 of 4 sides — confident", every side flush', /Proposed automatically: outer walls coincide on 4 of 4 sides — confident/.test(side) && (side.match(/flush/g) || []).length === 4, side.slice(0, 260));
    const A = () => pf.evaluate(() => { const s = document.querySelector('.importdlg')._import.state; return { ...s.floors[1].align, auto: undefined }; });
    // arrow keys: 1 cm, Shift 5 cm
    await pf.locator('.ialign__canvas').focus();
    for (let i = 0; i < 3; i++) await pf.keyboard.press('ArrowRight');
    await pf.keyboard.press('Shift+ArrowDown');
    let a = await A();
    check('arrow keys nudge the upper floor (3 × 1 cm east, Shift 5 cm south)', a.dx === 3 && a.dy === 5 && a.manual, JSON.stringify(a));
    check('…the read-out follows (east side sticks out 3 cm)', /East\s*sticks out 3 cm/.test(await pf.locator('.ialign__info').textContent()), await pf.locator('.ialign__info').textContent());
    // drag with the mouse: the upper floor moves, then lands on the grid / snaps to the walls below
    const scr = (x, y) => pf.evaluate(([px, py]) => { const d = document.querySelector('.importdlg'), v = d._import.align, r = v.canvas.getBoundingClientRect(), q = v.toScreen(px, py); return [r.left + q[0], r.top + q[1]]; }, [x, y]);
    const p0 = await scr(700, 600);
    await pf.mouse.move(p0[0], p0[1]); await pf.mouse.down();
    for (let i = 1; i <= 8; i++) await pf.mouse.move(p0[0] + 6 * i, p0[1] + 2 * i);
    await pf.mouse.up();
    await sleep(200);
    a = await A();
    check('dragging moves the upper floor (it lands on the 5 cm grid or on a wall face below)', (a.dx !== 3 || a.dy !== 5) && a.manual, JSON.stringify(a));
    await pf.getByRole('button', { name: 'Back to the proposal' }).click();
    await sleep(200);
    a = await A();
    check('"Back to the proposal" puts it back', a.dx === 0 && a.dy === 0 && !a.manual, JSON.stringify(a));
    // Match two points: nudge 10 cm east, then match the upper floor's north-west corner with the lower floor's
    await pf.locator('.ialign__canvas').focus();
    await pf.keyboard.press('Shift+ArrowRight'); await pf.keyboard.press('Shift+ArrowRight');
    await pf.getByRole('button', { name: 'Match two points' }).click();
    await sleep(150);
    let q = await scr(10, 0); await pf.mouse.click(q[0] + 2, q[1] + 2);
    await sleep(150);
    q = await scr(0, 0); await pf.mouse.click(q[0] + 2, q[1] + 2);
    await sleep(250);
    a = await A();
    check('"Match two points": the upper corner lands on the lower corner (the 10 cm nudge undone)', Math.abs(a.dx) < 0.01 && Math.abs(a.dy) < 0.01, JSON.stringify(a));
    await pf.getByRole('button', { name: 'Match a second pair' }).click();
    await sleep(150);
    q = await scr(1000, 800); await pf.mouse.click(q[0] - 2, q[1] - 2);
    await sleep(150);
    q = await scr(1000, 800); await pf.mouse.click(q[0] - 2, q[1] - 2);
    await sleep(250);
    check('…a second pair checks the turn: "not turned against each other"', /not turned against each other/.test(await pf.locator('.importdlg .isplit__side').textContent()));
    if (shots) await pf.screenshot({ path: path.join(shotDir, 'import-floors-align.png') });

    await fnext(pf);
    fs1 = await funtil(pf, (v) => v.step === 4 && !v.busy);
    await pf.waitForSelector('.istairs');
    const rv = await pf.locator('.importdlg .isplit__side').textContent();
    check('Review: the stair found on the ground floor is checked by the engine — "will be added: 18 risers of 16.7 cm, going 29 cm, up towards the north"', /will be added: 18 risers of 16\.7 cm, going 29 cm, up towards the north/.test(rv), rv.slice(rv.indexOf('Stairs and'), rv.indexOf('Stairs and') + 260));
    await pf.locator('.ifloortabs__tab', { hasText: 'First floor' }).click();
    await sleep(300);
    const rv1 = await pf.locator('.importdlg .isplit__side').textContent();
    check('…the first floor tab: its own legend and "Show the floor below"', /What was found on the first floor/.test(rv1) && /Show the floor below/.test(rv1) && /Doors1/.test(rv1.replace(/\s+/g, '')), rv1.slice(0, 200));
    await fnext(pf);
    await pf.waitForSelector('.icreate');
    await pf.getByLabel('Project name').fill('Duplex from DXF');
    check('Create: "2 floors", "1 stairs to add"', /2\s*floors/.test(await pf.locator('.ifacts').textContent()) && /1\s*stairs to add/.test(await pf.locator('.ifacts').textContent()), await pf.locator('.ifacts').textContent());
    await fnext(pf);
    await pf.waitForFunction(() => !document.querySelector('.importdlg') && window.app.projects.current().name === 'Duplex from DXF', null, { timeout: 30000 }).catch(() => {});
    await sleep(900);
    const made = await pf.evaluate(() => {
      const P = window.app.plan, st = window.app.store, L1 = (P.levels || [])[0] || {};
      const box = (r) => { const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
      return { phase: window.app.projects.current().phase, levels: (P.levels || []).length, rooms: [P.rooms.length, (L1.rooms || []).length], stairs: (P.stairs || []).map((s) => ({ id: s.id, x: s.x, y: s.y, rot: s.rot, risers: s.risers, going: s.going })),
        voids: (L1.voids || []).map((v) => ({ id: v.id, stair: v.stair, box: box(v.polygon) })), l1Partition: (L1.walls || []).filter((w) => w.kind !== 'exterior').map((w) => [w.x, w.y, w.w, w.h]),
        underlay: !!(st.underlay && st.underlay.image), underlays: Object.keys(st.underlays || {}), differ: !!(st.underlays && st.underlays.L1 && st.underlay && st.underlays.L1.image !== st.underlay.image),
        card: !!document.querySelector('.inext') && /2 floors/.test(document.querySelector('.inext').textContent) && /stair was added/.test(document.querySelector('.inext').textContent) };
    });
    check('created: a draft with 2 floors, 2 rooms on each', made.phase === 'draft' && made.levels === 1 && made.rooms[0] === 2 && made.rooms[1] === 2, JSON.stringify(made.rooms));
    check('…the stair added by the engine on the ground floor (18 risers, going 29, up north) with its void on the first floor', made.stairs.length === 1 && made.stairs[0].risers === 18 && made.stairs[0].going === 29 && made.stairs[0].rot === 0
      && made.voids.length === 1 && made.voids[0].stair === made.stairs[0].id && made.voids[0].box.join() === '520,266,620,670', JSON.stringify({ s: made.stairs, v: made.voids }));
    check('…the first floor lined up over the ground floor (its partition at x 300)', made.l1Partition.some((w) => w[0] === 300), JSON.stringify(made.l1Partition));
    check('…one underlay per floor (ground + L1, different pictures)', made.underlay && made.underlays.join() === 'L1' && made.differ, JSON.stringify(made.underlays));
    check('…the "what next" card mentions the floors and the stair', made.card);
    // each floor's underlay sits on that floor's walls: ink on both faces of its partition (ground x 500–510, first floor x 300–310)
    const ink = await pf.evaluate(async () => {
      const { affInv, affApply } = await import('/src/ui/import/affine.js');
      const st = window.app.store, out = {};
      for (const [lv, u, wx] of [['L0', st.underlay, 500], ['L1', st.underlays.L1, 300]]) {
        const img = new Image(); img.src = u.image; await img.decode();
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const M = affInv(u.transform), dark = [];
        for (let x = wx - 25; x <= wx + 35; x += 0.5) { const [px, py] = affApply(M, x, 650); const d = g.getImageData(Math.round(px), Math.round(py), 1, 1).data; if (255 - (d[0] + d[1] + d[2]) / 3 > 90) dark.push(x); }
        out[lv] = dark.length ? [Math.min(...dark), Math.max(...dark)] : null;
      }
      return out;
    });
    check('each floor\'s underlay is aligned with its own walls (partition faces within 3 cm)', ink.L0 && ink.L1 && Math.abs(ink.L0[0] - 500) <= 3 && Math.abs(ink.L0[1] - 510) <= 3 && Math.abs(ink.L1[0] - 300) <= 3 && Math.abs(ink.L1[1] - 310) <= 3, JSON.stringify(ink));
    // switching floors: the 2D view and the Structure guide's card use that floor's underlay
    const shown = async () => pf.evaluate(async () => { const { shownUnderlay } = await import('/src/view2d/underlay.js'); const st = window.app.store, lv = st.ui.level || 'L0', u = shownUnderlay({ store: st, level: lv }); return { lv, which: u === st.underlay ? 'L0' : u === (st.underlays || {}).L1 ? 'L1' : null, card: (document.querySelector('.iunder .phase__title') || {}).textContent }; });
    let sh = await shown();
    check('on the ground floor the 2D view shows the ground floor\'s underlay; the card says so', sh.lv === 'L0' && sh.which === 'L0' && /Ground floor/.test(sh.card), JSON.stringify(sh));
    await pf.locator('.inext .btn--primary').click().catch(() => {});
    await pf.keyboard.press('PageUp');
    await sleep(500);
    sh = await shown();
    if (sh.lv !== 'L1') { await pf.evaluate(() => window.app.store.setUI({ level: 'L1' })); await sleep(500); sh = await shown(); }
    check('switching to the first floor shows its own underlay (2D and the Structure guide card)', sh.lv === 'L1' && sh.which === 'L1' && /First floor/.test(sh.card), JSON.stringify(sh));
    if (shots) { await pf.evaluate(() => window.app.view2d && window.app.view2d.fitHouse && window.app.view2d.fitHouse()); await sleep(400); await pf.screenshot({ path: path.join(shotDir, 'import-floors-draft.png') }); }
    // opacity on the first floor changes only its underlay
    await pf.evaluate(() => window.app.store.setUnderlay({ opacity: 0.3 }, { level: 'L1' }));
    const op = await pf.evaluate(() => [window.app.store.underlay.opacity, window.app.store.underlays.L1.opacity]);
    check('the card / setUnderlay on the first floor changes only that floor\'s underlay', op[0] !== 0.3 && op[1] === 0.3, JSON.stringify(op));
    // a reload keeps both underlays
    await pf.evaluate(() => window.app.projects.flush());
    await pf.reload();
    await bootIt(pf);
    const kept = await pf.evaluate(() => ({ name: window.app.projects.current().name, l0: !!window.app.store.underlay, l1: !!(window.app.store.underlays && window.app.store.underlays.L1), op: window.app.store.underlays && window.app.store.underlays.L1 && window.app.store.underlays.L1.opacity, levels: (window.app.plan.levels || []).length }));
    check('a reload keeps the project with both underlays', kept.name === 'Duplex from DXF' && kept.l0 && kept.l1 && kept.op === 0.3 && kept.levels === 1, JSON.stringify(kept));
    await fctx.close();
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
