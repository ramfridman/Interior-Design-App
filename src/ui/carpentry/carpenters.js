/**
 * Carpentry · Find a carpenter. Leads read from published pages (no ratings, no endorsement), nearest first,
 * with a private contact tracker kept in this browser only.
 * Mount contract: default export create(ctx) → { el, update({ runId, unitId }), destroy() }.
 */
import { h, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { btn, segmented, extLink, emptyState, safeUrl } from '../components.js';

const STORE_KEY = 'house98.carpentry.carpenterTracker.v1';
const TYPE_LABEL = { 'carpentry-workshop': 'Carpentry workshop', 'kitchen-studio': 'Kitchen studio', 'wardrobe-maker': 'Wardrobe maker', manufacturer: 'Manufacturer' };
const STATUS = [{ value: 'none', label: 'Not contacted' }, { value: 'contacted', label: 'Contacted' }, { value: 'quote', label: 'Quote received' }];
const MONEY = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const money = (n) => `₪${MONEY.format(Math.round(n))}`;
const isKitchen = (c) => (c.specialties || []).some((s) => /kitchen/i.test(s));
const isWardrobe = (c) => (c.specialties || []).some((s) => /wardrobe|closet/i.test(s));
const prettySpec = (s) => String(s).replace(/-/g, ' ');

function csv(rows) {
  const cell = (v) => {
    if (v == null) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

function loadTracker() {
  try { const o = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}
function saveTracker(t) { try { localStorage.setItem(STORE_KEY, JSON.stringify(t)); return true; } catch (e) { return false; } }

function create(ctx) {
  const { store, Carp, ui } = ctx;
  let list = [], pricebook = null, loadError = null, destroyed = false, stones = null;
  let tracker = loadTracker();
  const meta = () => (tracker._meta = tracker._meta || { quotesIncVat: true });
  const filters = { dist: 'all', type: 'all', kitchens: false, wardrobes: false, source: 'all' };
  const cards = new Map();
  const root = h('div', { class: 'cp cp-ca', 'aria-label': 'Find a carpenter' });
  const listEl = h('ul', { class: 'cp-ca__list' });
  const countEl = h('p', { class: 'cp-ca__count faint', role: 'status', 'aria-live': 'polite' });
  const emptyEl = h('div', { class: 'cp-ca__none', hidden: true }, emptyState({ icon: 'search', title: 'No carpenters match these filters', text: 'Widen the distance or clear a filter.' }));
  const cmpEl = h('div', { class: 'cp-cmp' });
  let storageWarned = false;

  const entry = (id) => tracker[id] || (tracker[id] = { status: 'none', amount: '', note: '' });
  const persist = () => { if (!saveTracker(tracker) && !storageWarned) { storageWarned = true; ui.toast('Your notes cannot be saved in this browser; they last until you close the page', { kind: 'info' }); } };
  const persistSoon = debounce(persist, 300);

  // ───────────── filters ─────────────
  const distSeg = segmented({ label: 'Distance from the house', cls: 'seg--block', value: 'all', options: [{ value: '15', label: '≤ 15 km' }, { value: '30', label: '≤ 30' }, { value: '50', label: '≤ 50' }, { value: 'all', label: 'All' }], onChange: (v) => { filters.dist = v; apply(); } });
  const sel = (label, opts, onChange) => {
    const s = h('select', { class: 'select', 'aria-label': label, onChange: () => onChange(s.value) }, opts.map((o) => h('option', { value: o.value }, o.label)));
    return s;
  };
  const typeSel = sel('Type', [{ value: 'all', label: 'All types' }, ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))], (v) => { filters.type = v; apply(); });
  const srcSel = sel('Source of details', [{ value: 'all', label: 'Any source' }, { value: 'own-site', label: 'Own website' }, { value: 'directory', label: 'Directory listing only' }], (v) => { filters.source = v; apply(); });
  const check = (label, key) => { const i = h('input', { type: 'checkbox', class: 'check__input', onChange: () => { filters[key] = i.checked; apply(); } }); return h('label', { class: 'check' }, i, h('span', { class: 'check__label' }, label)); };

  function visible(c) {
    if (filters.dist !== 'all' && !(c.distanceKm != null && c.distanceKm <= +filters.dist)) return false;
    if (filters.type !== 'all' && c.type !== filters.type) return false;
    if (filters.kitchens && !isKitchen(c)) return false;
    if (filters.wardrobes && !isWardrobe(c)) return false;
    if (filters.source !== 'all' && (c.source && c.source.kind) !== filters.source) return false;
    return true;
  }
  function apply() {
    let n = 0;
    for (const c of list) { const el = cards.get(c.id); const v = visible(c); el.hidden = !v; if (v) n++; }
    emptyEl.hidden = n !== 0;
    countEl.textContent = `${n} of ${list.length} carpenters`;
  }

  // ───────────── cards ─────────────
  async function copyPhone(c, node, button) {
    const text = c.phone;
    try { await navigator.clipboard.writeText(text); ui.toast('Phone number copied', { kind: 'success' }); button.focus({ preventScroll: true }); return; } catch (e) { /* fall through to manual copy */ }
    try { const r = document.createRange(); r.selectNodeContents(node); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { /* ignore */ }
    ui.toast('Press Ctrl+C to copy the selected number', { kind: 'info' });
  }

  function trackerEl(c) {
    const e = entry(c.id);
    const stat = h('select', { class: 'select cp-trk__status', 'aria-label': `Status for ${c.name}`, onChange: () => { e.status = stat.value; chipSet(); persistSoon(); renderCompare(); } }, STATUS.map((s) => h('option', { value: s.value, selected: e.status === s.value }, s.label)));
    const amt = h('input', { class: 'cp-trk__amt num', type: 'number', min: '0', step: '100', inputmode: 'numeric', placeholder: 'Quote ₪', 'aria-label': `Quote amount in shekels from ${c.name}`, value: e.amount === '' ? '' : String(e.amount),
      onInput: () => { e.amount = amt.value === '' ? '' : Math.max(0, Number(amt.value)); persistSoon(); renderCompare(); } });
    const note = h('textarea', { class: 'textarea cp-trk__note', rows: '2', maxlength: '600', placeholder: 'Notes: who you spoke to, visit date, what they said', 'aria-label': `Notes about ${c.name}`, onInput: () => { e.note = note.value; persistSoon(); } });
    note.value = e.note || '';
    const chip = h('span', { class: 'cp-chip' });
    const chipSet = () => { chip.textContent = (STATUS.find((s) => s.value === e.status) || STATUS[0]).label; chip.className = `cp-chip cp-chip--st-${e.status}`; };
    chipSet();
    return h('details', { class: 'cp-trk' }, h('summary', null, h('span', null, 'Track this contact'), chip),
      h('div', { class: 'cp-trk__body' }, h('div', { class: 'cp-trk__row' }, stat, h('span', { class: 'cp-trk__money' }, h('span', { class: 'cp-trk__cur', 'aria-hidden': 'true' }, '₪'), amt)), note,
        h('p', { class: 'faint cp-trk__hint' }, 'Kept in this browser only — not in your design file.')));
  }

  function cardEl(c) {
    const own = c.source && c.source.kind === 'own-site';
    const phoneNode = h('span', { class: 'cp-ph num' }, c.phone || '');
    const copyBtn = h('button', { type: 'button', class: 'btn btn--quiet btn--sm cp-ph__copy', 'aria-label': `Copy phone number of ${c.name}`, onClick: () => copyPhone(c, phoneNode, copyBtn) }, icon('copy', { size: 14 }), h('span', { class: 'btn__label' }, 'Copy'));
    const listingUrl = safeUrl(c.source && c.source.url);
    const web = extLink(own ? 'Website' : 'Website', c.website, 'cp-link');
    const listing = listingUrl && (!own || listingUrl !== safeUrl(c.website)) ? extLink(own ? 'Source page' : 'Directory listing', listingUrl, 'cp-link') : null;
    const specs = (c.specialties || []);
    return h('li', { class: 'cp-card-c', dataset: { id: c.id } },
      h('header', { class: 'cp-cc__head' },
        h('div', { class: 'cp-cc__names' }, h('h3', { class: 'cp-cc__name' }, c.name), c.nameHe && h('p', { class: 'cp-cc__he', dir: 'rtl', lang: 'he' }, c.nameHe)),
        h('span', { class: 'cp-cc__dist num', title: 'Straight-line distance from the house' }, c.distanceKm == null ? '—' : `${c.distanceKm.toFixed(1)} km`)),
      h('p', { class: 'cp-cc__meta' }, [c.city, c.region && c.region !== c.city ? c.region : null].filter(Boolean).join(' · '), h('span', { class: 'cp-chip cp-chip--type' }, TYPE_LABEL[c.type] || c.type || 'Carpenter')),
      h('p', { class: 'cp-cc__spec' }, specs.length ? specs.map(prettySpec).join(' · ') : h('span', { class: 'faint' }, 'No specialties stated')),
      h('div', { class: 'cp-cc__contact' },
        c.phone ? h('div', { class: 'cp-cc__phone' }, icon('carpenter', { size: 14 }), phoneNode, copyBtn)
          : h('p', { class: 'cp-cc__nophone' }, icon('info', { size: 14 }), 'Phone not published — open the listing'),
        c.email && h('p', { class: 'cp-cc__mail' }, (/^[^\s@<>"]+@[^\s@<>"]+$/.test(c.email) ? h('a', { href: `mailto:${c.email}` }, c.email) : c.email)),
        h('p', { class: 'cp-cc__links' }, web, listing)),
      c.address && h('p', { class: 'cp-cc__addr faint', dir: 'auto' }, c.address),
      h('p', { class: `cp-prov ${own ? 'is-own' : 'is-dir'}` }, icon(own ? 'check' : 'warn', { size: 14 }),
        h('span', null, own ? 'Details from the business’s own website' : 'Directory listing only — confirm by phone', h('small', { class: 'faint' }, ` · checked ${(c.source && c.source.checkedAt) || 'date unknown'}`))),
      c.notes && h('p', { class: 'cp-cc__note faint' }, c.notes),
      trackerEl(c));
  }

  // ───────────── comparison ─────────────
  let estimate = null;
  function computeEstimate() {
    if (!pricebook) return;
    try { const e = Carp.estimate('all', { tier: store.ui.carpentryTier || undefined, pricebook, method: 'market', stones }); estimate = e && e.total ? e.total : null; } catch (err) { estimate = null; }
  }
  function renderCompare() {
    const got = list.filter((c) => tracker[c.id] && tracker[c.id].status === 'quote' && Number(tracker[c.id].amount) > 0);
    const incl = !!meta().quotesIncVat, vat = (pricebook && pricebook.vat) || 0.18;
    const vatBox = h('input', { type: 'checkbox', class: 'check__input', checked: incl, onChange: () => { meta().quotesIncVat = vatBox.checked; persist(); renderCompare(); } });
    const head = h('header', { class: 'cp-cmp__head' }, h('h3', { class: 'cp-h' }, 'Quotes received'), h('label', { class: 'check' }, vatBox, h('span', { class: 'check__label' }, 'Amounts include VAT')));
    if (!got.length) { cmpEl.replaceChildren(head, h('p', { class: 'faint cp-cmp__empty' }, 'Mark a carpenter “Quote received” and enter the amount to compare it with your estimate here.')); return; }
    const rows = got.map((c) => {
      const exVat = incl ? Number(tracker[c.id].amount) / (1 + vat) : Number(tracker[c.id].amount);
      const typ = estimate ? estimate.typical : null;
      const pos = !estimate ? null : exVat < estimate.low ? 'below' : exVat > estimate.high ? 'above' : 'within';
      const diff = typ ? Math.round(((exVat - typ) / typ) * 100) : null;
      return { c, exVat, pos, diff };
    }).sort((a, b) => a.exVat - b.exVat);
    const tbl = h('div', { class: 'cp-scroll', tabindex: '0', role: 'region', 'aria-label': 'Quote comparison' }, h('table', { class: 'cp-table cp-table--cmp' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Carpenter'), h('th', { scope: 'col', class: 'is-num' }, 'Quote, before VAT'), h('th', { scope: 'col' }, 'Against your estimate'))),
      h('tbody', null, rows.map((r) => h('tr', null, h('td', { dir: 'auto' }, r.c.name), h('td', { class: 'is-num num' }, money(r.exVat)),
        h('td', null, r.pos ? h('span', { class: `cp-chip cp-chip--pos-${r.pos}` }, r.pos === 'within' ? 'Within range' : r.pos === 'below' ? 'Below range' : 'Above range') : '—', r.diff != null && h('span', { class: 'cp-cmp__diff num faint' }, ` ${r.diff > 0 ? '+' : ''}${r.diff} % vs typical`))))),
      estimate && h('tfoot', null, h('tr', null, h('th', { scope: 'row' }, 'Your estimate'), h('td', { class: 'is-num num', colspan: '2' }, `${money(estimate.low)} – ${money(estimate.high)}, typical ${money(estimate.typical)}`)))));
    cmpEl.replaceChildren(head, tbl, h('p', { class: 'faint cp-cmp__note' }, 'Compare like with like: a quote may leave out installation, worktops or appliances. Ask each carpenter what is included.'));
  }

  // ───────────── export ─────────────
  async function exportCsv() {
    const rows = [['Name', 'Name (Hebrew)', 'Town', 'Distance (km)', 'Type', 'Specialties', 'Phone', 'Email', 'Website', 'Source', 'Source page', 'Checked', 'Status', 'Quote (ILS)', 'Quote includes VAT', 'Note']];
    for (const c of list) {
      const e = tracker[c.id] || {};
      rows.push([c.name, c.nameHe || '', c.city || '', c.distanceKm == null ? '' : c.distanceKm, TYPE_LABEL[c.type] || c.type || '', (c.specialties || []).join('; '), c.phone || '', c.email || '', c.website || '',
        c.source && c.source.kind === 'own-site' ? 'Own website' : 'Directory listing', (c.source && c.source.url) || '', (c.source && c.source.checkedAt) || '',
        (STATUS.find((s) => s.value === e.status) || STATUS[0]).label, e.amount === '' || e.amount == null ? '' : e.amount, e.amount ? (meta().quotesIncVat ? 'yes' : 'no') : '', e.note || '']);
    }
    rows.push([], ['Leads read from published pages; no ratings or endorsement. Details may have changed — confirm by phone.']);
    const r = await ui.saveFile({ name: `House98-Carpenters-${new Date().toISOString().slice(0, 10)}.csv`, mime: 'text/csv', data: csv(rows) });
    if (r && r.ok && !r.dialog) ui.toast('Contact list saved as CSV', { kind: 'success' });
  }

  // ───────────── mount ─────────────
  function build() {
    root.replaceChildren(
      h('header', { class: 'cp-head' },
        h('p', { class: 'cp-kicker' }, 'Find a carpenter'),
        h('p', { class: 'cp-head__text faint' }, 'These are leads read from published pages on the stated date. No ratings, no endorsement; details may have changed, so confirm by phone before relying on them.')),
      h('div', { class: 'cp-ctl cp-ca__filters' },
        h('div', { class: 'cp-ctl__row' }, h('span', { class: 'cp-ctl__label' }, 'Distance'), distSeg),
        h('div', { class: 'cp-ca__selects' }, typeSel, srcSel),
        h('div', { class: 'cp-ca__checks' }, check('Does kitchens', 'kitchens'), check('Does wardrobes', 'wardrobes')),
        h('p', { class: 'cp-ca__sort faint' }, 'Nearest first, by straight-line km from the house (not driving distance).')),
      countEl, listEl, emptyEl, cmpEl,
      h('div', { class: 'cp-actions' }, btn('Contact list CSV', { icon: 'download', small: true, onClick: exportCsv })));
  }
  function populate() {
    cards.clear();
    listEl.replaceChildren(...list.map((c) => { const el = cardEl(c); cards.set(c.id, el); return el; }));
    apply(); renderCompare();
  }

  build();
  root.append(h('p', { class: 'faint cp-pad', role: 'status', id: 'cp-ca-loading' }, 'Loading carpenters…'));
  import('../../carpentry/carpenters.js').then((m) => { list = Carp.sortCarpentersByDistance(m.default || []); }).catch((e) => { loadError = 'The carpenter list could not be loaded.'; console.error(e); })
    .then(() => import('../../carpentry/pricebook.js').then((m) => { pricebook = m.default; }).catch(() => {}))
    .then(() => import('../../carpentry/stones.js').then((m) => { stones = m.STONES; }).catch(() => {}))
    .then(() => {
      if (destroyed) return;
      const l = root.querySelector('#cp-ca-loading'); if (l) l.remove();
      if (loadError) { root.append(emptyState({ icon: 'warn', title: 'Carpenters unavailable', text: loadError })); return; }
      computeEstimate(); populate();
    });
  const refresh = debounce(() => { if (!destroyed && pricebook) { computeEstimate(); renderCompare(); } }, 200);
  const offs = ['carpentry', 'items', 'plan', 'ui'].map((e) => store.on(e, refresh));

  return {
    el: root,
    update() { /* the list does not depend on the selected run */ },
    destroy() { destroyed = true; refresh.cancel(); persistSoon.cancel(); persist(); offs.forEach((f) => f && f()); root.remove(); },
  };
}

export { create };
export default create;
