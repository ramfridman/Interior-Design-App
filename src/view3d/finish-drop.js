/**
 * Finish drop target in the 3D view: which room / outdoor area a dragged floor or wall finish would land on, and a
 * translucent highlight of that floor (or of the room's walls) while the finish is dragged over the pane.
 *
 * Granularity follows the store (`store.finishes[spaceId] = { floor, wall }`): a wall finish covers all walls of one
 * room, a floor finish the floor of one room or outdoor area.
 */
import * as THREE from 'three';
import { spaceAt, pointInPolygon } from '../core/geometry.js';
import { groundY } from './items.js';

const LIFT = 0.012;     // m — highlight floats this far above the floor / off the wall face (no z-fighting)

/**
 * @param {{ scene: THREE.Scene, ctx: object, surfaceAt: (x: number, y: number) => object|null,
 *           wallTop: () => number, invalidate: () => void, accent?: string }} opts
 *   surfaceAt(clientX, clientY) → { surface: 'floor', spaceId } | { surface: 'wall', point, normal } | null (items ignored)
 *   wallTop() → metres: how high the highlighted walls are drawn (ceiling, or the cut-away height)
 */
export function createFinishDrop({ scene, ctx, surfaceAt, wallTop, invalidate, accent = '#2f7cf6' }) {
  const { plan } = ctx;
  const group = new THREE.Group();
  group.name = 'finish-drop-highlight';
  group.renderOrder = 5;
  scene.add(group);
  const fill = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
  const line = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
  let key = '';

  const spaces = () => [...(plan.rooms || []), ...(plan.outdoorAreas || [])];
  const spaceById = (id) => spaces().find((s) => s.id === id) || null;

  /**
   * The space a finish dropped at this screen position goes to.
   * A floor hit names its space; a wall hit names the room its face looks into (an outside face names nothing).
   * @returns {{ spaceId: string, surface: 'floor'|'wall' } | null}
   */
  function targetAt(clientX, clientY) {
    const hit = surfaceAt(clientX, clientY);
    if (!hit) return null;
    if (hit.surface === 'floor') return hit.spaceId ? { spaceId: hit.spaceId, surface: 'floor' } : null;
    const n = hit.normal, p = hit.point;
    const len = Math.hypot(n.x, n.z) || 1;
    const s = spaceAt(p.x * 100 + (n.x / len) * 12, p.z * 100 + (n.z / len) * 12, plan);
    return s && s.kind === 'room' ? { spaceId: s.id, surface: 'wall' } : null;
  }

  function clear() {
    for (const o of [...group.children]) { group.remove(o); o.geometry.dispose(); }
  }

  function floorMesh(space) {
    const poly = space.polygon || [];
    if (poly.length < 3) return;
    const y = (!plan.rooms.includes(space)
      ? groundY(space.label ? space.label[0] : poly[0][0], space.label ? space.label[1] : poly[0][1], plan) : 0) + LIFT;
    // shape in the XY plane with y = −plan y, then laid flat (rotation −90° about X maps shape y → world −z → +plan y)
    const shape = new THREE.Shape(poly.map(([x, py]) => new THREE.Vector2(x / 100, -py / 100)));
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), fill);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    const pts = poly.map(([x, py]) => new THREE.Vector3(x / 100, y + 0.002, py / 100));
    group.add(mesh, new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), line));
  }

  function wallMeshes(space) {
    const poly = space.polygon || [];
    const top = Math.max(0.3, wallTop());
    const pos = [];
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1) continue;
      // offset toward the inside of the room (test both sides of the edge midpoint)
      let nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const inA = pointInPolygon(mx + nx * 3, my + ny * 3, poly), inB = pointInPolygon(mx - nx * 3, my - ny * 3, poly);
      if (inA === inB) continue;    // slit of a free-standing wall, or a degenerate edge
      if (!inA) { nx = -nx; ny = -ny; }
      const ox = nx * LIFT, oz = ny * LIFT;
      const a = [x0 / 100 + ox, y0 / 100 + oz], b = [x1 / 100 + ox, y1 / 100 + oz];
      pos.push(a[0], 0, a[1], b[0], 0, b[1], b[0], top, b[1], a[0], 0, a[1], b[0], top, b[1], a[0], top, a[1]);
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    group.add(new THREE.Mesh(geo, fill));
    const pts = poly.map(([x, py]) => new THREE.Vector3(x / 100, top, py / 100));
    group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), line));
  }

  /**
   * Show (or clear with null) the highlight: the floor of a space, or the walls of a room.
   * @param {{ spaceId: string, kind: 'floor'|'wall' } | null} target
   */
  function highlight(target) {
    const space = target && spaceById(target.spaceId);
    const k = space ? `${target.kind}:${space.id}:${wallTop()}` : '';
    if (k === key) return;
    key = k;
    clear();
    if (space) (target.kind === 'wall' ? wallMeshes : floorMesh)(space);
    invalidate();
  }

  return {
    targetAt,
    highlight,
    /** The plan was edited: polygons changed, redraw on the next highlight. */
    refreshPlan() { key = ''; clear(); },
    dispose() { clear(); scene.remove(group); fill.dispose(); line.dispose(); },
  };
}
