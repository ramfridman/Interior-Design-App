/**
 * Worktops: contiguous worktop-carrying units → pieces no longer than the maximum slab, joints at unit boundaries kept
 * clear of cut-outs, sink / hob / basin cut-outs, edge finishes and upstands. All lengths in cm (thickness in mm).
 */
import { MODULES } from './modules.js';
import { positions, levelOf } from './layout.js';
import { RULES } from './spec.js';

const r1 = (v) => Math.round(v * 10) / 10;
/** A chosen slab rides on every piece (additive: no `stone` key when none is chosen, so older designs stay identical). */
const stoneOf = (wt) => (wt.stone && wt.stone.id ? { stone: { ...wt.stone } } : {});

/** Cut-out of a unit (cm), centred on the unit; null if the module has none. */
export function cutoutOf(unit, depth, mod = MODULES[unit.carp.module]) {
  if (!mod || !mod.cutout) return null;
  const w = unit.carp.width, given = unit.carp.cutout || {};
  let cw, cd;
  if (mod.cutout === 'sink') { cw = given.w ?? (w >= 100 ? 80 : Math.min(w - 10, 50)); cd = given.d ?? 40; }
  else if (mod.cutout === 'hob') { cw = given.w ?? (w >= 90 ? 84 : 56); cd = given.d ?? 49; }
  else { cw = given.w ?? Math.min(w - 20, 50); cd = given.d ?? 35; }
  const fromFront = given.fromFront ?? r1((depth - cd) / 2);
  return { kind: mod.cutout, unitId: unit.id, w: cw, d: cd, fromFront, centre: unit.carp.width / 2 };
}

/**
 * Worktop pieces of a run. `butts` = [{ side: 'left'|'right', depth }] — other runs whose worktop butts into this one's
 * front edge at that end (an L corner): their depth is not polished on this run's front edge.
 */
export function computeWorktops(run, units, butts = []) {
  const spec = run.spec;
  if (!spec || !spec.worktop || spec.worktop.material === 'none') return [];
  const wt = spec.worktop, pos = positions(run, units), island = run.kind === 'island';
  const floor = units.filter((u) => ['base', 'island'].includes(levelOf(u)) || ['tall', 'full'].includes(levelOf(u))).sort((a, b) => pos.get(a.id).at - pos.get(b.id).at);
  const segs = [];
  let cur = null;
  for (const u of floor) {
    const m = MODULES[u.carp.module] || MODULES.custom, lvl = levelOf(u), at = pos.get(u.id).at;
    let carries = !!m.worktop && !m.virtual && (lvl === 'base' || lvl === 'island');
    if (u.carp.worktop === true) carries = true;
    if (u.carp.worktop === false) carries = false;
    if (!carries) { cur = null; continue; }
    if (cur && Math.abs(cur.e - at) < 0.5) { cur.e = at + u.carp.width; cur.units.push(u); } else { cur = { s: at, e: at + u.carp.width, units: [u] }; segs.push(cur); }
  }
  // a BASE corner unit of the other arm reserving this end (carousel / diagonal): the worktop runs over the reserved part
  const rs = run.reserved && run.reserved.by;
  if (rs && segs.length) {
    if (rs.left && rs.left.level === 'base' && Math.abs(segs[0].s - rs.left.cm) < 0.5) segs[0].s = 0;
    const last = segs[segs.length - 1];
    if (rs.right && rs.right.level === 'base' && Math.abs(last.e - (run.length - rs.right.cm)) < 0.5) last.e = run.length;
  }
  const depth = wt.depth, max = wt.maxSlab || 300, out = [];
  let n = 0;
  const endType = (side, atRunEnd) => {
    if (!atRunEnd) return 'tall';
    const e = run.ends && run.ends[side];
    const t = e && (e.type || e);
    return t === 'wall' ? 'wall' : t === 'run' ? 'butt' : 'polished';
  };
  for (const seg of segs) {
    const atL = seg.s < 0.5, atR = Math.abs(seg.e - run.length) < 0.5 || seg.e >= run.length;
    const leftT = island ? (wt.waterfall ? 'waterfall' : 'polished') : endType('left', atL), rightT = island ? (wt.waterfall ? 'waterfall' : 'polished') : endType('right', atR);
    const s = seg.s - (leftT === 'polished' && !island ? wt.overhangEnd || 0 : 0), e = seg.e + (rightT === 'polished' && !island ? wt.overhangEnd || 0 : 0);
    // cut-outs in run coordinates
    const cuts = [];
    for (const u of seg.units) {
      const c = cutoutOf(u, depth);
      if (c) { const a = pos.get(u.id).at + u.carp.width / 2 - c.w / 2; cuts.push({ ...c, a: r1(a), b: r1(a + c.w) }); }
    }
    // joints
    const bounds = seg.units.map((u) => pos.get(u.id).at).filter((x) => x > s + 1 && x < e - 1);
    const clear = (x) => cuts.every((c) => x <= c.a - RULES.jointClearOfCutout || x >= c.b + RULES.jointClearOfCutout);
    const joints = [];
    let start = s, warn = false;
    while (e - start > max + 0.01) {
      const left = e - start, need = Math.ceil(left / max), minNext = e - (need - 1) * max;
      const cand = bounds.filter((x) => x > start + 30 && x <= start + max && x >= minNext - 0.01 && clear(x));
      let j = cand.length ? Math.max(...cand) : null;
      if (j == null) {
        j = start + max;
        for (let k = 0; k < max && !clear(j); k++) j -= 1;
        if (!clear(j) || j <= start + 30) { j = start + max; warn = true; }
      }
      joints.push(r1(j)); start = j;
    }
    const cutsAll = [s, ...joints, e];
    for (let i = 0; i < cutsAll.length - 1; i++) {
      const a = cutsAll[i], b = cutsAll[i + 1], len = r1(b - a);
      const lt = i === 0 ? leftT : 'joint', rt = i === cutsAll.length - 2 ? rightT : 'joint';
      const pieceCuts = cuts.filter((c) => c.a >= a - 0.01 && c.b <= b + 0.01).map((c) => ({ kind: c.kind, unitId: c.unitId, x: r1(c.a - a), w: c.w, d: c.d, fromFront: c.fromFront }));
      let polished = len;                                   // front edge
      for (const bt of butts) if ((bt.side === 'left' && i === 0 && a < 0.5) || (bt.side === 'right' && i === cutsAll.length - 2 && b > run.length - 0.5)) polished -= bt.depth;
      if (island) polished += len;                          // back (working side) edge too
      if (lt === 'polished') polished += depth;
      if (rt === 'polished') polished += depth;
      n++;
      out.push({
        id: 'WT' + n, s: r1(a), e: r1(b), length: len, depth, thickness: wt.thickness, material: wt.material, color: wt.color, edge: wt.edge,
        ends: { left: lt, right: rt }, cutouts: pieceCuts, polishedM: r1(polished) / 100, upstandM: !island && wt.upstand > 0 ? len / 100 : 0,
        areaM2: Math.round(len * depth) / 1e4, overSlab: len > max + 0.01, jointWarning: warn, ...stoneOf(wt),
      });
    }
    if (island && wt.waterfall) {
      const hgt = (spec.heights.worktop - wt.thickness / 10);
      for (const side of ['left', 'right']) { n++; out.push({ id: 'WT' + n, waterfall: side, s: side === 'left' ? r1(s) : r1(e), e: side === 'left' ? r1(s) : r1(e), length: hgt, depth, thickness: wt.thickness, material: wt.material, color: wt.color, edge: 'mitred', ends: { left: 'mitre', right: 'floor' }, cutouts: [], polishedM: r1(hgt * 2) / 100, upstandM: 0, areaM2: Math.round(hgt * depth) / 1e4, ...stoneOf(wt) }); }
    }
  }
  return out;
}
