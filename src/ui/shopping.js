/**
 * Shopping-list model: turns the placed items and chosen finishes into priced rows, grouped by room or by retailer.
 * Pure data (no DOM) — used by the budget panel, the budget pill, CSV export, copy and print.
 */
import { allSpaces, floorAreaM2, wallAreaM2, finishCost } from '../core/finishes.js';
import { csvCell } from './dom.js';
import { itemQuantity, fmtPrice } from './format.js';

const OTHER = { id: 'elsewhere', name: 'Outside the lot' };

/** Display order of spaces: rooms, outdoor areas, garden, parking, everything else. */
function spaceOrder(plan) {
  const ids = [...allSpaces(plan).map((s) => s.id), 'garden', ...(plan.site?.parking || []).map((p) => p.id), OTHER.id];
  return (id) => { const i = ids.indexOf(id); return i < 0 ? ids.length : i; };
}

/**
 * @param {{ store: object, plan: object, catalog: object }} ctx
 * @param {'room'|'retailer'} groupBy
 * @returns {{ groups: Array<{id:string,title:string,rows:object[],subtotal:number}>, pending: object[], total: number,
 *             pieces: number, chosen: number }}
 */
export function buildShopping({ store, plan, catalog }, groupBy = 'room') {
  const groups = new Map();
  const pendingMap = new Map();
  let total = 0, pieces = 0, chosen = 0;
  const group = (id, title) => {
    if (!groups.has(id)) groups.set(id, { id, title, rows: new Map(), subtotal: 0 });
    return groups.get(id);
  };

  for (const item of store.items) {
    const space = safeSpace(store, item) || OTHER;
    pieces++;
    if (item.price == null || !item.productId) {
      const key = `${space.id}|${item.type}|${item.name}`;
      const row = pendingMap.get(key) || { key, name: item.name, type: item.type, spaceId: space.id, spaceName: space.name, qty: 0, ids: [], subject: item };
      row.qty++; row.ids.push(item.id);
      pendingMap.set(key, row);
      continue;
    }
    chosen++;
    const cost = safeCost(catalog, item);
    const q = itemQuantity(item);
    const g = groupBy === 'retailer' ? group('r:' + (item.retailer || 'Other'), item.retailer || 'Other') : group(space.id, space.name);
    const key = `${item.productId}|${item.priceUnit || 'item'}`;
    const row = g.rows.get(key) || {
      key: g.id + '|' + key, kind: 'item', name: item.name, retailer: item.retailer || '', url: item.url || null,
      unitPrice: item.price, priceUnit: item.priceUnit || 'item', qty: 0, qtyUnit: q.unit, cost: 0, ids: [],
      spaceId: space.id, spaceName: space.name, productId: item.productId, subject: item,
    };
    row.qty += q.qty; row.cost += cost; row.ids.push(item.id);
    g.rows.set(key, row);
    g.subtotal += cost; total += cost;
  }

  for (const space of allSpaces(plan)) {
    const f = store.finishes[space.id];
    if (!f) continue;
    const cost = finishCost(space.id, store, catalog);
    for (const kind of ['floor', 'wall']) {
      const product = f[kind] && catalog.getProduct(f[kind]);
      if (!product) continue;
      const area = kind === 'floor' ? floorAreaM2(space) : wallAreaM2(space, store.project.ceilingHeight, plan);
      const g = groupBy === 'retailer' ? group('r:' + (product.retailer || 'Other'), product.retailer || 'Other') : group(space.id, space.name);
      g.rows.set(`${kind}|${space.id}`, {
        key: `${g.id}|${kind}|${space.id}`, kind, name: product.name, retailer: product.retailer || '', url: product.url || null,
        unitPrice: product.price, priceUnit: product.priceUnit || 'm2', qty: area, qtyUnit: 'm²', cost: cost[kind], ids: [],
        spaceId: space.id, spaceName: space.name, productId: product.id, subject: product,
        note: kind === 'floor' ? 'Floor finish' : 'Wall finish',
      });
      g.subtotal += cost[kind]; total += cost[kind];
    }
  }

  const order = spaceOrder(plan);
  const list = [...groups.values()].map((g) => ({ ...g, rows: [...g.rows.values()].sort((a, b) => b.cost - a.cost) }));
  if (groupBy === 'retailer') list.sort((a, b) => b.subtotal - a.subtotal);
  else list.sort((a, b) => order(a.id) - order(b.id));
  const pending = [...pendingMap.values()].sort((a, b) => order(a.spaceId) - order(b.spaceId) || a.name.localeCompare(b.name));
  return { groups: list, pending, total, pieces, chosen };
}

function safeSpace(store, item) {
  try { return store.spaceOf(item); } catch (err) { return null; }
}
function safeCost(catalog, item) {
  try { const c = catalog.itemCost(item); return Number.isFinite(c) ? c : 0; } catch (err) { return 0; }
}

/** "3" · "12.4 m²" · "6.0 m" */
export function fmtQty(row) {
  return row.qtyUnit ? `${row.qty.toFixed(1)} ${row.qtyUnit}` : String(Math.round(row.qty));
}

/** Grand total only (cheap enough to call on every change for the budget pill). */
export function shoppingTotal(ctx) {
  const s = buildShopping(ctx, 'room');
  return { total: s.total, pieces: s.pieces, chosen: s.chosen, pending: s.pending.reduce((n, r) => n + r.qty, 0) };
}

/** CSV of the full list (one line per merged row, then the items still to choose). */
export function shoppingCSV(ctx, groupBy = 'room') {
  const s = buildShopping(ctx, groupBy);
  const lines = [['Group', 'Product', 'Retailer', 'Quantity', 'Unit', 'Unit price (ILS)', 'Cost (ILS)', 'Room', 'Link'].join(',')];
  for (const g of s.groups) for (const r of g.rows) {
    lines.push([g.title, r.name, r.retailer, r.qtyUnit ? r.qty.toFixed(2) : Math.round(r.qty), r.qtyUnit || 'pcs', r.unitPrice, Math.round(r.cost), r.spaceName, r.url || ''].map(csvCell).join(','));
  }
  for (const r of s.pending) lines.push(['Still to choose', r.name, '', r.qty, 'pcs', '', '', r.spaceName, ''].map(csvCell).join(','));
  lines.push(['Total', '', '', '', '', '', Math.round(s.total), '', ''].join(','));
  return '﻿' + lines.join('\r\n');
}

/** Plain-text list for the clipboard (used where printing is unavailable). */
export function shoppingText(ctx, groupBy = 'room') {
  const s = buildShopping(ctx, groupBy);
  const out = [`${ctx.store.project.name} — shopping list`, ''];
  for (const g of s.groups) {
    out.push(`${g.title} — ${fmtPrice(g.subtotal)}`);
    for (const r of g.rows) out.push(`  ${fmtQty(r)} × ${r.name}${r.retailer ? ' (' + r.retailer + ')' : ''} — ${fmtPrice(r.cost)}${r.url ? '\n    ' + r.url : ''}`);
    out.push('');
  }
  if (s.pending.length) {
    out.push('Still to choose');
    for (const r of s.pending) out.push(`  ${r.qty} × ${r.name} — ${r.spaceName}`);
    out.push('');
  }
  out.push(`Total ${fmtPrice(s.total)}`);
  return out.join('\n');
}
