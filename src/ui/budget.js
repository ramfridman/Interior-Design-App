/**
 * Shopping list / budget tab: every placed product and chosen finish, merged and priced, grouped by room or retailer.
 * Also fills the print sheet (#print-root) that the print stylesheet shows on paper.
 */
import { h, setKids, debounce } from './dom.js';
import { icon } from './icons.js';
import { btn, segmented, emptyState, safeUrl } from './components.js';
import { canPrint } from './exporter.js';
import { fmtPrice, fmtUnitPrice } from './format.js';
import { buildShopping, fmtQty, carpentryLine, onCarpentryBudget } from './shopping.js';
import { getPref, setPref } from './prefs.js';
import { FEATURES, onFeatureChange } from '../core/features.js';
import { levelIds, levelName, upperLevels } from '../core/levels.js';

/** @param {HTMLElement} root  @param {object} app */
export function initBudget(root, app) {
  const { store, actions, thumbs } = app;
  let active = false, dirty = true;
  let groupBy = getPref('budgetGroup') === 'retailer' ? 'retailer' : 'room';

  const total = h('p', { class: 'budget-total__value display num' }, fmtPrice(0));
  const caption = h('p', { class: 'budget-total__caption' }, '');
  const grouping = segmented({ options: [{ value: 'room', label: 'By room' }, { value: 'retailer', label: 'By retailer' }], value: groupBy, label: 'Group the list', cls: 'seg--block',
    onChange: (v) => { groupBy = v; setPref('budgetGroup', v); render(); } });
  const list = h('div', { class: 'blist' });
  // several floors (stage F7): a floor filter; the total stays the whole design's
  let floor = 'all';
  const multi = () => FEATURES.levels && upperLevels(app.plan).length > 0;
  const floorHost = h('div', { class: 'budget-floors' });
  const floorName = (id) => levelName(app.plan, id) || id;
  function paintFloors() {
    if (!multi()) { floor = 'all'; setKids(floorHost); floorHost.hidden = true; return; }
    if (floor !== 'all' && !levelIds(app.plan).includes(floor)) floor = 'all';
    floorHost.hidden = false;
    setKids(floorHost, segmented({ options: [{ value: 'all', label: 'All floors' }, ...levelIds(app.plan).map((id) => ({ value: id, label: floorName(id) }))], value: floor, label: 'Floor', cls: 'seg--mini seg--wrap',
      onChange: (v) => { floor = v; render(); } }));
  }
  root.append(
    h('div', { class: 'budget-total' }, h('p', { class: 'budget-total__label' }, 'Total so far'), total, caption),
    h('div', { class: 'budget-tools' }, grouping, floorHost,
      h('div', { class: 'budget-tools__row' },
        btn('Export CSV', { small: true, icon: 'table', onClick: actions.exportCSV }),
        canPrint() ? btn('Print', { small: true, icon: 'print', onClick: actions.printShoppingList }) : btn('Copy list', { small: true, icon: 'copy', onClick: actions.copyShoppingList }))),
    list);

  function row(r) {
    const select = () => { if (r.ids.length) actions.focusItems(r.ids); else actions.focusSpace(r.spaceId); };
    const href = safeUrl(r.url);
    const meta = [fmtQty(r), ' × ', fmtUnitPrice(r.unitPrice, r.priceUnit)].join('');
    return h('li', { class: 'brow' },
      h('button', { type: 'button', class: 'brow__main', onClick: select, 'aria-label': `${r.name}, ${meta}, ${fmtPrice(r.cost)}. Show in the design` },
        h('span', { class: 'brow__thumb' }, thumbs.el(r.subject, { size: 80 })),
        h('span', { class: 'brow__text' },
          h('span', { class: 'brow__name truncate' }, r.name),
          h('span', { class: 'brow__meta truncate num' }, r.note ? `${r.note}, ${meta}` : meta),
          h('span', { class: 'brow__sub truncate' }, (groupBy === 'retailer' ? r.spaceName : r.retailer) + (multi() && floor === 'all' && r.level ? ` · ${floorName(r.level)}` : '')))),
      h('span', { class: 'brow__end' },
        h('span', { class: 'brow__cost num' }, fmtPrice(r.cost)),
        href ? h('a', { class: 'brow__link', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open ${r.name} at ${r.retailer || 'the retailer'}`, 'data-tip': 'Open at retailer' }, 'Buy', icon('external', { size: 12 })) : null));
  }

  function render() {
    dirty = false;
    paintFloors();
    const s = buildShopping(app, groupBy, floor !== 'all' ? { level: floor } : {});
    const pendingCount = s.pending.reduce((n, r) => n + r.qty, 0);
    total.textContent = fmtPrice(s.total);
    caption.textContent = s.pieces === 0 ? 'Nothing placed yet'
      : `${s.chosen} of ${s.pieces} items have a product${pendingCount ? `, ${pendingCount} still to choose` : ''}` + (floor !== 'all' ? ` · ${fmtPrice(s.shownTotal)} on the ${floorName(floor).toLowerCase()}` : '');
    const cl = carpentryLine(s.carpentry);
    const carpRow = cl && floor === 'all' ? h('section', { class: 'bgroup bgroup--carp' },
      h('ul', { class: 'bgroup__rows' }, h('li', { class: 'brow' },
        h('button', { type: 'button', class: 'brow__main', 'aria-label': `${cl.title}, ${cl.what}, ${cl.amount}. Open Carpentry`, onClick: () => { app.carpentry.enter(); store.setUI({ carpentryTab: 'estimate' }); } },
          h('span', { class: 'brow__thumb brow__thumb--icon' }, icon('carpentry', { size: 22 })),
          h('span', { class: 'brow__text' }, h('span', { class: 'brow__name truncate' }, cl.title), h('span', { class: 'brow__meta truncate num' }, cl.what),
            h('span', { class: 'brow__sub truncate' }, cl.typical != null ? 'Estimate, typical value counted in the total' : 'Made to measure — priced in Carpentry'))),
        h('span', { class: 'brow__end' }, h('span', { class: 'brow__cost num' }, cl.amount))))) : null;
    if (!s.groups.length && !s.pending.length && !carpRow) {
      setKids(list, emptyState({ icon: 'list', title: 'Your shopping list is empty', text: 'Place products from the catalogue and they are added here with their price and shop link.' }));
      return;
    }
    setKids(list, carpRow,
      s.groups.map((g) => h('section', { class: 'bgroup' },
        h('header', { class: 'bgroup__head' }, h('h3', { class: 'bgroup__title truncate' }, g.title, multi() && floor === 'all' && g.level ? h('small', { class: 'bgroup__floor' }, ` · ${floorName(g.level)}`) : null), h('span', { class: 'bgroup__sum num' }, fmtPrice(g.subtotal))),
        h('ul', { class: 'bgroup__rows' }, g.rows.map(row)))),
      s.pending.length ? h('section', { class: 'bgroup bgroup--pending' },
        h('header', { class: 'bgroup__head' }, h('h3', { class: 'bgroup__title' }, 'Still to choose'), h('span', { class: 'bgroup__sum num' }, String(pendingCount))),
        h('p', { class: 'bgroup__hint' }, 'Placeholders from the architect’s drawing. Select one and pick a real product in the Inspector.'),
        h('ul', { class: 'bgroup__rows' }, s.pending.map((r) => h('li', { class: 'brow brow--pending' },
          h('button', { type: 'button', class: 'brow__main', 'aria-label': `${r.qty} × ${r.name} in ${r.spaceName}. Choose a product`, onClick: () => { actions.focusItems(r.ids); app.openPanel('inspector'); } },
            h('span', { class: 'brow__thumb' }, thumbs.el(r.subject, { size: 80 })),
            h('span', { class: 'brow__text' }, h('span', { class: 'brow__name truncate' }, r.name), h('span', { class: 'brow__sub truncate' }, r.spaceName))),
          h('span', { class: 'brow__end' }, h('span', { class: 'brow__qty num' }, `× ${r.qty}`)))))) : null);
  }

  /** Build the paper version of the list. */
  app.preparePrint = () => {
    const host = document.getElementById('print-root') || document.body.appendChild(h('div', { id: 'print-root' }));
    const s = buildShopping(app, groupBy);
    const cell = (text, cls) => h('td', { class: cls }, text);
    setKids(host,
      h('h1', null, store.project.name), h('p', { class: 'print__sub' }, `Shopping list, ${new Date().toLocaleDateString('en-GB')}. Prices in ILS including VAT, as listed by each retailer.`),
      s.groups.map((g) => [h('h2', null, g.title, h('span', null, fmtPrice(g.subtotal))),
        h('table', null, h('thead', null, h('tr', null, h('th', null, 'Product'), h('th', null, groupBy === 'retailer' ? 'Room' : 'Retailer'), h('th', { class: 'r' }, 'Qty'), h('th', { class: 'r' }, 'Unit price'), h('th', { class: 'r' }, 'Cost'))),
          h('tbody', null, g.rows.map((r) => h('tr', null,
            h('td', null, r.name, r.url ? h('small', null, r.url) : null), cell(groupBy === 'retailer' ? r.spaceName : r.retailer),
            cell(fmtQty(r), 'r'), cell(fmtUnitPrice(r.unitPrice, r.priceUnit), 'r'), cell(fmtPrice(r.cost), 'r')))))]),
      s.pending.length ? [h('h2', null, 'Still to choose'), h('table', null, h('tbody', null, s.pending.map((r) => h('tr', null, cell(r.name), cell(r.spaceName), cell(`× ${r.qty}`, 'r')))))] : null,
      carpentryLine(s.carpentry) ? [h('h2', null, 'Custom carpentry'), h('p', null, `${carpentryLine(s.carpentry).what} — ${carpentryLine(s.carpentry).amount}. See the Carpentry estimate and quotation package.`)] : null,
      h('p', { class: 'print__total' }, 'Total ', h('strong', null, fmtPrice(s.total))));
  };

  const invalidate = debounce(() => { if (active) render(); else dirty = true; }, 120);
  store.on('items', (e) => { if (!e.transient) invalidate(); });
  store.on('finishes', invalidate);
  store.on('project', invalidate);
  store.on('carpentry', (e) => { if (!e || !e.transient) invalidate(); });
  onCarpentryBudget(invalidate);
  onFeatureChange(invalidate);
  store.on('plan', (e) => { if (!e || !e.transient) invalidate(); });   // rooms group the list; a plan edit can add or merge rooms

  return {
    activate() { active = true; if (dirty) render(); },
    deactivate() { active = false; },
  };
}
