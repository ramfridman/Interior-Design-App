// Builds the public, static site for ordinary web hosting (Cloudflare Pages, Vercel, any static host).
//   node dev/build-site.mjs            →  dist/site/   (index.html, src/, vendor/, robots.txt, _headers)
//   node dev/build-site.mjs --serve [port]   also serves dist/site/ locally WITH the headers from _headers applied,
//                                            so the Content-Security-Policy can be tested before going live.
//
// Only what the browser needs is copied: no docs/ (the architect's PDFs stay private), no dev/, no tests/, no
// research notes. The site asks search engines to stay away (robots.txt, meta tag and X-Robots-Tag header);
// access control itself (invite-only) is the host's job — see docs/HOSTING-PLAN.md.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'site');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const posix = (p) => p.split(path.sep).join('/');
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));

/* ───────── which files ───────── */
const IMPORT_MAP = { three: 'vendor/three/three.module.min.js', 'three/addons/': 'vendor/three/addons/' };
function resolveSpec(spec, from) {
  if (spec === 'three') return IMPORT_MAP.three;
  if (spec.startsWith('three/addons/')) return IMPORT_MAP['three/addons/'] + spec.slice('three/addons/'.length);
  if (spec.startsWith('.')) return posix(path.normalize(path.join(path.dirname(from), spec)));
  return null;
}
const files = new Set();
const missing = [];
function crawl(file) {
  if (files.has(file)) return;
  if (!exists(file)) { missing.push(file); return; }
  files.add(file);
  const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) { const dep = resolveSpec(m[1] || m[2], file); if (dep) crawl(dep); }
}
walk('src').filter((f) => f.endsWith('.js')).forEach(crawl);            // every app module (some load through computed imports)
for (const f of walk('src/styles')) if (f.endsWith('.css')) files.add(f);
for (const dir of ['vendor/pdf', 'vendor/fonts']) if (exists(dir)) for (const f of walk(dir)) if (/\.(js|mjs|ttf|otf|woff2?)$/i.test(f)) files.add(f);
for (const f of ['vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js', 'vendor/pdfjs/LICENSE.txt']) if (exists(f)) files.add(f); // sketch importer (lazy)

/* ───────── index.html ───────── */
let html = read('index.html');
if (!/name=["']robots["']/.test(html)) html = html.replace(/(<meta name="viewport"[^>]*>)/, '$1\n<meta name="robots" content="noindex, nofollow">');
const importMap = (html.match(/<script type="importmap">([\s\S]*?)<\/script>/) || [])[1];
if (importMap == null) throw new Error('index.html: import map not found');
const importMapHash = `'sha256-${crypto.createHash('sha256').update(importMap, 'utf8').digest('base64')}'`;

/* ───────── headers ───────── */
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${importMapHash}`,          // the only inline script is the import map
  "style-src 'self' 'unsafe-inline'",            // the UI positions things with inline styles
  "img-src 'self' data: blob:",                  // thumbnails and exports are generated in the browser
  "font-src 'self'",
  "connect-src 'self'",                          // nothing is fetched from other origins
  "worker-src 'self' blob:",                     // the daylight solver runs in a worker
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
const HEADERS = [
  ['/*', [
    ['X-Robots-Tag', 'noindex, nofollow'],
    ['Content-Security-Policy', CSP],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
  ]],
  ['/', [['Cache-Control', 'no-cache']]],
  ['/index.html', [['Cache-Control', 'no-cache']]],
  ['/src/*', [['Cache-Control', 'public, max-age=300']]],            // app code: visitors get updates within minutes
  ['/vendor/*', [['Cache-Control', 'public, max-age=2592000']]],     // libraries and fonts change rarely
];

/* ───────── write ───────── */
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
let bytes = Buffer.byteLength(html);
for (const f of [...files].sort()) {
  const dest = path.join(out, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, f), dest);
  bytes += fs.statSync(dest).size;
}
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
fs.writeFileSync(path.join(out, '_headers'), HEADERS.map(([p, hs]) => `${p}\n${hs.map(([k, v]) => `  ${k}: ${v}`).join('\n')}`).join('\n\n') + '\n');
console.log(`dist/site: ${files.size + 3} files · ${(bytes / 1048576).toFixed(2)} MB`);
if (missing.length) console.log('missing (ignored):', missing.join(', '));

/* ───────── optional local preview with the same headers ───────── */
const serveAt = process.argv.indexOf('--serve');
if (serveAt >= 0) {
  const port = Number(process.argv[serveAt + 1]) || 5300;
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };
  const match = (pattern, url) => (pattern.endsWith('*') ? url.startsWith(pattern.slice(0, -1)) : url === pattern);
  http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    const headers = {};
    for (const [p, hs] of HEADERS) if (match(p, url)) for (const [k, v] of hs) headers[k] = v;
    if (url.endsWith('/')) url += 'index.html';
    const file = path.join(out, path.normalize(url));
    if (!file.startsWith(out) || path.basename(file) === '_headers') { res.writeHead(404); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, headers); res.end('Not found'); return; }
      res.writeHead(200, { ...headers, 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  }).listen(port, () => console.log(`preview with production headers: http://localhost:${port}/`));
}
