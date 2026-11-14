/**
 * Tracing underlay: the imported sketch (store.underlay, see docs/CONTRACT.md § 12) drawn under the walls, placed by
 * its image px → plan cm transform. Never drawn in exports (env.exporting), 3D or thumbnails.
 * The data URL is decoded once into an <img> (cached by string identity); `onReady` repaints when it has loaded.
 */
let cached = { src: null, img: null, ready: false };

function imageFor(src, onReady) {
  if (cached.src === src) return cached.ready ? cached.img : null;
  const img = new Image();
  cached = { src, img, ready: false };
  const mine = cached;
  img.onload = () => { mine.ready = true; if (cached === mine) onReady && onReady(); };
  img.onerror = () => { mine.ready = false; };
  img.src = src;
  return null;
}

/** True when the underlay would be painted (and the plan should leave room for it under the floors). */
export const underlayShown = (env) => !!(env.store && env.store.underlay && env.store.underlay.visible !== false && !env.exporting);

/**
 * Paint the underlay (device space in, device space out). Light themes multiply it into the paper so white page
 * areas vanish and only the drawing's ink remains; dark themes draw it plainly at a lower strength.
 */
export function drawUnderlay(G, env) {
  if (!underlayShown(env)) return;
  const u = env.store.underlay;
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
