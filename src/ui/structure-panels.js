/**
 * Structure panels that are not the inspector: the guide that replaces the catalogue in Structure mode, the
 * "changes to the architect's plan" list (Rooms tab, Checks tab, inspector, top-bar chip) and the top-bar chip itself.
 */
import { h, setKids } from './dom.js';
import { icon } from './icons.js';
import { btn, iconBtn, section, kbd, segmented } from './components.js';
import { openPopover } from './dialogs.js';
import { LEVELS, LEVEL_ORDER, levelTag, basePlanName } from './structure.js';
import { phaseCard } from './projects.js';
import { underlayCard } from './import/underlay-panel.js';
import { planPhase, BASE_PLAN } from '../core/plan-edit.js';
import { levelName } from '../core/levels.js';
import { FEATURES } from '../core/features.js';

/** Structure tools: value = store.ui.tool. Shared by the top bar and the guide so the two can never drift apart. */
export const STRUCTURE_TOOL_LIST = [
  { value: 'structure', label: 'Select', long: 'Select walls and openings', icon: 'select', kbd: 'V', how: 'Click a wall, door or window to see what you may do with it. Drag it to move it.' },
  { value: 'wall', label: 'Draw wall', long: 'Draw a partition wall', icon: 'wall-add', kbd: 'W', how: 'Drag from one wall to another. New walls are partitions, 7 to 20 cm thick.' },
  { value: 'door', label: 'Door', long: 'Place a door', icon: 'door', kbd: 'D', how: 'Click a wall. Flip the hinge and swing in the Inspector.' },
  { value: 'window', label: 'Window', long: 'Place a window', icon: 'window', kbd: 'N', how: 'Click an exterior wall. Every new window needs a permit.' },
  { value: 'passage', label: 'Passage', long: 'Place an open passage', icon: 'passage', kbd: 'P', how: 'Click an interior wall for a doorway without a door.' },
  // several floors only (FEATURES.levels): the entry carries `levelsOnly` and its controls the class .levels-only
  { value: 'stairs', label: 'Stairs', long: 'Place a stair to the floor above', icon: 'stairs', kbd: 'T', levelsOnly: true, how: 'Pick a shape, then click to place it. The opening in the floor above is made for you.' },
];
/** Stair shapes offered by the Stairs tool (store.ui.stairShape / stairTurn / stairRot). */
export const STAIR_SHAPE_OPTIONS = [
  { value: 'straight', label: 'Straight', tip: 'Straight flight' },
  { value: 'L', label: 'L', tip: 'L-shaped: a quarter landing' },
  { value: 'U', label: 'U', tip: 'U-shaped: a half landing' },
];
export const STAIR_TURN_OPTIONS = [{ value: 'left', label: 'Left', tip: 'The second flight turns left' }, { value: 'right', label: 'Right', tip: 'The second flight turns right' }];

/**
 * The Stairs tool's options (shape, turn, a quarter turn of the ghost) — one control shared by the top bar and the guide.
 * @returns {HTMLElement & { sync(): void }}
 */
export function stairOptions(app, { compact = false } = {}) {
  const { store } = app;
  const shape = segmented({ options: STAIR_SHAPE_OPTIONS, value: store.ui.stairShape || 'straight', label: 'Stair shape', cls: 'seg--stair',
    onChange: (v) => { store.setUI({ stairShape: v }); app.structure.setTool('stairs'); } });
  const turn = segmented({ options: STAIR_TURN_OPTIONS, value: store.ui.stairTurn || 'right', label: 'Turn of the stair', cls: 'seg--stair',
    onChange: (v) => { store.setUI({ stairTurn: v }); app.structure.setTool('stairs'); } });
  const rot = iconBtn('rotate-cw', 'Turn the stair a quarter', { kbd: 'R', onClick: () => { store.setUI({ stairRot: ((Number(store.ui.stairRot) || 0) + 90) % 360 }); app.structure.setTool('stairs'); } });
  const turnWrap = h('span', { class: 'stairopts__turn' }, turn);
  const el = h('div', { class: `stairopts${compact ? ' stairopts--compact' : ''} levels-only`, role: 'group', 'aria-label': 'Stair to place' }, icon('stairs', { size: 16 }), shape, turnWrap, rot);
  el.sync = () => { shape.set(store.ui.stairShape || 'straight'); turn.set(store.ui.stairTurn || 'right'); turnWrap.hidden = (store.ui.stairShape || 'straight') === 'straight'; };
  store.on('ui', (e) => { if (e.keys.some((k) => /^stair/.test(k))) el.sync(); });
  el.sync();
  return el;
}

/** Highest level among diff items: 'free' < 'warn' < 'permit'. */
export const topLevel = (items) => items.reduce((top, it) => (LEVEL_ORDER.indexOf(it.level) > LEVEL_ORDER.indexOf(top) ? it.level : top), 'free');

/** "1 needs a permit · 1 to check with your engineer" — only the levels that need someone else. */
function attention(items) {
  const n = (level) => items.filter((it) => it.level === level).length;
  const permit = n('permit'), warn = n('warn');
  return [permit && `${permit} ${permit === 1 ? 'needs' : 'need'} a permit`, warn && `${warn} to check with your engineer`].filter(Boolean).join(' · ');
}

/**
 * The guide shown in the left sidebar while in Structure mode: the four levels as a legend, then the tools.
 * @param {HTMLElement} root  the left sidebar  @param {object} app
 */
export function initStructureGuide(root, app) {
  const { store, structure } = app;
  const toolRows = new Map();
  // several floors: which floor the tools work on (only while the levels feature is on)
  const floorNote = app.levels ? h('p', { class: 'guide__floor levels-only' }) : null;
  if (floorNote) {
    const paint = () => setKids(floorNote, icon('levels', { size: 14 }), h('span', null, `Editing ${app.levels.name(app.levels.current())}. `), kbd('PgUp'), ' ', kbd('PgDn'), h('span', null, ' switch floors.'));
    app.levels.onChange(paint); paint();
  }
  const legend = h('ul', { class: 'guide__levels', 'aria-label': 'What may be changed' }, LEVEL_ORDER.map((id) => h('li', { class: `glevel glevel--${id}` },
    h('span', { class: 'glevel__icon' }, icon(LEVELS[id].icon, { size: 16 })),
    h('div', { class: 'glevel__body' }, h('p', { class: 'glevel__label' }, LEVELS[id].label), h('p', { class: 'glevel__what' }, LEVELS[id].what), h('p', { class: 'glevel__text' }, LEVELS[id].text)))));
  const tools = h('ul', { class: 'guide__tools' }, STRUCTURE_TOOL_LIST.map((t) => {
    const row = h('button', { type: 'button', class: 'gtool', 'aria-pressed': 'false', onClick: () => { structure.setTool(t.value); if (app.isCompact()) app.closePanels(); } },
      h('span', { class: 'gtool__icon' }, icon(t.icon, { size: 18 })),
      h('span', { class: 'gtool__body' }, h('span', { class: 'gtool__name' }, t.label), h('span', { class: 'gtool__how' }, t.how)),
      kbd(t.kbd));
    toolRows.set(t.value, row);
    return h('li', t.levelsOnly ? { class: 'levels-only' } : null, row);
  }));
  // Stairs (several floors): the shape to place, and — when the floor shown is the top one — the way to add a floor above
  const stairNote = h('p', { class: 'guide__stairnote sec__note' });
  const addAbove = app.levels ? btn('Add floor above…', { small: true, icon: 'levels', onClick: () => app.levels.openAdd() }) : null;
  const stairBox = h('div', { class: 'guide__stairs levels-only', hidden: true }, stairOptions(app), stairNote, addAbove);
  const paintStairs = () => {
    const on = store.ui.tool === 'stairs', above = structure.floorAbove();
    stairBox.hidden = !on;
    stairNote.textContent = above ? 'Click in a room to place the stair. R turns it a quarter; Shift keeps the tool. Green: it fits — red: the reason is shown.'
      : 'A stair needs a floor above the one shown. Add a floor, then place the stair on this one.';
    if (addAbove) addAbove.hidden = !!above;
  };
  store.on('ui', (e) => { if (e.keys.includes('tool') || e.keys.includes('level')) paintStairs(); });
  store.on('plan', (e) => { if (!e || !e.transient) paintStairs(); });
  paintStairs();
  const el = h('div', { class: 'guide', 'aria-label': 'Structure guide' },
    h('header', { class: 'side__head' }, h('h2', { class: 'cat__title display truncate' }, 'Structure'),
      iconBtn('panel-left', 'Hide this guide', { onClick: () => app.setPanelOpen('left', false) })),
    h('div', { class: 'guide__body' },
      app.projects ? phaseCard(app) : null,
      underlayCard(app),
      h('p', { class: 'guide__lead' }, 'Change the walls, doors and windows of your house, within what is allowed. Every wall and opening is one of four levels.'),
      floorNote,
      legend,
      section('Tools', tools, stairBox),
      h('ul', { class: 'guide__notes' },
        h('li', null, kbd('Delete'), ' removes the selected wall or opening. ', kbd('Esc'), ' puts the tool down, then leaves Structure.'),
        h('li', { class: 'levels-only' }, 'A stair is drawn on the floor it starts from; its opening shows dashed on the floor above. Drag a stair to move it (it snaps flush to walls), its round grip turns it, the side grip sets its width.'),
        h('li', null, 'Every edit snaps to 5 cm and can be undone. Furniture is not moved for you: look at the rooms after changing a wall.')),
      btn('Back to furnishing', { block: true, icon: 'sofa', tip: 'Leave Structure mode', kbd: 'B', onClick: () => structure.exit() })));
  root.append(el);

  const sync = () => { for (const [tool, row] of toolRows) row.setAttribute('aria-pressed', String(store.ui.tool === tool)); };
  store.on('ui', (e) => { if (e.keys.includes('tool')) sync(); });
  sync();
  return el;
}

/**
 * The rows of the changes list (level badge + sentence); a click shows the change on the plan (on its floor). On a
 * plan with several floors every entry carries `levelId`: the list is grouped by floor, ground floor first.
 */
function changeRows(app, items, onPick) {
  const row = (it) => h('li', null,
    h('button', { type: 'button', class: `change change--${it.level}`, 'data-tip': 'Show on the plan', 'data-tip-side': 'left',
      onClick: () => { onPick && onPick(); app.structure.focusChange(it); } },
    h('span', { class: 'change__text' }, it.text), levelTag(it.level)));
  if (!items.some((it) => it.levelId)) return h('ul', { class: 'changes' }, items.map(row));
  const groups = new Map();
  for (const it of items) { const k = it.levelId || 'L0'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  const rank = (id) => parseInt(String(id).slice(1), 10) || 0;
  const floorName = (id) => levelName(app.plan, id) || levelName(BASE_PLAN, id) || id;
  return h('div', { class: 'changes__floors' }, [...groups.keys()].sort((a, b) => rank(a) - rank(b)).map((id) => [
    h('p', { class: 'changes__floor' }, floorName(id)),
    h('ul', { class: 'changes', 'aria-label': `Changes on ${floorName(id)}` }, groups.get(id).map(row))]));
}

/**
 * "Changes to the architect's plan": count, list, reset. Call `.refresh()` after the plan changed.
 * @param {object} app
 * @param {{ title?: string, quietWhenEmpty?: boolean }} [opts]  quietWhenEmpty: hide the section while nothing changed
 * @returns {HTMLElement & { refresh(): void }}
 */
export function changesSection(app, opts = {}) {
  const { structure } = app;
  const count = h('span', { class: 'sec__note num' });
  const body = h('div', { class: 'changes__body' });
  const el = section(opts.title || `Changes to ${basePlanName()}`, { aside: count, class: 'changes-sec' }, body);
  el.refresh = () => {
    const title = !opts.title && el.querySelector('.sec__title');
    if (title && title.firstChild && title.firstChild.nodeType === 3) title.firstChild.textContent = planPhase() === 'draft' ? 'Changes to the plan' : `Changes to ${basePlanName()}`;
    const items = structure.diff().items;
    const modified = structure.isModified();
    el.hidden = !!opts.quietWhenEmpty && !modified;
    count.textContent = modified ? `${items.length} ${items.length === 1 ? 'change' : 'changes'}` : '';
    if (!modified) {
      setKids(body, h('p', { class: 'sec__empty' }, planPhase() === 'draft' ? 'Not tracked while the plan is a draft — everything you draw is the house as it is.' : `None. The walls, doors and windows are exactly as on ${basePlanName()}.`),
        structure.isActive() ? null : btn('Change walls and openings', { small: true, icon: 'wall', kbd: 'B', onClick: () => structure.enter() }));
      return;
    }
    const note = attention(items);
    setKids(body,
      note ? h('p', { class: 'changes__note' }, note) : null,
      items.length ? changeRows(app, items) : h('p', { class: 'sec__empty' }, 'Rooms were renamed; the walls and openings are unchanged.'),
      h('div', { class: 'changes__foot' }, btn(`Reset to ${basePlanName()}`, { small: true, icon: 'reset', onClick: () => structure.reset() })));
  };
  el.refresh();
  return el;
}

/**
 * Top-bar chip "Plan modified · n changes": shown whenever the plan differs from the architect's; opens the list.
 * @returns {HTMLElement & { refresh(): void }}
 */
export function planChip(app) {
  const { structure } = app;
  const dot = h('span', { class: 'planchip__dot', 'aria-hidden': 'true' });
  const label = h('span', { class: 'planchip__label' }, 'Plan modified');
  const count = h('span', { class: 'planchip__count num' });
  const el = h('button', { type: 'button', class: 'planchip', hidden: true, 'aria-haspopup': 'dialog', 'data-tip': 'Changes to the plan', onClick: open }, dot, label, count);
  function open() {
    const items = structure.diff().items;
    const note = attention(items);
    const pop = openPopover(el, h('div', { class: 'changes-pop' },
      h('p', { class: 'fopts__title' }, `Changes to ${basePlanName()}`, h('span', { class: 'num faint' }, String(items.length))),
      note ? h('p', { class: 'changes__note' }, note) : null,
      items.length ? changeRows(app, items, () => pop.close(false)) : h('p', { class: 'sec__empty' }, 'Rooms were renamed; the walls and openings are unchanged.'),
      h('div', { class: 'changes__foot' }, btn(`Reset to ${basePlanName()}`, { small: true, icon: 'reset', onClick: () => { pop.close(); structure.reset(); } }))),
    { cls: 'popover--panel popover--changes', placement: 'bottom-end', label: 'Changes to the architect’s plan' });
  }
  el.refresh = () => {
    const modified = structure.isModified();
    el.hidden = !modified;
    if (!modified) return;
    const items = structure.diff().items;
    el.dataset.level = topLevel(items);
    count.textContent = `${items.length} ${items.length === 1 ? 'change' : 'changes'}`;
    el.setAttribute('aria-label', `Plan modified, ${count.textContent}. Show the list`);
  };
  el.refresh();
  return el;
}
