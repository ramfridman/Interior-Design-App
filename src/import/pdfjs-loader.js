/**
 * Lazy loader for the vendored pdf.js (vendor/pdfjs/). Imported only when a sketch is read, so the app's
 * initial load is unaffected. Works in browsers (worker served from our own origin) and in Node (tests:
 * pdf.js then runs its "fake worker" in-process; rendering to a canvas is browser-only).
 */
const PDFJS_URL = new URL('../../vendor/pdfjs/pdf.min.mjs', import.meta.url);
const WORKER_URL = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url);

let loading = null;
const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';

/** Minimal stand-ins so pdf.js' display layer can be evaluated in Node (it builds a DOMMatrix at load time). */
function installNodeShims() {
  if (!globalThis.DOMMatrix) {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor(m) { const [a, b, c, d, e, f] = Array.isArray(m) && m.length >= 6 ? m : [1, 0, 0, 1, 0, 0]; Object.assign(this, { a, b, c, d, e, f }); }
      multiplySelf(o) { const { a, b, c, d, e, f } = this; this.a = a * o.a + c * o.b; this.b = b * o.a + d * o.b; this.c = a * o.c + c * o.d; this.d = b * o.c + d * o.d; this.e = a * o.e + c * o.f + e; this.f = b * o.e + d * o.f + f; return this; }
      preMultiplySelf(o) { const r = new DOMMatrix([o.a, o.b, o.c, o.d, o.e, o.f]).multiplySelf(this); Object.assign(this, r); return this; }
      invertSelf() { const { a, b, c, d, e, f } = this; const det = a * d - b * c; Object.assign(this, { a: d / det, b: -b / det, c: -c / det, d: a / det, e: (c * f - d * e) / det, f: (b * e - a * f) / det }); return this; }
    };
  }
}

/** @returns {Promise<typeof import('../../vendor/pdfjs/pdf.min.mjs')>} */
export function loadPdfjs() {
  if (!loading) loading = (async () => {
    let restore = null;
    if (isNode) {
      installNodeShims();
      // pdf.js tries to require the optional '@napi-rs/canvas' package in Node and logs a warning; it is not needed
      // for vector reading, so that one start-up message is filtered out.
      const log = console.log;
      console.log = (...a) => { if (typeof a[0] === 'string' && /napi-rs\/canvas|Cannot polyfill/.test(a[0])) return; log(...a); };
      restore = () => { console.log = log; };
    }
    try {
      const pdfjs = await import(PDFJS_URL.href);
      pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL.href;
      return pdfjs;
    } finally { restore?.(); }
  })();
  return loading;
}

/** Open a document from bytes. No eval, no network fetches (fonts / cMaps are not requested from other origins). */
export async function openPdf(bytes) {
  const pdfjs = await loadPdfjs();
  const data = ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) : new Uint8Array(bytes.slice ? bytes.slice(0) : bytes);
  const task = pdfjs.getDocument({
    data, isEvalSupported: false, disableFontFace: false, useSystemFonts: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS, stopAtErrors: false,
  });
  return { pdfjs, doc: await task.promise };
}
