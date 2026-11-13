/**
 * Kitchen, bathroom, appliance, climate & electronics models (see docs/CONTRACT.md § 3 and types.js).
 *
 * Conventions used by every model in this file:
 *  - the BODY of the object fills exactly the w × d × h box (metres, front = +Z, back = −Z, y 0..h);
 *  - fittings that in reality stand ABOVE that box (taps on a counter / basin / bath, hob pan supports on a
 *    kitchen run, a WC flush plate, the mirror above a vanity, a bath screen) are added in groups flagged
 *    `userData.extra = true` so tools that measure the body can skip them;
 *  - wall-hung pieces (WC, vanity, hand basin) leave a real gap above the floor;
 *  - glass / glow meshes carry `userData.noShadow = true`.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerModel } from './registry.js';
import * as K from './kit.js';

// ───────────────────────── param sanitising ─────────────────────────
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, def) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : def;
};
const flag = (v, def = false) => (v === true || v === 'true' || v === 1 ? true : v === false || v === 'false' || v === 0 || v === 'none' ? false : def);
const pick = (v, list, def) => (typeof v === 'string' && list.includes(v) ? v : def);
const hex = (v, def) => {
  if (typeof v !== 'string') return def;
  if (v[0] === '#') return HEX.test(v) ? v : def;
  const c = K.col(v, def);
  return typeof c === 'string' && HEX.test(c) ? c : def;
};
const obj = (p) => (p && typeof p === 'object' && !Array.isArray(p) ? p : {});
const dim = (v, def) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : def);

/** Register a type with sanitised sizes / params so builders never see junk. */
function reg(type, build, draw) {
  registerModel(type, {
    build: ({ w, d, h, p, item }) => build({ w: Math.max(0.02, dim(w, 0.6)), d: Math.max(0.01, dim(d, 0.6)), h: Math.max(0.01, dim(h, 0.6)), p: obj(p), item }),
    draw2d: (ctx, { w, d, h, p, px, item }) => draw(ctx, { w: Math.max(1, dim(w, 60)), d: Math.max(1, dim(d, 60)), h: Math.max(1, dim(h, 60)), p: obj(p), px: dim(px, 1), item }),
  });
}

// ───────────────────────── materials ─────────────────────────
const steel = () => K.mat('#c6c9cd', { roughness: 0.34, metalness: 0.62 });
const steelDark = () => K.mat('#7f8389', { roughness: 0.42, metalness: 0.6 });
const blackGlass = () => K.mat('#0d0e11', { roughness: 0.07, metalness: 0.25 });
const ovenWindow = () => K.mat('#1c2026', { roughness: 0.04, metalness: 0.55 });
const iron = () => K.mat('#1e1f22', { roughness: 0.62, metalness: 0.3 });
const darkPlastic = () => K.mat('#25262a', { roughness: 0.55 });
const greyPlastic = () => K.mat('#9a9da2', { roughness: 0.5 });
const shadowMat = () => K.mat('#17181b', { roughness: 0.95 });
const enamel = (c = '#f5f5f2') => K.mat(c, { roughness: 0.27 });
const lcd = (c = '#59c8ff') => K.mat('#10222c', { emissive: c, emissiveIntensity: 0.55, roughness: 0.3 });
const WHITE = '#f3f1ec', STONE = '#e7e4de', STAINLESS = '#c9ccd0';

/** Metal finish vocabulary used for taps, shower frames and handles. */
function finish(name) {
  switch (name) {
    case 'black': return K.mat('#1b1c1f', { roughness: 0.42, metalness: 0.55 });
    case 'gold': case 'brass': return K.mat('#c9a657', { roughness: 0.24, metalness: 0.9 });
    case 'nickel': return K.mat('#b3b0a8', { roughness: 0.32, metalness: 0.85 });
    case 'copper': return K.mat('#b87a52', { roughness: 0.28, metalness: 0.9 });
    case 'white': return enamel('#f4f4f2');
    default: return K.chrome();
  }
}
const FINISH_HEX = { chrome: '#c9cdd2', black: '#2a2b2e', gold: '#c9a657', brass: '#c9a657', nickel: '#b3b0a8', copper: '#b87a52', white: '#f4f4f2' };

function hsl(c) { const o = { h: 0, s: 0, l: 0 }; new THREE.Color(c).getHSL(o); return o; }
const isWoody = (c) => { const { h, s, l } = hsl(c); return h > 0.04 && h < 0.14 && s > 0.2 && s < 0.7 && l > 0.2 && l < 0.76; };

/** Cabinet front / carcass material from the common params. */
function cabinetMat(p, color) {
  const m = p.material;
  if (m === 'wood' || m === 'teak' || (!m && isWoody(color))) return K.wood(color);
  if (m === 'metal' || m === 'aluminium') return K.mat(color, { roughness: 0.38, metalness: 0.6 });
  if (m === 'laminate') return K.mat(color, { roughness: 0.5 });
  return K.lacquer(color);
}
/** Appliance casing: greys read as brushed steel, whites as enamel, blacks as dark steel. */
function applianceMat(color, material) {
  const { s, l } = hsl(color);
  const metallic = material === 'metal' || material === 'aluminium' || (!material && s < 0.22 && l > 0.2 && l < 0.86);
  return K.mat(color, { roughness: metallic ? 0.34 : 0.3, metalness: metallic ? 0.62 : l < 0.2 ? 0.35 : 0.02 });
}
const counterHex = (p, def = STONE) => (p.counter === 'steel' ? '#c6c9cd' : hex(p.counterColor, hex(p.color2, p.counter === 'wood' ? '#c8a476' : def)));
function counterMat(p, def = STONE) {
  const c = counterHex(p, def);
  if (p.counter === 'steel') return steel();
  if (p.counter === 'wood') return K.wood(c);
  if (p.counter === 'laminate') return K.mat(c, { roughness: 0.5 });
  if (p.counter === 'ceramic') return K.ceramic(c);
  return K.stone(c);
}

// ───────────────────────── geometry helpers ─────────────────────────
const _geo = new Map();
const geo = (key, make) => { let g = _geo.get(key); if (!g) { g = make(); _geo.set(key, g); } return g; };
const mm = (v) => Math.round(v * 1000);
const at = (o, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); return o; };
const noShadow = (o) => { o.traverse((m) => { m.userData.noShadow = true; }); return o; };
const extra = (o) => { o.userData.extra = true; return o; };
const grp = (...c) => K.group(...c);

const cylX = (r, len, m, x, y, z, seg = 12) => { const c = K.cyl(r, r, len, m, x, y, z, seg); c.rotation.z = Math.PI / 2; return c; };
const cylZ = (r, len, m, x, y, z, seg = 12) => { const c = K.cyl(r, r, len, m, x, y, z, seg); c.rotation.x = Math.PI / 2; return c; };

/** Rounded rectangle Shape / Path centred on (cx, cy). */
function rrShape(w, d, r = 0, cx = 0, cy = 0, Ctor = THREE.Shape) {
  const s = new Ctor(), x = cx - w / 2, y = cy - d / 2;
  r = clamp(r, 0, Math.min(w, d) / 2 - 1e-4);
  if (!(r > 1e-4)) { s.moveTo(x, y); s.lineTo(x + w, y); s.lineTo(x + w, y + d); s.lineTo(x, y + d); s.lineTo(x, y); return s; }
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + d - r); s.absarc(x + w - r, y + d - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + d); s.absarc(x + r, y + d - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
/** Horizontal plate: Shape drawn as (x, −z), thickness t upwards from y0. */
function flat(shape, t, material, y0 = 0, curveSegments = 8) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments });
  g.rotateX(-Math.PI / 2);
  return at(new THREE.Mesh(g, material), 0, y0, 0);
}
/** Upright panel: Shape drawn as (x, y), thickness t towards +Z from z0. */
function upright(shape, t, material, z0 = 0, curveSegments = 16) {
  return at(new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments }), material), 0, 0, z0);
}
/** Side profile [[z, y], …] swept along x over `width`, centred on x = cx. */
function profileX(pts, width, material, cx = 0) {
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
  g.rotateY(Math.PI / 2); g.translate(cx - width / 2, 0, 0);
  return new THREE.Mesh(g, material);
}
/** Rectangular slab x0..x1 × z0..z1 with optional holes: rounded rects { x, z, w, d, r } or polygons { pts: [[x, z], …] }. */
function deck(material, x0, x1, z0, z1, y0, t, holes) {
  if (!holes || !holes.length) return K.box(x1 - x0, t, z1 - z0, material, (x0 + x1) / 2, y0 + t / 2, (z0 + z1) / 2);
  const s = new THREE.Shape([[x0, -z0], [x1, -z0], [x1, -z1], [x0, -z1]].map(([x, y]) => new THREE.Vector2(x, y)));
  for (const b of holes) s.holes.push(b.pts ? new THREE.Path(b.pts.map(([x, z]) => new THREE.Vector2(x, -z))) : rrShape(b.w, b.d, b.r, b.x, -b.z, THREE.Path));
  return flat(s, t, material, y0, 10);
}
/** Superellipse ring in the XZ plane (e = 1 ellipse … 0.2 ≈ rounded rectangle); eBack shapes the −Z half. */
function ring(cx, cz, rx, rz, y, n = 28, e = 1, eBack = e) {
  const out = [];
  for (let j = 0; j < n; j++) {
    const a = (j / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), ee = s < 0 ? eBack : e;
    out.push([cx + rx * Math.sign(c) * Math.abs(c) ** ee, y, cz + rz * Math.sign(s) * Math.abs(s) ** ee]);
  }
  return out;
}
/** Ring spanning x ±hw and z0..z1 (bounding box given directly). */
const ringBox = (hw, z0, z1, y, n, e, eBack) => ring(0, (z0 + z1) / 2, hw, (z1 - z0) / 2, y, n, e, eBack);
/**
 * Smooth skin through closed rings (arrays of [x, y, z] with equal length, counter-clockwise seen from below).
 * Rings listed upwards give outward-facing walls, listed downwards inward-facing ones (basins).
 */
function loft(rings, material, capA = true, capB = true) {
  const n = rings[0].length, pos = [], idx = [];
  for (const r of rings) for (const q of r) pos.push(q[0], q[1], q[2]);
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < n; j++) {
    const a = i * n + j, b = i * n + ((j + 1) % n), c = a + n, d = b + n;
    idx.push(a, c, b, b, c, d);
  }
  const cap = (r, first) => {
    const base = pos.length / 3; let cx = 0, cy = 0, cz = 0;
    for (const q of r) { pos.push(q[0], q[1], q[2]); cx += q[0]; cy += q[1]; cz += q[2]; }
    pos.push(cx / n, cy / n, cz / n);
    for (let j = 0; j < n; j++) { const a = base + j, b = base + ((j + 1) % n), c = base + n; if (first) idx.push(a, b, c); else idx.push(a, c, b); }
  };
  if (capA) cap(rings[0], true);
  if (capB) cap(rings[rings.length - 1], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}
/** Smooth tube through points. */
function tube(pts, r, material, seg = 20, radial = 8) {
  const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(q[0], q[1], q[2])), false, 'catmullrom', 0.4);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, radial, false), material);
}
/** Frustum between a bottom rectangle and a top rectangle ({ x0, x1, z0, z1 }), flat shaded. */
function hull(b, t, y0, y1, material) {
  const P = [[b.x0, y0, b.z0], [b.x1, y0, b.z0], [b.x1, y0, b.z1], [b.x0, y0, b.z1], [t.x0, y1, t.z0], [t.x1, y1, t.z0], [t.x1, y1, t.z1], [t.x0, y1, t.z1]];
  const F = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  const pos = [];
  for (const [a, bb, c, d] of F) for (const i of [a, bb, c, a, c, d]) pos.push(...P[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}
const gBox = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const gCyl = (r, len, x = 0, y = 0, z = 0, axis = 'y', seg = 10, r2 = r) => {
  const g = new THREE.CylinderGeometry(r2, r, len, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  return g.translate(x, y, z);
};
const gRingY = (r0, r1, x, y, z, seg = 36) => new THREE.RingGeometry(r0, r1, seg).rotateX(-Math.PI / 2).translate(x, y, z);
const gRingZ = (r0, r1, x, y, z, seg = 36) => new THREE.RingGeometry(r0, r1, seg).translate(x, y, z);
/** One mesh from several primitive geometries (cached under `key`; pass null to skip caching). */
function merged(key, parts, material, x = 0, y = 0, z = 0) {
  const make = () => { const list = parts(); const m = mergeGeometries(list, false); list.forEach((q) => q.dispose()); return m || new THREE.BufferGeometry(); };
  return at(new THREE.Mesh(key ? geo(key, make) : make(), material), x, y, z);
}
/** Evenly spaced slats (grilles, louvres, rungs) as one mesh. axis: direction the slats are stacked along. */
function slats(n, len, thick, depth, pitch, material, axis = 'y', along = 'x') {
  n = clamp(Math.round(n), 1, 60);
  return merged(`sl|${n}|${mm(len)}|${mm(thick)}|${mm(depth)}|${mm(pitch)}|${axis}${along}`, () => Array.from({ length: n }, (_, i) => {
    const o = (i - (n - 1) / 2) * pitch;
    if (axis === 'y') return along === 'x' ? gBox(len, thick, depth, 0, o, 0) : gBox(depth, thick, len, 0, o, 0);
    if (axis === 'x') return along === 'y' ? gBox(thick, len, depth, o, 0, 0) : gBox(thick, depth, len, o, 0, 0);
    return along === 'x' ? gBox(len, depth, thick, 0, 0, o) : gBox(depth, len, thick, 0, 0, o);
  }), material);
}

// ───────────────────────── shared parts ─────────────────────────
const FT = 0.018;   // front (door) thickness
const GAP = 0.003;  // reveal between fronts
const OVH = 0.025;  // counter overhang beyond the door faces (also the handle projection)

/** Bar handle on two stand-offs; projects 24 mm in +Z (or −Z when dir = −1). */
function barHandle(len, material, x, y, z, vertical = false, dir = 1) {
  const L = Math.max(0.04, Math.round(len * 100) / 100);
  const m = merged(`hb|${mm(L)}`, () => [gCyl(0.005, L, 0, 0, 0.019, 'x', 8), gCyl(0.004, 0.019, -L * 0.36, 0, 0.0095, 'z', 6), gCyl(0.004, 0.019, L * 0.36, 0, 0.0095, 'z', 6)], material, x, y, z);
  m.rotation.set(0, dir < 0 ? Math.PI : 0, vertical ? Math.PI / 2 : 0);
  return m;
}

/** Helper that lays door / drawer fronts (+ pulls) on a face at z = zFace looking towards dir·Z. */
function frontKit(g, { zFace, mat, hMat, handles = 'bar', dir = 1 }) {
  const panel = (x, y0, y1, wm, m = mat) => {
    const b = K.box(Math.max(0.004, wm - GAP), Math.max(0.004, y1 - y0 - GAP), FT, m, x, (y0 + y1) / 2, zFace - dir * FT / 2);
    g.add(b); return b;
  };
  const pull = (x, y, len, vertical) => {
    if (handles === 'bar') g.add(barHandle(len, hMat, x, y, zFace, vertical, dir));
    else if (handles === 'knob') g.add(cylZ(0.011, 0.022, hMat, x, y, zFace + dir * 0.011, 12));
  };
  const F = {
    panel,
    /** Drawer / flap: horizontal pull near the top (or bottom). */
    drawer(x, y0, y1, wm, where = 'top') {
      panel(x, y0, y1, wm);
      const off = Math.min(0.045, (y1 - y0) * 0.3);
      pull(x, where === 'top' ? y1 - off : y0 + off, clamp(wm * 0.45, 0.06, 0.32), false);
    },
    /** Hinged door: vertical pull at the side given by `side` (−1 left, +1 right), `where` 'top' | 'bottom' | y. */
    door(x, y0, y1, wm, side = 1, where = 'top') {
      panel(x, y0, y1, wm);
      const len = clamp((y1 - y0) * 0.24, 0.06, 0.3);
      const hy = where === 'top' ? y1 - 0.045 - len / 2 : where === 'bottom' ? y0 + 0.045 + len / 2 : clamp(where, y0 + len / 2 + 0.02, Math.max(y0 + len / 2 + 0.02, y1 - len / 2 - 0.02));
      pull(x + side * (wm / 2 - Math.min(0.04, wm * 0.2)), hy, len, true);
    },
    /** One or two leaves filling a module. */
    doors(m, y0, y1, idx = 0, where = 'top') {
      const leaves = m.leaves || (m.w > 0.62 ? 2 : 1);
      if (leaves >= 2) { F.door(m.x - m.w / 4, y0, y1, m.w / 2, 1, where); F.door(m.x + m.w / 4, y0, y1, m.w / 2, -1, where); }
      else F.door(m.x, y0, y1, m.w, idx % 2 ? -1 : 1, where);
    },
    /** Stack of n drawers (shallow ones on top). */
    drawers(m, y0, y1) {
      const n = clamp(Math.round(m.n || 3), 1, 6);
      const r = n === 3 ? [1, 2, 2] : n === 4 ? [1, 1, 2, 2] : Array(n).fill(1), tot = r.reduce((a, b) => a + b, 0);
      let y = y1;
      for (const k of r) { const hh = ((y1 - y0) * k) / tot; F.drawer(m.x, y - hh, y, m.w); y -= hh; }
    },
    module(m, y0, y1, idx = 0) {
      if (y1 - y0 < 0.02 || m.w < 0.02) return;
      switch (m.kind) {
        case 'drawers': F.drawers(m, y0, y1); break;
        case 'combo': { const dh = Math.min(0.16, (y1 - y0) * 0.3); F.drawer(m.x, y1 - dh, y1, m.w); F.doors(m, y0, y1 - dh, idx); break; }
        case 'oven': {
          const oh = Math.min(0.595, y1 - y0);
          g.add(at(ovenFront(m.w - GAP, oh - GAP), m.x, y1 - oh + GAP / 2, zFace - FT));
          if (y1 - y0 - oh > 0.06) panel(m.x, y0, y1 - oh, m.w);
          break;
        }
        case 'dw': {
          panel(m.x, y0, y1 - 0.03, m.w);
          g.add(K.box(m.w - GAP, 0.03 - GAP, FT, steel(), m.x, y1 - 0.015, zFace - FT / 2));
          pull(m.x, y1 - 0.075, clamp(m.w * 0.6, 0.06, 0.4), false);
          break;
        }
        case 'blind': panel(m.x, y0, y1, m.w); break;
        default: F.doors(m, y0, y1, idx);
      }
    },
  };
  return F;
}

/** Built-in oven front: origin bottom-centre, back plane z = 0, glass face at z = FT, handle beyond. */
function ovenFront(w, hh, steelStrip = false, noStrip = false) {
  const g = new THREE.Group(), bg = blackGlass(), st = steel();
  const strip = noStrip ? 0 : Math.min(0.1, hh * 0.2), dh = hh - strip, t = FT - 0.003;
  g.add(K.box(w, hh, 0.003, shadowMat(), 0, hh / 2, 0.0015));
  if (strip) g.add(K.box(w, strip - GAP, t, steelStrip ? st : bg, 0, hh - strip / 2, 0.003 + t / 2));
  g.add(K.box(w, dh - GAP, t, bg, 0, dh / 2, 0.003 + t / 2));
  g.add(K.box(Math.max(0.02, w - 0.11), Math.max(0.02, dh - 0.17), 0.001, ovenWindow(), 0, dh / 2 - 0.015, FT + 0.0006));
  g.add(barHandle(w * 0.84, st, 0, dh - 0.045, FT));
  if (!strip) return g;
  g.add(merged(`ovk|${mm(w)}`, () => [gCyl(0.015, 0.016, -w * 0.36, 0, 0.008, 'z', 16), gCyl(0.015, 0.016, w * 0.36, 0, 0.008, 'z', 16)], st, 0, hh - strip / 2, FT));
  g.add(noShadow(K.box(Math.min(0.1, w * 0.2), Math.min(0.026, strip * 0.4), 0.001, lcd(), 0, hh - strip / 2, FT + 0.0006)));
  return g;
}
/** Built-in microwave front (same origin convention as ovenFront). */
function microFront(w, hh) {
  const g = new THREE.Group(), bg = blackGlass(), t = FT - 0.003, cw = Math.min(0.12, w * 0.24);
  g.add(K.box(w, hh, 0.003, shadowMat(), 0, hh / 2, 0.0015));
  g.add(K.box(w - cw - GAP, hh, t, bg, -cw / 2, hh / 2, 0.003 + t / 2));
  g.add(K.box(cw, hh, t, bg, w / 2 - cw / 2, hh / 2, 0.003 + t / 2));
  g.add(K.box(Math.max(0.02, w - cw - 0.09), Math.max(0.02, hh - 0.09), 0.001, ovenWindow(), -cw / 2, hh / 2, FT + 0.0006));
  g.add(barHandle(hh * 0.7, steel(), w / 2 - cw - 0.03, hh / 2, FT, true));
  g.add(noShadow(K.box(cw * 0.6, 0.022, 0.001, lcd(), w / 2 - cw / 2, hh * 0.78, FT + 0.0006)));
  g.add(cylZ(Math.min(0.022, cw * 0.3), 0.014, steel(), w / 2 - cw / 2, hh * 0.32, FT + 0.007, 16));
  return g;
}

/** Bowl positions for an inset kitchen sink whose user stands at +Z. */
function sinkLayout(kind, xc, availW, zFront, depth) {
  const bd = clamp(depth - 0.2, 0.16, 0.42), zc = zFront - Math.min(0.075, depth * 0.14) - bd / 2;
  const bowls = [];
  if (kind === 'double') {
    const tot = clamp(availW - 0.08, 0.3, 0.8), bw = (tot - 0.03) / 2;
    bowls.push({ x: xc - (bw + 0.03) / 2, z: zc, w: bw, d: bd, r: 0.04 }, { x: xc + (bw + 0.03) / 2, z: zc, w: bw, d: bd, r: 0.04 });
  } else bowls.push({ x: xc, z: zc, w: clamp(availW - 0.12, 0.2, 0.5), d: bd, r: 0.04 });
  return { bowls, tapX: xc, tapZ: Math.max(zc - bd / 2 - 0.05, zFront - depth + 0.03) };
}
/** Stainless bowls dropped into the holes of a counter (rim 1.5 mm proud). */
function sinkBowls(g, bowls, yTop, maxDepth = 0.18) {
  const st = steel(), t = 0.006;
  for (const b of bowls) {
    const dp = Math.min(maxDepth, yTop - 0.02);
    const wall = rrShape(b.w, b.d, b.r, b.x, -b.z);
    wall.holes.push(rrShape(b.w - 2 * t, b.d - 2 * t, b.r - t, b.x, -b.z, THREE.Path));
    g.add(flat(wall, dp + 0.0015, st, yTop - dp));
    g.add(flat(rrShape(b.w - t, b.d - t, b.r, b.x, -b.z), 0.003, st, yTop - dp));
    g.add(K.cyl(0.022, 0.022, 0.003, K.chrome(), b.x, yTop - dp + 0.0045, b.z, 16));
  }
}
/** Taps. Origin = mounting point, spout towards +Z. */
function tap(kind, fin = 'chrome') {
  const g = new THREE.Group(), m = finish(fin);
  if (kind === 'kitchen') {
    g.add(K.cylOn(0.025, 0.027, 0.012, m, 0, 0, 0, 16), K.cylOn(0.016, 0.017, 0.11, m, 0, 0.012, 0, 12));
    g.add(tube([[0, 0.11, 0], [0, 0.26, 0], [0, 0.325, 0.035], [0, 0.335, 0.1], [0, 0.3, 0.155], [0, 0.255, 0.165]], 0.0105, m, 28, 8));
    g.add(K.cyl(0.013, 0.013, 0.02, m, 0, 0.25, 0.166, 10));
    g.add(K.bar([0.014, 0.085, 0], [0.062, 0.105, 0], 0.006, m, 8));
  } else if (kind === 'bath') {
    g.add(K.rboxOn(0.2, 0.035, 0.05, m, 0, 0.05, 0, 0.012));
    g.add(K.cylOn(0.012, 0.012, 0.05, m, -0.075, 0, 0, 8), K.cylOn(0.012, 0.012, 0.05, m, 0.075, 0, 0, 8));
    g.add(tube([[0, 0.07, 0.015], [0, 0.085, 0.07], [0, 0.07, 0.13], [0, 0.05, 0.14]], 0.012, m, 14, 8));
    g.add(K.cylOn(0.018, 0.02, 0.03, m, -0.075, 0.085, 0, 10), K.cylOn(0.018, 0.02, 0.03, m, 0.075, 0.085, 0, 10));
  } else if (kind === 'wall') {
    g.add(cylZ(0.028, 0.008, m, 0, 0, 0.004, 16));
    g.add(tube([[0, 0, 0.004], [0, 0, 0.13], [0, -0.012, 0.16], [0, -0.03, 0.165]], 0.0095, m, 14, 8));
    g.add(cylZ(0.022, 0.008, m, 0.11, 0, 0.004, 14), K.bar([0.11, 0, 0.006], [0.11, 0.012, 0.05], 0.006, m, 8));
  } else {
    const tall = kind === 'basin-tall', bh = tall ? 0.24 : 0.085;
    g.add(K.cylOn(0.022, 0.024, 0.008, m, 0, 0, 0, 16), K.cylOn(0.017, 0.019, bh, m, 0, 0.008, 0, 14));
    g.add(K.bar([0, bh - 0.02, 0.005], [0, bh + 0.012, 0.115], 0.0095, m, 10));
    g.add(K.cyl(0.0095, 0.0095, 0.016, m, 0, bh + 0.004, 0.115, 8));
    g.add(K.cylOn(0.015, 0.017, 0.022, m, 0, bh + 0.008, 0, 12), K.bar([0, bh + 0.03, 0], [0, bh + 0.05, -0.05], 0.005, m, 8));
  }
  return g;
}

const BURNERS = {
  1: [[0, 0, 1.1]], 2: [[-0.24, 0, 1], [0.24, 0, 1]], 3: [[-0.25, -0.2, 0.9], [0.25, -0.2, 0.9], [0, 0.2, 1.1]],
  4: [[-0.25, -0.21, 0.85], [0.25, -0.21, 1], [-0.25, 0.21, 1.05], [0.25, 0.21, 0.85]],
  5: [[-0.33, -0.21, 0.85], [0.33, -0.21, 0.95], [-0.33, 0.21, 0.95], [0.33, 0.21, 0.85], [0, 0, 1.3]],
  6: [[-0.33, -0.21, 0.9], [0, -0.21, 0.9], [0.33, -0.21, 0.9], [-0.33, 0.21, 0.9], [0, 0.21, 0.9], [0.33, 0.21, 0.9]],
};
/** Burner centres [{ x, z, r }] (metres, relative to the hob centre) shared by the 3D model and the plan symbol. */
function burnerLayout(kind, hw, hd, burners) {
  const narrow = hw < 0.42, gas = kind === 'gas';
  const n = clamp(Math.round(num(burners, 0)) || (narrow ? 2 : hw >= 0.72 ? 5 : 4), 1, 6);
  const zs = gas ? 0.82 : 0.92, zo = gas ? -hd * 0.055 : -hd * 0.02;
  const base = Math.min(narrow ? hw : hw / (n >= 5 ? 3 : 2), hd / 2) * 0.33;
  const nn = Math.min(n, 3);
  if (narrow) return Array.from({ length: nn }, (_, i) => ({ x: 0, z: zo + (i - (nn - 1) / 2) * hd * 0.42 * zs, r: Math.min(base, hd * 0.16) * (i ? 0.85 : 1) }));
  return BURNERS[n].map(([fx, fz, s]) => ({ x: fx * hw, z: zo + fz * hd * zs, r: base * s }));
}
/**
 * Cooktop standing on y = 0 (centre origin, user at +Z). kind: 'gas' | 'induction' | 'ceramic'.
 * Gas: steel (or black-glass) plate, burner caps, cast-iron pan supports reaching `ht`, knob row.
 */
function hob(kind, hw, hd, burners, ht = 0.034, dark = false, knobs = true) {
  const g = new THREE.Group(), L = burnerLayout(kind, hw, hd, burners);
  if (kind === 'gas') {
    ht = Math.max(0.02, ht);
    g.add(K.box(hw, 0.006, hd, dark ? blackGlass() : steel(), 0, 0.003, 0));
    for (const b of L) {
      const r = b.r * 0.62, s = b.r * 1.28;
      g.add(merged(`brn|${mm(r)}`, () => [gCyl(r, 0.01, 0, 0.011, 0, 'y', 20), gCyl(r * 0.6, 0.007, 0, 0.0195, 0, 'y', 18)], iron(), b.x, 0, b.z));
      g.add(merged(`grt|${mm(s)}|${mm(ht)}`, () => {
        const y = ht - 0.004, f = s * 0.5, parts = [];
        for (const k of [-1, 1]) {
          parts.push(gBox(2 * s, 0.008, 0.008, 0, y, k * s), gBox(0.008, 0.008, 2 * s, k * s, y, 0));
          parts.push(gBox(f, 0.008, 0.008, k * (s - f / 2), y, 0), gBox(0.008, 0.008, f, 0, y, k * (s - f / 2)));
          for (const j of [-1, 1]) parts.push(gBox(0.009, ht - 0.006, 0.009, k * s, (ht + 0.006) / 2 - 0.004, j * s));
        }
        return parts;
      }, iron(), b.x, 0, b.z));
    }
    const kn = L.length, kz = hd / 2 - Math.min(0.04, hd * 0.08), kp = Math.min(0.06, (hw * 0.7) / kn);
    if (knobs) g.add(merged(`hk|${kn}|${mm(kp)}`, () => Array.from({ length: kn }, (_, i) => gCyl(0.013, 0.018, (i - (kn - 1) / 2) * kp, 0.015, 0, 'y', 14, 0.011)), dark ? steel() : darkPlastic(), 0, 0, kz));
  } else {
    g.add(K.box(hw, 0.005, hd, blackGlass(), 0, 0.0025, 0));
    const ceramic = kind === 'ceramic';
    g.add(noShadow(merged(null, () => L.flatMap((b) => [gRingY(b.r - 0.0035, b.r, b.x, 0, b.z), ...(ceramic ? [gRingY(b.r * 0.6 - 0.003, b.r * 0.6, b.x, 0, b.z)] : [])]), K.mat(ceramic ? '#a25648' : '#8b9098', { roughness: 0.5 }), 0, 0.0056, 0)));
    g.add(noShadow(K.box(Math.min(0.18, hw * 0.4), 0.0006, 0.01, K.mat('#8b9098', { roughness: 0.5 }), 0, 0.0054, hd / 2 - Math.min(0.035, hd * 0.08))));
  }
  return g;
}

// ───────────────────────── 2D helpers (cm, +y = front) ─────────────────────────
const INK = K.INK, SOFT = K.INK_SOFT, MID = 'rgba(38,40,46,0.55)', PAPER = '#ffffff';
const GLASS2D = 'rgba(70,150,185,0.9)';
function rect2(ctx, x, y, w, h, fill, stroke = INK, lw = 1) {
  ctx.beginPath(); ctx.rect(x, y, w, h);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function ell2(ctx, cx, cy, rx, ry, fill, stroke = INK, lw = 1) {
  ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
const circ2 = (ctx, cx, cy, r, fill, stroke, lw) => ell2(ctx, cx, cy, r, r, fill, stroke, lw);
const rr2 = (ctx, cx, cy, w, h, r, fill, stroke = INK, lw = 1) => K.fillRR(ctx, cx, cy, Math.max(0.01, w), Math.max(0.01, h), r, fill, stroke, lw);
/** Run fn with a dashed stroke (dash lengths in screen pixels). */
function dashed(ctx, px, fn, on = 4, off = 3) { ctx.save(); ctx.setLineDash([on * px, off * px]); fn(); ctx.restore(); }
/** Closed path through a ring of [x, y] points. */
function poly2(ctx, pts, fill, stroke = INK, lw = 1) {
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
/** Sink bowls + tap (bowls in metres as produced by sinkLayout; flip = −1 when the user stands at −y). */
function sink2d(ctx, S, px, flip = 1) {
  for (const b of S.bowls) {
    rr2(ctx, b.x * 100, flip * b.z * 100, b.w * 100, b.d * 100, 4, PAPER, INK, px);
    rr2(ctx, b.x * 100, flip * b.z * 100, b.w * 100 - 5, b.d * 100 - 5, 3, null, SOFT, px * 0.75);
    circ2(ctx, b.x * 100, flip * b.z * 100, 2.2, null, INK, px);
  }
  if (S.tapX == null) return;
  const tx = S.tapX * 100, tz = flip * S.tapZ * 100, dir = Math.sign(flip * S.bowls[0].z * 100 - tz) || 1;
  K.line(ctx, tx, tz, tx, tz + dir * 13, INK, px * 1.6);
  circ2(ctx, tx, tz, 2.4, PAPER, INK, px);
}
/** Cooktop symbol centred on (cx, cy) — sizes in cm. */
function hob2d(ctx, kind, cx, cy, hw, hd, burners, px, flip = 1) {
  const gas = kind === 'gas';
  rr2(ctx, cx, cy, hw, hd, 1.5, gas ? '#eef0f2' : '#3d4046', INK, px);
  const ink = gas ? INK : 'rgba(255,255,255,0.8)';
  for (const b of burnerLayout(kind, hw / 100, hd / 100, burners)) {
    const x = cx + b.x * 100, y = cy + flip * b.z * 100, r = b.r * 100;
    circ2(ctx, x, y, r, null, ink, px);
    if (gas) { circ2(ctx, x, y, r * 0.38, '#5b5e64', null); K.line(ctx, x - r * 1.25, y, x + r * 1.25, y, SOFT, px * 0.75); K.line(ctx, x, y - r * 1.25, x, y + r * 1.25, SOFT, px * 0.75); }
    else if (kind === 'ceramic') circ2(ctx, x, y, r * 0.6, null, ink, px * 0.75);
  }
  if (gas && hd / px > 30) {
    const n = burnerLayout(kind, hw / 100, hd / 100, burners).length, kp = Math.min(6, (hw * 0.7) / n);
    for (let i = 0; i < n; i++) circ2(ctx, cx + (i - (n - 1) / 2) * kp, cy + flip * (hd / 2 - Math.min(4, hd * 0.08)), 1.1, '#5b5e64', null);
  }
}

// ═════════════════════════ KITCHEN CABINETS ═════════════════════════
const handleMat = (p) => (hex(p.color3, null) ? K.mat(hex(p.color3, '#b4b7bb'), { roughness: 0.35, metalness: 0.7 }) : K.mat('#b4b7bb', { roughness: 0.3, metalness: 0.7 }));
const plinthMat = (p, color) => K.mat(K.shade(color, -0.62), { roughness: 0.6 });
const sinkKindOf = (v) => (v === true ? 'single' : pick(v, ['single', 'double'], null));
const hobKindOf = (v) => (v === true ? 'induction' : pick(v, ['gas', 'induction', 'ceramic'], null));

/**
 * Splits a base run of width w (m) into modules [{ x, w, kind, n, leaves, role }] from left to right.
 * `doors` = number of door leaves, `drawers` = drawers per stack; sink / dishwasher / hob (oven) get their own
 * 60 cm modules, everything else is divided into ≈ 40–60 cm modules.
 */
function baseModules(w, p, sinkKind, hobKind) {
  const doorsN = clamp(Math.round(num(p.doors, 0)), 0, 40), drawersN = clamp(Math.round(num(p.drawers, 0)), 0, 40);
  const oven = flag(p.oven), dw = flag(p.dishwasher);
  const sp = [];
  if (sinkKind) sp.push({ role: 'sink', w: sinkKind === 'double' ? 0.8 : 0.6 });
  if (dw) sp.push({ role: 'dw', w: 0.6 });
  if (hobKind || oven) sp.push({ role: 'hob', w: 0.6 });
  let fixed = sp.reduce((s, m) => s + m.w, 0);
  if (fixed > w) { sp.forEach((m) => { m.w *= w / fixed; }); fixed = w; }
  let rest = w - fixed;
  if (sp.length && rest < 0.2) { sp.forEach((m) => { m.w += rest / sp.length; }); rest = 0; }
  let nr = rest <= 1e-6 ? 0 : Math.max(1, Math.round(rest / 0.5));
  if (!sp.length && doorsN && !drawersN) nr = Math.max(1, Math.min(Math.max(doorsN, Math.ceil(rest / 0.65)), Math.floor(rest / 0.25) || 1));
  const rw = nr ? rest / nr : 0, both = doorsN > 0 && drawersN > 0;
  const doorMods = both ? clamp(doorsN, 1, Math.max(1, nr - 1)) : 0;
  const hobDrawers = sp.some((m) => m.role === 'hob') && !oven && drawersN > 0;
  const drawerMods = (drawersN && !doorsN ? nr : both ? nr - doorMods : 0) + (hobDrawers ? 1 : 0);
  const per = drawersN ? (drawersN <= 4 ? drawersN : clamp(Math.round(drawersN / Math.max(1, drawerMods)), 2, 4)) : 3;
  const regular = (i) => {
    if (both) return nr === 1 && !sp.length ? { kind: 'combo' } : i < doorMods ? { kind: 'door' } : { kind: 'drawers', n: per };
    if (drawersN) return { kind: 'drawers', n: per };
    if (doorsN) return { kind: 'door' };
    return nr >= 3 && i === 0 ? { kind: 'drawers', n: 3 } : { kind: 'door' };
  };
  const wet = sp.some((m) => m.role !== 'hob'), hot = sp.some((m) => m.role === 'hob');
  const order = wet && hot ? ['b', 'c', 'a'] : wet || hot ? ['a', 'c'] : ['a'];
  const slots = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < nr; i++) slots[order[i % order.length]]++;
  const seq = [];
  let ri = 0;
  const pushReg = (k) => { for (let i = 0; i < k; i++) seq.push({ ...regular(ri++), w: rw }); };
  pushReg(slots.a);
  for (const m of sp) {
    if (m.role === 'hob') pushReg(slots.b);
    if (m.role === 'sink') seq.push({ kind: 'door', leaves: doorsN >= 2 || m.w > 0.62 ? 2 : 1, role: 'sink', w: m.w });
    else if (m.role === 'dw') seq.push({ kind: 'dw', role: 'dw', w: m.w });
    else seq.push({ kind: oven ? 'oven' : drawersN ? 'drawers' : 'door', n: per, role: 'hob', w: m.w });
  }
  pushReg(slots.c);
  let x = -w / 2;
  for (const m of seq) { m.x = x + m.w / 2; x += m.w; }
  return seq;
}

/** Everything the 3D model and the plan symbol of a base run need to agree on (metres). */
function baseSpec(w, d, p) {
  const sinkKind = sinkKindOf(p.sink), hobKind = hobKindOf(p.cooktop);
  const mods = baseModules(w, p, sinkKind, hobKind);
  const sm = mods.find((m) => m.role === 'sink'), hm = mods.find((m) => m.role === 'hob');
  const sink = sm ? sinkLayout(sinkKind, sm.x, sm.w, d / 2, d) : null;
  const hobW = hm && hobKind ? Math.min(0.58, hm.w - 0.02) : 0, hobD = Math.min(0.5, d - 0.08);
  return { mods, sink, sinkKind, hobKind, hobX: hm ? hm.x : 0, hobZ: Math.min(0.01, d / 2 - hobD / 2 - 0.04), hobW, hobD };
}

/** Carcass + plinth + fronts for the x-range x0..x1 of a base run. */
function baseCarcass(g, mods, x0, x1, o) {
  const { d, ph, yT, fm, pm, holes, handles, hMat } = o;
  const zF = d / 2 - OVH, zC = zF - FT - 0.002;
  g.add(deck(fm, x0, x1, -d / 2, zC, ph, yT - ph, holes));
  g.add(K.box(x1 - x0, yT - ph, 0.002, shadowMat(), (x0 + x1) / 2, (yT + ph) / 2, zC + 0.001));
  if (ph > 0.005) g.add(K.box(x1 - x0, ph, Math.max(0.02, d - OVH - 0.055), pm, (x0 + x1) / 2, ph / 2, -d / 2 + Math.max(0.02, d - OVH - 0.055) / 2));
  const F = frontKit(g, { zFace: zF, mat: fm, hMat, handles });
  const top = yT - (handles === 'none' ? 0.022 : 0);
  mods.forEach((m, i) => F.module(m, ph, m.kind === 'oven' ? yT : top, i));
}

function buildBase({ w, d, h, p }) {
  const g = new THREE.Group();
  const color = hex(p.color, WHITE), fm = cabinetMat(p, color), cm = counterMat(p), pm = plinthMat(p, color);
  const tc = clamp(num(p.counterThickness, 3) / 100, 0.012, Math.min(0.06, h * 0.25));
  const ph = clamp(num(p.plinth, 10) / 100, 0, Math.min(0.3, h * 0.35));
  const handles = pick(p.handles, ['bar', 'none', 'knob'], 'bar'), hMat = handleMat(p), yT = h - tc;
  const o = { d, ph, yT, fm, pm, handles, hMat, holes: null };
  if (flag(p.corner)) {
    // Blind corner unit: a full-depth block (hidden behind the perpendicular run) + a door on any remaining width.
    const bw = w > d + 0.2 ? Math.min(w, d) : w, x0 = w / 2 - bw;
    g.add(K.box(w, tc, d, cm, 0, h - tc / 2, 0));
    g.add(K.box(bw, yT - ph, d, fm, x0 + bw / 2, (yT + ph) / 2, 0));
    if (ph > 0.005) g.add(K.box(bw, ph, d, pm, x0 + bw / 2, ph / 2, 0));
    if (bw < w) baseCarcass(g, [{ kind: 'door', x: (-w / 2 + x0) / 2, w: x0 + w / 2 }], -w / 2, x0, o);
    return g;
  }
  const S = baseSpec(w, d, p);
  o.holes = S.sink ? S.sink.bowls : null;
  g.add(deck(cm, -w / 2, w / 2, -d / 2, d / 2, yT, tc, o.holes));
  baseCarcass(g, S.mods, -w / 2, w / 2, o);
  if (S.sink) {
    sinkBowls(g, S.sink.bowls, h);
    g.add(extra(at(tap('kitchen', pick(p.faucet, Object.keys(FINISH_HEX), 'chrome')), S.sink.tapX, h, S.sink.tapZ)));
  }
  if (S.hobKind && S.hobW > 0.1) g.add(extra(at(hob(S.hobKind, S.hobW, S.hobD, p.burners), S.hobX, h, S.hobZ)));
  return g;
}

function drawBase(ctx, { w, d, p, px }) {
  const fill = K.tint(counterHex(p), 0.3), lod = Math.min(w, d) / px;
  rect2(ctx, -w / 2, -d / 2, w, d, fill, null);
  if (flag(p.corner)) { rect2(ctx, -w / 2, -d / 2, w, d, null, SOFT, px); return; }
  K.line(ctx, -w / 2, -d / 2, w / 2, -d / 2, INK, px); K.line(ctx, -w / 2, d / 2, w / 2, d / 2, INK, px);
  K.line(ctx, -w / 2, -d / 2, -w / 2, d / 2, MID, px); K.line(ctx, w / 2, -d / 2, w / 2, d / 2, MID, px);
  if (lod > 16) K.line(ctx, -w / 2, d / 2 - 2.5, w / 2, d / 2 - 2.5, SOFT, px * 0.75);
  const S = baseSpec(w / 100, d / 100, p);
  if (lod > 16) for (const m of S.mods) if (m.kind === 'dw' || m.kind === 'oven') dashed(ctx, px, () => rect2(ctx, m.x * 100 - m.w * 50 + 1.5, -d / 2 + 3, m.w * 100 - 3, d - 7, null, SOFT, px), 3, 2.5);
  if (S.sink) sink2d(ctx, S.sink, px);
  if (S.hobKind && S.hobW > 0.1) hob2d(ctx, S.hobKind, S.hobX * 100, S.hobZ * 100, S.hobW * 100, S.hobD * 100, p.burners, px);
}
reg('kitchen-base', buildBase, drawBase);

// ───────── wall cabinet ─────────
function buildWallCab({ w, d, h, p, item }) {
  const g = new THREE.Group(), color = hex(p.color, WHITE), fm = cabinetMat(p, color);
  const handles = pick(p.handles, ['bar', 'none', 'knob'], 'bar'), hMat = handleMat(p);
  const open = flag(p.open), glassD = flag(p.glassDoors) && !open;
  const pr = open ? 0 : handles === 'bar' ? 0.024 : handles === 'knob' ? 0.022 : 0;
  const zF = d / 2 - pr, T = Math.min(0.018, w / 4, h / 4);
  const n = clamp(Math.round(num(p.doors, 0)) || Math.max(1, Math.round(w / 0.5)), 1, 12), lw = w / n;
  if (open || glassD) {
    const D = Math.max(0.01, zF + d / 2 - (open ? 0 : FT)), zc = -d / 2 + D / 2, inner = K.mat(K.shade(color, -0.07), { roughness: 0.6 });
    g.add(K.box(T, h, D, fm, -w / 2 + T / 2, h / 2, zc), K.box(T, h, D, fm, w / 2 - T / 2, h / 2, zc));
    g.add(K.box(w - 2 * T, T, D, fm, 0, T / 2, zc), K.box(w - 2 * T, T, D, fm, 0, h - T / 2, zc));
    g.add(K.box(w - 2 * T, h - 2 * T, 0.006, inner, 0, h / 2, -d / 2 + 0.003));
    const ns = clamp(Math.round(h / 0.33) - 1, 0, 6), nd = clamp(Math.round(w / 0.8) - 1, 0, 8), sy = [T];
    for (let i = 1; i <= ns; i++) { const y = (h * i) / (ns + 1); sy.push(y + T / 2); g.add(K.box(w - 2 * T, T, D - 0.012, fm, 0, y, zc - 0.006)); }
    for (let i = 1; i <= nd; i++) g.add(K.box(T, h - 2 * T, D - 0.012, fm, -w / 2 + (w * i) / (nd + 1), h / 2, zc - 0.006));
    // a little crockery so the shelves read as a kitchen
    const rnd = K.rng(K.hashStr((item && item.id) || 'kitchen-wall')), cer = K.ceramic('#f4f2ee'), bay = w / (nd + 1), gap = h / (ns + 1) - T;
    for (let b = 0; b <= nd; b++) sy.forEach((y0, si) => {
      const cx = -w / 2 + bay * (b + 0.5), kind = Math.floor(rnd() * 3), s = Math.min(1, (D - 0.03) / 0.26, bay / 0.5, gap / 0.2);
      if (s < 0.3) return;
      if (kind === 0) { for (let k = 0; k < 3; k++) g.add(K.cylOn(0.1 * s, 0.07 * s, 0.014 * s, cer, cx - bay * 0.14, y0 + k * 0.015 * s, zc, 20)); g.add(K.cylOn(0.045 * s, 0.035 * s, 0.11 * s, K.ceramic(si % 2 ? '#c9b79a' : '#8fa39a'), cx + bay * 0.2, y0, zc, 14)); }
      else if (kind === 1) { for (let k = 0; k < 2; k++) g.add(K.cylOn(0.075 * s, 0.04 * s, 0.05 * s, cer, cx + (k - 0.5) * bay * 0.4, y0, zc, 18)); }
      else for (let k = 0; k < 3; k++) g.add(noShadow(K.cylOn(0.032 * s, 0.028 * s, 0.1 * s, K.glass('#dbe9ec', 0.4), cx + (k - 1) * 0.085 * s, y0, zc, 12)));
    });
  } else {
    const D = Math.max(0.01, zF + d / 2 - FT - 0.002);
    g.add(K.box(w, h, D, fm, 0, h / 2, -d / 2 + D / 2), K.box(w, h, 0.002, shadowMat(), 0, h / 2, -d / 2 + D + 0.001));
  }
  if (open) return g;
  const F = frontKit(g, { zFace: zF, mat: fm, hMat, handles }), flaps = h < 0.45;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + lw * (i + 0.5), side = n === 1 ? 1 : i % 2 ? -1 : 1;
    if (glassD) {
      const fr = Math.min(0.045, lw * 0.18), s = rrShape(lw - GAP, h - GAP, 0, x, h / 2);
      s.holes.push(rrShape(lw - GAP - 2 * fr, h - GAP - 2 * fr, 0, x, h / 2, THREE.Path));
      g.add(upright(s, FT, fm, zF - FT));
      g.add(noShadow(K.box(lw - 2 * fr, h - 2 * fr, 0.004, K.glass('#d8e8ec', 0.25), x, h / 2, zF - FT / 2)));
      if (handles === 'bar') g.add(barHandle(clamp(h * 0.2, 0.06, 0.2), hMat, x + side * (lw / 2 - fr / 2), Math.min(h / 2, 0.05 + clamp(h * 0.2, 0.06, 0.2) / 2), zF, true));
      else if (handles === 'knob') g.add(cylZ(0.011, 0.022, hMat, x + side * (lw / 2 - fr / 2), 0.06, zF + 0.011));
    } else if (flaps) F.drawer(x, 0, h, lw, 'bottom');
    else F.door(x, 0, h, lw, side, 'bottom');
  }
  return g;
}
function drawWallCab(ctx, { w, d, p, px }) {
  rect2(ctx, -w / 2, -d / 2, w, d, 'rgba(255,255,255,0.45)', null);
  dashed(ctx, px, () => {
    rect2(ctx, -w / 2, -d / 2, w, d, null, MID, px);
    if (!flag(p.open) && d / px > 14) K.line(ctx, -w / 2, d / 2 - 2, w / 2, d / 2 - 2, SOFT, px * 0.75);
  });
}
reg('kitchen-wall', buildWallCab, drawWallCab);

// ───────── tall unit ─────────
/** Columns of a tall bank, left → right: oven/microwave tower, pantry columns, integrated fridge. */
function tallColumns(w, p) {
  const nCol = Math.max(1, Math.round(w / 0.55));
  const tower = flag(p.oven) || flag(p.microwave), fr = flag(p.fridge) && (nCol >= 2 || !tower);
  const nApp = (tower ? 1 : 0) + (fr ? 1 : 0), nPlain = Math.max(0, nCol - nApp);
  const aw = nPlain ? Math.min(0.6, (w - nPlain * 0.3) / nApp || 0.6) : w / Math.max(1, nApp), pw = nPlain ? (w - nApp * aw) / nPlain : 0;
  const cols = [];
  if (tower) cols.push({ kind: 'tower', w: aw });
  for (let i = 0; i < nPlain; i++) cols.push({ kind: 'plain', w: pw });
  if (fr) cols.push({ kind: 'fridge', w: aw });
  let x = -w / 2;
  for (const c of cols) { c.x = x + c.w / 2; x += c.w; }
  return { cols, nPlain };
}
function buildTall({ w, d, h, p }) {
  const g = new THREE.Group(), color = hex(p.color, WHITE), fm = cabinetMat(p, color), pm = plinthMat(p, color);
  const handles = pick(p.handles, ['bar', 'none', 'knob'], 'bar'), hMat = handleMat(p);
  const ph = clamp(num(p.plinth, 10) / 100, 0, Math.min(0.3, h * 0.2));
  const zF = d / 2 - (handles === 'none' ? 0 : OVH), zC = zF - FT - 0.002, s = Math.min(1, h / 2.1);
  g.add(K.box(w, h - ph, zC + d / 2, fm, 0, (h + ph) / 2, (zC - d / 2) / 2));
  g.add(K.box(w, h - ph, 0.002, shadowMat(), 0, (h + ph) / 2, zC + 0.001));
  if (ph > 0.005) g.add(K.box(w, ph, Math.max(0.02, zF + d / 2 - 0.055), pm, 0, ph / 2, -d / 2 + Math.max(0.02, zF + d / 2 - 0.055) / 2));
  const F = frontKit(g, { zFace: zF, mat: fm, hMat, handles });
  const { cols, nPlain } = tallColumns(w, p);
  const doorsN = Math.round(num(p.doors, 0)), per = clamp(doorsN > 0 ? Math.round(doorsN / Math.max(1, nPlain)) : h > 2.3 ? 2 : 1, 1, 3);
  let pi = 0;
  for (const c of cols) {
    const m = { x: c.x, w: c.w, leaves: c.w > 0.66 ? 2 : 1 };
    if (c.kind === 'plain') {
      const idx = pi++;
      if (per === 1) F.doors(m, ph, h, idx, Math.min(1.05, ph + (h - ph) * 0.5));
      else {
        const cuts = per === 2 ? [0.64] : [0.42, 0.74];
        let y0 = ph;
        cuts.concat(1).forEach((f, k) => { const y1 = ph + (h - ph) * f; F.doors(m, y0, y1, idx, k === 0 ? 'top' : 'bottom'); y0 = y1; });
      }
    } else if (c.kind === 'tower') {
      const oven = flag(p.oven), mw = flag(p.microwave);
      let y = Math.max(ph + 0.12, (oven ? 0.74 : 1.0) * s);
      F.drawers({ ...m, n: 2 }, ph, y);
      if (oven) { const oh = Math.min(0.595 * s, h - y); g.add(at(ovenFront(c.w - GAP, oh - GAP), c.x, y + GAP / 2, zF - FT)); y += oh; }
      if (mw && h - y > 0.2) { const mh = Math.min(0.385 * s, h - y); g.add(at(microFront(c.w - GAP, mh - GAP), c.x, y + GAP / 2, zF - FT)); y += mh; }
      if (h - y > 0.1) F.doors(m, y, h, 0, 'bottom'); else if (h - y > 0.004) F.panel(c.x, y, h, c.w);
    } else {
      const yf = Math.min(ph + 0.7 * s, h * 0.45), hl = clamp(h * 0.22, 0.1, 0.5);
      F.panel(c.x, ph, yf, c.w); F.panel(c.x, yf, h, c.w);
      if (handles !== 'none') { g.add(barHandle(Math.min(hl, yf - ph - 0.1), hMat, c.x - c.w / 2 + 0.04, yf - 0.06 - Math.min(hl, yf - ph - 0.1) / 2, zF, true)); g.add(barHandle(hl, hMat, c.x - c.w / 2 + 0.04, yf + 0.06 + hl / 2, zF, true)); }
      if (ph > 0.04) g.add(slats(3, c.w - 0.08, 0.008, 0.004, 0.02, steelDark()).translateX(c.x).translateY(ph / 2).translateZ(zF - 0.055 + 0.002));
    }
  }
  return g;
}
function drawTall(ctx, { w, d, p, px }) {
  rect2(ctx, -w / 2, -d / 2, w, d, K.tint(hex(p.color, WHITE), 0.35), null);
  K.line(ctx, -w / 2, -d / 2, w / 2, -d / 2, INK, px); K.line(ctx, -w / 2, d / 2, w / 2, d / 2, INK, px);
  K.line(ctx, -w / 2, -d / 2, -w / 2, d / 2, MID, px); K.line(ctx, w / 2, -d / 2, w / 2, d / 2, MID, px);
  if (Math.min(w, d) / px < 14) return;
  for (const c of tallColumns(w / 100, p).cols) {
    const x0 = (c.x - c.w / 2) * 100, x1 = (c.x + c.w / 2) * 100;
    if (x0 > -w / 2 + 1) K.line(ctx, x0, -d / 2, x0, d / 2, SOFT, px * 0.75);
    K.line(ctx, x0, -d / 2, x1, d / 2, SOFT, px * 0.75);
    if (c.kind === 'plain') K.line(ctx, x1, -d / 2, x0, d / 2, SOFT, px * 0.75);
    else if (c.kind === 'tower') rect2(ctx, x0 + 4, d / 2 - 5, x1 - x0 - 8, 2.2, '#3d4046', null);
    else rect2(ctx, x0 + 3, -d / 2 + 3, x1 - x0 - 6, d - 8, null, SOFT, px * 0.75);
  }
}
reg('kitchen-tall', buildTall, drawTall);

// ───────── island ─────────
function islandSpec(w, d, p) {
  const ov = clamp(num(p.overhang, d >= 0.85 ? 25 : 0) / 100, 0, Math.max(0, d - 0.3));
  const waterfall = flag(p.waterfall), tc = clamp(num(p.counterThickness, 4) / 100, 0.012, 0.08);
  const inset = waterfall ? tc : Math.min(0.02, w * 0.05), bw = w - 2 * inset;
  const zB = -d / 2 + OVH, zFr = d / 2 - (ov > 0.03 ? ov : OVH);          // working (back) face and seating-side face of the carcass
  const sinkKind = sinkKindOf(p.sink), hobKind = hobKindOf(p.cooktop);
  const both = sinkKind && hobKind, sx = both ? -bw / 4 : 0, hx = both ? bw / 4 : 0, avail = both ? bw / 2 - 0.04 : bw - 0.04;
  const bodyD = zFr - zB;
  // the cook stands at −Z: lay the sink out mirrored, then flip z
  const S0 = sinkKind ? sinkLayout(sinkKind, sx, Math.min(avail, sinkKind === 'double' ? 0.9 : 0.62), d / 2, Math.min(0.62, bodyD + OVH)) : null;
  const sink = S0 ? { bowls: S0.bowls.map((b) => ({ ...b, z: -b.z })), tapX: S0.tapX, tapZ: -S0.tapZ } : null;
  const hobW = hobKind ? Math.min(hx || w < 1.2 ? 0.58 : 0.78, avail) : 0, hobD = Math.min(0.5, bodyD - 0.06);
  // fronts on the working side
  const doorsN = clamp(Math.round(num(p.doors, 0)), 0, 30), drawersN = clamp(Math.round(num(p.drawers, 0)), 0, 30);
  let n = doorsN + drawersN;
  if (!n || bw / n < 0.3 || bw / n > 1.0) n = Math.max(1, Math.round(bw / 0.6));
  const nDraw = doorsN + drawersN === n ? drawersN : drawersN && !doorsN ? n : doorsN && !drawersN ? 0 : Math.ceil(n / 2);
  const mods = Array.from({ length: n }, (_, i) => ({ x: -bw / 2 + (bw / n) * (i + 0.5), w: bw / n, kind: i < nDraw ? 'drawers' : 'door', n: 3 }));
  if (sink) for (const m of mods) if (Math.abs(m.x - sx) < m.w / 2 + 0.15) m.kind = 'door';
  return { ov, waterfall, tc, inset, bw, zB, zFr, sink, sinkKind, hobKind, hobX: hx, hobZ: zB + 0.07 + hobD / 2, hobW, hobD, mods };
}
function buildIsland({ w, d, h, p }) {
  const g = new THREE.Group(), color = hex(p.color, WHITE), fm = cabinetMat(p, color), cm = counterMat(p), pm = plinthMat(p, color);
  const S = islandSpec(w, d, p), tc = Math.min(S.tc, h * 0.25), yT = h - tc, ph = clamp(num(p.plinth, 10) / 100, 0, Math.min(0.3, h * 0.35));
  const handles = pick(p.handles, ['bar', 'none', 'knob'], 'bar'), hMat = handleMat(p), holes = S.sink ? S.sink.bowls : null;
  const x0 = -S.bw / 2, x1 = S.bw / 2, zb = S.zB + FT + 0.002, twoSided = S.ov <= 0.03 && d >= 0.9, zf = twoSided ? S.zFr - FT - 0.002 : S.zFr;
  g.add(deck(cm, -w / 2, w / 2, -d / 2, d / 2, yT, tc, holes));
  if (S.waterfall) for (const k of [-1, 1]) g.add(K.box(tc, yT, d, cm, k * (w / 2 - tc / 2), yT / 2, 0));
  g.add(deck(fm, x0, x1, zb, zf, ph, yT - ph, holes));
  g.add(K.box(S.bw, yT - ph, 0.002, shadowMat(), 0, (yT + ph) / 2, zb - 0.001));
  if (ph > 0.005) g.add(K.box(S.bw - (S.waterfall ? 0 : 0.08), ph, Math.max(0.02, S.zFr - S.zB - 0.11), pm, 0, ph / 2, (S.zFr + S.zB) / 2));
  const top = yT - (handles === 'none' ? 0.022 : 0);
  const F = frontKit(g, { zFace: S.zB, mat: fm, hMat, handles, dir: -1 });
  S.mods.forEach((m, i) => F.module(m, ph, top, i));
  if (twoSided) {
    g.add(K.box(S.bw, yT - ph, 0.002, shadowMat(), 0, (yT + ph) / 2, zf + 0.001));
    const F2 = frontKit(g, { zFace: S.zFr, mat: fm, hMat, handles }), n2 = Math.max(1, Math.round(S.bw / 0.5));
    for (let i = 0; i < n2; i++) F2.door(x0 + (S.bw / n2) * (i + 0.5), ph, top, S.bw / n2, i % 2 ? -1 : 1);
  }
  if (S.sink) {
    sinkBowls(g, S.sink.bowls, h);
    const t = tap('kitchen', pick(p.faucet, Object.keys(FINISH_HEX), 'chrome')); t.rotation.y = Math.PI;
    g.add(extra(at(t, S.sink.tapX, h, S.sink.tapZ)));
  }
  if (S.hobKind && S.hobW > 0.1) { const hb = hob(S.hobKind, S.hobW, S.hobD, p.burners); hb.rotation.y = Math.PI; g.add(extra(at(hb, S.hobX, h, S.hobZ))); }
  return g;
}
function drawIsland(ctx, { w, d, p, px }) {
  const S = islandSpec(w / 100, d / 100, p), lod = Math.min(w, d) / px;
  rr2(ctx, 0, 0, w, d, 1, K.tint(counterHex(p), 0.3), INK, px);
  if (lod > 16) dashed(ctx, px, () => rect2(ctx, -S.bw * 50, S.zB * 100, S.bw * 100, (S.zFr - S.zB) * 100, null, SOFT, px), 4, 3);
  if (S.waterfall) for (const k of [-1, 1]) K.line(ctx, k * (w / 2 - S.tc * 100), -d / 2, k * (w / 2 - S.tc * 100), d / 2, MID, px);
  if (S.sink) sink2d(ctx, S.sink, px, 1);
  if (S.hobKind && S.hobW > 0.1) hob2d(ctx, S.hobKind, S.hobX * 100, S.hobZ * 100, S.hobW * 100, S.hobD * 100, p.burners, px, -1);
}
reg('kitchen-island', buildIsland, drawIsland);

// ═════════════════════════ LARGE APPLIANCES ═════════════════════════
const polished = () => K.mat('#d6d9dd', { roughness: 0.2, metalness: 0.8 });
/** Chunky appliance handle projecting `out` towards +Z from the face it is placed on. */
function grip(len, out, material, x, y, z, vertical = false) {
  const L = Math.max(0.05, Math.round(len * 100) / 100);
  const m = merged(`gr|${mm(L)}|${mm(out)}`, () => [gBox(L, 0.02, 0.016, 0, 0, out - 0.008), gBox(0.016, 0.018, out - 0.012, -L / 2 + 0.03, 0, (out - 0.012) / 2), gBox(0.016, 0.018, out - 0.012, L / 2 - 0.03, 0, (out - 0.012) / 2)], material, x, y, z);
  if (vertical) m.rotation.z = Math.PI / 2;
  return m;
}

const FRIDGES = ['french-door', 'side-by-side', 'top-freezer', 'bottom-freezer', 'single', '4-door', 'mini', 'wine'];
function buildFridge({ w, d, h, p }) {
  const g = new THREE.Group(), v = pick(p.variant, FRIDGES, 'french-door');
  const color = hex(p.color, STAINLESS), bm = applianceMat(color, p.material), hm = polished();
  const sideM = K.mat(K.shade(color, -0.35), { roughness: 0.5, metalness: 0.25 });
  const HP = Math.min(0.04, d * 0.1), DT = Math.min(0.06, d * 0.14), G = 0.005;
  const foot = Math.min(0.035, h * 0.04), top = h - 0.008, zD = d / 2 - HP, zBody = zD - DT - 0.004, y0 = foot + 0.003, y1 = top, H = y1 - y0;
  const wine = v === 'wine', nook = wine ? Math.min(0.1, d * 0.2) : 0;
  g.add(K.box(w - 0.004, top - foot, zBody - nook + d / 2, sideM, 0, (top + foot) / 2, (zBody - nook - d / 2) / 2));
  g.add(K.box(w - 0.03, foot, d - HP - 0.05, darkPlastic(), 0, foot / 2, -HP / 2 - 0.02));
  for (const k of [-1, 1]) g.add(K.box(Math.min(0.06, w * 0.15), 0.008, DT, darkPlastic(), k * (w / 2 - Math.min(0.06, w * 0.15) / 2 - 0.01), h - 0.004, zD - DT / 2));
  const door = (xa, xb, ya, yb) => g.add(K.rbox(xb - xa - G, yb - ya - G, DT, bm, (xa + xb) / 2, (ya + yb) / 2, zD - DT / 2, 0.007, 2));
  const hv = (x, ya, yb) => g.add(grip(Math.max(0.06, yb - ya), HP, hm, x, (ya + yb) / 2, zD, true));
  const hh = (y, len) => g.add(grip(len, HP, hm, 0, y, zD));
  const L = -w / 2, R = w / 2, e = Math.min(0.045, w * 0.1);
  if (wine) {
    const fr = Math.min(0.05, w * 0.12), DTw = Math.min(0.03, DT), zi = zBody - nook, dark = shadowMat();
    for (const k of [-1, 1]) g.add(K.box(0.02, top - foot, nook + DT - DTw, sideM, k * (w / 2 - 0.012), (top + foot) / 2, zi + (nook + DT - DTw) / 2));
    g.add(K.box(w - 0.044, 0.02, nook, sideM, 0, top - 0.01, zi + nook / 2), K.box(w - 0.044, 0.03, nook, sideM, 0, foot + 0.015, zi + nook / 2));
    g.add(K.box(w - 0.044, top - foot, 0.002, dark, 0, (top + foot) / 2, zi + 0.001));
    const rows = clamp(Math.round((H - 0.12) / 0.105), 1, 18), pitch = (H - 0.12) / rows, per = clamp(Math.floor((w - 0.1) / 0.09), 1, 8);
    g.add(at(slats(rows, w - 0.05, 0.014, 0.02, pitch, K.wood('#b98a5e')), 0, y0 + H / 2 - 0.035, zi + nook - 0.012));
    g.add(merged(`wb|${rows}|${per}|${mm(pitch)}|${mm(w)}`, () => Array.from({ length: rows * per }, (_, i) => gCyl(0.036, 0.03, ((i % per) - (per - 1) / 2) * ((w - 0.1) / per), (Math.floor(i / per) - (rows - 1) / 2) * pitch, 0, 'z', 8)), K.mat('#20301f', { roughness: 0.2 }), 0, y0 + H / 2 + 0.012, zi + nook - 0.03));
    const s = rrShape(w - G, H - G, 0.006, 0, y0 + H / 2);
    s.holes.push(rrShape(w - G - 2 * fr, H - G - 2 * fr, 0.004, 0, y0 + H / 2, THREE.Path));
    g.add(upright(s, DTw, bm, zD - DTw));
    g.add(noShadow(K.box(w - 2 * fr, H - 2 * fr, 0.006, K.glass('#2b3338', 0.42), 0, y0 + H / 2, zD - DTw / 2)));
    hv(L + fr / 2, y0 + H * 0.3, y0 + H * 0.7);
    return g;
  }
  let dispX = 0, dispOK = false;
  if (v === 'french-door' || v === '4-door') {
    const fy = y0 + H * (v === '4-door' ? 0.42 : 0.36);
    door(L, 0, fy, y1); door(0, R, fy, y1);
    const hl = Math.min(0.62, (y1 - fy) * 0.62);
    hv(-e, fy + 0.07, fy + 0.07 + hl); hv(e, fy + 0.07, fy + 0.07 + hl);
    if (v === '4-door') { door(L, 0, y0, fy); door(0, R, y0, fy); hv(-e, fy - 0.07 - Math.min(0.4, (fy - y0) * 0.6), fy - 0.07); hv(e, fy - 0.07 - Math.min(0.4, (fy - y0) * 0.6), fy - 0.07); }
    else if (h >= 1.6) { const fm = y0 + H * 0.24; door(L, R, y0, fm); door(L, R, fm, fy); hh(fm - 0.06, w * 0.72); hh(fy - 0.045, w * 0.72); }
    else { door(L, R, y0, fy); hh(fy - 0.06, w * 0.72); }
    dispX = -w / 4 - e / 2; dispOK = true;
  } else if (v === 'side-by-side') {
    const sx = L + w * 0.45;
    door(L, sx, y0, y1); door(sx, R, y0, y1);
    hv(sx - e, y0 + H * 0.3, y0 + H * 0.78); hv(sx + e, y0 + H * 0.3, y0 + H * 0.78);
    dispX = (L + sx) / 2 - e / 2; dispOK = true;
  } else if (v === 'top-freezer' || v === 'bottom-freezer') {
    const fy = y0 + H * (v === 'top-freezer' ? 0.7 : 0.36);
    door(L, R, y0, fy); door(L, R, fy, y1);
    hv(L + e, fy - 0.06 - Math.min(0.4, (fy - y0) * 0.5), fy - 0.06); hv(L + e, fy + 0.06, fy + 0.06 + Math.min(0.4, (y1 - fy) * 0.5));
  } else {
    door(L, R, y0, y1);
    const hl = v === 'mini' ? Math.min(0.2, H * 0.35) : Math.min(0.6, H * 0.4);
    hv(L + e, y0 + H * 0.62 - hl / 2, y0 + H * 0.62 + hl / 2);
    if (v === 'mini' && H > 0.5) g.add(K.box(w - 0.02, 0.003, 0.002, shadowMat(), 0, y0 + H * 0.78, zD + 0.0005));
    dispX = w * 0.12; dispOK = v === 'single';
  }
  if (flag(p.dispenser) && dispOK && h > 1.2) {
    const dw = Math.min(0.18, w * 0.3), dy = clamp(1.18, y0 + H * 0.5, y1 - 0.3);
    g.add(K.box(dw, 0.3, 0.004, blackGlass(), dispX, dy, zD + 0.002), K.box(dw - 0.03, 0.15, 0.002, shadowMat(), dispX, dy - 0.06, zD + 0.0045));
    g.add(K.box(dw - 0.02, 0.008, 0.02, steelDark(), dispX, dy - 0.14, zD + 0.01), noShadow(K.box(dw - 0.06, 0.03, 0.001, lcd(), dispX, dy + 0.085, zD + 0.0046)));
  }
  return g;
}
function drawFridge(ctx, { w, d, p, px }) {
  const v = pick(p.variant, FRIDGES, 'french-door'), dbl = v === 'french-door' || v === 'side-by-side' || v === '4-door';
  rr2(ctx, 0, 0, w, d, 2, K.tint(hex(p.color, STAINLESS), 0.5), INK, px);
  if (Math.min(w, d) / px < 12) return;
  const dt = Math.min(7, d * 0.12), split = v === 'side-by-side' ? -w / 2 + w * 0.45 : 0;
  K.line(ctx, -w / 2, d / 2 - dt, w / 2, d / 2 - dt, INK, px);
  if (dbl) K.line(ctx, split, d / 2 - dt, split, d / 2, INK, px);
  // door-swing hint
  ctx.save(); ctx.strokeStyle = SOFT; ctx.lineWidth = px * 0.75; ctx.setLineDash([3 * px, 3 * px]);
  const swing = (hx, r, dir) => { ctx.beginPath(); ctx.arc(hx, d / 2, r, dir > 0 ? 0 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI); ctx.stroke(); ctx.beginPath(); ctx.moveTo(hx, d / 2); ctx.lineTo(hx, d / 2 + r); ctx.stroke(); };
  if (dbl) { swing(-w / 2, split + w / 2, 1); swing(w / 2, w / 2 - split, -1); } else swing(w / 2, w, -1);
  ctx.restore();
}
reg('fridge', buildFridge, drawFridge);

// ───────── range / oven ─────────
function buildRange({ w, d, h, p }) {
  const g = new THREE.Group(), v = pick(p.variant, ['freestanding', 'built-in-oven', 'double-oven'], 'freestanding');
  const color = hex(p.color, STAINLESS), bm = applianceMat(color, p.material), darkBody = hsl(color).l < 0.3;
  const zF = d / 2 - OVH;
  if (v !== 'freestanding') {
    const n = v === 'double-oven' ? 2 : 1;
    g.add(K.box(w - 0.03, h - 0.01, zF - FT + d / 2, steelDark(), 0, h / 2, (zF - FT - d / 2) / 2));
    for (let i = 0; i < n; i++) g.add(at(ovenFront(w, h / n - (n > 1 ? GAP : 0), !darkBody), 0, (i * h) / n + (i ? GAP : 0), zF - FT));
    return g;
  }
  const hk = pick(p.cooktop, ['gas', 'induction', 'ceramic', 'none'], 'gas'), hobH = hk === 'gas' ? Math.min(0.03, h * 0.05) : hk === 'none' ? 0 : 0.006;
  const topY = h - hobH, foot = Math.min(0.05, h * 0.06), cb = Math.min(0.1, h * 0.12), dh = Math.min(0.13, h * 0.16);
  g.add(K.box(w, topY - foot, zF - FT + d / 2, bm, 0, (topY + foot) / 2, (zF - FT - d / 2) / 2));
  g.add(K.box(w - 0.04, foot, d - 0.12, darkPlastic(), 0, foot / 2, -0.03));
  g.add(K.box(w, cb - GAP, FT, bm, 0, topY - cb / 2, zF - FT / 2), K.box(w, dh - GAP, FT, bm, 0, foot + dh / 2, zF - FT / 2));
  g.add(at(ovenFront(w, topY - cb - foot - dh - GAP, false, true), 0, foot + dh, zF - FT));
  const nb = hk === 'none' ? 4 : burnerLayout(hk, w - 0.02, d - 0.08, p.burners).length, nk = nb + 1, kp = Math.min(0.09, (w * 0.86) / nk);
  g.add(merged(`rk|${nk}|${mm(kp)}`, () => Array.from({ length: nk }, (_, i) => gCyl(0.017, 0.022, (i - (nk - 1) / 2) * kp, 0, 0.011, 'z', 16, 0.015)), darkBody ? steel() : darkPlastic(), 0, topY - cb / 2, zF));
  if (hk !== 'none') g.add(at(hob(hk, w - 0.02, d - 0.08, p.burners, hobH, darkBody, false), 0, topY, -0.01));
  return g;
}
function drawRange(ctx, { w, d, p, px }) {
  const v = pick(p.variant, ['freestanding', 'built-in-oven', 'double-oven'], 'freestanding');
  const hk = v === 'freestanding' ? pick(p.cooktop, ['gas', 'induction', 'ceramic', 'none'], 'gas') : 'none';
  rr2(ctx, 0, 0, w, d, 1.5, K.tint(hex(p.color, STAINLESS), 0.55), INK, px);
  if (Math.min(w, d) / px < 12) return;
  if (hk !== 'none') hob2d(ctx, hk, 0, -1.5, w - 4, d - 9, p.burners, px);
  else dashed(ctx, px, () => rect2(ctx, -w / 2 + 3, -d / 2 + 3, w - 6, d - 10, null, SOFT, px), 3, 2.5);
  rect2(ctx, -w * 0.4, d / 2 - 3.2, w * 0.8, 1.8, '#3d4046', null);
}
reg('range', buildRange, drawRange);

const HOBS = ['gas', 'induction', 'ceramic', 'domino'];
function buildCooktop({ w, d, h, p }) {
  const v = pick(p.variant, HOBS, 'gas'), kind = v === 'domino' ? 'induction' : v, burners = v === 'domino' ? num(p.burners, 2) : p.burners;
  if (kind === 'gas') return hob('gas', w, d, burners, Math.max(0.02, h), hsl(hex(p.color, STAINLESS)).l < 0.3);
  const g = new THREE.Group(), t = 0.006;
  if (h > 0.012) g.add(K.box(w - 0.04, h - t, d - 0.04, darkPlastic(), 0, (h - t) / 2, 0));
  g.add(at(hob(kind, w, d, burners), 0, Math.max(0, h - t), 0));
  return g;
}
function drawCooktop(ctx, { w, d, p, px }) {
  const v = pick(p.variant, HOBS, 'gas');
  hob2d(ctx, v === 'domino' ? 'induction' : v, 0, 0, w, d, v === 'domino' ? num(p.burners, 2) : p.burners, px);
}
reg('cooktop', buildCooktop, drawCooktop);

// ───────── hood ─────────
const HOODS = ['chimney', 'island', 'built-in', 'slanted', 'downdraft'];
function buildHood({ w, d, h, p }) {
  const g = new THREE.Group(), v = pick(p.variant, HOODS, 'chimney');
  const color = hex(p.color, STAINLESS), bm = applianceMat(color, p.material);
  const dw = Math.min(0.3, w * 0.55), dd = Math.min(0.26, d * 0.62);
  const under = (zc, dz) => {
    g.add(K.box(w * 0.84, 0.004, dz * 0.74, steelDark(), 0, -0.0005, zc));
    g.add(noShadow(merged(`hl|${mm(w)}`, () => [gCyl(0.022, 0.004, -w * 0.3, 0, 0, 'y', 12), gCyl(0.022, 0.004, w * 0.3, 0, 0, 'y', 12)], K.glow('#fff3d6', 0.9), 0, -0.002, zc + dz * 0.3)));
  };
  if (v === 'chimney' || v === 'island') {
    const isl = v === 'island', classic = p.style === 'classic' || p.style === 'rustic';
    const ch = classic ? Math.min(h * 0.5, 0.22) : clamp(h * 0.12, 0.03, 0.08), zc = isl ? 0 : -d / 2 + dd / 2;
    if (classic) g.add(hull({ x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 }, { x0: -dw / 2, x1: dw / 2, z0: zc - dd / 2, z1: zc + dd / 2 }, 0.02, ch, bm), K.box(w, 0.02, d, bm, 0, 0.01, 0));
    else g.add(K.box(w, ch, d, bm, 0, ch / 2, 0), K.box(Math.min(0.16, w * 0.3), Math.min(0.014, ch * 0.4), 0.002, blackGlass(), 0, ch / 2, d / 2 - 0.0005));
    if (h - ch > 0.01) g.add(K.box(dw, h - ch, dd, bm, 0, (h + ch) / 2, zc));
    under(0, d);
  } else if (v === 'slanted') {
    const uh = h > 0.7 ? Math.min(0.45, h * 0.55) : h, zb = -d / 2, za = zb + d * 0.3, dy = uh * 0.86, dz = d / 2 - za, len = Math.hypot(dy, dz);
    g.add(profileX([[zb, 0], [za, 0], [d / 2, dy], [d / 2, uh], [zb, uh]], w, darkPlastic()));
    const gl = K.box(w - 0.012, 0.006, len - 0.02, blackGlass(), 0, dy / 2 + 0.004 * (dz / len) - 0.004, (za + d / 2) / 2 + 0.004 * (dy / len) - 0.002);
    gl.rotation.x = -Math.atan2(dy, dz); g.add(gl);
    g.add(K.box(w, 0.012, 0.004, bm, 0, uh - 0.006, d / 2 - 0.002));
    if (h - uh > 0.01) g.add(K.box(dw, h - uh, dd, bm, 0, (h + uh) / 2, zb + dd / 2));
  } else if (v === 'built-in') {
    const sh = Math.min(0.035, h * 0.3);
    g.add(K.box(w, h - sh, d - 0.02, enamel(hex(p.color2, '#ecebe7')), 0, sh + (h - sh) / 2, -0.01), K.box(w, sh, d, bm, 0, sh / 2, 0));
    g.add(K.box(Math.min(0.12, w * 0.25), sh * 0.4, 0.002, blackGlass(), w * 0.3, sh / 2, d / 2 - 0.0005));
    under(-0.01, d);
  } else {
    const bh = Math.min(0.05, h * 0.2), t = Math.min(0.06, d * 0.6);
    g.add(K.box(w, bh, d, steelDark(), 0, bh / 2, 0), K.box(w, h - bh, t, bm, 0, (h + bh) / 2, -d / 2 + t / 2));
    g.add(K.box(w - 0.06, Math.min(0.04, h * 0.15), 0.003, shadowMat(), 0, h - Math.min(0.06, h * 0.2), -d / 2 + t + 0.001), K.box(w, 0.006, t, blackGlass(), 0, h - 0.003, -d / 2 + t / 2));
  }
  return g;
}
function drawHood(ctx, { w, d, p, px }) {
  const v = pick(p.variant, HOODS, 'chimney'), dw = Math.min(30, w * 0.55), dd = Math.min(26, d * 0.62);
  rect2(ctx, -w / 2, -d / 2, w, d, 'rgba(255,255,255,0.35)', null);
  dashed(ctx, px, () => {
    rect2(ctx, -w / 2, -d / 2, w, d, null, MID, px);
    if (Math.min(w, d) / px > 14 && v !== 'downdraft' && v !== 'built-in') rect2(ctx, -dw / 2, v === 'island' ? -dd / 2 : -d / 2, dw, dd, null, SOFT, px);
  }, 4, 3);
}
reg('hood', buildHood, drawHood);

// ───────── dishwasher ─────────
function buildDishwasher({ w, d, h, p }) {
  const g = new THREE.Group(), v = pick(p.variant, ['freestanding', 'integrated', 'slim'], 'freestanding');
  if (v === 'integrated') {
    const color = hex(p.color, WHITE), fm = cabinetMat(p, color), ph = Math.min(0.1, h * 0.14), zF = d / 2 - OVH;
    g.add(K.box(w - 0.006, h - ph - 0.004, zF - FT + d / 2 - 0.002, K.mat('#4a4c50', { roughness: 0.5, metalness: 0.4 }), 0, ph + (h - ph - 0.004) / 2, (zF - FT - 0.002 - d / 2) / 2));
    g.add(K.box(w - 0.006, h - ph, 0.002, shadowMat(), 0, (h + ph) / 2, zF - FT - 0.001), K.box(w, ph, Math.max(0.02, d - OVH - 0.055), plinthMat(p, color), 0, ph / 2, -(OVH + 0.055) / 2));
    frontKit(g, { zFace: zF, mat: fm, hMat: handleMat(p), handles: pick(p.handles, ['bar', 'none', 'knob'], 'bar') }).module({ kind: 'dw', x: 0, w }, ph, h, 0);
    return g;
  }
  const color = hex(p.color, STAINLESS), bm = applianceMat(color, p.material), toe = Math.min(0.1, h * 0.12), cs = Math.min(0.1, h * 0.13), zF = d / 2 - 0.024, DT = Math.min(0.04, d * 0.1);
  g.add(K.box(w - 0.02, toe, d - 0.1, darkPlastic(), 0, toe / 2, -0.03));
  g.add(K.box(w, h - toe - 0.02, zF - DT + d / 2, bm, 0, toe + (h - toe - 0.02) / 2, (zF - DT - d / 2) / 2), K.box(w, 0.02, zF + d / 2, bm, 0, h - 0.01, (zF - d / 2) / 2));
  g.add(K.rbox(w - 0.006, h - 0.024 - cs - toe - 0.004, DT, bm, 0, toe + 0.004 + (h - 0.024 - cs - toe - 0.004) / 2, zF - DT / 2, 0.006, 2));
  g.add(K.rbox(w - 0.006, cs - 0.004, DT, blackGlass(), 0, h - 0.022 - cs / 2, zF - DT / 2, 0.006, 2));
  g.add(barHandle(w * 0.6, polished(), 0, h - 0.024 - cs - 0.05, zF));
  g.add(noShadow(K.box(Math.min(0.08, w * 0.2), 0.022, 0.001, lcd(), w * 0.2, h - 0.022 - cs / 2, zF + 0.0006)));
  g.add(merged(`dwb|${mm(w)}`, () => [0, 1, 2].map((i) => gCyl(0.009, 0.004, -w * 0.32 + i * 0.035, 0, 0, 'z', 10)), greyPlastic(), 0, h - 0.022 - cs / 2, zF + 0.002));
  return g;
}
function drawDishwasher(ctx, { w, d, p, px }) {
  const integ = p.variant === 'integrated';
  rr2(ctx, 0, 0, w, d, 1.2, K.tint(hex(p.color, integ ? WHITE : STAINLESS), 0.55), INK, px);
  if (Math.min(w, d) / px < 12) return;
  dashed(ctx, px, () => rect2(ctx, -w / 2 + 3, -d / 2 + 3, w - 6, d - 9, null, SOFT, px), 3, 2.5);
  K.line(ctx, -w / 2, d / 2 - 4, w / 2, d / 2 - 4, INK, px);
  rect2(ctx, -w * 0.3, d / 2 - 2.6, w * 0.6, 1.3, '#3d4046', null);
}
reg('dishwasher', buildDishwasher, drawDishwasher);

// ───────── microwave & small appliances ─────────
const SMALL = ['microwave', 'toaster-oven', 'coffee-machine', 'kettle', 'mixer', 'air-fryer', 'water-bar'];
function buildMicrowave({ w, d, h, p }) {
  const g = new THREE.Group(), v = pick(p.variant, SMALL, 'microwave');
  const dflt = { microwave: STAINLESS, 'toaster-oven': STAINLESS, 'coffee-machine': '#2b2c30', kettle: STAINLESS, mixer: '#d9d2c5', 'air-fryer': '#26272b', 'water-bar': '#f1f1ee' }[v];
  const color = hex(p.color, dflt), bm = applianceMat(color, p.material), st = polished();
  if (v === 'microwave' || v === 'toaster-oven') {
    const hf = Math.min(0.012, h * 0.06), pr = Math.min(0.022, d * 0.08), zF = d / 2 - pr, hh = h - hf, cy = hf + hh / 2, cw = w * (v === 'microwave' ? 0.24 : 0.2);
    g.add(K.rbox(w, hh, zF + d / 2 - 0.01, bm, 0, cy, (zF - 0.01 - d / 2) / 2, 0.01, 2));
    g.add(merged(`ft|${mm(w)}|${mm(d)}`, () => [-1, 1].flatMap((i) => [-1, 1].map((j) => gCyl(0.012, hf + 0.004, i * (w / 2 - 0.04), 0, j * (d / 2 - 0.05), 'y', 8))), darkPlastic(), 0, hf / 2 + 0.002, -pr / 2));
    g.add(K.box(w - cw - 0.012, hh - 0.012, 0.012, blackGlass(), -cw / 2, cy, zF - 0.006), K.box(cw - 0.004, hh - 0.012, 0.012, darkPlastic(), w / 2 - cw / 2 - 0.004, cy, zF - 0.006));
    g.add(K.box(w - cw - 0.07, hh - 0.07, 0.001, ovenWindow(), -cw / 2, cy, zF + 0.0006));
    if (v === 'microwave') {
      g.add(K.rbox(0.016, hh * 0.72, pr, st, w / 2 - cw - 0.022, cy, zF + pr / 2, 0.006, 2));
      g.add(noShadow(K.box(cw * 0.6, Math.min(0.03, hh * 0.14), 0.001, lcd(), w / 2 - cw / 2 - 0.004, hf + hh * 0.78, zF + 0.0006)));
      g.add(cylZ(Math.min(0.026, cw * 0.32), pr, st, w / 2 - cw / 2 - 0.004, hf + hh * 0.32, zF + pr / 2, 18));
    } else {
      g.add(K.rbox(w * 0.5, 0.014, pr, st, -cw / 2, hf + hh - 0.035, zF + pr / 2, 0.006, 2));
      g.add(merged(`tk|${mm(hh)}|${mm(pr)}`, () => [0.78, 0.5, 0.22].map((f) => gCyl(Math.min(0.02, hh * 0.09), pr, 0, hh * (f - 0.5), 0, 'z', 14)), st, w / 2 - cw / 2 - 0.004, cy, zF + pr / 2));
    }
  } else if (v === 'coffee-machine') {
    const bh = Math.min(0.03, h * 0.1), td = d * 0.55, hd = d - 0.012, hh = h * 0.32;
    g.add(K.rbox(w, bh, d, darkPlastic(), 0, bh / 2, 0, 0.01, 2), K.box(w * 0.78, 0.006, d * 0.36, steel(), 0, bh + 0.003, d / 2 - d * 0.2 - 0.01));
    g.add(K.rbox(w, h - bh, td, bm, 0, bh + (h - bh) / 2, -d / 2 + td / 2, 0.018));
    g.add(K.rbox(w * 0.9, hh, hd, bm, 0, h - hh / 2, -d / 2 + hd / 2, 0.018));
    g.add(K.cyl(0.02, 0.015, 0.04, st, 0, h - hh - 0.02, d / 2 - d * 0.2, 12));
    g.add(K.cylOn(Math.min(0.036, w * 0.16), Math.min(0.028, w * 0.12), Math.min(0.065, h * 0.2), K.ceramic('#f6f4ef'), 0, bh + 0.006, d / 2 - d * 0.2, 18));
    g.add(merged(`cb|${mm(w)}`, () => [-1, 0, 1].map((i) => gCyl(Math.min(0.012, w * 0.05), 0.004, i * w * 0.2, 0, 0, 'z', 12)), st, 0, h - hh * 0.45, d / 2 - 0.012 + 0.002));
    g.add(noShadow(K.box(w * 0.3, hh * 0.18, 0.001, lcd(), 0, h - hh * 0.2, d / 2 - 0.0115)));
  } else if (v === 'kettle') {
    const r = Math.min(d / 2, w * 0.34), cx = w * 0.02;
    g.add(at(loft([ring(cx, 0, r, d / 2, 0, 28), ring(cx, 0, r, d / 2, Math.min(0.02, h * 0.08), 28)], darkPlastic()), 0, 0, 0));
    g.add(at(loft([0.02, 0.3, 0.6, 0.86].map((f, i) => ring(cx, 0, r * [0.96, 1, 0.9, 0.78][i], (d / 2) * [0.96, 1, 0.9, 0.78][i], Math.max(0.02, h * 0.08) + (h * 0.84 - Math.max(0.02, h * 0.08)) * (i / 3), 28)), bm), 0, 0, 0));
    g.add(K.cylOn(r * 0.8, r * 0.78, h * 0.05, darkPlastic(), cx, h * 0.84, 0, 28), K.cylOn(r * 0.16, r * 0.2, h * 0.11, darkPlastic(), cx, h * 0.89, 0, 12));
    g.add(hull({ x0: cx + r * 0.6, x1: cx + r * 0.9, z0: -r * 0.3, z1: r * 0.3 }, { x0: cx + r * 0.7, x1: w / 2, z0: -r * 0.16, z1: r * 0.16 }, h * 0.62, h * 0.84, bm));
    g.add(tube([[cx - r * 0.7, h * 0.82, 0], [-w / 2 + 0.014, h * 0.78, 0], [-w / 2 + 0.012, h * 0.45, 0], [cx - r * 0.9, h * 0.28, 0]], 0.011, darkPlastic(), 16, 8));
  } else if (v === 'mixer') {
    const bh = Math.min(0.04, h * 0.12), br = Math.min(w * 0.48, d * 0.3), hh = h * 0.3;
    g.add(K.rbox(w, bh, d, bm, 0, bh / 2, 0, 0.015), K.rbox(w * 0.5, h - bh - hh * 0.5, d * 0.24, bm, 0, bh + (h - bh - hh * 0.5) / 2, -d / 2 + d * 0.13, 0.03));
    g.add(K.rbox(w * 0.64, hh, d * 0.86, bm, 0, h - hh / 2, -d / 2 + d * 0.43, Math.min(0.06, hh * 0.45)));
    g.add(K.cylOn(br, br * 0.55, h * 0.34, steel(), 0, bh, d * 0.2, 24), K.cyl(br * 0.16, br * 0.16, h * 0.1, steel(), 0, h - hh - h * 0.04, d * 0.2, 10));
    g.add(cylX(Math.min(0.016, hh * 0.2), w * 0.72, st, 0, h - hh * 0.55, -d / 2 + d * 0.2, 12));
  } else if (v === 'air-fryer') {
    const R = (f, y, e = 0.45) => ring(0, -d * 0.03, (w / 2) * f, (d / 2 - d * 0.03) * f, y, 28, e);
    g.add(loft([R(0.86, 0), R(0.96, h * 0.1), R(1, h * 0.55), R(0.94, h * 0.86), R(0.7, h, 0.7)], bm));
    g.add(K.rbox(w * 0.66, h * 0.4, d * 0.1, K.mat(K.shade(color, 0.12), { roughness: 0.4 }), 0, h * 0.3, d / 2 - d * 0.1, 0.012));
    g.add(K.rbox(Math.min(0.12, w * 0.4), Math.min(0.035, h * 0.1), d * 0.1, darkPlastic(), 0, h * 0.34, d / 2 - d * 0.05, 0.01));
    g.add(noShadow(cylZ(Math.min(0.04, w * 0.14), 0.002, lcd('#9fe0ff'), 0, h * 0.72, d / 2 - d * 0.06 - 0.004, 20)));
  } else {
    const tray = Math.min(0.05, d * 0.14), bd = d - tray, zc = -d / 2 + bd / 2, zf = -d / 2 + bd;
    g.add(K.rbox(w, h - 0.003, bd, bm, 0, (h - 0.003) / 2, zc, 0.016), K.box(w * 0.8, 0.003, bd * 0.42, blackGlass(), 0, h - 0.0015, zf - bd * 0.25));
    g.add(K.box(w * 0.62, h * 0.46, 0.004, shadowMat(), 0, h * 0.34, zf + 0.001), K.rbox(w * 0.68, Math.min(0.022, h * 0.07), tray + 0.02, steelDark(), 0, Math.max(0.012, h * 0.05), zf + tray / 2 - 0.01, 0.006, 2));
    g.add(K.cyl(0.011, 0.009, 0.03, st, 0, h * 0.56, zf + 0.018, 10), K.box(w * 0.5, h * 0.1, 0.02, bm, 0, h * 0.62, zf + 0.01));
    g.add(noShadow(merged(`wbl|${mm(w)}`, () => [-1, 0, 1].map((i) => gCyl(0.009, 0.001, i * w * 0.2, 0, 0, 'y', 12)), lcd('#7fd0ff'), 0, h + 0.0005, zf - bd * 0.14)));
  }
  return g;
}
function drawMicrowave(ctx, { w, d, p, px }) {
  const v = pick(p.variant, SMALL, 'microwave'), fill = K.tint(hex(p.color, v === 'mixer' ? '#d9d2c5' : '#b9bcc1'), 0.5), big = Math.min(w, d) / px > 12;
  if (v === 'kettle') {
    const r = Math.min(d / 2, w * 0.34);
    poly2(ctx, [[r * 0.6, -r * 0.3], [w / 2, -r * 0.15], [w / 2, r * 0.15], [r * 0.6, r * 0.3]], fill, INK, px);
    K.line(ctx, -w / 2 + 1, 0, -r * 0.7, 0, INK, px * 2);
    circ2(ctx, w * 0.02, 0, r, fill, INK, px); if (big) circ2(ctx, w * 0.02, 0, r * 0.2, '#5b5e64', null);
    return;
  }
  rr2(ctx, 0, 0, w, d, v === 'air-fryer' ? Math.min(w, d) * 0.3 : 1.5, fill, INK, px);
  if (!big) return;
  if (v === 'microwave' || v === 'toaster-oven') { K.line(ctx, -w / 2, d / 2 - 2.5, w / 2, d / 2 - 2.5, INK, px); K.line(ctx, w / 2 - w * 0.24, d / 2 - 2.5, w / 2 - w * 0.24, d / 2, INK, px); }
  else if (v === 'coffee-machine') { K.line(ctx, -w / 2, d * 0.05, w / 2, d * 0.05, SOFT, px); circ2(ctx, 0, d * 0.3, Math.min(w * 0.16, 3.6), PAPER, INK, px); }
  else if (v === 'mixer') { circ2(ctx, 0, d * 0.2, Math.min(w * 0.48, d * 0.3), PAPER, INK, px); rr2(ctx, 0, -d * 0.07, w * 0.5, d * 0.8, w * 0.2, null, SOFT, px); }
  else if (v === 'air-fryer') { circ2(ctx, 0, -d * 0.03, Math.min(w, d) * 0.3, null, SOFT, px); rect2(ctx, -Math.min(6, w * 0.2), d / 2 - d * 0.1, Math.min(12, w * 0.4), d * 0.1, '#5b5e64', null); }
  else { rect2(ctx, -w * 0.34, d / 2 - d * 0.14, w * 0.68, d * 0.14, PAPER, INK, px); circ2(ctx, 0, d / 2 - d * 0.07, 1.3, '#5b5e64', null); }
}
reg('microwave', buildMicrowave, drawMicrowave);

// ═════════════════════════ LAUNDRY ═════════════════════════
const _dome = () => geo('dome', () => new THREE.SphereGeometry(1, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2.6).rotateX(Math.PI / 2));
/** One front-loading machine filling w × d × h (origin on the floor). kind: 'washer' | 'dryer' | 'washer-dryer'. */
function laundryUnit(w, d, h, kind, color) {
  const g = new THREE.Group(), bm = applianceMat(color), white = hsl(color).l > 0.8, dark = darkPlastic();
  const ft = Math.min(0.015, h * 0.03), pr = Math.min(0.035, d * 0.08), zF = d / 2 - pr, cs = Math.min(0.105, h * 0.14), H = h - ft;
  g.add(K.rbox(w, H, zF + d / 2, bm, 0, ft + H / 2, (zF - d / 2) / 2, 0.012, 2));
  g.add(merged(`lf|${mm(w)}|${mm(d)}`, () => [-1, 1].flatMap((i) => [-1, 1].map((j) => gCyl(0.02, ft + 0.006, i * (w / 2 - 0.05), 0, j * (d / 2 - 0.07), 'y', 10))), dark, 0, ft / 2 + 0.003, -pr / 2));
  // control strip
  const yc = h - cs / 2 - 0.012, face = zF + 0.0008;
  g.add(K.box(w - 0.02, 0.002, 0.002, shadowMat(), 0, h - cs - 0.012, zF));
  g.add(K.rbox(w * (kind === 'dryer' ? 0.4 : 0.3), cs * 0.62, 0.006, K.mat(K.shade(color, white ? -0.06 : 0.1), { roughness: 0.35 }), -w / 2 + w * (kind === 'dryer' ? 0.24 : 0.19), yc, zF + 0.002, 0.003, 2));
  g.add(cylZ(Math.min(0.03, cs * 0.34), 0.018, polished(), w * (kind === 'dryer' ? 0.12 : 0.02), yc, zF + 0.009, 20));
  g.add(K.box(w * 0.22, cs * 0.42, 0.0016, blackGlass(), w * 0.3, yc, face), noShadow(K.box(w * 0.1, cs * 0.2, 0.0006, lcd(), w * 0.27, yc, face + 0.0012)));
  // door
  const R = Math.min(w * 0.38, (H - cs) * 0.3), cy = ft + (H - cs) * 0.52;
  const ringM = kind === 'washer' ? polished() : kind === 'dryer' ? K.mat(white ? '#e9e9e6' : K.shade(color, 0.2), { roughness: 0.3 }) : K.mat('#3a3c41', { roughness: 0.3, metalness: 0.6 });
  g.add(merged(`ldr|${mm(R)}|${mm(pr)}`, () => [new THREE.TorusGeometry(R - 0.022, 0.022, 10, 40).scale(1, 1, pr / 0.03).translate(0, 0, pr * 0.27), gCyl(R - 0.02, 0.004, 0, 0, 0.002, 'z', 40)], ringM, 0, cy, zF));
  g.add(cylZ(R * 0.72, 0.004, K.mat('#2c2f34', { roughness: 0.3, metalness: 0.7 }), 0, cy, zF + 0.005, 32));
  const dome = new THREE.Mesh(_dome(), K.glass(kind === 'dryer' ? '#1d2126' : '#3a4650', 0.5));
  const rg = (R - 0.04) / 0.93, sz = pr * 0.9;
  dome.scale.set(rg, rg, sz / 0.642); dome.position.set(0, cy, zF + 0.006 - 0.358 * (sz / 0.642));
  g.add(noShadow(dome));
  g.add(K.rbox(0.022, Math.min(0.09, R * 0.5), pr * 0.7, kind === 'washer' ? polished() : dark, R - 0.012, cy, zF + pr * 0.4, 0.006, 2));
  // kick strip + filter hatch
  g.add(K.box(w - 0.02, 0.002, 0.002, shadowMat(), 0, ft + Math.min(0.1, H * 0.12), zF));
  if (kind !== 'dryer') g.add(cylZ(0.022, 0.003, K.mat(K.shade(color, -0.08), { roughness: 0.4 }), w / 2 - 0.07, ft + Math.min(0.05, H * 0.06), zF + 0.0015, 16));
  return g;
}
const WASHERS = ['washer', 'dryer', 'washer-dryer', 'top-load', 'stacked'];
function buildWasher({ w, d, h, p }) {
  const v = pick(p.variant, WASHERS, 'washer'), color = hex(p.color, '#f4f4f2');
  if (v === 'stacked') {
    const g = grp(laundryUnit(w, d, h / 2 - 0.004, 'washer', color), at(laundryUnit(w, d, h / 2, 'dryer', color), 0, h / 2, 0));
    g.add(K.box(w - 0.01, 0.006, d - 0.06, darkPlastic(), 0, h / 2 - 0.002, -0.02));
    return g;
  }
  if (v !== 'top-load') return laundryUnit(w, d, h, v, color);
  const g = new THREE.Group(), bm = applianceMat(color), ft = Math.min(0.015, h * 0.03), ch = Math.min(0.12, h * 0.12), cd = Math.min(0.14, d * 0.22), by = h - ch;
  g.add(K.rbox(w, by - ft, d, bm, 0, ft + (by - ft) / 2, 0, 0.014, 2));
  g.add(merged(`lf|${mm(w)}|${mm(d)}`, () => [-1, 1].flatMap((i) => [-1, 1].map((j) => gCyl(0.02, ft + 0.006, i * (w / 2 - 0.05), 0, j * (d / 2 - 0.07), 'y', 10))), darkPlastic(), 0, ft / 2 + 0.003, 0));
  g.add(profileX([[-d / 2, by - 0.01], [-d / 2 + cd, by - 0.01], [-d / 2 + cd * 0.75, h], [-d / 2, h]], w - 0.006, bm));
  g.add(K.rbox(w - 0.06, 0.012, d - cd - 0.06, K.mat('#30343a', { roughness: 0.12, metalness: 0.3 }), 0, by + 0.004, cd / 2, 0.005, 2));
  g.add(K.box(w * 0.3, 0.014, 0.02, greyPlastic(), 0, by + 0.006, d / 2 - 0.035));
  const cz = -d / 2 + cd * 0.9, tilt = Math.atan2(cd * 0.25, ch);
  const knobs = merged(`tlk|${mm(w)}`, () => [-0.32, 0.32].map((f) => gCyl(0.024, 0.02, f * w, 0, 0.008, 'z', 16)), polished(), 0, by + ch * 0.5, cz);
  knobs.rotation.x = -tilt; g.add(knobs);
  const scr = K.box(w * 0.3, ch * 0.4, 0.002, blackGlass(), 0, by + ch * 0.5, cz + 0.001); scr.rotation.x = -tilt; g.add(scr);
  return g;
}
function drawWasher(ctx, { w, d, p, px }) {
  const v = pick(p.variant, WASHERS, 'washer'), r = Math.min(w, d) * 0.31;
  rr2(ctx, 0, 0, w, d, 2, K.tint(hex(p.color, '#f4f4f2'), 0.6), INK, px);
  if (Math.min(w, d) / px < 10) return;
  if (v === 'top-load') { K.line(ctx, -w / 2, -d / 2 + d * 0.2, w / 2, -d / 2 + d * 0.2, INK, px); rr2(ctx, 0, d * 0.1, w - 8, d * 0.8 - 8, 3, null, INK, px); circ2(ctx, 0, d * 0.1, r * 0.8, null, SOFT, px); return; }
  K.line(ctx, -w / 2, -d / 2 + d * 0.14, w / 2, -d / 2 + d * 0.14, SOFT, px);
  circ2(ctx, 0, d * 0.05, r, PAPER, INK, px);
  if (v === 'dryer' || v === 'stacked') dashed(ctx, px, () => circ2(ctx, 0, d * 0.05, r * 0.68, null, MID, px), 2.5, 2);
  else circ2(ctx, 0, d * 0.05, r * 0.68, null, SOFT, px);
  if (v === 'stacked' || v === 'washer-dryer') rr2(ctx, 0, 0, w - 4, d - 4, 1.5, null, SOFT, px * 0.75);
  rect2(ctx, -w * 0.18, d / 2 - 2.2, w * 0.36, 1.1, '#5b5e64', null);
}
reg('washer', buildWasher, drawWasher);

// ───────── water heater ─────────
const HEATERS = ['electric', 'solar-roof', 'gas', 'heat-pump'];
/** Domed cylinder with its axis along y, filling the box rx·2 × len × rz·2. */
function tank(rx, rz, len, material, seg = 28) {
  const cap = Math.min(len * 0.12, rx * 0.5), prof = [[0.35, 0], [0.8, cap * 0.35], [1, cap], [1, len - cap], [0.8, len - cap * 0.35], [0.35, len]];
  return loft(prof.map(([f, y]) => ring(0, 0, rx * f, rz * f, y, seg)), material);
}
function buildHeater({ w, d, h, p }) {
  const g = new THREE.Group(), v = pick(p.variant, HEATERS, 'electric');
  const white = enamel(hex(p.color, '#f3f3f0')), ch = K.chrome(), frame = K.mat('#b9bcc0', { roughness: 0.45, metalness: 0.6 });
  if (v === 'electric' || v === 'heat-pump') {
    if (v === 'electric' && w > h * 1.2) {                      // horizontal cylinder
      const t = tank(h / 2 - 0.01, d / 2, w, white); t.rotation.z = -Math.PI / 2; g.add(at(t, -w / 2, h / 2 + 0.01, 0));
      g.add(K.box(Math.min(0.12, w * 0.2), 0.02, Math.min(0.1, d * 0.4), K.mat('#c0392b', { roughness: 0.5 }), w * 0.3, 0.02, 0));
      g.add(K.cyl(0.011, 0.011, 0.03, ch, w * 0.3 - 0.03, 0.015, 0, 8), K.cyl(0.011, 0.011, 0.03, ch, w * 0.3 + 0.03, 0.015, 0, 8));
      return g;
    }
    const hp = v === 'heat-pump', th = hp ? h * 0.3 : 0, pipes = Math.min(0.1, h * 0.08), bodyH = h - th - pipes;
    g.add(at(tank(w / 2, d / 2, bodyH, white), 0, pipes, 0));
    g.add(at(loft([ring(0, 0, w * 0.2, d * 0.2, 0, 20), ring(0, 0, w * 0.24, d * 0.24, 0.04, 20)], K.mat(hp ? '#55585e' : '#c0392b', { roughness: 0.5 })), 0, pipes - 0.03, 0));
    for (const k of [-1, 1]) g.add(K.cylOn(0.011, 0.011, pipes, ch, k * Math.min(0.05, w * 0.12), 0, 0, 8));
    if (bodyH > 0.5) for (const f of [0.3, 0.72]) g.add(at(loft([ring(0, 0, w / 2 + 0.002, d / 2 + 0.002, 0, 28), ring(0, 0, w / 2 + 0.002, d / 2 + 0.002, 0.012, 28)], frame, false, false), 0, pipes + bodyH * f, 0));
    if (hp) {
      const y0 = h - th - 0.01, dk = K.mat('#4b4e54', { roughness: 0.5 });
      g.add(at(loft([ring(0, 0, w / 2, d / 2, 0, 28), ring(0, 0, w / 2, d / 2, th, 28), ring(0, 0, w / 2 - 0.02, d / 2 - 0.02, th + 0.01, 28)], dk), 0, y0, 0));
      g.add(at(slats(clamp(Math.round(th / 0.03) - 2, 2, 10), w * 0.5, 0.008, 0.006, 0.026, shadowMat()), 0, y0 + th / 2, d / 2 * 0.86 + 0.003));
      g.add(noShadow(K.box(0.05, 0.02, 0.002, lcd(), 0, pipes + bodyH * 0.55, d / 2 + 0.0005)));
    } else g.add(K.rbox(Math.min(0.1, w * 0.3), 0.07, 0.02, K.mat('#d8d8d5', { roughness: 0.4 }), 0, pipes + Math.min(0.12, bodyH * 0.2), d / 2 - 0.012, 0.006, 2));
    return g;
  }
  if (v === 'gas') {
    const pipes = Math.min(0.1, h * 0.14), fl = Math.min(0.08, h * 0.12), bh = h - pipes - fl;
    const zf = d / 2 - 0.012;
    g.add(K.rbox(w, bh, d - 0.012, white, 0, pipes + bh / 2, -0.006, 0.012, 2));
    g.add(K.box(w * 0.5, bh * 0.12, 0.003, blackGlass(), 0, pipes + bh * 0.3, zf + 0.0005), cylZ(Math.min(0.03, w * 0.08), 0.012, greyPlastic(), w * 0.28, pipes + bh * 0.14, zf + 0.006, 16));
    g.add(noShadow(K.box(w * 0.16, bh * 0.06, 0.001, lcd('#ffb35c'), 0, pipes + bh * 0.3, zf + 0.0022)));
    g.add(K.cylOn(Math.min(0.06, w * 0.2), Math.min(0.06, w * 0.2), fl, frame, 0, h - fl, -d * 0.1, 16));
    g.add(merged(`gp|${mm(w)}|${mm(pipes)}`, () => [-0.3, -0.1, 0.1, 0.3].map((f) => gCyl(0.011, pipes, f * w, 0, 0, 'y', 8)), K.mat('#b87a52', { roughness: 0.3, metalness: 0.85 }), 0, pipes / 2, 0));
    return g;
  }
  // Israeli "dud shemesh": tilted collector in front, tank on a galvanised frame behind it.
  const horiz = w >= 0.9, r = horiz ? Math.min(0.26, d * 0.3, h * 0.3) : Math.min(w / 2, d * 0.3, 0.3), zt = -d / 2 + r, ft = 0.02;
  const cw = horiz ? Math.max(0.3, w - 0.08) : w, ct = Math.min(0.09, h * 0.08);
  const zTop = horiz ? zt + r * 0.3 : zt + r + 0.03, yTop = horiz ? h - 2 * r - 0.02 : h * 0.72, zBot = d / 2 - 0.055, yBot = Math.min(0.12, h * 0.1);
  const len = Math.hypot(zBot - zTop, yTop - yBot), ang = Math.atan2(yTop - yBot, zBot - zTop);
  const panel = new THREE.Group();
  panel.add(K.box(cw, ct, len, K.mat('#c9ccd0', { roughness: 0.4, metalness: 0.6 }), 0, ct / 2, 0));
  panel.add(K.box(cw - 0.05, 0.004, len - 0.05, K.mat('#16233a', { roughness: 0.08, metalness: 0.5 }), 0, ct + 0.001, 0));
  panel.add(slats(clamp(Math.round(cw / 0.12), 2, 16), len - 0.06, 0.003, 0.004, (cw - 0.08) / clamp(Math.round(cw / 0.12), 2, 16), K.mat('#2d4468', { roughness: 0.3, metalness: 0.5 }), 'x', 'z').translateY(ct + 0.004));
  panel.rotation.x = ang; panel.position.set(0, (yTop + yBot) / 2 - (ct / 2) * Math.cos(ang), (zTop + zBot) / 2 - (ct / 2) * Math.sin(ang));
  g.add(panel);
  if (horiz) { const t = tank(r, r, w, white); t.rotation.z = -Math.PI / 2; g.add(at(t, -w / 2, h - r, zt)); }
  else g.add(at(tank(r, r, h - ft - 0.1, white), 0, 0.1 + ft, zt));
  const legX = horiz ? w / 2 - Math.min(0.15, w * 0.12) : Math.max(0.04, w / 2 - 0.03), fr = 0.014, ty = horiz ? h - 2 * r : 0.1 + ft;
  for (const k of [-1, 1]) {
    g.add(K.bar([k * legX, 0, zt - r * 0.6], [k * legX, ty, zt - r * 0.6], fr, frame, 6), K.bar([k * legX, 0, zt + r * 0.6], [k * legX, ty, zt + r * 0.6], fr, frame, 6));
    g.add(K.bar([k * legX, ft, -d / 2 + 0.02], [k * legX, ft, d / 2 - 0.02], fr, frame, 6), K.bar([k * legX, ty, zt - r * 0.7], [k * legX, ty, zt + r * 0.7], fr, frame, 6));
    g.add(K.bar([k * legX, ft, zBot - 0.02], [k * legX, yTop - 0.02, zTop], fr, frame, 6), K.bar([k * legX, ft, zt + r * 0.6], [k * legX, yTop * 0.6, zTop + (zBot - zTop) * 0.4], fr * 0.8, frame, 6));
  }
  g.add(K.bar([-legX, ft, d / 2 - 0.02], [legX, ft, d / 2 - 0.02], fr, frame, 6), K.bar([-legX, ft, -d / 2 + 0.02], [legX, ft, -d / 2 + 0.02], fr, frame, 6));
  g.add(K.box(w, 0.004, 0.004, frame, 0, 0.002, d / 2 - 0.002), K.box(w, 0.004, 0.004, frame, 0, 0.002, -d / 2 + 0.002));
  g.add(tube([[cw / 2 - 0.04, yTop, zTop], [cw / 2 - 0.02, yTop + 0.06, zTop - 0.04], [horiz ? w / 2 - 0.1 : r * 0.5, horiz ? h - r : h * 0.8, zt + r * 0.8]], 0.011, K.mat('#b87a52', { roughness: 0.3, metalness: 0.85 }), 10, 6));
  return g;
}
function drawHeater(ctx, { w, d, h, p, px }) {
  const v = pick(p.variant, HEATERS, 'electric'), fill = K.tint(hex(p.color, '#f3f3f0'), 0.5), big = Math.min(w, d) / px > 12;
  if (v === 'solar-roof') {
    const horiz = w >= 90, r = horiz ? Math.min(26, d * 0.3, h * 0.3) : Math.min(w / 2, d * 0.3, 30);
    const zTop = -d / 2 + r + (horiz ? r * 0.3 : r + 3), cw = horiz ? Math.max(30, w - 8) : w;
    rect2(ctx, -cw / 2, zTop, cw, d / 2 - 3 - zTop, '#cfd9e6', INK, px);
    if (big) { const n = clamp(Math.round(cw / 12), 2, 16); for (let i = 1; i < n; i++) K.line(ctx, -cw / 2 + (cw * i) / n, zTop, -cw / 2 + (cw * i) / n, d / 2 - 3, SOFT, px * 0.75); }
    if (horiz) rr2(ctx, 0, -d / 2 + r, w, 2 * r, r, fill, INK, px); else circ2(ctx, 0, -d / 2 + r, r, fill, INK, px);
    return;
  }
  if (v === 'gas') { rr2(ctx, 0, 0, w, d, 1.5, fill, INK, px); if (big) circ2(ctx, 0, -d * 0.1, Math.min(6, w * 0.2), null, INK, px); return; }
  if (v === 'electric' && w > h * 1.2) { rr2(ctx, 0, 0, w, d, d / 2, fill, INK, px); return; }
  ell2(ctx, 0, 0, w / 2, d / 2, fill, INK, px);
  if (big) { ell2(ctx, 0, 0, w * 0.36, d * 0.36, null, SOFT, px); for (const k of [-1, 1]) circ2(ctx, k * Math.min(5, w * 0.12), 0, 1.2, '#5b5e64', null); }
  if (big && v === 'heat-pump') K.line(ctx, -w * 0.25, d / 2 - 2, w * 0.25, d / 2 - 2, INK, px * 1.5);
}
reg('water-heater', buildHeater, drawHeater);

// ═════════════════════════ SINKS, WC, VANITY ═════════════════════════
/** Plan outline from a ring() (x → x, z → y, metres → cm). */
const ring2 = (ctx, R, fill, stroke = INK, lw = 1) => poly2(ctx, R.map((q) => [q[0] * 100, q[2] * 100]), fill, stroke, lw);
const SINKS = ['kitchen-single', 'kitchen-double', 'vessel', 'pedestal', 'wall-hung', 'utility'];

/** Rings of a wall-mounted ceramic basin: outer skin upwards, rim, bowl downwards. */
function basinRings(w, d, bh, top, n = 32) {
  const z0 = -d / 2, z1 = d / 2, hw = w / 2, rim = Math.min(0.022, w * 0.06), ledge = Math.min(0.075, d * 0.26);
  const O = (fx, fz, y) => ringBox(hw * fx, z0, z0 + d * fz, y, n, 1, 0.3);
  const I = (f, y) => ring(0, (z0 + ledge + z1 - rim) / 2 + (1 - f) * d * 0.04, (hw - rim) * f, ((z1 - rim - z0 - ledge) / 2) * f, y, n, 1, 0.5);
  return {
    rings: [O(0.5, 0.62, top - bh), O(0.86, 0.9, top - bh * 0.5), O(1, 1, top - Math.min(0.02, bh * 0.2)), O(1, 1, top), I(1, top), I(0.82, top - bh * 0.5), I(0.3, top - bh * 0.72)],
    inner: I(1, top), drainZ: (z0 + ledge + z1 - rim) / 2 + 0.7 * d * 0.04, tapZ: z0 + ledge * 0.5, floorY: top - bh * 0.72,
  };
}
function sinkSpec(w, d, v) {
  const dbl = v === 'kitchen-double', drainer = v === 'kitchen-single' && w >= 0.75;
  const bd = Math.max(0.1, d - 0.13), zc = d / 2 - 0.04 - bd / 2;
  const bw = dbl ? Math.max(0.1, (w - 0.11) / 2) : drainer ? 0.4 : Math.max(0.1, Math.min(w - 0.08, 0.55));
  const bowls = dbl ? [{ x: -(bw + 0.03) / 2, z: zc, w: bw, d: bd, r: 0.04 }, { x: (bw + 0.03) / 2, z: zc, w: bw, d: bd, r: 0.04 }] : [{ x: drainer ? -w / 2 + 0.04 + bw / 2 : 0, z: zc, w: bw, d: bd, r: 0.04 }];
  return { bowls, drainer, tapX: dbl ? 0 : bowls[0].x, tapZ: -d / 2 + 0.045, zc, bd };
}
function buildSink({ w, d, h, p }) {
  const g = new THREE.Group(), v = pick(p.variant, SINKS, 'kitchen-single'), fin = pick(p.finish, Object.keys(FINISH_HEX), 'chrome'), withTap = flag(p.faucet, true);
  const cer = K.ceramic(hex(p.color, '#f7f7f5')), ch = K.chrome();
  if (v === 'kitchen-single' || v === 'kitchen-double') {
    const S = sinkSpec(w, d, v), st = steel(), fl = rrShape(w, d, 0.02);
    for (const b of S.bowls) fl.holes.push(rrShape(b.w, b.d, b.r, b.x, -b.z, THREE.Path));
    g.add(flat(fl, 0.003, st, h - 0.003));
    sinkBowls(g, S.bowls, h, h - 0.004);
    for (const b of S.bowls) g.add(K.box(b.w * 0.5, Math.min(0.021, h * 0.5), b.d * 0.5, steelDark(), b.x, Math.min(0.021, h * 0.5) / 2, b.z));
    if (S.drainer) { const x0 = S.bowls[0].x + S.bowls[0].w / 2 + 0.03, len = w / 2 - 0.03 - x0; g.add(at(slats(clamp(Math.round(len / 0.03), 2, 24), S.bd * 0.86, 0.008, 0.0025, len / clamp(Math.round(len / 0.03), 2, 24), steelDark(), 'x', 'z'), x0 + len / 2, h + 0.0012, S.zc)); }
    if (withTap) g.add(extra(at(tap('kitchen', fin), S.tapX, h, S.tapZ)));
  } else if (v === 'vessel' || v === 'utility') {
    const e = v === 'utility' || p.style === 'modern' ? 0.3 : 1, t = Math.min(0.014, w * 0.05), fb = v === 'utility' ? 0.92 : 0.55, floor = v === 'utility' ? Math.min(0.04, h * 0.3) : Math.min(0.03, h * 0.3);
    const R = (f, y, inset = 0) => ring(0, 0, (w / 2) * f - inset, (d / 2) * f - inset, y, 32, e);
    g.add(loft([R(fb, 0), R(fb + (1 - fb) * 0.7, h * 0.3), R(1, h * 0.85), R(1, h), R(1, h, t), R(fb + (1 - fb) * 0.6, h * 0.4, t), R(fb * 0.6, floor, t)], cer));
    g.add(K.cyl(0.02, 0.02, 0.004, ch, 0, floor + 0.002, 0, 16));
    if (withTap) g.add(extra(at(tap('wall', fin), 0, h + 0.1, -d / 2)));
  } else {
    const bh = clamp(v === 'pedestal' ? h * 0.22 : w * 0.3, 0.06, Math.min(0.2, h * 0.5)), B = basinRings(w, d, bh, h);
    g.add(loft(B.rings, cer));
    g.add(K.cyl(0.018, 0.018, 0.004, ch, 0, B.floorY + 0.002, B.drainZ, 14));
    const yb = h - bh, zc = -d / 2 + d * 0.36;
    if (v === 'pedestal') g.add(loft([ring(0, zc, w * 0.2, d * 0.22, 0, 24, 1, 0.5), ring(0, zc, w * 0.13, d * 0.17, yb * 0.5, 24, 1, 0.5), ring(0, zc, w * 0.19, d * 0.24, yb + 0.01, 24, 1, 0.5)], cer, true, false));
    else {
      const ty = Math.max(0.02, yb - 0.11);
      g.add(K.cyl(0.015, 0.015, yb - ty, ch, 0, (yb + ty) / 2, zc, 10), K.cyl(0.028, 0.028, 0.06, ch, 0, ty, zc, 14));
      g.add(cylZ(0.013, zc + d / 2, ch, 0, ty + 0.01, (zc - d / 2) / 2, 10), cylZ(0.03, 0.006, ch, 0, ty + 0.01, -d / 2 + 0.003, 16));
    }
    if (withTap) g.add(extra(at(tap('basin', fin), 0, h, B.tapZ)));
  }
  return g;
}
function drawSink(ctx, { w, d, p, px }) {
  const v = pick(p.variant, SINKS, 'kitchen-single'), big = Math.min(w, d) / px > 12, fill = K.tint(hex(p.color, '#f7f7f5'), 0.6), withTap = flag(p.faucet, true);
  const tapMark = (x, y, len) => { if (!withTap || !big) return; K.line(ctx, x, y, x, y + len, INK, px * 1.6); circ2(ctx, x, y, Math.min(2.2, w * 0.06), PAPER, INK, px); };
  if (v === 'kitchen-single' || v === 'kitchen-double') {
    const S = sinkSpec(w / 100, d / 100, v);
    rr2(ctx, 0, 0, w, d, 2, '#eef0f2', INK, px);
    if (S.drainer && big) { const x0 = (S.bowls[0].x + S.bowls[0].w / 2) * 100 + 3; for (let x = x0 + 2; x < w / 2 - 3; x += 3.2) K.line(ctx, x, (S.zc - S.bd * 0.43) * 100, x, (S.zc + S.bd * 0.43) * 100, SOFT, px * 0.75); }
    sink2d(ctx, withTap && big ? S : { ...S, tapX: null }, px);
  } else if (v === 'vessel' || v === 'utility') {
    const e = v === 'utility' || p.style === 'modern' ? 0.3 : 1;
    ring2(ctx, ring(0, 0, w / 200, d / 200, 0, 40, e), fill, INK, px);
    if (big) { ring2(ctx, ring(0, 0, w / 200 - 0.02, d / 200 - 0.02, 0, 40, e), null, SOFT, px); circ2(ctx, 0, 0, 1.8, null, INK, px); }
    tapMark(0, -d / 2 + 1, Math.min(14, d * 0.3));
  } else {
    const B = basinRings(w / 100, d / 100, 0.1, 0);
    ring2(ctx, B.rings[3], fill, INK, px);
    if (big) { ring2(ctx, B.inner, PAPER, INK, px); circ2(ctx, 0, B.drainZ * 100, Math.min(1.6, w * 0.05), null, INK, px); }
    tapMark(0, B.tapZ * 100, Math.min(9, d * 0.3));
  }
}
reg('sink', buildSink, drawSink);

// ───────── toilet ─────────
const TOILETS = ['wall-hung', 'floor', 'close-coupled', 'bidet', 'smart'];
function toiletSpec(w, d, h, p) {
  let v = pick(p.variant, TOILETS, 'wall-hung');
  if (v === 'floor' && p.cistern === 'exposed') v = 'close-coupled';
  const cc = v === 'close-coupled', cd = cc ? clamp(d * 0.27, 0.06, 0.2) : 0;
  const panel = v === 'smart' ? Math.min(0.035, w * 0.09) : 0, hw = (w - panel) / 2, cx = -panel / 2;
  const bz0 = -d / 2 + cd * 0.3, sh = cc ? clamp(h * 0.54, 0.1, 0.46) : h;
  const lidT = v === 'bidet' ? 0 : Math.min(v === 'smart' ? 0.065 : 0.05, sh * 0.16), lz0 = cc ? -d / 2 + cd + 0.008 : -d / 2 + Math.min(0.05, d * 0.1);
  const R = (fx, fz, y, inset = 0, zb = bz0) => ringBox(hw * fx - inset, zb + inset, bz0 + (d / 2 - bz0) * fz - inset, y, 32, 1, 0.33).map((q) => [q[0] + cx, q[1], q[2]]);
  return { v, cc, cd, panel, hw, cx, bz0, sh, lidT, lz0, rimY: sh - lidT, R };
}
function buildToilet({ w, d, h, p }) {
  const g = new THREE.Group(), S = toiletSpec(w, d, h, p), { v, R, rimY } = S;
  const cer = K.ceramic(hex(p.color, '#f7f7f5')), seatM = K.mat(hex(p.color2, '#fbfbf9'), { roughness: 0.34 }), ch = K.chrome();
  const yb = v === 'wall-hung' ? clamp(h * 0.2, 0.03, 0.1) : 0, H = rimY - yb, e = Math.min(0.012, H * 0.1);
  const outer = v === 'wall-hung'
    ? [R(0.6, 0.62, yb), R(0.85, 0.84, yb + H * 0.25), R(0.97, 0.97, yb + H * 0.62), R(1, 1, rimY - e), R(1, 1, rimY)]
    : [R(0.74, 0.72, 0), R(0.72, 0.7, H * 0.22), R(0.8, 0.82, H * 0.52), R(0.97, 0.97, H * 0.84), R(1, 1, rimY - e), R(1, 1, rimY)];
  if (v === 'bidet') {
    const zi = S.bz0 + Math.min(0.085, d * 0.18), bd = Math.min(0.13, H * 0.4);
    g.add(loft([...outer, R(1, 1, rimY, 0.028, zi - 0.028), R(0.9, 0.96, rimY - bd * 0.6, 0.04, zi - 0.03), R(0.4, 0.7, rimY - bd, 0.03, zi + 0.02)], cer));
    g.add(K.cyl(0.018, 0.018, 0.004, ch, S.cx, rimY - bd + 0.002, (zi + d / 2) / 2 - 0.02, 14));
    g.add(extra(at(tap('basin', pick(p.finish, Object.keys(FINISH_HEX), 'chrome')), S.cx, rimY, S.bz0 + Math.min(0.04, d * 0.09))));
    return g;
  }
  g.add(loft(outer, cer));
  // seat + lid as one skin with a shadow groove between them
  const L = (y, inset = 0) => ringBox(S.hw - inset, S.lz0 + inset, d / 2 - inset, y, 32, 1, 0.3).map((q) => [q[0] + S.cx, q[1], q[2]]), t = S.lidT;
  g.add(loft([L(rimY + 0.001), L(rimY + t * 0.4), L(rimY + t * 0.4, 0.004), L(rimY + t * 0.5, 0.004), L(rimY + t * 0.5), L(rimY + t * 0.86), L(S.sh, Math.min(0.016, S.hw * 0.2))], seatM, false, true));
  g.add(merged(`wch|${mm(S.hw)}`, () => [-1, 1].map((k) => gCyl(0.009, 0.035, k * S.hw * 0.5, 0, 0, 'x', 10)), ch, S.cx, rimY + t * 0.5, S.lz0 + 0.004));
  if (S.cc) {
    const y0 = Math.max(0, rimY - 0.05), y1 = h - 0.028;
    g.add(K.rbox(w - 0.012, y1 - y0, S.cd, cer, 0, (y0 + y1) / 2, -d / 2 + S.cd / 2, 0.016, 3), K.rbox(w, 0.024, S.cd, cer, 0, h - 0.016, -d / 2 + S.cd / 2, 0.008, 2));
    g.add(K.cyl(0.02, 0.02, 0.006, ch, 0, h - 0.003, -d / 2 + S.cd / 2, 18));
  } else if (p.cistern !== 'exposed') {
    const pl = new THREE.Group(), py = Math.max(h + 0.35, 1.0);
    pl.add(K.rbox(0.245, 0.165, 0.012, K.mat('#f4f4f2', { roughness: 0.15 }), 0, py, -d / 2 + 0.006, 0.005, 2));
    pl.add(K.rbox(0.075, 0.1, 0.004, ch, -0.055, py, -d / 2 + 0.014, 0.0018, 2), K.rbox(0.11, 0.1, 0.004, ch, 0.045, py, -d / 2 + 0.014, 0.0018, 2));
    g.add(extra(pl));
  }
  if (v === 'smart') {
    g.add(K.rbox(S.panel + 0.012, 0.03, d * 0.4, seatM, w / 2 - (S.panel + 0.012) / 2, rimY + 0.016, d / 2 - d * 0.42, 0.008, 2));
    g.add(noShadow(merged(`smd|${mm(d)}`, () => [0, 1, 2].map((i) => gCyl(0.006, 0.001, 0, 0, (i - 1) * 0.03, 'y', 10)), lcd('#7fd0ff'), w / 2 - (S.panel + 0.012) / 2, rimY + 0.0315, d / 2 - d * 0.42)));
  }
  return g;
}
function drawToilet(ctx, { w, d, h, p, px }) {
  const S = toiletSpec(w / 100, d / 100, h / 100, p), fill = K.tint(hex(p.color, '#f7f7f5'), 0.7), big = Math.min(w, d) / px > 10;
  const hw = S.hw * 100, cx = S.cx * 100, b0 = S.bz0 * 100, len = d / 2 - b0;
  if (S.cc) rr2(ctx, 0, -d / 2 + S.cd * 50, w, S.cd * 100, 1.5, fill, INK, px);
  ring2(ctx, S.R(1, 1, 0), fill, INK, px);
  if (!S.cc) rr2(ctx, cx, -d / 2 + Math.min(2.5, d * 0.05), hw * 1.7, Math.min(5, d * 0.1), 1, fill, INK, px);
  if (!big) return;
  if (S.v === 'bidet') {
    ell2(ctx, cx, b0 + len * 0.6, hw * 0.62, len * 0.3, PAPER, INK, px); circ2(ctx, cx, b0 + len * 0.6, 1.4, null, INK, px);
    K.line(ctx, cx, b0 + 4, cx, b0 + 11, INK, px * 1.6); circ2(ctx, cx, b0 + 4, 1.8, PAPER, INK, px);
    return;
  }
  ell2(ctx, cx, b0 + len * 0.58, hw * 0.62, len * 0.32, PAPER, INK, px);
  if (S.cc) circ2(ctx, 0, -d / 2 + S.cd * 50, 1.6, null, INK, px);
  if (S.v === 'smart') rr2(ctx, w / 2 - 2.3, d / 2 - d * 0.42, 4, d * 0.4, 1, fill, INK, px);
}
reg('toilet', buildToilet, drawToilet);

// ───────── vanity ─────────
const VANITIES = ['wall-hung', 'floor', 'console'];
function vanitySpec(w, d, h, p) {
  const v = pick(p.variant, VANITIES, 'wall-hung'), kind = pick(p.basin, ['integrated', 'vessel', 'undermount'], 'integrated');
  const basins = w < 0.9 ? 1 : clamp(Math.round(num(p.basins, 1)), 1, 2), slot = w / basins, vessel = kind === 'vessel';
  const vesselH = vessel ? Math.min(0.13, h * 0.2) : 0, tct = Math.min(kind === 'integrated' ? 0.035 : 0.02, h * 0.2), yC = h - vesselH;
  let bd = clamp(d - (vessel ? 0.1 : 0.17), 0.1, vessel ? 0.42 : 0.36), bw = clamp(slot - 0.2, 0.16, vessel ? 0.44 : 0.56);
  if (vessel) bw = Math.min(bw, bd * 1.3);
  const bz = vessel ? Math.min(0.03, d / 2 - bd / 2 - 0.02) : d / 2 - Math.min(0.055, d * 0.12) - bd / 2;
  const xs = basins === 2 ? [-w / 4, w / 4] : [0], e = kind === 'integrated' ? 0.32 : 1;
  const outline = (x, f = 1, y = 0, inset = 0) => ring(x, bz, (bw / 2) * f - inset, (bd / 2) * f - inset, y, 32, e);
  return { v, kind, basins, vessel, vesselH, tct, yC, bw, bd, bz, xs, outline, tapZ: Math.max(-d / 2 + 0.03, bz - bd / 2 - (vessel ? 0.05 : 0.045)) };
}
function buildVanity({ w, d, h, p }) {
  const g = new THREE.Group(), S = vanitySpec(w, d, h, p), { v, yC, tct } = S;
  const fin = pick(p.faucet, Object.keys(FINISH_HEX), 'chrome'), fmat = finish(fin), white = K.ceramic('#f8f8f6'), ch = K.chrome();
  const color = hex(p.color, WHITE), fm = cabinetMat(p, color);
  const cmat = S.kind === 'integrated' && !p.counter ? K.ceramic(counterHex(p, '#f6f5f1')) : counterMat(p, '#f1efea'), bowlM = S.kind === 'integrated' ? cmat : white;
  const holes = S.vessel ? null : S.xs.map((x) => ({ pts: S.outline(x).map((q) => [q[0], q[2]]) }));
  const yU = yC - tct, dep = Math.min(S.kind === 'integrated' ? 0.1 : 0.125, yU - 0.02 > 0.04 ? 0.125 : 0.04);
  g.add(deck(cmat, -w / 2, w / 2, -d / 2, d / 2, yU, tct, holes));
  for (const x of S.xs) {
    if (S.vessel) {
      const t = 0.012, O = (f, y, i = 0) => S.outline(x, f, y, i);
      g.add(loft([O(0.5, yC), O(0.85, yC + S.vesselH * 0.35), O(1, yC + S.vesselH * 0.9), O(1, h), O(1, h, t), O(0.82, yC + S.vesselH * 0.4, t), O(0.3, yC + 0.025, t)], white));
      g.add(K.cyl(0.018, 0.018, 0.004, ch, x, yC + 0.027, S.bz, 14));
    } else {
      const rings = [S.outline(x, 1, yC), S.outline(x, 1, yU), S.outline(x, 0.9, yC - dep * 0.6), S.outline(x, 0.35, yC - dep)];
      g.add(loft(rings, bowlM, false, true));
      if (v === 'console') g.add(loft([S.outline(x, 0.35, yC - dep - 0.006, -0.006), S.outline(x, 0.9, yC - dep * 0.6, -0.006), S.outline(x, 1, yU, -0.006)], white, true, false));
      g.add(K.cyl(0.018, 0.018, 0.004, ch, x, yC - dep + 0.002, S.bz, 14));
    }
    g.add(extra(at(tap(S.vessel ? 'basin-tall' : 'basin', fin), x, yC, S.tapZ)));
  }
  // cabinet
  const pr = 0.014, zF = d / 2 - pr, drawersN = Math.round(num(p.drawers, 0)), doorsN = Math.round(num(p.doors, 0));
  const pull = (x, y, len) => g.add(K.box(len, 0.006, pr, fmat, x, y, zF + pr / 2));
  if (v === 'console') {
    const fr = hex(p.color2, null) ? K.metal(hex(p.color2, '#222')) : finish(fin === 'chrome' ? 'black' : fin), t = 0.024, ix = w / 2 - t / 2 - 0.01, iz = d / 2 - t / 2 - 0.01, ys = Math.min(0.2, yU * 0.3);
    for (const kx of [-1, 1]) for (const kz of [-1, 1]) g.add(K.boxOn(t, yU, t, fr, kx * ix, 0, kz * iz));
    for (const y of [yU - t / 2, ys]) { for (const kz of [-1, 1]) g.add(K.box(2 * ix, t * 0.8, t * 0.8, fr, 0, y, kz * iz)); for (const kx of [-1, 1]) g.add(K.box(t * 0.8, t * 0.8, 2 * iz, fr, kx * ix, y, 0)); }
    g.add(K.box(2 * ix - t, 0.018, 2 * iz - t, isWoody(color) ? K.wood(color) : fm, 0, ys + t * 0.4 + 0.009, 0));
    g.add(K.rbox(Math.min(0.5, w * 0.5), 0.07, Math.min(0.3, d * 0.6), K.fabric(hex(p.color3, '#e8e4dc')), -w * 0.12, ys + t * 0.4 + 0.053, 0, 0.02));
    if (drawersN > 0 && yU > 0.5) {
      const dh = 0.15, zc = zF - FT - 0.002;
      g.add(deck(fm, -ix + t / 2, ix - t / 2, -iz, zc, yU - t - dh, dh, null), K.box(2 * ix - t, dh, 0.002, shadowMat(), 0, yU - t - dh / 2, zc + 0.001));
      const n = Math.max(S.basins, Math.round(w / 0.7)), mw = (2 * ix - t) / n, F = frontKit(g, { zFace: zF, mat: fm, handles: 'none' });
      for (let i = 0; i < n; i++) { const x = -ix + t / 2 + mw * (i + 0.5); F.panel(x, yU - t - dh, yU - t, mw); pull(x, yU - t - 0.03, mw * 0.4); }
    }
    for (const k of [-1, 1]) g.add(K.box(0.004, 0.004, d, fr, k * (w / 2 - 0.002), 0.002, 0));
  } else {
    const hung = v === 'wall-hung', ph = hung ? 0 : Math.min(0.08, yU * 0.15), y0 = hung ? Math.max(0, yU - clamp(h * 0.55, 0.2, 0.5)) : ph, bw = w - 0.01, zC = zF - FT - 0.002;
    g.add(deck(fm, -bw / 2, bw / 2, -d / 2, zC, y0, yU - y0, holes), K.box(bw, yU - y0, 0.002, shadowMat(), 0, (yU + y0) / 2, zC + 0.001));
    if (ph > 0.005) g.add(K.box(bw - 0.04, ph, d - 0.08, plinthMat(p, color), 0, ph / 2, -0.02));
    const n = Math.max(S.basins, Math.round(w / 0.7)), mw = bw / n, F = frontKit(g, { zFace: zF, mat: fm, handles: 'none' });
    const useDoors = doorsN > 0 || (!hung && drawersN <= 0), rows = clamp(drawersN > 0 ? Math.round(drawersN / n) : useDoors ? 0 : yU - y0 >= 0.36 ? 2 : 1, 0, 4);
    const top = yU - 0.004, yd = useDoors && rows ? top - Math.min(0.16, (top - y0) * 0.3) * Math.min(rows, 1) : useDoors ? top : y0;
    for (let i = 0; i < n; i++) {
      const x = -bw / 2 + mw * (i + 0.5);
      if (useDoors) {
        const leaves = doorsN > 0 ? clamp(Math.round(doorsN / n), 1, 2) : mw > 0.5 ? 2 : 1, lw = mw / leaves;
        for (let k = 0; k < leaves; k++) { const lx = x - mw / 2 + lw * (k + 0.5), side = leaves === 2 ? (k ? -1 : 1) : i % 2 ? -1 : 1; F.panel(lx, y0, yd, lw); g.add(K.box(0.006, Math.min(0.14, (yd - y0) * 0.3), pr, fmat, lx + side * (lw / 2 - 0.03), yd - 0.04 - Math.min(0.14, (yd - y0) * 0.3) / 2, zF + pr / 2)); }
        if (rows) { F.panel(x, yd, top, mw); pull(x, top - 0.035, mw * 0.4); }
      } else for (let r = 0; r < rows; r++) { const ya = y0 + ((top - y0) * r) / rows, yb = y0 + ((top - y0) * (r + 1)) / rows; F.panel(x, ya, yb, mw); pull(x, yb - 0.035, clamp(mw * 0.4, 0.06, 0.4)); }
    }
  }
  if (flag(p.mirror)) {
    const two = S.basins === 2 && w >= 1.2, mw = two ? w / 2 - 0.1 : Math.max(0.2, w - 0.06), mh = 0.72, y0 = h + 0.2, mg = new THREE.Group();
    for (const x of two ? S.xs : [0]) mg.add(K.box(mw - 0.04, mh - 0.04, 0.016, darkPlastic(), x, y0 + mh / 2, -d / 2 + 0.008), K.box(mw, mh, 0.006, K.mirrorMat(), x, y0 + mh / 2, -d / 2 + 0.019));
    g.add(extra(mg));
  }
  return g;
}
function drawVanity(ctx, { w, d, h, p, px }) {
  const S = vanitySpec(w / 100, d / 100, h / 100, p), big = Math.min(w, d) / px > 12;
  rr2(ctx, 0, 0, w, d, 1, K.tint(counterHex(p, '#f1efea'), 0.35), INK, px);
  if (big && S.v !== 'console') K.line(ctx, -w / 2, d / 2 - 1.6, w / 2, d / 2 - 1.6, SOFT, px * 0.75);
  for (const x of S.xs) {
    ring2(ctx, S.outline(x), PAPER, INK, px);
    if (!big) continue;
    ring2(ctx, S.outline(x, 1, 0, 0.018), null, SOFT, px * 0.75);
    circ2(ctx, x * 100, S.bz * 100, 1.5, null, INK, px);
    K.line(ctx, x * 100, S.tapZ * 100, x * 100, S.tapZ * 100 + 8, INK, px * 1.6); circ2(ctx, x * 100, S.tapZ * 100, 1.8, PAPER, INK, px);
  }
}
reg('vanity', buildVanity, drawVanity);

// ═════════════════════════ SHOWER ═════════════════════════
const SHOWERS = ['walk-in', 'corner', 'sliding', 'hinged', 'quadrant', 'tray-only', 'wet-room'];
/**
 * Layout shared by the 3D model and the plan symbol (metres). Panels are straight glass segments:
 * { axis: 'x' | 'z', c, a, b, kind: 'fixed' | 'door' | 'slide', hinge: 'a' | 'b', wall: 'a' | 'b' | null }.
 * Layouts are described for an entry on the front / right; `mirror` flips x for `open: 'left'`.
 */
function showerSpec(w, d, h, p) {
  const v = pick(p.variant, SHOWERS, 'walk-in'), open = pick(p.open, ['front', 'left', 'right'], 'front');
  const tall = h > 1.0, tray = flag(p.tray, v !== 'wet-room'), th = !tall ? h : tray ? Math.min(0.04, h * 0.1) : 0.005;
  const gi = Math.min(0.03, w * 0.05, d * 0.05), F = d / 2 - gi, Rx = w / 2 - gi, B = -d / 2, Lw = -w / 2;
  const side = open !== 'front', mirror = open === 'left';
  const panels = [];
  let headX = 0, brace = null, quadR = 0;
  const framed = v === 'corner' || v === 'sliding' || v === 'hinged' || v === 'quadrant';
  if (!tall || v === 'tray-only') { /* tray only */ }
  else if (v === 'walk-in' || v === 'wet-room') {
    if (side) { panels.push({ axis: 'x', c: F, a: Lw, b: w / 2 - 0.02, kind: 'fixed', wall: 'a' }); brace = [[w / 2 - 0.07, F], [w / 2 - 0.07, B]]; }
    else if (w >= d) {
      const Lg = Math.max(0.3, w - clamp(w * 0.42, 0.55, 0.8));
      panels.push({ axis: 'x', c: F, a: Lw, b: Lw + Lg, kind: 'fixed', wall: 'a' });
      brace = [[Lw + Lg - 0.05, F], [Lw + Lg - 0.05, B]]; headX = Lw + Lg / 2;
    } else {
      const Lg = Math.min(d - 0.02, 1.6), x = Lw + gi;
      panels.push({ axis: 'z', c: x, a: B, b: B + Lg, kind: 'fixed', wall: 'a' });
      brace = [[x, B + Math.min(0.45, Lg * 0.5)], [x + Math.min(0.45, w * 0.4), B]];
    }
  } else if (v === 'quadrant') {
    quadR = Math.min(w, d) * 0.62;
    panels.push({ axis: 'z', c: Rx, a: B, b: d / 2 - quadR, kind: 'fixed', wall: 'a' }, { axis: 'x', c: F, a: Lw, b: w / 2 - quadR, kind: 'fixed', wall: 'a' });
  } else {
    const kind = v === 'sliding' ? 'slide' : 'door';
    const entry = (axis, c, a, b) => {            // a = wall end
      const len = b - a, dw = v === 'sliding' ? len / 2 + 0.03 : len > 1.0 ? 0.8 : len;
      if (v === 'sliding') panels.push({ axis, c, a, b: a + len / 2 + 0.03, kind: 'fixed', wall: 'a' }, { axis, c, a: b - dw, b, kind, off: -0.018, hinge: 'b' });
      else { panels.push({ axis, c, a, b: a + dw, kind, hinge: 'a', wall: 'a' }); if (dw < len - 0.01) panels.push({ axis, c, a: a + dw, b, kind: 'fixed' }); }
    };
    if (!side) {
      const x1 = v === 'corner' ? Rx : w / 2;
      entry('x', F, Lw, x1);
      if (v === 'corner') panels.push({ axis: 'z', c: Rx, a: B, b: F, kind: 'fixed', wall: 'a' });
      else if (panels.length > 1) panels[panels.length - 1].wall = 'b';
    } else { panels.push({ axis: 'x', c: F, a: Lw, b: Rx, kind: 'fixed', wall: 'a' }); entry('z', Rx, B, F); }
  }
  const armLen = Math.min(0.38, Math.max(0.12, d - 0.2));
  const head = !tall ? 'none' : pick(p.head, ['rain', 'hand', 'column', 'none'], v === 'tray-only' ? 'column' : 'rain');
  const drain = { x: tray ? headX : 0, z: tray ? B + Math.min(0.28, d * 0.3) : B + Math.min(0.08, d * 0.15) };
  return { v, open, tall, tray, th, gi, F, Rx, panels, headX, brace, quadR, framed, mirror, armLen, head, drain };
}
/** Wall-mounted shower fittings; origin on the wall at floor level, facing +Z. */
function showerSet(kind, fin, h, armLen) {
  const g = new THREE.Group(), m = finish(fin), ya = h - (kind === 'column' ? 0.012 : 0.03), my = Math.min(1.1, h * 0.55);
  const handset = (x, y, z) => {
    g.add(K.bar([x, y - 0.1, z], [x, y + 0.07, z + 0.03], 0.011, m, 10));
    const hd = K.cyl(0.042, 0.042, 0.014, m, x, y + 0.085, z + 0.045, 20); hd.rotation.x = Math.PI / 3; g.add(hd);
    g.add(tube([[x, y - 0.1, z], [x - 0.03, y - 0.5, z + 0.02], [x - 0.07, y - 0.55, z + 0.01], [x - 0.09, my - 0.12, 0.014]], 0.006, m, 20, 6));
    g.add(cylZ(0.016, 0.02, m, x - 0.09, my - 0.12, 0.01, 10));
  };
  const rainHead = (z0) => {
    g.add(cylZ(0.011, armLen - z0, m, 0, ya, (armLen + z0) / 2, 10), K.cyl(0.011, 0.011, 0.03, m, 0, ya - 0.012, armLen, 10));
    g.add(fin === 'black' ? K.rbox(0.25, 0.01, 0.25, m, 0, ya - 0.032, armLen, 0.004, 2) : K.cyl(0.125, 0.125, 0.01, m, 0, ya - 0.032, armLen, 36));
  };
  if (kind === 'column') {
    g.add(cylX(0.02, 0.26, m, 0, my, 0.045, 14), cylZ(0.013, 0.045, m, -0.075, my, 0.0225, 10), cylZ(0.013, 0.045, m, 0.075, my, 0.0225, 10));
    g.add(K.cyl(0.011, 0.011, ya - my, m, 0, (ya + my) / 2, 0.045, 10), cylZ(0.008, 0.045, m, 0, ya - 0.12, 0.0225, 8));
    rainHead(0.045);
    g.add(K.box(0.03, 0.04, 0.03, m, 0, my + 0.4, 0.06));
    handset(0.0, my + 0.42, 0.075);
  } else {
    g.add(cylZ(0.068, 0.012, m, 0, my, 0.006, 28), cylZ(0.02, 0.04, m, 0, my, 0.03, 14), K.bar([0, my, 0.045], [0.05, my + 0.015, 0.045], 0.006, m, 8));
    if (kind === 'rain') {
      g.add(cylZ(0.028, 0.006, m, 0, ya, 0.003, 16)); rainHead(0);
      g.add(cylZ(0.014, 0.03, m, 0.2, my + 0.12, 0.015, 10));
      handset(0.2, my + 0.14, 0.035);
    } else {
      const y1 = Math.min(h - 0.08, my + 0.75), x = 0.17;
      g.add(K.cyl(0.009, 0.009, y1 - my + 0.1, m, x, (y1 + my - 0.1) / 2, 0.04, 10), cylZ(0.008, 0.04, m, x, y1 - 0.03, 0.02, 8), cylZ(0.008, 0.04, m, x, my - 0.07, 0.02, 8));
      g.add(K.box(0.028, 0.04, 0.03, m, x, y1 - 0.14, 0.05));
      handset(x, y1 - 0.12, 0.065);
    }
  }
  return g;
}
function quadShape(w, d, R, inset = 0) {
  const s = new THREE.Shape(), x0 = -w / 2 + inset, x1 = w / 2 - inset, y0 = -d / 2 + inset, y1 = d / 2 - inset, r = Math.max(0.01, R - inset);
  s.moveTo(x0, y1); s.lineTo(x1, y1); s.lineTo(x1, y0 + r); s.absarc(x1 - r, y0 + r, r, 0, -Math.PI / 2, true); s.lineTo(x0, y0); s.lineTo(x0, y1);
  return s;
}
function buildShower({ w, d, h, p }) {
  const root = new THREE.Group(), g = new THREE.Group(), S = showerSpec(w, d, h, p), { th } = S;
  root.add(g); if (S.mirror) g.scale.x = -1;
  const frame = pick(p.frame, ['chrome', 'black', 'gold', 'none', 'nickel', 'brass', 'white'], 'chrome'), fm = finish(frame === 'none' ? 'chrome' : frame), framed = frame !== 'none';
  const glassKind = pick(p.glass, ['clear', 'frosted', 'smoked'], 'clear');
  const glassM = (side) => (glassKind === 'frosted' ? K.mat('#eef4f5', { roughness: 0.75, opacity: 0.62, depthWrite: false, side }) : K.mat(glassKind === 'smoked' ? '#3d4349' : '#cfe6ec', { roughness: 0.05, opacity: glassKind === 'smoked' ? 0.5 : 0.22, depthWrite: false, side }));
  const gm = glassM(THREE.FrontSide);
  const tm = enamel(hex(p.color, '#f4f4f2'));
  // tray / floor
  if (S.tray || !S.tall) {
    const rimH = Math.min(0.008, th * 0.3), rim = Math.min(0.045, w * 0.1, d * 0.1);
    if (S.quadR) { g.add(flat(quadShape(w, d, S.quadR), th - rimH, tm, 0)); const r = quadShape(w, d, S.quadR); r.holes.push(quadShape(w, d, S.quadR, rim)); g.add(flat(r, rimH, tm, th - rimH)); }
    else { g.add(K.box(w, th - rimH, d, tm, 0, (th - rimH) / 2, 0)); const r = rrShape(w, d, 0.008); r.holes.push(rrShape(w - 2 * rim, d - 2 * rim, 0.03, 0, 0, THREE.Path)); g.add(flat(r, rimH, tm, th - rimH)); }
    g.add(K.box(0.11, 0.004, 0.11, K.chrome(), S.drain.x, th - rimH + 0.001, S.drain.z));
  } else {
    g.add(K.box(w, th, d, K.stone(hex(p.color, '#c4c1bb')), 0, th / 2, 0));
    g.add(K.box(Math.min(0.7, w * 0.6), 0.004, 0.065, steel(), S.drain.x, th + 0.001, S.drain.z), K.box(Math.min(0.7, w * 0.6) - 0.03, 0.002, 0.012, shadowMat(), S.drain.x, th + 0.0035, S.drain.z));
  }
  if (!S.tall) return root;
  // glass
  const hg = h - th, yc = th + hg / 2, T = 0.008, top = S.framed && framed;
  const along = (q, len, sy, t, y, mat, mid, off = 0) => (q.axis === 'x' ? K.box(len, sy, t, mat, mid, y, q.c + off) : K.box(t, sy, len, mat, q.c + off, y, mid));
  for (const q of S.panels) {
    const len = Math.max(0.01, q.b - q.a), mid = (q.a + q.b) / 2, off = q.off || 0;
    g.add(noShadow(along(q, len, hg - (top ? 0.03 : 0), T, yc - (top ? 0.015 : 0), gm, mid, off)));
    if (framed) {
      g.add(along(q, len, 0.014, 0.022, th + 0.007, fm, mid, off));
      if (top) g.add(along(q, len, 0.03, 0.03, h - 0.015, fm, mid, off));
      if (q.wall) g.add(along(q, 0.022, hg, 0.024, yc, fm, q.wall === 'a' ? q.a + 0.011 : q.b - 0.011, off));
      if (q.kind !== 'fixed' && top) g.add(along(q, 0.018, hg, 0.02, yc, fm, q.hinge === 'a' ? q.b - 0.009 : q.a + 0.009, off));
    } else g.add(merged(`clp|${mm(hg)}`, () => [0.2, 0.8].map((f) => gBox(0.045, 0.045, 0.03, 0, hg * (f - 0.5), 0)), fm).translateX(q.axis === 'x' ? (q.wall === 'b' ? q.b - 0.02 : q.a + 0.02) : q.c).translateY(yc).translateZ(q.axis === 'x' ? q.c : q.wall === 'b' ? q.b - 0.02 : q.a + 0.02));
    if (q.kind !== 'fixed') {
      const hp = q.hinge === 'a' ? q.b - 0.07 : q.a + 0.07, hy = Math.min(1.05, th + hg * 0.52);
      g.add(q.axis === 'x' ? K.rbox(0.014, 0.28, 0.06, fm, hp, hy, q.c + off, 0.006, 2) : K.rbox(0.06, 0.28, 0.014, fm, q.c + off, hy, hp, 0.006, 2));
    }
  }
  if (S.framed && framed && S.panels.length && S.v !== 'quadrant' && S.panels.some((q) => q.axis === 'z')) g.add(K.box(0.03, hg, 0.03, fm, S.Rx, yc, S.F));
  if (S.brace) g.add(K.bar([S.brace[0][0], h - 0.03, S.brace[0][1]], [S.brace[1][0], h - 0.03, S.brace[1][1]], 0.008, fm, 8), K.box(0.03, 0.04, 0.03, fm, S.brace[0][0], h - 0.03, S.brace[0][1]));
  if (S.quadR) {
    const R = S.quadR - S.gi, cx = w / 2 - S.quadR, cz = d / 2 - S.quadR;
    const arc = new THREE.Mesh(geo(`qg|${mm(R)}|${mm(hg)}`, () => new THREE.CylinderGeometry(R, R, hg - 0.03, 28, 1, true, 0, Math.PI / 2)), glassM(THREE.DoubleSide));
    g.add(noShadow(at(arc, cx, yc - 0.015, cz)));
    for (const y of framed ? [th + 0.008, h - 0.015] : []) { const t = new THREE.Mesh(geo(`qt|${mm(R)}`, () => new THREE.TorusGeometry(R, 0.012, 6, 28, Math.PI / 2).rotateX(Math.PI / 2)), fm); g.add(at(t, cx, y, cz)); }
    if (framed) g.add(K.box(0.026, hg, 0.026, fm, S.Rx, yc, cz), K.box(0.026, hg, 0.026, fm, cx, yc, S.F));
    const a = Math.PI / 4;
    for (const k of [-0.07, 0.07]) g.add(K.cyl(0.008, 0.008, 0.26, fm, cx + (R + 0.02) * Math.sin(a + k / R), Math.min(1.05, th + hg * 0.52), cz + (R + 0.02) * Math.cos(a + k / R), 8));
  }
  if (S.head !== 'none') g.add(at(showerSet(S.head, frame === 'none' ? 'chrome' : frame, h, S.armLen), S.headX, 0, -d / 2));
  return root;
}
function drawShower(ctx, { w, d, h, p, px }) {
  const S = showerSpec(w / 100, d / 100, h / 100, p), big = Math.min(w, d) / px > 12, fill = K.tint(hex(p.color, '#f4f4f2'), 0.7);
  if (S.mirror) ctx.scale(-1, 1);
  const R = S.quadR * 100;
  const outline = () => { ctx.beginPath(); if (R) { ctx.moveTo(-w / 2, -d / 2); ctx.lineTo(w / 2, -d / 2); ctx.lineTo(w / 2, d / 2 - R); ctx.arc(w / 2 - R, d / 2 - R, R, 0, Math.PI / 2); ctx.lineTo(-w / 2, d / 2); ctx.closePath(); } else ctx.rect(-w / 2, -d / 2, w, d); };
  outline(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = S.tray || !S.tall ? INK : SOFT; ctx.lineWidth = px; ctx.stroke();
  if (big) {
    const k = R ? 0.29 * R : 0;
    K.line(ctx, -w / 2, -d / 2, w / 2 - k, d / 2 - k, SOFT, px * 0.75); K.line(ctx, w / 2, -d / 2, -w / 2, d / 2, SOFT, px * 0.75);
    if (S.tray || !S.tall) rect2(ctx, S.drain.x * 100 - 5.5, S.drain.z * 100 - 5.5, 11, 11, PAPER, INK, px);
    else rect2(ctx, S.drain.x * 100 - Math.min(35, w * 0.3), S.drain.z * 100 - 3, Math.min(70, w * 0.6), 6, PAPER, INK, px);
    if (S.head !== 'none') {
      const hx = S.headX * 100, hz = -d / 2 + S.armLen * 100;
      K.line(ctx, hx, -d / 2, hx, hz, INK, px * 1.4);
      dashed(ctx, px, () => circ2(ctx, hx, hz, 12.5, null, MID, px), 3, 2);
      rect2(ctx, hx - 5, -d / 2, 10, 1.6, '#5b5e64', null);
    }
  }
  const gw = Math.max(1.3, 2 * px);
  for (const q of S.panels) {
    const off = (q.off || 0) * 100, c = q.c * 100 + off, a = q.a * 100, b = q.b * 100;
    if (q.axis === 'x') K.line(ctx, a, c, b, c, GLASS2D, gw); else K.line(ctx, c, a, c, b, GLASS2D, gw);
    if (q.kind === 'door' && big) {
      const hingeAt = q.hinge === 'a' ? a : b, r = b - a, dir = q.hinge === 'a' ? 1 : -1;
      ctx.save(); ctx.strokeStyle = SOFT; ctx.lineWidth = px * 0.75; ctx.beginPath();
      if (q.axis === 'x') { ctx.arc(hingeAt, c, r, dir > 0 ? 0 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI); ctx.moveTo(hingeAt, c); ctx.lineTo(hingeAt, c + r); }
      else { ctx.arc(c, hingeAt, r, dir > 0 ? 0 : -Math.PI / 2, dir > 0 ? Math.PI / 2 : 0); ctx.moveTo(c, hingeAt); ctx.lineTo(c + r, hingeAt); }
      ctx.stroke(); ctx.restore();
    }
  }
  if (R) { ctx.beginPath(); ctx.arc(w / 2 - R, d / 2 - R, R - S.gi * 100, 0, Math.PI / 2); ctx.strokeStyle = GLASS2D; ctx.lineWidth = gw; ctx.stroke(); }
}
reg('shower', buildShower, drawShower);

// ═════════════════════════ BATHTUB ═════════════════════════
const TUBS = ['freestanding', 'built-in', 'corner', 'clawfoot', 'whirlpool'];
function tubSpec(w, d, h, v) {
  const n = 40;
  if (v === 'corner') {
    const s = Math.min(w, d) * 0.28, outline = [[-w / 2, -d / 2], [w / 2, -d / 2]];
    for (let i = 0; i <= 14; i++) { const t = (i / 14) * Math.PI / 2; outline.push([-w / 2 + s + (w - s) * Math.cos(t), -d / 2 + s + (d - s) * Math.sin(t)]); }
    outline.push([-w / 2, d / 2]);
    const q = Math.SQRT1_2, I = (f, y, drop = 0) => Array.from({ length: n }, (_, j) => {
      const a = (j / n) * Math.PI * 2, u = 0.36 * f * Math.cos(a), t = 0.2 * f * Math.sin(a);
      return [(0.05 + drop + u * q + t * q) * w, y, (0.05 + drop - u * q + t * q) * d];
    });
    return { outline, I, cx: 0.05 * w, cz: 0.05 * d, tap: [-w / 2 + Math.min(0.16, w * 0.12), -d / 2 + Math.min(0.16, d * 0.12)], tapRot: Math.PI / 4, drain: [0.2 * w, -0.1 * d] };
  }
  if (v === 'built-in' || v === 'whirlpool') {
    const rim = clamp(Math.min(w, d) * 0.08, 0.03, 0.07) * (v === 'whirlpool' ? 1.25 : 1), rimTap = rim + Math.min(0.05, w * 0.04);
    const cx = (rim - rimTap) / 2, rx = (w - rim - rimTap) / 2, rz = (d - 2 * rim) / 2;
    const I = (f, y, drop = 0) => ring(cx + drop * rx, 0, rx * f, rz * (0.2 + 0.8 * f), y, n, 0.38);
    return { I, rx, rz, cx, rim, tap: [w / 2 - rimTap / 2, 0], tapRot: -Math.PI / 2, drain: [cx + rx * 0.55, 0] };
  }
  const t = Math.min(0.03, d * 0.06), O = (f, y) => ring(0, 0, (w / 2) * f, (d / 2) * f, y, n, 0.8);
  const I = (f, y) => ring(0, 0, (w / 2 - t) * f, (d / 2 - t) * (0.25 + 0.75 * f), y, n, 0.8);
  return { O, I, tap: [w / 2 - Math.min(0.07, w * 0.05), -d / 2 + Math.min(0.06, d * 0.09)], drain: [w * 0.22, 0] };
}
function buildBathtub({ w, d, h, p }) {
  const g = new THREE.Group(), v = pick(p.variant, TUBS, 'built-in'), S = tubSpec(w, d, h, v);
  const white = K.ceramic('#f9f9f7'), shell = K.ceramic(hex(p.color, '#f9f9f7')), ch = K.chrome(), fin = pick(p.finish, Object.keys(FINISH_HEX), 'chrome');
  const depth = Math.min(0.42, h * 0.76);
  if (v === 'corner' || v === 'built-in' || v === 'whirlpool') {
    const top = S.I(1, h), holes = [{ pts: top.map((q) => [q[0], q[2]]) }];
    if (v === 'corner') { const s = new THREE.Shape(S.outline.map(([x, z]) => new THREE.Vector2(x, -z))); s.holes.push(new THREE.Path(holes[0].pts.map(([x, z]) => new THREE.Vector2(x, -z)))); g.add(flat(s, h, shell, 0)); }
    else g.add(deck(shell, -w / 2, w / 2, -d / 2, d / 2, 0, h, holes));
    g.add(loft([top, S.I(0.97, h - depth * 0.12), S.I(0.86, h - depth * 0.7, 0.03), S.I(0.66, h - depth, 0.05)], white, false, true));
    g.add(K.cyl(0.024, 0.024, 0.004, ch, S.drain[0], h - depth + 0.003, S.drain[1], 16));
    const t = tap('bath', fin); t.rotation.y = S.tapRot; g.add(extra(at(t, S.tap[0], h, S.tap[1])));
    if (v === 'whirlpool') {
      g.add(merged(`jets|${mm(S.rx)}|${mm(S.rz)}`, () => [-0.5, 0, 0.5].flatMap((f) => [-1, 1].map((k) => gCyl(0.02, 0.012, f * S.rx, 0, k * S.rz * 0.86, 'z', 14))), ch, S.cx, h - depth * 0.55, 0));
      g.add(extra(merged('wpk', () => [-0.05, 0.05].map((x) => gCyl(0.018, 0.02, x, 0.01, 0, 'y', 14)), ch, S.cx - S.rx * 0.5, h, -d / 2 + S.rim * 0.5)));
      g.add(K.rbox(0.05, 0.1, Math.min(0.32, d * 0.4), K.mat('#55585e', { roughness: 0.7 }), S.cx - S.rx + 0.04, h - 0.06, 0, 0.02));
    }
  } else {
    const claw = v === 'clawfoot', fh = claw ? clamp(h * 0.2, 0.04, 0.14) : 0, H = h - fh, floorY = fh + Math.max(0.03, H - depth);
    const outer = claw
      ? [S.O(0.55, fh), S.O(0.78, fh + H * 0.14), S.O(0.92, fh + H * 0.55), S.O(0.965, h - 0.04), S.O(1, h - 0.022), S.O(0.995, h - 0.006), S.O(0.97, h)]
      : [S.O(0.7, 0), S.O(0.8, H * 0.12), S.O(0.93, H * 0.55), S.O(1, h - 0.012), S.O(1, h)];
    g.add(loft(outer, shell, true, false));
    g.add(loft([outer[outer.length - 1], S.I(claw ? 0.97 : 1, h), S.I(0.9, fh + H * 0.55), S.I(0.6, floorY)], white, false, true));
    g.add(K.cyl(0.024, 0.024, 0.004, ch, S.drain[0], floorY + 0.003, S.drain[1], 16));
    if (claw) {
      const fm = finish(pick(p.feet, Object.keys(FINISH_HEX), hex(p.color2, null) ? 'x' : 'gold'));
      const m = hex(p.color2, null) ? K.metal(hex(p.color2, '#222')) : fm;
      for (const kx of [-1, 1]) for (const kz of [-1, 1]) { const x = kx * w * 0.3, z = kz * d * 0.27; g.add(K.sphere(Math.min(0.035, fh * 0.45), m, x, Math.min(0.035, fh * 0.45), z, 12, 8), K.bar([x, 0.03, z], [x * 0.82, fh + H * 0.1, z * 0.75], Math.min(0.02, fh * 0.3), m, 8)); }
    }
    // floor-standing filler in the free corner of the footprint
    const t = new THREE.Group(), m = finish(fin), [tx, tz] = S.tap, ty = h + 0.24;
    t.add(K.cylOn(0.03, 0.034, 0.015, m, tx, 0, tz, 16), K.cylOn(0.015, 0.015, ty, m, tx, 0, tz, 12));
    t.add(tube([[tx, ty, tz], [tx - 0.02, ty + 0.07, tz + 0.02], [tx - 0.1, ty + 0.08, tz + 0.1], [tx - 0.16, ty + 0.02, tz + 0.16], [tx - 0.165, ty - 0.03, tz + 0.165]], 0.012, m, 20, 8));
    t.add(K.bar([tx, ty - 0.1, tz], [tx + 0.035, ty - 0.08, tz - 0.035], 0.007, m, 8), K.cyl(0.02, 0.02, 0.05, m, tx, ty - 0.1, tz, 12));
    g.add(extra(t));
  }
  if (flag(p.screen)) {
    const sw = Math.min(0.85, w * 0.5), sh = 1.4, sg = new THREE.Group();
    sg.add(noShadow(K.box(sw, sh, 0.008, K.glass('#cfe6ec', 0.22), w / 2 - sw / 2, h + sh / 2, d / 2 - 0.03)), K.box(0.02, sh, 0.022, ch, w / 2 - 0.01, h + sh / 2, d / 2 - 0.03));
    g.add(extra(sg));
  }
  return g;
}
function drawBathtub(ctx, { w, d, h, p, px }) {
  const v = pick(p.variant, TUBS, 'built-in'), S = tubSpec(w / 100, d / 100, h / 100, v), big = Math.min(w, d) / px > 12, fill = K.tint(hex(p.color, '#f9f9f7'), 0.7);
  const built = v !== 'freestanding' && v !== 'clawfoot';
  if (v === 'corner') poly2(ctx, S.outline.map(([x, z]) => [x * 100, z * 100]), fill, INK, px);
  else if (built) rr2(ctx, 0, 0, w, d, 1.5, fill, INK, px);
  else ring2(ctx, S.O(1, 0), fill, INK, px);
  ring2(ctx, S.I(1, 0), PAPER, INK, px);
  if (big) {
    ring2(ctx, S.I(0.86, 0, built ? 0.03 : undefined), null, SOFT, px * 0.75);
    circ2(ctx, S.drain[0] * 100, S.drain[1] * 100, 2.4, null, INK, px);
    const [tx, tz] = [S.tap[0] * 100, S.tap[1] * 100];
    if (built) { ctx.save(); ctx.translate(tx, tz); ctx.rotate(-(S.tapRot || 0)); rect2(ctx, -9, -2, 18, 4, PAPER, INK, px); K.line(ctx, 0, 0, 0, 10, INK, px * 1.6); ctx.restore(); }
    else { K.line(ctx, tx, tz, tx - 13, tz + 13, INK, px * 1.6); circ2(ctx, tx, tz, 2.6, PAPER, INK, px); }
    if (v === 'whirlpool') for (const f of [-0.5, 0, 0.5]) for (const k of [-1, 1]) circ2(ctx, (S.cx + f * S.rx) * 100, k * S.rz * 82, 1.3, '#5b5e64', null);
    if (v === 'clawfoot') for (const kx of [-1, 1]) for (const kz of [-1, 1]) circ2(ctx, kx * w * 0.3, kz * d * 0.27, 1.6, null, SOFT, px);
  }
  if (flag(p.screen)) K.line(ctx, w / 2 - Math.min(85, w * 0.5), d / 2 - 3, w / 2, d / 2 - 3, GLASS2D, Math.max(1.3, 2 * px));
}
reg('bathtub', buildBathtub, drawBathtub);

// ═════════════════════════ MIRROR & BATH ACCESSORIES ═════════════════════════
const MIRROR_SHAPES = ['rect', 'round', 'oval', 'arch', 'pill', 'organic'];
/** Mirror outline in the XY plane (x ±w/2, y 0..h), optionally inset on all sides. */
function mirrorShape(kind, w, h, inset = 0, Ctor = THREE.Shape) {
  const W = Math.max(0.01, w - 2 * inset), H = Math.max(0.01, h - 2 * inset), cy = h / 2;
  if (kind === 'round' || kind === 'oval') { const s = new Ctor(); s.absellipse(0, cy, W / 2, H / 2, 0, Math.PI * 2, false, 0); return s; }
  if (kind === 'pill') return rrShape(W, H, Math.min(W, H) / 2, 0, cy, Ctor);
  if (kind === 'arch') {
    const s = new Ctor(), ry = Math.min(W / 2, H);
    s.moveTo(-W / 2, cy - H / 2); s.lineTo(W / 2, cy - H / 2); s.lineTo(W / 2, cy + H / 2 - ry);
    s.absellipse(0, cy + H / 2 - ry, W / 2, ry, 0, Math.PI, false, 0); s.lineTo(-W / 2, cy - H / 2);
    return s;
  }
  if (kind === 'organic') {
    const pts = [];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * Math.PI * 2, r = 1 + 0.1 * Math.sin(2 * a + 0.6) + 0.07 * Math.sin(3 * a + 1.9) + 0.03 * Math.cos(5 * a);
      const x = r * Math.cos(a), y = r * Math.sin(a) * 1.05; pts.push([x, y]);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return new Ctor(pts.map(([x, y]) => new THREE.Vector2(((x - x0) / (x1 - x0) - 0.5) * W, cy + ((y - y0) / (y1 - y0) - 0.5) * H)));
  }
  return rrShape(W, H, 0.004, 0, cy, Ctor);
}
/** Upright mirror of thickness t (back on z = −t/2). */
function mirrorBody(w, t, h, p, dfltFrame = 'none') {
  const g = new THREE.Group(), kind = pick(p.shape, MIRROR_SHAPES, 'rect'), frame = pick(p.frame, ['none', 'thin', 'wood', 'metal', 'led'], dfltFrame);
  const z0 = -t / 2, mir = K.mirrorMat(), gt = Math.min(0.006, t * 0.4);
  if (flag(p.cabinet)) {
    const n = Math.max(1, Math.round(w / 0.4)), dt = Math.min(0.018, t * 0.3), bd = t - dt - 0.002;
    g.add(K.box(w, h, bd, enamel(hex(p.color, '#f4f4f2')), 0, h / 2, z0 + bd / 2), K.box(w - 0.004, h - 0.004, 0.002, shadowMat(), 0, h / 2, z0 + bd + 0.001));
    for (let i = 0; i < n; i++) g.add(K.box(w / n - GAP, h - GAP, dt, mir, -w / 2 + (w / n) * (i + 0.5), h / 2, z0 + t - dt / 2));
    return g;
  }
  const lim = Math.min(w, h) * 0.14, fw = Math.min(lim, frame === 'thin' ? 0.008 : frame === 'wood' ? 0.035 : frame === 'metal' ? 0.018 : 0);
  if (fw > 0) {
    const fm = frame === 'wood' ? K.wood(hex(p.color, '#c8a476')) : frame === 'metal' ? K.mat(hex(p.color, '#c9a657'), { roughness: 0.25, metalness: 0.9 }) : K.metal(hex(p.color, '#1f2023'));
    const s = mirrorShape(kind, w, h); s.holes.push(mirrorShape(kind, w, h, fw, THREE.Path));
    g.add(upright(s, t, fm, z0), upright(mirrorShape(kind, w, h, fw - 0.0005), Math.max(0.002, t - 0.006), mir, z0));
  } else if (frame === 'led') {
    g.add(noShadow(upright(mirrorShape(kind, w, h), Math.max(0.002, t - gt - 0.004), K.glow('#fff1d8', 1.5), z0)));
    g.add(upright(mirrorShape(kind, w, h, Math.min(0.014, lim)), gt + 0.004, mir, z0 + t - gt - 0.004));
  } else {
    g.add(upright(mirrorShape(kind, w, h, Math.min(0.02, lim)), Math.max(0.002, t - gt), darkPlastic(), z0), upright(mirrorShape(kind, w, h), gt, mir, z0 + t - gt));
  }
  return g;
}
function buildMirror({ w, d, h, p }) {
  if (!flag(p.floor)) return mirrorBody(w, d, h, p);
  // leaning floor mirror: bottom edge at the front of the box, top edge against the wall
  const t = Math.min(0.03, d);
  let th = Math.atan2(Math.max(0, d - t), h), L = h;
  for (let k = 0; k < 6; k++) { L = (h - t * Math.sin(th)) / Math.cos(th); th = Math.asin(clamp((d - t * Math.cos(th)) / L, 0, 0.9)); }
  const root = new THREE.Group(), body = mirrorBody(w, t, L, { ...p, cabinet: false }, 'thin');
  body.rotation.x = -th; root.add(body); root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root);
  body.position.set(0, -bb.min.y, -d / 2 - bb.min.z);
  return root;
}
function drawMirror(ctx, { w, d, p, px }) {
  const t = Math.max(d, 1.2);
  rect2(ctx, -w / 2, -d / 2, w, t, flag(p.cabinet) ? '#f4f4f2' : '#d3e6ee', INK, px);
  K.line(ctx, -w / 2 + 0.6, -d / 2 + t, w / 2 - 0.6, -d / 2 + t, GLASS2D, Math.max(0.8, 1.5 * px));
}
reg('mirror', buildMirror, drawMirror);

const RAILS = ['ladder', 'bar', 'heated', 'hooks', 'shelf', 'paper-holder', 'laundry-basket'];
function railSpec(w, h, v) {
  const heated = v === 'heated', n = clamp(Math.round(h / (heated ? 0.07 : 0.11)), 2, 26), ys = [];
  for (let i = 0; i < n; i++) { const f = (i + 0.5) / n; ys.push(heated && n >= 8 && (i % 5) === 4 ? null : 0.04 + f * (h - 0.08)); }
  return ys.filter((y) => y !== null);
}
function buildRail({ w, d, h, p }) {
  const g = new THREE.Group(), v = pick(p.variant, RAILS, 'ladder');
  const c = hex(p.color, null), m = !c ? K.chrome() : hsl(c).l > 0.85 ? enamel(c) : K.mat(c, { roughness: 0.38, metalness: 0.6 });
  const towelM = K.fabric(hex(p.color2, '#e9e5dd')), z0 = -d / 2;
  const towel = (x, yTop, len, tw, zc) => { g.add(K.rbox(tw, len, 0.012, towelM, x, yTop - len / 2, zc + 0.012, 0.005, 2), K.rbox(tw, len * 0.7, 0.012, towelM, x, yTop - len * 0.35, zc - 0.012, 0.005, 2), cylX(0.018, tw, towelM, x, yTop, zc, 10)); };
  if (v === 'ladder' || v === 'heated') {
    const tr = Math.min(0.013, w * 0.04, d * 0.3), heated = v === 'heated', zc = d / 2 - tr, ys = railSpec(w, h, v), y0 = heated ? Math.min(0.035, h * 0.06) : 0;
    for (const k of [-1, 1]) g.add(K.cyl(tr, tr, h - y0, m, k * (w / 2 - tr), (h + y0) / 2, zc, 12));
    g.add(merged(null, () => ys.map((y) => (heated ? gBox(w - 2 * tr, 0.024, tr * 1.2, 0, y, 0) : gCyl(tr * 0.72, w - 2 * tr, 0, y, 0, 'x', 10))), m, 0, 0, zc));
    g.add(merged(`rb|${mm(w)}|${mm(h)}|${mm(d)}`, () => [-1, 1].flatMap((k) => [0.12, 0.88].flatMap((f) => [gCyl(0.007, d - tr, k * (w / 2 - tr), h * f, -tr / 2, 'z', 8), gCyl(0.018, 0.006, k * (w / 2 - tr), h * f, z0 + 0.003 - (d / 2 - tr) + d / 2 - tr, 'z', 12)])), m, 0, 0, 0));
    if (heated) { for (const k of [-1, 1]) g.add(K.cylOn(tr * 0.9, tr * 0.9, y0, K.chrome(), k * (w / 2 - tr), 0, zc, 10)); g.add(cylX(0.016, 0.04, enamel('#f2f2f0'), w / 2 - tr - 0.035, y0 * 0.6, zc, 12)); }
    if (h > 0.5 && ys.length > 2) { const y = ys[Math.floor(ys.length * 0.62)]; towel(-w * 0.06, y + 0.012, Math.min(0.36, y - 0.02), w * 0.6, zc); }
  } else if (v === 'bar') {
    const r = Math.min(0.01, d * 0.2), yb = h > 0.25 ? h - 0.022 : h / 2, zc = d / 2 - (h > 0.25 ? 0.019 : r);
    g.add(cylX(r, w, m, 0, yb, zc, 12));
    g.add(merged(`bp|${mm(w)}|${mm(d)}|${mm(h)}`, () => [-1, 1].flatMap((k) => [gCyl(r * 0.9, zc - z0, k * (w / 2 - 0.03), 0, (zc + z0) / 2, 'z', 8), gCyl(Math.min(0.022, h / 2), 0.006, k * (w / 2 - 0.03), 0, z0 + 0.003, 'z', 14)]), m, 0, yb, 0));
    if (h > 0.25) towel(-w * 0.08, yb + 0.008, yb + 0.008, w * 0.55, zc);
  } else if (v === 'hooks') {
    const ph = Math.min(h, 0.06), n = clamp(Math.round(w / 0.13), 2, 10), yb = h - ph / 2;
    g.add(K.rbox(w, ph, Math.min(0.016, d * 0.3), m, 0, yb, z0 + Math.min(0.016, d * 0.3) / 2, 0.005, 2));
    g.add(merged(`hk|${n}|${mm(w)}|${mm(d)}`, () => Array.from({ length: n }, (_, i) => (i + 0.5) / n * w - w / 2).flatMap((x) => [gCyl(0.006, d - 0.012, x, 0, 0.006, 'z', 8), gCyl(0.011, 0.012, x, 0.004, d / 2 - 0.006, 'z', 10)]), m, 0, yb, 0));
    if (h > 0.3) g.add(K.rbox(Math.min(0.2, w * 0.3), h - ph * 0.5, Math.min(0.05, d * 0.5), towelM, clamp((1.5 / n) * w - w / 2, -w / 2 + Math.min(0.2, w * 0.3) / 2, w / 2 - Math.min(0.2, w * 0.3) / 2), (h - ph * 0.5) / 2, d / 2 - Math.min(0.05, d * 0.5) / 2 - 0.006, 0.02));
  } else if (v === 'shelf') {
    const tall = h > 0.2, ys = tall ? h - Math.min(0.14, h * 0.4) : h - 0.008;
    g.add(noShadow(K.box(w - 0.02, 0.008, d - 0.01, K.glass('#d6e6ea', 0.4), 0, ys + 0.004, 0.005)));
    g.add(merged(`sh|${mm(w)}|${mm(d)}`, () => [-1, 1].flatMap((k) => [gBox(0.012, 0.03, d, k * (w / 2 - 0.006), -0.011, 0), gCyl(0.006, d * 0.8, k * (w / 2 - 0.006), -0.05, d * 0.1, 'z', 8)]).concat([gCyl(0.007, w, 0, -0.05, d / 2 - 0.019, 'x', 10)]), m, 0, ys, 0));
    if (tall) { g.add(K.rbox(w * 0.42, (h - ys - 0.008) * 0.5, d * 0.7, towelM, -w * 0.2, ys + 0.008 + (h - ys - 0.008) * 0.25, 0, 0.012), K.rbox(w * 0.4, (h - ys - 0.008) * 0.5, d * 0.66, K.fabric(hex(p.color3, '#cfd8d6')), -w * 0.2, ys + 0.008 + (h - ys - 0.008) * 0.75, 0, 0.012)); }
    if (h > 0.35) towel(w * 0.15, ys - 0.043, ys - 0.043, w * 0.4, d / 2 - 0.019); else g.add(K.box(w, 0.004, 0.004, m, 0, 0.002, z0 + 0.002));
  } else if (v === 'paper-holder') {
    const r = Math.min(h, d) / 2 * 0.98, zc = d / 2 - r, rl = Math.min(0.1, w * 0.8);
    g.add(cylX(r, rl, K.mat('#fbfaf6', { roughness: 0.95 }), -(w - rl) / 2 + 0.004, r, zc, 24), cylX(r * 0.38, rl + 0.002, K.mat('#b9a98f', { roughness: 0.9 }), -(w - rl) / 2 + 0.004, r, zc, 12));
    g.add(cylX(0.006, w - 0.012, m, 0, r, zc, 8), cylZ(0.006, zc - z0, m, w / 2 - 0.012, r, (zc + z0) / 2, 8), cylZ(Math.min(0.02, r), 0.006, m, w / 2 - 0.012, r, z0 + 0.003, 14));
    g.add(K.box(w, 0.003, 0.003, m, 0, h - 0.0015, z0 + 0.0015));
  } else {
    const rm = K.rattan(hex(p.color, '#c9a878')), O = (f, y, i = 0) => ring(0, 0, (w / 2) * f - i, (d / 2) * f - i, y, 32, 0.42);
    g.add(loft([O(0.86, 0), O(0.88, h * 0.04), O(1, h - 0.03), O(1, h), O(1, h, 0.012), O(0.98, h - Math.min(0.05, h * 0.1), 0.012)], rm, true, false));
    g.add(loft([O(0.98, h - Math.min(0.05, h * 0.1), 0.012), O(0.5, h - Math.min(0.035, h * 0.07), 0.012)], K.fabric(hex(p.color2, '#ece8df')), false, true));
    for (const k of [-1, 1]) g.add(K.box(0.006, Math.min(0.03, h * 0.08), Math.min(0.11, d * 0.35), shadowMat(), k * (w / 2 - 0.004) * 0.985, h * 0.8, 0));
  }
  return g;
}
function drawRail(ctx, { w, d, h, p, px }) {
  const v = pick(p.variant, RAILS, 'ladder'), big = Math.min(w, d) / px > 6, fill = K.tint(hex(p.color, '#c9cdd2'), 0.5);
  if (v === 'laundry-basket') { ring2(ctx, ring(0, 0, w / 200, d / 200, 0, 40, 0.42), K.tint(hex(p.color, '#c9a878'), 0.4), INK, px); if (big) ring2(ctx, ring(0, 0, w / 200 - 0.02, d / 200 - 0.02, 0, 40, 0.42), null, SOFT, px); return; }
  if (v === 'paper-holder') { const rl = Math.min(10, w * 0.8); rect2(ctx, -w / 2, -d / 2, rl, d, PAPER, INK, px); K.line(ctx, w / 2 - 1, -d / 2, w / 2 - 1, d / 2 - d * 0.3, INK, px); return; }
  if (v === 'shelf') { rect2(ctx, -w / 2, -d / 2, w, d, 'rgba(214,230,234,0.7)', INK, px); if (big) rr2(ctx, -w * 0.2, 0, w * 0.42, d * 0.7, 1.5, PAPER, SOFT, px); return; }
  const zc = d / 2 - Math.min(1.3, d * 0.3);
  if (v === 'ladder' || v === 'heated') rect2(ctx, -w * 0.36, zc - 2, w * 0.6, 4, K.tint(hex(p.color2, '#e9e5dd'), 0.2), SOFT, px * 0.75);
  K.line(ctx, -w / 2, zc, w / 2, zc, INK, Math.max(px * 1.5, 1));
  for (const k of [-1, 1]) K.line(ctx, k * (w / 2 - 1.5), -d / 2, k * (w / 2 - 1.5), zc, INK, px);
  if (v === 'hooks') { K.line(ctx, -w / 2, -d / 2 + 0.8, w / 2, -d / 2 + 0.8, INK, Math.max(px * 1.5, 1.2)); const n = clamp(Math.round(w / 13), 2, 10); for (let i = 0; i < n; i++) circ2(ctx, ((i + 0.5) / n) * w - w / 2, d / 2 - 1, 1, fill, INK, px); }
}
reg('towel-rail', buildRail, drawRail);

// ═════════════════════════ CLIMATE ═════════════════════════
const ACS = ['split', 'floor', 'cassette', 'portable', 'mini-central-grille'];
const bez = (a, c, b, n = 7) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; });
function buildAC({ w, d, h, p }) {
  const g = new THREE.Group(), v = pick(p.variant, ACS, 'split'), white = K.plastic(hex(p.color, '#f6f6f3')), dark = shadowMat(), grey = K.mat('#aeb1b5', { roughness: 0.5 });
  if (v === 'split') {
    const zb = -d / 2, zf = d / 2, A = [zf, h * 0.42], Bp = [zf - d * 0.5, 0], C = [zf - d * 0.05, h * 0.02];
    g.add(profileX([[zb, h * 0.08], [zb, h], ...bez([zf - d * 0.32, h], [zf, h], [zf, h * 0.66]), ...bez(A, C, Bp), [zb + d * 0.22, 0]], w, white));
    g.add(at(slats(clamp(Math.round((d * 0.5) / 0.02), 2, 8), w - 0.1, 0.007, 0.003, 0.02, grey, 'z', 'x'), 0, h, zb + d * 0.36));
    g.add(K.box(w - 0.02, 0.0015, 0.002, K.mat('#cfcfcc', { roughness: 0.5 }), 0, h * 0.42, zf));
    const dz = A[0] - Bp[0], dy = A[1] - Bp[1], len = Math.hypot(dz, dy), nz = dy / len, ny = -dz / len, mz = zf - d * 0.15, my = h * 0.115, rot = -Math.atan2(dy, dz);
    const slot = K.box(w - 0.12, 0.004, len * 0.5, dark, 0, my + ny * 0.0015, mz + nz * 0.0015); slot.rotation.x = rot; g.add(slot);
    const fl = K.box(w - 0.13, 0.004, len * 0.42, white, 0, my + ny * 0.006 + 0.004, mz + nz * 0.006 + 0.004); fl.rotation.x = rot + 0.3; g.add(fl);
    g.add(noShadow(K.box(0.03, 0.01, 0.001, lcd('#c8f1ff'), w / 2 - Math.min(0.1, w * 0.12), h * 0.54, zf + 0.0006)));
  } else if (v === 'floor' || v === 'portable') {
    const port = v === 'portable', ft = Math.min(port ? 0.035 : 0.03, h * 0.1), stub = port ? Math.min(0.05, d * 0.15) : 0, bd = d - stub, zc = stub / 2;
    g.add(K.rbox(w, h - ft, bd, white, 0, ft + (h - ft) / 2, zc, Math.min(0.03, bd * 0.2)));
    if (port) {
      g.add(merged(`cst|${mm(w)}|${mm(bd)}`, () => [-1, 1].flatMap((i) => [-1, 1].map((j) => gCyl(ft * 0.55, 0.025, i * (w / 2 - 0.05), 0, j * (bd / 2 - 0.05), 'x', 10))), darkPlastic(), 0, ft * 0.55, zc));
      g.add(cylZ(Math.min(0.07, w * 0.22), stub + 0.02, grey, 0, h * 0.68, -d / 2 + stub / 2 + 0.01, 20));
      g.add(K.box(w * 0.55, 0.003, bd * 0.3, blackGlass(), 0, h, zc - bd * 0.12), K.box(w * 0.7, 0.004, bd * 0.2, dark, 0, h, zc + bd * 0.26));
      for (const k of [-1, 1]) g.add(K.box(0.004, 0.035, bd * 0.3, dark, k * (w / 2 + 0.0005), h * 0.78, zc));
    } else {
      g.add(K.box(w - 0.04, ft, bd - 0.04, grey, 0, ft / 2, zc - 0.01));
      g.add(K.box(w - 0.1, 0.004, d * 0.4, dark, 0, h, d * 0.1), at(slats(4, w - 0.1, 0.004, 0.006, d * 0.09, white, 'z', 'x'), 0, h + 0.002, d * 0.1));
      g.add(noShadow(K.box(0.04, 0.012, 0.001, lcd('#c8f1ff'), w / 2 - 0.08, h * 0.86, d / 2 + 0.0006)));
    }
    const n = clamp(Math.round((h * 0.28) / 0.018), 3, 16);
    g.add(K.box(w - 0.1, n * 0.018 + 0.006, 0.002, K.mat('#dededb', { roughness: 0.6 }), 0, ft + h * 0.22, d / 2 + 0.0005), at(slats(n, w - 0.12, 0.007, 0.003, 0.018, dark, 'y', 'x'), 0, ft + h * 0.22, d / 2 + 0.001));
  } else if (v === 'cassette') {
    const pt = Math.min(0.035, h * 0.3);
    g.add(K.rbox(w, pt, d, white, 0, pt / 2, 0, 0.01, 2));
    if (h - pt > 0.01) g.add(K.box(w - 0.12, h - pt, d - 0.12, steelDark(), 0, pt + (h - pt) / 2, 0));
    g.add(K.box(w * 0.54, 0.003, d * 0.54, K.mat('#e3e3e0', { roughness: 0.6 }), 0, -0.001, 0), at(slats(clamp(Math.round((d * 0.5) / 0.022), 3, 30), w * 0.5, 0.008, 0.003, 0.022, grey, 'z', 'x'), 0, -0.003, 0));
    for (const k of [-1, 1]) g.add(K.box(w * 0.6, 0.003, Math.min(0.04, d * 0.07), dark, 0, -0.001, k * d * 0.39), K.box(Math.min(0.04, w * 0.07), 0.003, d * 0.6, dark, k * w * 0.39, -0.001, 0));
  } else if (h < Math.min(w, d) * 0.5) {                        // ceiling grille (lies flat, faces down)
    const n = clamp(Math.round((d - 0.07) / 0.025), 2, 40);
    g.add(K.box(w, h, d, white, 0, h / 2, 0), K.box(w - 0.06, 0.002, d - 0.06, dark, 0, -0.0005, 0));
    g.add(at(slats(n, w - 0.07, 0.005, 0.008, (d - 0.07) / n, white, 'z', 'x'), 0, -0.003, 0));
  } else {                                                      // wall grille
    const fr = Math.min(0.03, w * 0.1, h * 0.1), n = clamp(Math.round((h - 2 * fr) / 0.024), 2, 40), s = rrShape(w, h, 0.004, 0, h / 2);
    s.holes.push(rrShape(w - 2 * fr, h - 2 * fr, 0, 0, h / 2, THREE.Path));
    g.add(upright(s, d, white, -d / 2), K.box(w - 2 * fr, h - 2 * fr, 0.004, dark, 0, h / 2, -d / 2 + 0.002));
    g.add(at(slats(n, w - 2 * fr, 0.005, Math.max(0.004, d * 0.7), (h - 2 * fr) / n, white, 'y', 'x'), 0, h / 2, d * 0.12));
  }
  return g;
}
function drawAC(ctx, { w, d, h, p, px }) {
  const v = pick(p.variant, ACS, 'split'), big = Math.min(w, d) / px > 10;
  if (v === 'floor' || v === 'portable') {
    rr2(ctx, 0, 0, w, d, Math.min(3, d * 0.2), '#f6f6f3', INK, px);
    if (big) for (let i = 1; i <= 3; i++) K.line(ctx, -w / 2 + 4, -d / 2 + (d * i) / 4, w / 2 - 4, -d / 2 + (d * i) / 4, SOFT, px * 0.75);
    return;
  }
  rect2(ctx, -w / 2, -d / 2, w, d, 'rgba(255,255,255,0.55)', null);
  dashed(ctx, px, () => {
    rr2(ctx, 0, 0, w, d, Math.min(2, d * 0.2), null, MID, px);
    if (!big) return;
    if (v === 'cassette') { rect2(ctx, -w * 0.27, -d * 0.27, w * 0.54, d * 0.54, null, SOFT, px); K.line(ctx, -w / 2, -d / 2, -w * 0.27, -d * 0.27, SOFT, px); K.line(ctx, w / 2, -d / 2, w * 0.27, -d * 0.27, SOFT, px); K.line(ctx, -w / 2, d / 2, -w * 0.27, d * 0.27, SOFT, px); K.line(ctx, w / 2, d / 2, w * 0.27, d * 0.27, SOFT, px); }
    else K.line(ctx, -w / 2 + 3, d / 2 - Math.min(4, d * 0.3), w / 2 - 3, d / 2 - Math.min(4, d * 0.3), SOFT, px);
  }, 4, 2.5);
}
reg('ac-unit', buildAC, drawAC);

function buildACOutdoor({ w, d, h, p }) {
  const g = new THREE.Group(), body = K.mat(hex(p.color, '#e6e5df'), { roughness: 0.55, metalness: 0.15 }), dark = shadowMat();
  const ft = Math.min(0.04, h * 0.08), pr = Math.min(0.016, d * 0.06), sv = Math.min(0.03, w * 0.05), bw = w - sv, cxb = -sv / 2, zF = d / 2 - pr, H = h - ft;
  g.add(K.rbox(bw, H, zF + d / 2, body, cxb, ft + H / 2, (zF - d / 2) / 2, 0.012, 2));
  for (const k of [-1, 1]) g.add(K.box(Math.min(0.06, w * 0.08), ft, d, darkPlastic(), cxb + k * bw * 0.32, ft / 2, 0));
  const R = Math.min(H * 0.42, bw * 0.31), fx = cxb - bw * 0.14, fy = ft + H * 0.5;
  g.add(cylZ(R, 0.004, dark, fx, fy, zF + 0.001, 40));
  g.add(merged(`fan|${mm(R)}`, () => [gCyl(R * 0.2, 0.01, 0, 0, 0, 'z', 16), ...[0, 1, 2].map((i) => gBox(R * 0.78, R * 0.3, 0.003).translate(R * 0.5, 0, 0).rotateZ(i * 2.094 + 0.4))], K.mat('#3c3f44', { roughness: 0.5 }), fx, fy, zF + 0.005));
  g.add(merged(`grd|${mm(R)}|${mm(pr)}`, () => [...[0.3, 0.48, 0.66, 0.84, 1].map((f) => new THREE.TorusGeometry(R * f, 0.003, 4, 40)), ...[0, 1, 2, 3].map((i) => gBox(2 * R, 0.005, 0.004).rotateZ(i * Math.PI / 4)), new THREE.TorusGeometry(R + 0.012, 0.008, 6, 40)], body, fx, fy, zF + pr - 0.004));
  const px0 = cxb + bw * 0.5 - bw * 0.2;
  g.add(K.box(0.002, H - 0.04, 0.002, dark, px0 - bw * 0.06, ft + H / 2, zF), at(slats(clamp(Math.round((H * 0.5) / 0.03), 3, 14), bw * 0.16, 0.006, 0.003, 0.03, dark, 'y', 'x'), px0 + bw * 0.06, ft + H * 0.62, zF + 0.001));
  g.add(K.rbox(sv + 0.01, Math.min(0.2, H * 0.4), Math.min(0.14, d * 0.5), body, w / 2 - (sv + 0.01) / 2, ft + Math.min(0.2, H * 0.4) / 2 + 0.03, 0, 0.008, 2));
  g.add(at(slats(clamp(Math.round((H - 0.08) / 0.02), 3, 40), d * 0.8, 0.008, 0.003, (H - 0.08) / clamp(Math.round((H - 0.08) / 0.02), 3, 40), K.mat('#8f9296', { roughness: 0.6, metalness: 0.4 }), 'y', 'z'), cxb - bw / 2 - 0.001, ft + H / 2, -d * 0.02));
  g.add(K.box(bw + 0.004, 0.012, zF + d / 2 + 0.004, body, cxb, h - 0.006, (zF - d / 2) / 2));
  return g;
}
function drawACOutdoor(ctx, { w, d, p, px }) {
  rr2(ctx, 0, 0, w, d, 1.5, K.tint(hex(p.color, '#e6e5df'), 0.4), INK, px);
  if (Math.min(w, d) / px < 10) return;
  const r = Math.min(d * 0.38, w * 0.26), fx = -w * 0.15;
  circ2(ctx, fx, 0, r, PAPER, INK, px);
  K.line(ctx, fx - r, 0, fx + r, 0, SOFT, px * 0.75); K.line(ctx, fx, -r, fx, r, SOFT, px * 0.75); circ2(ctx, fx, 0, r * 0.22, '#5b5e64', null);
  K.line(ctx, w * 0.22, -d / 2, w * 0.22, d / 2, SOFT, px);
  K.line(ctx, -w / 2 + 2, d / 2 - 1.6, w * 0.2, d / 2 - 1.6, INK, px * 1.4);
}
reg('ac-outdoor', buildACOutdoor, drawACOutdoor);

// ═════════════════════════ TV & AUDIO ═════════════════════════
const TVS = ['tv', 'frame', 'monitor', 'projector-screen', 'soundbar', 'speaker'];
const screenMat = () => K.mat('#07080a', { roughness: 0.14, metalness: 0.35 });
function buildTV({ w, d, h, p }) {
  const g = new THREE.Group(), v = pick(p.variant, TVS, 'tv'), stand = flag(p.stand), bz = K.mat(hex(p.color, '#141518'), { roughness: 0.4, metalness: 0.3 });
  if (v === 'tv' || v === 'frame' || v === 'monitor') {
    const onFeet = v === 'monitor' || stand, frameTV = v === 'frame';
    const fh = !onFeet ? 0 : v === 'monitor' ? Math.min(h * 0.28, Math.max(0.06, h - w * 0.6)) : clamp(h * 0.07, 0.02, 0.08);
    const ph = h - fh, t = onFeet ? Math.min(d, v === 'monitor' ? 0.035 : 0.045) : frameTV ? d : Math.min(d, 0.028), zc = onFeet ? 0 : d / 2 - t / 2;
    const bezel = frameTV ? Math.min(0.022, w * 0.03) : Math.min(0.006, w * 0.01), fm = frameTV ? (isWoody(hex(p.color, '#c8a476')) ? K.wood(hex(p.color, '#c8a476')) : K.mat(hex(p.color, '#c8a476'), { roughness: 0.5 })) : bz;
    g.add(K.rbox(w, ph, t, fm, 0, fh + ph / 2, zc, 0.004, 2));
    if (!onFeet && !frameTV && d - t > 0.004) g.add(K.rbox(w * 0.82, ph * 0.62, d - t, darkPlastic(), 0, fh + ph * 0.4, -d / 2 + (d - t) / 2, 0.004, 2));
    const sw = w - 2 * bezel, sh = ph - 2 * bezel, sy = fh + ph / 2, zs = zc + t / 2 + 0.0006;
    if (frameTV) {
      const rnd = K.rng(K.hashStr(String(p.color || '') + mm(w))), pal = ['#c7b299', '#8fa39a', '#d98c5f', '#3f5b6b', '#e3d5bd', '#a8553f'];
      g.add(K.box(sw, sh, 0.001, K.mat('#f1ece2', { roughness: 0.9 }), 0, sy, zs));
      const aw = sw * 0.7, ah = sh * 0.7;
      g.add(K.box(aw, ah, 0.001, K.mat('#e6ddcc', { roughness: 0.9 }), 0, sy, zs + 0.0006));
      for (let i = 0; i < 4; i++) { const bw = aw * (0.2 + rnd() * 0.3), bh = ah * (0.2 + rnd() * 0.4); g.add(K.box(bw, bh, 0.0006, K.mat(pal[Math.floor(rnd() * pal.length)], { roughness: 0.95 }), (rnd() - 0.5) * (aw - bw), sy + (rnd() - 0.5) * (ah - bh), zs + 0.001 + i * 0.0004)); }
    } else {
      g.add(K.box(sw, sh, 0.001, screenMat(), 0, sy, zs));
      g.add(noShadow(K.box(0.012, 0.002, 0.001, lcd('#ffffff'), 0, fh + bezel * 0.5, zs)));
    }
    if (v === 'monitor') {
      const bw = Math.min(w * 0.42, 0.3);
      g.add(K.rbox(bw, 0.012, d, bz, 0, 0.006, 0, 0.004, 2), K.box(Math.min(0.07, w * 0.12), fh + ph * 0.3, 0.02, bz, 0, (fh + ph * 0.3) / 2, -t / 2 - 0.012));
    } else if (onFeet) for (const k of [-1, 1]) g.add(merged(`tvf|${mm(d)}|${mm(fh)}`, () => [gBox(0.022, 0.008, d, 0, 0.004, 0), gBox(0.022, fh, 0.03, 0, fh / 2, 0)], bz, k * w * 0.36, 0, 0));
  } else if (v === 'projector-screen') {
    const ch = Math.min(0.09, h * 0.12), bh = Math.min(0.03, h * 0.04), white = K.mat('#f7f7f4', { roughness: 0.95 });
    g.add(K.rbox(w, ch, d, K.mat(hex(p.color, '#ecece9'), { roughness: 0.4 }), 0, h - ch / 2, 0, Math.min(0.012, d * 0.3), 2));
    g.add(K.box(w - 0.04, h - ch - bh, 0.003, K.mat('#141518', { roughness: 0.9 }), 0, bh + (h - ch - bh) / 2, -d * 0.1), K.box(w - 0.12, h - ch - bh - 0.07, 0.001, white, 0, bh + (h - ch - bh) / 2, -d * 0.1 + 0.002));
    g.add(cylX(Math.min(bh / 2, d / 2), w - 0.03, darkPlastic(), 0, bh / 2, -d * 0.1, 10));
  } else if (v === 'soundbar') {
    g.add(K.rbox(w, h, d, bz, 0, h / 2, 0, Math.min(0.02, h * 0.3, d * 0.3)));
    g.add(K.rbox(w - Math.min(0.08, w * 0.1), h * 0.8, 0.004, K.fabric('#2c2d31'), 0, h / 2, d / 2 - 0.0015, 0.002, 2));
    g.add(noShadow(K.box(0.02, 0.003, 0.001, lcd('#ffffff'), w / 2 - Math.min(0.08, w * 0.1), h / 2, d / 2 + 0.0008)));
  } else {
    const c = hex(p.color, '#1e1f22'), cab = isWoody(c) ? K.wood(c) : K.mat(c, { roughness: 0.45 }), floor = h / w > 2.2, wide = h / w < 0.8;
    const ft = floor ? Math.min(0.03, h * 0.03) : 0, cone = K.mat('#2b2c30', { roughness: 0.6 }), capM = K.mat('#55585e', { roughness: 0.3, metalness: 0.5 }), zf = d / 2 - 0.012;
    g.add(K.rbox(w, h - ft, d - 0.012, cab, 0, ft + (h - ft) / 2, -0.006, 0.008, 2));
    if (ft) g.add(K.box(w * 0.9, ft, d * 0.9, darkPlastic(), 0, ft / 2, 0));
    g.add(K.box(w - 0.02, h - ft - 0.02, 0.002, K.mat('#141518', { roughness: 0.7 }), 0, ft + (h - ft) / 2, zf));
    const drv = (x, y, r) => g.add(merged(`drv|${mm(r)}`, () => [new THREE.TorusGeometry(r * 0.92, Math.min(r * 0.08, 0.005), 6, 28), gCyl(r * 0.86, 0.002, 0, 0, -0.001, 'z', 28), gCyl(r * 0.3, 0.004, 0, 0, 0, 'z', 16)], cone, x, y, zf + 0.005), cylZ(r * 0.28, 0.002, capM, x, y, zf + 0.008, 16));
    const H = h - ft;
    if (wide) { const r = Math.min(H * 0.36, w * 0.2); drv(-w * 0.25, ft + H / 2, r); drv(w * 0.25, ft + H / 2, r); }
    else {
      const r = Math.min(w * 0.36, H * 0.2);
      drv(0, ft + H * 0.88 - Math.min(r * 0.5, H * 0.06), r * 0.42);
      const n = floor ? 3 : 1;
      for (let i = 0; i < n; i++) drv(0, ft + H * (floor ? 0.68 - i * (2.2 * r / H + 0.02) : 0.4), r);
    }
  }
  return g;
}
function drawTV(ctx, { w, d, p, px }) {
  const v = pick(p.variant, TVS, 'tv'), stand = flag(p.stand) || v === 'monitor';
  if (v === 'speaker' || v === 'soundbar') { rr2(ctx, 0, 0, w, d, Math.min(2, d * 0.2), K.tint(hex(p.color, '#3a3c40'), 0.25), INK, px); if (Math.min(w, d) / px > 10) K.line(ctx, -w / 2 + 1.5, d / 2 - 1.5, w / 2 - 1.5, d / 2 - 1.5, 'rgba(255,255,255,0.6)', px); return; }
  if (v === 'projector-screen') { rect2(ctx, -w / 2, -d / 2, w, d, '#ecece9', INK, px); K.line(ctx, -w / 2 + 2, -d * 0.1, w / 2 - 2, -d * 0.1, INK, px); return; }
  const t = Math.max(1.4, stand ? Math.min(d, 4.5) : Math.min(d, 2.8)), zc = stand ? 0 : d / 2 - t / 2;
  if (stand) { if (v === 'monitor') rr2(ctx, 0, 0, Math.min(w * 0.42, 30), d, 1.5, '#d8d9dc', INK, px); else for (const k of [-1, 1]) rect2(ctx, k * w * 0.36 - 1.1, -d / 2, 2.2, d, '#d8d9dc', INK, px); }
  else if (d - t > 0.5) rect2(ctx, -w * 0.41, -d / 2, w * 0.82, d - t, '#8f9296', INK, px);
  rect2(ctx, -w / 2, zc - t / 2, w, t, v === 'frame' ? K.tint(hex(p.color, '#c8a476'), 0.2) : '#2b2d31', INK, px);
}
reg('tv', buildTV, drawTV);
