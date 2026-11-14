/**
 * Inspector content in Structure mode: the selected wall segment or opening (`store.ui.structureSel`), what the owner
 * may do with it (level banner) and the actions — all carried out by core/plan-edit.js. A refusal from the engine
 * is shown next to the control that asked; warnings become level toasts (structure.report).
 *
 * While a wall or opening is dragged in the plan, or nudged from here, the panel is patched in place (same "shape"
 * → only the numbers change), so nothing jumps and a focused field keeps its focus.
 */
import { flipDoor, updateOpening, openingPolicy, stairInfo, voidInfo } from '../core/plan-edit.js';
import { STAIR_LIMITS, checkStairs } from '../regulations/stairs.js';
import { levelName } from '../core/levels.js';
import { polygonArea, polygonBounds } from '../core/geometry.js';
import { segmented } from './components.js';
import { STAIR_SHAPE_OPTIONS, STAIR_TURN_OPTIONS } from './structure-panels.js';
import { viewPlan } from './levels.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { btn, iconBtn, numField, section, emptyState } from './components.js';
import { fmtLen, toUnit, fromUnit, unitDigits } from './format.js';
import { STEP, levelBanner, levelTag, spaceName, segmentSides, segmentTitle, openingTitle, openingKind, openingIcon, openingOffset, lengthAnchor,
  slantEnds, slantAngle, slantSideSpace, slantDoorWords } from './structure.js';
import { changesSection } from './structure-panels.js';

const SIDE = { n: 'north', s: 'south', e: 'east', w: 'west' };
const STYLE_OPTIONS = {
  door: [['interior', 'Interior door'], ['entry', 'Entrance door'], ['service', 'Service door']],
  window: [['sliding', 'Sliding'], ['tilt', 'Tilt']],
};
const dims = (o) => `${o.width} × ${o.height} cm`;

/** @param {object} app  @returns {{ render(): Node[], sync(): boolean }} */
export function createStructureInspector(app) {
  const { store, structure } = app;
  const plan = () => viewPlan(app);   // the floor shown
  let shape = '';        // what the rendered DOM can show without a rebuild
  let patch = null;      // (cur) => void — updates the live values of the rendered DOM

  const units = () => store.ui.units;
  /** Set a number field even while it has the focus (the engine may have snapped what was typed). */
  const force = (field, value, digits = 0) => { field.set(value); field.input.value = Number(value).toFixed(digits); };
  const errorLine = () => h('p', { class: 'form__error', role: 'alert', hidden: true });
  const show = (line, text) => { line.textContent = text || ''; line.hidden = !text; };
  /** Run an engine call and put its refusal (if any) on `line`. */
  const run = (line, fn) => { const refusal = structure.report(fn()); show(line, refusal); return !refusal; };

  const shapeOf = (cur) => {
    if (!cur) return `none|${structure.isModified()}`;
    if (cur.type === 'stair') return ['stair', cur.id, JSON.stringify(cur.info.data), cur.info.covers, cur.policy.level, units()].join('|');
    if (cur.type === 'void') return ['void', cur.id, JSON.stringify(cur.info.void), cur.info.covers, cur.policy.level, units()].join('|');
    if (cur.type === 'segment') {
      const s = cur.seg;
      // an angled wall: its end names change with its direction
      const ends = s.axis === 'a' ? Object.values(slantEnds(s)).join('/') : '';
      return ['seg', s.axis, s.id, s.cls, s.thickness, s.policy.level, s.isNew, s.openingIds.join(','), s.freeEnds.join(','), ends, units()].join('|');
    }
    const o = cur.opening;
    return ['op', o.id, o.kind, o.style, o.axis, cur.policy.level, cur.seg ? cur.seg.cls : '', o.axis === 'a' && cur.seg ? Object.values(slantEnds(cur.seg)).join('/') : '', units()].join('|');
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

  /* ───────── Angled wall (stage A3) ───────── */
  function renderSlant(seg) {
    const locked = seg.policy.level === 'locked';
    const u = units();
    const live = () => { const cur = structure.selected(); return cur && cur.type === 'segment' ? cur.seg : seg; };
    const names = slantEnds(seg);
    const meta = h('p', { class: 'insp__meta' });
    const length = h('dd', { class: 'num' }), angleOut = h('dd', { class: 'num' }), sides = h('dd');
    const moveError = errorLine(), removeError = errorLine(), lengthError = errorLine(), angleError = errorLine();
    const move = (delta) => run(moveError, () => structure.moveSegment(live(), delta));
    const [left, right] = [slantSideSpace(seg, 'l'), slantSideSpace(seg, 'r')];
    const towards = (side) => (left === right ? (side === 'l' ? `the ${names.a}-left side` : 'the other side') : spaceName(side === 'l' ? left : right, plan()));
    const nudge = (sg) => btn(`5 cm into ${towards(sg < 0 ? 'l' : 'r')}`, { small: true, icon: sg < 0 ? 'chevron-left' : 'chevron-right', disabled: locked,
      tip: `Move the wall ${STEP} cm across itself, towards ${towards(sg < 0 ? 'l' : 'r')}`, onClick: () => move(sg * STEP) });
    const anchor = lengthAnchor(seg);
    const lengthField = numField({
      label: null, value: toUnit(seg.length, u), digits: unitDigits(u) + 1, step: u === 'cm' ? STEP : STEP / 100, min: 0, suffix: u, disabled: locked,
      title: `Wall length; the ${anchor.fixedName} end stays where it is`,
      onCommit: (v) => { if (!run(lengthError, () => structure.resizeSegment(live(), fromUnit(v, u)))) force(lengthField, toUnit(live().length, u), unitDigits(u) + 1); },
    });
    // the angle: typed, it turns the wall about the end the owner keeps (its length stays)
    let keep = 'a';
    const keepCtl = segmented({ options: [{ value: 'a', label: `${names.a} end` }, { value: 'b', label: `${names.b} end` }], value: keep, label: 'End that stays', cls: 'seg--keep', onChange: (v) => { keep = v; } });
    const angleField = numField({
      label: 'Angle', value: slantAngle(seg), digits: 1, step: 1, min: -360, max: 360, suffix: '°', disabled: locked,
      title: 'Angle of the wall, counter-clockwise from east; typing one turns the wall about the end that stays',
      onCommit: (v) => {
        const s = live(), cur = slantAngle(s), dirNow = (360 - Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180 / Math.PI) % 360;
        // keep the wall's own direction (a → b): the typed line angle, on the side of 180° the wall already points to
        const want = ((dirNow - cur + v) % 360 + 360) % 360;
        if (!run(angleError, () => structure.rotateSegment(s, want, keep))) force(angleField, slantAngle(live()), 1);
      },
    });
    const openings = seg.openingIds.map((id) => plan().openings.find((o) => o.id === id)).filter(Boolean);
    patch = (cur) => {
      const s = cur.seg;
      meta.textContent = `Angled · ${fmtLen(s.length, units())} long, ${s.thickness} cm thick, ${slantAngle(s)}°`;
      length.textContent = fmtLen(s.length, units());
      angleOut.textContent = `${slantAngle(s)}° from east`;
      sides.textContent = segmentSides(s, plan());
      force(lengthField, toUnit(s.length, units()), unitDigits(units()) + 1);
      force(angleField, slantAngle(s), 1);
    };
    return [
      head(seg.policy.level, 'wall', segmentTitle(seg), meta, [h('span', { class: 'tag tag--angled' }, 'Angled'), seg.isNew ? h('span', { class: 'tag tag--new' }, 'Added by you') : null]),
      levelBanner(seg.policy.level, seg.policy.reason || 'Move, turn or remove this wall as you like, or put a door in it.'),
      h('div', { class: 'insp__actions' }, h('div', { class: 'actrow', role: 'group', 'aria-label': 'Wall actions' },
        iconBtn('target', 'Show on the plan', { variant: 'outlined', onClick: () => { const s = live(); structure.focusPoint({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 }); } }),
        iconBtn('trash', 'Remove wall', { kbd: 'Delete', variant: 'danger', disabled: locked,
          onClick: async () => { const res = await structure.removeSegment(live(), { quiet: true }); show(removeError, res.ok || res.cancelled ? '' : res.reason); } })),
      removeError),
      section('Wall', h('dl', { class: 'facts facts--wide' },
        h('dt', null, 'Length'), length,
        h('dt', null, 'Thickness'), h('dd', { class: 'num' }, `${seg.thickness} cm`),
        h('dt', null, 'Angle'), angleOut,
        h('dt', null, 'Separates'), sides,
        h('dt', null, 'Drawn by'), h('dd', null, seg.isNew ? 'You' : 'The architect'))),
      section('Move', { aside: h('span', { class: 'sec__note' }, locked ? 'Locked' : 'Across the wall') },
        h('div', { class: 'grid2 sinsp__slantmove' }, nudge(-1), nudge(1)),
        locked ? null : h('p', { class: 'sec__note' }, `In ${STEP} cm steps (arrow keys too). Doors in the wall travel with it; walls that meet it follow.`),
        moveError),
      section('Length', { aside: h('span', { class: 'sec__note' }, locked ? 'Locked' : `${anchor.movingName[0].toUpperCase()}${anchor.movingName.slice(1)} end moves`) },
        h('div', { class: 'moverow' }, lengthField),
        lengthError),
      section('Angle', { aside: h('span', { class: 'sec__note' }, locked ? 'Locked' : 'Counter-clockwise from east') },
        h('div', { class: 'moverow sinsp__angle' }, angleField),
        locked ? null : h('div', { class: 'sinsp__keep' }, h('span', { class: 'setrow__label' }, 'Keep in place'), keepCtl),
        locked ? null : h('p', { class: 'sec__note' }, 'Typing an angle turns the wall about the end you keep; its length stays. Near 0° or 90° it becomes a straight wall.'),
        angleError),
      section(openings.length ? 'Openings in this wall' : 'Openings', openings.length
        ? h('ul', { class: 'oplist' }, openings.map((o) => h('li', null, h('button', { type: 'button', class: 'oprow', onClick: () => structure.select('opening', o.id) },
          h('span', { class: 'oprow__icon' }, icon(openingIcon(o), { size: 18 })),
          h('span', { class: 'oprow__text' }, h('span', { class: 'oprow__name truncate' }, openingTitle(o)), h('span', { class: 'oprow__meta num' }, dims(o))),
          levelTag(openingPolicy(o.id).level), icon('chevron-right', { size: 14 })))))
        : h('p', { class: 'sec__empty' }, seg.cls === 'exterior' ? 'None. Use the Door or Window tool to add one (permit needed).' : locked ? 'None.' : 'None. Use the Door or Passage tool to add one.')),
    ];
  }

  /* ───────── Wall segment ───────── */
  function renderSegment(seg) {
    if (seg.axis === 'a') return renderSlant(seg);
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
      onCommit: (v) => { const s = live(); if (!move(Math.round(fromUnit(v, u) - pos(s)))) force(field, toUnit(pos(s), u), unitDigits(u)); },
    });
    // Length: one end moves (the free one, as with its grip; else the one away from the plan origin)
    const anchor = lengthAnchor(seg), lengthError = errorLine();
    const lengthField = numField({
      label: null, value: toUnit(seg.length, u), digits: unitDigits(u), step: u === 'cm' ? STEP : STEP / 100, min: 0, suffix: u, disabled: locked,
      title: `Wall length; the ${anchor.fixedName} end stays where it is`,
      onCommit: (v) => {
        const s = live();
        if (!run(lengthError, () => structure.resizeSegment(s, Math.round(fromUnit(v, u))))) force(lengthField, toUnit(live().length, u), unitDigits(u));
      },
    });
    const lengthHint = anchor.rule === 'free-end'
      ? `The joined ${anchor.fixedName} end stays; the free ${anchor.movingName} end moves, like dragging its grip. Steps of ${STEP} cm.`
      : `The ${anchor.fixedName} end (nearer the house’s north-west corner) stays; the ${anchor.movingName} end moves. Steps of ${STEP} cm.`;
    const nudge = (dir) => iconBtn(vertical ? (dir < 0 ? 'chevron-left' : 'chevron-right') : (dir < 0 ? 'chevron-up' : 'chevron-down'),
      `Move ${STEP} cm ${vertical ? (dir < 0 ? 'west' : 'east') : (dir < 0 ? 'north' : 'south')}`, { variant: 'outlined', disabled: locked, kbd: vertical ? (dir < 0 ? '←' : '→') : (dir < 0 ? '↑' : '↓'), onClick: () => move(dir * STEP) });
    const openings = seg.openingIds.map((id) => plan().openings.find((o) => o.id === id)).filter(Boolean);

    patch = (cur) => {
      const s = cur.seg;
      meta.textContent = `${fmtLen(s.length, units())} long, ${s.thickness} cm thick`;
      length.textContent = fmtLen(s.length, units());
      sides.textContent = segmentSides(s, plan());
      force(field, toUnit(pos(s), units()), unitDigits(units()));
      force(lengthField, toUnit(s.length, units()), unitDigits(units()));
    };
    return [
      head(seg.policy.level, 'wall', segmentTitle(seg), meta, seg.isNew ? h('span', { class: 'tag tag--new' }, 'Added by you') : null),
      levelBanner(seg.policy.level, seg.policy.reason || 'Move or remove this wall as you like, or put a door in it.'),
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
      section('Length', { aside: h('span', { class: 'sec__note' }, locked ? 'Locked' : `${anchor.movingName[0].toUpperCase()}${anchor.movingName.slice(1)} end moves`) },
        h('div', { class: 'moverow' }, lengthField),
        locked ? null : h('p', { class: 'sec__note' }, lengthHint),
        lengthError),
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
    const angled = o.axis === 'a' && !!seg, endsOf = angled ? slantEnds(seg) : null;
    const live = () => { const now = structure.selected(); return now && now.type === 'opening' ? now : cur; };
    const sizeError = errorLine(), hangError = errorLine(), removeError = errorLine();
    const meta = h('p', { class: 'insp__meta' });
    const hung = h('p', { class: 'sec__note sinsp__hung' });
    const cmField = (label, key, title) => numField({
      label, value: o[key], digits: 0, step: STEP, suffix: 'cm', disabled: locked, title,
      onCommit: (v) => { if (!run(sizeError, () => updateOpening(o.id, { [key]: v }))) force(fields[key], live().opening[key]); },
    });
    const fields = {
      width: cmField('Width', 'width', 'Clear width of the opening'),
      height: cmField('Height', 'height', 'Height of the opening'),
      sill: o.kind === 'window' ? cmField('Sill', 'sill', 'Height of the sill above the floor') : null,
      offset: angled ? numField({
        label: `From ${endsOf.a} end`, value: openingOffset(o, seg), digits: 1, step: STEP, suffix: 'cm', disabled: locked,
        title: `Distance along the wall from its ${endsOf.a} end to the opening`,
        onCommit: (v) => { const x = live().opening; if (!run(sizeError, () => updateOpening(o.id, { at: Math.round((v + x.width / 2) * 10) / 10 }))) { const now = live(); force(fields.offset, openingOffset(now.opening, now.seg), 1); } },
      }) : numField({
        label: horizontal ? 'From west end' : 'From north end', value: openingOffset(o, seg), digits: 0, step: STEP, suffix: 'cm', disabled: locked || !seg,
        title: `Distance from the ${horizontal ? 'west' : 'north'} end of the wall to the opening`,
        onCommit: (v) => { if (!run(sizeError, () => updateOpening(o.id, { offset: v }))) { const now = live(); force(fields.offset, openingOffset(now.opening, now.seg)); } },
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
      if (now.opening.axis === 'a' && now.seg) return spaceName(slantSideSpace(now.seg, side), plan());
      const [a, b] = now.seg ? now.seg.between : now.opening.rooms || [];
      return spaceName(side === 'n' || side === 'w' ? a : b, plan());
    };

    patch = (now) => {
      const x = now.opening;
      meta.textContent = now.seg ? segmentSides(now.seg, plan()) : x.rooms && x.rooms.length === 2 ? `Between ${spaceName(x.rooms[0], plan())} and ${spaceName(x.rooms[1], plan())}` : dims(x);
      force(fields.width, x.width); force(fields.height, x.height);
      if (fields.sill) force(fields.sill, x.sill);
      force(fields.offset, openingOffset(x, now.seg), x.axis === 'a' ? 1 : 0);
      if (x.kind === 'door' && x.hinge && x.swing) hung.textContent = x.axis === 'a' && now.seg ? slantDoorWords(x, now.seg, plan()) : `Hinged on the ${SIDE[x.hinge]} jamb, opens into ${into(now)}.`;
    };

    const doorway = o.innerDoor
      ? section('Doors in this doorway', h('ul', { class: 'lockfacts' },
        h('li', null, icon('lock', { size: 14 }), h('span', null, h('strong', null, 'Blast door'), ` — steel, ${dims(o)}, opens out into ${into(cur)}`)),
        h('li', null, icon('lock', { size: 14 }), h('span', null, h('strong', null, 'Inner door'), ` — ${o.innerDoor.width} × ${o.innerDoor.height} cm, opens into the safe room`))))
      : null;
    const hang = o.kind === 'door' && !o.innerDoor
      ? section('Hanging', hung,
        h('div', { class: 'grid2 sinsp__flips' }, flip('hinge', 'Flip hinge side', horizontal ? 'flip-h' : 'flip-v'), flip('swing', 'Flip swing direction', horizontal ? 'flip-v' : 'flip-h')),
        style ? h('label', { class: 'setrow sinsp__style' }, h('span', { class: 'setrow__label' }, 'Style'), style) : null,
        hangError)
      : style ? section('Style', h('label', { class: 'setrow sinsp__style' }, h('span', { class: 'setrow__label' }, 'Opens by'), style), hangError) : null;

    return [
      head(level, openingIcon(o), openingTitle(o), meta),
      levelBanner(level, cur.policy.reason || 'Move, resize, re-hang or remove it as you like.'),
      h('div', { class: 'insp__actions' }, h('div', { class: 'actrow', role: 'group', 'aria-label': 'Opening actions' },
        iconBtn('target', 'Show on the plan', { variant: 'outlined', onClick: () => { const x = live().opening; structure.focusPoint(x.axis === 'a' ? { x: x.cx, y: x.cy } : { x: x.x + x.w / 2, y: x.y + x.h / 2 }); } }),
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

  /* ───────── Stair (stage F4b) ───────── */
  const SHAPE_NAME = { straight: 'Straight stair', L: 'L-shaped stair', U: 'U-shaped stair' };
  const cm1 = (v) => `${(Math.round(v * 10) / 10).toString()} cm`;
  /** A rule line: the value and whether the sourced limit is met (numbers from regulations/stairs.js STAIR_LIMITS). */
  const ruleRow = (label, value, ok, need) => [h('dt', null, label), h('dd', { class: 'num sinsp__rule' }, value, ' ', h('span', { class: `tag tag--${ok ? 'pass' : 'fail'}` }, ok ? 'OK' : need))];
  function renderStair(cur) {
    const { info, policy } = cur, st = info.data, geo = info.geo, level = policy.level;
    const err = errorLine(), removeError = errorLine();
    const upd = (p) => run(err, () => structure.updateStair(cur.id, p));
    const from = levelName(app.plan, info.levelId) || info.levelId, to = info.to ? levelName(app.plan, info.to) || info.to : '—';
    const L = STAIR_LIMITS;
    const shapeCtl = segmented({ options: STAIR_SHAPE_OPTIONS, value: st.shape, label: 'Stair shape', cls: 'seg--stair', onChange: (v) => { if (!upd({ shape: v })) shapeCtl.set(st.shape); } });
    const turnCtl = st.shape !== 'straight' ? segmented({ options: STAIR_TURN_OPTIONS, value: st.turn || 'right', label: 'Turn', cls: 'seg--stair', onChange: (v) => { if (!upd({ turn: v })) turnCtl.set(st.turn); } }) : null;
    const field = (label, key, o = {}) => numField({ label, value: o.value != null ? o.value : st[key], digits: o.digits || 0, step: o.step || 1, min: o.min, max: o.max, suffix: o.suffix, title: o.title,
      onCommit: (v) => { if (!upd(o.patch ? o.patch(v) : { [key]: v })) force(fields[key], o.value != null ? o.value : st[key], o.digits || 0); } });
    const fields = {
      width: field('Width', 'width', { step: 5, min: 60, max: 200, suffix: 'cm', title: 'Clear width of every flight' }),
      risers: field('Risers', 'risers', { step: 1, min: 2, max: 40, title: 'Number of risers from floor to floor' }),
      going: field('Going', 'going', { step: 0.5, digits: 1, min: 15, max: 40, suffix: 'cm', title: 'Tread depth, nosing to nosing' }),
    };
    if (st.landing) fields.landing = field('Landing', 'landing', { value: st.landing.size, step: 5, min: 60, max: 300, suffix: 'cm', title: 'Depth of the landing along the first flight', patch: (v) => ({ landing: { ...st.landing, size: v } }) });
    const facts = [];
    if (geo) {
      const R = geo.riser, c = 2 * R + geo.going, most = Math.max(...geo.flights.map((f) => f.risers));
      facts.push(...ruleRow('Riser height', cm1(R), R <= L.riserMax + 1e-9 && R >= L.riserMin, `≤ ${L.riserMax}`));
      facts.push(...ruleRow('Going', cm1(geo.going), geo.going >= L.goingMin - 1e-9, `≥ ${L.goingMin}`));
      facts.push(...ruleRow('2R + G', cm1(c), c >= L.comfortMin - 0.05 && c <= L.comfortMax + 0.05, `${L.comfortMin}–${L.comfortMax}`));
      facts.push(...ruleRow('Width', cm1(geo.width), geo.width >= L.widthMin - 1e-9, `≥ ${L.widthMin}`));
      facts.push(...ruleRow('Longest flight', `${most} risers`, most <= L.flightMax, `≤ ${L.flightMax}`));
      if (geo.landings.length) facts.push(...ruleRow('Landing', cm1(geo.landings[0].size), geo.landings[0].size >= L.landingMin - 1e-9, `≥ ${L.landingMin}`));
      facts.push(...ruleRow('Headroom', info.covers ? `${(L.headroom / 100).toFixed(2)} m` : 'too low', info.covers, 'enlarge the opening'));
    }
    const findings = checkStairs({ plan: app.plan, store }).filter((f) => f.stairId === cur.id && (f.severity === 'fail' || f.severity === 'warn' || f.severity === 'info'));
    const voidRows = info.voids.map((v) => { const b = polygonBounds(v.polygon); return h('li', null, h('button', { type: 'button', class: 'oprow', onClick: () => { if (info.to && app.levels) app.levels.set(info.to); structure.select('void', v.id); } },
      h('span', { class: 'oprow__icon' }, icon('floor-void', { size: 18 })),
      h('span', { class: 'oprow__text' }, h('span', { class: 'oprow__name truncate' }, `Opening in the floor of the ${String(to).toLowerCase()}`), h('span', { class: 'oprow__meta num' }, `${fmtLen(b.w, units())} × ${fmtLen(b.h, units())}`)),
      icon('chevron-right', { size: 14 }))); });
    patch = () => {};
    return [
      head(level, 'stairs', SHAPE_NAME[st.shape] || 'Stair', h('p', { class: 'insp__meta' }, `${from} → ${to}${geo ? ` · ${geo.risers} risers of ${cm1(geo.riser)}` : ''}`)),
      levelBanner(level, policy.reason),
      h('div', { class: 'insp__actions' }, h('div', { class: 'actrow', role: 'group', 'aria-label': 'Stair actions' },
        iconBtn('target', 'Show on the plan', { variant: 'outlined', onClick: () => structure.focusPoint({ x: st.x, y: st.y }) }),
        iconBtn('rotate-cw', 'Turn a quarter clockwise', { variant: 'outlined', onClick: () => upd({ rot: ((st.rot || 0) + 90) % 360 }) }),
        btn('Fit to the rules', { small: true, icon: 'pass', tip: 'Risers, going and landing from the stair rules for this floor height, keeping its place', onClick: () => upd({ fit: true }) }),
        iconBtn('trash', 'Remove stair', { kbd: 'Delete', variant: 'danger', onClick: () => { const res = structure.removeStair(cur.id, { quiet: true }); show(removeError, res.ok ? '' : res.reason); } })),
      removeError),
      section('Shape', h('div', { class: 'sinsp__stairshape' }, shapeCtl, turnCtl), err),
      section('Size', { aside: geo ? h('span', { class: 'sec__note num' }, `${fmtLen(geo.size.w, units())} × ${fmtLen(geo.size.d, units())}`) : null },
        h('div', { class: 'grid3' }, fields.width, fields.risers, fields.going), fields.landing || null,
        geo ? h('p', { class: 'sec__note' }, `${geo.risers} risers of ${cm1(geo.riser)} over ${fmtLen(geo.rise, 'm')}; walking line ${fmtLen(geo.walkLength, 'm')}.`) : null),
      section('Rules', { aside: h('span', { class: 'sec__note' }, 'Planning & Building Regulations') }, h('dl', { class: 'facts facts--wide sinsp__rules' }, facts),
        findings.length ? h('ul', { class: 'sinsp__findings' }, findings.map((f) => h('li', { class: `sinsp__finding sinsp__finding--${f.severity}` }, icon(f.severity === 'fail' ? 'fail' : f.severity === 'warn' ? 'warn' : 'info', { size: 14 }), h('span', null, h('strong', null, f.title), ' ', f.detail))))
          : h('p', { class: 'sec__empty' }, 'Every stair rule is met.')),
      section('Opening in the floor above', voidRows.length ? h('ul', { class: 'oplist' }, voidRows)
        : h('p', { class: 'sec__empty' }, info.need.length ? 'None yet — the stair needs one.' : 'None needed: nothing of the floor above is over the stair.')),
    ];
  }

  /* ───────── Opening in a floor (void, stage F4b) ───────── */
  function renderVoid(cur) {
    const { info, policy } = cur, v = info.void, b = polygonBounds(v.polygon), removeError = errorLine();
    const area = Math.abs(polygonArea(v.polygon)) / 1e4;
    const below = info.stairId ? stairInfo(info.stairId) : null;
    return [
      head(policy.level, 'floor-void', 'Opening in the floor', h('p', { class: 'insp__meta' }, `${fmtLen(b.w, units())} × ${fmtLen(b.h, units())} · ${area.toFixed(2)} m²`)),
      levelBanner(policy.level, policy.reason),
      h('div', { class: 'insp__actions' }, h('div', { class: 'actrow', role: 'group', 'aria-label': 'Opening actions' },
        iconBtn('target', 'Show on the plan', { variant: 'outlined', onClick: () => structure.focusPoint({ x: b.x + b.w / 2, y: b.y + b.h / 2 }) }),
        below ? btn('Select its stair', { small: true, icon: 'stairs', onClick: () => { if (app.levels) app.levels.set(below.levelId); structure.select('stair', below.stair.id); } }) : null,
        iconBtn('trash', 'Close the opening', { kbd: 'Delete', variant: 'danger', disabled: !!info.stairId, onClick: () => { const res = structure.removeVoid(v.id, { quiet: true }); show(removeError, res.ok ? '' : res.reason); } })),
      removeError),
      section('Opening', h('dl', { class: 'facts facts--wide' },
        h('dt', null, 'Size'), h('dd', { class: 'num' }, `${fmtLen(b.w, units())} × ${fmtLen(b.h, units())}`),
        h('dt', null, 'Area'), h('dd', { class: 'num' }, `${area.toFixed(2)} m²`),
        h('dt', null, 'For'), h('dd', null, info.stairId ? `Stair ${info.stairId}` : 'No stair (a plain opening)'),
        h('dt', null, 'Headroom'), h('dd', null, !info.stairId ? '—' : h('span', { class: `tag tag--${info.covers ? 'pass' : 'fail'}` }, info.covers ? `Covers what the stair needs (${(STAIR_LIMITS.headroom / 100).toFixed(2)} m)` : 'Too small for the stair'))),
        h('p', { class: 'sec__note' }, info.stairId ? 'Drag its corners or edges in the plan to enlarge it. It can never be smaller than its stair needs; a railing runs round it except where the stair arrives.'
          : 'Drag its corners or edges in the plan to reshape it, or close it. A railing runs round it.')),
    ];
  }

  return {
    /** Build the panel for the current structure selection. */
    render() {
      const cur = structure.selected();
      shape = shapeOf(cur);
      patch = null;
      const nodes = !cur ? renderNothing() : cur.type === 'stair' ? renderStair(cur) : cur.type === 'void' ? renderVoid(cur) : cur.type === 'segment' ? renderSegment(cur.seg) : renderOpening(cur);
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
