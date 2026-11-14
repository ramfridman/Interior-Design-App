/**
 * Worktop stone — pure helpers around the researched slab list (src/carpentry/stones.js) and stone suppliers
 * (src/carpentry/stone-suppliers.js). Like the price book, the engine never imports those data files: the UI (and the
 * quotation document) pass them in. A chosen slab is stored on the run as a self-contained snapshot, so take-off,
 * schedules, drawings and the 3D model name and draw it without the data files:
 *
 *   spec.worktop.stone    = StoneRef   (+ worktop.material / thickness / color / colorHex from the slab)
 *   spec.splashback.stone = StoneRef   (splashback.material 'stone'; 'same-as-worktop' uses worktop.stone)
 *   StoneRef = { id, brand, collection, code, name, finish, supplierId, supplierName, supplierNameHe, material, hex, hexFrom, pattern, veinHex, thicknesses }
 *
 * Nothing is invented: every field is copied from the slab / supplier record; a missing value stays null and is shown as
 * "not published".
 */
import { VOCAB, NATURAL_STONE, WORKTOP_THICKNESS } from './spec.js';

const L = (en, he) => ({ en, he });
const r0 = (v) => Math.round(v);

/** True for quarried stone (granite, marble, quartzite, travertine, onyx). */
export const isNaturalStone = (material) => NATURAL_STONE.has(material);

/** Worktop material → its per-running-metre key in the price book (market method). */
export const WORKTOP_RATE_KEY = {
  quartz: 'worktop.quartz.per-m', porcelain: 'worktop.porcelain.per-m', granite: 'worktop.granite.per-m',
  marble: 'worktop.marble-italian.per-m', 'marble-local': 'worktop.marble-local.per-m', quartzite: 'worktop.quartzite-natural.per-m',
  onyx: 'worktop.onyx.per-m',
};
export const worktopRateKey = (material) => WORKTOP_RATE_KEY[material] || `worktop.${material}.per-m`;
/**
 * Cut-out key: natural stone uses the natural-stone cut-out rates; a hob in sintered porcelain too, because that rate's
 * source prices the hob opening for "granite / Dekton" (the sink rate's source names granite only).
 */
export const cutoutRateKey = (kind, material) => (kind === 'hob'
  ? `worktop.cutout.hob${isNaturalStone(material) || material === 'porcelain' ? '.natural-stone' : ''}`
  : `worktop.cutout.sink${isNaturalStone(material) ? '.natural-stone' : ''}`);

/** The stone of the splashback: its own slab ('stone'), the worktop's ('same-as-worktop'), or null. */
export function splashStone(spec) {
  const sb = spec && spec.splashback;
  if (!sb) return null;
  if (sb.material === 'stone') return sb.stone || null;
  if (sb.material === 'same-as-worktop') return (spec.worktop && spec.worktop.stone) || null;
  return null;
}

// ───────────────────────── names ─────────────────────────
const UNBRANDED = /^unbranded/i;
/** "Caesarstone, ICON collection, 5131 Calacatta Nuvo" / Hebrew with brand, collection and model in Latin letters. */
export function stoneName(st) {
  if (!st) return null;
  const code = st.code && !String(st.name || '').includes(String(st.code)) ? `${st.code} ` : '';
  const model = `${code}${st.name || ''}`.trim();
  if (!st.brand || UNBRANDED.test(st.brand)) return L(`${model} (unbranded natural stone)`, `${model} (אבן טבעית ללא מותג)`);
  return L(`${st.brand}, ${st.collection ? `${st.collection} collection, ` : ''}${model}`, `${st.brand}, ${st.collection ? `קולקציית ${st.collection}, ` : ''}${model}`);
}
/** Finish label (vocabulary, else the supplier's own word; null → "finish not published"). */
export function finishLabel(f) {
  if (!f) return L('finish not published', 'גימור לא פורסם');
  return VOCAB.stoneFinish[f] || L(String(f), String(f));
}
/**
 * Full description: name, finish, thickness, supplier — e.g.
 * "Caesarstone, Classico collection, 5141 Frosty Carrina — polished, 20 mm — supplier: Caesarstone Israel".
 */
export function stoneText(st, { thickness, supplier = true } = {}) {
  if (!st) return null;
  const n = stoneName(st), f = finishLabel(st.finish);
  const th = thickness ? L(`, ${thickness} mm`, `, ${thickness} מ״מ`) : L('', '');
  const sup = supplier && (st.supplierName || st.supplierNameHe) ? L(` — supplier: ${st.supplierName || st.supplierNameHe}`, ` — ספק: ${st.supplierNameHe || st.supplierName}`) : L('', '');
  return L(`${n.en} — ${lowerFirst(f.en)}${th.en}${sup.en}`, `${n.he} — ${f.he}${th.he}${sup.he}`);
}
const lowerFirst = (s) => (/^(Velvet|Lapato|Satin|Stone)\b/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

// ───────────────────────── choosing ─────────────────────────
/** The stored snapshot of a slab record with the chosen finish. */
export function stoneRef(rec, { finish, supplier } = {}) {
  const fin = finish && (rec.finishes || []).includes(finish) ? finish : (rec.finishes && rec.finishes.length ? rec.finishes[0] : null);
  return {
    id: rec.id, brand: rec.brand || null, collection: rec.collection || null, code: rec.code || null, name: rec.name, finish: fin,
    supplierId: rec.supplierId || null, supplierName: (supplier && supplier.name) || null, supplierNameHe: (supplier && supplier.nameHe) || null,
    material: rec.material, hex: rec.hex, hexFrom: rec.hexFrom || null, pattern: rec.pattern || 'plain', veinHex: rec.veinHex || null,
    thicknesses: Array.isArray(rec.thicknessesMm) && rec.thicknessesMm.length ? [...rec.thicknessesMm] : null,
  };
}
/** The thickness to store: the requested one if the slab offers it, else 20 / 12 / the first offered; none published → the material default (or `current`). */
export function pickThickness(rec, wanted, current) {
  const t = rec.thicknessesMm;
  if (Array.isArray(t) && t.length) {
    if (wanted != null && t.includes(+wanted)) return +wanted;
    if (current != null && t.includes(+current)) return +current;
    return t.includes(20) ? 20 : t.includes(12) ? 12 : t[0];
  }
  return wanted != null ? +wanted : current != null ? +current : WORKTOP_THICKNESS[rec.material] || 20;
}
/**
 * updateRun patch for choosing `rec` (a STONES record) as the worktop or splashback stone.
 * @param {'worktop'|'splashback'} target
 */
export function stonePatch(rec, { finish, thickness, supplier, current, target = 'worktop' } = {}) {
  const ref = stoneRef(rec, { finish, supplier });
  if (target === 'splashback') return { spec: { splashback: { material: 'stone', stone: ref } } };
  const code = rec.code && !String(rec.name).includes(String(rec.code)) ? `${rec.code} ` : '';
  return { spec: { worktop: { material: rec.material, thickness: pickThickness(rec, thickness, current), color: `${code}${rec.name}`, colorHex: rec.hex, stone: ref } } };
}

// ───────────────────────── picker filters ─────────────────────────
const rgbOf = (hex) => { const n = parseInt(String(hex || '#cccccc').slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** Colour families of a slab: light | grey | dark | warm (by its hex) and veined (by its pattern). */
export function colourFamilies(rec) {
  const [r, g, b] = rgbOf(rec.hex), lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255, chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  const out = new Set();
  if (lum < 0.33) out.add('dark');
  if (lum >= 0.7) out.add('light');
  if (chroma < 0.08 && lum >= 0.33 && lum < 0.85) out.add('grey');
  if (r - b >= 14 && lum >= 0.2) out.add('warm');
  if (rec.pattern === 'veined' || rec.pattern === 'marble-look') out.add('veined');
  return [...out];
}
export const COLOUR_FAMILIES = { light: L('Light', 'בהיר'), grey: L('Grey', 'אפור'), dark: L('Dark', 'כהה'), warm: L('Warm', 'חם'), veined: L('Veined', 'עורקי') };

/** Brands of the list (stable order: most slabs first). */
export function stoneBrands(list) {
  const c = new Map();
  for (const s of list || []) c.set(s.brand, (c.get(s.brand) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([brand, n]) => ({ brand, n }));
}
/**
 * Filter slabs: { material, brand, supplierId, colour, q } ('all' / empty = any). `q` matches name, code, brand,
 * collection and colour text, case-insensitive.
 */
export function filterStones(list, f = {}) {
  const q = String(f.q || '').trim().toLowerCase();
  return (list || []).filter((s) => {
    if (f.material && f.material !== 'all' && s.material !== f.material) return false;
    if (f.brand && f.brand !== 'all' && s.brand !== f.brand) return false;
    if (f.supplierId && f.supplierId !== 'all' && s.supplierId !== f.supplierId) return false;
    if (f.colour && f.colour !== 'all' && !colourFamilies(s).includes(f.colour)) return false;
    if (q && ![s.name, s.code, s.brand, s.collection, s.colourText, s.materialRaw].some((x) => x && String(x).toLowerCase().includes(q))) return false;
    return true;
  });
}

// ───────────────────────── suppliers ─────────────────────────
const brandKey = (b) => String(b || '').toLowerCase().replace(/\(.*?\)/g, '').trim().split(/\s+/)[0];
/**
 * Suppliers that sell or work a slab: the slab's own supplier first (role 'listed'), then businesses whose published
 * notes name the slab's brand (role 'brand'), then those that list its material (role 'material'). Only what the records
 * say — never a guess.
 */
export function suppliersForStone(rec, suppliers) {
  if (!rec) return [];
  const out = [], seen = new Set(), bk = brandKey(rec.brand), branded = rec.brand && !UNBRANDED.test(rec.brand);
  const add = (s, role) => { if (s && !seen.has(s.id)) { seen.add(s.id); out.push({ supplier: s, role }); } };
  add((suppliers || []).find((s) => s.id === rec.supplierId), 'listed');
  if (branded && bk.length > 2) for (const s of suppliers || []) if (worksBrand(s, rec.brand)) add(s, 'brand');
  for (const s of suppliers || []) if ((s.offers || []).includes(rec.material) || (rec.material === 'porcelain' && (s.offers || []).includes('sintered'))) add(s, 'material');
  return out;
}
/** True when the supplier's own record names the brand (name or notes). */
export function worksBrand(s, brand) {
  const bk = brandKey(brand);
  if (!s || !bk || bk.length < 3 || UNBRANDED.test(brand)) return false;
  const hay = `${s.name || ''} ${s.notes || ''} ${(s.brands || []).join(' ')} ${(s.offers || []).join(' ')}`.toLowerCase().replace(/\s+/g, ' ');
  const alt = bk === 'caesarstone' ? ['caesarstone', 'caesar stone'] : [bk];
  return alt.some((k) => hay.includes(k));
}

// ───────────────────────── estimate ─────────────────────────
/** The slab record of a stored StoneRef (null when the list is not supplied or the id is unknown). */
export const stoneRecord = (ref, stones) => (ref && Array.isArray(stones) ? stones.find((s) => s.id === ref.id) || null : null);
/** True if the slab carries a published per-running-metre price. */
export const hasSlabPrice = (rec) => !!(rec && rec.price && rec.price.published && Number.isFinite(rec.price.fromIls) && rec.price.unit === 'm-run');

/**
 * Estimate line from the slab's own published price ("from" ₪ per running metre). Ex VAT = published / (1 + vat): the
 * price is either stated as incl. VAT, or its VAT status is not stated and the price book's rule (treat as incl. VAT)
 * applies. low = typical = the "from" price; high = the material's book rate when that is higher (a "from" price is the
 * lowest the supplier quotes), otherwise the "from" price.
 */
export function slabPriceLine(rec, qty, { vat = 0.18, materialRate = null, materialKey = null, supplier = null, note = null } = {}) {
  const p = rec.price, ex = p.fromIls / (1 + vat);
  const high = materialRate && materialRate.high > ex ? materialRate.high : ex;
  const vatTxt = p.includesVat === true ? L('incl. VAT as published', 'כולל מע״מ כפי שפורסם') : L('VAT status not stated — treated as incl. VAT (price-book rule)', 'מצב המע״מ לא צוין — נחשב ככולל מע״מ (כלל המחירון)');
  const inc = p.includes && p.includes.length ? L(`includes ${p.includes.join(', ')}`, `כולל ${p.includes.map((x) => ({ measurement: 'מדידה', delivery: 'הובלה', installation: 'התקנה' }[x] || x)).join(', ')}`) : null;
  const sName = (supplier && supplier.name) || rec.supplierId, n = stoneName(rec);
  const why = L(`Published price of this very slab: from ₪${r0(p.fromIls).toLocaleString('en-US')} per running metre at ${sName}, as published on ${p.readAt || rec.readAt}${inc ? `, ${inc.en}` : ''}; ${vatTxt.en}. ${p.scope ? `Scope: ${p.scope}. ` : ''}High end ${materialRate && materialRate.high > ex ? `from the ${materialKey} book rate (a "from" price is the lowest quoted)` : 'equals the "from" price'}.`,
    `מחיר שפורסם ללוח זה: החל מ-${r0(p.fromIls)} ₪ למטר רץ אצל ${(supplier && supplier.nameHe) || sName}, כפי שפורסם ב-${p.readAt || rec.readAt}${inc ? `, ${inc.he}` : ''}; ${vatTxt.he}.`);
  return {
    rateKey: `stone:${rec.id}`, rateKeys: materialRate && materialKey && materialRate.high > ex ? [`stone:${rec.id}`, materialKey] : [`stone:${rec.id}`], basis: 'slab',
    label: L(`Worktop: ${n.en} — published slab price, per running metre`, `משטח: ${n.he} — מחיר לוח שפורסם, למטר רץ`), unit: 'm', qty: Math.round(qty * 100) / 100,
    low: qty * ex, typical: qty * ex, high: qty * high, sources: [{ name: `${sName} — ${rec.name}`, url: p.url, date: p.readAt || rec.readAt }],
    confidence: 'low', includes: [inc && inc.en, p.scope].filter(Boolean).join('; ') || null, note, why, fromPrice: true, stoneId: rec.id,
  };
}
