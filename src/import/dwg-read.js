/**
 * readDwg — an AutoCAD DWG drawing (R13 … 2018 file formats, i.e. AutoCAD 13 to today's AutoCAD, which still saves the
 * 2018 format) read in the browser, a worker or Node, as exactly what readDxf returns (docs/CONTRACT.md § 11.2).
 *
 * How: GNU LibreDWG compiled to WebAssembly (vendor/dwg/, GPL-3.0; loaded only when a DWG is read, never at app start)
 * converts the DWG to DXF text in memory — its own dwg2dxf — and that text goes through readDxf, so units, layers,
 * blocks, inserts, dimensions, hatches, splines … are interpreted by the same code as a DXF file and the rest of the
 * import (dxf.js, the detectors, the dialog) runs unchanged. Nothing leaves the device.
 *
 *   const prims = await readDwg(bytes)    // → readDxf's structure + prims.source = { format: 'dwg', version, release, … }
 *
 * Errors are plain-language Errors with `plain: true` and a `code`: 'dwg-empty', 'dwg-not-dwg', 'dwg-too-big',
 * 'dwg-old-version' (before R13), 'dwg-new-version' (a format newer than 2018), 'dwg-unreadable' (damaged, protected,
 * or a variant the reader does not understand), 'dwg-no-reader' (the reader could not be loaded); readDxf's own
 * 'dxf-empty' (nothing in model space) keeps its code with the wording adapted to DWG.
 */
import { readDxf } from './dxf-read.js';

export const MAX_DWG_BYTES = 40 * 1024 * 1024;

/** DWG version code (first 6 bytes of the file) → the AutoCAD release names that save it. */
export const DWG_VERSIONS = {
  AC1012: 'R13', AC1014: 'R14', AC1015: '2000–2002', AC1018: '2004–2006', AC1021: '2007–2009',
  AC1024: '2010–2012', AC1027: '2013–2017', AC1032: '2018 and later',
};
const OLD = { 'MC0.0': '1.1', 'AC1.2': '1.2', 'AC1.40': '1.4', 'AC1.50': '2.0', 'AC2.10': '2.10', AC1001: '2.2', AC1002: '2.5', AC1003: '2.6', AC1004: 'R9', AC1006: 'R10', AC1009: 'R11 / R12' };

const plainError = (code, text) => Object.assign(new Error(text), { plain: true, code });
const SAVE_AS_DXF = 'Open it in your CAD program and save it as DXF (Save As → DXF), then import that file.';

let compiled = null;   // the WebAssembly module, compiled once per page / worker; each read gets a fresh instance

/** Fetch and compile vendor/dwg/libredwg-web.wasm (our own origin; Node reads the file). */
function wasmModule() {
  if (!compiled) {
    compiled = (async () => {
      const url = new URL('../../vendor/dwg/libredwg-web.wasm', import.meta.url);
      if (url.protocol === 'file:') {
        const fs = await import('node:fs/promises');
        return WebAssembly.compile(await fs.readFile(url));
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (WebAssembly.compileStreaming && /application\/wasm/i.test(res.headers.get('content-type') || '')) {
        try { return await WebAssembly.compileStreaming(res.clone()); } catch (e) { /* fall back to bytes */ }
      }
      return WebAssembly.compile(await res.arrayBuffer());
    })();
    compiled.catch(() => { compiled = null; });
  }
  return compiled;
}

/** A fresh LibreDWG instance (its memory starts small and is dropped with the instance after the read). */
async function libredwg(log) {
  let glue, mod;
  try {
    [glue, mod] = await Promise.all([import('../../vendor/dwg/libredwg-web.js'), wasmModule()]);
  } catch (e) {
    const msg = String((e && e.message) || e);
    // a page whose Content-Security-Policy does not allow WebAssembly ('wasm-unsafe-eval'), or a browser without it
    if (/violates|security polic|unsafe-eval|CompileError|WebAssembly is not defined/i.test(msg) || (typeof WebAssembly === 'undefined')) {
      throw plainError('dwg-no-reader', 'The DWG reader could not be started in this browser: this page’s security settings do not allow it to run. Save the drawing as DXF in your CAD program and import that.');
    }
    throw plainError('dwg-no-reader', `The DWG reader could not be loaded (${msg.slice(0, 80)}). Check the connection and try again, or save the drawing as DXF in your CAD program and import that.`);
  }
  let fail;
  const failed = new Promise((resolve, reject) => { fail = reject; });
  const ready = glue.default({
    print: (s) => log.push(String(s)),
    printErr: (s) => log.push(String(s)),
    instantiateWasm: (imports, receive) => { WebAssembly.instantiate(mod, imports).then((inst) => receive(inst, mod), fail); return {}; },
  });
  try {
    return await Promise.race([ready, failed]);
  } catch (e) {
    throw plainError('dwg-no-reader', `The DWG reader could not be started in this browser (${String((e && e.message) || e).slice(0, 80)}). Save the drawing as DXF in your CAD program and import that.`);
  }
}

/** The version code at the head of a DWG file, or null. */
export function dwgVersion(u8) {
  const head = String.fromCharCode.apply(null, u8.subarray(0, 6));
  if (/^AC10\d\d$/.test(head)) return head;
  if (head.startsWith('MC0.0')) return 'MC0.0';
  if (/^AC[12]\.\d/.test(head)) return head.replace(/\0.*$/, '');
  return null;
}

/**
 * @param {ArrayBuffer|Uint8Array} input the .dwg file's bytes
 * @param {{ cmPerUnit?: number, maxBytes?: number }} [opts] passed on to readDxf (cmPerUnit: override the unit)
 */
export async function readDwg(input, opts = {}) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!u8.length) throw plainError('dwg-empty', 'This DWG file is empty.');
  const max = opts.maxBytes || MAX_DWG_BYTES;
  if (u8.length > max) throw plainError('dwg-too-big', `This DWG file is ${Math.round(u8.length / 1048576)} MB — too large to read in the browser (up to ${Math.round(max / 1048576)} MB). In the CAD program, copy just the floor plan into a new drawing (WBLOCK) and save that.`);
  const ver = dwgVersion(u8);
  if (!ver) {
    const text = String.fromCharCode.apply(null, u8.subarray(0, 64));
    if (/^\s*(0\s*\r?\n\s*SECTION|999\s*\r?\n)/.test(text.replace(/^ï»¿/, ''))) return readDxf(u8, opts);   // a DXF named .dwg
    throw plainError('dwg-not-dwg', 'This file is not a DWG drawing (it does not start like one). Choose the plan’s .dwg or .dxf file, or a PDF of it.');
  }
  if (OLD[ver]) throw plainError('dwg-old-version', `This DWG was saved in the AutoCAD ${OLD[ver]} format (before R13), which cannot be read here. ${SAVE_AS_DXF}`);
  if (!DWG_VERSIONS[ver]) throw plainError('dwg-new-version', `This DWG uses a file format (${ver}) newer than the ones that can be read here (up to the 2018 format). ${SAVE_AS_DXF} An older DWG format (2018 or earlier) works too.`);

  const log = [];
  const M = await libredwg(log);
  let dxf = null, err = 0;
  try {
    M.FS.writeFile('/in.dwg', u8);
    err = M.dwg_write_dxf('/in.dwg', '/out.dxf');
    if (M.FS.analyzePath('/out.dxf').exists) dxf = M.FS.readFile('/out.dxf');
  } catch (e) {
    // a trap inside the converter (out-of-bounds read on a malformed file, out of memory): this instance is dropped
    const oom = /memory|allocat/i.test(String(e && e.message)) && !/out of bounds/i.test(String(e && e.message));
    throw plainError('dwg-unreadable', oom
      ? `This DWG is too large to convert in this browser. ${SAVE_AS_DXF}`
      : `This DWG (AutoCAD ${DWG_VERSIONS[ver]} format) could not be read — the file may be damaged, or written in a way the DWG reader does not understand. ${SAVE_AS_DXF}`);
  }
  // LibreDWG's error bits: ≥ 128 is critical (nothing usable); below that only parts were skipped
  if (!dxf || dxf.length < 64 || err >= 128) {
    throw plainError('dwg-unreadable', `This DWG (AutoCAD ${DWG_VERSIONS[ver]} format) could not be read — the file may be incomplete or damaged, password-protected, or written in a way the DWG reader does not understand. ${SAVE_AS_DXF}`);
  }
  let prims;
  try {
    prims = readDxf(dxf, opts);
  } catch (e) {
    if (e && e.code === 'dxf-empty') throw plainError('dxf-empty', String(e.message).replace(/This DXF file/g, 'This DWG file').replace(/save as DXF and import that/, 'save it and import it again'));
    throw plainError('dwg-unreadable', `This DWG could not be read completely (${String((e && e.message) || e).slice(0, 100)}). ${SAVE_AS_DXF}`);
  }
  for (const w of prims.warnings) w.text = w.text.replace(/before saving the DXF/, 'before saving the drawing');
  if (err) prims.warnings.push({ code: 'dwg-partial', text: 'Some parts of this DWG could not be read and were left out; check the drawing against the original.' });
  prims.source = { format: 'dwg', version: ver, release: DWG_VERSIONS[ver], reader: 'GNU LibreDWG (WebAssembly)', dxfBytes: dxf.length,
    wasmMemoryBytes: M.HEAP8 ? M.HEAP8.length : null, readerLog: log.slice(0, 20) };
  return prims;
}
