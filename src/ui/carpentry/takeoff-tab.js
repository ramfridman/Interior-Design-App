/**
 * Carpentry · Quantities tab. Indicative take-off and schedules for one run or all runs.
 * Mount contract: default export create(ctx) → { el, update({ runId, unitId }), destroy() }.
 */
import { h, debounce } from '../dom.js';
import { btn, emptyState } from '../components.js';

const N1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const N0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const N2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const txt = (v) => (v == null || v === '' ? '—' : typeof v === 'object' ? (v.en != null ? String(v.en) : JSON.stringify(v)) : String(v));
const sum = (l, f) => l.reduce((s, x) => s + (+f(x) || 0), 0);

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
  let sel = { runId: null, unitId: null };
  let destroyed = false;
  const opened = new Set(['units']);
  const root = h('div', { class: 'cp cp-tk', 'aria-label': 'Carpentry quantities' });
  const body = h('div', { class: 'cp-tk__body' });
  root.append(body);
  let data = null;

  function load() {
    const id = sel.runId && Carp.getRun(sel.runId) ? sel.runId : 'all';
    return { id, take: Carp.takeoff(id), sched: Carp.schedules(id) };
  }

  const card = (label, value, unit, sub) => h('div', { class: 'cp-card' }, h('span', { class: 'cp-card__label' }, label),
    h('span', { class: 'cp-card__val num' }, value, unit && h('small', null, ` ${unit}`)), sub && h('span', { class: 'cp-card__sub faint num' }, sub));

  function summary(t) {
    const tot = t.totals, mats = tot.materials || [];
    const carcass = sum(mats.filter((m) => m.group === 'carcass'), (m) => m.areaM2);
    const backs = sum(mats.filter((m) => m.group === 'back'), (m) => m.areaM2);
    const edgeM = sum(tot.edges || [], (e) => e.m);
    const wtPieces = sum(tot.worktops || [], (w) => w.pieces), wtArea = sum(tot.worktops || [], (w) => w.areaM2);
    const byKind = new Map();
    for (const hw of tot.hardware || []) {
      const e = byKind.get(hw.kind) || { label: hw.label && hw.label.en || hw.kind, qty: 0, unit: hw.unit };
      e.qty += hw.qty || 0; byKind.set(hw.kind, e);
    }
    const hw = [...byKind.values()].sort((a, b) => (a.unit === 'm') - (b.unit === 'm') || b.qty - a.qty);
    return h('div', { class: 'cp-cards' },
      card('Fronts', N1.format(tot.fronts.areaM2), 'm²', `${N0.format(tot.fronts.count)} pieces`),
      card('Carcass boards', N1.format(carcass), 'm²', `+ ${N1.format(backs)} m² backs`),
      card('Edge banding', N1.format(edgeM), 'm'),
      card('Worktops', N1.format(wtArea), 'm²', `${N0.format(wtPieces)} piece${wtPieces === 1 ? '' : 's'}`),
      card('Plinth', N1.format(tot.plinthM || 0), 'm'),
      h('div', { class: 'cp-card cp-card--wide' }, h('span', { class: 'cp-card__label' }, 'Hardware'),
        hw.length ? h('dl', { class: 'cp-hwdl num' }, hw.map((e) => [h('dt', null, e.label), h('dd', null, e.unit === 'm' ? `${N1.format(e.qty)} m` : N0.format(e.qty))])) : h('span', { class: 'faint' }, '—')));
  }

  // ───────────── tables ─────────────
  function table(cols, rows, o = {}) {
    const head = h('tr', null, cols.map((c) => h('th', { scope: 'col', class: c.num ? 'is-num' : '' }, c.title)));
    const trs = rows.map((r) => {
      if (r.group) return h('tr', { class: 'cp-grp' }, h('th', { colspan: cols.length, scope: 'colgroup' }, r.group));
      const tr = h('tr', { class: r.unitId ? 'is-click' : '', tabindex: r.unitId ? '0' : null, 'data-unit': r.unitId || null, 'aria-selected': r.unitId && r.unitId === sel.unitId ? 'true' : null },
        cols.map((c) => h('td', { class: c.num ? 'is-num num' : '' }, c.get(r))));
      if (r.unitId) {
        const go = () => store.setUI({ carpentrySel: { runId: r.runId, unitId: r.unitId } });
        tr.addEventListener('click', go);
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      }
      return tr;
    });
    return h('div', { class: 'cp-scroll', tabindex: '0', role: 'region', 'aria-label': o.label }, h('table', { class: 'cp-table' }, h('thead', null, head), h('tbody', null, trs)));
  }

  function headerCols(sched, key, getters = {}, nums = []) {
    return (sched.headers[key] || []).map(([k, title]) => ({ title: txt(title), num: nums.includes(k), get: getters[k] || ((r) => txt(r[k])) }));
  }

  const SECTIONS = [
    { id: 'units', title: (d) => `Unit schedule (${d.sched.units.length})`, build: (d) => d.sched.units.length ? table(headerCols(d.sched, 'units', { size: (r) => r.sizeText || txt(r.size) }), d.sched.units, { label: 'Unit schedule' }) : null, hint: 'Select a row to select the unit.' },
    { id: 'cut', title: (d) => `Cut list per unit (${sum(d.take.runs, (r) => sum(r.units, (u) => u.panels.length + u.fronts.length))} lines)`, build: cutList, hint: 'Indicative. Sizes in mm; edges are the banded edges per piece.' },
    { id: 'hw', title: (d) => `Hardware schedule (${d.sched.hardware.length})`, build: (d) => d.sched.hardware.length ? table(headerCols(d.sched, 'hardware', { qty: (r) => N2.format(r.qty) }, ['qty']), d.sched.hardware, { label: 'Hardware schedule' }) : null },
    { id: 'wt', title: (d) => `Worktop pieces (${d.sched.worktops.length})`, build: (d) => d.sched.worktops.length ? table(headerCols(d.sched, 'worktops', { size: (r) => r.sizeText || txt(r.size), area: (r) => N2.format(r.area) }, ['area', 'thickness']), d.sched.worktops, { label: 'Worktop pieces' }) : null },
    { id: 'app', title: (d) => `Appliances (${d.sched.appliances.length})`, build: (d) => d.sched.appliances.length ? table(headerCols(d.sched, 'appliances'), d.sched.appliances, { label: 'Appliances' }) : null },
    { id: 'feat', title: (d) => `Special requirements (${(d.sched.features || []).length})`, when: (d) => Array.isArray(d.sched.features) && d.sched.features.length,
      build: (d) => table([{ title: 'Ref', get: (r) => txt(r.ref || r.num) }, { title: 'Title', get: (r) => txt(r.title) }, { title: 'Requirement', get: (r) => txt(r.text) }], d.sched.features, { label: 'Special requirements' }) },
  ];

  function cutList(d) {
    const rows = [];
    for (const run of d.take.runs) for (const u of run.units) {
      const parts = [...u.panels, ...u.fronts];
      if (!parts.length) continue;
      rows.push({ group: `${run.code} · ${u.code} — ${txt(u.name)} (${u.w} × ${u.h} × ${u.d} cm)` });
      for (const p of parts) rows.push({ ...p, runId: run.runId });
    }
    if (!rows.length) return null;
    return table([
      { title: 'Part', get: (r) => txt(r.part) }, { title: 'Material', get: (r) => r.material },
      { title: 'Thk', num: true, get: (r) => r.thickness }, { title: 'L × W (mm)', num: true, get: (r) => `${Math.round(r.length)} × ${Math.round(r.width)}` },
      { title: 'Qty', num: true, get: (r) => r.qty }, { title: 'Banded edges', get: (r) => ((r.edges && (r.edges.long || r.edges.short)) ? `${r.edges.long}L ${r.edges.short}S` : '—') },
    ], rows, { label: 'Cut list' });
  }

  function sectionEl(s, d) {
    if (s.when && !s.when(d)) return null;
    const holder = h('div', { class: 'cp-sec__body' });
    const det = h('details', { class: 'cp-sec', open: opened.has(s.id) }, h('summary', { class: 'cp-sec__sum' }, s.title(d)), holder);
    let built = false;
    const fill = () => {
      if (built) return; built = true;
      const t = s.build(d);
      holder.replaceChildren(...[s.hint && h('p', { class: 'cp-sec__hint faint' }, s.hint), t || h('p', { class: 'faint cp-pad' }, 'Nothing here for this selection.')].filter(Boolean));
    };
    det.addEventListener('toggle', () => { if (det.open) { opened.add(s.id); fill(); } else opened.delete(s.id); });
    if (det.open) fill();
    return det;
  }

  function render() {
    if (destroyed) return;
    try { data = load(); } catch (err) {
      console.error('[takeoff]', err);
      body.replaceChildren(emptyState({ icon: 'warn', title: 'Could not compute quantities', text: String(err && err.message || err) })); return;
    }
    const d = data;
    if (!d.take.runs.length) { body.replaceChildren(emptyState({ icon: 'carpentry', title: 'No carpentry yet', text: 'Add a run in the workbench and its quantities appear here.' })); return; }
    const run = d.id === 'all' ? null : d.take.runs[0];
    body.replaceChildren(
      h('header', { class: 'cp-head' },
        h('p', { class: 'cp-kicker' }, 'Indicative quantities'),
        h('p', { class: 'cp-head__text faint' }, 'Indicative quantities — the carpenter’s own cutting list governs.'),
        h('p', { class: 'cp-scope' }, run ? `${run.code} · ${run.name}` : `All carpentry · ${d.take.runs.length} runs`)),
      summary(d.take),
      h('div', { class: 'cp-secs' }, SECTIONS.map((s) => sectionEl(s, d))),
      h('div', { class: 'cp-actions' },
        btn('Cut list CSV', { icon: 'download', small: true, onClick: exportCut }),
        btn('Schedules CSV', { icon: 'download', small: true, onClick: exportSched })));
  }

  async function out(name, rows) {
    const r = await ui.saveFile({ name, mime: 'text/csv', data: csv(rows) });
    if (r && r.ok && !r.dialog) ui.toast(`${name} saved`, { kind: 'success' });
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  function exportCut() {
    const { take, id } = data || load();
    const rows = [['Run', 'Unit', 'Module', 'Part', 'Group', 'Material', 'Thickness (mm)', 'Length (mm)', 'Width (mm)', 'Qty', 'Banded long edges', 'Banded short edges', 'Edge type', 'Area (m²)', 'Edge (m)']];
    for (const run of take.runs) for (const u of run.units) for (const p of [...u.panels, ...u.fronts]) {
      rows.push([run.code, u.code, txt(u.name), txt(p.part), p.group, p.material, p.thickness, Math.round(p.length), Math.round(p.width), p.qty, p.edges ? p.edges.long : '', p.edges ? p.edges.short : '', p.edgeType || '', p.areaM2, p.edgeM]);
    }
    rows.push([], ['Indicative — the carpenter’s own cutting list governs.']);
    return out(`House98-Carpentry-CutList-${id === 'all' ? 'all' : (take.runs[0] || {}).code}-${stamp()}.csv`, rows);
  }
  function exportSched() {
    const { sched, id, take } = data || load();
    const rows = [];
    for (const [key, name] of [['units', 'Unit schedule'], ['materials', 'Materials & finishes'], ['hardware', 'Hardware'], ['worktops', 'Worktops'], ['appliances', 'Appliances']]) {
      const cols = sched.headers[key] || [];
      if (!(sched[key] || []).length) continue;
      rows.push([name], cols.map(([, t]) => txt(t)));
      for (const r of sched[key]) rows.push(cols.map(([k]) => (k === 'size' ? (r.sizeText || txt(r.size)) : txt(r[k]) === '—' ? '' : txt(r[k]))));
      rows.push([]);
    }
    if (Array.isArray(sched.features) && sched.features.length) {
      rows.push(['Special requirements'], ['Ref', 'Title', 'Requirement']);
      for (const f of sched.features) rows.push([txt(f.ref || f.num), txt(f.title), txt(f.text)]);
    }
    return out(`House98-Carpentry-Schedules-${id === 'all' ? 'all' : (take.runs[0] || {}).code}-${stamp()}.csv`, rows);
  }

  const refresh = debounce(render, 150);
  const offs = ['carpentry', 'items', 'plan'].map((e) => store.on(e, refresh));
  render();

  function markSelected() {
    for (const tr of root.querySelectorAll('tr[data-unit]')) { if (tr.dataset.unit === sel.unitId) tr.setAttribute('aria-selected', 'true'); else tr.removeAttribute('aria-selected'); }
  }
  return {
    el: root,
    update(s) { const n = { runId: (s && s.runId) || null, unitId: (s && s.unitId) || null }; const changed = n.runId !== sel.runId; sel = n; if (changed) render(); else markSelected(); },
    destroy() { destroyed = true; refresh.cancel(); offs.forEach((f) => f && f()); root.remove(); },
  };
}

export { create };
export default create;
