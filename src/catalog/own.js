/**
 * OWN PRODUCTS — products the user adds by hand from any shop ("Add your own product", docs/CONTRACT.md § 16).
 * Pure logic: no DOM, no store. Used by the store (shape), the catalogue (merge), the dialog (validation, options)
 * and the tests.
 *
 * An own product has the catalogue product shape (§ 6) plus:
 *   { id: 'own-<short id>', own: true, createdAt: ISO string, createdBy?: email, note?: string,
 *     price: number | null, priceOnRequest?: true (then price is null) }
 * Finishes (floor-finish / wall-finish) have no `dims`; their size lives in params.tileW / tileH.
 */
import { MODEL_TYPES, CATEGORIES } from '../models/types.js';

export const OWN_PREFIX = 'own-';
/** Size limits in cm (beyond them the input is refused, not warned). */
export const LIMITS = Object.freeze({ min: 1, minH: 0.5, max: 3000, maxH: 1000, tileMax: 400, priceMax: 10000000, name: 120, text: 400 });
const PRICE_UNITS = ['item', 'm2', 'm'];
const FINISH_TYPES = ['floor-finish', 'wall-finish'];
/** Types that are never offered (made-to-measure carpentry is designed in Carpentry mode). */
const HIDDEN_TYPES = new Set(['carpentry-unit']);

export const isOwnId = (id) => typeof id === 'string' && id.startsWith(OWN_PREFIX);
export const isOwnProduct = (p) => !!(p && (p.own === true || isOwnId(p.id)));
export const isFinishType = (t) => FINISH_TYPES.includes(t);
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** A new own-product id: 'own-' + 8 base-36 characters. */
export function newOwnId(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(rand() * 36).toString(36);
  return OWN_PREFIX + s;
}

/** The app's rule for retailer links (same as components.js `safeUrl`): https only. */
export const isSafeUrl = (url) => typeof url === 'string' && /^https:\/\//i.test(url);

/** "https://www.kaza.co.il/p/123" → "kaza.co.il" ('' when the text is not a link). */
export function shopFromUrl(url) {
  try {
    const host = new URL(str(url)).hostname.toLowerCase();
    return host.replace(/^www\d*\./, '');
  } catch (e) { return ''; }
}

/* ───────────── Kinds of item per category ───────────── */

/**
 * Model types offered for a catalogue category: the types the catalogue's products of that category use (most used
 * first), then — with `all` — every other type of that zone. Finishes categories offer the finish types.
 * @param {'indoor'|'outdoor'} zone  @param {string} category  @param {object[]} products  built-in products
 */
export function typesForCategory(zone, category, products = [], { all = false } = {}) {
  // order: by the category's own sub-category order (sofas before coffee tables in "Living room"), then by use
  const subs = ((CATEGORIES[zone] || []).find((c) => c.id === category) || { sub: [] }).sub;
  const rank = new Map(), counts = new Map();
  for (const p of products) {
    if (!p || p.zone !== zone || p.category !== category || !MODEL_TYPES[p.type] || HIDDEN_TYPES.has(p.type)) continue;
    counts.set(p.type, (counts.get(p.type) || 0) + 1);
    const r = subs.indexOf(p.subcategory);
    const k = r < 0 ? subs.length : r;
    if (!rank.has(p.type) || k < rank.get(p.type)) rank.set(p.type, k);
  }
  if (category === 'finishes') { rank.set('floor-finish', -2); rank.set('wall-finish', -1); }
  const used = [...new Set([...rank.keys(), ...counts.keys()])]
    .sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99) || (counts.get(b) || 0) - (counts.get(a) || 0) || a.localeCompare(b));
  if (!all && used.length) return used;
  const rest = Object.keys(MODEL_TYPES).filter((t) => !used.includes(t) && !HIDDEN_TYPES.has(t) && !isFinishType(t) && (MODEL_TYPES[t].zone === 'both' || MODEL_TYPES[t].zone === zone))
    .sort((a, b) => MODEL_TYPES[a].label.localeCompare(MODEL_TYPES[b].label));
  return [...used, ...rest];
}

/** The sub-category the catalogue uses most for that category + type (else the category's first). */
export function subcategoryFor(zone, category, type, products = []) {
  const counts = new Map();
  for (const p of products) if (p && p.zone === zone && p.category === category && p.type === type && p.subcategory) counts.set(p.subcategory, (counts.get(p.subcategory) || 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];
  const cat = (CATEGORIES[zone] || []).find((c) => c.id === category);
  if (type === 'wall-finish' && cat && cat.sub.includes('wall-paint')) return 'wall-paint';
  return cat && cat.sub[0] ? cat.sub[0] : null;
}

/** Short generic name of a type ("Sofa", "Cabinet"). */
export const typeName = (t) => (MODEL_TYPES[t] ? MODEL_TYPES[t].label.split(' / ')[0].replace(/\s*\(.*\)$/, '') : t);

/* ───────────── Options a type declares (types.js params) ───────────── */

const MAIN_KEYS = ['variant', 'shape', 'species', 'kind', 'seats', 'chaise', 'headboard', 'doors', 'crop', 'plant', 'basins', 'burners', 'frame'];
const MATERIALS = ['fabric', 'leather', 'velvet', 'wood', 'metal', 'rattan', 'plastic', 'glass', 'stone', 'ceramic', 'concrete', 'laminate', 'lacquer', 'aluminium', 'teak', 'textile'];
/** "legHeight" → "Leg height"; "french-door" → "French door". */
export const humanize = (s) => { const t = String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };

/**
 * The options of a type in a form a dialog can render: [{ key, kind: 'enum'|'bool'|'number'|'color', label, options?, main }].
 * `main` = what a non-expert understands at a glance (the first list of choices, the main colour; for finishes the
 * pattern / kind, tile size and colours). Everything else is for "More options".
 */
export function typeOptions(type) {
  const t = MODEL_TYPES[type];
  if (!t) return [];
  const out = [];
  // the choices a non-expert understands at a glance: the first two of these the type declares (else its first list)
  const mainKeys = Object.keys(t.params || {}).filter((k) => MAIN_KEYS.includes(k)).sort((a, b) => MAIN_KEYS.indexOf(a) - MAIN_KEYS.indexOf(b)).slice(0, 2);
  let firstEnum = !mainKeys.length;
  for (const [key, desc] of Object.entries(t.params || {})) {
    const d = String(desc);
    const quoted = [...d.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    let o = null;
    if (/^#hex/.test(d) || key === 'color' || key === 'color2') o = { key, kind: 'color' };
    else if (/^('[^']+'\s*\|\s*)+'[^']+'/.test(d) || /^false\|'/.test(d)) o = { key, kind: 'enum', options: quoted };
    else if (/^boolean/.test(d)) o = { key, kind: 'bool' };
    else if (/^(number|cm|degrees|\d+(\s*[-|]\s*\d+)+|0\.\.1)/.test(d)) o = { key, kind: 'number', unit: /^cm/.test(d) ? 'cm' : '' };
    if (!o) continue;   // free-form values (palettes, lists) are left to the catalogue research
    o.label = key === 'color2' ? 'Second colour' : humanize(key);
    o.main = isFinishType(type) ? ['pattern', 'kind', 'tileW', 'tileH', 'color', 'color2'].includes(key) : mainKeys.includes(key) || (o.kind === 'enum' && firstEnum);
    if (o.kind === 'enum') firstEnum = false;
    out.push(o);
  }
  if (!out.some((o) => o.key === 'color')) out.unshift({ key: 'color', kind: 'color', label: 'Colour', main: true });
  else out.forEach((o) => { if (o.key === 'color') { o.main = true; o.label = 'Colour'; } });
  if (!isFinishType(type)) {
    if (!out.some((o) => o.key === 'color2')) out.push({ key: 'color2', kind: 'color', label: 'Second colour', main: false });
    out.push({ key: 'material', kind: 'enum', label: 'Material', options: MATERIALS, main: false });
  }
  // main first (colour right after the main choice), the rest after
  const main = out.filter((o) => o.main), more = out.filter((o) => !o.main);
  return [...main.filter((o) => o.kind !== 'color'), ...main.filter((o) => o.kind === 'color'), ...more];
}

/** Default size of a type in cm ({ w, d, h }); finishes: a tile size in params instead. */
export const defaultSize = (type) => { const t = MODEL_TYPES[type]; return t ? { ...t.size } : { w: 100, d: 50, h: 80 }; };

/**
 * A warning (not an error) when a size is far from the type's usual proportions: a dimension more than 3× or less
 * than a third of the type's default. Returns '' when it looks plausible.
 */
export function sizeWarning(type, dims) {
  const t = MODEL_TYPES[type];
  if (!t || isFinishType(type) || !dims) return '';
  const s = t.size, odd = [];
  for (const [k, label] of [['w', 'width'], ['d', 'depth'], ['h', 'height']]) {
    const v = +dims[k], ref = s[k];
    if (!(v > 0) || !(ref > 0)) continue;
    if (v > ref * 3.5 || v < ref / 3.5) odd.push(label);
  }
  if (!odd.length) return '';
  return `That ${odd.join(' and ')} is unusual for a ${typeName(type).toLowerCase()} (typically ${s.w} × ${s.d} × ${s.h} cm). Check the sizes on the product page — you can still save it.`;
}

/* ───────────── Validation and the product itself ───────────── */

/** Read a number typed by a person ("1,290", " 85 ") → number or null. */
export function readNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = str(v).replace(/[₪\s]/g, '');
  if (!s) return null;
  const n = Number(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Check what the person typed. `input` = { url, retailer, name, brand, note, price, priceUnit, priceOnRequest, zone,
 * category, subcategory, type, params, dims: { w, d, h } }.
 * @returns {{ ok: boolean, errors: { [field]: string }, warnings: { [field]: string } }}  plain-words messages per field
 *   (fields: url, retailer, name, brand, note, price, type, category, w, d, h, tileW, tileH)
 */
export function validateOwnInput(input = {}) {
  const errors = {}, warnings = {};
  const url = str(input.url);
  if (url) {
    if (/^http:\/\//i.test(url)) errors.url = 'Use the secure link that starts with https://.';
    else if (!isSafeUrl(url) || !shopFromUrl(url)) errors.url = 'This does not look like a web link. Copy the address of the product page (it starts with https://).';
  }
  if (!str(input.retailer)) errors.retailer = 'Write the shop’s name.';
  else if (str(input.retailer).length > LIMITS.name) errors.retailer = 'Keep the shop’s name shorter.';
  if (!str(input.name)) errors.name = 'Give the product a name.';
  else if (str(input.name).length > LIMITS.name) errors.name = `Keep the name under ${LIMITS.name} characters.`;
  if (str(input.brand).length > LIMITS.name) errors.brand = 'Keep the brand shorter.';
  if (str(input.note).length > LIMITS.text) errors.note = `Keep the note under ${LIMITS.text} characters.`;
  if (!input.priceOnRequest) {
    const p = readNumber(input.price);
    if (p == null) errors.price = 'Write the price in shekels, or tick “Price on request”.';
    else if (!(p > 0)) errors.price = 'The price must be more than ₪0.';
    else if (p > LIMITS.priceMax) errors.price = 'That price is too high to be right — check it.';
  }
  const type = input.type;
  if (!type || !MODEL_TYPES[type] || HIDDEN_TYPES.has(type)) errors.type = 'Pick the kind of item.';
  const zone = input.zone === 'outdoor' ? 'outdoor' : 'indoor';
  if (!(CATEGORIES[zone] || []).some((c) => c.id === input.category)) errors.category = 'Pick a category.';
  if (type && MODEL_TYPES[type] && !isFinishType(type)) {
    const dims = input.dims || {};
    for (const [k, label, min, max] of [['w', 'Width', LIMITS.min, LIMITS.max], ['d', 'Depth', LIMITS.min, LIMITS.max], ['h', 'Height', LIMITS.minH, LIMITS.maxH]]) {
      const v = readNumber(dims[k]);
      if (v == null) errors[k] = `${label} in cm is needed.`;
      else if (v < min) errors[k] = `${label} must be at least ${min} cm.`;
      else if (v > max) errors[k] = `${label} can be at most ${max / 100} m.`;
    }
    if (!errors.w && !errors.d && !errors.h) {
      const warn = sizeWarning(type, { w: readNumber(dims.w), d: readNumber(dims.d), h: readNumber(dims.h) });
      if (warn) warnings.size = warn;
    }
  } else if (type && isFinishType(type)) {
    for (const k of ['tileW', 'tileH']) {
      const raw = input.params && input.params[k];
      if (raw == null || raw === '') continue;
      const v = readNumber(raw);
      if (v == null || v <= 0) errors[k] = 'Write the size in cm, or leave it empty.';
      else if (v > LIMITS.tileMax) errors[k] = `At most ${LIMITS.tileMax} cm.`;
    }
  }
  return { ok: !Object.keys(errors).length, errors, warnings };
}

/** Keep only params the type declares (plus the common ones) with sensible values. */
function cleanParams(type, params = {}) {
  const out = {};
  const known = new Set([...typeOptions(type).map((o) => o.key), 'color', 'color2', 'color3', 'material', 'material2', 'style']);
  const opts = new Map(typeOptions(type).map((o) => [o.key, o]));
  for (const [k, v] of Object.entries(params || {})) {
    if (!known.has(k) || v === '' || v == null) continue;
    const o = opts.get(k);
    if (o && o.kind === 'color') { if (/^#[0-9a-f]{6}$/i.test(v)) out[k] = String(v).toLowerCase(); continue; }
    if (o && o.kind === 'number') { const n = readNumber(v); if (n != null && n >= 0) out[k] = n; continue; }
    if (o && o.kind === 'bool') { out[k] = v === true || v === 'true'; continue; }
    if (o && o.kind === 'enum') { if (typeof v === 'string' && o.options.includes(v)) out[k] = v; continue; }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/**
 * Build the product from valid input (call validateOwnInput first). Keeps `id` / `createdAt` / `createdBy` of `prev`
 * (an edit), else makes new ones.
 */
export function buildOwnProduct(input, { prev = null, id = null, now = () => new Date().toISOString(), createdBy = null, products = [] } = {}) {
  const type = input.type, t = MODEL_TYPES[type];
  const zone = input.zone === 'outdoor' ? 'outdoor' : 'indoor';
  const onRequest = !!input.priceOnRequest;
  const finish = isFinishType(type);
  const url = str(input.url);
  const p = {
    id: (prev && prev.id) || id || newOwnId(),
    own: true,
    name: str(input.name),
    ...(str(input.brand) ? { brand: str(input.brand) } : {}),
    retailer: str(input.retailer),
    url: url || null,
    price: onRequest ? null : Math.round(readNumber(input.price) * 100) / 100,
    ...(onRequest ? { priceOnRequest: true } : {}),
    priceUnit: PRICE_UNITS.includes(input.priceUnit) ? input.priceUnit : (finish ? 'm2' : 'item'),
    currency: 'ILS',
    ...(finish ? {} : { dims: { w: readNumber(input.dims.w), d: readNumber(input.dims.d), h: readNumber(input.dims.h) } }),
    type,
    params: cleanParams(type, input.params),
    zone,
    category: input.category,
    subcategory: input.subcategory || subcategoryFor(zone, input.category, type, products),
    placement: t ? t.placement : 'floor',
    tags: ['own'],
    ...(str(input.note) ? { note: str(input.note) } : {}),
    createdAt: (prev && prev.createdAt) || now(),
    ...((prev && prev.createdBy) || createdBy ? { createdBy: (prev && prev.createdBy) || createdBy } : {}),
  };
  if (finish) for (const k of ['tileW', 'tileH']) if (p.params[k] != null && !(p.params[k] > 0)) delete p.params[k];
  return p;
}

/** Dialog input from a product (to edit it) — the inverse of buildOwnProduct. */
export function inputFromProduct(p) {
  return {
    url: p.url || '', retailer: p.retailer || '', name: p.name || '', brand: p.brand || '', note: p.note || '',
    price: p.price != null ? String(p.price) : '', priceUnit: p.priceUnit || 'item', priceOnRequest: p.price == null,
    zone: p.zone === 'outdoor' ? 'outdoor' : 'indoor', category: p.category, subcategory: p.subcategory, type: p.type,
    params: clone(p.params || {}), dims: p.dims ? { ...p.dims } : { ...defaultSize(p.type) },
  };
}

/**
 * Sanitise an own product read from a file, a doc, the library or a peer: the shape above or null (dropped).
 * Never throws.
 */
export function normalizeOwnProduct(raw) {
  try {
    if (!raw || typeof raw !== 'object' || !isOwnId(raw.id) || !/^own-[a-z0-9_-]{1,40}$/i.test(raw.id)) return null;
    if (!MODEL_TYPES[raw.type] || HIDDEN_TYPES.has(raw.type) || typeof raw.name !== 'string' || !raw.name) return null;
    const p = clone(raw);
    p.own = true;
    if (!(typeof p.price === 'number' && p.price > 0)) { p.price = null; p.priceOnRequest = true; } else delete p.priceOnRequest;
    if (!isSafeUrl(p.url)) p.url = null;
    if (typeof p.retailer !== 'string' || !p.retailer) p.retailer = 'Own product';
    if (!PRICE_UNITS.includes(p.priceUnit)) p.priceUnit = isFinishType(p.type) ? 'm2' : 'item';
    if (!isFinishType(p.type) && !(p.dims && p.dims.w > 0 && p.dims.d > 0 && p.dims.h > 0)) p.dims = defaultSize(p.type);
    if (!p.params || typeof p.params !== 'object') p.params = {};
    if (p.zone !== 'outdoor') p.zone = 'indoor';
    if (!(CATEGORIES[p.zone] || []).some((c) => c.id === p.category)) p.category = (CATEGORIES[p.zone][0] || {}).id;
    if (!p.placement) p.placement = MODEL_TYPES[p.type].placement;
    if (!Array.isArray(p.tags)) p.tags = ['own'];
    if (typeof p.createdAt !== 'string') p.createdAt = '';
    return p;
  } catch (e) { return null; }
}

/** Canonical order of a project's own products (the same on every replica): oldest first, ties by id. */
export const ownOrder = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/* ───────────── Items ↔ own products ───────────── */

/** The commercial fields a placed item copies from its product (they follow the product when it is edited). */
export const commercialPatch = (p) => ({ price: p.price == null ? null : p.price, priceUnit: p.priceUnit || 'item', url: p.url || null, retailer: p.retailer || null, brand: p.brand || null });

/** Everything an item takes from an own product when the product is edited (or the item is linked to it). Position, rotation, elevation, level stay. */
export function itemPatchFromProduct(p) {
  const out = { productId: p.id, generic: false, name: p.name, type: p.type, params: clone(p.params || {}), placement: p.placement, ...commercialPatch(p) };
  if (p.dims) Object.assign(out, { w: p.dims.w, d: p.dims.d, h: p.dims.h });
  return out;
}

/** A placed item whose own product was deleted: it stays where it is, with its size, as a generic item. */
export const GENERIC_PATCH = Object.freeze({ productId: null, generic: true, price: null, priceUnit: 'item', url: null, retailer: null, brand: null });

/** Does a placed item still need fixing against the project's own products? Returns a patch or null. */
export function ownItemFix(item, byId) {
  if (!item || !isOwnId(item.productId)) return null;
  const p = byId.get(item.productId);
  if (!p) return { ...GENERIC_PATCH };
  const want = commercialPatch(p), patch = {};
  for (const [k, v] of Object.entries(want)) if ((item[k] ?? null) !== v) patch[k] = v;
  return Object.keys(patch).length ? patch : null;
}
