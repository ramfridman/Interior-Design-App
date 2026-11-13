/**
 * Thumbnails for products and placed items.
 *
 * Every thumbnail starts as an instant placeholder drawn here (the item's architectural plan symbol, or a swatch for
 * floor / wall finishes). When the 3D team's renderer (src/view3d/thumbs.js → getThumbnail) is available the rendered
 * picture fades in over it. Requests are lazy (IntersectionObserver), queued (one at a time, with a pause between renders) and cancellable, so a
 * 600-product grid never stalls scrolling.
 */
import { h } from './dom.js';

const MAX_PARALLEL = 1;
/** Pause between renders so 3D thumbnail work never starves scrolling, dragging or animations. */
const BREATHE_MS = 48;

/** Stable cache key: products by id; generic items by their look. */
function keyOf(subject) {
  if (subject.productId) return 'p:' + subject.productId;
  if (subject.dims && subject.id) return 'p:' + subject.id;
  return `i:${subject.type}:${subject.w}x${subject.d}x${subject.h}:${JSON.stringify(subject.params || {})}`;
}

/** Normalise a product or an item to the item-like shape the model functions expect. */
function asItem(subject) {
  if (subject.dims) return { id: subject.id, type: subject.type, params: subject.params || {}, w: subject.dims.w, d: subject.dims.d, h: subject.dims.h, placement: subject.placement };
  return subject;
}

const isFinishType = (t) => t === 'floor-finish' || t === 'wall-finish';

/** Paint a floor / wall finish swatch from its params. */
export function drawFinishSwatch(g, size, params = {}, type = 'floor-finish') {
  const c1 = params.color || (type === 'wall-finish' ? '#f4f1ea' : '#d9d4ca');
  const c2 = params.color2 || 'rgba(0,0,0,0.14)';
  g.fillStyle = c1;
  g.fillRect(0, 0, size, size);
  const pattern = params.pattern || (params.kind === 'paint' || params.kind === 'plaster' || params.kind === 'microcement' ? 'plain' : 'tile');
  if (pattern === 'plain' || pattern === 'concrete' || pattern === 'terrazzo') {
    if (pattern === 'terrazzo') {
      g.fillStyle = c2;
      for (let i = 0; i < 46; i++) { const x = (i * 73) % size, y = (i * 131) % size; g.fillRect(x, y, 2 + (i % 3), 2 + ((i * 7) % 3)); }
    }
    return;
  }
  // Show roughly 2.4 m of surface so tile proportions read correctly.
  const scale = size / 240;
  const tw = Math.max(8, (params.tileW || 60) * scale), th = Math.max(4, (params.tileH || 60) * scale);
  g.strokeStyle = c2;
  g.lineWidth = Math.max(1, size / 110);
  g.beginPath();
  if (pattern === 'herringbone' || pattern === 'chevron') {
    const s = Math.max(10, Math.min(tw, th) * 1.6);
    for (let y = -s; y < size + s; y += s) for (let x = -s; x < size + s; x += s * 2) {
      g.moveTo(x, y + s); g.lineTo(x + s, y); g.lineTo(x + s * 2, y + s);
    }
  } else {
    const stagger = pattern === 'plank' || pattern === 'deck' || pattern === 'subway' || pattern === 'running-bond';
    let row = 0;
    for (let y = 0; y <= size; y += th, row++) {
      g.moveTo(0, y); g.lineTo(size, y);
      const off = stagger && row % 2 ? tw / 2 : 0;
      for (let x = off; x <= size; x += tw) { g.moveTo(x, y); g.lineTo(x, Math.min(size, y + th)); }
    }
  }
  g.stroke();
}

/**
 * @param {{ models?: object }} ctx
 * @returns {{ el(subject: object, opts?: { size?: number, lazy?: boolean }): HTMLElement, forget(el: HTMLElement): void }}
 */
export function createThumbs(ctx) {
  const urls = new Map();        // key → data URL (resolved)
  const waiting = [];            // [{ key, subject, size, els:Set }]
  const byKey = new Map();       // key → queue entry
  let running = 0;
  let renderer;                  // undefined = not tried, null = unavailable, fn = getThumbnail

  async function loadRenderer() {
    if (renderer !== undefined) return renderer;
    try {
      const mod = await import('../view3d/thumbs.js');
      renderer = typeof mod.getThumbnail === 'function' ? mod.getThumbnail : null;
    } catch (err) { renderer = null; }
    return renderer;
  }

  function drawPlaceholder(canvas, subject) {
    const item = asItem(subject);
    const css = canvas.width;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, css, css);
    if (isFinishType(item.type)) { drawFinishSwatch(g, css, item.params, item.type); return; }
    const w = Math.max(1, item.w || 1), d = Math.max(1, item.d || 1), ht = Math.max(1, item.h || 1);
    const flatOnWall = d < w * 0.2 && ht > d * 3;   // art, mirrors, TVs: an elevation reads better than a sliver
    g.save();
    g.translate(css / 2, css / 2);
    if (flatOnWall) {
      const s = (css * 0.62) / Math.max(w, ht);
      g.fillStyle = (item.params && item.params.color) || '#cfd3cf';
      g.strokeStyle = 'rgba(38,40,46,0.7)';
      g.lineWidth = Math.max(1, css / 120);
      g.beginPath(); g.rect((-w * s) / 2, (-ht * s) / 2, w * s, ht * s); g.fill(); g.stroke();
    } else {
      const s = (css * 0.7) / Math.max(w, d);
      g.scale(s, s);
      try {
        if (ctx.models && typeof ctx.models.drawSymbol === 'function') ctx.models.drawSymbol(g, item, 1 / s);
        else { g.fillStyle = '#d9d4c8'; g.strokeStyle = 'rgba(38,40,46,0.7)'; g.lineWidth = 1 / s; g.beginPath(); g.rect(-w / 2, -d / 2, w, d); g.fill(); g.stroke(); }
      } catch (err) { /* a broken symbol must never break the catalogue */ }
    }
    g.restore();
  }

  function show(el, url) {
    if (!el.isConnected && !el.dataset.keep) return;
    let img = el.querySelector('img');
    if (!img) { img = h('img', { class: 'thumb__img', alt: '', draggable: 'false', decoding: 'async' }); el.append(img); }
    img.onload = () => el.classList.add('is-loaded');
    img.src = url;
  }

  function pump() {
    while (running < MAX_PARALLEL && waiting.length) {
      const job = waiting.pop();                    // newest first: what the user is looking at now
      byKey.delete(job.key);
      job.els = new Set([...job.els].filter((el) => el.isConnected));
      if (!job.els.size) continue;
      running++;
      loadRenderer()
        .then((fn) => (fn ? fn(job.subject, job.size) : null))
        .then((url) => { if (typeof url === 'string' && url) { urls.set(job.key, url); job.els.forEach((el) => show(el, url)); } })
        .catch(() => { /* keep the placeholder */ })
        .finally(() => { running--; setTimeout(pump, BREATHE_MS); });
    }
  }

  function request(el, subject, size) {
    const item = asItem(subject);
    if (isFinishType(item.type) || renderer === null) return;
    const key = keyOf(subject);
    if (urls.has(key)) { show(el, urls.get(key)); return; }
    let job = byKey.get(key);
    if (!job) { job = { key, subject, size, els: new Set() }; byKey.set(key, job); waiting.push(job); }
    job.els.add(el);
    pump();
  }

  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        const pending = entry.target._thumb;
        if (pending) request(entry.target, pending.subject, pending.size);
      }
    }, { rootMargin: '120px' })
    : null;

  return {
    /** Create a thumbnail element for a product or placed item. */
    el(subject, opts = {}) {
      const size = opts.size || 176;
      const px = Math.round(Math.min(size, 256) * Math.min(2, window.devicePixelRatio || 1));
      const canvas = h('canvas', { class: 'thumb__ph', width: px, height: px, 'aria-hidden': 'true' });
      const el = h('div', { class: `thumb${isFinishType(asItem(subject).type) ? ' thumb--finish' : ''}` }, canvas);
      drawPlaceholder(canvas, subject);
      const key = keyOf(subject);
      if (urls.has(key)) { el.dataset.keep = '1'; show(el, urls.get(key)); delete el.dataset.keep; }
      else if (io && opts.lazy !== false) { el._thumb = { subject, size }; io.observe(el); }
      else requestAnimationFrame(() => request(el, subject, size));
      return el;
    },
    /** Stop tracking an element that was removed before it became visible. */
    forget(el) { if (io && el) io.unobserve(el); },
  };
}
