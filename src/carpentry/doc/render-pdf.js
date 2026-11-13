/**
 * docToPDF(doc, { fonts }) → Promise<Uint8Array> — a real vector PDF of a composed document (pdf-lib + fontkit,
 * vendored in vendor/pdf/). Heebo is embedded and subsetted; text is selectable (ToUnicode); drawings are vectors.
 *
 * Text is drawn exactly in the visual order the composer computed (bidi already applied). fontkit would reverse any
 * string whose first strong script is Hebrew, so the embedded font's layout is forced to Latin / LTR (Hebrew needs
 * no shaping without nikud): glyphs come out in the given order.
 */
import { PDFDocument, rgb, degrees, LineCapStyle } from '../../../vendor/pdf/pdf-lib.esm.min.js';
import fontkit from '../../../vendor/pdf/fontkit.esm.js';
import { PALETTE, DASH, arcPoints } from './prims.js';
import { PT } from './metrics.js';

const MM = 72 / 25.4;
export const FONT_FILES = { light: 'Heebo_300Light.ttf', regular: 'Heebo_400Regular.ttf', medium: 'Heebo_500Medium.ttf', bold: 'Heebo_700Bold.ttf' };

/** Load the TTF bytes: Node (fs) or browser (fetch next to this module). */
export async function loadFonts(base) {
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node && typeof window === 'undefined';
  const root = base || new URL('../../../vendor/fonts/', import.meta.url);
  const out = {};
  if (isNode) {
    const { readFile } = await import('node:fs/promises');
    for (const [k, f] of Object.entries(FONT_FILES)) out[k] = new Uint8Array(await readFile(new URL(f, root)));
  } else {
    await Promise.all(Object.entries(FONT_FILES).map(async ([k, f]) => {
      const r = await fetch(new URL(f, root));
      if (!r.ok) throw new Error(`font ${f}: HTTP ${r.status}`);
      out[k] = new Uint8Array(await r.arrayBuffer());
    }));
  }
  return out;
}
let fontCache = null;

const hex = (c) => {
  const h = (PALETTE[c] || c || '#000000').replace('#', '');
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
};
const dashOf = (d) => (d && DASH[d] ? DASH[d].map((v) => v * MM) : undefined);

function dataUrlBytes(url) {
  const m = /^data:(image\/(png|jpe?g));base64,(.*)$/i.exec(String(url || ''));
  if (!m) return null;
  const bin = typeof atob === 'function' ? atob(m[3]) : Buffer.from(m[3], 'base64').toString('binary');
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return { bytes: b, png: /png/i.test(m[2]) };
}

/**
 * @param {{ pages: object[], meta?: object, lang?: string }} doc
 * @param {{ fonts?: Record<string, Uint8Array>, fontBase?: string|URL }} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function docToPDF(doc, opts = {}) {
  const fontBytes = opts.fonts || fontCache || (fontCache = await loadFonts(opts.fontBase));
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const meta = doc.meta || {};
  pdf.setTitle(meta.title || 'Request for quotation');
  pdf.setSubject(meta.reference || '');
  pdf.setCreator('House 98 carpentry studio');
  pdf.setProducer('pdf-lib');
  pdf.setLanguage(doc.lang === 'he' ? 'he-IL' : 'en-GB');
  const fonts = {};
  for (const [k, b] of Object.entries(fontBytes)) {
    const f = await pdf.embedFont(b, { subset: true });
    const fk = f.embedder && f.embedder.font;
    if (fk && typeof fk.layout === 'function') { const orig = fk.layout; fk.layout = function (s, feat) { return orig.call(this, s, feat, 'latn', undefined, 'ltr'); }; }
    fonts[k] = f;
  }
  const images = new Map();
  for (const p of doc.pages) {
    const [wMm, hMm] = p.size, H = hMm * MM;
    const page = pdf.addPage([wMm * MM, H]);
    const X = (x) => x * MM, Y = (y) => H - y * MM;
    const pathOf = (pts, close) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * MM).toFixed(2)} ${(y * MM).toFixed(2)}`).join(' ') + (close ? ' Z' : '');
    const draw = async (ops) => {
      for (const o of ops) {
        if (o.t === 'line') {
          if (!o.lw || !o.color) continue;
          page.drawLine({ start: { x: X(o.x1), y: Y(o.y1) }, end: { x: X(o.x2), y: Y(o.y2) }, thickness: o.lw * MM, color: hex(o.color), dashArray: dashOf(o.dash), lineCap: LineCapStyle.Butt });
        } else if (o.t === 'rect') {
          const st = o.color && o.lw;
          if (!o.fill && !st) continue;
          page.drawRectangle({ x: X(o.x), y: Y(o.y + o.h), width: o.w * MM, height: o.h * MM, color: o.fill ? hex(o.fill) : undefined,
            borderColor: st ? hex(o.color) : undefined, borderWidth: st ? o.lw * MM : 0, borderDashArray: st ? dashOf(o.dash) : undefined });
        } else if (o.t === 'poly' || o.t === 'arc') {
          const pts = o.t === 'arc' ? arcPoints(o.cx, o.cy, o.r, o.a0, o.a1) : o.pts;
          if (pts.length < 2) continue;
          const close = o.t === 'poly' && o.close, st = o.color && o.lw;
          page.drawSvgPath(pathOf(pts, close), { x: 0, y: H, color: close && o.fill ? hex(o.fill) : undefined,
            borderColor: st ? hex(o.color) : undefined, borderWidth: st ? o.lw * MM : 0, borderDashArray: st ? dashOf(o.dash) : undefined });
        } else if (o.t === 'text') {
          if (!o.vis) continue;
          const font = fonts[o.font] || fonts.regular, a = ((o.rot || 0) * Math.PI) / 180;
          const shift = o.align === 'right' ? o.w : o.align === 'center' ? o.w / 2 : 0;
          const x0 = o.x - Math.cos(a) * shift, y0 = o.y + Math.sin(a) * shift;      // page y down; reading vector (cos, -sin)
          page.drawText(o.vis, { x: X(x0), y: Y(y0), size: o.size, font, color: hex(o.color || 'ink'), ...(o.rot ? { rotate: degrees(o.rot) } : {}) });
        } else if (o.t === 'image') {
          let img = images.get(o.src);
          if (!img) {
            const d = dataUrlBytes(o.src);
            if (!d) continue;
            try { img = d.png ? await pdf.embedPng(d.bytes) : await pdf.embedJpg(d.bytes); } catch { continue; }
            images.set(o.src, img);
          }
          page.drawImage(img, { x: X(o.x), y: Y(o.y + o.h), width: o.w * MM, height: o.h * MM });
        } else if (o.t === 'drawing') await draw(o.ops);
      }
    };
    await draw(p.ops);
  }
  return pdf.save({ useObjectStreams: true });
}

export { PT };
