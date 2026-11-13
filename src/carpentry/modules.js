/**
 * MODULE LIBRARY — every made-to-measure unit a run can hold, as data + small pure functions.
 *
 * A module definition:
 *   id, level ('base'|'wall'|'tall'|'island'|'full'), code (schedule letter), name { en, he }, kinds (run kinds offering it),
 *   w { min, max, std }  (cm)        appliance? { label, w, h }  → width is fixed by the appliance (fitRun never changes it)
 *   virtual?    no carcass (empty space / free-standing appliance / free wall) — the item is hidden
 *   carcass     'base' | 'wall' | 'tall' | 'full' | 'none' | 'panel' | 'filler' — how the take-off builds it
 *   worktop?    carries the run's worktop          cutout? 'sink' | 'hob' | 'basin'
 *   internals   { default, options }   (VOCAB group in `group`)
 *   fronts(c)   → Front[] in ELEVATION coordinates of the unit: x from the unit's left edge (seen from the front), y up from
 *               the floor, cm. Front = { kind: 'door'|'drawer'|'flap'|'glass'|'mirror'|'open'|'appliance'|'panel'|'filler'|'blind',
 *               x, y, w, h, hinge?: 'L'|'R'|'T', label?: { en, he }, handle?: boolean }
 *   inner(c)    → internal components [{ kind: 'shelf'|'rail'|'drawer'|'divider'|'shoe'|'trouser'|'larder'|'pullout', y, h?, x0?, x1? }]
 *               (y from the floor, x relative to the unit, cm) — for internal elevations and the take-off.
 *   model(c)    → { type, params } for the existing 3D / 2D model types (src/models/types.js).
 *
 * `c` (the unit context, built by geometryOf()) = { w, h, d, elev, level, zone: { y0, y1 }, top?: { y0, y1 }, H (derived heights),
 *   spec (effective spec), carp (unit.carp), mod, frontD (front thickness cm), t (carcass thickness cm) }.
 */
import { RULES, VOCAB } from './spec.js';

const L = (en, he) => ({ en, he });
const G = RULES.frontGap;
const r1 = (v) => Math.round(v * 100) / 100;

// ───────── front helpers ─────────
/** n doors side by side across x0..x1, y0..y1. Single door hinge from carp.fronts.hinge (default L). */
function doors(x0, x1, y0, y1, n, c, kind = 'door') {
  const out = [], hinge1 = (c.carp.fronts && c.carp.fronts.hinge) || c.carp.handed || 'L';
  const W = x1 - x0 - G, dw = (W - (n - 1) * G) / n;
  for (let i = 0; i < n; i++) {
    out.push({ kind, x: r1(x0 + G / 2 + i * (dw + G)), y: r1(y0), w: r1(dw), h: r1(y1 - y0), hinge: n === 1 ? hinge1 : i < n / 2 ? 'L' : 'R', handle: true });
  }
  return out;
}
/** n drawers stacked over y0..y1 (top first). pattern 'equal' | 'graded' (top drawer one share, the others two). */
function drawers(x0, x1, y0, y1, n, c) {
  const pattern = c.spec.fronts.drawerPattern || 'equal';
  const shares = Array.from({ length: n }, (_, i) => (pattern === 'graded' && n > 1 && i === 0 ? 1 : pattern === 'graded' && n > 1 ? 2 : 1));
  const total = shares.reduce((a, b) => a + b, 0), H = y1 - y0 - (n - 1) * G;
  const out = [];
  let y = y1;
  shares.forEach((s, i) => {
    const h = i === n - 1 ? y - y0 : r1((H * s) / total);
    out.push({ kind: 'drawer', x: r1(x0 + G / 2), y: r1(y - h), w: r1(x1 - x0 - G), h: r1(h), handle: true });
    y = y - h - G;
  });
  return out;
}
const doorCount = (w, c) => (c.carp.fronts && c.carp.fronts.doors) || (w > 60 ? 2 : 1);
const nDrawers = (c, dflt) => Math.max(1, Math.min(6, (c.carp.fronts && c.carp.fronts.drawers) || (c.carp.internals && c.carp.internals.drawers) || dflt));
const app = (label, x, y, w, h) => ({ kind: 'appliance', x: r1(x), y: r1(y), w: r1(w), h: r1(h), label });
const shelvesEvenly = (y0, y1, n, x0, x1) => Array.from({ length: n }, (_, i) => ({ kind: 'shelf', y: r1(y0 + ((i + 1) * (y1 - y0)) / (n + 1)), x0, x1 }));

// ───────── model helpers ─────────
const handleParam = (spec) => (spec.handles.type === 'knob' ? 'knob' : spec.handles.type === 'bar' ? 'bar' : 'none');
const counterParam = (spec) => ({ quartz: 'stone', porcelain: 'stone', granite: 'stone', 'solid-wood': 'wood', laminate: 'laminate', stainless: 'steel' })[spec.worktop.material] || 'stone';
const baseModel = (c, extra) => ({ type: 'kitchen-base', params: { color: c.spec.fronts.colorHex, counterColor: c.spec.worktop.colorHex, counter: counterParam(c.spec), counterThickness: c.H.wt, plinth: c.H.plinth, handles: handleParam(c.spec), ...extra } });
const wallModel = (c, extra) => ({ type: 'kitchen-wall', params: { color: c.spec.fronts.colorHex, handles: handleParam(c.spec), ...extra } });
const tallModel = (c, extra) => ({ type: 'kitchen-tall', params: { color: c.spec.fronts.colorHex, handles: handleParam(c.spec), ...extra } });
const robeModel = (c, extra) => ({ type: 'wardrobe', params: { color: c.spec.fronts.colorHex, handles: handleParam(c.spec), ...extra } });
const boxModel = (c, extra) => ({ type: 'cabinet', params: { color: c.spec.fronts.colorHex, doors: 0, drawers: 0, open: 0, legs: 'none', handles: 'none', ...extra } });

// ───────── shared front layouts ─────────
const baseDoors = (c, shelves = 1) => ({
  fronts: () => doors(0, c.w, c.zone.y0, c.zone.y1, doorCount(c.w, c), c),
  inner: () => shelvesEvenly(c.zone.y0 + c.t, c.zone.y1 - c.t, (c.carp.internals && c.carp.internals.shelves) ?? shelves, 0, c.w),
});

/** Wardrobe-type internals for one carcass section: x0..x1 (unit cm), y0..y1 inner (floor cm). */
function wardrobeInner(preset, x0, x1, y0, y1) {
  const out = [], hat = y1 - 35;
  if (preset === 'shelves') return shelvesEvenly(y0, y1, Math.max(1, Math.round((y1 - y0) / 35) - 1), x0, x1);
  if (preset === 'shoes') return shelvesEvenly(y0, y1, Math.max(1, Math.floor((y1 - y0) / 20) - 1), x0, x1).map((s) => ({ ...s, kind: 'shoe' }));
  if (preset === 'mixed') {
    const xm = r1((x0 + x1) / 2);
    return [{ kind: 'divider', y: y0, h: r1(y1 - y0), x0: xm, x1: xm }, ...shelvesEvenly(y0, y1, Math.max(1, Math.round((y1 - y0) / 35) - 1), x0, xm),
      { kind: 'shelf', y: r1(hat), x0: xm, x1 }, { kind: 'rail', y: r1(hat - 5), x0: xm, x1 }];
  }
  out.push({ kind: 'shelf', y: r1(hat), x0, x1 }, { kind: 'rail', y: r1(hat - 5), x0, x1 });
  if (preset === 'double-hanging') out.push({ kind: 'rail', y: r1(y0 + 100), x0, x1 });
  if (preset === 'drawers') {
    for (let i = 0; i < 3; i++) out.push({ kind: 'drawer', y: r1(y0 + i * 20), h: 18, x0, x1 });
    out.push({ kind: 'shelf', y: r1(y0 + 62), x0, x1 });
  }
  if (preset === 'trousers') out.push({ kind: 'trouser', y: r1(y0), h: 70, x0, x1 });
  return out;
}

/** Full-height (wardrobe-type) fronts: main doors + top-box doors. */
function fullFronts(c, kind = 'door') {
  const n = doorCount(c.w, c), mirror = c.carp.fronts && c.carp.fronts.mirror;
  const main = c.mod.sliding ? [] : doors(0, c.w, c.zone.y0, c.zone.y1, n, c, kind).map((f, i) => (mirror && (mirror === true || i < mirror) ? { ...f, kind: 'mirror' } : f));
  const top = c.top ? doors(0, c.w, c.top.y0, c.top.y1, n, c) : [];
  return [...main, ...top];
}

const LBL = {
  sink: L('Sink', 'כיור'), hob: L('Hob', 'כיריים'), oven: L('Oven', 'תנור'), mw: L('Microwave', 'מיקרוגל'), dw: L('Dishwasher', 'מדיח כלים'),
  fridge: L('Fridge', 'מקרר'), freezer: L('Freezer', 'מקפיא'), washer: L('Washing machine', 'מכונת כביסה'), dryer: L('Dryer', 'מייבש'),
  hood: L('Extractor hood', 'קולט אדים'), tv: L('TV', 'טלוויזיה'), space: L('Appliance space', 'מקום למכשיר'),
};
export const APPLIANCE_LABELS = LBL;

/** The library. Order = order shown in pickers. */
export const MODULES = {};
const def = (m) => { MODULES[m.id] = { internals: null, worktop: false, ...m }; };
const K = ['kitchen', 'pantry', 'utility', 'island', 'custom'];

// ───────── kitchen base ─────────
def({ id: 'base-door', level: 'base', code: 'B', carcass: 'base', worktop: true, kinds: [...K, 'desk'], name: L('Base unit, doors + shelf', 'ארון תחתון — דלתות ומדף'),
  w: { min: 30, max: 120, std: 60 }, internals: { group: null, default: { shelves: 1 } },
  fronts: (c) => baseDoors(c).fronts(), inner: (c) => baseDoors(c).inner(), model: (c) => baseModel(c, { doors: doorCount(c.w, c) }) });
def({ id: 'base-drawers', level: 'base', code: 'B', carcass: 'base', worktop: true, kinds: [...K, 'desk'], name: L('Drawer bank', 'ארון מגירות'),
  w: { min: 30, max: 120, std: 60 }, internals: { group: null, default: { drawers: 3 }, options: [2, 3, 4] },
  fronts: (c) => drawers(0, c.w, c.zone.y0, c.zone.y1, nDrawers(c, 3), c),
  inner: (c) => [], model: (c) => baseModel(c, { drawers: nDrawers(c, 3) }) });
def({ id: 'base-sink', level: 'base', code: 'B', carcass: 'base', worktop: true, cutout: 'sink', kinds: [...K], name: L('Sink unit', 'ארון כיור'),
  w: { min: 60, max: 120, std: 80 }, internals: { group: null, default: { bin: false } },
  fronts: (c) => doors(0, c.w, c.zone.y0, c.zone.y1, doorCount(c.w, c), c), inner: () => [],
  model: (c) => baseModel(c, { doors: doorCount(c.w, c), sink: c.w >= 100 ? 'double' : 'single' }) });
def({ id: 'base-hob', level: 'base', code: 'B', carcass: 'base', worktop: true, cutout: 'hob', kinds: ['kitchen', 'island'], name: L('Hob unit (pan drawers)', 'ארון כיריים (מגירות סירים)'),
  w: { min: 60, max: 120, std: 60 }, internals: { group: null, default: { drawers: 3 }, options: [2, 3] },
  fronts: (c) => drawers(0, c.w, c.zone.y0, c.zone.y1, nDrawers(c, 3), c), inner: () => [],
  model: (c) => baseModel(c, { drawers: nDrawers(c, 3), cooktop: c.carp.hob || 'induction' }) });
def({ id: 'base-oven', level: 'base', code: 'B', carcass: 'base', worktop: true, kinds: ['kitchen', 'island'], name: L('Built-in oven housing (under worktop)', 'ארון תנור בנוי (מתחת למשטח)'),
  w: { min: 60, max: 60, std: 60 }, appliance: { label: LBL.oven, w: 60, h: 59.5 },
  fronts: (c) => { const top = c.zone.y1, oy = top - 59.5; return [app(LBL.oven, G / 2, oy, c.w - G, 59.5), ...drawers(0, c.w, c.zone.y0, oy - G, 1, c)]; },
  inner: () => [], model: (c) => baseModel(c, { oven: true, drawers: 1 }) });
def({ id: 'base-dishwasher', level: 'base', code: 'B', carcass: 'none', worktop: true, kinds: ['kitchen', 'island'], name: L('Integrated dishwasher', 'מדיח כלים אינטגרלי'),
  w: { min: 45, max: 60, std: 60 }, appliance: { label: LBL.dw, w: 60, h: 82 },
  fronts: (c) => [{ ...doors(0, c.w, c.zone.y0, c.zone.y1, 1, c)[0], kind: 'appliance', label: LBL.dw, hinge: 'B', handle: true, panel: true }],
  inner: () => [], model: (c) => baseModel(c, { dishwasher: true }) });
def({ id: 'base-pullout', level: 'base', code: 'B', carcass: 'base', worktop: true, kinds: [...K], name: L('Pull-out (spices / bottles)', 'נשלף צר (תבלינים / בקבוקים)'),
  w: { min: 15, max: 40, std: 30 }, internals: { group: null, default: { pullout: 'spice' } },
  fronts: (c) => drawers(0, c.w, c.zone.y0, c.zone.y1, 1, c), inner: (c) => [{ kind: 'pullout', variant: 'spice', y: c.zone.y0, h: c.zone.y1 - c.zone.y0 }],
  model: (c) => baseModel(c, { drawers: 1 }) });
def({ id: 'base-bin', level: 'base', code: 'B', carcass: 'base', worktop: true, kinds: [...K], name: L('Waste-bin pull-out', 'נשלף פחי אשפה (מיחזור)'),
  w: { min: 30, max: 60, std: 45 }, internals: { group: null, default: { pullout: 'bin' } },
  fronts: (c) => drawers(0, c.w, c.zone.y0, c.zone.y1, 1, c), inner: (c) => [{ kind: 'pullout', variant: 'bin', y: c.zone.y0, h: c.zone.y1 - c.zone.y0 }],
  model: (c) => baseModel(c, { drawers: 1 }) });
def({ id: 'base-corner-blind', level: 'base', code: 'B', carcass: 'base', worktop: true, corner: true, kinds: ['kitchen', 'utility'], name: L('Blind corner unit', 'ארון פינה עיוורת'),
  w: { min: 60, max: 130, std: 110 }, internals: { group: 'cornerInternal', default: { corner: 'lemans' }, options: Object.keys(VOCAB.cornerInternal) },
  fronts: (c) => {
    const blind = Math.min(c.w, c.carp.blind ?? 60), side = c.carp.cornerSide || 'L', dw = c.w - blind;
    const bx = side === 'L' ? 0 : dw, out = [{ kind: 'blind', x: r1(bx), y: c.zone.y0, w: r1(blind), h: r1(c.zone.y1 - c.zone.y0) }];
    if (dw >= 15) out.push(...doors(side === 'L' ? blind : 0, side === 'L' ? c.w : dw, c.zone.y0, c.zone.y1, 1, { ...c, carp: { ...c.carp, fronts: { hinge: side === 'L' ? 'R' : 'L' } } }));
    return out;
  },
  inner: (c) => { const k = (c.carp.internals && c.carp.internals.corner) || 'lemans'; return k === 'none' ? [] : k === 'shelf' ? shelvesEvenly(c.zone.y0, c.zone.y1, 1, 0, c.w) : [{ kind: 'pullout', variant: k, y: c.zone.y0, h: c.zone.y1 - c.zone.y0 }]; },
  model: (c) => baseModel(c, { corner: true, doors: 1 }) });
def({ id: 'base-corner-carousel', level: 'base', code: 'B', carcass: 'base', worktop: true, corner: true, kinds: ['kitchen'], name: L('L-corner unit with carousel', 'ארון פינה L עם קרוסלה'),
  w: { min: 80, max: 100, std: 90 }, internals: { group: 'cornerInternal', default: { corner: 'carousel' } },
  fronts: (c) => doors(0, c.w, c.zone.y0, c.zone.y1, 1, c), inner: (c) => [{ kind: 'pullout', variant: 'carousel', y: c.zone.y0, h: c.zone.y1 - c.zone.y0 }],
  model: (c) => baseModel(c, { corner: true, doors: 1 }) });
def({ id: 'base-open', level: 'base', code: 'B', carcass: 'base', worktop: true, kinds: [...K, 'media', 'desk'], name: L('Open shelf unit', 'ארון מדפים פתוח'),
  w: { min: 15, max: 90, std: 30 }, internals: { group: null, default: { shelves: 1 } },
  fronts: (c) => [{ kind: 'open', x: 0, y: c.zone.y0, w: c.w, h: r1(c.zone.y1 - c.zone.y0) }],
  inner: (c) => shelvesEvenly(c.zone.y0, c.zone.y1, (c.carp.internals && c.carp.internals.shelves) ?? 1, 0, c.w), model: (c) => baseModel(c, { doors: 0 }) });
def({ id: 'base-space', level: 'base', code: 'X', carcass: 'none', virtual: true, kinds: [...K, 'utility'], name: L('Space for a free-standing appliance', 'מקום למכשיר עומד'),
  w: { min: 45, max: 120, std: 60 }, appliance: { label: LBL.space, w: 60, h: 85, free: true },
  fronts: (c) => [app(c.carp.appliance ? c.carp.appliance.label || LBL.space : LBL.space, 0, 0, c.w, (c.carp.appliance && c.carp.appliance.h) || 85)],
  inner: () => [], model: (c) => boxModel(c, {}) });

// ───────── kitchen wall ─────────
def({ id: 'wall-door', level: 'wall', code: 'W', carcass: 'wall', kinds: [...K, 'vanity', 'media'], name: L('Wall unit, doors', 'ארון עליון — דלתות'),
  w: { min: 30, max: 120, std: 60 }, internals: { group: null, default: { shelves: 2 } },
  fronts: (c) => doors(0, c.w, c.zone.y0, c.zone.y1, doorCount(c.w, c), c),
  inner: (c) => shelvesEvenly(c.zone.y0, c.zone.y1, (c.carp.internals && c.carp.internals.shelves) ?? 2, 0, c.w), model: (c) => wallModel(c, { doors: doorCount(c.w, c) }) });
def({ id: 'wall-liftup', level: 'wall', code: 'W', carcass: 'wall', kinds: [...K, 'media'], name: L('Wall unit, lift-up door', 'ארון עליון — דלת הרמה'),
  w: { min: 40, max: 120, std: 80 }, internals: { group: null, default: { shelves: 1 } },
  fronts: (c) => [{ ...doors(0, c.w, c.zone.y0, c.zone.y1, 1, c)[0], kind: 'flap', hinge: 'T' }],
  inner: (c) => shelvesEvenly(c.zone.y0, c.zone.y1, (c.carp.internals && c.carp.internals.shelves) ?? 1, 0, c.w), model: (c) => wallModel(c, { doors: 1 }) });
def({ id: 'wall-glass', level: 'wall', code: 'W', carcass: 'wall', kinds: [...K, 'media'], name: L('Wall unit, glass doors', 'ארון עליון — ויטרינה'),
  w: { min: 30, max: 120, std: 60 }, internals: { group: null, default: { shelves: 2 } },
  fronts: (c) => doors(0, c.w, c.zone.y0, c.zone.y1, doorCount(c.w, c), c, 'glass'),
  inner: (c) => shelvesEvenly(c.zone.y0, c.zone.y1, 2, 0, c.w).map((s) => ({ ...s, glass: true })), model: (c) => wallModel(c, { doors: doorCount(c.w, c), glassDoors: true }) });
def({ id: 'wall-open', level: 'wall', code: 'W', carcass: 'wall', kinds: [...K, 'media', 'shelving'], name: L('Open wall box', 'קובייה פתוחה עליונה'),
  w: { min: 15, max: 120, std: 60 }, internals: { group: null, default: { shelves: 1 } },
  fronts: (c) => [{ kind: 'open', x: 0, y: c.zone.y0, w: c.w, h: r1(c.zone.y1 - c.zone.y0) }],
  inner: (c) => shelvesEvenly(c.zone.y0, c.zone.y1, (c.carp.internals && c.carp.internals.shelves) ?? 1, 0, c.w), model: (c) => wallModel(c, { open: true }) });
def({ id: 'wall-hood', level: 'wall', code: 'W', carcass: 'wall', kinds: ['kitchen', 'island'], name: L('Extractor hood housing', 'ארון לקולט אדים'),
  w: { min: 60, max: 90, std: 60 }, appliance: { label: LBL.hood, w: 60, h: 30 },
  fronts: (c) => [{ ...doors(0, c.w, c.zone.y0 + 30, c.zone.y1, 1, c)[0], kind: 'flap', hinge: 'T' }, app(LBL.hood, G / 2, c.zone.y0, c.w - G, 30 - G)],
  inner: () => [], model: (c) => wallModel(c, { doors: 1 }) });
def({ id: 'wall-microwave', level: 'wall', code: 'W', carcass: 'wall', kinds: ['kitchen'], name: L('Microwave niche', 'נישה למיקרוגל'),
  w: { min: 60, max: 60, std: 60 }, appliance: { label: LBL.mw, w: 60, h: 40 },
  fronts: (c) => [app(LBL.mw, 0, c.zone.y0, c.w, 40), ...doors(0, c.w, c.zone.y0 + 40 + G, c.zone.y1, 1, c)],
  inner: (c) => [{ kind: 'shelf', y: r1(c.zone.y0 + 40), x0: 0, x1: c.w }], model: (c) => wallModel(c, { doors: 1, open: false }) });
def({ id: 'wall-corner', level: 'wall', code: 'W', carcass: 'wall', corner: true, kinds: ['kitchen'], name: L('Corner wall unit', 'ארון עליון פינתי'),
  w: { min: 60, max: 100, std: 65 }, internals: { group: null, default: { shelves: 2 } },
  fronts: (c) => { const blind = Math.min(c.w, c.carp.blind ?? 35), side = c.carp.cornerSide || 'L', dw = c.w - blind;
    return [{ kind: 'blind', x: side === 'L' ? 0 : r1(dw), y: c.zone.y0, w: r1(blind), h: r1(c.zone.y1 - c.zone.y0) },
      ...(dw >= 15 ? doors(side === 'L' ? blind : 0, side === 'L' ? c.w : dw, c.zone.y0, c.zone.y1, 1, c) : [])]; },
  inner: (c) => shelvesEvenly(c.zone.y0, c.zone.y1, 2, 0, c.w), model: (c) => wallModel(c, { doors: 1 }) });
def({ id: 'wall-void', level: 'wall', code: 'X', carcass: 'none', virtual: true, kinds: [...K, 'media', 'shelving', 'vanity', 'wardrobe', 'entry'], name: L('Free wall (no unit)', 'קיר פנוי (ללא ארון)'),
  w: { min: 1, max: 600, std: 60 }, fronts: () => [], inner: () => [], model: (c) => boxModel(c, {}) });

// ───────── tall ─────────
/** Tall door split aligned with the top line of the base fronts when the door would exceed 200 cm. */
function tallDoors(c, y0, y1) {
  const n = doorCount(c.w, c), split = y1 - y0 > 200 ? c.H.worktop - c.H.wt - RULES.topGap : null;
  if (!split) return doors(0, c.w, y0, y1, n, c);
  return [...doors(0, c.w, y0, split, n, c), ...doors(0, c.w, split + G, y1, n, c)];
}
def({ id: 'tall-pantry', level: 'tall', code: 'T', carcass: 'tall', kinds: ['kitchen', 'pantry', 'utility'], name: L('Tall pantry unit', 'ארון מזווה גבוה'),
  w: { min: 30, max: 100, std: 60 }, internals: { group: 'pantryInternal', default: { pantry: 'shelves' }, options: Object.keys(VOCAB.pantryInternal) },
  fronts: (c) => tallDoors(c, c.zone.y0, c.zone.y1),
  inner: (c) => {
    const k = (c.carp.internals && c.carp.internals.pantry) || 'shelves', y0 = c.zone.y0 + c.t, y1 = c.zone.y1 - c.t;
    if (k === 'larder') return [{ kind: 'larder', y: y0, h: r1(y1 - y0) }];
    if (k === 'drawers') return [...[0, 1, 2, 3].map((i) => ({ kind: 'drawer', y: r1(y0 + 2 + i * 20), h: 18, x0: 0, x1: c.w })), ...shelvesEvenly(y0 + 82, y1, 3, 0, c.w)];
    return shelvesEvenly(y0, y1, Math.max(3, Math.round((y1 - y0) / 35) - 1), 0, c.w);
  },
  model: (c) => tallModel(c, { doors: doorCount(c.w, c) }) });
def({ id: 'tall-oven', level: 'tall', code: 'T', carcass: 'tall', kinds: ['kitchen'], name: L('Oven + microwave tower', 'עמודת תנור ומיקרוגל'),
  w: { min: 60, max: 60, std: 60 }, appliance: { label: LBL.oven, w: 60, h: 59.5 },
  fronts: (c) => {
    const oy = c.H.worktop - c.H.wt, my = oy + 59.5 + G;
    return [...drawers(0, c.w, c.zone.y0, oy - G, 2, c), app(LBL.oven, G / 2, oy, c.w - G, 59.5), app(LBL.mw, G / 2, my, c.w - G, 38), ...doors(0, c.w, my + 38 + G, c.zone.y1, 1, c)];
  },
  inner: (c) => { const oy = c.H.worktop - c.H.wt; return [{ kind: 'shelf', y: r1(oy - c.t), x0: 0, x1: c.w }, { kind: 'shelf', y: r1(oy + 59.5), x0: 0, x1: c.w }, { kind: 'shelf', y: r1(oy + 59.5 + G + 38), x0: 0, x1: c.w }]; },
  model: (c) => tallModel(c, { oven: true, microwave: true, doors: 1 }) });
def({ id: 'tall-fridge', level: 'tall', code: 'T', carcass: 'tall', kinds: ['kitchen'], name: L('Integrated fridge housing', 'ארון למקרר אינטגרלי'),
  w: { min: 60, max: 60, std: 60 }, appliance: { label: LBL.fridge, w: 60, h: 178 },
  fronts: (c) => {
    const y0 = c.zone.y0, fz = y0 + 70, top = y0 + 178;
    return [{ ...doors(0, c.w, y0, fz, 1, c)[0], label: LBL.freezer }, { ...doors(0, c.w, fz + G, top, 1, c)[0], label: LBL.fridge }, ...doors(0, c.w, top + G, c.zone.y1, 1, c)];
  },
  inner: (c) => [{ kind: 'shelf', y: r1(c.zone.y0 + 178 + 1), x0: 0, x1: c.w }], model: (c) => tallModel(c, { fridge: true }) });
def({ id: 'tall-fridge-niche', level: 'tall', code: 'T', carcass: 'wall', kinds: ['kitchen'], name: L('Free-standing fridge niche + top box', 'נישה למקרר עומד + ארון עליון'),
  w: { min: 60, max: 110, std: 95 }, appliance: { label: LBL.fridge, w: 91, h: 180, niche: true },
  fronts: (c) => { const fh = (c.carp.appliance && c.carp.appliance.h) || 180, by = fh + 5;
    return [app(LBL.fridge, 2, 0, c.w - 4, fh), ...doors(0, c.w, by, c.zone.y1, doorCount(c.w, c), c)]; },
  inner: () => [], model: (c) => wallModel(c, { doors: doorCount(c.w, c) }) });
def({ id: 'tall-utility', level: 'tall', code: 'T', carcass: 'tall', kinds: ['kitchen', 'pantry', 'utility', 'entry'], name: L('Broom / utility cupboard', 'ארון שירות / מטאטאים'),
  w: { min: 30, max: 70, std: 50 }, internals: { group: null, default: { shelves: 1 } },
  fronts: (c) => tallDoors(c, c.zone.y0, c.zone.y1), inner: (c) => [{ kind: 'shelf', y: r1(c.zone.y1 - 40), x0: 0, x1: c.w }],
  model: (c) => tallModel(c, { doors: doorCount(c.w, c) }) });

// ───────── island ─────────
def({ id: 'island', level: 'island', code: 'I', carcass: 'island', worktop: true, kinds: ['island'], name: L('Kitchen island', 'אי מטבח'),
  w: { min: 90, max: 400, std: 240 }, internals: { group: null, default: { bays: null, drawers: 3 } },
  fronts: (c) => islandBays(c).flatMap((b) => (b.kind === 'doors' ? doors(b.x0, b.x1, c.zone.y0, c.zone.y1, b.x1 - b.x0 > 60 ? 2 : 1, c) : drawers(b.x0, b.x1, c.zone.y0, c.zone.y1, b.drawers || 3, c))),
  inner: () => [],
  model: (c) => ({ type: 'kitchen-island', params: { color: c.spec.fronts.colorHex, counterColor: c.spec.worktop.colorHex, counter: counterParam(c.spec), counterThickness: c.H.wt,
    overhang: c.spec.worktop.overhangSeat ?? 30, waterfall: !!c.spec.worktop.waterfall, drawers: islandBays(c).filter((b) => b.kind !== 'doors').length, doors: islandBays(c).filter((b) => b.kind === 'doors').length,
    ...(c.carp.sink ? { sink: true } : {}), ...(c.carp.hob ? { cooktop: c.carp.hob } : {}) } }) });

/** The carcasses inside an island (cm along the island, working side). carp.internals.bays = [{ w, kind:'drawers'|'doors', drawers }] or auto. */
export function islandBays(c) {
  const t = c.t, end = c.spec.worktop.waterfall ? c.H.wt : t;            // end panels / waterfall legs
  const inner = c.w - 2 * end, given = c.carp.internals && Array.isArray(c.carp.internals.bays) ? c.carp.internals.bays : null;
  const ws = given ? given.map((b) => b.w) : splitEven(inner, Math.max(1, Math.round(inner / 70)));
  let x = end;
  return ws.map((w, i) => { const b = { x0: r1(x), x1: r1(x + w), w, kind: (given && given[i].kind) || 'drawers', drawers: (given && given[i].drawers) || nDrawers(c, 3) }; x += w; return b; });
}

// ───────── full height: wardrobes, closets, laundry ─────────
const robeInner = (c) => {
  const preset = (c.carp.internals && c.carp.internals.preset) || c.mod.preset || 'hanging';
  const y0 = c.zone.y0 + c.t, y1 = c.zone.y1 - c.t, t = c.t;
  const out = wardrobeInner(preset, t, c.w - t, y0, y1);
  return out;
};
def({ id: 'wardrobe-hinged', level: 'full', code: 'C', carcass: 'full', kinds: ['wardrobe', 'entry', 'utility', 'custom'], preset: 'hanging', name: L('Wardrobe carcass, hinged doors', 'ארון בגדים — דלתות ציר'),
  w: { min: 30, max: 120, std: 100 }, internals: { group: 'wardrobeInternal', default: { preset: 'hanging' }, options: Object.keys(VOCAB.wardrobeInternal) },
  fronts: (c) => fullFronts(c), inner: robeInner,
  model: (c) => robeModel(c, { doors: doorCount(c.w, c), mirror: (c.carp.fronts && c.carp.fronts.mirror) || 0 }) });
def({ id: 'wardrobe-sliding', level: 'full', code: 'C', carcass: 'full', sliding: true, kinds: ['wardrobe', 'entry', 'custom'], preset: 'hanging', name: L('Wardrobe carcass, behind sliding doors', 'ארון בגדים — גוף לדלתות הזזה'),
  w: { min: 40, max: 120, std: 100 }, internals: { group: 'wardrobeInternal', default: { preset: 'hanging' }, options: Object.keys(VOCAB.wardrobeInternal) },
  fronts: (c) => fullFronts(c), inner: robeInner, model: (c) => robeModel(c, { sliding: true, doors: 2 }) });
def({ id: 'laundry-tower', level: 'full', code: 'C', carcass: 'full', kinds: ['utility'], name: L('Laundry tower (washer + dryer stacked)', 'עמודת כביסה (מכונה + מייבש)'),
  w: { min: 65, max: 75, std: 70 }, appliance: { label: LBL.washer, w: 60, h: 85, stack: true },
  fronts: (c) => [app(LBL.washer, 5, 0, c.w - 10, 85), app(LBL.dryer, 5, 87, c.w - 10, 85), ...doors(0, c.w, 175, c.zone.y1, doorCount(c.w, c), c), ...(c.top ? doors(0, c.w, c.top.y0, c.top.y1, doorCount(c.w, c), c) : [])],
  inner: (c) => [{ kind: 'shelf', y: 85, x0: c.t, x1: c.w - c.t }, { kind: 'shelf', y: 172, x0: c.t, x1: c.w - c.t }, { kind: 'shelf', y: r1((172 + c.zone.y1) / 2), x0: c.t, x1: c.w - c.t }],
  model: (c) => robeModel(c, { doors: 2 }) });
def({ id: 'entry-closet', level: 'full', code: 'C', carcass: 'full', kinds: ['entry', 'utility', 'wardrobe'], preset: 'shoes', name: L('Entry closet / shoe cupboard', 'ארון כניסה / נעליים'),
  w: { min: 30, max: 120, std: 90 }, internals: { group: 'wardrobeInternal', default: { preset: 'shoes' }, options: Object.keys(VOCAB.wardrobeInternal) },
  fronts: (c) => fullFronts(c), inner: robeInner, model: (c) => robeModel(c, { doors: doorCount(c.w, c), handles: 'none' }) });
def({ id: 'bookcase', level: 'full', code: 'S', carcass: 'full', kinds: ['shelving', 'media', 'custom'], preset: 'shelves', name: L('Bookcase', 'ספרייה'),
  w: { min: 30, max: 100, std: 80 }, internals: { group: null, default: { shelves: 5, lowerDoors: false } },
  fronts: (c) => (c.carp.internals && c.carp.internals.lowerDoors ? doors(0, c.w, c.zone.y0, c.zone.y0 + 80, doorCount(c.w, c), c) : []),
  inner: (c) => shelvesEvenly(c.zone.y0 + c.t, c.zone.y1 - c.t, (c.carp.internals && c.carp.internals.shelves) ?? 5, c.t, c.w - c.t),
  model: (c) => ({ type: 'bookcase', params: { color: c.spec.carcass.colorHex, shelves: ((c.carp.internals && c.carp.internals.shelves) ?? 5) + 1, columns: 1, back: true, frame: 'panel', doors: c.carp.internals && c.carp.internals.lowerDoors ? doorCount(c.w, c) : 0 } }) });

// ───────── vanity, media, entry bench, shelves, desk ─────────
def({ id: 'vanity', level: 'base', code: 'V', carcass: 'base', worktop: true, cutout: 'basin', wallHung: true, kinds: ['vanity'], name: L('Wall-hung vanity', 'ארון אמבטיה תלוי'),
  w: { min: 40, max: 180, std: 80 }, internals: { group: null, default: { drawers: 2 } },
  fronts: (c) => drawers(0, c.w, c.zone.y0, c.zone.y1, nDrawers(c, 2), c), inner: () => [],
  model: (c) => ({ type: 'vanity', params: { basins: c.w >= 120 && c.carp.basins === 2 ? 2 : 1, variant: 'wall-hung', drawers: nDrawers(c, 2), doors: 0, basin: 'integrated',
    color: c.spec.fronts.colorHex, counterColor: c.spec.worktop.colorHex, counter: counterParam(c.spec), mirror: !!c.carp.mirror } }) });
def({ id: 'media-low', level: 'base', code: 'S', carcass: 'base', wallHung: true, kinds: ['media', 'shelving', 'entry'], name: L('Wall-hung low unit', 'מזנון תלוי'),
  w: { min: 40, max: 120, std: 100 }, internals: { group: null, default: { drawers: 1 } },
  fronts: (c) => [{ ...doors(0, c.w, c.zone.y0, c.zone.y1, 1, c)[0], kind: 'flap', hinge: 'B' }], inner: () => [],
  model: (c) => ({ type: 'cabinet', params: { color: c.spec.fronts.colorHex, doors: 0, drawers: 1, legs: 'wall', handles: handleParam(c.spec) } }) });
def({ id: 'media-shelf', level: 'wall', code: 'S', carcass: 'shelf', kinds: ['media', 'shelving', 'entry', 'custom'], name: L('Floating shelf', 'מדף צף'),
  w: { min: 30, max: 240, std: 120 }, fronts: () => [], inner: () => [],
  model: () => ({ type: 'shelf-wall', params: { shelves: 1, variant: 'floating' } }) });
def({ id: 'media-panel', level: 'wall', code: 'S', carcass: 'panel', kinds: ['media', 'custom'], name: L('TV back panel (cladding)', 'פאנל טלוויזיה (חיפוי)'),
  w: { min: 60, max: 400, std: 200 }, fronts: (c) => [{ kind: 'panel', x: 0, y: c.zone.y0, w: c.w, h: r1(c.zone.y1 - c.zone.y0) }], inner: () => [],
  model: (c) => boxModel(c, { legs: 'wall' }) });
def({ id: 'entry-bench', level: 'base', code: 'S', carcass: 'base', kinds: ['entry', 'custom'], name: L('Entry bench with shoe storage', 'ספסל כניסה עם אחסון נעליים'),
  w: { min: 60, max: 180, std: 120 }, internals: { group: null, default: { shelves: 1 } },
  fronts: (c) => [{ kind: 'open', x: 0, y: c.zone.y0, w: c.w, h: r1(c.zone.y1 - c.zone.y0) }],
  inner: (c) => shelvesEvenly(c.zone.y0, c.zone.y1, 1, 0, c.w).map((s) => ({ ...s, kind: 'shoe' })),
  model: (c) => ({ type: 'bench', params: { storage: true, color: c.spec.fronts.colorHex } }) });
def({ id: 'shelf', level: 'wall', code: 'S', carcass: 'shelf', kinds: ['shelving', 'kitchen', 'utility', 'custom', 'desk', 'vanity'], name: L('Wall shelf', 'מדף קיר'),
  w: { min: 20, max: 240, std: 90 }, fronts: () => [], inner: () => [], model: () => ({ type: 'shelf-wall', params: { shelves: 1, variant: 'floating' } }) });
def({ id: 'desk', level: 'base', code: 'D', carcass: 'desk', kinds: ['desk', 'custom'], name: L('Fitted desk top with drawer', 'שולחן עבודה בנוי עם מגירה'),
  w: { min: 80, max: 240, std: 140 }, fronts: (c) => [{ kind: 'drawer', x: r1(c.w - 60 + G / 2), y: r1(c.zone.y1 - 15), w: r1(60 - G), h: 15 - G, handle: true }],
  inner: () => [], model: () => ({ type: 'desk', params: { base: 'panel', drawers: 'right' } }) });
def({ id: 'custom', level: 'base', code: 'B', carcass: 'base', kinds: ['custom'], name: L('Custom unit (doors)', 'יחידה מיוחדת (דלתות)'),
  w: { min: 10, max: 120, std: 60 }, fronts: (c) => doors(0, c.w, c.zone.y0, c.zone.y1, doorCount(c.w, c), c), inner: () => [],
  model: (c) => boxModel(c, { doors: doorCount(c.w, c), legs: 'plinth', handles: handleParam(c.spec) }) });

// ───────── fillers and panels (any level: carp.level decides) ─────────
def({ id: 'filler', level: 'any', code: 'F', carcass: 'filler', worktop: true, kinds: Object.keys(VOCAB.runKind), name: L('Filler', 'פילר (השלמה)'),
  w: { min: RULES.fillerMin, max: RULES.fillerMax, std: 5 }, fronts: (c) => [{ kind: 'filler', x: 0, y: c.zone.y0, w: c.w, h: r1(c.zone.y1 - c.zone.y0) }], inner: () => [],
  model: (c) => (c.level === 'base' ? baseModel(c, { doors: 1, handles: 'none' }) : c.level === 'wall' ? wallModel(c, { doors: 1, handles: 'none' }) : boxModel(c, {})) });
def({ id: 'panel', level: 'any', code: 'P', carcass: 'panel', worktop: true, kinds: Object.keys(VOCAB.runKind), name: L('End panel', 'פאנל צד'),
  w: { min: 1.2, max: 8, std: 1.8 }, fronts: (c) => [{ kind: 'panel', x: 0, y: c.level === 'wall' ? c.zone.y0 : 0, w: c.w, h: r1(c.level === 'wall' ? c.zone.y1 - c.zone.y0 : c.h - (c.level === 'base' || c.level === 'island' ? c.H.wt : 0)) }], inner: () => [],
  model: (c) => boxModel(c, {}) });

/** Modules offered for a run kind and level (for pickers). */
export function modulesFor(kind, level) {
  return Object.values(MODULES).filter((m) => (!kind || m.kinds.includes(kind)) && (!level || m.level === level || m.level === 'any'));
}

/** Split `total` into n widths (cm, 0.1 precision) that sum exactly, larger first. */
export function splitEven(total, n) {
  n = Math.max(1, n | 0);
  const tenth = Math.round(total * 10), base = Math.floor(tenth / n), rest = tenth - base * n;
  const out = [];
  // whole-cm widths when possible: work in tenths but prefer whole numbers
  if (tenth % 10 === 0) {
    const cm = tenth / 10, b = Math.floor(cm / n), r = cm - b * n;
    for (let i = 0; i < n; i++) out.push(b + (i < r ? 1 : 0));
    return out;
  }
  for (let i = 0; i < n; i++) out.push((base + (i < rest ? 1 : 0)) / 10);
  return out;
}

// Helpers shared with bespoke.js (bespoke units, door operations, corner pantries).
export { doors, drawers, shelvesEvenly, tallDoors, baseModel, wallModel, tallModel, robeModel, boxModel, handleParam, counterParam, def, doorCount, app };
