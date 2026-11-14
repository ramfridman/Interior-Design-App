/**
 * Carpentry studio engine — pure logic (no DOM, no THREE). See docs/CONTRACT.md § 8.
 *
 *   import * as Carp from './carpentry/index.js';
 *   Carp.adoptArchitectLayout();  Carp.checkRun('all');  Carp.drawings(runId);  Carp.estimate('all', { pricebook });
 */
export { VOCAB, RULES, DEFAULT_SPEC, KIND_SPEC, defaultSpec, unitSpec, derivedHeights, deepMerge, vocab, SPEC_TEXT_HE, specText, hwVariantLabel } from './spec.js';
export { MODULES, modulesFor, splitEven, islandBays, APPLIANCE_LABELS } from './modules.js';
export { bindStore, view, emptyCarpentry, planOf, runLevel, itemFloor, currentLevel } from './state.js';
export { wallSpanAt, spanOfRun, openingConflicts, toPlan, toLocal, frame } from './walls.js';
export { geometryOf, positions, unitCodes, rowExtents, levelOf, itemFields } from './layout.js';
export { computeWorktops, cutoutOf } from './worktop.js';
export { KIND_LEVELS, toCustom, createRun, updateRun, removeRun, duplicateRun, layoutRun, addUnit, updateUnit, setUnitWidth, removeUnit, moveUnit, fitRun, moveRun, moveRunToLevel, isFreeRun, cornerInsets } from './runs.js';
export { adoptArchitectLayout } from './adopt.js';
export { applyOperation, OPERATION_HARDWARE, BY_CARPENTER, cornerShape, validateCustomLayout, layoutGrid, customLayoutTemplate, CUSTOM_TEMPLATES, frontsToLayout } from './bespoke.js';
export { addFeature, updateFeature, removeFeature, listFeatures, featureImage, circled } from './features.js';
export { checkRun, runContext, runClearances, runFootprint } from './checks.js';
export { takeoff, unitTakeoff, runnerFor, HARDWARE } from './takeoff.js';
export { estimate, COMPONENTS, MARKET_COMPONENTS } from './estimate.js';
export { suggestTier, hasMarketKeys } from './market.js';
export { drawings, OP_KEY, textBox, textWidthMm, LW, TEXT, FILL, fmt } from './drawings.js';
export { schedules, HEADERS } from './schedules.js';
export { sortCarpentersByDistance, haversineKm } from './distance.js';
export { NATURAL_STONE, WORKTOP_THICKNESS } from './spec.js';
export { isNaturalStone, worktopRateKey, cutoutRateKey, splashStone, stoneName, finishLabel, stoneText, stoneRef, pickThickness, stonePatch, colourFamilies, COLOUR_FAMILIES, stoneBrands, filterStones, suppliersForStone, worksBrand, stoneRecord, hasSlabPrice, slabPriceLine } from './stone.js';

import { view as _view } from './state.js';
import { unitsOf as _unitsOf } from './layout.js';
/** Runs as an array (stable order: kitchen first, then by code). */
export function listRuns(src) {
  const order = ['kitchen', 'island', 'pantry', 'utility', 'wardrobe', 'entry', 'vanity', 'media', 'shelving', 'desk', 'custom'];
  return _view(src).runs().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || String(a.code).localeCompare(String(b.code)));
}
/** The run and unit items of a run, in order. */
export function getRun(runId, src) {
  const v = _view(src), run = v.run(runId);
  return run ? { run, units: _unitsOf(run, v) } : null;
}
/** The run a store item belongs to (or null). */
export function runOfItem(itemOrId, src) {
  const v = _view(src), it = typeof itemOrId === 'string' ? v.item(itemOrId) : itemOrId;
  return it && it.carp ? v.run(it.carp.runId) : null;
}
