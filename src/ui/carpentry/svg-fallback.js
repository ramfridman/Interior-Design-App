/**
 * Minimal on-screen renderer for carpentry drawings (docs/CONTRACT.md § 8, "Drawings"), with the same signature as
 * `src/carpentry/doc/svg.js`:
 *
 *   drawingToSVG(drawing, { lang: 'en', interactive: true, className }) → string (SVG markup)
 *
 * Used only while the shared renderer is not available (workbench.js switches automatically). The SVG viewBox is the
 * drawing's `bounds` in real cm with y flipped once (y up in the drawing → −y in SVG). Line weights and text sizes are
 * paper mm, so on screen they are converted with cm = mm × scale / 10. Every op carries `class="op op-<role>"`, unit
 * ops `data-unit-id`; semantic fills become `fill-<token>` classes (styled in carpentry.css).
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);

/**
 * @param {object} drawing  a Drawing from Carp.drawings()
 * @param {{ lang?: 'en'|'he', interactive?: boolean, className?: string }} [opts]
 * @returns {string}
 */
export function drawingToSVG(drawing, opts = {}) {
  if (!drawing || !drawing.bounds) return '';
  const lang = opts.lang === 'he' ? 'he' : 'en';
  const b = drawing.bounds, k = (drawing.scale || 20) / 10;           // cm per paper mm
  const id = `cd${Math.random().toString(36).slice(2, 8)}`;
  const Y = (y) => n(-y);
  const sw = (lw) => n((lw || 0.18) * k);
  const DASH = { dash: [3, 1.5], dot: [0.3, 1.2], center: [6, 1.5, 0.8, 1.5] };
  const dash = (d) => (d && DASH[d] ? ` stroke-dasharray="${DASH[d].map((v) => n(v * k)).join(' ')}"` : '');
  const cls = (o, extra = '') => `op op-${o.role || 'line'}${o.fill ? ` fill-${o.fill}` : ''}${o.hatch ? ` hatch-${o.hatch}` : ''}${extra}`;
  const uid = (o) => (o.unitId ? ` data-unit-id="${esc(o.unitId)}"` : '') + (o.featureId ? ` data-feature-id="${esc(o.featureId)}"` : '');
  const fill = (o) => (o.hatch ? ` fill="url(#${id}-hatch)"` : '');
  const out = [];
  for (const o of drawing.ops || []) {
    if (o.t === 'line') out.push(`<line class="${cls(o)}"${uid(o)} x1="${n(o.x1)}" y1="${Y(o.y1)}" x2="${n(o.x2)}" y2="${Y(o.y2)}" stroke-width="${sw(o.lw)}"${dash(o.dash)}/>`);
    else if (o.t === 'rect') out.push(`<rect class="${cls(o)}"${uid(o)} x="${n(o.x)}" y="${Y(o.y + o.h)}" width="${n(Math.max(0, o.w))}" height="${n(Math.max(0, o.h))}" stroke-width="${sw(o.lw)}"${dash(o.dash)}${fill(o)}/>`);
    else if (o.t === 'poly') {
      const pts = (o.pts || []).map(([x, y]) => `${n(x)},${Y(y)}`).join(' ');
      out.push(`<${o.close ? 'polygon' : 'polyline'} class="${cls(o)}"${uid(o)} points="${pts}" stroke-width="${sw(o.lw)}"${dash(o.dash)}${fill(o)}/>`);
    } else if (o.t === 'arc') {
      const a0 = (o.a0 * Math.PI) / 180, a1 = (o.a1 * Math.PI) / 180;
      const sweep = (((o.a1 - o.a0) % 360) + 360) % 360 || 360;
      const p = (a) => `${n(o.cx + o.r * Math.cos(a))} ${Y(o.cy + o.r * Math.sin(a))}`;
      // counter-clockwise in y-up = counter-clockwise on screen once flipped → sweep-flag 0
      out.push(`<path class="${cls(o)}"${uid(o)} d="M${p(a0)} A${n(o.r)} ${n(o.r)} 0 ${sweep > 180 ? 1 : 0} 0 ${p(a1)}" stroke-width="${sw(o.lw)}"${dash(o.dash)}/>`);
    } else if (o.t === 'text') {
      const t = typeof o.text === 'object' && o.text ? (o.text[lang] || o.text.en || '') : o.text;
      const anchor = o.anchor === 'start' ? 'start' : o.anchor === 'end' ? 'end' : 'middle';
      const rot = o.rot ? ` transform="rotate(${n(-o.rot)} ${n(o.x)} ${Y(o.y)})"` : '';
      out.push(`<text class="${cls(o)}"${uid(o)} x="${n(o.x)}" y="${Y(o.y)}" font-size="${n(o.size * k)}" text-anchor="${anchor}" dominant-baseline="central"${o.weight === 'bold' ? ' font-weight="600"' : ''}${rot}>${esc(t)}</text>`);
    }
  }
  const hatch = `<defs><pattern id="${id}-hatch" patternUnits="userSpaceOnUse" width="${n(2 * k)}" height="${n(2 * k)}" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${n(2 * k)}" class="hatchline" stroke-width="${n(0.13 * k)}"/></pattern></defs>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="cdraw ${esc(opts.className || '')}" viewBox="${n(b.x)} ${n(-(b.y + b.h))} ${n(b.w)} ${n(b.h)}" `
    + `data-kind="${esc(drawing.kind)}" role="img" aria-label="${esc((drawing.title && drawing.title[lang]) || drawing.kind)}" preserveAspectRatio="xMidYMid meet">${hatch}${out.join('')}</svg>`;
}

export default drawingToSVG;
