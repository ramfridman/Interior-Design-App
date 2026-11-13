/**
 * Structure tools — pointer logic for editing the building itself (docs/CONTRACT.md § 7):
 *   'structure'  select a wall segment / opening, drag a wall sideways, drag a free wall end, slide an opening
 *                along its wall, drag its jambs to change the width
 *   'wall'       draw a partition (press–drag or click–click)
 *   'door' | 'window' | 'passage'   a ghost opening follows the cursor; click places it
 * Every change goes through core/plan-edit.js. A drag is one store.begin() … commit() (one undo step) of
 * transient engine calls; nothing derived from the plan is kept between calls — segment ids are re-read from
 * each result. The engine's own words are shown whenever it refuses, and sent to the UI as 'structure' events:
 *   { type: 'done' | 'refused' | 'locked' | 'warning', op, level, text, clientX, clientY }
 */
import { canAddWall, canAddOpening, addWall, addOpening, moveWallSegment, resizeWallSegment, updateOpening, REASONS } from '../core/plan-edit.js';
import { spaceAt, snapTo, clamp, pointInRect } from '../core/geometry.js';
import { structureOf, policyOfTarget, rectDist, spanOf, rectOf, selectionHandles, OPENING_TOOL_KIND } from './structure.js';

const GRID = 5;                 // cm — the engine's grid
const TRANSIENT = { transient: true };
const MIN_JAMB = 10;            // cm of wall the engine keeps beside an opening
const REACH = 60;               // cm — how far the engine looks for a wall around a point
const HANDLE_REACH = 9;         // CSS px
const TIP_MS = 3400;
const WIDTHS = { door: [60, 200], window: [40, 400], 'sliding-door': [120, 400], opening: [60, 400] };
const KIND_NAME = { door: 'door', window: 'window', 'sliding-door': 'sliding door', opening: 'passage' };
const NO_WALL = 'There is no wall here.';

const isLockReason = (text) => !!text && (text.includes(REASONS.mamad) || text.includes(REASONS.exteriorWall));
/** Centre-line coordinate to hand to the engine so that the wall's near face lands on `face` (the engine snaps the
 *  centre to the grid first, then the face). */
function centreFor(face, t) {
  for (let k = 0; k <= 4; k++) if (snapTo(face + GRID * k - t / 2, GRID) === face) return face + GRID * k;
  return face + t / 2;
}

/**
 * @param V     view internals
 * @param io    { toPlan(p), snapOn(e), startPan(p, extra), tool() } from the interaction module
 */
export function createStructureTools(V, io) {
  const { cam, env, state: st, snapper } = V;
  const { store, plan } = env;
  /** Live state read by the overlay. */
  const S = st.struct = { hover: null, hoverHandle: null, pointer: null, draft: null, ghost: null, tip: null, live: null, marker: null };
  let anchor = null;            // where the selected segment / opening was, to find it again after a plan change
  let lastEvent = { clientX: 0, clientY: 0 };

  const call = (fn, ...args) => { V.selfWrite = true; try { return fn(...args); } finally { V.selfWrite = false; } };
  const emit = (type, op, level, text, e) => {
    const at = e || lastEvent;
    V.emit('structure', { type, op, level: level || 'free', text: text || '', clientX: at.clientX, clientY: at.clientY });
  };
  const data = () => structureOf(plan);
  const selected = () => store.ui.structureSel || null;
  const thickness = () => { const t = Number(store.ui.wallThickness); return Number.isFinite(t) && t > 0 ? Math.round(t) : 10; };

  // ───────────── tips ─────────────
  function setTip(text, tone, sticky) {
    const tip = text ? { text, tone } : null;
    S.tip = tip;
    if (tip && !sticky) setTimeout(() => { if (S.tip === tip) { S.tip = null; V.invalidate(); } }, TIP_MS);
  }

  // ───────────── selection ─────────────
  function remember() {
    const sel = selected(), d = data();
    anchor = null;
    if (!sel) return;
    if (sel.type === 'segment') {
      const s = d.byId.get(sel.id);
      if (s) anchor = { type: 'segment', id: s.id, axis: s.axis, thickness: s.thickness, core: { ...s.core } };
    } else {
      const o = plan.openings.find((q) => q.id === sel.id);
      if (o) anchor = { type: 'opening', id: o.id, x: o.x + o.w / 2, y: o.y + o.h / 2 };
    }
  }
  function select(target) {
    const sel = selected();
    if (target && (!sel || sel.type !== target.type || sel.id !== target.id)) store.setUI({ structureSel: { type: target.type, id: target.id } });
    else if (!target && sel) store.setUI({ structureSel: null });
    if (target && store.selection.length) store.clearSelection();
    remember();
  }
  /** After a plan change made elsewhere: keep the selection on the same wall / opening, or drop it. */
  function resolveSelection(reason) {
    const sel = selected(), d = data();
    if (!sel) { anchor = null; return; }
    const exists = sel.type === 'segment' ? d.byId.has(sel.id) : plan.openings.some((o) => o.id === sel.id);
    if (exists) { remember(); return; }
    let next = null;
    if (anchor && anchor.type === sel.type && anchor.id === sel.id) {
      if (sel.type === 'opening') {
        const o = plan.openings.find((q) => pointInRect(anchor.x, anchor.y, q));
        if (o) next = { type: 'opening', id: o.id };
      } else {
        const a = spanOf(anchor.core, anchor.axis), cx = anchor.core.x + anchor.core.w / 2, cy = anchor.core.y + anchor.core.h / 2;
        let s = d.segs.find((g) => g.axis === anchor.axis && rectDist(cx, cy, g) === 0) || null;
        if (!s && (reason === 'move-wall' || reason === 'resize-wall')) {
          // moved through the inspector: the nearest parallel wall of the same thickness that still overlaps it
          let bd = Infinity;
          for (const g of d.segs) {
            if (g.axis !== anchor.axis || g.thickness !== anchor.thickness) continue;
            const b = spanOf(g.core, g.axis), over = Math.min(a.a1, b.a1) - Math.max(a.a0, b.a0), dist = Math.abs(b.c0 - a.c0);
            if (over >= 0.5 * Math.min(a.a1 - a.a0, b.a1 - b.a0) && dist <= 300 && dist < bd) { bd = dist; s = g; }
          }
        }
        if (s) next = { type: 'segment', id: s.id };
      }
    }
    store.setUI({ structureSel: next });
    remember();
  }

  const exists = (t) => (t.type === 'segment' ? data().byId.has(t.id) : plan.openings.some((o) => o.id === t.id));

  // ───────────── hit testing ─────────────
  function hitTarget(pp) {
    const d = data();
    let best = null;
    const tolO = Math.max(3, 5 / cam.scale);
    for (const o of plan.openings) {
      const dist = rectDist(pp.x, pp.y, o);
      if (dist <= tolO && (!best || dist < best.dist)) best = { type: 'opening', id: o.id, dist };
    }
    if (!best) {
      const tol = Math.max(4, 6 / cam.scale);
      for (const s of d.segs) {
        const dist = rectDist(pp.x, pp.y, s);
        if (dist <= tol && (!best || dist < best.dist)) best = { type: 'segment', id: s.id, dist };
      }
    }
    if (!best) return null;
    const policy = policyOfTarget(plan, best);
    return { type: best.type, id: best.id, level: policy.level, reason: policy.reason };
  }
  function hitHandle(p) {
    let best = null;
    for (const h of selectionHandles(plan, selected(), cam)) {
      const dist = Math.hypot(h.x - p.x, h.y - p.y);
      if (dist <= HANDLE_REACH && (!best || dist < best.dist)) best = { ...h, dist };
    }
    return best;
  }
  const nearestSegment = (pp) => {
    let best = null, bd = Infinity;
    for (const s of data().segs) { const dist = rectDist(pp.x, pp.y, s.core); if (dist < bd) { bd = dist; best = s; } }
    return best;
  };

  // ───────────── hover ─────────────
  function hover(p, e) {
    lastEvent = e; S.pointer = p;
    const tool = io.tool(), pp = io.toPlan(p);
    if (tool === 'structure') {
      const h = hitHandle(p);
      const hit = h ? null : hitTarget(pp);
      const changed = (S.hoverHandle ? S.hoverHandle.kind : null) !== (h ? h.kind : null) || (S.hover ? S.hover.id : null) !== (hit ? hit.id : null);
      S.hoverHandle = h; S.hover = hit;
      if (changed || S.tip || (hit && hit.level === 'locked')) V.invalidate();
    } else if (tool === 'wall') {
      if (S.draft) updateDraft(p, e);
      else S.marker = snapper.snapWallPoint(pp, { scale: cam.scale, enabled: io.snapOn(e) });
      V.invalidate();
    } else {
      updateGhost(p, e);
      V.invalidate();
    }
  }
  function leave() {
    if (st.gesture) return;
    S.hover = null; S.hoverHandle = null; S.marker = null; S.pointer = null;
    if (S.ghost) S.ghost = null;
    V.invalidate();
  }

  // ───────────── drawing a wall ─────────────
  function updateDraft(p, e) {
    const D = S.draft;
    if (!D) return;
    const pp = io.toPlan(p), t = thickness(), opts = { scale: cam.scale, enabled: io.snapOn(e) };
    const dx = pp.x - D.raw.x, dy = pp.y - D.raw.y;
    // axis lock, with a little hysteresis so the ghost does not flicker around the diagonal
    let axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
    if (D.axis && D.axis !== axis && Math.abs(Math.abs(dx) - Math.abs(dy)) < 8 / cam.scale) axis = D.axis;
    const h = axis === 'h';
    const rawA = h ? D.raw.x : D.raw.y, rawC = h ? D.raw.y : D.raw.x, cur = h ? pp.x : pp.y;
    const line = snapper.snapWallLine(axis, rawC, rawA, cur, t, opts);
    const face = snapTo(line.value - t / 2, GRID), c = centreFor(face, t);
    const s0 = snapper.snapWallEnd(axis, rawA, face + t / 2, t, opts), s1 = snapper.snapWallEnd(axis, cur, face + t / 2, t, opts);
    const input = h ? { x1: s0.value, y1: c, x2: s1.value, y2: c, thickness: t } : { x1: c, y1: s0.value, x2: c, y2: s1.value, thickness: t };
    const tooShort = Math.abs(s1.value - s0.value) < GRID;
    const chk = tooShort ? { ok: false, reason: '' } : canAddWall(input);
    const rect = chk.ok ? chk.rect : rectOf(axis, Math.min(s0.value, s1.value), Math.max(s0.value, s1.value), face, face + t);
    Object.assign(D, {
      axis, input, ok: chk.ok, reason: chk.ok ? '' : chk.reason, rect, level: chk.ok ? chk.level : 'locked',
      length: h ? rect.w : rect.h, thickness: t,
      guides: [line.guide, s0.guide, s1.guide].filter(Boolean),
      clear: tooShort ? [] : snapper.clearances(rect).filter((q) => (h ? q.x1 === q.x2 : q.y1 === q.y2)),
    });
  }
  /** Build the drafted wall. A refused click–click draft stays armed so the end point can be corrected. */
  function commitDraft(e, keepOnFail) {
    const D = S.draft;
    if (!D || !D.input) { S.draft = null; return; }
    const fail = (reason) => {
      if (reason) { emit(isLockReason(reason) ? 'locked' : 'refused', 'add-wall', 'locked', reason, e); setTip(reason, 'refused'); }
      if (!keepOnFail) S.draft = null;
    };
    if (!D.ok) { fail(D.reason); return; }
    const res = call(addWall, D.input);
    if (!res.ok) { fail(res.reason); return; }
    S.draft = null; setTip(null);
    if (res.ids.length) select({ type: 'segment', id: res.ids[0] });
    emit('done', 'add-wall', res.level, res.warnings[0] || '', e);
    if (res.warnings.length) emit('warning', 'add-wall', res.level, res.warnings[0], e);
    if (!e.shiftKey) store.setUI({ tool: 'structure' });
  }

  // ───────────── placing an opening ─────────────
  function updateGhost(p, e) {
    const kind = OPENING_TOOL_KIND[io.tool()];
    if (!kind) { S.ghost = null; return; }
    const pp = io.toPlan(p), d = data(), prev = S.ghost;
    let x = pp.x, y = pp.y;
    if (prev && prev.ok && prev.kind === kind) {
      const seg = d.byId.get(prev.segmentId);
      if (seg) {
        // Off the wall the ghost stays where it is, so the cursor can choose which way the door hangs: the side
        // of the wall it is on = swing, the half of the opening = hinge. Moving past a jamb pushes the ghost along.
        const h = prev.axis === 'h', q = spanOf(prev.rect, prev.axis);
        const along = h ? pp.x : pp.y, mid = (q.c0 + q.c1) / 2, off = Math.abs((h ? pp.y : pp.x) - mid);
        const band = (q.c1 - q.c0) / 2 + 4 / cam.scale, reach = clamp(70 / cam.scale, REACH, 150);
        if (off > band && off <= reach && nearestSegment(pp) === seg) {
          const half = (q.a1 - q.a0) / 2, m = 3 / cam.scale;
          const want = along < q.a0 - m ? along + half : along > q.a1 + m ? along - half : (q.a0 + q.a1) / 2;
          x = h ? want : mid; y = h ? mid : want;
        }
      }
    }
    const chk = canAddOpening({ kind, x, y });
    if (!chk.ok) {
      const near = chk.reason !== NO_WALL;
      S.ghost = { ok: false, kind, reason: near ? chk.reason : '', lock: near && isLockReason(chk.reason) };
      return;
    }
    const seg = d.byId.get(chk.segmentId), axis = seg ? seg.axis : (chk.rect.w >= chk.rect.h ? 'h' : 'v');
    const h = axis === 'h', q = spanOf(chk.rect, axis), mid = (q.c0 + q.c1) / 2, centre = (q.a0 + q.a1) / 2;
    const ghost = {
      ok: true, kind, axis, rect: chk.rect, level: chk.level, segmentId: chk.segmentId, width: q.a1 - q.a0,
      centre: h ? { x: centre, y: mid } : { x: mid, y: centre }, reason: '', lock: false,
    };
    if (kind === 'door') {
      const same = prev && prev.ok && prev.kind === kind && prev.segmentId === chk.segmentId;
      const along = h ? pp.x : pp.y, perp = h ? pp.y : pp.x;
      const core = seg ? spanOf(seg.core, axis) : q;
      const sides = h ? ['n', 's'] : ['w', 'e'], jambs = h ? ['w', 'e'] : ['n', 's'];
      // small dead zones keep the leaf from flipping while the cursor travels along the wall
      ghost.swing = Math.abs(perp - mid) < 1.5 && same ? prev.swing : sides[perp < mid ? 0 : 1];
      ghost.hinge = Math.abs(along - centre) < 6 ? (same ? prev.hinge : jambs[q.a0 - core.a0 <= core.a1 - q.a1 ? 0 : 1]) : jambs[along < centre ? 0 : 1];
    }
    S.ghost = ghost;
  }
  function placeOpening(e) {
    const g = S.ghost;
    if (!g) return;
    if (!g.ok) {
      if (g.reason) { emit(g.lock ? 'locked' : 'refused', 'add-opening', 'locked', g.reason, e); setTip(g.reason, g.lock ? 'locked' : 'refused'); }
      return;
    }
    const input = { kind: g.kind, x: g.centre.x, y: g.centre.y };
    if (g.kind === 'door') { input.hinge = g.hinge; input.swing = g.swing; }
    const res = call(addOpening, input);
    if (!res.ok) {
      const lock = isLockReason(res.reason);
      emit(lock ? 'locked' : 'refused', 'add-opening', 'locked', res.reason, e); setTip(res.reason, lock ? 'locked' : 'refused');
      return;
    }
    S.ghost = null; setTip(null);
    if (res.ids.length) select({ type: 'opening', id: res.ids[0] });
    emit('done', 'add-opening', res.level, res.warnings[0] || '', e);
    if (res.warnings.length) emit('warning', 'add-opening', res.level, res.warnings[0], e);
    if (!e.shiftKey) store.setUI({ tool: 'structure' });
  }

  // ───────────── drags in the structure tool ─────────────
  function beginBatch(g) { call(() => store.begin()); g.batch = true; }
  function blocked(g, reason, e) {
    setTip(reason, 'refused', true);
    if (reason && !g.refused.has(reason)) { g.refused.add(reason); emit('refused', g.op, 'locked', reason, e); }
  }
  /** Book-keeping after a successful engine call inside a drag. */
  function accepted(g, res, e) {
    g.changed = true; g.level = res.level;
    if (res.warnings.length && !g.warned) { g.warned = true; g.warning = res.warnings[0]; emit('warning', g.op, res.level, res.warnings[0], e); }
  }
  /** The segment being dragged after an engine call: the returned piece under the grab point. */
  function follow(g, ids) {
    const d = data();
    const list = ids.map((id) => d.byId.get(id)).filter(Boolean);
    const pick = list.find((s) => { const q = spanOf(s.core, s.axis); return g.grabAlong >= q.a0 && g.grabAlong <= q.a1; }) || list[0];
    if (pick && pick.id !== g.id) { g.id = pick.id; g.target = { type: 'segment', id: pick.id }; }
    select(g.target);
  }
  function liveFor(g) {
    const s = data().byId.get(g.id);
    if (!s) { S.live = null; return; }
    const h = s.axis === 'h';
    S.live = { op: g.op, delta: g.applied || 0, axis: s.axis, rect: s.core, clear: snapper.clearances(s.core).filter((q) => (h ? q.x1 === q.x2 : q.y1 === q.y2)) };
  }

  function beginDrag(g, p, e) {
    const policy = policyOfTarget(plan, g.target), d = data();
    if (policy.level === 'locked') {
      g.type = 's-locked';
      emit('locked', g.target.type === 'segment' ? 'move-wall' : 'update-opening', 'locked', policy.reason, e);
      setTip(policy.reason, 'locked', true);
      return;
    }
    g.refused = new Set(); g.warned = false; g.changed = false; g.level = policy.level;
    g.orig = { type: g.target.type, id: g.target.id };
    if (g.target.type === 'segment') {
      const s = d.byId.get(g.target.id);
      if (!s) { g.type = 'noop'; return; }
      g.id = s.id; g.axis = s.axis;
      g.grabAlong = s.axis === 'h' ? g.startPlan.x : g.startPlan.y;
      if (g.handle === 'end0' || g.handle === 'end1') {
        g.type = 's-resize-wall'; g.op = 'resize-wall'; g.end = g.handle === 'end0' ? 0 : 1;
        const q = spanOf(s.core, s.axis);
        g.grabAlong = (q.a0 + q.a1) / 2; g.from = g.end ? q.a1 : q.a0;
      } else { g.type = 's-move-wall'; g.op = 'move-wall'; g.applied = 0; }
    } else {
      const o = plan.openings.find((q) => q.id === g.target.id);
      if (!o) { g.type = 'noop'; return; }
      g.id = o.id; g.axis = o.axis; g.op = 'update-opening';
      const q = spanOf(o, o.axis), along = o.axis === 'h' ? g.startPlan.x : g.startPlan.y;
      if (g.handle === 'w0' || g.handle === 'w1') {
        g.type = 's-width'; g.side = g.handle === 'w0' ? 0 : 1; g.fixed = g.side ? q.a0 : q.a1;
        // how far the dragged jamb may go: the wall end or the next opening, less the solid wall the engine keeps
        const seg = d.segOfOpening.get(o.id), core = seg ? spanOf(seg.core, seg.axis) : q;
        let lo = core.a0 + MIN_JAMB, hi = core.a1 - MIN_JAMB;
        for (const id of seg ? seg.openingIds : []) {
          const other = id === o.id ? null : plan.openings.find((x) => x.id === id);
          if (!other) continue;
          const b = spanOf(other, o.axis);
          if (b.a1 <= q.a0) lo = Math.max(lo, b.a1 + MIN_JAMB); else if (b.a0 >= q.a1) hi = Math.min(hi, b.a0 - MIN_JAMB);
        }
        g.lim = [Math.ceil(lo / GRID) * GRID, Math.floor(hi / GRID) * GRID];
        g.kind = o.kind;
      } else { g.type = 's-slide'; g.grabOff = along - (q.a0 + q.a1) / 2; g.cross = (q.c0 + q.c1) / 2; }
    }
    beginBatch(g);
    S.hover = null; S.hoverHandle = null;
  }

  function dragMoveWall(g, p, e) {
    const pp = io.toPlan(p);
    const want = snapTo((g.axis === 'h' ? pp.y - g.startPlan.y : pp.x - g.startPlan.x), GRID);
    if (want === g.applied) { if (S.tip && S.tip.tone === 'refused') setTip(null); return; }
    let res = call(moveWallSegment, g.id, want - g.applied, TRANSIENT);
    if (res.ok) { g.applied = want; follow(g, res.ids); accepted(g, res, e); setTip(null); }
    else {
      // the whole jump is not possible: go as far as the engine allows, one grid step at a time
      const dir = Math.sign(want - g.applied);
      for (let i = 0; i < 16 && g.applied !== want; i++) {
        const step = call(moveWallSegment, g.id, dir * GRID, TRANSIENT);
        if (!step.ok) { res = step; break; }
        g.applied += dir * GRID; follow(g, step.ids); accepted(g, step, e);
      }
      if (g.applied !== want) blocked(g, res.reason, e); else setTip(null);
    }
    liveFor(g);
  }
  function dragResizeWall(g, p, e) {
    const pp = io.toPlan(p), d = data(), s = d.byId.get(g.id);
    if (!s) return;
    const q = spanOf(s.core, s.axis), c = (q.c0 + q.c1) / 2;
    const v = snapper.snapWallEnd(g.axis, g.axis === 'h' ? pp.x : pp.y, c, s.thickness, { scale: cam.scale, enabled: io.snapOn(e) }).value;
    if (v === g.from) { if (S.tip && S.tip.tone === 'refused') setTip(null); return; }
    const res = call(resizeWallSegment, g.id, g.end ? { end: v } : { start: v }, TRANSIENT);
    if (res.ok) {
      follow(g, res.ids); accepted(g, res, e); setTip(null);
      const now = data().byId.get(g.id);
      if (now) { const n = spanOf(now.core, now.axis); g.from = g.end ? n.a1 : n.a0; g.grabAlong = (n.a0 + n.a1) / 2; }
    } else blocked(g, res.reason, e);
    liveFor(g);
  }
  function dragSlide(g, p, e) {
    const pp = io.toPlan(p), c = (g.axis === 'h' ? pp.x : pp.y) - g.grabOff;
    const res = call(updateOpening, g.id, g.axis === 'h' ? { x: c, y: g.cross } : { x: g.cross, y: c }, TRANSIENT);
    if (res.ok) { accepted(g, res, e); setTip(null); remember(); } else blocked(g, res.reason, e);
  }
  function dragWidth(g, p, e) {
    const o = plan.openings.find((q) => q.id === g.id), seg = data().segOfOpening.get(g.id);
    if (!o || !seg) return;
    const pp = io.toPlan(p), [minW, maxW] = WIDTHS[g.kind] || [40, 400];
    const wantJamb = snapTo(g.axis === 'h' ? pp.x : pp.y, GRID);
    const jamb = g.side ? Math.min(wantJamb, g.lim[1]) : Math.max(wantJamb, g.lim[0]);
    let why = jamb !== wantJamb ? `At least ${MIN_JAMB} cm of solid wall must stay beside an opening.` : '';
    let width = g.side ? jamb - g.fixed : g.fixed - jamb;
    if (width < minW || width > maxW) { width = clamp(width, minW, maxW); why = `A ${KIND_NAME[g.kind] || 'opening'} is ${minW}–${maxW} cm wide.`; }
    const start = g.side ? g.fixed : g.fixed - width, q = spanOf(o, o.axis), a0 = spanOf(seg.core, seg.axis).a0;
    if (width !== q.a1 - q.a0 || start !== q.a0) {
      const res = call(updateOpening, g.id, { offset: start - a0, width }, TRANSIENT);
      if (!res.ok) why = res.reason;
      else {
        // the engine may have slid the opening to make it fit — the opposite jamb must stay where it is
        const now = plan.openings.find((x) => x.id === g.id), n = now ? spanOf(now, now.axis) : null;
        if (n && (g.side ? n.a0 : n.a1) !== g.fixed) {
          call(updateOpening, g.id, { offset: q.a0 - a0, width: q.a1 - q.a0 }, TRANSIENT);
          why = 'There is not enough free wall on that side.';
        } else { accepted(g, res, e); remember(); }
      }
    }
    if (why) blocked(g, why, e); else setTip(null);
  }

  function endDrag(g, e) {
    S.live = null;
    if (g.batch) {
      // back where it started: restore the snapshot exactly instead of recording a no-op step
      if (g.type === 's-move-wall' && g.applied === 0) call(() => store.cancel());
      else call(() => store.commit());
      if (g.type === 's-move-wall' && g.applied === 0) g.changed = false;
    }
    if (g.changed) V.renderer.invalidate();                                   // settle on a complete repaint
    if (S.tip && S.tip.tone === 'refused') setTip(S.tip.text, 'refused');     // let the last reason fade out
    if (g.changed) emit('done', g.op, g.level, g.warning || '', e);
    resolveSelection('history');
  }

  // ───────────── pointer entry points (called by interaction.js) ─────────────
  function down(p, e) {
    lastEvent = e; S.pointer = p;
    const tool = io.tool(), pp = io.toPlan(p);
    if (tool === 'wall') {
      if (S.draft && S.draft.armed) { updateDraft(p, e); st.gesture = { type: 's-wall-2', start: p }; return; }
      const start = snapper.snapWallPoint(pp, { scale: cam.scale, enabled: io.snapOn(e) });
      S.marker = null; setTip(null);
      S.draft = { raw: { x: start.x, y: start.y }, armed: false, axis: null, input: null, ok: false, reason: '', rect: null, guides: [], clear: [], length: 0 };
      st.gesture = { type: 's-wall', start: p };
      updateDraft(p, e);
      V.invalidate();
      return;
    }
    if (tool !== 'structure') { updateGhost(p, e); st.gesture = { type: 's-place', start: p }; V.invalidate(); return; }
    setTip(null);
    const h = hitHandle(p), sel = selected();
    const target = h && sel ? { type: sel.type, id: sel.id } : hitTarget(pp);
    if (!target) {
      if (e.pointerType === 'touch') io.startPan(p, { tap: true, structure: true });
      else st.gesture = { type: 's-empty', start: p };
      return;
    }
    select(target);
    st.gesture = { type: 's-press', start: p, startPlan: pp, target: { type: target.type, id: target.id }, handle: h ? h.kind : 'body' };
    V.invalidate();
  }

  function move(g, p, e, far) {
    lastEvent = e; S.pointer = p;
    switch (g.type) {
      case 's-press': if (far) { beginDrag(g, p, e); if (g.batch) move(g, p, e, true); } break;
      case 's-move-wall': dragMoveWall(g, p, e); break;
      case 's-resize-wall': dragResizeWall(g, p, e); break;
      case 's-slide': dragSlide(g, p, e); break;
      case 's-width': dragWidth(g, p, e); break;
      case 's-empty': if (far) io.startPan(p, { start: g.start, last: g.start }); break;
      case 's-wall': case 's-wall-2': updateDraft(p, e); g.dragged = g.dragged || Math.hypot(p.x - g.start.x, p.y - g.start.y) > 6; break;
      case 's-place': updateGhost(p, e); break;
      default: break;
    }
    V.invalidate();
  }

  function up(g, p, e) {
    lastEvent = e; S.pointer = p;
    switch (g.type) {
      case 's-press': {
        // a plain click: the selection was made on press; a locked target explains itself
        const policy = policyOfTarget(plan, g.target);
        if (policy.level === 'locked') { emit('locked', 'select', 'locked', policy.reason, e); setTip(policy.reason, 'locked'); }
        break;
      }
      case 's-locked': setTip(S.tip ? S.tip.text : null, 'locked'); break;
      case 's-move-wall': case 's-resize-wall': case 's-slide': case 's-width': endDrag(g, e); break;
      case 's-empty': {
        const pp = io.toPlan(p), space = spaceAt(pp.x, pp.y, plan);
        select(null);
        store.setUI({ activeSpace: space ? space.id : null });
        break;
      }
      case 's-wall':
        if (g.dragged && S.draft && S.draft.input) commitDraft(e, false);
        else if (S.draft) { S.draft.armed = true; updateDraft(p, e); }
        break;
      case 's-wall-2': updateDraft(p, e); commitDraft(e, true); break;
      case 's-place':
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < 12 || e.pointerType === 'touch') placeOpening(e);
        break;
      default: break;
    }
    hover(p, e);
  }

  /**
   * Esc / pointer-cancel / tool change. `g` = the structure gesture that was aborted (the store has already been
   * restored): the selection goes back to what was grabbed. Returns true when something was in progress.
   */
  function cancel(g) {
    const had = !!(S.draft || S.live);
    S.draft = null; S.live = null;
    if (S.tip) setTip(null);
    if (g && g.orig && exists(g.orig)) select(g.orig);
    V.invalidate();
    return had;
  }
  function toolChanged() {
    S.hover = null; S.hoverHandle = null; S.draft = null; S.ghost = null; S.marker = null; S.live = null; S.tip = null;
    remember();
  }
  /** The plan changed. `own` = this module made the change (inside a gesture). */
  function planChanged(e, own) {
    if (own) return;
    resolveSelection(e && e.reason);
    if (S.hover && !(S.hover.type === 'segment' ? data().byId.has(S.hover.id) : plan.openings.some((o) => o.id === S.hover.id))) S.hover = null;
    S.hoverHandle = null; S.ghost = null;
    if (S.draft && S.draft.input) { const chk = canAddWall(S.draft.input); S.draft.ok = chk.ok; S.draft.reason = chk.ok ? '' : chk.reason; if (chk.ok) S.draft.rect = chk.rect; }
  }

  function cursor() {
    const g = st.gesture, tool = io.tool();
    const across = (axis) => (axis === 'h' ? 'ns-resize' : 'ew-resize'), along = (axis) => (axis === 'h' ? 'ew-resize' : 'ns-resize');
    if (g) {
      if (g.type === 's-move-wall') return across(g.axis);
      if (g.type === 's-resize-wall' || g.type === 's-width') return along(g.axis);
      if (g.type === 's-slide') return 'grabbing';
      if (g.type === 's-locked') return 'not-allowed';
    }
    if (tool === 'wall') return 'crosshair';
    if (tool !== 'structure') return S.ghost && S.ghost.lock ? 'not-allowed' : 'crosshair';
    if (S.hoverHandle) return S.hoverHandle.kind === 'move' ? across(S.hoverHandle.axis) : S.hoverHandle.kind === 'slide' ? 'grab' : along(S.hoverHandle.axis);
    const hv = S.hover;
    if (!hv) return 'default';
    if (hv.level === 'locked') return 'not-allowed';
    if (hv.type === 'opening') return 'grab';
    const s = data().byId.get(hv.id);
    return s ? across(s.axis) : 'default';
  }

  return {
    down, move, up, hover, leave, cancel, toolChanged, planChanged, cursor, remember,
    /** `{ type, id, level, reason }` of the wall segment / opening under the cursor, or null. */
    getHover: () => (S.hover ? { type: S.hover.type, id: S.hover.id, level: S.hover.level, reason: S.hover.reason } : null),
  };
}
