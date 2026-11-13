/**
 * Carpentry vocabularies (materials, finishes, hardware…) and the default RunSpec per run kind.
 * Pure data + small helpers. Every user-facing name is bilingual { en, he }.
 * Units: cm for every dimension in a spec EXCEPT board / worktop thicknesses, which are in mm (as carpenters quote them).
 */

const L = (en, he) => ({ en, he });

/** Closed vocabularies. Keys are what a RunSpec stores; values are the bilingual labels. */
export const VOCAB = {
  runKind: {
    kitchen: L('Kitchen', 'מטבח'), island: L('Kitchen island', 'אי מטבח'), wardrobe: L('Wardrobe', 'ארון בגדים'),
    pantry: L('Pantry', 'מזווה'), vanity: L('Bathroom vanity', 'ארון אמבטיה'), utility: L('Laundry / utility', 'כביסה / שירות'),
    media: L('TV / media wall', 'קיר טלוויזיה'), entry: L('Entry closet', 'ארון כניסה'), shelving: L('Shelving / bookcase', 'מדפים / ספרייה'),
    desk: L('Fitted desk', 'שולחן עבודה בנוי'), custom: L('Custom carpentry', 'נגרות מיוחדת'),
  },
  level: {
    base: L('Base unit', 'ארון תחתון'), wall: L('Wall unit', 'ארון עליון'), tall: L('Tall unit', 'ארון גבוה'),
    island: L('Island', 'אי'), full: L('Full-height unit', 'ארון לגובה מלא'),
  },
  carcassMaterial: {
    mfc: L('Melamine-faced chipboard (MFC)', 'סיבית מצופה מלמין (טגו)'),
    plywood: L('Plywood', 'דיקט (סנדוויץ׳)'),
    mdf: L('MDF', 'MDF'),
  },
  backMaterial: {
    hdf: L('HDF back panel', 'גב HDF'), mfc: L('MFC back panel', 'גב סיבית מצופה מלמין'), plywood: L('Plywood back panel', 'גב דיקט'),
  },
  frontMaterial: {
    melamine: L('Melamine (MFC)', 'מלמין (טגו)'),
    laminate: L('High-pressure laminate (Formica)', 'פורמייקה (HPL)'),
    'lacquer-matt': L('Lacquered MDF, matt', 'MDF צבוע בתנור, מט'),
    'lacquer-gloss': L('Lacquered MDF, high gloss', 'MDF צבוע בתנור, מבריק (היי-גלוס)'),
    veneer: L('Wood veneer', 'פורניר עץ'),
    'solid-frame': L('Solid-wood frame', 'מסגרת עץ מלא'),
    glass: L('Glass', 'זכוכית'),
    fenix: L('Nano matt laminate (Fenix-type)', 'למינציה ננו מט (בסגנון Fenix)'),
  },
  frontStyle: {
    flat: L('Flat (slab)', 'חזית חלקה'), shaker: L('Shaker / framed', 'שייקר / מסגרת'),
    'j-profile': L('Handle-less, J-profile', 'ללא ידיות — פרופיל J'), gola: L('Handle-less, gola channel', 'ללא ידיות — פרופיל גולה'),
  },
  handleType: {
    bar: L('Bar handle', 'ידית מוט'), knob: L('Knob', 'ידית כפתור'), 'edge-pull': L('Edge pull', 'ידית חריץ עליונה'),
    push: L('Push-to-open', 'פתיחה בלחיצה (פוש)'), none: L('No handle (profile)', 'ללא ידית (פרופיל)'),
  },
  finish: {
    black: L('Matt black', 'שחור מט'), steel: L('Brushed steel', 'נירוסטה מוברשת'), brass: L('Brushed brass', 'פליז מוברש'),
    white: L('White', 'לבן'), aluminium: L('Anodised aluminium', 'אלומיניום אנודייז'), wood: L('Wood', 'עץ'),
    'matching-fronts': L('To match the fronts', 'בגוון החזיתות'), carcass: L('Carcass colour', 'בגוון הגוף'),
  },
  edge: {
    'abs-1': L('ABS edge 1 mm', 'קנט ABS 1 מ״מ'), 'abs-2': L('ABS edge 2 mm', 'קנט ABS 2 מ״מ'),
    'pvc-0.4': L('PVC edge 0.4 mm', 'קנט PVC 0.4 מ״מ'), laser: L('Laser (zero-joint) edge', 'קנט לייזר (ללא תפר)'),
    painted: L('Painted with the front', 'צבוע יחד עם החזית'),
  },
  hardwareGrade: {
    standard: L('Standard', 'סטנדרט'), 'soft-close': L('Soft-close', 'טריקה שקטה'),
    premium: L('Premium (Blum / Hettich class)', 'פרימיום (בדרגת Blum / Hettich)'),
  },
  worktopMaterial: {
    quartz: L('Quartz (Caesarstone-type)', 'אבן קוורץ (בסגנון Caesarstone)'), porcelain: L('Sintered porcelain (Dekton-type)', 'פורצלן / אבן מסונטרת (בסגנון Dekton)'),
    granite: L('Granite', 'גרניט'), 'solid-wood': L('Solid wood', 'עץ מלא'), laminate: L('Laminate (post-formed)', 'משטח פורמייקה (למינציה)'),
    stainless: L('Stainless steel', 'נירוסטה'), none: L('No worktop', 'ללא משטח'),
  },
  worktopEdge: {
    eased: L('Square, eased arris', 'ישר, פינה מעוגלת קלות'), bevel: L('Bevelled', 'פאזה'), bullnose: L('Half bullnose', 'חצי עגול'),
    mitred: L('Mitred thick edge', 'מיטר (עיבוי)'),
  },
  splashback: {
    'same-as-worktop': L('Same stone as the worktop', 'אבן כמו המשטח'), tiles: L('Wall tiles', 'אריחי חיפוי'),
    glass: L('Back-painted glass', 'זכוכית צבועה'), none: L('None', 'ללא'),
  },
  plinthFinish: {
    'matching-fronts': L('To match the fronts', 'בגוון החזיתות'), aluminium: L('Aluminium plinth', 'צוקל אלומיניום'),
    carcass: L('Carcass colour', 'בגוון הגוף'),
  },
  aboveTop: {
    open: L('Open to the ceiling', 'פתוח עד התקרה'), filler: L('Closed with a bulkhead filler to the ceiling', 'סגירה בפאנל עד התקרה'),
    cabinet: L('Top boxes to the ceiling', 'בוידעם (ארונות עליונים) עד התקרה'),
  },
  wardrobeInternal: {
    hanging: L('Long hanging + shelf', 'תלייה ארוכה + מדף'),
    'double-hanging': L('Double hanging', 'תלייה כפולה'),
    shelves: L('Shelves', 'מדפים'),
    drawers: L('Internal drawers + hanging', 'מגירות פנימיות + תלייה'),
    shoes: L('Shoe shelves / pull-out', 'מדפי נעליים / נשלף'),
    trousers: L('Trouser rack + hanging', 'מתקן מכנסיים + תלייה'),
    mixed: L('Half shelves, half hanging', 'חצי מדפים חצי תלייה'),
  },
  pantryInternal: {
    shelves: L('Adjustable shelves', 'מדפים מתכווננים'), drawers: L('Internal drawers', 'מגירות פנימיות'),
    larder: L('Pull-out larder', 'מזווה נשלף (קרגו)'),
  },
  doorOperation: {
    hinged: L('Hinged doors', 'דלתות ציר'), removable: L('Removable lift-off doors', 'דלתות נשלפות (מורמות מהצירים)'),
    sliding: L('Sliding doors', 'דלתות הזזה'), pocket: L('Pocket doors (retract into side pockets)', 'דלתות כיס נסתרות (נכנסות לצדדים)'),
    bifold: L('Bi-fold doors', 'דלת אקורדיון (מתקפלת)'), tambour: L('Tambour / roller shutter', 'תריס גלילה'),
    'lift-up': L('Lift-up door', 'דלת הרמה (קלפה)'), 'drop-down': L('Drop-down flap', 'דלת נפתחת כלפי מטה'),
    'push-open': L('Push-to-open doors (no handle)', 'דלתות פתיחה בלחיצה (ללא ידית)'), curtain: L('Fabric curtain', 'וילון בד'),
    none: L('No doors (open)', 'ללא דלתות (פתוח)'),
  },
  cornerPantry: {
    diagonal: L('Diagonal front', 'חזית אלכסונית'), 'l-doors': L('Two doors meeting at the inside corner (no post)', 'שתי דלתות הנפגשות בפינה הפנימית (ללא עמוד)'),
    'walk-in': L('Walk-in corner pantry, U-shaped shelving', 'מזווה פינתי נכנס, מדפים בצורת U'),
  },
  featureCategory: {
    construction: L('Construction', 'מבנה'), doors: L('Doors / fronts', 'דלתות / חזיתות'), internal: L('Interior', 'חלוקה פנימית'),
    finish: L('Finish', 'גימור'), hardware: L('Hardware', 'פרזול'), appliance: L('Appliance', 'מכשיר'), lighting: L('Lighting', 'תאורה'),
    electrical: L('Electrical', 'חשמל'), other: L('Other', 'אחר'),
  },
  cellKind: {
    door: L('Door', 'דלת'), drawer: L('Drawer', 'מגירה'), drawers: L('Drawers', 'מגירות'), open: L('Open shelf', 'מדף פתוח'), glass: L('Glass door', 'דלת זכוכית'),
    panel: L('Fixed panel', 'פאנל קבוע'), appliance: L('Appliance', 'מכשיר'), pullout: L('Pull-out', 'נשלף'), void: L('Empty niche', 'נישה ריקה'),
  },
  /** Variants of take-off hardware lines (handle → handleType, profile → frontStyle, the rest here). */
  hwVariant: {
    standard: L('standard', 'רגיל'), glass: L('for glass doors', 'לדלת זכוכית'), 'blind-corner': L('blind corner', 'לפינה עיוורת'),
    internal: L('internal drawer', 'מגירה פנימית'), spice: L('spice pull-out', 'נשלף תבלינים'), bin: L('waste-bin pull-out', 'נשלף לפחי אשפה'),
    lemans: L('LeMans-type swing-out', 'מנגנון לה-מאן'), 'magic-corner': L('Magic-corner pull-out', 'מנגנון מג׳יק קורנר'), carousel: L('carousel', 'קרוסלה'),
    custom: L('bespoke', 'בהתאמה אישית'),
  },
  cornerInternal: {
    shelf: L('Fixed shelf', 'מדף קבוע'), lemans: L('LeMans-type swing-out', 'מנגנון לה-מאן'),
    'magic-corner': L('Magic-corner pull-out', 'מנגנון מג׳יק קורנר'), carousel: L('Carousel', 'קרוסלה'), none: L('Empty (dead corner)', 'פינה מתה (ללא גישה)'),
  },
};

/**
 * Hebrew for the free-text spec values the engine and the UI presets store in English (colours of fronts / carcass /
 * worktop, the default hinge / runner / lift-up descriptions). Keys are lower case. Values typed by the owner that are not
 * here stay as typed. Brand names stay in Latin letters.
 */
export const SPEC_TEXT_HE = {
  // colours (src/ui/carpentry/vocab.js presets + engine defaults)
  white: 'לבן', 'warm white': 'לבן חם', 'pure white': 'לבן בוהק', cashmere: 'קשמיר', greige: 'גרייג׳', 'stone grey': 'אפור אבן',
  'light grey': 'אפור בהיר', grey: 'אפור', anthracite: 'אנתרציט', black: 'שחור', sage: 'ירוק מרווה', 'forest green': 'ירוק יער',
  navy: 'כחול נייבי', oak: 'אלון', 'natural oak': 'אלון טבעי', walnut: 'אגוז', beige: 'בז׳', cream: 'שמנת',
  'white quartz': 'קוורץ לבן', calacatta: 'קלקטה', 'concrete grey': 'אפור בטון', basalt: 'בזלת', travertine: 'טרוורטין', steel: 'נירוסטה',
  // default hardware descriptions (DEFAULT_SPEC.hardware)
  'clip-on 110°': 'ציר קליפס 110°', 'full-extension box': 'מגירת קופסה על מסילות טלסקופיות (שליפה מלאה)', 'stay-lift': 'מנגנון הרמה (סטיי-ליפט)',
  'soft-close': 'טריקה שקטה',
};
/** A free-text spec value as { en, he } (Hebrew from SPEC_TEXT_HE when known, otherwise the text as typed). */
export function specText(v) {
  if (v && typeof v === 'object') return v;
  const s = v == null || v === '' ? '—' : String(v);
  return L(s, SPEC_TEXT_HE[s.trim().toLowerCase()] || s);
}
/** Label of a take-off hardware variant: handles use handleType, handle profiles frontStyle, the rest VOCAB.hwVariant. */
export function hwVariantLabel(kind, variant) {
  if (variant == null || variant === '') return null;
  const g = kind === 'handle' ? VOCAB.handleType : kind === 'profile' ? VOCAB.frontStyle : VOCAB.hwVariant;
  return g[variant] || VOCAB.hwVariant[variant] || VOCAB.cornerInternal[variant] || L(String(variant), String(variant));
}

/** Recommended / limit values a professional designer works to (cm unless stated). */
export const RULES = {
  fillerAtWall: 5,          // filler between a hinged front and a wall / perpendicular run (handles)
  fillerAtWallHandleless: 3,
  fillerMin: 2, fillerMax: 15,
  frontGap: 0.3,            // gap between fronts
  topGap: 0.3,              // gap above the fronts of base units, under the worktop
  hobToTall: 40, hobToTallMin: 30,
  hobToWindow: 30,
  hobLanding: 30,           // worktop on each side of a hob
  sinkLanding: 45, sinkLandingOther: 30,
  fridgeLanding: 40,
  wallUnitAboveWorktop: 50, wallUnitAboveHob: 65,
  reachTopShelf: 200,       // top shelf above this needs a step
  aisleMin: 90, aisleRecommended: 100, aisleTwoCooks: 120, wardrobeAisle: 80,
  hangingDepth: 55, hangingDepthMin: 50, longHang: 150, shortHang: 95,
  slidingDoorMin: 60, slidingDoorMax: 120,
  hingesFor: (hMm) => (hMm <= 900 ? 2 : hMm <= 1600 ? 3 : hMm <= 2200 ? 4 : 5),
  drawerLengths: [270, 300, 350, 400, 450, 500, 550, 600, 650], // mm, standard runner lengths
  islandOverhangUnsupported: { 12: 20, 20: 30, 30: 35, 40: 40 }, // worktop mm → max unsupported seating overhang cm
  endOverhangUnsupported: 15,
  jointClearOfCutout: 10,
  cornerPantryAccess: 30,     // clear door width on a corner-pantry face
  diagonalDoorMin: 45, walkInLegMin: 120,
  customMinCell: 8, customMinDoor: 20, customMinColumn: 10,
};

/** The default RunSpec. Kind-specific deltas are in KIND_SPEC. */
export const DEFAULT_SPEC = {
  carcass: { material: 'mfc', thickness: 18, color: 'white', colorHex: '#f3f1ec', back: { material: 'hdf', thickness: 3 } },
  fronts: { material: 'lacquer-matt', thickness: 18, color: 'warm white', colorHex: '#f3f1ec', style: 'flat', drawerPattern: 'equal', mirror: false },
  handles: { type: 'bar', finish: 'black', length: 16 },
  edge: { carcass: 'abs-1', fronts: 'abs-2' },
  plinth: { height: 10, setback: 5, finish: 'matching-fronts' },
  hardware: { grade: 'soft-close', hinge: 'clip-on 110°', drawers: 'full-extension box', liftUp: 'stay-lift' },
  internals: {},
  worktop: { material: 'quartz', thickness: 20, color: 'white quartz', colorHex: '#e7e4de', edge: 'eased', upstand: 0, depth: 60, overhangEnd: 0, maxSlab: 300, slabDepth: 140 },
  splashback: { material: 'same-as-worktop', height: 55 },
  lighting: { underWall: true, inCabinet: false },
  appliances: [],
  heights: { worktop: 90, wallBottom: 145, topLine: 220, aboveTop: 'open', body: 240, scribe: 2 },
  depths: { base: 56, wall: 33, tall: 56, full: 58, island: 56 },
  endPanels: true,
};

/** Per-kind deltas merged over DEFAULT_SPEC by defaultSpec(kind). */
export const KIND_SPEC = {
  kitchen: {},
  island: { worktop: { depth: 120, overhangSeat: 30, waterfall: false, backPanel: true } },
  pantry: {},
  wardrobe: { fronts: { material: 'melamine', thickness: 18 }, handles: { type: 'bar', finish: 'black', length: 32 }, worktop: { material: 'none' },
    heights: { aboveTop: 'cabinet', body: 240 }, depths: { full: 58 }, lighting: { underWall: false, inCabinet: false }, splashback: { material: 'none' } },
  entry: { fronts: { material: 'melamine' }, handles: { type: 'push' }, worktop: { material: 'none' }, heights: { aboveTop: 'cabinet', body: 240 },
    depths: { full: 33 }, lighting: { underWall: false }, splashback: { material: 'none' } },
  utility: { fronts: { material: 'melamine' }, worktop: { material: 'laminate', thickness: 28 }, heights: { aboveTop: 'cabinet', body: 240 },
    depths: { full: 38 }, lighting: { underWall: false }, splashback: { material: 'none' } },
  vanity: { fronts: { material: 'laminate' }, handles: { type: 'edge-pull' }, worktop: { material: 'quartz', thickness: 12, depth: 50 }, heights: { worktop: 85 },
    depths: { base: 46 }, plinth: { height: 0 }, lighting: { underWall: false }, splashback: { material: 'none' } },
  media: { fronts: { material: 'lacquer-matt' }, handles: { type: 'push' }, worktop: { material: 'none' }, depths: { base: 38, wall: 25 },
    plinth: { height: 0 }, lighting: { underWall: false }, splashback: { material: 'none' } },
  shelving: { fronts: { material: 'melamine' }, worktop: { material: 'none' }, depths: { full: 30, wall: 25 }, plinth: { height: 5 },
    heights: { aboveTop: 'open', body: 240 }, lighting: { underWall: false }, splashback: { material: 'none' } },
  desk: { worktop: { material: 'none' }, depths: { base: 60 }, plinth: { height: 0 }, heights: { worktop: 75 }, lighting: { underWall: false }, splashback: { material: 'none' } },
  custom: { worktop: { material: 'none' }, splashback: { material: 'none' } },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Deep merge (objects only; arrays and scalars replace). Returns a new object; inputs untouched. */
export function deepMerge(base, over) {
  if (!isObj(over)) return over === undefined ? clone(base) : clone(over);
  const out = isObj(base) ? clone(base) : {};
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : clone(v);
  return out;
}
export const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

/** Default RunSpec for a run kind. */
export function defaultSpec(kind) { return deepMerge(DEFAULT_SPEC, KIND_SPEC[kind] || {}); }

/** The effective spec of a unit: run spec ⊕ unit.carp.spec overrides. */
export function unitSpec(run, unit) { return deepMerge(run.spec || defaultSpec(run.kind), (unit && unit.carp && unit.carp.spec) || {}); }

/** Bilingual label for a vocabulary value, falling back to the raw value. */
export function vocab(group, key) { return (VOCAB[group] && VOCAB[group][key]) || L(String(key), String(key)); }

/** Derived heights (cm) every module uses. */
export function derivedHeights(spec, ceiling = 300) {
  const h = spec.heights, plinth = spec.plinth.height, wt = spec.worktop.material === 'none' ? 0 : spec.worktop.thickness / 10;
  const worktop = h.worktop;
  const baseCarcass = worktop - plinth - wt;
  const wallBottom = h.wallBottom, topLine = Math.min(h.topLine, ceiling), wallH = topLine - wallBottom;
  return { ceiling, plinth, wt, worktop, baseCarcass, wallBottom, topLine, wallH, tallH: topLine, body: Math.min(h.body, ceiling), aboveTop: h.aboveTop, scribe: h.scribe };
}
