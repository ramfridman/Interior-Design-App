// DXF fixtures for the import tests: the built-in house (src/core/plan.js) drawn as an architect would in AutoCAD.
import { PLAN } from '../src/core/plan.js';
import { dxfWriter, outlineLoops } from './dxf-writer.mjs';

// ---------- the built-in house as a DXF ----------
const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
/**
 * @param o { unit: cm per drawing unit (1 = cm, 0.1 = mm), insunits, names: { wall, door, window, dim }, version, codepage }
 * Plan (x, y-down cm) → DXF (x / unit, −y / unit), offset so the drawing is not at the origin.
 */
export function houseDxf(o = {}) {
  const u = o.unit || 1, names = { wall: 'A-WALL', door: 'A-DOOR', window: 'A-GLAZ', dim: 'A-ANNO-DIMS', furn: 'I-FURN', ...(o.names || {}) };
  const OX = 12000, OY = 30000;
  const X = (x) => (OX + x) / u, Y = (y) => (OY - y) / u;
  const w = dxfWriter({ version: o.version || 'AC1032', insunits: o.insunits ?? 5, codepage: o.codepage || 'ANSI_1252' });
  w.layer('0', 7).layer(names.wall, 7, { lw: 50 }).layer(names.door, 3).layer(names.window, 4).layer(names.dim, 1).layer(names.furn, 8).layer('Defpoints', 7);
  // walls: closed polylines around the union of the wall rectangles (outer outline + every inner loop)
  for (const loop of outlineLoops(PLAN.walls, 5)) w.lwpoly(loop.map(([x, y]) => [X(x), Y(y)]), { layer: names.wall, closed: true });
  // door block: hinge at the origin, closed leaf along +x to (1, 0), open leaf up +y, swing arc 0 → 90°; width 1 unit
  w.block('DOOR-90', [0, 0], (it) => {
    w.line([0, 0], [0, 1], { into: it, layer: '0', color: 0, ltype: 'BYBLOCK' });
    w.arc([0, 0], 1, 0, 90, { into: it, layer: '0', color: 0, ltype: 'BYBLOCK' });
  });
  // window block: unit length along +x, unit thickness along +y; two glass lines and the jambs
  w.block('WIN-2L', [0, 0], (it) => {
    w.line([0, 0.4], [1, 0.4], { into: it, layer: '0' }); w.line([0, 0.6], [1, 0.6], { into: it, layer: '0' });
    w.line([0, 0], [0, 1], { into: it, layer: '0' }); w.line([1, 0], [1, 1], { into: it, layer: '0' });
  });
  let mirrorStyle = 0;
  const door = (H, along, open, width, ins = {}) => {
    // block x → `along` (plan), block y → `open` (plan); DXF flips y
    const ux = along[0], uy = -along[1], vx = open[0], vy = -open[1];
    const det = ux * vy - uy * vx, s = width / u;
    const p = [X(H[0]), Y(H[1])];
    if (det > 0) w.insert('DOOR-90', p, { layer: names.door, sx: s, sy: s, rot: Math.atan2(uy, ux) * 180 / Math.PI, ...ins });
    else if (mirrorStyle++ % 2 === 0) w.insert('DOOR-90', p, { layer: names.door, sx: -s, sy: s, rot: Math.atan2(-uy, -ux) * 180 / Math.PI, ...ins });
    else w.insert('DOOR-90', [-p[0], p[1]], { layer: names.door, sx: s, sy: s, rot: Math.atan2(uy, -ux) * 180 / Math.PI, mirrored: true, ...ins }); // OCS (0, 0, −1)
  };
  for (const op of PLAN.openings) {
    if (op.kind === 'door') {
      const hv = op.axis === 'h';
      const hingeAt = (hinge, swing) => {
        const jamb = hv ? (hinge === 'w' ? op.x : op.x + op.w) : (hinge === 'n' ? op.y : op.y + op.h);
        const face = hv ? (swing === 'n' ? op.y : op.y + op.h) : (swing === 'w' ? op.x : op.x + op.w);
        const H = hv ? [jamb, face] : [face, jamb];
        const along = hv ? (hinge === 'w' ? DIRS.e : DIRS.w) : (hinge === 'n' ? DIRS.s : DIRS.n);
        return { H, along, open: DIRS[swing] };
      };
      const a = hingeAt(op.hinge, op.swing);
      door(a.H, a.along, a.open, op.width);
      if (op.innerDoor) { const b = hingeAt(op.innerDoor.hinge, op.innerDoor.swing); door(b.H, b.along, b.open, op.innerDoor.width, { ltype: 'DASHED' }); }
    } else {
      // windows and the sliding door: the window block scaled to the gap (negative y scale: mirrored inserts)
      if (op.axis === 'h') w.insert('WIN-2L', [X(op.x), Y(op.y)], { layer: names.window, sx: op.w / u, sy: -op.h / u });
      else w.insert('WIN-2L', [X(op.x), Y(op.y)], { layer: names.window, sx: op.h / u, sy: op.w / u, rot: -90 });
    }
  }
  // dimensions: overall size and a few room widths (definition points on the walls)
  const b = { w: Math.max(...PLAN.walls.map((r) => r.x + r.w)), h: Math.max(...PLAN.walls.map((r) => r.y + r.h)) };
  w.dim([X(0), Y(0)], [X(b.w), Y(0)], [X(0), Y(-150)], { layer: names.dim, angle: 0 });
  w.dim([X(0), Y(0)], [X(0), Y(b.h)], [X(-150), Y(0)], { layer: names.dim, angle: 90 });
  w.dim([X(340), Y(0)], [X(1300), Y(0)], [X(340), Y(-90)], { layer: names.dim, angle: 0 });
  w.dim([X(0), Y(800)], [X(0), Y(1380)], [X(-90), Y(800)], { layer: names.dim, angle: 90 });
  // furniture (closed rectangles in rooms: must not become walls) and a title
  w.lwpoly([[X(600), Y(300)], [X(800), Y(300)], [X(800), Y(390)], [X(600), Y(390)]], { layer: names.furn, closed: true });
  w.circle([X(700), Y(345)], 30 / u, { layer: names.furn });
  w.text([X(0), Y(-300)], 30 / u, o.title || 'GROUND FLOOR PLAN', { layer: names.dim });
  w.mtext([X(200), Y(200)], 15 / u, o.room || '{\\fArial|b1;LIVING}\\PROOM', { layer: names.dim });
  return w;
}

