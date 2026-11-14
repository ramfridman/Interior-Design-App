// DWG import (src/import/dwg-read.js: GNU LibreDWG as WebAssembly, vendor/dwg/): every DWG fixture must give what its
// DXF twin gives — the DXF fixtures of tests/import.dxf.test.mjs, written as DWG by tests/fixtures/dwg/make-fixtures.mjs
// (acad-ts, an independent DWG writer). Runs in Node (the same .wasm the browser loads).   node tests/import.dwg.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PLAN } from '../src/core/plan.js';
import { readDwg, readDxf, analyseDxf, firstLook, detectStairSymbols, detectVoidSymbols, alignFloors, DWG_VERSIONS } from '../src/import/index.js';
import { houseDxf } from './dxf-fixtures.mjs';
import { dxfOf, wedgeDrawing, WEDGE } from './import-slant-fixtures.mjs';
import { duplexFloor, duplexSheet, floorsDxf, mapFloor } from './import-floor-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'tests/fixtures/dwg');
const fixture = (name) => {
  const b = fs.readFileSync(path.join(FIX, name));
  return name.endsWith('.gz') ? zlib.gunzipSync(b) : b;
};
let ok = true;
const fail = (m) => { ok = false; console.error('FAIL', m); };
const check = (cond, m) => { if (!cond) fail(m); else console.log('  ok', m); };
const t0 = Date.now();

// ---------- comparison helpers (as in tests/import.dxf.test.mjs) ----------
function cells(rects, step = 5) {
  const s = new Set();
  for (const r of rects) for (let y = r.y; y < r.y + r.h - 1e-6; y += step) for (let x = r.x; x < r.x + r.w - 1e-6; x += step) s.add(Math.round(x) + ',' + Math.round(y));
  return s;
}
function compareWalls(found, plan, tol = 1) {
  const fu = cells(found, 1), pu = cells(plan, 1);
  let sym = 0; for (const k of fu) if (!pu.has(k)) sym++; for (const k of pu) if (!fu.has(k)) sym++;
  const missing = plan.filter((p) => { const c = cells([p], 1); let n = 0; for (const k of c) if (fu.has(k)) n++; return n < c.size; });
  const grown = cells(plan.map((r) => ({ x: r.x - tol, y: r.y - tol, w: r.w + 2 * tol, h: r.h + 2 * tol })), 1);
  const stickOut = found.filter((f) => [...cells([f], 1)].some((k) => !grown.has(k)));
  return { symDiffCm2: sym, missing, stickOut };
}
function compareOpenings(found, plan, tol = 1) {
  const used = new Set(), rows = [];
  for (const p of plan) {
    const m = found.find((f) => !used.has(f) && Math.abs(f.x - p.x) <= tol && Math.abs(f.y - p.y) <= tol && Math.abs(f.w - p.w) <= tol && Math.abs(f.h - p.h) <= tol);
    if (m) used.add(m);
    rows.push({ p, m, kindOk: !!m && m.kind === p.kind, widthOk: !!m && Math.abs(m.width - p.width) <= tol,
      hingeOk: !p.hinge || (!!m && m.hinge === p.hinge && m.swing === p.swing),
      innerOk: !p.innerDoor || (!!m && !!m.innerDoor && m.innerDoor.hinge === p.innerDoor.hinge && m.innerDoor.swing === p.innerDoor.swing) });
  }
  return { rows, extra: found.filter((f) => !used.has(f)) };
}
const look = (prims, o = {}) => { const l = firstLook(prims); return { l, r: analyseDxf(prims, { candidates: l.candidates, layers: l.layers, ...o }) }; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const roles = (res) => Object.fromEntries(res.layers.map((l) => [l.name, l.role]));

// ---------- (a) the built-in house in every DWG version R13 … 2018: = its DXF twin, walls / openings exact ----------
const twinPrims = readDxf(houseDxf({ unit: 1, insunits: 5 }).bytes()), twin = look(twinPrims);
const VERSIONS = [['r13', 'AC1012'], ['r14', 'AC1014'], ['2000', 'AC1015'], ['2004', 'AC1018'], ['2007', 'AC1021'], ['2010', 'AC1024'], ['2013', 'AC1027'], ['2018', 'AC1032']];
for (const [label, code] of VERSIONS) {
  const t = Date.now();
  const prims = await readDwg(fixture(`house-cm-${label}.dwg`));
  const ms = Date.now() - t;
  const { r: res } = look(prims);
  const cw = compareWalls(res.walls, PLAN.walls, 1), co = compareOpenings(res.openings, PLAN.openings, 1);
  const preR2000 = code === 'AC1012' || code === 'AC1014';     // $INSUNITS only exists from the 2000 format on
  console.log(`\n== house, cm, DWG ${label} (${code}, ${DWG_VERSIONS[code]}): ${prims.paths.length} paths, units ${prims.dxf.units.name}, scale ${res.scale.label} (${res.scale.source}), ${res.walls.length} walls, ${res.openings.length} openings, read in ${ms} ms`);
  check(prims.source && prims.source.format === 'dwg' && prims.source.version === code && prims.dxf.units.version === code, `${label}: read as DWG ${code}`);
  check(Math.abs(res.scale.cmPerDrawingUnit - 1) < 1e-12 && res.scale.source === (preR2000 ? 'dimensions' : 'units'), `${label}: 1 unit = 1 cm, from ${preR2000 ? 'the dimensions (no $INSUNITS before the 2000 format)' : 'the file\'s units'}`);
  check(cw.missing.length === 0 && cw.stickOut.length === 0 && cw.symDiffCm2 === 0, `${label}: every wall within 1 cm (wall area identical)`);
  check(co.rows.every((r) => r.m && r.kindOk && r.widthOk && r.hingeOk && r.innerOk) && co.extra.length === 0, `${label}: all ${PLAN.openings.length} openings, kind / width / hinge / swing right, none extra`);
  check(same(res.walls, twin.r.walls) && same(res.openings, twin.r.openings), `${label}: walls and openings byte-identical to the DXF twin`);
  check(same(roles(res), roles(twin.r)), `${label}: layer roles = the DXF twin's (${Object.entries(roles(res)).filter(([, v]) => v !== 'other').map(([k, v]) => `${k} ${v}`).join(', ')})`);
  if (label === '2018') {
    check(prims.dims.length === 4 && prims.dims.every((d) => Math.abs(d.value - d.du) < 1e-6), '2018: the 4 DIMENSIONs read with their measured values');
    check(prims.texts.some((t) => t.str === 'LIVING') && prims.texts.some((t) => t.str === 'ROOM') && prims.texts.some((t) => t.str === 'GROUND FLOOR PLAN'), '2018: TEXT and MTEXT read (formatting stripped)');
    check(prims.blocks.find((b) => b.name === 'DOOR-90').kind === 'door' && prims.inserts.length === twinPrims.inserts.length && same(prims.blocks.map((b) => [b.name, b.count, b.kind]), twinPrims.blocks.map((b) => [b.name, b.count, b.kind])), `2018: blocks and their ${prims.inserts.length} inserts as in the DXF (door block recognised)`);
    const L = (n) => prims.layers.find((l) => l.name === n);
    check(L('A-WALL') && L('A-DOOR').colour === '#00ff00' && L('A-GLAZ').colour === '#00ffff' && L('A-WALL').lineweight === 0.5, '2018: layer colours and line weight read');
  }
}

// ---------- (b) millimetres; Hebrew layer names (code page 1255 in a 2000 file, UTF-16 in a 2018 file) ----------
{
  const prims = await readDwg(fixture('house-mm-2018.dwg'));
  const { r: res } = look(prims);
  const t = look(readDxf(houseDxf({ unit: 0.1, insunits: 4 }).bytes())).r;
  console.log(`\n== house, mm, 2018: units ${prims.dxf.units.name}, scale ${res.scale.label}`);
  check(prims.dxf.units.name === 'millimetres' && Math.abs(res.scale.cmPerDrawingUnit - 0.1) < 1e-12 && res.scale.source === 'units', 'mm: 1 unit = 0.1 cm from the file\'s units');
  check(same(res.walls, t.walls) && same(res.openings, t.openings) && compareWalls(res.walls, PLAN.walls).symDiffCm2 === 0, 'mm: walls and openings identical to the DXF twin, wall area exact');
}
const HEB = { names: { wall: 'קירות', door: 'דלתות', window: 'חלונות', dim: 'מידות', furn: 'ריהוט' }, title: 'תכנית קומת קרקע' };
for (const f of ['house-hebrew-2000.dwg', 'house-hebrew-2018.dwg']) {
  const prims = await readDwg(fixture(f));
  const { r: res } = look(prims);
  const t = look(readDxf(houseDxf({ unit: 1, insunits: 5, version: 'AC1015', codepage: 'ANSI_1255', ...HEB }).bytes())).r;
  console.log(`\n== ${f}: layers ${prims.layers.map((l) => l.name).join(', ')}; code page ${prims.dxf.units.codepage}`);
  check(prims.layers.some((l) => l.name === 'קירות' && l.dir === 'rtl') && prims.texts.some((t2) => t2.str === 'תכנית קומת קרקע' && t2.dir === 'rtl'), `${f}: Hebrew layer names and text decoded`);
  check(roles(res)['קירות'] === 'wall' && roles(res)['דלתות'] === 'door' && roles(res)['חלונות'] === 'window' && roles(res)['ריהוט'] === 'other', `${f}: Hebrew layer names → walls / doors / windows`);
  check(same(res.walls, t.walls) && same(res.openings, t.openings), `${f}: walls and openings identical to the DXF twin`);
}

// ---------- (c) the Wedge (angled walls, slants option) ----------
{
  const d = wedgeDrawing();
  const tp = readDxf(dxfOf({ lines: d.lines, symLines: d.doorLines, symArcs: d.arcs, winLines: d.winLines }).bytes());
  const prims = await readDwg(fixture('wedge-2018.dwg'));
  const r = analyseDxf(prims, { slants: true }), t = analyseDxf(tp, { slants: true });
  const r0 = analyseDxf(prims), t0d = analyseDxf(tp);
  console.log(`\n== Wedge, 2018: ${r.walls.length} rects, slants ${JSON.stringify((r.slants || []).map((s) => [s.t, s.kind]))}, ${r.openings.length} openings, unsupported ${r.unsupported.length}`);
  check(r.slants && r.slants.length === WEDGE.slants.length && r.unsupported.length === 0 && r.openings.length === 4, 'Wedge: 2 slants, 4 openings, nothing unsupported (slants option)');
  check(same(r.walls, t.walls) && same(r.slants, t.slants) && same(r.openings, t.openings), 'Wedge: rectangles, slants and openings identical to the DXF twin');
  check(r0.unsupported.length === 4 && !('slants' in r0) && same(r0.unsupported, t0d.unsupported), 'Wedge, default: the angled pieces only reported, as from the DXF');
}

// ---------- (d) the two-floor Duplex: one sheet with both plans, and two files (the first floor turned 90°) ----------
{
  const prims = await readDwg(fixture('duplex-sheet-2018.dwg'));
  const tp = readDxf(floorsDxf(duplexSheet()).bytes());
  const { l, r: first } = look(prims), t = look(tp);
  const rs = [0, 1].map((k) => analyseDxf(prims, { candidates: l.candidates, layers: l.layers, walls: { drawing: k } }));
  const ts = [0, 1].map((k) => analyseDxf(tp, { candidates: t.l.candidates, layers: t.l.layers, walls: { drawing: k } }));
  console.log(`\n== Duplex sheet, 2018: drawings ${JSON.stringify((first.drawings || []).map((x) => x.walls))}`);
  check((first.drawings || []).length === 2 && same(first.drawings, t.r.drawings), 'Duplex sheet: 2 drawings, as from the DXF');
  check(rs.every((r, k) => same(r.walls, ts[k].walls) && same(r.openings, ts[k].openings)), 'Duplex sheet: each drawing\'s walls and openings identical to the DXF twin');
  const gi = rs.findIndex((r) => detectStairSymbols(prims, r).length === 1);
  check(gi >= 0 && detectVoidSymbols(prims, rs[1 - gi]).length === 1 && same(detectStairSymbols(prims, rs[gi]), detectStairSymbols(tp, ts[gi])), 'Duplex sheet: the stair on one floor, its opening on the other (as from the DXF)');

  const g = await readDwg(fixture('duplex-ground-2013.dwg')), u = await readDwg(fixture('duplex-first-2013.dwg'));
  const tg = readDxf(floorsDxf([duplexFloor(0)]).bytes()), tu = readDxf(floorsDxf([mapFloor(duplexFloor(1), ([x, y]) => [800 - y, x])]).bytes());
  const [a0, a1, b0, b1] = [g, u, tg, tu].map((p) => look(p).r);
  const st0 = detectStairSymbols(g, a0), mk1 = [...detectVoidSymbols(u, a1), ...detectStairSymbols(u, a1)];
  const al = alignFloors(a0, a1, { lowerMarks: st0, upperMarks: mk1 });
  const bl = alignFloors(b0, b1, { lowerMarks: detectStairSymbols(tg, b0), upperMarks: [...detectVoidSymbols(tu, b1), ...detectStairSymbols(tu, b1)] });
  console.log(`== Duplex, two 2013 files: alignment rot ${al.rot}, dx ${al.dx}, dy ${al.dy}`);
  check(same(a0.walls, b0.walls) && same(a1.walls, b1.walls) && same(a0.openings, b0.openings) && same(a1.openings, b1.openings), 'Duplex, two files: both floors identical to their DXF twins');
  check(al.rot === 270 && al.rot === bl.rot && Math.abs(al.dx - bl.dx) < 1e-9 && Math.abs(al.dy - bl.dy) < 1e-9, 'Duplex, two files: the floors line up the same way (turned 270°)');
}

// ---------- (e) errors in plain words ----------
{
  const err = async (bytes) => { try { await readDwg(bytes); return null; } catch (e) { return e; } };
  const full = fixture('house-cm-2018.dwg');
  for (const [frac, label] of [[0.6, '60 %'], [0.2, '20 %']]) {
    const e = await err(full.subarray(0, Math.floor(full.length * frac)));
    check(e && e.plain && e.code === 'dwg-unreadable' && /incomplete or damaged/.test(e.message) && /save it as DXF/.test(e.message), `truncated DWG (first ${label}) → plain error (“${e && e.message}”)`);
  }
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);
  const e1 = await err(png);
  check(e1 && e1.plain && e1.code === 'dwg-not-dwg' && /not a DWG drawing/.test(e1.message), `a PNG renamed .dwg → plain error (“${e1 && e1.message}”)`);
  const e2 = await err(Buffer.from('hello, this is not a drawing\n'));
  check(e2 && e2.plain && e2.code === 'dwg-not-dwg', 'a text file renamed .dwg → plain error');
  const e3 = await err(Buffer.concat([Buffer.from('AC1009'), Buffer.alloc(500)]));
  check(e3 && e3.plain && e3.code === 'dwg-old-version' && /R11 \/ R12/.test(e3.message) && /DXF/.test(e3.message), `an R12 DWG → “version not supported, save as DXF” (“${e3 && e3.message}”)`);
  const e4 = await err(Buffer.concat([Buffer.from('AC1040'), Buffer.alloc(500)]));
  check(e4 && e4.plain && e4.code === 'dwg-new-version' && /newer/.test(e4.message), 'a DWG format newer than 2018 → plain error');
  const e5 = await err(new Uint8Array(0));
  check(e5 && e5.plain && e5.code === 'dwg-empty', 'empty file → plain error');
  const e6 = await err(Buffer.concat([Buffer.from('AC1018'), Buffer.alloc(5000, 7)]));
  check(e6 && e6.plain && e6.code === 'dwg-unreadable', 'a damaged 2004 file (header only, then junk) → plain error');
  // the known trap: an R2000 file with ~4 100 objects written by acad-ts (vendor/dwg/README.md) → plain error, and the
  // reader keeps working (each read gets a fresh WebAssembly instance)
  const e7 = await err(fixture('many-objects-2000.dwg.gz'));
  check(e7 && e7.plain && e7.code === 'dwg-unreadable' && /save it as DXF/.test(e7.message), `R2000 file with ~4 100 objects: LibreDWG's converter traps → plain error (“${e7 && e7.message.slice(0, 70)}…”)`);
  const again = await readDwg(fixture('house-cm-2000.dwg'));
  check(same(look(again).r.walls, twin.r.walls), '…and the next DWG still reads correctly');
  // a DXF that was given a .dwg name is read as the DXF it is
  const dx = await readDwg(houseDxf({ unit: 1, insunits: 5 }).bytes());
  check(dx.kind === 'dxf' && same(look(dx).r.walls, twin.r.walls) && !dx.source, 'a DXF named .dwg is read as DXF');
  const big = await err(new Uint8Array(41 * 1048576).fill(65));
  check(big && big.code === 'dwg-too-big', 'over 40 MB → plain “too large” message');
}

// ---------- (f) no run-time code generation: the reader works with eval / new Function disabled ----------
{
  const r = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '-e',
    `import { readDwg } from ${JSON.stringify(path.join(root, 'src/import/dwg-read.js'))}; import fs from 'node:fs';
     const p = await readDwg(fs.readFileSync(${JSON.stringify(path.join(FIX, 'house-cm-2018.dwg'))})); console.log(p.paths.length);`], { encoding: 'utf8' });
  check(r.status === 0 && +r.stdout.trim() === 95, `reads under node --disallow-code-generation-from-strings (no eval / new Function) (${(r.stdout + r.stderr).trim().slice(0, 120)})`);
}

// ---------- (g) a 6 MB DWG: time and memory ----------
{
  const bytes = fixture('big-2000.dwg.gz');
  if (global.gc) global.gc();
  const m0 = process.memoryUsage();
  let peak = 0;
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
  const t = Date.now();
  const prims = await readDwg(bytes);
  const ms = Date.now() - t;
  clearInterval(timer);
  peak = Math.max(peak, process.memoryUsage().rss);     // the WebAssembly memory is still held here (not yet collected)
  const wasmMB = prims.source.wasmMemoryBytes / 1048576;
  const { r: res } = look(prims);
  const growth = (peak - m0.rss) / 1048576;
  console.log(`\n== large DWG: ${(bytes.length / 1048576).toFixed(1)} MB (R2000, 480 polylines × 1 000 vertices + the house) → ${prims.paths.length} paths via ${(prims.source.dxfBytes / 1048576).toFixed(1)} MB of DXF in ${ms} ms; process memory +${growth.toFixed(0)} MB (largest of the samples and the value right after the read); the converter's WebAssembly memory reached ${wasmMB.toFixed(0)} MB`);
  check(bytes.length >= 5 * 1048576 && prims.paths.length === 95 + 480, '6 MB DWG read completely');
  check(ms < 15000, `6 MB DWG read within 15 s (${ms} ms)`);
  check(growth < 1500 && wasmMB <= 1024, `6 MB DWG read within 1.5 GB of extra process memory and 1 GB of WebAssembly memory (${growth.toFixed(0)} / ${wasmMB.toFixed(0)} MB)`);
  check(compareWalls(res.walls, PLAN.walls).symDiffCm2 === 0, 'the house walls in the large file are still exact');
}

console.log(`\n${ok ? 'ALL PASS' : 'SOME CHECKS FAILED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(ok ? 0 : 1);
