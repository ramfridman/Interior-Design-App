// Carpentry studio engine (src/carpentry/) + its store integration.   node tests/carpentry.test.mjs
import { store } from '../src/core/store.js';
import { initialLayout } from '../src/core/initial-layout.js';
import { itemAABB } from '../src/core/geometry.js';
import * as C from '../src/carpentry/index.js';
import PRICEBOOK from '../src/carpentry/pricebook.js';

store.persist = false;
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, e = 0.05) => Math.abs(a - b) <= e;
const sum = (l, f = (x) => x) => l.reduce((s, x) => s + f(x), 0);
const HEB = /[֐-׿]/;
const state = () => JSON.stringify({ carpentry: store.carpentry, items: store.items });
const events = [];
store.on('carpentry', (e) => events.push(e));

/** TEST-ONLY placeholder price book (made-up numbers; the real one is src/carpentry/pricebook.js from research). */
const TEST_PRICEBOOK = {
  currency: 'ILS', vat: 0.18, asOf: '2026-11', tiers: ['basic', 'mid', 'premium'], tierFactor: { basic: 0.8, mid: 1, premium: 1.5 },
  rates: {
    'carcass.mfc': { unit: 'm2', low: 90, typical: 120, high: 160, label: { en: 'MFC', he: 'טגו' }, source: { name: 'test', url: '' } },
    'back.hdf': { unit: 'm2', low: 20, typical: 30, high: 40, label: { en: 'HDF', he: 'HDF' }, source: { name: 'test', url: '' } },
    'fronts.lacquer-matt': { unit: 'm2', low: 600, typical: 800, high: 1100, tierFactor: { basic: 0.7, mid: 1, premium: 1.4 }, label: { en: 'Lacquer', he: 'פוליאור' }, source: { name: 'test', url: '' } },
    'fronts.melamine': { unit: 'm2', low: 200, typical: 260, high: 330, label: { en: 'Melamine', he: 'מלמין' }, source: { name: 'test', url: '' } },
    'worktop.quartz': { unit: 'm', low: 1500, typical: 2200, high: 3200, label: { en: 'Quartz', he: 'קוורץ' }, source: { name: 'test', url: '' } },
    'worktop.cutout.sink': { unit: 'unit', low: 250, typical: 350, high: 500, label: { en: 'Sink cut-out', he: 'חיתוך כיור' }, source: { name: 'test', url: '' } },
    'worktop.cutout.hob': { unit: 'unit', low: 150, typical: 250, high: 350, label: { en: 'Hob cut-out', he: 'חיתוך כיריים' }, source: { name: 'test', url: '' } },
    'hardware.hinge': { unit: 'unit', low: 12, typical: 25, high: 60, label: { en: 'Hinge', he: 'ציר' }, source: { name: 'test', url: '' } },
    'hardware.drawer': { unit: 'unit', low: 120, typical: 250, high: 550, label: { en: 'Drawer', he: 'מגירה' }, source: { name: 'test', url: '' } },
    'hardware.handle': { unit: 'unit', low: 15, typical: 40, high: 120, label: { en: 'Handle', he: 'ידית' }, source: { name: 'test', url: '' } },
    'install.kitchen': { unit: 'percent', low: 8, typical: 10, high: 12, label: { en: 'Installation', he: 'התקנה' }, source: { name: 'test', url: '' } },
    'install': { unit: 'm', low: 150, typical: 250, high: 350, label: { en: 'Installation', he: 'התקנה' }, source: { name: 'test', url: '' } },
  },
  notes: ['TEST DATA ONLY'],
};

// ───────────────────────── adoption ─────────────────────────
group('Adopt the architect\'s layout');
store.addItems(initialLayout(), { select: false });
const before = store.items.map((i) => ({ ...i }));
const arch = (name) => before.find((i) => i.name === name);
const res = C.adoptArchitectLayout();
check('adoption succeeds as one undoable change', res.ok && res.changed && store.historyState().canUndo, res.reason && res.reason.en);
const runs = C.listRuns(), R = (code) => runs.find((r) => r.code === code);
const unitsOf = (run) => C.getRun(run.id).units;
const byPlanX = (it) => itemAABB(it);
const north = runs.find((r) => r.kind === 'kitchen' && r.anchor.dir === 0), west = runs.find((r) => r.kind === 'kitchen' && r.anchor.dir === 270);
check('kitchen L-run: north wall run 550 cm from the corner (360, 20) to the wall at x 910', north && north.length === 550 && north.anchor.x === 360 && north.anchor.y === 20);
check('kitchen L-run: west wall run, its corner end linked to the north run', west && west.ends.right.type === 'run' && west.ends.right.runId === north.id && west.ends.left.type === 'open');
const nU = unitsOf(north), wU = unitsOf(west);
const hob = nU.find((u) => u.carp.module === 'base-hob'), sink = wU.find((u) => u.carp.module === 'base-sink');
const hobA = byPlanX(hob), sinkA = byPlanX(sink);
check('hob unit exactly where the architect drew the cooktop cabinet (x 500–560)', hob && near(hobA.x, 500) && near(hobA.x + hobA.w, 560) && hob.x === arch('Cooktop cabinet').x && hob.y === arch('Cooktop cabinet').y);
check('sink unit exactly where the architect drew it, under the west window (y 180–240)', sink && near(sinkA.y, 180) && near(sinkA.y + sinkA.h, 240));
check('corner unit at the L corner', nU[0].carp.module === 'base-corner-blind' && nU[0].carp.width === 60);
check('tall bank: oven + microwave tower and two pantries over 655–815', eq(nU.filter((u) => C.levelOf(u) === 'tall' && u.carp.module !== 'tall-fridge-niche').map((u) => [u.carp.module, u.carp.width]), [['tall-oven', 60], ['tall-pantry', 50], ['tall-pantry', 50]]));
const niche = nU.find((u) => u.carp.module === 'tall-fridge-niche');
check('fridge niche 95 cm (815 → wall at 910) for the 91 cm fridge, fridge item kept', niche && niche.carp.width === 95 && store.items.some((i) => i.type === 'fridge'));
const island = runs.find((r) => r.kind === 'island'), isl = island && unitsOf(island)[0];
check('island 280 × 120 at the architect\'s position', island && island.length === 280 && isl.w === 280 && isl.d === 120 && isl.x === 676 && isl.y === 253);
const robes = runs.filter((r) => r.kind === 'wardrobe');
const master = robes.find((r) => r.roomId === 'parents-bedroom');
check('master wardrobe 320: 3 carcasses + wall fillers sum to 320', master && master.length === 320 && sum(unitsOf(master), (u) => u.carp.width) === 320 && unitsOf(master).filter((u) => u.carp.module === 'wardrobe-hinged').length === 3);
const masterBox = unitsOf(master).map(byPlanX).reduce((a, b) => ({ x0: Math.min(a.x0, b.x), x1: Math.max(a.x1, b.x + b.w), y0: Math.min(a.y0, b.y), y1: Math.max(a.y1, b.y + b.h) }), { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 });
check('master wardrobe footprint preserved (20,720)–(340,775)', near(masterBox.x0, 20) && near(masterBox.x1, 340) && near(masterBox.y0, 720) && near(masterBox.y1, 775));
check('three 160 cm wardrobes (mamad, bedroom 1, bedroom 2)', robes.filter((r) => r.length === 160).map((r) => r.roomId).sort().join() === 'bedroom-1,bedroom-2,mamad');
const entries = runs.filter((r) => r.kind === 'entry');
check('hall closet 185 and entry closet 90 (shoe cupboard)', entries.map((r) => r.length).sort().join() === '185,90' && unitsOf(entries.find((r) => r.length === 90)).some((u) => u.carp.module === 'entry-closet'));
const vanities = runs.filter((r) => r.kind === 'vanity');
check('two vanities (100 and 130 cm units)', vanities.length === 2 && eq(vanities.flatMap((r) => unitsOf(r).filter((u) => u.carp.module === 'vanity').map((u) => u.carp.width)).sort(), [100, 130]));
check('laundry: utility cupboard run + base run with washer / dryer spaces', runs.filter((r) => r.kind === 'utility').length === 2 && runs.some((r) => r.kind === 'utility' && unitsOf(r).filter((u) => u.carp.module === 'base-space').length === 2));
check('no generic carpentry left; units are fixtures with no price', !store.items.some((i) => i.generic && ['kitchen-base', 'kitchen-tall', 'kitchen-island', 'wardrobe', 'vanity'].includes(i.type)) && store.items.filter((i) => i.carp).every((i) => i.fixture && !i.generic && i.price === null));
check('every unit is a store item rendered by an existing model type', store.items.filter((i) => i.carp).every((i) => ['kitchen-base', 'kitchen-wall', 'kitchen-tall', 'kitchen-island', 'wardrobe', 'vanity', 'cabinet', 'bookcase', 'shelf-wall', 'desk', 'bench'].includes(i.type)));
const snapAdopt = state();
const again = C.adoptArchitectLayout();
check('adoption is idempotent', again.ok && !again.changed && state() === snapAdopt);
check('module names and run names are bilingual', Object.values(C.MODULES).every((m) => m.name.en && HEB.test(m.name.he)) && runs.every((r) => r.name && HEB.test(r.nameHe)));

// ───────────────────────── layout stability ─────────────────────────
group('Layout is stable');
const ev0 = events.length;
const relaid = runs.map((r) => C.layoutRun(r.id));
check('re-layout of every run changes nothing', relaid.every((x) => x.ok && !x.changed) && state() === snapAdopt && events.length === ev0);

// ───────────────────────── openings ─────────────────────────
group('Doors and windows');
const cross = C.createRun({ kind: 'kitchen', x: 361, y: 600, from: 50, to: 250 });
check('a base run cannot cross a doorway (terrace door)', !cross.ok && /door-terrace/.test(cross.reason.en) && HEB.test(cross.reason.he) && state() === snapAdopt);
const free = C.createRun({ kind: 'kitchen', x: 361, y: 720 });
const freeRun = free.ok && C.getRun(free.runId).run;
check('clicking the wall gives the free stretch beside the door, not across it', free.ok && freeRun.length === 100 && near(freeRun.anchor.y, 770));
store.undo();
check('undo removes the created run', state() === snapAdopt);
const tall = C.addUnit(west.id, 'tall-pantry', { index: 2, width: 60 });
check('a tall unit over the window is refused', !tall.ok && /win-kitchen-w/.test(tall.reason.en) && state() === snapAdopt);
const wallU = C.addUnit(west.id, 'wall-door', { width: 60, offset: 120 });
const winFinding = C.checkRun(west.id).find((f) => f.code === 'window-wall' && f.unitIds.includes(wallU.unitId));
check('a wall unit over the window is flagged as an error', wallU.ok && winFinding && winFinding.severity === 'error' && HEB.test(winFinding.text.he));
store.undo();
check('hob under the window is flagged (best practice)', C.checkRun(north.id).some((f) => f.code === 'hob-window' && f.unitIds.includes(hob.id)));

// ───────────────────────── wardrobe in a niche ─────────────────────────
group('New wardrobe in a 160 cm niche');
const wr = C.createRun({ kind: 'wardrobe', x: 1250, y: 1061, from: 0, to: 160, ends: { left: 'wall', right: 'wall' } });
check('run created on the bedroom-1 north wall', wr.ok && C.getRun(wr.runId).run.length === 160 && C.getRun(wr.runId).run.roomId === 'bedroom-1', wr.reason && wr.reason.en);
C.addUnit(wr.runId, 'wardrobe-hinged'); C.addUnit(wr.runId, 'wardrobe-hinged');
const fit = C.fitRun(wr.runId, { mode: 'fillers' });
const wrU = C.getRun(wr.runId).units, fillers = wrU.filter((u) => u.carp.module === 'filler'), robesU = wrU.filter((u) => u.carp.module === 'wardrobe-hinged');
check('fit: widths sum exactly to the niche', fit.ok && near(sum(wrU, (u) => u.carp.width), 160, 0.001), fit.reason && fit.reason.en);
check('fit: a legal filler at both walls (5 cm), units within min / max', fillers.length === 2 && fillers.every((f) => f.carp.width === 5) && robesU.every((u) => u.carp.width === 75));
check('fit: fillers are at the two ends', wrU[0].carp.module === 'filler' && wrU[wrU.length - 1].carp.module === 'filler');
check('the bedroom door swing into the new wardrobe is flagged', C.checkRun(wr.runId).some((f) => f.code === 'door-swing'));
const tooBig = C.setUnitWidth(robesU[0].id, 140);
check('a width outside the module limits is refused', !tooBig.ok && HEB.test(tooBig.reason.he));
const fitBad = C.fitRun(wr.runId, { length: 400 });
check('fit refuses what the module limits cannot reach', !fitBad.ok);
const stretched = C.fitRun(wr.runId, { mode: 'stretch', length: 180 });
check('stretch mode keeps fillers and widens the carcasses', stretched.ok && near(sum(C.getRun(wr.runId).units, (u) => u.carp.width), 180, 0.001) && C.getRun(wr.runId).units.filter((u) => u.carp.module === 'wardrobe-hinged').every((u) => u.carp.width === 85));
store.undo(); store.undo(); store.undo(); store.undo(); store.undo();
check('undo back to the adopted state', state() === snapAdopt);

// ───────────────────────── take-off ─────────────────────────
group('Take-off against hand-computed panel lists');
const P = (part, group, material, thickness, length, width, qty, long, short, edgeType) => ({ part, group, material, thickness, length, width, qty, long, short, edgeType });
const strip = (p) => P(p.part.en, p.group, p.material, p.thickness, p.length, p.width, p.qty, p.edges.long, p.edges.short, p.edgeType);
const dr = C.createRun({ kind: 'kitchen', anchor: { x: 2000, y: 2000, dir: 0 }, length: 60, units: [{ module: 'base-drawers', width: 60 }] });
const drT = C.takeoff(dr.runId).runs[0].units[0];
// carcass 60 × 78 (90 − 10 plinth − 2 worktop) × 56, t 18: sides 780 × 560, bottom / rails 600 − 36 = 564, back (W−4) × (H−4)
check('60 cm 3-drawer base: carcass panels', eq(drT.panels.map(strip), [
  P('Side', 'carcass', 'mfc', 18, 780, 560, 2, 1, 0, 'abs-1'), P('Bottom', 'carcass', 'mfc', 18, 564, 560, 1, 1, 0, 'abs-1'),
  P('Front rail', 'carcass', 'mfc', 18, 564, 100, 1, 1, 0, 'abs-1'), P('Back rail', 'carcass', 'mfc', 18, 564, 100, 1, 0, 0, null),
  P('Back panel', 'back', 'hdf', 3, 596, 776, 1, 0, 0, null)]), JSON.stringify(drT.panels.map(strip)));
// fronts: zone 777 mm (780 − 3 top gap), 3 drawers with 2 × 3 mm gaps → 257 each; width 600 − 3 = 597
check('60 cm 3-drawer base: three 597 × 257 drawer fronts banded all round', eq(drT.fronts.map(strip), Array(3).fill(P('Drawer front', 'front', 'lacquer-matt', 18, 257, 597, 1, 2, 2, 'abs-2'))));
check('60 cm 3-drawer base: 3 drawer systems 550 mm, 3 bar handles, 4 legs', eq(drT.hardware.map((h) => [h.kind, h.qty, h.length || null]).sort(), [['drawer', 3, 550], ['handle', 3, 160], ['leg', 4, null]].sort()));
check('areas: sides 2 × 0.78 × 0.56 = 0.8736 m²', drT.panels[0].areaM2 === 0.874 || near(drT.panels[0].areaM2, 0.8736, 0.001));
const wb = C.createRun({ kind: 'wardrobe', anchor: { x: 3000, y: 3000, dir: 0 }, length: 100, units: [{ module: 'wardrobe-hinged', width: 100 }] });
const wbT = C.takeoff(wb.runId).runs[0].units[0];
// body 240 incl. 10 plinth → carcass 2300; depth 580; top box to the 300 ceiling: 300 − 240 − 2 scribe = 580
check('100 cm 2-door wardrobe bay: carcass, top box and hat shelf', eq(wbT.panels.map(strip), [
  P('Side', 'carcass', 'mfc', 18, 2300, 580, 2, 1, 0, 'abs-1'), P('Top', 'carcass', 'mfc', 18, 964, 580, 1, 1, 0, 'abs-1'), P('Bottom', 'carcass', 'mfc', 18, 964, 580, 1, 1, 0, 'abs-1'),
  P('Back panel', 'back', 'hdf', 3, 996, 2296, 1, 0, 0, null),
  P('Top box side', 'carcass', 'mfc', 18, 580, 580, 2, 1, 0, 'abs-1'), P('Top box top', 'carcass', 'mfc', 18, 964, 580, 1, 1, 0, 'abs-1'), P('Top box bottom', 'carcass', 'mfc', 18, 964, 580, 1, 1, 0, 'abs-1'),
  P('Top box back', 'back', 'hdf', 3, 996, 576, 1, 0, 0, null),
  P('Shelf', 'carcass', 'mfc', 18, 962, 560, 1, 1, 0, 'abs-1')]), JSON.stringify(wbT.panels.map(strip)));
check('100 cm 2-door wardrobe bay: two 2297 × 497 doors + two 577 × 497 top-box doors', eq(wbT.fronts.map(strip), [
  P('Door', 'front', 'melamine', 18, 2297, 497, 1, 2, 2, 'abs-2'), P('Door', 'front', 'melamine', 18, 2297, 497, 1, 2, 2, 'abs-2'),
  P('Door', 'front', 'melamine', 18, 577, 497, 1, 2, 2, 'abs-2'), P('Door', 'front', 'melamine', 18, 577, 497, 1, 2, 2, 'abs-2')]));
check('100 cm 2-door wardrobe bay: 14 hinges (5 + 5 + 2 + 2), 4 handles, rail 962 mm, 4 legs', eq(Object.fromEntries(wbT.hardware.map((h) => [h.kind, [h.qty, h.length || null]])),
  { leg: [4, null], 'wall-fixing': [2, null], hinge: [14, null], handle: [4, 320], 'shelf-support': [4, null], rail: [1, 962], 'rail-support': [2, null] }), JSON.stringify(wbT.hardware));
const tAll = C.takeoff('all');
check('take-off is deterministic', JSON.stringify(C.takeoff('all')) === JSON.stringify(tAll));
check('totals per material sum the panels', near(sum(tAll.totals.materials, (m) => m.areaM2), sum(tAll.runs.flatMap((r) => [...r.units.flatMap((u) => [...u.panels, ...u.fronts]), ...r.extraFronts]), (p) => p.areaM2), 0.01));
store.undo(); store.undo();
check('test runs removed by undo', state() === snapAdopt);

// ───────────────────────── worktop ─────────────────────────
group('Worktop of the L-run');
const wtN = C.takeoff(north.id).runs[0].worktops, wtW = C.takeoff(west.id).runs[0].worktops;
check('north piece 295 cm (corner → tall units), west piece 254 cm, both ≤ 300 cm slab', wtN.length === 1 && wtN[0].length === 295 && wtW.length === 1 && wtW[0].length === 254 && [...wtN, ...wtW].every((p) => p.length <= 300));
check('L joint: the west piece butts into the north piece at the corner', wtW[0].ends.right === 'butt' && wtN[0].ends.left === 'wall');
check('cut-outs: hob 56 × 49 in the north piece over the hob unit, sink 50 × 40 in the west piece', eq(wtN[0].cutouts.map((c) => [c.kind, c.x, c.w, c.d]), [['hob', 142, 56, 49]]) && eq(wtW[0].cutouts.map((c) => [c.kind, c.x, c.w, c.d]), [['sink', 99, 50, 40]]));
check('polished edge: front minus the 60 cm butted corner (2.35 m north), front + open end (west)', near(wtN[0].polishedM, 2.35, 0.001) && near(wtW[0].polishedM, 3.14, 0.001));
// hob cut-out 142–198: joints must stay ≥ 10 cm away (≤ 132 or ≥ 208); unit boundaries 60 / 140 / 200
C.updateRun(north.id, { spec: { worktop: { maxSlab: 250 } } });
const split = C.takeoff(north.id).runs[0].worktops;
check('a 250 cm slab: joint at the unit boundary 60 (140 / 200 are too close to the hob)', eq(split.map((p) => [p.s, p.e, p.ends.left, p.ends.right]), [[0, 60, 'wall', 'joint'], [60, 295, 'joint', 'tall']]) && eq(split[1].cutouts.map((c) => [c.kind, c.x]), [['hob', 82]]), JSON.stringify(split.map((p) => [p.s, p.e])));
store.undo();
C.updateRun(north.id, { spec: { worktop: { maxSlab: 200 } } });
const split2 = C.takeoff(north.id).runs[0].worktops;
check('a 200 cm slab: no boundary works, the joint moves to 132 (10 cm clear of the hob), pieces ≤ 200', eq(split2.map((p) => [p.s, p.e]), [[0, 132], [132, 295]]) && split2.every((p) => p.length <= 200 && !p.jointWarning));
check('the joint is reported as an info finding', C.checkRun(north.id).some((f) => f.code === 'worktop-joints' && /132/.test(f.text.en)));
store.undo();

// ───────────────────────── estimate ─────────────────────────
group('Estimate');
const est = { basic: C.estimate('all', { tier: 'basic', pricebook: TEST_PRICEBOOK, method: 'materials' }), mid: C.estimate('all', { tier: 'mid', pricebook: TEST_PRICEBOOK, method: 'materials' }), premium: C.estimate('all', { tier: 'premium', pricebook: TEST_PRICEBOOK, method: 'materials' }) };
check('estimate is labelled an estimate', est.mid.isEstimate && HEB.test(est.mid.label.he));
check('monotonic in tier (low, typical, high)', ['low', 'typical', 'high'].every((k) => est.basic.total[k] < est.mid.total[k] && est.mid.total[k] < est.premium.total[k]));
check('low ≤ typical ≤ high', Object.values(est).every((e) => e.total.low <= e.total.typical && e.total.typical <= e.total.high));
check('total = sum of runs = sum of components = sum of lines', Object.values(est).every((e) => ['low', 'typical', 'high'].every((k) => e.total[k] === sum(e.runs, (r) => r.total[k]) && e.runs.every((r) => r.total[k] === sum(r.components, (c) => c[k]) && r.components.every((c) => c[k] === sum(c.lines, (l) => l[k]))))));
check('incl. 18 % VAT', est.mid.totalIncVat.typical === Math.round(est.mid.total.typical * 1.18));
check('every component carries its rate keys; unknown rates are listed', est.mid.runs.every((r) => r.components.every((c) => c.rateKeys.length && c.lines.every((l) => TEST_PRICEBOOK.rates[l.rateKey]))) && !est.mid.missingRates.some((m) => m.key === 'carcass.mfc') && est.mid.missingRates.some((m) => m.key === 'hardware.leg'));
const kEst = est.mid.runs.find((r) => r.runId === north.id);
check('kitchen installation = 10 % of the material subtotal', kEst.components.find((c) => c.key === 'installation').typical === Math.round(sum(kEst.components.filter((c) => ['carcass', 'fronts', 'worktop', 'hardware', 'internal'].includes(c.key)), (c) => sum(c.lines, (l) => l.typical)) * 0.1) || near(kEst.components.find((c) => c.key === 'installation').typical, sum(kEst.components.filter((c) => c.key !== 'installation'), (c) => c.typical) * 0.1, 3));

// ───────────────────────── market estimate (real price book) ─────────────────────────
group('Market estimate with the researched price book');
check('market is the default method for the real price book', C.estimate('all', { pricebook: PRICEBOOK }).method === 'market');
const mk = Object.fromEntries(['basic', 'mid', 'premium'].map((t) => [t, C.estimate('all', { tier: t, pricebook: PRICEBOOK })]));
const target = runs.filter((r) => ['kitchen', 'island', 'wardrobe'].includes(r.kind));
const mrun = (t, id) => mk[t].runs.find((r) => r.runId === id);
check('kitchen K1 + K2 + island + worktops and every wardrobe: non-zero ranges in all three tiers', target.every((r) => ['basic', 'mid', 'premium'].every((t) => mrun(t, r.id).total.low > 0)) && ['basic', 'mid', 'premium'].every((t) => [north, west, island].every((r) => mrun(t, r.id).components.some((c) => c.key === 'worktop' && c.typical > 0))));
check('low ≤ typical ≤ high everywhere', Object.values(mk).every((e) => e.runs.every((r) => r.total.low <= r.total.typical && r.total.typical <= r.total.high)));
check('basic ≤ mid ≤ premium (per run and in total)', ['low', 'typical', 'high'].every((k) => mk.basic.total[k] <= mk.mid.total[k] && mk.mid.total[k] <= mk.premium.total[k] && runs.every((r) => mrun('basic', r.id).total[k] <= mrun('mid', r.id).total[k] && mrun('mid', r.id).total[k] <= mrun('premium', r.id).total[k])) && mk.basic.total.typical < mk.premium.total.typical);
check('totals = Σ runs = Σ components = Σ lines', Object.values(mk).every((e) => ['low', 'typical', 'high'].every((k) => e.total[k] === sum(e.runs, (r) => r.total[k]) && e.runs.every((r) => r.total[k] === sum(r.components, (c) => c[k]) && r.components.every((c) => c[k] === sum(c.lines, (l) => l[k]))))));
check('every line has at least one source or is flagged noRate', Object.values(mk).every((e) => e.runs.every((r) => r.components.every((c) => c.lines.every((l) => l.noRate || (l.sources && l.sources.length))))));
check('missing rates are listed with a bilingual label; noRate lines are zero', mk.mid.missingRates.every((m) => m.key && HEB.test(m.label.he)) && mk.mid.runs.every((r) => r.components.every((c) => c.lines.filter((l) => l.noRate).every((l) => l.typical === 0 && mk.mid.missingRates.some((m) => m.key === l.rateKey)))));
check('estimate keeps its label, disclaimer, basis per component and the book\'s notes', mk.mid.isEstimate && HEB.test(mk.mid.disclaimer.he) && mk.mid.notes.length > 0 && mk.mid.runs.every((r) => r.components.every((c) => c.basis && c.basis.en)));
check('kitchen installation counted once', sum(mk.mid.runs, (r) => r.components.filter((c) => c.key === 'installation').length) === 1);
check('suggested tiers: lacquer kitchen → mid, melamine wardrobes → basic', C.suggestTier(north) === 'mid' && C.suggestTier(master) === 'basic' && C.suggestTier({ spec: { ...north.spec, fronts: { ...north.spec.fronts, style: 'gola' } } }) === 'premium');
check('without a tier each run uses its suggested tier', C.estimate('all', { pricebook: PRICEBOOK }).runs.every((r) => r.tier === r.suggestedTier));
const fmtN = (n) => String(n.toLocaleString('en-US')).padStart(9);
console.log('\n      Market estimate, tier mid, ILS excl. VAT (architect\'s design as adopted)');
console.log('      run  ' + 'name'.padEnd(36) + '      low  typical     high');
for (const r of mk.mid.runs) console.log(`      ${r.code.padEnd(5)}${(r.name || '').slice(0, 36).padEnd(36)}${fmtN(r.total.low)}${fmtN(r.total.typical)}${fmtN(r.total.high)}${r.noRateLines ? '  (' + r.noRateLines + ' without rate)' : ''}`);
console.log(`      ${'TOTAL'.padEnd(41)}${fmtN(mk.mid.total.low)}${fmtN(mk.mid.total.typical)}${fmtN(mk.mid.total.high)}   incl. VAT ${mk.mid.totalIncVat.typical.toLocaleString('en-US')} typical`);
console.log('      basic / mid / premium typical: ' + ['basic', 'mid', 'premium'].map((t) => mk[t].total.typical.toLocaleString('en-US')).join(' / '));
console.log('      missing rates: ' + (mk.mid.missingRates.map((m) => m.key).join(', ') || 'none'));

// ───────────────────────── drawings ─────────────────────────
group('Drawings');
let allOnce = true, chainsOk = true, noOverlap = true, kindsOk = true, badMsg = '';
for (const run of runs) {
  const ds = C.drawings(run.id), elev = ds.find((d) => d.kind === 'elevation');
  if (!ds.find((d) => d.kind === 'plan') || !elev || !ds.find((d) => d.kind === 'section')) { kindsOk = false; badMsg = run.code; }
  for (const u of unitsOf(run).filter((x) => x.carp.module !== 'wall-void')) {
    const n = elev.ops.filter((o) => o.t === 'text' && o.role === 'code' && o.unitId === u.id).length;
    if (n !== 1) { allOnce = false; badMsg = `${run.code} ${u.carp.module} ×${n}`; }
  }
  const units = elev.dims.find((c) => c.id === 'units'), overall = elev.dims.find((c) => c.id === 'overall');
  if (!units || !near(sum(units.values), run.length, 0.051) || !near(units.total, run.length) || !near(overall.total, run.length)) { chainsOk = false; badMsg = `${run.code} chain ${units && sum(units.values)}`; }
  for (const d of ds) {
    const boxes = d.ops.filter((o) => o.t === 'text' && o.role === 'dim-text').map((o) => ({ o, b: C.textBox(o, d.scale) }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].b, b = boxes[j].b;
      if (a.x0 < b.x1 - 0.01 && b.x0 < a.x1 - 0.01 && a.y0 < b.y1 - 0.01 && b.y0 < a.y1 - 0.01) { noOverlap = false; badMsg = `${run.code} ${d.kind}: "${boxes[i].o.text}" / "${boxes[j].o.text}"`; }
    }
  }
}
check('every run has a plan, a front elevation and a side section', kindsOk, badMsg);
check('every unit appears exactly once (by code) in its elevation', allOnce, badMsg);
check('unit dimension chain sums to the run length; overall chain = run length', chainsOk, badMsg);
check('no dimension text overlaps another', noOverlap, badMsg);
const kd = C.drawings(north.id);
check('kitchen: worktop drawing with the hob cut-out and an internal elevation for the tall units', kd.some((d) => d.kind === 'worktop' && d.ops.some((o) => o.role === 'cutout')) && kd.some((d) => d.kind === 'internal'));
const ke = kd.find((d) => d.kind === 'elevation');
check('elevation heights chain: plinth 10 / carcass 78 / worktop 2 / … / ceiling 300', eq(ke.dims.find((c) => c.id === 'heights').values.slice(0, 3), [10, 78, 2]) && ke.dims.find((c) => c.id === 'ceiling').total === 300);
check('elevation shows the window behind and the unit codes B1… T4', ke.ops.some((o) => o.role === 'opening') && ['B1', 'B4', 'T1', 'T4'].every((c) => ke.ops.some((o) => o.role === 'code' && o.text === c)));
check('ops are well-formed (numbers, line weights, bilingual titles)', kd.every((d) => HEB.test(d.title.he) && d.scale > 0 && d.bounds.w > 0 && d.ops.every((o) => (o.t !== 'line' || [o.x1, o.y1, o.x2, o.y2].every(Number.isFinite)) && (o.t === 'text' || o.lw > 0))));

// ───────────────────────── checks & schedules ─────────────────────────
group('Checks and schedules');
const all = C.checkRun('all');
check('findings are bilingual and reference real units', all.length > 0 && all.every((f) => f.text.en && HEB.test(f.text.he) && f.unitIds.every((id) => store.getItem(id))));
check('dead 60 cm corner box is flagged', all.some((f) => f.code === 'corner-dead'));
check('shallow 48 cm hanging closets are flagged', all.some((f) => f.code === 'hanging-depth'));
check('no false errors on the adopted kitchen', !C.checkRun(north.id).some((f) => f.severity === 'error') && !C.checkRun(west.id).some((f) => f.severity === 'error'), JSON.stringify(C.checkRun(north.id).filter((f) => f.severity === 'error').map((f) => f.text.en)));
const sch = C.schedules('all');
check('unit schedule codes match the elevation codes', sch.units.filter((r) => r.runId === north.id).map((r) => r.code).join() === unitsOf(north).map((u) => C.unitCodes(north, unitsOf(north)).get(u.id)).join());
check('schedules: materials, hardware, worktops, appliances, open questions — bilingual', ['units', 'materials', 'hardware', 'worktops', 'appliances', 'questions'].every((k) => sch[k].length > 0) && sch.questions.every((q) => HEB.test(q.text.he)) && Object.values(sch.headers).flat().every(([, l]) => HEB.test(l.he)));

// ───────────────────────── bespoke: the owner's corner pantry ─────────────────────────
group('Bespoke: corner pantry with removable doors (owner\'s example)');
const pantryId = unitsOf(north)[0].id;
const tooWide = C.updateUnit(pantryId, { module: 'tall-corner-pantry', width: 90, legB: 95, internals: { cornerPantry: 'l-doors', shelves: 5 }, fronts: { operation: 'removable' } });
check('a 90 cm leg on the north arm is refused: it would cover the north window (starts 80 cm from the corner)', !tooWide.ok && /win-kitchen-n/.test(tooWide.reason.en));
const up = C.updateUnit(pantryId, { module: 'tall-corner-pantry', width: 80, legB: 95, internals: { cornerPantry: 'l-doors', shelves: 5 }, fronts: { operation: 'removable' } });
check('the dead corner becomes a tall L corner pantry 80 × 95 with removable doors', up.ok, up.reason && up.reason.en);
check('the west arm reserves the pantry\'s leg (95 − 60 = 35 cm), clear of the west window', C.getRun(west.id).run.reserved && C.getRun(west.id).run.reserved.right === 35);
const fN = C.fitRun(north.id), fW = C.fitRun(west.id);
const nU2 = unitsOf(north), wU2 = unitsOf(west), wRun = C.getRun(west.id).run, pantry = store.getItem(pantryId);
check('both arms fit', fN.ok && fW.ok, (fN.reason || fW.reason || {}).en);
check('arm lengths consistent: north units = 550; west units + 35 reserved = 254', near(sum(nU2.filter((u) => C.levelOf(u) !== 'wall'), (u) => u.carp.width), 550, 0.01) && near(sum(wU2, (u) => u.carp.width) + wRun.reserved.right, 254, 0.01));
const ov2 = (a, b) => { const A = itemAABB(a), B = itemAABB(b); return A.x < B.x + B.w - 0.5 && B.x < A.x + A.w - 0.5 && A.y < B.y + B.h - 0.5 && B.y < A.y + A.h - 0.5; };
check('no overlap between the pantry and either arm', ![...wU2, ...nU2.filter((u) => u.id !== pantryId)].some((u) => ov2(u, pantry)) && !C.checkRun(west.id).some((f) => f.code === 'corner-overlap'));
const wtN2 = C.takeoff(north.id).runs[0].worktops, wtW2 = C.takeoff(west.id).runs[0].worktops;
check('worktops terminate at the pantry on both arms', wtN2[0].s === 80 && wtN2[0].ends.left === 'tall' && wtW2[wtW2.length - 1].e === 219 && wtW2[wtW2.length - 1].ends.right === 'tall', JSON.stringify([wtN2[0].s, wtN2[0].ends, wtW2.map((p) => [p.s, p.e, p.ends])]));
const pd = C.drawings(north.id), pe = pd.find((d) => d.kind === 'elevation'), pp = pd.find((d) => d.kind === 'plan');
check('elevation: removable-door symbol and legend entry', pe.ops.some((o) => o.role === 'op-symbol' && o.op === 'removable') && pe.legend.some((l) => l.op === 'removable' && HEB.test(l.label.he)) && pe.ops.some((o) => o.role === 'legend' && o.op === 'removable'));
check('plan: the pantry\'s true L footprint and its two faces', pp.ops.some((o) => o.t === 'poly' && o.corner && o.pts.length === 6) && pp.ops.filter((o) => o.role === 'front' && o.face).length === 2);
check('west elevation shows the reserved corner with the pantry reference', C.drawings(west.id).find((d) => d.kind === 'elevation').ops.some((o) => o.role === 'reserved'));
const ptk = C.takeoff(north.id).runs[0].units.find((u) => u.unitId === pantryId);
check('take-off: lift-off fittings (specified by the carpenter), no ordinary hinges', ptk.hardware.some((h) => h.kind === 'lift-off-hinge' && h.specifiedByCarpenter && h.qty > 0) && !ptk.hardware.some((h) => h.kind === 'hinge'));
const shelf = ptk.panels.find((p) => p.part.en.startsWith('Corner shelf'));
check('take-off: 5 L-shaped shelves with an outline, shaped top / bottom, two backs', shelf && shelf.qty === 5 && shelf.shape === 'L' && shelf.outline.length === 6 && ptk.panels.filter((p) => p.shape).length === 3 && ptk.panels.filter((p) => p.group === 'back').length === 2);
check('take-off: the four true-size doors (2 faces × split at the base-front line)', ptk.fronts.filter((f) => f.part.en === 'Door').length === 4);
const prow = C.schedules(north.id).units.find((r) => r.unitId === pantryId);
check('unit schedule states the operation and the corner', prow && /Removable/.test(prow.operation.en) && HEB.test(prow.operation.he) && /legs 80 × 95/.test(prow.corner.en));
check('no hinged-door clash warning (removable doors)', !C.checkRun(north.id).some((f) => f.code === 'corner-pantry-doors'));
const OWNER_TEXT = 'דלתות שאפשר להרים ולהוריד בלי כלים, לניקוי המזווה';
const ft = C.addFeature({ unitId: pantryId }, { title: 'Removable doors without tools', text: OWNER_TEXT, category: 'doors', priority: 'must' });
check('a must feature is added with a stable number', ft.ok && ft.n === 1);
const pe2 = C.drawings(north.id);
check('callout balloon ① on the pantry in plan and elevation', ['plan', 'elevation'].every((k) => pe2.find((d) => d.kind === k).ops.some((o) => o.role === 'callout' && o.t === 'text' && o.featureId === ft.featureId && o.text === '1' && o.label === '①')));
const sch2 = C.schedules(north.id);
check('features table row with the owner\'s untranslated text', sch2.features.some((r) => r.featureId === ft.featureId && r.text === OWNER_TEXT && /K1·T1/.test(r.ref) && r.priority.en === 'Must'));
check('auto-generated question for the must feature', sch2.questions.some((q) => q.featureId === ft.featureId && q.text.en.includes(OWNER_TEXT)));
const est2 = C.estimate('all', { tier: 'mid', pricebook: PRICEBOOK });
const fl = est2.runs.flatMap((r) => r.components).flatMap((c) => c.lines).find((l) => l.featureId === ft.featureId);
check('estimate: a noRate line "priced by the carpenter" for the feature, listed in missingRates', fl && fl.noRate && fl.typical === 0 && /priced by the carpenter/.test(fl.label.en) && est2.missingRates.some((m) => m.key === fl.rateKey));
check('estimate: removable-door fittings flagged noRate', est2.runs.find((r) => r.runId === north.id).components.some((c) => c.lines.some((l) => l.rateKey === 'fittings.removable' && l.noRate)));
check('checkRun reminds that the feature has no automatic checks', C.checkRun(north.id).some((f) => f.code === 'feature' && f.severity === 'info'));
check('feature edit / remove keep the number stable', C.updateFeature(ft.featureId, { title: 'Lift-off doors' }).ok && C.listFeatures(north.id)[0].n === 1 && C.listFeatures(north.id)[0].title === 'Lift-off doors');

group('Bespoke unit composer');
const tpl = C.customLayoutTemplate('bar-niche');
const cr = C.createRun({ kind: 'custom', anchor: { x: 4000, y: 4000, dir: 0 }, length: 80, units: [tpl] });
const cu = cr.ok && C.getRun(cr.runId).units[0];
check('a bar-niche template lays out as a bespoke tall unit', cr.ok && cu.carp.module === 'custom' && cu.h === 220 && cu.w === 80, cr.reason && cr.reason.en);
const cIn = C.drawings(cr.runId).find((d) => d.kind === 'internal');
const cells = tpl.internals.layout.columns.flatMap((c, i) => c.cells.map((_, k) => `${i + 1}.${k + 1}`));
check('internal elevation draws every cell exactly once', cIn && cells.every((id) => cIn.ops.filter((o) => o.role === 'cell' && o.cellId === id).length === 1));
const cg = C.geometryOf(C.getRun(cr.runId).run, cu);
check('its dimension chains sum to its size (width 80, front height 210)', near(cIn.dims.find((d) => d.id.startsWith('cols-')).total, 80) && cIn.dims.filter((d) => d.id.startsWith('cells-')).every((d) => near(d.total, cg.zone.y1 - cg.zone.y0) && near(sum(d.values), d.total, 0.05)));
const ctk = C.takeoff(cr.runId).runs[0].units[0];
const cellArea = sum(cg.fronts.filter((f) => ['door', 'glass', 'drawer', 'panel'].includes(f.kind)), (f) => (f.w * f.h) / 1e4);
check('take-off front area = sum of the cells\' fronts', near(sum(ctk.fronts, (f) => f.areaM2), cellArea, 0.01), `${sum(ctk.fronts, (f) => f.areaM2)} vs ${cellArea}`);
const bad = C.updateUnit(cu.id, { internals: { layout: { columns: [{ w: 100, cells: [{ flex: 1, kind: 'door' }] }] } } });
check('an impossible layout is refused with a bilingual reason', !bad.ok && /exceed/.test(bad.reason.en) && HEB.test(bad.reason.he));
check('every template is valid', Object.keys(C.CUSTOM_TEMPLATES).every((n) => { const t = C.customLayoutTemplate(n); const r = C.addUnit(cr.runId, 'custom', t); return r.ok; }));
const db = C.createRun({ kind: 'kitchen', anchor: { x: 5000, y: 5000, dir: 0 }, length: 60, units: [{ module: 'base-drawers', width: 60 }] });
const dbU = C.getRun(db.runId).units[0], before3 = C.geometryOf(C.getRun(db.runId).run, dbU).fronts.map((f) => [f.kind, f.x, f.y, f.w, f.h]);
const tc = C.toCustom(dbU.id);
const after3 = C.geometryOf(C.getRun(db.runId).run, store.getItem(dbU.id)).fronts.map((f) => [f.kind, f.x, f.y, f.w, f.h]);
check('toCustom on a 3-drawer base keeps identical fronts, size and worktop', tc.ok && store.getItem(dbU.id).carp.module === 'custom' && eq(before3, after3) && store.getItem(dbU.id).h === 90 && C.takeoff(db.runId).runs[0].worktops.length === 1, JSON.stringify([before3, after3]));
const s1 = state(), fileB = JSON.parse(JSON.stringify(store.serialize()));
store.undo(); store.redo();
check('undo / redo round-trip with bespoke data', state() === s1);
store.load(fileB);
check('serialize → load round-trip with bespoke data', state() === s1);
let guard = 0;
while (state() !== snapAdopt && store.historyState().canUndo && guard++ < 100) store.undo();
check('everything undoes back to the adopted design', state() === snapAdopt);

// ───────────────────────── carpenters ─────────────────────────
group('Carpenters by distance');
const list = [{ id: 'ta', name: 'Tel Aviv shop', lat: 32.08, lon: 34.78 }, { id: 'nc', name: 'No coords' }, { id: 'tb', name: 'Tiberias shop', lat: 32.79, lon: 35.53 }, { id: 'af', name: 'Afikim shop', lat: 32.68, lon: 35.58 }];
const sorted = C.sortCarpentersByDistance(list);
check('nearest first, no coordinates last', sorted.map((c) => c.id).join() === 'af,tb,ta,nc' && sorted[0].distanceKm === 0 && sorted[3].distanceKm === null);
check('haversine distance Afikim → Tel Aviv ≈ 110 km', sorted[2].distanceKm > 100 && sorted[2].distanceKm < 120, sorted[2].distanceKm);

// ───────────────────────── undo / redo, serialize / load ─────────────────────────
group('Store integration');
const ev1 = events.length;
const b4 = state();
const u4 = unitsOf(north).find((u) => u.carp.module === 'base-drawers');
const wres = C.setUnitWidth(u4.id, 90);
const after = state();
check('a change is one undo step with one carpentry event', wres.ok && events.length === ev1 + 1 && events[events.length - 1].reason === 'update-unit' && events[events.length - 1].runIds.includes(north.id));
check('neighbours re-laid out (tall units moved 5 cm left)', near(byPlanX(unitsOf(north).find((u) => u.carp.module === 'tall-oven')).x, 650));
store.undo();
check('undo restores items and carpentry exactly', state() === b4 && events[events.length - 1].reason === 'history');
store.redo();
check('redo re-applies exactly', state() === after);
const file = JSON.parse(JSON.stringify(store.serialize()));
check('serialize() carries carpentry', file.carpentry && Object.keys(file.carpentry.runs).length === runs.length);
store.load({ items: [] });
check('loading a file without carpentry empties it', Object.keys(store.carpentry.runs).length === 0 && events[events.length - 1].reason === 'load');
store.load(file);
check('serialize → load round-trips exactly', state() === after);
store.load({ items: [], carpentry: { runs: 'garbage' } });
check('unreadable carpentry falls back to empty without throwing', Object.keys(store.carpentry.runs).length === 0);
store.load(file);

// ───────────────────────── performance ─────────────────────────
group('Island: move and turn on the plan (moveRun, runClearances)');
{
  const isl0 = C.getRun(island.id).run, fp0 = C.runFootprint(isl0), undo0 = store._undo.length, snap0 = state();
  const cl = C.runClearances(island.id);
  check('runClearances: one entry per side with a level from the aisle rules', cl.length === 4 && cl.every((c) => ['ok', 'tight', 'short'].includes(c.level)) && cl.some((c) => c.d != null), JSON.stringify(cl.map((c) => [c.side, c.d, c.level])));
  const n0 = cl.find((c) => c.side === 'n');
  check('north clearance reaches the north kitchen run', n0 && n0.d > 0 && n0.what === 'another run', n0 && `${n0.d} ${n0.what}`);
  let r = C.moveRun(island.id, { dx: 20, dy: -10 });
  const fp1 = C.runFootprint(C.getRun(island.id).run);
  check('moveRun dx 20 dy -10: ok, one undo step, footprint moved exactly', r.ok && r.changed && store._undo.length === undo0 + 1 && near(fp1.x, fp0.x + 20) && near(fp1.y, fp0.y - 10) && near(fp1.w, fp0.w), r.reason && r.reason.en);
  store.undo();
  check('undo restores the island', state() === snap0);
  r = C.moveRun(island.id, { rot: 90 });
  const run90 = C.getRun(island.id).run, fp2 = C.runFootprint(run90);
  check('moveRun rot 90: turned about its centre (footprint 120 × 280, same centre)', r.ok && run90.anchor.dir === (isl0.anchor.dir + 90) % 360 && near(fp2.w, fp0.h) && near(fp2.h, fp0.w) && near(fp2.x + fp2.w / 2, fp0.x + fp0.w / 2) && near(fp2.y + fp2.h / 2, fp0.y + fp0.h / 2), r.reason && r.reason.en);
  r = C.moveRun(island.id, { rot: 270 });
  check('rot 270 more → back to the original footprint', r.ok && eq(C.runFootprint(C.getRun(island.id).run), fp0) && C.getRun(island.id).run.anchor.dir === isl0.anchor.dir);
  store.undo(); store.undo();
  const snap1 = state(), undo1 = store._undo.length;
  r = C.moveRun(island.id, { rot: 45 });
  check('rot 45 refused (90° steps), nothing changed', !r.ok && HEB.test(r.reason.he) && state() === snap1);
  r = C.moveRun(island.id, { dy: -2000 });
  check('moving out of the room refused with a reason', !r.ok && /room|wall/.test(r.reason.en) && state() === snap1, r.reason && r.reason.en);
  r = C.moveRun(island.id, { dy: -(n0.d + 10) });
  check('moving onto the north run refused (overlap)', !r.ok && /overlap/.test(r.reason.en) && state() === snap1, r.reason && r.reason.en);
  r = C.moveRun(north.id, { dx: 10 });
  check('a wall-bound run cannot be moved this way', !r.ok && /wall/.test(r.reason.en) && state() === snap1 && !C.isFreeRun(north) && C.isFreeRun(island));
  r = C.moveRun(island.id, { dy: -(n0.d - 70) });
  const tight = C.runClearances(island.id).find((c) => c.side === 'n');
  const aisle = C.checkRun(island.id).find((f) => f.code === 'aisle');
  check('70 cm from the run: clearance "short" and an aisle error from checkRun (≥ 90 cm rule)', r.ok && near(tight.d, 70, 0.6) && tight.level === 'short' && aisle && aisle.severity === 'error' && / 90 cm/.test(aisle.text.en), aisle && aisle.text.en);
  store.undo();
  check('moves are undoable, store back as before', state() === snap1 && store._undo.length === undo1);
  store.begin();
  for (let i = 1; i <= 4; i++) C.moveRun(island.id, { dx: 5 }, { transient: true });
  store.commit();
  check('a drag (begin … transient moves … commit) is ONE undo step', store._undo.length === undo1 + 1 && near(C.runFootprint(C.getRun(island.id).run).x, fp0.x + 20));
  store.undo();
  check('… and undoes in one go', state() === snap1);

  // the bar stools at the island's seating side ride along (same move / turn, same undo step); nothing else moves
  const fpS = C.runFootprint(C.getRun(island.id).run), cxS = fpS.x + fpS.w / 2, cyS = fpS.y + fpS.h / 2;
  const stools = store.items.filter((i) => i.type === 'bar-stool').map((i) => ({ ...i }));
  const others = () => JSON.stringify(store.items.filter((i) => i.type !== 'bar-stool' && !(i.carp && i.carp.runId === island.id)));
  const others0 = others(), undoS = store._undo.length;
  check('the architect’s layout has stools at the island', stools.length >= 3 && stools.every((s) => s.y > fpS.y + fpS.h - 20 && s.y < fpS.y + fpS.h + 60), JSON.stringify(stools.map((s) => [s.x, s.y])));
  r = C.moveRun(island.id, { dx: 30, dy: -15 });
  const moved = store.items.filter((i) => i.type === 'bar-stool');
  check('moving the island moves its stools by the same distance', r.ok && moved.every((m, k) => near(m.x, stools[k].x + 30) && near(m.y, stools[k].y - 15) && m.rot === stools[k].rot), JSON.stringify(moved.map((m) => [m.x, m.y])));
  check('… nothing else moves, one undo step', others() === others0 && store._undo.length === undoS + 1);
  store.undo();
  check('… and undo puts the stools back with the island', state() === snap1);
  r = C.moveRun(island.id, { rot: 180 });
  const turned = store.items.filter((i) => i.type === 'bar-stool');
  check('turning the island 180° takes the stools round its centre (now on the other side, facing it)', r.ok
    && turned.every((m, k) => near(m.x, 2 * cxS - stools[k].x) && near(m.y, 2 * cyS - stools[k].y) && m.rot === (stools[k].rot + 180) % 360) && others() === others0,
  JSON.stringify(turned.map((m) => [m.x, m.y, m.rot])));
  store.undo();
  store.begin();
  for (let i = 1; i <= 4; i++) C.moveRun(island.id, { dx: 5 }, { transient: true });
  store.cancel(); C.moveRun(island.id, { dx: 20 });
  check('a drag of the island carries the stools the whole distance in one step', store.items.filter((i) => i.type === 'bar-stool').every((m, k) => near(m.x, stools[k].x + 20)) && store._undo.length === undoS + 1);
  store.undo();
  check('… undone in one go', state() === snap1);
}

group('Performance');
const kit = [north.id, west.id, island.id];
const t0 = performance.now(), N = 20;
for (let i = 0; i < N; i++) {
  C.updateRun(north.id, { notes: 'perf ' + i });                       // forces a full re-layout of the L (+ linked run)
  C.takeoff(north.id); C.takeoff(west.id); C.takeoff(island.id);
  kit.forEach((id) => C.drawings(id));
  C.estimate('all', { pricebook: TEST_PRICEBOOK, method: 'materials' });
}
const ms = (performance.now() - t0) / N;
check('full kitchen: layout + take-off + drawings + estimate < 30 ms', ms < 30, `${ms.toFixed(1)} ms`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('CARPENTRY FAILED'); process.exit(1); }
console.log('CARPENTRY OK');
