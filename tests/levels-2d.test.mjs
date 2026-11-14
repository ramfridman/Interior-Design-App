// Several floors in the 2D plan — stage F2 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md. The pure parts of the plan view
// and the UI controller: the item filter by level, new items' level, the ghost of the floor below, the selection
// clean-up when the floor shown changes, the history signature that sends undo / redo to the floor it changed, and
// snapping / structure data per level. The browser part is tests/e2e.levels.mjs.
//   node tests/levels-2d.test.mjs
import { PLAN } from '../src/core/plan.js';
import { store } from '../src/core/store.js';
import * as E from '../src/core/plan-edit.js';
import { setFeatureForTests } from '../src/core/features.js';
import * as LV from '../src/view2d/levels.js';
import { createSnapper } from '../src/view2d/snapping.js';
import { isJunction, structureOf } from '../src/view2d/structure.js';
import { changedLevels, historySignature } from '../src/ui/levels.js';

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const H98 = JSON.stringify(PLAN);
setFeatureForTests('levels', true);

group('item filter');
{
  const a = { id: 'a' }, b = { id: 'b', level: 'L1' }, c = { id: 'c', level: 'L0' }, d = { id: 'd', level: 'L1', hidden: true }, e = { id: 'e', level: '' };
  check('itemLevel: absent / empty / L0 → L0, L1 → L1', LV.itemLevel(a) === 'L0' && LV.itemLevel(e) === 'L0' && LV.itemLevel(c) === 'L0' && LV.itemLevel(b) === 'L1');
  check('isOnLevel', LV.isOnLevel(a, 'L0') && !LV.isOnLevel(a, 'L1') && LV.isOnLevel(b, 'L1') && LV.isOnLevel(a) && LV.isOnLevel(c, undefined));
  check('itemsOnLevel keeps the drawing order', LV.itemsOnLevel([a, b, c, d, e], 'L0').map((x) => x.id).join() === 'a,c,e' && LV.itemsOnLevel([a, b, c, d, e], 'L1').map((x) => x.id).join() === 'b,d');
  check('isShownOn: hidden items and items of other floors are not drawn / picked', LV.isShownOn(b, 'L1') && !LV.isShownOn(d, 'L1') && !LV.isShownOn(b, 'L0') && !LV.isShownOn(null, 'L0'));
  check('levelPatch: no key on the ground floor (byte-identical one-level designs), { level } above', JSON.stringify(LV.levelPatch('L0')) === '{}' && JSON.stringify(LV.levelPatch(undefined)) === '{}' && LV.levelPatch('L2').level === 'L2');
}

group('ghost of the floor below, level neighbours');
{
  store.load({ items: [] });
  E.resetPlan();
  check('one level: no ghost, no level below / above', LV.ghostOf(PLAN, 'L0') === null && LV.levelBelow(PLAN, 'L0') === null && LV.levelAbove(PLAN, 'L0') === null);
  const add = E.addLevel();
  check('addLevel on House 98', add.ok && add.ids[0] === 'L1');
  const g = LV.ghostOf(PLAN, 'L1');
  check('ghost of L1 = the ground floor’s walls, outline and openings (the same arrays, read-only)', g && g.levelId === 'L0' && g.walls === PLAN.walls && g.outline === PLAN.wallOutline && g.openings === PLAN.openings && Array.isArray(g.stairs));
  E.addLevel({ copyExterior: false });
  const g2 = LV.ghostOf(PLAN, 'L2');
  check('ghost of L2 = L1’s view', g2 && g2.levelId === 'L1' && g2.walls === E.levelPlan(PLAN, 'L1').walls && g2.walls.length > 0);
  check('levelBelow / levelAbove', LV.levelBelow(PLAN, 'L2') === 'L1' && LV.levelAbove(PLAN, 'L1') === 'L2' && LV.levelAbove(PLAN, 'L2') === null && LV.levelBelow(PLAN, 'L9') === null);
  check('showsGhost: upper floor + ui.ghostBelow, never on the ground floor, in exports only when asked',
    LV.showsGhost({ ui: { ghostBelow: true }, level: 'L1' }) && !LV.showsGhost({ ui: { ghostBelow: false }, level: 'L1' }) && !LV.showsGhost({ ui: { ghostBelow: true }, level: 'L0' })
    && !LV.showsGhost({ ui: { ghostBelow: true }, level: 'L1', exporting: true }) && LV.showsGhost({ ui: { ghostBelow: true }, level: 'L1', exporting: true, exportGhost: true }));
}

group('selection clean-up when the floor shown changes');
{
  const items = [{ id: 'g1' }, { id: 'u1', level: 'L1' }, { id: 'u2', level: 'L1' }, { id: 'g2', level: 'L0' }];
  check('selectionOnLevel keeps the order and drops the other floor (and unknown ids)', LV.selectionOnLevel(items, ['u2', 'g1', 'x', 'u1'], 'L1').join() === 'u2,u1' && LV.selectionOnLevel(items, ['u2', 'g1', 'g2'], 'L0').join() === 'g1,g2');
  const v1 = E.levelPlan(PLAN, 'L1');
  const seg1 = E.wallSegments(v1).find((s) => !isJunction(s)), seg0 = E.wallSegments(PLAN).find((s) => !isJunction(s));
  check('upper-level segment ids are prefixed; isJunction sees prefixed junctions', seg1.id.startsWith('L1|') && isJunction({ id: 'L1|seg:j:100:200' }) && isJunction({ id: 'seg:j:100:200' }) && !isJunction(seg1) && !isJunction({ id: 'L1|seg:v:0:720:1360' }));
  check('structureSelOn: a wall of L1 stays on L1, an L0 wall does not', LV.structureSelOn({ type: 'segment', id: seg1.id }, v1) && !LV.structureSelOn({ type: 'segment', id: seg0.id }, v1) && LV.structureSelOn({ type: 'segment', id: seg0.id }, PLAN));
  const o1 = v1.openings[0], o0 = PLAN.openings[0];
  check('structureSelOn: openings by id (unique across floors)', LV.structureSelOn({ type: 'opening', id: o1.id }, v1) && !LV.structureSelOn({ type: 'opening', id: o0.id }, v1) && !LV.structureSelOn(null, v1));
  check('structureOf(level view): selectable segments of that level only', structureOf(v1).segs.every((s) => s.id.startsWith('L1|')) && structureOf(v1).segs.length > 0);

  // the store side: ui.level → the engine's active level; the UI controller drops other floors' selections
  // (store.load would reset the plan: items are added instead)
  store.addItems([{ type: 'bed', w: 160, d: 200, h: 40, x: 700, y: 400, id: 'bedUp', level: 'L1' }, { type: 'sofa', w: 200, d: 90, h: 80, x: 700, y: 900, id: 'sofaDown' }], { select: false });
  const ids = store.items.map((it) => it.id);
  store.select(ids);
  store.setUI({ level: 'L1' });
  check('ui.level L1 → engine active level L1', E.activeLevel() === 'L1');
  const keep = LV.selectionOnLevel(store.items, store.selection, store.ui.level);
  check('… the selection that may stay: the bed only', keep.length === 1 && store.getItem(keep[0]).type === 'bed');
  store.setUI({ level: 'L0' });
}

group('history signature: which floor an undo / redo changed');
{
  const bedUp = store.items.find((it) => it.type === 'bed').id, sofaDown = store.items.find((it) => it.type === 'sofa').id;
  const s0 = historySignature(PLAN, store.items);
  check('signature: every level and every item', s0.levels.size === 3 && s0.items.size === 2 && s0.itemLevel.get(bedUp) === 'L1' && s0.itemLevel.get(sofaDown) === 'L0', `${s0.levels.size} ${s0.items.size}`);
  store.updateItem(bedUp, { x: 720 });
  const s1 = historySignature(PLAN, store.items);
  check('an item moved on L1 → {L1}', [...changedLevels(s0, s1)].join() === 'L1');
  store.removeItems([sofaDown]);
  const s2 = historySignature(PLAN, store.items);
  check('an item removed from L0 → {L0}', [...changedLevels(s1, s2)].join() === 'L0');
  store.setUI({ level: 'L1' });
  const w = E.addWall({ x1: 700, y1: 200, x2: 700, y2: 700, thickness: 10 });
  const s3 = historySignature(PLAN, store.items);
  check('a wall drawn on L1 → {L1} (L0 and L2 unchanged)', w.ok && [...changedLevels(s2, s3)].join() === 'L1', w.reason || '');
  store.setUI({ level: 'L0' });
  store.undo();
  const s4 = historySignature(PLAN, store.items);
  check('undo of that wall, seen from L0 → {L1}', [...changedLevels(s3, s4)].join() === 'L1');
  const rm = E.removeLevel('L2');
  const s5 = historySignature(PLAN, store.items);
  check('a level removed → its id', rm.ok && [...changedLevels(s4, s5)].join() === 'L2');
  const mv = historySignature(PLAN, store.items);
  store.updateItem(bedUp, { level: undefined });
  check('an item moved between floors → both floors', [...changedLevels(mv, historySignature(PLAN, store.items))].sort().join() === 'L0,L1');
}

group('snapping on the floor shown');
{
  let level = 'L0';
  const view = () => (level === 'L0' ? PLAN : E.levelPlan(PLAN, level));
  const sn = createSnapper({ plan: view, store, shown: (it) => LV.isShownOn(it, level) });
  const probe = { id: 'p', type: 'sofa', w: 100, d: 50, h: 80, x: 900, y: 400, rot: 0 };
  const box = { x: 850, y: 600, w: 100, h: 40 };
  const c0 = sn.clearances(box).map((c) => Math.round(c.dist)).join();
  level = 'L1';
  const c1 = sn.clearances(box).map((c) => Math.round(c.dist)).join();
  check('clearances follow the level shown (its own walls)', c0 !== '' && c1 !== '' && c0 !== c1, `${c0} | ${c1}`);
  check('problems() is computed on the level shown', typeof sn.problems(probe).any === 'boolean');
}

// back to House 98, byte-identical
store.load({ items: [] });
store.setUI({ level: 'L0' });
E.resetPlan();
while (PLAN.levels && PLAN.levels.length) E.removeLevel(PLAN.levels[PLAN.levels.length - 1].id, { force: true });
check('House 98 byte-identical at the end', JSON.stringify(PLAN) === H98);
setFeatureForTests('levels', false);

console.log(`\nlevels-2d: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
