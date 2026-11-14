/**
 * Reading the user's file in the browser (nothing leaves the device): file type, PDF pages and thumbnails, the page's
 * vector primitives, page / image pixels, and the compact underlay image stored with the project.
 * Every failure becomes a plain-language `ImportError` the dialog can show as is.
 */
import { readPdf, renderPdfPage, MAX_DWG_BYTES } from '../../import/index.js';
import { openPdf } from '../../import/pdfjs-loader.js';

export const MAX_PDF_BYTES = 80 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
export const MAX_DXF_BYTES = 150 * 1024 * 1024;
const ANALYSE_MAX_PX = 3200;      // raster analysis: long side of the image the engine reads
const UNDERLAY_MAX_PX = 2400;     // stored underlay: long side (≈ 1–2 cm per pixel on a house drawing)

export class ImportError extends Error {
  constructor(message) { super(message); this.name = 'ImportError'; this.plain = true; }
}

/** 'pdf' | 'image' | 'dxf' | 'dwg' from the bytes (magic numbers), falling back to the name / type. Throws ImportError
 *  otherwise. A DWG is read by src/import/dwg-read.js (LibreDWG, WebAssembly) into the same structure as a DXF. */
export async function sniff(file) {
  if (!file) throw new ImportError('No file was chosen.');
  const head = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  const ascii = String.fromCharCode(...head.slice(0, 5));
  const text = String.fromCharCode(...head).replace(/^\uFEFF|^\u00EF\u00BB\u00BF/, '');
  let kind = null;
  if (ascii.startsWith('%PDF')) kind = 'pdf';
  else if (/^AC10\d\d/.test(ascii)) kind = 'dwg';
  else if (text.startsWith('AutoCAD Binary DXF') || /^\s*(0\s*\r?\n\s*SECTION|999\s*\r?\n)/.test(text)) kind = 'dxf';
  else if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) kind = 'image';    // PNG
  else if (head[0] === 0xff && head[1] === 0xd8) kind = 'image';                                         // JPEG
  else if (/\.(pdf)$/i.test(file.name || '') || file.type === 'application/pdf') kind = 'pdf';
  else if (/^image\/(png|jpeg)$/.test(file.type || '')) kind = 'image';
  else if (/\.dxf$/i.test(file.name || '')) kind = 'dxf';
  else if (/\.dwg$/i.test(file.name || '')) kind = 'dwg';
  if (!kind) {
    if (/\.(heic|heif|tiff?|gif|bmp|svg|webp)$/i.test(file.name || '')) throw new ImportError(`“${file.name}” is not a PDF, DWG, DXF, PNG or JPG. Save or export the drawing as one of those (a DWG, DXF or a PDF straight from the drawing program is best) and choose it again.`);
    throw new ImportError(`“${file.name || 'This file'}” is not a PDF, DWG, DXF, PNG or JPG file.`);
  }
  if (kind === 'pdf' && file.size > MAX_PDF_BYTES) throw new ImportError(`This PDF is ${mb(file.size)} — too large to read in the browser (up to ${mb(MAX_PDF_BYTES)}). Save just the plan page as its own PDF and import that.`);
  if (kind === 'dxf' && file.size > MAX_DXF_BYTES) throw new ImportError(`This DXF is ${mb(file.size)} — too large to read in the browser (up to ${mb(MAX_DXF_BYTES)}). In the CAD program, copy just the floor plan into a new drawing (WBLOCK) and save that as DXF.`);
  if (kind === 'dwg' && file.size > MAX_DWG_BYTES) throw new ImportError(`This DWG is ${mb(file.size)} — too large to read in the browser (up to ${mb(MAX_DWG_BYTES)}). In the CAD program, copy just the floor plan into a new drawing (WBLOCK) and save that.`);
  if (kind === 'image' && file.size > MAX_IMAGE_BYTES) throw new ImportError(`This image is ${mb(file.size)} — too large (up to ${mb(MAX_IMAGE_BYTES)}). Save it smaller (about 3000 pixels across is plenty) and import that.`);
  return kind;
}
const mb = (n) => `${Math.round(n / 1048576)} MB`;

/** Plain-language message for anything pdf.js / the browser threw. */
export function plainError(err) {
  if (!err) return 'Something went wrong while reading the file.';
  if (err.plain) return err.message;
  const name = err.name || '', msg = String(err.message || err);
  if (name === 'PasswordException' || /password/i.test(msg)) return 'This PDF is password-protected. Open it in a PDF viewer, save a copy without a password, and import that copy.';
  if (name === 'InvalidPDFException' || /invalid pdf|pdf header/i.test(msg)) return 'This file could not be read as a PDF — it may be damaged or only partly downloaded.';
  if (name === 'MissingPDFException') return 'The PDF is empty.';
  if (/memory|allocation|too large|RangeError/i.test(name + msg)) return 'The drawing is too large to handle in this browser. Try a smaller file, or a PDF with only the plan page.';
  if (/decode|image/i.test(msg)) return 'This image could not be opened. Use a PNG or JPG file.';
  return 'The drawing could not be read (' + msg.slice(0, 120) + ').';
}

/** Number of pages and each page's size in points (cheap: nothing is drawn). */
export async function pdfInfo(bytes) {
  const { doc } = await openPdf(bytes);
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages && i <= 60; i++) {
      const pg = await doc.getPage(i);
      const vp = pg.getViewport({ scale: 1 });
      pages.push({ page: i, w: vp.width, h: vp.height });
    }
    return { pageCount: doc.numPages, pages };
  } finally { doc.destroy(); }
}

/** A page rendered to a <canvas> whose long side is about `longPx` pixels. → { canvas, pxPerUnit, width, height } */
export async function renderPage(bytes, page, longPx, pageSize) {
  const long = Math.max(pageSize.w, pageSize.h) || 1000;
  const pxPerUnit = Math.max(0.05, Math.min(6, longPx / long));
  const canvas = document.createElement('canvas');
  return renderPdfPage(bytes, { page, pxPerUnit, canvas });
}

/** Vector primitives of one page (pdf.js parses in its own worker; walking the operator list is quick). */
export const pagePrims = (bytes, page) => readPdf(bytes, { page });

/** Decode a PNG / JPG into a canvas no larger than the analysis limit. → { canvas, width, height, scaled (canvas px per original px) } */
export async function decodeImage(file) {
  let source = null, w = 0, h = 0;
  try {
    if (typeof createImageBitmap === 'function') { source = await createImageBitmap(file); w = source.width; h = source.height; }
  } catch (e) { source = null; }
  if (!source) {
    const url = URL.createObjectURL(file);
    try {
      source = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new ImportError('This image could not be opened. Use a PNG or JPG file.')); img.src = url; });
      w = source.naturalWidth; h = source.naturalHeight;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  }
  if (!(w > 0 && h > 0)) throw new ImportError('This image is empty.');
  if (w * h > 120e6) throw new ImportError(`This image is ${w} × ${h} pixels — too large to handle in the browser. Save it at about 3000 pixels across and import that.`);
  if (Math.min(w, h) < 200) throw new ImportError(`This image is only ${w} × ${h} pixels — too small to see the walls. Use a larger scan or photo.`);
  const k = Math.min(1, ANALYSE_MAX_PX / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  return { canvas, width: canvas.width, height: canvas.height, scaled: k, originalWidth: w, originalHeight: h };
}

/** RGBA pixels of a canvas as plain data for the engine. */
export function pixelsOf(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return { width: d.width, height: d.height, data: d.data };
}

/**
 * Compact underlay from a canvas region: crop (canvas px), downscale to UNDERLAY_MAX_PX, encode as WebP (or JPEG where
 * WebP encoding is not available). → { image, width, height, k } with k = stored px per canvas px.
 */
export function encodeUnderlay(canvas, crop = { x: 0, y: 0, w: canvas.width, h: canvas.height }) {
  const cx = Math.max(0, Math.floor(crop.x)), cy = Math.max(0, Math.floor(crop.y));
  const cw = Math.min(canvas.width - cx, Math.ceil(crop.w)), ch = Math.min(canvas.height - cy, Math.ceil(crop.h));
  const k = Math.min(1, UNDERLAY_MAX_PX / Math.max(cw, ch));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cw * k)); out.height = Math.max(1, Math.round(ch * k));
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, cx, cy, cw, ch, 0, 0, out.width, out.height);
  let image = out.toDataURL('image/webp', 0.82);
  if (!image.startsWith('data:image/webp')) image = out.toDataURL('image/jpeg', 0.85);
  return { image, width: out.width, height: out.height, k, x: cx, y: cy };
}

export { affThen, affInv, affApply } from './affine.js';
