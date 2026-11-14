/**
 * Wall-gap geometry shared by detectWalls and detectOpenings (drawing frame, cm): occupancy grid, gap finding,
 * outside flood fill.
 */
const DEFAULTS = { snap: 5, maxThickness: 40, maxOpening: 400, minOpening: 25 };

/** Occupancy grid at `snap` resolution over the walls' bounding box plus a margin. */
export function occupancy(walls, snap, margin = 2) {
  const x0 = Math.min(...walls.map((w) => w.x)) - margin * snap, y0 = Math.min(...walls.map((w) => w.y)) - margin * snap;
  const x1 = Math.max(...walls.map((w) => w.x + w.w)) + margin * snap, y1 = Math.max(...walls.map((w) => w.y + w.h)) + margin * snap;
  const nx = Math.round((x1 - x0) / snap), ny = Math.round((y1 - y0) / snap);
  const g = new Uint8Array(nx * ny);
  const cx = (x) => Math.round((x - x0) / snap), cy = (y) => Math.round((y - y0) / snap);
  const fill = (r, v) => { for (let j = cy(r.y); j < cy(r.y + r.h); j++) for (let i = cx(r.x); i < cx(r.x + r.w); i++) g[j * nx + i] = v; };
  walls.forEach((w) => fill(w, 1));
  return { g, nx, ny, x0, y0, snap, cx, cy, fill, at: (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : g[j * nx + i]) };
}

/**
 * Gaps in walls: from the free end of a wall run, the wall's thickness band stays empty for 25–400 cm and is then
 * fully closed by another wall (collinear, or the face of a crossing wall). Returns gaps in drawing cm:
 * { x, y, w, h, axis: 'h'|'v' (direction the wall runs), width, thickness, from, to (wall indices) }.
 */
export function findGaps(walls, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!walls.length) return [];
  const occ = occupancy(walls, o.snap, Math.ceil(o.maxOpening / o.snap) + 2);
  const { at, cx, cy, snap } = occ;
  const owner = new Int32Array(occ.nx * occ.ny).fill(-1);
  walls.forEach((w, n) => { for (let j = cy(w.y); j < cy(w.y + w.h); j++) for (let i = cx(w.x); i < cx(w.x + w.w); i++) owner[j * occ.nx + i] = n; });
  const gaps = [], seen = new Set();
  const maxSteps = Math.round(o.maxOpening / snap);
  walls.forEach((w, n) => {
    const i0 = cx(w.x), i1 = cx(w.x + w.w), j0 = cy(w.y), j1 = cy(w.y + w.h);
    const sideFree = (dir) => {
      if (dir === 'e') { for (let j = j0; j < j1; j++) if (at(i1, j)) return false; return true; }
      if (dir === 'w') { for (let j = j0; j < j1; j++) if (at(i0 - 1, j)) return false; return true; }
      if (dir === 's') { for (let i = i0; i < i1; i++) if (at(i, j1)) return false; return true; }
      for (let i = i0; i < i1; i++) if (at(i, j0 - 1)) return false; return true;
    };
    const opp = { e: 'w', w: 'e', s: 'n', n: 's' };
    for (const dir of ['e', 'w', 's', 'n']) {
      const horiz = dir === 'e' || dir === 'w';
      const band = horiz ? w.h : w.w, along = horiz ? w.w : w.h;
      if (band > o.maxThickness * 1.25) continue;
      if (!sideFree(dir)) continue;
      // probe only along the wall: it is elongated that way, or it is the free end of a run that continues behind it
      if (!(along > band || !sideFree(opp[dir]))) continue;
      let hit = -1, steps = 0;
      for (let s = 1; s <= maxSteps; s++) {
        let occN = 0, tot = 0, who = -1;
        if (horiz) { const i = dir === 'e' ? i1 - 1 + s : i0 - s; for (let j = j0; j < j1; j++) { tot++; if (at(i, j)) { occN++; who = owner[j * occ.nx + i]; } } }
        else { const j = dir === 's' ? j1 - 1 + s : j0 - s; for (let i = i0; i < i1; i++) { tot++; if (at(i, j)) { occN++; who = owner[j * occ.nx + i]; } } }
        if (occN === 0) continue;
        if (occN === tot) { hit = who; steps = s - 1; }
        break;
      }
      if (hit < 0) continue;
      const width = steps * snap;
      if (width < o.minOpening) continue;
      let g;
      if (dir === 'e') g = { x: w.x + w.w, y: w.y, w: width, h: w.h, axis: 'h' };
      else if (dir === 'w') g = { x: w.x - width, y: w.y, w: width, h: w.h, axis: 'h' };
      else if (dir === 's') g = { x: w.x, y: w.y + w.h, w: w.w, h: width, axis: 'v' };
      else g = { x: w.x, y: w.y - width, w: w.w, h: width, axis: 'v' };
      const key = [g.x, g.y, g.w, g.h].map((v) => v.toFixed(2)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      // a hole in a wall has free space on both faces along most of its length; a "gap" running alongside
      // another wall (a corridor next to a partition) is not an opening
      const lateral = (side) => {
        let occN = 0, n = 0;
        if (g.axis === 'h') { const j = side < 0 ? cy(g.y) - 1 : cy(g.y + g.h); for (let i = cx(g.x); i < cx(g.x + g.w); i++) { n++; if (at(i, j)) occN++; } }
        else { const i = side < 0 ? cx(g.x) - 1 : cx(g.x + g.w); for (let j = cy(g.y); j < cy(g.y + g.h); j++) { n++; if (at(i, j)) occN++; } }
        return n ? occN / n : 0;
      };
      if (lateral(-1) > 0.25 || lateral(1) > 0.25) continue;
      const hw = walls[hit];
      const collinear = g.axis === 'h' ? Math.abs(hw.y - g.y) < 0.01 && Math.abs(hw.h - g.h) < 0.01 : Math.abs(hw.x - g.x) < 0.01 && Math.abs(hw.w - g.w) < 0.01;
      gaps.push({ ...g, width, thickness: band, from: n, to: hit, collinear });
    }
  });
  return gaps;
}

/** Outside cells: flood fill from the border over free cells, with the gaps closed. */
export function outsideMask(walls, gaps, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!walls.length) return null;
  const occ = occupancy(walls, o.snap, 3);
  gaps.forEach((g) => occ.fill(g, 1));
  const { g, nx, ny } = occ;
  const out = new Uint8Array(nx * ny);
  const st = [];
  for (let i = 0; i < nx; i++) { st.push(i, (ny - 1) * nx + i); }
  for (let j = 0; j < ny; j++) { st.push(j * nx, j * nx + nx - 1); }
  while (st.length) {
    const id = st.pop();
    if (out[id] || g[id]) continue;
    out[id] = 1;
    const i = id % nx, j = (id / nx) | 0;
    if (i > 0) st.push(id - 1); if (i < nx - 1) st.push(id + 1); if (j > 0) st.push(id - nx); if (j < ny - 1) st.push(id + nx);
  }
  return { ...occ, out };
}

export function facesOutside(w, m) {
  if (!m) return { long: false, end: false };
  const { cx, cy, nx, ny, out, snap } = m;
  const isOut = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && out[j * nx + i] === 1;
  const i0 = cx(w.x), i1 = cx(w.x + w.w), j0 = cy(w.y), j1 = cy(w.y + w.h);
  const range = (a, b) => Array.from({ length: b - a }, (_, t) => a + t);
  const cnt = (cells) => cells.filter(Boolean).length;
  const hs = Math.max(cnt(range(i0, i1).map((i) => isOut(i, j0 - 1))), cnt(range(i0, i1).map((i) => isOut(i, j1))));
  const vs = Math.max(cnt(range(j0, j1).map((j) => isOut(i0 - 1, j))), cnt(range(j0, j1).map((j) => isOut(i1, j))));
  const horiz = w.w >= w.h, along = horiz ? i1 - i0 : j1 - j0;
  const longOut = horiz ? hs : vs, endOut = horiz ? vs : hs;
  const long = longOut > 0 && (longOut >= 0.2 * along || longOut * snap >= 40 || w.w === w.h);
  return { long, end: endOut > 0 && endOut >= 0.5 * (horiz ? j1 - j0 : i1 - i0) };
}

/** Which side of a gap / wall faces the outside: 'n' | 's' | 'e' | 'w' | null (drawing frame). */
export function outsideSide(r, m) {
  if (!m) return null;
  const { cx, cy, nx, ny, out } = m;
  const isOut = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && out[j * nx + i] === 1;
  const i0 = cx(r.x), i1 = cx(r.x + r.w), j0 = cy(r.y), j1 = cy(r.y + r.h);
  const count = (cells) => cells.filter(Boolean).length;
  const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, t) => a + t);
  const s = { n: count(range(i0, i1).map((i) => isOut(i, j0 - 1))), s: count(range(i0, i1).map((i) => isOut(i, j1))),
    w: count(range(j0, j1).map((j) => isOut(i0 - 1, j))), e: count(range(j0, j1).map((j) => isOut(i1, j))) };
  const best = Object.entries(s).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : null;
}


/**
 * Exterior / interior: a wall whose long side faces the outside (≥ 20 % or ≥ 40 cm of it) is exterior; a piece that
 * only touches the outside with its end is exterior only when it is as thick as the exterior walls (a partition
 * reaching the facade stays interior). Sets `kind` and `thickness` on each wall.
 */
export function classifyKinds(walls, outside) {
  const face = walls.map((w) => facesOutside(w, outside));
  const extT = walls.filter((w, i) => face[i].long).map((w) => Math.min(w.w, w.h)).sort((a, b) => a - b);
  const typicalExt = extT.length ? extT[Math.floor(extT.length / 2)] : Infinity;
  walls.forEach((w, i) => {
    w.thickness = Math.min(w.w, w.h);
    w.kind = face[i].long || (face[i].end && w.thickness >= typicalExt - 1e-6) ? 'exterior' : 'interior';
  });
  return walls;
}
