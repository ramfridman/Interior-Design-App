/**
 * RULES — the catalogue of requirements the checker knows about. Data only.
 *
 * kind:
 *   'regulation'    – binding Israeli law / regulation (the permit is checked against it)
 *   'standard'      – Israeli Standard (ת"י) or official guideline (Home Front Command, ministry guidance)
 *   'best-practice' – professional ergonomics (NKBA, Neufert …); not law
 * confidence: how sure we are about the NUMBER as stated here —
 *   'high'   read in the consolidated text of the regulation during research (see docs/REGULATIONS.md)
 *   'medium' taken from a reputable secondary source or a widely used professional guideline
 *   'low'    rule of thumb / could not be confirmed in an authoritative text
 *
 * Every rule and its source is explained, with the Hebrew wording, in docs/REGULATIONS.md.
 */

export const DISCLAIMER =
  'These checks are a design aid, not a legal permit review. They compare the drawing and your layout with ' +
  'published Israeli regulations, standards and common professional practice, using the numbers written on the ' +
  'plan. The approved building permit, the local plan (תב"ע), the Home Front Command approval and the architect ' +
  'and engineer of record always govern — confirm anything marked as a warning with them before you build or buy.';

export const CATEGORIES = [
  'Rooms & dimensions', 'Light & ventilation', 'Doors & circulation', 'Safe room (Mamad)', 'Kitchen', 'Bathrooms',
  'Furniture clearances', 'Site & parking', 'Garden & outdoor structures', 'Assumptions',
];
const [ROOMS, LIGHT, DOORS, MAMAD, KITCHEN, BATH, FURN, SITE, GARDEN, ASSUME] = CATEGORIES;

const wiki = (title) => encodeURI('https://he.wikisource.org/wiki/' + title);

/** Sources. `name` = Hebrew title + English title. */
const SRC = {
  PBR: { name: 'תקנות התכנון והבניה (בקשה להיתר, תנאיו ואגרות), תש"ל-1970, התוספת השנייה — Planning & Building Regulations (Permit Application, Conditions and Fees) 1970, Second Schedule',
    url: wiki('תקנות_התכנון_והבניה_(בקשה_להיתר,_תנאיו_ואגרות)') },
  HAGA: { name: 'תקנות ההתגוננות האזרחית (מפרטים לבניית מקלטים), התש"ן-1990 — Civil Defence Regulations (Specifications for the Construction of Shelters) 1990',
    url: wiki('תקנות_ההתגוננות_האזרחית_(מפרטים_לבניית_מקלטים)') },
  EXEMPT: { name: 'תקנות התכנון והבנייה (עבודות ומבנים הפטורים מהיתר), התשע"ד-2014 — Planning & Building Regulations (Works and Structures Exempt from a Permit) 2014',
    url: wiki('תקנות_התכנון_והבנייה_(עבודות_ומבנים_הפטורים_מהיתר)') },
  PARK: { name: 'תקנות התכנון והבניה (התקנת מקומות חניה), התשמ"ג-1983 — Planning & Building Regulations (Installation of Parking Places) 1983',
    url: wiki('תקנות_התכנון_והבניה_(התקנת_מקומות_חניה)') },
  SAFETY: { name: 'תקנות התכנון והבנייה (תכן הבנייה) (בטיחות המשתמש), התש"ף-2019 — Planning & Building Regulations (Building Design) (User Safety) 2019',
    url: wiki('תקנות_התכנון_והבנייה_(תכן_הבנייה)_(בטיחות_המשתמש)') },
  SANIT: { name: 'תקנות התכנון והבנייה (תכן הבנייה) (תברואה), התש"ף-2019 — Planning & Building Regulations (Building Design) (Sanitation) 2019',
    url: wiki('תקנות_התכנון_והבנייה_(תכן_הבנייה)_(תברואה)') },
  GREEN: { name: 'תקנות התכנון והבנייה (תכן הבנייה) (בנייה בת-קיימה), התש"ף-2020 — Planning & Building Regulations (Building Design) (Sustainable Building) 2020',
    url: wiki('תקנות_התכנון_והבנייה_(תכן_הבנייה)_(בנייה_בת-קיימה)') },
  ELEC: { name: 'תקנות החשמל (מעגלים סופיים הניזונים במתח עד 1000 וולט), התשמ"ה-1984 — Electricity Regulations (Final Circuits up to 1000 V) 1984',
    url: wiki('תקנות_החשמל_(מעגלים_סופיים_הניזונים_במתח_עד_1000_וולט)') },
  SI1142: { name: 'ת"י 1142 מעקים ומסעדים — Israeli Standard SI 1142, Guardrails and Handrails (made binding by the User Safety regulations, reg. 4 & 7)',
    url: 'https://www.sii.org.il/he/lobby/standardization/standard-page?id=4172' },
  HFC: { name: 'פיקוד העורף — הנחיות לשימוש בממ"ד בשגרה — Home Front Command guidance on everyday use of the safe room (as quoted by N12, "כך תכינו את הממ"ד לשהות ממושכת")',
    url: 'https://www.mako.co.il/news-money/real_estate/Article-faf656164ae0b81026.htm' },
  NKBA_K: { name: 'NKBA Kitchen Planning Guidelines with Access Standards (National Kitchen & Bath Association)',
    url: 'https://kb.nkba.org/uploads/2022/05/Kitchen-Planning-Guidelines.pdf' },
  NKBA_B: { name: 'NKBA Bathroom Planning Guidelines / International Residential Code R307.1 (fixture clearances)', url: 'https://nkba.org/' },
  NEUFERT: { name: 'Neufert, Architects\' Data (Bauentwurfslehre); Panero & Zelnik, Human Dimension & Interior Space', url: null },
  IEC_FAN: { name: 'IEC 60335-2-80 (adopted in Israel as ת"י 900 חלק 2.80) — safety of fans: installation instructions', url: null },
  LIGHTING: { name: 'American Lighting Association / common lighting-design practice', url: 'https://alalighting.com/' },
  AV: { name: 'SMPTE EG-18 (30° viewing angle) and THX (36–40°) recommendations for screen viewing distance', url: null },
  NHBC: { name: 'Arboricultural rule of thumb (e.g. NHBC Standards ch. 4.2 "Building near trees"); mature canopy radius of the species', url: 'https://nhbc-standards.co.uk/' },
  FIRE: { name: 'Grill manufacturers\' instructions and NFPA 1 Fire Code §10.10.6 (3 m / 10 ft from structures for multi-family dwellings)', url: 'https://www.nfpa.org/' },
  WATER: { name: 'Water-wise gardening practice (hydrozoning) as promoted by the Israel Water Authority — גינון חסכוני במים', url: 'https://www.gov.il/he/departments/water_authority' },
  PLAN: { name: 'Architect drawing E7 / site plan for lot 98 (the data in src/core/plan.js) and the local detailed plan (תב"ע)', url: null },
};

const R = (id, category, kind, title, requirement, src, section, confidence) =>
  ({ id, category, kind, title, requirement, reference: { name: SRC[src].name, section, url: SRC[src].url }, confidence });

export const RULES = [
  // ───────────── Rooms & dimensions ─────────────
  R('room-size-habitable', ROOMS, 'regulation', 'Habitable room size',
    'Every habitable room (חדר מגורים): floor area ≥ 8.0 m² and ≥ 2.60 m between walls; in a dwelling with two or more rooms at least one room ≥ 12.0 m². Width is measured 1.20 m above the floor and need only be kept over the minimum area.',
    'PBR', 'Part B, §2.04(a)(1)–(3), (b), (c)', 'high'),
  R('room-size-bathroom', ROOMS, 'regulation', 'Bathroom size',
    'Bathroom (חדר אמבטיה): ≥ 2.5 m² and ≥ 1.45 m wide. A wash room with shower and toilet only (חדר רחצה המכיל מקלחת ואסלה): ≥ 1.8 m² and ≥ 0.90 m wide.',
    'PBR', 'Part B, §2.04(a)(5), (10)', 'high'),
  R('room-size-wc', ROOMS, 'regulation', 'WC size', 'Toilet room (בית שימוש): ≥ 1.1 m² and ≥ 0.80 m wide, measured between wall finishes.',
    'PBR', 'Part B, §2.04(a)(6)', 'high'),
  R('room-size-kitchen', ROOMS, 'regulation', 'Kitchen size',
    'Kitchen in a dwelling with two or more rooms: ≥ 6.0 m² and ≥ 1.70 m wide (≥ 5.0 m² when it adjoins a dining area of at least 4.0 m²).',
    'PBR', 'Part B, §2.04(a)(7), (9)', 'high'),
  R('room-size-service', ROOMS, 'regulation', 'Laundry / service room',
    'The regulations define "service room" (חדר שירות) as bathroom, WC, pantry or closet room; a laundry room has no statutory minimum area. Minimum ceiling height for service rooms is 2.05 m.',
    'PBR', 'Reg. 1 (definitions) and Part B, §2.03(a)(3)', 'medium'),
  R('ceiling-height', ROOMS, 'regulation', 'Ceiling height',
    'Rooms used by people: ≥ 2.50 m. Service rooms, internal corridors and non-habitable spaces: ≥ 2.05 m. Head room in escape routes ≥ 2.20 m (fixtures may come down to 2.00 m).',
    'PBR', 'Part B, §2.03(a)(3)–(4); Part C, §3.1.2.5', 'high'),

  // ───────────── Light & ventilation ─────────────
  R('light-habitable', LIGHT, 'regulation', 'Daylight & ventilation of habitable rooms',
    'Habitable rooms and kitchens must have windows to the open air; total window area (glazed doors count) ≥ 8% of the room\'s floor area. "Window area" is the structural opening.',
    'PBR', 'Part B, §2.01, §2.20, §2.21(a)', 'high'),
  R('light-kitchen', LIGHT, 'regulation', 'Kitchen windows', 'Total window area in a kitchen ≥ 5% of the kitchen floor area.',
    'PBR', 'Part B, §2.21(b)', 'high'),
  R('light-service', LIGHT, 'regulation', 'Bathroom / WC ventilation',
    'A service room (bathroom, WC) is ventilated either by a window ≥ 10% of its floor area and not less than 0.3 m², or by a vent duct / mechanical extractor (≥ 3 air changes per hour). Without daylight, artificial lighting of 100 lux is required.',
    'PBR', 'Part B, §2.21(c), §2.40–2.47, §2.61, §2.80', 'high'),
  R('vent-laundry', LIGHT, 'best-practice', 'Laundry room ventilation',
    'A windowless laundry room with a dryer should have a mechanical extractor or a vented door to remove moisture.',
    'PBR', 'by analogy with Part B, §2.40–2.47 (not a statutory requirement for a laundry room)', 'low'),
  R('sill-guard', LIGHT, 'regulation', 'Window sills and fall protection',
    'A guard complying with SI 1142 is required at any balcony or wall opening with a risk of falling and wherever two adjacent levels differ by 60 cm or more. SI 1142 guard height is 1.05 m with gaps no wider than 10 cm.',
    'SAFETY', 'Reg. 4(a), 7 (guard height 1.05 m per SI 1142 — standard text not open-access)', 'medium'),
  R('glazing-safety', LIGHT, 'regulation', 'Safety glazing', 'All glazing must comply with SI 1099 (glass type and thickness by pane size and position); full-height glazed doors need safety glass.',
    'SAFETY', 'Reg. 9 (ת"י 1099 חלק 1.1)', 'high'),

  // ───────────── Doors & circulation ─────────────
  R('door-entry', DOORS, 'regulation', 'Entrance door', 'Exit door of a dwelling: clear width ≥ 0.80 m, clear height ≥ 1.98 m. The main entrance may not be a sliding door; threshold step ≤ 20 mm.',
    'PBR', 'Part C, §3.2.1.3 table row 2, §3.2.1.4, §3.8.4.2, §3.8.4.5', 'high'),
  R('door-room', DOORS, 'regulation', 'Room doors', 'Door of a habitable room in a dwelling: clear width ≥ 0.70 m; clear height ≥ 1.98 m.',
    'PBR', 'Part C, §3.2.1.3 table row 4, §3.2.1.4', 'high'),
  R('door-service', DOORS, 'regulation', 'Bathroom / WC doors', 'At least one service room with a toilet needs a door ≥ 0.70 m wide; additional service rooms ≥ 0.60 m. The lock must be openable from outside in an emergency.',
    'PBR', 'Part C, §3.2.1.3 table rows 5–6, §3.8.4.4', 'high'),
  R('corridor-width', DOORS, 'regulation', 'Corridor width', 'Corridor inside a dwelling ≥ 0.90 m; a corridor that serves as the main entrance ≥ 1.00 m (measured 1.20 m above the floor between finishes).',
    'PBR', 'Part C, §3.2.12.5 table rows 1–2, §3.2.12.10', 'high'),
  R('smoke-detectors', DOORS, 'regulation', 'Smoke detectors', 'In a building with up to two dwellings a stand-alone smoke detector (SI 1220-5) is required in every bedroom, in the lobby leading to the bedrooms and on every storey without bedrooms.',
    'PBR', 'Part C, ch. D, §3.4.6.2 and the residential table in sign 11 (row 1)', 'high'),
  R('door-swing', DOORS, 'best-practice', 'Door swings kept clear', 'Nothing should stand inside the arc a door leaf sweeps when it opens.', 'NEUFERT', 'Doors — swing clearance', 'high'),
  R('doorway-clear', DOORS, 'best-practice', 'Doorways kept clear', 'Keep the floor in front of and behind every doorway free for at least 60 cm.', 'NEUFERT', 'Circulation', 'medium'),
  R('walkway', DOORS, 'best-practice', 'Walkways between furniture',
    'Main routes through a home should be 80–90 cm wide (NKBA: 36 in / 91 cm walkway); 60 cm is the absolute minimum for one person.',
    'NKBA_K', 'Guideline 7 (walkway ≥ 36 in); Neufert circulation widths (60 cm minimum)', 'medium'),

  // ───────────── Safe room (Mamad) ─────────────
  R('mamad-area', MAMAD, 'regulation', 'Mamad area and volume', 'Net floor area ≥ 9 m² (walls excluded) and volume ≥ 22.5 m³.', 'HAGA', 'Reg. 197א(1)', 'high'),
  R('mamad-height', MAMAD, 'regulation', 'Mamad height and width', 'Clear height not less than 2.50 m and not more than 2.80 m unless the competent authority (Home Front Command) approved otherwise; width ≥ 1.60 m.',
    'HAGA', 'Reg. 198', 'high'),
  R('mamad-use', MAMAD, 'regulation', 'Permitted use of the mamad', 'A mamad may not serve as a kitchen, bathroom or toilet room. Use as a bedroom, study or guest room is allowed.', 'HAGA', 'Reg. 199', 'high'),
  R('mamad-ext-walls', MAMAD, 'regulation', 'Mamad external walls', 'Not more than two external walls without approval of the competent authority.', 'HAGA', 'Reg. 200', 'high'),
  R('mamad-door', MAMAD, 'regulation', 'Blast door', 'One gas-tight blast door, opening outwards from the mamad; clear opening 70 × 200 cm minimum, 80 × 200 cm maximum (80–90 cm when a concrete wall faces the door closer than 1.30 m).',
    'HAGA', 'Reg. 202, 204', 'high'),
  R('mamad-door-position', MAMAD, 'regulation', 'Blast door position', 'The blast door sits in an internal wall at least 4.00 m from the parallel external wall facing it (measured outside the mamad) and ≥ 2.20 m from a perpendicular external wall, or is shielded per the specification.',
    'HAGA', 'Reg. 203', 'high'),
  R('mamad-window', MAMAD, 'regulation', 'Blast window', 'Exactly one blast window; sill ≥ 1.05 m above the floor; area ≤ 1.21 m²; width 0.60–1.10 m; height 0.80–1.10 m.', 'HAGA', 'Reg. 205, 206', 'high'),
  R('mamad-walls', MAMAD, 'regulation', 'Mamad wall thickness', 'Reinforced concrete: external walls ≥ 25 cm, internal walls ≥ 20 cm; a wall holding a sliding blast window ≥ 30 cm.', 'HAGA', 'Reg. 208', 'high'),
  R('mamad-finishes', MAMAD, 'regulation', 'Mamad wall finishes', 'Walls and ceiling may not be clad with ceramic or other tiles; finish is plaster/paint up to 2 mm or an SI 5075 system. Floor tiles and a skirting up to 10 cm are allowed.',
    'HAGA', 'Reg. 192(a)–(b), 193, applied to the mamad by reg. 217', 'high'),
  R('mamad-gas', MAMAD, 'regulation', 'Gas cylinders near the mamad', 'LPG cooking-gas cylinders must be at least 3 m from the walls of the mamad.', 'HAGA', 'Reg. 217א', 'high'),
  R('mamad-ac', MAMAD, 'regulation', 'Air conditioner in the mamad', 'An air conditioner in a mamad must be installed per SI 994 part 5; pipes and cables pass through sealed sleeves cast in the wall, and every wall penetration must be sealed against gas and water.',
    'EXEMPT', 'Reg. 19(4); Civil Defence regs. 190(e), 214(a)(4)–(5)', 'high'),
  R('mamad-furnishing', MAMAD, 'standard', 'Furnishing the mamad',
    'Home Front Command guidance: fix cabinets and shelves to the concrete walls with anchors; do not hang glass or ceramic items that can shatter (e.g. mirrors); keep heavy objects low; mount a TV on an internal wall; avoid chandeliers and heavy fittings; do not store flammable or toxic materials; do not use the room as a store.',
    'HFC', 'Home Front Command recommendations (secondary quotation; oref.org.il blocks automated access)', 'medium'),
  R('mamad-above-bed', MAMAD, 'standard', 'Nothing heavy above the bed', 'Shelves, cabinets, mirrors or framed glass should not hang above a bed in the safe room (blast and earthquake shaking throw them down).',
    'HFC', 'Derived from the Home Front Command guidance on heavy / shatterable objects', 'medium'),
  R('mamad-openings', MAMAD, 'standard', 'Blast door and window kept operable', 'The blast door and the steel window shutter must close fully within seconds: keep the door leaf\'s swing, the doorway and the window free of furniture; never remove the door or shutter.',
    'HFC', 'Home Front Command guidance — keep the mamad door and window intact and operable', 'medium'),

  // ───────────── Kitchen ─────────────
  R('kitchen-aisle', KITCHEN, 'best-practice', 'Kitchen work aisle', 'Work aisle ≥ 42 in (107 cm) for one cook, ≥ 48 in (122 cm) for two; 100–120 cm is the usual European range and 90 cm the practical minimum.',
    'NKBA_K', 'Guideline 6', 'high'),
  R('kitchen-triangle', KITCHEN, 'best-practice', 'Work triangle', 'Sink – cooktop – refrigerator: each leg 1.2–2.7 m (4–9 ft) and the three legs together ≤ 7.9 m (26 ft).', 'NKBA_K', 'Guideline 5', 'high'),
  R('kitchen-seating', KITCHEN, 'best-practice', 'Island seating', 'Allow 61 cm (24 in) of counter width per seat; knee space 38 cm deep at a 91 cm counter (46 cm at table height, 30 cm at a 107 cm bar).', 'NKBA_K', 'Guideline 9', 'high'),
  R('kitchen-seating-behind', KITCHEN, 'best-practice', 'Space behind island seats', '81 cm (32 in) behind the counter edge when nobody passes; 91 cm to edge past; 112 cm to walk past a seated person.', 'NKBA_K', 'Guideline 8', 'high'),
  R('kitchen-hood-window', KITCHEN, 'best-practice', 'Cooktop under a window', 'A cooktop under a window cannot take a wall-mounted hood; plan a ceiling or downdraft extractor and keep curtains away from the burners.', 'NKBA_K', 'Guideline 19 (cooking surface ventilation) — practical note', 'low'),

  // ───────────── Bathrooms ─────────────
  R('toilet-clearance', BATH, 'best-practice', 'Toilet clearances', 'Toilet centre line ≥ 38 cm (15 in) from any wall or fixture (46 cm recommended) and ≥ 53 cm (21 in) clear in front (60–76 cm recommended).',
    'NKBA_B', 'IRC R307.1 minimums; NKBA recommended values', 'medium'),
  R('basin-clearance', BATH, 'best-practice', 'Basin clearances', '≥ 53 cm (21 in) clear in front of a basin or vanity; 76 cm recommended.', 'NKBA_B', 'IRC R307.1 minimums; NKBA recommended values', 'medium'),
  R('bath-electric-zones', BATH, 'regulation', 'Electrical zones in bathrooms',
    'No electrical equipment inside the bath or shower tray (zone 0); no sockets within 60 cm of the bath / shower (zones 1–2; equipment there IPX5 / IPX4); sockets further away (zone 3, up to 2.40 m) only with a 30 mA residual-current device; switches for heaters outside the room.',
    'ELEC', 'Reg. 1 (zones 0–3), 19, 34', 'high'),

  // ───────────── Furniture clearances ─────────────
  R('item-in-wall', FURN, 'best-practice', 'Items inside walls', 'Furniture must not overlap a wall or a window.', 'PLAN', 'Geometry', 'high'),
  R('item-overlap', FURN, 'best-practice', 'Overlapping items', 'Two floor-standing pieces cannot occupy the same floor space.', 'PLAN', 'Geometry', 'high'),
  R('item-outside-room', FURN, 'best-practice', 'Items outside a room', 'Indoor pieces should stand inside a room.', 'PLAN', 'Geometry', 'high'),
  R('wall-item-side', FURN, 'best-practice', 'Wall-mounted items', 'TVs, air conditioners, shelves, mirrors and art must sit with their back on a wall and face into the room.', 'PLAN', 'Geometry', 'high'),
  R('window-blocked', FURN, 'best-practice', 'Furniture in front of windows', 'Pieces taller than the sill should not stand in front of a window: they block daylight, ventilation and the handle.', 'NEUFERT', 'Windows — furniture below sill height', 'medium'),
  R('bed-clearance', FURN, 'best-practice', 'Space around beds', '≥ 60 cm free on each accessible side of a bed (both sides of a double bed, one side of a single) and at the foot when it is a passage; 75–90 cm is comfortable.', 'NEUFERT', 'Bedrooms — bed access', 'medium'),
  R('wardrobe-clearance', FURN, 'best-practice', 'Space in front of wardrobes', '≥ 80–90 cm in front of a wardrobe with hinged doors (door leaf plus standing room); 60 cm is the bare minimum.', 'NEUFERT', 'Bedrooms — wardrobes', 'medium'),
  R('dining-clearance', FURN, 'best-practice', 'Space around the dining table', '75–90 cm from the table edge to a wall or furniture to pull a chair out (NKBA: 81 cm with no traffic, 91 cm to edge past, 112 cm to walk past).', 'NKBA_K', 'Guideline 8', 'high'),
  R('desk-clearance', FURN, 'best-practice', 'Space at a desk', '≥ 90 cm behind the desk edge for the chair (75 cm minimum).', 'NEUFERT', 'Workplaces — desk and chair zone', 'medium'),
  R('sofa-table', FURN, 'best-practice', 'Sofa to coffee table', '40–45 cm between the seat front and the coffee table (30–60 cm acceptable).', 'NEUFERT', 'Living rooms — seating groups', 'medium'),
  R('tv-distance', FURN, 'best-practice', 'TV viewing distance', 'For a 4K screen sit about 1.2–1.6 × the screen diagonal away (THX / SMPTE); up to 2.5 × is still comfortable. Screen centre near seated eye level (≈ 1.0–1.2 m).', 'AV', 'Viewing angle 30–40°', 'medium'),
  R('pendant-height', FURN, 'best-practice', 'Pendant lights', 'Bottom of a pendant 75–90 cm above a table top; in walkways keep ≥ 2.00–2.10 m head room under any fitting.', 'LIGHTING', 'Pendant mounting heights; head room per PBR Part C §3.1.2.5 (2.00 m under fixtures)', 'medium'),
  R('fan-clearance', FURN, 'best-practice', 'Ceiling fans', 'Fan blades ≥ 2.30 m above the floor and ≥ 45–60 cm from walls and tall furniture.', 'IEC_FAN', 'Installation instruction clause (blades more than 2.3 m above the floor)', 'medium'),
  R('rug-door', FURN, 'best-practice', 'Rugs and doors', 'A rug under a door swing must be thin enough for the leaf to pass (doors clear the floor by about 1 cm).', 'NEUFERT', 'Practical detailing', 'low'),
  R('rug-dining', FURN, 'best-practice', 'Rug under a dining table', 'A dining rug should extend at least 60 cm beyond the table on every side so chairs stay on it when pulled out.', 'NEUFERT', 'Interior-design rule of thumb', 'low'),

  // ───────────── Site & parking ─────────────
  R('parking-count', SITE, 'regulation', 'Number of parking places', 'Detached or semi-detached house: 2 parking places per dwelling as a minimum in a settlement without a mass-transit system (1–2 near mass transit).', 'PARK', 'Schedule, Part B, table 1 row 1.1', 'high'),
  R('parking-size', SITE, 'standard', 'Parking bay size', 'Standard perpendicular bay 2.50 × 5.00 m (Ministry of Transport parking-design guidelines; the size drawn on the site plan).', 'PLAN', 'Site plan; Ministry of Transport "הנחיות לתכנון חניה" (not re-verified in the source text)', 'medium'),
  R('parking-clear', SITE, 'best-practice', 'Parking bays kept clear', 'Required parking bays may not be built over or used for sheds, planting or furniture.', 'EXEMPT', 'Reg. 29(4) (no shed on an area designated for parking)', 'high'),
  R('building-line', SITE, 'regulation', 'Building line', 'The building must stay inside the building lines of the local plan. In the setback only the items listed in §4.09 are allowed: fences ≤ 1.5 m, paths and paved parking, utility installations ≤ 1.5 m high, uncovered steps, and a light pergola projecting up to 40% of the setback.',
    'PBR', 'Part D, §4.02, §4.09', 'high'),
  R('setbacks', SITE, 'regulation', 'Setbacks from the property line', 'Setbacks written on the site plan (lot 98): 4.00 m west, 3.00 m north, east and south.', 'PLAN', 'Site plan dimensions (plan.site.setbacks)', 'high'),
  R('lot-boundary', SITE, 'regulation', 'Everything inside the lot', 'Nothing may be placed beyond the property line; gates may not open beyond it.', 'EXEMPT', 'Reg. 10(a)(2); general planning law', 'high'),
  R('entry-path', SITE, 'best-practice', 'Path to the front door', 'Keep the path from the street / parking to the entrance at least 90 cm clear.', 'NEUFERT', 'External circulation widths', 'medium'),
  R('energy-roof', SITE, 'regulation', 'Hot water and solar', 'A dwelling needs a hot-water system (solar per SI 579, heat pump or equivalent). A new ground-attached house with a roof over 100 m² must also get a photovoltaic system of 5 kVA unless the engineer exempts it.',
    'GREEN', 'Reg. 8א(a)(2), 8ב(a)(2); Sanitation regs. 10, 12, 24', 'medium'),

  // ───────────── Garden & outdoor structures ─────────────
  R('pergola-exempt', GARDEN, 'regulation', 'Pergola without a permit', 'A pergola (מצללה) is exempt from a permit when it has no walls, is of light materials (≤ 50 kg/m²), its roof is at least 40% open with evenly spaced gaps, and its area is ≤ 50 m² or ¼ of the unbuilt ground, whichever is larger. Notify the licensing authority within 45 days with a structural engineer\'s approval.',
    'EXEMPT', 'Reg. 1 (definition), 12', 'high'),
  R('pergola-setback', GARDEN, 'regulation', 'Pergola beyond the building line', 'A light pergola may project beyond the building line by up to 40% of the setback.', 'PBR', 'Part D, §4.09(12)', 'high'),
  R('roofed-structure', GARDEN, 'regulation', 'Solid-roofed structures', 'A gazebo, carport or solid / polycarbonate roof on posts is not an exempt pergola: it needs a building permit, counts as built area and must respect the building line (an attached canopy up to 2 m deep of light materials is exempt).',
    'EXEMPT', 'Reg. 1 (pergola definition), 11(a)', 'high'),
  R('shade-sail', GARDEN, 'regulation', 'Shade sails', 'A fabric shade sail is exempt up to 3 m high with posts no more than 5 m apart and fabric ≤ 3.5 kg/m².', 'EXEMPT', 'Reg. 11(c)', 'high'),
  R('shed-exempt', GARDEN, 'regulation', 'Garden shed without a permit', 'One shed per dwelling, light materials only, ≤ 6 m², ≤ 2.05 m high (2.40 m with a pitched roof), no water / sewer / electricity, not on a parking area; notify within 45 days.', 'EXEMPT', 'Reg. 29', 'high'),
  R('fence-exempt', GARDEN, 'regulation', 'Fences and walls', 'A fence up to 1.5 m above the ground on both sides (retaining wall up to 1.0 m) is exempt, except on the street front or facing public open space, where a permit / local guidelines apply.', 'EXEMPT', 'Reg. 5; PBR Part D §4.09(1)', 'high'),
  R('pool-safety', GARDEN, 'regulation', 'Private pool safety', 'A private pool deeper than 60 cm needs a building permit and a barrier that prevents uncontrolled entry, especially by children: the lot must be enclosed (pool under 10 m²) or the pool surround, plant and chemicals fenced (over 10 m²). The 1.10 m fence height is written for public pools; use it as the minimum.',
    'PBR', 'Part 21, §21.1.4.6 (private pool), §21.1.3.4 (1.1 m fence, public pools)', 'high'),
  R('pool-distance', GARDEN, 'best-practice', 'Pool position', 'Keep a pool at least 1 m from the house and the property line and inside the building lines unless the local plan says otherwise.', 'PLAN', 'Local plan / spatial guidelines (הנחיות מרחביות) — not verified for Afikim', 'low'),
  R('bbq-distance', GARDEN, 'best-practice', 'BBQ and fire-pit distances', 'Keep a grill at least 1 m — preferably 3 m — from the house, openings, fences and anything that burns, never under a pergola; an open fire pit 3 m.', 'FIRE', 'Manufacturer clearances; NFPA 1 §10.10.6', 'low'),
  R('tree-distance', GARDEN, 'best-practice', 'Trees near the house and the boundary', 'Plant trees away from foundations, drains and the boundary in proportion to their mature size: large-canopy or aggressive-root species (ficus, eucalyptus, poinciana) ≥ 6–8 m from the house and 4 m from the boundary; medium trees 4 m / 2 m; small trees 2.5 m / 1.5 m.',
    'NHBC', 'Rule of thumb by mature size', 'low'),
  R('hydrozones', GARDEN, 'best-practice', 'Water-zone planting', 'In the hot Jordan Valley group plants by water need: keep thirsty plants (lawn, tropical fruit, ferns) on separate irrigation lines from drought-tolerant ones (succulents, lavender, rosemary, olive, bougainvillea).', 'WATER', 'Hydrozoning principle', 'low'),

  // ───────────── Assumptions ─────────────
  R('assumption', ASSUME, 'best-practice', 'Drawing assumptions', 'Dimensions that are not written on the drawing are assumptions until the architect confirms them.', 'PLAN', 'plan.assumptions', 'high'),
  R('plan-consistency', ASSUME, 'best-practice', 'Plan data consistency', 'Areas and distances computed from the digitised plan should match the figures written on the drawing.', 'PLAN', 'Written dimensions', 'high'),
];

const BY_ID = new Map(RULES.map((r) => [r.id, r]));
/** @returns {object|null} the rule with this id */
export const ruleById = (id) => BY_ID.get(id) || null;
/** Short one-line reference for a finding. */
export const refString = (rule) => `${rule.reference.name} — ${rule.reference.section}`;
