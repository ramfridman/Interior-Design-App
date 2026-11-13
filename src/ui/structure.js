/**
 * Structure mode: the owner changes walls, doors and windows "based on what is allowed" (docs/CONTRACT.md § 7).
 *
 * There is no separate mode flag — the app is in Structure mode whenever `store.ui.tool` is one of STRUCTURE_TOOLS.
 * This module owns the vocabulary shared by every structure panel (levels, titles, names), the commands that go
 * through core/plan-edit.js (remove, nudge, reset — with the confirmations the owner asked for) and the toasts for
 * what the plan view reports about its own gestures (`view2d.on('structure', …)`).
 */
import { wallSegments, openingPolicy, removeWallSegment, removeOpening, moveWallSegment, updateOpening, resetPlan, planDiff, isPlanModified } from '../core/plan-edit.js';
import { h, call, listen } from './dom.js';
import { icon } from './icons.js';
import { confirmDialog, toast } from './dialogs.js';

export const STRUCTURE_TOOLS = ['structure', 'wall', 'door', 'window', 'passage'];
export const isStructureTool = (tool) => STRUCTURE_TOOLS.includes(tool);
export const WALL_THICKNESSES = [7, 10, 15, 20];
/** Every plan edit snaps to this grid (cm). */
export const STEP = 5;

/** The four levels, in the owner's words. `--level-<id>` / `--level-<id>-soft` are the matching colour tokens. */
export const LEVEL_ORDER = ['free', 'warn', 'permit', 'locked'];
export const LEVELS = {
  free: { label: 'Free', title: 'Free to change', icon: 'pass', what: '10 cm partitions and interior doors', text: 'Add, move or remove them as you like.' },
  warn: { label: 'Check with engineer', title: 'Check with your engineer', icon: 'engineer', what: '20 cm interior walls', text: 'They may be structural. Confirm with your structural engineer before changing one.' },
  permit: { label: 'Permit needed', title: 'Permit needed', icon: 'permit', what: 'Windows and doors in exterior walls', text: 'Moving, resizing, adding or closing one needs a building-permit amendment.' },
  locked: { label: 'Locked', title: 'Locked', icon: 'lock', what: 'Exterior walls and the whole safe-room shell', text: 'Including the safe room’s window and both its doors (Civil Defence regulations).' },
};
const levelOf = (level) => (LEVELS[level] ? level : 'free');

/** Small level badge: icon + label in the level colour. */
export function levelTag(level) {
  const id = levelOf(level);
  return h('span', { class: `lvl lvl--${id}` }, icon(LEVELS[id].icon, { size: 13 }), h('span', null, LEVELS[id].label));
}

/** Level banner: what this level means for the thing in front of the user, with the engine's reason. */
export function levelBanner(level, reason) {
  const id = levelOf(level);
  return h('div', { class: `lvlbanner lvlbanner--${id}`, role: 'note' },
    h('span', { class: 'lvlbanner__icon' }, icon(LEVELS[id].icon, { size: 16 })),
    h('div', { class: 'lvlbanner__body' }, h('p', { class: 'lvlbanner__title' }, LEVELS[id].title), h('p', { class: 'lvlbanner__text' }, reason || LEVELS[id].text)));
}

/** Name of the space on one side of a wall: a room, an outdoor area, or the garden. */
export function spaceName(id, plan) {
  const space = [...(plan.rooms || []), ...(plan.outdoorAreas || [])].find((s) => s.id === id);
  return space ? space.name : 'the garden';
}
/** "Between Bedroom 1 and the garden" / "Inside Living · Dining · Kitchen". */
export function segmentSides(seg, plan) {
  const [a, b] = seg.between || [];
  return a === b ? `Inside ${spaceName(a, plan)}` : `Between ${spaceName(a, plan)} and ${spaceName(b, plan)}`;
}
export function segmentTitle(seg) {
  if (seg.cls === 'mamad') return 'Safe-room wall';
  if (seg.cls === 'exterior') return 'Exterior wall';
  if (seg.cls === 'thick') return `Interior wall ${seg.thickness} cm`;
  return 'Partition wall';
}
const OPENING_TITLES = {
  door: { interior: 'Interior door', entry: 'Entrance door', service: 'Service door', mamad: 'Safe-room blast door' },
  window: { sliding: 'Sliding window', tilt: 'Tilt window', mamad: 'Safe-room window' },
  'sliding-door': { 'glass-sliding': 'Sliding glass door' },
  opening: { open: 'Open passage' },
};
const OPENING_KINDS = { door: 'Door', window: 'Window', 'sliding-door': 'Sliding door', opening: 'Passage' };
export const openingKind = (o) => OPENING_KINDS[o.kind] || 'Opening';
export const openingTitle = (o) => (OPENING_TITLES[o.kind] && OPENING_TITLES[o.kind][o.style]) || openingKind(o);
export const openingIcon = (o) => (o.kind === 'window' ? 'window' : o.kind === 'opening' ? 'passage' : 'door');
/** Distance from the start (west / north end) of the wall segment to the near jamb of an opening, cm. */
export const openingOffset = (o, seg) => (seg ? (o.axis === 'h' ? o.x - seg.core.x : o.y - seg.core.y) : 0);

/** @param {object} app  UI context */
export function createStructure(app) {
  const { store, plan, view2d } = app;
  const root = document.getElementById('app');
  const planShown = () => store.ui.mode === '2d' || store.ui.mode === 'split';
  const undo = { label: 'Undo', fn: () => store.undo() };
  let diff = null;
  let lastWarning = { text: '', at: 0 };
  let toolChangedAt = -1;

  /** A warning that came back from the engine, in its level colour. The same text is not stacked while it is showing. */
  function levelToast(text, level) {
    if (!text) return;
    const now = Date.now();
    if (text === lastWarning.text && now - lastWarning.at < 5000) return;
    lastWarning = { text, at: now };
    toast(text, { level: levelOf(level) });
  }

  const api = {
    isActive: () => isStructureTool(store.ui.tool),
    /** Switch a structure tool on (entering Structure mode from Furnish, 3D or the walk-through if needed). */
    setTool(tool = 'structure') {
      if (!isStructureTool(tool)) return;
      const entering = !api.isActive();
      if (entering) store.clearSelection();
      store.setUI(planShown() ? { tool } : { tool, mode: '2d' });
      // Narrow screens keep the guide in a drawer: say what the mode is for and where the rules are.
      if (entering && app.isCompact()) toast('Structure: tap a wall, door or window to change it', { action: { label: 'Guide', fn: () => app.openPanel('catalog') } });
    },
    enter() { if (!api.isActive()) api.setTool('structure'); },
    exit() { if (api.isActive()) store.setUI({ tool: 'select', structureSel: null }); },
    toggle() { if (api.isActive()) api.exit(); else api.enter(); },
    /**
     * Esc: a wall / door / window / passage tool goes back to Select; from Select, leave Structure. The plan view
     * follows the same rule for its own gestures — when it already changed the tool during this very key press
     * (`event`), there is nothing left to do.
     */
    escape(event) {
      if (event && toolChangedAt >= event.timeStamp) return;
      if (store.ui.tool !== 'structure') store.setUI({ tool: 'structure' });
      else api.exit();
    },

    /** The selected wall segment / opening resolved against the current plan, or null. */
    selected() {
      const sel = store.ui.structureSel;
      if (!sel || !sel.id) return null;
      if (sel.type === 'segment') {
        const seg = wallSegments().find((s) => s.id === sel.id);
        return seg ? { type: 'segment', id: seg.id, seg } : null;
      }
      const opening = sel.type === 'opening' ? plan.openings.find((o) => o.id === sel.id) : null;
      if (!opening) return null;
      return { type: 'opening', id: opening.id, opening, seg: wallSegments().find((s) => s.openingIds.includes(opening.id)) || null, policy: openingPolicy(opening.id) };
    },
    select(type, id) {
      const cur = store.ui.structureSel;
      if (!id) { if (cur) store.setUI({ structureSel: null }); return; }
      if (!cur || cur.type !== type || cur.id !== id) store.setUI({ structureSel: { type, id } });
    },

    /** Changes against the architect's plan (cached until the plan changes). */
    diff() { return diff || (diff = isPlanModified() ? planDiff() : { changed: false, items: [] }); },
    isModified: () => isPlanModified(),

    /**
     * Handle an engine result: warnings become level toasts. Returns the refusal text ('' when it went through) so
     * the caller can show it next to the control that asked.
     */
    report(res) {
      if (!res) return 'That change is not possible here.';
      if (!res.ok) return res.reason || 'That change is not possible here.';
      for (const text of res.warnings || []) levelToast(text, res.level);
      return '';
    },

    /** Remove a wall segment; a wall that may be structural is confirmed first. `quiet` leaves refusals to the caller. */
    async removeSegment(seg, { quiet = false } = {}) {
      const { level, reason } = seg.policy;
      if (level === 'locked') { if (!quiet) toast(reason, { level: 'locked' }); return { ok: false, reason }; }
      if (level === 'warn') {
        const [a, b] = seg.between || [];
        const ok = await confirmDialog({
          title: `Remove this ${seg.thickness} cm wall?`, confirmLabel: 'Remove wall', danger: true,
          body: [levelBanner('warn', reason),
            h('p', { class: 'dialog__text dialog__text--after' }, a === b ? 'The wall is taken out of the plan' : `${spaceName(a, plan)} and ${spaceName(b, plan)} will merge into one room`,
              seg.openingIds.length ? ', and the doors in this wall go with it.' : '.', ' You can undo this.')],
        });
        if (!ok) return { ok: false, cancelled: true };
      }
      const res = removeWallSegment(seg.id);
      if (res.ok) { api.select(null); toast('Wall removed', { action: undo }); }
      else if (!quiet) toast(res.reason, { kind: 'warn' });
      return res;
    },
    /** Remove a door / window / passage; an exterior opening (permit) is confirmed first. */
    async removeOpening(opening, { quiet = false } = {}) {
      const { level, reason } = openingPolicy(opening.id);
      const kind = openingKind(opening).toLowerCase();
      if (level === 'locked') { if (!quiet) toast(reason, { level: 'locked' }); return { ok: false, reason }; }
      if (level === 'permit') {
        const ok = await confirmDialog({
          title: `Remove this ${kind}?`, confirmLabel: `Remove ${kind}`, danger: true,
          body: [levelBanner('permit', reason), h('p', { class: 'dialog__text dialog__text--after' }, 'The opening is closed with wall. You can undo this.')],
        });
        if (!ok) return { ok: false, cancelled: true };
      }
      const res = removeOpening(opening.id);
      if (res.ok) { api.select(null); toast(`${openingKind(opening)} removed`, { action: undo }); }
      else if (!quiet) toast(res.reason, { kind: 'warn' });
      return res;
    },
    /** Delete key: remove whatever is selected in the plan. */
    removeSelected() {
      const cur = api.selected();
      if (!cur) return null;
      return cur.type === 'segment' ? api.removeSegment(cur.seg) : api.removeOpening(cur.opening);
    },

    /** Move a wall sideways by `delta` cm and keep it selected under its new id. */
    moveSegment(seg, delta) {
      const res = moveWallSegment(seg.id, delta);
      if (res.ok && res.ids && res.ids[0]) api.select('segment', res.ids[0]);
      return res;
    },
    /** Arrow keys: one 5 cm step — a wall sideways, an opening along its wall. Returns true when the key was used. */
    nudge(dx, dy) {
      const cur = api.selected();
      if (!cur) return false;
      const axis = cur.type === 'segment' ? cur.seg.axis : cur.opening.axis;
      const d = cur.type === 'segment' ? (axis === 'v' ? dx : dy) : (axis === 'h' ? dx : dy);
      if (!d) return false;
      const res = cur.type === 'segment' ? api.moveSegment(cur.seg, d * STEP) : updateOpening(cur.id, { offset: openingOffset(cur.opening, cur.seg) + d * STEP });
      const refusal = api.report(res);
      const locked = (cur.type === 'segment' ? cur.seg.policy.level : cur.policy.level) === 'locked';
      if (refusal && locked) levelToast(refusal, 'locked');
      else if (refusal) toast(refusal, { kind: 'warn' });
      return true;
    },

    /** Back to the architect's plan, after asking. */
    async reset() {
      if (!isPlanModified()) return;
      const n = api.diff().items.length;
      const ok = await confirmDialog({
        title: 'Reset to the architect’s plan?', confirmLabel: 'Reset plan', danger: true,
        message: `${n > 1 ? `All ${n} changes` : 'Your changes'} to walls, doors and windows are undone and the rooms go back to the architect’s drawing. Furniture stays where it is. You can undo this.`,
      });
      if (!ok) return;
      const res = resetPlan();
      if (res.ok) { api.select(null); toast('Back to the architect’s plan', { action: undo }); }
    },

    /** Bring a plan point into view (switching to the plan if it is hidden). */
    focusPoint(at) {
      if (!at || typeof at.x !== 'number' || typeof at.y !== 'number') return;
      const go = () => {
        if (view2d && typeof view2d.focusPlanPoint === 'function') call(view2d, 'focusPlanPoint', at.x, at.y);
        else call(view2d, 'fit', { x: at.x - 260, y: at.y - 260, w: 520, h: 520 }, { animate: true });
      };
      if (app.isCompact()) app.closePanels();
      if (planShown()) go();
      else { store.setUI({ mode: '2d' }); requestAnimationFrame(() => requestAnimationFrame(go)); }   // after the pane was laid out
    },
    /** Show one entry of planDiff() on the plan; in Structure mode also select what it refers to, if it still exists. */
    focusChange(item) {
      if (!item) return;
      api.focusPoint(item.at);
      if (!api.isActive() || !item.ref) return;
      app.selectingFromPanel = true;
      if (wallSegments().some((s) => s.id === item.ref)) api.select('segment', item.ref);
      else if (plan.openings.some((o) => o.id === item.ref)) api.select('opening', item.ref);
      app.selectingFromPanel = false;
    },
  };

  /* ───────── What the plan view reports about its own gestures ───────── */
  listen(view2d, 'structure', (e) => {
    if (!e || !e.type) return;
    if (e.type === 'locked') levelToast(e.text || LEVELS.locked.text, 'locked');
    else if (e.type === 'refused') toast(e.text || 'That change is not possible here.', { kind: 'warn' });
    else if (e.type === 'warning') levelToast(e.text, e.level);
    else if (e.type === 'done' && /^remove/.test(e.op || '')) toast(/wall/.test(e.op) ? 'Wall removed' : 'Opening removed', { action: undo });
  });

  /* ───────── Store wiring ───────── */
  const syncClasses = () => {
    root.classList.toggle('is-structure', api.isActive());
    root.classList.toggle('plan-modified', isPlanModified());
  };
  /** Drop a selection that no longer exists (undo, reset, a wall that was merged away). */
  const prune = () => { if (store.ui.structureSel && !api.selected()) store.setUI({ structureSel: null }); };
  store.on('plan', (e) => {
    diff = null;
    syncClasses();
    // After the caller had its chance to re-select the edited wall under its new id.
    if (!e || !e.transient) queueMicrotask(prune);
  });
  store.on('load', () => { diff = null; syncClasses(); prune(); });
  store.on('ui', (e) => {
    if (e.keys.includes('mode') && api.isActive() && !planShown()) api.exit();   // Structure lives in Plan and Split
    if (e.keys.includes('tool')) {
      toolChangedAt = performance.now();
      if (!api.isActive() && store.ui.structureSel) store.setUI({ structureSel: null });
      syncClasses();
    }
  });
  // A panel selected furniture (shopping list, checks…): the user is furnishing again.
  store.on('selection', () => { if (store.selection.length && api.isActive()) api.exit(); });

  if (api.isActive() && !planShown()) api.exit();
  if (!(store.ui.wallThickness >= 7 && store.ui.wallThickness <= 20)) store.setUI({ wallThickness: 10 });
  syncClasses();
  return api;
}
