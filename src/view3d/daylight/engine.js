/**
 * Daylight engine: owns the solver state and answers messages. The same code runs inside the Web Worker
 * (worker.js) and — when workers are unavailable (e.g. an opaque-origin sandboxed iframe) — on the main thread,
 * where it time-slices the visibility job so a frame is never blocked for more than ≈ 8 ms.
 *
 * Messages in:
 *   { type: 'scene', input, opts, level?, serial }  new geometry of one level (plan / ceiling / door state) → coarse +
 *                                    fine visibility. `level` absent = 'L0' (a one-level plan: exactly the old flow)
 *   { type: 'light', lighting }      new sun / sky / albedo / lamps → relight (coalesced: only the latest one is solved);
 *                                    several floors: `lighting.lampsByLevel[level]` are each level's lamps (local m)
 *   { type: 'occluders', boxes, level? }  furniture boxes of a level (solver.setOccluders) → incremental visibility: only
 *                                    the receivers of the rooms whose boxes changed are gathered again
 *   { type: 'levels', ids, active }  several floors: the levels that exist (others are dropped) and the one solved first
 *   { type: 'active', level }        the level shown / walked: its visibility and relights go first
 * Messages out (via post(msg, transfer)), each with `level` when the scene had one:
 *   { type: 'vis', serial, coarse, ms, patches, links, facades, fieldProbe, fieldWeight, probes }
 *   { type: 'result', serial, coarse, lightmap (Float32 RGBA), field (Uint16 half RGBA), probes, ms, width, height, round }
 *   { type: 'error', message }
 * Visibility for the last two inputs of a level is cached, so toggling walk mode (doors open / closed) back and forth
 * is instant.
 *
 * Several floors (stage F6): one context per level (scene, visibility, cache, occluders). Scheduling: the active
 * level's visibility, then pending relights (active level first), then the other levels' visibility (coarse passes
 * before fine ones), in slices of ≤ 40 ms so a time-of-day scrub stays interactive while other levels catch up.
 * Stair voids: after a relight, the irradiance on a level's void portals is passed to the neighbour level as an
 * emitter (solver.portalEmit); a light change is solved in two rounds (active level first in each), so light crosses
 * a void both ways (≈ two exchange iterations; the second round starts from the first round's portal light).
 */
import { buildScene, createVisibilityJob, relight, toHalf, setOccluders, occluderRegions, receiversFor, portalEmit } from './solver.js';

const MULTI_SLICE_MS = 40;

export function createEngine(post, { sliceMs = 1e9 } = {}) {
  const ctxs = new Map();                                                   // level → per-level state
  let lighting = null, active = 'L0', order = ['L0'];
  let timer = 0;
  let queue = [];                                                           // levels waiting for a relight (front first)
  const later = (fn) => setTimeout(fn, 0);
  const multi = () => ctxs.size > 1;

  function ctxOf(level) {
    let c = ctxs.get(level);
    if (!c) {
      c = { level, S: null, vis: null, visCoarse: true, job: null, serial: 0, key: '', cache: [], occ: [], occKey: '[]', portalE: null, hasLevel: false, posted: 0 };
      ctxs.set(level, c);
      if (!order.includes(level)) order.push(level);
    }
    return c;
  }
  const tag = (c, msg) => (c.hasLevel ? { ...msg, level: c.level } : msg);
  /** Levels by priority: the active one, then the others by distance (nearest first). */
  function priority() {
    const ids = order.filter((id) => ctxs.has(id)), a = Math.max(0, ids.indexOf(active));
    return ids.map((id, i) => [id, Math.abs(i - a)]).sort((p, q) => p[1] - q[1] || ids.indexOf(p[0]) - ids.indexOf(q[0])).map((p) => p[0]);
  }
  const anyPortals = () => [...ctxs.values()].some((c) => c.S && c.S.portal && c.S.portal.count);

  /** Stair-void light from the neighbour levels (their last portal irradiance), or null. */
  function emitFor(c) {
    if (!c.S || !c.S.portal || !c.S.portal.count) return null;
    const ids = order.filter((id) => ctxs.has(id)), i = ids.indexOf(c.level);
    let sum = null;
    const add = (e) => { if (!e) return; if (!sum) sum = e; else for (let k = 0; k < sum.length; k++) sum[k] += e[k]; };
    const below = i > 0 ? ctxs.get(ids[i - 1]) : null, above = i + 1 < ids.length ? ctxs.get(ids[i + 1]) : null;
    if (below && below.S && below.portalE) add(portalEmit(c.S, below.S, below.portalE, 'up'));
    if (above && above.S && above.portalE) add(portalEmit(c.S, above.S, above.portalE, 'down'));
    return sum;
  }
  function solveLevel(c, round = 1) {
    if (!c.S || !c.vis || !lighting) return;
    try {
      const lamps = lighting.lampsByLevel ? lighting.lampsByLevel[c.level] || [] : lighting.lamps;
      const L = relight(c.S, c.vis, { ...lighting, lamps, lampsByLevel: undefined, emit: emitFor(c) });
      c.portalE = L.portalE;
      const field = toHalf(L.field);
      c.posted++;
      post(tag(c, { type: 'result', serial: c.serial, coarse: c.visCoarse, lightmap: L.lightmap, field, probes: L.probes, ms: L.ms, width: c.S.atlas.width, height: c.S.atlas.height, iterations: L.iterations, lampStats: L.lampStats, round }),
        [L.lightmap.buffer, field.buffer, L.probes.buffer]);
    } catch (e) { post({ type: 'error', message: String(e && e.stack || e) }); }
  }
  /** A new lighting: every level, active first; with stair voids a second round passes the void light on. */
  function queueAll() {
    const p = priority().filter((id) => { const c = ctxs.get(id); return c.S && c.vis; });
    queue = p.map((id) => [id, 1]);
    if (p.length > 1 && anyPortals()) queue.push(...p.map((id) => [id, 2]));
  }
  /** Re-solve one level now-ish (its visibility changed), ahead of the queue; its void neighbours follow. */
  function queueLevel(level) {
    queue = queue.filter((q) => q[0] !== level);
    queue.unshift([level, 1]);
    const c = ctxs.get(level);
    if (c && c.S && c.S.portal && c.S.portal.count && multi()) {
      const ids = order.filter((id) => ctxs.has(id)), i = ids.indexOf(level);
      for (const n of [ids[i - 1], ids[i + 1]]) if (n && ctxs.get(n).vis && !queue.some((q) => q[0] === n)) queue.push([n, 2]);
    }
  }

  function sendVis(c) {
    const F = c.S.field;
    post(tag(c, { type: 'vis', serial: c.serial, coarse: c.visCoarse, ms: c.vis.ms, patches: c.S.patch.count, links: c.vis.idx.length, facades: c.vis.nFacades,
      incremental: !!c.vis.incremental, redone: c.vis.redone, occluders: c.occ.length,
      fieldProbe: F.probe.slice(), fieldWeight: F.weight.slice(), fieldAlpha: F.alpha.slice() }));
  }

  /** Advance one visibility job by a slice; finished passes are relit at once. */
  function stepJob(c) {
    const job = c.job;
    let done = false;
    try { done = job.step(multi() ? Math.min(sliceMs, MULTI_SLICE_MS) : sliceMs); } catch (e) { c.job = null; post({ type: 'error', message: String(e && e.stack || e) }); return; }
    if (!done) return;
    const coarse = job.coarse;
    c.vis = job.result(); c.visCoarse = coarse;
    sendVis(c);
    if (multi()) queueLevel(c.level); else solveLevel(c);
    if (coarse) { c.job = createVisibilityJob(c.S, { coarse: false }); c.job.coarse = false; }
    else {
      c.job = null;
      const i = c.cache.findIndex((q) => q.S === c.S); if (i >= 0) c.cache.splice(i, 1);
      c.cache.unshift({ key: c.key, occKey: c.occKey, S: c.S, vis: c.vis }); c.cache.length = Math.min(c.cache.length, 2);
    }
  }
  /** One unit of work: the active level's relight, its visibility, the other relights, another level's visibility. */
  function tick() {
    timer = 0;
    const prio = priority();
    const a = ctxs.get(prio[0]);
    const relightNext = () => { const [id, round] = queue.shift(); const c = ctxs.get(id); if (c) solveLevel(c, round); };
    if (queue.length && a && queue[0][0] === a.level) relightNext();
    else if (a && a.job) stepJob(a);
    else if (queue.length) relightNext();
    else {
      const others = prio.slice(1).map((id) => ctxs.get(id)).filter((c) => c.job);
      const c = others.find((q) => q.job.coarse) || others[0];
      if (c) stepJob(c);
    }
    schedule();
  }
  function schedule() {
    if (timer) return;
    const work = queue.length || [...ctxs.values()].some((c) => c.job);
    if (work) timer = setTimeout(tick, 0);
  }

  /** Furniture moved / added / removed: re-rasterise the boxes, gather again only the rooms they touch. */
  function occluders(c, boxes) {
    const prev = c.occ;
    c.occ = Array.isArray(boxes) ? boxes : [];
    const nextKey = JSON.stringify(c.occ);
    if (nextKey === c.occKey) return;
    c.occKey = nextKey;
    if (!c.S) return;
    const sig = (b) => JSON.stringify(b);
    const before = new Map(prev.map((b, i) => [b.id != null ? b.id : '#' + i, sig(b)]));
    const after = new Map(c.occ.map((b, i) => [b.id != null ? b.id : '#' + i, sig(b)]));
    const regions = new Set();
    prev.forEach((b, i) => { const id = b.id != null ? b.id : '#' + i; if (after.get(id) !== before.get(id)) occluderRegions(c.S, b, regions); });
    c.occ.forEach((b, i) => { const id = b.id != null ? b.id : '#' + i; if (after.get(id) !== before.get(id)) occluderRegions(c.S, b, regions); });
    setOccluders(c.S, c.occ);
    for (let i = c.cache.length - 1; i >= 0; i--) if (c.cache[i].S !== c.S) c.cache.splice(i, 1);   // other door states: stale
    if (!regions.size && c.vis) { if (multi()) { queueLevel(c.level); schedule(); } else solveLevel(c); return; }
    if (c.vis && !c.visCoarse && (!c.job || c.job.regions)) {             // idle, or an incremental pass is running: (re)start it
      if (c.job && c.job.regions) for (const r of c.job.regions) regions.add(r);
      const redo = receiversFor(c.S, regions);
      c.job = createVisibilityJob(c.S, { base: c.vis, redo }); c.job.coarse = false; c.job.regions = regions;
    } else { c.job = createVisibilityJob(c.S, { coarse: !c.vis }); c.job.coarse = !c.vis; }
    schedule();
  }

  function scene(msg) {
    const c = ctxOf(msg.level || 'L0');
    c.hasLevel = msg.level != null;
    c.serial = msg.serial || c.serial + 1;
    c.key = JSON.stringify(msg.input);
    const hit = c.cache.find((q) => q.key === c.key && q.occKey === c.occKey);
    if (hit) {
      c.S = hit.S; c.vis = hit.vis; c.visCoarse = false; c.job = null; sendVis(c);
      if (multi()) { queueLevel(c.level); schedule(); } else solveLevel(c);
      return;
    }
    try {
      c.S = buildScene(msg.input, msg.opts || {});
      if (c.occ.length) setOccluders(c.S, c.occ);
      c.vis = null; c.portalE = null;
      queue = queue.filter((q) => q[0] !== c.level);
      c.job = createVisibilityJob(c.S, { coarse: true }); c.job.coarse = true;
      schedule();
    } catch (e) { c.S = null; c.job = null; post({ type: 'error', message: String(e && e.stack || e) }); }
  }

  return {
    handle(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'scene') scene(msg);
      else if (msg.type === 'occluders') {
        try { occluders(ctxOf(msg.level || 'L0'), msg.boxes); } catch (e) { post({ type: 'error', message: String(e && e.stack || e) }); }
      } else if (msg.type === 'light') {
        lighting = msg.lighting;
        if (multi()) { queueAll(); schedule(); }
        else { const c = ctxs.get('L0') || [...ctxs.values()][0]; if (c && !queue.length) { queue = [[c.level, 1]]; schedule(); } }
      } else if (msg.type === 'levels') {
        const ids = Array.isArray(msg.ids) ? msg.ids : ['L0'];
        for (const id of [...ctxs.keys()]) if (!ids.includes(id)) ctxs.delete(id);
        order = ids.slice();
        queue = queue.filter((q) => ctxs.has(q[0]));
        if (msg.active) active = msg.active;
      } else if (msg.type === 'active') {
        if (msg.level && msg.level !== active) { active = msg.level; const front = queue.filter((q) => q[0] === active); queue = [...front, ...queue.filter((q) => q[0] !== active)]; }
      }
    },
    /** Test / debug: per-level state (scene, visibility, memory estimate). */
    debug: () => [...ctxs.values()].map((c) => ({ level: c.level, patches: c.S ? c.S.patch.count : 0, links: c.vis ? c.vis.idx.length : 0, coarse: c.visCoarse, busy: !!c.job, posted: c.posted, bytes: memoryOf(c) })),
    dispose() { if (timer) clearTimeout(timer); timer = 0; queue = []; for (const c of ctxs.values()) { c.job = null; c.S = null; c.vis = null; c.cache.length = 0; } ctxs.clear(); },
  };
}

/** Rough memory (bytes) of a level's solver state: grid, patches, visibility links (current + cached). */
export function memoryOf(c) {
  let b = 0;
  const S = c.S;
  if (S) b += S.nx * S.ny * (1 + 2 + 1 + 1 + 4 * 6) + (S.lv ? S.nx * S.ny * 19 : 0) + S.patch.count * 40 + S.atlas.width * S.atlas.height * 16;
  const seen = new Set();
  for (const v of [c.vis, ...c.cache.map((q) => q.vis)]) if (v && !seen.has(v)) { seen.add(v); b += v.idx.byteLength + v.w.byteLength + v.start.byteLength + v.outdoor.idx.byteLength + v.outdoor.w.byteLength; }
  return b;
}
