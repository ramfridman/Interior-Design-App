// Writes the DWG fixtures of tests/import.dwg.test.mjs from the DXF fixtures the DXF tests use. Not part of the app;
// run by hand when a fixture has to change (the .dwg files it writes are committed next to it):
//
//   mkdir /tmp/acad && cd /tmp/acad && npm i --no-save @node-projects/acad-ts@3.8.0
//   node tests/fixtures/dwg/make-fixtures.mjs /tmp/acad/node_modules/@node-projects/acad-ts/dist/index.js
//
// The DWG writer is acad-ts 3.8.0 (MIT; a TypeScript port of ACadSharp): it reads each DXF (written by
// tests/dxf-writer.mjs from the same data as the DXF tests) and writes it as DWG in the asked version. It is an
// independent implementation from the reader under test (GNU LibreDWG), so a fixture that reads back right was
// understood the same way by both. Nothing here is shipped with the app.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { houseDxf } from '../../dxf-fixtures.mjs';
import { dxfOf, wedgeDrawing } from '../../import-slant-fixtures.mjs';
import { duplexFloor, duplexSheet, floorsDxf, mapFloor } from '../../import-floor-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = await import(pathToFileURL(path.resolve(process.argv[2] || '')).href);

/** DXF bytes → acad-ts document, completed with the standard table entries AutoCAD always has (our test DXFs are
 *  minimal: no BYBLOCK line type, no *Paper_Space block …), which the DWG writer needs. */
function docOf(dxfBytes) {
  const doc = A.DxfReader.readFromStream(dxfBytes, () => {});
  for (const t of [doc.lineTypes, doc.layers, doc.blockRecords, doc.textStyles, doc.dimensionStyles, doc.appIds, doc.vPorts]) if (t && t.createDefaultEntries) t.createDefaultEntries();
  doc.updateCollections(true, true);
  return doc;
}
const notes = [];
function write(name, doc, version) {
  doc.header.version = A.ACadVersion[version];
  const bytes = A.DwgWriter.writeToBuffer(doc, null, (s, e) => { if (e && e.type >= 2) notes.push(`${name}: ${e.message}`); });
  fs.writeFileSync(path.join(here, name), bytes);
  console.log(`${name}  ${version}  ${bytes.length} bytes`);
  return bytes;
}

// the built-in house in cm, one file per DWG version (R13 … 2018)
for (const [v, label] of [['AC1012', 'r13'], ['AC1014', 'r14'], ['AC1015', '2000'], ['AC1018', '2004'], ['AC1021', '2007'], ['AC1024', '2010'], ['AC1027', '2013'], ['AC1032', '2018']]) {
  write(`house-cm-${label}.dwg`, docOf(houseDxf({ unit: 1, insunits: 5 }).bytes()), v);
}
// millimetres; Hebrew layer names and text in an R2000 file with code page 1255 (and in a 2018 file: UTF-16 strings)
write('house-mm-2018.dwg', docOf(houseDxf({ unit: 0.1, insunits: 4 }).bytes()), 'AC1032');
const hebrew = { names: { wall: 'קירות', door: 'דלתות', window: 'חלונות', dim: 'מידות', furn: 'ריהוט' }, title: 'תכנית קומת קרקע' };
write('house-hebrew-2000.dwg', docOf(houseDxf({ unit: 1, insunits: 5, version: 'AC1015', codepage: 'ANSI_1255', ...hebrew }).bytes()), 'AC1015');
write('house-hebrew-2018.dwg', docOf(houseDxf({ unit: 1, insunits: 5, ...hebrew }).bytes()), 'AC1032');
// the Wedge (angled walls)
{
  const d = wedgeDrawing();
  write('wedge-2018.dwg', docOf(dxfOf({ lines: d.lines, symLines: d.doorLines, symArcs: d.arcs, winLines: d.winLines }).bytes()), 'AC1032');
}
// the two-floor Duplex: both floors side by side on one sheet, and as two files (the first floor drawn turned 90°)
write('duplex-sheet-2018.dwg', docOf(floorsDxf(duplexSheet()).bytes()), 'AC1032');
write('duplex-ground-2013.dwg', docOf(floorsDxf([duplexFloor(0)]).bytes()), 'AC1027');
write('duplex-first-2013.dwg', docOf(floorsDxf([mapFloor(duplexFloor(1), ([x, y]) => [800 - y, x])]).bytes()), 'AC1027');

// a large drawing (R2007; acad-ts stores its pages uncompressed): the house plus enough LINEs on a furniture layer for
// a 5.5 MB file. Committed gzipped (the test unpacks it in memory).
{
  const doc = docOf(houseDxf({ unit: 1, insunits: 5 }).bytes());
  const furn = doc.layers.get('I-FURN');
  const add = (from, count) => {
    for (let n = from; n < from + count; n++) {
      const x = 10000 + (n % 400) * 7.5, y = 20000 + Math.floor(n / 400) * 3.25;
      const l = new A.Line(); l.startPoint = new A.XYZ(x, y, 0); l.endPoint = new A.XYZ(x + 5.5, y + 1.25, 0); l.layer = furn;
      doc.modelSpace.entities.add(l);
    }
  };
  doc.header.version = A.ACadVersion.AC1021;
  const base = A.DwgWriter.writeToBuffer(doc).length;
  add(0, 10000);
  const per = (A.DwgWriter.writeToBuffer(doc).length - base) / 10000;
  const n = 10000 + Math.ceil((5.5 * 1048576 - base) / per) - 10000;
  add(10000, n - 10000);
  const bytes = A.DwgWriter.writeToBuffer(doc);
  fs.writeFileSync(path.join(here, 'big-2007.dwg.gz'), zlib.gzipSync(bytes, { level: 9 }));
  console.log(`big-2007.dwg.gz  AC1021  ${bytes.length} bytes (${n} extra lines), gzipped ${fs.statSync(path.join(here, 'big-2007.dwg.gz')).size}`);
}
if (notes.length) console.log(notes.slice(0, 20).join('\n'));
