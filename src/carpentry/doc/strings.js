/**
 * Bilingual document furniture for the quotation package (English / Hebrew). Engine data brings its own { en, he }
 * strings; everything the document adds (titles, table heads, scope wording, form fields) lives here.
 *   S.scope → { en, he };  tr(S.scope, 'he') → string;  tr({ en, he } | string, lang) works for engine strings too.
 */
const L = (en, he) => ({ en, he });

/** Pick the language from a bilingual value (strings pass through). */
export function tr(v, lang) {
  if (v == null) return '';
  if (typeof v === 'object') return String((lang === 'he' ? v.he : v.en) ?? v.en ?? '');
  return String(v);
}

export const S = {
  // cover / furniture
  rfq: L('Request for quotation', 'בקשה להצעת מחיר'),
  rfqSub: L('Custom carpentry', 'נגרות בהתאמה אישית'),
  rfqFull: L('Request for quotation — custom carpentry', 'בקשה להצעת מחיר — נגרות בהתאמה אישית'),
  package: L('Tender package · drawings, specification, schedules and quotation form', 'חוברת מכרז · תכניות, מפרט טכני, רשימות וטופס הצעת מחיר'),
  ownersCopy: L('Owner’s copy — includes the cost estimate. Not for issue to bidders.', 'עותק המזמין — כולל הערכת עלות. לא להעברה למציעים.'),
  forTender: L('Issued for tender', 'הוצא למכרז'),
  project: L('Project', 'פרויקט'), location: L('Location', 'מיקום'), date: L('Date', 'תאריך'), reference: L('Reference', 'סימוכין'),
  client: L('Client', 'המזמין'), phone: L('Phone', 'טלפון'), email: L('Email', 'דוא״ל'), contact: L('Contact', 'פרטי קשר'),
  status: L('Status', 'סטטוס'), revision: L('Rev.', 'מהדורה'),
  dimsNote: L('Dimensions in cm — site dimensions to be verified by the carpenter before production', 'מידות בס״מ — יש לאמת מידות באתר לפני ייצור (באחריות הנגר)'),
  page: L('Page', 'עמוד'), sheet: L('Sheet', 'גיליון'), contents: L('Contents', 'תוכן העניינים'), continued: L('continued', 'המשך'),
  keyPlan: L('Key plan', 'תכנית מפתח'), keyPlanNote: L('Carpentry runs highlighted; codes as used throughout this document.', 'קווי הנגרות מודגשים; הקודים זהים בכל המסמך.'),
  north: L('N', 'צ'),
  invitation: L(
    'You are invited to submit a quotation for the custom carpentry described in this document. Please price every line of the quotation form, answer the questions and state any deviation from the specification. The drawings are issued for tender: final dimensions are taken on site by the carpenter, who submits shop drawings for approval before production.',
    'הנכם מוזמנים להגיש הצעת מחיר לעבודות הנגרות המפורטות במסמך זה. נא לתמחר כל שורה בטופס הצעת המחיר, להשיב על השאלות ולציין כל סטייה מהמפרט. התכניות מוגשות לצורך מכרז: המידות הסופיות נלקחות באתר על ידי הנגר, המגיש תכניות ייצור לאישור לפני תחילת הייצור.'),

  // sections
  scope: L('Scope of works', 'היקף העבודה'),
  spec: L('General specification', 'מפרט טכני כללי'),
  specNote: L('Applies to every run unless an exception is listed. Board and worktop thicknesses in mm, other dimensions in cm.', 'חל על כל הקווים אלא אם צוין חריג. עובי לוחות ומשטחים במ״מ, יתר המידות בס״מ.'),
  included: L('Included in the carpenter’s scope', 'כלול בעבודת הנגר'),
  excluded: L('Not included — by the owner or by others', 'לא כלול — על ידי המזמין או אחרים'),
  runSheets: L('Drawings and schedules per run', 'תכניות ורשימות לפי קו'),
  units: L('Unit schedule', 'רשימת יחידות'),
  materials: L('Materials and finishes', 'חומרים וגימורים'),
  hardware: L('Hardware', 'פרזול'),
  worktops: L('Worktop schedule', 'רשימת משטחים'),
  appliances: L('Appliance schedule', 'רשימת מכשירים'),
  appliancesNote: L('Appliances are supplied by the owner. Niches are drawn to the sizes below — confirm against the installation sheets of the chosen models.', 'המכשירים באספקת המזמין. הנישות שורטטו לפי המידות שלהלן — יש לאמת מול הוראות ההתקנה של הדגמים שנבחרו.'),
  checks: L('Design notes for the carpenter', 'הערות תכנון לנגר'),
  noChecks: L('No open design notes for this run.', 'אין הערות תכנון פתוחות לקו זה.'),
  cutLists: L('Cutting lists (indicative)', 'רשימות חיתוך (אינדיקטיבי)'),
  cutNote: L('Indicative only — the carpenter’s own cutting list governs. Sizes are finished panel sizes in mm (length × width); edging marks show the banded edges of each piece.', 'לצורך התרשמות בלבד — רשימת החיתוך של הנגר היא הקובעת. המידות הן מידות לוח גמורות במ״מ (אורך × רוחב); סימון הקנט מציין את הצלעות המקונטות בכל חלק.'),
  special: L('Special requirements', 'דרישות מיוחדות'),
  specialNote: L('Bespoke items requested by the owner, numbered as the callouts on the drawings. Each one is priced as a separate line of the quotation form. The owner’s wording is reproduced as written.', 'פריטים בהתאמה מיוחדת לבקשת המזמין, ממוספרים כמו הסימונים בתכניות. כל פריט מתומחר בשורה נפרדת בטופס הצעת המחיר. נוסח המזמין מובא כפי שנכתב.'),
  requirement: L('Requirement', 'דרישה'), category: L('Category', 'קטגוריה'), priority: L('Priority', 'עדיפות'),
  questions: L('Questions for the carpenter', 'שאלות לנגר'),
  questionsNote: L('Please answer in the reply column or in an attached letter. Items marked for site measurement are confirmed at the measurement visit.', 'נא להשיב בעמודת התשובה או במכתב מצורף. סעיפים הנוגעים למדידה יאושרו בביקור המדידה באתר.'),
  form: L('Quotation form', 'טופס הצעת מחיר'),
  formNote: L('Prices in ₪ excluding VAT unless stated. Price every run; write “incl.” where an item is included elsewhere and “n/a” where it does not apply.', 'המחירים בש״ח לפני מע״מ אלא אם צוין אחרת. יש לתמחר כל קו; לרשום ״כלול״ כשסעיף כלול במקום אחר ו״לא רלוונטי״ כשאינו חל.'),
  boq: L('Price breakdown (bill of quantities)', 'פירוט מחיר (כתב כמויות)'),
  alternatives: L('Alternatives and options', 'חלופות ואפשרויות'),
  terms: L('Commercial terms', 'תנאים מסחריים'),
  bidder: L('Bidder', 'פרטי המציע'),
  estimate: L('Owner’s cost estimate', 'הערכת עלות של המזמין'),
  estimateNote: L('For the owner’s budgeting only — not part of the tender documents.', 'לתקצוב המזמין בלבד — אינו חלק ממסמכי המכרז.'),

  // tables
  code: L('Code', 'קוד'), name: L('Name', 'שם'), room: L('Room', 'חדר'), kind: L('Type', 'סוג'), lengthCm: L('Length (cm)', 'אורך (ס״מ)'),
  unitsN: L('Units', 'יחידות'), fronts: L('Fronts', 'חזיתות'), worktop: L('Worktop', 'משטח'), run: L('Run', 'קו'), item: L('Item', 'סעיף'),
  part: L('Part', 'חלק'), sizeMm: L('Length × width (mm)', 'אורך × רוחב (מ״מ)'), qty: L('Qty', 'כמות'), edging: L('Edging', 'קנט'),
  material: L('Material', 'חומר'), topic: L('Topic', 'נושא'), question: L('Question / to verify', 'שאלה / לבדיקה'), reply: L('Reply', 'תשובת הנגר'),
  unit: L('Unit', 'יחידה'), noWorktop: L('—', '—'), facts: L('Facts', 'נתונים'),
  levels: L('Rows', 'שורות'), lengthLabel: L('Length', 'אורך'), unitsLabel: L('Units', 'יחידות'), roomLabel: L('Room', 'חדר'),
  check: L('Check', 'לבדיקה'), info: L('Note', 'הערה'), severity: L('Type', 'סוג'), note: L('Note', 'הערה'),
  areaM2: L('m²', 'מ״ר'), pcs: L('pcs', 'יח׳'), edgeM: L('Edge (m)', 'קנט (מ׳)'),

  // spec rows
  carcass: L('Carcass', 'גוף'), backs: L('Back panels', 'גבות'), frontsRow: L('Fronts', 'חזיתות'), frontStyle: L('Front style', 'סגנון חזית'),
  edges: L('Edge banding', 'קנטים'), handles: L('Handles', 'ידיות'), plinth: L('Plinth', 'צוקל'), hardwareGrade: L('Hardware', 'פרזול'),
  worktopRow: L('Worktop', 'משטח עבודה'), splashback: L('Splashback', 'חיפוי קיר'), lighting: L('Lighting', 'תאורה'), heights: L('Heights', 'גבהים'),
  aboveTop: L('Above the units', 'מעל הארונות'), except: L('Except', 'למעט'), notApplicable: L('not applicable', 'לא רלוונטי'),
  underWallLed: L('LED strip under the wall units', 'פס LED מתחת לארונות העליונים'), inCabinetLed: L('LED inside the cabinets', 'תאורת LED בתוך הארונות'), noLighting: L('None', 'ללא'),
  carcassEdge: L('carcass', 'גוף'), frontEdge: L('fronts', 'חזיתות'),

  // form
  carcasses: L('Carcasses', 'גופים'), frontsCol: L('Fronts', 'חזיתות'), worktopCol: L('Worktop supply & fabrication', 'משטח — אספקה ועיבוד'),
  hardwareCol: L('Hardware & internal fittings', 'פרזול ואביזרים פנימיים'), lightingCol: L('Lighting', 'תאורה'), installCol: L('Installation', 'התקנה'),
  runTotal: L('Run total', 'סה״כ לקו'), subtotal: L('Subtotal — all runs', 'סכום ביניים — כל הקווים'), delivery: L('Delivery and site handling', 'הובלה ושינוע באתר'),
  measure: L('Site measurement and shop drawings', 'מדידה באתר ותכניות ייצור'), totalExcl: L('Total excluding VAT', 'סה״כ לפני מע״מ'),
  vat: L('VAT', 'מע״מ'), totalIncl: L('Total including VAT', 'סה״כ כולל מע״מ'), nis: L('₪', '₪'),
  option: L('Option', 'חלופה'), description: L('Description', 'תיאור'), priceDiff: L('Price difference ₪ (+ / −)', 'הפרש מחיר ₪ (+ / −)'),
  leadTime: L('Lead time from approval of the shop drawings (weeks)', 'זמן אספקה מאישור תכניות הייצור (שבועות)'),
  installTime: L('Installation on site (working days)', 'משך התקנה באתר (ימי עבודה)'),
  schedule: L('Schedule', 'לוח זמנים'),
  payment: L('Payment terms', 'תנאי תשלום'), warranty: L('Warranty — carcasses / hardware / worktop', 'אחריות — גופים / פרזול / משטח'),
  validity: L('Validity of offer', 'תוקף ההצעה'), measureDate: L('Proposed date for the site measurement', 'מועד מוצע למדידה באתר'),
  deviations: L('Deviations from the specification', 'סטיות מהמפרט'),
  businessName: L('Business name', 'שם העסק'), businessId: L('Company / licensed dealer no.', 'ח.פ. / עוסק מורשה'), contactPerson: L('Contact person', 'איש קשר'),
  address: L('Address', 'כתובת'), signature: L('Signature', 'חתימה'), stamp: L('Stamp', 'חותמת'), signedName: L('Name', 'שם'),

  // drawings
  scale: L('Scale', 'קנ״מ'), paper: L('Paper', 'גיליון'), drawing: L('Drawing', 'תכנית'), drawings: L('Drawings', 'תכניות'), sheetOf: L('of', 'מתוך'),

  // estimate
  low: L('Low', 'נמוך'), typical: L('Typical', 'צפוי'), high: L('High', 'גבוה'), basis: L('Basis', 'בסיס החישוב'), sources: L('Sources', 'מקורות'),
  asOf: L('Price book as of', 'מחירון נכון ל'), tier: L('Finish tier', 'רמת גימור'), total: L('Total', 'סה״כ'), exVat: L('excl. VAT', 'לפני מע״מ'), incVat: L('incl. VAT', 'כולל מע״מ'),
  missingRates: L('Items without a rate in the price book (counted as 0)', 'סעיפים ללא מחיר במחירון (נספרו כ־0)'),
};

/** Standard scope wording (neutral, as used in Israeli carpentry tenders). */
export const INCLUDED = [
  L('Site measurement by the carpenter and shop drawings for the owner’s approval before production.', 'מדידה באתר על ידי הנגר ותכניות ייצור לאישור המזמין לפני הייצור.'),
  L('Supply, manufacture, delivery and installation of every unit shown, including fillers, end panels, plinths and scribing to walls and ceiling.', 'אספקה, ייצור, הובלה והתקנה של כל היחידות המופיעות, כולל פילרים, דפנות גמר, צוקלים והתאמה לקירות ולתקרה.'),
  L('All hardware: hinges, drawer systems, lift-up fittings, handles, hanging rails and internal fittings as specified.', 'כל הפרזול: צירים, מערכות מגירות, מנגנוני הרמה, ידיות, מוטות תלייה ואביזרים פנימיים לפי המפרט.'),
  L('Worktops: templating after the carcasses are installed and levelled, supply, fabrication, cut-outs, edge finishing and installation.', 'משטחים: מדידת שבלונה לאחר התקנת הגופים ופילוסם, אספקה, עיבוד, חיתוכים, גימור קנטים והתקנה.'),
  L('Openings in the carpentry for services, ventilation and appliances; fitting of integrated appliance doors and panels.', 'פתחים בנגרות למערכות, לאוורור ולמכשירים; התקנת חזיתות ופאנלים למכשירים אינטגרליים.'),
  L('LED lighting inside the carpentry where specified, with drivers in an accessible place.', 'תאורת LED בתוך הנגרות היכן שצוין, עם שנאים במקום נגיש.'),
  L('Protection of the works until handover, removal of packaging and final cleaning.', 'הגנה על העבודה עד המסירה, פינוי אריזות וניקיון סופי.'),
];
export const EXCLUDED = [
  L('Appliances — supplied by the owner; their connection by licensed trades.', 'מכשירי חשמל — באספקת המזמין; חיבורם על ידי בעלי מקצוע מורשים.'),
  L('Plumbing, gas and electrical work, including new points and final connections (by others).', 'עבודות אינסטלציה, גז וחשמל, כולל נקודות חדשות וחיבורים סופיים (על ידי אחרים).'),
  L('Sinks, basins and taps — supplied by the owner unless agreed otherwise.', 'כיורים וברזים — באספקת המזמין, אלא אם סוכם אחרת.'),
  L('Wall tiling, painting and making good of walls and floors.', 'חיפוי אריחים, צבע ותיקוני קירות ורצפות.'),
  L('Building or structural work. Fixing in the safe room (mamad) only as permitted by the Home Front Command.', 'עבודות בנייה או קונסטרוקציה. קיבוע בממ״ד רק כפי שמותר על ידי פיקוד העורף.'),
];

/** Alternatives the bidder is asked to price (rows of the options table). */
export const ALTERNATIVES = [
  L('Hardware upgrade to Blum / Hettich (or equal) premium series throughout', 'שדרוג פרזול לסדרת פרימיום של Blum / Hettich (או שווה ערך) בכל הפרויקט'),
  L('Kitchen fronts in nano-matt laminate (Fenix-type) instead of lacquered MDF', 'חזיתות מטבח בלמינציה ננו מט (בסגנון Fenix) במקום MDF צבוע בתנור'),
  L('Kitchen fronts in high-pressure laminate (Formica) instead of lacquered MDF', 'חזיתות מטבח בפורמייקה (HPL) במקום MDF צבוע בתנור'),
  L('Wardrobe fronts in lacquered MDF instead of melamine', 'חזיתות ארונות בגדים ב־MDF צבוע בתנור במקום מלמין'),
  L('Worktop in sintered porcelain (Dekton-type) instead of quartz', 'משטח פורצלן מסונטר (בסגנון Dekton) במקום קוורץ'),
  L('Handle-less fronts (gola channel) in the kitchen', 'חזיתות ללא ידיות (פרופיל גולה) במטבח'),
];

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '2026-11-13' → '13 November 2026' / '13.11.2026'. Unparseable input is returned as given. */
export function fmtDate(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const [, y, mo, d] = m;
  return lang === 'he' ? `${d}.${mo}.${y}` : `${Number(d)} ${MONTHS_EN[Number(mo) - 1]} ${y}`;
}

/** 12500 → '12,500'. */
export const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
/** Centimetres with at most one decimal. */
export const fmtCm = (v) => { const x = Math.round(v * 10) / 10; return Number.isInteger(x) ? String(x) : x.toFixed(1); };
