/**
 * Number formatting for the UI. Lengths are stored in cm; the user chooses metres or centimetres (store.ui.units).
 */
import { fmtPrice } from '../core/geometry.js';

export { fmtPrice };

/** Types whose width / depth the user may always change (docs/CONTRACT.md § Item). */
export const RESIZABLE_TYPES = new Set(['surface', 'pool', 'fence', 'hedge', 'flower-bed', 'rug', 'pergola', 'raised-bed']);

/** cm → display value in the chosen unit (number, not string). */
export const toUnit = (cm, units) => (units === 'cm' ? Math.round(cm * 10) / 10 : Math.round(cm) / 100);
/** display value → cm. */
export const fromUnit = (v, units) => (units === 'cm' ? v : v * 100);
/** Decimal places shown for a unit. */
export const unitDigits = (units) => (units === 'cm' ? 0 : 2);

/** "3.15 m" / "315 cm". */
export function fmtLen(cm, units = 'm') {
  if (cm == null || Number.isNaN(cm)) return '—';
  return units === 'cm' ? `${Math.round(cm)} cm` : `${(cm / 100).toFixed(2)} m`;
}

/** Product dimensions are always quoted in cm, as retailers do: "228 × 95 × 83 cm". */
export function fmtDims(w, d, h) {
  const r = (n) => (Math.round(n * 10) / 10).toString();
  if (!(w > 0) || !(d > 0)) return '';
  return h > 0 ? `${r(w)} × ${r(d)} × ${r(h)} cm` : `${r(w)} × ${r(d)} cm`;
}

/** "12.4 m²" */
export const fmtArea = (m2) => (m2 == null || Number.isNaN(m2) ? '—' : `${m2.toFixed(m2 >= 100 ? 0 : 1)} m²`);

/** Suffix shown after a unit price. */
export const priceUnitLabel = (unit) => (unit === 'm2' ? 'per m²' : unit === 'm' ? 'per metre' : '');

/** "₪129 per m²" or "₪2,995". */
export function fmtUnitPrice(price, unit) {
  const suffix = priceUnitLabel(unit);
  return suffix ? `${fmtPrice(price)} ${suffix}` : fmtPrice(price);
}

/** Parse user input such as "3,15" or " 315 " → number or null. */
export function parseNum(text) {
  const v = parseFloat(String(text).replace(',', '.').replace(/[^\d.+-]/g, ''));
  return Number.isFinite(v) ? v : null;
}

/** 15.5 → "15:30" */
export function fmtClock(hours) {
  const h = Math.floor(((hours % 24) + 24) % 24);
  const m = Math.round((hours - Math.floor(hours)) * 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Quantity of an item in its pricing unit: { qty, label } — 1 piece, 12.4 m², 6.0 m. */
export function itemQuantity(item) {
  if (item.priceUnit === 'm2') { const q = (item.w * item.d) / 1e4; return { qty: q, unit: 'm²' }; }
  if (item.priceUnit === 'm') { const q = Math.max(item.w, item.d) / 100; return { qty: q, unit: 'm' }; }
  return { qty: 1, unit: '' };
}
