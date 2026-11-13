/**
 * readPdf — vector primitives of one PDF page, in PAGE UNITS: PDF points (1/72 in), origin at the top-left corner
 * of the page as displayed (crop box, /Rotate applied), +x right, +y DOWN. That is exactly the pixel space of the page
 * rendered at scale 1, so `transform` in the normalised result can lay the rendered page under the plan.
 *
 * The output is plain data (JSON / structured-clone friendly) so the detectors can run in a worker.
 *
 *   paths[i] = { pts: [x0, y0, x1, y1, ...] (flattened; curves subdivided), closed, stroke, fill, evenOdd,
 *                lw (stroke width in page units, 0 = hairline), color '#rrggbb' (stroke), fillColor, dash [] | [on, off…]
 *                (page units), curved (path contained Bézier segments), sub (index of the subpath inside its PDF path),
 *                group (index of the PDF path operation it came from) }
 *   texts[i] = { str, x, y (baseline start, page units), w, h (font height), angle (deg, 0 = left-to-right), dir }
 *   images   = [{ x, y, w, h }] bounding boxes of raster images (a scanned sheet shows up as one large image)
 */
import { openPdf } from './pdfjs-loader.js';

const mul = (m, n) => [ // m then n  (PDF convention: [a b c d e f], point' = point·M)
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const mscale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

const FLAT_STEPS = 12; // Bézier flattening (fixed, deterministic)

function bez(out, m, x0, y0, x1, y1, x2, y2, x3, y3) {
  for (let i = 1; i <= FLAT_STEPS; i++) {
    const t = i / FLAT_STEPS, u = 1 - t;
    const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
    const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
    const p = apply(m, x, y); out.push(p[0], p[1]);
  }
}

/**
 * @param {ArrayBuffer|Uint8Array} bytes
 * @param {{ page?: number }} [opts]  page is 1-based (default 1)
 */
export async function readPdf(bytes, { page = 1 } = {}) {
  const { pdfjs, doc } = await openPdf(bytes);
  try {
    const pageCount = doc.numPages;
    const pg = await doc.getPage(Math.min(Math.max(1, page), pageCount));
    const vp = pg.getViewport({ scale: 1 });
    const base = vp.transform; // PDF user space -> page units (y down)
    const ol = await pg.getOperatorList();
    const O = pdfjs.OPS;
    const paths = [], images = [];
    let st = { m: base, lw: 1, color: '#000000', fillColor: '#000000', dash: [] };
    const stack = [];
    let group = 0;
    const fills = { [O.fill]: [0, 1, 0], [O.eoFill]: [0, 1, 1], [O.stroke]: [1, 0, 0], [O.closeStroke]: [1, 0, 0],
      [O.fillStroke]: [1, 1, 0], [O.eoFillStroke]: [1, 1, 1], [O.closeFillStroke]: [1, 1, 0], [O.closeEOFillStroke]: [1, 1, 1] };
    const closing = new Set([O.closeStroke, O.closeFillStroke, O.closeEOFillStroke]);

    const emit = (drawOp, data) => {
      const f = fills[drawOp];
      if (!f) return; // endPath (clip only) or unknown
      const [stroke, fill, evenOdd] = f;
      const s = mscale(st.m);
      const lw = st.lw * s;
      const dash = st.dash.map((d) => d * s);
      let cur = null, sub = 0, cx = 0, cy = 0, sx = 0, sy = 0;
      const flush = (closed) => {
        if (cur && cur.pts.length >= 4) {
          cur.closed = closed || cur.closed || closing.has(drawOp);
          paths.push(cur);
        }
        cur = null;
      };
      const start = (x, y) => {
        flush(false);
        const p = apply(st.m, x, y);
        cur = { pts: [p[0], p[1]], closed: false, stroke: !!stroke, fill: !!fill, evenOdd: !!evenOdd, lw, color: st.color,
          fillColor: st.fillColor, dash, curved: false, sub: sub++, group };
        cx = sx = x; cy = sy = y;
      };
      for (const arr of data) {
        if (!arr) continue;
        for (let i = 0; i < arr.length;) {
          const op = arr[i++];
          if (op === 0) { start(arr[i], arr[i + 1]); i += 2; }
          else if (op === 1) { if (!cur) start(cx, cy); const p = apply(st.m, arr[i], arr[i + 1]); cur.pts.push(p[0], p[1]); cx = arr[i]; cy = arr[i + 1]; i += 2; }
          else if (op === 2) { if (!cur) start(cx, cy); bez(cur.pts, st.m, cx, cy, arr[i], arr[i + 1], arr[i + 2], arr[i + 3], arr[i + 4], arr[i + 5]); cur.curved = true; cx = arr[i + 4]; cy = arr[i + 5]; i += 6; }
          else if (op === 3) { // quadratic -> cubic
            if (!cur) start(cx, cy);
            const qx = arr[i], qy = arr[i + 1], x = arr[i + 2], y = arr[i + 3];
            bez(cur.pts, st.m, cx, cy, cx + 2 / 3 * (qx - cx), cy + 2 / 3 * (qy - cy), x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y);
            cur.curved = true; cx = x; cy = y; i += 4;
          } else if (op === 4) { // closePath
            if (cur) { const p = apply(st.m, sx, sy); const n = cur.pts.length; if (Math.abs(cur.pts[n - 2] - p[0]) > 1e-6 || Math.abs(cur.pts[n - 1] - p[1]) > 1e-6) cur.pts.push(p[0], p[1]); cur.closed = true; }
            const keep = cur; flush(true); cx = sx; cy = sy; void keep;
          } else break; // unknown opcode: stop reading this path
        }
      }
      flush(false);
      group++;
    };

    for (let k = 0; k < ol.fnArray.length; k++) {
      const fn = ol.fnArray[k], a = ol.argsArray[k];
      switch (fn) {
        case O.save: stack.push({ ...st }); break;
        case O.restore: if (stack.length) st = stack.pop(); break;
        case O.transform: st.m = mul(a, st.m); break;
        case O.paintFormXObjectBegin: stack.push({ ...st }); if (a?.[0]) st.m = mul(a[0], st.m); break;
        case O.paintFormXObjectEnd: if (stack.length) st = stack.pop(); break;
        case O.setLineWidth: st.lw = a[0]; break;
        case O.setDash: st.dash = Array.isArray(a[0]) ? a[0].slice() : []; break;
        case O.setStrokeRGBColor: st.color = typeof a[0] === 'string' ? a[0] : rgbHex(a); break;
        case O.setFillRGBColor: st.fillColor = typeof a[0] === 'string' ? a[0] : rgbHex(a); break;
        case O.setGState:
          for (const [key, v] of a[0] || []) {
            if (key === 'LW') st.lw = v;
            else if (key === 'D' && Array.isArray(v)) st.dash = Array.isArray(v[0]) ? v[0].slice() : [];
          }
          break;
        case O.constructPath: emit(a[0], a[1] || []); break;
        case O.paintImageXObject: case O.paintInlineImageXObject: case O.paintImageMaskXObject: {
          const c = [apply(st.m, 0, 0), apply(st.m, 1, 0), apply(st.m, 0, 1), apply(st.m, 1, 1)];
          const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
          const x = Math.min(...xs), y = Math.min(...ys);
          images.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
          break;
        }
        default: break;
      }
    }

    const tc = await pg.getTextContent();
    const texts = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const t = mul(it.transform, base);
      const angle = Math.atan2(t[1], t[0]) * 180 / Math.PI;
      texts.push({ str: it.str, x: t[4], y: t[5], w: it.width * mscale(base), h: Math.hypot(t[2], t[3]), angle, dir: it.dir || 'ltr' });
    }
    return {
      pageCount, page: pg.pageNumber, pageBox: { w: vp.width, h: vp.height }, rotate: pg.rotate, units: 'pt',
      paths, texts, images,
    };
  } finally {
    doc.destroy();
  }
}

function rgbHex(a) {
  const h = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return '#' + h(a[0]) + h(a[1]) + h(a[2]);
}

/**
 * Browser only: render a page for use as a tracing underlay. Returns { canvas, bitmap?, pxPerUnit } where
 * pxPerUnit = canvas pixels per page unit (pt). Pass an existing canvas or let one be created
 * (OffscreenCanvas in a worker, <canvas> otherwise).
 */
export async function renderPdfPage(bytes, { page = 1, pxPerUnit = 2, canvas = null, bitmap = false } = {}) {
  const { doc } = await openPdf(bytes);
  try {
    const pg = await doc.getPage(page);
    const viewport = pg.getViewport({ scale: pxPerUnit });
    const w = Math.ceil(viewport.width), h = Math.ceil(viewport.height);
    if (!canvas) canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    await pg.render({ canvasContext: ctx, canvas, viewport }).promise;
    const out = { canvas, pxPerUnit, width: w, height: h };
    if (bitmap && typeof createImageBitmap === 'function') out.bitmap = await createImageBitmap(canvas);
    return out;
  } finally {
    doc.destroy();
  }
}
