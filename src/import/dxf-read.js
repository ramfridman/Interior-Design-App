/**
 * readDxf — an AutoCAD DXF drawing (ASCII, R12 … 2018) as the same vector primitives readPdf returns, plus what a
 * DXF knows that a PDF does not: true units, layers, blocks, dimensions. Pure JS, no dependency; runs in a browser,
 * a worker or Node.
 *
 * PAGE UNITS. The engine's detectors were tuned on PDF points, so the drawing is laid out as if printed at 1 : 50 on
 * paper: one page unit = 50 × 2.54 / 72 cm of the real building (≈ 1.76 cm), origin at the top-left of the model-space
 * extents (plus a small margin), +x right, +y DOWN (the DXF's +y is flipped). `prims.dxf.cmPerPageUnit` is that factor
 * when the file's units are known (or the best guess when they are not: see `dxf.unitGuess`), and
 * `prims.dxf.toPage = [a, b, c, d, e, f]` maps drawing units → page units.
 *
 *   paths[i] = { pts, closed, stroke, fill, evenOdd, lw (page units), color, fillColor, dash, curved, layer, kind }
 *              (kind: 'line' | 'arc' | 'poly' | 'hatch' | 'solid' | 'text' …: the DXF entity the path came from)
 *   texts[i] = { str, x, y, w, h, angle, dir, layer }
 *   dims[i]  = { x1, y1, x2, y2 (page), du (measured length in drawing units), value (number shown) | null, text, layer }
 *   inserts  = top-level block references [{ block, layer, x, y (page), rotation, sx, sy, cols, rows, bbox (page) }]
 *   blocks   = [{ name, count (top-level inserts), w, h (drawing units), arcs, lines, kind 'door' | 'window' | null }]
 *   layers   = [{ name, colour, visible, frozen, off, count, lines, arcs, fills, texts, inserts, dims, length (cm-ish) }]
 *   units    = { code ($INSUNITS), name, cmPerUnit | null, measurement ($MEASUREMENT 0 imperial / 1 metric | null) }
 *   extents  = { header: { min, max } | null, model: { minX, minY, maxX, maxY } } (drawing units)
 *   layouts  = paper-space layout names (listed only: model space is read)
 *   skipped  = { ENTITY: count } entity types not drawn (3D solids, images, proxies …), warnings = [{ code, text }]
 *
 * Errors are plain-language Errors with `plain: true` and a `code` ('dxf-binary', 'dxf-truncated', 'dxf-damaged',
 * 'dxf-not-dxf', 'dxf-empty', 'dxf-too-big').
 *
 * Memory: the bytes are scanned in place (no whole-text decode, no array of lines); an entity's group codes are
 * interpreted as soon as it ends, so the working set is the output plus the block definitions.
 */

const PT_CM = 2.54 / 72;
export const DXF_PAGE_RATIO = 50;                          // the nominal print scale of the page units (1 : 50)
const PAGE_CM = DXF_PAGE_RATIO * PT_CM;                    // cm of building per page unit
const MAX_SEGMENTS = 4e6;                                  // hard cap on expanded geometry (a runaway array insert)
const MAX_DEPTH = 16;

/** $INSUNITS → cm per drawing unit. */
export const INSUNITS = {
  1: ['inches', 2.54], 2: ['feet', 30.48], 3: ['miles', 160934.4], 4: ['millimetres', 0.1], 5: ['centimetres', 1], 6: ['metres', 100],
  7: ['kilometres', 1e5], 8: ['microinches', 2.54e-6], 9: ['mils', 2.54e-3], 10: ['yards', 91.44], 11: ['ångströms', 1e-8],
  12: ['nanometres', 1e-7], 13: ['micrometres', 1e-4], 14: ['decimetres', 10], 15: ['decametres', 1000], 16: ['hectometres', 1e4],
  21: ['US survey feet', 30.48006096],
};

const plainError = (code, text) => Object.assign(new Error(text), { plain: true, code });

// ───────────────────────── colours ─────────────────────────
const ACI_BASE = ['#000000', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#000000', '#808080', '#c0c0c0'];
/** AutoCAD Color Index → '#rrggbb' (7 "white / black" is drawn black on the white sheet). */
export function aciColor(i) {
  i = Math.abs(i | 0);
  if (i < 10) return ACI_BASE[i] || '#000000';
  if (i >= 250) { const v = Math.round(51 + (i - 250) * (204 / 5)); return hex(v, v, v); }
  const hue = Math.floor((i - 10) / 10) * 15, sub = (i - 10) % 10;
  const val = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][sub], sat = sub % 2 ? 0.5 : 1;
  const c = val * sat, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = val - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return hex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const trueColor = (v) => hex((v >> 16) & 255, (v >> 8) & 255, v & 255);

// ───────────────────────── text decoding ─────────────────────────
const CP862 = (b) => (b >= 0x80 && b <= 0x9a ? String.fromCharCode(0x5d0 + b - 0x80) : String.fromCharCode(b));
function makeDecoder(label) {
  if (label === 'cp862') return { decode: (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += CP862(u8[i]); return s; } };
  try { return new TextDecoder(label); } catch (e) { return new TextDecoder('windows-1252'); }
}
/** $DWGCODEPAGE → TextDecoder label. */
function codepageLabel(cp) {
  const c = String(cp || '').toUpperCase().replace(/\s+/g, '');
  if (c === 'DOS862') return 'cp862';
  const m = c.match(/^ANSI_(\d{3,4})$/);
  if (m) return m[1] === '932' ? 'shift_jis' : m[1] === '936' ? 'gbk' : m[1] === '949' ? 'euc-kr' : m[1] === '950' ? 'big5' : m[1] === '874' ? 'windows-874' : 'windows-' + m[1];
  if (/^ISO8859-?(\d+)$/.test(c)) return 'iso-8859-' + c.match(/(\d+)$/)[1];
  if (c === 'UTF8' || c === 'UTF-8') return 'utf-8';
  return null;
}
/** \U+05D0 and \M+n8x8x (multibyte) escapes found in R12 – 2004 strings. */
const unescapeU = (s) => (s.indexOf('\\') < 0 ? s : s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
const SPECIAL = (s) => (s.indexOf('%%') < 0 ? s : s.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoOkK]/g, '').replace(/%%%/g, '%').replace(/%%(\d{3})/g, (_, n) => String.fromCharCode(+n)));

/** Plain text of an MTEXT string: formatting codes stripped, paragraphs split. → [line…] */
export function mtextPlain(raw) {
  let s = unescapeU(String(raw || ''));
  s = s.replace(/\\[Pp]/g, '\n').replace(/\\~/g, ' ').replace(/\\\\/g, '\u0000BS').replace(/\\\{/g, '\u0000LB').replace(/\\\}/g, '\u0000RB');
  s = s.replace(/\\S([^;]*?)[#^/]([^;]*?);/g, '$1/$2');                       // stacked fractions
  s = s.replace(/\\[fFHhWwQqTtAaCcpX][^;\\]*;/g, '');                         // font, height, width, oblique, tracking, align, colour, paragraph
  s = s.replace(/\\[LlOoKkNn]/g, '');                                           // under / over / strike toggles, column break
  s = s.replace(/[{}]/g, '').replace(/\u0000BS/g, '\\').replace(/\u0000LB/g, '{').replace(/\u0000RB/g, '}');
  return SPECIAL(s).split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
}
const RTL = /[֐-׿؀-ۿ]/;

/** No code page stated: UTF-8 when the bytes are valid UTF-8, else Hebrew (Windows-1255) when high bytes sit in its
 *  letter range, else Western (Windows-1252). Only the first 2 MB are checked. */
function guessDecoder(u8) {
  const head = u8.subarray(0, 2 * 1048576);
  try { new TextDecoder('utf-8', { fatal: true }).decode(head); return new TextDecoder('utf-8'); } catch (e) { /* not UTF-8 */ }
  let heb = 0, hi = 0;
  for (let i = 0; i < head.length; i++) { const b = head[i]; if (b >= 0x80) { hi++; if (b >= 0xe0 && b <= 0xfa) heb++; } }
  return makeDecoder(heb > 0.6 * hi ? 'windows-1255' : 'windows-1252');
}

// ───────────────────────── tokenizer ─────────────────────────
/** Pull tokenizer over the raw bytes: next() → group code (or -1 at the end), then `.v` is the value string. */
function tokenizer(u8) {
  let pos = 0, line = 0;
  let dec = guessDecoder(u8), utf8 = true;
  const T = {
    v: '', line: 0,
    setEncoding(label) { if (label) { dec = makeDecoder(label); utf8 = label === 'utf-8'; } },
    get utf8() { return utf8; },
    pos: () => pos,
    readLine() {
      if (pos >= u8.length) return null;
      let e = u8.indexOf(10, pos);
      if (e < 0) e = u8.length;
      let s = pos, t = e;
      pos = e + 1; line++;
      if (t > s && u8[t - 1] === 13) t--;
      // ASCII fast path
      let ascii = true;
      for (let i = s; i < t; i++) if (u8[i] > 127) { ascii = false; break; }
      if (ascii) return t - s < 4096 ? String.fromCharCode.apply(null, u8.subarray(s, t)) : dec.decode(u8.subarray(s, t));
      return dec.decode(u8.subarray(s, t));
    },
    next() {
      const c = T.readLine();
      if (c === null) return -1;
      const ct = c.trim();
      if (ct === '' && pos >= u8.length) return -1;
      const code = +ct;
      if (!/^-?\d+$/.test(ct)) throw plainError('dxf-damaged', `This DXF file is damaged: line ${line} should hold a group code but reads “${ct.slice(0, 30)}”. Save it again from the drawing program.`);
      const v = T.readLine();
      if (v === null) { T.v = ''; T.truncated = true; return -1; }
      T.v = v; T.line = line;
      return code;
    },
  };
  return T;
}

// ───────────────────────── geometry helpers ─────────────────────────
const I = [1, 0, 0, 1, 0, 0];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const then = (m, n) => [ // first m, then n
  n[0] * m[0] + n[2] * m[1], n[1] * m[0] + n[3] * m[1], n[0] * m[2] + n[2] * m[3], n[1] * m[2] + n[3] * m[3],
  n[0] * m[4] + n[2] * m[5] + n[4], n[1] * m[4] + n[3] * m[5] + n[5]];
const det = (m) => m[0] * m[3] - m[1] * m[2];
const DEG = Math.PI / 180;

/** Points of an arc (radians, ccw from a0 by sweep), ~5° steps. */
function arcPts(cx, cy, r, a0, sweep, out = []) {
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / (5 * DEG)));
  for (let i = 0; i <= n; i++) { const a = a0 + sweep * i / n; out.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  return out;
}
/** Bulged polyline segment p → q (bulge = tan(sweep / 4)); appends points after p. */
function bulgePts(x1, y1, x2, y2, b, out) {
  const sweep = 4 * Math.atan(b), d = Math.hypot(x2 - x1, y2 - y1);
  if (d < 1e-12) return out;
  const r = d / (2 * Math.sin(Math.abs(sweep) / 2));
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, h = r * Math.cos(Math.abs(sweep) / 2);
  const ux = (x2 - x1) / d, uy = (y2 - y1) / d, s = sweep > 0 ? 1 : -1;
  const cx = mx - s * uy * h, cy = my + s * ux * h;
  const a0 = Math.atan2(y1 - cy, x1 - cx);
  const pts = arcPts(cx, cy, r, a0, sweep);
  for (let i = 2; i < pts.length; i++) out.push(pts[i]);
  out[out.length - 2] = x2; out[out.length - 1] = y2;
  return out;
}
/** B-spline / NURBS (de Boor) flattened. */
function splinePts(deg, knots, ctrl, weights, nSeg) {
  const n = ctrl.length / 2;
  if (n < 2) return ctrl.slice();
  if (!knots || knots.length !== n + deg + 1) { // uniform clamped
    knots = [];
    for (let i = 0; i <= n + deg; i++) knots.push(i <= deg ? 0 : i >= n ? n - deg : i - deg);
  }
  const lo = knots[deg], hi = knots[n];
  const out = [];
  const steps = Math.max(8, Math.min(400, nSeg || n * 8));
  for (let s = 0; s <= steps; s++) {
    const t = Math.min(hi - 1e-12 * (hi - lo || 1), lo + (hi - lo) * s / steps);
    let k = deg; while (k < n - 1 && t >= knots[k + 1]) k++;
    const d = [];
    for (let j = 0; j <= deg; j++) { const i = k - deg + j, w = weights ? weights[i] || 1 : 1; d.push([ctrl[2 * i] * w, ctrl[2 * i + 1] * w, w]); }
    for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
      const i = k - deg + j, den = knots[i + deg - r + 1] - knots[i];
      const a = den ? (t - knots[i]) / den : 0;
      for (let c = 0; c < 3; c++) d[j][c] = (1 - a) * d[j - 1][c] + a * d[j][c];
    }
    out.push(d[deg][0] / d[deg][2], d[deg][1] / d[deg][2]);
  }
  return out;
}

// ───────────────────────── reader ─────────────────────────
/**
 * @param {ArrayBuffer|Uint8Array|string} input
 * @param {{ cmPerUnit?: number, maxBytes?: number }} [opts] cmPerUnit: override the unit (drawing unit in cm)
 */
export function readDxf(input, opts = {}) {
  const u8 = typeof input === 'string' ? new TextEncoder().encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!u8.length) throw plainError('dxf-empty', 'This DXF file is empty.');
  if (opts.maxBytes && u8.length > opts.maxBytes) throw plainError('dxf-too-big', `This DXF file is ${Math.round(u8.length / 1048576)} MB — too large to read in the browser.`);
  const head = String.fromCharCode.apply(null, u8.subarray(0, 22));
  if (head.startsWith('AutoCAD Binary DXF')) throw plainError('dxf-binary', 'This is a binary DXF file, which cannot be read here. In your CAD program use Save As → DXF and choose the ASCII (text) DXF format, then import that file.');
  if (head.startsWith('AC10') || head.startsWith('AC1.')) throw plainError('dxf-not-dxf', 'This is a DWG file renamed to .dxf. Save it as DXF from the CAD program (Save As → DXF) and import that.');
  const T = tokenizer(u8);
  // a UTF-8 BOM
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) u8[0] = u8[1] = u8[2] = 32;

  const header = {};
  const layers = new Map();       // name → { name, aci, rgb, colour, frozen, off, ltype, lw }
  const ltypes = new Map();       // name → dashed?
  const blocks = new Map();       // name → { name, base, items, flags, xref }
  const layouts = [];
  const model = [];               // top-level model-space items
  const skipped = {};
  const warnings = [];
  let paperCount = 0, sawEOF = false, sawSection = false, section = null;
  let curBlock = null;

  // the current entity being collected
  let eType = null;
  const C = [], V = [];
  let poly = null, insertOpen = null, hatchId = 0, instSeq = 0;   // POLYLINE waiting for VERTEX / SEQEND, INSERT waiting for ATTRIB / SEQEND
  let target = model;

  const g = (code, def) => { const i = C.indexOf(code); return i < 0 ? def : V[i]; };
  const num = (code, def = 0) => { const i = C.indexOf(code); if (i < 0) return def; const n = parseFloat(V[i]); return Number.isFinite(n) ? n : def; };
  const str = (code, def = '') => { const i = C.indexOf(code); return i < 0 ? def : V[i]; };
  const fixStr = (s) => SPECIAL(unescapeU(s));

  const props = () => ({
    layer: str(8, '0').trim() || '0',
    aci: C.includes(62) ? num(62, 256) | 0 : 256,
    rgb: C.includes(420) ? num(420) | 0 : null,
    ltype: str(6, 'BYLAYER'),
    lw: C.includes(370) ? num(370, -1) | 0 : -1,
    paper: num(67, 0) === 1,
    ez: C.includes(230) ? num(230, 1) : 1,       // extrusion z (OCS): −1 = mirrored about the y axis
    ltScale: num(48, 1),
  });
  const ocs = (p, x, y) => (p.ez < 0 ? [-x, y] : [x, y]);

  function addItem(it) {
    if (it.paper && target === model) { paperCount++; return; }
    target.push(it);
  }

  function finishEntity() {
    const t = eType;
    eType = null;
    if (!t) return;
    if (section === 'HEADER' || section === 'CLASSES') return;
    if (section === 'TABLES') return tableEntry(t);
    if (section === 'OBJECTS') { if (t === 'LAYOUT') { const n = str(1); if (n && n !== 'Model') layouts.push(n); } return; }
    if (section !== 'ENTITIES' && section !== 'BLOCKS') return;
    if (t === 'BLOCK') {
      const name = str(2);
      curBlock = { name, base: [num(10), num(20)], items: [], flags: num(70) | 0, xref: str(1) };
      if (!blocks.has(name)) blocks.set(name, curBlock);
      target = curBlock.items;
      return;
    }
    if (t === 'ENDBLK') { curBlock = null; target = model; return; }
    if (poly) {
      if (t === 'VERTEX') {
        const f = num(70) | 0;
        if ((f & 16) || poly.skip) return;       // spline frame control point / mesh vertex
        poly.v.push(num(10), num(20), num(42, 0), num(40, poly.w0), num(41, poly.w1));
        return;
      }
      const p = poly; poly = null;
      if (!p.skip) emitPoly(p.p, p.v, p.closed, 5, p.kind);
      if (t === 'SEQEND') return;
    }
    if (insertOpen) {
      if (t === 'ATTRIB') { const a = textItem('ATTRIB'); if (a && !((num(70) | 0) & 1)) insertOpen.attribs.push(a); return; }
      insertOpen = null;
      if (t === 'SEQEND') return;
    }
    entity(t);
  }

  function tableEntry(t) {
    if (t === 'LAYER') {
      const name = str(2, '0').trim() || '0';
      const aci = num(62, 7) | 0;
      layers.set(name, { name, aci: Math.abs(aci) || 7, rgb: C.includes(420) ? num(420) | 0 : null, off: aci < 0, frozen: !!((num(70) | 0) & 1),
        ltype: str(6, 'CONTINUOUS'), lw: C.includes(370) ? num(370, -3) | 0 : -3, plot: num(290, 1) !== 0 });
    } else if (t === 'LTYPE') {
      const name = str(2);
      const els = []; C.forEach((c, i) => { if (c === 49) els.push(parseFloat(V[i]) || 0); });
      ltypes.set(name.toUpperCase(), els.some((e) => e < 0) && els.some((e) => e > 0));
    }
  }

  function emitPoly(p, v, closed, stride, kind) {
    // v: [x, y, bulge, (w0, w1)] per vertex
    const n = v.length / stride;
    if (n < 2) return;
    const hasBulge = (() => { for (let i = 0; i < n; i++) if (Math.abs(v[i * stride + 2]) > 1e-9 && (closed || i < n - 1)) return true; return false; })();
    const width = stride >= 5 ? Math.max(v[3] || 0, v[4] || 0) : 0;
    const P = (i) => ocs(p, v[(i % n) * stride], v[(i % n) * stride + 1]);
    const segN = closed ? n : n - 1;
    if (!hasBulge) {
      const pts = [];
      for (let i = 0; i < n; i++) pts.push(...P(i));
      if (closed) pts.push(...P(0));
      if (width > 0) {
        // a wide polyline: its outline is a filled band (walls drawn as thick polylines)
        for (let i = 0; i < segN; i++) {
          const [x1, y1] = P(i), [x2, y2] = P(i + 1), d = Math.hypot(x2 - x1, y2 - y1);
          if (d < 1e-12) continue;
          const w = (stride >= 5 ? Math.max(v[(i % n) * stride + 3], v[(i % n) * stride + 4]) : width) / 2;
          const nx = -(y2 - y1) / d * w, ny = (x2 - x1) / d * w;
          addItem({ k: 'fill', ...p, pts: [x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny, x1 + nx, y1 + ny], src: 'wide-poly', hid: ++hatchId });
        }
        return;
      }
      addItem({ k: 'path', ...p, pts, closed, curved: false, src: kind });
      return;
    }
    // split at bulges: straight runs stay straight (walls), every arc is its own curved path
    let run = null;
    const flush = () => { if (run && run.length >= 4) addItem({ k: 'path', ...p, pts: run, closed: false, curved: false, src: kind }); run = null; };
    for (let i = 0; i < segN; i++) {
      const b = v[(i % n) * stride + 2];
      const [x1, y1] = P(i), [x2, y2] = P(i + 1);
      if (Math.abs(b) > 1e-9) {
        flush();
        // bulge sign follows the OCS; a mirrored OCS reverses it
        addItem({ k: 'path', ...p, pts: bulgePts(x1, y1, x2, y2, p.ez < 0 ? -b : b, [x1, y1]), closed: false, curved: true, src: 'bulge' });
      } else {
        if (!run) run = [x1, y1];
        run.push(x2, y2);
      }
    }
    flush();
  }

  function textItem(t) {
    const p = props();
    const raw = str(1);
    if (!raw.trim()) return null;
    const h = num(40, 2.5);
    const rot = num(50, 0) * DEG;
    const hj = num(72, 0) | 0, vj = num(73, 0) | 0;
    let [x, y] = ocs(p, num(10), num(20));
    const s = fixStr(raw);
    const w = s.length * h * 0.6 * num(41, 1);
    if ((hj || vj) && C.includes(11)) {
      const [ax, ay] = ocs(p, num(11), num(21));
      const back = hj === 1 || hj === 4 ? w / 2 : hj === 2 ? w : 0;
      x = ax - back * Math.cos(rot); y = ay - back * Math.sin(rot);
      if (vj === 2 || hj === 4) { x += h / 2 * Math.sin(rot); y -= h / 2 * Math.cos(rot); }
      else if (vj === 3) { x += h * Math.sin(rot); y -= h * Math.cos(rot); }
    }
    return { k: 'text', ...p, x, y, h, rot: p.ez < 0 ? Math.PI - rot : rot, lines: [s], w, src: t };
  }

  function entity(t) {
    const p = props();
    switch (t) {
      case 'LINE': {
        addItem({ k: 'path', ...p, pts: [num(10), num(20), num(11), num(21)], closed: false, curved: false, src: 'line' });
        break;
      }
      case 'LWPOLYLINE': {
        const v = [];
        const cw = num(43, 0);
        for (let i = 0; i < C.length; i++) {
          const c = C[i];
          if (c === 10) v.push(parseFloat(V[i]) || 0, 0, 0, cw, cw);
          else if (c === 20 && v.length) v[v.length - 4] = parseFloat(V[i]) || 0;
          else if (c === 42 && v.length) v[v.length - 3] = parseFloat(V[i]) || 0;
          else if (c === 40 && v.length) v[v.length - 2] = parseFloat(V[i]) || 0;
          else if (c === 41 && v.length) v[v.length - 1] = parseFloat(V[i]) || 0;
        }
        emitPoly(p, v, !!((num(70) | 0) & 1), 5, 'poly');
        break;
      }
      case 'POLYLINE': {
        const f = num(70) | 0;
        if (f & (16 | 64)) { skipped['POLYLINE (mesh)'] = (skipped['POLYLINE (mesh)'] || 0) + 1; poly = { p, v: [], closed: false, kind: 'mesh', skip: true, w0: 0, w1: 0 }; break; }
        poly = { p, v: [], closed: !!(f & 1), kind: 'poly', w0: num(40, 0), w1: num(41, 0) };
        break;
      }
      case 'ARC': case 'CIRCLE': {
        const [cx, cy] = [num(10), num(20)], r = num(40);
        if (!(r > 0)) break;
        let a0 = t === 'ARC' ? num(50) * DEG : 0, a1 = t === 'ARC' ? num(51) * DEG : 2 * Math.PI;
        let sweep = a1 - a0; while (sweep <= 0) sweep += 2 * Math.PI;
        if (t === 'CIRCLE') sweep = 2 * Math.PI;
        let pts = arcPts(cx, cy, r, a0, sweep);
        if (p.ez < 0) for (let i = 0; i < pts.length; i += 2) pts[i] = -pts[i];
        addItem({ k: 'path', ...p, pts, closed: t === 'CIRCLE', curved: true, src: t.toLowerCase(), arc: { r, sweep: sweep / DEG } });
        break;
      }
      case 'ELLIPSE': {
        const cx = num(10), cy = num(20), mx = num(11), my = num(21), ratio = num(40, 1);
        let t0 = num(41, 0), t1 = num(42, 2 * Math.PI);
        let sweep = t1 - t0; while (sweep <= 0) sweep += 2 * Math.PI;
        const ex = num(230, 1) < 0 ? -1 : 1;
        const n = Math.max(8, Math.ceil(sweep / (5 * DEG)));
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const a = t0 + sweep * i / n, c = Math.cos(a), s = Math.sin(a) * ratio;
          pts.push(cx + mx * c - my * s * ex, cy + my * c + mx * s * ex);
        }
        addItem({ k: 'path', ...p, pts, closed: Math.abs(sweep - 2 * Math.PI) < 1e-6, curved: true, src: 'ellipse' });
        break;
      }
      case 'SPLINE': {
        const deg = num(71, 3) | 0, knots = [], ctrl = [], w = [], fit = [];
        for (let i = 0; i < C.length; i++) {
          const c = C[i], x = parseFloat(V[i]) || 0;
          if (c === 40) knots.push(x); else if (c === 41) w.push(x);
          else if (c === 10) ctrl.push(x, 0); else if (c === 20 && ctrl.length) ctrl[ctrl.length - 1] = x;
          else if (c === 11) fit.push(x, 0); else if (c === 21 && fit.length) fit[fit.length - 1] = x;
        }
        const pts = ctrl.length >= 4 ? splinePts(Math.max(1, deg), knots, ctrl, w.length === ctrl.length / 2 ? w : null) : fit;
        if (pts.length >= 4) addItem({ k: 'path', ...p, pts, closed: !!((num(70) | 0) & 1), curved: true, src: 'spline' });
        break;
      }
      case 'INSERT': {
        const [x, y] = ocs(p, num(10), num(20));
        const it = { k: 'insert', ...p, name: str(2), x, y, sx: num(41, 1), sy: num(42, 1), rot: num(50, 0) * DEG,
          cols: Math.max(1, num(70, 1) | 0), rows: Math.max(1, num(71, 1) | 0), dc: num(44, 0), dr: num(45, 0), attribs: [] };
        addItem(it);
        if ((num(66) | 0) === 1) insertOpen = it;
        break;
      }
      case 'TEXT': case 'ATTRIB': {
        const it = textItem(t);
        if (it && !(t === 'ATTRIB' && ((num(70) | 0) & 1))) addItem(it);
        break;
      }
      case 'MTEXT': {
        let raw = '';
        for (let i = 0; i < C.length; i++) if (C[i] === 3) raw += V[i];
        raw += str(1);
        const lines = mtextPlain(raw);
        if (!lines.length) break;
        const h = num(40, 2.5);
        const rot = C.includes(11) ? Math.atan2(num(21), num(11)) : num(50, 0) * DEG;   // AutoCAD writes degrees here
        const att = num(71, 1) | 0;
        const w = Math.max(...lines.map((l) => l.length)) * h * 0.6;
        const lh = h * 1.66, tot = lh * (lines.length - 1) + h;
        const col = (att - 1) % 3, row = Math.floor((att - 1) / 3);
        const dx = -(col === 1 ? w / 2 : col === 2 ? w : 0), dyTop = row === 0 ? 0 : row === 1 ? tot / 2 : tot;
        const [x0, y0] = [num(10), num(20)];
        const c = Math.cos(rot), s = Math.sin(rot);
        // first baseline: one text height below the top of the block
        const bx = dx, by = dyTop - h;
        addItem({ k: 'text', ...p, x: x0 + bx * c - by * s, y: y0 + bx * s + by * c, h, rot, lines, w, lh, src: 'mtext' });
        break;
      }
      case 'DIMENSION': {
        const type = (num(70) | 0) & 7;
        const it = { k: 'dim', ...p, block: str(2), type, def: [num(10), num(20)], mid: [num(11), num(21)], p1: [num(13), num(23)], p2: [num(14), num(24)],
          ang: num(50, 0) * DEG, measured: C.includes(42) ? num(42) : null, text: str(1, ''), hasP: C.includes(13) && C.includes(14) };
        addItem(it);
        break;
      }
      case 'HATCH': {
        const loops = hatchLoops();
        const solid = (num(70) | 0) === 1, hid = ++hatchId;
        for (const pts of loops) if (pts.length >= 6) addItem({ k: 'fill', ...p, pts: p.ez < 0 ? pts.map((v, i) => (i % 2 ? v : -v)) : pts, src: 'hatch', solid, pattern: str(2, ''), hid });
        break;
      }
      case 'SOLID': case 'TRACE': {
        const q = [[num(10), num(20)], [num(11), num(21)], [num(13, num(12)), num(23, num(22))], [num(12), num(22)]].map(([x, y]) => ocs(p, x, y));
        const pts = []; for (const [x, y] of q) pts.push(x, y); pts.push(q[0][0], q[0][1]);
        addItem({ k: 'fill', ...p, pts, src: 'solid', solid: true, hid: ++hatchId });
        break;
      }
      case '3DFACE': {
        const q = [[num(10), num(20)], [num(11), num(21)], [num(12), num(22)], [num(13, num(12)), num(23, num(22))]];
        const pts = []; for (const [x, y] of q) pts.push(x, y); pts.push(q[0][0], q[0][1]);
        addItem({ k: 'path', ...p, pts, closed: true, curved: false, src: '3dface' });
        break;
      }
      case 'LEADER': {
        const pts = []; for (let i = 0; i < C.length; i++) { if (C[i] === 10) pts.push(parseFloat(V[i]) || 0, 0); else if (C[i] === 20 && pts.length) pts[pts.length - 1] = parseFloat(V[i]) || 0; }
        if (pts.length >= 4) addItem({ k: 'path', ...p, pts, closed: false, curved: false, src: 'leader' });
        break;
      }
      case 'POINT': case 'VIEWPORT': case 'ATTDEF': case 'SEQEND': case 'VERTEX': case 'ENDBLK': break;
      default: if (!p.paper || target !== model) skipped[t] = (skipped[t] || 0) + 1;
    }
  }

  /** HATCH boundary loops (drawing units, closed point lists) from the collected group codes. */
  function hatchLoops() {
    const loops = [];
    let i = C.indexOf(91);
    if (i < 0) return loops;
    const nLoops = parseInt(V[i], 10) || 0;
    i++;
    const at = (c) => (C[i] === c ? parseFloat(V[i++]) || 0 : (() => { const j = C.indexOf(c, i); if (j < 0 || j > i + 4) return 0; i = j + 1; return parseFloat(V[j]) || 0; })());
    for (let L = 0; L < nLoops && i < C.length; L++) {
      while (i < C.length && C[i] !== 92) i++;
      if (i >= C.length) break;
      const flags = parseInt(V[i++], 10) || 0;
      const pts = [];
      if (flags & 2) {
        const hasB = at(72), closed = at(73), n = at(93) | 0;
        const v = [];
        for (let k = 0; k < n; k++) { const x = at(10), y = at(20); const b = hasB && C[i] === 42 ? at(42) : 0; v.push(x, y, b); }
        for (let k = 0; k < n; k++) {
          const x1 = v[3 * k], y1 = v[3 * k + 1], b = v[3 * k + 2];
          if (!k) pts.push(x1, y1);
          if (k === n - 1 && !closed && n > 2) { /* AutoCAD closes hatch polylines anyway */ }
          const j = (k + 1) % n, x2 = v[3 * j], y2 = v[3 * j + 1];
          if (Math.abs(b) > 1e-9) bulgePts(x1, y1, x2, y2, b, pts); else pts.push(x2, y2);
        }
      } else {
        const ne = at(93) | 0;
        for (let e = 0; e < ne && i < C.length; e++) {
          const et = at(72) | 0;
          if (et === 1) { const x1 = at(10), y1 = at(20), x2 = at(11), y2 = at(21); if (!pts.length) pts.push(x1, y1); pts.push(x2, y2); }
          else if (et === 2) {
            const cx = at(10), cy = at(20), r = at(40), a0 = at(50), a1 = at(51), ccw = at(73);
            let s0 = (ccw ? a0 : -a0) * DEG, s1 = (ccw ? a1 : -a1) * DEG, sw = s1 - s0;
            if (ccw) { while (sw <= 0) sw += 2 * Math.PI; } else { while (sw >= 0) sw -= 2 * Math.PI; }
            const a = arcPts(cx, cy, r, s0, sw); for (let q = pts.length ? 2 : 0; q < a.length; q++) pts.push(a[q]);
          } else if (et === 3) {
            const cx = at(10), cy = at(20), mx = at(11), my = at(21), ratio = at(40), a0 = at(50) * DEG, a1 = at(51) * DEG, ccw = at(73);
            let sw = a1 - a0; while (sw <= 0) sw += 2 * Math.PI;
            const n = Math.ceil(sw / (5 * DEG));
            for (let q = 0; q <= n; q++) {
              const a = ccw ? a0 + sw * q / n : -(a0 + sw * q / n), c = Math.cos(a), s = Math.sin(a) * ratio;
              if (q || !pts.length) pts.push(cx + mx * c - my * s, cy + my * c + mx * s);
            }
          } else if (et === 4) {
            const deg = at(94) | 0, rational = at(73); at(74); const nk = at(95) | 0, nc = at(96) | 0;
            const knots = [], ctrl = [], w = [];
            for (let q = 0; q < nk; q++) knots.push(at(40));
            for (let q = 0; q < nc; q++) { ctrl.push(at(10), at(20)); if (rational && C[i] === 42) w.push(at(42)); }
            if (C[i] === 97 && C[i + 1] === 11) { const nf = at(97) | 0; for (let q = 0; q < nf; q++) { at(11); at(21); } if (C[i] === 12) { at(12); at(22); } if (C[i] === 13) { at(13); at(23); } }
            const sp = splinePts(Math.max(1, deg), knots, ctrl, w.length === nc ? w : null);
            for (let q = pts.length ? 2 : 0; q < sp.length; q++) pts.push(sp[q]);
          } else break;
        }
      }
      // source objects
      if (C[i] === 97) { const n = parseInt(V[i++], 10) || 0; for (let k = 0; k < n && C[i] === 330; k++) i++; }
      if (pts.length >= 6) {
        const n = pts.length;
        if (Math.abs(pts[0] - pts[n - 2]) > 1e-9 || Math.abs(pts[1] - pts[n - 1]) > 1e-9) pts.push(pts[0], pts[1]);
        loops.push(pts);
      }
    }
    return loops;
  }

  // ── the pass over the file ──
  let code, varName = null;
  for (;;) {
    code = T.next();
    if (code < 0) break;
    const v = T.v;
    if (code === 0) {
      const name = v.trim();
      if (eType) finishEntity();
      if (name === 'SECTION') { section = '?'; sawSection = true; continue; }
      if (name === 'ENDSEC') {
        if (poly && !poly.skip) emitPoly(poly.p, poly.v, poly.closed, 5, poly.kind);
        poly = null; insertOpen = null;
        if (section === 'HEADER') applyHeader();
        section = null; target = model; curBlock = null; continue;
      }
      if (name === 'EOF') { sawEOF = true; break; }
      if (section === 'HEADER') continue;
      if (section === 'TABLES' && (name === 'TABLE' || name === 'ENDTAB')) continue;
      eType = name; C.length = 0; V.length = 0;
      continue;
    }
    if (section === '?') {
      if (code === 2) { section = v.trim(); if (section === 'ENTITIES') target = model; }
      continue;
    }
    if (section === 'HEADER') {
      if (code === 9) { varName = v.trim(); header[varName] = header[varName] || {}; continue; }
      if (varName) header[varName][code] = v;
      if (varName === '$DWGCODEPAGE' || varName === '$ACADVER') applyHeader();
      continue;
    }
    if (eType) {
      if (code === 1 || code === 3 || code === 2 || code === 8 || code === 7 || code === 6) { C.push(code); V.push(code === 1 || code === 3 ? v : v.trim()); }
      else { C.push(code); V.push(v); }
    }
  }
  if (eType) finishEntity();
  if (poly && !poly.skip) emitPoly(poly.p, poly.v, poly.closed, 5, poly.kind);
  poly = null;

  function applyHeader() {
    const ver = header.$ACADVER && String(header.$ACADVER[1] || '').trim();
    const cp = header.$DWGCODEPAGE && String(header.$DWGCODEPAGE[3] || '').trim();
    const verN = ver && /^AC(\d{4})$/.test(ver) ? parseInt(ver.slice(2), 10) : 0;
    if (verN >= 1021) T.setEncoding('utf-8');            // R2007+ files are UTF-8
    else if (cp) T.setEncoding(codepageLabel(cp) || 'windows-1252');
  }

  if (!sawSection && !model.length) throw plainError('dxf-not-dxf', 'This file is not a DXF drawing (no DXF sections were found). Export the plan from the CAD program as DXF and choose that file.');
  if (!sawEOF) {
    if (section || T.truncated || !model.length) throw plainError('dxf-truncated', 'This DXF file is incomplete: it stops in the middle of the drawing, so it was probably cut off while saving or copying. Save or download it again and import the new file.');
    warnings.push({ code: 'dxf-no-eof', text: 'The DXF file has no end marker; everything up to its end was read.' });
  }

  // ── units ──
  const hv = (name, code) => (header[name] && header[name][code] != null ? parseFloat(header[name][code]) : null);
  const insunits = hv('$INSUNITS', 70);
  const measurement = hv('$MEASUREMENT', 70);
  const uDef = INSUNITS[insunits | 0];
  const units = { code: insunits, name: uDef ? uDef[0] : 'unitless', cmPerUnit: uDef ? uDef[1] : null, measurement, dimlfac: hv('$DIMLFAC', 40) || 1,
    version: header.$ACADVER ? String(header.$ACADVER[1]).trim() : null, codepage: header.$DWGCODEPAGE ? String(header.$DWGCODEPAGE[3]).trim() : null };

  // ── layers (unknown layers are created on first use) ──
  const layerOf = (name) => {
    let L = layers.get(name);
    if (!L) layers.set(name, L = { name, aci: 7, rgb: null, off: false, frozen: false, ltype: 'CONTINUOUS', lw: -3, plot: true, implicit: true });
    return L;
  };
  layerOf('0');
  const isDashed = (lt) => !!lt && lt.toUpperCase() !== 'CONTINUOUS' && (ltypes.get(lt.toUpperCase()) ?? /DASH|HIDDEN|CENTER|DOT|PHANTOM/i.test(lt));

  // ── expansion of model space (blocks recursively) into world-coordinate primitives ──
  const out = { paths: [], texts: [], dims: [], inserts: [] };
  const stats = new Map();               // layer → counters
  const lstat = (name) => { let s = stats.get(name); if (!s) stats.set(name, s = { count: 0, lines: 0, arcs: 0, fills: 0, texts: 0, inserts: 0, dims: 0, length: 0, quarterArcs: 0 }); return s; };
  const blockUse = new Map();
  let segBudget = MAX_SEGMENTS, overflow = false;
  const blockBox = new Map();

  /** Effective properties of an item inside an insert (layer 0 / BYBLOCK inherit from the insert). */
  function resolve(it, parent) {
    const layer = it.layer === '0' && parent ? parent.layer : it.layer;
    const L = layerOf(layer);
    let colour;
    if (it.rgb != null && it.aci !== 0 && it.aci !== 256) colour = trueColor(it.rgb);
    else if (it.aci === 0) colour = parent ? parent.colour : (L.rgb != null ? trueColor(L.rgb) : aciColor(L.aci));
    else if (it.aci === 256 || it.aci == null) colour = it.layer === '0' && parent ? parent.colour : (L.rgb != null ? trueColor(L.rgb) : aciColor(L.aci));
    else colour = aciColor(it.aci);
    let lw = it.lw;
    if (lw === -2) lw = parent ? parent.lwRaw : -3;
    if (lw === -1 || lw === undefined) lw = it.layer === '0' && parent ? parent.lwRaw : L.lw;
    let lt = it.ltype && it.ltype.toUpperCase();
    if (!lt || lt === 'BYLAYER') lt = it.layer === '0' && parent ? parent.ltype : L.ltype;
    else if (lt === 'BYBLOCK') lt = parent ? parent.ltype : 'CONTINUOUS';
    return { layer, colour, lwRaw: lw, ltype: lt };
  }
  const lwPage = (raw) => (raw >= 0 ? raw / 100 : 25 / 100) * 72 / 25.4;   // 1/100 mm on paper → points

  function expand(items, M, parent, depth, chain, inst = 'm') {
    for (const it of items) {
      if (overflow) return;
      const r = resolve(it, parent);
      if (it.k === 'path' || it.k === 'fill') {
        const pts = new Array(it.pts.length);
        for (let i = 0; i < it.pts.length; i += 2) { const q = ap(M, it.pts[i], it.pts[i + 1]); pts[i] = q[0]; pts[i + 1] = q[1]; }
        segBudget -= pts.length / 2;
        if (segBudget < 0) { overflow = true; return; }
        const s = lstat(r.layer); s.count++;
        if (it.k === 'fill') {
          s.fills++;
          out.paths.push({ pts, closed: true, stroke: false, fill: true, evenOdd: true, lw: 0, color: r.colour, fillColor: r.colour, dash: [], curved: false, layer: r.layer, kind: it.src, solid: !!it.solid, group: inst + '#' + it.hid });
        } else {
          let len = 0; for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
          s.length += len;
          if (it.curved) { s.arcs++; if (it.arc && it.arc.sweep >= 70 && it.arc.sweep <= 110) s.quarterArcs++; } else s.lines++;
          out.paths.push({ pts, closed: !!it.closed, stroke: true, fill: false, evenOdd: false, lw: lwPage(r.lwRaw), color: r.colour, fillColor: r.colour,
            dash: isDashed(r.ltype) ? [3, 2] : [], curved: !!it.curved, layer: r.layer, kind: it.src });
        }
      } else if (it.k === 'text') {
        const [x, y] = ap(M, it.x, it.y);
        const sc = Math.sqrt(Math.abs(det(M)));
        const dir = ap([M[0], M[1], M[2], M[3], 0, 0], Math.cos(it.rot), Math.sin(it.rot));
        const rot = Math.atan2(dir[1], dir[0]);
        const lh = (it.lh || it.h * 1.66) * sc;
        it.lines.forEach((str, n) => {
          const s = lstat(r.layer); s.count++; s.texts++;
          out.texts.push({ str, x: x + Math.sin(rot) * lh * n, y: y - Math.cos(rot) * lh * n, h: it.h * sc, w: str.length * it.h * sc * 0.6, rot, layer: r.layer, colour: r.colour, dir: RTL.test(str) ? 'rtl' : 'ltr' });
        });
      } else if (it.k === 'dim') {
        const s = lstat(r.layer); s.count++; s.dims++;
        const b = blocks.get(it.block);
        if (b && depth < MAX_DEPTH) expand(b.items, M, { ...r, colour: r.colour }, depth + 1, chain, inst + '/d' + (++instSeq));
        // the measured length, from the definition points
        let du = null, a = null, c = null;
        if (it.hasP && (it.type === 0 || it.type === 1)) {
          const p1 = it.p1, p2 = it.p2;
          if (it.type === 1) du = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
          else du = Math.abs((p2[0] - p1[0]) * Math.cos(it.ang) + (p2[1] - p1[1]) * Math.sin(it.ang));
          // the dimension line: the extension points projected onto the line through the definition point
          const ux = it.type === 1 ? (p2[0] - p1[0]) / (du || 1) : Math.cos(it.ang), uy = it.type === 1 ? (p2[1] - p1[1]) / (du || 1) : Math.sin(it.ang);
          const proj = (q) => { const t = (q[0] - it.def[0]) * ux + (q[1] - it.def[1]) * uy; return [it.def[0] + t * ux, it.def[1] + t * uy]; };
          a = ap(M, ...proj(p1)); c = ap(M, ...proj(p2));
          du *= Math.sqrt(Math.abs(det(M)));
          if (!b) out.paths.push({ pts: [a[0], a[1], c[0], c[1]], closed: false, stroke: true, fill: false, evenOdd: false, lw: lwPage(13), color: r.colour, fillColor: r.colour, dash: [], curved: false, layer: r.layer, kind: 'dimension' });
        }
        const shownRaw = it.text && it.text.trim() && !/<>/.test(it.text) ? mtextPlain(it.text).join(' ') : null;
        const measured = it.measured != null ? it.measured : du != null ? du * units.dimlfac : null;
        let value = null;
        if (shownRaw != null) { const m = shownRaw.replace(',', '.').match(/^\s*(\d+(?:\.\d+)?)\s*$/); value = m ? parseFloat(m[1]) : null; }
        else value = measured;
        if (du != null) out.dims.push({ a, c, du, value, measured, text: shownRaw, layer: r.layer, type: it.type });
        if (!b && value != null && a) {
          const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2;
          const str = shownRaw || String(+value.toFixed(2));
          const hh = 0.02 * (du || 1);
          out.texts.push({ str, x: mx, y: my, h: hh, w: str.length * hh * 0.6, rot: Math.atan2(c[1] - a[1], c[0] - a[0]), layer: r.layer, colour: r.colour, dir: 'ltr' });
        }
      } else if (it.k === 'insert') {
        const b = blocks.get(it.name);
        const s = lstat(r.layer); s.count++; s.inserts++;
        if (!b) { warnings.push({ code: 'dxf-missing-block', text: `A block “${it.name}” is used but not defined in the file; it was left out.` }); continue; }
        if (b.flags & 4 || (b.xref && b.xref.trim())) { skipped['XREF'] = (skipped['XREF'] || 0) + 1; continue; }
        if (depth >= MAX_DEPTH || chain.includes(it.name)) { warnings.push({ code: 'dxf-block-loop', text: `Block “${it.name}” refers to itself (or nests deeper than ${MAX_DEPTH}); the repeat was left out.` }); continue; }
        if (!parent) blockUse.set(it.name, (blockUse.get(it.name) || 0) + it.cols * it.rows);
        const c = Math.cos(it.rot), sn = Math.sin(it.rot);
        const ez = it.ez < 0 ? -1 : 1;
        for (let row = 0; row < it.rows; row++) for (let col = 0; col < it.cols; col++) {
          // block → insert: −base, scale, + array offset (in the insert's rotated frame), rotate, + insertion point, (mirror OCS)
          let L = [it.sx, 0, 0, it.sy, -b.base[0] * it.sx + col * it.dc, -b.base[1] * it.sy + row * it.dr];
          L = then(L, [c, sn, -sn, c, it.x * ez, it.y]);
          if (ez < 0) L = then(L, [-1, 0, 0, 1, 0, 0]);
          const W = then(L, M);
          const n0 = out.paths.length;
          expand(b.items, W, r, depth + 1, chain.concat(it.name), inst + '/' + (++instSeq));
          if (!parent) {
            // top-level insert: bbox and what its block holds (door / window recognition)
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (let k = n0; k < out.paths.length; k++) { const q = out.paths[k].pts; for (let j = 0; j < q.length; j += 2) { x0 = Math.min(x0, q[j]); x1 = Math.max(x1, q[j]); y0 = Math.min(y0, q[j + 1]); y1 = Math.max(y1, q[j + 1]); } }
            if (Number.isFinite(x0)) {
              const [ix, iy] = ap(M, (it.x * ez) + col * it.dc * c - row * it.dr * sn, it.y + col * it.dc * sn + row * it.dr * c);
              out.inserts.push({ block: it.name, layer: r.layer, x: ix, y: iy, rotation: it.rot / DEG, sx: it.sx * ez, sy: it.sy, bbox: { x0, y0, x1, y1 }, first: n0, last: out.paths.length });
            }
          }
        }
        for (const a of it.attribs) expand([a], M, parent, depth, chain);
      }
    }
  }
  expand(model, I, null, 0, []);
  if (overflow) warnings.push({ code: 'dxf-too-much', text: 'The drawing holds more geometry than can be handled (a very large array of blocks?); only the first part was read.' });

  // ── block summaries: size, arcs, door / window guess ──
  const DOOR_RE = /door|דלת|delet|porte|t[üu]e?r\b|puerta|dr[-_ ]?\d/i, WIN_RE = /window|wind\b|win[-_ ]?\d|חלון|halon|fenster|fen[eê]tre|ventana|glaz/i;
  const blockList = [];
  for (const [name, b] of blocks) {
    if (/^\*(model|paper)_space/i.test(name)) continue;
    if (/^\*[DTXU]/i.test(name) && !blockUse.has(name)) continue;    // dimension / anonymous helper blocks
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, arcs = 0, lines = 0, quarter = 0;
    const walk = (items, M, depth) => {
      for (const it of items) {
        if (it.k === 'path' || it.k === 'fill') {
          for (let i = 0; i < it.pts.length; i += 2) { const [x, y] = ap(M, it.pts[i], it.pts[i + 1]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          if (it.curved) { arcs++; if (it.arc && it.arc.sweep >= 70 && it.arc.sweep <= 110) quarter++; } else lines++;
        } else if (it.k === 'insert' && depth < 4) {
          const bb = blocks.get(it.name); if (!bb) continue;
          const c = Math.cos(it.rot), sn = Math.sin(it.rot);
          walk(bb.items, then(then([it.sx, 0, 0, it.sy, -bb.base[0] * it.sx, -bb.base[1] * it.sy], [c, sn, -sn, c, it.x, it.y]), M), depth + 1);
        }
      }
    };
    walk(b.items, [1, 0, 0, 1, -b.base[0], -b.base[1]], 0);
    const kind = DOOR_RE.test(name) ? 'door' : WIN_RE.test(name) ? 'window' : quarter >= 1 && lines >= 1 ? 'door' : null;
    blockList.push({ name, count: blockUse.get(name) || 0, w: Number.isFinite(x0) ? x1 - x0 : 0, h: Number.isFinite(y0) ? y1 - y0 : 0, arcs, quarterArcs: quarter, lines, kind });
    blockBox.set(name, { x0, y0, x1, y1 });
  }

  // ── extents and the page ──
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of out.paths) for (let i = 0; i < p.pts.length; i += 2) {
    const x = p.pts[i], y = p.pts[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  for (const t of out.texts) { minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x + t.w); minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y + t.h); }
  if (!Number.isFinite(minX)) {
    if (paperCount) throw plainError('dxf-empty', 'This DXF file has its drawing only in a paper-space layout; model space is empty. Open it in the CAD program, copy the plan into model space (or use “Export layout to model”), save as DXF and import that.');
    throw plainError('dxf-empty', 'This DXF file contains no drawing (no lines, arcs or polylines in model space).');
  }
  const ext = Math.max(maxX - minX, maxY - minY) || 1;

  // unit guess when the file does not say (a building is most likely 3–100 m across)
  let unitGuess = units.cmPerUnit;
  if (opts.cmPerUnit > 0) unitGuess = opts.cmPerUnit;
  if (!unitGuess) {
    const order = measurement === 0 ? [2.54, 30.48, 0.1, 1, 100] : [1, 0.1, 100, 2.54];
    unitGuess = order.find((k) => ext * k >= 400 && ext * k <= 15000) || 1;
  }
  const f = PAGE_CM / unitGuess;           // drawing units per page unit
  const margin = 20;
  const toPage = [1 / f, 0, 0, -1 / f, margin - minX / f, margin + maxY / f];
  const P = (x, y) => [toPage[0] * x + toPage[4], toPage[3] * y + toPage[5]];
  for (const p of out.paths) {
    const q = p.pts;
    for (let i = 0; i < q.length; i += 2) { q[i] = toPage[0] * q[i] + toPage[4]; q[i + 1] = toPage[3] * q[i + 1] + toPage[5]; }
  }
  const texts = out.texts.map((t) => { const [x, y] = P(t.x, t.y); return { str: t.str, x, y, w: t.w / f, h: t.h / f, angle: -t.rot / DEG, dir: t.dir, layer: t.layer, color: t.colour }; });
  const dims = out.dims.map((d) => { const [x1, y1] = d.a ? P(...d.a) : [0, 0], [x2, y2] = d.c ? P(...d.c) : [0, 0]; return { x1, y1, x2, y2, du: d.du, value: d.value, measured: d.measured, text: d.text, layer: d.layer }; });
  const inserts = out.inserts.map((n) => { const [x, y] = P(n.x, n.y), a = P(n.bbox.x0, n.bbox.y1), b = P(n.bbox.x1, n.bbox.y0);
    return { block: n.block, layer: n.layer, x, y, rotation: n.rotation, sx: n.sx, sy: n.sy, bbox: { x: a[0], y: a[1], w: b[0] - a[0], h: b[1] - a[1] }, paths: [n.first, n.last] }; });

  const layerList = [...layers.values()].map((L) => {
    const s = stats.get(L.name) || lstat(L.name);
    return { name: L.name, colour: L.rgb != null ? trueColor(L.rgb) : aciColor(L.aci), aci: L.aci, visible: !L.off && !L.frozen, off: L.off, frozen: L.frozen,
      lineweight: L.lw >= 0 ? L.lw / 100 : null, ltype: L.ltype, dir: RTL.test(L.name) ? 'rtl' : 'ltr',
      count: s.count, lines: s.lines, arcs: s.arcs, quarterArcs: s.quarterArcs, fills: s.fills, texts: s.texts, inserts: s.inserts, dims: s.dims, length: s.length / f };
  }).filter((L) => L.count > 0 || !L.implicit);

  if (paperCount) warnings.push({ code: 'dxf-paper-space', text: `${paperCount} item(s) in paper space (layouts${layouts.length ? ': ' + layouts.slice(0, 6).join(', ') : ''}) were not read — only model space is imported.` });
  const sk = Object.entries(skipped).filter(([k]) => k !== 'XREF');
  if (sk.length) warnings.push({ code: 'dxf-skipped', text: `Not drawn: ${sk.map(([k, n]) => `${n} ${k}`).join(', ')} (3D, images and proxy objects are not read).` });
  if (skipped.XREF) warnings.push({ code: 'dxf-xref', text: `${skipped.XREF} external reference(s) (XREF) point to other files and were not included. Bind them in the CAD program (XREF → Bind) before saving the DXF.` });
  if (!units.cmPerUnit) warnings.push({ code: 'dxf-unitless', text: 'The file does not say which unit it is drawn in; the scale is worked out from its dimensions and proportions — please confirm it.' });

  const W = (maxX - minX) / f + 2 * margin, H = (maxY - minY) / f + 2 * margin;
  return {
    kind: 'dxf', pageCount: 1, page: 1, pageBox: { w: W, h: H }, rotate: 0, units: 'dxf',
    paths: out.paths, texts, images: [], dims, inserts, blocks: blockList,
    layers: layerList, layouts,
    extents: { header: header.$EXTMIN && header.$EXTMAX ? { min: [hv('$EXTMIN', 10), hv('$EXTMIN', 20)], max: [hv('$EXTMAX', 10), hv('$EXTMAX', 20)] } : null, model: { minX, minY, maxX, maxY } },
    dxf: { units, unitGuess, cmPerPageUnit: PAGE_CM * (units.cmPerUnit || unitGuess) / unitGuess, duPerPageUnit: f, toPage, pageRatio: DXF_PAGE_RATIO },
    skipped, warnings,
  };
}
