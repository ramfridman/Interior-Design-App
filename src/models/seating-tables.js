/**
 * Seating & tables — procedural 3D models + 2D plan symbols.
 *
 * Types: sofa, armchair, pouf, bench, chair, bar-stool, office-chair, table, desk  (see types.js for params).
 * Every builder works in METRES inside the box x ∈ [-w/2, w/2], y ∈ [0, h], z ∈ [-d/2, d/2] (front = +Z) and ends
 * with fit(), which guarantees that the result fills the requested box exactly. Member thicknesses (legs, arms, tops)
 * are derived from real-world values and clamped, never stretched with the box. Layout functions are shared between
 * the 3D builder and the plan symbol so that both always agree.
 */
import * as THREE from 'three';
import { registerModel } from './registry.js';
import * as K from './kit.js';

const PI = Math.PI;

// ───────────────────────── params ─────────────────────────
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const P = (p) => (p && typeof p === 'object' && !Array.isArray(p) ? p : {});
const num = (v, def) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(n) ? n : def; };
const flag = (v, def = false) => (v === true || v === 'true' || v === 1 ? true : v === false || v === 'false' || v === 0 ? false : def);
const pick = (v, list, def) => (typeof v === 'string' && list.includes(v) ? v : def);
const dim = (v, def) => { const n = num(v, def); return n > 0 ? n : def; };
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Validated colour: hex, or a kit colour / wood-tone keyword; anything else → def (which may be undefined). */
function C(c, def) {
  if (typeof c !== 'string') return def;
  if (HEX.test(c)) return c;
  const named = c[0] === '#' ? null : K.col(c, null);
  return typeof named === 'string' && HEX.test(named) ? named : def;
}
const SOFT = new Set(['fabric', 'textile', 'leather', 'velvet']);
const HARD = new Set(['wood', 'teak', 'metal', 'aluminium', 'rattan', 'plastic', 'glass', 'stone', 'ceramic', 'concrete', 'laminate', 'lacquer']);
const WOODY = new Set(['wood', 'teak']);
const softOf = (m) => (typeof m === 'string' && SOFT.has(m) ? m : null);
const hardOf = (m) => (typeof m === 'string' && HARD.has(m) ? m : null);
const softMat = (material, color) => K.byMaterial(softOf(material) || 'fabric', color);
const hardMat = (material, color, def = 'wood') => K.byMaterial(hardOf(material) || def, color);
const metalMat = (color) => (color ? K.metal(color) : K.metal('#26272b'));
/** Representative colour of a material (used to tint plan symbols). */
const matHex = (m) => `#${m.color.getHexString()}`;

// ───────────────────────── geometry helpers ─────────────────────────
const _geo = new Map();
const mm = (v) => Math.round(v * 1000);
const memo = (k, make) => { let g = _geo.get(k); if (!g) { g = make(); _geo.set(k, g); } return g; };
const at = (geo, material, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); return m; };
const noShadow = (m) => { m.userData.noShadow = true; return m; };

/**
 * Soft cushion: plan-rounded slab (w × t × l, thickness along Y) with rounded edges (r), rounded plan corners (rp)
 * and a crowned top (+Y). Total height including the crown is exactly t. Centred on the origin.
 */
function cushionGeo(w, t, l, r, rp, crown) {
  w = Math.max(w, 0.004); t = Math.max(t, 0.004); l = Math.max(l, 0.004);
  crown = clamp(crown, 0, t * 0.4);
  const T = t - crown;
  r = clamp(r, 0.001, Math.min(T, w, l) / 2 - 0.0002);
  rp = clamp(rp, r, Math.min(w, l) / 2 - 0.0001);
  return memo(`cu|${mm(w)}|${mm(t)}|${mm(l)}|${mm(r)}|${mm(rp)}|${mm(crown)}`, () => {
    const dome = crown > 0.0005, CS = clamp(Math.ceil(rp / 0.028), 2, 6), ES = dome ? 2 : 0, AS = 2, M = 4 * (CS + 1 + ES), rings = [];
    for (let j = 0; j <= 1; j++) rings.push([r * (1 - j) * 0.6, -t / 2 + r * j * 0.6 + (j ? r * 0.4 : 0), 1]);      // chamfered underside
    for (let j = AS; j >= 0; j--) { if (j === AS && T - 2 * r < 2e-4) continue; const f = (j / AS) * PI / 2; rings.push([r * (1 - Math.sin(f)), -t / 2 + T - r * (1 - Math.cos(f)), 1]); }
    if (dome) for (const s of [0.8, 0.55, 0.28]) rings.push([r, -t / 2 + T, s]);
    const pos = [], uv = [], idx = [], hw = w / 2, hl = l / 2, X = Math.max(hw - r, 1e-4), Z = Math.max(hl - r, 1e-4);
    for (const [inset, y, s] of rings) for (let c = 0; c < 4; c++) {
      const arc = [];
      for (let i = 0; i <= CS; i++) { const a = (c + i / CS) * PI / 2, sx = c === 0 || c === 3 ? 1 : -1, sz = c < 2 ? 1 : -1; arc.push([(sx * (hw - rp) + (rp - inset) * Math.cos(a)) * s, (sz * (hl - rp) + (rp - inset) * Math.sin(a)) * s]); }
      const a2 = (c + 1) * PI / 2, c2 = (c + 1) % 4, nx = ((c2 === 0 || c2 === 3 ? 1 : -1) * (hw - rp) + (rp - inset) * Math.cos(a2)) * s, nz = ((c2 < 2 ? 1 : -1) * (hl - rp) + (rp - inset) * Math.sin(a2)) * s, e = arc[CS];
      for (let k = 1; k <= ES; k++) arc.push([lerp(e[0], nx, k / (ES + 1)), lerp(e[1], nz, k / (ES + 1))]);
      for (const [x, z] of arc) { pos.push(x, y + (s < 1 ? crown * (1 - (x / X) ** 2) * (1 - (z / Z) ** 2) : 0), z); uv.push(x / w + 0.5, z / l + 0.5); }
    }
    const R = rings.length, ct = R * M, cb = ct + 1;
    pos.push(0, t / 2, 0, 0, -t / 2, 0); uv.push(0.5, 0.5, 0.5, 0.5);
    for (let i = 0; i < R - 1; i++) for (let m = 0; m < M; m++) {
      const a = i * M + m, b = i * M + (m + 1) % M, c = (i + 1) * M + m, e = (i + 1) * M + (m + 1) % M;
      idx.push(a, c, b, b, c, e);
    }
    for (let m = 0; m < M; m++) { const a = (R - 1) * M + m, b = (R - 1) * M + (m + 1) % M; idx.push(a, ct, b, m, (m + 1) % M, cb); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
}
const cush = (w, t, l, material, x = 0, y = 0, z = 0, r = 0.03, rp = 0.05, crown = 0.01) => at(cushionGeo(w, t, l, r, rp, crown), material, x, y, z);

/** Round cushion / drum (lathe): radius R, height t (incl. crown), edge radius r, optional side bulge. Centred. */
function puckGeo(R, t, r, crown, bulge = 0) {
  R = Math.max(R, 0.003); t = Math.max(t, 0.003); crown = clamp(crown, 0, t * 0.4);
  const T = t - crown; r = clamp(r, 0.001, Math.min(T / 2, R) - 0.0002);
  return memo(`pk|${mm(R)}|${mm(t)}|${mm(r)}|${mm(crown)}|${mm(bulge)}`, () => {
    const pts = [new THREE.Vector2(0, -t / 2)], AS = 3, Rb = R - bulge;
    for (let j = 0; j <= AS; j++) { const f = (j / AS) * PI / 2; pts.push(new THREE.Vector2(Rb - r + r * Math.sin(f), -t / 2 + r - r * Math.cos(f))); }
    if (bulge > 0) for (let j = 1; j < 6; j++) { const f = j / 6; pts.push(new THREE.Vector2(Rb + bulge * Math.sin(f * PI), lerp(-t / 2 + r, -t / 2 + T - r, f))); }
    for (let j = AS; j >= 0; j--) { if (j === AS && T - 2 * r < 2e-4 && !bulge) continue; const f = (j / AS) * PI / 2; pts.push(new THREE.Vector2(Rb - r + r * Math.sin(f), -t / 2 + T - r + r * Math.cos(f))); }
    if (crown > 0.0005) for (const s of [0.7, 0.4]) pts.push(new THREE.Vector2((Rb - r) * s, -t / 2 + T + crown * (1 - s * s)));
    pts.push(new THREE.Vector2(0, t / 2));
    return new THREE.LatheGeometry(pts, 28);
  });
}
/** Round / elliptical cushion mesh (rx, rz half-axes). */
function puck(rx, rz, t, material, x = 0, y = 0, z = 0, r = 0.03, crown = 0.01, bulge = 0) {
  const m = at(puckGeo(rx, t, r, crown, bulge), material, x, y, z); m.scale.z = rz / Math.max(rx, 0.003); return m;
}

/** Thin plate with a fine bevel (table tops, seats): shape 'rect' (corner radius cr) or 'round' (ellipse). Centred. */
function plateGeo(shape, w, d, t, cr = 0.004) {
  w = Math.max(w, 0.01); d = Math.max(d, 0.01); t = Math.max(t, 0.002);
  return memo(`pl|${shape}|${mm(w)}|${mm(d)}|${mm(t)}|${mm(cr)}`, () => {
    const b = Math.min(0.003, t * 0.3), hw = w / 2 - b, hd = d / 2 - b, s = new THREE.Shape();
    if (shape === 'round') s.absellipse(0, 0, hw, hd, 0, PI * 2, false, 0);
    else {
      const r = clamp(cr - b, 0.0008, Math.min(hw, hd) - 0.0002);
      s.moveTo(-hw + r, -hd); s.lineTo(hw - r, -hd); s.absarc(hw - r, -hd + r, r, -PI / 2, 0, false);
      s.lineTo(hw, hd - r); s.absarc(hw - r, hd - r, r, 0, PI / 2, false);
      s.lineTo(-hw + r, hd); s.absarc(-hw + r, hd - r, r, PI / 2, PI, false);
      s.lineTo(-hw, -hd + r); s.absarc(-hw + r, -hd + r, r, PI, PI * 1.5, false);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: t - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: shape === 'round' ? 22 : 3 });
    g.rotateX(-PI / 2); g.center();
    return g;
  });
}
const plate = (shape, w, d, t, material, x = 0, y = 0, z = 0, cr = 0.004) => at(plateGeo(shape, w, d, t, cr), material, x, y, z);

/** Polyline with rounded corners: [[x,y,z]…] → denser list of points. */
function roundPath(pts, r, seg = 3, closed = false) {
  const out = [], n = pts.length, dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (!closed && (i === 0 || i === n - 1)) { out.push(p); continue; }
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], la = dist(p, a) || 1e-6, lb = dist(p, b) || 1e-6;
    const A = mix(p, a, Math.min(r, la * 0.49) / la), B = mix(p, b, Math.min(r, lb * 0.49) / lb);
    for (let k = 0; k <= seg; k++) { const t = k / seg, u = 1 - t; out.push([u * u * A[0] + 2 * u * t * p[0] + t * t * B[0], u * u * A[1] + 2 * u * t * p[1] + t * t * B[1], u * u * A[2] + 2 * u * t * p[2] + t * t * B[2]]); }
  }
  return out;
}

/** Round tube along a 3D polyline (parallel-transport frames, capped ends). */
function tube(pts, r, material, { closed = false, radial = 8 } = {}) {
  const Pn = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), n = Pn.length, pos = [], nor = [], idx = [];
  if (n < 2) return new THREE.Group();
  let nv = null;
  const tan = (i) => { const a = Pn[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = Pn[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]; const t = b.clone().sub(a); return t.lengthSq() > 1e-12 ? t.normalize() : new THREE.Vector3(0, 1, 0); };
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = tan(i);
    if (!nv) nv = Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    nv = nv.clone().sub(t.clone().multiplyScalar(nv.dot(t)));
    if (nv.lengthSq() < 1e-8) nv = Math.abs(t.x) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0).sub(t.clone().multiplyScalar(t.x));
    nv.normalize();
    const b = t.clone().cross(nv);
    frames.push(t);
    for (let k = 0; k < radial; k++) { const a = (k / radial) * PI * 2, dx = Math.cos(a), dy = Math.sin(a), v = nv.clone().multiplyScalar(dx).addScaledVector(b, dy); pos.push(Pn[i].x + v.x * r, Pn[i].y + v.y * r, Pn[i].z + v.z * r); nor.push(v.x, v.y, v.z); }
  }
  const rings = closed ? n : n - 1;
  for (let i = 0; i < rings; i++) for (let k = 0; k < radial; k++) {
    const i2 = (i + 1) % n, a = i * radial + k, b = i * radial + (k + 1) % radial, c = i2 * radial + k, e = i2 * radial + (k + 1) % radial;
    idx.push(a, b, c, b, e, c);
  }
  if (!closed) for (const [i, sgn] of [[0, -1], [n - 1, 1]]) {
    const base = pos.length / 3, t = frames[i];
    for (let k = 0; k < radial; k++) { const s = (i * radial + k) * 3; pos.push(pos[s], pos[s + 1], pos[s + 2]); nor.push(t.x * sgn, t.y * sgn, t.z * sgn); }
    for (let k = 1; k < radial - 1; k++) idx.push(base, sgn > 0 ? base + k : base + k + 1, sgn > 0 ? base + k + 1 : base + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
  return new THREE.Mesh(g, material);
}

/** Rounded-rectangle cross-section: u ∈ ±tu/2 (across), v ∈ [v0, v1] (height); `flare` shifts u outwards with height. CCW. */
function rrSection(tu, v0, v1, r, flare = 0, seg = 2) {
  const hu = tu / 2, pts = []; r = clamp(r, 0.0005, Math.min(hu, (v1 - v0) / 2) - 0.0002);
  const corners = [[hu - r, v0 + r, -PI / 2], [hu - r, v1 - r, 0], [-hu + r, v1 - r, PI / 2], [-hu + r, v0 + r, PI]];
  for (const [cu, cv, a0] of corners) for (let k = 0; k <= seg; k++) { const a = a0 + (k / seg) * PI / 2, v = cv + r * Math.sin(a); pts.push([cu + r * Math.cos(a) + flare * (v - v0), v]); }
  return pts;
}

/**
 * Sweep a cross-section along a path in plan. stations: [{ x, z, su? }], section: [[u, v]…] (CCW) or (i) => section.
 * u is measured towards the right-hand normal (tz, -tx) of the travel direction, v is world Y.
 * `hard` keeps the section edges crisp (timber rails); otherwise the surface is fully smooth (upholstery, plastic).
 */
function sweep(stations, section, material, { hard = false } = {}) {
  const n = stations.length, sec = (i) => (typeof section === 'function' ? section(i) : section), m = sec(0).length, pos = [], idx = [];
  const ring = [];
  for (let i = 0; i < n; i++) {
    const s = stations[i], a = stations[Math.max(0, i - 1)], b = stations[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    ring.push(sec(i).map(([u, v]) => [s.x + tz * u * (s.su ?? 1), v, s.z - tx * u * (s.su ?? 1)]));
  }
  const dup = hard ? 2 : 1;
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) for (let k = 0; k < dup; k++) pos.push(...ring[i][j]);
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m; j++) {
    const j2 = (j + 1) % m, a = (i * m + j) * dup, b = (i * m + j2) * dup + (dup - 1), c = ((i + 1) * m + j) * dup, e = ((i + 1) * m + j2) * dup + (dup - 1);
    idx.push(a, b, c, b, e, c);
  }
  for (const [i, end] of [[0, false], [n - 1, true]]) {
    const base = pos.length / 3; for (let j = 0; j < m; j++) pos.push(...ring[i][j]);
    for (let j = 1; j < m - 1; j++) idx.push(base, end ? base + j : base + j + 1, end ? base + j + 1 : base + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

/** (Tapered) round strut between two points. `floor` lifts the lower end so that a splayed leg stands on y = 0. */
function strut(a, b, ra, rb, material, seg = 10) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = Math.max(A.distanceTo(B), 1e-4);
  const m = new THREE.Mesh(memo(`st|${mm(ra)}|${mm(rb)}|${mm(len)}|${seg}`, () => new THREE.CylinderGeometry(rb, ra, len, seg)), material);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}
/** Rectangular beam between two points: sx × sz cross-section (sx stays horizontal for beams in a vertical plane). */
function beam(a, b, sx, sz, material) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = Math.max(A.distanceTo(B), 1e-4);
  const m = K.box(sx, len, sz, material);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}
/** Four struts from a (smaller) top rectangle down to the floor rectangle — splayed legs. */
function splayLegs(g, top, bot, y1, rt, rb, material) {
  for (const sx of [-1, 1]) for (const k of [0, 1]) {
    const tilt = Math.hypot(sx * (bot.x - top.x), bot.z[k] - top.z[k]) / Math.max(y1, 0.01);
    g.add(strut([sx * bot.x, rb * Math.min(tilt, 1), bot.z[k]], [sx * top.x, y1, top.z[k]], rb, rt, material));
  }
}
/** Two sled runners (bent tube: down the front, along the floor, up the back). */
function sledLegs(g, x, y1, zb, zf, r, material) {
  for (const s of [-1, 1]) g.add(tube(roundPath([[s * x, y1, zf - r - 0.02], [s * x, r, zf - r], [s * x, r, zb + r], [s * x, y1, zb + r + 0.03]], 0.045, 3), r, material));
}
/** Leaning rounded cushion standing on its edge: returns the mesh; crown faces +Z, `lean` tips the top towards -Z. */
function leaned(w, t, l, material, x, y, z, lean, r, rp, crown) { const m = cush(w, t, l, material, x, y, z, r, rp, crown); m.rotation.x = PI / 2 - lean; return m; }
/** Vertical and depth half-extents of a leaned cushion (rounded-box support function). */
const leanExt = (t, l, lean, r, crown) => ({ y: (l / 2 - r) * Math.cos(lean) + (t / 2 - crown - r) * Math.sin(lean) + r, z: (l / 2 - r) * Math.sin(lean) + (t / 2 - r) * Math.cos(lean) + r });

/**
 * U-shaped wall wrapping the back of a seat (tub chairs, moulded shells, bucket backs).
 * o: { hw, zB, zF, zc, t, y0, topBack, topFront, flare, pow, material, r }
 * The wall runs from (−hw, zF) straight back to zc, around a half-ellipse touching zB, and forward to (+hw, zF);
 * its top rises smoothly from topFront at the ends to topBack at the centre of the back.
 */
function shellWall(o) {
  const { t, y0, topBack, topFront, flare = 0 } = o, N = 14;
  const rx = Math.max(0.02, o.hw - t / 2 - flare * (topFront - y0)), zb = o.zB + t / 2 + flare * (topBack - y0), rz = Math.max(0.02, o.zc - zb);
  const pts = [];
  if (o.zF > o.zc + 0.015) pts.push([-rx, o.zF - t / 2], [-rx, (o.zF - t / 2 + o.zc) / 2]);
  for (let i = 0; i <= N; i++) { const a = (i / N) * PI; pts.push([-rx * Math.cos(a), o.zc - rz * Math.sin(a)]); }
  if (o.zF > o.zc + 0.015) pts.push([rx, (o.zF - t / 2 + o.zc) / 2], [rx, o.zF - t / 2]);
  const zEnd = pts[0][1], span = Math.max(zEnd - zb, 0.01), st = [], tops = [];
  const add = (x, z, su, top) => { st.push({ x, z, su }); tops.push(top); };
  const topAt = (z) => { const f = clamp((zEnd - z) / span, 0, 1), s = f * f * (3 - 2 * f); return lerp(topFront, topBack, Math.pow(s, o.pow ?? 1)); };
  const nose = [[85, 0.5], [60, 0.43], [30, 0.25]];
  for (const [deg, k] of nose) add(pts[0][0], pts[0][1] + t * k, Math.cos(deg * PI / 180), topFront - (1 - Math.cos(deg * PI / 180)) * Math.min(0.02, t));
  for (const [x, z] of pts) add(x, z, 1, topAt(z));
  for (const [deg, k] of nose.slice().reverse()) add(pts[pts.length - 1][0], pts[pts.length - 1][1] + t * k, Math.cos(deg * PI / 180), topFront - (1 - Math.cos(deg * PI / 180)) * Math.min(0.02, t));
  const r = o.r ?? t * 0.45;
  return sweep(st, (i) => rrSection(t, y0, Math.max(tops[i], y0 + 2.2 * r), r, flare, 2), o.material);
}

/** Final step of every builder: scale / shift (normally by a fraction of a percent) so the model fills w × d × h exactly. */
function fit(g, w, d, h) {
  g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(g, true);
  if (b.isEmpty() || ![b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite)) return g;
  const sx = b.max.x - b.min.x > 1e-5 ? w / (b.max.x - b.min.x) : 1, sy = b.max.y - b.min.y > 1e-5 ? h / (b.max.y - b.min.y) : 1, sz = b.max.z - b.min.z > 1e-5 ? d / (b.max.z - b.min.z) : 1;
  const out = new THREE.Group();
  g.scale.set(sx, sy, sz); g.position.set(-(b.min.x + b.max.x) / 2 * sx, -b.min.y * sy, -(b.min.z + b.max.z) / 2 * sz);
  out.add(g); out.userData.fit = [sx, sy, sz];
  return out;
}

// ───────────────────────── 2D helpers (drawing in metres) ─────────────────────────
const INK = K.INK, FAINT = K.INK_SOFT;
const tone = (hex, amt) => K.tint(C(hex, '#cfc9bd'), amt);
/** Wrap a metre-based symbol painter into the registry's centimetre-based draw2d signature. */
function sym(draw) {
  return (ctx, a) => {
    const q = a || {}, w = dim(q.w, 100) / 100, d = dim(q.d, 100) / 100, h = dim(q.h, 100) / 100, px = dim(q.px, 1) / 100;
    ctx.save(); ctx.scale(100, 100); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    draw(pen(ctx, px), { w, d, h, p: P(q.p), px, det: Math.min(w, d) / px });
    ctx.restore();
  };
}
function pen(ctx, px) {
  const paint = (fill, stroke, k) => { if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = px * k; ctx.stroke(); } };
  return {
    ctx, px,
    /** rounded rect by corners */
    rr(x0, z0, x1, z1, r, fill, stroke = INK, k = 1) { if (x1 - x0 > 0 && z1 - z0 > 0) K.fillRR(ctx, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, r, fill, stroke, px * k); },
    ellipse(x, z, rx, rz, fill, stroke = INK, k = 1) { if (rx > 0 && rz > 0) { ctx.beginPath(); ctx.ellipse(x, z, rx, rz, 0, 0, PI * 2); paint(fill, stroke, k); } },
    line(x1, z1, x2, z2, stroke = INK, k = 1) { K.line(ctx, x1, z1, x2, z2, stroke, px * k); },
    /** closed polygon with rounded corners */
    poly(pts, r, fill, stroke = INK, k = 1) {
      const q = pts.filter((p, i) => { const o = pts[(i + pts.length - 1) % pts.length]; return Math.hypot(p[0] - o[0], p[1] - o[1]) > 1e-6; }), n = q.length;
      if (n < 3) return;
      ctx.beginPath();
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], s = mid(q[n - 1], q[0]);
      ctx.moveTo(s[0], s[1]);
      for (let i = 0; i < n; i++) { const a = q[i], b = q[(i + 1) % n], e = mid(a, b); ctx.arcTo(a[0], a[1], e[0], e[1], Math.min(r, Math.hypot(a[0] - e[0], a[1] - e[1]) * 0.98, Math.hypot(a[0] - s[0], a[1] - s[1]) * 0.98)); if (i === n - 1) break; }
      ctx.closePath(); paint(fill, stroke, k);
    },
    /** arbitrary path */
    path(build, fill, stroke = INK, k = 1) { ctx.beginPath(); build(ctx); paint(fill, stroke, k); },
    /** curved band (chair backs): from (−hw, z) to (hw, z), bowed towards −z by sag, thickness t */
    band(hw, z, sag, t, fill, stroke = INK, k = 1) {
      ctx.beginPath(); ctx.moveTo(-hw, z); ctx.quadraticCurveTo(0, z - 2 * sag, hw, z); ctx.lineTo(hw, z + t); ctx.quadraticCurveTo(0, z + t - 2 * sag, -hw, z + t); ctx.closePath(); paint(fill, stroke, k);
    },
  };
}

// ═════════════════════════ SOFA (and club / lounge / recliner armchairs) ═════════════════════════
const SOFA_COLOR = '#b9b0a2', OUTDOOR_CUSHION = '#e6e1d6';

/** All dimensions of a sofa-like piece; shared by the 3D builder and the plan symbol. o = internal overrides. */
function sofaLayout(w, d, h, p, o = {}) {
  const frame = hardOf(p.material) || o.frame || null;        // hard `material` → outdoor / open-frame construction
  const block = !frame || frame === 'rattan';                  // solid upholstered (or woven) blocks vs. open frame
  const corner = flag(p.corner) && !o.single;
  const ch = o.single ? 'none' : pick(p.chaise, ['none', 'left', 'right'], 'none');
  const side = corner ? (ch === 'left' ? -1 : 1) : ch === 'left' ? -1 : ch === 'right' ? 1 : 0;
  const mainD = side ? Math.min(clamp(d * 0.6, 0.8, 1.0), d * 0.75) : d, ext = d - mainD;
  const style = typeof p.style === 'string' ? p.style : '';
  const legs = !block ? 'frame' : o.swivel ? 'swivel' : pick(p.legs, ['wood', 'metal', 'none', 'plinth'], frame === 'rattan' ? 'plinth' : o.legs || 'wood');
  const seatTop = clamp(h * (o.seatK || 0.54), 0.1, o.seatMax || 0.45);
  const legH = legs === 'none' || legs === 'frame' ? 0 : legs === 'plinth' ? Math.min(frame ? 0.035 : 0.05, h * 0.07) : o.legH || clamp(h * (style === 'scandinavian' ? 0.2 : 0.15), 0.03, style === 'scandinavian' ? 0.17 : 0.13);
  const loose = pick(p.cushions, ['loose', 'tight'], 'loose') === 'loose';
  const cushT = clamp(seatTop - legH - 0.09, 0.04, !loose ? 0.1 : frame ? 0.13 : 0.17);
  const backStyle = o.backStyle || pick(p.back, ['cushion', 'low', 'high'], 'cushion');
  const m = WOODY.has(frame) ? 0.055 : frame === 'plastic' ? 0.05 : frame === 'metal' ? 0.03 : 0.04;
  const aw = o.aw || (block ? clamp(w * 0.075, 0.09, frame ? 0.13 : style === 'classic' ? 0.24 : style === 'modern' || style === 'minimal' ? 0.13 : 0.19) : WOODY.has(frame) ? 0.085 : m * 1.5);
  const backT = block ? clamp(mainD * 0.16, 0.07, frame ? 0.12 : 0.17) : m;
  const tight = backStyle === 'low';
  const lean = o.lean ?? (tight ? 0.08 : 0.2), cr = tight ? 0.02 : 0.035, crown = tight ? 0.012 : o.crown ?? 0.022;
  const bcT = tight ? clamp(mainD * 0.09, 0.04, 0.08) : clamp(mainD * 0.19, 0.08, 0.2);
  const yb = seatTop - 0.03, bcTop = tight ? h - 0.015 : h, Hv = Math.max(bcTop - yb, 0.08);
  const bcH = Math.max(0.06, 2 * ((Hv / 2 - cr - (bcT / 2 - crown - cr) * Math.sin(lean)) / Math.cos(lean) + cr));
  const e = leanExt(bcT, bcH, lean, cr, crown);
  const backTop = tight ? h : h - clamp(h * 0.08, 0.02, 0.07);
  const armTop = o.armTop ? Math.min(o.armTop, backTop) : tight ? backTop : Math.min(backTop, seatTop + clamp(h * 0.22, 0.05, 0.2));
  const armsP = o.single ? 'both' : pick(p.arms, ['both', 'none', 'left', 'right'], 'both');
  const hasL = armsP === 'both' || armsP === 'left', hasR = armsP === 'both' || armsP === 'right';
  const arm = { w: block ? aw : (aw + m) / 2, top: armTop }, wall = { w: backT, top: backTop, wall: true };
  let endL = hasL ? arm : null, endR = hasR ? arm : null, retArm = null;
  if (corner) { retArm = (side > 0 ? hasR : hasL) ? arm : null; if (side > 0) endR = wall; else endL = wall; }
  const xL = -w / 2 + (endL ? endL.w : 0), xR = w / 2 - (endR ? endR.w : 0), zone = Math.max(xR - xL, 0.05);
  const retLen = corner ? Math.max(ext - (retArm ? retArm.w : 0), 0.05) : 0, want = num(p.seats, NaN), target = 0.74;
  let n, nRet = 0;
  if (o.single) n = 1;
  else if (corner) {
    const total = Number.isFinite(want) ? clamp(Math.round(want), 2, 8) : 0;
    n = total ? Math.max(1, Math.round(total * zone / (zone + retLen))) : Math.round(zone / target);
    nRet = clamp(total ? total - n : Math.round(retLen / target), 1, Math.max(1, Math.floor(retLen / 0.35)));
  } else n = Number.isFinite(want) ? Math.round(want) : Math.round(zone / target);
  n = Math.min(clamp(n, 1, 6), Math.max(1, Math.floor(zone / 0.35)));
  if (side && !corner && n < 2 && zone > 1.1) n = 2;
  // materials
  let body, seat, leg;
  if (hardOf(p.material)) { body = hardMat(p.material, C(p.color)); seat = softMat(p.material2, C(p.color2, OUTDOOR_CUSHION)); leg = frame === 'rattan' ? K.mat(K.shade(matHex(body), -0.45), { roughness: 0.8 }) : body; }
  else if (o.frame) { body = hardMat(hardOf(p.material2) || o.frame, C(p.color2)); seat = softMat(p.material, C(p.color, o.color || SOFA_COLOR)); leg = body; }
  else {
    body = seat = softMat(p.material, C(p.color, o.color || SOFA_COLOR));
    leg = legs === 'plinth' ? K.mat(C(p.color2, K.shade(matHex(body), -0.6)), { roughness: 0.7 }) : legs === 'metal' || legs === 'swivel' ? (hardOf(p.material2) ? hardMat(p.material2, C(p.color2)) : metalMat(C(p.color2))) : hardMat(hardOf(p.material2) || 'wood', C(p.color2));
  }
  const accent = C(p.color3);
  const pillows = !o.single && !frame && style !== 'minimal' && p.pillows !== false && zone > 1.3 && !tight;
  return { frame, block, corner, side, mainD, ext, style, legs, seatTop, legH, loose, cushT, backStyle, m, aw, backT, lean, backTop, armTop, endL, endR, retArm, xL, xR, n, nRet,
    bc: { t: bcT, H: bcH, lean, r: cr, crown, ey: e.y, ez: e.z, top: bcTop, tiers: o.tiers || (backStyle === 'high' && h - seatTop > 0.42 ? 2 : 1) },
    bcDepth: 2 * e.z, R: o.R || (frame ? 0.018 : 0.045), M: { body, seat, leg }, accent, pillows, footrest: !!o.footrest, runner: o.runner || null, h, w, d };
}

/** Seat cushions, back cushions and scatter cushions of one straight run. r = { xL, xR, zA (front of back frame), zF, n, chaise, bcZone, pillows } */
function runCushions(g, L, r) {
  const { xL, xR, zA, zF, n } = r, M = L.M, gap = 0.006, mw = (xR - xL) / n, bc = L.bc, ch = r.chaise;
  const zS = zA + Math.min(L.bcDepth * 0.35, 0.07), er = Math.min(L.frame ? 0.03 : 0.045, L.cushT * 0.42), sy = L.seatTop - L.cushT / 2, crown = L.loose ? 0.014 : 0.008;
  const mods = L.loose ? n : 1, cw = (xR - xL) / mods;
  for (let k = 0; k < mods; k++) {
    const isCh = ch && L.loose && (ch.side < 0 ? k === 0 : k === mods - 1), z1 = zF + (isCh ? ch.extra : 0);
    g.add(cush(cw - gap, L.cushT, z1 - zS, M.seat, xL + cw * (k + 0.5), sy, (zS + z1) / 2, er, er * 1.5, crown));
  }
  if (ch && !L.loose) g.add(cush(mw - gap, L.cushT, ch.extra - gap, M.seat, ch.side < 0 ? xL + mw / 2 : xR - mw / 2, sy, zF + ch.extra / 2, er, er * 1.5, crown));
  const [b0, b1] = r.bcZone || [xL, xR], nb = Math.max(1, Math.round((b1 - b0) / mw)), bw = (b1 - b0) / nb;
  const cy = bc.top - bc.ey, cz = zA - 0.004 + bc.ez, cl = Math.cos(bc.lean), sl = Math.sin(bc.lean);
  const tiers = bc.tiers === 2 ? [[-0.5, 0.62], [0.12, 0.38]] : bc.tiers === 3 ? [[-0.5, 0.34], [-0.16, 0.33], [0.17, 0.33]] : [[-0.5, 1]];
  for (let k = 0; k < nb; k++) for (const [s0, f] of tiers) {
    const s = (s0 + f / 2) * bc.H, c = bc.tiers > 1 ? bc.crown * 1.5 : bc.crown;
    g.add(leaned(bw - gap, bc.t, bc.H * f - (bc.tiers > 1 ? 0.004 : 0), M.seat, b0 + bw * (k + 0.5), cy + s * cl, cz - s * sl, bc.lean, Math.min(bc.r, bc.H * f * 0.3), bc.r * 1.6, c));
  }
  if (r.pillows) {
    const base = matHex(M.seat), cols = [L.accent || K.shade(base, -0.28), K.shade(base, 0.35)], ps = clamp(L.seatTop * 0.95, 0.3, 0.44), pl = 0.42;
    [[xL + ps * 0.62, 0.28, cols[0]], [xR - ps * 0.62, -0.22, cols[1]]].forEach(([x, twist, col]) => {
      const e = leanExt(0.13, ps, pl, 0.03, 0.04), m = cush(ps, 0.13, ps, K.fabric(col), x, L.seatTop + e.y - 0.012, zA + L.bcDepth + e.z - 0.05, 0.028, 0.05, 0.04);
      m.rotation.order = 'YXZ'; m.rotation.set(PI / 2 - pl, twist, 0); g.add(m);
    });
  }
}

/** Legs / plinth / swivel base under a run footprint. */
function runLegs(g, L, r, len, dep) {
  const M = L.M, lh = L.legH, zB = -dep / 2, zF = dep / 2, ch = r.chaise, mw = (r.xR - r.xL) / r.n;
  if (L.legs === 'plinth') {
    g.add(K.boxOn(len - 0.08, lh, dep - 0.08, M.leg));
    if (ch) g.add(K.boxOn(mw - 0.08, lh, ch.extra, M.leg, ch.side < 0 ? r.xL + mw / 2 : r.xR - mw / 2, 0, zF + ch.extra / 2 - 0.04));
  } else if (L.legs === 'swivel') {
    const R = Math.min(len, dep) * 0.33;
    g.add(at(puckGeo(R, 0.022, 0.008, 0.006), M.leg, 0, 0.011, 0), K.cylOn(0.035, 0.045, lh + 0.01, M.leg, 0, 0.012, 0, 20));
  } else if (lh > 0) {
    const ix = Math.min(0.07, len * 0.12), iz = Math.min(0.07, dep * 0.12), lx = len / 2 - ix, pts = [[-lx, zB + iz], [lx, zB + iz], [-lx, zF - iz], [lx, zF - iz]];
    if (len > 2.35) pts.push([0, zB + iz], [0, zF - iz]);
    if (ch) { const cx = ch.side < 0 ? r.xL + mw / 2 : r.xR - mw / 2; pts.push([cx - mw / 2 + ix, zF + ch.extra - iz], [cx + mw / 2 - ix, zF + ch.extra - iz]); }
    for (const [x, z] of pts) {
      if (r.legEnds && Math.sign(x) !== r.legEnds) continue;
      g.add(L.legs === 'metal' ? K.cylOn(0.011, 0.011, lh + 0.01, M.leg, x, 0, z, 10) : K.cylOn(0.026, 0.016, lh + 0.01, M.leg, x, 0, z, 12));
    }
  }
}

/** Upholstered (or woven) straight run: base, back, arms, cushions, legs. Local frame: x along the run, back at −dep/2. */
function sofaRun(L, r) {
  const g = new THREE.Group(), { len, dep, endL, endR } = r, M = L.M, R = L.R, lh = L.legH;
  const zB = -dep / 2, zF = dep / 2, zA = zB + L.backT, xL = -len / 2 + (endL ? endL.w : 0), xR = len / 2 - (endR ? endR.w : 0), baseTop = L.seatTop - L.cushT;
  const rr = { ...r, xL, xR, zA, zF }, mw = (xR - xL) / r.n, ch = r.chaise;
  const bx0 = xL - (endL ? 0.01 : 0), bx1 = xR + (endR ? 0.01 : 0), bz0 = zA - 0.01, bz1 = zF - (L.footrest ? 0.03 : 0.015), by = L.footrest ? Math.max(lh, 0.02) : lh;
  g.add(K.rbox(bx1 - bx0, baseTop - by, bz1 - bz0, M.body, (bx0 + bx1) / 2, (by + baseTop) / 2, (bz0 + bz1) / 2, R * 0.5, 1));
  if (ch) g.add(K.rbox(mw, baseTop - lh, ch.extra + 0.04, M.body, ch.side < 0 ? xL + mw / 2 : xR - mw / 2, (lh + baseTop) / 2, zF + ch.extra / 2 - 0.035, R * 0.5, 1));
  g.add(K.rbox(len, L.backTop - lh, L.backT, M.body, 0, (lh + L.backTop) / 2, zB + L.backT / 2, Math.min(R * 0.8, L.backT * 0.45), 2));
  for (const [e, s] of [[endL, -1], [endR, 1]]) if (e) g.add(K.rbox(e.w, e.top - lh, zF - zA + 0.008, M.body, s * (len / 2 - e.w / 2), (lh + e.top) / 2, (zA - 0.008 + zF) / 2, Math.min(L.style === 'classic' ? 0.09 : R, e.w * 0.45), 2));
  if (L.footrest) g.add(leaned(xR - xL - 0.012, 0.06, baseTop - by - 0.015, M.seat, (xL + xR) / 2, (by + baseTop) / 2, zF - 0.03, 0, 0.02, 0.03, 0.014));
  runCushions(g, L, rr);
  runLegs(g, L, rr, len, dep);
  return g;
}

/** Open-frame straight run (teak / aluminium / metal / plastic, or the timber frame of a lounge chair). Same local frame as sofaRun. */
function frameRun(L, r) {
  const g = new THREE.Group(), { len, dep, endL, endR } = r, M = L.M, m = L.m;
  const zB = -dep / 2, zF = dep / 2, deckTop = L.seatTop - L.cushT, railH = Math.min(0.07, deckTop * 0.5), armT = Math.min(0.03, m), woody = WOODY.has(L.frame);
  const px = (e, s) => s * (len / 2 - (e && !e.wall ? L.aw / 2 : m / 2)), xl = px(endL, -1), xr = px(endR, 1);
  const xL = -len / 2 + (endL ? endL.w : 0), xR = len / 2 - (endR ? endR.w : 0), mw = (xR - xL) / r.n, ch = r.chaise;
  const run = L.runner, yAt = (z) => (run ? run.rise * (z / (dep / 2)) ** 2 + run.r : 0);
  g.add(K.box(xr - xl + m, railH, dep, M.body, (xl + xr) / 2, deckTop - railH / 2, 0));
  const posts = [[xl, endL, -1], [xr, endR, 1]];
  if (len > 2.35) posts.push([0, null, 0]);
  for (const [x, e, s] of posts) {
    if (r.legEnds && s !== r.legEnds && s !== 0) continue;
    const zf = zF - m / 2, zb = zB + m / 2, ft = e && !e.wall ? e.top - armT : deckTop - railH + 0.005;
    g.add(K.boxOn(m, ft - yAt(zf), m, M.body, x, yAt(zf), zf), K.boxOn(m, (s === 0 ? deckTop : L.backTop) - yAt(zb), m, M.body, x, yAt(zb), zb));
    if (e && !e.wall) g.add(K.rbox(L.aw, armT, dep, M.body, s * (len / 2 - L.aw / 2), e.top - armT / 2, 0, Math.min(0.008, armT * 0.3), 1));
    if (e && e.wall) framePanel(g, L, 'z', zB + m, zF, x, deckTop);
    if (run) g.add(tube(Array.from({ length: 13 }, (_, i) => { const z = lerp(-dep / 2, dep / 2, i / 12); return [x, yAt(z), z]; }), run.r, M.body, { radial: 8 }));
  }
  framePanel(g, L, 'x', xl, xr, zB + m / 2, deckTop);
  if (ch) {
    const cx = ch.side < 0 ? xL + mw / 2 : xR - mw / 2;
    g.add(K.box(mw, railH, ch.extra, M.body, cx, deckTop - railH / 2, zF + ch.extra / 2));
    for (const s of [-1, 1]) g.add(K.boxOn(m, deckTop - railH + 0.005, m, M.body, cx + s * (mw / 2 - m / 2), 0, zF + ch.extra - m / 2));
  }
  runCushions(g, L, { ...r, xL, xR, zA: zB + m, zF });
  return g;
}
/** Back panel of an open frame: top rail + horizontal slats between a..b along `axis` at cross position c. */
function framePanel(g, L, axis, a, b, c, deckTop) {
  const m = L.m, woody = WOODY.has(L.frame), len = b - a + (axis === 'x' ? m : 0), mid = (a + b) / 2, M = L.M.body;
  const put = (hh, tk, y) => g.add(axis === 'x' ? K.box(len, hh, tk, M, mid, y, c) : K.box(tk, hh, len, M, c, y, mid));
  put(m, m, L.backTop - m / 2);
  const y0 = deckTop + 0.05, y1 = L.backTop - m - 0.02, sh = woody ? 0.07 : 0.025, ns = clamp(Math.round((y1 - y0) / (woody ? 0.11 : 0.12)), 1, 3);
  for (let i = 0; i < ns; i++) put(sh, woody ? 0.02 : m * 0.5, lerp(y0 + sh / 2, y1 - sh / 2, ns === 1 ? 0.5 : i / (ns - 1)));
}

/** Assemble a sofa-like piece from its layout: main run + optional corner return. */
function buildSofa(w, d, h, p, o = {}) {
  const L = sofaLayout(w, d, h, p, o), g = new THREE.Group(), run = L.block ? sofaRun : frameRun, s = L.side;
  const main = run(L, { len: w, dep: L.mainD, endL: L.endL, endR: L.endR, n: L.n, chaise: s && !L.corner ? { side: s, extra: L.ext } : null, pillows: L.pillows });
  main.position.z = (L.mainD - d) / 2; g.add(main);
  if (L.corner) {
    const over = Math.max(0, L.mainD - L.backT - L.bcDepth), a = L.retArm ? L.retArm.w : 0, e = L.ext;
    const ret = run(L, { len: e, dep: L.mainD, endL: s < 0 ? L.retArm : null, endR: s > 0 ? L.retArm : null, n: L.nRet, legEnds: s, bcZone: s > 0 ? [-e / 2 - over, e / 2 - a] : [-e / 2 + a, e / 2 + over] });
    ret.rotation.y = -s * PI / 2; ret.position.set(s * (w / 2 - L.mainD / 2), 0, -d / 2 + L.mainD + e / 2); g.add(ret);
  }
  return { g, L };
}

/** Plan symbol of a sofa-like piece. */
function drawSofa(q, w, d, L, det) {
  const zB = -d / 2, zM = zB + L.mainD, zF = d / 2, s = L.side, mw = (L.xR - L.xL) / L.n, g = Math.min(0.012, mw * 0.03);
  const bodyHex = matHex(L.M.body), seatHex = matHex(L.M.seat), body = tone(bodyHex, 0.36), seat = tone(seatHex, 0.62), bcf = tone(seatHex, 0.46);
  let pts = [[-w / 2, zB], [w / 2, zB], [w / 2, zM], [-w / 2, zM]];
  if (L.corner) { const xi = s * (w / 2 - L.mainD); pts = s > 0 ? [[-w / 2, zB], [w / 2, zB], [w / 2, zF], [xi, zF], [xi, zM], [-w / 2, zM]] : [[-w / 2, zB], [w / 2, zB], [w / 2, zM], [xi, zM], [xi, zF], [-w / 2, zF]]; }
  else if (s) { const c0 = s > 0 ? L.xR - mw : L.xL, c1 = c0 + mw; pts = [[-w / 2, zB], [w / 2, zB], [w / 2, zM], [c1, zM], [c1, zF], [c0, zF], [c0, zM], [-w / 2, zM]]; }
  q.poly(pts, L.block ? 0.04 : 0.012, body);
  if (det < 14) return;
  const zA = zB + L.backT, zC = zA + L.bcDepth, r = Math.min(0.045, mw * 0.12);
  for (let k = 0; k < L.n; k++) {
    const x0 = L.xL + mw * k, isCh = s && !L.corner && (s < 0 ? k === 0 : k === L.n - 1);
    q.rr(x0 + g, zC - 0.02, x0 + mw - g, (isCh ? zF : zM) - g, r, seat, INK, 0.8);
  }
  if (L.corner) {
    const z1 = zF - (L.retArm ? L.retArm.w : 0), sw = (z1 - zM) / L.nRet, xa = s * (w / 2 - L.backT - L.bcDepth + 0.02), xb = s * (w / 2 - L.mainD);
    for (let k = 0; k < L.nRet; k++) q.rr(Math.min(xa, xb) + g, zM + sw * k + g, Math.max(xa, xb) - g, zM + sw * (k + 1) - g, r, seat, INK, 0.8);
    const nb = Math.max(1, Math.round((z1 - zC) / mw)), bw = (z1 - zC) / nb, xo = s * (w / 2 - L.backT), xi = s * (w / 2 - L.backT - L.bcDepth);
    if (det > 26) for (let k = 0; k < nb; k++) q.rr(Math.min(xo, xi), zC + bw * k + g, Math.max(xo, xi), zC + bw * (k + 1) - g, r * 0.7, bcf, FAINT);
    if (L.retArm) q.rr(Math.min(xb, s * w / 2), z1, Math.max(xb, s * w / 2), zF, 0.03, tone(bodyHex, 0.28), INK, 0.8);
  }
  if (det > 26) for (let k = 0; k < L.n; k++) q.rr(L.xL + mw * k + g, zA, L.xL + mw * (k + 1) - g, zC, r * 0.7, bcf, FAINT);
  q.line(-w / 2 + 0.02, zA, w / 2 - 0.02, zA, FAINT);
  for (const [e, sg] of [[L.endL, -1], [L.endR, 1]]) if (e && !e.wall) { const aw = L.block ? e.w : L.aw, x0 = sg * w / 2, x1 = sg * (w / 2 - aw); q.rr(Math.min(x0, x1), L.block ? zA : zB, Math.max(x0, x1), zM, L.block ? 0.035 : 0.008, tone(bodyHex, 0.28), INK, 0.8); }
  if (L.pillows && det > 60) for (const [x, a] of [[L.xL + 0.24, 0.3], [L.xR - 0.24, -0.25]]) { const c = q.ctx; c.save(); c.translate(x, zC + 0.1); c.rotate(a); q.rr(-0.19, -0.07, 0.19, 0.07, 0.04, tone(L.accent || K.shade(seatHex, -0.2), 0.3), FAINT); c.restore(); }
}

registerModel('sofa', {
  build({ w, d, h, p }) { w = dim(w, 2.2); d = dim(d, 0.95); h = dim(h, 0.82); return fit(buildSofa(w, d, h, P(p)).g, w, d, h); },
  draw2d: sym((q, { w, d, h, p, det }) => drawSofa(q, w, d, sofaLayout(w, d, h, p), det)),
});

// ═════════════════════════ ARMCHAIR ═════════════════════════
const ARM_VARIANTS = ['club', 'wing', 'shell', 'lounge', 'rocking', 'recliner'];
const ARMCHAIR_COLOR = '#8f9a8b';
/** Internal sofa-layout overrides per armchair variant (null → custom builder). */
function armchairOpts(w, d, h, p) {
  const v = pick(p.variant, ARM_VARIANTS, 'club'), legs = pick(p.legs, ['wood', 'metal', 'swivel', 'none'], null), hard = hardOf(p.material);
  const base = { single: true, color: ARMCHAIR_COLOR, swivel: legs === 'swivel' && !hard, legs: legs === 'swivel' ? 'wood' : legs || 'wood' };
  if (v === 'shell' && !hard) return null;
  if (v === 'wing' && !hard) return { ...base, v, aw: clamp(w * 0.16, 0.07, 0.14), backStyle: 'low', armTop: clamp(h * 0.54, 0.2, 0.45) + clamp(h * 0.17, 0.05, 0.19), legH: clamp(h * 0.17, 0.04, 0.19), seatK: 0.43, R: 0.06 };
  if (v === 'recliner' && !hard) return { ...base, v, aw: clamp(w * 0.23, 0.09, 0.24), legs: legs && legs !== 'swivel' ? legs : 'none', tiers: 3, R: 0.075, footrest: true, crown: 0.03, seatK: 0.46 };
  if (v === 'lounge' || v === 'rocking') return { ...base, v, frame: hard || (legs === 'metal' ? 'metal' : 'wood'), lean: 0.3, seatK: v === 'rocking' ? 0.44 : 0.52, seatMax: 0.42, runner: v === 'rocking' ? { rise: clamp(h * 0.07, 0.02, 0.075), r: 0.02 } : null };
  return { ...base, v: 'club', aw: clamp(w * 0.19, 0.08, 0.2) };
}
/** Tub / barrel chair dimensions. */
function tubLayout(w, d, h, p) {
  const legs = pick(p.legs, ['wood', 'metal', 'swivel', 'none'], 'wood'), legH = legs === 'none' ? 0 : clamp(h * 0.17, 0.03, 0.14);
  const seatTop = clamp(h * 0.55, 0.1, 0.44), t = clamp(w * 0.12, 0.04, 0.1), cushT = clamp(seatTop - legH - 0.08, 0.04, 0.13);
  return { legs, legH, seatTop, t, cushT, armTop: Math.min(h, seatTop + clamp(h * 0.2, 0.04, 0.18)), zc: -d / 2 + Math.min(w / 2, d * 0.62), body: softMat(p.material, C(p.color, ARMCHAIR_COLOR)) };
}
function buildTub(w, d, h, p) {
  const g = new THREE.Group(), T = tubLayout(w, d, h, p), { t, legH, seatTop, cushT } = T;
  const leg = T.legs === 'wood' ? hardMat(hardOf(p.material2) || 'wood', C(p.color2)) : metalMat(C(p.color2));
  const sw = w - 2 * t + 0.03, z0 = -d / 2 + t - 0.015, sl = d / 2 - z0, rp = Math.min(sw, sl) * 0.44;
  g.add(shellWall({ hw: w / 2, zB: -d / 2, zF: d / 2 - 0.035, zc: T.zc, t, y0: legH, topBack: h, topFront: T.armTop, pow: 1.25, material: T.body }));
  g.add(cush(sw, seatTop - cushT - legH, sl - 0.02, T.body, 0, (legH + seatTop - cushT) / 2, z0 + sl / 2 - 0.012, 0.02, rp, 0));
  g.add(cush(sw - 0.01, cushT, sl, T.body, 0, seatTop - cushT / 2, z0 + sl / 2, Math.min(0.045, cushT * 0.42), rp, 0.016));
  if (T.legs === 'swivel') g.add(at(puckGeo(Math.min(w, d) * 0.34, 0.022, 0.008, 0.006), leg, 0, 0.011, 0), K.cylOn(0.035, 0.045, legH + 0.01, leg, 0, 0.012, 0, 20));
  else if (legH > 0) { const r = T.legs === 'metal' ? 0.009 : 0.02; splayLegs(g, { x: w * 0.3, z: [-d * 0.3, d * 0.3] }, { x: w * 0.38, z: [-d * 0.38, d * 0.4] }, legH + 0.012, r * 1.25, r * 0.8, leg); }
  return g;
}
function buildArmchair(w, d, h, p) {
  const o = armchairOpts(w, d, h, p);
  if (!o) return buildTub(w, d, h, p);
  const { g, L } = buildSofa(w, d, h, p, o);
  if (o.v === 'wing') {                                         // upholstered ears between arm and back top
    const wd = clamp(d * 0.34, 0.1, 0.3), wh = Math.max(0.08, h - L.armTop + 0.05), wt = Math.min(0.075, L.aw);
    for (const s of [-1, 1]) {
      const m = cush(wd, wt, wh, L.M.body, s * (w / 2 - wt / 2), h - wh / 2, -d / 2 + L.backT + wd / 2 - 0.02, wt * 0.42, Math.min(wd * 0.48, 0.12), 0.006);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(s, 0, 0), new THREE.Vector3(0, s, 0)));
      g.add(m);
    }
  }
  return g;
}
registerModel('armchair', {
  build({ w, d, h, p }) { w = dim(w, 0.8); d = dim(d, 0.85); h = dim(h, 0.85); return fit(buildArmchair(w, d, h, P(p)), w, d, h); },
  draw2d: sym((q, { w, d, h, p, det }) => {
    const o = armchairOpts(w, d, h, p);
    if (o) {
      const L = sofaLayout(w, d, h, p, o); drawSofa(q, w, d, L, det);
      if (o.v === 'wing' && det > 20) for (const s of [-1, 1]) q.rr(Math.min(s * w / 2, s * (w / 2 - 0.07)), -d / 2 + L.backT - 0.02, Math.max(s * w / 2, s * (w / 2 - 0.07)), -d / 2 + L.backT + clamp(d * 0.3, 0.1, 0.27), 0.03, tone(matHex(L.M.body), 0.22), INK, 0.8);
      if (o.runner && det > 20) for (const s of [-1, 1]) q.line(s * (w / 2 - 0.03), -d / 2, s * (w / 2 - 0.03), d / 2, FAINT, 2);
      return;
    }
    const T = tubLayout(w, d, h, p), hex = matHex(T.body), t = T.t, zF = d / 2 - 0.035, ry = T.zc + d / 2;
    q.path((c) => { c.moveTo(-w / 2, zF); c.lineTo(-w / 2, T.zc); c.ellipse(0, T.zc, w / 2, ry, 0, PI, PI * 2); c.lineTo(w / 2, zF); c.arc(w / 2 - t / 2, zF, t / 2, 0, PI); c.lineTo(w / 2 - t, T.zc); c.ellipse(0, T.zc, w / 2 - t, Math.max(ry - t, 0.01), 0, 0, PI, true); c.lineTo(-w / 2 + t, zF); c.arc(-w / 2 + t / 2, zF, t / 2, 0, PI); c.closePath(); }, tone(hex, 0.3));
    if (det < 14) return;
    q.path((c) => { c.moveTo(-w / 2 + t, d / 2 - 0.06); c.lineTo(-w / 2 + t, T.zc); c.ellipse(0, T.zc, w / 2 - t, Math.max(ry - t, 0.01), 0, PI, PI * 2); c.lineTo(w / 2 - t, d / 2 - 0.06); c.quadraticCurveTo(w / 2 - t, d / 2, w / 2 - t - 0.06, d / 2); c.lineTo(-w / 2 + t + 0.06, d / 2); c.quadraticCurveTo(-w / 2 + t, d / 2, -w / 2 + t, d / 2 - 0.06); c.closePath(); }, tone(hex, 0.6), INK, 0.8);
  }),
});

// ═════════════════════════ POUF ═════════════════════════
function poufLayout(w, d, h, p) {
  const hard = hardOf(p.material), rect = pick(p.shape, ['round', 'rect'], 'round') === 'rect';
  const body = hard ? hardMat(hard, C(p.color)) : softMat(p.material, C(p.color, '#c9b99f'));
  const top = hard ? softMat(p.material2, C(p.color2, OUTDOOR_CUSHION)) : body;
  return { hard, rect, body, top };
}
registerModel('pouf', {
  build({ w, d, h, p }) {
    w = dim(w, 0.6); d = dim(d, 0.6); h = dim(h, 0.4); p = P(p);
    const g = new THREE.Group(), L = poufLayout(w, d, h, p), feet = Math.min(0.02, h * 0.06), H = h - feet, er = clamp(H * 0.16, 0.01, 0.06);
    const dark = K.mat('#2a2826', { roughness: 0.8 });
    if (L.hard) {                                              // rigid drum / cube with a seat pad
      const padT = WOODY.has(L.hard) || L.hard === 'rattan' || L.hard === 'metal' || L.hard === 'aluminium' ? clamp(H * 0.2, 0.02, 0.08) : 0, bh = H - padT;
      if (L.rect) g.add(K.rbox(w, bh, d, L.body, 0, feet + bh / 2, 0, 0.012, 1)); else g.add(puck(w / 2, d / 2, bh, L.body, 0, feet + bh / 2, 0, 0.012, 0, L.hard === 'rattan' ? Math.min(0.02, w * 0.04) : 0));
      if (padT) g.add(L.rect ? cush(w - 0.02, padT + 0.01, d - 0.02, L.top, 0, h - padT / 2 - 0.005, 0, padT * 0.4, 0.04, 0.012) : puck(w / 2 - 0.012, d / 2 - 0.012, padT + 0.01, L.top, 0, h - padT / 2 - 0.005, 0, padT * 0.4, 0.012));
    } else if (L.rect) {                                       // upholstered ottoman: body + crowned top pad
      const padT = clamp(H * 0.42, 0.03, 0.16), rp = Math.min(0.08, Math.min(w, d) * 0.2);
      g.add(cush(w - 0.012, H - padT + 0.01, d - 0.012, L.body, 0, feet + (H - padT + 0.01) / 2, 0, er * 0.6, rp, 0));
      g.add(cush(w, padT, d, L.body, 0, h - padT / 2, 0, Math.min(er, padT * 0.42), rp, Math.min(0.018, padT * 0.25)));
    } else {                                                   // soft round pouf with piping
      const bulge = Math.min(0.02, w * 0.035);
      g.add(puck(w / 2, d / 2, H, L.body, 0, feet + H / 2, 0, er, Math.min(0.02, H * 0.1), bulge));
      const ring = at(memo(`tor|${mm(w / 2 - er * 0.3 - bulge)}`, () => new THREE.TorusGeometry(Math.max(w / 2 - er * 0.3 - bulge, 0.01), 0.005, 6, 40)), K.mat(K.shade(matHex(L.body), -0.18), { roughness: 0.9 }), 0, h - er * 0.75 - Math.min(0.02, H * 0.1), 0);
      ring.rotation.x = PI / 2; ring.scale.y = d / w; g.add(ring);
      g.add(puck(0.016, 0.016 * d / w, 0.008, K.mat(K.shade(matHex(L.body), -0.18), { roughness: 0.9 }), 0, h - 0.003, 0, 0.003, 0.002));
    }
    if (feet > 0.004) { const fx = w * (L.rect ? 0.4 : 0.26), fz = d * (L.rect ? 0.38 : 0.26); for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(K.cylOn(0.016, 0.014, feet + 0.004, dark, sx * fx, 0, sz * fz, 10)); }
    return fit(g, w, d, h);
  },
  draw2d: sym((q, { w, d, h, p, det }) => {
    const L = poufLayout(w, d, h, p), hex = matHex(L.top), f = tone(hex, 0.45), f2 = tone(hex, 0.62);
    if (L.rect) { q.rr(-w / 2, -d / 2, w / 2, d / 2, Math.min(0.07, Math.min(w, d) * 0.2), f); if (det > 16) q.rr(-w / 2 + 0.035, -d / 2 + 0.035, w / 2 - 0.035, d / 2 - 0.035, 0.05, f2, FAINT); }
    else { q.ellipse(0, 0, w / 2, d / 2, f); if (det > 16) q.ellipse(0, 0, w / 2 - 0.04, d / 2 - 0.04, f2, FAINT); if (det > 40 && !L.hard) q.ellipse(0, 0, 0.012, 0.012, null, INK, 0.8); }
  }),
});

// ═════════════════════════ BENCH ═════════════════════════
function benchLayout(w, d, h, p) {
  const back = flag(p.back), uph = flag(p.upholstered), storage = flag(p.storage), hard = hardOf(p.material), soft = softOf(p.material);
  const frameKind = hard || (hardOf(p.material2) && !uph ? null : null) || 'wood';
  const frame = hard ? hardMat(hard, C(p.color)) : soft || uph ? hardMat(hardOf(p.material2) || 'wood', C(p.color2)) : hardMat('wood', C(p.color));
  const pad = softMat(soft || softOf(p.material2), hard ? C(p.color2, '#d9d3c7') : C(p.color, '#b9b0a2'));
  const metalLegs = !hard && !soft && !uph && (p.material2 === 'metal' || p.material2 === 'aluminium');
  const legM = metalLegs ? hardMat(p.material2, C(p.color2)) : frame;
  const metal = frameKind === 'metal' || frameKind === 'aluminium';
  const seatTop = back ? clamp(h * 0.52, 0.08, 0.46) : h, padT = uph ? clamp(seatTop * 0.16, 0.02, 0.08) : 0;
  const slats = !uph && !storage && (frameKind === 'teak' || back || metal);
  const lt = metal || metalLegs ? 0.03 : clamp(seatTop * 0.1, 0.03, 0.05), rake = back ? clamp((h - seatTop) * 0.2, 0.01, 0.09) : 0;
  const arms = back && !storage;
  return { back, uph, storage, frame, pad, legM, metal, metalLegs, seatTop, padT, slats, lt, rake, arms, armY: Math.min(h - 0.02, seatTop + clamp((h - seatTop) * 0.5, 0.04, 0.22)), zS: -d / 2 + (back ? rake + lt * 0.6 : 0) };
}
registerModel('bench', {
  build({ w, d, h, p }) {
    w = dim(w, 1.2); d = dim(d, 0.4); h = dim(h, 0.45); p = P(p);
    const g = new THREE.Group(), L = benchLayout(w, d, h, p), { lt, seatTop, padT, frame } = L, zB = -d / 2, zF = d / 2, zS = L.zS, sd = zF - zS;
    const deck = seatTop - padT, st = L.slats ? 0.022 : clamp(seatTop * 0.085, 0.022, 0.045);
    if (L.storage) {
      const feet = Math.min(0.025, h * 0.06), lid = 0.022, bh = deck - lid - 0.003 - feet;
      g.add(K.boxOn(w - 0.012, bh, sd - 0.012, frame, 0, feet, zS + sd / 2));
      g.add(plate('rect', w, sd, lid, frame, 0, deck - lid / 2, zS + sd / 2, 0.006));
      g.add(K.box(w - 0.1, 0.004, 0.004, K.mat('#1c1b1a'), 0, feet + bh * 0.62, zF - 0.005));       // front panel groove
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(K.boxOn(0.04, feet + 0.002, 0.04, K.mat('#2a2826'), sx * (w / 2 - 0.05), 0, zS + sd / 2 + sz * (sd / 2 - 0.05)));
    } else {
      if (L.slats) {
        const n = clamp(Math.round(sd / 0.085), 2, 8), pw = sd / n;
        for (let i = 0; i < n; i++) g.add(K.box(w - (L.arms ? 2 * lt : 0) - 0.002, st, pw - 0.008, frame, 0, deck - st / 2, zS + pw * (i + 0.5)));
      } else g.add(plate('rect', w - (L.arms ? 2 * lt : 0), sd, st, frame, 0, deck - st / 2, zS + sd / 2, 0.006));
      const ah = clamp(seatTop * 0.13, 0.03, 0.07), xo = w / 2 - lt / 2 - (L.arms ? 0 : Math.min(0.04, w * 0.04)), zf = zF - lt / 2 - (L.arms ? 0 : Math.min(0.02, d * 0.06)), zb = zS + lt / 2 + (L.back ? 0 : Math.min(0.02, d * 0.06));
      if (L.metalLegs || L.metal) {                             // flat-bar loop frames
        for (const s of [-1, 1]) {
          g.add(K.boxOn(lt, L.arms ? L.armY - 0.02 : deck - st, 0.012, L.legM, s * xo, 0, zf), K.box(lt, 0.012, zf - zb, L.legM, s * xo, 0.006, (zf + zb) / 2), K.box(lt, 0.012, zf - zb, L.legM, s * xo, deck - st - 0.006, (zf + zb) / 2));
          if (!L.back) g.add(K.boxOn(lt, deck - st, 0.012, L.legM, s * xo, 0, zb));
        }
        if (w > 1.7) g.add(K.box(w - 0.2, 0.03, 0.012, L.legM, 0, deck - st - 0.015, (zf + zb) / 2));
      } else {
        for (const s of [-1, 1]) { g.add(K.boxOn(lt, L.arms ? L.armY - 0.02 : deck - st, lt, L.legM, s * xo, 0, zf)); if (!L.back) g.add(K.boxOn(lt, deck - st, lt, L.legM, s * xo, 0, zb)); }
        g.add(K.box(2 * xo - lt, ah, 0.02, L.legM, 0, deck - st - ah / 2, zf), K.box(2 * xo - lt, ah, 0.02, L.legM, 0, deck - st - ah / 2, zb));
        for (const s of [-1, 1]) g.add(K.box(0.02, ah, zf - zb - lt, L.legM, s * xo, deck - st - ah / 2, (zf + zb) / 2));
        if (w > 1.9 && !L.back) for (const z of [zf, zb]) g.add(K.boxOn(lt, deck - st, lt, L.legM, 0, 0, z));
      }
    }
    if (padT) g.add(cush(w - (L.arms ? 2 * lt : 0) - 0.01, padT + 0.006, sd - 0.01, L.pad, 0, seatTop - padT / 2 - 0.003, zS + sd / 2, padT * 0.42, 0.03, Math.min(0.014, padT * 0.3)));
    if (L.back) {
      const xo = w / 2 - lt / 2, zp = zB + L.rake + lt / 2, legM = L.storage ? frame : L.legM;
      for (const s of [-1, 1]) {
        g.add(beam([s * xo, 0, zB + lt / 2], [s * xo, seatTop, zp], lt, lt, legM), beam([s * xo, seatTop - 0.01, zp], [s * xo, h, zB + lt / 2], lt, lt * 0.85, legM));
        if (L.arms) g.add(K.box(lt + 0.02, 0.022, zF - zp + lt / 2, legM, s * (w / 2 - lt / 2 - 0.01), L.armY - 0.011, (zF + zp - lt / 2) / 2));
      }
      const bh = h - seatTop, zAt = (y) => lerp(zp, zB + lt / 2, (y - seatTop) / Math.max(bh, 0.01)), lean = Math.atan2(zp - zB - lt / 2, Math.max(bh, 0.01));
      if (L.uph) { const m = leaned(w - 2 * lt - 0.01, 0.07, bh - 0.05, L.pad, 0, seatTop + bh / 2 + 0.02, zAt(seatTop + bh / 2) + 0.03, lean, 0.025, 0.035, 0.012); g.add(m); g.add(K.box(w - 2 * lt, 0.05, 0.02, legM, 0, h - 0.03, zAt(h - 0.03))); }
      else {
        const n = clamp(Math.round((bh - 0.06) / (L.metal ? 0.07 : 0.1)), 1, 5), sh = L.metal ? 0.03 : 0.065;
        for (let i = 0; i < n; i++) { const y = lerp(h - sh / 2, seatTop + 0.1 + sh / 2, n === 1 ? 0 : i / (n - 1)), m = K.box(w - 2 * lt + 0.004, sh, L.metal ? 0.012 : 0.02, frame, 0, y, zAt(y)); m.rotation.x = -lean; g.add(m); }
      }
      if (w > 1.9) g.add(K.boxOn(lt, seatTop - padT - 0.02, lt, legM, 0, 0, zF - lt / 2), K.boxOn(lt, seatTop - padT - 0.02, lt, legM, 0, 0, zp));
    }
    return fit(g, w, d, h);
  },
  draw2d: sym((q, { w, d, h, p, det }) => {
    const L = benchLayout(w, d, h, p), fh = matHex(L.frame), zS = L.zS, a = L.arms ? L.lt + 0.02 : 0;
    q.rr(-w / 2, -d / 2, w / 2, d / 2, 0.012, tone(fh, 0.42));
    if (det < 12) return;
    if (L.back) q.rr(-w / 2, -d / 2, w / 2, zS, 0.008, tone(fh, 0.25), INK, 0.8);
    if (L.arms) for (const s of [-1, 1]) q.rr(Math.min(s * w / 2, s * (w / 2 - a)), zS, Math.max(s * w / 2, s * (w / 2 - a)), d / 2, 0.008, tone(fh, 0.3), INK, 0.8);
    if (L.padT) q.rr(-w / 2 + a + 0.015, zS + 0.015, w / 2 - a - 0.015, d / 2 - 0.015, 0.03, tone(matHex(L.pad), 0.6), INK, 0.8);
    else if (L.slats && det > 24) { const n = clamp(Math.round((d / 2 - zS) / 0.085), 2, 8); for (let i = 1; i < n; i++) q.line(-w / 2 + a, lerp(zS, d / 2, i / n), w / 2 - a, lerp(zS, d / 2, i / n), FAINT); }
    else if (det > 24) q.rr(-w / 2 + 0.025, zS + 0.025, w / 2 - 0.025, d / 2 - 0.025, 0.006, null, FAINT);
    if (L.storage && det > 30) q.line(-w / 2 + 0.04, d / 2 - 0.045, w / 2 - 0.04, d / 2 - 0.045, FAINT);
  }),
});

// ═════════════════════════ CHAIR ═════════════════════════
const CHAIR_VARIANTS = ['dining', 'upholstered', 'shell', 'folding', 'cross-back', 'cantilever', 'stacking', 'director', 'adirondack'];
/** Resolved options shared by the chair builder and its plan symbol. */
function chairLayout(w, d, h, p) {
  const variant = pick(p.variant, CHAIR_VARIANTS, 'dining'), arms = flag(p.arms), legs = pick(p.legs, ['wood', 'metal', 'sled'], null);
  const hard = hardOf(p.material), soft = softOf(p.material), c1 = C(p.color), c2 = C(p.color2);
  const sh = variant === 'adirondack' ? clamp(h * 0.4, 0.08, 0.38) : clamp(h * 0.55, 0.08, 0.47);
  let main, sec, frame;                                        // main = dominant visible surface, sec = seat pad / infill, frame = legs
  if (variant === 'dining') {
    const metalF = hard === 'metal' || hard === 'aluminium';
    main = soft ? hardMat('wood', c2) : hardMat(hard || 'wood', c1);
    sec = soft ? softMat(soft, c1 || '#d8d2c6') : softMat(p.material2, metalF ? c2 || '#8f9394' : c2 || '#d8d2c6');
    frame = legs === 'metal' || legs === 'sled' ? metalMat(soft ? undefined : c2 && !softOf(p.material2) ? c2 : undefined) : main;
  } else if (variant === 'stacking') { main = hardMat(hard || 'plastic', c1 || '#e9e6df'); sec = main; frame = c2 ? K.metal(c2) : K.metal('#b9bcc0', { roughness: 0.25 }); }
  else if (variant === 'shell') { main = soft ? softMat(soft, c1) : hardMat(hard || 'plastic', c1 || '#f1efe9'); sec = main; frame = legs === 'metal' || legs === 'sled' ? metalMat(c2) : hardMat('wood', c2); }
  else if (variant === 'upholstered') { main = softMat(soft, c1 || '#a9a497'); sec = main; frame = legs === 'metal' || legs === 'sled' ? metalMat(c2) : hardMat(hardOf(p.material2) || 'wood', c2); }
  else if (variant === 'folding') { main = hardMat(hard || 'metal', c1 || '#2e3136'); sec = hardOf(p.material2) || c2 ? hardMat(hardOf(p.material2) || hard || 'metal', c2 || c1) : main; frame = main; }
  else if (variant === 'cross-back') { main = hardMat(hard || 'wood', c1 || 'oak'); sec = softOf(p.material2) ? softMat(p.material2, c2) : K.rattan(c2 || '#dcc79e'); frame = main; }
  else if (variant === 'cantilever') { main = soft ? softMat(soft, c1 || '#2b2622') : hard ? hardMat(hard, c1) : K.leather(c1 || '#2b2622'); sec = main; frame = c2 ? K.metal(c2) : K.chrome(); }
  else if (variant === 'director') { main = softMat(soft, c1 || '#e6dfd0'); sec = main; frame = hardMat(hardOf(p.material2) || 'wood', c2); }
  else { main = hardMat(hard || 'wood', c1 || '#b08456'); sec = main; frame = main; }
  return { variant, arms: arms || variant === 'director' || variant === 'adirondack', legs, sh, main, sec, frame, soft, hard };
}

/** Curved rail (timber / plastic back rail) spanning x ∈ ±hw, bowed towards −Z by sag, section tu × [y0, y1]. */
function backRail(hw, z, sag, tu, y0, y1, material, hard = true, r = 0.004) {
  const st = Array.from({ length: 9 }, (_, i) => { const x = lerp(-hw, hw, i / 8); return { x, z: z - sag * (1 - (x / Math.max(hw, 1e-3)) ** 2) }; });
  return sweep(st, rrSection(tu, y0, y1, r, 0, hard ? 1 : 2), material, { hard });
}

function chairTimber(g, w, d, h, L) {                          // classic four-leg frame chair (timber or square metal tube)
  const metalF = L.hard === 'metal' || L.hard === 'aluminium', lt = metalF ? 0.022 : clamp(w * 0.07, 0.024, 0.036), sh = L.sh, zB = -d / 2, zF = d / 2;
  const xo = w / 2 - lt / 2 - (L.arms ? 0.004 : 0), sag = clamp(w * 0.05, 0.008, 0.028), rake = clamp((h - sh) * 0.14, 0.008, 0.055), zp = zB + lt / 2 + rake, zt = zB + lt / 2 + sag * 0.75;
  const padT = metalF ? 0.012 : 0.035, st = 0.02, deck = sh - padT, ah = clamp(sh * 0.11, 0.025, 0.05), armY = Math.min(h - 0.03, sh + clamp((h - sh) * 0.55, 0.04, 0.22)), zf = zF - lt / 2 - 0.004;
  for (const s of [-1, 1]) {
    g.add(K.boxOn(lt, L.arms ? armY - 0.02 : deck - st + 0.004, lt, L.main, s * xo, 0, zf));
    g.add(beam([s * xo, 0, zB + lt / 2 + 0.004], [s * xo, sh, zp], lt, lt, L.main), beam([s * xo, sh - 0.012, zp], [s * xo, h - 0.004, zt], lt, lt * 0.8, L.main));
    g.add(K.box(0.018, ah, zf - zp - lt, L.main, s * xo, deck - st - ah / 2, (zf + zp) / 2));
    if (L.arms) g.add(K.rbox(lt + 0.008, 0.02, zf - zp + lt, L.main, s * xo, armY - 0.01, (zf + zp) / 2, 0.006, 1));
  }
  g.add(K.box(2 * xo - lt, ah, 0.018, L.main, 0, deck - st - ah / 2, zf), K.box(2 * xo - lt, ah, 0.018, L.main, 0, deck - st - ah / 2, zp));
  const sw = L.arms ? 2 * xo - lt - 0.002 : w, z0 = zp + lt / 2 - 0.002;
  g.add(plate('rect', sw, zF - z0, st, L.main, 0, deck - st / 2, (z0 + zF) / 2, 0.018));
  g.add(cush(sw - 0.024, padT + 0.004, zF - z0 - 0.024, L.sec, 0, sh - padT / 2 - 0.002, (z0 + zF) / 2, padT * 0.4, 0.03, metalF ? 0.002 : 0.008));
  const rh = clamp((h - sh) * 0.24, 0.035, 0.1), zr = zt - (lt * 0.4 - 0.009);
  g.add(backRail(xo, zr, sag * 0.75, 0.018, h - rh, h, L.main), backRail(xo, lerp(zp, zt, 0.45) - 0.004, sag * 0.6, 0.016, sh + (h - sh) * 0.4, sh + (h - sh) * 0.4 + 0.04, L.main));
}

function chairPanels(g, w, d, h, L) {                          // thin seat + curved back panel on a slim metal frame (stacking / café)
  const sh = L.sh, zB = -d / 2, zF = d / 2, r = 0.009, sw = w - (L.arms ? 0.05 : 0.012), z0 = zB + clamp(d * 0.12, 0.02, 0.07), st = 0.014, wood = L.main.map != null;
  g.add(cush(sw, st, zF - z0, L.main, 0, sh - st / 2, (z0 + zF) / 2, wood ? 0.004 : 0.006, Math.min(0.07, sw * 0.16), 0));
  const bh = clamp((h - sh) * 0.48, 0.06, 0.24), sag = clamp(w * 0.07, 0.01, 0.035), bw = sw / 2 - 0.012;
  g.add(backRail(bw, zB + 0.006 + sag, sag, 0.012, h - bh, h, L.main, false, 0.0055));
  const xs = sw / 2 - 0.045, y1 = sh - st, xb = w / 2 - r, zs0 = z0 + 0.04, zs1 = zF - 0.05;
  if (L.legs === 'sled') sledLegs(g, xs, y1, zB + 0.02, zF, r, L.frame);
  else for (const s of [-1, 1]) g.add(strut([s * xb, r * 0.25, zF - r], [s * xs, y1, zs1], r, r, L.frame), tube(roundPath([[s * xb, r, zB + r + 0.01], [s * xs, y1 - 0.01, zs0], [s * (bw - 0.03), h - bh * 0.55, zB + 0.012 + sag * 0.4]], 0.05, 3), r, L.frame));
  if (L.legs === 'sled') for (const s of [-1, 1]) g.add(strut([s * xs, y1 - 0.01, zs0], [s * (bw - 0.03), h - bh * 0.55, zB + 0.012 + sag * 0.4], r, r, L.frame));
  for (const s of [-1, 1]) g.add(strut([s * xs, y1 - r, zs0], [s * xs, y1 - r, zs1], r * 0.9, r * 0.9, L.frame, 8));
  if (L.arms) { const ay = Math.min(h - 0.04, sh + clamp((h - sh) * 0.5, 0.04, 0.2)); for (const s of [-1, 1]) g.add(tube(roundPath([[s * (bw - 0.01), ay, zB + 0.03 + sag * 0.5], [s * xb, ay, zB + 0.1], [s * xb, ay, zF - 0.1], [s * xb, y1 - 0.02, zF - 0.06], [s * xs, y1 - 0.008, zF - 0.07]], 0.04, 3), r, L.frame)); }
}

function chairShell(g, w, d, h, L) {                           // moulded shell (or padded tub) on legs
  const sh = L.sh, zB = -d / 2, zF = d / 2, soft = !!L.soft || L.variant === 'upholstered', t = soft ? clamp(w * 0.09, 0.03, 0.055) : 0.014, st = soft ? clamp(sh * 0.2, 0.04, 0.1) : 0.024;
  const flare = 0.16, y0 = sh - st * (soft ? 0.9 : 0.5), top0 = sh + (L.arms ? clamp((h - sh) * 0.5, 0.04, 0.2) : clamp((h - sh) * 0.1, 0.01, 0.04));
  g.add(shellWall({ hw: w / 2, zB, zF: L.arms ? zF - clamp(d * 0.22, 0.04, 0.14) : zB + d * 0.5, zc: zB + Math.min(w / 2, d * (L.arms ? 0.55 : 0.45)), t, y0, topBack: h, topFront: top0, flare, pow: L.arms ? 1.3 : 2.2, material: L.main, r: soft ? t * 0.45 : 0.006 }));
  const sw = w - 2 * (t + flare * (top0 - y0)) + 0.02, z0 = zB + t + flare * (h - y0) * 0.6;
  g.add(cush(sw, st, zF - z0, L.main, 0, sh - st / 2, (z0 + zF) / 2, soft ? st * 0.4 : 0.01, Math.min(sw, zF - z0) * (soft ? 0.3 : 0.36), soft ? 0.012 : 0));
  const y1 = sh - st + 0.006, xt = sw * 0.3, zt = [z0 + (zF - z0) * 0.22, zF - (zF - z0) * 0.2];
  if (L.legs === 'sled') { sledLegs(g, sw / 2 - 0.03, y1, zB + 0.04, zF - 0.01, 0.009, L.frame); g.add(strut([-(sw / 2 - 0.03), y1 - 0.009, 0], [sw / 2 - 0.03, y1 - 0.009, 0], 0.008, 0.008, L.frame, 8)); }
  else {
    const metal = L.legs === 'metal', rb = metal ? 0.008 : 0.011, rt = metal ? 0.009 : 0.017;
    splayLegs(g, { x: xt, z: zt }, { x: w / 2 - rb - 0.004, z: [zB + rb + 0.03, zF - rb - 0.004] }, y1, rt, rb, L.frame);
    if (!metal) { const m = K.metal('#26272b'), yb = y1 * 0.72, k = 1 - yb / y1; for (const s of [-1, 1]) g.add(strut([-lerp(xt, w / 2, k * 0.9), yb, lerp(zt[0], zB + 0.04, k * 0.9) * 1], [lerp(xt, w / 2, k * 0.9) * 1, yb, lerp(zt[1], zF, k * 0.9)], 0.003, 0.003, m, 6).translateX(0)); }
    g.add(K.box(xt * 2 + 0.03, 0.012, zt[1] - zt[0] + 0.03, metal ? L.frame : K.metal('#26272b'), 0, y1 - 0.006, (zt[0] + zt[1]) / 2));
  }
}

function chairPadded(g, w, d, h, L) {                          // armless upholstered dining chair
  const sh = L.sh, zB = -d / 2, zF = d / 2, st = clamp(sh * 0.2, 0.04, 0.1), lean = 0.17, bt = 0.065, cr = 0.025, crown = 0.012;
  const Hv = h - (sh - 0.02), bh = 2 * ((Hv / 2 - cr - (bt / 2 - crown - cr) * Math.sin(lean)) / Math.cos(lean) + cr), e = leanExt(bt, bh, lean, cr, crown);
  g.add(leaned(w - 0.02, bt, bh, L.main, 0, h - e.y, zB + e.z, lean, cr, 0.05, crown));
  const z0 = zB + bh * Math.sin(lean) * 0.25 + 0.02;
  g.add(cush(w, st, zF - z0, L.main, 0, sh - st / 2, (z0 + zF) / 2, st * 0.4, 0.05, 0.012));
  const y1 = sh - st + 0.008;
  if (L.legs === 'sled') sledLegs(g, w / 2 - 0.035, y1, zB + 0.03, zF - 0.01, 0.01, L.frame);
  else { const metal = L.legs === 'metal', rb = metal ? 0.008 : 0.012; splayLegs(g, { x: w / 2 - 0.06, z: [z0 + 0.05, zF - 0.06] }, { x: w / 2 - rb - 0.004, z: [zB + rb + 0.01, zF - rb - 0.004] }, y1, metal ? 0.009 : 0.019, rb, L.frame); }
}

function chairFolding(g, w, d, h, L) {
  const sh = L.sh, zB = -d / 2, zF = d / 2, r = 0.011, xo = w / 2 - r, xi = xo - 0.028, st = 0.016, zs0 = zB + d * 0.2;
  for (const s of [-1, 1]) {
    g.add(strut([s * xo, r * 0.3, zF - r], [s * xo, h - r, zB + r], r, r, L.frame));                 // front foot → top of back
    g.add(strut([s * xi, r * 0.3, zB + r + 0.02], [s * xi, sh - st, zF - 0.08], r, r, L.frame));      // rear foot → under seat front
  }
  g.add(strut([-xo, h * 0.14, lerp(zF, zB, 0.14)], [xo, h * 0.14, lerp(zF, zB, 0.14)], r * 0.8, r * 0.8, L.frame, 8), strut([-xi, sh * 0.25, lerp(zB + 0.02, zF - 0.08, 0.25)], [xi, sh * 0.25, lerp(zB + 0.02, zF - 0.08, 0.25)], r * 0.8, r * 0.8, L.frame, 8));
  g.add(cush(w - 2 * r - 0.004, st, zF - zs0, L.sec, 0, sh - st / 2, (zs0 + zF) / 2, 0.006, 0.03, 0));
  const yb = h - clamp((h - sh) * 0.22, 0.03, 0.1), bh = clamp((h - sh) * 0.36, 0.05, 0.17), tz = (y) => lerp(zF - r, zB + r, y / h);
  const m = K.rbox(2 * xo, bh, 0.014, L.sec, 0, yb, tz(yb) + 0.004, 0.006, 1); m.rotation.x = -Math.atan2(d - 2 * r, h); g.add(m);
}

function chairCrossBack(g, w, d, h, L) {
  const sh = L.sh, zB = -d / 2, zF = d / 2, r = 0.015, xo = w / 2 - r - 0.012, rake = clamp((h - sh) * 0.14, 0.008, 0.06), zp = zB + r + rake, st = 0.03, y1 = sh - st;
  const arc = roundPath([[-xo, 0.004, zB + r + 0.004], [-xo, sh, zp], [-xo * 0.98, h - 0.1, zB + r + 0.012], [0, h - r, zB + r], [xo * 0.98, h - 0.1, zB + r + 0.012], [xo, sh, zp], [xo, 0.004, zB + r + 0.004]], 0.12, 5);
  g.add(tube(arc, r, L.main, { radial: 8 }));
  splayLegs(g, { x: w / 2 - 0.06, z: [zF - 0.06, zF - 0.06] }, { x: w / 2 - r - 0.003, z: [zF - r - 0.003, zF - r - 0.003] }, y1, r, r * 0.8, L.main);
  const z0 = zp + r * 0.4;
  g.add(cush(w, st, zF - z0, L.main, 0, sh - st / 2, (z0 + zF) / 2, 0.012, Math.min(w, zF - z0) * 0.3, 0));
  g.add(cush(w - 0.07, 0.012, zF - z0 - 0.07, L.sec, 0, sh - 0.004, (z0 + zF) / 2, 0.004, Math.min(w, zF - z0) * 0.26, 0.003));
  const ya = sh + 0.03, yt = h - clamp((h - sh) * 0.2, 0.03, 0.1), zy = (y) => lerp(zp, zB + r + 0.008, (y - sh) / Math.max(h - sh, 0.01));
  for (const s of [-1, 1]) g.add(beam([s * (xo - 0.005), ya, zy(ya)], [-s * (xo - 0.02), yt, zy(yt)], 0.006, 0.032, L.main));
  const ys = sh * 0.42;
  g.add(strut([-(w / 2 - 0.03), ys, zF - 0.03], [w / 2 - 0.03, ys, zF - 0.03], 0.008, 0.008, L.main, 8));
  for (const s of [-1, 1]) g.add(strut([s * (w / 2 - 0.03), ys - 0.03, zF - 0.035], [s * xo, ys - 0.03, lerp(zB + r, zp, ys / sh)], 0.008, 0.008, L.main, 8));
}

function chairCantilever(g, w, d, h, L) {
  const sh = L.sh, zB = -d / 2, zF = d / 2, r = 0.0125, x = w / 2 - r, st = 0.045, ys = sh - st / 2, zs = zB + clamp(d * 0.2, 0.03, 0.12), zf = zF - r, ay = Math.min(h - 0.05, sh + clamp((h - sh) * 0.5, 0.04, 0.2));
  const half = (s) => [[s * x, h - r, zB + r], [s * x, ys, zs], [s * x, ys, zf], [s * x, r, zf - 0.02], [s * x, r, zB + r + 0.03]];
  g.add(tube(roundPath([...half(-1), ...half(1).reverse()], 0.055, 4), r, L.frame, { radial: 8 }));
  g.add(cush(2 * x - 2 * r + 0.004, st, zF - zs - 0.03, L.main, 0, sh - st / 2, (zs + zF) / 2 - 0.006, 0.014, 0.03, 0.006));
  const bh = clamp((h - sh) * 0.5, 0.06, 0.26), ym = h - bh / 2 - 0.012, zAt = (y) => lerp(zs, zB + r, (y - ys) / Math.max(h - r - ys, 0.01));
  const b = leaned(2 * x - 2 * r + 0.004, 0.028, bh, L.main, 0, ym, zAt(ym) + 0.004, Math.atan2(zs - zB - r, Math.max(h - ys, 0.01)), 0.01, 0.02, 0.004); g.add(b);
  if (L.arms) for (const s of [-1, 1]) {
    g.add(tube(roundPath([[s * x, ay, zAt(ay)], [s * x, ay, zF - 0.1], [s * x, ys, zF - 0.12]], 0.05, 3), r, L.frame));
    g.add(K.rbox(0.04, 0.014, (zF - 0.14) - zAt(ay) - 0.04, hardOf(L.hard) ? L.main : K.wood('#3a2d25'), s * x, ay + r + 0.005, (zF - 0.14 + zAt(ay)) / 2 + 0.01, 0.005, 1));
  }
}

function chairDirector(g, w, d, h, L) {
  const sh = L.sh, zB = -d / 2, zF = d / 2, t = 0.024, xo = w / 2 - 0.028, zb = zB + t / 2 + 0.01, zf = zF - t / 2 - 0.01, ay = Math.min(h - 0.06, sh + clamp((h - sh) * 0.48, 0.04, 0.2));
  for (const s of [-1, 1]) {
    g.add(K.box(0.03, t, d, L.frame, s * xo, t / 2, 0), K.box(0.03, t, d - 0.04, L.frame, s * xo, sh - t / 2, 0));               // floor + seat rails
    g.add(K.boxOn(0.03, ay - sh, t, L.frame, s * xo, sh, zf), K.boxOn(0.03, h - sh, t, L.frame, s * xo, sh, zb));               // arm post + back post
    g.add(K.rbox(0.056, 0.02, d, L.frame, s * (w / 2 - 0.028), ay + 0.01, 0, 0.007, 1));
  }
  for (const z of [zb, zf]) for (const s of [-1, 1]) g.add(beam([s * xo, t, z], [-s * xo, sh - t, z], 0.03, 0.018, L.frame));
  g.add(K.box(2 * xo - 0.03, 0.006, d - 0.07, L.main, 0, sh - 0.006, 0));
  const bh = clamp((h - sh) * 0.36, 0.05, 0.19);
  g.add(K.box(2 * xo + 0.004, bh, 0.006, L.main, 0, h - bh / 2 - 0.012, zb - t / 2 - 0.001));
}

function chairAdirondack(g, w, d, h, L) {
  const zB = -d / 2, zF = d / 2, sh = L.sh, sb = sh * 0.62, aw = clamp(w * 0.17, 0.06, 0.14), ay = Math.min(h * 0.62, sh + clamp(h * 0.2, 0.04, 0.2)), pt = 0.022;
  const zsF = zF - clamp(d * 0.1, 0.02, 0.1), zsB = zB + d * 0.36, xi = w / 2 - aw * 0.75, M = L.main;
  for (const s of [-1, 1]) {
    g.add(K.box(aw, pt, d * 0.8, M, s * (w / 2 - aw / 2), ay - pt / 2, zF - d * 0.4));                                           // wide arm
    g.add(K.boxOn(0.028, ay - pt, 0.085, M, s * xi, 0, zsF - 0.04));                                                            // front leg
    g.add(beam([s * (xi - 0.028), sh - 0.045, zsF], [s * (xi - 0.028), 0.03, zB + 0.05], 0.026, 0.1, M));                       // stringer / rear leg
    g.add(K.boxOn(0.026, ay - pt, 0.06, M, s * (w / 2 - aw * 0.5), 0, zB + d * 0.24));                                          // arm support
  }
  const n = 5, sl = Math.hypot(zsF - zsB, sh - sb), ang = Math.atan2(sh - sb, zsF - zsB), sw = 2 * xi - 0.03;
  for (let i = 0; i < n; i++) { const f = (i + 0.5) / n, m = K.box(sw, pt, sl / n - 0.008, M, 0, lerp(sb, sh, f) - pt / 2, lerp(zsB, zsF, f)); m.rotation.x = -ang; g.add(m); }
  const nb = clamp(Math.round(sw / 0.1), 3, 7), bwid = sw / nb, y0 = sb - 0.03, zTop = zB + pt, lean = Math.atan2(zsB - zTop, h - y0);
  for (let i = 0; i < nb; i++) {
    const u = (i + 0.5) / nb * 2 - 1, top = h - (h - y0) * 0.16 * u * u, len = (top - y0) / Math.cos(lean), yc = (y0 + top) / 2, m = K.box(bwid - 0.008, len, pt, M, u * sw / 2, yc, lerp(zsB, zTop, (yc - y0) / (h - y0)) - pt * 0.2);
    m.rotation.x = -lean; g.add(m);
  }
  for (const f of [0.3, 0.72]) { const y = lerp(y0, h, f); g.add(K.box(sw, 0.06, pt, M, 0, y, lerp(zsB, zTop, f) - pt * 1.2).rotateX(-lean)); }
}

function buildChair(w, d, h, p) {
  const g = new THREE.Group(), L = chairLayout(w, d, h, p), v = L.variant;
  if (v === 'dining') { if (L.legs === 'metal' || L.legs === 'sled') chairPanels(g, w, d, h, L); else chairTimber(g, w, d, h, L); }
  else if (v === 'stacking') chairPanels(g, w, d, h, { ...L, legs: L.legs === 'sled' ? 'sled' : 'metal' });
  else if (v === 'shell') chairShell(g, w, d, h, L);
  else if (v === 'upholstered') { if (L.arms) chairShell(g, w, d, h, L); else chairPadded(g, w, d, h, L); }
  else if (v === 'folding') chairFolding(g, w, d, h, L);
  else if (v === 'cross-back') chairCrossBack(g, w, d, h, L);
  else if (v === 'cantilever') chairCantilever(g, w, d, h, L);
  else if (v === 'director') chairDirector(g, w, d, h, L);
  else chairAdirondack(g, w, d, h, L);
  return g;
}
registerModel('chair', {
  build({ w, d, h, p }) { w = dim(w, 0.48); d = dim(d, 0.52); h = dim(h, 0.82); return fit(buildChair(w, d, h, P(p)), w, d, h); },
  draw2d: sym((q, { w, d, h, p, det }) => {
    const L = chairLayout(w, d, h, p), v = L.variant, mh = matHex(L.main), sh = matHex(L.sec), fh = matHex(L.frame), zB = -d / 2, zF = d / 2;
    const seatF = tone(v === 'dining' ? sh : mh, 0.58), dark = tone(v === 'dining' || v === 'cross-back' ? mh : v === 'director' || v === 'cantilever' ? fh : mh, 0.3);
    if (v === 'adirondack') {
      const aw = clamp(w * 0.17, 0.06, 0.14);
      q.rr(-w / 2 + aw * 0.7, zB + d * 0.3, w / 2 - aw * 0.7, zF - d * 0.08, 0.01, tone(mh, 0.55));
      q.path((c) => { c.moveTo(-w / 2 + aw * 0.8, zB + d * 0.36); c.lineTo(-w / 2 + aw * 0.8, zB + 0.05); c.quadraticCurveTo(0, zB - 0.05, w / 2 - aw * 0.8, zB + 0.05); c.lineTo(w / 2 - aw * 0.8, zB + d * 0.36); c.closePath(); }, tone(mh, 0.38));
      if (det > 24) for (let i = 1; i < 5; i++) { const x = lerp(-w / 2 + aw * 0.8, w / 2 - aw * 0.8, i / 5); q.line(x, zB + 0.03, x, zF - d * 0.08, FAINT); }
      for (const s of [-1, 1]) q.rr(Math.min(s * w / 2, s * (w / 2 - aw)), zB + d * 0.2, Math.max(s * w / 2, s * (w / 2 - aw)), zF, 0.015, tone(mh, 0.3), INK, 0.8);
      return;
    }
    const shell = v === 'shell' || (v === 'upholstered' && L.arms), a = L.arms ? (shell ? 0.04 : 0.035) : 0, bz = zB + clamp(d * 0.16, 0.03, 0.09);
    if (shell) {                                               // wrap-around shell
      const zc = zB + Math.min(w / 2, d * 0.5), zE = L.arms ? zF - d * 0.22 : zc;
      q.rr(-w / 2 + 0.03, bz - 0.02, w / 2 - 0.03, zF, Math.min(w, d) * 0.28, seatF);
      q.path((c) => { c.moveTo(-w / 2, zE); c.lineTo(-w / 2, zc); c.ellipse(0, zc, w / 2, zc - zB, 0, PI, PI * 2); c.lineTo(w / 2, zE); c.lineTo(w / 2 - 0.035, zE); c.lineTo(w / 2 - 0.035, zc); c.ellipse(0, zc, w / 2 - 0.035, Math.max(zc - zB - 0.035, 0.01), 0, 0, PI, true); c.lineTo(-w / 2 + 0.035, zE); c.closePath(); }, tone(mh, 0.36), INK, 0.9);
      return;
    }
    q.rr(-w / 2 + a, bz - 0.01, w / 2 - a, zF, v === 'cross-back' ? Math.min(w, d) * 0.3 : v === 'folding' || v === 'director' ? 0.012 : 0.04, seatF);
    if (det < 12) return;
    if (v === 'director') { for (const s of [-1, 1]) q.rr(Math.min(s * w / 2, s * (w / 2 - 0.056)), zB, Math.max(s * w / 2, s * (w / 2 - 0.056)), zF, 0.008, dark, INK, 0.8); q.rr(-w / 2 + 0.05, zB + 0.004, w / 2 - 0.05, zB + 0.03, 0.004, tone(mh, 0.4), INK, 0.8); if (det > 30) { q.line(-w / 2 + 0.07, bz, w / 2 - 0.07, zF - 0.02, FAINT); q.line(w / 2 - 0.07, bz, -w / 2 + 0.07, zF - 0.02, FAINT); } return; }
    if (L.arms) for (const s of [-1, 1]) q.rr(Math.min(s * w / 2, s * (w / 2 - a)), bz - 0.01, Math.max(s * w / 2, s * (w / 2 - a)), zF - (v === 'cantilever' ? 0.1 : 0.01), 0.012, dark, INK, 0.8);
    const sag = v === 'folding' || v === 'cantilever' ? 0 : clamp(w * 0.05, 0.008, 0.028), bt = v === 'upholstered' ? 0.07 : v === 'cross-back' ? 0.03 : 0.028;
    q.band(w / 2 - (v === 'upholstered' ? 0.01 : 0.004), zB + sag, sag, bt, v === 'upholstered' ? tone(mh, 0.42) : tone(v === 'dining' ? mh : mh, 0.32), INK, 0.9);
    if (det > 34 && (v === 'dining' || v === 'cross-back') && !L.legs) for (const s of [-1, 1]) q.rr(s * (w / 2 - 0.02) - 0.014, zF - 0.034, s * (w / 2 - 0.02) + 0.014, zF - 0.006, 0.003, null, FAINT);
    if (det > 34 && (L.legs === 'sled' || v === 'cantilever')) for (const s of [-1, 1]) q.line(s * (w / 2 - 0.012), bz, s * (w / 2 - 0.012), zF - 0.01, FAINT, 1.5);
  }),
});

// ═════════════════════════ BAR STOOL ═════════════════════════
function stoolLayout(w, d, h, p) {
  const legs = pick(p.legs, ['wood', 'metal', 'pedestal'], 'metal'), back = flag(p.back, h > 0.84), hard = hardOf(p.material), soft = softOf(p.material);
  const seatH = back ? clamp(num(p.seatHeight, NaN) > 0 ? num(p.seatHeight, 0) / 100 : h - clamp(h * 0.28, 0.1, 0.3), h * 0.45, h - 0.06) : h;
  const woodSeat = !soft && (hard ? true : legs === 'wood');
  const seat = soft ? softMat(soft, C(p.color, '#9a6a45')) : hard ? hardMat(hard, C(p.color)) : legs === 'wood' ? hardMat('wood', C(p.color)) : K.leather(C(p.color, '#9a6a45'));
  const frame = legs === 'wood' ? (hard && !WOODY.has(hard) || soft ? hardMat('wood', C(p.color2)) : seat) : hardOf(p.material2) ? hardMat(p.material2, C(p.color2)) : legs === 'pedestal' ? (C(p.color2) ? K.metal(C(p.color2)) : K.chrome()) : metalMat(C(p.color2));
  const st = woodSeat ? clamp(seatH * 0.045, 0.02, 0.035) : clamp(seatH * 0.1, 0.03, 0.075);
  const round = legs === 'pedestal' || Math.abs(w - d) < 0.035;
  const sw = legs === 'pedestal' ? w : w - clamp(w * 0.12, 0.01, 0.06), sd = (legs === 'pedestal' ? d : d - clamp(d * 0.12, 0.01, 0.06)) - (back ? clamp(d * 0.06, 0, 0.03) : 0);
  return { legs, back, seatH, woodSeat, seat, frame, st, round, sw, sd, zc: (d - sd) / 2 - (legs === 'pedestal' ? 0 : (d - sd) / 2 - clamp(d * 0.06, 0, 0.03) * (back ? 1 : 0) / 1) * 0 };
}
registerModel('bar-stool', {
  build({ w, d, h, p }) {
    w = dim(w, 0.42); d = dim(d, 0.45); h = dim(h, 0.95); p = P(p);
    const g = new THREE.Group(), L = stoolLayout(w, d, h, p), { seatH, st, sw, sd, frame } = L, zB = -d / 2, zF = d / 2, zc = zF - sd / 2 - (L.legs === 'pedestal' ? 0 : (d - sd) * (L.back ? 0.25 : 0.5));
    const y1 = seatH - st, fy = clamp(seatH - 0.45, seatH * 0.25, seatH * 0.5);
    g.add(L.round ? puck(sw / 2, sd / 2, st, L.seat, 0, seatH - st / 2, zc, L.woodSeat ? 0.008 : st * 0.42, L.woodSeat ? 0 : 0.01) : cush(sw, st, sd, L.seat, 0, seatH - st / 2, zc, L.woodSeat ? 0.008 : st * 0.42, Math.min(sw, sd) * 0.22, L.woodSeat ? 0 : 0.01));
    if (L.legs === 'pedestal') {
      const R = Math.min(w, d) / 2, cy = zc;
      g.add(at(puckGeo(R, 0.024, 0.008, 0.008), frame, 0, 0.012, cy), K.cylOn(0.028, 0.032, y1 * 0.6, frame, 0, 0.02, cy, 20), K.cylOn(0.018, 0.018, y1 * 0.4 + 0.004, K.chrome(), 0, 0.02 + y1 * 0.6 - 0.01, cy, 16));
      g.add(K.cylOn(Math.min(sw, sd) * 0.3, 0.03, 0.03, K.metal('#26272b'), 0, y1 - 0.028, cy, 20));
      const fr = clamp(R * 0.8, 0.05, 0.19), ring = at(memo(`fr|${mm(fr)}`, () => new THREE.TorusGeometry(fr, 0.009, 8, 36)), frame, 0, fy, cy); ring.rotation.x = PI / 2; g.add(ring);
      g.add(strut([0, fy - 0.03, cy - 0.02], [0, fy, cy + fr], 0.007, 0.007, frame, 8));
    } else {
      const wood = L.legs === 'wood', rb = wood ? 0.014 : 0.01, rt = wood ? 0.019 : 0.01, xt = sw / 2 - Math.min(0.05, sw * 0.16), zt = [zc - sd / 2 + Math.min(0.05, sd * 0.16), zc + sd / 2 - Math.min(0.05, sd * 0.16)], bot = { x: w / 2 - rb - 0.002, z: [zB + rb + 0.002, zF - rb - 0.002] };
      splayLegs(g, { x: xt, z: zt }, bot, y1 + 0.004, rt, rb, frame);
      const k = 1 - fy / y1, fx = lerp(xt, bot.x, k), fz = [lerp(zt[0], bot.z[0], k), lerp(zt[1], bot.z[1], k)], rr = wood ? 0.009 : 0.007;
      g.add(strut([-fx, fy, fz[1]], [fx, fy, fz[1]], rr * 1.15, rr * 1.15, frame, 8), strut([-fx, fy + 0.06, fz[0]], [fx, fy + 0.06, fz[0]], rr, rr, frame, 8));
      for (const s of [-1, 1]) g.add(strut([s * fx, fy + 0.03, fz[0]], [s * fx, fy + 0.03, fz[1]], rr, rr, frame, 8));
      if (!wood) g.add(K.box(2 * xt + 0.02, 0.008, zt[1] - zt[0] + 0.02, frame, 0, y1 - 0.004, (zt[0] + zt[1]) / 2));
    }
    if (L.back) {
      const bh = clamp((h - seatH) * 0.55, 0.04, 0.2), sag = clamp(sw * 0.1, 0.01, 0.04), hw = sw / 2 - 0.02, zr = zB + sag + 0.008, soft = !L.woodSeat;
      g.add(backRail(hw, zr, sag, soft ? 0.035 : 0.014, h - bh, h, L.seat, false, soft ? 0.015 : 0.006));
      const postM = L.legs === 'wood' ? frame : frame, zs = zc - sd / 2 + 0.03;
      for (const s of [-1, 1]) g.add(strut([s * (hw - 0.03), y1 + 0.004, zs], [s * (hw - 0.025), h - bh * 0.5, zr - sag * 0.2 + 0.004], L.legs === 'wood' ? 0.011 : 0.008, L.legs === 'wood' ? 0.011 : 0.008, postM, 8));
    }
    return fit(g, w, d, h);
  },
  draw2d: sym((q, { w, d, h, p, det }) => {
    const L = stoolLayout(w, d, h, p), sh = matHex(L.seat), fh = matHex(L.frame), zc = d / 2 - L.sd / 2 - (L.legs === 'pedestal' ? 0 : (d - L.sd) * (L.back ? 0.25 : 0.5));
    if (L.legs === 'pedestal') q.ellipse(0, zc, Math.min(w, d) / 2 * 0.82, Math.min(w, d) / 2 * 0.82, null, FAINT);
    else if (det > 18) for (const sx of [-1, 1]) for (const sz of [-1, 1]) q.ellipse(sx * (w / 2 - 0.014), sz * (d / 2 - 0.014), 0.012, 0.012, tone(fh, 0.3), INK, 0.7);
    if (L.round) q.ellipse(0, zc, L.sw / 2, L.sd / 2, tone(sh, 0.55)); else q.rr(-L.sw / 2, zc - L.sd / 2, L.sw / 2, zc + L.sd / 2, Math.min(L.sw, L.sd) * 0.22, tone(sh, 0.55));
    if (L.back) { const sag = clamp(L.sw * 0.1, 0.01, 0.04); q.band(L.sw / 2 - 0.02, -d / 2 + sag, sag, 0.03, tone(sh, 0.32), INK, 0.9); }
    if (det > 40 && L.legs === 'pedestal') q.ellipse(0, zc, 0.02, 0.02, null, FAINT);
  }),
});

// ═════════════════════════ OFFICE CHAIR ═════════════════════════
function officeLayout(w, d, h, p) {
  const variant = pick(p.variant, ['task', 'executive', 'gaming', 'mesh'], 'task'), arms = flag(p.arms, true), headrest = flag(p.headrest, variant === 'gaming');
  const R = Math.max(0.05, Math.min(d / 2 - 0.03, (w / 2 - 0.035) / 0.951)), zc = Math.max(0, d / 2 - 0.03 - R) * 0.5;
  const sh = clamp(h * 0.42, 0.1, 0.52), sw = Math.min(w - (arms ? 0.1 : 0.02), 0.54), sd = Math.min(d * 0.76, 0.5);
  const up = softMat(p.material, C(p.color, '#2f3237')), dark = K.plastic(C(p.color2 && variant !== 'gaming' ? p.color2 : null, '#202124'));
  const accent = K.byMaterial(softOf(p.material) || 'fabric', C(p.color2, variant === 'gaming' ? '#b93a32' : K.shade(matHex(up), 0.15)));
  return { variant, arms, headrest, R, zc, sh, sw, sd, up, dark, accent };
}
registerModel('office-chair', {
  build({ w, d, h, p }) {
    w = dim(w, 0.62); d = dim(d, 0.62); h = dim(h, 1.15); p = P(p);
    const g = new THREE.Group(), L = officeLayout(w, d, h, p), { R, zc, sh, sw, sd, up, dark, variant: v } = L, chrome = K.chrome(), zB = -d / 2;
    const cr = Math.min(0.028, h * 0.03), st = clamp(sh * 0.2, 0.03, v === 'executive' || v === 'gaming' ? 0.11 : 0.085);
    // star base, castors, gas lift
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * PI * 2, sx = Math.sin(a), sz = Math.cos(a);
      g.add(beam([0, cr * 2 + 0.035, zc], [sx * R, cr * 2 + 0.012, zc + sz * R], 0.04, 0.026, dark));
      const wh = K.cyl(cr, cr, 0.05, K.plastic('#18191b'), sx * R, cr, zc + sz * R, 14); wh.rotation.set(0, a, PI / 2); wh.rotation.order = 'YXZ'; g.add(wh);
      g.add(K.cylOn(0.008, 0.008, cr + 0.02, dark, sx * R, cr, zc + sz * R, 8));
    }
    const hubTop = cr * 2 + 0.06, seatB = sh - st;
    g.add(K.cylOn(0.04, 0.05, 0.07, dark, 0, cr * 2 - 0.005, zc, 16), K.cylOn(0.026, 0.03, (seatB - hubTop) * 0.55, dark, 0, hubTop - 0.01, zc, 16), K.cylOn(0.014, 0.014, (seatB - hubTop) * 0.5 + 0.01, chrome, 0, hubTop + (seatB - hubTop) * 0.5 - 0.02, zc, 12));
    g.add(K.rbox(sw * 0.5, 0.035, sd * 0.6, dark, 0, seatB - 0.02, zc, 0.01, 1));
    // seat
    const zs = zc + 0.01;
    g.add(cush(sw, st, sd, up, 0, sh - st / 2, zs, st * 0.42, 0.07, 0.012));
    if (v === 'gaming') for (const s of [-1, 1]) g.add(cush(0.07, st * 0.9, sd * 0.86, L.accent, s * (sw / 2 - 0.03), sh - st * 0.3, zs, 0.028, 0.03, 0.01));
    // back
    const by0 = sh + clamp((h - sh) * 0.12, 0.02, 0.1), top = L.headrest && v !== 'gaming' && v !== 'executive' ? h - clamp((h - sh) * 0.26, 0.05, 0.2) : h, bw = sw * (v === 'executive' || v === 'gaming' ? 0.98 : 0.9);
    const zs0 = zs - sd / 2, lean = 0.1, zAt = (y) => lerp(zs0 + 0.02, zB + 0.03, (y - sh) / Math.max(h - sh, 0.01));
    g.add(beam([0, seatB - 0.02, zc - sd * 0.25], [0, by0 + (top - by0) * 0.3, zAt(by0 + (top - by0) * 0.3) - 0.012], 0.06, 0.02, dark));
    const sag = clamp(bw * 0.09, 0.01, 0.045);
    const panel = (y0, y1, tu, m, r, hw = bw / 2) => { const mesh = backRail(hw, 0, sag, tu, 0, y1 - y0, m, false, r); mesh.rotation.x = -lean; mesh.position.set(0, y0, zAt(y0) + sag + tu / 2 - 0.004); return mesh; };
    if (v === 'mesh') {
      const meshM = K.mat(matHex(up), { opacity: 0.62, roughness: 0.9 }), fr = 0.011, H = top - by0, hw = bw / 2;
      g.add(noShadow(panel(by0, top, 0.006, meshM, 0.0025)));
      const loop = (y) => Array.from({ length: 9 }, (_, i) => { const x = lerp(-hw, hw, i / 8); return [x, y, -sag * (1 - (x / hw) ** 2)]; });
      const frame = new THREE.Group(); frame.add(tube(roundPath([...loop(0), ...loop(H).reverse()], 0.04, 3, true), fr, dark, { closed: true }), tube(loop(H * 0.3).map(([x, y, z]) => [x, y, z - 0.012]), 0.012, dark));
      frame.rotation.x = -lean; frame.position.set(0, by0, zAt(by0) + sag + 0.003); g.add(frame);
    } else if (v === 'executive') {
      const n = clamp(Math.round((top - by0) / 0.17), 2, 5), H = (top - by0) / n;
      for (let i = 0; i < n; i++) g.add(panel(by0 + H * i + 0.003, by0 + H * (i + 1) - 0.003, 0.085, up, 0.036));
    } else if (v === 'gaming') {
      g.add(panel(by0, top, 0.07, up, 0.03, bw / 2 - 0.05));
      for (const s of [-1, 1]) { const y = by0 + (top - by0) * 0.5, m = cush(0.085, 0.09, (top - by0) * 0.96, L.accent, s * (bw / 2 - 0.035), y, zAt(y) + 0.045, 0.035, 0.04, 0.012); m.rotation.set(PI / 2 - lean, 0, -s * 0.5); m.rotation.order = 'XYZ'; g.add(m); }
      const yh = top - (top - by0) * 0.16, yl = by0 + (top - by0) * 0.16;
      g.add(leaned(bw * 0.5, 0.06, (top - by0) * 0.16, L.accent, 0, yh, zAt(yh) + 0.07, lean, 0.025, 0.04, 0.012), leaned(bw * 0.56, 0.07, (top - by0) * 0.16, L.accent, 0, yl, zAt(yl) + 0.075, lean, 0.03, 0.04, 0.014));
    } else g.add(panel(by0, top, 0.055, up, 0.024));
    if (L.headrest && v !== 'gaming' && v !== 'executive') {
      const hy0 = top + clamp((h - top) * 0.2, 0.005, 0.04);
      g.add(beam([0, top - 0.06, zAt(top - 0.06) - 0.01], [0, hy0 + 0.03, zAt(hy0) - 0.006], 0.035, 0.012, dark));
      const hr = backRail(bw * 0.3, 0, sag * 0.4, 0.05, 0, h - hy0, v === 'mesh' ? dark : up, false, 0.022); hr.rotation.x = -lean * 0.5; hr.position.set(0, hy0, zB + 0.028 + sag * 0.4 + (h - hy0) * Math.sin(lean * 0.5)); g.add(hr);
    }
    // arms
    if (L.arms) {
      const ay = sh + clamp((h - sh) * 0.3, 0.04, 0.22), ax = w / 2 - 0.03, al = clamp(sd * 0.55, 0.08, 0.27), az = zs - sd * 0.08;
      for (const s of [-1, 1]) {
        if (v === 'executive') g.add(tube(roundPath([[s * (sw / 2 - 0.02), seatB + 0.01, zs + sd * 0.18], [s * ax, seatB + 0.03, zs + sd * 0.2], [s * ax, ay - 0.012, az + al / 2 - 0.01], [s * ax, ay - 0.012, az - al / 2 + 0.01], [s * ax, seatB + 0.03, zs - sd * 0.3], [s * (sw / 2 - 0.02), seatB + 0.01, zs - sd * 0.28]], 0.035, 3), 0.012, chrome));
        else g.add(K.box(ax - sw / 2 + 0.06, 0.018, 0.05, dark, s * (ax + sw / 2 - 0.06) / 2, seatB - 0.004, az), K.boxOn(0.024, ay - seatB - 0.012, 0.045, dark, s * ax, seatB - 0.012, az));
        g.add(K.rbox(0.06, 0.026, al, v === 'executive' ? up : dark, s * ax, ay, az, 0.011, 2));
      }
    }
    return fit(g, w, d, h);
  },
  draw2d: sym((q, { w, d, h, p, det }) => {
    const L = officeLayout(w, d, h, p), uh = matHex(L.up), zs = L.zc + 0.01, zB = -d / 2;
    if (det > 16) for (let i = 0; i < 5; i++) { const a = (i / 5) * PI * 2, x = Math.sin(a) * L.R, z = L.zc + Math.cos(a) * L.R; q.line(0, L.zc, x, z, FAINT, 1.6); q.ellipse(x, z, 0.022, 0.022, '#ffffff', FAINT); }
    q.rr(-L.sw / 2, zs - L.sd / 2, L.sw / 2, zs + L.sd / 2, 0.08, tone(uh, 0.5));
    if (det < 12) return;
    if (L.arms) for (const s of [-1, 1]) q.rr(Math.min(s * w / 2, s * (w / 2 - 0.06)), zs - L.sd * 0.36, Math.max(s * w / 2, s * (w / 2 - 0.06)), zs + L.sd * 0.2, 0.02, tone('#3a3c40', 0.45), INK, 0.8);
    const sag = clamp(L.sw * 0.08, 0.01, 0.045), bw = L.sw * (L.variant === 'executive' || L.variant === 'gaming' ? 0.98 : 0.9);
    q.band(bw / 2, zB + sag + 0.004, sag, L.variant === 'mesh' ? 0.03 : 0.065, tone(uh, L.variant === 'mesh' ? 0.6 : 0.3), INK, 0.9);
    if (L.headrest && det > 30) q.band(bw * 0.28, zB + sag * 0.5, sag * 0.5, 0.035, tone(uh, 0.2), INK, 0.7);
  }),
});

// ═════════════════════════ TABLE ═════════════════════════
const TOP_KINDS = ['wood', 'glass', 'stone', 'laminate', 'metal', 'ceramic', 'teak', 'aluminium', 'lacquer', 'concrete', 'plastic', 'rattan'];
const TOP_DEFAULT = { stone: '#e9e6e0', ceramic: '#d9d6d0', laminate: '#f2efe8', lacquer: '#f3f1ec', concrete: '#b9b6b0', plastic: '#f1f1f1' };
/** Resolve shape, base, materials and member sizes of a table; shared by builder and symbol. */
function tableLayout(w, d, h, p) {
  let shape = pick(p.shape, ['rect', 'round', 'oval', 'square'], 'rect');
  const round = shape === 'round' || shape === 'oval';
  const explicitTop = pick(p.top, TOP_KINDS, null), mat1 = hardOf(p.material), split = explicitTop && mat1 && mat1 !== explicitTop;   // split: `material/color` describe the base
  let topKind = explicitTop || (mat1 && TOP_KINDS.includes(mat1) ? mat1 : 'wood');
  if (topKind === 'rattan') topKind = 'glass';
  const topCol = C(p.topColor) || (split || topKind === 'glass' ? undefined : C(p.color)) || TOP_DEFAULT[topKind];
  const topM = topKind === 'glass' ? K.glass(C(p.topColor) || '#cfe3ea', 0.3) : hardMat(topKind, topCol);
  const baseKind = hardOf(p.material2) || (split ? mat1 : mat1 === 'rattan' ? 'rattan' : topKind === 'wood' || topKind === 'teak' ? topKind : topKind === 'aluminium' ? 'aluminium' : topKind === 'laminate' || topKind === 'lacquer' || topKind === 'plastic' ? (mat1 ? topKind : 'wood') : 'metal');
  const metalBase = baseKind === 'metal' || baseKind === 'aluminium';
  let base = pick(p.base, ['legs', 'pedestal', 'trestle', 'x', 'sled', 'panel', 'hairpin'], 'legs');
  if (round && (base === 'sled' || base === 'trestle' || base === 'x')) base = 'pedestal';
  const forceMetal = (base === 'hairpin' || base === 'sled') && !hardOf(p.material2) && !(split && metalBase);
  const baseCol = C(p.color2) || (split ? C(p.color) : forceMetal ? undefined : (baseKind === topKind && topKind !== 'glass') || (WOODY.has(baseKind) && WOODY.has(topKind)) ? topCol : baseKind === 'aluminium' ? C(p.color) : undefined);
  const baseM = forceMetal ? metalMat(C(p.color2)) : metalBase ? (baseKind === 'aluminium' ? hardMat('aluminium', baseCol) : metalMat(baseCol)) : hardMat(baseKind, baseCol);
  const metal = forceMetal || metalBase, mx = Math.max(w, d), low = h < 0.52;
  const tt = Math.min(h * 0.3, topKind === 'glass' ? (mx > 1.2 ? 0.012 : 0.01) : topKind === 'stone' || topKind === 'concrete' ? clamp(0.012 + mx * 0.008, 0.015, 0.03) : topKind === 'ceramic' ? 0.012 : topKind === 'metal' || topKind === 'aluminium' ? clamp(0.004 + mx * 0.005, 0.006, 0.02) : clamp(0.014 + mx * 0.0105, 0.018, 0.04));
  const lt = clamp((0.02 + mx * 0.02) * (low ? 0.8 : 1) * (metal ? 0.6 : 1), metal ? 0.016 : 0.026, metal ? 0.05 : 0.075);
  const slatted = (topKind === 'teak' || topKind === 'aluminium') && !round && Math.min(w, d) > 0.35;
  const nest = clamp(Math.round(num(p.nest, 1)), 1, 4);
  return { shape, round, topKind, topM, baseM, baseKind, metal, base, tt, lt, slatted, low, nest, shelf: flag(p.shelf), ext: flag(p.extendable), topHex: topKind === 'glass' ? '#cfe6ee' : matHex(topM), baseHex: matHex(baseM) };
}
/** Footprints of the individual tables of a nest (one entry when not nested): { x, z, w, d, h }. */
function nestBoxes(w, d, h, L) {
  if (L.nest < 2) return [{ x: 0, z: 0, w, d, h }];
  const n = L.nest, out = [];
  if (L.round) {
    const D1 = Math.min(d, w * (n === 2 ? 0.72 : 0.62), w), diag = d > D1 + 0.005;
    for (let i = 0; i < n; i++) {
      const D = D1 * 0.74 ** i, f = i / (n - 1), x0 = -w / 2 + D1 / 2, x1 = w / 2 - D1 * 0.74 ** (n - 1) / 2, z0 = diag ? -d / 2 + D1 / 2 : 0, z1 = diag ? d / 2 - D1 * 0.74 ** (n - 1) / 2 : 0;
      out.push({ x: lerp(x0, x1, f), z: lerp(z0, z1, f), w: D, d: D, h: h * (1 - 0.16 * i) });
    }
  } else {
    const w1 = w * (n === 2 ? 0.8 : 0.7), step = 2 * L.lt + 0.03;
    for (let i = 0; i < n; i++) { const wi = Math.max(w1 - step * i, w1 * 0.4), right = -w / 2 + w1 + (w - w1) * i / (n - 1); out.push({ x: right - wi / 2, z: 0, w: wi, d: Math.max(d - step * i, d * 0.4), h: Math.max(h - (L.tt + 0.03) * i, h * 0.5) }); }
  }
  return out;
}
/** Smooth tulip pedestal (lathe). */
function pedestal(rb, rs, rt, H, material, x, z) {
  const geo = memo(`ped|${mm(rb)}|${mm(rs)}|${mm(rt)}|${mm(H)}`, () => {
    const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(rb, 0), new THREE.Vector2(rb, Math.min(0.012, H * 0.05))];
    for (let i = 1; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(rs + (rb - rs) * (1 - t) ** 6 * 0.9 + (rt - rs) * t ** 7, lerp(Math.min(0.016, H * 0.06), H, t))); }
    pts.push(new THREE.Vector2(0, H));
    return new THREE.LatheGeometry(pts, 28);
  });
  return at(geo, material, x, 0, z);
}
/** One table inside its own w × d × h box centred on (cx, cz). */
function oneTable(g, L, w, d, h, cx, cz, primary) {
  const { tt, lt, baseM, topM, metal } = L, hb = h - tt, add = (...m) => m.forEach((o) => { o.position.x += cx; o.position.z += cz; g.add(o); });
  const glass = L.topKind === 'glass';
  // top
  if (L.slatted) {
    const n = clamp(Math.round(d / 0.1), 3, 14), pw = d / n;
    for (let i = 0; i < n; i++) add(K.box(w, tt, pw - 0.006, topM, 0, h - tt / 2, -d / 2 + pw * (i + 0.5)));
  } else {
    const top = plate(L.round ? 'round' : 'rect', w, d, tt, topM, 0, h - tt / 2, 0, glass ? 0.012 : L.topKind === 'wood' ? Math.min(0.012, w * 0.02) : 0.005);
    add(glass ? noShadow(top) : top);
  }
  if (L.ext && primary && !L.round && !glass && w > 1) for (const s of [-1, 1]) add(K.box(0.003, 0.0006, d - 0.008, K.mat('#1b1a19', { roughness: 0.9 }), s * w * 0.17, h + 0.0001, 0));
  if (L.topKind === 'ceramic') add(K.box(w - 0.04, 0.02, d - 0.04, baseM, 0, hb - 0.01, 0));
  const yT = hb - (L.topKind === 'ceramic' ? 0.02 : 0), inset = L.round ? 0 : clamp(Math.min(w, d) * 0.04, 0.008, metal ? 0.03 : 0.05);
  const shelfY = clamp(h * 0.3, 0.08, 0.24), leg = (x, z, hh, y0 = 0) => (L.round && !metal ? K.cylOn(lt * 0.55, lt * 0.38, hh, baseM, x, y0, z, 14) : K.boxOn(lt, hh, lt, baseM, x, y0, z));
  let shelf = null;                                             // [w, d] of the lower shelf, if the base supports one
  switch (L.base) {
    case 'pedestal': {
      const two = !L.round && w > 1.5 && w / d > 1.6 || (L.shape === 'oval' && w > 2.3), mn = Math.min(two ? w * 0.36 : w, d);
      const rb = clamp(mn * (L.round ? 0.3 : 0.34), 0.07, 0.4), rs = clamp(rb * 0.2, 0.022, 0.07), rt = clamp(rb * 0.6, rs, 0.22);
      for (const x of two ? [-w * 0.27, w * 0.27] : [0]) add(pedestal(rb, rs, rt, yT, baseM, x, 0));
      if (two) add(K.box(w * 0.54, Math.min(0.06, h * 0.1), 0.05, baseM, 0, yT - Math.min(0.03, h * 0.05), 0));
      break;
    }
    case 'trestle': {
      const x0 = w / 2 - clamp(w * 0.14, 0.06, 0.32), s = lt * 0.8, zf = d / 2 - s / 2 - 0.02, zt = Math.min(zf, d * 0.16), yb = clamp(h * 0.28, 0.06, 0.24), kb = 1 - yb / yT;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) add(beam([sx * x0, 0.002, sz * zf], [sx * x0, yT - s * 0.5, sz * zt], s, s, baseM));
        add(K.box(s, s, Math.min(d - 0.04, zf * 2 + s), baseM, sx * x0, yT - s / 2, 0), K.box(s * 0.8, s * 0.8, 2 * lerp(zt, zf, kb), baseM, sx * x0, yb, 0));
      }
      add(K.box(2 * x0, s * 0.8, s * 0.8, baseM, 0, yb, 0));
      break;
    }
    case 'x': {
      const x0 = w / 2 - clamp(w * 0.12, 0.05, 0.3), s = metal ? lt * 0.9 : lt, zf = d / 2 - s * 0.7 - 0.01;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) add(beam([sx * x0 + sz * s * 0.02, s * 0.3, sz * zf], [sx * x0 + sz * s * 0.02, yT - s * 0.3, -sz * zf], s * (metal ? 0.5 : 0.9), s * 1.15, baseM));
        add(K.box(s * 1.05, Math.min(s, 0.05), d - 0.03, baseM, sx * x0, yT - Math.min(s, 0.05) / 2, 0), K.box(s * 1.05, Math.min(s, 0.04), d - 0.03, baseM, sx * x0, Math.min(s, 0.04) / 2, 0));
      }
      add(K.box(2 * x0, s * 0.9, s * 0.9, baseM, 0, yT / 2, 0));
      break;
    }
    case 'sled': {
      const x0 = w / 2 - lt / 2 - inset, s = Math.max(lt * 0.5, 0.012), dz = d - 2 * inset;
      for (const sx of [-1, 1]) {
        add(K.box(lt, s, dz, baseM, sx * x0, s / 2, 0), K.box(lt, s, dz, baseM, sx * x0, yT - s / 2, 0));
        for (const sz of [-1, 1]) add(K.boxOn(lt, yT - s, s, baseM, sx * x0, s / 2, sz * (dz / 2 - s / 2)));
      }
      if (w > 1.3) add(K.box(2 * x0, s, lt, baseM, 0, yT - s / 2, 0));
      shelf = [2 * x0 - lt, dz - 0.04];
      break;
    }
    case 'panel': {
      const pt = clamp(tt * 1.15, 0.022, 0.05);
      if (L.round) for (const r of [0, PI / 2]) { const m = K.boxOn(Math.min(w, d) * 0.72, yT, pt, baseM, 0, 0, 0); m.rotation.y = r + PI / 4; add(m); }
      else {
        for (const sx of [-1, 1]) add(K.boxOn(pt, yT, d - 0.004, baseM, sx * (w / 2 - pt / 2 - 0.002), 0, 0));
        add(K.box(w - 2 * pt, clamp(h * 0.18, 0.04, 0.14), 0.02, baseM, 0, yT - clamp(h * 0.18, 0.04, 0.14) / 2, 0));
        shelf = [w - 2 * pt - 0.004, d - 0.06];
      }
      break;
    }
    case 'hairpin': {
      const r = clamp(lt * 0.22, 0.004, 0.007), xb = w / 2 - Math.max(inset, 0.02) - r, zb = d / 2 - Math.max(inset, 0.02) - r, sp = clamp(Math.min(w, d) * 0.16, 0.03, 0.1);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        add(tube(roundPath([[sx * (xb - sp), yT, sz * zb], [sx * xb, r, sz * zb], [sx * xb, yT, sz * (zb - sp)]], 0.014, 3), r, baseM, { radial: 6 }));
        add(K.box(sp + 0.03, 0.004, sp + 0.03, baseM, sx * (xb - sp / 2), yT - 0.002, sz * (zb - sp / 2)));
      }
      break;
    }
    default: {                                                  // four legs (+ apron)
      if (L.round) {
        const k = 0.36, kb = metal ? 0.36 : 0.43, three = Math.max(w, d) < 0.62, n = three ? 3 : 4, rtp = metal ? lt * 0.45 : lt * 0.55;
        for (let i = 0; i < n; i++) { const a = (i / n) * PI * 2 + (three ? PI / 2 : PI / 4), c = Math.cos(a), s = Math.sin(a), tilt = (kb - k) * Math.max(w, d) / Math.max(yT, 0.01); add(strut([c * w * kb, rtp * 0.7 * Math.min(tilt, 1), s * d * kb], [c * w * k, yT, s * d * k], rtp * (metal ? 1 : 0.7), rtp, baseM, 12)); }
        if (!glass) add(K.cylOn(Math.min(w, d) * (k + 0.03), Math.min(w, d) * (k + 0.03), Math.min(0.03, h * 0.06), baseM, 0, yT - Math.min(0.03, h * 0.06), 0, 28).translateX(0));
        else for (let i = 0; i < n; i++) { const a = (i / n) * PI * 2 + (three ? PI / 2 : PI / 4), b = ((i + 1) / n) * PI * 2 + (three ? PI / 2 : PI / 4); add(strut([Math.cos(a) * w * k, yT - rtp, Math.sin(a) * d * k], [Math.cos(b) * w * k, yT - rtp, Math.sin(b) * d * k], rtp * 0.7, rtp * 0.7, baseM, 8)); }
        if (g.children.length && !glass) g.children[g.children.length - 1].scale.z = d / w > 1 ? 1 : d / w;
        shelf = [w * 0.62, d * 0.62];
      } else {
        const x0 = w / 2 - lt / 2 - inset, z0 = d / 2 - lt / 2 - inset, ah = glass || L.low ? clamp(h * 0.08, 0.02, 0.04) : clamp(h * 0.11, 0.03, metal ? 0.05 : 0.09), at2 = metal ? Math.min(lt * 0.6, 0.02) : 0.02;
        const xs = w > 2.7 ? [-x0, 0, x0] : [-x0, x0];
        for (const x of xs) for (const sz of [-1, 1]) add(leg(x, sz * z0, yT));
        for (const sz of [-1, 1]) add(K.box(2 * x0 - lt, ah, at2, baseM, 0, yT - ah / 2, sz * z0));
        for (const sx of [-1, 1]) add(K.box(at2, ah, 2 * z0 - lt, baseM, sx * x0, yT - ah / 2, 0));
        shelf = [2 * x0 - lt * 0.2, 2 * z0 - lt * 0.2];
      }
    }
  }
  if (L.shelf && shelf && h > 0.25) add(plate(L.round ? 'round' : 'rect', shelf[0], shelf[1], Math.min(tt, 0.022), glass ? baseM : topM, 0, shelfY, 0, 0.004));
}
registerModel('table', {
  build({ w, d, h, p }) {
    w = dim(w, 1.6); d = dim(d, 0.9); h = dim(h, 0.75); p = P(p);
    const g = new THREE.Group(), L = tableLayout(w, d, h, p);
    nestBoxes(w, d, h, L).forEach((b, i) => oneTable(g, L, b.w, b.d, b.h, b.x, b.z, i === 0));
    return fit(g, w, d, h);
  },
  draw2d: sym((q, { w, d, h, p, det }) => {
    const L = tableLayout(w, d, h, p), glass = L.topKind === 'glass', fill = glass ? 'rgba(206,229,236,0.72)' : tone(L.topHex, 0.5), legF = tone(L.baseHex, 0.25);
    const boxes = nestBoxes(w, d, h, L);
    boxes.slice().reverse().forEach((b) => {
      const c = q.ctx; c.save(); c.translate(b.x, b.z);
      const bw = b.w, bd = b.d, k = Math.min(bw, bd) / q.px, cr = glass ? 0.012 : 0.008;
      if (L.round) q.ellipse(0, 0, bw / 2, bd / 2, fill); else q.rr(-bw / 2, -bd / 2, bw / 2, bd / 2, cr, fill);
      if (k > 22) {
        const i = clamp(Math.min(bw, bd) * 0.05, 0.012, 0.04);
        if (L.slatted && k > 60) { const n = clamp(Math.round(bd / 0.1), 3, 14); for (let j = 1; j < n; j++) q.line(-bw / 2, lerp(-bd / 2, bd / 2, j / n), bw / 2, lerp(-bd / 2, bd / 2, j / n), FAINT, 0.8); }
        else if (L.round) q.ellipse(0, 0, bw / 2 - i, bd / 2 - i, null, FAINT, 0.8); else q.rr(-bw / 2 + i, -bd / 2 + i, bw / 2 - i, bd / 2 - i, cr, null, FAINT, 0.8);
        // base hint
        const li = clamp(Math.min(bw, bd) * 0.04, 0.008, 0.05) + L.lt / 2, lx = bw / 2 - li, lz = bd / 2 - li, s = Math.max(L.lt, 0.02);
        if (L.base === 'pedestal') { const two = !L.round && bw > 1.5 && bw / bd > 1.6 || (L.shape === 'oval' && bw > 2.3); for (const x of two ? [-bw * 0.27, bw * 0.27] : [0]) q.ellipse(x, 0, Math.min(two ? bw * 0.36 : bw, bd) * 0.3, Math.min(two ? bw * 0.36 : bw, bd) * 0.3, null, FAINT, 0.8); }
        else if (L.base === 'legs' && L.round) { const three = Math.max(bw, bd) < 0.62, n = three ? 3 : 4; for (let j = 0; j < n; j++) { const a = (j / n) * PI * 2 + (three ? PI / 2 : PI / 4); q.ellipse(Math.cos(a) * bw * 0.4, Math.sin(a) * bd * 0.4, s * 0.5, s * 0.5, glass ? legF : null, FAINT, 0.8); } }
        else if (L.base === 'legs' || L.base === 'hairpin') for (const sx of [-1, 1]) for (const sz of [-1, 1]) q.rr(sx * lx - s / 2, sz * lz - s / 2, sx * lx + s / 2, sz * lz + s / 2, 0.003, glass ? legF : null, FAINT, 0.8);
        else if (!L.round) for (const sx of [-1, 1]) { const x = sx * (bw / 2 - (L.base === 'panel' ? 0.02 : clamp(bw * 0.13, 0.05, 0.3))); q.rr(x - s / 2, -bd / 2 + 0.02, x + s / 2, bd / 2 - 0.02, 0.003, glass ? legF : null, FAINT, 0.8); }
        if (L.ext && !L.round && !glass && bw > 1 && b === boxes[0]) for (const sx of [-1, 1]) q.line(sx * bw * 0.17, -bd / 2, sx * bw * 0.17, bd / 2, FAINT);
        if (glass && k > 40) for (const o of [-0.06, 0.02]) q.line(bw * (0.1 + o), -bd * 0.3, bw * (0.3 + o), -bd * 0.42 + bd * 0.02, 'rgba(255,255,255,0.9)', 1.6);
        if ((L.topKind === 'stone' || L.topKind === 'ceramic') && k > 70) q.path((cc) => { cc.moveTo(-bw * 0.4, bd * 0.1); cc.bezierCurveTo(-bw * 0.15, -bd * 0.12, bw * 0.05, bd * 0.26, bw * 0.38, -bd * 0.1); cc.moveTo(-bw * 0.1, -bd * 0.36); cc.quadraticCurveTo(bw * 0.05, -bd * 0.2, bw * 0.28, -bd * 0.34); }, null, 'rgba(38,40,46,0.16)', 0.8);
      }
      c.restore();
    });
  }),
});

// ═════════════════════════ DESK ═════════════════════════
function deskLayout(w, d, h, p) {
  const drawers = pick(p.drawers, ['none', 'left', 'right', 'both'], 'none'), base = pick(p.base, ['legs', 'panel', 'trestle', 'sit-stand'], 'legs'), hutch = flag(p.hutch), corner = flag(p.corner);
  const side = p.side === 'left' ? -1 : 1;                      // side of the return of an L-shaped desk
  const mat1 = hardOf(p.material), topM = hardMat(mat1 || 'wood', C(p.color, mat1 && !WOODY.has(mat1) ? undefined : '#d6bf9c'));
  const metalBase = base === 'sit-stand' || p.material2 === 'metal' || p.material2 === 'aluminium';
  const baseM = metalBase ? (hardOf(p.material2) && base !== 'sit-stand' ? hardMat(p.material2, C(p.color2)) : metalMat(C(p.color2))) : hardOf(p.material2) || C(p.color2) ? hardMat(hardOf(p.material2) || 'wood', C(p.color2)) : topM;
  const deskH = hutch ? Math.min(h * 0.62, Math.max(0.72, h - 0.3), 0.76) : h;
  const mainD = corner ? Math.min(clamp(d * 0.45, 0.45, 0.72), d * 0.7) : d, retW = corner ? Math.min(mainD, w * 0.6) : 0;
  const pw = clamp(w * 0.28, 0.2, 0.45), tt = Math.min(0.028, deskH * 0.1), lt = metalBase ? 0.03 : 0.045;
  return { drawers, base, hutch, corner, side, topM, baseM, metalBase, deskH, mainD, retW, pw, tt, lt, hd: clamp(mainD * 0.42, 0.12, 0.3) };
}
/** Stack of drawer fronts with bar handles on the front (+Z) face of a pedestal. */
function drawerFronts(g, x, wd, y0, y1, zFront, n, material, handleM) {
  const fh = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const y = y0 + fh * (i + 0.5);
    g.add(K.box(wd - 0.006, fh - 0.005, 0.018, material, x, y, zFront - 0.009), K.box(Math.min(0.14, wd * 0.4), 0.008, 0.012, handleM, x, y + fh * 0.22, zFront + 0.006));
  }
}
registerModel('desk', {
  build({ w, d, h, p }) {
    w = dim(w, 1.4); d = dim(d, 0.65); h = dim(h, 0.75); p = P(p);
    const g = new THREE.Group(), L = deskLayout(w, d, h, p), { deskH: H, tt, lt, mainD, topM, baseM, side: s } = L, zB = -d / 2, zM = zB + mainD, zF = d / 2, yT = H - tt;
    const handleM = L.metalBase ? baseM : K.metal('#2b2d31'), zPed = zM - 0.03;
    // top
    if (L.corner) { const xi = s * (w / 2 - L.retW), pts = s > 0 ? [[-w / 2, zB], [w / 2, zB], [w / 2, zF], [xi, zF], [xi, zM], [-w / 2, zM]] : [[-w / 2, zB], [w / 2, zB], [w / 2, zM], [xi, zM], [xi, zF], [-w / 2, zF]]; g.add(K.slab(pts, tt, topM, yT)); }
    else g.add(plate('rect', w, d, tt, topM, 0, H - tt / 2, 0, 0.006));
    // drawer pedestals (on the main wing)
    const pedSide = (sx) => L.drawers === 'both' || (L.drawers === 'left' && sx < 0) || (L.drawers === 'right' && sx > 0);
    const full = L.base === 'panel' || L.base === 'trestle', hang = L.base === 'sit-stand' ? Math.min(0.09, yT * 0.2) : Math.min(0.3, yT * 0.45);
    const pedX = (sx) => sx * (w / 2 - L.pw / 2 - (full ? 0 : lt + 0.012) - (L.corner && sx === s ? L.retW : 0));
    for (const sx of [-1, 1]) if (pedSide(sx)) {
      const y0 = full ? Math.min(0.03, yT * 0.1) : yT - hang, x = pedX(sx), pd = zPed - zB - 0.02 - 0.018;
      g.add(K.boxOn(L.pw, yT - y0, pd, topM, x, y0, zB + 0.02 + pd / 2));
      drawerFronts(g, x, L.pw, y0 + 0.003, yT - 0.004, zPed, full ? 3 : L.base === 'sit-stand' ? 1 : 2, topM, handleM);
      if (full) g.add(K.boxOn(L.pw - 0.03, y0, pd - 0.03, K.mat('#2a2826'), x, 0, zB + 0.02 + pd / 2));
    }
    // supports
    const sup = [];                                             // [x, z0, z1] support lines (legs pair / panel / trestle / column)
    for (const sx of [-1, 1]) { if (full && pedSide(sx)) continue; const x = sx * (w / 2 - lt / 2 - (L.base === 'legs' ? 0.012 : L.base === 'panel' ? 0 : clamp(w * 0.1, 0.03, 0.2))); if (L.corner && sx === s) sup.push([x, zB, zF]); else sup.push([x, zB, zM]); }
    for (const [x, z0, z1] of sup) {
      const zc = (z0 + z1) / 2, len = z1 - z0;
      if (L.base === 'panel') g.add(K.boxOn(0.022, yT, len - 0.004, baseM, x + Math.sign(x) * (lt / 2 - 0.013), 0, zc));
      else if (L.base === 'trestle') { const t = 0.035, zf = len / 2 - t; for (const sz of [-1, 1]) g.add(beam([x, 0.002, zc + sz * zf], [x, yT - t / 2, zc + sz * Math.min(zf, len * 0.2)], t, t, baseM)); g.add(K.box(t, t, len - 0.04, baseM, x, yT - t / 2, zc), K.box(t * 0.8, t * 0.8, len * 0.62, baseM, x, yT * 0.3, zc)); }
      else if (L.base === 'sit-stand') { const fl = Math.min(len - 0.02, 0.75); g.add(K.rbox(0.075, 0.025, fl, baseM, x, 0.0125, zc, 0.008, 1), K.boxOn(0.08, yT * 0.55, 0.05, baseM, x, 0.02, zc), K.boxOn(0.065, yT * 0.5, 0.038, baseM, x, yT * 0.5 - 0.03, zc), K.box(0.1, 0.02, Math.min(len - 0.08, 0.5), baseM, x, yT - 0.01, zc)); }
      else for (const z of len > 1.25 ? [z0, zc, z1] : [z0, z1]) g.add(K.boxOn(lt, yT, lt, baseM, x, 0, z + (z === z0 ? lt / 2 + 0.012 : z === z1 ? -lt / 2 - 0.012 : 0)));
    }
    if (L.corner && L.base !== 'sit-stand') { const xi = s * (w / 2 - L.retW + lt / 2 + 0.012); if (L.base === 'legs') g.add(K.boxOn(lt, yT, lt, baseM, xi, 0, zF - lt / 2 - 0.012)); else if (L.base === 'panel') g.add(K.boxOn(L.retW - 0.03, yT, 0.022, baseM, s * (w / 2 - L.retW / 2), 0, zF - 0.02)); }
    const xs = sup.map((q) => q[0]), xa = Math.min(...xs, pedSide(-1) && full ? pedX(-1) + L.pw / 2 : Infinity), xb = Math.max(...xs, pedSide(1) && full ? pedX(1) - L.pw / 2 : -Infinity), span = xb - xa;
    if (span > 0.1) {
      if (L.base === 'legs') { const ah = Math.min(0.06, yT * 0.12); g.add(K.box(span - lt, ah, 0.018, baseM, (xa + xb) / 2, yT - ah / 2, zB + lt / 2 + 0.012), K.box(span - lt, ah * 0.7, 0.018, baseM, (xa + xb) / 2, yT - ah * 0.35, zM - lt / 2 - 0.012)); }
      else if (L.base === 'panel') g.add(K.box(span, Math.min(0.32, yT * 0.45), 0.018, baseM, (xa + xb) / 2, yT - Math.min(0.32, yT * 0.45) / 2 - 0.01, zB + mainD * 0.22));
      else if (L.base === 'trestle') g.add(K.box(span, 0.028, 0.028, baseM, (xa + xb) / 2, yT * 0.3, (zB + zM) / 2));
      else { g.add(K.box(span, 0.04, 0.06, baseM, (xa + xb) / 2, yT - 0.03, (zB + zM) / 2)); g.add(K.box(0.07, 0.014, 0.03, K.plastic('#1c1d1f'), w * 0.3, yT - 0.007, zM - 0.02)); }
    }
    // hutch
    if (L.hutch && h - H > 0.12) {
      const hh = h - H, hd = L.hd, pt = 0.018, zc = zB + hd / 2, n = hh > 0.55 ? 2 : 1;
      for (const sx of [-1, 1]) g.add(K.boxOn(pt, hh, hd, topM, sx * (w / 2 - pt / 2), H, zc));
      g.add(K.box(w - 2 * pt, pt, hd, topM, 0, h - pt / 2, zc), K.boxOn(w - 2 * pt, hh - pt, 0.006, topM, 0, H, zB + 0.003));
      for (let i = 1; i <= n; i++) g.add(K.box(w - 2 * pt, pt, hd - 0.01, topM, 0, H + (hh - pt) * i / (n + 1), zc + 0.005));
      if (w > 1) g.add(K.boxOn(pt, (hh - pt) / (n + 1), hd - 0.01, topM, w * 0.12, H + (hh - pt) * n / (n + 1), zc + 0.005));
    }
    return fit(g, w, d, h);
  },
  draw2d: sym((q, { w, d, h, p, det }) => {
    const L = deskLayout(w, d, h, p), s = L.side, zB = -d / 2, zM = zB + L.mainD, zF = d / 2, th = matHex(L.topM), fill = tone(th, 0.5), i = 0.025;
    const xi = s * (w / 2 - L.retW), poly = (o) => (L.corner ? (s > 0 ? [[-w / 2 + o, zB + o], [w / 2 - o, zB + o], [w / 2 - o, zF - o], [xi + o, zF - o], [xi + o, zM - o], [-w / 2 + o, zM - o]] : [[-w / 2 + o, zB + o], [w / 2 - o, zB + o], [w / 2 - o, zM - o], [xi - o, zM - o], [xi - o, zF - o], [-w / 2 + o, zF - o]]) : [[-w / 2 + o, zB + o], [w / 2 - o, zB + o], [w / 2 - o, zF - o], [-w / 2 + o, zF - o]]);
    q.poly(poly(0), 0.008, fill);
    if (det < 16) return;
    if (det > 26) q.poly(poly(i), 0.006, null, FAINT, 0.8);
    if (L.hutch) q.rr(-w / 2, zB, w / 2, zB + L.hd, 0.004, tone(th, 0.3), INK, 0.8);
    const full = L.base === 'panel' || L.base === 'trestle';
    if (det > 30) for (const sx of [-1, 1]) if (L.drawers === 'both' || (L.drawers === 'left' && sx < 0) || (L.drawers === 'right' && sx > 0)) {
      const x = sx * (w / 2 - L.pw / 2 - (full ? 0 : L.lt + 0.012) - (L.corner && sx === s ? L.retW : 0)), c = q.ctx;
      c.save(); c.setLineDash([q.px * 4, q.px * 3]); q.rr(x - L.pw / 2, zB + 0.02, x + L.pw / 2, zM - 0.03, 0.003, null, FAINT); c.restore();
      q.line(x - L.pw * 0.2, zM - 0.045, x + L.pw * 0.2, zM - 0.045, INK, 1.2);
    }
  }),
});
