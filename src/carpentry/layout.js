/**
 * Layout: places every unit of a run from the run's anchor, order and widths, and writes the store item fields
 * (x, y, rot, w, d, h, elev, type, params, name, placement, hidden) + carp.at / carp.level. Pure functions over a
 * "reader" (draft or view) — the only place unit poses are computed.
 */
import { MODULES } from './modules.js';
import { unitSpec, derivedHeights, RULES, VOCAB } from './spec.js';
import { toPlan } from './walls.js';
import { ceilingOf } from './state.js';

const r2 = (v) => Math.round(v * 100) / 100;
const FLOOR = new Set(['base', 'tall', 'full', 'island']);

/** Resolved level of a unit ('any' modules take carp.level, default 'base'). */
export function levelOf(unit) {
  const m = MODULES[unit.carp.module];
  if (!m) return unit.carp.level || 'base';
  return m.level === 'any' ? (unit.carp.level || 'base') : m.level;
}
export const isFloorLevel = (lvl) => FLOOR.has(lvl);

/**
 * Everything about one unit's geometry, in cm: { mod, spec, H, level, w, d, dc (carcass depth), h, elev, t, frontD,
 * zone: { y0, y1 } (front zone, floor-up), top?: { y0, y1 } (top boxes), carcassY: [y0, y1], fronts, inner, model }.
 */
export function geometryOf(run, unit, ceiling = ceilingOf()) {
  const carp = unit.carp, mod = MODULES[carp.module] || MODULES.custom;
  const spec = unitSpec(run, unit), H = derivedHeights(spec, ceiling), level = levelOf(unit);
  const t = spec.carcass.thickness / 10, frontD = spec.fronts.thickness / 10, G = RULES.topGap;
  const w = carp.width;
  const hasTop = spec.worktop.material !== 'none';
  let d, dc, h, elev = 0, zone, top = null, carcassY;
  const depthOf = (key) => carp.depth ?? spec.depths[key];
  if (level === 'base') {
    dc = depthOf('base');
    if (mod.id === 'vanity') { const hc = carp.h ?? 48; carcassY = [H.worktop - H.wt - hc, H.worktop - H.wt]; h = H.worktop; zone = { y0: carcassY[0], y1: carcassY[1] - G }; }
    else if (mod.id === 'media-low') { const hc = carp.h ?? 40; elev = carp.elev ?? 30; carcassY = [elev, elev + hc]; h = hc; zone = { y0: elev, y1: elev + hc }; }
    else if (mod.id === 'entry-bench') { h = carp.h ?? 45; carcassY = [H.plinth, h - t]; zone = { y0: H.plinth, y1: h - t }; }
    else if (mod.id === 'desk') { h = H.worktop; carcassY = [h - 3.6, h]; zone = { y0: h - 18, y1: h - 3 }; }
    else { h = H.worktop; carcassY = [H.plinth, H.worktop - H.wt]; zone = { y0: H.plinth, y1: H.worktop - H.wt - G }; }
    d = hasTop && mod.worktop ? Math.max(spec.worktop.depth, dc + frontD) : dc + frontD;
    if (mod.id === 'filler' || mod.id === 'panel') d = hasTop ? Math.max(spec.worktop.depth, dc + frontD) : dc + frontD;
  } else if (level === 'wall') {
    dc = depthOf('wall');
    const dfl = mod.id === 'media-shelf' ? [4, 130] : mod.id === 'shelf' ? [3, 150] : mod.id === 'media-panel' ? [120, 60] : [H.wallH, H.wallBottom];
    h = carp.h ?? dfl[0]; elev = carp.elev ?? dfl[1];
    carcassY = [elev, elev + h]; zone = { y0: elev, y1: elev + h };
    d = mod.carcass === 'shelf' ? (carp.depth ?? 25) : mod.carcass === 'panel' ? (carp.depth ?? 2) : dc + frontD;
  } else if (level === 'tall') {
    dc = depthOf('tall');
    if (mod.id === 'tall-fridge-niche') {
      const fh = (carp.appliance && carp.appliance.h) || 180;
      elev = fh + 5; h = H.tallH - elev; carcassY = [elev, H.tallH]; zone = { y0: elev, y1: H.tallH };
    } else { h = H.tallH; carcassY = [H.plinth, H.tallH]; zone = { y0: H.plinth, y1: H.tallH }; }
    d = dc + frontD;
  } else if (level === 'full') {
    dc = depthOf('full');
    const body = H.body, box = spec.heights.aboveTop === 'cabinet' ? Math.max(0, ceiling - body - H.scribe) : 0;
    h = body + box; carcassY = [H.plinth, body];
    zone = { y0: H.plinth, y1: body - G };
    if (box >= 20) top = { y0: body, y1: body + box - G };
    d = dc + frontD + (mod.sliding ? 8 : 0);
    if (mod.id === 'panel') zone = { y0: 0, y1: h };
  } else { // island
    dc = depthOf('island');
    h = H.worktop; carcassY = [H.plinth, H.worktop - H.wt]; zone = { y0: H.plinth, y1: H.worktop - H.wt - G };
    d = spec.worktop.depth;
  }
  if (mod.id === 'filler' && level !== 'wall') zone = { y0: H.plinth, y1: level === 'base' || level === 'island' ? H.worktop - H.wt : h };
  const c = { run, unit, carp, mod, spec, H, level, w, d: r2(d), dc, h: r2(h), elev: r2(elev), t, frontD, zone, top, carcassY };
  c.fronts = mod.fronts(c);
  c.inner = mod.inner ? mod.inner(c) : [];
  c.model = mod.model(c);
  return c;
}

/** Units of a run in order (missing ids skipped). `reader.peek|item(id)`. */
export function unitsOf(run, reader) {
  const get = reader.peek || reader.item;
  return (run.unitIds || []).map((id) => get(id)).filter((u) => u && u.carp);
}

/**
 * Along positions: floor row back to back from 0 in order; wall row in order, skipping the extent of tall / full units,
 * a wall unit with carp.offset starts there. Returns Map(id → { at, level }).
 */
export function positions(run, units) {
  const pos = new Map();
  let s = 0;
  const blocks = [];
  for (const u of units) {
    const lvl = levelOf(u);
    if (!FLOOR.has(lvl)) continue;
    pos.set(u.id, { at: r2(s), level: lvl });
    if (lvl === 'tall' || lvl === 'full') blocks.push([s, s + u.carp.width]);
    s += u.carp.width;
  }
  let sw = 0;
  for (const u of units) {
    const lvl = levelOf(u);
    if (FLOOR.has(lvl)) continue;
    let at = u.carp.offset != null ? u.carp.offset : sw;
    if (u.carp.offset == null) {
      for (let guard = 0; guard < 50; guard++) {
        const hit = blocks.find(([a, b]) => at < b - 0.01 && at + u.carp.width > a + 0.01);
        if (!hit) break;
        at = hit[1];
      }
    }
    pos.set(u.id, { at: r2(at), level: lvl });
    sw = at + u.carp.width;
  }
  return pos;
}

/** Item fields for a unit at `at` along the run. */
export function itemFields(run, unit, at, ceiling = ceilingOf()) {
  const g = geometryOf(run, unit, ceiling);
  const [x, y] = toPlan(run.anchor, at + g.w / 2, g.d / 2);
  return {
    type: g.model.type, params: g.model.params, x: r2(x), y: r2(y), rot: run.anchor.dir, w: g.w, d: g.d, h: g.h, elev: g.elev,
    name: g.mod.name.en, placement: g.level === 'wall' ? 'wall' : 'floor', zone: 'indoor', hidden: !!g.mod.virtual,
    fixture: true, generic: false, price: null, productId: null, url: null, retailer: null, brand: null,
  };
}

/** Lay out a run inside a draft (writes items + carp.at/level, refreshes run.worktops). Returns ids whose item changed. */
export function layoutInDraft(draft, runId, worktopsFn) {
  const run = draft.carpentry.runs[runId];
  if (!run) return [];
  run.unitIds = (run.unitIds || []).filter((id) => { const u = draft.peek(id); return u && u.carp && u.carp.runId === runId; });
  const units = unitsOf(run, draft), pos = positions(run, units), ceiling = ceilingOf();
  for (const u of units) {
    const p = pos.get(u.id), f = itemFields(run, u, p.at, ceiling);
    const cur = draft.peek(u.id);
    const same = cur.carp.at === p.at && cur.carp.level === p.level && Object.keys(f).every((k) => JSON.stringify(cur[k]) === JSON.stringify(f[k]));
    if (same) continue;
    const it = draft.item(u.id);
    Object.assign(it, f);
    it.carp.at = p.at; it.carp.level = p.level;
  }
  run.worktops = worktopsFn ? worktopsFn(run, unitsOf(run, draft)) : run.worktops || [];
  return units.map((u) => u.id);
}

/** Short schedule codes per unit (B1, B2… W1… T1… C1… F1… P1…), left to right per prefix. Map(id → code). */
export function unitCodes(run, units) {
  const pos = positions(run, units), counters = {}, out = new Map();
  const sorted = [...units].sort((a, b) => (pos.get(a.id).at - pos.get(b.id).at) || (levelOf(a) === 'wall') - (levelOf(b) === 'wall'));
  for (const u of sorted) {
    const m = MODULES[u.carp.module] || MODULES.custom;
    const lvl = levelOf(u);
    let p = m.code;
    if (m.id === 'filler') p = 'F'; else if (m.id === 'panel') p = 'P';
    else if (p === 'B' && lvl === 'wall') p = 'W';
    counters[p] = (counters[p] || 0) + 1;
    out.set(u.id, p + counters[p]);
  }
  return out;
}

/** Row sums: { floor, wall } = furthest extent of each row along the run (cm). */
export function rowExtents(run, units) {
  const pos = positions(run, units);
  let floor = 0, wall = 0;
  for (const u of units) {
    const p = pos.get(u.id), e = p.at + u.carp.width;
    if (FLOOR.has(p.level)) floor = Math.max(floor, e); else wall = Math.max(wall, e);
  }
  return { floor: r2(floor), wall: r2(wall) };
}

export const levelLabel = (lvl) => VOCAB.level[lvl] || VOCAB.level.base;
