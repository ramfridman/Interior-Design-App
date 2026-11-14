/**
 * LIVE COLLABORATION — what restoring a restore point would change (CONTRACT § 13, "Restore points"). Pure; used by
 * both hosts (dev/collab-server.mjs and the Worker's ProjectRoom) for  GET /api/projects/:id/versions/:vid.
 *
 *   summarizeVersion(currentDoc, savedDoc) → { items, runs, changes: { total, byType: { item: { added, removed, changed }, … } } }
 * `items` / `runs` are counts IN the restore point; `changes` = what a restore would do to the current state
 * (added = comes back, removed = goes away, changed = differs).
 */
import { diffDocs, keyType } from './ops.js';

export function summarizeVersion(current, saved) {
  const keys = Object.keys((saved && saved.e) || {});
  const byType = {};
  let total = 0;
  for (const op of diffDocs(current || { e: {} }, saved || { e: {} })) {
    const t = keyType(op.k), had = current && current.e && current.e[op.k] !== undefined;
    const b = byType[t] || (byType[t] = { added: 0, removed: 0, changed: 0 });
    if (op.d) b.removed++; else if (!had) b.added++; else b.changed++;
    total++;
  }
  return { items: keys.filter((k) => keyType(k) === 'item').length, runs: keys.filter((k) => keyType(k) === 'run').length, changes: { total, byType } };
}
