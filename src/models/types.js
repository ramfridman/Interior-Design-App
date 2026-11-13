/**
 * MODEL TYPES — the closed vocabulary shared by catalog researchers (who map real products to a type + params)
 * and 3D modellers (who implement each type). Data only; no THREE import.
 *
 * Every type has:
 *   file       – module in src/models/ that implements it
 *   label      – generic English name
 *   placement  – 'floor' | 'wall' | 'ceiling' | 'surface'   (default; a product may override)
 *   zone       – 'indoor' | 'outdoor' | 'both'
 *   size       – default { w, d, h } in cm (width × depth × height)
 *   params     – type-specific options a product MAY set (all optional; builders must fall back to defaults
 *                and must ignore unknown keys / unknown enum values without throwing)
 *
 * COMMON PARAMS (valid for every type, all optional):
 *   color      '#rrggbb'  main colour (upholstery, body, door fronts, foliage pot…)
 *   color2     '#rrggbb'  secondary colour (legs, frame, countertop, cushions…)
 *   color3     '#rrggbb'  accent
 *   material   'fabric' | 'leather' | 'velvet' | 'wood' | 'metal' | 'rattan' | 'plastic' | 'glass' | 'stone' |
 *              'ceramic' | 'concrete' | 'laminate' | 'lacquer' | 'aluminium' | 'teak' | 'textile'
 *   material2  same vocabulary, for the secondary part
 *   style      free keyword hint: 'modern' | 'scandinavian' | 'classic' | 'industrial' | 'boho' | 'minimal' | 'rustic'
 */
const T = (file, label, placement, zone, size, params = {}) => ({ file, label, placement, zone, size: { w: size[0], d: size[1], h: size[2] }, params });

export const MODEL_TYPES = {
  // ───────── seating & tables  (src/models/seating-tables.js) ─────────
  'sofa':          T('seating-tables', 'Sofa', 'floor', 'both', [220, 95, 82], { seats: '1-6', chaise: "'none'|'left'|'right' — side of the chaise as seen by someone standing in FRONT of the sofa looking at it (left = local -x)", arms: "'both'|'none'|'left'|'right'", legs: "'wood'|'metal'|'none'|'plinth'", cushions: "'loose'|'tight'", back: "'cushion'|'low'|'high'", corner: 'boolean — L-shaped corner sofa with equal return' }),
  'armchair':      T('seating-tables', 'Armchair', 'floor', 'both', [80, 85, 85], { legs: "'wood'|'metal'|'swivel'|'none'", variant: "'club'|'wing'|'shell'|'lounge'|'rocking'|'recliner'" }),
  'pouf':          T('seating-tables', 'Pouf / Ottoman', 'floor', 'both', [60, 60, 40], { shape: "'round'|'rect'" }),
  'bench':         T('seating-tables', 'Bench', 'floor', 'both', [120, 40, 45], { back: 'boolean', upholstered: 'boolean', storage: 'boolean' }),
  'chair':         T('seating-tables', 'Chair', 'floor', 'both', [48, 52, 82], { variant: "'dining'|'upholstered'|'shell'|'folding'|'cross-back'|'cantilever'|'stacking'|'director'|'adirondack'", arms: 'boolean', legs: "'wood'|'metal'|'sled'" }),
  'bar-stool':     T('seating-tables', 'Bar stool', 'floor', 'both', [42, 45, 95], { back: 'boolean', seatHeight: 'cm (65 counter / 75 bar)', legs: "'wood'|'metal'|'pedestal'" }),
  'office-chair':  T('seating-tables', 'Office chair', 'floor', 'indoor', [62, 62, 115], { arms: 'boolean', headrest: 'boolean', variant: "'task'|'executive'|'gaming'|'mesh'" }),
  'table':         T('seating-tables', 'Table', 'floor', 'both', [160, 90, 75], { shape: "'rect'|'round'|'oval'|'square'", base: "'legs'|'pedestal'|'trestle'|'x'|'sled'|'panel'|'hairpin'", top: "material of the top: 'wood'|'glass'|'stone'|'laminate'|'metal'|'ceramic'", topColor: '#hex (defaults to color)', shelf: 'boolean lower shelf', nest: 'number of nested tables (1 default)', extendable: 'boolean (visual only)' }),
  'desk':          T('seating-tables', 'Desk', 'floor', 'indoor', [140, 65, 75], { drawers: "'none'|'left'|'right'|'both'", base: "'legs'|'panel'|'trestle'|'sit-stand'", hutch: 'boolean', corner: 'boolean L-shaped' }),

  // ───────── storage & beds  (src/models/storage-beds.js) ─────────
  'cabinet':       T('storage-beds', 'Cabinet / Sideboard / Dresser / TV unit / Nightstand', 'floor', 'both', [120, 42, 75], { doors: 'number of hinged doors', drawers: 'number of drawers (stacked or in a grid)', columns: 'number of vertical bays', open: 'number of open compartments', legs: "'wood'|'metal'|'plinth'|'none'|'wall' (wall-hung)", legHeight: 'cm', glassDoors: 'boolean', handles: "'bar'|'knob'|'none'|'cutout'", top: 'material of top if different' }),
  'wardrobe':      T('storage-beds', 'Wardrobe', 'floor', 'indoor', [200, 60, 236], { doors: 'number of doors', sliding: 'boolean', mirror: 'number of mirrored doors', handles: "'bar'|'knob'|'none'", drawers: 'number of external bottom drawers', open: 'boolean — open wardrobe system without doors' }),
  'bookcase':      T('storage-beds', 'Bookcase / Shelving unit', 'floor', 'both', [80, 30, 200], { shelves: 'number of levels', columns: 'number of bays', back: 'boolean back panel', doors: 'number of lower doors', frame: "'panel'|'metal'|'ladder'|'cube'", filled: 'boolean — decorate with books/objects' }),
  'shelf-wall':    T('storage-beds', 'Wall shelf', 'wall', 'both', [110, 26, 4], { shelves: 'number of shelves', brackets: 'boolean', variant: "'floating'|'bracket'|'box'|'pegboard'" }),
  'bed':           T('storage-beds', 'Bed', 'floor', 'indoor', [160, 200, 100], { headboard: "'upholstered'|'wood'|'metal'|'none'|'rattan'", headboardHeight: 'cm', storage: 'boolean (box base / drawers)', legs: "'wood'|'metal'|'plinth'|'none'", bedding: '#hex duvet colour', pillows: 'number', mattressHeight: 'cm', canopy: 'boolean', variant: "'standard'|'platform'|'daybed'|'sofa-bed'|'youth'" }),
  'bunk-bed':      T('storage-beds', 'Bunk / loft bed', 'floor', 'indoor', [100, 200, 160], { variant: "'bunk'|'loft'|'trundle'", ladder: "'left'|'right'|'front'" }),
  'crib':          T('storage-beds', 'Cot / Crib', 'floor', 'indoor', [66, 124, 85], { variant: "'crib'|'changing-table'|'toddler'" }),
  'coat-rack':     T('storage-beds', 'Coat rack / Shoe rack / Clothes rail', 'floor', 'indoor', [80, 35, 170], { variant: "'stand'|'rail'|'shoe-rack'|'wall-hooks'" }),

  // ───────── kitchen, bathroom, appliances, climate  (src/models/kitchen-bath.js) ─────────
  'kitchen-base':  T('kitchen-bath', 'Kitchen base cabinet run', 'floor', 'both', [60, 60, 90], { doors: 'number', drawers: 'number', sink: "false|'single'|'double'", cooktop: "false|'gas'|'induction'", counter: "countertop material 'stone'|'wood'|'laminate'|'steel'", counterColor: '#hex', plinth: 'cm', handles: "'bar'|'none'|'knob'", oven: 'boolean built-in oven front', dishwasher: 'boolean integrated front', corner: 'boolean' }),
  'kitchen-wall':  T('kitchen-bath', 'Kitchen wall cabinet', 'wall', 'indoor', [60, 37, 80], { doors: 'number', glassDoors: 'boolean', open: 'boolean open shelf', handles: "'bar'|'none'|'knob'" }),
  'kitchen-tall':  T('kitchen-bath', 'Kitchen tall unit', 'floor', 'indoor', [60, 60, 220], { doors: 'number', oven: 'boolean', microwave: 'boolean', fridge: 'boolean integrated', handles: "'bar'|'none'" }),
  'kitchen-island':T('kitchen-bath', 'Kitchen island', 'floor', 'both', [200, 100, 90], { overhang: 'cm seating overhang on the front side', sink: 'boolean', cooktop: "false|'gas'|'induction'", counter: 'material', counterColor: '#hex', waterfall: 'boolean stone waterfall sides', drawers: 'number', doors: 'number' }),
  'fridge':        T('kitchen-bath', 'Refrigerator', 'floor', 'indoor', [91, 72, 178], { variant: "'french-door'|'side-by-side'|'top-freezer'|'bottom-freezer'|'single'|'4-door'|'mini'|'wine'", dispenser: 'boolean' }),
  'range':         T('kitchen-bath', 'Freestanding cooker / Built-in oven', 'floor', 'indoor', [60, 60, 85], { variant: "'freestanding'|'built-in-oven'|'double-oven'", cooktop: "'gas'|'induction'|'ceramic'|'none'", burners: 'number' }),
  'cooktop':       T('kitchen-bath', 'Cooktop / Hob', 'surface', 'indoor', [60, 52, 5], { variant: "'gas'|'induction'|'ceramic'|'domino'", burners: 'number' }),
  'hood':          T('kitchen-bath', 'Cooker hood', 'wall', 'indoor', [60, 50, 60], { variant: "'chimney'|'island'|'built-in'|'slanted'|'downdraft'" }),
  'dishwasher':    T('kitchen-bath', 'Dishwasher', 'floor', 'indoor', [60, 60, 85], { variant: "'freestanding'|'integrated'|'slim'" }),
  'microwave':     T('kitchen-bath', 'Microwave / Small appliance', 'surface', 'indoor', [50, 38, 30], { variant: "'microwave'|'toaster-oven'|'coffee-machine'|'kettle'|'mixer'|'air-fryer'|'water-bar'" }),
  'washer':        T('kitchen-bath', 'Washing machine / Dryer', 'floor', 'indoor', [60, 60, 85], { variant: "'washer'|'dryer'|'washer-dryer'|'top-load'|'stacked'" }),
  'sink':          T('kitchen-bath', 'Sink / Basin (stand-alone)', 'surface', 'both', [60, 45, 20], { variant: "'kitchen-single'|'kitchen-double'|'vessel'|'pedestal'|'wall-hung'|'utility'", faucet: 'boolean' }),
  'toilet':        T('kitchen-bath', 'Toilet', 'floor', 'indoor', [37, 54, 42], { variant: "'wall-hung'|'floor'|'close-coupled'|'bidet'|'smart'", cistern: "'concealed'|'exposed'" }),
  'vanity':        T('kitchen-bath', 'Bathroom vanity with basin', 'floor', 'indoor', [80, 46, 85], { basins: '1|2', variant: "'wall-hung'|'floor'|'console'", doors: 'number', drawers: 'number', basin: "'integrated'|'vessel'|'undermount'", counter: 'material', counterColor: '#hex', mirror: 'boolean (include mirror above)', faucet: "'chrome'|'black'|'gold'|'nickel'" }),
  'shower':        T('kitchen-bath', 'Shower enclosure / tray', 'floor', 'indoor', [90, 90, 200], { variant: "'walk-in'|'corner'|'sliding'|'hinged'|'quadrant'|'tray-only'|'wet-room'", glass: "'clear'|'frosted'|'smoked'", frame: "'chrome'|'black'|'gold'|'none'", tray: 'boolean', head: "'rain'|'hand'|'column'|'none'", open: "'front'|'left'|'right' side the user enters from" }),
  'bathtub':       T('kitchen-bath', 'Bathtub', 'floor', 'indoor', [170, 75, 58], { variant: "'freestanding'|'built-in'|'corner'|'clawfoot'|'whirlpool'", screen: 'boolean glass screen' }),
  'mirror':        T('kitchen-bath', 'Mirror', 'wall', 'indoor', [60, 3, 80], { shape: "'rect'|'round'|'oval'|'arch'|'pill'|'organic'", frame: "'none'|'thin'|'wood'|'metal'|'led'", cabinet: 'boolean mirrored cabinet', floor: 'boolean leaning floor mirror' }),
  'towel-rail':    T('kitchen-bath', 'Towel rail / Bathroom accessory', 'wall', 'indoor', [60, 12, 80], { variant: "'ladder'|'bar'|'heated'|'hooks'|'shelf'|'paper-holder'|'laundry-basket'" }),
  'ac-unit':       T('kitchen-bath', 'Air conditioner (indoor unit)', 'wall', 'indoor', [90, 22, 30], { variant: "'split'|'floor'|'cassette'|'portable'|'mini-central-grille'" }),
  'ac-outdoor':    T('kitchen-bath', 'Air conditioner outdoor condenser', 'floor', 'outdoor', [85, 35, 60], {}),
  'tv':            T('kitchen-bath', 'Television / Screen', 'wall', 'indoor', [145, 6, 84], { stand: 'boolean (on feet rather than wall-mounted)', variant: "'tv'|'frame'|'monitor'|'projector-screen'|'soundbar'|'speaker'" }),
  'water-heater':  T('kitchen-bath', 'Water heater / Boiler / Solar tank', 'floor', 'both', [60, 60, 150], { variant: "'electric'|'solar-roof'|'gas'|'heat-pump'" }),

  // ───────── lighting & décor  (src/models/lighting-decor.js) ─────────
  'floor-lamp':    T('lighting-decor', 'Floor lamp', 'floor', 'both', [40, 40, 160], { variant: "'shade'|'arc'|'tripod'|'reading'|'torchiere'|'paper'|'globe'", shade: '#hex shade colour', on: 'boolean (emits light)', lightColor: '#hex' }),
  'table-lamp':    T('lighting-decor', 'Table lamp', 'surface', 'both', [28, 28, 45], { variant: "'shade'|'dome'|'globe'|'desk'|'mushroom'|'lantern'", shade: '#hex', on: 'boolean' }),
  'pendant':       T('lighting-decor', 'Pendant light / Chandelier', 'ceiling', 'both', [45, 45, 120], { variant: "'dome'|'globe'|'cone'|'cylinder'|'rattan'|'linear'|'cluster'|'chandelier'|'sputnik'|'paper'|'drum'|'ring'", count: 'number of shades/bulbs for linear/cluster', drop: 'cm cord length (defaults to h minus shade)', shade: '#hex', on: 'boolean' }),
  'ceiling-light': T('lighting-decor', 'Ceiling light (flush / spots / track)', 'ceiling', 'both', [40, 40, 10], { variant: "'flush'|'spot'|'track'|'panel'|'semi-flush'|'downlight'", count: 'number of heads', on: 'boolean' }),
  'wall-light':    T('lighting-decor', 'Wall light / Sconce', 'wall', 'both', [15, 12, 25], { variant: "'sconce'|'up-down'|'swing-arm'|'picture'|'bulkhead'|'lantern'|'strip'", on: 'boolean' }),
  'ceiling-fan':   T('lighting-decor', 'Ceiling fan', 'ceiling', 'both', [132, 132, 40], { blades: '3-6', light: 'boolean', variant: "'modern'|'classic'|'industrial'|'tropical'" }),
  'rug':           T('lighting-decor', 'Rug / Carpet / Doormat', 'floor', 'both', [200, 300, 1.5], { shape: "'rect'|'round'|'oval'|'runner'|'hide'", pattern: "'plain'|'border'|'stripes'|'geometric'|'persian'|'berber'|'checker'|'abstract'|'jute'|'shaggy'", fringe: 'boolean' }),
  'wall-art':      T('lighting-decor', 'Wall art / Frame / Clock', 'wall', 'both', [70, 3, 100], { variant: "'canvas'|'framed'|'gallery'|'clock'|'macrame'|'metal'|'shelf-art'|'photo'", frame: '#hex', palette: "['#hex', …] colours used for abstract artwork", count: 'frames in a gallery set' }),
  'curtain':       T('lighting-decor', 'Curtain / Blind', 'wall', 'indoor', [200, 12, 260], { variant: "'curtain'|'sheer'|'roller'|'venetian'|'roman'|'vertical'|'shutter'", open: '0..1 how far drawn open', rod: '#hex' }),
  'plant':         T('lighting-decor', 'Indoor plant', 'floor', 'both', [50, 50, 120], { species: "'monstera'|'ficus'|'fiddle-leaf'|'palm'|'snake'|'pothos'|'succulent'|'cactus'|'olive'|'fern'|'orchid'|'herbs'|'bamboo'|'rubber'|'zz'|'dracaena'|'peace-lily'", pot: "'ceramic'|'terracotta'|'basket'|'concrete'|'metal'|'plastic'", potColor: '#hex', artificial: 'boolean' }),
  'vase':          T('lighting-decor', 'Vase / Decorative object', 'surface', 'both', [18, 18, 30], { variant: "'vase'|'bowl'|'candle'|'sculpture'|'books'|'tray'|'basket'|'lantern'|'diffuser'|'frame'", flowers: 'boolean' }),
  'cushion':       T('lighting-decor', 'Cushion / Throw / Bedding', 'surface', 'both', [45, 45, 12], { variant: "'cushion'|'throw'|'bolster'|'floor-cushion'|'duvet-set'", pattern: "'plain'|'stripes'|'geometric'" }),

  // ───────── outdoor furniture & structures  (src/models/outdoor.js) ─────────
  'lounger':       T('outdoor', 'Sun lounger / Daybed', 'floor', 'outdoor', [70, 195, 35], { variant: "'lounger'|'daybed'|'double'|'hanging-egg'|'bean-bag'", cushion: 'boolean', wheels: 'boolean', backAngle: 'degrees' }),
  'parasol':       T('outdoor', 'Parasol / Umbrella / Shade sail', 'floor', 'outdoor', [300, 300, 250], { variant: "'centre-pole'|'cantilever'|'wall'|'sail'|'sail-triangle'", shape: "'round'|'square'|'rect'", canopy: '#hex (defaults to color)', open: 'boolean' }),
  'pergola':       T('outdoor', 'Pergola / Gazebo / Awning / Carport', 'floor', 'outdoor', [400, 300, 250], { variant: "'slatted'|'louvered'|'solid-roof'|'gazebo'|'fabric'|'retractable-awning'|'carport'|'wall-mounted'|'polycarbonate'", posts: '4|6|2', slats: 'number of roof slats', curtains: 'boolean', roofColor: '#hex', attached: 'boolean (no posts on the back side)' }),
  'bbq':           T('outdoor', 'BBQ / Grill / Outdoor kitchen / Pizza oven', 'floor', 'outdoor', [140, 60, 115], { variant: "'gas'|'charcoal-kettle'|'kamado'|'built-in'|'outdoor-kitchen'|'pizza-oven'|'smoker'|'tabun'|'mangal'", burners: 'number', sideShelves: 'boolean', lid: "'closed'|'open'" }),
  'fire-pit':      T('outdoor', 'Fire pit / Patio heater', 'floor', 'outdoor', [80, 80, 40], { variant: "'bowl'|'table'|'chiminea'|'heater-mushroom'|'heater-pyramid'|'ring'", lit: 'boolean' }),
  'swing-bench':   T('outdoor', 'Swing bench / Hammock / Hanging chair', 'floor', 'outdoor', [200, 120, 180], { variant: "'swing-bench'|'hammock-stand'|'hammock-trees'|'hanging-chair'|'porch-swing'", canopy: 'boolean', seats: 'number' }),
  'shed':          T('outdoor', 'Garden shed / Storage box / Bin store', 'floor', 'outdoor', [200, 150, 220], { variant: "'shed'|'storage-box'|'bin-store'|'tall-cabinet'|'bike-store'|'greenhouse'|'dog-house'", doors: '1|2', roof: "'gable'|'pent'|'flat'", window: 'boolean' }),
  'fence':         T('outdoor', 'Fence / Wall / Screen / Gate (segment)', 'floor', 'outdoor', [200, 6, 150], { variant: "'slat-horizontal'|'slat-vertical'|'picket'|'mesh'|'stone-wall'|'block-wall'|'hedge-screen'|'bamboo'|'glass'|'gate'|'gate-sliding'|'gabion'|'trellis'|'railing'|'pool-fence'", posts: 'boolean', gap: '0..1 openness' }),
  'outdoor-light': T('outdoor', 'Outdoor light', 'floor', 'outdoor', [15, 15, 60], { variant: "'bollard'|'spike-spot'|'post-lantern'|'string'|'wall'|'step'|'solar-path'|'flood'|'lantern'|'globe'", count: 'number of bulbs for string lights', on: 'boolean' }),
  'play':          T('outdoor', 'Play equipment', 'floor', 'outdoor', [300, 250, 220], { variant: "'swing-set'|'slide'|'trampoline'|'playhouse'|'sandbox'|'climbing-frame'|'seesaw'|'basketball-hoop'|'football-goal'|'paddling-pool'|'ping-pong'|'ninja-line'|'mud-kitchen'", net: 'boolean (trampoline safety net)', swings: 'number' }),
  'car':           T('outdoor', 'Vehicle', 'floor', 'outdoor', [180, 450, 150], { variant: "'sedan'|'suv'|'hatchback'|'ev'|'van'|'pickup'|'motorcycle'|'bicycle'|'e-scooter'|'golf-cart'|'kalnoit'" }),
  'utility':       T('outdoor', 'Outdoor utility', 'floor', 'outdoor', [200, 60, 180], { variant: "'clothesline-rotary'|'clothesline-wall'|'clothes-rack'|'outdoor-shower'|'hose-reel'|'tap'|'bin'|'bins-3'|'compost'|'mailbox'|'rain-barrel'|'ev-charger'|'gas-tanks'|'irrigation-controller'|'bike-rack'|'doormat-bench'" }),

  // ───────── garden, plants, water & ground surfaces  (src/models/garden.js) ─────────
  'tree':          T('garden', 'Tree', 'floor', 'outdoor', [300, 300, 400], { species: "'olive'|'lemon'|'orange'|'pomegranate'|'fig'|'date-palm'|'washingtonia-palm'|'ficus'|'jacaranda'|'poinciana'|'cypress'|'carob'|'mango'|'avocado'|'almond'|'bougainvillea-tree'|'plumeria'|'moringa'|'banana'|'oak'|'eucalyptus'|'mulberry'|'guava'|'loquat'|'generic'", fruit: 'boolean', age: "'young'|'mature'" }),
  'shrub':         T('garden', 'Shrub / Bush / Flowering plant', 'floor', 'outdoor', [100, 100, 100], { species: "'bougainvillea'|'lavender'|'rosemary'|'hibiscus'|'oleander'|'rose'|'lantana'|'plumbago'|'myrtle'|'pittosporum'|'duranta'|'jasmine'|'agave'|'aloe'|'cactus'|'yucca'|'ornamental-grass'|'bird-of-paradise'|'geranium'|'sage'|'succulent-mix'|'fern'|'generic'", flowerColor: '#hex', shape: "'natural'|'ball'|'cone'" }),
  'hedge':         T('garden', 'Hedge (segment)', 'floor', 'outdoor', [200, 50, 150], { species: "'ficus'|'myrtle'|'pittosporum'|'cypress'|'bamboo'|'duranta'|'bougainvillea'|'generic'", trimmed: 'boolean' }),
  'flower-bed':    T('garden', 'Flower bed / Planting area', 'floor', 'outdoor', [200, 100, 40], { variant: "'mixed'|'flowers'|'succulents'|'herbs'|'vegetables'|'grasses'|'groundcover'|'rock-garden'", edging: "'none'|'stone'|'steel'|'wood'|'brick'", flowerColors: "['#hex', …]", mulch: "'bark'|'tuff'|'gravel'|'soil'" }),
  'planter':       T('garden', 'Planter / Pot with plant', 'floor', 'both', [50, 50, 60], { shape: "'round'|'square'|'rect'|'bowl'|'tall'|'trough'|'hanging'|'wall'", plant: "'none'|'shrub'|'flowers'|'palm'|'olive'|'citrus'|'cactus'|'succulents'|'herbs'|'grass'|'topiary'|'bamboo'|'bougainvillea'", plantHeight: 'cm above the pot rim' }),
  'raised-bed':    T('garden', 'Raised vegetable bed / Garden box', 'floor', 'outdoor', [200, 100, 40], { crop: "'vegetables'|'herbs'|'empty'|'flowers'|'strawberries'", frame: "'wood'|'steel'|'corten'|'stone'|'plastic'", trellis: 'boolean' }),
  'surface':       T('garden', 'Ground surface area (resizable rectangle)', 'floor', 'outdoor', [300, 300, 2], { kind: "'lawn'|'synthetic-grass'|'deck-wood'|'deck-composite'|'paving-concrete'|'paving-stone'|'porcelain-tile'|'gravel'|'tuff'|'mulch'|'soil'|'sand'|'stepping-stones'|'concrete'|'asphalt'|'brick'|'terrazzo'|'rubber'|'cobble'|'crazy-paving'", tile: 'cm tile / plank size', pattern: "'grid'|'running-bond'|'herringbone'|'planks'|'random'", color: '#hex', color2: '#hex joint / secondary' }),
  'pool':          T('garden', 'Swimming pool', 'floor', 'outdoor', [600, 300, 140], { variant: "'in-ground'|'above-ground-frame'|'above-ground-round'|'inflatable'|'plunge'|'lap'|'kids'|'natural'", shape: "'rect'|'round'|'oval'|'kidney'|'L'", coping: '#hex', water: '#hex', steps: "'none'|'corner'|'full-width'|'ladder'", depth: 'cm', cover: 'boolean', deck: 'cm width of coping/deck border' }),
  'spa':           T('garden', 'Hot tub / Jacuzzi / Sauna', 'floor', 'outdoor', [210, 210, 90], { variant: "'square'|'round'|'inflatable'|'swim-spa'|'sauna-barrel'|'sauna-cabin'|'cold-plunge'", seats: 'number', cover: 'boolean' }),
  'water-feature': T('garden', 'Fountain / Pond / Bird bath', 'floor', 'outdoor', [100, 100, 100], { variant: "'fountain-tier'|'fountain-wall'|'fountain-sphere'|'pond'|'bird-bath'|'stream'|'bubbler'" }),
  'garden-decor':  T('garden', 'Garden décor / Rocks / Edging', 'floor', 'outdoor', [60, 60, 40], { variant: "'boulder'|'rocks'|'statue'|'bird-feeder'|'arch'|'obelisk'|'stepping-stone'|'edging'|'sundial'|'gnome'|'sign'|'bridge'|'wind-chime'" }),

  // ───────── made-to-measure carpentry (src/models/carpentry.js) — never a catalogue product: registry.js routes every
  //           item with `carp` to it (the item keeps its generic type); params come from the unit's run spec ─────────
  'carpentry-unit':T('carpentry', 'Made-to-measure carpentry unit', 'floor', 'indoor', [60, 60, 90], {}),

  // ───────── room finishes (handled by the 3D house renderer, not a model module) ─────────
  'floor-finish':  T('finishes', 'Flooring', 'floor', 'both', [0, 0, 0], { pattern: "'tile'|'plank'|'herringbone'|'chevron'|'terrazzo'|'concrete'|'marble'|'mosaic'|'checker'|'hex'|'deck'|'stone'", tileW: 'cm', tileH: 'cm', color: '#hex', color2: '#hex grout / secondary tone', gloss: '0..1' }),
  'wall-finish':   T('finishes', 'Wall paint / Wall tile / Wallpaper / Cladding', 'wall', 'both', [0, 0, 0], { kind: "'paint'|'tile'|'wallpaper'|'wood-panel'|'stone'|'brick'|'plaster'|'microcement'", color: '#hex', color2: '#hex', tileW: 'cm', tileH: 'cm', pattern: "'plain'|'subway'|'grid'|'stripes'|'slats'|'herringbone'", gloss: '0..1' }),
};

export const MODEL_FILES = ['seating-tables', 'storage-beds', 'kitchen-bath', 'lighting-decor', 'outdoor', 'garden', 'carpentry'];

/** UI catalogue tree. Every product has { zone, category, subcategory } from this tree. */
export const CATEGORIES = {
  indoor: [
    { id: 'living', name: 'Living room', sub: ['sofas', 'armchairs', 'coffee-tables', 'side-tables', 'tv-units', 'bookcases', 'sideboards', 'poufs-benches'] },
    { id: 'dining', name: 'Dining', sub: ['dining-tables', 'dining-chairs', 'bar-stools', 'benches', 'buffets'] },
    { id: 'bedroom', name: 'Bedroom', sub: ['beds', 'mattresses', 'nightstands', 'wardrobes', 'dressers', 'bedding'] },
    { id: 'kids', name: 'Kids & baby', sub: ['kids-beds', 'cribs', 'kids-storage', 'kids-desks', 'kids-decor'] },
    { id: 'office', name: 'Home office', sub: ['desks', 'office-chairs', 'office-storage', 'shelving'] },
    { id: 'kitchen', name: 'Kitchen', sub: ['kitchen-cabinets', 'kitchen-islands', 'refrigerators', 'ovens-cooktops', 'hoods', 'dishwashers', 'sinks-faucets', 'small-appliances'] },
    { id: 'bathroom', name: 'Bathroom', sub: ['vanities', 'toilets', 'showers', 'bathtubs', 'mirrors', 'bath-accessories'] },
    { id: 'laundry', name: 'Laundry & utility', sub: ['washers-dryers', 'laundry-storage', 'water-heaters'] },
    { id: 'storage', name: 'Storage & entry', sub: ['shoe-cabinets', 'coat-racks', 'consoles', 'wall-shelves', 'cabinets'] },
    { id: 'lighting', name: 'Lighting', sub: ['pendants', 'ceiling-lights', 'floor-lamps', 'table-lamps', 'wall-lights', 'ceiling-fans'] },
    { id: 'decor', name: 'Décor & textiles', sub: ['rugs', 'curtains', 'wall-art', 'mirrors', 'plants', 'vases-objects', 'cushions-throws'] },
    { id: 'climate-tech', name: 'Climate & electronics', sub: ['air-conditioners', 'tvs', 'audio'] },
    { id: 'finishes', name: 'Floors & walls', sub: ['floor-tiles', 'parquet-laminate', 'wall-paint', 'wall-tiles', 'wallpaper-cladding'] },
  ],
  outdoor: [
    { id: 'outdoor-furniture', name: 'Outdoor furniture', sub: ['outdoor-sofas', 'outdoor-dining', 'outdoor-chairs', 'loungers', 'swings-hammocks', 'outdoor-poufs-tables'] },
    { id: 'shade', name: 'Shade & structures', sub: ['pergolas', 'parasols', 'shade-sails', 'gazebos', 'carports'] },
    { id: 'bbq', name: 'BBQ & outdoor kitchen', sub: ['gas-grills', 'charcoal-grills', 'pizza-ovens', 'outdoor-kitchens', 'fire-pits-heaters'] },
    { id: 'plants', name: 'Trees & plants', sub: ['fruit-trees', 'shade-trees', 'palms', 'shrubs-flowers', 'hedges', 'succulents-cacti', 'herbs-vegetables', 'climbers'] },
    { id: 'planters', name: 'Planters & beds', sub: ['pots', 'planters', 'raised-beds', 'flower-beds'] },
    { id: 'surfaces', name: 'Ground & paving', sub: ['lawn', 'synthetic-grass', 'decking', 'paving', 'gravel-mulch', 'outdoor-tiles'] },
    { id: 'pool-spa', name: 'Pools & spas', sub: ['pools', 'above-ground-pools', 'hot-tubs', 'saunas', 'pool-accessories'] },
    { id: 'play', name: 'Play & sport', sub: ['trampolines', 'swing-sets', 'playhouses', 'sport'] },
    { id: 'outdoor-storage', name: 'Sheds & storage', sub: ['sheds', 'storage-boxes', 'bins'] },
    { id: 'outdoor-lighting', name: 'Outdoor lighting', sub: ['path-lights', 'wall-lights', 'string-lights', 'spotlights'] },
    { id: 'fencing', name: 'Fences & gates', sub: ['fences', 'gates', 'screens', 'walls'] },
    { id: 'outdoor-utility', name: 'Utility & vehicles', sub: ['clotheslines', 'irrigation', 'outdoor-showers', 'vehicles', 'water-features', 'garden-decor'] },
  ],
};
