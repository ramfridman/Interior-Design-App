/**
 * Catalogue API. Aggregates the product data modules and turns products into placeable items.
 * Product schema: docs/CONTRACT.md § Product.
 */
import { MODEL_TYPES, CATEGORIES } from '../models/types.js';
import { normalizeOwnProduct, isOwnProduct } from './own.js';

export const CATALOG_FILES = ['living-dining', 'bedroom-office', 'kitchen-bath-appliances', 'lighting-decor', 'outdoor-living', 'garden-landscape', 'finishes'];

let PRODUCTS = [];
const BY_ID = new Map();
/**
 * The open project's own products ("Add your own product", CONTRACT § 16) — merged into every query below. Replaced as a
 * whole with setOwnProducts() (the store does it whenever store.customProducts changes); never part of PRODUCTS.
 */
let OWN = [];
const OWN_BY_ID = new Map();
let MERGED = null;
const merged = () => MERGED || (MERGED = OWN.length ? PRODUCTS.concat(OWN) : PRODUCTS);

/**
 * Register / replace the open project's own products (`store.customProducts`). Products that are not own products
 * (id 'own-…') or that cannot be read are ignored; an own id never shadows a catalogue product. Returns the list kept.
 */
export function setOwnProducts(list) {
  OWN = [];
  OWN_BY_ID.clear();
  for (const raw of Array.isArray(list) ? list : []) {
    const p = normalizeOwnProduct(raw);
    if (!p || BY_ID.has(p.id) || OWN_BY_ID.has(p.id)) continue;
    const t = MODEL_TYPES[p.type];
    const prod = { placement: t.placement, currency: 'ILS', tags: [], params: {}, ...p };
    OWN.push(prod); OWN_BY_ID.set(prod.id, prod);
  }
  MERGED = null;
  return OWN;
}
/** The open project's own products (as registered). */
export const ownProducts = () => OWN;
export { isOwnProduct };

export async function loadCatalog() {
  const results = await Promise.allSettled(CATALOG_FILES.map((f) => import(`./data/${f}.js`)));
  PRODUCTS = [];
  BY_ID.clear();
  results.forEach((r, i) => {
    if (r.status === 'rejected') { console.error(`[catalog] failed to load ${CATALOG_FILES[i]}.js`, r.reason); return; }
    for (const p of r.value.default || []) {
      const problem = validateProduct(p);
      if (problem) { console.warn(`[catalog] skipped ${p && p.id}: ${problem}`); continue; }
      if (BY_ID.has(p.id)) { console.warn(`[catalog] duplicate id ${p.id}`); continue; }
      const t = MODEL_TYPES[p.type];
      const prod = { placement: t.placement, zone: t.zone === 'both' ? 'indoor' : t.zone, priceUnit: 'item', currency: 'ILS', tags: [], params: {}, ...p };
      PRODUCTS.push(prod); BY_ID.set(prod.id, prod);
    }
  });
  MERGED = null;
  return PRODUCTS;
}

export function validateProduct(p) {
  if (!p || typeof p !== 'object') return 'not an object';
  if (!p.id || !p.name) return 'missing id/name';
  if (!MODEL_TYPES[p.type]) return `unknown type "${p.type}"`;
  if (typeof p.price !== 'number' || !(p.price > 0)) return 'missing price';
  if (!p.url || !/^https:\/\//.test(p.url)) return 'missing https url';
  if (!p.retailer) return 'missing retailer';
  const isFinish = p.type === 'floor-finish' || p.type === 'wall-finish';
  if (!isFinish && !(p.dims && p.dims.w > 0 && p.dims.d > 0 && p.dims.h > 0)) return 'missing dims';
  if (!p.category) return 'missing category';
  return null;
}

/** Every product: the catalogue, then the open project's own products. */
export const allProducts = () => merged();
/** The built-in catalogue only (no own products). */
export const catalogProducts = () => PRODUCTS;
export const getProduct = (id) => BY_ID.get(id) || OWN_BY_ID.get(id) || null;
export const isFinish = (p) => p.type === 'floor-finish' || p.type === 'wall-finish';

/**
 * Search / filter. All options optional.
 *   { zone, category, subcategory, type, retailer, query, minPrice, maxPrice, sort: 'relevance'|'price-asc'|'price-desc'|'name',
 *     own: true (only the project's own products) }
 * Own products with "price on request" (price null) are left out by a price filter and sorted after the priced ones.
 */
export function searchProducts(opts = {}) {
  const q = (opts.query || '').trim().toLowerCase();
  const words = q ? q.split(/\s+/) : [];
  let out = (opts.own ? OWN : merged()).filter((p) => {
    if (opts.zone && p.zone !== opts.zone) return false;
    if (opts.category && p.category !== opts.category) return false;
    if (opts.subcategory && p.subcategory !== opts.subcategory) return false;
    if (opts.type && p.type !== opts.type) return false;
    if (opts.retailer && p.retailer !== opts.retailer) return false;
    if (opts.minPrice != null && !(p.price >= opts.minPrice)) return false;
    if (opts.maxPrice != null && !(p.price <= opts.maxPrice)) return false;
    if (opts.finishes === false && isFinish(p)) return false;
    if (words.length) {
      const hay = `${p.name} ${p.nameHe || ''} ${p.brand || ''} ${p.retailer} ${p.category} ${p.subcategory || ''} ${p.type} ${(p.tags || []).join(' ')} ${p.description || ''} ${p.note || ''}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const priced = (a, b, f) => (a.price == null ? (b.price == null ? 0 : 1) : b.price == null ? -1 : f(a.price, b.price));
  if (opts.sort === 'price-asc') out = out.slice().sort((a, b) => priced(a, b, (x, y) => x - y));
  else if (opts.sort === 'price-desc') out = out.slice().sort((a, b) => priced(a, b, (x, y) => y - x));
  else if (opts.sort === 'name') out = out.slice().sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function retailers(zone) {
  const m = new Map();
  for (const p of merged()) if (!zone || p.zone === zone) m.set(p.retailer, (m.get(p.retailer) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

export function categoryCounts(zone) {
  const m = {};
  for (const p of merged()) if (!zone || p.zone === zone) m[p.category] = (m[p.category] || 0) + 1;
  return m;
}

/** Products of the same type and similar size — offered by "Swap for…" in the inspector. */
export function alternativesFor(item, limit = 24) {
  return merged().filter((p) => p.type === item.type && p.id !== item.productId && p.dims)
    .map((p) => ({ p, score: Math.abs(p.dims.w - item.w) + Math.abs(p.dims.d - item.d) }))
    .sort((a, b) => a.score - b.score).slice(0, limit).map((x) => x.p);
}

/** Default elevation (cm above floor) for a product given its placement. */
export function defaultElevation(p, ceilingHeight = 300) {
  if (p.elev != null) return p.elev;
  switch (p.placement) {
    case 'ceiling': return Math.max(0, ceilingHeight - p.dims.h);
    case 'surface': return 75;
    case 'wall': {
      const t = p.type;
      if (t === 'kitchen-wall') return 145;
      if (t === 'ac-unit') return Math.max(0, ceilingHeight - p.dims.h - 25);
      if (t === 'curtain') return Math.max(0, Math.min(ceilingHeight - p.dims.h, 10));
      if (t === 'hood') return 150;
      if (t === 'tv') return 95;
      if (t === 'wall-light') return 170;
      if (t === 'towel-rail') return 90;
      if (t === 'shelf-wall') return 140;
      return Math.max(0, 150 - p.dims.h / 2); // art & mirrors: centred at eye level
    }
    default: return 0;
  }
}

/** Build the `partial` to pass to store.addItem() from a catalogue product. */
export function itemFromProduct(p, at = {}, ceilingHeight = 300) {
  return {
    productId: p.id, type: p.type, name: p.name, params: { ...(p.params || {}) },
    w: p.dims.w, d: p.dims.d, h: p.dims.h,
    placement: p.placement, zone: p.zone, elev: defaultElevation(p, ceilingHeight),
    price: p.price == null ? null : p.price, priceUnit: p.priceUnit || 'item', url: p.url || null, retailer: p.retailer, brand: p.brand || null,
    x: at.x ?? 0, y: at.y ?? 0, rot: at.rot ?? 0,
  };
}

/** Cost of one placed item (handles per-m² and per-metre products such as lawn, decking, fences). */
export function itemCost(item) {
  if (item.price == null) return 0;
  if (item.priceUnit === 'm2') return item.price * (item.w * item.d) / 1e4;
  if (item.priceUnit === 'm') return item.price * Math.max(item.w, item.d) / 100;
  return item.price;
}

export { CATEGORIES, MODEL_TYPES };
