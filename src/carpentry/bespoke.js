/**
 * Bespoke carpentry: door operations on any unit, corner modules that occupy the corner square on BOTH arms
 * (tall corner pantry, diagonal base / wall corners), and the free-form unit composer (`custom` + carp.internals.layout).
 * Registers its modules into MODULES on import (layout.js imports it).
 */
import { MODULES, doors, drawers, shelvesEvenly, baseModel, wallModel, tallModel, robeModel, boxModel, def, app, APPLIANCE_LABELS } from './modules.js';
import { RULES, VOCAB } from './spec.js';

const L = (en, he) => ({ en, he });
const G = RULES.frontGap;
const r1 = (v) => Math.round(v * 100) / 100;
const DOORISH = new Set(['door', 'glass', 'mirror']);
const ALL_KINDS = Object.keys(VOCAB.runKind);

// ───────────────────────── door operations ─────────────────────────
/** Hardware each operation needs instead of / besides hinges (kinds used by the take-off). */
export const OPERATION_HARDWARE = {
  hinged: 'hinge', removable: 'lift-off-hinge', sliding: 'sliding-set', pocket: 'pocket-system', bifold: 'bifold-set',
  tambour: 'tambour-kit', 'lift-up': 'liftup', 'drop-down': 'flap-stay', 'push-open': 'hinge', curtain: 'curtain-track', none: null,
};
/** Operations whose exact fitting is the carpenter's choice. */
export const BY_CARPENTER = new Set(['removable', 'pocket', 'bifold', 'tambour', 'curtain']);

/**
 * Give every door-type front an `operation` (front's own, else the unit's carp.fronts.operation, else 'hinged') and apply its
 * effect on the front list: none → open; lift-up / drop-down → flap; push-open → no handle; tambour / curtain → one front per row.
 */
export function applyOperation(fronts, unitOp) {
  const out = [];
  for (const f0 of fronts) {
    const f = { ...f0 };
    if (f.kind === 'flap' && !f.operation) f.operation = f.hinge === 'B' ? 'drop-down' : 'lift-up';
    if (!DOORISH.has(f.kind) && !(f.kind === 'flap')) { out.push(f); continue; }
    const op = f.operation || unitOp || 'hinged';
    f.operation = op;
    if (op === 'none') { f.kind = 'open'; f.handle = false; }
    else if (op === 'lift-up') { f.kind = 'flap'; f.hinge = 'T'; }
    else if (op === 'drop-down') { f.kind = 'flap'; f.hinge = 'B'; }
    else if (op === 'push-open' || op === 'curtain') f.handle = false;
    if (op === 'tambour' || op === 'curtain') {
      const prev = out.find((p) => p.operation === op && p.cellId === f.cellId && Math.abs(p.y - f.y) < 0.01 && Math.abs(p.h - f.h) < 0.01 && Math.abs(p.x + p.w + G - f.x) < 0.05);
      if (prev) { prev.w = r1(f.x + f.w - prev.x); continue; }
    }
    out.push(f);
  }
  return out;
}

// ───────────────────────── corner modules ─────────────────────────
/** Polygon (corner-local u along this run from the corner, v from this run's wall) and the front faces. */
export function cornerShape(variant, legA, legB, dA, dB) {
  const poly = variant === 'l-doors' ? [[0, 0], [legA, 0], [legA, dA], [dB, dA], [dB, legB], [0, legB]] : [[0, 0], [legA, 0], [legA, dA], [dB, legB], [0, legB]];
  const faces = variant === 'l-doors'
    ? [{ id: 'A', a: [legA, dA], b: [dB, dA], len: r1(legA - dB) }, { id: 'B', a: [dB, dA], b: [dB, legB], len: r1(legB - dA) }]
    : [{ id: 'diag', a: [legA, dA], b: [dB, legB], len: r1(Math.hypot(legA - dB, legB - dA)) }];
  return { poly, faces };
}
/** Shoelace area of a polygon. */
export const polyArea = (pts) => Math.abs(pts.reduce((s, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

/** Door split for a face of width W over y0..y1 (same rule as tall doors: split at the base-front line above 200 cm). */
function faceDoors(x0, x1, y0, y1, n, c, extra = {}) {
  const split = y1 - y0 > 200 ? c.H.worktop - c.H.wt - RULES.topGap : null;
  const rows = split ? [[y0, split], [split + G, y1]] : [[y0, y1]];
  return rows.flatMap(([a, b]) => doors(x0, x1, a, b, n, c).map((f) => ({ ...f, ...extra })));
}

/** Prepare c.corner for a corner module (called by geometryOf before fronts). */
function prepareCorner(c, variant, legB, dA, dB) {
  const legA = c.w, side = c.carp.cornerSide || 'L';
  const { poly, faces } = cornerShape(variant, legA, legB, dA, dB);
  const X = (u) => (side === 'L' ? u : c.w - u);
  c.corner = { variant, side, legA, legB, dA, dB, poly, faces, X };
}
function cornerFronts(c) {
  const k = c.corner, { y0, y1 } = c.zone, X = k.X, side = k.side;
  const lo = Math.min(X(0), X(k.dB)), hi = Math.max(X(0), X(k.dB));
  const out = [{ kind: 'panel', x: r1(lo), y: y0, w: r1(hi - lo), h: r1(y1 - y0), role: 'corner-end' }];
  const a = Math.min(X(k.dB), X(k.legA)), b = Math.max(X(k.dB), X(k.legA));
  const n = k.variant === 'walk-in' ? 1 : (k.faces[0].len > 60 ? 2 : 1);
  const hinge = side === 'L' ? 'R' : 'L';                         // hinges away from the inside corner
  const cc = { ...c, carp: { ...c.carp, fronts: { ...(c.carp.fronts || {}), hinge } } };
  out.push(...(c.level === 'tall' ? faceDoors(a, b, y0, y1, n, cc) : doors(a, b, y0, y1, n, cc)).map((f) => ({ ...f, face: k.faces[0].id, projected: k.variant !== 'l-doors' })));
  return out;
}
/** True-size fronts of every face (for the take-off), with `face`. */
export function cornerTrueFronts(c) {
  const k = c.corner, { y0, y1 } = c.zone, out = [];
  for (const f of k.faces) {
    let w = f.len, n = f.len > 60 ? 2 : 1;
    if (k.variant === 'walk-in') { n = 1; w = Math.min(f.len, 80); }
    const cc = { ...c, carp: { ...c.carp, fronts: { ...(c.carp.fronts || {}), hinge: 'R' } } };
    const list = c.level === 'tall' ? faceDoors(0, w, y0, y1, n, cc) : doors(0, w, y0, y1, n, cc);
    out.push(...list.map((x) => ({ ...x, face: f.id })));
    if (k.variant === 'walk-in' && f.len - w > 1) out.push({ kind: 'panel', face: f.id, x: w, y: y0, w: r1(f.len - w), h: r1(y1 - y0) });
  }
  return out;
}

def({ id: 'tall-corner-pantry', level: 'tall', code: 'T', carcass: 'corner', corner: true, kinds: ['kitchen', 'pantry', 'utility'], name: L('Tall corner pantry', 'מזווה פינתי גבוה'),
  w: { min: 70, max: 160, std: 90 }, internals: { group: 'cornerPantry', default: { cornerPantry: 'l-doors', shelves: 5 }, options: Object.keys(VOCAB.cornerPantry) },
  cornerLeg: (carp) => carp.legB ?? 90,
  prepare: (c) => { const d = c.dc + c.frontD; prepareCorner(c, (c.carp.internals && c.carp.internals.cornerPantry) || 'l-doors', c.carp.legB ?? 90, d, d); },
  fronts: cornerFronts,
  inner: (c) => shelvesEvenly(c.zone.y0 + c.t, c.zone.y1 - c.t, (c.carp.internals && c.carp.internals.shelves) ?? 5, 0, c.w).map((s) => ({ ...s, shaped: true })),
  model: (c) => tallModel(c, { doors: 2 }) });
def({ id: 'base-corner-diagonal', level: 'base', code: 'B', carcass: 'corner', worktop: true, corner: true, kinds: ['kitchen', 'utility'], name: L('Diagonal base corner unit', 'ארון פינה תחתון אלכסוני'),
  w: { min: 80, max: 100, std: 90 }, internals: { group: null, default: { shelves: 1 } },
  cornerLeg: (carp) => carp.width,
  prepare: (c) => { const d = c.dc + c.frontD; prepareCorner(c, 'diagonal', c.w, d, d); },
  fronts: cornerFronts, inner: (c) => shelvesEvenly(c.zone.y0, c.zone.y1, 1, 0, c.w).map((s) => ({ ...s, shaped: true })),
  model: (c) => baseModel(c, { corner: true, doors: 1 }) });
def({ id: 'wall-corner-diagonal', level: 'wall', code: 'W', carcass: 'corner', corner: true, kinds: ['kitchen'], name: L('Diagonal wall corner unit', 'ארון פינה עליון אלכסוני'),
  w: { min: 55, max: 75, std: 65 }, internals: { group: null, default: { shelves: 2 } },
  prepare: (c) => { const d = c.dc + c.frontD; prepareCorner(c, 'diagonal', c.w, d, d); },
  fronts: cornerFronts, inner: (c) => shelvesEvenly(c.zone.y0, c.zone.y1, 2, 0, c.w).map((s) => ({ ...s, shaped: true })),
  model: (c) => wallModel(c, { doors: 1 }) });
// the L-corner carousel now reserves its leg on the other arm too
MODULES['base-corner-carousel'].cornerLeg = (carp) => carp.width;

// ───────────────────────── bespoke composer ─────────────────────────
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const flexW = (o) => (isNum(o.flex) ? o.flex : o.flex === true || (!isNum(o.w) && !isNum(o.h)) ? 1 : 0);
/** Split `total` among items with fixed `key` sizes or flex weights. Returns sizes or null + error. */
function share(items, key, total) {
  const fixed = items.reduce((s, it) => s + (isNum(it[key]) ? it[key] : 0), 0), wsum = items.reduce((s, it) => s + (isNum(it[key]) ? 0 : flexW(it)), 0);
  const rest = total - fixed;
  if (rest < -0.05) return { err: 'over', amount: r1(-rest) };
  if (!wsum && Math.abs(rest) > 0.5) return { err: 'under', amount: r1(rest) };
  return { sizes: items.map((it) => (isNum(it[key]) ? it[key] : (rest * flexW(it)) / (wsum || 1))) };
}
/**
 * Validate a bespoke layout for a front area w × h (cm). Returns [] or a list of { en, he } reasons.
 * layout = { columns: [{ w | flex, cells: [{ h | flex, kind, operation?, count?, hinge?, shelves?, label?, note? }] }] } (cells bottom → top)
 */
export function validateCustomLayout(layout, w, h) {
  const errs = [], E = (en, he) => errs.push(L(en, he));
  if (!layout || !Array.isArray(layout.columns) || !layout.columns.length) { E('The layout needs at least one column.', 'החלוקה צריכה לפחות עמודה אחת.'); return errs; }
  const cw = share(layout.columns, 'w', w);
  if (cw.err) { E(`Column widths ${cw.err === 'over' ? 'exceed' : 'do not fill'} the unit width ${w} cm by ${cw.amount} cm.`, `רוחבי העמודות ${cw.err === 'over' ? 'חורגים מ' : 'אינם ממלאים את '}רוחב היחידה ${w} ס״מ ב-${cw.amount} ס״מ.`); return errs; }
  layout.columns.forEach((col, i) => {
    if (cw.sizes[i] < RULES.customMinColumn) E(`Column ${i + 1} is ${r1(cw.sizes[i])} cm — at least ${RULES.customMinColumn} cm.`, `עמודה ${i + 1} ברוחב ${r1(cw.sizes[i])} ס״מ — מינימום ${RULES.customMinColumn} ס״מ.`);
    if (!Array.isArray(col.cells) || !col.cells.length) { E(`Column ${i + 1} has no cells.`, `לעמודה ${i + 1} אין תאים.`); return; }
    const ch = share(col.cells, 'h', h);
    if (ch.err) { E(`Column ${i + 1}: cell heights ${ch.err === 'over' ? 'exceed' : 'do not fill'} the ${r1(h)} cm front height by ${ch.amount} cm.`, `עמודה ${i + 1}: גובהי התאים ${ch.err === 'over' ? 'חורגים מ' : 'אינם ממלאים את '}גובה החזית ${r1(h)} ס״מ ב-${ch.amount} ס״מ.`); return; }
    col.cells.forEach((cell, k) => {
      if (!VOCAB.cellKind[cell.kind]) E(`Column ${i + 1}, cell ${k + 1}: unknown kind "${cell.kind}".`, `עמודה ${i + 1}, תא ${k + 1}: סוג לא מוכר "${cell.kind}".`);
      if (cell.operation && !VOCAB.doorOperation[cell.operation]) E(`Column ${i + 1}, cell ${k + 1}: unknown door operation "${cell.operation}".`, `עמודה ${i + 1}, תא ${k + 1}: אופן פתיחה לא מוכר "${cell.operation}".`);
      const min = ['door', 'glass'].includes(cell.kind) ? RULES.customMinDoor : RULES.customMinCell;
      if (ch.sizes[k] < min - 0.01) E(`Column ${i + 1}, cell ${k + 1} (${cell.kind}) is ${r1(ch.sizes[k])} cm high — at least ${min} cm.`, `עמודה ${i + 1}, תא ${k + 1} (${VOCAB.cellKind[cell.kind] ? VOCAB.cellKind[cell.kind].he : cell.kind}) בגובה ${r1(ch.sizes[k])} ס״מ — מינימום ${min} ס״מ.`);
      if (cell.kind === 'drawers' && ch.sizes[k] / Math.max(1, cell.count || 3) < 10) E(`Column ${i + 1}, cell ${k + 1}: ${cell.count || 3} drawers in ${r1(ch.sizes[k])} cm are under 10 cm each.`, `עמודה ${i + 1}, תא ${k + 1}: ${cell.count || 3} מגירות ב-${r1(ch.sizes[k])} ס״מ — פחות מ-10 ס״מ כל אחת.`);
    });
  });
  return errs;
}
/** Laid-out columns / cells in unit coordinates: [{ x0, x1, cells: [{ id, ya, yb, cell }] }]. */
export function layoutGrid(layout, w, y0, y1) {
  const cw = share(layout.columns, 'w', w).sizes;
  let x = 0;
  return layout.columns.map((col, i) => {
    const ch = share(col.cells, 'h', y1 - y0).sizes;
    let y = y0;
    const cells = col.cells.map((cell, k) => { const c = { id: `${i + 1}.${k + 1}`, ya: r1(y), yb: r1(y + ch[k]), cell }; y += ch[k]; return c; });
    const out = { x0: r1(x), x1: r1(x + cw[i]), cells };
    x += cw[i];
    return out;
  });
}
const label = (l) => (typeof l === 'string' ? L(l, l) : l || null);
function customFronts(c) {
  const lay = c.carp.internals && c.carp.internals.layout;
  if (!lay || validateCustomLayout(lay, c.w, c.zone.y1 - c.zone.y0).length) return doors(0, c.w, c.zone.y0, c.zone.y1, c.w > 60 ? 2 : 1, c);
  const out = [];
  for (const col of layoutGrid(lay, c.w, c.zone.y0, c.zone.y1)) {
    col.cells.forEach((cl, k) => {
      const cell = cl.cell, top = k === col.cells.length - 1, yb = top ? cl.yb : cl.yb - G, tag = (f) => ({ ...f, cellId: cl.id, ...(cell.operation && DOORISH.has(f.kind) ? { operation: cell.operation } : {}) });
      const cc = cell.hinge ? { ...c, carp: { ...c.carp, fronts: { ...(c.carp.fronts || {}), hinge: cell.hinge } } } : c;
      const cw = col.x1 - col.x0;
      if (cell.kind === 'door' || cell.kind === 'glass') out.push(...doors(col.x0, col.x1, cl.ya, yb, cell.count || (cw > 60 ? 2 : 1), cc, cell.kind).map(tag));
      else if (cell.kind === 'drawer' || cell.kind === 'pullout') out.push(...drawers(col.x0, col.x1, cl.ya, yb, 1, c).map(tag));
      else if (cell.kind === 'drawers') out.push(...drawers(col.x0, col.x1, cl.ya, yb, cell.count || 3, c).map(tag));
      else if (cell.kind === 'appliance') out.push(tag(app(label(cell.label) || APPLIANCE_LABELS.space, col.x0 + G / 2, cl.ya, cw - G, yb - cl.ya)));
      else out.push(tag({ kind: cell.kind === 'void' ? 'void' : cell.kind, x: r1(col.x0), y: r1(cl.ya), w: r1(cw), h: r1(yb - cl.ya), ...(cell.label ? { label: label(cell.label) } : {}) }));
    });
  }
  return out;
}
function customInner(c) {
  const lay = c.carp.internals && c.carp.internals.layout;
  if (!lay || validateCustomLayout(lay, c.w, c.zone.y1 - c.zone.y0).length) return [];
  const grid = layoutGrid(lay, c.w, c.zone.y0, c.zone.y1), out = [], t = c.t;
  const [cy0, cy1] = c.carcassY, drawerish = (k) => ['drawer', 'drawers', 'pullout'].includes(k);
  grid.forEach((col, i) => {
    if (i > 0) out.push({ kind: 'divider', y: r1(cy0 + t), h: r1(cy1 - cy0 - 2 * t), x0: col.x0, x1: col.x0 });
    col.cells.forEach((cl, k) => {
      const nxt = col.cells[k + 1];
      if (nxt && !(drawerish(cl.cell.kind) && drawerish(nxt.cell.kind))) out.push({ kind: 'shelf', y: cl.yb, x0: col.x0, x1: col.x1, fixed: true, cellId: cl.id });
      if (['open', 'door', 'glass'].includes(cl.cell.kind) && cl.cell.shelves) out.push(...shelvesEvenly(cl.ya, cl.yb, cl.cell.shelves, col.x0, col.x1).map((s) => ({ ...s, cellId: cl.id, ...(cl.cell.kind === 'glass' ? { glass: false } : {}) })));
      if (cl.cell.kind === 'pullout') out.push({ kind: 'pullout', variant: 'custom', y: cl.ya, h: r1(cl.yb - cl.ya), x0: col.x0, x1: col.x1, cellId: cl.id });
    });
  });
  return out;
}
function customModel(c) {
  const f = c.fronts || customFronts(c);
  const nDoors = f.filter((x) => DOORISH.has(x.kind) && x.operation !== 'none').length, nDr = f.filter((x) => x.kind === 'drawer').length, open = f.some((x) => x.kind === 'open');
  if (c.level === 'wall') return wallModel(c, { doors: nDoors, open: !nDoors && open });
  if (c.level === 'tall') return tallModel(c, { doors: Math.max(1, nDoors) });
  if (c.level === 'full') return robeModel(c, { doors: nDoors, open: !nDoors });
  return baseModel(c, { doors: nDoors, drawers: nDr });
}
def({ id: 'custom', level: 'any', code: 'B', carcass: 'custom', kinds: ALL_KINDS, name: L('Bespoke unit (free layout)', 'יחידה בהתאמה אישית (חלוקה חופשית)'),
  w: { min: 10, max: 300, std: 60 }, internals: { group: null, default: {} },
  fronts: customFronts, inner: customInner, model: customModel });

/** Starter layouts → addUnit options ({ module: 'custom', level, width, h, depth?, elev?, worktop?, internals: { layout } }). */
export const CUSTOM_TEMPLATES = {
  'appliance-garage': { name: L('Appliance garage with tambour shutter', 'מוסך מכשירים עם תריס גלילה'), level: 'wall', width: 60, h: 55, elev: 92, depth: 35,
    layout: { columns: [{ flex: 1, cells: [{ flex: 1, kind: 'door', operation: 'tambour', shelves: 0, label: L('Coffee machine, toaster', 'מכונת קפה, טוסטר') }] }] } },
  'open-shelves-drawers': { name: L('Drawers below, open shelf above', 'מגירות למטה, מדף פתוח למעלה'), level: 'base', width: 90, h: 90, worktop: true,
    layout: { columns: [{ flex: 1, cells: [{ h: 50, kind: 'drawers', count: 2 }, { flex: 1, kind: 'open', shelves: 0 }] }] } },
  'tall-larder-drawers': { name: L('Tall larder with internal drawers', 'מזווה גבוה עם מגירות פנימיות'), level: 'tall', width: 60, h: 220,
    layout: { columns: [{ flex: 1, cells: [{ h: 80, kind: 'drawers', count: 3 }, { flex: 1, kind: 'door', shelves: 4 }] }] } },
  'window-seat': { name: L('Window seat with drawers', 'ספסל חלון עם מגירות'), level: 'base', width: 120, h: 45, depth: 48,
    layout: { columns: [{ flex: 1, cells: [{ flex: 1, kind: 'drawers', count: 2 }] }, { flex: 1, cells: [{ flex: 1, kind: 'drawers', count: 2 }] }] } },
  'bar-niche': { name: L('Bar niche between cupboards', 'נישת בר בין ארונות'), level: 'tall', width: 80, h: 220,
    layout: { columns: [{ flex: 1, cells: [{ h: 78, kind: 'door', count: 2 }, { h: 45, kind: 'void', label: L('Bar niche, LED', 'נישת בר, תאורת לד') }, { flex: 1, kind: 'glass', count: 2, shelves: 2 }] }] } },
};
/** A starter layout by name (deep copy), or null. */
export function customLayoutTemplate(name) {
  const t = CUSTOM_TEMPLATES[name];
  if (!t) return null;
  const { layout, name: label0, ...rest } = JSON.parse(JSON.stringify(t));
  return { module: 'custom', ...rest, internals: { layout }, note: label0.en, label: label0 };
}

/** Rebuild a bespoke layout reproducing a geometry's fronts (used by toCustom). */
export function frontsToLayout(g) {
  const fr = g.fronts.filter((f) => f.kind !== 'filler');
  const W = g.w, zone = g.zone;
  // column cuts: points where no front crosses
  const cuts = [0, W, ...fr.map((f) => r1(f.x + f.w + G / 2))].filter((p) => p >= 0 && p <= W + 0.01 && fr.every((f) => !(f.x - G / 2 < p - 0.05 && f.x + f.w + G / 2 > p + 0.05)));
  const xs = [...new Set(cuts.map((p) => r1(Math.min(W, p))))].sort((a, b) => a - b);
  const columns = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1];
    const inCol = fr.filter((f) => f.x >= a - 0.05 && f.x + f.w <= b + 0.05).sort((p, q) => p.y - q.y);
    const rows = [];
    for (const f of inCol) { const r = rows.find((x) => Math.abs(x.y - f.y) < 0.05 && Math.abs(x.h - f.h) < 0.05); if (r) r.list.push(f); else rows.push({ y: f.y, h: f.h, list: [f] }); }
    rows.sort((p, q) => p.y - q.y);
    // merge stacked equal drawers
    const groups = [];
    for (const r of rows) {
      const k = r.list[0].kind, last = groups[groups.length - 1];
      if (k === 'drawer' && r.list.length === 1 && last && last.kind === 'drawer' && Math.abs(last.h - r.h) < 0.05) { last.count++; last.top = r.y + r.h; continue; }
      groups.push({ kind: k, y: r.y, h: r.h, top: r.y + r.h, count: k === 'drawer' ? 1 : r.list.length, f: r.list[0] });
    }
    const cells = groups.map((gq, k) => {
      const ya = k === 0 ? zone.y0 : gq.y, yb = k === groups.length - 1 ? zone.y1 : groups[k + 1].y;
      const f = gq.f, cell = {};
      if (f.kind === 'drawer') Object.assign(cell, gq.count > 1 ? { kind: 'drawers', count: gq.count } : { kind: 'drawer' });
      else if (f.kind === 'door' || f.kind === 'mirror') Object.assign(cell, { kind: 'door', count: gq.count, ...(gq.count === 1 && f.hinge ? { hinge: f.hinge } : {}), ...(f.operation && f.operation !== 'hinged' ? { operation: f.operation } : {}) });
      else if (f.kind === 'glass') Object.assign(cell, { kind: 'glass', count: gq.count });
      else if (f.kind === 'flap') Object.assign(cell, { kind: 'door', count: 1, operation: f.hinge === 'B' ? 'drop-down' : 'lift-up' });
      else if (f.kind === 'appliance') Object.assign(cell, f.panel ? { kind: 'door', count: 1, label: f.label } : { kind: 'appliance', label: f.label });
      else if (f.kind === 'open') cell.kind = 'open';
      else if (f.kind === 'panel' || f.kind === 'blind') cell.kind = 'panel';
      else cell.kind = 'void';
      if (k === groups.length - 1) cell.flex = 1; else cell.h = r1(yb - ya);
      return cell;
    });
    if (!cells.length) cells.push({ flex: 1, kind: 'panel' });
    columns.push(i === xs.length - 2 ? { flex: 1, cells } : { w: r1(b - a), cells });
  }
  return { columns };
}
