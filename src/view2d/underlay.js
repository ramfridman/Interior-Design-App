/**
 * Tracing underlay: the imported sketch (store.underlay — on an upper floor store.underlays[level], see docs/CONTRACT.md
 * § 12) drawn under the walls of the floor shown, placed by
 * its image px → plan cm transform. Never drawn in exports (env.exporting), 3D or thumbnails.
 * The data URL is decoded once into an <img> (cached by string identity); `onReady` repaints when it has loaded.
 */
// decoded pictures by data URL (one per floor of a project imported with several floors; the oldest is dropped)
const cache = new Map();

function imageFor(src, onReady) {
  const hit = cache.get(src);
  if (hit) return hit.ready ? hit.img : null;
  const img = new Image();
  const mine = { img, ready: false };
  cache.set(src, mine);
  while (cache.size > 4) cache.delete(cache.keys().next().value);
  img.onload = () => { mine.ready = true; if (cache.get(src) === mine) onReady && onReady(); };
  img.onerror = () => { mine.ready = false; };
  img.src = src;
  return null;
}

/** The underlay of the floor shown: store.underlay on the ground floor, store.underlays[level] above (stage F8). */
export function shownUnderlay(env) {
  const st = env.store;
  if (!st) return null;
  const lv = env.level;
  if (!lv || lv === 'L0') return st.underlay || null;
  return (st.underlays && st.underlays[lv]) || null;
}

/** True when the underlay would be painted (and the plan should leave room for it under the floors). */
export const underlayShown = (env) => { const u = shownUnderlay(env); return !!(u && u.visible !== false && !env.exporting); };

/**
 * Paint the underlay (device space in, device space out). Light themes multiply it into the paper so white page
 * areas vanish and only the drawing's ink remains; dark themes draw it plainly at a lower strength.
 */
export function drawUnderlay(G, env) {
  if (!underlayShown(env)) return;
  const u = shownUnderlay(env);
  const img = imageFor(u.image, env.onUnderlayReady);
  if (!img || !Array.isArray(u.transform)) return;
  const [a, b, c, d, e, f] = u.transform;
  const { ctx, k, ox, oy } = G;
  const dark = isDark(env.pal && env.pal.paper);
  ctx.save();
  ctx.setTransform(a * k, b * k, c * k, d * k, e * k + ox, f * k + oy);
  ctx.globalAlpha = Math.max(0.05, Math.min(1, u.opacity == null ? 0.5 : u.opacity)) * (dark ? 0.6 : 1);
  ctx.globalCompositeOperation = dark ? 'screen' : 'multiply';
  if (dark) ctx.filter = 'invert(1)';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, u.width || img.naturalWidth, u.height || img.naturalHeight);
  ctx.restore();
}

function isDark(color) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(String(color || ''));
  if (!m) return false;
  return (parseInt(m[1], 16) * 0.299 + parseInt(m[2], 16) * 0.587 + parseInt(m[3], 16) * 0.114) < 110;
}
