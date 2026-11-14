/**
 * Web Worker of the sketch importer (module worker): the synchronous, plain-data part of the engine runs here so the
 * dialog stays responsive. Messages: { id, type: 'analyse', prims, opts } → analysePrims(prims, opts);
 * { id, type: 'image', image: { width, height, data }, opts } → readImage(image, opts) (without its stroke list).
 * Replies { id, ok: true, result } | { id, ok: false, error }.
 */
import { analysePrims, readImage } from '../../import/index.js';

self.onmessage = (e) => {
  const { id, type, prims, image, opts } = e.data || {};
  try {
    let result;
    if (type === 'analyse') result = analysePrims(prims, opts || {});
    else if (type === 'image') { result = readImage(image, opts || {}); result.prims = null; }
    else throw new Error('unknown task ' + type);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
