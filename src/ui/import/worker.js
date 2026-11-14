/**
 * Web Worker of the sketch importer (module worker): the synchronous, plain-data part of the engine runs here so the
 * dialog stays responsive. Messages: { id, type: 'analyse', prims, opts } → analysePrims(prims, opts);
 * { id, type: 'image', image: { width, height, data }, opts } → readImage(image, opts) (without its stroke list);
 * { id, type: 'dxf-read', bytes } → { prims: readDxf(bytes), look: firstLook(prims) };
 * { id, type: 'dxf-analyse', prims, opts } → analyseDxf(prims, opts);
 * { id, type: 'stair-check', plan, stairs } → stairVerdicts(plan-edit of this worker, plan, stairs) (several floors).
 * Replies { id, ok: true, result } | { id, ok: false, error }.
 */
import * as eng from '../../import/index.js';
import { runEngine } from './engine-client.js';

self.onmessage = async (e) => {
  const { id, type, ...payload } = e.data || {};
  try {
    // 'stair-check' (several floors): this worker's own plan engine tries the stairs on the built plan
    if (type === 'stair-check') payload.PE = await import('../../core/plan-edit.js');
    self.postMessage({ id, ok: true, result: runEngine(eng, type, payload) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err), plain: !!(err && err.plain), code: err && err.code });
  }
};
