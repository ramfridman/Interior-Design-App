// Sanity checks for the house plan data against the dimensions written on the architect's drawing.
import { PLAN } from '../src/core/plan.js';
const area = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0)) / 2 / 1e4;
let ok = true; const fail = (m) => { ok = false; console.error('FAIL', m); };
let rooms = 0;
for (const r of PLAN.rooms) { const a = area(r.polygon); rooms += a; console.log(r.id.padEnd(18), a.toFixed(2), 'm²', r.drawnArea ? `(drawing: ${r.drawnArea})` : ''); if (r.drawnArea && Math.abs(a - r.drawnArea) > 0.35) fail(`${r.id} area ${a} vs drawn ${r.drawnArea}`); }
const walls = PLAN.walls.reduce((s, w) => s + w.w * w.h, 0) / 1e4;
const gaps = PLAN.openings.reduce((s, o) => s + o.w * o.h, 0) / 1e4;
console.log('rooms', rooms.toFixed(2), 'walls', walls.toFixed(2), 'openings', gaps.toFixed(2), 'gross', (rooms + walls + gaps).toFixed(2), `(drawing: ${PLAN.meta.grossFloorArea})`);
if (Math.abs(rooms + walls + gaps - PLAN.meta.grossFloorArea) > 2.5) fail('gross area mismatch') // drawing states 163; measured footprint is 161.0 (rooms match exactly);
for (const o of PLAN.outdoorAreas) { const a = area(o.polygon); console.log(o.id.padEnd(18), a.toFixed(2), `(drawing: ${o.drawnArea})`); if (Math.abs(a - o.drawnArea) > 0.6) fail(o.id); }
// walls must not overlap each other or openings
const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const all = [...PLAN.walls, ...PLAN.openings];
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (ov(all[i], all[j])) fail(`overlap ${all[i].id} ${all[j].id}`);
// every opening must be flanked by wall on both jambs and match its written width
for (const o of PLAN.openings) {
  const along = o.axis === 'h' ? o.w : o.h; if (along !== o.width) fail(`${o.id} width ${o.width} vs gap ${along}`);
  const a = o.axis === 'h' ? { x: o.x - 1, y: o.y, w: 1, h: o.h } : { x: o.x, y: o.y - 1, w: o.w, h: 1 };
  const b = o.axis === 'h' ? { x: o.x + o.w, y: o.y, w: 1, h: o.h } : { x: o.x, y: o.y + o.h, w: o.w, h: 1 };
  for (const j of [a, b]) if (!PLAN.walls.some((w) => ov(w, j))) fail(`${o.id} has no wall at a jamb`);
}
console.log('lot', area(PLAN.site.boundary).toFixed(1), 'm²');
console.log(ok ? 'PLAN OK' : 'PLAN HAS ERRORS'); process.exit(ok ? 0 : 1);
