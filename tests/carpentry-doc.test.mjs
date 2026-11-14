// Quotation package (src/carpentry/doc/) — node tests/carpentry-doc.test.mjs
// Builds the EN and HE request-for-quotation PDFs of the architect's layout into dist/carpentry/ and checks them.
import { store } from '../src/core/store.js';
import { PLAN } from '../src/core/plan.js';
import { initialLayout } from '../src/core/initial-layout.js';
import * as C from '../src/carpentry/index.js';
import pricebook from '../src/carpentry/pricebook.js';
import { buildQuotationPDF, buildQuotationPreview, composeQuotation, drawingToSVG, visualOrder, bidiLevels, autoDir } from '../src/carpentry/doc/index.js';
import { textBounds } from '../src/carpentry/doc/prims.js';
import { CHARS, ADVANCES, UPM } from '../src/carpentry/doc/metrics-data.js';
import { wrap, textWidth, sanitize, hasGlyph } from '../src/carpentry/doc/metrics.js';
import { deflateSync } from 'node:zlib';
import fontkit from '../vendor/pdf/fontkit.esm.js';
import { PDFDocument } from '../vendor/pdf/pdf-lib.esm.min.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

store.persist = false;

/** A small RGB PNG (gradient) as a data URL — a stand-in for the owner's reference photo. */
function makePNG(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 60 + x * 3; raw[o + 1] = 90 + y * 3; raw[o + 2] = 110; }
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}
let failed = 0, passed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' ? ' — ' + extra : ''}`); };
const has = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };

// ───────────────────────── bidi ─────────────────────────
group('Bidi reordering (expected values verified against Chromium\'s UBA)');
const CASES = [
  ["מידות בס״מ — יש לאמת מידות באתר לפני ייצור", "rtl", "רוציי ינפל רתאב תודימ תמאל שי — מ״סב תודימ"],
  ["קוד K1·B3 בקו", "rtl", "וקב K1·B3 דוק"],
  ["K1·B3", "rtl", "K1·B3"],
  ["W 180/100(+110)", "rtl", "W 180/100(+110)"],
  ["חלון W 180/100(+110) מעל", "rtl", "לעמ W 180/100(+110) ןולח"],
  ["60 × 90 × 56", "rtl", "56 × 90 × 60"],
  ["ר × ג × ע (ס״מ)", "rtl", "(מ״ס) ע × ג × ר"],
  ["סה״כ ₪ 12,500", "rtl", "12,500 ₪ כ״הס"],
  ["12,500 ₪", "rtl", "₪ 12,500"],
  ["מחיר: ₪1,250.50 כולל מע״מ 18%", "rtl", "18% מ״עמ ללוכ ₪1,250.50 :ריחמ"],
  ["ארון (K1) מטבח", "rtl", "חבטמ (K1) ןורא"],
  ["(K1) מטבח", "rtl", "חבטמ (K1)"],
  ["מטבח (קיר צפוני)", "rtl", "(ינופצ ריק) חבטמ"],
  ["קנט ABS 2 מ״מ", "rtl", "מ״מ ABS 2 טנק"],
  ["עמוד 3 / 12", "rtl", "12 / 3 דומע"],
  ["3 × מגירה 550 מ״מ", "rtl", "מ״מ 550 הריגמ × 3"],
  ["K1·WT1: חיתוך לכיור 80×50 ב-120 משמאל", "rtl", "לאמשמ 120-ב 50×80 רויכל ךותיח :K1·WT1"],
  ["קנ״מ 1:25", "rtl", "1:25 מ״נק"],
  ["Blum (פרימיום) series", "ltr", "Blum (םוימירפ) series"],
  ["Kitchen מטבח 3 units", "ltr", "Kitchen 3 חבטמ units"],
  ["הזנת כיריים 32A, תנור", "rtl", "רונת ,32A םייריכ תנזה"],
  ["-5 עד +10 ס״מ", "rtl", "מ״ס 10+ דע 5-"],
  ["ממ״ד: לאשר [פיקוד העורף]", "rtl", "[ףרועה דוקיפ] רשאל :ד״ממ"],
  ["טווח 1,105–1,275 ₪", "rtl", "₪ 1,275–1,105 חווט"],
  ["H98-CARP-RFQ-01", "rtl", "H98-CARP-RFQ-01"],
  ["2026-11-13", "rtl", "2026-11-13"],
  ["Corner pantry — מזווה פינתי", "ltr", "Corner pantry — יתניפ הווזמ"],
  ["מזווה פינתי עם דלתות נשלפות", "ltr", "תופלשנ תותלד םע יתניפ הווזמ"],
  // Hebrew spec vocabulary with Latin brand names, materials and numbers (task: Hebrew labels for every spec value)
  ["פרימיום (בדרגת Blum / Hettich)", "rtl", "(Blum / Hettich תגרדב) םוימירפ"],
  ["MDF צבוע בתנור, מט, 18 מ״מ", "rtl", "מ״מ 18 ,טמ ,רונתב עובצ MDF"],
  ["אבן קוורץ (בסגנון Caesarstone), 20 מ״מ, קוורץ לבן", "rtl", "ןבל ץרווק ,מ״מ 20 ,(Caesarstone ןונגסב) ץרווק ןבא"],
  ["ציר קליפ 110°", "rtl", "110° פילק ריצ"],
  ["למינציה ננו מט (בסגנון Fenix), 18 מ״מ, ירוק מרווה", "rtl", "הוורמ קורי ,מ״מ 18 ,(Fenix ןונגסב) טמ וננ היצנימל"]
];
for (const [s, dir, want] of CASES) { const got = visualOrder(s, dir); check(`${dir} ${JSON.stringify(s)}`, got === want, got === want ? '' : JSON.stringify(got)); }
check('pure LTR text in an LTR paragraph is unchanged', visualOrder('W 180/100(+110) K1·B3 12,500', 'ltr') === 'W 180/100(+110) K1·B3 12,500');
check('pure Hebrew word is reversed', visualOrder('מטבח', 'rtl') === 'חבטמ');
check('brackets are mirrored inside RTL runs', visualOrder('(מטבח)', 'rtl') === '(חבטמ)' && visualOrder('[א]', 'ltr') === '[א]');
check('numbers keep LTR order inside RTL', visualOrder('אורך 550 ס״מ', 'rtl') === 'מ״ס 550 ךרוא' && visualOrder('1,234.5', 'rtl') === '1,234.5');
check('trailing spaces go to the paragraph end (L1)', bidiLevels(Array.from('אב  '), 0).slice(2).every((l) => l === 0));
check('autoDir: first strong character', autoDir('Corner מזווה') === 'ltr' && autoDir('מזווה (corner)') === 'rtl' && autoDir('123', 'rtl') === 'rtl');
check('empty / null input', visualOrder('', 'rtl') === '' && visualOrder(null, 'rtl') === '');

// ───────────────────────── metrics ─────────────────────────
group('Font metrics');
{
  const f = fontkit.create(readFileSync(new URL('../vendor/fonts/Heebo_700Bold.ttf', import.meta.url)));
  const chars = Array.from(CHARS);
  check('metrics table matches the bold TTF advances', f.unitsPerEm === UPM && chars.every((c, i) => f.glyphForCodePoint(c.codePointAt(0)).advanceWidth === ADVANCES.bold[i]));
  check('Hebrew, ₪, ×, ·, ², ״ have glyphs', ['א', 'ת', '₪', '×', '·', '²', '״', '׳', '—', '–'].every((c) => chars.includes(c)));
  check('sanitize replaces missing glyphs (→ ≈ ≤)', sanitize('a → b ≈ c ≤ d') === 'a -> b ~ c <= d');
  check('wrap respects the width', wrap('one two three four five six seven eight nine ten', 20, 9).every((l) => textWidth(l, 9) <= 20));
  check('wrap keeps "2 × hinge" together', !wrap('aaaa 2 × hinge', textWidth('aaaa 2 ×', 9) + 0.5, 9).some((l) => l.endsWith('×')));
}

// ───────────────────────── documents ─────────────────────────
group('Adopt the architect\'s layout and build both editions');
store.load({ items: initialLayout() });
const ad = C.adoptArchitectLayout();
check('layout adopted', ad.ok);
const runs = C.listRuns();
check('runs exist', runs.length > 5, runs.map((r) => r.code).join(' '));
const k1 = runs.find((r) => r.code === 'K1');
// The owner's example (as in tests/carpentry.test.mjs): the K1 dead corner becomes a tall L corner pantry 80 × 95 with
// removable doors, one `must` feature in Hebrew free text with a small generated PNG, and one bespoke 'bar-niche' unit.
const pantryId = C.getRun(k1.id).units[0].id;
const up = C.updateUnit(pantryId, { module: 'tall-corner-pantry', width: 80, legB: 95, internals: { cornerPantry: 'l-doors', shelves: 5 }, fronts: { operation: 'removable' } });
check('corner pantry with removable doors', up.ok, up.reason && up.reason.en);
const OWNER_TEXT = 'דלתות שאפשר להרים ולהוריד בלי כלים, לניקוי המזווה (Blum CLIP top)';
const PNG = makePNG(48, 32);
const ft = C.addFeature({ unitId: pantryId }, { title: 'Removable doors without tools', text: OWNER_TEXT, category: 'doors', priority: 'must', images: [{ name: 'pantry-reference.png', w: 480, h: 320, dataUrl: PNG }] });
check('must feature added', ft.ok && ft.n === 1);
const cr = C.createRun({ kind: 'custom', anchor: { x: 940, y: 120, dir: 0 }, length: 80, name: 'Bar niche', nameHe: 'נישת בר', units: [C.customLayoutTemplate('bar-niche')] });
check('bespoke bar-niche unit in the living room', cr.ok, cr.reason && cr.reason.en);
const allRuns = C.listRuns();
const nFeat = C.schedules('all').features.length;
const project = { title: 'House 98 — Kibbutz Afikim', address: 'Kibbutz Afikim, Jordan Valley', ownerName: 'Owner', phone: '050-0000000', date: '2026-11-13', reference: 'H98-CARP-RFQ-01' };
const opts = (lang, extra = {}) => ({ lang, runIds: 'all', paper: 'A4', project, src: { store, plan: PLAN }, pricebook, ...extra });
mkdirSync(new URL('../dist/carpentry/', import.meta.url), { recursive: true });
const out = {};
for (const lang of ['en', 'he']) {
  const t0 = Date.now();
  const r = await buildQuotationPDF(opts(lang));
  const ms = Date.now() - t0;
  const file = new URL(`../dist/carpentry/${r.filename}`, import.meta.url);
  writeFileSync(file, r.bytes);
  out[lang] = { ...r, ms, path: file.pathname };
  check(`${lang}: PDF produced (${r.pages} pages, ${(r.bytes.length / 1024).toFixed(0)} KB, ${ms} ms)`, r.bytes.length > 10000 && String.fromCharCode(...r.bytes.slice(0, 5)) === '%PDF-');
  check(`${lang}: built in < 3 s`, ms < 3000, `${ms} ms`);
  check(`${lang}: filename`, r.filename === `House98-Carpentry-RFQ-2026-11-13-${lang.toUpperCase()}.pdf`, r.filename);
}
check('same page count in both languages (± 1)', Math.abs(out.en.pages - out.he.pages) <= 1, `${out.en.pages} / ${out.he.pages}`);

group('Document structure');
for (const lang of ['en', 'he']) {
  const doc = out[lang].doc;
  check(`${lang}: direction`, doc.dir === (lang === 'he' ? 'rtl' : 'ltr'));
  const lost = doc.meta.tables.filter((t) => t.rows !== t.drawn);
  check(`${lang}: no table loses rows across page breaks (${doc.meta.tables.length} tables)`, lost.length === 0, lost.map((t) => t.id).join(', '));
  let bad = 0, n = 0;
  const walk = (ops, W, H) => { for (const o of ops) { if (o.t === 'drawing') walk(o.ops, W, H); else if (o.t === 'text') { n++; const b = textBounds(o); if (b.x0 < -0.01 || b.y0 < -0.01 || b.x1 > W + 0.01 || b.y1 > H + 0.01) bad++; } } };
  for (const p of doc.pages) walk(p.ops, p.size[0], p.size[1]);
  check(`${lang}: no text op exceeds its page box (${n} texts)`, bad === 0, `${bad} outside`);
  let wide = 0;
  for (const p of doc.pages) for (const o of p.ops) if (o.t === 'text' && o.maxWidth && o.w > o.maxWidth + 0.05) wide++;
  check(`${lang}: wrapped texts stay within their max width`, wide === 0, `${wide}`);
  check(`${lang}: every run has drawing sheets`, allRuns.every((r) => doc.pages.some((p) => p.kind === 'sheet' && p.runId === r.id)));
  check(`${lang}: landscape sheets + portrait text pages`, doc.pages.every((p) => (p.kind === 'sheet') === (p.orientation === 'landscape')));
  check(`${lang}: every section has a page`, doc.meta.sections.every((s) => s.page > 0), doc.meta.sections.filter((s) => !s.page).map((s) => s.num).join(' '));
  check(`${lang}: special requirements section + form lines`, doc.meta.sections.some((s) => s.title === (lang === 'he' ? 'דרישות מיוחדות' : 'Special requirements')) && doc.meta.tables.some((t) => t.id === 'form-features' && t.rows === nFeat));
  check(`${lang}: reference image embedded`, doc.pages.some((p) => p.ops.some((o) => o.t === 'image' && o.src === PNG)));
  let missing = 0, symbols = 0;
  const glyphs = (ops) => { for (const o of ops) { if (o.t === 'drawing') glyphs(o.ops); else if (o.t === 'text') { if (o.parts) { symbols++; glyphs(o.parts); continue; } for (const c of o.vis) if (!hasGlyph(c)) missing++; } } };
  for (const p of doc.pages) glyphs(p.ops);
  check(`${lang}: every drawn code point is in the font (${symbols} texts with vector symbols)`, missing === 0 && symbols > 0, `${missing} missing`);
  check(`${lang}: callout balloons drawn; operation legend printed once (caption line)`, doc.pages.some((p) => p.ops.some((o) => o.t === 'drawing' && o.ops.some((x) => x.role === 'callout' && x.t === 'text')) && p.ops.some((o) => o.role === 'legend' && o.text.includes(lang === 'he' ? 'דלתות נשלפות' : 'Removable')) && !p.ops.some((o) => o.t === 'drawing' && o.ops.some((x) => x.role === 'legend'))));
  check(`${lang}: unit codes have a knock-out halo`, doc.pages.some((p) => p.ops.some((o) => o.t === 'drawing' && o.ops.some((x) => x.role === 'halo'))));
  check(`${lang}: bespoke unit's internal view on its own sheet`, doc.pages.filter((p) => p.kind === 'sheet' && p.runId === cr.runId).some((p) => { const d = p.ops.filter((o) => o.t === 'drawing'); return d.length === 1 && d[0].kind === 'internal' && d[0].ops.some((x) => x.role === 'cell'); }));
  check(`${lang}: no estimate by default`, !doc.meta.sections.some((s) => s.title.includes(lang === 'he' ? 'הערכת' : 'estimate')));
}
check('identical pagination in both editions', out.en.doc.pages.map((p) => p.kind + p.orientation).join() === out.he.doc.pages.map((p) => p.kind + p.orientation).join());
{
  const own = composeQuotation(opts('en', { include: { estimate: true } }));
  check('owner\'s copy adds the estimate section', own.meta.sections.some((s) => /estimate/i.test(s.title)));
  const est = C.estimate('all', { pricebook }), ownText = own.pages.flatMap((p) => p.ops.filter((o) => o.t === 'text').map((o) => o.text)).join('\n');
  check(`owner's copy prints the market estimate totals (₪${est.total.low} / ${est.total.typical} / ${est.total.high})`, est.method === 'market' && [est.total.low, est.total.typical, est.total.high].every((v) => ownText.includes(v.toLocaleString('en-US'))));
  check('owner\'s copy lists basis, sources and "priced by the carpenter" lines', /Basis/.test(ownText) && /Sources/.test(ownText) && /priced by the carpenter/i.test(ownText));
  const a3 = composeQuotation(opts('en', { paper: 'A3' }));
  check('A3 drawing sheets are 420 × 297 landscape, text pages stay A4', a3.pages.filter((p) => p.kind === 'sheet').every((p) => p.size[0] === 420 && p.size[1] === 297) && a3.pages.filter((p) => p.kind === 'text').every((p) => p.size[0] === 210));
  const one = composeQuotation(opts('he', { runIds: [k1.id] }));
  check('a single-run document', one.meta.runs.length === 1 && one.pages.length < out.he.pages);
}

group('PDF content');
for (const lang of ['en', 'he']) {
  const pdf = await PDFDocument.load(out[lang].bytes);
  check(`${lang}: pdf-lib re-opens it with the same page count`, pdf.getPageCount() === out[lang].pages);
}
if (has('pdffonts') && has('pdftotext')) {
  for (const lang of ['en', 'he']) {
    const fonts = execFileSync('pdffonts', [out[lang].path]).toString().split('\n').slice(2).filter(Boolean);
    check(`${lang}: fonts embedded (${fonts.length} Heebo faces)`, fonts.length >= 3 && fonts.every((l) => /Heebo/.test(l) && /\byes\b/.test(l)));
  }
  const en = execFileSync('pdftotext', ['-enc', 'UTF-8', out.en.path, '-']).toString();
  const he = execFileSync('pdftotext', ['-enc', 'UTF-8', out.he.path, '-']).toString();
  check('every run code appears in both editions', allRuns.every((r) => en.includes(r.code) && he.includes(r.code)));
  check('EN: run names extractable', runs.every((r) => en.includes(r.name.split(' — ')[0])));
  check('EN: dimension numbers extractable', ['550', '254', '320'].every((d) => en.includes(d)));
  check('EN: special requirement + form line extractable', (en.match(/Removable doors without tools/g) || []).length >= 3);
  check('EN: unit refs extractable', C.schedules('all').units.every((u) => en.includes(u.ref)), C.schedules('all').units.filter((u) => !en.includes(u.ref)).map((u) => u.ref).slice(0, 5).join(' '));
  check('EN: furniture', ['Request for quotation', 'Dimensions in cm', 'Quotation form', 'Questions for the carpenter', 'indicative'].every((s) => en.toLowerCase().includes(s.toLowerCase())));
  check('EN: owner\'s Hebrew text kept as typed (logical order after extraction)', en.includes('דלתות שאפשר להרים ולהוריד בלי כלים'));
  const words = ['בקשה להצעת מחיר', 'מפרט טכני', 'טופס הצעת מחיר', 'דרישות מיוחדות', 'מידות בס״מ', 'תנאי תשלום', 'תוקף ההצעה', 'אחריות', 'קנ״מ', 'מטבח'];
  const miss = words.filter((w) => !he.includes(w));
  check('HE: Hebrew strings extract in logical order', miss.length === 0, miss.join(' | '));
  check('HE: owner\'s English title kept as typed', he.includes('Removable doors without tools'));
} else console.log('  (poppler-utils not installed — pdffonts / pdftotext checks skipped)');

group('Hebrew edition: spec values (colours, materials, handles, hardware) in Hebrew');
{
  const k = C.listRuns().find((r) => r.code === 'K1');
  const before = JSON.stringify(k.spec);
  C.updateRun(k.id, { spec: { fronts: { color: 'Sage', material: 'fenix', style: 'gola' }, worktop: { color: 'Calacatta', material: 'porcelain', edge: 'mitred' }, handles: { type: 'knob', finish: 'brass' }, carcass: { color: 'Light grey' }, hardware: { grade: 'premium' } } });
  const docHe = composeQuotation(opts('he'));
  const texts = docHe.pages.flatMap((p) => p.ops.filter((o) => o.t === 'text').map((o) => o.text));
  const all = texts.join('\n');
  check('colours in Hebrew (ירוק מרווה, קלקטה, אפור בהיר, לבן חם)', ['ירוק מרווה', 'קלקטה', 'אפור בהיר', 'לבן חם'].every((w) => all.includes(w)));
  check('materials and finishes in Hebrew (Fenix / Dekton / Caesarstone kept in Latin letters)', ['למינציה ננו מט (בסגנון Fenix)', 'פורצלן / אבן מסונטרת (בסגנון Dekton)', 'אבן קוורץ (בסגנון Caesarstone)', 'MDF צבוע בתנור', 'ידית כפתור', 'פליז מוברש', 'פרימיום (בדרגת Blum / Hettich)'].every((w) => all.includes(w)));
  check('hardware descriptions in Hebrew (ציר קליפ, מסילות טלסקופיות, טריקה שקטה)', ['ציר קליפ 110°', 'מסילות טלסקופיות', 'טריקה שקטה', 'ללא ידיות — פרופיל גולה'].every((w) => all.includes(w)));
  const english = ['Sage', 'Calacatta', 'Light grey', 'warm white', 'clip-on', 'full-extension', 'standard', 'gola', 'knob', 'edge-pull', 'Brushed', 'Lacquered', 'Quartz', 'Melamine'];
  const leaks = texts.filter((t) => english.some((w) => new RegExp(`(^|[^A-Za-z])${w}([^A-Za-z]|$)`).test(t)));
  check('no English vocabulary value printed in the Hebrew edition', !leaks.length, leaks.slice(0, 4).join(' | '));
  const sched = C.schedules(k.id);
  check('schedules: colour bilingual, hardware variants bilingual', sched.materials.some((m) => m.colour && m.colour.he === 'ירוק מרווה') && sched.hardware.some((h) => h.kind === 'profile' && /פרופיל גולה/.test(h.spec.he)) && sched.hardware.some((h) => h.kind === 'hinge' && /^רגיל, /.test(h.spec.he)) && sched.hardware.every((h) => !/standard/.test(h.spec.he)));
  const { FRONT_COLOURS, WORKTOP_COLOURS, CARCASS_COLOURS } = await import('../src/ui/carpentry/vocab.js');
  const presets = [...FRONT_COLOURS, ...WORKTOP_COLOURS, ...CARCASS_COLOURS].map(([n]) => n);
  check('every UI colour preset has a Hebrew label', presets.every((n) => C.SPEC_TEXT_HE[n.toLowerCase()]), presets.filter((n) => !C.SPEC_TEXT_HE[n.toLowerCase()]).join(', '));
  check('every vocabulary value has a Hebrew label', Object.values(C.VOCAB).every((g) => Object.values(g).every((v) => /[֐-׿]/.test(v.he) || /^[A-Z0-9 .\-/()]+$/.test(v.he))));
  check('specText: unknown free text stays as typed', C.specText('RAL 7016 custom').he === 'RAL 7016 custom' && C.specText('Pure White').he === 'לבן בוהק');
  C.updateRun(k.id, { spec: JSON.parse(before) });
}

group('Screen renderers');
{
  const { doc, svgPages } = buildQuotationPreview(opts('he'));
  check('one SVG per page', svgPages.length === doc.pages.length && svgPages.every((s) => s.startsWith('<svg') && s.endsWith('</svg>')));
  check('preview draws the same visual text as the PDF (bidi-override)', svgPages[1].includes('unicode-bidi:bidi-override'));
  const d = C.drawings(k1.id).find((x) => x.kind === 'elevation');
  const svg = drawingToSVG(d, { lang: 'he' });
  check('drawingToSVG: markup with unit hooks', svg.startsWith('<svg') && /class="op op-unit"[^>]*data-unit-id="/.test(svg) && svg.includes('direction:rtl'));
  check('drawingToSVG: theme colours via currentColor / CSS vars; print forces black on white', svg.includes('var(--carp-ink, currentColor)') && drawingToSVG(d, { print: true }).includes('#1c1c1a') && !drawingToSVG(d, { print: true }).includes('var(--carp-ink'));
  check('drawingToSVG: bad input → empty string', drawingToSVG(null) === '' && drawingToSVG({}) === '');
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`PDFs: ${out.en.path}\n      ${out.he.path}`);
process.exit(failed ? 1 : 0);
