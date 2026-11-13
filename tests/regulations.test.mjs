// Regulations checker — runs on the architect's initial layout, prints a readable report and asserts a few
// expectations derived by hand from the plan. Plain Node, no dependencies:  node tests/regulations.test.mjs
import { PLAN } from '../src/core/plan.js';
import { store } from '../src/core/store.js';
import { initialLayout } from '../src/core/initial-layout.js';
import { RULES, DISCLAIMER, runChecks, summarize } from '../src/regulations/index.js';

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
ok(has('mamad-door:door-mamad', 'pass', /80 × 200/), 'Blast door 80 × 200 opening outwards');
ok(has('mamad-window:win-mamad', 'pass', /100 × 100/), 'Blast window 100 × 100, sill 110');
ok(has('mamad-walls:mamad', 'info', /north 20 cm.*east 25 cm.*south 30 cm.*west 20 cm/), 'Mamad wall thicknesses 20 / 25 / 30 / 20 cm read from plan.walls');
ok(has('mamad-ext-walls:mamad', 'pass', /1 external wall/), 'Mamad has one external wall');
ok(has('parking-count:count', 'pass', /2 parking/), '2 parking places');
ok(has('parking-size:parking-1', 'pass', /2\.50 × 5\.00/) && has('parking-size:parking-2', 'pass', /2\.50 × 5\.00/), 'Both bays 2.50 × 5.00 m inside the lot');
ok(has('setbacks:house', 'pass', /west 6\.0\d m.*north 3\.0\d m.*east 3\.4\d m.*south 3\.10 m/), 'Setbacks: W ≈ 6.05, N ≈ 3.08, E ≈ 3.49, S 3.10 m');
ok(has('building-line:house', 'pass') && has('building-line:utility-yard', 'info', /1\.90 m/), 'House inside the building line; utility yard 1.90 m beyond it');
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

console.log(failed ? `\n${failed} EXPECTATION(S) FAILED` : '\nREGULATIONS OK');
process.exit(failed ? 1 : 0);
