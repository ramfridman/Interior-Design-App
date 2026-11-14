/**
 * Runs the sketch engine's heavy, synchronous work off the main thread. Each task gets a module worker
 * (./worker.js, our own origin); cancelling terminates it, so a long analysis never keeps running in the background.
 * Where workers are unavailable (a sandbox that forbids them) the same code runs on the main thread after a frame,
 * so the progress state is painted first; cancelling then only discards the result.
 *
 *   const task = runTask('analyse', { prims, opts });   // or runTask('image', { image, opts })
 *   task.promise.then(result => …);  task.cancel();     // a cancelled task rejects with { cancelled: true }
 */
let workersBroken = false;
let seq = 0;

/** @returns {{ promise: Promise<object>, cancel(): void, mode: 'worker' | 'main-thread' }} */
export function runTask(type, payload) {
  let worker = null, cancelled = false, settle = null, ranIn = null;
  const id = ++seq;
  const promise = new Promise((resolve, reject) => {
    settle = { resolve, reject };
    const local = () => {
      worker = null;
      requestAnimationFrame(() => setTimeout(async () => {
        if (cancelled) return;
        try {
          const eng = await import('../../import/index.js');
          ranIn = 'main-thread';
          const result = type === 'analyse' ? eng.analysePrims(payload.prims, payload.opts || {}) : eng.readImage(payload.image, payload.opts || {});
          if (type === 'image' && result) result.prims = null;
          if (!cancelled) resolve(result);
        } catch (err) { if (!cancelled) reject(err); }
      }, 30));
    };
    if (workersBroken || typeof Worker === 'undefined') { local(); return; }
    try {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    } catch (e) { workersBroken = true; local(); return; }
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.id !== id) return;
      worker.terminate(); worker = null; ranIn = 'worker';
      if (cancelled) return;
      if (m.ok) resolve(m.result); else reject(new Error(m.error));
    };
    worker.onerror = (e) => {
      // the worker could not start (blocked by the page's sandbox / policy): run here instead
      if (e && e.preventDefault) e.preventDefault();
      if (worker) { worker.terminate(); worker = null; }
      workersBroken = true;
      if (!cancelled) local();
    };
    try {
      worker.postMessage({ id, type, ...payload });   // copied, not transferred: the main-thread fallback may still need it
    } catch (e) { worker.terminate(); worker = null; workersBroken = true; local(); }
  });
  return {
    promise,
    /** Where the task ran ('worker' | 'main-thread'), once it finished. */
    get ranIn() { return ranIn; },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      if (worker) { worker.terminate(); worker = null; }
      settle.reject({ cancelled: true });
    },
  };
}
