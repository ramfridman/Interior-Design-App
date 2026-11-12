/**
 * The furniture & fit-out layout drawn by the architect for house E7 on lot 98, as ordinary editable items.
 * Positions and sizes were measured from the drawing (dimension sheet, mirrored north–south for lot 98). These are GENERIC pieces (no product, no price) —
 * the user swaps each for a real catalogue product. Coordinates: plan space, cm (see core/plan.js).
 *
 * Facing = the direction the item's FRONT points:  's' rot 0 · 'w' rot 90 · 'n' rot 180 · 'e' rot 270.
 */
const ROT = { s: 0, w: 90, n: 180, e: 270 };

/** rect = [x0, y0, x1, y1] footprint on the plan; facing as above. */
function at(type, name, [x0, y0, x1, y1], facing, h, params = {}, extra = {}) {
  const alongX = x1 - x0, alongY = y1 - y0;
  const sideways = facing === 'e' || facing === 'w';
  return {
    type, name, params, h,
    x: (x0 + x1) / 2, y: (y0 + y1) / 2,
    w: sideways ? alongY : alongX, d: sideways ? alongX : alongY,
    rot: ROT[facing], generic: true, price: null, url: null, retailer: null, productId: null,
    zone: 'indoor', placement: 'floor', elev: 0, ...extra,
  };
}

const WHITE = '#f3f1ec', OAK = '#c8a476', LINEN = '#d9d2c5', STONE = '#e7e4de', GRAPHITE = '#3a3d42';

export function initialLayout() {
  return [
    // ── Master bathroom ──
    at('shower', 'Walk-in shower', [20, 1200, 115, 1360], 'e', 200, { variant: 'walk-in', glass: 'clear', frame: 'black', head: 'rain' }, { fixture: true }),
    at('toilet', 'Toilet', [161, 1305, 199, 1360], 'n', 42, { variant: 'wall-hung' }, { fixture: true }),
    at('vanity', 'Vanity 100', [240, 1310, 340, 1360], 'n', 85, { basins: 1, variant: 'wall-hung', color: OAK, counterColor: STONE, mirror: true }, { fixture: true }),

    // ── Master bedroom ──
    at('bed', 'Double bed 160×200', [20, 910, 220, 1070], 'e', 105, { headboard: 'upholstered', color: LINEN, bedding: '#f4f1ea', pillows: 2 }),
    at('cabinet', 'Nightstand', [20, 1080, 50, 1130], 'e', 50, { drawers: 2, color: OAK, legs: 'wood' }),
    at('cabinet', 'Nightstand', [20, 850, 50, 900], 'e', 50, { drawers: 2, color: OAK, legs: 'wood' }),
    at('wardrobe', 'Wardrobe 320', [20, 720, 340, 775], 's', 240, { doors: 6, color: WHITE, handles: 'bar' }),

    // ── Mamad (safe room) — drawn as a study / guest room ──
    at('bed', 'Single bed 80×190', [360, 1080, 440, 1270], 'n', 85, { headboard: 'wood', color: OAK, bedding: '#e9edf0', pillows: 1 }),
    at('desk', 'Desk 160', [600, 1110, 660, 1270], 'w', 75, { color: OAK, base: 'legs' }),
    at('office-chair', 'Desk chair', [540, 1185, 600, 1245], 'e', 100, { color: GRAPHITE, arms: true }),
    at('wardrobe', 'Wardrobe 160', [360, 920, 520, 975], 's', 240, { doors: 3, color: WHITE, handles: 'bar' }),

    // ── Family bathroom ──
    at('shower', 'Walk-in shower', [685, 1200, 795, 1360], 'n', 200, { variant: 'walk-in', glass: 'clear', frame: 'black', head: 'rain' }, { fixture: true }),
    at('toilet', 'Toilet', [835, 1305, 873, 1360], 'n', 42, { variant: 'wall-hung' }, { fixture: true }),
    at('vanity', 'Vanity 130', [685, 1063, 735, 1193], 'e', 85, { basins: 1, variant: 'wall-hung', color: OAK, counterColor: STONE, mirror: true }, { fixture: true }),

    // ── Laundry / service room ──
    at('washer', 'Washing machine', [915, 1300, 975, 1360], 'e', 85, { variant: 'washer' }),
    at('washer', 'Dryer', [915, 1240, 975, 1300], 'e', 85, { variant: 'dryer' }),
    at('cabinet', 'Utility cabinet', [915, 1180, 975, 1240], 'e', 90, { doors: 1, color: WHITE, legs: 'plinth' }),
    at('wardrobe', 'Utility cupboard', [1105, 1180, 1145, 1360], 'w', 240, { doors: 3, color: WHITE, handles: 'bar' }),

    // ── Bedroom 1 ──
    at('wardrobe', 'Wardrobe 160', [1155, 1200, 1205, 1360], 'e', 240, { doors: 3, color: WHITE, handles: 'bar' }),
    at('bed', 'Single bed 80×190', [1325, 1280, 1515, 1360], 'w', 85, { headboard: 'wood', color: OAK, bedding: '#e7ecef', pillows: 1 }),
    at('desk', 'Desk 140', [1375, 1060, 1515, 1120], 's', 75, { color: OAK, base: 'legs' }),
    at('office-chair', 'Desk chair', [1415, 1125, 1475, 1185], 'n', 100, { color: GRAPHITE, arms: true }),

    // ── Bedroom 2 ──
    at('wardrobe', 'Wardrobe 160', [1155, 750, 1205, 910], 'e', 240, { doors: 3, color: WHITE, handles: 'bar' }),
    at('bed', 'Single bed 80×190', [1325, 750, 1515, 830], 'w', 85, { headboard: 'wood', color: OAK, bedding: '#efe9e1', pillows: 1 }),
    at('desk', 'Desk 140', [1375, 990, 1515, 1050], 'n', 75, { color: OAK, base: 'legs' }),
    at('office-chair', 'Desk chair', [1415, 925, 1475, 985], 's', 100, { color: GRAPHITE, arms: true }),

    // ── Hall & entry ──
    at('wardrobe', 'Hall closet', [960, 880, 1145, 930], 's', 240, { doors: 4, color: WHITE, handles: 'none' }),
    at('wardrobe', 'Entry closet', [960, 710, 1050, 740], 'n', 240, { doors: 2, color: WHITE, handles: 'none' }),

    // ── Guest WC ──
    at('toilet', 'Toilet', [1080, 790, 1135, 828], 'w', 42, { variant: 'wall-hung' }, { fixture: true }),
    at('sink', 'Hand basin', [1011, 845, 1051, 870], 'n', 85, { variant: 'wall-hung', faucet: true }, { fixture: true }),

    // ── Dining ──
    at('table', 'Dining table 180×90', [463, 630, 643, 720], 'n', 75, { shape: 'rect', base: 'legs', color: OAK }),
    ...[495, 553, 611].map((x) => at('chair', 'Dining chair', [x - 23, 713, x + 23, 763], 'n', 82, { variant: 'dining', color: LINEN, legs: 'wood' })),
    ...[495, 553, 611].map((x) => at('chair', 'Dining chair', [x - 23, 587, x + 23, 637], 's', 82, { variant: 'dining', color: LINEN, legs: 'wood' })),

    // ── Kitchen (L-shaped run + tall units + island) ──
    at('kitchen-base', 'Base cabinets', [360, 240, 420, 334], 'e', 90, { drawers: 3, color: WHITE, counterColor: STONE }, { fixture: true }),
    // On the lot-98 sheet the sink sits on the west run (under the window) and the cooktop on the north run.
    at('kitchen-base', 'Sink cabinet', [360, 180, 420, 240], 'e', 90, { doors: 2, sink: 'single', color: WHITE, counterColor: STONE }, { fixture: true }),
    at('kitchen-base', 'Base cabinets', [360, 80, 420, 180], 'e', 90, { doors: 2, color: WHITE, counterColor: STONE }, { fixture: true }),
    at('kitchen-base', 'Corner cabinet', [360, 20, 420, 80], 's', 90, { corner: true, color: WHITE, counterColor: STONE }, { fixture: true }),
    at('kitchen-base', 'Base cabinets', [420, 20, 500, 80], 's', 90, { doors: 2, color: WHITE, counterColor: STONE }, { fixture: true }),
    at('kitchen-base', 'Cooktop cabinet', [500, 20, 560, 80], 's', 90, { drawers: 3, cooktop: 'gas', color: WHITE, counterColor: STONE }, { fixture: true }),
    at('kitchen-base', 'Base cabinets', [560, 20, 655, 80], 's', 90, { drawers: 3, color: WHITE, counterColor: STONE }, { fixture: true }),
    at('kitchen-tall', 'Tall units with oven', [655, 20, 815, 80], 's', 220, { doors: 3, oven: true, microwave: true, color: WHITE }, { fixture: true }),
    at('fridge', 'Refrigerator', [817, 20, 908, 95], 's', 180, { variant: 'french-door', color: '#c9ccd0' }),
    at('kitchen-island', 'Kitchen island 280×120', [536, 193, 816, 313], 's', 90, { overhang: 30, color: OAK, counterColor: STONE, drawers: 4 }, { fixture: true }),
    ...[566, 622, 676, 731, 785].map((x) => at('bar-stool', 'Counter stool', [x - 21, 306, x + 21, 350], 'n', 90, { back: true, seatHeight: 65, color: LINEN, legs: 'wood' })),

    // ── Living room ──
    at('cabinet', 'TV unit 290', [1010, 470, 1300, 510], 'n', 45, { doors: 2, drawers: 2, open: 2, color: OAK, legs: 'wall' }),
    at('tv', 'TV 65"', [1083, 503, 1228, 509], 'n', 84, { variant: 'tv' }, { placement: 'wall', elev: 95 }),
    at('table', 'Coffee table 160×70', [1033, 288, 1193, 358], 'n', 40, { shape: 'rect', base: 'legs', color: OAK }),
    at('sofa', 'Corner sofa with chaise', [1010, 130, 1300, 282], 's', 82, { seats: 3, chaise: 'right', color: '#b9b2a6', legs: 'wood', arms: 'both' }),

    // ── Parking (as drawn) ──
    at('car', 'Car', [1390, -272, 1840, -92], 'e', 150, { variant: 'sedan', color: '#c8ccd2' }, { zone: 'outdoor' }),
    at('car', 'Car', [1390, -22, 1840, 158], 'e', 150, { variant: 'suv', color: '#4a4f57' }, { zone: 'outdoor' }),
  ];
}
