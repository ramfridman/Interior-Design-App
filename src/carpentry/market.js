/**
 * Market-rate estimate — the PRIMARY estimate method. Israeli sources publish carpentry prices as market rates
 * (kitchen per running metre, wardrobe per m² of front, vanity per metre, add-ons per unit), so the run's real geometry is
 * measured in those units and multiplied by the price book's rates. Anything without a published rate becomes a line
 * with `noRate: true` (never a silent zero) and is listed in `missingRates`.
 */
import { view } from './state.js';
import { MODULES } from './modules.js';
import { unitsOf, positions, geometryOf, levelOf } from './layout.js';
import { runTakeoff } from './takeoff.js';

const L = (en, he) => ({ en, he });
const r0 = (v) => Math.round(v);
const r2 = (v) => Math.round(v * 100) / 100;
const KITCHEN_KINDS = new Set(['kitchen', 'pantry', 'utility']);

export const MARKET_COMPONENTS = {
  cabinets: L('Cabinets (market rate)', 'ארונות (מחיר שוק)'),
  addons: L('Fittings & add-ons', 'פרזול ותוספות'),
  worktop: L('Worktop', 'משטח עבודה'),
  installation: L('Installation', 'התקנה'),
  lighting: L('Lighting (optional)', 'תאורה (אופציונלי)'),
  other: L('Items without a published rate', 'פריטים ללא מחיר מפורסם'),
};

/** True if the price book carries market keys (kitchen.* / wardrobe.* …). */
export function hasMarketKeys(pb) { return !!(pb && pb.rates && Object.keys(pb.rates).some((k) => /^(kitchen|wardrobe|vanity)\.|^worktop\.[^.]+\.per-m$/.test(k))); }

/**
 * Tier suggestion from the run's spec: melamine / laminate → basic; lacquer / Fenix / J-profile → mid;
 * veneer / solid wood / glass fronts, gola profile or premium hardware → premium. The owner can override.
 */
export function suggestTier(run) {
  const s = run && run.spec;
  if (!s) return 'mid';
  const m = s.fronts.material, st = s.fronts.style, g = s.hardware.grade;
  if (['veneer', 'solid-frame', 'glass'].includes(m) || st === 'gola' || g === 'premium') return 'premium';
  if (['lacquer-matt', 'lacquer-gloss', 'fenix'].includes(m) || st === 'j-profile') return 'mid';
  return 'basic';
}

const sourcesOf = (r) => (Array.isArray(r.sources) ? r.sources : r.source ? [r.source] : []);
/** Human label for a missing key. */
function missingLabel(key) {
  return L(`No published rate: ${key}`, `אין מחיר מפורסם: ${key}`);
}

/** Line factory bound to a price book. */
function rater(pb, missing) {
  const rates = (pb && pb.rates) || {};
  const line = (key, qty, extra = {}) => {
    const r = rates[key];
    if (!r) {
      const label = extra.label || missingLabel(key);
      if (!missing.some((m) => m.key === key)) missing.push({ key, label });
      return { rateKey: key, rateKeys: [key], label, unit: extra.unit || 'unit', qty: r2(qty), low: 0, typical: 0, high: 0, noRate: true, sources: [], note: extra.note || null };
    }
    return { rateKey: key, rateKeys: [key], label: extra.label || r.label || L(key, key), unit: r.unit, qty: r2(qty), low: qty * r.low, typical: qty * r.typical, high: qty * r.high,
      sources: sourcesOf(r), confidence: r.confidence || null, includes: r.includes || null, note: extra.note || null };
  };
  /** Tiered key `${base}.${tier}`; mid missing → mean of basic + premium (derived). */
  const tiered = (base, tier, qty, extra = {}) => {
    if (rates[`${base}.${tier}`]) return line(`${base}.${tier}`, qty, extra);
    const b = rates[`${base}.basic`], p = rates[`${base}.premium`];
    if (tier === 'mid' && b && p) {
      const l = { rateKey: `${base}.mid`, rateKeys: [`${base}.basic`, `${base}.premium`], derived: true, label: extra.label || L(`${(b.label || {}).en || base} (mid = mean of basic and premium)`, `${(b.label || {}).he || base} (בינוני = ממוצע בסיסי ופרימיום)`),
        unit: b.unit, qty: r2(qty), sources: [...sourcesOf(b), ...sourcesOf(p)], confidence: 'derived', includes: b.includes || null, note: extra.note || null };
      for (const k of ['low', 'typical', 'high']) l[k] = (qty * (b[k] + p[k])) / 2;
      return l;
    }
    return line(`${base}.${tier}`, qty, extra);
  };
  return { line, tiered, rates };
}

/** Along-run coverage (cm) of base-only, wall-only and both, from interval breakpoints. */
function coverage(baseIv, wallIv) {
  const pts = [...new Set([...baseIv, ...wallIv].flat())].sort((a, b) => a - b);
  const inAny = (iv, x) => iv.some(([a, b]) => x > a && x < b);
  let both = 0, base = 0, wall = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const m = (pts[i] + pts[i + 1]) / 2, len = pts[i + 1] - pts[i], B = inAny(baseIv, m), W = inAny(wallIv, m);
    if (B && W) both += len; else if (B) base += len; else if (W) wall += len;
  }
  return { both, base, wall };
}

function runMarket(run, v, tier, R, ctx) {
  const units = unitsOf(run, v), pos = positions(run, units), rt = runTakeoff(run, v);
  const geo = units.map((u) => ({ u, g: geometryOf(run, u), mod: MODULES[u.carp.module], level: levelOf(u), at: pos.get(u.id).at, w: u.carp.width }));
  const comp = { cabinets: [], addons: [], worktop: [], installation: [], lighting: [], other: [] };
  const basis = {};
  const push = (c, l) => { if (l) comp[c].push(l); };
  const S = run.spec;
  const drawerCount = (x) => x.g.fronts.filter((f) => f.kind === 'drawer').length + x.g.inner.filter((c) => c.kind === 'drawer').length;

  // ── kitchen-type runs: running metres by coverage ──
  if (KITCHEN_KINDS.has(run.kind)) {
    const baseIv = [], wallIv = [];
    for (const x of geo) {
      if (x.mod.virtual) continue;
      if (x.level === 'base') baseIv.push([x.at, x.at + x.w]);
      else if (x.level === 'wall' && !['shelf', 'media-shelf'].includes(x.mod.id)) wallIv.push([x.at, x.at + x.w]);
      else if (x.mod.id === 'tall-fridge-niche') wallIv.push([x.at, x.at + x.w]);  // the top box over the fridge prices like a wall unit
    }
    const cv = coverage(baseIv, wallIv);
    if (cv.both > 0) push('cabinets', R.line(`kitchen.complete.per-m.${tier}`, cv.both / 100, { note: L(`${r2(cv.both / 100)} m with base AND wall units`, `${r2(cv.both / 100)} מ׳ עם ארונות תחתונים ועליונים`) }));
    if (cv.base > 0) push('cabinets', R.line(`kitchen.cabinets.per-m.${tier}`, cv.base / 100, { note: L(`${r2(cv.base / 100)} m of base units only`, `${r2(cv.base / 100)} מ׳ ארונות תחתונים בלבד`) }));
    if (cv.wall > 0) {
      const qty = cv.wall / 100, key = `kitchen.wall-units.per-m.${tier}`;
      if (R.rates[key]) push('cabinets', R.line(key, qty, { note: L(`${r2(qty)} m of wall units only (incl. the box over the fridge)`, `${r2(qty)} מ׳ ארונות עליונים בלבד (כולל ארון מעל המקרר)`) }));
      else {
        const c = R.rates[`kitchen.complete.per-m.${tier}`], b = R.rates[`kitchen.cabinets.per-m.${tier}`];
        if (c && b) {
          const l = { rateKey: `kitchen.wall-units.per-m.${tier}`, rateKeys: [`kitchen.complete.per-m.${tier}`, `kitchen.cabinets.per-m.${tier}`], derived: true, unit: 'm', qty: r2(qty),
            label: L(`Wall units per m (derived: complete − base, ${tier})`, `ארונות עליונים למטר (נגזר: מטבח מלא פחות תחתונים, ${tier})`), sources: [...sourcesOf(c), ...sourcesOf(b)], confidence: 'derived',
            note: L(`${r2(qty)} m of wall units only (incl. the box over the fridge)`, `${r2(qty)} מ׳ ארונות עליונים בלבד (כולל ארון מעל המקרר)`) };
          for (const k of ['low', 'typical', 'high']) l[k] = Math.max(0, qty * (c[k] - b[k]));
          push('cabinets', l);
        } else push('cabinets', R.line(key, qty));
      }
    }
    const talls = geo.filter((x) => x.level === 'tall' && !x.mod.virtual && x.mod.id !== 'tall-fridge-niche' && !['filler', 'panel'].includes(x.mod.id));
    if (talls.length) {
      const q = talls.reduce((s, x) => s + x.w, 0) / 60;
      push('cabinets', R.line('kitchen.tall-unit.per-unit', q, { note: L(`${talls.length} tall unit(s), ${talls.reduce((s, x) => s + x.w, 0)} cm — priced per 60 cm unit (width / 60)`, `${talls.length} ארונות גבוהים, ${talls.reduce((s, x) => s + x.w, 0)} ס״מ — מתומחר לפי יחידה של 60 ס״מ (רוחב / 60)`) }));
    }
    basis.cabinets = L('Lower + upper cabinets per running metre (standard hardware, excl. worktop, drawers and special fittings); tall units per 60 cm unit', 'ארונות תחתונים + עליונים למטר רץ (פרזול סטנדרטי, ללא משטח, מגירות ופרזול מיוחד); ארונות גבוהים ליחידת 60 ס״מ');
  }

  // ── island ──
  for (const x of geo.filter((y) => y.level === 'island')) {
    if (R.rates['kitchen.island.per-m']) push('cabinets', R.line('kitchen.island.per-m', x.w / 100, { note: L(`island ${x.w} cm`, `אי ${x.w} ס״מ`) }));
    else push('cabinets', R.line('kitchen.island.per-unit', 1));
    basis.cabinets = L('Island cabinets per running metre (carcass + fronts, excl. worktop)', 'ארונות אי למטר רץ (גוף + חזיתות, ללא משטח)');
  }

  // ── kitchen add-ons: corner fittings, lift-ups, drawers ──
  if (KITCHEN_KINDS.has(run.kind) || run.kind === 'island') {
    const corners = geo.filter((x) => x.mod.id === 'base-corner-carousel' || (x.mod.id === 'base-corner-blind' && ['lemans', 'magic-corner', 'carousel'].includes((x.u.carp.internals || {}).corner)));
    if (corners.length) push('addons', R.line('kitchen.corner-fitting.per-unit', corners.length));
    for (const x of geo.filter((y) => y.mod.id === 'wall-liftup')) push('addons', R.line(x.w > 90 && R.rates['kitchen.lift-up-unit-120.per-unit'] ? 'kitchen.lift-up-unit-120.per-unit' : 'kitchen.lift-up-unit.per-unit', 1));
    const nDr = geo.filter((x) => x.level !== 'full').reduce((s, x) => s + drawerCount(x), 0);
    if (nDr) push('addons', R.line('kitchen.drawer.per-unit', nDr, { note: L(`${nDr} drawers (the per-metre rates exclude drawers)`, `${nDr} מגירות (המחיר למטר אינו כולל מגירות)`) }));
    const pulls = geo.filter((x) => ['base-pullout', 'base-bin'].includes(x.mod.id) || (x.u.carp.internals || {}).pantry === 'larder');
    if (pulls.length) push('other', R.line('kitchen.pullout.per-unit', pulls.length, { label: L(`Pull-out fittings (${pulls.length}) — no published rate, ask the carpenter`, `מנגנונים נשלפים (${pulls.length}) — אין מחיר מפורסם, לשאול את הנגר`) }));
    basis.addons = L('Add-ons the per-metre rate excludes: corner fittings, lift-up doors, drawers', 'תוספות שאינן כלולות במחיר למטר: פתרונות פינה, דלתות קלפה, מגירות');
  }

  // ── full-height units (wardrobes, closets, laundry, bookcases) per m² of front ──
  const full = geo.filter((x) => x.level === 'full' && x.mod.id !== 'panel');
  if (full.length) {
    const area = (xs) => xs.reduce((s, x) => s + (x.w * (x.g.h - (x.g.H.plinth || 0))) / 1e4, 0);
    const books = full.filter((x) => x.mod.id === 'bookcase'), robes = full.filter((x) => x.mod.id !== 'bookcase');
    if (robes.length) {
      const a = area(robes), base = R.line(`wardrobe.per-m2.${tier}`, a, { note: L(`${r2(a)} m² of front (floor to ${S.heights.aboveTop === 'cabinet' ? 'ceiling, incl. top boxes' : 'top'})`, `${r2(a)} מ״ר חזית (מהרצפה עד ${S.heights.aboveTop === 'cabinet' ? 'התקרה, כולל בוידעם' : 'הקצה העליון'})`) });
      push('cabinets', base);
      const pct = (key, share, label) => {
        const p = R.rates[key];
        if (!p) { push('addons', R.line(key, 1, { label })); return; }
        const l = { rateKey: key, rateKeys: [key, base.rateKey], label, unit: 'percent', qty: r2(p.typical), sources: sourcesOf(p), confidence: p.confidence || null, includes: p.includes || null };
        for (const k of ['low', 'typical', 'high']) l[k] = (base[k] * share * p[k]) / 100;
        push('addons', l);
      };
      if (robes.some((x) => x.mod.sliding)) pct('wardrobe.sliding.premium-percent', area(robes.filter((x) => x.mod.sliding)) / a, L('Sliding-door premium', 'תוספת דלתות הזזה'));
      const doors = robes.flatMap((x) => x.g.fronts.filter((f) => ['door', 'mirror'].includes(f.kind))), mirrors = doors.filter((f) => f.kind === 'mirror');
      const mirrorShare = doors.length ? mirrors.reduce((s, f) => s + f.w * f.h, 0) / Math.max(1, doors.reduce((s, f) => s + f.w * f.h, 0)) : 0;
      const slidingMirror = (S.sliding && S.sliding.mirror) && robes.some((x) => x.mod.sliding) ? S.sliding.mirror / Math.max(2, (S.sliding.doors || 2)) : 0;
      if (mirrorShare + slidingMirror > 0) pct('wardrobe.mirror-door.premium-percent', Math.min(1, mirrorShare + slidingMirror), L('Mirror-door premium', 'תוספת דלתות מראה'));
      const nDr = robes.reduce((s, x) => s + drawerCount(x), 0);
      if (nDr) push('addons', R.line('wardrobe.drawer.soft-close', nDr));
      basis.cabinets = L('Custom wardrobe per m² of front (carcass, fronts, standard interior, installed)', 'ארון בהתאמה אישית למ״ר חזית (גוף, חזיתות, חלוקה פנימית סטנדרטית, כולל התקנה)');
    }
    if (books.length) push('cabinets', R.line('bookcase.per-m2', area(books)));
  }

  // ── vanities ──
  if (run.kind === 'vanity') {
    const vs = geo.filter((x) => x.mod.id === 'vanity');
    const len = vs.reduce((s, x) => s + x.w, 0) / 100;
    if (len) {
      const vt = tier === 'basic' ? 'basic' : tier === 'premium' ? 'premium' : 'mid';
      const l = R.rates[`vanity.per-m.basic`] ? R.tiered('vanity.per-m', vt, len) : R.line('vanity.per-unit', vs.length);
      push('cabinets', l);
      basis.cabinets = L('Bathroom vanity per running metre (cabinet; basin / top priced separately)', 'ארון אמבטיה למטר אורך (ארון; כיור / משטח בנפרד)');
    }
  }

  // ── anything else without a published rate ──
  const handled = new Set(['kitchen', 'pantry', 'utility', 'island', 'vanity']);
  if (!handled.has(run.kind)) {
    const rest = geo.filter((x) => !x.mod.virtual && x.level !== 'full' && !['filler', 'panel'].includes(x.mod.id));
    if (rest.length) push('other', R.line(`${run.kind}.per-unit`, rest.length, { label: L(`${rest.map((x) => x.mod.name.en).join(', ')} — no published rate, ask the carpenter`, `${rest.map((x) => x.mod.name.he).join(', ')} — אין מחיר מפורסם, לשאול את הנגר`) }));
  }

  // ── worktop ──
  for (const p of rt.worktops) {
    const natural = ['granite', 'marble-local'].includes(p.material);
    const key = `worktop.${p.material}.per-m`;
    const qty = p.waterfall ? (p.length / 100) * (p.depth / 60) : (p.length / 100) * (p.depth > 65 ? p.depth / 60 : 1);
    push('worktop', R.line(key, qty, { note: L(`${p.waterfall ? 'waterfall ' : ''}${p.id} ${p.length} × ${p.depth} cm${p.depth > 65 ? ` (pro-rata ${r2(p.depth / 60)} × depth)` : ''}`, `${p.waterfall ? 'דופן נופלת ' : ''}${p.id} ${p.length} × ${p.depth} ס״מ${p.depth > 65 ? ` (יחסי לעומק ×${r2(p.depth / 60)})` : ''}`) }));
    for (const c of p.cutouts) {
      const k = `worktop.cutout.${c.kind === 'hob' ? 'hob' : 'sink'}${natural ? '.natural-stone' : ''}`;
      push('worktop', R.line(k, 1));
    }
  }
  if (rt.worktops.length) basis.worktop = L('Worktop per running metre (≤ 65 cm deep; deeper pieces pro-rata by depth / 60) + cut-outs; usually incl. template and installation', 'משטח למטר רץ (עד עומק 65 ס״מ; עמוק יותר — יחסית לעומק / 60) + חיתוכים; לרוב כולל מדידה והתקנה');

  // ── installation: one kitchen job per estimate ──
  if ((run.kind === 'kitchen' || run.kind === 'island') && !ctx.kitchenInstall) {
    ctx.kitchenInstall = true;
    push('installation', R.line('labour.installation.kitchen', 1, { note: L('one job for the whole kitchen (often bundled — confirm)', 'עבודה אחת לכל המטבח (לרוב כלולה — לוודא)') }));
    basis.installation = L('Kitchen installation per job, when not bundled; excl. plumbing / electrical', 'התקנת מטבח לעבודה, כשאינה כלולה; ללא אינסטלציה / חשמל');
  }

  // ── lighting ──
  const led = rt.lighting.underWallM + rt.lighting.inCabinetM;
  if (led > 0) { push('lighting', R.line('lighting.led.strip.per-m', led)); basis.lighting = L('LED strip only, per metre (driver, profile and electrician extra)', 'פס לד בלבד למטר (שנאי, פרופיל וחשמלאי בנפרד)'); }

  const components = Object.keys(MARKET_COMPONENTS).filter((c) => comp[c].length).map((c) => {
    const lines = comp[c].map((l) => ({ ...l, low: r0(l.low), typical: r0(l.typical), high: r0(l.high) }));
    return { key: c, label: MARKET_COMPONENTS[c], basis: basis[c] || (c === 'other' ? L('No published market rate — ask the carpenter', 'אין מחיר שוק מפורסם — לשאול את הנגר') : null), optional: c === 'lighting',
      low: lines.reduce((s, l) => s + l.low, 0), typical: lines.reduce((s, l) => s + l.typical, 0), high: lines.reduce((s, l) => s + l.high, 0),
      rateKeys: [...new Set(lines.flatMap((l) => l.rateKeys || [l.rateKey]))], lines };
  });
  const total = { low: 0, typical: 0, high: 0 };
  for (const c of components) for (const k of ['low', 'typical', 'high']) total[k] += c[k];
  return { runId: run.id, code: run.code, name: run.name, nameHe: run.nameHe, kind: run.kind, tier, suggestedTier: suggestTier(run), components, total, rateKeys: [...new Set(components.flatMap((c) => c.rateKeys))], noRateLines: components.reduce((s, c) => s + c.lines.filter((l) => l.noRate).length, 0) };
}

/** Market estimate for the given runs (see estimate() in estimate.js for the result shape). */
export function marketEstimate(runId, opts = {}) {
  const pb = opts.pricebook, v = view(opts.src), missing = [];
  const R = rater(pb, missing), ctx = {};
  const runs = (runId === 'all' ? v.runs() : [v.run(runId)].filter(Boolean))
    .sort((a, b) => (a.kind === 'kitchen' ? 0 : 1) - (b.kind === 'kitchen' ? 0 : 1) || b.length - a.length);
  const tiers = (pb && pb.tiers) || ['basic', 'mid', 'premium'];
  return { runs: runs.map((r) => runMarket(r, v, opts.tier && tiers.includes(opts.tier) ? opts.tier : suggestTier(r), R, ctx)), missing };
}
