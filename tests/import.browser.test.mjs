// Sketch import engine in a real browser (headless Chromium): the vendored, ASCII-escaped pdf.js loads lazily as an
// ES module with its worker from our own origin, under a CSP without 'unsafe-eval'; reads the lot-98 PDF and
// renders the page to a canvas for the tracing underlay.      node tests/import.browser.test.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5317;
const PDF = 'docs/reference/lot-98-site-plan-2026-11-10.pdf';
if (!fs.existsSync(path.join(root, PDF))) { console.log('reference PDF not present: skipped'); process.exit(0); }

// a tiny page served with the production CSP (no eval, scripts / workers / fetches from our own origin only)
const CSP = "default-src 'self'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'";
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.pdf': 'application/pdf', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/blank.html') { res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': CSP }); return res.end('<!doctype html><meta charset="utf-8"><title>t</title><body></body>'); }
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'content-security-policy': CSP });
    res.end(data);
  });
}).listen(PORT);

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [], requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(`http://localhost:${PORT}/blank.html`);
  const r = await page.evaluate(async (pdf) => {
    const t0 = performance.now();
    const eng = await import('/src/import/index.js');
    const bytes = new Uint8Array(await (await fetch('/' + pdf)).arrayBuffer());
    const res = await eng.importPdfSketch(bytes);
    const canvas = document.createElement('canvas');
    const out = await eng.renderPdfPage(bytes, { pxPerUnit: 1, canvas, bitmap: true });
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
    return { walls: res.walls.length, openings: res.openings.length, scale: res.scale.label, w: out.width, h: out.height, dark, bitmap: !!out.bitmap, ms: Math.round(performance.now() - t0) };
  }, PDF);
  console.log(JSON.stringify(r));
  check('engine runs in the browser', r.walls === 53 && r.openings === 23 && r.scale === '1:100', `${r.walls} walls, ${r.openings} openings, ${r.scale}, ${r.ms} ms`);
  check('page renders to a canvas (tracing underlay)', r.w === 1191 && r.h === 842 && r.dark > 5000 && r.bitmap, `${r.w}×${r.h}, ${r.dark} dark px`);
  const foreign = requests.filter((u) => !u.startsWith(`http://localhost:${PORT}/`) && !u.startsWith('blob:') && !u.startsWith('data:'));
  check('no request leaves our origin', foreign.length === 0, foreign.join(' '));
  check('worker loaded from our origin', requests.some((u) => u.endsWith('/vendor/pdfjs/pdf.worker.min.js')));
  check('no errors (CSP without eval)', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `${failed} FAILED` : 'IMPORT BROWSER OK');
process.exit(failed ? 1 : 0);
