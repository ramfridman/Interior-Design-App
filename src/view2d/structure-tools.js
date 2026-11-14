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
import { canAddWall, canAddOpening, addWall, addOpening, moveWallSegment, resizeWallSegment, updateOpening, REASONS, canAddStair, addStair, updateStair, updateVoid, rotateWallEnd, wallSegments } from '../core/plan-edit.js';
import { spaceAt, snapTo, clamp, pointInRect, polygonBounds, pointInPolygon, openingPoly, wallFaces, inWallOrOpening } from '../core/geometry.js';
import { FEATURES } from '../core/features.js';
import { snapWallEnd as snapSlantEnd, snapTargets, lineFrame, shownAngle, segDist, cursorFor } from './slant-tools.js';
import { fmtDim } from './readouts.js';
import { structureOf, policyOfTarget, rectDist, spanOf, rectOf, selectionHandles, OPENING_TOOL_KIND, stairOn, voidOn } from './structure.js';
import { hitStair, hitVoid, snapStairBox, wallFacesOf, moveVoidVertex, moveVoidEdge, doorSwingRects, boxGap } from './stairs.js';
import { PLAN } from '../core/plan.js';

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
/** Distance from a point to a polygon (0 inside). */
function polyDist(px, py, poly) {
  if (pointInPolygon(px, py, poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; d = Math.min(d, segDist(px, py, x1, y1, x2, y2)); }
  return d;
}
/**
 * Faces of other walls with the gaps the wall being changed cuts into them closed again (collinear pieces whose gap lies
 * on its footprint are merged), so its end can go back to where it was or anywhere along those faces.
 */
function bridgeFaces(faces, poly, maxGap) {
  const groups = new Map(), out = [];
  for (const f of faces) {
    const len = Math.hypot(f.x2 - f.x1, f.y2 - f.y1) || 1, ux = (f.x2 - f.x1) / len, uy = (f.y2 - f.y1) / len;
    const [sx, sy] = ux < -1e-9 || (Math.abs(ux) <= 1e-9 && uy < 0) ? [-ux, -uy] : [ux, uy];
    const key = `${sx.toFixed(5)}|${sy.toFixed(5)}|${(f.x1 * -sy + f.y1 * sx).toFixed(2)}`;
    const a = f.x1 * sx + f.y1 * sy, b = f.x2 * sx + f.y2 * sy;
    if (!groups.has(key)) groups.set(key, { sx, sy, c: f.x1 * -sy + f.y1 * sx, list: [] });
    groups.get(key).list.push([Math.min(a, b), Math.max(a, b)]);
  }
  for (const g of groups.values()) {
    // a point at t along (sx, sy) on the line { p : p · (−sy, sx) = c }
    const P = (t) => [g.sx * t - g.sy * g.c, g.sy * t + g.sx * g.c];
    const merged = [];
    g.list.sort((p, q) => p[0] - q[0]);
    for (const [a, b] of g.list) {
      const cur = merged[merged.length - 1];
      if (cur && a - cur[1] <= maxGap && polyDist(...P((a + cur[1]) / 2), poly) <= 1) cur[1] = Math.max(cur[1], b);
      else merged.push([a, b]);
    }
    for (const [a, b] of merged) { const [x1, y1] = P(a), [x2, y2] = P(b); out.push({ x1, y1, x2, y2 }); }
  }
  return out;
}
/** Distance from a point to a wall segment: its footprint for an angled wall, its rectangle otherwise. */
const segmentDist = (px, py, s) => (s.axis === 'a' ? polyDist(px, py, s.poly) : rectDist(px, py, s));
/** Distance from a point to an opening: its gap quad in an angled wall, its rectangle otherwise. */
const openingDist = (px, py, o, plan) => (o.axis === 'a' ? polyDist(px, py, openingPoly(o, plan)) : rectDist(px, py, o));
const r01 = (v) => Math.round(v * 10) / 10 + 0;
/** The two ends of a wall segment's centre line: an angled wall's x1…y2, a rect core's west / north end first. */
function segEnds(s) {
  if (s.axis === 'a') return [[s.x1, s.y1], [s.x2, s.y2]];
  const c = s.core;
  return s.axis === 'h' ? [[c.x, c.y + c.h / 2], [c.x + c.w, c.y + c.h / 2]] : [[c.x + c.w / 2, c.y], [c.x + c.w / 2, c.y + c.h]];
}
const NUM_KEY = /^[0-9.,]$/;
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
  const { store } = env;   // env.plan = the level shown (read it at use: switching floors changes it)
  /** Live state read by the overlay. */
  const S = st.struct = { hover: null, hoverHandle: null, pointer: null, draft: null, ghost: null, tip: null, live: null, marker: null, stairGhost: null };
  let anchor = null;            // where the selected segment / opening was, to find it again after a plan change
  let lastEvent = { clientX: 0, clientY: 0 };

  const call = (fn, ...args) => { V.selfWrite = true; try { return fn(...args); } finally { V.selfWrite = false; } };
  const emit = (type, op, level, text, e, extra) => {
    const at = e || lastEvent;
    V.emit('structure', { type, op, level: level || 'free', text: text || '', clientX: at.clientX, clientY: at.clientY, ...(extra || {}) });
  };
  const data = () => structureOf(env.plan);
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
    if (sel.type === 'stair' || sel.type === 'void') return;          // stair / void ids never change
    if (sel.type === 'segment') {
      const s = d.byId.get(sel.id);
      if (s) anchor = { type: 'segment', id: s.id, axis: s.axis, thickness: s.thickness, core: { ...s.core } };
    } else {
      const o = env.plan.openings.find((q) => q.id === sel.id);
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
    if (exists(sel)) { remember(); return; }
    let next = null;
    if (anchor && anchor.type === sel.type && anchor.id === sel.id) {
      if (sel.type === 'opening') {
        const o = env.plan.openings.find((q) => pointInRect(anchor.x, anchor.y, q));
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

  function exists(t) {
    if (t.type === 'segment') return data().byId.has(t.id);
    if (t.type === 'stair') return !!stairOn(env.plan, t.id);
    if (t.type === 'void') return !!voidOn(env.plan, t.id);
    return env.plan.openings.some((o) => o.id === t.id);
  }

  // ───────────── hit testing ─────────────
  function hitTarget(pp) {
    const d = data();
    let best = null;
    const tolO = Math.max(3, 5 / cam.scale);
    for (const o of env.plan.openings) {
      const dist = openingDist(pp.x, pp.y, o, env.plan);
      if (dist <= tolO && (!best || dist < best.dist)) best = { type: 'opening', id: o.id, dist };
    }
    if (!best) {
      const tol = Math.max(4, 6 / cam.scale);
      for (const s of d.segs) {
        const dist = segmentDist(pp.x, pp.y, s);
        if (dist <= tol && (!best || dist < best.dist)) best = { type: 'segment', id: s.id, dist };
      }
    }
    if (!best) {
      // stairs (on their bottom level), then openings in the floor (stage F4b)
      const stv = hitStair(PLAN, env.level, pp.x, pp.y);
      if (stv) best = { type: 'stair', id: stv.stair.id };
      else { const v = hitVoid(env.plan, pp.x, pp.y); if (v) best = { type: 'void', id: v.id }; }
    }
    if (!best) return null;
    const policy = policyOfTarget(env.plan, best);
    return { type: best.type, id: best.id, level: policy.level, reason: policy.reason };
  }
  function hitHandle(p) {
    let best = null;
    for (const h of selectionHandles(env.plan, selected(), cam)) {
      const dist = Math.hypot(h.x - p.x, h.y - p.y);
      if (dist <= HANDLE_REACH && (!best || dist < best.dist)) best = { ...h, dist };
    }
    return best;
  }
  const nearestSegment = (pp) => {
    let best = null, bd = Infinity;
    for (const s of data().segs) { const dist = s.axis === 'a' ? polyDist(pp.x, pp.y, s.poly) : rectDist(pp.x, pp.y, s.core); if (dist < bd) { bd = dist; best = s; } }
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
    } else if (tool === 'stairs') {
      updateStairGhost(p, e);
      V.invalidate();
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
    S.stairGhost = null;
    V.invalidate();
  }

  // ───────────── snap targets of angled walls (per plan revision) ─────────────
  let targetsCache = null;
  /** Points, faces, wall ends and reference lines the angle tools snap to; `self` (a segment) is left out. */
  function targets(self) {
    const plan = env.plan, key = [plan.walls, plan.openings, plan.wallOutline, plan.slants];
    if (!targetsCache || targetsCache.key.some((k, i) => k !== key[i])) {
      const segs = wallSegments(plan);
      targetsCache = { key, all: snapTargets(plan, segs, wallFaces(plan)), segs };
    }
    const T = targetsCache.all;
    if (!self) return T;
    // the wall being changed is no target for itself: its own corners, faces and centre line
    const poly = self.axis === 'a' ? self.poly : [[self.core.x, self.core.y], [self.core.x + self.core.w, self.core.y], [self.core.x + self.core.w, self.core.y + self.core.h], [self.core.x, self.core.y + self.core.h]];
    const near = (x, y) => polyDist(x, y, poly) <= 0.6;
    return {
      points: T.points.filter(([x, y]) => !near(x, y)),
      faces: bridgeFaces(T.faces.filter((f) => !near((f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2)), poly, (self.t || self.thickness || 10) * 3),
      ends: T.ends.filter((q) => !near(q.x, q.y)),
      lines: T.lines.filter((l) => l.id !== self.id),
    };
  }
  /** How far (cm) the angle tools reach for points and faces: about 9 CSS px. */
  const angledReach = () => clamp(9 / cam.scale, 1.5, 30);
  /** Is the angled-walls switch on? It guards only what CREATES an angled wall. */
  const angledOn = () => !!FEATURES.angledWalls;

  // ───────────── drawing a wall ─────────────
  /** Typed length / angle while drawing (angled walls): { field: 'len' | 'ang', len: '', ang: '' }. */
  function typedValues(D) {
    const T = D && D.typed;
    if (!T) return { len: null, ang: null };
    const len = parseFloat(String(T.len).replace(',', '.')), ang = parseFloat(String(T.ang).replace(',', '.'));
    return { len: Number.isFinite(len) && len > 0 ? (store.ui.units === 'cm' ? len : len * 100) : null, ang: Number.isFinite(ang) ? ang : null };
  }
  function updateDraft(p, e) {
    const D = S.draft;
    if (!D) return;
    S.lastDraftP = p;
    const typed = typedValues(D);
    if (angledOn() && !(e && e.shiftKey)) return updateAngledDraft(p, e, typed);
    legacyDraft(io.toPlan(p), e, null);
    D.angled = false; D.typedOn = false;
    D.shown = D.input ? shownAngle(D.input.x2 - D.input.x1, D.input.y2 - D.input.y1) : 0;
  }
  /**
   * The wall tool with the angled-walls switch on: any direction, snapped (slant-tools.snapWallEnd: points / faces, 15°
   * steps with 45° and 90° stronger, parallel / perpendicular, extension lines, 5 cm lengths; Alt frees the angle, Shift is
   * the old axis lock). A direction on an axis is drawn exactly as before (the rect wall's own snapping).
   */
  function updateAngledDraft(p, e, typed) {
    const D = S.draft, pp = io.toPlan(p), t = thickness(), snap = io.snapOn(e);
    const T = snap ? targets() : { points: [], faces: [], ends: [], lines: [] };
    const sn = snapSlantEnd(D.raw, pp, { ...T, reach: angledReach(), scale: cam.scale, free: !snap || (e && e.altKey), step: snap ? 5 : 1, typedLength: typed.len, typedAngle: typed.ang });
    D.typedOn = true;
    const axisDir = Math.abs(Math.sin(sn.deg * Math.PI / 90)) < 1e-9;     // 0 / 90 / 180 / 270°
    if (axisDir && sn.endKind !== 'point' && typed.len == null) {
      const forced = Math.abs(Math.cos(sn.deg * Math.PI / 180)) > 0.5 ? 'h' : 'v';
      legacyDraft({ x: sn.x, y: sn.y }, e, forced);
      Object.assign(D, { angled: false, angleKind: sn.angleKind, endKind: sn.endKind, shown: D.input ? shownAngle(D.input.x2 - D.input.x1, D.input.y2 - D.input.y1) : sn.shown, slantGuides: [] });
      D.readout = `${fmtDim(D.length, store.ui.units)}  ·  ${D.shown}°`;
      return;
    }
    const input = { x1: r01(D.raw.x), y1: r01(D.raw.y), x2: r01(sn.x), y2: r01(sn.y), thickness: t, angled: true };
    const len = Math.hypot(input.x2 - input.x1, input.y2 - input.y1), tooShort = len < 30;
    const chk = tooShort ? { ok: false, reason: '' } : canAddWall(input);
    const f = lineFrame(input.x1, input.y1, input.x2, input.y2), hw = t / 2;
    const quad = [[input.x1 - f.nx * hw, input.y1 - f.ny * hw], [input.x2 - f.nx * hw, input.y2 - f.ny * hw], [input.x2 + f.nx * hw, input.y2 + f.ny * hw], [input.x1 + f.nx * hw, input.y1 + f.ny * hw]];
    const sl = chk.ok && chk.slant ? chk.slant : null;
    const poly = chk.ok ? (chk.poly || (chk.rect ? null : quad)) : quad;
    const ends = sl ? [[sl.x1, sl.y1], [sl.x2, sl.y2]] : [[input.x1, input.y1], [input.x2, input.y2]];
    // an end is joined when the engine moved it onto another wall, or it already sits in one
    const joined = ends.map(([x, y], k) => !!sl && (Math.hypot(x - (k ? input.x2 : input.x1), y - (k ? input.y2 : input.y1)) > 0.05 || inWallOrOpening(x, y, env.plan)));
    const shownLen = sl ? Math.hypot(sl.x2 - sl.x1, sl.y2 - sl.y1) : len;
    Object.assign(D, {
      angled: !(chk.ok && chk.rect), axis: null, input, ok: chk.ok, reason: chk.ok ? '' : chk.reason, level: chk.ok ? chk.level : 'locked',
      poly: poly || quad, rect: chk.ok && chk.rect ? chk.rect : polygonBounds(poly || quad), length: shownLen, thickness: t,
      shown: sn.shown, angleKind: sn.angleKind, endKind: sn.endKind, ends, joined, guides: [], slantGuides: sn.guides, clear: [],
      readout: `${fmtDim(shownLen, store.ui.units)}  ·  ${sn.shown}°`,
    });
  }
  /** The rect wall tool as it always was (axis lock; `forced` = 'h' | 'v' fixes the axis). */
  function legacyDraft(pp, e, forced) {
    const D = S.draft;
    const t = thickness(), opts = { scale: cam.scale, enabled: io.snapOn(e) };
    const dx = pp.x - D.raw.x, dy = pp.y - D.raw.y;
    // axis lock, with a little hysteresis so the ghost does not flicker around the diagonal
    let axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
    if (D.axis && D.axis !== axis && Math.abs(Math.abs(dx) - Math.abs(dy)) < 8 / cam.scale) axis = D.axis;
    if (forced) axis = forced;
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
    if (!e || !Number.isFinite(e.clientX)) e = { ...lastEvent, shiftKey: !!(e && e.shiftKey) };   // committed with Enter
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

  /**
   * Typed entry while drawing an angled wall: digits set the length (in the units shown), Tab switches to the angle field
   * (degrees, counter-clockwise from east), Backspace edits, Enter builds the wall, Esc clears what was typed first.
   * Returns true when the key was used.
   */
  function key(e) {
    const D = S.draft;
    if (io.tool() !== 'wall' || !D || !angledOn() || e.ctrlKey || e.metaKey) return false;
    const T = D.typed || (D.typed = { field: 'len', len: '', ang: '' });
    const k = e.key;
    if (NUM_KEY.test(k) || (k === '-' && T.field === 'ang' && !T.ang)) T[T.field] += k === ',' ? '.' : k;
    else if (k === 'Backspace') { if (!T[T.field] && !T.len && !T.ang) return false; T[T.field] = T[T.field].slice(0, -1); }
    else if (k === 'Tab') T.field = T.field === 'len' ? 'ang' : 'len';
    else if (k === 'Escape') { if (!T.len && !T.ang) return false; T.len = ''; T.ang = ''; T.field = 'len'; }
    else if (k === 'Enter') {
      if (S.lastDraftP) updateDraft(S.lastDraftP, { ...lastEvent, shiftKey: false, altKey: e.altKey, ctrlKey: false, metaKey: false });
      if (S.draft && S.draft.input) { commitDraft(e, true); if (S.draft && S.draft.typed) { S.draft.typed.len = ''; S.draft.typed.ang = ''; } }
      V.invalidate();
      return true;
    } else return false;
    if (S.lastDraftP) updateDraft(S.lastDraftP, { ...lastEvent, shiftKey: false, altKey: e.altKey, ctrlKey: false, metaKey: false });
    V.invalidate();
    return true;
  }

  // ───────────── placing an opening ─────────────
  function updateGhost(p, e) {
    const kind = OPENING_TOOL_KIND[io.tool()];
    if (!kind) { S.ghost = null; return; }
    const pp = io.toPlan(p), d = data(), prev = S.ghost;
    let x = pp.x, y = pp.y;
    if (prev && prev.ok && prev.kind === kind && prev.axis === 'a') {
      // on an angled wall: off the wall the ghost stays (its side = swing, its half = hinge); past a jamb it is pushed along
      const seg = d.byId.get(prev.segmentId);
      if (seg) {
        const f = lineFrame(seg.x1, seg.y1, seg.x2, seg.y2), along = (pp.x - seg.x1) * f.ux + (pp.y - seg.y1) * f.uy, off = Math.abs((pp.x - seg.x1) * f.nx + (pp.y - seg.y1) * f.ny);
        const band = seg.t / 2 + 4 / cam.scale, reach = clamp(70 / cam.scale, REACH, 150);
        if (off > band && off <= reach && nearestSegment(pp) === seg) {
          const half = prev.width / 2, m = 3 / cam.scale;
          const want = along < prev.at - half - m ? along + half : along > prev.at + half + m ? along - half : prev.at;
          x = seg.x1 + f.ux * want; y = seg.y1 + f.uy * want;
        }
      }
    } else if (prev && prev.ok && prev.kind === kind) {
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
    if (axis === 'a' && seg) {
      // a ghost in an angled wall: its frame from the wall (openingFrame reads cx, cy, angle, t)
      const f = lineFrame(seg.x1, seg.y1, seg.x2, seg.y2), cx = seg.x1 + f.ux * chk.at, cy = seg.y1 + f.uy * chk.at;
      const ghost = {
        ok: true, kind, axis: 'a', rect: chk.rect, quad: chk.quad, level: chk.level, segmentId: chk.segmentId, wall: chk.wall, at: chk.at, width: chk.width,
        cx, cy, angle: seg.angle, t: seg.t, centre: { x: r01(cx), y: r01(cy) }, reason: '', lock: false,
      };
      if (kind === 'door') {
        const same = prev && prev.ok && prev.kind === kind && prev.segmentId === chk.segmentId;
        const along = (pp.x - seg.x1) * f.ux + (pp.y - seg.y1) * f.uy, perp = (pp.x - seg.x1) * f.nx + (pp.y - seg.y1) * f.ny;
        ghost.swing = Math.abs(perp) < 1.5 && same ? prev.swing : perp > 0 ? 'r' : 'l';
        ghost.hinge = Math.abs(along - chk.at) < 6 ? (same ? prev.hinge : 'a') : along < chk.at ? 'a' : 'b';
      }
      S.ghost = ghost;
      return;
    }
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

  // ───────────── placing a stair (tool 'stairs', stage F4b) ─────────────
  /** Snap tolerance for stairs against wall faces (cm): about 12 CSS px, at most 25 cm. */
  const stairTol = () => clamp(12 / cam.scale, 3, 25);
  /** Shift the bounding box of a geometry to the walls / grid: the (dx, dy) to apply to the stair's centre. */
  function stairSnap(geo, e) {
    if (!geo || !io.snapOn(e)) return { dx: 0, dy: 0, faces: null };
    const box = polygonBounds(geo.footprint), sn = snapStairBox(box, wallFacesOf(env.plan), stairTol());
    return { dx: sn.x - box.x, dy: sn.y - box.y, faces: [sn.snapX, sn.snapY] };
  }
  /** Free width beside a stair (to the walls) and the distance to the nearest door swing (≤ 1.5 m), for the read-outs. */
  function stairReadouts(geo) {
    if (!geo) return { clear: [], door: null };
    const box = polygonBounds(geo.footprint);
    let door = null;
    for (const r of doorSwingRects(env.plan)) { const g = boxGap(box, r); if (g.d <= 150 && (!door || g.d < door.d)) door = { ...g, id: r.id }; }
    return { clear: snapper.clearances(box, 400), door, box };
  }
  function stairInput(x, y) {
    const ui = store.ui;
    return { level: env.level, shape: ui.stairShape || 'straight', turn: ui.stairTurn === 'left' ? 'left' : 'right', rot: Number(ui.stairRot) || 0, x, y };
  }
  function updateStairGhost(p, e) {
    const pp = io.toPlan(p);
    let input = stairInput(pp.x, pp.y), chk = canAddStair(input);
    if (chk.geo) {
      const sn = stairSnap(chk.geo, e);
      if (sn.dx || sn.dy) { input = stairInput(Math.round((pp.x + sn.dx) * 1000) / 1000, Math.round((pp.y + sn.dy) * 1000) / 1000); chk = canAddStair(input); }
    }
    const ro = chk.geo ? stairReadouts(chk.geo) : { clear: [], door: null };
    S.stairGhost = { ok: chk.ok, reason: chk.ok ? '' : chk.reason, code: chk.code || '', lock: chk.code === 'locked', geo: chk.geo || null, need: chk.need || [], level: chk.ok ? chk.level : 'locked', input, ...ro };
  }
  function placeStair(e) {
    const g = S.stairGhost;
    if (!g) return;
    if (!g.ok) {
      if (g.reason) { emit(g.lock ? 'locked' : 'refused', 'add-stair', 'locked', g.reason, e, { code: g.code }); setTip(g.reason, g.lock ? 'locked' : 'refused'); }
      return;
    }
    const res = call(addStair, g.input);
    if (!res.ok) {
      emit(res.code === 'locked' ? 'locked' : 'refused', 'add-stair', 'locked', res.reason, e, { code: res.code }); setTip(res.reason, 'refused');
      return;
    }
    S.stairGhost = null; setTip(null);
    select({ type: 'stair', id: res.ids[0] });
    emit('done', 'add-stair', res.level, res.warnings[0] || '', e);
    if (res.warnings.length) emit('warning', 'add-stair', res.level, res.warnings[0], e);
    if (!e.shiftKey) store.setUI({ tool: 'structure' });
  }

  // ───────────── drags of a stair / an opening in the floor ─────────────
  function dragMoveStair(g, p, e) {
    const pp = io.toPlan(p), st = stairOn(env.plan, g.id);
    if (!st) return;
    // the geometry at the start of the drag, shifted by the pointer — then snapped to the walls / the grid
    const dx0 = pp.x - g.startPlan.x, dy0 = pp.y - g.startPlan.y;
    const moved = { ...g.geo0, footprint: g.geo0.footprint.map((q) => [q[0] + dx0, q[1] + dy0]) };
    const sn = stairSnap(moved, e);
    const x = Math.round((g.orig.x + dx0 + sn.dx) * 1000) / 1000, y = Math.round((g.orig.y + dy0 + sn.dy) * 1000) / 1000;
    if (x === g.at.x && y === g.at.y) { if (S.tip && S.tip.tone === 'refused') setTip(null); liveStair(g); return; }
    const res = call(updateStair, g.id, { x, y }, TRANSIENT);
    if (res.ok) { g.at = { x, y }; accepted(g, res, e); setTip(null); } else blocked(g, res.reason, e);
    liveStair(g);
  }
  function liveStair(g) {
    const st = stairOn(env.plan, g.id);
    S.live = st ? { op: g.op, stair: g.id, ...stairReadouts(st.geo) } : null;
  }
  function dragRotateStair(g, p, e) {
    const pp = io.toPlan(p), st = stairOn(env.plan, g.id);
    if (!st) return;
    const deg = (Math.atan2(pp.x - st.stair.x, -(pp.y - st.stair.y)) * 180) / Math.PI;
    const rot = ((Math.round((deg + 180) / 90) * 90) % 360 + 360) % 360;       // the grip sits behind the start
    if (rot === (st.stair.rot || 0)) return;
    const res = call(updateStair, g.id, { rot }, TRANSIENT);
    if (res.ok) { accepted(g, res, e); setTip(null); } else blocked(g, res.reason, e);
    liveStair(g);
  }
  function dragStairWidth(g, p, e) {
    const pp = io.toPlan(p), f = g.geo0.flights[0];
    const across = Math.abs((pp.x - f.origin[0]) * f.right[0] + (pp.y - f.origin[1]) * f.right[1]);
    const width = clamp(snapTo(2 * across, GRID), 60, 200);
    const st = stairOn(env.plan, g.id);
    if (!st || width === st.stair.width) return;
    const res = call(updateStair, g.id, { width }, TRANSIENT);
    if (res.ok) { accepted(g, res, e); setTip(null); } else blocked(g, res.reason, e);
    liveStair(g);
  }
  function dragVoid(g, p, e) {
    const pp = io.toPlan(p), k = +g.handle.slice(2);
    const x = io.snapOn(e) ? snapTo(pp.x, GRID) : Math.round(pp.x), y = io.snapOn(e) ? snapTo(pp.y, GRID) : Math.round(pp.y);
    const ring = g.handle.startsWith('vc') ? moveVoidVertex(g.ring0, k, x, y) : moveVoidEdge(g.ring0, k, x, y);
    const key = JSON.stringify(ring);
    if (key === g.last) return;
    const res = call(updateVoid, g.id, { polygon: ring }, TRANSIENT);
    if (res.ok) { g.last = key; accepted(g, res, e); setTip(null); } else blocked(g, res.reason, e);
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
    const policy = policyOfTarget(env.plan, g.target), d = data();
    if (policy.level === 'locked') {
      g.type = 's-locked';
      emit('locked', g.target.type === 'segment' ? 'move-wall' : 'update-opening', 'locked', policy.reason, e);
      setTip(policy.reason, 'locked', true);
      return;
    }
    g.refused = new Set(); g.warned = false; g.changed = false; g.level = policy.level;
    g.orig = { type: g.target.type, id: g.target.id };
    if (g.target.type === 'stair') {
      const stv = stairOn(env.plan, g.target.id);
      if (!stv) { g.type = 'noop'; return; }
      g.id = stv.stair.id; g.geo0 = stv.geo; g.orig = { type: 'stair', id: g.id, x: stv.stair.x, y: stv.stair.y }; g.at = { x: stv.stair.x, y: stv.stair.y };
      if (g.handle === 'stair-rot') { g.type = 's-stair-rot'; g.op = 'rotate-stair'; }
      else if (g.handle === 'stair-width') { g.type = 's-stair-width'; g.op = 'update-stair'; }
      else { g.type = 's-move-stair'; g.op = 'move-stair'; }
      beginBatch(g);
      S.hover = null; S.hoverHandle = null;
      return;
    }
    if (g.target.type === 'void') {
      const v = voidOn(env.plan, g.target.id);
      if (!v || !/^v[ce]\d+$/.test(g.handle)) { g.type = 'noop'; return; }
      g.id = v.id; g.ring0 = v.polygon.map((q) => q.slice()); g.last = JSON.stringify(g.ring0); g.type = 's-void'; g.op = 'update-void';
      beginBatch(g);
      S.hover = null; S.hoverHandle = null;
      return;
    }
    if (g.target.type === 'segment') {
      const s = d.byId.get(g.target.id);
      if (!s) { g.type = 'noop'; return; }
      g.id = s.id; g.axis = s.axis;
      if (s.axis === 'a') {
        // an angled wall: the body moves across it, an end grip turns it about the other end (Shift: along it only)
        const f = lineFrame(s.x1, s.y1, s.x2, s.y2);
        if (g.handle === 'end0' || g.handle === 'end1') {
          const k = g.handle === 'end1' ? 1 : 0;
          g.type = 's-end-slant'; g.op = 'rotate-wall'; g.fixed = k ? [s.x1, s.y1] : [s.x2, s.y2]; g.lastKey = '';
        } else { g.type = 's-move-slant'; g.op = 'move-wall'; g.applied = 0; g.n = [f.nx, f.ny]; }
        beginBatch(g);
        S.hover = null; S.hoverHandle = null;
        return;
      }
      g.grabAlong = s.axis === 'h' ? g.startPlan.x : g.startPlan.y;
      if (g.handle === 'end0' || g.handle === 'end1') {
        g.type = 's-resize-wall'; g.op = 'resize-wall'; g.end = g.handle === 'end0' ? 0 : 1;
        const q = spanOf(s.core, s.axis);
        g.grabAlong = (q.a0 + q.a1) / 2; g.from = g.end ? q.a1 : q.a0;
        // angled walls switched on: dragged off its axis, the end turns the wall into an angled one
        if (angledOn()) { g.canAngle = true; g.fixed = segEnds(s)[1 - g.end]; g.lastKey = ''; }
      } else { g.type = 's-move-wall'; g.op = 'move-wall'; g.applied = 0; }
    } else {
      const o = env.plan.openings.find((q) => q.id === g.target.id);
      if (!o) { g.type = 'noop'; return; }
      g.id = o.id; g.axis = o.axis; g.op = 'update-opening';
      if (o.axis === 'a') {
        // in an angled wall: slide along it, or drag a jamb (the other jamb stays)
        const seg = d.segOfOpening.get(o.id);
        if (!seg) { g.type = 'noop'; return; }
        const f = lineFrame(seg.x1, seg.y1, seg.x2, seg.y2);
        g.u = [f.ux, f.uy]; g.origin = [seg.x1, seg.y1]; g.kind = o.kind;
        const along = (g.startPlan.x - seg.x1) * f.ux + (g.startPlan.y - seg.y1) * f.uy;
        if (g.handle === 'w0' || g.handle === 'w1') { g.type = 's-width-a'; g.side = g.handle === 'w0' ? 0 : 1; g.fixedAt = g.side ? o.at - o.width / 2 : o.at + o.width / 2; }
        else { g.type = 's-slide-a'; g.grabOff = along - o.at; }
        beginBatch(g);
        S.hover = null; S.hoverHandle = null;
        return;
      }
      const q = spanOf(o, o.axis), along = o.axis === 'h' ? g.startPlan.x : g.startPlan.y;
      if (g.handle === 'w0' || g.handle === 'w1') {
        g.type = 's-width'; g.side = g.handle === 'w0' ? 0 : 1; g.fixed = g.side ? q.a0 : q.a1;
        // how far the dragged jamb may go: the wall end or the next opening, less the solid wall the engine keeps
        const seg = d.segOfOpening.get(o.id), core = seg ? spanOf(seg.core, seg.axis) : q;
        let lo = core.a0 + MIN_JAMB, hi = core.a1 - MIN_JAMB;
        for (const id of seg ? seg.openingIds : []) {
          const other = id === o.id ? null : env.plan.openings.find((x) => x.id === id);
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
    if (g.canAngle && !e.shiftKey) {
      // off the wall's own line by more than ~10 px (or already angled): the end turns the wall
      const h = s.axis === 'h', off = Math.abs(h ? pp.y - g.fixed[1] : pp.x - g.fixed[0]);
      if (s.axis === 'a' || off * cam.scale > 10) { g.type = 's-end-slant'; g.op = 'rotate-wall'; dragEndSlant(g, p, e); return; }
    }
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
    const o = env.plan.openings.find((q) => q.id === g.id), seg = data().segOfOpening.get(g.id);
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
        const now = env.plan.openings.find((x) => x.id === g.id), n = now ? spanOf(now, now.axis) : null;
        if (n && (g.side ? n.a0 : n.a1) !== g.fixed) {
          call(updateOpening, g.id, { offset: q.a0 - a0, width: q.a1 - q.a0 }, TRANSIENT);
          why = 'There is not enough free wall on that side.';
        } else { accepted(g, res, e); remember(); }
      }
    }
    if (why) blocked(g, why, e); else setTip(null);
  }

  // ───────────── drags of angled walls and their openings ─────────────
  /** The angled wall's body: across it, delta = (pointer − press) · n, in 5 cm steps (snap off: 1 mm). */
  function dragMoveSlant(g, p, e) {
    const pp = io.toPlan(p), raw = (pp.x - g.startPlan.x) * g.n[0] + (pp.y - g.startPlan.y) * g.n[1];
    const want = io.snapOn(e) ? snapTo(raw, GRID) : r01(raw);
    if (want === g.applied) { if (S.tip && S.tip.tone === 'refused') setTip(null); liveSlant(g); return; }
    let res = call(moveWallSegment, g.id, r01(want - g.applied), TRANSIENT);
    if (res.ok) { g.applied = want; accepted(g, res, e); setTip(null); }
    else {
      const dir = Math.sign(want - g.applied);
      for (let i = 0; i < 16 && g.applied !== want; i++) {
        const step = call(moveWallSegment, g.id, dir * GRID, TRANSIENT);
        if (!step.ok) { res = step; break; }
        g.applied = r01(g.applied + dir * GRID); accepted(g, step, e);
      }
      if (g.applied !== want) blocked(g, res.reason, e); else setTip(null);
    }
    liveSlant(g);
  }
  function liveSlant(g, extra) {
    const s = data().byId.get(g.id);
    S.live = s ? { op: g.op, delta: g.applied || 0, axis: s.axis, seg: s.id, n: g.n || null, from: g.startPlan, ...(extra || {}) } : null;
  }
  /** The segment now holding the dragged wall (ids change when it turns from angled to straight or back). */
  function followEnd(g, res) {
    const d = data(), ids = (res.ids || []).filter((id) => d.byId.has(id));
    let pick = ids.map((id) => d.byId.get(id))[0] || null;
    if (ids.length > 1) {
      // the piece that still holds the fixed end
      pick = ids.map((id) => d.byId.get(id)).find((q) => segEnds(q).some(([x, y]) => Math.hypot(x - g.fixed[0], y - g.fixed[1]) <= 6)) || pick;
    }
    if (pick && pick.id !== g.id) { g.id = pick.id; g.target = { type: 'segment', id: pick.id }; }
    select(g.target);
  }
  /**
   * An end grip: rotateWallEnd about the fixed end with the drawing snaps (Alt: free angle); Shift = along the wall only
   * (resizeWallSegment). Also a straight wall's free end dragged off its axis while the switch is on.
   */
  function dragEndSlant(g, p, e) {
    const pp = io.toPlan(p), s = data().byId.get(g.id);
    if (!s) return;
    const ends = segEnds(s), k = Math.hypot(ends[1][0] - g.fixed[0], ends[1][1] - g.fixed[1]) >= Math.hypot(ends[0][0] - g.fixed[0], ends[0][1] - g.fixed[1]) ? 1 : 0;
    const letter = k ? 'b' : 'a';
    let res, key;
    if (e.shiftKey) {
      // along the wall only
      const mv = ends[k], L0 = Math.hypot(mv[0] - g.fixed[0], mv[1] - g.fixed[1]) || 1, ux = (mv[0] - g.fixed[0]) / L0, uy = (mv[1] - g.fixed[1]) / L0;
      const raw = (pp.x - g.fixed[0]) * ux + (pp.y - g.fixed[1]) * uy, L = io.snapOn(e) ? Math.max(30, snapTo(raw, GRID)) : Math.max(30, r01(raw));
      const delta = r01(L - L0);
      key = `len:${L}`;
      if (!delta) { liveSlant(g, { angle: shownAngle(mv[0] - g.fixed[0], mv[1] - g.fixed[1]), length: L0, at: [mv[0], mv[1]] }); return; }
      res = s.axis === 'a' ? call(resizeWallSegment, g.id, k ? { end: delta } : { start: delta }, TRANSIENT)
        : call(resizeWallSegment, g.id, k ? { end: (s.axis === 'h' ? mv[0] : mv[1]) + delta * (s.axis === 'h' ? ux : uy) } : { start: (s.axis === 'h' ? mv[0] : mv[1]) + delta * (s.axis === 'h' ? ux : uy) }, TRANSIENT);
    } else {
      const snap = io.snapOn(e);
      const T = snap ? targets(s) : { points: [], faces: [], ends: [], lines: [] };
      const sn = snapSlantEnd({ x: g.fixed[0], y: g.fixed[1] }, pp, { ...T, reach: angledReach(), scale: cam.scale, free: !snap || e.altKey, step: snap ? GRID : 1 });
      const pt = { x: r01(sn.x), y: r01(sn.y), angled: true };
      key = `${pt.x},${pt.y}`;
      g.snapInfo = { angle: sn.shown, kind: sn.angleKind, endKind: sn.endKind, guides: sn.guides, at: [pt.x, pt.y], length: sn.len };
      if (key === g.lastKey) { liveSlant(g, g.snapInfo); return; }
      res = call(rotateWallEnd, g.id, letter, pt, TRANSIENT);
    }
    if (res.ok) { g.lastKey = key; followEnd(g, res); accepted(g, res, e); setTip(null); } else blocked(g, res.reason, e);
    const now = data().byId.get(g.id);
    if (now) {
      const ne = segEnds(now), kk = Math.hypot(ne[1][0] - g.fixed[0], ne[1][1] - g.fixed[1]) >= Math.hypot(ne[0][0] - g.fixed[0], ne[0][1] - g.fixed[1]) ? 1 : 0, m = ne[kk];
      liveSlant(g, { ...(g.snapInfo || {}), angle: shownAngle(m[0] - g.fixed[0], m[1] - g.fixed[1]), length: Math.hypot(m[0] - g.fixed[0], m[1] - g.fixed[1]), at: m, fixed: g.fixed });
    }
  }
  /** Slide an opening along its angled wall (the engine clamps it to where it fits). */
  function dragSlideA(g, p, e) {
    const pp = io.toPlan(p), x = r01(pp.x - g.u[0] * g.grabOff), y = r01(pp.y - g.u[1] * g.grabOff);
    const res = call(updateOpening, g.id, { x, y }, TRANSIENT);
    if (res.ok) { accepted(g, res, e); setTip(null); remember(); } else blocked(g, res.reason, e);
  }
  /** A jamb of an opening in an angled wall: the other jamb stays; widths in 5 cm steps within the kind's range. */
  function dragWidthA(g, p, e) {
    const o = env.plan.openings.find((q) => q.id === g.id);
    if (!o) return;
    const pp = io.toPlan(p), along = (pp.x - g.origin[0]) * g.u[0] + (pp.y - g.origin[1]) * g.u[1];
    const [minW, maxW] = WIDTHS[g.kind] || [40, 400];
    let width = snapTo(g.side ? along - g.fixedAt : g.fixedAt - along, GRID), why = '';
    if (width < minW || width > maxW) { width = clamp(width, minW, maxW); why = `A ${KIND_NAME[g.kind] || 'opening'} is ${minW}–${maxW} cm wide.`; }
    const at = r01(g.side ? g.fixedAt + width / 2 : g.fixedAt - width / 2);
    if (width !== o.width || Math.abs(at - o.at) > 0.05) {
      const res = call(updateOpening, g.id, { at, width }, TRANSIENT);
      if (!res.ok) why = res.reason; else { accepted(g, res, e); remember(); }
    }
    if (why) blocked(g, why, e); else setTip(null);
  }

  function endDrag(g, e) {
    S.live = null;
    if (g.batch) {
      // back where it started (or nothing accepted): restore the snapshot exactly instead of recording a no-op step
      const none = ((g.type === 's-move-wall' || g.type === 's-move-slant') && g.applied === 0) || (/^s-(move-stair|stair-|void|end-slant|slide-a|width-a)/.test(g.type) && !g.changed);
      if (none) { call(() => store.cancel()); g.changed = false; } else call(() => store.commit());
    }
    if (g.changed) V.renderer.invalidate();                                   // settle on a complete repaint
    if (S.tip && S.tip.tone === 'refused') setTip(S.tip.text, 'refused');     // let the last reason fade out
    if (g.changed) emit('done', g.op, g.level, g.warning || '', e);
    resolveSelection('history');
  }

  // ───────────── pointer entry points (called by interaction.js) ─────────────
  function down(p, e) {
    lastEvent = e; S.pointer = p; S.touch = e.pointerType === 'touch';
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
    if (tool === 'stairs') { updateStairGhost(p, e); st.gesture = { type: 's-place-stair', start: p }; V.invalidate(); return; }
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
    lastEvent = e; S.pointer = p; S.touch = e.pointerType === 'touch';
    switch (g.type) {
      case 's-press': if (far) { beginDrag(g, p, e); if (g.batch) move(g, p, e, true); } break;
      case 's-move-wall': dragMoveWall(g, p, e); break;
      case 's-resize-wall': dragResizeWall(g, p, e); break;
      case 's-slide': dragSlide(g, p, e); break;
      case 's-width': dragWidth(g, p, e); break;
      case 's-move-slant': dragMoveSlant(g, p, e); break;
      case 's-end-slant': dragEndSlant(g, p, e); break;
      case 's-slide-a': dragSlideA(g, p, e); break;
      case 's-width-a': dragWidthA(g, p, e); break;
      case 's-move-stair': dragMoveStair(g, p, e); break;
      case 's-stair-rot': dragRotateStair(g, p, e); break;
      case 's-stair-width': dragStairWidth(g, p, e); break;
      case 's-void': dragVoid(g, p, e); break;
      case 's-place-stair': updateStairGhost(p, e); break;
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
        // a plain click on a stair's turning grip: a quarter turn clockwise
        if (g.target.type === 'stair' && g.handle === 'stair-rot') {
          const stv = stairOn(env.plan, g.target.id);
          if (stv) {
            const res = call(updateStair, stv.stair.id, { rot: ((stv.stair.rot || 0) + 90) % 360 });
            if (!res.ok) { emit('refused', 'rotate-stair', 'locked', res.reason, e); setTip(res.reason, 'refused'); }
            else { emit('done', 'rotate-stair', res.level, '', e); if (res.warnings.length) emit('warning', 'rotate-stair', res.level, res.warnings[0], e); }
          }
          break;
        }
        // a plain click: the selection was made on press; a locked target explains itself
        const policy = policyOfTarget(env.plan, g.target);
        if (policy.level === 'locked') { emit('locked', 'select', 'locked', policy.reason, e); setTip(policy.reason, 'locked'); }
        break;
      }
      case 's-locked': setTip(S.tip ? S.tip.text : null, 'locked'); break;
      case 's-move-wall': case 's-resize-wall': case 's-slide': case 's-width':
      case 's-move-slant': case 's-end-slant': case 's-slide-a': case 's-width-a':
      case 's-move-stair': case 's-stair-rot': case 's-stair-width': case 's-void': endDrag(g, e); break;
      case 's-place-stair':
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < 12 || e.pointerType === 'touch') placeStair(e);
        break;
      case 's-empty': {
        const pp = io.toPlan(p), space = spaceAt(pp.x, pp.y, env.plan);
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
    S.hover = null; S.hoverHandle = null; S.draft = null; S.ghost = null; S.marker = null; S.live = null; S.tip = null; S.stairGhost = null;
    remember();
  }
  /** The plan changed. `own` = this module made the change (inside a gesture). */
  function planChanged(e, own) {
    if (own) return;
    resolveSelection(e && e.reason);
    if (S.hover && !exists(S.hover)) S.hover = null;
    S.hoverHandle = null; S.ghost = null; S.stairGhost = null;
    if (S.draft && S.draft.input) {
      const chk = canAddWall(S.draft.input); S.draft.ok = chk.ok; S.draft.reason = chk.ok ? '' : chk.reason;
      if (chk.ok && chk.rect) S.draft.rect = chk.rect; else if (chk.ok && chk.poly) S.draft.poly = chk.poly;
    }
  }

  function cursor() {
    const g = st.gesture, tool = io.tool();
    const across = (axis) => (axis === 'h' ? 'ns-resize' : 'ew-resize'), along = (axis) => (axis === 'h' ? 'ew-resize' : 'ns-resize');
    if (g) {
      if (g.type === 's-move-slant' && g.n) return cursorFor(g.n[0], g.n[1]);
      if (g.type === 's-end-slant' || g.type === 's-slide-a' || g.type === 's-width-a') return 'grabbing';
      if (g.type === 's-move-wall') return across(g.axis);
      if (g.type === 's-resize-wall' || g.type === 's-width') return along(g.axis);
      if (g.type === 's-slide' || g.type === 's-move-stair' || g.type === 's-stair-rot' || g.type === 's-void') return 'grabbing';
      if (g.type === 's-stair-width') return g.axis === 'h' ? 'ew-resize' : 'ns-resize';
      if (g.type === 's-locked') return 'not-allowed';
    }
    if (tool === 'wall') return 'crosshair';
    if (tool === 'stairs') return S.stairGhost && !S.stairGhost.ok && S.stairGhost.reason ? 'not-allowed' : 'crosshair';
    if (tool !== 'structure') return S.ghost && S.ghost.lock ? 'not-allowed' : 'crosshair';
    if (S.hoverHandle && S.hoverHandle.axis === 'a') {
      const hh = S.hoverHandle;
      return hh.kind === 'move' ? cursorFor(hh.nx, hh.ny) : hh.kind === 'slide' ? 'grab' : hh.kind.startsWith('w') ? cursorFor(hh.ux, hh.uy) : 'crosshair';
    }
    if (S.hoverHandle) {
      const k = S.hoverHandle.kind;
      if (k === 'stair-rot') return 'grab';
      if (k === 'stair-width') return S.hoverHandle.axis === 'h' ? 'ew-resize' : 'ns-resize';
      if (k.startsWith('vc')) return 'move';
      if (k.startsWith('ve')) return S.hoverHandle.axis === 'h' ? 'ns-resize' : 'ew-resize';
      return k === 'move' ? across(S.hoverHandle.axis) : k === 'slide' ? 'grab' : along(S.hoverHandle.axis);
    }
    const hv = S.hover;
    if (!hv) return 'default';
    if (hv.level === 'locked') return 'not-allowed';
    if (hv.type === 'opening' || hv.type === 'stair') return 'grab';
    if (hv.type === 'void') return 'pointer';
    const s = data().byId.get(hv.id);
    if (s && s.axis === 'a') { const f = lineFrame(s.x1, s.y1, s.x2, s.y2); return cursorFor(f.nx, f.ny); }
    return s ? across(s.axis) : 'default';
  }

  return {
    down, move, up, hover, leave, cancel, toolChanged, planChanged, cursor, remember, key,
    /** `{ type, id, level, reason }` of the wall segment / opening under the cursor, or null. */
    getHover: () => (S.hover ? { type: S.hover.type, id: S.hover.id, level: S.hover.level, reason: S.hover.reason } : null),
  };
}
