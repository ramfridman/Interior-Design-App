/**
 * Carpentry · Estimate tab. A price-book (market) range for the carpentry — never a quotation.
 * Mount contract: default export create(ctx) → { el, update({ runId, unitId }), destroy() }.
 */
import { h, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { btn, segmented, toggle, extLink, emptyState } from '../components.js';

const TIER_LABEL = { basic: 'Basic', mid: 'Mid', premium: 'Premium' };
const UNIT_LABEL = { m: 'm', m2: 'm²', unit: '×', percent: '%', job: 'job', day: 'day' };
const CONF_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };
const MONEY = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const QTY = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export const money = (n) => `₪${MONEY.format(Math.round(n || 0))}`;

/** RFC 4180 CSV with a BOM (Excel reads Hebrew) and a guard against spreadsheet formula injection. */
function csv(rows) {
  const cell = (v) => {
    if (v == null) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

function create(ctx) {
  const { store, Carp, ui } = ctx;
  let pricebook = null, loadError = null, stoneData = null;
  let sel = { runId: null, unitId: null };
  let vat = false;
  let lastBudget = '';
  const open = new Set();        // keys of <details> the person opened / closed
  const closed = new Set();
  const root = h('div', { class: 'cp cp-est', 'aria-label': 'Carpentry estimate' });
  const body = h('div', { class: 'cp-est__body' });
  root.append(body);

  const tierSeg = segmented({
    label: 'Quality level', cls: 'seg--block cp-tier',
    options: [{ value: 'suggested', label: 'Suggested' }, { value: 'basic', label: 'Basic' }, { value: 'mid', label: 'Mid' }, { value: 'premium', label: 'Premium' }],
    value: store.ui.carpentryTier || 'suggested',
    onChange: (v) => store.setUI({ carpentryTier: v === 'suggested' ? null : v }),
  });
  tierSeg.set(store.ui.carpentryTier || 'suggested');
  const vatToggle = toggle({ label: 'Include 18 % VAT', hint: 'Off: prices before VAT', checked: vat, onChange: (v) => { vat = v; render(); } });

  // ───────────── data ─────────────
  function compute() {
    const tier = store.ui.carpentryTier || undefined;
    const opts = { tier, pricebook, method: 'market', stones: stoneData && stoneData.stones, stoneSuppliers: stoneData && stoneData.suppliers };
    const all = Carp.estimate('all', opts);
    const one = sel.runId && Carp.getRun(sel.runId) ? Carp.estimate(sel.runId, opts) : null;
    return { all, one };
  }
  const k = () => (vat ? 1 + (pricebook.vat || 0.18) : 1);
  const sc = (n) => (n || 0) * k();

  // ───────────── pieces ─────────────
  const chip = (text, cls = '', title) => h('span', { class: `cp-chip ${cls}`, title }, text);

  function rangeCard(title, sub, t) {
    const low = sc(sumOf(t, 'low')), typ = sc(sumOf(t, 'typical')), high = sc(sumOf(t, 'high'));
    const span = Math.max(1, high - low), pos = Math.min(100, Math.max(0, ((typ - low) / span) * 100));
    return h('section', { class: 'cp-range', 'aria-label': title },
      h('header', { class: 'cp-range__head' }, h('h3', { class: 'cp-range__title' }, title), h('span', { class: 'cp-range__sub faint' }, sub)),
      h('div', { class: 'cp-range__figs num' },
        fig('Low', low), fig('Typical', typ, true), fig('High', high)),
      h('div', { class: 'cp-bar', role: 'img', 'aria-label': `${money(low)} to ${money(high)}, typical ${money(typ)}` },
        h('span', { class: 'cp-bar__band' }), h('span', { class: 'cp-bar__mark', style: { left: `${pos}%` } })),
      h('p', { class: 'cp-range__vat faint' }, vat ? `Including ${Math.round((pricebook.vat || 0.18) * 100)} % VAT` : 'Before VAT'));
  }
  function fig(label, v, strong) { return h('div', { class: `cp-fig${strong ? ' cp-fig--typ' : ''}` }, h('span', { class: 'cp-fig__label' }, label), h('span', { class: 'cp-fig__val' }, money(v))); }

  /** low / typical / high of an estimate-like object (sum of runs; `total` is typical-based in the engine, so sum lines). */
  function sumOf(est, key) {
    if (est.total && typeof est.total === 'object' && est.total[key] != null) return est.total[key];
    let s = 0;
    for (const r of est.runs) for (const c of r.components) { if (c.optional) continue; s += c[key] || 0; }
    return s;
  }

  function lineEl(l) {
    const noRate = !!l.noRate;
    const rate = !noRate && l.qty && l.unit !== 'job' && l.unit !== 'percent' ? l.typical / l.qty : null;
    const basis = noRate ? null : `${QTY.format(l.qty)} ${UNIT_LABEL[l.unit] || l.unit || ''}${rate != null ? ` × ${money(sc(rate))}` : ''}`.trim();
    const sources = (l.sources && l.sources.length ? l.sources : (l.source ? [l.source] : [])).map((s) => extLink(s.name || 'Source', s.url, 'cp-src')).filter(Boolean);
    return h('li', { class: `cp-line${noRate ? ' is-norate' : ''}` },
      h('div', { class: 'cp-line__main' },
        h('p', { class: 'cp-line__label' }, l.label && (l.label.en || l.label)),
        noRate ? h('p', { class: 'cp-line__norate' }, icon('info', { size: 14 }), 'No published rate — ask the carpenter')
          : h('p', { class: 'cp-line__basis num' }, basis, l.derived && chip('derived', 'cp-chip--derived', 'Derived from other rates in the price book, not a published rate'),
            l.confidence && chip(CONF_LABEL[l.confidence] ? l.confidence : String(l.confidence), `cp-chip--conf cp-chip--${l.confidence}`, CONF_LABEL[l.confidence] || '')),
        l.note && h('p', { class: 'cp-line__note faint' }, l.note.en || l.note),
        l.why && h('p', { class: 'cp-line__why' }, h('b', null, l.basis === 'slab' ? 'Rate used: this slab’s published price. ' : 'Rate used: the material’s book rate. '), l.why.en || l.why),
        !noRate && (l.fromPrice || l.vatStatus) && h('p', { class: 'cp-line__why faint' }, [l.fromPrice && 'A “from” price: the real price can be higher.', l.vatStatus && `VAT: ${l.vatStatus}.`].filter(Boolean).join(' ')),
        !noRate && (sources.length || l.includes) && h('details', { class: 'cp-line__more' },
          h('summary', null, `Sources (${sources.length})`),
          l.includes && h('p', { class: 'cp-line__inc faint', dir: 'auto' }, l.includes),
          h('ul', { class: 'cp-srclist' }, sources.map((s) => h('li', null, s))))),
      h('div', { class: 'cp-line__amt num' }, noRate ? h('span', { class: 'faint' }, '—')
        : [h('span', { class: 'cp-line__typ' }, money(sc(l.typical)), l.optional && ' '), h('span', { class: 'cp-line__rng faint' }, `${money(sc(l.low))} – ${money(sc(l.high))}`)]));
  }

  function detailsEl(key, cls, summary, content, defOpen) {
    const isOpen = open.has(key) || (defOpen && !closed.has(key));
    const d = h('details', { class: cls, open: isOpen }, summary, content);
    d.addEventListener('toggle', () => { if (d.open) { open.add(key); closed.delete(key); } else { open.delete(key); closed.add(key); } });
    return d;
  }

  function componentEl(run, c) {
    const lines = c.lines || [];
    const none = lines.every((l) => l.noRate);
    return detailsEl(`c:${run.runId}:${c.key}`, 'cp-comp', h('summary', { class: 'cp-comp__sum' },
      h('span', { class: 'cp-comp__name' }, c.label && (c.label.en || c.label), c.optional && chip('optional', '', 'Not included in the total')),
      h('span', { class: 'cp-comp__amt num' }, none ? '—' : money(sc(c.typical)))),
    h('div', { class: 'cp-comp__body' },
      c.basis && h('p', { class: 'cp-comp__basis faint' }, c.basis.en || c.basis),
      h('ul', { class: 'cp-lines' }, lines.map(lineEl))), false);
  }

  function runEl(run, isSel) {
    const rt = (key) => sc(run.total && typeof run.total === 'object' && run.total[key] != null ? run.total[key] : run.components.reduce((s, c) => s + (c.optional ? 0 : c[key] || 0), 0));
    const typ = rt('typical'), low = rt('low'), high = rt('high');
    const tier = run.tier || run.suggestedTier;
    const sum = h('summary', { class: 'cp-run__sum' },
      h('span', { class: 'cp-run__name' }, h('b', null, run.code), ' ', run.name, isSel && chip('selected', 'cp-chip--sel')),
      h('span', { class: 'cp-run__tier' }, chip(TIER_LABEL[tier] || tier, 'cp-chip--tier', store.ui.carpentryTier ? 'Quality level chosen by you' : 'Suggested from this run’s materials and hardware'), !store.ui.carpentryTier && h('span', { class: 'faint cp-run__sug' }, 'suggested')),
      h('span', { class: 'cp-run__amt num' }, h('b', null, money(typ)), h('small', { class: 'faint' }, `${money(low)} – ${money(high)}`)));
    const content = h('div', { class: 'cp-run__body' },
      run.components.length ? run.components.map((c) => componentEl(run, c)) : h('p', { class: 'faint cp-pad' }, 'Nothing to price in this run yet.'),
      run.noRateLines ? h('p', { class: 'cp-run__flag' }, icon('info', { size: 14 }), `${run.noRateLines} line${run.noRateLines === 1 ? '' : 's'} without a published rate are not in this total.`) : null);
    return detailsEl(`r:${run.runId}`, `cp-run${isSel ? ' is-sel' : ''}`, sum, content, isSel);
  }

  function notesEl(est) {
    const notes = (pricebook.notes || []).map((n) => (n && n.en) || n);
    const miss = est.missingRates || [];
    return [
      miss.length ? h('section', { class: 'cp-miss' }, h('h3', { class: 'cp-h' }, 'No published rate'),
        h('p', { class: 'faint' }, 'These are not in any total above. Ask the carpenter to price them.'),
        h('ul', null, miss.map((m) => h('li', null, (m.label && (m.label.en || m.label)) || m.key)))) : null,
      detailsEl('notes', 'cp-notes', h('summary', null, `About these prices — price book notes (${notes.length})`),
        h('ul', { class: 'cp-notes__list' }, notes.map((n) => h('li', null, n))), false),
    ];
  }

  // ───────────── render ─────────────
  function render() {
    if (loadError) { body.replaceChildren(emptyState({ icon: 'warn', title: 'Price book unavailable', text: loadError })); return; }
    if (!pricebook) { body.replaceChildren(h('p', { class: 'faint cp-pad', role: 'status' }, 'Loading the price book…')); return; }
    let all, one;
    try { ({ all, one } = compute()); } catch (err) {
      console.error('[estimate]', err);
      body.replaceChildren(emptyState({ icon: 'warn', title: 'Could not calculate the estimate', text: String(err && err.message || err) })); return;
    }
    tierSeg.set(store.ui.carpentryTier || 'suggested');
    const t = { low: sumOf(all, 'low'), typical: sumOf(all, 'typical'), high: sumOf(all, 'high') };
    const key = JSON.stringify([t.low, t.typical, t.high]);
    if (key !== lastBudget) { lastBudget = key; try { ui.setCarpentryBudget && ui.setCarpentryBudget(vatInclusive(t)); } catch (e) { /* optional hook */ } }
    const runsSorted = [...all.runs].sort((a, b) => (b.runId === sel.runId) - (a.runId === sel.runId));
    const kids = [
      h('header', { class: 'cp-head' },
        h('p', { class: 'cp-kicker' }, 'Estimate — not a quotation'),
        h('p', { class: 'cp-head__text faint' }, `Market ranges from the price book of ${pricebook.asOf}, ${pricebook.priceBasis || 'excluding VAT'}. Real quotes depend on the design, materials and the carpenter.`)),
      h('div', { class: 'cp-ctl' },
        h('div', { class: 'cp-ctl__row' }, h('span', { class: 'cp-ctl__label' }, 'Quality level'), tierSeg),
        store.ui.carpentryTier ? null : h('p', { class: 'cp-ctl__hint faint' }, 'Suggested: each run is priced at the level its fronts and hardware point to.'),
        vatToggle),
    ];
    if (!all.runs.length) kids.push(emptyState({ icon: 'carpentry', title: 'No carpentry yet', text: 'Add a run in the workbench and its price range appears here.' }));
    else {
      if (one && one.runs[0]) kids.push(rangeCard(`${one.runs[0].code} · ${one.runs[0].name}`, 'This run', one));
      kids.push(rangeCard('All carpentry', `${all.runs.length} run${all.runs.length === 1 ? '' : 's'}`, all));
      kids.push(h('h3', { class: 'cp-h' }, 'Breakdown'), h('div', { class: 'cp-runs' }, runsSorted.map((r) => runEl(r, r.runId === sel.runId))));
      kids.push(notesEl(all));
    }
    kids.push(h('p', { class: 'cp-disclaimer faint' }, icon('info', { size: 14 }), h('span', null, (all.disclaimer && all.disclaimer.en) || 'This is an estimate for budgeting, not a quotation.')));
    kids.push(h('div', { class: 'cp-actions' }, btn('Estimate as CSV', { icon: 'download', small: true, disabled: !all.runs.length, onClick: () => exportCsv(all) })));
    body.replaceChildren(...kids);
  }

  async function exportCsv(all) {
    const rows = [['Run', 'Component', 'Line', 'Unit', 'Quantity', 'Low (ILS)', 'Typical (ILS)', 'High (ILS)', 'VAT', 'Confidence', 'Derived', 'No published rate', 'Sources']];
    const kk = k();
    for (const r of all.runs) for (const c of r.components) for (const l of c.lines) {
      rows.push([`${r.code} ${r.name}`, c.label && c.label.en, l.label && (l.label.en || l.label), l.unit, l.qty != null ? Math.round(l.qty * 100) / 100 : '',
        l.noRate ? '' : Math.round(l.low * kk), l.noRate ? '' : Math.round(l.typical * kk), l.noRate ? '' : Math.round(l.high * kk),
        vat ? 'incl.' : 'excl.', l.confidence || '', l.derived ? 'yes' : '', l.noRate ? 'yes' : '', (l.sources || []).map((s) => s.url).filter(Boolean).join(' | ')]);
    }
    rows.push([], ['Total', '', '', '', '', Math.round(sumOf(all, 'low') * kk), Math.round(sumOf(all, 'typical') * kk), Math.round(sumOf(all, 'high') * kk), vat ? 'incl.' : 'excl.']);
    rows.push([`Estimate, not a quotation. Price book ${pricebook.asOf}.`]);
    const r = await ui.saveFile({ name: `House98-Carpentry-Estimate-${new Date().toISOString().slice(0, 10)}.csv`, mime: 'text/csv', data: csv(rows) });
    if (r && r.ok && !r.dialog) ui.toast('Estimate saved as CSV', { kind: 'success' });
  }

  const refresh = debounce(() => { if (!destroyed) render(); }, 120);
  let destroyed = false;
  const offs = ['carpentry', 'items', 'plan', 'ui'].map((e) => store.on(e, refresh));
  render();
  // the stone list lets a chosen slab's own published price be used (optional: without it the material rate applies)
  Promise.all([import('../../carpentry/stones.js'), import('../../carpentry/stone-suppliers.js')]).then(([a, b]) => { stoneData = { stones: a.STONES, suppliers: b.STONE_SUPPLIERS }; if (pricebook && !destroyed) render(); }).catch(() => {});
  import('../../carpentry/pricebook.js').then((m) => { pricebook = m.default; render(); }).catch((e) => { loadError = 'The price book could not be loaded.'; console.error(e); render(); });

  return {
    el: root,
    update(s) { const n = { runId: (s && s.runId) || null, unitId: (s && s.unitId) || null }; if (n.runId !== sel.runId) { sel = n; render(); } else sel = n; },
    destroy() { destroyed = true; refresh.cancel(); offs.forEach((f) => f && f()); root.remove(); },
  };
}

export { create };
export default create;

/** Budget figures incl. VAT (the estimate totals are before VAT). */
function vatInclusive(t) {
  const f = 1 + (Number(t && t.vat) || 0.18);
  const r = (v) => Math.round((Number(v) || 0) * f);
  return { low: r(t.low), typical: r(t.typical), high: r(t.high) };
}
