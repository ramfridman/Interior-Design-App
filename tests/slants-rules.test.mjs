// Regulations, carpentry and the walk-through on plans with angled walls — stage A5 of
// docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md (docs/CONTRACT.md § 7 "Regulations, carpentry and walking on angled walls").
// The "Wedge" test house is in tests/fixtures/houses.mjs. House 98 stays byte-identical (tests/geometry.test.mjs pins it).
//   node tests/slants-rules.test.mjs
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
  const base = ${JSON.stringify(new URL('../vendor/three/', import.meta.url).href)};
  export async function resolve(spec, ctx, next) {
    if (spec === 'three') return { url: base + 'three.module.min.js', shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: base + 'addons/' + spec.slice(13), shortCircuit: true };
    return next(spec, ctx);
  }`));
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ctx2d), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ width: 0, height: 0, style: {}, className: '', getContext: () => ctx2d, append() {}, appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {} });
globalThis.document ??= { createElement: el, documentElement: {}, addEventListener() {}, removeEventListener() {} };
let NOW = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => NOW }, configurable: true, writable: true });
const listeners = {};
globalThis.window = { addEventListener: (t, f) => { (listeners[t] ||= new Set()).add(f); }, removeEventListener: (t, f) => { listeners[t] && listeners[t].delete(f); } };

const clone = (o) => JSON.parse(JSON.stringify(o));
const THREE = await import('three');
const { PLAN } = await import('../src/core/plan.js');
const { store } = await import('../src/core/store.js');
const B = await import('../src/core/plan-build.js');
const E = await import('../src/core/plan-edit.js');
const G = await import('../src/core/geometry.js');
const SG = await import('../src/core/slant-geom.js');
const K = await import('../src/core/polykernel.js');
const RG = await import('../src/regulations/geom.js');
const { runChecks } = await import('../src/regulations/index.js');
const { roomSides } = await import('../src/regulations/building.js');
const C = await import('../src/carpentry/index.js');
const { composeQuotation } = await import('../src/carpentry/doc/index.js');
const { createWalk, defaultWalkStart, WALKER_RADIUS } = await import('../src/view3d/walk.js');
const { WEDGE } = await import('./fixtures/houses.mjs');

store.persist = false;
const H98PLAN = clone(PLAN);                 // the built-in house, before anything else is opened
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const DEG = Math.PI / 180;

// ───────────────────────── houses ─────────────────────────
const input = (over = {}) => ({ walls: clone(WEDGE.walls), slants: clone(WEDGE.slants), openings: clone(WEDGE.openings), heights: WEDGE.heights, meta: { name: 'Wedge' }, ...over });
const build = (inp) => { const r = B.buildPlan(inp, { slants: true }); if (!r.ok) throw new Error('buildPlan: ' + JSON.stringify(r.warnings)); return r.plan; };
const WPLAN = build(input());
const open = (plan, items = [], phase = 'draft') => store.openProject({ basePlan: plan, phase, design: { items, project: { ceilingHeight: 300 } } });
const S01 = WEDGE.slants[0], S02 = WEDGE.slants[1], F1 = SG.slantFrame(S01), F2 = SG.slantFrame(S02);
const roomOf = (pred) => PLAN.rooms.find(pred);
const east = () => roomOf((r) => r.polygon.some(([x]) => x > 900));
const nwTri = () => roomOf((r) => r.polygon.length === 3);
const westRoom = () => roomOf((r) => r !== east() && r !== nwTri());
const item = (o) => ({ id: o.id, type: o.type || 'cabinet', name: o.name || o.id, x: o.x, y: o.y, rot: o.rot || 0, w: o.w, d: o.d, h: o.h ?? 90, elev: o.elev || 0, placement: o.placement || 'floor', zone: 'indoor', params: o.params || {}, price: null, generic: true });

// ───────────────────────── regulations ─────────────────────────
group('largest inner rectangle on any room shape');
open(WPLAN);
{
  // NW triangle: right isosceles, legs L = (325 − 5√2 − 20) − 20 → the largest rectangle by its shorter side is the
  // L/2 square in the right angle (a square standing on the hypotenuse is only L√2/3 = 0.471 L)
  const L = 325 - 5 * Math.SQRT2 - 40, t = RG.largestInnerRect(nwTri().polygon);
  check('NW triangle: L/2 square (analytic 138.96 cm), ±0.1 cm', near(t.w, L / 2, 0.1) && near(t.h, L / 2, 0.1), `${t.w.toFixed(3)} × ${t.h.toFixed(3)} want ${(L / 2).toFixed(3)}`);
  // east trapezoid: x 510 … the inner face of s01, x(y) = 973.63 − k (y − 20); the best is the square at the north-west
  // corner where it meets the slant: s = (x(20) − 510) / (1 + k)
  const tr = east(), top = tr.polygon.reduce((a, p) => (p[1] < 21 && p[0] > a ? p[0] : a), 0), bot = tr.polygon.reduce((a, p) => (p[1] > 779 && p[0] > a ? p[0] : a), 0);
  const k = (top - bot) / 760, sq = (top - 510) / (1 + k), r = RG.largestInnerRect(tr.polygon);
  check('east trapezoid: the analytic square (≈ 306.46 cm), ±0.1 cm, and it lies inside the room', near(Math.min(r.w, r.h), sq, 0.1) && r.poly.every(([x, y]) => G.pointInPolygon(x, y, tr.polygon) || RG.pointPolyEdgeDist(x, y, tr.polygon) < 0.01),
    `${r.w.toFixed(3)} × ${r.h.toFixed(3)} want ${sq.toFixed(3)}`);
  // a rectilinear room: the old exact code path (same numbers as before, no angle / poly keys)
  const rr = RG.largestInnerRect([[0, 0], [400, 0], [400, 300], [0, 300]]);
  check('rectilinear rooms keep the exact axis search (no oriented keys)', JSON.stringify(rr) === JSON.stringify({ x: 0, y: 0, w: 400, h: 300 }), JSON.stringify(rr));
  // a 400 × 300 room turned by 30°: the rectangle follows the walls
  const c = Math.cos(30 * DEG), s = Math.sin(30 * DEG), rot = [[0, 0], [400, 0], [400, 300], [0, 300]].map(([x, y]) => [500 + x * c - y * s, 100 + x * s + y * c]);
  const ro = RG.largestInnerRect(rot);
  check('a 400 × 300 room turned by 30°: 400 × 300 at 30°', near(Math.max(ro.w, ro.h), 400, 0.1) && near(Math.min(ro.w, ro.h), 300, 0.1) && near(ro.angle, 30, 1e-6), `${ro.w.toFixed(2)} × ${ro.h.toFixed(2)} @ ${ro.angle}`);
}

group('minimum dimensions and narrow passages with an angled wall');
{
  // the NW triangle typed as a bedroom: 3.86 m², 1.39 m between walls (the slant makes it narrow)
  const plan = clone(WPLAN);
  plan.rooms.find((r) => r.polygon.length === 3).type = 'bedroom';
  open(plan);
  const f = runChecks({ store, plan: PLAN }).find((x) => x.id === `room-size-habitable:${nwTri().id}`);
  check('NW triangle as a bedroom: fails, 1.39 m clear width from the oriented inner rectangle', f && f.severity === 'fail' && /1\.39 m between walls/.test(f.detail), f && f.detail.slice(0, 90));
  // a corridor between a slant and a parallel wall: two facing 45° edges 80 cm apart → narrow passage, measured across
  const strip = [[0, 0], [100, 0], [400, 300], [400, 413.137], [0, 13.137]];   // faces x − y = 0 … x − y = −13.137 + 400 … (parallel at 45°)
  const corr = [[100, 0], [213.137, 0], [400, 186.863], [400, 300]];         // a 45° strip: faces x − y = 100 and x − y = 213.137 → 80 cm apart
  const np = RG.narrowPassages(corr);
  check('narrowPassages: two facing 45° faces 80 cm apart → width 80 (perpendicular), angle 45°', np.length === 1 && near(np[0].width, 80, 0.01) && near(np[0].angle, 45, 1e-6), JSON.stringify(np));
  check('narrowerThan (polygon kernel, as the engine\'s 60 cm rule): the 80 cm strip is narrower than 90, not than 70', RG.narrowerThan(corr, 90) && !RG.narrowerThan(corr, 70) && !RG.narrowerThan(strip, 60));
  const rect = [[0, 0], [300, 0], [300, 80], [0, 80]];
  check('narrowPassages of a rectilinear room unchanged (no angle key)', JSON.stringify(RG.narrowPassages(rect)) === JSON.stringify([{ width: 80, length: 300, x: 150, y: 40 }]), JSON.stringify(RG.narrowPassages(rect)));
}

group('openings in angled walls: door swing, clearance, window area and orientation');
{
  open(WPLAN);
  const door = PLAN.openings.find((o) => o.id === 'door-s02'), win = PLAN.openings.find((o) => o.id === 'win-s01');
  const sw = RG.doorSwing(door), h = G.openingHinge(door);
  check('door in s02: swing = the quarter circle about its hinge, radius 80, on its swing side', sw && sw.length === 8 && sw.slice(1).every(([x, y]) => near(Math.hypot(x - h.x, y - h.y), 80, 1e-6))
    && sw.slice(1).every(([x, y]) => SG.sideOf(S02, x, y) === 'r' || SG.offsetOf(S02, x, y) >= 4.99));
  // a chair-height cabinet in the swing, beside the door on the swing side
  const [mx, my] = SG.pointAt(S02, door.at), inSwing = item({ id: 'cab-swing', x: mx + F2.nx * 40 + F2.ux * 10, y: my + F2.ny * 40 + F2.uy * 10, w: 40, d: 40, h: 80, rot: 315 });
  open(WPLAN, [inSwing]);
  let f = runChecks({ store, plan: PLAN });
  check('a cabinet in the swing of the door in s02 is flagged (door-swing)', f.some((x) => x.ruleId === 'door-swing' && x.id === 'door-swing:door-s02' && x.itemIds.includes('cab-swing')), f.filter((x) => x.ruleId === 'door-swing').map((x) => x.id).join());
  // the approach zone is the true strip in front of the gap, not its bounding box: a piece beside the strip is not "in the way"
  const sides = RG.openingSides(door, 60);
  check('openingSides of an opening in a slant carry the exact zone (poly, 4 corners on the 60 cm strip)', sides.every((s) => s.poly && s.poly.length === 4) && near(K.area(sides[0].poly) ** 2, (80 * 60) ** 2, 1e-3));
  const beside = item({ id: 'cab-beside', x: mx - F2.nx * 30 + F2.ux * 95, y: my - F2.ny * 30 + F2.uy * 95, w: 40, d: 40, h: 80, rot: 315 });
  const bb = G.itemAABB(beside), zoneBox = sides.map((s) => s.rect);
  open(WPLAN, [beside]);
  f = runChecks({ store, plan: PLAN });
  check('a piece inside the bounding box of the approach zone but outside the zone is not flagged', zoneBox.some((r) => G.rectsOverlap(bb, r)) && !f.some((x) => x.ruleId === 'doorway-clear' && x.itemIds && x.itemIds.includes('cab-beside')));
  // window in s01: area = width × height (1.44 m²), the room's ratio, and its bearing from the wall's true normal
  open(WPLAN);
  f = runChecks({ store, plan: PLAN });
  const light = f.find((x) => x.id === `light-habitable:${east().id}`);
  const facing = RG.openingFacing(win, PLAN), want = ((Math.atan2(-F1.nx, F1.ny) / DEG) + 360) % 360;   // outside = 'l' = −n; bearing of −n
  check('window in s01: 1.20 × 1.20 m = 1.44 m² whatever its angle, ratio of the east room', light && /window area is 1\.44 m²/.test(light.detail) && light.detail.includes('7.0%'), light && light.detail.slice(0, 120));
  check('window in s01 faces the outdoor normal of s01 (bearing ≈ 117.1°, "south-east"), named in the finding', facing && near(facing.bearing, ((Math.atan2(F1.ny * -1 * 0 + -F1.nx, F1.ny) / DEG) + 360) % 360, 1e-6) && facing.name === 'south-east' && light.detail.includes('facing south-east'),
    facing && `${facing.bearing.toFixed(2)} ${facing.name} (−n bearing ${want.toFixed(2)})`);
  check('window-blocked: a tall cabinet right in front of the window in s01 is flagged', (() => {
    const [wx, wy] = SG.pointAt(S01, win.at), cab = item({ id: 'tall-win', x: wx + F1.nx * 45, y: wy + F1.ny * 45, w: 60, d: 50, h: 200, rot: (Math.atan2(F1.ux, -F1.uy) / DEG + 360) % 360 });
    open(WPLAN, [cab]);
    return runChecks({ store, plan: PLAN }).some((x) => x.ruleId === 'window-blocked' && x.id === 'window-blocked:win-s01' && x.itemIds.includes('tall-win'));
  })());
}

group('furniture against angled walls');
{
  // a 100 × 60 cabinet standing across s02 (its centre on the centre line)
  const [cx, cy] = SG.pointAt(S02, 60), across = item({ id: 'cab-across', x: cx, y: cy, w: 100, d: 60, h: 90, rot: 0 });
  open(WPLAN, [across]);
  let f = runChecks({ store, plan: PLAN });
  check('wallsHitByItem sees s02 (the slant record)', G.wallsHitByItem(across, PLAN).some((w) => w.id === 's02'));
  check('"Overlaps a wall" for furniture across s02', f.some((x) => x.id === 'item-in-wall:cab-across' && x.severity === 'fail'));
  // flush against s02's face, turned to it: not a hit (0.5 cm tolerance as for rect walls)
  const rot = 315, [fx, fy] = SG.pointAt(S02, 60), flush = item({ id: 'cab-flush', x: fx + F2.nx * (5 + 30), y: fy + F2.ny * (5 + 30), w: 100, d: 60, h: 90, rot });
  check('a cabinet flush with the face of s02 does not hit it', G.wallsHitByItem(flush, PLAN).length === 0, JSON.stringify(G.wallsHitByItem(flush, PLAN).map((w) => w.id)));
  check('a cabinet standing in the door gap of s02 does not hit the wall (openings are not walls)', G.wallsHitByItem(item({ id: 'g', x: SG.pointAt(S02, PLAN.openings.find((o) => o.id === 'door-s02').at)[0], y: SG.pointAt(S02, PLAN.openings.find((o) => o.id === 'door-s02').at)[1], w: 20, d: 8, rot: 315 }), PLAN).length === 0);
  // clearance in front of a wardrobe stops at the slant
  const xFace = (y) => { const p = [S01.x1 + F1.nx * 10, S01.y1 + F1.ny * 10]; return p[0] + ((y - p[1]) * F1.ux) / F1.uy; };
  const wy = 400, front = xFace(wy) - 120, ward = item({ id: 'ward', type: 'wardrobe', x: front - 30, y: wy, w: 100, d: 60, h: 220, rot: 270 });
  open(WPLAN, [ward]);
  f = runChecks({ store, plan: PLAN });
  const wc = f.find((x) => x.id === 'wardrobe-clearance:ward');
  // the wardrobe faces east at x 580; s01's inner face along its 100 cm front: nearest x over the front's y-range
  const wantD = Math.min(xFace(wy - 47), xFace(wy + 47)) - front;   // freeDepth insets the strip 3 cm at each end
  check('wardrobe in the east room: the free depth in front stops at the inner face of s01', wc && wc.title.includes(`${Math.round(wantD)} cm`), `${wc && wc.title} want ≈ ${wantD.toFixed(1)}`);
}

group('safe room with an angled wall');
{
  // a mamad in the NW corner closed by a 25 cm angled wall (kind 'mamad'), blast door in it opening out of the room
  const inp = input();
  inp.slants = [clone(S01), { id: 's02', x1: 25, y1: 420, x2: 420, y2: 25, t: 25, kind: 'mamad' }];
  inp.walls = inp.walls.map((w) => (w.id === 'w01' || w.id === 'w02' ? w : w));
  const mlen = Math.hypot(395, 395);
  inp.openings = inp.openings.map((o) => (o.id === 'door-s02' ? { ...o, style: 'mamad', at: mlen / 2, width: 80, hinge: 'a', swing: 'r' } : o));
  const plan = build(inp);
  const m = plan.rooms.find((r) => r.polygon.length === 3);
  m.type = 'mamad'; m.name = 'Safe room';
  open(plan);
  const sides = roomSides(PLAN, PLAN.rooms.find((r) => r.type === 'mamad'));
  const diag = sides.find((s) => s.walls.some((w) => w.slant));
  check('roomSides of the mamad: the angled side lists s02 with its true thickness 25 cm and the door', diag && diag.thickness === 25 && diag.walls[0].id === 's02' && diag.openings.some((o) => o.id === 'door-s02') && !diag.exterior,
    JSON.stringify(sides.map((s) => ({ dir: s.dir, t: s.thickness, w: s.walls.map((w) => w.id), o: s.openings.map((o) => o.id), ext: s.exterior }))));
  const f = runChecks({ store, plan: PLAN });
  const walls = f.find((x) => x.ruleId === 'mamad-walls'), door = f.find((x) => x.ruleId === 'mamad-door' && x.id === 'mamad-door:door-s02');
  const ext = f.find((x) => x.ruleId === 'mamad-ext-walls');
  check('mamad-walls reads the angled wall: 25 cm internal (≥ 20) next to the 20 cm exterior walls (< 25 → fail)', walls && /25 cm \(internal/.test(walls.detail), walls && walls.detail.slice(0, 200));
  check('mamad-ext-walls: two external walls (north, west), the angled one is internal', ext && ext.title === 'Safe room: 2 external walls', ext && ext.title);
  check('mamad-door: the blast door in the angled wall opens outwards (swing r = out of the triangle)', door && /opens outwards/.test(door.title), door && door.title);
  const clear = f.find((x) => x.ruleId === 'mamad-door-clear');
  check('mamad-door-clear measured straight out of the angled door (no wall within 1.10 m → not fail)', clear && clear.severity !== 'fail', clear && clear.title);
  // flip the swing: opens INTO the mamad
  const plan2 = clone(plan); plan2.openings.find((o) => o.id === 'door-s02').swing = 'l';
  open(plan2); PLAN.rooms.find((r) => r.polygon.length === 3).type = 'mamad';
  const d2 = runChecks({ store, plan: PLAN }).find((x) => x.ruleId === 'mamad-door' && x.id === 'mamad-door:door-s02');
  check('… swung the other way it opens INTO the mamad (fail)', d2 && /INTO the mamad/.test(d2.title) && d2.severity === 'fail', d2 && d2.title);
}

group('site: setbacks and coverage with the slanted exterior wall');
{
  const plan = clone(WPLAN);
  // a lot whose east line is 50 cm from the south end of s01's outer face … but 3 m from the house rectangle's corner
  plan.site = { ...plan.site, boundary: [[-300, -300], [1300, -300], [700, 1100], [-300, 1100]], setbacks: { w: 100, n: 100, e: 100, s: 100 } };
  open(plan);
  const f = runChecks({ store, plan: PLAN });
  const sb = f.find((x) => x.ruleId === 'setbacks');
  // true distance from the footprint polygons (rects + joined slants) to the east boundary edge
  const e = RG.segDist, edge = [[1300, -300], [700, 1100]];
  let want = Infinity;
  for (const poly of G.wallPolys(PLAN)) for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    want = Math.min(want, e(a[0], a[1], ...edge[0], ...edge[1]), e(edge[0][0], edge[0][1], a[0], a[1], b[0], b[1]), e(edge[1][0], edge[1][1], a[0], a[1], b[0], b[1]));
  }
  check('setbacks: the east distance is the true distance from the slanted wall polygon', sb && sb.detail.includes(`east ${(want / 100).toFixed(2)} m`), `${sb && sb.detail.slice(0, 160)} want ${(want / 100).toFixed(2)}`);
  // coverage from the polygons (union of walls, openings and rooms) feeds the garden rules
  const ctxCov = (await import('../src/regulations/interior.js')).buildContext({ store, plan: PLAN }).coverage;
  const fp = K.netArea(K.union([...PLAN.walls, ...G.slantPolys(PLAN), ...PLAN.rooms.map((r) => r.polygon), ...PLAN.openings.map((o) => G.openingPoly(o, PLAN))])) / 1e4;
  check('coverage of a one-level plan with angled walls = the polygon footprint (m²)', near(ctxCov, fp, 0.01), `${ctxCov} vs ${fp.toFixed(3)}`);
}

group('House 98 unchanged');
{
  open(H98PLAN, [], 'fixed');
  const before = JSON.stringify(PLAN.walls);
  check('House 98 has no slants; wallsHitByItem returns rect walls only (same objects)', !PLAN.slants && G.wallsHitByItem(item({ id: 'x', x: 10, y: 10, w: 40, d: 40 }), PLAN).every((w) => PLAN.walls.includes(w)) && JSON.stringify(PLAN.walls) === before);
}

// ───────────────────────── carpentry ─────────────────────────
group('carpentry: spans along angled walls');
open(WPLAN);
const segs = () => E.wallSegments(), segOf = (id) => segs().find((s) => s.id === 'seg:a:' + id);
/** seg.faces measures 0.5 cm outside the face, so it loses 0.5·cot(angle) at an acute corner. */
const faceLen = (seg, side, span) => { const [a, b] = seg.faces[side][0]; return b - a + ['left', 'right'].reduce((t, sd) => t + (span.corners && span.corners[sd] && span.corners[sd].angle < 90 ? 0.5 / Math.tan(span.corners[sd].angle * DEG) : 0), 0); };
{
  const [px, py] = SG.pointAt(S01, 200), sp = C.wallSpanAt(px + F1.nx * 30, py + F1.ny * 30);
  check('s01 inner face: the span runs along the slant (dir = its true direction), room = the east room', sp && near(sp.anchor.dir, (Math.atan2(-F1.nx, F1.ny) / DEG + 360) % 360, 1e-4) && sp.roomId === east().id, sp && `${sp.anchor.dir} ${sp.roomId}`);
  check('… its length = the free face length from seg.faces (r)', near(sp.length, faceLen(segOf('s01'), 'r', sp), 0.05), `${sp.length.toFixed(3)} vs ${faceLen(segOf('s01'), 'r', sp).toFixed(3)}`);
  check('… both ends at walls, the window in it at the right place (from = at − 60 along the face)', sp.ends.left === 'wall' && sp.ends.right === 'wall' && sp.openings.length === 1 && sp.openings[0].id === 'win-s01' && near(sp.openings[0].to - sp.openings[0].from, 120, 0.01));
  check('… corners: 62.9° (acute, north) and 117.1° (obtuse, south); inset for 60 cm = 60 / tan 62.9°', sp.corners && sp.corners.left.angle === 62.9 && sp.corners.right.angle === 117.1 && near(sp.corners.left.inset(60), 60 / Math.tan(62.85 * DEG), 0.1) && sp.corners.right.inset(60) === 0);
  for (const [side, sg] of [['r', 1], ['l', -1]]) {
    const [qx, qy] = SG.pointAt(S02, 60), s2 = C.wallSpanAt(qx + sg * F2.nx * 25, qy + sg * F2.ny * 25);
    check(`s02 face ${side}: length = seg.faces.${side}, the door breaks nothing but is listed`, s2 && near(s2.length, faceLen(segOf('s02'), side, s2), 0.15) && s2.openings.length === 1 && s2.openings[0].id === 'door-s02',
      s2 && `${s2.length.toFixed(3)} vs ${faceLen(segOf('s02'), side, s2).toFixed(3)}`);
  }
  // orthogonal spans in an orthogonal plan never get corners / the new keys
  open(H98PLAN, [], 'fixed');
  const h = C.wallSpanAt(300, 30);
  check('House 98 spans: no corners key, integer dir', h && !('corners' in h) && Number.isInteger(h.anchor.dir));
  open(WPLAN);
}

group('carpentry: a kitchen run on s01');
let kitchen;
{
  const [px, py] = SG.pointAt(S01, 300), x = px + F1.nx * 30, y = py + F1.ny * 30;
  const r = C.createRun({ kind: 'kitchen', x, y, units: [{ module: 'base-door', width: 60 }, { module: 'base-drawers', width: 60 }, { module: 'base-sink', width: 80 }] });
  check('createRun on the inner face of s01', r.ok, r.reason && r.reason.en);
  kitchen = r.runId;
  const { run, units } = C.getRun(kitchen), sp = C.spanOfRun(run);
  const corner = sp.corners.left.inset(60);
  check('the run stays back from the acute north corner by 60 / tan 62.9° so the units clear the north wall', near(sp.runFrom, corner, 0.1) && run.ends.left.type === 'wall' && run.ends.left.angle === 62.9, `${sp.runFrom} vs ${corner}`);
  check('… and runs to the obtuse south corner (the window inside the run: a base run may pass under it)', near(sp.runTo, sp.length, 0.1) && run.ends.right.type === 'wall', `${sp.runTo} / ${sp.length}`);
  check('run name "Kitchen — angled wall"', run.name === 'Kitchen — angled wall');
  const dir = run.anchor.dir;
  check('units laid along the wall: rot = the face direction, backs on the face, consecutive along it', units.every((u) => u.rot === dir) && units.every((u) => {
    const back = G.itemLocalToPlan(u, 0, -u.d / 2);
    return near(SG.offsetOf(S01, back[0], back[1]), 10, 0.15);
  }) && units.every((u, i) => i === 0 || near(Math.hypot(u.x - units[i - 1].x, u.y - units[i - 1].y), (u.w + units[i - 1].w) / 2, 0.05)), units.map((u) => `${u.x},${u.y} r${u.rot}`).join(' '));
  check('no unit cuts into a wall (wallsHitByItem)', units.every((u) => G.wallsHitByItem(u, PLAN).length === 0), units.map((u) => G.wallsHitByItem(u, PLAN).map((w) => w.id).join('/')).join(' '));
  // the window in s01 constrains wall / tall units as on a rect wall
  const win = sp.openings[0], atWin = win.from - sp.runFrom + 10;
  let a = C.addUnit(kitchen, 'wall-door', { width: 60, offset: atWin });
  check('a wall unit over the window: allowed, then reported (window-wall)', a.ok && C.checkRun(kitchen).some((f) => f.code === 'window-wall'), a.reason && a.reason.en);
  C.removeUnit(a.unitId);
  // tall unit over the window: place one tall at the window by filling the floor row up to it
  const fillTo = win.from - sp.runFrom - 1;
  const used = units.reduce((t, u) => t + u.carp.width, 0);
  C.addUnit(kitchen, 'base-door', { width: Math.max(30, Math.min(120, fillTo - used - 30)) });
  const before = JSON.stringify(store.carpentry);
  a = C.addUnit(kitchen, 'tall-pantry', { width: 60 });
  const covers = C.getRun(kitchen).units;
  check('a tall unit across the window in s01 is refused (window-tall), nothing changed', !a.ok ? /cannot cover the window win-s01/.test(a.reason.en) && JSON.stringify(store.carpentry) === before : false, a.ok ? `ok at ${covers.map((u) => u.carp.at).join()}` : a.reason.en);
  // corner units at the angled corner are refused with the reason
  const b4 = JSON.stringify(store.carpentry);
  a = C.addUnit(kitchen, 'base-corner-blind', { index: 0 });
  check('a corner unit at the 62.9° corner is refused with the reason; nothing changed', !a.ok && /needs a square \(90°\) corner/.test(a.reason.en) && /62\.9°/.test(a.reason.en) && a.reason.he && JSON.stringify(store.carpentry) === b4, a.reason && a.reason.en);
  const fs = C.checkRun(kitchen);
  check('checks: corner-angle notes for both ends (scribed filler), no false aisle at the acute corner', fs.filter((f) => f.code === 'corner-angle' && f.severity === 'info').length === 2 && !fs.some((f) => f.code === 'aisle' && f.severity === 'error'), fs.map((f) => f.code + ':' + f.severity).join(' '));
}

group('carpentry: aisle measured perpendicular to the angled run');
{
  // a cabinet opposite the middle of the run, 95 cm in front of the units, turned to face it
  const { run, units } = C.getRun(kitchen), u = units[1], dir = run.anchor.dir, f = C.frame(dir);
  const [fx, fy] = C.toPlan(run.anchor, u.carp.at + u.carp.width / 2, 60 + 95 + 25);
  store.addItem(item({ id: 'opp', name: 'Sideboard', x: fx, y: fy, w: 120, d: 50, h: 85, rot: (dir + 180) % 360 }));
  const fs = C.checkRun(kitchen), aisle = fs.find((x) => x.code === 'aisle');
  check('aisle: 95 cm to the sideboard opposite (perpendicular to the run) → warning (< 100? no: ≥ 90 → none) … measured', !aisle || aisle.text.en.includes('Sideboard'), aisle && aisle.text.en);
  const d = C.runContext(run).list;
  void d; void f;
  // move it closer: 70 cm → an aisle error / warning naming it
  store.removeItems && store.removeItems(['opp']);
  const [gx, gy] = C.toPlan(run.anchor, u.carp.at + u.carp.width / 2, 60 + 70 + 25);
  store.addItem(item({ id: 'opp2', name: 'Sideboard', x: gx, y: gy, w: 120, d: 50, h: 85, rot: (dir + 180) % 360 }));
  const a2 = C.checkRun(kitchen).find((x) => x.code === 'aisle');
  const m = a2 && /Only ([\d.]+) cm/.exec(a2.text.en);
  check('aisle: a sideboard 70 cm in front (perpendicular) → "Only 70 cm … (to Sideboard)"', a2 && m && near(+m[1], 70, 1.5) && a2.text.en.includes('Sideboard'), a2 && a2.text.en);
  store.removeItems && store.removeItems(['opp2']);
}

group('carpentry: s02 and an orthogonal run at the angled corner');
{
  // a shelving run on the NW-triangle face of s02, left of the door
  const s2 = C.wallSpanAt(...(() => { const [x, y] = SG.pointAt(S02, 300); return [x - F2.nx * 25, y - F2.ny * 25]; })());
  const [ax, ay] = SG.pointAt(S02, 300);
  const r = C.createRun({ kind: 'shelving', x: ax - F2.nx * 25, y: ay - F2.ny * 25, units: [{ module: 'shelf', width: 60 }] });
  check('createRun on s02 (NW-triangle face) between the corner and the door', r.ok && near(C.getRun(r.runId).run.anchor.dir, 135, 1e-6), r.reason && r.reason.en);
  const sp = r.ok && C.spanOfRun(C.getRun(r.runId).run);
  check('… its stretch ends at the door (a floor run cannot cross it) and stays back from the 45° corner', sp && s2 && sp.runTo <= s2.openings[0].from + 0.01 && sp.runFrom > 0, sp && `${sp.runFrom} – ${sp.runTo}`);
  // the wardrobe on the north wall of the NW triangle: the 45° corner with s02 at its east end
  const w = C.createRun({ kind: 'wardrobe', x: 120, y: 40 });
  const wr = w.ok && C.getRun(w.runId).run, L = 325 - 5 * Math.SQRT2 - 40;
  check('an orthogonal run ending at the angled corner: shortened by depth / tan 45° (60 cm), end type wall with angle 45', wr && wr.anchor.dir === 0 && near(wr.length, L - 60, 0.15) && wr.ends.right.type === 'wall' && wr.ends.right.angle === 45, wr && `${wr.length} ${JSON.stringify(wr.ends)}`);
  // a corner pantry there is refused too
  const cp = w.ok && C.addUnit(w.runId, 'tall-corner-pantry', {});
  check('a corner pantry at the 45° end is refused with the reason (or not offered for this kind)', cp && (!cp.ok), cp && cp.reason && cp.reason.en);
}

group('carpentry: drawings, take-off, estimate, document');
{
  const { run } = C.getRun(kitchen);
  const d = C.drawings(kitchen);
  check('drawings compose: plan, elevation, section, worktop', ['plan', 'elevation', 'section', 'worktop'].every((k) => d.some((x) => x.kind === k)), d.map((x) => x.kind).join());
  const plan = d.find((x) => x.kind === 'plan'), walls = plan.ops.filter((o) => o.role === 'wall');
  // the plan drawing is in the run frame: s01 is horizontal there, the north wall comes in at the true 62.9° angle
  const local = (x, y) => { const [a, dd] = C.toLocal(run.anchor, x, y); return [a, -dd]; };
  const nwEdge = [local(973.63, 20), local(510, 20)], ang = Math.abs(Math.atan2(nwEdge[1][1] - nwEdge[0][1], nwEdge[1][0] - nwEdge[0][0]) / DEG);
  const hasAngle = walls.some((o) => o.t === 'poly' && o.pts.some((p, i) => { const q = o.pts[(i + 1) % o.pts.length], a = Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0]) / DEG); return near(a, ang, 0.6) || near(a, 180 - ang, 0.6); }));
  check('plan drawing: walls as polygons; the north wall shows at its true angle to the run (≈ 62.9°)', walls.length > 0 && walls.every((o) => o.t === 'poly') && hasAngle, `${walls.length} walls, want ${ang.toFixed(1)}°`);
  const slantPiece = walls.some((o) => o.pts.every(([, y]) => y >= -0.2 && y <= 25));
  check('plan drawing: s01 itself lies along the top of the drawing (wall at y 0 … 20, cut)', slantPiece);
  const el = d.find((x) => x.kind === 'elevation');
  check('elevation: the window in s01 drawn behind (W 120/120)', el.ops.some((o) => o.t === 'text' && /W 120\/120/.test(typeof o.text === 'string' ? o.text : o.text.en || '')), el.ops.filter((o) => o.t === 'text').map((o) => (typeof o.text === 'string' ? o.text : o.text.en)).slice(0, 12).join('|'));
  const to = C.takeoff('all'), est = C.estimate('all', { tier: 'mid', pricebook: (await import('../src/carpentry/pricebook.js')).default });
  check('take-off and estimate keep their structure (runs, totals)', Array.isArray(to.runs) && to.runs.some((r) => r.runId === kitchen) && to.totals && est && Array.isArray(est.runs) && est.runs.some((r) => r.runId === kitchen), est && JSON.stringify(est.total));
  const PB = (await import('../src/carpentry/pricebook.js')).default;
  const doc = composeQuotation({ lang: 'en', runIds: 'all', paper: 'A4', project: { name: 'Wedge' }, src: { store, plan: PLAN }, pricebook: PB });
  check('quotation document composes with the angled run (pages, key plan with the angled walls)', doc && doc.pages && doc.pages.length > 0 && doc.pages[0].ops.some((o) => o.role === 'wall' && o.t === 'poly'), doc && `${doc.pages && doc.pages.length} pages`);
}

group('carpentry: islands and moveRunToLevel unaffected');
{
  const isl = C.createRun({ kind: 'island', x: 750, y: 400, rot: 0, length: 120, units: [{ module: 'island', width: 120 }] });
  check('an island in the east room can be created', isl.ok, isl.reason && isl.reason.en);
  const mv = C.moveRun(isl.runId, { dx: 200 });
  check('moving the island into s01 is refused (it would leave its room / run into the wall)', !mv.ok, mv.reason && mv.reason.en);
  // the slant test itself (wallsHitByItem through the island placement): a unit footprint across s01
  const [sx, sy] = SG.pointAt(S01, 400);
  check('an island footprint across s01 hits it (the placement test it uses)', G.wallsHitByItem(item({ id: 'i', x: sx, y: sy, w: 120, d: 60, rot: 0 }), PLAN).some((w) => w.id === 's01'));
}

// ───────────────────────── walk ─────────────────────────
group('walk: angled walls block, doors in them pass');
open(WPLAN);
function makeWalker() {
  const dom = { addEventListener() {}, removeEventListener() {}, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  const walk = createWalk({ camera: new THREE.PerspectiveCamera(), dom, overlay: { append() {} }, ctx: { store, plan: PLAN, models: {} }, pickTarget: () => null, emit() {}, requestExit() {} });
  const held = new Set();
  const key = (type, code) => { for (const f of listeners[type] || []) f({ code, target: { tagName: 'CANVAS' }, preventDefault() {}, ctrlKey: false, metaKey: false, altKey: false }); };
  const hold = (...codes) => { for (const c of [...held]) if (!codes.includes(c)) { key('keyup', c); held.delete(c); } for (const c of codes) if (!held.has(c)) { key('keydown', c); held.add(c); } };
  const DT = 1 / 60, step = (n = 1) => { for (let i = 0; i < n; i++) { NOW += DT * 1000; walk.update(DT); } };
  const pos = () => walk.getState();
  const run = (codes, s, each) => { hold(...codes); for (let i = 0; i < s * 60; i++) { step(); if (each) each(pos()); } hold(); };
  return { walk, step, pos, run, hold };
}
const R = WALKER_RADIUS * 100;
{
  const W = makeWalker(), { walk } = W;
  // from the east room straight at s01 (heading east)
  const [mx, my] = SG.pointAt(S01, 250), startX = mx + F1.nx * 150, startY = my + F1.ny * 150;
  walk.start({ x: startX, y: startY, heading: 90, pointerLock: false });
  let minOff = Infinity;
  W.run(['KeyW'], 1.2, (p) => { minOff = Math.min(minOff, SG.offsetOf(S01, p.x, p.y)); });
  const p = W.pos();
  check('walking east into s01: stopped at the inner face (centre ≥ radius + half thickness from the centre line)', minOff >= 10 + R - 0.6 && SG.sideOf(S01, p.x, p.y) === 'r', `min offset ${minOff.toFixed(2)} (need ${(10 + R).toFixed(1)})`);
  // keep pushing east: the walker slides along the slant (east into a wall running NE → SW: it drifts north-east) smoothly
  const ys = [], offs = [];
  W.run(['KeyW'], 2, (q) => { ys.push(q.y); offs.push(SG.offsetOf(S01, q.x, q.y)); });
  let mono = true, maxStep = 0;
  for (let i = 1; i < ys.length; i++) { if (ys[i] > ys[i - 1] + 1e-6) mono = false; maxStep = Math.max(maxStep, ys[i - 1] - ys[i]); }
  check('pushing east into s01 slides along it (north, steadily: no sticking, no jumps), staying on its face', mono && ys[0] - ys.at(-1) > 50 && maxStep < 3 && offs.every((o) => o >= 10 + R - 0.6 && o < 10 + R + 2),
    `Δy ${(ys.at(-1) - ys[0]).toFixed(1)} max step ${maxStep.toFixed(2)} off ${Math.min(...offs).toFixed(2)}–${Math.max(...offs).toFixed(2)}`);
  // slide all the way down to the obtuse south corner and up to the acute north corner: no sticking at the joints
  walk.teleport(...SG.pointAt(S01, 120).map((v, i) => v + [F1.nx, F1.ny][i] * (10 + R + 2)), (Math.atan2(F1.ux, -F1.uy) / DEG + 360) % 360);   // heading along s01 (to the south-west)
  const trace = [];
  W.run(['KeyW'], 8, (q) => trace.push(q));
  const end = trace.at(-1), along = SG.atOf(S01, end.x, end.y);
  check('walking along s01 from the north end reaches the south corner (along ≥ 800 cm), never closer than the radius', along > 790 && trace.every((q) => SG.offsetOf(S01, q.x, q.y) >= 10 + R - 0.6), `along ${along.toFixed(1)} off ${Math.min(...trace.map((q) => SG.offsetOf(S01, q.x, q.y))).toFixed(2)}`);
  // through the door in s02 (west room → NW triangle), but not through the wall beside it
  const door = PLAN.openings.find((o) => o.id === 'door-s02'), [dx, dy] = SG.pointAt(S02, door.at);
  walk.teleport(dx + F2.nx * 80, dy + F2.ny * 80, 315);                     // in the west room, facing north-west (across s02)
  W.run(['KeyW'], 3);
  const q = W.pos();
  check('through the door in s02: from the west room into the NW triangle', SG.sideOf(S02, q.x, q.y) === 'l' && G.pointInPolygon(q.x, q.y, nwTri().polygon), `(${q.x.toFixed(1)}, ${q.y.toFixed(1)})`);
  const [wx, wy] = SG.pointAt(S02, 100);
  walk.teleport(wx + F2.nx * 80, wy + F2.ny * 80, 315);
  let crossed = false;
  W.run(['KeyW'], 3, (p2) => { if (SG.sideOf(S02, p2.x, p2.y) === 'l' || Math.abs(SG.offsetOf(S02, p2.x, p2.y)) < 5 + R - 0.6) crossed = true; });
  check('… but not through s02 beside the door', !crossed);
  // the window in s01 blocks
  const win = PLAN.openings.find((o) => o.id === 'win-s01'), [vx, vy] = SG.pointAt(S01, win.at);
  walk.teleport(vx + F1.nx * 80, vy + F1.ny * 80, (Math.atan2(-F1.nx, F1.ny) / DEG + 180 + 360) % 360);   // facing the window
  let out = false;
  W.run(['KeyW'], 3, (p2) => { if (SG.sideOf(S01, p2.x, p2.y) === 'l') out = true; });
  check('the window in s01 blocks', !out);
  // defaultWalkStart: inside the house, in a room, clear of every wall
  const st = defaultWalkStart(PLAN);
  check('defaultWalkStart on the Wedge: inside a room, not in a wall', PLAN.rooms.some((r) => G.pointInPolygon(st.x, st.y, r.polygon)) && !G.inWallOrOpening(st.x, st.y, PLAN), JSON.stringify(st));
  // a Wedge with its entrance in s01 (a door in a slant): start just inside it, facing in
  const inp = input();
  inp.openings = inp.openings.filter((o) => o.id !== 'door-entry' && o.id !== 'win-s01').concat([{ id: 'door-entry', kind: 'door', style: 'entry', wall: 's01', axis: 'a', at: 500, width: 90, height: 210, sill: 0, hinge: 'a', swing: 'r' }]);
  const p2 = build(inp);
  open(p2);
  const st2 = defaultWalkStart(PLAN);
  check('defaultWalkStart with the entrance in an angled wall: inside, on the room side, facing into the room', G.pointInPolygon(st2.x, st2.y, east().polygon) && Math.abs(((st2.heading - (Math.atan2(F1.nx, -F1.ny) / DEG)) % 360 + 540) % 360 - 180) < 1,
    `${JSON.stringify(st2)} want heading ${((Math.atan2(F1.nx, -F1.ny) / DEG + 360) % 360).toFixed(1)}`);
}

console.log(`\nslants-rules: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
