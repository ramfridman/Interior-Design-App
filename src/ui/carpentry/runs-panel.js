/**
 * Carpentry — left sidebar: the first-visit choice (adopt the architect's layout or start empty), the runs grouped by
 * room (code, name with inline rename, kind, length, units, findings badge, fit / duplicate / remove), the "New run"
 * kind picker and the module palette of the selected run (click = append to that row, drag = drop into the elevation).
 */
import * as Carp from '../../carpentry/index.js';
import { h, setKids, rafThrottle } from '../dom.js';
import { icon } from '../icons.js';
import { btn, iconBtn, kbd } from '../components.js';
import { openPopover, openMenu } from '../dialogs.js';
import { KINDS, kindInfo, LEVEL_GROUPS, moduleGlyph, num, metres, roomName } from './vocab.js';

export const DND_MODULE = 'application/x-carp-module';

/** @param {HTMLElement} root  the left sidebar  @param {object} app  @param {object} C  carpentry controller */
export function initRunsPanel(root, app, C) {
  const { store, plan } = app;
  const body = h('div', { class: 'cpanel__body' });
  const newBtn = btn('New run', { small: true, variant: 'primary', icon: 'plus', kbd: 'N', onClick: () => openKinds(newBtn) });
  const moreBtn = iconBtn('more', 'More', { onClick: () => openMenu(moreBtn, [
    { label: 'Adopt the architect’s layout', icon: 'home', onSelect: () => C.adopt() },
    { label: 'Keyboard shortcuts', icon: 'keyboard', kbd: '?', onSelect: () => app.openShortcuts() },
    { separator: true },
    { label: 'Back to furnishing', icon: 'sofa', kbd: 'C', onSelect: () => C.exit() },
  ], { placement: 'bottom-end' }) });
  const el = h('div', { class: 'cpanel', 'aria-label': 'Carpentry runs' },
    h('header', { class: 'side__head' }, h('h2', { class: 'cat__title display truncate' }, 'Carpentry'),
      h('div', { class: 'cpanel__headacts' }, newBtn, moreBtn, iconBtn('panel-left', 'Hide this panel', { onClick: () => app.setPanelOpen('left', false) }))),
    body);
  root.append(el);

  let renaming = null;   // runId being renamed

  /* ───────── first visit ───────── */
  function renderEmpty() {
    return h('div', { class: 'cstart' },
      h('p', { class: 'cstart__lead' }, 'Design the made-to-measure carpentry of the house — kitchen, island, wardrobes, pantry, vanities — and hand complete drawings to a carpenter.'),
      h('button', { type: 'button', class: 'cstart__opt cstart__opt--main', onClick: () => C.adopt() },
        h('span', { class: 'cstart__icon' }, icon('home', { size: 22 })),
        h('span', { class: 'cstart__text' },
          h('span', { class: 'cstart__title' }, 'Start from the architect’s layout'),
          h('span', { class: 'cstart__desc' }, 'Turns the carpentry drawn on the plan into editable runs: the L-shaped kitchen with its sink, hob, oven tower and pantries, the island, the bedroom and safe-room wardrobes, the hall and entry closets, both vanities and the laundry cupboards. Positions and sizes are kept; the fridge and washer stay products.'))),
      h('button', { type: 'button', class: 'cstart__opt', onClick: (e) => openKinds(e.currentTarget) },
        h('span', { class: 'cstart__icon' }, icon('plus', { size: 22 })),
        h('span', { class: 'cstart__text' },
          h('span', { class: 'cstart__title' }, 'Start empty'),
          h('span', { class: 'cstart__desc' }, 'Pick a kind of run, then click a wall in the plan. You get a sensible set of starter units to change.'))),
      h('p', { class: 'cstart__note' }, 'Everything can be undone. The architect’s furniture placeholders stay until a run replaces them.'));
  }

  /* ───────── new run: kinds ───────── */
  function openKinds(anchor) {
    const pop = openPopover(anchor, h('div', { class: 'ckinds', role: 'menu', 'aria-label': 'Kind of run' },
      h('p', { class: 'fopts__title' }, 'New run'),
      h('div', { class: 'ckinds__grid' }, KINDS.map((k) => h('button', { type: 'button', class: 'ckind', role: 'menuitem',
        onClick: () => { pop.close(false); C.startNewRun(k.id); } },
      h('span', { class: 'ckind__icon' }, icon(k.icon, { size: 20 })),
      h('span', { class: 'ckind__text' }, h('span', { class: 'ckind__name' }, k.label), h('span', { class: 'ckind__hint' }, k.hint)))))),
    { cls: 'popover--panel popover--kinds', placement: 'bottom-start', label: 'New run' });
  }
  C.on('new-run', () => openKinds(newBtn));

  /* ───────── runs list ───────── */
  function runRow(run, selected) {
    const got = Carp.getRun(run.id);
    const n = got ? got.units.filter((u) => !u.hidden || u.carp.module === 'base-space').length : 0;
    const c = C.counts(run.id);
    const badge = c.error ? h('span', { class: 'cbadge cbadge--fail', 'data-tip': `${c.error} ${c.error === 1 ? 'error' : 'errors'} — see Checks` }, icon('fail', { size: 12 }), String(c.error))
      : c.warning ? h('span', { class: 'cbadge cbadge--warn', 'data-tip': `${c.warning} ${c.warning === 1 ? 'warning' : 'warnings'} — see Checks` }, icon('warn', { size: 12 }), String(c.warning))
        : h('span', { class: 'cbadge cbadge--pass', 'data-tip': c.info ? `No problems, ${c.info} ${c.info === 1 ? 'note' : 'notes'}` : 'No problems found' }, icon('pass', { size: 12 }));
    const k = kindInfo(run.kind);
    const nameEl = renaming === run.id
      ? h('input', { class: 'crun__rename', type: 'text', value: run.name, 'aria-label': `Name of ${run.code}`, maxlength: '80', 'data-autofocus': '',
        onKeydown: (e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.stopPropagation(); renaming = null; render(); } },
        onBlur: (e) => { const v = e.currentTarget.value.trim(); renaming = null; if (v && v !== run.name) C.run(() => Carp.updateRun(run.id, { name: v })); else render(); } })
      : h('span', { class: 'crun__name truncate', onDblclick: () => { renaming = run.id; render(); } }, run.name);
    return h('li', { class: `crun${selected ? ' is-selected' : ''}` },
      h('button', { type: 'button', class: 'crun__main', 'aria-pressed': String(selected), 'aria-label': `${run.code}, ${run.name}, ${metres(run.length)}, ${n} units`,
        onClick: () => { if (renaming === run.id) return; C.select(run.id); }, onDblclick: () => C.focusRun(run.id) },
      h('span', { class: 'crun__icon' }, icon(k.icon, { size: 18 })),
      h('span', { class: 'crun__code num' }, run.code)),
      h('span', { class: 'crun__body' }, nameEl,
        h('span', { class: 'crun__meta num' }, `${k.label} · ${metres(run.length)} · ${n} ${n === 1 ? 'unit' : 'units'}`)),
      badge,
      h('span', { class: 'crun__acts' },
        iconBtn('note', 'Rename', { size: 16, onClick: () => { renaming = run.id; render(); } }),
        iconBtn('fit', 'Fit to its length (fillers)', { size: 16, kbd: 'F', onClick: () => C.fit(run.id, 'fillers') }),
        iconBtn('duplicate', 'Duplicate run', { size: 16, onClick: () => C.duplicateRun(run.id) }),
        iconBtn('trash', 'Remove run…', { size: 16, variant: 'danger', onClick: () => C.removeRun(run.id) })));
  }

  function renderList(sel) {
    const runs = Carp.listRuns();
    const groups = new Map();
    for (const r of runs) { const key = r.roomId || 'other'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
    return h('div', { class: 'cruns' }, [...groups.entries()].map(([roomId, list]) => h('section', { class: 'cruns__group' },
      h('h3', { class: 'cruns__room' }, roomName(plan, roomId), h('span', { class: 'num faint' }, String(list.length))),
      h('ul', { class: 'cruns__list' }, list.map((r) => runRow(r, sel && sel.runId === r.id))))));
  }

  /* ───────── module palette ───────── */
  function renderPalette(run) {
    const mods = Carp.modulesFor(run.kind).filter((m) => m.id !== 'wall-void' || run.kind !== 'island');
    const byLevel = new Map();
    for (const m of mods) {
      const lvl = m.level;
      if (!byLevel.has(lvl)) byLevel.set(lvl, []);
      byLevel.get(lvl).push(m);
    }
    const groups = LEVEL_GROUPS.filter((g) => byLevel.has(g.id));
    return h('section', { class: 'cpal', 'aria-label': `Units for ${run.code}` },
      h('header', { class: 'cpal__head' }, h('h3', { class: 'sec__title' }, `Add to ${run.code}`), h('span', { class: 'sec__note' }, 'Click to add · drag into the drawing')),
      groups.map((g) => h('div', { class: 'cpal__group' },
        h('h4', { class: 'cpal__level' }, g.label),
        h('div', { class: 'cpal__grid' }, byLevel.get(g.id).map((m) => tile(run, m))))));
  }
  function tile(run, m) {
    const range = m.w.min === m.w.max ? `${num(m.w.std)} cm` : `${num(m.w.min)}–${num(m.w.max)}, std ${num(m.w.std)}`;
    const t = h('button', { type: 'button', class: 'cmod', draggable: 'true', 'data-tip': `${m.name.en} · ${range} cm`, 'aria-label': `Add ${m.name.en}, standard width ${num(m.w.std)} cm`,
      onClick: () => {
        const opts = m.level === 'any' ? { level: run.kind === 'island' ? 'island' : (run.levels.includes('base') ? 'base' : run.levels[0]) } : {};
        const id = C.addUnit(run.id, m.id, opts);
        if (id) app.toast(`${m.name.en} added to ${run.code}`, { action: { label: 'Undo', fn: () => store.undo() } });
      },
      onDragstart: (e) => { e.dataTransfer.setData(DND_MODULE, m.id); e.dataTransfer.setData('text/plain', m.name.en); e.dataTransfer.effectAllowed = 'copy'; C.emit('palette-drag', { module: m.id }); },
      onDragend: () => C.emit('palette-drag', null) });
    t.innerHTML = moduleGlyph(m.id);
    t.append(h('span', { class: 'cmod__name' }, shortName(m)), h('span', { class: 'cmod__w num' }, m.w.min === m.w.max ? `${num(m.w.std)}` : `${num(m.w.std)}`));
    return t;
  }

  /* ───────── render ───────── */
  function render() {
    const runs = Carp.listRuns();
    const cur = C.current();
    const focusKey = el.contains(document.activeElement) && document.activeElement.classList.contains('crun__rename');
    if (!runs.length) { setKids(body, renderEmpty()); return; }
    setKids(body,
      renderList(store.ui.carpentrySel),
      cur ? renderPalette(cur.run) : h('p', { class: 'cpanel__hint' }, 'Select a run to add units to it.'),
      h('ul', { class: 'guide__notes' },
        h('li', null, kbd('←'), kbd('→'), ' select units, ', kbd('Alt'), ' + arrows move them, ', kbd('+'), kbd('−'), ' change the width by 5 cm.'),
        h('li', null, kbd('F'), ' fits the run, ', kbd('Delete'), ' removes the unit, ', kbd('Esc'), ' steps back.')),
      btn('Back to furnishing', { block: true, icon: 'sofa', tip: 'Leave Carpentry mode', kbd: 'C', onClick: () => C.exit() }));
    if (renaming || focusKey) body.querySelector('.crun__rename')?.focus();
    const selRow = body.querySelector('.crun.is-selected');
    if (selRow && store.ui.carpentrySel && lastSel !== store.ui.carpentrySel.runId) selRow.scrollIntoView({ block: 'nearest' });
    lastSel = store.ui.carpentrySel ? store.ui.carpentrySel.runId : null;
  }
  let lastSel = null;
  const schedule = rafThrottle(() => { if (C.isActive()) render(); else dirty = true; });
  let dirty = true;
  store.on('carpentry', (e) => { if (!e || !e.transient) schedule(); });
  store.on('history', schedule);
  store.on('load', schedule);
  store.on('ui', (e) => {
    if (e.keys.includes('carpentrySel')) schedule();
    if (e.keys.includes('tool') && C.isActive() && dirty) { dirty = false; render(); }
  });
  render();
  return el;
}

/** Short module names for the palette tiles. */
function shortName(m) {
  const S = {
    'base-door': 'Doors', 'base-drawers': 'Drawers', 'base-sink': 'Sink', 'base-hob': 'Hob', 'base-oven': 'Oven', 'base-dishwasher': 'Dishwasher',
    'base-pullout': 'Pull-out', 'base-bin': 'Bins', 'base-corner-blind': 'Blind corner', 'base-corner-carousel': 'Carousel', 'base-open': 'Open', 'base-space': 'Appliance space',
    'wall-door': 'Doors', 'wall-liftup': 'Lift-up', 'wall-glass': 'Glass', 'wall-open': 'Open box', 'wall-hood': 'Hood', 'wall-microwave': 'Microwave', 'wall-corner': 'Corner', 'wall-void': 'Free wall',
    'tall-pantry': 'Pantry', 'tall-oven': 'Oven tower', 'tall-fridge': 'Fridge', 'tall-fridge-niche': 'Fridge niche', 'tall-utility': 'Broom',
    island: 'Island', 'wardrobe-hinged': 'Hinged', 'wardrobe-sliding': 'Sliding', 'laundry-tower': 'Laundry', 'entry-closet': 'Shoes / coats', bookcase: 'Bookcase',
    vanity: 'Vanity', 'media-low': 'Low unit', 'media-shelf': 'Shelf', 'media-panel': 'TV panel', 'entry-bench': 'Bench', shelf: 'Shelf', desk: 'Desk', custom: 'Custom',
    filler: 'Filler', panel: 'End panel',
  };
  return S[m.id] || m.name.en;
}
