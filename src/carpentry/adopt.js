/**
 * adoptArchitectLayout() — turn the architect's generic kitchen / island / tall units / wardrobes / closets / vanities /
 * utility cabinets (store items with generic: true) into editable runs with the right modules, keeping positions and
 * overall sizes. Free-standing appliances (fridge, washer, dryer) stay as items; their places become niche / space units.
 * Idempotent (a second call finds nothing left to adopt) and ONE undo step.
 */
import { mutate, newId, clone } from './state.js';
import { MODULES, splitEven, APPLIANCE_LABELS } from './modules.js';
import { defaultSpec, deepMerge, RULES, VOCAB } from './spec.js';
import { wallSpanAt, toPlan, toLocal, frame } from './walls.js';
import { relayout, KIND_LEVELS } from './runs.js';
import { spaceAt } from '../core/geometry.js';
import { PLAN } from '../core/plan.js';

const L = (en, he) => ({ en, he });
const r1 = (v) => Math.round(v * 10) / 10;
const CARP_TYPES = new Set(['kitchen-base', 'kitchen-tall', 'kitchen-island', 'wardrobe', 'vanity']);
const roomOf = (it) => { const s = spaceAt(it.x, it.y); return s && s.kind === 'room' ? s : null; };

/** Items the adoption converts (true) or uses as appliance markers ('marker'). */
function role(it) {
  if (!it.generic || it.carp) return null;
  if (CARP_TYPES.has(it.type)) return 'carp';
  if (it.type === 'cabinet' && /utility/i.test(it.name || '') ) return 'carp';
  if (it.type === 'cabinet') { const r = roomOf(it); if (r && r.type === 'service') return 'carp'; }
  if (it.type === 'fridge' || it.type === 'washer' || it.type === 'dishwasher') return 'marker';
  return null;
}

/** Back-line frame of an item: anchor-like { dir, back (coordinate of the back line), a, b (along extent) }. */
function backOf(it) {
  const dir = ((it.rot || 0) % 360 + 360) % 360, f = frame(dir);
  const bx = it.x - f.nx * it.d / 2, by = it.y - f.ny * it.d / 2;
  const along = bx * f.ux + by * f.uy, back = bx * f.nx + by * f.ny;
  return { dir, back: Math.round(back), a: along - it.w / 2, b: along + it.w / 2 };
}

function groupItems(list) {
  const groups = [];
  const keyed = list.map((it) => ({ it, k: backOf(it) })).sort((p, q) => p.k.dir - q.k.dir || p.k.back - q.k.back || p.k.a - q.k.a);
  for (const e of keyed) {
    const g = groups.find((gr) => gr.dir === e.k.dir && Math.abs(gr.back - e.k.back) <= 2 && e.k.a <= gr.b + 6 && e.k.b >= gr.a - 6 && gr.island === (e.it.type === 'kitchen-island'));
    if (g && e.it.type !== 'kitchen-island') { g.items.push(e); g.a = Math.min(g.a, e.k.a); g.b = Math.max(g.b, e.k.b); }
    else groups.push({ dir: e.k.dir, back: e.k.back, a: e.k.a, b: e.k.b, items: [e], island: e.it.type === 'kitchen-island' });
  }
  return groups.filter((g) => g.items.some((e) => role(e.it) === 'carp'));
}

function kindOf(g) {
  const types = g.items.map((e) => e.it.type), names = g.items.map((e) => e.it.name || '').join(' ');
  if (g.island) return 'island';
  if (types.some((t) => t.startsWith('kitchen-'))) return 'kitchen';
  if (types.includes('vanity')) return 'vanity';
  const room = roomOf(g.items[0].it);
  if (room && room.type === 'service') return 'utility';
  if (/hall|entry/i.test(names)) return 'entry';
  return 'wardrobe';
}

/** Kitchen-base / tall / vanity / cabinet params → unit specs [{ module, width, … }]. */
function unitsForItem(it, kind, width) {
  const p = it.params || {};
  const pieces = (mod, w) => { const m = MODULES[mod], n = Math.max(1, Math.ceil(w / m.w.max - 1e-9)); return splitEven(w, n).map((x) => ({ module: mod, width: x })); };
  if (it.type === 'kitchen-base' || (it.type === 'cabinet' && kind === 'utility')) {
    if (p.corner) return [{ module: 'base-corner-blind', width, cornerSide: 'L', blind: Math.min(width, 60), internals: { corner: width - 60 >= 30 ? 'lemans' : 'none' } }];
    if (p.sink) return [{ module: 'base-sink', width: Math.max(60, width) }];
    if (p.cooktop) return [{ module: 'base-hob', width, hob: p.cooktop === 'gas' ? 'gas' : 'induction', internals: { drawers: Math.min(3, Math.max(2, p.drawers || 3)) } }];
    if (p.oven) return [{ module: 'base-oven', width: 60 }];
    if (p.dishwasher) return [{ module: 'base-dishwasher', width: 60 }];
    if (p.drawers && !p.doors) return pieces('base-drawers', width).map((u) => ({ ...u, internals: { drawers: Math.min(4, Math.max(2, p.drawers)) } }));
    return pieces('base-door', width);
  }
  if (it.type === 'kitchen-tall') {
    const out = [];
    let rest = width;
    if (p.oven || p.microwave) { out.push({ module: 'tall-oven', width: 60 }); rest -= 60; }
    if (p.fridge) { out.push({ module: 'tall-fridge', width: 60 }); rest -= 60; }
    if (rest > 0.5) {
      const n = Math.max(1, Math.ceil(rest / 60 - 1e-9));
      out.splice(p.oven || p.microwave ? 1 : 0, 0, ...splitEven(rest, n).map((w) => ({ module: 'tall-pantry', width: w, internals: { pantry: 'shelves' } })));
    }
    return out;
  }
  if (it.type === 'vanity') return [{ module: 'vanity', width, internals: { drawers: 2 }, basins: p.basins || 1, mirror: !!p.mirror }];
  return [];
}

/** Wardrobe-type item → carcasses: 2-door carcasses where the door count allows, single-door for the odd one. */
function carcassesFor(it, inner, kind) {
  const doors = Math.max(1, (it.params && it.params.doors) || Math.round(inner / 50));
  const shallow = it.d < 40;
  const mod = kind === 'entry' && shallow ? 'entry-closet' : 'wardrobe-hinged';
  const preset = kind === 'utility' ? 'shelves' : kind === 'entry' ? (shallow ? 'shoes' : 'hanging') : null;
  let sets;
  if (inner / doors > 60) sets = Array(doors).fill(1);                       // wide doors → one per carcass
  else { sets = Array(Math.floor(doors / 2)).fill(2); if (doors % 2) sets.push(1); }
  if (kind === 'utility') sets = Array(doors).fill(1);
  const shares = sets.reduce((a, b) => a + b, 0);
  const raw = sets.map((s) => (inner * s) / shares), ws = raw.map((w) => Math.round(w));
  ws[ws.length - 1] = r1(inner - ws.slice(0, -1).reduce((a, b) => a + b, 0));
  return sets.map((s, i) => ({ module: mod, width: ws[i], fronts: { doors: s }, ...(preset ? { internals: { preset } } : {}) }));
}

/**
 * Convert the architect's layout. Returns { ok, runIds, ids (new unit ids), removed (generic item ids), changed }.
 * opts.includeMedia: also adopt a generic 'TV unit' cabinet as a media run (default false).
 */
export function adoptArchitectLayout(opts = {}, mopts) {
  return mutate('adopt', (d) => {
    const items = d.items();
    const pool = items.filter((it) => role(it) || (opts.includeMedia && it.generic && it.type === 'cabinet' && /tv unit/i.test(it.name || '')));
    const groups = groupItems(pool);
    if (!groups.length) return { runIds: [], ids: [], removed: [] };
    const created = [], removed = [], newUnits = [];
    const runCount = {};
    for (const g of groups) {
      const kind = /tv unit/i.test(g.items[0].it.name || '') ? 'media' : kindOf(g);
      const first = g.items[0].it, f = frame(g.dir);
      const spec = defaultSpec(kind);
      let anchor, length, ends = { left: { type: 'open' }, right: { type: 'open' } }, roomId, side = '';
      const sorted = g.items.sort((p, q) => p.k.a - q.k.a);
      if (g.island) {
        anchor = { ...(() => { const [x, y] = toPlan({ x: first.x, y: first.y, dir: g.dir }, -first.w / 2, -first.d / 2); return { x: r1(x), y: r1(y) }; })(), dir: g.dir };
        length = first.w;
        spec.worktop.depth = first.d;
        spec.worktop.overhangSeat = (first.params && first.params.overhang) ?? 30;
        roomId = (roomOf(first) || {}).id || null;
      } else {
        // back line → wall stretch
        const mid = (g.a + g.b) / 2, bx = f.ux * mid + f.nx * g.back, by = f.uy * mid + f.ny * g.back;
        const span = wallSpanAt(bx + f.nx * 2, by + f.ny * 2, { maxDist: 8 });
        let a = g.a, b = g.b;
        if (span && span.anchor.dir === g.dir) {
          const s0 = toLocal(span.anchor, f.ux * g.a + f.nx * g.back, f.uy * g.a + f.ny * g.back)[0];
          const s1 = s0 + (g.b - g.a);
          const snapA = s0 <= 6, snapB = span.length - s1 <= 6;
          if (snapA) a = g.a - s0;
          if (snapB) b = g.b + (span.length - s1);
          ends = { left: { type: snapA ? span.ends.left : 'open' }, right: { type: snapB ? span.ends.right : 'open' } };
          roomId = span.roomId;
        }
        const ax = f.ux * a + f.nx * g.back, ay = f.uy * a + f.ny * g.back;
        anchor = { x: r1(ax), y: r1(ay), dir: g.dir };
        length = r1(b - a);
        side = { 0: L('north wall', 'קיר צפוני'), 90: L('east wall', 'קיר מזרחי'), 180: L('south wall', 'קיר דרומי'), 270: L('west wall', 'קיר מערבי') }[g.dir];
      }
      const room = PLAN.rooms.find((r) => r.id === roomId);
      // depths from the architect's pieces
      const carpItems = sorted.filter((e) => role(e.it) === 'carp').map((e) => e.it);
      const dep = Math.max(...carpItems.map((it) => it.d)), front = spec.fronts.thickness / 10;
      if (kind === 'wardrobe' || kind === 'entry' || (kind === 'utility' && carpItems.some((it) => it.type === 'wardrobe'))) spec.depths.full = r1(dep - front);
      if (kind === 'vanity') { spec.depths.base = r1(dep - front - 2); spec.worktop.depth = dep; spec.heights.worktop = Math.max(...carpItems.map((it) => it.h)); }
      if (kind === 'kitchen') { spec.worktop.depth = Math.max(...carpItems.filter((it) => it.type === 'kitchen-base').map((it) => it.d), 60); const tall = carpItems.find((it) => it.type === 'kitchen-tall'); if (tall) spec.heights.topLine = tall.h; }
      if (kind === 'utility') { const base = carpItems.find((it) => it.type === 'cabinet'); if (base) spec.heights.worktop = base.h; }
      const wardrobeH = carpItems.find((it) => it.type === 'wardrobe');
      if (wardrobeH) spec.heights.body = wardrobeH.h;
      const kindL = VOCAB.runKind[kind];
      const roomName = room ? L(room.name, room.nameHe || room.name) : L('', '');
      runCount[kind] = (runCount[kind] || 0) + 1;
      const id = newId('run');
      const run = {
        id, code: '', kind, name: `${kindL.en}${roomName.en && kind !== 'kitchen' && kind !== 'island' ? ' — ' + roomName.en : ''}${side && kind === 'kitchen' ? ' — ' + side.en : ''}`,
        nameHe: `${kindL.he}${roomName.he && kind !== 'kitchen' && kind !== 'island' ? ' — ' + roomName.he : ''}${side && kind === 'kitchen' ? ' — ' + side.he : ''}`,
        roomId: roomId || null, anchor, length, levels: [...KIND_LEVELS[kind]], freeStanding: kind === 'island', spec, unitIds: [], worktops: [], ends, notes: '', source: 'architect',
      };
      const used = new Set(Object.values(d.carpentry.runs).map((r) => r.code));
      for (let i = 1; ; i++) { const c = { kitchen: 'K', island: 'KI', wardrobe: 'WR', pantry: 'PN', vanity: 'VN', utility: 'UT', media: 'MW', entry: 'EN', shelving: 'SH', desk: 'DK', custom: 'CU' }[kind] + i; if (!used.has(c)) { run.code = c; break; } }
      // unit specs along the run
      const specs = [];
      const origin = toLocal(anchor, anchor.x, anchor.y)[0];
      const localA = (e) => r1(e.k.a - (f.ux * anchor.x + f.uy * anchor.y) - origin);
      if (g.island) {
        specs.push({ module: 'island', width: first.w, internals: { drawers: 3 } });
      } else if (['wardrobe', 'entry'].includes(kind) || (kind === 'utility' && carpItems.every((it) => it.type === 'wardrobe'))) {
        const it = carpItems[0], wall = (s) => ends[s].type === 'wall';
        const fl = wall('left') ? RULES.fillerAtWall : 0, fr = wall('right') ? RULES.fillerAtWall : 0;
        if (fl) specs.push({ module: 'filler', width: fl, level: 'full' });
        specs.push(...carcassesFor(it, r1(length - fl - fr), kind));
        if (fr) specs.push({ module: 'filler', width: fr, level: 'full' });
      } else {
        let cursor = 0;
        for (const e of sorted) {
          const a = Math.max(cursor, localA(e)), it = e.it;
          let w = r1(e.k.b - e.k.a);
          if (it.type !== 'fridge' && a > cursor + 0.5) {               // close small gaps (a fridge niche starts at the cursor)
            if (specs.length) { specs[specs.length - 1].width = r1(specs[specs.length - 1].width + (a - cursor)); cursor = a; }
            else w = r1(w + (a - cursor));
          }
          if (it.type === 'fridge') {
            const isLast = e === sorted[sorted.length - 1], end = isLast ? length : localA(e) + w;
            specs.push({ module: 'tall-fridge-niche', width: r1(end - cursor), appliance: { label: APPLIANCE_LABELS.fridge, w: it.w, h: it.h, d: it.d, itemId: it.id } });
            cursor = end; continue;
          }
          if (it.type === 'washer' || it.type === 'dishwasher') {
            const lab = it.type === 'dishwasher' ? APPLIANCE_LABELS.dw : /dryer/i.test(it.name || '') || (it.params && it.params.variant === 'dryer') ? APPLIANCE_LABELS.dryer : APPLIANCE_LABELS.washer;
            specs.push({ module: 'base-space', width: w, appliance: { label: lab, w: it.w, h: it.h, itemId: it.id } });
            cursor += w; continue;
          }
          specs.push(...unitsForItem(it, kind, w));
          cursor = r1(cursor + w);
        }
        if (length - cursor > 0.5 && specs.length) specs[specs.length - 1].width = r1(specs[specs.length - 1].width + length - cursor);
        // finished end panels on open ends of kitchen / utility runs
        if (kind === 'kitchen' || kind === 'pantry') {
          for (const s of ['left', 'right']) {
            if (ends[s].type !== 'open') continue;
            const endU = s === 'left' ? specs[0] : specs[specs.length - 1];
            if (!endU || MODULES[endU.module].virtual) continue;
            const pw = spec.fronts.thickness / 10;
            endU.width = r1(endU.width - pw);
            const lvl = MODULES[endU.module].level === 'any' ? 'base' : MODULES[endU.module].level;
            const p = { module: 'panel', width: pw, level: lvl === 'tall' ? 'tall' : 'base' };
            if (s === 'left') specs.unshift(p); else specs.push(p);
          }
        }
      }
      d.carpentry.runs[id] = run;
      for (const s of specs) {
        const mod = MODULES[s.module];
        const level = mod.level === 'any' ? s.level || 'base' : mod.level;
        const carp = { runId: id, module: s.module, level, width: r1(s.width), at: 0, internals: deepMerge((mod.internals && mod.internals.default) || {}, s.internals || {}), fronts: clone(s.fronts || {}), spec: {}, handed: 'L', note: '' };
        for (const k of ['appliance', 'hob', 'cornerSide', 'blind', 'basins', 'mirror']) if (s[k] !== undefined) carp[k] = clone(s[k]);
        const it = d.add({ type: 'cabinet', name: mod.name.en, params: {}, x: 0, y: 0, rot: g.dir, w: carp.width, d: 60, h: 90, elev: 0, placement: 'floor', zone: 'indoor',
          price: null, priceUnit: 'item', url: null, retailer: null, brand: null, productId: null, locked: false, hidden: !!mod.virtual, fixture: true, generic: false, note: '', carp });
        run.unitIds.push(it.id); newUnits.push(it.id);
      }
      for (const e of sorted) if (role(e.it) === 'carp' || /tv unit/i.test(e.it.name || '')) { d.remove(e.it.id); removed.push(e.it.id); }
      created.push(id);
    }
    // link L corners: a run end that stops on another run's front line
    const runs = created.map((id) => d.carpentry.runs[id]);
    for (const r of runs) for (const side of ['left', 'right']) {
      if (r.ends[side].type !== 'open' || r.freeStanding) continue;
      const [px, py] = toPlan(r.anchor, side === 'left' ? -1 : r.length + 1, 10);
      for (const o of runs) {
        if (o === r || o.freeStanding || o.anchor.dir === r.anchor.dir) continue;
        const [la, ld] = toLocal(o.anchor, px, py);
        if (la >= -0.5 && la <= o.length + 0.5 && ld >= 0 && ld <= o.spec.worktop.depth + 0.5) {
          r.ends[side] = { type: 'run', runId: o.id, at: la < o.length / 2 ? 'left' : 'right' };
          // the panel adoption may have added at this end is not wanted against another run
          const endId = side === 'left' ? r.unitIds[0] : r.unitIds[r.unitIds.length - 1], endU = d.peek(endId);
          if (endU && endU.carp.module === 'panel') {
            const nextId = side === 'left' ? r.unitIds[1] : r.unitIds[r.unitIds.length - 2], nx = d.item(nextId);
            nx.carp.width = r1(nx.carp.width + endU.carp.width);
            r.unitIds = r.unitIds.filter((x) => x !== endId); d.remove(endId); newUnits.splice(newUnits.indexOf(endId), 1);
          }
        }
      }
    }
    const runIds = relayout(d, created);
    return { runIds, ids: newUnits, removed };
  }, mopts);
}
