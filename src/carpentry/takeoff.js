/**
 * takeoff(runId | 'all') — the quantities a carpenter prices from. Deterministic.
 * Panel sizes are in MILLIMETRES (length = the grain / long direction as cut, width), areas in m², lengths of profiles /
 * plinths / edges / LED in metres. Construction rules (documented in docs/CONTRACT.md § 8):
 *   base carcass  : 2 sides H×D, bottom (W−2t)×D, front rail + back rail (W−2t)×100, back panel (W−4)×(H−4)
 *   wall / tall / full carcass : 2 sides H×D, top + bottom (W−2t)×D, back (W−4)×(H−4); top boxes = a second wall-type carcass
 *   shelves (W−2t−2)×(D−20), banded on the front edge; carcass edges banded on the front edge only
 *   fronts (W, H from the front layout, 3 mm gaps), banded all round; hinges 2 / 3 / 4 / 5 for doors ≤ 900 / 1600 / 2200 / more mm
 *   drawers: one box system per drawer, runner = the longest standard length ≤ D − 10 mm
 */
import { view } from './state.js';
import { MODULES, islandBays } from './modules.js';
import { RULES, vocab } from './spec.js';
import { unitsOf, positions, geometryOf, unitCodes, isFloorLevel } from './layout.js';
import { computeWorktops } from './worktop.js';

const L = (en, he) => ({ en, he });
const mm = (cm) => Math.round(cm * 100) / 10;           // cm → mm (0.1 mm)
const r3 = (v) => Math.round(v * 1000) / 1000;
const PART = {
  side: L('Side', 'דופן'), bottom: L('Bottom', 'תחתית'), top: L('Top', 'גג'), railF: L('Front rail', 'פס חיזוק קדמי'), railB: L('Back rail', 'פס חיזוק אחורי'),
  back: L('Back panel', 'גב'), shelf: L('Shelf', 'מדף'), glassShelf: L('Glass shelf', 'מדף זכוכית'), divider: L('Divider', 'מחיצה'), shoe: L('Shoe shelf', 'מדף נעליים'),
  idrawer: L('Internal drawer front', 'חזית מגירה פנימית'), door: L('Door', 'דלת'), drawer: L('Drawer front', 'חזית מגירה'), flap: L('Lift-up door', 'דלת הרמה'),
  glass: L('Glass door', 'דלת זכוכית'), mirror: L('Mirror door', 'דלת מראה'), panelFront: L('Appliance door panel', 'חזית למכשיר אינטגרלי'),
  filler: L('Filler', 'פילר'), endPanel: L('End panel', 'פאנל צד'), backPanelIsland: L('Island back panel', 'פאנל גב לאי'), islandEnd: L('Island end panel', 'פאנל צד לאי'),
  boxSide: L('Top box side', 'דופן בוידעם'), boxTop: L('Top box top', 'גג בוידעם'), boxBottom: L('Top box bottom', 'תחתית בוידעם'), boxBack: L('Top box back', 'גב בוידעם'),
  shelfBoard: L('Floating shelf', 'מדף צף'), cladding: L('Cladding panel', 'פאנל חיפוי'), deskTop: L('Desk top', 'משטח שולחן'),
  bench: L('Bench seat', 'מושב ספסל'), sliding: L('Sliding door', 'דלת הזזה'),
};
export const HARDWARE = {
  hinge: L('Hinge', 'ציר'), drawer: L('Drawer system (runners + box)', 'מערכת מגירה (מסילות + קופסה)'), liftup: L('Lift-up mechanism', 'מנגנון דלת הרמה'),
  'flap-stay': L('Flap stay', 'תומך דלת נפתחת'), handle: L('Handle', 'ידית'), 'push-latch': L('Push-to-open latch', 'מנגנון פתיחה בלחיצה'), profile: L('Handle profile', 'פרופיל ידית'),
  leg: L('Adjustable leg', 'רגל מתכווננת'), hanger: L('Wall-unit hanger', 'מתלה לארון עליון'), 'wall-fixing': L('Wall fixing bracket', 'זווית חיבור לקיר'),
  'shelf-support': L('Shelf support', 'תומך מדף'), rail: L('Hanging rail', 'מוט תלייה'), 'rail-support': L('Rail support', 'תומך מוט'),
  pullout: L('Pull-out fitting', 'מנגנון נשלף'), larder: L('Pull-out larder', 'מזווה נשלף (קרגו)'), 'trouser-rack': L('Trouser rack', 'מתקן מכנסיים'),
  'sliding-set': L('Sliding door gear (per door)', 'מנגנון דלת הזזה (לדלת)'), 'sliding-track': L('Sliding track (top + bottom)', 'מסילה (עליונה + תחתונה)'),
  'appliance-kit': L('Integrated appliance door kit', 'ערכת חיבור חזית למכשיר'), 'worktop-bracket': L('Overhang bracket', 'תומך בליטה'),
};

/** Longest standard runner ≤ depth − 10 mm. */
export const runnerFor = (depthMm) => RULES.drawerLengths.filter((l) => l <= depthMm - 10).pop() || RULES.drawerLengths[0];

function panel(list, part, group, material, thickness, lengthMm, widthMm, qty, edges = { long: 0, short: 0 }, edgeType = null) {
  if (!(lengthMm > 0 && widthMm > 0 && qty > 0)) return;
  const area = (lengthMm * widthMm * qty) / 1e6;
  const edgeM = ((edges.long * lengthMm + edges.short * widthMm) * qty) / 1000;
  list.push({ part, group, material, thickness, length: lengthMm, width: widthMm, qty, edges, edgeType: edges.long || edges.short ? edgeType : null, areaM2: r3(area), edgeM: r3(edgeM) });
}
function hw(list, kind, qty, extra = {}) {
  if (!(qty > 0)) return;
  const key = JSON.stringify([kind, extra.variant || null, extra.length || null, extra.grade || null]);
  const ex = list.find((h) => h._k === key);
  if (ex) { ex.qty = r3(ex.qty + qty); return; }
  list.push({ _k: key, kind, label: HARDWARE[kind] || L(kind, kind), qty: r3(qty), unit: extra.unit || 'unit', ...extra });
}
const clean = (list) => list.map(({ _k, ...h }) => h);

/** A plain carcass (kind 'base' with rails, otherwise top + bottom). Sizes in mm. */
function carcass(parts, kind, Wmm, Hmm, Dmm, spec, labels = PART) {
  const t = spec.carcass.thickness, mat = spec.carcass.material, eb = spec.edge.carcass, inner = Wmm - 2 * t;
  panel(parts, labels.side, 'carcass', mat, t, Hmm, Dmm, 2, { long: 1, short: 0 }, eb);
  if (kind === 'base') {
    panel(parts, PART.bottom, 'carcass', mat, t, inner, Dmm, 1, { long: 1, short: 0 }, eb);
    panel(parts, PART.railF, 'carcass', mat, t, inner, 100, 1, { long: 1, short: 0 }, eb);
    panel(parts, PART.railB, 'carcass', mat, t, inner, 100, 1);
  } else {
    panel(parts, labels.top || PART.top, 'carcass', mat, t, inner, Dmm, 1, { long: 1, short: 0 }, eb);
    panel(parts, labels.bottom || PART.bottom, 'carcass', mat, t, inner, Dmm, 1, { long: 1, short: 0 }, eb);
  }
  panel(parts, labels.back || PART.back, 'back', spec.carcass.back.material, spec.carcass.back.thickness, Wmm - 4, Hmm - 4, 1);
}

/** Take-off of one unit. */
export function unitTakeoff(run, unit, code) {
  const g = geometryOf(run, unit), m = g.mod, spec = g.spec, t = spec.carcass.thickness;
  const parts = [], fronts = [], hardware = [], notes = [];
  const W = mm(g.w), D = mm(g.dc), fm = spec.fronts.material, ft = spec.fronts.thickness, feb = spec.edge.fronts;
  const H = mm(g.carcassY[1] - g.carcassY[0]);
  const legs = (wmm) => (wmm <= 1000 ? 4 : 6);
  const plinthed = spec.plinth.height > 0;
  // carcass
  if (m.carcass === 'base') {
    carcass(parts, 'base', W, H, D, spec);
    if (plinthed && !m.wallHung && g.level === 'base') hw(hardware, 'leg', legs(W));
    if (m.wallHung) hw(hardware, 'hanger', 2);
  } else if (m.carcass === 'wall') {
    carcass(parts, 'wall', W, H, D, spec);
    hw(hardware, 'hanger', 2);
  } else if (m.carcass === 'tall' || m.carcass === 'full') {
    carcass(parts, 'tall', W, H, D, spec);
    if (plinthed) hw(hardware, 'leg', legs(W));
    hw(hardware, 'wall-fixing', 2);
    if (g.top) {
      const bh = mm(g.top.y1 + RULES.frontGap - g.top.y0);
      carcass(parts, 'wall', W, bh, D, spec, { side: PART.boxSide, top: PART.boxTop, bottom: PART.boxBottom, back: PART.boxBack });
    }
  } else if (m.carcass === 'island') {
    const bays = islandBays(g);
    for (const b of bays) { carcass(parts, 'base', mm(b.w), H, D, spec); if (plinthed) hw(hardware, 'leg', legs(mm(b.w))); }
    const bodyD = mm(spec.worktop.depth - (spec.worktop.overhangSeat || 0) - 2);
    panel(parts, PART.backPanelIsland, 'front', fm, ft, W - (spec.worktop.waterfall ? 0 : 2 * t), H + mm(spec.plinth.height), 1, { long: 2, short: 2 }, feb);
    if (!spec.worktop.waterfall) panel(parts, PART.islandEnd, 'front', fm, ft, H + mm(spec.plinth.height), bodyD, 2, { long: 2, short: 2 }, feb);
    if ((spec.worktop.overhangSeat || 0) > (RULES.islandOverhangUnsupported[spec.worktop.thickness] ?? 30)) hw(hardware, 'worktop-bracket', Math.max(2, Math.ceil(g.w / 60)));
  } else if (m.carcass === 'shelf') {
    panel(parts, PART.shelfBoard, 'front', fm, Math.round(g.h * 10), W, mm(g.d), 1, { long: 1, short: 2 }, feb);
    hw(hardware, 'wall-fixing', Math.max(2, Math.ceil(g.w / 60)));
  } else if (m.carcass === 'panel') {
    if (m.id === 'media-panel') { panel(parts, PART.cladding, 'front', fm, ft, mm(g.h), W, 1, { long: 2, short: 2 }, feb); hw(hardware, 'wall-fixing', 4); }
    else {
      const ph = mm(g.level === 'wall' ? g.h : g.level === 'base' || g.level === 'island' ? g.h - g.H.wt : g.h), pd = mm(g.level === 'base' ? g.dc + g.frontD : g.d);
      panel(fronts, PART.endPanel, 'front', fm, Math.round(g.w * 10), ph, pd, 1, { long: 2, short: 2 }, feb);
    }
  } else if (m.carcass === 'filler') {
    panel(fronts, PART.filler, 'front', fm, ft, mm(g.zone.y1 - g.zone.y0), W, 1, { long: 2, short: 2 }, feb);
  } else if (m.carcass === 'desk') {
    panel(parts, PART.deskTop, 'front', fm, 2 * ft, W, mm(g.d), 1, { long: 1, short: 2 }, feb);
    hw(hardware, 'wall-fixing', 3);
  }
  if (m.id === 'entry-bench') panel(parts, PART.bench, 'front', fm, ft, W, mm(g.d), 1, { long: 1, short: 2 }, feb);
  // fronts
  const handleT = spec.handles.type, profileStyle = ['j-profile', 'gola'].includes(spec.fronts.style);
  let profileMm = 0;
  for (const f of g.fronts) {
    if (['open', 'blind', 'filler', 'panel'].includes(f.kind) || (f.kind === 'appliance' && !f.panel)) continue;
    const fw = mm(f.w), fh = mm(f.h);
    const part = f.kind === 'appliance' ? PART.panelFront : PART[f.kind] || PART.door;
    const mat = f.kind === 'glass' ? 'glass' : f.kind === 'mirror' ? 'mirror' : fm, th = f.kind === 'glass' || f.kind === 'mirror' ? 4 : ft;
    panel(fronts, part, f.kind === 'glass' || f.kind === 'mirror' ? 'glass' : 'front', mat, th, fh, fw, 1, f.kind === 'glass' || f.kind === 'mirror' ? { long: 0, short: 0 } : { long: 2, short: 2 }, feb);
    if (f.kind === 'door' || f.kind === 'glass' || f.kind === 'mirror') hw(hardware, 'hinge', RULES.hingesFor(Math.max(fh, fw > fh ? fw : 0)), { variant: f.kind === 'glass' ? 'glass' : m.corner ? 'blind-corner' : 'standard', grade: spec.hardware.grade });
    if (f.kind === 'flap') { if (f.hinge === 'B') { hw(hardware, 'flap-stay', 1, { grade: spec.hardware.grade }); hw(hardware, 'hinge', 2, { variant: 'standard', grade: spec.hardware.grade }); } else hw(hardware, 'liftup', 1, { grade: spec.hardware.grade }); }
    if (f.kind === 'drawer') hw(hardware, 'drawer', 1, { length: runnerFor(D), grade: spec.hardware.grade });
    if (f.kind === 'appliance' && f.panel) hw(hardware, 'appliance-kit', 1);
    if (f.handle !== false) {
      if (profileStyle || handleT === 'none') profileMm += fw;
      else if (handleT === 'push') { if (f.kind !== 'drawer' && f.kind !== 'appliance') hw(hardware, 'push-latch', 1); }
      else hw(hardware, 'handle', 1, { variant: handleT, length: handleT === 'bar' ? spec.handles.length * 10 : undefined });
    }
  }
  if (profileMm) hw(hardware, 'profile', r3(profileMm / 1000), { unit: 'm', variant: spec.fronts.style });
  // internals
  const inner = g.inner, divider = inner.find((c) => c.kind === 'divider');
  const sectionLen = (c) => {
    let a = Math.max(c.x0 ?? 0, g.t), b = Math.min(c.x1 ?? g.w, g.w - g.t);
    if (divider && Math.abs(a - divider.x0) < 0.01) a += g.t / 2;
    if (divider && Math.abs(b - divider.x0) < 0.01) b -= g.t / 2;
    return mm(b - a) - 2;
  };
  for (const c of inner) {
    if (c.kind === 'shelf' || c.kind === 'shoe') {
      if (c.glass) panel(parts, PART.glassShelf, 'glass', 'glass', 6, sectionLen(c), D - 20, 1);
      else panel(parts, c.kind === 'shoe' ? PART.shoe : PART.shelf, 'carcass', spec.carcass.material, t, sectionLen(c), D - 20, 1, { long: 1, short: 0 }, spec.edge.carcass);
      hw(hardware, 'shelf-support', 4);
    } else if (c.kind === 'divider') panel(parts, PART.divider, 'carcass', spec.carcass.material, t, mm(c.h), D - 20, 1, { long: 1, short: 0 }, spec.edge.carcass);
    else if (c.kind === 'rail') { hw(hardware, 'rail', 1, { length: sectionLen(c) }); hw(hardware, 'rail-support', 2); }
    else if (c.kind === 'drawer') { panel(parts, PART.idrawer, 'carcass', spec.carcass.material, t, sectionLen(c) - 2, mm(c.h), 1, { long: 2, short: 2 }, spec.edge.carcass); hw(hardware, 'drawer', 1, { length: runnerFor(D), grade: spec.hardware.grade, variant: 'internal' }); }
    else if (c.kind === 'trouser') hw(hardware, 'trouser-rack', 1);
    else if (c.kind === 'larder') hw(hardware, 'larder', 1, { grade: spec.hardware.grade });
    else if (c.kind === 'pullout') hw(hardware, 'pullout', 1, { variant: c.variant, grade: spec.hardware.grade });
  }
  if (m.cutout === 'sink') notes.push(L('Back panel: cut-out for plumbing; moisture-resistant bottom or aluminium sink mat.', 'גב: פתח לאינסטלציה; תחתית עמידה ללחות או מגש אלומיניום לכיור.'));
  if (m.id === 'base-oven' || m.id === 'tall-oven') notes.push(L('Oven housing: no back panel behind the oven, ventilation gap per the appliance manual.', 'בית תנור: ללא גב מאחורי התנור, מרווח אוורור לפי הוראות היצרן.'));
  const appliances = [];
  if (m.appliance) for (const f of g.fronts.filter((x) => x.kind === 'appliance')) appliances.push({ label: f.label, niche: { w: f.w, h: f.h, d: g.dc }, model: (unit.carp.appliance && unit.carp.appliance.model) || '', make: (unit.carp.appliance && unit.carp.appliance.make) || '' });
  return { unitId: unit.id, code, module: m.id, name: m.name, level: g.level, w: g.w, h: g.h, d: g.d, elev: g.elev, panels: parts, fronts, hardware: clean(hardware), appliances, notes };
}

/** Run-level quantities (plinth, lighting, sliding doors, end panels) + per-unit take-offs + worktops. */
export function runTakeoff(run, v) {
  const units = unitsOf(run, v), codes = unitCodes(run, units), pos = positions(run, units);
  const ordered = [...units].sort((a, b) => pos.get(a.id).at - pos.get(b.id).at || (isFloorLevel(pos.get(a.id).level) ? -1 : 1));
  const list = ordered.map((u) => unitTakeoff(run, u, codes.get(u.id)));
  const spec = run.spec, extra = [], runHw = [];
  // plinth
  let plinthCm = 0;
  if (spec.plinth.height > 0) {
    for (const u of ordered) {
      const m = MODULES[u.carp.module], lvl = pos.get(u.id).level;
      if (m.virtual || m.wallHung || m.id === 'panel' || !['base', 'tall', 'full', 'island'].includes(lvl) || ['shelf', 'desk', 'none'].includes(m.carcass)) continue;
      if (m.id === 'tall-fridge-niche') continue;
      if (lvl === 'island') { plinthCm += 2 * (u.carp.width - 2 * spec.carcass.thickness / 10); continue; }
      plinthCm += u.carp.width;
    }
    for (const side of ['left', 'right']) {
      const e = run.ends && run.ends[side];
      if (!e || e.type !== 'open' || run.kind === 'island') continue;
      const fl = ordered.filter((u) => isFloorLevel(pos.get(u.id).level));
      const endU = side === 'left' ? fl[0] : fl[fl.length - 1];
      if (endU && !MODULES[endU.carp.module].virtual && endU.carp.module !== 'panel' && !MODULES[endU.carp.module].wallHung) plinthCm += geometryOf(run, endU).dc - spec.plinth.setback;
    }
  }
  // lighting
  const wallUnits = ordered.filter((u) => pos.get(u.id).level === 'wall' && MODULES[u.carp.module].carcass === 'wall');
  const ledCm = spec.lighting.underWall ? wallUnits.reduce((s, u) => s + u.carp.width, 0) : 0;
  const inCabCm = spec.lighting.inCabinet ? ordered.filter((u) => u.carp.module === 'wall-glass').reduce((s, u) => s + u.carp.width, 0) : 0;
  // sliding wardrobe doors
  let sliding = null;
  const sl = ordered.filter((u) => MODULES[u.carp.module].sliding);
  if (sl.length) {
    const len = sl.reduce((s, u) => s + u.carp.width, 0), n = (spec.sliding && spec.sliding.doors) || Math.max(2, Math.ceil(len / 100)), g = geometryOf(run, sl[0]);
    const dw = mm((len + (n - 1) * 3) / n), dh = mm(g.zone.y1 - g.zone.y0);
    const mirror = spec.sliding && spec.sliding.mirror ? Math.min(n, spec.sliding.mirror) : 0;
    panel(extra, PART.sliding, 'front', spec.fronts.material, spec.fronts.thickness, dh, dw, n - mirror, { long: 2, short: 2 }, spec.edge.fronts);
    if (mirror) panel(extra, PART.mirror, 'glass', 'mirror', 4, dh, dw, mirror);
    hw(runHw, 'sliding-set', n, { grade: spec.hardware.grade });
    hw(runHw, 'sliding-track', r3((2 * len) / 100), { unit: 'm' });
    sliding = { doors: n, doorW: dw, doorH: dh, lengthCm: len };
  }
  const worktops = computeWorktops(run, units, buttsOf(run, v));
  const appliances = [...list.flatMap((u) => u.appliances.map((a) => ({ ...a, unit: u.code }))), ...(spec.appliances || []).map((a) => ({ label: a.label || L(a.type || 'Appliance', a.type || 'מכשיר'), make: a.make || '', model: a.model || '', niche: a.niche || null, unit: a.unit || '' }))];
  return {
    runId: run.id, code: run.code, name: run.name, nameHe: run.nameHe, kind: run.kind, length: run.length,
    units: list, extraFronts: extra, hardware: clean(runHw), worktops, sliding,
    plinth: { m: r3(plinthCm / 100), height: spec.plinth.height, finish: spec.plinth.finish, pieces: Math.ceil(plinthCm / 300 - 1e-9) },
    lighting: { underWallM: r3(ledCm / 100), inCabinetM: r3(inCabCm / 100) },
    splashback: splashOf(run, worktops), appliances,
  };
}
function buttsOf(run, v) {
  const out = [];
  for (const r of v.runs()) for (const side of ['left', 'right']) { const e = r.ends && r.ends[side]; if (e && e.type === 'run' && e.runId === run.id) out.push({ side: e.at || 'left', depth: r.spec.worktop.depth }); }
  return out;
}
function splashOf(run, worktops) {
  const s = run.spec.splashback;
  if (!s || s.material === 'none' || run.kind === 'island' || !worktops.length) return { m2: 0, material: s ? s.material : 'none', height: 0 };
  const len = worktops.filter((p) => !p.waterfall).reduce((a, p) => a + p.length, 0);
  return { m2: r3((len * s.height) / 1e4), material: s.material, height: s.height, lengthM: r3(len / 100) };
}

/** Sum a run list into totals per material, edge type, fronts, hardware, worktop. */
function totalsOf(runs) {
  const mats = new Map(), edges = new Map(), hwt = [], wt = new Map();
  let frontCount = 0, frontArea = 0, plinthM = 0, ledM = 0, splashM2 = 0;
  const addPanel = (p) => {
    const key = `${p.group}|${p.material}|${p.thickness}`;
    const cur = mats.get(key) || { group: p.group, material: p.material, thickness: p.thickness, label: matLabel(p.group, p.material), areaM2: 0, pieces: 0, edgeM: 0 };
    cur.areaM2 = r3(cur.areaM2 + p.areaM2); cur.pieces += p.qty; cur.edgeM = r3(cur.edgeM + p.edgeM); mats.set(key, cur);
    if (p.edgeType) edges.set(p.edgeType, r3((edges.get(p.edgeType) || 0) + p.edgeM));
  };
  for (const r of runs) {
    for (const u of r.units) {
      u.panels.forEach(addPanel); u.fronts.forEach(addPanel);
      for (const f of u.fronts) if (f.part !== PART.filler && f.part !== PART.endPanel) { frontCount += f.qty; frontArea += f.areaM2; }
      for (const h of u.hardware) hw(hwt, h.kind, h.qty, h);
    }
    r.extraFronts.forEach((p) => { addPanel(p); frontCount += p.qty; frontArea += p.areaM2; });
    for (const h of r.hardware) hw(hwt, h.kind, h.qty, h);
    for (const p of r.worktops) {
      const k = `${p.material}|${p.thickness}`, cur = wt.get(k) || { material: p.material, thickness: p.thickness, label: vocab('worktopMaterial', p.material), areaM2: 0, pieces: 0, polishedM: 0, upstandM: 0, cutouts: {} };
      cur.areaM2 = r3(cur.areaM2 + p.areaM2); cur.pieces += 1; cur.polishedM = r3(cur.polishedM + p.polishedM); cur.upstandM = r3(cur.upstandM + p.upstandM);
      for (const c of p.cutouts) cur.cutouts[c.kind] = (cur.cutouts[c.kind] || 0) + 1;
      wt.set(k, cur);
    }
    plinthM += r.plinth.m; ledM += r.lighting.underWallM + r.lighting.inCabinetM; splashM2 += r.splashback.m2;
  }
  return {
    materials: [...mats.values()], edges: [...edges.entries()].map(([type, m]) => ({ type, label: vocab('edge', type), m })),
    fronts: { count: frontCount, areaM2: r3(frontArea) }, hardware: clean(hwt), worktops: [...wt.values()],
    plinthM: r3(plinthM), lightingM: r3(ledM), splashbackM2: r3(splashM2),
  };
}
function matLabel(group, material) {
  if (group === 'back') return vocab('backMaterial', material);
  if (group === 'glass') return material === 'mirror' ? L('Mirror 4 mm', 'מראה 4 מ״מ') : L('Glass', 'זכוכית');
  if (group === 'front') return vocab('frontMaterial', material);
  return vocab('carcassMaterial', material);
}

/** Take-off for one run or 'all'. `src` = optional { carpentry, items }. */
export function takeoff(runId = 'all', src) {
  const v = view(src);
  const runs = (runId === 'all' ? v.runs() : [v.run(runId)].filter(Boolean)).map((r) => runTakeoff(r, v));
  return { runs, totals: totalsOf(runs), units: { panels: 'mm', area: 'm2', lengths: 'm' } };
}
