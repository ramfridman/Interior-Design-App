/**
 * Smart snapping. Priorities for a moving item (per axis, first match wins):
 *   0  wall faces      — flush against a wall / window / door plane within ~12 px (two walls → corner snap);
 *                        floor items with a "back" turn it to the wall when their centre is within depth/2 + ~18 px;
 *                        wall-mounted items always attach to the nearest wall face
 *   1  alignment       — edges / centres of other items, centre of a wall run, centre of a window or door
 *   2  grid            — `store.ui.gridStep` applied to the item's leading edge
 * Everything works in plan cm; the pixel thresholds are converted with the current zoom.
 *
 * The snap targets (wall runs, solids, corners) are rebuilt whenever the plan engine replaced `plan.walls` /
 * `plan.openings` — they are never kept across plan revisions. Drawing a new wall has its own snapping:
 * the centre line goes flush with / in line with existing walls, the ends go to wall faces, the rest to the 5 cm grid.
 */
import { wallFaces, itemAABB, itemCorners, pointInPolygon, snapTo, clamp, normDeg, DEG, wallsHitByItem } from '../core/geometry.js';
import { wallSegments } from '../core/plan-edit.js';

const PLAN_GRID = 5;   // cm — the plan engine's grid for walls and openings

/** Types whose footprint may be resized freely (contract § 2); generic placeholders are resizable too. */
export const RESIZABLE = new Set(['surface', 'pool', 'fence', 'hedge', 'flower-bed', 'rug', 'pergola']);
export const isResizable = (it) => !!it && (RESIZABLE.has(it.type) || !!it.generic);

/** Types without a meaningful back — they never auto-rotate towards a wall. */
const NO_BACK = new Set(['rug', 'surface', 'pool', 'spa', 'tree', 'shrub', 'plant', 'planter', 'parasol', 'car', 'fire-pit', 'pouf',
  'table', 'kitchen-island', 'play', 'pergola', 'flower-bed', 'raised-bed', 'hedge', 'fence', 'water-feature', 'garden-decor',
  'outdoor-light', 'lounger', 'floor-lamp', 'table-lamp', 'vase', 'cushion', 'pendant', 'ceiling-light', 'ceiling-fan', 'swing-bench',
  'bar-stool', 'chair', 'office-chair', 'cooktop', 'microwave', 'utility', 'shed']);
const hasBack = (it) => it.placement === 'floor' && !NO_BACK.has(it.type);

/** Rotation that puts an item's back on a face whose outward normal is (nx, ny). */
export const faceRot = (nx, ny) => normDeg(Math.round(Math.atan2(-nx, ny) / DEG));

/**
 * Wall runs: collinear wall faces merged across door / window openings.
 * { horiz, c, a0, a1, nx, ny, openings: [{ o, a0, a1 }] } — `c` is the constant coordinate, a0..a1 the extent.
 */
export function buildRuns(plan) {
  const segs = wallFaces(plan).map((f) => ({ ...f, o: null }));
  for (const o of plan.openings) {
    if (o.axis === 'h') {
      segs.push({ x1: o.x, y1: o.y, x2: o.x + o.w, y2: o.y, nx: 0, ny: -1, o }, { x1: o.x, y1: o.y + o.h, x2: o.x + o.w, y2: o.y + o.h, nx: 0, ny: 1, o });
    } else {
      segs.push({ x1: o.x, y1: o.y, x2: o.x, y2: o.y + o.h, nx: -1, ny: 0, o }, { x1: o.x + o.w, y1: o.y, x2: o.x + o.w, y2: o.y + o.h, nx: 1, ny: 0, o });
    }
  }
  const groups = new Map();
  for (const s of segs) {
    const horiz = s.ny !== 0;
    const item = { horiz, c: horiz ? s.y1 : s.x1, a0: horiz ? Math.min(s.x1, s.x2) : Math.min(s.y1, s.y2), a1: horiz ? Math.max(s.x1, s.x2) : Math.max(s.y1, s.y2), nx: s.nx, ny: s.ny, o: s.o };
    const key = `${s.nx}|${s.ny}|${item.c}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const runs = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.a0 - b.a0);
    let cur = null;
    for (const s of list) {
      if (cur && s.a0 <= cur.a1 + 0.01) cur.a1 = Math.max(cur.a1, s.a1);
      else { cur = { horiz: s.horiz, c: s.c, a0: s.a0, a1: s.a1, nx: s.nx, ny: s.ny, openings: [] }; runs.push(cur); }
      if (s.o) cur.openings.push({ o: s.o, a0: s.a0, a1: s.a1 });
    }
  }
  return runs;
}

const boxOf = (b) => ({ lo: [b.x, b.y], hi: [b.x + b.w, b.y + b.h] });

export function createSnapper({ plan, store }) {
  let runs = [], solids = [], corners = [], rev = null;
  /** Rebuild the snap targets if the plan was edited since they were built. */
  function sync() {
    if (rev && rev.walls === plan.walls && rev.openings === plan.openings && rev.outline === plan.wallOutline) return;
    rev = { walls: plan.walls, openings: plan.openings, outline: plan.wallOutline };
    runs = buildRuns(plan);
    solids = [...plan.walls, ...plan.openings];
    corners = [...new Map(plan.wallOutline.flatMap(([x1, y1, x2, y2]) => [[`${x1},${y1}`, [x1, y1]], [`${x2},${y2}`, [x2, y2]]])).values()];
  }
  const threshold = (scale, px = 12) => clamp(px / scale, 1.5, 40);

  const others = (exclude) => store.items.filter((it) => !it.hidden && !(exclude && exclude.has(it.id)));

  /** Candidates for moving `box` along axis i (0 = x, 1 = y). */
  function axisCandidates(i, box, thr, opts) {
    const j = 1 - i, out = [];
    const lo = box.lo[i], hi = box.hi[i], mid = (lo + hi) / 2, p0 = box.lo[j], p1 = box.hi[j];
    const line = (v, q0, q1, kind) => (i === 0 ? { x1: v, y1: q0, x2: v, y2: q1, kind } : { x1: q0, y1: v, x2: q1, y2: v, kind });

    for (const r of runs) {
      if (r.horiz === (i === 0)) {
        // run parallel to the motion axis: offer its centre (and its openings' centres) for centring
        const s = (r.horiz ? r.ny : r.nx) > 0 ? p0 - r.c : r.c - p1;
        if (s < -1) continue;
        if (s <= 220 && r.a1 - r.a0 >= 60 && mid > r.a0 && mid < r.a1) {
          const c = (r.a0 + r.a1) / 2;
          out.push({ delta: c - mid, tier: 1, guide: line(c, Math.min(r.c, p0), Math.max(r.c, p1), 'center') });
        }
        if (s <= 450) {
          for (const op of r.openings) {
            const c = (op.a0 + op.a1) / 2;
            out.push({ delta: c - mid, tier: 1, guide: line(c, Math.min(r.c, p0), Math.max(r.c, p1), 'center') });
          }
        }
        continue;
      }
      // run perpendicular to the motion axis: flush snap of the facing edge
      if (Math.min(p1, r.a1) - Math.max(p0, r.a0) < 1) continue;
      const n = r.horiz ? r.ny : r.nx;
      out.push({ delta: r.c - (n > 0 ? lo : hi), tier: 0, guide: line(r.c, Math.max(r.a0, p0 - 15), Math.min(r.a1, p1 + 15), 'wall') });
    }
    for (const it of others(opts.exclude)) {
      const b = boxOf(itemAABB(it));
      const gap = Math.max(0, b.lo[j] - p1, p0 - b.hi[j]);
      if (gap > 320 || Math.max(0, b.lo[i] - hi, lo - b.hi[i]) > 700) continue;
      const q0 = Math.min(p0, b.lo[j]), q1 = Math.max(p1, b.hi[j]);
      const bm = (b.lo[i] + b.hi[i]) / 2;
      out.push(
        { delta: b.lo[i] - lo, tier: 1, guide: line(b.lo[i], q0, q1, 'align') },
        { delta: b.hi[i] - hi, tier: 1, guide: line(b.hi[i], q0, q1, 'align') },
        { delta: b.hi[i] - lo, tier: 1, guide: line(b.hi[i], q0, q1, 'align') },
        { delta: b.lo[i] - hi, tier: 1, guide: line(b.lo[i], q0, q1, 'align') },
        { delta: bm - mid, tier: 1, guide: line(bm, q0, q1, 'center') },
      );
    }
    return out;
  }

  function pick(cands, thr, gridDelta) {
    let best = null;
    for (const c of cands) {
      const lim = c.tier === 0 ? thr : thr * 0.75;
      if (Math.abs(c.delta) > lim) continue;
      if (!best || c.tier < best.tier || (c.tier === best.tier && Math.abs(c.delta) < Math.abs(best.delta))) best = c;
    }
    if (!best) return { delta: gridDelta, guides: [] };
    const guides = [];
    for (const c of cands) if (c.tier <= 1 && Math.abs(c.delta - best.delta) < 0.05 && guides.length < 4) guides.push(c.guide);
    return { delta: best.delta, guides };
  }

  /**
   * Snap a moving axis-aligned box.
   * @param b     { x, y, w, h } proposed position
   * @param opts  { scale, exclude:Set, lockX, lockY }
   * @returns {{ dx:number, dy:number, guides:object[] }}
   */
  function snapBox(b, opts) {
    sync();
    const thr = threshold(opts.scale), step = store.ui.gridStep || 0;
    const box = boxOf(b);
    const res = { dx: 0, dy: 0, guides: [] };
    if (!opts.lockX) {
      const r = pick(axisCandidates(0, box, thr, opts), thr, step ? snapTo(b.x, step) - b.x : 0);
      res.dx = r.delta; res.guides.push(...r.guides);
    }
    if (!opts.lockY) {
      const r = pick(axisCandidates(1, box, thr, opts), thr, step ? snapTo(b.y, step) - b.y : 0);
      res.dy = r.delta; res.guides.push(...r.guides);
    }
    // guides were computed before the other axis moved — shift them along
    for (const g of res.guides) {
      if (g.x1 === g.x2) { g.y1 += Math.min(0, res.dy); g.y2 += Math.max(0, res.dy); } else { g.x1 += Math.min(0, res.dx); g.x2 += Math.max(0, res.dx); }
    }
    return res;
  }

  /** The wall run an item's back should go to, given its proposed centre — or null. */
  function backRun(it, reach, state) {
    let best = null;
    for (const r of runs) {
      const s = r.horiz ? (it.y - r.c) * r.ny : (it.x - r.c) * r.nx;
      const a = r.horiz ? it.x : it.y;
      if (s < -2 || s > it.d / 2 + reach || a < r.a0 - 2 || a > r.a1 + 2) continue;
      const score = s - (state && state.run === r ? 4 : 0);     // hysteresis: stay with the current wall
      if (!best || score < best.score) best = { score, r };
    }
    if (state) state.run = best ? best.r : null;
    return best ? best.r : null;
  }

  /** Wall-mounted items: glue the back to the nearest wall face and slide along it. */
  function attachToWall(it, res, thr, opts) {
    let best = null;
    for (const r of runs) {
      const s = r.horiz ? (it.y - r.c) * r.ny : (it.x - r.c) * r.nx;
      if (s < -30) continue;
      const a = clamp(r.horiz ? it.x : it.y, r.a0, r.a1);
      const dist = Math.hypot(Math.abs(s), (r.horiz ? it.x : it.y) - a) + (s < 0 ? 20 : 0) - (opts.state && opts.state.run === r ? 6 : 0);
      if (!best || dist < best.dist) best = { dist, r };
    }
    if (!best || best.dist > 180) { if (opts.state) opts.state.run = null; return res; }
    const r = best.r;
    if (opts.state) opts.state.run = r;
    const len = r.a1 - r.a0, half = it.w / 2;
    let a = r.horiz ? it.x : it.y;
    a = len >= it.w ? clamp(a, r.a0 + half, r.a1 - half) : (r.a0 + r.a1) / 2;
    // along-wall snapping: ends, centre of the wall, centres of its openings, neighbours on the same wall, grid
    const cands = [{ v: r.a0 + half, kind: 'wall' }, { v: r.a1 - half, kind: 'wall' }, { v: (r.a0 + r.a1) / 2, kind: 'center' }];
    for (const op of r.openings) cands.push({ v: (op.a0 + op.a1) / 2, kind: 'center' });
    for (const o of others(opts.exclude)) {
      if (o.placement !== 'wall') continue;
      const b = itemAABB(o), near = r.horiz ? Math.abs((b.y + b.h / 2) - r.c) : Math.abs((b.x + b.w / 2) - r.c);
      if (near > 60) continue;
      const lo = r.horiz ? b.x : b.y, hi = lo + (r.horiz ? b.w : b.h);
      cands.push({ v: lo - half, kind: 'align' }, { v: hi + half, kind: 'align' }, { v: (lo + hi) / 2, kind: 'center' });
    }
    let hit = null;
    for (const c of cands) if (Math.abs(c.v - a) <= thr && (!hit || Math.abs(c.v - a) < Math.abs(hit.v - a))) hit = c;
    const step = store.ui.gridStep || 0;
    if (hit) a = hit.v; else if (step) a = clamp(snapTo(a - half, step) + half, Math.min(r.a0 + half, r.a1 - half), Math.max(r.a0 + half, r.a1 - half));
    res.rot = faceRot(r.nx, r.ny);
    res.x = r.horiz ? a : r.c + r.nx * it.d / 2;
    res.y = r.horiz ? r.c + r.ny * it.d / 2 : a;
    res.attached = r;
    if (hit && hit.kind !== 'wall') {
      const reach = it.d + 40;
      res.guides.push(r.horiz
        ? { x1: a, y1: r.c - r.ny * 10, x2: a, y2: r.c + r.ny * reach, kind: hit.kind }
        : { x1: r.c - r.nx * 10, y1: a, x2: r.c + r.nx * reach, y2: a, kind: hit.kind });
    }
    res.guides.push(r.horiz
      ? { x1: a - half, y1: r.c, x2: a + half, y2: r.c, kind: 'wall' }
      : { x1: r.c, y1: a - half, x2: r.c, y2: a + half, kind: 'wall' });
    return res;
  }

  /**
   * Snap one item being dragged or placed.
   * @param it    proposed pose { x, y, w, d, rot, placement, type }
   * @param opts  { scale, enabled, autoOrient, exclude:Set, state:{} (kept by the caller for the whole gesture) }
   * @returns {{ x, y, rot, guides, attached }}
   */
  function snapItem(it, opts) {
    sync();
    const res = { x: it.x, y: it.y, rot: it.rot || 0, guides: [], attached: null };
    if (!opts.enabled) return res;
    const thr = threshold(opts.scale);
    if (it.placement === 'wall') return attachToWall(it, res, thr, opts);
    let lockX = false, lockY = false;
    if (opts.autoOrient && hasBack(it)) {
      const r = backRun(it, Math.max(10, threshold(opts.scale, 18)), opts.state);
      if (r) {
        res.rot = faceRot(r.nx, r.ny);
        if (r.horiz) { res.y = r.c + r.ny * it.d / 2; lockY = true; } else { res.x = r.c + r.nx * it.d / 2; lockX = true; }
        res.attached = r;
      }
    }
    // keep a wall-backed item within the length of its wall (so it tucks into the corner instead of piercing it)
    const within = (v, r) => (r.a1 - r.a0 >= it.w ? clamp(v, r.a0 + it.w / 2, r.a1 - it.w / 2) : v);
    if (res.attached) { if (res.attached.horiz) res.x = within(res.x, res.attached); else res.y = within(res.y, res.attached); }
    const pose = { ...it, x: res.x, y: res.y, rot: res.rot };
    const s = snapBox(itemAABB(pose), { ...opts, lockX, lockY });
    res.x += s.dx; res.y += s.dy; res.guides = s.guides;
    if (res.attached) { if (res.attached.horiz) res.x = within(res.x, res.attached); else res.y = within(res.y, res.attached); }
    if (res.attached) {
      const r = res.attached, b = itemAABB({ ...pose, x: res.x, y: res.y });
      res.guides.push(r.horiz ? { x1: b.x, y1: r.c, x2: b.x + b.w, y2: r.c, kind: 'wall' } : { x1: r.c, y1: b.y, x2: r.c, y2: b.y + b.h, kind: 'wall' });
    }
    return res;
  }

  /** Snap a single coordinate (a resize edge) on axis i; p0..p1 is the edge's extent on the other axis. */
  function snapCoord(i, value, p0, p1, opts) {
    sync();
    if (!opts.enabled) return { value, guides: [] };
    const thr = threshold(opts.scale), j = 1 - i;
    const line = (v, q0, q1, kind) => (i === 0 ? { x1: v, y1: q0, x2: v, y2: q1, kind } : { x1: q0, y1: v, x2: q1, y2: v, kind });
    let best = null;
    const offer = (v, tier, guide) => {
      const d = Math.abs(v - value);
      if (d <= thr && (!best || tier < best.tier || (tier === best.tier && d < best.d))) best = { v, tier, d, guide };
    };
    for (const r of runs) {
      if (r.horiz === (i === 0) || Math.min(p1, r.a1) - Math.max(p0, r.a0) < 1) continue;
      offer(r.c, 0, line(r.c, Math.max(r.a0, p0 - 15), Math.min(r.a1, p1 + 15), 'wall'));
    }
    for (const it of others(opts.exclude)) {
      const b = boxOf(itemAABB(it));
      if (Math.max(0, b.lo[j] - p1, p0 - b.hi[j]) > 320) continue;
      const q0 = Math.min(p0, b.lo[j]), q1 = Math.max(p1, b.hi[j]);
      offer(b.lo[i], 1, line(b.lo[i], q0, q1, 'align'));
      offer(b.hi[i], 1, line(b.hi[i], q0, q1, 'align'));
    }
    if (best) return { value: best.v, guides: [best.guide] };
    const step = store.ui.gridStep || 0;
    return { value: step ? snapTo(value, step) : value, guides: [] };
  }

  /** Snap a free point (measure tool): wall corners → item corners / centres → wall faces → grid. */
  function snapPoint(p, opts) {
    sync();
    if (!opts.enabled) return { x: p.x, y: p.y, kind: null };
    const thr = threshold(opts.scale, 10);
    let best = null;
    const offer = (x, y, kind, reach) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= reach && (!best || d < best.d)) best = { x, y, kind, d };
    };
    for (const [x, y] of corners) offer(x, y, 'corner', thr);
    for (const it of others(opts.exclude)) {
      if (Math.abs(it.x - p.x) > 600 || Math.abs(it.y - p.y) > 600) continue;
      for (const [x, y] of itemCorners(it)) offer(x, y, 'item', thr * 0.55);
      offer(it.x, it.y, 'item', thr * 0.4);
    }
    if (best) return best;
    const step = store.ui.gridStep || 0;
    for (const r of runs) {
      const s = Math.abs(r.horiz ? p.y - r.c : p.x - r.c), a = r.horiz ? p.x : p.y;
      if (s > thr || a < r.a0 || a > r.a1) continue;
      const along = step ? clamp(snapTo(a, step), r.a0, r.a1) : a;
      if (!best || s < best.d) best = { x: r.horiz ? along : r.c, y: r.horiz ? r.c : along, kind: 'face', d: s };
    }
    if (best) return best;
    return { x: step ? snapTo(p.x, step) : p.x, y: step ? snapTo(p.y, step) : p.y, kind: null };
  }

  /**
   * Free distance from each side of a box to the nearest wall (or the lot boundary outdoors).
   * @returns {{ x1, y1, x2, y2, dist }[]}
   */
  function clearances(b, maxDist = 900) {
    sync();
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, out = [];
    const boundary = plan.site.boundary;
    const cast = (i, dir) => {
      // i = axis of the ray (0 = x), dir = ±1
      const j = 1 - i, from = dir > 0 ? (i === 0 ? b.x + b.w : b.y + b.h) : (i === 0 ? b.x : b.y), at = i === 0 ? cy : cx;
      let hit = null;
      const offer = (v) => { const d = (v - from) * dir; if (d > -0.5 && (hit == null || d < (hit - from) * dir)) hit = v; };
      for (const r of solids) {
        const lo = [r.x, r.y], hi = [r.x + r.w, r.y + r.h];
        if (at < lo[j] || at > hi[j]) continue;
        if (from > lo[i] + 0.5 && from < hi[i] - 0.5) return;       // this side is inside a wall: nothing to report
        offer(dir > 0 ? lo[i] : hi[i]);
      }
      if (hit == null || (hit - from) * dir > maxDist) {
        for (let k = 0; k < boundary.length; k++) {
          const p = boundary[k], q = boundary[(k + 1) % boundary.length];
          if ((p[j] - at) * (q[j] - at) > 0 || p[j] === q[j]) continue;
          offer(p[i] + (q[i] - p[i]) * ((at - p[j]) / (q[j] - p[j])));
        }
      }
      if (hit == null) return;
      const dist = (hit - from) * dir;
      if (dist < 0.5 || dist > maxDist) return;
      out.push(i === 0 ? { x1: from, y1: at, x2: hit, y2: at, dist } : { x1: at, y1: from, x2: at, y2: hit, dist });
    };
    cast(0, -1); cast(0, 1); cast(1, -1); cast(1, 1);
    return out;
  }

  /** Placement problems (never blocking): footprint through a wall, or outside the lot. */
  function problems(it) {
    const floating = it.placement === 'wall' || it.placement === 'ceiling';
    const wall = !floating && wallsHitByItem(it, plan).length > 0;
    const outside = itemCorners(it).some(([x, y]) => !pointInPolygon(x, y, plan.site.boundary));
    return { wall, outside, any: wall || outside, hint: outside ? 'Outside the lot' : wall ? 'Overlaps a wall' : '' };
  }

  // ───────────── drawing a wall ─────────────
  const wallThr = (opts) => threshold(opts.scale, 8);
  const gapBetween = (a0, a1, b0, b1) => Math.max(b0 - a1, a0 - b1);       // < 0 when the ranges overlap

  /**
   * Snap the centre line of a wall being drawn. `axis` = the way the wall runs ('h' | 'v'), `value` = wanted
   * centre-line coordinate (y for 'h', x for 'v'), a0..a1 = its extent along the axis, t = thickness.
   * Tries: a face flush with a face of a wall further along, in line with a parallel wall, then the 5 cm grid
   * (the wall's faces land on the grid, like the engine does).
   * @returns {{ value:number, guide:object|null }}
   */
  function snapWallLine(axis, value, a0, a1, t, opts) {
    const grid = snapTo(value - t / 2, PLAN_GRID) + t / 2;
    if (!opts.enabled) return { value: grid, guide: null };
    sync();
    const horiz = axis === 'h', thr = wallThr(opts);
    const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
    const line = (c, q0, q1, kind) => (horiz ? { x1: q0, y1: c, x2: q1, y2: c, kind } : { x1: c, y1: q0, x2: c, y2: q1, kind });
    let best = null;
    const offer = (v, guide) => { const d = Math.abs(v - value); if (d <= thr && (!best || d < best.d - 0.01)) best = { v, d, guide }; };
    for (const r of runs) {
      if (r.horiz !== horiz) continue;
      const gap = gapBetween(lo, hi, r.a0, r.a1);
      if (gap < -1 || gap > 400) continue;
      const g = line(r.c, Math.min(lo, r.a0), Math.max(hi, r.a1), 'align');
      offer(r.c + t / 2, g); offer(r.c - t / 2, g);
    }
    for (const sg of wallSegments(plan)) {
      if (sg.axis !== axis || sg.id.startsWith('seg:j')) continue;
      const b0 = horiz ? sg.core.x : sg.core.y, b1 = b0 + (horiz ? sg.core.w : sg.core.h);
      const gap = gapBetween(lo, hi, b0, b1);
      if (gap < -1 || gap > 400) continue;
      const c = horiz ? sg.core.y + sg.core.h / 2 : sg.core.x + sg.core.w / 2;
      offer(c, line(c, Math.min(lo, b0), Math.max(hi, b1), 'center'));
    }
    return best ? { value: best.v, guide: best.guide } : { value: grid, guide: null };
  }

  /**
   * Snap one end of a wall being drawn along its axis: to the face of a wall it runs into, else the 5 cm grid.
   * `c` = the wall's centre-line coordinate, t = thickness.
   * @returns {{ value:number, guide:object|null }}
   */
  function snapWallEnd(axis, value, c, t, opts) {
    const grid = snapTo(value, PLAN_GRID);
    if (!opts.enabled) return { value: grid, guide: null };
    sync();
    const horiz = axis === 'h', thr = wallThr(opts);
    let best = null;
    for (const r of runs) {
      if (r.horiz === horiz || Math.min(r.a1, c + t / 2) - Math.max(r.a0, c - t / 2) <= 0) continue;
      const d = Math.abs(r.c - value);
      if (d <= thr && (!best || d < best.d)) best = { v: r.c, d, r };
    }
    if (!best) return { value: grid, guide: null };
    const q0 = Math.max(best.r.a0, c - t / 2 - 20), q1 = Math.min(best.r.a1, c + t / 2 + 20);
    return { value: best.v, guide: horiz ? { x1: best.v, y1: q0, x2: best.v, y2: q1, kind: 'wall' } : { x1: q0, y1: best.v, x2: q1, y2: best.v, kind: 'wall' } };
  }

  /** Snap a free point for the wall tool before the direction is known: corners → wall faces (per axis) → 5 cm grid. */
  function snapWallPoint(p, opts) {
    const out = { x: snapTo(p.x, PLAN_GRID), y: snapTo(p.y, PLAN_GRID), kind: null };
    if (!opts.enabled) return out;
    sync();
    const thr = wallThr(opts);
    let corner = null;
    for (const [x, y] of corners) { const d = Math.hypot(x - p.x, y - p.y); if (d <= thr * 0.8 && (!corner || d < corner.d)) corner = { x, y, d }; }
    if (corner) return { x: corner.x, y: corner.y, kind: 'corner' };
    let bx = null, by = null;
    for (const r of runs) {
      const a = r.horiz ? p.x : p.y, d = Math.abs((r.horiz ? p.y : p.x) - r.c);
      if (d > thr || a < r.a0 - 2 || a > r.a1 + 2) continue;
      if (r.horiz) { if (!by || d < by.d) by = { v: r.c, d }; } else if (!bx || d < bx.d) bx = { v: r.c, d };
    }
    if (bx) { out.x = bx.v; out.kind = 'face'; }
    if (by) { out.y = by.v; out.kind = 'face'; }
    return out;
  }

  return {
    get runs() { sync(); return runs; },
    threshold, snapBox, snapItem, snapCoord, snapPoint, clearances, problems, snapWallLine, snapWallEnd, snapWallPoint,
  };
}
