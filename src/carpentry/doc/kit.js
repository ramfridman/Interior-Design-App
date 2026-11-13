/**
 * Layout kit of the quotation composer: page builder, logical (direction-aware) regions, text flow with pagination,
 * tables that break across pages with repeated headers, page furniture. All coordinates are page mm, y down.
 * In a Hebrew document every region is mirrored: logical "start" is the right edge (tables: first column on the right).
 */
import { textOp, r2 } from './prims.js';
import { wrap, textWidth, PT, ellipsize } from './metrics.js';
import { tr, S } from './strings.js';

export const PAPER = { A4: [210, 297], A3: [297, 420] };

/** Typographic system (size pt, font weight, colour token, leading factor). */
export const ST = {
  display: { size: 30, font: 'light', color: 'ink', lead: 1.12 },
  h1: { size: 19, font: 'light', color: 'ink', lead: 1.2 },
  h2: { size: 12.5, font: 'medium', color: 'ink', lead: 1.25 },
  h3: { size: 9.2, font: 'bold', color: 'ink', lead: 1.3 },
  lead: { size: 10, font: 'light', color: 'ink', lead: 1.5 },
  body: { size: 8.4, font: 'regular', color: 'ink2', lead: 1.5 },
  label: { size: 6.6, font: 'medium', color: 'grey', lead: 1.3 },
  small: { size: 6.8, font: 'regular', color: 'grey', lead: 1.4 },
  th: { size: 6.6, font: 'medium', color: 'grey', lead: 1.28 },
  td: { size: 7.3, font: 'regular', color: 'ink', lead: 1.36 },
  tdb: { size: 7.3, font: 'medium', color: 'ink', lead: 1.36 },
  furn: { size: 6.4, font: 'regular', color: 'grey', lead: 1.2 },
};
/** Line height (mm) of a style. */
export const lh = (st) => st.size * PT * st.lead;

/** Text page geometry (A4 portrait). */
export const TP = { W: 210, H: 297, x0: 20, x1: 190, top: 30, bottom: 274 };

/** A logical region of a page between physical x0 and x1. */
export function region(page, x0, x1, dir) {
  const rtl = dir === 'rtl', W = x1 - x0;
  const X = (u, w = 0) => (rtl ? x1 - u - w : x0 + u);
  const phys = (align) => (align === 'center' ? 'center' : (align === 'end') !== rtl ? 'right' : 'left');
  const R = {
    page, x0, x1, W, rtl, dir, X,
    /** Text anchored at logical u. align: 'start' | 'end' | 'center'. Returns the text width (mm). */
    text(u, y, s, st, align = 'start', extra = {}) {
      const op = textOp(rtl ? x1 - u : x0 + u, y, s, { size: st.size, font: st.font, color: extra.color || st.color, align: phys(align), dir, ...extra });
      page.ops.push(op);
      return op.w;
    },
    /** Wrapped paragraph from logical u, width w; returns the height used. */
    para(u, y, s, st, w, align = 'start', extra = {}) {
      const lines = wrap(s, w, st.size, st.font), l = lh(st);
      lines.forEach((line, i) => R.text(align === 'end' ? u + w : align === 'center' ? u + w / 2 : u, y + st.size * PT * 0.8 + i * l, line, st, align, { maxWidth: w, ...extra }));
      return lines.length * l;
    },
    rect(u, y, w, h, props) { page.ops.push({ t: 'rect', x: r2(X(u, w)), y: r2(y), w: r2(w), h: r2(h), ...props }); },
    line(u1, y1, u2, y2, props) { page.ops.push({ t: 'line', x1: r2(X(u1)), y1: r2(y1), x2: r2(X(u2)), y2: r2(y2), ...props }); },
    hline(y, u0 = 0, u1 = W, lw = 0.15, color = 'rule') { R.line(u0, y, u1, y, { lw, color }); },
  };
  return R;
}

/** Document builder: pages, flow, deferred furniture. */
export class Builder {
  constructor({ lang, project, paper }) {
    this.lang = lang === 'he' ? 'he' : 'en';
    this.dir = this.lang === 'he' ? 'rtl' : 'ltr';
    this.project = project;
    this.paper = PAPER[paper] ? paper : 'A4';
    this.pages = [];
    this.marks = {};
    this.tables = [];
    this.later = [];
    this.page = null;
    this.y = TP.top;
  }
  t(v) { return tr(v, this.lang); }
  /** New portrait text page; the flow cursor moves to its top. */
  textPage(extra = {}) {
    this.page = { size: [TP.W, TP.H], orientation: 'portrait', kind: 'text', ops: [], ...extra };
    this.pages.push(this.page);
    this.y = TP.top;
    return this.page;
  }
  /** New landscape drawing sheet (paper chosen at export). */
  sheetPage(extra = {}) {
    const [a, b] = PAPER[this.paper];
    const p = { size: [b, a], orientation: 'landscape', kind: 'sheet', ops: [], ...extra };
    this.pages.push(p);
    this.page = null;
    return p;
  }
  /** Record the current page for a contents entry. */
  mark(key) { this.marks[key] = this.pages.length; }
  /** The flow region of the current text page. */
  get R() { return region(this.page, TP.x0, TP.x1, this.dir); }
  ensure(h) { if (!this.page || this.page.kind !== 'text' || this.y + h > TP.bottom) this.textPage(); }
  space(h) { this.y += h; }

  /** Section heading: number in the accent colour, title, hairline rule. */
  heading(num, title, { level = 2, key } = {}) {
    const st = level === 2 ? ST.h2 : ST.h3, before = level === 2 ? 9 : 5.5;
    if (this.page && this.y > TP.top + 1) this.y += before;
    this.ensure(level === 2 ? 34 : 22);
    if (key) this.mark(key);
    const R = this.R, base = this.y + st.size * PT * 0.8;
    let u = 0;
    if (num) { R.text(0, base, String(num), st, 'start', { color: 'accent' }); u = level === 2 ? 11 : 9; }
    R.text(u, base, this.t(title), st, 'start', { maxWidth: R.W - u });
    this.y += lh(st) + (level === 2 ? 1.6 : 1.2);
    if (level === 2) { R.hline(this.y, 0, R.W, 0.25, 'ink'); this.y += 4.5; } else this.y += 1.2;
  }
  /** Wrapped paragraph in the flow (breaks across pages line by line). */
  para(s, st = ST.body, { gap = 2.5, indent = 0, width, color } = {}) {
    const w = (width || this.R.W) - indent, lines = wrap(this.t(s), w, st.size, st.font), l = lh(st);
    for (const line of lines) {
      this.ensure(l);
      this.R.text(indent, this.y + st.size * PT * 0.8, line, st, 'start', { maxWidth: w, ...(color ? { color } : {}) });
      this.y += l;
    }
    this.y += gap;
  }
  /** Bulleted list. */
  bullets(items, st = ST.body, { indent = 4.5, gap = 1.2 } = {}) {
    for (const it of items) {
      const lines = wrap(this.t(it), this.R.W - indent, st.size, st.font), l = lh(st);
      this.ensure(l * Math.min(lines.length, 2));
      this.R.rect(0.6, this.y + st.size * PT * 0.8 - 1.55, 1.1, 1.1, { fill: 'accent' });
      for (const line of lines) { this.ensure(l); this.R.text(indent, this.y + st.size * PT * 0.8, line, st, 'start', { maxWidth: this.R.W - indent }); this.y += l; }
      this.y += gap;
    }
  }

  /**
   * Table that paginates row by row and repeats its header (and a "continued" caption) on every new page.
   * spec = { id, title?, cols: [{ key, title, w, align?: 'start'|'end'|'center', st? }], rows: [{ cells, kind?: 'group'|'total', na?: [key], h? }],
   *          head = true, grid = false, rowMin = 0, pad = 1.5 }
   * Cell values: string | { en, he } | { edges: { long, short }, label } (edge-banding mark).
   */
  table(spec) {
    const B = this, cols = spec.cols, total = cols.reduce((s, c) => s + c.w, 0);
    const W = B.R.W, widths = cols.map((c) => (c.w / total) * W), us = widths.map((_, i) => widths.slice(0, i).reduce((s, x) => s + x, 0));
    const padX = 1.4, padY = spec.pad != null ? spec.pad : 1.45, st = ST.td, l = lh(st);
    let drawn = 0;
    const headLines = cols.map((c, i) => wrap(B.t(c.title), widths[i] - 2 * padX, ST.th.size, ST.th.font));
    const headH = spec.head === false ? 0 : Math.max(...headLines.map((x) => x.length)) * lh(ST.th) + 2 * padY + 0.6;
    const drawHead = (cont) => {
      const R = B.R;
      if (cont && spec.title) { R.text(0, B.y + 3, `${B.t(spec.title)} (${B.t(S.continued)})`, ST.small, 'start'); B.y += 5; }
      R.hline(B.y, 0, W, 0.45, 'ink');
      if (spec.head === false) return;
      cols.forEach((c, i) => headLines[i].forEach((line, j) => {
        const al = c.align || 'start', u = al === 'end' ? us[i] + widths[i] - padX : al === 'center' ? us[i] + widths[i] / 2 : us[i] + padX;
        R.text(u, B.y + padY + ST.th.size * PT * 0.85 + j * lh(ST.th), line, ST.th, al, { maxWidth: widths[i] - 2 * padX });
      }));
      B.y += headH;
      R.hline(B.y, 0, W, 0.2, 'ink');
    };
    const layoutRow = (row) => {
      if (row.kind === 'group') {
        const lines = wrap(B.t(row.cells.label), W - 2 * padX, ST.tdb.size, ST.tdb.font);
        return { lines, h: lines.length * l + 2 * padY + 1.2 };
      }
      const cells = cols.map((c, i) => {
        const v = row.cells[c.key];
        if (v && typeof v === 'object' && v.edges) return { mark: v, lines: v.label ? [B.t(v.label)] : [] };
        const cst = row.kind === 'total' ? ST.tdb : c.st || st;
        return { lines: v == null || v === '' ? [] : wrap(B.t(v), widths[i] - 2 * padX, cst.size, cst.font), st: cst };
      });
      const h = Math.max(spec.rowMin || 0, row.h || 0, l + 2 * padY, ...cells.map((c) => c.lines.length * l + 2 * padY));
      return { cells, h };
    };
    if (!B.page || B.page.kind !== 'text') B.textPage();
    const first = spec.rows.length ? layoutRow(spec.rows[0]) : { h: 0 };
    if (B.y + headH + first.h > TP.bottom) B.textPage();
    drawHead(false);
    let tableTop = B.y - headH;
    const closeGrid = () => {
      if (!spec.grid) return;
      const R = B.R;
      for (let i = 1; i < cols.length; i++) R.line(us[i], tableTop, us[i], B.y, { lw: 0.1, color: 'rule' });
    };
    spec.rows.forEach((row, ri) => {
      const L = layoutRow(row);
      if (B.y + L.h > TP.bottom) {
        closeGrid();
        B.R.hline(B.y, 0, W, 0.3, 'ink');
        B.textPage(); drawHead(true); tableTop = B.y - headH;
      }
      const R = B.R, y0 = B.y;
      if (row.kind === 'group') {
        R.rect(0, y0, W, L.h, { fill: 'tint' });
        L.lines.forEach((line, j) => R.text(padX, y0 + padY + 0.9 + st.size * PT * 0.85 + j * l, line, ST.tdb, 'start', { maxWidth: W - 2 * padX }));
      } else {
        if (row.kind === 'total') R.rect(0, y0, W, L.h, { fill: 'tint' });
        (row.na || []).forEach((key) => { const i = cols.findIndex((c) => c.key === key); if (i >= 0) R.rect(us[i], y0, widths[i], L.h, { fill: 'tint' }); });
        L.cells.forEach((c, i) => {
          const col = cols[i], al = col.align || 'start';
          const u = al === 'end' ? us[i] + widths[i] - padX : al === 'center' ? us[i] + widths[i] / 2 : us[i] + padX;
          if (c.mark) { edgeMark(R, us[i] + padX, y0 + padY + 0.4, c.mark.edges); if (c.lines[0]) R.text(us[i] + padX + 9.5, y0 + padY + st.size * PT * 0.85, c.lines[0], ST.small, 'start'); return; }
          c.lines.forEach((line, j) => R.text(u, y0 + padY + c.st.size * PT * 0.85 + j * l, line, c.st, al, { maxWidth: widths[i] - 2 * padX }));
        });
      }
      B.y += L.h;
      drawn++;
      if (ri < spec.rows.length - 1) R.hline(B.y, 0, W, 0.1, 'hair');
    });
    closeGrid();
    B.R.hline(B.y, 0, W, 0.3, 'ink');
    B.y += 4;
    B.tables.push({ id: spec.id || `table-${B.tables.length + 1}`, rows: spec.rows.length, drawn });
  }

  /** Label / value rows (no header), used for specifications and terms. */
  keyValues(rows, { labelW = 0.28, id } = {}) {
    this.table({ id, head: false, cols: [{ key: 'k', title: '', w: labelW, st: ST.tdb }, { key: 'v', title: '', w: 1 - labelW }], rows: rows.map(([k, v]) => ({ cells: { k, v } })) });
  }
}

/** Edge-banding mark: a small panel outline whose banded edges are drawn heavy (top / bottom = long, sides = short). */
export function edgeMark(R, u, y, edges) {
  const w = 8, h = 3.6;
  R.rect(u, y, w, h, { lw: 0.12, color: 'rule' });
  const L = edges.long || 0, Sh = edges.short || 0, heavy = { lw: 0.55, color: 'ink' };
  if (L >= 1) R.line(u, y + h, u + w, y + h, heavy);
  if (L >= 2) R.line(u, y, u + w, y, heavy);
  if (Sh >= 1) R.line(u, y, u, y + h, heavy);
  if (Sh >= 2) R.line(u + w, y, u + w, y + h, heavy);
}

/** Header and footer of a text page (filled in once the page count is known). */
export function textFurniture(B, page, n, N) {
  const R = region(page, TP.x0, TP.x1, B.dir), p = B.project;
  const y = 15.5;
  R.text(0, y, ellipsize(`${p.title}  ·  ${B.t(S.rfqFull)}`, 120, ST.furn.size, ST.furn.font), ST.furn, 'start');
  R.text(R.W, y, `${p.reference}  ·  ${p.dateText}`, ST.furn, 'end');
  R.hline(y + 2.2, 0, R.W, 0.12, 'rule');
  const fy = TP.H - 13;
  R.hline(fy - 4.6, 0, R.W, 0.12, 'rule');
  R.text(0, fy, B.t(S.dimsNote), ST.furn, 'start', { maxWidth: R.W - 30 });
  R.text(R.W, fy, `${B.t(S.page)} ${n} / ${N}`, { ...ST.furn, font: 'medium', color: 'ink2' }, 'end');
}

export { textWidth };
