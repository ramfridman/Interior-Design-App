# House 98 (E7) Interior Design App — Team Contract

One-page-app (static, **no build step**, ES modules, Three.js vendored) that lets the owner of **house 98, Kibbutz Afikim
(architect's model E7)** furnish and landscape their real house: exact 2D plan, real Israeli-market products with
prices and purchase links, real-time 3D with walk-through, and full garden design inside the lot.

Read this file fully before writing code. It is the only coordination channel between team members.

## 0. Ground rules

* **File ownership is strict.** Only edit files in the paths assigned to you. Never edit `src/core/*`,
  `src/models/registry.js`, `src/models/kit.js`, `src/models/types.js`, `src/catalog/index.js`, `src/main.js`
  or `vendor/*` — if you need a change there, describe it in your final report.
* **No git commands** (no commit/checkout/stash/reset). The lead integrates and commits.
* No frameworks, no bundler, no npm dependencies at runtime, no CDN, no external images/fonts at runtime
  (the app must work offline from a static file server and inside a sandboxed iframe).
  Three.js: `import * as THREE from 'three'`, addons: `import { X } from 'three/addons/…'` (import map in index.html;
  available addon folders: controls, environments, geometries, lights, math, objects, postprocessing, shaders, utils — r170).
* Language: **English UI**. Units: metric. Currency: **₪ (ILS)**.
* Never invent facts about the house. Geometry comes from `src/core/plan.js` only.
* Never invent products, prices or URLs (see § 6).
* Code quality: small pure functions, JSDoc on exports, no dead code, no `console.log` noise, no global leaks.
  Must not throw on bad input — degrade gracefully.
* Dev server: `node dev/serve.mjs <port>` (use your own port to avoid clashes: see your brief).
  Chromium + Playwright are preinstalled (`require('playwright')`, `chromium.launch()` — do NOT install anything).
  WebGL works headless: launch with `args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']` if the default fails.
  Put scratch test pages in `dev/` (e.g. `dev/view2d.html`) and screenshots in `dev/screens/` (git-ignored).
  Always look at your own screenshots and iterate until the result is genuinely excellent.

## 1. Coordinate systems

**Plan space** (2D, everything in `core/`): centimetres; origin = outer NW corner of the house; `+x` east
(right on the drawing), `+y` south (down). House spans x 0..1535, y 0..1380. Lot ≈ 25 × 20 m around it
(`PLAN.site.boundary`, x −635..1901, y −310..1690). Street is on the **east** side; the two parking bays are in the
**north-east** corner; kitchen/living are on the north side, bedrooms on the south side, terrace north-west.

> **Plan update (lead):** the owner's real house is lot 98 — the exact north–south MIRROR of the first sketch.
> `src/core/plan.js` and `src/core/initial-layout.js` were regenerated for lot 98. Never hard-code plan coordinates;
> always read `PLAN`. The written dimension sheet (reference image `dim_full.png`) shows the un-mirrored twin: its
> TOP dimension chain is this house's SOUTH side and vice versa. The lot-98 site plan is `work2/site98.png`.

**World space** (3D): metres, Y up. `X = x/100`, `Z = y/100`. Finished floor of the house is at `Y = 0`;
garden ground is at `Y = -PLAN.heights.floorAboveGround/100` (−0.15); terrace / porch slabs are at Y = 0 − 0.02.

**Item pose**: `(x, y)` = centre of footprint (cm); `w` = width (local x), `d` = depth (local y), `h` = height;
`rot` = degrees **clockwise as seen on the plan**. Local `+y` is the item's **FRONT**, local `−y` its **BACK**
(the side that goes against a wall). `rot 0` → front faces south; `90` → west; `180` → north; `270` → east.
In 3D: `object.position.set(x/100, elev/100 (+floor offset if outdoors), y/100); object.rotation.y = -rot * Math.PI/180`
(model local +Z = front). Helpers: `itemCorners`, `itemLocalToPlan`, `planToItemLocal` in `core/geometry.js`.

## 2. Core modules (read-only for everyone; written by the lead)

| Module | What it gives you |
| --- | --- |
| `src/core/plan.js` | `PLAN` = `{ meta, heights, bounds, walls[], wallOutline[], openings[], rooms[], outdoorAreas[], site, assumptions[] }`. Read the header comments — every field is documented. |
| `src/core/geometry.js` | `pointInPolygon, spaceAt(x,y), isIndoors, itemCorners, itemAABB, wallsHitByItem, itemsOverlap, wallFaces() (snap targets with outward normals), walkBlockers(), polygonArea, areaM2, fmtLen, fmtPrice, clamp, snapTo, normDeg` |
| `src/core/store.js` | `store` singleton: state + events + undo/redo + autosave (see header). |
| `src/core/finishes.js` | `resolveFinish(spaceId, 'floor'|'wall', store, catalog)`, `DEFAULT_FLOOR/WALL`, `floorAreaM2`, `wallAreaM2`, `finishCost`. |
| `src/core/initial-layout.js` | The architect's furniture layout as generic items. |
| `src/catalog/index.js` | `loadCatalog, allProducts, getProduct, searchProducts(opts), retailers(zone), categoryCounts(zone), alternativesFor(item), itemFromProduct(product, {x,y,rot}, ceilingHeight), itemCost(item), defaultElevation, CATEGORIES` |
| `src/models/index.js` | `loadModels, buildModel(item) → THREE.Object3D, drawSymbol(ctx, item, px), hasModel, MODEL_TYPES, CATEGORIES` |
| `src/models/kit.js` | Shared materials + primitives for 3D models and 2D symbols. |
| `src/models/types.js` | Closed list of model types with default sizes and allowed params; `CATEGORIES` tree. |

Everything a view or panel needs is passed as one context object:
`ctx = { store, plan, catalog, models }` (`catalog` / `models` are the module namespaces above).

### Store essentials
```js
store.items            // Item[]   (draw order = array order)
store.selection        // string[] item ids
store.ui               // { mode:'2d'|'3d'|'walk'|'split', tool, units, snap, gridStep, showGrid, showDimensions,
                       //   showRoomLabels, showSite, showItems, showRoof, wallsCutaway, timeOfDay, leftPanel, rightPanel, catalogZone }
store.project          // { name, ceilingHeight (cm, 300), roof:'flat', wallColor, exteriorColor, frameColor }
store.finishes         // { [spaceId]: { floor?: productId, wall?: productId } }
store.addItem(partial) / addItems([...]) / updateItem(id, patch, {transient}) / updateItems(ids, patch|fn)
store.removeItems(ids) / duplicateItems(ids) / swapItem(id, partial) / bringToFront(ids) / sendToBack(ids)
store.select(ids) / toggleSelect(id) / clearSelection() / getItem(id) / getSelected() / spaceOf(item)
store.setUI(patch) / setProject(patch) / setFinish(spaceId, patch)
store.begin() … store.commit() / store.cancel()     // one undo step for a whole drag
store.undo() / redo() / historyState()
store.serialize() / load(data) / saveLocal() / loadLocal() / clearLocal()
store.on('items'|'selection'|'ui'|'project'|'finishes'|'history'|'load', fn) → unsubscribe
```
While dragging use `store.begin()`, then `updateItem(id, patch, { transient: true })` per mouse move, then `store.commit()`.
Views must re-render from store events only (never assume they are the only writer).

### Item (a placed object)
```js
{ id, productId|null, type, name, params:{}, x, y, rot, elev, w, d, h,           // cm / degrees
  placement:'floor'|'wall'|'ceiling'|'surface', zone:'indoor'|'outdoor',
  price|null, priceUnit:'item'|'m2'|'m', url|null, retailer|null, brand|null,
  locked:false, hidden:false, fixture:false, generic:false, note:'' }
```
`generic: true` = placeholder from the architect's drawing with no product yet (no price / link).
`elev` = height of the item's bottom above the floor (wall art, wall cabinets, ceiling lights: `ceilingHeight − h`).
`type: 'surface'` items (lawn, deck, paving…) and `pool`, `fence`, `hedge`, `flower-bed`, `rug`, `pergola` are **resizable**
(user can change w/d freely); everything else keeps product dimensions (resizing allowed only for `generic` items).

## 3. Models (`src/models/<file>.js`) — modelling team

Each file registers the types assigned to it in `types.js` (`MODEL_TYPES[type].file`):
```js
import * as THREE from 'three';
import { registerModel } from './registry.js';
import * as K from './kit.js';

registerModel('sofa', {
  build({ w, d, h, p, item }) { … return THREE.Group; },     // METRES. Box: x∈[-w/2,w/2], y∈[0,h], z∈[-d/2,d/2]. Front = +Z.
  draw2d(ctx, { w, d, h, p, px, item }) { … },               // CENTIMETRES, origin = centre, +y = front. px = 1 screen pixel.
});
```
Rules:
* The model must **fill exactly** the given `w × d × h` box for any reasonable size — proportions adapt
  (a 140 cm sofa has 2 seats, a 300 cm one 4; leg/arm thicknesses stay realistic rather than stretching).
* Honour the common params (`color, color2, color3, material, material2, style`) and the type's own params from
  `types.js`. Unknown / missing values → sensible defaults. Never throw.
* Looks: clean, believable, mid-poly “architectural visualisation” style. Soft rounded upholstery (`K.rbox`),
  thin real-world thicknesses (table tops 2–4 cm, panels 1.8 cm), visible details that make the object readable
  at a glance (cushion seams as separate cushions, handles, plinths, faucets, burners, leaves…).
  Budget: typically 10–80 meshes per object, ≤ ~3k triangles for furniture, ≤ ~8k for trees. Reuse geometry/materials via the kit.
* Use kit materials (`K.wood, K.fabric, K.metal, K.glass, K.ceramic, K.stone, K.foliage, K.water, K.glow …`).
  Do not create lights except via `K.lampLight` (and only when `p.on !== false` for lamp types).
  Mark meshes that should not cast shadows (glass, water, glow) with `mesh.userData.noShadow = true`.
* Deterministic: use `K.rng(K.hashStr(item?.id || type))` for any randomness (foliage, books).
* `draw2d`: an elegant architectural top-view symbol — light fill tinted from the product colour (`K.tint`),
  thin dark outlines (`K.INK`, `lineWidth = px`), enough detail to recognise the object (cushions, pillows, burners,
  basin bowl, tree canopy with trunk dot…). Must look good from 20 px to 800 px on screen.
* Placement specifics: `wall` items are built with their back at −Z (z = −d/2 plane touches the wall) and y from 0..h
  (the view lifts them to `elev`); `ceiling` items hang down from y = h (top touches the ceiling); `surface` items sit at y = 0.
* Each file must be self-testing: `dev/models-<file>.html` renders every type in a grid (several param variants each)
  in 3D and 2D so you can screenshot and review your own work.

## 4. Views

### `src/view2d/index.js` — plan editor
```js
export function createView2D(container, ctx) → {
  resize(), setActive(bool),
  fit(target = 'lot' | 'house' | 'selection' | {x,y,w,h}, {animate}),
  zoomBy(factor), getScale() /* px per cm */,
  screenToPlan(clientX, clientY) → {x, y}, planToScreen(x, y) → {x, y},
  startPlacing(partialItem, {onDone}) /* ghost follows cursor; click places (store.addItem); Esc cancels */,
  dropAt(clientX, clientY, partialItem) → item|null /* HTML5 drag-and-drop from the catalogue */,
  exportPNG({ scale }) → Promise<Blob>,
  on('cursor'|'zoom'|'placing', fn) → unsubscribe,
  destroy(),
}
```
### `src/view3d/index.js` — 3D viewer
```js
export function createView3D(container, ctx) → {
  resize(), setActive(bool) /* pause the render loop when hidden */,
  setMode('orbit' | 'walk'), getMode(),
  setCameraPreset('aerial' | 'top' | 'front' | 'garden' | 'interior' | roomId, {animate}),
  enterWalk({ x, y, heading }?) /* plan cm; default: just inside the entry door looking in */, exitWalk(),
  focusItem(id),
  startPlacing(partialItem, {onDone}), dropAt(clientX, clientY, partialItem) → item|null,
  snapshot({ width, height }) → Promise<string /* PNG data URL */>,
  on('mode'|'walk-position'|'ready', fn) → unsubscribe,
  destroy(),
}
```
Internal 3D modules (same team): `view3d/house.js` (`buildHouse(ctx) → { group, update(), setRoofVisible(b), setCutaway(cm|null), dispose() }`),
`view3d/site.js` (`buildSite(ctx)`), `view3d/environment.js` (sky, sun by `store.ui.timeOfDay` and `PLAN.meta.northAngle`, lights, shadows),
`view3d/textures.js` (procedural floor/wall textures from finish params), `view3d/thumbs.js`:
```js
export function getThumbnail(productOrItem, size = 176) → Promise<string>   // cached PNG data URL, rendered from the 3D model
```
Both views show the same store state live (move in 2D → moves in 3D, and vice-versa).

## 5. UI (`index.html`, `src/styles/*`, `src/ui/*`) — UX/UI team
`index.html` provides the shell with mount points `#view2d` and `#view3d`, a boot splash `#boot` containing
`#boot-status`, the import map, and `<script type="module" src="./src/main.js">`.
```js
export function initUI({ store, plan, catalog, models, view2d, view3d }) → { toast(msg, opts), openPanel(name), … }
```
The UI owns: mode switching (`store.ui.mode`: show/hide `#view2d`/`#view3d`, call `setActive`/`resize`), catalogue browser,
inspector, shopping list & budget, rooms & finishes, compliance checks panel, settings, keyboard shortcuts, onboarding,
save/open design file, export (PNG, shopping-list CSV / print).

## 6. Catalogue data (`src/catalog/data/<file>.js`) — market research team

`export default [ product, … ]`. **Every product must be a real product currently sold in Israel**, taken from a
retailer page you actually opened during this task. Schema:
```js
{
  id: 'ikea-kivik-3seat-tibbleby-beige',      // unique, kebab-case, prefixed with retailer slug
  name: 'KIVIK 3-seat sofa, Tibbleby beige/grey', // English display name (keep brand/model names as sold)
  nameHe: 'קיוויק ספה תלת-מושבית',             // name as listed on the Israeli page (optional but preferred)
  brand: 'IKEA', retailer: 'IKEA Israel',
  url: 'https://www.ikea.com/il/he/p/…',       // direct product page (https), exactly as fetched
  price: 2995,                                  // number, ILS incl. VAT, current price shown on the page
  priceUnit: 'item',                            // 'item' | 'm2' | 'm'   (m2 for flooring, grass, decking, paint coverage; m for fences/hedges)
  priceDate: '2026-11',
  dims: { w: 228, d: 95, h: 83 },               // cm, real product dimensions from the page (w = width/length, d = depth, h = height)
  type: 'sofa',                                 // one of MODEL_TYPES (src/models/types.js)
  params: { seats: 3, color: '#cbbfa8', material: 'fabric', legs: 'wood' },   // per types.js; colours as hex matching the product photo
  zone: 'indoor',                               // 'indoor' | 'outdoor'
  category: 'living', subcategory: 'sofas',     // from CATEGORIES in types.js
  placement: 'floor',                           // optional override of the type default
  tags: ['scandinavian', '3-seat', 'removable-cover'],
  description: 'One short factual sentence.',
}
```
Hard rules:
1. **No fabrication.** `price`, `url`, `dims` and the product's existence must come from a page you fetched in this task
   (the product page, or the retailer's listing/search/JSON API that shows that product with its price).
   If you cannot verify a field, drop the product. A smaller, fully real catalogue beats a bigger, partly invented one.
2. URLs must be the product page a shopper can buy from. No search-result URLs, no affiliate/redirect links.
3. Dimensions: if the page gives only some of them, use the manufacturer's spec page; if still unknown, drop the product
   (for flat things such as rugs use `h: 1–2`; for plants use the typical delivered pot diameter and plant height stated on the page).
4. Spread across several Israeli retailers and price levels (budget → premium); do not rely on one store only.
5. Variety that matters to a designer: different sizes, shapes, colours and styles in each sub-category.
6. Keep a research log next to the data: `src/catalog/data/<file>.sources.md` — retailer, date, how prices were read, anything dropped and why.
