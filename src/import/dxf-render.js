/**
 * renderPrims — draw vector primitives (readDxf output; also works for readPdf output) onto a canvas: line work in
 * its layer / entity colours on white, hatches and solids filled, texts (right-to-left strings shaped by the canvas).
 * Browser / worker only (needs a canvas). This is the DXF counterpart of renderPdfPage: the drawing viewer and the
 * tracing underlay use it.
 *
 *   renderPrims(prims, { pxPerUnit = 2, canvas?, crop?: { x, y, w, h } (page units), hide?: Set<layer>,
 *                        highlight?: Set<layer> | null, maxPx = 8000 }) → { canvas, pxPerUnit, width, height, x0, y0 }
 * With `crop` the canvas covers only that part of the page: page point (u, v) is at ((u − x0) · ppu, (v − y0) · ppu).
 */
const lum = (c) => { const n = parseInt(c.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
/** Colours too light to see on white (yellow, cyan, light grey) are darkened. */
export function inkColour(c) {
  if (!c || c[0] !== '#' || c.length !== 7) return '#000000';
  const L = lum(c);
  if (L < 0.7) return c;
  const k = 0.7 / L * 0.75;
  const n = parseInt(c.slice(1), 16);
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('');
}

export function renderPrims(prims, { pxPerUnit = 2, canvas = null, crop = null, hide = null, highlight = null, maxPx = 8000 } = {}) {
  const box = crop || { x: 0, y: 0, w: prims.pageBox.w, h: prims.pageBox.h };
  let ppu = Math.min(pxPerUnit, maxPx / Math.max(box.w, box.h, 1));
  const w = Math.max(1, Math.ceil(box.w * ppu)), h = Math.max(1, Math.ceil(box.h * ppu));
  if (!canvas) canvas = typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  ctx.setTransform(ppu, 0, 0, ppu, -box.x * ppu, -box.y * ppu);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const dim = highlight && highlight.size ? (layer) => !highlight.has(layer) : () => false;
  const hidden = (layer) => !!(hide && hide.has(layer));
  // fills first (hatches under the line work)
  for (const p of prims.paths) {
    if (!p.fill || p.stroke || hidden(p.layer)) continue;
    ctx.globalAlpha = dim(p.layer) ? 0.12 : p.solid ? 0.85 : 0.45;
    ctx.fillStyle = inkColour(p.fillColor);
    ctx.beginPath();
    for (let i = 0; i < p.pts.length; i += 2) (i ? ctx.lineTo(p.pts[i], p.pts[i + 1]) : ctx.moveTo(p.pts[i], p.pts[i + 1]));
    ctx.closePath(); ctx.fill('evenodd');
  }
  const minLw = 0.7 / ppu;
  // batch strokes by style
  const groups = new Map();
  for (const p of prims.paths) {
    if (!p.stroke || hidden(p.layer)) continue;
    const d = dim(p.layer);
    const key = `${inkColour(p.color)}|${Math.max(minLw, (p.lw || 0) * 0.6).toFixed(3)}|${p.dash && p.dash.length ? 1 : 0}|${d ? 1 : 0}`;
    let g = groups.get(key); if (!g) groups.set(key, g = []);
    g.push(p);
  }
  for (const [key, list] of groups) {
    const [col, lw, dash, d] = key.split('|');
    ctx.globalAlpha = d === '1' ? 0.18 : 1;
    ctx.strokeStyle = col; ctx.lineWidth = +lw;
    ctx.setLineDash(dash === '1' ? [4 / ppu * 1.5, 3 / ppu * 1.5] : []);
    ctx.beginPath();
    for (const p of list) {
      for (let i = 0; i < p.pts.length; i += 2) (i ? ctx.lineTo(p.pts[i], p.pts[i + 1]) : ctx.moveTo(p.pts[i], p.pts[i + 1]));
      if (p.closed) ctx.closePath();
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // texts
  for (const t of prims.texts || []) {
    if (hidden(t.layer) || !(t.h > 0) || t.h * ppu < 2.5) continue;
    ctx.globalAlpha = dim(t.layer) ? 0.18 : 1;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate((t.angle || 0) * Math.PI / 180);
    ctx.font = `${t.h * 1.25}px Arial, "Noto Sans Hebrew", sans-serif`;
    ctx.fillStyle = inkColour(t.color || '#000000');
    ctx.textBaseline = 'alphabetic';
    if (t.dir === 'rtl') { ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.fillText(t.str, t.w, 0); }
    else { ctx.direction = 'ltr'; ctx.textAlign = 'left'; ctx.fillText(t.str, 0, 0); }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas, pxPerUnit: ppu, width: w, height: h, x0: box.x, y0: box.y };
}
