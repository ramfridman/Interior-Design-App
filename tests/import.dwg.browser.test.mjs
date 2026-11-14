// The DWG reader in headless Chromium, from the two packaged copies of the app:
//   1. the public site (node dev/build-site.mjs --serve): the app boots under the production headers (_headers: CSP with
//      'wasm-unsafe-eval' and no 'unsafe-eval') without loading the reader; then a DWG is read on the main thread and
//      through the import worker — the .wasm comes from our own origin as application/wasm, no console errors. A page
//      whose CSP lacks 'wasm-unsafe-eval' gets the plain "reader could not be started" message instead.
//   2. the artifact package (node dev/build-artifact.mjs → dist/artifact/site): its side files hold the reader, and a
//      DWG reads from them.                                                    node tests/import.dwg.browser.test.mjs
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_PORT = 5331, ART_PORT = 5332;
const DWG = [...fs.readFileSync(path.join(root, 'tests/fixtures/dwg/house-hebrew-2018.dwg'))];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };

/** Reads the DWG in the page twice: readDwg on the main thread, and runTask('dwg-read') (the import worker). */
const readInPage = (page, base) => page.evaluate(async ({ bytes, base }) => {
  const out = {};
  try {
    const eng = await import(base + 'src/import/index.js');
    const t0 = performance.now();
    const p = await eng.readDwg(new Uint8Array(bytes));
    out.main = { paths: p.paths.length, layers: p.layers.map((l) => l.name), version: p.source.version, ms: Math.round(performance.now() - t0) };
  } catch (e) { out.main = { error: String(e && e.message), code: e && e.code }; }
  try {
    const { runTask } = await import(base + 'src/ui/import/engine-client.js');
    const task = runTask('dwg-read', { bytes: new Uint8Array(bytes) });
    const r = await task.promise;
    out.worker = { paths: r.prims.paths.length, walls: r.look.layers.filter((l) => l.role === 'wall').map((l) => l.name), ranIn: task.ranIn };
  } catch (e) { out.worker = { error: String(e && e.message), code: e && e.code }; }
  return out;
}, { bytes: DWG, base });

const browser = await chromium.launch();
let site = null, art = null;
try {
  // ─────────── 1. the public site with its production headers ───────────
  site = spawn(process.execPath, [path.join(root, 'dev/build-site.mjs'), '--serve', String(SITE_PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => { site.stdout.on('data', (d) => { if (/preview with production headers/.test(String(d))) resolve(); }); setTimeout(resolve, 20000); });
  const headers = fs.readFileSync(path.join(root, 'dist/site/_headers'), 'utf8');
  const csp = (headers.match(/Content-Security-Policy: (.*)/) || [])[1] || '';
  check('built site: CSP allows WebAssembly compilation only (\'wasm-unsafe-eval\', no \'unsafe-eval\')', /script-src 'self' 'wasm-unsafe-eval'/.test(csp) && !/'unsafe-eval'/.test(csp), csp.slice(0, 120));
  check('built site: ships the reader, the GPL text and its notice', ['libredwg-web.js', 'libredwg-web.wasm', 'LICENSE-GPL-3.0.txt', 'README.md'].every((f) => fs.existsSync(path.join(root, 'dist/site/vendor/dwg', f))));

  const page = await browser.newPage();
  const errors = [], requests = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => requests.push({ url: r.url(), type: r.headers()['content-type'] || '', csp: r.headers()['content-security-policy'] || '' }));
  await page.goto(`http://localhost:${SITE_PORT}/`);
  const booted = await page.waitForFunction(() => document.documentElement.classList.contains('app-ready'), null, { timeout: 90000 }).then(() => true, () => false);
  await sleep(1500);
  check('built site: the app boots under the production CSP', booted);
  check('built site: the DWG reader is not loaded at start-up', !requests.some((r) => /\/vendor\/dwg\//.test(r.url)), requests.filter((r) => /dwg/.test(r.url)).map((r) => r.url).join(' '));
  const r1 = await readInPage(page, '/');
  console.log('   site:', JSON.stringify(r1));
  check('built site: a DWG reads on the main thread (2018 format, Hebrew layers)', r1.main.paths === 95 && r1.main.layers.includes('קירות') && r1.main.version === 'AC1032', JSON.stringify(r1.main));
  check('built site: a DWG reads in the import worker', r1.worker.paths === 95 && r1.worker.ranIn === 'worker' && r1.worker.walls.includes('קירות'), JSON.stringify(r1.worker));
  const wasm = requests.filter((r) => /\/vendor\/dwg\/libredwg-web\.wasm$/.test(r.url));
  check('built site: the .wasm comes from our own origin as application/wasm, with the CSP header', wasm.length >= 1 && wasm.every((r) => r.url.startsWith(`http://localhost:${SITE_PORT}/`) && /application\/wasm/.test(r.type) && /wasm-unsafe-eval/.test(r.csp)), JSON.stringify(wasm.map((r) => [r.url.slice(-30), r.type])));
  const foreign = requests.filter((r) => !r.url.startsWith(`http://localhost:${SITE_PORT}/`) && !/^(data|blob):/.test(r.url));
  check('built site: no request leaves our origin', foreign.length === 0, foreign.map((r) => r.url).join(' '));
  check('built site: no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));

  // control: the same page with a CSP that does not allow WebAssembly → a plain message, nothing else breaks
  const ctrl = await browser.newPage();
  await ctrl.route('**/*', async (route) => {
    const resp = await route.fetch();
    const h = { ...resp.headers() };
    if (h['content-security-policy']) h['content-security-policy'] = h['content-security-policy'].replace(" 'wasm-unsafe-eval'", '');
    await route.fulfill({ response: resp, headers: h });
  });
  await ctrl.goto(`http://localhost:${SITE_PORT}/robots.txt`);
  const r2 = await readInPage(ctrl, '/');
  check('without \'wasm-unsafe-eval\': the reader cannot start and says so in plain words', r2.main.code === 'dwg-no-reader' && /could not be started/.test(r2.main.error), JSON.stringify(r2.main));
  await ctrl.close();

  // ─────────── 2. the artifact package ───────────
  const b = spawnSync(process.execPath, [path.join(root, 'dev/build-artifact.mjs')], { encoding: 'utf8' });
  check('artifact package builds', b.status === 0, (b.stdout + b.stderr).trim().split('\n').pop());
  const files = JSON.parse(fs.readFileSync(path.join(root, 'dist/artifact/files.json'), 'utf8'));
  check('artifact: the reader, its .wasm and the GPL text are side files', ['vendor/dwg/libredwg-web.js', 'vendor/dwg/libredwg-web.wasm', 'vendor/dwg/LICENSE-GPL-3.0.txt', 'vendor/dwg/README.md'].every((f) => files[f]));
  const textFiles = Object.keys(files).filter((f) => /^vendor\/dwg\/.*\.(js|txt|md)$/.test(f));
  const nonAscii = textFiles.filter((f) => /[^\x09\x0a\x0d\x20-\x7e]/.test(fs.readFileSync(path.join(root, files[f]), 'latin1')));
  check('artifact: the reader\'s text side files are pure ASCII', nonAscii.length === 0, nonAscii.join(' '));
  check('artifact: the .wasm side file is under 15 MB', fs.statSync(path.join(root, files['vendor/dwg/libredwg-web.wasm'])).size < 15 * 1048576);
  const artRoot = path.join(root, 'dist/artifact/site');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
  art = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(artRoot, p);
    if (!file.startsWith(artRoot)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data); });
  }).listen(ART_PORT);
  const pa = await browser.newPage();
  const aerr = [];
  pa.on('pageerror', (e) => aerr.push('pageerror: ' + e.message));
  pa.on('console', (m) => { if (m.type() === 'error') aerr.push(m.text()); });
  await pa.goto(`http://localhost:${ART_PORT}/`);
  await pa.waitForFunction(() => document.documentElement.classList.contains('app-ready'), null, { timeout: 90000 }).catch(() => {});
  const r3 = await readInPage(pa, './');
  console.log('   artifact:', JSON.stringify(r3));
  check('artifact copy: a DWG reads from the side files (main thread and worker)', r3.main.paths === 95 && r3.worker.paths === 95, JSON.stringify(r3));
  check('artifact copy: no console errors', aerr.length === 0, aerr.slice(0, 5).join(' | '));
} finally {
  await browser.close();
  if (site) site.kill();
  if (art) art.close();
}
console.log(failed ? `${failed} FAILED` : 'IMPORT DWG BROWSER OK');
process.exit(failed ? 1 : 0);
