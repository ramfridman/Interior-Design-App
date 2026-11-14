/**
 * FEATURE FLAGS for the staged work on angled walls and several floors (docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md § 4).
 * Only UI entry points read them, so each stage can ship while the feature is incomplete. Nothing reads them yet.
 *   levels       switched on after stage F3
 *   angledWalls  switched on after stages A4 and A5
 */
export const FEATURES = { angledWalls: false, levels: false };

/** Tests only: turn a flag on / off. Returns the previous value. */
export function setFeatureForTests(name, on) {
  if (!(name in FEATURES)) throw new Error(`Unknown feature "${name}"`);
  const was = FEATURES[name];
  FEATURES[name] = !!on;
  return was;
}
