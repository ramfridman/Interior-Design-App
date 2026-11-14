/**
 * FEATURE FLAGS for the staged work on angled walls and several floors (docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md § 4).
 * Only UI entry points read them, so each stage can ship while the feature is incomplete.
 *   levels       switched on after stage F3
 *   angledWalls  switched on after stages A4 and A5
 */
export const FEATURES = { angledWalls: false, levels: false };

// The owner's choice (Settings → Experimental), remembered in this browser; read once, when this module loads.
const PREF_KEY = 'e7-interior-design/features/v1';
const SAVED = {};
try {
  const raw = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem(PREF_KEY) : null;
  if (raw) { const o = JSON.parse(raw); for (const k of Object.keys(FEATURES)) if (typeof o[k] === 'boolean') { SAVED[k] = o[k]; FEATURES[k] = o[k]; } }
} catch (e) { /* no storage (node, sandboxed iframe): keep the defaults */ }

// Manual / e2e checks: `?levels=1` in the page URL switches the levels UI on (read once, when this module loads).
try {
  if (typeof location !== 'undefined' && location && typeof location.search === 'string' && new URLSearchParams(location.search).get('levels') === '1') FEATURES.levels = true;
} catch (e) { /* no URL (node) or an unreadable one: keep the default */ }

/** Tests only: turn a flag on / off. Returns the previous value. */
export function setFeatureForTests(name, on) {
  if (!(name in FEATURES)) throw new Error(`Unknown feature "${name}"`);
  const was = FEATURES[name];
  FEATURES[name] = !!on;
  return was;
}

const listeners = new Set();
/**
 * Turn a flag on / off at runtime (Settings → Experimental) and remember it in this browser (best effort).
 * Listeners get (name, on). Returns the previous value.
 */
export function setFeature(name, on, { persist = true } = {}) {
  if (!(name in FEATURES)) throw new Error(`Unknown feature "${name}"`);
  const was = FEATURES[name];
  FEATURES[name] = !!on;
  if (persist) {
    SAVED[name] = !!on;
    try { localStorage.setItem(PREF_KEY, JSON.stringify(SAVED)); } catch (e) { /* storage unavailable */ }
  }
  if (was !== FEATURES[name]) for (const fn of listeners) { try { fn(name, FEATURES[name]); } catch (err) { console.error('[features]', err); } }
  return was;
}
/** Call `fn(name, on)` when a flag changes at runtime. Returns an unsubscribe function. */
export function onFeatureChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
