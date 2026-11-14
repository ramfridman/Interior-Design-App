/**
 * Stairs in 3D (stage F4a of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md) — one merged mesh per stair, built from the pure
 * geometry of src/core/stairs.js (cm → m: X = x/100, Y = h/100, Z = y/100, Y relative to the stair's bottom level; the
 * caller places the mesh at that level's elevation).
 *
 * A closed-riser concrete stair: a sloping waist under each flight, a solid step on it per tread (its front face is the
 * painted riser), timber treads 4 cm thick with a 3 cm nosing (`stair.nosing`), landings as 20 cm slabs with a timber
 * top. Sides (core/stairs.js stairSides): within 5 cm of a wall of the lower level → a wall-mounted handrail on
 * brackets; open → a guard like the F3 void railing (posts ≤ 1.20 m apart, top rail, mid rail, bottom rail) following
 * the pitch line, 0.90 m above it. The arrival riser is drawn only where the upper slab does not already cover it.
 * Geometry groups / materials: 0 = treads (timber), 1 = body (painted), 2 = rails (metal).
 */
import * as THREE from 'three';
import { Soup } from './openings.js';
import { floorMaterial } from './textures.js';
import { floorHeightAt } from '../core/stairs.js';

const TREAD_T = 4, WAIST = 18, LANDING_T = 20;          // cm: tread thickness, vertical waist depth, landing slab
const GUARD_H = 90, MID_H = 45, LOW_H = 10, POST = 4, BAY = 120, GUARD_INSET = 3;   // cm, as the F3 railing (0.90 m along a stair)
const WALL_RAIL_IN = 6, WALL_RAIL = 4, TRIM = 3;                  // cm: wall handrail axis from the side, its section

const W3 = (p, h) => [p[0] / 100, h / 100, p[1] / 100];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];

/** Materials of the stairs (timber is a shared cached finish material; the others are owned and disposed here). */
export function stairMaterials() {
  return {
    treads: floorMaterial({ pattern: 'plank', color: '#a8784a', color2: '#94663c', tileW: 120, tileH: 20, gloss: 0.3 }),
    body: new THREE.MeshStandardMaterial({ color: '#f3f1ec', roughness: 0.9 }),
    rail: new THREE.MeshStandardMaterial({ color: '#3b3d41', roughness: 0.45, metalness: 0.55 }),
    dispose() { this.body.dispose(); this.rail.dispose(); },
  };
}

/** Fan of a convex polygon (world points) with one normal. */
function fan(soup, pts, n, uvs) {
  if (pts.length === 4) { soup.quad(pts, n, uvs); return; }
  for (let i = 1; i + 1 < pts.length; i++) soup.tri(pts[0], pts[i], pts[i + 1], n, uvs ? [uvs[0], uvs[i], uvs[i + 1]] : null);
}

/** Vertical prism of a convex plan ring (cm) between h0 and h1 (cm). `faces`: 'tbs' = top / bottom / sides. */
function prism(soup, ring, h0, h1, faces = 'tbs') {
  if (!(h1 > h0) || ring.length < 3) return;
  const c = ring.reduce((s, p) => add(s, mul(p, 1 / ring.length)), [0, 0]);
  if (faces.includes('t')) fan(soup, ring.map((p) => W3(p, h1)), [0, 1, 0], ring.map((p) => [p[0] / 100, p[1] / 100]));
  if (faces.includes('b')) fan(soup, ring.map((p) => W3(p, h0)), [0, -1, 0], ring.map((p) => [p[0] / 100, p[1] / 100]));
  if (!faces.includes('s')) return;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) return;
    let n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
    const m = [(a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]];
    if (n[0] * m[0] + n[1] * m[1] < 0) n = [-n[0], -n[1]];
    const u = L / 100, v = (h1 - h0) / 100;
    soup.quad([W3(a, h0), W3(b, h0), W3(b, h1), W3(a, h1)], [n[0], 0, n[1]], [[0, 0], [u, 0], [u, v], [0, v]]);
  });
}

/** A convex profile in a flight's (s, h) plane (cm), extruded across t ∈ [t0, t1] (cm, along `right`). */
function extrude(soup, f, profile, t0, t1) {
  const P = (s, t, h) => W3(add(add(f.origin, mul(f.dir, s)), mul(f.right, t)), h);
  const cs = profile.reduce((s, p) => s + p[0], 0) / profile.length, ch = profile.reduce((s, p) => s + p[1], 0) / profile.length;
  fan(soup, profile.map(([s, h]) => P(s, t0, h)), [-f.right[0], 0, -f.right[1]], profile.map(([s, h]) => [s / 100, h / 100]));
  fan(soup, profile.map(([s, h]) => P(s, t1, h)), [f.right[0], 0, f.right[1]], profile.map(([s, h]) => [s / 100, h / 100]));
  profile.forEach((a, i) => {
    const b = profile[(i + 1) % profile.length], ds = b[0] - a[0], dh = b[1] - a[1], L = Math.hypot(ds, dh);
    if (L < 1e-6) return;
    let ns = dh / L, nh = -ds / L;
    if (ns * ((a[0] + b[0]) / 2 - cs) + nh * ((a[1] + b[1]) / 2 - ch) < 0) { ns = -ns; nh = -nh; }
    const w = (t1 - t0) / 100;
    soup.quad([P(a[0], t0, a[1]), P(b[0], t0, b[1]), P(b[0], t1, b[1]), P(a[0], t1, a[1])], [f.dir[0] * ns, nh, f.dir[1] * ns], [[0, 0], [w, 0], [w, L / 100], [0, L / 100]]);
  });
}

/** Plan quad of a flight between s0..s1 and t0..t1 (cm). */
const quadOf = (f, s0, s1, t0, t1) => [[s0, t0], [s1, t0], [s1, t1], [s0, t1]].map(([s, t]) => add(add(f.origin, mul(f.dir, s)), mul(f.right, t)));

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
/** A straight bar (box section w × h, metres) from A to B (world metres); `side` = a horizontal vector across it. */
function bar(soup, A, B, side, w, h) {
  _x.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
  const L = _x.length();
  if (L < 1e-6) return;
  _x.divideScalar(L);
  _z.set(side[0], 0, side[1]).addScaledVector(_x, -(_x.x * side[0] + _x.z * side[1])).normalize();
  _y.crossVectors(_z, _x);
  if (_y.y < 0) { _z.negate(); _y.crossVectors(_z, _x); }
  _m.makeBasis(_x, _y, _z).setPosition(A[0], A[1], A[2]);
  soup.box(_m, 0, L, -h / 2, h / 2, -w / 2, w / 2);
}

/** Merge soups into one geometry with one group per soup (material index = position). */
function mergeGrouped(soups) {
  const pos = [], nor = [], uv = [], idx = [], groups = [];
  for (const s of soups) {
    const base = pos.length / 3, start = idx.length;
    pos.push(...s.pos); nor.push(...s.nor); uv.push(...s.uv);
    for (const i of s.idx) idx.push(i + base);
    groups.push([start, s.idx.length]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  groups.forEach(([start, count], i) => { if (count) g.addGroup(start, count, i); });
  g.computeBoundingSphere();
  return { geometry: g, groups };
}

/**
 * The soups (treads, body, rails) of one stair, in metres relative to its bottom level.
 * @param {object} stair  the stair data
 * @param {object} geo    stairGeometry(stair, { rise })
 * @param {{ sides?: object[], underside?: number, slabEdge?: (out: [x, y], inside: [x, y]) => boolean }} opts
 *        sides = stairSides(...); underside = the upper slab's underside above the lower floor (cm) — the arrival riser is
 *        drawn only below it; slabEdge (stage F4b): true where the floor above runs beside the stair (`out`, 5 cm outside
 *        a side) with the void's guard rail along its edge (`inside`, 5 cm inside it is in a railed void). An open side's
 *        guard stops where its top meets the slab there: from that point on the slab edge and the void railing on it are
 *        the guard — one continuous railing instead of two running side by side at the top of the stair.
 */
export function stairSoups(stair, geo, { sides = [], underside = Infinity, slabEdge = null } = {}) {
  const treads = new Soup(), body = new Soup(), rail = new Soup();
  const R = geo.riser, G = geo.going, W = geo.width, nosing = Number.isFinite(stair.nosing) ? Math.max(0, stair.nosing) : 3;
  geo.flights.forEach((f, fi) => {
    const len = f.length, h0 = f.h0, h1 = f.h1;
    if (len > 1e-6) {
      // waist: parallelogram under the inner corners of the steps, clipped at the lower floor
      const prof = [[0, h0], [len, h1 - R]];
      const hb = (s) => h0 + (s * R) / G - WAIST;
      if (hb(len) > 0) {
        prof.push([len, hb(len)]);
        if (hb(0) >= 0) prof.push([0, hb(0)]);
        else { prof.push([((WAIST - h0) * G) / R, 0]); if (h0 > 0) prof.push([0, 0]); }
      } else { prof.push([len, 0]); if (h0 > 0) prof.push([0, 0]); }
      extrude(body, f, prof, -W / 2, W / 2);
    }
    for (let i = 1; i < f.risers; i++) {
      const a = (i - 1) * G, hbI = h0 + (i - 1) * R, ht = h0 + i * R - TREAD_T;
      if (ht > hbI + 1e-6) extrude(body, f, [[a, hbI], [a, ht], [a + ((R - TREAD_T) * G) / R, ht]], -W / 2, W / 2);   // step (front = riser)
      prism(treads, quadOf(f, a - nosing, a + G, -W / 2, W / 2), ht, ht + TREAD_T);                                  // timber tread
    }
    if (fi === geo.flights.length - 1) {
      if (h1 - R < underside - 0.5) prism(body, quadOf(f, len - 0.2, len + 1.8, -W / 2, W / 2), h1 - R, Math.min(h1, underside));   // arrival riser, below the slab
      if (nosing > 0) prism(treads, quadOf(f, len - nosing, len, -W / 2, W / 2), h1 - TREAD_T, h1);                                 // nosing strip flush with the upper floor
    }
  });
  for (const l of geo.landings) {
    prism(body, l.poly, l.h - LANDING_T, l.h - TREAD_T);
    prism(treads, l.poly, l.h - TREAD_T, l.h);
  }
  // handrails and guards
  for (const side of sides) {
    const sd = side.wall || !slabEdge ? side : guardUntilSlab(side, slabEdge, underside);
    if (!sd) continue;
    const L = Math.hypot(sd.b[0] - sd.a[0], sd.b[1] - sd.a[1]);
    if (L < 1) continue;
    const u = [(sd.b[0] - sd.a[0]) / L, (sd.b[1] - sd.a[1]) / L], inward = mul(sd.outward, -1);
    const pitch = (x) => sd.ha + ((sd.hb - sd.ha) * x) / L;
    if (sd.wall) {
      const off = mul(inward, WALL_RAIL_IN), A = add(add(sd.a, off), mul(u, TRIM)), B = add(add(sd.a, off), mul(u, L - TRIM));
      bar(rail, W3(A, pitch(TRIM) + GUARD_H), W3(B, pitch(L - TRIM) + GUARD_H), inward, WALL_RAIL / 100, WALL_RAIL / 100);
      const n = Math.max(1, Math.ceil(L / BAY));
      for (let q = 0; q <= n; q++) {                                                     // brackets back to the wall
        const x = Math.min(L - 10, Math.max(10, (L * q) / n)), p = add(sd.a, mul(u, x)), h = pitch(x) + GUARD_H - WALL_RAIL / 2 - 1.5;
        bar(rail, W3(add(p, mul(inward, WALL_RAIL_IN)), h), W3(add(p, mul(inward, -0.5)), h), u, 0.015, 0.015);
      }
      continue;
    }
    const off = mul(inward, GUARD_INSET), A = add(sd.a, off), B = add(sd.b, off);
    const A1 = add(A, mul(u, TRIM)), B1 = add(A, mul(u, L - TRIM));        // rails stop short of the ends (sloped box ends lean out)
    for (const [hh, w, t] of [[GUARD_H - 2, 5, 4], [MID_H, 2.4, 2.5], [LOW_H, 2.4, 2.5]]) bar(rail, W3(A1, pitch(TRIM) + hh), W3(B1, pitch(L - TRIM) + hh), inward, w / 100, t / 100);
    const n = Math.max(1, Math.ceil(L / BAY));
    const m = new THREE.Matrix4();
    for (let q = 0; q <= n; q++) {
      const x = Math.min(L - POST / 2, Math.max(POST / 2, (L * q) / n)), p = add(A, mul(u, x));
      const probe = add(p, mul(inward, 1)), floor = floorHeightAt(stair, geo, probe[0], probe[1], { stepped: true });
      const y0 = (floor == null ? pitch(x) - R : floor) / 100, y1 = (pitch(x) + GUARD_H - 4) / 100;
      m.makeTranslation(p[0] / 100, 0, p[1] / 100);
      rail.box(m, -POST / 200, POST / 200, y0, y1, -POST / 200, POST / 200);
    }
  }
  return { treads, body, rail };
}

/**
 * An open side cut where the guard meets the floor above: the part of the side (from its low end) up to the first point
 * where the guard top reaches the slab underside AND the floor above runs beside it with its void railing. null when
 * nothing of the side is left; the side itself when the slab never takes over.
 */
function guardUntilSlab(sd, slabEdge, underside) {
  const L = Math.hypot(sd.b[0] - sd.a[0], sd.b[1] - sd.a[1]);
  if (!(L > 1) || !Number.isFinite(underside)) return sd;
  const rising = sd.hb >= sd.ha, u = [(sd.b[0] - sd.a[0]) / L, (sd.b[1] - sd.a[1]) / L];
  const at = (x) => add(sd.a, mul(u, x)), pitch = (x) => sd.ha + ((sd.hb - sd.ha) * x) / L;
  const covered = (x) => pitch(x) + GUARD_H >= underside - 0.5 && slabEdge(add(at(x), mul(sd.outward, 5)), add(at(x), mul(sd.outward, -5)));
  const n = Math.max(2, Math.ceil(L / 2));
  for (let i = 0; i <= n; i++) {
    const t = rising ? (L * i) / n : L - (L * i) / n;                     // from the low end up
    if (!covered(t)) continue;
    if (rising) return t < 5 ? null : { ...sd, b: at(t), hb: pitch(t) };
    return L - t < 5 ? null : { ...sd, a: at(t), ha: pitch(t) };
  }
  return sd;
}

/**
 * One merged mesh for a stair (groups: treads, body, rails), in metres relative to its bottom level.
 * @returns {THREE.Mesh} name 'stair:<id>', userData { stairId, levelId, parts: { treads, body, rail }: [start, count] }
 */
export function buildStairMesh(stair, geo, materials, opts = {}) {
  const s = stairSoups(stair, geo, opts);
  const { geometry, groups } = mergeGrouped([s.treads, s.body, s.rail]);
  const mesh = new THREE.Mesh(geometry, [materials.treads, materials.body, materials.rail]);
  mesh.name = 'stair:' + stair.id;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData = { stairId: stair.id, levelId: opts.levelId || null, parts: { treads: groups[0], body: groups[1], rail: groups[2] } };
  return mesh;
}
