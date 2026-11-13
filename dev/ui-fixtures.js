/**
 * DEV ONLY — fake catalogue for exercising the UI with 0 / 10 / 600 products while the real catalogue is being
 * researched. Nothing here is a real product, price or link (names say "Test", links point at example.com) and
 * this file is never loaded by the app itself.
 */
const CATEGORY_TYPES = {
  living: ['sofa', 'armchair', 'table', 'cabinet', 'bookcase', 'pouf'], dining: ['table', 'chair', 'bar-stool', 'bench'],
  bedroom: ['bed', 'wardrobe', 'cabinet'], kids: ['bunk-bed', 'crib'], office: ['desk', 'office-chair'],
  kitchen: ['fridge', 'range', 'kitchen-island', 'hood'], bathroom: ['vanity', 'toilet', 'shower', 'bathtub', 'mirror'],
  laundry: ['washer'], storage: ['coat-rack', 'shelf-wall'], lighting: ['pendant', 'floor-lamp', 'ceiling-light'],
  decor: ['rug', 'plant', 'wall-art', 'curtain'], 'climate-tech': ['ac-unit', 'tv'], finishes: ['floor-finish', 'wall-finish'],
  'outdoor-furniture': ['sofa', 'chair', 'lounger'], shade: ['pergola', 'parasol'], bbq: ['bbq', 'fire-pit'], plants: ['tree', 'shrub', 'hedge'],
  planters: ['planter', 'raised-bed', 'flower-bed'], surfaces: ['surface'], 'pool-spa': ['pool', 'spa'], play: ['play'],
  'outdoor-storage': ['shed'], 'outdoor-lighting': ['outdoor-light'], fencing: ['fence'], 'outdoor-utility': ['car', 'utility'],
};
const COLORS = ['#cbbfa8', '#8c8a84', '#3a3d42', '#c8a476', '#5c6b5a', '#3e5c76', '#d9d2c5', '#b4543a'];
const RETAILERS = ['Fixture Home', 'Sample Living', 'Demo Garden Centre', 'Placeholder Kitchens', 'Testwood'];
const FLOORS = [{ pattern: 'plank', tileW: 120, tileH: 19, color: '#c9a77c', color2: '#a98658' }, { pattern: 'tile', tileW: 60, tileH: 60, color: '#d9d4ca', color2: '#b9b3a8' }, { pattern: 'herringbone', tileW: 60, tileH: 12, color: '#b08e63', color2: '#8c6d48' }, { pattern: 'terrazzo', color: '#dedbd3', color2: '#8f8a80' }];
const WALLS = [{ kind: 'paint', color: '#e8e0d2' }, { kind: 'tile', pattern: 'subway', tileW: 30, tileH: 10, color: '#f1efe9', color2: '#c9c5bb' }, { kind: 'paint', color: '#cfd6d8' }];

/** Deterministic pseudo-random in [0, 1). */
const rnd = (i, salt = 1) => { const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x); };

export function makeFixtureProducts(n, { MODEL_TYPES, CATEGORIES }) {
  const slots = [];
  for (const zone of ['indoor', 'outdoor']) for (const cat of CATEGORIES[zone]) for (const type of CATEGORY_TYPES[cat.id] || []) slots.push({ zone, cat, type });
  const out = [];
  for (let i = 0; i < n; i++) {
    const { zone, cat, type } = slots[i % slots.length];
    const t = MODEL_TYPES[type];
    const k = 0.8 + rnd(i) * 0.5;
    const finish = type === 'floor-finish' || type === 'wall-finish';
    const perM2 = finish || type === 'surface', perM = type === 'fence' || type === 'hedge';
    out.push({
      id: `fixture-${type}-${i}`, name: `Test ${t.label.split(' / ')[0].toLowerCase()} ${String.fromCharCode(65 + (i % 26))}${i}`,
      brand: 'Fixture', retailer: RETAILERS[i % RETAILERS.length], url: `https://example.com/fixture/${type}/${i}`,
      price: Math.round((perM2 ? 60 + rnd(i, 3) * 240 : perM ? 90 + rnd(i, 3) * 400 : 150 + rnd(i, 3) ** 2 * 9000) / 10) * 10 - 1,
      priceUnit: perM2 ? 'm2' : perM ? 'm' : 'item', priceDate: '2026-11', currency: 'ILS',
      dims: finish ? undefined : { w: Math.round(t.size.w * k), d: Math.round(t.size.d * (finish ? 1 : k)), h: t.size.h },
      type, params: finish ? (type === 'floor-finish' ? FLOORS[i % FLOORS.length] : WALLS[i % WALLS.length]) : { color: COLORS[i % COLORS.length] },
      zone, category: cat.id, subcategory: cat.sub[i % cat.sub.length], placement: t.placement, tags: ['fixture'],
      description: 'Development fixture, not a real product.',
    });
  }
  return out;
}

/** A catalogue namespace with the same API as src/catalog/index.js, backed by fixture products. */
export function makeFixtureCatalog(real, n) {
  const products = makeFixtureProducts(n, real);
  const byId = new Map(products.map((p) => [p.id, p]));
  const isFinish = (p) => p.type === 'floor-finish' || p.type === 'wall-finish';
  return {
    ...real,
    allProducts: () => products,
    getProduct: (id) => byId.get(id) || null,
    searchProducts(opts = {}) {
      const words = (opts.query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      let out = products.filter((p) => (!opts.zone || p.zone === opts.zone) && (!opts.category || p.category === opts.category)
        && (!opts.subcategory || p.subcategory === opts.subcategory) && (!opts.type || p.type === opts.type)
        && (opts.minPrice == null || p.price >= opts.minPrice) && (opts.maxPrice == null || p.price <= opts.maxPrice)
        && !(opts.finishes === false && isFinish(p))
        && words.every((w) => `${p.name} ${p.retailer} ${p.category} ${p.subcategory} ${p.type}`.toLowerCase().includes(w)));
      if (opts.sort === 'price-asc') out = out.slice().sort((a, b) => a.price - b.price);
      else if (opts.sort === 'price-desc') out = out.slice().sort((a, b) => b.price - a.price);
      else if (opts.sort === 'name') out = out.slice().sort((a, b) => a.name.localeCompare(b.name));
      return out;
    },
    retailers(zone) {
      const m = new Map();
      for (const p of products) if (!zone || p.zone === zone) m.set(p.retailer, (m.get(p.retailer) || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
    },
    categoryCounts(zone) {
      const m = {};
      for (const p of products) if (!zone || p.zone === zone) m[p.category] = (m[p.category] || 0) + 1;
      return m;
    },
    alternativesFor(item, limit = 24) {
      return products.filter((p) => p.type === item.type && p.id !== item.productId && p.dims)
        .map((p) => ({ p, score: Math.abs(p.dims.w - item.w) + Math.abs(p.dims.d - item.d) }))
        .sort((a, b) => a.score - b.score).slice(0, limit).map((x) => x.p);
    },
  };
}
