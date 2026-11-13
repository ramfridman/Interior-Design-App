/**
 * estimate(runId | 'all', { tier, pricebook }) — an ESTIMATE (cost range low / typical / high, ILS) computed from the
 * take-off and a price book. Every figure carries the rate keys it used. Missing rates count as 0 and are listed in
 * `missingRates` so the UI can say what is not priced.
 *
 * Rate keys looked up (see docs/CONTRACT.md § 8 for the full list):
 *   carcass.<carcassMaterial> m2 · back.<backMaterial> m2 · edge.<edgeType> m · plinth.<plinthFinish> m
 *   fronts.<frontMaterial> m2 · fronts.glass m2 · fronts.mirror m2
 *   worktop.<worktopMaterial> m2 | m · worktop.cutout.<sink|hob|basin> unit · worktop.edge m · worktop.upstand m · worktop.waterfall unit
 *   hardware.<kind> unit | m   (hinge, drawer, liftup, flap-stay, handle, push-latch, profile, leg, hanger, wall-fixing, shelf-support,
 *                               rail, rail-support, appliance-kit, sliding-set, sliding-track, worktop-bracket)
 *   internal.pullout.<variant> · internal.larder · internal.trouser-rack   unit
 *   install.<runKind> (or install) percent | m | unit · lighting.led m · splashback.<material> m2
 */
import { takeoff as doTakeoff } from './takeoff.js';

const L = (en, he) => ({ en, he });
const r0 = (v) => Math.round(v);
export const COMPONENTS = {
  carcass: L('Carcasses, backs, plinth & edging', 'גופים, גבות, צוקל וקנטים'), fronts: L('Fronts & end panels', 'חזיתות ופאנלים'),
  worktop: L('Worktop', 'משטח עבודה'), hardware: L('Hardware', 'פרזול'), internal: L('Internal fittings', 'אביזרים פנימיים'),
  installation: L('Installation', 'התקנה'), lighting: L('Lighting (optional)', 'תאורה (אופציונלי)'), splashback: L('Splashback (optional)', 'חיפוי קיר (אופציונלי)'),
};
const HW_INTERNAL = new Set(['pullout', 'larder', 'trouser-rack']);

function makeRater(pb, tier, missing) {
  const rates = (pb && pb.rates) || {};
  return (key, qty, unitHint) => {
    const r = rates[key];
    if (!r) { if (qty > 0) missing.add(key); return null; }
    const f = (r.tierFactor && r.tierFactor[tier]) ?? (pb.tierFactor && pb.tierFactor[tier]) ?? 1;
    return { rateKey: key, label: r.label || L(key, key), unit: r.unit || unitHint, qty: Math.round(qty * 1000) / 1000, low: qty * r.low * f, typical: qty * r.typical * f, high: qty * r.high * f, source: r.source || null };
  };
}

function runEstimate(rt, pb, tier, missing) {
  const rate = makeRater(pb, tier, missing);
  const comp = {};
  const put = (c, line) => { if (!line) return; (comp[c] = comp[c] || []).push(line); };
  const mats = new Map();
  const panels = [...rt.units.flatMap((u) => [...u.panels, ...u.fronts]), ...rt.extraFronts];
  for (const p of panels) {
    const key = p.group === 'carcass' ? `carcass.${p.material}` : p.group === 'back' ? `back.${p.material}` : p.group === 'glass' ? `fronts.${p.material === 'mirror' ? 'mirror' : 'glass'}` : `fronts.${p.material}`;
    const comp0 = p.group === 'carcass' || p.group === 'back' ? 'carcass' : 'fronts';
    const k = comp0 + '|' + key;
    mats.set(k, (mats.get(k) || 0) + p.areaM2);
    if (p.edgeType) mats.set('carcass|edge.' + p.edgeType, (mats.get('carcass|edge.' + p.edgeType) || 0) + p.edgeM);
  }
  for (const [k, q] of mats) { const [c, key] = k.split('|'); put(c, rate(key, q, key.startsWith('edge') ? 'm' : 'm2')); }
  if (rt.plinth.m > 0) put('carcass', rate(`plinth.${rt.plinth.finish}`, rt.plinth.m, 'm'));
  // worktop
  for (const p of rt.worktops) {
    const key = `worktop.${p.material}`, r = pb && pb.rates && pb.rates[key];
    const qty = r && r.unit === 'm' ? (p.depth <= 65 ? p.length / 100 : p.areaM2 / 0.6) : p.areaM2;
    if (p.waterfall) { put('worktop', rate('worktop.waterfall', 1, 'unit')); put('worktop', rate(key, qty, 'm2')); continue; }
    put('worktop', rate(key, qty, 'm2'));
    for (const c of p.cutouts) put('worktop', rate(`worktop.cutout.${c.kind}`, 1, 'unit'));
    if (p.polishedM) put('worktop', rate('worktop.edge', p.polishedM, 'm'));
    if (p.upstandM) put('worktop', rate('worktop.upstand', p.upstandM, 'm'));
  }
  // hardware & internal fittings
  const hwAll = [...rt.units.flatMap((u) => u.hardware), ...rt.hardware];
  for (const h of hwAll) {
    if (HW_INTERNAL.has(h.kind)) { put('internal', rate(h.kind === 'pullout' ? `internal.pullout.${h.variant}` : `internal.${h.kind}`, h.qty, 'unit')); continue; }
    const qty = h.kind === 'rail' ? (h.qty * (h.length || 1000)) / 1000 : h.qty;
    put('hardware', rate(`hardware.${h.kind}`, qty, h.unit === 'm' || h.kind === 'rail' ? 'm' : 'unit'));
  }
  // optional
  if (rt.lighting.underWallM + rt.lighting.inCabinetM > 0) put('lighting', rate('lighting.led', rt.lighting.underWallM + rt.lighting.inCabinetM, 'm'));
  if (rt.splashback.m2 > 0 && rt.splashback.material !== 'none') put('splashback', rate(`splashback.${rt.splashback.material}`, rt.splashback.m2, 'm2'));
  // merge equal keys
  const merged = {};
  for (const [c, lines] of Object.entries(comp)) {
    const byKey = new Map();
    for (const l of lines) { const e = byKey.get(l.rateKey); if (e) { e.qty = Math.round((e.qty + l.qty) * 1000) / 1000; e.low += l.low; e.typical += l.typical; e.high += l.high; } else byKey.set(l.rateKey, { ...l }); }
    merged[c] = [...byKey.values()];
  }
  // installation (on the material subtotal of this run, or per metre / unit)
  const sub = (f) => ['carcass', 'fronts', 'worktop', 'hardware', 'internal'].reduce((s, c) => s + (merged[c] || []).reduce((a, l) => a + l[f], 0), 0);
  const ikey = pb && pb.rates && pb.rates[`install.${rt.kind}`] ? `install.${rt.kind}` : 'install';
  const ir = pb && pb.rates && pb.rates[ikey];
  if (ir) {
    const f = (ir.tierFactor && ir.tierFactor[tier]) ?? (pb.tierFactor && pb.tierFactor[tier]) ?? 1;
    const qty = ir.unit === 'percent' ? 1 : ir.unit === 'm' ? rt.length / 100 : rt.units.filter((u) => !['filler', 'panel'].includes(u.module)).length;
    const v = (k) => (ir.unit === 'percent' ? (sub(k) * ir[k] * f) / 100 : qty * ir[k] * f);
    merged.installation = [{ rateKey: ikey, label: ir.label || L(ikey, ikey), unit: ir.unit, qty: ir.unit === 'percent' ? ir.typical : qty, low: v('low'), typical: v('typical'), high: v('high'), source: ir.source || null }];
  } else missing.add(`install.${rt.kind}`);
  const components = Object.keys(COMPONENTS).filter((c) => merged[c] && merged[c].length).map((c) => {
    const lines = merged[c].map((l) => ({ ...l, low: r0(l.low), typical: r0(l.typical), high: r0(l.high) }));
    return { key: c, label: COMPONENTS[c], optional: c === 'lighting' || c === 'splashback', low: lines.reduce((s, l) => s + l.low, 0), typical: lines.reduce((s, l) => s + l.typical, 0), high: lines.reduce((s, l) => s + l.high, 0), rateKeys: lines.map((l) => l.rateKey), lines };
  });
  const total = { low: 0, typical: 0, high: 0 };
  for (const c of components) for (const k of ['low', 'typical', 'high']) total[k] += c[k];
  return { runId: rt.runId, code: rt.code, name: rt.name, nameHe: rt.nameHe, components, total, rateKeys: [...new Set(components.flatMap((c) => c.rateKeys))] };
}

/**
 * Estimate. opts = { tier: 'basic'|'mid'|'premium' (default 'mid' or the price book's middle tier), pricebook (required), src }.
 * Returns { isEstimate: true, label, currency, vat, asOf, tier, runs: [{ runId, code, name, components: [{ key, label, low, typical,
 * high, rateKeys, lines: [{ rateKey, label, unit, qty, low, typical, high, source }] }], total, totalIncVat, rateKeys }],
 * total, totalIncVat, missingRates, notes, disclaimer }. All money in whole ILS, before VAT unless *IncVat.
 */
export function estimate(runId = 'all', opts = {}) {
  const pb = opts.pricebook || null;
  const tiers = (pb && pb.tiers) || ['basic', 'mid', 'premium'];
  const tier = opts.tier || tiers[Math.floor(tiers.length / 2)];
  const vat = pb && typeof pb.vat === 'number' ? pb.vat : 0.18;
  const missing = new Set();
  const t = opts.takeoff || doTakeoff(runId, opts.src);
  const runs = t.runs.map((rt) => runEstimate(rt, pb, tier, missing));
  const inc = (o) => ({ low: r0(o.low * (1 + vat)), typical: r0(o.typical * (1 + vat)), high: r0(o.high * (1 + vat)) });
  for (const r of runs) r.totalIncVat = inc(r.total);
  const total = { low: 0, typical: 0, high: 0 };
  for (const r of runs) for (const k of ['low', 'typical', 'high']) total[k] += r.total[k];
  return {
    isEstimate: true, label: L('Estimate — not a quotation', 'הערכה בלבד — אינה הצעת מחיר'),
    disclaimer: L('Indicative range from market rates for budgeting. The carpenter\'s quotation after a site measurement is binding.', 'טווח מחירים משוער לפי מחירי שוק, לצורך תקצוב. הצעת המחיר של הנגר לאחר מדידה באתר היא המחייבת.'),
    currency: (pb && pb.currency) || 'ILS', vat, asOf: (pb && pb.asOf) || null, tier, tiers,
    runs, total, totalIncVat: inc(total), missingRates: [...missing].sort(), notes: (pb && pb.notes) || [], pricebookMissing: !pb,
  };
}
