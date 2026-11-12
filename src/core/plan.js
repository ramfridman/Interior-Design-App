/**
 * HOUSE PLAN — single source of truth for the building and the lot.
 *
 * Source: architect drawing "E7" (Ohad Abutbul Architecture, scale 1:100, dated 8.11.26),
 * Kibbutz Afikim, "Gan Bayit" neighbourhood. All geometry below was measured from the
 * vector PDF (not eyeballed) and cross-checked against every written dimension chain.
 *
 * COORDINATE SYSTEM (plan space)
 *   units : centimetres
 *   origin: outer north-west corner of the house (top-left corner on the drawing)
 *   +x    : east  (right on the drawing)
 *   +y    : south (down on the drawing)
 *   The house occupies x 0..1535, y 0..1380.
 *
 * 3D mapping used everywhere: X = x/100, Z = y/100, Y = up (metres).
 *
 * Anything the drawing does NOT state is listed in ASSUMPTIONS and must stay user-editable.
 */

export const META = {
  name: 'E7 House — Kibbutz Afikim',
  model: 'E7',
  location: 'Kibbutz Afikim, Jordan Valley, Israel',
  neighbourhood: 'Gan Bayit',
  architect: 'Ohad Abutbul Architecture',
  drawingDate: '2026-11-08',
  drawingScale: '1:100',
  grossFloorArea: 163,        // m² — "שטח קומת קרקע" as written on the drawing
  floors: 1,
  // North is ~8° counter-clockwise from "up" on the drawing (read from the compass rose).
  // northAngle = clockwise degrees from plan "up" (-y) to true north.
  northAngle: -8,
  // Site datum from the survey: about -201.5 m (below sea level) — hot Jordan Valley climate.
  elevation: -201.5,
};

/** Vertical dimensions (cm). */
export const HEIGHTS = {
  ceiling: 300,          // CONFIRMED by owner: 3.00 m floor-to-ceiling
  slab: 20,              // roof slab thickness (assumed)
  parapet: 40,           // flat-roof parapet above slab (assumed; flat roof CONFIRMED by owner)
  floorAboveGround: 15,  // finished floor above garden level (assumed)
  doorDefault: 210,      // written on drawing for exterior doors; assumed for interior doors
};

export const HOUSE_BOUNDS = { x: 0, y: 0, w: 1535, h: 1380 };

/**
 * Solid wall pieces as axis-aligned rectangles [x, y, w, h, kind].
 * These are the plan footprint of full-height wall material. Door/window gaps are NOT in here —
 * they are in OPENINGS (the wall above a door / above+below a window is generated from the opening).
 * kind: 'exterior' (20 cm block), 'interior' (10 cm partition; a few 20 cm), 'mamad' (reinforced concrete shelter shell).
 */
export const WALLS = [
  [0, 0, 140, 20, 'exterior'], [220, 0, 140, 20, 'exterior'], [665, 0, 150, 20, 'exterior'],
  [895, 0, 110, 20, 'exterior'], [1095, 0, 440, 20, 'exterior'], [0, 20, 20, 200, 'exterior'],
  [340, 20, 20, 470, 'interior'], [665, 20, 20, 345, 'mamad'], [905, 20, 10, 200, 'interior'],
  [1145, 20, 10, 200, 'interior'], [1515, 20, 20, 80, 'exterior'], [360, 80, 95, 30, 'mamad'],
  [555, 80, 110, 30, 'mamad'], [660, 110, 5, 255, 'mamad'], [20, 180, 220, 10, 'interior'],
  [330, 180, 10, 10, 'interior'], [915, 200, 90, 10, 'interior'], [1095, 200, 50, 10, 'interior'],
  [1515, 240, 20, 170, 'exterior'], [0, 300, 20, 180, 'exterior'], [905, 310, 10, 20, 'interior'],
  [1145, 310, 10, 30, 'interior'], [685, 320, 220, 10, 'interior'], [1155, 320, 360, 10, 'interior'],
  [1145, 430, 10, 220, 'interior'], [660, 445, 25, 35, 'mamad'], [950, 450, 10, 80, 'interior'],
  [360, 460, 300, 20, 'mamad'], [960, 500, 185, 10, 'interior'], [1135, 510, 10, 140, 'interior'],
  [1515, 550, 20, 100, 'exterior'], [0, 560, 20, 120, 'exterior'], [340, 580, 20, 130, 'exterior'],
  [360, 590, 325, 20, 'interior'], [950, 620, 10, 50, 'interior'], [960, 630, 120, 10, 'interior'],
  [1120, 630, 15, 20, 'exterior'], [1155, 630, 360, 20, 'exterior'], [1050, 640, 30, 10, 'exterior'],
  [1050, 650, 20, 45, 'exterior'], [20, 660, 320, 20, 'exterior'], [1050, 805, 20, 65, 'exterior'],
  [950, 850, 100, 20, 'exterior'], [1070, 850, 250, 20, 'exterior'], [1300, 870, 20, 105, 'exterior'],
  [340, 990, 20, 95, 'exterior'], [1300, 1155, 20, 125, 'exterior'], [910, 1260, 125, 20, 'exterior'],
  [1215, 1260, 85, 20, 'exterior'], [340, 1265, 20, 115, 'exterior'], [910, 1280, 20, 100, 'exterior'],
  [360, 1360, 80, 20, 'exterior'], [620, 1360, 290, 20, 'exterior'],
].map(([x, y, w, h, kind], i) => ({ id: 'w' + String(i + 1).padStart(2, '0'), x, y, w, h, kind }));

/**
 * Wall outline as drawn by the architect: thick line segments [x1, y1, x2, y2].
 * Use for crisp 2D rendering of wall edges (fill WALLS rects, stroke these).
 */
export const WALL_OUTLINE = [[0,0,0,220],[0,0,140,0],[0,220,20,220],[0,300,0,480],[0,300,20,300],[0,480,20,480],[0,560,0,680],[0,560,20,560],[0,680,340,680],[20,20,20,180],[20,20,140,20],[20,180,240,180],[20,190,20,220],[20,190,240,190],[20,300,20,480],[20,560,20,660],[20,660,340,660],[140,0,140,20],[220,0,220,20],[220,0,360,0],[220,20,340,20],[240,180,240,190],[330,180,330,190],[330,180,340,180],[330,190,340,190],[340,20,340,180],[340,190,340,490],[340,490,360,490],[340,580,340,660],[340,580,360,580],[340,680,340,710],[340,710,360,710],[340,990,340,1085],[340,990,360,990],[340,1085,360,1085],[340,1265,340,1380],[340,1265,360,1265],[340,1380,440,1380],[360,0,360,80],[360,80,455,80],[360,110,360,460],[360,110,455,110],[360,460,660,460],[360,480,360,490],[360,480,685,480],[360,580,360,590],[360,590,685,590],[360,610,360,710],[360,610,685,610],[360,990,360,1085],[360,1265,360,1360],[360,1360,440,1360],[440,1360,440,1380],[455,80,455,110],[555,80,555,110],[555,80,665,80],[555,110,660,110],[620,1360,620,1380],[620,1360,910,1360],[620,1380,930,1380],[660,110,660,365],[660,365,685,365],[660,445,660,460],[660,445,685,445],[665,0,665,80],[665,0,815,0],[685,20,685,320],[685,20,815,20],[685,320,905,320],[685,330,685,365],[685,330,915,330],[685,445,685,480],[685,590,685,610],[815,0,815,20],[895,0,895,20],[895,0,1005,0],[895,20,905,20],[905,20,905,220],[905,220,915,220],[905,310,905,320],[905,310,915,310],[910,1260,910,1360],[910,1260,1035,1260],[915,20,915,200],[915,20,1005,20],[915,200,1005,200],[915,210,915,220],[915,210,1005,210],[915,310,915,330],[930,1280,930,1380],[930,1280,1035,1280],[950,450,950,530],[950,450,960,450],[950,530,960,530],[950,620,950,670],[950,620,960,620],[950,670,960,670],[950,850,950,870],[950,850,1050,850],[950,870,1300,870],[960,450,960,500],[960,500,1145,500],[960,510,960,530],[960,510,1135,510],[960,620,960,630],[960,630,1080,630],[960,640,960,670],[960,640,1050,640],[1005,0,1005,20],[1005,200,1005,210],[1035,1260,1035,1280],[1050,640,1050,695],[1050,695,1070,695],[1050,805,1050,850],[1050,805,1070,805],[1070,650,1070,695],[1070,650,1080,650],[1070,805,1070,850],[1070,850,1320,850],[1080,630,1080,650],[1095,0,1095,20],[1095,0,1535,0],[1095,20,1145,20],[1095,200,1095,210],[1095,200,1145,200],[1095,210,1145,210],[1120,630,1120,650],[1120,630,1135,630],[1120,650,1535,650],[1135,510,1135,630],[1145,20,1145,200],[1145,210,1145,220],[1145,220,1155,220],[1145,310,1145,340],[1145,310,1155,310],[1145,340,1155,340],[1145,430,1145,500],[1145,430,1155,430],[1155,20,1155,220],[1155,20,1515,20],[1155,310,1155,320],[1155,320,1515,320],[1155,330,1155,340],[1155,330,1515,330],[1155,430,1155,630],[1155,630,1515,630],[1215,1260,1215,1280],[1215,1260,1300,1260],[1215,1280,1320,1280],[1300,870,1300,975],[1300,975,1320,975],[1300,1155,1300,1260],[1300,1155,1320,1155],[1320,850,1320,975],[1320,1155,1320,1280],[1515,20,1515,100],[1515,100,1535,100],[1515,240,1515,320],[1515,240,1535,240],[1515,330,1515,410],[1515,410,1535,410],[1515,550,1515,630],[1515,550,1535,550],[1535,0,1535,100],[1535,240,1535,410],[1535,550,1535,650]];

/**
 * OPENINGS — doors and windows. Each is a gap through a wall.
 *   x, y, w, h : plan rectangle of the gap (cm). For axis 'h' walls (running east-west) the opening
 *                width is `w` and wall thickness is `h`; for axis 'v' walls width is `h`, thickness `w`.
 *   width      : clear opening width along the wall (cm)
 *   height     : opening height (cm)
 *   sill       : height of the bottom of the opening above finished floor (cm) — 0 for doors
 *   axis       : 'h' | 'v' — direction the wall runs
 *   kind       : 'window' | 'door' | 'sliding-door'
 *   style      : window: 'sliding' | 'tilt' | 'mamad' ; door: 'entry' | 'interior' | 'service' | 'mamad' | 'glass-sliding'
 *   exterior   : true if the opening is in the building envelope
 *   outside    : for exterior openings, the side that is outdoors: 'n' | 's' | 'e' | 'w'
 *   hinge      : doors only — which jamb carries the hinges: 'n'|'s' for axis 'v' walls, 'e'|'w' for axis 'h' walls
 *   swing      : doors only — the side the leaf opens INTO: 'n'|'s'|'e'|'w'
 *   rooms      : [roomIdA, roomIdB] the two spaces it connects ('outside' allowed)
 *   label      : dimension text as written on the drawing
 *   assumed    : list of fields that are NOT on the drawing (see ASSUMPTIONS)
 */
export const OPENINGS = [
  // ---- Windows (width / height (+sill) exactly as annotated on the drawing) ----
  { id: 'win-parents-bath', kind: 'window', style: 'tilt',    axis: 'h', x: 140,  y: 0,    w: 80,  h: 20, width: 80,  height: 70,  sill: 140, exterior: true, outside: 'n', rooms: ['parents-bath', 'outside'], label: '80 / 70(+140)' },
  { id: 'win-mamad',        kind: 'window', style: 'mamad',   axis: 'h', x: 455,  y: 80,   w: 100, h: 30, width: 100, height: 100, sill: 110, exterior: true, outside: 'n', rooms: ['mamad', 'outside'], label: '100 / 100(+110)' },
  { id: 'win-bath',         kind: 'window', style: 'tilt',    axis: 'h', x: 815,  y: 0,    w: 80,  h: 20, width: 80,  height: 70,  sill: 140, exterior: true, outside: 'n', rooms: ['bath', 'outside'], label: '80 / 70(+140)' },
  { id: 'win-parents-1',    kind: 'window', style: 'sliding', axis: 'v', x: 0,    y: 220,  w: 20,  h: 80, width: 80,  height: 120, sill: 90,  exterior: true, outside: 'w', rooms: ['parents-bedroom', 'outside'], label: '80 / 120(+90)' },
  { id: 'win-parents-2',    kind: 'window', style: 'sliding', axis: 'v', x: 0,    y: 480,  w: 20,  h: 80, width: 80,  height: 120, sill: 90,  exterior: true, outside: 'w', rooms: ['parents-bedroom', 'outside'], label: '80 / 120(+90)' },
  { id: 'win-kitchen-w',    kind: 'window', style: 'sliding', axis: 'v', x: 340,  y: 1085, w: 20,  h: 180, width: 180, height: 100, sill: 110, exterior: true, outside: 'w', rooms: ['main', 'terrace'], label: '180 / 100(+110)' },
  { id: 'win-kitchen-s',    kind: 'window', style: 'sliding', axis: 'h', x: 440,  y: 1360, w: 180, h: 20, width: 180, height: 100, sill: 110, exterior: true, outside: 's', rooms: ['main', 'outside'], label: '180 / 100(+110)' },
  { id: 'win-living-s',     kind: 'window', style: 'sliding', axis: 'h', x: 1035, y: 1260, w: 180, h: 20, width: 180, height: 120, sill: 90,  exterior: true, outside: 's', rooms: ['main', 'outside'], label: '180 / 120(+90)' },
  { id: 'win-living-e',     kind: 'window', style: 'sliding', axis: 'v', x: 1300, y: 975,  w: 20,  h: 180, width: 180, height: 120, sill: 90,  exterior: true, outside: 'e', rooms: ['main', 'outside'], label: '180 / 120(+90)' },
  { id: 'win-bedroom-1',    kind: 'window', style: 'sliding', axis: 'v', x: 1515, y: 100,  w: 20,  h: 140, width: 140, height: 100, sill: 110, exterior: true, outside: 'e', rooms: ['bedroom-1', 'outside'], label: '140 / 100(+110)' },
  { id: 'win-bedroom-2',    kind: 'window', style: 'sliding', axis: 'v', x: 1515, y: 410,  w: 20,  h: 140, width: 140, height: 100, sill: 110, exterior: true, outside: 'e', rooms: ['bedroom-2', 'outside'], label: '140 / 100(+110)' },
  { id: 'win-wc',           kind: 'window', style: 'tilt',    axis: 'h', x: 1080, y: 630,  w: 40,  h: 20, width: 40,  height: 60,  sill: 150, exterior: true, outside: 's', rooms: ['wc', 'entry-porch'], label: '40 (height not written)', assumed: ['height', 'sill'] },

  // ---- Doors ----
  { id: 'door-entry',        kind: 'door', style: 'entry',    axis: 'v', x: 1050, y: 695, w: 20, h: 110, width: 110, height: 210, sill: 0, exterior: true, outside: 'e', hinge: 'n', swing: 'w', rooms: ['main', 'entry-porch'], label: '110 / 210' },
  { id: 'door-service-ext',  kind: 'door', style: 'service',  axis: 'h', x: 1005, y: 0,   w: 90, h: 20,  width: 90,  height: 210, sill: 0, exterior: true, outside: 'n', hinge: 'e', swing: 'n', rooms: ['service', 'utility-yard'], label: '90 / 210' },
  { id: 'door-terrace',      kind: 'sliding-door', style: 'glass-sliding', axis: 'v', x: 340, y: 710, w: 20, h: 280, width: 280, height: 210, sill: 0, exterior: true, outside: 'w', rooms: ['main', 'terrace'], label: '280 / 210' },
  { id: 'door-parents',      kind: 'door', style: 'interior', axis: 'v', x: 340,  y: 490, w: 20, h: 90,  width: 90,  height: 210, sill: 0, hinge: 's', swing: 'w', rooms: ['main', 'parents-bedroom'], assumed: ['height'] },
  { id: 'door-parents-bath', kind: 'door', style: 'interior', axis: 'h', x: 240,  y: 180, w: 90, h: 10,  width: 90,  height: 210, sill: 0, hinge: 'e', swing: 'n', rooms: ['parents-bedroom', 'parents-bath'], assumed: ['height'] },
  { id: 'door-mamad',        kind: 'door', style: 'mamad',    axis: 'v', x: 660,  y: 365, w: 25, h: 80,  width: 80,  height: 200, sill: 0, hinge: 'n', swing: 'e', rooms: ['main', 'mamad'], assumed: ['height'] },
  { id: 'door-bath',         kind: 'door', style: 'interior', axis: 'v', x: 905,  y: 220, w: 10, h: 90,  width: 90,  height: 210, sill: 0, hinge: 's', swing: 'w', rooms: ['main', 'bath'], assumed: ['height'] },
  { id: 'door-service',      kind: 'door', style: 'interior', axis: 'h', x: 1005, y: 200, w: 90, h: 10,  width: 90,  height: 210, sill: 0, hinge: 'e', swing: 'n', rooms: ['main', 'service'], assumed: ['height'] },
  { id: 'door-bedroom-1',    kind: 'door', style: 'interior', axis: 'v', x: 1145, y: 220, w: 10, h: 90,  width: 90,  height: 210, sill: 0, hinge: 's', swing: 'e', rooms: ['main', 'bedroom-1'], assumed: ['height'] },
  { id: 'door-bedroom-2',    kind: 'door', style: 'interior', axis: 'v', x: 1145, y: 340, w: 10, h: 90,  width: 90,  height: 210, sill: 0, hinge: 'n', swing: 'e', rooms: ['main', 'bedroom-2'], assumed: ['height'] },
  { id: 'door-wc',           kind: 'door', style: 'interior', axis: 'v', x: 950,  y: 530, w: 10, h: 90,  width: 90,  height: 210, sill: 0, hinge: 's', swing: 'e', rooms: ['main', 'wc'], assumed: ['height'] },
];

/**
 * ROOMS — clear interior floor polygons (inside faces of walls), clockwise, cm.
 * `type` drives default finishes and regulation checks.
 * `wet` rooms get tiled walls by default.
 */
export const ROOMS = [
  { id: 'parents-bedroom', name: 'Master Bedroom', nameHe: 'ח. הורים', type: 'bedroom', drawnArea: 15,
    polygon: [[20, 190], [340, 190], [340, 660], [20, 660]], label: [180, 400] },
  { id: 'parents-bath', name: 'Master Bathroom', nameHe: 'ח. רחצה הורים', type: 'bathroom', wet: true, drawnArea: 5,
    polygon: [[20, 20], [340, 20], [340, 180], [20, 180]], label: [200, 120] },
  { id: 'mamad', name: 'Safe Room (Mamad)', nameHe: 'ממ"ד', type: 'mamad', drawnArea: 10.5,
    polygon: [[360, 110], [660, 110], [660, 460], [360, 460]], label: [510, 330] },
  { id: 'bath', name: 'Bathroom', nameHe: 'ח. רחצה', type: 'bathroom', wet: true, drawnArea: 6.5,
    polygon: [[685, 20], [905, 20], [905, 320], [685, 320]], label: [810, 230] },
  { id: 'service', name: 'Laundry / Service Room', nameHe: 'ח. שירות', type: 'service', wet: true, drawnArea: 4,
    polygon: [[915, 20], [1145, 20], [1145, 200], [915, 200]], label: [1040, 110] },
  { id: 'bedroom-1', name: 'Bedroom 1', nameHe: 'ח. שינה', type: 'bedroom', drawnArea: 10.8,
    polygon: [[1155, 20], [1515, 20], [1515, 320], [1155, 320]], label: [1335, 185] },
  { id: 'bedroom-2', name: 'Bedroom 2', nameHe: 'ח. שינה', type: 'bedroom', drawnArea: 10.8,
    polygon: [[1155, 330], [1515, 330], [1515, 630], [1155, 630]], label: [1335, 470] },
  { id: 'wc', name: 'Guest WC', nameHe: 'שירותי אורחים', type: 'wc', wet: true,
    polygon: [[960, 510], [1135, 510], [1135, 630], [960, 630]], label: [1045, 590] },
  { id: 'main', name: 'Living · Dining · Kitchen', nameHe: 'סלון · פינת אוכל · מטבח', type: 'living',
    // One continuous open space: bedroom corridor + central hall + foyer + dining + kitchen + living.
    polygon: [
      [360, 480], [685, 480], [685, 330], [915, 330], [915, 210], [1145, 210], [1145, 500], [960, 500],
      [960, 450], [950, 450], [950, 670], [960, 670], [960, 640], [1050, 640], [1050, 850], [950, 850],
      [950, 870], [1300, 870], [1300, 1260], [910, 1260], [910, 1360], [360, 1360], [360, 610], [685, 610],
      [685, 590], [360, 590],
    ],
    label: [780, 960],
    // Named zones inside the open space (labels only — not separate rooms).
    zones: [
      { id: 'corridor', name: 'Corridor', label: [520, 535] },
      { id: 'hall', name: 'Hall', label: [1030, 330] },
      { id: 'foyer', name: 'Entry', label: [1000, 760] },
      { id: 'dining', name: 'Dining', label: [640, 800] },
      { id: 'kitchen', name: 'Kitchen', label: [640, 1240] },
      { id: 'living', name: 'Living Room', label: [1125, 1060] },
    ] },
];

/** Paved / covered outdoor areas that belong to the house (thin lines on the drawing). */
export const OUTDOOR_AREAS = [
  { id: 'terrace', name: 'Terrace', nameHe: 'מרפסת', type: 'terrace', drawnArea: 24,
    polygon: [[0, 680], [340, 680], [340, 1380], [0, 1380]], label: [170, 1030] },
  { id: 'entry-porch', name: 'Entrance Porch', nameHe: 'מרפסת כניסה', type: 'porch', drawnArea: 9,
    polygon: [[1070, 650], [1535, 650], [1535, 850], [1070, 850]], label: [1300, 750] },
  { id: 'utility-yard', name: 'Utility Yard', nameHe: 'ח. משק', type: 'utility', drawnArea: 7,
    polygon: [[795, -200], [1145, -200], [1145, 0], [795, 0]], label: [970, -100] },
];

/**
 * SITE — the lot. Same coordinate system as the house (origin = house NW corner), cm.
 * The lot is ~25.0 m (east-west) × ~20.0 m (north-south) ≈ 500 m², very slightly skewed
 * exactly as surveyed (corner points G29/G32/…31 on the drawing).
 */
export const SITE = {
  // Property line (blue on the drawing), clockwise from the NW corner.
  boundary: [[-661, -308], [1839, -310], [1877, 1692], [-623, 1692]],
  // Building line / setback limit (red dash-dot on the drawing). The house must stay inside.
  buildingLine: [[-255, -10], [1548, -10], [1572, 1390], [-232, 1390]],
  // Two parking bays, 2.50 × 5.00 m each, in the SE corner, entered from the east street.
  parking: [
    { id: 'parking-1', x: 1377, y: 1192, w: 500, h: 250, name: 'Parking 1' },
    { id: 'parking-2', x: 1377, y: 1442, w: 500, h: 250, name: 'Parking 2' },
  ],
  // Paved access path (grey on the drawing) from the parking / street to the entrance porch.
  paths: [
    { id: 'entry-path', name: 'Entry path', polygon: [[1415, 850], [1535, 850], [1535, 1070], [1877, 1070], [1877, 1192], [1415, 1192]] },
  ],
  // The public street runs along the EAST boundary.
  street: { side: 'e' },
  bounds: { x: -661, y: -310, w: 2538, h: 2002 },
};

/**
 * Items drawn by the architect that are part of the building fit-out or the proposed furniture layout
 * live in src/core/initial-layout.js (they are ordinary, movable items).
 */

/** Things the drawing does not state. Shown to the user; all editable in Settings. */
export const ASSUMPTIONS = [
  { id: 'ceiling', status: 'confirmed', text: 'Ceiling height 3.00 m — confirmed by owner (not on drawing).' },
  { id: 'roof', status: 'confirmed', text: 'Flat roof — confirmed by owner (not on drawing).' },
  { id: 'interior-door-height', status: 'assumed', text: 'Interior door height 2.10 m (drawing gives 210 only for exterior doors).' },
  { id: 'mamad-door', status: 'assumed', text: 'Mamad blast door 80 × 200 cm, opening outwards (standard Home Front Command door).' },
  { id: 'wc-window', status: 'assumed', text: 'Guest-WC window: 40 cm wide as drawn; height 60 cm and sill 150 cm assumed (not written).' },
  { id: 'roof-build', status: 'assumed', text: 'Roof slab 20 cm with 40 cm parapet; floor 15 cm above garden level.' },
  { id: 'window-style', status: 'assumed', text: 'Window opening styles (sliding / tilt) follow the drawing symbols; frame colour assumed.' },
];

export const PLAN = {
  meta: META,
  heights: HEIGHTS,
  bounds: HOUSE_BOUNDS,
  walls: WALLS,
  wallOutline: WALL_OUTLINE,
  openings: OPENINGS,
  rooms: ROOMS,
  outdoorAreas: OUTDOOR_AREAS,
  site: SITE,
  assumptions: ASSUMPTIONS,
};

export default PLAN;
