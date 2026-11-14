// Shared test houses from docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md § 4 ("Test houses"). DATA ONLY — no engine is
// called here; each stage's tests derive what they need. Plan JSON shapes follow § 2 of the design (schema 2):
// rect walls { id, x, y, w, h, kind }, slants { id, x1, y1, x2, y2, t, kind }, rect openings as in src/core/plan.js,
// slant openings { id, kind, style, width, height, sill, wall, axis: 'a', at, hinge?, swing? }.
// Units: cm, origin top-left, +x east, +y south (as in src/core/plan.js).

const W = (id, x, y, w, h, kind) => ({ id, x, y, w, h, kind });
const S01_LEN = Math.hypot(590 - 990, 790 - 10);    // 876.58 cm
const S02_LEN = Math.hypot(300 - 25, 25 - 300);     // 388.91 cm

/**
 * "Wedge" — one level, non-orthogonal. s01 runs at ~117.2° (deliberately not a 15° step), s02 at 45°.
 * Expected (§ 4): 3 rooms — the NW triangle (behind s02), the west room, and the east trapezoid with inner vertices
 * ≈ (510, 20), (973.6, 20), (583.9, 780), (510, 780), ≈ 20.43 m²; s01 exterior and locked, s02 a partition; both slant
 * openings get the right rooms; the window's outdoor side is computed ('l' for s01's direction); union of solids is
 * one outer ring.
 */
export const WEDGE = {
  name: 'Wedge',
  schema: 2,
  heights: { ceiling: 300, slab: 20, parapet: 40, floorAboveGround: 15, doorDefault: 210 },
  walls: [
    W('w01', 0, 0, 1000, 20, 'exterior'),     // north
    W('w02', 0, 20, 20, 760, 'exterior'),     // west
    W('w03', 0, 780, 600, 20, 'exterior'),    // south
    W('w04', 500, 20, 10, 760, 'interior'),   // partition
  ],
  slants: [
    { id: 's01', x1: 990, y1: 10, x2: 590, y2: 790, t: 20, kind: 'exterior' },
    { id: 's02', x1: 25, y1: 300, x2: 300, y2: 25, t: 10, kind: 'interior' },
  ],
  openings: [
    { id: 'win-s01', kind: 'window', style: 'sliding', wall: 's01', axis: 'a', at: S01_LEN / 2, width: 120, height: 120, sill: 90 },
    { id: 'door-s02', kind: 'door', style: 'interior', wall: 's02', axis: 'a', at: S02_LEN / 2, width: 80, height: 210, sill: 0, hinge: 'a', swing: 'r' },
    { id: 'door-part', kind: 'door', style: 'interior', axis: 'v', x: 500, y: 350, w: 10, h: 80, width: 80, height: 210, sill: 0, hinge: 'n', swing: 'e' },
    { id: 'door-entry', kind: 'door', style: 'entry', axis: 'h', x: 200, y: 780, w: 90, h: 20, width: 90, height: 210, sill: 0, hinge: 'w', swing: 'n' },
  ],
  expect: {
    rooms: 3,
    eastRoomArea: 20.43,                       // m², rounded as written in the design
    windowOutside: 'l',                        // outdoors is on the left of s01's direction (990,10) → (590,790)
    doorS02Sides: { l: 'nw-triangle', r: 'west-room' },
    slantClass: { s01: 'exterior', s02: 'partition' },
  },
};

/**
 * "Duplex" — two storeys (§ 4). L0 in the top-level fields, L1 in `levels`. Stair st1 starts on L0.
 * Stair pose follows items ({ x, y, rot } = centre and rotation, `w` across, `d` along the flight); `footprint` is the
 * same rectangle written out (x 520–620, y 266–759) and `up: 'n'` the walking direction, both for convenience.
 * The L1 east window's height and sill are not given by the design (marked `assumed`).
 */
const EXT = () => [W('w01', 0, 0, 1000, 20, 'exterior'), W('w02', 0, 780, 1000, 20, 'exterior'), W('w03', 0, 20, 20, 760, 'exterior'), W('w04', 980, 20, 20, 760, 'exterior')];
export const DUPLEX = {
  name: 'Duplex',
  schema: 2,
  meta: { floors: 2 },
  heights: { ceiling: 280, slab: 20, parapet: 40, floorAboveGround: 15, doorDefault: 210 },
  walls: [...EXT(), W('w05', 500, 20, 10, 760, 'interior')],
  openings: [
    { id: 'door-part-0', kind: 'door', style: 'interior', axis: 'v', x: 500, y: 300, w: 10, h: 90, width: 90, height: 210, sill: 0, hinge: 'n', swing: 'e' },
    { id: 'door-entry', kind: 'door', style: 'entry', axis: 'h', x: 200, y: 780, w: 100, h: 20, width: 100, height: 210, sill: 0, hinge: 'w', swing: 'n' },
    { id: 'win-north', kind: 'window', style: 'sliding', axis: 'h', x: 650, y: 0, w: 150, h: 20, width: 150, height: 120, sill: 90 },
  ],
  stairs: [
    { id: 'st1', to: 'L1', shape: 'straight', x: 570, y: 512.5, rot: 0, w: 100, d: 493, width: 100, risers: 18, riser: 300 / 18, going: 29, up: 'n',
      footprint: { x: 520, y: 266, w: 100, h: 493 } },
  ],
  levels: [
    {
      id: 'L1', name: 'First floor', nameHe: 'קומה א׳',
      elevation: 300,
      heights: { ceiling: 280, slab: 20, parapet: 40 },
      walls: [...EXT(), W('w05', 300, 20, 10, 760, 'interior')],
      openings: [
        { id: 'door-part-1', kind: 'door', style: 'interior', axis: 'v', x: 300, y: 100, w: 10, h: 90, width: 90, height: 210, sill: 0, hinge: 'n', swing: 'e' },
        { id: 'win-east-1', kind: 'window', style: 'sliding', axis: 'v', x: 980, y: 300, w: 20, h: 120, width: 120, height: 120, sill: 90, assumed: ['height', 'sill'] },
      ],
      voids: [{ id: 'v1', polygon: [[520, 266], [620, 266], [620, 670], [520, 670]], stair: 'st1', railing: true }],   // y 670 (F4b): the sourced 2.10 m headroom needs the slab open to y 666.2
      outdoorAreas: [],
    },
  ],
  expect: {
    roomsPerLevel: 2,
    l1EastRoomFloorArea: 670 * 760 - 100 * 404,   // cm² (void v1: 100 × 404)
    twoRPlusT: 62.3,
    shrunkVoidFailsHeadroom: { y0: 266, y1: 560 },
    l1FloorY: 3.0,                                 // m
    walk: { from: [570, 740], fromLevel: 'L0', to: [570, 280], toLevel: 'L1', eye: 4.65 },
  },
};
