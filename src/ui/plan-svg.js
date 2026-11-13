/**
 * A small line drawing of the real plan (lot, paved areas, walls) built from PLAN geometry.
 * Used on the loading splash and the welcome sheet — the house itself is the product's signature image.
 */
const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs) => {
  const node = document.createElementNS(NS, name);
  for (const k of Object.keys(attrs)) node.setAttribute(k, String(attrs[k]));
  return node;
};
const points = (poly) => poly.map(([x, y]) => `${x},${y}`).join(' ');

/**
 * @param {object} plan   PLAN from src/core/plan.js
 * @param {{ site?: boolean, pad?: number, label?: string }} [opts]
 * @returns {SVGSVGElement}  styled by the classes .plansvg__lot / __area / __wall / __parking
 */
export function planSvg(plan, opts = {}) {
  const site = opts.site !== false && plan.site && plan.site.bounds;
  const b = site ? plan.site.bounds : plan.bounds;
  const pad = opts.pad ?? 40;
  const svg = el('svg', { viewBox: `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`, class: 'plansvg', role: 'img', 'aria-label': opts.label || 'Plan of the house on its lot' });
  if (site) {
    svg.append(el('polygon', { points: points(plan.site.boundary), class: 'plansvg__lot' }));
    for (const p of plan.site.parking || []) svg.append(el('rect', { x: p.x, y: p.y, width: p.w, height: p.h, class: 'plansvg__parking' }));
    for (const p of plan.site.paths || []) svg.append(el('polygon', { points: points(p.polygon), class: 'plansvg__area' }));
  }
  for (const o of plan.outdoorAreas || []) svg.append(el('polygon', { points: points(o.polygon), class: 'plansvg__area' }));
  const walls = el('g', { class: 'plansvg__wall' });
  for (const w of plan.walls || []) walls.append(el('rect', { x: w.x, y: w.y, width: w.w, height: w.h }));
  svg.append(walls);
  return svg;
}
