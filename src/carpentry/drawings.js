/**
 * drawings(runId) — shop drawings as plain vector data for dumb renderers (SVG on screen, PDF).
 *
 * Drawing = { id, kind: 'plan'|'elevation'|'section'|'worktop'|'internal', runId, title: { en, he }, scale (1:scale),
 *             bounds: { x, y, w, h } (real cm, includes dimensions), yUp: true, ops: Op[], dims: DimChain[] }
 * Coordinates are REAL cm with y UP in every drawing (renderers flip once). Line weights `lw` and text `size` are PAPER mm.
 * Op = { t: 'line', x1, y1, x2, y2, lw, dash? }            dash: 'dash' | 'dot' | 'center' (dash-dot)
 *    | { t: 'rect', x, y, w, h, lw, fill?, hatch? }         fill / hatch: semantic tokens (see FILL)
 *    | { t: 'poly', pts: [[x, y]…], close, lw, fill?, dash? }
 *    | { t: 'arc', cx, cy, r, a0, a1, lw, dash? }           degrees counter-clockwise from +x, a0 → a1 counter-clockwise
 *    | { t: 'text', x, y, text: string | { en, he }, size, anchor: 'start'|'middle'|'end', rot?, weight?, role? }
 *      (x, y) = anchor point; y is the VERTICAL CENTRE of the text; rot = degrees counter-clockwise.
 * Every op may carry `role`: 'dim' | 'dim-text' | 'label' | 'code' | 'wall' | 'opening' | 'unit' | 'front' | 'worktop' … for styling / tests.
 * DimChain = { id, axis: 'x'|'y', pts: number[], values: number[], total, at (line coordinate), lanes }.
 */
import { PLAN } from '../core/plan.js';
import { view, ceilingOf } from './state.js';
import { islandBays } from './modules.js';
import { unitsOf, positions, geometryOf, unitCodes, isFloorLevel } from './layout.js';
import { spanOfRun, toLocal } from './walls.js';
import { computeWorktops } from './worktop.js';
import { itemCorners } from '../core/geometry.js';

const L = (en, he) => ({ en, he });
export const LW = { heavy: 0.5, medium: 0.35, thin: 0.18, hair: 0.13 };
export const TEXT = { code: 3.0, label: 2.2, dim: 2.0, small: 1.8 };
/** Semantic fills: renderers map them to colours / hatches. */
export const FILL = ['wall', 'plinth', 'worktop', 'appliance', 'glass', 'blind', 'splashback', 'void', 'section'];
const SCALES = [10, 20, 25, 50, 100];
const PAPER = { w: 380, h: 250 };                                         // usable A3 landscape, mm
const r1 = (v) => Math.round(v * 10) / 10;
export const fmt = (v) => { const x = r1(v); return Number.isInteger(x) ? String(x) : x.toFixed(1); };

/** Width (paper mm) of a text: ≈ 0.6 em per character. */
export const textWidthMm = (s, size) => Math.max(1, String(typeof s === 'object' ? (s.en.length >= s.he.length ? s.en : s.he) : s).length) * size * 0.6;
/** Real-cm box of a text op at a scale: { x0, y0, x1, y1 }. */
export function textBox(op, scale) {
  const k = scale / 10, w = textWidthMm(op.text, op.size) * k, h = op.size * k;
  const rot = ((op.rot || 0) % 180 + 180) % 180;
  const along = op.anchor === 'start' ? [0, w] : op.anchor === 'end' ? [-w, 0] : [-w / 2, w / 2];
  if (rot === 90) return { x0: op.x - h / 2, x1: op.x + h / 2, y0: op.y + along[0], y1: op.y + along[1] };
  return { x0: op.x + along[0], x1: op.x + along[1], y0: op.y - h / 2, y1: op.y + h / 2 };
}

function pickScale(w, h, margin = 1.35) {
  for (const s of SCALES) if ((w * margin * 10) / s <= PAPER.w && (h * margin * 10) / s <= PAPER.h) return s;
  return SCALES[SCALES.length - 1];
}

/** Op builder. */
function Ops(scale) {
  const ops = [], dims = [], k = scale / 10;
  const o = {
    ops, dims, scale, k,
    line: (x1, y1, x2, y2, lw = LW.thin, extra = {}) => ops.push({ t: 'line', x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), lw, ...extra }),
    rect: (x, y, w, h, lw = LW.thin, extra = {}) => ops.push({ t: 'rect', x: r1(x), y: r1(y), w: r1(w), h: r1(h), lw, ...extra }),
    poly: (pts, close = true, lw = LW.thin, extra = {}) => ops.push({ t: 'poly', pts: pts.map(([x, y]) => [r1(x), r1(y)]), close, lw, ...extra }),
    arc: (cx, cy, r, a0, a1, lw = LW.hair, extra = {}) => ops.push({ t: 'arc', cx: r1(cx), cy: r1(cy), r: r1(r), a0, a1, lw, ...extra }),
    text: (x, y, text, size = TEXT.label, extra = {}) => { const op = { t: 'text', x: r1(x), y: r1(y), text, size, anchor: 'middle', ...extra }; ops.push(op); return op; },
    /**
     * Dimension chain. axis 'x': points along x, dim line at y = at, extension lines from y = from; dir = side away from
     * the object (−1 below / +1 above). axis 'y': points along y, line at x = at, extension from x = from; dir −1 left / +1 right.
     * Texts that do not fit go to further lanes (with a leader), so no two texts overlap. Returns the outer coordinate used.
     */
    chain(id, axis, pts, at, from, dir, opts = {}) {
      pts = [...new Set(pts.map(r1))].sort((a, b) => a - b);
      if (pts.length < 2) return at;
      const size = opts.size || TEXT.dim, gap = 1.0 * k, laneH = (size + 1.0) * k, tick = 1.2 * k, ext = 1.5 * k, pad = 0.8 * k;
      const X = axis === 'x';
      const L1 = (a1, b1, a2, b2, lw, extra) => (X ? o.line(a1, b1, a2, b2, lw, extra) : o.line(b1, a1, b2, a2, lw, extra));
      L1(pts[0], at, pts[pts.length - 1], at, LW.hair, { role: 'dim' });
      for (const p of pts) {
        L1(p, from + dir * gap, p, at + dir * ext, LW.hair, { role: 'dim' });
        L1(p - tick, at - tick * (X ? 1 : -1), p + tick, at + tick * (X ? 1 : -1), LW.medium, { role: 'dim' });
      }
      const lanes = [];
      let maxLane = 0;
      const values = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const v = pts[i + 1] - pts[i], s = opts.label ? opts.label(i, v) : fmt(v), w = textWidthMm(s, size) * k, mid = (pts[i] + pts[i + 1]) / 2;
        values.push(r1(v));
        const lo = mid - w / 2 - pad, hi = mid + w / 2 + pad;
        let lane = 0;
        for (;; lane++) {                                   // lane 0 only when the text fits inside its own segment
          lanes[lane] = lanes[lane] || [];
          const free = (lane > 0 || w + pad <= v) && lanes[lane].every(([a, b]) => hi <= a || lo >= b);
          if (free || lane > 12) { lanes[lane].push([lo, hi]); break; }
        }
        maxLane = Math.max(maxLane, lane);
        const off = at + dir * (gap + (size * k) / 2 + lane * laneH);
        if (X) o.text(mid, off, s, size, { role: 'dim-text', chain: id }); else o.text(off, mid, s, size, { role: 'dim-text', chain: id, rot: 90 });
        if (lane > 0) L1(mid, at, mid, off - dir * ((size * k) / 2), LW.hair, { role: 'dim' });
      }
      dims.push({ id, axis, pts, values, total: r1(pts[pts.length - 1] - pts[0]), at: r1(at), lanes: maxLane + 1 });
      return at + dir * (gap + (maxLane + 1) * laneH + 2 * k);
    },
  };
  return o;
}

/** Mirror a drawing left ↔ right about x = L / 2 (island elevations are seen from the working side). */
function mirrorX(d, Lr) {
  const m = (x) => r1(Lr - x);
  for (const o of d.ops) {
    if (o.t === 'line') { o.x1 = m(o.x1); o.x2 = m(o.x2); }
    else if (o.t === 'rect') o.x = m(o.x + o.w);
    else if (o.t === 'poly') o.pts = o.pts.map(([x, y]) => [m(x), y]);
    else if (o.t === 'arc') { o.cx = m(o.cx); [o.a0, o.a1] = [r1((540 - o.a1) % 360), r1((540 - o.a0) % 360)]; }
    else if (o.t === 'text') { o.x = m(o.x); if (o.anchor === 'start') o.anchor = 'end'; else if (o.anchor === 'end') o.anchor = 'start'; }
  }
  for (const c of d.dims) if (c.axis === 'x') { c.pts = c.pts.map(m).sort((a, b) => a - b); c.values = c.pts.slice(1).map((p, i) => r1(p - c.pts[i])); } else c.at = m(c.at);
  d.bounds = bboxOf(d.ops, d.scale);
  return d;
}

function bboxOf(ops, scale) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const op of ops) {
    if (op.t === 'line') { add(op.x1, op.y1); add(op.x2, op.y2); }
    else if (op.t === 'rect') { add(op.x, op.y); add(op.x + op.w, op.y + op.h); }
    else if (op.t === 'poly') op.pts.forEach(([x, y]) => add(x, y));
    else if (op.t === 'arc') { add(op.cx - op.r, op.cy - op.r); add(op.cx + op.r, op.cy + op.r); }
    else if (op.t === 'text') { const b = textBox(op, scale); add(b.x0, b.y0); add(b.x1, b.y1); }
  }
  const m = (scale / 10) * 3;
  return { x: r1(x0 - m), y: r1(y0 - m), w: r1(x1 - x0 + 2 * m), h: r1(y1 - y0 + 2 * m) };
}

/** Everything a drawing needs about a run. */
function gather(run, v) {
  const units = unitsOf(run, v), pos = positions(run, units), codes = unitCodes(run, units);
  const list = units.map((u) => { const g = geometryOf(run, u), p = pos.get(u.id); return { u, g, id: u.id, code: codes.get(u.id), at: p.at, level: p.level, w: u.carp.width, end: p.at + u.carp.width }; });
  const butts = [];
  for (const r of v.runs()) for (const s of ['left', 'right']) { const e = r.ends && r.ends[s]; if (e && e.type === 'run' && e.runId === run.id) butts.push({ side: e.at || 'left', depth: r.spec.worktop.depth }); }
  return { units, list, butts, span: spanOfRun(run), worktops: computeWorktops(run, units, butts), H: list.length ? list[0].g.H : null };
}

// ───────────────────────── elevation ─────────────────────────
function frontSymbol(D, f, x0, g) {
  const x = x0 + f.x, y = f.y, w = f.w, h = f.h;
  if (f.kind === 'appliance') {
    D.rect(x, y, w, h, LW.thin, { dash: 'dash', fill: f.panel ? undefined : 'appliance', role: 'front' });
    if (f.label) D.text(x + w / 2, y + Math.min(h - 3, h / 2), f.label, TEXT.small, { role: 'label' });
    return;
  }
  if (f.kind === 'blind') { D.rect(x, y, w, h, LW.hair, { hatch: 'blind', dash: 'dash', role: 'front' }); return; }
  if (f.kind === 'open') { D.rect(x, y, w, h, LW.thin, { fill: 'void', role: 'front' }); return; }
  D.rect(x, y, w, h, LW.thin, { role: 'front', ...(f.kind === 'glass' ? { fill: 'glass' } : {}), ...(f.kind === 'mirror' ? { fill: 'glass' } : {}) });
  if (f.kind === 'glass') D.rect(x + 6, y + 6, Math.max(1, w - 12), Math.max(1, h - 12), LW.hair, { role: 'front' });
  // opening symbol (dashed lines meeting at the handle side)
  if (f.kind === 'door' || f.kind === 'glass' || f.kind === 'mirror') {
    const hx = f.hinge === 'R' ? x + w : x, ox = f.hinge === 'R' ? x : x + w;
    D.poly([[ox, y], [hx, y + h / 2], [ox, y + h]], false, LW.hair, { dash: 'dash', role: 'front' });
  } else if (f.kind === 'flap') {
    const top = f.hinge !== 'B';
    D.poly([[x, top ? y : y + h], [x + w / 2, top ? y + h : y], [x + w, top ? y : y + h]], false, LW.hair, { dash: 'dash', role: 'front' });
  }
  // handles
  const ht = g.spec.handles.type, hl = Math.min(g.spec.handles.length || 16, w - 6);
  if (f.handle && (ht === 'bar' || ht === 'edge-pull' || ht === 'knob') && !(f.kind === 'appliance')) {
    if (f.kind === 'drawer' || f.kind === 'flap' || (f.kind === 'appliance' && f.panel)) {
      const hy = f.kind === 'flap' && f.hinge !== 'B' ? y + 4 : y + h - 4;
      if (ht === 'knob') D.rect(x + w / 2 - 1, hy - 1, 2, 2, LW.medium, { role: 'front' }); else D.line(x + w / 2 - hl / 2, hy, x + w / 2 + hl / 2, hy, LW.medium, { role: 'front' });
    } else {
      // handle height: low doors near the top, high doors near the bottom, tall doors at ≈ 105 cm
      const hx = f.hinge === 'R' ? x + 4 : x + w - 4, lo = y + 4 + hl / 2, hiY = y + h - 4 - hl / 2;
      const hy = y + h <= 120 ? hiY : y >= 120 ? lo : Math.max(lo, Math.min(hiY, 105));
      if (ht === 'knob') D.rect(hx - 1, hy - 1, 2, 2, LW.medium, { role: 'front' }); else D.line(hx, hy - hl / 2, hx, hy + hl / 2, LW.medium, { role: 'front' });
    }
  }
}

function elevation(run, G, v, opts = {}) {
  const ceiling = ceilingOf(), Lr = run.length, H = G.H;
  const scale = pickScale(Lr + 60, ceiling + 40);
  const D = Ops(scale), k = D.k;
  const internal = !!opts.internal;
  // floor, ceiling, side walls
  D.line(-25, 0, Lr + 25, 0, LW.heavy, { role: 'floor' });
  D.line(-25, ceiling, Lr + 25, ceiling, LW.thin, { dash: 'dash', role: 'ceiling' });
  D.text(-25, ceiling + 2.5 * k, L('Ceiling', 'תקרה'), TEXT.small, { anchor: 'start', role: 'label' });
  for (const side of ['left', 'right']) {
    const e = run.ends && run.ends[side];
    if (e && e.type === 'wall') D.rect(side === 'left' ? -12 : Lr, 0, 12, ceiling, LW.medium, { hatch: 'wall', role: 'wall' });
  }
  // openings in the wall behind
  if (G.span && !internal) for (const o of G.span.openings) {
    const a = o.from - G.span.runFrom, b = o.to - G.span.runFrom;
    if (b < -20 || a > Lr + 20) continue;
    D.rect(a, o.sill, b - a, o.top - o.sill, LW.thin, { dash: 'dash', role: 'opening' });
    if (o.kind === 'window') D.line(a, o.sill, b, o.sill, LW.medium, { role: 'opening' });
    D.text((a + b) / 2, o.top - 4 * k, `${o.kind === 'window' ? 'W' : 'D'} ${o.width}/${o.height}${o.sill ? `(+${o.sill})` : ''}`, TEXT.small, { role: 'label' });
  }
  // worktop + splashback
  if (H && !internal) for (const p of G.worktops.filter((q) => !q.waterfall)) {
    D.rect(p.s, H.worktop - H.wt, p.length, H.wt, LW.medium, { fill: 'worktop', role: 'worktop' });
    const sb = run.spec.splashback;
    if (sb && sb.material !== 'none' && run.kind !== 'island') {
      let y1 = H.worktop + sb.height;
      const wallsAbove = G.list.filter((x) => x.level === 'wall' && !x.g.mod.virtual && x.at < p.e && x.end > p.s);
      if (wallsAbove.length) y1 = Math.min(y1, Math.min(...wallsAbove.map((x) => x.g.elev)));
      const wins = G.span ? G.span.openings.filter((o) => o.kind === 'window') : [];
      let segs = [[p.s, p.e]];
      for (const o of wins) { const a = o.from - G.span.runFrom, b = o.to - G.span.runFrom; if (o.sill < y1) segs = segs.flatMap(([s, e]) => (b <= s || a >= e ? [[s, e]] : [[s, a], [b, e]].filter(([q, w]) => w - q > 1))); }
      for (const [s, e] of segs) D.rect(s, H.worktop, e - s, Math.max(0, y1 - H.worktop), LW.hair, { hatch: 'splashback', role: 'splashback' });
    }
  }
  // above the top line
  const aboveTop = run.spec.heights.aboveTop;
  if (H && !internal && aboveTop === 'filler' && run.kind === 'kitchen') {
    const xs = G.list.filter((x) => (x.level === 'wall' || x.level === 'tall') && !x.g.mod.virtual);
    if (xs.length) { const a = Math.min(...xs.map((x) => x.at)), b = Math.max(...xs.map((x) => x.end)); D.rect(a, H.topLine, b - a, ceiling - H.topLine, LW.thin, { hatch: 'blind', role: 'filler' }); D.text((a + b) / 2, (H.topLine + ceiling) / 2, L('Bulkhead filler to ceiling', 'סגירה עד התקרה'), TEXT.small, { role: 'label' }); }
  }
  // units
  for (const x of G.list) {
    const g = x.g, m = g.mod;
    if (m.virtual) {
      if (m.id === 'base-space') { g.fronts.forEach((f) => frontSymbol(D, f, x.at, g)); D.text(x.at + x.w / 2, (g.fronts[0] ? g.fronts[0].h : 85) + 4 * k, x.code, TEXT.code, { weight: 'bold', role: 'code', unitId: x.id }); }
      continue;
    }
    const [cy0, cy1] = g.carcassY;
    if (g.level !== 'wall' && g.H.plinth > 0 && !m.wallHung && !['panel', 'shelf', 'desk', 'none'].includes(m.carcass) && m.id !== 'tall-fridge-niche') D.rect(x.at, 0, x.w, g.H.plinth, LW.hair, { fill: 'plinth', role: 'plinth' });
    if (m.carcass !== 'none') D.rect(x.at, m.id === 'panel' ? (g.level === 'wall' ? g.elev : 0) : m.id === 'filler' ? g.zone.y0 : cy0, x.w, m.id === 'panel' ? (g.level === 'wall' ? g.h : g.level === 'base' || g.level === 'island' ? g.h - g.H.wt : g.h) : m.id === 'filler' ? g.zone.y1 - g.zone.y0 : cy1 - cy0, LW.medium, { role: 'unit', unitId: x.id });
    if (g.top) D.rect(x.at, g.top.y0, x.w, g.top.y1 + 0.3 - g.top.y0, LW.medium, { role: 'unit', unitId: x.id });
    if (!internal) g.fronts.forEach((f) => frontSymbol(D, f, x.at, g));
    else internalSymbols(D, x, g);
    // code label: centred in the main front zone
    const zy = m.id === 'tall-fridge-niche' ? (g.zone.y0 + g.zone.y1) / 2 : g.level === 'tall' || g.level === 'full' ? Math.min(g.zone.y1 - 15, 150) : (g.zone.y0 + g.zone.y1) / 2;
    const narrow = textWidthMm(x.code, TEXT.code) * k > x.w - 2;
    D.text(x.at + x.w / 2, zy, x.code, narrow ? TEXT.label : TEXT.code, { weight: 'bold', role: 'code', unitId: x.id, ...(narrow ? { rot: 90 } : {}) });
  }
  // sliding doors (run level)
  const sl = G.list.filter((x) => x.g.mod.sliding);
  if (sl.length && !internal) {
    const a = Math.min(...sl.map((x) => x.at)), len = sl.reduce((s, x) => s + x.w, 0), n = (run.spec.sliding && run.spec.sliding.doors) || Math.max(2, Math.ceil(len / 100)), dw = (len + (n - 1) * 3) / n, z = sl[0].g.zone;
    for (let i = 0; i < n; i++) { const x0 = a + i * (dw - 3); D.rect(x0, z.y0, dw, z.y1 - z.y0, LW.thin, { role: 'front' }); D.line(x0 + (i % 2 ? dw - 5 : 5), z.y0 + 20, x0 + (i % 2 ? dw - 5 : 5), z.y1 - 20, LW.hair, { dash: 'dash', role: 'front' }); }
    D.text(a + len / 2, z.y0 + 12, L(`${n} sliding doors`, `${n} דלתות הזזה`), TEXT.small, { role: 'label' });
  }
  // ── dimension chains ──
  const floor = G.list.filter((x) => isFloorLevel(x.level)), wall = G.list.filter((x) => !isFloorLevel(x.level) && !(x.g.mod.virtual && x.g.mod.id === 'wall-void'));
  let yb = -6 * k;
  const fpts = [0, Lr, ...floor.flatMap((x) => [x.at, x.end, ...(x.g.mod.id === 'island' ? islandBays(x.g).flatMap((bb) => [x.at + bb.x0, x.at + bb.x1]) : [])])].filter((p) => p >= -0.01 && p <= Lr + 0.01);
  yb = D.chain('units', 'x', fpts, yb, 0, -1);
  yb = D.chain('overall', 'x', [0, Lr], yb - 2 * k, 0, -1);
  const wpts = wall.length ? [0, Lr, ...wall.flatMap((x) => [x.at, Math.min(Lr, x.end)])] : [];
  if (wpts.length) D.chain('wall-units', 'x', wpts, ceiling + 6 * k, ceiling, +1);
  // heights (right side)
  if (H) {
    const levels = new Set(G.list.filter((x) => !x.g.mod.virtual).map((x) => x.level));
    const hp = [0, ceiling];
    const mods = new Set(G.list.map((x) => x.g.mod.id));
    if ([...levels].some((l) => l !== 'wall') && H.plinth > 0) hp.push(H.plinth);
    if (levels.has('base') || levels.has('island')) {
      const vanity = G.list.find((x) => x.g.mod.wallHung && x.level === 'base');
      if (vanity) hp.push(vanity.g.carcassY[0]);
      if (run.spec.worktop.material !== 'none') hp.push(H.worktop - H.wt, H.worktop); else if (!vanity) hp.push(H.worktop);
    }
    if (levels.has('wall')) for (const x of wall.filter((y) => !y.g.mod.virtual)) hp.push(x.g.elev, x.g.elev + x.g.h);
    if (levels.has('tall')) hp.push(H.tallH);
    if (levels.has('full')) { const f = G.list.find((x) => x.level === 'full'); hp.push(f.g.carcassY[1]); if (f.g.top) hp.push(f.g.top.y1 + 0.3); }
    if (mods.has('tall-fridge-niche')) { const n = G.list.find((x) => x.g.mod.id === 'tall-fridge-niche'); hp.push(n.g.elev); }
    let xr = Lr + 14 + 6 * k;
    xr = D.chain('heights', 'y', hp.filter((p) => p >= 0 && p <= ceiling), xr, Lr + (run.ends && run.ends.right && run.ends.right.type === 'wall' ? 12 : 0), +1);
    D.chain('ceiling', 'y', [0, ceiling], xr + 2 * k, Lr, +1);
  }
  const title = run.kind === 'island' ? L(`${run.code} — elevation from the working side`, `${run.code} — חזית מצד העבודה`) : internal ? L(`${run.code} — internal elevation`, `${run.code} — חתך פנימי (ללא חזיתות)`) : L(`${run.code} — front elevation`, `${run.code} — חזית`);
  const res = { id: `${run.id}:${internal ? 'internal' : 'elevation'}`, kind: internal ? 'internal' : 'elevation', runId: run.id, title, scale, yUp: true, ops: D.ops, dims: D.dims, bounds: bboxOf(D.ops, scale) };
  return run.kind === 'island' ? mirrorX(res, Lr) : res;
}

function internalSymbols(D, x, g) {
  const t = g.t, [cy0, cy1] = g.carcassY;
  D.rect(x.at + t, cy0 + t, x.w - 2 * t, cy1 - cy0 - 2 * t, LW.hair, { role: 'unit' });
  for (const c of g.inner) {
    const a = x.at + (c.x0 ?? 0), b = x.at + (c.x1 ?? x.w);
    if (c.kind === 'shelf' || c.kind === 'shoe') D.rect(a, c.y - t, b - a, t, LW.thin, { fill: 'section', role: 'internal' });
    else if (c.kind === 'divider') D.rect(a - t / 2, c.y, t, c.h, LW.thin, { fill: 'section', role: 'internal' });
    else if (c.kind === 'rail') { D.line(a + 3, c.y, b - 3, c.y, LW.medium, { role: 'internal' }); D.rect(a + 1, c.y - 1, 2, 2, LW.hair, { role: 'internal' }); D.rect(b - 3, c.y - 1, 2, 2, LW.hair, { role: 'internal' }); }
    else if (c.kind === 'drawer') D.rect(a + 1, c.y + 1, b - a - 2, (c.h || 18) - 2, LW.thin, { role: 'internal' });
    else D.rect(a + 2, c.y + 2, b - a - 4, (c.h || 60) - 4, LW.hair, { dash: 'dash', role: 'internal' });
  }
  if (g.top) D.rect(x.at + t, g.top.y0 + t, x.w - 2 * t, g.top.y1 + 0.3 - g.top.y0 - 2 * t, LW.hair, { role: 'unit' });
}

/** Internal elevation with per-unit height chains (wardrobes, pantries, tall units). */
function internalElevation(run, G, v) {
  const d = elevation(run, G, v, { internal: true });
  // per-unit height chains inside each carcass (left inner side)
  const D = Ops(d.scale); D.ops.push(...d.ops); D.dims.push(...d.dims);
  for (const x of G.list.filter((y) => (y.level === 'full' || y.level === 'tall') && y.g.inner.length && !y.g.mod.virtual)) {
    const pts = [x.g.carcassY[0] + x.g.t, ...x.g.inner.flatMap((c) => (c.kind === 'drawer' ? [c.y, c.y + (c.h || 18)] : c.kind === 'divider' ? [] : [c.y])), x.g.carcassY[1] - x.g.t];
    D.chain(`inner-${x.code}`, 'y', pts.filter((p) => p >= x.g.carcassY[0] && p <= x.g.carcassY[1]), x.at + x.g.t + 3 * D.k, x.at + x.g.t, +1, { size: TEXT.small });
    for (const c of x.g.inner) {
      const lab = { rail: L('Rail', 'מוט'), drawer: L('Drawer', 'מגירה'), trouser: L('Trouser rack', 'מכנסיים'), larder: L('Pull-out larder', 'קרגו'), pullout: L('Pull-out', 'נשלף') }[c.kind];
      if (lab && c.kind !== 'drawer') D.text(x.at + x.w * 0.62, c.y + (c.kind === 'rail' ? -4 * D.k : (c.h || 60) / 2), lab, TEXT.small, { role: 'label' });
    }
  }
  return { ...d, ops: D.ops, dims: D.dims, bounds: bboxOf(D.ops, d.scale) };
}

// ───────────────────────── plan ─────────────────────────
function plan(run, G, v) {
  const depth = Math.max(60, ...G.list.map((x) => x.g.d));
  const scale = pickScale(run.length + 120, depth + 200);
  const D = Ops(scale), k = D.k;
  const P = (px, py) => { const [a, dd] = toLocal(run.anchor, px, py); return [a, -dd]; };   // y up: wall at the top
  const win = { x0: -60, x1: run.length + 60, y0: -(depth + 140), y1: 40 };
  const clipRect = (pts) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.max(win.x0, Math.min(...xs)), x1 = Math.min(win.x1, Math.max(...xs)), y0 = Math.max(win.y0, Math.min(...ys)), y1 = Math.min(win.y1, Math.max(...ys));
    return x1 - x0 > 0.1 && y1 - y0 > 0.1 ? [x0, y0, x1 - x0, y1 - y0] : null;
  };
  const rectPts = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([a, b]) => P(a, b));
  if (run.kind !== 'island') {
    for (const w of PLAN.walls) { const c = clipRect(rectPts(w)); if (c) D.rect(...c, LW.heavy, { fill: 'wall', role: 'wall' }); }
    for (const o of PLAN.openings) {
      const c = clipRect(rectPts(o));
      if (!c) continue;
      D.rect(...c, LW.thin, { role: 'opening', fill: o.kind === 'window' ? 'glass' : undefined });
      if (o.kind === 'door' && o.hinge && o.swing) {
        const sw = o.axis === 'v' ? { hx: o.swing === 'e' ? o.x + o.w : o.x, hy: o.hinge === 'n' ? o.y : o.y + o.h, ex: o.swing === 'e' ? 1 : -1, ey: 0, cx: 0, cy: o.hinge === 'n' ? 1 : -1 }
          : { hx: o.hinge === 'w' ? o.x : o.x + o.w, hy: o.swing === 's' ? o.y + o.h : o.y, ex: 0, ey: o.swing === 's' ? 1 : -1, cx: o.hinge === 'w' ? 1 : -1, cy: 0 };
        const h = P(sw.hx, sw.hy), open = P(sw.hx + sw.ex * o.width, sw.hy + sw.ey * o.width), closed = P(sw.hx + sw.cx * o.width, sw.hy + sw.cy * o.width);
        const ang = (p) => (Math.atan2(p[1] - h[1], p[0] - h[0]) * 180) / Math.PI;
        let a0 = ang(closed), a1 = ang(open);
        if (((a1 - a0 + 360) % 360) > 180) [a0, a1] = [a1, a0];
        if (h[0] > win.x0 - o.width && h[0] < win.x1 + o.width && h[1] > win.y0 - o.width && h[1] < win.y1 + o.width) {
          D.line(h[0], h[1], open[0], open[1], LW.thin, { role: 'opening' });
          D.arc(h[0], h[1], o.width, r1(a0), r1(a1), LW.hair, { dash: 'dash', role: 'opening' });
        }
      }
    }
    // other carpentry / fixtures nearby
    for (const it of v.items) {
      if (it.hidden || (it.carp && it.carp.runId === run.id)) continue;
      if (!(it.carp || it.fixture || ['fridge', 'washer', 'dishwasher', 'range'].includes(it.type))) continue;
      const pts = itemCorners(it).map(([a, b]) => P(a, b));
      if (pts.every(([a, b]) => a < win.x0 || a > win.x1 || b < win.y0 || b > win.y1)) continue;
      D.poly(pts.map(([a, b]) => [Math.max(win.x0, Math.min(win.x1, a)), Math.max(win.y0, Math.min(win.y1, b))]), true, LW.hair, { dash: 'dash', role: 'context' });
    }
  }
  // units (floor solid, wall dashed)
  for (const x of G.list) {
    const g = x.g;
    if (g.mod.virtual && g.mod.id !== 'base-space') continue;
    const isWall = x.level === 'wall';
    D.rect(x.at, -g.d, x.w, g.d, isWall ? LW.thin : LW.medium, { role: 'unit', unitId: x.id, ...(isWall ? { dash: 'dash' } : {}), ...(g.mod.virtual ? { dash: 'dot' } : {}) });
    if (!isWall && !g.mod.virtual) {
      const fy = -(g.dc + g.frontD);
      D.line(x.at, fy, x.at + x.w, fy, LW.thin, { role: 'front' });
      for (const f of g.fronts.filter((q) => (q.kind === 'door' || q.kind === 'glass' || q.kind === 'mirror') && q.y < (g.H.worktop || 90))) {
        if (g.level === 'full' && g.top && f.y >= g.top.y0) continue;
        const hx = x.at + (f.hinge === 'R' ? f.x + f.w : f.x), dir = f.hinge === 'R' ? -1 : 1;
        D.line(hx, fy, hx, fy - f.w, LW.hair, { role: 'swing' });
        D.arc(hx, fy, f.w, dir > 0 ? 270 : 180, dir > 0 ? 360 : 270, LW.hair, { dash: 'dash', role: 'swing' });
      }
    }
    D.text(x.at + x.w / 2, isWall ? -g.d / 2 + 4 * k : -g.d / 2, x.code, textWidthMm(x.code, TEXT.code) * k > x.w - 2 ? TEXT.label : TEXT.code, { weight: 'bold', role: 'code', unitId: x.id, ...(textWidthMm(x.code, TEXT.code) * k > x.w - 2 ? { rot: 90 } : {}) });
  }
  for (const p of G.worktops.filter((q) => !q.waterfall)) {
    D.rect(p.s, -p.depth, p.length, p.depth, LW.medium, { role: 'worktop' });
    for (const c of p.cutouts) D.rect(p.s + c.x, -p.depth + c.fromFront, c.w, c.d, LW.thin, { role: 'cutout', ...(c.kind === 'hob' ? { dash: 'dash' } : {}) });
  }
  if (run.kind === 'island' && run.spec.worktop.overhangSeat) D.line(0, -(run.spec.worktop.depth - run.spec.worktop.overhangSeat), run.length, -(run.spec.worktop.depth - run.spec.worktop.overhangSeat), LW.hair, { dash: 'dash', role: 'overhang' });
  // dims
  const floor = G.list.filter((x) => isFloorLevel(x.level)), fpts = [0, run.length, ...floor.flatMap((x) => [x.at, x.end])];
  if (run.kind === 'island') {
    const yb = D.chain('units', 'x', fpts, -(depth + 4 * k), -depth, -1);
    D.chain('overall', 'x', [0, run.length], yb - 2 * k, -depth, -1);
  } else {                                                 // behind the wall, clear of door swings
    const wallTop = Math.max(0, ...D.ops.filter((o) => o.role === 'wall' && o.t === 'rect').map((o) => o.y + o.h));
    const yt = D.chain('units', 'x', fpts, wallTop + 5 * k, wallTop, +1);
    D.chain('overall', 'x', [0, run.length], yt + 2 * k, wallTop, +1);
  }
  const dp = [0, -Math.max(...G.list.filter((x) => isFloorLevel(x.level)).map((x) => x.g.d), 0)];
  const wd = G.list.filter((x) => x.level === 'wall' && !x.g.mod.virtual).map((x) => -x.g.d);
  D.chain('depth', 'y', [...dp, ...wd.slice(0, 1)], run.length + 8 * k + (run.ends.right && run.ends.right.type === 'wall' ? 20 : 0), run.length, +1);
  return { id: `${run.id}:plan`, kind: 'plan', runId: run.id, title: L(`${run.code} — plan`, `${run.code} — תכנית`), scale, yUp: true, ops: D.ops, dims: D.dims, bounds: bboxOf(D.ops, scale) };
}

// ───────────────────────── worktop ─────────────────────────
function worktopDrawing(run, G) {
  const pieces = G.worktops.filter((p) => !p.waterfall);
  if (!pieces.length) return null;
  const depth = Math.max(...pieces.map((p) => p.depth));
  const scale = pickScale(run.length + 60, depth + 120);
  const D = Ops(scale), k = D.k;
  if (run.kind !== 'island') D.line(-10, 0, run.length + 10, 0, LW.heavy, { role: 'wall' });
  for (const p of pieces) {
    D.rect(p.s, -p.depth, p.length, p.depth, LW.medium, { fill: 'worktop', role: 'worktop' });
    // polished front edge, minus where another run's worktop butts into it (L corner)
    const bs = (G.butts || []).filter((b) => (b.side === 'left' && p.s < 0.5) || (b.side === 'right' && p.e > run.length - 0.5));
    const fx0 = p.s + bs.filter((b) => b.side === 'left').reduce((a, b) => a + b.depth, 0), fx1 = p.e - bs.filter((b) => b.side === 'right').reduce((a, b) => a + b.depth, 0);
    D.line(fx0, -p.depth, fx1, -p.depth, LW.heavy, { role: 'edge-polished' });
    for (const b of bs) { const x = b.side === 'left' ? p.s + b.depth : p.e - b.depth; D.line(x, -p.depth - 3 * k, x, -p.depth + 3 * k, LW.thin, { dash: 'center', role: 'joint' }); D.text(b.side === 'left' ? x + k : x - k, -p.depth + 4 * k, L('corner joint', 'תפר פינה'), TEXT.small, { anchor: b.side === 'left' ? 'start' : 'end', role: 'label' }); }
    if (run.kind === 'island') D.line(p.s, 0, p.e, 0, LW.heavy, { role: 'edge-polished' });
    for (const [side, x] of [['left', p.s], ['right', p.e]]) {
      const t = p.ends[side];
      if (t === 'polished' || t === 'waterfall') D.line(x, -p.depth, x, 0, LW.heavy, { role: 'edge-polished' });
      if (t === 'joint') D.line(x, 3 * k, x, -p.depth - 3 * k, LW.thin, { dash: 'center', role: 'joint' });
    }
    // label in the widest stretch free of cut-outs
    const edges = [p.s, ...p.cutouts.flatMap((c) => [p.s + c.x, p.s + c.x + c.w]), p.e].sort((a, b) => a - b);
    let best = [p.s, p.e], bw = -1;
    for (let i = 0; i < edges.length - 1; i += 2) if (edges[i + 1] - edges[i] > bw) { bw = edges[i + 1] - edges[i]; best = [edges[i], edges[i + 1]]; }
    D.text((best[0] + best[1]) / 2, -p.depth / 2, p.id, TEXT.code, { weight: 'bold', role: 'code' });
    for (const c of p.cutouts) {
      const x = p.s + c.x, y = -p.depth + c.fromFront;
      D.rect(x, y, c.w, c.d, LW.medium, { role: 'cutout' });
      D.line(x, y, x + c.w, y + c.d, LW.hair, { role: 'cutout' }); D.line(x, y + c.d, x + c.w, y, LW.hair, { role: 'cutout' });
      D.text(x + c.w / 2, y + c.d / 2, { sink: L('SINK', 'כיור'), hob: L('HOB', 'כיריים'), basin: L('BASIN', 'כיור רחצה') }[c.kind], TEXT.small, { role: 'label' });
      D.chain(`${p.id}-cut-${c.kind}-depth`, 'y', [-p.depth, y, y + c.d], x + c.w + 4 * k, x + c.w, +1, { size: TEXT.small });
    }
  }
  const joints = pieces.filter((p) => p.ends.left === 'joint').map((p) => p.s);
  for (const j of joints) D.text(j, 6 * k, L('JOINT', 'תפר'), TEXT.small, { role: 'label' });
  // chains: cut-out positions (front), piece lengths, overall
  let yb = -depth - 5 * k;
  const cutPts = pieces.flatMap((p) => [p.s, p.e, ...p.cutouts.flatMap((c) => [p.s + c.x, p.s + c.x + c.w])]);
  if (pieces.some((p) => p.cutouts.length)) yb = D.chain('cutouts', 'x', cutPts, yb, -depth, -1);
  if (pieces.length > 1) yb = D.chain('pieces', 'x', pieces.flatMap((p) => [p.s, p.e]), yb - 1 * k, -depth, -1);
  D.chain('overall', 'x', [Math.min(...pieces.map((p) => p.s)), Math.max(...pieces.map((p) => p.e))], yb - 1 * k, -depth, -1);
  D.chain('depth', 'y', [-depth, 0], Math.max(...pieces.map((p) => p.e)) + 10 * k, Math.max(...pieces.map((p) => p.e)), +1);
  D.text(run.length / 2, run.kind === 'island' ? 12 * k : 10 * k, L(`Heavy line = polished edge (${run.spec.worktop.edge}); ${run.spec.worktop.thickness} mm ${run.spec.worktop.material}; max slab ${run.spec.worktop.maxSlab} cm`, `קו עבה = קנט מלוטש; ${run.spec.worktop.thickness} מ״מ; לוח מקסימלי ${run.spec.worktop.maxSlab} ס״מ`), TEXT.small, { role: 'note' });
  return { id: `${run.id}:worktop`, kind: 'worktop', runId: run.id, title: L(`${run.code} — worktop`, `${run.code} — משטח עבודה`), scale, yUp: true, ops: D.ops, dims: D.dims, bounds: bboxOf(D.ops, scale) };
}

// ───────────────────────── side section ─────────────────────────
function section(run, G) {
  const ceiling = ceilingOf();
  const pick = (lvl) => G.list.find((x) => x.level === lvl && !x.g.mod.virtual && !['filler', 'panel'].includes(x.g.mod.id));
  const base = pick('base') || pick('island'), wall = pick('wall'), tall = pick('tall'), full = pick('full');
  const maxD = Math.max(60, ...[base, wall, tall, full].filter(Boolean).map((x) => x.g.d));
  const scale = pickScale(maxD + 80, ceiling + 40);
  const D = Ops(scale), k = D.k;
  const island = run.kind === 'island';
  if (!island) D.rect(-15, 0, 15, ceiling, LW.heavy, { hatch: 'wall', role: 'wall' });
  D.line(-20, 0, maxD + 40, 0, LW.heavy, { role: 'floor' });
  D.line(-20, ceiling, maxD + 40, ceiling, LW.thin, { dash: 'dash', role: 'ceiling' });
  const hp = [0, ceiling], dp = [0];
  const S = run.spec;
  if (tall) D.rect(0, tall.g.carcassY[0], tall.g.d, tall.g.carcassY[1] - tall.g.carcassY[0], LW.hair, { dash: 'dash', role: 'beyond' });
  if (base && island) {                                   // x from the working-side edge of the worktop
    const g = base.g, wd = S.worktop.depth, ov = 2;                    // worktop overhang over the working-side fronts
    const f0 = ov, c0 = ov + g.frontD, c1 = c0 + g.dc, bp1 = wd - (S.worktop.overhangSeat || 0), bp0 = bp1 - g.frontD;
    if (g.H.plinth > 0) { D.rect(c0 + S.plinth.setback - g.frontD, 0, bp0 - (c0 + S.plinth.setback - g.frontD), g.H.plinth, LW.thin, { fill: 'plinth', role: 'plinth' }); hp.push(g.H.plinth); }
    D.rect(c0, g.carcassY[0], g.dc, g.carcassY[1] - g.carcassY[0], LW.medium, { fill: 'section', role: 'unit' });
    D.rect(f0, g.zone.y0, g.frontD, g.zone.y1 - g.zone.y0, LW.medium, { role: 'front' });
    if (bp0 > c1 + 0.5) D.rect(c1, g.carcassY[0], bp0 - c1, g.carcassY[1] - g.carcassY[0], LW.hair, { fill: 'void', role: 'void' });
    D.rect(bp0, 0, g.frontD, g.H.worktop - g.H.wt, LW.medium, { role: 'front' });
    D.rect(0, g.H.worktop - g.H.wt, wd, g.H.wt, LW.medium, { fill: 'worktop', role: 'worktop' });
    hp.push(g.H.worktop - g.H.wt, g.H.worktop);
    D.text(wd - (S.worktop.overhangSeat || 0) / 2, g.H.worktop + 6 * k, L('seating', 'ישיבה'), TEXT.small, { role: 'label' });
    D.text(f0, g.H.worktop + 6 * k, L('working side', 'צד עבודה'), TEXT.small, { anchor: 'start', role: 'label' });
    let yd = D.chain('depths', 'x', [0, f0, c0, c1], -8 * k, 0, -1);
    yd = D.chain('depth-back', 'x', [0, bp0, bp1, wd], yd - k, 0, -1);
    D.chain('depth-overall', 'x', [0, wd], yd - k, 0, -1);
  } else if (base) {
    const g = base.g, plinthFront = g.dc + g.frontD - S.plinth.setback;
    if (g.H.plinth > 0 && !g.mod.wallHung) { D.rect(0, 0, plinthFront, g.H.plinth, LW.thin, { fill: 'plinth', role: 'plinth' }); hp.push(g.H.plinth); }
    D.rect(0, g.carcassY[0], g.dc, g.carcassY[1] - g.carcassY[0], LW.medium, { fill: 'section', role: 'unit' });
    D.rect(g.dc, g.zone.y0, g.frontD, g.zone.y1 - g.zone.y0, LW.medium, { role: 'front' });
    if (S.worktop.material !== 'none') {
      const wd = island ? S.worktop.depth : S.worktop.depth;
      D.rect(0, g.H.worktop - g.H.wt, wd, g.H.wt, LW.medium, { fill: 'worktop', role: 'worktop' });
      hp.push(g.H.worktop - g.H.wt, g.H.worktop); dp.push(wd);
      if (island && S.worktop.overhangSeat) { const bp = wd - S.worktop.overhangSeat; D.rect(bp - g.frontD, 0, g.frontD, g.H.worktop - g.H.wt, LW.medium, { role: 'front' }); dp.push(bp); }
      if (!island && S.splashback.material !== 'none') { const top = wall ? wall.g.elev : g.H.worktop + S.splashback.height; D.rect(0, g.H.worktop, 1.2, top - g.H.worktop, LW.thin, { hatch: 'splashback', role: 'splashback' }); }
    } else hp.push(g.carcassY[1]);
    dp.push(g.dc, g.dc + g.frontD);
    if (g.H.plinth > 0 && !g.mod.wallHung) dp.push(plinthFront);
    if (g.mod.wallHung) hp.push(g.carcassY[0]);
  }
  if (wall) {
    const g = wall.g;
    D.rect(0, g.elev, g.dc, g.h, LW.medium, { fill: 'section', role: 'unit' });
    D.rect(g.dc, g.elev, g.frontD, g.h, LW.medium, { role: 'front' });
    hp.push(g.elev, g.elev + g.h);
    D.chain('wall-depth', 'x', [0, g.dc, g.dc + g.frontD], g.elev + g.h + 6 * k, g.elev + g.h, +1);
  }
  if (full) {
    const g = full.g;
    if (g.H.plinth > 0) { D.rect(0, 0, g.dc + g.frontD - S.plinth.setback, g.H.plinth, LW.thin, { fill: 'plinth', role: 'plinth' }); hp.push(g.H.plinth); dp.push(g.dc + g.frontD - S.plinth.setback); }
    D.rect(0, g.carcassY[0], g.dc, g.carcassY[1] - g.carcassY[0], LW.medium, { fill: 'section', role: 'unit' });
    D.rect(g.dc, g.zone.y0, g.frontD, g.zone.y1 - g.zone.y0, LW.medium, { role: 'front' });
    if (g.top) { D.rect(0, g.top.y0, g.dc, g.top.y1 + 0.3 - g.top.y0, LW.medium, { fill: 'section', role: 'unit' }); D.rect(g.dc, g.top.y0, g.frontD, g.top.y1 - g.top.y0, LW.medium, { role: 'front' }); hp.push(g.top.y1 + 0.3); }
    if (g.mod.sliding) D.rect(g.dc + 1, g.zone.y0, 6, g.zone.y1 - g.zone.y0, LW.thin, { role: 'front' });
    hp.push(g.carcassY[1]); dp.push(g.dc, g.d);
    const rail = g.inner.find((c) => c.kind === 'rail');
    if (rail) { D.rect(g.dc / 2 - 1, rail.y - 1, 2, 2, LW.medium, { role: 'internal' }); D.line(g.dc / 2, rail.y, g.dc / 2, rail.y - 100, LW.hair, { dash: 'dash', role: 'internal' }); D.text(g.dc / 2 + 3 * k, rail.y - 50, L('hanger', 'קולב'), TEXT.small, { anchor: 'start', role: 'label' }); }
  }
  if (tall) hp.push(tall.g.carcassY[1]);
  // depth chains: carcass + front, worktop / overall, plinth setback — separate rows so nothing crowds
  let yd = -8 * k;
  const unit = island ? null : base || full;
  if (unit) yd = D.chain('depths', 'x', [0, unit.g.dc, unit.g.dc + unit.g.frontD], yd, 0, -1);
  const extra = [...new Set(dp.filter((p) => unit && p > unit.g.dc + unit.g.frontD + 0.05))];
  if (extra.length) yd = D.chain('depth-overall', 'x', [0, ...extra], yd - k, 0, -1);
  const pf = unit && unit.g.H.plinth > 0 && !unit.g.mod.wallHung ? unit.g.dc + unit.g.frontD - S.plinth.setback : null;
  if (pf) D.chain('plinth-setback', 'x', [0, pf, unit.g.dc + unit.g.frontD], yd - k, 0, -1);
  const xr = D.chain('heights', 'y', hp.filter((p) => p >= 0 && p <= ceiling), maxD + 14 * k, maxD, +1);
  D.chain('ceiling', 'y', [0, ceiling], xr + 2 * k, maxD, +1);
  return { id: `${run.id}:section`, kind: 'section', runId: run.id, title: L(`${run.code} — side section`, `${run.code} — חתך צד`), scale, yUp: true, ops: D.ops, dims: D.dims, bounds: bboxOf(D.ops, scale) };
}

/**
 * All drawings of a run: plan, front elevation, side section, worktop (if any), internal elevation (wardrobes /
 * pantries / runs with tall units). `src` = optional { carpentry, items }.
 */
export function drawings(runId, src) {
  const v = view(src), run = v.run(runId);
  if (!run) return [];
  const G = gather(run, v);
  if (!G.list.length) return [];
  const out = [plan(run, G, v), elevation(run, G, v), section(run, G)];
  const wt = worktopDrawing(run, G);
  if (wt) out.push(wt);
  if (G.list.some((x) => (x.level === 'full' || x.level === 'tall') && x.g.inner.length && !x.g.mod.virtual)) out.push(internalElevation(run, G, v));
  return out;
}
