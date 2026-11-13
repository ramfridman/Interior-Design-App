/**
 * pagesToSVG(doc) → string[] — one SVG per page for the on-screen preview (page mm as user units, fonts via
 * @font-face of the same TTF files the PDF embeds, text drawn in the same visual order with bidi-override).
 */
import { opsToSVG, fontFaceCSS, TEXT_CSS } from './svg-common.js';
import { PALETTE } from './prims.js';

/**
 * @param {{ pages: object[], lang: string }} doc
 * @param {{ fonts?: boolean, classes?: boolean, width?: string }} [opts] fonts: embed the @font-face rules (default true)
 * @returns {string[]}
 */
export function pagesToSVG(doc, opts = {}) {
  if (!doc || !Array.isArray(doc.pages)) return [];
  const css = `${opts.fonts === false ? '' : fontFaceCSS()}${TEXT_CSS}`;
  return doc.pages.map((p, i) => {
    const [w, h] = p.size;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${opts.width || w + 'mm'}"${opts.width ? '' : ` height="${h}mm"`}`
      + ` class="carp-doc-page carp-doc-${p.orientation}" data-page="${i + 1}" lang="${doc.lang}" style="background:#fff">`
      + `<style>${css}</style><rect x="0" y="0" width="${w}" height="${h}" fill="${PALETTE.paper}"/>`
      + opsToSVG(p.ops, { palette: PALETTE, classes: !!opts.classes }) + '</svg>';
  });
}
