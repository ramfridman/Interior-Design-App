// Walking between floors — stage F5 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md (docs/CONTRACT.md § 4 "Walking between
// floors"). Headless (plain node), like tests/levels-3d.test.mjs: the walker (src/view3d/walk.js) is driven through its
// update function with synthetic keys on a simulated clock.
//   node tests/walk-levels.test.mjs
// The browser part (enter walk on L0, hold forward up the Duplex stair, arrive on L1, walk down) is tests/walk-levels.e2e.mjs.
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
// a simulated clock (the walker throttles 'walk-position' by performance.now()) and a window whose key listeners we call
let NOW = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => NOW }, configurable: true, writable: true });
const listeners = {};
globalThis.window = { addEventListener: (t, f) => { (listeners[t] ||= new Set()).add(f); }, removeEventListener: (t, f) => { listeners[t] && listeners[t].delete(f); } };

const THREE = await import('three');
const { PLAN } = await import('../src/core/plan.js');
const { store } = await import('../src/core/store.js');
const B = await import('../src/core/plan-build.js');
const S = await import('../src/core/stairs.js');
const { createWalk, EYE_HEIGHT, WALKER_RADIUS } = await import('../src/view3d/walk.js');
const { DUPLEX } = await import('./fixtures/houses.mjs');

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
const clone = (o) => JSON.parse(JSON.stringify(o));
const R = WALKER_RADIUS * 100;

// ───────────────────────── houses ─────────────────────────
const DUPLEX_INPUT = { walls: DUPLEX.walls, openings: DUPLEX.openings, heights: DUPLEX.heights, meta: { name: 'Duplex', floors: 2 }, levels: [clone(DUPLEX.levels[0])] };
function duplexPlan() {
  const plan = B.buildPlan(clone(DUPLEX_INPUT), { levels: true }).plan;
  plan.stairs = clone(DUPLEX.stairs);
  return plan;
}
/**
 * "Turns": a 1200 × 900 two-storey box without partitions, an L stair (turning right) in the west half and a U stair
 * (turning left, 10 cm well) in the east half, both proposed for the 3.00 m rise; the L1 voids = their footprints.
 */
const EXT = () => [
  { id: 'w01', x: 0, y: 0, w: 1240, h: 20, kind: 'exterior' }, { id: 'w02', x: 0, y: 920, w: 1240, h: 20, kind: 'exterior' },
  { id: 'w03', x: 0, y: 20, w: 20, h: 900, kind: 'exterior' }, { id: 'w04', x: 1220, y: 20, w: 20, h: 900, kind: 'exterior' },
];
const LST = { id: 'stL', to: 'L1', ...S.proposeStair({ rise: 300, shape: 'L', width: 100, turn: 'right' }), x: 330, y: 520, rot: 0 };
const UST = { id: 'stU', to: 'L1', ...S.proposeStair({ rise: 300, shape: 'U', width: 100, turn: 'left' }), gap: 10, x: 900, y: 520, rot: 0 };
const geoL = S.stairGeometry(LST, { rise: 300 }), geoU = S.stairGeometry(UST, { rise: 300 });
function turnsPlan() {
  const input = {
    walls: EXT(), heights: { ceiling: 280, slab: 20, parapet: 40, floorAboveGround: 15, doorDefault: 210 }, meta: { name: 'Turns', floors: 2 },
    openings: [{ id: 'door-entry', kind: 'door', style: 'entry', axis: 'h', x: 560, y: 920, w: 100, h: 20, width: 100, height: 210, sill: 0, hinge: 'w', swing: 'n' }],
    levels: [{ id: 'L1', name: 'First floor', elevation: 300, heights: { ceiling: 280, slab: 20, parapet: 40 }, walls: EXT(), openings: [], outdoorAreas: [],
      voids: [{ id: 'vL', polygon: geoL.footprint, stair: 'stL', railing: true }, { id: 'vU', polygon: geoU.footprint, stair: 'stU', railing: true }] }],
  };
  const plan = B.buildPlan(input, { levels: true }).plan;
  plan.stairs = [clone(LST), clone(UST)];
  return plan;
}
const open = (basePlan) => store.openProject({ basePlan, phase: 'draft', design: { items: [], project: { ceilingHeight: basePlan.heights.ceiling } } });

// ───────────────────────── a walker with synthetic input ─────────────────────────
function makeWalker() {
  const events = [];
  const dom = { addEventListener() {}, removeEventListener() {}, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  const levelCalls = [];
  const walk = createWalk({ camera: new THREE.PerspectiveCamera(), dom, overlay: { append() {} }, ctx: { store, plan: PLAN, models: {} }, pickTarget: () => null,
    emit: (name, payload) => { if (name === 'walk-position') events.push(payload); }, requestExit() {}, onLevelChange: (id) => levelCalls.push(id) });
  const held = new Set();
  const key = (type, code) => { for (const f of listeners[type] || []) f({ code, target: { tagName: 'CANVAS' }, preventDefault() {}, ctrlKey: false, metaKey: false, altKey: false }); };
  const hold = (...codes) => { for (const c of [...held]) if (!codes.includes(c)) { key('keyup', c); held.delete(c); } for (const c of codes) if (!held.has(c)) { key('keydown', c); held.add(c); } };
  const DT = 1 / 60;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { NOW += DT * 1000; walk.update(DT); } };
  const eye = () => walk.eyePose().position.y;
  const pos = () => walk.getState();
  /** Hold `codes` until `until()` or `maxS` seconds; calls `each()` every frame. Returns the frames run. */
  const run = (codes, until, maxS = 20, each = null) => { hold(...codes); let n = 0; while (n < maxS * 60 && !until()) { step(); n++; if (each) each(); } hold(); return n; };
  /** Settle: no keys for `s` seconds. */
  const rest = (s = 1) => { hold(); step(Math.round(s * 60)); };
  const levelOfEvent = (e) => e.level || 'L0';
  const crossings = () => { let n = 0; for (let i = 1; i < events.length; i++) if (levelOfEvent(events[i]) !== levelOfEvent(events[i - 1])) n++; return n; };
  /** Steer towards plan points (cm) in turn while holding forward; true when the last one was reached. */
  function follow(points, { tol = 18, maxS = 40, each = null } = {}) {
    let i = 0, n = 0;
    while (i < points.length && n < maxS * 60) {
      const s = pos(), t = points[i], dx = t[0] - s.x, dy = t[1] - s.y;
      if (Math.hypot(dx, dy) < tol) { i++; continue; }
      const want = (Math.atan2(dx, -dy) * 180) / Math.PI;
      const d = ((want - s.heading + 540) % 360) - 180;
      hold(...(Math.abs(d) < 25 ? ['KeyW'] : []), ...(d > 2 ? ['KeyE'] : d < -2 ? ['KeyQ'] : []));   // turn on the spot when far off
      step(); n++;
      if (each) each();
    }
    hold();
    return i === points.length;
  }
  return { walk, events, levelCalls, hold, step, run, rest, eye, pos, crossings, follow };
}

// ───────────────────────── the Duplex: up and down the straight stair ─────────────────────────
group('Duplex: up the straight stair from (570, 740) on L0 to L1');
open(duplexPlan());
const geo = S.stairGeometry(PLAN.stairs[0], { rise: 300 });
{
  const W = makeWalker(), { walk } = W;
  walk.start({ level: 'L0', x: 570, y: 740, heading: 0, pointerLock: false });
  check('starts on the stair, on L0, at its smooth height (eye 1.65 + 0.12 m)', walk.getLevel() === 'L0' && walk.getStair() && walk.getStair().id === 'st1' && near(W.eye(), EYE_HEIGHT + 19 / 493 * 3, 0.005), `${W.eye().toFixed(3)} ${JSON.stringify(walk.getStair())}`);
  const trace = [];
  let mid = null, speedOn = 0;
  W.run(['KeyW'], () => walk.getLevel() === 'L1' && W.pos().y < 266 - 5, 20, () => {
    const s = W.pos();
    trace.push({ y: s.y, eye: W.eye(), stair: s.stair, level: walk.getLevel() });
    if (!mid && s.y <= 512.5) mid = { ...s, eye: W.eye() };
    if (s.stair && s.y < 700 && s.y > 400) speedOn = Math.max(speedOn, s.speed);
  });
  W.rest(1);
  const end = W.pos();
  let mono = true;
  for (let i = 1; i < trace.length; i++) if (trace[i].eye < trace[i - 1].eye - 1e-9) mono = false;
  check('the eye height rises monotonically all the way up', mono && trace.length > 60, `${trace.length} frames`);
  check('halfway up (y 512.5) the eye is ≈ half the rise above 1.65 m (1.50 ± 0.08)', mid && near(mid.eye - EYE_HEIGHT, 1.5, 0.08), mid && (mid.eye - EYE_HEIGHT).toFixed(3));
  check('speed on the stair ≈ 0.7 × walking speed (1.4 m/s)', near(speedOn, 0.98, 0.03), speedOn.toFixed(3));
  check('ends on L1 near (570, 280): eye at 3.00 + 1.65 m, off the stair', walk.getLevel() === 'L1' && !walk.getStair() && near(end.x, 570, 3) && Math.abs(end.y - 280) < 45 && near(W.eye(), 4.65, 1e-3), `(${end.x.toFixed(1)}, ${end.y.toFixed(1)}) eye ${W.eye().toFixed(4)} ${walk.getLevel()}`);
  check('the level switched near the top (on the last riser, y < 300)', trace.find((t) => t.level === 'L1').y < 300, trace.find((t) => t.level === 'L1').y.toFixed(1));
  check("'walk-position' reports the level change exactly once; onLevelChange('L1') once", W.crossings() === 1 && W.events.at(-1).level === 'L1' && W.levelCalls.join() === 'L1', `${W.crossings()} ${W.levelCalls.join()}`);
  check('the room label follows: the walker is in an L1 room', PLAN.levels[0].rooms.some((r) => r.id === end.spaceId), end.spaceId);

  group('Duplex: on L1');
  // L0 blockers do not apply on L1 (its partition x 500–510) and L1's do (x 300–310)
  walk.teleport(420, 150, 90); W.rest(0.2);
  W.run(['KeyW'], () => W.pos().x > 700, 6);
  check('L1: walking east at y 150 crosses x 505 (the L0 partition does not block)', walk.getLevel() === 'L1' && W.pos().x > 700, W.pos().x.toFixed(1));
  walk.teleport(420, 600, 270); W.rest(0.2);
  W.run(['KeyW'], () => W.pos().x < 200, 4);
  check('L1: walking west at y 600 stops at the L1 partition (x 310 + 22)', near(W.pos().x, 310 + R, 1.5), W.pos().x.toFixed(1));
  // the void: east of it, walking west → stopped at its railing (x 620 + 4 + 22); south of it, walking north → y 670 + 4 + 22
  walk.teleport(760, 450, 270); W.rest(0.2);
  W.run(['KeyW'], () => false, 3);
  check('L1: the void railing stops a walker from the east (x ≥ 646), still on L1 at 3.00 m', walk.getLevel() === 'L1' && near(W.pos().x, 620 + 4 + R, 1.5) && near(W.eye(), 4.65, 1e-3), W.pos().x.toFixed(1));
  walk.teleport(570, 740, 0); W.rest(0.2);
  check('L1: (570, 740) is beyond the void — the walker stands on the L1 floor there', walk.getLevel() === 'L1' && !walk.getStair() && near(W.eye(), 4.65, 1e-3));
  W.run(['KeyW'], () => false, 3);
  check('L1: from the south, the void railing stops the walker at y 670 + 4 + 22', near(W.pos().y, 670 + 4 + R, 1.5) && walk.getLevel() === 'L1', W.pos().y.toFixed(1));
  check('L1: blockedAt(…, { here }) sees the railing, the plain level test does not', walk.blockedAt(570, 690, { here: true }) && !walk.blockedAt(570, 690));
  // diagonal into the corner of the void next to the arrival: no way in except along the arrival edge
  walk.teleport(700, 200, 225); W.rest(0.2);
  W.run(['KeyW'], () => false, 4);
  const sw = W.pos();
  check('L1: walking south-west past the arrival corner does not drop into the void', walk.getLevel() === 'L1' && (sw.y < 266 || sw.x > 620) && near(W.eye(), 4.65, 1e-3), `(${sw.x.toFixed(1)}, ${sw.y.toFixed(1)})`);

  group('Duplex: down again');
  walk.teleport(570, 200, 180); W.rest(0.3);
  const before = W.events.length, downTrace = [];
  W.run(['KeyW'], () => false, 9, () => downTrace.push({ eye: W.eye(), level: walk.getLevel(), y: W.pos().y }));
  W.rest(1);
  let monoDown = true;
  for (let i = 1; i < downTrace.length; i++) if (downTrace[i].eye > downTrace[i - 1].eye + 1e-9) monoDown = false;
  const evs = W.events.slice(before);
  let downCross = 0; for (let i = 1; i < evs.length; i++) if ((evs[i].level || 'L0') !== (evs[i - 1].level || 'L0')) downCross++;
  check('walking down: the eye falls monotonically', monoDown && downTrace.length > 60);
  check('back on L0 at the foot of the stair (the south wall stops at y 758) with the eye at 1.65 m (+ ≤ 1 cm of stair)', walk.getLevel() === 'L0' && near(W.pos().y, 780 - R, 1.5) && near(W.eye(), 1.65, 0.011), `${walk.getLevel()} y ${W.pos().y.toFixed(1)} eye ${W.eye().toFixed(4)}`);
  check("…'walk-position' reported that change exactly once", downCross === 1 && (evs.at(-1).level || 'L0') === 'L0', String(downCross));
  // off the bottom step sideways (east), onto the L0 floor
  W.run(['KeyA'], () => W.pos().x > 680, 4);   // facing south: A = east
  check('off the first tread sideways onto the L0 floor (east of the stair)', walk.getLevel() === 'L0' && !walk.getStair() && W.pos().x > 680 && near(W.eye(), 1.65, 1e-3), `x ${W.pos().x.toFixed(1)} ${JSON.stringify(walk.getStair())}`);

  group('Duplex: the sides of the flight and the underside');
  walk.start({ level: 'L0', x: 570, y: 740, heading: 0, pointerLock: false });
  W.run(['KeyW'], () => W.pos().y < 520, 8);
  W.rest(1);
  const h0 = walk.getStair() && walk.getStair().height;
  W.run(['KeyD'], () => false, 2);
  check('mid-flight, strafing east: stopped by the open side (x ≤ 620 − 22), still on the stair', walk.getStair() && W.pos().x <= 620 - R + 0.5 && near(walk.getStair().height, h0, 3), `x ${W.pos().x.toFixed(1)} h ${walk.getStair() && walk.getStair().height.toFixed(1)}`);
  W.run(['KeyA'], () => false, 3);
  check('…strafing west: stopped by the other side (x ≥ 520 + 22)', walk.getStair() && W.pos().x >= 520 + R - 0.5 && walk.getLevel() === 'L0', `x ${W.pos().x.toFixed(1)}`);
  // under the flight from the north part of the L0 east room: headroom ≥ 1.80 m north of y ≈ 415, blocked south of it
  walk.start({ level: 'L0', x: 570, y: 300, heading: 180, pointerLock: false });
  check('L0 under the high end of the flight (headroom > 1.80 m): standing on the L0 floor, not on the stair', walk.getLevel() === 'L0' && !walk.getStair() && near(W.eye(), 1.65, 1e-3));
  W.run(['KeyW'], () => false, 4);
  const sc = 759 - ((180 + 18) * 29) / (300 / 18);
  check(`L0: walking south under the flight stops where the headroom drops below 1.80 m (y ${sc.toFixed(0)} − 22)`, near(W.pos().y, sc - R, 1.5) && walk.getLevel() === 'L0' && !walk.getStair(), W.pos().y.toFixed(1));
  walk.start({ level: 'L0', x: 800, y: 600, heading: 270, pointerLock: false });
  W.run(['KeyW'], () => false, 4);
  check('L0: from the east at y 600 the low part of the flight blocks (x ≥ 620 + 4 + 22)', near(W.pos().x, 620 + 4 + R, 1.5) && !walk.getStair(), W.pos().x.toFixed(1));
  walk.start({ level: 'L0', x: 200, y: 600, heading: 90, pointerLock: false });
  W.run(['KeyW'], () => W.pos().x > 400, 4);
  check('L0: the L1 partition (x 300) does not block on L0', W.pos().x > 400 && walk.getLevel() === 'L0');

  group('Duplex: PageUp / PageDown');
  walk.start({ level: 'L0', x: 800, y: 600, heading: 0, pointerLock: false });
  const n0 = W.events.length;
  const up = walk.stairJump(1);
  check('PageUp: to the top of the stair, on L1, a step past the arrival edge, facing north', up && walk.getLevel() === 'L1' && near(W.pos().y, 266 - R - 15, 0.5) && near(W.pos().heading % 360, 0, 0.5) && near(W.eye(), 4.65, 1e-3), `(${W.pos().x}, ${W.pos().y}) ${W.pos().heading}`);
  const down = walk.stairJump(-1);
  check('PageDown: to the foot of the stair, on L0, facing away from it', down && walk.getLevel() === 'L0' && near(W.eye(), 1.65, 1e-3), `(${W.pos().x.toFixed(1)}, ${W.pos().y.toFixed(1)})`);
  check('…each jump reported its level once', W.events.slice(n0 - 1).filter((e, i, a) => i > 0 && (e.level || 'L0') !== (a[i - 1].level || 'L0')).length === 2);
  walk.dispose();
}

// ───────────────────────── L and U stairs: landings and turns ─────────────────────────
for (const [name, st, g] of [['L stair (turning right)', LST, geoL], ['U stair (turning left, 10 cm well)', UST, geoU]]) {
  group(`Turns: ${name}`);
  open(turnsPlan());
  const W = makeWalker(), { walk } = W;
  const s = g.start, a = g.arrival;
  const before = [s.mid[0] - s.dir[0] * 40, s.mid[1] - s.dir[1] * 40];
  walk.start({ level: 'L0', x: before[0], y: before[1], heading: (Math.atan2(s.dir[0], -s.dir[1]) * 180) / Math.PI, pointerLock: false });
  const line = g.walkingLine.map((p) => [p[0], p[1]]);
  const offTop = [a.mid[0] + a.dir[0] * 60, a.mid[1] + a.dir[1] * 60];
  let landing = 0, trace = [];
  const ok = W.follow([...line, offTop], {
    each: () => { const t = walk.getStair(); trace.push(W.eye()); if (t && g.landings.some((l) => near(t.height, l.h, 1e-6))) landing++; },
  });
  W.rest(0.6);
  let mono = true; for (let i = 1; i < trace.length; i++) if (trace[i] < trace[i - 1] - 1e-9) mono = false;
  check('up: the walker follows the walking line through the turn onto L1', ok && walk.getLevel() === 'L1' && near(W.eye(), 4.65, 1e-3), `${ok} ${walk.getLevel()} eye ${W.eye().toFixed(3)} at (${W.pos().x.toFixed(0)}, ${W.pos().y.toFixed(0)})`);
  check('up: the landing is flat (frames at exactly its height), the eye never goes down', landing > 5 && mono, `${landing} frames on the landing`);
  check('up: one level change reported', W.crossings() === 1);
  const back = [...line].reverse(), foot = before;
  const ok2 = W.follow([[a.mid[0] - a.dir[0] * 10, a.mid[1] - a.dir[1] * 10], ...back, foot], { tol: 20 });
  W.rest(0.6);
  check('down: back through the turn and off the bottom onto L0 (eye 1.65 m)', ok2 && walk.getLevel() === 'L0' && !walk.getStair() && near(W.eye(), 1.65, 1e-3), `${ok2} ${walk.getLevel()} eye ${W.eye().toFixed(3)} at (${W.pos().x.toFixed(0)}, ${W.pos().y.toFixed(0)})`);
  check('down: one more level change reported (two in all)', W.crossings() === 2, String(W.crossings()));
  walk.dispose();
}

// ───────────────────────── one level: nothing changes ─────────────────────────
group('A one-level plan (no stairs, no voids)');
{
  const one = clone(DUPLEX_INPUT); delete one.levels;
  open(B.buildPlan(one).plan);
  const W = makeWalker(), { walk } = W;
  walk.start({ x: 700, y: 650, heading: 0, pointerLock: false });
  W.run(['KeyW'], () => false, 6);
  check('walks to the north wall (y 20 + 22) at 1.65 m, no stair state, events without level', near(W.pos().y, 20 + R, 1.5) && !walk.getStair() && near(W.eye(), 1.65, 1e-3) && W.events.every((e) => !('level' in e)) && !('stair' in W.pos()),
    `y ${W.pos().y.toFixed(1)} eye ${W.eye().toFixed(3)} ${JSON.stringify(W.events.at(-1))}`);
  check('PageUp does nothing without stairs', walk.stairJump(1) === false);
  walk.dispose();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
