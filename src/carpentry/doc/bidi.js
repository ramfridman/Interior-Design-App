/**
 * Unicode bidirectional reordering (UAX #9) for ONE line of text — enough of the algorithm for Hebrew + Latin + digits +
 * punctuation (no Arabic shaping, no explicit embeddings / isolates): weak types W1–W7, paired brackets N0, neutrals N1–N2,
 * implicit levels I1–I2, trailing white space L1, reordering L2 and mirroring L4.
 *
 *   visualOrder('מידות בס״מ: 60 × 90 (K1·B3)', 'rtl')  →  the characters in left-to-right DRAWING order
 *
 * Apply it AFTER line wrapping (UAX #9 reorders per line). pdf-lib draws glyphs strictly left to right, so the PDF
 * renderer draws the visual string; the SVG renderers draw the same string with `unicode-bidi: bidi-override`.
 */

const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«', '‹': '›', '›': '‹' };
const OPEN = { '(': ')', '[': ']', '{': '}' };
const CLOSE = { ')': '(', ']': '[', '}': '{' };

/** Bidi class of a code point (the subset that matters here). */
export function bidiClass(cp) {
  if (cp >= 0x0591 && cp <= 0x05C7 && cp !== 0x05BE && cp !== 0x05C0 && cp !== 0x05C3 && cp !== 0x05C6) return 'NSM';
  if ((cp >= 0x0590 && cp <= 0x05FF) || (cp >= 0xFB1D && cp <= 0xFB4F) || cp === 0x200F) return 'R';
  if ((cp >= 0x0600 && cp <= 0x08FF) || (cp >= 0xFB50 && cp <= 0xFDFF) || (cp >= 0xFE70 && cp <= 0xFEFF)) return 'R';
  if (cp >= 0x30 && cp <= 0x39) return 'EN';
  if (cp === 0xB2 || cp === 0xB3 || cp === 0xB9 || (cp >= 0x2070 && cp <= 0x2079) || (cp >= 0x2080 && cp <= 0x2089)) return 'EN';
  if (cp === 0x2B || cp === 0x2D || cp === 0x2212 || cp === 0x207A || cp === 0x207B) return 'ES';
  if (cp === 0x23 || cp === 0x24 || cp === 0x25 || (cp >= 0xA2 && cp <= 0xA5) || cp === 0xB0 || cp === 0xB1 || cp === 0x2030 || cp === 0x2031
    || (cp >= 0x2032 && cp <= 0x2034) || (cp >= 0x20A0 && cp <= 0x20CF) || cp === 0x2213) return 'ET';
  if (cp === 0x2C || cp === 0x2E || cp === 0x2F || cp === 0x3A || cp === 0xA0 || cp === 0x202F || cp === 0x2044) return 'CS';
  if (cp === 0x20 || cp === 0x0C || (cp >= 0x2000 && cp <= 0x200A) || cp === 0x2028 || cp === 0x205F || cp === 0x3000) return 'WS';
  if (cp === 0x09 || cp === 0x0B || cp === 0x1F) return 'S';
  if (cp === 0x0A || cp === 0x0D || cp === 0x1C || cp === 0x1D || cp === 0x1E || cp === 0x85 || cp === 0x2029) return 'B';
  if ((cp >= 0x200B && cp <= 0x200D) || cp === 0xFEFF || cp === 0xAD) return 'BN';
  if (cp === 0x200E) return 'L';
  if ((cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A) || cp === 0xAA || cp === 0xB5 || cp === 0xBA || (cp >= 0xC0 && cp <= 0x24F && cp !== 0xD7 && cp !== 0xF7)) return 'L';
  if (cp < 0x80 || (cp >= 0xA0 && cp <= 0xBF) || cp === 0xD7 || cp === 0xF7 || (cp >= 0x2010 && cp <= 0x2027) || (cp >= 0x2035 && cp <= 0x206F)
    || (cp >= 0x2100 && cp <= 0x2BFF && !(cp >= 0x2160 && cp <= 0x2188)) || (cp >= 0x3001 && cp <= 0x3003)) return 'ON';
  return 'L';
}

/** True if the text contains right-to-left characters. */
export const hasRTL = (s) => /[֐-׿יִ-ﭏ؀-ࣿ]/.test(String(s || ''));

const isStrongR = (t) => t === 'R' || t === 'EN' || t === 'AN';     // for N0 / N1 numbers count as R
const NEUTRAL = new Set(['B', 'S', 'WS', 'ON', 'BN']);

/**
 * Embedding levels of one line (array parallel to the code points).
 * @param {string[]} chars code points as strings
 * @param {0|1} base paragraph level
 */
export function bidiLevels(chars, base = 0) {
  const n = chars.length, e = base & 1 ? 'R' : 'L';
  const orig = chars.map((c) => bidiClass(c.codePointAt(0)));
  const t = orig.slice();
  // W1: NSM takes the type of the previous character (sos at the start)
  for (let i = 0; i < n; i++) if (t[i] === 'NSM') t[i] = i ? t[i - 1] : e;
  // W4: a single separator between two numbers
  for (let i = 1; i < n - 1; i++) if (t[i - 1] === 'EN' && t[i + 1] === 'EN' && (t[i] === 'ES' || t[i] === 'CS')) t[i] = 'EN';
  // W5: terminators next to European numbers become numbers
  for (let i = 0; i < n; i++) {
    if (t[i] !== 'ET') continue;
    let j = i; while (j < n && t[j] === 'ET') j++;
    if ((i > 0 && t[i - 1] === 'EN') || (j < n && t[j] === 'EN')) for (let k = i; k < j; k++) t[k] = 'EN';
    i = j - 1;
  }
  // W6: remaining separators / terminators are neutral
  for (let i = 0; i < n; i++) if (t[i] === 'ES' || t[i] === 'ET' || t[i] === 'CS') t[i] = 'ON';
  // W7: European numbers after an L context are L
  let last = e;
  for (let i = 0; i < n; i++) { if (t[i] === 'L' || t[i] === 'R') last = t[i]; else if (t[i] === 'EN' && last === 'L') t[i] = 'L'; }
  // N0: paired brackets
  const pairs = [], stack = [];
  for (let i = 0; i < n; i++) {
    if (t[i] !== 'ON') continue;
    const c = chars[i];
    if (OPEN[c]) { if (stack.length >= 63) break; stack.push({ c, i }); }
    else if (CLOSE[c]) {
      for (let s = stack.length - 1; s >= 0; s--) if (stack[s].c === CLOSE[c]) { pairs.push([stack[s].i, i]); stack.length = s; break; }
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const strongOf = (x) => (x === 'L' ? 'L' : isStrongR(x) ? 'R' : null);
  for (const [o, c] of pairs) {
    let inside = null;
    for (let k = o + 1; k < c; k++) { const s = strongOf(t[k]); if (s === e) { inside = e; break; } if (s) inside = s; }
    if (!inside) continue;
    let dir = e;
    if (inside !== e) {
      let before = e;
      for (let k = o - 1; k >= 0; k--) { const s = strongOf(t[k]); if (s) { before = s; break; } }
      dir = before === inside ? inside : e;
    }
    t[o] = t[c] = dir;
    for (const p of [o, c]) for (let k = p + 1; k < n && orig[k] === 'NSM'; k++) t[k] = dir;
  }
  // N1 / N2: neutral sequences
  for (let i = 0; i < n; i++) {
    if (!NEUTRAL.has(t[i])) continue;
    let j = i; while (j < n && NEUTRAL.has(t[j])) j++;
    const prev = i ? strongOf(t[i - 1]) || e : e, next = j < n ? strongOf(t[j]) || e : e;
    const dir = prev === next ? prev : e;
    for (let k = i; k < j; k++) t[k] = dir;
    i = j - 1;
  }
  // I1 / I2
  const lv = t.map((x) => {
    if (base % 2 === 0) return x === 'R' ? base + 1 : x === 'EN' || x === 'AN' ? base + 2 : base;
    return x === 'L' || x === 'EN' || x === 'AN' ? base + 1 : base;
  });
  // L1: trailing white space (and separators) take the paragraph level
  for (let i = n - 1; i >= 0 && (orig[i] === 'WS' || orig[i] === 'S' || orig[i] === 'BN'); i--) lv[i] = base;
  for (let i = 0; i < n; i++) if (orig[i] === 'S' || orig[i] === 'B') { lv[i] = base; for (let k = i - 1; k >= 0 && (orig[k] === 'WS' || orig[k] === 'BN'); k--) lv[k] = base; }
  return lv;
}

/**
 * The characters of one line in left-to-right visual (drawing) order, brackets mirrored inside right-to-left runs.
 * @param {string} text one line (already wrapped)
 * @param {'ltr'|'rtl'} dir paragraph direction
 * @returns {string}
 */
export function visualOrder(text, dir = 'ltr') {
  const s = String(text == null ? '' : text);
  if (!hasRTL(s) && dir !== 'rtl') return s;
  const chars = Array.from(s);
  if (!chars.length) return s;
  const base = dir === 'rtl' ? 1 : 0;
  const lv = bidiLevels(chars, base);
  let idx = chars.map((_, i) => i);
  const max = Math.max(...lv), minOdd = Math.min(...lv.filter((l) => l % 2 === 1).concat([max + 1]));
  for (let L = max; L >= minOdd && L > 0; L--) {
    for (let i = 0; i < idx.length; i++) {
      if (lv[idx[i]] < L) continue;
      let j = i; while (j < idx.length && lv[idx[j]] >= L) j++;
      idx = idx.slice(0, i).concat(idx.slice(i, j).reverse(), idx.slice(j));
      i = j - 1;
    }
  }
  return idx.map((i) => (lv[i] % 2 === 1 && MIRROR[chars[i]] ? MIRROR[chars[i]] : chars[i])).join('');
}

/** Paragraph direction from the first strong character (UAX #9 P2–P3); `fallback` when there is none. */
export function autoDir(text, fallback = 'ltr') {
  for (const c of String(text == null ? '' : text)) {
    const t = bidiClass(c.codePointAt(0));
    if (t === 'R') return 'rtl';
    if (t === 'L') return 'ltr';
  }
  return fallback;
}
