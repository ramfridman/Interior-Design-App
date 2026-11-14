/**
 * "Add your own product" (docs/CONTRACT.md § 16): a dialog where the person types in a product from any shop — link,
 * shop, name, price (or price on request), where it goes, the kind of item (a 3D model type, picked from thumbnails),
 * its main options and sizes — with a live 3D preview. The product belongs to the open project (store.customProducts)
 * and behaves like a catalogue product everywhere; it can also be kept in a small library on this device.
 *
 *   const own = ownProductsFor(app);
 *   own.openAdd({ zone, category })   own.openEdit(productId)   own.openLink(itemId)   own.confirmDelete(productId)
 *
 * The app never reads other shops' pages (the browser cannot, and nothing is sent anywhere): the person copies the
 * facts from the product page.
 */
import { h, setKids, debounce } from './dom.js';
import { icon } from './icons.js';
import { btn, segmented } from './components.js';
import { openDialog, confirmDialog, toast } from './dialogs.js';
import { fmtDims, fmtUnitPrice } from './format.js';
import { libraryList, libraryPut, libraryRemove, inLibrary } from './own-library.js';
import {
  validateOwnInput, buildOwnProduct, inputFromProduct, typesForCategory, subcategoryFor, typeOptions, defaultSize, typeName,
  shopFromUrl, isFinishType, readNumber, humanize, isOwnProduct, LIMITS,
} from '../catalog/own.js';

const PALETTE = ['#f3f1ec', '#d9d2c5', '#b9b2a6', '#7d7a74', '#3a3d42', '#c8a476', '#8a5a3b', '#5c6b5a', '#3e5c76', '#b4543a'];
const UNITS = [['item', 'per item'], ['m2', 'per m²'], ['m', 'per metre']];
const STEPS = [
  { id: 'shop', title: 'Where to buy it', fields: ['url', 'retailer', 'name', 'brand', 'note', 'price'] },
  { id: 'kind', title: 'What it is', fields: ['category', 'type'] },
  { id: 'size', title: 'Size and look', fields: ['w', 'd', 'h', 'tileW', 'tileH'] },
];

/** The controller, one per app (created on first use). */
export function ownProductsFor(app) {
  if (!app.ownProducts) app.ownProducts = createOwnProducts(app);
  return app.ownProducts;
}

function createOwnProducts(app) {
  const { store, catalog } = app;
  const builtIn = () => (typeof catalog.catalogProducts === 'function' ? catalog.catalogProducts() : catalog.allProducts().filter((p) => !isOwnProduct(p)));
  const who = () => {
    try { const s = app.collab && app.collab.session && app.collab.session(); if (!s) return null; const you = s.client && s.client.you && s.client.you(); return (you && you.email) || app.collab.user || null; } catch (e) { return null; }
  };
  /** Shop name for a link: the catalogue's own name for a host it knows (www.ikea.com → "IKEA Israel"), else the host. */
  function shopForUrl(url) {
    const host = shopFromUrl(url);
    if (!host) return '';
    const seen = new Map();
    for (const p of catalog.allProducts()) { const hp = p.url && shopFromUrl(p.url); if (hp === host) seen.set(p.retailer, (seen.get(p.retailer) || 0) + 1); }
    const best = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : host;
  }
  const knownShops = () => { try { return catalog.retailers().map((r) => r.name); } catch (e) { return []; } };

  /* ───────────── The dialog ───────────── */
  /**
   * @param {{ mode: 'add'|'edit'|'link', product?: object, item?: object, zone?: string, category?: string }} o
   */
  function openForm(o) {
    const editing = o.mode === 'edit' ? o.product : null;
    const linkItem = o.mode === 'link' ? o.item : null;
    const phone = !!(app.isPhone && app.isPhone());
    const startZone = editing ? editing.zone : linkItem ? (linkItem.zone === 'outdoor' ? 'outdoor' : 'indoor') : (o.zone || store.ui.catalogZone || 'indoor');
    const input = editing ? inputFromProduct(editing) : {
      url: '', retailer: '', name: linkItem ? linkItem.name : '', brand: '', note: '', price: '', priceUnit: 'item', priceOnRequest: false,
      zone: startZone, category: null, subcategory: null, type: linkItem ? linkItem.type : null,
      params: linkItem ? { ...(linkItem.params || {}) } : {},
      dims: linkItem ? { w: round1(linkItem.w), d: round1(linkItem.d), h: round1(linkItem.h) } : null,
    };
    if (!input.category) input.category = guessCategory(input.zone, input.type, o.category);
    if (!input.type) input.type = typesForCategory(input.zone, input.category, builtIn())[0] || null;
    if (!input.dims) input.dims = { ...defaultSize(input.type) };
    if (isFinishType(input.type) && !editing) input.priceUnit = 'm2';
    let retailerAuto = !editing;     // the shop name was filled from the link (a new link may replace it)
    let unitTouched = !!editing, dimsTouched = !!(editing || linkItem);
    let tried = false, step = 0, showAllKinds = false, keep = editing ? inLibrary(editing.id) : true;

    /* fields */
    const errs = {};
    const err = (k) => (errs[k] = h('p', { class: 'own__err', role: 'alert', id: `own-err-${k}`, hidden: true }));
    const textIn = (k, attrs = {}) => {
      const el = h('input', { class: 'own__input', type: 'text', autocomplete: 'off', spellcheck: 'false', id: `own-${k}`, 'aria-describedby': `own-err-${k}`, value: input[k] || '', ...attrs });
      el.addEventListener('input', () => { input[k] = el.value; changed(k); });
      return el;
    };
    const row = (label, k, control, hint) => h('div', { class: 'own__row', dataset: { field: k } },
      h('label', { class: 'own__label', for: `own-${k}` }, label, hint ? h('span', { class: 'own__opt' }, hint) : null), control, err(k));

    const url = textIn('url', { type: 'url', inputmode: 'url', placeholder: 'https://…', maxlength: '2000' });
    url.addEventListener('input', () => {
      const shop = shopForUrl(url.value.trim());
      if (shop && (retailerAuto || !retailer.value.trim())) { retailer.value = shop; input.retailer = shop; retailerAuto = true; changed('retailer'); }
    });
    const listId = `own-shops-${Math.random().toString(36).slice(2, 7)}`;
    const retailer = textIn('retailer', { list: listId, placeholder: 'e.g. kaza.co.il', maxlength: String(LIMITS.name) });
    retailer.addEventListener('input', () => { retailerAuto = false; });
    const shops = h('datalist', { id: listId }, knownShops().map((n) => h('option', { value: n })));
    const name = textIn('name', { placeholder: 'As the shop calls it', maxlength: String(LIMITS.name) });
    const brand = textIn('brand', { placeholder: 'If the shop names one', maxlength: String(LIMITS.name) });
    const note = h('textarea', { class: 'textarea own__note', id: 'own-note', rows: '2', maxlength: String(LIMITS.text), placeholder: 'Colour code, delivery time, what to ask the shop…', 'aria-describedby': 'own-err-note' });
    note.value = input.note || '';
    note.addEventListener('input', () => { input.note = note.value; changed('note'); });

    const price = textIn('price', { inputmode: 'decimal', placeholder: '0', class: 'own__input own__input--num' });
    const unit = h('select', { class: 'select own__unit', 'aria-label': 'Price unit', onChange: () => { input.priceUnit = unit.value; unitTouched = true; changed('price'); } },
      UNITS.map(([v, l]) => h('option', { value: v, selected: input.priceUnit === v }, l)));
    const ask = h('input', { type: 'checkbox', class: 'check__input', checked: !!input.priceOnRequest, onChange: () => { input.priceOnRequest = ask.checked; syncPrice(); changed('price'); } });
    const priceBox = h('div', { class: 'own__price' }, h('span', { class: 'own__cur', 'aria-hidden': 'true' }, '₪'), price, unit);
    const syncPrice = () => { price.disabled = unit.disabled = !!input.priceOnRequest; priceBox.classList.toggle('is-off', !!input.priceOnRequest); };
    syncPrice();

    /* where / category / kind */
    const zone = segmented({ options: [{ value: 'indoor', label: 'Indoor' }, { value: 'outdoor', label: 'Outdoor' }], value: input.zone, label: 'Where it goes', cls: 'seg--block',
      onChange: (v) => { input.zone = v; input.category = guessCategory(v, input.type, null); paintCategory(); pickDefaultType(); changed('category'); } });
    const category = h('select', { class: 'select own__select', id: 'own-category', 'aria-describedby': 'own-err-category', onChange: () => { input.category = category.value; showAllKinds = false; pickDefaultType(); changed('category'); } });
    const kinds = h('div', { class: 'own__kinds', role: 'radiogroup', 'aria-label': 'Kind of item', id: 'own-type' });
    const moreKinds = h('button', { type: 'button', class: 'own__morekinds', onClick: () => { showAllKinds = !showAllKinds; paintKinds(); } });
    function paintCategory() {
      const cats = (catalog.CATEGORIES && catalog.CATEGORIES[input.zone]) || [];
      setKids(category, cats.map((c) => h('option', { value: c.id, selected: c.id === input.category }, c.name)));
      paintKinds();
    }
    function kindList() { return typesForCategory(input.zone, input.category, builtIn(), { all: showAllKinds }); }
    function paintKinds() {
      const list = kindList();
      if (input.type && !list.includes(input.type)) list.unshift(input.type);
      setKids(kinds, list.map((t) => {
        const sz = defaultSize(t);
        const subject = { type: t, w: sz.w || 60, d: sz.d || 60, h: sz.h || 60, params: {}, placement: catalog.MODEL_TYPES[t] ? catalog.MODEL_TYPES[t].placement : 'floor' };
        return h('button', { type: 'button', class: 'own__kind', role: 'radio', 'aria-checked': String(t === input.type), title: catalog.MODEL_TYPES[t] ? catalog.MODEL_TYPES[t].label : t,
          onClick: () => { if (input.type === t) return; input.type = t; onTypeChanged(); paintKinds(); changed('type'); } },
        h('span', { class: 'own__kindthumb' }, app.thumbs.el(subject, { size: 72 })), h('span', { class: 'own__kindname' }, typeName(t)));
      }));
      const all = typesForCategory(input.zone, input.category, builtIn(), { all: true }).length;
      moreKinds.hidden = !showAllKinds && all <= kindList().length;
      moreKinds.textContent = showAllKinds ? 'Show only the usual kinds' : 'Show every kind of item';
    }
    function pickDefaultType() {
      const list = kindList();
      if (!list.includes(input.type)) { input.type = list[0] || null; onTypeChanged(); }
      paintKinds();
    }
    function onTypeChanged() {
      const keepColor = input.params && input.params.color;
      input.params = keepColor ? { color: keepColor } : {};
      if (!dimsTouched) input.dims = { ...defaultSize(input.type) };
      if (!unitTouched) input.priceUnit = isFinishType(input.type) ? 'm2' : 'item';
      unit.value = input.priceUnit;
      paintOptions(); paintSizes();
    }

    /* options (the type's declared params) */
    const optsMain = h('div', { class: 'own__opts' });
    const optsMore = h('div', { class: 'own__opts' });
    const more = h('details', { class: 'own__more' }, h('summary', null, 'More options'), optsMore);
    function optionControl(op) {
      const id = `own-p-${op.key}`;
      const cur = input.params[op.key];
      const set = (v) => { if (v === '' || v == null) delete input.params[op.key]; else input.params[op.key] = v; changed(op.key); };
      if (op.kind === 'color') {
        const custom = h('input', { type: 'color', class: 'swatch swatch--custom', id, value: /^#[0-9a-f]{6}$/i.test(cur || '') ? cur : '#cccccc', 'aria-label': `${op.label}: pick any colour`, 'data-tip': 'Any colour',
          onInput: () => { set(custom.value.toLowerCase()); mark(); } });
        const sw = (c) => h('button', { type: 'button', class: 'swatch', 'aria-label': c ? `${op.label} ${c}` : `${op.label}: the model's own`, 'data-tip': c || 'As the model', style: c ? { '--sw': c } : null, dataset: { c: c || '' },
          onClick: () => { set(c || null); if (c) custom.value = c; mark(); } }, c ? null : h('span', { class: 'own__auto' }, 'Auto'));
        const sws = [sw(null), ...PALETTE.map(sw)];
        const mark = () => { const v = (input.params[op.key] || '').toLowerCase(); for (const b of sws) b.setAttribute('aria-pressed', String(b.dataset.c === v)); custom.classList.toggle('is-on', !!v && !PALETTE.includes(v)); };
        mark();
        return h('div', { class: 'own__row own__row--wide' }, h('span', { class: 'own__label' }, op.label), h('div', { class: 'swatches own__swatches' }, sws, custom));
      }
      if (op.kind === 'enum') {
        const sel = h('select', { class: 'select own__select', id, onChange: () => set(sel.value || null) },
          h('option', { value: '' }, 'As the model'), op.options.map((v) => h('option', { value: v, selected: cur === v }, humanize(v))));
        return h('div', { class: 'own__row' }, h('label', { class: 'own__label', for: id }, op.label), sel);
      }
      if (op.kind === 'bool') {
        const box = h('input', { type: 'checkbox', class: 'check__input', id, checked: cur === true, onChange: () => set(box.checked ? true : null) });
        return h('label', { class: 'check own__check' }, box, h('span', { class: 'check__label' }, op.label));
      }
      const num = h('input', { class: 'own__input own__input--num', id, type: 'text', inputmode: 'decimal', value: cur != null ? String(cur) : '',
        placeholder: op.unit === 'cm' ? 'cm' : 'As the model', 'aria-describedby': `own-err-${op.key}`, onInput: () => set(num.value.trim() === '' ? null : num.value.trim()) });
      return h('div', { class: 'own__row', dataset: { field: op.key } }, h('label', { class: 'own__label', for: id }, op.label, op.unit ? h('span', { class: 'own__opt' }, op.unit) : null), num, err(op.key));
    }
    function paintOptions() {
      const ops = typeOptions(input.type);
      const finish = isFinishType(input.type);
      setKids(optsMain, ops.filter((op) => op.main).map(optionControl));
      const rest = ops.filter((op) => !op.main);
      setKids(optsMore, rest.map(optionControl));
      more.hidden = !rest.length;
      sizeBlock.hidden = finish;
      finishHint.hidden = !finish;
    }

    /* sizes */
    const dimIn = (k, label) => {
      const el = h('input', { class: 'own__input own__input--num', id: `own-${k}`, type: 'text', inputmode: 'decimal', 'aria-describedby': `own-err-${k}`, 'aria-label': `${label} in cm`,
        onInput: () => { input.dims[k] = el.value; dimsTouched = true; changed(k); } });
      return el;
    };
    const dw = dimIn('w', 'Width'), dd = dimIn('d', 'Depth'), dh = dimIn('h', 'Height');
    const cell = (label, k, el) => h('div', { class: 'own__dim', dataset: { field: k } }, h('label', { class: 'own__label', for: `own-${k}` }, label), h('div', { class: 'own__dimbox' }, el, h('span', { class: 'own__suffix' }, 'cm')), err(k));
    const sizeWarn = h('p', { class: 'own__warn', role: 'status', hidden: true });
    const sizeBlock = h('div', { class: 'own__dims' }, cell('Width', 'w', dw), h('span', { class: 'own__times', 'aria-hidden': 'true' }, '×'), cell('Depth', 'd', dd), h('span', { class: 'own__times', 'aria-hidden': 'true' }, '×'), cell('Height', 'h', dh));
    const finishHint = h('p', { class: 'own__hint' }, 'A floor or wall finish is priced per m² and covers a whole room: give the tile or plank size and colours. Apply it to a room from the catalogue or the Rooms tab.');
    function paintSizes() { dw.value = fmtNum(input.dims.w); dd.value = fmtNum(input.dims.d); dh.value = fmtNum(input.dims.h); }

    const keepBox = h('input', { type: 'checkbox', class: 'check__input', checked: keep, onChange: () => { keep = keepBox.checked; } });

    /* preview */
    const previewMedia = h('div', { class: 'own__pmedia' });
    const previewText = h('div', { class: 'own__ptext' });
    const preview = h('aside', { class: 'own__preview', 'aria-label': 'Preview' }, h('p', { class: 'own__ptitle' }, 'Preview'), previewMedia, previewText);
    const subject = () => {
      const t = input.type, sz = defaultSize(t);
      const w = readNumber(input.dims.w), d = readNumber(input.dims.d), hh = readNumber(input.dims.h);
      const ok = (v, lo, hi) => v != null && v >= lo && v <= hi;
      return { id: 'own-preview', type: t, params: { ...input.params }, placement: catalog.MODEL_TYPES[t] ? catalog.MODEL_TYPES[t].placement : 'floor',
        dims: { w: ok(w, 1, 3000) ? w : sz.w || 60, d: ok(d, 1, 3000) ? d : sz.d || 60, h: ok(hh, 0.5, 1000) ? hh : sz.h || 60 } };
    };
    // the new picture is laid over the last one and replaces it once rendered (no flash of the plan symbol)
    const paintPreview = debounce(() => {
      if (!input.type) { setKids(previewMedia); return; }
      const el = app.thumbs.el(subject(), { size: phone ? 200 : 260, lazy: false });
      const old = [...previewMedia.children];
      previewMedia.append(el);
      const done = () => { for (const o of old) o.remove(); };
      if (!old.length || el.classList.contains('is-loaded')) { done(); return; }
      el.classList.add('own__pnext');
      const mo = new MutationObserver(() => { if (el.classList.contains('is-loaded')) { mo.disconnect(); el.classList.remove('own__pnext'); done(); } });
      mo.observe(el, { attributes: true, attributeFilter: ['class'] });
      setTimeout(() => { mo.disconnect(); el.classList.remove('own__pnext'); done(); }, 6000);   // no 3D renderer: keep the symbol
    }, 250);
    function paintPreviewText() {
      const p = readNumber(input.price);
      const finish = isFinishType(input.type);
      const s = subject();
      setKids(previewText,
        h('p', { class: 'own__pname' }, input.name.trim() || (input.type ? typeName(input.type) : 'Your product')),
        h('p', { class: 'own__pshop' }, [input.brand.trim() && input.brand.trim() !== input.retailer.trim() ? `${input.brand.trim()}, ` : '', input.retailer.trim() || 'Shop'], ownMark(true)),
        h('p', { class: 'own__pprice num' }, input.priceOnRequest ? 'Price on request' : p > 0 ? fmtUnitPrice(p, input.priceUnit) : '₪ —'),
        !finish && input.type ? h('p', { class: 'own__pdims num' }, fmtDims(s.dims.w, s.dims.d, s.dims.h)) : null,
        input.type ? h('p', { class: 'own__pkind' }, catalog.MODEL_TYPES[input.type] ? catalog.MODEL_TYPES[input.type].label : input.type) : null);
    }

    /* validation */
    function showErrors(force) {
      const v = validateOwnInput(input);
      for (const [k, el] of Object.entries(errs)) {
        const msg = (tried || force) ? v.errors[k] || '' : '';
        el.textContent = msg; el.hidden = !msg;
        const ctl = form.querySelector(`#own-${k}`) || form.querySelector(`#own-p-${k}`);
        if (ctl) ctl.setAttribute('aria-invalid', msg ? 'true' : 'false');
      }
      sizeWarn.textContent = v.warnings.size || '';
      sizeWarn.hidden = !v.warnings.size || isFinishType(input.type);
      return v;
    }
    function changed() { paintPreview(); paintPreviewText(); showErrors(false); }

    /* layout */
    const libBtn = libraryList().length && !editing ? btn('From my library…', { small: true, variant: 'quiet', icon: 'own', onClick: () => openLibrary({ back: true, linkItem }) }) : null;
    const secShop = h('section', { class: 'own__sec', dataset: { step: 'shop' } },
      h('h3', { class: 'own__h' }, 'Where to buy it'),
      h('p', { class: 'own__lead' }, icon('info', { size: 14 }), h('span', null, 'The app can’t read other shops’ pages — copy the name, price and sizes from the product page.')),
      row('Link to the product page', 'url', url, 'optional'),
      row('Shop', 'retailer', h('div', null, retailer, shops)),
      row('Product name', 'name', name),
      row('Brand', 'brand', brand, 'optional'),
      h('div', { class: 'own__row', dataset: { field: 'price' } }, h('label', { class: 'own__label', for: 'own-price' }, 'Price'), priceBox,
        h('label', { class: 'check own__check' }, ask, h('span', { class: 'check__label' }, 'Price on request (no price on the page)')), err('price')),
      row('Note', 'note', note, 'optional'));
    const secKind = h('section', { class: 'own__sec', dataset: { step: 'kind' } },
      h('h3', { class: 'own__h' }, 'What it is'),
      h('div', { class: 'own__row' }, h('span', { class: 'own__label' }, 'Where it goes'), zone),
      h('div', { class: 'own__row', dataset: { field: 'category' } }, h('label', { class: 'own__label', for: 'own-category' }, 'Category'), category, err('category')),
      h('div', { class: 'own__row own__row--wide', dataset: { field: 'type' } }, h('span', { class: 'own__label' }, 'Kind of item', h('span', { class: 'own__opt' }, 'the 3D model it is shown with')), kinds, moreKinds, err('type')));
    const secSize = h('section', { class: 'own__sec', dataset: { step: 'size' } },
      h('h3', { class: 'own__h' }, 'Size and look'),
      sizeBlock, sizeWarn, finishHint, optsMain, more,
      h('label', { class: 'check own__check own__keep' }, keepBox, h('span', { class: 'check__label' }, 'Keep in my library on this device', h('small', { class: 'faint' }, ' — to add it to other projects'))));
    const stepper = h('ol', { class: 'own__steps', 'aria-label': 'Steps' });
    const form = h('form', { class: 'own__form', novalidate: true, onSubmit: (e) => { e.preventDefault(); save(); } }, stepper, secShop, secKind, secSize);
    const body = h('div', { class: `own${phone ? ' own--steps' : ''}` }, h('div', { class: 'own__main' }, libBtn ? h('div', { class: 'own__libbar' }, libBtn) : null, form), preview);

    const cancel = btn('Cancel', { variant: 'quiet', onClick: () => dlg.close() });
    const back = btn('Back', { variant: 'quiet', onClick: () => go(step - 1) });
    const next = btn('Next', { variant: 'primary', onClick: () => { if (stepValid(step)) go(step + 1); } });
    const saveBtn = btn(editing ? 'Save changes' : linkItem ? 'Save and link' : 'Add product', { variant: 'primary', onClick: save });
    const title = editing ? 'Edit your product' : linkItem ? 'Link to a product you found' : 'Add your own product';
    const dlg = openDialog({ title, size: 'xl', cls: 'dialog--own', body, actions: [cancel, back, next, saveBtn], initialFocus: phone ? null : (editing || linkItem ? name : url) });

    function stepValid(i) {
      tried = true;
      const v = showErrors(true);
      const bad = STEPS[i].fields.find((f) => v.errors[f]);
      if (bad) { focusField(bad); return false; }
      return true;
    }
    function go(i) {
      step = Math.max(0, Math.min(STEPS.length - 1, i));
      if (phone) for (const s of [secShop, secKind, secSize]) s.hidden = s.dataset.step !== STEPS[step].id;
      back.hidden = !phone || step === 0;
      next.hidden = !phone || step === STEPS.length - 1;
      saveBtn.hidden = phone && step !== STEPS.length - 1;
      setKids(stepper, phone ? STEPS.map((s, j) => h('li', { class: `own__step${j === step ? ' is-on' : j < step ? ' is-done' : ''}`, 'aria-current': j === step ? 'step' : null }, h('span', { class: 'own__stepn' }, String(j + 1)), h('span', { class: 'own__stept' }, s.title))) : null);
      stepper.hidden = !phone;
      if (phone) dlg.body.scrollTop = 0;
    }
    function focusField(k) {
      const idx = STEPS.findIndex((s) => s.fields.includes(k));
      if (phone && idx >= 0 && idx !== step) go(idx);
      const el = form.querySelector(`#own-${k}`) || form.querySelector(`[data-field="${k}"]`);
      if (el) { el.scrollIntoView({ block: 'center' }); if (el.focus) el.focus({ preventScroll: true }); }
    }
    function save() {
      tried = true;
      const v = showErrors(true);
      if (!v.ok) { focusField(Object.keys(v.errors)[0]); return; }
      const sub = subcategoryFor(input.zone, input.category, input.type, builtIn());
      const product = buildOwnProduct({ ...input, subcategory: editing && editing.category === input.category && editing.type === input.type ? editing.subcategory : sub },
        { prev: editing, createdBy: editing ? null : who(), products: builtIn() });
      let saved;
      if (editing) saved = store.updateCustomProduct(editing.id, product);
      else saved = store.addCustomProduct(product, linkItem ? { linkItem: linkItem.id } : {});
      if (!saved) { toast('That product could not be saved.', { kind: 'error' }); return; }
      if (keep) libraryPut(saved); else if (editing && inLibrary(saved.id)) libraryRemove(saved.id);
      dlg.close();
      if (editing) {
        const n = store.itemsOfProduct(saved.id).length;
        toast(n ? `Product updated — ${n} placed ${n === 1 ? 'item follows' : 'items follow'}` : 'Product updated', { kind: 'success', action: { label: 'Undo', fn: () => app.actions.undo() } });
      } else if (linkItem) {
        toast(`Linked to ${saved.name}`, { kind: 'success', action: { label: 'Undo', fn: () => app.actions.undo() } });
      } else {
        toast(`${saved.name} added to the catalogue`, { kind: 'success', action: { label: isFinishType(saved.type) ? 'Apply' : 'Place it', fn: () => app.actions.place(catalog.getProduct(saved.id)) } });
        if (app.onOwnProductAdded) app.onOwnProductAdded(saved);
      }
    }

    // initial paint
    price.value = input.price || '';
    paintCategory(); paintOptions(); paintSizes(); changed();
    go(0);
    return dlg;
  }

  /** A category for a type: the given one if it fits the zone, else the one the catalogue uses most for that type. */
  function guessCategory(zone, type, wanted) {
    const cats = (catalog.CATEGORIES && catalog.CATEGORIES[zone]) || [];
    if (wanted && cats.some((c) => c.id === wanted)) return wanted;
    if (type) {
      const counts = new Map();
      for (const p of builtIn()) if (p.zone === zone && p.type === type) counts.set(p.category, (counts.get(p.category) || 0) + 1);
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) return best[0];
      if (isFinishType(type) && cats.some((c) => c.id === 'finishes')) return 'finishes';
    }
    return cats[0] ? cats[0].id : null;
  }

  /* ───────────── Library ───────────── */
  function openLibrary({ linkItem = null } = {}) {
    const listEl = h('ul', { class: 'own__lib' });
    const paint = () => {
      const list = libraryList();
      if (!list.length) { setKids(listEl, h('li', { class: 'own__libempty' }, 'Your library on this device is empty. Products you add with “Keep in my library” appear here.')); return; }
      setKids(listEl, list.map((p) => {
        const here = !!store.getCustomProduct(p.id);
        return h('li', { class: 'own__librow' },
          h('span', { class: 'own__libthumb' }, app.thumbs.el(p, { size: 72 })),
          h('span', { class: 'own__libtext' }, h('span', { class: 'own__libname truncate' }, p.name),
            h('span', { class: 'own__libmeta truncate' }, `${p.retailer} · ${p.price == null ? 'price on request' : fmtUnitPrice(p.price, p.priceUnit)}`)),
          h('span', { class: 'own__libacts' },
            here ? h('span', { class: 'own__libhere faint' }, 'In this project')
              : btn(linkItem ? 'Use' : 'Add', { small: true, variant: 'primary', onClick: () => {
                const saved = store.addCustomProduct(p, linkItem ? { linkItem: linkItem.id } : {});
                if (!saved) { toast('That product could not be added.', { kind: 'error' }); return; }
                dlg.close();
                toast(linkItem ? `Linked to ${saved.name}` : `${saved.name} added to this project`, { kind: 'success', action: { label: 'Undo', fn: () => app.actions.undo() } });
                if (!linkItem && app.onOwnProductAdded) app.onOwnProductAdded(saved);
              } }),
            h('button', { type: 'button', class: 'iconbtn own__libdel', 'aria-label': `Remove ${p.name} from my library`, 'data-tip': 'Remove from my library', onClick: () => { libraryRemove(p.id); paint(); } }, icon('trash', { size: 16 }))));
      }));
    };
    paint();
    const dlg = openDialog({ title: 'From my library', size: 'md', cls: 'dialog--ownlib',
      body: [h('p', { class: 'dialog__text' }, 'Products you added before, kept in this browser only. Adding one copies it into the open project.'), listEl],
      actions: [btn('Close', { variant: 'quiet', onClick: () => dlg.close() })] });
    return dlg;
  }

  /* ───────────── Delete ───────────── */
  async function confirmDelete(id) {
    const p = store.getCustomProduct(id);
    if (!p) return false;
    const n = store.itemsOfProduct(id).length;
    const f = Object.values(store.finishes).reduce((k, x) => k + (x && x.floor === id ? 1 : 0) + (x && x.wall === id ? 1 : 0), 0);
    const used = n ? `${n} placed ${n === 1 ? 'item uses' : 'items use'} it. ${n === 1 ? 'It stays' : 'They stay'} in the plan as ${n === 1 ? 'a generic item' : 'generic items'} with ${n === 1 ? 'its' : 'their'} size, without price or link.`
      : 'No placed item uses it.';
    const fin = f ? ` ${f} ${f === 1 ? 'room finish goes' : 'room finishes go'} back to the built-in default.` : '';
    const ok = await confirmDialog({ title: `Delete “${p.name}”?`, confirmLabel: 'Delete product', danger: true,
      message: `It is removed from this project’s catalogue. ${used}${fin} You can undo this.` });
    if (!ok) return false;
    const res = store.removeCustomProduct(id);
    if (res) toast('Product deleted', { action: { label: 'Undo', fn: () => app.actions.undo() } });
    return !!res;
  }

  return {
    openAdd: (o = {}) => openForm({ mode: 'add', zone: o.zone, category: o.category }),
    openEdit: (id) => { const p = store.getCustomProduct(id); return p ? openForm({ mode: 'edit', product: p }) : null; },
    openLink: (itemId) => { const it = store.getItem(itemId); return it ? openForm({ mode: 'link', item: it }) : null; },
    openLibrary,
    confirmDelete,
  };
}

/** The "added by you" mark (a person with a pencil) shown beside the shop's name. */
export function ownMark(withText = false) {
  const tip = 'Added by you: typed in from the shop’s page, not checked by the catalogue research';
  return h('span', { class: `smark smark--own${withText ? ' smark--text' : ''}`, role: 'img', 'aria-label': 'Added by you', 'data-tip': tip, title: tip },
    icon('own', { size: withText ? 14 : 12 }), withText ? h('span', null, 'Added by you') : null);
}

const round1 = (v) => Math.round((+v || 0) * 10) / 10;
const fmtNum = (v) => { const n = readNumber(v); return n == null ? (v == null ? '' : String(v)) : String(round1(n)); };
