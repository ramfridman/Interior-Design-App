/**
 * Projects UI: the project switcher in the top bar (current project, the others, New / Import a sketch / Rename /
 * Duplicate / Export / Import / Delete), the "New project" dialog (empty lot, copy of House 98, or a sketch → the
 * import dialog in ./import/wizard.js, loaded on first use), the draft ↔ fixed card of the Structure guide and the hint shown on an
 * empty plan. Storage and switching are done by core/projects.js (`app.projects`); nothing here uses alert / confirm /
 * window.open, and files go through exporter.js `saveFile`. With a collaboration backend (src/collab/online.js) the menu
 * also lists online projects (owned by me / shared with me, role, who is in it) and offers Share… / History….
 */
import { h, setKids } from './dom.js';
import { icon } from './icons.js';
import { btn, segmented } from './components.js';
import { openDialog, confirmDialog, openMenu, toast } from './dialogs.js';
import { saveFile } from './exporter.js';
import { BUILTIN_PLAN, isBuiltinBase, planPhase } from '../core/plan-edit.js';

/** Israeli cities for the sun (latitude / longitude, °). The built-in house's location comes first. */
export const CITIES = [
  { id: 'afikim', name: 'Kibbutz Afikim (Jordan Valley)', latitude: BUILTIN_PLAN.meta.latitude, longitude: BUILTIN_PLAN.meta.longitude },
  { id: 'jerusalem', name: 'Jerusalem', latitude: 31.778, longitude: 35.235 },
  { id: 'tel-aviv', name: 'Tel Aviv', latitude: 32.085, longitude: 34.781 },
  { id: 'haifa', name: 'Haifa', latitude: 32.794, longitude: 34.990 },
  { id: 'beer-sheva', name: 'Be’er Sheva', latitude: 31.252, longitude: 34.791 },
  { id: 'eilat', name: 'Eilat', latitude: 29.558, longitude: 34.952 },
  { id: 'tiberias', name: 'Tiberias', latitude: 32.795, longitude: 35.531 },
  { id: 'netanya', name: 'Netanya', latitude: 32.332, longitude: 34.860 },
  { id: 'ashdod', name: 'Ashdod', latitude: 31.804, longitude: 34.655 },
  { id: 'modiin', name: 'Modi’in', latitude: 31.898, longitude: 35.010 },
  { id: 'kiryat-shmona', name: 'Kiryat Shmona', latitude: 33.207, longitude: 35.570 },
];
const TIME_ZONE = 'Asia/Jerusalem';

export const field = (label, input, suffix) => h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), input, suffix ? h('span', { class: 'field__suffix' }, suffix) : null);
export const numInput = (value, attrs = {}) => h('input', { class: 'field__input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', value: String(value), ...attrs });
export const readNum = (input) => { const v = Number(String(input.value).replace(',', '.').trim()); return Number.isFinite(v) ? v : NaN; };
const when = (iso) => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };

/**
 * The project switcher button for the top bar (shows the open project's name; the menu does the rest).
 * @param {object} app  UI context with `projects` (core/projects.js) and `store`
 * @returns {HTMLButtonElement}
 */
export function projectSwitcher(app) {
  const { store, projects } = app;
  const label = h('span', { class: 'projname__text truncate' }, store.project.name);
  const el = h('button', { type: 'button', class: 'projname projname--switch display', 'aria-haspopup': 'menu', 'data-tip': 'Projects', onClick: () => openProjectMenu(app, el) },
    label, icon('chevron-down', { size: 14 }));
  const sync = () => { label.textContent = store.project.name; el.setAttribute('aria-label', `Project: ${store.project.name}. Switch, create or manage projects`); };
  store.on('project', sync);
  store.on('base', sync);
  if (projects) projects.on((e) => { if (e.type === 'error') toast(e.message, { kind: 'error', duration: 8000 }); else sync(); });
  sync();
  return el;
}

/** The live-collaboration controller (src/collab/online.js) when a backend answered, else null. */
const collabOf = (app) => app.collab || (typeof window !== 'undefined' && window.app && window.app.collab) || null;
const ROLE_LABEL = { owner: 'owner', editor: 'can edit', viewer: 'can view' };

/** The project menu: the open project, the others (newest first; with a backend: on this device / online), then the commands. */
export async function openProjectMenu(app, anchor) {
  const { projects, store } = app;
  if (!projects) return;
  const cur = projects.current();
  const collab = collabOf(app);
  let list = [], online = null;
  const [l, o] = await Promise.all([
    projects.list().catch(() => []),
    collab ? collab.online.list().catch(() => null) : Promise.resolve(null),
  ]);
  list = l; online = o;
  const others = list.filter((p) => !cur || p.id !== cur.id).slice(0, 12);
  const isOnline = !!(cur && cur.online);
  const session = collab && collab.session();
  const myRole = session ? session.client.role() : null;
  const onlineRow = (p) => {
    const here = (p.people || []).filter((x) => x.email !== collab.user);
    const who = here.length ? ` · ${here.map((x) => x.name || x.email).slice(0, 2).join(', ')}${here.length > 2 ? ` +${here.length - 2}` : ''} here` : '';
    return { label: p.name, icon: 'site', kbd: `${ROLE_LABEL[p.role] || p.role}${who}`, onSelect: () => openOnlineProject(app, p.id) };
  };
  const onlineOthers = online ? online.filter((p) => !cur || p.id !== cur.id) : [];
  const mine = onlineOthers.filter((p) => p.role === 'owner'), shared = onlineOthers.filter((p) => p.role !== 'owner');
  openMenu(anchor, [
    { heading: isOnline ? `Current project · online${myRole ? ' · ' + ROLE_LABEL[myRole] : ''}` : 'Current project' },
    { label: store.project.name, icon: isOnline ? 'site' : 'home', checked: true, onSelect: () => {} },
    others.length ? { heading: collab ? 'On this device' : 'Open another project' } : null,
    ...others.map((p) => ({ label: p.name, icon: p.builtin ? 'home' : 'plan', kbd: when(p.updatedAt), onSelect: () => switchTo(app, p.id) })),
    mine.length ? { heading: 'Online · owned by me' } : null,
    ...mine.slice(0, 12).map(onlineRow),
    shared.length ? { heading: 'Online · shared with me' } : null,
    ...shared.slice(0, 12).map(onlineRow),
    collab && online === null ? { label: 'Online projects could not be listed', icon: 'warn', disabled: true, onSelect: () => {} } : null,
    { separator: true },
    { label: 'New project…', icon: 'plus', onSelect: () => openNewProject(app) },
    { label: 'Import a sketch…', icon: 'image', onSelect: () => openSketchImport(app) },
    { label: 'Rename…', icon: 'note', disabled: myRole === 'viewer', onSelect: () => openRename(app) },
    { label: isOnline ? 'Duplicate on this device' : 'Duplicate', icon: 'duplicate', onSelect: () => duplicateCurrent(app) },
    collab ? { separator: true } : null,
    collab ? { label: 'Share…', icon: 'external', onSelect: () => collab.openShare && collab.openShare() } : null,
    collab && isOnline ? { label: 'History…', icon: 'rotate-ccw', onSelect: () => collab.openHistory && collab.openHistory() } : null,
    { separator: true },
    { label: 'Export project file', icon: 'download', onSelect: () => exportCurrent(app) },
    { label: 'Import project file…', icon: 'open', onSelect: () => openImportProject(app) },
    { separator: true },
    isOnline
      ? (myRole === 'owner' ? { label: 'Delete online project…', icon: 'trash', danger: true, onSelect: () => deleteOnline(app) }
        : { label: 'Leave this online project', icon: 'close', onSelect: () => collab.leaveToLocal() })
      : { label: 'Delete project…', icon: 'trash', danger: true, onSelect: () => deleteCurrent(app) },
  ], { placement: 'bottom-start' });
}

async function openOnlineProject(app, id) {
  const res = await collabOf(app).openOnline(id);
  if (res.ok) toast(`Opened “${app.store.project.name}” (online)`, { kind: 'success' });
  else toast(res.reason, { kind: 'error' });
}

/** Delete the open online project from the server (owner). Everyone in it is disconnected. */
async function deleteOnline(app) {
  const collab = collabOf(app), cur = app.projects.current();
  const name = app.store.project.name;
  const ok = await confirmDialog({ title: `Delete “${name}” for everyone?`, confirmLabel: 'Delete online project', danger: true,
    message: 'The online project — its plan, furniture, finishes, carpentry and restore points — is removed from the server, and everyone you shared it with loses access. This cannot be undone. Use “Duplicate on this device” or “Export project file” first if you may want it back.' });
  if (!ok) return;
  const res = await collab.removeOnline(cur.id);
  if (res.ok) toast(`Deleted “${name}” from the server. Now showing “${app.store.project.name}”.`);
  else toast(res.reason, { kind: 'error' });
}

async function switchTo(app, id) {
  const ok = await app.projects.open(id);
  if (ok) toast(`Opened “${app.store.project.name}”`, { kind: 'success' });
}

/** Rename the open project. */
export function openRename(app) {
  const { projects, store } = app;
  const input = h('input', { class: 'field__input', type: 'text', value: store.project.name, maxlength: '60', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Project name', 'data-autofocus': '', style: 'text-align:left',
    onKeydown: (e) => { if (e.key === 'Enter') go(); } });
  const error = h('p', { class: 'form__error', role: 'alert', hidden: true });
  async function go() {
    const res = await projects.rename(projects.current().id, input.value);
    if (!res.ok) { error.textContent = res.reason; error.hidden = false; return; }
    dlg.close();
  }
  const dlg = openDialog({ title: 'Rename project', size: 'sm', body: [field('Name', input), error],
    actions: [btn('Cancel', { variant: 'quiet', onClick: () => dlg.close() }), btn('Rename', { variant: 'primary', onClick: go })] });
  setTimeout(() => { input.focus(); input.select(); }, 30);
}

async function duplicateCurrent(app) {
  const res = await app.projects.duplicate(app.projects.current().id);
  if (res.ok) toast(`“${res.project.name}” created — find it in the project menu`, { kind: 'success', action: { label: 'Open it', fn: () => switchTo(app, res.project.id) } });
  else toast(res.reason, { kind: 'error' });
}

async function exportCurrent(app) {
  const res = await app.projects.exportFile();
  if (!res.ok) { toast(res.reason, { kind: 'error' }); return; }
  const out = await saveFile({ name: res.filename, mime: 'application/json', data: res.text });
  if (out && out.ok && !out.dialog) toast('Project file saved', { kind: 'success' });
}

async function deleteCurrent(app) {
  const { projects, store } = app;
  const name = store.project.name;
  const ok = await confirmDialog({ title: `Delete “${name}”?`, confirmLabel: 'Delete project', danger: true,
    message: 'The project — its plan, furniture, finishes and carpentry — is removed from this browser. This cannot be undone. Export the project file first if you may want it back.' });
  if (!ok) return;
  const res = await projects.remove(projects.current().id);
  if (res.ok) toast(`Deleted “${name}”. Now showing “${store.project.name}”.`);
  else toast(res.reason, { kind: 'error' });
}

/** Import a project file (or a design file from an earlier version) as a new project. */
export function openImportProject(app) {
  const { projects } = app;
  const error = h('p', { class: 'form__error', role: 'alert', hidden: true });
  const fail = (text) => { error.textContent = text; error.hidden = false; };
  const load = async (text) => {
    const res = await projects.importFile(text);
    if (!res.ok) { fail(res.reason + ' Nothing was changed.'); return; }
    dlg.close();
    toast(`Imported “${res.project.name}”`, { kind: 'success' });
  };
  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', id: 'import-project-file', onChange: () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => load(String(reader.result));
    reader.onerror = () => fail('The file could not be read.');
    reader.readAsText(f);
  } });
  const area = h('textarea', { class: 'export__text', rows: '6', spellcheck: 'false', placeholder: 'Or paste the contents of a project file here', 'aria-label': 'Project file contents' });
  const dlg = openDialog({
    title: 'Import project file', size: 'md',
    body: [
      h('p', { class: 'dialog__text' }, 'The file becomes a new project next to your others. Design files saved by earlier versions of the app open as a project on House 98.'),
      h('label', { class: 'btn btn--default filepick', for: 'import-project-file', tabindex: '0', 'data-autofocus': '', onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } } }, 'Choose a project file'),
      file, area, error,
    ],
    actions: [btn('Cancel', { variant: 'quiet', onClick: () => dlg.close() }), btn('Import pasted file', { variant: 'primary', onClick: () => { if (area.value.trim()) load(area.value); else area.focus(); } })],
  });
}

/**
 * Location (for the sun) and north: city list or custom latitude / longitude, and north in degrees. Shared by the New
 * project dialog and the sketch importer. `read()` → { ok, reason? , location, northAngle }.
 * @param {{ north?: number, northHint?: string, northField?: boolean }} [o]
 */
export function placeFields(o = {}) {
  const city = h('select', { class: 'select', 'aria-label': 'Location', onChange: () => syncCity() },
    CITIES.map((c) => h('option', { value: c.id }, c.name)), h('option', { value: 'custom' }, 'Custom latitude / longitude'));
  const lat = numInput(CITIES[0].latitude, { 'aria-label': 'Latitude in degrees' });
  const lon = numInput(CITIES[0].longitude, { 'aria-label': 'Longitude in degrees' });
  const north = numInput(o.north || 0, { 'aria-label': 'North direction in degrees, clockwise from the top of the plan' });
  const custom = h('div', { class: 'newproj__row' }, field('Latitude', lat, '°'), field('Longitude', lon, '°'));
  const el = h('div', { class: 'newproj__group' }, h('p', { class: 'newproj__label' }, 'Location (for the sun)'), city, custom,
    o.northField === false ? null : h('div', { class: 'newproj__row' }, field('North', north, '°'), h('p', { class: 'newproj__hint' }, o.northHint || 'Clockwise from the top of the plan; 0 = north is up.')));
  function syncCity() {
    const c = CITIES.find((x) => x.id === city.value);
    custom.hidden = !!c;
    if (c) { lat.value = String(c.latitude); lon.value = String(c.longitude); }
  }
  syncCity();
  return {
    el, north,
    /** Validated values, or { ok: false, reason }. */
    read() {
      const la = readNum(lat), lo = readNum(lon), n = readNum(north);
      if (!(Math.abs(la) <= 90 && Math.abs(lo) <= 180)) return { ok: false, reason: 'Location: latitude −90…90 and longitude −180…180 degrees.' };
      if (!Number.isFinite(n)) return { ok: false, reason: 'North: a number of degrees (0 = north is up on the plan).' };
      const ci = CITIES.find((x) => x.id === city.value);
      return { ok: true, location: { name: ci ? ci.name : '', latitude: la, longitude: lo, timeZone: TIME_ZONE }, northAngle: n };
    },
  };
}

/** Ceiling height field (metres). `read()` → cm or NaN with `reason`. */
export function ceilingField(value = 3.0) {
  const input = numInput(value, { 'aria-label': 'Ceiling height in metres' });
  return {
    el: h('div', { class: 'newproj__row' }, field('Ceiling height', input, 'm')),
    read() { const c = readNum(input); return c >= 2.2 && c <= 6 ? { ok: true, cm: Math.round(c * 100) } : { ok: false, reason: 'Ceiling height: a number of metres between 2.20 and 6.00.' }; },
  };
}

/** "New project" dialog: name; empty lot (size), a copy of House 98, or a sketch (→ the import dialog); location, north, ceiling. */
export function openNewProject(app) {
  const { projects } = app;
  let from = 'blank';
  const name = h('input', { class: 'field__input', type: 'text', value: '', placeholder: 'e.g. Our new house', maxlength: '60', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Project name', style: 'text-align:left' });
  const width = numInput(25, { 'aria-label': 'Lot width (east–west) in metres' });
  const depth = numInput(20, { 'aria-label': 'Lot depth (north–south) in metres' });
  const place = placeFields();
  const ceiling = ceilingField(3.0);
  const error = h('p', { class: 'form__error', role: 'alert', hidden: true });
  const lotRow = h('div', { class: 'newproj__group' }, h('p', { class: 'newproj__label' }, 'Lot size'),
    h('div', { class: 'newproj__row' }, field('Width', width, 'm'), field('Depth', depth, 'm')),
    h('p', { class: 'newproj__hint' }, 'East–west × north–south. You draw the house afterwards with the Structure tools.'));
  const placeRows = place.el;
  const copyNote = h('p', { class: 'newproj__hint', hidden: true }, `A fresh copy of ${BUILTIN_PLAN.meta.name}: the architect’s plan, location and furniture layout.`);
  const sketchNote = h('p', { class: 'newproj__hint', hidden: true }, 'Import your drawing — a PDF from the architect, a scan or a photo of a sketch. The walls, doors and windows found in it become a draft you check and correct over the drawing. Your file stays on this device.');
  const createBtn = btn('Create project', { variant: 'primary', onClick: create });
  function syncFrom() {
    lotRow.hidden = from !== 'blank'; placeRows.hidden = from !== 'blank'; copyNote.hidden = from !== 'house98'; sketchNote.hidden = from !== 'sketch';
    ceilingRow.hidden = from === 'sketch';
    createBtn.querySelector('.btn__label').textContent = from === 'sketch' ? 'Choose the drawing…' : 'Create project';
  }
  const start = segmented({ options: [{ value: 'blank', label: 'Empty lot' }, { value: 'house98', label: `Copy of House ${BUILTIN_PLAN.meta.lot || ''}`.trim() }, { value: 'sketch', label: 'From a sketch (PDF or image)' }], value: from, label: 'Start from',
    onChange: (v) => { from = v; syncFrom(); } });
  async function create() {
    error.hidden = true;
    const bad = (text) => { error.textContent = text; error.hidden = false; };
    if (from === 'sketch') {
      dlg.close();
      openSketchImport(app, { name: name.value.trim() });
      return;
    }
    const opts = { name: name.value.trim() || undefined, from };
    const c = ceiling.read();
    if (!c.ok) return bad(c.reason);
    opts.ceiling = c.cm;
    if (from === 'blank') {
      const w = readNum(width), d = readNum(depth);
      if (!(w >= 5 && w <= 500 && d >= 5 && d <= 500)) return bad('Lot size: width and depth in metres, between 5 and 500.');
      const p = place.read();
      if (!p.ok) return bad(p.reason);
      opts.lot = { width: Math.round(w * 100), depth: Math.round(d * 100) };
      opts.location = p.location;
      opts.northAngle = p.northAngle;
    }
    const res = await projects.create(opts);
    if (!res.ok) return bad(res.reason);
    dlg.close();
    toast(`Created “${res.project.name}”`, { kind: 'success' });
  }
  const ceilingRow = ceiling.el;
  const body = h('div', { class: 'newproj' },
    field('Name', name),
    h('div', { class: 'newproj__group' }, h('p', { class: 'newproj__label' }, 'Start from'), start, copyNote, sketchNote),
    lotRow, placeRows,
    ceilingRow,
    error);
  const dlg = openDialog({ title: 'New project', size: 'md', body,
    actions: [btn('Cancel', { variant: 'quiet', onClick: () => dlg.close() }), createBtn] });
  syncFrom();
  setTimeout(() => name.focus(), 30);
  return dlg;
}

/** Open the "Import a sketch" dialog (loaded on first use, so the app's start-up is unchanged). */
export async function openSketchImport(app, opts = {}) {
  try {
    const m = await import('./import/wizard.js');
    return m.openImportWizard(app, opts);
  } catch (e) {
    console.error('[import] could not open', e);
    toast('The sketch importer could not be opened.', { kind: 'error' });
    return null;
  }
}

/**
 * Card for the Structure guide: the plan phase. Draft → "This is the house as built"; a fixed plan of the user's own
 * house → "Back to drafting". Nothing for the built-in house. Re-renders itself on 'plan' / 'base'.
 */
export function phaseCard(app) {
  const { store } = app;
  const el = h('div', { class: 'phase' });
  const render = () => {
    if (isBuiltinBase() && planPhase() === 'fixed') { el.hidden = true; setKids(el); return; }
    el.hidden = false;
    if (planPhase() === 'draft') {
      setKids(el, h('p', { class: 'phase__title' }, icon('note', { size: 16 }), 'Draft: drawing the existing house'),
        h('p', { class: 'phase__text' }, 'Draw the walls, doors and windows as they are today — exterior and safe-room walls too (up to 30 cm). Everything is editable, nothing needs a permit and nothing counts as a change yet. Rooms follow the walls: name them in the Rooms tab.'),
        btn('This is the house as built…', { small: true, variant: 'primary', icon: 'check', onClick: () => fixPlan(app) }));
    } else {
      setKids(el, h('p', { class: 'phase__title' }, icon('lock', { size: 16 }), 'The house as built'),
        h('p', { class: 'phase__text' }, 'Changes are listed against this plan with the four permission levels below.'),
        btn('Back to drafting…', { small: true, variant: 'quiet', icon: 'reset', onClick: () => unfixPlan(app) }));
    }
  };
  store.on('plan', (e) => { if (!e || !e.transient) render(); });
  store.on('base', render);
  render();
  return el;
}

async function fixPlan(app) {
  const ok = await confirmDialog({ title: 'Is this the house as built?', confirmLabel: 'Yes, fix the plan',
    message: 'From now on this plan is the reference: exterior and safe-room walls are locked, exterior openings need a permit, and every change you make is listed against it. You can go back to drafting later. The undo history is cleared.' });
  if (!ok) return;
  if (app.store.setPlanPhase('fixed')) toast('The plan is fixed — changes are tracked from here', { kind: 'success' });
}
async function unfixPlan(app) {
  const ok = await confirmDialog({ title: 'Back to drafting?', confirmLabel: 'Back to drafting', danger: true,
    message: 'Every wall and opening becomes freely editable again and the changes list restarts: when you fix the plan again, the plan as it is then becomes the reference and today’s changes are no longer listed. The undo history is cleared.' });
  if (!ok) return;
  if (app.store.setPlanPhase('draft')) toast('Drafting — draw the house as it is');
}

/**
 * Hint over an empty plan (a new project): how to begin. Shown while the plan has no walls.
 * @param {HTMLElement} host  overlay container of the 2D view
 */
export function initEmptyPlanHint(app, host) {
  const { store, plan, structure } = app;
  if (!host) return null;
  const el = h('div', { class: 'emptyplan', role: 'note', hidden: true },
    h('p', { class: 'emptyplan__title display' }, 'An empty lot'),
    h('p', { class: 'emptyplan__text' }, 'Start with the house as it is: open Structure (B), take the wall tool (W) and drag each wall along its centre line. Walls up to 30 cm can be drawn while the plan is a draft. Then add doors and windows, and name the rooms.'),
    btn('Draw walls', { small: true, variant: 'primary', icon: 'wall-add', onClick: () => { structure.enter(); structure.setTool('wall'); } }));
  const sync = () => { el.hidden = plan.walls.length > 0 || store.ui.mode === '3d' || store.ui.mode === 'walk'; };
  store.on('plan', sync); store.on('base', sync); store.on('ui', (e) => { if (e.keys.includes('mode')) sync(); });
  host.append(el);
  sync();
  return el;
}
