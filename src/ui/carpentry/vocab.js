/**
 * Carpentry UI vocabulary: kind / level labels and icons, starter units per run kind, colour presets, module glyphs and
 * small formatting helpers shared by every carpentry panel. Engine labels always come from Carp.VOCAB (English side).
 */
import * as Carp from '../../carpentry/index.js';

/** Run kinds in the order the "New run" picker offers them. `hint` = what the owner gets. */
export const KINDS = [
  { id: 'kitchen', label: 'Kitchen run', icon: 'kitchen', hint: 'Base and wall units along a wall' },
  { id: 'island', label: 'Kitchen island', icon: 'island', hint: 'Free-standing, click in a room' },
  { id: 'wardrobe', label: 'Wardrobe / closet', icon: 'wardrobe', hint: 'Full height, top boxes to the ceiling' },
  { id: 'pantry', label: 'Pantry', icon: 'pantry', hint: 'Tall larder and pantry units' },
  { id: 'vanity', label: 'Vanity', icon: 'bath', hint: 'Wall-hung bathroom unit' },
  { id: 'utility', label: 'Laundry / utility', icon: 'laundry', hint: 'Washer spaces, utility cupboards' },
  { id: 'media', label: 'TV wall', icon: 'tv', hint: 'Low unit, shelves, back panel' },
  { id: 'entry', label: 'Entry closet', icon: 'entry', hint: 'Coats and shoes by the door' },
  { id: 'shelving', label: 'Shelving / bookcase', icon: 'shelving', hint: 'Bookcases and wall shelves' },
  { id: 'desk', label: 'Fitted desk', icon: 'desk', hint: 'Desk top with a drawer' },
  { id: 'custom', label: 'Custom', icon: 'carpentry', hint: 'Anything else, to describe' },
];
export const kindInfo = (kind) => KINDS.find((k) => k.id === kind) || KINDS[KINDS.length - 1];

/** Level groups of the module palette. */
export const LEVEL_GROUPS = [
  { id: 'bespoke', label: 'Bespoke — anything you can describe' },
  { id: 'base', label: 'Base' }, { id: 'wall', label: 'Wall' }, { id: 'tall', label: 'Tall' },
  { id: 'full', label: 'Full height' }, { id: 'island', label: 'Island' }, { id: 'any', label: 'Other' },
];
export const levelLabel = (lvl) => (Carp.VOCAB.level[lvl] ? Carp.VOCAB.level[lvl].en : lvl === 'any' ? 'Filler / panel' : lvl);

/** English label of a vocabulary value. */
export const en = (group, key) => Carp.vocab(group, key).en;
/** Text of a bilingual value (string or { en }). */
export const txt = (v) => (v == null ? '' : typeof v === 'object' ? v.en || '' : String(v));

/** "1.5" / "92.2" — whole numbers without decimals. */
export const num = (v) => { const x = Math.round(v * 10) / 10; return Number.isInteger(x) ? String(x) : x.toFixed(1); };
export const cm = (v) => `${num(v)} cm`;
/** "5.50 m" */
export const metres = (v) => `${(v / 100).toFixed(2)} m`;

/**
 * Starter units for a new run of `kind` on a free stretch of `length` cm (greedy: as many as fit; "Fit to wall" spreads
 * the rest). `windows` = the stretch has windows (no wall units in a kitchen then).
 */
export function starterUnits(kind, length, { windows = false } = {}) {
  const T = {
    kitchen: ['base-drawers:60', 'base-sink:80', 'base-dishwasher:60', 'base-door:60', 'base-hob:60', 'base-drawers:60', 'base-door:60'],
    pantry: ['tall-pantry:60', 'tall-pantry:60', 'tall-pantry:50', 'tall-utility:50'],
    wardrobe: ['wardrobe-hinged:100', 'wardrobe-hinged:100', 'wardrobe-hinged:100', 'wardrobe-hinged:100'],
    vanity: ['vanity:80'],
    utility: ['base-space:60', 'base-space:60', 'base-door:60', 'tall-utility:50'],
    media: ['media-low:120', 'media-low:120'],
    entry: ['entry-closet:90', 'entry-closet:90'],
    shelving: ['bookcase:80', 'bookcase:80', 'bookcase:80', 'bookcase:80'],
    desk: ['desk:140'],
    custom: ['custom:60', 'custom:60'],
  }[kind] || ['custom:60'];
  const out = [];
  let used = 0;
  for (const s of T) {
    const [module, w] = s.split(':'), width = +w;
    if (used + width > length + 0.01) break;
    out.push({ module, width }); used += width;
  }
  if (!out.length) {
    const [module] = T[0].split(':'), m = Carp.MODULES[module];
    const width = Math.max(m.w.min, Math.min(m.w.max, Math.floor(length)));
    if (width <= length) out.push({ module, width });
  }
  // A kitchen wall row over the worktop, when the stretch has no window in the way.
  if (kind === 'kitchen' && !windows) {
    let wu = 0;
    for (const w of [60, 80, 60, 60, 80]) { if (wu + w > Math.min(used, length) + 0.01) break; out.push({ module: 'wall-door', width: w }); wu += w; }
  }
  if (kind === 'media' && length >= 120) out.push({ module: 'media-shelf', width: Math.min(240, Math.floor(length / 10) * 10 - 20 > 120 ? 180 : 120) });
  if (kind === 'desk' && length >= 90) out.push({ module: 'shelf', width: Math.min(140, Math.floor(length)) });
  return out;
}

/** Front / carcass colour presets (warm, realistic carpentry colours). */
export const FRONT_COLOURS = [
  ['Warm white', '#f3f1ec'], ['Pure white', '#fbfbf9'], ['Cashmere', '#d9d0c1'], ['Greige', '#b9b2a6'], ['Stone grey', '#8d8c86'],
  ['Anthracite', '#3a3d42'], ['Black', '#1e1f21'], ['Sage', '#9aa58f'], ['Forest green', '#4f5d4a'], ['Navy', '#2f3e55'],
  ['Natural oak', '#c8a476'], ['Walnut', '#7a5338'],
];
export const WORKTOP_COLOURS = [
  ['White quartz', '#e7e4de'], ['Calacatta', '#eeebe6'], ['Concrete grey', '#a9a6a0'], ['Basalt', '#4a4b4d'], ['Black', '#222325'],
  ['Travertine', '#d8ccb6'], ['Oak', '#c29b6b'], ['Steel', '#c9ccd0'],
];
export const CARCASS_COLOURS = [['White', '#f3f1ec'], ['Light grey', '#d9d9d6'], ['Anthracite', '#3a3d42'], ['Oak', '#c8a476']];

/** Common standard widths offered as chips (filtered by the module's min / max). */
export const STD_WIDTHS = [15, 20, 30, 40, 45, 50, 60, 80, 90, 100, 120];

/** Severity → token / label / icon. */
export const SEV = {
  error: { label: 'Errors', one: 'error', icon: 'fail', cls: 'fail' },
  warning: { label: 'Warnings', one: 'warning', icon: 'warn', cls: 'warn' },
  info: { label: 'Advice', one: 'note', icon: 'info', cls: 'info' },
};

/** Room name for a run. */
export function roomName(plan, roomId) {
  const r = [...(plan.rooms || []), ...(plan.outdoorAreas || [])].find((s) => s.id === roomId);
  return r ? r.name : 'Other';
}

/**
 * Small schematic of a module (front view) as an SVG string, 40 × 40 viewBox. Strokes use currentColor.
 * Kept deliberately simple: the elevation shows the real thing.
 */
export function moduleGlyph(id) {
  const r = (x, y, w, h, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${extra}/>`;
  const l = (x1, y1, x2, y2, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${extra}/>`;
  const c = (cx, cy, rr) => `<circle cx="${cx}" cy="${cy}" r="${rr}"/>`;
  const dash = 'stroke-dasharray="2 1.6"';
  const base = (inner) => r(8, 14, 24, 20) + l(8, 34, 32, 34) + inner;            // carcass under a worktop line
  const wt = l(6, 14, 34, 14, 'stroke-width="2"');
  const G = {
    'base-door': wt + base(l(20, 14, 20, 34) + l(17, 19, 17, 23) + l(23, 19, 23, 23)),
    'base-drawers': wt + base(l(8, 20.5, 32, 20.5) + l(8, 27, 32, 27) + l(17, 17, 23, 17) + l(17, 23.5, 23, 23.5) + l(17, 30, 23, 30)),
    'base-sink': wt + base(l(20, 14, 20, 34)) + `<path d="M13 14v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>` + l(20, 9, 20, 13) + l(20, 9, 23, 9),
    'base-hob': wt + base(l(8, 21, 32, 21) + l(8, 27.5, 32, 27.5)) + l(11, 11, 15, 11) + l(18, 11, 22, 11) + l(25, 11, 29, 11),
    'base-oven': wt + base(r(10, 16, 20, 12, 'rx="1"') + l(13, 19, 27, 19)),
    'base-dishwasher': wt + base(l(8, 18, 32, 18) + l(16, 16, 24, 16)) + `<text x="20" y="29" font-size="6" text-anchor="middle" stroke="none" fill="currentColor">DW</text>`,
    'base-pullout': wt + r(15, 14, 10, 20) + l(18, 17, 22, 17),
    'base-bin': wt + base(l(16, 17, 24, 17) + r(13, 21, 6, 9, dash) + r(21, 21, 6, 9, dash)),
    'base-corner-blind': wt + base(r(8, 14, 10, 20, 'fill="currentColor" fill-opacity=".14"') + l(25, 19, 25, 23)),
    'base-corner-carousel': wt + base(c(20, 24, 6) + l(20, 18, 20, 30)),
    'base-open': wt + base(l(8, 24, 32, 24)),
    'base-space': r(9, 14, 22, 20, dash) + c(20, 24, 5),
    'wall-door': r(8, 6, 24, 18) + l(20, 6, 20, 24) + l(17, 19, 17, 22) + l(23, 19, 23, 22) + l(6, 34, 34, 34, 'stroke-width="2"'),
    'wall-liftup': r(8, 6, 24, 18) + l(16, 21, 24, 21) + `<path d="M10 6l10 6 10-6" ${dash}/>` + l(6, 34, 34, 34, 'stroke-width="2"'),
    'wall-glass': r(8, 6, 24, 18) + l(20, 6, 20, 24) + r(11, 9, 6, 12, 'fill="currentColor" fill-opacity=".12"') + r(23, 9, 6, 12, 'fill="currentColor" fill-opacity=".12"') + l(6, 34, 34, 34, 'stroke-width="2"'),
    'wall-open': r(8, 6, 24, 18) + l(8, 15, 32, 15) + l(6, 34, 34, 34, 'stroke-width="2"'),
    'wall-hood': `<path d="M8 6h24v12H8z"/>` + `<path d="M8 18l-2 6h28l-2-6"/>` + l(6, 34, 34, 34, 'stroke-width="2"'),
    'wall-microwave': r(8, 6, 24, 18) + r(10, 15, 20, 7, 'rx="1"') + l(6, 34, 34, 34, 'stroke-width="2"'),
    'wall-corner': r(8, 6, 24, 18) + r(8, 6, 9, 18, 'fill="currentColor" fill-opacity=".14"') + l(6, 34, 34, 34, 'stroke-width="2"'),
    'wall-void': r(8, 6, 24, 18, dash) + l(6, 34, 34, 34, 'stroke-width="2"'),
    'tall-pantry': r(12, 3, 16, 34) + l(12, 21, 28, 21) + l(25, 9, 25, 13) + l(25, 25, 25, 29),
    'tall-oven': r(12, 3, 16, 34) + r(13.5, 16, 13, 9, 'rx="1"') + r(13.5, 9, 13, 5.5, 'rx="1"') + l(12, 30, 28, 30),
    'tall-fridge': r(12, 3, 16, 34) + l(12, 24, 28, 24) + l(12, 8, 28, 8) + l(25, 12, 25, 18) + l(25, 27, 25, 31),
    'tall-fridge-niche': r(12, 3, 16, 9) + r(13, 13, 14, 24, dash) + l(16, 18, 16, 24),
    'tall-utility': r(13, 3, 14, 34) + l(24, 17, 24, 22) + l(16, 8, 21, 31, dash),
    island: l(4, 15, 36, 15, 'stroke-width="2"') + r(7, 15, 26, 18) + l(15.6, 15, 15.6, 33) + l(24.3, 15, 24.3, 33) + l(7, 21, 33, 21) + l(7, 27, 33, 27),
    'wardrobe-hinged': r(9, 3, 22, 34) + l(9, 9, 31, 9) + l(20, 9, 20, 37) + l(17, 20, 17, 25) + l(23, 20, 23, 25),
    'wardrobe-sliding': r(9, 3, 22, 34) + l(9, 9, 31, 9) + r(9, 10, 12, 27, 'fill="currentColor" fill-opacity=".1"') + r(19, 10, 12, 27) + l(13, 35, 17, 35),
    'laundry-tower': r(9, 3, 22, 34) + c(20, 30, 4) + c(20, 19, 4) + l(9, 24.5, 31, 24.5) + l(9, 9, 31, 9),
    'entry-closet': r(10, 3, 20, 34) + l(10, 9, 30, 9) + l(10, 18, 30, 18, dash) + l(10, 25, 30, 25, dash) + l(10, 32, 30, 32, dash),
    bookcase: r(11, 3, 18, 34) + l(11, 10, 29, 10) + l(11, 17, 29, 17) + l(11, 24, 29, 24) + l(11, 31, 29, 31),
    vanity: l(6, 14, 34, 14, 'stroke-width="2"') + r(8, 14, 24, 11) + l(8, 19.5, 32, 19.5) + `<path d="M15 14v-2h10v2"/>` + l(20, 7, 20, 11),
    'media-low': r(5, 22, 30, 9) + l(5, 26.5, 35, 26.5, dash) + r(12, 6, 16, 10, 'rx="1"'),
    'media-shelf': l(6, 18, 34, 18, 'stroke-width="2.4"') + l(6, 30, 34, 30, 'stroke-width="2.4"'),
    'media-panel': r(8, 4, 24, 32, 'fill="currentColor" fill-opacity=".1"') + r(12, 12, 16, 10, 'rx="1"'),
    'entry-bench': r(6, 22, 28, 10) + l(6, 27, 34, 27, dash) + l(6, 22, 34, 22, 'stroke-width="2"'),
    shelf: l(6, 20, 34, 20, 'stroke-width="2.4"') + l(9, 20, 9, 24) + l(31, 20, 31, 24),
    desk: l(4, 18, 36, 18, 'stroke-width="2"') + r(22, 18, 12, 5) + l(6, 18, 6, 34) + l(34, 23, 34, 34),
    custom: r(8, 10, 24, 24) + l(20, 10, 20, 34) + `<text x="20" y="8" font-size="6" text-anchor="middle" stroke="none" fill="currentColor">?</text>`,
    filler: r(17, 6, 6, 28, 'fill="currentColor" fill-opacity=".14"'),
    panel: r(18, 4, 4, 32, 'fill="currentColor" fill-opacity=".3"'),
  };
  return `<svg viewBox="0 0 40 40" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${G[id] || G.custom}</svg>`;
}

/** Flatten an object into dotted keys: { fronts: { color: 'x' } } → { 'fronts.color': 'x' }. */
export function flatten(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, prefix + k + '.', out);
    else out[prefix + k] = v;
  }
  return out;
}
/** { 'fronts.color': 'x' } → { fronts: { color: 'x' } } for one key. */
export function nest(path, value) {
  const keys = path.split('.'), out = {};
  let cur = out;
  keys.forEach((k, i) => { if (i === keys.length - 1) cur[k] = value; else cur = cur[k] = {}; });
  return out;
}
export const getPath = (o, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);
