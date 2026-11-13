/**
 * Pointer / wheel / keyboard interaction for the plan view: pan & zoom, select, marquee, move (with smart
 * snapping), rotate, resize, placing new items and the measure tool. Mouse, trackpad, touch and pen all go
 * through Pointer Events. All edits go to the store as transient updates inside begin() … commit().
 * While a structure tool is active ('structure' | 'wall' | 'door' | 'window' | 'passage') the pointer is handed to
 * structure-tools.js: furniture cannot be picked, gestures whose type starts with 's-' belong to that module.
 */
import { itemAABB, itemLocalToPlan, planToItemLocal, spaceAt, isIndoors, polygonBounds, normDeg, snapTo, DEG } from '../core/geometry.js';
import { itemHandles } from './overlay.js';
import { isBelowWalls } from './items.js';
import { isStructureTool } from './structure.js';
import { createStructureTools } from './structure-tools.js';

const DRAG_SLOP = 3;           // px before a press becomes a drag
const DOUBLE_MS = 350;
const MIN_SIZE = 10;           // cm
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

const clone = (o) => JSON.parse(JSON.stringify(o));
const r1 = (v) => Math.round(v * 10) / 10;       // positions are stored to the millimetre
const editable = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function attachInteraction(V) {
  const { canvas, cam, env, state: st, snapper } = V;
  const { store, plan } = env;
  const pointers = new Map();
  let pinch = null;
  let lastClick = { t: 0, x: 0, y: 0, id: null };
  let wheelTrackpadUntil = 0;
  let cursorTimer = 0, cursorPending = null;

  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const toPlan = (p) => cam.toPlan(p.x, p.y);
  const snapOn = (e) => !!store.ui.snap && !(e && (e.ctrlKey || e.metaKey));
  const tool = () => store.ui.tool || 'select';
  const redraw = () => V.invalidate();
  const structureTool = () => isStructureTool(tool());
  const isStructureGesture = (g) => !!g && typeof g.type === 'string' && g.type.startsWith('s-');
  const structure = createStructureTools(V, { toPlan, snapOn, tool, startPan: (p, extra) => startPan(p, extra) });

  // ───────────── hit testing ─────────────
  function hitItem(pp) {
    if (!store.ui.showItems) return null;
    const tol = 5 / cam.scale;
    const test = (it) => {
      if (it.hidden) return false;
      const [lx, ly] = planToItemLocal(it, pp.x, pp.y);
      const tx = it.w * cam.scale < 12 ? tol : 0, ty = it.d * cam.scale < 12 ? tol : 0;
      return Math.abs(lx) <= it.w / 2 + tx && Math.abs(ly) <= it.d / 2 + ty;
    };
    for (const below of [false, true]) {
      for (let i = store.items.length - 1; i >= 0; i--) {
        const it = store.items[i];
        if (isBelowWalls(it) === below && test(it)) return it;
      }
    }
    return null;
  }
  function hitHandle(p) {
    if (tool() !== 'select' || store.selection.length !== 1 || !store.ui.showItems) return null;
    const it = store.getItem(store.selection[0]);
    if (!it || it.hidden) return null;
    let best = null;
    for (const h of itemHandles(it, cam)) {
      const dist = Math.hypot(h.x - p.x, h.y - p.y);
      if (dist <= (h.kind === 'rotate' ? 10 : 8) && (!best || dist < best.dist)) best = { ...h, dist, item: it };
    }
    return best;
  }

  // ───────────── cursor & events ─────────────
  function setCursor(p) {
    let c = 'default';
    const g = st.gesture;
    if (g && g.type === 'pan') c = 'grabbing';
    else if (st.spaceDown || tool() === 'pan') c = 'grab';
    else if (st.placing) c = 'copy';
    else if (structureTool()) c = structure.cursor();
    else if (tool() === 'measure') c = 'crosshair';
    else if (g && g.type === 'rotate') c = 'grabbing';
    else if (g && g.type === 'resize') c = g.cursor;
    else if (g && g.type === 'move') c = 'move';
    else if (p) {
      const h = hitHandle(p);
      if (h) c = h.kind === 'rotate' ? 'grab' : resizeCursor(h.item, h.hx, h.hy);
      else if (st.hoverId) c = 'move';
    }
    if (canvas.style.cursor !== c) canvas.style.cursor = c;
  }
  function resizeCursor(it, hx, hy) {
    const a = Math.atan2(hy, hx) / DEG + (it.rot || 0);
    return RESIZE_CURSORS[((Math.round(a / 45) % 4) + 4) % 4];
  }
  function emitCursor(pp) {
    cursorPending = pp;
    if (cursorTimer) return;
    cursorTimer = setTimeout(() => {
      cursorTimer = 0;
      const q = cursorPending;
      const s = spaceAt(q.x, q.y, plan);
      V.emit('cursor', { x: q.x, y: q.y, space: s ? { id: s.id, name: s.name, kind: s.kind } : null });
    }, 30);
  }

  // ───────────── feedback helpers ─────────────
  function unionBox(items) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items) { const b = itemAABB(it); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function feedbackFor(items, guides, extra = {}) {
    const box = unionBox(items);
    let problems = { any: false };
    for (const it of items) { const p = snapper.problems(it); if (p.any) { problems = p; break; } }
    st.feedback = {
      guides, box, problems,
      clear: snapper.clearances(box),
      size: items.length === 1 ? { w: items[0].w, d: items[0].d } : { w: box.w, d: box.h },
      ...extra,
    };
  }

  // ───────────── gestures ─────────────
  function startPan(p, extra = {}) {
    st.gesture = { type: 'pan', last: p, start: p, samples: [], moved: false, ...extra };
  }
  function endGesture() {
    st.gesture = null; st.marquee = null; st.feedback = null;
    if (st.live.size) { st.live.clear(); V.renderer.invalidate(); }
    redraw();
  }
  /** Abort whatever is in progress and restore the store. Returns true if something was cancelled. */
  function cancelGesture() {
    const g = st.gesture;
    if (!g) return false;
    if (g.batch) { V.selfWrite = true; store.cancel(); V.selfWrite = false; }
    if (isStructureGesture(g)) structure.cancel();
    endGesture();
    return true;
  }

  function beginMove(g) {
    const clicked = store.getItem(g.itemId);
    let items = store.getSelected().filter((it) => !it.locked && !it.hidden);
    if (!clicked || clicked.locked || !items.length) { g.type = 'noop'; return false; }
    V.selfWrite = true;
    store.begin(); g.batch = true;
    if (g.alt) {
      items = store.addItems(items.map((s) => ({ ...clone(s), id: undefined, locked: false })));
    }
    V.selfWrite = false;
    g.type = 'move';
    g.ids = items.map((it) => it.id);
    g.orig = new Map(items.map((it) => [it.id, { x: it.x, y: it.y, rot: it.rot || 0 }]));
    g.box0 = unionBox(items);
    g.snapState = {};
    g.manualRot = false;
    st.live = new Set(g.ids);
    return true;
  }
  function updateMove(g, p, e) {
    let dx = (p.x - g.start.x) / cam.scale, dy = (p.y - g.start.y) / cam.scale;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const enabled = snapOn(e);
    let guides = [];
    const poses = new Map();
    if (g.ids.length === 1) {
      const id = g.ids[0], it = store.getItem(id), o = g.orig.get(id);
      if (!it) return cancelGesture();
      const res = snapper.snapItem({ ...it, x: o.x + dx, y: o.y + dy, rot: o.rot },
        { scale: cam.scale, enabled, autoOrient: !g.manualRot, exclude: st.live, state: g.snapState });
      poses.set(id, { x: r1(res.x), y: r1(res.y), rot: res.rot });
      guides = res.guides;
    } else {
      const box = { x: g.box0.x + dx, y: g.box0.y + dy, w: g.box0.w, h: g.box0.h };
      const res = enabled ? snapper.snapBox(box, { scale: cam.scale, exclude: st.live }) : { dx: 0, dy: 0, guides: [] };
      for (const id of g.ids) { const o = g.orig.get(id); poses.set(id, { x: r1(o.x + dx + res.dx), y: r1(o.y + dy + res.dy) }); }
      guides = res.guides;
    }
    V.selfWrite = true;
    store.updateItems(g.ids, (it) => poses.get(it.id) || {}, { transient: true });
    V.selfWrite = false;
    feedbackFor(g.ids.map((id) => store.getItem(id)).filter(Boolean), guides);
  }

  function updateRotate(g, p, e) {
    const it = store.getItem(g.id);
    if (!it) return cancelGesture();
    if (!g.batch) { V.selfWrite = true; store.begin(); V.selfWrite = false; g.batch = true; st.live = new Set([g.id]); }
    const c = cam.toScreen(it.x, it.y);
    let deg = normDeg(Math.atan2(-(p.x - c.x), p.y - c.y) / DEG);
    deg = e.shiftKey ? Math.round(deg) : normDeg(Math.round(deg / 15) * 15);
    V.selfWrite = true;
    store.updateItem(g.id, { rot: deg }, { transient: true });
    V.selfWrite = false;
    feedbackFor([it], [], { clear: [], size: null, angle: deg });
  }

  function updateResize(g, p, e) {
    const it = store.getItem(g.id), o = g.it0;
    if (!it) return cancelGesture();
    if (!g.batch) { V.selfWrite = true; store.begin(); V.selfWrite = false; g.batch = true; st.live = new Set([g.id]); }
    const pp = toPlan(p), enabled = snapOn(e), step = store.ui.gridStep || 0;
    let [lx, ly] = planToItemLocal(o, pp.x, pp.y);
    const r = normDeg(o.rot || 0), ortho = r % 90 === 0;
    const c = Math.round(Math.cos(r * DEG)), s = Math.round(Math.sin(r * DEG));
    const box = itemAABB(o);
    const guides = [];
    /** Snap a local coordinate of the dragged edge. axisDir = plan direction of that local axis. */
    const snapLocal = (v, isX, anchor) => {
      if (!enabled) return v;
      if (!ortho) return step ? anchor + snapTo(v - anchor, step) : v;
      const dir = isX ? [c, s] : [-s, c];                       // plan direction of local +x / +y
      const axis = dir[0] !== 0 ? 0 : 1, sign = dir[axis];
      const edge = itemLocalToPlan(o, isX ? v : 0, isX ? 0 : v)[axis];
      const p0 = axis === 0 ? box.y : box.x, p1 = axis === 0 ? box.y + box.h : box.x + box.w;
      const res = snapper.snapCoord(axis, edge, p0, p1, { scale: cam.scale, enabled, exclude: st.live });
      guides.push(...res.guides);
      return v + (res.value - edge) * sign;
    };
    let left = -o.w / 2, right = o.w / 2, top = -o.d / 2, bottom = o.d / 2;
    if (g.hx > 0) right = Math.max(snapLocal(lx, true, left), left + MIN_SIZE);
    if (g.hx < 0) left = Math.min(snapLocal(lx, true, right), right - MIN_SIZE);
    if (g.hy > 0) bottom = Math.max(snapLocal(ly, false, top), top + MIN_SIZE);
    if (g.hy < 0) top = Math.min(snapLocal(ly, false, bottom), bottom - MIN_SIZE);
    const [x, y] = itemLocalToPlan(o, (left + right) / 2, (top + bottom) / 2);
    V.selfWrite = true;
    store.updateItem(g.id, { x: r1(x), y: r1(y), w: r1(right - left), d: r1(bottom - top) }, { transient: true });
    V.selfWrite = false;
    feedbackFor([store.getItem(g.id)], guides);
  }

  function finishMarquee(g) {
    const m = st.marquee;
    if (!m) return;
    const a = cam.toPlan(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1)), b = cam.toPlan(Math.max(m.x0, m.x1), Math.max(m.y0, m.y1));
    const ids = store.ui.showItems ? store.items.filter((it) => {
      if (it.hidden) return false;
      const bb = itemAABB(it);
      return bb.x < b.x && bb.x + bb.w > a.x && bb.y < b.y && bb.y + bb.h > a.y;
    }).map((it) => it.id) : [];
    store.select(g.additive ? [...new Set([...store.selection, ...ids])] : ids);
  }

  // ───────────── placing ─────────────
  function ghostFrom(partial) {
    return { name: 'Item', params: {}, rot: 0, elev: 0, w: 100, d: 50, h: 80, placement: 'floor', zone: 'indoor', ...clone(partial), id: '__placing__', x: 0, y: 0 };
  }
  function poseFor(base, pp, enabled, state, autoOrient) {
    return snapper.snapItem({ ...base, x: pp.x, y: pp.y }, { scale: cam.scale, enabled, autoOrient, exclude: null, state });
  }
  function updateGhost(p, e) {
    const pl = st.placing;
    if (!pl) return;
    const pp = toPlan(p);
    const res = poseFor({ ...pl.item, rot: pl.baseRot }, pp, snapOn(e), pl.snapState, !pl.manualRot);
    Object.assign(pl.item, { x: res.x, y: res.y, rot: res.rot });
    pl.visible = true;
    feedbackFor([pl.item], res.guides);
    V.emit('placing', { state: 'move', x: res.x, y: res.y, rot: res.rot, item: pl.partial });
    redraw();
  }
  function addFromPose(partial, pose) {
    const rest = clone(partial);
    delete rest.id;
    return store.addItem({ ...rest, x: r1(pose.x), y: r1(pose.y), rot: pose.rot,
      zone: isIndoors(pose.x, pose.y, plan) ? 'indoor' : 'outdoor', elev: partial.elev ?? 0 });
  }
  function endPlacing(item) {
    const pl = st.placing;
    if (!pl) return;
    st.placing = null; st.feedback = null;
    V.emit('placing', { state: item ? 'done' : 'cancel', item: item || null, count: pl.count });
    if (pl.onDone) { try { pl.onDone(item || pl.last || null); } catch (err) { console.error('[view2d] onDone failed', err); } }
    setCursor(null); redraw();
  }
  function commitPlacing(e) {
    const pl = st.placing;
    if (!pl || !pl.visible) return;
    const item = addFromPose(pl.partial, pl.item);
    pl.count++; pl.last = item;
    V.emit('placing', { state: 'placed', item });
    if (e.shiftKey) { pl.snapState = {}; redraw(); } else endPlacing(item);
  }

  const api = {
    startPlacing(partial, opts = {}) {
      if (!partial || typeof partial !== 'object') return;
      cancelGesture();
      if (st.placing) endPlacing(null);
      st.placing = { partial, item: ghostFrom(partial), baseRot: partial.rot || 0, manualRot: false, visible: false, onDone: opts.onDone, snapState: {}, count: 0, last: null };
      V.emit('placing', { state: 'start', item: partial });
      setCursor(null); redraw();
    },
    cancelPlacing() { if (st.placing) endPlacing(null); },
    /** Rotate the placing ghost by `delta` degrees (stops auto-orientation for this placement). */
    rotatePlacing(delta = 90) {
      const pl = st.placing;
      if (!pl) return;
      pl.baseRot = normDeg((pl.manualRot ? pl.baseRot : pl.item.rot) + delta); pl.manualRot = true; pl.item.rot = pl.baseRot;
      if (pl.visible) feedbackFor([pl.item], []);
      redraw();
    },
    dropAt(clientX, clientY, partial) {
      if (!partial || typeof partial !== 'object') return null;
      const r = canvas.getBoundingClientRect();
      const pp = cam.toPlan(clientX - r.left, clientY - r.top);
      const base = ghostFrom(partial);
      const pose = poseFor(base, pp, !!store.ui.snap, {}, true);
      return addFromPose(partial, pose);
    },
    cancel() { if (cancelGesture()) return true; if (st.placing) { endPlacing(null); return true; } return structure.cancel(); },
    /** The store changed while a gesture is running (someone else rotated or removed the dragged item). */
    externalItems(e) {
      const g = st.gesture;
      if (!g || g.type !== 'move' || V.selfWrite) return;
      if (e.type === 'update' && e.keys && e.keys.includes('rot')) {
        for (const id of e.ids) { const o = g.orig.get(id), it = store.getItem(id); if (o && it) { o.rot = it.rot || 0; g.manualRot = true; } }
      } else if (e.type === 'remove' || e.type === 'reset') { st.gesture = null; endGesture(); }
    },
    toolChanged() {
      st.measures = []; st.measureDraft = null; cancelGesture();
      structure.toolChanged();
      if (structureTool()) st.hoverId = null;
      setCursor(null); redraw();
    },
    /** The plan was edited (by this view, the inspector, undo / redo, a load …). */
    planChanged(e) {
      const g = st.gesture, own = V.selfWrite;
      if (!own && isStructureGesture(g) && g.batch) {
        // someone else changed the plan in the middle of a drag: close the drag where it is
        st.gesture = null;
        V.selfWrite = true; store.commit(); V.selfWrite = false;
        structure.cancel(); endGesture();
      }
      structure.planChanged(e, own);
    },
    /** `store.ui.structureSel` was set (by this view or by the inspector). */
    structureSelChanged() { structure.remember(); },
    getStructureHover: () => structure.getHover(),
  };

  // ───────────── pointer handlers ─────────────
  function onDown(e) {
    if (!V.active) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    cam.stop();
    if (pointers.size === 2) {
      cancelGesture();
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (pointers.size > 2) return;
    const pp = toPlan(p);
    if (e.button === 2) { st.gesture = { type: 'context', start: p, last: p }; return; }
    if (e.button === 1 || st.spaceDown || tool() === 'pan') { startPan(p); setCursor(p); return; }
    if (e.button !== 0) return;
    if (st.placing) { updateGhost(p, e); st.gesture = { type: 'place', start: p }; return; }
    if (structureTool()) { structure.down(p, e); setCursor(p); return; }
    if (tool() === 'measure') {
      const pt = snapper.snapPoint(pp, { scale: cam.scale, enabled: snapOn(e) });
      if (st.measureDraft && st.measureDraft.armed) {
        st.measures.push({ a: st.measureDraft.a, b: constrain(st.measureDraft.a, pt, e) });
        st.measureDraft = null; st.gesture = { type: 'noop' };
      } else {
        st.measureDraft = { a: { x: pt.x, y: pt.y }, b: { x: pt.x, y: pt.y }, armed: false };
        st.gesture = { type: 'measure', start: p };
      }
      redraw();
      return;
    }
    const h = hitHandle(p);
    if (h) {
      st.gesture = h.kind === 'rotate'
        ? { type: 'rotate', id: h.item.id, start: p }
        : { type: 'resize', id: h.item.id, hx: h.hx, hy: h.hy, it0: clone(h.item), start: p, cursor: resizeCursor(h.item, h.hx, h.hy) };
      setCursor(p); redraw();
      return;
    }
    const it = hitItem(pp);
    if (it) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) { store.toggleSelect(it.id); st.gesture = { type: 'noop' }; return; }
      if (!store.selection.includes(it.id)) store.select([it.id]);
      st.gesture = { type: 'press', start: p, itemId: it.id, alt: e.altKey };
    } else if (e.pointerType === 'touch') {
      startPan(p, { tap: true });
    } else {
      st.gesture = { type: 'press-empty', start: p, additive: e.shiftKey };
    }
  }

  function constrain(a, b, e) {
    if (!e.shiftKey) return { x: b.x, y: b.y };
    return Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  }

  function onMove(e) {
    if (!V.active) return;
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      cam.panBy(cx - pinch.cx, cy - pinch.cy);
      cam.zoomAt(cx, cy, dist / pinch.dist);
      pinch = { dist, cx, cy };
      redraw();
      return;
    }
    const pp = toPlan(p);
    emitCursor(pp);
    const g = st.gesture;
    if (!g) {
      if (st.placing) { updateGhost(p, e); return; }
      if (structureTool()) { if (e.pointerType !== 'touch') structure.hover(p, e); setCursor(p); return; }
      if (tool() === 'measure' && st.measureDraft) {
        st.measureDraft.b = constrain(st.measureDraft.a, snapper.snapPoint(pp, { scale: cam.scale, enabled: snapOn(e) }), e);
        redraw();
      } else if (e.pointerType !== 'touch') {
        const it = tool() === 'select' && !hitHandle(p) ? hitItem(pp) : null;
        const id = it ? it.id : null;
        if (id !== st.hoverId) { st.hoverId = id; redraw(); }
      }
      setCursor(p);
      return;
    }
    const far = Math.hypot(p.x - g.start.x, p.y - g.start.y) > DRAG_SLOP;
    switch (g.type) {
      case 'context':
        if (far) { startPan(p, { start: g.start, last: g.last, fromContext: true }); setCursor(p); }
        break;
      case 'pan': {
        cam.panBy(p.x - g.last.x, p.y - g.last.y);
        g.last = p; g.moved = g.moved || far;
        g.samples.push({ t: performance.now(), x: p.x, y: p.y });
        if (g.samples.length > 6) g.samples.shift();
        redraw();
        break;
      }
      case 'press':
        if (far && beginMove(g)) { st.hoverId = null; updateMove(g, p, e); setCursor(p); }
        break;
      case 'move': updateMove(g, p, e); break;
      case 'press-empty':
        if (far) { g.type = 'marquee'; st.marquee = { x0: g.start.x, y0: g.start.y, x1: p.x, y1: p.y }; redraw(); }
        break;
      case 'marquee': st.marquee.x1 = p.x; st.marquee.y1 = p.y; redraw(); break;
      case 'rotate': if (far || g.batch) updateRotate(g, p, e); break;
      case 'resize': if (far || g.batch) updateResize(g, p, e); break;
      case 'measure':
        st.measureDraft.b = constrain(st.measureDraft.a, snapper.snapPoint(pp, { scale: cam.scale, enabled: snapOn(e) }), e);
        g.dragged = g.dragged || Math.hypot(p.x - g.start.x, p.y - g.start.y) > 6;
        redraw();
        break;
      case 'place': updateGhost(p, e); break;
      default:
        if (isStructureGesture(g)) { structure.move(g, p, e, far); setCursor(p); }
        break;
    }
  }

  function click(p, e, item) {
    const now = performance.now();
    const dbl = now - lastClick.t < DOUBLE_MS && Math.hypot(p.x - lastClick.x, p.y - lastClick.y) < 6 && lastClick.id === (item ? item.id : null);
    lastClick = dbl ? { t: 0, x: 0, y: 0, id: null } : { t: now, x: p.x, y: p.y, id: item ? item.id : null };
    const pp = toPlan(p);
    if (item) {
      if (dbl) V.emit('item-dblclick', { item, clientX: e.clientX, clientY: e.clientY });
      else if (store.selection.length > 1) store.select([item.id]);
      return;
    }
    const space = spaceAt(pp.x, pp.y, plan);
    if (dbl) {
      const poly = space && space.polygon;
      if (poly) V.fit(polygonBounds(poly), { animate: true, padding: 56 });
      else V.fit(space ? 'lot' : 'house', { animate: true });
      return;
    }
    store.clearSelection();
    store.setUI({ activeSpace: space ? space.id : null });
  }

  function onUp(e) {
    const p = local(e);
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* not captured */ }
    if (pinch) { if (pointers.size < 2) pinch = null; st.gesture = null; return; }
    const g = st.gesture;
    if (!g) return;
    st.gesture = null;
    switch (g.type) {
      case 'context': {
        if (st.placing) { endPlacing(null); break; }
        if (st.measureDraft) { st.measureDraft = null; redraw(); break; }
        if (structureTool()) {
          // right-click drops a wall being drawn; otherwise it is a context menu on the wall / opening under it
          const pp = toPlan(p);
          if (!structure.cancel()) V.emit('contextmenu', { item: null, structure: structure.getHover(), clientX: e.clientX, clientY: e.clientY, x: pp.x, y: pp.y });
          break;
        }
        const it = hitItem(toPlan(p));
        if (it && !store.selection.includes(it.id)) store.select([it.id]);
        const pp = toPlan(p);
        V.emit('contextmenu', { item: it, clientX: e.clientX, clientY: e.clientY, x: pp.x, y: pp.y });
        break;
      }
      case 'pan': {
        if (g.tap && !g.moved) { if (g.structure) structure.up({ type: 's-empty', start: p }, p, e); else click(p, e, null); break; }
        // a flick with a finger or pen glides on; a mouse stays exactly where it was released
        const now = performance.now(), s = g.samples.filter((q) => now - q.t < 90);
        if (e.pointerType !== 'mouse' && s.length >= 2 && now - s[s.length - 1].t < 40) {
          const a = s[0], b = s[s.length - 1], dt = Math.max(8, b.t - a.t);
          const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt, v = Math.hypot(vx, vy), cap = Math.min(1, 2.5 / (v || 1));
          cam.glide(vx * cap, vy * cap);
        }
        break;
      }
      case 'press': click(p, e, store.getItem(g.itemId)); break;
      case 'press-empty': click(p, e, null); break;
      case 'marquee': finishMarquee(g); break;
      case 'move': case 'rotate': case 'resize':
        if (g.batch) { V.selfWrite = true; store.commit(); V.selfWrite = false; }
        break;
      case 'measure':
        if (g.dragged) { st.measures.push({ a: st.measureDraft.a, b: st.measureDraft.b }); st.measureDraft = null; }
        else if (st.measureDraft) st.measureDraft.armed = true;
        break;
      case 'place':
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < 12 || e.pointerType === 'touch') commitPlacing(e);
        break;
      default:
        if (isStructureGesture(g)) structure.up(g, p, e);
        break;
    }
    endGesture();
    setCursor(p);
  }

  function onCancel(e) {
    pointers.delete(e.pointerId);
    pinch = null;
    cancelGesture();
  }

  function onLeave() {
    if (st.hoverId && !st.gesture) { st.hoverId = null; redraw(); }
    if (st.placing && !st.gesture && st.placing.visible) { st.placing.visible = false; st.feedback = null; redraw(); }
    if (structureTool()) structure.leave();
  }

  function onWheel(e) {
    if (!V.active) return;
    e.preventDefault();
    const p = local(e);
    const now = performance.now();
    const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? cam.h : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    // A real wheel reports whole "notches"; trackpads report small / two-axis deltas.
    const notch = e.deltaMode !== 0 || (e.wheelDeltaY !== undefined ? (e.wheelDeltaY !== 0 && Math.abs(e.wheelDeltaY) % 120 === 0 && e.deltaX === 0) : Math.abs(dy) >= 50);
    if (!notch) wheelTrackpadUntil = now + 400;
    const trackpad = now < wheelTrackpadUntil;
    if (e.ctrlKey || e.metaKey) {
      // pinch on a trackpad (or ctrl + wheel): precise, immediate
      if (trackpad || Math.abs(dy) < 50) { cam.stop(); cam.zoomAt(p.x, p.y, Math.exp(-dy * 0.01)); }
      else cam.zoomToward(p.x, p.y, Math.exp(-Math.sign(dy) * 0.22));
    } else if (trackpad) {
      cam.stop(); cam.panBy(-dx, -dy);
    } else {
      cam.zoomToward(p.x, p.y, Math.exp(-Math.sign(dy) * Math.min(0.5, Math.abs(dy) / 100 * 0.2)));
    }
    if (st.placing && st.placing.visible) updateGhost(p, e);
    else if (structureTool() && !st.gesture) structure.hover(p, e);
    redraw();
  }

  function onKeyDown(e) {
    if (!V.active || editable(e.target)) return;
    if (e.code === 'Space') {
      if (!st.spaceDown) { st.spaceDown = true; setCursor(null); }
      e.preventDefault();
    } else if (e.key === 'Escape') {
      let handled = api.cancel();
      if (!handled && tool() === 'measure' && (st.measureDraft || st.measures.length)) {
        if (st.measureDraft) st.measureDraft = null; else st.measures = [];
        handled = true; redraw();
      }
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    }
  }
  function onKeyUp(e) {
    if (e.code === 'Space' && st.spaceDown) { st.spaceDown = false; setCursor(null); }
  }
  const onBlur = () => { st.spaceDown = false; };
  const stop = (e) => e.preventDefault();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', stop);
  canvas.addEventListener('dragstart', stop);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);

  api.destroy = () => {
    clearTimeout(cursorTimer);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', stop);
    canvas.removeEventListener('dragstart', stop);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
  };
  return api;
}
