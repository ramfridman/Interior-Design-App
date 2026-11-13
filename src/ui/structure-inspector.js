/**
 * Inspector content in Structure mode: the selected wall segment or opening (`store.ui.structureSel`), what the owner
 * may do with it (level banner) and the actions — all carried out by core/plan-edit.js. A refusal from the engine
 * is shown next to the control that asked; warnings become level toasts (structure.report).
 *
 * While a wall or opening is dragged in the plan, or nudged from here, the panel is patched in place (same "shape"
 * → only the numbers change), so nothing jumps and a focused field keeps its focus.
 */
import { flipDoor, updateOpening, openingPolicy } from '../core/plan-edit.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { btn, iconBtn, numField, section, emptyState } from './components.js';
import { fmtLen, toUnit, fromUnit, unitDigits } from './format.js';
import { STEP, levelBanner, levelTag, spaceName, segmentSides, segmentTitle, openingTitle, openingKind, openingIcon, openingOffset } from './structure.js';
import { changesSection } from './structure-panels.js';

const SIDE = { n: 'north', s: 'south', e: 'east', w: 'west' };
const STYLE_OPTIONS = {
  door: [['interior', 'Interior door'], ['entry', 'Entrance door'], ['service', 'Service door']],
  window: [['sliding', 'Sliding'], ['tilt', 'Tilt']],
};
const dims = (o) => `${o.width} × ${o.height} cm`;

/** @param {object} app  @returns {{ render(): Node[], sync(): boolean }} */
export function createStructureInspector(app) {
  const { store, plan, structure } = app;
  let shape = '';        // what the rendered DOM can show without a rebuild
  let patch = null;      // (cur) => void — updates the live values of the rendered DOM

  const units = () => store.ui.units;
  const errorLine = () => h('p', { class: 'form__error', role: 'alert', hidden: true });
  const show = (line, text) => { line.textContent = text || ''; line.hidden = !text; };
  /** Run an engine call and put its refusal (if any) on `line`. */
  const run = (line, fn) => { const refusal = structure.report(fn()); show(line, refusal); return !refusal; };

  const shapeOf = (cur) => {
    if (!cur) return `none|${structure.isModified()}`;
    if (cur.type === 'segment') { const s = cur.seg; return ['seg', s.axis, s.cls, s.thickness, s.policy.level, s.isNew, s.openingIds.join(','), units()].join('|'); }
    const o = cur.opening;
    return ['op', o.id, o.kind, o.style, o.axis, cur.policy.level, cur.seg ? cur.seg.cls : '', units()].join('|');
  };

  /* ───────── Nothing selected ───────── */
  function renderNothing() {
    const changes = changesSection(app);
    patch = () => changes.refresh();
    return [
      emptyState({ icon: 'wall', title: 'Select a wall, door or window', text: 'Click one in the plan to see what you may change, or pick a tool in the top bar to add a wall or an opening.' }),
      changes,
    ];
  }

  /* ───────── Head shared by walls and openings ───────── */
  const head = (level, glyph, title, meta, tag) => h('div', { class: 'insp__head sinsp__head' },
    h('div', { class: `sinsp__tile sinsp__tile--${level}` }, icon(glyph, { size: 26 })),
    h('div', { class: 'insp__id' }, h('h3', { class: 'sinsp__title display' }, title, tag), meta));

  /* ───────── Wall segment ───────── */
  function renderSegment(seg) {
    const locked = seg.policy.level === 'locked';
    const vertical = seg.axis === 'v';     // runs north–south → moves east / west
    const u = units();
    const live = () => { const cur = structure.selected(); return cur && cur.type === 'segment' ? cur.seg : seg; };
    const pos = (s) => (vertical ? s.core.x : s.core.y);
    const meta = h('p', { class: 'insp__meta' });
    const length = h('dd', { class: 'num' });
    const sides = h('dd');
    const moveError = errorLine(), removeError = errorLine();
    const move = (delta) => run(moveError, () => structure.moveSegment(live(), delta));
    const field = numField({
      label: vertical ? 'X' : 'Y', value: toUnit(pos(seg), u), digits: unitDigits(u), step: u === 'cm' ? STEP : STEP / 100, suffix: u, disabled: locked,
      title: vertical ? 'Position of the wall’s west face, from the house west face' : 'Position of the wall’s north face, from the house north face',
      onCommit: (v) => { const s = live(); if (!move(Math.round(fromUnit(v, u) - pos(s)))) field.set(toUnit(pos(s), u)); },
    });
    const nudge = (dir) => iconBtn(vertical ? (dir < 0 ? 'chevron-left' : 'chevron-right') : (dir < 0 ? 'chevron-up' : 'chevron-down'),
      `Move ${STEP} cm ${vertical ? (dir < 0 ? 'west' : 'east') : (dir < 0 ? 'north' : 'south')}`, { variant: 'outlined', disabled: locked, kbd: vertical ? (dir < 0 ? '←' : '→') : (dir < 0 ? '↑' : '↓'), onClick: () => move(dir * STEP) });
    const openings = seg.openingIds.map((id) => plan.openings.find((o) => o.id === id)).filter(Boolean);

    patch = (cur) => {
      const s = cur.seg;
      meta.textContent = `${fmtLen(s.length, units())} long, ${s.thickness} cm thick`;
      length.textContent = fmtLen(s.length, units());
      sides.textContent = segmentSides(s, plan);
      field.set(toUnit(pos(s), units()));
    };
    return [
      head(seg.policy.level, 'wall', segmentTitle(seg), meta, seg.isNew ? h('span', { class: 'tag tag--new' }, 'Added by you') : null),
      levelBanner(seg.policy.level, seg.policy.reason),
      h('div', { class: 'insp__actions' }, h('div', { class: 'actrow', role: 'group', 'aria-label': 'Wall actions' },
        iconBtn('target', 'Show on the plan', { variant: 'outlined', onClick: () => { const s = live(); structure.focusPoint({ x: s.x + s.w / 2, y: s.y + s.h / 2 }); } }),
        iconBtn('trash', 'Remove wall', { kbd: 'Delete', variant: 'danger', disabled: locked,
          onClick: async () => { const res = await structure.removeSegment(live(), { quiet: true }); show(removeError, res.ok || res.cancelled ? '' : res.reason); } })),
      removeError),
      section('Wall', h('dl', { class: 'facts facts--wide' },
        h('dt', null, 'Length'), length,
        h('dt', null, 'Thickness'), h('dd', { class: 'num' }, `${seg.thickness} cm`),
        h('dt', null, 'Where'), sides,
        h('dt', null, 'Drawn by'), h('dd', null, seg.isNew ? 'You' : 'The architect'))),
      section('Move', { aside: h('span', { class: 'sec__note' }, locked ? 'Locked' : vertical ? 'East or west' : 'North or south') },
        h('div', { class: 'moverow' }, nudge(-1), field, nudge(1)),
        locked ? null : h('p', { class: 'sec__note' }, `Sideways in ${STEP} cm steps. Doors in the wall travel with it; walls that meet it follow.`),
        moveError),
      section(openings.length ? 'Openings in this wall' : 'Openings', openings.length
        ? h('ul', { class: 'oplist' }, openings.map((o) => h('li', null, h('button', { type: 'button', class: 'oprow', onClick: () => structure.select('opening', o.id) },
          h('span', { class: 'oprow__icon' }, icon(openingIcon(o), { size: 18 })),
          h('span', { class: 'oprow__text' }, h('span', { class: 'oprow__name truncate' }, openingTitle(o)), h('span', { class: 'oprow__meta num' }, dims(o))),
          levelTag(openingPolicy(o.id).level), icon('chevron-right', { size: 14 })))))
        : h('p', { class: 'sec__empty' }, seg.cls === 'exterior' ? 'None. Use the Door or Window tool to add one (permit needed).' : locked ? 'None.' : 'None. Use the Door or Passage tool to add one.')),
    ];
  }

  /* ───────── Opening ───────── */
  function renderOpening(cur) {
    const o = cur.opening, seg = cur.seg, level = cur.policy.level, locked = level === 'locked';
    const horizontal = o.axis === 'h';     // wall runs east–west
    const live = () => { const now = structure.selected(); return now && now.type === 'opening' ? now : cur; };
    const sizeError = errorLine(), hangError = errorLine(), removeError = errorLine();
    const meta = h('p', { class: 'insp__meta' });
    const hung = h('p', { class: 'sec__note sinsp__hung' });
    const cmField = (label, key, title) => numField({
      label, value: o[key], digits: 0, step: STEP, suffix: 'cm', disabled: locked, title,
      onCommit: (v) => { if (!run(sizeError, () => updateOpening(o.id, { [key]: v }))) fields[key].set(live().opening[key]); },
    });
    const fields = {
      width: cmField('Width', 'width', 'Clear width of the opening'),
      height: cmField('Height', 'height', 'Height of the opening'),
      sill: o.kind === 'window' ? cmField('Sill', 'sill', 'Height of the sill above the floor') : null,
      offset: numField({
        label: horizontal ? 'From west end' : 'From north end', value: openingOffset(o, seg), digits: 0, step: STEP, suffix: 'cm', disabled: locked || !seg,
        title: `Distance from the ${horizontal ? 'west' : 'north'} end of the wall to the opening`,
        onCommit: (v) => { if (!run(sizeError, () => updateOpening(o.id, { offset: v }))) { const now = live(); fields.offset.set(openingOffset(now.opening, now.seg)); } },
      }),
    };
    const styles = STYLE_OPTIONS[o.kind];
    const style = styles && !locked && styles.some(([v]) => v === o.style)
      ? h('select', { class: 'select', 'data-fk': 'style', 'aria-label': `${openingKind(o)} style`, onChange: () => { if (!run(hangError, () => updateOpening(o.id, { style: style.value }))) style.value = live().opening.style; } },
        styles.map(([v, l]) => h('option', { value: v, selected: v === o.style }, l)))
      : null;
    const flip = (how, label, glyph) => btn(label, { small: true, icon: glyph, disabled: locked, onClick: () => run(hangError, () => flipDoor(o.id, how)) });
    const into = (now) => {
      const side = now.opening.swing;
      const [a, b] = now.seg ? now.seg.between : now.opening.rooms || [];
      return spaceName(side === 'n' || side === 'w' ? a : b, plan);
    };

    patch = (now) => {
      const x = now.opening;
      meta.textContent = [x.rooms && x.rooms.length === 2 ? `${spaceName(x.rooms[0], plan)} / ${spaceName(x.rooms[1], plan)}` : '', dims(x)].filter(Boolean).join(', ');
      fields.width.set(x.width); fields.height.set(x.height); fields.sill && fields.sill.set(x.sill);
      fields.offset.set(openingOffset(x, now.seg));
      if (x.kind === 'door' && x.hinge && x.swing) hung.textContent = `Hinged on the ${SIDE[x.hinge]} jamb, opens into ${into(now)}.`;
    };

    const doorway = o.innerDoor
      ? section('Doors in this doorway', h('ul', { class: 'lockfacts' },
        h('li', null, icon('lock', { size: 14 }), h('span', null, h('strong', null, 'Blast door'), ` — steel, ${dims(o)}, opens out into ${into(cur)}`)),
        h('li', null, icon('lock', { size: 14 }), h('span', null, h('strong', null, 'Inner door'), ` — ${o.innerDoor.width} × ${o.innerDoor.height} cm, opens into the safe room`))))
      : null;
    const hang = o.kind === 'door' && !o.innerDoor
      ? section('Hanging', hung,
        h('div', { class: 'grid2 sinsp__flips' }, flip('hinge', 'Flip hinge side', horizontal ? 'flip-h' : 'flip-v'), flip('swing', 'Flip swing', horizontal ? 'flip-v' : 'flip-h')),
        style ? h('label', { class: 'setrow sinsp__style' }, h('span', { class: 'setrow__label' }, 'Style'), style) : null,
        hangError)
      : style ? section('Style', h('label', { class: 'setrow sinsp__style' }, h('span', { class: 'setrow__label' }, 'Opens by'), style), hangError) : null;

    return [
      head(level, openingIcon(o), openingTitle(o), meta),
      levelBanner(level, cur.policy.reason || 'Move, resize, re-hang or remove it as you like.'),
      h('div', { class: 'insp__actions' }, h('div', { class: 'actrow', role: 'group', 'aria-label': 'Opening actions' },
        iconBtn('target', 'Show on the plan', { variant: 'outlined', onClick: () => { const x = live().opening; structure.focusPoint({ x: x.x + x.w / 2, y: x.y + x.h / 2 }); } }),
        seg ? iconBtn('wall', `Select its wall (${segmentTitle(seg).toLowerCase()})`, { variant: 'outlined', onClick: () => { const now = live(); if (now.seg) structure.select('segment', now.seg.id); } }) : null,
        iconBtn('trash', `Remove ${openingKind(o).toLowerCase()}`, { kbd: 'Delete', variant: 'danger', disabled: locked,
          onClick: async () => { const res = await structure.removeOpening(live().opening, { quiet: true }); show(removeError, res.ok || res.cancelled ? '' : res.reason); } })),
      removeError),
      doorway,
      section('Size and position', { aside: locked ? h('span', { class: 'sec__note' }, 'Locked') : null },
        h('div', { class: fields.sill ? 'grid3' : 'grid2' }, fields.width, fields.height, fields.sill),
        fields.offset,
        o.assumed && o.assumed.length ? h('p', { class: 'sec__note' }, `Not written on the drawing: ${o.assumed.join(', ')}. Confirm with the architect.`) : null,
        sizeError),
      hang,
    ];
  }

  return {
    /** Build the panel for the current structure selection. */
    render() {
      const cur = structure.selected();
      shape = shapeOf(cur);
      patch = null;
      const nodes = !cur ? renderNothing() : cur.type === 'segment' ? renderSegment(cur.seg) : renderOpening(cur);
      if (patch && cur) patch(cur);
      return nodes;
    },
    /** Patch the rendered panel in place. Returns false when the selection needs a different panel (rebuild). */
    sync() {
      const cur = structure.selected();
      if (!patch || shapeOf(cur) !== shape) return false;
      patch(cur);
      return true;
    },
  };
}
