// A tiny ASCII DXF writer for the import tests (R12 or R2000+ flavour). Not part of the app.
//   const w = dxfWriter({ version: 'AC1015', insunits: 5, codepage: 'ANSI_1252' });
//   w.layer('A-WALL', 7); w.lwpoly([[x, y], …], { layer, closed, bulges }); … const bytes = w.bytes();

const HEB = (s) => { // Unicode → Windows-1255 bytes (ASCII + Hebrew letters only)
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 128) out.push(c); else if (c >= 0x5d0 && c <= 0x5ea) out.push(0xe0 + c - 0x5d0); else out.push(63);
  }
  return out;
};

export function dxfWriter({ version = 'AC1015', insunits = null, measurement = null, codepage = 'ANSI_1252', extmin = null, extmax = null, dimlfac = null, header = true } = {}) {
  const r12 = version === 'AC1009';
  const layers = [], ltypes = [['CONTINUOUS', []], ['DASHED', [0.5, -0.25]]], blocks = [], ents = [];
  let handle = 0x100;
  const H = () => (handle++).toString(16).toUpperCase();
  const f = (v) => (Number.isInteger(v) ? String(v) : (+v.toFixed(9)).toString());
  const common = (o, sub) => {
    const a = [];
    if (!r12) a.push(5, H(), 100, 'AcDbEntity');
    a.push(8, o.layer || '0');
    if (o.color != null) a.push(62, o.color);
    if (o.ltype) a.push(6, o.ltype);
    if (o.lw != null) a.push(370, o.lw);
    if (o.paper) a.push(67, 1);
    if (!r12 && sub) a.push(100, sub);
    return a;
  };
  const ext = (o) => (o.mirrored ? [210, 0, 220, 0, 230, -1] : []);
  const W = {
    layer(name, color = 7, { off = false, frozen = false, ltype = 'CONTINUOUS', lw = null } = {}) { layers.push({ name, color: off ? -color : color, frozen, ltype, lw }); return W; },
    line(a, b, o = {}) { (o.into || ents).push(['LINE', ...common(o, 'AcDbLine'), 10, a[0], 20, a[1], 30, 0, 11, b[0], 21, b[1], 31, 0]); return W; },
    lwpoly(pts, o = {}) {
      if (r12) return W.poly(pts, o);
      const a = ['LWPOLYLINE', ...common(o, 'AcDbPolyline'), 90, pts.length, 70, o.closed ? 1 : 0];
      if (o.width) a.push(43, o.width);
      pts.forEach((p, i) => { a.push(10, p[0], 20, p[1]); if (o.bulges && o.bulges[i]) a.push(42, o.bulges[i]); });
      a.push(...ext(o));
      (o.into || ents).push(a); return W;
    },
    poly(pts, o = {}) { // POLYLINE + VERTEX + SEQEND (R12 style)
      const list = o.into || ents;
      list.push(['POLYLINE', ...common(o, 'AcDb2dPolyline'), 66, 1, 10, 0, 20, 0, 30, 0, 70, o.closed ? 1 : 0]);
      pts.forEach((p, i) => list.push(['VERTEX', ...common(o, 'AcDbVertex'), 10, p[0], 20, p[1], 30, 0, ...(o.bulges && o.bulges[i] ? [42, o.bulges[i]] : [])]));
      list.push(['SEQEND', ...(r12 ? [8, o.layer || '0'] : [5, H(), 100, 'AcDbEntity', 8, o.layer || '0'])]);
      return W;
    },
    arc(c, r, a0, a1, o = {}) { (o.into || ents).push(['ARC', ...common(o, 'AcDbCircle'), 10, c[0], 20, c[1], 30, 0, 40, r, ...(r12 ? [] : [100, 'AcDbArc']), 50, a0, 51, a1, ...ext(o)]); return W; },
    circle(c, r, o = {}) { (o.into || ents).push(['CIRCLE', ...common(o, 'AcDbCircle'), 10, c[0], 20, c[1], 30, 0, 40, r]); return W; },
    text(p, h, s, o = {}) { (o.into || ents).push(['TEXT', ...common(o, 'AcDbText'), 10, p[0], 20, p[1], 30, 0, 40, h, 1, s, ...(o.rot ? [50, o.rot] : [])]); return W; },
    mtext(p, h, s, o = {}) { (o.into || ents).push(['MTEXT', ...common(o, 'AcDbMText'), 10, p[0], 20, p[1], 30, 0, 40, h, 71, o.attach || 1, 1, s]); return W; },
    insert(name, p, o = {}) {
      const a = ['INSERT', ...common(o, 'AcDbBlockReference'), 2, name, 10, p[0], 20, p[1], 30, 0];
      if (o.sx != null) a.push(41, o.sx); if (o.sy != null) a.push(42, o.sy); if (o.rot) a.push(50, o.rot);
      if (o.cols) a.push(70, o.cols); if (o.rows) a.push(71, o.rows); if (o.dc) a.push(44, o.dc); if (o.dr) a.push(45, o.dr);
      a.push(...ext(o));
      (o.into || ents).push(a); return W;
    },
    dim(p1, p2, def, o = {}) { // linear (rotated) dimension, no block: the reader draws the dimension line itself
      const ang = o.angle || 0;
      const meas = o.measured ?? Math.abs((p2[0] - p1[0]) * Math.cos(ang * Math.PI / 180) + (p2[1] - p1[1]) * Math.sin(ang * Math.PI / 180));
      (o.into || ents).push(['DIMENSION', ...common(o, 'AcDbDimension'), 2, o.block || '', 10, def[0], 20, def[1], 30, 0, 11, def[0], 21, def[1], 31, 0, 70, (o.aligned ? 1 : 0) | 32,
        1, o.text ?? '', ...(r12 ? [] : [42, meas, 100, 'AcDbAlignedDimension']), 13, p1[0], 23, p1[1], 33, 0, 14, p2[0], 24, p2[1], 34, 0, ...(o.aligned ? [] : [50, ang])]);
      return W;
    },
    hatch(loop, o = {}) { // one loop [[x, y]…] or several [[[x, y]…], …] (even–odd: holes)
      const loops = Array.isArray(loop[0][0]) ? loop : [loop];
      const a = ['HATCH', ...common(o, 'AcDbHatch'), 10, 0, 20, 0, 30, 0, 210, 0, 220, 0, 230, 1, 2, o.pattern || 'SOLID', 70, o.pattern ? 0 : 1, 71, 0, 91, loops.length];
      loops.forEach((lp, n) => { a.push(92, n ? 2 : 3, 72, 0, 73, 1, 93, lp.length); for (const p of lp) a.push(10, p[0], 20, p[1]); a.push(97, 0); });
      a.push(75, 0, 76, 1, ...(o.pattern ? [52, 45, 41, 1, 77, 0, 78, 1, 53, 45, 43, 0, 44, 0, 45, -3, 46, 3, 79, 0] : []), 98, 0);
      (o.into || ents).push(a); return W;
    },
    solid(q, o = {}) { (o.into || ents).push(['SOLID', ...common(o, 'AcDbTrace'), 10, q[0][0], 20, q[0][1], 30, 0, 11, q[1][0], 21, q[1][1], 31, 0, 12, q[3][0], 22, q[3][1], 32, 0, 13, q[2][0], 23, q[2][1], 33, 0]); return W; },
    raw(entity) { ents.push(entity); return W; },
    block(name, base = [0, 0], fill) { const items = []; blocks.push({ name, base, items }); fill(items); return W; },
    text_() { return build(); },
    bytes() {
      const s = build();
      return codepage === 'ANSI_1255' && version < 'AC1021' ? Uint8Array.from(HEB(s)) : new TextEncoder().encode(s);
    },
  };
  function build() {
    const L = [];
    const P = (...a) => { for (let i = 0; i < a.length; i += 2) L.push(String(a[i]).padStart(3, ' '), typeof a[i + 1] === 'number' ? f(a[i + 1]) : String(a[i + 1])); };
    const ent = (e) => { P(0, e[0]); for (let i = 1; i < e.length; i += 2) P(e[i], e[i + 1]); };
    if (header) {
      P(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, version);
      if (codepage) P(9, '$DWGCODEPAGE', 3, codepage);
      if (insunits != null) P(9, '$INSUNITS', 70, insunits);
      if (measurement != null) P(9, '$MEASUREMENT', 70, measurement);
      if (dimlfac != null) P(9, '$DIMLFAC', 40, dimlfac);
      if (extmin) P(9, '$EXTMIN', 10, extmin[0], 20, extmin[1], 30, 0, 9, '$EXTMAX', 10, extmax[0], 20, extmax[1], 30, 0);
      P(0, 'ENDSEC');
    }
    P(0, 'SECTION', 2, 'TABLES');
    P(0, 'TABLE', 2, 'LTYPE', 70, ltypes.length);
    for (const [name, els] of ltypes) { P(0, 'LTYPE', 2, name, 70, 0, 3, '', 72, 65, 73, els.length, 40, els.reduce((t, e) => t + Math.abs(e), 0)); for (const e of els) P(49, e); }
    P(0, 'ENDTAB', 0, 'TABLE', 2, 'LAYER', 70, layers.length);
    for (const l of layers) { P(0, 'LAYER'); if (!r12) P(5, H(), 100, 'AcDbSymbolTableRecord', 100, 'AcDbLayerTableRecord'); P(2, l.name, 70, l.frozen ? 1 : 0, 62, l.color, 6, l.ltype); if (l.lw != null && !r12) P(370, l.lw); }
    P(0, 'ENDTAB', 0, 'ENDSEC');
    P(0, 'SECTION', 2, 'BLOCKS');
    for (const b of blocks) {
      P(0, 'BLOCK', 8, '0', 2, b.name, 70, 0, 10, b.base[0], 20, b.base[1], 30, 0, 3, b.name);
      for (const e of b.items) ent(e);
      P(0, 'ENDBLK', 8, '0');
    }
    P(0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
    for (const e of ents) ent(e);
    P(0, 'ENDSEC', 0, 'EOF');
    return L.join('\n') + '\n';
  }
  return W;
}

/** Boundary loops of a union of axis-aligned cm rectangles (on a `step` grid) as closed point lists, y as given. */
export function outlineLoops(rects, step = 5) {
  const solid = new Set();
  for (const r of rects) for (let y = r.y; y < r.y + r.h - 1e-6; y += step) for (let x = r.x; x < r.x + r.w - 1e-6; x += step) solid.add(Math.round(x) + ',' + Math.round(y));
  const has = (x, y) => solid.has(x + ',' + y);
  // directed unit edges with the solid on the left (y down: walk clockwise on screen around solid)
  const next = new Map();
  const add = (a, b) => { const k = a.join(','); if (!next.has(k)) next.set(k, []); next.get(k).push(b); };
  for (const c of solid) {
    const [x, y] = c.split(',').map(Number);
    if (!has(x, y - step)) add([x, y], [x + step, y]);
    if (!has(x + step, y)) add([x + step, y], [x + step, y + step]);
    if (!has(x, y + step)) add([x + step, y + step], [x, y + step]);
    if (!has(x - step, y)) add([x, y + step], [x, y]);
  }
  const loops = [];
  for (;;) {
    const k0 = [...next.keys()].find((k) => next.get(k).length);
    if (!k0) break;
    const start = k0.split(',').map(Number);
    const pts = [start];
    let cur = start;
    for (;;) {
      const lst = next.get(cur.join(','));
      if (!lst || !lst.length) break;
      const nx = lst.shift();
      if (nx[0] === start[0] && nx[1] === start[1]) break;
      pts.push(nx); cur = nx;
    }
    // drop collinear points
    const out = pts.filter((p, i) => { const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length]; return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0; });
    loops.push(out);
  }
  return loops;
}
