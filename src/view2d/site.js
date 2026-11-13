/**
 * Site layer: street, garden ground, parking bays, entry path, property line with side lengths, building line,
 * setbacks and survey features. Everything is derived from `plan.site`.
 */
import { fmtLen, polygonBounds } from '../core/geometry.js';
import { css } from './color.js';

const OUT = { e: [1, 0], w: [-1, 0], n: [0, -1], s: [0, 1] };
const STREET_WIDTH = 600, STREET_OVERRUN = 500;

/** The boundary edge that faces the given side (largest midpoint projection on the outward direction). */
export function boundaryEdge(boundary, side) {
  const [ox, oy] = OUT[side] || OUT.e;
  let best = null, bestP = -Infinity;
  boundary.forEach((a, i) => {
    const b = boundary[(i + 1) % boundary.length];
    const p = ((a[0] + b[0]) / 2) * ox + ((a[1] + b[1]) / 2) * oy;
    if (p > bestP) { bestP = p; best = [a, b]; }
  });
  return best;
}

/** Street strip polygon just outside the lot on `site.street.side`. */
export function streetPolygon(site) {
  const side = site.street?.side;
  if (!side || !OUT[side]) return null;
  const [a, b] = boundaryEdge(site.boundary, side);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const [ox, oy] = OUT[side];
  const p1 = [a[0] - ux * STREET_OVERRUN, a[1] - uy * STREET_OVERRUN], p2 = [b[0] + ux * STREET_OVERRUN, b[1] + uy * STREET_OVERRUN];
  return { poly: [p1, p2, [p2[0] + ox * STREET_WIDTH, p2[1] + oy * STREET_WIDTH], [p1[0] + ox * STREET_WIDTH, p1[1] + oy * STREET_WIDTH]], a, b, out: [ox, oy], u: [ux, uy] };
}

/** Text angle that keeps a label upright along a direction. */
const upright = (ux, uy) => { let a = Math.atan2(uy, ux); if (a > Math.PI / 2 + 1e-6) a -= Math.PI; if (a <= -Math.PI / 2 - 1e-6) a += Math.PI; return a; };

function hatch(G, rect, spacing, color) {
  const { ctx } = G;
  const x0 = G.RX(rect.x), y0 = G.RY(rect.y), x1 = G.RX(rect.x + rect.w), y1 = G.RY(rect.y + rect.h);
  const step = Math.max(5 * G.dpr, spacing * G.k);
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
  ctx.beginPath();
  const span = (x1 - x0) + (y1 - y0);
  for (let t = step / 2; t < span; t += step) {
    ctx.moveTo(x0 + t, y0); ctx.lineTo(x0 + t - (y1 - y0), y1);
    ctx.moveTo(x0 + t - (y1 - y0), y0); ctx.lineTo(x0 + t, y1);
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

/** Ground: street, garden, paths, parking (below everything else). */
export function drawSiteGround(G, env) {
  const { plan, pal } = env, { ctx } = G, site = plan.site;
  const st = streetPolygon(site);
  if (st) {
    G.poly(st.poly); ctx.fillStyle = pal.street; ctx.fill();
    // centre line + label
    const mid = [(st.a[0] + st.b[0]) / 2 + st.out[0] * STREET_WIDTH / 2, (st.a[1] + st.b[1]) / 2 + st.out[1] * STREET_WIDTH / 2];
    const half = Math.hypot(st.b[0] - st.a[0], st.b[1] - st.a[1]) / 2 + STREET_OVERRUN;
    ctx.beginPath();
    ctx.moveTo(G.X(mid[0] - st.u[0] * half), G.Y(mid[1] - st.u[1] * half));
    ctx.lineTo(G.X(mid[0] + st.u[0] * half), G.Y(mid[1] + st.u[1] * half));
    ctx.setLineDash([14 * G.dpr, 12 * G.dpr]); ctx.strokeStyle = pal.pavingLine; ctx.lineWidth = G.px(1); ctx.stroke(); ctx.setLineDash([]);
    if (STREET_WIDTH * G.scale > 60) {
      // the name sits beside the longer stretch of street past the house, clear of the house's dimension chains
      const hb = plan.bounds, ts = [[hb.x, hb.y], [hb.x + hb.w, hb.y], [hb.x + hb.w, hb.y + hb.h], [hb.x, hb.y + hb.h]]
        .map(([x, y]) => (x - st.a[0]) * st.u[0] + (y - st.a[1]) * st.u[1]);
      const len = Math.hypot(st.b[0] - st.a[0], st.b[1] - st.a[1]), t0 = Math.min(...ts), t1 = Math.max(...ts);
      const t = (t0 > len - t1 ? t0 / 2 : len - t1 > 0 ? (t1 + len) / 2 : len / 2) - len / 2;
      G.text('STREET', G.X(mid[0] + st.u[0] * t + st.out[0] * STREET_WIDTH * 0.22), G.Y(mid[1] + st.u[1] * t + st.out[1] * STREET_WIDTH * 0.22),
        { size: 10.5, weight: 600, color: pal.inkFaint, angle: upright(st.u[0], st.u[1]), spacing: 0.22 });
    }
  }
  G.poly(site.boundary); ctx.fillStyle = pal.garden; ctx.fill();

  for (const p of site.paths || []) {
    G.poly(p.polygon); ctx.fillStyle = pal.paving; ctx.fill();
    ctx.strokeStyle = pal.pavingLine; ctx.lineWidth = 1; ctx.stroke();
  }
  for (const [i, bay] of (site.parking || []).entries()) {
    G.box(bay.x, bay.y, bay.x + bay.w, bay.y + bay.h, pal.paving, null);
    if (bay.w * G.scale > 40) hatch(G, bay, 42, css(pal.pavingLine, pal.dark ? 0.35 : 0.5));
    G.box(bay.x, bay.y, bay.x + bay.w, bay.y + bay.h, null, pal.inkSoft, 1);
    if (bay.h * G.scale > 34) {
      const label = `P${i + 1}`, size = 10;
      const tw = G.measure(label, size, 700) + 10 * G.dpr, th = 16 * G.dpr;
      const x = G.RX(bay.x) + 6 * G.dpr, y = G.RY(bay.y) + 6 * G.dpr;
      ctx.fillStyle = pal.halo; ctx.fillRect(x, y, tw, th);
      ctx.strokeStyle = pal.inkSoft; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);
      G.text(label, x + tw / 2, y + th / 2 + G.dpr * 0.5, { size, weight: 700, color: pal.inkSoft });
    }
  }
}

/** Lines + labels: property line, building line, setbacks, survey features (above the ground, below the house). */
export function drawSiteLines(G, env) {
  const { plan, pal, ui } = env, { ctx } = G, site = plan.site;
  const centre = polygonBounds(site.boundary);
  const cx = centre.x + centre.w / 2, cy = centre.y + centre.h / 2;

  // building line (red dash-dot)
  if (site.buildingLine?.length) {
    const d = G.dpr;
    ctx.beginPath();
    site.buildingLine.forEach(([x, y], i) => (i ? ctx.lineTo(G.X(x), G.Y(y)) : ctx.moveTo(G.X(x), G.Y(y))));
    ctx.closePath();
    ctx.setLineDash([11 * d, 4 * d, 2 * d, 4 * d]); ctx.strokeStyle = pal.building; ctx.lineWidth = G.px(1.25); ctx.stroke(); ctx.setLineDash([]);
    const [a, b] = [site.buildingLine[0], site.buildingLine[1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    if (len * G.scale > 220) {
      G.text('Building line', G.X(a[0]) + ux * 10 * d, G.Y(a[1]) - 8 * d,
        { size: 9.5, weight: 500, color: pal.building, align: 'left', angle: upright(ux, uy), halo: css(pal.garden, 0.9) });
    }
  }

  // setbacks: a short dimension between the property line and the building line on each side
  if (site.setbacks && site.buildingLine?.length && G.scale > 0.22) {
    for (const side of ['n', 'e', 's', 'w']) {
      const dist = site.setbacks[side];
      if (!dist) continue;
      const [ea, eb] = boundaryEdge(site.buildingLine, side), [pa, pb] = boundaryEdge(site.boundary, side);
      // measure at 30 % along the edge so the figure stays clear of the building-line label and the street
      const t = side === 'n' || side === 's' ? 0.2 : 0.3;
      const p = [ea[0] + (eb[0] - ea[0]) * t, ea[1] + (eb[1] - ea[1]) * t];
      const horiz = side === 'e' || side === 'w';
      // intersection with the property edge along the outward axis
      const q = horiz
        ? [pa[0] + (pb[0] - pa[0]) * ((p[1] - pa[1]) / ((pb[1] - pa[1]) || 1)), p[1]]
        : [p[0], pa[1] + (pb[1] - pa[1]) * ((p[0] - pa[0]) / ((pb[0] - pa[0]) || 1))];
      ctx.beginPath(); ctx.moveTo(G.X(p[0]), G.Y(p[1])); ctx.lineTo(G.X(q[0]), G.Y(q[1]));
      ctx.setLineDash([5 * G.dpr, 3 * G.dpr]); ctx.strokeStyle = css(pal.building, 0.7); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      const mx = (G.X(p[0]) + G.X(q[0])) / 2, my = (G.Y(p[1]) + G.Y(q[1])) / 2;
      const label = fmtLen(dist, ui.units);
      if (horiz) G.text(label, mx, my - 7 * G.dpr, { size: 9.5, color: pal.building, halo: css(pal.garden, 0.9) });
      else G.text(label, mx - 7 * G.dpr, my, { size: 9.5, color: pal.building, angle: -Math.PI / 2, halo: css(pal.garden, 0.9) });
    }
  }

  // property line + corner marks + side lengths
  ctx.beginPath();
  site.boundary.forEach(([x, y], i) => (i ? ctx.lineTo(G.X(x), G.Y(y)) : ctx.moveTo(G.X(x), G.Y(y))));
  ctx.closePath();
  ctx.strokeStyle = pal.property; ctx.lineWidth = G.px(1.75); ctx.lineJoin = 'miter'; ctx.stroke();
  for (const [x, y] of site.boundary) {
    ctx.beginPath(); ctx.arc(G.X(x), G.Y(y), 3.5 * G.dpr, 0, Math.PI * 2);
    ctx.fillStyle = pal.paper; ctx.fill(); ctx.strokeStyle = pal.property; ctx.lineWidth = G.px(1.25); ctx.stroke();
  }
  if (site.lot != null && G.scale > 0.2) {
    const [x, y] = site.boundary[0];
    G.text(`Lot ${site.lot}`, G.X(x) + 12 * G.dpr, G.Y(y) + 16 * G.dpr, { size: 10.5, weight: 600, color: pal.property, align: 'left', halo: css(pal.garden, 0.9) });
  }

  // survey features (e.g. the water connection point)
  for (const f of site.features || []) {
    if (G.scale < 0.25) break;
    const x = G.X(f.x), y = G.Y(f.y), r = 5 * G.dpr;
    const col = f.kind === 'water' ? (pal.dark ? '#5cc0f0' : '#1b86c9') : pal.inkSoft;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = css(col, 0.16); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = G.px(1.25); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - r * 0.55, y); ctx.lineTo(x + r * 0.55, y); ctx.moveTo(x, y - r * 0.55); ctx.lineTo(x, y + r * 0.55); ctx.stroke();
    if (G.scale > 0.42) {
      const label = f.kind === 'water' ? 'Water connection' : (f.name || '');
      const toRight = G.measure(label, 9.5) + x + r + 6 * G.dpr < G.X(polygonBounds(site.boundary).x + polygonBounds(site.boundary).w);
      G.text(label, toRight ? x + r + 5 * G.dpr : x, toRight ? y : y + r + 9 * G.dpr, { size: 9.5, color: col, align: toRight ? 'left' : 'center', halo: css(pal.garden, 0.9) });
    }
  }
}

/** Side lengths of the property line — part of the annotation layer so dimension text can avoid them. */
export function drawSiteLabels(G, env, boxes) {
  const { plan, pal, ui } = env, site = plan.site;
  const bb = polygonBounds(site.boundary);
  const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
  site.boundary.forEach((a, i) => {
    const b = site.boundary[(i + 1) % site.boundary.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len * G.scale < 90) return;
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    let nx = -uy, ny = ux;                                   // outward normal = away from the lot centre
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const label = fmtLen(len, ui.units), size = 10.5;
    const x = G.X(mx) + nx * 11 * G.dpr, y = G.Y(my) + ny * 11 * G.dpr;
    const tw = G.measure(label, size, 600) / 2 + 3 * G.dpr, th = size * G.dpr * 0.7;
    const flat = Math.abs(ux) > Math.abs(uy);
    boxes.add(flat ? { x0: x - tw, x1: x + tw, y0: y - th, y1: y + th } : { x0: x - th, x1: x + th, y0: y - tw, y1: y + tw });
    G.text(label, x, y, { size, weight: 600, color: pal.property, angle: upright(ux, uy), halo: pal.halo });
  });
}
