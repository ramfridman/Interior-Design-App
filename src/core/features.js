/**
 * FEATURE FLAGS for the staged work on angled walls and several floors (docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md § 4).
 * Only UI entry points read them, so each stage can ship while the feature is incomplete.
 *   levels       switched on after stage F3
 *   angledWalls  switched on after stages A4 and A5
 */
export const FEATURES = { angledWalls: false, levels: false };

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
