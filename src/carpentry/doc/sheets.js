/**
 * Drawing sheets: packs a run's shop drawings onto landscape sheets (A4 / A3) at standard scales, draws the frame,
 * view captions, north arrows and the title block (key plan, project, run, drawings, scale, reference, sheet n / N).
 */
import { flattenDrawing, textOp, r2 } from './prims.js';
import { region, ST } from './kit.js';
import { ellipsize, textWidth } from './metrics.js';
import { textBox } from '../drawings.js';
import { S, tr } from './strings.js';
import { keyPlanOps, northArrow } from './keyplan.js';

const SCALES = [10, 20, 25, 50, 100];
const CAP = 8;          // caption band under a view (mm)
const GAP_X = 14, GAP_Y = 9;
const ORDER = { plan: 0, elevation: 1, internal: 2, section: 3, worktop: 4 };

/** Geometry of a landscape sheet. */
export function sheetGeometry(size) {
  const [W, H] = size, a3 = W > 300, m = a3 ? 10 : 8, tb = a3 ? 26 : 23, head = 6.5;
  return { W, H, m, tb, head, area: { x: m + 5, y: m + head + 3.5, w: W - 2 * m - 10, h: H - 2 * m - head - tb - 6.5 } };
}

/** Finest standard scale (never finer than the engine's own) at which a drawing + caption fits an area. */
export function fitScale(d, aw, ah) {
  for (const s of SCALES) if (s >= d.scale && (d.bounds.w * 10) / s <= aw && (d.bounds.h * 10) / s + CAP <= ah) return s;
  return Math.max(100, Math.ceil(Math.max((d.bounds.w * 10) / aw, (d.bounds.h * 10) / (ah - CAP)) / 10) * 10);
}

/** Rows layout of items { w, h } in an area; null if it does not fit. */
function arrange(items, aw, ah) {
  const rows = [];
  let cur = null;
  for (const it of items) {
    if (cur && cur.w + GAP_X + it.w <= aw) { cur.items.push(it); cur.w += GAP_X + it.w; cur.h = Math.max(cur.h, it.h + CAP); }
    else { if (it.w > aw) return null; cur = { items: [it], w: it.w, h: it.h + CAP }; rows.push(cur); }
  }
  const h = rows.reduce((s, r) => s + r.h, 0) + GAP_Y * (rows.length - 1);
  return h <= ah ? { rows, h } : null;
}

/** Group a run's drawings into sheets: [{ items: [{ d, S, w, h }], layout }]. */
export function packDrawings(drawings, area) {
  const list = drawings.map(withoutLegendOps).sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9)).map((d) => {
    const s = fitScale(d, area.w, area.h);
    return { d, S: s, w: (d.bounds.w * 10) / s, h: (d.bounds.h * 10) / s };
  });
  const sheets = [];
  let cur = [];
  const alone = (x) => x.d.kind === 'internal' || x.d.bespoke || x.d.kind === 'bespoke';   // internal / bespoke views get their own sheet
  for (const it of list) {
    if (cur.length && !alone(it) && !cur.some(alone) && arrange([...cur, it], area.w, area.h)) cur.push(it);
    else { if (cur.length) sheets.push(cur); cur = [it]; }
  }
  if (cur.length) sheets.push(cur);
  return sheets.map((items) => ({ items, layout: arrange(items, area.w, area.h) || { rows: items.map((it) => ({ items: [it], w: it.w, h: it.h + CAP })), h: area.h } }));
}

/**
 * The legend is printed once, compactly on the view caption (from `drawing.legend`); the engine's own `role: 'legend'`
 * text ops are dropped and the bounds recomputed so they do not cost drawing scale.
 */
function withoutLegendOps(d) {
  if (!d.ops.some((o) => o.role === 'legend') || !Array.isArray(d.legend)) return d;
  const ops = d.ops.filter((o) => o.role !== 'legend');
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const o of ops) {
    if (o.t === 'line') { add(o.x1, o.y1); add(o.x2, o.y2); } else if (o.t === 'rect') { add(o.x, o.y); add(o.x + o.w, o.y + o.h); }
    else if (o.t === 'poly') o.pts.forEach(([x, y]) => add(x, y)); else if (o.t === 'arc') { add(o.cx - o.r, o.cy - o.r); add(o.cx + o.r, o.cy + o.r); }
    else if (o.t === 'text') { const b = textBox(o, d.scale); add(b.x0, b.y0); add(b.x1, b.y1); }
  }
  const m = (d.scale / 10) * 3;
  return { ...d, ops, bounds: { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m } };
}

/** Page vector of true north in a run's PLAN drawing (x along the run, wall at the top). */
function northInPlan(run, plan) {
  const nA = (((plan.meta && plan.meta.northAngle) || 0) * Math.PI) / 180, N = [Math.sin(nA), -Math.cos(nA)];
  const a = (run.anchor.dir * Math.PI) / 180, along = [Math.cos(a), Math.sin(a)], front = [-Math.sin(a), Math.cos(a)];
  const right = N[0] * along[0] + N[1] * along[1], up = -(N[0] * front[0] + N[1] * front[1]);
  return [right, -up];
}

/**
 * Draw one sheet. ctx = { B, run, roomName, plan, items, runs, sheetCode, views: [{ d, S, w, h, num }], layout }.
 * Returns the page; sheet / page numbers are filled in by B.later.
 */
export function drawSheet(ctx) {
  const { B, run, plan } = ctx, page = B.sheetPage({ runId: run.id, sheetCode: ctx.sheetCode });
  const G = sheetGeometry(page.size), { W, H, m, tb, head } = G, dir = B.dir, lang = B.lang;
  page.ops.push({ t: 'rect', x: m, y: m, w: W - 2 * m, h: H - 2 * m, lw: 0.35, color: 'ink', role: 'frame' });
  // header strip
  const Rh = region(page, m + 4, W - m - 4, dir), hy = m + head - 2.2;
  Rh.text(0, hy, `${run.code}  ·  ${tr({ en: run.name, he: run.nameHe || run.name }, lang)}`, { ...ST.furn, font: 'medium', color: 'ink' }, 'start');
  Rh.text(Rh.W, hy, `${B.project.title}  ·  ${B.t(S.rfqFull)}`, ST.furn, 'end');
  page.ops.push({ t: 'line', x1: m, y1: m + head, x2: W - m, y2: m + head, lw: 0.12, color: 'rule' });
  // views
  const A = G.area, L = ctx.layout;
  let y = A.y + (A.h - L.h) / 2;
  const alignX = L.rows.length > 1 && L.rows.every((r) => r.items.length === 1) && run.kind !== 'island'
    && new Set(L.rows.map((r) => r.items[0].S)).size === 1 && L.rows.every((r) => ['plan', 'elevation', 'internal', 'worktop'].includes(r.items[0].d.kind));
  let lefts = null;
  if (alignX) {                                    // stack plan / elevations on a common x = 0 (run's left end)
    const lx = L.rows.map((r) => ((0 - r.items[0].d.bounds.x) * 10) / r.items[0].S), Amax = Math.max(...lx);
    const span = Math.max(...L.rows.map((r, i) => Amax - lx[i] + r.items[0].w));
    if (span <= A.w) lefts = L.rows.map((r, i) => A.x + (A.w - span) / 2 + Amax - lx[i]);
  }
  L.rows.forEach((row, ri) => {
    let x = A.x + (A.w - row.w) / 2;
    for (const it of row.items) {
      const left = lefts ? lefts[ri] : x, top = y + (row.h - CAP - it.h);
      const fl = flattenDrawing(it.d, { lang, scale: it.S, box: [left, top, it.w, it.h] });
      page.ops.push({ t: 'drawing', id: it.d.id, kind: it.d.kind, runId: it.d.runId, scale: it.S, box: [r2(left), r2(top), r2(it.w), r2(it.h)], ops: fl.ops });
      caption(page, dir, lang, left, top + it.h + 2.2, Math.max(it.w, 62), it);
      if (it.d.kind === 'plan') { const [vx, vy] = northInPlan(run, plan); page.ops.push(...northArrow(left + it.w - 4, top + 5, 7, vx, vy, lang)); }
      x += it.w + GAP_X;
    }
    y += row.h + GAP_Y;
  });
  titleBlock(page, G, ctx);
  return page;
}

/** View caption: numbered circle, title, scale, rule. */
function caption(page, dir, lang, x, y, w, it) {
  const R = region(page, x, x + w, dir);
  const title = tr(it.d.title, lang), st = { size: 7.6, font: 'medium', color: 'ink' };
  R.line(0, y + 4.6, w, y + 4.6, { lw: 0.3, color: 'ink' });
  page.ops.push({ t: 'arc', cx: r2(R.X(2.4)), cy: r2(y + 2.1), r: 2.3, a0: 0, a1: 360, lw: 0.25, color: 'ink' });
  page.ops.push(textOp(R.X(2.4), y + 2.1 + 0.85, String(it.num), { size: 6.2, font: 'medium', color: 'ink', align: 'center', dir: 'ltr' }));
  R.text(6.4, y + 3.3, ellipsize(title, w - 22, st.size, st.font), st, 'start');
  const scaleW = R.text(w, y + 3.3, `${tr(S.scale, lang)} 1:${it.S}`, { size: 6.6, font: 'regular', color: 'grey' }, 'end');
  const legend = (Array.isArray(it.d.legend) ? it.d.legend : []).map((e) => `${e.key || ''} ${tr(e.label || '', lang)}`.trim()).filter(Boolean).join('   ');
  const free = w - scaleW - 6 - (6.4 + Math.min(w - 22, textWidth(title, st.size, st.font)) + 8);
  if (legend && free > 20) R.text(w - scaleW - 6, y + 3.3, ellipsize(legend, free, 6.2, 'regular'), { size: 6.2, font: 'regular', color: 'ink2' }, 'end', { role: 'legend' });
}

/** Title block along the bottom of the sheet. */
function titleBlock(page, G, ctx) {
  const { B, run, roomName } = ctx, { W, H, m, tb } = G, dir = B.dir, lang = B.lang, p = B.project;
  const y0 = H - m - tb, R = region(page, m, W - m, dir), w = R.W;
  page.ops.push({ t: 'line', x1: m, y1: y0, x2: W - m, y2: y0, lw: 0.35, color: 'ink' });
  // top band: dimension note + status
  const band = 4.6;
  R.rect(0, y0, w, band, { fill: 'tint' });
  R.text(3, y0 + 3.2, B.t(S.dimsNote), { size: 6.4, font: 'medium', color: 'ink2' }, 'start');
  R.text(w - 3, y0 + 3.2, B.t(S.forTender), { size: 6.2, font: 'medium', color: 'accent' }, 'end');
  page.ops.push({ t: 'line', x1: m, y1: y0 + band, x2: W - m, y2: y0 + band, lw: 0.12, color: 'rule' });
  const cy = y0 + band, ch = tb - band;
  const kpW = ch * 1.15, cells = [
    { w: kpW, key: 'kp' }, { w: 0.2, key: 'project' }, { w: 0.24, key: 'run' }, { w: 0.3, key: 'views' }, { w: 0.13, key: 'ref' }, { w: 26, key: 'sheet' },
  ];
  const fixed = kpW + 26, rest = w - fixed, frac = cells.filter((c) => c.w < 1).reduce((s, c) => s + c.w, 0);
  let u = 0;
  const lab = { size: 5.6, font: 'regular', color: 'grey' }, val = { size: 7.6, font: 'medium', color: 'ink' }, sub = { size: 6.4, font: 'regular', color: 'ink2' };
  for (const c of cells) {
    const cw = c.w < 1 ? (c.w / frac) * rest : c.w;
    if (u > 0) R.line(u, cy, u, y0 + tb, { lw: 0.12, color: 'rule' });
    const pad = 2.6, iw = cw - 2 * pad;
    const L1 = (s, yy, st) => R.text(u + pad, yy, ellipsize(s, iw, st.size, st.font), st, 'start');
    if (c.key === 'kp') {
      const box = [R.X(u + 1.2, cw - 2.4), cy + 1.2, cw - 2.4, ch - 2.4];
      page.ops.push(...keyPlanOps({ plan: ctx.plan, items: ctx.items, runs: ctx.runs, box, highlight: run.id, labels: false, rooms: true, lang, north: false }).ops);
    } else if (c.key === 'project') {
      L1(B.t(S.project), cy + 4, lab); L1(p.title, cy + 8.6, val); L1(p.address || '', cy + 12.6, sub);
      if (p.ownerName) L1(`${B.t(S.client)}: ${p.ownerName}`, cy + 16.4, sub);
    } else if (c.key === 'run') {
      L1(B.t(S.run), cy + 4, lab); L1(`${run.code} — ${tr({ en: run.name, he: run.nameHe || run.name }, lang)}`, cy + 8.6, val);
      L1(`${B.t(S.room)}: ${roomName}`, cy + 12.6, sub);
      L1(`${tr(ctx.kindLabel, lang)} · ${B.t(S.lengthLabel)} ${run.length} ${lang === 'he' ? 'ס״מ' : 'cm'}`, cy + 16.4, sub);
    } else if (c.key === 'views') {
      L1(B.t(S.drawings), cy + 4, lab);
      ctx.views.slice(0, 3).forEach((v, i) => L1(`${v.num}  ${tr(v.d.title, lang)}  ·  1:${v.S}`, cy + 8.6 + i * 3.9, i === 0 ? { ...sub, color: 'ink' } : sub));
    } else if (c.key === 'ref') {
      L1(B.t(S.reference), cy + 4, lab); L1(p.reference, cy + 8.6, { ...val, size: 7 });
      L1(`${B.t(S.date)}: ${p.dateText}`, cy + 12.6, sub); L1(`${B.t(S.paper)}: ${B.paper} · ${B.t(S.revision)} 0`, cy + 16.4, sub);
    } else if (c.key === 'sheet') {
      const uu = u;
      L1(B.t(S.sheet), cy + 4, lab);
      R.text(uu + cw / 2, cy + 11.2, ctx.sheetCode, { size: 11, font: 'medium', color: 'ink' }, 'center');
      B.later.push((n, N) => R.text(uu + cw / 2, cy + 16.6, `${B.t(S.page)} ${n(page)} / ${N}`, sub, 'center'));
    }
    u += cw;
  }
}

