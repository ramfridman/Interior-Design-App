/**
 * Web Worker of the sketch importer (module worker): the synchronous, plain-data part of the engine runs here so the
 * dialog stays responsive. Messages: { id, type: 'analyse', prims, opts } → analysePrims(prims, opts);
 * { id, type: 'image', image: { width, height, data }, opts } → readImage(image, opts) (without its stroke list);
 * { id, type: 'dxf-read', bytes } → { prims: readDxf(bytes), look: firstLook(prims) };
 * { id, type: 'dxf-analyse', prims, opts } → analyseDxf(prims, opts).
 * Replies { id, ok: true, result } | { id, ok: false, error }.
 */
import * as eng from '../../import/index.js';
import { runEngine } from './engine-client.js';

self.onmessage = (e) => {
  const { id, type, ...payload } = e.data || {};
  try {
    self.postMessage({ id, ok: true, result: runEngine(eng, type, payload) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err), plain: !!(err && err.plain), code: err && err.code });
  }
};
