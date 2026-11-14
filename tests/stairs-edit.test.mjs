// Stairs in the plan engine — stage F4b of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md (docs/CONTRACT.md § 15 "Editing").
// The Duplex without its stair (tests/fixtures/houses.mjs): addStair gives the fixture's stair and void; refusals (no
// level above, through a wall, outside, problems, over another stair, an opening that would cut a locked wall); move,
// rotate, shape change with the void following and never shrinking below the requirement; updateVoid / removeVoid;
// removeStair with an enlarged void; undo / redo; room areas without the void; spaceAt; buildPlan round trip;
// planDiff; furniture over a void; carpentry over a stair; a one-level plan untouched.
// The collaboration case (replica A adds a stair while B edits a wall on L1) is in tests/collab.test.mjs.
//   node tests/stairs-edit.test.mjs
import { PLAN } from '../src/core/plan.js';
import { store } from '../src/core/store.js';
import * as E from '../src/core/plan-edit.js';
import * as B from '../src/core/plan-build.js';
import * as L from '../src/core/levels.js';
import { polygonArea, spaceAt } from '../src/core/geometry.js';
import { planMetrics } from '../src/regulations/building.js';
import { runChecks } from '../src/regulations/index.js';
import * as C from '../src/carpentry/index.js';
import { DUPLEX } from './fixtures/houses.mjs';

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const clone = (o) => JSON.parse(JSON.stringify(o));
const H98 = JSON.stringify(PLAN);
const events = [];
store.on('plan', (e) => events.push(e));
const DATA = ['id', 'to', 'shape', 'x', 'y', 'rot', 'width', 'risers', 'going'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const voidOf = (id = 'L1') => (L.levelOf(PLAN, id).voids || []);
const box = (ring) => { const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };

// ───────────────────────── a one-level plan: nothing to do ─────────────────────────
group('A one-level plan (House 98): no stair, nothing changes');
{
  const key = E.planStateKey();
  const r = E.addStair({ x: 700, y: 700 });
  check('addStair on a one-level plan is refused: no-level-above (the caller offers to add a floor)', !r.ok && r.code === 'no-level-above' && /floor above/.test(r.reason), JSON.stringify(r));
  check('…and the plan is byte-identical (no stairs key, no schema)', E.planStateKey() === key && JSON.stringify(PLAN) === H98 && !('stairs' in PLAN));
  check('canAddStair says the same without changing anything', E.canAddStair({ x: 700, y: 700 }).code === 'no-level-above' && JSON.stringify(PLAN) === H98);
}

// ───────────────────────── the Duplex without its stair ─────────────────────────
const { stairs: _st, voids: _v, ...L1IN } = DUPLEX.levels[0];
const INPUT = { walls: DUPLEX.walls, openings: DUPLEX.openings, heights: DUPLEX.heights, meta: { name: 'Duplex', floors: 2 }, levels: [L1IN] };
const BASE = B.buildPlan(INPUT, { levels: true }).plan;
const open = (phase = 'fixed', plan = BASE) => { store.openProject({ basePlan: clone(plan), phase, design: { items: [] } }); E.setActiveLevel('L0'); events.length = 0; };
const ST1 = DUPLEX.stairs[0], V1 = DUPLEX.levels[0].voids[0];
const ADD = { level: 'L0', shape: 'straight', x: 570, y: 512.5, rot: 0, width: 100, going: 29 };

group('addStair on the Duplex → the fixture\'s stair and void');
open('fixed');
{
  const t0 = performance.now();
  const r = E.addStair(ADD);
  const ms = performance.now() - t0;
  check('ok, ids [st1, v1], level permit with the stair reason', r.ok && JSON.stringify(r.ids) === '["st1","v1"]' && r.level === 'permit' && r.warnings[0] === E.REASONS.stair, JSON.stringify(r));
  check('the stored stair = the fixture\'s data fields (18 risers from proposeStair, going 29)', JSON.stringify(PLAN.stairs) === JSON.stringify([pick(ST1, DATA)]), JSON.stringify(PLAN.stairs));
  check('the void = the fixture\'s v1 (x 520–620, y 266–670: the 666.2 cut rounded out to 5 cm)', JSON.stringify(voidOf()) === JSON.stringify([V1]), JSON.stringify(voidOf()));
  const ev = events.at(-1);
  check('one plan event: reason add-stair, changed.stairs + levels, levelId L0', events.length === 1 && ev.reason === 'add-stair' && ev.changed.stairs && ev.changed.levels && !ev.changed.walls && ev.levelId === 'L0', JSON.stringify(ev));
  check(`fast enough (${ms.toFixed(1)} ms)`, ms < 200);
  const info = E.stairInfo('st1');
  check('stairInfo: L0 → L1, rise 300, geometry, the void covers what it needs', info.levelId === 'L0' && info.to === 'L1' && info.rise === 300 && info.geo.risers === 18 && info.covers && info.voids.length === 1);
}

group('Rooms of the upper level: the void is not floor');
{
  const up = E.levelPlan(PLAN, 'L1'), east = up.rooms.find((r) => polygonArea(r.polygon) === 670 * 760);
  check('the L1 east room keeps its outline and notes the void (v1, 100 × 404 cm²)', east && JSON.stringify(east.voids) === JSON.stringify([{ id: 'v1', area: 40400 }]), east && JSON.stringify(east.voids));
  check('roomFloorArea = 670 × 760 − 100 × 404 (= DUPLEX.expect.l1EastRoomFloorArea)', L.roomFloorArea(up, east, polygonArea) === DUPLEX.expect.l1EastRoomFloorArea);
  check('regulations: room area without the void', Math.abs(planMetrics(up).get(east).area - DUPLEX.expect.l1EastRoomFloorArea / 1e4) < 1e-9, planMetrics(up).get(east).area);
  const west = up.rooms.find((r) => r !== east);
  check('the other room has no `voids` key', west && !('voids' in west));
  const s = spaceAt(570, 400, up), s2 = spaceAt(700, 400, up);
  check('spaceAt inside the void → the room with void: v1; beside it → no flag', s && s.id === east.id && s.void === 'v1' && s2 && s2.id === east.id && !('void' in s2));
  check('the ground floor rooms are not touched (no voids key)', PLAN.rooms.every((r) => !('voids' in r)));
}

group('planDiff: stair-added and void-added, with their floor');
{
  const items = E.planDiff().items.filter((i) => /^(stair|void)-/.test(i.kind));
  check('stair-added (L0, permit) and void-added (L1, permit)', items.length === 2 && items[0].kind === 'stair-added' && items[0].levelId === 'L0' && items[0].ref === 'st1' && items[1].kind === 'void-added' && items[1].levelId === 'L1' && items.every((i) => i.level === 'permit'), JSON.stringify(items));
}

group('Refusals (nothing changes)');
{
  const key = E.planStateKey();
  const tries = {
    'no level above (on L1)': [E.addStair({ ...ADD, level: 'L1' }), 'no-level-above'],
    'through the partition and its door (x 505)': [E.addStair({ ...ADD, x: 505 }), null],
    'in the doorway of the partition': [E.addStair({ ...ADD, x: 460, y: 500, rot: 0, width: 100 }), null],
    'outside the house': [E.addStair({ ...ADD, x: 1200 }), null],
    'a stair that cannot be built (1 riser)': [E.addStair({ ...ADD, risers: 1 }), 'problems'],
    'over the existing stair': [E.addStair({ ...ADD }), 'stair'],
    'turned south: its top step would hit the south wall of L1': [E.updateStair('st1', { rot: 180 }), 'arrival'],
    'turned east: through the partition': [E.updateStair('st1', { rot: 90 }), 'wall'],
  };
  for (const [name, [r, code]] of Object.entries(tries)) check(`${name} → refused${code ? ` (${code})` : ''}`, !r.ok && (!code || r.code === code) && typeof r.reason === 'string' && r.reason.length > 10, JSON.stringify(r));
  check('…and the plan did not change', E.planStateKey() === key);
}

group('A smaller first floor: the opening would cut its locked exterior wall');
{
  const small = clone(INPUT);
  small.levels[0] = { ...small.levels[0], walls: [{ x: 0, y: 0, w: 1000, h: 20 }, { x: 0, y: 480, w: 1000, h: 20 }, { x: 0, y: 20, w: 20, h: 460 }, { x: 980, y: 20, w: 20, h: 460 }], openings: [] };
  const plan = B.buildPlan(small, { levels: true }).plan;
  open('fixed', plan);
  const r = E.addStair(ADD);
  check('fixed plan: refused, code locked, with the exterior-wall reason', !r.ok && r.code === 'locked' && r.reason.includes(E.REASONS.exteriorWall), JSON.stringify(r));
  open('draft', plan);
  const d = E.addStair(ADD);
  check('draft (nothing locked): still refused — it would cut a wall up there', !d.ok && d.code === 'upper-wall', JSON.stringify(d));
}

group('Move, rotate, change the shape: the void follows');
open('fixed');
{
  E.addStair(ADD);
  const m = E.updateStair('st1', { y: 492.5 });
  check('move 20 cm north: ok, the void moves with it (y 246–650)', m.ok && JSON.stringify(box(voidOf()[0].polygon)) === '[520,246,620,650]' && E.stairInfo('st1').covers, JSON.stringify(voidOf()));
  const back = E.updateStair('st1', { y: 512.5 });
  check('…and back', back.ok && JSON.stringify(voidOf()) === JSON.stringify([V1]));
  const Lr = E.updateStair('st1', { shape: 'L', x: 745, y: 600 });
  const st = PLAN.stairs[0];
  check('shape L (turning right) in the east room: landing { at: 9, size: 100 }, turn right', Lr.ok && st.shape === 'L' && st.turn === 'right' && JSON.stringify(st.landing) === '{"at":9,"size":100}', JSON.stringify(Lr) + ' ' + JSON.stringify(st));
  const info = E.stairInfo('st1');
  check('…its void is replaced by what the L needs (one ring, covering it)', info.covers && voidOf().length === 1 && voidOf()[0].stair === 'st1', JSON.stringify(voidOf()));
  const r90 = E.updateStair('st1', { rot: 90 });
  check('rotate the L to 90° (it would arrive against the south wall up there): refused', !r90.ok && r90.code === 'arrival', JSON.stringify(r90));
  const rot = E.updateStair('st1', { rot: 270 });
  check('rotate the L to 270° (arriving north): ok and the void follows, still covering it', rot.ok && PLAN.stairs[0].rot === 270 && E.stairInfo('st1').covers && voidOf().length === 1, JSON.stringify(rot) + JSON.stringify(voidOf()));
  const fit = E.updateStair('st1', { risers: 20, going: 24 });
  const f2 = E.updateStair('st1', { fit: true });
  check('"fit to the rules" re-runs proposeStair keeping the position', fit.ok && f2.ok && PLAN.stairs[0].risers === 18 && PLAN.stairs[0].going === 28.5 && PLAN.stairs[0].x === 745 && PLAN.stairs[0].y === 600, JSON.stringify(PLAN.stairs[0]));
  for (let i = 0; i < 4; i++) store.undo();
  check('undo ×4: back to the straight stair at the fixture place with v1', JSON.stringify(PLAN.stairs) === JSON.stringify([pick(ST1, DATA)]) && JSON.stringify(voidOf()) === JSON.stringify([V1]), JSON.stringify(PLAN.stairs));
  store.redo();
  check('redo: the L again', PLAN.stairs[0].shape === 'L');
  store.undo();
}

group('The void: enlarge, never smaller than the stair needs, follows a move, stays when the stair goes');
{
  const big = [[500, 250], [700, 250], [700, 690], [500, 690]];
  const crossWall = E.updateVoid('v1', { polygon: [[200, 250], [700, 250], [700, 690], [200, 690]] });
  check('a void across the L1 partition is refused', !crossWall.ok && /wall/.test(crossWall.reason), crossWall.reason);
  const en = E.updateVoid('v1', { polygon: big });
  check('enlarge to x 500–700, y 250–690: ok (permit)', en.ok && en.level === 'permit' && JSON.stringify(box(voidOf()[0].polygon)) === '[500,250,700,690]');
  const sh = E.updateVoid('v1', { polygon: [[520, 266], [620, 266], [620, 560], [520, 560]] });
  check('shrinking below the requirement is refused (with the needed extent)', !sh.ok && /cannot be smaller/.test(sh.reason) && /y 266–670/.test(sh.reason), sh.reason);
  const rv = E.removeVoid('v1');
  check('removeVoid while the stair needs it is refused', !rv.ok && /needs this opening/.test(rv.reason), rv.reason);
  const mv = E.updateStair('st1', { y: 492.5 });
  check('moving the stair: the enlarged void moves with it (y 230–670) and still covers', mv.ok && JSON.stringify(box(voidOf()[0].polygon)) === '[500,230,700,670]' && E.stairInfo('st1').covers, JSON.stringify(voidOf()));
  const rm = E.removeStair('st1');
  check('removeStair: the enlarged void stays as a plain void (stair: null), said in the warnings', rm.ok && rm.keptVoid === 'v1' && voidOf().length === 1 && voidOf()[0].stair === null && rm.warnings.some((w) => /stays/.test(w)) && !PLAN.stairs, JSON.stringify(rm));
  const rv2 = E.removeVoid('v1');
  check('removeVoid of the plain void: ok, no voids key left on L1', rv2.ok && !('voids' in L.levelOf(PLAN, 'L1')));
  const again = E.addStair(ADD);
  check('a new stair gets a fresh void', again.ok && voidOf().length === 1 && voidOf()[0].stair === again.ids[0]);
  const rm2 = E.removeStair(again.ids[0]);
  check('removing a stair whose void was not enlarged removes the void too', rm2.ok && !rm2.keptVoid && !('voids' in L.levelOf(PLAN, 'L1')) && !PLAN.stairs);
  check('the L1 rooms lose their voids note', L.levelOf(PLAN, 'L1').rooms.every((r) => !('voids' in r)));
  const t = E.addStair(ADD);
  E.updateVoid(t.ids[1], { polygon: [[520, 266], [620, 266], [620, 700], [520, 700]] });
  const plain = E.removeStair(t.ids[0]);
  const re = E.addStair(ADD);
  check('a plain void the new stair overlaps is adopted (grown, stair set) instead of a second void', plain.ok && re.ok && voidOf().length === 1 && voidOf()[0].id === t.ids[1] && voidOf()[0].stair === re.ids[0], JSON.stringify(voidOf()));
}

group('Draft: everything free; undo / redo of a whole session');
open('draft');
{
  const r = E.addStair(ADD);
  check('draft: addStair is free, no warning', r.ok && r.level === 'free' && r.warnings.length === 0);
  check('draft: planDiff empty', !E.planDiff().changed);
  const k1 = E.planStateKey();
  E.updateStair('st1', { y: 492.5 });
  E.updateVoid('v1', { polygon: [[500, 246], [700, 246], [700, 650], [500, 650]] });
  store.undo(); store.undo();
  check('undo ×2 → exactly the state after addStair', E.planStateKey() === k1);
  store.redo(); store.redo();
  check('redo ×2 → the enlarged void again', JSON.stringify(box(voidOf()[0].polygon)) === '[500,246,700,650]');
  store.undo(); store.undo(); store.undo();
  check('undo the add: no stairs key, no void, the L1 rooms as built', !('stairs' in PLAN) && !('voids' in L.levelOf(PLAN, 'L1')) && JSON.stringify(PLAN.levels) === JSON.stringify(E.BASE_PLAN.levels));
}

group('buildPlan round trip with stairs and voids (levels: true), moved by the origin shift');
{
  E.addStair(ADD);
  const data = E.currentPlanData();
  const mv = (o) => ({ ...o, x: o.x + 100, y: o.y + 50 });
  const input = { walls: data.walls.map(mv), openings: data.openings.map(mv), heights: data.heights, meta: { name: 'Duplex' }, stairs: data.stairs.map(mv),
    levels: data.levels.map((l) => ({ ...l, walls: l.walls.map(mv), openings: l.openings.map(mv), voids: l.voids.map((v) => ({ ...v, polygon: v.polygon.map(([x, y]) => [x + 100, y + 50]) })) })) };
  const out = B.buildPlan(input, { levels: true });
  check('ok; the stairs and voids come back at their places (origin shift applied)', out.ok && JSON.stringify(out.plan.stairs) === JSON.stringify(data.stairs) && JSON.stringify(out.plan.levels[0].voids) === JSON.stringify(data.levels[0].voids), JSON.stringify([out.plan.stairs, out.plan.levels[0].voids]));
  check('…and the rooms carry their voids note', out.plan.levels[0].rooms.some((r) => r.voids && r.voids[0].id === 'v1'));
  const fx = B.buildPlan({ ...INPUT, stairs: DUPLEX.stairs, levels: [DUPLEX.levels[0]] }, { levels: true });
  check('the fixture with its stair: kept, derived fields (up, riser, footprint, w, d) dropped', fx.ok && JSON.stringify(fx.plan.stairs) === JSON.stringify([pick(ST1, DATA)]) && JSON.stringify(fx.plan.levels[0].voids) === JSON.stringify([V1]));
  const bad = B.buildPlan({ ...INPUT, stairs: [{ id: 'x' }], levels: [{ ...L1IN, voids: [{ id: 'v9', polygon: [[0, 0]] }] }] }, { levels: true });
  check('unreadable stairs / voids are left out with an error each', !bad.ok && !bad.plan.stairs && !bad.plan.levels[0].voids && bad.warnings.filter((w) => w.level === 'error').length === 2, JSON.stringify(bad.warnings.filter((w) => w.level === 'error')));
}

group('Consumers: furniture over the void, carpentry over the stair, the checks');
{
  store.openProject({ basePlan: clone(BASE), phase: 'draft', design: { items: [] } });
  E.addStair(ADD);
  const it = store.addItem({ type: 'chair', name: 'Chair', w: 50, d: 50, h: 80, x: 570, y: 400, level: 'L1' });
  const ok = store.addItem({ type: 'chair', name: 'Chair 2', w: 50, d: 50, h: 80, x: 800, y: 400, level: 'L1' });
  const fs = runChecks({ store, plan: PLAN });
  const iv = fs.filter((f) => f.ruleId === 'item-in-void');
  check('a chair over the void → item-in-void (fail, level L1, its id); the one beside it → nothing', iv.length === 1 && iv[0].severity === 'fail' && iv[0].level === 'L1' && iv[0].itemIds[0] === it.id && !iv.some((f) => f.itemIds.includes(ok.id)), JSON.stringify(iv));
  const stairF = fs.filter((f) => f.stairId === 'st1');
  check('stair findings carry level L0; the fixture stair passes every rule', stairF.length > 5 && stairF.every((f) => f.level === 'L0') && !stairF.some((f) => f.severity === 'fail' || f.severity === 'warn'), stairF.filter((f) => f.severity === 'fail').map((f) => f.ruleId).join());
  E.setActiveLevel('L0');
  const run = C.createRun({ kind: 'island', x: 570, y: 600, rot: 0, length: 120, depth: 60, level: 'L0', units: [{ module: 'base-door' }] });
  const runOk = C.createRun({ kind: 'island', x: 800, y: 600, rot: 0, length: 120, depth: 60, level: 'L0', units: [{ module: 'base-door' }] });
  check('carpentry: a run across the stair footprint is refused; beside it is fine', !run.ok && /stair/.test(run.reason.en) && runOk.ok, JSON.stringify(run.reason) + ' ' + JSON.stringify(runOk.ok || runOk.reason));
}

console.log(`\nstairs-edit: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
