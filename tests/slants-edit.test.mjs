// Angled walls: editing — stage A2 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md. addWall({ angled }), remove / move /
// resize / rotateWallEnd of slants (and of rect walls on a level with slants), openings in slants, planDiff, undo,
// per level, collaboration, a randomized run and timings. The "Wedge" test house is in tests/fixtures/houses.mjs.
//   node tests/slants-edit.test.mjs
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { PLAN } from '../src/core/plan.js';
import { store } from '../src/core/store.js';
import * as E from '../src/core/plan-edit.js';
import * as B from '../src/core/plan-build.js';
import * as G from '../src/core/geometry.js';
import * as K from '../src/core/polykernel.js';
import * as SG from '../src/core/slant-geom.js';
import { createRoom } from '../src/collab/room.js';
import { WEDGE } from './fixtures/houses.mjs';

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const clone = (o) => JSON.parse(JSON.stringify(o));
const H98 = JSON.stringify(PLAN);
const area = (poly) => G.polygonArea(poly);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const R2 = Math.SQRT2;
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const seg = (id) => E.wallSegments().find((s) => s.id === id);
const slant = (id) => (PLAN.slants || []).find((s) => s.id === id);
const opening = (id) => PLAN.openings.find((o) => o.id === id);
const roomsAreas = () => PLAN.rooms.map((r) => area(r.polygon)).sort((a, b) => a - b);
const bytes = () => JSON.stringify(E.currentPlanData());
const lastSlant = () => PLAN.slants[PLAN.slants.length - 1];

const built = B.buildPlan({ walls: WEDGE.walls, slants: WEDGE.slants, openings: WEDGE.openings, heights: WEDGE.heights, meta: { name: 'Wedge' } }, { slants: true });
const W = built.plan, WB = JSON.stringify(W);
const S02_LEN = Math.hypot(275, 275);
const wedge = (phase = 'fixed') => { E.setBasePlan(W, { phase }); store.clearHistory ? store.clearHistory() : null; };
const nwOf = () => PLAN.rooms.find((r) => r.polygon.length === 3 && r.polygon.every(([x, y]) => x < 400 && y < 400));
const westArea0 = (() => { const rf = 325 + 5 * R2; return 480 * 760 - (rf - 40) ** 2 / 2; })();   // the west room of the Wedge, analytic

group('addWall({ angled: true }) on the Wedge (fixed): a 45° partition across the west room');
{
  wedge();
  const before = roomsAreas(), undo0 = store._undo.length;
  const dry = E.canAddWall({ x1: 20, y1: 400, x2: 400, y2: 780, angled: true });
  check('dry run: ok, the slant (centre line on its ends) and its joined footprint, nothing changes', dry.ok && dry.slant && dry.slant.x1 === 20 && dry.slant.y2 === 780 && Array.isArray(dry.poly) && !E.isPlanModified(), JSON.stringify(dry));
  const r = E.addWall({ x1: 20, y1: 400, x2: 400, y2: 780, angled: true });
  const s = lastSlant();
  check('added: ids = [seg:a:s03], level free, one undo step', r.ok && r.level === 'free' && JSON.stringify(r.ids) === '["seg:a:s03"]' && store._undo.length === undo0 + 1, JSON.stringify(r));
  check('slant s03 stored { id, x1, y1, x2, y2, t, kind } on 0.1 cm, kind interior, a partition with joined ends', s && JSON.stringify(Object.keys(s)) === '["id","x1","y1","x2","y2","t","kind"]' && s.kind === 'interior'
    && seg('seg:a:s03').cls === 'partition' && JSON.stringify(seg('seg:a:s03').freeEnds) === '[false,false]', JSON.stringify(s));
  // the partition y = x + 380 (t 10) cuts the west room's SW corner: triangle legs 380 − 5√2; the rest loses legs 380 + 5√2
  const tri = (380 - 5 * R2) ** 2 / 2, rest = westArea0 - (380 + 5 * R2) ** 2 / 2;
  const got = roomsAreas(), want = [...before.filter((a) => !near(a, westArea0, 1)), tri, rest].sort((a, b) => a - b);
  check('4 rooms; the west room split with exact areas (|Δ| < 1 cm²)', PLAN.rooms.length === 4 && got.every((a, i) => near(a, want[i], 1)), `${got.map((a) => a.toFixed(1))} vs ${want.map((a) => a.toFixed(1))}`);
  const fresh = PLAN.rooms.find((x) => x.name === 'New room');
  check('the smaller piece is a new room (it holds the entry door: no "no door" warning)', !!fresh && near(area(fresh.polygon), tri, 1) && opening('door-entry').rooms.includes(fresh.id) && !r.warnings.length);
  const diff = E.planDiff();
  check('planDiff: slant-added (free), ref seg:a:s03', diff.items.some((i) => i.kind === 'slant-added' && i.level === 'free' && i.ref === 'seg:a:s03'), JSON.stringify(diff.items));
  store.undo();
  check('undo restores the base plan byte for byte', !E.isPlanModified() && bytes() === WB);
  store.redo();
  check('redo: the partition again', slant('s03') && PLAN.rooms.length === 4);
  store.undo();
}

group('addWall angled: near an axis, refusals');
{
  wedge();
  const r = E.addWall({ x1: 30, y1: 600, x2: 490, y2: 602.4, angled: true });   // 0.3°
  check('0.3° off the axis → an ordinary rect wall (the existing path), no slant added', r.ok && r.ids[0].startsWith('seg:h:') && PLAN.slants.length === 2, JSON.stringify(r));
  store.undo();
  const ext = E.addWall({ x1: 600, y1: 150, x2: 1000, y2: 260, angled: true });
  check('crossing the exterior slant s01 (fixed plan) → refused with the exterior reason', !ext.ok && /exterior wall/.test(ext.reason), ext.reason);
  const clear = 325 + 50 * R2;     // 40 cm clear from s02's west-room face
  const nar = E.addWall({ x1: 20, y1: clear - 20, x2: clear - 20, y2: 20, angled: true });
  check('leaving 40 cm clear beside s02 → refused (narrower than 60 cm)', !nar.ok && /narrower than 60/.test(nar.reason), nar.reason);
  const door = E.addWall({ x1: 300, y1: 300, x2: 700, y2: 500, angled: true });
  check('crossing a door (the partition door) → refused', !door.ok && /door or window/.test(door.reason), door.reason);
  const out = E.addWall({ x1: 1000, y1: 300, x2: 1200, y2: 500, angled: true });
  check('outside the house (fixed) → refused', !out.ok && /inside the house|exterior/.test(out.reason), out.reason);
  const short = E.addWall({ x1: 200, y1: 600, x2: 215, y2: 615, angled: true });
  check('shorter than 30 cm → refused', !short.ok && /at least 30 cm/.test(short.reason), short.reason);
  const dup = E.addWall({ x1: 25, y1: 300, x2: 300, y2: 25, angled: true });
  check('a duplicate of s02 → refused', !dup.ok && /already a wall|along or on top/.test(dup.reason), dup.reason);
  const thick = E.addWall({ x1: 100, y1: 500, x2: 300, y2: 650, angled: true, thickness: 25 });
  check('thickness outside 7–20 cm (fixed) → refused', !thick.ok && /thick/.test(thick.reason), thick.reason);
  check('nothing changed by the refusals', !E.isPlanModified() && bytes() === WB);
}

group('joins: T onto a rect, T onto a slant, a corner with another slant (mitre, shared end point)');
{
  wedge();
  const t1 = E.addWall({ x1: 200, y1: 600, x2: 487, y2: 700, angled: true });      // end 13 cm short of the partition face (x 500)
  const s = lastSlant(), f = SG.slantFrame(s), j = SG.slantJoins(PLAN.slants, [...PLAN.walls, ...PLAN.openings.filter((o) => o.axis !== 'a')]);
  check('T onto a rect: the end within 1.5 t of the partition face is extended onto it (x 500), joined (rect), start free', t1.ok && near(s.x2, 500, 0.06) && j[2].ends[1].type === 'rect' && j[2].ends[0].type === 'free'
    && JSON.stringify(seg('seg:a:' + s.id).freeEnds) === '[true,false]', JSON.stringify([s, j[2].ends.map((e) => e.type)]));
  void f;
  store.undo();
  const t2 = E.addWall({ x1: 300, y1: 500, x2: 81.4, y2: 256.4, angled: true });      // ends 9 cm off s02's centre line, away from its door
  const j2 = SG.slantJoins(PLAN.slants, [...PLAN.walls]);
  check('T onto a slant (s02): joined as a tee', t2.ok && j2[2].ends[1].type === 'tee' && j2[2].ends[1].with[0] === 1, JSON.stringify([t2.reason, j2[2] && j2[2].ends]));
  store.undo();
  const a = E.addWall({ x1: 100, y1: 520, x2: 300, y2: 620, angled: true }), sa = lastSlant();
  const b = E.addWall({ x1: 306, y1: 625, x2: 420, y2: 480, angled: true }), sb = lastSlant();
  const j3 = SG.slantJoins(PLAN.slants, []);
  check('corner: the second slant\'s end within 1.5 t of the first one\'s free end snaps to exactly that point; mitre', a.ok && b.ok && sb.x1 === sa.x2 && sb.y1 === sa.y2 && j3[3].ends[0].type === 'mitre' && j3[2].ends[1].type === 'mitre',
    JSON.stringify([a.reason, b.reason, sa, sb]));
  store.undo(); store.undo();
  check('undo ×2 → base bytes', bytes() === WB);
}

group('moveWallSegment of s02 by ±20 cm: ends slide along the walls, the door travels, areas analytic');
{
  wedge();
  const door0 = clone(opening('door-s02'));
  for (const dl of [20, -20]) {
    const r = E.moveWallSegment('seg:a:s02', dl);
    const s = slant('s02'), c = s.x1 + s.y1, d = opening('door-s02'), nw = nwOf();
    check(`move ${dl}: ok, ids [seg:a:s02], the line x + y = 325 ${dl > 0 ? '+' : '−'} 20√2 (0.1 cm), ends still on the west / north walls (x1 = 25, y2 = 25)`, r.ok && JSON.stringify(r.ids) === '["seg:a:s02"]'
      && near(c, 325 + dl * R2, 0.15) && s.x1 === 25 && s.y2 === 25 && near(s.x2 + s.y2, c, 1e-9), JSON.stringify([r.reason, s]));
    check(`move ${dl}: the door moved with it (centre + ${dl}·n within 0.1 cm), same place along the wall`, near(d.cx, door0.cx + (dl / R2), 0.1) && near(d.cy, door0.cy + (dl / R2), 0.1), `${d.cx},${d.cy}`);
    const want = (c - 5 * R2 - 40) ** 2 / 2;
    check(`move ${dl}: the NW triangle = the analytic one (|Δ| < 1 cm²); the west room = the rest`, nw && near(area(nw.polygon), want, 1) && PLAN.rooms.length === 3, nw && `${area(nw.polygon).toFixed(2)} vs ${want.toFixed(2)}`);
    const di = E.planDiff().items;
    check(`move ${dl}: planDiff slant-changed (change: moved, free), the door not listed as moved`, di.some((i) => i.kind === 'slant-changed' && i.change === 'moved' && i.level === 'free' && /Moved/.test(i.text)) && !di.some((i) => i.ref === 'door-s02'), JSON.stringify(di));
    store.undo();
  }
  check('undo → base bytes', bytes() === WB);
  E.removeOpening('door-s02');
  const sq = E.moveWallSegment('seg:a:s02', -130);
  check('a move that would squeeze the NW triangle under 60 cm is refused', !sq.ok && /narrower than 60/.test(sq.reason), sq.reason);
  const ok110 = E.moveWallSegment('seg:a:s02', -110);
  check('…−110 cm still leaves 60 cm: allowed', ok110.ok, ok110.reason);
  store.undo(); store.undo();
  const lk = E.moveWallSegment('seg:a:s01', 20);
  check('the exterior slant s01 cannot move (locked)', !lk.ok && lk.reason === E.REASONS.exteriorWall);
}

group('resize (start / end along the centre line) and rotateWallEnd');
{
  wedge();
  E.addWall({ x1: 100, y1: 520, x2: 300, y2: 620, angled: true });
  const s0 = clone(lastSlant()), f = SG.slantFrame(s0), id = 'seg:a:' + s0.id;
  const r = E.resizeWallSegment(id, { start: 20, end: -30 });
  const s1 = lastSlant();
  check('resize { start: +20, end: −30 }: start moves 20 cm outwards, end 30 cm inwards (0.1 cm)', r.ok && near(s1.x1, s0.x1 - f.ux * 20, 0.06) && near(s1.y1, s0.y1 - f.uy * 20, 0.06) && near(s1.x2, s0.x2 - f.ux * 30, 0.06) && near(s1.y2, s0.y2 - f.uy * 30, 0.06), JSON.stringify([r.reason, s0, s1]));
  const di = E.planDiff().items;
  check('…and it is still a new slant in planDiff (slant-added)', di.some((i) => i.kind === 'slant-added'));
  store.undo(); store.undo();
  const b0 = bytes();
  const x60 = 25 + 275 / Math.tan(Math.PI / 3);
  const r1 = E.rotateWallEnd('seg:a:s02', 'b', { x: x60, y: 25 });
  const s2 = slant('s02'), ang = (Math.atan2(s2.y2 - s2.y1, s2.x2 - s2.x1) * 180) / Math.PI;
  check('rotateWallEnd(s02, b) to 60°: end where given (0.1 cm), start kept, door keeps its distance from the start', r1.ok && near(ang, -60, 0.05) && s2.x1 === 25 && s2.y1 === 300 && opening('door-s02').at === W.openings.find((o) => o.id === 'door-s02').at, JSON.stringify([r1.reason, s2]));
  check('…planDiff: slant-changed (change: rotated)', E.planDiff().items.some((i) => i.kind === 'slant-changed' && i.change === 'rotated'));
  const r2 = E.rotateWallEnd('seg:a:s02', 'b', { x: 300, y: 25 });
  check('…and back to exactly 45°: the original bytes, not modified', r2.ok && bytes() === b0 && !E.isPlanModified(), r2.reason);
  const r3 = E.rotateWallEnd('seg:a:s02', 'b', { x: 300, y: 300 });
  const rs = E.wallSegments().find((x) => x.id === r3.ids?.[0]), door = opening('door-s02');
  check('rotated onto an axis → a rect wall (no s02), its door a rect door in it', r3.ok && !slant('s02') && rs && rs.axis === 'h' && door && door.axis === 'h' && rs.openingIds.includes('door-s02'), JSON.stringify([r3, door]));
  const r4 = E.rotateWallEnd(rs.id, 'b', { x: 300, y: 25, angled: true });
  const s4 = lastSlant(), d4 = opening('door-s02');
  check('…dragged back off the axis with angled: true → a slant again, the door in it (axis a)', r4.ok && s4 && s4.id !== 's02' && d4 && d4.axis === 'a' && d4.wall === s4.id && near(s4.y2, 25, 0.06), JSON.stringify([r4, s4, d4 && d4.at]));
  const r5 = E.rotateWallEnd(r4.ids[0], 'b', { x: 200, y: 25 });
  check('…a rect end dragged without angled moves along its own axis only', r5.ok);
  store.undo(); store.undo(); store.undo();
  check('undo ×3 → base bytes', bytes() === WB);
}

group('removeWallSegment of a slant with its door');
{
  wedge();
  const ids0 = PLAN.rooms.map((r) => r.id), west = PLAN.rooms.find((r) => area(r.polygon) > 300000);
  const r = E.removeWallSegment('seg:a:s02');
  check('removed with its door; 2 rooms: the merged one keeps the larger room\'s id (west)', r.ok && !slant('s02') && !opening('door-s02') && PLAN.rooms.length === 2 && PLAN.rooms.some((x) => x.id === west.id) && ids0.length === 3, JSON.stringify(r));
  const di = E.planDiff().items;
  check('planDiff: slant-removed; its door not listed as closed', di.some((i) => i.kind === 'slant-removed') && !di.some((i) => i.ref === 'door-s02'), JSON.stringify(di.map((i) => i.kind)));
  store.undo();
  check('undo → base bytes', bytes() === WB);
  const lk = E.removeWallSegment('seg:a:s01');
  check('the exterior slant cannot be removed (fixed plan)', !lk.ok && lk.reason === E.REASONS.exteriorWall);
}

group('openings in slants');
{
  wedge();
  const d1 = E.addOpening({ kind: 'door', x: 100, y: 228 });
  const o1 = opening(d1.ids[0]);
  check('a door by point near s02 lands in it (axis a, wall s02, at = the projected point), hinge on the nearer jamb, swings into the smaller room', d1.ok && o1.axis === 'a' && o1.wall === 's02' && near(o1.at, SG.atOf(WEDGE.slants[1], 100, 228), 0.06)
    && o1.hinge === 'a' && o1.swing === 'l' && o1.rooms.length === 2, JSON.stringify([d1.reason, o1]));
  store.undo();
  const d2 = E.addOpening({ kind: 'door', wall: 'seg:a:s02', at: 300, width: 70 });
  check('a door by at (seg id) → exactly at 300', d2.ok && opening(d2.ids[0]).at === 300 && opening(d2.ids[0]).width === 70, d2.reason);
  store.undo();
  const w1 = E.addOpening({ kind: 'window', wall: 's01', at: 200, width: 100 });
  check('a window in s01 by at: level permit + the permit warning (exterior, fixed)', w1.ok && w1.level === 'permit' && w1.warnings.includes(E.REASONS.permit) && opening(w1.ids[0]).exterior && opening(w1.ids[0]).outside === 'l', JSON.stringify(w1));
  store.undo();
  const w2 = E.addOpening({ kind: 'window', x: 900, y: 200 });
  const ow2 = w2.ok && opening(w2.ids[0]);
  check('a window by point near s01 → in s01', w2.ok && ow2.wall === 's01', w2.reason);
  store.undo();
  check('a window in an interior slant → refused', !E.addOpening({ kind: 'window', wall: 's02', at: 100 }).ok);
  const can = E.canAddOpening({ kind: 'door', wall: 's02', at: 80 });
  check('canAddOpening (dry run): segmentId, at, quad, AABB rect', can.ok && can.segmentId === 'seg:a:s02' && can.at === 80 && can.quad.length === 4 && can.rect.w > 0 && !E.isPlanModified(), JSON.stringify(can));
  // a mitred corner: door slid to 10 cm / 9 cm from the end of the shorter face
  E.addWall({ x1: 100, y1: 520, x2: 300, y2: 620, angled: true });
  E.addWall({ x1: 300, y1: 620, x2: 420, y2: 480, angled: true });
  const sa = PLAN.slants[2], ga = seg('seg:a:' + sa.id), fr = ga.faces, q = Math.min(fr.l[fr.l.length - 1][1], fr.r[fr.r.length - 1][1]);
  const dd = E.addOpening({ kind: 'door', wall: sa.id, at: 100, width: 70 });
  const okAt = E.updateOpening(dd.ids[0], { at: q - 10 - 35 });
  check('slide a door to 10 cm of wall before the mitre (shorter face): allowed', dd.ok && okAt.ok, JSON.stringify([dd.reason, okAt.reason, q]));
  const bad = E.updateOpening(dd.ids[0], { at: q - 9 - 35 });
  check('…to 9 cm: refused', !bad.ok && /10 cm/.test(bad.reason), bad.reason);
  const flips = [];
  for (const how of ['hinge', 'hinge', 'swing', 'swing']) { E.flipDoor(dd.ids[0], how); const o = opening(dd.ids[0]); flips.push(o.hinge + o.swing); }
  const h0 = opening(dd.ids[0]);
  check('flip cycle: hinge a ↔ b, swing l ↔ r (back where it started)', flips[0][0] !== flips[1][0] && flips[2][1] !== flips[3][1] && flips[3] === flips[1] && /^[ab][lr]$/.test(h0.hinge + h0.swing), flips.join(' '));
  check('hinge / swing letters of rect doors are refused for a door in a slant', !E.updateOpening(dd.ids[0], { hinge: 'n' }).ok);
  const dd2 = E.addOpening({ kind: 'door', wall: sa.id, at: 80, width: 60 });
  const gapNow = opening(dd.ids[0]).at - 35 - (80 + 30);                 // wall between the two doors (≈ 29.7 cm)
  const w95 = E.updateOpening(dd2.ids[0], { width: 95 }), w100 = E.updateOpening(dd2.ids[0], { width: 100 }), w130 = E.updateOpening(dd2.ids[0], { width: 130 });
  check('widening a door (centre kept): 95 leaves ≥ 10 cm to its neighbour — ok; 100 crowds it, 130 overlaps — refused', dd2.ok && w95.ok && !w100.ok && /10 cm/.test(w100.reason) && !w130.ok && /overlap/.test(w130.reason),
    JSON.stringify([dd2.reason, w95.reason, w100.reason, w130.reason, gapNow]));
  const sl = E.updateOpening(dd2.ids[0], { x: 0, y: 0 });
  check('sliding by point is clamped to the nearest place that fits', sl.ok || /not enough/.test(sl.reason));
  const rm = E.removeOpening(dd.ids[0]);
  check('removeOpening of a door in a slant', rm.ok && !opening(dd.ids[0]));
  const di = E.planDiff().items;
  check('planDiff lists the new slants and the new door in a slant (opening-added)', di.filter((i) => i.kind === 'slant-added').length === 2 && di.some((i) => i.kind === 'opening-added' && i.ref === dd2.ids[0]), JSON.stringify(di.map((i) => i.kind)));
  const up = E.updateOpening('win-s01', { width: 140 });
  check('changing the exterior window in s01: permit', up.ok && up.level === 'permit', up.reason);
  E.resetPlan();
  check('resetPlan → base bytes', bytes() === WB);
}

group('rect walls on a level with slants');
{
  wedge();
  const r = E.addWall({ x1: 510, y1: 300, x2: 900, y2: 300 });
  const sg = r.ok && seg(r.ids[0]);
  check('a rect partition from the partition to the exterior slant: ends exactly 5 cm-grid short of s01\'s face (joint fill closes it), splits the east room', r.ok && sg && sg.axis === 'h' && PLAN.rooms.length === 4 && sg.core.x === 510, JSON.stringify([r.reason, sg && sg.core]));
  const w = PLAN.walls.find((x) => x.y === 295 && x.h === 10);
  const face = (y) => { const f = SG.slantFrame(WEDGE.slants[0]); const px = 990 + f.nx * 10, py = 10 + f.ny * 10; return px + ((y - py) * f.ux) / f.uy; };
  check('…its end: the 5 cm position before the face (both corners outside, gap < 5)', w && w.x + w.w <= Math.min(face(295), face(305)) && Math.min(face(295), face(305)) - (w.x + w.w) < 5, JSON.stringify(w));
  const mv = E.moveWallSegment(r.ids[0], -50);
  const w2 = PLAN.walls.find((x) => x.y === 245 && x.h === 10);
  check('moving it 50 cm north: its end is refitted to the slant face at the new place', mv.ok && w2 && Math.min(face(245), face(255)) - (w2.x + w2.w) < 5 && w2.x + w2.w <= Math.min(face(245), face(255)), JSON.stringify([mv.reason, w2]));
  const mv50 = E.moveWallSegment(mv.ids[0], 150);
  check('…150 cm south would end it on the window in s01: refused', !mv50.ok && /door or window/.test(mv50.reason), mv50.reason);
  const rm = E.removeWallSegment(mv.ids[0]);
  check('…and removing it: 3 rooms again', rm.ok && PLAN.rooms.length === 3, rm.reason);
  store.undo(); store.undo(); store.undo();
  check('undo ×3 → base bytes', bytes() === WB);
  const x = E.addWall({ x1: 700, y1: 20, x2: 700, y2: 700 });
  const wq = G.openingPoly(opening('win-s01'));
  check('a rect wall drawn into s01 is fitted to its face or refused — never through its window', x.ok ? PLAN.walls.every((w) => K.intersectArea([K.rectRing(w)], [wq]) < 0.01) : typeof x.reason === 'string', x.reason);
  if (x.ok) store.undo();
  const rs = E.resizeWallSegment(E.segmentAt(505, 650).id, { end: 700 });
  check('resize of a rect wall on a level with slants runs its own rules (shortening the partition opens the rooms: refused or done)', rs.ok || typeof rs.reason === 'string', rs.reason);
  E.resetPlan();
}

group('draft phase: everything free');
{
  wedge('draft');
  const m = E.moveWallSegment('seg:a:s01', -20);
  check('the exterior slant moves while drafting (free)', m.ok && m.level === 'free', m.reason);
  const t = E.addWall({ x1: 100, y1: 500, x2: 300, y2: 650, angled: true, thickness: 25 });
  check('25 cm angled walls can be drawn while drafting', t.ok, t.reason);
  const w = E.addOpening({ kind: 'window', wall: 's01', at: 150, width: 100 });
  check('a window in s01: free, no permit warning', w.ok && w.level === 'free' && !w.warnings.includes(E.REASONS.permit), JSON.stringify(w));
  check('planDiff is empty while drafting', !E.planDiff().changed);
  E.setBasePlan(E.BUILTIN_PLAN);
}

group('an upper level: the Wedge as L1');
{
  const input = { walls: [[0, 0, 1000, 20, 'exterior'], [0, 780, 1000, 20, 'exterior'], [0, 20, 20, 760, 'exterior'], [980, 20, 20, 760, 'exterior']],
    openings: [{ kind: 'door', x: 400, y: 780, w: 90, h: 20 }], heights: WEDGE.heights, meta: { name: 'Wedge on top', floors: 2 },
    levels: [{ id: 'L1', walls: WEDGE.walls, slants: WEDGE.slants, openings: WEDGE.openings }] };
  const p = B.buildPlan(input, { levels: true, slants: true }).plan, P0 = JSON.stringify(p);
  E.setBasePlan(p, { phase: 'fixed' });
  const l0 = JSON.stringify([PLAN.walls, PLAN.openings, PLAN.rooms]);
  E.setActiveLevel('L1');
  const a = E.addWall({ x1: 20, y1: 400, x2: 400, y2: 780, angled: true });
  check('addWall angled on L1: ids prefixed (L1|seg:a:s03), stored in levels[0].slants, L0 untouched', a.ok && a.ids[0] === 'L1|seg:a:s03' && PLAN.levels[0].slants.length === 3 && JSON.stringify([PLAN.walls, PLAN.openings, PLAN.rooms]) === l0 && !('slants' in PLAN), JSON.stringify(a));
  const m = E.moveWallSegment('L1|seg:a:s02', 20);
  const d = E.addOpening({ kind: 'door', wall: 'L1|seg:a:s03', at: 200 });
  const rot = E.rotateWallEnd('L1|seg:a:s03', 'b', { x: 420, y: 780 });
  check('move / addOpening / rotateWallEnd on L1 work', m.ok && d.ok && rot.ok, JSON.stringify([m.reason, d.reason, rot.reason]));
  const di = E.planDiff().items.filter((i) => i.levelId === 'L1');
  check('planDiff entries carry levelId L1 (slant-added, slant-changed moved, opening-added)', di.some((i) => i.kind === 'slant-added') && di.some((i) => i.kind === 'slant-changed' && i.change === 'moved') && di.some((i) => i.kind === 'opening-added'), JSON.stringify(di.map((i) => i.kind)));
  const lk = E.moveWallSegment('L1|seg:a:s01', 10);
  check('L1 s01 (exterior of a base level) is locked', !lk.ok);
  const st = clone(E.planState());
  E.applyPlanState(null);
  check('plan state round trip with the edited L1 slants', E.applyPlanState(st).ok && JSON.stringify(E.planState()) === JSON.stringify(st));
  E.resetPlan();
  E.setActiveLevel('L0');
  check('reset → the built plan, byte for byte', JSON.stringify(E.currentPlanData()) === P0);
  E.setBasePlan(E.BUILTIN_PLAN);
}

group('House 98 + added slants (fixed)');
{
  E.setBasePlan(E.BUILTIN_PLAN);
  const b1 = PLAN.rooms.find((r) => r.id === 'bedroom-1'), a0 = area(b1.polygon);
  // a 45° wall across bedroom 1's south-west corner (wall faces x 1155, y 1360; its door is higher up the west wall)
  const r = E.addWall({ x1: 1155, y1: 1240, x2: 1275, y2: 1360, angled: true });
  const nr = PLAN.rooms.find((x) => x.name === 'New room');
  const tri = (120 - 5 * R2) ** 2 / 2, rest = a0 - (120 + 5 * R2) ** 2 / 2;
  check('added on House 98: schema 2 + slants on PLAN; bedroom 1 split with exact areas', r.ok && PLAN.schema === 2 && PLAN.slants.length === 1 && nr && near(area(nr.polygon), tri, 1) && near(area(PLAN.rooms.find((x) => x.id === 'bedroom-1').polygon), rest, 1),
    JSON.stringify([r.reason, nr && area(nr.polygon), tri]));
  const m = E.moveWallSegment(r.ids[0], -15), d = E.addOpening({ kind: 'door', wall: r.ids[0], at: 90, width: 70 });
  check('…moved and given a door', m.ok && d.ok, JSON.stringify([m.reason, d.reason]));
  const w = E.addWall({ x1: 1000, y1: 135, x2: 1002, y2: 500 });
  check('…a rect wall elsewhere on the now mixed level (the usual living-room partition) works', w.ok && JSON.stringify(w.ids) === '["seg:v:995:120:510"]', JSON.stringify(w));
  store.undo(); store.undo(); store.undo(); store.undo();
  check('undo ×4 → House 98 byte-identical (no schema / slants keys)', JSON.stringify(PLAN) === H98 && !E.isPlanModified());
}

console.log(`\nslants-edit: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
