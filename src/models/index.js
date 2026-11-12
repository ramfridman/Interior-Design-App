/**
 * Loads every model module (each registers its types) and re-exports the registry API.
 * A module that fails to load is reported and skipped — items of its types fall back to plain boxes.
 */
import { MODEL_FILES } from './types.js';
export * from './registry.js';
export { MODEL_TYPES, CATEGORIES } from './types.js';

export async function loadModels() {
  const results = await Promise.allSettled(MODEL_FILES.map((f) => import(`./${f}.js`)));
  results.forEach((r, i) => { if (r.status === 'rejected') console.error(`[models] failed to load ${MODEL_FILES[i]}.js`, r.reason); });
  return results.every((r) => r.status === 'fulfilled');
}
