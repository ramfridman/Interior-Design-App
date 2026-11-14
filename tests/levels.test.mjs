// Levels (several floors) in the plan engine — stage F1 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md.
// The "Duplex" test house (tests/fixtures/houses.mjs) WITHOUT its stair and void (stairs are stage F4): per-level views,
// the active level, add / remove / update level, global ids, per-level policy and diff, undo / redo, store spaceOf,
// finishes, buildPlan with levels, and the way back to a byte-identical schema-1 plan.
// The collaboration case (two real-store replicas, a level added and edited on one) is in tests/collab.test.mjs.
//   node tests/levels.test.mjs
import { PLAN } from '../src/core/plan.js';
import { store } from '../src/core/store.js';
import * as E from '../src/core/plan-edit.js';
import * as B from '../src/core/plan-build.js';
import * as L from '../src/core/levels.js';
import { polygonArea } from '../src/core/geometry.js';
import { setFeatureForTests } from '../src/core/features.js';
import { DUPLEX } from './fixtures/houses.mjs';

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const clone = (o) => JSON.parse(JSON.stringify(o));
const H98 = JSON.stringify(PLAN);
const events = [];
store.on('plan', (e) => events.push(e));
/** L0 part of the live plan (everything but the upper levels). */
const l0 = () => { const { levels, schema, ...rest } = PLAN; return JSON.stringify(rest); };
const lv = (id) => JSON.stringify(PLAN.levels.find((l) => l.id === id));
const areas = (rooms) => rooms.map((r) => polygonArea(r.polygon)).sort((a, b) => a - b);
const segAt = (plan, x, y) => E.wallSegments(plan).find((s) => x >= s.core.x && x <= s.core.x + s.core.w && y >= s.core.y && y <= s.core.y + s.core.h);

// ───────────────────────── the Duplex without its stair ─────────────────────────
const { stairs: _st, voids: _v, ...L1IN } = DUPLEX.levels[0];
const INPUT = { walls: DUPLEX.walls, openings: DUPLEX.openings, heights: DUPLEX.heights, meta: { name: 'Duplex', floors: 2 }, levels: [L1IN] };

group('buildPlan with levels');
{
  const off = B.buildPlan(INPUT);
  check('feature off, no option: two floors are still an error, levels left out', !off.ok && !('levels' in off.plan) && off.plan.meta.floors === 1);
  const built = B.buildPlan(INPUT, { levels: true });
  const p = built.plan, up = p.levels && p.levels[0];
  check('{ levels: true }: ok, schema 2, one upper level, meta.floors 2', built.ok && p.schema === 2 && p.levels.length === 1 && p.meta.floors === 2, JSON.stringify(built.warnings.filter((w) => w.level !== 'info')));
  check('2 rooms per level with the expected areas', p.rooms.length === 2 && up.rooms.length === 2
    && JSON.stringify(areas(p.rooms)) === JSON.stringify([470 * 760, 480 * 760]) && JSON.stringify(areas(up.rooms)) === JSON.stringify([280 * 760, 670 * 760]),
  JSON.stringify([areas(p.rooms), areas(up.rooms)]));
  check('L1 east room floor area = 670 × 760 (no void without the stair)', up.rooms.some((r) => polygonArea(r.polygon) === 670 * 760));
  check('elevation from the heights: 0 + 280 + 20 = 300', up.elevation === 300 && JSON.stringify(up.heights) === JSON.stringify({ ceiling: 280, slab: 20, parapet: 40 }));
  const roomIds = [...p.rooms, ...up.rooms].map((r) => r.id), openIds = [...p.openings, ...up.openings].map((o) => o.id), wallIds = [...p.walls, ...up.walls].map((w) => w.id);
  check('room, opening and wall ids are unique across levels', new Set(roomIds).size === roomIds.length && new Set(openIds).size === openIds.length && new Set(wallIds).size === wallIds.length, roomIds.join(' '));
  check('upper-level wall ids carry the level prefix, L0 ids do not', up.walls.every((w) => /^L1\|w\d+$/.test(w.id)) && p.walls.every((w) => /^w\d+$/.test(w.id)));
  check('L1 openings derived (rooms, exterior side)', up.openings.find((o) => o.id === 'win-east-1').outside === 'e' && up.openings.find((o) => o.id === 'door-part-1').rooms.length === 2);
  const was = setFeatureForTests('levels', true);
  const viaFlag = B.buildPlan(INPUT);
  setFeatureForTests('levels', was);
  check('FEATURES.levels on: the same plan without the option', JSON.stringify(viaFlag.plan) === JSON.stringify(p));
  check('{ levels: false } wins over the flag', (setFeatureForTests('levels', true), !B.buildPlan(INPUT, { levels: false }).ok) && (setFeatureForTests('levels', false), true));
  const moved = B.buildPlan({ ...INPUT, walls: DUPLEX.walls.map((w) => ({ ...w, x: w.x + 100, y: w.y + 50 })), openings: DUPLEX.openings.map((o) => ({ ...o, x: o.x + 100, y: o.y + 50 })),
    levels: [{ ...L1IN, walls: L1IN.walls.map((w) => ({ ...w, x: w.x + 100, y: w.y + 50 })), openings: L1IN.openings.map((o) => ({ ...o, x: o.x + 100, y: o.y + 50 })) }] }, { levels: true });
  check('origin move applies to every level', JSON.stringify(moved.plan.levels[0].walls) === JSON.stringify(up.walls) && JSON.stringify(moved.plan.walls) === JSON.stringify(p.walls));
  const mv = (o) => ({ ...o, x: o.x + 100, y: o.y + 50, ...(o.footprint ? { footprint: { ...o.footprint, x: o.footprint.x + 100, y: o.footprint.y + 50 } } : {}) });
  const mvVoid = (v) => ({ ...v, polygon: v.polygon.map(([x, y]) => [x + 100, y + 50]) });
  const pass = B.buildPlan({ ...INPUT, walls: DUPLEX.walls.map(mv), openings: DUPLEX.openings.map(mv),
    stairs: DUPLEX.stairs.map(mv), levels: [{ ...DUPLEX.levels[0], walls: L1IN.walls.map(mv), openings: L1IN.openings.map(mv), voids: DUPLEX.levels[0].voids.map(mvVoid) }] }, { passThrough: true });
  check('passThrough: levels and stairs move with the origin (G2 left them in place)', pass.ok && JSON.stringify(pass.plan.levels[0].walls) === JSON.stringify(L1IN.walls)
    && JSON.stringify(pass.plan.levels[0].openings) === JSON.stringify(L1IN.openings) && JSON.stringify(pass.plan.levels[0].voids) === JSON.stringify(DUPLEX.levels[0].voids)
    && JSON.stringify(pass.plan.stairs) === JSON.stringify(DUPLEX.stairs), JSON.stringify(pass.warnings.filter((w) => w.level !== 'info')));
}

const PLAN2 = B.buildPlan(INPUT, { levels: true }).plan;
const P2 = JSON.stringify(PLAN2);
store.openProject({ basePlan: PLAN2, phase: 'fixed', design: { items: [] } });

group('levelPlan: per-level views');
{
  const v = E.levelPlan(PLAN, 'L1');
  check('levelPlan(PLAN, "L0") is PLAN itself; unknown level → null', E.levelPlan(PLAN, 'L0') === PLAN && E.levelPlan(PLAN, 'L7') === null);
  check('the view holds L1\'s arrays, the shared meta / site / bounds, merged heights, elevation', v.walls === PLAN.levels[0].walls && v.rooms === PLAN.levels[0].rooms
    && v.meta === PLAN.meta && v.site === PLAN.site && v.bounds === PLAN.bounds && v.heights.ceiling === 280 && v.heights.floorAboveGround === 15 && v.elevation === 300 && v.levelId === 'L1');
  check('same object on every call', E.levelPlan(PLAN, 'L1') === v && E.levelPlan(PLAN, 'L1') === E.levelPlan(PLAN, 'L1'));
  check('helpers: levelIds, levelOf, levelElevation, levelName', JSON.stringify(L.levelIds(PLAN)) === '["L0","L1"]' && L.levelOf(PLAN, 'L1') === PLAN.levels[0]
    && L.levelElevation(PLAN, 'L0') === 0 && L.levelElevation(PLAN, 'L1') === 300 && L.levelName(PLAN, 'L1') === 'First floor' && L.levelName(PLAN, 'L1', 'he') === 'קומה א׳' && L.levelName(PLAN, 'L0') === 'Ground floor');
  const fp = L.footprintOf(v);
  check('footprintOf: one outer ring of 1000 × 800, no holes', fp.polygons.length === 1 && fp.polygons[0].holes.length === 0 && Math.abs(fp.area - 1000 * 800) < 1, fp.area);
  const segs = E.wallSegments(v);
  check('wallSegments(view): L1 segment ids prefixed, exterior locked, partition free', segs.every((s) => s.id.startsWith('L1|seg:'))
    && segs.filter((s) => s.cls === 'exterior').every((s) => s.policy.level === 'locked') && segs.some((s) => s.cls === 'partition' && s.policy.level === 'free'));
  check('wallSegments() on the active level (L0): ids unchanged', E.activeLevel() === 'L0' && E.wallSegments().every((s) => /^seg:/.test(s.id)));
  const w = E.addWall({ x1: 900, y1: 20, x2: 900, y2: 780 });
  check('an L0 edit leaves the L1 view, its arrays and the level object unchanged', w.ok && E.levelPlan(PLAN, 'L1') === v && v.walls === PLAN.levels[0].walls && JSON.stringify(PLAN.levels) === JSON.stringify(PLAN2.levels), w.reason);
  store.undo();
}

group('editing on L1 leaves L0 untouched (and vice versa)');
{
  const base0 = l0(), base1 = lv('L1');
  check('setActiveLevel: unknown level refused; L1 accepted', !E.setActiveLevel('L5').ok && E.setActiveLevel('L1').ok && E.activeLevel() === 'L1');
  events.length = 0;
  const add = E.addWall({ x1: 650, y1: 20, x2: 650, y2: 780 });
  const v = E.levelPlan(PLAN, 'L1');
  check('addWall on L1: ok, ids prefixed, one plan event with changed.levels and levelId', add.ok && add.ids.every((id) => id.startsWith('L1|seg:v:645'))
    && events.length === 1 && events[0].changed.levels && !events[0].changed.walls && events[0].levelId === 'L1' && events[0].reason === 'add-wall', add.reason);
  check('…L1 now has 3 rooms, L0 byte-identical', v.rooms.length === 3 && l0() === base0 && E.isPlanModified());
  check('…new room id is global (not one of L0\'s)', v.rooms.every((r) => !PLAN.rooms.some((q) => q.id === r.id)));
  const seg = add.ids[0];
  const mv = E.moveWallSegment(seg, 50);
  check('move it 50 cm east on L1, L0 byte-identical', mv.ok && E.levelPlan(PLAN, 'L1').walls.some((x) => x.x === 695) && l0() === base0, mv.reason);
  const door = E.addOpening({ kind: 'door', x: 700, y: 400 });
  check('a door in it on L1 (global id), L0 byte-identical', door.ok && /^door-new-\d+$/.test(door.ids[0]) && !PLAN.openings.some((o) => o.id === door.ids[0]) && l0() === base0, door.reason);
  const up = E.updateOpening(door.ids[0], { offset: 200 }), fl = E.flipDoor(door.ids[0], 'swing');
  check('move and re-hang that door on L1', up.ok && fl.ok && l0() === base0, up.reason || fl.reason);
  E.setActiveLevel('L0');
  const rd = E.removeOpening(door.ids[0]);
  check('opening calls find the opening\'s own level (active level L0, door on L1)', rd.ok && !E.levelPlan(PLAN, 'L1').openings.some((o) => o.id === door.ids[0]) && l0() === base0, rd.reason);
  E.setActiveLevel('L1');
  const rm = E.removeWallSegment(E.segmentAt(695, 400).id);
  check('remove the wall on L1 → L1 is the base level again (exact), the plan is not modified', rm.ok && lv('L1') === base1 && !E.isPlanModified() && E.planState() === null, rm.reason);
  const room = E.levelPlan(PLAN, 'L1').rooms[0];
  const ren = E.updateRoom(room.id, { name: 'Study' });
  check('updateRoom on an L1 room (by id, from any active level)', ren.ok && E.levelPlan(PLAN, 'L1').rooms[0].name === 'Study' && l0() === base0);
  // vice versa
  E.setActiveLevel('L0');
  const before1 = lv('L1'), lvObj = PLAN.levels[0];
  const a0 = E.addWall({ x1: 150, y1: 20, x2: 150, y2: 780 });
  const d0 = a0.ok && E.addOpening({ kind: 'door', x: 150, y: 600 });
  const m0 = a0.ok && E.moveWallSegment(a0.ids[0], -20);
  check('add / move a wall and a door on L0: L1 byte-identical, same level object', a0.ok && d0.ok && m0.ok && lv('L1') === before1 && PLAN.levels[0] === lvObj && a0.ids[0].startsWith('seg:'), a0.reason || d0.reason || m0.reason);
  check('the L0 door id avoids L1\'s ids too', !E.levelPlan(PLAN, 'L1').openings.some((o) => o.id === d0.ids[0]));
  const r0 = E.removeWallSegment(E.segmentAt(130, 300).id);
  check('remove it on L0: L1 byte-identical', r0.ok && lv('L1') === before1, r0.reason);
  E.resetPlan();
  check('resetPlan: the whole plan (every level) is the base again', JSON.stringify(E.currentPlanData()) === P2 && !E.isPlanModified());
}

group('policy on upper levels');
{
  E.setActiveLevel('L1');
  const ext = E.wallSegments().find((s) => s.cls === 'exterior');
  const r = E.removeWallSegment(ext.id), m = E.moveWallSegment(ext.id, 20);
  check('fixed: L1 exterior walls are locked (remove / move refused with the reason)', !r.ok && !m.ok && /building envelope/.test(r.reason));
  check('fixed: a wall cannot be drawn outside L1\'s footprint ("outdoors" = outside the level)', !E.canAddWall({ x1: 1100, y1: 100, x2: 1100, y2: 500 }).ok);
  const win = E.levelPlan(PLAN, 'L1').openings.find((o) => o.exterior);
  check('fixed: L1 exterior window needs a permit', E.openingPolicy(win.id).level === 'permit');
  const w = E.addOpening({ kind: 'window', x: 990, y: 600 });
  check('…adding one returns level permit', w.ok && w.level === 'permit', w.reason);
  store.undo();
  store.setPlanPhase('draft');
  E.setActiveLevel('L1');
  const ext2 = E.wallSegments().find((s) => s.cls === 'exterior' && s.axis === 'v' && s.core.x === 980);
  check('draft: L1 exterior walls are free', ext2.policy.level === 'free');
  const mv = E.moveWallSegment(ext2.id, 20);
  check('draft: an L1 exterior wall moves', mv.ok, mv.reason);
  check('draft: planDiff is empty', !E.planDiff().changed);
  store.undo();
  store.setPlanPhase('fixed');
  check('fixed again: plan = the base', !E.isPlanModified() && JSON.stringify(E.currentPlanData()) === P2);
}

group('planDiff per level');
{
  E.setActiveLevel('L1');
  E.addWall({ x1: 650, y1: 20, x2: 650, y2: 780 });
  E.setActiveLevel('L0');
  E.addWall({ x1: 900, y1: 20, x2: 900, y2: 780 });
  const diff = E.planDiff();
  check('entries carry levelId; one wall added on each level', diff.changed && diff.items.length === 2 && diff.items.filter((i) => i.levelId === 'L0' && i.kind === 'wall-added').length === 1
    && diff.items.filter((i) => i.levelId === 'L1' && i.kind === 'wall-added' && i.ref.startsWith('L1|')).length === 1, JSON.stringify(diff.items));
  E.resetPlan();
  E.setBasePlan(E.BUILTIN_PLAN);
  store.load({ items: [] });
  const a = E.addWall({ x1: 1000, y1: 135, x2: 1002, y2: 500 });
  const d = E.planDiff();
  check('a one-level plan: unchanged shape (no levelId key)', a.ok && d.items.length > 0 && d.items.every((i) => !('levelId' in i) && JSON.stringify(Object.keys(i)) === '["kind","level","text","at","ref"]'), JSON.stringify(d.items[0]));
  E.resetPlan();
}

group('addLevel / removeLevel / updateLevel, undo / redo, lazy schema');
{
  // from House 98 (schema 1): add a level and remove it again → byte-identical schema 1
  E.setBasePlan(E.BUILTIN_PLAN);
  store.load({ items: [] });
  check('House 98 open, one level', JSON.stringify(PLAN) === H98 && L.levelIds(PLAN).length === 1);
  events.length = 0;
  const add = E.addLevel();
  const up = PLAN.levels && PLAN.levels[0];
  check('addLevel on House 98: L1 added, schema 2 introduced, plan modified, one plan event (changed.levels)', add.ok && add.ids[0] === 'L1' && PLAN.schema === 2 && PLAN.levels.length === 1
    && E.isPlanModified() && events.length === 1 && events[0].changed.levels && events[0].reason === 'add-level' && add.level === 'permit', add.reason);
  check('…elevation = 0 + 300 + 20 (House 98 ceiling and slab)', up.elevation === 300 + E.BUILTIN_PLAN.heights.slab, up.elevation);
  const copiedWins = up.openings.filter((o) => o.kind === 'window').length, l0Wins = PLAN.openings.filter((o) => o.kind === 'window' && o.exterior).length;
  check('copyExterior: windows copied, doors not', copiedWins === l0Wins && copiedWins > 0 && up.openings.every((o) => o.kind === 'window'), `${copiedWins} / ${l0Wins}`);
  check('copyExterior: only exterior walls (every L1 segment is exterior), the envelope closes → rooms derived', E.wallSegments(E.levelPlan(PLAN, 'L1')).every((s) => s.cls === 'exterior' || s.id.includes('seg:j'))
    && up.rooms.length >= 1 && up.rooms.every((r) => !PLAN.rooms.some((q) => q.id === r.id)), up.rooms.map((r) => r.id).join(' '));
  check('copied window ids are new and global', up.openings.every((o) => /^win-new-\d+$/.test(o.id) && !PLAN.openings.some((q) => q.id === o.id)));
  check('L0 untouched by addLevel', JSON.stringify(PLAN.walls) === JSON.stringify(E.BUILTIN_PLAN.walls) && JSON.stringify(PLAN.openings) === JSON.stringify(E.BUILTIN_PLAN.openings));
  const empty = E.addLevel({ copyExterior: false, name: 'Roof room' });
  check('addLevel({ copyExterior: false, name }): an empty L2 named, elevation stacked', empty.ok && PLAN.levels[1].walls.length === 0 && PLAN.levels[1].name === 'Roof room'
    && PLAN.levels[1].elevation === PLAN.levels[0].elevation + PLAN.levels[0].heights.ceiling + PLAN.levels[1].heights.slab);
  const upd = E.updateLevel('L1', { heights: { ceiling: 320 } });
  check('updateLevel L1 ceiling 300 → 320: L2 moves up by 20', upd.ok && PLAN.levels[0].heights.ceiling === 320 && PLAN.levels[1].elevation === 320 + 320 + 20, JSON.stringify(PLAN.levels.map((l) => l.elevation)));
  check('updateLevel refuses a ceiling a window would not fit under', !E.updateLevel('L1', { heights: { ceiling: 200 } }).ok);
  check('updateLevel L0 refused; rename L1', !E.updateLevel('L0', { name: 'x' }).ok && E.updateLevel('L1', { name: 'Upstairs' }).ok && L.levelName(PLAN, 'L1') === 'Upstairs');
  check('removeLevel: a middle level with walls is refused', !E.removeLevel('L1').ok);
  store.undo();
  check('undo the rename', L.levelName(PLAN, 'L1') === 'First floor');
  store.undo();
  check('undo the height change: elevations back', PLAN.levels[0].heights.ceiling === 300 && PLAN.levels[1].elevation === 640);
  store.redo();
  check('redo it', PLAN.levels[1].elevation === 660);
  store.undo();
  events.length = 0;
  store.undo();
  check('undo addLevel L2: one level up again, plan event with changed.levels only (history)', PLAN.levels.length === 1 && events.length === 1 && events[0].reason === 'history' && events[0].changed.levels && !events[0].changed.walls);
  const segOnL1 = (E.setActiveLevel('L1'), E.addWall({ x1: 500, y1: 400, x2: 900, y2: 400 }));
  check('draw a partition on the copied L1', segOnL1.ok, segOnL1.reason);
  store.undo();
  E.setActiveLevel('L0');
  const before = JSON.stringify(PLAN);
  const rm = E.removeLevel('L1');
  check('removeLevel L1 → PLAN is House 98 byte-identical (schema 1), not modified, active level L0', rm.ok && JSON.stringify(PLAN) === H98 && !('schema' in PLAN) && !('levels' in PLAN)
    && !E.isPlanModified() && E.planState() === null && E.planStateKey() === 'null' && E.activeLevel() === 'L0', rm.reason);
  store.undo();
  check('undo removeLevel → L1 back byte-identical', JSON.stringify(PLAN) === before);
  store.undo();
  check('undo addLevel → House 98 byte-identical', JSON.stringify(PLAN) === H98 && E.planState() === null);
  store.redo();
  check('redo addLevel → identical to before', JSON.stringify(PLAN) === before);
  // with an edited L0: add + remove a level keeps the L0 edit, schema 1 bytes
  store.undo();
  const w = E.addWall({ x1: 1000, y1: 135, x2: 1002, y2: 500 });
  const edited = JSON.stringify(PLAN), key = E.planStateKey();
  E.addLevel(); E.removeLevel('L1');
  check('edited L0, add + remove a level → the edited schema-1 plan again (bytes and planStateKey)', w.ok && JSON.stringify(PLAN) === edited && E.planStateKey() === key);
  E.resetPlan();
}

group('store: items per level, spaceOf, finishes, ui.level');
{
  store.openProject({ basePlan: PLAN2, phase: 'fixed', design: { items: [] } });
  const west0 = PLAN.rooms.find((r) => polygonArea(r.polygon) === 480 * 760), west1 = E.levelPlan(PLAN, 'L1').rooms.find((r) => polygonArea(r.polygon) === 280 * 760);
  const a = store.addItem({ type: 'chair', w: 50, d: 50, h: 80, x: 150, y: 400 });
  const b = store.addItem({ type: 'chair', w: 50, d: 50, h: 80, x: 150, y: 400, level: 'L1' });
  const c = store.addItem({ type: 'chair', w: 50, d: 50, h: 80, x: 400, y: 400, level: 'L1' });
  const east1 = E.levelPlan(PLAN, 'L1').rooms.find((r) => polygonArea(r.polygon) === 670 * 760);
  check('spaceOf: L0 item in the L0 west room, L1 items in L1 rooms', store.spaceOf(a).id === west0.id && store.spaceOf(b).id === west1.id && store.spaceOf(c).id === east1.id,
    [store.spaceOf(a).id, store.spaceOf(b).id, store.spaceOf(c).id].join(' '));
  check('items keep their level', store.getItem(b.id).level === 'L1' && !('level' in store.getItem(a.id)));
  store.setFinish(west1.id, { floor: 'oak' });
  E.setActiveLevel('L1');
  const w = E.addWall({ x1: 650, y1: 20, x2: 650, y2: 780 });
  check('finishes of L1 rooms survive an L1 edit (rooms of every level count)', w.ok && store.finishes[west1.id] && store.finishes[west1.id].floor === 'oak');
  store.undo();
  check('ui.level: unknown level → L0', (store.setUI({ level: 'L9' }), store.ui.level === 'L0'));
  store.setUI({ level: 'L1' });
  check('ui.level L1 sets the engine\'s active level', store.ui.level === 'L1' && E.activeLevel() === 'L1');
  const refused = E.removeLevel('L1');
  check('removeLevel with items / finishes on it: refused, content reported', !refused.ok && refused.content && refused.content.items.length === 2 && refused.content.finishes.includes(west1.id) && /still holds/.test(refused.reason), refused.reason);
  store.begin();
  const forced = E.removeLevel('L1', { force: true });
  store.removeItems(forced.content.items);
  store.commit();
  check('removeLevel { force }: removed, content reported, finishes of its rooms dropped, ui.level → L0', forced.ok && !PLAN.levels && !store.finishes[west1.id] && store.ui.level === 'L0' && E.activeLevel() === 'L0' && store.items.length === 1);
  store.undo();
  check('one undo brings the level, its items and finishes back', PLAN.levels && PLAN.levels.length === 1 && store.items.length === 3 && store.finishes[west1.id] && store.finishes[west1.id].floor === 'oak');
  const file = clone(store.serialize());
  store.setUI({ level: 'L1' });
  store.openProject({ basePlan: E.BUILTIN_PLAN, phase: 'fixed', design: { items: [] } });
  check('opening another project resets ui.level and the active level to L0', store.ui.level === 'L0' && E.activeLevel() === 'L0' && JSON.stringify(PLAN) === H98);
  store.openProject({ basePlan: PLAN2, phase: 'fixed', design: file });
  check('the Duplex design reopens with its items on L1', store.items.filter((i) => i.level === 'L1').length === 2);
}

group('performance (L0 edits on a one-level plan cost what they did; level edits are of the same order)');
{
  store.openProject({ basePlan: E.BUILTIN_PLAN, phase: 'fixed', design: { items: [] } });
  const time = (fn, n = 20) => { fn(); const t = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t) / n; };
  const s = E.wallSegments().find((x) => x.cls === 'partition' && E.moveWallSegment(x.id, 10).ok && (store.undo(), true));
  const t0 = time(() => { const r = E.moveWallSegment(s.id, 10); if (r.ok) store.undo(); });
  store.openProject({ basePlan: PLAN2, phase: 'fixed', design: { items: [] } });
  E.setActiveLevel('L1');
  const p = E.wallSegments().find((x) => x.cls === 'partition');
  const t1 = time(() => { const r = E.moveWallSegment(p.id, 10); if (r.ok) store.undo(); });
  check('House 98 wall move + undo and Duplex L1 wall move + undo < 30 ms each', t0 < 30 && t1 < 30, `${t0.toFixed(1)} ms / ${t1.toFixed(1)} ms`);
  E.setActiveLevel('L0');
}

console.log(`\nlevels: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
