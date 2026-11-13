/**
 * Daylight engine: owns the solver state and answers messages. The same code runs inside the Web Worker
 * (worker.js) and — when workers are unavailable (e.g. an opaque-origin sandboxed iframe) — on the main thread,
 * where it time-slices the visibility job so a frame is never blocked for more than ≈ 8 ms.
 *
 * Messages in:
 *   { type: 'scene', input, opts }   new geometry (plan / ceiling / door state) → coarse + fine visibility
 *   { type: 'light', lighting }      new sun / sky / albedo → relight (coalesced: only the latest one is solved)
 * Messages out (via post(msg, transfer)):
 *   { type: 'vis', serial, coarse, ms, patches, links, facades, fieldProbe, fieldWeight, probes }
 *   { type: 'result', serial, coarse, lightmap (Float32 RGBA), field (Uint16 half RGBA), probes, ms, width, height }
 *   { type: 'error', message }
 * Visibility for the last two inputs is cached, so toggling walk mode (doors open / closed) back and forth is instant.
 */
import { buildScene, createVisibilityJob, relight, toHalf } from './solver.js';

export function createEngine(post, { sliceMs = 1e9 } = {}) {
  let S = null, vis = null, visCoarse = true, lighting = null, job = null, serial = 0, key = '';
  const cache = [];                                                         // [{ key, S, vis }] — two newest
  let lightPending = false, timer = 0;
  const later = (fn) => setTimeout(fn, 0);

  function solve() {
    lightPending = false;
    if (!S || !vis || !lighting) return;
    try {
      const L = relight(S, vis, lighting);
      const field = toHalf(L.field);
      post({ type: 'result', serial, coarse: visCoarse, lightmap: L.lightmap, field, probes: L.probes, ms: L.ms, width: S.atlas.width, height: S.atlas.height, iterations: L.iterations },
        [L.lightmap.buffer, field.buffer, L.probes.buffer]);
    } catch (e) { post({ type: 'error', message: String(e && e.stack || e) }); }
  }
  const requestSolve = () => { if (!lightPending) { lightPending = true; later(solve); } };

  function sendVis() {
    const F = S.field;
    post({ type: 'vis', serial, coarse: visCoarse, ms: vis.ms, patches: S.patch.count, links: vis.idx.length, facades: vis.nFacades,
      fieldProbe: F.probe.slice(), fieldWeight: F.weight.slice(), fieldAlpha: F.alpha.slice() });
  }

  function run() {
    timer = 0;
    if (!job) return;
    let done = false;
    try { done = job.step(sliceMs); } catch (e) { job = null; post({ type: 'error', message: String(e && e.stack || e) }); return; }
    if (!done) { timer = setTimeout(run, 0); return; }
    const coarse = job.coarse;
    vis = job.result(); visCoarse = coarse;
    sendVis();
    solve();
    if (coarse) { job = createVisibilityJob(S, { coarse: false }); job.coarse = false; timer = setTimeout(run, 0); }
    else {
      job = null;
      cache.unshift({ key, S, vis }); cache.length = Math.min(cache.length, 2);
    }
  }

  return {
    handle(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'scene') {
        serial = msg.serial || serial + 1;
        key = JSON.stringify(msg.input);
        if (timer) { clearTimeout(timer); timer = 0; }
        const hit = cache.find((c) => c.key === key);
        if (hit) { S = hit.S; vis = hit.vis; visCoarse = false; job = null; sendVis(); solve(); return; }
        try {
          S = buildScene(msg.input, msg.opts || {});
          vis = null;
          job = createVisibilityJob(S, { coarse: true }); job.coarse = true;
          timer = setTimeout(run, 0);
        } catch (e) { S = null; job = null; post({ type: 'error', message: String(e && e.stack || e) }); }
      } else if (msg.type === 'light') {
        lighting = msg.lighting;
        requestSolve();
      }
    },
    dispose() { if (timer) clearTimeout(timer); job = null; S = null; vis = null; cache.length = 0; },
  };
}
