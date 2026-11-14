/**
 * composeQuotation(options) → Doc — the carpenter's request-for-quotation package, laid out ONCE into pages of
 * primitive ops (see prims.js) that the SVG preview and the PDF renderer draw identically. See docs/CONTRACT.md § 9.
 */
import * as Carp from '../index.js';
import { PLAN } from '../../core/plan.js';
import { Builder, ST, TP, lh, region, textFurniture } from './kit.js';
import { S, tr, INCLUDED, EXCLUDED, ALTERNATIVES, fmtDate, fmtInt, fmtCm } from './strings.js';
import { sheetGeometry, packDrawings, drawSheet } from './sheets.js';
import { keyPlanOps } from './keyplan.js';
import { hasLevels, levelName, levelIds } from '../../core/levels.js';
import { levelPlan } from '../../core/plan-edit.js';

const L = (en, he) => ({ en, he });
const { vocab } = Carp;
const TIERS = { suggested: L('suggested per run', 'מוצעת לפי קו'), basic: L('basic', 'בסיסית'), mid: L('mid', 'בינונית'), premium: L('premium', 'פרימיום') };

/** Free-text spec values (colours, hardware names) the engine stores in English: Hebrew from Carp.SPEC_TEXT_HE. */
const free = (s) => Carp.specText(s ?? '—');
const cat = (...parts) => L(parts.map((p) => tr(p, 'en')).filter(Boolean).join(''), parts.map((p) => tr(p, 'he')).filter(Boolean).join(''));
const cm = L(' cm', ' ס״מ'), mm = L(' mm', ' מ״מ');

/** Spec rows for the general specification: run → { en, he } | null (not applicable). */
const SPEC_ROWS = [
  [S.carcass, (r) => cat(vocab('carcassMaterial', r.spec.carcass.material), ', ', String(r.spec.carcass.thickness), mm, ', ', free(r.spec.carcass.color))],
  [S.backs, (r) => cat(vocab('backMaterial', r.spec.carcass.back.material), ', ', String(r.spec.carcass.back.thickness), mm)],
  [S.frontsRow, (r) => cat(vocab('frontMaterial', r.spec.fronts.material), ', ', String(r.spec.fronts.thickness), mm, ', ', free(r.spec.fronts.color))],
  [S.frontStyle, (r) => vocab('frontStyle', r.spec.fronts.style)],
  [S.edges, (r) => cat(S.carcassEdge, ': ', vocab('edge', r.spec.edge.carcass), ' · ', S.frontEdge, ': ', vocab('edge', r.spec.edge.fronts))],
  [S.handles, (r) => cat(vocab('handleType', r.spec.handles.type), r.spec.handles.type === 'bar' ? cat(' ', String(r.spec.handles.length), cm) : '', ['bar', 'knob', 'edge-pull'].includes(r.spec.handles.type) ? cat(', ', vocab('finish', r.spec.handles.finish)) : '')],
  [S.plinth, (r) => (r.spec.plinth.height > 0 ? cat(String(r.spec.plinth.height), cm, ', ', L('set back ', 'נסיגה '), String(r.spec.plinth.setback), cm, ', ', vocab('plinthFinish', r.spec.plinth.finish)) : null)],
  [S.hardwareGrade, (r) => cat(vocab('hardwareGrade', r.spec.hardware.grade), ' · ', free(r.spec.hardware.hinge), ' · ', free(r.spec.hardware.drawers))],
  [S.worktopRow, (r) => (r.spec.worktop.material === 'none' || !(r.worktops || []).length ? null : cat(vocab('worktopMaterial', r.spec.worktop.material), ', ', String(r.spec.worktop.thickness), mm, ', ', free(r.spec.worktop.color), ', ', vocab('worktopEdge', r.spec.worktop.edge)))],
  [S.splashback, (r) => (r.spec.splashback.material === 'none' || r.spec.worktop.material === 'none' ? null : cat(vocab('splashback', r.spec.splashback.material), ', ', L('height ', 'גובה '), String(r.spec.splashback.height), cm))],
  [S.lighting, (r) => { const l = [r.spec.lighting.underWall && S.underWallLed, r.spec.lighting.inCabinet && S.inCabinetLed].filter(Boolean); return l.length ? L(l.map((x) => x.en).join('; '), l.map((x) => x.he).join('; ')) : S.noLighting; }],
  [S.heights, (r) => cat(L('worktop ', 'משטח '), String(r.spec.heights.worktop), cm, ' · ', L('top line ', 'קו עליון '), String(r.spec.heights.topLine), cm, ' · ', vocab('aboveTop', r.spec.heights.aboveTop))],
];

/** Most common value + exceptions (by run code). */
function specLine(runs, fn, lang) {
  const groups = new Map();
  for (const r of runs) {
    const v = fn(r);
    if (!v) continue;
    const k = v.en;
    if (!groups.has(k)) groups.set(k, { v, codes: [] });
    groups.get(k).codes.push(r.code);
  }
  if (!groups.size) return null;
  const list = [...groups.values()].sort((a, b) => b.codes.length - a.codes.length);
  let text = tr(list[0].v, lang);
  if (list.length > 1 || list[0].codes.length < runs.length) {
    if (list.length === 1) text += ` (${list[0].codes.join(', ')})`;
    for (const g of list.slice(1)) text += `\n${tr(S.except, lang)} ${g.codes.join(', ')}: ${tr(g.v, lang)}`;
  }
  return text;
}

const roomOf = (plan, run, lang) => {
  const r = (plan.rooms || []).find((x) => x.id === run.roomId);
  return r ? tr(L(r.name, r.nameHe || r.name), lang) : '—';
};
const runName = (run, lang) => tr(L(run.name, run.nameHe || run.name), lang);
/** Floor of a run (stage F7): 'L0' when absent. */
const runFloor = (run) => (run && typeof run.level === 'string' && run.level ? run.level : 'L0');

/**
 * @param {object} o see CONTRACT § 9
 * @returns {{ lang, dir, pages, meta }}
 */
export function composeQuotation(o = {}) {
  const t0 = Date.now();
  const lang = o.lang === 'he' ? 'he' : 'en';
  const include = { estimate: false, cutLists: true, carpenterForm: true, questions: true, ...(o.include || {}) };
  const plan = (o.src && o.src.plan) || PLAN, store = o.src && o.src.store;
  const esrc = store ? { carpentry: store.carpentry, items: store.items } : undefined;
  const items = (esrc && esrc.items) || Carp.view().items;
  const all = Carp.listRuns(esrc);
  const want = !o.runIds || o.runIds === 'all' ? null : new Set(o.runIds);
  const runs = all.filter((r) => !want || want.has(r.id));
  const date = (o.project && o.project.date) || new Date().toISOString().slice(0, 10);
  const project = {
    title: (o.project && o.project.title) || (lang === 'he' ? 'בית 98 — קיבוץ אפיקים' : (plan.meta && plan.meta.name) || 'House'),
    address: (o.project && o.project.address) || (lang === 'he' ? 'קיבוץ אפיקים, עמק הירדן' : (plan.meta && plan.meta.location) || ''),
    ownerName: o.project && o.project.ownerName, phone: o.project && o.project.phone, email: o.project && o.project.email,
    date, dateText: fmtDate(date, lang), reference: (o.project && o.project.reference) || `H98-CARP-RFQ-${date}`,
  };
  // several floors (stage F7): each run is drawn on its own floor's plan and its title names the floor
  const multi = hasLevels(plan);
  const floorPlan = (id) => (id === 'L0' || !multi ? plan : levelPlan(plan, id) || plan);
  const planOfRun = (r) => floorPlan(runFloor(r));
  const floorL = (r) => L(levelName(plan, runFloor(r), 'en') || runFloor(r), levelName(plan, runFloor(r), 'he') || runFloor(r));
  const titleOf = (r) => (multi ? L(`${r.code} · ${r.name} · ${floorL(r).en}`, `${r.code} · ${r.nameHe || r.name} · ${floorL(r).he}`) : L(`${r.code} · ${r.name}`, `${r.code} · ${r.nameHe || r.name}`));
  const itemsOn = (id) => (multi ? items.filter((it) => { const lv = typeof it.level === 'string' && it.level ? it.level : (it.carp ? runFloor(all.find((x) => x.id === it.carp.runId)) : 'L0'); return lv === id; }) : items);
  const B = new Builder({ lang, project, paper: o.paper });
  const T = (v) => tr(v, lang);
  const cmU = lang === 'he' ? 'ס״מ' : 'cm';

  const sched = Carp.schedules('all', esrc), inRun = (x) => runs.some((r) => r.id === x.runId);
  const unitRef = new Map(sched.units.map((u) => [u.unitId, u.ref]));
  const findings = Carp.checkRun('all', esrc).filter((f) => runs.some((r) => r.id === f.runId));
  const takeoffs = new Map(runs.map((r) => [r.id, Carp.takeoff(r.id, esrc).runs[0]]));
  const runsX = runs.map((r) => ({ ...r, worktops: (takeoffs.get(r.id) || {}).worktops || [] }));
  const features = collectFeatures(sched.features, runs, esrc);

  // ── section numbering ──
  const sec = {}; let n = 0;
  for (const k of ['scope', features.length && 'features', 'spec', 'inclusions', 'runs', 'appliances', include.cutLists && 'cut', include.questions && 'questions', include.carpenterForm && 'form', include.estimate && 'estimate']) if (k) sec[k] = ++n;

  // ═════ cover ═════
  B.textPage({ role: 'cover' });
  {
    const R = B.R;
    let y = 46;
    R.text(0, y, project.title, { ...ST.label, size: 7.6, color: 'accent' }, 'start'); y += 13;
    R.text(0, y, T(S.rfq), ST.display, 'start'); y += lh(ST.display);
    R.text(0, y, T(S.rfqSub), { ...ST.display, color: 'grey' }, 'start'); y += 9;
    y += R.para(0, y, T(S.package), ST.body, R.W * 0.8) + 5;
    R.line(0, y, 22, y, { lw: 0.8, color: 'accent' }); y += 8;
    const info = [[S.project, project.title], [S.location, project.address], [S.date, project.dateText], [S.reference, project.reference],
      [S.client, project.ownerName], [S.phone, project.phone], [S.email, project.email]].filter(([, v]) => v);
    info.forEach(([k, v], i) => {
      const col = i % 2, row = Math.floor(i / 2), u = col * (R.W / 2), yy = y + row * 11.5;
      R.text(u, yy, T(k), ST.label, 'start');
      R.text(u, yy + 4.8, String(v), { size: 9.2, font: 'regular', color: 'ink' }, 'start', { maxWidth: R.W / 2 - 4 });
    });
    y += Math.ceil(info.length / 2) * 11.5 + 4;
    if (include.estimate) {
      R.rect(0, y, R.W, 8, { fill: 'accentTint' });
      R.text(3, y + 5.3, T(S.ownersCopy), { size: 7.8, font: 'medium', color: 'accent' }, 'start'); y += 13;
    }
    const kpTop = Math.max(y + 4, 150), kpH = TP.bottom - 14 - kpTop;
    R.text(0, kpTop, T(S.keyPlan), ST.label, 'start');
    R.hline(kpTop + 2, 0, R.W, 0.12, 'rule');
    const box = [TP.x0, kpTop + 6, TP.x1 - TP.x0, kpH - 6];
    if (!multi) B.page.ops.push(...keyPlanOps({ plan, items, runs, box, lang, labels: true, rooms: true }).ops);
    else {
      // one key plan per floor that has runs, side by side
      const floors = levelIds(plan).filter((id) => runs.some((r) => runFloor(r) === id));
      const n = Math.max(1, floors.length), gap = 6, w = (box[2] - gap * (n - 1)) / n;
      floors.forEach((id, i) => {
        const x = box[0] + i * (w + gap);
        B.page.ops.push(...keyPlanOps({ plan: floorPlan(id), items: itemsOn(id), runs: runs.filter((r) => runFloor(r) === id), box: [x, box[1] + 6, w, box[3] - 6], lang, labels: true, rooms: true, north: i === n - 1 }).ops);
        R.text(x - TP.x0, kpTop + 8, levelName(plan, id, lang) || id, { ...ST.label, color: 'ink' }, 'start');
      });
    }
    R.text(0, TP.bottom - 4, T(S.keyPlanNote), ST.small, 'start');
  }

  // ═════ contents + invitation ═════
  B.textPage();
  B.heading('', S.contents);
  const toc = [];
  const tocAdd = (num, title, key, level = 1) => toc.push({ num, title, key, level });
  tocAdd(sec.scope, S.scope, 'scope'); if (sec.features) tocAdd(sec.features, S.special, 'features'); tocAdd(sec.spec, S.spec, 'spec'); tocAdd(sec.inclusions, L('Included and excluded', 'כלול ולא כלול'), 'inclusions');
  tocAdd(sec.runs, S.runSheets, 'runs');
  runs.forEach((r, i) => tocAdd(`${sec.runs}.${i + 1}`, multi ? L(`${r.code}  ${r.name} · ${floorL(r).en}`, `${r.code}  ${r.nameHe || r.name} · ${floorL(r).he}`) : L(`${r.code}  ${r.name}`, `${r.code}  ${r.nameHe || r.name}`), `run:${r.id}`, 2));
  tocAdd(sec.appliances, S.appliances, 'appliances');
  if (sec.cut) tocAdd(sec.cut, S.cutLists, 'cut');
  if (sec.questions) tocAdd(sec.questions, S.questions, 'questions');
  if (sec.form) tocAdd(sec.form, S.form, 'form');
  if (sec.estimate) tocAdd(sec.estimate, S.estimate, 'estimate');
  {
    const R = B.R;
    for (const e of toc) {
      const st = e.level === 1 ? { size: 8.8, font: 'medium', color: 'ink' } : { size: 8, font: 'regular', color: 'ink2' }, rowH = e.level === 1 ? 6.6 : 5.2;
      if (e.level === 1) B.y += 1.2;
      const yb = B.y + 4.2, u0 = e.level === 1 ? 0 : 11;
      R.text(u0, yb, String(e.num), { ...st, color: e.level === 1 ? 'accent' : 'grey' }, 'start');
      R.text(u0 + (e.level === 1 ? 11 : 12), yb, T(e.title), st, 'start', { maxWidth: R.W - 40 });
      const page = B.page;
      B.later.push(() => { const p = B.marks[e.key]; if (p) region(page, TP.x0, TP.x1, B.dir).text(R.W, yb, String(p), st, 'end'); });
      B.y += rowH;
      R.hline(B.y - 0.8, u0, R.W, 0.08, 'hair');
    }
    B.y += 8;
    B.para(S.invitation, ST.lead, { gap: 3 });
    const errs = Carp.checkRun('all', esrc).filter((f) => f.severity === 'error' && runs.some((r) => r.id === f.runId)).length;
    B.meta = { errors: errs };
  }

  // ═════ 1 scope ═════
  B.textPage();
  B.heading(sec.scope, S.scope, { key: 'scope' });
  B.table({
    id: 'scope', title: S.scope,
    cols: [{ key: 'code', title: S.code, w: 8, st: ST.tdb }, { key: 'name', title: S.name, w: 22 }, { key: 'room', title: S.room, w: 15 }, { key: 'kind', title: S.kind, w: 12 },
      { key: 'len', title: S.lengthCm, w: 9, align: 'end' }, { key: 'units', title: S.unitsN, w: 7, align: 'end' }, { key: 'fronts', title: S.fronts, w: 17 }, { key: 'wt', title: S.worktop, w: 19 }],
    rows: runsX.map((r) => ({ cells: {
      code: r.code, name: multi ? `${runName(r, lang)} · ${T(floorL(r))}` : runName(r, lang), room: roomOf(planOfRun(r), r, lang), kind: vocab('runKind', r.kind), len: fmtCm(r.length),
      units: String(sched.units.filter((u) => u.runId === r.id).length), fronts: vocab('frontMaterial', r.spec.fronts.material),
      wt: r.spec.worktop.material === 'none' || !r.worktops.length ? '—' : vocab('worktopMaterial', r.spec.worktop.material),
    } })),
  });
  {
    const tot = runs.reduce((s, r) => s + r.length, 0), nU = sched.units.filter(inRun).length;
    B.para(L(`${runs.length} runs · ${fmtCm(tot)} cm of carpentry in total · ${nU} units (excluding free-standing appliance spaces).`,
      `${runs.length} קווים · סה״כ ${fmtCm(tot)} ס״מ נגרות · ${nU} יחידות (ללא נישות למכשירים עומדים).`), ST.small);
  }

  // ═════ special requirements (consolidated) ═════
  if (sec.features) {
    B.heading(sec.features, S.special, { key: 'features' });
    B.para(S.specialNote, ST.body);
    B.table({
      id: 'features', title: S.special,
      cols: [{ key: 'label', title: L('No.', 'מס׳'), w: 7, align: 'center', st: ST.tdb }, { key: 'ref', title: S.code, w: 11, st: ST.tdb }, { key: 'req', title: S.requirement, w: 58, auto: true }, { key: 'cat', title: S.category, w: 14 }, { key: 'pri', title: S.priority, w: 10 }],
      rows: features.map((f) => ({ cells: { label: f.label, ref: f.ref, req: f.full, cat: f.category, pri: f.priority } })),
    });
  }

  // ═════ 2 specification ═════
  B.heading(sec.spec, S.spec, { key: 'spec' });
  B.para(S.specNote, ST.small, { gap: 2 });
  B.keyValues(SPEC_ROWS.map(([k, fn]) => [k, specLine(runsX, fn, lang)]).filter(([, v]) => v), { labelW: 0.22, id: 'spec' });

  // ═════ 3 included / excluded ═════
  B.heading(sec.inclusions, L('Included and excluded', 'כלול ולא כלול'), { key: 'inclusions' });
  B.heading('', S.included, { level: 3 });
  B.bullets(INCLUDED);
  B.heading('', S.excluded, { level: 3 });
  B.bullets(EXCLUDED);

  // ═════ 4 per run ═════
  const G = sheetGeometry(B.paper === 'A3' ? [420, 297] : [297, 210]);
  B.marks.runs = B.pages.length + 1;
  runs.forEach((run, ri) => {
    const num = `${sec.runs}.${ri + 1}`;
    const ds = Carp.drawings(run.id, esrc);
    const packed = packDrawings(ds, G.area);
    let vn = 0;
    const views = packed.flatMap((s) => s.items.map((it) => ({ ...it, num: ++vn })));
    packed.forEach((s, si) => {
      const vs = s.items.map((it) => views.find((v) => v.d === it.d));
      const layout = { ...s.layout, rows: s.layout.rows.map((row) => ({ ...row, items: row.items.map((it) => views.find((v) => v.d === it.d)) })) };
      drawSheet({ B, run, plan: planOfRun(run), items: itemsOn(runFloor(run)), runs: multi ? runs.filter((r) => runFloor(r) === runFloor(run)) : runs, roomName: roomOf(planOfRun(run), run, lang), kindLabel: vocab('runKind', run.kind), sheetCode: `${run.code}-${String(si + 1).padStart(2, '0')}`, views: vs, layout });
      if (si === 0) B.marks[`run:${run.id}`] = B.pages.length;
    });
    // schedules
    B.textPage();
    if (!packed.length) B.marks[`run:${run.id}`] = B.pages.length;
    B.heading(num, titleOf(run));
    const S1 = Carp.schedules(run.id, esrc);
    const levels = [...new Set((run.levels || []).map((l) => T(vocab('level', l))))].join(', ');
    B.para(`${T(S.roomLabel)}: ${roomOf(planOfRun(run), run, lang)}${multi ? `  ·  ${T(floorL(run))}` : ''}  ·  ${T(vocab('runKind', run.kind))}  ·  ${T(S.lengthLabel)} ${fmtCm(run.length)} ${cmU}  ·  ${T(S.unitsLabel)}: ${S1.units.length}${levels ? `  ·  ${levels}` : ''}`, ST.body, { gap: 1.5 });
    if (run.notes) B.para(run.notes, ST.small, { auto: true });
    const rf = features.filter((f) => f.runId === run.id);
    if (rf.length) {
      B.heading('', S.special, { level: 3 });
      for (const f of rf) {
        B.ensure(14);
        const R = B.R, yb = B.y + 3.4;
        B.page.ops.push({ t: 'arc', cx: R.X(2.6), cy: yb - 1.1, r: 2.5, a0: 0, a1: 360, lw: 0.3, color: 'accent' });
        R.text(2.6, yb - 0.1, String(f.n), { size: 6.6, font: 'bold', color: 'accent' }, 'center', { dir: 'ltr' });
        R.text(8, yb, [f.ref, T(f.category), T(f.priority)].filter(Boolean).join('  ·  '), { ...ST.label, color: 'accent' }, 'start');
        B.y += 5;
        if (f.title) B.para(f.title, ST.h3, { indent: 8, gap: 0.8, auto: true });
        if (f.text) B.para(f.text, ST.body, { indent: 8, gap: 1.5, auto: true });
        for (const img of f.images) if (img && img.dataUrl) B.image(img.dataUrl, img.w, img.h, { u: 8, caption: img.name || '' });
        B.y += 2;
      }
    }
    B.heading('', S.units, { level: 3 });
    const UW = { ref: 10, module: 16, size: 12, fronts: 13, internals: 13, hardware: 18, notes: 11, operation: 10 };
    const UH = [...(Carp.HEADERS.units || [])];
    if (S1.units.some((u) => u.operation && u.operation.en && !/^hinged/i.test(u.operation.en)) && !UH.some(([k]) => k === 'operation')) UH.splice(4, 0, ['operation', L('Door operation', 'אופן פתיחה')]);
    const notesOf = (u) => (u.corner ? cat(u.corner, u.notes && tr(u.notes, 'en') ? '; ' : '', u.notes || '') : u.notes);
    B.table({
      id: `units:${run.code}`, title: S.units,
      cols: UH.map(([key, title]) => ({ key, title, w: UW[key] || 12, ...(key === 'ref' ? { st: ST.tdb } : {}), ...(key === 'notes' ? { auto: true } : {}) })),
      rows: S1.units.map((u) => ({ cells: Object.fromEntries(UH.map(([key]) => [key, cellOf(key === 'size' ? u.sizeText : key === 'notes' ? notesOf(u) : u[key])])) })),
    });
    B.heading('', S.materials, { level: 3 });
    const HM = Object.fromEntries(Carp.HEADERS.materials);
    B.table({
      id: `materials:${run.code}`, title: S.materials,
      cols: [{ key: 'element', title: HM.element, w: 15, st: ST.tdb }, { key: 'material', title: HM.material, w: 27 }, { key: 'thickness', title: HM.thickness, w: 10 }, { key: 'colour', title: HM.colour, w: 14 }, { key: 'finish', title: HM.finish, w: 26 }],
      rows: S1.materials.map((m) => ({ cells: { element: m.element, material: m.material, thickness: localUnits(m.thickness, lang), colour: free(m.colour), finish: free(m.finish) } })),
    });
    B.heading('', S.hardware, { level: 3 });
    const HH = Object.fromEntries(Carp.HEADERS.hardware);
    B.table({
      id: `hardware:${run.code}`, title: S.hardware,
      cols: [{ key: 'item', title: HH.item, w: 30 }, { key: 'spec', title: HH.spec, w: 40 }, { key: 'qty', title: HH.qty, w: 10, align: 'end' }, { key: 'unit', title: HH.unit, w: 10 }],
      rows: S1.hardware.map((h) => ({ cells: { item: h.item, spec: h.spec, qty: fmtCm(h.qty), unit: h.unit } })),
    });
    if (S1.worktops.length) {
      B.heading('', S.worktops, { level: 3 });
      const HW = Object.fromEntries(Carp.HEADERS.worktops);
      B.table({
        id: `worktops:${run.code}`, title: S.worktops,
        cols: [{ key: 'ref', title: HW.ref, w: 10, st: ST.tdb }, { key: 'material', title: HW.material, w: 17 }, { key: 'thickness', title: HW.thickness, w: 9, align: 'end' }, { key: 'sizeText', title: HW.size, w: 13 },
          { key: 'cutouts', title: HW.cutouts, w: 25 }, { key: 'edges', title: HW.edges, w: 25 }, { key: 'area', title: HW.area, w: 8, align: 'end' }],
        rows: S1.worktops.map((w) => ({ cells: { ref: w.ref, material: w.material, thickness: String(w.thickness), sizeText: w.sizeText, cutouts: w.cutouts, edges: w.edges, area: String(w.area) } })),
      });
    }
    B.heading('', S.checks, { level: 3 });
    const fs = findings.filter((f) => f.runId === run.id && f.severity !== 'error');
    if (fs.length) {
      B.table({
        id: `checks:${run.code}`, title: S.checks,
        cols: [{ key: 'sev', title: S.severity, w: 10, st: ST.tdb }, { key: 'units', title: S.unit, w: 14 }, { key: 'text', title: S.note, w: 76 }],
        rows: fs.map((f) => ({ cells: { sev: f.severity === 'warning' ? S.check : S.info, units: (f.unitIds || []).map((id) => unitRef.get(id)).filter(Boolean).join(', ') || run.code, text: f.text } })),
      });
    } else B.para(S.noChecks, ST.small);
  });

  // ═════ 5 appliances ═════
  B.textPage();
  B.heading(sec.appliances, S.appliances, { key: 'appliances' });
  B.para(S.appliancesNote, ST.body);
  const HA = Object.fromEntries(Carp.HEADERS.appliances);
  const apps = sched.appliances.filter(inRun);
  B.table({
    id: 'appliances', title: S.appliances,
    cols: [{ key: 'ref', title: HA.ref, w: 12, st: ST.tdb }, { key: 'appliance', title: HA.appliance, w: 34 }, { key: 'make', title: HA.make, w: 30 }, { key: 'niche', title: HA.niche, w: 20 }],
    rows: apps.map((a) => ({ cells: { ref: a.ref, appliance: a.appliance, make: a.make, niche: a.niche } })),
  });

  // ═════ 6 cut lists ═════
  if (sec.cut) {
    B.textPage();
    B.heading(sec.cut, S.cutLists, { key: 'cut' });
    B.para(S.cutNote, ST.body, { color: 'ink' });
    for (const run of runs) {
      const rt = takeoffs.get(run.id);
      if (!rt) continue;
      const groups = new Map();
      for (const u of rt.units) for (const p of [...u.panels, ...u.fronts]) {
        const key = `${p.group}|${p.material}|${p.thickness}`;
        if (!groups.has(key)) groups.set(key, { p, rows: [], area: 0, qty: 0 });
        const g = groups.get(key); g.rows.push({ u, p }); g.area += p.areaM2 || 0; g.qty += p.qty || 0;
      }
      if (!groups.size) continue;
      B.heading('', titleOf(run), { level: 3 });
      const order = { carcass: 0, back: 1, front: 2, glass: 3 };
      const rows = [];
      for (const g of [...groups.values()].sort((a, b) => (order[a.p.group] ?? 9) - (order[b.p.group] ?? 9))) {
        rows.push({ kind: 'group', cells: { label: cat(materialLabel(g.p), ` · ${g.p.thickness}`, mm, '  —  ', `${g.qty} `, S.pcs, ` · ${Math.round(g.area * 100) / 100} `, S.areaM2) } });
        for (const { u, p } of g.rows) rows.push({ cells: { unit: `${run.code}·${u.code}`, part: p.part, size: `${Math.round(p.length)} × ${Math.round(p.width)}`, qty: String(p.qty), edging: { edges: p.edges || {}, label: (p.edges && (p.edges.long || p.edges.short)) ? edgeShort(p.edgeType) : '' } } });
      }
      B.table({
        id: `cut:${run.code}`, title: L(`${S.cutLists.en} — ${run.code}`, `${S.cutLists.he} — ${run.code}`),
        cols: [{ key: 'unit', title: S.unit, w: 12, st: ST.tdb }, { key: 'part', title: S.part, w: 34 }, { key: 'size', title: S.sizeMm, w: 20 }, { key: 'qty', title: S.qty, w: 8, align: 'end' }, { key: 'edging', title: S.edging, w: 22 }],
        rows, pad: 1.05,
      });
    }
  }

  // ═════ 7 questions ═════
  if (sec.questions) {
    B.textPage();
    B.heading(sec.questions, S.questions, { key: 'questions' });
    B.para(S.questionsNote, ST.body);
    const qs = sched.questions.filter(inRun);
    B.table({
      id: 'questions', title: S.questions, grid: true,
      cols: [{ key: 'n', title: '#', w: 5, align: 'end', st: ST.tdb }, { key: 'run', title: S.run, w: 7, st: ST.tdb }, { key: 'topic', title: S.topic, w: 14 }, { key: 'text', title: S.question, w: 46 }, { key: 'reply', title: S.reply, w: 28 }],
      rows: qs.map((q, i) => ({ cells: { n: String(i + 1), run: q.run, topic: q.topic, text: q.text, reply: '' } })),
      rowMin: 9,
    });
  }

  // ═════ 8 quotation form ═════
  if (sec.form) {
    B.textPage();
    B.heading(sec.form, S.form, { key: 'form' });
    B.para(S.formNote, ST.body);
    B.heading('', S.boq, { level: 3 });
    const cols = [{ key: 'run', title: S.run, w: 21, st: ST.tdb }, { key: 'c', title: S.carcasses, w: 11 }, { key: 'f', title: S.frontsCol, w: 11 }, { key: 'w', title: S.worktopCol, w: 12 },
      { key: 'h', title: S.hardwareCol, w: 12 }, { key: 'l', title: S.lightingCol, w: 10 }, { key: 'i', title: S.installCol, w: 11 }, { key: 't', title: S.runTotal, w: 12 }];
    B.table({
      id: 'form', title: S.boq, grid: true, rowMin: 10,
      cols,
      rows: runsX.map((r) => {
        const na = [];
        if (!r.worktops.length || r.spec.worktop.material === 'none') na.push('w');
        if (!r.spec.lighting.underWall && !r.spec.lighting.inCabinet) na.push('l');
        return { cells: { run: `${r.code}  ${runName(r, lang)}`, ...Object.fromEntries(na.map((k) => [k, '—'])) }, na };
      }),
    });
    B.table({
      id: 'form-totals', head: false, grid: true, rowMin: 8.5,
      cols: [{ key: 'k', title: '', w: 70, align: 'end', st: ST.tdb }, { key: 'v', title: '', w: 30 }],
      rows: [
        { cells: { k: S.subtotal } }, { cells: { k: S.measure } }, { cells: { k: S.delivery } }, { cells: { k: S.totalExcl } },
        { cells: { k: L('VAT 18%', 'מע״מ 18%') } }, { kind: 'total', cells: { k: S.totalIncl } },
      ],
    });
    if (features.length) {
      B.heading('', S.special, { level: 3 });
      B.table({
        id: 'form-features', title: S.special, grid: true, rowMin: 9,
        cols: [{ key: 'label', title: L('No.', 'מס׳'), w: 7, align: 'center', st: ST.tdb }, { key: 'ref', title: S.code, w: 11, st: ST.tdb }, { key: 'req', title: S.requirement, w: 56, auto: true }, { key: 'p', title: L('Price ₪', 'מחיר ₪'), w: 26 }],
        rows: features.map((f) => ({ cells: { label: f.label, ref: f.ref, req: f.title || f.text, p: '' } })),
      });
    }
    B.heading('', S.alternatives, { level: 3 });
    B.table({
      id: 'alternatives', title: S.alternatives, grid: true, rowMin: 8.5,
      cols: [{ key: 'n', title: '#', w: 5, align: 'end' }, { key: 'o', title: S.option, w: 65 }, { key: 'p', title: S.priceDiff, w: 30 }],
      rows: [...ALTERNATIVES, L('Other — proposed by the bidder:', 'אחר — הצעת המציע:'), L('Other — proposed by the bidder:', 'אחר — הצעת המציע:')].map((a, i) => ({ cells: { n: String(i + 1), o: a, p: '' } })),
    });
    B.heading('', S.terms, { level: 3 });
    B.table({
      id: 'terms', head: false, grid: true, rowMin: 9,
      cols: [{ key: 'k', title: '', w: 42, st: ST.tdb }, { key: 'v', title: '', w: 58 }],
      rows: [S.leadTime, S.installTime, S.measureDate, S.payment, S.warranty, S.validity, S.deviations].map((k) => ({ cells: { k } })),
    });
    B.heading('', S.bidder, { level: 3 });
    B.table({
      id: 'bidder', head: false, grid: true, rowMin: 8.5,
      cols: [{ key: 'k', title: '', w: 30, st: ST.tdb }, { key: 'v', title: '', w: 70 }],
      rows: [S.businessName, S.businessId, S.contactPerson, S.address, S.phone, S.email].map((k) => ({ cells: { k } })),
    });
    // signature boxes
    B.ensure(26);
    {
      const R = B.R, labels = [S.signedName, S.signature, S.date, S.stamp], w = (R.W - 3 * 4) / 4;
      labels.forEach((k, i) => {
        const u = i * (w + 4);
        R.rect(u, B.y, w, 20, { lw: 0.15, color: 'rule' });
        R.text(u + 2, B.y + 3.6, T(k), ST.label, 'start');
      });
      B.y += 24;
    }
  }

  // ═════ 9 owner's estimate ═════
  if (sec.estimate) {
    B.textPage();
    B.heading(sec.estimate, S.estimate, { key: 'estimate' });
    const e = Carp.estimate('all', { tier: o.tier, method: o.method, pricebook: o.pricebook, src: esrc });
    B.para(S.estimateNote, { ...ST.body, color: 'accent', font: 'medium' });
    B.para(e.label, ST.h3, { gap: 1 });
    B.para(e.disclaimer, ST.body);
    const er = e.runs.filter((r) => runs.some((x) => x.id === r.runId));
    const sum = { low: 0, typical: 0, high: 0 };
    for (const r of er) for (const k of Object.keys(sum)) sum[k] += r.total[k];
    const money = (v) => fmtInt(v);
    B.table({
      id: 'estimate', title: S.estimate,
      cols: [{ key: 'code', title: S.code, w: 9, st: ST.tdb }, { key: 'name', title: S.name, w: 37 }, { key: 'low', title: cat(S.low, ' ₪'), w: 18, align: 'end' }, { key: 'typ', title: cat(S.typical, ' ₪'), w: 18, align: 'end' }, { key: 'high', title: cat(S.high, ' ₪'), w: 18, align: 'end' }],
      rows: [
        ...er.map((r) => { const run = runs.find((x) => x.id === r.runId); return { cells: { code: r.code, name: run ? runName(run, lang) : r.name, low: money(r.total.low), typ: money(r.total.typical), high: money(r.total.high) } }; }),
        { kind: 'total', cells: { code: '', name: cat(S.total, ' ', S.exVat), low: money(sum.low), typ: money(sum.typical), high: money(sum.high) } },
        { kind: 'total', cells: { code: '', name: cat(S.total, ' ', S.incVat, ` (${Math.round(e.vat * 100)}%)`), low: money(sum.low * (1 + e.vat)), typ: money(sum.typical * (1 + e.vat)), high: money(sum.high * (1 + e.vat)) } },
      ],
    });
    B.para(`${T(S.basis)}: ${T(e.method === 'market' ? L('market rates per running metre / unit', 'מחירי שוק למטר רץ / ליחידה') : L('take-off quantities × material rates', 'כמויות × מחירי חומרים'))} · ${T(S.tier)}: ${T(TIERS[e.tier] || e.tier)} · ${T(S.asOf)} ${e.asOf || '—'} · ${T(S.vat)} ${Math.round(e.vat * 100)}% · ${e.currency}`, ST.small);
    if (e.pricebookMissing) B.para(L('No price book was supplied — the estimate is empty.', 'לא סופק מחירון — ההערכה ריקה.'), ST.small);
    const comps = new Map();
    for (const r of er) for (const c of r.components || []) if (c.basis && !comps.has(c.key)) comps.set(c.key, c);
    if (comps.size) {
      B.heading('', S.basis, { level: 3 });
      B.keyValues([...comps.values()].map((c) => [c.label, c.basis]), { labelW: 0.26, id: 'estimate-basis' });
    }
    const noRate = (e.missingRates || []).map((m) => (m && typeof m === 'object' ? m.label || m.key : String(m)));
    if (noRate.length) {
      B.heading('', L('Priced by the carpenter (not in the estimate)', 'מתומחר על ידי הנגר (לא כלול בהערכה)'), { level: 3 });
      B.bullets(noRate, ST.small, { gap: 0.4 });
    }
    const src = new Map();
    for (const r of er) for (const c of r.components || []) for (const l of c.lines || []) for (const so of [...(Array.isArray(l.sources) ? l.sources : []), ...(l.source ? [l.source] : [])]) if (so && so.name) src.set(so.name + (so.url || ''), so);
    if (src.size) { B.heading('', S.sources, { level: 3 }); B.bullets([...src.values()].map((so) => `${so.name}${so.url ? ' — ' + so.url : ''}`), ST.small, { gap: 0.4 }); }
    for (const nte of e.notes || []) B.para(typeof nte === 'object' ? nte : String(nte), ST.small, { gap: 0.6 });
  }

  // ═════ finalize ═════
  const N = B.pages.length, pageNo = (p) => B.pages.indexOf(p) + 1;
  B.pages.forEach((p, i) => { if (p.kind === 'text') textFurniture(B, p, i + 1, N); });
  for (const fn of B.later) fn(pageNo, N);
  const fileDate = date.replace(/[^0-9-]/g, '');
  return {
    lang, dir: B.dir,
    pages: B.pages.map((p) => ({ size: p.size, orientation: p.orientation, kind: p.kind, ...(p.role ? { role: p.role } : {}), ...(p.runId ? { runId: p.runId, sheetCode: p.sheetCode } : {}), ops: p.ops })),
    meta: {
      title: `${project.title} — ${T(S.rfqFull)}`, project, reference: project.reference, paper: B.paper, lang,
      filename: `House98-Carpentry-RFQ-${fileDate}-${lang.toUpperCase()}.pdf`,
      runs: runs.map((r) => ({ id: r.id, code: r.code, page: B.marks[`run:${r.id}`] || null })),
      sections: toc.map((e) => ({ num: String(e.num), title: T(e.title), page: B.marks[e.key] || null, level: e.level })),
      tables: B.tables, include, errors: (B.meta && B.meta.errors) || 0,
      warnings: findings.filter((f) => f.severity === 'warning').length, composeMs: Date.now() - t0,
    },
  };
}

/** A schedule cell value: bilingual objects pass through, numbers / arrays become text. */
function cellOf(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? x : String(x)));
  if (typeof v === 'object' && ('en' in v || 'he' in v)) return v;
  if (typeof v === 'object') return '';
  return String(v);
}

/**
 * Special requirements = schedules().features rows ({ runId, unitId, featureId, n, label '①', ref, code, title, text,
 * category { en, he }, priority { en, he } }) + their images from listFeatures (stored images via featureImage).
 * The owner's title / text are printed exactly as typed (never translated).
 */
function collectFeatures(rows, runs, esrc) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const full = new Map((typeof Carp.listFeatures === 'function' ? Carp.listFeatures('all', esrc) : []).map((f) => [f.id, f]));
  const image = (im) => {
    if (!im) return null;
    let url = im.dataUrl;
    if (!url && im.stored && typeof Carp.featureImage === 'function') { try { url = Carp.featureImage(im.id); } catch { url = null; } }
    return url ? { ...im, dataUrl: url } : null;
  };
  return rows.filter((f) => runs.some((r) => r.id === f.runId)).map((f) => {
    const imgs = (full.get(f.featureId) || {}).images || (Array.isArray(f.images) ? f.images : []);
    const title = f.title || '', text = f.text || '';
    return { ...f, images: imgs.map(image).filter(Boolean), full: title && text ? `${title} — ${text}` : title || text };
  });
}

/** Thickness strings like '18 mm' / '10 cm' in the document language. */
function localUnits(s, lang) {
  if (lang !== 'he' || typeof s !== 'string') return s;
  return s.replace(/\bmm\b/g, 'מ״מ').replace(/\bcm high\b/g, 'ס״מ גובה').replace(/\bcm\b/g, 'ס״מ');
}
function materialLabel(p) {
  if (p.group === 'glass' || p.material === 'glass') return L('Glass', 'זכוכית');
  if (p.material === 'mirror') return L('Mirror', 'מראה');
  const grp = p.group === 'back' ? 'backMaterial' : p.group === 'front' ? 'frontMaterial' : 'carcassMaterial';
  const v = vocab(grp, p.material);
  return v.en === String(p.material) ? vocab('frontMaterial', p.material) : v;
}
const edgeShort = (t) => ({ 'abs-1': 'ABS 1', 'abs-2': 'ABS 2', 'pvc-0.4': 'PVC 0.4', laser: 'Laser', painted: 'Paint' }[t] || String(t || ''));
