/**
 * Walk mode — first-person walk-through of the house and garden.
 *
 * Movement : WASD / arrows (← → turn, A D strafe), Q / E turn, Shift run, gamepad sticks, touch joystick (left half).
 * Looking  : Pointer Lock when the browser grants it, otherwise click-drag; touch: drag on the right half.
 * Glide    : click / tap a spot (no drag) to glide there.
 * Collision: the walker is a circle tested against rotated rectangles (walls + windows from walkBoxes(), tall floor
 *            furniture). Motion is sub-stepped (≤ 8 cm) and penetrations are pushed out along the contact normal, which
 *            gives wall sliding without corner jitter or tunnelling. Blockers that contain the walker when a move starts
 *            are ignored until they have been left.
 *
 * Plan units inside this module are METRES (x east, y south); the public API speaks plan centimetres.
 */
import * as THREE from 'three';
import { walkBoxes, spaceAt, openingFrame } from '../core/geometry.js';
import { groundY } from './items.js';
import { sideVec, sideHeading } from './camera.js';

export const EYE_HEIGHT = 1.65;
export const WALKER_RADIUS = 0.22;
const WALK_SPEED = 1.4, RUN_SPEED = 3.0, TOUCH_SPEED = 2.1, TURN_SPEED = 1.9;
const SUB_STEP = 0.08, LOT_MARGIN = 0.3, EMIT_MS = 1000 / 15;
const PITCH_LIMIT = THREE.MathUtils.degToRad(80);
/** Floor-standing types you can walk across or under. */
const PASSABLE = new Set(['rug', 'surface', 'flower-bed', 'pergola', 'parasol', 'play', 'cushion']);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Vertical FOV for walk mode: ~72° on narrow views, a little tighter on wide screens to avoid edge stretching. */
export function walkFov(aspect) {
  const v = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(48)) / Math.max(0.3, aspect)));
  return clamp(v, 60, 72);
}

/** Default start: just inside the entrance door, looking along its swing direction into the house. */
export function defaultWalkStart(plan) {
  const door = plan.openings.find((o) => o.id === 'door-entry') || plan.openings.find((o) => o.kind === 'door' && o.exterior);
  if (!door) return { x: plan.bounds.x + plan.bounds.w / 2, y: plan.bounds.y + plan.bounds.h / 2, heading: 0 };
  const inward = door.swing || { n: 's', s: 'n', e: 'w', w: 'e' }[door.outside] || 'w';
  const F = openingFrame(door, plan), v = sideVec(inward), depth = F.T / 2 + 55;
  return { x: F.cx + v[0] * depth, y: F.cy + v[1] * depth, heading: sideHeading(inward) };
}

/** Oriented box in plan cm (walkBoxes()) → walker blocker in metres. */
const boxBlocker = (b) => ({ cx: b.cx / 100, cy: b.cy / 100, hw: b.hw / 100, hh: b.hh / 100, cos: b.cos, sin: b.sin, wall: true });
/** Collision boxes (metres) of the plan's walls and windows. */
export const wallBlockers = (plan) => walkBoxes({ ...plan }).map(boxBlocker);

function furnitureBlockers(items, models) {
  const out = [];
  const carp = models && typeof models.getModel === 'function' ? models.getModel('carpentry-unit') : null;
  for (const it of items) {
    if (it.hidden || it.placement !== 'floor' || !(it.h > 45) || (it.elev || 0) > 120 || PASSABLE.has(it.type)) continue;
    const a = ((it.rot || 0) * Math.PI) / 180;
    // a corner pantry blocks its two arms, not the open floor inside its L
    const fp = it.carp && carp && carp.footprint ? carp.footprint(it) : null;
    if (fp && fp.rects) {
      const c = Math.cos(a), s = Math.sin(a);
      for (const r of fp.rects) { const lx = r.x + r.w / 2, ly = r.y + r.h / 2; out.push({ cx: (it.x + lx * c - ly * s) / 100, cy: (it.y + lx * s + ly * c) / 100, hw: r.w / 200, hh: r.h / 200, cos: c, sin: s, id: it.id }); }
      continue;
    }
    if (it.type === 'tree') { const t = clamp(Math.min(it.w, it.d) * 0.0008, 0.1, 0.3); out.push({ cx: it.x / 100, cy: it.y / 100, hw: t, hh: t, cos: 1, sin: 0 }); continue; }
    out.push({ cx: it.x / 100, cy: it.y / 100, hw: it.w / 200, hh: it.d / 200, cos: Math.cos(a), sin: Math.sin(a), id: it.id });
  }
  return out;
}

/** Signed gap between a circle centre and a blocker: ≥ r means clear, < 0 means the centre is inside. */
function gap(p, b) {
  const dx = p.x - b.cx, dy = p.y - b.cy;
  const lx = dx * b.cos + dy * b.sin, ly = -dx * b.sin + dy * b.cos;
  const ox = Math.abs(lx) - b.hw, oy = Math.abs(ly) - b.hh;
  if (ox <= 0 && oy <= 0) return Math.max(ox, oy);
  return Math.hypot(Math.max(ox, 0), Math.max(oy, 0));
}

/** Push the circle out of every (non-ignored) blocker it overlaps. */
function resolve(p, r, blockers, ignore) {
  for (let iter = 0; iter < 6; iter++) {
    let moved = false;
    for (const b of blockers) {
      if (ignore && ignore.has(b)) continue;
      const dx = p.x - b.cx, dy = p.y - b.cy;
      if (Math.abs(dx) > b.hw + b.hh + r || Math.abs(dy) > b.hw + b.hh + r) continue;
      const lx = dx * b.cos + dy * b.sin, ly = -dx * b.sin + dy * b.cos;
      const qx = clamp(lx, -b.hw, b.hw), qy = clamp(ly, -b.hh, b.hh);
      let nx = lx - qx, ny = ly - qy, push;
      const d2 = nx * nx + ny * ny;
      if (d2 >= r * r) continue;
      if (d2 > 1e-12) { const d = Math.sqrt(d2); nx /= d; ny /= d; push = r - d; }
      else {
        const px = b.hw - Math.abs(lx), py = b.hh - Math.abs(ly);
        if (px < py) { nx = lx < 0 ? -1 : 1; ny = 0; push = px + r; } else { nx = 0; ny = ly < 0 ? -1 : 1; push = py + r; }
      }
      p.x += (nx * b.cos - ny * b.sin) * (push + 1e-4);
      p.y += (nx * b.sin + ny * b.cos) * (push + 1e-4);
      moved = true;
    }
    if (!moved) return;
  }
}

const css = (el, text) => { el.style.cssText = text; return el; };

/**
 * @param {{ camera: THREE.PerspectiveCamera, dom: HTMLElement, overlay: HTMLElement, ctx: object,
 *           pickTarget: (clientX: number, clientY: number) => ({x: number, y: number}|null),
 *           emit: (event: string, payload: object) => void, requestExit: () => void }} o
 */
export function createWalk({ camera, dom, overlay, ctx, pickTarget, emit, requestExit }) {
  const { store, plan } = ctx;
  const sb = plan.site.bounds;
  const lot = { x0: sb.x / 100 - LOT_MARGIN, x1: (sb.x + sb.w) / 100 + LOT_MARGIN, y0: sb.y / 100 - LOT_MARGIN, y1: (sb.y + sb.h) / 100 + LOT_MARGIN };
  // a shallow copy defeats any per-plan cache in core: the plan's arrays are replaced when the owner edits the house
  const readWalls = () => wallBlockers(plan);
  let walls = readWalls();

  let active = false;
  let blockers = walls, blockersDirty = true;
  const ignore = new Set();
  const p = { x: 0, y: 0 };
  const vel = { x: 0, y: 0 };
  let yaw = 0, pitch = 0, gy = 0, bob = 0, bobAmt = 0, speedNow = 0;
  let glide = null;
  let lastEmit = 0, lastSent = '';
  let usePointerLock = true, lockDenied = false, locked = false, selfUnlock = false, pendingClick = null;

  const keys = new Set();
  const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const look = { id: null, x: 0, y: 0, moved: 0, t: 0, type: 'mouse' };

  // ───────────── HUD (joystick, crosshair, hint) ─────────────
  const joyBase = css(document.createElement('div'), 'position:absolute;width:116px;height:116px;margin:-58px 0 0 -58px;border-radius:50%;border:1.5px solid rgba(255,255,255,.6);background:radial-gradient(circle,rgba(255,255,255,.10),rgba(20,22,26,.22));box-shadow:0 6px 24px rgba(0,0,0,.18);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;transition:opacity .18s ease;pointer-events:none');
  const joyKnob = css(document.createElement('div'), 'position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,255,255,.92);box-shadow:0 2px 10px rgba(0,0,0,.28);will-change:transform');
  joyBase.className = 'v3d-joystick'; joyBase.appendChild(joyKnob);
  const cross = css(document.createElement('div'), 'position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(255,255,255,.9);box-shadow:0 0 0 1.5px rgba(0,0,0,.35);opacity:0;transition:opacity .15s ease;pointer-events:none');
  cross.className = 'v3d-crosshair';
  const hint = css(document.createElement('div'), 'position:absolute;left:50%;bottom:22px;transform:translateX(-50%);max-width:calc(100% - 32px);padding:8px 14px;border-radius:999px;background:rgba(18,20,24,.62);color:#fff;font:500 12.5px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;transition:opacity .5s ease;pointer-events:none');
  hint.className = 'v3d-walk-hint';
  let hintTimer = 0;
  const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  function showHint() {
    hint.textContent = coarse()
      ? 'Left thumb to move · drag to look around · tap a spot to go there'
      : `WASD / arrows to move · ${usePointerLock && !lockDenied ? 'click to capture the mouse' : 'drag to look, click to go there'} · Shift to run · Esc to exit`;
    hint.style.opacity = '1';
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hint.style.opacity = '0'; }, 5200);
  }
  function restJoystick() {
    joyBase.style.left = '86px'; joyBase.style.top = 'calc(100% - 96px)';
    joyKnob.style.transform = 'translate(0px,0px)';
    joyBase.style.opacity = coarse() ? '0.55' : '0';
  }

  // ───────────── blockers ─────────────
  function rebuildBlockers() {
    blockers = walls.concat(furnitureBlockers(store.items, ctx.models));
    blockersDirty = false;
    for (const b of [...ignore]) if (!b.wall) ignore.delete(b);
    adoptContaining();
  }
  /** Blockers the walker currently stands inside stop blocking until they are left. */
  function adoptContaining() {
    for (const b of blockers) if (gap(p, b) < 0.02) ignore.add(b);
  }
  function releaseLeft() {
    for (const b of ignore) if (gap(p, b) >= WALKER_RADIUS) ignore.delete(b);
  }
  function clampLot() { p.x = clamp(p.x, lot.x0, lot.x1); p.y = clamp(p.y, lot.y0, lot.y1); }

  /** Move by (dx, dy) metres with collision; `list` = blockers to test. */
  function move(dx, dy, list) {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / SUB_STEP));
    for (let i = 0; i < n; i++) {
      p.x += dx / n; p.y += dy / n;
      resolve(p, WALKER_RADIUS, list, ignore);
      clampLot();
    }
  }

  // ───────────── state / events ─────────────
  const headingDeg = () => (((yaw * 180) / Math.PI) % 360 + 360) % 360;
  function state() {
    const s = spaceAt(p.x * 100, p.y * 100, plan);
    return { x: p.x * 100, y: p.y * 100, heading: headingDeg(), pitch: (pitch * 180) / Math.PI, spaceId: s ? s.id : null, speed: speedNow, gliding: !!glide, pointerLocked: locked };
  }
  function emitPosition(now, force) {
    if (!force && now - lastEmit < EMIT_MS) return;
    const s = state();
    const sig = `${s.x.toFixed(1)}|${s.y.toFixed(1)}|${s.heading.toFixed(1)}`;
    if (!force && sig === lastSent) return;
    lastSent = sig; lastEmit = now;
    emit('walk-position', { x: s.x, y: s.y, heading: s.heading, spaceId: s.spaceId });
  }

  function applyCamera() {
    const sway = Math.sin(bob) * 0.012 * bobAmt, lift = Math.abs(Math.sin(bob)) * 0.03 * bobAmt;
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch, -yaw, 0);
    camera.position.set(p.x + Math.cos(yaw) * sway, gy + EYE_HEIGHT - 0.012 * bobAmt + lift, p.y + Math.sin(yaw) * sway);
  }

  function place(x, y, heading) {
    p.x = x / 100; p.y = y / 100; clampLot();
    if (heading != null) yaw = (heading * Math.PI) / 180;
    vel.x = vel.y = 0; glide = null;
    ignore.clear();
    if (blockersDirty) rebuildBlockers(); else adoptContaining();
    resolve(p, WALKER_RADIUS, blockers, ignore);
    gy = groundY(p.x * 100, p.y * 100, plan);
  }

  /** Glide to a plan point (cm). Walls stop the glide; furniture is crossed and left on arrival. */
  function glideTo(x, y) {
    const to = { x: clamp(x / 100, lot.x0, lot.x1), y: clamp(y / 100, lot.y0, lot.y1) };
    resolve(to, WALKER_RADIUS, walls, null);
    const dist = Math.hypot(to.x - p.x, to.y - p.y);
    if (dist < 0.05) return;
    glide = { fx: p.x, fy: p.y, tx: to.x, ty: to.y, t: 0, dur: reducedMotion() ? 0.001 : clamp(dist / 5, 0.4, 1.15), px: p.x, py: p.y };
    vel.x = vel.y = 0;
  }

  // ───────────── input ─────────────
  const typing = (e) => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space']);
  function onKeyDown(e) {
    if (!active || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape') { e.preventDefault(); requestExit(); return; }
    if (!MOVE_KEYS.has(e.code)) return;
    e.preventDefault();
    keys.add(e.code);
    if (e.code !== 'ShiftLeft' && e.code !== 'ShiftRight' && e.code !== 'Space') glide = null;
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function onBlur() { keys.clear(); }

  function requestLock() {
    if (!usePointerLock || lockDenied || typeof dom.requestPointerLock !== 'function') return false;
    try {
      const r = dom.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(onLockError);
    } catch (e) { onLockError(); return false; }
    return true;
  }
  function onLockError() {
    lockDenied = true;
    if (pendingClick && active) { const c = pendingClick; pendingClick = null; goTo(c.x, c.y); }
  }
  function onLockChange() {
    const now = document.pointerLockElement === dom;
    const was = locked; locked = now; pendingClick = null;
    cross.style.opacity = locked ? '1' : '0';
    dom.style.cursor = locked ? 'none' : 'grab';
    // The browser released the lock on Esc: that is the user's "leave walk mode".
    if (was && !now && active && !selfUnlock && document.hasFocus()) requestExit();
    selfUnlock = false;
  }
  function goTo(clientX, clientY) {
    const t = pickTarget(clientX, clientY);
    if (t) glideTo(t.x, t.y);
  }

  function onPointerDown(e) {
    if (!active) return;
    const rect = dom.getBoundingClientRect();
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (touch && joy.id === null && e.clientX - rect.left < rect.width / 2) {
      joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0;
      joyBase.style.left = `${e.clientX - rect.left}px`; joyBase.style.top = `${e.clientY - rect.top}px`;
      joyBase.style.opacity = '1';
      glide = null;
    } else if (look.id === null && (touch || e.button === 0)) {
      Object.assign(look, { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now(), type: e.pointerType });
      if (!locked) dom.style.cursor = 'grabbing';
    } else return;
    try { dom.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!active) return;
    if (e.pointerId === joy.id) {
      const R = 52, dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, len = Math.hypot(dx, dy) || 1, k = Math.min(1, R / len);
      joy.x = (dx * k) / R; joy.y = (dy * k) / R;
      joyKnob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
      return;
    }
    if (locked) { turn(e.movementX || 0, e.movementY || 0, 0.0022); return; }
    if (e.pointerId !== look.id) return;
    const dx = e.clientX - look.x, dy = e.clientY - look.y;
    look.x = e.clientX; look.y = e.clientY; look.moved += Math.abs(dx) + Math.abs(dy);
    if (look.moved > 4) turn(dx, dy, look.type === 'mouse' ? 0.0042 : 0.0052);
  }
  function turn(dx, dy, k) {
    yaw += dx * k;
    pitch = clamp(pitch - dy * k, -PITCH_LIMIT, PITCH_LIMIT);
  }
  function onPointerUp(e) {
    if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; restJoystick(); return; }
    if (e.pointerId !== look.id) return;
    look.id = null;
    if (!locked) dom.style.cursor = 'grab';
    if (!active || e.type === 'pointercancel') return;
    const click = look.moved < 6 && performance.now() - look.t < 450;
    if (!click) return;
    if (locked) { const r = dom.getBoundingClientRect(); goTo(r.left + r.width / 2, r.top + r.height / 2); return; }
    if (look.type === 'mouse' && requestLock()) { pendingClick = { x: e.clientX, y: e.clientY }; return; }
    goTo(e.clientX, e.clientY);
  }

  function gamepad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of pads) {
      if (!g || !g.connected || g.axes.length < 2) continue;
      const dz = (v) => (Math.abs(v) < 0.16 ? 0 : v);
      return { mx: dz(g.axes[0]), my: dz(g.axes[1]), lx: dz(g.axes[2] || 0), ly: dz(g.axes[3] || 0), run: !!(g.buttons[0] && g.buttons[0].pressed) };
    }
    return null;
  }

  const offItems = store.on('items', () => { blockersDirty = true; });

  function update(dt) {
    if (!active) return;
    if (blockersDirty) rebuildBlockers();
    const pad = gamepad();
    const k = (c) => (keys.has(c) ? 1 : 0);

    const turnIn = k('KeyE') + k('ArrowRight') - k('KeyQ') - k('ArrowLeft') + (pad ? pad.lx : 0);
    yaw += turnIn * TURN_SPEED * dt;
    if (pad && pad.ly) pitch = clamp(pitch - pad.ly * 1.4 * dt, -PITCH_LIMIT, PITCH_LIMIT);

    let fwd = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') - joy.y - (pad ? pad.my : 0);
    let side = k('KeyD') - k('KeyA') + joy.x + (pad ? pad.mx : 0);
    const mag = Math.hypot(fwd, side);
    if (mag > 1) { fwd /= mag; side /= mag; }
    const analog = joy.id !== null || (pad && (pad.mx || pad.my));
    const top = keys.has('ShiftLeft') || keys.has('ShiftRight') || (pad && pad.run) ? RUN_SPEED : analog ? TOUCH_SPEED : WALK_SPEED;
    const fx = Math.sin(yaw), fy = -Math.cos(yaw), rx = Math.cos(yaw), ry = Math.sin(yaw);
    const tvx = (fx * fwd + rx * side) * top, tvy = (fy * fwd + ry * side) * top;
    if (mag > 0.05 && glide) glide = null;

    const x0 = p.x, y0 = p.y;
    if (glide) {
      glide.t = Math.min(1, glide.t + dt / glide.dur);
      const e = easeInOut(glide.t);
      const ix = glide.fx + (glide.tx - glide.fx) * e, iy = glide.fy + (glide.ty - glide.fy) * e;
      move(ix - glide.px, iy - glide.py, walls);
      glide.px = ix; glide.py = iy;
      if (glide.t >= 1) { glide = null; adoptContaining(); resolve(p, WALKER_RADIUS, blockers, ignore); }
    } else {
      const a = 1 - Math.exp(-dt * (mag > 0.05 ? 9 : 12));
      vel.x += (tvx - vel.x) * a; vel.y += (tvy - vel.y) * a;
      if (Math.abs(vel.x) + Math.abs(vel.y) > 1e-3) move(vel.x * dt, vel.y * dt, blockers);
      else vel.x = vel.y = 0;
    }
    releaseLeft();

    speedNow = dt > 0 ? Math.hypot(p.x - x0, p.y - y0) / dt : 0;
    const wantBob = glide || reducedMotion() ? 0 : clamp(speedNow / WALK_SPEED, 0, 1.25);
    bobAmt += (wantBob - bobAmt) * (1 - Math.exp(-dt * 8));
    bob += speedNow * dt * 4.1;
    gy += (groundY(p.x * 100, p.y * 100, plan) - gy) * (1 - Math.exp(-dt / 0.07));
    applyCamera();
    emitPosition(performance.now(), false);
  }

  return {
    /** @param {{ x?: number, y?: number, heading?: number, pointerLock?: boolean }} [opts] plan cm / degrees clockwise from north-up */
    start(opts = {}) {
      const d = defaultWalkStart(plan);
      usePointerLock = opts.pointerLock !== false;
      blockersDirty = true;
      pitch = 0; bob = 0; bobAmt = 0;
      place(opts.x ?? d.x, opts.y ?? d.y, opts.heading ?? d.heading);
      if (active) { applyCamera(); emitPosition(performance.now(), true); return; }
      active = true;
      overlay.append(joyBase, cross, hint);
      restJoystick();
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      document.addEventListener('pointerlockchange', onLockChange);
      document.addEventListener('pointerlockerror', onLockError);
      dom.addEventListener('pointerdown', onPointerDown);
      dom.addEventListener('pointermove', onPointerMove);
      dom.addEventListener('pointerup', onPointerUp);
      dom.addEventListener('pointercancel', onPointerUp);
      dom.style.cursor = 'grab';
      applyCamera();
      showHint();
      emitPosition(performance.now(), true);
    },
    stop() {
      if (!active) return;
      active = false;
      keys.clear(); joy.id = null; look.id = null; glide = null; pendingClick = null;
      clearTimeout(hintTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      if (document.pointerLockElement === dom) { selfUnlock = true; document.exitPointerLock(); }
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      locked = false;
      joyBase.remove(); cross.remove(); hint.remove();
      cross.style.opacity = '0'; hint.style.opacity = '0';
      dom.style.cursor = '';
      camera.rotation.order = 'XYZ';
    },
    update,
    isActive: () => active,
    getState: state,
    /** Snap the camera to the walker (used right after the fly-in transition). */
    syncCamera: applyCamera,
    /** Eye pose for the current walker state: { position, quaternion }. */
    eyePose() {
      const e = new THREE.Euler(pitch, -yaw, 0, 'YXZ');
      return { position: new THREE.Vector3(p.x, gy + EYE_HEIGHT, p.y), quaternion: new THREE.Quaternion().setFromEuler(e) };
    },
    teleport(x, y, heading) { place(x, y, heading); applyCamera(); emitPosition(performance.now(), true); },
    glideTo,
    /** Test hook: is a circle of the walker's radius at plan (x, y) cm overlapping a wall, window or blocking furniture? */
    blockedAt(x, y, { furniture = true } = {}) {
      if (blockersDirty) rebuildBlockers();
      const q = { x: x / 100, y: y / 100 };
      return (furniture ? blockers : walls).some((b) => gap(q, b) < WALKER_RADIUS - 2e-3);
    },
    blockerCount: () => (blockersDirty ? (rebuildBlockers(), blockers.length) : blockers.length),
    /** The plan was edited: re-read walls / windows; a walker now standing inside a wall is let out, not trapped. */
    refreshPlan() {
      walls = readWalls();
      for (const b of [...ignore]) if (b.wall) ignore.delete(b);
      glide = null;
      rebuildBlockers();
      if (active) gy = groundY(p.x * 100, p.y * 100, plan);
    },
    dispose() { this.stop(); offItems(); },
  };
}
