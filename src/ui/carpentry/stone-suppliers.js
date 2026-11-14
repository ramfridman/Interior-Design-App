/**
 * Carpentry · Find a stone supplier. Worktop-stone businesses (brand houses, importers, a stone yard, fabricators) read
 * from published pages (src/carpentry/stone-suppliers.js), nearest the house first, filtered by kind, material and —
 * when a stone is chosen — "works with the chosen stone's brand". Ratings only where a page showed one.
 * Mount contract: default export create(ctx) → { el, update({ runId, unitId }), destroy() }.
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { segmented, extLink, emptyState, safeUrl } from '../components.js';

const KIND_LABEL = { brand: 'Brand house', importer: 'Importer', 'stone-yard': 'Stone yard', fabricator: 'Fabricator' };
const OFFER_LABEL = { quartz: 'Quartz', porcelain: 'Porcelain', sintered: 'Sintered stone', fusion: 'Fusion (quartz)', marble: 'Marble', granite: 'Granite', quartzite: 'Quartzite', onyx: 'Onyx',
  travertine: 'Travertine', 'natural-stone': 'Natural stone', glass: 'Glass', caesarstone: 'Caesarstone' };
const pretty = (s) => OFFER_LABEL[s] || String(s).replace(/-/g, ' ');

function create(ctx) {
  const { store, Carp, ui } = ctx;
  let list = [], loadError = null, destroyed = false, sel = { runId: null };
  const filters = { dist: 'all', kind: 'all', material: 'all', brand: false };
  const cards = new Map();
  const root = h('div', { class: 'cp cp-ca cp-ss', 'aria-label': 'Find a stone supplier' });
  const listEl = h('ul', { class: 'cp-ca__list' });
  const countEl = h('p', { class: 'cp-ca__count faint', role: 'status', 'aria-live': 'polite' });
  const emptyEl = h('div', { class: 'cp-ca__none', hidden: true }, emptyState({ icon: 'search', title: 'No stone suppliers match these filters', text: 'Widen the distance or clear a filter.' }));
  const brandBox = h('input', { type: 'checkbox', class: 'check__input', onChange: () => { filters.brand = brandBox.checked; apply(); } });
  const brandLabel = h('span', { class: 'check__label' }, 'Works with the chosen stone’s brand');
  const brandRow = h('label', { class: 'check', hidden: true }, brandBox, brandLabel);

  /** The stone of the selected run, else of the first run that has one. */
  function chosenStone() {
    const runs = Carp.listRuns();
    const r = (sel.runId && runs.find((x) => x.id === sel.runId && x.spec.worktop && x.spec.worktop.stone)) || runs.find((x) => x.spec.worktop && x.spec.worktop.stone);
    return r ? { run: r, stone: r.spec.worktop.stone } : null;
  }

  const distSeg = segmented({ label: 'Distance from the house', cls: 'seg--block', value: 'all', options: [{ value: '30', label: '≤ 30 km' }, { value: '60', label: '≤ 60' }, { value: '120', label: '≤ 120' }, { value: 'all', label: 'All' }], onChange: (v) => { filters.dist = v; apply(); } });
  const sel_ = (label, opts, onChange) => { const s = h('select', { class: 'select', 'aria-label': label, onChange: () => onChange(s.value) }, opts.map((o) => h('option', { value: o.value }, o.label))); return s; };
  const kindSel = sel_('Kind', [{ value: 'all', label: 'All kinds' }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))], (v) => { filters.kind = v; apply(); });
  let matSel = sel_('Material', [{ value: 'all', label: 'Any material' }], () => {});

  function visible(c) {
    if (filters.dist !== 'all' && !(c.distanceKm != null && c.distanceKm <= +filters.dist)) return false;
    if (filters.kind !== 'all' && c.kind !== filters.kind) return false;
    if (filters.material !== 'all' && !(c.offers || []).includes(filters.material)) return false;
    if (filters.brand) { const ch = chosenStone(); if (ch && !(c.id === ch.stone.supplierId || Carp.worksBrand(c, ch.stone.brand))) return false; }
    return true;
  }
  function apply() {
    let n = 0;
    for (const c of list) { const el = cards.get(c.id), v = visible(c); el.hidden = !v; if (v) n++; }
    emptyEl.hidden = n !== 0;
    countEl.textContent = `${n} of ${list.length} stone suppliers`;
  }
  function syncBrand() {
    const ch = chosenStone();
    brandRow.hidden = !ch;
    if (ch) brandLabel.textContent = `Works with ${/^unbranded/i.test(ch.stone.brand || '') ? 'this natural stone' : ch.stone.brand} (${ch.run.code}: ${ch.stone.name})`;
    else if (filters.brand) { filters.brand = false; brandBox.checked = false; }
    for (const c of list) { const el = cards.get(c.id), mark = el && el.querySelector('.cp-ss__mine'); if (mark) mark.hidden = !(ch && c.id === ch.stone.supplierId); }
  }

  async function copyPhone(c, node, button) {
    try { await navigator.clipboard.writeText(c.phone); ui.toast('Phone number copied', { kind: 'success' }); button.focus({ preventScroll: true }); return; } catch (e) { /* manual copy */ }
    try { const r = document.createRange(); r.selectNodeContents(node); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { /* ignore */ }
    ui.toast('Press Ctrl+C to copy the selected number', { kind: 'info' });
  }

  function cardEl(c) {
    const own = !!c.ownSite, src = (c.sources || [])[0] || {};
    const phoneNode = h('span', { class: 'cp-ph num' }, c.phone || '');
    const copyBtn = h('button', { type: 'button', class: 'btn btn--quiet btn--sm cp-ph__copy', 'aria-label': `Copy phone number of ${c.name}`, onClick: () => copyPhone(c, phoneNode, copyBtn) }, icon('copy', { size: 14 }), h('span', { class: 'btn__label' }, 'Copy'));
    const srcUrl = safeUrl(src.url);
    return h('li', { class: 'cp-card-c cp-ss__card', dataset: { id: c.id, kind: c.kind } },
      h('header', { class: 'cp-cc__head' },
        h('div', { class: 'cp-cc__names' }, h('h3', { class: 'cp-cc__name' }, c.name), c.nameHe && h('p', { class: 'cp-cc__he', dir: 'rtl', lang: 'he' }, c.nameHe)),
        h('span', { class: 'cp-cc__dist num', title: c.coordsNote === 'town-centre' ? 'Straight-line distance from the house to the town centre' : 'Straight-line distance from the house' }, c.distanceKm == null ? '—' : `${c.distanceKm.toFixed(1)} km`)),
      h('p', { class: 'cp-cc__meta' }, [c.city, c.region && c.region !== c.city ? c.region : null].filter(Boolean).join(' · '), h('span', { class: 'cp-chip cp-chip--type' }, KIND_LABEL[c.kind] || c.kind),
        h('span', { class: 'cp-chip cp-chip--sel cp-ss__mine', hidden: true }, 'lists your stone')),
      h('p', { class: 'cp-ss__offers' }, h('span', { class: 'faint' }, 'Offers: '), (c.offers || []).length ? c.offers.map(pretty).join(' · ') : h('span', { class: 'faint' }, 'not stated')),
      (c.services || []).length ? h('p', { class: 'cp-ss__offers faint' }, 'Services: ', c.services.map(pretty).join(' · ')) : null,
      c.rating ? h('p', { class: 'cp-ss__rating' }, icon('star', { size: 13 }), ` ${c.rating.value} from ${c.rating.count} reviews `, h('span', { class: 'faint' }, `(${c.rating.source}${c.rating.readAt ? `, read ${c.rating.readAt}` : ''})`)) : null,
      h('div', { class: 'cp-cc__contact' },
        c.phone ? h('div', { class: 'cp-cc__phone' }, icon('carpenter', { size: 14 }), phoneNode, copyBtn)
          : h('p', { class: 'cp-cc__nophone' }, icon('info', { size: 14 }), 'Phone not published on the pages read'),
        h('p', { class: 'cp-cc__links' }, extLink('Website', c.website, 'cp-link'), srcUrl && srcUrl !== safeUrl(c.website) ? extLink(own ? 'Source page' : 'Directory listing', srcUrl, 'cp-link') : null)),
      c.address && h('p', { class: 'cp-cc__addr faint', dir: 'auto' }, c.address),
      h('p', { class: `cp-prov ${own ? 'is-own' : 'is-dir'}` }, icon(own ? 'check' : 'warn', { size: 14 }),
        h('span', null, own ? 'Details from the business’s own website' : 'Directory listing only — confirm by phone', h('small', { class: 'faint' }, ` · checked ${src.checkedAt || 'date unknown'}`))),
      c.notes && h('p', { class: 'cp-cc__note faint' }, c.notes));
  }

  function build() {
    const offers = [...new Set(list.flatMap((c) => c.offers || []))].sort((a, b) => pretty(a).localeCompare(pretty(b)));
    const m = sel_('Material', [{ value: 'all', label: 'Any material' }, ...offers.map((o) => ({ value: o, label: pretty(o) }))], (v) => { filters.material = v; apply(); });
    matSel = m;
    root.replaceChildren(
      h('header', { class: 'cp-head' },
        h('p', { class: 'cp-kicker' }, 'Find a stone supplier'),
        h('p', { class: 'cp-head__text faint' }, 'Worktop-stone businesses read from their own pages or a directory listing on the stated date. Ratings only where a page showed one; no endorsement. Details change — confirm by phone.')),
      h('div', { class: 'cp-ctl cp-ca__filters' },
        h('div', { class: 'cp-ctl__row' }, h('span', { class: 'cp-ctl__label' }, 'Distance'), distSeg),
        h('div', { class: 'cp-ca__selects' }, kindSel, matSel),
        h('div', { class: 'cp-ca__checks' }, brandRow),
        h('p', { class: 'cp-ca__sort faint' }, 'Nearest first, by straight-line km from the house to the business’s town (not driving distance).')),
      countEl, listEl, emptyEl);
    cards.clear();
    listEl.replaceChildren(...list.map((c) => { const el = cardEl(c); cards.set(c.id, el); return el; }));
    syncBrand(); apply();
  }

  root.append(h('p', { class: 'faint cp-pad', role: 'status' }, 'Loading stone suppliers…'));
  import('../../carpentry/stone-suppliers.js').then((mod) => { list = Carp.sortCarpentersByDistance(mod.STONE_SUPPLIERS || mod.default || []); })
    .catch((e) => { loadError = 'The stone supplier list could not be loaded.'; console.error(e); })
    .then(() => {
      if (destroyed) return;
      if (loadError) { root.replaceChildren(emptyState({ icon: 'warn', title: 'Stone suppliers unavailable', text: loadError })); return; }
      build();
    });
  const off = store.on('carpentry', () => { if (!destroyed && list.length) { syncBrand(); apply(); } });

  return {
    el: root,
    update(s) { sel = { runId: (s && s.runId) || null }; if (list.length) { syncBrand(); apply(); } },
    destroy() { destroyed = true; if (typeof off === 'function') off(); root.remove(); },
  };
}

export { create };
export default create;
