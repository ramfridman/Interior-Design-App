/**
 * Windows and doors of the house, built from PLAN.openings (cm → m). Nothing here is positioned by hand:
 * width, height, sill, wall thickness, hinge side and swing direction all come from the plan record.
 *
 * Every opening is modelled in a canonical frame and then placed with one rigid transform:
 *   X = along the wall (opening centred on 0), Y = up from the finished floor,
 *   Z = across the wall (0 = wall centre), +Z = the opening's FRONT:
 *       hinged doors → the side the leaf swings into;   windows / sliding door → outdoors.
 * All parts of all openings are merged into one mesh per material (≈ 8 draw calls for the whole house).
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;
const DOOR_OPEN_ANGLE = 85 * DEG;

// ───────────────────────── geometry soup (shared with house.js / site.js) ─────────────────────────
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();

/** Growable triangle soup: positions, normals and metre-scaled UVs; one BufferGeometry per material. */
export class Soup {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; this.shades = []; }
  get empty() { return this.idx.length === 0; }

  /**
   * Add a planar quad. `pts` = 4 corners [x, y, z] in loop order (either winding); the winding is fixed so that
   * the front face looks along `n`. `uvs` = 4 [u, v] pairs matching `pts` (defaults to zeros).
   * `shades` = optional 4 grey factors (vertex colour, used for baked soft shading on walls).
   */
  quad(pts, n, uvs, shades) {
    _a.fromArray(pts[0]); _b.fromArray(pts[1]).sub(_a); _c.fromArray(pts[2]).sub(_a);
    const flip = _b.cross(_c).dot(_n.set(n[0], n[1], n[2])) < 0;
    const base = this.pos.length / 3;
    for (let k = 0; k < 4; k++) {
      const i = flip ? (4 - k) % 4 : k;
      this.pos.push(pts[i][0], pts[i][1], pts[i][2]);
      this.nor.push(n[0], n[1], n[2]);
      if (uvs) this.uv.push(uvs[i][0], uvs[i][1]); else this.uv.push(0, 0);
      if (shades && shades[i] !== 1) this.shades.push(base + k, shades[i]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Add a triangle with a fixed normal (winding corrected like quad()). */
  tri(p0, p1, p2, n, uvs) {
    _a.fromArray(p0); _b.fromArray(p1).sub(_a); _c.fromArray(p2).sub(_a);
    const flip = _b.cross(_c).dot(_n.set(n[0], n[1], n[2])) < 0;
    const base = this.pos.length / 3, order = flip ? [p0, p2, p1] : [p0, p1, p2], uo = uvs ? (flip ? [uvs[0], uvs[2], uvs[1]] : uvs) : null;
    order.forEach((p, i) => { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(uo ? uo[i][0] : 0, uo ? uo[i][1] : 0); });
    this.idx.push(base, base + 1, base + 2);
  }

  /** Axis-aligned box in the local frame of matrix `m` (rigid transforms only). `skip` = face letters to omit, e.g. 'b' (bottom). */
  box(m, x0, x1, y0, y1, z0, z1, skip = '') {
    if (!(x1 > x0 && y1 > y0 && z1 > z0)) return;
    const P = (x, y, z) => _a.set(x, y, z).applyMatrix4(m).toArray();
    const N = (x, y, z) => _n.set(x, y, z).transformDirection(m).toArray();
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const face = (pts, n, uw, uh) => this.quad(pts, n, [[0, 0], [uw, 0], [uw, uh], [0, uh]]);
    if (!skip.includes('r')) face([P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)], N(1, 0, 0), d, h);
    if (!skip.includes('l')) face([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], N(-1, 0, 0), d, h);
    if (!skip.includes('t')) face([P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)], N(0, 1, 0), w, d);
    if (!skip.includes('b')) face([P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], N(0, -1, 0), w, d);
    if (!skip.includes('f')) face([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], N(0, 0, 1), w, h);
    if (!skip.includes('k')) face([P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)], N(0, 0, -1), w, h);
  }

  /** Axis-aligned cylinder in the local frame of `m`: centre (cx, cy, cz), radius r, length len along `axis`. */
  cyl(m, axis, cx, cy, cz, r, len, seg = 10) {
    const pt = (a, s) => {                                   // a = angle around the axis, s = ±len/2 along it
      const u = Math.cos(a) * r, v = Math.sin(a) * r;
      return axis === 'x' ? [cx + s, cy + u, cz + v] : axis === 'y' ? [cx + v, cy + s, cz + u] : [cx + u, cy + v, cz + s];
    };
    const dir = (a) => { const u = Math.cos(a), v = Math.sin(a); return axis === 'x' ? [0, u, v] : axis === 'y' ? [v, 0, u] : [u, v, 0]; };
    const P = (p) => _a.fromArray(p).applyMatrix4(m).toArray();
    const N = (p) => _n.fromArray(p).transformDirection(m).toArray();
    const ax = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    const c0 = P(pt(0, -len / 2).map((v, i) => v - dir(0)[i] * r)), c1 = P(pt(0, len / 2).map((v, i) => v - dir(0)[i] * r));
    const n0 = N(ax.map((v) => -v)), n1 = N(ax);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      const p00 = P(pt(a0, -len / 2)), p10 = P(pt(a1, -len / 2)), p11 = P(pt(a1, len / 2)), p01 = P(pt(a0, len / 2));
      this.quad([p00, p10, p11, p01], N(dir(am)));
      this.tri(c0, p00, p10, n0); this.tri(c1, p01, p11, n1);
    }
  }

  /** @param {boolean} [withColor] also write a vertex-colour attribute (white unless a quad gave `shades`). */
  toGeometry(withColor = false) {
    const g = new THREE.BufferGeometry();
    if (withColor) {
      const col = new Float32Array(this.pos.length).fill(1);
      for (let i = 0; i < this.shades.length; i += 2) col.fill(this.shades[i + 1], this.shades[i] * 3, this.shades[i] * 3 + 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// ───────────────────────── plan → canonical frame ─────────────────────────
const SIGN = { n: -1, w: -1, s: 1, e: 1 };
const YAW = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };   // rotation.y that turns canonical +Z to that side
const LOCAL_X = { s: 'e', n: 'w', e: 'n', w: 's' };                   // world side canonical +X points to
const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };

const isHinged = (o) => o.kind === 'door';

/** The plan side that canonical +Z (the opening's front) points to. */
function frontOf(o) {
  const sides = o.axis === 'h' ? ['n', 's'] : ['w', 'e'];
  if (isHinged(o) && sides.includes(o.swing)) return o.swing;
  if (sides.includes(o.outside)) return o.outside;
  return sides[1];
}

/** Distance (cm) of the frame centre plane from the wall centre, towards the front (canonical +Z). */
function framePlaneOffset(o, t, front) {
  const out = o.exterior && o.outside ? (o.outside === front ? 1 : -1) : 0;
  if (o.kind === 'window') return out * Math.max(0, t / 2 - 7);     // set near the outer face, slim external reveal
  if (o.style === 'mamad') return t / 2 - 5;                        // blast door sits on the outer (swing-side) face
  return 0;
}

/**
 * Where an opening sits across its wall, in plan centimetres. house.js uses `plane` to split reveals into an
 * inner (room finish) and outer (exterior render) part exactly at the frame.
 * @returns {{ front: 'n'|'s'|'e'|'w', t: number, mid: number, plane: number }}
 */
export function openingFrame(o) {
  const front = frontOf(o);
  const t = o.axis === 'h' ? o.h : o.w;
  const mid = o.axis === 'h' ? o.y + o.h / 2 : o.x + o.w / 2;
  return { front, t, mid, plane: mid + SIGN[front] * framePlaneOffset(o, t, front) };
}

/** Free solid wall length (cm) next to a jamb, on the canonical ±X side — decides where the mamad shutter parks. */
function wallRunBeside(o, plan, dirName) {
  const s = SIGN[dirName];
  let edge = o.axis === 'h' ? (s > 0 ? o.x + o.w : o.x) : (s > 0 ? o.y + o.h : o.y), run = 0;
  for (let guard = 0; guard < 8; guard++) {
    const next = plan.walls.find((w) => (o.axis === 'h'
      ? w.y <= o.y && w.y + w.h >= o.y + o.h && (s > 0 ? w.x === edge : w.x + w.w === edge)
      : w.x <= o.x && w.x + w.w >= o.x + o.w && (s > 0 ? w.y === edge : w.y + w.h === edge)));
    if (!next) break;
    const len = o.axis === 'h' ? next.w : next.h;
    run += len; edge += s * len;
  }
  return run;
}

// ───────────────────────── builders (metres, canonical frame) ─────────────────────────
/** Collects boxes per material; clips everything at the cutaway height. */
class Parts {
  constructor(cut) { this.soups = new Map(); this.cut = cut; }
  soup(mat) { if (!this.soups.has(mat)) this.soups.set(mat, new Soup()); return this.soups.get(mat); }
  box(mat, m, x0, x1, y0, y1, z0, z1) {
    if (y0 >= this.cut) return;
    this.soup(mat).box(m, Math.min(x0, x1), Math.max(x0, x1), y0, Math.min(y1, this.cut), Math.min(z0, z1), Math.max(z0, z1));
  }
  cyl(mat, m, axis, cx, cy, cz, r, len, seg) {
    const top = axis === 'y' ? cy + len / 2 : cy + r;
    if (top > this.cut) return;
    this.soup(mat).cyl(m, axis, cx, cy, cz, r, len, seg);
  }
}

/** Rectangular frame of four members in the XY plane. */
function ring(P, mat, m, x0, x1, y0, y1, z0, z1, face, bottomFace = face) {
  P.box(mat, m, x0, x0 + face, y0, y1, z0, z1);
  P.box(mat, m, x1 - face, x1, y0, y1, z0, z1);
  P.box(mat, m, x0 + face, x1 - face, y1 - face, y1, z0, z1);
  if (bottomFace > 0) P.box(mat, m, x0 + face, x1 - face, y0, y0 + bottomFace, z0, z1);
}

/** Glazed sash: frame members + pane. */
function sash(P, mat, m, x0, x1, y0, y1, zc, depth, face, bottomFace = face) {
  ring(P, mat, m, x0, x1, y0, y1, zc - depth / 2, zc + depth / 2, face, bottomFace);
  P.box('glass', m, x0 + face, x1 - face, y0 + bottomFace, y1 - face, zc - 0.004, zc + 0.004);
}

function buildWindow(P, o, m, G) {
  const { w, y0, y1, t, zf, out } = G;
  const outer = out * t / 2;
  // stone sill: sits on the reveal outside the frame and projects 4 cm beyond the wall face
  P.box('stone', m, -w / 2 - 0.03, w / 2 + 0.03, y0 - 0.03, y0 + 0.012, zf + out * 0.03, outer + out * 0.04);

  if (o.style === 'mamad') {
    // heavy steel frame + inner glazed sash
    ring(P, 'steel', m, -w / 2, w / 2, y0, y1, zf - 0.06, zf + 0.06, 0.07);
    sash(P, 'frame', m, -w / 2 + 0.07, w / 2 - 0.07, y0 + 0.07, y1 - 0.07, zf - 0.02, 0.05, 0.05);
    // external sliding blast shutter on rails, drawn half open towards the longer wall run
    const px = LOCAL_X[G.front];
    const dir = wallRunBeside(o, G.plan, px) >= wallRunBeside(o, G.plan, OPPOSITE[px]) ? 1 : -1;
    const sw = w + 0.08, zs = outer + out * 0.035, shift = dir * w * 0.5;
    const r0 = Math.min(-w / 2 - 0.06, -w / 2 - 0.06 + dir * (w + 0.1)), r1 = Math.max(w / 2 + 0.06, w / 2 + 0.06 + dir * (w + 0.1));
    for (const ry of [y0 - 0.075, y1 + 0.035]) P.box('steel', m, r0, r1, ry, ry + 0.04, outer, outer + out * 0.075);
    P.box('steel', m, shift - sw / 2, shift + sw / 2, y0 - 0.035, y1 + 0.035, zs - 0.014, zs + 0.014);
    ring(P, 'steel', m, shift - sw / 2, shift + sw / 2, y0 - 0.035, y1 + 0.035, zs + out * 0.014, zs + out * 0.026, 0.05);
    P.box('handle', m, shift - dir * (sw / 2 - 0.1) - 0.012, shift - dir * (sw / 2 - 0.1) + 0.012, (y0 + y1) / 2 - 0.09, (y0 + y1) / 2 + 0.09, zs + out * 0.026, zs + out * 0.05);
    return;
  }

  const fw = 0.045;                                                  // visible frame width
  ring(P, 'frame', m, -w / 2, w / 2, y0, y1, zf - 0.04, zf + 0.04, fw);
  if (o.style === 'tilt' || w < 0.6) {
    sash(P, 'frame', m, -w / 2 + fw, w / 2 - fw, y0 + fw, y1 - fw, zf, 0.05, 0.045);
    P.box('handle', m, -0.012, 0.012, y0 + fw + 0.006, y0 + fw + 0.04, zf - out * 0.025, zf - out * 0.05);
    P.box('handle', m, -0.012, 0.012, y0 + fw + 0.03, y0 + fw + 0.13, zf - out * 0.04, zf - out * 0.055);
    return;
  }
  // sliding: two sashes on parallel tracks overlapping at a meeting stile
  const sf = 0.042, lap = 0.021;
  sash(P, 'frame', m, -w / 2 + fw, lap, y0 + fw, y1 - fw, zf + out * 0.017, 0.03, sf);
  sash(P, 'frame', m, -lap, w / 2 - fw, y0 + fw, y1 - fw, zf - out * 0.017, 0.03, sf);
  P.box('frame', m, -w / 2 + fw, w / 2 - fw, y0 + fw - 0.012, y0 + fw, zf - 0.036, zf + 0.036);     // track
  P.box('handle', m, lap - sf + 0.008, lap - sf + 0.02, (y0 + y1) / 2 - 0.06, (y0 + y1) / 2 + 0.06, zf - out * 0.002, zf - out * 0.03);
}

function buildSlidingDoor(P, o, m, G, open) {
  const { w, y1, zf, out } = G;
  const fw = 0.05;
  ring(P, 'frame', m, -w / 2, w / 2, 0, y1, zf - 0.06, zf + 0.06, fw, 0);
  P.box('frame', m, -w / 2 + fw, w / 2 - fw, 0, 0.018, zf - 0.06, zf + 0.06);                          // floor track
  const sf = 0.065, lap = sf / 2, travel = open ? (w / 2 - fw - lap) * 0.94 : 0;
  // fixed panel on the outer track, sliding panel on the inner track (parks in front of the fixed one)
  sash(P, 'frame', m, -lap, w / 2 - fw, 0.018, y1 - fw, zf + out * 0.024, 0.04, sf, 0.08);
  sash(P, 'frame', m, -w / 2 + fw + travel, lap + travel, 0.018, y1 - fw, zf - out * 0.024, 0.04, sf, 0.08);
  for (const s of [1, -1]) {                                          // pull handle on both faces of the sliding stile
    const hx = -w / 2 + fw + travel + sf / 2, hz = zf - out * 0.024 + s * 0.02;
    P.box('handle', m, hx - 0.009, hx + 0.009, 0.92, 1.22, hz, hz + s * 0.028);
  }
}

/** Lever handle on a rose; `side` = ±1 leaf-local z direction it sticks out to. */
function lever(P, m, x, y, zFace, side, dirX) {
  P.cyl('handle', m, 'z', x, y, zFace + side * 0.004, 0.026, 0.008, 12);
  P.cyl('handle', m, 'z', x, y, zFace + side * 0.03, 0.009, 0.05, 8);
  P.box('handle', m, x - (dirX < 0 ? 0.125 : 0.01), x + (dirX < 0 ? 0.01 : 0.125), y - 0.009, y + 0.009, zFace + side * 0.045, zFace + side * 0.062);
}

function buildHingedDoor(P, o, m, G, open) {
  const { w, y1, t, front } = G;
  const hingeSign = o.hinge === LOCAL_X[front] ? 1 : -1;
  const out = o.exterior && o.outside ? (o.outside === front ? 1 : -1) : 0;
  const st = o.style;
  const S = {                                                         // per-style proportions (m)
    interior: { jamb: 0.035, leafT: 0.04, pivot: t / 2, frame: 'door', leaf: 'door' },
    entry: { jamb: 0.06, leafT: 0.065, pivot: 0.07, frame: 'frame', leaf: 'entry' },
    service: { jamb: 0.05, leafT: 0.045, pivot: 0.04, frame: 'frame', leaf: 'frame' },
    mamad: { jamb: 0.05, leafT: 0.055, pivot: t / 2 + 0.012, frame: 'steel', leaf: 'steel' },
  }[st] || { jamb: 0.035, leafT: 0.04, pivot: t / 2, frame: 'door', leaf: 'door' };
  const j = S.jamb, head = y1 - j;

  // ── frame ──
  if (st === 'interior' || !S.frame || S.frame === 'door') {
    for (const s of [-1, 1]) P.box('door', m, s * (w / 2 - j), s * w / 2, 0, y1, -t / 2, t / 2);          // lining
    P.box('door', m, -w / 2 + j, w / 2 - j, head, y1, -t / 2, t / 2);
    for (const z of [t / 2, -t / 2 - 0.016]) {                                                           // architrave on both faces
      for (const s of [-1, 1]) P.box('door', m, s * (w / 2 - j), s * (w / 2 + 0.05), 0, y1 + 0.05, z, z + 0.016);
      P.box('door', m, -w / 2 + j, w / 2 - j, head, y1 + 0.05, z, z + 0.016);
    }
  } else if (st === 'mamad') {
    const z0 = t / 2 - 0.11, z1 = t / 2 + 0.012;
    for (const s of [-1, 1]) {
      P.box('steel', m, s * (w / 2 - j), s * w / 2, 0, y1, z0, z1);
      P.box('steel', m, s * w / 2, s * (w / 2 + 0.07), 0, y1 + 0.07, t / 2, z1);                        // face flange on the wall
    }
    P.box('steel', m, -w / 2 + j, w / 2 - j, head, y1, z0, z1);
    P.box('steel', m, -w / 2, w / 2, y1, y1 + 0.07, t / 2, z1);
    P.box('steel', m, -w / 2 + j, w / 2 - j, 0, 0.012, z0, z1);                                         // steel threshold
  } else {
    const d = st === 'entry' ? 0.07 : 0.04;
    for (const s of [-1, 1]) P.box('frame', m, s * (w / 2 - j), s * w / 2, 0, y1, -d, d);
    P.box('frame', m, -w / 2 + j, w / 2 - j, head, y1, -d, d);
    P.box('handle', m, -w / 2 + j, w / 2 - j, 0, 0.014, -d, d);                                         // threshold strip
  }

  // ── leaf (leaf frame: x' from the hinge edge, z' = 0 on the pivot plane) ──
  const lw = w - 2 * j - 0.006, y0 = 0.008, top = head - 0.004;
  const zs = hingeSign > 0 ? -1 : 1;                                   // leaf z' → canonical Z factor when closed
  const lm = new THREE.Matrix4().makeRotationY((open ? hingeSign * DOOR_OPEN_ANGLE : 0) + (hingeSign > 0 ? Math.PI : 0));
  lm.setPosition(hingeSign * (w / 2 - j - 0.003), 0, S.pivot);
  lm.premultiply(m);
  /** leaf box given offsets from the pivot plane in canonical Z (a < b, ≤ 0 = into the wall). */
  const LB = (mat, x0, x1, ya, yb, a, b) => (zs > 0 ? P.box(mat, lm, x0, x1, ya, yb, a, b) : P.box(mat, lm, x0, x1, ya, yb, -b, -a));
  const zFront = zs * 0, zBack = zs * -S.leafT;                        // leaf faces in leaf z' (front = swing side)
  const frontSide = zs, backSide = -zs;                               // which way each face looks in leaf z'
  const T = S.leafT;

  if (st === 'service') {                                              // aluminium leaf: glazed top, solid bottom panel
    const rail = 0.09, mid = 1.0;
    LB('frame', 0, rail, y0, top, -T, 0); LB('frame', lw - rail, lw, y0, top, -T, 0);
    LB('frame', rail, lw - rail, y0, y0 + 0.12, -T, 0); LB('frame', rail, lw - rail, top - rail, top, -T, 0);
    LB('frame', rail, lw - rail, mid - 0.045, mid + 0.045, -T, 0);
    LB('frame', rail, lw - rail, y0 + 0.12, mid - 0.045, -T + 0.012, -0.012);
    LB('glass', rail, lw - rail, mid + 0.045, top - rail, -T / 2 - 0.004, -T / 2 + 0.004);
  } else {
    LB(S.leaf, 0, lw, y0, top, -T, 0);
  }
  if (st === 'entry') {                                                // flush security leaf with shadow grooves + bar pull outside
    const outFace = out > 0 ? zFront : zBack, outDir = out > 0 ? frontSide : backSide;
    for (let k = 1; k <= 4; k++) {
      const gy = y0 + ((top - y0) * k) / 5;
      P.box('frame', lm, 0.012, lw - 0.012, gy - 0.006, gy + 0.006, outFace, outFace + outDir * 0.0025);
    }
    const bx = lw - 0.11;
    P.cyl('handle', lm, 'y', bx, 1.1, outFace + outDir * 0.055, 0.015, 1.2, 12);
    for (const sy of [0.62, 1.58]) P.cyl('handle', lm, 'z', bx, sy, outFace + outDir * 0.028, 0.009, 0.055, 8);
    P.cyl('handle', lm, 'z', bx, 0.98, outFace + outDir * 0.004, 0.024, 0.008, 12);                      // cylinder lock
    lever(P, lm, lw - 0.075, 1.02, out > 0 ? zBack : zFront, -outDir, -1);                                // lever inside
  } else if (st === 'mamad') {                                         // blast door: rim, hub + long locking lever, heavy hinges
    const rimFace = zFront, rimDir = frontSide;
    for (const [xa, xb, ya, yb] of [[0, lw, y0, y0 + 0.05], [0, lw, top - 0.05, top], [0, 0.05, y0 + 0.05, top - 0.05], [lw - 0.05, lw, y0 + 0.05, top - 0.05]]) {
      P.box('steel', lm, xa, xb, ya, yb, rimFace, rimFace + rimDir * 0.008);
    }
    for (const [face, dirZ] of [[zFront, frontSide], [zBack, backSide]]) {
      P.cyl('handle', lm, 'z', lw - 0.13, 1.02, face + dirZ * 0.012, 0.06, 0.024, 16);                   // hub
      P.cyl('handle', lm, 'z', lw - 0.13, 1.02, face + dirZ * 0.04, 0.014, 0.05, 8);
      P.box('handle', lm, lw - 0.145, lw - 0.115, 1.02 - 0.3, 1.02 + 0.02, face + dirZ * 0.05, face + dirZ * 0.07);
      P.cyl('handle', lm, 'z', lw - 0.13, 0.74, face + dirZ * 0.062, 0.02, 0.036, 10);                   // grip
    }
    for (const hy of [0.32, top - 0.32]) P.cyl('steel', lm, 'y', -0.012, hy, zs * 0.018, 0.02, 0.2, 10);
  } else {
    lever(P, lm, lw - 0.07, 1.02, zFront, frontSide, -1);
    lever(P, lm, lw - 0.07, 1.02, zBack, backSide, -1);
    if (st === 'interior') for (const hy of [0.25, 1.05, top - 0.25]) P.cyl('handle', lm, 'y', -0.004, hy, zs * 0.006, 0.007, 0.09, 8);
  }
}

// ───────────────────────── public API ─────────────────────────
function makeMaterials(frameColor) {
  const std = (color, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const entry = new THREE.Color(frameColor).lerp(new THREE.Color('#6b5a4a'), 0.22);
  return {
    frame: std(frameColor, 0.45, 0.55),
    entry: std(entry, 0.5, 0.35),
    door: std('#f3f1ec', 0.5),
    steel: std('#8b978c', 0.55, 0.35),
    handle: std('#b9bbbd', 0.38, 0.6),
    stone: std('#d8d2c6', 0.75),
    glass: std('#6f8b96', 0.05, 0, { transparent: true, opacity: 0.3, depthWrite: false, envMapIntensity: 3 }),
  };
}

/**
 * Build every window and door of the plan.
 * @param {object} plan PLAN
 * @param {{ ceilingH: number, cutH: number|null, doorsOpen: boolean, frameColor: string }} opts heights in METRES
 * @returns {{ group: THREE.Group, rebuild(opts): void, setFrameColor(hex: string): void, dispose(): void }}
 */
export function buildOpenings(plan, opts) {
  const group = new THREE.Group(); group.name = 'openings';
  const materials = makeMaterials(opts.frameColor || '#2b2d31');
  const meshes = new Map();

  function rebuild(o2) {
    const cut = o2.cutH == null ? Infinity : o2.cutH;
    const P = new Parts(cut);
    for (const o of plan.openings || []) {
      try {
        const F = openingFrame(o), front = F.front;
        const along = (o.axis === 'h' ? o.x + o.w / 2 : o.y + o.h / 2) / 100;
        const m = new THREE.Matrix4().makeRotationY(YAW[front]);
        m.setPosition(o.axis === 'h' ? along : F.mid / 100, 0, o.axis === 'h' ? F.mid / 100 : along);
        const G = {
          plan, front, w: o.width / 100, t: F.t / 100, y0: (o.sill || 0) / 100, y1: ((o.sill || 0) + o.height) / 100,
          zf: framePlaneOffset(o, F.t, front) / 100, out: o.exterior && o.outside ? (o.outside === front ? 1 : -1) : 1,
        };
        if (o.kind === 'window') buildWindow(P, o, m, G);
        else if (o.kind === 'sliding-door') buildSlidingDoor(P, o, m, G, !!o2.doorsOpen);
        else buildHingedDoor(P, o, m, G, !!o2.doorsOpen);
      } catch (e) { console.error(`[view3d] opening "${o && o.id}" could not be built`, e); }
    }
    for (const [key, mesh] of meshes) { mesh.geometry.dispose(); group.remove(mesh); meshes.delete(key); }
    for (const [key, soup] of P.soups) {
      if (soup.empty) continue;
      const mesh = new THREE.Mesh(soup.toGeometry(), materials[key] || materials.frame);
      mesh.name = 'openings:' + key;
      const isGlass = key === 'glass';
      mesh.castShadow = !isGlass; mesh.receiveShadow = !isGlass;
      if (isGlass) { mesh.userData.noShadow = true; mesh.renderOrder = 2; }
      meshes.set(key, mesh); group.add(mesh);
    }
  }
  rebuild(opts);

  return {
    group,
    rebuild,
    setFrameColor(hex) {
      materials.frame.color.set(hex);
      materials.entry.color.set(hex).lerp(new THREE.Color('#6b5a4a'), 0.22);
    },
    dispose() {
      for (const mesh of meshes.values()) mesh.geometry.dispose();
      meshes.clear();
      Object.values(materials).forEach((mt) => mt.dispose());
    },
  };
}
