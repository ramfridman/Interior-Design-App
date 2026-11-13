/**
 * drawingToSVG(drawing, opts) — one engine shop drawing as standalone SVG markup for the screen.
 *
 *   el.innerHTML = drawingToSVG(Carp.drawings(runId)[1], { lang: 'he', interactive: true });
 *
 * Options: lang 'en' | 'he' · width / height (CSS size attributes; default: the drawing's paper size in mm at its scale)
 * · padding (mm, default 4) · className · interactive (adds class="op op-<role>" + data-unit-id hooks; default true)
 * · print (black on white, fixed palette) · scale (override the print scale 1:n).
 * Colours follow the app theme through currentColor and CSS variables (--carp-ink, --carp-muted, --carp-accent,
 * --carp-fill-wall, --carp-fill-worktop, …, see SCREEN_PALETTE in prims.js); `print: true` forces black on white.
 * Text uses the browser's bidi (logical text, direction rtl for Hebrew), anchored exactly where the PDF draws it.
 */
import { flattenDrawing, SCREEN_PALETTE, PALETTE } from './prims.js';
import { opsToSVG, TEXT_CSS, fontFaceCSS } from './svg-common.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * @param {object} drawing engine Drawing (Carp.drawings())
 * @param {{ lang?: 'en'|'he', width?: number|string, height?: number|string, padding?: number, className?: string,
 *           interactive?: boolean, print?: boolean, scale?: number, fonts?: boolean }} [opts]
 * @returns {string} `<svg>` markup ('' for a missing drawing)
 */
export function drawingToSVG(drawing, opts = {}) {
  if (!drawing || !drawing.bounds || !Array.isArray(drawing.ops)) return '';
  const lang = opts.lang === 'he' ? 'he' : 'en', pad = Number.isFinite(opts.padding) ? opts.padding : 4;
  const scale = opts.scale || drawing.scale, k = 10 / scale;
  const w = drawing.bounds.w * k + 2 * pad, h = drawing.bounds.h * k + 2 * pad;
  const { ops } = flattenDrawing(drawing, { lang, scale, box: [pad, pad, w - 2 * pad, h - 2 * pad] });
  const print = !!opts.print, interactive = opts.interactive !== false;
  const pal = print ? PALETTE : SCREEN_PALETTE;
  const css = `${opts.fonts === false ? '' : fontFaceCSS()}${TEXT_CSS}`
    + (interactive ? '.op[data-unit-id]{cursor:pointer}.op-unit[data-unit-id]{pointer-events:all}.op-unit[data-unit-id]:hover{fill:var(--carp-accent-tint,rgba(61,124,135,.15))}' : '');
  const size = `${opts.width != null ? ` width="${esc(opts.width)}"` : ` width="${(w).toFixed(1)}mm"`}${opts.height != null ? ` height="${esc(opts.height)}"` : opts.width != null ? '' : ` height="${(h).toFixed(1)}mm"`}`;
  const cls = ['carp-drawing', `carp-drawing-${drawing.kind}`, opts.className].filter(Boolean).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}"${size} class="${esc(cls)}" data-drawing-id="${esc(drawing.id || '')}" data-run-id="${esc(drawing.runId || '')}" data-scale="${scale}" lang="${lang}"`
    + ` style="${print ? 'background:#fff;color:#1c1c1a' : 'color:inherit'}"><style>${css}</style>`
    + (print ? `<rect x="0" y="0" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="#fff"/>` : '')
    + opsToSVG(ops, { palette: pal, classes: interactive, logicalText: true }) + '</svg>';
}
