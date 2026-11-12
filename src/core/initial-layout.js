/**
 * The furniture & fit-out layout drawn by the architect on plan E7, as ordinary editable items.
 * Positions and sizes were measured from the drawing. These are GENERIC pieces (no product, no price) —
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
    at('shower', 'Walk-in shower', [20, 20, 115, 180], 'e', 200, { variant: 'walk-in', glass: 'clear', frame: 'black', head: 'rain' }, { fixture: true }),
    at('toilet', 'Toilet', [161, 20, 199, 75], 's', 42, { variant: 'wall-hung' }, { fixture: true }),
    at('vanity', 'Vanity 100', [240, 20, 340, 70], 's', 85, { basins: 1, variant: 'wall-hung', color: OAK, counterColor: STONE, mirror: true }, { fixture: true }),

    // ── Master bedroom ──
    at('bed', 'Double bed 160×200', [20, 310, 220, 470], 'e', 105, { headboard: 'upholstered', color: LINEN, bedding: '#f4f1ea', pillows: 2 }),
    at('cabinet', 'Nightstand', [20, 250, 50, 300], 'e', 50, { drawers: 2, color: OAK, legs: 'wood' }),
    at('cabinet', 'Nightstand', [20, 480, 50, 530], 'e', 50, { drawers: 2, color: OAK, legs: 'wood' }),
    at('wardrobe', 'Wardrobe 320', [20, 605, 340, 660], 'n', 240, { doors: 6, color: WHITE, handles: 'bar' }),

    // ── Mamad (safe room) — drawn as a study / guest room ──
    at('bed', 'Single bed 80×190', [360, 110, 440, 300], 's', 85, { headboard: 'wood', color: OAK, bedding: '#e9edf0', pillows: 1 }),
    at('desk', 'Desk 160', [600, 110, 660, 270], 'w', 75, { color: OAK, base: 'legs' }),
    at('office-chair', 'Desk chair', [540, 135, 600, 195], 'e', 100, { color: GRAPHITE, arms: true }),
    at('wardrobe', 'Wardrobe 160', [360, 405, 520, 460], 'n', 240, { doors: 3, color: WHITE, handles: 'bar' }),

    // ── Family bathroom ──
    at('shower', 'Walk-in shower', [685, 20, 795, 180], 's', 200, { variant: 'walk-in', glass: 'clear', frame: 'black', head: 'rain' }, { fixture: true }),
    at('toilet', 'Toilet', [835, 20, 873, 75], 's', 42, { variant: 'wall-hung' }, { fixture: true }),
    at('vanity', 'Vanity 130', [685, 187, 735, 317], 'e', 85, { basins: 1, variant: 'wall-hung', color: OAK, counterColor: STONE, mirror: true }, { fixture: true }),

    // ── Laundry / service room ──
    at('washer', 'Washing machine', [915, 20, 975, 80], 'e', 85, { variant: 'washer' }),
    at('washer', 'Dryer', [915, 80, 975, 140], 'e', 85, { variant: 'dryer' }),
    at('cabinet', 'Utility cabinet', [915, 140, 975, 200], 'e', 90, { doors: 1, color: WHITE, legs: 'plinth' }),
    at('wardrobe', 'Utility cupboard', [1105, 20, 1145, 200], 'w', 240, { doors: 3, color: WHITE, handles: 'bar' }),

    // ── Bedroom 1 ──
    at('wardrobe', 'Wardrobe 160', [1155, 20, 1205, 180], 'e', 240, { doors: 3, color: WHITE, handles: 'bar' }),
    at('bed', 'Single bed 80×190', [1325, 20, 1515, 100], 'w', 85, { headboard: 'wood', color: OAK, bedding: '#e7ecef', pillows: 1 }),
    at('desk', 'Desk 140', [1375, 260, 1515, 320], 'n', 75, { color: OAK, base: 'legs' }),
    at('office-chair', 'Desk chair', [1415, 195, 1475, 255], 's', 100, { color: GRAPHITE, arms: true }),

    // ── Bedroom 2 ──
    at('wardrobe', 'Wardrobe 160', [1155, 470, 1205, 630], 'e', 240, { doors: 3, color: WHITE, handles: 'bar' }),
    at('bed', 'Single bed 80×190', [1325, 550, 1515, 630], 'w', 85, { headboard: 'wood', color: OAK, bedding: '#efe9e1', pillows: 1 }),
    at('desk', 'Desk 140', [1375, 330, 1515, 390], 's', 75, { color: OAK, base: 'legs' }),
    at('office-chair', 'Desk chair', [1415, 395, 1475, 455], 'n', 100, { color: GRAPHITE, arms: true }),

    // ── Hall & entry ──
    at('wardrobe', 'Hall closet', [960, 450, 1145, 500], 'n', 240, { doors: 4, color: WHITE, handles: 'none' }),
    at('wardrobe', 'Entry closet', [960, 640, 1050, 670], 's', 240, { doors: 2, color: WHITE, handles: 'none' }),

    // ── Guest WC ──
    at('toilet', 'Toilet', [1080, 552, 1135, 590], 'w', 42, { variant: 'wall-hung' }, { fixture: true }),
    at('sink', 'Hand basin', [1011, 510, 1051, 535], 's', 85, { variant: 'wall-hung', faucet: true }, { fixture: true }),

    // ── Dining ──
    at('table', 'Dining table 180×90', [463, 660, 643, 750], 's', 75, { shape: 'rect', base: 'legs', color: OAK }),
    ...[495, 553, 611].map((x) => at('chair', 'Dining chair', [x - 23, 617, x + 23, 667], 's', 82, { variant: 'dining', color: LINEN, legs: 'wood' })),
    ...[495, 553, 611].map((x) => at('chair', 'Dining chair', [x - 23, 743, x + 23, 793], 'n', 82, { variant: 'dining', color: LINEN, legs: 'wood' })),

    // ── Kitchen (L-shaped run + tall units + island) ──
    at('kitchen-base', 'Base cabinets', [360, 1046, 420, 1140], 'e', 90, { drawers: 3, color: WHITE, counterColor: STONE }, { fixture: true }),
    at('kitchen-base', 'Cooktop cabinet', [360, 1140, 420, 1200], 'e', 90, { drawers: 3, cooktop: 'gas', color: WHITE, counterColor: STONE }, { fixture: true }),
    at('kitchen-base', 'Base cabinets', [360, 1200, 420, 1300], 'e', 90, { doors: 2, color: WHITE, counterColor: STONE }, { fixture: true }),
    at('kitchen-base', 'Corner cabinet', [360, 1300, 420, 1360], 'n', 90, { corner: true, color: WHITE, counterColor: STONE }, { fixture: true }),
    at('kitchen-base', 'Base cabinets', [420, 1300, 500, 1360], 'n', 90, { doors: 2, color: WHITE, counterColor: STONE }, { fixture: true }),
    at('kitchen-base', 'Sink cabinet', [500, 1300, 560, 1360], 'n', 90, { doors: 2, sink: 'single', color: WHITE, counterColor: STONE }, { fixture: true }),
    at('kitchen-base', 'Base cabinets', [560, 1300, 655, 1360], 'n', 90, { drawers: 3, color: WHITE, counterColor: STONE }, { fixture: true }),
    at('kitchen-tall', 'Tall units with oven', [655, 1300, 815, 1360], 'n', 220, { doors: 3, oven: true, microwave: true, color: WHITE }, { fixture: true }),
    at('fridge', 'Refrigerator', [817, 1285, 908, 1360], 'n', 180, { variant: 'french-door', color: '#c9ccd0' }),
    at('kitchen-island', 'Kitchen island 280×120', [536, 1067, 816, 1187], 'n', 90, { overhang: 30, color: OAK, counterColor: STONE, drawers: 4 }, { fixture: true }),
    ...[566, 622, 676, 731, 785].map((x) => at('bar-stool', 'Counter stool', [x - 21, 1030, x + 21, 1074], 's', 90, { back: true, seatHeight: 65, color: LINEN, legs: 'wood' })),

    // ── Living room ──
    at('cabinet', 'TV unit 290', [1010, 870, 1300, 910], 's', 45, { doors: 2, drawers: 2, open: 2, color: OAK, legs: 'wall' }),
    at('tv', 'TV 65"', [1083, 871, 1228, 877], 's', 84, { variant: 'tv' }, { placement: 'wall', elev: 95 }),
    at('table', 'Coffee table 160×70', [1033, 1022, 1193, 1092], 's', 40, { shape: 'rect', base: 'legs', color: OAK }),
    at('sofa', 'Corner sofa with chaise', [1010, 1098, 1300, 1250], 'n', 82, { seats: 3, chaise: 'left', color: '#b9b2a6', legs: 'wood', arms: 'both' }),

    // ── Parking (as drawn) ──
    at('car', 'Car', [1400, 1227, 1850, 1407], 'e', 150, { variant: 'sedan', color: '#c8ccd2' }, { zone: 'outdoor' }),
    at('car', 'Car', [1400, 1477, 1850, 1657], 'e', 150, { variant: 'suv', color: '#4a4f57' }, { zone: 'outdoor' }),
  ];
}
