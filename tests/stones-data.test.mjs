// Validates src/carpentry/stone-suppliers.js and src/carpentry/stones.js.   node tests/stones-data.test.mjs
import { STONE_SUPPLIERS } from '../src/carpentry/stone-suppliers.js';
import { STONES, NATURAL_STONE_STATEMENTS } from '../src/carpentry/stones.js';

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('FAIL: ' + msg); } };
const hex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const https = (v) => typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v);
const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});

// suppliers
const KINDS = ['brand', 'importer', 'stone-yard', 'fabricator'];
const supIds = new Set();
for (const s of STONE_SUPPLIERS) {
  check(typeof s.id === 'string' && s.id, 'supplier id missing');
  check(!supIds.has(s.id), 'duplicate supplier id ' + s.id);
  supIds.add(s.id);
  check(s.name && s.nameHe, `${s.id}: name / nameHe`);
  check(KINDS.includes(s.kind), `${s.id}: kind ${s.kind}`);
  check(Array.isArray(s.offers) && Array.isArray(s.services), `${s.id}: offers/services arrays`);
  check(s.city && s.cityHe && s.region, `${s.id}: city/region`);
  check(Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.lat > 29 && s.lat < 34 && s.lon > 34 && s.lon < 36, `${s.id}: coordinates`);
  check(typeof s.ownSite === 'boolean' && typeof s.listingOnly === 'boolean', `${s.id}: ownSite/listingOnly`);
  check(Array.isArray(s.sources) && s.sources.length > 0 && s.sources.every((x) => https(x.url) && /^\d{4}-\d{2}-\d{2}$/.test(x.checkedAt) && ['own-site', 'directory'].includes(x.kind)), `${s.id}: sources`);
  check(s.ownSite ? s.sources.every((x) => x.kind === 'own-site') && https(s.website) : s.sources.every((x) => x.kind === 'directory') && s.website === null, `${s.id}: ownSite consistent with sources/website`);
  check(s.phone === null || typeof s.phone === 'string', `${s.id}: phone`);
  if (s.rating) check(Number.isFinite(s.rating.value) && Number.isInteger(s.rating.count) && s.rating.source, `${s.id}: rating needs value, count, source`);
}
// stones
const stoneIds = new Set();
const MATERIALS = ['quartz', 'porcelain', 'granite', 'marble', 'quartzite', 'solid-surface', 'travertine', 'onyx'];
const PATTERNS = ['plain', 'fine-grain', 'veined', 'concrete', 'terrazzo', 'marble-look'];
for (const s of STONES) {
  check(s.id && !stoneIds.has(s.id), 'stone id missing/duplicate ' + s.id);
  stoneIds.add(s.id);
  check(supIds.has(s.supplierId), `${s.id}: unknown supplier ${s.supplierId}`);
  check(s.brand && s.name, `${s.id}: brand/name`);
  check(MATERIALS.includes(s.material), `${s.id}: material ${s.material}`);
  check(hex(s.hex), `${s.id}: hex ${s.hex}`);
  check(['swatch', 'name'].includes(s.hexFrom), `${s.id}: hexFrom`);
  check(s.veinHex === null || hex(s.veinHex), `${s.id}: veinHex`);
  check(PATTERNS.includes(s.pattern), `${s.id}: pattern ${s.pattern}`);
  check(https(s.url), `${s.id}: url`);
  check(s.hexFrom !== 'swatch' || https(s.swatchUrl), `${s.id}: swatch hex needs swatchUrl`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(s.readAt), `${s.id}: readAt`);
  check(s.thicknessesMm === null || (Array.isArray(s.thicknessesMm) && s.thicknessesMm.every(Number.isFinite)), `${s.id}: thicknessesMm`);
  check(s.finishes === null || Array.isArray(s.finishes), `${s.id}: finishes`);
  check(s.price === null || typeof s.price === 'object', `${s.id}: price`);
  if (s.price && s.price.published) check(Number.isFinite(s.price.fromIls) && s.price.unit && https(s.price.url), `${s.id}: published price needs fromIls, unit, url`);
}
for (const q of NATURAL_STONE_STATEMENTS) check(supIds.has(q.supplierId) && q.quoteHe && https(q.url), 'statement ' + q.topic);

console.log(`suppliers: ${STONE_SUPPLIERS.length}`, count(STONE_SUPPLIERS, (s) => s.kind));
console.log('suppliers by region:', count(STONE_SUPPLIERS, (s) => s.region));
console.log(`own site: ${STONE_SUPPLIERS.filter((s) => s.ownSite).length}, directory-only: ${STONE_SUPPLIERS.filter((s) => !s.ownSite).length}, with rating: ${STONE_SUPPLIERS.filter((s) => s.rating).length}`);
console.log(`stones: ${STONES.length}`, count(STONES, (s) => s.material));
console.log('stones by supplier:', count(STONES, (s) => s.supplierId));
console.log('hex source:', count(STONES, (s) => s.hexFrom), '| with published price:', STONES.filter((s) => s.price && s.price.published).length);
console.log(`natural-stone statements: ${NATURAL_STONE_STATEMENTS.length}`);
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('stones-data: OK');
