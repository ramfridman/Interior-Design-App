/**
 * checkRun(runId | 'all') — professional kitchen / wardrobe design rules → findings
 *   { severity: 'error' | 'warning' | 'info', code, text: { en, he }, unitIds: string[], runId }.
 * Errors = cannot be built / installed as drawn; warnings = against best practice; info = notes for the designer.
 */
import { PLAN } from '../core/plan.js';
import { itemAABB, openingHinge } from '../core/geometry.js';
import { view } from './state.js';
import { RULES } from './spec.js';
import { unitsOf, positions, geometryOf, unitCodes, isFloorLevel } from './layout.js';
import { spanOfRun, openingConflicts, toPlan, frame } from './walls.js';
import { computeWorktops } from './worktop.js';
import { validateCustomLayout } from './bespoke.js';
import { circled } from './features.js';

const L = (en, he) => ({ en, he });
const r1 = (v) => Math.round(v * 10) / 10;
const NOT_CLASHING = new Set(['chair', 'bar-stool', 'office-chair', 'rug', 'cooktop', 'sink', 'microwave', 'hood', 'tv', 'mirror', 'towel-rail', 'surface', 'ceiling-light', 'pendant', 'spotlight', 'plant', 'table-lamp', 'decor', 'art', 'curtain']);

/** Gather the laid-out units of a run with their geometry. */
export function runContext(run, v = view()) {
  const units = unitsOf(run, v), pos = positions(run, units), codes = unitCodes(run, units);
  const list = units.map((u) => {
    const g = geometryOf(run, u), p = pos.get(u.id);
    return { u, id: u.id, g, mod: g.mod, level: p.level, at: p.at, w: u.carp.width, end: r1(p.at + u.carp.width), elev: g.elev, h: g.h, top: g.elev + g.h, code: codes.get(u.id), virtual: !!g.mod.virtual };
  });
  return { run, units, list, codes, span: spanOfRun(run) };
}

function findingsFor(run, v) {
  const out = [], ctx = runContext(run, v), { list, span } = ctx, spec = run.spec;
  const add = (severity, code, en, he, units = []) => out.push({ severity, code, text: L(en, he), unitIds: units.map((x) => x.id || x), runId: run.id });
  const floor = list.filter((x) => isFloorLevel(x.level)).sort((a, b) => a.at - b.at), wall = list.filter((x) => !isFloorLevel(x.level)).sort((a, b) => a.at - b.at);
  const C = (x) => x.code;
  const ceiling = PLAN.heights.ceiling || 300;

  // ── sizes and fit ──
  for (const row of [['floor', floor], ['wall', wall]]) {
    const [name, items] = row;
    if (!items.length) continue;
    const ext = Math.max(...items.map((x) => x.end)), lim = name === 'floor' ? run.length - ((run.reserved && run.reserved.right) || 0) : run.length;
    if (ext > lim + 0.05) add('error', 'overflow', `${name === 'floor' ? 'Base / tall' : 'Wall'} units run ${r1(ext - lim)} cm past the end of the run (${r1(lim)} cm${lim < run.length ? ' before the corner unit of the other arm' : ''}).`, `${name === 'floor' ? 'הארונות התחתונים / הגבוהים' : 'הארונות העליונים'} חורגים ב-${r1(ext - lim)} ס״מ מאורך הקו (${r1(lim)} ס״מ${lim < run.length ? ' עד ארון הפינה של הזרוע השנייה' : ''}).`, items.filter((x) => x.end > lim + 0.05));
    if (name === 'floor' && ext < lim - 0.5) add('warning', 'underfill', `${r1(lim - ext)} cm of the run are not filled — fit the run (fillers or wider units).`, `${r1(run.length - ext)} ס״מ בקו לא מנוצלים — יש להתאים (פילרים או הרחבת ארונות).`);
  }
  for (const x of list) {
    if (x.w < x.mod.w.min - 0.01 || x.w > x.mod.w.max + 0.01) add('error', 'width-range', `${C(x)}: ${x.w} cm is outside the ${x.mod.name.en.toLowerCase()} range ${x.mod.w.min}–${x.mod.w.max} cm.`, `${C(x)}: רוחב ${x.w} ס״מ מחוץ לטווח ${x.mod.w.min}–${x.mod.w.max} ס״מ (${x.mod.name.he}).`, [x]);
    if (x.top > ceiling + 0.01) add('error', 'above-ceiling', `${C(x)} reaches ${r1(x.top)} cm — above the ${ceiling} cm ceiling.`, `${C(x)} מגיע ל-${r1(x.top)} ס״מ — מעל התקרה (${ceiling} ס״מ).`, [x]);
  }

  // ── wall and openings ──
  if (!run.freeStanding && run.kind !== 'island') {
    if (!span) add('warning', 'no-wall', 'The run is not against a wall face of the current plan.', 'קו הארונות אינו צמוד לקיר בתוכנית הנוכחית.');
    else {
      if (span.runFrom < -0.5 || span.runTo > span.length + 0.5) add('error', 'outside-wall', `The run (${run.length} cm) is longer than the free wall (${r1(span.length)} cm).`, `אורך הקו (${run.length} ס״מ) ארוך מהקיר הפנוי (${r1(span.length)} ס״מ).`);
      for (const c of openingConflicts(run, list.map((x) => ({ id: x.id, level: x.level, at: x.at, w: x.w, elev: x.elev, h: x.h, virtual: x.virtual })), span)) {
        const x = list.find((y) => y.id === c.unitId), o = c.opening;
        if (c.code === 'door-crossing') add('error', 'door-crossing', `${C(x)} blocks the doorway ${o.id}.`, `${C(x)} חוסם את הפתח ${o.id}.`, [x]);
        else if (c.code === 'window-base') add('error', 'window-base', `${C(x)}: worktop at ${r1(x.top)} cm is above the window sill (${o.sill} cm) of ${o.id}.`, `${C(x)}: גובה המשטח ${r1(x.top)} ס״מ מעל אדן החלון ${o.id} (${o.sill} ס״מ).`, [x]);
        else add('error', c.code, `${C(x)} covers the window ${o.id} (${o.sill}–${o.top} cm).`, `${C(x)} מסתיר את החלון ${o.id} (${o.sill}–${o.top} ס״מ).`, [x]);
      }
    }
  }
  if (run.roomId === 'mamad') add('warning', 'mamad', 'Safe room (mamad): do not anchor carpentry into the reinforced walls or block the blast door / window; use free-standing carcasses and confirm with the Home Front Command guidelines.', 'ממ״ד: אין לעגן נגרות לקירות המחוזקים ואין לחסום את הדלת / החלון ההדפיים; יש להשתמש בגופים עומדים ולוודא מול הנחיות פיקוד העורף.');

  // ── ends: fillers and panels ──
  const handleless = ['none', 'push'].includes(spec.handles.type) || ['j-profile', 'gola'].includes(spec.fronts.style);
  const needFill = handleless ? RULES.fillerAtWallHandleless : RULES.fillerAtWall;
  const opens = (x) => x && x.g.fronts.some((f) => ['door', 'drawer', 'flap', 'glass', 'mirror'].includes(f.kind) || (f.kind === 'appliance' && f.panel));
  for (const side of ['left', 'right']) {
    const e = run.ends && run.ends[side], t = e && e.type;
    for (const row of [floor, wall]) {
      if (!row.length) continue;
      const endU = side === 'left' ? row[0] : row[row.length - 1];
      const touches = side === 'left' ? endU.at < 0.5 : endU.end > run.length - 0.5;
      if (!touches) continue;
      if ((t === 'wall' || t === 'run') && opens(endU) && !endU.mod.corner && !['filler', 'panel'].includes(endU.mod.id) && !['shelving', 'desk', 'media', 'vanity'].includes(run.kind)) {
        add('warning', t === 'run' ? 'corner-filler' : 'wall-filler', `${C(endU)} opens against ${t === 'run' ? 'the corner' : 'a wall'} — add a ${needFill} cm filler so doors / drawers clear the ${t === 'run' ? 'other run\'s fronts and handles' : 'wall and handles'}.`,
          `${C(endU)} נפתח מול ${t === 'run' ? 'הפינה' : 'קיר'} — יש להוסיף פילר ${needFill} ס״מ כדי שהדלתות / המגירות לא יפגעו ב${t === 'run' ? 'חזיתות ובידיות של הקו השני' : 'קיר ובידיות'}.`, [endU]);
      }
      if (t === 'open' && ['kitchen', 'pantry'].includes(run.kind) && row === floor && spec.endPanels && !['panel', 'filler'].includes(endU.mod.id) && !endU.virtual) {
        add('info', 'end-panel', `${C(endU)} is the open end of the run — a finished end panel is recommended.`, `${C(endU)} בקצה פתוח של הקו — מומלץ פאנל צד גמור.`, [endU]);
      }
    }
  }

  // ── corners ──
  for (const x of list.filter((y) => y.mod.corner)) {
    const blindDoor = x.g.fronts.filter((f) => f.kind === 'door').reduce((s, f) => s + f.w, 0);
    const k = (x.u.carp.internals && x.u.carp.internals.corner) || 'none';
    if (x.mod.id === 'base-corner-blind' && blindDoor < 30) add('warning', 'corner-dead', `${C(x)} is a ${x.w} cm corner box with no usable door (dead corner). Widen it into the next unit to 100–120 cm (blind 60 + door 40–55) with a LeMans / magic-corner pull-out, or use an L-corner carousel unit.`,
      `${C(x)} הוא ארון פינה ברוחב ${x.w} ס״מ ללא דלת שמישה (פינה מתה). יש להרחיב לתוך הארון הסמוך ל-100–120 ס״מ (60 עיוור + דלת 40–55) עם מנגנון LeMans / Magic Corner, או ארון פינה L עם קרוסלה.`, [x]);
    else if (k === 'none' || k === 'shelf') add('info', 'corner-access', `${C(x)}: a corner fitting (LeMans / magic corner) makes the blind corner usable.`, `${C(x)}: מנגנון פינה (LeMans / Magic Corner) הופך את הפינה העיוורת לשמישה.`, [x]);
  }

  // ── corner modules spanning both arms ──
  for (const x of list.filter((y) => y.g.corner)) {
    const k = x.g.corner, op = (x.u.carp.fronts && x.u.carp.fronts.operation) || 'hinged', side = k.side === 'L' ? 'left' : 'right';
    const atEnd = k.side === 'L' ? x.at < (run.reserved ? run.reserved.left : 0) + 0.5 : x.end > run.length - 0.5;
    const e = run.ends && run.ends[side];
    if (!atEnd || !e || e.type === 'open') add('warning', 'corner-placement', `${C(x)} is a corner unit but is not at a corner end of the run (set cornerSide and put it first / last at a wall or linked end).`, `${C(x)} הוא ארון פינה אך אינו בקצה פינתי של הקו (יש לקבוע צד פינה ולמקם ראשון / אחרון ליד קיר או קו מחובר).`, [x]);
    if (e && e.type === 'run') add('warning', 'corner-owner', `${C(x)} sits on the run that butts into ${(v.run(e.runId) || {}).code || 'the other run'} — put corner units on the run that goes through the corner.`, `${C(x)} נמצא בקו שנצמד ל-${(v.run(e.runId) || {}).code || 'קו אחר'} — יש למקם ארונות פינה בקו העובר דרך הפינה.`, [x]);
    if (k.variant === 'l-doors' && op === 'hinged') add('warning', 'corner-pantry-doors', `${C(x)}: hinged doors meeting at the inside corner without a post clash when opened — use removable, bi-fold or sliding doors, or add a corner post.`, `${C(x)}: דלתות ציר הנפגשות בפינה הפנימית ללא עמוד מתנגשות בפתיחה — להשתמש בדלתות נשלפות, אקורדיון או הזזה, או להוסיף עמוד פינה.`, [x]);
    for (const f of k.faces) {
      const need = k.variant === 'l-doors' ? RULES.cornerPantryAccess : RULES.diagonalDoorMin;
      if (f.len < need) add('warning', 'corner-pantry-access', `${C(x)}: the ${f.id === 'diag' ? 'diagonal' : f.id === 'A' ? 'front' : 'return'} opening is only ${r1(f.len)} cm — at least ${need} cm for access; lengthen the legs.`, `${C(x)}: הפתח ${f.id === 'diag' ? 'האלכסוני' : f.id === 'A' ? 'הקדמי' : 'הצדדי'} רק ${r1(f.len)} ס״מ — נדרש לפחות ${need} ס״מ לגישה; יש להאריך את הזרועות.`, [x]);
    }
    if (k.variant === 'walk-in' && Math.min(k.legA, k.legB) < RULES.walkInLegMin) add('warning', 'corner-pantry-access', `${C(x)}: a walk-in corner pantry needs legs ≥ ${RULES.walkInLegMin} cm to step in (here ${k.legA} × ${k.legB}).`, `${C(x)}: מזווה פינתי נכנס דורש זרועות ≥ ${RULES.walkInLegMin} ס״מ כדי להיכנס (כאן ${k.legA} × ${k.legB}).`, [x]);
  }
  if (run.reserved) for (const side of ['left', 'right']) {
    const b = run.reserved.by[side];
    if (!b) continue;
    const owner = v.run(b.runId), cu = v.item(b.unitId);
    if (!owner || !cu) continue;
    const bb = itemAABB(cu);
    const hits = list.filter((x) => { if (x.virtual) return false; const a = itemAABB(x.u); return a.x < bb.x + bb.w - 0.5 && bb.x < a.x + a.w - 0.5 && a.y < bb.y + bb.h - 0.5 && bb.y < a.y + a.h - 0.5 && (x.level !== 'wall' || b.level !== 'base'); });
    if (hits.length) add('error', 'corner-overlap', `${hits.map(C).join(', ')} overlap the corner unit of ${owner.code} — fit the run.`, `${hits.map(C).join(', ')} חופפים לארון הפינה של ${owner.code} — יש להתאים את הקו.`, hits);
  }
  // ── bespoke units and special requirements ──
  for (const x of list.filter((y) => y.mod.id === 'custom')) {
    const lay = x.u.carp.internals && x.u.carp.internals.layout;
    const errs = lay ? validateCustomLayout(lay, x.w, x.g.zone.y1 - x.g.zone.y0) : [];
    for (const e of errs) add('error', 'custom-layout', `${C(x)}: ${e.en}`, `${C(x)}: ${e.he}`, [x]);
    add('info', 'bespoke', `${C(x)} is a bespoke unit — only sizes and openings are checked automatically; review its construction with the carpenter.`, `${C(x)} היא יחידה בהתאמה אישית — נבדקים אוטומטית רק מידות ופתחים; יש לעבור על אופן הבנייה עם הנגר.`, [x]);
  }
  for (const f of [...(run.features || []).map((q) => ({ f: q, x: null })), ...list.flatMap((x) => (x.u.carp.features || []).map((q) => ({ f: q, x })))]) {
    add('info', 'feature', `Special requirement ${circled(f.f.n)} "${f.f.title}"${f.x ? ` on ${C(f.x)}` : ''} has no automatic rule checks — the carpenter confirms it.`, `דרישה מיוחדת ${circled(f.f.n)} "${f.f.title}"${f.x ? ` ב-${C(f.x)}` : ''} אינה נבדקת אוטומטית — הנגר מאשר אותה.`, f.x ? [f.x] : []);
  }

  // ── kitchen working rules ──
  const pieces = run.worktops && run.worktops.length ? run.worktops : computeWorktops(run, ctx.units);
  const segOf = (x) => pieces.filter((p) => !p.waterfall).reduce((seg, p) => (x.at >= p.s - 0.5 && x.end <= p.e + 0.5 ? p : seg), null);
  const contig = (x) => {                                         // whole contiguous worktop stretch around x
    const ps = pieces.filter((p) => !p.waterfall).sort((a, b) => a.s - b.s), i = ps.findIndex((p) => x.at >= p.s - 0.5 && x.end <= p.e + 0.5);
    if (i < 0) return null;
    let s = ps[i].s, e = ps[i].e;
    for (let j = i - 1; j >= 0 && Math.abs(ps[j].e - s) < 0.5; j--) s = ps[j].s;
    for (let j = i + 1; j < ps.length && Math.abs(ps[j].s - e) < 0.5; j++) e = ps[j].e;
    return { s, e };
  };
  const hobs = list.filter((x) => x.mod.cutout === 'hob' || (x.mod.id === 'island' && x.u.carp.hob));
  const sinks = list.filter((x) => x.mod.cutout === 'sink' || (x.mod.id === 'island' && x.u.carp.sink));
  const talls = list.filter((x) => (x.level === 'tall' || x.level === 'full') && !['filler', 'panel'].includes(x.mod.id));
  for (const hb of hobs) {
    for (const tl of talls) {
      const gap = tl.at >= hb.end ? tl.at - hb.end : hb.at - tl.end;
      if (gap < RULES.hobToTall) add(gap < RULES.hobToTallMin ? 'warning' : 'info', 'hob-tall', `Hob ${C(hb)} is ${r1(Math.max(0, gap))} cm from the tall unit ${C(tl)} — keep ≥ ${RULES.hobToTall} cm of worktop between them (heat, pan handles).`,
        `הכיריים ${C(hb)} במרחק ${r1(Math.max(0, gap))} ס״מ מהארון הגבוה ${C(tl)} — מומלץ ≥ ${RULES.hobToTall} ס״מ משטח ביניהם (חום, ידיות סירים).`, [hb, tl]);
    }
    for (const side of ['left', 'right']) {
      const t = run.ends && run.ends[side] && run.ends[side].type, gap = side === 'left' ? hb.at : run.length - hb.end;
      if (t === 'wall' && gap < RULES.hobToTallMin) add('warning', 'hob-wall', `Hob ${C(hb)} is ${r1(gap)} cm from the side wall — keep ≥ ${RULES.hobToTallMin} cm.`, `הכיריים ${C(hb)} במרחק ${r1(gap)} ס״מ מקיר צד — מומלץ ≥ ${RULES.hobToTallMin} ס״מ.`, [hb]);
    }
    if (span) for (const o of span.openings.filter((q) => q.kind === 'window')) {
      const a = span.runFrom + hb.at, b = span.runFrom + hb.end, gap = Math.max(o.from - b, a - o.to);
      if (gap < RULES.hobToWindow) add('warning', 'hob-window', `Hob ${C(hb)} is ${gap <= 0 ? 'under' : r1(gap) + ' cm from'} the window ${o.id} — wind blows out gas flames, curtains are a fire risk and no wall hood can be fitted; move the hob ≥ ${RULES.hobToWindow} cm from the window.`,
        `הכיריים ${C(hb)} ${gap <= 0 ? 'מתחת ל' : 'במרחק ' + r1(gap) + ' ס״מ מ'}חלון ${o.id} — רוח מכבה להבת גז, וילון מהווה סכנת אש ולא ניתן להתקין קולט; יש להרחיק ≥ ${RULES.hobToWindow} ס״מ מהחלון.`, [hb]);
    }
    const st = contig(hb);
    if (st) {
      const l = hb.at - st.s, r = st.e - hb.end;
      if (Math.min(l, r) < RULES.hobLanding) add('warning', 'hob-landing', `Hob ${C(hb)}: ${r1(l)} cm of worktop on the left and ${r1(r)} cm on the right — keep ≥ ${RULES.hobLanding} cm on both sides.`, `כיריים ${C(hb)}: ${r1(l)} ס״מ משטח משמאל ו-${r1(r)} ס״מ מימין — מומלץ ≥ ${RULES.hobLanding} ס״מ בכל צד.`, [hb]);
    }
    for (const w of wall) {
      if (w.virtual || w.mod.id === 'wall-hood') continue;
      if (Math.min(w.end, hb.end) - Math.max(w.at, hb.at) > 1 && w.elev - (spec.heights.worktop) < RULES.wallUnitAboveHob) add('error', 'wall-over-hob', `Wall unit ${C(w)} is only ${r1(w.elev - spec.heights.worktop)} cm above the hob ${C(hb)} — ≥ ${RULES.wallUnitAboveHob} cm (or a hood housing) is required.`,
        `הארון העליון ${C(w)} רק ${r1(w.elev - spec.heights.worktop)} ס״מ מעל הכיריים ${C(hb)} — נדרש ≥ ${RULES.wallUnitAboveHob} ס״מ (או ארון קולט).`, [w, hb]);
    }
  }
  for (const sk of sinks) {
    const st = contig(sk);
    if (st) {
      const l = sk.at - st.s, r = st.e - sk.end, big = Math.max(l, r), small = Math.min(l, r);
      if (big < RULES.sinkLanding || small < RULES.sinkLandingOther) add('warning', 'sink-landing', `Sink ${C(sk)}: ${r1(l)} / ${r1(r)} cm of worktop beside it — keep ≥ ${RULES.sinkLanding} cm on one side and ≥ ${RULES.sinkLandingOther} cm on the other.`, `כיור ${C(sk)}: ${r1(l)} / ${r1(r)} ס״מ משטח לצידו — מומלץ ≥ ${RULES.sinkLanding} ס״מ בצד אחד ו-≥ ${RULES.sinkLandingOther} ס״מ בשני.`, [sk]);
    }
    const idx = floor.indexOf(sk), nb = [floor[idx - 1], floor[idx + 1]].filter(Boolean);
    if (nb.some((y) => y.mod.corner) || idx === 0 || idx === floor.length - 1) add('warning', 'sink-corner', `Sink ${C(sk)} is at the end of the run / next to the corner — its doors clash with the corner and there is no landing space; move it ≥ one unit away.`, `הכיור ${C(sk)} בקצה הקו / ליד הפינה — הדלתות מתנגשות בפינה ואין משטח הנחה; יש להזיז לפחות ארון אחד.`, [sk]);
    for (const hb of hobs) {
      const gap = hb.at >= sk.end ? hb.at - sk.end : sk.at - hb.end;
      if (gap < 80 && gap >= 0) add('info', 'prep-zone', `Only ${r1(gap)} cm of preparation worktop between the sink ${C(sk)} and the hob ${C(hb)} (80–120 cm recommended).`, `רק ${r1(gap)} ס״מ משטח הכנה בין הכיור ${C(sk)} לכיריים ${C(hb)} (מומלץ 80–120 ס״מ).`, [sk, hb]);
    }
    const dws = list.filter((y) => y.mod.id === 'base-dishwasher');
    if (run.kind === 'kitchen' && !dws.length) add('info', 'no-dishwasher', `No dishwasher next to the sink ${C(sk)} — plan a 60 cm (or 45 cm) integrated dishwasher beside it, or confirm none is wanted.`, `אין מדיח כלים ליד הכיור ${C(sk)} — יש לתכנן מדיח אינטגרלי 60 (או 45) ס״מ לצידו, או לאשר שאין צורך.`, [sk]);
    for (const dw of dws) { const gap = dw.at >= sk.end ? dw.at - sk.end : sk.at - dw.end; if (gap > 1) add('info', 'dishwasher-sink', `Dishwasher ${C(dw)} is ${r1(gap)} cm from the sink — place it right beside the sink unit (drain hose, loading).`, `המדיח ${C(dw)} במרחק ${r1(gap)} ס״מ מהכיור — מומלץ צמוד לארון הכיור (ניקוז, העמסה).`, [dw, sk]); }
  }
  for (const x of list.filter((y) => y.mod.id === 'base-dishwasher' || y.mod.id === 'base-oven')) {
    const idx = floor.indexOf(x), nb = [floor[idx - 1], floor[idx + 1]].filter(Boolean);
    const atLinked = (idx === 0 && run.ends.left.type === 'run') || (idx === floor.length - 1 && run.ends.right.type === 'run');
    if (nb.some((y) => y.mod.corner) || atLinked) add('warning', 'appliance-door', `${C(x)}: the ${x.mod.id === 'base-oven' ? 'oven' : 'dishwasher'} door opens into the corner — keep ≥ 10 cm (a filler or a drawer unit) between it and the perpendicular run.`, `${C(x)}: דלת ה${x.mod.id === 'base-oven' ? 'תנור' : 'מדיח'} נפתחת לתוך הפינה — יש להשאיר ≥ 10 ס״מ (פילר או ארון מגירות) מהקו הניצב.`, [x]);
  }
  for (const nf of list.filter((y) => y.mod.id === 'tall-fridge-niche')) {
    const fw = (nf.u.carp.appliance && nf.u.carp.appliance.w) || 91;
    if (nf.w < fw + 4) add('warning', 'fridge-niche', `Fridge niche ${C(nf)} is ${nf.w} cm for a ${fw} cm fridge — allow ≥ 2 cm each side for ventilation and door opening.`, `נישת המקרר ${C(nf)} ברוחב ${nf.w} ס״מ למקרר ${fw} ס״מ — יש להשאיר ≥ 2 ס״מ מכל צד לאוורור ולפתיחת הדלת.`, [nf]);
    const idx = floor.indexOf(nf), nb = [floor[idx - 1], floor[idx + 1]].filter(Boolean);
    if (!nb.some((y) => segOf(y))) add('info', 'fridge-landing', `No worktop beside the fridge ${C(nf)} — keep a landing area ≥ ${RULES.fridgeLanding} cm within reach (e.g. the island).`, `אין משטח ליד המקרר ${C(nf)} — מומלץ משטח הנחה ≥ ${RULES.fridgeLanding} ס״מ בהישג יד (למשל האי).`, [nf]);
  }

  // ── worktop ──
  for (const p of pieces) {
    if (p.overSlab) add('error', 'slab-length', `Worktop ${p.id} is ${p.length} cm — longer than the ${spec.worktop.maxSlab} cm slab.`, `משטח ${p.id} באורך ${p.length} ס״מ — ארוך מהלוח (${spec.worktop.maxSlab} ס״מ).`);
    if (p.jointWarning) add('warning', 'joint-cutout', `Worktop joint near a cut-out on ${p.id} — keep joints ≥ ${RULES.jointClearOfCutout} cm from the sink / hob.`, `תפר במשטח ${p.id} קרוב לחיתוך — יש להרחיק תפרים ≥ ${RULES.jointClearOfCutout} ס״מ מהכיור / הכיריים.`);
  }
  const joints = pieces.filter((p) => p.ends.left === 'joint').map((p) => p.s);
  if (joints.length) add('info', 'worktop-joints', `Worktop joints at ${joints.map((j) => j + ' cm').join(', ')} from the left end (slab ≤ ${spec.worktop.maxSlab} cm).`, `תפרי משטח ב-${joints.map((j) => j + ' ס״מ').join(', ')} מהקצה השמאלי (לוח ≤ ${spec.worktop.maxSlab} ס״מ).`);
  if (run.kind === 'island') {
    const ov = spec.worktop.overhangSeat || 0, lim = RULES.islandOverhangUnsupported[spec.worktop.thickness] ?? 30;
    if (ov > lim) add('warning', 'overhang-support', `Seating overhang ${ov} cm exceeds ${lim} cm for a ${spec.worktop.thickness} mm worktop — add steel brackets / a support leg.`, `בליטת ישיבה ${ov} ס״מ חורגת מ-${lim} ס״מ למשטח ${spec.worktop.thickness} מ״מ — יש להוסיף תומכי פלדה / רגל תמיכה.`);
    if (ov > 0 && ov < 25) add('info', 'overhang-knees', `Seating overhang ${ov} cm — 25–30 cm is needed for knees at counter height.`, `בליטת ישיבה ${ov} ס״מ — נדרשים 25–30 ס״מ לברכיים בגובה דלפק.`);
  }
  if ((spec.worktop.overhangEnd || 0) > RULES.endOverhangUnsupported) add('warning', 'end-overhang', `End overhang ${spec.worktop.overhangEnd} cm needs a bracket (> ${RULES.endOverhangUnsupported} cm).`, `בליטת קצה ${spec.worktop.overhangEnd} ס״מ דורשת תומך (> ${RULES.endOverhangUnsupported} ס״מ).`);

  // ── wall units ──
  for (const w of wall.filter((y) => !y.virtual && y.mod.carcass === 'wall')) {
    const above = w.elev - spec.heights.worktop;
    if (floor.some((b) => b.level === 'base' && Math.min(b.end, w.end) - Math.max(b.at, w.at) > 1) && above < RULES.wallUnitAboveWorktop) add('warning', 'wall-low', `${C(w)} is ${r1(above)} cm above the worktop — ≥ ${RULES.wallUnitAboveWorktop} cm is needed for appliances and working.`, `${C(w)} נמצא ${r1(above)} ס״מ מעל המשטח — נדרש ≥ ${RULES.wallUnitAboveWorktop} ס״מ לעבודה ולמכשירים.`, [w]);
    const topShelf = Math.max(w.elev, ...w.g.inner.filter((c) => c.kind === 'shelf').map((c) => c.y));
    if (topShelf > RULES.reachTopShelf) add('info', 'wall-reach', `${C(w)}: the top shelf is at ${r1(topShelf)} cm — reachable only with a step (≈ 190 cm comfortable).`, `${C(w)}: המדף העליון בגובה ${r1(topShelf)} ס״מ — נגיש רק עם שרפרף (נוח עד ≈ 190 ס״מ).`, [w]);
  }

  // ── wardrobes ──
  for (const x of list.filter((y) => y.level === 'full' && y.g.inner.some((c) => c.kind === 'rail'))) {
    const depth = x.g.dc;
    if (depth < RULES.hangingDepthMin) add('warning', 'hanging-depth', `${C(x)}: carcass depth ${r1(depth)} cm is too shallow for a side-on hanging rail (hangers need ≈ ${RULES.hangingDepth} cm) — use an extendable front-facing rail or shelves.`, `${C(x)}: עומק גוף ${r1(depth)} ס״מ רדוד מדי למוט תלייה רגיל (קולב צריך ≈ ${RULES.hangingDepth} ס״מ) — יש להשתמש במוט נשלף קדמי או במדפים.`, [x]);
    const rails = x.g.inner.filter((c) => c.kind === 'rail').sort((a, b) => a.y - b.y);
    const floorY = x.g.zone.y0 + x.g.t, below = (r) => Math.max(floorY, ...x.g.inner.filter((c) => (c.kind === 'shelf' || c.kind === 'rail' || c.kind === 'drawer' || c.kind === 'trouser') && c.y < r.y - 1).map((c) => c.y + (c.h || 0)));
    rails.forEach((r, i) => {
      const clear = r1(r.y - below(r)), need = RULES.shortHang;
      if (clear < need) add('warning', 'hanging-height', `${C(x)}: only ${clear} cm of hanging space under rail ${i + 1} (≥ ${need} cm for shirts, ${RULES.longHang} cm for dresses / coats).`, `${C(x)}: רק ${clear} ס״מ גובה תלייה מתחת למוט ${i + 1} (≥ ${need} ס״מ לחולצות, ${RULES.longHang} ס״מ לשמלות / מעילים).`, [x]);
    });
  }
  const sliding = list.filter((x) => x.mod.sliding);
  if (sliding.length) {
    const len = sliding.reduce((s, x) => s + x.w, 0), n = (spec.sliding && spec.sliding.doors) || Math.max(2, Math.ceil(len / 100)), dw = (len + (n - 1) * 3) / n;
    if (len < 2 * RULES.slidingDoorMin) add('error', 'sliding-min', `Sliding doors need ≥ ${2 * RULES.slidingDoorMin} cm of wardrobe (here ${r1(len)} cm).`, `דלתות הזזה דורשות ≥ ${2 * RULES.slidingDoorMin} ס״מ ארון (כאן ${r1(len)} ס״מ).`, sliding);
    else if (dw < RULES.slidingDoorMin) add('error', 'sliding-min', `Sliding doors ${r1(dw)} cm wide — the minimum is ${RULES.slidingDoorMin} cm; use fewer doors.`, `דלתות הזזה ברוחב ${r1(dw)} ס״מ — המינימום ${RULES.slidingDoorMin} ס״מ; יש להפחית את מספר הדלתות.`, sliding);
    else if (dw > RULES.slidingDoorMax) add('warning', 'sliding-max', `Sliding doors ${r1(dw)} cm wide — above ${RULES.slidingDoorMax} cm they get heavy and bow; add a door.`, `דלתות הזזה ברוחב ${r1(dw)} ס״מ — מעל ${RULES.slidingDoorMax} ס״מ הן כבדות ומתעקמות; יש להוסיף דלת.`, sliding);
  }

  // ── room: aisle, door swings, clashes ──
  const runIds = new Set(list.map((x) => x.id)), markers = new Set(list.map((x) => x.u.carp.appliance && x.u.carp.appliance.itemId).filter(Boolean));
  const others = v.items.filter((it) => !it.hidden && !runIds.has(it.id) && !markers.has(it.id) && it.zone !== 'outdoor' && !NOT_CLASHING.has(it.type) && !(it.carp && it.carp.runId === run.id));
  const linked = new Set();
  for (const r of v.runs()) for (const sd of ['left', 'right']) { const e = r.ends && r.ends[sd]; if (e && e.type === 'run') { if (r.id === run.id) linked.add(e.runId); if (e.runId === run.id) linked.add(r.id); } }
  const aisleNeed = ['kitchen', 'island'].includes(run.kind) ? RULES.aisleMin : ['wardrobe', 'entry', 'utility', 'pantry'].includes(run.kind) ? RULES.wardrobeAisle : 70;
  if (run.kind !== 'island') {
    const f = frame(run.anchor.dir);
    let worst = null;
    for (const x of floor.filter((y) => !y.virtual && !y.mod.corner)) {
      for (let s = x.at + 5; s <= x.end - 5 + 0.01; s += Math.max(5, (x.w - 10) / 2 || 5)) {
        const [px, py] = toPlan(run.anchor, s, x.g.d + 0.5);
        const dist = rayClear(px, py, f.nx, f.ny, others.filter((o) => (o.elev || 0) < 120 && o.h > 30 && !(o.carp && linked.has(o.carp.runId))), 400);
        if (dist != null && (!worst || dist.d < worst.d)) worst = { ...dist, x };
      }
    }
    if (worst && worst.d < aisleNeed) add(worst.d < aisleNeed - 15 ? 'error' : 'warning', 'aisle', `Only ${r1(worst.d)} cm clear in front of ${C(worst.x)} (to ${worst.what}) — ≥ ${aisleNeed} cm needed${run.kind === 'kitchen' ? `, ${RULES.aisleRecommended}–${RULES.aisleTwoCooks} cm recommended` : ''} to open doors and pass.`,
      `רק ${r1(worst.d)} ס״מ פנויים מול ${C(worst.x)} (עד ${worst.whatHe}) — נדרש ≥ ${aisleNeed} ס״מ${run.kind === 'kitchen' ? `, מומלץ ${RULES.aisleRecommended}–${RULES.aisleTwoCooks} ס״מ` : ''} לפתיחת דלתות ולמעבר.`, [worst.x]);
  }
  if (run.kind === 'island' || run.freeStanding) {
    // free-standing: the walkway all round (sides that reach a wall / run / furniture within 4 m)
    const sides = clearancesOf(run, v).filter((c) => c.d != null);
    const worst = sides.reduce((a, c) => (!a || c.d < a.d ? c : a), null);
    if (worst && worst.d < aisleNeed) add(worst.d < aisleNeed - 15 ? 'error' : 'warning', 'aisle', `Only ${r1(worst.d)} cm clear on the ${SIDE_NAME[worst.side].en} side of ${run.code} (to ${worst.what}) — ≥ ${aisleNeed} cm needed, ${RULES.aisleRecommended}–${RULES.aisleTwoCooks} cm recommended, to open doors and pass.`,
      `רק ${r1(worst.d)} ס״מ פנויים בצד ה${SIDE_NAME[worst.side].he} של ${run.code} (עד ${worst.whatHe}) — נדרש ≥ ${aisleNeed} ס״מ, מומלץ ${RULES.aisleRecommended}–${RULES.aisleTwoCooks} ס״מ, לפתיחת דלתות ולמעבר.`, list.filter((x) => !x.virtual));
  }
  for (const o of PLAN.openings.filter((q) => q.kind === 'door')) {
    const sw = swingRect(o);
    if (!sw) continue;
    const hits = list.filter((x) => !x.virtual && x.elev < (o.height || 210) && itemHitsSwing(x.u, sw));
    if (hits.length) add('error', 'door-swing', `The door ${o.id} swings into ${hits.map(C).join(', ')}.`, `הדלת ${o.id} נפתחת לתוך ${hits.map(C).join(', ')}.`, hits);
  }
  for (const it of others) {
    if (it.carp) continue;
    const bb = itemAABB(it), lo = it.elev || 0, hi = lo + (it.h || 0);
    const hits = list.filter((x) => { if (x.virtual) return false; const b = itemAABB(x.u); return b.x < bb.x + bb.w - 1 && bb.x < b.x + b.w - 1 && b.y < bb.y + bb.h - 1 && bb.y < b.y + b.h - 1 && x.elev < hi - 1 && lo < x.top - 1; });
    if (hits.length) add('warning', 'clash', `${it.name || it.type} overlaps ${hits.map(C).join(', ')}.`, `${it.name || it.type} חופף ל-${hits.map(C).join(', ')}.`, hits);
  }
  return out;
}

const SIDE_NAME = { n: L('north', 'צפוני'), e: L('east', 'מזרחי'), s: L('south', 'דרומי'), w: L('west', 'מערבי') };
/** Items a walkway is measured to (furniture, other runs; not rugs, chairs, lamps…), as the aisle check uses. */
function obstaclesFor(run, v) {
  const own = new Set(run.unitIds || []);
  const markers = new Set((run.unitIds || []).map((id) => { const u = v.item(id); return u && u.carp && u.carp.appliance && u.carp.appliance.itemId; }).filter(Boolean));
  return v.items.filter((it) => !it.hidden && !own.has(it.id) && !markers.has(it.id) && it.zone !== 'outdoor' && !NOT_CLASHING.has(it.type)
    && !(it.carp && it.carp.runId === run.id) && (it.elev || 0) < 120 && it.h > 30);
}
/** Plan footprint (axis-aligned box) of a run's visible units, or null. */
export function runFootprint(run, v = view()) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of run.unitIds || []) {
    const u = v.item(id);
    if (!u || u.hidden) continue;
    const b = itemAABB(u);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return x0 < x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
function clearancesOf(run, v) {
  const b = runFootprint(run, v);
  if (!b) return [];
  const obs = obstaclesFor(run, v), out = [];
  const sides = [
    ['n', 0, -1, (t) => [b.x + t * b.w, b.y - 0.5], b.w], ['s', 0, 1, (t) => [b.x + t * b.w, b.y + b.h + 0.5], b.w],
    ['w', -1, 0, (t) => [b.x - 0.5, b.y + t * b.h], b.h], ['e', 1, 0, (t) => [b.x + b.w + 0.5, b.y + t * b.h], b.h],
  ];
  for (const [side, dx, dy, at, len] of sides) {
    let best = null;
    const inset = Math.min(0.45, 5 / Math.max(len, 1));
    for (const t of [inset, 0.25, 0.5, 0.75, 1 - inset]) {
      const [px, py] = at(t), hit = rayClear(px, py, dx, dy, obs, 400);
      if (hit && (!best || hit.d < best.d)) best = { ...hit, from: [px - dx * 0.5, py - dy * 0.5], to: [px + dx * hit.d, py + dy * hit.d] };
    }
    out.push(best ? { side, d: r1(best.d + 0.5), what: best.what, whatHe: best.whatHe, from: best.from, to: best.to }
      : { side, d: null, what: 'nothing within 4 m', whatHe: 'אין מכשול בטווח 4 מ׳', from: at(0.5), to: null });
  }
  return out;
}
/**
 * Walkway clearances around a run's footprint (free-standing runs / islands): one entry per side
 * { side: 'n'|'e'|'s'|'w', d (cm, null = nothing within 4 m), what, whatHe, from [x, y], to [x, y] | null, level }
 * with level 'ok' (≥ RULES.aisleRecommended), 'tight' (≥ RULES.aisleMin) or 'short' (< RULES.aisleMin).
 */
export function runClearances(runId, src) {
  const v = view(src), run = v.run(runId);
  if (!run) return [];
  return clearancesOf(run, v).map((c) => ({ ...c, level: c.d == null || c.d >= RULES.aisleRecommended ? 'ok' : c.d >= RULES.aisleMin ? 'tight' : 'short' }));
}
/** The hinged door whose swing an item's footprint enters (plan only), or null. */
export function doorSwingHit(item) {
  for (const o of PLAN.openings) {
    if (o.kind !== 'door') continue;
    const sw = swingRect(o);
    if (sw && itemHitsSwing(item, sw)) return o;
  }
  return null;
}

/** Leaf sweep of a hinged door as { hx, hy (hinge point), r, sx, sy } in plan cm: the quadrant on the sx / sy side of the hinge. */
export function swingRect(o) {
  if (!o.swing || !o.hinge) return null;
  const h = openingHinge(o);
  return { hx: h.x, hy: h.y, r: o.width, sx: h.closed[0] + h.open[0], sy: h.closed[1] + h.open[1] };
}
function itemHitsSwing(it, sw) {
  const b = itemAABB(it);
  const qx0 = sw.sx > 0 ? sw.hx : sw.hx - sw.r, qy0 = sw.sy > 0 ? sw.hy : sw.hy - sw.r;
  const ix0 = Math.max(b.x, qx0), ix1 = Math.min(b.x + b.w, qx0 + sw.r), iy0 = Math.max(b.y, qy0), iy1 = Math.min(b.y + b.h, qy0 + sw.r);
  if (ix1 - ix0 <= 1 || iy1 - iy0 <= 1) return false;
  const nx = Math.max(ix0, Math.min(sw.hx, ix1)), ny = Math.max(iy0, Math.min(sw.hy, iy1));
  return Math.hypot(nx - sw.hx, ny - sw.hy) < sw.r - 1;
}
/**
 * Distance along the unit ray (dx, dy) from (px, py) to the near side of an axis-aligned rect (negative when the point
 * is past it or inside it), or null when the ray's line misses the rect.
 */
function rayToRect(px, py, dx, dy, r) {
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, d, lo, hi] of [[px, dx, r.x, r.x + r.w], [py, dy, r.y, r.y + r.h]]) {
    if (d === 0) { if (p < lo || p > hi) return null; continue; }
    const a = (lo - p) / d, b = (hi - p) / d;
    t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
  }
  return t1 < t0 ? null : t0;
}
/** Clear distance along a ray (unit direction) to the first wall / item. */
export function rayClear(px, py, dx, dy, items, max) {
  let best = { d: max, what: 'nothing', whatHe: 'מכשול' }, hit = false;
  const test = (r, what, whatHe) => {
    const d = rayToRect(px, py, dx, dy, r);
    if (d != null && d >= -0.5 && d < best.d) { best = { d: Math.max(0, d), what, whatHe }; hit = true; }
  };
  for (const w of PLAN.walls) test(w, 'a wall', 'קיר');
  for (const it of items) test(itemAABB(it), it.carp ? 'another run' : (it.name || it.type), it.carp ? 'קו ארונות אחר' : (it.name || it.type));
  return hit ? best : null;
}

/** Findings for one run or for all runs ('all'). `src` = optional { carpentry, items }. */
export function checkRun(runId = 'all', src) {
  const v = view(src);
  const runs = runId === 'all' ? v.runs() : [v.run(runId)].filter(Boolean);
  const order = { error: 0, warning: 1, info: 2 };
  return runs.flatMap((r) => findingsFor(r, v)).sort((a, b) => order[a.severity] - order[b.severity]);
}
