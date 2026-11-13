/**
 * Text measurement with the real Heebo advance widths (metrics-data.js), text sanitising (characters the font lacks
 * are replaced, so neither renderer ever draws a missing-glyph box) and line wrapping.
 * Sizes are in points (pt); widths are returned in millimetres.
 */
import { UPM, CHARS, ADVANCES, CAP_HEIGHT } from './metrics-data.js';

export const PT = 25.4 / 72;                     // mm per point
export const FONT_WEIGHTS = { light: 300, regular: 400, medium: 500, bold: 700 };

const INDEX = new Map(Array.from(CHARS).map((c, i) => [c, i]));
const SUBST = {
  '→': '->', '←': '<-', '↔': '<->', '≈': '~', '≤': '<=', '≥': '>=', '✓': '+', '✔': '+', '☐': '[ ]', '□': '[ ]', '■': '#', '▪': '·',
  '″': '"', '′': "'", ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '‎': '', '‏': '', '\t': ' ', '−': '-',
  '∅': 'Ø', '⌀': 'Ø', 'ⁿ': 'n', '­': '',
};

/** Replace characters the font has no glyph for (Hebrew points are dropped; nikud is not used). */
export function sanitize(s) {
  let out = '';
  for (const c of String(s == null ? '' : s)) {
    if (INDEX.has(c)) out += c;
    else if (SUBST[c] !== undefined) out += SUBST[c];
    else if (/[֑-ׇ]/.test(c)) continue;
    else if (c === '\n') out += c;
    else out += '?';
  }
  return out;
}

const AVG = ADVANCES.regular[INDEX.get('n')];

/** Width of a (sanitised) string in mm at `size` pt and `weight` ('light' | 'regular' | 'medium' | 'bold'). */
export function textWidth(s, size, weight = 'regular') {
  const adv = ADVANCES[weight] || ADVANCES.regular;
  let u = 0;
  for (const c of String(s)) { const i = INDEX.get(c); u += i === undefined ? AVG : adv[i]; }
  return (u / UPM) * size * PT;
}

/** Distance (mm) from the vertical centre of capitals to the baseline for a size in pt. */
export const capHalf = (size) => (CAP_HEIGHT / UPM) * size * PT / 2;

/**
 * Wrap text into lines no wider than `maxW` mm (words; over-long words are broken by character).
 * Explicit '\n' starts a new line. Returns the LOGICAL lines.
 */
export function wrap(s, maxW, size, weight = 'regular') {
  const out = [];
  for (const para of sanitize(s).split('\n')) {
    const words = para.split(/ +/).filter((w, i, a) => w !== '' || a.length === 1);
    let line = '';
    for (let w of words) {
      const cand = line ? line + ' ' + w : w;
      if (textWidth(cand, size, weight) <= maxW || !line && textWidth(w, size, weight) <= maxW) { line = cand; continue; }
      if (line) out.push(line);
      line = '';
      while (textWidth(w, size, weight) > maxW && w.length > 1) {   // break a word that is longer than the line
        let k = w.length - 1;
        while (k > 1 && textWidth(w.slice(0, k), size, weight) > maxW) k--;
        out.push(w.slice(0, k)); w = w.slice(k);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

/** Shorten a single line with an ellipsis so it fits `maxW` mm. */
export function ellipsize(s, maxW, size, weight = 'regular') {
  s = sanitize(s);
  if (textWidth(s, size, weight) <= maxW) return s;
  let k = s.length;
  while (k > 1 && textWidth(s.slice(0, k) + '…', size, weight) > maxW) k--;
  return s.slice(0, k).trimEnd() + '…';
}
