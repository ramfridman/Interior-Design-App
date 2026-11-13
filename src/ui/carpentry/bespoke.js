/**
 * Bespoke carpentry in the inspector:
 *   bespokeSection   the composer of a bespoke ('custom') unit — columns × cells with fixed cm or "fill" sizes, each cell's
 *                    kind and door operation — plus "Make this unit bespoke" on any standard unit and starter templates;
 *   featuresSection  "Special requirements" of a run or a unit: free-text ideas with a category, must / nice-to-have and an
 *                    optional reference picture; they appear as numbered callouts on the drawings.
 * Everything is feature-detected (Carp.toCustom, Carp.customLayoutTemplate, Carp.addFeature…) so the panel degrades
 * quietly on an engine without these additions.
 */
import * as Carp from '../../carpentry/index.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { btn, iconBtn, numField, segmented } from '../components.js';
import { openMenu, confirmDialog, toast } from '../dialogs.js';
import { num } from './vocab.js';

const fn = (name) => (typeof Carp[name] === 'function' ? Carp[name] : null);
export const hasFeatures = () => !!(fn('addFeature') && fn('listFeatures'));
const vocabList = (group, fallback) => (Carp.VOCAB[group] ? Object.entries(Carp.VOCAB[group]).map(([k, v]) => [k, v.en]) : fallback);

const CELL_KINDS = () => vocabList('cellKind', [['door', 'Door(s)'], ['drawers', 'Drawers'], ['shelves', 'Open shelves'], ['open', 'Open niche'], ['hanging', 'Hanging rail'], ['appliance', 'Appliance'], ['panel', 'Fixed panel']]);
const OPERATIONS = () => vocabList('doorOperation', [['hinged', 'Hinged']]);
const TEMPLATES = () => {
  if (Array.isArray(Carp.CUSTOM_TEMPLATES)) return Carp.CUSTOM_TEMPLATES.map((t) => (typeof t === 'string' ? [t, t] : [t.id || t.name, (t.label && (t.label.en || t.label)) || t.name || t.id]));
  if (Carp.CUSTOM_TEMPLATES && typeof Carp.CUSTOM_TEMPLATES === 'object') return Object.entries(Carp.CUSTOM_TEMPLATES).map(([k, v]) => [k, (v && v.label && (v.label.en || v.label)) || (v && v.name && (v.name.en || v.name)) || k]);
  if (Carp.VOCAB.customTemplate) return Object.entries(Carp.VOCAB.customTemplate).map(([k, v]) => [k, v.en]);
  return [];
};

const selCell = new Map();   // unitId → { c, r } selected cell in the composer (kept across rebuilds)

/**
 * Composer for a bespoke unit, or the "Make this unit bespoke" offer on a standard one.
 * @param {{ app, C, run, unit, mod, upd: (patch) => boolean }} o
 */
export function bespokeSection({ app, C, unit, mod, upd }) {
  const c = unit.carp;
  const layout = c.internals && c.internals.layout;
  if (mod.id !== 'custom' || !layout) {
    if (!fn('toCustom') || mod.id === 'filler' || mod.id === 'panel') return null;
    return h('div', { class: 'cbesp-offer' },
      icon('carpentry', { size: 18 }),
      h('div', null, h('p', { class: 'cbesp-offer__title' }, 'Want something the library doesn’t have?'),
        h('p', { class: 'cbesp-offer__text' }, 'Turn this unit into a bespoke one and divide it freely into doors, drawers, shelves and niches.'),
        btn('Make this unit bespoke', { small: true, icon: 'carpentry', onClick: () => { const r = C.run(() => Carp.toCustom(unit.id)); if (r.res && r.res.ok) toast('Bespoke unit: compose it below', { action: { label: 'Undo', fn: () => app.store.undo() } }); } })));
  }
  const cols = Array.isArray(layout.columns) ? layout.columns : [];
  const sel = selCell.get(unit.id) || { c: 0, r: 0 };
  if (!cols[sel.c]) sel.c = 0;
  if (cols[sel.c] && !cols[sel.c].cells[sel.r]) sel.r = 0;
  selCell.set(unit.id, sel);
  const clone = () => JSON.parse(JSON.stringify(cols));
  const commit = (next) => upd({ internals: { layout: { ...layout, columns: next } } });
  const kinds = CELL_KINDS(), ops = OPERATIONS();
  const kindLabel = (k) => (kinds.find(([v]) => v === k) || [k, k])[1];

  // visual grid (flex mirrors fixed widths / heights; "fill" shares the rest)
  const grid = h('div', { class: 'cbesp__grid', role: 'grid', 'aria-label': 'Bespoke unit layout' }, cols.map((col, ci) => h('div', {
    class: 'cbesp__col', role: 'row', style: col.w ? { flex: `0 0 ${Math.max(8, (col.w / c.width) * 100)}%` } : { flex: `${col.flex || 1} 1 0` } },
  (col.cells || []).map((cell, ri) => h('button', { type: 'button', role: 'gridcell', class: `cbesp__cell cbesp__cell--${cell.kind || 'door'}${sel.c === ci && sel.r === ri ? ' is-sel' : ''}`,
    style: cell.h ? { flex: `0 0 ${Math.max(6, cell.h * 1.1)}px` } : { flex: `${cell.flex || 1} 1 0` },
    'aria-label': `Column ${ci + 1}, cell ${ri + 1}: ${kindLabel(cell.kind)}${cell.h ? `, ${num(cell.h)} cm` : ''}`,
    onClick: () => { selCell.set(unit.id, { c: ci, r: ri }); C.emit('features'); } },
  h('span', { class: 'cbesp__ck' }, cell.label || kindLabel(cell.kind)), cell.h ? h('span', { class: 'cbesp__ch num' }, `${num(cell.h)}`) : null)))));

  const col = cols[sel.c], cell = col && col.cells[sel.r];
  const sizeCtl = (label, cur, unitHint, onFixed, onFill, key) => h('div', { class: 'cbesp__size' },
    segmented({ options: [{ value: 'fill', label: 'Fill' }, { value: 'fixed', label: 'Fixed' }], value: cur ? 'fixed' : 'fill', label, cls: 'seg--mini',
      onChange: (v) => (v === 'fill' ? onFill() : onFixed(cur || unitHint)) }),
    cur ? numField({ value: cur, min: 5, max: 300, suffix: 'cm', title: label, onCommit: onFixed }) : h('span', { class: 'faint cbesp__fillnote' }, 'shares the rest'));
  const setCol = (patch) => { const n = clone(); n[sel.c] = { ...n[sel.c], ...patch }; if (patch.w === undefined && 'w' in patch) delete n[sel.c].w; commit(n); };
  const setCell = (patch) => { const n = clone(); const cc = { ...n[sel.c].cells[sel.r], ...patch }; for (const k of Object.keys(patch)) if (patch[k] === undefined) delete cc[k]; n[sel.c].cells[sel.r] = cc; commit(n); };

  const editor = col && cell ? h('div', { class: 'cbesp__edit' },
    h('div', { class: 'cbesp__edhead' }, h('span', { class: 'cbesp__tag' }, `Column ${sel.c + 1}`),
      iconBtn('plus', 'Add a column to the right', { size: 15, onClick: () => { const n = clone(); n.splice(sel.c + 1, 0, { flex: 1, cells: [{ flex: 1, kind: 'door' }] }); selCell.set(unit.id, { c: sel.c + 1, r: 0 }); commit(n); } }),
      iconBtn('trash', 'Remove this column', { size: 15, disabled: cols.length < 2, onClick: () => { const n = clone(); n.splice(sel.c, 1); selCell.set(unit.id, { c: Math.max(0, sel.c - 1), r: 0 }); commit(n); } })),
    sizeCtl('Column width', col.w, Math.round(c.width / cols.length), (v) => setCol({ w: v, flex: undefined }), () => { const n = clone(); delete n[sel.c].w; n[sel.c].flex = 1; commit(n); }),
    h('div', { class: 'cbesp__edhead' }, h('span', { class: 'cbesp__tag' }, `Cell ${sel.r + 1}`),
      iconBtn('plus', 'Split: add a cell below', { size: 15, onClick: () => { const n = clone(); n[sel.c].cells.splice(sel.r + 1, 0, { flex: 1, kind: cell.kind || 'door' }); selCell.set(unit.id, { c: sel.c, r: sel.r + 1 }); commit(n); } }),
      iconBtn('trash', 'Remove this cell', { size: 15, disabled: col.cells.length < 2, onClick: () => { const n = clone(); n[sel.c].cells.splice(sel.r, 1); selCell.set(unit.id, { c: sel.c, r: Math.max(0, sel.r - 1) }); commit(n); } })),
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Kind'), h('select', { class: 'select', 'aria-label': 'Cell kind', 'data-fk': 'besp-kind', onChange: (e) => setCell({ kind: e.target.value }) },
        kinds.map(([v, l]) => h('option', { value: v, selected: v === cell.kind }, l)))),
      ['door', 'doors', 'drawers', 'appliance', undefined].includes(cell.kind) || /door|flap/.test(cell.kind || '')
        ? h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Opening'), h('select', { class: 'select', 'aria-label': 'Door operation', 'data-fk': 'besp-op', onChange: (e) => setCell({ operation: e.target.value }) },
          ops.map(([v, l]) => h('option', { value: v, selected: v === (cell.operation || 'hinged') }, l))))
        : h('span')),
    sizeCtl('Cell height', cell.h, 30, (v) => setCell({ h: v, flex: undefined }), () => setCell({ h: undefined, flex: 1 })),
    /drawer/.test(cell.kind || '') || /door/.test(cell.kind || '') ? numField({ label: /drawer/.test(cell.kind) ? 'Drawers' : 'Doors', value: cell.count || 1, min: 1, max: 6, title: 'Count', onCommit: (v) => setCell({ count: v }) }) : null,
    /shel|open|hang/.test(cell.kind || '') ? numField({ label: 'Shelves', value: cell.shelves || 0, min: 0, max: 10, title: 'Shelves', onCommit: (v) => setCell({ shelves: v }) }) : null,
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Label on the drawing'),
      h('input', { class: 'field__input', type: 'text', value: cell.label || '', placeholder: 'e.g. Coffee machine', 'data-fk': 'besp-label', onChange: (e) => setCell({ label: e.target.value.trim() || undefined }) })),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Note for the carpenter'),
      h('input', { class: 'field__input', type: 'text', value: cell.note || '', placeholder: 'How it should work', 'data-fk': 'besp-note', onChange: (e) => setCell({ note: e.target.value.trim() || undefined }) }))) : null;

  const tpls = TEMPLATES();
  const tplBtn = tpls.length && fn('customLayoutTemplate') ? btn('Templates', { small: true, icon: 'list', onClick: (e) => openMenu(e.currentTarget, [
    { heading: 'Start from a template' },
    ...tpls.map(([id, label]) => ({ label, onSelect: () => { const t = Carp.customLayoutTemplate(id); if (t) { selCell.set(unit.id, { c: 0, r: 0 }); upd({ internals: { layout: t } }); } } })),
  ], { placement: 'bottom-end' }) }) : null;

  return h('section', { class: 'sec cbesp' },
    h('header', { class: 'sec__head' }, h('h3', { class: 'sec__title' }, 'Bespoke composer'), tplBtn),
    h('p', { class: 'cbesp__lead' }, 'Divide the unit into columns and cells. Click a cell to change it; the elevation below updates as you go.'),
    grid, editor);
}

/* ───────── special requirements ───────── */
const CATEGORIES = () => vocabList('featureCategory', [['function', 'How it works'], ['material', 'Material / finish'], ['hardware', 'Hardware'], ['dimension', 'Size'], ['other', 'Other']]);

/** Downscale a picked image to ≤ 1200 px (longest side) as a JPEG data URL. */
function downscale(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode'));
      img.onload = () => {
        const k = Math.min(1, 1200 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

const editing = new Set();   // feature ids open for editing

/**
 * "Special requirements" — for a run (unitId null) or a unit.
 * @param {{ app, C, runId: string, unitId: string|null, fkPrefix: string }} o
 */
export function featuresSection({ app, C, runId, unitId, fkPrefix }) {
  if (!hasFeatures()) return null;
  let all = [];
  try { all = Carp.listFeatures(runId) || []; } catch (err) { all = []; }
  const list = all.filter((f) => (unitId ? f.unitId === unitId : !f.unitId));
  const others = unitId ? [] : all.filter((f) => f.unitId);
  const cats = CATEGORIES();
  const catLabel = (k) => (cats.find(([v]) => v === k) || [k, k || 'Other'])[1];
  const target = unitId ? { unitId } : { runId };
  const run = (f) => C.run(f);

  const form = (f) => {
    const title = h('input', { class: 'field__input', type: 'text', value: f ? f.title || '' : '', placeholder: 'Short title, e.g. Removable corner doors', 'aria-label': 'Title', 'data-fk': `${fkPrefix}-t-${f ? f.id : 'new'}`, maxlength: '80' });
    const text = h('textarea', { class: 'textarea', rows: '3', placeholder: 'Describe anything unusual you want here — the carpenter will see it on the drawings and in the quotation request.', 'aria-label': 'Description', 'data-fk': `${fkPrefix}-x-${f ? f.id : 'new'}` });
    text.value = f ? f.text || '' : '';
    const cat = h('select', { class: 'select', 'aria-label': 'Category' }, cats.map(([v, l]) => h('option', { value: v, selected: f ? f.category === v : v === cats[0][0] }, l)));
    let prio = f && f.priority ? f.priority : 'must';
    const prioSeg = segmented({ options: [{ value: 'must', label: 'Must have' }, { value: 'nice', label: 'Nice to have' }], value: prio, label: 'Priority', cls: 'seg--mini', onChange: (v) => { prio = v; } });
    let images = f && Array.isArray(f.images) ? f.images.slice() : [];
    const thumbs = h('div', { class: 'cfeat__imgs' });
    const drawThumbs = () => thumbs.replaceChildren(...images.map((src, i) => h('span', { class: 'cfeat__img' }, h('img', { src, alt: `Reference picture ${i + 1}` }),
      iconBtn('close', 'Remove picture', { size: 12, onClick: () => { images.splice(i, 1); drawThumbs(); } }))));
    drawThumbs();
    const file = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', onChange: async () => {
      const fl = file.files && file.files[0];
      if (!fl) return;
      try { images.push(await downscale(fl)); drawThumbs(); } catch (err) { toast('That picture could not be read', { kind: 'warn' }); }
      file.value = '';
    } });
    const pickBtn = btn('Add a reference picture', { small: true, variant: 'quiet', icon: 'image', onClick: () => file.click() });
    const save = () => {
      const t = title.value.trim(), x = text.value.trim();
      if (!t && !x) { title.focus(); return; }
      const data = { title: t || x.slice(0, 60), text: x, category: cat.value, priority: prio, images };
      const r = f ? run(() => Carp.updateFeature(f.id, data)) : run(() => Carp.addFeature(target, data));
      if (r.res && r.res.ok) { if (f) editing.delete(f.id); else editing.delete('new'); C.emit('features'); }
    };
    return h('div', { class: 'cfeat__form' }, title, text, h('div', { class: 'grid2' }, cat, prioSeg), thumbs, file, pickBtn,
      h('div', { class: 'cfeat__formacts' },
        btn('Cancel', { small: true, variant: 'quiet', onClick: () => { editing.delete(f ? f.id : 'new'); C.emit('features'); } }),
        btn(f ? 'Save' : 'Add requirement', { small: true, variant: 'primary', onClick: save })));
  };

  const item = (f, i) => editing.has(f.id) ? h('li', { class: 'cfeat is-editing' }, form(f)) : h('li', { class: `cfeat cfeat--${f.priority || 'must'}` },
    h('span', { class: 'cfeat__n num' }, String(f.n || f.number || i + 1)),
    h('div', { class: 'cfeat__body' },
      h('p', { class: 'cfeat__title' }, f.title || 'Requirement', h('span', { class: 'cfeat__meta' }, `${catLabel(f.category)} · ${f.priority === 'nice' ? 'nice to have' : 'must have'}`)),
      f.text ? h('p', { class: 'cfeat__text' }, f.text) : null,
      Array.isArray(f.images) && f.images.length ? h('div', { class: 'cfeat__imgs' }, f.images.map((src, k) => h('span', { class: 'cfeat__img' }, h('img', { src, alt: `Reference ${k + 1}` })))) : null),
    h('span', { class: 'cfeat__acts' },
      iconBtn('note', 'Edit', { size: 15, onClick: () => { editing.add(f.id); C.emit('features'); } }),
      iconBtn('trash', 'Remove', { size: 15, variant: 'danger', onClick: async () => {
        if (!(await confirmDialog({ title: 'Remove this requirement?', message: `“${f.title || 'Requirement'}” is taken off the drawings. You can undo this.`, confirmLabel: 'Remove', danger: true }))) return;
        run(() => Carp.removeFeature(f.id)); C.emit('features');
      } })));

  void app;
  return h('section', { class: 'sec cfeats', id: unitId ? 'cfeats-unit' : 'cfeats-run' },
    h('header', { class: 'sec__head' }, h('h3', { class: 'sec__title' }, 'Special requirements'), h('span', { class: 'sec__note num' }, list.length ? String(list.length) : '')),
    h('p', { class: 'cfeats__lead' }, unitId ? 'Anything unusual about this unit — a door that lifts off, a hidden compartment, a special finish.' : 'Ideas for the whole run that the library can’t express — every one is numbered on the drawings and listed in the quotation request.'),
    list.length ? h('ol', { class: 'cfeat__list' }, list.map(item)) : null,
    editing.has('new') ? form(null) : btn('Add a special requirement', { small: true, block: true, icon: 'plus', onClick: () => { editing.add('new'); C.emit('features'); } }),
    others.length ? h('p', { class: 'cfeats__others' }, `${others.length} more on individual units.`) : null);
}

/** Select a feature (from a callout click in the workbench): open the tab and its editor. */
export function focusFeature(C, store, featureId) {
  if (!hasFeatures()) return;
  let f = null;
  for (const r of Carp.listRuns()) { try { f = (Carp.listFeatures(r.id) || []).find((x) => x.id === featureId); } catch (err) { f = null; } if (f) break; }
  if (!f) return;
  editing.add(f.id);
  if (f.unitId) { const it = store.getItem(f.unitId); if (it && it.carp) C.select(it.carp.runId, f.unitId); store.setUI({ carpentryTab: 'unit' }); }
  else { C.select(f.runId || (store.ui.carpentrySel || {}).runId); store.setUI({ carpentryTab: 'run' }); }
  C.emit('features');
  requestAnimationFrame(() => document.getElementById(f.unitId ? 'cfeats-unit' : 'cfeats-run')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
}
