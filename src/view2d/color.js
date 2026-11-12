/**
 * Tiny colour toolkit for the plan renderer: parse any CSS colour once, mix, and re-serialise.
 * Colours are handled as [r, g, b, a] arrays (0-255, alpha 0-1).
 */
const cache = new Map();
let probe = null;

function probeColor(str) {
  if (typeof document === 'undefined') return null;
  if (!probe) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    probe = c.getContext('2d', { willReadFrequently: true });
  }
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = str;                       // invalid strings leave the previous value in place
  const applied = probe.fillStyle;
  if (applied === '#000000' && !/^(#0{3,8}|black|rgba?\(\s*0[\s,]+0[\s,]+0)/i.test(str.trim())) return null;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  if (d[3] === 0) return [0, 0, 0, 0];
  const a = d[3] / 255;
  return [Math.round(d[0] / a), Math.round(d[1] / a), Math.round(d[2] / a), Math.round(a * 100) / 100];
}

/** Parse a CSS colour string → [r, g, b, a], or `fallback` (already an array or string) when it is not a colour. */
export function parseColor(str, fallback = [128, 128, 128, 1]) {
  if (Array.isArray(str)) return str;
  if (typeof str !== 'string' || !str.trim()) return Array.isArray(fallback) ? fallback : parseColor(fallback);
  const key = str.trim();
  if (cache.has(key)) return cache.get(key);
  let out = null;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(key);
  if (hex && (hex[1].length === 6 || hex[1].length === 3)) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
    out = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  } else out = probeColor(key);
  if (!out) out = Array.isArray(fallback) ? fallback : parseColor(fallback);
  cache.set(key, out);
  return out;
}

/** Linear mix of two colours; t = 0 → a, t = 1 → b. */
export function mix(a, b, t) {
  const A = parseColor(a), B = parseColor(b);
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t, (A[3] ?? 1) + ((B[3] ?? 1) - (A[3] ?? 1)) * t];
}

/** Serialise to a CSS colour, optionally overriding alpha. */
export function css(c, alpha) {
  const C = parseColor(c);
  const a = alpha == null ? (C[3] ?? 1) : alpha;
  return `rgba(${Math.round(C[0])},${Math.round(C[1])},${Math.round(C[2])},${Math.round(a * 1000) / 1000})`;
}

/** Perceived lightness 0..1. */
export function luminance(c) {
  const C = parseColor(c);
  return (0.2126 * C[0] + 0.7152 * C[1] + 0.0722 * C[2]) / 255;
}
