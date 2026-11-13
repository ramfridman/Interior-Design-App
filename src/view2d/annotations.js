/**
 * Annotation layer: room / zone / outdoor-area labels with collision-aware placement, exterior dimension
 * chains and interior clear dimensions. Text boxes are registered in a shared registry so nothing overlaps.
 */
import { polygonBounds, pointInPolygon, areaM2, itemAABB, clamp } from '../core/geometry.js';
import { css } from './color.js';
import { exteriorChains, interiorDims, dimText, spanThrough } from './dimensions.js';
import { isBelowWalls, isFloating } from './items.js';
import { boundaryEdge } from './site.js';

/** Dimension chains of the current plan revision (the engine replaces plan.walls / openings / rooms on every edit). */
let dimsCache = null;
function plansDims(plan) {
  const c = dimsCache;
  if (!c || c.walls !== plan.walls || c.openings !== plan.openings || c.rooms !== plan.rooms) {
    dimsCache = { walls: plan.walls, openings: plan.openings, rooms: plan.rooms, chains: exteriorChains(plan), interior: interiorDims(plan) };
  }
  return dimsCache;
}

/** Device-px boxes of the furniture labels should try not to cover. */
function itemObstacles(G, env) {
  if (!env.ui.showItems) return [];
  const out = [];
  for (const it of env.store.items) {
    if (it.hidden || isBelowWalls(it) || isFloating(it)) continue;
    const b = itemAABB(it);
    out.push({ x0: G.X(b.x), y0: G.Y(b.y), x1: G.X(b.x + b.w), y1: G.Y(b.y + b.h) });
  }
  return out;
}
function overlap(box, list) {
  let s = 0;
  for (const b of list) {
    const w = Math.min(box.x1, b.x1) - Math.max(box.x0, b.x0), h = Math.min(box.y1, b.y1) - Math.max(box.y0, b.y0);
    if (w > 0 && h > 0) s += w * h;
  }
  return s;
}

/** Split a long name into two balanced lines at a separator or space. */
function wrapName(name) {
  const parts = name.split(/\s*[·/]\s*|\s+/).filter(Boolean);
  if (parts.length < 2) return [name];
  let best = null;
  for (let i = 1; i < parts.length; i++) {
    const a = parts.slice(0, i).join(' '), b = parts.slice(i).join(' ');
    const score = Math.abs(a.length - b.length);
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  return best.lines;
}

/**
 * Find the best centre for a label box (w × h device px) inside `poly`, close to `pref`, avoiding furniture
 * and other labels. Returns { x, y } in device px or null when the label does not fit the space at all.
 */
function placeLabel(G, poly, pref, w, h, obstacles, boxes, reachCm) {
  const b = polygonBounds(poly);
  if (w > b.w * G.k - 4 * G.dpr || h > b.h * G.k - 4 * G.dpr) return null;
  const rect = poly.length === 4;
  const hw = w / 2 / G.k, hh = h / 2 / G.k, d2 = G.dpr * G.dpr;
  const inside = (x, y) => (rect
    ? x - hw >= b.x && x + hw <= b.x + b.w && y - hh >= b.y && y + hh <= b.y + b.h
    : pointInPolygon(x - hw, y - hh, poly) && pointInPolygon(x + hw, y - hh, poly) && pointInPolygon(x + hw, y + hh, poly) && pointInPolygon(x - hw, y + hh, poly));
  const evaluate = (x, y, distPx) => {
    const cx = G.X(x), cy = G.Y(y);
    const box = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
    return { cost: overlap(box, obstacles) / d2 + boxes.overlapArea(box) * 25 / d2 + distPx * distPx * 0.1, x: cx, y: cy, box };
  };
  // the architect's label point wins outright when nothing is in the way
  if (inside(pref[0], pref[1])) { const at = evaluate(pref[0], pref[1], 0); if (at.cost < 1) return at; }
  const step = Math.max(20, 14 / G.scale);
  const n = Math.min(6, Math.ceil(reachCm / step));
  let best = null;
  for (let iy = -n; iy <= n; iy++) {
    for (let ix = -n; ix <= n; ix++) {
      const distPx = Math.hypot(ix, iy) * step * G.scale;
      if (best && distPx * distPx * 0.1 >= best.cost) continue;
      const x = pref[0] + ix * step, y = pref[1] + iy * step;
      if (!inside(x, y)) continue;
      const at = evaluate(x, y, distPx);
      if (!best || at.cost < best.cost) best = at;
    }
  }
  return best;
}

export function drawRoomLabels(G, env, boxes) {
  const { plan, pal } = env;
  const obstacles = itemObstacles(G, env);
  const size = clamp(9.6 + G.scale * 4, 10.5, 13), small = size - 1.5, d = G.dpr;
  const lineH = (s) => s * 1.28 * d;
  const spaces = [...plan.rooms, ...plan.outdoorAreas];

  const drawBlock = (lines, at) => {
    const total = lines.reduce((s, l) => s + lineH(l.size), 0);
    let y = at.y - total / 2;
    for (const l of lines) {
      G.text(l.text, at.x, y + lineH(l.size) / 2, { size: l.size, weight: l.weight, color: l.color, halo: pal.halo, spacing: l.spacing || 0 });
      y += lineH(l.size);
    }
  };
  const measureBlock = (lines) => ({
    w: Math.max(...lines.map((l) => G.measure(l.text, l.size, l.weight, l.spacing || 0))) + 8 * d,
    h: lines.reduce((s, l) => s + lineH(l.size), 0) + 4 * d,
  });

  for (const sp of spaces) {
    if (!sp.label) continue;
    const b = polygonBounds(sp.polygon);
    if (!G.visible(b.x, b.y, b.x + b.w, b.y + b.h)) continue;
    const area = { text: `${areaM2(sp.polygon).toFixed(1)} m²`, size: small, weight: 400, color: pal.inkSoft };
    const name = (t) => ({ text: t, size, weight: 600, color: pal.ink });
    const bx0 = G.X(b.x), by0 = G.Y(b.y), bx1 = G.X(b.x + b.w), by1 = G.Y(b.y + b.h);
    const near = obstacles.filter((o) => o.x1 > bx0 && o.x0 < bx1 && o.y1 > by0 && o.y0 < by1);
    const variants = [[name(sp.name), area], [...wrapName(sp.name).map(name), area], wrapName(sp.name).map(name)];
    for (const lines of variants) {
      const m = measureBlock(lines);
      const at = placeLabel(G, sp.polygon, sp.label, m.w, m.h, near, boxes, 260);
      if (!at) continue;
      drawBlock(lines, at);
      boxes.add(at.box);
      break;
    }
  }
  // zones of open spaces, in lighter small caps
  for (const room of plan.rooms) {
    for (const z of room.zones || []) {
      if (!G.visible(z.label[0] - 200, z.label[1] - 60, z.label[0] + 200, z.label[1] + 60)) continue;
      const line = { text: z.name.toUpperCase(), size: small - 0.5, weight: 600, color: pal.inkSoft, spacing: 0.14 };
      const m = measureBlock([line]);
      if (m.w > 260 * G.k) continue;
      const at = placeLabel(G, room.polygon, z.label, m.w, m.h, obstacles, boxes, 150);
      if (!at || boxes.collides(at.box, 1)) continue;
      drawBlock([line], at);
      boxes.add(at.box);
    }
  }
}

/** Bounds of the house plus its attached outdoor areas — dimension chains sit outside of this. */
function envelope(plan) {
  let x0 = plan.bounds.x, y0 = plan.bounds.y, x1 = x0 + plan.bounds.w, y1 = y0 + plan.bounds.h;
  for (const a of plan.outdoorAreas) {
    const b = polygonBounds(a.polygon);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return { x0, y0, x1, y1 };
}

export const DIM_ROW0 = 30, DIM_GAP = 23, DIM_GAP_SUB = 31;

/** Total CSS-px depth the exterior chains need outside the house envelope on each side. */
export function dimensionMargin(plan) {
  const rows = Math.max(...Object.values(plansDims(plan).chains).map((r) => r.length), 0);
  return rows ? DIM_ROW0 + DIM_GAP_SUB + DIM_GAP * Math.max(0, rows - 2) + 18 : 0;
}
export { envelope as houseEnvelope };

function subLabel(o) {
  if (!o || o.height == null) return null;
  return o.kind === 'window' ? `${o.height}(+${o.sill ?? 0})` : `h ${o.height}`;
}

const SIDES = ['n', 's', 'w', 'e'];
const FIG = 15, SUB = 14, TICK = 5;       // CSS px a row needs beside its line: figure / opening sub-label / bare ticks
const ROW_PAD = 3, NEAR_LEAD = 15, FAR_LEAD = 3, CLEAR = 3;

/**
 * Where the exterior chains of each side go (CSS px outward from the house envelope) at a given zoom.
 * The rows of a side stay together. They sit right beside the house when that band is clear; otherwise the whole
 * group moves out past whatever is in the way — parking bays, paved paths, the property line and its side-length
 * label — so a chain never runs through a site feature.
 * @returns {{ [side]: null | { horiz, sign, base, offsets: number[], start: number, reach: number, far: boolean } }}
 */
export function exteriorDimLayout(plan, ui, scale) {
  const { chains } = plansDims(plan);
  const env0 = envelope(plan), site = plan.site, out = {};
  for (const side of SIDES) {
    const rows = chains[side];
    if (!rows.length) { out[side] = null; continue; }
    const horiz = side === 'n' || side === 's', sign = side === 'n' || side === 'w' ? -1 : 1;
    const base = side === 'n' ? env0.y0 : side === 's' ? env0.y1 : side === 'w' ? env0.x0 : env0.x1;
    const a0 = rows[0][0].from - 8 / scale, a1 = rows[0][rows[0].length - 1].to + 8 / scale;
    // px needed on the house side / the far side of each row's line (figures sit above / left of their line)
    const figOut = sign < 0;
    const before = rows.map((r, i) => (figOut ? (i === 0 ? SUB : TICK) : FIG));
    const after = rows.map((r, i) => (figOut ? FIG : (i === 0 ? SUB : TICK)));
    const place = (start, lead) => {
      const offsets = [];
      let at = start + lead;
      rows.forEach((r, i) => { at += before[i]; offsets.push(at); at += after[i] + ROW_PAD; });
      return { offsets, end: at - ROW_PAD + 2 };
    };
    // what is in the way, as [lo, hi] px outward from the envelope
    const blocks = [];
    if (ui.showSite && site) {
      const span = (lo, hi, c0, c1, m0 = CLEAR, m1 = CLEAR) => {
        if (hi <= a0 || lo >= a1) return;
        const p = (sign > 0 ? c0 - base : base - c1) * scale - m0, q = (sign > 0 ? c1 - base : base - c0) * scale + m1;
        if (q > 0) blocks.push([Math.max(0, p), q]);
      };
      for (const bay of site.parking || []) {
        if (horiz) span(bay.x, bay.x + bay.w, bay.y, bay.y + bay.h); else span(bay.y, bay.y + bay.h, bay.x, bay.x + bay.w);
      }
      for (const path of site.paths || []) {
        const b = polygonBounds(path.polygon);
        if (horiz) span(b.x, b.x + b.w, b.y, b.y + b.h); else span(b.y, b.y + b.h, b.x, b.x + b.w);
      }
      // the property line and the side length written just outside it
      const [pa, pb] = boundaryEdge(site.boundary, side);
      const k = horiz ? 1 : 0;
      span(-Infinity, Infinity, Math.min(pa[k], pb[k]), Math.max(pa[k], pb[k]), 4, 21);
      blocks.sort((p, q) => p[0] - q[0]);
    }
    let start = 0, lead = NEAR_LEAD, fit = place(start, lead);
    for (let guard = 0; guard < 12; guard++) {
      const hit = blocks.find(([lo, hi]) => fit.end > lo && start < hi);
      if (!hit) break;
      start = hit[1]; lead = FAR_LEAD; fit = place(start, lead);
    }
    out[side] = { horiz, sign, base, offsets: fit.offsets, start, reach: fit.end, far: start > 0 };
  }
  return out;
}

/**
 * CSS px the exterior chains stick out beyond a plan rectangle on each side at zoom `scale` — used to frame
 * the lot / the house so the dimensions stay in view. `nearOnly` ignores the groups that were moved out past
 * the site features (framing the house should not zoom out to the street for them).
 */
export function dimensionOverhang(plan, ui, scale, rect, nearOnly = false) {
  const lay = exteriorDimLayout(plan, ui, scale);
  const edge = { n: rect.y, s: rect.y + rect.h, w: rect.x, e: rect.x + rect.w };
  const over = (side) => {
    const l = lay[side];
    return l && !(nearOnly && l.far) ? Math.max(0, l.reach - l.sign * (edge[side] - l.base) * scale) : 0;
  };
  return { top: over('n'), bottom: over('s'), left: over('w'), right: over('e') };
}

export function drawExteriorDims(G, env, boxes) {
  const { plan, pal, ui } = env, { ctx } = G, d = G.dpr;
  const { chains } = plansDims(plan);
  const layout = exteriorDimLayout(plan, ui, G.scale);
  const ink = pal.dim, size = 10.5, subSize = 8.5;
  // knock-out colour behind a figure: garden inside the lot, paper outside
  const inLot = (box) => ui.showSite && pointInPolygon(((box.x0 + box.x1) / 2 - G.ox) / G.k, ((box.y0 + box.y1) / 2 - G.oy) / G.k, plan.site.boundary);
  const mask = [css(pal.paper, 0.85), css(pal.garden, 0.85)];
  const unitSuffix = ui.units === 'cm' ? ' cm' : ' m';

  for (const side of SIDES) {
    const rows = chains[side], lay = layout[side];
    if (!rows.length || !lay) continue;
    const { horiz, sign } = lay;
    const base = horiz ? G.RY(lay.base) : G.RX(lay.base);
    const A = (v) => (horiz ? G.RX(v) : G.RY(v));
    let lastPos = base;
    rows.forEach((row, ri) => {
      const pos = base + sign * Math.round(lay.offsets[ri] * d);
      lastPos = pos;
      const a0 = A(row[0].from), a1 = A(row[row.length - 1].to);
      // line
      ctx.beginPath();
      if (horiz) { ctx.moveTo(a0 - 5 * d, pos + 0.5); ctx.lineTo(a1 + 5 * d, pos + 0.5); }
      else { ctx.moveTo(pos + 0.5, a0 - 5 * d); ctx.lineTo(pos + 0.5, a1 + 5 * d); }
      // witness ticks
      const breaks = [row[0].from, ...row.map((s) => s.to)];
      for (const v of breaks) {
        const a = A(v) + 0.5;
        if (horiz) { ctx.moveTo(a, pos - 4 * d); ctx.lineTo(a, pos + 4 * d + 1); }
        else { ctx.moveTo(pos - 4 * d, a); ctx.lineTo(pos + 4 * d + 1, a); }
      }
      ctx.strokeStyle = css(ink, 0.8); ctx.lineWidth = 1; ctx.stroke();
      // architectural slashes
      ctx.beginPath();
      for (const v of breaks) {
        const a = A(v) + 0.5, s = 3.5 * d;
        if (horiz) { ctx.moveTo(a - s, pos + 0.5 + s); ctx.lineTo(a + s, pos + 0.5 - s); }
        else { ctx.moveTo(pos + 0.5 - s, a + s); ctx.lineTo(pos + 0.5 + s, a - s); }
      }
      ctx.strokeStyle = ink; ctx.lineWidth = G.px(1.4); ctx.stroke();
      // figures
      for (const seg of row) {
        const len = seg.to - seg.from, mid = (A(seg.from) + A(seg.to)) / 2;
        const label = dimText(len, ui.units) + (seg.total ? unitSuffix : '');
        const weight = seg.total ? 700 : 500;
        const tw = G.measure(label, size, weight), th = size * d;
        const mk = (above) => (horiz
          ? { x0: mid - tw / 2, x1: mid + tw / 2, y0: above ? pos - 4 * d - th : pos + 4 * d, y1: above ? pos - 3 * d : pos + 5 * d + th }
          : { y0: mid - tw / 2, y1: mid + tw / 2, x0: above ? pos - 4 * d - th : pos + 4 * d, x1: above ? pos - 3 * d : pos + 5 * d + th });
        let above = true, box = mk(true);
        if (boxes.collides(box, 1.5 * d)) { above = false; box = mk(false); if (boxes.collides(box, 1.5 * d)) continue; }
        boxes.add(box);
        ctx.fillStyle = mask[inLot(box) ? 1 : 0]; ctx.fillRect(box.x0 - d, box.y0, box.x1 - box.x0 + 2 * d, box.y1 - box.y0);
        const opts = { size, weight, color: seg.total ? pal.ink : ink, baseline: above ? 'alphabetic' : 'top', angle: horiz ? 0 : -Math.PI / 2 };
        if (horiz) G.text(label, mid, above ? pos - 4 * d : pos + 5 * d, opts);
        else G.text(label, above ? pos - 4 * d : pos + 5 * d, mid, opts);
        // window height (+sill) / door height under the figure, as on the architect's sheet
        const sub = ri === 0 && above ? subLabel(seg.opening) : null;
        if (sub && G.scale >= 0.45) {
          const sw = G.measure(sub, subSize, 400), sh = subSize * d;
          const sb = horiz
            ? { x0: mid - sw / 2, x1: mid + sw / 2, y0: pos + 4 * d, y1: pos + 5 * d + sh }
            : { y0: mid - sw / 2, y1: mid + sw / 2, x0: pos + 4 * d, x1: pos + 5 * d + sh };
          if (!boxes.collides(sb, 2 * d)) {
            boxes.add(sb);
            const so = { size: subSize, color: css(ink, 0.8), baseline: 'top', angle: horiz ? 0 : -Math.PI / 2 };
            if (horiz) G.text(sub, mid, pos + 5 * d, so); else G.text(sub, pos + 5 * d, mid, so);
          }
        }
      }
    });
    // extension lines at the two extreme ends
    const first = rows[0][0], last = rows[0][rows[0].length - 1];
    ctx.beginPath();
    for (const [v, depth] of [[first.from, first.depth], [last.to, last.depth]]) {
      const a = A(v) + 0.5;
      // beside the house they start at the façade; a group moved out past the site features keeps short stubs
      const from = lay.far ? base + sign * Math.round((lay.start + 1) * d) : (horiz ? G.RY(depth) : G.RX(depth)) + sign * 6 * d;
      const to = lastPos + sign * 7 * d;
      if (horiz) { ctx.moveTo(a, from); ctx.lineTo(a, to); } else { ctx.moveTo(from, a); ctx.lineTo(to, a); }
    }
    ctx.strokeStyle = css(ink, 0.45); ctx.lineWidth = 1; ctx.stroke();
  }
}

/**
 * Positions for a zone dimension: just beside the zone label (so the line does not strike through the text),
 * as long as the clear span is the same there; otherwise through the label point itself.
 */
function zoneOffsets(room, dim, G) {
  if (!room) return [dim.at];
  const horiz = dim.dir === 'h';
  const mid = (dim.from + dim.to) / 2;
  const out = [];
  for (const off of horiz ? [13, -13] : [-46, 46]) {
    const at = dim.at + off / G.scale;
    const span = horiz ? spanThrough(room.polygon, mid, at + 0.5, 'h') : spanThrough(room.polygon, at + 0.5, mid, 'v');
    if (span && span[0] === dim.from && span[1] === dim.to) out.push(at);
  }
  return out.length ? out : [dim.at];
}

export function drawInteriorDims(G, env, boxes) {
  const { plan, pal, ui } = env, { ctx } = G, d = G.dpr;
  if (G.scale < 0.3) return;
  const obstacles = itemObstacles(G, env);
  const size = 9.5, ink = pal.dim;
  const inset = 11 / G.scale;      // cm: primary dimensions hug a wall, 11 px inside the room
  for (const dim of plansDims(plan).interior) {
    const lenPx = (dim.to - dim.from) * G.scale;
    if (lenPx < 64) continue;
    const horiz = dim.dir === 'h';
    const label = dimText(dim.to - dim.from, ui.units);
    const tw = G.measure(label, size, 500) + 6 * d, th = (size + 3) * d;
    const room = plan.rooms.find((r) => r.id === dim.room);
    const b = room ? polygonBounds(room.polygon) : null;
    const positions = dim.primary && b
      ? (horiz ? [b.y + inset, b.y + b.h - inset] : [b.x + inset, b.x + b.w - inset])
      : zoneOffsets(room, dim, G);
    let best = null;
    for (const at of positions) {
      for (const t of [0.5, 0.32, 0.68, 0.18, 0.82]) {
        const along = dim.from + (dim.to - dim.from) * t;
        const cx = horiz ? G.X(along) : G.RX(at) + 0.5, cy = horiz ? G.RY(at) + 0.5 : G.Y(along);
        const box = horiz
          ? { x0: cx - tw / 2, x1: cx + tw / 2, y0: cy - th / 2, y1: cy + th / 2 }
          : { x0: cx - th / 2, x1: cx + th / 2, y0: cy - tw / 2, y1: cy + tw / 2 };
        if (boxes.collides(box, 2 * d)) continue;
        const cost = overlap(box, obstacles) + Math.abs(t - 0.5) * 40 * d * d;
        if (!best || cost < best.cost) best = { cost, at, cx, cy, box };
      }
    }
    if (!best) continue;
    if (!G.visible(horiz ? dim.from : best.at - 1, horiz ? best.at - 1 : dim.from, horiz ? dim.to : best.at + 1, horiz ? best.at + 1 : dim.to)) continue;
    boxes.add(best.box);
    const p0 = horiz ? G.RX(dim.from) : G.RY(dim.from), p1 = horiz ? G.RX(dim.to) : G.RY(dim.to);
    const line = horiz ? G.RY(best.at) + 0.5 : G.RX(best.at) + 0.5;
    ctx.beginPath();
    const gap0 = (horiz ? best.box.x0 : best.box.y0), gap1 = (horiz ? best.box.x1 : best.box.y1);
    const piece = (a, c) => { if (c - a < 2) return; if (horiz) { ctx.moveTo(a, line); ctx.lineTo(c, line); } else { ctx.moveTo(line, a); ctx.lineTo(line, c); } };
    piece(p0, gap0); piece(gap1, p1);
    ctx.strokeStyle = css(ink, 0.55); ctx.lineWidth = 1; ctx.stroke();
    // small arrow heads on the wall faces
    ctx.beginPath();
    for (const [p, dir] of [[p0, 1], [p1, -1]]) {
      const a = 5 * d, w = 2 * d;
      if (horiz) { ctx.moveTo(p, line); ctx.lineTo(p + dir * a, line - w); ctx.lineTo(p + dir * a, line + w); }
      else { ctx.moveTo(line, p); ctx.lineTo(line - w, p + dir * a); ctx.lineTo(line + w, p + dir * a); }
      ctx.closePath();
    }
    ctx.fillStyle = css(ink, 0.7); ctx.fill();
    ctx.fillStyle = pal.halo; ctx.fillRect(Math.round(best.box.x0), Math.round(best.box.y0), Math.round(best.box.x1 - best.box.x0), Math.round(best.box.y1 - best.box.y0));
    G.text(label, best.cx, best.cy + (horiz ? 0.5 * d : 0), { size, weight: 500, color: ink, angle: horiz ? 0 : -Math.PI / 2 });
  }
}
