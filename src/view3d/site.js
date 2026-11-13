/**
 * The lot around the house: ground, outdoor slabs (terrace / porch / utility yard), entry path, parking bays,
 * the property line and a strip of street for context. Everything is derived from PLAN.site / PLAN.outdoorAreas.
 *
 * Levels (m): garden ground G = −floorAboveGround; outdoor slabs −0.02; path / parking pavers G + 0.03.
 * The garden itself is left as neutral dry ground on purpose — the owner designs it with catalogue items.
 */
import * as THREE from 'three';
import { floorMaterial, surfaceMaterial, disposeMaterials } from './textures.js';
import { Soup } from './openings.js';
import { finishParams, prism } from './house.js';

const SLAB_TOP = -0.02;
const KERB_W = 0.1, KERB_H = 0.06;
const SIDEWALK_W = 1.8, STREET_W = 6.5, STREET_RUN = 60;      // context beyond the street-side boundary (m)

/** Smooth value noise in 0..1 (bilinear over a hashed lattice). */
function valueNoise(x, y) {
  const h = (i, j) => { let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return (h(xi, yi) * (1 - sx) + h(xi + 1, yi) * sx) * (1 - sy) + (h(xi, yi + 1) * (1 - sx) + h(xi + 1, yi + 1) * sx) * sy;
}

/** Soft tonal drift of the ground (dry / slightly greener / paler patches) as a vertex colour. */
function groundTint(x, z, out) {
  const a = valueNoise(x / 5.5 + 11, z / 5.5 + 3), b = valueNoise(x / 13 + 40, z / 13 + 71), c = valueNoise(x / 2.3 + 5, z / 2.3 + 9);
  const l = 0.84 + 0.2 * (0.55 * a + 0.3 * b + 0.15 * c), green = (b - 0.5) * 0.09;
  out[0] = l * (1 - green * 0.6); out[1] = l * (1 + green * 0.5); out[2] = l * (1 - green);
  return out;
}

/** Ensure a loop is ordered like house.js outlines (interior to the right of +x travel along the north edge). */
function orient(loop) {
  const area = loop.reduce((s, p, q) => { const b = loop[(q + 1) % loop.length]; return s + p[0] * b[1] - b[0] * p[1]; }, 0);
  return area >= 0 ? loop : loop.slice().reverse();
}

function geometryWithColors(soup, tintFn) {
  const g = soup.toGeometry(), pos = g.getAttribute('position'), col = new Float32Array(pos.count * 3), t = [1, 1, 1];
  for (let i = 0; i < pos.count; i++) { tintFn(pos.getX(i), pos.getZ(i), t); col.set(t, i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * Build the site.
 * @param {{ store, plan, catalog, models }} ctx
 * @returns {{ group: THREE.Group, groundMeshes: THREE.Object3D[], update(): void, dispose(): void }}
 *          groundMeshes are raycast targets with userData.spaceId = 'garden' | outdoor-area id | parking id.
 */
export function buildSite(ctx) {
  const { plan } = ctx;
  const site = plan.site || {};
  const group = new THREE.Group(); group.name = 'site';
  const G = -(plan.heights.floorAboveGround || 15) / 100;
  const groundMeshes = [], geometries = [], textures = [];
  const own = {
    concrete: new THREE.MeshStandardMaterial({ color: '#b3afa6', roughness: 0.95 }),
    paint: new THREE.MeshStandardMaterial({ color: '#f1efe8', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    far: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, vertexColors: true }),
  };
  const add = (geometry, material, name, { cast = false, receive = true, spaceId } = {}) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.castShadow = cast; mesh.receiveShadow = receive;
    geometries.push(geometry); group.add(mesh);
    if (spaceId) { mesh.userData.spaceId = spaceId; groundMeshes.push(mesh); }
    return mesh;
  };
  const uvOf = (pts) => pts.map((p) => [p[0], p[2]]);
  const flat = (soup, pts, y) => { const q = pts.map(([x, z]) => [x, y, z]); soup.quad(q, [0, 1, 0], uvOf(q)); };

  const boundary = Array.isArray(site.boundary) && site.boundary.length >= 3 ? site.boundary : null;
  const bounds = site.bounds || { x: plan.bounds.x - 500, y: plan.bounds.y - 500, w: plan.bounds.w + 1000, h: plan.bounds.h + 1000 };
  const centre = [(bounds.x + bounds.w / 2) / 100, (bounds.y + bounds.h / 2) / 100];

  // ── lot ground: natural dry earth with sparse dry grass ──
  if (boundary) {
    const soup = new Soup();
    if (boundary.length === 4) {                                         // bilinear ~1 m grid so vertex tint can drift
      const [a, b, c, d] = boundary.map(([x, y]) => [x / 100, y / 100]);
      const nu = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]))), nv = Math.max(2, Math.round(Math.hypot(d[0] - a[0], d[1] - a[1])));
      const at = (u, v) => [(a[0] * (1 - u) + b[0] * u) * (1 - v) + (d[0] * (1 - u) + c[0] * u) * v, (a[1] * (1 - u) + b[1] * u) * (1 - v) + (d[1] * (1 - u) + c[1] * u) * v];
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) flat(soup, [at(i / nu, j / nv), at((i + 1) / nu, j / nv), at((i + 1) / nu, (j + 1) / nv), at(i / nu, (j + 1) / nv)], G);
    } else prism(orient(boundary), [], G - 0.1, G, { top: soup });
    add(geometryWithColors(soup, groundTint), surfaceMaterial('earth'), 'site:ground', { spaceId: 'garden' });
  }

  // ── surrounding land, fading into the horizon haze (scene fog) ──
  {
    const g = new THREE.CircleGeometry(420, 72, 0, Math.PI * 2);
    g.rotateX(-Math.PI / 2); g.translate(centre[0], G - 0.04, centre[1]);
    const pos = g.getAttribute('position'), uv = g.getAttribute('uv'), col = new Float32Array(pos.count * 3), t = [1, 1, 1];
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, pos.getX(i), pos.getZ(i));
      groundTint(pos.getX(i), pos.getZ(i), t); col.set([t[0] * 0.95, t[1] * 0.95, t[2] * 0.95], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    own.far.map = surfaceMaterial('earth').map;
    add(g, own.far, 'site:surroundings');
  }

  // ── outdoor slabs at floor level (terrace, entrance porch, utility yard) ──
  const concrete = new Soup();
  const areaMeshes = [];
  for (const area of plan.outdoorAreas || []) {
    if (!Array.isArray(area.polygon) || area.polygon.length < 3) continue;
    const top = new Soup();
    prism(orient(area.polygon), [], G - 0.12, SLAB_TOP, { top, side: concrete });
    areaMeshes.push([area, add(top.toGeometry(), own.concrete, 'site:' + area.id, { spaceId: area.id })]);
  }

  // ── entry path + parking bays (pavers a little above the soil) ──
  const PAVE = G + 0.03;
  for (const path of site.paths || []) {
    if (!Array.isArray(path.polygon) || path.polygon.length < 3) continue;
    const top = new Soup();
    prism(orient(path.polygon), [], G - 0.08, PAVE, { top, side: concrete });
    add(top.toGeometry(), surfaceMaterial('path'), 'site:' + path.id, { spaceId: 'garden' });
  }
  const lines = new Soup(), numbers = new Soup();
  const streetSide = (site.street && site.street.side) || 'e';
  const parking = site.parking || [];
  parking.forEach((bay, index) => {
    const x0 = bay.x / 100, x1 = (bay.x + bay.w) / 100, z0 = bay.y / 100, z1 = (bay.y + bay.h) / 100;
    const top = new Soup();
    prism([[bay.x, bay.y], [bay.x + bay.w, bay.y], [bay.x + bay.w, bay.y + bay.h], [bay.x, bay.y + bay.h]], [], G - 0.08, PAVE, { top, side: concrete });
    add(top.toGeometry(), surfaceMaterial('pavers'), 'site:' + bay.id, { spaceId: bay.id });
    // painted bay: both long sides + the closed end; the end facing the street stays open
    const lw = 0.09, y = PAVE + 0.004, alongX = bay.w >= bay.h;
    if (alongX) {
      flat(lines, [[x0, z0], [x1, z0], [x1, z0 + lw], [x0, z0 + lw]], y); flat(lines, [[x0, z1 - lw], [x1, z1 - lw], [x1, z1], [x0, z1]], y);
      const ex = streetSide === 'w' ? x1 - lw : x0; flat(lines, [[ex, z0], [ex + lw, z0], [ex + lw, z1], [ex, z1]], y);
    } else {
      flat(lines, [[x0, z0], [x0 + lw, z0], [x0 + lw, z1], [x0, z1]], y); flat(lines, [[x1 - lw, z0], [x1, z0], [x1, z1], [x1 - lw, z1]], y);
      const ez = streetSide === 'n' ? z1 - lw : z0; flat(lines, [[x0, ez], [x1, ez], [x1, ez + lw], [x0, ez + lw]], y);
    }
    // bay number, readable for a driver arriving from the street
    const up = { e: [-1, 0], w: [1, 0], n: [0, 1], s: [0, -1] }[streetSide] || [-1, 0], right = [-up[1], up[0]];
    const entry = { e: [x1, (z0 + z1) / 2], w: [x0, (z0 + z1) / 2], n: [(x0 + x1) / 2, z0], s: [(x0 + x1) / 2, z1] }[streetSide] || [x1, (z0 + z1) / 2];
    const c = [entry[0] + up[0] * 1.15, entry[1] + up[1] * 1.15], hw = 0.34, hh = 0.5;
    const corner = (sx, sy) => [c[0] + right[0] * hw * sx + up[0] * hh * sy, y + 0.002, c[1] + right[1] * hw * sx + up[1] * hh * sy];
    const n = Math.min(index, 3), u0 = n / 4, u1 = (n + 1) / 4;
    numbers.quad([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], [0, 1, 0], [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
  });
  if (!lines.empty) add(lines.toGeometry(), own.paint, 'site:bay-lines');
  if (!numbers.empty) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192;
    const g2 = cv.getContext('2d');
    g2.fillStyle = '#f1efe8'; g2.font = '700 170px "Helvetica Neue", Arial, sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
    parking.slice(0, 4).forEach((bay, i) => g2.fillText(String((/(\d+)\s*$/.exec(bay.name || bay.id || '') || [])[1] || i + 1), 64 + i * 128, 104));
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; textures.push(tex);
    own.numbers = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    add(numbers.toGeometry(), own.numbers, 'site:bay-numbers', { receive: true });
  }

  // ── property line (slim kerb, flush where cars / the path cross it) + street context ──
  if (boundary) {
    const pts = boundary.map(([x, y]) => [x / 100, y / 100]);
    const signed = pts.reduce((s, p, q) => { const b = pts[(q + 1) % pts.length]; return s + p[0] * b[1] - b[0] * p[1]; }, 0);
    const crossings = [...parking.map((b) => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]), ...(site.paths || []).map((p) => p.polygon || [])]
      .map((poly) => poly.map(([x, y]) => [x / 100, y / 100]));
    const outward = { e: [1, 0], w: [-1, 0], n: [0, -1], s: [0, 1] }[streetSide] || [1, 0];
    let streetEdge = -1, best = -Infinity;
    pts.forEach((p, q) => { const b = pts[(q + 1) % pts.length], m = ((p[0] + b[0]) / 2) * outward[0] + ((p[1] + b[1]) / 2) * outward[1]; if (m > best) { best = m; streetEdge = q; } });

    const sidewalk = new Soup(), asphalt = new Soup();
    pts.forEach((p, q) => {
      const b = pts[(q + 1) % pts.length], len = Math.hypot(b[0] - p[0], b[1] - p[1]);
      if (len < 0.01) return;
      const u = [(b[0] - p[0]) / len, (b[1] - p[1]) / len];
      const inN = signed >= 0 ? [-u[1], u[0]] : [u[1], -u[0]];           // unit normal pointing into the lot
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(u[0], 0, u[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(u[0], 0, u[1]).cross(new THREE.Vector3(0, 1, 0)));
      m.setPosition(p[0], 0, p[1]);
      const zIn = new THREE.Vector3(inN[0], 0, inN[1]).dot(new THREE.Vector3().setFromMatrixColumn(m, 2)) > 0 ? 1 : -1;   // local z sign of "into the lot"
      // stretches where a driveway / path crosses this edge (street side only)
      const gaps = [];
      if (q === streetEdge) for (const poly of crossings) {
        const ts = poly.filter((v) => Math.abs((v[0] - p[0]) * inN[0] + (v[1] - p[1]) * inN[1]) < 0.3).map((v) => (v[0] - p[0]) * u[0] + (v[1] - p[1]) * u[1]);
        if (ts.length >= 2) gaps.push([Math.max(0, Math.min(...ts)), Math.min(len, Math.max(...ts))]);
      }
      gaps.sort((g0, g1) => g0[0] - g1[0]);
      let cursor = 0;
      const kerb = (t0, t1, h) => { if (t1 - t0 > 0.01) concrete.box(m, t0, t1, G - 0.08, G + h, Math.min(0, zIn * KERB_W), Math.max(0, zIn * KERB_W), 'b'); };
      for (const [g0, g1] of gaps) { kerb(cursor, g0, KERB_H); kerb(Math.max(cursor, g0), g1, 0.036); cursor = Math.max(cursor, g1); }
      kerb(cursor, len, KERB_H);

      if (q !== streetEdge) return;
      const strip = (soup, t0, t1, v0, v1, y) => {
        const P = (t, v) => [p[0] + u[0] * t - inN[0] * v, p[1] + u[1] * t - inN[1] * v];
        flat(soup, [P(t0, v0), P(t1, v0), P(t1, v1), P(t0, v1)], y);
      };
      strip(sidewalk, -STREET_RUN, len + STREET_RUN, 0, SIDEWALK_W, G + 0.02);
      strip(asphalt, -STREET_RUN, len + STREET_RUN, SIDEWALK_W, SIDEWALK_W + STREET_W, G - 0.015);
      concrete.box(m, -STREET_RUN, len + STREET_RUN, G - 0.06, G + 0.035, Math.min(-zIn * SIDEWALK_W, -zIn * (SIDEWALK_W + 0.12)), Math.max(-zIn * SIDEWALK_W, -zIn * (SIDEWALK_W + 0.12)), 'b');
      concrete.box(m, -STREET_RUN, len + STREET_RUN, G - 0.06, G + 0.035, Math.min(-zIn * (SIDEWALK_W + STREET_W), -zIn * (SIDEWALK_W + STREET_W + 0.12)), Math.max(-zIn * (SIDEWALK_W + STREET_W), -zIn * (SIDEWALK_W + STREET_W + 0.12)), 'b');
    });
    if (!sidewalk.empty) add(sidewalk.toGeometry(), surfaceMaterial('sidewalk'), 'site:sidewalk');
    if (!asphalt.empty) add(asphalt.toGeometry(), surfaceMaterial('asphalt'), 'site:street');
  }
  // survey features (e.g. the water connection): a small flush cover so the spot stays recognisable
  for (const f of site.features || []) {
    if (Number.isFinite(f.x) && Number.isFinite(f.y)) concrete.cyl(new THREE.Matrix4(), 'y', f.x / 100, G + 0.01, f.y / 100, 0.17, 0.05, 20);
  }
  if (!concrete.empty) add(concrete.toGeometry(), own.concrete, 'site:concrete', { cast: true });

  function update() {
    for (const [area, mesh] of areaMeshes) mesh.material = floorMaterial(finishParams(ctx, area.id, 'floor'));
  }
  update();

  return {
    group,
    groundMeshes,
    /** Re-read the outdoor floor finishes from the store. */
    update,
    dispose() {
      geometries.forEach((g) => g.dispose());
      textures.forEach((t) => t.dispose());
      Object.values(own).forEach((m) => m.dispose());
      disposeMaterials();
      groundMeshes.length = 0;
      group.clear();
    },
  };
}
