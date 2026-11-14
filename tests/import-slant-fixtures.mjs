// Fixtures for the angled / curved wall import tests (stage A6): the "Wedge" house of
// docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md § 4 and a quarter-circle wall, drawn as an architect would — the outline of
// the union of every wall piece, door swings and window glass lines — as PDF-like primitives and as DXF.
// Not part of the app. (tests/fixtures/houses.mjs does not exist yet; the Wedge numbers are copied from the design.)
import { dxfWriter } from './dxf-writer.mjs';

const PT_CM = 2.54 / 72;

// ---------- the Wedge (cm, plan frame: +x east, +y south) ----------
export const WEDGE = {
  rects: [
    { id: 'north', x: 0, y: 0, w: 1000, h: 20, kind: 'exterior' },
    { id: 'west', x: 0, y: 20, w: 20, h: 760, kind: 'exterior' },
    { id: 'south', x: 0, y: 780, w: 600, h: 20, kind: 'exterior' },
    { id: 'partition', x: 500, y: 20, w: 10, h: 760, kind: 'interior' },
  ],
  slants: [
    { id: 's01', x1: 990, y1: 10, x2: 590, y2: 790, t: 20, kind: 'exterior' },
    { id: 's02', x1: 25, y1: 300, x2: 300, y2: 25, t: 10, kind: 'interior' },
  ],
  // openings: in s01 a window of 120 at half its length; in s02 a door of 80 at its midpoint (hinge at jamb 'a',
  // swinging to the right of s02's x1 → x2 direction, i.e. into the north-west triangle); a door in the partition
  // (y 350–430, hinge north, swinging east) and the entry door in the south wall (x 200–290, hinge west, swinging north)
  slantOpenings: [
    { kind: 'window', wall: 's01', width: 120, at: 'mid' },
    { kind: 'door', wall: 's02', width: 80, at: 'mid', hinge: 'a', swing: 'r' },
  ],
  rectDoors: [
    { axis: 'v', x: 500, y: 350, w: 10, h: 80, hinge: 'n', swing: 'e' },
    { axis: 'h', x: 200, y: 780, w: 90, h: 20, hinge: 'w', swing: 'n' },
  ],
};

export const slantLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
/** Quad of a slant piece between `a` and `b` cm along its centre line (butt ends). */
export function slantQuad(s, a, b) {
  const L = slantLen(s), ux = (s.x2 - s.x1) / L, uy = (s.y2 - s.y1) / L, nx = -uy * s.t / 2, ny = ux * s.t / 2;
  const P = (d) => [s.x1 + ux * d, s.y1 + uy * d];
  const [ax, ay] = P(a), [bx, by] = P(b);
  return [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]];
}
const rectPoly = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];

/** Solid wall polygons of the Wedge with the opening gaps cut out (what the outline is drawn around). */
export function wedgeSolids() {
  const W = WEDGE;
  const polys = [];
  // rect walls, with the partition door and the entry door cut out
  polys.push(rectPoly(W.rects[0]), rectPoly(W.rects[1]));
  polys.push(rectPoly({ x: 0, y: 780, w: 200, h: 20 }), rectPoly({ x: 290, y: 780, w: 310, h: 20 }));
  polys.push(rectPoly({ x: 500, y: 20, w: 10, h: 330 }), rectPoly({ x: 500, y: 430, w: 10, h: 350 }));
  // s01 as designed (butt ends at its centre-line points), with the window gap
  const s1 = W.slants[0], L1 = slantLen(s1), m1 = L1 / 2;
  polys.push(slantQuad(s1, 0, m1 - 60), slantQuad(s1, m1 + 60, L1));
  // s02 drawn into the walls it meets (its ends extended to the walls' centre lines, hidden in the union), door gap
  const s2 = W.slants[1], L2 = slantLen(s2), m2 = L2 / 2, ext = 15 * Math.SQRT2;
  polys.push(slantQuad(s2, -ext, m2 - 40), slantQuad(s2, m2 + 40, L2 + ext));
  return polys;
}

/** Door / window symbols of the Wedge (plan cm): { lines: [[x1, y1, x2, y2]], arcs: [{ cx, cy, r, a0, a1 } (deg, y down)] }. */
export function wedgeSymbols() {
  const W = WEDGE, lines = [], arcs = [];
  // windows: two glass lines along s01 in the gap, 3 cm either side of the centre line
  const s1 = W.slants[0], L1 = slantLen(s1), u1 = [(s1.x2 - s1.x1) / L1, (s1.y2 - s1.y1) / L1], n1 = [-u1[1], u1[0]];
  for (const off of [-3, 3]) {
    const a = L1 / 2 - 60, b = L1 / 2 + 60;
    lines.push([s1.x1 + u1[0] * a + n1[0] * off, s1.y1 + u1[1] * a + n1[1] * off, s1.x1 + u1[0] * b + n1[0] * off, s1.y1 + u1[1] * b + n1[1] * off]);
  }
  // s02 door: hinge at jamb 'a' (along = mid − 40) on the right face, leaf open towards the right normal
  const s2 = W.slants[1], L2 = slantLen(s2), u2 = [(s2.x2 - s2.x1) / L2, (s2.y2 - s2.y1) / L2], n2 = [-u2[1], u2[0]];
  const ha = L2 / 2 - 40, H = [s2.x1 + u2[0] * ha + n2[0] * 5, s2.y1 + u2[1] * ha + n2[1] * 5];
  lines.push([H[0], H[1], H[0] + n2[0] * 80, H[1] + n2[1] * 80]);
  const ang = (v) => Math.atan2(v[1], v[0]) * 180 / Math.PI;
  arcs.push({ cx: H[0], cy: H[1], r: 80, a0: ang(u2), a1: ang(u2) + 90 });   // from closed (along u) to open (along n): +90° on screen
  // rect doors (hinge on the swing-side face)
  for (const d of W.rectDoors) {
    const width = d.axis === 'h' ? d.w : d.h;
    const jamb = d.axis === 'h' ? [d.hinge === 'w' ? d.x : d.x + d.w, d.swing === 'n' ? d.y : d.y + d.h] : [d.swing === 'w' ? d.x : d.x + d.w, d.hinge === 'n' ? d.y : d.y + d.h];
    const along = d.axis === 'h' ? [d.hinge === 'w' ? 1 : -1, 0] : [0, d.hinge === 'n' ? 1 : -1];
    const open = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[d.swing];
    lines.push([jamb[0], jamb[1], jamb[0] + open[0] * width, jamb[1] + open[1] * width]);
    let a0 = ang(along), a1 = ang(open);
    let sw = a1 - a0; while (sw > 180) sw -= 360; while (sw < -180) sw += 360;
    arcs.push({ cx: jamb[0], cy: jamb[1], r: width, a0, a1: a0 + sw });
  }
  return { lines, arcs };
}

// ---------- quarter-circle wall: centre (400, 310), centre-line radius 300, t 20, from north (−90°) to east (0°) ----------
export const QUARTER = { cx: 400, cy: 310, r: 300, t: 20, a0: -90, a1: 0,
  rects: [{ x: 0, y: 0, w: 400, h: 20 }, { x: 0, y: 20, w: 20, h: 680 }, { x: 0, y: 700, w: 710, h: 20 }, { x: 690, y: 310, w: 20, h: 390 }] };
/** Outline of the quarter-circle house as straight lines plus the two arcs (plan cm). */
export function quarterOutline() {
  const Q = QUARTER, ro = Q.r + Q.t / 2, ri = Q.r - Q.t / 2;
  const lines = [
    [0, 0, 400, 0], [20, 20, 400, 20], [0, 0, 0, 720], [20, 20, 20, 700], [0, 720, 710, 720], [20, 700, 690, 700],
    [710, 310, 710, 720], [690, 310, 690, 700],
  ];
  return { lines, arcs: [{ cx: Q.cx, cy: Q.cy, r: ro, a0: -90, a1: 0 }, { cx: Q.cx, cy: Q.cy, r: ri, a0: -90, a1: 0 }] };
}

// ---------- union outline of polygons (exact, for fixtures) ----------
const cross = (ax, ay, bx, by) => ax * by - ay * bx;
function pip(P, x, y) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Boundary of the union of polygons as maximal straight segments [[x1, y1, x2, y2]]. */
export function unionOutline(polys) {
  const edges = [];
  for (const P of polys) for (let i = 0; i < P.length; i++) edges.push([P[i], P[(i + 1) % P.length]]);
  const inside = (x, y) => polys.some((P) => pip(P, x, y));
  const pieces = [];
  for (const [a, b] of edges) {
    const rx = b[0] - a[0], ry = b[1] - a[1], rr = rx * rx + ry * ry;
    if (rr < 1e-18) continue;
    const ts = [0, 1];
    for (const [c, d] of edges) {
      const sx = d[0] - c[0], sy = d[1] - c[1], den = cross(rx, ry, sx, sy);
      const qx = c[0] - a[0], qy = c[1] - a[1];
      if (Math.abs(den) > 1e-12) {
        const t = cross(qx, qy, sx, sy) / den, u = cross(qx, qy, rx, ry) / den;
        if (t > 1e-12 && t < 1 - 1e-12 && u > -1e-12 && u < 1 + 1e-12) ts.push(t);
      } else if (Math.abs(cross(qx, qy, rx, ry)) < 1e-9 * Math.sqrt(rr)) {
        for (const p of [c, d]) { const t = ((p[0] - a[0]) * rx + (p[1] - a[1]) * ry) / rr; if (t > 1e-12 && t < 1 - 1e-12) ts.push(t); }
      }
    }
    ts.sort((p, q) => p - q);
    const L = Math.sqrt(rr), nx = -ry / L * 1e-4, ny = rx / L * 1e-4;
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] - ts[i - 1] < 1e-9) continue;
      const tm = (ts[i] + ts[i - 1]) / 2, mx = a[0] + rx * tm, my = a[1] + ry * tm;
      if (inside(mx + nx, my + ny) !== inside(mx - nx, my - ny)) pieces.push([a[0] + rx * ts[i - 1], a[1] + ry * ts[i - 1], a[0] + rx * ts[i], a[1] + ry * ts[i]]);
    }
  }
  // merge collinear touching pieces (and duplicates)
  const groups = new Map();
  for (const [x1, y1, x2, y2] of pieces) {
    const L = Math.hypot(x2 - x1, y2 - y1);
    let ux = (x2 - x1) / L, uy = (y2 - y1) / L;
    if (uy < -1e-12 || (Math.abs(uy) <= 1e-12 && ux < 0)) { ux = -ux; uy = -uy; }
    const c = cross(ux, uy, x1, y1);
    const key = `${ux.toFixed(6)},${uy.toFixed(6)},${c.toFixed(4)}`;
    if (!groups.has(key)) groups.set(key, { ux, uy, c, iv: [] });
    const p = x1 * ux + y1 * uy, q = x2 * ux + y2 * uy;
    groups.get(key).iv.push([Math.min(p, q), Math.max(p, q)]);
  }
  const out = [];
  for (const g of groups.values()) {
    g.iv.sort((p, q) => p[0] - q[0]);
    let cur = null;
    const emit = () => { if (cur) out.push([g.ux * cur[0] - g.uy * g.c, g.uy * cur[0] + g.ux * g.c, g.ux * cur[1] - g.uy * g.c, g.uy * cur[1] + g.ux * g.c]); };
    for (const iv of g.iv) {
      if (cur && iv[0] <= cur[1] + 1e-6) cur[1] = Math.max(cur[1], iv[1]);
      else { emit(); cur = iv.slice(); }
    }
    emit();
  }
  return out;
}

// ---------- drawing back-ends ----------
const pen = (pts, lw, extra = {}) => ({ pts, closed: false, stroke: true, fill: false, evenOdd: false, lw, color: '#000000', fillColor: '#000000', dash: [], curved: false, ...extra });
/** Arc as a PDF would hold it: cubic Béziers of ≤ 90°, each flattened in 12 steps (as readPdf does). */
function bezierArcPts(cx, cy, r, a0, a1) {
  const out = [];
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90 - 1e-9));
  for (let k = 0; k < n; k++) {
    const t0 = (a0 + (a1 - a0) * k / n) * Math.PI / 180, t1 = (a0 + (a1 - a0) * (k + 1) / n) * Math.PI / 180;
    const h = 4 / 3 * Math.tan((t1 - t0) / 4);
    const p0 = [cx + r * Math.cos(t0), cy + r * Math.sin(t0)], p3 = [cx + r * Math.cos(t1), cy + r * Math.sin(t1)];
    const p1 = [p0[0] - h * r * Math.sin(t0), p0[1] + h * r * Math.cos(t0)], p2 = [p3[0] + h * r * Math.sin(t1), p3[1] - h * r * Math.cos(t1)];
    for (let i = k ? 1 : 0; i <= 12; i++) {
      const t = i / 12, s = 1 - t;
      out.push(s * s * s * p0[0] + 3 * s * s * t * p1[0] + 3 * s * t * t * p2[0] + t * t * t * p3[0], s * s * s * p0[1] + 3 * s * s * t * p1[1] + 3 * s * t * t * p2[1] + t * t * t * p3[1]);
    }
  }
  return out;
}

/**
 * PDF-like primitives at 1:S: wall outline lines (lw 0.7), symbols (lw 0.18), wall arcs as flattened Béziers.
 * `xf(x, y)` maps plan cm before drawing (default identity) — used to draw a rotated / mirrored copy.
 */
export function pdfPrims({ lines = [], wallArcs = [], symLines = [], symArcs = [] }, { S = 50, off = [60, 80], scaleText = true } = {}) {
  const k = 1 / (S * PT_CM);
  const P = (x, y) => [off[0] + x * k, off[1] + y * k];
  const paths = [];
  for (const [x1, y1, x2, y2] of lines) paths.push(pen([...P(x1, y1), ...P(x2, y2)], 0.7));
  for (const a of wallArcs) { const q = bezierArcPts(a.cx, a.cy, a.r, a.a0, a.a1); const pts = []; for (let i = 0; i < q.length; i += 2) pts.push(...P(q[i], q[i + 1])); paths.push(pen(pts, 0.7, { curved: true })); }
  for (const [x1, y1, x2, y2] of symLines) paths.push(pen([...P(x1, y1), ...P(x2, y2)], 0.18));
  for (const a of symArcs) { const q = bezierArcPts(a.cx, a.cy, a.r, a.a0, a.a1); const pts = []; for (let i = 0; i < q.length; i += 2) pts.push(...P(q[i], q[i + 1])); paths.push(pen(pts, 0.18, { curved: true })); }
  return { pageBox: { w: 842, h: 595 }, paths, texts: scaleText ? [{ str: 'SCALE 1:' + S, x: 600, y: 560, w: 60, h: 8, angle: 0 }] : [], images: [] };
}

/** DXF (cm, R2018): walls as LINEs / ARCs on A-WALL, door leaves and swings on A-DOOR, glass lines on A-GLAZ. */
export function dxfOf({ lines = [], wallArcs = [], symLines = [], symArcs = [], winLines = [] }) {
  const OX = 12000, OY = 30000, X = (x) => OX + x, Y = (y) => OY - y;
  const w = dxfWriter({ version: 'AC1032', insunits: 5 });
  w.layer('0', 7).layer('A-WALL', 7, { lw: 50 }).layer('A-DOOR', 3).layer('A-GLAZ', 4);
  for (const [x1, y1, x2, y2] of lines) w.line([X(x1), Y(y1)], [X(x2), Y(y2)], { layer: 'A-WALL' });
  // plan angles are measured with y down; DXF is y up and counter-clockwise: a plan angle θ is −θ in the DXF
  const dxfArc = (a, layer) => { const s = Math.min(-a.a0, -a.a1), e = Math.max(-a.a0, -a.a1); w.arc([X(a.cx), Y(a.cy)], a.r, s, e, { layer }); };
  for (const a of wallArcs) dxfArc(a, 'A-WALL');
  for (const [x1, y1, x2, y2] of symLines) w.line([X(x1), Y(y1)], [X(x2), Y(y2)], { layer: 'A-DOOR' });
  for (const a of symArcs) dxfArc(a, 'A-DOOR');
  for (const [x1, y1, x2, y2] of winLines) w.line([X(x1), Y(y1)], [X(x2), Y(y2)], { layer: 'A-GLAZ' });
  return w;
}

/** Everything of the Wedge drawing (plan cm), split by role. */
export function wedgeDrawing() {
  const sym = wedgeSymbols();
  return { lines: unionOutline(wedgeSolids()), winLines: sym.lines.slice(0, 2), doorLines: sym.lines.slice(2), arcs: sym.arcs };
}
