/**
 * Floating UI: dialogs, confirm, toasts, menus, popovers and tooltips. Everything lives in one layer element so
 * z-order is predictable, and nothing here uses alert() / confirm() / prompt() / window.open() (inert when sandboxed).
 */
import { h, append, clamp, nextId } from './dom.js';
import { icon } from './icons.js';
import { btn, iconBtn, safeUrl } from './components.js';

let layerEl = null;
/** The floating layer (created on demand, so the module also works in test pages without the shell). */
export function layer() {
  if (layerEl && layerEl.isConnected) return layerEl;
  layerEl = document.getElementById('ui-layer') || document.body.appendChild(h('div', { id: 'ui-layer' }));
  return layerEl;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);

/** Stack of open "escape-able" things: Esc closes the top-most one. */
const escStack = [];
/** Close the top-most popover / menu / dialog. Returns true when something was closed. */
export function closeTopmost() {
  const top = escStack[escStack.length - 1];
  if (!top) return false;
  top();
  return true;
}
export const hasOpenLayer = () => escStack.length > 0;
function pushEsc(fn) { escStack.push(fn); return () => { const i = escStack.indexOf(fn); if (i >= 0) escStack.splice(i, 1); }; }

/**
 * Modal dialog.
 * @param {{ title: string, body: Node|Node[]|string, actions?: Node[], size?: 'sm'|'md'|'lg', cls?: string,
 *           onClose?: Function, dismissable?: boolean, initialFocus?: HTMLElement }} o
 * @returns {{ close(): void, el: HTMLElement, body: HTMLElement }}
 */
export function openDialog(o) {
  const titleId = nextId('dlg');
  const previous = document.activeElement;
  const body = h('div', { class: 'dialog__body' }, o.body);
  const dialog = h('div', { class: `dialog dialog--${o.size || 'md'} ${o.cls || ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('header', { class: 'dialog__head' }, h('h2', { class: 'dialog__title display', id: titleId }, o.title),
      o.dismissable !== false && iconBtn('close', 'Close', { onClick: () => close(), tip: false })),
    body,
    o.actions && o.actions.length ? h('footer', { class: 'dialog__foot' }, o.actions) : null);
  const scrim = h('div', { class: 'scrim', onPointerdown: (e) => { if (e.target === scrim && o.dismissable !== false) close(); } }, dialog);
  let closed = false;
  const popEsc = pushEsc(() => { if (o.dismissable !== false) close(); });
  function close() {
    if (closed) return;
    closed = true;
    popEsc();
    scrim.classList.add('is-leaving');
    setTimeout(() => scrim.remove(), 160);
    if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
    o.onClose && o.onClose();
  }
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = focusables(dialog);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  layer().append(scrim);
  requestAnimationFrame(() => {
    const target = o.initialFocus || dialog.querySelector('[data-autofocus]') || dialog.querySelector('.dialog__foot .btn--primary') || dialog;
    target.focus({ preventScroll: true });
  });
  return { close, el: dialog, body };
}

/** Promise-based confirmation. Resolves true when confirmed. `body` (nodes) replaces the plain `message` paragraph. */
export function confirmDialog({ title, message, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const dlg = openDialog({
      title, size: 'sm', body: body || h('p', { class: 'dialog__text' }, message),
      actions: [
        btn(cancelLabel, { variant: 'quiet', onClick: () => dlg.close() }),
        btn(confirmLabel, { variant: danger ? 'danger' : 'primary', onClick: () => { result = true; dlg.close(); } }),
      ],
      onClose: () => resolve(result),
    });
  });
}

/* ───────────── Toasts ───────────── */
let toastHost = null;
/**
 * Show a short status message.
 * @param {string} message
 * @param {{ kind?: 'info'|'success'|'warn'|'error', level?: 'free'|'warn'|'permit'|'locked', duration?: number,
 *           action?: { label: string, fn: Function } }} [opts]  `level` = structure level (see structure.js): the toast
 *           carries that level's icon and colour instead of the kind's.
 */
export function toast(message, opts = {}) {
  if (!toastHost || !toastHost.isConnected) toastHost = layer().appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const kind = opts.kind || 'info';
  const levelGlyph = { free: 'pass', warn: 'engineer', permit: 'permit', locked: 'lock' }[opts.level];
  const glyph = levelGlyph || { success: 'pass', warn: 'warn', error: 'fail', info: 'info' }[kind] || 'info';
  const el = h('div', { class: `toast toast--${kind}${levelGlyph ? ` toast--level toast--level-${opts.level}` : ''}` }, icon(glyph, { size: 16 }), h('span', { class: 'toast__msg' }, message),
    opts.action && h('button', { type: 'button', class: 'toast__action', onClick: () => { opts.action.fn(); dismiss(); } }, opts.action.label));
  let timer = 0;
  function dismiss() { clearTimeout(timer); el.classList.add('is-leaving'); setTimeout(() => el.remove(), 180); }
  toastHost.append(el);
  while (toastHost.children.length > 3) toastHost.firstChild.remove();
  timer = setTimeout(dismiss, opts.duration || (opts.action || levelGlyph ? 6000 : 3200));
  return dismiss;
}

/* ───────────── Positioning ───────────── */
/**
 * Position a floating element next to an anchor rect (or point), flipping / clamping to stay on screen.
 * placement: 'bottom-start' | 'bottom-end' | 'top-start' | 'top' | 'bottom' | 'right-start' | 'left-start'
 */
export function placeFloating(el, anchor, placement = 'bottom-start', gap = 6) {
  const a = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const w = el.offsetWidth, ht = el.offsetHeight;
  let [side, align = 'center'] = placement.split('-');
  let x, y;
  if (side === 'bottom' && a.bottom + gap + ht > vh - 8 && a.top - gap - ht > 8) side = 'top';
  else if (side === 'top' && a.top - gap - ht < 8) side = 'bottom';
  else if (side === 'right' && a.right + gap + w > vw - 8 && a.left - gap - w > 8) side = 'left';
  else if (side === 'left' && a.left - gap - w < 8) side = 'right';
  if (side === 'bottom' || side === 'top') {
    y = side === 'bottom' ? a.bottom + gap : a.top - gap - ht;
    x = align === 'start' ? a.left : align === 'end' ? a.right - w : a.left + a.width / 2 - w / 2;
  } else {
    x = side === 'right' ? a.right + gap : a.left - gap - w;
    y = align === 'start' ? a.top : align === 'end' ? a.bottom - ht : a.top + a.height / 2 - ht / 2;
  }
  el.style.left = `${Math.round(clamp(x, 8, Math.max(8, vw - w - 8)))}px`;
  el.style.top = `${Math.round(clamp(y, 8, Math.max(8, vh - ht - 8)))}px`;
  el.dataset.side = side;
}

/**
 * Generic popover: floating box anchored to an element; closes on outside press, Esc or close().
 * @returns {{ close(): void, el: HTMLElement, reposition(): void }}
 */
export function openPopover(anchor, content, o = {}) {
  const previous = document.activeElement;
  const el = h('div', { class: `popover ${o.cls || ''}`, role: o.role || 'dialog', 'aria-label': o.label, tabindex: '-1' }, content);
  let closed = false;
  const reposition = () => placeFloating(el, anchor, o.placement || 'bottom-start', o.gap);
  const onDown = (e) => {
    if (el.contains(e.target)) return;
    if (anchor.contains && anchor.contains(e.target)) {
      // Pressing the anchor again closes the popover; swallow the click that follows so it does not reopen.
      const swallow = (ev) => { ev.stopImmediatePropagation(); ev.preventDefault(); };
      anchor.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => anchor.removeEventListener('click', swallow, { capture: true }), 700);
    }
    close(false);
  };
  const popEsc = pushEsc(() => close(true));
  function close(restoreFocus = true) {
    if (closed) return;
    closed = true;
    popEsc();
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('resize', reposition);
    el.remove();
    if (anchor.setAttribute && o.expands !== false) anchor.setAttribute('aria-expanded', 'false');
    if (restoreFocus && previous && previous.isConnected) previous.focus({ preventScroll: true });
    o.onClose && o.onClose();
  }
  layer().append(el);
  reposition();
  if (anchor.setAttribute && o.expands !== false) anchor.setAttribute('aria-expanded', 'true');
  setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
  window.addEventListener('resize', reposition);
  if (o.focus !== false) requestAnimationFrame(() => { (el.querySelector('[data-autofocus]') || focusables(el)[0] || el).focus({ preventScroll: true }); });
  return { close, el, reposition };
}

/**
 * Menu. items: { label, icon?, kbd?, onSelect?, href?, danger?, disabled?, checked? } | { separator: true } | { heading: string }
 * `anchor` is an element or a point { x, y } (context menu).
 */
export function openMenu(anchor, items, o = {}) {
  const list = h('div', { class: 'menu', role: 'menu' });
  const rows = [];
  for (const it of items) {
    if (!it) continue;
    if (it.separator) { list.append(h('div', { class: 'menu__sep', role: 'separator' })); continue; }
    if (it.heading) { list.append(h('div', { class: 'menu__heading' }, it.heading)); continue; }
    const href = it.href && safeUrl(it.href);
    const kids = [
      h('span', { class: 'menu__icon' }, it.checked ? icon('check', { size: 16 }) : it.icon ? icon(it.icon, { size: 16 }) : null),
      h('span', { class: 'menu__label' }, it.label),
      it.kbd && h('span', { class: 'menu__kbd' }, it.kbd),
      href && icon('external', { size: 13 }),
    ];
    const cls = `menu__item${it.danger ? ' is-danger' : ''}`;
    const role = it.checked != null ? 'menuitemcheckbox' : 'menuitem';
    const row = href
      ? h('a', { class: cls, role, href, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', onClick: () => pop.close(false) }, kids)
      : h('button', { type: 'button', class: cls, role, tabindex: '-1', disabled: !!it.disabled, 'aria-checked': it.checked != null ? String(!!it.checked) : null,
        onClick: () => { pop.close(); it.onSelect && it.onSelect(); } }, kids);
    rows.push(row);
    list.append(row);
  }
  list.addEventListener('keydown', (e) => {
    const enabled = rows.filter((r) => !r.disabled);
    const i = enabled.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (enabled[i + 1] || enabled[0])?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (enabled[i - 1] || enabled[enabled.length - 1])?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); enabled[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); enabled[enabled.length - 1]?.focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); pop.close(); }
  });
  const pop = openPopover(anchor, list, { cls: 'popover--menu', placement: o.placement || 'bottom-start', role: 'presentation', expands: !!anchor.getBoundingClientRect, focus: false, onClose: o.onClose });
  requestAnimationFrame(() => (rows.find((r) => !r.disabled) || pop.el).focus({ preventScroll: true }));
  return pop;
}

/* ───────────── Tooltips (delegated: any element with data-tip, optional data-kbd) ───────────── */
let tipEl = null, tipTimer = 0, tipFor = null;
function hideTip() { clearTimeout(tipTimer); tipFor = null; if (tipEl) tipEl.hidden = true; }
function showTip(target) {
  if (!target.isConnected || !target.dataset.tip) return;
  if (!tipEl || !tipEl.isConnected) tipEl = layer().appendChild(h('div', { class: 'tip', role: 'tooltip', hidden: true }));
  tipEl.replaceChildren();
  append(tipEl, [h('span', null, target.dataset.tip), target.dataset.kbd && h('span', { class: 'tip__kbd' }, target.dataset.kbd)]);
  tipEl.hidden = false;
  placeFloating(tipEl, target, target.dataset.tipSide || 'bottom', 8);
}
/** Install the delegated tooltip listeners once. */
export function initTooltips() {
  const find = (t) => (t && t.closest ? t.closest('[data-tip]') : null);
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const t = find(e.target);
    if (t === tipFor) return;
    hideTip();
    if (!t) return;
    tipFor = t;
    tipTimer = setTimeout(() => showTip(t), 450);
  });
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('keydown', hideTip, true);
  document.addEventListener('focusin', (e) => {
    const t = find(e.target);
    if (t && t.matches(':focus-visible')) { hideTip(); tipFor = t; tipTimer = setTimeout(() => showTip(t), 150); }
  });
  document.addEventListener('focusout', hideTip);
  window.addEventListener('blur', hideTip);
}
