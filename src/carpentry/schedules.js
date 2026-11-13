/**
 * schedules(runId | 'all') — row data for the carpenter's document (bilingual).
 * { headers, units, materials, hardware, worktops, appliances, questions }. Codes match the drawings (run code · unit code).
 */
import { view } from './state.js';
import { VOCAB, vocab } from './spec.js';
import { takeoff } from './takeoff.js';
import { MODULES } from './modules.js';
import { geometryOf, unitsOf as unitsOfRun } from './layout.js';
import { listFeatures } from './features.js';

const L = (en, he) => ({ en, he });
const n0 = (v) => (Number.isInteger(Math.round(v * 10) / 10) ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1));
const join = (parts) => L(parts.map((p) => p.en).join(', '), parts.map((p) => p.he).join(', '));

export const HEADERS = {
  units: [['ref', L('Code', 'קוד')], ['module', L('Unit', 'יחידה')], ['size', L('W × H × D (cm)', 'ר × ג × ע (ס״מ)')], ['fronts', L('Fronts', 'חזיתות')], ['internals', L('Internals', 'פנים')], ['hardware', L('Hardware', 'פרזול')], ['notes', L('Notes', 'הערות')]],
  materials: [['run', L('Run', 'קו')], ['element', L('Element', 'רכיב')], ['material', L('Material', 'חומר')], ['thickness', L('Thickness', 'עובי')], ['colour', L('Colour', 'גוון')], ['finish', L('Finish / edge', 'גימור / קנט')]],
  hardware: [['item', L('Item', 'פריט')], ['spec', L('Specification', 'מפרט')], ['qty', L('Qty', 'כמות')], ['unit', L('Unit', 'יחידה')]],
  worktops: [['ref', L('Piece', 'חלק')], ['material', L('Material', 'חומר')], ['thickness', L('Thickness (mm)', 'עובי (מ״מ)')], ['size', L('Length × depth (cm)', 'אורך × עומק (ס״מ)')], ['cutouts', L('Cut-outs', 'חיתוכים')], ['edges', L('Edges', 'קנטים')], ['area', L('Area (m²)', 'שטח (מ״ר)')]],
  appliances: [['ref', L('Unit', 'יחידה')], ['appliance', L('Appliance', 'מכשיר')], ['make', L('Make / model', 'יצרן / דגם')], ['niche', L('Niche W × H (cm)', 'נישה ר × ג (ס״מ)')]],
  questions: [['topic', L('Topic', 'נושא')], ['text', L('Question / to verify', 'שאלה / לבדיקה')]],
  features: [['label', L('No.', 'מס׳')], ['ref', L('Code', 'קוד')], ['title', L('Special requirement', 'דרישה מיוחדת')], ['text', L('Description (owner\'s words)', 'תיאור (במילות הבעלים)')], ['category', L('Category', 'קטגוריה')], ['priority', L('Priority', 'עדיפות')]],
};
const UNIT_L = { unit: L('pcs', 'יח׳'), m: L('m', 'מ׳'), m2: L('m²', 'מ״ר') };

function frontsSummary(u) {
  const c = {};
  for (const f of u.fronts) {
    const k = f.part.en;
    c[k] = c[k] || { n: 0, part: f.part };
    c[k].n += f.qty;
  }
  const parts = Object.values(c).map(({ n, part }) => L(`${n} × ${part.en.toLowerCase()}`, `${n} × ${part.he}`));
  return parts.length ? join(parts) : L('—', '—');
}
function internalsSummary(u) {
  const c = {};
  const name = { Shelf: L('shelf', 'מדף'), 'Glass shelf': L('glass shelf', 'מדף זכוכית'), 'Shoe shelf': L('shoe shelf', 'מדף נעליים'), Divider: L('divider', 'מחיצה'), 'Internal drawer front': L('internal drawer', 'מגירה פנימית') };
  for (const p of u.panels) if (name[p.part.en]) { c[p.part.en] = (c[p.part.en] || 0) + p.qty; }
  const parts = Object.entries(c).map(([k, n]) => L(`${n} × ${name[k].en}`, `${n} × ${name[k].he}`));
  for (const h of u.hardware) if (['rail', 'pullout', 'larder', 'trouser-rack'].includes(h.kind)) parts.push(L(`${h.qty} × ${h.label.en.toLowerCase()}${h.variant ? ' (' + h.variant + ')' : ''}`, `${h.qty} × ${h.label.he}${h.variant ? ' (' + h.variant + ')' : ''}`));
  return parts.length ? join(parts) : L('—', '—');
}
function hardwareSummary(u) {
  const parts = u.hardware.filter((h) => !['rail', 'pullout', 'larder', 'trouser-rack', 'shelf-support', 'rail-support'].includes(h.kind))
    .map((h) => L(`${h.qty}${h.unit === 'm' ? ' m' : ' ×'} ${h.label.en.toLowerCase()}${h.length ? ' ' + h.length + ' mm' : ''}`, `${h.qty}${h.unit === 'm' ? ' מ׳' : ' ×'} ${h.label.he}${h.length ? ' ' + h.length + ' מ״מ' : ''}`));
  return parts.length ? join(parts) : L('—', '—');
}

function questionsFor(run, rt, v) {
  const q = [], add = (topic, en, he) => q.push({ runId: run.id, run: run.code, topic, text: L(en, he) });
  const T = { site: L('Site measurement', 'מדידה באתר'), app: L('Appliances', 'מכשירים'), mep: L('Plumbing / electrical', 'אינסטלציה / חשמל'), wt: L('Worktop', 'משטח'), hw: L('Hardware', 'פרזול'), design: L('Design', 'תכנון') };
  add(T.site, `Verify the ${run.length} cm run length on site (walls are rarely square) — carcasses are made 3–5 mm under the measured size and fillers are scribed on site.`, `לאמת באתר את אורך הקו ${run.length} ס״מ (הקירות לרוב אינם בזווית ישרה) — הגופים מיוצרים 3–5 מ״מ פחות מהמידה ופילרים מותאמים באתר.`);
  const full = rt.units.some((u) => u.level === 'full' || u.level === 'tall');
  if (full) add(T.site, 'Measure the ceiling height at both ends (designed to 300 cm) for the top line / top boxes; allow a scribed ceiling filler.', 'למדוד גובה תקרה בשני הקצוות (תוכנן ל-300 ס״מ) לקו העליון / לבוידעם; להשאיר פילר תקרה להתאמה.');
  add(T.site, 'Check the floor level along the run: adjustable legs take ±1.5 cm; tiles / skirting may need the plinth to be scribed.', 'לבדוק פילוס רצפה לאורך הקו: רגליות מתכווננות ±1.5 ס״מ; ייתכן שיידרש התאמת צוקל לריצוף / לפאנל.');
  for (const a of rt.appliances) if (!a.model) add(T.app, `${a.unit}: confirm the ${a.label.en.toLowerCase()} make / model — the niche is drawn ${n0(a.niche ? a.niche.w : 60)} × ${n0(a.niche ? a.niche.h : 0)} cm.`, `${a.unit}: לאשר יצרן / דגם ל${a.label.he} — הנישה שורטטה ${n0(a.niche ? a.niche.w : 60)} × ${n0(a.niche ? a.niche.h : 0)} ס״מ.`);
  const cut = rt.worktops.flatMap((p) => p.cutouts.map((c) => ({ ...c, piece: p.id })));
  for (const c of cut) add(T.wt, `${c.piece}: ${c.kind} cut-out drawn ${n0(c.w)} × ${n0(c.d)} cm — confirm against the ${c.kind === 'hob' ? 'hob installation sheet' : 'sink / basin template'} (${c.kind === 'sink' ? 'undermount or inset, tap hole' : 'gas or induction'}).`,
    `${c.piece}: חיתוך ל${{ sink: 'כיור', hob: 'כיריים', basin: 'כיור רחצה' }[c.kind]} שורטט ${n0(c.w)} × ${n0(c.d)} ס״מ — לאשר מול ${c.kind === 'hob' ? 'דף ההתקנה של הכיריים' : 'שבלונת הכיור'} (${c.kind === 'sink' ? 'שקוע מתחת / מונח, חור לברז' : 'גז או אינדוקציה'}).`);
  if (rt.worktops.length) add(T.wt, 'The worktop is templated on site after the carcasses are installed and levelled; confirm edge profile, joints and upstand / splashback.', 'המשטח נמדד בשבלונה באתר לאחר התקנת הגופים ופילוסם; לאשר פרופיל קנט, תפרים והגבהה / חיפוי.');
  if (run.kind === 'kitchen' || run.kind === 'island') add(T.mep, 'Mark water, drain, gas / 32 A hob supply, oven, dishwasher, hood duct and socket positions on the elevation before production.', 'לסמן על החזית נקודות מים, ניקוז, גז / הזנת כיריים 32A, תנור, מדיח, יציאת קולט ושקעים לפני הייצור.');
  if (run.spec.lighting.underWall && rt.lighting.underWallM) add(T.mep, `LED under the wall units (${rt.lighting.underWallM} m): driver location and switching.`, `תאורת LED מתחת לארונות העליונים (${rt.lighting.underWallM} מ׳): מיקום שנאי והפעלה.`);
  add(T.hw, `Confirm hardware brand / series (${vocab('hardwareGrade', run.spec.hardware.grade).en.toLowerCase()}), handle model and length (${run.spec.handles.length} cm) and finish.`, `לאשר מותג / סדרת פרזול (${vocab('hardwareGrade', run.spec.hardware.grade).he}), דגם ידית, אורך (${run.spec.handles.length} ס״מ) וגימור.`);
  if (rt.units.some((u) => u.module === 'base-corner-blind')) add(T.design, 'Corner: confirm the corner solution (blind with LeMans / magic corner, or carousel) and the corner filler.', 'פינה: לאשר פתרון פינה (עיוורת עם לה-מאן / מג׳יק קורנר, או קרוסלה) ואת פילר הפינה.');
  if (rt.units.some((u) => u.level === 'full')) add(T.design, 'Wardrobes: confirm the internal layout of every bay (rails, shelves, drawers) and whether the carcass sides are visible.', 'ארונות בגדים: לאשר חלוקה פנימית בכל תא (מוטות, מדפים, מגירות) והאם דפנות הגוף גלויות.');
  if (run.roomId === 'mamad') add(T.design, 'Safe room: confirm fixing method allowed (Home Front Command) — free-standing units recommended.', 'ממ״ד: לאשר שיטת קיבוע מותרת (פיקוד העורף) — מומלצים גופים עומדים.');
  return q;
}

/** Schedules for one run or 'all'. `src` = optional { carpentry, items }. */
export function schedules(runId = 'all', src) {
  const v = view(src), t = takeoff(runId, src);
  const units = [], materials = [], worktops = [], appliances = [], questions = [], features = [];
  for (const rt of t.runs) {
    const run = v.run(rt.runId), S = run.spec;
    for (const u of rt.units) {
      const m = MODULES[u.module];
      if (m.virtual && !u.appliances.length) continue;
      const item = v.item(u.unitId), g = item ? geometryOf(run, item) : null;
      const ops = g ? [...new Set([...(g.trueFronts || g.fronts)].map((f) => f.operation).filter(Boolean))] : [];
      const operation = ops.length ? join(ops.map((o) => vocab('doorOperation', o))) : null;
      const cells = g && g.mod.id === 'custom' && item.carp.internals && item.carp.internals.layout
        ? join(item.carp.internals.layout.columns.map((col, i) => L(`col ${i + 1}: ${col.cells.map((c) => (c.count ? c.count + '× ' : '') + vocab('cellKind', c.kind).en.toLowerCase() + (c.operation ? ' (' + vocab('doorOperation', c.operation).en.toLowerCase() + ')' : '')).join(' / ')}`,
          `עמודה ${i + 1}: ${col.cells.map((c) => (c.count ? c.count + '× ' : '') + vocab('cellKind', c.kind).he + (c.operation ? ' (' + vocab('doorOperation', c.operation).he + ')' : '')).join(' / ')}`))) : null;
      const corner = g && g.corner ? L(`${vocab('cornerPantry', g.corner.variant).en}; legs ${g.corner.legA} × ${g.corner.legB} cm`, `${vocab('cornerPantry', g.corner.variant).he}; זרועות ${g.corner.legA} × ${g.corner.legB} ס״מ`) : null;
      units.push({ runId: rt.runId, run: rt.code, code: u.code, ref: `${rt.code}·${u.code}`, unitId: u.unitId, module: u.name, level: vocab('level', u.level), operation, layout: cells, corner,
        size: { w: u.w, h: u.h, d: u.d }, sizeText: `${n0(u.w)} × ${n0(u.h)} × ${n0(u.d)}`, elev: u.elev,
        fronts: operation && ops.some((o) => o !== 'hinged') ? join([frontsSummary(u), operation]) : frontsSummary(u), internals: internalsSummary(u), hardware: hardwareSummary(u),
        notes: u.notes.length ? join(u.notes) : L(u.elev ? `Bottom at ${n0(u.elev)} cm` : '', u.elev ? `תחתית בגובה ${n0(u.elev)} ס״מ` : '') });
      for (const a of u.appliances) appliances.push({ runId: rt.runId, ref: `${rt.code}·${u.code}`, appliance: a.label, make: [a.make, a.model].filter(Boolean).join(' ') || '—', niche: a.niche ? `${n0(a.niche.w)} × ${n0(a.niche.h)}` : '—' });
    }
    for (const a of rt.appliances.filter((x) => !x.unit)) appliances.push({ runId: rt.runId, ref: rt.code, appliance: a.label, make: [a.make, a.model].filter(Boolean).join(' ') || '—', niche: '—' });
    const M = (element, material, thickness, colour, finish) => materials.push({ runId: rt.runId, run: rt.code, element, material, thickness, colour: colour || '—', finish: finish || L('—', '—') });
    M(L('Carcass', 'גוף'), vocab('carcassMaterial', S.carcass.material), `${S.carcass.thickness} mm`, S.carcass.color, vocab('edge', S.edge.carcass));
    M(L('Back panels', 'גבות'), vocab('backMaterial', S.carcass.back.material), `${S.carcass.back.thickness} mm`, S.carcass.color, null);
    M(L('Fronts', 'חזיתות'), vocab('frontMaterial', S.fronts.material), `${S.fronts.thickness} mm`, S.fronts.color, join([vocab('frontStyle', S.fronts.style), vocab('edge', S.edge.fronts)]));
    M(L('Handles', 'ידיות'), vocab('handleType', S.handles.type), S.handles.type === 'bar' ? `${S.handles.length} cm` : '—', null, vocab('finish', S.handles.finish));
    if (rt.plinth.m) M(L('Plinth', 'צוקל'), vocab('plinthFinish', S.plinth.finish), `${S.plinth.height} cm`, null, L(`set back ${S.plinth.setback} cm`, `נסיגה ${S.plinth.setback} ס״מ`));
    if (S.worktop.material !== 'none' && rt.worktops.length) M(L('Worktop', 'משטח עבודה'), vocab('worktopMaterial', S.worktop.material), `${S.worktop.thickness} mm`, S.worktop.color, vocab('worktopEdge', S.worktop.edge));
    if (rt.splashback.m2) M(L('Splashback', 'חיפוי קיר'), vocab('splashback', S.splashback.material), `${S.splashback.height} cm high`, null, null);
    M(L('Hardware grade', 'דרגת פרזול'), vocab('hardwareGrade', S.hardware.grade), '—', null, L(`${S.hardware.hinge}; ${S.hardware.drawers}`, `${S.hardware.hinge}; ${S.hardware.drawers}`));
    for (const p of rt.worktops) {
      const ends = (s) => ({ wall: L('wall', 'קיר'), polished: L('polished', 'מלוטש'), joint: L('joint', 'תפר'), butt: L('butt joint (corner)', 'תפר פינה'), tall: L('against tall unit', 'צמוד לארון גבוה'), waterfall: L('mitred to waterfall', 'מיטר לדופן נופלת'), mitre: L('mitre', 'מיטר'), floor: L('floor', 'רצפה') }[s] || L(s, s));
      worktops.push({ runId: rt.runId, ref: `${rt.code}·${p.id}`, material: vocab('worktopMaterial', p.material), thickness: p.thickness, size: { length: p.length, depth: p.depth }, sizeText: `${n0(p.length)} × ${n0(p.depth)}`,
        cutouts: p.cutouts.length ? join(p.cutouts.map((c) => L(`${c.kind} ${n0(c.w)}×${n0(c.d)} @ ${n0(c.x)} from left, ${n0(c.fromFront)} from front`, `${{ sink: 'כיור', hob: 'כיריים', basin: 'כיור רחצה' }[c.kind]} ${n0(c.w)}×${n0(c.d)} ב-${n0(c.x)} משמאל, ${n0(c.fromFront)} מהחזית`))) : L('—', '—'),
        edges: L(`left: ${ends(p.ends.left).en}; right: ${ends(p.ends.right).en}; polished ${p.polishedM} m${p.upstandM ? `; upstand ${p.upstandM} m` : ''}`, `שמאל: ${ends(p.ends.left).he}; ימין: ${ends(p.ends.right).he}; קנט מלוטש ${p.polishedM} מ׳${p.upstandM ? `; הגבהה ${p.upstandM} מ׳` : ''}`),
        area: p.areaM2, waterfall: !!p.waterfall });
    }
    questions.push(...questionsFor(run, rt, v));
    for (const f of listFeatures(run.id, src)) {
      features.push({ runId: run.id, unitId: f.unitId, featureId: f.id, n: f.n, label: f.label, ref: f.ref, code: f.code, title: f.title, text: f.text,
        category: vocab('featureCategory', f.category), priority: f.priority ? (f.priority === 'must' ? L('Must', 'חובה') : L('Nice to have', 'רצוי')) : L('—', '—'), images: (f.images || []).length });
      if (f.priority === 'must') questions.push({ runId: run.id, run: run.code, topic: L('Special requirement', 'דרישה מיוחדת'),
        text: L(`Please confirm how you would build ${f.label} ${f.ref} "${f.title}": ${f.text}`, `נא לאשר כיצד תבצע את ${f.label} ${f.ref} "${f.title}": ${f.text}`), featureId: f.id });
    }
    for (const u of unitsOfRun(run, v).filter((x) => x.carp.module === 'custom')) questions.push({ runId: run.id, run: run.code, topic: L('Bespoke unit', 'יחידה בהתאמה אישית'),
      text: L(`${rt.units.find((q) => q.unitId === u.id).code}: confirm construction, divisions and fittings of the bespoke layout.`, `${rt.units.find((q) => q.unitId === u.id).code}: לאשר אופן בנייה, חלוקה ופרזול של היחידה בהתאמה אישית.`) });
  }
  const hardware = t.totals.hardware.map((h) => ({ specifiedByCarpenter: !!h.specifiedByCarpenter, item: h.label, spec: L([h.variant, h.length ? h.length + ' mm' : null, h.grade ? vocab('hardwareGrade', h.grade).en : null].filter(Boolean).join(', ') || '—', [h.variant, h.length ? h.length + ' מ״מ' : null, h.grade ? vocab('hardwareGrade', h.grade).he : null].filter(Boolean).join(', ') || '—'), qty: h.qty, unit: UNIT_L[h.unit] || UNIT_L.unit, kind: h.kind }));
  return { headers: HEADERS, units, materials, hardware, worktops, appliances, questions, features, totals: t.totals, runKinds: VOCAB.runKind };
}
