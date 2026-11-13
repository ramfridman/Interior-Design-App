/**
 * Key plan of the house (walls from plan.walls) with the carpentry runs' unit footprints highlighted and coded.
 * Page ops in mm, fitted into a box; north arrow from plan.meta.northAngle.
 */
import { itemCorners } from '../../core/geometry.js';
import { textOp, r2 } from './prims.js';
import { tr } from './strings.js';

const ZONES = { dining: { en: 'Dining', he: 'פינת אוכל' }, living: { en: 'Living', he: 'סלון' }, foyer: { en: 'Entry', he: 'כניסה' } };

/** Footprints (plan polygons) of the visible unit items of a run. */
export function runFootprints(run, items) {
  return items.filter((it) => it.carp && it.carp.runId === run.id && !it.hidden && it.w > 0 && it.d > 0).map((it) => itemCorners(it).map((p) => (Array.isArray(p) ? p : [p.x, p.y])));
}

/** Where to write a run's code: the footprint centroid pushed into the room (front direction). */
export function runLabelPoint(run, polys) {
  const pts = polys.flat();
  if (!pts.length) return [run.anchor.x, run.anchor.y];
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const a = (run.anchor.dir * Math.PI) / 180, fx = -Math.sin(a), fy = Math.cos(a);
  const depth = Math.max(...pts.map((p) => (p[0] - run.anchor.x) * fx + (p[1] - run.anchor.y) * fy)) || 60;
  const off = run.kind === 'island' ? depth / 2 + 45 : depth / 2 + 40;
  return [cx + fx * off, cy + fy * off];
}

/**
 * @param {{ plan, items, runs, box: number[], highlight?: string|null, labels?: boolean, rooms?: boolean, lang?: string, north?: boolean }} o
 * @returns {{ ops: object[], k: number }}
 */
export function keyPlanOps({ plan, items, runs, box, highlight = null, labels = true, rooms = true, lang = 'en', north = true }) {
  const b = (plan && plan.bounds) || { x: 0, y: 0, w: 1535, h: 1380 };
  const [bx, by, bw, bh] = box, k = Math.min(bw / b.w, bh / b.h);
  const ox = bx + (bw - b.w * k) / 2, oy = by + (bh - b.h * k) / 2;
  const P = (x, y) => [r2(ox + (x - b.x) * k), r2(oy + (y - b.y) * k)];
  const ops = [], dir = lang === 'he' ? 'rtl' : 'ltr';
  if (rooms) {
    for (const r of plan.rooms || []) {
      if (!r.polygon) continue;
      ops.push({ t: 'poly', pts: r.polygon.map(([x, y]) => P(x, y)), close: true, fill: 'paper', role: 'room' });
    }
  }
  for (const w of plan.walls || []) { const [x, y] = P(w.x, w.y); ops.push({ t: 'rect', x, y, w: r2(w.w * k), h: r2(w.h * k), fill: 'ink2', role: 'wall' }); }
  if (rooms && labels) {
    const sz = Math.max(4.6, Math.min(6, k * 50));
    for (const r of plan.rooms || []) {
      const list = r.zones ? r.zones.filter((z) => ZONES[z.id]).map((z) => ({ at: z.label, name: ZONES[z.id] })) : [{ at: r.label, name: { en: r.name, he: r.nameHe || r.name } }];
      for (const z of list) if (z.at) { const [x, y] = P(z.at[0], z.at[1]); ops.push(textOp(x, y + 1, tr(z.name, lang), { size: sz, color: 'grey', align: 'center', dir, role: 'room-label' })); }
    }
  }
  const labelOps = [];
  for (const run of runs) {
    const polys = runFootprints(run, items), on = !highlight || highlight === run.id;
    for (const poly of polys) ops.push({ t: 'poly', pts: poly.map(([x, y]) => P(x, y)), close: true, fill: on ? 'accent' : 'accentMid', lw: 0.1, color: on ? 'accent' : 'accentMid', role: 'run', runId: run.id });
    if (labels && polys.length) {
      const [lx, ly] = P(...runLabelPoint(run, polys)), sz = Math.max(5.5, Math.min(7.5, k * 70));
      const t = textOp(lx, ly + sz * 0.125, run.code, { size: sz, font: 'bold', color: 'accent', align: 'center', dir: 'ltr', role: 'run-code' });
      labelOps.push({ t: 'rect', x: r2(lx - t.w / 2 - 0.8), y: r2(ly - sz * 0.22), w: r2(t.w + 1.6), h: r2(sz * 0.44), fill: 'paper' }, t);
    }
  }
  ops.push(...labelOps);
  if (north) {
    const nA = (((plan.meta && plan.meta.northAngle) || 0) * Math.PI) / 180, vx = Math.sin(nA), vy = -Math.cos(nA);
    const s = Math.max(4, Math.min(9, bw * 0.06)), cx = bx + bw - s * 0.9, cy = by + s * 1.3;
    ops.push(...northArrow(cx, cy, s, vx, vy, lang));
  }
  return { ops, k };
}

/** North arrow centred at (cx, cy), length s mm, pointing along the page vector (vx, vy). */
export function northArrow(cx, cy, s, vx, vy, lang = 'en') {
  const L = Math.hypot(vx, vy) || 1, ux = vx / L, uy = vy / L, px = -uy, py = ux, h = s / 2;
  const tip = [cx + ux * h, cy + uy * h], tail = [cx - ux * h, cy - uy * h];
  const left = [cx - ux * h * 0.35 + px * s * 0.22, cy - uy * h * 0.35 + py * s * 0.22], right = [cx - ux * h * 0.35 - px * s * 0.22, cy - uy * h * 0.35 - py * s * 0.22];
  const sz = Math.max(5, s * 0.75);
  return [
    { t: 'arc', cx: r2(cx), cy: r2(cy), r: r2(h * 0.62), a0: 0, a1: 360, lw: 0.15, color: 'ink2', role: 'north' },
    { t: 'poly', pts: [tip, left, [cx, cy], right].map(([x, y]) => [r2(x), r2(y)]), close: true, fill: 'ink', lw: 0.1, color: 'ink', role: 'north' },
    { t: 'line', x1: r2(cx), y1: r2(cy), x2: r2(tail[0]), y2: r2(tail[1]), lw: 0.15, color: 'ink2', role: 'north' },
    textOp(tip[0] + ux * sz * 0.32, tip[1] + uy * sz * 0.32 + sz * 0.125, lang === 'he' ? 'צ' : 'N', { size: sz, font: 'medium', color: 'ink', align: 'center', dir: 'ltr', role: 'north' }),
  ];
}
