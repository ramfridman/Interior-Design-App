// Regulations and carpentry per floor — stage F7 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md.
// The "Duplex" test house (tests/fixtures/houses.mjs) WITHOUT its stair, on a lot, with a small bedroom cut off on the
// first floor and the first floor overhanging the ground floor by 2 m to the east (so the house footprint on the lot
// is the union of the floors). House 98's findings are pinned byte for byte by tests/geometry.test.mjs.
//   node tests/levels-rules.test.mjs
import { PLAN } from '../src/core/plan.js';
import { store } from '../src/core/store.js';
import * as B from '../src/core/plan-build.js';
import * as E from '../src/core/plan-edit.js';
import { levelName } from '../src/core/levels.js';
import { polygonBounds } from '../src/core/geometry.js';
import { runChecks } from '../src/regulations/index.js';
import { houseFootprint } from '../src/regulations/footprint.js';
import * as C from '../src/carpentry/index.js';
import { composeQuotation } from '../src/carpentry/doc/index.js';
import { DUPLEX } from './fixtures/houses.mjs';

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const W = (id, x, y, w, h, kind) => ({ id, x, y, w, h, kind });

// ───────────────────────── the house ─────────────────────────
const { stairs: _st, voids: _v, ...L1IN } = DUPLEX.levels[0];
// first floor 2 m wider to the east (cantilever), its east window moved with the wall, and a small room cut off in the NW
const L1 = {
  ...L1IN,
  walls: [W('w01', 0, 0, 1200, 20, 'exterior'), W('w02', 0, 780, 1200, 20, 'exterior'), W('w03', 0, 20, 20, 760, 'exterior'), W('w04', 1180, 20, 20, 760, 'exterior'),
    W('w05', 300, 20, 10, 760, 'interior'), W('w06', 20, 200, 280, 10, 'interior')],
  openings: [L1IN.openings[0], { ...L1IN.openings[1], x: 1180 }],
};
const SITE = { boundary: [[-400, -300], [1400, -300], [1400, 1100], [-400, 1100]], setbacks: { n: 300, e: 300, s: 300, w: 400 } };
const INPUT = { walls: DUPLEX.walls, openings: DUPLEX.openings, heights: DUPLEX.heights, meta: { name: 'Duplex', floors: 2 }, levels: [L1], site: SITE };
const built = B.buildPlan(INPUT, { levels: true });
check('Duplex (no stair, L1 overhanging, small NW room on L1) builds', built.ok && built.plan.levels.length === 1, JSON.stringify(built.warnings.filter((w) => w.level === 'error')));
store.openProject({ basePlan: built.plan, phase: 'draft', design: { items: [], project: { ceilingHeight: DUPLEX.heights.ceiling } } });
const v1 = () => E.levelPlan(PLAN, 'L1');
const small = v1().rooms.find((r) => polygonBounds(r.polygon).y < 100 && polygonBounds(r.polygon).x < 100);
check('the small first-floor room exists (280 × 180)', !!small && Math.round(polygonBounds(small.polygon).w) === 280 && Math.round(polygonBounds(small.polygon).h) === 180, small && JSON.stringify(polygonBounds(small.polygon)));
const ren = E.updateRoom(small.id, { type: 'bedroom', name: 'Small bedroom' });
check('…made a bedroom', ren.ok, ren.reason);

// ───────────────────────── regulations ─────────────────────────
group('Regulations per floor');
let F = runChecks({ store, plan: PLAN });
const byId = (id) => F.find((f) => f.id === id);
check('every finding carries a level of the plan', F.length > 20 && F.every((f) => f.level === 'L0' || f.level === 'L1'), F.filter((f) => !f.level).map((f) => f.id).join(' '));
check('finding ids stay unique', new Set(F.map((f) => f.id)).size === F.length);
const bed = F.filter((f) => f.spaceId === small.id && f.ruleId === 'room-size-habitable');
check('the too-small bedroom is reported on L1 only (fail: 5.0 m², 1.80 m)', bed.length === 1 && bed[0].level === 'L1' && bed[0].severity === 'fail' && /5\.04 m²/.test(bed[0].title), JSON.stringify(bed.map((f) => [f.level, f.severity, f.title])));
check('…its id carries the floor (@L1); no L0 finding names it', bed[0].id.endsWith('@L1') && !F.some((f) => f.level === 'L0' && f.spaceId === small.id));
const l0Rooms = new Set(PLAN.rooms.map((r) => r.id)), l1Rooms = new Set(v1().rooms.map((r) => r.id));
check('room findings sit on the floor of their room', F.filter((f) => f.spaceId && (l0Rooms.has(f.spaceId) || l1Rooms.has(f.spaceId)) && f.scope !== 'house').every((f) => (l0Rooms.has(f.spaceId) ? 'L0' : 'L1') === f.level));
check('openings are checked on their floor (door-part-1 on L1, door-entry on L0)', byId('door-room:door-part-1@L1') && byId('door-room:door-part-1@L1').level === 'L1' && byId('door-entry:door-entry').level === 'L0');
check('ceiling height: one finding per floor, each with its own heights', byId('ceiling-height:all').level === 'L0' && byId('ceiling-height:all@L1').level === 'L1' && /2\.80 m/.test(byId('ceiling-height:all@L1').title));
check('upper-floor window sill: the drop includes the floor elevation (guard needed)', byId('sill-guard:win-east-1@L1') && byId('sill-guard:win-east-1@L1').severity === 'warn' && /315 cm drop/.test(byId('sill-guard:win-east-1@L1').title));
check('ground floor sill: unchanged (15 cm drop, no guard)', byId('sill-guard:all') && byId('sill-guard:all').severity === 'pass' && byId('sill-guard:all').level === 'L0');
const fp = houseFootprint(PLAN);
check('house footprint = L0 ∪ L1 projection (1200 × 800 = 96 m²; L0 alone 80 m²)', Math.round(fp.area / 1e4) === 96 && fp.floors.length === 2 && Math.round(fp.floors[0].area / 1e4) === 80, `${fp.area / 1e4}`);
const cov = byId('built-area:house');
check('coverage uses the union footprint: 96 m² of ground covered, floor area of both floors counted', cov && cov.scope === 'site' && cov.level === 'L0' && /96\.0 m² of ground covered/.test(cov.title) && /176\.0 m² on 2 floors/.test(cov.title), cov && cov.title);
const sb = byId('setbacks:house');
check('setbacks measured from the union footprint: the east overhang is 2.00 m from the line (needs 3.00 m)', sb && sb.severity === 'fail' && /east 2\.00 m/.test(sb.detail) && sb.scope === 'site', sb && sb.detail);
check('site rules come once (L0, scope site); no setbacks finding on L1', F.filter((f) => f.ruleId === 'setbacks').length === 1 && F.filter((f) => f.ruleId === 'parking-count').every((f) => f.level === 'L0' && f.scope === 'site'));
const big = F.filter((f) => f.id.startsWith('room-size-habitable:largest'));
check('largest room: one finding for the whole dwelling (scope house), on the floor of that room', big.length === 1 && big[0].scope === 'house' && big[0].level === 'L1', JSON.stringify(big.map((f) => [f.level, f.title])));
check('routes from the entrance: checked on the ground floor, an L1 note says so', F.some((f) => f.ruleId === 'walkway' && f.level === 'L0') && F.some((f) => f.id === 'walkway:ground-only:L1@L1' && /ground floor/.test(f.title)));
check('assumptions once, as site findings', F.filter((f) => f.ruleId === 'assumption').every((f) => f.level === 'L0' && f.scope === 'site') && !F.some((f) => f.ruleId === 'assumption' && f.level === 'L1'));

group('Furniture per floor');
store.load({ items: [
  { id: 'bed-up', type: 'bed', name: 'Bed', x: 160, y: 110, rot: 0, w: 160, d: 200, h: 50, level: 'L1' },
  { id: 'sofa-down', type: 'sofa', name: 'Sofa', x: 250, y: 400, rot: 0, w: 200, d: 90, h: 80 },
], project: { ceilingHeight: 280 } });
F = runChecks({ store, plan: PLAN });
const bedF = F.filter((f) => (f.itemIds || []).includes('bed-up'));
check('an L1 bed is checked against the L1 walls (it cuts into the small room’s wall there)', bedF.length > 0 && bedF.every((f) => f.level === 'L1') && bedF.some((f) => f.ruleId === 'item-in-wall'), JSON.stringify(bedF.map((f) => [f.level, f.ruleId])));
check('…and is not seen on the ground floor', !F.some((f) => f.level === 'L0' && (f.itemIds || []).includes('bed-up')));
check('a ground-floor sofa stays on L0', F.filter((f) => (f.itemIds || []).includes('sofa-down')).every((f) => f.level === 'L0'));

// ───────────────────────── carpentry ─────────────────────────
group('Carpentry per floor');
store.load({ items: [], project: { ceilingHeight: 280 } });
store.setUI({ level: 'L1' });
const wr = C.createRun({ kind: 'wardrobe', x: 315, y: 500 });
check('createRun by picking a wall takes the active floor (L1): the L1 partition at x = 310 (no wall there on L0)', wr.ok && C.getRun(wr.runId).run.level === 'L1', wr.reason && wr.reason.en);
const run1 = C.getRun(wr.runId).run;
const span = C.spanOfRun(run1);
check('wall span from L1: the east face of the L1 partition, the L1 door at its north end', span && span.anchor.x === 310 && span.openings.some((o) => o.id === 'door-part-1') && run1.anchor.y >= 190, span && JSON.stringify(span.openings.map((o) => o.id)));
check('room from L1', l1Rooms.has(run1.roomId) || v1().rooms.some((r) => r.id === run1.roomId));
const f1 = C.fitRun(wr.runId, { mode: 'units' });
const add = C.addUnit(wr.runId, 'wardrobe-hinged', { width: 100 });
check('units added', add.ok, add.reason && add.reason.en);
const units = C.getRun(wr.runId).units;
check('units carry the run’s level', units.length > 0 && units.every((u) => u.level === 'L1'));
const finds = C.checkRun(wr.runId);
check('checkRun uses the L1 plan (no "not against a wall" warning)', !finds.some((f) => f.code === 'no-wall'), finds.map((f) => f.code).join(' '));
const g = C.geometryOf(run1, units[0]);
check('unit heights come from the L1 ceiling (280): wardrobe top ≤ 280', g.elev + g.h <= 280 + 0.01, `${g.elev + g.h}`);
const dr = C.drawings(wr.runId);
check('drawings name the floor (title " · First floor") and carry level', dr.length && dr.every((d) => d.title.en.endsWith(' · First floor') && d.title.he.endsWith(' · קומה א׳') && d.level === 'L1'), dr.map((d) => d.title.en).join(' | '));
const planD = dr.find((d) => d.kind === 'plan');
check('the plan drawing draws the L1 walls', planD.ops.some((o) => o.role === 'wall'));
const sch = C.schedules(wr.runId);
check('schedules show the floor', sch.units.length && sch.units.every((u) => u.floor && u.floor.en === 'First floor' && u.floor.he === 'קומה א׳' && u.floorId === 'L1'));
check('take-off names the floor', C.takeoff(wr.runId).runs[0].floor.en === 'First floor');
const refuse = C.moveRunToLevel(wr.runId, 'L0');
check('moveRunToLevel: refused when the target floor has no wall there (with a reason)', !refuse.ok && /Ground floor/.test(refuse.reason.en) && refuse.reason.he.length > 0 && C.getRun(wr.runId).run.level === 'L1', refuse.reason && refuse.reason.en);

const k = C.createRun({ kind: 'kitchen', x: 750, y: 25, from: 300, to: 540, units: [{ module: 'base-door', width: 60 }, { module: 'base-drawers', width: 60 }] });
check('a kitchen on the L1 north wall', k.ok && C.getRun(k.runId).run.level === 'L1', k.reason && k.reason.en);
const mv = C.moveRunToLevel(k.runId, 'L0');
const kr = C.getRun(k.runId);
check('moveRunToLevel to L0: ok, no level key on the ground floor, units follow', mv.ok && mv.changed && !('level' in kr.run) && kr.units.every((u) => !('level' in u)), mv.reason && mv.reason.en);
check('…on L0 the span is the L0 wall (the north window is in it)', C.spanOfRun(kr.run) && C.spanOfRun(kr.run).openings.some((o) => o.id === 'win-north'));
store.undo();
check('undo puts it back on L1 (one step)', C.getRun(k.runId).run.level === 'L1' && C.getRun(k.runId).units.every((u) => u.level === 'L1'));
const isl = C.createRun({ kind: 'island', x: 1000, y: 500, length: 200, level: 'L1' });
check('an island on L1 (explicit level)', isl.ok && C.getRun(isl.runId).run.level === 'L1', isl.reason && isl.reason.en);
const mi = C.moveRunToLevel(isl.runId, 'L0');
check('islands move freely (even where L0 has no room: the overhang)', mi.ok && !('level' in C.getRun(isl.runId).run));
C.moveRunToLevel(isl.runId, 'L1');
check('…and back', C.getRun(isl.runId).run.level === 'L1');

group('Quotation document names the floor (English and Hebrew)');
for (const lang of ['en', 'he']) {
  const doc = composeQuotation({ lang, runIds: 'all', paper: 'A4', project: { title: 'Duplex', date: '2026-11-14' }, src: { store, plan: PLAN } });
  const text = doc.pages.flatMap((p) => p.ops.filter((o) => o.t === 'text').map((o) => o.text)).join('\n');
  const name = levelName(PLAN, 'L1', lang);
  const r = C.getRun(wr.runId).run;
  check(`${lang}: run titles carry the floor (${name})`, doc.pages.length > 3 && text.includes(`${r.code} · ${lang === 'he' ? r.nameHe : r.name} · ${name}`), text.split('\n').filter((t) => t.includes(r.code)).slice(0, 3).join(' | '));
  check(`${lang}: the key plan names the floors with runs`, text.includes(name));
}

group('One-level plans are unchanged');
store.openProject({ basePlan: E.BUILTIN_PLAN, phase: 'fixed', design: { items: [] } });
const one = C.createRun({ kind: 'wardrobe', anchor: { x: 30, y: 30, dir: 0 }, length: 120 });
check('House 98: a new run has no level key, its units neither', one.ok && !('level' in C.getRun(one.runId).run) && C.getRun(one.runId).units.every((u) => !('level' in u)));
check('House 98: no finding carries level / scope', runChecks({ store, plan: PLAN }).every((f) => !('level' in f) && !('scope' in f)));
check('House 98: drawings titles unchanged', C.drawings(one.runId).every((d) => !/floor/i.test(d.title.en) && !('level' in d)));

console.log(`\nlevels-rules: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
