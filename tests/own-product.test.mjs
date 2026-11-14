// "Add your own product" (docs/CONTRACT.md § 16): validation, store add / edit / delete with undo, serialise → load,
// project file round trip, merge into the catalogue, delete with placed items, price on request in the shopping list
// and CSV, the library with storage unavailable, and live collaboration with two real-store replicas.
//   node tests/own-product.test.mjs
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { store } from '../src/core/store.js';
import { PLAN } from '../src/core/plan.js';
import * as catalog from '../src/catalog/index.js';
import {
  validateOwnInput, buildOwnProduct, inputFromProduct, shopFromUrl, typesForCategory, typeOptions, sizeWarning, normalizeOwnProduct,
  readNumber, isOwnId, newOwnId,
} from '../src/catalog/own.js';
import { createProjects, createMemoryAdapter } from '../src/core/projects.js';
import { buildShopping, shoppingCSV, shoppingTotal } from '../src/ui/shopping.js';
import { recordToDoc, docToRecord, validateOps } from '../src/collab/ops.js';
import { createRoom } from '../src/collab/room.js';

store.persist = false;
let passed = 0, failed = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra !== '' && !ok ? ' — ' + extra : ''}`); };
const clone = (o) => JSON.parse(JSON.stringify(o));
const quiet = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };

await quiet(() => catalog.loadCatalog());
const ctx = { store, plan: PLAN, catalog };

/** What a person typed for a sofa from a shop the catalogue does not have. */
const sofaInput = (o = {}) => ({
  url: 'https://www.shop.example.com/products/oslo-sofa', retailer: 'shop.example.com', name: 'Oslo 3-seat sofa', brand: 'Nordhaus', note: 'Ask for the linen cover',
  price: '4,990', priceUnit: 'item', priceOnRequest: false, zone: 'indoor', category: 'living', type: 'sofa',
  params: { color: '#8A5A3B', seats: '3', chaise: 'left', nonsense: 'x' }, dims: { w: '212', d: '94', h: '81' }, ...o,
});
const make = (o = {}, opts = {}) => buildOwnProduct(sofaInput(o), { products: catalog.catalogProducts(), ...opts });

// ---------------------------------------------------------------------------------------------------------------
group('validation and the product shape');
{
  const ok = validateOwnInput(sofaInput());
  check('a complete sofa is valid', ok.ok, JSON.stringify(ok.errors));
  const bad = validateOwnInput(sofaInput({ url: 'http://shop.example/p', retailer: ' ', name: '', price: '', dims: { w: '0', d: 'abc', h: '5000' } }));
  check('plain-word errors beside each field', bad.errors.url && /https/.test(bad.errors.url) && bad.errors.retailer && bad.errors.name && /Price on request/.test(bad.errors.price)
    && bad.errors.w && bad.errors.d && /at most/.test(bad.errors.h), JSON.stringify(bad.errors));
  check('a link that is not a link is refused', !!validateOwnInput(sofaInput({ url: 'kaza sofa' })).errors.url);
  check('no link is fine (optional)', validateOwnInput(sofaInput({ url: '' })).ok);
  check('price on request needs no number', validateOwnInput(sofaInput({ price: '', priceOnRequest: true })).ok);
  check('a zero price is refused', !!validateOwnInput(sofaInput({ price: '0' })).errors.price);
  check('unknown kind / category refused', !!validateOwnInput(sofaInput({ type: 'spaceship' })).errors.type && !!validateOwnInput(sofaInput({ category: 'garage' })).errors.category);
  check('carpentry units are not offered', !!validateOwnInput(sofaInput({ type: 'carpentry-unit' })).errors.type);
  const odd = validateOwnInput(sofaInput({ dims: { w: '212', d: '94', h: '400' } }));
  check('far from the usual proportions → a warning, not an error', odd.ok && /unusual/.test(odd.warnings.size || ''), JSON.stringify(odd));
  check('sizeWarning is quiet for a normal sofa', sizeWarning('sofa', { w: 212, d: 94, h: 81 }) === '');
  check('finish: tile size checked, no width × depth × height needed', validateOwnInput({ ...sofaInput({ type: 'floor-finish', category: 'finishes', dims: {} }), params: { tileW: '60', tileH: '120' } }).ok
    && !!validateOwnInput({ ...sofaInput({ type: 'floor-finish', category: 'finishes', dims: {} }), params: { tileW: '900' } }).errors.tileW);
  check('readNumber reads what people type', readNumber('4,990') === 4990 && readNumber('12,5') === 12.5 && readNumber(' ₪ 85 ') === 85 && readNumber('x') === null);
  check('shop name from a link', shopFromUrl('https://www.shop.example.com/products/x') === 'shop.example.com' && shopFromUrl('not a link') === '');
  const p = make({}, { now: () => '2026-11-14T10:00:00.000Z', createdBy: 'a@example.com' });
  check('id own-<short id>, own: true, createdBy kept', isOwnId(p.id) && /^own-[a-z0-9]{8}$/.test(p.id) && p.own === true && p.createdBy === 'a@example.com', p.id);
  check('catalogue shape: price, unit, dims, type, params, zone, category, subcategory, placement, tags', p.price === 4990 && p.priceUnit === 'item' && p.dims.w === 212 && p.type === 'sofa'
    && p.params.color === '#8a5a3b' && p.params.seats === 3 && p.params.chaise === 'left' && !('nonsense' in p.params) && p.zone === 'indoor' && p.category === 'living'
    && p.subcategory === 'sofas' && p.placement === 'floor' && p.tags.includes('own') && p.url.startsWith('https://') && p.brand === 'Nordhaus' && p.note === 'Ask for the linen cover', JSON.stringify(p));
  const ask = make({ priceOnRequest: true, price: '' });
  check('price on request: price null + priceOnRequest', ask.price === null && ask.priceOnRequest === true);
  const back = inputFromProduct(p);
  check('edit round trip: input → product → input → same product', JSON.stringify(buildOwnProduct(back, { prev: p })) === JSON.stringify(p));
  check('a catalogue product is never an own product', !catalog.catalogProducts().some((x) => isOwnId(x.id)));
  check('kinds of a category from the catalogue (living: sofa first)', typesForCategory('indoor', 'living', catalog.catalogProducts())[0] === 'sofa'
    && typesForCategory('indoor', 'finishes', catalog.catalogProducts())[0] === 'floor-finish' && typesForCategory('indoor', 'living', catalog.catalogProducts(), { all: true }).length > 20);
  check('type options: main choices first, then More options', typeOptions('table').filter((o) => o.main).map((o) => o.key).join() === 'shape,color' && typeOptions('table').some((o) => o.key === 'base' && !o.main));
  check('normalizeOwnProduct drops what is not an own product', normalizeOwnProduct({ id: 'ikea-x', name: 'x', type: 'sofa' }) === null && normalizeOwnProduct({ id: 'own-a', name: '', type: 'sofa' }) === null
    && normalizeOwnProduct({ id: 'own-a', name: 'A', type: 'sofa', url: 'javascript:alert(1)' }).url === null);
  check('newOwnId is short and prefixed', /^own-[a-z0-9]{8}$/.test(newOwnId()));
}

// ---------------------------------------------------------------------------------------------------------------
group('store: add / edit / delete are undo steps; the catalogue follows');
const baseDesign = { items: [{ id: 'g1', type: 'sofa', name: 'Sofa', generic: true, w: 200, d: 90, h: 80, x: 600, y: 300 }] };
store.load(clone(baseDesign));
const before = JSON.stringify(store.serialize().items);
const P1 = make({}, { now: () => '2026-11-14T10:00:00.000Z' });
{
  const legacy = store.serialize();
  check('a design without own products has no customProducts key', !('customProducts' in legacy));
  let events = 0; const off = store.on('products', () => events++);
  const added = store.addCustomProduct(P1);
  check('addCustomProduct stores it and emits "products"', added && added.id === P1.id && store.customProducts.length === 1 && events === 1);
  check('the catalogue knows it (getProduct, allProducts)', catalog.getProduct(P1.id) && catalog.getProduct(P1.id).name === 'Oslo 3-seat sofa' && catalog.allProducts().length === catalog.catalogProducts().length + 1);
  check('adding the same id twice is refused', store.addCustomProduct(P1) === null && store.customProducts.length === 1);
  store.undo();
  check('undo removes it from the project and the catalogue', store.customProducts.length === 0 && !catalog.getProduct(P1.id));
  store.redo();
  check('redo brings it back', !!catalog.getProduct(P1.id));
  // place it twice, then edit: both items follow
  const it1 = store.addItem({ ...catalog.itemFromProduct(catalog.getProduct(P1.id), { x: 400, y: 400 }), id: 'p1' });
  store.addItem({ ...catalog.itemFromProduct(catalog.getProduct(P1.id), { x: 800, y: 400, rot: 90 }), id: 'p2' });
  check('placed like a catalogue product (price, link, shop, size)', it1.productId === P1.id && it1.price === 4990 && it1.url === P1.url && it1.retailer === 'shop.example.com' && it1.w === 212);
  const edited = buildOwnProduct({ ...inputFromProduct(P1), price: '4490', dims: { w: 230, d: 96, h: 82 }, params: { color: '#3e5c76' } }, { prev: P1 });
  store.updateCustomProduct(P1.id, edited);
  const p2 = store.getItem('p2');
  check('edit: placed items take the new price, size and look; position stays', p2.price === 4490 && p2.w === 230 && p2.params.color === '#3e5c76' && p2.x === 800 && p2.rot === 90 && catalog.getProduct(P1.id).price === 4490);
  store.undo();
  check('undo of the edit restores product and items', store.getItem('p2').price === 4990 && store.getItem('p2').w === 212 && catalog.getProduct(P1.id).price === 4990);
  store.redo();
  // link a generic item
  const P2 = make({ name: 'Linked lamp', type: 'floor-lamp', category: 'lighting', dims: { w: 40, d: 40, h: 150 }, priceOnRequest: true, price: '' }, { now: () => '2026-11-14T11:00:00.000Z' });
  store.addCustomProduct(P2, { linkItem: 'g1' });
  const g1 = store.getItem('g1');
  check('"Link to a product you found": one step adds the product and links the generic item', g1.productId === P2.id && !g1.generic && g1.type === 'floor-lamp' && g1.price === null && g1.x === 600);
  store.undo();
  check('… and one undo unlinks and removes it', store.getItem('g1').generic && store.getItem('g1').productId === null && !store.getCustomProduct(P2.id));
  store.redo();
  off();
}

// ---------------------------------------------------------------------------------------------------------------
group('merge into the catalogue: search, category, supplier filter, "only mine", sort');
{
  const q = catalog.searchProducts({ query: 'example' });
  check('search finds it by shop and name', q.some((p) => p.id === P1.id) && catalog.searchProducts({ query: 'oslo sofa' }).some((p) => p.id === P1.id));
  check('category rail counts it', catalog.categoryCounts('indoor').living === catalog.catalogProducts().filter((p) => p.zone === 'indoor' && p.category === 'living').length + 1);
  check('supplier filter lists the shop (both products from it)', catalog.retailers('indoor').some((r) => r.name === 'shop.example.com' && r.count === 2));
  check('filter by its shop', catalog.searchProducts({ retailer: 'shop.example.com' }).every((p) => isOwnId(p.id)) && catalog.searchProducts({ retailer: 'shop.example.com' }).some((p) => p.id === P1.id));
  const mine = catalog.searchProducts({ own: true });
  check('"only products I added"', mine.length === 2 && mine.every((p) => isOwnId(p.id)));
  const asc = catalog.searchProducts({ zone: 'indoor', sort: 'price-asc' });
  check('price on request sorts after every priced product', asc[asc.length - 1].price === null && asc.slice(0, -1).every((p) => p.price != null));
  check('a price filter leaves price-on-request out', !catalog.searchProducts({ minPrice: 1 }).some((p) => p.price == null));
  check('alternatives (Swap for…) include own products of that type', catalog.alternativesFor({ type: 'sofa', w: 200, d: 90 }, 2000).some((p) => p.id === P1.id));
  check('own ids never shadow catalogue ids', catalog.setOwnProducts([{ ...P1, id: catalog.catalogProducts()[0].id }]).length === 0);
  catalog.setOwnProducts(store.customProducts);
}

// ---------------------------------------------------------------------------------------------------------------
group('price on request in the shopping list, totals and CSV');
{
  const s = buildShopping(ctx, 'room');
  const rows = s.groups.flatMap((g) => g.rows);
  const ask = rows.find((r) => r.productId === store.getCustomProduct(store.customProducts[1].id).id);
  check('listed as a row with "on request", cost 0', ask && ask.onRequest === true && ask.unitPrice === null && ask.cost === 0);
  check('excluded from the total, counted for the note', s.onRequest === 1 && Math.round(s.total) === 4490 * 2, `${s.total} ${s.onRequest}`);
  check('not "still to choose"', !s.pending.some((r) => r.ids.includes('g1')));
  const csv = shoppingCSV(ctx);
  check('CSV: "price on request", empty cost, the link, and a "Not in the total" line', /Linked lamp,shop\.example\.com,1,pcs,price on request,,/.test(csv) && /Not in the total,1 product with price on request is not in the total\./.test(csv) && csv.includes(P1.url), csv.split('\r\n').filter((l) => /Linked|Not in/.test(l)).join(' | '));
  check('shoppingTotal carries the count', shoppingTotal(ctx).onRequest === 1);
  // a finish with price on request
  const F = buildOwnProduct({ ...sofaInput({ type: 'floor-finish', category: 'finishes', name: 'Terrazzo tile', priceOnRequest: true, price: '', dims: {} }), params: { pattern: 'terrazzo', tileW: '60', tileH: '60', color: '#d9d2c5' } }, { now: () => '2026-11-14T12:00:00.000Z' });
  store.addCustomProduct(F);
  store.setFinish(PLAN.rooms[0].id, { floor: F.id });
  const s2 = buildShopping(ctx, 'room');
  const frow = s2.groups.flatMap((g) => g.rows).find((r) => r.productId === F.id);
  check('Rooms finish with price on request: listed, not in the total', frow && frow.onRequest && frow.cost === 0 && s2.onRequest === 2 && Math.round(s2.total) === Math.round(s.total));
  store.undo(); store.undo();
}

// ---------------------------------------------------------------------------------------------------------------
group('serialise → load, project file round trip, duplicate');
{
  const saved = clone(store.serialize());
  check('customProducts written when there is one', Array.isArray(saved.customProducts) && saved.customProducts.length === 2);
  store.load(clone(baseDesign));
  check('loading a design without them clears them (and the catalogue)', store.customProducts.length === 0 && !catalog.getProduct(P1.id) && catalog.searchProducts({ own: true }).length === 0);
  store.load(clone(saved));
  check('loading brings them back with the items', store.customProducts.length === 2 && catalog.getProduct(P1.id) && store.getItem('p1').productId === P1.id);
  const again = clone(store.serialize()); delete again.savedAt; delete saved.savedAt;
  check('serialise → load → serialise is identical', JSON.stringify(again) === JSON.stringify(saved));
  const projects = createProjects({ store, adapter: createMemoryAdapter() });
  await projects.init();
  store.load(clone(saved));
  await projects.save();
  const file = await projects.exportFile();
  check('the project file holds them', file.ok && JSON.parse(file.text).project.design.customProducts.length === 2);
  const imp = await projects.importFile(file.text, { open: true });
  check('importing the file opens a project with them', imp.ok && store.customProducts.length === 2 && !!catalog.getProduct(P1.id));
  const dup = await projects.duplicate(projects.current().id, { open: true });
  check('duplicate project keeps them', dup.ok && store.customProducts.length === 2);
  await projects.create({ from: 'house98', name: 'Fresh', open: true });
  check('another project does not see them (no fake data)', store.customProducts.length === 0 && !catalog.getProduct(P1.id));
  await projects.open(imp.project.id);
  check('back in the project they are there again', store.customProducts.length === 2 && !!catalog.getProduct(P1.id));
  store.load(clone(saved));
}

// ---------------------------------------------------------------------------------------------------------------
group('delete with placed items: they stay as generic items with their size');
{
  const n = store.itemsOfProduct(P1.id).length;
  const sizes = store.items.filter((i) => i.productId === P1.id).map((i) => [i.id, i.w, i.d, i.h, i.x, i.y]);
  const res = store.removeCustomProduct(P1.id);
  check('removeCustomProduct reports the placed items', res && res.items === n && n === 2);
  const after = sizes.map(([id]) => store.getItem(id));
  check('items stay, generic, size and position kept, no price / link / shop', after.every((it, k) => it && it.generic && it.productId === null && it.price === null && it.url === null && it.retailer === null
    && it.w === sizes[k][1] && it.d === sizes[k][2] && it.h === sizes[k][3] && it.x === sizes[k][4]));
  check('gone from the catalogue', !catalog.getProduct(P1.id) && !catalog.searchProducts({ query: 'example' }).some((p) => p.id === P1.id));
  check('the shopping list now has them "still to choose"', buildShopping(ctx).pending.some((r) => r.ids.includes(sizes[0][0])));
  store.undo();
  check('undo: product back, items linked again', !!store.getCustomProduct(P1.id) && store.getItem(sizes[0][0]).productId === P1.id && store.getItem(sizes[0][0]).price === 4490);
  store.load({ items: JSON.parse(before) });
}

// ---------------------------------------------------------------------------------------------------------------
group('library on this device, storage unavailable');
{
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const lib = await import('../src/ui/own-library.js');
  check('empty library, no crash', Array.isArray(lib.libraryList()) && lib.libraryList().length === 0);
  check('put works in memory', lib.libraryPut({ ...P1, createdBy: 'a@example.com' }) === true && lib.inLibrary(P1.id));
  check('the library copy carries no collaborator address', !('createdBy' in lib.libraryList()[0]));
  store.load(clone(baseDesign));
  const reused = store.addCustomProduct(lib.libraryList()[0]);
  check('add from the library to another project', reused && reused.id === P1.id && !!catalog.getProduct(P1.id));
  check('remove from the library', lib.libraryRemove(P1.id) && !lib.inLibrary(P1.id));
  delete globalThis.localStorage;
}

// ---------------------------------------------------------------------------------------------------------------
group('collaboration: ops, doc ⇄ record');
{
  store.load(clone(baseDesign));
  const rec = { name: 'P', phase: 'fixed', basePlan: null, design: clone(store.serialize()) };
  check('a design without own products → no cprod entity, record unchanged', !Object.keys(recordToDoc(rec).e).some((k) => k.startsWith('cprod:')) && !('customProducts' in docToRecord(recordToDoc(rec)).design));
  store.addCustomProduct(P1);
  const rec2 = { name: 'P', phase: 'fixed', basePlan: null, design: clone(store.serialize()) };
  const doc = recordToDoc(rec2);
  check('own products become cprod:<id> entities and come back', doc.e['cprod:' + P1.id] && JSON.stringify(docToRecord(doc).design.customProducts) === JSON.stringify(rec2.design.customProducts));
  check('op validation: a cprod put / set is accepted, a bad link / id change refused', validateOps([{ k: 'cprod:' + P1.id, p: clone(P1) }]) === '' && validateOps([{ k: 'cprod:' + P1.id, s: { price: 10 } }]) === ''
    && validateOps([{ k: 'cprod:' + P1.id, s: { url: 'http://x' } }]) !== '' && validateOps([{ k: 'cprod:' + P1.id, s: { id: 'own-other' } }]) !== '' && validateOps([{ k: 'cprod:' + P1.id, p: { ...clone(P1), id: 'own-zzz' } }]) !== '');
}

// ---------------------------------------------------------------------------------------------------------------
group('collaboration: two real-store replicas');
{
  const WORKER = fileURLToPath(new URL('./collab-replica.worker.mjs', import.meta.url));
  const memStorage = () => { const m = new Map(); return { async get(k) { return m.has(k) ? clone(m.get(k)) : undefined; }, async put(k, v) { m.set(k, clone(v)); }, async delete(k) { m.delete(k); } }; };
  const { BUILTIN_PLAN } = await import('../src/core/plan-edit.js');
  const record = { id: 'own', name: 'House', phase: 'fixed', basePlan: clone(BUILTIN_PLAN), design: { items: [] } };
  const room = createRoom({ id: 'own', storage: memStorage(), now: () => 1e12, record, limits: { rate: { ops: [1e6, 1e6] } } });
  await room.load();
  const spawn = (name) => {
    const w = new Worker(WORKER, { workerData: { name } });
    let n = 0; const waits = new Map();
    const rep = { name, w, up: [], connId: name + '#1' };
    w.on('message', (m) => { if (m.type === 'reply') { const f = waits.get(m.id); waits.delete(m.id); f && f(m); } else if (m.type === 'up') rep.up.push(m.text); });
    rep.call = (code, arg) => new Promise((res, rej) => { const id = ++n; waits.set(id, (m) => (m.error ? rej(new Error(m.error)) : res(m.value))); w.postMessage({ type: 'call', id, code, arg }); });
    room.join({ id: rep.connId, email: name.toLowerCase() + '@example.com', role: 'editor', send: (text) => w.postMessage({ type: 'down', text }) });
    return rep;
  };
  const A = spawn('A'), B = spawn('B');
  await A.call('start'); await B.call('start');
  const pump = async (only) => {
    for (let guard = 0; guard < 200; guard++) {
      let moved = false;
      for (const r of [A, B]) { if (only && !only.includes(r)) continue; while (r.up.length) { moved = true; await room.receive(r.connId, r.up.shift()); } }
      await Promise.all([A.call('tick'), B.call('tick')]);
      if (A.up.length || B.up.length) moved = true;
      if (!moved) return;
    }
  };
  const state = async (r) => JSON.parse(await r.call('ownState'));
  const same = async () => (await A.call('serialize')) === (await B.call('serialize'));
  await pump();
  const PA = { ...clone(P1), createdBy: 'a@example.com' };
  await A.call('st', ['addCustomProduct', [PA]]);
  await pump();
  check('A adds a product → B has it', (await state(B)).products.some((p) => p.id === PA.id) && await same());
  await B.call('st', ['addItem', [{ productId: PA.id, type: 'sofa', name: PA.name, w: 212, d: 94, h: 81, price: 4990, url: PA.url, retailer: PA.retailer, x: 500, y: 500, id: 'bsofa' }]]);
  await pump();
  check('B places it → A sees the item', (await state(A)).items.some((i) => i.id === 'bsofa'));
  await A.call('st', ['updateCustomProduct', [PA.id, { ...PA, price: 3990 }]]);
  await pump();
  const [sa, sb] = [await state(A), await state(B)];
  check('A edits the price → both converge (product and B\'s item)', sa.products[0].price === 3990 && sb.products[0].price === 3990 && sb.items.find((i) => i.id === 'bsofa').price === 3990 && await same());
  // concurrent: A edits the price again while B places a second one (B has not seen the edit) → the item follows
  await A.call('st', ['updateCustomProduct', [PA.id, { ...PA, price: 3790 }]]);
  await B.call('st', ['addItem', [{ productId: PA.id, type: 'sofa', name: PA.name, w: 212, d: 94, h: 81, price: 3990, url: PA.url, retailer: PA.retailer, x: 900, y: 500, id: 'bsofa2' }]]);
  await pump([A]); await pump();
  const [ta, tb] = [await state(A), await state(B)];
  check('a price edit concurrent with a placement: the new item takes the new price on both', ta.items.find((i) => i.id === 'bsofa2').price === 3790 && tb.items.find((i) => i.id === 'bsofa2').price === 3790 && await same());
  // A deletes while B places → the item stays generic on both
  await A.call('st', ['removeCustomProduct', [PA.id]]);
  await B.call('st', ['addItem', [{ productId: PA.id, type: 'sofa', name: PA.name, w: 212, d: 94, h: 81, price: 3790, url: PA.url, retailer: PA.retailer, x: 300, y: 900, id: 'bsofa3' }]]);
  await pump([A]); await pump();
  const [da, db] = [await state(A), await state(B)];
  const gen = (s, id) => { const it = s.items.find((i) => i.id === id); return it && it.generic === true && it.productId === null && it.price === null && it.url === null && it.w === 212 && it.d === 94; };
  check('A deletes while B places: the product is gone on both', !da.products.length && !db.products.length);
  check('… B\'s new item stays as a generic item (size kept) on both', gen(da, 'bsofa3') && gen(db, 'bsofa3'), JSON.stringify(db.items));
  check('… the items A knew about are generic too', gen(da, 'bsofa') && gen(db, 'bsofa') && gen(db, 'bsofa2'));
  check('… and both replicas are byte-identical', await same());
  await A.call('undo'); await pump();
  check('A\'s undo restores the product on both', (await state(B)).products.length === 1 && await same());
  await A.w.terminate(); await B.w.terminate();
}

console.log(`\nown-product: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
