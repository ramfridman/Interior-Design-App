/**
 * Small reusable controls. Every control is a plain element with the behaviour wired in; controls that hold a value
 * expose `.set(value)` so panels can patch them in place instead of re-rendering.
 */
import { h, append, nextId, clamp } from './dom.js';
import { icon } from './icons.js';
import { parseNum } from './format.js';

/** Only https links are ever rendered as retailer links. */
export const safeUrl = (url) => (typeof url === 'string' && /^https:\/\//i.test(url) ? url : null);

/**
 * Text button, or an anchor styled as a button when `href` is given (real links survive sandboxed iframes).
 * @param {string} label
 * @param {{ variant?: 'default'|'primary'|'quiet'|'danger', icon?: string, iconRight?: string, onClick?: Function,
 *           href?: string, small?: boolean, block?: boolean, disabled?: boolean, tip?: string, kbd?: string, attrs?: object }} [o]
 */
export function btn(label, o = {}) {
  const cls = `btn btn--${o.variant || 'default'}${o.small ? ' btn--sm' : ''}${o.block ? ' btn--block' : ''}`;
  const kids = [o.icon && icon(o.icon, { size: 16 }), h('span', { class: 'btn__label' }, label), o.iconRight && icon(o.iconRight, { size: 14 })];
  const href = o.href && safeUrl(o.href);
  const common = { class: cls, 'data-tip': o.tip, 'data-kbd': o.kbd, ...(o.attrs || {}) };
  if (href) return h('a', { ...common, href, target: '_blank', rel: 'noopener noreferrer' }, kids);
  return h('button', { ...common, type: 'button', disabled: !!o.disabled, onClick: o.onClick }, kids);
}

/** Square icon-only button with an accessible name and tooltip. */
export function iconBtn(name, label, o = {}) {
  const el = h('button', {
    type: 'button', class: `iconbtn${o.variant ? ' iconbtn--' + o.variant : ''}${o.class ? ' ' + o.class : ''}`,
    'aria-label': label, 'data-tip': o.tip === false ? null : (o.tip || label), 'data-kbd': o.kbd,
    'aria-pressed': o.pressed == null ? null : String(!!o.pressed), disabled: !!o.disabled, onClick: o.onClick,
  }, icon(name, { size: o.size || 18 }));
  el.setPressed = (v) => el.setAttribute('aria-pressed', String(!!v));
  el.setIcon = (n) => el.replaceChildren(icon(n, { size: o.size || 18 }));
  return el;
}

/** External link with the "opens elsewhere" arrow. Returns null for anything that is not an https URL. */
export function extLink(label, url, cls = '') {
  const href = safeUrl(url);
  if (!href) return null;
  return h('a', { class: `extlink ${cls}`, href, target: '_blank', rel: 'noopener noreferrer' }, h('span', null, label), icon('external', { size: 13 }));
}

/**
 * Segmented control (radio group). options: [{ value, label, icon?, tip?, kbd? }]
 * @returns {HTMLElement & { set(value): void }}
 */
export function segmented({ options, value, onChange, label, iconOnly = false, cls = '' }) {
  const root = h('div', { class: `seg ${cls}`, role: 'radiogroup', 'aria-label': label });
  const buttons = options.map((opt) => h('button', {
    type: 'button', class: 'seg__btn', role: 'radio', 'aria-checked': 'false', tabindex: '-1',
    'aria-label': iconOnly ? opt.label : null, 'data-tip': opt.tip || (iconOnly ? opt.label : null), 'data-kbd': opt.kbd,
    dataset: { value: String(opt.value) },
    onClick: () => { if (current !== opt.value) { root.set(opt.value); onChange && onChange(opt.value); } },
  }, opt.icon && icon(opt.icon, { size: 16 }), !iconOnly && h('span', { class: 'seg__label' }, opt.label)));
  let current;
  root.set = (v) => {
    current = v;
    buttons.forEach((b, i) => {
      const on = options[i].value === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on || (v == null && i === 0) ? 0 : -1;
    });
  };
  root.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = Math.max(0, options.findIndex((o) => o.value === current));
    const next = options[(i + dir + options.length) % options.length];
    root.set(next.value); onChange && onChange(next.value);
    buttons[options.indexOf(next)].focus();
  });
  append(root, buttons);
  root.set(value);
  return root;
}

/**
 * Labelled numeric field. Commits on Enter / blur, Esc reverts, ↑↓ step (Shift ×10).
 * @returns {HTMLElement & { set(value:number): void, input: HTMLInputElement }}
 */
export function numField({ label, value, step = 1, min = -Infinity, max = Infinity, digits = 0, suffix, onCommit, disabled, title }) {
  const id = nextId('num');
  let current = value;
  const fmt = (v) => (v == null || Number.isNaN(v) ? '' : Number(v).toFixed(digits));
  const input = h('input', { id, class: 'field__input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', value: fmt(value), disabled: !!disabled, 'aria-label': title || label });
  const commit = (v) => {
    if (v == null) { input.value = fmt(current); return; }
    v = clamp(v, min, max);
    input.value = fmt(v);
    if (Math.abs(v - current) < 1e-9) return;
    current = v;
    onCommit && onCommit(v);
  };
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', () => commit(parseNum(input.value)));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commit(parseNum(input.value)); input.select(); }
    else if (e.key === 'Escape') { input.value = fmt(current); input.blur(); e.stopPropagation(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const base = parseNum(input.value) ?? current ?? 0;
      commit(base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
    }
  });
  const root = h('label', { class: `field field--num${disabled ? ' is-disabled' : ''}`, for: id },
    label && h('span', { class: 'field__label' }, label), input, suffix && h('span', { class: 'field__suffix' }, suffix));
  root.input = input;
  root.set = (v) => { current = v; if (document.activeElement !== input) input.value = fmt(v); };
  return root;
}

/** Switch (checkbox semantics). Returns the label element with `.set(bool)`. */
export function toggle({ label, checked, onChange, hint }) {
  const input = h('input', { type: 'checkbox', class: 'switch__input', role: 'switch', checked: !!checked, onChange: () => onChange && onChange(input.checked) });
  const root = h('label', { class: 'switch' }, h('span', { class: 'switch__text' }, label, hint && h('small', { class: 'faint' }, hint)), input, h('span', { class: 'switch__track', 'aria-hidden': 'true' }));
  root.set = (v) => { input.checked = !!v; };
  return root;
}

/** Panel section with a quiet heading and optional trailing action. */
export function section(title, opts, ...kids) {
  if (opts && (opts.nodeType || Array.isArray(opts) || typeof opts === 'string')) { kids.unshift(opts); opts = {}; }
  opts = opts || {};
  return h('section', { class: `sec ${opts.class || ''}` },
    title && h('header', { class: 'sec__head' }, h('h3', { class: 'sec__title' }, title), opts.aside),
    kids);
}

/** Empty / zero-data state: one line of what is going on and (optionally) what to do next. */
export function emptyState({ icon: name, title, text, action }) {
  return h('div', { class: 'empty' }, name && h('div', { class: 'empty__icon' }, icon(name, { size: 22 })),
    h('p', { class: 'empty__title' }, title), text && h('p', { class: 'empty__text' }, text), action);
}

/** Colour swatch button. */
export function swatch(color, { selected, label, onClick } = {}) {
  return h('button', { type: 'button', class: 'swatch', 'aria-label': label || color, 'data-tip': label || color, 'aria-pressed': String(!!selected), style: { '--sw': color }, onClick });
}

/** Keyboard key cap(s): kbd('Ctrl', 'Z'). */
export const kbd = (...keys) => h('span', { class: 'kbd' }, keys.map((k) => h('kbd', null, k)));
