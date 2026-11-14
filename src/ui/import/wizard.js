/**
 * "Import a sketch…" — the guided flow that turns a drawing (vector PDF, AutoCAD DXF, scanned PDF, PNG / JPG) into a new DRAFT
 * project with the drawing kept as a tracing underlay. Five steps in one large dialog; nothing is created before the
 * last one. See docs/CONTRACT.md § 12.
 *
 *   1 Drawing      file picker / drag-and-drop (read locally), page thumbnails, which drawing on the sheet;
 *                  DXF: the layer list (walls / doors / windows / other, proposed, with a highlight); DWG: how to get a DXF
 *   2 Scale        measure a known length (loupe, snaps to line ends) · stated scale · 1 : N · the engine's guess
 *   3 Orientation  rotate / mirror, north, location, ceiling height
 *   4 Review       walls / doors / windows / unsupported pieces over the page, counts, warnings
 *   5 Create       name → buildPlan (warnings) → projects.create({ fromPlan, underlay }) → draft in Structure mode
 *
 * Heavy work runs in a Web Worker (engine-client.js) behind a progress state with Cancel. No alert / confirm /
 * window.open, no network: the file never leaves the browser.
 */
import { h, setKids } from '../dom.js';
import { icon } from '../icons.js';
import { btn, segmented, iconBtn } from '../components.js';
import { openDialog, toast, layer } from '../dialogs.js';
import { field, numInput, readNum, placeFields, ceilingField } from '../projects.js';
import { buildPlan } from '../../core/plan-build.js';
import { FEATURES } from '../../core/features.js';
import { joinSlants, slantJoins, slantFrame, openingQuad } from '../../core/slant-geom.js';
import { createSheet } from './sheet.js';
import { runTask } from './engine-client.js';
import { sniff, plainError, pdfInfo, renderPage, pagePrims, decodeImage, pixelsOf, encodeUnderlay, affThen, affInv, affApply, ImportError } from './source.js';
import { renderPrims } from '../../import/dxf-render.js';
import { addStair } from '../../core/plan-edit.js';
import { stairGeometry } from '../../core/stairs.js';
import { alignFloors, alignmentReport, detectStairSymbols, detectVoidSymbols, matchStairs, levelsInput, shiftOf, snapFaces, placeFloor } from '../../import/floors.js';
import { createAlignView } from './align-view.js';

const PT_CM = 2.54 / 72;            // one PDF point on paper, in cm
const ROLES_ORDER = { wall: 0, door: 1, window: 2, other: 3 };
const STEPS = [
  { id: 'file', label: 'Drawing' },
  { id: 'scale', label: 'Scale' },
  { id: 'orient', label: 'Orientation' },
  { id: 'review', label: 'Review' },
  { id: 'create', label: 'Create' },
];
// several floors (stage F8, only while FEATURES.levels is on and the list holds ≥ 2 floors): "Align floors" after Orientation
const STEPS_FLOORS = [STEPS[0], STEPS[1], STEPS[2], { id: 'align', label: 'Align floors' }, STEPS[3], STEPS[4]];
// what each floor of the list reads (swapped into the dialog's state while that floor is the one shown)
const FLOOR_KEYS = ['file', 'fileName', 'kind', 'dxf', 'bytes', 'pdf', 'page', 'thumbs', 'prims', 'snapIndex', 'sheet', 'image', 'first', 'drawing',
  'scale', 'measure', 'ratio', 'dpi', 'rotate', 'mirror', 'result', 'resultKey'];
const FLOOR_NAMES = ['Ground floor', 'First floor', 'Second floor', 'Third floor', 'Fourth floor', 'Fifth floor', 'Sixth floor'];
const floorDefaultName = (i) => FLOOR_NAMES[i] || `Floor ${i}`;
const confWords = (c) => (c >= 0.85 ? 'confident' : c >= 0.65 ? 'fairly confident' : c >= 0.45 ? 'unsure' : 'a rough guess');
const m2 = (cm) => (cm / 100).toFixed(2);
const fmtLen = (cm) => (cm >= 100 ? `${m2(cm)} m` : `${Math.round(cm)} cm`);
const DXF_UNITS = [['millimetres', 'mm', 0.1], ['centimetres', 'cm', 1], ['metres', 'm', 100], ['inches', 'inch', 2.54], ['feet', 'foot', 30.48]];
const ROLE_LABEL = { wall: 'Walls', door: 'Doors', window: 'Windows', other: 'Other' };
const lowerFirst = (t) => (t && /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
const baseName = (name) => String(name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 60);

/**
 * @param {object} app  UI context (store, projects, structure)
 * @param {{ name?: string, file?: File }} [opts]
 */
export function openImportWizard(app, opts = {}) {
  const S = {
    step: 0, busy: null, error: '', gen: 0,      // gen: bumped by Cancel / a new file — stale async work stops
    file: null, fileName: '', kind: null,           // kind: 'pdf' (vector page) | 'dxf' | 'image' (picture or scanned page) | 'dwg' (explained only)
    dxf: null,                                      // { layers (proposal), candidates, roles (user overrides), highlight, unit }
    bytes: null, pdf: null, page: 1,                // pdf: { pageCount, pages: [{ page, w, h }] }
    thumbs: new Map(),
    prims: null, snapIndex: null,                   // vector page
    sheet: null,                                    // { canvas, ppu (canvas px per sheet unit), w, h (sheet units), fromPdf }
    image: null,                                    // raster: { canvas, width, height, scaled, originalWidth }
    first: null,                                    // first analysis (vector): scale candidates, drawings, size at the guess
    drawing: 0,
    scale: { method: null, cmPerUnit: null, label: '' },
    measure: { pts: [], cm: '' },
    ratio: '', dpi: '150',
    rotate: 0, mirror: false, north: 0,
    result: null, resultKey: '',
    name: opts.name || '',
    built: null, createAnyway: false,
    floors: FEATURES.levels ? [] : null,            // several floors (F8): [{ name, ceiling (cm), sameScale, orientSet, align, marks, plainVoids, …FLOOR_KEYS }]
    cur: 0,                                         // the floor shown (its FLOOR_KEYS live in S itself)
    stairs: null,                                   // stairs / openings between the floors: { list, verdicts, checked }
  };
  let task = null;

  // ── shell ──
  const stepItems = (list) => list.map((s, i) => h('li', { class: 'istep__item', dataset: { i: String(i), id: s.id } },
    h('span', { class: 'istep__num' }, String(i + 1)), h('span', { class: 'istep__label' }, s.label)));
  const stepper = h('ol', { class: 'istep', 'aria-label': 'Steps' }, stepItems(STEPS));
  const content = h('div', { class: 'iwiz__content' });
  const errorBox = h('div', { class: 'ierror', role: 'alert', hidden: true });
  const progress = h('div', { class: 'iprogress', hidden: true, role: 'status', 'aria-live': 'polite' });
  const body = h('div', { class: 'iwiz' }, stepper, errorBox, content, progress);
  const backBtn = btn('Back', { variant: 'quiet', icon: 'chevron-left', onClick: () => go(S.step - 1) });
  const nextBtn = btn('Next', { variant: 'primary', iconRight: 'chevron-right', onClick: () => next() });
  const cancelBtn = btn('Cancel', { variant: 'quiet', onClick: () => dlg.close() });
  const dlg = openDialog({ title: 'Import a sketch', size: 'xl', cls: 'importdlg', body,
    actions: [cancelBtn, h('span', { class: 'iwiz__spacer' }), backBtn, nextBtn],
    onClose: () => { if (task) task.cancel(); sheet.destroy(); } });

  // one drawing viewer, moved between the steps that need it
  const sheet = createSheet({
    label: 'The drawing',
    onPick: (pt, snapped) => onPick(pt, snapped),
    onClick: (pt) => onSheetClick(pt),
    snap: (pt, r) => snapTo(pt, r),
  });

  // drag-and-drop anywhere on the dialog
  dlg.el.addEventListener('dragover', (e) => { if (S.busy) return; e.preventDefault(); dlg.el.classList.add('is-drop'); });
  dlg.el.addEventListener('dragleave', (e) => { if (e.target === dlg.el || !dlg.el.contains(e.relatedTarget)) dlg.el.classList.remove('is-drop'); });
  dlg.el.addEventListener('drop', (e) => {
    e.preventDefault(); dlg.el.classList.remove('is-drop');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && !S.busy) { if (S.step !== 0) go(0); chooseFile(f); }
  });

  const vector = () => S.kind === 'pdf' || S.kind === 'dxf';
  // ── several floors (F8): the list, the floor shown, swapping its source into S ──
  const multi = () => !!(S.floors && S.floors.length >= 2);
  const steps = () => (multi() ? STEPS_FLOORS : STEPS);
  /** Keep the shown floor's source in its list entry. */
  function stash() { const F = S.floors && S.floors[S.cur]; if (F) for (const k of FLOOR_KEYS) F[k] = S[k]; }
  /** Make floor i the one shown (its source into S) — no rendering. */
  function unstash(i) { const F = S.floors[i]; for (const k of FLOOR_KEYS) S[k] = F[k]; S.cur = i; }
  /** Show floor i: its drawing in the viewer. */
  function showFloor(i) {
    if (!S.floors || i === S.cur || !S.floors[i]) return;
    stash(); unstash(i);
    if (S.sheet) sheet.setImage(S.sheet.canvas, S.sheet.ppu);
  }
  /** Run fn(i, F) with each floor in turn shown (sync or async); the floor shown before comes back. */
  async function eachFloor(fn) {
    stash();
    const was = S.cur;
    try { for (let i = 0; i < S.floors.length; i++) { unstash(i); const r = await fn(i, S.floors[i]); stash(); if (r === false) return false; } } finally { unstash(was); }
    return true;
  }
  function withFloorSync(i, fn) {
    if (!S.floors || i === S.cur) return fn();
    stash(); const was = S.cur; unstash(i);
    try { return fn(); } finally { stash(); unstash(was); }
  }
  const floorAt = (i) => S.floors[i];
  const valOf = (i, k) => (i === S.cur ? S[k] : S.floors[i][k]);
  function newFloor(src = null) {
    const i = S.floors.length, prev = S.floors[i - 1];
    const F = { name: floorDefaultName(i), nameEdited: false, ceiling: prev ? prev.ceiling : 300, sameScale: false, orientSet: false, align: null, marks: null, plainVoids: [] };
    for (const k of FLOOR_KEYS) F[k] = null;
    Object.assign(F, { page: 1, thumbs: new Map(), drawing: 0, scale: { method: null, cmPerUnit: null, label: '' }, measure: { pts: [], cm: '' }, ratio: '', dpi: '150', rotate: 0, mirror: false, resultKey: '' });
    if (src) Object.assign(F, src);
    S.floors.push(F);
    return i;
  }
  /** The floor's own scale, or the ground floor's when "same scale as the ground floor" is ticked. */
  function effScale() {
    if (multi() && S.cur > 0 && floorAt(S.cur).sameScale) return withFloorSync(0, currentScale);
    return currentScale();
  }
  /** The floors as tabs (Scale, Orientation, Review): a horizontally scrollable strip on phones. */
  function floorTabs(status) {
    return h('div', { class: 'ifloortabs', role: 'tablist', 'aria-label': 'Floors' }, S.floors.map((F, i) => h('button', { type: 'button', role: 'tab', class: `ifloortabs__tab${i === S.cur ? ' is-on' : ''}`,
      'aria-selected': String(i === S.cur), dataset: { floor: String(i) }, onClick: () => { if (i !== S.cur) { showFloor(i); render(); } } },
      h('span', { class: 'ifloortabs__name' }, F.name), status ? h('span', { class: 'ifloortabs__meta' }, status(i)) : null)));
  }
  /** Where floor i's own origin lies in the ground floor's frame (sum of the alignments below it). */
  function offsetOf(i) {
    let x = 0, y = 0;
    for (let k = 1; k <= i; k++) { const a = floorAt(k).align; if (a) { x += a.dx; y += a.dy; } }
    return { x, y };
  }
  // ── state helpers ──
  function setError(text) { S.error = text || ''; errorBox.hidden = !text; setKids(errorBox, text ? [icon('warn', { size: 16 }), h('span', null, text)] : []); }
  function setBusy(text, cancellable = true) {
    S.busy = text || null;
    progress.hidden = !text;
    body.classList.toggle('is-busy', !!text);
    if (text) {
      setKids(progress, h('div', { class: 'iprogress__card' },
        h('div', { class: 'iprogress__bar' }, h('span')),
        h('p', { class: 'iprogress__text' }, text),
        h('p', { class: 'iprogress__hint' }, 'Reading happens on this device — nothing is uploaded.'),
        cancellable ? btn('Cancel', { small: true, onClick: () => { S.gen++; if (task) task.cancel(); task = null; setBusy(null); render(); } }) : null));
    }
    syncFoot();
  }
  async function work(text, fn) {
    setError('');
    setBusy(text);
    try { return await fn(); } catch (err) {
      if (err && err.cancelled) return undefined;
      console.warn('[import]', err);
      setError(plainError(err));
      return undefined;
    } finally { setBusy(null); }
  }
  /** Run an engine task in the worker with the progress state; resolves undefined when cancelled. */
  function engine(type, payload) {
    task = runTask(type, payload);
    const t = task;
    return t.promise.finally(() => { S.ranIn = t.ranIn || S.ranIn; if (task === t) task = null; });
  }

  // ── navigation ──
  function canNext() {
    if (S.busy) return false;
    switch (steps()[S.step].id) {
      case 'file': return multi() ? (stash(), S.floors.every((F) => !!F.sheet && F.kind !== 'dwg')) : !!S.sheet;
      case 'scale': return multi() ? S.floors.every((_, i) => !!withFloorSync(i, effScale)) : !!currentScale();
      case 'orient': return true;
      case 'align': return true;
      case 'review': return multi() ? (stash(), S.floors.every((F) => !!F.result)) : !!S.result;
      default: return true;
    }
  }
  function syncFoot() {
    backBtn.hidden = S.step === 0;
    backBtn.disabled = !!S.busy;
    nextBtn.disabled = !canNext();
    if (stepper.children.length !== steps().length) setKids(stepper, stepItems(steps()));
    const last = S.step === steps().length - 1;
    nextBtn.querySelector('.btn__label').textContent = last ? (S.built && !S.built.ok ? 'Create anyway' : 'Create project')
      : steps()[S.step].id === 'scale' ? 'Use this scale' : 'Next';
    stepper.querySelectorAll('.istep__item').forEach((li, i) => {
      li.classList.toggle('is-done', i < S.step); li.classList.toggle('is-current', i === S.step);
      if (i === S.step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }
  async function next() {
    if (!canNext()) return;
    const id = steps()[S.step].id;
    if (id === 'orient') {
      if (!readOrient()) return;
      if (multi()) { if (!(await analyseAll())) return; }
      else if (!(await analyse())) return;            // the review shows the detection at the confirmed scale and orientation
    }
    if (id === 'align') { if (!(await prepareStairs())) return; }
    if (id === 'create') { await create(); return; }
    go(S.step + 1);
  }
  function go(i) {
    S.step = Math.max(0, Math.min(steps().length - 1, i));
    if (S.dxf && S.dxf.highlight && S.prims) { S.dxf.highlight = null; drawDxfSheet(); }   // the other steps show every layer
    setError('');
    render();
  }
  function render() {
    const id = steps()[S.step].id;
    content.dataset.step = id;
    if (id === 'file') renderFile();
    else if (id === 'scale') renderScale();
    else if (id === 'orient') renderOrient();
    else if (id === 'align') renderAlign();
    else if (id === 'review') renderReview();
    else renderCreate();
    syncFoot();
    content.scrollTop = 0;
  }

  // ════════════════════════ 1. the drawing ════════════════════════
  const fileInput = h('input', { type: 'file', accept: '.pdf,application/pdf,.dxf,image/vnd.dxf,application/dxf,.dwg,.png,image/png,.jpg,.jpeg,image/jpeg', class: 'sr-only', id: 'import-sketch-file',
    onChange: () => { const f = fileInput.files && fileInput.files[0]; fileInput.value = ''; if (f) chooseFile(f); } });

  function renderFile() {
    sheet.setMode(S.first && S.first.drawings && S.first.drawings.length > 1 ? 'click' : 'view');
    sheet.setOverlay(drawingsOverlay);
    sheet.setHint(S.first && S.first.drawings && S.first.drawings.length > 1 ? 'Click the drawing to import.' : '');
    const pick = h('label', { class: `btn ${S.file ? 'btn--default' : 'btn--primary'} filepick`, for: 'import-sketch-file', tabindex: '0', 'data-autofocus': '',
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } } }, icon('open', { size: 16 }), h('span', { class: 'btn__label' }, S.file ? 'Choose another file' : 'Choose a file'));
    const drop = h('div', { class: `idrop${S.sheet ? ' idrop--compact' : ''}` },
      h('div', { class: 'idrop__icon' }, icon('plan', { size: 28 })),
      h('p', { class: 'idrop__title display', dir: 'auto' }, S.file ? S.fileName : 'Drop a DXF, PDF, PNG or JPG here'),
      h('p', { class: 'idrop__text' }, S.file ? fileFacts() : 'A DXF or a PDF straight from the architect’s drawing program gives exact walls (a DXF also knows its units and layers). A scan or a photo works too — as a starting point to trace over.'),
      pick, fileInput,
      h('p', { class: 'idrop__private' }, icon('lock', { size: 14 }), 'Your drawing stays on this device: it is read in this browser and never uploaded.'));
    const kids = [drop];
    if (S.kind === 'dwg') kids.push(dwgHelp());
    if (S.pdf && S.pdf.pageCount > 1) kids.push(pagePicker());
    if (S.sheet) {
      const many = S.first && S.first.drawings && S.first.drawings.length > 1;
      kids.push(h('div', { class: 'isplit' },
        h('div', { class: 'isplit__main' }, sheet.el),
        h('div', { class: 'isplit__side' },
          h('p', { class: 'iside__title' }, many ? 'Which drawing?' : S.kind === 'dxf' ? 'The drawing' : 'The page'),
          h('p', { class: 'iside__text' }, many
            ? `This sheet holds ${S.first.drawings.length} separate drawings. Click the one to import on the page — drawing ${S.drawing + 1} is chosen.`
            : S.kind === 'image' ? (S.sheet.fromPdf ? 'This PDF page is a scanned picture: it is read like a photo.' : 'The picture you chose. Next, set its scale.')
              : S.kind === 'dxf' ? 'The drawing’s model space. Check which layers hold the walls, doors and windows below; then confirm the scale.' : 'This is the page that will be read. Next, confirm its scale.'),
          many ? h('ol', { class: 'idrawings' }, S.first.drawings.map((d, i) => h('li', null, h('button', { type: 'button', class: `idrawings__btn${i === S.drawing ? ' is-on' : ''}`, onClick: () => pickDrawing(i) },
            `Drawing ${i + 1}`, h('span', { class: 'faint' }, ` · ${d.walls} wall pieces`), S.floors && drawingFloor(i) >= 0 ? h('span', { class: 'idrawings__floor' }, ` — ${floorAt(drawingFloor(i)).name}`) : null)))) : null,
          S.floors ? floorPanel() : null,
          S.kind === 'dxf' ? layerPanel() : null)));
    }
    setKids(content, kids);
    if (S.sheet) requestAnimationFrame(() => sheet.resize());
  }
  // ── the floor list (several floors, F8) ──
  const floorFileInput = h('input', { type: 'file', accept: '.pdf,application/pdf,.dxf,image/vnd.dxf,application/dxf,.png,image/png,.jpg,.jpeg,image/jpeg', class: 'sr-only', id: 'import-floor-file',
    onChange: () => { const f = floorFileInput.files && floorFileInput.files[0]; floorFileInput.value = ''; if (f) chooseFile(f, { asFloor: true }); } });
  /** The floor (index) that reads drawing k of the sheet shown, or −1. */
  function drawingFloor(k) {
    stash();
    return S.floors.findIndex((F) => F.prims && F.prims === S.prims && F.drawing === k && F.sheet);
  }
  const pageFloor = (n) => { stash(); return S.floors.findIndex((F) => F.bytes && F.bytes === S.bytes && F.page === n && F.sheet); };
  function floorSource(F) {
    const parts = [F.fileName || 'Drawing'];
    if (F.pdf && F.pdf.pageCount > 1) parts.push(`page ${F.page}`);
    if (F.first && F.first.drawings && F.first.drawings.length > 1) parts.push(`drawing ${F.drawing + 1}`);
    return parts.join(' · ');
  }
  /** A small picture of the floor's drawing (its part of the sheet when the sheet holds several). */
  function floorThumb(F) {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 84; c.className = 'ifloor__canvas';
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    if (!F.sheet || !F.sheet.canvas) return c;
    let box = { x: 0, y: 0, w: F.sheet.w, h: F.sheet.h };
    const d = F.first && F.first.drawings && F.first.drawings.length > 1 ? F.first.drawings[F.drawing] : null;
    if (d && F.first.transform) {
      const inv = affInv(F.first.transform), pts = rectPts(d.bbox, 60).map(([x, y]) => affApply(inv, x, y));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    const k = Math.min(c.width / box.w, c.height / box.h), ppu = F.sheet.ppu || 1;
    try {
      g.drawImage(F.sheet.canvas, box.x * ppu, box.y * ppu, box.w * ppu, box.h * ppu, (c.width - box.w * k) / 2, (c.height - box.h * k) / 2, box.w * k, box.h * k);
    } catch (e) { /* a thumbnail is optional */ }
    return c;
  }
  function floorPanel() {
    stash();
    const n = S.floors.length;
    const items = S.floors.map((F, i) => {
      const name = h('input', { class: 'field__input ifloor__name', type: 'text', value: F.name, maxlength: '40', autocomplete: 'off', spellcheck: 'false', 'aria-label': `Name of floor ${i + 1}`,
        onInput: () => { F.name = name.value || floorDefaultName(i); F.nameEdited = true; } });
      const ceil = numInput(((F.ceiling || 300) / 100).toFixed(2), { 'aria-label': `Ceiling height of ${F.name} in metres`,
        onInput: () => { const v = readNum(ceil); if (v >= 2 && v <= 6) F.ceiling = Math.round(v * 100); } });
      const tools = n > 1 ? h('div', { class: 'ifloor__tools' },
        iconBtn('chevron-up', `Move ${F.name} up a floor`, { size: 16, disabled: i === n - 1, onClick: () => moveFloor(i, +1) }),
        iconBtn('chevron-down', `Move ${F.name} down a floor`, { size: 16, disabled: i === 0, onClick: () => moveFloor(i, -1) }),
        iconBtn('trash', `Remove ${F.name}`, { size: 16, onClick: () => removeFloor(i) })) : null;
      return h('li', { class: `ifloor${i === S.cur ? ' is-on' : ''}`, dataset: { floor: String(i) } },
        h('button', { type: 'button', class: 'ifloor__pick', 'aria-label': `Show ${F.name}`, 'aria-pressed': String(i === S.cur), onClick: () => { showFloor(i); renderFile(); syncFoot(); } }, floorThumb(F)),
        h('div', { class: 'ifloor__body' },
          name,
          n > 1 ? h('label', { class: 'ifloor__ceil' }, h('span', null, 'Ceiling'), ceil, h('span', { class: 'faint' }, 'm')) : null,
          h('p', { class: 'ifloor__src', dir: 'auto' }, F.sheet ? floorSource(F) : F.kind === 'dwg' ? 'DWG — cannot be read' : 'reading…')),
        tools);
    });
    const adds = [];
    if (S.first && S.first.drawings && S.first.drawings.length > 1) S.first.drawings.forEach((d, k) => { if (drawingFloor(k) < 0) adds.push(btn(`Add drawing ${k + 1} as a floor`, { small: true, icon: 'plus', onClick: () => addFloorDrawing(k) })); });
    if (S.pdf && S.pdf.pageCount > 1 && S.kind !== 'dwg') S.pdf.pages.forEach((p) => { if (pageFloor(p.page) < 0) adds.push(btn(`Add page ${p.page} as a floor`, { small: true, icon: 'plus', onClick: () => addFloorPage(p.page) })); });
    adds.push(h('label', { class: 'btn btn--default btn--sm filepick', for: 'import-floor-file', tabindex: '0',
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); floorFileInput.click(); } } }, icon('open', { size: 14 }), h('span', { class: 'btn__label' }, 'Add a floor from another file…')), floorFileInput);
    return h('div', { class: 'ifloorsbox' },
      h('p', { class: 'iside__title' }, icon('levels', { size: 16 }), n > 1 ? `Floors (${n}), bottom-up` : 'Floors'),
      h('p', { class: 'iside__text' }, n > 1 ? 'Each floor is read with its own scale and orientation, then lined up over the floor below. Click a floor to see its drawing.'
        : 'A house with several floors? Add each floor’s drawing — another page, another drawing on this sheet or another file (PDF, DXF or picture).'),
      h('ol', { class: 'ifloors', 'aria-label': 'Floors of the house, ground floor first' }, items),
      h('div', { class: 'ifloors__add' }, adds));
  }
  function resetFloorWork() { S.stairs = null; S.built = null; for (const F of S.floors) { F.align = null; F.plainVoids = []; } }
  function addFloorDrawing(k) {
    stash();
    const src = {};
    for (const key of FLOOR_KEYS) src[key] = S[key];
    Object.assign(src, { drawing: k, result: null, resultKey: '', scale: { ...S.scale }, measure: { pts: S.measure.pts.slice(), cm: S.measure.cm } });
    const i = newFloor(src);
    floorAt(i).sameScale = true;
    resetFloorWork();
    unstash(i);
    if (S.sheet) sheet.setImage(S.sheet.canvas, S.sheet.ppu);
    render();
  }
  async function addFloorPage(n) {
    stash();
    const src = { file: S.file, fileName: S.fileName, kind: S.kind, bytes: S.bytes, pdf: S.pdf, thumbs: S.thumbs, page: n };
    const i = newFloor(src);
    resetFloorWork();
    unstash(i);
    render();
    await work('Reading the page…', () => loadPage(n));
    // a page of the same PDF whose detected scale agrees with the ground floor's: "same scale" is pre-ticked
    const g = floorAt(0), gs = g.first && g.first.scale, ms = S.first && S.first.scale;
    if (i > 0 && g.bytes === S.bytes && gs && ms && Math.abs(gs.cmPerUnit / ms.cmPerUnit - 1) < 0.01) floorAt(i).sameScale = true;
    stash();
    render();
  }
  function moveFloor(i, d) {
    const j = i + d;
    if (j < 0 || j >= S.floors.length) return;
    stash();
    const was = S.floors[S.cur];
    [S.floors[i], S.floors[j]] = [S.floors[j], S.floors[i]];
    S.floors.forEach((F, k) => { if (!F.nameEdited) F.name = floorDefaultName(k); });
    resetFloorWork();
    S.cur = S.floors.indexOf(was);
    if (S.floors[0].sameScale) S.floors[0].sameScale = false;
    renderFile(); syncFoot();
  }
  function removeFloor(i) {
    if (S.floors.length < 2) return;
    stash();
    const was = S.floors[S.cur];
    S.floors.splice(i, 1);
    S.floors.forEach((F, k) => { if (!F.nameEdited) F.name = floorDefaultName(k); });
    resetFloorWork();
    if (S.floors[0].sameScale) S.floors[0].sameScale = false;
    const keep = S.floors.indexOf(was);
    unstash(keep >= 0 ? keep : Math.min(i, S.floors.length - 1));
    if (S.sheet) sheet.setImage(S.sheet.canvas, S.sheet.ppu);
    if (S.step >= steps().length) S.step = 0;
    render();
  }
  function fileFacts() {
    if (S.kind === 'dwg') return 'AutoCAD DWG — not readable here (see below)';
    if (S.kind === 'dxf' && S.prims) {
      const u = S.prims.dxf.units;
      return ['AutoCAD DXF', u.cmPerUnit ? `drawn in ${u.name}` : 'units not stated', `${S.prims.layers.length} layer${S.prims.layers.length === 1 ? '' : 's'}`,
        S.prims.layouts && S.prims.layouts.length ? `model space read (${S.prims.layouts.length} paper layout${S.prims.layouts.length === 1 ? '' : 's'} not used)` : null].filter(Boolean).join(' · ');
    }
    const parts = [S.kind === 'pdf' ? 'Vector PDF' : S.sheet && S.sheet.fromPdf ? 'Scanned PDF page' : 'Picture'];
    if (S.pdf) parts.push(`${S.pdf.pageCount} page${S.pdf.pageCount === 1 ? '' : 's'}${S.pdf.pageCount > 1 ? ` · page ${S.page} chosen` : ''}`);
    if (S.image) parts.push(`${S.image.originalWidth || S.image.width} × ${S.image.originalHeight || S.image.height} px`);
    return parts.join(' · ');
  }
  function pagePicker() {
    const grid = h('div', { class: 'ipages', role: 'radiogroup', 'aria-label': 'Page' });
    for (const p of S.pdf.pages) {
      const thumb = h('div', { class: 'ipages__img' }, S.thumbs.get(p.page) || h('span', { class: 'faint' }, '…'));
      grid.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(p.page === S.page), class: `ipages__btn${p.page === S.page ? ' is-on' : ''}`, onClick: () => { if (p.page !== S.page) choosePage(p.page); } },
        thumb, h('span', { class: 'ipages__label' }, `Page ${p.page}`)));
    }
    if (S.pdf.pageCount > S.pdf.pages.length) grid.append(h('p', { class: 'faint' }, `Only the first ${S.pdf.pages.length} pages are shown.`));
    return h('div', { class: 'ipagesbox' }, h('p', { class: 'iside__title' }, 'Which page holds the floor plan?'), grid);
  }

  async function chooseFile(f, { asFloor = false } = {}) {
    S.gen++;
    if (task) task.cancel();
    if (S.floors) {
      // several floors: the file is the source of the floor shown (the first file starts the list); "Add a floor from
      // another file…" adds a floor on top and reads the file into it
      if (asFloor && S.floors.length && S.sheet) { stash(); unstash(newFloor()); }
      if (!S.floors.length) { newFloor(); S.cur = 0; }
      Object.assign(floorAt(S.cur), { align: null, marks: null, plainVoids: [] });
      S.stairs = null;
    }
    Object.assign(S, { file: f, fileName: f.name || 'Drawing', kind: null, bytes: null, pdf: null, dxf: null, page: 1, thumbs: new Map(), prims: null, snapIndex: null, sheet: null, image: null, first: null, drawing: 0,
      scale: { method: null, cmPerUnit: null, label: '' }, measure: { pts: [], cm: '' }, ratio: '', result: null, resultKey: '', built: null });
    if (!asFloor) {
      if (!S.name) S.nameFromFile = true;
      if (S.nameFromFile) S.name = baseName(f.name);
    }
    render();
    const gen = S.gen;
    await work('Opening the file…', async () => {
      const kind = await sniff(f);
      if (gen !== S.gen) throw { cancelled: true };
      if (kind === 'dwg') { S.kind = 'dwg'; return; }
      if (kind === 'dxf') { await loadDxf(f, gen); return; }
      if (kind === 'pdf') {
        S.bytes = new Uint8Array(await f.arrayBuffer());
        S.pdf = await pdfInfo(S.bytes);
        if (!S.pdf.pageCount) throw new ImportError('This PDF has no pages.');
        if (S.pdf.pageCount > 1) thumbnails();
        await loadPage(1);
      } else {
        S.kind = 'image';
        S.image = await decodeImage(f);
        S.sheet = { canvas: S.image.canvas, ppu: 1, w: S.image.width, h: S.image.height, fromPdf: false };
        sheet.setImage(S.sheet.canvas, 1);
      }
    });
    stash();
    render();
  }
  async function thumbnails() {
    for (const p of S.pdf.pages) {
      if (!S.bytes) return;
      try {
        const r = await renderPage(S.bytes, p.page, 220, p);
        r.canvas.className = 'ipages__canvas';
        S.thumbs.set(p.page, r.canvas);
        if (steps()[S.step].id === 'file' && !S.busy) { const slot = content.querySelectorAll('.ipages__img')[p.page - 1]; if (slot) setKids(slot, r.canvas); }
      } catch (e) { /* a thumbnail is optional */ }
    }
  }
  async function choosePage(n) {
    Object.assign(S, { page: n, prims: null, snapIndex: null, sheet: null, first: null, drawing: 0, result: null, resultKey: '', measure: { pts: [], cm: '' }, scale: { method: null, cmPerUnit: null, label: '' } });
    render();
    await work('Reading the page…', () => loadPage(n));
    render();
  }
  /** Read the page's vector data, render it for the viewer, and run the first analysis (scale candidates, drawings). */
  async function loadPage(n) {
    const gen = S.gen;
    const live = (v) => { if (gen !== S.gen) throw { cancelled: true }; return v; };
    const size = S.pdf.pages[n - 1] || S.pdf.pages[0];
    setBusy('Reading the page’s lines…');
    S.prims = live(await pagePrims(S.bytes, n));
    const vector = S.prims.paths.length >= 50 && !(S.prims.images || []).some((im) => im.w * im.h > 0.5 * S.prims.pageBox.w * S.prims.pageBox.h && S.prims.paths.length < 200);
    if (!vector) {
      // a scanned page: read it like a photo
      setBusy('This page is a scanned picture — rendering it…');
      const r = live(await renderPage(S.bytes, n, 3200, size));
      S.kind = 'image';
      S.prims = null;
      S.image = { canvas: r.canvas, width: r.width, height: r.height, scaled: 1, originalWidth: r.width, originalHeight: r.height, pdfPxPerUnit: r.pxPerUnit };
      S.sheet = { canvas: r.canvas, ppu: 1, w: r.width, h: r.height, fromPdf: true };
      sheet.setImage(r.canvas, 1);
      return;
    }
    S.kind = 'pdf';
    const r = live(await renderPage(S.bytes, n, 2600, size));
    S.sheet = { canvas: r.canvas, ppu: r.pxPerUnit, w: S.prims.pageBox.w, h: S.prims.pageBox.h, fromPdf: true };
    sheet.setImage(r.canvas, r.pxPerUnit);
    S.snapIndex = buildSnapIndex(S.prims);
    setBusy('Looking for walls and the scale…');
    const res = live(await engine('analyse', { prims: S.prims, opts: {} }));
    S.first = res;
    S.drawing = res.drawing || 0;
    const text = (res.scaleCandidates || []).find((c) => c.source === 'text' || c.source === 'dimensions');
    if (text && text.confidence >= 0.6) S.scale = { method: 'text', cmPerUnit: text.cmPerUnit, label: text.label };
  }
  // ── DXF ──
  /** Read the DXF in the worker, draw it, and run the first analysis (units, layer roles, drawings). */
  async function loadDxf(f, gen) {
    const live = (v) => { if (gen !== S.gen) throw { cancelled: true }; return v; };
    setBusy('Reading the DXF…');
    const bytes = new Uint8Array(await f.arrayBuffer());
    const read = live(await engine('dxf-read', { bytes }));
    S.kind = 'dxf';
    S.prims = read.prims;
    S.dxf = { layers: read.look.layers, candidates: read.look.candidates, roles: {}, highlight: null, unit: null };
    drawDxfSheet();
    S.snapIndex = buildSnapIndex(S.prims);
    await dxfFirst(gen);
    const best = S.dxf.candidates[0];
    if (best && (best.source === 'units' || best.source === 'dimensions') && best.confidence >= 0.6) S.scale = { method: 'text', cmPerUnit: best.cmPerUnit, label: best.label };
  }
  function dxfHidden() { return new Set(S.prims.layers.filter((L) => !L.visible).map((L) => L.name)); }
  function drawDxfSheet() {
    const long = Math.max(S.prims.pageBox.w, S.prims.pageBox.h) || 1000;
    const hl = S.dxf.highlight ? new Set([S.dxf.highlight]) : null;
    const canvas = S.sheet && S.sheet.fromDxf ? S.sheet.canvas : document.createElement('canvas');
    const r = renderPrims(S.prims, { pxPerUnit: Math.max(0.05, Math.min(6, 2600 / long)), canvas, hide: dxfHidden(), highlight: hl });
    const keep = S.sheet && S.sheet.fromDxf;
    S.sheet = { canvas: r.canvas, ppu: r.pxPerUnit, w: S.prims.pageBox.w, h: S.prims.pageBox.h, fromPdf: false, fromDxf: true };
    if (keep) sheet.redraw(); else sheet.setImage(r.canvas, r.pxPerUnit);
  }
  /** The first analysis at the best scale with the current layer roles (drawings on the sheet, size read-out). */
  async function dxfFirst(gen = S.gen) {
    const best = S.dxf.candidates[0];
    setBusy('Looking for walls on the wall layers…');
    const res = await engine('dxf-analyse', { prims: S.prims, opts: { candidates: S.dxf.candidates, layers: S.dxf.layers, roles: S.dxf.roles, scale: best ? { cmPerUnit: best.cmPerUnit } : undefined } });
    if (gen !== S.gen) throw { cancelled: true };
    S.first = res;
    S.drawing = Math.min(S.drawing, Math.max(0, (res.drawings || []).length - 1));
    if (!res.drawings || res.drawings.length < 2) S.drawing = res.drawing || 0;
  }
  function roleOf(L) { return S.dxf.roles[L.name] || L.role; }
  async function setRole(name, role) {
    const L = S.dxf.layers.find((x) => x.name === name);
    if (!L) return;
    if (role === L.role) delete S.dxf.roles[name]; else S.dxf.roles[name] = role;
    S.result = null; S.resultKey = '';
    await work('Looking for walls on the wall layers…', () => dxfFirst());
    render();
  }
  let hlFrame = 0;
  function setHighlight(name) {
    if (!S.dxf || S.dxf.highlight === name) return;
    S.dxf.highlight = name;
    if (!hlFrame) hlFrame = requestAnimationFrame(() => { hlFrame = 0; if (S.dxf && S.prims) drawDxfSheet(); });
    content.querySelectorAll('.ilayers__row').forEach((row) => row.classList.toggle('is-hl', row.dataset.layer === name));
  }
  function layerPanel() {
    const layers = S.dxf.layers.filter((L) => L.count > 0).slice().sort((a, b) => (ROLES_ORDER[roleOf(a)] - ROLES_ORDER[roleOf(b)]) || b.count - a.count);
    const rows = layers.map((L) => {
      const sel = h('select', { class: 'ilayers__role', 'aria-label': `Use of layer ${L.name}`, onChange: () => setRole(L.name, sel.value) },
        ['wall', 'door', 'window', 'other'].map((r) => h('option', { value: r, selected: roleOf(L) === r }, ROLE_LABEL[r])));
      const what = [L.lines ? `${L.lines} line${L.lines === 1 ? '' : 's'}` : null, L.arcs ? `${L.arcs} arc${L.arcs === 1 ? '' : 's'}` : null, L.fills ? `${L.fills} hatch${L.fills === 1 ? '' : 'es'}` : null,
        L.inserts ? `${L.inserts} block${L.inserts === 1 ? '' : 's'}` : null, L.texts ? `${L.texts} text${L.texts === 1 ? '' : 's'}` : null, L.dims ? `${L.dims} dim.` : null].filter(Boolean).join(', ');
      const why = S.dxf.roles[L.name] ? 'your choice' : L.reason;
      return h('li', { class: `ilayers__row${S.dxf.highlight === L.name ? ' is-hl' : ''}${L.visible ? '' : ' is-hidden'}`, dataset: { layer: L.name },
        onPointerenter: () => setHighlight(L.name), onFocusin: () => setHighlight(L.name) },
        h('span', { class: 'ilayers__sw', style: `background:${L.colour}` }),
        h('span', { class: 'ilayers__text' },
          h('span', { class: 'ilayers__name', dir: 'auto', title: L.name }, L.name),
          h('span', { class: 'ilayers__meta' }, `${what || `${L.count} items`}${why ? ' · ' + why : ''}${L.visible ? '' : ' · hidden in the file'}`)),
        sel);
    });
    const list = h('ul', { class: 'ilayers', 'aria-label': 'Layers', onPointerleave: () => setHighlight(null) }, rows);
    const lay = S.prims.layouts || [];
    return h('div', { class: 'ilayersbox' },
      h('p', { class: 'iside__title' }, 'Layers'),
      h('p', { class: 'iside__text' }, 'Walls are read only from the wall layers; doors and windows from their layers. Point at a layer to highlight it on the drawing; change its use if the guess is wrong.'),
      list,
      lay.length ? h('p', { class: 'iside__text faint' }, `Paper-space layouts (not read): ${lay.join(', ')}.`) : null);
  }
  function dwgHelp() {
    return h('div', { class: 'callout idwg' }, icon('info', { size: 16 }), h('div', null,
      h('p', { class: 'callout__title' }, 'DWG files cannot be read here — please send a DXF'),
      h('p', { class: 'callout__text' }, 'DWG is AutoCAD’s own closed format. Getting a DXF takes a minute:'),
      h('ul', { class: 'idwg__list' },
        h('li', null, h('b', null, 'AutoCAD, BricsCAD, ArchiCAD, Revit, DraftSight and most CAD programs: '), 'open the drawing, choose File → Save As (or Export), pick “DXF” as the file type (AutoCAD 2018 DXF or any version is fine) and save.'),
        h('li', null, h('b', null, 'No CAD program? '), 'The free ODA File Converter (from the Open Design Alliance) turns DWG files into DXF: choose the folder, output “DXF”, and run it.'),
        h('li', null, 'Or ask the architect to send the plan as DXF — or as a PDF printed from the CAD program.')),
      h('p', { class: 'callout__text' }, 'Then choose the DXF file here.')));
  }
  function pickDrawing(i) {
    if (!S.first || !S.first.drawings || i === S.drawing) return;
    S.drawing = i;
    S.result = null; S.resultKey = '';
    if (S.floors) { stash(); resetFloorWork(); }
    renderFile(); syncFoot();
  }
  function onSheetClick(pt) {
    if (steps()[S.step].id !== 'file' || !S.first || !S.first.drawings) return;
    // drawings' boxes are in plan cm of the first analysis; find the one under the click
    const [px, py] = affApply(S.first.transform, pt[0], pt[1]);
    const hit = S.first.drawings.findIndex((d) => px >= d.bbox.x - 100 && px <= d.bbox.x + d.bbox.w + 100 && py >= d.bbox.y - 100 && py <= d.bbox.y + d.bbox.h + 100);
    if (hit >= 0) pickDrawing(hit);
  }
  function drawingsOverlay(ctx, V) {
    if (!S.first || !S.first.drawings || S.first.drawings.length < 2) return;
    const inv = affInv(S.first.transform);
    S.first.drawings.forEach((d, i) => {
      const pts = rectPts(d.bbox, 60).map(([x, y]) => affApply(inv, x, y));
      ctx.beginPath(); pts.forEach(([u, v], k) => (k ? ctx.lineTo(V.X(u), V.Y(v)) : ctx.moveTo(V.X(u), V.Y(v)))); ctx.closePath();
      const on = i === S.drawing;
      ctx.fillStyle = on ? 'rgba(29, 78, 137, 0.10)' : 'rgba(23, 32, 38, 0.03)';
      ctx.fill();
      ctx.setLineDash(on ? [] : [6, 4]); ctx.lineWidth = on ? 2 : 1; ctx.strokeStyle = on ? V.pal.accent : V.pal.line2; ctx.stroke(); ctx.setLineDash([]);
      const xs = pts.map((p) => V.X(p[0])), ys = pts.map((p) => V.Y(p[1]));
      const fl = S.floors && S.floors.length > 1 ? drawingFloor(i) : -1;
      label(ctx, `Drawing ${i + 1}${fl >= 0 ? ` — ${floorAt(fl).name}` : on ? ' — chosen' : ''}`, Math.min(...xs) + 6, Math.min(...ys) + 6, on ? V.pal.accent : V.pal.line2);
    });
  }

  // ════════════════════════ 2. scale ════════════════════════
  let ratioInput, dpiInput, cmInput;
  function currentScale() {
    const sc = S.scale;
    if (!sc.method) return null;
    if (sc.method === 'measure') {
      if (S.measure.pts.length < 2) return null;
      const cm = readNum({ value: S.measure.cm });
      const d = Math.hypot(S.measure.pts[1][0] - S.measure.pts[0][0], S.measure.pts[1][1] - S.measure.pts[0][1]);
      if (!(cm > 0) || !(d > 0)) return null;
      return { cmPerUnit: cm / d, label: `${fmtLen(cm)} measured`, source: 'user' };
    }
    if (sc.method === 'unit' && S.kind === 'dxf') {
      const u = DXF_UNITS.find((x) => x[0] === S.dxf.unit);
      if (!u) return null;
      return { cmPerUnit: S.prims.dxf.duPerPageUnit * u[2], label: `1 unit = 1 ${u[1]}`, source: 'user' };
    }
    if (sc.method === 'ratio') {
      const n = readNum({ value: S.ratio });
      if (!(n >= 1 && n <= 5000)) return null;
      if (S.kind === 'pdf') return { cmPerUnit: n * PT_CM, label: `1 : ${n}`, source: 'user', ratio: n };
      if (S.image.pdfPxPerUnit) return { cmPerUnit: n * PT_CM / S.image.pdfPxPerUnit, label: `1 : ${n}`, source: 'user', ratio: n };
      const dpi = readNum({ value: S.dpi });
      if (!(dpi >= 20 && dpi <= 2400)) return null;
      const scaled = S.image.scaled || 1;   // analysed px per original px
      return { cmPerUnit: n * 2.54 / dpi / scaled, label: `1 : ${n} at ${dpi} dpi`, source: 'user', ratio: n };
    }
    if (sc.cmPerUnit > 0) return { cmPerUnit: sc.cmPerUnit, label: sc.label, source: sc.method };
    return null;
  }
  function sanityText(sc) {
    if (!sc) return null;
    const f = S.first && S.first.scale && S.first.scale.cmPerUnit ? sc.cmPerUnit / S.first.scale.cmPerUnit : null;
    const b = S.first && S.first.stats && S.first.stats.bounds;
    const lines = [];
    if (f && b && b.w > 0) {
      const doors = (S.first.openings || []).filter((o) => o.kind === 'door').map((o) => o.width).sort((a, c) => a - c);
      lines.push(`This makes the house ${m2(b.w * f)} × ${m2(b.h * f)} m`);
      if (doors.length) lines.push(`a typical door ${Math.round(doors[Math.floor(doors.length / 2)] * f)} cm wide`);
    } else {
      const w = S.sheet.w * sc.cmPerUnit, hh = S.sheet.h * sc.cmPerUnit;
      lines.push(`This makes the whole ${S.kind === 'pdf' ? 'sheet' : S.kind === 'dxf' ? 'drawing' : 'picture'} ${m2(w)} × ${m2(hh)} m`);
    }
    return lines.join('; ') + '.';
  }
  function plausibility(sc) {
    const f = S.first && S.first.scale && S.first.scale.cmPerUnit ? sc.cmPerUnit / S.first.scale.cmPerUnit : null;
    const b = S.first && S.first.stats && S.first.stats.bounds;
    const big = f && b && b.w > 0 ? Math.max(b.w, b.h) * f : Math.max(S.sheet.w, S.sheet.h) * sc.cmPerUnit;
    if (big < 300) return 'That looks very small for a house — check the number.';
    if (big > 15000) return 'That looks very large for a house — check the number.';
    return null;
  }
  function renderScale() {
    sheet.setMode(S.scale.method === 'measure' && S.measure.pts.length < 2 ? 'pick' : 'view');
    sheet.setOverlay(measureOverlay);
    sheet.setHint(S.scale.method === 'measure' ? (S.measure.pts.length === 0 ? 'Click the first end of a length you know (a wall, a dimension line).' : S.measure.pts.length === 1 ? 'Click the other end.' : '') : '');
    const cands = S.first ? S.first.scaleCandidates || [] : [];
    const text = S.kind === 'dxf' ? cands.find((c) => c.source === 'units' || c.source === 'dimensions') : cands.find((c) => c.source === 'text') || cands.find((c) => c.source === 'dimensions');
    const guess = S.kind === 'dxf' ? (!text ? cands.find((c) => c.source === 'geometry') : null) : S.kind === 'pdf' ? cands.find((c) => c.source === 'geometry') || (S.first && S.first.scale && S.first.scale.source === 'geometry' ? S.first.scale : null) : null;
    const opt = (method, title, desc, extra) => {
      const on = S.scale.method === method;
      return h('div', { class: `iopt${on ? ' is-on' : ''}` },
        h('label', { class: 'iopt__head' }, h('input', { type: 'radio', name: 'iscale', class: 'check__input', checked: on, value: method, onChange: () => chooseMethod(method) }),
          h('span', { class: 'iopt__title' }, title)),
        desc ? h('p', { class: 'iopt__text' }, desc) : null,
        on && extra ? h('div', { class: 'iopt__extra' }, extra) : null);
    };
    // measure
    cmInput = numInput(S.measure.cm, { 'aria-label': 'Real length between the two points in centimetres', placeholder: 'e.g. 500',
      onInput: () => { S.measure.cm = cmInput.value; syncScaleInfo(); } });
    const measureExtra = h('div', { class: 'iopt__rows' },
      h('p', { class: 'iopt__text' }, S.measure.pts.length < 2 ? `Point ${S.measure.pts.length + 1} of 2: click on the drawing (a loupe magnifies; line ends snap).` : 'Both points are set. Type the real length:'),
      S.measure.pts.length === 2 ? field('Length', cmInput, 'cm') : null,
      S.measure.pts.length ? btn('Pick again', { small: true, variant: 'quiet', icon: 'reset', onClick: () => { S.measure.pts = []; renderScale(); } }) : null);
    // 1:N
    ratioInput = numInput(S.ratio, { 'aria-label': 'Scale denominator (1 : N)', placeholder: '100', onInput: () => { S.ratio = ratioInput.value; syncScaleInfo(); } });
    dpiInput = numInput(S.dpi, { 'aria-label': 'Scan resolution in dots per inch', onInput: () => { S.dpi = dpiInput.value; syncScaleInfo(); } });
    const ratioExtra = h('div', { class: 'iopt__rows' }, field('1 :', ratioInput),
      S.kind === 'image' && !S.image.pdfPxPerUnit ? field('Scanned at', dpiInput, 'dpi') : null,
      h('p', { class: 'iopt__text' }, vector() || (S.image && S.image.pdfPxPerUnit) ? 'Only right when the PDF is at true paper size (not “fit to page”).' : 'Only right for a flat scan at a known resolution — not for a photo.'));
    const unitSel = S.kind === 'dxf' ? h('select', { class: 'iunit', 'aria-label': 'Drawing unit', onChange: () => { S.dxf.unit = unitSel.value; syncScaleInfo(); } },
      h('option', { value: '' }, 'Choose…'), DXF_UNITS.map(([name, short]) => h('option', { value: name, selected: S.dxf.unit === name }, `1 unit = 1 ${short} (${name})`))) : null;
    const dxfText = text && S.kind === 'dxf' ? (text.source === 'units'
      ? [`The file is drawn in ${text.unit} (${text.label})`, `The DXF says so ($INSUNITS)${text.evidence && text.evidence.dimensions && text.evidence.dimensions.agree ? `, and ${text.evidence.dimensions.agree} of its ${text.evidence.dimensions.of} dimensions agree` : ''}.`]
      : [`The drawing is in ${text.unit} (${text.label})`, `The file does not say; its ${text.evidence.dimensions ? text.evidence.dimensions.of : ''} dimension figures and the wall sizes fit ${text.unit} — ${confWords(text.confidence)}.`]) : null;
    const opts = S.kind === 'dxf' ? [
      text ? opt('text', dxfText[0], dxfText[1]) : null,
      opt('measure', 'Measure a known length', 'Click both ends of something whose real length you know, then type it.', measureExtra),
      opt('unit', 'Choose the drawing unit', null, h('div', { class: 'iopt__rows' }, field('Unit', unitSel), h('p', { class: 'iopt__text' }, 'A DXF has no paper scale: every length is in its drawing unit.'))),
      guess ? opt('guess', `Best guess: ${guess.label} (${guess.unit})`, `A guess from the drawing’s proportions (wall thickness, doors, size) — ${confWords(guess.confidence)}. Check the size below before using it.`) : null,
    ] : [
      opt('measure', 'Measure a known length', 'Most reliable: click both ends of something whose real length you know, then type it.', measureExtra),
      text ? opt('text', `The drawing says ${text.label}`, text.source === 'text' ? 'Found in the drawing’s text.' : 'Worked out from the dimension figures written on the drawing.') : null,
      opt('ratio', 'Type the scale (1 : N)', null, ratioExtra),
      guess ? opt('guess', `Best guess: ${guess.label}`, `A guess from the drawing’s proportions (wall thickness, doors) — ${confWords(guess.confidence)} (${Math.round(guess.confidence * 100)} %). Check the size below before using it.`) : null,
    ];
    S._guess = guess; S._text = text;
    const info = h('div', { class: 'isanity', 'aria-live': 'polite' });
    // several floors: an upper floor may take the ground floor's scale (pre-ticked when both come from one file and agree)
    const F = multi() ? floorAt(S.cur) : null, g = multi() ? floorAt(0) : null;
    const offerSame = !!(F && S.cur > 0 && g.kind === S.kind && (S.kind !== 'image' || g.file === S.file));
    const same = offerSame && F.sameScale;
    if (same) { sheet.setMode('view'); sheet.setHint(''); }
    setKids(content, h('div', { class: 'isplit' },
      h('div', { class: 'isplit__main' }, sheet.el),
      h('div', { class: 'isplit__side' },
        h('p', { class: 'iside__title' }, multi() ? `How big is the drawing of the ${lowerFirst(floorAt(S.cur).name)}?` : 'How big is the drawing?'),
        h('p', { class: 'iside__text' }, multi() ? 'Each floor has its own scale. Every length of that floor comes from it, so please confirm it.' : 'Every length in the new project comes from this, so please confirm it.'),
        offerSame ? checkbox('Same scale as the ground floor', F.sameScale, (v) => { F.sameScale = v; S.result = null; renderScale(); syncFoot(); }) : null,
        same ? h('p', { class: 'iside__text' }, 'This floor uses the scale confirmed for the ground floor.') : h('div', { class: 'iopts', role: 'radiogroup', 'aria-label': 'How to set the scale' }, opts),
        info)));
    if (multi()) content.prepend(floorTabs());
    syncScaleInfo();
    requestAnimationFrame(() => sheet.resize());
  }
  function chooseMethod(method) {
    S.scale.method = method;
    if (method === 'text' && S._text) { S.scale.cmPerUnit = S._text.cmPerUnit; S.scale.label = S._text.label; }
    else if (method === 'guess' && S._guess) { S.scale.cmPerUnit = S._guess.cmPerUnit; S.scale.label = S._guess.label; }
    else if (method === 'unit' && S.kind === 'dxf' && !S.dxf.unit) { const c = S.dxf.candidates[0]; S.dxf.unit = c ? (DXF_UNITS.find((u) => u[0] === c.unit) || [null])[0] : null; S.scale.cmPerUnit = null; S.scale.label = ''; }
    else { S.scale.cmPerUnit = null; S.scale.label = ''; }
    renderScale(); syncFoot();
    if (method === 'ratio') setTimeout(() => ratioInput && ratioInput.focus(), 20);
    if (method === 'unit') setTimeout(() => { const u = content.querySelector('.iunit'); if (u) u.focus(); }, 20);
  }
  function syncScaleInfo() {
    const info = content.querySelector('.isanity');
    if (!info) return;
    const sc = effScale();
    if (!sc) setKids(info, h('p', { class: 'faint' }, S.scale.method ? 'Complete the choice above to see what it means.' : 'Choose one of the ways above.'));
    else {
      const warn = plausibility(sc);
      setKids(info, h('p', { class: 'isanity__title' }, `Scale: ${sc.label}`), h('p', { class: 'isanity__text' }, sanityText(sc)),
        warn ? h('p', { class: 'isanity__warn' }, icon('warn', { size: 14 }), warn) : null);
    }
    syncFoot();
  }
  function onPick(pt, snapped) {
    if (steps()[S.step].id === 'scale' && S.scale.method === 'measure' && S.measure.pts.length < 2) {
      S.measure.pts.push(pt);
      void snapped;
      renderScale();
      if (S.measure.pts.length === 2) setTimeout(() => cmInput && cmInput.focus(), 20);
    }
  }
  function measureOverlay(ctx, V) {
    if (S.scale.method !== 'measure') return;
    const P = S.measure.pts.map(([u, v]) => [V.X(u), V.Y(v)]);
    ctx.strokeStyle = V.pal.accent; ctx.fillStyle = V.pal.accent; ctx.lineWidth = 2;
    if (P.length === 2) { ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); ctx.lineTo(P[1][0], P[1][1]); ctx.stroke(); }
    for (const [x, y] of P) { ctx.beginPath(); ctx.arc(x, y, V.loupe ? 6 : 4, 0, Math.PI * 2); ctx.fill(); }
    if (P.length === 2 && !V.loupe) {
      const sc = currentScale();
      if (sc) { const d = Math.hypot(S.measure.pts[1][0] - S.measure.pts[0][0], S.measure.pts[1][1] - S.measure.pts[0][1]) * sc.cmPerUnit; label(ctx, fmtLen(d), (P[0][0] + P[1][0]) / 2 + 6, (P[0][1] + P[1][1]) / 2 + 6, V.pal.accent); }
    }
  }
  // snapping to line ends (vector pages only)
  function buildSnapIndex(prims) {
    const cell = 6, map = new Map();
    const add = (x, y) => { const k = Math.floor(x / cell) + ',' + Math.floor(y / cell); let a = map.get(k); if (!a) map.set(k, a = []); if (a.length < 64) a.push(x, y); };
    for (const p of prims.paths) {
      if (p.curved) continue;
      const pts = p.pts;
      if (pts.length <= 8) for (let i = 0; i < pts.length; i += 2) add(pts[i], pts[i + 1]);
      else { add(pts[0], pts[1]); add(pts[pts.length - 2], pts[pts.length - 1]); for (let i = 2; i < pts.length - 2; i += 2) add(pts[i], pts[i + 1]); }
    }
    return { cell, map };
  }
  function snapTo(pt, r) {
    if (!S.snapIndex || steps()[S.step].id !== 'scale') return null;
    const { cell, map } = S.snapIndex;
    let best = null, bd = r * r;
    const n = Math.ceil(r / cell);
    const cx = Math.floor(pt[0] / cell), cy = Math.floor(pt[1] / cell);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const a = map.get((cx + i) + ',' + (cy + j));
      if (!a) continue;
      for (let k = 0; k < a.length; k += 2) { const d = (a[k] - pt[0]) ** 2 + (a[k + 1] - pt[1]) ** 2; if (d < bd) { bd = d; best = [a[k], a[k + 1]]; } }
    }
    return best;
  }

  // ════════════════════════ 3. orientation ════════════════════════
  let place, ceiling, northInput, curDial;
  function renderOrient() {
    const preview = h('div', { class: 'iorient__page' });
    const img = h('div', { class: 'iorient__img' });
    const thumb = document.createElement('canvas');
    const k = Math.min(1, 900 / Math.max(S.sheet.canvas.width, S.sheet.canvas.height));
    thumb.width = Math.round(S.sheet.canvas.width * k); thumb.height = Math.round(S.sheet.canvas.height * k);
    thumb.getContext('2d').drawImage(S.sheet.canvas, 0, 0, thumb.width, thumb.height);
    img.append(thumb);
    preview.append(img);
    const dial = northDial();
    preview.append(dial.el);
    // the page fits the square preview in every rotation when its width is min(100 %, aspect × 100 %)
    img.style.width = `${Math.min(1, thumb.width / thumb.height) * 100}%`;
    const syncPreview = () => {
      const sx = S.mirror === 'ew' ? -1 : 1, sy = S.mirror === 'ns' ? -1 : 1;
      img.style.transform = `translate(-50%, -50%) rotate(${S.rotate}deg) scale(${sx}, ${sy})`;
      dial.set(S.north);
    };
    const rot = segmented({ options: [0, 90, 180, 270].map((v) => ({ value: v, label: `${v}°` })), value: S.rotate, label: 'Rotate the drawing clockwise',
      onChange: (v) => { S.rotate = v; S.result = null; if (S.floors && S.floors[S.cur]) S.floors[S.cur].orientSet = true; syncPreview(); } });
    const mir = segmented({ options: [{ value: false, label: 'As drawn' }, { value: 'ns', label: 'Flip north–south' }, { value: 'ew', label: 'Flip east–west' }], value: S.mirror, label: 'Mirror',
      onChange: (v) => { S.mirror = v; S.result = null; if (S.floors && S.floors[S.cur]) S.floors[S.cur].orientSet = true; syncPreview(); } });
    // several floors: one set of location / north fields for the whole house, kept while the floor tabs switch
    if (!(multi() && place && place.keep)) {
      place = placeFields({ north: S.north, northHint: 'Clockwise from the top of the plan as shown; drag the arrow or type degrees.' });
      place.keep = multi();
      northInput = place.north;
      northInput.addEventListener('input', () => { const n = readNum(northInput); if (Number.isFinite(n)) { S.north = n; curDial && curDial.set(n); } });
    }
    curDial = dial;
    ceiling = multi() ? null : ceilingField(S.ceiling || 3.0);    // several floors: each floor's ceiling is in the floor list (step 1)
    setKids(content, h('div', { class: 'isplit isplit--orient' },
      h('div', { class: 'isplit__main' }, preview),
      h('div', { class: 'isplit__side newproj' },
        h('p', { class: 'iside__title' }, multi() ? `Which way up is the ${lowerFirst(floorAt(S.cur).name)}?` : 'Which way up?'),
        h('p', { class: 'iside__text' }, multi() ? 'Turn or flip each floor’s drawing so it shows the house the way you want to see the plan (if you leave it as it is, the next step tries the four turns to fit it over the floor below). North and the location are for the whole house.'
          : 'Turn the drawing so it shows the house the way you want to see the plan. A plan drawn for the mirror-image twin house can be flipped.'),
        h('div', { class: 'newproj__group' }, h('p', { class: 'newproj__label' }, 'Rotate'), rot),
        h('div', { class: 'newproj__group' }, h('p', { class: 'newproj__label' }, 'Mirror'), mir),
        place.el,
        ceiling ? ceiling.el : h('p', { class: 'iside__text' }, `Ceiling heights: ${S.floors.map((F) => `${F.name} ${(F.ceiling / 100).toFixed(2)} m`).join(', ')} — change them in the floor list (step 1).`))));
    if (multi()) content.prepend(floorTabs());
    syncPreview();
  }
  function northDial() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-50 -50 100 100'); svg.setAttribute('class', 'inorth'); svg.setAttribute('role', 'slider');
    svg.setAttribute('aria-label', 'North arrow: drag to point it to north'); svg.setAttribute('tabindex', '0');
    svg.innerHTML = '<circle r="44" class="inorth__ring"/><g class="inorth__arrow"><path d="M0 -38 L9 6 L0 0 L-9 6 Z"/></g><circle r="2.5" class="inorth__pin"/>';
    const arrow = svg.querySelector('.inorth__arrow');
    const set = (deg) => { arrow.setAttribute('transform', `rotate(${deg})`); svg.setAttribute('aria-valuenow', String(Math.round(deg))); };
    const fromEvent = (e) => {
      const r = svg.getBoundingClientRect();
      let deg = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180 / Math.PI;
      deg = Math.round(deg / (e.shiftKey ? 15 : 1)) * (e.shiftKey ? 15 : 1);
      if (deg > 180) deg -= 360;
      S.north = deg; set(deg); if (northInput) northInput.value = String(deg);
    };
    let dragging = false;
    svg.addEventListener('pointerdown', (e) => { dragging = true; svg.setPointerCapture?.(e.pointerId); fromEvent(e); });
    svg.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
    svg.addEventListener('pointerup', () => { dragging = false; });
    svg.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
      if (!d) return; e.preventDefault();
      S.north = ((S.north + d * (e.shiftKey ? 15 : 1) + 540) % 360) - 180; set(S.north); if (northInput) northInput.value = String(S.north);
    });
    const el = h('div', { class: 'inorth__box' }, svg, h('p', { class: 'inorth__label' }, 'North'));
    return { el, set };
  }
  function readOrient() {
    if (!place) return true;
    const p = place.read();
    if (!p.ok) { setError(p.reason); return false; }
    if (!ceiling) { S.location = p.location; S.north = p.northAngle; S.ceilingCm = floorAt(0).ceiling; return true; }
    const c = ceiling.read();
    if (!c.ok) { setError(c.reason); return false; }
    S.location = p.location; S.north = p.northAngle; S.ceilingCm = c.cm; S.ceiling = c.cm / 100;
    if (S.floors && S.floors[0]) S.floors[0].ceiling = c.cm;
    return true;
  }

  // ════════════════════════ analysis at the confirmed scale ════════════════════════
  async function analyse() {
    const sc = effScale();
    if (!sc) return false;
    const slantsOn = !!FEATURES.angledWalls && vector();      // angled / curved walls are converted only while the Settings switch is on (pictures have none)
    const key = JSON.stringify([S.kind, S.page, sc.cmPerUnit, S.drawing, S.rotate, S.mirror, S.dxf ? S.dxf.roles : null, slantsOn]);
    if (S.result && S.resultKey === key) return true;
    const res = await work(vector() ? 'Finding walls, doors and windows…' : 'Looking for walls in the picture…', async () => {
      if (S.kind === 'dxf') {
        const r = await engine('dxf-analyse', { prims: S.prims, opts: { candidates: S.dxf.candidates, layers: S.dxf.layers, roles: S.dxf.roles, scale: { cmPerUnit: sc.cmPerUnit }, walls: { drawing: S.drawing }, rotate: S.rotate, mirror: S.mirror, ...(slantsOn ? { slants: true } : {}) } });
        if (!r) return null;
        r.sheetTransform = r.walls.length ? r.transform : null;
        return r;
      }
      if (S.kind === 'pdf') {
        const r = await engine('analyse', { prims: S.prims, opts: { scale: { cmPerUnit: sc.cmPerUnit }, walls: { drawing: S.drawing }, rotate: S.rotate, mirror: S.mirror, ...(slantsOn ? { slants: true } : {}) } });
        if (!r) return null;
        r.sheetTransform = r.walls.length ? r.transform : null;   // page units → plan cm (none without walls: placed by scale below)
        return r;
      }
      const out = await engine('image', { image: pixelsOf(S.image.canvas), opts: { cmPerPx: sc.cmPerUnit, rotate: S.rotate, mirror: S.mirror } });
      if (!out) return null;
      let r = out.proposal || { walls: [], openings: [], warnings: out.warnings || [], unsupported: [], stats: {}, confidence: { overall: 0 } };
      r.sheetTransform = out.proposal ? out.proposal.imageTransform : null;
      if (r.walls.length < 4) {
        // a few stray pieces (lettering, a frame) are not a house: start empty, traced by hand over the picture
        r = { walls: [], openings: [], warnings: [], unsupported: [], stats: {}, confidence: { overall: 0 }, sheetTransform: null, strays: r.walls.length };
      }
      r.lowConfidence = true;
      r.deskew = out.deskew;
      return r;
    });
    if (!res) return false;
    if (!res.sheetTransform) res.sheetTransform = fallbackTransform(sc.cmPerUnit);
    res.slantsOn = slantsOn;
    S.result = res; S.resultKey = key; S.built = null;
    return true;
  }
  // ── several floors (F8): every floor read at its scale and orientation, stairs / openings looked for on each ──
  const marksOf = () => (vector() && S.prims && S.result && S.result.walls.length
    ? { stairs: detectStairSymbols(S.prims, S.result), voids: detectVoidSymbols(S.prims, S.result) } : { stairs: [], voids: [] });
  async function analyseAll() {
    let ok = true;
    await eachFloor(async (i, F) => {
      const before = S.resultKey, had = !!S.result;
      if (!(await analyse())) { ok = false; return false; }
      if (!had || S.resultKey !== before || !F.marks) {
        F.marks = marksOf();
        // this floor changed: its own alignment and the one of the floor above are proposed again
        F.align = null;
        if (S.floors[i + 1]) S.floors[i + 1].align = null;
        S.stairs = null; S.built = null;
      }
    });
    return ok;
  }
  /** No walls found: place the sheet by scale, rotation and mirror alone, its top-left corner at the plan origin. */
  function fallbackTransform(cmPerUnit) {
    const k = cmPerUnit, sx = S.mirror === 'ew' ? -1 : 1, sy = S.mirror === 'ns' ? -1 : 1;
    let m = [k * sx, 0, 0, k * sy, 0, 0];
    const r = ((S.rotate % 360) + 360) % 360;
    const R = r === 90 ? [0, 1, -1, 0, 0, 0] : r === 180 ? [-1, 0, 0, -1, 0, 0] : r === 270 ? [0, -1, 1, 0, 0, 0] : [1, 0, 0, 1, 0, 0];
    m = affThen(m, R);
    const box = sheetBox(m);
    return affThen(m, [1, 0, 0, 1, -box.x, -box.y]);
  }
  function sheetBox(T) {
    const pts = [[0, 0], [S.sheet.w, 0], [0, S.sheet.h], [S.sheet.w, S.sheet.h]].map(([u, v]) => affApply(T, u, v));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  // ════════════════════════ 4. review ════════════════════════
  const show = { page: true, detections: true };
  function renderReview() {
    const r = S.result;
    sheet.setMode('view');
    sheet.setHint('');
    sheet.showPage(show.page);
    sheet.setOverlay(reviewOverlay);
    const ext = r.walls.filter((w) => w.kind === 'exterior').length, int = r.walls.length - ext;
    const doors = r.openings.filter((o) => o.kind === 'door').length, wins = r.openings.filter((o) => o.kind === 'window').length;
    const other = r.openings.length - doors - wins;
    const sl = slantsOf(r), angled = sl.filter((q) => !q.chain).length, pieces = sl.length - angled, inSlants = r.openings.filter((o) => o.axis === 'a').length;
    const legend = h('ul', { class: 'ilegend' },
      h('li', { class: 'ilegend__item ilegend--ext' }, h('span', { class: 'ilegend__sw' }), `Exterior walls`, h('b', null, String(ext))),
      h('li', { class: 'ilegend__item ilegend--int' }, h('span', { class: 'ilegend__sw' }), `Interior walls`, h('b', null, String(int))),
      h('li', { class: 'ilegend__item ilegend--door' }, h('span', { class: 'ilegend__sw' }), `Doors`, h('b', null, String(doors))),
      h('li', { class: 'ilegend__item ilegend--win' }, h('span', { class: 'ilegend__sw' }), `Windows`, h('b', null, String(wins))),
      other ? h('li', { class: 'ilegend__item ilegend--pass' }, h('span', { class: 'ilegend__sw' }), `Passages and sliding doors`, h('b', null, String(other))) : null,
      angled ? h('li', { class: 'ilegend__item ilegend--ang' }, h('span', { class: 'ilegend__sw' }), `Angled walls`, h('b', null, String(angled)),
        inSlants ? h('span', { class: 'ilegend__sub' }, `with ${inSlants} opening${inSlants === 1 ? '' : 's'} in them (counted above)`) : null) : null,
      pieces ? h('li', { class: 'ilegend__item ilegend--ang' }, h('span', { class: 'ilegend__sw' }), `Curved wall pieces`, h('b', null, String(pieces))) : null,
      r.unsupported && r.unsupported.length ? h('li', { class: 'ilegend__item ilegend--uns' }, h('span', { class: 'ilegend__sw' }), `Not understood (angled / curved)`, h('b', null, String(r.unsupported.length))) : null);
    const banner = r.lowConfidence || S.kind === 'image'
      ? h('div', { class: 'lvlbanner lvlbanner--warn ibanner' }, h('span', { class: 'lvlbanner__icon' }, icon('warn', { size: 16 })),
        h('div', null, h('p', { class: 'lvlbanner__title' }, 'A starting point to trace over'),
          h('p', { class: 'lvlbanner__text' }, `Pictures cannot be read exactly: ${r.walls.length ? 'about three quarters of the walls are usually found, and most doors and windows are not' : 'no walls could be recognised in this picture'}. The picture is kept under the plan, so you can check, fix and draw everything with the Structure tools.`)))
      : null;
    const empty = !foundCount(r)
      ? h('div', { class: 'callout' }, icon('info', { size: 16 }), h('div', null, h('p', { class: 'callout__title' }, 'Nothing to convert automatically'),
        h('p', { class: 'callout__text' }, 'The project is still created — empty, with your drawing under the plan at the scale you set, so you can trace every wall with the wall tool.')))
      : null;
    const toggles = h('div', { class: 'itoggles' },
      checkbox('Show the page', show.page, (v) => { show.page = v; sheet.showPage(v); }),
      checkbox('Show what was found', show.detections, (v) => { show.detections = v; sheet.redraw(); }));
    setKids(content, h('div', { class: 'isplit' },
      h('div', { class: 'isplit__main' }, sheet.el),
      h('div', { class: 'isplit__side' },
        h('p', { class: 'iside__title' }, 'What was found'),
        banner, empty,
        legend, toggles,
        warningList(r))));
    requestAnimationFrame(() => { sheet.resize(); fitToResult(); });
  }
  function fitToResult() {
    const r = S.result;
    if (!r || !foundCount(r) || !r.stats || !r.stats.bounds) { sheet.fit(); return; }
    const inv = affInv(r.sheetTransform);
    const b = foundBox(r), pts = rectPts({ x: b.x, y: b.y, w: b.w, h: b.h }, 200).map(([x, y]) => affApply(inv, x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    sheet.fit({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  }
  function warningList(r) {
    const items = [];
    const n = (r.unsupported || []).length;
    if (n && r.slantsOn) items.push({ cls: 'warn', text: `${n} angled or curved wall piece${n === 1 ? '' : 's'} (outlined in amber) could not be turned into ${n === 1 ? 'a wall' : 'walls'} — for example a single line with no second face. Draw ${n === 1 ? 'it' : 'them'} by hand with the Structure tools after importing.` });
    else if (n) items.push({ cls: 'warn', text: `${n} wall piece${n === 1 ? ' is' : 's are'} angled or curved (outlined in amber). The plan engine only knows straight, square-on walls for now: redraw ${n === 1 ? 'it' : 'them'} by hand as straight walls after importing.` });
    for (const w of r.warnings || []) {
      if (['scale-guessed', 'raster', 'no-scale', 'angled-wall', 'curved-wall'].includes(w.code)) continue;
      if (w.code === 'several-drawings') { items.push({ cls: 'info', text: `The sheet holds ${S.first && S.first.drawings ? S.first.drawings.length : 'several'} drawings; drawing ${S.drawing + 1} was read. Go back to step 1 to choose another.` }); continue; }
      items.push({ cls: 'info', text: w.text });
    }
    if (!items.length) return h('p', { class: 'iside__text' }, 'No problems were reported. Still, compare the walls with the drawing before you fix the plan.');
    return h('div', { class: 'iwarns' }, h('p', { class: 'newproj__label' }, 'Notes from the reader'),
      h('ul', { class: 'iwarns__list' }, items.map((it) => h('li', { class: `iwarns__item iwarns--${it.cls}` }, icon(it.cls === 'warn' ? 'warn' : 'info', { size: 14 }), h('span', null, it.text)))),
      n && !r.slantsOn ? h('p', { class: 'iwarns__hint' }, 'Angled walls can be imported — turn on “Angled walls (in development)” in Settings → Experimental and import again.') : null);
  }
  function reviewOverlay(ctx, V) {
    const r = S.result;
    if (!r || !show.detections) return;
    const inv = affInv(r.sheetTransform);
    const P = (x, y) => { const p = affApply(inv, x, y); return [V.X(p[0]), V.Y(p[1])]; };
    const poly = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => { const q = P(x, y); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath(); };
    const col = colors();
    for (const w of r.walls) {
      poly(rectPts(w));
      ctx.fillStyle = w.kind === 'exterior' ? col.extFill : col.intFill; ctx.fill();
      ctx.strokeStyle = w.kind === 'exterior' ? col.ext : col.int; ctx.lineWidth = 1; ctx.stroke();
    }
    const sl = slantsOf(r), polys = slantPolys(r);
    sl.forEach((q, i) => {
      const pts = polys[i] || freePolyOf(q);
      poly(pts);
      ctx.fillStyle = q.kind === 'exterior' ? col.extFill : col.intFill; ctx.fill();
      ctx.strokeStyle = q.kind === 'exterior' ? col.ext : col.int; ctx.lineWidth = 1; ctx.stroke();
    });
    for (const o of r.openings) {
      if (o.axis === 'a') { drawSlantOpening(ctx, o, sl.find((q) => q.id === o.wall), P, col); continue; }
      poly(rectPts(o));
      const c = o.kind === 'door' ? col.door : o.kind === 'window' ? col.win : col.pass;
      ctx.fillStyle = c + '33'; ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.stroke();
      if (o.kind === 'door') drawSwing(ctx, o, P, c);
      if (o.kind === 'window') {
        const lines = o.axis === 'h' ? [[o.x, o.y + o.h * 0.4, o.x + o.w, o.y + o.h * 0.4], [o.x, o.y + o.h * 0.6, o.x + o.w, o.y + o.h * 0.6]] : [[o.x + o.w * 0.4, o.y, o.x + o.w * 0.4, o.y + o.h], [o.x + o.w * 0.6, o.y, o.x + o.w * 0.6, o.y + o.h]];
        ctx.beginPath(); for (const [x1, y1, x2, y2] of lines) { const a = P(x1, y1), b = P(x2, y2); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); } ctx.stroke();
      }
    }
    for (const u of r.unsupported || []) {
      poly(rectPts(u, 15));
      ctx.setLineDash([5, 3]); ctx.strokeStyle = col.uns; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col.uns + '22'; ctx.fill();
    }
  }
  /** An opening in an angled wall: the gap, then a door's leaf(s) and swing arc or a window's two glass lines, turned with the wall. */
  function drawSlantOpening(ctx, o, q, P, col) {
    if (!q) return;
    const f = slantFrame(q), c = o.kind === 'door' ? col.door : o.kind === 'window' ? col.win : col.pass;
    const path = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => { const p = P(x, y); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); };
    path(openingQuad(q, o.at, o.width)); ctx.closePath();
    ctx.fillStyle = c + '33'; ctx.fill(); ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.stroke();
    const at = (a, off) => [q.x1 + f.ux * a + f.nx * off, q.y1 + f.uy * a + f.ny * off];
    if (o.kind === 'window') {
      for (const k of [0.4, 0.6]) { const off = (k - 0.5) * q.t; path([at(o.at - o.width / 2, off), at(o.at + o.width / 2, off)]); ctx.stroke(); }
      return;
    }
    if (o.kind !== 'door') return;
    ctx.strokeStyle = c; ctx.lineWidth = 1.2;
    // a leaf: hinge on the swing-side face at the jamb, open leaf along that side's normal, arc back to the wall line
    const leaf = (jamb, side, rad, from, to) => {
      const sg = side === 'r' ? 1 : -1, n = [f.nx * sg, f.ny * sg], dir = jamb === 'a' ? [f.ux, f.uy] : [-f.ux, -f.uy];
      const Hh = at(jamb === 'a' ? from : to, sg * q.t / 2), L = [Hh[0] + n[0] * rad, Hh[1] + n[1] * rad];
      path([Hh, L]); ctx.stroke();
      const arc = [];
      for (let i = 0; i <= 16; i++) { const t = (i / 16) * Math.PI / 2, cs = Math.cos(t), sn = Math.sin(t); arc.push([Hh[0] + rad * (n[0] * cs + dir[0] * sn), Hh[1] + rad * (n[1] * cs + dir[1] * sn)]); }
      path(arc); ctx.stroke();
    };
    const a0 = o.at - o.width / 2, a1 = o.at + o.width / 2, sw = o.swing || 'r';
    if (o.leaves === 2) { leaf('a', sw, o.width / 2, a0, a1); leaf('b', sw, o.width / 2, a0, a1); }
    else leaf(o.hinge === 'b' ? 'b' : 'a', sw, o.width, a0, a1);
    if (o.innerDoor) { ctx.setLineDash([4, 3]); leaf(o.innerDoor.hinge === 'b' ? 'b' : 'a', o.innerDoor.swing || 'r', o.width, a0, a1); ctx.setLineDash([]); }
  }
  function drawSwing(ctx, o, P, c) {
    const along = o.axis === 'h' ? o.w : o.h;
    const leaf = (atStart, swing, rad) => {
      const f = o.axis === 'h' ? (swing === 's' ? o.y + o.h : o.y) : (swing === 'e' ? o.x + o.w : o.x);
      const n = o.axis === 'h' ? [0, swing === 's' ? 1 : -1] : [swing === 'e' ? 1 : -1, 0];
      const H = o.axis === 'h' ? [atStart ? o.x : o.x + o.w, f] : [f, atStart ? o.y : o.y + o.h];
      const dir = o.axis === 'h' ? [atStart ? 1 : -1, 0] : [0, atStart ? 1 : -1];
      const L = [H[0] + n[0] * rad, H[1] + n[1] * rad];
      const a = P(H[0], H[1]), b = P(L[0], L[1]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      // a quarter arc from the open leaf to the closed position along the wall
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) {
        const t = (i / 16) * Math.PI / 2, cs = Math.cos(t), sn = Math.sin(t);
        const q = P(H[0] + rad * (n[0] * cs + dir[0] * sn), H[1] + rad * (n[1] * cs + dir[1] * sn));
        if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
      }
      ctx.stroke();
    };
    const atStart = (hinge) => hinge === 'n' || hinge === 'w';
    const sw = o.swing || (o.axis === 'h' ? 's' : 'e');
    ctx.strokeStyle = c; ctx.lineWidth = 1.2;
    if (o.leaves === 2) { leaf(true, sw, along / 2); leaf(false, sw, along / 2); }
    else leaf(atStart(o.hinge || (o.axis === 'h' ? 'w' : 'n')), sw, along);
    if (o.innerDoor) { ctx.setLineDash([4, 3]); leaf(atStart(o.innerDoor.hinge), o.innerDoor.swing, along); ctx.setLineDash([]); }
  }

  // ════════════════════════ 5. create ════════════════════════
  let nameInput;
  function renderCreate() {
    sheet.setOverlay(null);
    nameInput = h('input', { class: 'field__input', type: 'text', value: S.name, maxlength: '60', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Project name', 'data-autofocus': '', style: 'text-align:left',
      onInput: () => { S.name = nameInput.value; S.nameFromFile = false; }, onKeydown: (e) => { if (e.key === 'Enter') next(); } });
    const built = S.built || (S.built = build());
    const errs = built.warnings.filter((w) => w.level === 'error'), warns = built.warnings.filter((w) => w.level === 'warning'), infos = built.warnings.filter((w) => w.level === 'info');
    const r = S.result;
    const facts = h('ul', { class: 'ifacts' },
      h('li', null, h('b', null, String(built.plan.walls.length)), ' wall pieces'),
      (built.plan.slants || []).length ? h('li', null, h('b', null, String(built.plan.slants.length)), ` angled wall${built.plan.slants.length === 1 ? '' : 's'}`) : null,
      h('li', null, h('b', null, String(built.plan.openings.length)), ' doors, windows and passages'),
      h('li', null, h('b', null, String(built.plan.rooms.length)), ' rooms'),
      h('li', null, 'Scale ', h('b', null, currentScale().label)));
    const list = (items, cls, title) => (items.length ? h('div', { class: `iwarns iwarns--block` }, h('p', { class: 'newproj__label' }, title),
      h('ul', { class: 'iwarns__list' }, items.map((w) => h('li', { class: `iwarns__item iwarns--${cls}` }, icon(cls === 'fail' ? 'fail' : cls === 'warn' ? 'warn' : 'info', { size: 14 }), h('span', null, w.text))))) : null);
    setKids(content, h('div', { class: 'icreate' },
      h('div', { class: 'icreate__main newproj' },
        field('Name', nameInput),
        facts,
        errs.length ? h('div', { class: 'lvlbanner lvlbanner--locked ibanner' }, h('span', { class: 'lvlbanner__icon' }, icon('fail', { size: 16 })),
          h('div', null, h('p', { class: 'lvlbanner__title' }, 'Some pieces could not be used'),
            h('p', { class: 'lvlbanner__text' }, 'They are listed below and will be left out. You can go back and change the scale, orientation or drawing, or create the project anyway with what was understood and add the missing pieces with the Structure tools.'))) : null,
        list(errs, 'fail', 'Left out'),
        list(warns, 'warn', 'Check'),
        list(infos.filter((w) => !/moved by/.test(w.text)), 'info', 'Notes'),
        h('div', { class: 'callout' }, icon('note', { size: 16 }), h('div', null, h('p', { class: 'callout__title' }, 'What happens next'),
          h('p', { class: 'callout__text' }, `A new project opens as a draft in Structure mode, with your drawing under the plan${r.lowConfidence ? '' : ' exactly where the walls were found'}. Everything stays editable until you say “This is the house as built”. Your other projects are not changed.`))))));
    setTimeout(() => { nameInput.focus(); nameInput.select(); }, 30);
  }
  function build() {
    const r = S.result;
    const meta = { name: S.name || 'Imported house', location: S.location ? S.location.name : '', latitude: S.location && S.location.latitude, longitude: S.location && S.location.longitude, timeZone: S.location && S.location.timeZone, northAngle: S.north || 0 };
    const heights = { ceiling: S.ceilingCm || 300 };
    if (!foundCount(r)) {
      const box = sheetBox(r.sheetTransform);
      const boundary = [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]].map(([x, y]) => [Math.round(x), Math.round(y)]);
      const b = buildPlan({ walls: [], openings: [], meta, heights, site: { boundary } });
      b.shift = { x: 0, y: 0 };
      return b;
    }
    const input = { walls: r.walls.map(({ id, x, y, w, h: hh, kind }) => ({ id, x, y, w, h: hh, kind })), openings: r.openings.map(({ confidence, ...o }) => o), meta, heights };
    if (!slantsOf(r).length) {
      const minX = Math.min(...r.walls.map((w) => w.x)), minY = Math.min(...r.walls.map((w) => w.y));
      const b = buildPlan(input, r.slantsOn ? { slants: true } : undefined);
      b.shift = { x: -minX, y: -minY };           // buildPlan moves the house's NW corner to the origin
      return b;
    }
    // angled walls: the origin also covers their footprints (whole cm), so the move is the one buildPlan reports
    input.slants = slantsOf(r).map(({ id, x1, y1, x2, y2, t, kind, chain }) => ({ id, x1, y1, x2, y2, t, kind, ...(chain ? { chain } : {}) }));
    const b = buildPlan(input, { slants: true });
    const moved = b.warnings.map((w) => /moved by (-?[\d.]+) cm east–west and (-?[\d.]+) cm north–south/.exec(w.text)).find(Boolean);
    b.shift = moved ? { x: -Number(moved[1]), y: -Number(moved[2]) } : { x: 0, y: 0 };
    b.warnings.push(...slantWarnings(input.slants, b.plan));
    return b;
  }
  async function create() {
    if (S.busy) return;
    const built = S.built || (S.built = build());
    const name = (nameInput && nameInput.value.trim()) || S.name || 'Imported house';
    let underlay = null;
    const res = await work('Creating the project…', async () => {
      underlay = await makeUnderlay(built.shift);
      if (built.plan.meta) built.plan.meta.name = name;
      return app.projects.create({ name, fromPlan: built.plan, underlay });
    });
    if (!res) return;
    if (!res.ok) { setError(res.reason || 'The project could not be created.'); return; }
    dlg.close();
    toast(`Created “${res.project.name}” — a draft over your drawing`, { kind: 'success' });
    try { app.structure && app.structure.enter(); } catch (e) { /* the 2D view may be busy */ }
    showNextCard(app, { lowConfidence: !!S.result.lowConfidence, empty: !foundCount(S.result) });
  }
  /** The stored underlay: the page / picture around the house, re-encoded, with its image px → plan cm transform. */
  async function makeUnderlay(shift) {
    const r = S.result;
    const T = affThen(r.sheetTransform, [1, 0, 0, 1, shift.x, shift.y]);         // sheet units → plan cm
    let src = S.sheet.canvas, ppu = S.sheet.ppu, crop;
    if (vector()) {
      // the page around the house with a generous margin (keeps the stored image compact), rendered sharper
      const b = foundCount(r) && r.stats && r.stats.bounds ? foundBox(r) : null;
      let box = { x: 0, y: 0, w: S.sheet.w, h: S.sheet.h };
      if (b) {
        const m = Math.max(600, 0.35 * Math.max(b.w, b.h));
        const inv = affInv(r.sheetTransform);
        const pts = rectPts(b, m).map(([x, y]) => affApply(inv, x, y));
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const x0 = Math.max(0, Math.min(...xs)), y0 = Math.max(0, Math.min(...ys));
        box = { x: x0, y: y0, w: Math.min(S.sheet.w, Math.max(...xs)) - x0, h: Math.min(S.sheet.h, Math.max(...ys)) - y0 };
      }
      if (S.kind === 'dxf') {
        // a fresh rendering of just that part of the drawing (all visible layers), sharp enough to trace over
        const want = Math.min(6, 2400 / Math.max(box.w, box.h));
        const hi = renderPrims(S.prims, { pxPerUnit: want, crop: box, hide: dxfHidden() });
        const enc = encodeUnderlay(hi.canvas);
        const toSheet = [1 / (enc.k * hi.pxPerUnit), 0, 0, 1 / (enc.k * hi.pxPerUnit), box.x + enc.x / hi.pxPerUnit, box.y + enc.y / hi.pxPerUnit];
        return { image: enc.image, width: enc.width, height: enc.height, transform: affThen(toSheet, T).map((v) => +v.toFixed(6)), opacity: 0.55, visible: true,
          source: { kind: 'dxf', name: S.fileName, page: null, lowConfidence: !!r.lowConfidence, units: S.prims.dxf.units.name } };
      }
      try {
        const want = Math.min(4, 2600 / Math.max(box.w, box.h), 4800 / Math.max(S.sheet.w, S.sheet.h));
        if (want > ppu * 1.15) { const hi = await renderPage(S.bytes, S.page, want * Math.max(S.sheet.w, S.sheet.h), { w: S.sheet.w, h: S.sheet.h }); src = hi.canvas; ppu = hi.pxPerUnit; }
      } catch (e) { /* keep the preview rendering */ }
      crop = { x: box.x * ppu, y: box.y * ppu, w: box.w * ppu, h: box.h * ppu };
    }
    const enc = encodeUnderlay(src, crop);
    // stored px → canvas px (x / k + crop origin) → sheet units (/ ppu) → plan cm (T)
    const toSheet = [1 / (enc.k * ppu), 0, 0, 1 / (enc.k * ppu), enc.x / ppu, enc.y / ppu];
    return {
      image: enc.image, width: enc.width, height: enc.height,
      transform: affThen(toSheet, T).map((v) => +v.toFixed(6)),
      opacity: 0.55, visible: true,
      source: { kind: S.kind === 'pdf' ? 'pdf' : S.sheet.fromPdf ? 'pdf-scan' : 'image', name: S.fileName, page: S.pdf ? S.page : null, lowConfidence: !!r.lowConfidence },
    };
  }

  // ── start ──
  render();
  if (opts.file) chooseFile(opts.file);
  // test / diagnostics handle (not part of the contract)
  dlg.el._import = { state: S, sheet, go, next };
  return dlg;
}

// ── helpers ──
/** What buildPlan changed about the angled walls without saying so (it only reports errors): plain-words notes. */
function slantWarnings(input, plan) {
  const out = [], n = (k, one, many) => (k === 1 ? one : many);
  const straight = input.filter((q) => { const off = Math.atan2(Math.abs(q.y2 - q.y1), Math.abs(q.x2 - q.x1)) * 180 / Math.PI; return off <= 0.5 || off >= 89.5; }).length;
  if (straight) out.push({ level: 'info', text: `${straight} angled wall piece${n(straight, ' was', 's were')} within ½° of straight and became ${n(straight, 'an ordinary straight wall', 'ordinary straight walls')}.` });
  const kept = plan.slants || [];
  if (kept.length) {
    try {
      const ends = slantJoins(kept, plan.walls).filter((j) => j.ends.some((e) => e.type === 'free')).length;
      if (ends) out.push({ level: 'warning', text: `${ends} angled wall${n(ends, ' has an end that does not', 's have an end that does not')} meet another wall — check ${n(ends, 'it', 'them')} against the drawing.` });
    } catch (e) { /* the join check is only advice */ }
  }
  return out;
}
const slantsOf = (r) => (r && Array.isArray(r.slants) ? r.slants : []);
/** Rectangles + angled / curved pieces found (the review and the create step treat both as "walls"). */
const foundCount = (r) => r.walls.length + slantsOf(r).length;
const freePolyOf = (q) => { const f = slantFrame(q); return [[q.x1 - f.nx * f.hw, q.y1 - f.ny * f.hw], [q.x2 - f.nx * f.hw, q.y2 - f.ny * f.hw], [q.x2 + f.nx * f.hw, q.y2 + f.ny * f.hw], [q.x1 + f.nx * f.hw, q.y1 + f.ny * f.hw]]; };
/** The slants' footprints as the plan engine will join them (mitred at junctions), memoised on the result. */
function slantPolys(r) {
  if (r._polys) return r._polys;
  let polys = [];
  try { polys = joinSlants(slantsOf(r), r.walls).map((q) => q.poly); } catch (e) { polys = []; }
  return (r._polys = polys);
}
/** Bounding box (plan cm, as found) of the rectangles and the angled pieces. */
function foundBox(r) {
  const b = r.stats && r.stats.bounds;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  if (b && r.walls.length) { x0 = b.x; y0 = b.y; x1 = b.x + b.w; y1 = b.y + b.h; }
  const polys = slantPolys(r);
  slantsOf(r).forEach((q, i) => { for (const [x, y] of polys[i] || freePolyOf(q)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } });
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : b;
}
function rectPts(r, pad = 0) { return [[r.x - pad, r.y - pad], [r.x + r.w + pad, r.y - pad], [r.x + r.w + pad, r.y + r.h + pad], [r.x - pad, r.y + r.h + pad]]; }
function label(ctx, text, x, y, color) {
  ctx.font = '600 12px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(x, y, w, 18);
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 17);
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 5, y + 9.5);
}
function checkbox(text, checked, onChange) {
  const input = h('input', { type: 'checkbox', class: 'check__input', checked: !!checked, onChange: () => onChange(input.checked) });
  return h('label', { class: 'check' }, input, h('span', { class: 'check__label' }, text));
}
function colors() {
  const cs = getComputedStyle(document.documentElement);
  const get = (n, f) => (cs.getPropertyValue(n).trim() || f);
  const hex = (v, f) => (/^#[0-9a-f]{6}$/i.test(v) ? v : f);
  const ext = hex(get('--imp-ext', '#1d4e89'), '#1d4e89'), int = hex(get('--imp-int', '#256e43'), '#256e43');
  return {
    ext, int, extFill: ext + '8c', intFill: int + '80',
    door: hex(get('--imp-door', '#6a3d9a'), '#6a3d9a'), win: hex(get('--imp-win', '#0f7d8c'), '#0f7d8c'), pass: hex(get('--imp-pass', '#4b5759'), '#4b5759'),
    uns: hex(get('--imp-uns', '#c77800'), '#c77800'),
  };
}

/** After the import: a small card over the plan with what to do next. */
export function showNextCard(app, { lowConfidence = false, empty = false } = {}) {
  const old = document.querySelector('.inext');
  if (old) old.remove();
  const steps = empty
    ? ['Trace the walls over your drawing with the wall tool (W) — drag along each wall’s centre line.', 'Add the doors (D) and windows (N).', 'Name the rooms in the Rooms tab.']
    : [lowConfidence ? 'Check every wall against the drawing — fix, add or delete walls with the Structure tools.' : 'Check the walls against the drawing (the sketch under the plan).',
      lowConfidence ? 'Add the doors and windows: few are found in pictures.' : 'Fix doors and windows: swing, width, height and sill.',
      'Name the rooms in the Rooms tab.'];
  const close = () => el.remove();
  const el = h('section', { class: 'inext', role: 'dialog', 'aria-label': 'What next' },
    h('header', { class: 'inext__head' }, h('p', { class: 'inext__title display' }, 'Your sketch is now a draft'), h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Close', onClick: close }, icon('close', { size: 16 }))),
    h('ol', { class: 'inext__list' }, steps.map((s) => h('li', null, s)), h('li', null, 'Then press “This is the house as built…” in the Structure guide.')),
    h('p', { class: 'inext__hint' }, 'The drawing’s strength, re-aligning and removing it are in the Structure guide under “Sketch underlay”.'),
    btn('Got it', { small: true, variant: 'primary', onClick: close }));
  layer().append(el);
  // beside the Structure guide (not over it) where the guide is docked
  try {
    const side = document.getElementById('left'), r = side && side.getBoundingClientRect();
    if (r && r.width > 0 && r.right > 0 && !(app.isCompact && app.isCompact())) el.style.left = `${Math.round(r.right + 16)}px`;
  } catch (e) { /* default position */ }
  const off = app.store.on('base', () => { close(); off && off(); });
  return el;
}
