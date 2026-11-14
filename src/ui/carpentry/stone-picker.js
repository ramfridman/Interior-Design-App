/**
 * Carpentry · "Choose a stone…" — the worktop / splashback stone picker. Lists the researched slabs (src/carpentry/stones.js)
 * as swatch cards with filters, and a detail pane with the slab's own finishes and thicknesses, the supplier's notes, the
 * published price (or "not published"), the product page and the suppliers who sell or work it. Choosing stores a StoneRef
 * on the run (Carp.stonePatch → updateRun: one undo step, synchronised like every run spec edit).
 * Nothing here is invented: every value shown comes from the data files; missing values read "not published".
 */
import { h, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { btn, extLink, emptyState } from '../components.js';
import { openDialog } from '../dialogs.js';
import * as Carp from '../../carpentry/index.js';

let dataP = null;
/** Stones, the suppliers' natural-stone statements and the stone suppliers (loaded once, on first use). */
export function loadStoneData() {
  if (!dataP) {
    dataP = Promise.all([import('../../carpentry/stones.js'), import('../../carpentry/stone-suppliers.js')])
      .then(([a, b]) => ({ stones: a.STONES || [], statements: a.NATURAL_STONE_STATEMENTS || [], suppliers: b.STONE_SUPPLIERS || [] }))
      .catch((e) => { dataP = null; throw e; });
  }
  return dataP;
}

const MATERIAL_SHORT = { quartz: 'Quartz', porcelain: 'Porcelain / sintered', granite: 'Granite', marble: 'Marble', 'marble-local': 'Local marble', quartzite: 'Quartzite', travertine: 'Travertine', onyx: 'Onyx' };
export const materialShort = (m) => MATERIAL_SHORT[m] || Carp.vocab('worktopMaterial', m).en;
const finishName = (f) => (f ? Carp.finishLabel(f).en : 'Not published');
const ROLE = { listed: 'Lists this slab', brand: 'Names the brand on its page', material: `Works this material` };
const MONEY = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

// ───────────────────────── swatch (small SVG, deterministic per slab) ─────────────────────────
const okHex = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : null);
function prng(str) {
  let a = 2166136261;
  for (let i = 0; i < str.length; i++) a = Math.imul(a ^ str.charCodeAt(i), 16777619);
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function contrast(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255, l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const f = l > 0.5 ? 0.62 : 1.9, c = (v) => Math.max(0, Math.min(255, Math.round(l > 0.5 ? v * f : v + (255 - v) * 0.45)));
  return `#${[c(r), c(g), c(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
/** SVG markup of a slab's look: base colour + its pattern (veins, grain, cloud, chips). Approximate by design. */
export function swatchSVG(rec, w = 120, hh = 80) {
  const base = okHex(rec.hex) || '#d9d6d0', vein = okHex(rec.veinHex) || contrast(base), r = prng(String(rec.id || rec.hex)), p = rec.pattern || 'plain';
  const out = [`<rect width="${w}" height="${hh}" fill="${base}"/>`];
  const f1 = (v) => v.toFixed(1);
  if (p === 'veined' || p === 'marble-look') {
    const n = 3 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const x0 = r() * w, y0 = -5, x3 = r() * w, y3 = hh + 5, x1 = x0 + (r() - 0.5) * w, y1 = hh * 0.35, x2 = x3 + (r() - 0.5) * w, y2 = hh * 0.7;
      const d = `M${f1(x0)} ${y0} C${f1(x1)} ${f1(y1)} ${f1(x2)} ${f1(y2)} ${f1(x3)} ${y3}`;
      out.push(`<path d="${d}" stroke="${vein}" stroke-opacity="0.18" stroke-width="${f1(3 + r() * 3)}" fill="none"/><path d="${d}" stroke="${vein}" stroke-opacity="${i ? 0.45 : 0.75}" stroke-width="${f1(0.6 + r() * 0.8)}" fill="none"/>`);
    }
  } else if (p === 'fine-grain' || p === 'terrazzo') {
    const n = p === 'terrazzo' ? 45 : 160, cols = [vein, contrast(base), '#ffffff', '#000000'];
    for (let i = 0; i < n; i++) {
      const s = p === 'terrazzo' ? 1 + r() * r() * 5 : 0.5 + r() * 1.2;
      out.push(`<circle cx="${f1(r() * w)}" cy="${f1(r() * hh)}" r="${f1(s)}" fill="${cols[Math.floor(r() * (p === 'terrazzo' ? 2 : 4))]}" fill-opacity="${p === 'terrazzo' ? 0.8 : f1(0.15 + r() * 0.3)}"/>`);
    }
  } else if (p === 'concrete') {
    for (let i = 0; i < 9; i++) out.push(`<circle cx="${f1(r() * w)}" cy="${f1(r() * hh)}" r="${f1(10 + r() * 25)}" fill="${r() < 0.5 ? '#000000' : '#ffffff'}" fill-opacity="0.06"/>`);
    for (let i = 0; i < 40; i++) out.push(`<circle cx="${f1(r() * w)}" cy="${f1(r() * hh)}" r="0.6" fill="#000000" fill-opacity="0.25"/>`);
  } else for (let i = 0; i < 5; i++) out.push(`<circle cx="${f1(r() * w)}" cy="${f1(r() * hh)}" r="${f1(14 + r() * 20)}" fill="${r() < 0.5 ? '#000000' : '#ffffff'}" fill-opacity="0.04"/>`);
  return `<svg viewBox="0 0 ${w} ${hh}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${out.join('')}</svg>`;
}
export function swatchEl(rec, cls = 'cstone-sw') {
  const el = h('span', { class: cls, style: { '--sw': okHex(rec && rec.hex) || '#d9d6d0' } });
  if (rec) el.innerHTML = swatchSVG(rec);
  return el;
}

/** Price block text of a slab (published price with its conditions, or "not published" with the supplier's own note). */
export function priceInfo(rec) {
  const p = rec.price;
  if (Carp.hasSlabPrice(rec)) {
    const inc = (p.includes || []).length ? `includes ${p.includes.join(', ')}` : null;
    const vat = p.includesVat === true ? 'incl. VAT' : 'VAT status not stated';
    return { published: true, head: `From ₪${MONEY.format(p.fromIls)} per running metre`, sub: [vat, inc].filter(Boolean).join('; '), asOf: `As published on ${p.readAt || rec.readAt}`, scope: p.scope || null, url: p.url };
  }
  return { published: false, head: 'Price not published', sub: (p && p.note) || null, asOf: `Page read on ${rec.readAt}`, scope: null, url: null };
}

/**
 * Open the picker. target: 'worktop' | 'splashback'.
 * @param {{ C: object, runId: string, target?: string }} o
 */
export function openStonePicker({ C, runId, target = 'worktop' }) {
  const got = Carp.getRun(runId);
  if (!got) return null;
  const cur = target === 'splashback' ? got.run.spec.splashback && got.run.spec.splashback.stone : got.run.spec.worktop && got.run.spec.worktop.stone;
  const root = h('div', { class: 'cstone', 'aria-label': 'Stone picker' });
  const useBtn = btn('Use this stone', { variant: 'primary', disabled: true, onClick: () => apply() });
  const dlg = openDialog({ title: target === 'splashback' ? 'Choose a stone for the splashback' : 'Choose a worktop stone', size: 'xl', cls: 'dialog--cstone', body: root,
    actions: [btn('Cancel', { variant: 'quiet', onClick: () => dlg.close() }), useBtn] });
  root.append(h('p', { class: 'faint cp-pad', role: 'status' }, 'Loading the stone list…'));
  let D = null, sel = null, finish = null, thickness = null;
  const f = { material: 'all', brand: 'all', colour: 'all', q: '' };
  const cards = new Map();

  const listEl = h('div', { class: 'cstone__grid', role: 'listbox', 'aria-label': 'Stones' });
  const countEl = h('p', { class: 'cstone__count faint', role: 'status', 'aria-live': 'polite' });
  const noneEl = h('div', { class: 'cstone__none', hidden: true }, emptyState({ icon: 'search', title: 'No stone matches these filters', text: 'Clear a filter or search for another name or code.' }));
  const detailEl = h('aside', { class: 'cstone__detail', 'aria-label': 'Selected stone' });

  function apply() {
    if (!sel) return;
    const r = Carp.getRun(runId);
    if (!r) { dlg.close(); return; }
    const sup = D.suppliers.find((s) => s.id === sel.supplierId) || null;
    const patch = Carp.stonePatch(sel, { finish, thickness, supplier: sup, current: r.run.spec.worktop && r.run.spec.worktop.thickness, target });
    const name = Carp.stoneName(sel).en;
    const { res } = C.run(() => Carp.updateRun(runId, patch), { done: `${target === 'splashback' ? 'Splashback' : 'Worktop'}: ${name}` });
    if (res && res.ok) dlg.close();
  }

  function visible(s) { return Carp.filterStones([s], f).length === 1; }
  function applyFilters() {
    let n = 0;
    for (const s of D.stones) { const el = cards.get(s.id), v = visible(s); el.hidden = !v; if (v) n++; }
    noneEl.hidden = n !== 0;
    countEl.textContent = `${n} of ${D.stones.length} slabs`;
  }

  function cardEl(s) {
    const approx = s.hexFrom === 'name';
    const b = h('button', { type: 'button', class: 'cstone-card', role: 'option', 'aria-selected': 'false', dataset: { id: s.id, pattern: s.pattern, material: s.material }, onClick: () => select(s) },
      swatchEl(s),
      h('span', { class: 'cstone-card__brand' }, s.brand && !/^unbranded/i.test(s.brand) ? s.brand : 'No brand (natural stone)'),
      h('span', { class: 'cstone-card__name' }, `${s.code && !String(s.name).includes(s.code) ? s.code + ' ' : ''}${s.name}`),
      h('span', { class: 'cstone-card__meta' }, [materialShort(s.material), s.collection].filter(Boolean).join(' · ')),
      h('span', { class: 'cstone-card__meta faint' }, `${(s.finishes || []).map(finishName).join(', ') || 'finish not published'} · ${(s.thicknessesMm || []).length ? s.thicknessesMm.join(' / ') + ' mm' : 'thickness not published'}`),
      h('span', { class: 'cstone-card__tags' }, approx ? h('span', { class: 'cp-chip cp-chip--warn', title: 'Colour estimated from the published colour name, not measured from a swatch' }, 'colour approximate') : null,
        Carp.hasSlabPrice(s) ? h('span', { class: 'cp-chip cp-chip--high' }, 'price published') : null));
    return b;
  }

  function seg(label, options, value, onPick, key) {
    return h('div', { class: 'cstone__choice', role: 'radiogroup', 'aria-label': label },
      options.map((o) => h('button', { type: 'button', role: 'radio', class: 'chip', 'aria-checked': String(o.value === value), 'aria-pressed': String(o.value === value), dataset: { [key]: String(o.value) }, onClick: () => onPick(o.value) }, o.label)));
  }

  function select(s, scroll = false) {
    sel = s;
    for (const [id, el] of cards) { const on = id === s.id; el.setAttribute('aria-selected', String(on)); el.classList.toggle('is-sel', on); }
    if (scroll) { const el = cards.get(s.id); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
    const fins = s.finishes || [];
    finish = cur && cur.id === s.id && fins.includes(cur.finish) ? cur.finish : fins[0] || null;
    const r = Carp.getRun(runId);
    thickness = Carp.pickThickness(s, cur && cur.id === s.id && r ? r.run.spec.worktop.thickness : null, r ? r.run.spec.worktop.thickness : null);
    useBtn.disabled = false;
    root.classList.add('is-detail');
    renderDetail();
  }

  function renderDetail() {
    const s = sel;
    if (!s) { detailEl.replaceChildren(h('div', { class: 'cstone__hint' }, icon('gem', { size: 20 }), h('p', null, 'Pick a slab to see its finishes, thicknesses, price and who sells it.'))); return; }
    const pi = priceInfo(s), nat = Carp.isNaturalStone(s.material);
    const sellers = Carp.suppliersForStone(s, D.suppliers);
    const sorted = Carp.sortCarpentersByDistance(sellers.map((x) => ({ ...x.supplier, role: x.role })));
    const order = { listed: 0, brand: 1, material: 2 };
    sorted.sort((a, b) => order[a.role] - order[b.role] || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    const fins = s.finishes || [], ths = s.thicknessesMm || [];
    const statements = nat ? D.statements.filter((q) => !/onyx/i.test(q.topic) || s.material === 'onyx') : [];
    const r = Carp.getRun(runId);
    detailEl.replaceChildren(
      h('button', { type: 'button', class: 'btn btn--quiet btn--sm cstone__back', onClick: () => root.classList.remove('is-detail') }, icon('chevron-left', { size: 14 }), h('span', { class: 'btn__label' }, 'All stones')),
      h('div', { class: 'cstone__hero' }, swatchEl(s, 'cstone-sw cstone-sw--big'),
        h('p', { class: 'cstone__approx faint' }, icon('info', { size: 13 }), h('span', null, `The swatch and the 3D look are an approximation of the supplier's swatch${s.hexFrom === 'name' ? ' — colour approximate: estimated from the published colour name, not measured' : ' (colour measured from the supplier’s swatch image)'}. View the real slab before deciding.`))),
      h('header', { class: 'cstone__head' },
        h('p', { class: 'cstone__brand' }, [s.brand && !/^unbranded/i.test(s.brand) ? s.brand : 'No brand (natural stone)', s.collection && `${s.collection} collection`].filter(Boolean).join(' · ')),
        h('h3', { class: 'cstone__name' }, `${s.code && !String(s.name).includes(s.code) ? s.code + ' ' : ''}${s.name}`),
        h('p', { class: 'cstone__meta' }, `${Carp.vocab('worktopMaterial', s.material).en}${s.materialRaw && s.materialRaw.toLowerCase() !== s.material ? ` — supplier calls it “${s.materialRaw}”` : ''} · ${Carp.vocab('stonePattern', s.pattern).en.toLowerCase()}`),
        s.colourText ? h('p', { class: 'cstone__text' }, s.colourText) : null),
      h('div', { class: 'cstone__row' }, h('span', { class: 'cstone__label' }, 'Finish'),
        fins.length ? seg('Finish', fins.map((x) => ({ value: x, label: finishName(x) })), finish, (v) => { finish = v; renderDetail(); }, 'finish')
          : h('p', { class: 'faint cstone__np' }, `Not published${s.finishRaw ? ` (page says: ${s.finishRaw})` : ''} — confirm with the supplier`)),
      target === 'worktop' ? h('div', { class: 'cstone__row' }, h('span', { class: 'cstone__label' }, 'Thickness'),
        ths.length ? seg('Thickness', ths.map((x) => ({ value: x, label: `${x} mm` })), thickness, (v) => { thickness = v; renderDetail(); }, 'thickness')
          : h('p', { class: 'faint cstone__np' }, `Not published — the design keeps ${thickness} mm; confirm with the fabricator`)) : null,
      h('div', { class: 'cstone__row' }, h('span', { class: 'cstone__label' }, 'Slab size'), h('p', { class: 'cstone__val' }, (s.slabCm || []).length ? `${s.slabCm.join(', ')} cm${s.slabNote ? ` (${s.slabNote})` : ''}` : 'Not published')),
      h('section', { class: `cstone__price${pi.published ? ' is-pub' : ''}` },
        h('p', { class: 'cstone__pricehead' }, pi.head),
        pi.sub ? h('p', { class: 'cstone__pricesub' }, pi.sub) : null,
        pi.scope ? h('p', { class: 'faint cstone__pricesub' }, pi.scope) : null,
        h('p', { class: 'faint cstone__pricesub' }, pi.asOf, pi.url ? ' · ' : null, pi.url ? extLink('price source', pi.url, 'cp-link') : null),
        pi.published ? h('p', { class: 'faint cstone__pricesub' }, 'The estimate uses this price for the worktop (before VAT).') : h('p', { class: 'faint cstone__pricesub' }, 'The estimate uses the price book’s rate for the material.')),
      (s.suitability || []).length ? h('section', { class: 'cstone__notes' }, h('h4', { class: 'cp-h' }, 'Supplier’s notes'), h('ul', null, s.suitability.map((t) => h('li', { dir: 'auto' }, t)))) : null,
      h('p', { class: 'cstone__links' }, extLink('Product page', s.url, 'cp-link'), h('span', { class: 'faint' }, ` read ${s.readAt}`)),
      nat && statements.length ? h('section', { class: 'cstone__nat', 'aria-label': 'What suppliers say about natural stone' },
        h('h4', { class: 'cp-h' }, 'What suppliers say about natural stone'),
        h('p', { class: 'faint' }, 'Quoted from the suppliers’ own pages; they do not all agree. Ask your fabricator.'),
        h('ul', null, statements.map((q) => { const sp = D.suppliers.find((x) => x.id === q.supplierId); return h('li', null, h('q', { lang: 'he', dir: 'rtl' }, q.quoteHe), h('span', { class: 'cstone__gloss' }, ` — ${sp ? sp.name : q.supplierId}: “${q.glossEn}” `), extLink('source', q.url, 'cp-link')); }))) : null,
      h('section', { class: 'cstone__sellers' }, h('h4', { class: 'cp-h' }, `Who sells or works it (${sorted.length})`),
        sorted.length ? h('ul', null, sorted.slice(0, 8).map((x) => h('li', null,
          h('span', { class: 'cstone__seller' }, x.name), h('span', { class: 'faint' }, ` · ${x.city}${x.distanceKm != null ? ` · ${x.distanceKm.toFixed(0)} km` : ''} · ${ROLE[x.role]}${x.listingOnly ? ' · listing only' : ''}`)))) : h('p', { class: 'faint' }, 'No supplier in the list names this slab, brand or material.'),
        sorted.length > 8 ? h('p', { class: 'faint' }, `…and ${sorted.length - 8} more in “Find a stone supplier”.`) : null),
      r && target === 'worktop' && r.run.spec.worktop.material !== s.material && r.run.spec.worktop.material !== 'none'
        ? h('p', { class: 'cstone__swap faint' }, icon('info', { size: 13 }), ` Choosing it changes the worktop material from ${Carp.vocab('worktopMaterial', r.run.spec.worktop.material).en} to ${Carp.vocab('worktopMaterial', s.material).en}.`) : null);
  }

  function build() {
    const mats = [...new Set(D.stones.map((s) => s.material))];
    const sel_ = (label, opts, onChange, cls = '') => { const x = h('select', { class: `select ${cls}`, 'aria-label': label, onChange: () => onChange(x.value) }, opts.map((o) => h('option', { value: o.value }, o.label))); return x; };
    const matSel = sel_('Material', [{ value: 'all', label: 'All materials' }, ...mats.map((m) => ({ value: m, label: `${materialShort(m)} (${D.stones.filter((s) => s.material === m).length})` }))], (v) => { f.material = v; applyFilters(); });
    const brandSel = sel_('Brand / supplier', [{ value: 'all', label: 'All brands' }, ...Carp.stoneBrands(D.stones).map((b) => ({ value: b.brand, label: `${/^unbranded/i.test(b.brand) ? 'No brand (natural stone)' : b.brand} (${b.n})` }))], (v) => { f.brand = v; applyFilters(); });
    const colourChips = h('div', { class: 'chips chips--wrap cstone__colours', role: 'radiogroup', 'aria-label': 'Colour' },
      [['all', 'Any colour'], ...Object.entries(Carp.COLOUR_FAMILIES).map(([k, v]) => [k, v.en])].map(([k, l]) => h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(k === 'all'), 'aria-pressed': String(k === 'all'), dataset: { colour: k },
        onClick: (e) => { f.colour = k; for (const b of colourChips.children) { const on = b.dataset.colour === k; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-checked', String(on)); } applyFilters(); } }, l)));
    const search = h('input', { class: 'field__input', type: 'search', placeholder: 'Search name or code, e.g. 5131 or Calacatta', 'aria-label': 'Search stones by name or code', 'data-autofocus': '' });
    search.addEventListener('input', debounce(() => { f.q = search.value; applyFilters(); }, 120));
    for (const s of D.stones) { const c = cardEl(s); cards.set(s.id, c); }
    listEl.replaceChildren(...cards.values());
    root.replaceChildren(
      h('div', { class: 'cstone__filters' }, h('label', { class: 'field cstone__search' }, icon('search', { size: 15 }), search), matSel, brandSel, colourChips),
      h('div', { class: 'cstone__body' },
        h('div', { class: 'cstone__list' }, countEl, listEl, noneEl,
          h('p', { class: 'faint cstone__foot' }, `${D.stones.length} slabs read from the suppliers’ own pages on ${D.stones[0] ? D.stones[0].readAt : '—'}. Not in the list? Close this and type the colour name or code under “Custom colour”.`)),
        detailEl));
    applyFilters();
    const start = cur && D.stones.find((s) => s.id === cur.id);
    if (start) { select(start, true); if (window.matchMedia && window.matchMedia('(max-width: 699px)').matches) root.classList.remove('is-detail'); } else renderDetail();
  }

  loadStoneData().then((d) => { D = d; build(); }).catch((e) => { console.error('[stone picker]', e); root.replaceChildren(emptyState({ icon: 'warn', title: 'Stone list unavailable', text: 'The stone list could not be loaded. You can still type a colour name and pick a custom colour.' })); });
  return dlg;
}
