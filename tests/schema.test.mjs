// Schema and persistence seams (stage G2 of docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md): a plan carrying the optional schema-2
// keys (schema, slants, stairs, levels) passes untouched through the plan state, the store, project records / files and
// the collaboration doc, while every existing plan, design, project file and doc stays byte-identical.
// tests/fixtures/schema-golden.json was captured BEFORE the seams were added (identity of old data, section c).
//   node tests/schema.test.mjs            run
//   node tests/schema.test.mjs --update   rewrite the golden file (only when a change of old data is intended)
// The collaboration part runs two real-store replicas: this same file in worker threads (see replica() at the end).
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (!isMainThread) await replica();
else await main();

async function main() {
  const { PLAN } = await import('../src/core/plan.js');
  const { store } = await import('../src/core/store.js');
  const E = await import('../src/core/plan-edit.js');
  const B = await import('../src/core/plan-build.js');
  const P = await import('../src/core/projects.js');
  const OPS = await import('../src/collab/ops.js');

  const GOLDEN = new URL('./fixtures/schema-golden.json', import.meta.url);
  const UPDATE = process.argv.includes('--update');
  store.persist = false;
  let failed = 0, passed = 0;
  const group = (name) => console.log(`\n${name}`);
  const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const H98 = JSON.stringify(PLAN);

  // ───────────────────────── (c) identity of old data: capture ─────────────────────────
  /** JSON text with random ids, timestamps and today's date replaced by stable tokens (order of first appearance). */
  function stable(v) {
    const map = new Map();
    const tok = (s, pre) => { if (!map.has(s)) map.set(s, `${pre}#${map.size}`); return map.get(s); };
    return JSON.stringify(v)
      .replace(/"(it_[a-z0-9]+|p_[a-z0-9]+)"/g, (m, s) => `"${tok(s, s.slice(0, 2))}"`)
      .replace(/"\d{4}-\d\d-\d\dT[0-9:.]+Z"/g, '"<time>"')
      .replace(/"date":"\d{4}-\d\d-\d\d"/g, '"date":"<today>"');
  }
  const ser = () => { const s = store.serialize(); delete s.savedAt; return stable(s); };
  const strip = ({ rooms, exterior, outside, ...o }) => o;

  async function capture() {
    const out = {};
    out.builtinPlan = JSON.stringify(E.BUILTIN_PLAN);
    out.planAtImport = H98;
    out.planKeys = JSON.stringify(E.PLAN_KEYS);
    const adapter = P.createMemoryAdapter();
    const projects = P.createProjects({ store, adapter });
    await projects.init();
    out.initDesign = ser();
    out.initPlanKey = E.planStateKey();
    // plan edits, undo / redo, history snapshot
    const w = E.addWall({ x1: 1000, y1: 135, x2: 1002, y2: 500 });
    const d = E.addOpening({ kind: 'opening', x: 1000, y: 300, width: 120 });
    const room = PLAN.rooms[0];
    E.updateRoom(room.id, { name: 'Study' });
    out.editsOk = JSON.stringify([w.ok, d.ok]);
    out.editedDesign = ser();
    out.editedPlanKey = E.planStateKey();
    out.editedSnapshot = stable(JSON.parse(store._snapshot()));
    out.editedPlanData = JSON.stringify(E.currentPlanData());
    store.undo(); out.undoDesign = ser();
    store.redo(); out.redoDesign = ser();
    out.exportBuiltin = stable(JSON.parse((await projects.exportFile()).text));
    // a design file round trip
    const file = clone(store.serialize());
    store.load(file, { restoreUI: true });
    out.reloadedDesign = ser();
    store.load({ app: 'e7-interior-design', version: 1, project: { name: 'Our house', ceilingHeight: 300 }, items: [{ id: 'it_x', type: 'sofa', x: 500, y: 300, w: 200, d: 90, h: 80 }], finishes: {}, planEdits: null }, { restoreUI: true });
    out.legacyDesign = ser();
    // phases
    const blank = await projects.create({ name: 'Blank', from: 'blank', lot: { width: 2000, depth: 1500 } });
    out.blankDesign = ser();
    out.blankBase = JSON.stringify(E.BASE_PLAN);
    E.addWall({ x1: 0, y1: 0, x2: 800, y2: 0, thickness: 20 });
    E.addWall({ x1: 0, y1: 0, x2: 0, y2: 600, thickness: 20 });
    out.draftDesign = ser();
    out.draftPlanData = JSON.stringify(E.currentPlanData());
    store.setPlanPhase('fixed');
    out.fixedBase = JSON.stringify(E.BASE_PLAN);
    out.fixedDesign = ser();
    out.exportBlank = stable(JSON.parse((await projects.exportFile()).text));
    const dup = await projects.duplicate(blank.project.id);
    out.duplicate = stable(await adapter.get(dup.project.id));
    // buildPlan / emptyPlan
    const built = B.buildPlan({ walls: PLAN.walls, openings: E.BUILTIN_PLAN.openings.map(strip), meta: E.BUILTIN_PLAN.meta, heights: E.BUILTIN_PLAN.heights });
    out.buildH98 = JSON.stringify(built);
    out.emptyPlan = JSON.stringify(B.emptyPlan());
    out.buildDiagonal = JSON.stringify(B.buildPlan({ walls: [{ x1: 0, y1: 0, x2: 400, y2: 300, thickness: 10 }, [0, 0, 500, 20, 'exterior']], openings: [] }));
    out.buildFloors = JSON.stringify(B.buildPlan({ walls: [[0, 0, 500, 20, 'exterior'], { x: 0, y: 0, w: 20, h: 400, floor: 2 }], openings: [], meta: { floors: 2 } }));
    const fromPlan = await projects.create({ name: 'Imported', fromPlan: built.plan });
    out.fromPlanDesign = ser();
    out.exportFromPlan = stable(JSON.parse((await projects.exportFile()).text));
    const imp = await projects.importFile((await projects.exportFile(fromPlan.project.id)).text);
    out.importedRecord = stable(await adapter.get(imp.project.id));
    out.importedDesign = ser();
    // collaboration doc
    const rec = { id: 'r', name: 'House', phase: 'fixed', basePlan: clone(E.BUILTIN_PLAN), design: { ...P.builtinDesign(), planEdits: JSON.parse(out.editedPlanKey) } };
    const doc = OPS.recordToDoc(rec);
    out.doc = stable(doc);
    out.docRecord = stable(OPS.docToRecord(doc));
    out.planCheck = JSON.stringify(OPS.validateOps([{ k: 'plan', p: doc.e.plan }, { k: 'plan', s: { edits: doc.e.plan.edits } }]));
    // back to the built-in house
    await projects.create({ from: 'house98', name: 'Again' });
    out.againDesign = ser();
    out.againPlan = JSON.stringify(PLAN);
    return out;
  }

  group('(c) old plans, designs, project files and docs are byte-identical to the golden capture');
  {
    const now = await capture();
    if (UPDATE || !existsSync(GOLDEN)) { writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n'); console.log('  golden written'); }
    const gold = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    for (const k of Object.keys(gold)) check(k, gold[k] === now[k], gold[k] === now[k] ? '' : `${String(now[k]).slice(0, 200)}`);
    check('no capture key missing', Object.keys(now).every((k) => k in gold));
  }

  // ───────────────────────── test plans (schema 2) ─────────────────────────
  const S = await import('../src/core/plan-schema.js');
  const { FEATURES, setFeatureForTests } = await import('../src/core/features.js');
  const { DEFAULT_UI, normalizeItem } = await import('../src/core/store.js');
  let F = null;
  try { F = await import('./fixtures/houses.mjs'); } catch (e) { F = null; }
  const rectOpenings = (list) => list.filter((o) => o.axis !== 'a');
  /** Duplex: L0 built by buildPlan (rects only), stairs and the upper level passed through untouched. */
  const DUPLEX = F ? F.DUPLEX : {
    walls: [[0, 0, 1000, 20, 'exterior'], [0, 780, 1000, 20, 'exterior'], [0, 20, 20, 760, 'exterior'], [980, 20, 20, 760, 'exterior'], [500, 20, 10, 760, 'interior']],
    openings: [{ id: 'door-part-0', kind: 'door', axis: 'v', x: 500, y: 300, w: 10, h: 90 }, { id: 'door-entry', kind: 'door', style: 'entry', axis: 'h', x: 200, y: 780, w: 100, h: 20 }],
    heights: { ceiling: 280, slab: 20, parapet: 40, floorAboveGround: 15, doorDefault: 210 },
    stairs: [{ id: 'st1', to: 'L1', shape: 'straight', x: 570, y: 512.5, rot: 0, width: 100, risers: 18, going: 29 }],
    levels: [{ id: 'L1', name: 'First floor', elevation: 300, heights: { ceiling: 280, slab: 20, parapet: 40 },
      walls: [{ id: 'w01', x: 0, y: 0, w: 1000, h: 20, kind: 'exterior' }, { id: 'w05', x: 300, y: 20, w: 10, h: 760, kind: 'interior' }],
      openings: [{ id: 'door-part-1', kind: 'door', axis: 'v', x: 300, y: 100, w: 10, h: 90, width: 90, height: 210, sill: 0 }],
      voids: [{ id: 'v1', polygon: [[520, 266], [620, 266], [620, 640], [520, 640]], stair: 'st1', railing: true }], outdoorAreas: [] }],
  };
  const duplexBuilt = B.buildPlan({ walls: DUPLEX.walls, openings: DUPLEX.openings, heights: DUPLEX.heights, meta: { name: 'Duplex', floors: 2 }, stairs: DUPLEX.stairs, levels: DUPLEX.levels }, { passThrough: true });
  const DUPLEX_PLAN = duplexBuilt.plan;
  /** Wedge, hand-made: a built L0 of its rectangles, then the slants and the slant openings added by hand, `schema` FIRST. */
  const WEDGE = F ? F.WEDGE : {
    walls: [[0, 0, 1000, 20, 'exterior'], [0, 20, 20, 760, 'exterior'], [0, 780, 600, 20, 'exterior'], [500, 20, 10, 760, 'interior']],
    slants: [{ id: 's01', x1: 990, y1: 10, x2: 590, y2: 790, t: 20, kind: 'exterior' }, { id: 's02', x1: 25, y1: 300, x2: 300, y2: 25, t: 10, kind: 'interior' }],
    openings: [{ id: 'win-s01', kind: 'window', style: 'sliding', wall: 's01', axis: 'a', at: 438.3, width: 120, height: 120, sill: 90 },
      { id: 'door-part', kind: 'door', axis: 'v', x: 500, y: 350, w: 10, h: 80 }],
  };
  const wedgeL0 = B.buildPlan({ walls: WEDGE.walls, openings: rectOpenings(WEDGE.openings), meta: { name: 'Wedge' } }).plan;
  const WEDGE_PLAN = { schema: 2, ...wedgeL0, openings: [...wedgeL0.openings, ...clone(WEDGE.openings.filter((o) => o.axis === 'a'))], slants: clone(WEDGE.slants) };
  const WEDGE_CANON = JSON.stringify(S.normalizeOptionalKeys(clone(WEDGE_PLAN)));
  const canon = (o) => (Array.isArray(o) ? o.map(canon) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, canon(o[k])])) : o);
  const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  const noOptional = (o) => S.OPTIONAL_KEYS.every((k) => !(k in o));

  group('fixtures');
  check(`shared fixtures ${F ? 'from tests/fixtures/houses.mjs' : 'defined here (houses.mjs missing)'}`, true);
  check('Duplex builds with passThrough: ok, schema 2, stairs / levels untouched, meta.floors 2', duplexBuilt.ok && DUPLEX_PLAN.schema === 2
    && JSON.stringify(DUPLEX_PLAN.levels) === JSON.stringify(DUPLEX.levels) && JSON.stringify(DUPLEX_PLAN.stairs) === JSON.stringify(DUPLEX.stairs) && DUPLEX_PLAN.meta.floors === 2,
  JSON.stringify(duplexBuilt.warnings.filter((w) => w.level !== 'info')));
  check('the optional keys come last, in OPTIONAL_KEYS order', JSON.stringify(Object.keys(DUPLEX_PLAN).slice(-3)) === '["schema","stairs","levels"]');
  check('both plans pass the schema checks and isPlanData', !S.optionalKeysProblem(DUPLEX_PLAN) && !S.optionalKeysProblem(WEDGE_PLAN) && P.isPlanData(DUPLEX_PLAN) && P.isPlanData(WEDGE_PLAN));
  check('FEATURES default off; the test setter flips and restores', FEATURES.angledWalls === false && FEATURES.levels === false
    && setFeatureForTests('levels', true) === false && FEATURES.levels === true && setFeatureForTests('levels', false) === true && FEATURES.levels === false);

  // ───────────────────────── (a) round trips ─────────────────────────
  group('(a) setBasePlan → currentPlanData');
  E.setBasePlan(DUPLEX_PLAN, { phase: 'fixed' });
  check('Duplex: currentPlanData is byte-identical to the plan', JSON.stringify(E.currentPlanData()) === JSON.stringify(DUPLEX_PLAN));
  check('Duplex: BASE_PLAN is byte-identical, not the built-in house, no edits', JSON.stringify(E.BASE_PLAN) === JSON.stringify(DUPLEX_PLAN) && !E.isBuiltinBase() && E.planState() === null && !E.isPlanModified());
  E.setBasePlan(WEDGE_PLAN, { phase: 'fixed' });
  check('Wedge (hand-made, schema first): same data, optional keys moved last', same(E.currentPlanData(), WEDGE_PLAN) && JSON.stringify(E.currentPlanData()) === WEDGE_CANON);
  check('Wedge → Duplex: no slants left over, Duplex byte-identical', (E.setBasePlan(DUPLEX_PLAN), !('slants' in PLAN)) && JSON.stringify(E.currentPlanData()) === JSON.stringify(DUPLEX_PLAN));
  check('setBasePlan(currentPlanData()) is a fixed point', (E.setBasePlan(E.currentPlanData()), JSON.stringify(E.BASE_PLAN) === JSON.stringify(DUPLEX_PLAN)));

  group('(b) back to the built-in house');
  E.setBasePlan(E.BUILTIN_PLAN);
  check('PLAN is byte-identical to a fresh import of plan.js', JSON.stringify(PLAN) === H98 && noOptional(PLAN));
  check('isBuiltinBase() is true again', E.isBuiltinBase());
  check('lazy schema: empty optional lists on the built-in house are dropped → built-in again', (E.setBasePlan({ ...clone(E.BUILTIN_PLAN), schema: 2, slants: [], levels: [] }), E.isBuiltinBase() && JSON.stringify(PLAN) === H98));
  check('normalizeOptionalKeys: schema 2 only while data remains', JSON.stringify(S.normalizeOptionalKeys({ a: 1, schema: 2, stairs: [] })) === '{"a":1}'
    && JSON.stringify(S.normalizeOptionalKeys({ slants: [{ id: 's' }], a: 1 })) === '{"a":1,"schema":2,"slants":[{"id":"s"}]}');

  group('(a) store: plan edits, serialize → load, undo / redo, phase switch (a base switch)');
  const adapter = P.createMemoryAdapter();
  const projects = P.createProjects({ store, adapter });
  const dup = await projects.create({ name: 'Duplex', fromPlan: DUPLEX_PLAN, phase: 'draft' });
  check('create from the Duplex plan (draft)', dup.ok && JSON.stringify(E.BASE_PLAN) === JSON.stringify(DUPLEX_PLAN) && E.planPhase() === 'draft');
  const opened = JSON.stringify(E.currentPlanData());
  const add = E.addWall({ x1: 250, y1: 20, x2: 250, y2: 500 });
  check('a wall edit on the ground level works', add.ok, add.reason);
  const st = E.planState();
  check('planState carries schema / stairs / levels, unchanged', st && st.schema === 2 && JSON.stringify(st.levels) === JSON.stringify(DUPLEX_PLAN.levels) && JSON.stringify(st.stairs) === JSON.stringify(DUPLEX_PLAN.stairs) && !('slants' in st));
  const edited = JSON.stringify(E.currentPlanData()), editedKey = E.planStateKey();
  const file = clone(store.serialize());
  check('serialize: planEdits holds the optional keys', file.planEdits.schema === 2 && same(file.planEdits.levels, DUPLEX_PLAN.levels));
  store.undo();
  check('undo → the opened plan, byte-identical, not modified', JSON.stringify(E.currentPlanData()) === opened && !E.isPlanModified());
  store.redo();
  check('redo → the edited plan, byte-identical', JSON.stringify(E.currentPlanData()) === edited && E.planStateKey() === editedKey);
  store.load(clone({ ...file, planEdits: null }));
  check('load a design without edits → the base (levels kept: they are the base\'s)', JSON.stringify(E.currentPlanData()) === opened);
  store.load(clone(file));
  check('load the saved design → the edited plan, byte-identical', JSON.stringify(E.currentPlanData()) === edited && E.planStateKey() === editedKey);
  store.setPlanPhase('fixed');
  check('draft → fixed (setBasePlan(currentPlanData())): the new base keeps the optional keys', JSON.stringify(E.BASE_PLAN) === edited && !E.isPlanModified() && E.planState() === null);
  const add2 = E.addWall({ x1: 750, y1: 300, x2: 750, y2: 780 });
  const edited2 = JSON.stringify(E.currentPlanData());
  store.undo();
  const back = JSON.stringify(E.currentPlanData());
  store.redo();
  check('fixed: edit, undo, redo — byte-identical each way', add2.ok && back === edited && JSON.stringify(E.currentPlanData()) === edited2, add2.reason);
  const editedRec = { basePlan: JSON.parse(edited), design: clone(store.serialize()) };

  group('(a) projects: export file → import file → open, duplicate, open by id');
  const exp = await projects.exportFile();
  const fileRec = JSON.parse(exp.text).project;
  check('the project file holds the plan (version 1)', JSON.parse(exp.text).version === 1 && JSON.stringify(fileRec.basePlan) === edited && same(fileRec.design.planEdits.levels, DUPLEX_PLAN.levels));
  const imp = await projects.importFile(exp.text);
  check('import → open: base and edited plan byte-identical', imp.ok && JSON.stringify(E.BASE_PLAN) === edited && JSON.stringify(E.currentPlanData()) === edited2);
  check('imported record is not marked built-in', (await adapter.get(imp.project.id)).builtin === false);
  const cp = await projects.duplicate(imp.project.id);
  const cpRec = await adapter.get(cp.project.id);
  check('duplicate keeps basePlan and planEdits', JSON.stringify(cpRec.basePlan) === edited && JSON.stringify(cpRec.design.planEdits) === JSON.stringify(fileRec.design.planEdits));
  const wedge = await projects.create({ name: 'Wedge', fromPlan: WEDGE_PLAN, phase: 'fixed' });
  check('Wedge project opens: slants and slant openings kept', wedge.ok && JSON.stringify(E.currentPlanData()) === WEDGE_CANON);
  const wexp = await projects.exportFile();
  const wimp = await projects.importFile(wexp.text);
  check('Wedge: export → import → open, byte-identical', wimp.ok && JSON.stringify(E.currentPlanData()) === WEDGE_CANON && same(JSON.parse(wexp.text).project.basePlan, WEDGE_PLAN));
  check('open the Duplex copy by id → identical again', (await projects.open(cp.project.id)) && JSON.stringify(E.currentPlanData()) === edited2);

  group('(b) from the edited Duplex back to the built-in house');
  await projects.create({ from: 'house98', name: 'House' });
  check('PLAN byte-identical to plan.js, no optional keys, isBuiltinBase()', JSON.stringify(PLAN) === H98 && noOptional(PLAN) && E.isBuiltinBase() && E.planState() === null);
  check('the planStateKey of the built-in house is "null" again', E.planStateKey() === 'null');

  // ───────────────────────── (d) malformed data ─────────────────────────
  group('(d) malformed optional data is refused cleanly');
  const bad = (patch) => ({ ...clone(DUPLEX_PLAN), ...patch });
  const L1 = DUPLEX_PLAN.levels[0];
  const cases = [
    ['schema 3', { schema: 3 }],
    ['levels not a list', { levels: { L1 } }],
    ['level without id', { levels: [{ ...L1, id: undefined }] }],
    ['level called L0', { levels: [{ ...L1, id: 'L0' }] }],
    ['level without elevation', { levels: [{ ...L1, elevation: 'high' }] }],
    ['level wall not a rectangle', { levels: [{ ...L1, walls: [{ x: 0, y: 0, w: -5, h: 10 }] }] }],
    ['level openings missing', { levels: [{ ...L1, openings: undefined }] }],
    ['level rooms not a list', { levels: [{ ...L1, rooms: 'many' }] }],
    ['two levels L1', { levels: [L1, L1] }],
    ['slant without thickness', { slants: [{ id: 's1', x1: 0, y1: 0, x2: 100, y2: 100, kind: 'interior' }] }],
    ['slant of zero length', { slants: [{ id: 's1', x1: 5, y1: 5, x2: 5, y2: 5, t: 10, kind: 'interior' }] }],
    ['slant of unknown kind', { slants: [{ id: 's1', x1: 0, y1: 0, x2: 100, y2: 100, t: 10, kind: 'glass' }] }],
    ['duplicate slant ids', { slants: [{ id: 's1', x1: 0, y1: 0, x2: 100, y2: 100, t: 10, kind: 'interior' }, { id: 's1', x1: 0, y1: 50, x2: 100, y2: 150, t: 10, kind: 'interior' }] }],
    ['stair without position', { stairs: [{ id: 'st1', to: 'L1' }] }],
    ['stair of unknown shape', { stairs: [{ id: 'st1', x: 1, y: 1, shape: 'spiral' }] }],
  ];
  for (const [name, patch] of cases) {
    const p = bad(patch);
    const reason = S.optionalKeysProblem(p);
    const op = OPS.validateOps([{ k: 'plan', p: { phase: 'fixed', base: p, edits: null } }]);
    const opEdits = OPS.validateOps([{ k: 'plan', s: { edits: { walls: [], openings: [], ...patch } } }]);
    const built = B.buildPlan({ walls: DUPLEX.walls, openings: DUPLEX.openings, ...patch }, { passThrough: true });
    check(`${name}: refused by the schema check, isPlanData, the collab op check and buildPlan`, !!reason && !P.isPlanData(p) && op === 'plan.base' && opEdits === 'plan.edits'
      && !built.ok && noOptional(built.plan) && built.warnings.some((w) => w.level === 'error' && /not readable/.test(w.text)), reason || 'accepted');
  }
  {
    const p = bad({ levels: [{ ...L1, id: 'L0' }] });
    const r1 = await projects.create({ fromPlan: p });
    const r2 = await projects.importFile({ app: P.PROJECT_FILE_APP, kind: 'project', version: 1, project: { name: 'Bad', basePlan: p, design: { items: [] } } }, { open: false });
    await adapter.put({ id: 'p_bad', name: 'Bad', phase: 'fixed', basePlan: p, design: { items: [] } });
    const r3 = await projects.open('p_bad');
    check('projects refuse it: create, import file, open', !r1.ok && !r2.ok && r3 === false && E.isBuiltinBase());
    await projects.create({ name: 'Duplex again', fromPlan: DUPLEX_PLAN, phase: 'fixed' });
    const before = JSON.stringify(E.currentPlanData());
    const r4 = E.applyPlanState({ walls: PLAN.walls, openings: PLAN.openings, rooms: PLAN.rooms, schema: 2, levels: [{ ...L1, walls: 'none' }] });
    check('applyPlanState refuses malformed levels with the usual reason, base restored', r4.ok === false && /not readable/.test(r4.reason) && JSON.stringify(E.currentPlanData()) === before);
    const r5 = B.buildPlan({ walls: DUPLEX.walls, openings: DUPLEX.openings, meta: { floors: 2 }, levels: DUPLEX.levels });
    check('without passThrough buildPlan behaves as today: levels ignored, two floors an error', !r5.ok && noOptional(r5.plan) && r5.plan.meta.floors === 1);
    check('an item with a non-string level is refused by the collab op check', OPS.validateOps([{ k: 'item:a', p: { id: 'a', type: 't', '@z': 0, level: 1 } }]) === 'item.level must be a level id'
      && OPS.validateOps([{ k: 'item:a', s: { level: 'L1' } }]) === '');
  }

  // ───────────────────────── (e) item level, UI defaults ─────────────────────────
  group('(e) item level and UI defaults');
  {
    const up = store.addItem({ type: 'chair', w: 50, d: 50, h: 80, x: 570, y: 280, level: 'L1' });
    const down = store.addItem({ type: 'chair', w: 50, d: 50, h: 80, x: 300, y: 300 });
    check('an item keeps its level; an item without one gets none', up.level === 'L1' && !('level' in down));
    check('normalizeItem drops an unusable level, never adds one', !('level' in normalizeItem({ level: 5 })) && !('level' in normalizeItem({ level: '' })) && !('level' in normalizeItem({})) && normalizeItem({ level: 'L2' }).level === 'L2');
    const f = clone(store.serialize());
    store.load(f, { restoreUI: true });
    check('serialize → load keeps the level', store.getItem(up.id).level === 'L1' && !('level' in store.getItem(down.id)));
    store.undo(); store.redo();
    check('DEFAULT_UI: level L0, ghostBelow on', DEFAULT_UI.level === 'L0' && DEFAULT_UI.ghostBelow === true && store.ui.level === 'L0');
    check('a design saved with the default level does not mention it', !('level' in f.ui) && !('ghostBelow' in f.ui));
    store.setUI({ level: 'L1', ghostBelow: false });
    const g = clone(store.serialize());
    store.setUI({ level: 'L0', ghostBelow: true });
    store.load(g, { restoreUI: true });
    check('a chosen level / ghost setting is saved and restored', g.ui.level === 'L1' && g.ui.ghostBelow === false && store.ui.level === 'L1' && store.ui.ghostBelow === false);
    store.load({ items: [{ type: 'bed', w: 160, d: 200, h: 50 }], ui: { mode: '2d' } }, { restoreUI: true });
    check('an old design file loads with the defaults', store.ui.level === 'L0' && store.ui.ghostBelow === true && !('level' in store.items[0]));
  }

  // ───────────────────────── (a) collaboration doc ─────────────────────────
  group('(a) collaboration: room doc, two real-store replicas, restore point');
  {
    const { createRoom } = await import('../src/collab/room.js');
    const mem = () => { const m = new Map(); return { async get(k) { return m.has(k) ? clone(m.get(k)) : undefined; }, async put(k, v) { m.set(k, clone(v)); }, async delete(k) { m.delete(k); } }; };
    const design = { ...editedRec.design, items: [{ id: 'it_up', type: 'chair', w: 50, d: 50, h: 80, x: 570, y: 280, level: 'L1' }, { id: 'it_dn', type: 'chair', w: 50, d: 50, h: 80, x: 300, y: 300 }] };
    const record = { id: 'g2', name: 'Duplex', phase: 'fixed', basePlan: editedRec.basePlan, design };
    const doc = OPS.recordToDoc(record);
    check('recordToDoc / docToRecord keep the plan and item levels untouched', JSON.stringify(doc.e.plan.base) === edited && same(doc.e.plan.edits, design.planEdits)
      && doc.e['item:it_up'].level === 'L1' && !('level' in doc.e['item:it_dn']) && JSON.stringify(OPS.docToRecord(doc).basePlan) === edited);
    check('the plan entity passes the room\'s op check', OPS.validateOps([{ k: 'plan', p: doc.e.plan }]) === '');
    const room = createRoom({ id: 'g2', storage: mem(), now: () => 1e12, record, limits: { rate: { ops: [1e6, 1e6] } } });
    await room.load();
    const WORKER = fileURLToPath(import.meta.url);
    const spawn = (name) => {
      const w = new Worker(WORKER); let n = 0; const waits = new Map();
      const rep = { name, w, up: [], connId: name + '#1' };
      w.on('message', (m) => { if (m.type === 'reply') { const f = waits.get(m.id); waits.delete(m.id); f(m); } else if (m.type === 'up') rep.up.push(m.text); });
      w.on('error', (e) => console.log('worker error', name, e));
      rep.call = (code, arg) => new Promise((res, rej) => { const id = ++n; waits.set(id, (m) => (m.error ? rej(new Error(m.error)) : res(m.value))); w.postMessage({ type: 'call', id, code, arg }); });
      room.join({ id: rep.connId, email: name.toLowerCase() + '@example.com', role: 'editor', send: (text) => w.postMessage({ type: 'down', text }) });
      return rep;
    };
    const reps = [spawn('A'), spawn('B')];
    const [A, Bq] = reps;
    const pump = async () => {
      for (let guard = 0; guard < 200; guard++) {
        let moved = false;
        for (const r of reps) while (r.up.length) { moved = true; await room.receive(r.connId, r.up.shift()); }
        await Promise.all(reps.map((r) => r.call('tick')));
        if (!moved && reps.every((r) => !r.up.length)) return;
      }
    };
    try {
      for (const r of reps) await r.call('start');
      await pump();
      const [sa, sb] = [JSON.parse(await A.call('state')), JSON.parse(await Bq.call('state'))];
      check('both replicas open the doc: base and edited plan byte-identical to the record', JSON.stringify(sa.base) === edited && JSON.stringify(sa.plan) === edited2 && JSON.stringify(sa) === JSON.stringify(sb));
      check('item levels arrive', same(sa.items, [{ id: 'it_up', level: 'L1' }, { id: 'it_dn' }]));
      await room.receive(A.connId, JSON.stringify({ t: 'version-create', name: 'Before' }));
      const w = await A.call('addWall', { x1: 880, y1: 20, x2: 880, y2: 200 });
      await A.call('setLevel', ['it_dn', 'L1']);
      await pump();
      const [ta, tb] = [await A.call('state'), await Bq.call('state')];
      const t = JSON.parse(tb);
      check('A edits the ground level: B receives identical plan data, levels untouched', w.ok && ta === tb && JSON.stringify(t.plan) !== edited2 && same(t.plan.levels, DUPLEX_PLAN.levels) && t.plan.schema === 2, w.reason);
      check('an item level set by A survives the ops', t.items.find((i) => i.id === 'it_dn').level === 'L1');
      check('the room doc holds the optional keys in its plan entity', same(room.doc().e.plan.edits.levels, DUPLEX_PLAN.levels) && JSON.stringify(room.doc().e.plan.base) === edited);
      const v = room.listVersions().find((x) => x.name === 'Before');
      await Bq.call('restore', v.id);
      await pump();
      const [ra, rb] = [JSON.parse(await A.call('state')), JSON.parse(await Bq.call('state'))];
      check('restoring the point brings the plan and items back on both replicas', JSON.stringify(ra) === JSON.stringify(rb) && JSON.stringify(ra.plan) === edited2 && JSON.stringify(ra.base) === edited && !('level' in ra.items.find((i) => i.id === 'it_dn')));
      await A.call('phase', 'draft'); await pump();
      await A.call('phase', 'fixed'); await pump();
      const [pa, pb] = [JSON.parse(await A.call('state')), JSON.parse(await Bq.call('state'))];
      check('draft → fixed online: the new base keeps the optional keys on both replicas', JSON.stringify(pa) === JSON.stringify(pb) && JSON.stringify(pa.base) === edited2 && pa.key === 'null');
    } finally { await Promise.all(reps.map((r) => r.w.terminate())); }
  }

  console.log(`\nschema: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

/** A real-store collaboration replica (worker thread): frames to / from the room go through the parent. */
async function replica() {
  const { store } = await import('../src/core/store.js');
  const PE = await import('../src/core/plan-edit.js');
  const { createStoreBridge } = await import('../src/collab/bridge.js');
  const { createClient } = await import('../src/collab/client.js');
  store.persist = false;
  const bridge = createStoreBridge(store, {});
  let sock = null;
  const client = createClient({
    adapter: bridge,
    connect: () => { sock = { readyState: 1, send(text) { parentPort.postMessage({ type: 'up', text }); }, close() {} }; queueMicrotask(() => sock.onopen && sock.onopen()); return sock; },
    schedule: (fn, ms) => setTimeout(fn, ms), unschedule: (t) => clearTimeout(t), txInterval: 0, presenceInterval: 0,
  });
  client.on('welcome', (w) => { if (w.first && w.doc) bridge.openDoc(w.doc); });
  bridge.attach(client);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const calls = {
    async start() { client.open(); for (let i = 0; i < 200 && client.status().state !== 'live'; i++) await tick(); return client.status().state; },
    async tick() { await tick(); await tick(); return true; },
    state() { return JSON.stringify({ base: PE.BASE_PLAN, plan: PE.currentPlanData(), key: PE.planStateKey(), items: store.items.map(({ id, level }) => (level === undefined ? { id } : { id, level })) }); },
    async addWall(a) { const r = PE.addWall(a); await tick(); return r; },
    async setLevel([id, level]) { store.updateItem(id, { level }); await tick(); return true; },
    async restore(id) { client.restoreVersion(id); await tick(); return true; },
    async phase(p) { store.setPlanPhase(p); await tick(); return true; },
  };
  parentPort.on('message', async (m) => {
    if (m.type === 'down') { if (sock && sock.onmessage) sock.onmessage({ data: m.text }); return; }
    if (m.type !== 'call') return;
    try { parentPort.postMessage({ type: 'reply', id: m.id, value: await calls[m.code](m.arg) }); } catch (e) { parentPort.postMessage({ type: 'reply', id: m.id, error: e.message }); }
  });
}
