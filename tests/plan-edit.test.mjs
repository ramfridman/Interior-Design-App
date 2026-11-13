// Plan editing engine (src/core/plan-edit.js) + its store integration.   node tests/plan-edit.test.mjs
import { PLAN } from '../src/core/plan.js';
import { store } from '../src/core/store.js';
import { walkBlockers, wallFaces, pointInPolygon, polygonArea, isIndoors } from '../src/core/geometry.js';
import * as E from '../src/core/plan-edit.js';

const { BASE_PLAN } = E;
store.persist = false;

let failed = 0, passed = 0, section = '';
const group = (name) => { section = name; console.log(`\n${name}`); };
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const area = (r) => r.w * r.h;
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const m2 = (cm2) => cm2 / 1e4;
const planEqualsBase = () => eq(PLAN.walls, BASE_PLAN.walls) && eq(PLAN.openings, BASE_PLAN.openings) && eq(PLAN.rooms, BASE_PLAN.rooms) && eq(PLAN.wallOutline, BASE_PLAN.wallOutline);
const snapshot = () => JSON.stringify([PLAN.walls, PLAN.openings, PLAN.rooms, PLAN.wallOutline]);
const room = (id) => PLAN.rooms.find((r) => r.id === id);
const opening = (id) => PLAN.openings.find((o) => o.id === id);
const seg = (id) => E.wallSegments().find((s) => s.id === id);
const FOOTPRINT = sum(BASE_PLAN.walls, area) + sum(BASE_PLAN.openings, area) + sum(BASE_PLAN.rooms, (r) => polygonArea(r.polygon));
const LOCKED = E.wallSegments(BASE_PLAN).filter((s) => s.policy.level === 'locked');
const events = [];
store.on('plan', (e) => events.push(e));

/** Structural invariants that must hold after every operation. Returns a list of violations. */
function invariants() {
  const bad = [], all = [...PLAN.walls, ...PLAN.openings];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (ov(all[i], all[j])) bad.push(`overlap ${all[i].id} / ${all[j].id}`);
  for (const o of PLAN.openings) {
    if ((o.axis === 'h' ? o.w : o.h) !== o.width) bad.push(`${o.id}: width ${o.width} vs gap`);
    const a = o.axis === 'h' ? { x: o.x - 1, y: o.y, w: 1, h: o.h } : { x: o.x, y: o.y - 1, w: o.w, h: 1 };
    const b = o.axis === 'h' ? { x: o.x + o.w, y: o.y, w: 1, h: o.h } : { x: o.x, y: o.y + o.h, w: o.w, h: 1 };
    for (const j of [a, b]) if (sum(PLAN.walls, (w) => inter(w, j)) !== area(j)) bad.push(`${o.id}: no wall at a jamb`);
    if (!Array.isArray(o.rooms) || o.rooms.length !== 2) bad.push(`${o.id}: rooms`);
    if (!!o.exterior !== o.rooms.some((id) => id === 'outside' || PLAN.outdoorAreas.some((s) => s.id === id))) bad.push(`${o.id}: exterior flag`);
  }
  // rooms: closed rectilinear polygons, unique ids, label inside, no wall inside a room, nothing leaked outdoors
  const ids = new Set();
  for (const r of PLAN.rooms) {
    if (ids.has(r.id)) bad.push(`duplicate room ${r.id}`); ids.add(r.id);
    const p = r.polygon;
    if (p.length < 4 || !(polygonArea(p) > 0)) bad.push(`${r.id}: empty polygon`);
    p.forEach((a, i) => { const b = p[(i + 1) % p.length]; if ((a[0] === b[0]) === (a[1] === b[1])) bad.push(`${r.id}: edge not axis-aligned`); });
    if (!pointInPolygon(r.label[0], r.label[1], p)) bad.push(`${r.id}: label outside`);
    for (const w of all) { const cx = w.x + w.w / 2, cy = w.y + w.h / 2; if (pointInPolygon(cx, cy, p)) bad.push(`${r.id}: ${w.id} inside the room`); }
    for (const z of r.zones || []) if (!pointInPolygon(z.label[0], z.label[1], p)) bad.push(`${r.id}: zone ${z.id} outside`);
  }
  const foot = sum(PLAN.walls, area) + sum(PLAN.openings, area) + sum(PLAN.rooms, (r) => polygonArea(r.polygon));
  if (Math.abs(foot - FOOTPRINT) > 1) bad.push(`footprint ${m2(foot)} vs ${m2(FOOTPRINT)} (a room is not closed)`);
  // segments tile the solids; locked parts untouched
  const segs = E.wallSegments();
  if (Math.abs(sum(segs, area) - sum(all, area)) > 0.5) bad.push('segments do not cover the walls exactly once');
  for (const w of PLAN.walls) if (Math.abs(sum(segs, (s) => inter(s, w)) - area(w)) > 0.5) bad.push(`${w.id} not covered once`);
  for (const s of LOCKED) if (Math.abs(sum(all, (w) => inter(w, s)) - area(s)) > 0.5) bad.push(`locked ${s.id} changed`);
  for (const id of ['win-mamad', 'door-mamad']) if (!eq(opening(id), BASE_PLAN.openings.find((o) => o.id === id))) bad.push(`${id} changed`);
  for (const w of PLAN.walls) if (!['exterior', 'interior', 'mamad'].includes(w.kind)) bad.push(`${w.id}: kind ${w.kind}`);
  // derived data is what a fresh recompute gives; walk blockers and snap faces follow the plan
  const re = E.recomputePlan(PLAN);
  if (re.problems.length) bad.push('recompute problems ' + JSON.stringify(re.problems));
  if (!eq(re.rooms, PLAN.rooms)) bad.push('rooms are not a fixed point of recompute');
  if (!eq(re.wallOutline, PLAN.wallOutline)) bad.push('outline is stale');
  const blockers = walkBlockers();
  if (blockers.length !== PLAN.walls.length + PLAN.openings.filter((o) => o.kind === 'window').length) bad.push('walk blockers count');
  for (const r of PLAN.rooms) if (blockers.some((b) => r.label[0] > b.x && r.label[0] < b.x + b.w && r.label[1] > b.y && r.label[1] < b.y + b.h)) bad.push(`${r.id}: blocker on the label`);
  for (const f of wallFaces()) if (!PLAN.wallOutline.some((s) => s[0] === f.x1 && s[1] === f.y1 && s[2] === f.x2 && s[3] === f.y2)) { bad.push('wallFaces cache is stale'); break; }
  for (const r of PLAN.rooms) if (!isIndoors(r.label[0], r.label[1])) bad.push(`${r.id}: label not indoors`);
  return bad;
}
const sound = (name) => { const bad = invariants(); check(`invariants after ${name}`, bad.length === 0, bad.slice(0, 4).join(' | ')); };
const refused = (name, res, re) => check(`${name} is refused`, res.ok === false && typeof res.reason === 'string' && res.reason.length > 10 && (!re || re.test(res.reason)), res.ok ? 'was allowed' : res.reason);

// ------------------------------------------------------------------------------------------------
group('1. Architect\'s plan: segments and classification');
{
  const segs = E.wallSegments(), all = [...PLAN.walls, ...PLAN.openings];
  check('segments cover every wall + opening exactly once', sum(segs, area) === sum(all, area) && PLAN.walls.every((w) => sum(segs, (s) => inter(s, w)) === area(w))
    && segs.every((a, i) => segs.every((b, j) => i >= j || !ov(a, b))), `${segs.length} segments, ${m2(sum(segs, area)).toFixed(2)} m²`);
  check('segment ids are unique and geometric', new Set(segs.map((s) => s.id)).size === segs.length && segs.every((s) => /^seg:[hv]:\d+:\d+:\d+$/.test(s.id)));
  const cls = (c) => segs.filter((s) => s.cls === c);
  const mamadWalls = BASE_PLAN.walls.filter((w) => w.kind === 'mamad');
  check('mamad shell is locked', cls('mamad').length === 7 && cls('mamad').every((s) => s.policy.level === 'locked' && /Civil Defence/.test(s.policy.reason))
    && mamadWalls.every((w) => sum(cls('mamad'), (s) => inter(s, w)) === area(w)), cls('mamad').map((s) => s.id).join(' '));
  const outdoor = (id) => id === 'outside' || PLAN.outdoorAreas.some((o) => o.id === id);
  check('exterior envelope is locked', cls('exterior').length === 19 && cls('exterior').every((s) => s.policy.level === 'locked' && s.between.some(outdoor))
    && segs.every((s) => !s.between.some(outdoor) || s.cls === 'exterior' || s.cls === 'mamad'));
  check('every exterior opening sits in an envelope segment, every interior one in an interior wall',
    PLAN.openings.every((o) => { const s = segs.find((g) => g.openingIds.includes(o.id)); return s && (o.exterior ? s.cls === 'exterior' || s.cls === 'mamad' : s.cls !== 'exterior'); }));
  check('20 cm interior walls → thick / warn', eq(cls('thick').map((s) => s.id).sort(), ['seg:h:510:950:1050', 'seg:h:770:360:685', 'seg:v:1135:750:870', 'seg:v:340:720:770', 'seg:v:340:790:900'])
    && cls('thick').every((s) => s.thickness === 20 && s.policy.level === 'warn' && /structural engineer/.test(s.policy.reason)));
  check('10 cm partitions → free', cls('partition').length === 14 && cls('partition').every((s) => s.thickness === 10 && s.policy.level === 'free'));
  check('nothing is new on the architect\'s plan', segs.every((s) => !s.isNew) && !E.isPlanModified() && E.planDiff().changed === false);
  check('segmentAt hit-tests', E.segmentAt(1335, 1055)?.id === 'seg:h:1050:1155:1515' && E.segmentAt(1335, 1100) === null && E.segmentAt(1335, 1064)?.id === 'seg:h:1050:1155:1515');
  check('opening policies', E.openingPolicy('win-mamad').level === 'locked' && E.openingPolicy('door-mamad').level === 'locked'
    && E.openingPolicy('win-bath').level === 'permit' && E.openingPolicy('door-entry').level === 'permit' && E.openingPolicy('door-bath').level === 'free');
  sound('nothing');
}

group('2. Recompute on the untouched plan');
{
  const re = E.recomputePlan(BASE_PLAN);
  check('same room ids', eq(re.rooms.map((r) => r.id), BASE_PLAN.rooms.map((r) => r.id)));
  check('room areas within 0.01 m²', re.rooms.every((r, i) => Math.abs(m2(polygonArea(r.polygon)) - m2(polygonArea(BASE_PLAN.rooms[i].polygon))) < 0.01));
  check('rooms identical (polygons, labels, zones, drawn areas)', eq(re.rooms, BASE_PLAN.rooms));
  const key = (s) => s.join(',');
  const a = new Set(re.wallOutline.map(key)), b = new Set(BASE_PLAN.wallOutline.map(key));
  check('wall outline reproduced exactly (as a set)', a.size === b.size && [...a].every((k) => b.has(k)), `${a.size} segments`);
  check('opening rooms / exterior flags unchanged', eq(re.openings, BASE_PLAN.openings));
  check('no problems', re.problems.length === 0);
}

const CANON_WALLS = E.recomputePlan(BASE_PLAN).walls.length;

group('3. Remove the partition between Bedroom 1 and Bedroom 2');
{
  store.setFinish('bedroom-2', { wallColor: '#aabbcc' });
  store.setFinish('bedroom-1', { wallColor: '#112233' });
  const undoDepth = store._undo.length; events.length = 0;
  const res = E.removeWallSegment('seg:h:1050:1155:1515');
  check('allowed, level free', res.ok && res.level === 'free', res.reason);
  const merged = room('bedroom-1');
  check('rooms merge into one of ≈ 21.96 m²', PLAN.rooms.length === 8 && !room('bedroom-2') && merged && Math.abs(m2(polygonArea(merged.polygon)) - 21.96) < 0.005, merged && m2(polygonArea(merged.polygon)).toFixed(2));
  check('merged room keeps name, drops the stale drawn area, label inside', merged.name === 'Bedroom 1' && merged.drawnArea === undefined && pointInPolygon(merged.label[0], merged.label[1], merged.polygon));
  check('one fewer wall', PLAN.walls.length === CANON_WALLS - 1, `${PLAN.walls.length} vs ${CANON_WALLS} (clean decomposition of the architect's walls)`);
  check('windows of both bedrooms now belong to the merged room', eq(opening('win-bedroom-2').rooms, ['bedroom-1', 'outside']) && eq(opening('door-bedroom-2').rooms, ['main', 'bedroom-1']));
  check("'plan' event", events.length === 1 && events[0].reason === 'remove-wall' && events[0].changed.walls && events[0].changed.rooms && events[0].changed.openings);
  check('finishes of the vanished room are dropped', !store.finishes['bedroom-2'] && !!store.finishes['bedroom-1']);
  check('one undo step; plan is modified; diff lists it', store._undo.length === undoDepth + 1 && E.isPlanModified()
    && eq(E.planDiff().items.map((i) => [i.kind, i.level]), [['wall-removed', 'free']]), E.planDiff().items.map((i) => i.text).join(' | '));
  sound('removal');
  const after = snapshot();
  store.undo();
  check('undo restores the architect\'s plan exactly', planEqualsBase() && !E.isPlanModified() && store.finishes['bedroom-2']?.wallColor === '#aabbcc');
  store.redo();
  check('redo re-applies exactly', snapshot() === after && !store.finishes['bedroom-2']);
  store.undo(); store.undo(); store.undo();
  check('back to start', planEqualsBase() && Object.keys(store.finishes).length === 0);
}

group('4. Add a partition across the open living space');
{
  const before = sum(PLAN.rooms, (r) => polygonArea(r.polygon));
  const dry = E.canAddWall({ x1: 1000, y1: 135, x2: 1002, y2: 500 });
  check('dry run trims to the wall faces', dry.ok && eq(dry.rect, { x: 995, y: 120, w: 10, h: 390 }) && dry.level === 'free' && !E.isPlanModified(), JSON.stringify(dry));
  const res = E.addWall({ x1: 1000, y1: 135, x2: 1002, y2: 500 });
  check('allowed, level free', res.ok && res.level === 'free' && eq(res.ids, ['seg:v:995:120:510']), res.reason || res.ids.join());
  const fresh = PLAN.rooms.find((r) => r.id === 'room-1');
  check('a new room appears', PLAN.rooms.length === 10 && fresh && fresh.name === 'New room' && fresh.type === 'living', PLAN.rooms.map((r) => r.id).join());
  check('new room is 2.95 × 3.90 m and takes the Living Room zone', fresh && Math.abs(m2(polygonArea(fresh.polygon)) - 11.505) < 0.001 && eq((fresh.zones || []).map((z) => z.id), ['living'])
    && !room('main').zones.some((z) => z.id === 'living') && room('main').zones.length === 5);
  const now = sum(PLAN.rooms, (r) => polygonArea(r.polygon));
  check('indoor area conserved minus the wall footprint', Math.abs(before - now - 10 * 390) < 1e-6, `${m2(before).toFixed(3)} → ${m2(now).toFixed(3)} m²`);
  check('warned that the new room has no door', res.warnings.some((w) => /New room has no door/.test(w)), res.warnings.join(' | '));
  const s = seg('seg:v:995:120:510');
  check('new wall is a free partition', s && s.isNew && s.cls === 'partition' && s.policy.level === 'free' && eq(s.between, ['main', 'room-1']));
  check('new wall rect is an interior partition', PLAN.walls.some((w) => w.x === 995 && w.y === 120 && w.w === 10 && w.h === 390 && w.kind === 'interior' && w.cls === 'partition'));
  check('window now belongs to the new room', eq(opening('win-living-e').rooms, ['room-1', 'outside']));
  sound('add wall');
  const door = E.addOpening({ kind: 'opening', x: 1000, y: 300, width: 120 });
  check('door-less passage into the new wall', door.ok && door.level === 'free' && opening(door.ids[0]).kind === 'opening' && eq(opening(door.ids[0]).rooms, ['main', 'room-1']), door.reason);
  sound('passage');
  const diff = E.planDiff();
  check('diff: wall added + opening added', eq(diff.items.map((i) => i.kind).sort(), ['opening-added', 'wall-added']) && diff.items.every((i) => i.level === 'free' && typeof i.text === 'string' && i.at && i.ref), diff.items.map((i) => i.text).join(' | '));
  const moved = E.moveWallSegment('seg:v:995:120:510', 20);
  check('move the new wall 20 cm east (passage travels with it)', moved.ok && eq(moved.ids, ['seg:v:1015:120:510']) && opening(door.ids[0]).x === 1015 && Math.abs(m2(polygonArea(room('room-1').polygon)) - 2.75 * 3.9) < 0.001, moved.reason);
  refused('moving it to 25 cm from the end of the wall it stands on', E.moveWallSegment('seg:v:1015:120:510', -40), /stub/);
  sound('move wall');
  refused('moving it onto the window wall', E.moveWallSegment('seg:v:1015:120:510', 400));
  const shorter = E.resizeWallSegment('seg:v:1015:120:510', { end: 400 });
  check('shorten it → rooms merge again', shorter.ok && PLAN.rooms.length === 9 && !room('room-1') && room('main').zones.length === 6, shorter.reason);
  sound('resize wall');
  refused('shortening it to a 40 cm gap', E.resizeWallSegment('seg:v:1015:120:400', { end: 470 }), /narrower than 60/);
  const gone = E.removeWallSegment('seg:v:1015:120:400');
  check('remove it → the architect\'s plan again', gone.ok && planEqualsBase() && !E.isPlanModified() && E.planDiff().items.length === 0, gone.reason);
  while (store.historyState().canUndo) store.undo();
  check('undo all the way back', planEqualsBase());
}

group('5. Locked operations are refused with a reason');
{
  const before = snapshot();
  refused('removing an exterior wall', E.removeWallSegment('seg:v:1515:750:1050'), /building envelope/);
  refused('moving an exterior wall', E.moveWallSegment('seg:h:1360:1155:1515', -20), /building envelope/);
  refused('removing a mamad wall', E.removeWallSegment('seg:h:900:360:660'), /Civil Defence/);
  refused('moving a mamad wall', E.moveWallSegment('seg:v:660:920:1050', 10), /Civil Defence/);
  refused('moving win-mamad', E.updateOpening('win-mamad', { x: 480, y: 1285 }), /Civil Defence/);
  refused('changing door-mamad', E.updateOpening('door-mamad', { width: 90 }), /Civil Defence/);
  refused('flipping door-mamad', E.flipDoor('door-mamad', 'swing'), /Civil Defence/);
  refused('removing win-mamad', E.removeOpening('win-mamad'), /Civil Defence/);
  refused('a door into a mamad wall', E.addOpening({ kind: 'door', x: 500, y: 910 }), /Civil Defence/);
  refused('a wall inside the mamad', E.addWall({ x1: 365, y1: 1100, x2: 655, y2: 1100 }), /Civil Defence/);
  refused('a wall on the terrace (outdoors)', E.addWall({ x1: 100, y1: 300, x2: 300, y2: 300 }), /inside the house/);
  refused('a wall through an exterior wall', E.addWall({ x1: 1400, y1: 900, x2: 1600, y2: 900 }));
  refused('a wall through a door', E.addWall({ x1: 1000, y1: 1000, x2: 1300, y2: 1000 }), /door or window/);
  refused('a wall ending on the terrace door', E.addWall({ x1: 360, y1: 500, x2: 900, y2: 500 }));
  refused('a wall 30 cm from a parallel wall', E.addWall({ x1: 400, y1: 740, x2: 680, y2: 740 }), /narrower than 60/);
  refused('a 30 cm thick new wall', E.addWall({ x1: 1000, y1: 130, x2: 1000, y2: 500, thickness: 30 }), /7–20/);
  refused('an interior window', E.addOpening({ kind: 'window', x: 1335, y: 1055 }), /exterior/);
  refused('a door-less hole in an exterior wall', E.addOpening({ kind: 'opening', x: 1525, y: 900 }));
  refused('a door where there is no wall', E.addOpening({ kind: 'door', x: 700, y: 400 }), /no wall/);
  refused('a 4 m door', E.addOpening({ kind: 'door', x: 1335, y: 1055, width: 400 }));
  refused('an unknown segment', E.removeWallSegment('seg:v:1:2:3'));
  check('nothing changed, no history, no events', snapshot() === before && planEqualsBase() && !store.historyState().canUndo);
}

group('6. Exterior openings need a permit');
{
  events.length = 0;
  const res = E.updateOpening('win-bedroom-1', { offset: 40 });
  const o = opening('win-bedroom-1');
  check('moving an exterior window → level permit', res.ok && res.level === 'permit' && /building-permit amendment/.test(res.warnings[0]) && o.y === 1100 && o.h === 140, res.reason);
  check('it is clamped 10 cm from the wall end', E.updateOpening('win-bedroom-1', { offset: -500 }).ok && opening('win-bedroom-1').y === 1070);
  sound('window move');
  const wide = E.updateOpening('win-bedroom-1', { width: 200, sill: 90, height: 120 });
  check('resize + sill + height → permit, label follows', wide.ok && wide.level === 'permit' && opening('win-bedroom-1').label === '200 / 120(+90)' && opening('win-bedroom-1').h === 200, wide.reason);
  refused('a window taller than the wall', E.updateOpening('win-bedroom-1', { height: 250 }));
  const added = E.addOpening({ kind: 'window', x: 1300, y: 1370 });
  check('new exterior window 100 × 100 sill 110 → permit', added.ok && added.level === 'permit' && eq(opening(added.ids[0]).rooms, ['bedroom-1', 'outside'])
    && opening(added.ids[0]).exterior === true && opening(added.ids[0]).outside === 's' && opening(added.ids[0]).sill === 110, added.reason);
  const door = E.addOpening({ kind: 'door', x: 5, y: 1280 });
  check('new exterior door → permit, opens inwards', door.ok && door.level === 'permit' && opening(door.ids[0]).style === 'service' && opening(door.ids[0]).swing === 'e' && opening(door.ids[0]).outside === 'w', door.reason);
  const closed = E.removeOpening('win-bath');
  check('closing an exterior window → permit, filled with wall', closed.ok && closed.level === 'permit' && !opening('win-bath') && PLAN.walls.some((w) => w.kind === 'exterior' && w.x <= 815 && w.x + w.w >= 895 && w.y === 1360));
  check('re-hanging the entrance door needs no permit', E.flipDoor('door-entry', 'hinge').level === 'free' && opening('door-entry').hinge === 'n');
  sound('exterior edits');
  const diff = E.planDiff();
  check('diff: permits', diff.items.filter((i) => i.level === 'permit').length === 4 && eq(diff.items.map((i) => i.kind).sort(), ['opening-added', 'opening-added', 'opening-changed', 'opening-changed', 'opening-removed']), diff.items.map((i) => `${i.level}: ${i.text}`).join(' | '));
  check('every edit emitted one plan event', events.length === 7 && events.every((e) => e.changed.openings));
  const res2 = E.resetPlan();
  check('resetPlan → architect\'s plan, undoable', res2.ok && planEqualsBase() && events[events.length - 1].reason === 'reset');
  store.undo();
  check('undo of reset brings the edits back', !opening('win-bath') && E.isPlanModified());
  while (store.historyState().canUndo) store.undo();
  check('undo all', planEqualsBase());
}

group('7. Thick interior walls warn');
{
  const res = E.removeWallSegment('seg:h:510:950:1050');
  check('removal → level warn + engineer warning', res.ok && res.level === 'warn' && /20 cm wall may be structural/.test(res.warnings[0]), res.reason);
  check('diff says warn', eq(E.planDiff().items.map((i) => [i.kind, i.level]), [['wall-removed', 'warn']]), E.planDiff().items.map((i) => i.text).join());
  sound('thick removal');
  store.undo();
  refused('moving the master-bedroom door wall so that a 50 cm pocket is left', E.moveWallSegment('seg:v:340:790:900', -30), /narrower than 60/);
  const moved = E.moveWallSegment('seg:v:340:790:900', 30);
  check('moving it 30 cm into the corridor → warn, door follows', moved.ok && moved.level === 'warn' && opening('door-parents').x === 370
    && Math.abs(m2(polygonArea(room('parents-bedroom').polygon)) - (15.04 + 0.3 * 1.1)) < 0.001, moved.reason || m2(polygonArea(room('parents-bedroom').polygon)));
  check('diff: wall moved', E.planDiff().items.some((i) => i.kind === 'wall-moved' && i.level === 'warn' && /30 cm east/.test(i.text)), E.planDiff().items.map((i) => i.text).join(' | '));
  sound('thick move');
  const back = E.moveWallSegment(moved.ids[0], -30);
  check('moving it back → architect\'s plan', back.ok && planEqualsBase(), back.reason);
  while (store.historyState().canUndo) store.undo();
}

group('8. Interior door: add, slide, re-hang, remove');
{
  const dry = E.canAddOpening({ kind: 'door', x: 1330, y: 1052 });
  check('dry run', dry.ok && dry.segmentId === 'seg:h:1050:1155:1515' && eq(dry.rect, { x: 1290, y: 1050, w: 80, h: 10 }) && dry.level === 'free', JSON.stringify(dry));
  const add = E.addOpening({ kind: 'door', x: 1330, y: 1052 });
  const id = add.ids && add.ids[0];
  check('interior door 80 × 210 → free', add.ok && add.level === 'free' && eq([opening(id).width, opening(id).height, opening(id).sill, opening(id).style], [80, 210, 0, 'interior'])
    && eq(opening(id).rooms, ['bedroom-2', 'bedroom-1']) && !opening(id).exterior && ['e', 'w'].includes(opening(id).hinge) && ['n', 's'].includes(opening(id).swing), add.reason);
  sound('add door');
  const slide = E.updateOpening(id, { x: 1500, y: 1055 });
  check('slide along the wall, clamped 10 cm from the end', slide.ok && slide.level === 'free' && opening(id).x === 1425, opening(id).x);
  const hinge = opening(id).hinge, swing = opening(id).swing;
  check('flip hinge and swing', E.flipDoor(id, 'hinge').ok && E.flipDoor(id, 'swing').ok && opening(id).hinge !== hinge && opening(id).swing !== swing);
  refused('a hinge on the wrong axis', E.updateOpening(id, { hinge: 'n' }));
  const second = E.addOpening({ kind: 'door', x: 1420, y: 1055, width: 70 });
  check('a second door keeps 10 cm of wall to the first', second.ok && opening(second.ids[0]).x + 70 + 10 <= opening(id).x, second.reason);
  sound('door edits');
  check('wider than the remaining wall is refused', E.updateOpening(id, { width: 200 }).ok === false);
  E.removeOpening(second.ids[0]);
  const rem = E.removeOpening(id);
  check('remove it → plan equals the architect\'s again', rem.ok && planEqualsBase() && !E.isPlanModified() && store.serialize().planEdits === null);
  // a drag is one undo step and can be cancelled
  const depth = store._undo.length;
  store.begin();
  for (const off of [20, 60, 100]) E.updateOpening('win-living-e', { offset: off }, { transient: true });
  store.commit();
  check('begin / transient updates / commit = one undo step', store._undo.length === depth + 1 && opening('win-living-e').y === 220);
  store.undo();
  check('… and one undo reverts the whole drag', planEqualsBase() && store._undo.length === depth);
  store.begin(); E.removeOpening('door-wc', { transient: true }); store.cancel();
  check('cancel() restores the plan', !!opening('door-wc'));
  while (store.historyState().canUndo) store.undo();
  check('undo all', planEqualsBase());
}

group('9. Serialize → load round trip');
{
  E.removeWallSegment('seg:h:1050:1155:1515');
  E.addWall({ x1: 1000, y1: 130, x2: 1000, y2: 500, thickness: 7 });
  E.addOpening({ kind: 'door', x: 1000, y: 300 });
  E.updateOpening('win-living-n', { width: 150 });
  E.updateRoom('room-1', { name: 'Study', type: 'bedroom' });
  store.setFinish('room-1', { wallColor: '#ddeeff' });
  const file = JSON.parse(JSON.stringify(store.serialize())), state = snapshot();
  check('planEdits holds walls + openings (+ room names)', file.planEdits && Array.isArray(file.planEdits.walls) && Array.isArray(file.planEdits.openings) && file.planEdits.rooms.some((r) => r.name === 'Study'));
  check('7 cm partition keeps its thickness', E.wallSegments().some((s) => s.isNew && s.thickness === 7));
  store.load({ items: [], finishes: {} });
  check('a file without planEdits restores the architect\'s plan', planEqualsBase() && !E.isPlanModified());
  events.length = 0;
  store.load(file);
  check('load re-applies the edited plan exactly', snapshot() === state && E.isPlanModified() && room('room-1').name === 'Study' && store.finishes['room-1']?.wallColor === '#ddeeff');
  check("load emits 'plan' with reason load", events.length === 1 && events[0].reason === 'load');
  sound('load');
  const noRooms = JSON.parse(JSON.stringify(file)); delete noRooms.planEdits.rooms;
  store.load({ items: [], finishes: {} }); store.load(noRooms);
  check('walls + openings alone are enough (rooms re-derived)', eq(PLAN.walls, JSON.parse(state)[0]) && PLAN.rooms.length === 9 && invariants().length === 0);
  const hacked = JSON.parse(JSON.stringify(file));
  hacked.planEdits.walls = hacked.planEdits.walls.filter((w) => w.kind !== 'mamad');
  store.load(hacked);
  check('a file that touches the mamad shell falls back to the architect\'s plan', planEqualsBase());
  store.load({ items: [], finishes: {}, planEdits: { walls: 'x' } });
  check('garbage planEdits do not throw', planEqualsBase());
  store.load({ items: [], finishes: {} });
  store._undo.length = 0; store._redo.length = 0;
}

group('10. Store still behaves (items, history) and plan + items share one history');
{
  const it = store.addItem({ type: 'sofa', w: 200, d: 90, h: 80, x: 700, y: 950 });
  E.removeWallSegment('seg:h:1050:1155:1515');
  store.updateItem(it.id, { rot: 90 });
  store.undo();
  check('undoing an item change leaves the plan edit', E.isPlanModified() && store.getItem(it.id).rot === 0);
  store.undo();
  check('next undo reverts the plan edit only', planEqualsBase() && store.items.length === 1);
  store.undo();
  check('next undo removes the item', store.items.length === 0 && !store.historyState().canUndo);
  store.redo(); store.redo(); store.redo();
  check('redo ×3', store.items.length === 1 && store.getItem(it.id).rot === 90 && E.isPlanModified());
  while (store.historyState().canUndo) store.undo();
  store._redo.length = 0;
}

group('10b. Junctions: free-standing walls, corners that follow, walls that slide along others');
{
  const mainArea = () => polygonArea(room('main').polygon), a0 = mainArea();
  const isle = E.addWall({ x1: 500, y1: 400, x2: 800, y2: 400 });
  check('free-standing partition: the room polygon gets a hole (slit), area − 0.30 m²', isle.ok && eq(isle.ids, ['seg:h:395:500:800']) && a0 - mainArea() === 3000
    && !pointInPolygon(650, 400, room('main').polygon) && pointInPolygon(650, 420, room('main').polygon) && PLAN.rooms.length === 9, isle.reason);
  sound('free-standing wall');
  const arm = E.addWall({ x1: 795, y1: 400, x2: 795, y2: 600 });
  check('second wall from its end makes a clean L (trimmed to the first wall\'s face)', arm.ok && eq(arm.ids, ['seg:v:790:405:600']) && !!seg('seg:h:395:500:790'), arm.reason || arm.ids.join());
  const north = E.moveWallSegment('seg:h:395:500:790', -50);
  check('moving one arm away: the other stretches to follow', north.ok && eq(north.ids, ['seg:h:345:500:790']) && !!seg('seg:v:790:355:600'), north.reason);
  const south = E.moveWallSegment('seg:h:345:500:790', 120);
  check('moving it back over the other arm: that one shrinks', south.ok && !!seg('seg:v:790:475:600') && a0 - mainArea() === 300 * 10 + 125 * 10, south.reason);
  sound('L moves');
  const cross = E.addWall({ x1: 600, y1: 300, x2: 600, y2: 700 });
  check('a wall may cross a partition (X junction)', cross.ok && eq(cross.ids, ['seg:v:595:300:465', 'seg:v:595:475:700']) && PLAN.walls.some((w) => w.x === 500 && w.y === 465 && w.w === 300), cross.reason);
  sound('crossing');
  E.resetPlan();
  // sliding a T-wall along the walls it stands on; the walls it carried follow
  const hall = E.moveWallSegment('seg:v:1145:880:1050', -30);
  check('hall / bedroom-2 wall 30 cm west: door travels, bedroom partition stretches', hall.ok && opening('door-bedroom-2').x === 1115 && !!seg('seg:h:1050:1125:1145')
    && Math.abs(m2(polygonArea(room('bedroom-2').polygon)) - (10.8 + 0.3 * 1.7)) < 0.001, hall.reason);
  check('diff reports one moved wall (no noise for the stretch or the carried door)', eq(E.planDiff().items.map((i) => i.kind), ['wall-moved']), E.planDiff().items.map((i) => i.text).join(' | '));
  sound('T move');
  refused('moving the bedroom partition onto a door that cannot ride along', E.moveWallSegment('seg:h:1050:1155:1515', 50), /door beside the end of this wall/);
  refused('moving a wall through another wall', E.moveWallSegment('seg:h:1050:1155:1515', 400));
  E.resetPlan();
  check('reset', planEqualsBase());
  store._undo.length = 0; store._redo.length = 0;
}

group('10c. Doors at the corner of a moved wall travel with it');
{
  E.resetPlan();
  const P = 'seg:h:1050:1155:1515';            // partition Bedroom 2 | Bedroom 1, ends on the hall wall between the two doors
  const d1 = () => opening('door-bedroom-1'), d2 = () => opening('door-bedroom-2');
  const before = snapshot(), n = events.length, undoDepth = store._undo.length;
  const north = E.moveWallSegment(P, -5);
  check('partition 5 cm north: allowed although both bedroom doors are 10 cm from its end', north.ok && eq(north.ids, ['seg:h:1045:1155:1515']), north.reason);
  check('…both doors keep their 10 cm jamb (they travel 5 cm north)', d1().y === 1065 && d2().y === 945 && d1().rooms.includes('bedroom-1') && d2().rooms.includes('bedroom-2'));
  check('…one undo step, one plan event', events.length === n + 1 && events[n].reason === 'move-wall' && store._undo.length === undoDepth + 1);
  sound('door rides along');
  const far = E.moveWallSegment('seg:h:1045:1155:1515', -55);
  check('then 55 cm further north in one call', far.ok && d1().y === 1010 && d2().y === 890 && Math.abs(m2(polygonArea(room('bedroom-2').polygon)) - 3.6 * 2.4) < 0.001, far.reason);
  sound('door rides far');
  const tooFar = E.moveWallSegment('seg:h:990:1155:1515', -5);
  check('the Bedroom 2 door cannot go further (its wall ends 10 cm beyond it): refused, with the reason', !tooFar.ok && /Bedroom|door beside the end of this wall/.test(tooFar.reason), tooFar.reason);
  store.undo(); store.undo();
  check('undo twice: the architect\'s plan again', planEqualsBase() && snapshot() === before);
  const south = E.moveWallSegment(P, 5);
  check('south: the Bedroom 1 door fills its wall (10 + 90 + 10 cm) — refused with a reason, nothing changed', !south.ok && /move or narrow the door first/.test(south.reason) && snapshot() === before, south.reason);
  // a door further than 20 cm from the end does not ride: it stays, and blocks only when the wall comes too close
  E.updateOpening('door-bedroom-2', { offset: 20 });               // hall wall core 880..1050 → door at 900..990, 60 cm from the partition
  const y2 = d2().y, away = E.moveWallSegment(P, -40);
  check('a door 60 cm from the end stays put while the wall moves 40 cm towards it', away.ok && d2().y === y2 && d1().y === 1030, away.reason);
  store.undo();
  const close = E.moveWallSegment(P, -55);
  check('…and the wall cannot come within 10 cm of it (refused with the jamb reason)', !close.ok && /keep at least 10 cm/.test(close.reason), close.reason);
  E.resetPlan();
  check('reset', planEqualsBase());
  store._undo.length = 0; store._redo.length = 0;
}

group('11. 200 random valid edits, then resetPlan()');
{
  let seed = 98;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const kinds = ['door', 'door', 'window', 'sliding-door', 'opening'];
  const ops = {
    addWall: () => { const horizontal = rnd() < 0.5, x = 30 + rnd() * 1480, y = 30 + rnd() * 1330, len = 60 + rnd() * 400; return E.addWall({ x1: x, y1: y, x2: horizontal ? x + len : x, y2: horizontal ? y : y + len, thickness: pick([7, 10, 10, 10, 15, 20]) }); },
    removeWall: () => E.removeWallSegment(pick(E.wallSegments()).id),
    moveWall: () => E.moveWallSegment(pick(E.wallSegments()).id, pick([-60, -40, -20, -10, -5, 5, 10, 20, 40, 60])),
    resizeWall: () => { const s = pick(E.wallSegments()), a = s.axis === 'h' ? s.core.x : s.core.y, len = s.axis === 'h' ? s.core.w : s.core.h; return E.resizeWallSegment(s.id, rnd() < 0.5 ? { start: a + pick([-80, -40, 40, 80]) } : { end: a + len + pick([-80, -40, 40, 80]) }); },
    addOpening: () => { const s = pick(E.wallSegments()); return E.addOpening({ kind: pick(kinds), x: s.x + rnd() * s.w, y: s.y + rnd() * s.h, width: pick([undefined, 70, 90, 120]) }); },
    updateOpening: () => E.updateOpening(pick(PLAN.openings).id, pick([{ offset: rnd() * 300 }, { width: pick([60, 80, 100, 140]) }, { sill: pick([0, 90, 120]), height: pick([60, 100, 120, 210]) }, { x: rnd() * 1500, y: rnd() * 1380 }])),
    removeOpening: () => E.removeOpening(pick(PLAN.openings).id),
    flipDoor: () => E.flipDoor(pick(PLAN.openings).id, pick(['hinge', 'swing'])),
    undo: () => { if (!store.historyState().canUndo) return { ok: false, reason: '' }; store.undo(); return { ok: true, level: 'free' }; },
  };
  const weights = { addWall: 5, removeWall: 2, moveWall: 4, resizeWall: 2, addOpening: 4, updateOpening: 4, removeOpening: 1, flipDoor: 1, undo: 1 };
  const bag = Object.entries(weights).flatMap(([k, n]) => Array(n).fill(k));
  const done = {}, levels = {}, broken = [];
  let ok = 0, tries = 0, worst = 0, total = 0, timed = 0;
  while (ok < 200 && tries < 20000) {
    tries++;
    const name = pick(bag), before = snapshot(), t0 = performance.now();
    let res;
    try { res = ops[name](); } catch (e) { broken.push(`${name} threw ${e.message}`); break; }
    const dt = performance.now() - t0;
    if (!res.ok) { if (snapshot() !== before) broken.push(`${name} refused but changed the plan`); if (name !== 'undo' && !(res.reason && res.reason.length > 5)) broken.push(`${name} refused without a reason`); continue; }
    if (snapshot() === before) continue;                       // a no-op (e.g. offset already there)
    ok++; done[name] = (done[name] || 0) + 1; levels[res.level] = (levels[res.level] || 0) + 1;
    if (name !== 'undo') { total += dt; timed++; worst = Math.max(worst, dt); }
    const bad = invariants();
    if (bad.length) { broken.push(`after ${name} #${ok}: ${bad.slice(0, 3).join(' | ')}`); break; }
    const diff = E.planDiff();
    if (diff.changed !== E.isPlanModified() || (diff.changed && !diff.items.length && !planEqualsBase() && !eq(PLAN.rooms.map((r) => r.name), BASE_PLAN.rooms.map((r) => r.name)))) broken.push(`diff inconsistent after ${name} #${ok}`);
  }
  check('200 random edits succeeded with all invariants', ok === 200 && broken.length === 0, broken.slice(0, 3).join(' || ') || `${tries} attempts: ${JSON.stringify(done)} levels ${JSON.stringify(levels)}`);
  check('plan ends heavily modified', E.isPlanModified() && E.planDiff().items.length > 3, `${E.planDiff().items.length} diff items, ${PLAN.rooms.length} rooms, ${PLAN.walls.length} walls, ${PLAN.openings.length} openings`);
  const file = JSON.parse(JSON.stringify(store.serialize())), state = snapshot();
  store.load({ items: [], finishes: {} }); store.load(file);
  check('the random plan survives a save / load round trip', snapshot() === state);
  E.resetPlan();
  check('resetPlan() ends on the exact architect\'s plan', planEqualsBase() && !E.isPlanModified() && invariants().length === 0);
  check('performance: one mutation + recompute < 30 ms', worst < 30, `mean ${(total / timed).toFixed(2)} ms, worst ${worst.toFixed(2)} ms over ${timed} edits`);
  store._undo.length = 0; store._redo.length = 0;
}

group('12. Performance of single operations (warm)');
{
  const time = (f) => { const t = performance.now(); f(); return performance.now() - t; };
  const t = [
    time(() => E.removeWallSegment('seg:h:1050:1155:1515')), time(() => E.addWall({ x1: 1000, y1: 130, x2: 1000, y2: 500 })),
    time(() => E.moveWallSegment('seg:v:995:120:510', 20)), time(() => E.addOpening({ kind: 'door', x: 1050, y: 300 })),
    time(() => E.updateOpening('win-living-e', { offset: 30 })), time(() => store.undo()), time(() => E.resetPlan()),
  ];
  check('all of them were real edits', E.isPlanModified() === false && events.slice(-7).map((e) => e.reason).join() === 'remove-wall,add-wall,move-wall,add-opening,update-opening,history,reset', events.slice(-7).map((e) => e.reason).join());
  check('each < 30 ms', Math.max(...t) < 30, t.map((x) => x.toFixed(1)).join(' / ') + ' ms');
  check('final state is the architect\'s plan', planEqualsBase());
}

console.log(`\n${failed ? failed + ' FAILED, ' : ''}${passed} passed`);
console.log(failed ? 'PLAN EDIT HAS ERRORS' : 'PLAN EDIT OK');
process.exit(failed ? 1 : 0);
