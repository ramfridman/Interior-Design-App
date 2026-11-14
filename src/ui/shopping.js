/**
 * Shopping-list model: turns the placed items and chosen finishes into priced rows, grouped by room or by retailer.
 * Pure data (no DOM) — used by the budget panel, the budget pill, CSV export, copy and print.
 */
import { allSpaces, floorAreaM2, wallAreaM2, finishCost } from '../core/finishes.js';
import { csvCell } from './dom.js';
import { itemQuantity, fmtPrice } from './format.js';
import { GROUND, levelIds, levelName, hasLevels } from '../core/levels.js';
import { levelPlan } from '../core/plan-edit.js';

/**
 * Several floors (stage F7): every space of every floor with its floor id and view ([{ space, level, view }]).
 * One-level plans: the plan's own spaces on 'L0'.
 */
function spacesByFloor(plan) {
  if (!hasLevels(plan)) return allSpaces(plan).map((space) => ({ space, level: GROUND, view: plan }));
  return levelIds(plan).flatMap((id) => { const view = id === GROUND ? plan : levelPlan(plan, id); return view ? allSpaces(view).map((space) => ({ space, level: id, view })) : []; });
}
/** Floor of a store item (absent = ground). */
const itemFloor = (item) => (item && typeof item.level === 'string' && item.level ? item.level : GROUND);

const OTHER = { id: 'elsewhere', name: 'Outside the lot' };

/* Custom carpentry is designed in Carpentry mode and priced by its estimate, not by catalogue products. */
let carpentryBudget = null;
const budgetListeners = new Set();
/**
 * Set the Carpentry estimate shown in the shopping list and added to the budget (typical value), or null.
 * @param {{ low: number, typical: number, high: number }|null} range  ILS (pass the incl.-VAT figures)
 */
export function setCarpentryBudget(range) {
  const ok = range && ['low', 'typical', 'high'].every((k) => Number.isFinite(+range[k]));
  carpentryBudget = ok ? { low: Math.round(+range.low), typical: Math.round(+range.typical), high: Math.round(+range.high) } : null;
  budgetListeners.forEach((fn) => { try { fn(carpentryBudget); } catch (err) { console.error(err); } });
}
export const getCarpentryBudget = () => carpentryBudget;
/** Subscribe to setCarpentryBudget(); returns an unsubscribe function. */
export function onCarpentryBudget(fn) { budgetListeners.add(fn); return () => budgetListeners.delete(fn); }

/** Display order of spaces: rooms, outdoor areas, garden, parking, everything else. */
function spaceOrder(plan) {
  const ids = [...spacesByFloor(plan).map((s) => s.space.id), 'garden', ...(plan.site?.parking || []).map((p) => p.id), OTHER.id];
  return (id) => { const i = ids.indexOf(id); return i < 0 ? ids.length : i; };
}

/**
 * @param {{ store: object, plan: object, catalog: object }} ctx
 * @param {'room'|'retailer'} groupBy
 * @param {{ level?: string }} [opts]  several floors: only the rows of this floor (the `total` stays the whole design's)
 * @returns {{ groups: Array<{id:string,title:string,rows:object[],subtotal:number,level?}>, pending: object[], total: number,
 *             pieces: number, chosen: number, multi: boolean, shownTotal: number }}  rows carry `level` (floor id)
 */
export function buildShopping({ store, plan, catalog }, groupBy = 'room', opts = {}) {
  const multi = hasLevels(plan), only = multi && opts.level ? opts.level : null;
  let shownTotal = 0;
  const groups = new Map();
  const pendingMap = new Map();
  let total = 0, pieces = 0, chosen = 0;
  const group = (id, title) => {
    if (!groups.has(id)) groups.set(id, { id, title, rows: new Map(), subtotal: 0 });
    return groups.get(id);
  };

  const carpentry = { units: 0, runs: new Set(), budget: carpentryBudget };
  for (const item of store.items) {
    if (item.carp) { if (!item.hidden) carpentry.units++; carpentry.runs.add(item.carp.runId); continue; }   // made to measure: see Carpentry
    const space = safeSpace(store, item) || OTHER;
    const level = itemFloor(item);
    pieces++;
    if (item.price == null || !item.productId) {
      const key = `${space.id}|${item.type}|${item.name}`;
      const row = pendingMap.get(key) || { key, name: item.name, type: item.type, spaceId: space.id, spaceName: space.name, qty: 0, ids: [], subject: item, level };
      row.qty++; row.ids.push(item.id);
      pendingMap.set(key, row);
      continue;
    }
    chosen++;
    const cost = safeCost(catalog, item);
    const q = itemQuantity(item);
    total += cost;
    if (only && level !== only) continue;
    const g = groupBy === 'retailer' ? group('r:' + (item.retailer || 'Other'), item.retailer || 'Other') : group(space.id, space.name);
    const key = `${item.productId}|${item.priceUnit || 'item'}`;
    const row = g.rows.get(key) || {
      key: g.id + '|' + key, kind: 'item', name: item.name, retailer: item.retailer || '', url: item.url || null,
      unitPrice: item.price, priceUnit: item.priceUnit || 'item', qty: 0, qtyUnit: q.unit, cost: 0, ids: [],
      spaceId: space.id, spaceName: space.name, productId: item.productId, subject: item, level,
    };
    row.qty += q.qty; row.cost += cost; row.ids.push(item.id);
    g.rows.set(key, row);
    if (groupBy !== 'retailer') g.level = level;
    g.subtotal += cost; shownTotal += cost;
  }

  for (const { space, level, view } of spacesByFloor(plan)) {
    const f = store.finishes[space.id];
    if (!f) continue;
    // an upper floor's walls are as high as its own ceiling
    const ceiling = level === GROUND ? store.project.ceilingHeight : ((view.heights && view.heights.ceiling) || store.project.ceilingHeight);
    const cost = level === GROUND ? finishCost(space.id, store, catalog) : upperFinishCost(space, view, ceiling, f, catalog);
    for (const kind of ['floor', 'wall']) {
      const product = f[kind] && catalog.getProduct(f[kind]);
      if (!product) continue;
      total += cost[kind];
      if (only && level !== only) continue;
      const area = kind === 'floor' ? floorAreaM2(space) : wallAreaM2(space, ceiling, view);
      const g = groupBy === 'retailer' ? group('r:' + (product.retailer || 'Other'), product.retailer || 'Other') : group(space.id, space.name);
      g.rows.set(`${kind}|${space.id}`, {
        key: `${g.id}|${kind}|${space.id}`, kind, name: product.name, retailer: product.retailer || '', url: product.url || null,
        unitPrice: product.price, priceUnit: product.priceUnit || 'm2', qty: area, qtyUnit: 'm²', cost: cost[kind], ids: [],
        spaceId: space.id, spaceName: space.name, productId: product.id, subject: product,
        note: kind === 'floor' ? 'Floor finish' : 'Wall finish', level,
      });
      if (groupBy !== 'retailer') g.level = level;
      g.subtotal += cost[kind]; shownTotal += cost[kind];
    }
  }

  const order = spaceOrder(plan);
  const list = [...groups.values()].map((g) => ({ ...g, rows: [...g.rows.values()].sort((a, b) => b.cost - a.cost) }));
  if (groupBy === 'retailer') list.sort((a, b) => b.subtotal - a.subtotal);
  else list.sort((a, b) => order(a.id) - order(b.id));
  const pending = [...pendingMap.values()].filter((r) => !only || r.level === only).sort((a, b) => order(a.spaceId) - order(b.spaceId) || a.name.localeCompare(b.name));
  if (carpentry.budget) { total += carpentry.budget.typical; if (!only) shownTotal += carpentry.budget.typical; }
  return { groups: list, pending, total, shownTotal, multi, pieces, chosen, carpentry: carpentry.units ? { units: carpentry.units, runs: carpentry.runs.size, budget: carpentry.budget } : null };
}

/** "Custom carpentry — see Carpentry estimate" line text. */
export function carpentryLine(c) {
  if (!c) return null;
  const what = `${c.runs} ${c.runs === 1 ? 'run' : 'runs'}, ${c.units} units`;
  return { title: 'Custom carpentry — see Carpentry estimate', what, amount: c.budget ? `${fmtPrice(c.budget.low)}–${fmtPrice(c.budget.high)}` : 'Estimate in Carpentry', typical: c.budget ? c.budget.typical : null };
}

/** Finish cost of a room on an upper floor (its own ceiling height for the walls), as finishCost() does on the ground floor. */
function upperFinishCost(space, view, ceiling, f, catalog) {
  const price = (id) => { const p = id && catalog.getProduct(id); return p && Number.isFinite(+p.price) ? +p.price : 0; };
  return { floor: price(f.floor) * floorAreaM2(space), wall: price(f.wall) * wallAreaM2(space, ceiling, view) };
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
  // several floors: a Floor column after the room (one-level plans: the columns as before)
  const fl = (r) => (s.multi ? [levelName(ctx.plan, r.level || GROUND) || r.level] : []);
  const lines = [['Group', 'Product', 'Retailer', 'Quantity', 'Unit', 'Unit price (ILS)', 'Cost (ILS)', 'Room', ...(s.multi ? ['Floor'] : []), 'Link'].join(',')];
  for (const g of s.groups) for (const r of g.rows) {
    lines.push([g.title, r.name, r.retailer, r.qtyUnit ? r.qty.toFixed(2) : Math.round(r.qty), r.qtyUnit || 'pcs', r.unitPrice, Math.round(r.cost), r.spaceName, ...fl(r), r.url || ''].map(csvCell).join(','));
  }
  for (const r of s.pending) lines.push(['Still to choose', r.name, '', r.qty, 'pcs', '', '', r.spaceName, ...fl(r), ''].map(csvCell).join(','));
  const cl = carpentryLine(s.carpentry);
  const pad = s.multi ? [''] : [];
  if (cl) lines.push(['Custom carpentry', cl.title, '', cl.what, '', '', cl.typical != null ? cl.typical : '', '', ...pad, ''].map(csvCell).join(','));
  lines.push(['Total', '', '', '', '', '', Math.round(s.total), '', ...pad, ''].join(','));
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
  const cl = carpentryLine(s.carpentry);
  if (cl) out.push(`${cl.title}: ${cl.what} — ${cl.amount}`, '');
  out.push(`Total ${fmtPrice(s.total)}`);
  return out.join('\n');
}
