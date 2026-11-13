/**
 * Carpentry quotation package (request for quotation to carpenters) — see docs/CONTRACT.md § 9.
 *
 *   import { buildQuotationPDF, buildQuotationPreview, drawingToSVG } from './carpentry/doc/index.js';
 *   const { bytes, filename } = await buildQuotationPDF({ lang: 'he', project: { … }, src: { store, plan: PLAN } });
 */
import { composeQuotation } from './compose.js';
import { pagesToSVG } from './render-svg.js';
import { docToPDF, loadFonts } from './render-pdf.js';

export { composeQuotation } from './compose.js';
export { pagesToSVG } from './render-svg.js';
export { docToPDF, loadFonts } from './render-pdf.js';
export { drawingToSVG } from './svg.js';
export { visualOrder, bidiLevels, bidiClass, hasRTL, autoDir } from './bidi.js';
export { S as DOC_STRINGS, tr } from './strings.js';

/**
 * Compose and render the PDF.
 * @param {object} options composeQuotation options (+ `fonts` TTF bytes by weight, `fontBase` URL of vendor/fonts/)
 * @returns {Promise<{ bytes: Uint8Array, filename: string, pages: number, doc: object }>}
 */
export async function buildQuotationPDF(options = {}) {
  const doc = composeQuotation(options);
  const bytes = await docToPDF(doc, { fonts: options.fonts, fontBase: options.fontBase });
  return { bytes, filename: doc.meta.filename, pages: doc.pages.length, doc };
}

/**
 * Compose and render the on-screen preview (one SVG string per page).
 * @returns {{ doc: object, svgPages: string[] }}
 */
export function buildQuotationPreview(options = {}) {
  const doc = composeQuotation(options);
  return { doc, svgPages: pagesToSVG(doc, options.svg || {}) };
}

/** Preload the font files (optional: the first PDF build loads them anyway). */
export const preloadFonts = loadFonts;
