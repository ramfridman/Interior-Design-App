// Fixtures for the several-floors import tests (stage F8): the "Duplex" of tests/fixtures/houses.mjs drawn floor by floor
// as an architect would — the outline of each floor's walls (door / window gaps open), door leaves with swing arcs, two
// glass lines per window, the stair on the ground floor (tread lines in a rectangle, walking line with an arrow head,
// "UP") and the opening above it on the first floor (a rectangle with a cross and "VOID") — as PDF-like primitives (one
// or two floors on a sheet) and as DXF (one or two floors in model space). Not part of the app.
import { DUPLEX } from './fixtures/houses.mjs';
import { dxfWriter } from './dxf-writer.mjs';
import { unionOutline } from './import-slant-fixtures.mjs';

const PT_CM = 2.54 / 72;
const DIRV = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const rectPoly = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];

/** Wall rectangles with the opening gaps cut out (the drawn wall solids). */
export function solidsOf(walls, openings) {
  const out = [];
  for (const w of walls) {
    let pieces = [{ ...w }];
    for (const o of openings) {
      if (o.axis === 'a') continue;
      const next = [];
      for (const p of pieces) {
        const ix = Math.min(p.x + p.w, o.x + o.w) - Math.max(p.x, o.x), iy = Math.min(p.y + p.h, o.y + o.h) - Math.max(p.y, o.y);
        if (ix <= 0 || iy <= 0) { next.push(p); continue; }
        if (p.w >= p.h) {    // horizontal wall: cut along x
          if (o.x > p.x) next.push({ ...p, w: o.x - p.x });
          if (o.x + o.w < p.x + p.w) next.push({ ...p, x: o.x + o.w, w: p.x + p.w - o.x - o.w });
        } else {
          if (o.y > p.y) next.push({ ...p, h: o.y - p.y });
          if (o.y + o.h < p.y + p.h) next.push({ ...p, y: o.y + o.h, h: p.y + p.h - o.y - o.h });
        }
      }
      pieces = next;
    }
    out.push(...pieces);
  }
  return out.map(rectPoly);
}

/** Door leaves + swing arcs (plan cm, angles in degrees with y down) and window glass lines of rect openings. */
export function openingSymbols(openings) {
  const lines = [], arcs = [], glass = [];
  const ang = (v) => Math.atan2(v[1], v[0]) * 180 / Math.PI;
  for (const d of openings) {
    if (d.kind === 'window') {
      if (d.axis === 'h') for (const k of [0.4, 0.6]) glass.push([d.x, d.y + d.h * k, d.x + d.w, d.y + d.h * k]);
      else for (const k of [0.4, 0.6]) glass.push([d.x + d.w * k, d.y, d.x + d.w * k, d.y + d.h]);
      continue;
    }
    if (d.kind !== 'door') continue;
    const width = d.axis === 'h' ? d.w : d.h;
    const jamb = d.axis === 'h' ? [d.hinge === 'w' ? d.x : d.x + d.w, d.swing === 'n' ? d.y : d.y + d.h] : [d.swing === 'w' ? d.x : d.x + d.w, d.hinge === 'n' ? d.y : d.y + d.h];
    const along = d.axis === 'h' ? [d.hinge === 'w' ? 1 : -1, 0] : [0, d.hinge === 'n' ? 1 : -1];
    const open = DIRV[d.swing];
    lines.push([jamb[0], jamb[1], jamb[0] + open[0] * width, jamb[1] + open[1] * width]);
    const a0 = ang(along);
    let sw = ang(open) - a0; while (sw > 180) sw -= 360; while (sw < -180) sw += 360;
    arcs.push({ cx: jamb[0], cy: jamb[1], r: width, a0, a1: a0 + sw });
  }
  return { lines, arcs, glass };
}

/**
 * A straight stair symbol over footprint { x, y, w, h } going up `up` ('n' | 's' | 'e' | 'w'): the rectangle, `risers`
 * riser lines (both ends included) `going` apart, the walking line with an arrow head at the top and "UP" at the bottom.
 */
export function stairSymbol(fp, { up = 'n', risers = 18, going = 29, arrow = true, text = true } = {}) {
  const lines = [], polys = [], texts = [];
  const v = up === 'n' || up === 's';
  lines.push(...rectLines(fp));
  for (let k = 1; k < risers - 1; k++) {
    if (v) { const y = up === 'n' ? fp.y + fp.h - k * going : fp.y + k * going; lines.push([fp.x, y, fp.x + fp.w, y]); }
    else { const x = up === 'e' ? fp.x + k * going : fp.x + fp.w - k * going; lines.push([x, fp.y, x, fp.y + fp.h]); }
  }
  const cx = fp.x + fp.w / 2, cy = fp.y + fp.h / 2, d = DIRV[up];
  const half = (v ? fp.h : fp.w) / 2 - 15;
  const a = [cx - d[0] * half, cy - d[1] * half], b = [cx + d[0] * half, cy + d[1] * half];
  if (arrow) {
    lines.push([a[0], a[1], b[0], b[1]]);
    const n = [-d[1], d[0]];
    polys.push([[b[0] - d[0] * 18 + n[0] * 9, b[1] - d[1] * 18 + n[1] * 9], b, [b[0] - d[0] * 18 - n[0] * 9, b[1] - d[1] * 18 - n[1] * 9]]);
  }
  if (text) texts.push({ str: 'UP', x: a[0] + 4, y: a[1] - 4, h: 10 });
  return { lines, polys, texts };
}
const rectLines = (r) => [[r.x, r.y, r.x + r.w, r.y], [r.x + r.w, r.y, r.x + r.w, r.y + r.h], [r.x + r.w, r.y + r.h, r.x, r.y + r.h], [r.x, r.y + r.h, r.x, r.y]];
/** An opening in the floor: its rectangle, the cross and "VOID". */
export function voidSymbol(r, { text = true } = {}) {
  return { lines: [...rectLines(r), [r.x, r.y, r.x + r.w, r.y + r.h], [r.x + r.w, r.y, r.x, r.y + r.h]], polys: [], texts: text ? [{ str: 'VOID', x: r.x + r.w / 2 - 15, y: r.y + r.h / 2 + 5, h: 10 }] : [] };
}

/** The drawing of one Duplex floor (plan cm): { lines (wall outline), doorLines, arcs, glass, stair: { lines, polys, texts } }. */
export function duplexFloor(level = 0, { stair = true } = {}) {
  const L = level ? DUPLEX.levels[level - 1] : DUPLEX;
  const sym = openingSymbols(L.openings);
  let st = { lines: [], polys: [], texts: [] };
  if (stair && !level) st = stairSymbol(DUPLEX.stairs[0].footprint, { up: 'n', risers: 18, going: 29 });
  if (stair && level === 1) { const v = L.voids[0].polygon; st = voidSymbol({ x: v[0][0], y: v[0][1], w: v[1][0] - v[0][0], h: v[2][1] - v[0][1] }); }
  return { lines: unionOutline(solidsOf(L.walls, L.openings)), doorLines: sym.lines, arcs: sym.arcs, glass: sym.glass, stair: st };
}

/** Map every coordinate of a floor drawing by `f([x, y]) → [x, y]` (rotate / move a floor on the sheet). */
export function mapFloor(d, f) {
  const L = (s) => { const a = f([s[0], s[1]]), b = f([s[2], s[3]]); return [a[0], a[1], b[0], b[1]]; };
  const arcs = d.arcs.map((a) => {
    const c = f([a.cx, a.cy]);
    // angles: map the arc's two end directions through f's linear part
    const o = f([0, 0]), dirAt = (deg) => { const p = f([Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180)]); return Math.atan2(p[1] - o[1], p[0] - o[0]) * 180 / Math.PI; };
    const a0 = dirAt(a.a0);
    let sw = dirAt(a.a1) - a0; while (sw > 180) sw -= 360; while (sw < -180) sw += 360;
    return { cx: c[0], cy: c[1], r: a.r, a0, a1: a0 + sw };
  });
  return { lines: d.lines.map(L), doorLines: d.doorLines.map(L), arcs, glass: d.glass.map(L),
    stair: { lines: d.stair.lines.map(L), polys: d.stair.polys.map((P) => P.map(f)), texts: d.stair.texts.map((t) => { const p = f([t.x, t.y]); return { ...t, x: p[0], y: p[1] }; }) } };
}
export const shiftBy = (dx, dy) => ([x, y]) => [x + dx, y + dy];

// ---------- PDF-like primitives ----------
const pen = (pts, lw, extra = {}) => ({ pts, closed: false, stroke: true, fill: false, evenOdd: false, lw, color: '#000000', fillColor: '#000000', dash: [], curved: false, ...extra });
function arcPts(a, P) {
  const out = [];
  const n = 24;
  for (let i = 0; i <= n; i++) { const t = (a.a0 + (a.a1 - a.a0) * i / n) * Math.PI / 180; out.push(...P(a.cx + a.r * Math.cos(t), a.cy + a.r * Math.sin(t))); }
  return out;
}
/**
 * PDF-like primitives of several floor drawings on one page at 1 : S (wall lines 0.7 pt, symbols 0.18 pt, stair lines
 * 0.25 pt, a "SCALE 1:S" text). `floors` = drawings already placed in sheet cm (see mapFloor / shiftBy).
 */
export function floorPrims(floors, { S = 100, off = [40, 60], page = { w: 1191, h: 842 } } = {}) {
  const k = 1 / (S * PT_CM);
  const P = (x, y) => [off[0] + x * k, off[1] + y * k];
  const paths = [], texts = [];
  for (const d of floors) {
    for (const [x1, y1, x2, y2] of d.lines) paths.push(pen([...P(x1, y1), ...P(x2, y2)], 0.7));
    for (const [x1, y1, x2, y2] of [...d.doorLines, ...d.glass]) paths.push(pen([...P(x1, y1), ...P(x2, y2)], 0.18));
    for (const a of d.arcs) paths.push(pen(arcPts(a, P), 0.18, { curved: true }));
    for (const [x1, y1, x2, y2] of d.stair.lines) paths.push(pen([...P(x1, y1), ...P(x2, y2)], 0.25));
    for (const poly of d.stair.polys) paths.push(pen(poly.flatMap(([x, y]) => P(x, y)), 0.25));
    for (const t of d.stair.texts) { const p = P(t.x, t.y); texts.push({ str: t.str, x: p[0], y: p[1], w: t.str.length * t.h * k * 0.6, h: t.h * k, angle: 0 }); }
  }
  texts.push({ str: 'SCALE 1:' + S, x: page.w - 140, y: page.h - 30, w: 60, h: 8, angle: 0 });
  return { pageBox: { ...page }, paths, texts, images: [] };
}

// ---------- DXF ----------
/** DXF (cm, R2018) of floor drawings placed in model cm: A-WALL, A-DOOR, A-GLAZ, A-STAIR (stairs, voids, their texts). */
export function floorsDxf(floors, { title = null } = {}) {
  const OX = 5000, OY = 20000, X = (x) => OX + x, Y = (y) => OY - y;
  const w = dxfWriter({ version: 'AC1032', insunits: 5 });
  w.layer('0', 7).layer('A-WALL', 7, { lw: 50 }).layer('A-DOOR', 3).layer('A-GLAZ', 4).layer('A-STAIR', 6).layer('A-ANNO', 1);
  const dxfArc = (a, layer) => { const s = Math.min(-a.a0, -a.a1), e = Math.max(-a.a0, -a.a1); w.arc([X(a.cx), Y(a.cy)], a.r, s, e, { layer }); };
  for (const d of floors) {
    for (const [x1, y1, x2, y2] of d.lines) w.line([X(x1), Y(y1)], [X(x2), Y(y2)], { layer: 'A-WALL' });
    for (const [x1, y1, x2, y2] of d.doorLines) w.line([X(x1), Y(y1)], [X(x2), Y(y2)], { layer: 'A-DOOR' });
    for (const a of d.arcs) dxfArc(a, 'A-DOOR');
    for (const [x1, y1, x2, y2] of d.glass) w.line([X(x1), Y(y1)], [X(x2), Y(y2)], { layer: 'A-GLAZ' });
    for (const [x1, y1, x2, y2] of d.stair.lines) w.line([X(x1), Y(y1)], [X(x2), Y(y2)], { layer: 'A-STAIR' });
    for (const poly of d.stair.polys) w.lwpoly(poly.map(([x, y]) => [X(x), Y(y)]), { layer: 'A-STAIR' });
    for (const t of d.stair.texts) w.text([X(t.x), Y(t.y)], t.h, t.str, { layer: 'A-STAIR' });
  }
  if (title) w.text([X(0), Y(-200)], 30, title, { layer: 'A-ANNO' });
  return w;
}

/** The two Duplex floors side by side on one sheet: ground floor at x 0, first floor at x `gap` + 1000 (plan cm). */
export function duplexSheet({ gap = 700, rotateUpper = 0 } = {}) {
  const g = duplexFloor(0), u = duplexFloor(1);
  let f = shiftBy(1000 + gap, 0);
  if (rotateUpper === 90) f = ([x, y]) => [1000 + gap + (800 - y), x];          // the first floor drawn turned 90° clockwise
  return [g, mapFloor(u, f)];
}
