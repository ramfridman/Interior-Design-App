/**
 * Tiny DOM helpers shared by every UI module. No framework: panels build their DOM once and patch it on store events.
 */

/**
 * Hyperscript element factory.
 * @param {string} tag
 * @param {object|null} [props]  class, style (string|object), dataset, on<Event> handlers, boolean / string attributes
 * @param {...(Node|string|number|null|false|Array)} kids
 * @returns {HTMLElement}
 */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else Object.assign(el.style, v); }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, kids);
  return el;
}

/** Append strings / nodes / nested arrays, skipping null and false. */
export function append(el, kids) {
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    if (Array.isArray(kid)) append(el, kid);
    else el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** Replace all children of `el`. */
export function setKids(el, ...kids) {
  el.replaceChildren();
  return append(el, kids);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Trailing-edge debounce. The returned function has .cancel(). */
export function debounce(fn, ms = 150) {
  let t = 0;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/** Coalesce many calls into one per animation frame (last arguments win). */
export function rafThrottle(fn) {
  let queued = false, last = [];
  return (...args) => {
    last = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...last); });
  };
}

/** Call an optional method on an object that may be missing or incomplete; never throws. */
export function call(obj, method, ...args) {
  try {
    if (obj && typeof obj[method] === 'function') return obj[method](...args);
  } catch (err) {
    console.error(`[ui] ${method}() failed`, err);
  }
  return undefined;
}

/** Subscribe to a view event if the view supports `on`; returns an unsubscribe function either way. */
export function listen(view, event, fn) {
  try {
    if (view && typeof view.on === 'function') {
      const off = view.on(event, (payload) => { try { fn(payload); } catch (err) { console.error(`[ui] "${event}" handler failed`, err); } });
      return typeof off === 'function' ? off : () => {};
    }
  } catch (err) { /* the view does not know this event */ }
  return () => {};
}

/** True when the keyboard focus is in something the user types into. */
export function isTyping(target = document.activeElement) {
  if (!target || target === document.body) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['checkbox', 'radio', 'button', 'range', 'color', 'file'].includes(target.type);
  return !!target.isContentEditable;
}

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/** "Sofas & armchairs" from "sofas-armchairs"-style ids. */
export function titleize(id = '') {
  const s = String(id).replace(/-/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/** Escape text for use inside CSV cells. */
export function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

let uid = 0;
/** Unique id for label/aria wiring. */
export const nextId = (prefix = 'ui') => `${prefix}-${++uid}`;
