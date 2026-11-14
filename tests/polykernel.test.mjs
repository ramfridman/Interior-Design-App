// Polygon kernel (src/core/polykernel.js) and slant geometry (src/core/slant-geom.js) — stage A0.
//   node tests/polykernel.test.mjs
import { PLAN } from '../src/core/plan.js';
import * as E from '../src/core/plan-edit.js';
import * as K from '../src/core/polykernel.js';
import * as G from '../src/core/slant-geom.js';
import { WEDGE, DUPLEX } from './fixtures/houses.mjs';

let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const f2 = (v) => (Math.round(v * 1000) / 1000).toString();
const DEG = Math.PI / 180;
const dir = (deg) => [Math.cos(deg * DEG), Math.sin(deg * DEG)];
const add = (p, d, s = 1) => [p[0] + d[0] * s, p[1] + d[1] * s];
const slant = (id, a, b, t, extra = {}) => ({ id, x1: a[0], y1: a[1], x2: b[0], y2: b[1], t, ...extra });
const symDiff = (a, b) => K.netArea(K.difference(a, b)) + K.netArea(K.difference(b, a));
const cyclicEqual = (a, b) => a.length === b.length && b.some((_, s) => a.every((p, i) => p[0] === b[(i + s) % b.length][0] && p[1] === b[(i + s) % b.length][1]));
const BIG = 1e5;

/** True when a ring has no self-intersection (non-adjacent edges never meet; adjacent edges share only their vertex). */
function isSimple(ring) {
  const n = ring.length;
  if (n < 3) return false;
  const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const onSeg = (a, b, p) => Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
  const meet = (a, b, c, d) => {
    const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    if (o1 !== o2 && o3 !== o4 && o1 * o2 <= 0 && o3 * o4 <= 0 && !(o1 === 0 && o2 === 0)) return true;
    return (o1 === 0 && onSeg(a, b, c)) || (o2 === 0 && onSeg(a, b, d)) || (o3 === 0 && onSeg(c, d, a)) || (o4 === 0 && onSeg(c, d, b));
  };
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    if (a[0] === b[0] && a[1] === b[1]) return false;
    for (let j = i + 1; j < n; j++) {
      const c = ring[j], d = ring[(j + 1) % n];
      if (j === i + 1) { if (orient(a, b, d) === 0 && (d[0] - b[0]) * (a[0] - b[0]) + (d[1] - b[1]) * (a[1] - b[1]) > 0) return false; continue; }
      if (i === 0 && j === n - 1) { if (orient(c, d, b) === 0 && (b[0] - a[0]) * (c[0] - a[0]) + (b[1] - a[1]) * (c[1] - a[1]) > 0) return false; continue; }
      if (meet(a, b, c, d)) return false;
    }
  }
  return true;
}
/** Union of shapes: one outer ring, no holes, no ring below 1 cm², every ring simple. */
function cleanUnion(shapes) {
  const u = K.union(shapes), rs = K.rings(u);
  return { u, one: u.length === 1 && u[0].holes.length === 0, slivers: rs.filter((r) => Math.abs(K.area(r)) < 1).length, simple: rs.every(isSimple), area: K.netArea(u) };
}

// ------------------------------------------------------------------------------------------------ vendored library
group('Vendored Clipper (vendor/clipper/clipper.js)');
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../vendor/clipper/clipper.js', import.meta.url), 'utf8');
  check('pure ASCII (TAB / LF / printable only)', !/[^\x09\x0a\x20-\x7e]/.test(src));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('no eval / new Function', !/\beval\s*\(|new\s+Function\b|\bFunction\s*\(/.test(code));
  check('no globals touched (window / self / navigator / document / module)', !/\b(window|self|navigator|document|module|globalThis)\b/.test(code));
  const C = (await import('../vendor/clipper/clipper.js')).default;
  check('ES module default export is ClipperLib 6.4.2', C && C.version === '6.4.2.2' && typeof C.Clipper === 'function');
  check('loading it defines no global', typeof globalThis.ClipperLib === 'undefined' && typeof globalThis.Int128 === 'undefined' && Number.toInteger === undefined);
  check('kernel scale stays on Clipper\'s exact fast path for ±470 m', K.SCALE === 1000 && K.MAX_EXACT >= 47000, `MAX_EXACT ${K.MAX_EXACT} cm`);
}

// ------------------------------------------------------------------------------------------------ kernel basics
group('Kernel basics');
{
  const a = { x: 0, y: 0, w: 100, h: 100 }, b = [[50, 50], [150, 50], [150, 150], [50, 150]];
  const u = K.union([a, b]);
  check('union of two overlapping squares = 17500 cm², one ring', u.length === 1 && K.netArea(u) === 17500);
  check('outer clockwise on screen, starts at min y then min x', K.area(u[0].outer) > 0 && eq(u[0].outer[0], [0, 0]));
  check('difference / intersection / intersectArea', K.netArea(K.difference(a, b)) === 7500 && K.netArea(K.intersection(a, b)) === 2500 && K.intersectArea(a, b) === 2500);
  const ring = K.difference({ x: 0, y: 0, w: 100, h: 100 }, { x: 25, y: 25, w: 50, h: 50 });
  check('difference with an island gives a hole (counter-clockwise, starts at min x then min y)', ring.length === 1 && ring[0].holes.length === 1 && K.area(ring[0].holes[0]) < 0 && eq(ring[0].holes[0][0], [25, 25]));
  check('netArea counts holes negative', K.netArea(ring) === 7500);
  check('operations accept their own output (expolygons)', K.netArea(K.union([ring, { x: 25, y: 25, w: 50, h: 50 }])) === 10000);
  check('pointInPolys: inside 1, outside 0, boundary -1, in a hole 0', K.pointInPolys(10, 10, ring) === 1 && K.pointInPolys(200, 10, ring) === 0 && K.pointInPolys(0, 50, ring) === -1 && K.pointInPolys(50, 50, ring) === 0);
  const inn = K.offset({ x: 0, y: 0, w: 100, h: 60 }, -10), out = K.offset({ x: 0, y: 0, w: 100, h: 60 }, 10), rnd = K.offset({ x: 0, y: 0, w: 100, h: 60 }, 10, { join: 'round' });
  check('offset inward 10: 80 × 40', K.netArea(inn) === 3200 && eq(inn[0].outer, [[10, 10], [90, 10], [90, 50], [10, 50]]));
  check('offset outward 10 (mitre): 120 × 80', K.netArea(out) === 9600);
  const disc = 6000 + 2 * 10 * 160 + Math.PI * 100, fine = K.offset({ x: 0, y: 0, w: 100, h: 60 }, 10, { join: 'round', arcTolerance: 0.01 });
  check('offset outward 10 (round): rect + border + circle, arcs within arcTolerance (0.25 cm default)', K.netArea(rnd) <= disc && disc - K.netArea(rnd) <= 2 * Math.PI * 10 * 0.25 && near(K.netArea(fine), disc, 1), `${f2(K.netArea(rnd))} / ${f2(K.netArea(fine))} vs ${f2(disc)}`);
  check('offset inward by half the width or more → nothing (too narrow)', K.offset({ x: 0, y: 0, w: 100, h: 50 }, -25).length === 0);
  const pinch = K.faces([{ x: 0, y: 0, w: 100, h: 10 }, { x: 0, y: 90, w: 100, h: 10 }, { x: 0, y: 10, w: 10, h: 80 }, { x: 90, y: 10, w: 10, h: 80 }, { x: 40, y: 10, w: 10, h: 40 }, { x: 50, y: 50, w: 10, h: 40 }]);
  check('two faces that meet only at a point are two rooms (engine: 4-connected cells)', pinch.rooms.length === 2, `${pinch.rooms.length} rooms`);
  check('normalise: drops duplicates and straight collinear points, keeps slit spikes, orients and rotates', eq(K.normalise([[0, 10], [0, 0], [5, 0], [10, 0], [10, 0], [10, 10]]), [[0, 0], [10, 0], [10, 10], [0, 10]]) && eq(K.normalise([[0, 0], [0, 10], [10, 10], [10, 0]], { hole: true }), [[0, 0], [0, 10], [10, 10], [10, 0]]));
  check('deterministic: same input twice → identical output', eq(K.faces([...PLAN.walls, ...PLAN.openings]), K.faces([...PLAN.walls, ...PLAN.openings])));
  check('input order does not change the output', eq(K.faces([...PLAN.walls, ...PLAN.openings]), K.faces([...PLAN.openings, ...PLAN.walls].reverse())));
}

// ------------------------------------------------------------------------------------------------ shadow equivalence
group('Shadow equivalence on House 98 (kernel faces = engine rooms)');
{
  const solids = [...PLAN.walls, ...PLAN.openings];
  const { rooms, outdoor } = K.faces(solids);
  const engine = E.recomputePlan(PLAN).rooms;
  check('engine re-derives the stored rooms (baseline)', eq(engine.map((r) => r.polygon), PLAN.rooms.map((r) => r.polygon)));
  check(`same room count (${PLAN.rooms.length})`, rooms.length === PLAN.rooms.length, `${rooms.length}`);
  let worst = 0, sameRing = 0, sameNorm = 0;
  for (const r of PLAN.rooms) {
    const best = rooms.reduce((b, k) => (K.intersectArea(k.outer, r.polygon) > K.intersectArea(b.outer, r.polygon) ? k : b), rooms[0]);
    worst = Math.max(worst, symDiff([best], r.polygon));
    const joined = K.slitJoin(best.outer, best.holes);
    if (cyclicEqual(joined, r.polygon)) sameRing++;
    if (eq(K.normalise(r.polygon), joined)) sameNorm++;
  }
  check('symmetric difference with every PLAN.rooms polygon = 0 cm²', worst === 0, `max ${worst}`);
  check('every kernel room ring = the engine polygon (cyclically, exact vertices)', sameRing === PLAN.rooms.length, `${sameRing}/${PLAN.rooms.length}`);
  check('normalise(engine polygon) = slitJoin(kernel room) exactly', sameNorm === PLAN.rooms.length, `${sameNorm}/${PLAN.rooms.length}`);
  check('one outdoor face, holes = the building footprint', outdoor.length === 1 && outdoor[0].holes.length === 1);
  // a wall "touches" the outdoor face when a 1 cm strip along one of its sides overlaps it (no corners, like the grid)
  const touchesOut = (r) => [{ x: r.x - 1, y: r.y, w: 1, h: r.h }, { x: r.x + r.w, y: r.y, w: 1, h: r.h }, { x: r.x, y: r.y - 1, w: r.w, h: 1 }, { x: r.x, y: r.y + r.h, w: r.w, h: 1 }].some((s) => K.intersectArea(s, outdoor) > 0);
  const ext = PLAN.walls.filter((w) => w.kind === 'exterior');
  const missed = ext.filter((w) => !touchesOut(w)).map((w) => w.id);
  check(`the outdoor face touches every exterior wall (${ext.length})`, missed.length === 0, missed.join(' '));
  const segs = E.wallSegments(PLAN).filter((s) => s.cls !== 'mamad');
  const diff = segs.filter((s) => (s.cls === 'exterior') !== touchesOut(s.core)).map((s) => s.id);
  check(`exterior classification of every segment (${segs.length}, safe room excluded) equal`, diff.length === 0, diff.join(' '));
}

group('Shadow equivalence: rooms with free-standing walls (zero-width slits)');
{
  const box = (x0, y0, x1, y1) => [{ x: x0, y: y0, w: x1 - x0, h: 20 }, { x: x0, y: y1 - 20, w: x1 - x0, h: 20 }, { x: x0, y: y0 + 20, w: 20, h: y1 - y0 - 40 }, { x: x1 - 20, y: y0 + 20, w: 20, h: y1 - y0 - 40 }];
  const cases = {
    'two islands, one left of the other': [...box(0, 0, 800, 600), { x: 200, y: 150, w: 100, h: 10 }, { x: 400, y: 200, w: 10, h: 150 }, { x: 150, y: 400, w: 60, h: 60 }],
    'slit lands on an outline vertex': [...box(0, 0, 800, 600), { x: 20, y: 20, w: 100, h: 150 }, { x: 300, y: 170, w: 50, h: 50 }],
    'island left of another island at the same height': [...box(0, 0, 900, 500), { x: 150, y: 200, w: 40, h: 40 }, { x: 400, y: 200, w: 40, h: 80 }],
  };
  for (const [name, walls] of Object.entries(cases)) {
    const eng = E.analyseWalls(walls, []).rooms;
    const ker = K.faces(walls).rooms;
    const ok = eng.length === ker.length && ker.length === 1 && eq(K.slitJoin(ker[0].outer, ker[0].holes), eng[0].polygon);
    check(`${name}: slitJoin(kernel) === engine polygon`, ok, ok ? `${ker[0].holes.length} holes` : JSON.stringify(eng.map((r) => r.polygon)) + ' vs ' + JSON.stringify(ker.map((r) => K.slitJoin(r.outer, r.holes))));
  }
}

// ------------------------------------------------------------------------------------------------ Wedge
group('Wedge (tests/fixtures/houses.mjs)');
{
  const slants = G.joinSlants(WEDGE.slants, WEDGE.walls);
  const byId = Object.fromEntries(slants.map((s) => [s.id, s]));
  const quads = WEDGE.openings.filter((o) => o.axis === 'a').map((o) => G.openingQuad(byId[o.wall], o.at, o.width));
  const rectOpenings = WEDGE.openings.filter((o) => o.axis !== 'a');
  const solids = [...WEDGE.walls, ...rectOpenings, ...slants, ...quads];
  const { rooms, outdoor } = K.faces(solids);
  check('3 rooms', rooms.length === WEDGE.expect.rooms, `${rooms.length}`);
  // analytic rooms
  const r2 = Math.SQRT2;
  const tri = [[20, 20], [305 - 5 * r2, 20], [20, 305 - 5 * r2]];
  const west = [[305 + 5 * r2, 20], [500, 20], [500, 780], [20, 780], [20, 305 + 5 * r2]];
  // s01's inner (west) face: through (990,10) + 10·n, n = left-of-travel unit normal pointing west
  const L = Math.hypot(400, 780), ux = -400 / L, uy = 780 / L, fx = 990 - 10 * (780 / L), fy = 10 - 10 * (400 / L);
  const xAt = (y) => fx + ((y - fy) / uy) * ux;
  const east = [[510, 20], [xAt(20), 20], [xAt(780), 780], [510, 780]];
  for (const [name, poly] of [['NW triangle', tri], ['west room', west], ['east trapezoid', east]]) {
    const k = rooms.find((r) => K.pointInPolys(...interiorOf(poly), [r]) === 1);
    const dA = k ? Math.abs(k.area - Math.abs(K.area(poly))) : Infinity;
    check(`${name}: area = analytic ${f2(Math.abs(K.area(poly)))} cm² (|Δ| < 1 cm²), symmetric difference < 1 cm²`, k && dA < 1 && symDiff([k], poly) < 1, k ? `Δ ${dA.toExponential(2)}, symdiff ${f2(symDiff([k], poly))}` : 'missing');
  }
  check('east trapezoid ≈ 20.43 m² with inner vertices ≈ (973.6, 20), (583.9, 780)', near(Math.abs(K.area(east)) / 1e4, WEDGE.expect.eastRoomArea, 0.005) && near(xAt(20), 973.6, 0.05) && near(xAt(780), 583.9, 0.05), `${f2(Math.abs(K.area(east)) / 1e4)} m²`);
  const u = K.union(solids);
  check('union of solids = 1 outer ring (rooms are its 3 holes)', u.length === 1 && u[0].holes.length === 3);
  check('s01 and s02 join the rect walls at both ends', eq(G.slantJoins(WEDGE.slants, WEDGE.walls).map((j) => j.ends.map((e) => e.type)), [['rect', 'rect'], ['rect', 'rect']]));
  // no poke-out: s01 is clipped by the north wall's far face and east end, and by the south wall's end at x 600
  // (its free footprint would stick out there); s02 stops at the far faces of the west and north walls
  const outsideBox = (s) => K.netArea(K.difference(s.poly, { x: 0, y: 0, w: 1000, h: 800 }));
  check('slant polygons never poke out of the rects they run into', outsideBox(byId.s01) === 0 && outsideBox(byId.s02) === 0 && K.intersectArea(byId.s01.poly, { x: 600, y: 780, w: 100, h: 100 }) === 0 && K.intersectArea(G.freePoly(WEDGE.slants[0]), { x: 600, y: 780, w: 100, h: 100 }) > 1);
  check('s02 is extended through the walls to their far faces (x 0, y 0)', Math.min(...byId.s02.poly.map((p) => p[0])) === 0 && Math.min(...byId.s02.poly.map((p) => p[1])) === 0);
  // sides of the openings
  const s01 = byId.s01, win = WEDGE.openings[0], [wx, wy] = G.pointAt(s01, win.at), fr = G.slantFrame(s01);
  const sideSpace = (s, at, side) => { const f = G.slantFrame(s), [x, y] = G.pointAt(s, at), k = side === 'r' ? 1 : -1, px = x + f.nx * k * (f.hw + 5), py = y + f.ny * k * (f.hw + 5); return K.pointInPolys(px, py, outdoor) ? 'outside' : rooms.findIndex((r) => K.pointInPolys(px, py, [r]) === 1); };
  check(`window in s01 at its middle: outdoor side is '${WEDGE.expect.windowOutside}', the east room on the other`, sideSpace(s01, win.at, WEDGE.expect.windowOutside) === 'outside' && rooms[sideSpace(s01, win.at, 'r')] && near(rooms[sideSpace(s01, win.at, 'r')].area, Math.abs(K.area(east)), 1) && G.sideOf(s01, wx + fr.nx, wy + fr.ny) === 'r');
  const s02 = byId.s02, door = WEDGE.openings[1];
  const L2 = sideSpace(s02, door.at, 'l'), R2 = sideSpace(s02, door.at, 'r');
  check('door in s02 joins the NW triangle (l) and the west room (r)', L2 >= 0 && R2 >= 0 && near(rooms[L2].area, Math.abs(K.area(tri)), 1) && near(rooms[R2].area, Math.abs(K.area(west)), 1));
  check('Duplex fixture present (data only, used from F1 on)', DUPLEX.levels.length === 1 && DUPLEX.levels[0].elevation === 300 && DUPLEX.expect.l1EastRoomFloorArea === 670 * 760 - 100 * 374);
}
function interiorOf(poly) { const c = poly.reduce((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length], [0, 0]); return c; }

// ------------------------------------------------------------------------------------------------ joins
group('Joins and mitres (all built at a 30° rotation, so nothing is axis-aligned)');
const ROT = 30, C0 = [500, 500];
function Ljoin(alpha, t = 20, len = 300) {
  const s1 = slant('a', add(C0, dir(ROT), len), C0, t), s2 = slant('b', C0, add(C0, dir(ROT + alpha), len), t);
  return { list: [s1, s2], joined: G.joinSlants([s1, s2]), joins: G.slantJoins([s1, s2]) };
}
{
  const t = 20, hw = 10, len = 300;
  for (const alpha of [90, 45]) {
    const { joined, joins } = Ljoin(alpha);
    const cu = cleanUnion(joined.map((s) => s.poly));
    check(`L at ${alpha}°: mitre, union = 2·L·t exactly (one ring, no slivers, simple)`, joins.every((j) => j.ends.some((e) => e.type === 'mitre') && !j.ends.some((e) => e.type === 'bevel')) && cu.one && cu.slivers === 0 && cu.simple && near(cu.area, 2 * len * t, 0.5), `area ${f2(cu.area)} vs ${2 * len * t}`);
    check(`L at ${alpha}°: the two pieces do not overlap`, K.intersectArea(joined[0].poly, joined[1].poly) < 0.5);
  }
  {
    // unequal thickness at 90°: the mitre line runs through both face intersections; union = the two arms to the
    // other wall's outer face, minus their t1 × t2 overlap
    const t1 = 10, t2 = 30, s1 = slant('a', add(C0, dir(ROT), len), C0, t1), s2 = slant('b', C0, add(C0, dir(ROT + 90), len), t2);
    const J = G.joinSlants([s1, s2]), cu = cleanUnion(J.map((s) => s.poly)), expectA = t1 * (len + t2 / 2) + t2 * (len + t1 / 2) - t1 * t2;
    check('L at 90° with t 10 / 30: mitre, union analytic, pieces do not overlap', G.slantJoins([s1, s2]).every((j) => j.ends.some((e) => e.type === 'mitre')) && cu.one && cu.slivers === 0 && near(cu.area, expectA, 0.5) && K.intersectArea(J[0].poly, J[1].poly) < 0.5, `area ${f2(cu.area)} vs ${f2(expectA)}`);
  }
  {
    const alpha = 15, { joined, joins } = Ljoin(alpha), b = (alpha / 2) * DEG;
    const cu = cleanUnion(joined.map((s) => s.poly)), expectA = 2 * len * t - (hw * hw * Math.cos(b) ** 3) / Math.sin(b);
    check('L at 15°: mitre longer than 3 t → bevel', joins.some((j) => j.ends.some((e) => e.type === 'bevel')));
    check('L at 15°: union = 2·L·t − bevelled tip (analytic), one ring, no slivers, simple', cu.one && cu.slivers === 0 && cu.simple && near(cu.area, expectA, 0.5), `area ${f2(cu.area)} vs ${f2(expectA)}`);
    const tipLen = Math.max(...joined.flatMap((s) => s.poly.map((p) => -((p[0] - C0[0]) * Math.cos((ROT + alpha / 2) * DEG) + (p[1] - C0[1]) * Math.sin((ROT + alpha / 2) * DEG)))));
    check('L at 15°: nothing reaches further behind the corner than the bevel chord', tipLen <= hw * Math.sin(b) + 0.01, `${f2(tipLen)} cm`);
    const at20 = Ljoin(20).joins;
    check('L at 20° (mitre 2.88 t) is still a mitre', at20.every((j) => j.ends.every((e) => e.type !== 'bevel')));
  }
  {
    // T at 90° and 60°, the stem ending exactly on the through wall's centre line, 5 cm short of its face, or past it
    // endOff: where the stem ends, measured from the through wall's centre line back along the stem (+ = short of it)
    for (const [phi, stemT, endOff, what] of [[90, 10, 0, 'on the centre line'], [60, 10, 0, 'on the centre line'], [90, 10, 15, '5 cm short of the face'], [60, 20, -3, '3 cm past the centre line']]) {
      const tb = 20, B = slant('B', add(C0, dir(ROT), -300), add(C0, dir(ROT), 300), tb);
      const S = slant('S', add(C0, dir(ROT + phi), 260), add(C0, dir(ROT + phi), endOff), stemT);
      const joined = G.joinSlants([B, S]), joins = G.slantJoins([B, S]);
      const cu = cleanUnion(joined.map((s) => s.poly));
      const expectA = 600 * tb + stemT * (260 - (tb / 2) / Math.sin(phi * DEG));
      check(`T at ${phi}° (stem t ${stemT}, end ${what}): tee, union analytic`, joins[1].ends[1].type === 'tee' && cu.one && cu.slivers === 0 && cu.simple && near(cu.area, expectA, 0.5), `${joins[1].ends[1].type}, area ${f2(cu.area)} vs ${f2(expectA)}`);
    }
  }
  {
    // X: four arms meeting at one point; and two walls crossing in their middles (no join needed)
    const arms = [0, 90, 180, 270].map((a, i) => slant('x' + i, C0, add(C0, dir(ROT + a), 250), 20));
    const joined = G.joinSlants(arms), cu = cleanUnion(joined.map((s) => s.poly));
    check('X (4 ends at a point): multi join, union = 4·L·t − t² (plus sign), clean', G.slantJoins(arms).every((j) => j.ends[0].type === 'multi') && cu.one && cu.slivers === 0 && cu.simple && near(cu.area, 4 * 250 * 20 - 400, 0.5), `area ${f2(cu.area)}`);
    const pieces = joined.map((s) => s.poly);
    let overlap = 0;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) overlap += K.intersectArea(pieces[i], pieces[j]);
    check('X: the four pieces tile the junction (no overlap)', overlap < 0.5, f2(overlap));
    const phi = 70, a = slant('c1', add(C0, dir(ROT), -300), add(C0, dir(ROT), 300), 20), b = slant('c2', add(C0, dir(ROT + phi), -300), add(C0, dir(ROT + phi), 300), 20);
    const cx = cleanUnion(G.joinSlants([a, b]).map((s) => s.poly));
    check('X (two walls crossing): free ends, union = 2·600·t − t²/sin φ', G.slantJoins([a, b]).every((j) => j.ends.every((e) => e.type === 'free')) && cx.one && near(cx.area, 2 * 600 * 20 - 400 / Math.sin(phi * DEG), 0.5), f2(cx.area));
  }
  {
    // 3-way: Y at 120° and uneven gaps 100° / 120° / 140°; equal t: union = Σ L·t − hw² Σ cot(gap / 2)
    for (const gaps of [[120, 120, 120], [100, 120, 140]]) {
      let a = ROT; const dirs = [a];
      for (const g of gaps.slice(0, 2)) { a += g; dirs.push(a); }
      const arms = dirs.map((d, i) => slant('y' + i, add(C0, dir(d), 280), C0, 20));
      const joined = G.joinSlants(arms), cu = cleanUnion(joined.map((s) => s.poly));
      const expectA = 3 * 280 * 20 - 100 * gaps.reduce((s, g) => s + 1 / Math.tan((g / 2) * DEG), 0);
      check(`3-way ${gaps.join('/')}°: multi join, union analytic, one ring, no slivers`, G.slantJoins(arms).every((j) => j.ends[1].type === 'multi') && cu.one && cu.slivers === 0 && cu.simple && near(cu.area, expectA, 0.5), `area ${f2(cu.area)} vs ${f2(expectA)}`);
    }
    // 4-way with mixed thickness: no gap at the junction
    const arms = [0, 80, 170, 260].map((d, i) => slant('m' + i, C0, add(C0, dir(ROT + d), 200), [10, 20, 15, 30][i]));
    const cu = cleanUnion(G.joinSlants(arms).map((s) => s.poly));
    check('4-way with thicknesses 10/20/15/30: one ring, no hole, no sliver, simple', cu.one && cu.slivers === 0 && cu.simple);
  }
  {
    // slant end on a rect: extend to the far face, clip so it never pokes out
    const R = { x: 0, y: 0, w: 800, h: 20 }, phi = 30, L = 300, t = 10, d = [Math.sin(phi * DEG), Math.cos(phi * DEG)];
    for (const [name, endY] of [['end on the near face', 20], ['end 6 cm short', 26], ['end inside the wall', 8], ['end 8 cm through the wall', -8]]) {
      const E0 = [400 + (endY - 20) * Math.tan(phi * DEG), endY], s = slant('s', add([400, 20], d, L), E0, t);
      const [j] = G.joinSlants([s], [R]), kind = G.slantJoins([s], [R])[0].ends[1].type;
      const cu = cleanUnion([R, j.poly]), outside = K.netArea(K.difference(j.poly, [R, { x: -BIG, y: 20, w: 2 * BIG, h: BIG }]));
      check(`slant end on a rect (${name}): joined to the rect, union = rect + t·L, nothing outside the rect`, kind === 'rect' && cu.one && cu.slivers === 0 && near(cu.area, 800 * 20 + t * L, 0.5) && outside < 1e-6, `${kind}, area ${f2(cu.area)}, outside ${f2(outside)}`);
    }
    const s = slant('s', add([795, 20], d, L), [795, 20], 20);
    const [j] = G.joinSlants([s], [R]);
    const outside = K.netArea(K.difference(j.poly, [R, { x: -BIG, y: 20, w: 2 * BIG, h: BIG }]));
    check('slant end on a rect near the rect\'s end: clipped at the rect\'s end too', outside < 1e-6 && cleanUnion([R, j.poly]).one, f2(outside));
  }
  {
    // rect end on a slant: the rect stays a rect; joint fill (rect's own extension to the centre line) on the slant
    const a = 20 * DEG, t = 20, hw = 10, A = [0, 200], S = slant('S', A, add(A, [Math.cos(a), -Math.sin(a)], 600), t);
    const yEnd = 200 - 150 * Math.tan(a) + hw / Math.cos(a);                 // the first corner (x 150) touches the near face
    const R = { x: 150, y: yEnd, w: 10, h: 600 - yEnd };
    const [j] = G.joinSlants([S], [R]), info = G.slantJoins([S], [R])[0];
    const cu = cleanUnion([R, j.poly]), expectA = 600 * t + 10 * (600 - yEnd) + 0.5 * 10 * 10 * Math.tan(a);
    check('rect end on a slant: joint fill recorded on the slant, rect unchanged', info.fills.length === 1 && info.fills[0] === 0 && R.y === yEnd);
    check('rect end on a slant: union = slant + rect + gap triangle (no gap), one ring, no sliver', cu.one && cu.slivers === 0 && cu.simple && near(cu.area, expectA, 0.5), `area ${f2(cu.area)} vs ${f2(expectA)}`);
    const allowed = [G.freePoly(S), { x: 150, y: -BIG, w: 10, h: BIG + yEnd }];
    check('rect end on a slant: the fill never pokes out (inside the slant ∪ the rect\'s own extension)', K.netArea(K.difference(j.poly, allowed)) < 1e-6);
    const projHull = K.union([[[150, yEnd], [160, yEnd], [160, 200 - 160 * Math.tan(a)], [150, 200 - 150 * Math.tan(a)]]]);
    check('rect end on a slant: covers the design\'s joint triangle outside the slant', K.netArea(K.difference(K.difference(projHull, G.freePoly(S)), [j.poly, R])) < 1e-6);
  }
  {
    // order independence and idempotence on a mixed scene
    const scene = [...WEDGE.slants, slant('s03', [510, 400], [200, 600], 10), slant('s04', [200, 600], [20, 500], 10)];
    const a = G.joinSlants(scene, WEDGE.walls), b = G.joinSlants([...scene].reverse(), [...WEDGE.walls].reverse()).reverse(), c = G.joinSlants(a, WEDGE.walls);
    check('joinSlants is order-independent', eq(a.map((s) => s.poly), b.map((s) => s.poly)));
    check('joinSlants is idempotent', eq(a, c));
  }
}

group('Helpers');
{
  const s = slant('h', [100, 100], [400, 500], 20), f = G.slantFrame(s);
  check('slantFrame: length 500, unit u, right normal n = (−uy, ux)', f.len === 500 && near(f.ux, 0.6, 1e-12) && near(f.uy, 0.8, 1e-12) && near(f.nx, -0.8, 1e-12) && near(f.ny, 0.6, 1e-12) && f.hw === 10);
  check('pointAt / atOf round-trip', eq(G.pointAt(s, 250), [250, 300]) && near(G.atOf(s, 250, 300), 250, 1e-9));
  check('sideOf: east wall direction → south is r', G.sideOf(slant('e', [0, 0], [100, 0], 10), 50, 10) === 'r' && G.sideOf(slant('e', [0, 0], [100, 0], 10), 50, -10) === 'l');
  const fl = G.faceLines(s);
  check('faceLines: both faces parallel, t apart', near(Math.abs(G.offsetOf(s, ...fl.l[0])), 10, 1e-9) && near(G.offsetOf(s, ...fl.r[1]), 10, 1e-9) && near(G.offsetOf(s, ...fl.l[1]), -10, 1e-9));
  const q = G.openingQuad(s, 250, 100);
  check('openingQuad: width × t, centred at `at`', near(K.area(q), 100 * 20, 1e-6) && K.area(q) > 0);
  check('distToCentre / distToWall', near(G.distToCentre(s, 250 + 0.8 * 30, 300 - 0.6 * 30), 30, 1e-9) && near(G.distToWall(s, 250 + 0.8 * 30, 300 - 0.6 * 30), 20, 1e-9) && G.distToWall(s, 250, 300) === 0 && near(G.distToWall({ ...s, poly: G.freePoly(s) }, 250 + 0.8 * 30, 300 - 0.6 * 30), 20, 1e-6));
  check('free slant: square caps, area L·t', near(K.area(G.freePoly(s)), 500 * 20, 1e-6));
}

// ------------------------------------------------------------------------------------------------ robustness
group('Robustness: 1000 random slant pairs / triples (fixed seed)');
{
  let seed = 0x5eed1234;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pt = () => [Math.round(rnd() * 6000) / 10, Math.round(rnd() * 6000) / 10];
  let threw = 0, bad = 0, unionBad = 0, orderBad = 0, cases = 0, hair = 0, flipBad = 0;
  const seen = {};
  const examples = [];
  for (let n = 0; n < 1000; n++) {
    const k = 2 + (rnd() < 0.5 ? 1 : 0), list = [], rects = [];
    const hub = pt();
    for (let i = 0; i < k; i++) {
      const mode = rnd();
      let a = pt(), b = pt();
      if (mode < 0.45) a = [hub[0] + (rnd() < 0.2 ? rnd() - 0.5 : 0), hub[1]];                               // junctions
      else if (mode < 0.65 && list.length) { const o = list[0], u = rnd(); a = [o.x1 + (o.x2 - o.x1) * u + (rnd() - 0.5) * 20, o.y1 + (o.y2 - o.y1) * u]; }   // T-ish
      else if (mode < 0.72) b = [a[0] + (rnd() - 0.5) * 4, a[1] + (rnd() - 0.5) * 4];                           // tiny walls
      list.push(slant('r' + i, a, b, 5 + Math.round(rnd() * 25)));
    }
    if (rnd() < 0.4) { const p = pt(); rects.push(rnd() < 0.5 ? { x: p[0], y: p[1], w: 50 + Math.round(rnd() * 300), h: 10 + Math.round(rnd() * 20) } : { x: p[0], y: p[1], w: 10 + Math.round(rnd() * 20), h: 50 + Math.round(rnd() * 300) }); }
    cases++;
    try {
      const out = G.joinSlants(list, rects);
      for (const s of out) if (!(s.poly.length >= 3 && s.poly.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) && K.area(s.poly) > 0 && isSimple(s.poly))) { bad++; if (examples.length < 3) examples.push(JSON.stringify(list)); }
      for (const j of G.slantJoins(list, rects)) for (const e of j.ends) seen[e.type] = (seen[e.type] || 0) + 1;
      const u = K.union([...out, ...rects]);
      if (!K.rings(u).every(isSimple)) unionBad++;
      hair += K.rings(u).filter((r) => Math.abs(K.area(r)) < 0.01).length;
      if (n % 10 === 5) { const flip = G.joinSlants(list.map((q) => ({ ...q, x1: q.x2, y1: q.y2, x2: q.x1, y2: q.y1 })), rects); if (symDiff(flip.map((q) => q.poly), out.map((q) => q.poly)) > 0.01) flipBad++; }
      if (n % 10 === 0) { const back = G.joinSlants([...list].reverse(), rects).reverse(); if (!eq(back.map((s) => s.poly), out.map((s) => s.poly))) orderBad++; }
    } catch (e) { threw++; if (examples.length < 3) examples.push(e.message + ' ' + JSON.stringify(list)); }
  }
  check(`${cases} random cases never throw`, threw === 0, `${threw}`);
  check('every slant poly is a simple ring with positive area', bad === 0, `${bad} bad ${examples.join(' | ')}`);
  check('every ring of their union is simple', unionBad === 0, `${unionBad}`);
  check('order independence on 100 of them', orderBad === 0, `${orderBad}`);
  check('reversing every centre line gives the same footprint (100 of them)', flipBad === 0, `${flipBad}`);
  check('no hairline ring (< 0.01 cm²) in any union', hair === 0, `${hair}`);
  check('every join kind was exercised', ['free', 'mitre', 'bevel', 'multi', 'tee', 'rect', 'degenerate'].every((k) => seen[k] > 0), JSON.stringify(seen));
}

// ------------------------------------------------------------------------------------------------ rotation invariance
group('Rotation invariance');
{
  const room = (deg) => {
    const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG), R = ([x, y]) => [300 + x * c - y * s, 300 + x * s + y * c];
    const P = [[0, 0], [410, 0], [410, 310], [0, 310]].map(R);
    const walls = P.map((p, i) => slant('q' + i, p, P[(i + 1) % 4], 10));
    return K.faces(G.joinSlants(walls)).rooms;
  };
  const r0 = room(0), r30 = room(30), r17 = room(17.3);
  check('400 × 300 room from 4 slants: area 120000 cm² unrotated', r0.length === 1 && near(r0[0].area, 120000, 1e-6), f2(r0[0] && r0[0].area));
  check('rotated by 30°: same room area (|Δ| < 1 cm²)', r30.length === 1 && near(r30[0].area, r0[0].area, 1), f2(r30[0] && r30[0].area));
  check('rotated by 17.3°: same room area (|Δ| < 1 cm²)', r17.length === 1 && near(r17[0].area, r0[0].area, 1), f2(r17[0] && r17[0].area));
}

// ------------------------------------------------------------------------------------------------ performance
group('Performance');
{
  const solids = [...PLAN.walls, ...PLAN.openings];
  for (let i = 0; i < 30; i++) { K.union(solids); K.faces(solids); }
  const N = 100, t0 = performance.now();
  for (let i = 0; i < N; i++) { K.union(solids); K.faces(solids); }
  const ms = (performance.now() - t0) / N;
  check(`House 98: union + faces of ${solids.length} solids under 5 ms after warm-up`, ms < 5, `${ms.toFixed(2)} ms`);
  const sl = WEDGE.slants;
  for (let i = 0; i < 30; i++) G.joinSlants(sl, WEDGE.walls);
  const t1 = performance.now();
  for (let i = 0; i < N; i++) { const j = G.joinSlants(sl, WEDGE.walls); K.faces([...WEDGE.walls, ...j]); }
  console.log(`  info Wedge: joinSlants + faces ${((performance.now() - t1) / N).toFixed(2)} ms`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
