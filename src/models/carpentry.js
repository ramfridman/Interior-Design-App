/**
 * Made-to-measure carpentry in 3D — model type 'carpentry-unit' (docs/CONTRACT.md § 3 and § 8).
 *
 * Built from the very data the shop drawings use — geometryOf() in src/carpentry (carcass heights and depths, the front
 * layout with its door operations, the internals, the corner-pantry shape) and the run's worktop pieces with their
 * cut-outs — so the 3D always matches the elevation. registry.js routes EVERY store item that carries `carp` here; the
 * item keeps its generic `type` (kitchen-base, wardrobe…) for everything else that reads it. Without its run (a bare item,
 * a thumbnail) the generic model of `item.type` is used.
 *
 * View state: `item.view = { open: true }` (set by the 3D view, never stored) → doors swung ~95°, drawers pulled ~30 cm,
 * flaps up / down, lift-off doors set aside, sliding doors slid, pocket doors pushed in, tambours rolled up: the
 * internals show. Engine geometry is in cm: x from the unit's left seen from the front, y up from the floor, v from the
 * wall (island: from the working edge) → local metres X = x − w/2, Y = y − elev, Z = v − d/2 (front = +Z).
 */
import * as THREE from 'three';
import { registerModel, getModel } from './registry.js';
import * as K from './kit.js';
import { geometryOf, unitsOf, levelOf, positions } from '../carpentry/layout.js';
import { spanOfRun } from '../carpentry/walls.js';
import { view } from '../carpentry/state.js';
import { MODULES } from '../carpentry/modules.js';

const CM = 0.01;
const FINISH = { black: '#232427', steel: '#b9bcc0', brass: '#c5a35a', white: '#f1f0ec', aluminium: '#c9cbcd', wood: '#9c7350' };
const FRONT_ROUGH = { 'lacquer-gloss': 0.14, 'lacquer-matt': 0.5, fenix: 0.85, melamine: 0.62, laminate: 0.55, glass: 0.1 };
const STONE = new Set(['quartz', 'porcelain', 'granite']);
const DOORISH = new Set(['door', 'glass', 'mirror']);

/** Run + geometry of a carpentry item, or null (no run / broken data). */
export function unitContext(item) {
  if (!item || !item.carp || !item.carp.runId) return null;
  const v = view(), run = v.run(item.carp.runId);
  if (!run) return null;
  return { v, run, g: geometryOf(run, item) };
}

function materials(g) {
  const s = g.spec, fr = s.fronts, wt = s.worktop;
  const front = fr.material === 'veneer' || fr.material === 'solid-frame' ? K.wood(fr.colorHex || 'oak') : K.mat(fr.colorHex || '#f3f1ec', { roughness: FRONT_ROUGH[fr.material] ?? 0.55 });
  const carcass = K.mat(s.carcass.colorHex || '#f3f1ec', { roughness: 0.72 });
  const worktop = wt.material === 'solid-wood' ? K.wood(wt.colorHex || 'oak', { roughness: 0.5 }) : wt.material === 'stainless' ? K.metal('#c6c9cd', { roughness: 0.3, metalness: 0.9 })
    : K.mat(wt.colorHex || '#e7e4de', { roughness: STONE.has(wt.material) ? 0.28 : 0.5 });
  const fin = s.handles.finish, handle = fin === 'white' || fin === 'wood' ? K.mat(FINISH[fin], { roughness: 0.5 }) : K.metal(FINISH[fin] || FINISH.black, { roughness: 0.38, metalness: 0.8 });
  const steel = K.metal('#c4c7cb', { roughness: 0.3, metalness: 0.9 });
  const plinth = s.plinth.finish === 'aluminium' ? K.metal('#b9bcc0', { roughness: 0.45, metalness: 0.7 }) : s.plinth.finish === 'carcass' ? carcass : front;
  return { front, carcass, worktop, handle, steel, plinth, glass: K.glass('#d6e6ea', 0.3), mirror: K.mirrorMat(), dark: K.mat('#1b1c1f', { roughness: 0.22 }),
    ceramic: K.ceramic('#f7f7f5'), chrome: K.chrome(), white: K.mat('#f2f2f0', { roughness: 0.4 }), fabric: K.fabric('#d9d2c4'), bin: K.mat('#5d6166', { roughness: 0.6 }) };
}

// ───────────────────────── build context / primitives (cm in, metres out) ─────────────────────────
function makeB(item, ctx, open) {
  const { g, run } = ctx;
  const B = { item, run, g, mod: g.mod, w: g.w, d: g.d, h: g.h, elev: g.elev, t: g.t, f: g.frontD, dc: g.dc, level: g.level, open, root: new THREE.Group(), m: materials(g) };
  const hs = g.spec.handles.type, style = g.spec.fronts.style;
  B.handle = style === 'gola' || style === 'j-profile' ? 'none' : hs;
  B.X = (x) => (x - B.w / 2) * CM; B.Y = (y) => (y - B.elev) * CM; B.Z = (v) => (v - B.d / 2) * CM;
  return B;
}
/** Box in unit coordinates (x, y floor, v from the wall), cm. */
function ubox(B, x0, x1, y0, y1, v0, v1, mat, parent = B.root) {
  if (x1 - x0 < 0.05 || y1 - y0 < 0.05 || v1 - v0 < 0.05) return null;
  const m = K.box((x1 - x0) * CM, (y1 - y0) * CM, (v1 - v0) * CM, mat, B.X((x0 + x1) / 2), B.Y((y0 + y1) / 2), B.Z((v0 + v1) / 2));
  parent.add(m);
  return m;
}
/** Box in face coordinates (x from the viewer's left, y floor, z outward from the face's outer plane), cm. */
function fbox(parent, x0, x1, y0, y1, z0, z1, mat) {
  if (x1 - x0 < 0.05 || y1 - y0 < 0.05 || z1 - z0 < 0.02) return null;
  const m = K.box((x1 - x0) * CM, (y1 - y0) * CM, (z1 - z0) * CM, mat, ((x0 + x1) / 2) * CM, ((y0 + y1) / 2) * CM, ((z0 + z1) / 2) * CM);
  if (mat.transparent) m.userData.noShadow = true;
  parent.add(m);
  return m;
}
/** Extruded polygon [[x, v]…] (unit cm) from floor height y0, th cm thick. */
function polySlab(B, pts, y0, th, mat) {
  if (th <= 0 || pts.length < 3) return;
  B.root.add(K.slab(pts.map(([x, v]) => [B.X(x), B.Z(v)]), th * CM, mat, B.Y(y0)));
}
/** A face group: origin on the face's outer plane at the viewer's left end; local +X = viewer's right, +Z = outward. */
function faceGroup(B, ox, ov, nx, nv) {
  const fg = new THREE.Group();
  fg.position.set(B.X(ox), -B.elev * CM, B.Z(ov));
  fg.rotation.y = Math.atan2(nx, nv);
  B.root.add(fg);
  return fg;
}

// ───────────────────────── handles ─────────────────────────
/** Handle for a front rect (face cm); mode 'L' | 'R' (door hinge side) | 'T' | 'B' (flap hinge) | 'D' (drawer). */
function handleOn(B, parent, x0, x1, y0, y1, mode) {
  const type = B.handle;
  if (type === 'none' || type === 'push') return;
  const W = x1 - x0, H = y1 - y0, mat = B.m.handle, upper = B.level === 'wall' || y0 >= 140;
  if (type === 'edge-pull') {                                   // a slim strip on the top (wall units: bottom) edge
    const len = Math.min(W * 0.6, 40), cx = mode === 'L' ? x1 - len / 2 - 3 : mode === 'R' ? x0 + len / 2 + 3 : (x0 + x1) / 2, ey = upper ? y0 : y1;
    fbox(parent, cx - len / 2, cx + len / 2, ey - 0.4, ey + 0.4, -0.6, 1.4, mat);
    return;
  }
  const vert = mode === 'L' || mode === 'R';
  const room = (vert ? H : W) - 6, len = Math.max(4, Math.min(B.g.spec.handles.length || 16, room));
  let cx, cy;
  if (mode === 'D') { cx = (x0 + x1) / 2; cy = H > 30 ? y1 - 6 : (y0 + y1) / 2; }
  else if (mode === 'T') { cx = (x0 + x1) / 2; cy = y0 + 3.5; }
  else if (mode === 'B') { cx = (x0 + x1) / 2; cy = y1 - 3.5; }
  else {
    cx = mode === 'L' ? x1 - 3.5 : x0 + 3.5;
    const half = type === 'knob' ? 3 : len / 2 + 3;
    cy = upper ? y0 + half : y1 <= 110 ? y1 - half : Math.min(y1 - half, Math.max(y0 + half, 105));
  }
  if (type === 'knob') { const k = K.cyl(1.4 * CM, 1.1 * CM, 2.6 * CM, mat, cx * CM, cy * CM, 1.3 * CM, 12); k.rotation.x = Math.PI / 2; parent.add(k); return; }
  if (vert) { fbox(parent, cx - 0.6, cx + 0.6, cy - len / 2, cy + len / 2, 1.8, 3, mat); fbox(parent, cx - 0.4, cx + 0.4, cy - len / 2 + 1, cy - len / 2 + 1.8, 0, 1.8, mat); fbox(parent, cx - 0.4, cx + 0.4, cy + len / 2 - 1.8, cy + len / 2 - 1, 0, 1.8, mat); }
  else { fbox(parent, cx - len / 2, cx + len / 2, cy - 0.6, cy + 0.6, 1.8, 3, mat); fbox(parent, cx - len / 2 + 1, cx - len / 2 + 1.8, cy - 0.4, cy + 0.4, 0, 1.8, mat); fbox(parent, cx + len / 2 - 1.8, cx + len / 2 - 1, cy - 0.4, cy + 0.4, 0, 1.8, mat); }
}

// ───────────────────────── fronts ─────────────────────────
/** Door / glass / mirror leaf body over x0..x1, y0..y1 (face cm), z −t..0. */
function leafBody(B, parent, f, x0, x1, y0, y1) {
  const t = B.f, m = B.m, glassFronts = B.g.spec.fronts.material === 'glass';
  if (f.kind === 'glass' || glassFronts) {
    const fr = Math.min(5, (x1 - x0) / 5, (y1 - y0) / 5);
    fbox(parent, x0, x1, y0, y0 + fr, -t, 0, m.front); fbox(parent, x0, x1, y1 - fr, y1, -t, 0, m.front);
    fbox(parent, x0, x0 + fr, y0 + fr, y1 - fr, -t, 0, m.front); fbox(parent, x1 - fr, x1, y0 + fr, y1 - fr, -t, 0, m.front);
    fbox(parent, x0 + fr, x1 - fr, y0 + fr, y1 - fr, -t * 0.6, -t * 0.4, m.glass);
    return;
  }
  if (B.g.spec.fronts.style === 'shaker' && x1 - x0 > 20 && y1 - y0 > 20) {
    const fr = 6.5;
    fbox(parent, x0 + fr, x1 - fr, y0 + fr, y1 - fr, -t, -0.7, m.front);
    fbox(parent, x0, x1, y0, y0 + fr, -t, 0, m.front); fbox(parent, x0, x1, y1 - fr, y1, -t, 0, m.front);
    fbox(parent, x0, x0 + fr, y0 + fr, y1 - fr, -t, 0, m.front); fbox(parent, x1 - fr, x1, y0 + fr, y1 - fr, -t, 0, m.front);
  } else fbox(parent, x0, x1, y0, y1, -t, 0, m.front);
  if (f.kind === 'mirror') fbox(parent, x0 + 1, x1 - 1, y0 + 1, y1 - 1, 0, 0.4, m.mirror);
}
/** A pivot at (px, py) on the outer plane: build the leaf in face coordinates inside `inner`, rotate / move `piv`. */
function pivot(parent, px, py) {
  const piv = new THREE.Group(), inner = new THREE.Group();
  piv.position.set(px * CM, py * CM, 0); inner.position.set(-px * CM, -py * CM, 0);
  piv.add(inner); parent.add(piv);
  return { piv, inner };
}
const DEG = Math.PI / 180;

/** One hinged-type front (door, glass, mirror, flap, integrated-appliance panel) with its operation. */
function leaf(B, parent, f, track = 0) {
  const op = f.operation || 'hinged', open = B.open, x0 = f.x, x1 = f.x + f.w, y0 = f.y, y1 = f.y + f.h, fw = f.w;
  const flap = f.kind === 'flap' || (f.kind === 'appliance' && f.panel);
  const hinge = flap ? (f.hinge === 'B' ? 'B' : 'T') : f.hinge === 'R' ? 'R' : 'L';
  if (op === 'tambour' || op === 'curtain') return shutter(B, parent, f, op);
  if (op === 'bifold' && !flap) {                                  // two leaves folding against the hinge side
    const half = fw / 2, s = hinge === 'L' ? 1 : -1, a = hinge === 'L' ? x0 : x1;
    const p1 = pivot(parent, a, 0);
    const l1 = hinge === 'L' ? [x0, x0 + half - 0.15] : [x1 - half + 0.15, x1];
    leafBody(B, p1.inner, f, l1[0], l1[1], y0, y1);
    const p2 = pivot(p1.inner, a + s * half, 0);
    const l2 = hinge === 'L' ? [x0 + half + 0.15, x1] : [x0, x1 - half - 0.15];
    leafBody(B, p2.inner, f, l2[0], l2[1], y0, y1);
    handleOn(B, p2.inner, l2[0], l2[1], y0, y1, hinge);
    if (open) { p1.piv.rotation.y = -s * 80 * DEG; p2.piv.rotation.y = s * 160 * DEG; }
    return;
  }
  const px = flap ? 0 : hinge === 'L' ? x0 : x1, py = flap ? (hinge === 'T' ? y1 : y0) : 0;
  const { piv, inner } = pivot(parent, px, py);
  if (op === 'removable') { liftOff(B, parent, inner, f, flap ? null : hinge); return liftOffPose(B, piv, hinge); }
  leafBody(B, inner, f, x0, x1, y0, y1);
  if (f.handle !== false && op !== 'push-open' && op !== 'curtain') handleOn(B, inner, x0, x1, y0, y1, hinge);
  if (op === 'sliding') {                                          // two tracks; the front track slides over its neighbour
    piv.position.z -= track * (B.f + 0.6) * CM;
    if (open && !track) piv.position.x += (hinge === 'L' ? 1 : -1) * Math.min(fw, 0.9 * fw + 2) * CM;
    return;
  }
  if (!open) return;
  if (flap) { piv.rotation.x = hinge === 'T' ? -100 * DEG : 88 * DEG; return; }
  const s = hinge === 'L' ? -1 : 1;
  if (op === 'pocket') { piv.rotation.y = s * 90 * DEG; piv.position.z -= (fw + 0.5) * CM; return; }
  piv.rotation.y = s * 95 * DEG;
}
/**
 * Lift-off (removable) door, recognisable while closed: the leaf is set in by a 6 mm shadow gap all round, with a dark
 * rebate behind the gap (it stays on the carcass), and two to four exposed lift-off hinges (flag / pin hinges) on the
 * hinge edge — the pin half with its pin on the carcass side, the knuckle half on the door, so with the door lifted
 * off the pins remain. Flaps get the shadow gap only. `hinge` = 'L' | 'R' | null.
 */
const LIFT_GAP = 0.6;
function liftOff(B, parent, inner, f, hinge) {
  const x0 = f.x, x1 = f.x + f.w, y0 = f.y, y1 = f.y + f.h, g = LIFT_GAP, t = B.f, dark = B.m.dark;
  const a0 = x0 + g, a1 = x1 - g, b0 = y0 + g, b1 = y1 - g;
  leafBody(B, inner, f, a0, a1, b0, b1);
  if (f.handle !== false) handleOn(B, inner, a0, a1, b0, b1, hinge || (f.hinge === 'B' ? 'B' : 'T'));
  // the rebate seen through the gap (just behind the door plane: never in front of a neighbouring leaf)
  const z0 = -t - 0.4, z1 = -t + 0.2;
  fbox(parent, x0, x1, y0, b0, z0, z1, dark); fbox(parent, x0, x1, b1, y1, z0, z1, dark);
  fbox(parent, x0, a0, b0, b1, z0, z1, dark); fbox(parent, a1, x1, b0, b1, z0, z1, dark);
  if (!hinge) return;
  const H = b1 - b0, n = H > 180 ? 4 : H > 100 ? 3 : 2, ex = hinge === 'L' ? x0 + g / 2 : x1 - g / 2, r = 0.55, len = 4.2;
  for (let i = 0; i < n; i++) {
    const cy = b0 + 11 + ((H - 22) * i) / (n - 1);
    const pin = K.cyl(r * CM, r * CM, len * CM, B.m.handle, ex * CM, (cy - len / 2) * CM, 0.25 * CM, 12);       // carcass half
    const knuckle = K.cyl(r * CM, r * CM, len * CM, B.m.handle, ex * CM, (cy + len / 2 + 0.15) * CM, 0.25 * CM, 12); // door half
    const shaft = K.cyl(0.2 * CM, 0.2 * CM, len * CM, B.m.handle, ex * CM, (cy + len / 2 + 0.15) * CM, 0.25 * CM, 8); // the pin (inside the knuckle while closed)
    parent.add(pin, shaft); inner.add(knuckle);
  }
}
/** Lift-off door pose: closed in place; open = lifted off its pins and leaned aside in front of the opening. */
function liftOffPose(B, piv, hinge) {
  if (!B.open) return;
  piv.position.z += 32 * CM; piv.position.y += 3 * CM; piv.rotation.y = (hinge === 'R' ? -1 : 1) * 6 * DEG;
}
/** Tambour roller shutter (slats; rolled up when open) or a curtain (folds; gathered at the hinge side when open). */
function shutter(B, parent, f, op) {
  const x0 = f.x, x1 = f.x + f.w, y0 = f.y, y1 = f.y + f.h, m = B.m;
  if (op === 'tambour') {
    const top = B.open ? Math.max(y0, y1 - 8) : y0, n = Math.max(1, Math.round((y1 - top) / 4)), sh = (y1 - top) / n;
    for (let i = 0; i < n; i++) fbox(parent, x0, x1, top + i * sh + 0.2, top + (i + 1) * sh - 0.2, -1.4, 0, m.front);
    if (B.handle !== 'none' && B.handle !== 'push') fbox(parent, (x0 + x1) / 2 - 6, (x0 + x1) / 2 + 6, top + 1, top + 2.2, 0, 1.6, m.handle);
    return;
  }
  const hingeL = f.hinge !== 'R', span = B.open ? f.w * 0.18 : f.w, a = hingeL ? x0 : x1 - span, n = Math.max(2, Math.round(span / 6)), sw = span / n;
  for (let i = 0; i < n; i++) fbox(parent, a + i * sw, a + (i + 1) * sw + 0.4, y0, y1, i % 2 ? -2.4 : -1.2, i % 2 ? -1.2 : 0, m.fabric);
  fbox(parent, x0, x1, y1 - 1, y1, -2.6, 0, m.steel);
}
/** Drawer front (pulled out with its box when open). */
function drawer(B, parent, f) {
  const x0 = f.x, x1 = f.x + f.w, y0 = f.y, y1 = f.y + f.h, g = new THREE.Group();
  parent.add(g);
  leafBody(B, g, f, x0, x1, y0, y1);
  if (f.handle !== false) handleOn(B, g, x0, x1, y0, y1, 'D');
  if (!B.open) return;
  const depth = Math.max(20, Math.min(B.dc - 6, 50)), hh = Math.max(6, Math.min(f.h * 0.75, 25)), c = B.m.carcass, t = B.f;
  fbox(g, x0 + 2, x1 - 2, y0 + 1.5, y0 + 2.5, -t - depth, -t, c);
  fbox(g, x0 + 2, x0 + 3.5, y0 + 1.5, y0 + hh, -t - depth, -t, c); fbox(g, x1 - 3.5, x1 - 2, y0 + 1.5, y0 + hh, -t - depth, -t, c);
  fbox(g, x0 + 3.5, x1 - 3.5, y0 + 1.5, y0 + hh, -t - depth, -t - depth + 1.5, c);
  g.position.z = Math.min(30, B.dc * 0.6) * CM;
}
/** Appliance face: oven / microwave (dark glass), washer / dryer (round door), hood, or a neutral panel. */
function appliance(B, parent, f) {
  const x0 = f.x, x1 = f.x + f.w, y0 = f.y, y1 = f.y + f.h, m = B.m, name = ((f.label && (f.label.en || f.label)) || '').toLowerCase();
  if (y1 <= B.elev + 0.1) return;                                   // free-standing fridge below a niche box: its own item
  if (/oven|microwave/.test(name)) {
    fbox(parent, x0, x1, y0, y1, -1.6, 0, m.steel);
    fbox(parent, x0 + 3, x1 - 3, y0 + 3, y1 - (/oven/.test(name) ? 9 : 3), 0, 0.3, m.dark);
    if (/oven/.test(name)) fbox(parent, x0 + 6, x1 - 6, y1 - 6, y1 - 4.8, 0.3, 2.6, m.steel);
  } else if (/wash|dryer/.test(name)) {
    fbox(parent, x0, x1, y0, y1, -2, 0, m.white);
    const r = Math.min(f.w, f.h) * 0.32, c = K.cyl(r * CM, r * CM, 1.2 * CM, m.dark, ((x0 + x1) / 2) * CM, (y0 + f.h * 0.45) * CM, 0.6 * CM, 28);
    c.rotation.x = Math.PI / 2; parent.add(c);
  } else if (/hood/.test(name)) fbox(parent, x0, x1, y0, y1, -B.dc * 0.8, 0, m.steel);
  else fbox(parent, x0, x1, y0, y1, -1.2, 0, m.steel);
}
/** All fronts of one face. `mirror`: fronts are given in run coordinates but the viewer looks from the other side. */
function buildFace(B, fg, fronts, { mirror = false, len = B.w } = {}) {
  const list = fronts.map((f) => (mirror ? { ...f, x: len - f.x - f.w, hinge: f.hinge === 'L' ? 'R' : f.hinge === 'R' ? 'L' : f.hinge } : f));
  const sliding = list.filter((f) => f.operation === 'sliding' && DOORISH.has(f.kind)).sort((a, b) => a.x - b.x);
  for (const f of list) {
    if (B.g.level === 'tall' && f.y + f.h <= B.elev + 0.1) continue;
    if (f.kind === 'open' || f.kind === 'void') continue;
    if (f.kind === 'drawer') drawer(B, fg, f);
    else if (DOORISH.has(f.kind) || f.kind === 'flap' || (f.kind === 'appliance' && f.panel)) leaf(B, fg, f, f.operation === 'sliding' ? sliding.indexOf(f) % 2 : 0);
    else if (f.kind === 'appliance') appliance(B, fg, f);
    else fbox(fg, f.x, f.x + f.w, f.y, f.y + f.h, -B.f, 0, B.m.front);   // panel / blind / filler
  }
}

// ───────────────────────── carcass + internals ─────────────────────────
/** Sides, bottom, back and a top — or, under a worktop (base / island), a front and a back rail (sinks, hobs drop in). */
function carcassBox(B, x0, x1, y0, y1, v0, v1, rails = false) {
  const t = B.t, c = B.m.carcass;
  ubox(B, x0, x0 + t, y0, y1, v0, v1, c); ubox(B, x1 - t, x1, y0, y1, v0, v1, c);
  if (rails) { ubox(B, x0 + t, x1 - t, y1 - t, y1, v0, v0 + 10, c); ubox(B, x0 + t, x1 - t, y1 - t, y1, v1 - 10, v1, c); }
  else ubox(B, x0 + t, x1 - t, y1 - t, y1, v0, v1, c);
  ubox(B, x0 + t, x1 - t, y0, y0 + t, v0, v1, c);
  ubox(B, x0 + t, x1 - t, y0 + t, y1 - t, v0, v0 + 0.6, c);
}
function internals(B, v0, v1, mirror = false) {
  const t = B.t, m = B.m, w = B.w;
  for (const c of B.g.inner || []) {
    if (c.shaped) continue;
    let a = Math.max(t, c.x0 ?? 0), b = Math.min(w - t, c.x1 ?? w);
    if (mirror) [a, b] = [w - b, w - a];
    const y = c.y;
    if (c.kind === 'shelf' || c.kind === 'shoe') ubox(B, a, b, y - t / 2, y + t / 2, v0 + 1, v1 - (c.kind === 'shoe' ? 6 : 2), c.glass ? m.glass : m.carcass);
    else if (c.kind === 'rail') B.root.add(K.bar([B.X(a), B.Y(y), B.Z((v0 + v1) / 2)], [B.X(b), B.Y(y), B.Z((v0 + v1) / 2)], 0.012, m.chrome, 10));
    else if (c.kind === 'divider') ubox(B, (c.x0 ?? 0) - t / 2, (c.x0 ?? 0) + t / 2, y, y + (c.h || 0), v0 + 0.6, v1, m.carcass);
    else if (c.kind === 'drawer') { ubox(B, a + 1, b - 1, y, y + (c.h || 18), v1 - 3, v1 - 1.5, m.carcass); ubox(B, a + 1, b - 1, y, y + 1, v0 + 3, v1 - 3, m.carcass); }
    else if (c.kind === 'trouser') for (let i = 0; i < 4; i++) ubox(B, a + 4, b - 4, y + (c.h || 70) - 4 - i * 0.2, y + (c.h || 70) - 3, v0 + 6 + i * 10, v0 + 7 + i * 10, m.chrome);
    else if (c.kind === 'larder' || c.kind === 'pullout') {
      const h = c.h || 60, n = c.variant === 'bin' ? 0 : Math.max(2, Math.min(6, Math.round(h / 32)));
      if (c.variant === 'bin') { const mid = (a + b) / 2; ubox(B, a + 2, mid - 1, y + 2, y + Math.min(h - 6, 45), v0 + 8, v1 - 6, m.bin); ubox(B, mid + 1, b - 2, y + 2, y + Math.min(h - 6, 45), v0 + 8, v1 - 6, m.bin); continue; }
      if (c.variant === 'carousel' || c.variant === 'lemans' || c.variant === 'magic-corner') {
        const r = Math.min(b - a, v1 - v0) * 0.42;
        for (let i = 0; i < 2; i++) B.root.add(K.cyl(r * CM, r * CM, 1 * CM, m.chrome, B.X((a + b) / 2), B.Y(y + 6 + i * (h - 14) / 1.6), B.Z((v0 + v1) / 2), 28));
        continue;
      }
      for (let i = 0; i < n; i++) { const yy = y + 4 + (i * (h - 10)) / n; ubox(B, a + 2, b - 2, yy, yy + 0.8, v0 + 4, v1 - 4, m.chrome); ubox(B, a + 2, b - 2, yy, yy + 7, v1 - 5, v1 - 4.4, m.chrome); }
    }
  }
}
function plinthBox(B, x0, x1, v0, v1) {
  const p = B.g.H.plinth;
  if (!(p > 0) || B.elev > 0 || B.g.carcassY[0] < p - 0.01 || B.mod.wallHung || B.item.carp.noPlinth) return;
  ubox(B, x0, x1, 0, p - 0.1, v0, v1, B.m.plinth);
}

// ───────────────────────── worktop ─────────────────────────
function carriesTop(u) {
  const m = MODULES[u.carp.module] || MODULES.custom, lvl = levelOf(u);
  let c = !!m.worktop && !m.virtual && (lvl === 'base' || lvl === 'island');
  if (u.carp.worktop === true) c = true;
  if (u.carp.worktop === false) c = false;
  return c;
}
/** This unit's share of the run's worktop pieces: the slice over the unit; the first / last carrier also takes the ends. */
function worktop(B, ctx) {
  const { run, v } = ctx, item = B.item, at = item.carp.at || 0, H = B.g.H;
  if (!carriesTop(item) || !run.worktops || !run.worktops.length) return;
  const carriers = unitsOf(run, v).filter(carriesTop), wtop = H.worktop;
  for (const p of run.worktops) {
    const th = p.thickness / 10;
    if (p.waterfall) {
      const first = carriers.reduce((a, u) => (!a || u.carp.at < a.carp.at ? u : a), null), last = carriers.reduce((a, u) => (!a || u.carp.at + u.carp.width > a.carp.at + a.carp.width ? u : a), null);
      const mine = p.waterfall === 'left' ? first : last;
      if (!mine || mine.id !== item.id) continue;
      const x = p.waterfall === 'left' ? p.s - at : p.e - at;
      ubox(B, p.waterfall === 'left' ? x : x - th, p.waterfall === 'left' ? x + th : x, 0, wtop - th, 0, p.depth, B.m.worktop);
      continue;
    }
    let a = Math.max(p.s, at), b = Math.min(p.e, at + B.w);
    const on = carriers.filter((u) => u.carp.at < p.e - 0.05 && u.carp.at + u.carp.width > p.s + 0.05);
    if (!on.length || !on.some((u) => u.id === item.id)) continue;
    if (on.reduce((x, u) => (u.carp.at < x.carp.at ? u : x)).id === item.id) a = p.s;
    if (on.reduce((x, u) => (u.carp.at + u.carp.width > x.carp.at + x.carp.width ? u : x)).id === item.id) b = p.e;
    if (b - a < 0.05) continue;
    const X = (xr) => B.X(xr - at), Z = (vv) => B.Z(vv), D = p.depth;
    const shape = new THREE.Shape([[a, 0], [b, 0], [b, D], [a, D]].map(([x, vv]) => new THREE.Vector2(X(x), -Z(vv))));
    const cuts = (p.cutouts || []).map((c) => ({ ...c, xa: p.s + c.x, xb: p.s + c.x + c.w, va: D - c.fromFront - c.d, vb: D - c.fromFront })).filter((c) => c.xa > a + 0.2 && c.xb < b - 0.2 && c.va > 0.2 && c.vb < D - 0.2);
    for (const c of cuts) shape.holes.push(new THREE.Path([[c.xa, c.va], [c.xa, c.vb], [c.xb, c.vb], [c.xb, c.va]].map(([x, vv]) => new THREE.Vector2(X(x), -Z(vv)))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: th * CM, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, B.m.worktop);
    mesh.position.y = B.Y(wtop - th);
    B.root.add(mesh);
    for (const c of cuts) fixture(B, c, X, wtop, th);
    backOfTop(B, ctx, p, a, b, at, wtop, th);
  }
}
/**
 * Splashback (run.spec.splashback: material, height) and worktop upstand (run.spec.worktop.upstand, cm) over this unit's
 * slice a..b (run cm) of worktop piece p — against the wall only (not on islands). The splashback follows the elevation
 * drawing exactly: from the worktop up to its height, stopped under the wall units above the piece, cut at windows whose
 * sill is below its top. The upstand is a strip of the worktop material standing on the worktop in front of it.
 */
const SPLASH = { 'same-as-worktop': 1.2, glass: 0.6, tiles: 0.9 };
function backOfTop(B, ctx, p, a, b, at, wtop, th) {
  const { run, v } = ctx, S = run.spec, sb = S.splashback, up = Number(S.worktop.upstand) || 0;
  if (run.kind === 'island' || B.level === 'island') return;
  const X = (xr) => xr - at;                                         // run x → unit x (cm)
  let T = 0;
  if (sb && sb.material && sb.material !== 'none' && sb.height > 0) {
    T = SPLASH[sb.material] || 1;
    const all = unitsOf(run, v), pos = positions(run, all);
    let y1 = wtop + sb.height;
    const above = all.filter((u) => levelOf(u) === 'wall' && !(MODULES[u.carp.module] || {}).virtual && !u.hidden).map((u) => ({ u, at: pos.get(u.id) ? pos.get(u.id).at : u.carp.at }))
      .filter((x) => x.at < p.e && x.at + x.u.carp.width > p.s);
    for (const x of above) { try { y1 = Math.min(y1, geometryOf(run, x.u).elev); } catch (e) { /* keep */ } }
    let segs = [[a, b]];
    const span = spanOfRun(run);
    if (span) for (const o of span.openings.filter((q) => q.kind === 'window')) {
      const oa = o.from - span.runFrom, ob = o.to - span.runFrom;
      if (o.sill < y1) segs = segs.flatMap(([s, e]) => (ob <= s || oa >= e ? [[s, e]] : [[s, oa], [ob, e]].filter(([q, w]) => w - q > 1)));
    }
    const mat = sb.material === 'same-as-worktop' ? B.m.worktop : sb.material === 'glass' ? K.mat('#eef0ee', { roughness: 0.06 }) : K.mat('#eeebe5', { roughness: 0.32 });
    if (y1 - wtop > 0.5) for (const [s, e] of segs) {
      ubox(B, X(s), X(e), wtop, y1, 0, T, mat);
      if (sb.material === 'tiles') tileJoints(B, s, e, at, wtop, y1, T);
    }
  }
  if (up > 0) ubox(B, X(a), X(b), wtop, wtop + up, T, T + th, B.m.worktop);
}
/** Metro tiles 15 × 7.5 cm, half-bond, set out from the run's left end (joints line up across units): thin grout joints. */
function tileJoints(B, s, e, at, y0, y1, T) {
  const grout = B.m.grout || (B.m.grout = K.mat('#cfcac2', { roughness: 0.8 })), TW = 15, TH = 7.5, j = 0.15;
  for (let y = y0 + TH; y < y1 - 0.5; y += TH) ubox(B, s - at, e - at, y - j, y + j, T, T + 0.05, grout);
  for (let r = 0, y = y0; y < y1 - 0.5; r++, y += TH) {
    const top = Math.min(y1, y + TH), off = r % 2 ? TW / 2 : 0;
    for (let x = Math.ceil((s - off) / TW) * TW + off; x < e - 0.5; x += TW) if (x > s + 0.5) ubox(B, x - j - at, x + j - at, y, top, T, T + 0.05, grout);
  }
}
/** Sink bowl + tap, hob glass, or a basin under / in a worktop cut-out (run x → local X via `X`). */
function fixture(B, c, X, wtop, th) {
  const m = B.m, x0 = X(c.xa), x1 = X(c.xb), z0 = B.Z(c.va), z1 = B.Z(c.vb), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0, top = B.Y(wtop);
  if (c.kind === 'hob') {
    B.root.add(K.box(w + 0.01, 0.006, d + 0.01, m.dark, cx, top + 0.003, cz));
    const gas = B.item.carp.hob === 'gas';
    for (const [i, j] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const r = gas ? 0.04 : 0.085, mat = gas ? m.steel : K.mat('#3a3c40', { roughness: 0.3 });
      B.root.add(K.cyl(r, r, gas ? 0.02 : 0.002, mat, cx + i * w * 0.25, top + (gas ? 0.012 : 0.0065), cz + j * d * 0.22, 20));
    }
    return;
  }
  const mat = c.kind === 'basin' ? m.ceramic : m.steel, depth = c.kind === 'basin' ? 0.14 : 0.2, wall = 0.008, y1 = top - th * CM, y0 = y1 - depth;
  B.root.add(K.box(w, wall, d, mat, cx, y0 + wall / 2, cz));
  B.root.add(K.box(wall, depth, d, mat, x0 + wall / 2, y0 + depth / 2, cz), K.box(wall, depth, d, mat, x1 - wall / 2, y0 + depth / 2, cz));
  B.root.add(K.box(w, depth, wall, mat, cx, y0 + depth / 2, z0 + wall / 2), K.box(w, depth, wall, mat, cx, y0 + depth / 2, z1 - wall / 2));
  const s = B.level === 'island' ? -1 : 1, tz = s > 0 ? z0 - 0.045 : z1 + 0.045;   // tap behind the bowl (island: on the seating side)
  B.root.add(K.cyl(0.014, 0.016, 0.26, m.chrome, cx, top + 0.13, tz, 14));
  B.root.add(K.bar([cx, top + 0.255, tz], [cx, top + 0.255, tz + s * Math.min(0.2, d * 0.55)], 0.011, m.chrome, 10));
}

// ───────────────────────── corner units (true L / diagonal shape on both arms) ─────────────────────────
const sameP = (p, q) => Math.abs(p[0] - q[0]) < 0.01 && Math.abs(p[1] - q[1]) < 0.01;
function pointIn(pts, x, y) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; }
  return ins;
}
/** Outward unit normal of edge a → b of polygon pts. */
function outward(pts, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, n = [dy / L, -dx / L], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  return pointIn(pts, mx + n[0] * 0.5, my + n[1] * 0.5) ? [-n[0], -n[1]] : n;
}
/** Move the edges flagged in `amounts` (per edge i → i+1) inward by that many cm; vertices re-intersected. */
function insetEdges(pts, amounts) {
  const n = pts.length, lines = pts.map((a, i) => { const b = pts[(i + 1) % n], o = outward(pts, a, b), k = amounts[i] || 0; return { p: [a[0] - o[0] * k, a[1] - o[1] * k], d: [b[0] - a[0], b[1] - a[1]] }; });
  return pts.map((q, i) => {
    const L1 = lines[(i - 1 + n) % n], L2 = lines[i], den = L1.d[0] * L2.d[1] - L1.d[1] * L2.d[0];
    if (Math.abs(den) < 1e-9) return L2.p;
    const s = ((L2.p[0] - L1.p[0]) * L2.d[1] - (L2.p[1] - L1.p[1]) * L2.d[0]) / den;
    return [L1.p[0] + L1.d[0] * s, L1.p[1] + L1.d[1] * s];
  });
}
function cornerUnit(B) {
  const k = B.g.corner, t = B.t, f = B.f, [cy0, cy1] = B.g.carcassY;
  const P = k.poly.map(([u, v]) => [k.X(u), v]);                  // unit (x, v)
  const isFace = (i) => k.faces.some((fc) => { const a = [k.X(fc.a[0]), fc.a[1]], b = [k.X(fc.b[0]), fc.b[1]], p = P[i], q = P[(i + 1) % P.length]; return (sameP(a, p) && sameP(b, q)) || (sameP(a, q) && sameP(b, p)); });
  const faceIdx = P.map((_, i) => isFace(i));
  const C = insetEdges(P, faceIdx.map((x) => (x ? f : 0)));         // carcass outline
  polySlab(B, C, cy0, t, B.m.carcass); polySlab(B, C, cy1 - t, t, B.m.carcass);
  const S = insetEdges(C, C.map(() => t + 0.5));
  for (const c of B.g.inner || []) if (c.kind === 'shelf') polySlab(B, S, c.y - t / 2, t, B.m.carcass);
  // walls: every non-face edge (backs against the walls, the end sides)
  for (let i = 0; i < C.length; i++) {
    if (faceIdx[i]) continue;
    const a = C[i], b = C[(i + 1) % C.length], o = outward(C, a, b), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mx = (a[0] + b[0]) / 2 - o[0] * t / 2, mv = (a[1] + b[1]) / 2 - o[1] * t / 2;
    const m = K.box(L * CM, (cy1 - cy0) * CM, t * CM, B.m.carcass, B.X(mx), B.Y((cy0 + cy1) / 2), B.Z(mv));
    m.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    B.root.add(m);
  }
  if (B.g.H.plinth > 0 && B.elev === 0 && cy0 >= B.g.H.plinth - 0.01) polySlab(B, insetEdges(C, faceIdx.map((x) => (x ? B.g.spec.plinth.setback - f : 0))), 0, B.g.H.plinth - 0.1, B.m.plinth);
  // fronts: true-size doors per face
  const inside = k.variant === 'l-doors' ? [k.X(k.dB), k.dA] : null;
  for (const fc of k.faces) {
    const a = [k.X(fc.a[0]), fc.a[1]], b = [k.X(fc.b[0]), fc.b[1]], n = outward(P, a, b), th = Math.atan2(n[0], n[1]), r = [Math.cos(th), -Math.sin(th)];
    const left = a[0] * r[0] + a[1] * r[1] <= b[0] * r[0] + b[1] * r[1] ? a : b;
    const fronts = (B.g.trueFronts || []).filter((x) => x.face === fc.id);
    const single = fronts.filter((x) => DOORISH.has(x.kind) || x.kind === 'flap').length === 1, atLeft = inside && sameP(left, inside);
    const fg = faceGroup(B, left[0], left[1], n[0], n[1]);
    buildFace(B, fg, fronts.map((x) => (single && DOORISH.has(x.kind) ? { ...x, hinge: atLeft ? 'R' : 'L' } : x)));
  }
}

// ───────────────────────── one unit ─────────────────────────
function buildUnit(item, ctx, open) {
  const B = makeB(item, ctx, open), g = B.g, mod = B.mod, w = B.w, t = B.t, [cy0, cy1] = g.carcassY;
  if (g.corner) { cornerUnit(B); worktop(B, ctx); return B.root; }
  const kind = mod.carcass;
  if (kind === 'shelf' || kind === 'panel' || mod.id === 'panel') {
    const top = mod.id === 'panel' && (g.level === 'base' || g.level === 'island') ? g.h - g.H.wt : g.h;
    const depth = mod.id === 'panel' && g.level === 'base' ? Math.min(B.d, B.dc + B.f + 0.5) : B.d;
    ubox(B, 0, w, B.elev, B.elev + top, 0, depth, kind === 'shelf' ? B.m.carcass : B.m.front);
    if (mod.id === 'panel') worktop(B, ctx);
    return B.root;
  }
  if (g.level === 'island') {                                      // working side at v = 0 (−Z), seating side at +Z
    const S = g.spec, wd = B.d, ov = 2, c0 = ov + B.f, c1 = Math.min(wd, c0 + B.dc), bp1 = wd - (S.worktop.overhangSeat || 0), bp0 = Math.max(c1, bp1 - B.f);
    const end = S.worktop.waterfall ? g.H.wt : t;
    carcassBox(B, end, w - end, cy0, cy1, c0, c1, true);
    if (!S.worktop.waterfall) { ubox(B, 0, end, 0, cy1, c0 - B.f, bp1, B.m.front); ubox(B, w - end, w, 0, cy1, c0 - B.f, bp1, B.m.front); }
    ubox(B, end, w - end, 0, cy1, bp0, bp1, B.m.front);
    plinthBox(B, end, w - end, c0 - B.f + S.plinth.setback, bp0 - 0.5);
    internals(B, c0, c1);
    buildFace(B, faceGroup(B, w, ov, 0, -1), g.fronts, { mirror: true });
    worktop(B, ctx);
    return B.root;
  }
  const front = B.dc + B.f;                                         // outer plane of the fronts (v)
  if (kind === 'desk') {
    ubox(B, 0, w, cy0, cy1, 0, B.dc, B.m.carcass);
    ubox(B, 0, t, 0, cy0, 0, B.dc, B.m.carcass); ubox(B, w - t, w, 0, cy0, 0, B.dc, B.m.carcass);
    const dr = g.fronts.find((x) => x.kind === 'drawer');
    if (dr) carcassBox(B, dr.x, dr.x + dr.w, dr.y, cy0, 4, B.dc - B.f);
    buildFace(B, faceGroup(B, 0, B.dc, 0, 1), g.fronts);
    return B.root;
  }
  if (kind === 'none') ubox(B, 1, w - 1, g.zone.y0, g.zone.y1, 2, B.dc - 1, B.m.steel);    // integrated appliance body
  else if (kind !== 'filler') {
    carcassBox(B, 0, w, cy0, cy1, 0, B.dc, carriesTop(B.item) && g.spec.worktop.material !== 'none');
    if (g.top) carcassBox(B, 0, w, cy1, g.elev + g.h, 0, B.dc);
    internals(B, 0, B.dc);
  }
  plinthBox(B, 0, w, 0, Math.max(1, front - g.spec.plinth.setback));
  if (g.spec.fronts.style === 'gola' && g.level === 'base' && kind !== 'filler') ubox(B, 0, w, g.zone.y1 - 2.5, g.zone.y1, B.dc - 1, B.dc + 0.4, B.m.dark);
  if (mod.sliding) slidingDoors(B, ctx, front);
  buildFace(B, faceGroup(B, 0, front, 0, 1), g.fronts);
  worktop(B, ctx);
  return B.root;
}
/**
 * Sliding wardrobe doors: the RUN's door split, exactly as the elevation drawing derives it (drawings.js "sliding doors"):
 * over the run's sliding carcasses (from the leftmost, total width len) n = spec.sliding.doors or max(2, ⌈len / 100⌉)
 * doors of (len + 3 (n − 1)) / n, overlapping 3 cm, alternately on the front / rear track. Each carcass draws the part of
 * every door that lies over it (the pieces of one door line up and move together), so a door spans carcasses as built.
 * Open: the front-track doors slide over their neighbour.
 */
function slidingDoors(B, ctx, front) {
  const { run, v } = ctx, z = B.g.zone, mirror = B.item.carp.fronts && B.item.carp.fronts.mirror;
  const all = unitsOf(run, v), pos = positions(run, all), at0 = (u) => (pos.get(u.id) ? pos.get(u.id).at : u.carp.at || 0);
  const sl = all.filter((u) => (MODULES[u.carp.module] || {}).sliding);
  if (!sl.some((u) => u.id === B.item.id)) sl.push(B.item);
  const a = Math.min(...sl.map(at0)), len = sl.reduce((s, u) => s + u.carp.width, 0), me = at0(B.item);
  const n = (run.spec.sliding && run.spec.sliding.doors) || Math.max(2, Math.ceil(len / 100)), dw = (len + (n - 1) * 3) / n;
  const fg = faceGroup(B, 0, B.d, 0, 1);
  for (let i = 0; i < n; i++) {
    const d0 = a + i * (dw - 3), d1 = d0 + dw, rear = i % 2 === 1, x0 = Math.max(d0, me) - me, x1 = Math.min(d1, me + B.w) - me;
    if (x1 - x0 < 0.05) continue;
    const zz = rear ? -B.f - 4.2 : -1, grp = new THREE.Group(); fg.add(grp);
    fbox(grp, x0 + (d0 >= me ? 0.1 : 0), x1 - (d1 <= me + B.w ? 0.1 : 0), z.y0, z.y1, zz - B.f, zz, B.m.front);
    if (mirror) fbox(grp, Math.max(x0, d0 - me + 2), Math.min(x1, d1 - me - 2), z.y0 + 2, z.y1 - 2, zz, zz + 0.4, B.m.mirror);
    // a slim pull on the door's leading edge (the dashed line in the elevation)
    const pullX = rear ? d1 - 5 : d0 + 5;
    if (B.handle !== 'none' && pullX - me > x0 + 0.6 && pullX - me < x1 - 0.6) fbox(grp, pullX - me - 0.6, pullX - me + 0.6, z.y0 + 20, z.y1 - 20, zz, zz + 1.2, B.m.handle);
    if (B.open && !rear && n > 1) grp.position.x = (i === n - 1 ? -1 : 1) * (dw - 3) * 0.95 * CM;
  }
  fbox(fg, 0, B.w, z.y1, z.y1 + 1.5, -B.d + front, 0, B.m.steel);    // top track
}

/**
 * What a corner unit really occupies in plan (item-local cm, origin = centre, +y = front): `poly` (true outline) and
 * `rects` (its two arms as { x, y, w, h } — walk collisions). null for ordinary units (their item box is exact).
 */
export function footprint(item) {
  try {
    const ctx = unitContext(item);
    if (!ctx || !ctx.g.corner) return null;
    const k = ctx.g.corner, W = ctx.g.w, D = ctx.g.d, P = ([u, v]) => [k.X(u) - W / 2, v - D / 2];
    const rect = (u0, u1, v0, v1) => { const a = P([u0, v0]), b = P([u1, v1]); return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }; };
    return { poly: k.poly.map(P), rects: [rect(0, k.legA, 0, k.dA), rect(0, k.dB, 0, k.legB)] };
  } catch (e) { return null; }
}

registerModel('carpentry-unit', {
  build(args) {
    const { item } = args;
    let ctx = null;
    try { ctx = unitContext(item); } catch (e) { ctx = null; }
    if (ctx) {
      try { return buildUnit(item, ctx, !!(item.view && item.view.open)); } catch (e) { console.error('[models] carpentry unit build failed', e); }
    }
    const gen = item && item.type !== 'carpentry-unit' ? getModel(item.type) : null;
    if (gen && gen.build) return gen.build(args);
    const grp = new THREE.Group();
    grp.add(K.boxOn(args.w, args.h, args.d, K.mat((args.p && args.p.color) || '#f3f1ec', { roughness: 0.6 })));
    return grp;
  },
  draw2d(ctx, args) {
    let uc = null;
    try { uc = unitContext(args.item); } catch (e) { uc = null; }
    if (uc && uc.g.corner) {                                       // corner units: the true L / diagonal footprint
      const k = uc.g.corner, g0 = uc.g, pts = k.poly.map(([u, v]) => [k.X(u) - g0.w / 2, v - g0.d / 2]), col = (args.p && args.p.color) || '#e8e4dc';
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.fillStyle = K.tint(col, 0.35); ctx.fill();
      ctx.strokeStyle = K.INK; ctx.lineWidth = args.px; ctx.stroke();
      for (const fc of k.faces) {                                   // front faces: a second line just inside
        const a = [k.X(fc.a[0]) - g0.w / 2, fc.a[1] - g0.d / 2], b = [k.X(fc.b[0]) - g0.w / 2, fc.b[1] - g0.d / 2];
        K.line(ctx, a[0], a[1], b[0], b[1], K.INK, args.px * 1.6);
      }
      return;
    }
    const gen = args.item && args.item.type !== 'carpentry-unit' ? getModel(args.item.type) : null;
    if (gen && gen.draw2d) return gen.draw2d(ctx, args);
    K.fillRR(ctx, 0, 0, args.w, args.d, 0, K.tint((args.p && args.p.color) || '#e8e4dc'), K.INK, args.px);
  },
  footprint,
});
