// Regulations checker — runs on the architect's initial layout, prints a readable report and asserts a few
// expectations derived by hand from the plan, then edits the plan (src/core/plan-edit.js) and checks that the
// findings follow. Plain Node, no dependencies:  node tests/regulations.test.mjs
import { PLAN } from '../src/core/plan.js';
import { store } from '../src/core/store.js';
import { initialLayout } from '../src/core/initial-layout.js';
import { areaM2 } from '../src/core/geometry.js';
import * as E from '../src/core/plan-edit.js';
import { RULES, DISCLAIMER, CATEGORIES, runChecks, summarize } from '../src/regulations/index.js';

let failed = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok   ' + msg); else { failed++; console.error('  FAIL ' + msg); } };
const time = (fn) => { const t = performance.now(); const r = fn(); return [r, performance.now() - t]; };
const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

store.persist = false;
store.load({ items: initialLayout() });
const args = { store, plan: PLAN, catalog: null };

// ── 1. run + timing ──
let findings, cold;
try { [findings, cold] = time(() => runChecks(args)); } catch (e) { console.error(e); process.exit(1); }
const warm = []; for (let i = 0; i < 9; i++) warm.push(time(() => runChecks(args))[1]);

// ── 2. readable report ──
const ICON = { fail: '✗ FAIL', warn: '! WARN', info: 'i info', pass: '✓ pass' };
let cat = null;
for (const f of findings) {
  if (f.category !== cat) { cat = f.category; console.log(`\n━━ ${cat} ━━`); }
  console.log(`${ICON[f.severity]}  ${f.title}`);
  if (f.severity !== 'pass') console.log(`         ${f.detail}`);
}
const s = summarize(findings);
console.log(`\nSummary: ${s.pass} passed · ${s.info} notes · ${s.warn} warnings · ${s.fail} problems   (${findings.length} findings, ${RULES.length} rules)`);
console.log(`Timing: first run ${cold.toFixed(1)} ms (includes JIT warm-up and static caches), then median ${median(warm).toFixed(1)} ms\n`);

// ── 3. structure ──
console.log('Structure');
const ruleIds = new Set(RULES.map((r) => r.id));
ok(findings.length > 60, `returns findings (${findings.length})`);
ok(findings.every((f) => f.id && f.ruleId && f.title && f.detail && f.category && f.kind && typeof f.reference === 'string' && ['pass', 'info', 'warn', 'fail'].includes(f.severity)), 'every finding has id, ruleId, severity, category, kind, title, detail, reference');
ok(findings.every((f) => ruleIds.has(f.ruleId)), 'every finding points to a known rule');
ok(new Set(findings.map((f) => f.id)).size === findings.length, 'finding ids are unique');
ok(RULES.every((r) => r.id && r.category && ['regulation', 'standard', 'best-practice'].includes(r.kind) && r.title && r.requirement && r.reference && r.reference.name && r.reference.section && ['high', 'medium', 'low'].includes(r.confidence)), 'every rule has kind, requirement, reference and confidence');
ok(new Set(RULES.map((r) => r.id)).size === RULES.length, 'rule ids are unique');
ok(typeof DISCLAIMER === 'string' && /not a legal permit review/.test(DISCLAIMER), 'DISCLAIMER is exported');
ok(JSON.stringify(runChecks(args)) === JSON.stringify(findings), 'deterministic (same input → same output)');
ok(median(warm) < 50, `fast: median ${median(warm).toFixed(1)} ms < 50 ms`);
const itemIds = new Set(store.items.map((i) => i.id));
ok(findings.every((f) => !f.itemIds || f.itemIds.every((id) => itemIds.has(id))), 'itemIds refer to real items');

// ── 4. expectations derived by hand from the plan ──
console.log('Building (hand-checked against src/core/plan.js)');
const get = (id) => findings.find((f) => f.id === id);
const mamadDoor0 = PLAN.openings.find((o) => o.style === 'mamad' && o.kind === 'door');
const has = (id, sev, re) => { const f = get(id); return !!f && f.severity === sev && (!re || re.test(f.title + ' ' + f.detail)); };
// bedrooms: 3.60 × 3.00 = 10.80 m²; window 1.40 × 1.00 = 1.40 m² → 12.96 %
ok(has('light-habitable:bedroom-1', 'pass', /1\.40 m².*13\.0%.*10\.80 m²/), 'Bedroom 1 light ratio 1.40 m² / 10.80 m² = 13.0 %');
ok(has('light-habitable:bedroom-2', 'pass', /13\.0%/), 'Bedroom 2 light ratio 13.0 %');
// master bedroom: 3.20 × 4.70 = 15.04 m²; two windows 0.80 × 1.20 → 1.92 m² = 12.8 %
ok(has('light-habitable:parents-bedroom', 'pass', /1\.92 m².*12\.8%/), 'Master bedroom light ratio 1.92 m² / 15.04 m² = 12.8 %');
// living space: windows 1.8 + 1.8 + 2.16 + 2.16 + terrace door 5.88 = 13.80 m²
ok(has('light-habitable:main', 'pass', /13\.80 m²/), 'Open living space counts 4 windows + terrace door = 13.80 m²');
// family bathroom 2.20 × 3.00 = 6.60 m² → needs 0.66 m², window 0.80 × 0.70 = 0.56 m²
ok(has('light-service:bath', 'warn', /0\.56 m².*0\.66 m²/), 'Family bathroom window 0.56 m² < 0.66 m² → extractor needed');
ok(has('light-service:parents-bath', 'pass', /0\.56 m².*0\.51 m²/), 'Master bathroom window 0.56 m² ≥ 0.51 m²');
ok(has('light-service:wc', 'warn', /0\.24 m².*0\.30 m²/), 'Guest WC window 0.24 m² (assumed height) < 0.30 m²');
ok(has('room-size-habitable:bedroom-1', 'pass', /10\.80 m²/) && has('room-size-wc:wc', 'pass', /2\.10 m²/), 'Room areas: bedroom 10.80 m², WC 2.10 m²');
ok(has('ceiling-height:all', 'pass', /3\.00 m/), 'Ceiling 3.00 m ≥ 2.50 m');
ok(findings.some((f) => f.ruleId === 'corridor-width' && f.severity === 'pass' && /1\.10 m wide/.test(f.title)), 'Corridor derived from the living-space polygon: 1.10 m');
ok(has('door-entry:door-entry', 'pass', /110/), 'Entrance door 110 × 210 passes');
// mamad 3.00 × 3.50 = 10.5 m² net, × 3.00 = 31.5 m³
ok(has('mamad-area:mamad', 'pass', /10\.50 m².*31\.5 m³/), 'Mamad 10.5 m² net, 31.5 m³');
ok(has('mamad-height:mamad', 'warn', /2\.80 m/), 'Mamad height 3.00 m > 2.80 m is flagged for confirmation');
ok(has('mamad-door:door-mamad', 'pass', /80 × 200 cm, opens outwards/), 'Blast door 80 × 200 opening outwards');
// two doors in the safe-room doorway: the inner door is reported with its real status (optional, not required)
ok(mamadDoor0.innerDoor && has('mamad-inner-door:door-mamad', 'info', /Inner door 80 × 200.*opens into the room.*NOT required by the regulations.*202\(a\), 204\(a\).*287\(b\)/), 'Inner door of the safe room: present, opens inwards, reported as optional (regs. 202 / 204 / 287(b))');
ok(get('mamad-inner-door:door-mamad').kind === 'standard' && RULES.find((r) => r.id === 'mamad-inner-door').confidence === 'medium', 'Inner-door rule is guidance (not a regulation) with medium confidence');
ok(has('mamad-door-clear:door-mamad', 'pass', /4 m/), 'More than 4 m of free floor in front of the blast door (≥ 1.10 m required to a structural wall)');
ok(has('mamad-window:win-mamad', 'pass', /100 × 100/), 'Blast window 100 × 100, sill 110');
// shell walls (all four typed 'mamad' in the plan data) against Civil Defence reg. 208: internal ≥ 20 cm (north, east,
// west), external ≥ 25 cm and ≥ 30 cm for a sliding blast window (south, which holds the window)
ok(has('mamad-walls:mamad', 'pass', /north 20 cm \(internal; minimum 20 cm\).*east 25 cm \(internal; minimum 20 cm\).*south 30 cm \(external, holds the blast window; minimum 25 cm, 30 cm for a sliding blast window\).*west 20 cm \(internal; minimum 20 cm\).*all met.*All 4 walls are recorded as reinforced-concrete/),
  'Mamad shell walls 20 / 25 / 30 / 20 cm meet reg. 208 (internal 20, external 25, sliding-window wall 30) and are all typed mamad');
ok(has('mamad-ext-walls:mamad', 'pass', /1 external wall/), 'Mamad has one external wall');
ok(has('parking-count:count', 'pass', /2 parking/), '2 parking places');
ok(has('parking-size:parking-1', 'pass', /2\.50 × 5\.00/) && has('parking-size:parking-2', 'pass', /2\.50 × 5\.00/), 'Both bays 2.50 × 5.00 m inside the lot');
ok(has('setbacks:house', 'pass', /west 6\.0\d m.*north 3\.0\d m.*east 3\.4\d m.*south 3\.10 m/), 'Setbacks: W ≈ 6.05, N ≈ 3.08, E ≈ 3.49, S 3.10 m');
ok(has('building-line:house', 'pass') && has('building-line:utility-yard', 'info', /1\.90 m/), 'House inside the building line; utility yard 1.90 m beyond it');
ok(has('plan-change-summary:all', 'pass') && findings[0].category === CATEGORIES[0] && CATEGORIES[0] === 'Changes to the approved plan' && findings.filter((f) => f.category === CATEGORIES[0]).length === 1,
  'Unmodified plan: one passing summary in "Changes to the approved plan"');
ok(findings.filter((f) => f.ruleId === 'assumption' && f.severity === 'info').length === PLAN.assumptions.filter((a) => a.status !== 'confirmed').length, 'Open drawing assumptions are listed');

console.log('Architect layout');
ok(has('item-in-wall:all', 'pass') && has('door-swing:all', 'pass') && has('window-blocked:all', 'pass'), 'No item in a wall, door swing or in front of a window');
ok(has('walkway:all', 'pass'), 'Every room reachable along ≥ 80 cm routes');
ok(findings.some((f) => f.ruleId === 'dining-clearance' && f.severity === 'warn' && /south 50 cm/.test(f.detail)), 'Dining table: only 50 cm to the corridor wall on the south side');
ok(findings.some((f) => f.ruleId === 'kitchen-aisle' && f.severity === 'pass' && /113 cm/.test(f.title)), 'Kitchen aisle 113 cm between the north run and the island');
ok(findings.some((f) => f.ruleId === 'kitchen-seating' && /5 seats, 56 cm/.test(f.title)), 'Island: 5 stools on 2.80 m = 56 cm each');
ok(findings.some((f) => f.ruleId === 'bed-clearance' && f.severity === 'pass' && /Double bed/.test(f.title)), 'Double bed accessible from both sides');
ok(has('entry-path:path', 'pass') && has('parking-clear:parking-1', 'pass'), 'Entry path and parking bays clear');
ok(s.fail === 0, `no hard failures on the architect's layout (${s.warn} warnings)`);

// ── 5. the checker reacts to changes (positions derived from the plan, nothing hard-coded) ──
console.log('Reacts to the design');
const room = (id) => PLAN.rooms.find((r) => r.id === id);
const mid = (poly) => { const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; };
const mamadDoor = PLAN.openings.find((o) => o.kind === 'door' && o.rooms.includes('mamad'));
const mamadWin = PLAN.openings.find((o) => o.kind === 'window' && o.rooms.includes('mamad'));
const bay = PLAN.site.parking[0], b = PLAN.site.boundary;
const [mx, my] = mid(room('mamad').polygon);
const lotX = Math.min(...b.map((p) => p[0])), lotY = Math.max(...b.map((p) => p[1]));
const base = store.items.length;
store.addItems([
  { type: 'cabinet', name: 'Test chest', x: mamadDoor.x + mamadDoor.w + 40, y: mamadDoor.y + mamadDoor.h / 2, w: 60, d: 40, h: 80, zone: 'indoor' },               // in the blast-door swing
  { type: 'cabinet', name: 'Test trunk', x: mamadDoor.x - 40, y: mamadDoor.y + 40, w: 50, d: 40, h: 60, zone: 'indoor' },                                           // in the arc of the inner door (opens into the room)
  { type: 'bookcase', name: 'Test bookcase', x: mamadWin.x + mamadWin.w / 2, y: mamadWin.y - 20, w: 80, d: 30, h: 200, zone: 'indoor' },                       // in front of the blast window
  { type: 'mirror', name: 'Test mirror', x: mx, y: my, w: 60, d: 3, h: 80, elev: 100, placement: 'wall', zone: 'indoor' },                                      // glass in the mamad, not on a wall
  { type: 'shed', name: 'Test shed', x: bay.x + bay.w / 2, y: bay.y + bay.h / 2, w: 300, d: 250, h: 230, zone: 'outdoor', params: { variant: 'shed', roof: 'flat' } },   // 7.5 m², on a parking bay
  { type: 'pool', name: 'Test pool', x: lotX + 400, y: lotY - 300, w: 600, d: 300, h: 140, zone: 'outdoor', params: { depth: 140 } },
  { type: 'tree', name: 'Test ficus', x: PLAN.bounds.x - 150, y: PLAN.bounds.y + PLAN.bounds.h - 200, w: 400, d: 400, h: 600, zone: 'outdoor', params: { species: 'ficus' } },
  { type: 'pergola', name: 'Test pergola', x: lotX + 30, y: lotY - 900, w: 400, d: 300, h: 250, zone: 'outdoor', params: { variant: 'slatted' } },             // crosses the property line
  { type: 'bbq', name: 'Test grill', x: PLAN.bounds.x - 40, y: PLAN.bounds.y + PLAN.bounds.h - 300, w: 140, d: 60, h: 115, zone: 'outdoor', params: { variant: 'gas' } },
  { type: 'ceiling-fan', name: 'Test fan', x: mid(room('bedroom-1').polygon)[0], y: mid(room('bedroom-1').polygon)[1], w: 132, d: 132, h: 80, placement: 'ceiling', elev: 220, zone: 'indoor' },
], { select: false });
const f2 = runChecks(args);
const any = (ruleId, sev, re) => f2.some((f) => f.ruleId === ruleId && f.severity === sev && (!re || re.test(f.title + ' ' + f.detail)));
ok(any('mamad-openings', 'fail', /Test chest/), 'furniture in the blast-door swing → fail');
ok(f2.some((f) => f.id === 'mamad-openings:door-mamad:inner' && f.severity === 'warn' && /Test trunk/.test(f.title)), 'furniture in the arc of the safe room\'s inner door → warn');
ok(any('mamad-openings', 'warn', /Test bookcase/), 'tall bookcase in front of the blast window → warn');
ok(any('mamad-furnishing', 'warn', /Test mirror/), 'mirror in the mamad → warn');
ok(any('wall-item-side', 'info', /Test mirror/), 'wall item away from any wall → note');
ok(any('shed-exempt', 'warn', /7\.5 m²/) && any('parking-clear', 'warn', /Test shed/), 'oversized shed on a parking bay → 2 warnings');
ok(any('pool-safety', 'warn', /no safety fence/), 'pool without a fence → warn');
ok(any('tree-distance', 'warn', /ficus/), 'ficus 1.5 m from the house → warn');
ok(any('lot-boundary', 'fail', /Test pergola/), 'pergola across the property line → fail');
ok(any('bbq-distance', 'warn', /Test grill/), 'grill against the house wall → warn');
ok(any('fan-clearance', 'info', /2\.20 m/), 'ceiling fan with blades at 2.20 m → note');
ok(f2.every((f) => ruleIds.has(f.ruleId)), 'still no unknown rules / crashed check groups');
store.removeItems(store.items.slice(base).map((i) => i.id));

// ── 6. robustness and scale ──
console.log('Robustness');
const many = [];
for (let i = 0; i < 200; i++) many.push({ type: i % 3 ? 'chair' : 'planter', name: 'Filler ' + i, x: -400 + (i % 20) * 110, y: -250 + Math.floor(i / 20) * 190, w: 45, d: 45, h: 80, rot: (i * 37) % 360, zone: i % 2 ? 'indoor' : 'outdoor' });
store.load({ items: many });
runChecks(args);
const big = []; for (let i = 0; i < 7; i++) big.push(time(() => runChecks(args))[1]);
ok(median(big) < 50, `200 items: median ${median(big).toFixed(1)} ms < 50 ms`);
let threw = false;
try {
  runChecks({ store: { items: [null, {}, { type: 'bed' }, { type: 'x', w: NaN, d: 5 }, { type: 'pendant', x: 500, y: 500, w: 40, d: 40, h: 60, placement: 'ceiling' }], project: {}, finishes: {} }, plan: PLAN });
  runChecks({ store: {}, plan: PLAN }); runChecks({ plan: PLAN }); runChecks({}); runChecks();
} catch (e) { threw = true; console.error(e); }
ok(!threw, 'does not throw on empty / malformed input');
ok(!runChecks({ store: { items: [] }, plan: PLAN }).some((f) => f.id.startsWith('error:')), 'empty design runs every check group');

// ── 7. the owner edits the plan (src/core/plan-edit.js) ──
console.log('Edited plan');
store.load({ items: initialLayout() });
const strip = (list) => JSON.stringify(list);
const original = runChecks(args);
ok(JSON.stringify(summarize(original)) === JSON.stringify(s) && original.length === findings.length, 'same result as the first run before any edit');
const byId = (list, id) => list.find((f) => f.id === id);
const sevOf = (list, id) => (byId(list, id) || {}).severity;
const changes = (list) => list.filter((f) => f.category === 'Changes to the approved plan');
const focusable = (f) => f && f.at && Number.isFinite(f.at.x) && Number.isFinite(f.at.y);
ok(byId(runChecks(args), 'ceiling-height:all') === byId(original, 'ceiling-height:all'), 'unchanged plan: building findings come from the cache (same objects)');

// (a) remove the 10 cm partition between Bedroom 1 and Bedroom 2 → one room of 3.60 × 6.10 = 21.96 m², two windows 2.80 m² = 12.8 %
const partition = E.wallSegments().find((s) => s.cls === 'partition' && s.between.includes('bedroom-1') && s.between.includes('bedroom-2'));
const planBefore = [PLAN.walls, PLAN.openings, PLAN.rooms];
ok(partition && E.removeWallSegment(partition.id).ok && PLAN.walls !== planBefore[0] && PLAN.rooms !== planBefore[2], 'removed the Bedroom 1 / Bedroom 2 partition (same PLAN object, new arrays)');
const fa = runChecks(args);
const merged = PLAN.rooms.find((r) => r.id === 'bedroom-1' || r.id === 'bedroom-2'), goneId = merged.id === 'bedroom-1' ? 'bedroom-2' : 'bedroom-1';
ok(byId(fa, 'ceiling-height:all') !== byId(original, 'ceiling-height:all') && strip(fa) !== strip(original), 'results are recomputed after the edit (no stale cache)');
ok(sevOf(fa, `room-size-habitable:${merged.id}`) === 'pass' && /21\.96 m²/.test(byId(fa, `room-size-habitable:${merged.id}`).title) && !byId(fa, `room-size-habitable:${goneId}`), 'merged bedroom: 21.96 m², the other bedroom is gone');
ok(/2\.80 m².*12\.8%.*21\.96 m²/.test(byId(fa, `light-habitable:${merged.id}`).detail) && !byId(fa, `light-habitable:${goneId}`), 'merged bedroom light ratio 2.80 m² / 21.96 m² = 12.8 %');
ok(/2 bedrooms/.test(byId(fa, 'smoke-detectors:all').title), 'smoke detectors now count 2 bedrooms');
const removed = byId(fa, `plan-change-free:wall-removed:${partition.id}`);
ok(removed && removed.severity === 'info' && /Non-structural/.test(removed.detail) && /145\(a\)\(2\)/.test(removed.detail) && focusable(removed) && Math.abs(removed.at.y - 1055) < 1, 'change listed as non-structural (info), citing §145(a)(2), with its plan point');
ok(sevOf(fa, 'plan-change-summary:all') === 'info' && /1 change/.test(byId(fa, 'plan-change-summary:all').title) && changes(fa).length === 2, 'summary: 1 non-structural change');

// (b) partition off a 1.95 × 0.80 m corner of the living room (two 10 cm walls) → a windowless, door-less 1.56 m² room
const living = PLAN.rooms.find((r) => r.id === 'main'), east = Math.max(...living.polygon.map((p) => p[0]));
const south = Math.max(...living.polygon.filter((p) => p[0] === east).map((p) => p[1]));              // SE corner of the living room
const w1 = E.addWall({ x1: east - 200, y1: south - 90, x2: east - 200, y2: south });
const w2 = E.addWall({ x1: east - 200, y1: south - 85, x2: east, y2: south - 85 });
const fb = runChecks(args);
const small = PLAN.rooms.find((r) => /^room-\d+$/.test(r.id));
ok(w1.ok && w2.ok && small && small.type === 'living', `two new partitions created ${small ? small.id : 'a room'} (type inherited: living)`);
ok(sevOf(fb, `room-size-habitable:${small.id}`) === 'fail' && /1\.56 m²/.test(byId(fb, `room-size-habitable:${small.id}`).title), 'new room 1.56 m² fails the 8 m² / 2.60 m minimum');
ok(sevOf(fb, `light-habitable:${small.id}`) === 'fail' && /no window/.test(byId(fb, `light-habitable:${small.id}`).title), 'new room has no window → light / ventilation fails');
ok(sevOf(fb, `room-access:${small.id}`) === 'warn', 'new room has no door or passage → warning');
ok(sevOf(fb, `plan-change-room:${small.id}`) === 'fail' && sevOf(fb, `plan-change-light:${small.id}`) === 'fail' && focusable(byId(fb, `plan-change-room:${small.id}`)), 'both consequences are listed with the changes');
ok(fb.filter((f) => f.ruleId === 'plan-change-free' && /wall-added/.test(f.id)).length >= 1 && sevOf(fb, 'plan-change-summary:all') === 'warn', 'new partitions are listed; the summary becomes a warning');
const livingNow = areaM2(PLAN.rooms.find((r) => r.id === 'main').polygon), livingWas = areaM2(living.polygon);
ok(byId(fb, 'room-size-habitable:main').title.includes(`${livingNow.toFixed(2)} m²`) && Math.abs(livingWas - livingNow - (1.56 + 0.195 + 0.08)) < 0.01, `living space area recomputed: ${livingWas.toFixed(2)} → ${livingNow.toFixed(2)} m² (room 1.56 + walls 0.275)`);
ok(byId(fb, 'room-size-kitchen:main') && !byId(fb, `room-size-kitchen:${small.id}`), 'the kitchen check stays with the room that holds the kitchen');

// (c) an interior door into the new room, then declare it a store
const door = E.addOpening({ kind: 'door', x: east - 100, y: south - 85, width: 70 });
const fc = runChecks(args);
ok(door.ok && !byId(fc, `room-access:${small.id}`) && sevOf(fc, `door-room:${door.ids[0]}`) === 'pass', 'added an interior door 70 cm: the room is accessible, door width passes');
ok(sevOf(fc, `plan-change-free:opening-added:${door.ids[0]}`) === 'info' && focusable(byId(fc, `plan-change-free:opening-added:${door.ids[0]}`)), 'the new door is listed as a non-structural change');
ok(E.updateRoom(small.id, { name: 'Store', type: 'storage' }).ok, 're-typed the small room as a store');
const fc2 = runChecks(args);
ok(!byId(fc2, `plan-change-room:${small.id}`) && !byId(fc2, `plan-change-light:${small.id}`) && sevOf(fc2, `room-size-service:${small.id}`) === 'pass' && !byId(fc2, `room-size-habitable:${small.id}`), 'a store has no minimum size and needs no window → the failures are gone');

// (d) move an exterior window 60 cm → permit
const win = PLAN.openings.find((o) => o.id === 'win-bedroom-1'), winY = win.y;
const moved = E.updateOpening('win-bedroom-1', { x: win.x + win.w / 2, y: win.y + win.h / 2 - 60 });
const fd = runChecks(args);
const permit = byId(fd, 'plan-change-permit:opening-changed:win-bedroom-1');
ok(moved.ok && moved.level === 'permit' && PLAN.openings.find((o) => o.id === 'win-bedroom-1').y === winY - 60, 'moved the Bedroom 1 window 60 cm (permit level)');
ok(permit && permit.severity === 'warn' && /145\(a\)\(2\)/.test(permit.detail) && /Planning and Building Law/.test(permit.reference) && focusable(permit) && Math.abs(permit.at.y - (winY - 60 + win.h / 2)) < 1, 'exterior change → warning citing the Planning and Building Law §145(a)(2), focused on the window');
ok(/1 to an exterior opening \(permit\)/.test(byId(fd, 'plan-change-summary:all').title) && sevOf(fd, 'plan-change-summary:all') === 'warn', 'summary counts the permit change');
ok(sevOf(fd, `light-habitable:${merged.id}`) === 'pass', 'the moved window still lights the bedroom');

// (e) remove a 20 cm interior wall → structural-engineer warning (a caution, not a regulation)
const thick = E.wallSegments().find((s) => s.cls === 'thick' && s.between[0] === 'main' && s.between[1] === 'main' && s.axis === 'h' && s.length < 150);
const fe = thick && E.removeWallSegment(thick.id).ok ? runChecks(args) : [];
const structural = fe.find((f) => f.ruleId === 'plan-change-structural');
ok(structural && structural.severity === 'warn' && structural.kind === 'best-practice' && /Caution rather than a regulation/.test(structural.detail) && /structural engineer/.test(structural.detail) && focusable(structural), '20 cm wall removed → warning to confirm with the structural engineer (best-practice, not a regulation)');

// (f) a free-standing partition 90 cm in front of the blast door (the living-space polygon gets a zero-width slit)
const md = PLAN.openings.find((o) => o.style === 'mamad' && o.kind === 'door');
const facing = E.addWall({ x1: md.x + md.w + 95, y1: md.y - 45, x2: md.x + md.w + 95, y2: md.y + 55 });
const ff = runChecks(args);
const mainPoly = PLAN.rooms.find((r) => r.id === 'main').polygon;
const slit = mainPoly.some((a, i) => { const b = mainPoly[(i + 1) % mainPoly.length]; return mainPoly.some((c, j) => { const d = mainPoly[(j + 1) % mainPoly.length]; return a[0] === d[0] && a[1] === d[1] && b[0] === c[0] && b[1] === c[1]; }); });
ok(slit, 'the living-space polygon now contains a zero-width slit (free-standing wall)');
const passages = ff.filter((f) => f.ruleId === 'corridor-width').map((f) => f.title).sort().join(' | ');
ok(passages === 'Corridor: 1.10 m wide | Passage: 0.90 m wide', `narrow passages on the slit polygon: ${passages} (the slit itself is not a wall face)`);
ok(facing.ok && sevOf(ff, 'mamad-door-clear:door-mamad') === 'warn' && /0\.90 m/.test(byId(ff, 'mamad-door-clear:door-mamad').title), 'partition 0.90 m in front of the blast door → warning (1.10 m rule, reg. 202(b))');
ok(ff.every((f) => ruleIds.has(f.ruleId)) && !ff.some((f) => f.id.startsWith('error:')) && new Set(ff.map((f) => f.id)).size === ff.length, 'every check group runs on the edited plan (slit polygon included); ids unique');
console.log('       ' + byId(ff, 'room-size-habitable:main').title + ' · ' + ff.filter((f) => f.ruleId === 'walkway').map((f) => f.title).join(' · '));
ok(byId(ff, 'room-size-habitable:main').title.includes(`${areaM2(mainPoly).toFixed(2)} m², clear width`) && !byId(ff, 'walkway:mamad') && /10 of 11/.test(byId(ff, 'walkway:some').title) && sevOf(ff, `walkway:${small.id}`) === 'info',
  'area, clear width and routes are computed on the slit polygon (safe room still on an 80 cm route; the TV unit narrows the way to the new store)');
ok(sevOf(ff, 'mamad-inner-door:door-mamad') === 'info' && sevOf(ff, 'mamad-height:mamad') === 'warn' && sevOf(ff, 'mamad-walls:mamad') === 'pass', 'safe-room findings unchanged by the edits');
ok(changes(ff).every((f) => f.ruleId === 'plan-change-summary' || focusable(f)), 'every change finding carries a plan point');
const diffItems = E.planDiff().items;
ok(diffItems.length > 0 && ff.filter((f) => /^plan-change-(free|structural|permit)$/.test(f.ruleId)).length === diffItems.length, `one finding per planDiff item (${diffItems.length})`);

// timing on the edited plan, then lower the ceiling (store.project.ceilingHeight is what the checks use)
for (let i = 0; i < 5; i++) runChecks(args);                                                    // let the JIT see the new code paths
const edited = []; for (let i = 0; i < 21; i++) edited.push(time(() => runChecks(args))[1]);
ok(median(edited) < 20, `edited plan: median ${median(edited).toFixed(1)} ms < 20 ms`);
const cold2 = []; for (let i = 0; i < 9; i++) { E.updateRoom(small.id, { name: 'Store ' + i }); cold2.push(time(() => runChecks(args))[1]); }
ok(median(cold2) < 50, `edited plan, first run after each edit (every cache rebuilt): median ${median(cold2).toFixed(1)} ms < 50 ms`);
const H0 = store.project.ceilingHeight;
store.project.ceilingHeight = 240;
const fh = runChecks(args);
ok(sevOf(fh, 'ceiling-height:all') === 'fail' && /2\.40 m/.test(byId(fh, 'ceiling-height:all').title) && sevOf(fh, 'mamad-height:mamad') === 'fail' && /25\.2 m³/.test(byId(fh, 'mamad-area:mamad').title), 'checks use store.project.ceilingHeight (2.40 m → ceiling and mamad height fail, volume 25.2 m³)');
store.project.ceilingHeight = H0;

// (g) back to the architect's plan
ok(E.resetPlan().ok && !E.isPlanModified(), 'resetPlan()');
const after = runChecks(args);
ok(strip(after) === strip(original), 'after resetPlan() the findings equal the original ones');
const again = []; for (let i = 0; i < 9; i++) again.push(time(() => runChecks(args))[1]);
ok(median(again) < 20, `architect's plan: median ${median(again).toFixed(1)} ms < 20 ms`);

console.log(failed ? `\n${failed} EXPECTATION(S) FAILED` : '\nREGULATIONS OK');
process.exit(failed ? 1 : 0);
