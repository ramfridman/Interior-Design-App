/**
 * Sketch import engine — public API (framework-free; runs in a browser, a worker or Node).
 * See docs/CONTRACT.md § "Sketch import engine".
 */
export { readPdf, renderPdfPage } from './pdf-read.js';
export { detectScale, scaleFromPoints, STANDARD_SCALES } from './scale.js';
export { detectWalls } from './walls.js';
export { detectOpenings } from './openings.js';
export { normalise } from './normalise.js';
export { readImage, imageToPrims, scaleFromImagePoints } from './raster.js';
export { loadPdfjs } from './pdfjs-loader.js';

import { readPdf } from './pdf-read.js';
import { detectScale } from './scale.js';
import { detectWalls } from './walls.js';
import { detectOpenings } from './openings.js';
import { normalise } from './normalise.js';

/**
 * Whole pipeline for a vector PDF page: read → scale → walls → openings → normalise.
 * @param bytes ArrayBuffer | Uint8Array
 * @param opts { page, scale: { cmPerUnit } | { points, cm } | { ratio }, walls: {…detectWalls options}, rotate, mirror }
 */
export async function importPdfSketch(bytes, opts = {}) {
  const prims = await readPdf(bytes, { page: opts.page || 1 });
  return analysePrims(prims, opts);
}

/** The synchronous part of importPdfSketch (worker-friendly: plain data in, plain data out). */
export function analysePrims(prims, opts = {}) {
  const sc = detectScale(prims, opts.scale || {});
  const warnings = [];
  if (!sc.best) {
    return { walls: [], openings: [], scale: null, scaleCandidates: [], pageBox: prims.pageBox, transform: null,
      warnings: [{ code: 'no-scale', text: 'The scale could not be determined; pick two points a known distance apart.', where: null }],
      stats: {}, confidence: { overall: 0 } };
  }
  if (sc.best.source === 'geometry') warnings.push({ code: 'scale-guessed', text: `Scale ${sc.best.label} was inferred from the drawing's geometry (no readable scale text); confirm it or measure a known distance.`, where: null });
  const big = (prims.images || []).find((im) => im.w * im.h > 0.5 * prims.pageBox.w * prims.pageBox.h);
  if (big && prims.paths.length < 200) warnings.push({ code: 'raster-page', text: 'This page is mostly a scanned image; use the image tracing path (readImage) instead.', where: null });
  const walls = detectWalls(prims, sc.best, opts.walls || {});
  const openings = detectOpenings(prims, walls, sc.best, opts.openings || {});
  const out = normalise({ walls, openings, scale: sc.best, pageBox: prims.pageBox }, { rotate: opts.rotate || 0, mirror: opts.mirror || false });
  out.warnings.unshift(...warnings);
  out.scaleCandidates = sc.candidates;
  out.page = prims.page; out.pageCount = prims.pageCount;
  return out;
}
