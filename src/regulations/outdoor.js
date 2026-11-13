/**
 * Checks on the garden layout: outdoor items against the lot, the building line and the exemption rules.
 */
import { pointInPolygon, polygonBounds, convexOverlap, areaM2 } from '../core/geometry.js';
import { finding, boundaryEdge } from './building.js';
import {
  rectPoly, m, num, cmStr, segDist, polyDist, overshoot, pointPolyEdgeDist, openingSides,
  makeGrid, cloneGrid, fillPoly, clearance, flood, reachedNear, planRev,
} from './geom.js';

const names = (list) => [...new Set(list.map((i) => i.name || i.type))].join(', ');
const ids = (list) => list.map((i) => i.id).filter(Boolean);
const at = (it) => ({ x: Math.round(it.x), y: Math.round(it.y) });
const SIDE_NAME = { n: 'north', e: 'east', s: 'south', w: 'west' };
const STRUCTURES = new Set(['pergola', 'shed', 'pool', 'spa', 'fence', 'play', 'bbq']);
const ROOFED = new Set(['solid-roof', 'gazebo', 'carport', 'polycarbonate']);

const houseDist = (ctx, it) => {
  let d = Infinity;
  for (const w of ctx.walls) {
    const bb = w.bb;
    if (bb.x - (it.bb.x + it.bb.w) > d || it.bb.x - (bb.x + bb.w) > d || bb.y - (it.bb.y + it.bb.h) > d || it.bb.y - (bb.y + bb.h) > d) continue;
    d = Math.min(d, polyDist(it.poly, w.poly));
  }
  return d;
};
const boundaryDist = (site, it) => Math.min(...it.poly.map(([x, y]) => (pointInPolygon(x, y, site.boundary) ? pointPolyEdgeDist(x, y, site.boundary) : 0)));

/** How far an item projects beyond the building line on each side: { n, e, s, w } in cm. */
function beyondBuildingLine(site, it) {
  const res = { n: 0, e: 0, s: 0, w: 0 };
  if (!site.buildingLine) return res;
  const edges = ['n', 'e', 's', 'w'].map((s) => [s, boundaryEdge(site.buildingLine, s)]).filter((e) => e[1]);
  for (const [x, y] of it.poly) {
    if (pointInPolygon(x, y, site.buildingLine)) continue;
    let best = null;
    for (const [s, e] of edges) { const d = segDist(x, y, e.a[0], e.a[1], e.b[0], e.b[1]); if (!best || d < best.d) best = { s, d }; }
    if (best) res[best.s] = Math.max(res[best.s], best.d);
  }
  return res;
}
const setbackOf = (site, side) => {
  if (site.setbacks && site.setbacks[side] != null) return site.setbacks[side];
  const a = boundaryEdge(site.boundary, side), b = boundaryEdge(site.buildingLine, side);
  return a && b ? segDist(b.a[0], b.a[1], a.a[0], a.a[1], a.b[0], a.b[1]) : 300;
};

function checkLot(ctx, list, out) {
  const { site } = ctx.plan;
  const off = list.filter((i) => overshoot(i.poly, site.boundary) > 2);
  for (const it of off) {
    const o = overshoot(it.poly, site.boundary);
    out.push(finding('lot-boundary', STRUCTURES.has(it.type) || it.type === 'tree' || it.type === 'hedge' ? 'fail' : 'warn', it.id, `${it.name || it.type} is ${cmStr(o)} outside the property line`,
      `${it.name || it.type} extends ${cmStr(o)} beyond the lot boundary. Nothing may be built, planted or parked outside the property line.`, { itemIds: [it.id], at: at(it) }));
  }
  if (list.length && !off.length) out.push(finding('lot-boundary', 'pass', 'all', 'Everything is inside the lot', `All ${list.length} outdoor items lie inside the property line.`));
}

function checkParking(ctx, out) {
  const { site } = ctx.plan;
  for (const bay of site.parking || []) {
    const poly = rectPoly(bay);
    const inBay = ctx.items.filter((i) => i.type !== 'surface' && i.type !== 'outdoor-light' && i.h > 3 && convexOverlap(i.poly, poly, 3));
    const cars = inBay.filter((i) => i.type === 'car'), roofs = inBay.filter((i) => i.type === 'pergola');
    const others = inBay.filter((i) => i.type !== 'car' && i.type !== 'pergola');
    const where = { x: bay.x + bay.w / 2, y: bay.y + bay.h / 2 };
    if (others.length) {
      out.push(finding('parking-clear', 'warn', bay.id, `${bay.name || bay.id} is obstructed by ${names(others)}`,
        `${names(others)} stand${others.length > 1 ? '' : 's'} on ${bay.name || 'the parking bay'}. The two bays are required parking: keep them free of sheds, planting and furniture.`, { itemIds: ids(others), at: where }));
    } else {
      const out1 = cars.filter((c) => overshoot(c.poly, poly) > 5);
      out.push(finding('parking-clear', out1.length ? 'info' : 'pass', bay.id, out1.length ? `${names(out1)} overhangs ${bay.name || bay.id}` : `${bay.name || bay.id} is clear`,
        out1.length ? `${names(out1)} extends ${cmStr(Math.max(...out1.map((c) => overshoot(c.poly, poly))))} beyond the marked 2.50 × 5.00 m bay.`
          : `${bay.name || 'The bay'} is free${cars.length ? ` (${names(cars)} parked inside it)` : ''}${roofs.length ? `; ${names(roofs)} covers it — see the note on roofed structures` : ''}.`, { itemIds: ids(cars), at: where }));
    }
  }
}

function checkStructures(ctx, list, out) {
  const { plan } = ctx, site = plan.site;
  const lotArea = areaM2(site.boundary);
  const built = num(plan.meta && plan.meta.grossFloorArea, areaM2(rectPoly(plan.bounds)));
  const freeQuarter = Math.max(0, lotArea - built) / 4;

  for (const it of list.filter((i) => i.type === 'pergola')) {
    const area = it.w * it.d / 1e4;
    const variant = it.params.variant || 'slatted';
    if (ROOFED.has(variant)) {
      const b = beyondBuildingLine(site, it), worst = Math.max(b.n, b.e, b.s, b.w);
      out.push(finding('roofed-structure', 'warn', it.id, `${it.name || 'Roofed structure'} (${area.toFixed(1)} m²) needs a building permit`,
        `${it.name || 'This structure'} has a closed roof (${variant}), so it is not an exempt pergola: it needs a permit, counts as built area and must stay inside the building line`
        + (worst > 1 ? ` — it currently projects ${m(worst)} m beyond it.` : '.') + ' A slatted or louvred roof that is at least 40% open would be exempt.', { itemIds: [it.id], at: at(it) }));
      continue;
    }
    const limit = Math.max(50, freeQuarter);
    out.push(finding('pergola-exempt', area <= limit ? 'pass' : 'warn', it.id, `${it.name || 'Pergola'}: ${area.toFixed(1)} m²${area <= limit ? ' — within the permit exemption' : ' — too large for the exemption'}`,
      `${it.name || 'The pergola'} covers ${area.toFixed(1)} m². Without a permit a pergola may cover up to 50 m² or a quarter of the unbuilt ground (${freeQuarter.toFixed(0)} m² here), whichever is larger. `
      + 'It must be of light materials with a roof at least 40% open, and you must notify the local committee within 45 days with a structural engineer\'s approval of its anchoring.', { itemIds: [it.id], at: at(it) }));
    const b = beyondBuildingLine(site, it);
    const over = Object.entries(b).filter(([, d]) => d > 1);
    if (over.length) {
      const bad = over.filter(([s, d]) => d > 0.4 * setbackOf(site, s) + 1);
      out.push(finding('pergola-setback', bad.length ? 'warn' : 'pass', it.id, bad.length ? `${it.name || 'Pergola'} projects too far beyond the building line` : `${it.name || 'Pergola'} projects into the setback within the 40% limit`,
        over.map(([s, d]) => `${SIDE_NAME[s]}: ${m(d)} m beyond the building line (allowed ${m(0.4 * setbackOf(site, s))} m = 40% of the ${m(setbackOf(site, s))} m setback)`).join('; ') + '.', { itemIds: [it.id], at: at(it) }));
    } else {
      out.push(finding('pergola-setback', 'pass', it.id, `${it.name || 'Pergola'} is inside the building line`, 'The pergola, including its posts, stays inside the building line.', { itemIds: [it.id], at: at(it) }));
    }
  }

  for (const it of list.filter((i) => i.type === 'parasol' && /sail/.test(i.params.variant || ''))) {
    const ok = it.h <= 300 && Math.max(it.w, it.d) <= 500;
    out.push(finding('shade-sail', ok ? 'pass' : 'info', it.id, `${it.name || 'Shade sail'}: ${m(it.h)} m high, ${m(Math.max(it.w, it.d))} m span`,
      `A fabric shade sail is exempt from a permit up to 3.00 m high with posts no more than 5.00 m apart — ${ok ? 'met' : 'this one is larger, so check with the local committee'}.`, { itemIds: [it.id], at: at(it) }));
  }

  const sheds = list.filter((i) => i.type === 'shed' && ['shed', 'greenhouse', 'bike-store', undefined].includes(i.params.variant));
  sheds.forEach((it, n) => {
    const area = it.w * it.d / 1e4;
    const pitched = it.params.roof === 'gable' || it.params.roof === 'pent';
    const maxH = pitched ? 240 : 205;
    const probs = [];
    if (area > 6.0001) probs.push(`its ${area.toFixed(1)} m² footprint exceeds 6 m²`);
    if (it.h > maxH) probs.push(`its ${m(it.h)} m height exceeds ${m(maxH)} m${pitched ? ' (pitched roof)' : ''}`);
    if (n > 0) probs.push('only one exempt shed is allowed per dwelling');
    const b = beyondBuildingLine(site, it), beyond = Math.max(b.n, b.e, b.s, b.w) > 1;
    out.push(finding('shed-exempt', probs.length ? 'warn' : beyond ? 'info' : 'pass', it.id, probs.length ? `${it.name || 'Shed'} needs a permit` : `${it.name || 'Shed'}: ${area.toFixed(1)} m², ${m(it.h)} m high — exempt`,
      (probs.length ? `${it.name || 'The shed'} is not covered by the permit exemption: ${probs.join('; ')}. ` : `${it.name || 'The shed'} fits the exemption (up to 6 m² and ${m(maxH)} m high, light materials, no water or electricity connection, notify within 45 days). `)
      + (beyond ? 'It stands in the setback beyond the building line — check the local spatial guidelines (הנחיות מרחביות), which often restrict where a shed may stand.' : ''), { itemIds: [it.id], at: at(it) }));
  });

  const street = site.street && boundaryEdge(site.boundary, site.street.side);
  for (const it of list.filter((i) => i.type === 'fence')) {
    const tall = it.h > 150;
    const onStreet = street ? Math.min(...it.poly.map(([x, y]) => segDist(x, y, street.a[0], street.a[1], street.b[0], street.b[1]))) < 100 : false;
    if (!tall && !onStreet) continue;
    out.push(finding('fence-exempt', tall ? 'warn' : 'info', it.id, tall ? `${it.name || 'Fence'} is ${m(it.h)} m high — above 1.50 m` : `${it.name || 'Fence'} is on the street front`,
      tall ? `A fence higher than 1.50 m (this one is ${m(it.h)} m) is not exempt from a permit and is not allowed in the setback of a residential lot.`
        : 'A fence or wall on the street front is not covered by the permit exemption: its height, material and look follow the local guidelines of the kibbutz / regional council.', { itemIds: [it.id], at: at(it) }));
  }
  const fences = list.filter((i) => i.type === 'fence');
  if (fences.length && fences.every((f) => f.h <= 150)) out.push(finding('fence-exempt', 'pass', 'all', `All ${fences.length} fence segments are 1.50 m or lower`, 'Fences up to 1.50 m high (away from the street front) do not need a permit.'));

  // pools
  for (const it of list.filter((i) => i.type === 'pool')) {
    const depth = num(it.params.depth, it.h), area = it.w * it.d / 1e4;
    if (depth <= 60) {
      out.push(finding('pool-safety', 'pass', it.id, `${it.name || 'Pool'}: ${Math.round(depth)} cm deep — no fence required`, 'A pool up to 60 cm deep is not subject to the private-pool safety provisions. Never leave small children unattended near water.', { itemIds: [it.id], at: at(it) }));
      continue;
    }
    const perimeter = 2 * (it.w + it.d + 400);
    const guard = fences.filter((f) => (f.params.variant === 'pool-fence' || f.h >= 105) && polyDist(f.poly, it.poly) < 600);
    const length = guard.reduce((s, f) => s + Math.max(f.w, f.d), 0);
    const fenced = length >= perimeter * 0.6;
    out.push(finding('pool-safety', fenced ? 'info' : 'warn', it.id, fenced ? `${it.name || 'Pool'}: safety fence drawn — needs a permit` : `${it.name || 'Pool'}: no safety fence around it`,
      `${it.name || 'The pool'} is ${area.toFixed(1)} m² and ${m(depth)} m deep, so it needs a building permit with a safety consultant\'s sign-off, and a barrier that stops children reaching the water unsupervised `
      + `(${area > 10 ? 'around the pool, its plant room and chemicals' : 'the whole lot must be enclosed'}). `
      + (fenced ? `${m(length, 1)} m of fence at least 1.05 m high is drawn near it — make it continuous, at least 1.10 m high, with a self-closing, self-latching gate.` : 'Add a fence at least 1.10 m high with a self-closing gate all the way round.'),
      { itemIds: [it.id, ...ids(guard)], at: at(it) }));
    const dh = houseDist(ctx, it), db = boundaryDist(site, it);
    const b = beyondBuildingLine(site, it), beyond = Math.max(b.n, b.e, b.s, b.w);
    if (dh < 100 || db < 100 || beyond > 1) {
      out.push(finding('pool-distance', 'info', it.id, `${it.name || 'Pool'}: ${m(dh, 1)} m from the house, ${m(db, 1)} m from the boundary`,
        `The pool is ${m(dh, 1)} m from the house and ${m(db, 1)} m from the property line${beyond > 1 ? `, and reaches ${m(beyond)} m beyond the building line` : ''}. Local plans usually keep pools inside the building lines and at least 1 m from the boundary and from foundations — confirm with the regional council before digging.`,
        { itemIds: [it.id], at: at(it) }));
    }
  }

  // fire
  const canopies = list.filter((i) => i.type === 'pergola' || (i.type === 'parasol' && i.params.open !== false));
  for (const it of list.filter((i) => i.type === 'bbq' || (i.type === 'fire-pit' && !/heater/.test(i.params.variant || '')))) {
    const dh = houseDist(ctx, it), db = boundaryDist(site, it);
    const under = canopies.filter((c) => pointInPolygon(it.x, it.y, c.poly));
    const trees = list.filter((t) => t.type === 'tree' && Math.hypot(t.x - it.x, t.y - it.y) < Math.max(t.w, t.d) / 2 + 50);
    const open = it.type === 'fire-pit';
    const need = open ? 300 : 100;
    const sev = under.length || dh < need || trees.length ? 'warn' : dh < 300 || db < 100 ? 'info' : 'pass';
    out.push(finding('bbq-distance', sev, it.id, `${it.name || (open ? 'Fire pit' : 'BBQ')}: ${m(dh, 1)} m from the house`,
      `${it.name || 'It'} is ${m(dh, 1)} m from the house walls and ${m(db, 1)} m from the property line`
      + (under.length ? `, and stands under ${names(under)} — never light it under a pergola, parasol or roof` : '')
      + (trees.length ? `, under the canopy of ${names(trees)}` : '')
      + `. Keep ${open ? 'an open fire at least 3 m' : 'a grill at least 1 m — better 3 m —'} from walls, windows, doors, fences and plants, on a non-combustible surface.`, { itemIds: [it.id, ...ids(under)], at: at(it) }));
  }
}

// species → [class, distance from house, distance from boundary] (cm)
const TREE_SIZE = {
  ficus: ['large', 800, 400], eucalyptus: ['large', 800, 400], poinciana: ['large', 600, 400], jacaranda: ['large', 600, 400], oak: ['large', 600, 400],
  carob: ['large', 600, 400], mulberry: ['large', 600, 400], mango: ['large', 600, 400], avocado: ['large', 600, 400],
  lemon: ['small', 250, 150], orange: ['small', 250, 150], pomegranate: ['small', 250, 150], banana: ['small', 250, 150], plumeria: ['small', 250, 150], 'bougainvillea-tree': ['small', 250, 150],
};
const MEDIUM = ['medium', 400, 200];

function checkTrees(ctx, list, out) {
  const { site } = ctx.plan;
  const trees = list.filter((i) => i.type === 'tree');
  let ok = 0;
  for (const t of trees) {
    const [cls, needH, needB] = TREE_SIZE[t.params.species] || MEDIUM;
    const dh = Math.min(...ctx.walls.map((w) => polyDist([[t.x, t.y]], w.poly)));
    const db = pointInPolygon(t.x, t.y, site.boundary) ? pointPolyEdgeDist(t.x, t.y, site.boundary) : 0;
    const closeH = dh < needH, closeB = db < needB;
    if (!closeH && !closeB) { ok++; continue; }
    const sev = dh < needH / 2 || db < needB / 2 ? 'warn' : 'info';
    out.push(finding('tree-distance', sev, t.id, `${t.name || 'Tree'}: ${closeH ? m(dh, 1) + ' m from the house' : m(db, 1) + ' m from the boundary'}`,
      `${t.name || 'This tree'} (${t.params.species || 'tree'}, a ${cls} species) is planted ${m(dh, 1)} m from the house and ${m(db, 1)} m from the property line. For a ${cls} tree keep about ${m(needH, 1)} m from foundations, drains and paving and ${m(needB, 1)} m from the boundary, so roots and the mature canopy do not damage the house or overhang the neighbour.`,
      { itemIds: [t.id], at: at(t) }));
  }
  if (trees.length && ok === trees.length) out.push(finding('tree-distance', 'pass', 'all', `All ${trees.length} trees have room to grow`, 'Every tree is far enough from the house and the property line for its mature size.'));

  // hydrozones
  const HIGH = { tree: ['banana', 'mango', 'avocado'], shrub: ['hibiscus', 'fern', 'rose', 'bird-of-paradise'] };
  const LOW = { tree: ['olive', 'date-palm', 'carob', 'pomegranate', 'fig', 'almond', 'moringa'], shrub: ['lavender', 'rosemary', 'bougainvillea', 'agave', 'aloe', 'cactus', 'yucca', 'succulent-mix', 'sage', 'lantana', 'ornamental-grass', 'myrtle'] };
  const need = (i) => {
    if (i.type === 'surface') return i.params.kind === 'lawn' ? 'high' : null;
    if (i.type === 'raised-bed') return 'high';
    if (i.type === 'flower-bed') return ['succulents', 'rock-garden', 'grasses'].includes(i.params.variant) ? 'low' : ['vegetables', 'flowers'].includes(i.params.variant) ? 'high' : null;
    if (i.type === 'planter') return ['cactus', 'succulents'].includes(i.params.plant) ? 'low' : null;
    const sp = i.params.species;
    if (HIGH[i.type] && HIGH[i.type].includes(sp)) return 'high';
    if (LOW[i.type] && LOW[i.type].includes(sp)) return 'low';
    return null;
  };
  const plants = list.map((i) => ({ i, need: need(i) })).filter((p) => p.need);
  const low = plants.filter((p) => p.need === 'low'), high = plants.filter((p) => p.need === 'high');
  if (low.length && high.length) {
    const mixed = low.filter((l) => high.some((h) => (h.i.type === 'surface' ? pointInPolygon(l.i.x, l.i.y, h.i.poly) : polyDist(l.i.poly, h.i.poly) < 100)));
    out.push(finding('hydrozones', mixed.length ? 'info' : 'pass', 'all', mixed.length ? `${mixed.length} drought-tolerant plant${mixed.length > 1 ? 's' : ''} sit in a thirsty zone` : 'Plants are grouped by water need',
      mixed.length ? `${names(mixed.map((p) => p.i))} need little water but stand in or next to lawn / thirsty planting. In the Jordan Valley heat, put low-water plants on their own drip line (over-watering rots succulents, lavender and olives) and keep lawn and tropical plants together.`
        : 'Low-water and high-water plants are kept apart, so each group can have its own irrigation line.', { itemIds: ids(mixed.map((p) => p.i)) }));
  }
  const lawn = list.filter((i) => i.type === 'surface' && i.params.kind === 'lawn').reduce((s, i) => s + i.w * i.d / 1e4, 0);
  const garden = areaM2(site.boundary) - num(ctx.plan.meta && ctx.plan.meta.grossFloorArea, 0);
  if (lawn > 0.4 * garden) {
    out.push(finding('hydrozones', 'info', 'lawn', `Lawn covers ${lawn.toFixed(0)} m² (${Math.round(lawn / garden * 100)}% of the garden)`,
      `Natural lawn needs roughly 0.8–1 m³ of water per m² a year in the Jordan Valley. Consider keeping lawn to the area you actually use and covering the rest with drought-tolerant planting, gravel or deck.`));
  }
}

const PATH_GRID = new WeakMap();
/** Raster of the entry path; depends on the entrance door, so it is keyed on the plan revision (see planRev). */
function pathGrid(plan) {
  const rev = planRev(plan);
  const hit = PATH_GRID.get(plan);
  if (hit && hit.rev === rev) return hit.g;
  let g = null;
  const site = plan.site;
  const entry = plan.openings.find((o) => o.style === 'entry') || plan.openings.find((o) => o.exterior && o.kind === 'door');
  if (entry && site.paths && site.paths.length) {
    const outside = openingSides(entry, 60, 25).find((s) => !plan.rooms.some((r) => pointInPolygon(s.probe[0], s.probe[1], r.polygon)));
    const porch = outside && (plan.outdoorAreas || []).find((a) => pointInPolygon(outside.probe[0], outside.probe[1], a.polygon));
    const polys = [...site.paths.map((p) => p.polygon), ...(porch ? [porch.polygon] : [])];
    const bb = polygonBounds(polys.flat());
    const grid = makeGrid({ x: bb.x - 20, y: bb.y - 20, w: bb.w + 40, h: bb.h + 40 }, 10);
    for (const p of polys) fillPoly(grid, p, 1);
    const street = site.street && boundaryEdge(site.boundary, site.street.side);
    const seeds = [];
    let far = null;
    for (const p of site.paths) for (const [x, y] of p.polygon) {
      const d = street ? segDist(x, y, street.a[0], street.a[1], street.b[0], street.b[1]) : -Math.hypot(x - outside.probe[0], y - outside.probe[1]);
      if (!far || d < far.d) far = { d, x, y };
    }
    for (let k = 0; k < grid.free.length; k++) {
      if (!grid.free[k]) continue;
      const x = grid.x0 + (k % grid.nx + 0.5) * grid.cell, y = grid.y0 + (Math.floor(k / grid.nx) + 0.5) * grid.cell;
      if (far && Math.hypot(x - far.x, y - far.y) < 130) seeds.push(k);
    }
    g = { grid, seeds, target: outside ? outside.probe : null, polys, start: far };
  }
  PATH_GRID.set(plan, { rev, g });
  return g;
}

function checkEntryPath(ctx, out) {
  const pg = pathGrid(ctx.plan);
  if (!pg || !pg.target || !pg.seeds.length) return;
  const g = cloneGrid(pg.grid);
  const blockers = ctx.items.filter((i) => i.solid && !i.room && !['pergola', 'parasol', 'outdoor-light'].includes(i.type) && pg.polys.some((p) => polyDist(i.poly, p) === 0));
  for (const it of blockers) fillPoly(g, it.poly, 0);
  const seeds = pg.seeds.filter((k) => g.free[k]);
  const dist = clearance(g);
  const reach = (w) => reachedNear(g, flood(g, dist, w / 2 - 10, seeds), pg.target[0], pg.target[1], 40);
  const ok90 = reach(90), ok60 = ok90 || reach(60);
  const where = { x: pg.target[0], y: pg.target[1] };
  out.push(finding('entry-path', ok90 ? 'pass' : 'warn', 'path', ok90 ? 'Path from the street to the front door is clear' : ok60 ? 'Path to the front door is narrower than 90 cm' : 'Path to the front door is blocked',
    ok90 ? 'The paved path from the street and parking to the entrance porch is at least 90 cm wide all the way to the door.'
      : `${blockers.length ? names(blockers) + (blockers.length > 1 ? ' stand' : ' stands') + ' on the entry path' : 'The path as drawn is narrow'}: less than ${ok60 ? '90' : '60'} cm is left to walk from the street to the front door. Keep at least 90 cm free for prams, deliveries and furniture.`,
    { itemIds: ids(blockers), at: where }));
}

/** All outdoor findings. */
export function checkOutdoor(ctx) {
  const out = [];
  const site = ctx.plan.site;
  if (!site || !site.boundary) return out;
  const list = ctx.items.filter((i) => i.zone === 'outdoor' || (!i.room && i.placement === 'floor'));
  checkLot(ctx, list, out);
  checkParking(ctx, out);
  checkStructures(ctx, list, out);
  checkTrees(ctx, list, out);
  checkEntryPath(ctx, out);
  return out;
}
