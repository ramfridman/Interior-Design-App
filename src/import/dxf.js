/**
 * DXF-aware analysis on top of the PDF engine: units → scale candidates (cross-checked against DIMENSION values, wall
 * thickness, door sizes and the building's extent), layer roles (walls / doors / windows / other) proposed from layer
 * names in Hebrew and English, block contents, hatches and geometry, and the run of the unchanged detectors
 * (analysePrims) on the layers that matter, with the wall pens taken from the wall layers.
 *
 *   const prims = readDxf(bytes);
 *   const cands = dxfScaleCandidates(prims);                 // [{ cmPerUnit (page), unit, label, source, confidence, … }]
 *   const layers = proposeLayers(prims, cands[0].cmPerUnit);  // [{ name, role, reason, … }]
 *   const res = analyseDxf(prims, { scale: { cmPerUnit }, roles: { 'A-WALL': 'wall', … }, walls: { drawing }, rotate, mirror });
 */
import { analysePrims } from './index.js';
import { penKey, segmentsOf, penStats, arcsOf, affInvert, affApply, clusters } from './prep.js';
import { scoreWallPens, pickWallPens } from './walls.js';

export const ROLES = ['wall', 'door', 'window', 'other'];

const W = '[^a-z\\u0590-\\u05ff]';
const word = (alts) => new RegExp(`(^|${W})(${alts})(${W}|$)`, 'i');
export const WALL_NAME = new RegExp(word('walls?|wand|w[äa]nde|murs?|muro|muri|pared(es)?|parete|kir|kirot|mauer|cloison').source + '|קיר|קירות|^[as][-_ ]?wall', 'i');
export const DOOR_NAME = new RegExp(word('doors?|dr|porte|portes|t[üu]r(en)?|tuer|puerta|delet|dlatot').source + '|דלת|דלתות|^a[-_ ]?door', 'i');
export const WINDOW_NAME = new RegExp(word('windows?|wind|win|glaz(ing)?|glass|fenster|fen[eê]tres?|ventanas?|finestr[ae]|halon|halonot').source + '|חלון|חלונות|^a[-_ ]?glaz', 'i');
const NOISE_NAME = /dim|anno|text|txt|note|title|frame|border|grid|axis|axes|furn|ריהוט|מידות|מידה|טקסט|כיתוב|צירים|רשת|defpoints|viewport|vport|symb|plumb|elec|light|tile|floor|ריצוף|sanit|land|tree|plant|hatch|patt|iden|area|room|חדר|שטח/i;

const UNITS = [
  { name: 'millimetres', short: 'mm', k: 0.1 }, { name: 'centimetres', short: 'cm', k: 1 }, { name: 'metres', short: 'm', k: 100 },
  { name: 'inches', short: 'in', k: 2.54 }, { name: 'feet', short: 'ft', k: 30.48 }, { name: 'decimetres', short: 'dm', k: 10 },
];
const unitLabel = (u) => `1 unit = 1 ${u.short === 'in' ? 'inch' : u.short === 'ft' ? 'foot' : u.short}`;

/** Paths of some layers (structure-sharing: the path objects are not copied). */
function subset(prims, keep, keepFill = keep) {
  return { ...prims, paths: prims.paths.filter((p) => (p.fill && !p.stroke ? keepFill(p.layer) : keep(p.layer))), texts: [] };
}

/** Thickness evidence: the best wall pen at this scale (restricted to wall layers when there are some). */
function wallEvidence(prims, cmPerUnit, pre, wallLayers) {
  let scored = scoreWallPens(prims, cmPerUnit, {}, pre);
  if (wallLayers && wallLayers.size) scored = scored.filter((s) => wallLayers.has(s.pen.split('|').slice(3).join('|')));
  const best = pickWallPens(scored)[0];
  return best ? { thickness: best.thickness, score: best.score } : { thickness: null, score: 0 };
}

/**
 * Scale candidates for a DXF: one per plausible unit, page units → cm. Declared units ($INSUNITS) are trusted unless
 * the dimensions and the building's proportions contradict them (a common slip: $INSUNITS = mm on a drawing in cm).
 */
export function dxfScaleCandidates(prims, { wallLayers = null } = {}) {
  const d = prims.dxf;
  const decl = d.units.cmPerUnit;
  const pre = penStats(segmentsOf(prims));
  const arcs = arcsOf(prims).filter((a) => Math.abs(a.sweep) >= 70 && Math.abs(a.sweep) <= 110);
  // extent of the wall layers (else of everything), drawing units
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of prims.paths) {
    if (wallLayers && wallLayers.size && !wallLayers.has(p.layer)) continue;
    for (let i = 0; i < p.pts.length; i += 2) { x0 = Math.min(x0, p.pts[i]); x1 = Math.max(x1, p.pts[i]); y0 = Math.min(y0, p.pts[i + 1]); y1 = Math.max(y1, p.pts[i + 1]); }
  }
  const extPage = Number.isFinite(x0) ? Math.max(x1 - x0, y1 - y0) : 0;
  const dims = (prims.dims || []).filter((q) => q.du > 1e-9 && q.value > 0);
  const list = [];
  const usable = decl && !UNITS.some((u) => Math.abs(u.k - decl) < 1e-9) ? [...UNITS, { name: d.units.name, short: d.units.name, k: decl }] : UNITS;
  for (const u of usable) {
    const cmPerUnit = d.duPerPageUnit * u.k;
    // dimensions: the number shown, read as cm / mm / m, equals the measured length in this unit
    let match = 0;
    for (const q of dims) {
      const real = q.du * u.k, v = q.value;
      if ([v, v / 10, v * 100].some((c) => Math.abs(c - real) <= 0.015 * real + 0.05)) match++;
    }
    const dimFrac = dims.length ? match / dims.length : null;
    const ext = extPage * cmPerUnit;
    const extScore = ext >= 250 && ext <= 15000 ? 1 : ext >= 100 && ext <= 50000 ? 0.3 : 0.05;
    const wall = wallEvidence(prims, cmPerUnit, pre, wallLayers);
    const thScore = wall.thickness ? (wall.thickness >= 7 && wall.thickness <= 45 ? 1 : 0.3) : 0.5;
    const radii = arcs.map((a) => a.r * cmPerUnit);
    const doorish = radii.filter((r) => r >= 55 && r <= 130).length;
    const doorScore = radii.length ? (doorish / radii.length >= 0.5 ? 1 : doorish ? 0.6 : 0.25) : 0.6;
    const plaus = extScore * thScore * doorScore;
    const declared = decl != null && Math.abs(decl - u.k) < 1e-9;
    const score = (declared ? 4 : 1) * (dimFrac == null ? 0.6 : 0.05 + dimFrac) * plaus;
    list.push({ cmPerUnit, ratio: null, unit: u.name, cmPerDrawingUnit: u.k, declared, score,
      evidence: { declared, dimensions: dims.length ? { agree: match, of: dims.length } : null, extentM: +(ext / 100).toFixed(2), wallThickness: wall.thickness && +wall.thickness.toFixed(1), doorArcs: radii.length, doorSized: doorish } });
  }
  list.sort((a, b) => b.score - a.score);
  const tot = list.reduce((t, c) => t + c.score, 0) || 1;
  return list.filter((c) => c.score > 0.02 * list[0].score).slice(0, 4).map((c, i) => {
    const share = c.score / tot;
    const dimOk = c.evidence.dimensions && c.evidence.dimensions.agree >= Math.max(1, 0.6 * c.evidence.dimensions.of);
    const source = c.declared ? 'units' : dimOk ? 'dimensions' : 'geometry';
    let conf = source === 'units' ? 0.6 + 0.39 * share : source === 'dimensions' ? 0.45 + 0.45 * share : Math.min(0.7, 0.7 * share);
    if (i > 0) conf = Math.min(conf, 0.6);
    const label = unitLabel(UNITS.find((u) => u.name === c.unit) || { short: c.unit });
    return { cmPerUnit: c.cmPerUnit, ratio: null, label, unit: c.unit, cmPerDrawingUnit: c.cmPerDrawingUnit, source, confidence: +conf.toFixed(2), evidence: c.evidence };
  });
}

/** Layer roles: names first (Hebrew / English / a few European), then block contents, hatches and geometry. */
export function proposeLayers(prims, cmPerUnit = prims.dxf ? prims.dxf.cmPerPageUnit : 1) {
  const blocks = new Map((prims.blocks || []).map((b) => [b.name, b]));
  const insertsBy = new Map();
  for (const n of prims.inserts || []) { const a = insertsBy.get(n.layer) || []; a.push(n); insertsBy.set(n.layer, a); }
  const out = (prims.layers || []).map((L) => {
    const r = { ...L, role: 'other', reason: L.visible ? 'not recognised' : 'hidden in the file' };
    if (!L.count) { r.reason = 'empty'; return r; }
    const name = L.name;
    if (WALL_NAME.test(name) && !/dim|text|txt|iden/i.test(name)) Object.assign(r, { role: 'wall', reason: 'layer name' });
    else if (DOOR_NAME.test(name)) Object.assign(r, { role: 'door', reason: 'layer name' });
    else if (WINDOW_NAME.test(name)) Object.assign(r, { role: 'window', reason: 'layer name' });
    else {
      const ins = insertsBy.get(name) || [];
      const kinds = ins.map((n) => (blocks.get(n.block) || {}).kind);
      const doors = kinds.filter((k) => k === 'door').length, wins = kinds.filter((k) => k === 'window').length;
      if (ins.length && doors >= Math.max(1, 0.5 * ins.length)) Object.assign(r, { role: 'door', reason: 'door blocks' });
      else if (ins.length && wins >= Math.max(1, 0.5 * ins.length)) Object.assign(r, { role: 'window', reason: 'window blocks' });
    }
    if (!L.visible && r.reason === 'layer name') r.reason = 'layer name (hidden in the file)';
    return r;
  });
  const byName = new Map(out.map((r) => [r.name, r]));
  if (!out.some((r) => r.role === 'wall')) {
    // hatches: a layer whose fills are narrow wall-thickness bands
    const fillsBy = new Map();
    for (const p of prims.paths) {
      if (!p.fill || p.stroke) continue;
      const xs = [], ys = []; for (let i = 0; i < p.pts.length; i += 2) { xs.push(p.pts[i]); ys.push(p.pts[i + 1]); }
      const t = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * cmPerUnit;
      const e = fillsBy.get(p.layer) || { n: 0, ok: 0 }; e.n++; if (t >= 6 && t <= 45) e.ok++; fillsBy.set(p.layer, e);
    }
    for (const [name, e] of fillsBy) if (e.ok >= 4 && e.ok >= 0.6 * e.n) { const r = byName.get(name); if (r && r.role === 'other' && !/furn|ריהוט|tile|floor|ריצוף/i.test(name)) Object.assign(r, { role: 'wall', reason: 'wall hatch' }); }
  }
  if (!out.some((r) => r.role === 'wall')) {
    // geometry: the layer whose lines pair up at a wall thickness
    const scored = scoreWallPens(prims, cmPerUnit, {});
    const best = new Map();
    for (const s of scored) { const layer = s.pen.split('|').slice(3).join('|'); if (!best.has(layer) || best.get(layer).score < s.score) best.set(layer, s); }
    const ranked = [...best.entries()].filter(([name]) => !NOISE_NAME.test(name)).sort((a, b) => b[1].score - a[1].score);
    if (ranked.length && ranked[0][1].score > 0.02) {
      const top = ranked[0][1].score;
      for (const [name, s] of ranked) if (s.score >= 0.4 * top) { const r = byName.get(name); if (r && r.role === 'other' && r.visible) Object.assign(r, { role: 'wall', reason: 'parallel lines at wall thickness' }); }
    }
  }
  return out;
}

/** Scale candidates and layer roles before anything is confirmed: names → wall layers → units / dimensions /
 *  proportions → roles again at the best scale (the geometric wall test needs a scale). */
export function firstLook(prims) {
  const byName = proposeLayers(prims, prims.dxf.cmPerPageUnit);
  const wl = new Set(byName.filter((L) => L.role === 'wall').map((L) => L.name));
  const candidates = dxfScaleCandidates(prims, { wallLayers: wl });
  const cmPerUnit = candidates[0] ? candidates[0].cmPerUnit : prims.dxf.cmPerPageUnit;
  return { candidates, cmPerUnit, layers: proposeLayers(prims, cmPerUnit) };
}

/** The roles in force: the user's overrides over the proposal. */
export function rolesOf(layers, overrides = {}) {
  const m = {};
  for (const L of layers) m[L.name] = overrides[L.name] || L.role;
  return m;
}

/**
 * Detection on a DXF, with the unchanged engine. opts: { scale: { cmPerUnit } (page units), roles: { layer: role },
 * walls: { drawing, … }, openings, rotate, mirror }. Returns the analysePrims result plus `scaleCandidates` (DXF
 * candidates), `layers` (with roles) and DXF warnings.
 */
export function analyseDxf(prims, opts = {}) {
  const first = opts.candidates && opts.layers ? null : firstLook(prims);
  const cands = opts.candidates || first.candidates;
  const k = (opts.scale && opts.scale.cmPerUnit) || (cands[0] && cands[0].cmPerUnit) || prims.dxf.cmPerPageUnit;
  const proposal = opts.layers || (first && Math.abs(first.cmPerUnit - k) < 1e-9 * k ? first.layers : proposeLayers(prims, k));
  const roles = rolesOf(proposal, opts.roles || {});
  const wallLayers = new Set(Object.keys(roles).filter((n) => roles[n] === 'wall'));
  const symLayers = Object.keys(roles).filter((n) => roles[n] === 'door' || roles[n] === 'window');
  const visible = new Map(proposal.map((L) => [L.name, L.visible]));
  // what the detectors see: wall, door and window layers; when no door / window layer is known, every other visible
  // layer whose name does not say dimensions / text / furniture …
  const keep = (layer) => {
    const r = roles[layer] || 'other';
    if (r !== 'other') return true;
    if (symLayers.length) return false;
    return visible.get(layer) !== false && !NOISE_NAME.test(layer);
  };
  let aprims = subset(prims, keep, (layer) => (wallLayers.size ? wallLayers.has(layer) : keep(layer)));
  if (wallLayers.size) aprims = hatchOutlines(aprims, wallLayers);
  const walls = { ...(opts.walls || {}) };
  if (wallLayers.size && !walls.pens) {
    // pens of the wall layers; when those layers also hold door swings (everything on one layer), let the engine pick
    // among them by weight and pairing instead of taking every line as a wall line
    const pens = new Set();
    let mixed = false;
    for (const p of aprims.paths) if (p.stroke && wallLayers.has(p.layer)) { pens.add(penKey(p)); }
    for (const L of proposal) if (wallLayers.has(L.name) && L.quarterArcs > 0) mixed = true;
    if (mixed) {
      const scored = scoreWallPens(aprims, k, walls).filter((s) => pens.has(s.pen));
      walls.pens = pickWallPens(scored).map((s) => s.pen);
    } else walls.pens = [...pens];
  }
  const out = analysePrims(aprims, { ...opts, scale: { cmPerUnit: k }, walls });
  const chosen = cands.find((c) => Math.abs(c.cmPerUnit - k) < 1e-9 * k);
  out.scale = chosen ? { ...chosen } : { cmPerUnit: k, ratio: null, label: 'given', source: 'user', confidence: 1 };
  out.scaleCandidates = cands;
  out.layers = proposal.map((L) => ({ ...L, role: roles[L.name] }));
  out.kind = 'dxf';
  const w = [...(prims.warnings || [])];
  const decl = cands.find((c) => c.source === 'units');
  if (decl && cands[0] && cands[0] !== decl && cands[0].confidence > decl.confidence) w.push({ code: 'dxf-units-doubt', text: `The file says it is drawn in ${decl.unit}, but its dimensions and proportions fit ${cands[0].unit}; check the scale.`, where: null });
  if (!wallLayers.size) w.push({ code: 'dxf-no-wall-layer', text: 'No layer looks like walls by name; walls were found from line weight and pairing. Tick the wall layers in step 1 if the result is off.', where: null });
  out.warnings = out.warnings.filter((x) => x.code !== 'scale-guessed').concat(w);
  // block evidence on openings: the block inserted at the opening
  if (out.transform && prims.inserts && prims.inserts.length) {
    const inv = affInvert(out.transform);
    for (const o of out.openings) {
      let box = o;
      if (o.axis === 'a') {   // opening in a slant (slants option): a square of its width around its centre
        const s = (out.slants || []).find((q) => q.id === o.wall);
        if (!s) continue;
        const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1, cx = s.x1 + (s.x2 - s.x1) * o.at / L, cy = s.y1 + (s.y2 - s.y1) * o.at / L;
        box = { x: cx - o.width / 2, y: cy - o.width / 2, w: o.width, h: o.width };
      }
      const c = [[box.x, box.y], [box.x + box.w, box.y + box.h]].map(([x, y]) => affApply(inv, x, y));
      const bx0 = Math.min(c[0][0], c[1][0]), bx1 = Math.max(c[0][0], c[1][0]), by0 = Math.min(c[0][1], c[1][1]), by1 = Math.max(c[0][1], c[1][1]);
      const ov = (q) => Math.max(0, Math.min(bx1, q.bbox.x + q.bbox.w + 1) - Math.max(bx0, q.bbox.x - 1)) * Math.max(0, Math.min(by1, q.bbox.y + q.bbox.h + 1) - Math.max(by0, q.bbox.y - 1));
      let n = null, best = 0;
      for (const q of prims.inserts) { const a = ov(q); if (a > best) { best = a; n = q; } }
      if (n) o.evidence = { ...(o.evidence || {}), block: n.block };
    }
  }
  return out;
}

/** Door widths from door-block inserts (cm at the given drawing-unit size): block extent × insert scale. */
export function doorBlockWidths(prims, cmPerDrawingUnit) {
  const blocks = new Map((prims.blocks || []).map((b) => [b.name, b]));
  const out = [];
  for (const n of prims.inserts || []) {
    const b = blocks.get(n.block);
    if (!b || b.kind !== 'door') continue;
    out.push(Math.max(b.w * Math.abs(n.sx), b.h * Math.abs(n.sy)) * cmPerDrawingUnit);
  }
  return clusters(out.map((v) => ({ v, w: 1 })), 0.05);
}

/**
 * Walls drawn only as hatches / solids (poché, often one hatch per wall piece or one hatch per whole wall ring with
 * holes): the union of the wall layers' filled regions (even–odd inside each hatch, union across hatches) is turned into
 * its boundary lines on the same layer, so the engine's parity fill reads any rectilinear wall shape exactly. Only when
 * the wall layers carry little line work of their own (outlines, when present, win). Non-rectilinear hatch loops
 * become plain boundary lines (reported by the engine as angled / curved walls).
 */
export function hatchOutlines(prims, wallLayers) {
  const fills = [], rest = [];
  let strokeLen = 0, perim = 0;
  for (const p of prims.paths) {
    const onWall = wallLayers.has(p.layer);
    if (onWall && p.fill && !p.stroke) { fills.push(p); for (let i = 2; i < p.pts.length; i += 2) perim += Math.hypot(p.pts[i] - p.pts[i - 2], p.pts[i + 1] - p.pts[i - 1]); continue; }
    if (onWall && p.stroke && !p.curved) for (let i = 2; i < p.pts.length; i += 2) strokeLen += Math.hypot(p.pts[i] - p.pts[i - 2], p.pts[i + 1] - p.pts[i - 1]);
    rest.push(p);
  }
  if (!fills.length || strokeLen >= 0.3 * perim) return prims;
  const line = (p, x1, y1, x2, y2) => ({ pts: [x1, y1, x2, y2], closed: false, stroke: true, fill: false, evenOdd: false, lw: 1.42, color: p.fillColor, fillColor: p.fillColor,
    dash: [], curved: false, layer: p.layer, kind: 'hatch-outline' });
  const groups = new Map();
  const out = [];
  const eps = 1e-6;
  for (const p of fills) {
    let rect = true;
    for (let i = 2; i < p.pts.length; i += 2) {
      const dx = Math.abs(p.pts[i] - p.pts[i - 2]), dy = Math.abs(p.pts[i + 1] - p.pts[i - 1]);
      if (Math.min(dx, dy) > eps * (1 + Math.max(dx, dy))) { rect = false; break; }
    }
    if (!rect) { for (let i = 2; i < p.pts.length; i += 2) out.push(line(p, p.pts[i - 2], p.pts[i - 1], p.pts[i], p.pts[i + 1])); continue; }
    const k = p.group || p;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  if (groups.size) {
    const uniq = (vals) => { vals.sort((a, b) => a - b); const u = []; for (const v of vals) if (!u.length || v - u[u.length - 1] > 1e-6) u.push(v); return u; };
    const xv = [], yv = [];
    for (const list of groups.values()) for (const p of list) for (let i = 0; i < p.pts.length; i += 2) { xv.push(p.pts[i]); yv.push(p.pts[i + 1]); }
    const xs = uniq(xv), ys = uniq(yv), nx = xs.length - 1, ny = ys.length - 1;
    if (nx >= 1 && ny >= 1 && nx * ny <= 16e6) {
      const idx = (arr, v) => { let lo = 0, hi = arr.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v - 1e-6) lo = m + 1; else hi = m; } return lo; };
      const U = new Uint8Array(nx * ny), row = new Uint8Array(nx);
      const owner = new Map();   // a representative path per filled region (colour / layer of the outline)
      for (const list of groups.values()) {
        const vert = [];
        let y0 = Infinity, y1 = -Infinity;
        for (const p of list) for (let i = 2; i < p.pts.length; i += 2) {
          const xa = p.pts[i - 2], ya = p.pts[i - 1], xb = p.pts[i], yb = p.pts[i + 1];
          if (Math.abs(xa - xb) <= 1e-6 && Math.abs(ya - yb) > 1e-6) { vert.push([idx(xs, xa), idx(ys, Math.min(ya, yb)), idx(ys, Math.max(ya, yb))]); y0 = Math.min(y0, ya, yb); y1 = Math.max(y1, ya, yb); }
        }
        if (!vert.length) continue;
        for (let j = idx(ys, y0); j < idx(ys, y1); j++) {
          row.fill(0);
          for (const [i, a, b] of vert) if (a <= j && j < b) for (let q = i; q < nx; q++) row[q] ^= 1;
          for (let i = 0; i < nx; i++) if (row[i]) { U[j * nx + i] = 1; if (!owner.has(j * nx + i)) owner.set(j * nx + i, list[0]); }
        }
      }
      const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : U[j * nx + i]);
      const rep = (i, j) => owner.get(j * nx + i) || fills[0];
      // horizontal boundaries (between rows j − 1 and j), merged along x
      for (let j = 0; j <= ny; j++) {
        let start = -1, who = null;
        for (let i = 0; i <= nx; i++) {
          const edge = i < nx && at(i, j - 1) !== at(i, j);
          if (edge && start < 0) { start = i; who = at(i, j) ? rep(i, j) : rep(i, j - 1); }
          if (!edge && start >= 0) { out.push(line(who, xs[start], ys[j], xs[i], ys[j])); start = -1; }
        }
      }
      for (let i = 0; i <= nx; i++) {
        let start = -1, who = null;
        for (let j = 0; j <= ny; j++) {
          const edge = j < ny && at(i - 1, j) !== at(i, j);
          if (edge && start < 0) { start = j; who = at(i, j) ? rep(i, j) : rep(i - 1, j); }
          if (!edge && start >= 0) { out.push(line(who, xs[i], ys[start], xs[i], ys[j])); start = -1; }
        }
      }
    } else for (const list of groups.values()) for (const p of list) out.push({ ...p });
  }
  return { ...prims, paths: rest.concat(out) };
}
