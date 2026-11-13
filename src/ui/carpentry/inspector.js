/**
 * Carpentry — right sidebar: header (run, "Quotation package…", "Find a carpenter") and the tabs
 *   Run        name, kind, room, length, ends, levels, the whole RunSpec (grouped, collapsible, most important first),
 *              special requirements and notes for the carpenter
 *   Unit       module switcher, width, internals (data-driven from MODULES[id].internals), fronts / door operation,
 *              appliance, per-unit overrides ("differs from run"), bespoke composer, special requirements, note, move, remove
 *   Checks     Carp.checkRun findings by severity (click = show the units)
 *   Estimate · Quantities   the colleague's panels (slots.js), with the price-tier choice
 * The panel is rebuilt from the store on every change; focus (data-fk) and open groups are kept, so nothing jumps.
 */
import * as Carp from '../../carpentry/index.js';
import { h, setKids, rafThrottle } from '../dom.js';
import { icon } from '../icons.js';
import { btn, iconBtn, numField, toggle, segmented, emptyState } from '../components.js';
import { openDialog, openMenu } from '../dialogs.js';
import { mountSlot, loadSlot, slotContext, placeholder } from './slots.js';
import { rowOf } from './index.js';
import { KINDS, kindInfo, en, txt, num, cm, FRONT_COLOURS, WORKTOP_COLOURS, CARCASS_COLOURS, STD_WIDTHS, SEV, roomName, flatten, nest } from './vocab.js';
import { bespokeSection, featuresSection } from './bespoke.js';

export const CTABS = [
  { id: 'run', label: 'Run' }, { id: 'unit', label: 'Unit' }, { id: 'checks', label: 'Checks' },
  { id: 'estimate', label: 'Estimate' }, { id: 'quantities', label: 'Quantities' },
];

/** @param {HTMLElement} right  the right sidebar  @param {object} app  @param {object} C */
export function initCarpentryInspector(right, app, C) {
  const { store, plan } = app;
  const open = new Set(['fronts', 'worktop']);           // open spec groups (kept across rebuilds)

  /* ───────── shell ───────── */
  const headTitle = h('div', { class: 'cinsp__title' });
  const quoteBtn = btn('Quotation package…', { small: true, variant: 'primary', icon: 'quote', tip: 'Drawings, schedules and the quotation request for carpenters', onClick: openQuotation });
  const carpBtn = btn('Find a carpenter', { small: true, icon: 'carpenter', tip: 'Carpenters near Afikim', onClick: openCarpenters });
  const tabBtns = new Map(), panels = new Map();
  const checksBadge = h('span', { class: 'badge badge--tab', hidden: true });
  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Carpentry panels' }, CTABS.map((t) => {
    const b = h('button', { type: 'button', class: 'tab', role: 'tab', id: `ctab-${t.id}`, 'aria-controls': `cpanel-${t.id}`, 'aria-selected': 'false', tabindex: '-1', onClick: () => store.setUI({ carpentryTab: t.id }) },
      h('span', null, t.label), t.id === 'checks' ? checksBadge : null);
    tabBtns.set(t.id, b);
    return b;
  }));
  tablist.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault(); e.stopPropagation();
    const i = CTABS.findIndex((t) => t.id === tab());
    const next = CTABS[(i + dir + CTABS.length) % CTABS.length];
    store.setUI({ carpentryTab: next.id });
    tabBtns.get(next.id).focus();
  });
  const body = h('div', { class: 'side__body' }, CTABS.map((t) => {
    const p = h('div', { class: `tabpanel cinsp__panel cinsp__panel--${t.id}`, role: 'tabpanel', id: `cpanel-${t.id}`, 'aria-labelledby': `ctab-${t.id}`, tabindex: '-1', hidden: true });
    panels.set(t.id, p);
    return p;
  }));
  const el = h('div', { class: 'cinsp', 'aria-label': 'Carpentry inspector' },
    h('header', { class: 'cinsp__head' }, headTitle, h('div', { class: 'cinsp__headacts' }, quoteBtn, carpBtn),
      iconBtn('panel-right', 'Hide this panel', { class: 'cinsp__hide', onClick: () => app.setPanelOpen('right', false) })),
    h('div', { class: 'side__head side__head--tabs cinsp__tabs' }, tablist),
    body);
  right.append(el);

  const tab = () => (CTABS.some((t) => t.id === store.ui.carpentryTab) ? store.ui.carpentryTab : 'run');

  /* ───────── slots (estimate, quantities) ───────── */
  const tierSeg = segmented({ options: [{ value: null, label: 'Suggested' }, { value: 'basic', label: 'Basic' }, { value: 'mid', label: 'Mid' }, { value: 'premium', label: 'Premium' }],
    value: store.ui.carpentryTier || null, label: 'Price tier', cls: 'seg--block seg--mini', onChange: (v) => store.setUI({ carpentryTier: v }) });
  const estHost = h('div', { class: 'cslot' }), qtyHost = h('div', { class: 'cslot' });
  panels.get('estimate').append(h('div', { class: 'ctier' }, h('span', { class: 'ctier__label' }, 'Price tier'), tierSeg,
    h('p', { class: 'ctier__hint' }, 'Suggested = each run’s tier from its materials and hardware.')), estHost);
  panels.get('quantities').append(qtyHost);
  let estSlot = null, qtySlot = null;
  const selNow = () => { const s = store.ui.carpentrySel || {}; return { runId: s.runId || null, unitId: s.unitId || null }; };
  function ensureSlots() {
    if (tab() === 'estimate' && !estSlot) estSlot = mountSlot('estimate', estHost, app, { title: 'Estimate — coming soon', text: 'A price range for every run from the researched price book (low / typical / high, with sources) will appear here.' });
    if (tab() === 'quantities' && !qtySlot) qtySlot = mountSlot('takeoff', qtyHost, app, { title: 'Quantities — coming soon', text: 'The carpenter’s take-off — boards, fronts, edging, hardware and worktops — will appear here.' });
    estSlot && estSlot.update(selNow());
    qtySlot && qtySlot.update(selNow());
  }

  async function openQuotation() {
    const create = await loadSlot('quotation');
    let inst = null;
    let bodyEl;
    try { inst = create ? create(slotContext(app)) : null; bodyEl = inst && inst.el; } catch (err) { console.error('[carpentry] quotation failed', err); }
    const dlg = openDialog({ title: 'Quotation package', size: 'xl', cls: 'dialog--cquote', body: bodyEl || placeholder('Quotation package — coming soon', 'A complete package for carpenters — drawings, schedules, open questions and the quotation request — will be prepared here.'),
      onClose: () => { try { inst && inst.destroy && inst.destroy(); } catch (err) { console.error(err); } } });
    try { inst && inst.update && inst.update(selNow()); } catch (err) { console.error(err); }
    return dlg;
  }
  async function openCarpenters() {
    const create = await loadSlot('carpenters');
    let inst = null, bodyEl;
    try { inst = create ? create(slotContext(app)) : null; bodyEl = inst && inst.el; } catch (err) { console.error('[carpentry] carpenters failed', err); }
    openDialog({ title: 'Find a carpenter', size: 'lg', cls: 'dialog--ccarp', body: bodyEl || placeholder('Carpenters — coming soon', 'Carpentry workshops near the house, nearest first, with their specialties and contacts.'),
      onClose: () => { try { inst && inst.destroy && inst.destroy(); } catch (err) { console.error(err); } } });
    try { inst && inst.update && inst.update(selNow()); } catch (err) { console.error(err); }
  }

  /* ───────── control helpers ───────── */
  const fk = (node, key) => { if (node && key) { const f = node.matches && node.matches('input,select,textarea,button') ? node : node.querySelector && node.querySelector('input,select,textarea'); if (f) f.dataset.fk = key; } return node; };
  function select(key, label, options, value, onChange, o = {}) {
    const s = h('select', { class: 'select', 'aria-label': label, 'data-fk': key, onChange: () => onChange(s.value) },
      options.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(value) }, l)));
    if (!options.some(([v]) => String(v) === String(value)) && value != null) s.prepend(h('option', { value: String(value), selected: true }, String(value)));
    return row(label, s, o.hint);
  }
  const vocabOpts = (group) => Object.entries(Carp.VOCAB[group] || {}).map(([k, v]) => [k, v.en]);
  function row(label, control, hint) {
    return h('div', { class: 'crow' }, h('span', { class: 'crow__label' }, label), h('div', { class: 'crow__ctl' }, control), hint ? h('p', { class: 'crow__hint' }, hint) : null);
  }
  function numRow(key, label, value, onCommit, o = {}) {
    return row(label, fk(numField({ value, step: o.step || 1, min: o.min ?? 0, max: o.max ?? 1000, digits: o.digits || 0, suffix: o.suffix ?? 'cm', title: label, onCommit }), key), o.hint);
  }
  function textRow(key, label, value, onCommit, placeholderText = '') {
    const i = h('input', { class: 'field__input', type: 'text', value: value || '', placeholder: placeholderText, 'aria-label': label, 'data-fk': key,
      onKeydown: (e) => { if (e.key === 'Enter') i.blur(); }, onChange: () => onCommit(i.value.trim()) });
    return row(label, h('label', { class: 'field' }, i));
  }
  function colourRow(key, label, presets, name, hex, onPick) {
    const custom = h('input', { type: 'color', class: 'swatch swatch--custom', value: /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#cccccc', 'aria-label': `${label}: custom colour`, 'data-tip': 'Custom colour', 'data-fk': `${key}-c`,
      onChange: () => onPick(nameField.value.trim() && !presets.some(([n]) => n === nameField.value.trim()) ? nameField.value.trim() : `custom ${custom.value}`, custom.value) });
    const nameField = h('input', { class: 'field__input', type: 'text', value: name || '', 'aria-label': `${label}: colour name or code`, placeholder: 'Name or supplier code', 'data-fk': `${key}-n`,
      onKeydown: (e) => { if (e.key === 'Enter') nameField.blur(); }, onChange: () => { const v = nameField.value.trim(); if (v && v !== name) onPick(v, hex); } });
    return h('div', { class: 'crow crow--colour' }, h('span', { class: 'crow__label' }, label),
      h('div', { class: 'swatches' }, presets.map(([n, c]) => h('button', { type: 'button', class: 'swatch', 'aria-label': n, 'data-tip': n, 'aria-pressed': String((hex || '').toLowerCase() === c), style: { '--sw': c }, onClick: () => onPick(n.toLowerCase(), c) })), custom),
      h('label', { class: 'field' }, nameField));
  }
  const toggleRow = (key, label, checked, onChange, hint) => fk(toggle({ label, checked, onChange, hint }), key);
  /** Collapsible spec group. */
  function group(id, title, summary, ...kids) {
    const d = h('details', { class: 'cgroup', open: open.has(id), onToggle: () => (d.open ? open.add(id) : open.delete(id)) },
      h('summary', { class: 'cgroup__sum' }, h('span', { class: 'cgroup__title' }, title), h('span', { class: 'cgroup__val truncate' }, summary), icon('chevron-down', { size: 14 })),
      h('div', { class: 'cgroup__body' }, kids));
    return d;
  }
  const errorLine = () => h('p', { class: 'form__error', role: 'alert', hidden: true });
  const say = (line, text) => { line.textContent = text || ''; line.hidden = !text; };

  /* ───────── Run tab ───────── */
  function renderRun(cur) {
    if (!cur) return [emptyState({ icon: 'carpentry', title: 'No run selected', text: 'Select a run in the list on the left or click a unit in the plan.' })];
    const { run, units } = cur;
    const s = run.spec;
    const err = errorLine();
    const upd = (patch) => { const r = C.run(() => Carp.updateRun(run.id, patch), { quiet: true }); say(err, r.refusal); };
    const spec = (path, value) => upd({ spec: nest(path, value) });
    const k = kindInfo(run.kind);
    const rooms = [...plan.rooms].map((r) => [r.id, r.name]);
    const floor = units.filter((u) => rowOf(u) === 'floor');
    const used = floor.reduce((a, u) => a + u.carp.width, 0);
    const hasWorktop = s.worktop && s.worktop.material !== 'none';
    const isIsland = run.kind === 'island';
    const levels = run.levels || [];

    const name = h('input', { class: 'insp__name display', type: 'text', value: run.name, 'aria-label': 'Run name', maxlength: '80', 'data-fk': 'run-name',
      onKeydown: (e) => { if (e.key === 'Enter') name.blur(); }, onChange: () => { const v = name.value.trim(); if (v && v !== run.name) upd({ name: v }); else name.value = run.name; } });
    const head = h('div', { class: 'cinsp__runhead' },
      h('span', { class: 'cinsp__tile' }, icon(k.icon, { size: 24 })),
      h('div', { class: 'insp__id' }, name, h('p', { class: 'insp__meta' }, `${run.code} · ${k.label} · ${roomName(plan, run.roomId)}`)));

    const basics = h('div', { class: 'cbasics' },
      h('div', { class: 'grid2' },
        fk(numField({ label: 'Length', value: run.length, step: 5, min: 10, max: 2000, digits: 0, suffix: 'cm', onCommit: (v) => upd({ length: v }) }), 'run-len'),
        h('div', { class: 'cbasics__used' }, h('span', { class: 'faint' }, 'Units'), h('span', { class: 'num' }, `${num(used)} cm`),
          Math.abs(run.length - used) >= 0.05 ? h('span', { class: run.length > used ? 'cfree' : 'cover' }, run.length > used ? `${num(run.length - used)} free` : `${num(used - run.length)} too long`) : h('span', { class: 'cfits' }, 'fits'))),
      h('div', { class: 'cbasics__acts' },
        btn('Fit with fillers', { small: true, icon: 'fit', kbd: 'F', onClick: () => C.fit(run.id, 'fillers') }),
        btn('Fit to wall', { small: true, icon: 'wall', onClick: () => C.fit(run.id, 'span') }),
        iconBtn('target', 'Show in the plan', { variant: 'outlined', onClick: () => C.focusRun(run.id) }),
        iconBtn('duplicate', 'Duplicate run', { variant: 'outlined', onClick: () => C.duplicateRun(run.id) }),
        iconBtn('trash', 'Remove run…', { variant: 'danger', onClick: () => C.removeRun(run.id) })),
      err);

    const place = group('place', 'Kind, room and ends', `${k.label} · ${roomName(plan, run.roomId)}`,
      select('run-kind', 'Kind', KINDS.map((x) => [x.id, x.label]), run.kind, (v) => upd({ kind: v })),
      select('run-room', 'Room', rooms, run.roomId, (v) => upd({ roomId: v })),
      isIsland ? null : h('div', { class: 'grid2' },
        select('end-l', 'Left end', [['wall', 'Against a wall'], ['open', 'Open (end panel)']], run.ends.left.type === 'run' ? 'wall' : run.ends.left.type, (v) => upd({ ends: { left: v } }), { hint: run.ends.left.type === 'run' ? 'Butts into another run' : '' }),
        select('end-r', 'Right end', [['wall', 'Against a wall'], ['open', 'Open (end panel)']], run.ends.right.type === 'run' ? 'wall' : run.ends.right.type, (v) => upd({ ends: { right: v } }), { hint: run.ends.right.type === 'run' ? 'Butts into another run' : '' })),
      row('Rows', h('div', { class: 'chips chips--wrap' }, ['base', 'wall', 'tall', 'full', 'island'].filter((l) => (Carp.KIND_LEVELS[run.kind] || []).includes(l) || levels.includes(l)).map((l) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(levels.includes(l)),
        onClick: () => { const next = levels.includes(l) ? levels.filter((x) => x !== l) : [...levels, l]; if (next.length) upd({ levels: next }); } }, en('level', l))))));

    const f = s.fronts || {};
    const fronts = group('fronts', 'Fronts', `${en('frontMaterial', f.material)} · ${f.color || ''}`,
      select('f-mat', 'Material', vocabOpts('frontMaterial'), f.material, (v) => spec('fronts.material', v)),
      select('f-style', 'Style', vocabOpts('frontStyle'), f.style, (v) => spec('fronts.style', v)),
      colourRow('f-col', 'Colour', FRONT_COLOURS, f.color, f.colorHex, (n, c) => upd({ spec: { fronts: { color: n, colorHex: c } } })),
      h('div', { class: 'grid2' },
        select('f-dp', 'Drawers', [['equal', 'Equal heights'], ['graded', 'Graded (deep below)']], f.drawerPattern || 'equal', (v) => spec('fronts.drawerPattern', v)),
        select('f-th', 'Thickness', [[16, '16 mm'], [18, '18 mm'], [19, '19 mm'], [22, '22 mm']], f.thickness, (v) => spec('fronts.thickness', +v))));

    const w = s.worktop || {};
    const worktop = group('worktop', isIsland ? 'Worktop and island' : 'Worktop', hasWorktop ? `${en('worktopMaterial', w.material).split(' (')[0]} ${w.thickness} mm · ${w.color || ''}` : 'None',
      select('w-mat', 'Material', vocabOpts('worktopMaterial'), w.material, (v) => spec('worktop.material', v)),
      hasWorktop ? [
        h('div', { class: 'grid2' },
          select('w-th', 'Thickness', [[12, '12 mm'], [20, '20 mm'], [28, '28 mm'], [30, '30 mm'], [40, '40 mm']], w.thickness, (v) => spec('worktop.thickness', +v)),
          select('w-edge', 'Edge', vocabOpts('worktopEdge'), w.edge, (v) => spec('worktop.edge', v))),
        colourRow('w-col', 'Colour', WORKTOP_COLOURS, w.color, w.colorHex, (n, c) => upd({ spec: { worktop: { color: n, colorHex: c } } })),
        h('div', { class: 'grid3' },
          fk(numField({ label: 'Depth', value: w.depth, min: 30, max: 160, suffix: 'cm', onCommit: (v) => spec('worktop.depth', v) }), 'w-d'),
          fk(numField({ label: 'Upstand', value: w.upstand || 0, min: 0, max: 30, suffix: 'cm', onCommit: (v) => spec('worktop.upstand', v) }), 'w-up'),
          fk(numField({ label: 'End overhang', value: w.overhangEnd || 0, min: 0, max: 60, suffix: 'cm', onCommit: (v) => spec('worktop.overhangEnd', v) }), 'w-oe')),
        isIsland ? [
          numRow('w-seat', 'Seating overhang', w.overhangSeat ?? 30, (v) => spec('worktop.overhangSeat', v), { max: 60 }),
          toggleRow('w-wf', 'Waterfall ends', !!w.waterfall, (v) => spec('worktop.waterfall', v), 'The worktop turns down to the floor at both ends'),
          toggleRow('w-bp', 'Back panel on the seating side', w.backPanel !== false, (v) => spec('worktop.backPanel', v)),
        ] : null,
        numRow('w-slab', 'Longest slab', w.maxSlab || 300, (v) => spec('worktop.maxSlab', v), { min: 120, max: 360, hint: 'Longer runs get a joint, placed clear of sink and hob cut-outs.' }),
      ] : null);

    const hd = s.handles || {};
    const handles = group('handles', 'Handles', `${en('handleType', hd.type)}${hd.type !== 'none' && hd.type !== 'push' ? ` · ${en('finish', hd.finish)}` : ''}`,
      select('h-type', 'Type', vocabOpts('handleType'), hd.type, (v) => spec('handles.type', v)),
      hd.type === 'none' || hd.type === 'push' ? null : h('div', { class: 'grid2' },
        select('h-fin', 'Finish', ['black', 'steel', 'brass', 'white', 'aluminium', 'wood'].map((x) => [x, en('finish', x)]), hd.finish, (v) => spec('handles.finish', v)),
        hd.type === 'bar' || hd.type === 'edge-pull' ? fk(numField({ label: 'Length', value: hd.length || 16, min: 3, max: 120, suffix: 'cm', onCommit: (v) => spec('handles.length', v) }), 'h-len') : h('span')));

    const ca = s.carcass || {};
    const carcass = group('carcass', 'Carcass', `${en('carcassMaterial', ca.material).split(' (')[0]} ${ca.thickness} mm · ${ca.color || ''}`,
      select('c-mat', 'Material', vocabOpts('carcassMaterial'), ca.material, (v) => spec('carcass.material', v)),
      h('div', { class: 'grid2' },
        select('c-th', 'Board', [[16, '16 mm'], [18, '18 mm'], [19, '19 mm']], ca.thickness, (v) => spec('carcass.thickness', +v)),
        select('c-back', 'Back', vocabOpts('backMaterial'), ca.back && ca.back.material, (v) => spec('carcass.back.material', v))),
      colourRow('c-col', 'Colour', CARCASS_COLOURS, ca.color, ca.colorHex, (n, c) => upd({ spec: { carcass: { color: n, colorHex: c } } })));

    const H = s.heights || {};
    const heights = group('heights', 'Heights', `worktop ${num(H.worktop)} · top ${num(H.topLine)}${levels.includes('full') ? ` · body ${num(H.body)}` : ''}`,
      h('div', { class: 'grid2' },
        levels.some((l) => l === 'base' || l === 'island') ? fk(numField({ label: 'Worktop', value: H.worktop, min: 60, max: 110, suffix: 'cm', onCommit: (v) => spec('heights.worktop', v) }), 'hh-wt') : null,
        levels.includes('wall') ? fk(numField({ label: 'Wall units from', value: H.wallBottom, min: 100, max: 200, suffix: 'cm', onCommit: (v) => spec('heights.wallBottom', v) }), 'hh-wb') : null,
        levels.some((l) => l === 'wall' || l === 'tall') ? fk(numField({ label: 'Top line', value: H.topLine, min: 150, max: 300, suffix: 'cm', onCommit: (v) => spec('heights.topLine', v) }), 'hh-tl') : null,
        levels.includes('full') ? fk(numField({ label: 'Body height', value: H.body, min: 150, max: 300, suffix: 'cm', onCommit: (v) => spec('heights.body', v) }), 'hh-body') : null),
      select('hh-above', 'Above the units', vocabOpts('aboveTop'), H.aboveTop, (v) => spec('heights.aboveTop', v)),
      numRow('hh-scribe', 'Ceiling scribe gap', H.scribe ?? 2, (v) => spec('heights.scribe', v), { max: 10 }));

    const D = s.depths || {};
    const depths = group('depths', 'Depths (carcass)', levels.filter((l) => D[l] != null).map((l) => `${en('level', l).split(' ')[0].toLowerCase()} ${num(D[l])}`).join(' · '),
      h('div', { class: 'grid2' }, levels.filter((l) => D[l] != null).map((l) => fk(numField({ label: en('level', l), value: D[l], min: 15, max: 90, suffix: 'cm', onCommit: (v) => spec(`depths.${l}`, v) }), `d-${l}`))));

    const P = s.plinth || {};
    const plinth = group('plinth', 'Plinth', P.height ? `${num(P.height)} cm · ${en('plinthFinish', P.finish)}` : 'None (wall-hung)',
      h('div', { class: 'grid2' },
        fk(numField({ label: 'Height', value: P.height, min: 0, max: 20, suffix: 'cm', onCommit: (v) => spec('plinth.height', v) }), 'p-h'),
        fk(numField({ label: 'Set back', value: P.setback, min: 0, max: 10, suffix: 'cm', onCommit: (v) => spec('plinth.setback', v) }), 'p-sb')),
      select('p-fin', 'Finish', vocabOpts('plinthFinish'), P.finish, (v) => spec('plinth.finish', v)));

    const HW = s.hardware || {};
    const hardware = group('hardware', 'Hardware', en('hardwareGrade', HW.grade),
      select('hw-g', 'Grade', vocabOpts('hardwareGrade'), HW.grade, (v) => spec('hardware.grade', v)),
      textRow('hw-h', 'Hinges', HW.hinge, (v) => spec('hardware.hinge', v), 'e.g. clip-on 110°, soft-close'),
      textRow('hw-d', 'Drawer runners', HW.drawers, (v) => spec('hardware.drawers', v), 'e.g. full-extension box'),
      textRow('hw-l', 'Lift-up fittings', HW.liftUp, (v) => spec('hardware.liftUp', v), 'e.g. stay-lift'));

    const E = s.edge || {};
    const edges = group('edges', 'Edging', `${en('edge', E.fronts)}`,
      select('e-f', 'Fronts', vocabOpts('edge'), E.fronts, (v) => spec('edge.fronts', v)),
      select('e-c', 'Carcass', vocabOpts('edge'), E.carcass, (v) => spec('edge.carcass', v)));

    const SB = s.splashback || {};
    const splash = hasWorktop ? group('splash', 'Splashback', SB.material === 'none' ? 'None' : `${en('splashback', SB.material)} · ${num(SB.height)} cm`,
      select('sb-m', 'Material', vocabOpts('splashback'), SB.material, (v) => spec('splashback.material', v)),
      SB.material === 'none' ? null : numRow('sb-h', 'Height', SB.height, (v) => spec('splashback.height', v), { max: 120 })) : null;

    const LG = s.lighting || {};
    const light = group('light', 'Lighting', [LG.underWall && 'under wall units', LG.inCabinet && 'in cabinets'].filter(Boolean).join(' · ') || 'None',
      toggleRow('lg-u', 'LED strip under the wall units', !!LG.underWall, (v) => spec('lighting.underWall', v)),
      toggleRow('lg-i', 'LED lighting inside cabinets', !!LG.inCabinet, (v) => spec('lighting.inCabinet', v)));

    const SL = s.sliding || {};
    const sliding = run.kind === 'wardrobe' || units.some((u) => u.carp.module === 'wardrobe-sliding') ? group('sliding', 'Sliding doors', SL.doors ? `${SL.doors} doors${SL.mirror ? ', mirror' : ''}` : 'Automatic',
      numRow('sl-n', 'Number of doors', SL.doors || 0, (v) => spec('sliding.doors', v || null), { suffix: '', max: 6, hint: '0 = worked out from the width (60–120 cm per door)' }),
      toggleRow('sl-m', 'Mirror on the doors', !!SL.mirror, (v) => spec('sliding.mirror', v))) : null;

    const notes = h('textarea', { class: 'textarea', rows: '3', 'aria-label': 'Notes for the carpenter', 'data-fk': 'run-notes', placeholder: 'Site conditions, delivery, anything the carpenter should know about this run…',
      onChange: () => upd({ notes: notes.value }) });
    notes.value = run.notes || '';

    return [head, basics,
      h('h3', { class: 'cinsp__sect' }, 'Specification'),
      h('div', { class: 'cgroups' }, fronts, worktop, handles, carcass, heights, depths, plinth, hardware, edges, splash, light, sliding, place),
      featuresSection({ app, C, runId: run.id, unitId: null, fkPrefix: 'rf' }),
      h('section', { class: 'sec' }, h('header', { class: 'sec__head' }, h('h3', { class: 'sec__title' }, 'Notes for the carpenter')), notes)];
  }

  /* ───────── Unit tab ───────── */
  function renderUnit(cur) {
    if (!cur) return [emptyState({ icon: 'carpentry', title: 'No run selected', text: 'Select a run, then a unit in the drawing or the plan.' })];
    const { run, units, unit } = cur;
    if (!unit) {
      const order = C.ordered(run, units), codes = C.codes(run, units);
      return [emptyState({ icon: 'select', title: 'Select a unit', text: 'Click a unit in the drawing below or in the plan, or pick one here. ← → step through them.' }),
        h('ul', { class: 'cunits' }, order.map((u) => h('li', null, h('button', { type: 'button', class: 'cunit', onClick: () => C.select(run.id, u.id) },
          h('span', { class: 'cunit__code num' }, codes.get(u.id) || ''), h('span', { class: 'cunit__name truncate' }, (Carp.MODULES[u.carp.module] || {}).name ? Carp.MODULES[u.carp.module].name.en : u.name),
          h('span', { class: 'cunit__w num' }, cm(u.carp.width))))))];
    }
    const c = unit.carp, mod = Carp.MODULES[c.module] || Carp.MODULES.custom;
    const codes = C.codes(run, units), code = codes.get(unit.id) || '';
    const err = errorLine();
    const upd = (patch) => { const r = C.run(() => Carp.updateUnit(unit.id, patch), { quiet: true }); say(err, r.refusal); return !r.refusal; };
    let g = null;
    try { g = Carp.geometryOf(run, unit); } catch (e) { g = null; }
    const level = Carp.levelOf(unit);

    const head = h('div', { class: 'cinsp__runhead' },
      h('span', { class: 'cinsp__tile cinsp__tile--unit num' }, code),
      h('div', { class: 'insp__id' }, h('h3', { class: 'cinsp__uname display' }, mod.name.en),
        h('p', { class: 'insp__meta' }, `${run.code} · ${en('level', level)}${g ? ` · ${num(c.width)} × ${num(g.h)} × ${num(g.d)} cm` : ''}`)));

    // module switcher: compatible modules of the same level
    const compat = Carp.modulesFor(run.kind, mod.level === 'any' ? null : mod.level).filter((m) => (mod.level === 'any' ? m.level === 'any' : m.level === mod.level));
    const modSel = select('u-mod', 'Module', compat.map((m) => [m.id, m.name.en]), c.module, (v) => upd({ module: v }));

    // width
    const fixed = mod.w.min === mod.w.max;
    const widths = [...new Set([...STD_WIDTHS, mod.w.std])].filter((v) => v >= mod.w.min && v <= mod.w.max).sort((a, b) => a - b);
    const width = h('div', { class: 'cwidth' },
      fk(numField({ label: 'Width', value: c.width, step: 5, min: mod.w.min, max: mod.w.max, digits: c.width % 1 ? 1 : 0, suffix: 'cm', disabled: fixed, onCommit: (v) => upd({ width: v }) }), 'u-w'),
      h('span', { class: 'cwidth__range' }, fixed ? `Fixed by the appliance (${num(mod.w.std)} cm)` : `${num(mod.w.min)}–${num(mod.w.max)} cm`),
      fixed ? null : h('div', { class: 'chips chips--wrap cwidth__chips' }, widths.map((v) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(Math.abs(c.width - v) < 0.05), onClick: () => upd({ width: v }) }, String(v)))));

    // internals (data-driven)
    const internals = internalsEditor(unit, mod, upd);

    // fronts
    const kinds = g ? new Set(g.fronts.map((f) => f.kind)) : new Set();
    const doorish = kinds.has('door') || kinds.has('glass') || kinds.has('mirror');
    const ops = Carp.VOCAB.doorOperation;
    const frontsBits = [];
    if (doorish && !mod.sliding) {
      frontsBits.push(row('Doors', segmented({ options: [{ value: 1, label: '1 door' }, { value: 2, label: '2 doors' }], value: (c.fronts && c.fronts.doors) || (c.width > 60 ? 2 : 1), label: 'Number of doors', cls: 'seg--block seg--mini',
        onChange: (v) => upd({ fronts: { doors: v } }) })));
      if (((c.fronts && c.fronts.doors) || (c.width > 60 ? 2 : 1)) === 1) frontsBits.push(row('Hinges', segmented({ options: [{ value: 'L', label: 'Left' }, { value: 'R', label: 'Right' }], value: (c.fronts && c.fronts.hinge) || c.handed || 'L', label: 'Hinge side', cls: 'seg--block seg--mini', onChange: (v) => upd({ fronts: { hinge: v } }) })));
    }
    if (level === 'full' && doorish) frontsBits.push(toggleRow('u-mirror', 'Mirror on the doors', !!(c.fronts && c.fronts.mirror), (v) => upd({ fronts: { mirror: v } })));
    if (ops && (g ? g.fronts.length > 0 : true) && mod.id !== 'filler' && mod.id !== 'panel') {
      frontsBits.push(select('u-op', 'Door operation', Object.entries(ops).map(([k, v]) => [k, v.en]), (c.fronts && c.fronts.operation) || 'hinged', (v) => upd({ fronts: { operation: v } })));
    }
    const fronts = frontsBits.length ? h('section', { class: 'sec' }, h('header', { class: 'sec__head' }, h('h3', { class: 'sec__title' }, 'Fronts')), frontsBits) : null;

    // appliance and special fields
    const special = [];
    if (mod.appliance) {
      const a = c.appliance || {};
      const setA = (k, v) => upd({ appliance: { ...a, [k]: v } });
      special.push(textRow('a-make', 'Make', a.make, (v) => setA('make', v), 'e.g. Bosch'), textRow('a-model', 'Model', a.model, (v) => setA('model', v), 'Model number, for the niche'));
      if (mod.appliance.niche || mod.appliance.free) special.push(h('div', { class: 'grid2' },
        fk(numField({ label: 'Appliance width', value: a.w || mod.appliance.w, min: 30, max: 120, suffix: 'cm', onCommit: (v) => setA('w', v) }), 'a-w'),
        fk(numField({ label: 'Appliance height', value: a.h || mod.appliance.h, min: 30, max: 220, suffix: 'cm', onCommit: (v) => setA('h', v) }), 'a-h')));
    }
    if (c.module === 'base-hob' || (run.kind === 'island' && c.module === 'island')) special.push(select('u-hob', 'Hob', [['', run.kind === 'island' ? 'None' : 'Induction (default)'], ['induction', 'Induction'], ['gas', 'Gas']], c.hob || '', (v) => upd({ hob: v || null })));
    if (run.kind === 'island' && c.module === 'island') special.push(toggleRow('u-sink', 'Sink in the island', !!c.sink, (v) => upd({ sink: v || null })));
    if (c.module === 'vanity' && c.width >= 120) special.push(select('u-basins', 'Basins', [[1, 'One basin'], [2, 'Two basins']], c.basins || 1, (v) => upd({ basins: +v })));
    const twoArm = !!(g && g.corner);                       // corner modules occupying the corner square on both arms
    if (mod.corner) special.push(h('div', { class: 'grid2' },
      select('u-cs', 'Corner on the', [['L', 'Left'], ['R', 'Right']], c.cornerSide || 'L', (v) => upd({ cornerSide: v })),
      twoArm
        ? fk(numField({ label: 'Leg on the other wall', value: c.legB ?? g.corner.legB, min: 30, max: 200, suffix: 'cm', title: 'Length of the corner unit along the other wall', onCommit: (v) => upd({ legB: v }) }), 'u-legb')
        : fk(numField({ label: 'Blind part', value: c.blind ?? (level === 'wall' ? 35 : 60), min: 0, max: c.width, suffix: 'cm', onCommit: (v) => upd({ blind: v }) }), 'u-blind')));
    if (twoArm) special.push(h('p', { class: 'crow__hint' }, `Legs ${num(g.corner.legA)} × ${num(g.corner.legB)} cm: this unit fills the corner square of both walls.`));
    if (c.module === 'custom' && (level === 'base' || level === 'tall' || level === 'full')) special.push(toggleRow('u-noplinth', 'No plinth (stands on legs / the floor)', !!c.noPlinth, (v) => upd({ noPlinth: v || null })));
    if (c.module === 'custom') special.push(h('div', { class: 'grid3' },
      fk(numField({ label: 'Height', value: g ? g.h : c.h, min: 5, max: 300, suffix: 'cm', onCommit: (v) => upd({ h: v }) }), 'u-h'),
      fk(numField({ label: 'Depth', value: c.depth ?? (g ? g.dc : 56), min: 5, max: 120, suffix: 'cm', onCommit: (v) => upd({ depth: v }) }), 'u-d'),
      level === 'wall' || level === 'base' ? fk(numField({ label: 'From floor', value: g ? g.elev : c.elev || 0, min: 0, max: 280, suffix: 'cm', onCommit: (v) => upd({ elev: v }) }), 'u-elev') : null));
    const specialSec = special.length ? h('section', { class: 'sec' }, h('header', { class: 'sec__head' }, h('h3', { class: 'sec__title' }, mod.appliance ? 'Appliance' : c.module === 'custom' ? 'Size and place' : 'Details')), special) : null;

    // overrides
    const overrides = overridesSection(run, unit, upd);

    const note = h('textarea', { class: 'textarea', rows: '2', 'aria-label': 'Note on this unit', 'data-fk': 'u-note', placeholder: 'Anything special about this unit…', onChange: () => upd({ note: note.value }) });
    note.value = c.note || '';
    const acts = h('div', { class: 'actrow', role: 'group', 'aria-label': 'Unit actions' },
      iconBtn('chevron-left', 'Move left', { variant: 'outlined', kbd: 'Alt ←', onClick: () => C.shiftUnit(unit.id, -1) }),
      iconBtn('chevron-right', 'Move right', { variant: 'outlined', kbd: 'Alt →', onClick: () => C.shiftUnit(unit.id, 1) }),
      iconBtn('minus', 'Narrower by 5 cm', { variant: 'outlined', kbd: '−', disabled: fixed, onClick: () => C.nudgeWidth(unit.id, -5) }),
      iconBtn('plus', 'Wider by 5 cm', { variant: 'outlined', kbd: '+', disabled: fixed, onClick: () => C.nudgeWidth(unit.id, 5) }),
      iconBtn('trash', 'Remove unit', { variant: 'danger', kbd: 'Delete', onClick: () => C.removeUnit(unit.id) }));

    return [head, acts, err,
      h('section', { class: 'sec' }, h('header', { class: 'sec__head' }, h('h3', { class: 'sec__title' }, 'Module and width')), modSel, width),
      bespokeSection({ app, C, run, unit, mod, upd }),
      internals, fronts, specialSec, overrides,
      featuresSection({ app, C, runId: run.id, unitId: unit.id, fkPrefix: 'uf' }),
      h('section', { class: 'sec' }, h('header', { class: 'sec__head' }, h('h3', { class: 'sec__title' }, 'Note')), note)];
  }

  /** Internals editor driven by MODULES[id].internals (default / options / group). */
  function internalsEditor(unit, mod, upd) {
    const I = mod.internals;
    if (!I || !I.default) return null;
    const cur = { ...I.default, ...(unit.carp.internals || {}) };
    const rows = [];
    for (const [k, def] of Object.entries(I.default)) {
      if (k === 'layout') continue;                                    // bespoke composer
      const v = cur[k];
      const opts = Array.isArray(I.options) ? I.options : I.options && Array.isArray(I.options[k]) ? I.options[k] : null;
      const label = { drawers: 'Drawers', shelves: 'Shelves', preset: 'Interior', pantry: 'Interior', corner: 'Corner fitting', bin: 'Bin pull-out', pullout: 'Pull-out', lowerDoors: 'Doors below', bays: 'Bays', cornerPantry: 'Corner pantry' }[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, (x) => x.toUpperCase());
      if (k === 'bays') { rows.push(baysEditor(unit, upd)); continue; }
      if (opts && opts.every((o) => typeof o === 'number')) {
        rows.push(row(label, segmented({ options: opts.map((o) => ({ value: o, label: String(o) })), value: v, label, cls: 'seg--block seg--mini', onChange: (x) => upd({ internals: { [k]: x } }) })));
      } else if (opts && (typeof def === 'string' || typeof v === 'string')) {
        const grp = I.group && Carp.VOCAB[I.group];
        rows.push(select(`i-${k}`, label, opts.map((o) => [o, grp && grp[o] ? grp[o].en : (Carp.VOCAB[k] && Carp.VOCAB[k][o] ? Carp.VOCAB[k][o].en : String(o))]), v, (x) => upd({ internals: { [k]: x } })));
      } else if (typeof def === 'boolean') {
        rows.push(toggleRow(`i-${k}`, label, !!v, (x) => upd({ internals: { [k]: x } })));
      } else if (typeof def === 'number') {
        rows.push(numRow(`i-${k}`, label, v, (x) => upd({ internals: { [k]: x } }), { suffix: k === 'shelves' || k === 'drawers' ? '' : 'cm', max: k === 'shelves' ? 12 : k === 'drawers' ? 6 : 400 }));
      } else if (def && typeof def === 'object' && !Array.isArray(def)) {
        for (const [kk, vv] of Object.entries(def)) {
          const cv = (v && v[kk]) ?? vv;
          if (typeof vv === 'number') rows.push(numRow(`i-${k}-${kk}`, `${label}: ${kk}`, cv, (x) => upd({ internals: { [k]: { [kk]: x } } })));
        }
      } else if (typeof def === 'string') {
        rows.push(textRow(`i-${k}`, label, v, (x) => upd({ internals: { [k]: x } })));
      }
    }
    if (!rows.length) return null;
    return h('section', { class: 'sec' }, h('header', { class: 'sec__head' }, h('h3', { class: 'sec__title' }, 'Inside')), rows);
  }

  /** Island bays: automatic (≈ 70 cm) or a list of { w, kind, drawers }. */
  function baysEditor(unit, upd) {
    const bays = unit.carp.internals && Array.isArray(unit.carp.internals.bays) ? unit.carp.internals.bays : null;
    let auto = [];
    try { const g = Carp.geometryOf(Carp.runOfItem(unit), unit); auto = Carp.islandBays({ ...g, t: g.t }); } catch (e) { auto = []; }
    const list = bays || auto.map((b) => ({ w: b.w, kind: b.kind, drawers: b.drawers }));
    const set = (next) => upd({ internals: { bays: next } });
    return h('div', { class: 'cbays' },
      toggleRow('i-bays-auto', 'Automatic bays (about 70 cm)', !bays, (v) => set(v ? null : list.map((b) => ({ ...b })))),
      bays ? h('ul', { class: 'cbays__list' }, bays.map((b, i) => h('li', { class: 'cbays__row' },
        h('span', { class: 'cbays__n num' }, String(i + 1)),
        fk(numField({ value: b.w, min: 20, max: 200, digits: b.w % 1 ? 1 : 0, suffix: 'cm', title: `Bay ${i + 1} width`, onCommit: (v) => set(bays.map((x, j) => (j === i ? { ...x, w: v } : x))) }), `bay-w-${i}`),
        h('select', { class: 'select', 'aria-label': `Bay ${i + 1} fronts`, 'data-fk': `bay-k-${i}`, onChange: (e) => set(bays.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x))) },
          [['drawers', 'Drawers'], ['doors', 'Doors']].map(([v, l]) => h('option', { value: v, selected: b.kind === v }, l))),
        iconBtn('trash', `Remove bay ${i + 1}`, { size: 15, onClick: () => bays.length > 1 && set(bays.filter((_, j) => j !== i)) })))) : null,
      bays ? btn('Add a bay', { small: true, icon: 'plus', onClick: () => set([...bays, { w: 60, kind: 'drawers', drawers: 3 }]) }) : null,
      bays ? h('p', { class: 'crow__hint' }, `Bays add up to ${num(bays.reduce((s, b) => s + b.w, 0))} cm of ${num(unit.carp.width)} cm (less the end panels).`) : null);
  }

  /** Per-unit spec overrides: what differs from the run. */
  function overridesSection(run, unit, upd) {
    const ov = flatten(unit.carp.spec || {});
    const keys = Object.keys(ov);
    const LABEL = { 'fronts.color': 'Front colour', 'fronts.colorHex': 'Front colour (code)', 'fronts.material': 'Front material', 'fronts.style': 'Front style', 'handles.type': 'Handle', 'handles.finish': 'Handle finish', 'carcass.color': 'Carcass colour', 'carcass.colorHex': 'Carcass colour (code)', 'carcass.material': 'Carcass material' };
    const show = (k, v) => { const g = { 'fronts.material': 'frontMaterial', 'fronts.style': 'frontStyle', 'handles.type': 'handleType', 'handles.finish': 'finish', 'carcass.material': 'carcassMaterial' }[k]; return g ? en(g, v) : String(v); };
    const drop = (k) => {
      const next = JSON.parse(JSON.stringify(unit.carp.spec || {}));
      // a colour override goes with its name / code twin
      const twins = k.endsWith('.color') ? [k, k + 'Hex'] : k.endsWith('.colorHex') ? [k, k.slice(0, -3)] : [k];
      for (const t of twins) { const p = t.split('.'); let o = next; for (let i = 0; i < p.length - 1 && o; i++) o = o[p[i]]; if (o) delete o[p[p.length - 1]]; }
      C.replaceUnit(unit.id, { spec: prune(next) });
    };
    const add = (e) => openMenu(e.currentTarget, [
      { heading: 'Make this unit differ' },
      ...FRONT_COLOURS.slice(0, 8).map(([n, c]) => ({ label: `Front colour: ${n}`, onSelect: () => upd({ spec: { fronts: { color: n.toLowerCase(), colorHex: c } } }) })),
      { separator: true },
      ...Object.entries(Carp.VOCAB.frontMaterial).map(([k, v]) => ({ label: `Front material: ${v.en}`, onSelect: () => upd({ spec: { fronts: { material: k } } }) })),
      { separator: true },
      ...Object.entries(Carp.VOCAB.handleType).map(([k, v]) => ({ label: `Handle: ${v.en}`, onSelect: () => upd({ spec: { handles: { type: k } } }) })),
    ], { placement: 'bottom-start' });
    const shown = keys.filter((k) => !(k.endsWith('colorHex') && keys.includes(k.slice(0, -3))));
    return h('section', { class: 'sec' },
      h('header', { class: 'sec__head' }, h('h3', { class: 'sec__title' }, 'Differs from the run'), btn('Add', { small: true, icon: 'plus', onClick: add })),
      shown.length ? h('ul', { class: 'covr' }, shown.map((k) => h('li', { class: 'covr__row' },
        h('span', { class: 'covr__k' }, LABEL[k] || k), h('span', { class: 'covr__v truncate' }, show(k, ov[k]),
          k.endsWith('.color') && ov[k + 'Hex'] ? h('span', { class: 'covr__sw', style: { background: ov[k + 'Hex'] } }) : null),
        iconBtn('close', `Follow the run again (${LABEL[k] || k})`, { size: 14, onClick: () => drop(k) }))))
        : h('p', { class: 'sec__empty' }, `Follows ${run.code}: same fronts, handles and carcass. Add a difference — for example a contrasting colour for this unit only.`));
  }

  /* ───────── Checks tab ───────── */
  function renderChecks(cur) {
    if (!cur) {
      const runs = Carp.listRuns();
      if (!runs.length) return [emptyState({ icon: 'checks', title: 'Nothing to check yet', text: 'Checks appear once there are runs.' })];
      return [h('p', { class: 'cinsp__lead' }, 'Select a run to see its checks. Summary:'),
        h('ul', { class: 'cchk__sum' }, runs.map((r) => { const c = C.counts(r.id); return h('li', null, h('button', { type: 'button', class: 'cunit', onClick: () => C.select(r.id) },
          h('span', { class: 'cunit__code num' }, r.code), h('span', { class: 'cunit__name truncate' }, r.name),
          h('span', { class: `cunit__w ${c.error ? 'is-fail' : c.warning ? 'is-warn' : 'is-pass'}` }, c.error ? `${c.error} errors` : c.warning ? `${c.warning} warnings` : 'OK'))); }))];
    }
    const { run, units } = cur;
    const list = C.findings(run.id);
    const codes = C.codes(run, units);
    if (!list.length) return [emptyState({ icon: 'pass', title: `${run.code} passes every check`, text: 'Clearances, landings, openings, worktop joints and reach all look right.' })];
    const c = C.counts(run.id);
    const out = [h('p', { class: 'cinsp__lead' }, c.error ? `${c.error} ${c.error === 1 ? 'error blocks' : 'errors block'} sending ${run.code} to a carpenter.` : `No errors. ${c.warning ? `${c.warning} ${c.warning === 1 ? 'warning' : 'warnings'} to review.` : ''}`)];
    for (const sev of ['error', 'warning', 'info']) {
      const fs = list.filter((f) => f.severity === sev);
      if (!fs.length) continue;
      out.push(h('section', { class: 'sec' }, h('header', { class: 'sec__head' }, h('h3', { class: 'sec__title' }, SEV[sev].label), h('span', { class: 'sec__note num' }, String(fs.length))),
        h('ul', { class: 'checklist' }, fs.map((f) => h('li', null, h('button', { type: 'button', class: `cchk cchk--${SEV[sev].cls}`, disabled: !(f.unitIds && f.unitIds.length),
          onClick: () => { if (f.unitIds && f.unitIds.length) { C.select(run.id, f.unitIds[0]); C.flash(f.unitIds); } } },
        h('span', { class: `check-ico check-ico--${SEV[sev].cls}` }, icon(SEV[sev].icon, { size: 14 })),
        h('span', { class: 'cchk__text' }, txt(f.text), f.unitIds && f.unitIds.length ? h('span', { class: 'cchk__units num' }, f.unitIds.map((id) => codes.get(id)).filter(Boolean).join(' · ')) : null)))))));
    }
    return out;
  }

  /* ───────── render ───────── */
  function syncHead(cur) {
    if (!cur) setKids(headTitle, h('span', { class: 'cinsp__hcode' }, 'Carpentry'), h('span', { class: 'cinsp__hname faint truncate' }, `${Carp.listRuns().length} runs`));
    else setKids(headTitle, h('span', { class: 'cinsp__hcode num' }, cur.run.code), h('span', { class: 'cinsp__hname truncate' }, cur.run.name));
    let errs = 0, warns = 0;
    if (cur) { const c = C.counts(cur.run.id); errs = c.error; warns = c.warning; }
    else for (const r of Carp.listRuns()) { const c = C.counts(r.id); errs += c.error; warns += c.warning; }
    checksBadge.hidden = !(errs + warns);
    checksBadge.textContent = String(errs + warns);
    checksBadge.classList.toggle('badge--fail', errs > 0);
    quoteBtn.disabled = !Carp.listRuns().length;
  }
  function render() {
    if (!C.isActive()) { dirty = true; return; }
    dirty = false;
    const cur = C.current();
    syncHead(cur);
    const t = tab();
    for (const x of CTABS) { const on = x.id === t; tabBtns.get(x.id).setAttribute('aria-selected', String(on)); tabBtns.get(x.id).tabIndex = on ? 0 : -1; panels.get(x.id).hidden = !on; }
    if (t === 'estimate' || t === 'quantities') { tierSeg.set(store.ui.carpentryTier || null); ensureSlots(); return; }
    const p = panels.get(t);
    const focusKey = p.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
    const scroll = body.scrollTop;
    try {
      setKids(p, t === 'run' ? renderRun(cur) : t === 'unit' ? renderUnit(cur) : renderChecks(cur));
    } catch (err) { console.error('[carpentry] inspector failed', err); setKids(p, emptyState({ icon: 'warn', title: 'This panel could not be shown', text: String(err && err.message || err) })); }
    if (focusKey) p.querySelector(`[data-fk="${focusKey}"]`)?.focus({ preventScroll: true });
    body.scrollTop = scroll;
  }
  let dirty = true;
  const schedule = rafThrottle(render);
  store.on('carpentry', (e) => {
    if (e && e.transient) { if (tab() === 'unit' || tab() === 'run') schedule(); return; }
    schedule();
  });
  store.on('history', schedule);
  store.on('load', schedule);
  store.on('items', (e) => { if (!e.transient && C.isActive() && tab() === 'checks') schedule(); });
  store.on('plan', (e) => { if ((!e || !e.transient) && C.isActive()) schedule(); });
  store.on('ui', (e) => {
    if (e.keys.includes('carpentrySel')) {
      const sel = store.ui.carpentrySel;
      // Picking a unit brings up the Unit tab (unless the owner is reading checks or prices).
      if (sel && sel.unitId && tab() === 'run') { store.setUI({ carpentryTab: 'unit' }); return; }
      schedule();
    }
    if (e.keys.includes('carpentryTab') || e.keys.includes('carpentryTier') || e.keys.includes('units')) schedule();
    if (e.keys.includes('tool') && C.isActive()) render();
  });
  C.on('features', schedule);
  if (C.isActive()) render();
  return el;
}

/** Remove empty objects left after deleting override keys. */
function prune(o) {
  if (!o || typeof o !== 'object') return o;
  for (const k of Object.keys(o)) {
    if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) { prune(o[k]); if (!Object.keys(o[k]).length) delete o[k]; }
  }
  return o;
}
