/**
 * Left sidebar — the catalogue: indoor / outdoor switch, category rail, search, sub-category chips, filters and a
 * windowed product grid (only the visible rows exist in the DOM, so 600+ products scroll smoothly).
 */
import { h, setKids, debounce, rafThrottle, titleize, clamp } from './dom.js';
import { icon, CATEGORY_ICON } from './icons.js';
import { btn, iconBtn, segmented, emptyState } from './components.js';
import { openPopover, openDialog } from './dialogs.js';
import { fmtPrice, fmtDims, fmtUnitPrice } from './format.js';
import { DND_TYPE, finishDndType } from './viewport.js';

const isFinish = (p) => p.type === 'floor-finish' || p.type === 'wall-finish';
const SORTS = [['relevance', 'Featured'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['name', 'Name']];

/** @param {HTMLElement} root  @param {object} app */
export function initCatalogPanel(root, app) {
  const { store, catalog, actions, thumbs } = app;
  const state = { category: null, subcategory: null, query: '', retailers: new Set(), minPrice: null, maxPrice: null, sort: 'relevance' };
  let results = [];
  let detail = null;

  /* ───────── Static structure ───────── */
  const rail = h('nav', { class: 'rail', 'aria-label': 'Categories' });
  const zone = segmented({ options: [{ value: 'indoor', label: 'Indoor' }, { value: 'outdoor', label: 'Outdoor' }], value: store.ui.catalogZone, label: 'Catalogue section', cls: 'seg--block', onChange: (v) => store.setUI({ catalogZone: v }) });
  const title = h('h2', { class: 'cat__title display truncate' }, 'Catalogue');
  const search = h('input', { class: 'search__input', type: 'search', placeholder: 'Search the catalogue', 'aria-label': 'Search the catalogue', autocomplete: 'off', spellcheck: 'false' });
  const clearSearch = iconBtn('close', 'Clear search', { size: 14, tip: false, class: 'search__clear', onClick: () => { search.value = ''; state.query = ''; clearSearch.hidden = true; refresh(); search.focus(); } });
  clearSearch.hidden = true;
  const filterBadge = h('span', { class: 'badge', hidden: true });
  const filterBtn = h('button', { type: 'button', class: 'iconbtn iconbtn--outlined', 'aria-label': 'Filters', 'data-tip': 'Filter by retailer and price', 'aria-haspopup': 'dialog', onClick: openFilters }, icon('filter', { size: 18 }), filterBadge);
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Sub-categories' });
  const sort = h('select', { class: 'select select--quiet', 'aria-label': 'Sort products', onChange: () => { state.sort = sort.value; refresh(); } },
    SORTS.map(([v, l]) => h('option', { value: v }, l)));
  const resultCount = h('span', { class: 'cat__results num', role: 'status', 'aria-live': 'polite' });
  const scroller = h('div', { class: 'cat__scroll', tabindex: '-1' });
  const spacer = h('div', { class: 'vgrid' });
  const win = h('div', { class: 'vgrid__win' });
  const empty = h('div', { class: 'cat__empty', hidden: true });
  spacer.append(win);
  scroller.append(spacer, empty);

  root.append(rail, h('div', { class: 'cat' },
    h('header', { class: 'side__head' }, title, iconBtn('panel-left', 'Hide the catalogue', { onClick: () => app.setPanelOpen('left', false) })),
    h('div', { class: 'cat__controls' }, zone,
      h('div', { class: 'cat__searchrow' }, h('div', { class: 'search' }, icon('search', { size: 16 }), search, clearSearch), filterBtn),
      chips),
    h('div', { class: 'cat__meta' }, resultCount, sort),
    scroller));

  /* ───────── Rail ───────── */
  function renderRail() {
    const z = store.ui.catalogZone;
    const cats = (catalog.CATEGORIES && catalog.CATEGORIES[z]) || [];
    const counts = safe(() => catalog.categoryCounts(z), {});
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const item = (id, name, iconName, n) => h('button', {
      type: 'button', class: `rail__btn${n === 0 ? ' is-empty' : ''}`, 'aria-pressed': String(state.category === id && !state.query),
      'aria-label': `${name}, ${n} ${n === 1 ? 'product' : 'products'}`, 'data-tip': name, 'data-kbd': String(n), 'data-tip-side': 'right',
      onClick: () => { state.category = id; state.subcategory = null; if (state.query) { state.query = ''; search.value = ''; clearSearch.hidden = true; } renderRail(); renderChips(); refresh(); scroller.scrollTop = 0; },
    }, icon(iconName, { size: 20 }), h('span', { class: 'rail__label' }, name));
    setKids(rail, item(null, z === 'indoor' ? 'All indoor' : 'All outdoor', 'all', total), h('div', { class: 'rail__sep', role: 'separator' }),
      cats.map((c) => item(c.id, c.name, CATEGORY_ICON[c.id] || 'all', counts[c.id] || 0)));
  }

  function currentCategory() {
    const cats = (catalog.CATEGORIES && catalog.CATEGORIES[store.ui.catalogZone]) || [];
    return cats.find((c) => c.id === state.category) || null;
  }

  function renderChips() {
    const cat = currentCategory();
    const subs = cat && !state.query ? cat.sub || [] : [];
    chips.hidden = !subs.length;
    if (!subs.length) { chips.replaceChildren(); return; }
    const present = new Set(safe(() => catalog.searchProducts({ zone: store.ui.catalogZone, category: cat.id }), []).map((p) => p.subcategory));
    const chip = (id, label) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.subcategory === id), onClick: () => { state.subcategory = id; renderChips(); refresh(); scroller.scrollTop = 0; } }, label);
    setKids(chips, chip(null, 'All'), subs.filter((s) => present.has(s)).map((s) => chip(s, titleize(s))));
  }

  /* ───────── Query ───────── */
  function activeFilterCount() { return state.retailers.size + (state.minPrice != null ? 1 : 0) + (state.maxPrice != null ? 1 : 0); }

  function refresh() {
    const z = store.ui.catalogZone;
    const cat = currentCategory();
    const opts = { zone: z, query: state.query, sort: state.sort };
    if (!state.query && cat) { opts.category = cat.id; if (state.subcategory) opts.subcategory = state.subcategory; }
    if (state.minPrice != null) opts.minPrice = state.minPrice;
    if (state.maxPrice != null) opts.maxPrice = state.maxPrice;
    let list = safe(() => catalog.searchProducts(opts), []);
    if (state.retailers.size) list = list.filter((p) => state.retailers.has(p.retailer));
    results = list;

    title.textContent = state.query ? 'Search results' : cat ? cat.name : (z === 'indoor' ? 'Indoor catalogue' : 'Outdoor catalogue');
    resultCount.textContent = `${list.length} ${list.length === 1 ? 'product' : 'products'}`;
    const n = activeFilterCount();
    filterBadge.hidden = !n;
    filterBadge.textContent = String(n);
    filterBtn.classList.toggle('is-active', n > 0);

    const totalInCatalogue = safe(() => catalog.allProducts().length, 0);
    empty.hidden = list.length > 0;
    spacer.hidden = list.length === 0;
    if (!list.length) {
      setKids(empty, totalInCatalogue === 0
        ? emptyState({ icon: 'sofa', title: 'The catalogue is empty', text: 'Products with prices and retailer links appear here as soon as the catalogue data is loaded.' })
        : emptyState({ icon: 'search', title: state.query ? `Nothing matches “${state.query}”` : 'No products here yet',
          text: n ? 'Try removing a filter.' : state.query ? 'Check the spelling or search for a type, such as “sofa” or “pergola”.' : 'Pick another category from the rail on the left.',
          action: (n || state.query) ? btn('Clear search and filters', { small: true, onClick: clearAll }) : null }));
    }
    grid.setItems(list);
  }

  function clearAll() {
    state.query = ''; search.value = ''; clearSearch.hidden = true;
    state.retailers.clear(); state.minPrice = null; state.maxPrice = null;
    renderRail(); renderChips(); refresh();
  }

  search.addEventListener('input', debounce(() => {
    state.query = search.value.trim();
    clearSearch.hidden = !search.value;
    renderRail(); renderChips(); refresh();
    scroller.scrollTop = 0;
  }, 160));
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && search.value) { e.stopPropagation(); clearSearch.click(); } });

  /* ───────── Filters popover ───────── */
  function openFilters() {
    const list = safe(() => catalog.retailers(store.ui.catalogZone), []);
    const numberInput = (label, key) => {
      const input = h('input', { class: 'field__input num', type: 'text', inputmode: 'numeric', placeholder: '₪', value: state[key] ?? '', 'aria-label': label,
        onChange: () => { const v = parseFloat(input.value.replace(/[^\d.]/g, '')); state[key] = Number.isFinite(v) ? v : null; input.value = state[key] ?? ''; refresh(); } });
      return h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), input);
    };
    const body = h('div', { class: 'filters' },
      h('h3', { class: 'filters__title' }, 'Retailer'),
      list.length ? h('div', { class: 'filters__list' }, list.map((r) => {
        const box = h('input', { type: 'checkbox', class: 'check__input', checked: state.retailers.has(r.name), onChange: () => { box.checked ? state.retailers.add(r.name) : state.retailers.delete(r.name); refresh(); } });
        return h('label', { class: 'check' }, box, h('span', { class: 'check__label truncate' }, r.name), h('span', { class: 'check__count num' }, r.count));
      })) : h('p', { class: 'faint' }, 'No retailers in this section yet.'),
      h('h3', { class: 'filters__title' }, 'Price'),
      h('div', { class: 'filters__price' }, numberInput('From', 'minPrice'), numberInput('To', 'maxPrice')),
      h('div', { class: 'filters__foot' }, btn('Clear filters', { variant: 'quiet', small: true, onClick: () => { state.retailers.clear(); state.minPrice = null; state.maxPrice = null; refresh(); pop.close(); } }),
        btn('Done', { variant: 'primary', small: true, onClick: () => pop.close() })));
    const pop = openPopover(filterBtn, body, { cls: 'popover--panel', placement: 'bottom-end', label: 'Filters' });
  }

  /* ───────── Cards ───────── */
  function card(p) {
    const finish = isFinish(p);
    const dims = p.dims ? fmtDims(p.dims.w, p.dims.d, p.dims.h).replace(' cm', '').replace(/ × /g, '×') : '';   // compact: fits beside the price
    const open = h('button', { type: 'button', class: 'pcard__open', 'aria-label': `${p.name}, ${p.retailer}, ${fmtUnitPrice(p.price, p.priceUnit)}. Show details`, onClick: () => openDetail(p, el) },
      h('span', { class: 'pcard__media' }, thumbs.el(p, { size: 176, lazy: false })),
      h('span', { class: 'pcard__body' },
        h('span', { class: 'pcard__name clamp-2' }, p.name),
        h('span', { class: 'pcard__retailer' }, h('span', { class: 'truncate' }, p.retailer), supplierMarks(p)),
        h('span', { class: 'pcard__foot' }, h('span', { class: 'pcard__dims num truncate' }, finish ? (p.priceUnit === 'm2' ? 'per m²' : '') : dims), h('span', { class: 'pcard__price num' }, fmtPrice(p.price)))));
    const add = h('button', { type: 'button', class: 'pcard__add', 'aria-label': finish ? `Apply ${p.name} to a room` : `Place ${p.name} in the plan`, 'data-tip': finish ? 'Apply to a room' : 'Place in plan',
      onClick: (e) => { e.stopPropagation(); finish ? actions.applyFinish(p, null, add) : actions.place(p); } }, icon(finish ? 'paint' : 'plus', { size: 16 }));
    const el = h('div', { class: 'pcard', draggable: 'true', dataset: { id: p.id } }, open, add);
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(DND_TYPE, p.id);
      // the kind travels as a type too: drop targets can read types (not data) while dragging, to highlight the target
      if (finish) e.dataTransfer.setData(finishDndType(p.type === 'wall-finish' ? 'wall' : 'floor'), p.id);
      e.dataTransfer.setData('text/plain', p.name);
      e.dataTransfer.effectAllowed = 'copy';
      const media = el.querySelector('.pcard__media');
      if (media && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(media, media.offsetWidth / 2, media.offsetHeight / 2);
      el.classList.add('is-dragging');
      detail && detail.close();
      if (app.isCompact()) setTimeout(() => app.closePanels(), 0);
    });
    el.addEventListener('dragend', () => el.classList.remove('is-dragging'));
    return el;
  }

  /* ───────── Product detail ───────── */
  function openDetail(p, anchor) {
    detail && detail.close();
    const finish = isFinish(p);
    const place = btn(finish ? 'Apply to a room' : 'Place in plan', { variant: 'primary', icon: finish ? 'paint' : 'plus', block: true, attrs: { 'data-autofocus': '' },
      onClick: () => { const d = detail; finish ? actions.applyFinish(p, null, null) : actions.place(p); d && d.close(); } });
    const body = h('div', { class: 'pdetail' },
      h('div', { class: 'pdetail__media' }, thumbs.el(p, { size: 352, lazy: false })),
      h('div', { class: 'pdetail__body' },
        h('p', { class: 'pdetail__retailer' }, [p.brand && p.brand !== p.retailer ? `${p.brand}, ` : '', p.retailer, supplierMarks(p, true)]),
        h('h3', { class: 'pdetail__name display' }, p.name),
        p.nameHe && h('p', { class: 'pdetail__he', lang: 'he', dir: 'rtl' }, p.nameHe),
        h('p', { class: 'pdetail__price' }, h('span', { class: 'num' }, fmtPrice(p.price)), p.priceUnit && p.priceUnit !== 'item' ? h('span', { class: 'pdetail__unit' }, p.priceUnit === 'm2' ? 'per m²' : 'per metre') : null),
        p.description && h('p', { class: 'pdetail__desc' }, p.description),
        h('dl', { class: 'facts' },
          p.dims && !finish ? [h('dt', null, 'Size'), h('dd', { class: 'num' }, h('span', { class: 'dimline' }, fmtDims(p.dims.w, p.dims.d, p.dims.h)), h('small', { class: 'faint' }, 'width × depth × height'))] : null,
          finish && p.params && p.params.tileW ? [h('dt', null, 'Format'), h('dd', { class: 'num' }, `${p.params.tileW} × ${p.params.tileH || p.params.tileW} cm`)] : null,
          p.priceDate ? [h('dt', null, 'Price seen'), h('dd', { class: 'num' }, p.priceDate)] : null),
        h('div', { class: 'pdetail__actions' }, place, btn('View at retailer', { href: p.url, iconRight: 'external', block: true }))));
    if (app.isCompact()) {
      const dlg = openDialog({ title: 'Product', size: 'sm', cls: 'dialog--flush', body, onClose: () => { if (detail === dlg) detail = null; } });
      detail = dlg;
    } else {
      // Dock the sheet to the sidebar's outer edge, level with the card, so it never covers the grid.
      const dock = { getBoundingClientRect: () => {
        const side = root.getBoundingClientRect(), c = anchor.isConnected ? anchor.getBoundingClientRect() : side;
        return { left: side.right, right: side.right, top: c.top, bottom: c.bottom, width: 0, height: c.height };
      } };
      const pop = openPopover(dock, body, { cls: 'popover--detail', placement: 'right-start', gap: 8, label: p.name, onClose: () => { if (detail === pop) detail = null; } });
      detail = pop;
    }
  }

  /* ───────── Windowed grid ───────── */
  const grid = createVirtualGrid(scroller, spacer, win, card, thumbs);

  /* ───────── Store wiring ───────── */
  store.on('ui', (e) => {
    if (!e.keys.includes('catalogZone')) return;
    zone.set(store.ui.catalogZone);
    state.category = null; state.subcategory = null; state.retailers.clear();
    renderRail(); renderChips(); refresh();
    scroller.scrollTop = 0;
  });

  renderRail(); renderChips(); refresh();
  return {
    /** Re-read the catalogue (it may have been loaded or replaced after the UI started). */
    refresh() { renderRail(); renderChips(); refresh(); },
    focusSearch() { search.focus(); },
    relayout() { grid.layout(); },
  };
}

/** Run a catalogue call that must never break the panel. */
function safe(fn, fallback) {
  try { const v = fn(); return v == null ? fallback : v; } catch (err) { console.error('[ui] catalogue call failed', err); return fallback; }
}

/**
 * Windowed grid: `spacer` has the full scroll height, `win` holds only the rows near the viewport.
 * Card elements are kept by product id while they stay in the window, so thumbnails are not re-created on scroll.
 */
function createVirtualGrid(scroller, spacer, win, renderCard, thumbs) {
  const GAP = 8, MIN_COL = 132, PAD = 12, OVERSCAN = 2;
  let items = [];
  let cols = 2, rowH = 190, colW = 140;
  let live = new Map();     // id → element
  let range = [-1, -1];

  function measure() {
    const width = scroller.clientWidth - PAD * 2;
    if (width <= 0) return false;
    cols = Math.max(1, Math.floor((width + GAP) / (MIN_COL + GAP)));
    colW = (width - GAP * (cols - 1)) / cols;
    rowH = Math.round(colW * 0.74) + 84;
    win.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    win.style.gridAutoRows = `${rowH}px`;
    return true;
  }

  function update(force) {
    const rows = Math.ceil(items.length / cols);
    spacer.style.height = `${rows ? rows * (rowH + GAP) - GAP + PAD * 2 : 0}px`;
    const top = scroller.scrollTop - PAD, viewH = scroller.clientHeight || 600;
    const first = clamp(Math.floor(top / (rowH + GAP)) - OVERSCAN, 0, Math.max(0, rows - 1));
    const last = clamp(Math.ceil((top + viewH) / (rowH + GAP)) + OVERSCAN, 0, rows);
    if (!force && first === range[0] && last === range[1]) return;
    range = [first, last];
    const slice = items.slice(first * cols, last * cols);
    const next = new Map();
    for (const p of slice) next.set(p.id, live.get(p.id) || renderCard(p));
    for (const [id, el] of live) if (!next.has(id)) thumbs.forget(el.querySelector('.thumb'));
    live = next;
    win.style.transform = `translateY(${first * (rowH + GAP)}px)`;
    win.replaceChildren(...next.values());
  }

  const onScroll = rafThrottle(() => update(false));
  scroller.addEventListener('scroll', onScroll, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(rafThrottle(() => { if (measure()) update(true); })).observe(scroller);

  return {
    setItems(list) { items = list; live = new Map(); range = [-1, -1]; measure(); update(true); },
    layout() { if (measure()) update(true); },
  };
}

/**
 * Small marks beside the supplier's name: a star for a supplier with a recorded high rating, a gem for a design studio /
 * boutique. They come from the product's tags, which the catalogue research sets only with recorded evidence
 * (see the *.sources.md files). `withText` adds the words (product details).
 */
const SUPPLIER_MARKS = [
  { tag: 'top-rated', icon: 'star', label: 'Top-rated supplier', tip: 'Top-rated supplier: a high public rating was recorded when this product was added' },
  { tag: 'boutique', icon: 'gem', label: 'Design studio / boutique', tip: 'Design studio or boutique supplier' },
];
function supplierMarks(p, withText = false) {
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const marks = SUPPLIER_MARKS.filter((m) => tags.includes(m.tag));
  if (!marks.length) return null;
  return h('span', { class: `smarks${withText ? ' smarks--text' : ''}` }, marks.map((m) =>
    h('span', { class: `smark smark--${m.icon}`, role: 'img', 'aria-label': m.label, 'data-tip': m.tip, title: m.tip }, icon(m.icon, { size: withText ? 14 : 12 }), withText ? h('span', null, m.label) : null)));
}

