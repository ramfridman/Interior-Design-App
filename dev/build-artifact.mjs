// Packages the static app for publishing as a sandboxed multi-file page.
//   node dev/build-artifact.mjs  →  dist/artifact/page.html  +  dist/artifact/files.json (published path → source path)
//
// The published page is wrapped in a document skeleton by the host, so page.html contains only the
// <title>, styles and body markup of index.html. JS modules, fonts and data ship as side files at the
// same relative paths, so the import map and relative imports keep working unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'artifact');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const posix = (p) => p.split(path.sep).join('/');

const IMPORT_MAP = { 'three': 'vendor/three/three.module.min.js', 'three/addons/': 'vendor/three/addons/' };
function resolveSpec(spec, from) {
  if (spec === 'three') return IMPORT_MAP.three;
  if (spec.startsWith('three/addons/')) return IMPORT_MAP['three/addons/'] + spec.slice('three/addons/'.length);
  if (spec.startsWith('.')) return posix(path.normalize(path.join(path.dirname(from), spec)));
  return null;
}

// Modules loaded through computed dynamic imports (template strings) that a static scan cannot see.
const { MODEL_FILES } = await import(path.join(root, 'src/models/types.js'));
const { CATALOG_FILES } = await import(path.join(root, 'src/catalog/index.js'));
const entries = [
  'src/main.js',
  ...MODEL_FILES.map((f) => `src/models/${f}.js`),
  ...CATALOG_FILES.map((f) => `src/catalog/data/${f}.js`),
];

const seen = new Set();
const missing = [];
function crawl(file) {
  if (seen.has(file)) return;
  if (!exists(file)) { missing.push(file); return; }
  seen.add(file);
  const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const dep = resolveSpec(m[1] || m[2], file);
    if (dep) crawl(dep);
  }
}
entries.forEach(crawl);

// index.html → page fragment
const html = read('index.html');
const head = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [, ''])[1];
const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, html])[1];
const bodyAttrs = (html.match(/<body([^>]*)>/i) || [, ''])[1];
const assets = new Set();

// Inline local stylesheets (resolving @import and collecting url() assets such as fonts).
function inlineCss(file, stack = []) {
  if (stack.includes(file) || !exists(file)) return '';
  let css = read(file);
  css = css.replace(/@import\s+(?:url\()?['"]?([^'")]+)['"]?\)?\s*;/g, (_, spec) => (/^https?:/.test(spec) ? _ : inlineCss(posix(path.normalize(path.join(path.dirname(file), spec))), [...stack, file])));
  css = css.replace(/url\(\s*['"]?(?!data:|https?:|#)([^'")]+)['"]?\s*\)/g, (_, spec) => {
    const clean = spec.split(/[?#]/)[0];
    const p = posix(path.normalize(path.join(path.dirname(file), clean)));
    if (exists(p)) assets.add(p);
    return `url("${p}")`;
  });
  return `/* ${file} */\n${css}\n`;
}

let headOut = head
  .replace(/<meta[^>]*charset[^>]*>/gi, '')
  .replace(/<meta[^>]*name=["']viewport["'][^>]*>/gi, '')
  .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, (tag) => {
    const href = (tag.match(/href=["']([^"']+)["']/) || [])[1];
    if (!href || /^https?:/.test(href)) return tag;
    return `<style>\n${inlineCss(posix(path.normalize(href)))}</style>`;
  })
  .replace(/<link[^>]*rel=["'](?:icon|preload|modulepreload)["'][^>]*>/gi, '');

const page = [
  headOut.trim(),
  '<script>window.APP_ENV = { sandboxed: true };</script>',
  bodyAttrs.trim() ? `<div data-body-attrs ${bodyAttrs.trim()} hidden></div>` : '',
  body.trim(),
].filter(Boolean).join('\n');

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'page.html'), page);
const files = {};
for (const f of [...seen, ...assets].sort()) files[f] = f;
fs.writeFileSync(path.join(out, 'files.json'), JSON.stringify(files, null, 1));
const bytes = Object.values(files).reduce((s, f) => s + fs.statSync(path.join(root, f)).size, 0);
console.log(`page.html ${(page.length / 1024).toFixed(1)} KB · ${Object.keys(files).length} side files · ${(bytes / 1048576).toFixed(2)} MB`);
if (missing.length) console.log('missing (ignored):', missing.join(', '));
