// Stairs — stage F4a of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md: pure geometry (src/core/stairs.js), regulation checks
// (src/regulations/stairs.js) and the 3D model (src/view3d/stairs.js + the hook in house.js). Headless (plain node):
// bare 'three' imports are mapped to vendor/three, procedural textures get a no-op canvas (as tests/levels-3d.test.mjs).
//   node tests/stairs.test.mjs
//
// NOTE on the Duplex void v1. The design drew it y 266–640; with the sourced rule (PBR Second Schedule §3.2.2.4: 2.10 m
// measured vertically above the nosing line) and the L1 slab underside at 2.80 m the slab must be open down to y = 666.2
// — y 640 left 1.95 m at its south edge. Since stage F4b the shared fixture's v1 is y 266–670 (what addStair creates:
// the free edge rounded out to 5 cm), so the fixture stair passes every rule; V640 below keeps the old hole for the
// "too short" checks.
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
globalThis.performance ??= { now: () => Date.now() };

const THREE = await import('three');
const S = await import('../src/core/stairs.js');
const { PLAN } = await import('../src/core/plan.js');
const { store } = await import('../src/core/store.js');
const B = await import('../src/core/plan-build.js');
const { buildHouse } = await import('../src/view3d/house.js');
const { checkStairs, STAIR_LIMITS } = await import('../src/regulations/stairs.js');
const { runChecks, RULES } = await import('../src/regulations/index.js');
const { DUPLEX } = await import('./fixtures/houses.mjs');

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const clone = (o) => JSON.parse(JSON.stringify(o));
const ST1 = DUPLEX.stairs[0];
const RISE = DUPLEX.levels[0].elevation;                       // 300
const UNDERSIDE = RISE - DUPLEX.levels[0].heights.slab;        // 280
const bbox = (ring) => { const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
const sameBox = (a, b, e = 1e-6) => near(a.x0, b.x0, e) && near(a.x1, b.x1, e) && near(a.y0, b.y0, e) && near(a.y1, b.y1, e);
const ringArea = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

// ───────────────────────── Duplex st1: straight ─────────────────────────
group('Duplex st1 (straight, 18 risers over 3.00 m, going 29): geometry');
const geo = S.stairGeometry(ST1, { rise: RISE });
{
  check('riser = rise / risers = 16.67 cm; 2R + G = 62.3', near(geo.riser, 300 / 18) && near(2 * geo.riser + geo.going, 62.333, 1e-3), `${geo.riser}`);
  check('17 treads (risers − 1), one flight', geo.treadCount === 17 && geo.flights.length === 1 && geo.flights[0].treads.length === 17);
  const top = geo.flights[0].treads.at(-1);
  check('top tread: index 17, h = 17 × 16.67 = 283.33, y 266–295', top.index === 17 && near(top.h, 17 * 300 / 18) && sameBox(bbox(top.poly), { x0: 520, x1: 620, y0: 266, y1: 295 }), JSON.stringify(top.poly));
  check('first tread at y 730–759, h = 16.67', sameBox(bbox(geo.flights[0].treads[0].poly), { x0: 520, x1: 620, y0: 730, y1: 759 }) && near(geo.flights[0].treads[0].h, 300 / 18));
  check('walking line 493 cm (17 × 29) from (570, 759, 0) to (570, 266, 300)', near(geo.walkLength, 493) && geo.walkingLine.length === 2
    && JSON.stringify(geo.walkingLine) === JSON.stringify([[570, 759, 0], [570, 266, 300]]), JSON.stringify(geo.walkingLine));
  const f = DUPLEX.stairs[0].footprint;
  check('footprint = the fixture rectangle x 520–620, y 266–759', geo.footprint.length === 4 && sameBox(bbox(geo.footprint), { x0: f.x, x1: f.x + f.w, y0: f.y, y1: f.y + f.h }) && near(ringArea(geo.footprint), f.w * f.h), JSON.stringify(geo.footprint));
  check('pose size = fixture w × d (100 × 493)', near(geo.size.w, ST1.w) && near(geo.size.d, ST1.d));
  check('start edge y 759 (h 0), arrival edge y 266 (h 300), walking north', geo.start.a[1] === 759 && geo.start.b[1] === 759 && geo.arrival.a[1] === 266 && geo.arrival.b[1] === 266 && geo.arrival.h === 300
    && JSON.stringify(geo.arrival.dir) === '[0,-1]' && JSON.stringify(S.stairArrivalDir(ST1)) === '[0,-1]');
  check('direction convention: rot 90 → east, 180 → south, 270 → west (arrival dir)', ['[1,0]', '[0,1]', '[-1,0]'].every((d, i) => JSON.stringify(S.stairArrivalDir({ ...ST1, rot: 90 * (i + 1) })) === d));
  const g90 = S.stairGeometry({ ...ST1, rot: 90 }, { rise: RISE });
  check('rot 90: footprint 493 × 100 around the same centre, start on the west side', sameBox(bbox(g90.footprint), { x0: 570 - 246.5, x1: 570 + 246.5, y0: 462.5, y1: 562.5 }, 1e-4) && near(g90.start.mid[0], 570 - 246.5, 1e-4));
}

group('floorHeightAt / pitchHeightAt');
{
  const fh = (x, y, o) => S.floorHeightAt(ST1, geo, x, y, o);
  check('bottom edge (570, 759) → 0', near(fh(570, 759), 0));
  check('middle (570, 512.5) → 150 (half way along the walking line)', near(fh(570, 512.5), 150));
  check('top edge (570, 266) → 300 (the upper floor)', near(fh(570, 266), 300));
  check('stepped: middle → tread 9 (8.5 goings) = 150; (570, 740) → tread 1 = 16.67', near(fh(570, 512.5, { stepped: true }), 9 * 300 / 18) && near(fh(570, 740, { stepped: true }), 300 / 18));
  check('off the stair → null (beside it, below its start)', fh(500, 500) === null && fh(570, 770) === null);
  check('pitch line at the first nosing = one riser; at the arrival = 300', near(S.pitchHeightAt(ST1, geo, 570, 759), 300 / 18) && near(S.pitchHeightAt(ST1, geo, 570, 266), 300));
}

group('Headroom envelope and the required void (2.10 m, slab underside 2.80 m)');
const required = S.requiredVoid(ST1, geo, { slabUnderside: UNDERSIDE });
const V1 = DUPLEX.levels[0].voids[0];
const V640 = { ...V1, polygon: [[520, 266], [620, 266], [620, 640], [520, 640]] };   // the design's original hole
{
  const yEdge = 759 - ((UNDERSIDE - 210 - 300 / 18) * 29) / (300 / 18);   // pitch(s) = 280 − 210 ⇒ s = 92.8
  check(`required void = x 520–620, y 266–${yEdge.toFixed(1)} (one rectangle)`, required.length === 1 && sameBox(bbox(required[0]), { x0: 520, x1: 620, y0: 266, y1: yEdge }, 2e-3), JSON.stringify(required));
  const env = S.headroomEnvelope(ST1, geo);
  check('envelope: one flight piece, 2.10 m above the pitch line', env.pieces.length === 1 && near(env.pieces[0].base, 300 / 18 + 210) && near(S.envelopeHeightAt(ST1, geo, 570, 266), 510));
  check('fixture v1 (y 266–670 since F4b) covers it', S.voidCovers(V1, required), `${(S.uncoveredVoid(V1, required).reduce((s, e) => s + ringArea(e.outer), 0)).toFixed(1)} cm² short`);
  check('the design\'s original hole (y 266–640) does NOT cover it (sourced 2.10 m — see the note at the top)', !S.voidCovers(V640, required), `${(S.uncoveredVoid(V640, required).reduce((s, e) => s + ringArea(e.outer), 0)).toFixed(1)} cm² short`);
  check('…y 640 would be enough only for a headroom ≤ 1.949 m', S.voidCovers(V640, S.requiredVoid(ST1, geo, { slabUnderside: UNDERSIDE, headroom: 194.9 })) && !S.voidCovers(V640, S.requiredVoid(ST1, geo, { slabUnderside: UNDERSIDE, headroom: 195 })));
  const v670 = { ...V1, polygon: [[520, 266], [620, 266], [620, 670], [520, 670]] }, v560 = { ...V1, polygon: [[520, 266], [620, 266], [620, 560], [520, 560]] };
  check('a void x 520–620, y 266–670 covers it; enlarging further still covers', S.voidCovers(v670, required) && S.voidCovers([[500, 200], [700, 200], [700, 700], [500, 700]], required));
  check('a void shortened to y 266–560 does not', !S.voidCovers(v560, required));
  check('a higher slab underside needs less: 3.40 m → nothing required over the first 2.10 m − …', S.requiredVoid(ST1, geo, { slabUnderside: 600 }).length === 0);
}

// ───────────────────────── regulation checks ─────────────────────────
group('Regulation findings (src/regulations/stairs.js)');
const { stairs: _s, ...L1IN } = DUPLEX.levels[0];
const INPUT = { walls: DUPLEX.walls, openings: DUPLEX.openings, heights: DUPLEX.heights, meta: { name: 'Duplex', floors: 2 }, levels: [L1IN] };
/** The Duplex plan with stairs on L0 and (optionally) a different void polygon. */
function duplex(stairs, voidPoly) {
  const input = clone(INPUT);
  if (voidPoly) input.levels[0].voids[0].polygon = voidPoly;
  const plan = B.buildPlan(input, { levels: true }).plan;
  plan.stairs = clone(stairs);
  return plan;
}
const sev = (fs, rule) => (fs.find((f) => f.ruleId === rule) || {}).severity;
const bad = (fs) => fs.filter((f) => f.severity === 'fail' || f.severity === 'warn').map((f) => f.ruleId);
{
  const RULE_IDS = ['stair-riser', 'stair-going', 'stair-comfort', 'stair-width', 'stair-headroom', 'stair-void', 'stair-flight', 'stair-landing', 'stair-handrail', 'stair-nosing', 'stair-guard', 'stair-guard-height', 'stair-geometry'];
  check('every stair rule is registered with a source, section and confidence', RULE_IDS.every((id) => { const r = RULES.find((x) => x.id === id); return r && r.category === 'Stairs' && r.reference.name && r.reference.section && r.confidence; }));
  check('the only unverified number (guard height) is marked so and reported as info', RULES.find((r) => r.id === 'stair-guard-height').title.includes('unverified'));
  const fx = checkStairs({ plan: duplex([ST1]) });
  check('fixture: riser, going, 2R + G, width, flight, nosing, handrail, guards pass', ['stair-riser', 'stair-going', 'stair-comfort', 'stair-width', 'stair-flight', 'stair-nosing', 'stair-handrail', 'stair-guard', 'stair-geometry'].every((r) => sev(fx, r) === 'pass'), bad(fx).join(', '));
  check('fixture: 2R + G finding says 62.3 cm', fx.find((f) => f.ruleId === 'stair-comfort').title.includes('62.3'));
  check('fixture v1 (y 266–670): headroom and void pass', sev(fx, 'stair-headroom') === 'pass' && sev(fx, 'stair-void') === 'pass', bad(fx).join(', '));
  const fx640 = checkStairs({ plan: duplex([ST1], V640.polygon) });
  check('the original hole y 266–640: headroom (1.95 m) and void findings fail — the sourced 2.10 m', sev(fx640, 'stair-headroom') === 'fail' && sev(fx640, 'stair-void') === 'fail' && /1\.95 m/.test(fx640.find((f) => f.ruleId === 'stair-headroom').title));
  check('every finding carries level L0 and the stair id; guard height is info', fx.every((f) => f.level === 'L0' && f.stairId === 'st1' && f.id.endsWith(':st1')) && sev(fx, 'stair-guard-height') === 'info');
  const ok670 = checkStairs({ plan: duplex([ST1], [[520, 266], [620, 266], [620, 670], [520, 670]]) });
  check('v1 extended to y 670: no fail or warn at all', bad(ok670).length === 0 && sev(ok670, 'stair-headroom') === 'pass' && sev(ok670, 'stair-void') === 'pass', bad(ok670).join(', '));
  const short = checkStairs({ plan: duplex([ST1], [[520, 266], [620, 266], [620, 560], [520, 560]]) });
  check('void shortened to y 266–560: headroom finding (fail)', sev(short, 'stair-headroom') === 'fail' && sev(short, 'stair-void') === 'fail', short.find((f) => f.ruleId === 'stair-headroom').title);
  const steep = checkStairs({ plan: duplex([{ ...ST1, risers: 14 }], [[520, 200], [620, 200], [620, 759], [520, 759]]) });
  check('steep stair (14 risers → 21.4 cm): riser and 2R + G fail', sev(steep, 'stair-riser') === 'fail' && sev(steep, 'stair-comfort') === 'fail', steep.find((f) => f.ruleId === 'stair-riser').title);
  const narrow = checkStairs({ plan: duplex([{ ...ST1, width: 70 }], [[520, 266], [620, 266], [620, 670], [520, 670]]) });
  check('narrow stair (70 cm): width fails, the rest passes', sev(narrow, 'stair-width') === 'fail' && bad(narrow).join() === 'stair-width', bad(narrow).join(', '));
  const shallow = checkStairs({ plan: duplex([{ ...ST1, going: 24 }], [[520, 266], [620, 266], [620, 700], [520, 700]]) });
  check('going 24 cm: going and 2R + G fail', sev(shallow, 'stair-going') === 'fail' && sev(shallow, 'stair-comfort') === 'fail');
  const noGuard = checkStairs({ plan: duplex([{ ...ST1, guard: false }], [[520, 266], [620, 266], [620, 670], [520, 670]]) });
  check('guard: false on an open stair → guard fails', sev(noGuard, 'stair-guard') === 'fail');
  const orphan = checkStairs({ plan: duplex([{ ...ST1, to: 'L7' }]) });
  check('a stair to a missing level → stair-geometry fail, nothing else', orphan.length === 1 && sev(orphan, 'stair-geometry') === 'fail');
  check('a plan without stairs → no stair finding', checkStairs({ plan: PLAN }).length === 0 && checkStairs({ plan: duplex([]) }).length === 0);
  // through runChecks (registration in regulations/index.js)
  const plan = duplex([ST1], [[520, 266], [620, 266], [620, 670], [520, 670]]);
  store.openProject({ basePlan: plan, phase: 'draft', design: { items: [], project: { ceilingHeight: 280 } } });
  const all = runChecks({ store, plan: PLAN, catalog: null }).filter((f) => f.category === 'Stairs');
  check('runChecks includes the stair findings (category "Stairs")', all.length === ok670.length && all.every((f) => f.ruleId.startsWith('stair-')), `${all.length}`);
}

// ───────────────────────── L and U ─────────────────────────
group('L and U shapes');
{
  const base = { id: 'sx', to: 'L1', x: 500, y: 400, rot: 0, width: 100, risers: 18, going: 29, landing: { at: 9, size: 100 } };
  for (const shape of ['L', 'U']) {
    const gr = S.stairGeometry({ ...base, shape, turn: 'right' }, { rise: RISE }), gl = S.stairGeometry({ ...base, shape, turn: 'left' }, { rise: RISE });
    const R = RISE / 18;
    check(`${shape}: two flights 9 + 9 risers (8 + 8 treads), landing at h = 9R = 150`, gr.flights.map((f) => f.risers).join() === '9,9' && gr.treadCount === 16 && gr.landings.length === 1 && near(gr.landings[0].h, 150));
    check(`${shape}: total rise exact — last flight ends at 300, last tread at 17R`, near(gr.flights.at(-1).h1, RISE) && near(gr.flights[1].treads.at(-1).h, 17 * R) && near(gr.arrival.h, RISE));
    const lb = bbox(gr.landings[0].poly);
    check(`${shape}: landing ${shape === 'L' ? '100 × 100' : '200 × 100 (across both flights)'}`, near(lb.x1 - lb.x0, shape === 'L' ? 100 : 200) && near(lb.y1 - lb.y0, 100), JSON.stringify(lb));
    const mirror = (p) => [2 * base.x - p[0], p[1]];
    const same = (a, b) => a.length === b.length && a.every((p) => b.some((q) => near(p[0], q[0], 1e-6) && near(p[1], q[1], 1e-6)));
    check(`${shape}: turn left mirrors turn right (footprint, walking line, landing)`, same(gl.footprint, gr.footprint.map(mirror)) && same(gl.landings[0].poly, gr.landings[0].poly.map(mirror))
      && gl.walkingLine.every((p, i) => near(p[0], mirror(gr.walkingLine[i])[0]) && near(p[1], gr.walkingLine[i][1]) && near(p[2], gr.walkingLine[i][2])));
    const want = shape === 'L' ? ['[1,0]', '[-1,0]'] : ['[0,1]', '[0,1]'];
    check(`${shape}: arrival direction right ${want[0]} / left ${want[1]}`, JSON.stringify(S.stairArrivalDir({ ...base, shape, turn: 'right' })) === want[0] && JSON.stringify(S.stairArrivalDir({ ...base, shape, turn: 'left' })) === want[1]);
    const walk = shape === 'L' ? 8 * 29 * 2 + 50 + 50 : 8 * 29 * 2 + 50 + 100 + 50;
    check(`${shape}: walking line ${walk} cm, heights 0 → 150 (flat across the landing) → 300`, near(gr.walkLength, walk) && gr.walkingLine[0][2] === 0 && gr.walkingLine.at(-1)[2] === 300 && gr.walkingLine.slice(1, -1).every((p) => near(p[2], 150)), JSON.stringify(gr.walkingLine));
    const lc = [(lb.x0 + lb.x1) / 2, (lb.y0 + lb.y1) / 2];
    check(`${shape}: floorHeightAt on the landing = 150, on flight 2 start = 150, at the arrival = 300`, near(S.floorHeightAt({}, gr, ...lc), 150) && near(S.floorHeightAt({}, gr, ...gr.arrival.mid), 300));
    check(`${shape}: footprint area = 2 flights + landing`, near(ringArea(gr.footprint), 2 * 8 * 29 * 100 + (shape === 'L' ? 100 * 100 : 200 * 100), 0.5), ringArea(gr.footprint).toFixed(1));
  }
  const st = S.stairGeometry({ ...base, shape: 'straight', landing: { at: 9, size: 90 } }, { rise: RISE });
  check('straight with a landing: run = 16 goings + 90', near(st.walkLength, 16 * 29 + 90) && st.flights.length === 2 && near(st.landings[0].h, 150));
  const U = S.stairGeometry({ ...base, shape: 'U', gap: 20 }, { rise: 300 });
  check('U with a 20 cm well: landing 220 wide', near(bbox(U.landings[0].poly).x1 - bbox(U.landings[0].poly).x0, 220));
}

group('stairProblems');
{
  const p = (st, rise = 300) => S.stairProblems(st, null, { rise }).map((x) => x.code);
  check('the fixture has none', p(ST1).length === 0 && S.stairProblems(ST1, geo).length === 0);
  check('too few risers / no width / no going', p({ ...ST1, risers: 1 }).includes('risers') && p({ ...ST1, width: 0 }).includes('width') && p({ ...ST1, going: -1 }).includes('going'));
  check('landing outside the stair (at 0 / at 18 of 18)', p({ ...ST1, landing: { at: 0, size: 100 } }).includes('landing-at') && p({ ...ST1, landing: { at: 18, size: 100 } }).includes('landing-at'));
  check('L quarter landing shorter than the width', p({ ...ST1, shape: 'L', landing: { at: 9, size: 80 } }).includes('landing-size'));
  check('unknown shape, no rise', p({ ...ST1, shape: 'spiral' }).includes('shape') && p(ST1, 0).includes('rise'));
  check('stairGeometry is null for an impossible stair', S.stairGeometry({ ...ST1, risers: 1 }, { rise: 300 }) === null && S.stairGeometry(ST1, { rise: 0 }) === null);
}

group('proposeStair: rises 260 … 340 cm pass their own rules');
{
  const L = STAIR_LIMITS, bads = [];
  for (const shape of ['straight', 'L', 'U']) for (let rise = 260; rise <= 340; rise += 5) {
    const st = { id: 'p', to: 'L1', ...S.proposeStair({ rise, shape }) }, g = S.stairGeometry(st, { rise });
    const R = g && g.riser, c = g && 2 * R + g.going;
    const ok = g && S.stairProblems(st, g).length === 0 && R >= L.riserMin && R <= L.riserMax + 1e-9 && g.going >= L.goingMin && c >= L.comfortMin && c <= L.comfortMax
      && g.width >= L.widthMin && g.flights.every((f) => f.risers <= L.flightMax) && g.landings.every((l) => l.size >= L.landingMin) && near(g.flights.at(-1).h1, rise);
    if (!ok) bads.push(`${shape} ${rise}`);
  }
  check('straight / L / U, every 5 cm: riser ≤ 17.5, going ≥ 26, 2R + G 61–63, width ≥ 80, ≤ 18 per flight, landing ≥ 80, exact rise', bads.length === 0, bads.join(', '));
  const p300 = S.proposeStair({ rise: 300 });
  check('rise 300 → 18 risers of 16.67, going 28.5 (the Duplex uses 29)', p300.risers === 18 && p300.going === 28.5 && !p300.landing);
  check('rise 340 straight → 20 risers with a landing in the middle (18 max per flight)', S.proposeStair({ rise: 340 }).risers === 20 && S.proposeStair({ rise: 340 }).landing.at === 10);
}

// ───────────────────────── 3D ─────────────────────────
group('3D: the Duplex with its stair');
{
  const catalog = { getProduct: () => null };
  const plan = duplex([ST1]);
  store.openProject({ basePlan: plan, phase: 'draft', design: { items: [], project: { ceilingHeight: 280 } } });
  const house = buildHouse({ store, plan: PLAN, catalog });
  house.setLevel('L1');
  const mesh = house.group.getObjectByName('stair:st1');
  check('one stair mesh, merged (3 material groups: treads, body, rails)', !!mesh && mesh.geometry.groups.length === 3 && Array.isArray(mesh.material) && mesh.material.length === 3);
  house.group.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index.array;
  const partBox = (part) => {
    const [start, count] = mesh.userData.parts[part], b = new THREE.Box3(), v = new THREE.Vector3();
    for (let i = start; i < start + count; i++) b.expandByPoint(v.fromBufferAttribute(pos, idx[i]).applyMatrix4(mesh.matrixWorld));
    return b;
  };
  const steps = partBox('treads').union(partBox('body'));
  check('treads + body span Y 0 → 3.00 m', near(steps.min.y, 0, 1e-4) && near(steps.max.y, 3, 1e-4), `${steps.min.y.toFixed(4)} → ${steps.max.y.toFixed(4)}`);
  check('…in plan: x 5.20–6.20, from the first nosing (z 7.62) to the arrival (z 2.66)', near(steps.min.x, 5.2, 1e-4) && near(steps.max.x, 6.2, 1e-4) && near(steps.min.z, 2.66, 1e-4) && near(steps.max.z, 7.62, 1e-4), `x ${steps.min.x}..${steps.max.x} z ${steps.min.z}..${steps.max.z}`);
  // every vertex of the stair above the L1 slab underside (2.80 m) lies inside the void v1 in plan
  let outside = 0, above = 0;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    if (v.y <= 2.8 + 1e-4) continue;
    above++;
    if (!(v.x >= 5.2 - 1e-4 && v.x <= 6.2 + 1e-4 && v.z >= 2.66 - 1e-4 && v.z <= 6.4 + 1e-4)) { if (outside++ < 3) console.log('     outside:', v.toArray().map((q) => q.toFixed(3)).join(', ')); }
  }
  check('every part of the stair above the slab underside (2.80 m) lies inside the void in plan', above > 0 && outside === 0, `${above} vertices above, ${outside} outside`);
  const rails = partBox('rail');
  // F4b: an open side's guard (0.90 m above the pitch line) stops where its top meets the L1 slab beside the stair (pitch
  // 1.90 m, y ≈ 457): from there the slab edge and the void railing on it guard the stair — one railing, not two side by side
  check('guards on both open sides (no wall within 5 cm), 0.90 m above the pitch line, up to the L1 slab (top 2.80, y ≥ 4.57)', rails.min.x >= 5.2 - 1e-4 && rails.max.x <= 6.2 + 1e-4 && near(rails.max.y, 2.8, 0.03) && near(rails.min.z, 4.574, 0.03),
    `x ${rails.min.x.toFixed(3)}..${rails.max.x.toFixed(3)} top ${rails.max.y.toFixed(3)} z from ${rails.min.z.toFixed(3)}`);
  // the void railing's open edge = the stair's arrival edge
  const rail = (() => { let m = null; house.group.getObjectByName('level:L1').traverse((o) => { if (o.isMesh && o.name === 'railing') m = o; }); return m; })();
  const rp = rail.geometry.attributes.position;
  let onArrival = 0;
  for (let i = 0; i < rp.count; i++) { const x = rp.getX(i), z = rp.getZ(i); if (z < 2.66 + 0.04 && x > 5.2 + 0.06 && x < 6.2 - 0.06) onArrival++; }
  check('void railing: open exactly along the arrival edge (y 266, x 520–620), rails on the other three', onArrival === 0 && geo.arrival.a[1] === 266 && geo.arrival.b[1] === 266);
  // visibility per level
  house.setLevel('L0');
  check('ui.level L0 (its bottom level): the stair is shown', mesh.visible);
  house.setLevel('L1');
  check('ui.level L1 (where it arrives): the stair stays shown', mesh.visible);
  house.setWholeHouse(true);
  check('whole house: shown', mesh.visible);
  // rebuild on a plan edit of the stair
  PLAN.stairs = [{ ...ST1, width: 90 }];
  house.rebuildPlan();
  const m2 = house.group.getObjectByName('stair:st1');
  check('a changed stair is rebuilt (width 90)', m2 && m2 !== mesh && (() => { m2.geometry.computeBoundingBox(); return near(m2.geometry.boundingBox.max.x - m2.geometry.boundingBox.min.x, 0.9, 1e-3); })());
  // wall side: a stair along the L0 partition (x 510) gets a wall rail on that side
  PLAN.stairs = [{ ...ST1, x: 562 }];
  house.rebuildPlan();
  const sides = S.stairSides(PLAN.stairs[0], S.stairGeometry(PLAN.stairs[0], { rise: 300 }), PLAN);
  const wallRuns = sides.filter((s) => s.wall), wallLen = wallRuns.reduce((t, s) => t + Math.abs(s.b[1] - s.a[1]), 0);
  check('a side 2 cm from the partition is a wall side (except at the partition door, y 300–390), the other side open', wallRuns.every((s) => s.a[0] === 512)
    && sides.filter((s) => s.a[0] === 612).every((s) => !s.wall) && near(wallLen, 493 - 90, 6), `${sides.map((s) => `${s.a[0]}:${s.wall ? 'wall' : 'open'} y ${s.a[1]}–${s.b[1]}`).join(', ')}`);
  check('…and the original side (10 cm off) is open', S.stairSides(ST1, geo, PLAN).every((s) => !s.wall));
  house.dispose();
}

group('House 98: no stair, no stair group');
{
  store.openProject({ basePlan: JSON.parse(JSON.stringify(B.buildPlan({ walls: DUPLEX.walls, openings: DUPLEX.openings, heights: DUPLEX.heights }).plan)), phase: 'draft', design: { items: [] } });
  const { PLAN: P } = await import('../src/core/plan.js');
  const house = buildHouse({ store, plan: P, catalog: { getProduct: () => null } });
  check('a one-level plan without stairs builds no house-stairs group (mesh hashes: tests/levels-3d.test.mjs)', !house.group.getObjectByName('house-stairs'));
  house.dispose();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
