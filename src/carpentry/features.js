/**
 * Special requirements ("features") — the universal escape hatch for anything the module library cannot express.
 * Feature = { id, n, title, text, category, priority?: 'must'|'nice', images?: [{ id, name, w, h, dataUrl? | stored: true }] }
 * on a run (run.features) or a unit (unit.carp.features). The owner's text is never translated. `n` = stable number per run.
 * Large images (dataUrl > 50 000 chars) are kept out of undo history in store.carpentryImages[imageId] (saved with the design).
 */
import { mutate, view, newId, clone, getStore } from './state.js';
import { VOCAB } from './spec.js';
import { unitsOf, unitCodes } from './layout.js';

const L = (en, he) => ({ en, he });
const FAIL = (en, he) => ({ ok: false, reason: L(en, he) });
const BIG = 50000;
/** Circled number ① … ⑳, then (21)… */
export const circled = (n) => (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`);

function normImages(images) {
  const S = getStore();
  return (Array.isArray(images) ? images : []).map((im) => {
    const id = im.id || newId('img'), out = { id, name: im.name || '', w: im.w || null, h: im.h || null };
    if (im.dataUrl && im.dataUrl.length > BIG) { S.carpentryImages = S.carpentryImages || {}; S.carpentryImages[id] = im.dataUrl; out.stored = true; }
    else if (im.dataUrl) out.dataUrl = im.dataUrl;
    else if (im.stored) out.stored = true;
    return out;
  });
}
function clean(f) {
  const out = { title: String(f.title || '').slice(0, 200), text: String(f.text || ''), category: VOCAB.featureCategory[f.category] ? f.category : 'other' };
  if (f.priority === 'must' || f.priority === 'nice') out.priority = f.priority;
  if (f.images) out.images = normImages(f.images);
  return out;
}
/** Find a feature in a draft: { holder (array), index, runId, unitId }. */
function locate(d, featureId) {
  for (const run of Object.values(d.carpentry.runs)) {
    const i = (run.features || []).findIndex((f) => f.id === featureId);
    if (i >= 0) return { run, list: run.features, i, unitId: null };
    for (const uid of run.unitIds) {
      const u = d.peek(uid), j = u && u.carp && (u.carp.features || []).findIndex((f) => f.id === featureId);
      if (j >= 0) return { run, unitId: uid, i: j };
    }
  }
  return null;
}

/** Add a special requirement to { runId } or { unitId }. Returns { ok, featureId, n }. */
export function addFeature(target = {}, feature = {}, mopts) {
  const v = view();
  const unit = target.unitId ? v.item(target.unitId) : null, runId = unit && unit.carp ? unit.carp.runId : target.runId;
  if (!v.run(runId) || (target.unitId && !unit)) return FAIL('No such run or unit.', 'קו או יחידה לא קיימים.');
  if (!String(feature.title || feature.text || '').trim()) return FAIL('A special requirement needs a title or a text.', 'דרישה מיוחדת צריכה כותרת או תיאור.');
  return mutate('feature', (d) => {
    const run = d.carpentry.runs[runId];
    run.featureSeq = (run.featureSeq || 0) + 1;
    const f = { id: newId('ft'), n: run.featureSeq, ...clean(feature) };
    if (unit) { const it = d.item(unit.id); it.carp.features = [...(it.carp.features || []), f]; }
    else run.features = [...(run.features || []), f];
    return { featureId: f.id, n: f.n, ids: [f.id], runIds: [runId] };
  }, mopts);
}
/** Patch { title, text, category, priority, images }. */
export function updateFeature(featureId, patch = {}, mopts) {
  return mutate('feature', (d) => {
    const loc = locate(d, featureId);
    if (!loc) return FAIL('No such special requirement.', 'דרישה מיוחדת לא קיימת.');
    const list = loc.unitId ? d.item(loc.unitId).carp.features : loc.run.features;
    const cur = list[loc.i], next = { ...cur, ...clean({ ...cur, ...patch }) };
    if (!patch.images && cur.images) next.images = cur.images;
    if (!('priority' in patch) && cur.priority) next.priority = cur.priority;
    if (patch.priority === null) delete next.priority;
    list[loc.i] = next;
    return { ids: [featureId], runIds: [loc.run.id] };
  }, mopts);
}
export function removeFeature(featureId, mopts) {
  return mutate('feature', (d) => {
    const loc = locate(d, featureId);
    if (!loc) return FAIL('No such special requirement.', 'דרישה מיוחדת לא קיימת.');
    if (loc.unitId) { const it = d.item(loc.unitId); it.carp.features = it.carp.features.filter((f) => f.id !== featureId); if (!it.carp.features.length) delete it.carp.features; }
    else { loc.run.features = loc.run.features.filter((f) => f.id !== featureId); if (!loc.run.features.length) delete loc.run.features; }
    return { ids: [featureId], runIds: [loc.run.id] };
  }, mopts);
}
/** The stored data URL of a large feature image (or null). */
export function featureImage(imageId) { const S = getStore(); return (S.carpentryImages && S.carpentryImages[imageId]) || null; }

/** All features of a run or of every run: [{ …feature, runId, run (code), unitId, code, ref, label (circled) }], by run then n. */
export function listFeatures(runId = 'all', src) {
  const v = view(src), out = [];
  for (const run of runId === 'all' ? v.runs() : [v.run(runId)].filter(Boolean)) {
    const units = unitsOf(run, v), codes = unitCodes(run, units);
    for (const f of run.features || []) out.push({ ...clone(f), runId: run.id, run: run.code, unitId: null, code: null, ref: run.code, label: circled(f.n) });
    for (const u of units) for (const f of u.carp.features || []) out.push({ ...clone(f), runId: run.id, run: run.code, unitId: u.id, code: codes.get(u.id), ref: `${run.code}·${codes.get(u.id)}`, label: circled(f.n) });
  }
  return out.sort((a, b) => String(a.run).localeCompare(String(b.run)) || a.n - b.n);
}
