// Projects foundation: plan builder, switchable base plan, draft / fixed phases, project storage.   node tests/projects.test.mjs
import { PLAN } from '../src/core/plan.js';
import { store } from '../src/core/store.js';
import { polygonArea } from '../src/core/geometry.js';
import * as E from '../src/core/plan-edit.js';
import { buildPlan, emptyPlan } from '../src/core/plan-build.js';
import { createProjects, createMemoryAdapter, createLocalStorageAdapter, PROJECT_FILE_APP } from '../src/core/projects.js';
import { initialLayout } from '../src/core/initial-layout.js';

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const m2 = (r) => polygonArea(r.polygon) / 1e4;
const H98 = JSON.stringify(PLAN);
const strip = ({ rooms, exterior, outside, ...o }) => o;

/** A fake localStorage (Map-backed) so the migration and the localStorage adapter can be tested in node. */
function fakeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

// ---------------------------------------------------------------------------------------------------------------
group('buildPlan: House 98 round trip');
{
  const { ok, plan, warnings } = buildPlan({ walls: PLAN.walls, openings: PLAN.openings.map(strip), meta: PLAN.meta, heights: PLAN.heights });
  check('ok, no errors', ok && !warnings.some((w) => w.level === 'error'), JSON.stringify(warnings.filter((w) => w.level !== 'info')));
  check('same room count', plan.rooms.length === PLAN.rooms.length, `${plan.rooms.length} vs ${PLAN.rooms.length}`);
  const unmatched = PLAN.rooms.filter((r) => !plan.rooms.some((q) => Math.abs(m2(q) - m2(r)) / m2(r) < 0.01));
  check('every room area reproduced within 1 %', unmatched.length === 0, unmatched.map((r) => r.id).join(', '));
  check('bounds = house bounds', eq(plan.bounds, PLAN.bounds), JSON.stringify(plan.bounds));
  check('all openings kept, exterior flags right', plan.openings.length === PLAN.openings.length
    && PLAN.openings.every((o) => !!plan.openings.find((q) => q.id === o.id).exterior === !!o.exterior));
  check('complete PLAN shape', E.PLAN_KEYS.every((k) => k in plan));
  check('largest room is the living space', plan.rooms.find((r) => r.type === 'living') && Math.abs(m2(plan.rooms.find((r) => r.type === 'living')) - 76.59) < 0.1);
  check('PLAN untouched by building', JSON.stringify(PLAN) === H98);
}

group('buildPlan: a simple two-room rectangle');
let twoRoom;
{
  // 8 × 5 m outer, 20 cm exterior walls, a 10 cm partition at x = 400 with a door, one window and an entry door
  const walls = [
    { x: 0, y: 0, w: 800, h: 20, kind: 'exterior' }, { x: 0, y: 480, w: 800, h: 20, kind: 'exterior' },
    { x: 0, y: 20, w: 20, h: 460, kind: 'exterior' }, { x: 780, y: 20, w: 20, h: 460, kind: 'exterior' },
    { x: 395, y: 20, w: 10, h: 460 },
  ];
  const openings = [
    { kind: 'door', x: 395, y: 200, w: 10, h: 90 },
    { kind: 'window', x: 150, y: 0, w: 120, h: 20 },
    { kind: 'door', x: 780, y: 300, w: 20, h: 100, style: 'entry' },
  ];
  const res = buildPlan({ walls, openings, meta: { name: 'Two rooms', northAngle: 15 }, site: { margins: { n: 400, e: 500, s: 300, w: 300 }, street: 'e' } });
  twoRoom = res.plan;
  check('ok', res.ok, JSON.stringify(res.warnings));
  check('two rooms', twoRoom.rooms.length === 2, String(twoRoom.rooms.length));
  check('room areas 3.75 × 4.60 and 3.75 × 4.60', twoRoom.rooms.every((r) => Math.abs(m2(r) - 3.75 * 4.6) < 0.01), twoRoom.rooms.map(m2).join(', '));
  check('interior door connects the two rooms', eq([...twoRoom.openings.find((o) => o.x === 395).rooms].sort(), twoRoom.rooms.map((r) => r.id).sort()));
  check('window is exterior, outside = n', twoRoom.openings.find((o) => o.kind === 'window').exterior && twoRoom.openings.find((o) => o.kind === 'window').outside === 'n');
  check('ids filled in', twoRoom.openings.every((o) => o.id) && twoRoom.walls.every((w) => /^w\d+$/.test(w.id)));
  check('default site around the house with the given margins', eq(twoRoom.site.boundary, [[-300, -400], [1300, -400], [1300, 800], [-300, 800]]) && twoRoom.site.street.side === 'e');
  check('north angle kept', twoRoom.meta.northAngle === 15);
  check('no outdoor areas by default', twoRoom.outdoorAreas.length === 0);
  check('wall outline derived', twoRoom.wallOutline.length > 8);
}

group('buildPlan: bad input never throws');
{
  const res = buildPlan({ walls: [{ x1: 0, y1: 0, x2: 300, y2: 400 }, { polygon: [[0, 0], [1, 1]] }, { x: 'a' }, [0, 0, 300, 20], { x: 0, y: 0, w: 20, h: 300, floor: 2 }], openings: [{ kind: 'door', x: 5000, y: 5000, w: 90, h: 10 }, { kind: 'hatch', x: 0, y: 0, w: 1, h: 1 }], meta: { floors: 2 } });
  const text = res.warnings.map((w) => w.text).join(' | ');
  check('returns a plan', !!res.plan && Array.isArray(res.plan.walls));
  check('not ok', res.ok === false);
  check('diagonal wall explained as orthogonal-only (angled walls switched off, no option)', /diagonal.*orthogonal/i.test(text) && !('slants' in res.plan));
  // stage A1: with the `slants` option (or FEATURES.angledWalls on) the same diagonal centre line is an angled wall
  const angled = buildPlan({ walls: [{ x1: 0, y1: 0, x2: 300, y2: 400 }] }, { slants: true });
  check('…accepted as an angled wall with { slants: true }', angled.ok && angled.plan.slants.length === 1 && angled.plan.slants[0].t === 10 && !angled.warnings.some((w) => /diagonal/i.test(w.text)), JSON.stringify(angled.warnings));
  check('other floors explained', /one floor/i.test(text));
  check('stray opening left out', /not in any wall/.test(text) && res.plan.openings.length === 0);
  check('nonsense input', buildPlan(null).plan && buildPlan({ walls: 'x' }).ok === false);
  const moved = buildPlan({ walls: [{ x: 100, y: 50, w: 300, h: 20 }] });
  check('origin moved to the NW corner', moved.plan.walls[0].x === 0 && moved.plan.walls[0].y === 0 && moved.warnings.some((w) => /moved/.test(w.text)));
}

// ---------------------------------------------------------------------------------------------------------------
group('switching the base plan');
{
  E.setBasePlan(twoRoom, { phase: 'fixed' });
  check('PLAN is the new plan', PLAN.rooms.length === 2 && PLAN.meta.name === 'Two rooms' && eq(PLAN.site, twoRoom.site));
  check('BASE_PLAN follows (live binding)', E.BASE_PLAN.meta.name === 'Two rooms' && Object.isFrozen(E.BASE_PLAN));
  check('not the built-in house', !E.isBuiltinBase());
  check('unmodified', !E.isPlanModified() && E.planState() === null);
  const ext = E.wallSegments().filter((s) => s.cls === 'exterior');
  check('exterior walls locked on a fixed plan', ext.length >= 4 && ext.every((s) => s.policy.level === 'locked'));
  const add = E.addWall({ x1: 20, y1: 400, x2: 395, y2: 400 });
  check('a partition can be added (fixed)', add.ok, add.reason || '');
  check('rooms re-derived: 3 rooms', PLAN.rooms.length === 3, String(PLAN.rooms.length));
  check('changes list counts it', E.planDiff().items.some((i) => i.kind === 'wall-added'));
  E.setBasePlan(E.BUILTIN_PLAN);
  check('back to House 98: PLAN byte-identical', JSON.stringify(PLAN) === H98);
  check('built-in again', E.isBuiltinBase() && E.BASE_PLAN === E.BUILTIN_PLAN && E.planPhase() === 'fixed');
}

group('draft phase: rooms follow the walls, nothing is locked or a change');
{
  E.setBasePlan(emptyPlan({ lot: { width: 2500, depth: 2000 } }), { phase: 'draft' });
  check('empty plan opens', PLAN.walls.length === 0 && PLAN.rooms.length === 0 && E.planPhase() === 'draft');
  const box = [[0, 0, 600, 0], [600, 0, 600, 500], [600, 500, 0, 500], [0, 500, 0, 0]];
  const res = box.map(([x1, y1, x2, y2]) => E.addWall({ x1, y1, x2, y2, thickness: 20 }));
  check('four exterior walls drawn on an empty lot', res.every((r) => r.ok), res.map((r) => r.reason || 'ok').join(' | '));
  check('one room enclosed', PLAN.rooms.length === 1, String(PLAN.rooms.length));
  check('bounds follow the walls', PLAN.bounds.w >= 600 && PLAN.bounds.h >= 500, JSON.stringify(PLAN.bounds));
  check('nothing locked while drafting', E.wallSegments().every((s) => s.policy.level === 'free'));
  check('no changes list while drafting', !E.isPlanModified() && E.planDiff().items.length === 0);
  const roomId = PLAN.rooms[0].id;
  E.updateRoom(roomId, { name: 'Studio', type: 'living' });
  const split = E.addWall({ x1: 350, y1: 10, x2: 350, y2: 490 });
  check('a wall splits the room', split.ok && PLAN.rooms.length === 2, split.reason || String(PLAN.rooms.length));
  check('the larger part keeps its name and id', PLAN.rooms.some((r) => r.id === roomId && r.name === 'Studio'));
  const win = E.addOpening({ kind: 'window', x: 150, y: 0 });
  check('a window in an exterior wall is free while drafting', win.ok && win.level === 'free' && !win.warnings.length, win.reason || JSON.stringify(win.warnings));
  const door = E.addOpening({ kind: 'door', x: 350, y: 250 });
  check('a door between the rooms', door.ok, door.reason || '');
  const seg = E.segmentAt(350, 150);
  const rm = E.removeWallSegment(seg.id);
  check('removing the wall merges the rooms', rm.ok && PLAN.rooms.length === 1 && PLAN.rooms[0].name === 'Studio', rm.reason || String(PLAN.rooms.length));
  const extSeg = E.segmentAt(0, 250);
  const mv = E.moveWallSegment(extSeg.id, -50);
  check('an exterior wall can be moved while drafting', mv.ok, mv.reason || '');
  check('room grew with it', PLAN.rooms.length === 1 && m2(PLAN.rooms[0]) > 5.6 * 4.6, String(m2(PLAN.rooms[0])));

  // draft → fixed: the drawn house becomes the base plan
  check('store.setPlanPhase(fixed)', store.setPlanPhase('fixed'));
  check('fixed: the drawn plan is the base, unmodified', E.planPhase() === 'fixed' && !E.isPlanModified() && E.BASE_PLAN.walls.length === PLAN.walls.length && !PLAN.walls.some((w) => 'cls' in w));
  check('fixed: exterior walls are locked now', E.wallSegments().filter((s) => s.cls === 'exterior').every((s) => s.policy.level === 'locked'));
  const out = E.addWall({ x1: 700, y1: 100, x2: 900, y2: 100 });
  check('fixed: no walls outside the house', !out.ok);
  const part = E.addWall({ x1: -50, y1: 250, x2: 600, y2: 250 });
  check('fixed: a partition is a change', part.ok && E.isPlanModified() && E.planDiff().items.length === 1, part.reason || '');
  const exWin = E.addOpening({ kind: 'window', x: 400, y: 500 });
  check('fixed: an exterior window needs a permit', exWin.ok && exWin.level === 'permit', exWin.reason || exWin.level);
  check('store.setPlanPhase(draft) clears history', store.setPlanPhase('draft') && !store.historyState().canUndo);
  check('draft again: no changes list', E.planDiff().items.length === 0 && E.wallSegments().every((s) => s.policy.level === 'free'));
  E.setBasePlan(E.BUILTIN_PLAN);
  check('House 98 byte-identical after drafting elsewhere', JSON.stringify(PLAN) === H98);
}

// ---------------------------------------------------------------------------------------------------------------
group('projects: CRUD on an in-memory adapter');
{
  const adapter = createMemoryAdapter();
  const P = createProjects({ store, adapter, legacyKey: '__none__' });
  await P.init();
  let list = await P.list();
  check('first run creates the built-in house', list.length === 1 && list[0].builtin && E.isBuiltinBase() && store.items.length === initialLayout().length);
  const h98 = P.current().id;
  store.addItem({ type: 'sofa', x: 700, y: 400, w: 200, d: 90, h: 80, name: 'Test sofa' });
  await P.save();
  const blank = await P.create({ name: 'Empty lot', from: 'blank', lot: { width: 3000, depth: 2200 }, location: { name: 'Eilat', latitude: 29.56, longitude: 34.95 }, northAngle: 10, ceiling: 280 });
  check('create blank → opened, draft, empty', blank.ok && P.current().id === blank.project.id && E.planPhase() === 'draft' && PLAN.walls.length === 0 && store.items.length === 0);
  check('blank lot: location, north, ceiling, lot size', PLAN.meta.latitude === 29.56 && PLAN.meta.northAngle === 10 && PLAN.heights.ceiling === 280 && store.project.ceilingHeight === 280
    && PLAN.site.bounds.w === 3000 && PLAN.site.bounds.h === 2200);
  check('history cleared on open', !store.historyState().canUndo);
  E.addWall({ x1: 0, y1: 0, x2: 500, y2: 0, thickness: 20 });
  E.addWall({ x1: 0, y1: 0, x2: 0, y2: 400, thickness: 20 });
  await P.save();
  const rename = await P.rename(blank.project.id, 'My lot');
  check('rename (open project)', rename.ok && store.project.name === 'My lot' && (await adapter.get(blank.project.id)).name === 'My lot');
  const dup = await P.duplicate(blank.project.id);
  check('duplicate', dup.ok && (await adapter.get(dup.project.id)).basePlan && (await P.list()).length === 3);
  check('open House 98 again: design intact', await P.open(h98) && E.isBuiltinBase() && store.items.some((i) => i.name === 'Test sofa') && JSON.stringify(PLAN) === H98);
  check('open the lot again: walls kept', await P.open(blank.project.id) && PLAN.walls.length > 0 && E.planPhase() === 'draft' && PLAN.meta.latitude === 29.56);
  const exp = await P.exportFile();
  check('export one file', exp.ok && /\.e7project\.json$/.test(exp.filename) && JSON.parse(exp.text).app === PROJECT_FILE_APP);
  const imp = await P.importFile(exp.text, { open: false });
  check('import it back as a new project', imp.ok && imp.project.id !== blank.project.id && eq((await adapter.get(imp.project.id)).design.planEdits.walls, PLAN.walls));
  const old = await P.importFile(JSON.stringify({ app: 'e7-interior-design', version: 1, items: [{ type: 'bed', x: 200, y: 900, w: 160, d: 200, h: 50 }], project: { name: 'Old design' } }), { open: false });
  check('an old design file becomes a House 98 project', old.ok && (await adapter.get(old.project.id)).builtin && old.project.name === 'Old design');
  check('garbage import refused', !(await P.importFile('not json')).ok && !(await P.importFile({ hello: 1 })).ok);
  const del = await P.remove(blank.project.id);
  check('delete the open project → another one opens', del.ok && P.current().id !== blank.project.id && !(await adapter.get(blank.project.id)));
  const built = buildPlan({ walls: [[0, 0, 400, 20], [0, 0, 20, 300], [380, 0, 20, 300], [0, 280, 400, 20]], openings: [] });
  const fromPlan = await P.create({ name: 'Imported sketch', fromPlan: built.plan });
  check('create({ fromPlan }) → draft project with that plan', fromPlan.ok && E.planPhase() === 'draft' && PLAN.rooms.length === 1 && store.project.name === 'Imported sketch');
  check('create({ fromPlan }) refuses an incomplete plan', !(await P.create({ fromPlan: { walls: [] } })).ok);
  await P.open(h98);
  check('back on House 98 at the end', E.isBuiltinBase() && JSON.stringify(PLAN) === H98);
}

group('projects: migration of the old autosave');
{
  const saved = globalThis.localStorage;
  const legacy = { app: 'e7-interior-design', version: 1, project: { name: 'Our house', ceilingHeight: 300 }, items: [{ id: 'it_x', type: 'sofa', x: 500, y: 300, w: 200, d: 90, h: 80 }], finishes: {}, planEdits: null };
  const ls = fakeStorage({ 'e7-interior-design/v1': JSON.stringify(legacy) });
  globalThis.localStorage = ls;
  try {
    const adapter = createLocalStorageAdapter(ls);
    const P = createProjects({ store, adapter });
    await P.init();
    const list = await P.list();
    check('one project, named from the old design', list.length === 1 && list[0].name === 'Our house');
    check('old design opened', store.items.length === 1 && store.items[0].id === 'it_x' && E.isBuiltinBase());
    check('old key left untouched (backup)', ls.getItem('e7-interior-design/v1') === JSON.stringify(legacy));
    const P2 = createProjects({ store, adapter });
    await P2.init();
    check('second run does not migrate again', (await P2.list()).length === 1 && P2.current().id === list[0].id);
  } finally { if (saved === undefined) delete globalThis.localStorage; else globalThis.localStorage = saved; }
  const P3 = createProjects({ store, adapter: { list: async () => { throw new Error('blocked'); }, get: async () => null, put: async () => { throw new Error('blocked'); }, remove: async () => {} } });
  await P3.init();
  check('storage unavailable: still runs in memory', !!P3.current() && E.isBuiltinBase() && store.items.length > 0);
  await P3.save();
  check('a failed save is reported, not thrown', /could not be saved/.test(P3.lastError() || ''));
}

group('House 98 byte-identical at the end');
check('PLAN', JSON.stringify(PLAN) === H98);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('PROJECTS FAILED'); process.exit(1); } else console.log('PROJECTS OK');
