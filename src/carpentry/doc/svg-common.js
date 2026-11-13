/**
 * PageOp[] → SVG markup (page millimetres = SVG user units). Shared by the page preview (render-svg.js) and the
 * on-screen drawing renderer (svg.js), so both draw exactly what the PDF renderer draws.
 */
import { color as resolve, PALETTE, DASH, arcPoints } from './prims.js';
import { PT, FONT_WEIGHTS } from './metrics.js';

export const FONT_FAMILY = 'CarpDocHeebo';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => String(Math.round(v * 100) / 100);
const ANCHOR = { left: 'start', center: 'middle', right: 'end' };

/** Extra attributes for role / unit hooks. */
function hooks(o, opts) {
  if (!opts.classes) return '';
  let a = ` class="op${o.role ? ' op-' + esc(o.role) : ''}"`;
  if (o.unitId) a += ` data-unit-id="${esc(o.unitId)}"`;
  return a;
}
function strokeAttrs(o, pal) {
  if (!o.color || !o.lw) return ' stroke="none"';
  let a = ` stroke="${resolve(o.color, pal)}" stroke-width="${n(o.lw)}"`;
  if (o.dash && DASH[o.dash]) a += ` stroke-dasharray="${DASH[o.dash].map(n).join(' ')}"`;
  return a;
}

/**
 * @param {object[]} ops PageOps
 * @param {{ palette?: object, classes?: boolean, logicalText?: boolean }} opts
 *   logicalText: emit the LOGICAL text with direction rtl (selectable, browser bidi) instead of the visual string.
 */
export function opsToSVG(ops, opts = {}) {
  const pal = opts.palette || PALETTE;
  let out = '';
  for (const o of ops) {
    if (o.t === 'line') out += `<line x1="${n(o.x1)}" y1="${n(o.y1)}" x2="${n(o.x2)}" y2="${n(o.y2)}"${strokeAttrs(o, pal)} stroke-linecap="butt"${hooks(o, opts)}/>`;
    else if (o.t === 'rect') out += `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" fill="${o.fill ? resolve(o.fill, pal) : 'none'}"${strokeAttrs(o, pal)}${hooks(o, opts)}/>`;
    else if (o.t === 'poly') {
      const pts = o.pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
      out += `<${o.close ? 'polygon' : 'polyline'} points="${pts}" fill="${o.fill && o.close ? resolve(o.fill, pal) : 'none'}"${strokeAttrs(o, pal)} stroke-linejoin="miter"${hooks(o, opts)}/>`;
    } else if (o.t === 'arc') {
      const pts = arcPoints(o.cx, o.cy, o.r, o.a0, o.a1).map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
      out += `<polyline points="${pts}" fill="none"${strokeAttrs(o, pal)}${hooks(o, opts)}/>`;
    } else if (o.t === 'text' && o.parts) {              // text with vector symbols (glyphs the font lacks)
      out += `<g${hooks(o, opts)}>${opsToSVG(o.parts, { ...opts, classes: false })}</g>`;
    } else if (o.t === 'text') {
      const fs = o.size * PT, rot = o.rot ? ` transform="rotate(${n(-o.rot)} ${n(o.x)} ${n(o.y)})"` : '';
      let anchor = ANCHOR[o.align] || 'start', body = o.vis, style = 'unicode-bidi:bidi-override;direction:ltr';
      if (opts.logicalText && o.dir === 'rtl') {                 // browser bidi; text-anchor is direction-relative
        body = o.text; style = 'unicode-bidi:embed;direction:rtl';
        anchor = anchor === 'start' ? 'end' : anchor === 'end' ? 'start' : anchor;
      }
      out += `<text x="${n(o.x)}" y="${n(o.y)}" font-size="${n(fs)}" font-weight="${FONT_WEIGHTS[o.font] || 400}" fill="${resolve(o.color || 'ink', pal)}" text-anchor="${anchor}" style="${style}"${rot}${hooks(o, opts)}>${esc(body)}</text>`;
    } else if (o.t === 'image') {
      out += `<image x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" href="${esc(o.src)}" xlink:href="${esc(o.src)}" preserveAspectRatio="none"/>`;
    } else if (o.t === 'drawing') {
      out += `<g class="drawing drawing-${esc(o.kind || '')}" data-drawing-id="${esc(o.id || '')}"${o.runId ? ` data-run-id="${esc(o.runId)}"` : ''}>${opsToSVG(o.ops, opts)}</g>`;
    }
  }
  return out;
}

/** CSS @font-face rules for the vendored Heebo TTFs (URLs resolved relative to this module). */
export function fontFaceCSS(base = new URL('../../../vendor/fonts/', import.meta.url).href) {
  const files = { 300: 'Heebo_300Light.ttf', 400: 'Heebo_400Regular.ttf', 500: 'Heebo_500Medium.ttf', 700: 'Heebo_700Bold.ttf' };
  return Object.entries(files).map(([w, f]) => `@font-face{font-family:'${FONT_FAMILY}';font-weight:${w};font-style:normal;src:url('${base}${f}') format('truetype');}`).join('');
}
/** Base text style: same font, no kerning / ligatures (the PDF draws plain advances). */
export const TEXT_CSS = `text{font-family:'${FONT_FAMILY}',Heebo,'Noto Sans Hebrew',Arial,sans-serif;font-kerning:none;font-variant-ligatures:none;white-space:pre;}`;
