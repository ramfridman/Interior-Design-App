/**
 * HOUSE PLAN — single source of truth for the building and the lot.
 *
 * Source: architect drawings of house model "E7" by Ohad Abutbul Architecture, scale 1:100:
 *   (a) the site plan for approval of LOT 98, Kibbutz Afikim, dated 10.11.26 — the owner's actual house.
 *       Walls, lot boundary, building line, parking and paths below are measured from this vector PDF.
 *   (b) the E7 dimension drawing dated 8.11.26 (drawn for the mirror-twin lot 99). Lot 98 is its exact
 *       NORTH–SOUTH MIRROR; every written dimension (wall chains, opening width / height / sill, room
 *       sizes) comes from that sheet and was cross-checked against (a): 160 of 166 wall edges coincide
 *       exactly after mirroring; the only difference is the living-room north window, which sits 5 cm
 *       further east on the lot-98 sheet (x 1040–1220) — the lot-98 sheet wins.
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
  name: 'House 98 — Kibbutz Afikim',
  lot: 98,
  model: 'E7',
  location: 'Kibbutz Afikim, Jordan Valley, Israel',
  neighbourhood: 'Gan Bayit',
  // The dimension sheet (8.11.26) was drawn for the mirror-twin lot; this plan is its north–south mirror.
  mirroredFromDimensionSheet: true,
  architect: 'Ohad Abutbul Architecture',
  drawingDate: '2026-11-10',
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
  [340, 0, 100, 20, 'exterior'], [620, 0, 310, 20, 'exterior'], [340, 20, 20, 95, 'exterior'],
  [910, 20, 20, 100, 'exterior'], [930, 100, 110, 20, 'exterior'], [1220, 100, 100, 20, 'exterior'],
  [1300, 120, 20, 105, 'exterior'], [340, 295, 20, 95, 'exterior'], [1300, 405, 20, 125, 'exterior'],
  [950, 510, 350, 20, 'exterior'], [1050, 530, 20, 45, 'exterior'], [340, 670, 20, 130, 'exterior'],
  [1050, 685, 20, 65, 'exterior'], [0, 700, 340, 20, 'exterior'], [950, 710, 10, 50, 'interior'],
  [0, 720, 20, 100, 'exterior'], [1070, 730, 10, 20, 'interior'], [1120, 730, 415, 20, 'exterior'],
  [960, 740, 90, 10, 'interior'], [1135, 750, 20, 130, 'interior'], [1515, 750, 20, 80, 'exterior'],
  [360, 770, 325, 20, 'interior'], [950, 850, 10, 80, 'interior'], [960, 870, 175, 10, 'interior'],
  [1145, 880, 10, 70, 'interior'], [340, 890, 20, 490, 'interior'], [0, 900, 20, 180, 'exterior'],
  [360, 900, 325, 20, 'mamad'], [660, 920, 25, 15, 'mamad'], [1515, 970, 20, 170, 'exterior'],
  [660, 1015, 25, 285, 'mamad'], [1145, 1040, 10, 30, 'interior'], [685, 1050, 230, 10, 'interior'],
  [1155, 1050, 360, 10, 'interior'], [905, 1060, 10, 10, 'interior'], [0, 1160, 20, 220, 'exterior'],
  [905, 1160, 10, 220, 'interior'], [1145, 1160, 10, 220, 'interior'], [915, 1170, 90, 10, 'interior'],
  [1095, 1170, 50, 10, 'interior'], [20, 1190, 220, 10, 'interior'], [330, 1190, 10, 10, 'interior'],
  [360, 1270, 95, 30, 'mamad'], [555, 1270, 105, 30, 'mamad'], [1515, 1280, 20, 100, 'exterior'],
  [665, 1300, 20, 80, 'mamad'], [20, 1360, 120, 20, 'exterior'], [220, 1360, 120, 20, 'exterior'],
  [685, 1360, 130, 20, 'exterior'], [895, 1360, 10, 20, 'exterior'], [915, 1360, 90, 20, 'exterior'],
  [1095, 1360, 50, 20, 'exterior'], [1155, 1360, 360, 20, 'exterior'],
].map(([x, y, w, h, kind], i) => ({ id: 'w' + String(i + 1).padStart(2, '0'), x, y, w, h, kind }));

/**
 * Wall outline as drawn by the architect: thick line segments [x1, y1, x2, y2].
 * Use for crisp 2D rendering of wall edges (fill WALLS rects, stroke these).
 */
export const WALL_OUTLINE = [[0,700,0,820],[0,700,340,700],[0,820,20,820],[0,900,0,1080],[0,900,20,900],[0,1080,20,1080],[0,1160,0,1380],[0,1160,20,1160],[0,1380,140,1380],[20,720,20,820],[20,720,340,720],[20,900,20,1080],[20,1160,20,1190],[20,1190,240,1190],[20,1200,20,1360],[20,1200,240,1200],[20,1360,140,1360],[140,1360,140,1380],[220,1360,220,1380],[220,1360,340,1360],[220,1380,360,1380],[240,1190,240,1200],[330,1190,330,1200],[330,1190,340,1190],[330,1200,340,1200],[340,0,340,115],[340,0,440,0],[340,115,360,115],[340,295,340,390],[340,295,360,295],[340,390,360,390],[340,670,340,700],[340,670,360,670],[340,720,340,800],[340,800,360,800],[340,890,340,1190],[340,890,360,890],[340,1200,340,1360],[360,20,360,115],[360,20,440,20],[360,295,360,390],[360,670,360,770],[360,770,685,770],[360,790,360,800],[360,790,685,790],[360,890,360,900],[360,900,685,900],[360,920,360,1270],[360,920,660,920],[360,1270,455,1270],[360,1300,360,1380],[360,1300,455,1300],[440,0,440,20],[455,1270,455,1300],[555,1270,555,1300],[555,1270,660,1270],[555,1300,665,1300],[620,0,620,20],[620,0,930,0],[620,20,910,20],[660,920,660,935],[660,935,685,935],[660,1015,660,1270],[660,1015,685,1015],[665,1300,665,1380],[665,1380,815,1380],[685,770,685,790],[685,900,685,935],[685,1015,685,1050],[685,1050,915,1050],[685,1060,685,1360],[685,1060,905,1060],[685,1360,815,1360],[815,1360,815,1380],[895,1360,895,1380],[895,1360,905,1360],[895,1380,1005,1380],[905,1060,905,1070],[905,1070,915,1070],[905,1160,905,1360],[905,1160,915,1160],[910,20,910,120],[910,120,1040,120],[915,1050,915,1070],[915,1160,915,1170],[915,1170,1005,1170],[915,1180,915,1360],[915,1180,1005,1180],[915,1360,1005,1360],[930,0,930,100],[930,100,1040,100],[950,510,950,530],[950,510,1300,510],[950,530,1050,530],[950,710,950,760],[950,710,960,710],[950,760,960,760],[950,850,950,930],[950,850,960,850],[950,930,960,930],[960,710,960,740],[960,740,1050,740],[960,750,960,760],[960,750,1080,750],[960,850,960,870],[960,870,1135,870],[960,880,960,930],[960,880,1145,880],[1005,1170,1005,1180],[1005,1360,1005,1380],[1040,100,1040,120],[1050,530,1050,575],[1050,575,1070,575],[1050,685,1050,740],[1050,685,1070,685],[1070,530,1070,575],[1070,530,1320,530],[1070,685,1070,730],[1070,730,1080,730],[1080,730,1080,750],[1095,1170,1095,1180],[1095,1170,1145,1170],[1095,1180,1145,1180],[1095,1360,1095,1380],[1095,1360,1145,1360],[1095,1380,1535,1380],[1120,730,1120,750],[1120,730,1535,730],[1120,750,1135,750],[1135,750,1135,870],[1145,880,1145,950],[1145,950,1155,950],[1145,1040,1145,1070],[1145,1040,1155,1040],[1145,1070,1155,1070],[1145,1160,1145,1170],[1145,1160,1155,1160],[1145,1180,1145,1360],[1155,750,1155,950],[1155,750,1515,750],[1155,1040,1155,1050],[1155,1050,1515,1050],[1155,1060,1155,1070],[1155,1060,1515,1060],[1155,1160,1155,1360],[1155,1360,1515,1360],[1220,100,1220,120],[1220,100,1320,100],[1220,120,1300,120],[1300,120,1300,225],[1300,225,1320,225],[1300,405,1300,510],[1300,405,1320,405],[1320,100,1320,225],[1320,405,1320,530],[1515,750,1515,830],[1515,830,1535,830],[1515,970,1515,1050],[1515,970,1535,970],[1515,1060,1515,1140],[1515,1140,1535,1140],[1515,1280,1515,1360],[1515,1280,1535,1280],[1535,730,1535,830],[1535,970,1535,1140],[1535,1280,1535,1380]];

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
  // ---- Windows (width / height (+sill) exactly as annotated on the dimension drawing) ----
  { id: 'win-parents-bath', kind: 'window', style: 'tilt', axis: 'h', x: 140, y: 1360, w: 80, h: 20, width: 80, height: 70, sill: 140, exterior: true, outside: 's', rooms: ['parents-bath', 'outside'], label: '80 / 70(+140)' },
  { id: 'win-mamad', kind: 'window', style: 'mamad', axis: 'h', x: 455, y: 1270, w: 100, h: 30, width: 100, height: 100, sill: 110, exterior: true, outside: 's', rooms: ['mamad', 'outside'], label: '100 / 100(+110)' },
  { id: 'win-bath', kind: 'window', style: 'tilt', axis: 'h', x: 815, y: 1360, w: 80, h: 20, width: 80, height: 70, sill: 140, exterior: true, outside: 's', rooms: ['bath', 'outside'], label: '80 / 70(+140)' },
  { id: 'win-parents-1', kind: 'window', style: 'sliding', axis: 'v', x: 0, y: 1080, w: 20, h: 80, width: 80, height: 120, sill: 90, exterior: true, outside: 'w', rooms: ['parents-bedroom', 'outside'], label: '80 / 120(+90)' },
  { id: 'win-parents-2', kind: 'window', style: 'sliding', axis: 'v', x: 0, y: 820, w: 20, h: 80, width: 80, height: 120, sill: 90, exterior: true, outside: 'w', rooms: ['parents-bedroom', 'outside'], label: '80 / 120(+90)' },
  { id: 'win-kitchen-w', kind: 'window', style: 'sliding', axis: 'v', x: 340, y: 115, w: 20, h: 180, width: 180, height: 100, sill: 110, exterior: true, outside: 'w', rooms: ['main', 'terrace'], label: '180 / 100(+110)' },
  { id: 'win-kitchen-n', kind: 'window', style: 'sliding', axis: 'h', x: 440, y: 0, w: 180, h: 20, width: 180, height: 100, sill: 110, exterior: true, outside: 'n', rooms: ['main', 'outside'], label: '180 / 100(+110)' },
  { id: 'win-living-n', kind: 'window', style: 'sliding', axis: 'h', x: 1040, y: 100, w: 180, h: 20, width: 180, height: 120, sill: 90, exterior: true, outside: 'n', rooms: ['main', 'outside'], label: '180 / 120(+90)' },
  { id: 'win-living-e', kind: 'window', style: 'sliding', axis: 'v', x: 1300, y: 225, w: 20, h: 180, width: 180, height: 120, sill: 90, exterior: true, outside: 'e', rooms: ['main', 'outside'], label: '180 / 120(+90)' },
  { id: 'win-bedroom-1', kind: 'window', style: 'sliding', axis: 'v', x: 1515, y: 1140, w: 20, h: 140, width: 140, height: 100, sill: 110, exterior: true, outside: 'e', rooms: ['bedroom-1', 'outside'], label: '140 / 100(+110)' },
  { id: 'win-bedroom-2', kind: 'window', style: 'sliding', axis: 'v', x: 1515, y: 830, w: 20, h: 140, width: 140, height: 100, sill: 110, exterior: true, outside: 'e', rooms: ['bedroom-2', 'outside'], label: '140 / 100(+110)' },
  { id: 'win-wc', kind: 'window', style: 'tilt', axis: 'h', x: 1080, y: 730, w: 40, h: 20, width: 40, height: 60, sill: 150, exterior: true, outside: 'n', rooms: ['wc', 'entry-porch'], label: '40 (height not written)', assumed: ['height', 'sill'] },

  // ---- Doors ----
  { id: 'door-entry', kind: 'door', style: 'entry', axis: 'v', x: 1050, y: 575, w: 20, h: 110, width: 110, height: 210, sill: 0, exterior: true, outside: 'e', hinge: 's', swing: 'w', rooms: ['main', 'entry-porch'], label: '110 / 210' },
  { id: 'door-service-ext', kind: 'door', style: 'service', axis: 'h', x: 1005, y: 1360, w: 90, h: 20, width: 90, height: 210, sill: 0, exterior: true, outside: 's', hinge: 'e', swing: 's', rooms: ['service', 'utility-yard'], label: '90 / 210' },
  { id: 'door-terrace', kind: 'sliding-door', style: 'glass-sliding', axis: 'v', x: 340, y: 390, w: 20, h: 280, width: 280, height: 210, sill: 0, exterior: true, outside: 'w', rooms: ['main', 'terrace'], label: '280 / 210' },
  { id: 'door-parents', kind: 'door', style: 'interior', axis: 'v', x: 340, y: 800, w: 20, h: 90, width: 90, height: 210, sill: 0, hinge: 'n', swing: 'w', rooms: ['main', 'parents-bedroom'], assumed: ['height'] },
  { id: 'door-parents-bath', kind: 'door', style: 'interior', axis: 'h', x: 240, y: 1190, w: 90, h: 10, width: 90, height: 210, sill: 0, hinge: 'e', swing: 's', rooms: ['parents-bedroom', 'parents-bath'], assumed: ['height'] },
  { id: 'door-mamad', kind: 'door', style: 'mamad', axis: 'v', x: 660, y: 935, w: 25, h: 80, width: 80, height: 200, sill: 0, hinge: 's', swing: 'e', rooms: ['main', 'mamad'], assumed: ['height'] },
  { id: 'door-bath', kind: 'door', style: 'interior', axis: 'v', x: 905, y: 1070, w: 10, h: 90, width: 90, height: 210, sill: 0, hinge: 'n', swing: 'w', rooms: ['main', 'bath'], assumed: ['height'] },
  { id: 'door-service', kind: 'door', style: 'interior', axis: 'h', x: 1005, y: 1170, w: 90, h: 10, width: 90, height: 210, sill: 0, hinge: 'e', swing: 's', rooms: ['main', 'service'], assumed: ['height'] },
  { id: 'door-bedroom-1', kind: 'door', style: 'interior', axis: 'v', x: 1145, y: 1070, w: 10, h: 90, width: 90, height: 210, sill: 0, hinge: 'n', swing: 'e', rooms: ['main', 'bedroom-1'], assumed: ['height'] },
  { id: 'door-bedroom-2', kind: 'door', style: 'interior', axis: 'v', x: 1145, y: 950, w: 10, h: 90, width: 90, height: 210, sill: 0, hinge: 's', swing: 'e', rooms: ['main', 'bedroom-2'], assumed: ['height'] },
  { id: 'door-wc', kind: 'door', style: 'interior', axis: 'v', x: 950, y: 760, w: 10, h: 90, width: 90, height: 210, sill: 0, hinge: 'n', swing: 'e', rooms: ['main', 'wc'], assumed: ['height'] },
];

/**
 * ROOMS — clear interior floor polygons (inside faces of walls), clockwise, cm.
 * `type` drives default finishes and regulation checks.
 * `wet` rooms get tiled walls by default.
 */
export const ROOMS = [
  { id: 'parents-bedroom', name: 'Master Bedroom', nameHe: 'ח. הורים', type: 'bedroom', drawnArea: 15,
    polygon: [[20, 720], [340, 720], [340, 1190], [20, 1190]], label: [180, 980] },
  { id: 'parents-bath', name: 'Master Bathroom', nameHe: 'ח. רחצה הורים', type: 'bathroom', wet: true, drawnArea: 5,
    polygon: [[20, 1200], [340, 1200], [340, 1360], [20, 1360]], label: [200, 1260] },
  { id: 'mamad', name: 'Safe Room (Mamad)', nameHe: 'ממ"ד', type: 'mamad', drawnArea: 10.5,
    polygon: [[360, 920], [660, 920], [660, 1270], [360, 1270]], label: [510, 1050] },
  { id: 'bath', name: 'Bathroom', nameHe: 'ח. רחצה', type: 'bathroom', wet: true, drawnArea: 6.5,
    polygon: [[685, 1060], [905, 1060], [905, 1360], [685, 1360]], label: [810, 1150] },
  { id: 'service', name: 'Laundry / Service Room', nameHe: 'ח. שירות', type: 'service', wet: true, drawnArea: 4,
    polygon: [[915, 1180], [1145, 1180], [1145, 1360], [915, 1360]], label: [1040, 1270] },
  { id: 'bedroom-1', name: 'Bedroom 1', nameHe: 'ח. שינה', type: 'bedroom', drawnArea: 10.8,
    polygon: [[1155, 1060], [1515, 1060], [1515, 1360], [1155, 1360]], label: [1335, 1195] },
  { id: 'bedroom-2', name: 'Bedroom 2', nameHe: 'ח. שינה', type: 'bedroom', drawnArea: 10.8,
    polygon: [[1155, 750], [1515, 750], [1515, 1050], [1155, 1050]], label: [1335, 910] },
  { id: 'wc', name: 'Guest WC', nameHe: 'שירותי אורחים', type: 'wc', wet: true,
    polygon: [[960, 750], [1135, 750], [1135, 870], [960, 870]], label: [1045, 790] },
  { id: 'main', name: 'Living · Dining · Kitchen', nameHe: 'סלון · פינת אוכל · מטבח', type: 'living',
    polygon: [[360, 790], [685, 790], [685, 770], [360, 770], [360, 20], [910, 20], [910, 120], [1300, 120], [1300, 510], [950, 510], [950, 530], [1050, 530], [1050, 740], [960, 740], [960, 710], [950, 710], [950, 930], [960, 930], [960, 880], [1145, 880], [1145, 1170], [915, 1170], [915, 1050], [685, 1050], [685, 900], [360, 900]], label: [780, 420],
    // Named zones inside the open space (labels only — not separate rooms).
    zones: [
      { id: 'corridor', name: 'Corridor', label: [520, 845] },
      { id: 'hall', name: 'Hall', label: [1030, 1050] },
      { id: 'foyer', name: 'Entry', label: [1000, 620] },
      { id: 'dining', name: 'Dining', label: [640, 580] },
      { id: 'kitchen', name: 'Kitchen', label: [640, 140] },
      { id: 'living', name: 'Living Room', label: [1125, 320] },
    ] },
];

/** Paved / covered outdoor areas that belong to the house (thin lines on the drawing). */
export const OUTDOOR_AREAS = [
  { id: 'terrace', name: 'Terrace', nameHe: 'מרפסת', type: 'terrace', drawnArea: 24,
    polygon: [[0, 0], [340, 0], [340, 700], [0, 700]], label: [170, 350] },
  { id: 'entry-porch', name: 'Entrance Porch', nameHe: 'מרפסת כניסה', type: 'porch', drawnArea: 9,
    polygon: [[1070, 530], [1535, 530], [1535, 730], [1070, 730]], label: [1300, 630] },
  { id: 'utility-yard', name: 'Utility Yard', nameHe: 'ח. משק', type: 'utility', drawnArea: 7,
    polygon: [[795, 1380], [1145, 1380], [1145, 1580], [795, 1580]], label: [970, 1480] },
];

/**
 * SITE — the lot. Same coordinate system as the house (origin = house NW corner), cm.
 * Lot 98 is 25.00 m (east-west) × 20.00 m (north-south) ≈ 500 m², very slightly skewed exactly as surveyed.
 */
export const SITE = {
  lot: 98,
  // Property line (blue on the drawing, survey points G27 → G28 → G29 → G30), clockwise from the NW corner.
  // Written side lengths: north 25.00 m, south 25.00 m, west 20.00 m, east 19.97 m.
  boundary: [[-635, -310], [1865, -307], [1901, 1690], [-600, 1690]],
  // Building line / setback limit (red dash-dot): 4.00 m from the west boundary, 3.00 m from north, east and south.
  buildingLine: [[-230, -10], [1570, -10], [1595, 1390], [-205, 1390]],
  setbacks: { w: 400, n: 300, e: 300, s: 300 },
  // Two parking bays, 2.50 × 5.00 m each, in the NE corner, entered from the east street.
  parking: [
    { id: 'parking-1', x: 1365, y: -307, w: 500, h: 250, name: 'Parking 1' },
    { id: 'parking-2', x: 1365, y: -57, w: 500, h: 250, name: 'Parking 2' },
  ],
  // Paved access path (grey on the drawing) from the parking / street to the entrance porch.
  paths: [
    { id: 'entry-path', name: 'Entry path', polygon: [[1415, 193], [1865, 193], [1865, 315], [1535, 315], [1535, 530], [1415, 530]] },
  ],
  // Survey features inside the lot worth keeping clear when planting / paving.
  features: [
    { id: 'water-connection', kind: 'water', x: 1790, y: 386, name: 'Water connection (per survey)' },
  ],
  // The public street (concrete pavement) runs along the EAST boundary.
  street: { side: 'e' },
  bounds: { x: -635, y: -310, w: 2536, h: 2000 },
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
