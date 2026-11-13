/**
 * Plan palette. Reads CSS custom properties from the view container (so the UI theme can restyle the drawing),
 * falls back to the app tokens (--accent, --fail …) and finally to built-in light / dark palettes.
 *
 *   --plan-paper  --plan-ink  --plan-wall  --plan-accent  --plan-guide  --plan-danger  --plan-garden
 *   --plan-street --plan-property  --plan-building  --plan-dim  --plan-glass  --plan-font
 *   --plan-warn  --plan-permit            (structure editing: "ask an engineer" amber, "needs a permit" violet)
 *   --plan-inset-top|right|bottom|left   (px kept clear of floating UI: used by fit() and the scale bar / north arrow)
 *   --plan-hud: off                       (hide the built-in scale bar + north arrow, e.g. when the UI shows its own)
 */
import { parseColor, mix, css, luminance } from './color.js';

const LIGHT = {
  paper: '#f4f2ed', ink: '#22262b', wall: '#2e3237', accent: '#1d4e89', guide: '#d6248a', danger: '#c9362b',
  garden: '#e3e8d8', street: '#dcdad5', property: '#2b5cc4', building: '#cf3f3a', dim: '#59616b', glass: '#b9d6e6',
  warn: '#cf7f00', permit: '#7a4fd6',
};
const DARK = {
  paper: '#131517', ink: '#ebe8e2', wall: '#e4e0d7', accent: '#8dbbee', guide: '#ff6dc0', danger: '#ff6f61',
  garden: '#1a211b', street: '#202327', property: '#7ea6ff', building: '#ff7a6e', dim: '#a2a8b0', glass: '#4f7f9c',
  warn: '#f0b354', permit: '#b79cff',
};
const VARS = {
  paper: ['--plan-paper'], ink: ['--plan-ink'], wall: ['--plan-wall'], accent: ['--plan-accent', '--accent'],
  guide: ['--plan-guide'], danger: ['--plan-danger', '--fail'], garden: ['--plan-garden'], street: ['--plan-street'],
  property: ['--plan-property'], building: ['--plan-building'], dim: ['--plan-dim'], glass: ['--plan-glass'],
  warn: ['--plan-warn'], permit: ['--plan-permit'],
};

function detectDark(container, cs) {
  const paper = cs.getPropertyValue('--plan-paper').trim();
  if (paper) return luminance(parseColor(paper)) < 0.42;
  const scheme = (cs.colorScheme || '').trim();
  if (scheme === 'dark' || scheme === 'light') return scheme === 'dark';
  const forced = document.documentElement.dataset.theme;
  if (forced === 'dark' || forced === 'light') return forced === 'dark';
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Build the full palette (CSS colour strings + a few helpers) from base colours. */
export function buildPalette(base, dark) {
  const p = { ...base, dark };
  const m = (a, b, t, alpha) => css(mix(a, b, t), alpha);
  p.white = dark ? m(base.paper, '#ffffff', 0.06) : '#ffffff';
  p.inkSoft = m(base.ink, base.paper, 0.38);
  p.inkFaint = m(base.ink, base.paper, 0.62);
  p.hair = m(base.ink, base.paper, 0.78);
  p.wallInterior = m(base.wall, base.paper, dark ? 0.2 : 0.16);
  p.wallMamad = m(base.wall, base.paper, dark ? 0.52 : 0.46);
  p.wallLine = dark ? m(base.wall, '#ffffff', 0.5) : m(base.wall, '#000000', 0.45);
  p.wallHatch = dark ? m(base.wall, base.paper, 0.05) : m(base.wall, '#000000', 0.2);
  p.opening = dark ? m(base.paper, '#ffffff', 0.09) : m(base.paper, '#ffffff', 0.75);
  p.frame = dark ? m(base.ink, base.paper, 0.1) : m(base.ink, base.paper, 0.05);
  p.paving = dark ? m(base.street, '#ffffff', 0.07) : m(base.street, base.paper, 0.35);
  p.pavingLine = m(base.ink, base.street, 0.72);
  p.gardenLine = m(base.garden, base.ink, 0.18);
  p.handle = dark ? '#16181b' : '#ffffff';
  p.accentSoft = css(base.accent, 0.1);
  p.onAccent = luminance(base.accent) > 0.6 ? '#101418' : '#ffffff';
  p.halo = css(base.paper, 0.86);
  p.shadow = dark ? 'rgba(0,0,0,' : 'rgba(30,26,20,';
  p.shadowAlpha = dark ? 0.3 : 0.085;
  // structure editing: one colour per policy level (free / warn / permit / locked) …
  p.locked = m(base.ink, base.paper, 0.5);
  p.level = { free: base.accent, warn: base.warn, permit: base.permit, locked: p.locked };
  // … and the wall poché tinted with it (locked walls recede to a neutral grey)
  p.wallTint = {
    free: dark ? m(base.accent, base.paper, 0.12) : m(base.accent, '#ffffff', 0.2),
    warn: dark ? m(base.warn, base.paper, 0.1) : m(base.warn, '#ffffff', 0.08),
    locked: m(base.wall, base.paper, dark ? 0.62 : 0.6),
  };
  // ghosts of removed architect's walls ("show plan changes"): must read clearly on both papers
  p.removedFill = css(base.ink, dark ? 0.14 : 0.07);
  p.removedHatch = css(base.ink, dark ? 0.42 : 0.28);
  p.removedLine = css(base.ink, dark ? 0.85 : 0.6);
  p.wallNew = dark ? m(base.accent, '#ffffff', 0.1) : m(base.accent, '#ffffff', 0.32);
  /** Room floor tint from a finish colour. */
  p.floor = (hex) => (dark ? m(hex || '#cccccc', base.paper, 0.74) : m(hex || '#dddddd', '#ffffff', 0.52));
  p.floorLine = (hex) => (dark ? m(m(hex || '#cccccc', base.paper, 0.74), '#ffffff', 0.16) : m(m(hex || '#dddddd', '#ffffff', 0.52), base.ink, 0.2));
  return p;
}

/** Fixed palette used for PNG export: light, on pure white paper. */
export const exportPalette = () => buildPalette({ ...LIGHT, paper: '#ffffff' }, false);

/**
 * Live theme bound to a container element.
 * @returns {{ palette: object, font: string, insets: {top:number,right:number,bottom:number,left:number}, refresh(): void, destroy(): void }}
 */
export function createTheme(container, onChange) {
  const theme = { palette: null, font: 'system-ui, sans-serif', insets: { top: 0, right: 0, bottom: 0, left: 0 }, hud: true, version: 0 };
  let signature = '';

  theme.refresh = () => {
    const cs = getComputedStyle(container);
    const dark = detectDark(container, cs);
    const base = { ...(dark ? DARK : LIGHT) };
    for (const [key, names] of Object.entries(VARS)) {
      for (const n of names) {
        const v = cs.getPropertyValue(n).trim();
        if (v) { base[key] = css(parseColor(v, base[key])); break; }
      }
    }
    const font = cs.getPropertyValue('--plan-font').trim() || cs.fontFamily || 'system-ui, sans-serif';
    const inset = (side) => parseFloat(cs.getPropertyValue(`--plan-inset-${side}`)) || 0;
    const insets = { top: inset('top'), right: inset('right'), bottom: inset('bottom'), left: inset('left') };
    const hud = cs.getPropertyValue('--plan-hud').trim() !== 'off';
    const sig = JSON.stringify([dark, base, font, insets, hud]);
    if (sig === signature) return;
    signature = sig;
    theme.palette = buildPalette(base, dark);
    theme.font = font;
    theme.insets = insets;
    theme.hud = hud;
    theme.version++;
    if (onChange) onChange(theme);
  };

  const mo = new MutationObserver(theme.refresh);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  mo.observe(container, { attributes: true, attributeFilter: ['class', 'style'] });
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  mq?.addEventListener?.('change', theme.refresh);
  theme.destroy = () => { mo.disconnect(); mq?.removeEventListener?.('change', theme.refresh); };

  theme.refresh();
  return theme;
}
